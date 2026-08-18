import { state, api, $, $$, esc, h, render, md, mdi, icon, toast, modal, confirm, busy, todayISO, fmtDate, fmtTime, countdown, daysUntil, ago, TYPES, COLORS, MON, DOW, MONTHS, parseISO, loadNotebooks, loadEvents, loadStudy, invalidate, route, go, dispatch } from './core.js';
import { scanView } from './scan.js';
import { studyListView, studyView, openNewStudy } from './study.js';
import { bookView } from './book.js';

// ---------- shell ----------
const NAV = [
  ['#/', 'home', 'Home'], ['#/notebooks', 'book', 'Notebooks'], ['#/scan', 'camera', 'Scan'], ['#/planner', 'calendar', 'Planner'], ['#/study', 'study', 'Study'],
];
export function shell(active, content) {
  const u = state.user;
  const initials = (u?.name || u?.username || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  render(`<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#/" style="text-decoration:none;color:inherit"><div class="logo"></div><div class="name">WorkBook<small>Digital Notebook</small></div></a>
      <nav class="nav">${NAV.map(([href, ic, label]) => `<a href="${href}" class="${active === label ? 'active' : ''}">${icon(ic)}${label}</a>`).join('')}</nav>
      <div class="spacer"></div>
      <a class="nav-a" href="#/settings" style="text-decoration:none"><div class="userbox"><div class="avatar">${esc(initials)}</div><div class="who"><b>${esc(u?.name || u?.username)}</b><span title="${esc(state.ai?.model || '')}">${state.ai?.available === false ? '⚠️ AI not set up' : state.ai?.mode === 'cli' ? 'AI: Claude (local)' : state.ai?.mode === 'anthropic' ? 'AI: Claude' : 'AI: ' + esc((state.ai?.model || '').split(' + ')[0])}</span></div>${icon('settings', 'muted')}</div></a>
    </aside>
    <main class="main">${state.ai?.available === false ? `<div class="ai-status" style="margin-bottom:14px;background:var(--amber-soft);color:#7a4d00">⚠️ AI features are switched off on this server (no API key). Scanning, notebooks and the planner work; AI reading, study sheets, tests and flashcards will be enabled once a key is added.</div>` : ''}${content}</main>
    <nav class="tabbar">${NAV.map(([href, ic, label]) => label === 'Scan' ? `<a href="${href}" class="scan-tab ${active === label ? 'active' : ''}"><div class="ring">${icon(ic)}</div>Scan</a>` : `<a href="${href}" class="${active === label ? 'active' : ''}">${icon(ic)}${label}</a>`).join('')}</nav>
  </div>`);
  return $('.main');
}
export const nbCover = (nb, extra = '') => `<div class="nb-cover color-${esc(nb.color || 'navy')} ${extra}"><div class="rings"></div><div class="label"><b>${esc(nb.name)}</b><span>${esc(nb.subject || 'Notebook')}</span></div><div class="foot"><div class="progress"><i style="width:${Math.min(100, Math.round(100 * (nb.scanned || 0) / (nb.pageCount || 1)))}%"></i></div><span>${nb.scanned || 0}/${nb.pageCount}</span></div></div>`;

// ---------- auth ----------
function authView(mode = 'login') {
  const login = mode === 'login';
  render(`<div class="auth">
    <aside class="auth-side">
      <div class="auth-side-inner">
        <a class="brand" href="#/" style="text-decoration:none;color:inherit;padding:0"><div class="logo"></div><div class="name">WorkBook<small>Digital Notebook</small></div></a>
        <h2 class="auth-tag">Your notebooks, digitized.<br>Your tests, handled.</h2>
        <ul class="auth-feats">
          <li>${icon('camera')}<div><b>Scan any notebook page</b><span>AI finds the edges, straightens it and keeps your pen colors</span></div></li>
          <li>${icon('sparkle')}<div><b>Instant digital copy</b><span>Handwriting → clean notes, key points and vocab</span></div></li>
          <li>${icon('calendar')}<div><b>Planner that studies with you</b><span>Add a test — get a study sheet, practice test and flashcards</span></div></li>
        </ul>
        <div class="auth-mock">
          <div class="mock-page paper holes"><div class="hand" style="font-size:20px;line-height:28px;color:#1a2a6b">Ch. 5 – The Cell<br>• Nucleus → holds DNA<br>• <span style="color:#c0392b">Mitochondria</span> → makes ATP<br>• Chloroplast → <span style="color:#1e8f4e">plants only</span></div></div>
          <div class="mock-card mock-test">${icon('zap')}<div><b>Ch. 5 Cell Test</b><span>Friday · in 3 days</span></div><span class="chip red">Study</span></div>
          <div class="mock-card mock-fc"><span class="lab">Flashcard</span><b>What does the mitochondria do?</b><span class="muted small">tap to flip</span></div>
          <div class="mock-card mock-score"><div class="score-ring" style="--p:92;width:54px;height:54px"><div style="width:40px;height:40px;font-size:13px">92%</div></div><div><b>Practice test</b><span>6 / 6 graded by AI</span></div></div>
        </div>
      </div>
      <div class="auth-foot">Made for students · Works on phone & laptop</div>
    </aside>
    <main class="auth-main">
      <div class="auth-card">
        <div class="brand auth-brand-sm" style="padding:0 0 10px"><div class="logo"></div><div class="name">WorkBook<small>Digital Notebook</small></div></div>
        <h1>${login ? 'Welcome back' : 'Create your account'}</h1>
        <p class="muted" style="margin:6px 0 22px">${login ? 'Log in to open your notebooks and planner.' : 'Free to use — set up in 10 seconds.'}</p>
        <form id="authForm" novalidate>
          ${login ? '' : `<div class="field"><label for="f-name">Your name</label><input id="f-name" type="text" name="name" placeholder="What should we call you?" autocomplete="name" required></div>`}
          <div class="field"><label for="f-user">Username</label><input id="f-user" type="text" name="username" placeholder="e.g. colton" autocomplete="username" autocapitalize="off" spellcheck="false" required></div>
          <div class="field"><div style="display:flex;justify-content:space-between;align-items:center"><label for="f-pass">Password</label>${login ? '<a href="#" class="small" id="forgot" style="text-decoration:none">Forgot password?</a>' : '<span class="help">At least 4 characters</span>'}</div>
            <div class="pw-wrap"><input id="f-pass" type="password" name="password" placeholder="${login ? 'Your password' : 'Choose a password'}" autocomplete="${login ? 'current-password' : 'new-password'}" required><button type="button" class="pw-eye" id="pwEye" title="Show password">${icon('eye')}</button></div></div>
          ${login ? '<label class="remember"><input type="checkbox" checked disabled> Keep me logged in on this device</label>' : ''}
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
  const forgot = $('#forgot'); if (forgot) forgot.onclick = (e) => { e.preventDefault(); toast('Password reset comes with cloud accounts — for now, make a new account or ask Colton 🙂'); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form); const btn = $('button[type=submit]', form); const err = $('#authErr');
    const d = Object.fromEntries(f);
    if (!d.username?.trim()) return err.textContent = 'Enter your username.';
    if (!d.password) return err.textContent = 'Enter your password.';
    if (!login && d.password.length < 4) return err.textContent = 'Password must be at least 4 characters.';
    err.textContent = '';
    busy(btn, true, login ? 'Logging in…' : 'Creating your account…');
    try {
      const r = await api('/auth/' + mode, { body: d });
      state.user = r.user; invalidate(); go('#/');
    } catch (ex) { err.textContent = ex.message; busy(btn, false); form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); }
  };
}

// ---------- home ----------
async function homeView() {
  const main = shell('Home', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const [nbs, evs, sets] = await Promise.all([loadNotebooks(true), loadEvents(true), loadStudy(true)]);
  const today = todayISO();
  const upcoming = evs.filter(e => !e.done && e.date >= today).slice(0, 6);
  const tests = upcoming.filter(e => e.type === 'test' || e.type === 'quiz');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const inProgress = nbs.filter(n => n.scanned < n.pageCount).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const totalPages = nbs.reduce((s, n) => s + n.scanned, 0);
  main.innerHTML = `
    <div class="page-head"><div><h1>${greet}, ${esc((state.user.name || state.user.username).split(' ')[0])} 👋</h1><div class="sub">${fmtDate(today, { year: true })} · ${nbs.length} notebook${nbs.length === 1 ? '' : 's'} · ${totalPages} page${totalPages === 1 ? '' : 's'} scanned</div></div></div>
    <div class="quick" style="margin-bottom:20px">
      <a href="#/scan">${icon('camera')}Scan pages</a>
      <a href="#/notebooks?new=1">${icon('book')}New notebook</a>
      <a href="#/planner?new=1">${icon('calendar')}Add a test / due date</a>
      <a href="#/study?new=1">${icon('study')}Start studying</a>
    </div>
    <div class="hero">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3>${icon('bell', 'muted')} Coming up</h3><a class="btn sm ghost" href="#/planner">Planner ${icon('chevR')}</a></div>
        ${upcoming.length ? upcoming.map(eventRow).join('') : `<div class="empty" style="padding:24px"><h3>Nothing scheduled</h3><p class="small">Add tests, quizzes and homework to your planner and WorkBook will remind you and help you study.</p><a class="btn primary sm" href="#/planner?new=1">${icon('plus')} Add to planner</a></div>`}
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${tests.length ? `<div class="card" style="background:linear-gradient(135deg,#fff5f2,#fff);border-color:#f7d5cd"><h3>${icon('zap')} Next test</h3><div style="font-family:var(--serif);font-size:22px;margin:4px 0">${esc(tests[0].title)}</div><div class="muted small">${esc(tests[0].subject || '')} · ${fmtDate(tests[0].date)} · <b class="countdown ${daysUntil(tests[0].date) <= 3 ? 'urgent' : ''}">${countdown(tests[0].date)}</b></div><div class="btn-row" style="margin-top:12px"><a class="btn primary sm" href="${tests[0].studyId ? '#/study/' + tests[0].studyId : '#/study?new=1&event=' + tests[0].id}">${icon('study')} ${tests[0].studyId ? 'Keep studying' : 'Study for it'}</a></div></div>` : ''}
        ${inProgress ? `<div class="card"><h3>${icon('camera')} Continue scanning</h3><div style="display:flex;gap:12px;align-items:center;margin-top:8px"><div style="width:56px">${nbCover(inProgress, 'sm')}</div><div style="flex:1;min-width:0"><b>${esc(inProgress.name)}</b><div class="muted small">${inProgress.scanned} of ${inProgress.pageCount} pages</div><div class="progress" style="margin-top:6px"><i style="width:${Math.round(100 * inProgress.scanned / inProgress.pageCount)}%"></i></div></div></div><a class="btn sm" style="margin-top:12px" href="#/scan/${inProgress.id}">${icon('camera')} Scan page ${inProgress.scanned + 1}</a></div>` : ''}
        ${sets.length ? `<div class="card"><h3>${icon('study')} Recent study sets</h3>${sets.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3).map(s => `<a href="#/study/${s.id}" style="display:block;padding:8px 0;border-bottom:1px solid var(--line-2);text-decoration:none;color:inherit"><b>${esc(s.title)}</b><div class="muted small">${esc(s.subject || '')} · ${s.cards?.length || 0} cards · ${s.tests?.length || 0} tests</div></a>`).join('')}</div>` : ''}
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 12px"><h2>Your notebooks</h2><a class="btn sm ghost" href="#/notebooks">All notebooks ${icon('chevR')}</a></div>
    <div class="grid auto" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
      ${nbs.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map(nb => `<a href="#/notebook/${nb.id}" style="text-decoration:none">${nbCover(nb)}</a>`).join('')}
      <a href="#/notebooks?new=1" style="text-decoration:none"><div class="nb-cover new"><div style="text-align:center">${icon('plus')}<div style="font-weight:600;font-size:13px">New notebook</div></div></div></a>
    </div>`;
  wireEventRows(main);
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
  main.innerHTML = `<div class="page-head"><div><h1>Notebooks</h1><div class="sub">Every notebook you've digitized. Tap one to open it.</div></div><div class="btn-row"><div class="search-box">${icon('search')}<input class="input" id="q" placeholder="Search all pages…" style="width:240px"></div><button class="btn primary" id="newNb">${icon('plus')} New notebook</button></div></div>
    <div id="hits"></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))" id="nbGrid">
      ${nbs.map(nb => `<a href="#/notebook/${nb.id}" style="text-decoration:none">${nbCover(nb)}</a>`).join('')}
      <div class="nb-cover new" id="newNb2"><div style="text-align:center">${icon('plus')}<div style="font-weight:600;font-size:13px">New notebook</div></div></div>
    </div>
    ${!nbs.length ? `<div class="empty" style="margin-top:20px"><div class="big">📓</div><h3>No notebooks yet</h3><p>Create a notebook, tell it how many pages you'll scan, then start scanning with your camera.</p></div>` : ''}`;
  $('#newNb').onclick = $('#newNb2').onclick = () => notebookModal();
  let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => searchPages(e.target.value), 250); };
  if (q.new) notebookModal();
}
async function searchPages(qs) {
  const box = $('#hits'); if (!qs.trim()) { box.innerHTML = ''; return; }
  const hits = await api('/search?q=' + encodeURIComponent(qs));
  const re = new RegExp('(' + qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  box.innerHTML = hits.length ? `<div class="card" style="margin-bottom:16px"><h3>${hits.length} page${hits.length === 1 ? '' : 's'} match “${esc(qs)}”</h3>${hits.map(hh => `<div class="hit" onclick="location.hash='#/page/${hh.id}'"><b>${esc(hh.notebook)} · Page ${hh.index}${hh.title ? ' — ' + esc(hh.title) : ''}</b><span>${esc(hh.snippet).replace(re, '<mark>$1</mark>')}</span></div>`).join('')}</div>` : `<div class="muted small" style="margin-bottom:12px">No pages match “${esc(qs)}”.</div>`;
}
export function notebookModal(nb) {
  const isNew = !nb; nb = nb || { name: '', subject: '', color: COLORS[Math.floor(Math.random() * 8)], pageCount: 20 };
  const m = modal(`<h2>${isNew ? 'New notebook' : 'Edit notebook'}</h2>
    <div style="display:flex;gap:18px;align-items:flex-start"><div style="width:110px;flex-shrink:0" id="prev">${nbCover(nb)}</div><div style="flex:1">
    <div class="field"><label>Notebook name</label><input type="text" id="nbName" value="${esc(nb.name)}" placeholder="e.g. Biology – Unit 3"></div>
    <div class="field"><label>Subject / class</label><input type="text" id="nbSubject" value="${esc(nb.subject)}" placeholder="e.g. Biology"></div>
    <div class="field"><label>How many pages will you scan?</label><input type="number" id="nbPages" min="1" max="500" value="${nb.pageCount}"><div class="help">You can always add more later. This sets your scanning progress bar.</div></div>
    <div class="field"><label>Cover color</label><div class="swatches">${COLORS.map(c => `<div class="swatch color-${c} ${c === nb.color ? 'active' : ''}" data-c="${c}"></div>`).join('')}</div></div>
    </div></div>
    <div class="actions">${!isNew ? `<button class="btn danger" id="del" style="margin-right:auto">${icon('trash')} Delete</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="save">${isNew ? 'Create & start scanning' : 'Save'}</button></div>`);
  const el = m.el; let color = nb.color;
  const refresh = () => { $('#prev', el).innerHTML = nbCover({ ...nb, name: $('#nbName', el).value || 'Notebook', subject: $('#nbSubject', el).value, color, pageCount: +$('#nbPages', el).value || 1 }); };
  $$('.swatch', el).forEach(s => s.onclick = () => { $$('.swatch', el).forEach(x => x.classList.remove('active')); s.classList.add('active'); color = s.dataset.c; refresh(); });
  ['nbName', 'nbSubject', 'nbPages'].forEach(id => $('#' + id, el).oninput = refresh);
  $('#save', el).onclick = async () => {
    const body = { name: $('#nbName', el).value.trim(), subject: $('#nbSubject', el).value.trim(), color, pageCount: +$('#nbPages', el).value || 20 };
    if (!body.name) return toast('Give your notebook a name', 'err');
    busy($('#save', el), true, 'Saving…');
    try {
      if (isNew) { const created = await api('/notebooks', { body }); invalidate(); m.close(); go('#/scan/' + created.id); }
      else { await api.patch('/notebooks/' + nb.id, body); invalidate(); m.close(); dispatch(); }
    } catch (e) { toast(e.message, 'err'); busy($('#save', el), false); }
  };
  if (!isNew) $('#del', el).onclick = async () => { if (await confirm('Delete notebook?', `“${nb.name}” and all its scanned pages will be deleted.`)) { await api.del('/notebooks/' + nb.id); invalidate(); m.close(); go('#/notebooks'); } };
}

// ---------- notebook view ----------
async function notebookView({ id }) {
  const main = shell('Notebooks', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const nb = await api('/notebooks/' + id);
  const pct = Math.min(100, Math.round(100 * nb.scanned / nb.pageCount));
  const slots = Math.max(0, nb.pageCount - nb.pages.length);
  main.innerHTML = `<div class="crumbs"><a href="#/notebooks">Notebooks</a> › <span>${esc(nb.name)}</span></div>
    <div class="nb-head"><div>${nbCover(nb)}</div><div style="flex:1;min-width:0">
      <div class="page-head" style="margin-bottom:8px"><div><h1>${esc(nb.name)}</h1><div class="sub">${esc(nb.subject || 'Notebook')} · ${nb.scanned} of ${nb.pageCount} pages scanned</div></div>
      <div class="btn-row"><button class="btn" id="edit">${icon('edit')} Edit</button>${nb.pages.length ? `<a class="btn dark" href="#/book/${nb.id}">${icon('book')} Read as notebook</a><button class="btn" id="printNb" title="Print or save the whole notebook as PDF">${icon('print')} PDF</button>` : ''}<a class="btn" href="#/study?new=1&notebook=${nb.id}">${icon('study')} Study this</a><a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} ${nb.scanned >= nb.pageCount ? 'Scan more pages' : 'Scan page ' + (nb.scanned + 1)}</a></div></div>
      <div class="progress ${pct >= 100 ? 'green' : ''}" style="max-width:420px"><i style="width:${pct}%"></i></div>
      <div class="small muted" style="margin-top:4px">${pct >= 100 ? '✅ All pages scanned' : `${nb.pageCount - nb.scanned} page${nb.pageCount - nb.scanned === 1 ? '' : 's'} to go`}</div>
    </div></div>
    ${nb.pages.length ? '' : `<div class="empty"><div class="big">📷</div><h3>No pages yet</h3><p>Point your camera at the first page and WorkBook will crop it, clean it up, and read it with AI.</p><a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Start scanning</a></div>`}
    <div class="pages-grid">
      ${nb.pages.map(p => `<div class="page-thumb" onclick="location.hash='#/page/${p.id}'"><div class="img" style="background-image:url('/api/pages/${p.id}/image?kind=thumb&r=${p.rev || 0}')"></div><span class="num">p.${p.index}</span>${p.status === 'ready' ? '' : p.status === 'analyzing' ? '<span class="st chip amber">AI reading…</span>' : p.status === 'error' ? '<span class="st chip red">AI failed</span>' : '<span class="st chip">Not read</span>'}<div class="cap"><b>${esc(p.title || 'Page ' + p.index)}</b><span>${p.keyPoints?.length ? p.keyPoints.length + ' key points' : ''}</span></div></div>`).join('')}
      ${Array.from({ length: Math.min(slots, 12) }, (_, i) => `<div class="page-thumb slot" onclick="location.hash='#/scan/${nb.id}'"><div><b>${nb.pages.length + i + 1}</b>not scanned yet<br><span style="color:var(--accent);font-weight:600">Scan →</span></div></div>`).join('')}
    </div>`;
  $('#edit').onclick = () => notebookModal(nb);
  const pb = $('#printNb'); if (pb) pb.onclick = () => printNotebook(nb);
}
// Print / save-as-PDF: every page with its scan and digital copy.
function printNotebook(nb) {
  const w = window.open('', '_blank'); if (!w) return toast('Pop-up blocked — allow pop-ups to export', 'err');
  const pages = nb.pages.map(p => `<section class="pp"><div class="scan"><img src="/api/pages/${p.id}/image?kind=enh&r=${p.rev || 0}"></div><div class="txt"><h2>${esc(p.title || 'Page ' + p.index)} <small>p.${p.index}</small></h2><div class="md">${p.transcript ? md(p.transcript) : '<i>No digital copy</i>'}</div>${p.keyPoints?.length ? `<h3>Key points</h3><ul>${p.keyPoints.map(k => `<li>${mdi(k)}</li>`).join('')}</ul>` : ''}</div></section>`).join('');
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
  main.innerHTML = `<div class="crumbs"><a href="#/notebooks">Notebooks</a> › <a href="#/notebook/${nb.id}">${esc(nb.name)}</a> › <span>Page ${page.index}</span></div>
    <div class="page-head" style="margin-bottom:14px"><div><h1 id="ptitle" contenteditable="true" spellcheck="false" title="Click to rename" style="outline:none;border-bottom:1px dashed transparent">${esc(page.title || 'Page ' + page.index)}</h1><div class="sub">${esc(nb.name)} · page ${page.index} of ${nb.pageCount}${page.readability ? ' · handwriting: ' + esc(page.readability) : ''}</div></div>
      <div class="btn-row"><button class="btn" id="rerun">${icon('sparkle')} Re-read with AI</button><a class="btn" href="/api/pages/${page.id}/image?kind=enh" download="${esc(nb.name)}-p${page.index}.jpg">${icon('download')} Download</a><button class="btn danger" id="delp">${icon('trash')}</button></div></div>
    <div class="viewer">
      <div><div class="btn-row" style="justify-content:space-between;margin-bottom:8px"><div class="seg imgtools"><button class="active" data-k="enh">Enhanced</button><button data-k="orig">Original</button></div><span class="muted small">Page ${page.index}</span></div><div class="imgbox"><img id="pimg" src="/api/pages/${page.id}/image?kind=enh&r=${page.rev || 0}" alt="page"></div>
        <div class="pager">${prev ? `<a class="btn" href="#/page/${prev.id}">${icon('chevL')} Page ${prev.index}</a>` : '<span></span>'}<a class="btn ghost" href="#/book/${nb.id}?p=${page.index}">${icon('book')} Book view</a>${next ? `<a class="btn" href="#/page/${next.id}">Page ${next.index} ${icon('chevR')}</a>` : `<a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Scan next</a>`}</div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3><span class="ai-tag">${icon('sparkle')} AI</span> Digital copy</h3><div class="seg"><button class="active" id="mRead">Read</button><button id="mEdit">Edit</button></div></div>
        <div id="tstatus"></div>
        <div class="paper holes" id="tpaper"><div class="md" id="tread">${page.transcript ? md(page.transcript) : '<span class="muted">No transcript yet — press “Re-read with AI”.</span>'}</div><textarea class="transcript hidden" id="tedit">${esc(page.transcript)}</textarea></div>
        <div id="tsave" class="hidden" style="margin-top:8px;text-align:right"><button class="btn primary sm" id="saveT">Save transcript</button></div>
        ${page.keyPoints?.length ? `<div class="card" style="margin-top:16px"><h3>Key points</h3><ul class="kp">${page.keyPoints.map(k => `<li>${mdi(k)}</li>`).join('')}</ul></div>` : ''}
        ${page.vocab?.length ? `<div class="card" style="margin-top:16px"><h3>Vocabulary</h3><div class="vocab">${page.vocab.map(v => `<div><b>${mdi(v.term)}</b> — ${mdi(v.definition)}</div>`).join('')}</div></div>` : ''}
        ${page.topics?.length ? `<div class="chips" style="margin-top:12px">${page.topics.map(t => `<span class="chip blue">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  $$('.imgtools button').forEach(b => b.onclick = () => { $$('.imgtools button').forEach(x => x.classList.remove('active')); b.classList.add('active'); kind = b.dataset.k; $('#pimg').src = `/api/pages/${page.id}/image?kind=${kind}&r=${page.rev || 0}`; });
  $('#mRead').onclick = () => { $('#mRead').classList.add('active'); $('#mEdit').classList.remove('active'); $('#tread').classList.remove('hidden'); $('#tedit').classList.add('hidden'); $('#tsave').classList.add('hidden'); };
  $('#mEdit').onclick = () => { $('#mEdit').classList.add('active'); $('#mRead').classList.remove('active'); $('#tread').classList.add('hidden'); $('#tedit').classList.remove('hidden'); $('#tsave').classList.remove('hidden'); $('#tedit').focus(); };
  $('#saveT').onclick = async () => { const t = $('#tedit').value; await api.patch('/pages/' + page.id, { transcript: t }); page.transcript = t; $('#tread').innerHTML = md(t); $('#mRead').click(); toast('Saved', 'ok'); };
  $('#ptitle').onblur = async () => { const t = $('#ptitle').textContent.trim(); if (t && t !== page.title) { await api.patch('/pages/' + page.id, { title: t }); page.title = t; } };
  $('#ptitle').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
  $('#rerun').onclick = async () => { busy($('#rerun'), true, 'AI reading page…'); $('#tstatus').innerHTML = `<div class="ai-status"><span class="spinner"></span> Claude is reading your handwriting…</div>`; try { await api('/pages/' + page.id + '/analyze', { body: {} }); dispatch(); } catch (e) { toast(e.message, 'err'); busy($('#rerun'), false); $('#tstatus').innerHTML = ''; } };
  $('#delp').onclick = async () => { if (await confirm('Delete this page?', 'The scan and its transcript will be removed.')) { await api.del('/pages/' + page.id); invalidate(); go('#/notebook/' + nb.id); } };
  document.onkeydown = (e) => { if (e.target.closest('input,textarea,[contenteditable]')) return; if (e.key === 'ArrowLeft' && prev) go('#/page/' + prev.id); if (e.key === 'ArrowRight' && next) go('#/page/' + next.id); };
}

// ---------- planner ----------
let calMonth = null;
async function plannerView(_, q) {
  const main = shell('Planner', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const evs = await loadEvents(true);
  const today = todayISO();
  if (!calMonth) { const d = new Date(); calMonth = { y: d.getFullYear(), m: d.getMonth() }; }
  let selected = q.date || null;
  const draw = () => {
    const { y, m } = calMonth;
    const first = new Date(y, m, 1); const start = new Date(y, m, 1 - first.getDay());
    const cells = [];
    for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; cells.push({ d, iso, other: d.getMonth() !== m }); }
    const byDate = {}; for (const e of evs) (byDate[e.date] ||= []).push(e);
    const upcoming = evs.filter(e => !e.done && e.date >= today);
    const past = evs.filter(e => e.done || e.date < today).sort((a, b) => b.date.localeCompare(a.date));
    const listDate = selected ? (byDate[selected] || []) : null;
    main.innerHTML = `<div class="page-head"><div><h1>Planner</h1><div class="sub">Tests, quizzes, homework and due dates. Tap a day to add something.</div></div><button class="btn primary" id="newEv">${icon('plus')} Add</button></div>
      <div class="planner"><div class="card">
        <div class="cal-head"><button class="btn icon ghost" id="pm">${icon('chevL')}</button><h2>${MONTHS[m]} ${y}</h2><div class="btn-row"><button class="btn sm ghost" id="tdy">Today</button><button class="btn icon ghost" id="nm">${icon('chevR')}</button></div></div>
        <div class="cal">${DOW.map(d => `<div class="dow">${d}</div>`).join('')}${cells.map(c => { const list = byDate[c.iso] || []; return `<div class="day ${c.other ? 'other' : ''} ${c.iso === today ? 'today' : ''} ${c.iso === selected ? 'selected' : ''}" data-iso="${c.iso}"><span class="n">${c.d.getDate()}</span>${list.slice(0, 3).map(e => `<span class="ev ${esc(e.type)} ${e.done ? 'done' : ''}">${esc(e.title)}</span>`).join('')}${list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : ''}<div class="dots">${list.map(e => `<i class="t-${esc(e.type)}" style="background:var(--${e.type === 'test' ? 'red' : e.type === 'quiz' ? 'amber' : e.type === 'homework' ? 'accent' : e.type === 'project' ? 'purple' : e.type === 'reminder' ? 'green' : 'ink-3'})"></i>`).join('')}</div></div>`; }).join('')}</div>
        <div class="chips" style="margin-top:12px">${Object.entries(TYPES).map(([k, v]) => `<span class="chip"><span class="type-dot t-${k}"></span>${v}</span>`).join('')}</div>
      </div>
      <div>
        ${listDate ? `<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>${fmtDate(selected, { year: true })}</h3><button class="btn sm" id="addOn">${icon('plus')} Add here</button></div>${listDate.length ? listDate.map(eventRow).join('') : '<p class="muted small" style="margin:8px 0 0">Nothing on this day.</p>'}</div>` : ''}
        <div class="card"><h3>Upcoming</h3>${upcoming.length ? upcoming.map(eventRow).join('') : '<p class="muted small">Nothing coming up. Add your next test!</p>'}</div>
        ${past.length ? `<div class="card" style="margin-top:16px"><h3 class="muted">Past & done</h3>${past.slice(0, 8).map(eventRow).join('')}</div>` : ''}
      </div></div>`;
    $('#pm').onclick = () => { calMonth.m--; if (calMonth.m < 0) { calMonth.m = 11; calMonth.y--; } draw(); };
    $('#nm').onclick = () => { calMonth.m++; if (calMonth.m > 11) { calMonth.m = 0; calMonth.y++; } draw(); };
    $('#tdy').onclick = () => { const d = new Date(); calMonth = { y: d.getFullYear(), m: d.getMonth() }; selected = today; draw(); };
    $('#newEv').onclick = () => eventModal(null, selected || today);
    if ($('#addOn')) $('#addOn').onclick = () => eventModal(null, selected);
    $$('.cal .day').forEach(d => d.onclick = () => { selected = d.dataset.iso; draw(); });
    wireEventRows(main);
  };
  draw();
  if (q.new) eventModal(null, q.date || today);
}
export async function eventModal(ev, date) {
  const isNew = !ev; ev = ev || { title: '', type: 'test', subject: '', date: date || todayISO(), time: '', notes: '', notebookId: '' };
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
      if (isNew) { const created = await api('/events', { body }); invalidate(); m.close(); toast('Added to planner', 'ok'); if ((body.type === 'test' || body.type === 'quiz') && daysUntil(body.date) >= 0) { if (await confirm('Start a study set?', `Want WorkBook to build a study sheet, practice test and flashcards for “${body.title}”?`, { danger: false, ok: 'Yes, let’s study' })) return go('#/study?new=1&event=' + created.id); } dispatch(); }
      else { await api.patch('/events/' + ev.id, body); invalidate(); m.close(); dispatch(); }
    } catch (e) { toast(e.message, 'err'); }
  };
  if (!isNew) {
    $('#del', el).onclick = async () => { await api.del('/events/' + ev.id); invalidate(); m.close(); dispatch(); };
    $('#done', el).onclick = async () => { await api.patch('/events/' + ev.id, { done: !ev.done }); invalidate(); m.close(); dispatch(); };
  }
}

// ---------- settings ----------
async function settingsView() {
  const main = shell('', '');
  main.innerHTML = `<div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="grid cols-2"><div class="card"><h3>Profile</h3><div class="field"><label>Name</label><input type="text" id="sName" value="${esc(state.user.name || '')}"></div><div class="field"><label>Username</label><input type="text" value="${esc(state.user.username)}" disabled></div><button class="btn primary" id="saveP">Save</button></div>
    <div class="card"><h3>AI</h3><p class="small muted">Scanning, transcription, study sheets, tests and flashcards are AI-powered.<br>Backend: <b>${esc({ anthropic: 'Anthropic API (Claude)', openai: 'Tanzu GenAI (platform models)', cli: 'local Claude Code CLI', none: 'not configured' }[state.ai?.mode] || state.ai?.mode || '')}</b> · Model: <b>${esc(state.ai?.model || '')}</b>${state.ai?.webSearch === false ? '<br>Live web search: not available on this backend (“More online” uses trusted search links).' : ''}</p><h3 style="margin-top:16px">Account</h3><button class="btn" id="logout">${icon('logout')} Log out</button></div></div>`;
  $('#saveP').onclick = async () => { const r = await api.patch('/me', { name: $('#sName').value }); state.user = r.user; toast('Saved', 'ok'); };
  $('#logout').onclick = async () => { await api('/auth/logout', { body: {} }); state.user = null; invalidate(); go('#/login'); };
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

async function boot() {
  try { const r = await api('/me'); state.user = r.user; state.ai = r.ai; } catch {}
  const guard = async () => {
    const hash = location.hash || '#/';
    if (!state.user && !/^#\/(login|register)/.test(hash)) { return authView(hash === '#/register' ? 'register' : 'login'); }
    if (state.user && /^#\/(login|register)/.test(hash)) return go('#/');
    document.onkeydown = null;
    await dispatch();
  };
  window.addEventListener('hashchange', guard);
  guard();
}
boot();
