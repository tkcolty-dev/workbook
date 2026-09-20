// Storage. Two backends:
//   - files (default): data/users.json, data/sessions.json, data/u/<uid>/db.json + img/*.jpg
//   - postgres: when VCAP_SERVICES (Cloud Foundry) has a postgres binding or DATABASE_URL is set.
//     docs(key text pk, value jsonb) + blobs(key text pk, data bytea). Everything doc-shaped is cached in memory.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.join(__dirname, 'data');
const uid = () => crypto.randomUUID();

// ---------- backend selection ----------
function pgConfig() {
  if (process.env.VCAP_SERVICES) {
    try {
      const vcap = JSON.parse(process.env.VCAP_SERVICES);
      const svc = Object.values(vcap).flat().find(s => /postgres/i.test(s.label || '') || /postgres/i.test((s.tags || []).join(',')) || /postgres/i.test(s.name || ''));
      if (svc) {
        const c = svc.credentials || {};
        if (c.uri || c.url || c.jdbcUrl) return { connectionString: (c.uri || c.url || '').replace(/^jdbc:/, ''), ssl: false };
        return { host: c.hostname || c.host || (c.hosts && c.hosts[0]), port: c.port || 5432, database: c.db || c.name || c.dbname || c.database || 'postgres', user: c.user || c.username, password: c.password, ssl: false };
      }
    } catch (e) { console.error('VCAP_SERVICES parse error', e.message); }
  }
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : false };
  return null;
}

let backend; // { name, loadDocs(prefix)->[{key,value}], saveDoc(key,value), putBlob(key,buf), getBlob(key)->buf|null, delBlob(key) }

function fileBackend() {
  fs.mkdirSync(DATA, { recursive: true });
  const docPath = (key) => key.startsWith('u:') ? path.join(DATA, 'u', key.slice(2), 'db.json') : path.join(DATA, key + '.json');
  const blobPath = (key) => { const [u, file] = key.split('/'); return path.join(DATA, 'u', u, 'img', file + '.jpg'); };
  return {
    name: 'files',
    async loadDocs(prefix) {
      const out = [];
      if (prefix === 'u:') {
        const dir = path.join(DATA, 'u');
        if (fs.existsSync(dir)) for (const u of fs.readdirSync(dir)) { try { out.push({ key: 'u:' + u, value: JSON.parse(fs.readFileSync(path.join(dir, u, 'db.json'), 'utf8')) }); } catch {} }
      } else { try { out.push({ key: prefix, value: JSON.parse(fs.readFileSync(docPath(prefix), 'utf8')) }); } catch {} }
      return out;
    },
    async saveDoc(key, value) { const f = docPath(key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(value, null, 1)); fs.renameSync(f + '.tmp', f); },
    async putBlob(key, buf) { const f = blobPath(key); fs.mkdirSync(path.dirname(f), { recursive: true }); await fs.promises.writeFile(f, buf); },
    async getBlob(key) { try { return await fs.promises.readFile(blobPath(key)); } catch { return null; } },
    async delBlob(key) { try { await fs.promises.unlink(blobPath(key)); } catch {} },
  };
}

function pgBackend(cfg) {
  const { Pool } = require('pg');
  const pool = new Pool({ ...cfg, max: 5 });
  const cacheDir = path.join(require('os').tmpdir(), 'dwb-cache'); fs.mkdirSync(cacheDir, { recursive: true });
  const cpath = (key) => path.join(cacheDir, key.replace(/[^\w.-]/g, '_'));
  return {
    name: 'postgres',
    async init() {
      await pool.query('CREATE TABLE IF NOT EXISTS docs (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz DEFAULT now())');
      await pool.query('CREATE TABLE IF NOT EXISTS blobs (key text PRIMARY KEY, data bytea NOT NULL, updated_at timestamptz DEFAULT now())');
    },
    async loadDocs(prefix) {
      const r = prefix.endsWith(':') ? await pool.query('SELECT key, value FROM docs WHERE key LIKE $1', [prefix + '%']) : await pool.query('SELECT key, value FROM docs WHERE key = $1', [prefix]);
      return r.rows;
    },
    async saveDoc(key, value) { await pool.query('INSERT INTO docs (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [key, JSON.stringify(value)]); },
    async putBlob(key, buf) { await pool.query('INSERT INTO blobs (key, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [key, buf]); try { await fs.promises.writeFile(cpath(key), buf); } catch {} },
    async getBlob(key) {
      try { return await fs.promises.readFile(cpath(key)); } catch {}
      const r = await pool.query('SELECT data FROM blobs WHERE key = $1', [key]);
      const buf = r.rows[0]?.data || null;
      if (buf) { try { await fs.promises.writeFile(cpath(key), buf); } catch {} }
      return buf;
    },
    async delBlob(key) { await pool.query('DELETE FROM blobs WHERE key = $1', [key]); try { await fs.promises.unlink(cpath(key)); } catch {} },
  };
}

// ---------- in-memory state + debounced persistence ----------
let users = [], sessions = {}, shares = {};
const dbs = new Map();
const timers = new Map();
function persist(key, getValue) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); backend.saveDoc(key, getValue()).catch(e => console.error('save failed', key, e.message)); }, 150));
}
async function flushAll() {
  const pending = [...timers.entries()];
  for (const [key, t] of pending) { clearTimeout(t); timers.delete(key); }
  await Promise.all(pending.map(([key]) => backend.saveDoc(key, key === 'users' ? users : key === 'sessions' ? sessions : key === 'shares' ? shares : misc[key] !== undefined ? misc[key] : dbs.get(key.slice(2))).catch(() => {})));
}

async function init() {
  const cfg = pgConfig();
  backend = cfg ? pgBackend(cfg) : fileBackend();
  if (backend.init) await backend.init();
  users = (await backend.loadDocs('users'))[0]?.value || [];
  sessions = (await backend.loadDocs('sessions'))[0]?.value || {};
  shares = (await backend.loadDocs('shares'))[0]?.value || {};
  for (const { key, value } of await backend.loadDocs('u:')) dbs.set(key.slice(2), normalizeDb(value));
  const pruned = sessionsApi.prune();
  let purged = 0; for (const id of dbs.keys()) purged += await purgeTrash(id).catch(() => 0);
  console.log(`Storage: ${backend.name} (${users.length} users, ${dbs.size} user dbs${pruned ? ', pruned ' + pruned + ' old sessions' : ''}${purged ? ', purged ' + purged + ' trashed items' : ''})`);
  return backend.name;
}
function emptyDb() { return { notebooks: [], pages: [], events: [], study: [], trash: [], activity: {}, grades: null }; }
function normalizeDb(v) { const e = emptyDb(); for (const k of Object.keys(e)) if (v[k] === undefined) v[k] = e[k]; return v; }

// ---------- users & sessions ----------
function hashPassword(pw, salt) { salt = salt || crypto.randomBytes(16).toString('hex'); return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') }; }
function verifyPassword(pw, salt, hash) { return crypto.timingSafeEqual(crypto.scryptSync(pw, salt, 64), Buffer.from(hash, 'hex')); }
const saveUsers = () => persist('users', () => users);
const saveSessions = () => persist('sessions', () => sessions);

const usersApi = {
  all: () => users,
  find: (username) => users.find(u => u.username.toLowerCase() === String(username).toLowerCase()),
  byId: (id) => users.find(u => u.id === id),
  create: ({ username, password, name }) => { const { salt, hash } = hashPassword(password); const u = { id: uid(), username, name: name || username, salt, hash, createdAt: Date.now() }; users.push(u); saveUsers(); return u; },
  verify: (u, password) => verifyPassword(password, u.salt, u.hash),
  setPassword: (u, password) => { Object.assign(u, hashPassword(password)); saveUsers(); },
  update: (u, patch) => { Object.assign(u, patch); saveUsers(); },
  public: (u) => ({ id: u.id, username: u.username, name: u.name, createdAt: u.createdAt, settings: u.settings || {} }),
};
const SESSION_IDLE_MS = 90 * 24 * 3600 * 1000;
const sessionsApi = {
  create: (userId, remember = true) => { const t = crypto.randomBytes(32).toString('hex'); sessions[t] = { userId, remember, createdAt: Date.now(), lastSeen: Date.now() }; saveSessions(); return t; },
  get: (t) => { const s = sessions[t]; if (!s) return null; if (Date.now() - (s.lastSeen || s.createdAt) > SESSION_IDLE_MS) { delete sessions[t]; saveSessions(); return null; } return s; },
  touch: (t) => { if (sessions[t]) { sessions[t].lastSeen = Date.now(); saveSessions(); } },
  destroy: (t) => { delete sessions[t]; saveSessions(); },
  destroyAllFor: (userId, except) => { for (const [t, s] of Object.entries(sessions)) if (s.userId === userId && t !== except) delete sessions[t]; saveSessions(); },
  prune: () => { let n = 0; for (const [t, s] of Object.entries(sessions)) if (Date.now() - (s.lastSeen || s.createdAt) > SESSION_IDLE_MS) { delete sessions[t]; n++; } if (n) saveSessions(); return n; },
};

// ---------- per-user db ----------
function db(userId) {
  if (!dbs.has(userId)) dbs.set(userId, emptyDb());
  return dbs.get(userId);
}
function save(userId) { persist('u:' + userId, () => dbs.get(userId)); }
// lookups (small arrays — a linear scan is cheaper than keeping indexes in sync)
const findNb = (d, id) => d.notebooks.find(n => n.id === id) || null;
const findPage = (d, id) => d.pages.find(p => p.id === id) || null;
const findStudy = (d, id) => d.study.find(s => s.id === id) || null;
const findEvent = (d, id) => d.events.find(e => e.id === id) || null;
const pagesOf = (d, nbId) => d.pages.filter(p => p.notebookId === nbId).sort((a, b) => a.index - b.index);
const nextIndex = (d, nbId) => d.pages.reduce((m, p) => (p.notebookId === nbId && p.index > m ? p.index : m), 0) + 1;
function reindex(d, nbId) { pagesOf(d, nbId).forEach((p, i) => { p.index = i + 1; }); }
// one pass over pages → { notebookId: count }
function scannedCounts(d) { const c = {}; for (const p of d.pages) c[p.notebookId] = (c[p.notebookId] || 0) + 1; return c; }

// ---------- images (async, binary) ----------
const IMAGE_KINDS = ['orig', 'enh', 'thumb'];
const blobKey = (userId, pageId, kind) => `${userId}/${pageId}-${kind}`;
async function saveImageBuffer(userId, pageId, kind, buf) { if (!IMAGE_KINDS.includes(kind)) throw new Error('bad image kind'); if (!buf?.length) throw new Error('empty image'); await backend.putBlob(blobKey(userId, pageId, kind), buf); }
async function saveImage(userId, pageId, kind, dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) throw new Error('bad image data');
  await saveImageBuffer(userId, pageId, kind, Buffer.from(m[2], 'base64'));
}
async function readImage(userId, pageId, kind) { return backend.getBlob(blobKey(userId, pageId, kind)); }
async function readImageBase64(userId, pageId, kind) { const b = await readImage(userId, pageId, kind); return b ? b.toString('base64') : null; }
// best image for AI reading: enhanced, else the original photo
async function readImageForAI(userId, pageId) { return (await readImageBase64(userId, pageId, 'enh')) || (await readImageBase64(userId, pageId, 'orig')); }
async function deleteImages(userId, pageId) { for (const k of IMAGE_KINDS) await backend.delBlob(blobKey(userId, pageId, k)); }
async function copyImages(fromUser, fromPage, toUser, toPage) { for (const k of IMAGE_KINDS) { const b = await backend.getBlob(blobKey(fromUser, fromPage, k)); if (b) await backend.putBlob(blobKey(toUser, toPage, k), b); } }

// ---------- trash (30-day undo for pages & notebooks; images are only deleted when the trash is purged) ----------
const TRASH_DAYS = 30;
function trashPage(d, page) {
  const i = d.pages.indexOf(page); if (i < 0) return null;
  d.pages.splice(i, 1); reindex(d, page.notebookId);
  const nb = findNb(d, page.notebookId);
  const item = { id: uid(), kind: 'page', deletedAt: Date.now(), page, notebookName: nb?.name || '', notebookColor: nb?.color || 'navy' };
  d.trash.unshift(item); return item;
}
function trashNotebook(d, nb) {
  const i = d.notebooks.indexOf(nb); if (i < 0) return null;
  d.notebooks.splice(i, 1);
  const pages = pagesOf(d, nb.id); d.pages = d.pages.filter(p => p.notebookId !== nb.id);
  const item = { id: uid(), kind: 'notebook', deletedAt: Date.now(), notebook: nb, pages };
  d.trash.unshift(item); return item;
}
function restoreTrash(d, itemId) {
  const i = d.trash.findIndex(t => t.id === itemId); if (i < 0) return null;
  const [item] = d.trash.splice(i, 1);
  if (item.kind === 'notebook') {
    if (!findNb(d, item.notebook.id)) d.notebooks.push(item.notebook);
    for (const p of item.pages) d.pages.push(p);
    reindex(d, item.notebook.id);
    return { kind: 'notebook', notebook: item.notebook };
  }
  const p = item.page;
  let nb = findNb(d, p.notebookId);
  if (!nb) { nb = { id: uid(), name: item.notebookName || 'Restored pages', subject: '', color: item.notebookColor || 'navy', pageCount: 0, description: '', createdAt: Date.now(), updatedAt: Date.now() }; d.notebooks.push(nb); p.notebookId = nb.id; }
  p.index = nextIndex(d, nb.id); d.pages.push(p); nb.updatedAt = Date.now();
  return { kind: 'page', page: p, notebook: nb };
}
async function purgeTrashItem(userId, item) { const pages = item.kind === 'page' ? [item.page] : item.pages; for (const p of pages) await deleteImages(userId, p.id).catch(() => {}); }
async function purgeTrash(userId, all = false) {
  const d = db(userId); const cutoff = Date.now() - TRASH_DAYS * 86400000; let n = 0;
  for (const item of d.trash.slice()) if (all || item.deletedAt < cutoff) { await purgeTrashItem(userId, item); d.trash.splice(d.trash.indexOf(item), 1); n++; }
  if (n) save(userId);
  return n;
}

const misc = {};
async function getDoc(key) { if (misc[key] !== undefined) return misc[key]; const r = await backend.loadDocs(key); misc[key] = r[0]?.value ?? null; return misc[key]; }
async function setDoc(key, value) { misc[key] = value; await backend.saveDoc(key, value); }
const sharesApi = () => shares; const saveShares = () => persist('shares', () => shares);
module.exports = {
  getDoc, setDoc, shares: sharesApi, saveShares, init, users: usersApi, sessions: sessionsApi, db, save, uid, flushAll, backendName: () => backend?.name, TRASH_DAYS,
  findNb, findPage, findStudy, findEvent, pagesOf, nextIndex, reindex, scannedCounts,
  saveImage, saveImageBuffer, readImage, readImageBase64, readImageForAI, deleteImages, copyImages,
  trashPage, trashNotebook, restoreTrash, purgeTrash, purgeTrashItem,
};
