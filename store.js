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
let users = [], sessions = {};
const dbs = new Map();
const timers = new Map();
function persist(key, getValue) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); backend.saveDoc(key, getValue()).catch(e => console.error('save failed', key, e.message)); }, 150));
}
async function flushAll() {
  const pending = [...timers.entries()];
  for (const [key, t] of pending) { clearTimeout(t); timers.delete(key); }
  await Promise.all(pending.map(([key]) => backend.saveDoc(key, key === 'users' ? users : key === 'sessions' ? sessions : dbs.get(key.slice(2))).catch(() => {})));
}

async function init() {
  const cfg = pgConfig();
  backend = cfg ? pgBackend(cfg) : fileBackend();
  if (backend.init) await backend.init();
  users = (await backend.loadDocs('users'))[0]?.value || [];
  sessions = (await backend.loadDocs('sessions'))[0]?.value || {};
  for (const { key, value } of await backend.loadDocs('u:')) { value.notebooks ||= []; value.pages ||= []; value.events ||= []; value.study ||= []; dbs.set(key.slice(2), value); }
  const pruned = sessionsApi.prune();
  console.log(`Storage: ${backend.name} (${users.length} users, ${dbs.size} user dbs${pruned ? ', pruned ' + pruned + ' old sessions' : ''})`);
  return backend.name;
}

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
  update: (u, patch) => { Object.assign(u, patch); saveUsers(); },
  public: (u) => ({ id: u.id, username: u.username, name: u.name, createdAt: u.createdAt, settings: u.settings || {} }),
};
const SESSION_IDLE_MS = 90 * 24 * 3600 * 1000;
const sessionsApi = {
  create: (userId, remember = true) => { const t = crypto.randomBytes(32).toString('hex'); sessions[t] = { userId, remember, createdAt: Date.now(), lastSeen: Date.now() }; saveSessions(); return t; },
  get: (t) => { const s = sessions[t]; if (!s) return null; if (Date.now() - (s.lastSeen || s.createdAt) > SESSION_IDLE_MS) { delete sessions[t]; saveSessions(); return null; } return s; },
  touch: (t) => { if (sessions[t]) { sessions[t].lastSeen = Date.now(); saveSessions(); } },
  destroy: (t) => { delete sessions[t]; saveSessions(); },
  prune: () => { let n = 0; for (const [t, s] of Object.entries(sessions)) if (Date.now() - (s.lastSeen || s.createdAt) > SESSION_IDLE_MS) { delete sessions[t]; n++; } if (n) saveSessions(); return n; },
};

// ---------- per-user db ----------
function db(userId) {
  if (!dbs.has(userId)) dbs.set(userId, { notebooks: [], pages: [], events: [], study: [] });
  return dbs.get(userId);
}
function save(userId) { persist('u:' + userId, () => dbs.get(userId)); }

// ---------- images (async) ----------
const blobKey = (userId, pageId, kind) => `${userId}/${pageId}-${kind}`;
async function saveImage(userId, pageId, kind, dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) throw new Error('bad image data');
  await backend.putBlob(blobKey(userId, pageId, kind), Buffer.from(m[2], 'base64'));
}
async function readImage(userId, pageId, kind) { return backend.getBlob(blobKey(userId, pageId, kind)); }
async function readImageBase64(userId, pageId, kind) { const b = await readImage(userId, pageId, kind); return b ? b.toString('base64') : null; }
async function deleteImages(userId, pageId) { for (const k of ['orig', 'enh', 'thumb']) await backend.delBlob(blobKey(userId, pageId, k)); }

const misc = {};
async function getDoc(key) { if (misc[key] !== undefined) return misc[key]; const r = await backend.loadDocs(key); misc[key] = r[0]?.value ?? null; return misc[key]; }
async function setDoc(key, value) { misc[key] = value; await backend.saveDoc(key, value); }
module.exports = { getDoc, setDoc, init, users: usersApi, sessions: sessionsApi, db, save, uid, saveImage, readImage, readImageBase64, deleteImages, flushAll, backendName: () => backend?.name };
