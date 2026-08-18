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

app.get('/api/me', (req, res) => res.json({ user: req.user ? store.users.public(req.user) : null, ai: { mode: ai.BACKEND, model: ai.modelLabel(), available: ai.AVAILABLE, webSearch: ai.HAS_WEB_SEARCH }, storage: store.backendName() }));

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
  const nb = { id: store.uid(), name: name.trim().slice(0, 80), subject: (subject || '').trim().slice(0, 60), color: color || 'navy', pageCount: Math.max(1, Math.min(500, parseInt(pageCount) || 20)), description: (description || '').slice(0, 500), createdAt: Date.now(), updatedAt: Date.now() };
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
  if (pageCount) nb.pageCount = Math.max(1, Math.min(500, parseInt(pageCount) || nb.pageCount));
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
  d.pages.push(page); nb.updatedAt = Date.now();
  if (idx > nb.pageCount) nb.pageCount = idx;
  store.save(req.user.id);
  res.json(publicPage(page));
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
  const { title, transcript, keyPoints, vocab, index, enhanced, filter } = req.body || {};
  if (title !== undefined) p.title = String(title).slice(0, 120);
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
  d.pages.splice(i, 1); store.save(req.user.id);
  res.json({ ok: true });
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
  try {
    const out = await ai.completeJSON({
      system: `You are an expert at reading students' handwritten and printed school notes (any subject: math, science, history, English, languages) and turning them into clean digital notes. Notebook: "${nb?.name || ''}" (subject: ${nb?.subject || 'unknown'}).\n${MATH_RULES}`,
      images: [{ mediaType: 'image/jpeg', data }],
      prompt: `Read this notebook page carefully — every line, including margins, boxes, arrows, and small notes. Then transcribe it into clean, well-organized Markdown that keeps the student's structure (headings, bullets, numbered steps, definitions, worked examples, formulas, tables). Rules:
- Be FAITHFUL: transcribe what is written; fix obvious spelling slips but do NOT add new content that isn't on the page.
- Follow the MATH & SYMBOL NOTATION rules exactly (fractions, repeating decimals, exponents, ×/÷, ≥, π, angles, degrees…). Every equation, fraction and formula must be LaTeX.
- Keep the student's color/emphasis cues: things circled, boxed, starred, underlined or written in a different color are important → **bold** them (and keep ★ / ✓ marks). If a colored heading or label is used as a category (e.g. red = "test", green = "plants only"), keep it as its own line/heading.
- Diagrams/drawings/graphs → short *italic* description in place.
- If part is unreadable, write [unclear]. If the page is upside-down/sideways, still read it correctly.
Then return ONLY JSON:
{
 "title": "short title for this page (max 8 words)",
 "transcript": "the markdown transcript",
 "keyPoints": ["3-7 most important facts/ideas/formulas on this page (LaTeX for math)"],
 "vocab": [{"term":"...","definition":"..."}],   // key terms/formulas defined on the page (may be empty)
 "topics": ["1-4 short topic tags"],
 "readability": "good" | "fair" | "poor"
}`,
      maxTokens: 6000, effort: 'medium',
    });
    p.title = String(out.title || '').slice(0, 120);
    p.transcript = String(out.transcript || '');
    p.keyPoints = Array.isArray(out.keyPoints) ? out.keyPoints.map(String) : [];
    p.vocab = Array.isArray(out.vocab) ? out.vocab.filter(v => v && v.term).map(v => ({ term: String(v.term), definition: String(v.definition || '') })) : [];
    p.topics = Array.isArray(out.topics) ? out.topics.map(String) : [];
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
function studyContext(d, s, pageIds) {
  const notes = pagesText(d, pageIds && pageIds.length ? pageIds : (s.pageIds || []));
  return `SUBJECT: ${s.subject || 'unknown'}\nTOPIC / TEST: ${s.title}${s.topic ? '\nTOPIC DETAILS: ' + s.topic : ''}\n\nSTUDENT'S NOTEBOOK NOTES:\n${notes || '(no notebook pages selected — use the topic only)'}`;
}
app.get('/api/study', auth, (req, res) => res.json(store.db(req.user.id).study.map(s => ({ ...s, chat: undefined }))));
app.post('/api/study', auth, (req, res) => {
  const { title, subject, topic, pageIds, eventId } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title required' });
  const d = store.db(req.user.id);
  const s = { id: store.uid(), title: String(title).slice(0, 120), subject: String(subject || '').slice(0, 60), topic: String(topic || '').slice(0, 1000), pageIds: Array.isArray(pageIds) ? pageIds : [], eventId: eventId || null, sheet: '', online: '', tests: [], cards: [], chat: [], createdAt: Date.now(), updatedAt: Date.now() };
  d.study.push(s);
  if (eventId) { const ev = d.events.find(e => e.id === eventId); if (ev) ev.studyId = s.id; }
  store.save(req.user.id); res.json(s);
});
app.get('/api/study/:id', auth, (req, res) => {
  const s = store.db(req.user.id).study.find(s => s.id === req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'Not found' });
});
app.patch('/api/study/:id', auth, (req, res) => {
  const d = store.db(req.user.id);
  const s = d.study.find(s => s.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  for (const k of ['title', 'subject', 'topic', 'pageIds', 'sheet', 'cards', 'cardProgress']) if (req.body[k] !== undefined) s[k] = req.body[k];
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
    s.sheet = text; s.updatedAt = Date.now(); store.save(req.user.id);
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
  const style = req.body.style === 'remake' ? 'remake' : 'standard';
  const about = String(req.body.about || '').slice(0, 1000);
  const instructions = String(req.body.instructions || '').slice(0, 2000);
  const wantHints = req.body.hints !== false;
  const pageIds = Array.isArray(req.body.pageIds) ? req.body.pageIds.filter(id => (s.pageIds || []).includes(id)) : [];
  try {
    const seen = s.tests?.length ? 'Avoid repeating these earlier questions: ' + s.tests.flatMap(t => t.questions.map(q => q.question)).slice(-40).join(' | ') : '';
    const extra = `${about ? '\nWHAT THE TEST IS ABOUT (from the student): ' + about : ''}${instructions ? '\nSTUDENT\'S INSTRUCTIONS FOR THIS TEST (follow them closely): ' + instructions : ''}`;
    const hintLine = wantHints ? '\nFor every question also give a "hint": one short nudge that helps without giving the answer away.' : '';
    const prompt = style === 'remake'
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
    const test = { id: store.uid(), title: out.title || s.title + (style === 'remake' ? ' Worksheet' : ' Practice Test'), description: String(out.description || ''), style, about, instructions, difficulty: diffN, pageIds, questions: (out.questions || []).map((q, i) => ({ ...q, id: q.id || 'q' + (i + 1), type: style === 'remake' ? 'short' : (TYPE_DESC[q.type] ? q.type : 'short'), hint: wantHints ? String(q.hint || '') : '' })), createdAt: Date.now(), attempts: [] };
    if (!test.questions.length) throw new Error('The AI returned no questions — try again');
    s.tests.push(test); s.updatedAt = Date.now(); store.save(req.user.id);
    res.json(test);
  } catch (e) { console.error('test:', e.message); res.status(500).json({ error: e.message }); }
});

const norm = (v) => String(v ?? '').toLowerCase().replace(/[$\\{}]/g, '').replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '').trim();
app.post('/api/study/:id/test/:tid/grade', auth, async (req, res) => {
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
    if (!dryRun) { test.attempts.push(attempt); s.updatedAt = Date.now(); store.save(req.user.id); }
    res.json(attempt);
  } catch (e) { console.error('grade:', e.message); res.status(500).json({ error: e.message }); }
});
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

app.get('/api/health', (req, res) => res.json({ ok: true, storage: store.backendName(), ai: ai.AVAILABLE ? ai.BACKEND + ': ' + ai.modelLabel() : 'unconfigured' }));

const PORT = process.env.PORT || 4980;
store.init().then(() => {
  app.listen(PORT, () => console.log(`Digital WorkBook running at http://localhost:${PORT}  (AI: ${ai.AVAILABLE ? ai.BACKEND : 'NOT CONFIGURED'})`));
}).catch(e => { console.error('Storage init failed:', e); process.exit(1); });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { try { await store.flushAll(); } catch {} process.exit(0); });
