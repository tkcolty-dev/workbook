import { state, api, $, $$, esc, h, render, md, mdi, mdPage, hydrateFigures, plain, icon, logoSvg, toast, modal, confirm, busy, todayISO, fmtDate, fmtTime, countdown, daysUntil, ago, TYPES, COLORS, MON, DOW, MONTHS, parseISO, loadNotebooks, loadEvents, loadStudy, invalidate, route, go, dispatch } from './core.js';
import { scanView, openAdjust, captureModal } from './scan.js';
import { studyListView, studyView, openNewStudy, testOnPage } from './study.js';
import { bookView } from './book.js';
import { registerSW, pushStatus, enablePush, disablePush, testPush, isIOS, isStandalone, pushSupported } from './push.js';
import { progressView, shareThing, sharedView, mountFocusTimer, toggleFocusTimer, smsSettingsHtml, wireSms } from './extras.js';

// ---------- shell ----------
const NAV = [
  ['#/', 'home', 'Home'], ['#/notebooks', 'book', 'Notebooks'], ['#/scan', 'camera', 'Scan'], ['#/planner', 'calendar', 'Planner'], ['#/study', 'study', 'Study'], ['#/progress', 'zap', 'Progress'],
];
export function shell(active, content) {
  const u = state.user;
  const initials = (u?.name || u?.username || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  render(`<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#/" style="text-decoration:none;color:inherit">${logoSvg(36)}<div class="name">WorkBook<small>Digital Notebook</small></div></a>
      <nav class="nav">${NAV.map(([href, ic, label]) => `<a href="${href}" class="${active === label ? 'active' : ''}">${icon(ic)}${label}</a>`).join('')}</nav>
      <button class="nav-btn" id="focusBtn" title="Focus timer (25/5)">⏱ Focus timer</button>
      <div class="spacer"></div>
      <a class="nav-a" href="#/settings" style="text-decoration:none"><div class="userbox"><div class="avatar">${esc(initials)}</div><div class="who"><b>${esc(u?.name || u?.username)}</b><span title="${esc(state.ai?.model || '')}">${state.ai?.available === false ? '⚠️ AI not set up' : state.ai?.mode === 'cli' ? 'AI: Claude (local)' : state.ai?.mode === 'anthropic' ? 'AI: Claude' : 'AI: ' + esc((state.ai?.model || '').split(' + ')[0])}</span></div>${icon('settings', 'muted')}</div></a>
    </aside>
    <main class="main">${state.ai?.available === false ? `<div class="ai-status" style="margin-bottom:14px;background:var(--amber-soft);color:#7a4d00">⚠️ AI features are switched off on this server (no API key). Scanning, notebooks and the planner work; AI reading, study sheets, tests and flashcards will be enabled once a key is added.</div>` : ''}${content}</main>
    <nav class="tabbar">${NAV.filter(n => n[2] !== 'Progress').map(([href, ic, label]) => label === 'Scan' ? `<a href="${href}" class="scan-tab ${active === label ? 'active' : ''}"><div class="ring">${icon(ic)}</div>Scan</a>` : `<a href="${href}" class="${active === label ? 'active' : ''}">${icon(ic)}${label}</a>`).join('')}</nav>
  </div>`);
  const fb = $('#focusBtn'); if (fb) fb.onclick = toggleFocusTimer;
  mountFocusTimer();
  return $('.main');
}
export const nbCover = (nb, extra = '') => `<div class="nb-cover color-${esc(nb.color || 'navy')} ${extra}"><div class="rings"></div><div class="label"><b>${esc(nb.name)}</b><span>${esc(nb.subject || 'Notebook')}</span></div><div class="foot">${nb.pageCount ? `<div class="progress"><i style="width:${Math.min(100, Math.round(100 * (nb.scanned || 0) / nb.pageCount))}%"></i></div><span>${nb.scanned || 0}/${nb.pageCount}</span>` : `<span></span><span>${nb.scanned || 0} page${nb.scanned === 1 ? '' : 's'}</span>`}</div></div>`;

// ---------- auth ----------
function authView(mode = 'login') {
  const login = mode === 'login';
  let last = null; try { last = JSON.parse(localStorage.getItem('dwb_last_user') || 'null'); } catch {}
  const initials = (n) => (n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  render(`<div class="auth">
    <aside class="auth-side">
      <div class="auth-side-inner">
        <a class="brand" href="#/" style="text-decoration:none;color:inherit;padding:0">${logoSvg(40)}<div class="name">WorkBook<small>Digital Notebook</small></div></a>
        <h2 class="auth-tag">Your notebooks, digitized.<br>Your tests, handled.</h2>
        <p class="auth-lead">Point your camera at a page. WorkBook straightens it, keeps your pen colors, reads your handwriting into clean notes, and turns your planner's next test into a study sheet, practice test and flashcards.</p>
        <ol class="auth-steps">
          <li><span>1</span><div><b>Scan</b>Camera or photo — AI finds the page edges</div></li>
          <li><span>2</span><div><b>Read</b>Handwriting → notes, math, key points, vocab</div></li>
          <li><span>3</span><div><b>Study</b>Sheets · practice tests · flashcards · tutor</div></li>
        </ol>
        <div class="auth-mock">
          <div class="mock-page paper holes"><div class="scanline"></div><div class="hand" style="font-size:20px;line-height:28px;color:#1a2a6b">Ch. 5 – The Cell<br>• Nucleus → holds DNA<br>• <span style="color:#c0392b">Mitochondria</span> → makes ATP<br>• Chloroplast → <span style="color:#1e8f4e">plants only</span><br>• Area = <span style="color:#7a4fd6">½ · b · h</span></div><div class="mock-badge">${icon('sparkle')} AI read this page</div></div>
          <div class="mock-card mock-test">${icon('zap')}<div><b>Ch. 5 Cell Test</b><span>Friday · in 3 days</span></div><span class="chip red">Study</span></div>
          <div class="mock-card mock-fc"><span class="lab">Flashcard</span><b>What does the mitochondria do?</b><span class="muted small">tap to flip</span></div>
          <div class="mock-card mock-score"><div class="score-ring" style="--p:92;width:54px;height:54px"><div style="width:40px;height:40px;font-size:13px">92%</div></div><div><b>Practice test</b><span>6 / 6 graded by AI</span></div></div>
        </div>
      </div>
      <div class="auth-foot"><span>📷 Phone & laptop</span><span>🎨 Keeps your pen colors</span><span>∑ Math & fractions</span><span>☁️ Synced to your account</span></div>
    </aside>
    <main class="auth-main">
      <div class="auth-card">
        <div class="auth-mobile-hero"><div class="brand" style="padding:0">${logoSvg(38)}<div class="name">WorkBook<small>Digital Notebook</small></div></div><div class="chips" style="margin-top:10px"><span class="chip blue">📷 Scan</span><span class="chip purple">✨ AI notes</span><span class="chip amber">📅 Planner</span><span class="chip green">🎓 Study</span></div></div>
        ${login && last?.username ? `<div class="last-user"><div class="avatar">${esc(initials(last.name || last.username))}</div><div><b>Welcome back, ${esc((last.name || last.username).split(' ')[0])}</b><span class="muted small">Signing in as @${esc(last.username)} · <a href="#" id="notYou">not you?</a></span></div></div>` : `<h1>${login ? 'Welcome back' : 'Create your account'}</h1>`}
        <p class="muted" style="margin:6px 0 20px">${login ? 'Log in to open your notebooks, planner and study sets.' : 'Free to use — set up in 10 seconds. Your notes sync to your account.'}</p>
        <form id="authForm" novalidate>
          ${login ? '' : `<div class="field"><label for="f-name">Your name</label><input id="f-name" type="text" name="name" placeholder="What should we call you?" autocomplete="name" required></div>`}
          <div class="field ${login && last?.username ? 'hidden' : ''}" id="userField"><label for="f-user">Username</label><input id="f-user" type="text" name="username" placeholder="e.g. colton" autocomplete="username" autocapitalize="off" spellcheck="false" value="${login && last?.username ? esc(last.username) : ''}" required></div>
          <div class="field"><div style="display:flex;justify-content:space-between;align-items:center"><label for="f-pass">Password</label>${login ? '<a href="#" class="small" id="forgot" style="text-decoration:none">Forgot password?</a>' : '<span class="help">At least 4 characters</span>'}</div>
            <div class="pw-wrap"><input id="f-pass" type="password" name="password" placeholder="${login ? 'Your password' : 'Choose a password'}" autocomplete="${login ? 'current-password' : 'new-password'}" required><button type="button" class="pw-eye" id="pwEye" title="Show password">${icon('eye')}</button></div>
            <div class="caps hidden" id="caps">⇪ Caps Lock is on</div>
            ${login ? '' : '<div class="pw-meter" id="pwMeter"><i></i><i></i><i></i><i></i></div>'}</div>
          <label class="remember"><input type="checkbox" name="remember" id="remember" checked> Keep me logged in on this device <span class="muted">(60 days, renews as you use it)</span></label>
          <div class="error" id="authErr" role="alert"></div>
          <button class="btn primary lg block" style="margin-top:6px" type="submit">${login ? 'Log in' : 'Create account'} ${icon('chevR')}</button>
        </form>
        <div class="auth-switch">${login ? `New to WorkBook? <a href="#/register">Create an account</a>` : `Already have an account? <a href="#/login">Log in</a>`}</div>
        <div class="auth-legal">Your notes stay in your account. By continuing you agree to use WorkBook for good grades only 😉</div>
      </div>
    </main>
  </div>`);
  const form = $('#authForm');
  $('#pwEye').onclick = () => { const i = $('#f-pass'); i.type = i.type === 'password' ? 'text' : 'password'; };
  const forgot = $('#forgot'); if (forgot) forgot.onclick = (e) => { e.preventDefault(); toast('Password reset comes with email accounts — for now, make a new account or ask Colton 🙂'); };
  const notYou = $('#notYou'); if (notYou) notYou.onclick = (e) => { e.preventDefault(); localStorage.removeItem('dwb_last_user'); authView('login'); };
  const pass = $('#f-pass');
  pass.addEventListener('keyup', (e) => { const on = e.getModifierState && e.getModifierState('CapsLock'); $('#caps').classList.toggle('hidden', !on); });
  const meter = $('#pwMeter'); if (meter) pass.addEventListener('input', () => { const v = pass.value; let sc = 0; if (v.length >= 4) sc++; if (v.length >= 8) sc++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) sc++; if (/\d/.test(v) || /[^\w]/.test(v)) sc++; meter.dataset.score = sc; });
  setTimeout(() => (login && last?.username ? pass : $('#f-user') || pass).focus(), 60);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form); const btn = $('button[type=submit]', form); const err = $('#authErr');
    const d = Object.fromEntries(f); d.remember = $('#remember').checked;
    if (!d.username?.trim()) return err.textContent = 'Enter your username.';
    if (!d.password) return err.textContent = 'Enter your password.';
    if (!login && d.password.length < 4) return err.textContent = 'Password must be at least 4 characters.';
    err.textContent = '';
    busy(btn, true, login ? 'Logging in…' : 'Creating your account…');
    try {
      const r = await api('/auth/' + mode, { body: d });
      state.user = r.user; invalidate();
      if (d.remember) localStorage.setItem('dwb_last_user', JSON.stringify({ username: r.user.username, name: r.user.name })); else localStorage.removeItem('dwb_last_user');
      go('#/');
    } catch (ex) { err.textContent = ex.message; busy(btn, false); form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); if (login && last?.username) { $('#userField').classList.remove('hidden'); } }
  };
}

// ---------- home ----------
async function homeView() {
  const main = shell('Home', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const [nbs, evs, sets, recent] = await Promise.all([loadNotebooks(true), loadEvents(true), loadStudy(true), api('/recent?n=8')]);
  const today = todayISO();
  const upcoming = evs.filter(e => !e.done && e.date >= today).slice(0, 5);
  const tests = upcoming.filter(e => e.type === 'test' || e.type === 'quiz');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const totalPages = nbs.reduce((s, n) => s + (n.scanned || 0), 0);
  const lastNb = nbs.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
  main.innerHTML = `
    <div class="page-head"><div><h1>${greet}, ${esc((state.user.name || state.user.username).split(' ')[0])} 👋</h1><div class="sub">${fmtDate(today, { year: true })} · ${nbs.length} notebook${nbs.length === 1 ? '' : 's'} · ${totalPages} page${totalPages === 1 ? '' : 's'}</div></div>
      <div class="btn-row"><a class="btn lg" href="${lastNb ? '#/scan/' + lastNb.id + '?hw=1' : '#/scan'}" title="Scan your finished homework and the AI checks every answer">${icon('check')} Check homework</a><a class="btn primary lg" href="${lastNb ? '#/scan/' + lastNb.id : '#/scan'}">${icon('camera')} Scan pages</a></div></div>
    <div class="hero">
      <div>
        <div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3>${icon('camera', 'muted')} Recent pages</h3>${lastNb ? `<a class="btn sm ghost" href="#/notebook/${lastNb.id}">${esc(lastNb.name)} ${icon('chevR')}</a>` : ''}</div>
          ${recent.length ? `<div class="recent-list">${recent.map(p => `<a class="recent-row" href="#/page/${p.id}"><div class="rthumb" style="background-image:url('/api/pages/${p.id}/image?kind=thumb&r=${p.rev}')"></div><div class="rinfo"><b>${esc(p.title || 'Page ' + p.index)}</b><span class="muted small"><span class="nb-dot color-${esc(p.color)}"></span>${esc(p.notebook)} · p.${p.index} · ${ago(p.createdAt)}${p.status === 'analyzing' ? ' · AI reading…' : p.status === 'error' ? ' · ⚠︎ AI failed' : ''}</span></div>${icon('chevR', 'muted')}</a>`).join('')}</div>` : `<div class="empty" style="padding:22px"><h3>No pages yet</h3><p class="small">Tap <b>Scan pages</b>, point your camera at a page, snap. That's it — WorkBook crops, cleans and reads it.</p></div>`}
        </div>
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3>${icon('book', 'muted')} Notebooks</h3><div class="btn-row"><a class="btn sm ghost" href="#/notebooks?new=1">${icon('plus')} New</a><a class="btn sm ghost" href="#/notebooks">All ${icon('chevR')}</a></div></div>
          ${nbs.length ? `<div class="nb-list">${nbs.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map(n => nbRow(n)).join('')}</div>` : `<div class="muted small">Create a notebook to start.</div>`}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${tests.length ? `<div class="card" style="background:linear-gradient(135deg,#fff5f2,#fff);border-color:#f7d5cd"><h3>${icon('zap')} Next test</h3><div style="font-family:var(--serif);font-size:22px;margin:4px 0">${esc(tests[0].title)}</div><div class="muted small">${esc(tests[0].subject || '')} · ${fmtDate(tests[0].date)} · <b class="countdown ${daysUntil(tests[0].date) <= 3 ? 'urgent' : ''}">${countdown(tests[0].date)}</b></div><div class="btn-row" style="margin-top:12px"><a class="btn primary sm" href="${tests[0].studyId ? '#/study/' + tests[0].studyId : '#/study?new=1&event=' + tests[0].id}">${icon('study')} ${tests[0].studyId ? 'Keep studying' : 'Study for it'}</a></div></div>` : ''}
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3>${icon('bell', 'muted')} Coming up</h3><a class="btn sm ghost" href="#/planner">Planner ${icon('chevR')}</a></div>
          ${upcoming.length ? upcoming.map(eventRow).join('') : `<div class="muted small">Nothing scheduled. <a href="#/planner?new=1">Add a test or due date</a> — or just scan a page that mentions one and WorkBook will suggest it.</div>`}</div>
        ${sets.length ? `<div class="card"><h3>${icon('study')} Study sets</h3>${sets.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3).map(s => `<a href="#/study/${s.id}" style="display:block;padding:8px 0;border-bottom:1px solid var(--line-2);text-decoration:none;color:inherit"><b>${esc(s.title)}</b><div class="muted small">${esc(s.subject || '')} · ${s.cards?.length || 0} cards · ${s.tests?.length || 0} tests</div></a>`).join('')}<a class="btn sm ghost" style="margin-top:8px" href="#/study">All study sets ${icon('chevR')}</a></div>` : `<div class="card"><h3>${icon('study')} Study</h3><div class="muted small">Open any page and tap <b>Test on this</b>, or build a study set for a test.</div><a class="btn sm" style="margin-top:8px" href="#/study?new=1">${icon('plus')} New study set</a></div>`}
      </div>
    </div>`;
  wireEventRows(main);
}
export function nbRow(n, extra = '') {
  return `<a class="nb-row" href="#/notebook/${n.id}"><span class="nb-dot big color-${esc(n.color || 'navy')}"></span><div><b>${esc(n.name)}</b><span class="muted small">${esc(n.subject || 'Notebook')} · ${n.scanned || 0} page${n.scanned === 1 ? '' : 's'}${n.pageCount ? ' · goal ' + n.pageCount : ''} · ${ago(n.updatedAt)}</span></div>${extra}${icon('chevR', 'muted')}</a>`;
}
export function eventRow(e) {
  const d = parseISO(e.date); const n = daysUntil(e.date);
  return `<div class="event-row ${e.done ? 'done' : ''}" data-id="${e.id}"><div class="date ${n >= 0 && n <= 2 && (e.type === 'test' || e.type === 'quiz') ? 'soon' : ''}"><b>${d.getDate()}</b><span>${MON[d.getMonth()]}</span></div>
    <div class="info"><b><span class="type-dot t-${esc(e.type)}"></span>${esc(e.title)}</b><span>${esc(TYPES[e.type] || e.type)}${e.subject ? ' · ' + esc(e.subject) : ''}${e.time ? ' · ' + fmtTime(e.time) : ''} · ${countdown(e.date)}</span></div>
    ${(e.type === 'test' || e.type === 'quiz') && !e.done ? `<a class="btn sm ${n <= 5 ? 'primary' : ''}" href="${e.studyId ? '#/study/' + e.studyId : '#/study?new=1&event=' + e.id}">${icon('study')} Study</a>` : ''}
    <button class="btn icon sm ghost ev-edit" title="Edit">${icon('edit')}</button></div>`;
}
export function wireEventRows(root) {
  $$('.ev-edit', root).forEach(b => b.onclick = () => { const id = b.closest('.event-row').dataset.id; eventModal(state.events.find(e => e.id === id)); });
}

// ---------- notebooks ----------
async function notebooksView(_, q) {
  const main = shell('Notebooks', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const nbs = await loadNotebooks(true);
  main.innerHTML = `<div class="page-head"><div><h1>Notebooks</h1><div class="sub">Everything you've scanned, one notebook per class or subject.</div></div><div class="btn-row"><div class="search-box">${icon('search')}<input class="input" id="q" placeholder="Search all pages…" style="width:240px"></div><button class="btn primary" id="newNb">${icon('plus')} New notebook</button></div></div>
    <div id="hits"></div>
    ${nbs.length ? `<div class="nb-list big">${nbs.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(n => nbRow(n, `<a class="btn sm ghost" href="#/scan/${n.id}" onclick="event.stopPropagation()">${icon('camera')} Scan</a>`)).join('')}</div>` : `<div class="empty"><div class="big">📓</div><h3>No notebooks yet</h3><p>A notebook is just a name (and a color). Make one, then scan pages into it.</p><button class="btn primary" id="newNb2">${icon('plus')} New notebook</button></div>`}`;
  $('#newNb').onclick = () => notebookModal();
  if ($('#newNb2')) $('#newNb2').onclick = () => notebookModal();
  let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => searchPages(e.target.value), 250); };
  if (q.new) notebookModal();
}
async function searchPages(qs) {
  const box = $('#hits'); if (!qs.trim()) { box.innerHTML = ''; return; }
  const hits = await api('/search?q=' + encodeURIComponent(qs));
  const re = new RegExp('(' + qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  box.innerHTML = hits.length ? `<div class="card" style="margin-bottom:16px"><h3>${hits.length} page${hits.length === 1 ? '' : 's'} match “${esc(qs)}”</h3>${hits.map(hh => `<div class="hit" onclick="location.hash='#/page/${hh.id}'"><b>${esc(hh.notebook)} · Page ${hh.index}${hh.title ? ' — ' + esc(hh.title) : ''}</b><span>${esc(hh.snippet).replace(re, '<mark>$1</mark>')}</span></div>`).join('')}</div>` : `<div class="muted small" style="margin-bottom:12px">No pages match “${esc(qs)}”.</div>`;
}
export function notebookModal(nb, opts = {}) {
  const isNew = !nb; nb = nb || { name: '', subject: '', color: COLORS[Math.floor(Math.random() * 8)], pageCount: 0 };
  const m = modal(`<h2>${isNew ? 'New notebook' : 'Notebook settings'}</h2>
    <div class="field"><label>Name</label><input type="text" id="nbName" value="${esc(nb.name)}" placeholder="e.g. Biology, Math 7, History notes"></div>
    <div class="field"><label>Subject / class <span class="muted">(optional)</span></label><input type="text" id="nbSubject" value="${esc(nb.subject)}" placeholder="e.g. Biology"></div>
    <div class="field"><label>Color</label><div class="swatches">${COLORS.map(c => `<div class="swatch color-${c} ${c === nb.color ? 'active' : ''}" data-c="${c}"></div>`).join('')}</div></div>
    <details ${nb.pageCount ? 'open' : ''}><summary class="small muted" style="cursor:pointer">Optional: set a page goal</summary><div class="field" style="margin-top:8px"><label>How many pages do you plan to scan?</label><input type="number" id="nbPages" min="0" max="500" value="${nb.pageCount || ''}" placeholder="leave empty for no goal"><div class="help">Just shows a progress bar. You can scan as many pages as you like either way.</div></div></details>
    <div class="actions">${!isNew ? `<button class="btn danger" id="del" style="margin-right:auto">${icon('trash')} Delete notebook</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="save">${isNew ? 'Create' : 'Save'}</button></div>`);
  const el = m.el; let color = nb.color;
  $$('.swatch', el).forEach(s => s.onclick = () => { $$('.swatch', el).forEach(x => x.classList.remove('active')); s.classList.add('active'); color = s.dataset.c; });
  $('#nbName', el).onkeydown = (e) => { if (e.key === 'Enter') $('#save', el).click(); };
  $('#save', el).onclick = async () => {
    const body = { name: $('#nbName', el).value.trim(), subject: $('#nbSubject', el).value.trim(), color, pageCount: +$('#nbPages', el).value || 0 };
    if (!body.name) return toast('Give your notebook a name', 'err');
    busy($('#save', el), true, 'Saving…');
    try {
      if (isNew) { const created = await api('/notebooks', { body }); invalidate(); m.close(); if (opts.then) opts.then(created); else go('#/scan/' + created.id); }
      else { await api.patch('/notebooks/' + nb.id, body); invalidate(); m.close(); dispatch(); }
    } catch (e) { toast(e.message, 'err'); busy($('#save', el), false); }
  };
  if (!isNew) $('#del', el).onclick = async () => { if (await confirm('Delete notebook?', `“${nb.name}” and all its scanned pages will be deleted.`)) { await api.del('/notebooks/' + nb.id); invalidate(); m.close(); go('#/notebooks'); } };
}

// ---------- notebook view: numbered page list ----------
async function notebookView({ id }) {
  const main = shell('Notebooks', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const nb = await api('/notebooks/' + id);
  let pages = nb.pages.slice(); let selecting = false; const sel = new Set(); let filter = '';
  const draw = () => {
    const shown = filter ? pages.filter(p => (p.title + ' ' + p.transcript).toLowerCase().includes(filter.toLowerCase())) : pages;
    main.innerHTML = `<div class="crumbs"><a href="#/notebooks">Notebooks</a> › <span>${esc(nb.name)}</span></div>
    <div class="page-head" style="margin-bottom:14px"><div><h1><span class="nb-dot big color-${esc(nb.color || 'navy')}" style="vertical-align:-2px;margin-right:8px"></span>${esc(nb.name)}</h1><div class="sub">${esc(nb.subject || 'Notebook')} · ${pages.length} page${pages.length === 1 ? '' : 's'}${nb.pageCount ? ` · goal ${nb.pageCount} (${Math.min(100, Math.round(100 * pages.length / nb.pageCount))}%)` : ''}</div></div>
      <div class="btn-row"><a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Scan more</a>${pages.length ? `<a class="btn" href="#/book/${nb.id}">▶ Slideshow</a><a class="btn" href="#/study?new=1&notebook=${nb.id}">${icon('study')} Study</a><button class="btn" id="printNb">${icon('print')} PDF</button><button class="btn" id="shareNb">${icon('upload')} Share</button>` : ''}<button class="btn icon" id="edit" title="Notebook settings">${icon('settings')}</button></div></div>
    ${pages.length ? `<div class="list-tools"><div class="search-box">${icon('search')}<input class="input" id="pq" placeholder="Find in this notebook…" value="${esc(filter)}"></div><div class="btn-row">${selecting ? `<span class="muted small">${sel.size} selected</span><button class="btn sm" id="selAll">All</button><button class="btn sm danger" id="delSel" ${sel.size ? '' : 'disabled'}>${icon('trash')} Delete</button><button class="btn sm" id="moveSel" ${sel.size ? '' : 'disabled'}>Move to…</button><button class="btn sm" id="cancelSel">Done</button>` : `<button class="btn sm" id="selMode">Select</button>`}</div></div>
    <div class="page-list" id="plist">${shown.map(p => `<div class="prow ${sel.has(p.id) ? 'sel' : ''}" data-id="${p.id}" draggable="${selecting ? 'false' : 'true'}">
        ${selecting ? `<label class="pchk"><input type="checkbox" ${sel.has(p.id) ? 'checked' : ''}></label>` : `<div class="pnum">${p.index}</div>`}
        <div class="pthumb" style="background-image:url('/api/pages/${p.id}/image?kind=thumb&r=${p.rev || 0}')"></div>
        <div class="pinfo"><b>${esc(p.title || 'Page ' + p.index)}</b><span class="muted small">${ago(p.createdAt)}${p.keyPoints?.length ? ' · ' + p.keyPoints.length + ' key points' : ''}${p.figures?.length ? ' · 🖼 ' + p.figures.length : ''}${p.suggestions?.some(s => !s.done) ? ' · <span style="color:var(--amber)">📅 planner suggestion</span>' : ''}${p.status === 'analyzing' ? ' · <span class="spinner" style="width:10px;height:10px"></span> AI reading' : p.status === 'error' ? ' · <span style="color:var(--red)">AI failed</span>' : p.status !== 'ready' ? ' · not read yet' : ''}</span><span class="muted small pexcerpt">${esc(plain(p.transcript, 120))}</span></div>
        <div class="pacts">${selecting ? '' : `<button class="btn icon sm ghost up" title="Move up">${icon('chevL')}</button><button class="btn icon sm ghost down" title="Move down">${icon('chevR')}</button><button class="btn icon sm ghost pdel" title="Delete page">${icon('trash')}</button>`}</div>
      </div>`).join('')}</div>
    ${shown.length === 0 ? `<div class="muted small" style="padding:12px">No pages match.</div>` : ''}
    <div class="muted small" style="margin-top:10px">Tip: drag pages to reorder · tap a page to open it · Select to delete or move several at once.</div>`
    : `<div class="empty"><div class="big">📷</div><h3>No pages yet</h3><p>Tap Scan more and snap the first page. WorkBook crops it, cleans it up and reads it — you just keep snapping.</p><a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Start scanning</a></div>`}`;
    $('#edit').onclick = () => notebookModal(nb);
    const sb = $('#shareNb'); if (sb) sb.onclick = () => shareThing('notebook', nb.id, nb.name);
    const pb = $('#printNb'); if (pb) pb.onclick = () => printNotebook({ ...nb, pages });
    const pq = $('#pq'); if (pq) { pq.oninput = () => { filter = pq.value; const y = window.scrollY; draw(); $('#pq').focus(); $('#pq').setSelectionRange(filter.length, filter.length); window.scrollTo(0, y); }; }
    const sm = $('#selMode'); if (sm) sm.onclick = () => { selecting = true; sel.clear(); draw(); };
    const cs = $('#cancelSel'); if (cs) cs.onclick = () => { selecting = false; sel.clear(); draw(); };
    const sa = $('#selAll'); if (sa) sa.onclick = () => { if (sel.size === pages.length) sel.clear(); else pages.forEach(p => sel.add(p.id)); draw(); };
    const ds = $('#delSel'); if (ds) ds.onclick = async () => { if (!(await confirm(`Delete ${sel.size} page${sel.size === 1 ? '' : 's'}?`, 'The scans and their digital copies will be removed.'))) return; for (const id of sel) await api.del('/pages/' + id).catch(() => {}); invalidate(); const fresh = await api('/notebooks/' + id); pages = fresh.pages; selecting = false; sel.clear(); draw(); toast('Deleted', 'ok'); };
    const mv = $('#moveSel'); if (mv) mv.onclick = async () => { const nbs = await loadNotebooks(); const others = nbs.filter(n => n.id !== nb.id); if (!others.length) return toast('No other notebook to move to — create one first', 'err'); const mm = modal(`<h2>Move ${sel.size} page${sel.size === 1 ? '' : 's'} to…</h2><div class="nb-list">${others.map(n => `<button class="nb-row" data-id="${n.id}"><span class="nb-dot color-${esc(n.color)}"></span><div><b>${esc(n.name)}</b><span class="muted small">${n.scanned || 0} pages</span></div></button>`).join('')}</div><div class="actions"><button class="btn" data-close>Cancel</button></div>`); $$('.nb-row', mm.el).forEach(b => b.onclick = async () => { for (const pid of sel) await api.patch('/pages/' + pid, { notebookId: b.dataset.id }).catch(() => {}); mm.close(); invalidate(); const fresh = await api('/notebooks/' + id); pages = fresh.pages; selecting = false; sel.clear(); draw(); toast('Moved', 'ok'); }); };
    $$('.prow').forEach(row => {
      const pid = row.dataset.id;
      row.onclick = (e) => { if (e.target.closest('button,label,input')) return; if (selecting) { sel.has(pid) ? sel.delete(pid) : sel.add(pid); draw(); } else go('#/page/' + pid); };
      const chk = $('input', row); if (chk) chk.onchange = () => { chk.checked ? sel.add(pid) : sel.delete(pid); draw(); };
      const up = $('.up', row), down = $('.down', row), del = $('.pdel', row);
      if (up) up.onclick = () => moveBy(pid, -1); if (down) down.onclick = () => moveBy(pid, 1);
      if (del) del.onclick = async () => { const p = pages.find(x => x.id === pid); if (await confirm('Delete this page?', `Page ${p.index}${p.title ? ' — ' + p.title : ''} will be removed.`)) { await api.del('/pages/' + pid); invalidate(); const fresh = await api('/notebooks/' + id); pages = fresh.pages; draw(); } };
      // drag to reorder
      row.ondragstart = (e) => { e.dataTransfer.setData('text/plain', pid); row.classList.add('dragging'); };
      row.ondragend = () => row.classList.remove('dragging');
      row.ondragover = (e) => { e.preventDefault(); row.classList.add('over'); };
      row.ondragleave = () => row.classList.remove('over');
      row.ondrop = async (e) => { e.preventDefault(); row.classList.remove('over'); const from = e.dataTransfer.getData('text/plain'); if (!from || from === pid) return; const a = pages.findIndex(p => p.id === from), b = pages.findIndex(p => p.id === pid); const [mvd] = pages.splice(a, 1); pages.splice(b, 0, mvd); await saveOrder(); };
    });
  };
  const moveBy = async (pid, d) => { const i = pages.findIndex(p => p.id === pid); const j = i + d; if (j < 0 || j >= pages.length) return; [pages[i], pages[j]] = [pages[j], pages[i]]; await saveOrder(); };
  const saveOrder = async () => { const r = await api(`/notebooks/${nb.id}/reorder`, { body: { pageIds: pages.map(p => p.id) } }); r.pages.forEach(x => { const p = pages.find(q => q.id === x.id); if (p) p.index = x.index; }); pages.sort((a, b) => a.index - b.index); invalidate(); draw(); };
  draw();
}
// Print / save-as-PDF: every page with its scan and digital copy.
function printNotebook(nb) {
  const w = window.open('', '_blank'); if (!w) return toast('Pop-up blocked — allow pop-ups to export', 'err');
  const pages = nb.pages.map(p => `<section class="pp"><div class="scan"><img src="/api/pages/${p.id}/image?kind=enh&r=${p.rev || 0}"></div><div class="txt"><h2>${esc(p.title || 'Page ' + p.index)} <small>p.${p.index}</small></h2><div class="md">${p.transcript ? md(p.transcript.replace(/\[\[figure:\d+\]\]/g, '')) : '<i>No digital copy</i>'}</div>${p.keyPoints?.length ? `<h3>Key points</h3><ul>${p.keyPoints.map(k => `<li>${mdi(k)}</li>`).join('')}</ul>` : ''}</div></section>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(nb.name)}</title><link rel="stylesheet" href="/vendor/katex/katex.min.css"><link rel="stylesheet" href="/css/styles.css"><style>
    body{padding:24px;background:#fff}.cover{text-align:center;padding:120px 0;page-break-after:always}.cover h1{font-size:44px}.cover p{color:#666}
    .pp{display:grid;grid-template-columns:1fr 1fr;gap:24px;page-break-after:always;padding:8px 0;min-height:90vh;align-items:start}.pp .scan img{width:100%;border:1px solid #ddd;border-radius:6px}.pp h2 small{color:#999;font-weight:400;font-size:14px}
    @media print{body{padding:0}.pp{min-height:auto}}</style></head><body>
    <div class="cover"><h1>${esc(nb.name)}</h1><p>${esc(nb.subject || '')} · ${nb.pages.length} pages · exported from WorkBook</p></div>${pages}
    <script>window.onload=()=>setTimeout(()=>print(),600)</script></body></html>`);
  w.document.close();
}

// ---------- page viewer ----------
async function pageView({ id }) {
  const main = shell('Notebooks', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  let page = null, nb = null;
  try { const r = await api('/pages/' + id); page = r.page; nb = r.notebook; } catch { toast('Page not found', 'err'); return go('#/notebooks'); }
  const idx = nb.pages.findIndex(p => p.id === id);
  const prev = nb.pages[idx - 1], next = nb.pages[idx + 1];
  let kind = 'enh';
  const sugs = (page.suggestions || []).filter(s => !s.done);
  main.innerHTML = `<div class="crumbs"><a href="#/notebooks">Notebooks</a> › <a href="#/notebook/${nb.id}">${esc(nb.name)}</a> › <span>Page ${page.index}</span></div>
    <div class="page-head" style="margin-bottom:14px"><div><h1 id="ptitle" contenteditable="true" spellcheck="false" title="Click to rename" style="outline:none;border-bottom:1px dashed transparent">${esc(page.title || 'Page ' + page.index)}</h1><div class="sub">${esc(nb.name)} · page ${page.index} of ${nb.pages.length} · scanned ${ago(page.createdAt)}${page.readability ? ' · handwriting: ' + esc(page.readability) : ''}</div></div>
      <div class="btn-row"><button class="btn primary" id="testThis">${icon('quiz')} Test on this</button><button class="btn" id="checkHw">${icon('check')} Check homework</button><button class="btn" id="gradedBtn" title="This is a test the teacher graded — make a fix-it study set from what I missed">📝 Graded test → fix it</button><button class="btn" id="adjust">${icon('edit')} Adjust</button><button class="btn" id="rerun">${icon('sparkle')} Re-read</button><a class="btn icon" href="/api/pages/${page.id}/image?kind=enh" download="${esc(nb.name)}-p${page.index}.jpg" title="Download">${icon('download')}</a><button class="btn icon danger" id="delp" title="Delete page">${icon('trash')}</button></div></div>
    ${sugs.length ? `<div class="card sug-card"><h3>📅 Spotted on this page</h3>${sugs.map((sg, k) => `<div class="sug-row"><div><b>${esc(sg.title)}</b> <span class="chip">${esc(TYPES[sg.type] || sg.type)}</span><div class="muted small">${sg.dateText ? '“' + esc(sg.dateText) + '” · ' : ''}${sg.date ? fmtDate(sg.date) + ' · ' + countdown(sg.date) : 'date unknown — pick one'}${sg.notes ? ' · ' + esc(sg.notes) : ''}</div></div><div class="btn-row"><button class="btn sm primary addSug" data-k="${k}">${icon('plus')} Add to planner</button><button class="btn sm ghost dismissSug" data-k="${k}">Dismiss</button></div></div>`).join('')}</div>` : ''}
    <div id="hwBox">${page.homework ? homeworkHtml(page.homework) : ''}</div>
    <div class="viewer">
      <div><div class="btn-row" style="justify-content:space-between;margin-bottom:8px"><div class="seg imgtools"><button class="active" data-k="enh">Enhanced</button><button data-k="orig">Original</button></div><span class="muted small">${page.figures?.length ? '🖼 ' + page.figures.length + ' picture' + (page.figures.length === 1 ? '' : 's') + ' kept' : ''}</span></div><div class="imgbox"><img id="pimg" src="/api/pages/${page.id}/image?kind=enh&r=${page.rev || 0}" alt="page"></div>
        <div class="pager">${prev ? `<a class="btn" href="#/page/${prev.id}">${icon('chevL')} Page ${prev.index}</a>` : '<span></span>'}<a class="btn ghost" href="#/notebook/${nb.id}">${icon('book')} All pages</a>${next ? `<a class="btn" href="#/page/${next.id}">Page ${next.index} ${icon('chevR')}</a>` : `<a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Scan next</a>`}</div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3><span class="ai-tag">${icon('sparkle')} AI</span> Digital copy</h3><div class="seg"><button class="active" id="mRead">Read</button><button id="mEdit">Edit</button></div></div>
        <div id="tstatus"></div>
        <div class="paper holes" id="tpaper"><div class="md" id="tread">${page.transcript ? mdPage(page.transcript, page) : '<span class="muted">No digital copy yet — press “Re-read”.</span>'}</div><textarea class="transcript hidden" id="tedit">${esc(page.transcript)}</textarea></div>
        <div id="tsave" class="hidden" style="margin-top:8px;text-align:right"><button class="btn primary sm" id="saveT">Save transcript</button></div>
        ${page.keyPoints?.length ? `<div class="card" style="margin-top:16px"><h3>Key points</h3><ul class="kp">${page.keyPoints.map(k => `<li>${mdi(k)}</li>`).join('')}</ul></div>` : ''}
        ${page.vocab?.length ? `<div class="card" style="margin-top:16px"><h3>Vocabulary</h3><div class="vocab">${page.vocab.map(v => `<div><b>${mdi(v.term)}</b> — ${mdi(v.definition)}</div>`).join('')}</div></div>` : ''}
        ${page.topics?.length ? `<div class="chips" style="margin-top:12px">${page.topics.map(t => `<span class="chip blue">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  hydrateFigures($('#tread'), page);
  $$('.imgtools button').forEach(b => b.onclick = () => { $$('.imgtools button').forEach(x => x.classList.remove('active')); b.classList.add('active'); kind = b.dataset.k; $('#pimg').src = `/api/pages/${page.id}/image?kind=${kind}&r=${page.rev || 0}`; });
  $('#mRead').onclick = () => { $('#mRead').classList.add('active'); $('#mEdit').classList.remove('active'); $('#tread').classList.remove('hidden'); $('#tedit').classList.add('hidden'); $('#tsave').classList.add('hidden'); };
  $('#mEdit').onclick = () => { $('#mEdit').classList.add('active'); $('#mRead').classList.remove('active'); $('#tread').classList.add('hidden'); $('#tedit').classList.remove('hidden'); $('#tsave').classList.remove('hidden'); $('#tedit').focus(); };
  $('#saveT').onclick = async () => { const t = $('#tedit').value; await api.patch('/pages/' + page.id, { transcript: t }); page.transcript = t; $('#tread').innerHTML = mdPage(t, page); hydrateFigures($('#tread'), page); $('#mRead').click(); toast('Saved', 'ok'); };
  $('#ptitle').onblur = async () => { const t = $('#ptitle').textContent.trim(); if (t && t !== page.title) { await api.patch('/pages/' + page.id, { title: t }); page.title = t; } };
  $('#ptitle').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
  $('#testThis').onclick = () => testOnPage(page, nb);
  $('#checkHw').onclick = () => checkHomework(page, nb);
  $('#gradedBtn').onclick = async () => { if (!(await confirm('Graded test?', 'AI will read the teacher’s marks on this page, find what you got wrong, and build a study set (flashcards + practice test) just for those.', { danger: false, ok: 'Build fix-it set' }))) return; const b = $('#gradedBtn'); busy(b, true, 'Reading the marks…'); try { const r = await api('/pages/' + page.id + '/graded', { body: {} }); invalidate(); toast(`Found ${r.missed} missed of ${r.total} — building your fix-it set`, 'ok'); sessionStorage.setItem('dwb_fixit', '1'); go('#/study/' + r.study.id + '?fixit=1'); } catch (e) { toast(e.message, 'err'); busy(b, false); } };
  wireHomework(page, nb);
  $('#adjust').onclick = () => openAdjust({ pageId: page.id, corners: null, filter: page.filter }, () => dispatch());
  $('#rerun').onclick = async () => { busy($('#rerun'), true, 'Reading…'); $('#tstatus').innerHTML = `<div class="ai-status"><span class="spinner"></span> AI is reading the page…</div>`; try { await api('/pages/' + page.id + '/analyze', { body: {} }); dispatch(); } catch (e) { toast(e.message, 'err'); busy($('#rerun'), false); $('#tstatus').innerHTML = ''; } };
  $('#delp').onclick = async () => { if (await confirm('Delete this page?', 'The scan and its digital copy will be removed.')) { await api.del('/pages/' + page.id); invalidate(); go('#/notebook/' + nb.id); } };
  $$('.addSug').forEach(b => b.onclick = () => { const sg = sugs[+b.dataset.k]; eventModal(null, sg.date || undefined, { title: sg.title, type: sg.type, subject: nb.subject || '', notes: sg.notes || '', notebookId: nb.id, onSaved: async () => { sg.done = true; await api.patch('/pages/' + page.id, { suggestions: page.suggestions }); dispatch(); } }); });
  $$('.dismissSug').forEach(b => b.onclick = async () => { sugs[+b.dataset.k].done = true; await api.patch('/pages/' + page.id, { suggestions: page.suggestions }); dispatch(); });
  document.onkeydown = (e) => { if (e.target.closest('input,textarea,[contenteditable]')) return; if (e.key === 'ArrowLeft' && prev) go('#/page/' + prev.id); if (e.key === 'ArrowRight' && next) go('#/page/' + next.id); };
}

// ---------- homework checker UI ----------
export function homeworkHtml(hw) {
  const v = { correct: ['✅', 'green', 'Correct'], partial: ['🟡', 'amber', 'Partly right'], wrong: ['❌', 'red', 'Wrong'], blank: ['⬜', '', 'No answer'] };
  return `<div class="card hw-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h3>${icon('check')} Homework check <span class="ai-tag">${icon('sparkle')} AI</span></h3><div class="muted small">${hw.assignment ? esc(hw.assignment) + ' · ' : ''}checked ${ago(hw.checkedAt)} · ${hw.items.length} problems</div></div>
      <div class="hw-score"><div class="score-ring" style="--p:${hw.score.percent};width:64px;height:64px"><div style="width:48px;height:48px;font-size:15px">${hw.score.percent}%</div></div><div class="small"><span class="chip green">${hw.score.correct} ✓</span> ${hw.score.partial ? `<span class="chip amber">${hw.score.partial} partly</span> ` : ''}${hw.score.wrong ? `<span class="chip red">${hw.score.wrong} ✗</span> ` : ''}${hw.score.blank ? `<span class="chip">${hw.score.blank} blank</span>` : ''}</div></div></div>
    ${hw.summary ? `<p style="margin:8px 0 4px">${esc(hw.summary)}</p>` : ''}
    <div class="hw-items">${hw.items.map(it => `<div class="hw-item ${it.verdict}"><div class="hw-n">${esc(it.n)}</div><div class="hw-body"><div class="hw-q">${mdi(it.problem)}</div><div class="small"><span class="muted">You wrote:</span> <b>${it.studentAnswer ? mdi(it.studentAnswer) : '<i class="muted">nothing</i>'}</b> <span class="chip ${v[it.verdict][1]}">${v[it.verdict][0]} ${v[it.verdict][2]}</span></div>${it.verdict !== 'correct' ? `<div class="hw-fix"><b>Correct answer:</b> ${mdi(it.correctAnswer)}${it.explanation ? `<div style="margin-top:3px">${mdi(it.explanation)}</div>` : ''}</div>` : ''}</div></div>`).join('')}</div>
    ${hw.tips?.length ? `<div class="hw-tips"><b>What to practice</b><ul>${hw.tips.map(t => `<li>${mdi(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="btn-row" style="margin-top:10px"><button class="btn sm" id="recheck">${icon('refresh')} Check again</button><button class="btn sm primary" id="practiceSimilar">${icon('quiz')} Practice similar problems</button></div></div>`;
}
export function wireHomework(page, nb) {
  const rc = $('#recheck'); if (rc) rc.onclick = () => checkHomework(page, nb);
  const ps = $('#practiceSimilar'); if (ps) ps.onclick = () => testOnPage(page, nb);
}
export async function checkHomework(page, nb) {
  const m = modal(`<h2>Check my homework</h2><p class="muted small" style="margin:-6px 0 12px">AI reads every problem and your answer on this page, solves each one, and tells you what's right, what's off and why.</p>
    <div class="field"><label>Anything the AI should know? <span class="muted">(optional)</span></label><input class="input" id="hwHint" placeholder="e.g. it's a fractions worksheet, answers are in the right column, ignore question 5"></div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="goHw">${icon('check')} Check it</button></div>`);
  $('#goHw', m.el).onclick = async () => {
    busy($('#goHw', m.el), true, 'Reading & checking… (20–60s)');
    try {
      const hw = await api('/pages/' + page.id + '/check', { body: { hint: $('#hwHint', m.el).value.trim() } });
      page.homework = hw; m.close();
      const box = $('#hwBox'); if (box) { box.innerHTML = homeworkHtml(hw); wireHomework(page, nb); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else go('#/page/' + page.id);
      toast(`Checked: ${hw.score.percent}%`, 'ok');
    } catch (e) { toast(e.message, 'err'); busy($('#goHw', m.el), false); }
  };
}

// ---------- planner ----------
let calMonth = null;
async function plannerView(_, q) {
  const main = shell('Planner', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const evs = await loadEvents(true);
  const today = todayISO();
  if (!calMonth) { const d = new Date(); calMonth = { y: d.getFullYear(), m: d.getMonth() }; }
  let selected = q.date || null; let view = localStorage.getItem('dwb_plan_view') || 'month';
  const draw = () => {
    const { y, m } = calMonth;
    const first = new Date(y, m, 1); const start = new Date(y, m, 1 - first.getDay());
    const cells = [];
    for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; cells.push({ d, iso, other: d.getMonth() !== m }); }
    const byDate = {}; for (const e of evs) (byDate[e.date] ||= []).push(e);
    const upcoming = evs.filter(e => !e.done && e.date >= today);
    const past = evs.filter(e => e.done || e.date < today).sort((a, b) => b.date.localeCompare(a.date));
    const listDate = selected ? (byDate[selected] || []) : null;
    const week = []; for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() + i); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; week.push({ d, iso, list: (byDate[iso] || []).filter(e => !e.done) }); }
    const agendaDays = []; for (let i = 0; i < 30; i++) { const d = new Date(); d.setDate(d.getDate() + i); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (byDate[iso]?.length) agendaDays.push({ iso, list: byDate[iso] }); }
    main.innerHTML = `<div class="page-head"><div><h1>Planner</h1><div class="sub">Tests, quizzes, homework and due dates — typed, scanned from your paper planner, or spotted on your notes.</div></div><div class="btn-row"><button class="btn" id="planScan">${icon('camera')} Scan my planner</button><button class="btn primary" id="newEv">${icon('plus')} Add</button></div></div>
      <div class="quick-add"><span>✨</span><input class="input" id="quickAdd" placeholder="Quick add: “math test friday”, “science hw p.42 due tue”, “history project oct 3”…"><button class="btn primary sm" id="quickGo">Add</button></div>
      <div class="week-strip">${week.map(w => `<button class="ws ${w.iso === today ? 'today' : ''} ${w.iso === selected ? 'sel' : ''}" data-iso="${w.iso}"><span class="wd">${DOW[w.d.getDay()]}</span><b>${w.d.getDate()}</b><span class="dots">${w.list.slice(0, 4).map(e => `<i class="t-${esc(e.type)}"></i>`).join('')}</span>${w.list.length ? `<span class="cnt">${w.list.length}</span>` : ''}</button>`).join('')}</div>
      <div class="btn-row" style="margin:10px 0"><div class="seg"><button id="vMonth" class="${view === 'month' ? 'active' : ''}">Month</button><button id="vAgenda" class="${view === 'agenda' ? 'active' : ''}">Agenda</button></div></div>
      <div class="planner">${view === 'month' ? `<div class="card">
        <div class="cal-head"><button class="btn icon ghost" id="pm">${icon('chevL')}</button><h2>${MONTHS[m]} ${y}</h2><div class="btn-row"><button class="btn sm ghost" id="tdy">Today</button><button class="btn icon ghost" id="nm">${icon('chevR')}</button></div></div>
        <div class="cal">${DOW.map(d => `<div class="dow">${d}</div>`).join('')}${cells.map(c => { const list = byDate[c.iso] || []; return `<div class="day ${c.other ? 'other' : ''} ${c.iso === today ? 'today' : ''} ${c.iso === selected ? 'selected' : ''}" data-iso="${c.iso}"><span class="n">${c.d.getDate()}</span>${list.slice(0, 3).map(e => `<span class="ev ${esc(e.type)} ${e.done ? 'done' : ''}">${esc(e.title)}</span>`).join('')}${list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : ''}<div class="dots">${list.map(e => `<i class="t-${esc(e.type)}"></i>`).join('')}</div></div>`; }).join('')}</div>
        <div class="chips" style="margin-top:12px">${Object.entries(TYPES).map(([k, v]) => `<span class="chip"><span class="type-dot t-${k}"></span>${v}</span>`).join('')}</div>
      </div>` : `<div class="card"><h3>Next 30 days</h3>${agendaDays.length ? agendaDays.map(g => `<div class="agenda-day"><div class="agenda-date ${g.iso === today ? 'today' : ''}">${g.iso === today ? 'Today · ' : ''}${fmtDate(g.iso)}</div>${g.list.map(eventRow).join('')}</div>`).join('') : '<p class="muted small">Nothing in the next 30 days. Add something above or scan your planner.</p>'}</div>`}
      <div>
        ${listDate ? `<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>${fmtDate(selected, { year: true })}</h3><button class="btn sm" id="addOn">${icon('plus')} Add here</button></div>${listDate.length ? listDate.map(eventRow).join('') : '<p class="muted small" style="margin:8px 0 0">Nothing on this day.</p>'}</div>` : ''}
        <div class="card"><h3>Upcoming</h3>${upcoming.length ? upcoming.map(eventRow).join('') : '<p class="muted small">Nothing coming up. Add your next test!</p>'}</div>
        ${past.length ? `<div class="card" style="margin-top:16px"><h3 class="muted">Past & done</h3>${past.slice(0, 8).map(eventRow).join('')}</div>` : ''}
      </div></div>`;
    const pm = $('#pm'); if (pm) { pm.onclick = () => { calMonth.m--; if (calMonth.m < 0) { calMonth.m = 11; calMonth.y--; } draw(); }; $('#nm').onclick = () => { calMonth.m++; if (calMonth.m > 11) { calMonth.m = 0; calMonth.y++; } draw(); }; $('#tdy').onclick = () => { const d = new Date(); calMonth = { y: d.getFullYear(), m: d.getMonth() }; selected = today; draw(); }; }
    $('#vMonth').onclick = () => { view = 'month'; localStorage.setItem('dwb_plan_view', view); draw(); };
    $('#vAgenda').onclick = () => { view = 'agenda'; localStorage.setItem('dwb_plan_view', view); draw(); };
    $('#newEv').onclick = () => eventModal(null, selected || today);
    if ($('#addOn')) $('#addOn').onclick = () => eventModal(null, selected);
    $$('.cal .day, .week-strip .ws').forEach(d => d.onclick = () => { selected = d.dataset.iso; draw(); });
    $('#quickAdd').onkeydown = (e) => { if (e.key === 'Enter') $('#quickGo').click(); };
    $('#quickGo').onclick = async () => { const t = $('#quickAdd').value.trim(); if (!t) return; busy($('#quickGo'), true, '…'); try { const ev = await api('/planner/parse', { body: { text: t } }); eventModal(null, ev.date, { title: ev.title, type: ev.type, subject: ev.subject, notes: ev.notes }); $('#quickAdd').value = ''; } catch (e) { toast(e.message, 'err'); } busy($('#quickGo'), false); };
    $('#planScan').onclick = async () => { const shots = await captureModal({ title: '📷 Scan my planner', hint: 'Snap your planner, agenda, syllabus or the board — one photo per page. The AI pulls out every assignment, test and due date.' }); if (shots.length) scanPlanner(shots); };
    wireEventRows(main);
  };
  draw();
  if (q.new) eventModal(null, q.date || today);
}
// Scan a paper planner / syllabus: AI extracts every dated item → review → add selected.
async function scanPlanner(shots) {
  const { scaleCanvas, toDataURL } = await import('./imageproc.js');
  const m = modal(`<h2>📷 Reading your planner…</h2><div class="ai-status"><span class="spinner"></span> Finding every assignment, test and due date (${shots.length} photo${shots.length === 1 ? '' : 's'})…</div>`);
  let items = [];
  for (const c of shots) { try { const r = await api('/planner/extract', { body: { image: toDataURL(scaleCanvas(c, 1600), 0.85) } }); items.push(...r.items); } catch (e) { toast(e.message, 'err'); } }
  m.close();
  if (!items.length) return toast("Couldn't find any dated items in that photo. Try a closer, straight-on photo.", 'err');
  const mm = modal(`<h2>Found ${items.length} item${items.length === 1 ? '' : 's'}</h2><p class="muted small" style="margin:-6px 0 10px">Check the ones to add. Fix a date or title right here if the AI got it wrong.</p>
    <div class="plan-review">${items.map((it, i) => `<div class="pr-row"><input type="checkbox" class="prc" data-i="${i}" ${it.date ? 'checked' : ''}><input class="input prt" data-i="${i}" value="${esc(it.title)}"><select class="prk" data-i="${i}">${Object.entries(TYPES).filter(([k]) => k !== 'other').map(([k, v]) => `<option value="${k}" ${it.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select><input type="date" class="prd" data-i="${i}" value="${it.date || ''}" title="${esc(it.dateText || '')}"></div>${!it.date ? `<div class="small muted" style="margin:-4px 0 6px 28px">Date unclear (“${esc(it.dateText || '?')}”) — pick one to include it</div>` : ''}`).join('')}</div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="addAll">${icon('plus')} Add selected</button></div>`, { wide: true });
  $('#addAll', mm.el).onclick = async () => {
    const picked = [];
    $$('.prc', mm.el).forEach(c => { if (!c.checked) return; const i = +c.dataset.i; const date = $(`.prd[data-i="${i}"]`, mm.el).value; if (!date) return; picked.push({ ...items[i], title: $(`.prt[data-i="${i}"]`, mm.el).value.trim() || items[i].title, type: $(`.prk[data-i="${i}"]`, mm.el).value, date }); });
    if (!picked.length) return toast('Pick at least one item with a date', 'err');
    busy($('#addAll', mm.el), true, 'Adding…');
    const r = await api('/events/bulk', { body: { items: picked } });
    invalidate(); mm.close(); toast(`Added ${r.added} to your planner 🎉`, 'ok'); dispatch(); nudgeReminders();
  };
}
export async function eventModal(ev, date, pre = {}) {
  const isNew = !ev; ev = ev || { title: pre.title || '', type: pre.type || 'test', subject: pre.subject || '', date: date || todayISO(), time: '', notes: pre.notes || '', notebookId: pre.notebookId || '' };
  const nbs = await loadNotebooks();
  const m = modal(`<h2>${isNew ? 'Add to planner' : 'Edit'}</h2>
    <div class="field"><label>What is it?</label><input type="text" id="evTitle" value="${esc(ev.title)}" placeholder="e.g. Chapter 5 test — cells"></div>
    <div class="row"><div class="field"><label>Type</label><select id="evType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === ev.type ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label>Subject</label><input type="text" id="evSubject" list="subjects" value="${esc(ev.subject)}" placeholder="e.g. Biology"><datalist id="subjects">${[...new Set(nbs.map(n => n.subject).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('')}</datalist></div></div>
    <div class="row"><div class="field"><label>Date</label><input type="date" id="evDate" value="${esc(ev.date)}"></div><div class="field"><label>Time (optional)</label><input type="time" id="evTime" value="${esc(ev.time || '')}"></div></div>
    <div class="field"><label>Notebook (for studying)</label><select id="evNb"><option value="">— none —</option>${nbs.map(n => `<option value="${n.id}" ${n.id === ev.notebookId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Notes</label><textarea id="evNotes" placeholder="What's on it? Chapters, topics, what the teacher said…">${esc(ev.notes || '')}</textarea></div>
    <div class="actions">${!isNew ? `<button class="btn danger" id="del" style="margin-right:auto">${icon('trash')}</button><button class="btn" id="done">${ev.done ? 'Mark not done' : icon('check') + ' Mark done'}</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="save">${isNew ? 'Add' : 'Save'}</button></div>`);
  const el = m.el;
  $('#evTitle', el).onkeydown = (e) => { if (e.key === 'Enter') $('#save', el).click(); };
  $('#save', el).onclick = async () => {
    const body = { title: $('#evTitle', el).value.trim(), type: $('#evType', el).value, subject: $('#evSubject', el).value.trim(), date: $('#evDate', el).value, time: $('#evTime', el).value, notes: $('#evNotes', el).value, notebookId: $('#evNb', el).value || null };
    if (!body.title || !body.date) return toast('Add a title and a date', 'err');
    try {
      if (isNew) { const created = await api('/events', { body }); invalidate(); m.close(); toast('Added to planner', 'ok'); if (pre.onSaved) pre.onSaved(created); nudgeReminders(); if ((body.type === 'test' || body.type === 'quiz') && daysUntil(body.date) >= 0) { if (await confirm('Start a study set?', `Want WorkBook to build a study sheet, practice test and flashcards for “${body.title}”?`, { danger: false, ok: 'Yes, let’s study' })) return go('#/study?new=1&event=' + created.id); } dispatch(); }
      else { await api.patch('/events/' + ev.id, body); invalidate(); m.close(); dispatch(); }
    } catch (e) { toast(e.message, 'err'); }
  };
  if (!isNew) {
    $('#del', el).onclick = async () => { await api.del('/events/' + ev.id); invalidate(); m.close(); dispatch(); };
    $('#done', el).onclick = async () => { await api.patch('/events/' + ev.id, { done: !ev.done }); invalidate(); m.close(); dispatch(); };
  }
}

// one-time nudge to turn on reminders after the first planner item
async function nudgeReminders() {
  try { if (localStorage.getItem('dwb_nudged')) return; const st = await pushStatus(); if (st.enabled) return; localStorage.setItem('dwb_nudged', '1');
    const mm = modal(`<h2>🔔 Want a reminder?</h2><p class="muted">WorkBook can ping this device 3 days before, the day before and the morning of each test so you actually study.</p><div class="actions"><button class="btn" data-close>Not now</button><button class="btn primary" id="nOn">Turn on reminders</button></div>`);
    $('#nOn', mm.el).onclick = async () => { busy($('#nOn', mm.el), true, 'Turning on…'); try { await enablePush(); toast('Reminders on 🎉', 'ok'); mm.close(); } catch (e) { toast(e.message, 'err'); mm.close(); } };
  } catch {}
}
// ---------- settings ----------
async function settingsView() {
  const main = shell('', '');
  const st = await pushStatus();
  const prefs = state.user.settings?.reminders || {};
  main.innerHTML = `<div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="grid cols-2">
    <div class="card"><h3>🔔 Reminders</h3><p class="small muted" style="margin:4px 0 10px">WorkBook pings this device when it's time to study: <b>3 days before</b> a test (4pm), <b>the day before</b> (6pm), and <b>the morning of</b> (7am). Homework/projects: day before + day of.</p>
      <div id="pushBox">${st.enabled ? `<div class="ai-status" style="background:var(--green-soft);color:#14663f">✅ Reminders are ON for this device</div><div class="btn-row" style="margin-top:10px"><button class="btn sm" id="pushTest">Send a test notification</button><button class="btn sm danger" id="pushOff">Turn off</button></div>` : `<button class="btn primary" id="pushOn">${icon('bell')} Turn on reminders on this device</button>${isIOS() && !isStandalone() ? '<div class="small muted" style="margin-top:8px">📱 On iPhone/iPad: tap <b>Share → Add to Home Screen</b>, open WorkBook from there, then tap this button.</div>' : ''}${!pushSupported() && !isIOS() ? '<div class="small muted" style="margin-top:8px">This browser doesn’t support notifications.</div>' : ''}`}</div>
      <div style="margin-top:12px" class="small"><b>Which reminders</b><div class="btn-row" style="margin-top:6px"><label class="chip"><input type="checkbox" class="rp" data-k="d3" ${prefs.d3 === false ? '' : 'checked'}> 3 days before</label><label class="chip"><input type="checkbox" class="rp" data-k="d1" ${prefs.d1 === false ? '' : 'checked'}> Day before</label><label class="chip"><input type="checkbox" class="rp" data-k="d0" ${prefs.d0 === false ? '' : 'checked'}> Morning of</label></div></div>
      <div id="smsBox">${await smsSettingsHtml()}</div></div>
    <div class="card"><h3>Profile</h3><div class="field"><label>Name</label><input type="text" id="sName" value="${esc(state.user.name || '')}"></div><div class="field"><label>Username</label><input type="text" value="${esc(state.user.username)}" disabled></div><button class="btn primary" id="saveP">Save</button>
      <h3 style="margin-top:18px">AI</h3><p class="small muted">Backend: <b>${esc({ anthropic: 'Anthropic API (Claude)', openai: 'Tanzu GenAI (platform models)', cli: 'local Claude Code CLI', none: 'not configured' }[state.ai?.mode] || state.ai?.mode || '')}</b> · Model: <b>${esc(state.ai?.model || '')}</b></p>
      <h3 style="margin-top:18px">Account</h3><button class="btn" id="logout">${icon('logout')} Log out</button></div></div>`;
  $('#saveP').onclick = async () => { const r = await api.patch('/me', { name: $('#sName').value }); state.user = r.user; toast('Saved', 'ok'); };
  $('#logout').onclick = async () => { await api('/auth/logout', { body: {} }); state.user = null; invalidate(); localStorage.removeItem('dwb_last_user'); go('#/login'); };
  const on = $('#pushOn'); if (on) on.onclick = async () => { busy(on, true, 'Turning on…'); try { await enablePush(); toast('Reminders on 🎉', 'ok'); settingsView(); } catch (e) { toast(e.message, 'err'); busy(on, false); } };
  const off = $('#pushOff'); if (off) off.onclick = async () => { await disablePush(); toast('Reminders off'); settingsView(); };
  const tp = $('#pushTest'); if (tp) tp.onclick = () => testPush();
  wireSms(() => settingsView());
  $$('.rp').forEach(c => c.onchange = async () => { const rem = { ...(state.user.settings?.reminders || {}) }; rem[c.dataset.k] = c.checked; const r = await api.patch('/me', { settings: { reminders: rem } }); state.user = r.user; });
}

// ---------- routes ----------
route('/login', () => authView('login'));
route('/register', () => authView('register'));
route('/', homeView);
route('/notebooks', notebooksView);
route('/notebook/:id', notebookView);
route('/page/:id', pageView);
route('/book/:id', bookView);
route('/scan', (p, q) => scanView({}, q));
route('/scan/:id', scanView);
route('/planner', plannerView);
route('/study', studyListView);
route('/study/:id', studyView);
route('/settings', settingsView);
route('/progress', progressView);
route('/s/:token', sharedView);

// auto-update: when a new version is deployed, reload on the next navigation (never mid-scan)
let BUILD = null;
async function checkVersion() {
  try { const r = await fetch('/api/version', { cache: 'no-store' }).then(r => r.json()); if (BUILD && r.v !== BUILD) { const busyScan = location.hash.startsWith('#/scan') && document.querySelector('.tray-item:not(.ready):not(.error)'); if (!busyScan) { toast('Updating to the newest WorkBook…'); setTimeout(() => location.reload(), 600); } } else if (!BUILD) BUILD = r.v; } catch {}
}
async function boot() {
  try { const r = await api('/me'); state.user = r.user; state.ai = r.ai; BUILD = r.v || null; } catch {}
  registerSW();
  setInterval(checkVersion, 90 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
  window.addEventListener('hashchange', () => { if (Math.random() < 0.34) checkVersion(); });
  const guard = async () => {
    const hash = location.hash || '#/';
    if (!state.user && !/^#\/(login|register|s\/)/.test(hash)) { return authView(hash === '#/register' ? 'register' : 'login'); }
    if (state.user && /^#\/(login|register)/.test(hash)) return go('#/');
    document.onkeydown = null;
    await dispatch();
  };
  window.addEventListener('hashchange', guard);
  guard();
}
boot();
