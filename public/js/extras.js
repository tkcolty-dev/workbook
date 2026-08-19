// Extras: progress & streaks, sharing, cram mode, voice tutor helpers, focus timer, SMS settings.
import { state, api, stream, $, $$, esc, h, md, mdi, mdPage, hydrateFigures, icon, toast, modal, confirm, busy, fmtDate, countdown, daysUntil, ago, loadNotebooks, invalidate, go, dispatch, render } from './core.js';

// ---------- progress ----------
export async function progressView() {
  const { shell } = await import('./app.js');
  const main = shell('Progress', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const p = await api('/progress');
  const days = []; for (let i = 83; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); days.push(d); }
  const val = (d) => { const a = p.activity[d]; return a ? Object.values(a).reduce((x, y) => x + y, 0) : 0; };
  const max = Math.max(1, ...days.map(val));
  const week = days.slice(-7); const weekPages = week.reduce((s, d) => s + (p.activity[d]?.scan || 0), 0), weekTests = week.reduce((s, d) => s + (p.activity[d]?.test || 0), 0), weekCards = week.reduce((s, d) => s + (p.activity[d]?.cards || 0), 0);
  const recentTests = p.tests.slice(-12);
  const spark = recentTests.length ? `<svg viewBox="0 0 ${Math.max(1, recentTests.length - 1) * 30 + 10} 60" class="spark"><polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="${recentTests.map((t, i) => `${5 + i * 30},${55 - t.percent * 0.5}`).join(' ')}"/>${recentTests.map((t, i) => `<circle cx="${5 + i * 30}" cy="${55 - t.percent * 0.5}" r="3.5" fill="${t.percent >= 75 ? 'var(--green)' : t.percent >= 50 ? 'var(--amber)' : 'var(--red)'}"><title>${esc(t.test)} · ${t.percent}%</title></circle>`).join('')}</svg>` : '<div class="muted small">Take a practice test to see your scores here.</div>';
  main.innerHTML = `<div class="page-head"><div><h1>Progress</h1><div class="sub">Your study streak, scores and activity.</div></div></div>
    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card stat-card"><div class="big-num">${p.streak}🔥</div><div class="muted">day streak${p.best > p.streak ? ` · best ${p.best}` : ''}</div><div class="small muted">${p.streak ? 'Keep it going — scan, study or test today.' : 'Do anything today to start a streak.'}</div></div>
      <div class="card stat-card"><div class="big-num">${p.tests.length ? Math.round(p.tests.slice(-10).reduce((s, t) => s + t.percent, 0) / Math.min(10, p.tests.length)) + '%' : '—'}</div><div class="muted">avg of last 10 tests</div><div class="small muted">${p.tests.length} test${p.tests.length === 1 ? '' : 's'} taken</div></div>
      <div class="card stat-card"><div class="big-num">${p.cards.total ? Math.round(100 * p.cards.known / p.cards.total) + '%' : '—'}</div><div class="muted">flashcards known</div><div class="small muted">${p.cards.known} of ${p.cards.total} cards</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Last 12 weeks</h3><div class="heat">${days.map(d => `<i style="--v:${val(d) / max}" title="${d}: ${val(d)} activities"></i>`).join('')}</div><div class="small muted" style="margin-top:8px">This week: <b>${weekPages}</b> pages scanned · <b>${weekTests}</b> tests · <b>${weekCards}</b> flashcard sessions</div></div>
      <div class="card"><h3>Test scores</h3>${spark}${Object.keys(p.bySubject).length ? `<div class="chips" style="margin-top:10px">${Object.entries(p.bySubject).map(([k, v]) => `<span class="chip ${Math.round(v.sum / v.n) >= 75 ? 'green' : Math.round(v.sum / v.n) >= 50 ? 'amber' : 'red'}">${esc(k)}: avg ${Math.round(v.sum / v.n)}% · last ${v.last}%</span>`).join('')}</div>` : ''}</div>
    </div>
    ${p.upcoming.length ? `<div class="card" style="margin-top:16px"><h3>Coming up</h3>${p.upcoming.map(e => `<div class="event-row"><div class="info"><b>${esc(e.title)}</b><span>${fmtDate(e.date)} · ${countdown(e.date)}</span></div>${e.studyId ? `<a class="btn sm" href="#/study/${e.studyId}">Study</a>` : `<a class="btn sm" href="#/study?new=1&event=${e.id}">Make study set</a>`}</div>`).join('')}</div>` : ''}`;
}

// ---------- sharing ----------
export async function shareThing(kind, id, title) {
  const r = await api('/share', { body: { kind, id } });
  const m = modal(`<h2>Share “${esc(title)}”</h2><p class="muted small">Anyone with this link can view it (read-only) — pages and digital copies for a notebook; study sheet, flashcards and practice tests for a study set. No login needed.</p>
    <div class="field"><input class="input" id="shUrl" value="${esc(r.url)}" readonly onclick="this.select()"></div>
    <div class="actions" style="justify-content:space-between"><button class="btn danger sm" id="shOff">Stop sharing</button><div class="btn-row"><button class="btn" data-close>Close</button><button class="btn primary" id="shCopy">${icon('check')} Copy link</button></div></div>`);
  $('#shCopy', m.el).onclick = async () => { try { await navigator.clipboard.writeText(r.url); toast('Link copied', 'ok'); } catch { $('#shUrl', m.el).select(); document.execCommand('copy'); toast('Link copied', 'ok'); } if (navigator.share) navigator.share({ title, url: r.url }).catch(() => {}); };
  $('#shOff', m.el).onclick = async () => { await api.del('/share/' + r.token); toast('Link turned off'); m.close(); };
}
export async function sharedView({ token }) {
  let data;
  try { data = await api('/shared/' + token); } catch (e) { render(`<div class="auth-main" style="min-height:100vh"><div class="empty"><div class="big">🔗</div><h3>This link isn't valid anymore</h3><p>${esc(e.message)}</p><a class="btn" href="#/">Open WorkBook</a></div></div>`); return; }
  const img = (pid, kind = 'enh', rev = 0) => `/api/shared/${token}/image/${pid}?kind=${kind}&r=${rev}`;
  const head = (title, sub) => `<div class="shared-head"><a class="brand" href="#/" style="text-decoration:none;color:inherit">${icon('book')}<b>WorkBook</b></a><div><h1 style="font-size:24px">${esc(title)}</h1><div class="muted small">${esc(sub)} · shared by ${esc(data.by || 'a student')}</div></div><a class="btn primary sm" href="#/">${state.user ? 'My WorkBook' : 'Make your own'}</a></div>`;
  if (data.kind === 'notebook') {
    const nb = data.notebook;
    render(`<div class="shared">${head(nb.name, (nb.subject || 'Notebook') + ' · ' + nb.pages.length + ' pages')}
      ${nb.pages.map(p => `<section class="shared-page"><div class="viewer"><div><img src="${img(p.id, 'enh', p.rev)}" style="width:100%;border-radius:10px;border:1px solid var(--line)"></div><div><h2>${esc(p.title || 'Page ' + p.index)} <span class="muted small">p.${p.index}</span></h2><div class="paper holes"><div class="md" id="sp-${p.id}">${p.transcript ? mdPage(p.transcript, { ...p, id: p.id }).replace(new RegExp('/api/pages/' + p.id + '/image\\?kind=enh&r=\\d+', 'g'), img(p.id, 'enh', p.rev)) : '<span class="muted">No digital copy</span>'}</div></div>${p.keyPoints?.length ? `<div class="card" style="margin-top:10px"><b>Key points</b><ul>${p.keyPoints.map(k => `<li>${mdi(k)}</li>`).join('')}</ul></div>` : ''}</div></div></section>`).join('')}</div>`);
    // figures: hydrate using the shared image url
    for (const p of nb.pages) if (p.figures?.length) hydrateFiguresFrom($('#sp-' + p.id), p, img(p.id, 'enh', p.rev));
    return;
  }
  const s = data.study; let tab = s.sheet ? 'sheet' : s.cards.length ? 'cards' : 'tests';
  const draw = () => {
    render(`<div class="shared">${head(s.title, (s.subject || 'Study set'))}
      <div class="tabs">${[['sheet', 'Study sheet'], ['cards', 'Flashcards (' + s.cards.length + ')'], ['tests', 'Practice tests (' + s.tests.length + ')']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div id="body"></div></div>`);
    $$('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
    const body = $('#body');
    if (tab === 'sheet') body.innerHTML = s.sheet ? `<div class="paper holes"><div class="md">${md(s.sheet)}</div></div>` : '<div class="empty">No study sheet in this set.</div>';
    else if (tab === 'cards') {
      let i = 0, flipped = false; const cards = s.cards;
      const dc = () => { if (!cards.length) return body.innerHTML = '<div class="empty">No flashcards in this set.</div>'; const c = cards[i]; body.innerHTML = `<div class="fc-stage"><div class="fc ${flipped ? 'flipped' : ''}" id="fc"><div class="face front"><span class="lab">Question · ${i + 1} / ${cards.length}</span><div>${mdi(c.front)}</div><span class="hint">tap to flip</span></div><div class="face back"><span class="lab">Answer</span><div>${mdi(c.back)}</div></div></div><div class="fc-controls"><button class="btn" id="pv">${icon('chevL')} Prev</button><button class="btn" id="nx">Next ${icon('chevR')}</button></div></div>`; $('#fc').onclick = () => { flipped = !flipped; $('#fc').classList.toggle('flipped', flipped); }; $('#pv').onclick = () => { i = (i - 1 + cards.length) % cards.length; flipped = false; dc(); }; $('#nx').onclick = () => { i = (i + 1) % cards.length; flipped = false; dc(); }; };
      dc();
    } else {
      body.innerHTML = s.tests.length ? `<div class="grid cols-2">${s.tests.map(t => `<div class="card"><b>${esc(t.title)}</b><div class="muted small">${t.questions.length} questions${t.description ? ' · ' + esc(t.description) : ''}</div><button class="btn primary sm take" data-id="${t.id}" style="margin-top:8px">Take it</button></div>`).join('')}</div>` : '<div class="empty">No practice tests in this set.</div>';
      $$('.take').forEach(b => b.onclick = () => takeShared(s.tests.find(t => t.id === b.dataset.id)));
    }
  };
  const takeShared = (test) => {
    const answers = {}; const L = 'ABCD'; const body = $('#body');
    body.innerHTML = `<h2>${esc(test.title)}</h2><div id="qs">${test.questions.map((q, i) => `<div class="q" data-id="${q.id}"><div class="qn">Question ${i + 1}</div><div class="qt">${mdi(q.question)}</div>${q.type === 'mc' ? `<div class="choices">${q.choices.map((c, ci) => `<div class="choice" data-ci="${ci}"><span class="letter">${L[ci]}</span><span>${mdi(c)}</span></div>`).join('')}</div>` : q.type === 'tf' ? `<div class="choices">${[true, false].map(v => `<div class="choice" data-v="${v}"><span class="letter">${v ? 'T' : 'F'}</span><span>${v ? 'True' : 'False'}</span></div>`).join('')}</div>` : `<textarea placeholder="Your answer…"></textarea>`}</div>`).join('')}</div><div style="text-align:center"><button class="btn primary lg" id="sub">Submit</button></div>`;
    $$('.q').forEach(qel => { const id = qel.dataset.id; $$('.choice', qel).forEach(c => c.onclick = () => { $$('.choice', qel).forEach(x => x.classList.remove('sel')); c.classList.add('sel'); answers[id] = c.dataset.ci !== undefined ? +c.dataset.ci : c.dataset.v === 'true'; }); const ta = $('textarea', qel); if (ta) ta.oninput = () => { answers[id] = ta.value; }; });
    $('#sub').onclick = async () => { busy($('#sub'), true, 'Grading…'); try { const a = await api(`/shared/${token}/grade/${test.id}`, { body: { answers } }); body.innerHTML = `<div class="card score-card"><div class="score-ring" style="--p:${a.percent}"><div>${a.percent}%</div></div><div class="muted small">${Math.round(a.score * 10) / 10} / ${a.total}</div><div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn" id="back">Back</button></div></div>${test.questions.map((q, i) => { const r = a.results[q.id]; return `<div class="q"><div class="qn">Question ${i + 1}</div><div class="qt">${mdi(q.question)}</div><div class="fb ${r?.correct ? 'ok' : 'bad'}">${r?.correct ? '✅ Correct' : '❌ Not quite'}${r?.feedback ? ' — ' + mdi(r.feedback) : ''}</div></div>`; }).join('')}`; $('#back').onclick = draw; } catch (e) { toast(e.message, 'err'); busy($('#sub'), false); } };
  };
  draw();
}
async function hydrateFiguresFrom(root, page, url) {
  const slots = $$('.pg-fig', root); if (!slots.length) return;
  const im = new Image(); im.src = url; await new Promise(r => { im.onload = r; im.onerror = r; }); if (!im.naturalWidth) return;
  for (const el of slots) { const f = page.figures[+el.dataset.fig]; if (!f) continue; const [x, y, w, hh] = f.box; const cv = $('canvas', el); const sw = w * im.naturalWidth, sh = hh * im.naturalHeight; const sc = Math.min(1, 1000 / sw); cv.width = Math.round(sw * sc); cv.height = Math.round(sh * sc); cv.getContext('2d').drawImage(im, x * im.naturalWidth, y * im.naturalHeight, sw, sh, 0, 0, cv.width, cv.height); }
}

// ---------- cram mode ----------
export function cramTab(s, body) {
  if (!s.cram) {
    body.innerHTML = `<div class="gen-box"><div class="big">⚡</div><h3>Cram mode — 20 minutes, max results</h3><p>Test soon? AI boils your notes down to the 6 must-know points, 10 toughest flashcards, 5 hard questions and 3 traps, and walks you through them on a timer.</p><button class="btn primary lg" id="gen">⚡ Build my cram plan</button></div>`;
    $('#gen').onclick = async () => { busy($('#gen'), true, 'Building the plan…'); try { s.cram = await api(`/study/${s.id}/cram`, { body: {} }); invalidate(); cramTab(s, body); } catch (e) { toast(e.message, 'err'); busy($('#gen'), false); } };
    return;
  }
  const c = s.cram;
  const steps = [
    { name: 'Must-know', mins: 4, emoji: '🎯', html: `<ol class="cram-list">${c.mustKnow.map(x => `<li>${mdi(x)}</li>`).join('')}</ol><p class="muted small">Read each one twice. Say it out loud. Cover it, repeat it.</p>` },
    { name: 'Flashcards', mins: 8, emoji: '🃏', html: `<div class="cram-cards">${c.cards.map((k, i) => `<div class="cram-card" data-i="${i}"><div class="front"><b>${mdi(k.front)}</b><span class="muted small">tap to flip</span></div><div class="back hidden">${mdi(k.back)}</div></div>`).join('')}</div>` },
    { name: 'Hard questions', mins: 6, emoji: '🔥', html: `<div class="cram-qs">${c.hardQuestions.map((q, i) => `<div class="q"><div class="qn">Question ${i + 1}</div><div class="qt">${mdi(q.question)}</div><textarea placeholder="Try it in your head or type here…"></textarea><button class="btn sm reveal" data-i="${i}">Show answer</button><div class="fb ok hidden"><b>Answer:</b> ${mdi(q.answer)}${q.why ? `<div>${mdi(q.why)}</div>` : ''}</div></div>`).join('')}</div>` },
    { name: 'Traps', mins: 2, emoji: '⚠️', html: `<ul class="cram-list">${c.traps.map(x => `<li>${mdi(x)}</li>`).join('')}</ul><p class="muted small">Last look. You've got this. 💪</p>` },
  ];
  let i = 0, left = steps[0].mins * 60, timer = null;
  const fmt = (x) => Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0');
  const drawStep = () => {
    const st = steps[i];
    body.innerHTML = `<div class="cram-head"><div class="cram-steps">${steps.map((x, k) => `<span class="${k === i ? 'on' : k < i ? 'done' : ''}">${x.emoji} ${x.name}</span>`).join('')}</div><div class="btn-row"><span class="chip blue" id="ct">⏱ ${fmt(left)}</span><button class="btn sm" id="pause">⏸</button><button class="btn sm" id="rebuild" title="New plan">${icon('refresh')}</button></div></div>
      <div class="card"><h2>${st.emoji} ${st.name} <span class="muted small">· ${st.mins} min</span></h2>${st.html}</div>
      <div class="btn-row" style="justify-content:space-between;margin-top:12px"><button class="btn" id="prev" ${i === 0 ? 'disabled' : ''}>${icon('chevL')} Back</button><button class="btn primary" id="next">${i === steps.length - 1 ? '✅ Done cramming' : 'Next step ' + icon('chevR')}</button></div>`;
    $$('.cram-card').forEach(el => el.onclick = () => { $('.front', el).classList.toggle('hidden'); $('.back', el).classList.toggle('hidden'); });
    $$('.reveal').forEach(b => b.onclick = () => { b.classList.add('hidden'); b.nextElementSibling.classList.remove('hidden'); });
    $('#prev').onclick = () => { if (i > 0) { i--; left = steps[i].mins * 60; drawStep(); } };
    $('#next').onclick = async () => { if (i < steps.length - 1) { i++; left = steps[i].mins * 60; drawStep(); } else { clearInterval(timer); timer = null; toast('Cram session done — go get it! 🎉', 'ok'); await api.patch('/study/' + s.id, { cramDone: Date.now() }).catch(() => {}); } };
    $('#pause').onclick = () => { if (timer) { clearInterval(timer); timer = null; $('#pause').textContent = '▶'; } else { startTimer(); $('#pause').textContent = '⏸'; } };
    $('#rebuild').onclick = async () => { if (await confirm('Build a new plan?', 'Replaces this cram plan.', { danger: false, ok: 'Rebuild' })) { s.cram = null; clearInterval(timer); cramTab(s, body); } };
  };
  const startTimer = () => { clearInterval(timer); timer = setInterval(() => { left--; const el = $('#ct'); if (el) { el.textContent = '⏱ ' + fmt(left); el.classList.toggle('red', left < 30); } if (left <= 0) { clearInterval(timer); timer = null; toast(i < steps.length - 1 ? 'Time — move to the next step' : 'Time’s up!'); } }, 1000); };
  drawStep(); startTimer();
  window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
}

// ---------- voice helpers ----------
export const voice = {
  supported: () => !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  listen(onText, onEnd) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { toast('Voice input is not supported in this browser (try Chrome or Safari)', 'err'); return null; }
    const r = new SR(); r.lang = 'en-US'; r.interimResults = true; r.continuous = false; let final = '';
    r.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t; else interim += t; } onText(final || interim, !!final); };
    r.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Mic error: ' + e.error, 'err'); onEnd && onEnd(); };
    r.onend = () => onEnd && onEnd();
    r.start(); return r;
  },
  speak(text, onDone) {
    if (!('speechSynthesis' in window)) return onDone && onDone();
    const clean = String(text).replace(/\$[^$]*\$/g, m => m.replace(/[$\\{}]/g, ' ').replace(/frac/g, ' over ').replace(/times/g, ' times ').replace(/sqrt/g, ' square root of ')).replace(/[*_#`>]/g, '').replace(/\[\[figure:\d+\]\]/g, '');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean); u.rate = 1.02; u.lang = 'en-US';
    const v = speechSynthesis.getVoices().find(v => /en[-_]US/.test(v.lang) && /Samantha|Google US|Aria|Jenny|Natural/.test(v.name)) || speechSynthesis.getVoices().find(v => /en[-_]US/.test(v.lang)); if (v) u.voice = v;
    u.onend = () => onDone && onDone(); speechSynthesis.speak(u);
  },
  stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); },
};

// ---------- focus timer (Pomodoro) ----------
const FT = { key: 'dwb_focus' };
function ftState() { try { return JSON.parse(localStorage.getItem(FT.key) || 'null') || { running: false, mode: 'focus', endsAt: 0, left: 25 * 60, sessions: 0, focusMin: 25, breakMin: 5 }; } catch { return { running: false, mode: 'focus', endsAt: 0, left: 1500, sessions: 0, focusMin: 25, breakMin: 5 }; } }
function ftSave(s) { localStorage.setItem(FT.key, JSON.stringify(s)); }
export function mountFocusTimer() {
  if ($('#focusWidget')) return;
  const w = h(`<div id="focusWidget" class="focus-widget hidden"><div class="fw-time" id="fwTime">25:00</div><div class="fw-mode" id="fwMode">Focus</div><div class="fw-btns"><button class="btn icon sm" id="fwPlay" title="Start / pause">▶</button><button class="btn icon sm" id="fwSkip" title="Skip">⏭</button><button class="btn icon sm ghost" id="fwClose" title="Hide">✕</button></div></div>`);
  document.body.appendChild(w);
  let tick = null;
  const draw = () => { const s = ftState(); const left = s.running ? Math.max(0, Math.round((s.endsAt - Date.now()) / 1000)) : s.left; $('#fwTime').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); $('#fwMode').textContent = (s.mode === 'focus' ? '🎯 Focus' : '☕ Break') + (s.sessions ? ` · ${s.sessions} done` : ''); $('#fwPlay').textContent = s.running ? '⏸' : '▶'; w.classList.toggle('break', s.mode === 'break'); if (s.running && left <= 0) finish(s); };
  const finish = (s) => { const wasFocus = s.mode === 'focus'; if (wasFocus) s.sessions++; s.mode = wasFocus ? 'break' : 'focus'; s.left = (wasFocus ? s.breakMin : s.focusMin) * 60; s.running = false; ftSave(s); try { new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU' + 'A'.repeat(200)).play().catch(() => {}); } catch {} if ('Notification' in window && Notification.permission === 'granted') { try { new Notification(wasFocus ? '🎉 Focus block done — take a break' : '☕ Break over — back to it', { body: wasFocus ? `${s.sessions} session${s.sessions === 1 ? '' : 's'} today. ${s.breakMin}-minute break.` : `${s.focusMin} minutes of focus.`, icon: '/icons/icon-192.png' }); } catch {} } toast(wasFocus ? `🎉 Focus block done! Take a ${s.breakMin}-min break.` : '☕ Break over — next focus block ready.'); draw(); };
  $('#fwPlay').onclick = () => { const s = ftState(); if (s.running) { s.left = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000)); s.running = false; } else { s.endsAt = Date.now() + s.left * 1000; s.running = true; } ftSave(s); draw(); };
  $('#fwSkip').onclick = () => { const s = ftState(); finish({ ...s, running: false }); };
  $('#fwClose').onclick = () => { w.classList.add('hidden'); localStorage.setItem('dwb_focus_hidden', '1'); };
  w.addEventListener('dblclick', () => { const s = ftState(); const m = modal(`<h2>Focus timer</h2><div class="row"><div class="field"><label>Focus minutes</label><input type="number" id="fm" value="${s.focusMin}" min="5" max="90"></div><div class="field"><label>Break minutes</label><input type="number" id="bm" value="${s.breakMin}" min="1" max="30"></div></div><div class="actions"><button class="btn" id="reset">Reset sessions</button><button class="btn primary" id="ok">Save</button></div>`); $('#ok', m.el).onclick = () => { s.focusMin = +$('#fm', m.el).value || 25; s.breakMin = +$('#bm', m.el).value || 5; if (!s.running) s.left = (s.mode === 'focus' ? s.focusMin : s.breakMin) * 60; ftSave(s); m.close(); draw(); }; $('#reset', m.el).onclick = () => { s.sessions = 0; ftSave(s); m.close(); draw(); }; });
  tick = setInterval(draw, 1000); draw();
  if (ftState().running || !localStorage.getItem('dwb_focus_hidden')) { /* keep hidden until toggled */ }
  if (ftState().running) w.classList.remove('hidden');
}
export function toggleFocusTimer() { mountFocusTimer(); const w = $('#focusWidget'); w.classList.toggle('hidden'); localStorage.setItem('dwb_focus_hidden', w.classList.contains('hidden') ? '1' : ''); }

// ---------- SMS settings ----------
export async function smsSettingsHtml() {
  const st = await api('/sms/status');
  if (!st.configured) return `<div class="small muted" style="margin-top:10px">💬 <b>Text-message reminders</b> aren't switched on for this server yet (needs a Twilio account). Push notifications above work on phone & laptop.</div>`;
  if (st.verified) return `<div style="margin-top:12px"><b>💬 Text messages</b> → ${esc(st.phone)} <span class="chip green">verified</span><div class="btn-row" style="margin-top:6px"><label class="chip"><input type="checkbox" id="smsOn" ${st.enabled ? 'checked' : ''}> Text me reminders too</label><button class="btn sm danger" id="smsRemove">Remove number</button></div></div>`;
  return `<div style="margin-top:12px"><b>💬 Text messages</b><div class="row" style="margin-top:6px"><input class="input" id="smsPhone" placeholder="+1 555 123 4567" value="${esc(st.phone || '')}"><button class="btn sm" id="smsStart">Send code</button></div><div class="row hidden" id="smsVerifyRow" style="margin-top:6px"><input class="input" id="smsCode" placeholder="6-digit code"><button class="btn sm primary" id="smsVerify">Verify</button></div></div>`;
}
export function wireSms(refresh) {
  const st = $('#smsStart'); if (st) st.onclick = async () => { busy(st, true, 'Sending…'); try { await api('/sms/start', { body: { phone: $('#smsPhone').value, tz: new Date().getTimezoneOffset() } }); $('#smsVerifyRow').classList.remove('hidden'); toast('Code sent', 'ok'); } catch (e) { toast(e.message, 'err'); } busy(st, false); };
  const vf = $('#smsVerify'); if (vf) vf.onclick = async () => { try { await api('/sms/verify', { body: { code: $('#smsCode').value.trim() } }); toast('Phone verified — texts on 📱', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); } };
  const on = $('#smsOn'); if (on) on.onchange = () => api('/sms/toggle', { body: { enabled: on.checked } });
  const rm = $('#smsRemove'); if (rm) rm.onclick = async () => { await api.del('/sms'); refresh(); };
}
