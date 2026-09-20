const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Minimal .env loader (no dependency): put ANTHROPIC_API_KEY=... in ./.env.
// Falls back to the Calorie Counter's .env so the same local dev key is shared.
for (const envPath of [__dirname + '/.env', __dirname + '/../Calorie_Counter/server/.env']) {
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  if (process.env.ANTHROPIC_API_KEY) break;
}

const ai = require('./ai');
const store = require('./store');
const notify = require('./notify');
const compression = require('compression');

const app = express();
// gzip JSON/JS/CSS (images are skipped by the default filter; streaming chat/ask endpoints must not be buffered)
app.use(compression({ filter: (req, res) => !/\/(chat|ask)$/.test(req.path) && compression.filter(req, res) }));
app.use(express.json({ limit: '40mb' }));
// vendored libs never change under the same path → cache for a year; app files revalidate (ETag → 304)
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], setHeaders: (res, file) => {
  if (file.includes(path.sep + 'vendor' + path.sep)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  else if (/\.(js|css|html|json)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  else res.setHeader('Cache-Control', 'public, max-age=604800');
} }));

// ---------- small helpers ----------
const EVENT_TYPES = ['test', 'quiz', 'homework', 'project', 'reminder'];
const evType = (t, def = 'homework') => (EVENT_TYPES.includes(t) ? t : def);
const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);
const str = (v, max = 1000) => String(v ?? '').slice(0, max);
const clampInt = (v, lo, hi, def) => { const n = parseInt(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
function todayCtx() { const today = new Date(); return { todayISO: isoDate(today), dow: today.toLocaleDateString('en-US', { weekday: 'long' }) }; }
// push a past date forward into the current/next school year (models love last year's dates)
function futureDate(dt, todayISO) { if (!isISODate(dt)) return null; if (dt >= todayISO) return dt; let y = +dt.slice(0, 4); const limit = +todayISO.slice(0, 4) + 2; while (dt < todayISO && y < limit) { y++; dt = y + dt.slice(4); } return dt; }
// plain-text excerpt of a Markdown transcript (list rows, search snippets)
function plain(text, n = 160) {
  let t = String(text || '');
  t = t.replace(/\[\[figure:\d+\]\]/gi, '🖼').replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (m, a, b) => (a || b || '').replace(/\\(frac|dfrac)\{([^}]*)\}\{([^}]*)\}/g, '$2/$3').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, ''))
    .replace(/^#+\s*/gm, '').replace(/[*_`>~]/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
// light page shape for lists (no transcript / figures / homework bodies)
const pageSummary = (p) => ({ id: p.id, notebookId: p.notebookId, index: p.index, title: p.title || '', status: p.status, rev: p.rev || 0, createdAt: p.createdAt, filter: p.filter, readability: p.readability || '', excerpt: plain(p.transcript, 150), topics: p.topics || [], keyPointsN: (p.keyPoints || []).length, vocabN: (p.vocab || []).length, figuresN: (p.figures || []).length, hasSuggestions: (p.suggestions || []).some(s => !s.done), hasHomework: !!p.homework, homeworkPercent: p.homework?.score?.percent });
// study set shape for the list view (no sheet / questions / chat bodies)
function studySummary(s) {
  const attempts = (s.tests || []).flatMap(t => t.attempts || []); const cards = s.cards || []; const now = Date.now();
  return { id: s.id, title: s.title, subject: s.subject || '', topic: s.topic || '', eventId: s.eventId || null, pageIds: s.pageIds || [], links: s.links || [], createdAt: s.createdAt, updatedAt: s.updatedAt,
    hasSheet: !!s.sheet, hasOnline: !!s.online, hasCram: !!s.cram, hasPlan: !!s.plan, graded: !!s.graded,
    testCount: (s.tests || []).length, attemptCount: attempts.length, best: attempts.length ? Math.max(...attempts.map(a => a.percent)) : null,
    cardCount: cards.length, cardsKnown: cards.filter(c => (c.box || 0) >= 1).length, cardsDue: cards.filter(c => (c.due || 0) <= now).length,
    planDone: s.plan ? s.plan.days.reduce((n, d) => n + d.tasks.filter(t => t.done).length, 0) : 0, planTotal: s.plan ? s.plan.days.reduce((n, d) => n + d.tasks.length, 0) : 0 };
}
const err = (res, code, msg) => res.status(code).json({ error: msg });

// ---------- auth ----------
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
// Sessions: "keep me logged in" = 60-day cookie that slides forward every time you use the app;
// unchecked = browser-session cookie. Server-side sessions expire after 90 days without use.
const REMEMBER_DAYS = 60;
const cookieStr = (token, req, remember) => `dwb_sid=${token}; Path=/; HttpOnly; SameSite=Lax${remember ? `; Max-Age=${60 * 60 * 24 * REMEMBER_DAYS}` : ''}${req.secure ? '; Secure' : ''}`;
app.use((req, res, next) => {
  const sid = parseCookies(req).dwb_sid;
  const s = sid && store.sessions.get(sid);
  req.user = s ? store.users.byId(s.userId) : null;
  req.sid = sid;
  if (s && req.user) {
    // slide the expiry: refresh cookie + lastSeen at most once a day
    if (!s.lastSeen || Date.now() - s.lastSeen > 24 * 3600 * 1000) {
      store.sessions.touch(sid);
      if (s.remember !== false) res.setHeader('Set-Cookie', cookieStr(sid, req, true));
    }
  }
  next();
});
const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Please log in' });
app.set('trust proxy', 1);
const setSession = (res, token, remember = true) => res.setHeader('Set-Cookie', cookieStr(token, res.req, remember));

app.get('/api/me', (req, res) => res.json({ v: BUILD_ID, user: req.user ? store.users.public(req.user) : null, ai: { mode: ai.BACKEND, model: ai.modelLabel(), available: ai.AVAILABLE, webSearch: ai.HAS_WEB_SEARCH }, storage: store.backendName() }));

app.post('/api/auth/register', (req, res) => {
  const { username, password, name } = req.body || {};
  if (!username || !/^[\w.-]{2,32}$/.test(username)) return res.status(400).json({ error: 'Username: 2–32 letters/numbers/._-' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  if (store.users.find(username)) return res.status(409).json({ error: 'That username is taken' });
  const u = store.users.create({ username, password, name });
  const remember = req.body.remember !== false;
  setSession(res, store.sessions.create(u.id, remember), remember);
  res.json({ user: store.users.public(u) });
});
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = username && store.users.find(username);
  if (!u || !store.users.verify(u, password || '')) return res.status(401).json({ error: 'Wrong username or password' });
  const remember = req.body.remember !== false;
  setSession(res, store.sessions.create(u.id, remember), remember);
  res.json({ user: store.users.public(u) });
});
app.post('/api/auth/logout', (req, res) => { if (req.sid) store.sessions.destroy(req.sid); res.setHeader('Set-Cookie', 'dwb_sid=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.patch('/api/me', auth, (req, res) => {
  const { name, settings } = req.body || {};
  const patch = {};
  if (typeof name === 'string' && name.trim()) patch.name = name.trim().slice(0, 60);
  if (settings && typeof settings === 'object') patch.settings = { ...(req.user.settings || {}), ...settings };
  store.users.update(req.user, patch);
  res.json({ user: store.users.public(req.user) });
});
app.post('/api/auth/password', auth, (req, res) => {
  const { current, password } = req.body || {};
  if (!store.users.verify(req.user, String(current || ''))) return err(res, 401, 'Current password is wrong');
  if (!password || password.length < 4) return err(res, 400, 'New password must be at least 4 characters');
  store.users.setPassword(req.user, password);
  store.sessions.destroyAllFor(req.user.id, req.sid); // log out other devices
  res.json({ ok: true });
});

// ---------- home: everything the dashboard needs in one request ----------
app.get('/api/home', auth, (req, res) => {
  const d = store.db(req.user.id); const today = isISODate(req.query.today) ? req.query.today : isoDate(); const now = Date.now();
  const counts = store.scannedCounts(d);
  const notebooks = d.notebooks.map(n => ({ ...n, scanned: counts[n.id] || 0 })).sort((a, b) => b.updatedAt - a.updatedAt);
  const recent = d.pages.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map(p => { const nb = store.findNb(d, p.notebookId); return { ...pageSummary(p), notebook: nb?.name || '', color: nb?.color || 'navy' }; });
  const events = d.events.filter(e => !e.done && e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  const study = d.study.map(studySummary).sort((a, b) => b.updatedAt - a.updatedAt);
  const due = study.reduce((n, s) => n + s.cardsDue, 0), totalCards = study.reduce((n, s) => n + s.cardCount, 0);
  const planToday = []; for (const s of d.study) for (const day of s.plan?.days || []) if (day.date === today) for (const t of day.tasks) planToday.push({ ...t, setId: s.id, set: s.title });
  const streak = streakOf(d);
  res.json({ notebooks, recent, events: events.slice(0, 8), study: study.slice(0, 4), review: { due, total: totalCards }, planToday, streak, trash: d.trash.length });
});
function streakOf(d) {
  const set = new Set(Object.keys(d.activity || {}));
  const today = isoDate(), yest = isoDate(new Date(Date.now() - 86400000));
  let streak = 0, cur = set.has(today) ? today : set.has(yest) ? yest : null;
  while (cur && set.has(cur)) { streak++; cur = isoDate(new Date(Date.parse(cur) - 86400000)); }
  return streak;
}

// ---------- activity log (for progress & streaks) ----------
function logActivity(userId, kind, n = 1) {
  const d = store.db(userId); d.activity ||= {};
  const day = new Date().toISOString().slice(0, 10);
  d.activity[day] ||= {}; d.activity[day][kind] = (d.activity[day][kind] || 0) + n;
  store.save(userId);
}
app.get('/api/progress', auth, (req, res) => {
  const d = store.db(req.user.id);
  const days = Object.keys(d.activity || {}).sort();
  // streak: consecutive days with any activity ending today or yesterday
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let streak = 0; let best = 0, run = 0, prev = null;
  const set = new Set(days);
  let cur = set.has(today) ? today : set.has(yest) ? yest : null;
  while (cur && set.has(cur)) { streak++; cur = new Date(Date.parse(cur) - 86400000).toISOString().slice(0, 10); }
  for (const dd of days) { if (prev && Date.parse(dd) - Date.parse(prev) === 86400000) run++; else run = 1; best = Math.max(best, run); prev = dd; }
  const tests = [];
  for (const st of d.study) for (const t of st.tests || []) for (const a of t.attempts || []) tests.push({ at: a.at, percent: a.percent, subject: st.subject || '', set: st.title, test: t.title, setId: st.id });
  tests.sort((a, b) => a.at - b.at);
  const cards = d.study.reduce((acc, st) => { for (const c of st.cards || []) { acc.total++; if ((c.box || 0) >= 1) acc.known++; } return acc; }, { total: 0, known: 0 });
  const bySubject = {};
  for (const t of tests) { const k = t.subject || 'Other'; bySubject[k] ||= { n: 0, sum: 0, last: null }; bySubject[k].n++; bySubject[k].sum += t.percent; bySubject[k].last = t.percent; }
  const upcoming = d.events.filter(e => !e.done && e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  res.json({ activity: d.activity || {}, streak, best, tests: tests.slice(-60), cards, bySubject, pages: d.pages.length, notebooks: d.notebooks.length, upcoming });
});

// ---------- push reminders ----------
app.get('/api/push/key', auth, (req, res) => res.json({ key: notify.publicKey(), subscribed: (req.user.push || []).length > 0, reminders: req.user.settings?.reminders || {} }));
app.post('/api/push/subscribe', auth, (req, res) => {
  const { subscription, tz } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ error: 'bad subscription' });
  const list = (req.user.push || []).filter(s => s.subscription?.endpoint !== subscription.endpoint);
  list.push({ subscription, tz: Number(tz) || 0, ua: String(req.headers['user-agent'] || '').slice(0, 120), at: Date.now() });
  store.users.update(req.user, { push: list.slice(-6) });
  res.json({ ok: true, count: list.length });
});
app.delete('/api/push/subscribe', auth, (req, res) => {
  const endpoint = req.body?.endpoint;
  store.users.update(req.user, { push: endpoint ? (req.user.push || []).filter(s => s.subscription?.endpoint !== endpoint) : [] });
  res.json({ ok: true });
});
app.get('/api/sms/status', auth, (req, res) => res.json({ configured: notify.smsConfigured(), phone: req.user.settings?.sms?.phone || '', verified: !!req.user.settings?.sms?.verified, enabled: req.user.settings?.sms?.enabled !== false }));
app.post('/api/sms/start', auth, async (req, res) => {
  if (!notify.smsConfigured()) return res.status(400).json({ error: 'Text messages are not set up on this server yet (needs a Twilio account).' });
  const phone = String(req.body.phone || '').replace(/[^\d+]/g, '');
  if (!/^\+?\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'Enter a phone number like +1 555 123 4567' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  store.users.update(req.user, { settings: { ...(req.user.settings || {}), tz: Number(req.body.tz) || 0, sms: { phone: phone.startsWith('+') ? phone : '+1' + phone, verified: false, enabled: true, code, codeAt: Date.now() } } });
  try { await notify.sms(req.user.settings.sms.phone, `WorkBook code: ${code}`); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: 'Could not send: ' + e.message }); }
});
app.post('/api/sms/verify', auth, (req, res) => {
  const sms = req.user.settings?.sms; const code = String(req.body.code || '');
  if (!sms?.code || sms.code !== code || Date.now() - sms.codeAt > 15 * 60000) return res.status(400).json({ error: 'Wrong or expired code' });
  store.users.update(req.user, { settings: { ...(req.user.settings || {}), sms: { ...sms, verified: true, code: null } } });
  res.json({ ok: true });
});
app.post('/api/sms/toggle', auth, (req, res) => { const sms = req.user.settings?.sms || {}; store.users.update(req.user, { settings: { ...(req.user.settings || {}), sms: { ...sms, enabled: !!req.body.enabled } } }); res.json({ ok: true }); });
app.delete('/api/sms', auth, (req, res) => { const st = { ...(req.user.settings || {}) }; delete st.sms; store.users.update(req.user, { settings: st }); res.json({ ok: true }); });
app.post('/api/push/test', auth, async (req, res) => {
  const n = await notify.send(req.user, { title: '🔔 WorkBook reminders are on', body: 'You’ll get a nudge 3 days before, the day before, and the morning of each test.', url: '/#/planner', tag: 'test' });
  res.json({ sent: n });
});

// ---------- sharing (read-only links, no login needed) ----------
function getShares() { return store.shares(); }
app.post('/api/share', auth, (req, res) => {
  const { kind, id } = req.body || {};
  const d = store.db(req.user.id);
  if (!(kind === 'notebook' && d.notebooks.find(n => n.id === id)) && !(kind === 'study' && d.study.find(x => x.id === id))) return res.status(404).json({ error: 'Not found' });
  const shares = getShares();
  let tok = Object.keys(shares).find(t => shares[t].userId === req.user.id && shares[t].kind === kind && shares[t].id === id);
  if (!tok) { tok = crypto.randomBytes(9).toString('base64url'); shares[tok] = { userId: req.user.id, kind, id, createdAt: Date.now(), by: req.user.name || req.user.username }; store.saveShares(); }
  res.json({ token: tok, url: `${req.protocol}://${req.get('host')}/#/s/${tok}` });
});
app.delete('/api/share/:token', auth, (req, res) => { const shares = getShares(); if (shares[req.params.token]?.userId === req.user.id) { delete shares[req.params.token]; store.saveShares(); } res.json({ ok: true }); });
app.get('/api/shares', auth, (req, res) => { const shares = getShares(); res.json(Object.entries(shares).filter(([, v]) => v.userId === req.user.id).map(([token, v]) => ({ token, ...v }))); });
function sharedCtx(req, res) {
  const sh = getShares()[req.params.token];
  if (!sh) { res.status(404).json({ error: 'This link is no longer valid' }); return null; }
  return { sh, d: store.db(sh.userId) };
}
app.get('/api/shared/:token', (req, res) => {
  const c = sharedCtx(req, res); if (!c) return;
  const { sh, d } = c;
  if (sh.kind === 'notebook') {
    const nb = d.notebooks.find(n => n.id === sh.id); if (!nb) return res.status(404).json({ error: 'Gone' });
    const pages = d.pages.filter(p => p.notebookId === nb.id).sort((a, b) => a.index - b.index).map(p => ({ id: p.id, index: p.index, title: p.title, transcript: p.transcript, keyPoints: p.keyPoints, vocab: p.vocab, figures: p.figures || [], rev: p.rev || 0 }));
    return res.json({ kind: 'notebook', by: sh.by, notebook: { id: nb.id, name: nb.name, subject: nb.subject, color: nb.color, pages } });
  }
  const st = d.study.find(x => x.id === sh.id); if (!st) return res.status(404).json({ error: 'Gone' });
  res.json({ kind: 'study', by: sh.by, study: { id: st.id, title: st.title, subject: st.subject, sheet: st.sheet, online: st.online, cards: (st.cards || []).map(c => ({ id: c.id, front: c.front, back: c.back, hint: c.hint })), tests: (st.tests || []).map(t => ({ id: t.id, title: t.title, description: t.description, style: t.style, questions: t.questions.map(q => ({ id: q.id, type: q.type, question: q.question, choices: q.choices, hint: q.hint })) })) } });
});
app.get('/api/shared/:token/image/:pageId', async (req, res) => {
  const c = sharedCtx(req, res); if (!c) return;
  const { sh, d } = c;
  const p = d.pages.find(p => p.id === req.params.pageId && (sh.kind === 'notebook' ? p.notebookId === sh.id : (d.study.find(x => x.id === sh.id)?.pageIds || []).includes(p.id)));
  if (!p) return res.status(404).end();
  const kind = ['enh', 'thumb'].includes(req.query.kind) ? req.query.kind : 'enh';
  const buf = await store.readImage(sh.userId, p.id, kind) || await store.readImage(sh.userId, p.id, 'enh');
  if (!buf) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'public, max-age=3600'); res.send(buf);
});
// save your own copy of something a friend shared (study set: tests/cards reset; notebook: pages + images copied)
app.post('/api/shared/:token/copy', auth, async (req, res) => {
  const c = sharedCtx(req, res); if (!c) return;
  const { sh, d } = c; const mine = store.db(req.user.id);
  try {
    if (sh.kind === 'study') {
      const st = d.study.find(x => x.id === sh.id); if (!st) return err(res, 404, 'Gone');
      const copy = { ...st, id: store.uid(), title: st.title + (sh.userId === req.user.id ? ' (copy)' : ''), pageIds: [], eventId: null, chat: [], plan: null, cram: st.cram || null, createdAt: Date.now(), updatedAt: Date.now(), copiedFrom: sh.by || '',
        cards: (st.cards || []).map(k => ({ id: store.uid(), front: k.front, back: k.back, hint: k.hint || '', box: 0, seen: 0, due: 0 })),
        tests: (st.tests || []).map(t => ({ ...t, id: store.uid(), attempts: [] })) };
      mine.study.push(copy); store.save(req.user.id);
      return res.json({ kind: 'study', id: copy.id });
    }
    const nb = d.notebooks.find(n => n.id === sh.id); if (!nb) return err(res, 404, 'Gone');
    const nb2 = { ...nb, id: store.uid(), name: nb.name + (sh.userId === req.user.id ? ' (copy)' : ''), createdAt: Date.now(), updatedAt: Date.now() };
    mine.notebooks.push(nb2);
    for (const p of store.pagesOf(d, nb.id)) { const p2 = { ...p, id: store.uid(), notebookId: nb2.id, homework: undefined, chat: undefined, createdAt: Date.now() }; await store.copyImages(sh.userId, p.id, req.user.id, p2.id); mine.pages.push(p2); }
    store.save(req.user.id);
    res.json({ kind: 'notebook', id: nb2.id });
  } catch (e) { console.error('copy shared:', e.message); err(res, 500, e.message); }
});
// a friend can take a shared practice test (graded, not saved)
app.post('/api/shared/:token/grade/:tid', async (req, res) => {
  const c = sharedCtx(req, res); if (!c) return;
  const { sh, d } = c; if (sh.kind !== 'study') return res.status(400).json({ error: 'Not a study set' });
  const st = d.study.find(x => x.id === sh.id); const test = st?.tests.find(t => t.id === req.params.tid);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  req.body.dryRun = true; req.params.id = st.id;
  // reuse the grading logic by faking the owner
  req.user = store.users.byId(sh.userId);
  return gradeHandler(req, res);
});

// ---------- notebooks & pages ----------
const publicPage = (p) => ({ ...p });
app.get('/api/notebooks', auth, (req, res) => {
  const d = store.db(req.user.id); const counts = store.scannedCounts(d);
  res.json(d.notebooks.map(n => ({ ...n, scanned: counts[n.id] || 0 })));
});
// all vocab across a notebook (deduped by term), newest page first
app.get('/api/notebooks/:id/vocab', auth, (req, res) => {
  const d = store.db(req.user.id); const nb = store.findNb(d, req.params.id); if (!nb) return err(res, 404, 'Not found');
  const seen = new Set(); const out = [];
  for (const p of store.pagesOf(d, nb.id)) for (const v of p.vocab || []) { const k = String(v.term).toLowerCase().trim(); if (!k || seen.has(k)) continue; seen.add(k); out.push({ term: v.term, definition: v.definition || '', pageId: p.id, pageIndex: p.index }); }
  res.json(out);
});
// flashcards straight from the vocab the AI already found (no AI call needed)
function vocabCards(pages, existing = []) {
  const have = new Set(existing.map(c => String(c.front).toLowerCase().trim())); const out = [];
  for (const p of pages) for (const v of p.vocab || []) { const k = String(v.term).toLowerCase().trim(); if (!k || have.has(k) || !v.definition) continue; have.add(k); out.push({ id: store.uid(), front: v.term, back: v.definition, hint: '', box: 0, seen: 0, due: 0, fromPage: p.id }); }
  return out;
}
app.post('/api/notebooks/:id/vocab-cards', auth, (req, res) => {
  const d = store.db(req.user.id); const nb = store.findNb(d, req.params.id); if (!nb) return err(res, 404, 'Not found');
  const pages = store.pagesOf(d, nb.id); const cards = vocabCards(pages);
  if (!cards.length) return err(res, 400, 'No vocabulary found in this notebook yet — scan pages with terms and definitions first.');
  const s = { id: store.uid(), title: `Vocab: ${nb.name}`, subject: nb.subject || '', topic: 'Vocabulary from ' + nb.name, pageIds: pages.map(p => p.id), eventId: null, sheet: '', online: '', tests: [], cards, chat: [], links: [], createdAt: Date.now(), updatedAt: Date.now() };
  d.study.push(s); store.save(req.user.id); logActivity(req.user.id, 'cards');
  res.json({ id: s.id, cards: cards.length });
});
app.post('/api/notebooks', auth, (req, res) => {
  const { name, subject, color, pageCount, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const d = store.db(req.user.id);
  const nb = { id: store.uid(), name: name.trim().slice(0, 80), subject: (subject || '').trim().slice(0, 60), color: color || 'navy', pageCount: Math.max(0, Math.min(500, parseInt(pageCount) || 0)), description: (description || '').slice(0, 500), createdAt: Date.now(), updatedAt: Date.now() };
  d.notebooks.push(nb); store.save(req.user.id);
  res.json({ ...nb, scanned: 0 });
});
// ?lite=1 → page summaries (lists / pickers); default → full pages (slideshow, print, export)
app.get('/api/notebooks/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  const nb = store.findNb(d, req.params.id);
  if (!nb) return err(res, 404, 'Not found');
  const pages = store.pagesOf(d, nb.id).map(req.query.lite ? pageSummary : publicPage);
  const topics = {}; if (req.query.lite) for (const p of pages) for (const t of p.topics || []) topics[t] = (topics[t] || 0) + 1;
  res.json({ ...nb, scanned: pages.length, pages, topics: Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([t, n]) => ({ t, n })) });
});
app.patch('/api/notebooks/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  const nb = d.notebooks.find(n => n.id === req.params.id);
  if (!nb) return res.status(404).json({ error: 'Not found' });
  const { name, subject, color, pageCount, description } = req.body || {};
  if (name) nb.name = String(name).trim().slice(0, 80);
  if (subject !== undefined) nb.subject = String(subject).trim().slice(0, 60);
  if (color) nb.color = color;
  if (pageCount !== undefined) nb.pageCount = Math.max(0, Math.min(500, parseInt(pageCount) || 0));
  if (description !== undefined) nb.description = String(description).slice(0, 500);
  nb.updatedAt = Date.now(); store.save(req.user.id);
  res.json(nb);
});
// delete → trash (30 days, restorable); images are only removed when the trash is purged
app.delete('/api/notebooks/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  const nb = store.findNb(d, req.params.id); if (!nb) return err(res, 404, 'Not found');
  const item = store.trashNotebook(d, nb); store.save(req.user.id);
  res.json({ ok: true, trashId: item.id });
});
app.get('/api/trash', auth, (req, res) => {
  const d = store.db(req.user.id);
  res.json({ days: store.TRASH_DAYS, items: d.trash.map(t => ({ id: t.id, kind: t.kind, deletedAt: t.deletedAt, title: t.kind === 'page' ? (t.page.title || 'Page ' + t.page.index) : t.notebook.name, sub: t.kind === 'page' ? t.notebookName : `${t.pages.length} page${t.pages.length === 1 ? '' : 's'}`, color: t.kind === 'page' ? t.notebookColor : t.notebook.color, pageId: t.kind === 'page' ? t.page.id : t.pages[0]?.id, rev: t.kind === 'page' ? (t.page.rev || 0) : 0 })) });
});
app.post('/api/trash/:id/restore', auth, (req, res) => {
  const d = store.db(req.user.id); const r = store.restoreTrash(d, req.params.id);
  if (!r) return err(res, 404, 'Not in trash any more');
  store.save(req.user.id); res.json(r.kind === 'page' ? { kind: 'page', pageId: r.page.id, notebookId: r.notebook.id } : { kind: 'notebook', notebookId: r.notebook.id });
});
app.delete('/api/trash/:id', auth, async (req, res) => {
  const d = store.db(req.user.id); const item = d.trash.find(t => t.id === req.params.id); if (!item) return err(res, 404, 'Not found');
  await store.purgeTrashItem(req.user.id, item); d.trash.splice(d.trash.indexOf(item), 1); store.save(req.user.id); res.json({ ok: true });
});
app.delete('/api/trash', auth, async (req, res) => { const n = await store.purgeTrash(req.user.id, true); res.json({ ok: true, purged: n }); });

// Save a scanned page. Images can come inline as data URLs (legacy) or be uploaded afterwards as raw JPEG
// bodies to PUT /api/pages/:id/image/:kind (cheaper: no base64, no 40MB JSON parse). AI runs separately.
app.post('/api/notebooks/:id/pages', auth, async (req, res) => {
  const d = store.db(req.user.id);
  const nb = store.findNb(d, req.params.id);
  if (!nb) return err(res, 404, 'Not found');
  const { original, enhanced, thumb, index, filter, source } = req.body || {};
  const idx = Number.isInteger(index) && index > 0 ? index : store.nextIndex(d, nb.id);
  const page = { id: store.uid(), notebookId: nb.id, index: idx, filter: filter || 'enhanced', title: '', transcript: '', keyPoints: [], vocab: [], status: 'scanned', source: source === 'pdf' ? 'pdf' : undefined, createdAt: Date.now() };
  try {
    if (enhanced) await store.saveImage(req.user.id, page.id, 'enh', enhanced);
    if (original) await store.saveImage(req.user.id, page.id, 'orig', original);
    if (thumb) await store.saveImage(req.user.id, page.id, 'thumb', thumb);
  } catch (e) { console.error('save image:', e.message); return err(res, 400, e.message); }
  d.pages.push(page); nb.updatedAt = Date.now(); logActivity(req.user.id, 'scan');
  store.save(req.user.id);
  res.json(publicPage(page));
});
const rawImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '25mb' });
app.put('/api/pages/:id/image/:kind', auth, rawImage, async (req, res) => {
  const d = store.db(req.user.id); const p = store.findPage(d, req.params.id); if (!p) return err(res, 404, 'Not found');
  if (!Buffer.isBuffer(req.body) || !req.body.length) return err(res, 400, 'Send the image as the raw request body (Content-Type: image/jpeg)');
  try { await store.saveImageBuffer(req.user.id, p.id, req.params.kind, req.body); } catch (e) { return err(res, 400, e.message); }
  if (req.params.kind === 'enh') { p.rev = (p.rev || 0) + 1; if (req.query.filter) p.filter = String(req.query.filter); }
  store.save(req.user.id); res.json({ ok: true, rev: p.rev || 0 });
});
app.post('/api/notebooks/:id/reorder', auth, (req, res) => {
  const d = store.db(req.user.id);
  const nb = d.notebooks.find(n => n.id === req.params.id);
  if (!nb) return res.status(404).json({ error: 'Not found' });
  const ids = Array.isArray(req.body.pageIds) ? req.body.pageIds : [];
  const pages = d.pages.filter(p => p.notebookId === nb.id);
  const ordered = [...ids.map(id => pages.find(p => p.id === id)).filter(Boolean), ...pages.filter(p => !ids.includes(p.id)).sort((a, b) => a.index - b.index)];
  ordered.forEach((p, i) => { p.index = i + 1; });
  nb.updatedAt = Date.now(); store.save(req.user.id);
  res.json({ ok: true, pages: ordered.map(p => ({ id: p.id, index: p.index })) });
});
// page + its notebook with page *summaries* (the viewer only needs titles/ids for prev/next)
app.get('/api/pages/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  const p = store.findPage(d, req.params.id);
  if (!p) return err(res, 404, 'Not found');
  const nb = store.findNb(d, p.notebookId);
  const pages = store.pagesOf(d, p.notebookId).map(pageSummary);
  res.json({ page: publicPage(p), notebook: { ...nb, scanned: pages.length, pages } });
});
app.get('/api/pages/:id/image', auth, async (req, res) => {
  const d = store.db(req.user.id);
  const p = d.pages.find(p => p.id === req.params.id);
  if (!p) return res.status(404).end();
  const kind = ['orig', 'enh', 'thumb'].includes(req.query.kind) ? req.query.kind : 'enh';
  try {
    let buf = await store.readImage(req.user.id, p.id, kind);
    if (!buf && kind !== 'enh') buf = await store.readImage(req.user.id, p.id, 'enh');
    if (!buf) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(buf);
  } catch (e) { console.error('image:', e.message); res.status(500).end(); }
});
app.patch('/api/pages/:id', auth, async (req, res) => {
  const d = store.db(req.user.id);
  const p = d.pages.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { title, transcript, keyPoints, vocab, index, enhanced, thumb, filter, notebookId, suggestions, figures } = req.body || {};
  if (title !== undefined) p.title = String(title).slice(0, 120);
  if (Array.isArray(suggestions)) p.suggestions = suggestions.slice(0, 8);
  if (Array.isArray(figures)) p.figures = figures.slice(0, 12);
  if (notebookId && d.notebooks.find(n => n.id === notebookId) && notebookId !== p.notebookId) { p.notebookId = notebookId; p.index = d.pages.filter(x => x.notebookId === notebookId).reduce((m, x) => Math.max(m, x.index), 0) + 1; }
  if (thumb) await store.saveImage(req.user.id, p.id, 'thumb', thumb);
  if (transcript !== undefined) p.transcript = String(transcript);
  if (Array.isArray(keyPoints)) p.keyPoints = keyPoints;
  if (Array.isArray(vocab)) p.vocab = vocab;
  if (Number.isInteger(index) && index > 0) p.index = index;
  if (enhanced) { await store.saveImage(req.user.id, p.id, 'enh', enhanced); p.filter = filter || p.filter; p.rev = (p.rev || 0) + 1; }
  store.save(req.user.id);
  res.json(publicPage(p));
});
app.delete('/api/pages/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  const p = store.findPage(d, req.params.id); if (!p) return err(res, 404, 'Not found');
  const item = store.trashPage(d, p); store.save(req.user.id);
  res.json({ ok: true, trashId: item.id });
});
app.get('/api/recent', auth, (req, res) => {
  const d = store.db(req.user.id);
  const n = Math.min(30, parseInt(req.query.n) || 10);
  res.json(d.pages.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, n).map(p => { const nb = store.findNb(d, p.notebookId); return { ...pageSummary(p), notebook: nb?.name || '', color: nb?.color || 'navy' }; }));
});
// search pages (optionally inside one notebook), study sets and planner items
app.get('/api/search', auth, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const d = store.db(req.user.id);
  if (!q) return res.json({ pages: [], study: [], events: [] });
  const nbFilter = req.query.notebook ? String(req.query.notebook) : null;
  const pages = d.pages.filter(p => (!nbFilter || p.notebookId === nbFilter) && (p.title + ' ' + p.transcript + ' ' + (p.keyPoints || []).join(' ') + ' ' + (p.vocab || []).map(v => v.term).join(' ')).toLowerCase().includes(q))
    .map(p => { const nb = store.findNb(d, p.notebookId); const t = plain(p.transcript, 100000); const i = t.toLowerCase().indexOf(q); return { id: p.id, notebookId: p.notebookId, notebook: nb?.name, color: nb?.color || 'navy', index: p.index, title: p.title, rev: p.rev || 0, snippet: i >= 0 ? t.slice(Math.max(0, i - 60), i + 90) : t.slice(0, 150) }; });
  const study = nbFilter ? [] : d.study.filter(s => (s.title + ' ' + s.subject + ' ' + s.topic + ' ' + (s.cards || []).map(c => c.front).join(' ')).toLowerCase().includes(q)).map(s => ({ id: s.id, title: s.title, subject: s.subject || '', cards: (s.cards || []).length, tests: (s.tests || []).length }));
  const events = nbFilter ? [] : d.events.filter(e => (e.title + ' ' + e.subject + ' ' + e.notes).toLowerCase().includes(q)).map(e => ({ id: e.id, title: e.title, type: e.type, date: e.date, done: e.done }));
  res.json({ pages: pages.slice(0, 50), study: study.slice(0, 10), events: events.slice(0, 10) });
});


// Shared notation rules so every AI output renders nicely (KaTeX on the client).
const MATH_RULES = `MATH & SYMBOL NOTATION (very important — the app renders LaTeX):
- Write ALL math in LaTeX: inline $...$, big/centered $$...$$. Never write math as plain text like "3/4" or "x^2" when it is real math.
- Fractions: $\\frac{3}{4}$ (mixed numbers $2\\frac{1}{2}$). Repeating decimals: $0.\\overline{3}$, $1.2\\overline{45}$ (put the bar over exactly the repeating digits — a bar or dots drawn over digits means repeating).
- Exponents/roots: $x^{2}$, $2^{10}$, $\\sqrt{16}$, $\\sqrt[3]{27}$. Subscripts: $H_2O$, $a_n$.
- Symbols: $\\times$ (a handwritten × or ·), $\\div$, $\\pm$, $\\neq$, $\\le$, $\\ge$, $\\approx$, $\\infty$, $\\pi$, $\\theta$, $\\angle ABC$, $90^{\\circ}$, $\\triangle$, $\\perp$, $\\parallel$, $\\Rightarrow$, $\\rightarrow$, $\\%$, absolute value $|x|$.
- Equations & steps: one line per step, e.g. $2x + 3 = 11 \\Rightarrow 2x = 8 \\Rightarrow x = 4$. Keep the student's work order.
- Chemistry: $CO_2$, $H_2O \\rightarrow H_2 + O_2$. Units: $5\\,\\text{cm}$, $9.8\\,\\text{m/s}^2$.
- Long division, number lines, graphs, geometry sketches → describe briefly in *italics* like *(diagram: number line from 0 to 10, point at 3.5)*.
- Repeated symbols the student uses as shorthand (∴ therefore, ∵ because, ≈, ⇒, ✓, ★, ☐ checkboxes, arrows for cause→effect, "w/" for with, "b/c" for because) → keep their meaning: use $\\therefore$, $\\because$, ✓, →, and expand shorthand only when clearly meant as words.
- Tables in notes → Markdown tables. Circled/boxed/starred items → **bold** and keep the ★.`;

// ---------- AI: scanning ----------
const stripDataUrl = (s) => { const m = String(s).match(/^data:(image\/\w+);base64,(.+)$/); return m ? { mediaType: m[1], data: m[2] } : { mediaType: 'image/jpeg', data: s }; };

// Find the paper's corners in a photo. Returns fractions of width/height.
app.post('/api/ai/corners', auth, async (req, res) => {
  try {
    const img = stripDataUrl(req.body.image);
    const out = await ai.completeJSON({
      system: 'You are a precise document-scanner vision model. You locate the sheet of paper / notebook page in a photo.',
      images: [img],
      prompt: `Find the four corners of the main sheet of paper (the notebook page) in this photo. If the page fills the whole frame or you cannot see the edges, use the image edges.
Return ONLY JSON: {"found": true|false, "corners": {"tl":[x,y],"tr":[x,y],"br":[x,y],"bl":[x,y]}, "rotation": 0|90|180|270}
- x and y are FRACTIONS of the image width/height (0.0 to 1.0), measured on the image exactly as given (do not rotate first).
- tl/tr/br/bl = the page's top-left/top-right/bottom-right/bottom-left as the page would be read (so if the photo is sideways, tl is the top-left of the TEXT).
- rotation = how many degrees clockwise the image must be turned so the text reads upright.
Be as accurate as you can — these corners are used to crop and straighten the scan.`,
      maxTokens: 300, effort: 'low',
    });
    res.json(out);
  } catch (e) { console.error('corners:', e.message); res.status(500).json({ error: e.message }); }
});

// Read a page: transcript + title + key points + vocab.
app.post('/api/pages/:id/analyze', auth, async (req, res) => {
  const d = store.db(req.user.id);
  const p = d.pages.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const nb = d.notebooks.find(n => n.id === p.notebookId);
  const data = await store.readImageForAI(req.user.id, p.id);
  if (!data) return res.status(400).json({ error: 'No image' });
  p.status = 'analyzing'; store.save(req.user.id);
  const today = new Date(); const todayISO = today.toISOString().slice(0, 10);
  const dow = today.toLocaleDateString('en-US', { weekday: 'long' });
  try {
    const out = await ai.completeJSON({
      system: `You are an expert at reading students' handwritten and printed school notes (any subject: math, science, history, English, languages) and turning them into clean digital notes. Notebook: "${nb?.name || ''}" (subject: ${nb?.subject || 'unknown'}).\n${MATH_RULES}`,
      images: [{ mediaType: 'image/jpeg', data }],
      prompt: `Read this notebook page carefully — every line, including margins, boxes, arrows, and small notes. Then transcribe it into clean, well-organized Markdown that keeps the student's structure (headings, bullets, numbered steps, definitions, worked examples, formulas, tables). Rules:
- Be FAITHFUL: transcribe what is written; fix obvious spelling slips but do NOT add new content that isn't on the page.
- Follow the MATH & SYMBOL NOTATION rules exactly (fractions, repeating decimals, exponents, ×/÷, ≥, π, angles, degrees…). Every equation, fraction and formula must be LaTeX.
- Keep the student's color/emphasis cues: circled, boxed, starred, underlined or differently-colored items are important → **bold** them (keep ★ / ✓ marks). If a colored heading or label is used as a category, keep it as its own line/heading.
- PICTURES: if the page has drawings, diagrams, maps, graphs, charts, sketches or glued-in pictures, DO NOT describe them in words only — list each one in "figures" with a bounding box, and put the placeholder [[figure:N]] (N = 1-based index) in the transcript exactly where it appears, optionally followed by the student's caption. Boxes are fractions of the image width/height [x, y, w, h] measured on the image as given; add a little margin so nothing is cut off. Text-only pages have an empty figures list.
- DATES & TASKS: if the page mentions a test, quiz, exam, homework, project, due date or "study for…" (e.g. "TEST FRI", "quiz Thursday", "due 10/3", "HW p.42 tomorrow"), list each in "suggestions". Resolve relative days to real dates: today is ${dow} ${todayISO}; if the page itself is dated (e.g. "Sept 14"), resolve relative to that date. Dates must be in the FUTURE (this school year) — never a past year. If you can't resolve a date, leave "date" null but keep the text.
- If part is unreadable, write [unclear]. If the page is upside-down/sideways, still read it correctly.
Then return ONLY JSON:
{
 "title": "short title for this page (max 8 words)",
 "transcript": "the markdown transcript (with [[figure:N]] placeholders where pictures are)",
 "keyPoints": ["3-7 most important facts/ideas/formulas on this page (LaTeX for math)"],
 "vocab": [{"term":"...","definition":"..."}],
 "topics": ["1-4 short topic tags"],
 "figures": [{"label":"short name, e.g. 'Map of Europe 1914' or 'Diagram of a plant cell'","box":[0.1,0.4,0.5,0.3],"kind":"diagram|map|graph|drawing|photo|table"}],
 "suggestions": [{"title":"e.g. Ch. 5 Cell Test","type":"test|quiz|homework|project|reminder","date":"YYYY-MM-DD or null","dateText":"the words on the page, e.g. TEST FRI","notes":"what it says it covers"}],
 "readability": "good" | "fair" | "poor"
}`,
      maxTokens: 6000, effort: 'medium',
    });
    p.title = String(out.title || '').slice(0, 120);
    p.transcript = String(out.transcript || '');
    p.keyPoints = Array.isArray(out.keyPoints) ? out.keyPoints.map(String) : [];
    p.vocab = Array.isArray(out.vocab) ? out.vocab.filter(v => v && v.term).map(v => ({ term: String(v.term), definition: String(v.definition || '') })) : [];
    p.topics = Array.isArray(out.topics) ? out.topics.map(String) : [];
    p.figures = Array.isArray(out.figures) ? out.figures.filter(f => f && Array.isArray(f.box) && f.box.length === 4).map(f => { let [x, y, w, h] = f.box.map(Number); x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y)); w = Math.max(0.04, Math.min(1 - x, w)); h = Math.max(0.04, Math.min(1 - y, h)); return { label: String(f.label || 'Figure'), kind: String(f.kind || 'drawing'), box: [x, y, w, h] }; }).slice(0, 12) : [];
    const oldSug = Array.isArray(p.suggestions) ? p.suggestions : [];
    p.suggestions = Array.isArray(out.suggestions) ? out.suggestions.filter(sg => sg && sg.title).slice(0, 8).map(sg => { const prev = oldSug.find(o => o.title === sg.title); return { title: String(sg.title).slice(0, 120), type: ['test', 'quiz', 'homework', 'project', 'reminder'].includes(sg.type) ? sg.type : 'test', date: (() => { let dt = /^\d{4}-\d{2}-\d{2}$/.test(String(sg.date || '')) ? sg.date : null; if (dt && dt < todayISO) { let y = +dt.slice(0, 4); while (dt < todayISO && y < +todayISO.slice(0, 4) + 2) { y++; dt = y + dt.slice(4); } } return dt; })(), dateText: String(sg.dateText || ''), notes: String(sg.notes || '').slice(0, 500), done: !!prev?.done }; }) : [];
    p.readability = out.readability || '';
    p.status = 'ready';
    store.save(req.user.id);
    res.json(publicPage(p));
  } catch (e) {
    p.status = 'error'; store.save(req.user.id);
    console.error('analyze:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------- homework checker: vision extracts each problem + the student's answer, best text model verifies ----------
app.post('/api/pages/:id/check', auth, async (req, res) => {
  const d = store.db(req.user.id);
  const p = d.pages.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const nb = d.notebooks.find(n => n.id === p.notebookId);
  const data = await store.readImageForAI(req.user.id, p.id);
  if (!data) return res.status(400).json({ error: 'No image' });
  const hint = String(req.body.hint || '').slice(0, 500);
  try {
    // stage 1 — read the homework: every problem and exactly what the student wrote
    const ext = await ai.completeJSON({
      system: `You read students' homework pages precisely. Subject: ${nb?.subject || 'unknown'}. Output ONLY JSON.\n${MATH_RULES}`,
      images: [{ mediaType: 'image/jpeg', data }],
      prompt: `This is a student's homework/worksheet page. List EVERY problem or question on it, with the student's written answer and any work shown. Transcribe exactly what the student wrote (even if wrong). If a problem has no answer written, set studentAnswer to "". ${hint ? 'Context from the student: ' + hint : ''}
Return ONLY JSON: {"subject":"...","assignment":"short name if visible","items":[{"n":"1a","problem":"the question/problem as written (LaTeX for math)","studentAnswer":"what they wrote (LaTeX for math)","work":"any steps shown, brief"}]}`,
      maxTokens: 5000,
    });
    const items = (ext.items || []).slice(0, 60);
    if (!items.length) throw new Error("I couldn't find any problems with answers on this page. Make sure the homework (with your answers) is in the photo.");
    // stage 2 — check with the strongest reasoning model
    const chk = await ai.completeJSON({
      system: 'You are a meticulous, kind teacher checking homework. Solve each problem yourself first, then compare with the student\'s answer. Accept equivalent forms (3/4 = 0.75 = $\\\\frac{3}{4}$; unsimplified fractions only if the problem did not ask to simplify; different but correct wording). Output ONLY JSON.\n' + MATH_RULES,
      prompt: `Check this homework. For each item decide: "correct", "partial" (right idea / small slip) or "wrong" (or "blank" if no answer). Give the correct answer, and for anything not fully correct explain the mistake in 1-2 friendly sentences and show the key step. Then give an overall score and 2-4 concrete tips on what to practice.
Subject: ${ext.subject || nb?.subject || ''}${ext.assignment ? ' · ' + ext.assignment : ''}
ITEMS:
${JSON.stringify(items, null, 1)}
Return ONLY JSON: {"items":[{"n":"1a","verdict":"correct|partial|wrong|blank","correctAnswer":"...","explanation":"... (empty if correct)"}],"score":{"correct":0,"partial":0,"wrong":0,"blank":0,"percent":0},"tips":["..."],"summary":"one encouraging sentence"}`,
      maxTokens: 5000,
    });
    const byN = new Map((chk.items || []).map(c => [String(c.n), c]));
    const merged = items.map(it => { const c = byN.get(String(it.n)) || {}; return { n: String(it.n), problem: it.problem, studentAnswer: it.studentAnswer, work: it.work || '', verdict: ['correct', 'partial', 'wrong', 'blank'].includes(c.verdict) ? c.verdict : (it.studentAnswer ? 'wrong' : 'blank'), correctAnswer: c.correctAnswer || '', explanation: c.explanation || '' }; });
    // stage 3 — before anything stays marked wrong, look at the page AGAIN: misread handwriting is the #1 cause of unfair marks
    const flagged = merged.filter(m => (m.verdict === 'wrong' || m.verdict === 'partial') && m.studentAnswer);
    if (flagged.length) {
      try {
        const re = await ai.completeJSON({
          system: 'You double-check homework marks against the original page image. Misread handwriting (fractions, minus signs, repeating-decimal bars, messy digits) is the #1 cause of wrong marks. Output ONLY JSON.\n' + MATH_RULES,
          images: [{ mediaType: 'image/jpeg', data }],
          prompt: `A first checker marked these items wrong or partly wrong. Look at the page image again and for each: (1) verify the student's answer was READ correctly off the page — fix the transcription if not; (2) solve the problem yourself and re-verify the verdict against what the student ACTUALLY wrote. Return the FINAL verdict.\n${JSON.stringify(flagged.map(f => ({ n: f.n, problem: f.problem, studentAnswerAsRead: f.studentAnswer, verdict: f.verdict, correctAnswer: f.correctAnswer })), null, 1)}\nReturn ONLY JSON: {"items":[{"n":"1a","verdict":"correct|partial|wrong","studentAnswer":"fixed transcription ONLY if it was misread, else omit","correctAnswer":"...","explanation":"1-2 friendly sentences (empty if now correct)"}]}`,
          maxTokens: 3500, effort: 'medium',
        });
        for (const r of (re.items || [])) {
          const m = merged.find(x => x.n === String(r.n)); if (!m) continue;
          if (['correct', 'partial', 'wrong'].includes(r.verdict)) m.verdict = r.verdict;
          if (r.studentAnswer) m.studentAnswer = String(r.studentAnswer);
          if (r.correctAnswer) m.correctAnswer = String(r.correctAnswer);
          m.explanation = m.verdict === 'correct' ? '' : String(r.explanation || m.explanation);
        }
      } catch (e) { console.error('hw recheck:', e.message); }
    }
    const counts = { correct: 0, partial: 0, wrong: 0, blank: 0 };
    for (const m of merged) counts[m.verdict]++;
    const percent = merged.length ? Math.round(100 * (counts.correct + 0.5 * counts.partial) / merged.length) : 0;
    p.homework = { items: merged, score: { ...counts, percent }, tips: Array.isArray(chk.tips) ? chk.tips.map(String).slice(0, 6) : [], summary: String(chk.summary || ''), assignment: String(ext.assignment || ''), doubleChecked: flagged.length > 0, checkedAt: Date.now() };
    store.save(req.user.id);
    res.json(p.homework);
  } catch (e) { console.error('check:', e.message); res.status(500).json({ error: e.message }); }
});

// ---------- graded test → "fix what I missed" study set ----------
app.post('/api/pages/:id/graded', auth, async (req, res) => {
  const d = store.db(req.user.id);
  const p = d.pages.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const nb = d.notebooks.find(n => n.id === p.notebookId);
  const data = await store.readImageForAI(req.user.id, p.id);
  if (!data) return res.status(400).json({ error: 'No image' });
  try {
    const ext = await ai.completeJSON({
      system: `You read a student's returned, teacher-graded test or quiz precisely. Subject: ${nb?.subject || 'unknown'}. Output ONLY JSON.\n${MATH_RULES}`,
      images: [{ mediaType: 'image/jpeg', data }],
      prompt: `This is a graded test/quiz handed back by the teacher. Find the test name and score if visible. List every question with the student's answer and whether the TEACHER marked it wrong (✗, -1, circled, crossed out, red ink, a written correction) or right (✓, full points, untouched). For wrong ones include the teacher's correction if written and the concept being tested.
Return ONLY JSON: {"testName":"...","score":"e.g. 17/20 or 85% or empty","items":[{"n":"3","question":"...","studentAnswer":"...","markedWrong":true,"correction":"teacher's correction or the right answer if clear","concept":"short concept name, e.g. 'adding fractions with unlike denominators'"}],"missedConcepts":["2-6 short concept names the student needs to fix"]}`,
      maxTokens: 5000,
    });
    const items = ext.items || [];
    const missed = items.filter(i => i.markedWrong);
    if (!items.length) throw new Error("I couldn't find graded questions on this page — make sure the whole test with the teacher's marks is in the photo.");
    const topic = `FIX-IT SET from a graded test${ext.testName ? ' "' + ext.testName + '"' : ''}${ext.score ? ' (score ' + ext.score + ')' : ''}. The student MISSED these (focus practice here): ${missed.map(m => `Q${m.n}: ${m.question} — answered "${m.studentAnswer}"${m.correction ? ', correct: ' + m.correction : ''} [concept: ${m.concept || '?'}]`).join(' | ') || 'nothing marked wrong'}. Concepts to fix: ${(ext.missedConcepts || []).join(', ')}.`;
    const st = { id: store.uid(), title: `Fix: ${ext.testName || p.title || 'graded test'}`, subject: nb?.subject || '', topic, pageIds: [p.id], eventId: null, sheet: '', online: '', tests: [], cards: [], chat: [], graded: { testName: ext.testName || '', score: ext.score || '', items, missedConcepts: ext.missedConcepts || [] }, createdAt: Date.now(), updatedAt: Date.now() };
    d.study.push(st); store.save(req.user.id);
    res.json({ study: st, missed: missed.length, total: items.length });
  } catch (e) { console.error('graded:', e.message); res.status(500).json({ error: e.message }); }
});

// ---------- page AI tools: explain simply / summary / translate / practice questions (cached on the page) ----------
const PAGE_TOOLS = {
  explain: { label: 'Explain it simply', prompt: 'Explain everything on this page like a friendly tutor talking to a student who missed the class. Go idea by idea in the order of the notes, use simple words and one concrete example per idea, and finish with "The 3 things to remember". Markdown, LaTeX for math.' },
  summary: { label: 'Summary', prompt: 'Write a tight summary of this page: a 2-sentence overview, then 5-8 bullet points of the key facts/formulas, then any vocabulary as a short list. Markdown, LaTeX for math.' },
  questions: { label: 'Practice questions', prompt: 'Write 6 practice questions that test exactly what is on this page (mix of recall and apply), then an "Answers" section with short worked answers. Markdown, LaTeX for math.' },
  translate: { label: 'Translate', prompt: (lang) => `Translate the full notes on this page into ${lang}. Keep the same structure (headings, bullets, tables) and keep math/formulas exactly as LaTeX. After the translation add a short glossary of 5-10 key terms as "term → translation".` },
};
app.post('/api/pages/:id/tool', auth, async (req, res) => {
  const d = store.db(req.user.id); const p = store.findPage(d, req.params.id); if (!p) return err(res, 404, 'Not found');
  const tool = PAGE_TOOLS[req.body.tool]; if (!tool) return err(res, 400, 'Unknown tool');
  const lang = str(req.body.lang || 'Spanish', 40); const key = req.body.tool + (req.body.tool === 'translate' ? ':' + lang : '');
  p.tools ||= {};
  if (p.tools[key] && !req.body.fresh) return res.json({ key, text: p.tools[key].text, at: p.tools[key].at, cached: true });
  if (!p.transcript) return err(res, 400, 'This page has no digital copy yet — press Re-read first.');
  const nb = store.findNb(d, p.notebookId);
  try {
    const text = await ai.complete({ system: `You help a student understand their own notebook notes. Notebook: "${nb?.name || ''}" (subject: ${nb?.subject || 'unknown'}). Write clear Markdown.\n${MATH_RULES}`, prompt: `${typeof tool.prompt === 'function' ? tool.prompt(lang) : tool.prompt}\n\nTHE PAGE (${p.title || 'untitled'}):\n${p.transcript}${p.keyPoints?.length ? '\n\nKEY POINTS: ' + p.keyPoints.join(' | ') : ''}`, maxTokens: 3500, effort: 'low' });
    p.tools[key] = { text, at: Date.now() }; store.save(req.user.id);
    res.json({ key, text, at: p.tools[key].at });
  } catch (e) { console.error('page tool:', e.message); err(res, 500, e.message); }
});
// "Ask about this page" — a tutor chat scoped to one page (SSE)
app.post('/api/pages/:id/ask', auth, async (req, res) => {
  const d = store.db(req.user.id); const p = store.findPage(d, req.params.id); if (!p) return err(res, 404, 'Not found');
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return err(res, 400, 'messages required');
  const nb = store.findNb(d, p.notebookId);
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.flushHeaders();
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  let reply = '';
  try {
    await ai.stream({
      system: `You are a patient tutor helping a student with ONE page of their notes (notebook "${nb?.name || ''}", subject ${nb?.subject || 'unknown'}). Answer from the page first; add background only when needed and say so. Keep replies short, use Markdown, write math in LaTeX ($...$). Sometimes end with a quick check question.\n${MATH_RULES}\n\nTHE PAGE (${p.title || 'untitled'}):\n${p.transcript || '(no digital copy)'}${p.keyPoints?.length ? '\n\nKEY POINTS: ' + p.keyPoints.join(' | ') : ''}`,
      messages: messages.slice(-12).map(m => ({ role: m.role, content: String(m.content) })),
      onText: (t) => { reply += t; send({ t }); },
    });
    p.chat = [...messages.slice(-30), { role: 'assistant', content: reply }].slice(-30); store.save(req.user.id);
  } catch (e) { send({ error: 'AI error: ' + e.message }); }
  send({ done: true }); res.end();
});

// ---------- assignment breakdown: homework/project → small steps with time estimates ----------
app.post('/api/events/:id/breakdown', auth, async (req, res) => {
  const d = store.db(req.user.id); const ev = store.findEvent(d, req.params.id); if (!ev) return err(res, 404, 'Not found');
  try {
    const out = await ai.completeJSON({ system: 'You are a study coach who breaks school assignments into small, concrete steps a student can check off. Output ONLY JSON.',
      prompt: `Assignment: "${ev.title}" (${ev.type}${ev.subject ? ', ' + ev.subject : ''}), due ${ev.date}. Notes from the student: ${ev.notes || '(none)'}. Today is ${isoDate()}.
Break it into 3-8 concrete steps in order, each doable in one sitting, with a realistic minute estimate. If it is a test/quiz, the steps are a study plan (review notes, flashcards, practice test, weak spots, final review).
Return ONLY JSON: {"subtasks":[{"text":"...","minutes":20}]}`, maxTokens: 800, effort: 'low' });
    ev.subtasks = (out.subtasks || []).filter(s => s && s.text).slice(0, 10).map(s => ({ id: store.uid(), text: str(s.text, 140), minutes: clampInt(s.minutes, 5, 240, 20), done: false }));
    store.save(req.user.id); res.json({ subtasks: ev.subtasks });
  } catch (e) { console.error('breakdown:', e.message); err(res, 500, e.message); }
});

// ---------- cram mode: one compact 20-minute plan ----------
app.post('/api/study/:id/cram', auth, async (req, res) => {
  const [d, s] = getStudy(req, res); if (!s) return;
  try {
    const out = await ai.completeJSON({
      system: 'You are a study coach making a laser-focused last-minute review. Output ONLY JSON. Inside JSON strings, write math as LaTeX with $...$ (escape backslashes as \\\\).\n' + MATH_RULES,
      prompt: `${studyContext(d, s)}\n\nThe test is SOON. Build a 20-minute cram plan with exactly: 6 "mustKnow" points (the highest-yield facts/formulas, one line each), 10 flashcards (hardest, most-tested material), and 5 "hardQuestions" (short-answer, the kind that separate A from B, with model answers and a one-line solution). Also 3 "traps" (common mistakes to avoid on this test).
Return ONLY JSON: {"mustKnow":["..."],"cards":[{"front":"...","back":"..."}],"hardQuestions":[{"question":"...","answer":"...","why":"..."}],"traps":["..."]}`,
      maxTokens: 5000,
    });
    s.cram = { mustKnow: (out.mustKnow || []).map(String).slice(0, 8), cards: (out.cards || []).filter(c => c && c.front).slice(0, 12), hardQuestions: (out.hardQuestions || []).filter(q => q && q.question).slice(0, 6), traps: (out.traps || []).map(String).slice(0, 5), createdAt: Date.now() };
    s.updatedAt = Date.now(); store.save(req.user.id); logActivity(req.user.id, 'study');
    res.json(s.cram);
  } catch (e) { console.error('cram:', e.message); res.status(500).json({ error: e.message }); }
});

// ---------- planner: AI extraction from a photo of a paper planner / syllabus, and natural-language quick add ----------
app.post('/api/planner/extract', auth, async (req, res) => {
  try {
    const img = stripDataUrl(req.body.image);
    const today = new Date(); const todayISO = today.toISOString().slice(0, 10); const dow = today.toLocaleDateString('en-US', { weekday: 'long' });
    const out = await ai.completeJSON({
      system: 'You read photos of student planners, agendas, syllabi, assignment sheets and whiteboards and extract every dated item. Output ONLY JSON.',
      images: [img],
      prompt: `Extract EVERY assignment, test, quiz, project, due date or event written on this page. Today is ${dow} ${todayISO}. Resolve days/dates to real dates in the FUTURE school year (if a date is written like 10/3 or "Fri" figure out the actual date; planners are usually laid out as a week — use the week's dates if shown). Keep titles short but specific (include the subject if it's written, e.g. "Math p.42 #1-20"). If no date can be determined, set date to null and include dateText.
Return ONLY JSON: {"items":[{"title":"...","type":"test|quiz|homework|project|reminder","subject":"class/subject if visible or empty","date":"YYYY-MM-DD or null","dateText":"as written","notes":"extra details"}]}`,
      maxTokens: 4000,
    });
    const items = (out.items || []).filter(i => i && i.title).slice(0, 40).map(i => ({ title: String(i.title).slice(0, 120), type: ['test', 'quiz', 'homework', 'project', 'reminder'].includes(i.type) ? i.type : 'homework', subject: String(i.subject || '').slice(0, 60), date: /^\d{4}-\d{2}-\d{2}$/.test(String(i.date || '')) ? i.date : null, dateText: String(i.dateText || ''), notes: String(i.notes || '').slice(0, 300) }));
    res.json({ items });
  } catch (e) { console.error('planner extract:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/planner/parse', auth, async (req, res) => {
  try {
    const text = String(req.body.text || '').slice(0, 300);
    const today = new Date(); const todayISO = today.toISOString().slice(0, 10); const dow = today.toLocaleDateString('en-US', { weekday: 'long' });
    const out = await ai.completeJSON({ system: 'You turn a short note into a planner item. Output ONLY JSON.', prompt: `Today is ${dow} ${todayISO}. Note: "${text}"\nReturn ONLY JSON: {"title":"short title","type":"test|quiz|homework|project|reminder","subject":"if mentioned","date":"YYYY-MM-DD (next occurrence in the future; default tomorrow if none)","time":"HH:MM or empty","notes":""}`, maxTokens: 300, effort: 'low' });
    res.json({ title: String(out.title || text).slice(0, 120), type: ['test', 'quiz', 'homework', 'project', 'reminder'].includes(out.type) ? out.type : 'homework', subject: String(out.subject || ''), date: /^\d{4}-\d{2}-\d{2}$/.test(String(out.date || '')) ? out.date : new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: /^\d{2}:\d{2}$/.test(String(out.time || '')) ? out.time : '', notes: String(out.notes || '') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/events/bulk', auth, (req, res) => {
  const d = store.db(req.user.id);
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 60) : [];
  const made = [];
  for (const it of items) { if (!it.title || !it.date) continue; const ev = { id: store.uid(), title: String(it.title).slice(0, 120), type: it.type || 'homework', subject: String(it.subject || '').slice(0, 60), date: String(it.date).slice(0, 10), time: String(it.time || '').slice(0, 5), notes: String(it.notes || '').slice(0, 2000), notebookId: null, done: false, createdAt: Date.now() }; d.events.push(ev); made.push(ev); }
  store.save(req.user.id); res.json({ added: made.length, events: made });
});

// ---------- planner ----------
app.get('/api/events', auth, (req, res) => res.json(store.db(req.user.id).events.sort((a, b) => a.date.localeCompare(b.date))));
app.post('/api/events', auth, (req, res) => {
  const { title, type, subject, date, time, notes, notebookId } = req.body || {};
  if (!title || !date) return res.status(400).json({ error: 'Title and date required' });
  const d = store.db(req.user.id);
  const ev = { id: store.uid(), title: String(title).slice(0, 120), type: type || 'test', subject: String(subject || '').slice(0, 60), date: String(date).slice(0, 10), time: String(time || '').slice(0, 5), notes: String(notes || '').slice(0, 2000), notebookId: notebookId || null, done: false, createdAt: Date.now() };
  d.events.push(ev); store.save(req.user.id);
  res.json(ev);
});
app.patch('/api/events/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  const ev = d.events.find(e => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Not found' });
  for (const k of ['title', 'type', 'subject', 'date', 'time', 'notes', 'notebookId', 'done', 'studyId']) if (req.body[k] !== undefined) ev[k] = req.body[k];
  if (Array.isArray(req.body.subtasks)) ev.subtasks = req.body.subtasks.filter(s => s && s.text).slice(0, 12).map(s => ({ id: s.id || store.uid(), text: str(s.text, 140), minutes: clampInt(s.minutes, 1, 600, 20), done: !!s.done }));
  if (req.body.done === true) { ev.doneAt = Date.now(); logActivity(req.user.id, 'done'); }
  store.save(req.user.id); res.json(ev);
});
app.delete('/api/events/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  d.events = d.events.filter(e => e.id !== req.params.id); store.save(req.user.id); res.json({ ok: true });
});

// ---------- study sets ----------
function pagesText(d, pageIds) {
  const pages = d.pages.filter(p => pageIds.includes(p.id)).sort((a, b) => a.index - b.index);
  return pages.map(p => { const nb = d.notebooks.find(n => n.id === p.notebookId); return `### ${nb?.name || 'Notebook'} — page ${p.index}${p.title ? ': ' + p.title : ''}\n${p.transcript || '(no transcript yet)'}`; }).join('\n\n');
}
// fetch a web link's readable text (for study sources); cached on the study set
async function fetchLinkText(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (WorkBook study assistant)', Accept: 'text/html,text/plain,*/*' }, redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    let text = await r.text();
    let title = '';
    if (/html/.test(ct) || /<html/i.test(text.slice(0, 2000))) {
      title = (text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
      text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>|<!--[\s\S]*?-->/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }
    text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n').trim();
    return { url, title: title.trim().slice(0, 140), text: text.slice(0, 9000), at: Date.now(), ok: true };
  } catch (e) { return { url, title: '', text: '', at: Date.now(), ok: false, error: e.message }; }
  finally { clearTimeout(t); }
}
async function ensureLinks(s) {
  s.links = Array.isArray(s.links) ? s.links : [];
  s.linkCache ||= {};
  for (const url of s.links) if (!s.linkCache[url] || (!s.linkCache[url].ok && Date.now() - s.linkCache[url].at > 600000)) s.linkCache[url] = await fetchLinkText(url);
  for (const k of Object.keys(s.linkCache)) if (!s.links.includes(k)) delete s.linkCache[k];
}
function linksText(s) { return (s.links || []).map(u => { const c = s.linkCache?.[u]; return c?.ok && c.text ? `--- WEB SOURCE: ${c.title || u} (${u}) ---\n${c.text}` : `--- WEB SOURCE (could not load): ${u} ---`; }).join('\n\n'); }
function studyContext(d, s, pageIds) {
  const notes = pagesText(d, pageIds && pageIds.length ? pageIds : (s.pageIds || []));
  const lt = linksText(s);
  return `SUBJECT: ${s.subject || 'unknown'}\nTOPIC / TEST: ${s.title}${s.topic ? '\nTOPIC DETAILS: ' + s.topic : ''}\n\nSTUDENT'S NOTEBOOK NOTES:\n${notes || '(no notebook pages selected — use the topic' + (lt ? ' and the web sources' : '') + ')'}${lt ? '\n\nWEB SOURCES THE STUDENT ADDED (use these as material too):\n' + lt : ''}`;
}
app.get('/api/study', auth, (req, res) => res.json(store.db(req.user.id).study.map(studySummary)));
app.post('/api/study', auth, async (req, res) => {
  const { title, subject, topic, pageIds, eventId, links } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title required' });
  const d = store.db(req.user.id);
  const s = { id: store.uid(), title: String(title).slice(0, 120), subject: String(subject || '').slice(0, 60), topic: String(topic || '').slice(0, 1000), pageIds: Array.isArray(pageIds) ? pageIds : [], eventId: eventId || null, sheet: '', online: '', tests: [], cards: [], chat: [], links: Array.isArray(links) ? links.map(u => String(u).trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 10) : [], createdAt: Date.now(), updatedAt: Date.now() };
  if (s.links.length) await ensureLinks(s);
  d.study.push(s);
  if (eventId) { const ev = d.events.find(e => e.id === eventId); if (ev) ev.studyId = s.id; }
  store.save(req.user.id); res.json(s);
});
// full set + the source pages resolved (id/index/title/notebook) so the client never has to load whole notebooks
app.get('/api/study/:id', auth, (req, res) => {
  const d = store.db(req.user.id); const s = store.findStudy(d, req.params.id);
  if (!s) return err(res, 404, 'Not found');
  const pages = (s.pageIds || []).map(id => store.findPage(d, id)).filter(Boolean).sort((a, b) => a.notebookId.localeCompare(b.notebookId) || a.index - b.index).map(p => ({ id: p.id, index: p.index, title: p.title || '', notebookId: p.notebookId, notebook: store.findNb(d, p.notebookId)?.name || '' }));
  res.json({ ...s, pages });
});
// add flashcards from the vocab on the set's pages — instant, no AI
app.post('/api/study/:id/vocab-cards', auth, (req, res) => {
  const d = store.db(req.user.id); const s = store.findStudy(d, req.params.id); if (!s) return err(res, 404, 'Not found');
  const pages = (s.pageIds || []).map(id => store.findPage(d, id)).filter(Boolean);
  const added = vocabCards(pages, s.cards || []);
  if (!added.length) return err(res, 400, pages.length ? 'No new vocabulary on these pages.' : 'Add notebook pages to this set first (Sources).');
  s.cards = [...(s.cards || []), ...added]; s.updatedAt = Date.now(); store.save(req.user.id); logActivity(req.user.id, 'cards');
  res.json({ cards: s.cards, added: added.length });
});
app.patch('/api/study/:id', auth, async (req, res) => {
  const d = store.db(req.user.id);
  const s = d.study.find(s => s.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  for (const k of ['title', 'subject', 'topic', 'pageIds', 'sheet', 'cards', 'cardProgress', 'cramDone']) if (req.body[k] !== undefined) s[k] = req.body[k];
  if (Array.isArray(req.body.links)) { s.links = req.body.links.map(u => String(u).trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 10); await ensureLinks(s); }
  if (req.body.cards) logActivity(req.user.id, 'cards');
  s.updatedAt = Date.now(); store.save(req.user.id); res.json(s);
});
app.delete('/api/study/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  d.study = d.study.filter(s => s.id !== req.params.id);
  for (const ev of d.events) if (ev.studyId === req.params.id) delete ev.studyId;
  store.save(req.user.id); res.json({ ok: true });
});
const getStudy = (req, res) => { const d = store.db(req.user.id); const s = d.study.find(s => s.id === req.params.id); if (!s) res.status(404).json({ error: 'Not found' }); return [d, s]; };

app.post('/api/study/:id/sheet', auth, async (req, res) => {
  const [d, s] = getStudy(req, res); if (!s) return;
  try {
    const text = await ai.complete({
      system: 'You are a brilliant, warm study coach who writes beautiful, accurate study sheets for students. Write in clear Markdown.\n' + MATH_RULES,
      prompt: `${studyContext(d, s)}\n\nWrite a complete STUDY SHEET for this test/topic based mainly on the student's own notes above (fill small gaps with correct background knowledge, and mark anything not from their notes with "➕"). Structure:
# <Title> Study Sheet
## Big Picture (2-4 sentences)
## Key Concepts (organized sections with bullets; bold the important terms)
## Vocabulary (term — definition table)
## Formulas / Rules / Steps (if relevant)
## Common Mistakes & Tricks
## Quick Self-Check (5 questions with answers hidden below a "Answers" heading)
Keep it tight and high-quality — the kind of sheet a top student would make.`,
      maxTokens: 6000, effort: 'medium',
    });
    s.sheet = text; s.updatedAt = Date.now(); store.save(req.user.id); logActivity(req.user.id, 'study');
    res.json({ sheet: text });
  } catch (e) { console.error('sheet:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/study/:id/online', auth, async (req, res) => {
  const [d, s] = getStudy(req, res); if (!s) return;
  try {
    let text;
    if (ai.HAS_WEB_SEARCH) {
      text = await ai.complete({
        system: 'You are a research librarian for students. You find the best real, free, current online study resources and summarize them honestly. Never invent URLs — only include links you actually found.',
        webSearch: true,
        prompt: `${studyContext(d, s)}\n\nSearch the web and find the BEST online study resources for this exact topic (level: school student). Look for: Khan Academy, Quizlet sets, CrashCourse / YouTube videos, study guides, practice quizzes, SparkNotes/CliffsNotes-type summaries, and reputable explainers.
Then write Markdown:
# More Study Help Online: <topic>
## Top Picks (5-10 resources — each as "**[Title](URL)** — what it is and why it helps, 1-2 sentences" with an emoji for type: 🎥 video, 📝 study guide, 🃏 flashcards, ✅ practice quiz, 📚 explainer)
## Extra Study Sheets & Summaries (short list, with links)
## What Others Say Is Most Important (3-6 bullets summarizing key ideas that show up across these sources — this is like a study sheet from the internet)
Only include real links you found. Prefer free resources.`,
        maxTokens: 4000, effort: 'medium',
      });
    } else {
      // No live web search on this backend: ask the model for the best search queries + an "internet study sheet",
      // then build links that are guaranteed to work (site search pages).
      const out = await ai.completeJSON({
        system: 'You help students find study resources. Output ONLY JSON.',
        prompt: `${studyContext(d, s)}\n\nReturn ONLY JSON:
{"topic":"short topic name",
 "queries":[{"label":"what this search finds (e.g. lesson on X, video explaining Y, flashcards for Z)","q":"3-6 topic words ONLY — no site names like Khan Academy/YouTube/Quizlet"}],   // 4-6 varied searches: lesson, video, flashcards, practice quiz, summary
 "internetSheet":"Markdown: 'What most study sites say is most important' about this topic — 6-10 bullets of the key facts, common exam questions and mistakes, written from general knowledge (LaTeX for math)"}`,
        maxTokens: 2500,
      });
      const enc = encodeURIComponent;
      const qs = (out.queries || []).slice(0, 6);
      const topic = out.topic || s.title;
      const row = (label, links) => `**${label}** — ${links.map(([n, u]) => `[${n}](${u})`).join(' · ')}`;
      text = `# More Study Help Online: ${topic}\n\n_This server has no live web search, so these are ready-made searches on trusted study sites (they always work) plus a summary of what those sites usually emphasize._\n\n## Top Picks\n` +
        qs.map(({ label, q }) => `- 🔎 ${row(label || q, [['Khan Academy', `https://www.khanacademy.org/search?page_search_query=${enc(q)}`], ['YouTube', `https://www.youtube.com/results?search_query=${enc(q)}`], ['Quizlet', `https://quizlet.com/search?query=${enc(q)}&type=sets`], ['Google', `https://www.google.com/search?q=${enc(q)}`]])}`).join('\n') +
        `\n\n## Extra Study Sheets & Summaries\n- 📚 [Wikipedia: ${topic}](https://en.wikipedia.org/w/index.php?search=${enc(topic)}) · 📝 [SparkNotes](https://www.sparknotes.com/search?q=${enc(topic)}) · 🎥 [CrashCourse on YouTube](https://www.youtube.com/results?search_query=${enc('crash course ' + topic)}) · ✅ [Practice quizzes](https://www.google.com/search?q=${enc(topic + ' practice quiz')})\n\n## What Others Say Is Most Important\n${out.internetSheet || ''}`;
    }
    s.online = text; s.updatedAt = Date.now(); store.save(req.user.id);
    res.json({ online: text });
  } catch (e) { console.error('online:', e.message); res.status(500).json({ error: e.message }); }
});

const TYPE_DESC = { mc: 'mc = multiple choice with 4 choices (answer = index 0-3)', tf: 'tf = true/false (answer = true|false)', short: 'short = short written answer (answer = model answer)', fill: 'fill = fill-in-the-blank: the question contains one blank written as ____ and answer = the missing word/number', explain: 'explain = longer written explanation / show-your-work (answer = model answer with the key points)' };

// ---- answer-key verification: re-solve every generated question and fix wrong keys ----
function applyQuestionFixes(questions, results) {
  let fixed = 0;
  const byId = new Map(questions.map(q => [String(q.id), q]));
  for (const r of results || []) {
    const q = byId.get(String(r.id));
    if (!q || r.ok !== false) continue;
    let changed = false;
    if (typeof r.question === 'string' && r.question.trim() && r.question !== q.question) { q.question = r.question; changed = true; }
    if (r.answer !== undefined && r.answer !== null) {
      if (q.type === 'mc') { const n = Number(r.answer); if (Number.isInteger(n) && n >= 0 && n < (q.choices || []).length && n !== Number(q.answer)) { q.answer = n; changed = true; } }
      else if (q.type === 'tf') { const b = String(r.answer) === 'true'; if (b !== !!q.answer) { q.answer = b; changed = true; } }
      else { const a2 = String(r.answer); if (a2 && a2 !== String(q.answer)) { q.answer = a2; changed = true; } }
    }
    if (changed && r.explanation) q.explanation = String(r.explanation);
    if (changed) fixed++;
  }
  return fixed;
}
// Checks a test with the same models that built it. With source photos: page by page against each photo.
// Without: in batches of 12 questions. Returns how many questions were fixed.
async function verifyTestQuestions(test, { images = [], context = '' } = {}) {
  const groups = [];
  if (images.length) {
    for (let i = 0; i < images.length; i++) { const qs = test.questions.filter(q => (q.page || 1) === i + 1); if (qs.length) groups.push({ qs, image: images[i], pageNo: i + 1, of: images.length }); }
  } else {
    for (let i = 0; i < test.questions.length; i += 12) groups.push({ qs: test.questions.slice(i, i + 12) });
  }
  const counts = await Promise.all(groups.map(async g => {
    const payload = g.qs.map(q => ({ id: q.id, type: q.type, question: q.question, choices: q.choices || undefined, answer: q.answer }));
    const out = await ai.completeJSON({
      system: 'You are a meticulous test checker. You solve every question yourself from scratch, then verify the answer key. Output ONLY JSON. Inside JSON strings write math as LaTeX with $...$ (escape backslashes as \\\\ for valid JSON).\n' + MATH_RULES,
      images: g.image ? [g.image] : [],
      prompt: `${g.image ? `The attached photo is page ${g.pageNo} of ${g.of} of the original test/worksheet these practice questions were built from (with numbers/values changed or customized). First make sure each question is solvable and practices the same skill as this page. Then solve` : 'Solve'} each question yourself, WITHOUT looking at the given answer key, and only then compare your answer with the key.${context ? '\nCONTEXT: ' + context : ''}
QUESTIONS WITH CURRENT ANSWER KEY:
${JSON.stringify(payload, null, 1)}
For each question return {"id","ok":true} if the question is clear and the key matches your answer (equivalent forms count as matching). Otherwise {"id","ok":false, "answer": corrected answer (mc: correct choice index 0-3, tf: true|false, others: model answer text), "question": corrected question ONLY if the question itself is broken/ambiguous, "explanation": corrected explanation, "note": what was wrong}.
Mark ok:false ONLY for genuinely wrong keys or broken questions — never for style.
Return ONLY JSON: {"results":[...]}`,
      maxTokens: 4000, effort: 'medium',
    });
    return applyQuestionFixes(g.qs, out.results);
  }));
  return counts.reduce((a, b) => a + b, 0);
}
// Read one photographed page of a test/worksheet → its problems (runs in parallel across pages).
async function extractTestPage(img, i, total, subject) {
  try {
    return await ai.completeJSON({
      system: `You read photos of tests, worksheets, homework and textbook pages precisely. Subject: ${subject || 'unknown'}. Output ONLY JSON.\n${MATH_RULES}`,
      images: [img],
      prompt: `This is page ${i + 1} of ${total} of material a student wants to practice from. List EVERY problem/question on the page, in order, exactly as written (LaTeX for math). Keep any directions. Note each problem's type: mc (include its choices), tf, fill (fill-in-the-blank), short, or explain (show your work). If part of the page is notes/content rather than problems, summarize that testable content in "contentNotes".
Return ONLY JSON: {"pageTitle":"...","directions":"...","contentNotes":"","problems":[{"n":"1","type":"mc|tf|fill|short|explain","problem":"...","choices":["..."] ,"answerIfShown":"answer if printed/written on the page, else empty"}]}`,
      maxTokens: 4000,
    });
  } catch (e) { console.error('extract page ' + (i + 1) + ':', e.message); return { pageTitle: '', problems: [], error: e.message }; }
}
const photoPagesText = (pagesExt) => pagesExt.map((pg, i) => `--- PAGE ${i + 1}${pg.pageTitle ? ': ' + pg.pageTitle : ''} ---${pg.directions ? '\nDirections: ' + pg.directions : ''}${pg.contentNotes ? '\nContent on the page: ' + pg.contentNotes : ''}\n${(pg.problems || []).map(p => `${p.n}. [${p.type || 'short'}] ${p.problem}${p.choices?.length ? ' | Choices: ' + p.choices.join(' | ') : ''}${p.answerIfShown ? ' | (answer shown: ' + p.answerIfShown + ')' : ''}`).join('\n') || '(no problems found on this page)'}`).join('\n\n');
app.post('/api/study/:id/test', auth, async (req, res) => {
  const [d, s] = getStudy(req, res); if (!s) return;
  const count = Math.max(1, Math.min(50, parseInt(req.body.count) || 10));
  const types = (Array.isArray(req.body.types) ? req.body.types : ['mc', 'tf', 'short']).filter(t => TYPE_DESC[t]);
  if (!types.length) types.push('mc', 'tf', 'short');
  const diffN = Math.max(1, Math.min(5, parseInt(req.body.difficulty) || 3));
  const difficulty = ['very easy (basic recall, friendly wording)', 'easy', 'medium / mixed', 'hard (multi-step, apply ideas)', 'very hard (tricky, exam-level, combine ideas)'][diffN - 1];
  const style = ['remake', 'prompt', 'import'].includes(req.body.style) ? req.body.style : 'standard';
  const about = String(req.body.about || '').slice(0, 1000);
  const instructions = String(req.body.instructions || '').slice(0, 2000);
  const freePrompt = String(req.body.prompt || '').slice(0, 3000);
  const importText = String(req.body.importText || '').slice(0, 30000);
  if (Array.isArray(req.body.links) && req.body.links.length) { s.links = [...new Set([...(s.links || []), ...req.body.links.map(u => String(u).trim()).filter(u => /^https?:\/\//i.test(u))])].slice(0, 10); await ensureLinks(s); }
  const wantHints = req.body.hints !== false;
  const wantVerify = req.body.verify !== false;
  const pageIds = Array.isArray(req.body.pageIds) ? req.body.pageIds.filter(id => (s.pageIds || []).includes(id)) : [];
  const images = (Array.isArray(req.body.images) ? req.body.images : []).slice(0, 6).map(stripDataUrl);
  try {
    // Uploaded photos: read every page first (in parallel), so the test can be built from them page by page.
    let pagesExt = [];
    let photoBlock = '';
    if (images.length) {
      pagesExt = await Promise.all(images.map((img, i) => extractTestPage(img, i, images.length, s.subject)));
      const nProblems = pagesExt.reduce((n, pg) => n + (pg.problems || []).length, 0);
      if (!nProblems && !pagesExt.some(pg => pg.contentNotes)) throw new Error("I couldn't read any problems or content in those photos — try clearer, well-lit photos of the whole page.");
      photoBlock = `\nTHE STUDENT UPLOADED ${images.length} PHOTO PAGE${images.length > 1 ? 'S' : ''} of a real test/worksheet (this is the MAIN source material). What is on them, page by page:\n${photoPagesText(pagesExt)}\n`;
    }
    const seen = s.tests?.length ? 'Avoid repeating these earlier questions: ' + s.tests.flatMap(t => t.questions.map(q => q.question)).slice(-40).join(' | ') : '';
    const extra = `${about ? '\nWHAT THE TEST IS ABOUT (from the student): ' + about : ''}${instructions ? '\nSTUDENT\'S INSTRUCTIONS FOR THIS TEST (follow them closely): ' + instructions : ''}`;
    const hintLine = wantHints ? '\nFor every question also give a "hint": one short nudge that helps without giving the answer away.' : '';
    const pageLine = images.length ? '\nEvery question MUST include "page": the photo page number (1-' + images.length + ') it was built from.' : '';
    const qShapes = `{"id":"q1","type":"mc","question":"...","choices":["...","...","...","..."],"answer":0,"explanation":"why","hint":"..."${images.length ? ',"page":1' : ''}},
 {"id":"q2","type":"tf","question":"...","answer":true,"explanation":"why","hint":"..."${images.length ? ',"page":1' : ''}},
 {"id":"q3","type":"short","question":"...","answer":"model answer","explanation":"...","hint":"..."${images.length ? ',"page":2' : ''}},
 {"id":"q4","type":"fill","question":"... ____ ...","answer":"...","explanation":"...","hint":"..."},
 {"id":"q5","type":"explain","question":"...","answer":"model answer","explanation":"rubric","hint":"..."}`;
    if (style === 'import' && !importText && !images.length) throw new Error('Paste the test (or add photos of it) to import.');
    const prompt = style === 'import'
      ? `${extra}${photoBlock}
THE STUDENT ALREADY HAS A FINISHED TEST (made with ChatGPT or elsewhere) and wants it converted to this app's digital format EXACTLY as written. Keep every question, in the same order, with its original wording, numbers, choices and answer key. Do NOT invent, reword, drop, merge or add questions — this is a conversion, not a rewrite. Map each question to the closest type: ${Object.values(TYPE_DESC).join('; ')}. If the answer key is missing for a question, solve it yourself to fill in "answer". If explanations or hints are missing, add brief ones (never change given answers unless they are clearly wrong — then fix and note it in "explanation").${hintLine}${pageLine}
${importText ? 'THE PASTED TEST:\n<<<' + importText + '>>>' : 'The test is in the photographed pages above — convert those exactly, numbers unchanged.'}
Return ONLY JSON:
{"title":"...","description":"1-2 sentences: what this test covers","questions":[
 ${qShapes}
]}`
      : style === 'prompt'
      ? `${studyContext(d, s, pageIds)}\n${extra}${photoBlock}
THE STUDENT'S REQUEST (build EXACTLY what they ask for — number of questions, topics, question types, difficulty, format, wording style${images.length ? ', what to do with the photographed pages (e.g. "same problems with the numbers changed out")' : ''}; if they don't say, pick sensible defaults around ${count} questions): <<<${freePrompt || 'Make a good practice test on this material.'}>>>
Allowed question types: ${Object.values(TYPE_DESC).join('; ')}.${hintLine}${pageLine} ${seen}
Return ONLY JSON:
{"title":"...","description":"1-2 sentences: what this test covers","questions":[
 ${qShapes}
]}`
      : style === 'remake'
      ? `${studyContext(d, s, pageIds)}\n${extra}${photoBlock}
Make a PRACTICE ${images.length ? 'TEST that is a new version of the photographed test' : "WORKSHEET that is a copy of the student's page(s)"} with DIFFERENT NUMBERS / values / examples: keep the same kinds of problems, the same order and the same difficulty, and the same skills being practiced (e.g. if the page has "3/4 + 1/8", write "2/5 + 3/10"; if it has a definition to fill in, ask for a similar term from the same topic; if it has a worked example, give a fresh one to solve).${images.length ? ` Recreate EVERY problem from EVERY page, in order, keeping each problem's TYPE (mc keeps 4 fresh choices, fill keeps a blank, tf stays true/false — flip some statements, short/explain stay written).` : ` Aim for about ${count} problems (fewer only if the page has fewer). Every problem is a short-answer question the student solves and types.`} Difficulty: ${difficulty}. Give the exact model answer and a short solution/explanation for each.${hintLine}${pageLine} ${seen}
Return ONLY JSON:
{"title":"...","description":"1-2 sentences: what this ${images.length ? 'test' : 'worksheet'} practices and where it came from","questions":[
 ${qShapes}
]}`
      : `${studyContext(d, s, pageIds)}\n${extra}${photoBlock}
Write a practice test with exactly ${count} questions. Allowed question types (use a good mix of the allowed ones): ${types.map(t => TYPE_DESC[t]).join('; ')}. Difficulty: ${difficulty}. Cover the material evenly; make it feel like a real school test on this topic.${hintLine}${pageLine} ${seen}
Return ONLY JSON:
{"title":"...","description":"1-2 sentences: what this test covers and what to focus on","questions":[
 ${qShapes}
]}`;
    // Fast path: if the pasted test is already our JSON (e.g. from the "Copy ChatGPT prompt" template), no conversion needed.
    let out = null;
    if (style === 'import' && importText) {
      try { const parsed = ai.parseJSON(importText); if (parsed && Array.isArray(parsed.questions) && parsed.questions.length) out = parsed; } catch {}
    }
    if (!out) out = await ai.completeJSON({
      system: 'You are an expert teacher who writes fair, accurate practice tests and worksheets. Output ONLY JSON. Inside JSON strings, write math as LaTeX with $...$ (escape backslashes as \\\\ for valid JSON).\n' + MATH_RULES,
      prompt, maxTokens: 7000, effort: 'medium',
    });
    const test = { id: store.uid(), title: out.title || s.title + (style === 'remake' ? ' Worksheet' : style === 'import' ? ' (imported)' : ' Practice Test'), description: String(out.description || ''), style, about, instructions, prompt: freePrompt, difficulty: diffN, pageIds, fromPhotos: images.length || undefined, questions: (out.questions || []).filter(q => q && q.question).slice(0, 80).map((q, i) => {
      const type = (style === 'remake' && !images.length) ? 'short' : (TYPE_DESC[q.type] ? q.type : 'short');
      const base = { id: 'q' + (i + 1), type, question: String(q.question), explanation: String(q.explanation || ''), hint: wantHints ? String(q.hint || '') : '', page: images.length ? Math.max(1, Math.min(images.length, parseInt(q.page) || 1)) : undefined };
      if (type === 'mc') { base.choices = (Array.isArray(q.choices) ? q.choices : []).slice(0, 6).map(String); base.answer = Math.max(0, Math.min(base.choices.length - 1, parseInt(q.answer) || 0)); }
      else if (type === 'tf') base.answer = q.answer === true || String(q.answer).toLowerCase() === 'true';
      else base.answer = String(q.answer ?? '');
      return base;
    }).filter(q => q.type !== 'mc' || q.choices.length >= 2), createdAt: Date.now(), attempts: [] };
    if (!test.questions.length) throw new Error('The AI returned no questions — try again');
    // Double-check the finished test with the same models: page by page against the photos, or in batches.
    if (wantVerify) {
      try {
        const fixed = await verifyTestQuestions(test, { images, context: `Subject: ${s.subject || ''}. Test: ${test.title}. ${about || ''}` });
        test.checked = { fixed, at: Date.now(), pages: images.length || Math.ceil(test.questions.length / 12) };
      } catch (e) { console.error('verify test:', e.message); test.checked = { error: e.message, at: Date.now() }; }
    }
    s.tests.push(test); s.updatedAt = Date.now(); store.save(req.user.id);
    res.json(test);
  } catch (e) { console.error('test:', e.message); res.status(500).json({ error: e.message }); }
});

const norm = (v) => String(v ?? '').toLowerCase().replace(/[$\\{}]/g, '').replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '').trim();
async function gradeHandler(req, res) {
  const [d, s] = getStudy(req, res); if (!s) return;
  const test = s.tests.find(t => t.id === req.params.tid);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  const answers = req.body.answers || {};
  const dryRun = !!req.body.dryRun;
  const only = Array.isArray(req.body.questionIds) && req.body.questionIds.length ? new Set(req.body.questionIds) : null;
  const qs = test.questions.filter(q => !only || only.has(q.id));
  const results = {};
  const toAI = [];
  for (const q of qs) {
    const a = answers[q.id];
    if (q.type === 'mc') results[q.id] = { correct: Number(a) === Number(q.answer), feedback: '' };
    else if (q.type === 'tf') results[q.id] = { correct: String(a) === String(q.answer), feedback: '' };
    else if (q.type === 'fill' && norm(a) && norm(a) === norm(q.answer)) results[q.id] = { correct: true, score: 1, feedback: 'Exactly right.' };
    else if (!String(a ?? '').trim()) results[q.id] = { correct: false, score: 0, feedback: 'No answer given.' };
    else toAI.push({ id: q.id, type: q.type, question: q.question, model: q.answer, rubric: q.explanation, student: String(a) });
  }
  try {
    if (toAI.length) {
      const graded = await ai.completeJSON({
        system: 'You are a fair, careful teacher grading student answers. You ALWAYS solve the question yourself before judging the student. Accept equivalent forms (3/4 = 0.75 = $\\\\frac{3}{4}$, unsimplified fractions if the question did not ask to simplify, different variable order, synonyms, singular/plural, different but correct wording) and ignore formatting differences. Output ONLY JSON.',
        prompt: `Grade each student answer. For each item: (1) solve the question yourself — put your own brief answer in "solution"; (2) compare the student's answer with YOUR solution and the model answer; (3) score 0-1: 1 = fully correct in any equivalent form, 0.75 = right with a trivial slip (notation/rounding/missing units), 0.5 = right idea or method but wrong result, 0.25 = a relevant start, 0 = wrong or blank; (4) give 1-2 sentences of specific feedback that teaches (name the mistake and show the key step). For "fill" accept synonyms and equivalent numbers; for "explain" grade against the rubric.\n${JSON.stringify(toAI, null, 1)}\nReturn ONLY JSON: [{"id":"q3","solution":"...","score":1,"feedback":"..."}]`,
        maxTokens: 4000, effort: 'medium',
      });
      const arr = Array.isArray(graded) ? graded : (graded.items || []);
      // second opinion on anything not given full credit — catches harsh grading and missed equivalent forms
      const disputed = arr.filter(g => Number(g.score) < 1 && String((toAI.find(t => t.id === g.id) || {}).student || '').trim());
      if (disputed.length) {
        try {
          const re = await ai.completeJSON({
            system: 'You are the head teacher double-checking grades another teacher gave. Solve each question yourself first. If the student\'s answer is mathematically or factually equivalent to a correct answer, it deserves FULL credit no matter how it is written. Output ONLY JSON.',
            prompt: `Re-grade these disputed answers and decide the fair FINAL score 0-1 (same scale: 1, 0.75, 0.5, 0.25, 0). The first grader may have been too harsh or too generous.\n${JSON.stringify(disputed.map(g => { const t = toAI.find(x => x.id === g.id) || {}; return { id: g.id, question: t.question, modelAnswer: t.model, rubric: t.rubric, studentAnswer: t.student, firstScore: g.score, firstFeedback: g.feedback }; }), null, 1)}\nReturn ONLY JSON: [{"id":"q3","score":1,"feedback":"final feedback, 1-2 teaching sentences"}]`,
            maxTokens: 3000, effort: 'medium',
          });
          for (const r of (Array.isArray(re) ? re : re.items || [])) { const g = arr.find(x => x.id === r.id); const sc = Number(r.score); if (g && Number.isFinite(sc)) { g.score = Math.max(0, Math.min(1, sc)); if (r.feedback) g.feedback = r.feedback; } }
        } catch (e) { console.error('regrade:', e.message); }
      }
      for (const g of arr) if (results[g.id] === undefined) results[g.id] = { correct: Number(g.score) >= 0.75, score: Math.max(0, Math.min(1, Number(g.score) || 0)), feedback: g.feedback || '' };
      for (const t of toAI) if (!results[t.id]) results[t.id] = { correct: false, feedback: '' };
    }
    const total = qs.length;
    let score = 0;
    for (const q of qs) { const r = results[q.id]; score += r.score !== undefined ? r.score : (r.correct ? 1 : 0); }
    const attempt = { id: store.uid(), at: Date.now(), answers, results, score, total, percent: total ? Math.round(100 * score / total) : 0, subset: only ? [...only] : null, timeSpent: req.body.timeSpent || null, mode: req.body.mode || 'exam' };
    if (!dryRun) { test.attempts.push(attempt); s.updatedAt = Date.now(); store.save(req.user.id); logActivity(req.user.id, 'test'); }
    res.json(attempt);
  } catch (e) { console.error('grade:', e.message); res.status(500).json({ error: e.message }); }
}
app.post('/api/study/:id/test/:tid/grade', auth, gradeHandler);
app.delete('/api/study/:id/test/:tid', auth, (req, res) => {
  const [d, s] = getStudy(req, res); if (!s) return;
  s.tests = s.tests.filter(t => t.id !== req.params.tid); store.save(req.user.id); res.json({ ok: true });
});

app.post('/api/study/:id/cards', auth, async (req, res) => {
  const [d, s] = getStudy(req, res); if (!s) return;
  const count = Math.max(5, Math.min(60, parseInt(req.body.count) || 20));
  try {
    const out = await ai.completeJSON({
      system: 'You write excellent flashcards for students: one clear idea per card, short fronts, precise backs. Output ONLY JSON. Inside JSON strings, write math as LaTeX with $...$ (escape backslashes as \\\\ for valid JSON).\n' + MATH_RULES,
      prompt: `${studyContext(d, s)}\n\nWrite ${count} flashcards covering the most testable material (terms, definitions, key facts, formulas, cause→effect, "why" questions). Mix question-style fronts and term fronts. ${s.cards?.length ? 'Do not repeat these existing cards: ' + s.cards.map(c => c.front).slice(0, 60).join(' | ') : ''}
Return ONLY JSON: {"cards":[{"front":"...","back":"...","hint":"optional short hint"}]}`,
      maxTokens: 5000, effort: 'medium',
    });
    const cards = (out.cards || []).filter(c => c && c.front && c.back).map(c => ({ id: store.uid(), front: String(c.front), back: String(c.back), hint: c.hint ? String(c.hint) : '', box: 0, seen: 0, due: 0 }));
    s.cards = [...(s.cards || []), ...cards]; s.updatedAt = Date.now(); store.save(req.user.id);
    res.json({ cards: s.cards });
  } catch (e) { console.error('cards:', e.message); res.status(500).json({ error: e.message }); }
});

// Tutor chat (SSE)
app.post('/api/study/:id/chat', auth, async (req, res) => {
  const [d, s] = getStudy(req, res); if (!s) return;
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' });
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.flushHeaders();
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  let reply = '';
  try {
    await ai.stream({
      system: `You are a patient, encouraging tutor helping a student study for: ${s.title}. Use their notes below as the main source; explain simply, use examples, and quiz them back sometimes. Keep replies short and use Markdown; write math in LaTeX ($...$).\n${MATH_RULES}\n\n${studyContext(d, s)}${s.sheet ? '\n\nSTUDY SHEET:\n' + s.sheet.slice(0, 6000) : ''}`,
      messages: messages.slice(-14).map(m => ({ role: m.role, content: String(m.content) })),
      onText: (t) => { reply += t; send({ t }); },
    });
    s.chat = [...messages.slice(-40), { role: 'assistant', content: reply }].slice(-40); store.save(req.user.id);
  } catch (e) { send({ error: 'AI error: ' + e.message }); }
  send({ done: true }); res.end();
});

// ---------- spaced repetition: one daily review queue across every study set ----------
// Leitner boxes 0-5. box ≥ 1 counts as "known" (same meaning the flashcard tab always had).
const BOX_DAYS = [0, 1, 3, 7, 14, 30];
const dueCards = (d, now = Date.now()) => { const out = []; for (const s of d.study) for (const c of s.cards || []) if ((c.due || 0) <= now) out.push({ setId: s.id, set: s.title, subject: s.subject || '', id: c.id, front: c.front, back: c.back, hint: c.hint || '', box: c.box || 0, due: c.due || 0 }); return out.sort((a, b) => a.due - b.due || a.box - b.box); };
app.get('/api/review', auth, (req, res) => {
  const d = store.db(req.user.id); const now = Date.now();
  const due = dueCards(d, now); const limit = clampInt(req.query.limit, 1, 200, 40);
  const total = d.study.reduce((n, s) => n + (s.cards || []).length, 0);
  const endOfDay = now + 86400000; let dueSoon = 0; const byBox = [0, 0, 0, 0, 0, 0];
  for (const s of d.study) for (const c of s.cards || []) { byBox[Math.min(5, c.box || 0)]++; if ((c.due || 0) > now && (c.due || 0) <= endOfDay) dueSoon++; }
  const queue = req.query.set ? due.filter(c => c.setId === req.query.set) : due;
  res.json({ cards: queue.slice(0, limit), due: due.length, dueSoon, total, byBox, sets: d.study.filter(s => (s.cards || []).length).map(s => ({ id: s.id, title: s.title, due: due.filter(c => c.setId === s.id).length })) });
});
app.post('/api/review/grade', auth, (req, res) => {
  const d = store.db(req.user.id); const s = store.findStudy(d, req.body.setId); const c = s?.cards?.find(x => x.id === req.body.cardId);
  if (!c) return err(res, 404, 'Card not found');
  const now = Date.now(); const r = String(req.body.rating); let box = c.box || 0;
  if (r === 'again') { box = 0; c.due = now + 10 * 60000; c.lapses = (c.lapses || 0) + 1; }
  else if (r === 'hard') { box = Math.max(1, box); c.due = now + 0.5 * BOX_DAYS[box] * 86400000 || now + 12 * 3600000; }
  else if (r === 'easy') { box = Math.min(5, box + 2); c.due = now + BOX_DAYS[box] * 1.3 * 86400000; }
  else { box = Math.min(5, box + 1); c.due = now + BOX_DAYS[box] * 86400000; } // good
  c.box = box; c.seen = (c.seen || 0) + 1; c.lastAt = now; s.updatedAt = now;
  store.save(req.user.id); logActivity(req.user.id, 'cards');
  res.json({ box, due: c.due, remaining: dueCards(d, now).length });
});

// ---------- study plan: day-by-day schedule until the test (AI), with checkable tasks ----------
app.post('/api/study/:id/plan', auth, async (req, res) => {
  const [d, s] = getStudy(req, res); if (!s) return;
  const ev = s.eventId ? store.findEvent(d, s.eventId) : null;
  const ctx = todayCtx(); const todayISO = isISODate(req.body.today) ? req.body.today : ctx.todayISO; // the client's local date wins
  const dow = new Date(todayISO + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const endISO = ev?.date && ev.date > todayISO ? ev.date : isoDate(new Date(Date.now() + 7 * 86400000));
  const days = Math.max(1, Math.min(21, Math.round((Date.parse(endISO) - Date.parse(todayISO)) / 86400000)));
  const perDay = clampInt(req.body.minutesPerDay, 10, 180, 30);
  try {
    const out = await ai.completeJSON({ system: 'You are a study coach who writes realistic, specific day-by-day study plans for students. Output ONLY JSON.',
      prompt: `${studyContext(d, s).slice(0, 12000)}\n\nToday is ${dow} ${todayISO}. ${ev ? `The test "${ev.title}" is on ${ev.date}.` : `Plan for the next ${days} days.`} The student has about ${perDay} minutes per day. Available in this app: study sheet${s.sheet ? ' (already made)' : ''}, flashcards (${(s.cards || []).length} cards), practice tests (${(s.tests || []).length} made), tutor chat, cram mode, daily flashcard review.
Write a plan with one entry per day from ${todayISO} up to ${ev ? 'the day before the test (plus a light "test day" entry)' : 'day ' + days}: 2-4 tasks per day, each a specific action tied to the actual topics in the notes (e.g. "Flashcards: cell organelles (10 min)", "Practice test: 10 questions on fractions", "Re-read page on photosynthesis and rewrite the 3 steps from memory"). Spread topics out, build up to a full practice test, finish with review of weak spots. Task kinds: read | cards | test | sheet | tutor | review | other.
Return ONLY JSON: {"days":[{"date":"YYYY-MM-DD","focus":"short theme for the day","tasks":[{"text":"...","kind":"cards","minutes":10}]}]}`, maxTokens: 3500, effort: 'low' });
    const kinds = ['read', 'cards', 'test', 'sheet', 'tutor', 'review', 'other'];
    const plan = { createdAt: Date.now(), minutesPerDay: perDay, endISO, days: (out.days || []).filter(x => isISODate(x?.date) && x.date >= todayISO && x.date <= endISO).slice(0, 22).map(x => ({ date: x.date, focus: str(x.focus, 80), tasks: (x.tasks || []).filter(t => t && t.text).slice(0, 5).map(t => ({ id: store.uid(), text: str(t.text, 160), kind: kinds.includes(t.kind) ? t.kind : 'other', minutes: clampInt(t.minutes, 3, 180, 15), done: false })) })).filter(x => x.tasks.length) };
    if (!plan.days.length) throw new Error('The AI returned an empty plan — try again');
    s.plan = plan; s.updatedAt = Date.now(); store.save(req.user.id); logActivity(req.user.id, 'study');
    res.json(plan);
  } catch (e) { console.error('plan:', e.message); err(res, 500, e.message); }
});
app.patch('/api/study/:id/plan', auth, (req, res) => {
  const [d, s] = getStudy(req, res); if (!s) return;
  if (req.body.clear) { s.plan = null; store.save(req.user.id); return res.json({ ok: true }); }
  for (const day of s.plan?.days || []) for (const t of day.tasks) if (t.id === req.body.taskId) { t.done = !!req.body.done; if (t.done) logActivity(req.user.id, 'plan'); }
  store.save(req.user.id); res.json(s.plan);
});

// ---------- grades: classes with weighted categories; the math happens on the client ----------
app.get('/api/grades', auth, (req, res) => res.json(store.db(req.user.id).grades || { classes: [] }));
app.put('/api/grades', auth, (req, res) => {
  const d = store.db(req.user.id); const inp = req.body || {};
  const classes = (Array.isArray(inp.classes) ? inp.classes : []).slice(0, 30).map(c => ({
    id: c.id || store.uid(), name: str(c.name, 60) || 'Class', subject: str(c.subject, 60), color: str(c.color, 20) || 'navy', target: clampInt(c.target, 0, 100, 90), scale: c.scale === 'plusminus' ? 'plusminus' : 'standard',
    categories: (Array.isArray(c.categories) ? c.categories : []).slice(0, 20).map(k => ({ id: k.id || store.uid(), name: str(k.name, 40) || 'Category', weight: Math.max(0, Math.min(100, Number(k.weight) || 0)), drop: clampInt(k.drop, 0, 5, 0) })),
    entries: (Array.isArray(c.entries) ? c.entries : []).slice(0, 500).map(e => ({ id: e.id || store.uid(), catId: str(e.catId, 60), title: str(e.title, 80), score: Number(e.score) || 0, max: Math.max(0.01, Number(e.max) || 100), date: isISODate(e.date) ? e.date : isoDate(), note: str(e.note, 200) })),
  }));
  d.grades = { classes, updatedAt: Date.now() }; store.save(req.user.id); res.json(d.grades);
});

// SPA fallback
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const BUILD_ID = String(Date.now());
app.get('/api/version', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ v: BUILD_ID }); });
app.get('/api/health', (req, res) => res.json({ ok: true, storage: store.backendName(), ai: ai.AVAILABLE ? ai.BACKEND + ': ' + ai.modelLabel() : 'unconfigured' }));

const PORT = process.env.PORT || 4980;
store.init().then(async () => {
  try { await notify.init(); } catch (e) { console.error('notify init failed:', e.message); }
  const srv = app.listen(PORT, () => console.log(`Digital WorkBook running at http://localhost:${PORT}  (AI: ${ai.AVAILABLE ? ai.BACKEND : 'NOT CONFIGURED'})`));
  srv.requestTimeout = 600000; srv.headersTimeout = 610000; // photo tests run several AI passes back-to-back
}).catch(e => { console.error('Storage init failed:', e); process.exit(1); });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { try { await store.flushAll(); } catch {} process.exit(0); });
