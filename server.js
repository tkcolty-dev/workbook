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

const app = express();
app.use(express.json({ limit: '40mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], setHeaders: (res, file) => { if (/\.(js|css|html)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); else res.setHeader('Cache-Control', 'public, max-age=604800'); } }));

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
  const d = store.db(req.user.id);
  res.json(d.notebooks.map(n => ({ ...n, scanned: d.pages.filter(p => p.notebookId === n.id).length })));
});
app.post('/api/notebooks', auth, (req, res) => {
  const { name, subject, color, pageCount, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const d = store.db(req.user.id);
  const nb = { id: store.uid(), name: name.trim().slice(0, 80), subject: (subject || '').trim().slice(0, 60), color: color || 'navy', pageCount: Math.max(0, Math.min(500, parseInt(pageCount) || 0)), description: (description || '').slice(0, 500), createdAt: Date.now(), updatedAt: Date.now() };
  d.notebooks.push(nb); store.save(req.user.id);
  res.json({ ...nb, scanned: 0 });
});
app.get('/api/notebooks/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  const nb = d.notebooks.find(n => n.id === req.params.id);
  if (!nb) return res.status(404).json({ error: 'Not found' });
  const pages = d.pages.filter(p => p.notebookId === nb.id).sort((a, b) => a.index - b.index).map(publicPage);
  res.json({ ...nb, scanned: pages.length, pages });
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
app.delete('/api/notebooks/:id', auth, async (req, res) => {
  const d = store.db(req.user.id);
  const i = d.notebooks.findIndex(n => n.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  d.notebooks.splice(i, 1);
  for (const p of d.pages.filter(p => p.notebookId === req.params.id)) await store.deleteImages(req.user.id, p.id).catch(() => {});
  d.pages = d.pages.filter(p => p.notebookId !== req.params.id);
  store.save(req.user.id);
  res.json({ ok: true });
});

// Save a scanned page (images as data URLs). Returns page; AI runs separately.
app.post('/api/notebooks/:id/pages', auth, async (req, res) => {
  const d = store.db(req.user.id);
  const nb = d.notebooks.find(n => n.id === req.params.id);
  if (!nb) return res.status(404).json({ error: 'Not found' });
  const { original, enhanced, thumb, index, filter } = req.body || {};
  if (!enhanced) return res.status(400).json({ error: 'Image required' });
  const existing = d.pages.filter(p => p.notebookId === nb.id);
  const idx = Number.isInteger(index) && index > 0 ? index : (existing.reduce((m, p) => Math.max(m, p.index), 0) + 1);
  const page = { id: store.uid(), notebookId: nb.id, index: idx, filter: filter || 'enhanced', title: '', transcript: '', keyPoints: [], vocab: [], status: 'scanned', createdAt: Date.now() };
  try {
    await store.saveImage(req.user.id, page.id, 'enh', enhanced);
    if (original) await store.saveImage(req.user.id, page.id, 'orig', original);
    if (thumb) await store.saveImage(req.user.id, page.id, 'thumb', thumb);
  } catch (e) { console.error('save image:', e.message); return res.status(400).json({ error: e.message }); }
  d.pages.push(page); nb.updatedAt = Date.now(); logActivity(req.user.id, 'scan');
  store.save(req.user.id);
  res.json(publicPage(page));
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
app.get('/api/pages/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  const p = d.pages.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const nb = d.notebooks.find(n => n.id === p.notebookId);
  const pages = d.pages.filter(x => x.notebookId === p.notebookId).sort((a, b) => a.index - b.index).map(publicPage);
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
app.delete('/api/pages/:id', auth, async (req, res) => {
  const d = store.db(req.user.id);
  const i = d.pages.findIndex(p => p.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  await store.deleteImages(req.user.id, d.pages[i].id).catch(() => {});
  const nbId = d.pages[i].notebookId;
  d.pages.splice(i, 1);
  d.pages.filter(p => p.notebookId === nbId).sort((a, b) => a.index - b.index).forEach((p, k) => { p.index = k + 1; });
  store.save(req.user.id);
  res.json({ ok: true });
});
app.get('/api/recent', auth, (req, res) => {
  const d = store.db(req.user.id);
  const n = Math.min(30, parseInt(req.query.n) || 10);
  res.json(d.pages.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, n).map(p => { const nb = d.notebooks.find(x => x.id === p.notebookId); return { id: p.id, index: p.index, title: p.title, status: p.status, createdAt: p.createdAt, rev: p.rev || 0, notebookId: p.notebookId, notebook: nb?.name || '', color: nb?.color || 'navy' }; }));
});
app.get('/api/search', auth, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const d = store.db(req.user.id);
  if (!q) return res.json([]);
  const hits = d.pages.filter(p => (p.title + ' ' + p.transcript + ' ' + (p.keyPoints || []).join(' ')).toLowerCase().includes(q))
    .map(p => { const nb = d.notebooks.find(n => n.id === p.notebookId); const t = p.transcript || ''; const i = t.toLowerCase().indexOf(q); return { id: p.id, notebookId: p.notebookId, notebook: nb?.name, index: p.index, title: p.title, snippet: i >= 0 ? t.slice(Math.max(0, i - 60), i + 80) : t.slice(0, 140) }; });
  res.json(hits.slice(0, 50));
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
  const data = (await store.readImageBase64(req.user.id, p.id, 'enh')) || (await store.readImageBase64(req.user.id, p.id, 'orig'));
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
  const data = (await store.readImageBase64(req.user.id, p.id, 'enh')) || (await store.readImageBase64(req.user.id, p.id, 'orig'));
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
    const counts = { correct: 0, partial: 0, wrong: 0, blank: 0 };
    for (const m of merged) counts[m.verdict]++;
    const percent = merged.length ? Math.round(100 * (counts.correct + 0.5 * counts.partial) / merged.length) : 0;
    p.homework = { items: merged, score: { ...counts, percent }, tips: Array.isArray(chk.tips) ? chk.tips.map(String).slice(0, 6) : [], summary: String(chk.summary || ''), assignment: String(ext.assignment || ''), checkedAt: Date.now() };
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
  const data = (await store.readImageBase64(req.user.id, p.id, 'enh')) || (await store.readImageBase64(req.user.id, p.id, 'orig'));
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
app.get('/api/study', auth, (req, res) => res.json(store.db(req.user.id).study.map(s => ({ ...s, chat: undefined }))));
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
app.get('/api/study/:id', auth, (req, res) => {
  const s = store.db(req.user.id).study.find(s => s.id === req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'Not found' });
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
app.post('/api/study/:id/test', auth, async (req, res) => {
  const [d, s] = getStudy(req, res); if (!s) return;
  const count = Math.max(1, Math.min(50, parseInt(req.body.count) || 10));
  const types = (Array.isArray(req.body.types) ? req.body.types : ['mc', 'tf', 'short']).filter(t => TYPE_DESC[t]);
  if (!types.length) types.push('mc', 'tf', 'short');
  const diffN = Math.max(1, Math.min(5, parseInt(req.body.difficulty) || 3));
  const difficulty = ['very easy (basic recall, friendly wording)', 'easy', 'medium / mixed', 'hard (multi-step, apply ideas)', 'very hard (tricky, exam-level, combine ideas)'][diffN - 1];
  const style = ['remake', 'prompt'].includes(req.body.style) ? req.body.style : 'standard';
  const about = String(req.body.about || '').slice(0, 1000);
  const instructions = String(req.body.instructions || '').slice(0, 2000);
  const freePrompt = String(req.body.prompt || '').slice(0, 3000);
  if (Array.isArray(req.body.links) && req.body.links.length) { s.links = [...new Set([...(s.links || []), ...req.body.links.map(u => String(u).trim()).filter(u => /^https?:\/\//i.test(u))])].slice(0, 10); await ensureLinks(s); }
  const wantHints = req.body.hints !== false;
  const pageIds = Array.isArray(req.body.pageIds) ? req.body.pageIds.filter(id => (s.pageIds || []).includes(id)) : [];
  try {
    const seen = s.tests?.length ? 'Avoid repeating these earlier questions: ' + s.tests.flatMap(t => t.questions.map(q => q.question)).slice(-40).join(' | ') : '';
    const extra = `${about ? '\nWHAT THE TEST IS ABOUT (from the student): ' + about : ''}${instructions ? '\nSTUDENT\'S INSTRUCTIONS FOR THIS TEST (follow them closely): ' + instructions : ''}`;
    const hintLine = wantHints ? '\nFor every question also give a "hint": one short nudge that helps without giving the answer away.' : '';
    const prompt = style === 'prompt'
      ? `${studyContext(d, s, pageIds)}\n${extra}
THE STUDENT'S REQUEST (build EXACTLY what they ask for — number of questions, topics, question types, difficulty, format, wording style; if they don't say, pick sensible defaults around ${count} questions): <<<${freePrompt || 'Make a good practice test on this material.'}>>>
Allowed question types: ${Object.values(TYPE_DESC).join('; ')}.${hintLine} ${seen}
Return ONLY JSON:
{"title":"...","description":"1-2 sentences: what this test covers","questions":[
 {"id":"q1","type":"mc","question":"...","choices":["...","...","...","..."],"answer":0,"explanation":"why","hint":"..."},
 {"id":"q2","type":"tf","question":"...","answer":true,"explanation":"why","hint":"..."},
 {"id":"q3","type":"short","question":"...","answer":"model answer","explanation":"...","hint":"..."},
 {"id":"q4","type":"fill","question":"... ____ ...","answer":"...","explanation":"...","hint":"..."},
 {"id":"q5","type":"explain","question":"...","answer":"model answer","explanation":"rubric","hint":"..."}
]}`
      : style === 'remake'
      ? `${studyContext(d, s, pageIds)}\n${extra}
Make a PRACTICE WORKSHEET that is a copy of the student's page(s) but with DIFFERENT NUMBERS / values / examples: keep the same kinds of problems, the same order and the same difficulty, and the same skills being practiced (e.g. if the page has "3/4 + 1/8", write "2/5 + 3/10"; if it has a definition to fill in, ask for a similar term from the same topic; if it has a worked example, give a fresh one to solve). Aim for about ${count} problems (fewer only if the page has fewer). Difficulty: ${difficulty}. Every problem is a short-answer question the student solves and types; give the exact model answer and a short solution/explanation.${hintLine} ${seen}
Return ONLY JSON:
{"title":"...","description":"1-2 sentences: what this worksheet practices and where it came from","questions":[
 {"id":"q1","type":"short","question":"the new problem (LaTeX for math)","answer":"model answer","explanation":"short solution steps","hint":"..."}
]}`
      : `${studyContext(d, s, pageIds)}\n${extra}
Write a practice test with exactly ${count} questions. Allowed question types (use a good mix of the allowed ones): ${types.map(t => TYPE_DESC[t]).join('; ')}. Difficulty: ${difficulty}. Cover the material evenly; make it feel like a real school test on this topic.${hintLine} ${seen}
Return ONLY JSON:
{"title":"...","description":"1-2 sentences: what this test covers and what to focus on","questions":[
 {"id":"q1","type":"mc","question":"...","choices":["...","...","...","..."],"answer":0,"explanation":"why","hint":"..."},
 {"id":"q2","type":"tf","question":"...","answer":true,"explanation":"why","hint":"..."},
 {"id":"q3","type":"short","question":"...","answer":"model answer","explanation":"what a good answer must include","hint":"..."},
 {"id":"q4","type":"fill","question":"The powerhouse of the cell is the ____.","answer":"mitochondria","explanation":"...","hint":"..."},
 {"id":"q5","type":"explain","question":"Explain why ...","answer":"model answer with key points","explanation":"rubric: what earns full credit","hint":"..."}
]}`;
    const out = await ai.completeJSON({
      system: 'You are an expert teacher who writes fair, accurate practice tests and worksheets. Output ONLY JSON. Inside JSON strings, write math as LaTeX with $...$ (escape backslashes as \\\\ for valid JSON).\n' + MATH_RULES,
      prompt, maxTokens: 7000, effort: 'medium',
    });
    const test = { id: store.uid(), title: out.title || s.title + (style === 'remake' ? ' Worksheet' : ' Practice Test'), description: String(out.description || ''), style, about, instructions, prompt: freePrompt, difficulty: diffN, pageIds, questions: (out.questions || []).map((q, i) => ({ ...q, id: q.id || 'q' + (i + 1), type: style === 'remake' ? 'short' : (TYPE_DESC[q.type] ? q.type : 'short'), hint: wantHints ? String(q.hint || '') : '' })), createdAt: Date.now(), attempts: [] };
    if (!test.questions.length) throw new Error('The AI returned no questions — try again');
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
        system: 'You are a fair, encouraging teacher grading student answers. Output ONLY JSON. For math, accept equivalent forms (3/4 = 0.75 = $\\\\frac{3}{4}$, unsimplified fractions if the question did not ask to simplify, different variable order) and ignore formatting differences.',
        prompt: `Grade each student answer. Be fair: accept different wording if the meaning is right; for "fill" accept synonyms/plural/singular and equivalent numbers; for "explain" give partial credit for partially correct reasoning. Score 0-1 (1 = fully correct, 0.5 = partially correct, 0 = wrong) and one or two sentences of specific feedback that teaches.\n${JSON.stringify(toAI, null, 1)}\nReturn ONLY JSON: [{"id":"q3","score":1,"feedback":"..."}]`,
        maxTokens: 3000, effort: 'low',
      });
      for (const g of graded) if (results[g.id] === undefined) results[g.id] = { correct: Number(g.score) >= 0.75, score: Math.max(0, Math.min(1, Number(g.score) || 0)), feedback: g.feedback || '' };
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
    const cards = (out.cards || []).filter(c => c && c.front && c.back).map(c => ({ id: store.uid(), front: String(c.front), back: String(c.back), hint: c.hint ? String(c.hint) : '', box: 0, seen: 0 }));
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

// SPA fallback
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const BUILD_ID = String(Date.now());
app.get('/api/version', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ v: BUILD_ID }); });
app.get('/api/health', (req, res) => res.json({ ok: true, storage: store.backendName(), ai: ai.AVAILABLE ? ai.BACKEND + ': ' + ai.modelLabel() : 'unconfigured' }));

const PORT = process.env.PORT || 4980;
store.init().then(async () => {
  try { await notify.init(); } catch (e) { console.error('notify init failed:', e.message); }
  app.listen(PORT, () => console.log(`Digital WorkBook running at http://localhost:${PORT}  (AI: ${ai.AVAILABLE ? ai.BACKEND : 'NOT CONFIGURED'})`));
}).catch(e => { console.error('Storage init failed:', e); process.exit(1); });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { try { await store.flushAll(); } catch {} process.exit(0); });
