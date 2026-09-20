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
api.put = (p, body) => api(p, { method: 'PUT', body });
api.del = (p) => api(p, { method: 'DELETE' });
// raw binary upload (images) — no base64, no JSON
api.upload = async (path, blob, contentType = 'image/jpeg') => {
  const res = await fetch('/api' + path, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob });
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || ('Upload failed (' + res.status + ')'));
  return data;
};
// download a text file (exports)
export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } }

// ---------- theme ----------
export const getTheme = () => { try { return localStorage.getItem('dwb_theme') || 'auto'; } catch { return 'auto'; } };
export function setTheme(t) {
  try { localStorage.setItem('dwb_theme', t); } catch {}
  const r = document.documentElement; if (t === 'light' || t === 'dark') r.dataset.theme = t; else delete r.dataset.theme;
  document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
}
export const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && document.documentElement.classList.contains('sys-dark'));

// ---------- keyboard: one global listener; each view registers its own handler ----------
let viewKeys = null, pendingG = 0;
export function setKeys(fn) { viewKeys = fn; }
const isTyping = (e) => !!e.target.closest('input,textarea,select,[contenteditable]');
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); import('./palette.js').then(m => m.openPalette()); return; }
  if (!isTyping(e) && !e.metaKey && !e.ctrlKey && !e.altKey && !$('.modal-bg')) {
    if (e.key === '/') { e.preventDefault(); import('./palette.js').then(m => m.openPalette()); return; }
    if (e.key === '?') { e.preventDefault(); import('./palette.js').then(m => m.shortcutsHelp()); return; }
    if (e.key === 'g') { pendingG = Date.now(); return; }
    if (pendingG && Date.now() - pendingG < 900) { pendingG = 0; const to = { h: '#/', n: '#/notebooks', s: '#/scan', p: '#/planner', t: '#/study', r: '#/review', d: '#/grades', o: '#/progress', ',': '#/settings' }[e.key]; if (to) { e.preventDefault(); go(to); return; } }
  }
  if (viewKeys && !$('.modal-bg')) viewKeys(e);
});

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
// Page transcript with [[figure:N]] placeholders → figure slots (filled by hydrateFigures with crops of the scan).
export function mdPage(text, page) {
  const figs = page?.figures || [];
  let t = String(text || '');
  t = t.replace(/\[\[figure:(\d+)\]\]/gi, (m, n) => figs[+n - 1] ? `\n\n⟦FIG${+n - 1}⟧\n\n` : '');
  let html = md(t);
  html = html.replace(/<p>\s*⟦FIG(\d+)⟧\s*<\/p>|⟦FIG(\d+)⟧/g, (m, a, b) => { const i = +(a ?? b); const f = figs[i]; return f ? `<figure class="pg-fig" data-fig="${i}"><div class="fig-box"><canvas></canvas></div><figcaption>${esc(f.label || 'Figure')}</figcaption></figure>` : ''; });
  // figures the model listed but forgot to place → append at the end
  const placed = new Set([...html.matchAll(/data-fig="(\d+)"/g)].map(m => +m[1]));
  const rest = figs.map((f, i) => i).filter(i => !placed.has(i));
  if (rest.length) html += `<div class="pg-figs">${rest.map(i => `<figure class="pg-fig" data-fig="${i}"><div class="fig-box"><canvas></canvas></div><figcaption>${esc(figs[i].label || 'Figure')}</figcaption></figure>`).join('')}</div>`;
  return html;
}
const figImgCache = {};
export async function hydrateFigures(root, page) {
  const slots = $$('.pg-fig', root); if (!slots.length || !page?.figures?.length) return;
  const url = `/api/pages/${page.id}/image?kind=enh&r=${page.rev || 0}`;
  let img = figImgCache[url];
  if (!img) { img = new Image(); img.src = url; figImgCache[url] = img; }
  if (!img.complete || !img.naturalWidth) await new Promise(r => { img.onload = r; img.onerror = r; });
  if (!img.naturalWidth) return;
  const IW = img.naturalWidth, IH = img.naturalHeight;
  for (const el of slots) {
    const f = page.figures[+el.dataset.fig]; if (!f) continue;
    const [x, y, w, h] = f.box; const sx = x * IW, sy = y * IH, sw = Math.max(8, w * IW), sh = Math.max(8, h * IH);
    const cv = $('canvas', el); const scale = Math.min(1, 1200 / sw);
    cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
    cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    el.onclick = () => { const m = modal(`<div style="text-align:center"><img src="${cv.toDataURL('image/jpeg', 0.92)}" style="max-width:100%;max-height:80vh;border-radius:8px"><div class="muted small" style="margin-top:8px">${esc(f.label || 'Figure')} · from page ${page.index}</div></div>`, { wide: true }); };
  }
}
// plain-text excerpt of markdown (for lists/search snippets)
export function plain(text, n = 140) {
  let t = String(text || '');
  t = t.replace(/\[\[figure:\d+\]\]/gi, '🖼').replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (m, a, b) => (a || b || '').replace(/\\(frac|dfrac)\{([^}]*)\}\{([^}]*)\}/g, '$2/$3').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, ''));
  t = t.replace(/^#+\s*/gm, '').replace(/[*_`>~]/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
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
  grades: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  review: '<rect x="3" y="6" width="13" height="14" rx="2"/><path d="M8 3h13v14"/><path d="m6 13 2 2 4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 17v-6h2a2 2 0 0 1 0 4H9"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6"/>',
  wand: '<path d="m4 20 10-10M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.7 1.3L21 13l-1.3.7L19 15l-.7-1.3L17 13l1.3-.7z"/>',
  translate: '<path d="M4 5h8M8 3v2c0 4-2 7-5 9M6 9c1 2 3 4 6 5"/><path d="m13 21 4-9 4 9M14.5 17.5h5"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/><path d="M12 8v4l3 2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="m11 11 9-9M17 5l2 2M14 8l2 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-8 8"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  fire: '<path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  clip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
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
// toast(msg, kind, { action: { label, fn }, ms }) — an action button turns it into an undo bar
export function toast(msg, kind = '', opts = {}) {
  const t = h(`<div class="toast ${kind}" role="status"><span>${esc(msg)}</span>${opts.action ? `<button type="button">${esc(opts.action.label)}</button>` : ''}</div>`);
  $('#toasts').appendChild(t);
  const gone = () => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); };
  if (opts.action) $('button', t).onclick = () => { gone(); opts.action.fn(); };
  setTimeout(gone, opts.ms || (kind === 'err' ? 5000 : opts.action ? 7000 : 2600));
  return { close: gone };
}
window.addEventListener('hashchange', () => { $$('.modal-bg').forEach(m => { if (!m.dataset.sticky) m.remove(); }); });
export function modal(html, { wide = false, onClose, cls = '' } = {}) {
  const bg = h(`<div class="modal-bg ${cls}"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`);
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
export const plural = (n, word, pl) => `${n} ${n === 1 ? word : (pl || word + 's')}`;
export const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m} min`);
export const loading = (label = 'Loading…') => `<div class="thinking" role="status"><span class="spinner"></span> ${esc(label)}</div>`;

// ---------- data loaders ----------
export async function loadNotebooks(force) { if (!state.notebooks || force) state.notebooks = await api('/notebooks'); return state.notebooks; }
export async function loadEvents(force) { if (!state.events || force) state.events = await api('/events'); return state.events; }
export async function loadStudy(force) { if (!state.study || force) state.study = await api('/study'); return state.study; }
export function invalidate() { state.notebooks = state.events = state.study = null; }

// ---------- router ----------
const routes = [];
export function route(pattern, handler) { routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler }); }
export function go(hash) { location.hash = hash; }
let navSeq = 0;
export async function dispatch() {
  const path = (location.hash || '#/').slice(1).split('?')[0] || '/';
  const query = Object.fromEntries(new URLSearchParams((location.hash.split('?')[1] || '')));
  const seq = ++navSeq; setKeys(null);
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { try { await r.handler(m.groups || {}, query); } catch (e) { if (seq !== navSeq) return; console.error(e); toast(e.message, 'err'); } return; }
  }
  go('#/');
}
// views that await data can check this to drop a render the user already navigated away from
export const navId = () => navSeq;
export const stale = (seq) => seq !== navSeq;
