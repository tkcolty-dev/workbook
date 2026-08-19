// Scanner v2: point → snap → done. Every capture goes through an automatic pipeline
// (AI edge detection → straighten → enhance → upload → AI read) in the background while you keep shooting.
// Cropping/filters are optional ("Adjust") — from the tray or later from the page.
import { state, api, $, $$, esc, h, icon, toast, busy, modal, loadNotebooks, invalidate, go, ago } from './core.js';
import { shell, nbCover, notebookModal } from './app.js';
import { fileToCanvas, bitmapToCanvas, scaleCanvas, toDataURL, rotateCanvas, rotateCorners, FULL_CORNERS, warp, enhance, thumbnail, blurScore, upscaleTo, sharpen } from './imageproc.js';

let stream = null;
let S = null;              // session: { nbId, nb, items: [], filter, boost }
const FILTERS = [['enhanced', 'Enhanced ✦'], ['color', 'Soft color'], ['gray', 'Grayscale'], ['bw', 'B&W (no color)'], ['original', 'Original']];
const SHARPEN_AMOUNT = [0, 0.7, 1.4];

function stopCamera() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/scan')) stopCamera(); });

let HW_MODE = false;
export async function scanView({ id }, q = {}) {
  HW_MODE = !!q.hw;
  const main = shell('Scan', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const nbs = await loadNotebooks(true);
  let nbId = id || localStorage.getItem('dwb_last_nb') || nbs.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id || null;
  if (nbId && !nbs.find(n => n.id === nbId)) nbId = nbs[0]?.id || null;
  if (!nbId) {
    // zero friction: first scan just creates "My Notebook" — rename it any time
    const created = await api('/notebooks', { body: { name: 'My Notebook', subject: '', color: 'navy', pageCount: 0 } });
    invalidate(); return go('#/scan/' + created.id);
  }
  if (!S || S.nbId !== nbId) S = { nbId, items: [], filter: localStorage.getItem('dwb_filter') || 'enhanced', boost: +(localStorage.getItem('dwb_boost') ?? 1) };
  S.nb = nbs.find(n => n.id === nbId); S.nbs = nbs;
  localStorage.setItem('dwb_last_nb', nbId);
  renderCapture(main);
}

// ---------- capture screen ----------
async function renderCapture(main) {
  const nb = S.nb;
  main.innerHTML = `<div class="scan2">
    <div class="scan2-top">
      <div class="nb-pick" id="nbPick"><span class="muted small">Scanning into</span><button class="btn" id="pickBtn">${nbCoverMini(nb)} <b>${esc(nb.name)}</b> <span class="muted">· ${nb.scanned || 0} pages</span> ▾</button></div>
      <div class="btn-row"><button class="btn sm ghost" id="settings" title="Scan settings">${icon('settings')} Look</button><a class="btn sm" href="#/notebook/${nb.id}">${icon('book')} Open notebook</a></div>
    </div>
    ${HW_MODE ? `<div class="ai-status" style="margin-bottom:10px">${icon('check')} <b>Homework check mode</b> — snap your finished homework; after it's read, tap <b>Check</b> on it below and the AI grades every answer.</div>` : ''}
    <div class="scan-stage" id="stage"><div class="noCam"><span class="spinner light"></span></div></div>
    <div class="shutter-bar" id="shutterBar"></div>
    <div class="tray" id="tray"></div>
  </div>`;
  drawTray();
  $('#pickBtn').onclick = pickNotebook;
  $('#settings').onclick = scanSettings;
  const stage = $('#stage'), bar = $('#shutterBar');
  const fileBtn = (label, capture) => `<label class="btn filebtn ${capture ? 'primary lg' : ''}">${icon(capture ? 'camera' : 'upload')} ${label}<input type="file" accept="image/*" ${capture ? 'capture="environment"' : 'multiple'}></label>`;
  const canLive = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  bar.innerHTML = `${fileBtn('Take photo', true)}${fileBtn('Upload photos')}`;
  wireFiles(bar);
  if (canLive) {
    stage.innerHTML = `<div class="noCam"><span class="spinner light"></span><div class="small" style="margin-top:10px;opacity:.85">Starting camera… if your browser asks, click <b>Allow</b></div></div>`;
    try {
      if (!stream) stream = await openCamera();
      if (!location.hash.startsWith('#/scan') || !$('#stage')) return;
      const video = h('<video autoplay playsinline muted></video>'); video.srcObject = stream;
      stage.innerHTML = ''; stage.appendChild(video); stage.appendChild(h('<div class="guide"></div>'));
      video.play().catch(() => {});
      bar.innerHTML = `${fileBtn('Upload photos')}<button class="shutter" id="shot" title="Snap (space)"></button><button class="btn icon" id="flipCam" title="Flip camera">${icon('flip')}</button>`;
      $('#shot').onclick = () => { if (!video.videoWidth) return toast('Camera is still starting…'); flashStage(); addCapture(bitmapToCanvas(video, 2800)); };
      $('#flipCam').onclick = async () => { const cur = stream.getVideoTracks()[0].getSettings().facingMode; stopCamera(); try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cur === 'user' ? { ideal: 'environment' } : 'user' }, audio: false }); video.srcObject = stream; video.play().catch(() => {}); } catch (e) { toast('Could not switch camera', 'err'); renderCapture(main); } };
      wireFiles(bar);
      document.onkeydown = (e) => { if (e.code === 'Space' && !e.target.closest('input,textarea,button')) { e.preventDefault(); $('#shot')?.click(); } };
    } catch (e) {
      if (!$('#stage')) return;
      stage.innerHTML = `<div class="noCam"><div class="big">📷</div><b>Live camera didn’t start</b><div class="small" style="opacity:.85;margin-top:6px;max-width:420px">${cameraHelp(e)}</div><div class="btn-row" style="justify-content:center;margin-top:14px"><button class="btn" id="retryCam">${icon('refresh')} Retry camera</button></div><div class="small" style="opacity:.75;margin-top:10px">Or use “Take photo” below — it opens your camera app.</div></div>`;
      $('#retryCam').onclick = () => { stopCamera(); renderCapture(main); };
    }
  } else {
    stage.innerHTML = `<div class="noCam"><div class="big">📷</div><b>Tap “Take photo” to use your camera</b><div class="small" style="opacity:.8;margin-top:6px">${window.isSecureContext ? '' : 'Live camera preview needs HTTPS — the photo button works everywhere.'}</div></div>`;
  }
}
function flashStage() { const st = $('#stage'); if (!st) return; const f = h('<div class="snapflash"></div>'); st.appendChild(f); setTimeout(() => f.remove(), 260); }
function wireFiles(bar) {
  $$('input[type=file]', bar).forEach(inp => inp.onchange = async () => {
    const files = [...inp.files]; if (!files.length) return;
    for (const f of files) { try { addCapture(await fileToCanvas(f, 2800)); } catch (e) { toast('Could not read that image', 'err'); } }
    inp.value = '';
  });
}
function nbCoverMini(nb) { return `<span class="nb-dot color-${esc(nb.color || 'navy')}"></span>`; }
async function openCamera() {
  const attempts = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false },
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr = null;
  for (const c of attempts) {
    try { return await Promise.race([navigator.mediaDevices.getUserMedia(c), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('Camera did not respond'), { name: 'TimeoutError' })), 45000))]); }
    catch (e) { lastErr = e; if (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'NotFoundError') break; }
  }
  throw lastErr || new Error('Camera unavailable');
}
function cameraHelp(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Camera permission is blocked for this site. Click the camera / lock icon in the address bar, set Camera to <b>Allow</b>, then press Retry.';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'No camera was found on this device.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'The camera is busy or blocked by the system. Close other apps using it and check System Settings → Privacy & Security → Camera.';
  if (n === 'TimeoutError') return 'The browser never answered — look for a permission pop-up, then press Retry.';
  return esc(e?.message || 'Unknown error');
}

// ---------- notebook picker + settings ----------
async function pickNotebook() {
  const nbs = await loadNotebooks(true);
  const m = modal(`<h2>Scan into…</h2><div class="nb-list">${nbs.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(n => `<button class="nb-row ${n.id === S.nbId ? 'on' : ''}" data-id="${n.id}">${nbCoverMini(n)}<div><b>${esc(n.name)}</b><span class="muted small">${esc(n.subject || '')} · ${n.scanned || 0} pages</span></div>${n.id === S.nbId ? icon('check') : ''}</button>`).join('')}</div><div class="actions" style="justify-content:space-between"><button class="btn" id="newNb">${icon('plus')} New notebook</button><button class="btn" data-close>Done</button></div>`);
  $$('.nb-row', m.el).forEach(b => b.onclick = () => { m.close(); if (S.nbId === b.dataset.id) return; go('#/scan/' + b.dataset.id); });
  $('#newNb', m.el).onclick = () => { m.close(); notebookModal(null, { then: (nb) => go('#/scan/' + nb.id) }); };
}
function scanSettings() {
  const m = modal(`<h2>How scans should look</h2>
    <div class="field"><label>Look</label><div class="btn-row">${FILTERS.map(([k, l]) => `<button class="btn sm fpick ${S.filter === k ? 'primary' : ''}" data-f="${k}">${l}</button>`).join('')}</div><div class="help">Enhanced whitens the paper and keeps your pen colors. Applies to new scans; change any page later with Adjust.</div></div>
    <div class="field"><label>Readability boost</label><div class="seg" id="bseg"><button data-s="0" class="${S.boost === 0 ? 'active' : ''}">Off</button><button data-s="1" class="${S.boost === 1 ? 'active' : ''}">Auto</button><button data-s="2" class="${S.boost === 2 ? 'active' : ''}">Strong</button></div><div class="help">Sharpens text and upscales small/blurry photos so the AI reads them better. Auto = light, stronger when a photo looks soft.</div></div>
    <div class="actions"><button class="btn primary" data-close>Done</button></div>`);
  $$('.fpick', m.el).forEach(b => b.onclick = () => { S.filter = b.dataset.f; localStorage.setItem('dwb_filter', S.filter); $$('.fpick', m.el).forEach(x => x.classList.toggle('primary', x === b)); });
  $$('#bseg button', m.el).forEach(b => b.onclick = () => { S.boost = +b.dataset.s; localStorage.setItem('dwb_boost', S.boost); $$('#bseg button', m.el).forEach(x => x.classList.toggle('active', x === b)); });
}

// ---------- capture pipeline ----------
let running = 0; const queue = [];
function addCapture(src) {
  const item = { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), src, thumb: toDataURL(scaleCanvas(src, 300), 0.7), status: 'queued', label: 'Waiting…', corners: FULL_CORNERS(), rotation: 0, filter: S.filter, boost: S.boost, pageId: null, title: '', suggestions: [], nbId: S.nbId };
  S.items.unshift(item);
  drawTray();
  queue.push(item); pump();
}
function pump() {
  while (running < 2 && queue.length) { const it = queue.shift(); running++; processItem(it).finally(() => { running--; pump(); }); }
}
async function processItem(it) {
  const set = (status, label) => { it.status = status; it.label = label; drawTray(); };
  try {
    set('detect', 'Finding page edges…');
    try {
      const small = scaleCanvas(it.src, 900);
      const r = await api('/ai/corners', { body: { image: toDataURL(small, 0.8) } });
      if (r?.found && r.corners) {
        const c = {}; for (const k of ['tl', 'tr', 'br', 'bl']) { const v = r.corners[k]; c[k] = { x: Math.min(1, Math.max(0, +v[0])), y: Math.min(1, Math.max(0, +v[1])) }; }
        if (quadOk(c)) it.corners = c;
        if (r.rotation && [90, 180, 270].includes(+r.rotation)) { it.src = rotateCanvas(it.src, +r.rotation); it.corners = rotateCorners(it.corners, +r.rotation); it.rotation = +r.rotation; }
      }
    } catch (e) { console.warn('corners failed', e.message); }
    if (it.cancelled) return;
    set('process', 'Straightening & cleaning…');
    await new Promise(r => setTimeout(r, 10));
    const out = buildOutputs(it);
    it.thumb = out.thumb;
    if (it.cancelled) return;
    set('upload', 'Saving…');
    const page = await api(`/notebooks/${it.nbId}/pages`, { body: { ...out, filter: it.filter } });
    it.pageId = page.id; it.index = page.index; invalidate();
    if (S.nb && S.nb.id === it.nbId) { S.nb.scanned = (S.nb.scanned || 0) + 1; const b = $('#pickBtn'); if (b) b.innerHTML = `${nbCoverMini(S.nb)} <b>${esc(S.nb.name)}</b> <span class="muted">· ${S.nb.scanned} pages</span> ▾`; }
    set('read', 'AI reading page…');
    const done = await api(`/pages/${page.id}/analyze`, { body: {} });
    it.title = done.title; it.suggestions = done.suggestions || [];
    set('ready', done.title || 'Ready');
    if (it.suggestions.length) toast(`📅 Page ${it.index}: found "${it.suggestions[0].title}" — tap it below to add to your planner`);
  } catch (e) {
    console.error(e); set('error', 'Failed: ' + e.message);
  }
}
function quadOk(c) { // reject degenerate detections (tiny or crossed quads)
  const P = [c.tl, c.tr, c.br, c.bl]; let area = 0; for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; area += a.x * b.y - b.x * a.y; } area = Math.abs(area) / 2;
  return area > 0.08 && c.tr.x > c.tl.x && c.br.x > c.bl.x && c.bl.y > c.tl.y && c.br.y > c.tr.y;
}
function buildOutputs(it) {
  const score = blurScore(it.src); const blurry = score < 120;
  const boostLevel = it.boost === 0 ? 0 : it.boost === 2 ? 2 : (blurry ? 2 : 1);
  let warped = warp(it.src, it.corners, 2400);
  if (boostLevel) warped = upscaleTo(warped, boostLevel === 2 ? 2000 : 1600, 2400);
  let enhanced = enhance(warped, it.filter);
  if (boostLevel) enhanced = sharpen(enhanced, SHARPEN_AMOUNT[boostLevel]);
  return { enhanced: toDataURL(enhanced, 0.9), original: toDataURL(scaleCanvas(it.src, 1600), 0.8), thumb: toDataURL(thumbnail(enhanced, 420), 0.8) };
}

// ---------- tray ----------
function drawTray() {
  const tray = $('#tray'); if (!tray) return;
  if (!S.items.length) { tray.innerHTML = `<div class="tray-empty muted small">📸 Snap a page — it's cropped, cleaned and read automatically. Keep snapping; adjust anything later.</div>`; return; }
  const busyN = S.items.filter(i => !['ready', 'error'].includes(i.status)).length;
  tray.innerHTML = `<div class="tray-head"><b>${S.items.length} scanned this session</b>${busyN ? `<span class="muted small"><span class="spinner" style="width:12px;height:12px"></span> ${busyN} processing</span>` : '<span class="chip green">all done ✓</span>'}<a class="btn sm ghost" href="#/notebook/${S.nbId}">See all pages ${icon('chevR')}</a></div>
    <div class="tray-items">${S.items.map(it => `<div class="tray-item ${it.status}" data-id="${it.id}"><div class="ti-img" style="background-image:url('${it.thumb}')">${it.status !== 'ready' && it.status !== 'error' ? '<div class="ti-spin"><span class="spinner light"></span></div>' : ''}${it.status === 'ready' ? '<div class="ti-ok">✓</div>' : it.status === 'error' ? '<div class="ti-ok err">!</div>' : ''}</div>
      <div class="ti-cap"><b>${it.index ? 'p.' + it.index + ' ' : ''}${esc(it.title || '')}</b><span class="muted">${esc(it.label)}</span></div>
      <div class="ti-actions"><button class="btn sm ghost adj" title="Adjust crop / look">${icon('edit')}</button>${it.pageId ? `<a class="btn sm ghost" href="#/page/${it.pageId}" title="Open page">${icon('eye')}</a>` : ''}${it.pageId && it.status === 'ready' ? `<button class="btn sm ${HW_MODE ? 'primary' : 'ghost'} hwk" title="Check as homework">${icon('check')}</button>` : ''}${it.status === 'error' ? `<button class="btn sm retry">${icon('refresh')}</button>` : `<button class="btn sm ghost del" title="Delete">${icon('trash')}</button>`}</div>
      ${it.suggestions?.some(s => !s.done) ? `<div class="ti-sug">${it.suggestions.map((sg, k) => sg.done ? '' : `<button class="chip amber sug" data-k="${k}">📅 ${esc(sg.title)}${sg.date ? ' · ' + esc(sg.date) : ''} → planner</button>`).join('')}</div>` : ''}
    </div>`).join('')}</div>`;
  $$('.tray-item', tray).forEach(el => {
    const it = S.items.find(i => i.id === el.dataset.id);
    $('.adj', el).onclick = () => openAdjust(it);
    const del = $('.del', el); if (del) del.onclick = async () => { if (it.pageId) { await api.del('/pages/' + it.pageId).catch(() => {}); invalidate(); if (S.nb) S.nb.scanned = Math.max(0, (S.nb.scanned || 1) - 1); } it.cancelled = true; S.items = S.items.filter(i => i !== it); drawTray(); };
    const rt = $('.retry', el); if (rt) rt.onclick = () => { it.status = 'queued'; queue.push(it); pump(); drawTray(); };
    $$('.sug', el).forEach(b => b.onclick = () => addSuggestion(it, it.suggestions[+b.dataset.k]));
    const hk = $('.hwk', el); if (hk) hk.onclick = async () => { const { checkHomework } = await import('./app.js'); checkHomework({ id: it.pageId }, S.nb); };
  });
}
async function addSuggestion(it, sg) {
  if (!sg) return;
  const { eventModal } = await import('./app.js');
  eventModal(null, sg.date || undefined, { title: sg.title, type: sg.type || 'test', subject: S.nb?.subject || '', notes: sg.notes || '', notebookId: S.nbId, onSaved: () => { sg.done = true; if (it.pageId) api.patch('/pages/' + it.pageId, { suggestions: it.suggestions }).catch(() => {}); drawTray(); } });
}

// ---------- adjust (optional) ----------
// Works for tray items (source in memory) and for existing pages (source = the stored original photo).
export async function openAdjust(it, onSaved) {
  let src = it.src;
  if (!src && it.pageId) {
    const img = new Image(); img.src = `/api/pages/${it.pageId}/image?kind=orig&r=${Date.now()}`;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; }).catch(() => null);
    if (!img.width) return toast('Original photo not available for this page', 'err');
    src = bitmapToCanvas(img, 2800);
  }
  const A = { src, corners: it.corners ? JSON.parse(JSON.stringify(it.corners)) : FULL_CORNERS(), filter: it.filter || S?.filter || 'enhanced', boost: it.boost ?? S?.boost ?? 1, disp: null };
  const m = modal(`<div class="adj-head"><h2>Adjust page</h2><div class="btn-row"><button class="btn sm" id="rot">${icon('rotate')} Rotate</button><button class="btn sm" id="full">Full photo</button><button class="btn sm" id="redetect">${icon('sparkle')} Re-detect</button></div></div>
    <div class="seg" style="margin-bottom:10px"><button class="active" id="tabCrop">Corners</button><button id="tabPrev">Preview</button></div>
    <div class="crop-wrap" id="crop"><div class="crop-stage"><canvas class="view" id="view"></canvas><svg id="ov"></svg><div class="mag" id="mag"><canvas id="magc" width="120" height="120"></canvas></div></div></div>
    <div class="preview-box hidden" id="prevBox"></div>
    <div style="margin-top:12px"><div class="small muted" style="margin-bottom:6px;font-weight:600">Look</div><div class="filters" id="filters">${FILTERS.map(([k, l]) => `<button data-f="${k}" class="${A.filter === k ? 'active' : ''}"><canvas></canvas><span>${l}</span></button>`).join('')}</div></div>
    <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="small muted" style="font-weight:600">Readability boost</span><div class="seg" id="sharpSeg"><button data-s="0" class="${A.boost === 0 ? 'active' : ''}">Off</button><button data-s="1" class="${A.boost === 1 ? 'active' : ''}">Auto</button><button data-s="2" class="${A.boost === 2 ? 'active' : ''}">Strong</button></div></div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="apply">${icon('check')} Apply</button></div>`, { wide: true });
  const el = m.el;
  const drawOverlay = () => { const ov = $('#ov', el); const W = A.disp.width, H = A.disp.height; ov.setAttribute('viewBox', `0 0 ${W} ${H}`); ov.setAttribute('preserveAspectRatio', 'none'); const P = ['tl', 'tr', 'br', 'bl'].map(k => ({ k, x: A.corners[k].x * W, y: A.corners[k].y * H })); const r = Math.max(10, W / 60); ov.innerHTML = `<path class="shade" d="M0 0H${W}V${H}H0Z M${P.map(p => `${p.x} ${p.y}`).join(' L')}Z"/><polygon class="edge" points="${P.map(p => `${p.x},${p.y}`).join(' ')}"/>${P.map(p => `<circle class="handle" data-k="${p.k}" cx="${p.x}" cy="${p.y}" r="${r}"/>`).join('')}`; };
  const wireDrag = () => {
    const ov = $('#ov', el), mag = $('#mag', el), magc = $('#magc', el); let drag = null;
    const pos = (e) => { const rect = ov.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) }; };
    ov.onpointerdown = (e) => { const t = e.target.closest('.handle'); if (!t) return; drag = t.dataset.k; ov.setPointerCapture(e.pointerId); mag.style.display = 'block'; e.preventDefault(); };
    ov.onpointermove = (e) => { if (!drag) return; const p = pos(e); A.corners[drag] = p; drawOverlay(); const rect = ov.getBoundingClientRect(); const lx = e.clientX - rect.left, ly = e.clientY - rect.top; mag.style.left = (lx > rect.width - 150 ? lx - 140 : lx + 20) + 'px'; mag.style.top = (ly < 150 ? ly + 20 : ly - 140) + 'px'; const ctx = magc.getContext('2d'); const sx = p.x * A.src.width, sy = p.y * A.src.height, z = 60; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 120, 120); ctx.drawImage(A.src, sx - z, sy - z, z * 2, z * 2, 0, 0, 120, 120); };
    ov.onpointerup = ov.onpointercancel = () => { if (!drag) return; drag = null; mag.style.display = 'none'; thumbs(); preview(); };
  };
  const drawView = () => { const view = $('#view', el); A.disp = scaleCanvas(A.src, 1400); view.width = A.disp.width; view.height = A.disp.height; view.getContext('2d').drawImage(A.disp, 0, 0); drawOverlay(); wireDrag(); };
  let tt; const thumbs = () => { clearTimeout(tt); tt = setTimeout(() => { const small = warp(scaleCanvas(A.src, 420), A.corners, 220); $$('#filters button', el).forEach(b => { const c = enhance(small, b.dataset.f); const cv = $('canvas', b); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); }); }, 60); };
  let pt; const preview = (force) => { const box = $('#prevBox', el); if (box.classList.contains('hidden') && !force) return; clearTimeout(pt); pt = setTimeout(() => { let c = enhance(warp(scaleCanvas(A.src, 1000), A.corners, 900), A.filter); if (A.boost) c = sharpen(c, SHARPEN_AMOUNT[A.boost === 2 ? 2 : 1] * 0.8); box.innerHTML = ''; box.appendChild(c); }, 30); };
  drawView(); thumbs();
  $('#rot', el).onclick = () => { A.src = rotateCanvas(A.src, 90); A.corners = rotateCorners(A.corners, 90); drawView(); thumbs(); preview(); };
  $('#full', el).onclick = () => { A.corners = FULL_CORNERS(); drawOverlay(); thumbs(); preview(); };
  $('#redetect', el).onclick = async () => { busy($('#redetect', el), true, 'Detecting…'); try { const r = await api('/ai/corners', { body: { image: toDataURL(scaleCanvas(A.src, 900), 0.8) } }); if (r?.found && r.corners) { const c = {}; for (const k of ['tl', 'tr', 'br', 'bl']) { const v = r.corners[k]; c[k] = { x: Math.min(1, Math.max(0, +v[0])), y: Math.min(1, Math.max(0, +v[1])) }; } if (quadOk(c)) A.corners = c; drawOverlay(); thumbs(); preview(); } } catch (e) { toast(e.message, 'err'); } busy($('#redetect', el), false); };
  $('#tabCrop', el).onclick = () => { $('#tabCrop', el).classList.add('active'); $('#tabPrev', el).classList.remove('active'); $('#crop', el).classList.remove('hidden'); $('#prevBox', el).classList.add('hidden'); };
  $('#tabPrev', el).onclick = () => { $('#tabPrev', el).classList.add('active'); $('#tabCrop', el).classList.remove('active'); $('#crop', el).classList.add('hidden'); $('#prevBox', el).classList.remove('hidden'); preview(true); };
  $$('#filters button', el).forEach(b => b.onclick = () => { $$('#filters button', el).forEach(x => x.classList.remove('active')); b.classList.add('active'); A.filter = b.dataset.f; preview(); });
  $$('#sharpSeg button', el).forEach(b => b.onclick = () => { $$('#sharpSeg button', el).forEach(x => x.classList.remove('active')); b.classList.add('active'); A.boost = +b.dataset.s; preview(); });
  $('#apply', el).onclick = async () => {
    busy($('#apply', el), true, 'Applying…');
    await new Promise(r => setTimeout(r, 20));
    try {
      const out = buildOutputs({ src: A.src, corners: A.corners, filter: A.filter, boost: A.boost });
      it.src = A.src; it.corners = A.corners; it.filter = A.filter; it.boost = A.boost; it.thumb = out.thumb;
      if (it.pageId) {
        await api.patch('/pages/' + it.pageId, { enhanced: out.enhanced, thumb: out.thumb, filter: A.filter });
        m.close(); toast('Page updated — re-reading with AI…', 'ok'); drawTray();
        api('/pages/' + it.pageId + '/analyze', { body: {} }).then(done => { it.title = done.title; drawTray(); onSaved && onSaved(done); }).catch(() => {});
      } else { m.close(); drawTray(); }
    } catch (e) { toast(e.message, 'err'); busy($('#apply', el), false); }
  };
}
