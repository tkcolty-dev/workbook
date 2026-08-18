// Shared helpers: API, state, DOM, icons, modal, toast, markdown, dates, router.

export const state = { user: null, ai: null, notebooks: null, events: null, study: null };

// ---------- API ----------
export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !path.startsWith('/auth') && path !== '/me') { state.user = null; invalidate(); if (location.hash !== '#/login') location.hash = '#/login'; }
  if (!res.ok) throw new Error(data?.error || ('Request failed (' + res.status + ')'));
  return data;
}
api.patch = (p, body) => api(p, { method: 'PATCH', body });
api.del = (p) => api(p, { method: 'DELETE' });

// SSE POST stream
export async function stream(path, body, onText) {
  const res = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { let e = null; try { e = await res.json(); } catch {} throw new Error(e?.error || 'Request failed'); }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n'); buf = parts.pop();
    for (const part of parts) {
      const line = part.split('\n').find(l => l.startsWith('data: ')); if (!line) continue;
      const obj = JSON.parse(line.slice(6));
      if (obj.t) onText(obj.t);
      if (obj.error) throw new Error(obj.error);
    }
  }
}

// ---------- DOM ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export function render(html) { const app = $('#app'); app.innerHTML = html; window.scrollTo(0, 0); return app; }

// Markdown + math. Math ($..$, $$..$$, \(..\), \[..\]) is pulled out before Markdown so underscores/backslashes survive, rendered with KaTeX, then put back.
function extractMath(src) {
  const slots = [];
  const put = (tex, display) => {
    let html;
    try { html = (window.katex ? katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false }) : '<code>' + esc(tex) + '</code>'); }
    catch { html = '<code>' + esc(tex) + '</code>'; }
    slots.push(display ? `<div class="math-block">${html}</div>` : html);
    return `⟦M${slots.length - 1}⟧`;
  };
  let t = String(src || '');
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => put(tex.trim(), true));
  t = t.replace(/\\\[([\s\S]+?)\\\]/g, (m, tex) => put(tex.trim(), true));
  t = t.replace(/\\\(([\s\S]+?)\\\)/g, (m, tex) => put(tex.trim(), false));
  t = t.replace(/(^|[^\\$\w])\$([^$\n]+?)\$(?![\w$])/g, (m, pre, tex) => pre + put(tex.trim(), false));
  return { t, slots };
}
function restoreMath(html, slots) { return html.replace(/⟦M(\d+)⟧/g, (m, i) => slots[+i] || ''); }
export function md(text) {
  try { const { t, slots } = extractMath(text); return restoreMath(marked.parse(t, { breaks: true, gfm: true }), slots).replace(/<a /g, '<a target="_blank" rel="noopener" '); }
  catch { return '<pre>' + esc(text) + '</pre>'; }
}
// inline (no <p>): for questions, choices, flashcards, key points
export function mdi(text) {
  try { const { t, slots } = extractMath(text); return restoreMath(marked.parseInline(t, { gfm: true }), slots); }
  catch { return esc(text); }
}

// ---------- icons ----------
const I = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M9 7h7M9 11h5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  study: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 9v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16z"/><path d="m13 7 4 4"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  rotate: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5"/><path d="M4 17v3h16v-3"/>',
  logout: '<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M18 12H9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  flip: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  cards: '<rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 4h14v12"/>',
  quiz: '<path d="M9 11l2 2 4-4"/><rect x="4" y="3" width="16" height="18" rx="2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  sheet: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  print: '<path d="M7 8V3h10v5M5 8h14a2 2 0 0 1 2 2v6h-4v4H7v-4H3v-6a2 2 0 0 1 2-2z"/>',
};
// Brand mark: app-icon tile with a clean white notebook page and a small gold spark.
export const logoSvg = (size = 36) => `<svg class="logo-svg" style="width:${size}px;height:${size}px" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs><linearGradient id="wbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f6cff"/><stop offset="1" stop-color="#7b4dff"/></linearGradient></defs>
  <rect width="40" height="40" rx="11" fill="url(#wbg)"/>
  <g transform="rotate(-6 20 21)">
    <rect x="11" y="9" width="18" height="23" rx="3" fill="#fff"/>
    <path d="M23.5 9v4.5a2 2 0 0 0 2 2H29" fill="#dfe6ff"/>
    <path d="M14.5 17.5h8M14.5 22h11M14.5 26.5h7" stroke="#8fa2ff" stroke-width="1.8" stroke-linecap="round"/>
  </g>
  <path d="M31 6.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" fill="#ffd54a"/>
</svg>`;
export const icon = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${I[n] || ''}</svg>`;

// ---------- toast / modal ----------
export function toast(msg, kind = '') {
  const t = h(`<div class="toast ${kind}">${esc(msg)}</div>`);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, kind === 'err' ? 5000 : 2600);
}
export function modal(html, { wide = false, onClose } = {}) {
  const bg = h(`<div class="modal-bg"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`);
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc_); onClose && onClose(); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  document.addEventListener('keydown', esc_);
  document.body.appendChild(bg);
  $$('[data-close]', bg).forEach(b => b.addEventListener('click', close));
  const first = $('input, textarea, select', bg); if (first) setTimeout(() => first.focus(), 50);
  return { el: bg, close };
}
export function confirm(title, text, { danger = true, ok = 'Delete' } = {}) {
  return new Promise(resolve => {
    const m = modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="ok">${esc(ok)}</button></div>`, { onClose: () => resolve(false) });
    $('#ok', m.el).onclick = () => { resolve(true); m.el.remove(); };
  });
}
export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner ${btn.classList.contains('primary') || btn.classList.contains('dark') ? 'light' : ''}"></span> ${esc(label || 'Working…')}`; }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.html || btn.innerHTML; }
}

// ---------- dates ----------
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON = MONTHS.map(m => m.slice(0, 3));
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function daysUntil(iso) { const a = parseISO(todayISO()), b = parseISO(iso); return Math.round((b - a) / 86400000); }
export function fmtDate(iso, opts = {}) { const d = parseISO(iso); return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}${opts.year ? ' ' + d.getFullYear() : ''}`; }
export function fmtTime(t) { if (!t) return ''; const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`; }
export function countdown(iso) { const n = daysUntil(iso); if (n < 0) return `${-n} day${n === -1 ? '' : 's'} ago`; if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; return `in ${n} days`; }
export function ago(ts) { const s = (Date.now() - ts) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }

export const TYPES = { test: 'Test', quiz: 'Quiz', homework: 'Homework', project: 'Project', reminder: 'Reminder', other: 'Other' };
export const COLORS = ['navy', 'red', 'green', 'yellow', 'purple', 'teal', 'orange', 'pink', 'black', 'white'];

// ---------- data loaders ----------
export async function loadNotebooks(force) { if (!state.notebooks || force) state.notebooks = await api('/notebooks'); return state.notebooks; }
export async function loadEvents(force) { if (!state.events || force) state.events = await api('/events'); return state.events; }
export async function loadStudy(force) { if (!state.study || force) state.study = await api('/study'); return state.study; }
export function invalidate() { state.notebooks = state.events = state.study = null; }

// ---------- router ----------
const routes = [];
export function route(pattern, handler) { routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler }); }
export function go(hash) { location.hash = hash; }
export async function dispatch() {
  const path = (location.hash || '#/').slice(1).split('?')[0] || '/';
  const query = Object.fromEntries(new URLSearchParams((location.hash.split('?')[1] || '')));
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { try { await r.handler(m.groups || {}, query); } catch (e) { console.error(e); toast(e.message, 'err'); } return; }
  }
  go('#/');
}
