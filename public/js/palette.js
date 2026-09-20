// Command palette (⌘K / Ctrl+K / "/"): jump anywhere, search every page, run common actions.
import { state, api, $, $$, esc, h, icon, modal, go, loadNotebooks, loadStudy, loadEvents, setTheme, getTheme, isDark, fmtDate, countdown, plural } from './core.js';

let open = null;
export async function openPalette(initial = '') {
  if (open) { $('input', open.el).focus(); return; }
  const m = modal(`<div class="pin">${icon('search')}<input id="palIn" placeholder="Search pages, notebooks, study sets… or type an action" autocomplete="off" spellcheck="false" aria-label="Search" value="${esc(initial)}"></div><div class="plist" id="palList" role="listbox"></div><div class="pfoot"><span><kbd>↑↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span><span style="margin-left:auto"><kbd>?</kbd> shortcuts</span></div>`, { cls: 'palette-bg', onClose: () => { open = null; } });
  m.el.querySelector('.modal').classList.add('palette');
  open = m;
  const input = $('#palIn', m.el), list = $('#palList', m.el);
  const [nbs, sets, evs] = await Promise.all([loadNotebooks().catch(() => []), loadStudy().catch(() => []), loadEvents().catch(() => [])]);
  const actions = [
    { g: 'Actions', t: 'Scan pages', s: 'camera', run: () => go('#/scan'), k: 'scan camera photo' },
    { g: 'Actions', t: 'Check homework', s: 'check', run: () => go('#/scan?hw=1'), k: 'homework grade check' },
    { g: 'Actions', t: 'New notebook', s: 'plus', run: () => go('#/notebooks?new=1'), k: 'create notebook' },
    { g: 'Actions', t: 'Add to planner', s: 'calendar', run: () => go('#/planner?new=1'), k: 'event test homework due date add' },
    { g: 'Actions', t: 'New study set', s: 'study', run: () => go('#/study?new=1'), k: 'study sheet test flashcards' },
    { g: 'Actions', t: 'Review flashcards due today', s: 'review', run: () => go('#/review'), k: 'review cards spaced repetition' },
    { g: 'Actions', t: 'Scan my paper planner', s: 'calendar', run: () => go('#/scan?planner=1'), k: 'planner scan syllabus' },
    { g: 'Actions', t: isDark() ? 'Switch to light theme' : 'Switch to dark theme', s: isDark() ? 'sun' : 'moon', run: () => { setTheme(isDark() ? 'light' : 'dark'); const tb = $('#themeBtn'); if (tb) tb.innerHTML = `${icon(isDark() ? 'sun' : 'moon')} ${({ auto: 'Auto theme', light: 'Light', dark: 'Dark' })[getTheme()]}`; }, k: 'theme dark light mode appearance' },
    { g: 'Actions', t: 'Focus timer', s: 'clock', run: () => import('./extras.js').then(x => x.toggleFocusTimer()), k: 'pomodoro timer focus' },
    { g: 'Actions', t: 'Keyboard shortcuts', s: 'key', run: () => shortcutsHelp(), k: 'help keys' },
    { g: 'Go to', t: 'Home', s: 'home', run: () => go('#/') }, { g: 'Go to', t: 'Notebooks', s: 'book', run: () => go('#/notebooks') }, { g: 'Go to', t: 'Planner', s: 'calendar', run: () => go('#/planner') },
    { g: 'Go to', t: 'Study', s: 'study', run: () => go('#/study') }, { g: 'Go to', t: 'Homework', s: 'check', run: () => go('#/homework') }, { g: 'Go to', t: 'Review', s: 'review', run: () => go('#/review') }, { g: 'Go to', t: 'Grades', s: 'grades', run: () => go('#/grades') },
    { g: 'Go to', t: 'Progress', s: 'zap', run: () => go('#/progress') }, { g: 'Go to', t: 'Settings', s: 'settings', run: () => go('#/settings') },
    ...nbs.map(n => ({ g: 'Notebooks', t: n.name, sub: `${n.subject || ''} · ${plural(n.scanned || 0, 'page')}`, s: 'book', run: () => go('#/notebook/' + n.id), k: n.subject || '' })),
    ...sets.map(s => ({ g: 'Study sets', t: s.title, sub: `${s.subject || ''}${s.cardCount ? ' · ' + s.cardCount + ' cards' : ''}${s.testCount ? ' · ' + s.testCount + ' tests' : ''}`, s: 'study', run: () => go('#/study/' + s.id), k: s.subject || '' })),
    ...evs.filter(e => !e.done).map(e => ({ g: 'Planner', t: e.title, sub: `${fmtDate(e.date)} · ${countdown(e.date)}`, s: 'calendar', run: () => go('#/planner?date=' + e.date), k: e.subject || '' })),
  ];
  let items = [], sel = 0, pageHits = [], searchT = null, lastQ = '';
  const norm = (s) => String(s || '').toLowerCase();
  const score = (it, q) => { const t = norm(it.t), k = norm(it.k); if (!q) return it.g === 'Actions' || it.g === 'Go to' ? 1 : 0.5; if (t.startsWith(q)) return 3; if (t.includes(q)) return 2; if (k.includes(q) || norm(it.sub).includes(q)) return 1; return 0; };
  const draw = () => {
    const q = norm(input.value.trim());
    items = actions.map(it => ({ it, sc: score(it, q) })).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, q ? 14 : 12).map(x => x.it);
    for (const p of pageHits) items.push({ g: 'Pages', t: `${p.notebook} · p.${p.index}${p.title ? ' — ' + p.title : ''}`, sub: p.snippet, s: 'sheet', run: () => go('#/page/' + p.id) });
    if (sel >= items.length) sel = Math.max(0, items.length - 1);
    let lastG = null;
    list.innerHTML = items.length ? items.map((it, i) => { const head = it.g !== lastG ? `<div class="pgroup">${esc(it.g)}</div>` : ''; lastG = it.g; return `${head}<div class="pitem ${i === sel ? 'on' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}">${icon(it.s)}<b>${esc(it.t)}</b>${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</div>`; }).join('') : `<div class="muted small" style="padding:14px 12px">${q.length < 2 ? 'Type to search.' : 'Nothing matches. Pages are searched by their digital copy, so scan and read a page first.'}</div>`;
    $$('.pitem', list).forEach(el => { el.onclick = () => run(+el.dataset.i); el.onmousemove = () => { sel = +el.dataset.i; $$('.pitem', list).forEach(x => x.classList.toggle('on', x === el)); }; });
    const on = $('.pitem.on', list); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const run = (i) => { const it = items[i]; if (!it) return; m.close(); it.run(); };
  input.oninput = () => { sel = 0; const q = input.value.trim(); draw(); clearTimeout(searchT); if (q.length >= 2 && q !== lastQ) searchT = setTimeout(async () => { lastQ = q; try { const r = await api('/search?q=' + encodeURIComponent(q)); if (input.value.trim() === q) { pageHits = r.pages.slice(0, 8); draw(); } } catch {} }, 220); else if (q.length < 2) { pageHits = []; lastQ = ''; } };
  input.onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); } else if (e.key === 'Enter') { e.preventDefault(); run(sel); } };
  draw(); input.focus(); if (initial) input.oninput();
}

export function shortcutsHelp() {
  const rows = [['⌘K / Ctrl+K or /', 'Search and actions'], ['?', 'This help'], ['g then h', 'Home'], ['g then n', 'Notebooks'], ['g then s', 'Scan'], ['g then p', 'Planner'], ['g then t', 'Study'], ['g then r', 'Review'], ['g then d', 'Grades'], ['g then o', 'Progress'], ['g then ,', 'Settings'],
    ['Space', 'Snap a photo (scanner) · flip a flashcard'], ['← →', 'Previous / next page, card or slide'], ['1 2 3 4', 'Rate a flashcard in Review: again / hard / good / easy'], ['n', 'Add a planner item (on the planner)'], ['e', 'Edit the transcript (on a page)'], ['Esc', 'Close a dialog or zoomed image']];
  modal(`<h2>Keyboard shortcuts</h2><div class="shortcuts">${rows.map(([k, v]) => `<div><span>${esc(v)}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div><div class="actions"><button class="btn primary" data-close>Done</button></div>`, { wide: true });
}
