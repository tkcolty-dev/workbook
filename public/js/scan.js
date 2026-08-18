import { state, api, $, $$, esc, h, icon, toast, busy, loadNotebooks, invalidate, go } from './core.js';
import { shell, nbCover, notebookModal } from './app.js';
import { fileToCanvas, bitmapToCanvas, scaleCanvas, toDataURL, rotateCanvas, rotateCorners, FULL_CORNERS, warp, enhance, thumbnail } from './imageproc.js';

let stream = null;            // live camera stream
let S = null;                 // current scan session
const FILTERS = [['enhanced', 'Enhanced ✦'], ['color', 'Soft color'], ['gray', 'Grayscale'], ['bw', 'B&W (no color)'], ['original', 'Original']];

function stopCamera() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/scan')) stopCamera(); });

export async function scanView({ id }, q = {}) {
  const main = shell('Scan', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const nbs = await loadNotebooks(true);
  if (!id) {
    // pick a notebook
    main.innerHTML = `<div class="page-head"><div><h1>Scan</h1><div class="sub">Which notebook are you scanning into?</div></div><button class="btn primary" id="newNb">${icon('plus')} New notebook</button></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">${nbs.sort((a, b) => b.updatedAt - a.updatedAt).map(nb => `<a href="#/scan/${nb.id}" style="text-decoration:none">${nbCover(nb)}</a>`).join('')}<div class="nb-cover new" id="newNb2"><div style="text-align:center">${icon('plus')}<div style="font-weight:600;font-size:13px">New notebook</div></div></div></div>
      ${!nbs.length ? '<p class="muted" style="margin-top:16px">Create a notebook first — you\'ll set how many pages you plan to scan.</p>' : ''}`;
    $('#newNb').onclick = $('#newNb2').onclick = () => notebookModal();
    return;
  }
  const nb = await api('/notebooks/' + id);
  if (!S || S.nb.id !== nb.id) S = { nb, jobs: [], filter: localStorage.getItem('dwb_filter') || 'enhanced' };
  S.nb = nb;
  S.pageIndex = (nb.pages.reduce((m, p) => Math.max(m, p.index), 0) || 0) + 1;
  renderCapture(main);
}

function sidebarHtml() {
  const nb = S.nb; const done = nb.pages.length; const total = Math.max(nb.pageCount, done);
  const complete = done >= nb.pageCount;
  return `<div class="scan-side">
    <div class="card"><div style="display:flex;gap:12px;align-items:center"><div style="width:52px;flex-shrink:0">${nbCover(nb, 'sm')}</div><div style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nb.name)}</b><span class="muted small">${esc(nb.subject || '')}</span></div><a class="btn icon sm ghost" href="#/scan" title="Switch notebook" style="margin-left:auto">${icon('flip')}</a></div>
      <div style="margin-top:14px" class="pagecount">Page ${S.pageIndex} <small>of ${total}</small></div>
      <div class="progress ${complete ? 'green' : ''}" style="margin:6px 0"><i style="width:${Math.min(100, Math.round(100 * done / total))}%"></i></div>
      <div class="small muted">${complete ? '🎉 You’ve scanned all ' + nb.pageCount + ' planned pages — keep going or finish.' : (nb.pageCount - done) + ' page' + (nb.pageCount - done === 1 ? '' : 's') + ' left'}</div>
      <div class="btn-row" style="margin-top:12px"><a class="btn sm ${complete ? 'primary' : ''}" href="#/book/${nb.id}">${icon('book')} Read notebook</a><a class="btn sm ghost" href="#/notebook/${nb.id}">Page grid</a>${complete ? `<button class="btn sm" id="morePages">${icon('plus')} Add 10 pages</button>` : ''}</div>
    </div>
    <div class="card" id="jobsCard"><h3>Scanned this session</h3><div id="jobs">${jobsHtml()}</div></div>
    <div class="card flat small muted"><b style="color:var(--ink)">Tips for a clean scan</b><ul style="margin:6px 0 0;padding-left:18px"><li>Lay the page flat in good light</li><li>Fill the frame; a little tilt is fine — AI straightens it</li><li>Avoid your shadow over the page</li></ul></div>
  </div>`;
}
function jobsHtml() {
  if (!S.jobs.length) return '<span class="muted small">Pages you scan will show up here while the AI reads them.</span>';
  return `<div class="recent-scans">${S.jobs.map(j => `<div style="background-image:url('${j.thumb}')" title="Page ${j.index}${j.title ? ' — ' + esc(j.title) : ''}" onclick="${j.pageId ? `location.hash='#/page/${j.pageId}'` : ''}"><i class="${j.status === 'ready' ? '' : 'busy'}">${j.status === 'ready' ? '✓' : j.status === 'error' ? '!' : '…'}</i></div>`).join('')}</div>
    <div class="small muted" style="margin-top:8px">${S.jobs.filter(j => j.status === 'analyzing' || j.status === 'saving').length ? `<span class="spinner" style="width:12px;height:12px"></span> AI is reading ${S.jobs.filter(j => j.status !== 'ready' && j.status !== 'error').length} page(s)…` : 'All read ✓'}</div>`;
}
function refreshJobs() { const el = $('#jobs'); if (el) el.innerHTML = jobsHtml(); }
function wireSide(main) {
  const mp = $('#morePages', main); if (mp) mp.onclick = async () => { await api.patch('/notebooks/' + S.nb.id, { pageCount: S.nb.pageCount + 10 }); S.nb.pageCount += 10; invalidate(); toast('Added 10 more pages', 'ok'); renderCapture(main); };
}

// ---------- capture ----------
async function renderCapture(main) {
  main.innerHTML = `<div class="crumbs"><a href="#/notebooks">Notebooks</a> › <a href="#/notebook/${S.nb.id}">${esc(S.nb.name)}</a> › <span>Scan</span></div>
    <div class="scan-wrap"><div>
      <div class="scan-stage" id="stage"><div class="noCam"><span class="spinner light"></span></div></div>
      <div class="shutter-bar" id="shutterBar"></div>
    </div>${sidebarHtml()}</div>`;
  wireSide(main);
  const stage = $('#stage'), bar = $('#shutterBar');
  const fileBtn = (label, capture) => `<label class="btn filebtn ${capture ? 'primary lg' : ''}">${icon(capture ? 'camera' : 'upload')} ${label}<input type="file" accept="image/*" ${capture ? 'capture="environment"' : 'multiple'}></label>`;
  const canLive = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  // file buttons are always available right away (they work everywhere, incl. phones over http)
  bar.innerHTML = `${fileBtn('Take photo', true)}${fileBtn('Upload photos')}`;
  wireFiles(main, bar);
  if (canLive) {
    stage.innerHTML = `<div class="noCam"><span class="spinner light"></span><div class="small" style="margin-top:10px;opacity:.85">Starting camera… if your browser asks, click <b>Allow</b></div></div>`;
    try {
      if (!stream) stream = await openCamera();
      if (!location.hash.startsWith('#/scan') || !$('#stage')) return;
      const video = h('<video autoplay playsinline muted></video>'); video.srcObject = stream;
      stage.innerHTML = ''; stage.appendChild(video); stage.appendChild(h('<div class="guide"></div>'));
      video.play().catch(() => {});
      bar.innerHTML = `${fileBtn('Upload photo')}<button class="shutter" id="shot" title="Take photo (space)"></button><button class="btn icon" id="flipCam" title="Flip camera">${icon('flip')}</button>`;
      $('#shot').onclick = () => { if (!video.videoWidth) return toast('Camera is still starting…'); const c = bitmapToCanvas(video, 2400); beginAdjust(main, c); };
      $('#flipCam').onclick = async () => { const cur = stream.getVideoTracks()[0].getSettings().facingMode; stopCamera(); try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cur === 'user' ? { ideal: 'environment' } : 'user' }, audio: false }); video.srcObject = stream; video.play().catch(() => {}); } catch (e) { toast('Could not switch camera', 'err'); renderCapture(main); } };
      wireFiles(main, bar);
      document.onkeydown = (e) => { if (e.code === 'Space' && !e.target.closest('input,textarea,button')) { e.preventDefault(); $('#shot')?.click(); } };
    } catch (e) {
      if (!$('#stage')) return;
      console.warn('camera error', e);
      stage.innerHTML = `<div class="noCam"><div class="big">📷</div><b>Live camera didn’t start</b><div class="small" style="opacity:.85;margin-top:6px;max-width:420px">${cameraHelp(e)}</div><div class="btn-row" style="justify-content:center;margin-top:14px"><button class="btn" id="retryCam">${icon('refresh')} Retry camera</button></div><div class="small" style="opacity:.75;margin-top:10px">Or use “Take photo” below — it opens your camera app.</div></div>`;
      $('#retryCam').onclick = () => { stopCamera(); renderCapture(main); };
    }
  } else {
    stage.innerHTML = `<div class="noCam"><div class="big">📷</div><b>Tap “Take photo” to use your camera</b><div class="small" style="opacity:.8;margin-top:6px">${window.isSecureContext ? '' : 'Live camera preview needs HTTPS — the photo button works everywhere.'}</div></div>`;
  }
}
// Try progressively simpler constraints; give the permission prompt plenty of time.
async function openCamera() {
  const attempts = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false },
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr = null;
  for (const c of attempts) {
    try {
      return await Promise.race([
        navigator.mediaDevices.getUserMedia(c),
        new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('Camera did not respond'), { name: 'TimeoutError' })), 45000)),
      ]);
    } catch (e) { lastErr = e; if (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'NotFoundError') break; }
  }
  throw lastErr || new Error('Camera unavailable');
}
function cameraHelp(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Camera permission is blocked for this site. Click the camera / lock icon in the address bar, set Camera to <b>Allow</b>, then press Retry. (Safari: Safari menu → Settings for localhost → Camera → Allow.)';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'No camera was found on this device.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'The camera is busy or blocked by the system. Close other apps using it (Zoom, FaceTime, Photo Booth) and check macOS System Settings → Privacy & Security → Camera → allow your browser.';
  if (n === 'TimeoutError') return 'The browser never answered — look for a permission pop-up, then press Retry.';
  return esc(e?.message || 'Unknown error');
}
function wireFiles(main, bar) {
  $$('input[type=file]', bar).forEach(inp => inp.onchange = async () => {
    const files = [...inp.files]; if (!files.length) return;
    if (files.length === 1) { const c = await fileToCanvas(files[0]); beginAdjust(main, c); }
    else { S.queue = files.slice(1); const c = await fileToCanvas(files[0]); toast(`${files.length} photos — adjusting one at a time`); beginAdjust(main, c); }
  });
}

// ---------- adjust (crop / straighten / filter) ----------
let A = null; // adjust state
async function beginAdjust(main, srcCanvas) {
  A = { src: srcCanvas, corners: FULL_CORNERS(), rotation: 0, aiDone: false, disp: null };
  renderAdjust(main);
  detectCorners(main);
}
function renderAdjust(main) {
  main.innerHTML = `<div class="crumbs"><a href="#/notebooks">Notebooks</a> › <a href="#/notebook/${S.nb.id}">${esc(S.nb.name)}</a> › <span>Scan · page ${S.pageIndex}</span></div>
    <div class="scan-wrap"><div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap"><div class="ai-status" id="aiStatus"><span class="spinner"></span> AI is finding the page edges…</div><div class="btn-row"><button class="btn sm" id="rotL" title="Rotate left">${icon('rotate')} Rotate</button><button class="btn sm" id="full">Full photo</button><button class="btn sm" id="redetect">${icon('sparkle')} Re-detect</button></div></div>
      <div class="seg" style="margin-bottom:10px"><button class="active" id="tabCrop">Adjust corners</button><button id="tabPrev">Preview result</button></div>
      <div class="crop-wrap" id="crop"><div class="crop-stage"><canvas class="view" id="view"></canvas><svg id="ov"></svg><div class="mag" id="mag"><canvas id="magc" width="120" height="120"></canvas></div></div></div>
      <div class="preview-box hidden" id="prevBox"><div style="padding:30px;text-align:center" class="muted"><span class="spinner"></span></div></div>
      <div style="margin-top:12px"><div class="small muted" style="margin-bottom:6px;font-weight:600">Look</div><div class="filters" id="filters">${FILTERS.map(([k, l]) => `<button data-f="${k}" class="${S.filter === k ? 'active' : ''}"><canvas></canvas><span>${l}</span></button>`).join('')}</div></div>
      <div class="btn-row" style="margin-top:16px;justify-content:space-between"><button class="btn" id="retake">${icon('x')} Retake</button><button class="btn primary lg" id="use">${icon('check')} Save page ${S.pageIndex}</button></div>
    </div>${sidebarHtml()}</div>`;
  wireSide(main);
  window.scrollTo(0, 0);
  drawView();
  updateFilterThumbs();
  $('#rotL').onclick = () => { A.src = rotateCanvas(A.src, 90); A.corners = rotateCorners(A.corners, 90); drawView(); updateFilterThumbs(); updatePreview(); };
  $('#full').onclick = () => { A.corners = FULL_CORNERS(); drawOverlay(); updateFilterThumbs(); updatePreview(); };
  $('#redetect').onclick = () => detectCorners(main);
  $('#retake').onclick = () => { A = null; renderCapture(main); };
  $('#tabCrop').onclick = () => { $('#tabCrop').classList.add('active'); $('#tabPrev').classList.remove('active'); $('#crop').classList.remove('hidden'); $('#prevBox').classList.add('hidden'); };
  $('#tabPrev').onclick = () => { $('#tabPrev').classList.add('active'); $('#tabCrop').classList.remove('active'); $('#crop').classList.add('hidden'); $('#prevBox').classList.remove('hidden'); updatePreview(true); };
  $$('#filters button').forEach(b => b.onclick = () => { $$('#filters button').forEach(x => x.classList.remove('active')); b.classList.add('active'); S.filter = b.dataset.f; localStorage.setItem('dwb_filter', S.filter); updatePreview(); });
  $('#use').onclick = () => savePage(main);
  document.onkeydown = (e) => { if (e.key === 'Enter' && !e.target.closest('input,textarea,button')) $('#use')?.click(); if (e.key === 'Escape') $('#retake')?.click(); };
}
function drawView() {
  const view = $('#view'); if (!view) return;
  A.disp = scaleCanvas(A.src, 1400);
  view.width = A.disp.width; view.height = A.disp.height;
  view.getContext('2d').drawImage(A.disp, 0, 0);
  drawOverlay(); wireDrag();
}
function drawOverlay() {
  const ov = $('#ov'); if (!ov) return;
  const W = A.disp.width, H = A.disp.height;
  ov.setAttribute('viewBox', `0 0 ${W} ${H}`); ov.setAttribute('preserveAspectRatio', 'none');
  const P = ['tl', 'tr', 'br', 'bl'].map(k => ({ k, x: A.corners[k].x * W, y: A.corners[k].y * H }));
  const poly = P.map(p => `${p.x},${p.y}`).join(' ');
  const r = Math.max(10, W / 60);
  ov.innerHTML = `<path class="shade" d="M0 0H${W}V${H}H0Z M${P.map(p => `${p.x} ${p.y}`).join(' L')}Z"/><polygon class="edge" points="${poly}"/>${P.map(p => `<circle class="handle" data-k="${p.k}" cx="${p.x}" cy="${p.y}" r="${r}"/>`).join('')}`;
  ov.style.setProperty('--r', r);
}
function wireDrag() {
  const ov = $('#ov'), stage = $('#crop'), mag = $('#mag'), magc = $('#magc');
  let drag = null;
  const pos = (e) => { const rect = ov.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) }; };
  ov.onpointerdown = (e) => {
    const t = e.target.closest('.handle'); if (!t) return;
    drag = t.dataset.k; ov.setPointerCapture(e.pointerId); mag.style.display = 'block'; e.preventDefault();
  };
  ov.onpointermove = (e) => {
    if (!drag) return;
    const p = pos(e); A.corners[drag] = p; drawOverlay();
    // magnifier
    const rect = ov.getBoundingClientRect(); const lx = e.clientX - rect.left, ly = e.clientY - rect.top;
    mag.style.left = (lx > rect.width - 150 ? lx - 140 : lx + 20) + 'px'; mag.style.top = (ly < 150 ? ly + 20 : ly - 140) + 'px';
    const ctx = magc.getContext('2d'); const sx = p.x * A.src.width, sy = p.y * A.src.height; const z = 60;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 120, 120); ctx.drawImage(A.src, sx - z, sy - z, z * 2, z * 2, 0, 0, 120, 120);
  };
  ov.onpointerup = ov.onpointercancel = () => { if (!drag) return; drag = null; mag.style.display = 'none'; updateFilterThumbs(); updatePreview(); };
}
async function detectCorners(main) {
  const st = $('#aiStatus'); if (st) st.innerHTML = `<span class="spinner"></span> AI is finding the page edges…`;
  const small = scaleCanvas(A.src, 900);
  const mySrc = A.src;
  try {
    const r = await api('/ai/corners', { body: { image: toDataURL(small, 0.8) } });
    if (A?.src !== mySrc) return; // user moved on
    if (r?.found && r.corners) {
      const c = {}; for (const k of ['tl', 'tr', 'br', 'bl']) { const v = r.corners[k]; c[k] = { x: Math.min(1, Math.max(0, +v[0])), y: Math.min(1, Math.max(0, +v[1])) }; }
      A.corners = c;
      if (r.rotation && [90, 180, 270].includes(+r.rotation)) { A.src = rotateCanvas(A.src, +r.rotation); A.corners = rotateCorners(A.corners, +r.rotation); drawView(); }
      drawOverlay(); updateFilterThumbs(); updatePreview();
      if (st) st.innerHTML = `${icon('sparkle')} AI found the page — drag the corners to fine-tune`;
    } else if (st) st.innerHTML = `${icon('sparkle')} Using the full photo — drag corners if you want to crop`;
  } catch (e) { if (st) st.innerHTML = `Edge detection unavailable (${esc(e.message)}) — drag the corners yourself`; }
}
let thumbTimer;
function updateFilterThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    const small = warp(scaleCanvas(A.src, 420), A.corners, 220);
    $$('#filters button').forEach(b => { const c = enhance(small, b.dataset.f); const cv = $('canvas', b); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); });
  }, 60);
}
let prevTimer;
function updatePreview(force) {
  const box = $('#prevBox'); if (!box || (box.classList.contains('hidden') && !force)) return;
  clearTimeout(prevTimer);
  prevTimer = setTimeout(() => {
    const c = enhance(warp(scaleCanvas(A.src, 1000), A.corners, 900), S.filter);
    box.innerHTML = ''; box.appendChild(c);
  }, 30);
}
function buildFinal() {
  const warped = warp(A.src, A.corners, 2000);
  const enhanced = enhance(warped, S.filter);
  return { enhanced: toDataURL(enhanced, 0.86), original: toDataURL(scaleCanvas(A.src, 1600), 0.8), thumb: toDataURL(thumbnail(enhanced, 420), 0.8) };
}
async function savePage(main) {
  const btn = $('#use'); busy(btn, true, 'Processing…');
  await new Promise(r => setTimeout(r, 30));
  let imgs;
  try { imgs = buildFinal(); } catch (e) { toast('Could not process image: ' + e.message, 'err'); busy(btn, false); return; }
  const job = { index: S.pageIndex, thumb: imgs.thumb, status: 'saving', title: '' };
  S.jobs.unshift(job);
  const nbId = S.nb.id, idx = S.pageIndex;
  S.pageIndex++;
  S.nb.pages.push({ index: idx });
  invalidate();
  toast(`Page ${idx} saved — AI is reading it`, 'ok');
  // next
  if (S.queue?.length) { const f = S.queue.shift(); const c = await fileToCanvas(f); beginAdjust(main, c); }
  else { A = null; renderCapture(main); }
  // upload + analyze in background
  (async () => {
    try {
      const page = await api(`/notebooks/${nbId}/pages`, { body: { ...imgs, index: idx, filter: S.filter } });
      job.pageId = page.id; job.status = 'analyzing'; refreshJobs();
      const done = await api(`/pages/${page.id}/analyze`, { body: {} });
      job.status = 'ready'; job.title = done.title; refreshJobs();
    } catch (e) { job.status = 'error'; refreshJobs(); toast('Page ' + idx + ': ' + e.message, 'err'); }
  })();
}
