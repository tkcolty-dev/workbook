import { state, api, stream, $, $$, esc, h, render, md, mdi, mdPage, hydrateFigures, plain, icon, logoSvg, toast, modal, confirm, busy, todayISO, fmtDate, fmtTime, countdown, daysUntil, ago, TYPES, COLORS, MON, DOW, MONTHS, parseISO, loadNotebooks, loadEvents, loadStudy, invalidate, route, go, dispatch, setKeys, getTheme, setTheme, isDark, download, plural, fmtMin, loading, navId, stale, applySettings, saveSettings, settings, ACCENTS } from './core.js';
import { registerSW, pushStatus, enablePush, disablePush, testPush, isIOS, isStandalone, pushSupported } from './push.js';

// Heavy screens load on demand (scanner + image engine, study room, slideshow, review, grades…)
const lazy = (mod, fn) => async (...a) => (await import(mod))[fn](...a);

// ---------- shell (rendered once; navigation only swaps the page body) ----------
const NAV_GROUPS = [
  { g: 'Capture', items: [['#/', 'home', 'Home', 'navy'], ['#/scan', 'camera', 'Scan', 'green'], ['#/notebooks', 'book', 'Notebooks', 'purple'], ['#/inbox', 'inbox', 'Inbox', 'orange'], ['#/topics', 'layers', 'Topics', 'teal']] },
  { g: 'Study', items: [['#/study', 'study', 'Study', 'pink'], ['#/review', 'review', 'Review', 'yellow'], ['#/homework', 'check', 'Homework', 'red'], ['#/friends', 'users', 'Friends', 'purple']] },
  { g: 'Plan', items: [['#/planner', 'calendar', 'Planner', 'orange'], ['#/week', 'week', 'Week', 'navy'], ['#/grades', 'grades', 'Grades', 'teal'], ['#/progress', 'zap', 'Progress', 'black']] },
];
const NAV = NAV_GROUPS.flatMap(g => g.items);
const BADGES = { Review: 'reviewBadge', Inbox: 'inboxBadge' };
const TAB_COLORS = { navy: '#1f4fd8', purple: '#8253e0', green: '#22a06b', orange: '#f27d3a', pink: '#e85d9a', yellow: '#e0b000', teal: '#1aa5a5', red: '#e2574a', black: '#5b6272' };
const aiLabel = () => state.ai?.available === false ? '⚠️ AI not set up' : state.ai?.mode === 'cli' ? 'AI: Claude (local)' : state.ai?.mode === 'anthropic' ? 'AI: Claude' : 'AI: ' + (state.ai?.model || '').split(' + ')[0];
export function shell(active, content) {
  const u = state.user;
  let root = $('.shell');
  if (!root || root.dataset.uid !== u?.id) {
    const initials = (u?.name || u?.username || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    render(`<div class="shell" data-uid="${esc(u?.id || '')}">
      <aside class="sidebar" aria-label="Main navigation">
        <a class="brand" href="#/" style="text-decoration:none;color:inherit">${logoSvg(36)}<div class="name">WorkBook<small>your notebook, digital</small></div></a>
        <nav class="nav">${NAV_GROUPS.map(g => `<div class="nav-group"><div class="nav-g">${g.g}</div>${g.items.map(([href, ic, label, col]) => `<a href="${href}" data-nav="${label}" style="--tab:${TAB_COLORS[col]}">${icon(ic)}${label}${BADGES[label] ? `<span class="badge hidden" id="${BADGES[label]}"></span>` : ''}</a>`).join('')}</div>`).join('')}</nav>
        <button class="nav-btn" id="searchBtn" type="button">${icon('search')} Search <kbd class="kbd-hint">⌘K</kbd></button>
        <button class="nav-btn" id="focusBtn" type="button" title="Focus timer (25/5)">${icon('clock')} Focus timer</button>
        <div class="spacer"></div>
        <div class="side-foot"><button class="btn sm ghost" id="themeBtn" type="button" title="Theme">${icon(isDark() ? 'sun' : 'moon')} ${themeLabel()}</button><a class="btn sm ghost" href="#/settings" aria-label="Settings">${icon('settings')}</a></div>
        <a class="nav-a" href="#/settings" style="text-decoration:none;color:inherit"><div class="userbox"><div class="avatar" aria-hidden="true">${esc(initials)}</div><div class="who"><b>${esc(u?.name || u?.username)}</b><span title="${esc(state.ai?.model || '')}">${esc(aiLabel())}</span></div></div></a>
      </aside>
      <main class="main">
        <div class="topbar"><a class="brand" href="#/" style="text-decoration:none;color:inherit">${logoSvg(30)}<div class="name">WorkBook</div></a><div class="btn-row"><button class="btn icon sm ghost" id="searchBtnM" type="button" aria-label="Search">${icon('search')}</button><a class="btn icon sm ghost" href="#/homework" aria-label="Homework">${icon('check')}</a><a class="btn icon sm ghost" href="#/review" aria-label="Review flashcards">${icon('review')}</a><a class="btn icon sm ghost" href="#/grades" aria-label="Grades">${icon('grades')}</a><a class="btn icon sm ghost" href="#/settings" aria-label="Settings">${icon('settings')}</a></div></div>
        ${state.ai?.available === false ? `<div class="ai-status warn" style="margin-bottom:14px">⚠️ AI features are switched off on this server (no API key). Scanning, notebooks, planner and grades work; AI reading, study sheets, tests and flashcards will be enabled once a key is added.</div>` : ''}
        <div id="view"></div>
      </main>
      <nav class="tabbar" aria-label="Sections">${[['#/', 'home', 'Home'], ['#/notebooks', 'book', 'Notebooks'], ['#/scan', 'camera', 'Scan'], ['#/study', 'study', 'Study']].map(([href, ic, label]) => label === 'Scan' ? `<a href="${href}" class="scan-tab" data-nav="${label}"><div class="ring">${icon(ic)}</div>Scan</a>` : `<a href="${href}" data-nav="${label}">${icon(ic)}${label}</a>`).join('')}<a href="#more" id="moreTab" data-nav="More">${icon('grid')}More<span class="badge hidden" id="moreBadge"></span></a></nav>
    </div>`);
    root = $('.shell');
    $('#moreTab').onclick = (e) => { e.preventDefault(); moreSheet(); };
    const openSearch = () => import('./palette.js').then(m => m.openPalette());
    $('#searchBtn').onclick = openSearch; $('#searchBtnM').onclick = openSearch;
    $('#focusBtn').onclick = () => import('./extras.js').then(m => m.toggleFocusTimer());
    $('#themeBtn').onclick = () => { const next = { auto: 'light', light: 'dark', dark: 'auto' }[getTheme()]; setTheme(next); $('#themeBtn').innerHTML = `${icon(isDark() ? 'sun' : 'moon')} ${themeLabel()}`; };
    try { const ft = JSON.parse(localStorage.getItem('dwb_focus') || 'null'); if (ft?.running) import('./extras.js').then(m => m.mountFocusTimer()); } catch {}
  }
  $$('[data-nav]', root).forEach(a => a.classList.toggle('active', a.dataset.nav === active || (a.dataset.nav === 'More' && !['Home', 'Notebooks', 'Scan', 'Study'].includes(active))));
  const view = $('#view', root); view.innerHTML = content; window.scrollTo(0, 0);
  updateReviewBadge();
  return view;
}
shell.reset = () => { const s = $('.shell'); if (s) s.dataset.uid = 'stale'; };
const themeLabel = () => ({ auto: 'Auto theme', light: 'Light', dark: 'Dark', schedule: 'Dark at night' })[getTheme()] || 'Auto theme';
const setBadge = (id, v) => { const b = $('#' + id); if (!b) return; b.textContent = v > 99 ? '99+' : v; b.classList.toggle('hidden', !v); };
export function updateReviewBadge(n) { if (typeof n === 'number') state.reviewDue = n; setBadge('reviewBadge', state.reviewDue || 0); setBadge('inboxBadge', state.inboxN || 0); setBadge('moreBadge', (state.reviewDue || 0) + (state.inboxN || 0)); }
// phone: the "More" tab opens every section as a grid
function moreSheet() {
  const m = modal(`<h2>Everything</h2><div class="more-grid">${NAV_GROUPS.flatMap(g => g.items).map(([href, ic, label, col]) => `<a href="${href}" class="more-item" style="--tab:${TAB_COLORS[col]}">${icon(ic)}<span>${label}</span>${label === 'Review' && state.reviewDue ? `<b class="badge">${state.reviewDue}</b>` : label === 'Inbox' && state.inboxN ? `<b class="badge">${state.inboxN}</b>` : ''}</a>`).join('')}<a href="#/settings" class="more-item" style="--tab:#5b6272">${icon('settings')}<span>Settings</span></a><button type="button" class="more-item" id="moreSearch" style="--tab:#5b6272">${icon('search')}<span>Search</span></button></div>`);
  $('#moreSearch', m.el).onclick = () => { m.close(); import('./palette.js').then(x => x.openPalette()); };
  $$('a', m.el).forEach(a => a.addEventListener('click', () => m.close()));
}
export const nbCover = (nb, extra = '') => `<div class="nb-cover color-${esc(nb.color || 'navy')} ${extra}"><div class="rings"></div><div class="label"><b>${esc(nb.name)}</b><span>${esc(nb.subject || 'Notebook')}</span></div><div class="foot">${nb.pageCount ? `<div class="progress"><i style="width:${Math.min(100, Math.round(100 * (nb.scanned || 0) / nb.pageCount))}%"></i></div><span>${nb.scanned || 0}/${nb.pageCount}</span>` : `<span></span><span>${plural(nb.scanned || 0, 'page')}</span>`}</div></div>`;

// ---------- auth ----------
function authView(mode = 'login') {
  const login = mode === 'login';
  let last = null; try { last = JSON.parse(localStorage.getItem('dwb_last_user') || 'null'); } catch {}
  const initials = (n) => (n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  render(`<div class="auth">
    <aside class="auth-side">
      <div class="auth-side-inner">
        <a class="brand" href="#/" style="text-decoration:none;color:inherit;padding:0">${logoSvg(40)}<div class="name">WorkBook<small>your notebook, digital</small></div></a>
        <h2 class="auth-tag">Snap a page.<br>Get notes, flashcards<br>and a practice test.</h2>
        <p class="auth-lead">Point your camera at a notebook page. WorkBook straightens it, keeps your pen colors, reads the handwriting into clean notes, and turns your next test into a study plan.</p>
        <ol class="auth-steps">
          <li><span>1</span><div><b>Scan</b>Camera or photo — the page edges are found for you</div></li>
          <li><span>2</span><div><b>Read</b>Handwriting becomes notes, math, key points and vocab</div></li>
          <li><span>3</span><div><b>Study</b>Sheets, practice tests, flashcards, a tutor, and daily review</div></li>
        </ol>
        <div class="auth-mock">
          <div class="mock-page paper holes"><div class="scanline"></div><div class="hand" style="font-size:20px;line-height:28px;color:#1a2a6b">Ch. 5 – The Cell<br>• Nucleus → holds DNA<br>• <span style="color:#c0392b">Mitochondria</span> → makes ATP<br>• Chloroplast → <span style="color:#1e8f4e">plants only</span><br>• Area = <span style="color:#7a4fd6">½ · b · h</span></div><div class="mock-badge">${icon('sparkle')} AI read this page</div></div>
          <div class="mock-card mock-test">${icon('zap')}<div><b>Ch. 5 Cell Test</b><span>Friday, in 3 days</span></div><span class="chip mark">Study</span></div>
          <div class="mock-card mock-fc"><span class="lab">Flashcard</span><b>What does the mitochondria do?</b><span class="muted small">tap to flip</span></div>
          <div class="mock-card mock-score"><div class="score-ring" style="--p:92;width:54px;height:54px"><div style="width:40px;height:40px;font-size:13px">92%</div></div><div><b>Practice test</b><span>6 / 6 graded by AI</span></div></div>
        </div>
      </div>
      <div class="auth-foot"><span>📷 Phone and laptop</span><span>🎨 Keeps your pen colors</span><span>∑ Math and fractions</span><span>☁️ Synced to your account</span></div>
    </aside>
    <main class="auth-main">
      <div class="auth-card">
        <div class="auth-mobile-hero"><div class="brand" style="padding:0">${logoSvg(38)}<div class="name">WorkBook<small>your notebook, digital</small></div></div><div class="chips" style="margin-top:10px"><span class="chip blue">📷 Scan</span><span class="chip purple">✨ AI notes</span><span class="chip amber">📅 Planner</span><span class="chip green">🎓 Study</span></div></div>
        ${login && last?.username ? `<div class="last-user"><div class="avatar">${esc(initials(last.name || last.username))}</div><div><b>Welcome back, ${esc((last.name || last.username).split(' ')[0])}</b><span class="muted small">Signing in as @${esc(last.username)} · <a href="#" id="notYou">not you?</a></span></div></div>` : `<h1>${login ? 'Welcome back' : 'Create your account'}</h1>`}
        <p class="muted" style="margin:6px 0 20px">${login ? 'Log in to open your notebooks, planner and study sets.' : 'Free to use, set up in 10 seconds. Your notes sync to your account.'}</p>
        <form id="authForm" novalidate>
          ${login ? '' : `<div class="field"><label for="f-name">Your name</label><input id="f-name" type="text" name="name" placeholder="What should we call you?" autocomplete="name" required></div>`}
          <div class="field ${login && last?.username ? 'hidden' : ''}" id="userField"><label for="f-user">Username</label><input id="f-user" type="text" name="username" placeholder="e.g. colton" autocomplete="username" autocapitalize="off" spellcheck="false" value="${login && last?.username ? esc(last.username) : ''}" required></div>
          <div class="field"><div style="display:flex;justify-content:space-between;align-items:center"><label for="f-pass">Password</label>${login ? '<a href="#" class="small" id="forgot" style="text-decoration:none">Forgot password?</a>' : '<span class="help">At least 4 characters</span>'}</div>
            <div class="pw-wrap"><input id="f-pass" type="password" name="password" placeholder="${login ? 'Your password' : 'Choose a password'}" autocomplete="${login ? 'current-password' : 'new-password'}" required><button type="button" class="pw-eye" id="pwEye" aria-label="Show password">${icon('eye')}</button></div>
            <div class="caps hidden" id="caps">⇪ Caps Lock is on</div>
            ${login ? '' : '<div class="pw-meter" id="pwMeter"><i></i><i></i><i></i><i></i></div>'}</div>
          <label class="remember"><input type="checkbox" name="remember" id="remember" checked> Keep me logged in on this device <span class="muted">(60 days, renews as you use it)</span></label>
          <div class="error" id="authErr" role="alert"></div>
          <button class="btn primary lg block" style="margin-top:6px" type="submit">${login ? 'Log in' : 'Create account'} ${icon('chevR')}</button>
        </form>
        <div class="auth-switch">${login ? `New to WorkBook? <a href="#/register">Create an account</a>` : `Already have an account? <a href="#/login">Log in</a>`}</div>
        <div class="auth-legal">Your notes stay in your account. Use WorkBook for good grades only 😉</div>
      </div>
    </main>
  </div>`);
  const form = $('#authForm');
  $('#pwEye').onclick = () => { const i = $('#f-pass'); i.type = i.type === 'password' ? 'text' : 'password'; };
  const forgot = $('#forgot'); if (forgot) forgot.onclick = (e) => { e.preventDefault(); toast('Password reset comes with email accounts. For now, make a new account or ask Colton 🙂'); };
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
      state.user = r.user; invalidate(); shell.reset(); applySettings();
      if (d.remember) localStorage.setItem('dwb_last_user', JSON.stringify({ username: r.user.username, name: r.user.name })); else localStorage.removeItem('dwb_last_user');
      go('#/');
    } catch (ex) { err.textContent = ex.message; busy(btn, false); form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); if (login && last?.username) { $('#userField').classList.remove('hidden'); } }
  };
}

// ---------- home ----------
async function homeView() {
  const main = shell('Home', loading());
  const seq = navId();
  const H = await api('/home?today=' + todayISO()); if (stale(seq)) return;
  state.notebooks = H.notebooks; state.events = null; // events list here is a slice; the planner loads the full list
  state.inboxN = H.inbox; updateReviewBadge(H.review.due);
  const today = todayISO();
  const upcoming = H.events;
  const tests = upcoming.filter(e => e.type === 'test' || e.type === 'quiz');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const lastNb = H.notebooks[0];
  const next = upcoming[0];
  const planLeft = H.planToday.filter(t => !t.done).length;
  main.innerHTML = `
    <div class="page-head"><div><h1>${greet}, ${esc((state.user.name || state.user.username).split(' ')[0])}</h1><div class="sub">${fmtDate(today, { year: true })}</div></div>
      <div class="btn-row"><a class="btn lg" href="${lastNb ? '#/scan/' + lastNb.id + '?hw=1' : '#/scan'}" title="Scan your finished homework and the AI checks every answer">${icon('check')} Check homework</a><a class="btn primary lg" href="${lastNb ? '#/scan/' + lastNb.id : '#/scan'}">${icon('camera')} Scan pages</a></div></div>
    <div class="today">
      <a class="t act ${H.review.due ? 'hot' : ''}" href="#/review"><span class="lbl">Flashcards due</span><b>${H.review.due}</b><span>${H.review.due ? 'about ' + Math.max(1, Math.round(H.review.due / 6)) + ' min of review' : H.review.total ? 'all caught up' : 'make cards in Study'}</span></a>
      <a class="t act ${next && daysUntil(next.date) <= 1 ? 'hot' : ''}" href="#/planner"><span class="lbl">Next up</span><b style="font-size:${next ? '20px' : '30px'}">${next ? esc(next.title) : '—'}</b><span>${next ? countdown(next.date) + (next.subject ? ' · ' + esc(next.subject) : '') : 'nothing scheduled'}</span></a>
      <a class="t act" href="${H.planToday.length ? '#planToday' : '#/study'}"><span class="lbl">Study plan today</span><b>${H.planToday.length ? planLeft : '—'}</b><span>${H.planToday.length ? (planLeft ? plural(planLeft, 'task') + ' left' : 'all done 🎉') : 'no plan yet'}</span></a>
      <a class="t act" href="#/progress"><span class="lbl">Streak</span><b>${H.streak}${H.streak ? '🔥' : ''}</b><span>${H.streak ? plural(H.streak, 'day') + ' in a row' : 'do anything today to start'}</span></a>
    </div>
    ${H.inbox ? `<a class="notice" href="#/inbox">${icon('inbox')} <b>${plural(H.inbox, 'page')}</b> look like they belong in a different notebook. Sort them ${icon('chevR')}</a>` : ''}
    <a class="mini-week" href="#/week" aria-label="This week's load">${H.week.map(w => { const d = parseISO(w.date); return `<span class="mw ${w.load} ${w.date === today ? 'today' : ''}"><small>${DOW[d.getDay()]}</small><span class="bar"><i style="height:${Math.max(3, Math.min(26, Math.round(26 * w.minutes / 90)))}px"></i></span><b>${w.n || ''}</b></span>`; }).join('')}<span class="mw-lbl">This week ${icon('chevR')}</span></a>
    <div class="hero">
      <div>
        ${H.planToday.length ? `<div class="card" id="planToday" style="margin-bottom:16px"><div class="card-head"><h3>${icon('list', 'muted')} Today's study plan</h3><span class="muted small">${H.planToday.filter(t => t.done).length}/${H.planToday.length} done</span></div><div class="plan-today">${H.planToday.map(t => `<label class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-set="${t.setId}" data-task="${t.id}" ${t.done ? 'checked' : ''}><span class="txt">${esc(t.text)}<small>${esc(t.set)} · ${fmtMin(t.minutes)}</small></span><span class="kind ${esc(t.kind)}">${esc(t.kind)}</span></label>`).join('')}</div></div>` : ''}
        <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('camera', 'muted')} Recent pages</h3>${lastNb ? `<a class="btn sm ghost" href="#/notebook/${lastNb.id}">${esc(lastNb.name)} ${icon('chevR')}</a>` : ''}</div>
          ${H.recent.length ? `<div class="recent-list">${H.recent.map(p => `<a class="recent-row" href="#/page/${p.id}"><div class="rthumb" style="background-image:url('/api/pages/${p.id}/image?kind=thumb&r=${p.rev}')"></div><div class="rinfo"><b>${esc(p.title || 'Page ' + p.index)}</b><span class="muted small"><span class="nb-dot color-${esc(p.color)}"></span>${esc(p.notebook)} · p.${p.index} · ${ago(p.createdAt)}${p.status === 'analyzing' ? ' · AI reading…' : p.status === 'error' ? ' · ⚠︎ AI failed' : ''}</span></div>${icon('chevR', 'muted')}</a>`).join('')}</div>` : `<div class="empty" style="padding:22px"><h3>No pages yet</h3><p class="small">Tap <b>Scan pages</b>, point your camera at a page, snap. WorkBook crops, cleans and reads it.</p></div>`}
        </div>
        <div class="card"><div class="card-head"><h3>${icon('book', 'muted')} Notebooks</h3><div class="btn-row"><a class="btn sm ghost" href="#/notebooks?new=1">${icon('plus')} New</a><a class="btn sm ghost" href="#/notebooks">All ${icon('chevR')}</a></div></div>
          ${H.notebooks.length ? `<div class="nb-list">${H.notebooks.slice(0, 6).map(n => nbRow(n)).join('')}</div>` : `<div class="muted small">Create a notebook to start.</div>`}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${tests.length ? `<div class="card warm"><h3>${icon('zap')} Next test</h3><div class="display" style="font-size:22px;font-weight:650;margin:4px 0">${esc(tests[0].title)}</div><div class="muted small">${esc(tests[0].subject || '')} · ${fmtDate(tests[0].date)} · <b class="countdown ${daysUntil(tests[0].date) <= 3 ? 'urgent' : ''}">${countdown(tests[0].date)}</b></div><div class="btn-row" style="margin-top:12px"><a class="btn primary sm" href="${tests[0].studyId ? '#/study/' + tests[0].studyId : '#/study?new=1&event=' + tests[0].id}">${icon('study')} ${tests[0].studyId ? 'Keep studying' : 'Study for it'}</a></div></div>` : ''}
        <div class="card"><div class="card-head"><h3>${icon('bell', 'muted')} Coming up</h3><a class="btn sm ghost" href="#/planner">Planner ${icon('chevR')}</a></div>
          ${upcoming.length ? upcoming.slice(0, 6).map(eventRow).join('') : `<div class="muted small">Nothing scheduled. <a href="#/planner?new=1">Add a test or due date</a>, or scan a page that mentions one and WorkBook will suggest it.</div>`}</div>
        ${H.study.length ? `<div class="card"><h3>${icon('study')} Study sets</h3>${H.study.slice(0, 3).map(s => `<a href="#/study/${s.id}" style="display:block;padding:8px 0;border-bottom:1px solid var(--line-2);text-decoration:none;color:inherit"><b>${esc(s.title)}</b><div class="muted small">${esc(s.subject || '')} · ${plural(s.cardCount, 'card')} · ${plural(s.testCount, 'test')}${s.cardsDue ? ` · <span style="color:var(--amber)">${s.cardsDue} due</span>` : ''}</div></a>`).join('')}<a class="btn sm ghost" style="margin-top:8px" href="#/study">All study sets ${icon('chevR')}</a></div>` : `<div class="card"><h3>${icon('study')} Study</h3><div class="muted small">Open any page and tap <b>Test on this</b>, or build a study set for a test.</div><a class="btn sm" style="margin-top:8px" href="#/study?new=1">${icon('plus')} New study set</a></div>`}
      </div>
    </div>`;
  wireEventRows(main);
  $$('#planToday input').forEach(c => c.onchange = async () => { c.closest('.task').classList.toggle('done', c.checked); try { await api.patch(`/study/${c.dataset.set}/plan`, { taskId: c.dataset.task, done: c.checked }); } catch (e) { toast(e.message, 'err'); } });
}
export function nbRow(n, extra = '') {
  return `<a class="nb-row" href="#/notebook/${n.id}"><span class="nb-dot big color-${esc(n.color || 'navy')}"></span><div><b>${esc(n.name)}</b><span class="muted small">${esc(n.subject || 'Notebook')} · ${plural(n.scanned || 0, 'page')}${n.pageCount ? ' · goal ' + n.pageCount : ''} · ${ago(n.updatedAt)}</span></div>${extra}${icon('chevR', 'muted')}</a>`;
}
export function eventRow(e) {
  const d = parseISO(e.date); const n = daysUntil(e.date);
  const st = e.subtasks || []; const stDone = st.filter(s => s.done).length;
  return `<div class="event-row ${e.done ? 'done' : ''}" data-id="${e.id}"><div class="date ${n >= 0 && n <= 2 && (e.type === 'test' || e.type === 'quiz') ? 'soon' : ''}"><b>${d.getDate()}</b><span>${MON[d.getMonth()]}</span></div>
    <div class="info"><b><span class="type-dot t-${esc(e.type)}"></span>${esc(e.title)}</b><span>${esc(TYPES[e.type] || e.type)}${e.subject ? ' · ' + esc(e.subject) : ''}${e.time ? ' · ' + fmtTime(e.time) : ''} · ${countdown(e.date)}${st.length ? ` · ${stDone}/${st.length} steps <span class="progress sub-prog"><i style="width:${Math.round(100 * stDone / st.length)}%"></i></span>` : ''}</span></div>
    ${(e.type === 'test' || e.type === 'quiz') && !e.done ? `<a class="btn sm ${n <= 5 ? 'primary' : ''}" href="${e.studyId ? '#/study/' + e.studyId : '#/study?new=1&event=' + e.id}">${icon('study')} Study</a>` : ''}
    <button class="btn icon sm ghost ev-edit" title="Edit" aria-label="Edit ${esc(e.title)}">${icon('edit')}</button></div>`;
}
export function wireEventRows(root) {
  $$('.ev-edit', root).forEach(b => b.onclick = async () => { const id = b.closest('.event-row').dataset.id; const evs = await loadEvents(); eventModal(evs.find(e => e.id === id)); });
}

// ---------- notebooks ----------
async function notebooksView(_, q) {
  const main = shell('Notebooks', loading());
  const seq = navId(); const nbs = await loadNotebooks(true); if (stale(seq)) return;
  const view = localStorage.getItem('dwb_nb_view') || 'list';
  const sorted = nbs.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  main.innerHTML = `<div class="page-head"><div><h1>Notebooks</h1><div class="sub">One notebook per class or subject. Everything you scan lands here.</div></div><div class="btn-row"><div class="search-box">${icon('search')}<input class="input" id="q" placeholder="Search all pages…" style="width:240px" aria-label="Search all pages"></div><div class="seg"><button id="vList" class="${view === 'list' ? 'active' : ''}" aria-label="List view">${icon('list')}</button><button id="vGrid" class="${view === 'grid' ? 'active' : ''}" aria-label="Cover view">${icon('image')}</button></div><button class="btn primary" id="newNb">${icon('plus')} New notebook</button></div></div>
    <div id="hits"></div>
    ${nbs.length ? (view === 'grid' ? `<div class="nb-grid">${sorted.map(n => `<a href="#/notebook/${n.id}">${nbCover(n)}<div class="cap"><b>${esc(n.name)}</b><span class="muted">${plural(n.scanned || 0, 'page')} · ${ago(n.updatedAt)}</span></div></a>`).join('')}</div>` : `<div class="nb-list big">${sorted.map(n => nbRow(n, `<a class="btn sm ghost" href="#/scan/${n.id}" onclick="event.stopPropagation()">${icon('camera')} Scan</a>`)).join('')}</div>`) : `<div class="empty"><div class="big">📓</div><h3>No notebooks yet</h3><p>A notebook is just a name and a color. Make one, then scan pages into it.</p><button class="btn primary" id="newNb2">${icon('plus')} New notebook</button></div>`}`;
  $('#newNb').onclick = () => notebookModal();
  if ($('#newNb2')) $('#newNb2').onclick = () => notebookModal();
  $('#vList').onclick = () => { localStorage.setItem('dwb_nb_view', 'list'); notebooksView(_, {}); };
  $('#vGrid').onclick = () => { localStorage.setItem('dwb_nb_view', 'grid'); notebooksView(_, {}); };
  let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => searchPages(e.target.value), 250); };
  if (q.new) notebookModal();
}
async function searchPages(qs) {
  const box = $('#hits'); if (!qs.trim()) { box.innerHTML = ''; return; }
  const r = await api('/search?q=' + encodeURIComponent(qs));
  const hits = r.pages || [];
  const re = new RegExp('(' + qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  box.innerHTML = hits.length || r.study?.length ? `<div class="card" style="margin-bottom:16px"><h3>${plural(hits.length, 'page')} match “${esc(qs)}”</h3>${hits.map(hh => `<div class="hit" onclick="location.hash='#/page/${hh.id}'"><b>${esc(hh.notebook)} · Page ${hh.index}${hh.title ? ' — ' + esc(hh.title) : ''}</b><span>${esc(hh.snippet).replace(re, '<mark>$1</mark>')}</span></div>`).join('')}${r.study?.length ? `<div class="muted small" style="margin-top:8px">Study sets: ${r.study.map(s => `<a href="#/study/${s.id}">${esc(s.title)}</a>`).join(' · ')}</div>` : ''}</div>` : `<div class="muted small" style="margin-bottom:12px">No pages match “${esc(qs)}”.</div>`;
}
export function notebookModal(nb, opts = {}) {
  const isNew = !nb; nb = nb || { name: '', subject: '', color: COLORS[Math.floor(Math.random() * 8)], pageCount: 0 };
  const m = modal(`<h2>${isNew ? 'New notebook' : 'Notebook settings'}</h2>
    <div class="field"><label for="nbName">Name</label><input type="text" id="nbName" value="${esc(nb.name)}" placeholder="e.g. Biology, Math 7, History notes"></div>
    <div class="field"><label for="nbSubject">Subject / class <span class="muted">(optional)</span></label><input type="text" id="nbSubject" value="${esc(nb.subject)}" placeholder="e.g. Biology"></div>
    <div class="field"><label>Color</label><div class="swatches" role="radiogroup">${COLORS.map(c => `<div class="swatch color-${c} ${c === nb.color ? 'active' : ''}" data-c="${c}" role="radio" tabindex="0" aria-label="${c}" aria-checked="${c === nb.color}"></div>`).join('')}</div></div>
    <details ${nb.pageCount ? 'open' : ''}><summary class="small muted" style="cursor:pointer">Optional: set a page goal</summary><div class="field" style="margin-top:8px"><label for="nbPages">How many pages do you plan to scan?</label><input type="number" id="nbPages" min="0" max="500" value="${nb.pageCount || ''}" placeholder="leave empty for no goal"><div class="help">Shows a progress bar. You can scan as many pages as you like either way.</div></div></details>
    <div class="actions">${!isNew ? `<button class="btn danger" id="del" style="margin-right:auto">${icon('trash')} Delete notebook</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="save">${isNew ? 'Create' : 'Save'}</button></div>`);
  const el = m.el; let color = nb.color;
  $$('.swatch', el).forEach(s => { const pick = () => { $$('.swatch', el).forEach(x => { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); }); s.classList.add('active'); s.setAttribute('aria-checked', 'true'); color = s.dataset.c; }; s.onclick = pick; s.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(); } }; });
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
  if (!isNew) $('#del', el).onclick = async () => { if (await confirm('Delete notebook?', `“${nb.name}” and its pages move to the trash for 30 days.`)) { const r = await api.del('/notebooks/' + nb.id); invalidate(); m.close(); go('#/notebooks'); undoToast(`Deleted “${nb.name}”`, r.trashId); } };
}
// delete → toast with Undo (restores from the trash)
export function undoToast(msg, trashId, after) {
  toast(msg, '', { action: { label: 'Undo', fn: async () => { try { await api('/trash/' + trashId + '/restore', { body: {} }); invalidate(); toast('Restored', 'ok'); after ? after() : dispatch(); } catch (e) { toast(e.message, 'err'); } } } });
}

// ---------- notebook view: numbered page list + topics + vocab bank ----------
async function notebookView({ id }, q = {}) {
  const main = shell('Notebooks', loading());
  const seq = navId(); const nb = await api('/notebooks/' + id + '?lite=1'); if (stale(seq)) return;
  let pages = nb.pages.slice(); let selecting = false; const sel = new Set(); let filter = ''; let topic = ''; let hitIds = null; let mode = q.tab === 'vocab' ? 'vocab' : 'pages'; let vocab = null;
  const draw = () => {
    const f = filter.toLowerCase();
    const shown = pages.filter(p => (!topic || (p.topics || []).includes(topic)) && (!f || (p.title + ' ' + p.excerpt + ' ' + (p.topics || []).join(' ')).toLowerCase().includes(f) || hitIds?.has(p.id)));
    main.innerHTML = `<div class="crumbs"><a href="#/notebooks">Notebooks</a> › <span>${esc(nb.name)}</span></div>
    <div class="page-head" style="margin-bottom:14px"><div><h1><span class="nb-dot big color-${esc(nb.color || 'navy')}" style="vertical-align:-2px;margin-right:8px"></span>${esc(nb.name)}</h1><div class="sub">${esc(nb.subject || 'Notebook')} · ${plural(pages.length, 'page')}${nb.pageCount ? ` · goal ${nb.pageCount} (${Math.min(100, Math.round(100 * pages.length / nb.pageCount))}%)` : ''}</div></div>
      <div class="btn-row"><a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Scan more</a>${pages.length ? `<a class="btn" href="#/book/${nb.id}">${icon('play')} Slideshow</a><a class="btn" href="#/study?new=1&notebook=${nb.id}">${icon('study')} Study</a><button class="btn" id="moreNb" aria-haspopup="menu">${icon('more')} More</button>` : ''}<button class="btn icon" id="edit" title="Notebook settings" aria-label="Notebook settings">${icon('settings')}</button></div></div>
    ${pages.length ? `<div class="list-tools"><div class="btn-row"><div class="seg"><button id="mPages" class="${mode === 'pages' ? 'active' : ''}">Pages</button><button id="mVocab" class="${mode === 'vocab' ? 'active' : ''}">Vocab</button></div>${mode === 'pages' ? `<div class="search-box">${icon('search')}<input class="input" id="pq" placeholder="Find in this notebook…" value="${esc(filter)}" aria-label="Find in this notebook"></div>` : ''}</div><div class="btn-row">${mode === 'pages' ? (selecting ? `<span class="muted small">${sel.size} selected</span><button class="btn sm" id="selAll">All</button><button class="btn sm danger" id="delSel" ${sel.size ? '' : 'disabled'}>${icon('trash')} Delete</button><button class="btn sm" id="moveSel" ${sel.size ? '' : 'disabled'}>Move to…</button><button class="btn sm" id="cancelSel">Done</button>` : `<button class="btn sm" id="selMode">Select</button>`) : ''}</div></div>
    ${mode === 'pages' && nb.topics?.length ? `<div class="chips" style="margin-bottom:12px"><button class="chip ${!topic ? 'on' : ''} tp" data-t="">All topics</button>${nb.topics.map(x => `<button class="chip blue ${topic === x.t ? 'on' : ''} tp" data-t="${esc(x.t)}">${esc(x.t)} <span class="muted">${x.n}</span></button>`).join('')}</div>` : ''}
    ${mode === 'vocab' ? `<div id="vocabBox">${loading('Collecting vocabulary…')}</div>` : `<div class="page-list" id="plist">${shown.map(p => `<div class="prow ${sel.has(p.id) ? 'sel' : ''}" data-id="${p.id}" draggable="${selecting ? 'false' : 'true'}" role="link" tabindex="0">
        ${selecting ? `<label class="pchk"><input type="checkbox" ${sel.has(p.id) ? 'checked' : ''} aria-label="Select page ${p.index}"></label>` : `<div class="pnum">${p.index}</div>`}
        <div class="pthumb" style="background-image:url('/api/pages/${p.id}/image?kind=thumb&r=${p.rev || 0}')"></div>
        <div class="pinfo"><b>${esc(p.title || 'Page ' + p.index)}</b><span class="muted small">${ago(p.createdAt)}${p.keyPointsN ? ' · ' + p.keyPointsN + ' key points' : ''}${p.figuresN ? ' · 🖼 ' + p.figuresN : ''}${p.hasHomework ? ` · ✓ checked ${p.homeworkPercent}%` : ''}${p.hasSuggestions ? ' · <span style="color:var(--amber)">📅 planner suggestion</span>' : ''}${p.status === 'analyzing' ? ' · <span class="spinner" style="width:10px;height:10px"></span> AI reading' : p.status === 'error' ? ' · <span style="color:var(--red)">AI failed</span>' : p.status !== 'ready' ? ' · not read yet' : ''}</span><span class="muted small pexcerpt">${esc(p.excerpt)}</span></div>
        <div class="pacts">${selecting ? '' : `<button class="btn icon sm ghost up" title="Move up" aria-label="Move up">${icon('chevL')}</button><button class="btn icon sm ghost down" title="Move down" aria-label="Move down">${icon('chevR')}</button><button class="btn icon sm ghost pdel" title="Delete page" aria-label="Delete page">${icon('trash')}</button>`}</div>
      </div>`).join('')}</div>
    ${shown.length === 0 ? `<div class="muted small" style="padding:12px">No pages match.</div>` : ''}
    <div class="muted small" style="margin-top:10px">Drag pages to reorder · tap a page to open it · Select to delete or move several at once.</div>`}`
    : `<div class="empty"><div class="big">📷</div><h3>No pages yet</h3><p>Tap Scan more and snap the first page. WorkBook crops it, cleans it up and reads it. You just keep snapping.</p><a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Start scanning</a></div>`}`;
    $('#edit').onclick = () => notebookModal(nb);
    const more = $('#moreNb'); if (more) more.onclick = () => {
      const mm = modal(`<h2>${esc(nb.name)}</h2><div class="nb-list">
        <button class="nb-row" id="mShare">${icon('upload')}<div><b>Share a read-only link</b><span class="muted small">Anyone with the link can view pages and digital copies</span></div></button>
        <button class="nb-row" id="mPdf">${icon('print')}<div><b>Print / save as PDF</b><span class="muted small">Every scan next to its digital copy</span></div></button>
        <button class="nb-row" id="mMd">${icon('download')}<div><b>Export notes as Markdown</b><span class="muted small">One .md file with every page's digital copy</span></div></button>
        <button class="nb-row" id="mVocabCards">${icon('cards')}<div><b>Flashcards from vocab</b><span class="muted small">Instant, no AI: every term and definition found in this notebook</span></div></button>
      </div><div class="actions"><button class="btn" data-close>Close</button></div>`);
      $('#mShare', mm.el).onclick = async () => { mm.close(); (await import('./extras.js')).shareThing('notebook', nb.id, nb.name); };
      $('#mPdf', mm.el).onclick = async () => { mm.close(); const full = await api('/notebooks/' + nb.id); printNotebook(full); };
      $('#mMd', mm.el).onclick = async () => { mm.close(); const full = await api('/notebooks/' + nb.id); download(`${nb.name}.md`, notebookMarkdown(full), 'text/markdown'); toast('Downloaded', 'ok'); };
      $('#mVocabCards', mm.el).onclick = async () => { busy($('#mVocabCards', mm.el), true, 'Making cards…'); try { const r = await api('/notebooks/' + nb.id + '/vocab-cards', { body: {} }); invalidate(); mm.close(); toast(`${r.cards} flashcards made`, 'ok'); go('#/study/' + r.id + '?tab=cards'); } catch (e) { toast(e.message, 'err'); busy($('#mVocabCards', mm.el), false); } };
    };
    const mp = $('#mPages'); if (mp) { mp.onclick = () => { mode = 'pages'; draw(); }; $('#mVocab').onclick = () => { mode = 'vocab'; draw(); }; }
    if (mode === 'vocab') drawVocab();
    $$('.tp').forEach(b => b.onclick = () => { topic = b.dataset.t; draw(); });
    const pq = $('#pq'); if (pq) { let t; pq.oninput = () => { filter = pq.value; const y = window.scrollY; draw(); $('#pq').focus(); $('#pq').setSelectionRange(filter.length, filter.length); window.scrollTo(0, y); clearTimeout(t); if (filter.trim().length >= 3) t = setTimeout(async () => { try { const r = await api('/search?q=' + encodeURIComponent(filter) + '&notebook=' + nb.id); hitIds = new Set(r.pages.map(p => p.id)); if ($('#pq')?.value === filter) { const y2 = window.scrollY; draw(); $('#pq').focus(); $('#pq').setSelectionRange(filter.length, filter.length); window.scrollTo(0, y2); } } catch {} }, 250); else hitIds = null; }; }
    const sm = $('#selMode'); if (sm) sm.onclick = () => { selecting = true; sel.clear(); draw(); };
    const cs = $('#cancelSel'); if (cs) cs.onclick = () => { selecting = false; sel.clear(); draw(); };
    const sa = $('#selAll'); if (sa) sa.onclick = () => { if (sel.size === pages.length) sel.clear(); else pages.forEach(p => sel.add(p.id)); draw(); };
    const ds = $('#delSel'); if (ds) ds.onclick = async () => { if (!(await confirm(`Delete ${plural(sel.size, 'page')}?`, 'They move to the trash for 30 days (Settings → Trash to restore).'))) return; for (const pid of sel) await api.del('/pages/' + pid).catch(() => {}); invalidate(); await reload(); selecting = false; sel.clear(); draw(); toast('Deleted (undo from Settings → Trash)', 'ok'); };
    const mv = $('#moveSel'); if (mv) mv.onclick = async () => { const nbs = await loadNotebooks(); const others = nbs.filter(n => n.id !== nb.id); if (!others.length) return toast('No other notebook to move to. Create one first.', 'err'); const mm = modal(`<h2>Move ${plural(sel.size, 'page')} to…</h2><div class="nb-list">${others.map(n => `<button class="nb-row" data-id="${n.id}"><span class="nb-dot color-${esc(n.color)}"></span><div><b>${esc(n.name)}</b><span class="muted small">${plural(n.scanned || 0, 'page')}</span></div></button>`).join('')}</div><div class="actions"><button class="btn" data-close>Cancel</button></div>`); $$('.nb-row', mm.el).forEach(b => b.onclick = async () => { for (const pid of sel) await api.patch('/pages/' + pid, { notebookId: b.dataset.id }).catch(() => {}); mm.close(); invalidate(); await reload(); selecting = false; sel.clear(); draw(); toast('Moved', 'ok'); }); };
    $$('.prow').forEach(row => {
      const pid = row.dataset.id;
      row.onclick = (e) => { if (e.target.closest('button,label,input')) return; if (selecting) { sel.has(pid) ? sel.delete(pid) : sel.add(pid); draw(); } else go('#/page/' + pid); };
      row.onkeydown = (e) => { if (e.key === 'Enter' && !e.target.closest('button,input')) row.click(); };
      const chk = $('input', row); if (chk) chk.onchange = () => { chk.checked ? sel.add(pid) : sel.delete(pid); draw(); };
      const up = $('.up', row), down = $('.down', row), del = $('.pdel', row);
      if (up) up.onclick = () => moveBy(pid, -1); if (down) down.onclick = () => moveBy(pid, 1);
      if (del) del.onclick = async () => { const p = pages.find(x => x.id === pid); if (await confirm('Delete this page?', `Page ${p.index}${p.title ? ' — ' + p.title : ''} moves to the trash for 30 days.`)) { const r = await api.del('/pages/' + pid); invalidate(); await reload(); draw(); undoToast('Page deleted', r.trashId, async () => { await reload(); draw(); }); } };
      row.ondragstart = (e) => { e.dataTransfer.setData('text/plain', pid); row.classList.add('dragging'); };
      row.ondragend = () => row.classList.remove('dragging');
      row.ondragover = (e) => { e.preventDefault(); row.classList.add('over'); };
      row.ondragleave = () => row.classList.remove('over');
      row.ondrop = async (e) => { e.preventDefault(); row.classList.remove('over'); const from = e.dataTransfer.getData('text/plain'); if (!from || from === pid) return; const a = pages.findIndex(p => p.id === from), b = pages.findIndex(p => p.id === pid); const [mvd] = pages.splice(a, 1); pages.splice(b, 0, mvd); await saveOrder(); };
    });
  };
  const drawVocab = async () => {
    if (!vocab) { try { vocab = await api('/notebooks/' + nb.id + '/vocab'); } catch (e) { vocab = []; } }
    const box = $('#vocabBox'); if (!box) return;
    let vq = '';
    const dv = () => { const list = vocab.filter(v => !vq || (v.term + ' ' + v.definition).toLowerCase().includes(vq.toLowerCase())); box.innerHTML = `<div class="list-tools"><div class="search-box">${icon('search')}<input class="input" id="vq" placeholder="Find a term…" value="${esc(vq)}" aria-label="Find a term"></div><div class="btn-row"><span class="muted small">${plural(vocab.length, 'term')}</span>${vocab.length ? `<button class="btn sm primary" id="vCards">${icon('cards')} Make flashcards</button>` : ''}</div></div>${list.length ? `<div class="vocab-bank">${list.map(v => `<div class="v"><b>${mdi(v.term)}</b>${mdi(v.definition)}<br><small><a href="#/page/${v.pageId}">page ${v.pageIndex}</a></small></div>`).join('')}</div>` : `<div class="empty"><h3>No vocabulary yet</h3><p>Terms and definitions the AI spots on your pages collect here.</p></div>`}`; const vin = $('#vq', box); vin.oninput = () => { vq = vin.value; const y = window.scrollY; dv(); $('#vq', box).focus(); $('#vq', box).setSelectionRange(vq.length, vq.length); window.scrollTo(0, y); }; const vc = $('#vCards', box); if (vc) vc.onclick = async () => { busy(vc, true, 'Making…'); try { const r = await api('/notebooks/' + nb.id + '/vocab-cards', { body: {} }); invalidate(); go('#/study/' + r.id + '?tab=cards'); } catch (e) { toast(e.message, 'err'); busy(vc, false); } }; };
    dv();
  };
  const reload = async () => { const fresh = await api('/notebooks/' + id + '?lite=1'); pages = fresh.pages; nb.topics = fresh.topics; };
  const moveBy = async (pid, d) => { const i = pages.findIndex(p => p.id === pid); const j = i + d; if (j < 0 || j >= pages.length) return; [pages[i], pages[j]] = [pages[j], pages[i]]; await saveOrder(); };
  const saveOrder = async () => { const r = await api(`/notebooks/${nb.id}/reorder`, { body: { pageIds: pages.map(p => p.id) } }); r.pages.forEach(x => { const p = pages.find(q => q.id === x.id); if (p) p.index = x.index; }); pages.sort((a, b) => a.index - b.index); invalidate(); draw(); };
  draw();
}
function notebookMarkdown(nb) {
  return `# ${nb.name}\n${nb.subject ? nb.subject + '\n' : ''}\nExported from WorkBook · ${plural(nb.pages.length, 'page')}\n\n` + nb.pages.map(p => `## Page ${p.index}${p.title ? ': ' + p.title : ''}\n\n${(p.transcript || '_No digital copy_').replace(/\[\[figure:\d+\]\]/g, '')}\n${p.keyPoints?.length ? '\n**Key points**\n' + p.keyPoints.map(k => '- ' + k).join('\n') + '\n' : ''}${p.vocab?.length ? '\n**Vocabulary**\n' + p.vocab.map(v => `- **${v.term}** — ${v.definition}`).join('\n') + '\n' : ''}`).join('\n---\n\n');
}
// Print / save-as-PDF: every page with its scan and digital copy.
function printNotebook(nb) {
  const w = window.open('', '_blank'); if (!w) return toast('Pop-up blocked. Allow pop-ups to export.', 'err');
  const pages = nb.pages.map(p => `<section class="pp"><div class="scan"><img src="/api/pages/${p.id}/image?kind=enh&r=${p.rev || 0}"></div><div class="txt"><h2>${esc(p.title || 'Page ' + p.index)} <small>p.${p.index}</small></h2><div class="md">${p.transcript ? md(p.transcript.replace(/\[\[figure:\d+\]\]/g, '')) : '<i>No digital copy</i>'}</div>${p.keyPoints?.length ? `<h3>Key points</h3><ul>${p.keyPoints.map(k => `<li>${mdi(k)}</li>`).join('')}</ul>` : ''}</div></section>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(nb.name)}</title><link rel="stylesheet" href="/vendor/katex/katex.min.css"><link rel="stylesheet" href="/css/styles.css"><style>
    body{padding:24px;background:#fff !important;background-image:none !important}.cover{text-align:center;padding:120px 0;page-break-after:always}.cover h1{font-size:44px}.cover p{color:#666}
    .pp{display:grid;grid-template-columns:1fr 1fr;gap:24px;page-break-after:always;padding:8px 0;min-height:90vh;align-items:start}.pp .scan img{width:100%;border:1px solid #ddd;border-radius:6px}.pp h2 small{color:#999;font-weight:400;font-size:14px}
    @media print{body{padding:0}.pp{min-height:auto}}</style></head><body>
    <div class="cover"><h1>${esc(nb.name)}</h1><p>${esc(nb.subject || '')} · ${plural(nb.pages.length, 'page')} · exported from WorkBook</p></div>${pages}
    <script>window.onload=()=>setTimeout(()=>print(),600)</script></body></html>`);
  w.document.close();
}

// ---------- page viewer ----------
const LANGS = ['Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Chinese (Simplified)', 'Japanese', 'Korean', 'Arabic', 'Hindi', 'Vietnamese', 'Tagalog', 'Russian', 'English'];
async function pageView({ id }, q = {}) {
  const main = shell('Notebooks', loading());
  const seq = navId();
  let page = null, nb = null;
  try { const r = await api('/pages/' + id); page = r.page; nb = r.notebook; } catch { toast('Page not found', 'err'); return go('#/notebooks'); }
  if (stale(seq)) return;
  const idx = nb.pages.findIndex(p => p.id === id);
  const prev = nb.pages[idx - 1], next = nb.pages[idx + 1];
  let kind = 'enh';
  const sugs = (page.suggestions || []).filter(s => !s.done);
  main.innerHTML = `<div class="crumbs"><a href="#/notebooks">Notebooks</a> › <a href="#/notebook/${nb.id}">${esc(nb.name)}</a> › <span>Page ${page.index}</span></div>
    <div class="page-head" style="margin-bottom:14px"><div><h1 id="ptitle" contenteditable="true" spellcheck="false" title="Click to rename" style="outline:none;border-bottom:1px dashed transparent">${esc(page.title || 'Page ' + page.index)}</h1><div class="sub">${esc(nb.name)} · page ${page.index} of ${nb.pages.length} · scanned ${ago(page.createdAt)}${page.readability ? ' · handwriting: ' + esc(page.readability) : ''}</div></div>
      <div class="btn-row"><button class="btn primary" id="testThis">${icon('quiz')} Test on this</button><button class="btn" id="checkHw">${icon('check')} Check homework</button><button class="btn" id="moreP" aria-haspopup="menu">${icon('more')} More</button></div></div>
    ${sugs.length ? `<div class="card sun sug-card"><h3>📅 Spotted on this page</h3>${sugs.map((sg, k) => `<div class="sug-row"><div><b>${esc(sg.title)}</b> <span class="chip">${esc(TYPES[sg.type] || sg.type)}</span><div class="muted small">${sg.dateText ? '“' + esc(sg.dateText) + '” · ' : ''}${sg.date ? fmtDate(sg.date) + ' · ' + countdown(sg.date) : 'date unknown, pick one'}${sg.notes ? ' · ' + esc(sg.notes) : ''}</div></div><div class="btn-row"><button class="btn sm primary addSug" data-k="${k}">${icon('plus')} Add to planner</button><button class="btn sm ghost dismissSug" data-k="${k}">Dismiss</button></div></div>`).join('')}</div>` : ''}
    ${page.sort?.status === 'pending' ? `<div class="notice" id="sortNotice">${icon('inbox')} This page looks like <b>${esc(page.subject || page.sort.subject)}</b>. ${page.sort.notebookId ? `Move it to <b>${esc(page.sort.name)}</b>?` : `Make a <b>${esc(page.sort.create)}</b> notebook for it?`}<span class="btn-row" style="margin-left:auto"><button class="btn sm primary" id="sortYes">Yes</button><button class="btn sm ghost" id="sortNo">Keep here</button></span></div>` : ''}
    <div id="hwBox">${page.homework ? homeworkHtml(page.homework) : ''}</div>
    <div class="viewer">
      <div><div class="btn-row" style="justify-content:space-between;margin-bottom:8px"><div class="seg imgtools"><button class="active" data-k="enh">Enhanced</button><button data-k="orig">Original</button></div><span class="muted small">${page.figures?.length ? '🖼 ' + plural(page.figures.length, 'picture') + ' kept · ' : ''}click to zoom</span></div><div class="imgbox" id="imgbox"><img id="pimg" src="/api/pages/${page.id}/image?kind=enh&r=${page.rev || 0}" alt="Scan of page ${page.index}"></div>
        <div class="pager">${prev ? `<a class="btn" href="#/page/${prev.id}">${icon('chevL')} Page ${prev.index}</a>` : '<span></span>'}<a class="btn ghost" href="#/notebook/${nb.id}">${icon('book')} All pages</a>${next ? `<a class="btn" href="#/page/${next.id}">Page ${next.index} ${icon('chevR')}</a>` : `<a class="btn primary" href="#/scan/${nb.id}">${icon('camera')} Scan next</a>`}</div>
      </div>
      <div>
        <div class="card-head"><h3><span class="ai-tag">${icon('sparkle')} AI</span> Digital copy</h3><div class="seg"><button class="active" id="mRead">Read</button><button id="mEdit">Edit</button></div></div>
        <div id="tstatus"></div>
        <div class="paper holes" id="tpaper"><div class="md" id="tread">${page.transcript ? mdPage(page.transcript, page) : '<span class="muted">No digital copy yet. Use More → Re-read.</span>'}</div><textarea class="transcript hidden" id="tedit" aria-label="Transcript">${esc(page.transcript)}</textarea></div>
        <div id="tsave" class="hidden" style="margin-top:8px;text-align:right"><button class="btn primary sm" id="saveT">Save transcript</button></div>
        <div class="btn-row" style="margin-top:12px" id="toolBar"><button class="btn sm" data-tool="explain">${icon('wand')} Explain simply</button><button class="btn sm" data-tool="summary">${icon('sheet')} Summary</button><button class="btn sm" data-tool="questions">${icon('quiz')} Practice questions</button><button class="btn sm" id="translateBtn">${icon('translate')} Translate</button><button class="btn sm" id="sayBtn">${icon('speaker')} Read aloud</button><button class="btn sm" id="askBtn">${icon('chat')} Ask about this page</button></div>
        <div class="tool-out" id="toolOut"></div>
        ${page.keyPoints?.length ? `<div class="card" style="margin-top:16px"><h3>Key points</h3><ul class="kp">${page.keyPoints.map(k => `<li>${mdi(k)}</li>`).join('')}</ul></div>` : ''}
        ${page.vocab?.length ? `<div class="card" style="margin-top:16px"><h3>Vocabulary</h3><div class="vocab">${page.vocab.map(v => `<div><b>${mdi(v.term)}</b> — ${mdi(v.definition)}</div>`).join('')}</div></div>` : ''}
        ${page.topics?.length ? `<div class="chips" style="margin-top:12px">${page.topics.map(t => `<a class="chip blue" href="#/topics?t=${encodeURIComponent(String(t).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim())}" style="text-decoration:none">${esc(t)}</a>`).join('')}</div>` : ''}
        <div id="related"></div>
      </div>
    </div>`;
  hydrateFigures($('#tread'), page);
  api('/pages/' + page.id + '/related').then(rel => { const box = $('#related'); if (!box || !rel.length) return; box.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-head"><h3>${icon('layers', 'muted')} Related pages</h3><a class="btn sm ghost" href="#/topics">Topic map ${icon('chevR')}</a></div><div class="recent-list">${rel.map(r => `<a class="recent-row" href="#/page/${r.id}"><div class="rthumb" style="background-image:url('/api/pages/${r.id}/image?kind=thumb&r=${r.rev}')"></div><div class="rinfo"><b>${esc(r.title || 'Page ' + r.index)}</b><span class="muted small"><span class="nb-dot color-${esc(r.color)}"></span>${esc(r.notebook)} · p.${r.index}${r.reasons.length ? ' · ' + esc(r.reasons.join(', ')) : ''}</span></div>${icon('chevR', 'muted')}</a>`).join('')}</div></div>`; }).catch(() => {});
  const sy = $('#sortYes'); if (sy) { sy.onclick = async () => { busy(sy, true, 'Moving…'); try { const r = await api('/pages/' + page.id + '/sort', { body: page.sort.notebookId ? { notebookId: page.sort.notebookId } : { createName: page.sort.create } }); invalidate(); toast('Moved to ' + r.notebook.name, 'ok'); go('#/page/' + page.id); dispatch(); } catch (e) { toast(e.message, 'err'); busy(sy, false); } }; $('#sortNo').onclick = async () => { await api('/pages/' + page.id + '/sort', { body: { dismiss: true } }); $('#sortNotice').remove(); }; }
  $$('.imgtools button').forEach(b => b.onclick = () => { $$('.imgtools button').forEach(x => x.classList.remove('active')); b.classList.add('active'); kind = b.dataset.k; $('#pimg').src = `/api/pages/${page.id}/image?kind=${kind}&r=${page.rev || 0}`; });
  $('#imgbox').onclick = () => lightbox($('#pimg').src, `Page ${page.index}`);
  $('#mRead').onclick = () => { $('#mRead').classList.add('active'); $('#mEdit').classList.remove('active'); $('#tread').classList.remove('hidden'); $('#tedit').classList.add('hidden'); $('#tsave').classList.add('hidden'); };
  $('#mEdit').onclick = () => { $('#mEdit').classList.add('active'); $('#mRead').classList.remove('active'); $('#tread').classList.add('hidden'); $('#tedit').classList.remove('hidden'); $('#tsave').classList.remove('hidden'); $('#tedit').focus(); };
  $('#saveT').onclick = async () => { const t = $('#tedit').value; await api.patch('/pages/' + page.id, { transcript: t }); page.transcript = t; $('#tread').innerHTML = mdPage(t, page); hydrateFigures($('#tread'), page); $('#mRead').click(); toast('Saved', 'ok'); };
  $('#ptitle').onblur = async () => { const t = $('#ptitle').textContent.trim(); if (t && t !== page.title) { await api.patch('/pages/' + page.id, { title: t }); page.title = t; } };
  $('#ptitle').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
  $('#testThis').onclick = () => import('./study.js').then(m => m.testOnPage(page, nb));
  $('#checkHw').onclick = () => checkHomework(page, nb);
  $('#moreP').onclick = () => {
    const mm = modal(`<h2>Page ${page.index}</h2><div class="nb-list">
      <button class="nb-row" id="pGraded">📝<div><b>Graded test → fix-it set</b><span class="muted small">Reads the teacher's marks and builds flashcards + a test on what you missed</span></div></button>
      <button class="nb-row" id="pAdjust">${icon('edit')}<div><b>Adjust crop and look</b><span class="muted small">Corners, rotation, filters, readability boost</span></div></button>
      <button class="nb-row" id="pRerun">${icon('sparkle')}<div><b>Re-read with AI</b><span class="muted small">Rebuilds the digital copy, key points and vocab</span></div></button>
      <a class="nb-row" href="/api/pages/${page.id}/image?kind=enh" download="${esc(nb.name)}-p${page.index}.jpg">${icon('download')}<div><b>Download scan</b><span class="muted small">Enhanced JPEG</span></div></a>
      <button class="nb-row" id="pMd">${icon('download')}<div><b>Download notes (.md)</b><span class="muted small">The digital copy as Markdown</span></div></button>
      <button class="nb-row" id="pDel" style="color:var(--red)">${icon('trash')}<div><b>Delete page</b><span class="muted small">Goes to the trash for 30 days</span></div></button>
    </div><div class="actions"><button class="btn" data-close>Close</button></div>`);
    $('#pGraded', mm.el).onclick = async () => { mm.close(); if (!(await confirm('Graded test?', 'AI will read the teacher’s marks on this page, find what you got wrong, and build a study set (flashcards + practice test) just for those.', { danger: false, ok: 'Build fix-it set' }))) return; const b = $('#checkHw'); busy(b, true, 'Reading the marks…'); try { const r = await api('/pages/' + page.id + '/graded', { body: {} }); invalidate(); toast(`Found ${r.missed} missed of ${r.total}. Building your fix-it set`, 'ok'); sessionStorage.setItem('dwb_fixit', '1'); go('#/study/' + r.study.id + '?fixit=1'); } catch (e) { toast(e.message, 'err'); busy(b, false); } };
    $('#pAdjust', mm.el).onclick = () => { mm.close(); import('./scan.js').then(m => m.openAdjust({ pageId: page.id, corners: null, filter: page.filter }, () => dispatch())); };
    $('#pRerun', mm.el).onclick = async () => { mm.close(); $('#tstatus').innerHTML = `<div class="ai-status"><span class="spinner"></span> AI is reading the page…</div>`; try { await api('/pages/' + page.id + '/analyze', { body: {} }); dispatch(); } catch (e) { toast(e.message, 'err'); $('#tstatus').innerHTML = ''; } };
    $('#pMd', mm.el).onclick = () => { mm.close(); download(`${nb.name}-p${page.index}.md`, `# ${page.title || 'Page ' + page.index}\n\n${(page.transcript || '').replace(/\[\[figure:\d+\]\]/g, '')}\n${page.keyPoints?.length ? '\n**Key points**\n' + page.keyPoints.map(k => '- ' + k).join('\n') : ''}`, 'text/markdown'); };
    $('#pDel', mm.el).onclick = async () => { mm.close(); if (await confirm('Delete this page?', 'It moves to the trash for 30 days.')) { const r = await api.del('/pages/' + page.id); invalidate(); go('#/notebook/' + nb.id); undoToast('Page deleted', r.trashId); } };
  };
  wireHomework(page, nb);
  // AI tools
  const runTool = async (tool, lang, btn) => {
    const out = $('#toolOut'); if (btn) busy(btn, true, 'Working…');
    out.innerHTML = `<div class="ai-status"><span class="spinner"></span> ${esc(tool === 'translate' ? 'Translating to ' + lang + '…' : 'Thinking…')}</div>`;
    try { const r = await api('/pages/' + page.id + '/tool', { body: { tool, lang } }); out.innerHTML = `<div class="card"><div class="card-head"><h3>${esc({ explain: 'Explained simply', summary: 'Summary', questions: 'Practice questions', translate: 'Translated to ' + lang }[tool])}</h3><div class="btn-row"><button class="btn sm ghost" id="toolAgain" title="Regenerate">${icon('refresh')}</button><button class="btn sm ghost" id="toolSay" aria-label="Read aloud">${icon('speaker')}</button><button class="btn sm ghost" id="toolClose" aria-label="Close">${icon('x')}</button></div></div><div class="md">${md(r.text)}</div></div>`; $('#toolAgain').onclick = () => api('/pages/' + page.id + '/tool', { body: { tool, lang, fresh: true } }).then(() => runTool(tool, lang)); $('#toolClose').onclick = () => { out.innerHTML = ''; }; $('#toolSay').onclick = async () => (await import('./extras.js')).voice.speak(r.text); }
    catch (e) { out.innerHTML = ''; toast(e.message, 'err'); }
    if (btn) busy(btn, false);
  };
  $$('#toolBar [data-tool]').forEach(b => b.onclick = () => runTool(b.dataset.tool, null, b));
  $('#translateBtn').onclick = () => { const last = localStorage.getItem('dwb_lang') || 'Spanish'; const mm = modal(`<h2>Translate this page</h2><div class="field"><label for="lang">Language</label><select id="lang">${LANGS.map(l => `<option ${l === last ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">${icon('translate')} Translate</button></div>`); $('#go', mm.el).onclick = () => { const l = $('#lang', mm.el).value; localStorage.setItem('dwb_lang', l); mm.close(); runTool('translate', l, $('#translateBtn')); }; };
  $('#sayBtn').onclick = async () => { const v = (await import('./extras.js')).voice; if (speechSynthesis.speaking) { v.stop(); $('#sayBtn').innerHTML = `${icon('speaker')} Read aloud`; return; } $('#sayBtn').innerHTML = `${icon('x')} Stop reading`; v.speak((page.title ? page.title + '. ' : '') + (page.transcript || 'No digital copy yet.'), () => { const b = $('#sayBtn'); if (b) b.innerHTML = `${icon('speaker')} Read aloud`; }); };
  $('#askBtn').onclick = () => askAboutPage(page, $('#toolOut'));
  $$('.addSug').forEach(b => b.onclick = () => { const sg = sugs[+b.dataset.k]; eventModal(null, sg.date || undefined, { title: sg.title, type: sg.type, subject: nb.subject || '', notes: sg.notes || '', notebookId: nb.id, onSaved: async () => { sg.done = true; await api.patch('/pages/' + page.id, { suggestions: page.suggestions }); dispatch(); } }); });
  $$('.dismissSug').forEach(b => b.onclick = async () => { sugs[+b.dataset.k].done = true; await api.patch('/pages/' + page.id, { suggestions: page.suggestions }); dispatch(); });
  setKeys((e) => { if (e.target.closest('input,textarea,[contenteditable]')) return; if (e.key === 'ArrowLeft' && prev) go('#/page/' + prev.id); if (e.key === 'ArrowRight' && next) go('#/page/' + next.id); if (e.key === 'e') $('#mEdit').click(); });
  if (q.tool) runTool(q.tool);
  if (q.ask) { askAboutPage(page, $('#toolOut')); $('#toolOut').scrollIntoView({ block: 'center' }); }
}
// per-page tutor chat (streams)
function askAboutPage(page, out) {
  const msgs = (page.chat || []).slice();
  out.innerHTML = `<div class="chat compact"><div class="msgs" id="pmsgs">${msgs.length ? msgs.map(m => `<div class="m ${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'user' ? esc(m.content) : '<div class="md">' + md(m.content) + '</div>'}</div>`).join('') : `<div class="m ai"><div class="md"><p>Ask me anything about this page: what a word means, why a step works, or “quiz me on this”.</p></div></div>`}</div><form id="pchat"><input id="pchatIn" placeholder="Ask about this page…" autocomplete="off" aria-label="Your question"><button class="btn primary" type="submit">Send</button></form></div><div class="btn-row" style="margin-top:6px"><button class="btn sm ghost psug">Explain the hardest part</button><button class="btn sm ghost psug">Quiz me on this page</button><button class="btn sm ghost psug">Why does this matter?</button><button class="btn sm ghost" id="pchatClose">Close</button></div>`;
  const box = $('#pmsgs');
  const send = async (text) => {
    if (!text.trim()) return;
    msgs.push({ role: 'user', content: text }); box.appendChild(h(`<div class="m user">${esc(text)}</div>`));
    const ai = h(`<div class="m ai"><div class="md"><span class="spinner"></span></div></div>`); box.appendChild(ai); box.scrollTop = box.scrollHeight;
    let reply = '';
    try { await stream(`/pages/${page.id}/ask`, { messages: msgs }, (t) => { reply += t; $('.md', ai).innerHTML = md(reply); box.scrollTop = box.scrollHeight; }); msgs.push({ role: 'assistant', content: reply }); page.chat = msgs; }
    catch (e) { $('.md', ai).innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  };
  $('#pchat').onsubmit = (e) => { e.preventDefault(); const v = $('#pchatIn').value; $('#pchatIn').value = ''; send(v); };
  $$('.psug').forEach(b => b.onclick = () => send(b.textContent));
  $('#pchatClose').onclick = () => { out.innerHTML = ''; };
  $('#pchatIn').focus(); box.scrollTop = box.scrollHeight;
}
// zoomable image overlay (wheel / pinch / drag, Esc closes)
export function lightbox(src, alt = '') {
  const lb = h(`<div class="lightbox" role="dialog" aria-label="Zoomed image"><img src="${src}" alt="${esc(alt)}"><button class="btn icon lb-close" aria-label="Close">${icon('x')}</button><div class="lb-hint">scroll or pinch to zoom · drag to move · Esc to close</div></div>`);
  document.body.appendChild(lb);
  const img = $('img', lb); let s = 1, tx = 0, ty = 0, drag = null; const pts = new Map(); let pinch = null;
  const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; };
  const close = () => { lb.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('.lb-close', lb).onclick = close;
  lb.onclick = (e) => { if (e.target === lb) close(); };
  lb.onwheel = (e) => { e.preventDefault(); s = Math.min(8, Math.max(1, s * (e.deltaY < 0 ? 1.12 : 0.9))); if (s === 1) { tx = ty = 0; } apply(); };
  lb.onpointerdown = (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); lb.setPointerCapture(e.pointerId); if (pts.size === 1) drag = { x: e.clientX - tx, y: e.clientY - ty }; else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s }; } };
  lb.onpointermove = (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; s = Math.min(8, Math.max(1, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)); apply(); } else if (drag) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); } };
  lb.onpointerup = lb.onpointercancel = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; };
  img.ondblclick = () => { s = s > 1 ? 1 : 2.5; if (s === 1) { tx = ty = 0; } apply(); };
}

// ---------- homework checker UI ----------
export function homeworkHtml(hw) {
  const v = { correct: ['✅', 'green', 'Correct'], partial: ['🟡', 'amber', 'Partly right'], wrong: ['❌', 'red', 'Wrong'], blank: ['⬜', '', 'No answer'] };
  return `<div class="card mint hw-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h3>${icon('check')} Homework check <span class="ai-tag">${icon('sparkle')} AI</span></h3><div class="muted small">${hw.assignment ? esc(hw.assignment) + ' · ' : ''}checked ${ago(hw.checkedAt)} · ${plural(hw.items.length, 'problem')}${hw.doubleChecked ? ' · <span title="Anything marked wrong was re-read from your page and re-solved a second time before the final verdict">✓✓ double-checked</span>' : ''}</div></div>
      <div class="hw-score"><div class="score-ring" style="--p:${hw.score.percent};width:64px;height:64px"><div style="width:48px;height:48px;font-size:15px">${hw.score.percent}%</div></div><div class="small"><span class="chip green">${hw.score.correct} ✓</span> ${hw.score.partial ? `<span class="chip amber">${hw.score.partial} partly</span> ` : ''}${hw.score.wrong ? `<span class="chip red">${hw.score.wrong} ✗</span> ` : ''}${hw.score.blank ? `<span class="chip">${hw.score.blank} blank</span>` : ''}</div></div></div>
    ${hw.summary ? `<p style="margin:8px 0 4px">${esc(hw.summary)}</p>` : ''}
    <details class="hw-details" ${hw.items.some(i => i.verdict !== 'correct') ? 'open' : ''}><summary class="small" style="cursor:pointer;margin-top:8px">${hw.items.some(i => i.verdict !== 'correct') ? 'Problems and fixes' : 'Show all ' + hw.items.length + ' problems'}</summary><div class="hw-items">${hw.items.map(it => `<div class="hw-item ${it.verdict}"><div class="hw-n">${esc(it.n)}</div><div class="hw-body"><div class="hw-q">${mdi(it.problem)}</div><div class="small"><span class="muted">You wrote:</span> <b>${it.studentAnswer ? mdi(it.studentAnswer) : '<i class="muted">nothing</i>'}</b> <span class="chip ${v[it.verdict][1]}">${v[it.verdict][0]} ${v[it.verdict][2]}</span></div>${it.verdict !== 'correct' ? `<div class="hw-fix"><b>Correct answer:</b> ${mdi(it.correctAnswer)}${it.explanation ? `<div style="margin-top:3px">${mdi(it.explanation)}</div>` : ''}</div>` : ''}</div></div>`).join('')}</div></details>
    ${hw.tips?.length ? `<div class="hw-tips"><b>What to practice</b><ul>${hw.tips.map(t => `<li>${mdi(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="btn-row" style="margin-top:10px"><a class="btn sm primary" href="#/homework/${hw.pageId || ''}" id="openReport">${icon('check')} Full report</a><button class="btn sm" id="practiceSimilar">${icon('quiz')} Practice similar problems</button><button class="btn sm ghost" id="recheck">${icon('refresh')} Check again</button></div></div>`;
}
export function wireHomework(page, nb) {
  const or = $('#openReport'); if (or) or.href = '#/homework/' + page.id;
  const rc = $('#recheck'); if (rc) rc.onclick = () => checkHomework(page, nb);
  const ps = $('#practiceSimilar'); if (ps) ps.onclick = () => import('./study.js').then(m => m.testOnPage(page, nb));
}
export async function checkHomework(page, nb) {
  const m = modal(`<h2>Check my homework</h2><p class="muted small" style="margin:-6px 0 12px">AI reads every problem and your answer on this page, solves each one, and tells you what's right, what's off and why.</p>
    <div class="field"><label for="hwHint">Anything the AI should know? <span class="muted">(optional)</span></label><input class="input" id="hwHint" placeholder="e.g. it's a fractions worksheet, answers are in the right column, ignore question 5"></div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="goHw">${icon('check')} Check it</button></div>`);
  $('#goHw', m.el).onclick = async () => {
    busy($('#goHw', m.el), true, 'Reading and checking… (20–60s)');
    try {
      const hw = await api('/pages/' + page.id + '/check', { body: { hint: $('#hwHint', m.el).value.trim() } });
      page.homework = hw; m.close();
      go('#/homework/' + page.id);
      toast(`Checked: ${hw.score.percent}%`, 'ok');
    } catch (e) { toast(e.message, 'err'); busy($('#goHw', m.el), false); }
  };
}

// ---------- planner ----------
let calMonth = null;
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
async function plannerView(_, q) {
  const main = shell('Planner', loading());
  const seq = navId(); const evs = await loadEvents(true); if (stale(seq)) return;
  const today = todayISO();
  if (!calMonth) { const d = new Date(); calMonth = { y: d.getFullYear(), m: d.getMonth() }; }
  let selected = q.date || null; let view = localStorage.getItem('dwb_plan_view') || 'month';
  const draw = () => {
    const { y, m } = calMonth;
    const first = new Date(y, m, 1); const start = new Date(y, m, 1 - first.getDay());
    const cells = [];
    for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push({ d, iso: isoOf(d), other: d.getMonth() !== m }); }
    const byDate = {}; for (const e of evs) (byDate[e.date] ||= []).push(e);
    const upcoming = evs.filter(e => !e.done && e.date >= today);
    const past = evs.filter(e => e.done || e.date < today).sort((a, b) => b.date.localeCompare(a.date));
    const listDate = selected ? (byDate[selected] || []) : null;
    const week = []; for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() + i); const iso = isoOf(d); week.push({ d, iso, list: (byDate[iso] || []).filter(e => !e.done) }); }
    const agendaDays = []; for (let i = 0; i < 30; i++) { const d = new Date(); d.setDate(d.getDate() + i); const iso = isoOf(d); if (byDate[iso]?.length) agendaDays.push({ iso, list: byDate[iso] }); }
    const overdue = evs.filter(e => !e.done && e.date < today && (e.type === 'homework' || e.type === 'project'));
    main.innerHTML = `<div class="page-head"><div><h1>Planner</h1><div class="sub">Tests, quizzes, homework and due dates. Type them, scan your paper planner, or let scanned pages suggest them.</div></div><div class="btn-row"><button class="btn" id="planScan">${icon('camera')} Scan my planner</button><button class="btn primary" id="newEv">${icon('plus')} Add</button></div></div>
      <div class="quick-add"><span aria-hidden="true">✨</span><input class="input" id="quickAdd" placeholder="Quick add: “math test friday”, “science hw p.42 due tue”, “history project oct 3”…" aria-label="Quick add"><button class="btn primary sm" id="quickGo">Add</button></div>
      ${overdue.length ? `<div class="ai-status warn" style="margin-bottom:10px">${icon('clock')} ${plural(overdue.length, 'assignment')} past due and not marked done: ${overdue.slice(0, 3).map(e => `<b>${esc(e.title)}</b>`).join(', ')}${overdue.length > 3 ? '…' : ''}</div>` : ''}
      <div class="week-strip" role="tablist" aria-label="This week">${week.map(w => `<button class="ws ${w.iso === today ? 'today' : ''} ${w.iso === selected ? 'sel' : ''}" data-iso="${w.iso}" aria-label="${fmtDate(w.iso)}"><span class="wd">${DOW[w.d.getDay()]}</span><b>${w.d.getDate()}</b><span class="dots">${w.list.slice(0, 4).map(e => `<i class="t-${esc(e.type)}"></i>`).join('')}</span>${w.list.length ? `<span class="cnt">${w.list.length}</span>` : ''}</button>`).join('')}</div>
      <div class="btn-row" style="margin:10px 0"><div class="seg"><button id="vMonth" class="${view === 'month' ? 'active' : ''}">Month</button><button id="vAgenda" class="${view === 'agenda' ? 'active' : ''}">Agenda</button></div></div>
      <div class="planner">${view === 'month' ? `<div class="card">
        <div class="cal-head"><button class="btn icon ghost" id="pm" aria-label="Previous month">${icon('chevL')}</button><h2>${MONTHS[m]} ${y}</h2><div class="btn-row"><button class="btn sm ghost" id="tdy">Today</button><button class="btn icon ghost" id="nm" aria-label="Next month">${icon('chevR')}</button></div></div>
        <div class="cal">${DOW.map(d => `<div class="dow">${d}</div>`).join('')}${cells.map(c => { const list = byDate[c.iso] || []; return `<div class="day ${c.other ? 'other' : ''} ${c.iso === today ? 'today' : ''} ${c.iso === selected ? 'selected' : ''}" data-iso="${c.iso}" role="button" tabindex="0"><span class="n">${c.d.getDate()}</span>${list.slice(0, 3).map(e => `<span class="ev ${esc(e.type)} ${e.done ? 'done' : ''}">${esc(e.title)}</span>`).join('')}${list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : ''}<div class="dots">${list.map(e => `<i class="t-${esc(e.type)}"></i>`).join('')}</div></div>`; }).join('')}</div>
        <div class="chips" style="margin-top:12px">${Object.entries(TYPES).map(([k, v]) => `<span class="chip"><span class="type-dot t-${k}"></span>${v}</span>`).join('')}</div>
      </div>` : `<div class="card"><h3>Next 30 days</h3>${agendaDays.length ? agendaDays.map(g => `<div class="agenda-day"><div class="agenda-date ${g.iso === today ? 'today' : ''}">${g.iso === today ? 'Today · ' : ''}${fmtDate(g.iso)}</div>${g.list.map(eventRow).join('')}</div>`).join('') : '<p class="muted small">Nothing in the next 30 days. Add something above or scan your planner.</p>'}</div>`}
      <div>
        ${listDate ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${fmtDate(selected, { year: true })}</h3><button class="btn sm" id="addOn">${icon('plus')} Add here</button></div>${listDate.length ? listDate.map(eventRow).join('') : '<p class="muted small" style="margin:8px 0 0">Nothing on this day.</p>'}</div>` : ''}
        <div class="card"><h3>Upcoming</h3>${upcoming.length ? upcoming.map(eventRow).join('') : '<p class="muted small">Nothing coming up. Add your next test!</p>'}</div>
        ${past.length ? `<div class="card" style="margin-top:16px"><h3 class="muted">Past and done</h3>${past.slice(0, 8).map(eventRow).join('')}</div>` : ''}
      </div></div>`;
    const pm = $('#pm'); if (pm) { pm.onclick = () => { calMonth.m--; if (calMonth.m < 0) { calMonth.m = 11; calMonth.y--; } draw(); }; $('#nm').onclick = () => { calMonth.m++; if (calMonth.m > 11) { calMonth.m = 0; calMonth.y++; } draw(); }; $('#tdy').onclick = () => { const d = new Date(); calMonth = { y: d.getFullYear(), m: d.getMonth() }; selected = today; draw(); }; }
    $('#vMonth').onclick = () => { view = 'month'; localStorage.setItem('dwb_plan_view', view); draw(); };
    $('#vAgenda').onclick = () => { view = 'agenda'; localStorage.setItem('dwb_plan_view', view); draw(); };
    $('#newEv').onclick = () => eventModal(null, selected || today);
    if ($('#addOn')) $('#addOn').onclick = () => eventModal(null, selected);
    $$('.cal .day, .week-strip .ws').forEach(d => { d.onclick = () => { selected = d.dataset.iso; draw(); }; d.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.click(); } }; });
    $('#quickAdd').onkeydown = (e) => { if (e.key === 'Enter') $('#quickGo').click(); };
    $('#quickGo').onclick = async () => { const t = $('#quickAdd').value.trim(); if (!t) return; busy($('#quickGo'), true, '…'); try { const ev = await api('/planner/parse', { body: { text: t } }); eventModal(null, ev.date, { title: ev.title, type: ev.type, subject: ev.subject, notes: ev.notes }); $('#quickAdd').value = ''; } catch (e) { toast(e.message, 'err'); } busy($('#quickGo'), false); };
    $('#planScan').onclick = () => go('#/scan?planner=1');
    wireEventRows(main);
  };
  draw();
  setKeys((e) => { if (e.key === 'n' && !e.target.closest('input,textarea')) { e.preventDefault(); $('#newEv')?.click(); } });
  if (q.new) eventModal(null, q.date || today);
}
// Review extracted planner items → add selected.
export function reviewPlannerItems(items, onAdded) {
  if (!items.length) return toast("Couldn't find any dated items in that photo. Try a closer, straight-on photo.", 'err');
  const mm = modal(`<h2>Found ${plural(items.length, 'item')}</h2><p class="muted small" style="margin:-6px 0 10px">Check the ones to add. Fix a date or title right here if the AI got it wrong.</p>
    <div class="plan-review">${items.map((it, i) => `<div class="pr-row"><input type="checkbox" class="prc" data-i="${i}" ${it.date ? 'checked' : ''} aria-label="Include"><input class="input prt" data-i="${i}" value="${esc(it.title)}" aria-label="Title"><select class="prk" data-i="${i}" aria-label="Type">${Object.entries(TYPES).filter(([k]) => k !== 'other').map(([k, v]) => `<option value="${k}" ${it.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select><input type="date" class="prd" data-i="${i}" value="${it.date || ''}" title="${esc(it.dateText || '')}" aria-label="Date"></div>${!it.date ? `<div class="small muted" style="margin:-4px 0 6px 28px">Date unclear (“${esc(it.dateText || '?')}”). Pick one to include it.</div>` : ''}`).join('')}</div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="addAll">${icon('plus')} Add selected</button></div>`, { wide: true });
  $('#addAll', mm.el).onclick = async () => {
    const picked = [];
    $$('.prc', mm.el).forEach(c => { if (!c.checked) return; const i = +c.dataset.i; const date = $(`.prd[data-i="${i}"]`, mm.el).value; if (!date) return; picked.push({ ...items[i], title: $(`.prt[data-i="${i}"]`, mm.el).value.trim() || items[i].title, type: $(`.prk[data-i="${i}"]`, mm.el).value, date }); });
    if (!picked.length) return toast('Pick at least one item with a date', 'err');
    busy($('#addAll', mm.el), true, 'Adding…');
    const r = await api('/events/bulk', { body: { items: picked } });
    invalidate(); mm.close(); toast(`Added ${r.added} to your planner 🎉`, 'ok'); if (onAdded) onAdded(r); else dispatch(); nudgeReminders();
  };
}
export async function eventModal(ev, date, pre = {}) {
  const isNew = !ev; ev = ev || { title: pre.title || '', type: pre.type || 'test', subject: pre.subject || '', date: date || todayISO(), time: '', notes: pre.notes || '', notebookId: pre.notebookId || '', subtasks: [] };
  const nbs = await loadNotebooks();
  let subtasks = (ev.subtasks || []).map(s => ({ ...s }));
  const m = modal(`<h2>${isNew ? 'Add to planner' : 'Edit'}</h2>
    <div class="field"><label for="evTitle">What is it?</label><input type="text" id="evTitle" value="${esc(ev.title)}" placeholder="e.g. Chapter 5 test — cells"></div>
    <div class="row"><div class="field"><label for="evType">Type</label><select id="evType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === ev.type ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label for="evSubject">Subject</label><input type="text" id="evSubject" list="subjects" value="${esc(ev.subject)}" placeholder="e.g. Biology"><datalist id="subjects">${[...new Set(nbs.map(n => n.subject).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('')}</datalist></div></div>
    <div class="row"><div class="field"><label for="evDate">Date</label><input type="date" id="evDate" value="${esc(ev.date)}"></div><div class="field"><label for="evTime">Time (optional)</label><input type="time" id="evTime" value="${esc(ev.time || '')}"></div></div>
    <div class="field"><label for="evNb">Notebook (for studying)</label><select id="evNb"><option value="">— none —</option>${nbs.map(n => `<option value="${n.id}" ${n.id === ev.notebookId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="evNotes">Notes</label><textarea id="evNotes" placeholder="What's on it? Chapters, topics, what the teacher said…">${esc(ev.notes || '')}</textarea></div>
    <div class="field"><div style="display:flex;justify-content:space-between;align-items:center"><label>Steps</label>${!isNew ? `<button type="button" class="btn sm ghost" id="breakdown">${icon('wand')} Break it down with AI</button>` : ''}</div><div class="subtasks" id="subtasks"></div><div class="row" style="margin-top:6px"><input class="input" id="stNew" placeholder="Add a step…" aria-label="New step"><button type="button" class="btn sm" id="stAdd" style="flex:0">Add</button></div><div class="help">${isNew ? 'Save first, then “Break it down with AI” can plan the steps for you.' : 'Check steps off as you go. Progress shows on the planner.'}</div></div>
    <div class="actions">${!isNew ? `<button class="btn danger" id="del" style="margin-right:auto" aria-label="Delete">${icon('trash')}</button><button class="btn" id="done">${ev.done ? 'Mark not done' : icon('check') + ' Mark done'}</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="save">${isNew ? 'Add' : 'Save'}</button></div>`);
  const el = m.el;
  const drawSt = () => { $('#subtasks', el).innerHTML = subtasks.map((s, i) => `<label class="${s.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${s.done ? 'checked' : ''}><span>${esc(s.text)}</span><small>${s.minutes ? fmtMin(s.minutes) : ''}</small><button type="button" class="btn icon sm ghost rmSt" data-i="${i}" aria-label="Remove step">${icon('x')}</button></label>`).join('') || '<span class="muted small">No steps yet.</span>'; $$('#subtasks input', el).forEach(c => c.onchange = () => { subtasks[+c.dataset.i].done = c.checked; drawSt(); }); $$('.rmSt', el).forEach(b => b.onclick = () => { subtasks.splice(+b.dataset.i, 1); drawSt(); }); };
  drawSt();
  $('#stAdd', el).onclick = () => { const v = $('#stNew', el).value.trim(); if (!v) return; subtasks.push({ text: v, minutes: 15, done: false }); $('#stNew', el).value = ''; drawSt(); };
  $('#stNew', el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#stAdd', el).click(); } };
  const bd = $('#breakdown', el); if (bd) bd.onclick = async () => { busy(bd, true, 'Planning…'); try { const r = await api('/events/' + ev.id + '/breakdown', { body: {} }); subtasks = r.subtasks; drawSt(); } catch (e) { toast(e.message, 'err'); } busy(bd, false); };
  $('#evTitle', el).onkeydown = (e) => { if (e.key === 'Enter') $('#save', el).click(); };
  $('#save', el).onclick = async () => {
    const body = { title: $('#evTitle', el).value.trim(), type: $('#evType', el).value, subject: $('#evSubject', el).value.trim(), date: $('#evDate', el).value, time: $('#evTime', el).value, notes: $('#evNotes', el).value, notebookId: $('#evNb', el).value || null, subtasks };
    if (!body.title || !body.date) return toast('Add a title and a date', 'err');
    try {
      if (isNew) { const created = await api('/events', { body }); if (subtasks.length) await api.patch('/events/' + created.id, { subtasks }); invalidate(); m.close(); toast('Added to planner', 'ok'); if (pre.onSaved) pre.onSaved(created); nudgeReminders(); if ((body.type === 'test' || body.type === 'quiz') && daysUntil(body.date) >= 0) { if (await confirm('Start a study set?', `Want WorkBook to build a study sheet, practice test and flashcards for “${body.title}”?`, { danger: false, ok: 'Yes, let’s study' })) return go('#/study?new=1&event=' + created.id); } dispatch(); }
      else { await api.patch('/events/' + ev.id, body); invalidate(); m.close(); dispatch(); }
    } catch (e) { toast(e.message, 'err'); }
  };
  if (!isNew) {
    $('#del', el).onclick = async () => { await api.del('/events/' + ev.id); invalidate(); m.close(); dispatch(); };
    $('#done', el).onclick = async () => { await api.patch('/events/' + ev.id, { done: !ev.done }); invalidate(); m.close(); dispatch(); if (!ev.done) toast('Done ✓', 'ok'); };
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
async function settingsView(_, q = {}) {
  const main = shell('', loading());
  const seq = navId();
  const [st, trash, smsHtml] = await Promise.all([pushStatus(), api('/trash').catch(() => ({ items: [], days: 30 })), import('./extras.js').then(m => m.smsSettingsHtml())]);
  if (stale(seq)) return;
  const S = settings(); const prefs = S.reminders || {};
  const theme = getTheme();
  const seg = (id, opts, cur) => `<div class="seg" id="${id}" role="radiogroup">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${cur === v ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  const tog = (key, label, help, on) => `<label class="toggle"><span><b>${label}</b>${help ? `<small>${help}</small>` : ''}</span><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><i></i></label>`;
  const sections = [['look', 'Appearance', 'palette'], ['scan', 'Scanning', 'camera'], ['study', 'Studying', 'study'], ['plan', 'Planner', 'calendar'], ['remind', 'Reminders', 'bell'], ['grades', 'Grades', 'grades'], ['data', 'Your data', 'shield'], ['account', 'Account', 'key']];
  main.innerHTML = `<div class="page-head"><div><h1>Settings</h1><div class="sub">Saved to your account, so every device you log in on looks and behaves the same.</div></div></div>
    <div class="settings-layout">
    <nav class="settings-nav" aria-label="Settings sections">${sections.map(([id, l, ic]) => `<a href="#/settings?s=${id}" data-s="${id}" class="${(q.s || 'look') === id ? 'active' : ''}">${icon(ic)}${l}</a>`).join('')}</nav>
    <div class="settings-body">
    <section class="card set-sec" id="s-look"><h3>${icon('palette')} Appearance</h3>
      <div class="set-row"><div><b>Theme</b><small>Auto follows your device. “Dark at night” is dark from 7pm to 7am.</small></div>${seg('themeSeg', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['schedule', 'Dark at night']], theme)}</div>
      <div class="set-row"><div><b>Accent color</b><small>Buttons, links and highlights.</small></div><div class="swatches">${Object.entries(ACCENTS).map(([k, v]) => `<div class="swatch ${(S.accent || 'blue') === k ? 'active' : ''}" data-accent="${k}" style="--c:${v}" role="radio" tabindex="0" aria-label="${k}"></div>`).join('')}</div></div>
      <div class="set-row"><div><b>Text size</b></div>${seg('sizeSeg', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']], S.fontSize || 'normal')}</div>
      ${tog('reduceMotion', 'Reduce motion', 'Turns off page and card animations.', !!S.reduceMotion)}
      ${tog('compact', 'Compact layout', 'Tighter spacing, more on screen.', !!S.compact)}
    </section>
    <section class="card set-sec" id="s-scan"><h3>${icon('camera')} Scanning</h3>
      <div class="set-row"><div><b>Default look</b><small>Applied to new scans. Change any page later with Adjust.</small></div><select class="input sm" data-set="scanFilter" style="width:auto"><option value="enhanced" ${(S.scanFilter || 'enhanced') === 'enhanced' ? 'selected' : ''}>Enhanced (keeps pen colors)</option><option value="color" ${S.scanFilter === 'color' ? 'selected' : ''}>Soft color</option><option value="gray" ${S.scanFilter === 'gray' ? 'selected' : ''}>Grayscale</option><option value="bw" ${S.scanFilter === 'bw' ? 'selected' : ''}>Black and white</option><option value="original" ${S.scanFilter === 'original' ? 'selected' : ''}>Original</option></select></div>
      <div class="set-row"><div><b>Readability boost</b><small>Sharpens and upscales soft photos so the AI reads them better.</small></div>${seg('boostSeg', [['0', 'Off'], ['1', 'Auto'], ['2', 'Strong']], String(S.scanBoost ?? 1))}</div>
      ${tog('cornerDetect', 'Find page edges automatically', 'AI crops and straightens each snap. Off = full photo, faster.', S.cornerDetect !== false)}
      ${tog('autoRead', 'Read pages right after scanning', 'Off = pages are saved only; read them later with Re-read.', S.autoRead !== false)}
      <div class="set-row"><div><b>Auto-sort into notebooks</b><small>After a page is read, WorkBook matches its subject to a notebook. <a href="#/inbox">Open the Inbox</a>.</small></div>${seg('sortSeg', [['ask', 'Ask me'], ['auto', 'Automatic'], ['off', 'Off']], S.autoSort || 'ask')}</div>
    </section>
    <section class="card set-sec" id="s-study"><h3>${icon('study')} Studying</h3>
      <div class="set-row"><div><b>Review session size</b><small>How many due cards a Review session pulls at once.</small></div>${seg('reviewSeg', [['20', '20'], ['40', '40'], ['80', '80']], String(S.reviewLimit || 40))}</div>
      <div class="set-row"><div><b>Default test setup</b><small>Pre-selected when you open the test maker.</small></div><select class="input sm" data-set="testPreset" style="width:auto"><option value="last" ${(S.testPreset || 'last') === 'last' ? 'selected' : ''}>Same as last time</option><option value="quick" ${S.testPreset === 'quick' ? 'selected' : ''}>Quick 10</option><option value="full" ${S.testPreset === 'full' ? 'selected' : ''}>Full test</option><option value="hard" ${S.testPreset === 'hard' ? 'selected' : ''}>Hard mode</option></select></div>
      ${tog('speakAnswers', 'Read tutor answers aloud', 'The tutor and page chat speak their replies.', !!S.speakAnswers)}
      <div class="set-row"><div><b>Voice speed</b><small id="rateLbl">${(S.speakRate || 1).toFixed(1)}×</small></div><input type="range" id="rate" min="0.7" max="1.5" step="0.1" value="${S.speakRate || 1}" style="width:180px"></div>
      ${tog('showHints', 'Hints on by default', 'Practice tests start with hints available.', S.showHints !== false)}
    </section>
    <section class="card set-sec" id="s-plan"><h3>${icon('calendar')} Planner</h3>
      <div class="set-row"><div><b>Week starts on</b></div>${seg('weekSeg', [['sun', 'Sunday'], ['mon', 'Monday']], S.weekStart || 'sun')}</div>
      <div class="set-row"><div><b>Default item type</b><small>When you tap Add.</small></div><select class="input sm" data-set="defaultEventType" style="width:auto">${Object.entries(TYPES).filter(([k]) => k !== 'other').map(([k, v]) => `<option value="${k}" ${(S.defaultEventType || 'test') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="set-row"><div><b>Study plan minutes per day</b><small>Default when you build a plan.</small></div>${seg('ppdSeg', [['20', '20'], ['30', '30'], ['45', '45'], ['60', '60']], String(S.planMinutes || 30))}</div>
      ${tog('confirmStudySet', 'Offer a study set after adding a test', '', S.confirmStudySet !== false)}
    </section>
    <section class="card set-sec" id="s-remind"><h3>${icon('bell')} Reminders</h3>
      <p class="small muted" style="margin:0 0 10px">Pings this device: <b>3 days before</b> a test (4pm), <b>the day before</b> (6pm), <b>the morning of</b> (7am). Homework and projects: day before + day of. Flashcards: 4pm when 8+ are due.</p>
      <div id="pushBox">${st.enabled ? `<div class="ai-status" style="background:var(--green-soft);color:var(--green)">✅ Reminders are on for this device</div><div class="btn-row" style="margin-top:10px"><button class="btn sm" id="pushTest">Send a test notification</button><button class="btn sm danger" id="pushOff">Turn off</button></div>` : `<button class="btn primary" id="pushOn">${icon('bell')} Turn on reminders on this device</button>${isIOS() && !isStandalone() ? '<div class="small muted" style="margin-top:8px">📱 On iPhone/iPad: tap <b>Share → Add to Home Screen</b>, open WorkBook from there, then tap this button.</div>' : ''}${!pushSupported() && !isIOS() ? '<div class="small muted" style="margin-top:8px">This browser doesn’t support notifications.</div>' : ''}`}</div>
      <div style="margin-top:12px" class="small"><b>Which reminders</b><div class="btn-row" style="margin-top:6px"><label class="chip tchip"><input type="checkbox" class="rp" data-k="d3" ${prefs.d3 === false ? '' : 'checked'}> 3 days before</label><label class="chip tchip"><input type="checkbox" class="rp" data-k="d1" ${prefs.d1 === false ? '' : 'checked'}> Day before</label><label class="chip tchip"><input type="checkbox" class="rp" data-k="d0" ${prefs.d0 === false ? '' : 'checked'}> Morning of</label><label class="chip tchip"><input type="checkbox" class="rp" data-k="review" ${prefs.review === false ? '' : 'checked'}> Flashcards due</label><label class="chip tchip"><input type="checkbox" class="rp" data-k="weekly" ${prefs.weekly === false ? '' : 'checked'}> Weekly summary</label></div></div>
      <div id="smsBox">${smsHtml}</div>
    </section>
    <section class="card set-sec" id="s-grades"><h3>${icon('grades')} Grades</h3>
      <div class="set-row"><div><b>Letter scale for new classes</b></div>${seg('scaleSeg', [['plusminus', 'A− / B+'], ['standard', 'A B C D F']], S.gradeScale || 'plusminus')}</div>
      <div class="set-row"><div><b>Target grade for new classes</b><small id="targetLbl">${S.gradeTarget || 90}%</small></div><input type="range" id="target" min="60" max="100" value="${S.gradeTarget || 90}" style="width:180px"></div>
    </section>
    <section class="card set-sec" id="s-data"><h3>${icon('shield')} Your data</h3>
      <div class="set-row"><div><b>Export everything</b><small>One JSON file with notebooks, digital copies, planner, study sets and grades (no photos).</small></div><a class="btn sm" href="/api/export" download>${icon('download')} Download</a></div>
      <div class="set-row"><div><b>Trash</b><small>Deleted pages and notebooks, kept ${trash.days} days.</small></div><span class="chip">${plural(trash.items.length, 'item')}</span></div>
      ${trash.items.length ? `<div id="trashList">${trash.items.map(t => `<div class="trash-row" data-id="${t.id}"><div class="rthumb" style="background-image:url('/api/pages/${t.pageId}/image?kind=thumb&r=${t.rev}')"></div><div><b><span class="nb-dot color-${esc(t.color)}"></span>${esc(t.title)}</b><span class="muted small">${t.kind === 'page' ? 'page from ' : ''}${esc(t.sub)} · deleted ${ago(t.deletedAt)}</span></div><button class="btn sm restore">${icon('restore')} Restore</button><button class="btn icon sm ghost purge" aria-label="Delete forever">${icon('x')}</button></div>`).join('')}</div><div class="btn-row" style="margin-top:10px"><button class="btn sm danger" id="emptyTrash">Empty trash</button></div>` : ''}
      <div class="set-row" style="margin-top:8px"><div><b style="color:var(--red)">Delete account</b><small>Removes everything for good.</small></div><button class="btn sm danger" id="delAcct">Delete…</button></div>
    </section>
    <section class="card set-sec" id="s-account"><h3>${icon('key')} Account</h3>
      <div class="row"><div class="field"><label for="sName">Name</label><input type="text" id="sName" value="${esc(state.user.name || '')}"></div><div class="field"><label for="sUser">Username</label><input type="text" id="sUser" value="${esc(state.user.username)}" disabled></div></div><button class="btn" id="saveP">Save name</button>
      <h3 style="margin-top:18px">${icon('lock')} Password</h3><div class="row"><div class="field"><label for="pwCur">Current</label><input type="password" id="pwCur" autocomplete="current-password"></div><div class="field"><label for="pwNew">New</label><input type="password" id="pwNew" autocomplete="new-password"></div><div class="field"><label for="pwNew2">Again</label><input type="password" id="pwNew2" autocomplete="new-password"></div></div><button class="btn" id="savePw">Change password</button><div class="help" style="margin-top:6px">Other devices get logged out.</div>
      <div class="set-row" style="margin-top:16px"><div><b>AI</b><small>${esc({ anthropic: 'Anthropic API (Claude)', openai: 'Tanzu GenAI (platform models)', cli: 'local Claude Code CLI', none: 'not configured' }[state.ai?.mode] || state.ai?.mode || '')} · ${esc(state.ai?.model || '')}${state.ai?.webSearch ? ' · live web search on' : ''}</small></div></div>
      <div class="btn-row" style="margin-top:10px"><button class="btn" id="shortcuts">${icon('key')} Keyboard shortcuts</button><button class="btn" id="logoutAll">${icon('logout')} Log out everywhere</button><button class="btn" id="logout">${icon('logout')} Log out</button></div>
    </section>
    </div></div>`;
  // section nav (scroll on desktop, jump on phone)
  $$('.settings-nav a').forEach(a => a.onclick = (e) => { e.preventDefault(); $$('.settings-nav a').forEach(x => x.classList.toggle('active', x === a)); $('#s-' + a.dataset.s)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', '#/settings?s=' + a.dataset.s); });
  if (q.s && q.s !== 'look') setTimeout(() => $('#s-' + q.s)?.scrollIntoView({ block: 'start' }), 50);
  const segs = { themeSeg: (v) => { setTheme(v); const tb = $('#themeBtn'); if (tb) tb.innerHTML = `${icon(isDark() ? 'sun' : 'moon')} ${themeLabel()}`; }, sizeSeg: (v) => saveSettings({ fontSize: v }), boostSeg: (v) => saveSettings({ scanBoost: +v }), sortSeg: (v) => saveSettings({ autoSort: v }), reviewSeg: (v) => saveSettings({ reviewLimit: +v }), weekSeg: (v) => saveSettings({ weekStart: v }), ppdSeg: (v) => saveSettings({ planMinutes: +v }), scaleSeg: (v) => saveSettings({ gradeScale: v }) };
  for (const [id, fn] of Object.entries(segs)) $$('#' + id + ' button').forEach(b => b.onclick = async () => { $$('#' + id + ' button').forEach(x => x.classList.toggle('active', x === b)); try { await fn(b.dataset.v); } catch (e) { toast(e.message, 'err'); } });
  $$('[data-set]').forEach(el => el.onchange = async () => { try { await saveSettings({ [el.dataset.set]: el.type === 'checkbox' ? el.checked : el.value }); } catch (e) { toast(e.message, 'err'); } });
  $$('.swatch[data-accent]').forEach(s => { const pick = async () => { $$('.swatch[data-accent]').forEach(x => x.classList.toggle('active', x === s)); await saveSettings({ accent: s.dataset.accent }); }; s.onclick = pick; s.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(); } }; });
  let rt; $('#rate').oninput = () => { $('#rateLbl').textContent = (+$('#rate').value).toFixed(1) + '×'; clearTimeout(rt); rt = setTimeout(() => saveSettings({ speakRate: +$('#rate').value }), 400); };
  let tt; $('#target').oninput = () => { $('#targetLbl').textContent = $('#target').value + '%'; clearTimeout(tt); tt = setTimeout(() => saveSettings({ gradeTarget: +$('#target').value }), 400); };
  $('#saveP').onclick = async () => { const r = await api.patch('/me', { name: $('#sName').value }); state.user = r.user; shell.reset(); toast('Saved', 'ok'); settingsView({}, { s: 'account' }); };
  $('#savePw').onclick = async () => { const a = $('#pwNew').value, b = $('#pwNew2').value; if (a !== b) return toast('The new passwords don’t match', 'err'); busy($('#savePw'), true, 'Changing…'); try { await api('/auth/password', { body: { current: $('#pwCur').value, password: a } }); toast('Password changed', 'ok'); $('#pwCur').value = $('#pwNew').value = $('#pwNew2').value = ''; } catch (e) { toast(e.message, 'err'); } busy($('#savePw'), false); };
  $('#logout').onclick = async () => { await api('/auth/logout', { body: {} }); state.user = null; invalidate(); localStorage.removeItem('dwb_last_user'); go('#/login'); };
  $('#logoutAll').onclick = async () => { if (await confirm('Log out everywhere?', 'Every other phone or computer signed into this account gets logged out. This one stays.', { danger: false, ok: 'Log out others' })) { await api('/auth/logout-all', { body: {} }); toast('Other devices logged out', 'ok'); } };
  $('#shortcuts').onclick = () => import('./palette.js').then(m => m.shortcutsHelp());
  $('#delAcct').onclick = () => { const m = modal(`<h2>Delete your account?</h2><p class="muted">Every notebook, page, study set, plan and grade is deleted for good. Type your password to confirm.</p><div class="field"><label for="delPw">Password</label><input type="password" id="delPw" autocomplete="current-password"></div><div class="actions"><button class="btn" data-close>Keep my account</button><button class="btn danger" id="delGo">Delete everything</button></div>`); $('#delGo', m.el).onclick = async () => { busy($('#delGo', m.el), true, 'Deleting…'); try { await api('/me', { method: 'DELETE', body: { password: $('#delPw', m.el).value } }); state.user = null; invalidate(); localStorage.removeItem('dwb_last_user'); m.close(); go('#/register'); toast('Account deleted'); } catch (e) { toast(e.message, 'err'); busy($('#delGo', m.el), false); } }; };
  const on = $('#pushOn'); if (on) on.onclick = async () => { busy(on, true, 'Turning on…'); try { await enablePush(); toast('Reminders on 🎉', 'ok'); settingsView({}, { s: 'remind' }); } catch (e) { toast(e.message, 'err'); busy(on, false); } };
  const off = $('#pushOff'); if (off) off.onclick = async () => { await disablePush(); toast('Reminders off'); settingsView({}, { s: 'remind' }); };
  const tp = $('#pushTest'); if (tp) tp.onclick = () => testPush();
  (await import('./extras.js')).wireSms(() => settingsView({}, { s: 'remind' }));
  $$('.rp').forEach(c => c.onchange = async () => { const rem = { ...(settings().reminders || {}) }; rem[c.dataset.k] = c.checked; await saveSettings({ reminders: rem }); });
  $$('.trash-row').forEach(row => { $('.restore', row).onclick = async () => { try { const r = await api('/trash/' + row.dataset.id + '/restore', { body: {} }); invalidate(); toast('Restored', 'ok'); if (r.kind === 'page') go('#/page/' + r.pageId); else go('#/notebook/' + r.notebookId); } catch (e) { toast(e.message, 'err'); } }; $('.purge', row).onclick = async () => { if (await confirm('Delete forever?', 'This cannot be undone.')) { await api.del('/trash/' + row.dataset.id); row.remove(); } }; });
  const et = $('#emptyTrash'); if (et) et.onclick = async () => { if (await confirm('Empty the trash?', 'Everything in it is deleted for good.', { ok: 'Empty trash' })) { await api.del('/trash'); settingsView({}, { s: 'data' }); } };
}

// ---------- routes (heavy screens are loaded on demand) ----------
route('/login', () => authView('login'));
route('/register', () => authView('register'));
route('/', homeView);
route('/notebooks', notebooksView);
route('/notebook/:id', notebookView);
route('/page/:id', pageView);
route('/book/:id', lazy('./book.js', 'bookView'));
route('/scan', (p, q) => import('./scan.js').then(m => m.scanView({}, q)));
route('/scan/:id', lazy('./scan.js', 'scanView'));
route('/planner', plannerView);
route('/study', lazy('./study.js', 'studyListView'));
route('/study/:id', lazy('./study.js', 'studyView'));
route('/review', lazy('./review.js', 'reviewView'));
route('/homework', lazy('./homework.js', 'homeworkView'));
route('/homework/:id', lazy('./homework.js', 'homeworkReportView'));
route('/friends', lazy('./friends.js', 'friendsView'));
route('/week', lazy('./week.js', 'weekView'));
route('/inbox', lazy('./inbox.js', 'inboxView'));
route('/topics', lazy('./topics.js', 'topicsView'));
route('/grades', lazy('./grades.js', 'gradesView'));
route('/settings', settingsView);
route('/progress', lazy('./extras.js', 'progressView'));
route('/s/:token', lazy('./extras.js', 'sharedView'));

// auto-update: when a new version is deployed, reload on the next navigation (never mid-scan)
let BUILD = null;
async function checkVersion() {
  try { const r = await fetch('/api/version', { cache: 'no-store' }).then(r => r.json()); if (BUILD && r.v !== BUILD) { const busyScan = location.hash.startsWith('#/scan') && document.querySelector('.tray-item:not(.ready):not(.error)'); if (!busyScan) { toast('Updating to the newest WorkBook…'); setTimeout(() => location.reload(), 600); } } else if (!BUILD) BUILD = r.v; } catch {}
}
async function boot() {
  try { const r = await api('/me'); state.user = r.user; state.ai = r.ai; BUILD = r.v || null; } catch {}
  applySettings();
  registerSW();
  setInterval(checkVersion, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
  const guard = async () => {
    const hash = location.hash || '#/';
    if (!state.user && !/^#\/(login|register|s\/)/.test(hash)) { return authView(hash === '#/register' ? 'register' : 'login'); }
    if (state.user && /^#\/(login|register)/.test(hash)) return go('#/');
    await dispatch();
  };
  window.addEventListener('hashchange', guard);
  guard();
}
boot();
