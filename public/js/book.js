// Slideshow view: one big page at a time — arrows, keys, swipe, filmstrip, autoplay, fullscreen,
// and a toggle to show the AI digital copy next to (or instead of) the scan.
import { api, $, $$, esc, h, md, icon, toast, go } from './core.js';
import { shell } from './app.js';
import { testOnPage } from './study.js';

let B = null; // { nb, pages, i, mode: 'scan'|'both'|'notes', playing, timer, dir }

export async function bookView({ id }, q = {}) {
  const main = shell('Notebooks', `<div class="thinking"><span class="spinner"></span> Opening slideshow…</div>`);
  const nb = await api('/notebooks/' + id);
  const pages = nb.pages;
  const start = q.p ? Math.max(1, Math.min(pages.length, +q.p)) - 1 : 0;
  B = { nb, pages, i: start, mode: localStorage.getItem('dwb_slidemode') || 'both', playing: false, timer: null };
  main.innerHTML = `<div class="crumbs"><a href="#/notebooks">Notebooks</a> › <a href="#/notebook/${nb.id}">${esc(nb.name)}</a> › <span>Slideshow</span></div>
    <div class="book-top"><div><h1 style="font-size:24px">${esc(nb.name)}</h1><div class="muted small">${esc(nb.subject || '')} · ${pages.length} page${pages.length === 1 ? '' : 's'}</div></div>
      <div class="btn-row"><div class="seg" id="modeSeg"><button data-m="scan" class="${B.mode === 'scan' ? 'active' : ''}">Scan</button><button data-m="both" class="${B.mode === 'both' ? 'active' : ''}">Scan + notes</button><button data-m="notes" class="${B.mode === 'notes' ? 'active' : ''}">Notes</button></div><button class="btn" id="play" title="Autoplay (5s per page)">▶ Play</button><button class="btn icon" id="fs" title="Fullscreen">${icon('eye')}</button><a class="btn" href="#/notebook/${nb.id}">${icon('book')} Page grid</a><a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Scan more</a></div></div>
    <div class="slides" id="slides"><div class="slide-stage" id="stage"></div>
      <button class="slide-arrow left" id="prev" title="Previous (←)">${icon('chevL')}</button><button class="slide-arrow right" id="next" title="Next (→)">${icon('chevR')}</button>
      <div class="slide-bar"><div class="slide-pos" id="pos"></div><div class="slide-dots" id="dots"></div></div>
    </div>
    <div class="book-strip" id="strip">${pages.map((p, k) => `<div class="bs" data-k="${k}" style="background-image:url('/api/pages/${p.id}/image?kind=thumb&r=${p.rev || 0}')" title="Page ${p.index}${p.title ? ' — ' + esc(p.title) : ''}"></div>`).join('')}</div>`;
  if (!pages.length) { $('#stage').innerHTML = `<div class="empty" style="margin:auto;max-width:420px"><div class="big">🖼️</div><h3>Nothing to show yet</h3><p>Scan a few pages and they'll appear here as a slideshow.</p><a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Start scanning</a></div>`; return; }
  $$('#modeSeg button').forEach(b => b.onclick = () => { B.mode = b.dataset.m; localStorage.setItem('dwb_slidemode', B.mode); $$('#modeSeg button').forEach(x => x.classList.toggle('active', x === b)); draw(); });
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
  $('#play').onclick = togglePlay;
  $('#fs').onclick = () => { const el = $('#slides'); if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.(); };
  $$('#strip .bs').forEach(el => el.onclick = () => { B.i = +el.dataset.k; draw(); });
  document.onkeydown = (e) => { if (e.target.closest('input,textarea')) return; if (e.key === 'ArrowRight' || e.key === 'PageDown') step(1); if (e.key === 'ArrowLeft' || e.key === 'PageUp') step(-1); if (e.key === ' ') { e.preventDefault(); togglePlay(); } if (e.key === 'Home') { B.i = 0; draw(); } if (e.key === 'End') { B.i = pages.length - 1; draw(); } if (e.key === 'f') $('#fs').click(); };
  let sx = null; const st = $('#slides');
  st.addEventListener('pointerdown', e => { sx = e.clientX; });
  st.addEventListener('pointerup', e => { if (sx === null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); });
  window.addEventListener('hashchange', stopPlay, { once: true });
  draw();
}
function step(d) { const n = B.pages.length; B.dir = d; B.i = (B.i + d + n) % n; draw(); }
function togglePlay() { if (B.playing) stopPlay(); else { B.playing = true; $('#play').textContent = '⏸ Pause'; B.timer = setInterval(() => step(1), 5000); } }
function stopPlay() { B.playing = false; clearInterval(B.timer); const b = $('#play'); if (b) b.textContent = '▶ Play'; }
function draw() {
  const p = B.pages[B.i]; const stage = $('#stage'); if (!stage || !p) return;
  const scan = `<div class="slide-scan"><img src="/api/pages/${p.id}/image?kind=enh&r=${p.rev || 0}" alt="Page ${p.index}" draggable="false"><div class="open-pg btn-row"><button class="btn sm primary" id="testThis">${icon('quiz')} Test on this</button><a class="btn sm" href="#/page/${p.id}" title="Open page">${icon('eye')} Open</a></div></div>`;
  const notes = `<div class="slide-notes paper holes"><div class="pg-title">${esc(p.title || 'Page ' + p.index)}</div><div class="md">${p.transcript ? md(p.transcript) : '<span class="muted">No digital copy yet — open the page and press “Re-read with AI”.</span>'}</div>${p.keyPoints?.length ? `<div class="slide-kp"><b>Key points</b><ul>${p.keyPoints.map(k => `<li>${md(k).replace(/^<p>|<\/p>\s*$/g, '')}</li>`).join('')}</ul></div>` : ''}</div>`;
  const slide = h(`<div class="slide mode-${B.mode} ${B.dir > 0 ? 'from-right' : B.dir < 0 ? 'from-left' : ''}">${B.mode === 'notes' ? notes : B.mode === 'scan' ? scan : scan + notes}</div>`);
  stage.innerHTML = ''; stage.appendChild(slide);
  const tb = $('#testThis', slide); if (tb) tb.onclick = () => { stopPlay(); testOnPage(p, B.nb); };
  $('#pos').innerHTML = `<b>${B.i + 1} / ${B.pages.length}</b>${p.title ? ` <span class="muted">· ${esc(p.title)}</span>` : ''}`;
  $('#dots').innerHTML = B.pages.length <= 20 ? B.pages.map((_, k) => `<i class="${k === B.i ? 'on' : ''}" data-k="${k}"></i>`).join('') : '';
  $$('#dots i').forEach(d => d.onclick = () => { B.i = +d.dataset.k; draw(); });
  $$('#strip .bs').forEach(el => el.classList.toggle('active', +el.dataset.k === B.i));
  const act = $('#strip .bs.active'); if (act) act.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  // preload neighbours
  for (const k of [B.i + 1, B.i - 1]) { const q = B.pages[(k + B.pages.length) % B.pages.length]; if (q) { const im = new Image(); im.src = `/api/pages/${q.id}/image?kind=enh&r=${q.rev || 0}`; } }
}
