// Book view: read a notebook like a real notebook — spread, spiral, page turns.
import { api, $, $$, esc, h, md, icon, toast, go } from './core.js';
import { shell } from './app.js';

let B = null; // { nb, pages, i (spread index: -1 = cover), mode: 'notes'|'scans', single, turning }

export async function bookView({ id }, q = {}) {
  const main = shell('Notebooks', `<div class="thinking"><span class="spinner"></span> Opening notebook…</div>`);
  const nb = await api('/notebooks/' + id);
  const pages = nb.pages;
  const startPage = q.p ? Math.max(1, Math.min(pages.length, +q.p)) : 0;
  B = { nb, pages, mode: localStorage.getItem('dwb_bookmode') || 'notes', single: window.matchMedia('(max-width: 900px)').matches, i: startPage ? startPage - 1 : (q.p === undefined ? -1 : 0), turning: false, face: 'scan' };
  main.innerHTML = `<div class="crumbs"><a href="#/notebooks">Notebooks</a> › <a href="#/notebook/${nb.id}">${esc(nb.name)}</a> › <span>Read</span></div>
    <div class="book-top"><div><h1 style="font-size:24px">${esc(nb.name)}</h1><div class="muted small">${esc(nb.subject || '')} · ${pages.length} scanned page${pages.length === 1 ? '' : 's'}</div></div>
      <div class="btn-row"><div class="seg" id="modeSeg"><button data-m="notes" class="${B.mode === 'notes' ? 'active' : ''}">Scan + Notes</button><button data-m="scans" class="${B.mode === 'scans' ? 'active' : ''}">Two scans</button></div><a class="btn" href="#/notebook/${nb.id}">${icon('book')} Page grid</a><a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Scan more</a></div></div>
    <div class="book-stage" id="stage"></div>
    <div class="book-nav"><button class="btn icon" id="prev">${icon('chevL')}</button><div class="book-pos" id="pos"></div><button class="btn icon" id="next">${icon('chevR')}</button></div>
    <div class="book-strip" id="strip">${pages.map((p, k) => `<div class="bs" data-k="${k}" style="background-image:url('/api/pages/${p.id}/image?kind=thumb&r=${p.rev || 0}')" title="Page ${p.index}${p.title ? ' — ' + esc(p.title) : ''}"></div>`).join('')}</div>`;
  if (!pages.length) { $('#stage').innerHTML = `<div class="empty" style="margin:20px auto;max-width:420px"><div class="big">📖</div><h3>This notebook is empty</h3><p>Scan a few pages and they'll appear here as a flip-through notebook.</p><a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Start scanning</a></div>`; return; }
  $$('#modeSeg button').forEach(b => b.onclick = () => { B.mode = b.dataset.m; localStorage.setItem('dwb_bookmode', B.mode); $$('#modeSeg button').forEach(x => x.classList.toggle('active', x === b)); if (B.i < 0) B.i = 0; drawSpread(); });
  $('#prev').onclick = () => turn(-1); $('#next').onclick = () => turn(1);
  $$('#strip .bs').forEach(el => el.onclick = () => { B.i = spreadOf(+el.dataset.k); drawSpread(); });
  document.onkeydown = (e) => { if (e.target.closest('input,textarea')) return; if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); turn(1); } if (e.key === 'ArrowLeft') turn(-1); if (e.key === 'Home') { B.i = -1; drawSpread(); } };
  // swipe
  let sx = null; const st = $('#stage');
  st.addEventListener('pointerdown', e => { sx = e.clientX; });
  st.addEventListener('pointerup', e => { if (sx === null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50) turn(dx < 0 ? 1 : -1); });
  window.addEventListener('resize', onResize);
  drawSpread();
}
function onResize() { if (!location.hash.startsWith('#/book')) return window.removeEventListener('resize', onResize); const s = window.matchMedia('(max-width: 900px)').matches; if (s !== B.single) { B.single = s; drawSpread(); } }

// spreads: notes mode → each page is one spread (scan left, notes right). scans mode → 2 pages per spread. single → one page per spread.
function spreadCount() { return (B.mode === 'scans' && !B.single) ? Math.ceil(B.pages.length / 2) : B.pages.length; }
function spreadOf(k) { return (B.mode === 'scans' && !B.single) ? Math.floor(k / 2) : k; }
function pagesIn(i) { return (B.mode === 'scans' && !B.single) ? [B.pages[i * 2], B.pages[i * 2 + 1]].filter(Boolean) : [B.pages[i]]; }

function scanFace(p) { return p ? `<div class="face-scan"><img src="/api/pages/${p.id}/image?kind=enh&r=${p.rev || 0}" alt="Page ${p.index}" draggable="false"><div class="pg-num">${p.index}</div><a class="btn sm ghost open-pg" href="#/page/${p.id}" title="Open page">${icon('eye')}</a></div>` : blankFace(); }
function notesFace(p) { return p ? `<div class="face-notes paper holes"><div class="pg-title">${esc(p.title || 'Page ' + p.index)}</div><div class="md">${p.transcript ? md(p.transcript) : '<span class="muted">No digital copy yet — open the page and press “Re-read with AI”.</span>'}</div><div class="pg-num">${p.index}</div></div>` : blankFace(); }
function blankFace() { return `<div class="face-notes paper holes blank"><div class="muted small" style="text-align:center;padding-top:40%">— end of scanned pages —</div></div>`; }
function coverFace() { const nb = B.nb; return `<div class="cover color-${esc(nb.color || 'navy')}"><div class="rings"></div><div class="label"><b>${esc(nb.name)}</b><span>${esc(nb.subject || 'Notebook')}</span></div><div class="cover-hint">Tap to open →</div></div>`; }
function backCoverFace() { const nb = B.nb; return `<div class="cover back color-${esc(nb.color || 'navy')}"><div class="cover-hint" style="top:50%;transform:translateY(-50%);left:0;right:0;text-align:center">${B.pages.length} pages scanned<br><a class="btn sm" style="margin-top:10px" href="#/scan/${nb.id}">${icon('camera')} Scan more</a></div></div>`; }

function facesFor(i) {
  // returns [leftHtml, rightHtml] for spread i (-1 = closed cover, count = back cover)
  const n = spreadCount();
  if (i < 0) return [null, coverFace()];
  if (i >= n) return [backCoverFace(), null];
  if (B.single) { const p = B.pages[i]; return [null, B.face === 'notes' ? notesFace(p) : scanFace(p)]; }
  if (B.mode === 'scans') { const [a, b] = pagesIn(i); return [scanFace(a), scanFace(b)]; }
  const p = B.pages[i]; return [scanFace(p), notesFace(p)];
}
function drawSpread() {
  const stage = $('#stage'); if (!stage) return;
  const [L, R] = facesFor(B.i);
  const closed = B.i < 0 || B.i >= spreadCount();
  stage.innerHTML = `<div class="book ${B.single ? 'single' : ''} ${closed ? 'closed' : ''} ${B.i < 0 ? 'at-cover' : ''} ${B.i >= spreadCount() ? 'at-back' : ''}">
      <div class="leaf left ${L === null ? 'none' : ''}" id="leafL">${L || ''}</div>
      <div class="spine"><div class="coil"></div></div>
      <div class="leaf right ${R === null ? 'none' : ''}" id="leafR">${R || ''}</div>
    </div>
    ${B.single && !closed ? `<div class="seg book-face"><button class="${B.face === 'scan' ? 'active' : ''}" data-f="scan">Scan</button><button class="${B.face === 'notes' ? 'active' : ''}" data-f="notes">Digital copy</button></div>` : ''}`;
  $$('.book-face button').forEach(b => b.onclick = () => { B.face = b.dataset.f; drawSpread(); });
  const cov = $('.cover:not(.back)', stage); if (cov) cov.onclick = () => turn(1);
  $$('.face-scan img', stage).forEach(im => im.ondblclick = () => { const a = im.parentElement.querySelector('.open-pg'); if (a) go(a.getAttribute('href')); });
  const n = spreadCount();
  const ps = B.i < 0 ? 'Cover' : B.i >= n ? 'Back cover' : (() => { const pp = pagesIn(B.i); return `Page ${pp[0].index}${pp[1] ? '–' + pp[1].index : ''} of ${B.pages.length}`; })();
  $('#pos').innerHTML = `<b>${ps}</b>${B.i >= 0 && B.i < n && B.pages[B.single || B.mode !== 'scans' ? B.i : B.i * 2]?.title ? ` <span class="muted">· ${esc(B.pages[B.single || B.mode !== 'scans' ? B.i : B.i * 2].title)}</span>` : ''}`;
  $('#prev').disabled = B.i < 0; $('#next').disabled = B.i >= n;
  $$('#strip .bs').forEach(el => el.classList.toggle('active', B.i >= 0 && B.i < n && pagesIn(B.i).some(p => p === B.pages[+el.dataset.k])));
  const act = $('#strip .bs.active'); if (act) act.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}
function turn(dir) {
  if (B.turning) return;
  const n = spreadCount();
  const to = B.i + dir;
  if (to < -1 || to > n) return;
  const book = $('.book'); const [nl, nr] = facesFor(to);
  if (!book || B.single || B.i < 0 || to < 0 || B.i >= n || to >= n) { B.i = to; return drawSpread(); }
  // animated leaf turn
  B.turning = true;
  const [cl, cr] = facesFor(B.i);
  const flip = h(`<div class="flip ${dir > 0 ? 'fwd' : 'back'}"><div class="ff front">${dir > 0 ? cr : cl}</div><div class="ff backf">${dir > 0 ? (nl || '') : (nr || '')}</div></div>`);
  book.appendChild(flip);
  // underneath: show destination on the side that will be revealed
  if (dir > 0) { $('#leafR').innerHTML = nr || ''; $('#leafR').classList.toggle('none', nr === null); }
  else { $('#leafL').innerHTML = nl || ''; $('#leafL').classList.toggle('none', nl === null); }
  requestAnimationFrame(() => requestAnimationFrame(() => flip.classList.add('go')));
  setTimeout(() => { B.i = to; B.turning = false; drawSpread(); }, 620);
}
