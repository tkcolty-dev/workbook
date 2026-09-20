import { state, api, stream, $, $$, esc, h, md, mdi, icon, toast, modal, confirm, busy, fmtDate, countdown, daysUntil, ago, loadNotebooks, loadEvents, loadStudy, invalidate, go, dispatch, setKeys, loading, plural, fmtMin, download, todayISO, navId, stale } from './core.js';
import { shell, updateReviewBadge } from './app.js';
import { cramTab, voice, shareThing } from './extras.js';
import { fileToCanvas, scaleCanvas, toDataURL } from './imageproc.js';

// ---------- list ----------
export async function studyListView(_, q = {}) {
  const main = shell('Study', loading());
  const seq = navId();
  const [sets, evs] = await Promise.all([loadStudy(true), loadEvents(true)]); if (stale(seq)) return;
  const today = todayISO();
  const testsSoon = evs.filter(e => !e.done && (e.type === 'test' || e.type === 'quiz') && e.date >= today && !e.studyId).slice(0, 4);
  const due = sets.reduce((n, s) => n + (s.cardsDue || 0), 0); updateReviewBadge(due);
  main.innerHTML = `<div class="page-head"><div><h1>Study</h1><div class="sub">Study sheets from your notes, help from the web, practice tests, flashcards, a plan and a tutor, all built from what you scanned.</div></div><div class="btn-row">${due ? `<a class="btn mark" href="#/review">${icon('review')} Review ${due} due</a>` : ''}<button class="btn primary" id="newSet">${icon('plus')} New study set</button></div></div>
    ${testsSoon.length ? `<div class="card warm" style="margin-bottom:18px"><h3>${icon('zap')} Tests coming up without a study set</h3><div class="btn-row" style="margin-top:8px">${testsSoon.map(e => `<a class="btn sm" href="#/study?new=1&event=${e.id}">${esc(e.title)} · <span class="muted">${countdown(e.date)}</span></a>`).join('')}</div></div>` : ''}
    <div class="study-list grid cols-2">${sets.sort((a, b) => b.updatedAt - a.updatedAt).map(s => { const ev = evs.find(e => e.id === s.eventId); return `<div class="card" role="link" tabindex="0" data-id="${s.id}"><div class="icon">${icon('study')}</div><div style="flex:1;min-width:0"><b>${esc(s.title)}</b><div class="muted small">${esc(s.subject || '')}${ev ? ' · ' + fmtDate(ev.date) + ' (' + countdown(ev.date) + ')' : ''}</div><div class="chips" style="margin-top:6px">${s.hasSheet ? '<span class="chip green">📝 sheet</span>' : ''}${s.hasOnline ? '<span class="chip blue">🌐 online</span>' : ''}${s.testCount ? `<span class="chip amber">✅ ${plural(s.testCount, 'test')}${s.best != null ? ' · best ' + s.best + '%' : ''}</span>` : ''}${s.cardCount ? `<span class="chip purple">🃏 ${s.cardCount} cards${s.cardsDue ? ' · ' + s.cardsDue + ' due' : ''}</span>` : ''}${s.planTotal ? `<span class="chip teal">📆 plan ${s.planDone}/${s.planTotal}</span>` : ''}${!s.hasSheet && !s.hasOnline && !s.testCount && !s.cardCount ? '<span class="chip">new</span>' : ''}</div></div>${icon('chevR', 'muted')}</div>`; }).join('')}</div>
    ${!sets.length ? `<div class="empty"><div class="big">🎓</div><h3>No study sets yet</h3><p>Pick a test from your planner (or any topic), choose the notebook pages it covers, and WorkBook builds your study kit.</p><button class="btn primary" id="newSet2">${icon('plus')} Create a study set</button></div>` : ''}`;
  $$('.study-list .card').forEach(c => { c.onclick = () => go('#/study/' + c.dataset.id); c.onkeydown = (e) => { if (e.key === 'Enter') c.click(); }; });
  $('#newSet').onclick = () => openNewStudy(q);
  if ($('#newSet2')) $('#newSet2').onclick = () => openNewStudy(q);
  if (q.new) openNewStudy(q);
}

export async function openNewStudy(q = {}) {
  const [nbs, evs] = await Promise.all([loadNotebooks(), loadEvents()]);
  const ev = q.event ? evs.find(e => e.id === q.event) : null;
  const preNb = q.notebook || ev?.notebookId || '';
  const m = modal(`<h2>New study set</h2>
    <div class="field"><label>Test / topic</label><input type="text" id="stTitle" value="${esc(ev ? ev.title : (preNb ? (nbs.find(n => n.id === preNb)?.name || '') : ''))}" placeholder="e.g. Chapter 5 test — Cells"></div>
    <div class="row"><div class="field"><label>Subject</label><input type="text" id="stSubject" value="${esc(ev?.subject || nbs.find(n => n.id === preNb)?.subject || '')}"></div><div class="field"><label>Planner event</label><select id="stEvent"><option value="">— none —</option>${evs.filter(e => !e.done).map(e => `<option value="${e.id}" ${e.id === q.event ? 'selected' : ''}>${esc(e.title)} (${fmtDate(e.date)})</option>`).join('')}</select></div></div>
    <div class="field"><label>What's on it? (optional)</label><textarea id="stTopic" placeholder="Chapters, topics, anything the teacher said would be on the test…">${esc(ev?.notes || '')}</textarea></div>
    <div class="field"><label>Links <span class="muted">(optional — paste a website/article and the AI studies it too)</span></label><div class="row"><input class="input" id="stLinks" placeholder="https://… (separate several with spaces)"></div></div>
    <div class="field"><label>Notebook pages to study from</label>
      <div class="row" style="margin-bottom:6px"><select id="stNb"><option value="">Choose a notebook…</option>${nbs.map(n => `<option value="${n.id}" ${n.id === preNb ? 'selected' : ''}>${esc(n.name)} (${n.scanned} pages)</option>`).join('')}</select><button class="btn sm" id="selAll" type="button">Select all</button></div>
      <div class="src-pages" id="srcPages"><span class="muted small">Pick a notebook above.</span></div><div class="help" id="selCount"></div></div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="create">Create study set</button></div>`, { wide: true });
  const el = m.el; const chosen = new Set();
  const loadPages = async () => {
    const id = $('#stNb', el).value; const box = $('#srcPages', el);
    if (!id) { box.innerHTML = '<span class="muted small">Pick a notebook above.</span>'; return; }
    box.innerHTML = '<span class="spinner"></span>';
    const nb = await api('/notebooks/' + id + '?lite=1');
    if (!nb.pages.length) { box.innerHTML = `<span class="muted small">No scanned pages in this notebook yet — <a href="#/scan/${nb.id}">scan some</a>.</span>`; return; }
    box.innerHTML = nb.pages.map(p => `<label><input type="checkbox" value="${p.id}" ${chosen.has(p.id) ? 'checked' : ''}><span>p.${p.index} ${esc(p.title || '')}</span></label>`).join('');
    $$('input', box).forEach(c => c.onchange = () => { c.checked ? chosen.add(c.value) : chosen.delete(c.value); $('#selCount', el).textContent = chosen.size + ' page(s) selected'; });
    $('#selAll', el).onclick = () => { $$('input', box).forEach(c => { c.checked = true; chosen.add(c.value); }); $('#selCount', el).textContent = chosen.size + ' page(s) selected'; };
  };
  $('#stNb', el).onchange = loadPages; loadPages();
  $('#create', el).onclick = async () => {
    const body = { title: $('#stTitle', el).value.trim(), subject: $('#stSubject', el).value.trim(), topic: $('#stTopic', el).value.trim(), eventId: $('#stEvent', el).value || null, pageIds: [...chosen], links: $('#stLinks', el).value.split(/\s+/).filter(u => /^https?:\/\//i.test(u)) };
    if (!body.title) return toast('Give it a title', 'err');
    busy($('#create', el), true, 'Creating…');
    try { const s = await api('/study', { body }); invalidate(); m.close(); go('#/study/' + s.id); } catch (e) { toast(e.message, 'err'); busy($('#create', el), false); }
  };
}

// ---------- study room ----------
let tab = 'sheet';
export async function studyView({ id }, q = {}) {
  const main = shell('Study', loading());
  const seq = navId();
  const [s, evs] = await Promise.all([api('/study/' + id), loadEvents()]); if (stale(seq)) return;
  const ev = evs.find(e => e.id === s.eventId);
  if (q.tab) tab = q.tab;
  if (q.take) { const t = s.tests.find(t => t.id === q.take); if (t) { let cfg = {}; try { cfg = JSON.parse(sessionStorage.getItem('dwb_take_cfg') || '{}'); } catch {} sessionStorage.removeItem('dwb_take_cfg'); startTest(s, t, cfg); tab = 'test'; } }
  const TABS = [['plan', 'calendar', 'Plan'], ['sheet', 'sheet', 'Study sheet'], ['online', 'globe', 'More online'], ['test', 'quiz', 'Practice tests'], ['cards', 'cards', 'Flashcards'], ['tutor', 'chat', 'Tutor'], ['cram', 'zap', 'Cram']];
  if (q.fixit && s.graded) tab = 'cards';
  if (tab === 'plan' && !s.plan && !q.tab) tab = 'sheet';
  const due = (s.cards || []).filter(c => (c.due || 0) <= Date.now()).length;
  main.innerHTML = `<div class="crumbs"><a href="#/study">Study</a> › <span>${esc(s.title)}</span></div>
    <div class="page-head"><div><h1>${esc(s.title)}</h1><div class="sub">${esc(s.subject || '')}${ev ? ` · ${fmtDate(ev.date)} · <b class="countdown ${daysUntil(ev.date) <= 3 ? 'urgent' : ''}">${countdown(ev.date)}</b>` : ''} · ${plural(s.pageIds.length, 'notebook page')}${s.links?.length ? ` · 🔗 ${plural(s.links.length, 'link')}` : ''}${s.copiedFrom ? ` · copied from ${esc(s.copiedFrom)}` : ''}</div></div>
      <div class="btn-row">${due ? `<a class="btn mark" href="#/review?set=${s.id}">${icon('review')} Review ${due} due</a>` : ''}<button class="btn" id="editSrc">${icon('edit')} Sources</button><button class="btn" id="moreSet" aria-haspopup="menu">${icon('more')} More</button></div></div>
    ${s.graded ? `<div class="card warm" style="margin-bottom:14px"><h3>📝 Fix-it set from your graded test${s.graded.testName ? ' — ' + esc(s.graded.testName) : ''}${s.graded.score ? ` <span class="chip red">${esc(s.graded.score)}</span>` : ''}</h3><div class="small" style="margin:6px 0">You missed <b>${s.graded.items.filter(i => i.markedWrong).length}</b> of ${s.graded.items.length}. Concepts to fix: ${(s.graded.missedConcepts || []).map(c => `<span class="chip amber">${esc(c)}</span>`).join(' ')}</div><details><summary class="small" style="cursor:pointer">See what was marked wrong</summary><div class="hw-items" style="margin-top:8px">${s.graded.items.filter(i => i.markedWrong).map(i => `<div class="hw-item wrong"><div class="hw-n">${esc(i.n)}</div><div class="hw-body"><div class="hw-q">${mdi(i.question)}</div><div class="small"><span class="muted">You wrote:</span> <b>${mdi(i.studentAnswer || '—')}</b>${i.correction ? ` · <span class="muted">Correct:</span> <b>${mdi(i.correction)}</b>` : ''}${i.concept ? ` · <span class="chip">${esc(i.concept)}</span>` : ''}</div></div></div>`).join('')}</div></details><div class="small muted" style="margin-top:6px">Flashcards and practice tests in this set are built from exactly these misses.</div></div>` : ''}
    <div class="tabs" role="tablist">${TABS.map(([k, ic, l]) => `<button data-t="${k}" role="tab" aria-selected="${tab === k}" class="${tab === k ? 'active' : ''}">${icon(ic)} ${l}${k === 'test' && s.tests.length ? `<span class="cnt">${s.tests.length}</span>` : ''}${k === 'cards' && s.cards.length ? `<span class="cnt">${s.cards.length}</span>` : ''}${k === 'plan' && s.plan ? `<span class="cnt">${s.plan.days.reduce((n, d) => n + d.tasks.filter(t => t.done).length, 0)}/${s.plan.days.reduce((n, d) => n + d.tasks.length, 0)}</span>` : ''}</button>`).join('')}</div>
    <div id="tabBody"></div>`;
  $$('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('.tabs button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); }); drawTab(s); });
  $('#editSrc').onclick = () => editSources(s);
  $('#moreSet').onclick = () => {
    const mm = modal(`<h2>${esc(s.title)}</h2><div class="nb-list">
      <button class="nb-row" id="mShare">${icon('upload')}<div><b>Share a read-only link</b><span class="muted small">Friends can read the sheet, flip the cards and take the tests</span></div></button>
      <button class="nb-row" id="mVocab">${icon('cards')}<div><b>Add flashcards from vocab</b><span class="muted small">Instant, no AI: terms and definitions on this set's pages</span></div></button>
      <button class="nb-row" id="mTsv" ${s.cards.length ? '' : 'disabled'}>${icon('download')}<div><b>Export flashcards (.tsv)</b><span class="muted small">Imports into Anki or Quizlet</span></div></button>
      <button class="nb-row" id="mSheet" ${s.sheet ? '' : 'disabled'}>${icon('download')}<div><b>Download study sheet (.md)</b><span class="muted small">Markdown file</span></div></button>
      <button class="nb-row" id="mDel" style="color:var(--red)">${icon('trash')}<div><b>Delete study set</b><span class="muted small">Sheet, tests, cards and plan are removed</span></div></button>
    </div><div class="actions"><button class="btn" data-close>Close</button></div>`);
    $('#mShare', mm.el).onclick = () => { mm.close(); shareThing('study', s.id, s.title); };
    $('#mVocab', mm.el).onclick = async () => { busy($('#mVocab', mm.el), true, 'Adding…'); try { const r = await api(`/study/${s.id}/vocab-cards`, { body: {} }); s.cards = r.cards; deck = null; invalidate(); mm.close(); toast(`Added ${plural(r.added, 'card')}`, 'ok'); tab = 'cards'; $$('.tabs button').forEach(x => x.classList.toggle('active', x.dataset.t === 'cards')); drawTab(s); } catch (e) { toast(e.message, 'err'); busy($('#mVocab', mm.el), false); } };
    $('#mTsv', mm.el).onclick = () => { mm.close(); const clean = (t) => String(t).replace(/[\t\n]+/g, ' ').trim(); download(`${s.title} flashcards.tsv`, s.cards.map(c => clean(c.front) + '\t' + clean(c.back)).join('\n'), 'text/tab-separated-values'); toast('Downloaded', 'ok'); };
    $('#mSheet', mm.el).onclick = () => { mm.close(); download(`${s.title} study sheet.md`, s.sheet, 'text/markdown'); };
    $('#mDel', mm.el).onclick = async () => { mm.close(); if (await confirm('Delete study set?', 'Sheet, tests, flashcards and plan will be removed.')) { await api.del('/study/' + s.id); invalidate(); go('#/study'); } };
  };
  if (q.fixit && s.graded && !s.cards.length && sessionStorage.getItem('dwb_fixit')) { sessionStorage.removeItem('dwb_fixit'); toast('Making fix-it flashcards + a practice test…'); api(`/study/${s.id}/cards`, { body: { count: 12 } }).then(r => { s.cards = r.cards; if (tab === 'cards') drawTab(s); }).catch(() => {}); api(`/study/${s.id}/test`, { body: { count: 8, types: ['mc', 'short', 'fill'], about: 'only the concepts I missed on the graded test', difficulty: 3 } }).then(t => { s.tests.push(t); toast('Fix-it practice test ready ✅', 'ok'); }).catch(() => {}); }
  drawTab(s);
}
function drawTab(s) {
  const body = $('#tabBody');
  ({ sheet: sheetTab, online: onlineTab, test: testTab, cards: cardsTab, tutor: tutorTab, cram: cramTab, plan: planTab }[tab] || sheetTab)(s, body);
}

// --- study plan (day by day until the test)
function planTab(s, body) {
  if (!s.plan) {
    body.innerHTML = genBox({ emoji: '📆', title: 'Plan my studying', text: noSources(s) ? 'Add notebook pages or a topic first (Sources button), then AI can plan your days.' : 'AI spreads this material over the days until your test: what to read, which flashcards, when to take a practice test, and a final review of weak spots. Check tasks off as you go; today\'s tasks also show on Home.', btn: 'Build my plan', id: 'gen', extra: `<div class="field" style="max-width:260px;margin:0 auto 14px;text-align:left"><label for="ppd">Minutes per day</label><select id="ppd">${[15, 20, 30, 45, 60, 90].map(n => `<option value="${n}" ${n === 30 ? 'selected' : ''}>${n} minutes</option>`).join('')}</select></div>` });
    $('#gen').onclick = async () => { busy($('#gen'), true, 'Planning your days…'); try { s.plan = await api(`/study/${s.id}/plan`, { body: { minutesPerDay: +$('#ppd').value, today: todayISO() } }); invalidate(); planTab(s, body); toast('Plan ready', 'ok'); } catch (e) { toast(e.message, 'err'); busy($('#gen'), false); } };
    return;
  }
  const today = todayISO(); const total = s.plan.days.reduce((n, d) => n + d.tasks.length, 0), done = s.plan.days.reduce((n, d) => n + d.tasks.filter(t => t.done).length, 0);
  body.innerHTML = `<div class="btn-row" style="justify-content:space-between;margin-bottom:12px"><div><b>${done}/${total} tasks done</b> <span class="muted small">· ${s.plan.minutesPerDay} min/day · through ${fmtDate(s.plan.endISO)}</span><div class="progress" style="width:220px;margin-top:6px"><i style="width:${total ? Math.round(100 * done / total) : 0}%"></i></div></div><button class="btn sm" id="replan">${icon('refresh')} New plan</button></div>
    <div class="plan-days">${s.plan.days.map(d => `<div class="plan-day ${d.date === today ? 'today' : d.date < today ? 'past' : ''}"><div class="pd-head"><b>${d.date === today ? 'Today · ' : ''}${fmtDate(d.date)}</b><span>${esc(d.focus || '')} · ${fmtMin(d.tasks.reduce((n, t) => n + t.minutes, 0))}</span></div><div class="plan-today">${d.tasks.map(t => `<label class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''}><span class="txt">${esc(t.text)}<small>${fmtMin(t.minutes)}</small></span><span class="kind ${esc(t.kind)}">${esc(t.kind)}</span></label>`).join('')}</div></div>`).join('')}</div>`;
  $$('.plan-days input').forEach(c => c.onchange = async () => { c.closest('.task').classList.toggle('done', c.checked); for (const d of s.plan.days) for (const t of d.tasks) if (t.id === c.dataset.task) t.done = c.checked; try { await api.patch(`/study/${s.id}/plan`, { taskId: c.dataset.task, done: c.checked }); } catch (e) { toast(e.message, 'err'); } });
  $('#replan').onclick = async () => { if (await confirm('Build a new plan?', 'Replaces this plan and its checkmarks.', { danger: false, ok: 'New plan' })) { s.plan = null; await api.patch(`/study/${s.id}/plan`, { clear: true }); planTab(s, body); } };
}
function noSources(s) { return !s.pageIds.length && !s.topic; }
function genBox({ emoji, title, text, btn, id, extra = '' }) {
  return `<div class="gen-box"><div class="big">${emoji}</div><h3>${title}</h3><p>${text}</p>${extra}<button class="btn primary lg" id="${id}">${icon('sparkle')} ${btn}</button></div>`;
}
function printHtml(title, html) {
  const w = window.open('', '_blank'); if (!w) return toast('Pop-up blocked', 'err');
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><link rel="stylesheet" href="/css/styles.css"><style>body{padding:32px;max-width:800px;margin:auto}</style></head><body><div class="md">${html}</div><script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

// --- study sheet
function sheetTab(s, body) {
  if (!s.sheet) {
    body.innerHTML = genBox({ emoji: '📝', title: 'Make my study sheet', text: noSources(s) ? 'Add notebook pages or a topic first (Sources button), then AI will write a study sheet.' : 'AI reads your scanned notes and writes a clean, organized study sheet: key concepts, vocab, formulas, common mistakes and a quick self-check.', btn: 'Generate study sheet', id: 'gen' });
    $('#gen').onclick = () => generate(s, 'sheet', $('#gen'), 'Writing your study sheet…');
    return;
  }
  body.innerHTML = `<div class="btn-row" style="justify-content:flex-end;margin-bottom:12px"><button class="btn sm" id="print">${icon('print')} Print / PDF</button><button class="btn sm" id="regen">${icon('refresh')} Regenerate</button></div><div class="paper holes"><div class="md">${md(s.sheet)}</div></div>`;
  $('#regen').onclick = () => generate(s, 'sheet', $('#regen'), 'Rewriting…');
  $('#print').onclick = () => printHtml(s.title + ' — Study Sheet', md(s.sheet));
}
// --- online
function onlineTab(s, body) {
  if (!s.online) {
    body.innerHTML = genBox({ emoji: '🌐', title: 'Find study help online', text: 'AI searches the web for the best videos, study guides, flashcard sets and practice quizzes on this exact topic — and sums up what they say is most important.', btn: 'Search the web', id: 'gen' });
    $('#gen').onclick = () => generate(s, 'online', $('#gen'), 'Searching the web…');
    return;
  }
  body.innerHTML = `<div class="btn-row" style="justify-content:flex-end;margin-bottom:12px"><button class="btn sm" id="regen">${icon('refresh')} Search again</button></div><div class="card"><div class="md">${md(s.online)}</div></div>`;
  $('#regen').onclick = () => generate(s, 'online', $('#regen'), 'Searching…');
}
async function generate(s, kind, btn, label) {
  busy(btn, true, label);
  const box = $('#tabBody');
  const note = h(`<div class="ai-status" style="margin-top:12px"><span class="spinner"></span> ${esc(label)} This can take 20–60 seconds.</div>`); box.appendChild(note);
  try { const r = await api(`/study/${s.id}/${kind}`, { body: {} }); s[kind] = r[kind]; invalidate(); drawTab(s); toast('Done!', 'ok'); }
  catch (e) { toast(e.message, 'err'); busy(btn, false); note.remove(); }
}

// --- practice tests
let activeTest = null; // { setId, test, answers, attempt, subset, mode:'exam'|'practice', checked:{}, flagged:Set, hints:Set, timer, timeLeft, startedAt }
const TYPE_LABEL = { mc: 'Multiple choice', tf: 'True / false', short: 'Short answer', fill: 'Fill in the blank', explain: 'Explain / show work' };
const DIFF_LABEL = ['Very easy', 'Easy', 'Medium', 'Hard', 'Very hard'];
// One-tap setups. "Same as last time" restores whatever you used last (kept in localStorage).
const PRESETS = [
  { k: 'quick', label: '⚡ Quick 10', d: '10 mixed questions, medium', cfg: { style: 'standard', count: 10, types: ['mc', 'tf', 'short'], difficulty: 3, timerMin: 0, mode: 'exam', hints: true } },
  { k: 'full', label: '📝 Full test', d: '25 questions, every type, 30-minute timer', cfg: { style: 'standard', count: 25, types: ['mc', 'tf', 'short', 'fill', 'explain'], difficulty: 3, timerMin: 30, mode: 'exam', hints: false } },
  { k: 'hard', label: '🔥 Hard mode', d: '15 hard questions, no hints, 20 minutes', cfg: { style: 'standard', count: 15, types: ['mc', 'short', 'explain'], difficulty: 5, timerMin: 20, mode: 'exam', hints: false } },
  { k: 'vocab', label: '🃏 Vocab drill', d: 'Fill-in and multiple choice on the terms', cfg: { style: 'standard', count: 15, types: ['fill', 'mc'], difficulty: 2, timerMin: 0, mode: 'practice', hints: true, about: 'vocabulary terms and definitions only' } },
  { k: 'remake', label: '🔁 New numbers', d: 'Same problems as the page with the values changed', cfg: { style: 'remake', count: 10, difficulty: 3, mode: 'practice', hints: true } },
  { k: 'last', label: '↺ Same as last time', d: 'Your previous setup', cfg: null },
];
const lastCfg = () => { try { return JSON.parse(localStorage.getItem('dwb_test_cfg') || 'null'); } catch { return null; } };
export function testConfigHtml(s, opts = {}) {
  const pages = (opts.pages || []);
  const style = ['remake', 'prompt', 'import'].includes(opts.style) ? opts.style : 'standard';
  const styleCard = (v, title, sub) => `<label class="tstyle ${style === v ? 'on' : ''}"><input type="radio" name="tStyle" value="${v}" ${style === v ? 'checked' : ''}><b>${title}</b><span>${sub}</span></label>`;
  return `<div class="test-cfg" style="margin:0 auto 14px;max-width:680px;text-align:left">
    <div class="presets" id="presets">${PRESETS.map(p => `<button type="button" class="preset" data-k="${p.k}" ${p.k === 'last' && !lastCfg() ? 'disabled' : ''} title="${esc(p.d)}"><b>${p.label}</b><span>${esc(p.d)}</span></button>`).join('')}</div>
    <div class="tm-summary" id="tSummary" aria-live="polite"></div>

    <div class="tm-section"><div class="tm-head"><b>1. Kind of test</b></div><div class="test-styles">
      ${styleCard('standard', '📝 Standard', 'You pick the question types')}${styleCard('remake', '🔁 New numbers', 'Copies your page or photos with different values')}${styleCard('prompt', '✨ Describe it', 'Tell the AI exactly what you want')}${styleCard('import', '📥 Import', 'Paste a test from ChatGPT or a file')}</div>
      <div class="field hidden" id="promptField" style="margin-top:10px"><label for="tPrompt">Describe the test</label><textarea id="tPrompt" style="min-height:80px" placeholder="e.g. 12 questions on the causes of WW1, half multiple choice half short answer, hard · or: same problems as my photos but change out all the numbers…">${esc(opts.prompt || '')}</textarea></div>
      <div class="field hidden" id="importField" style="margin-top:10px"><label for="tImport">Paste the test</label><textarea id="tImport" style="min-height:110px" placeholder="Paste the whole test here: questions, choices, and the answer key if it has one. Missing answers get solved and filled in."></textarea>
        <div class="btn-row" style="margin-top:6px"><button type="button" class="btn sm" id="tGptPrompt">🤖 Copy the ChatGPT prompt</button><button type="button" class="btn sm" id="tFileBtn">📄 Upload a file</button><input type="file" id="tFileIn" accept=".txt,.md,.json,text/plain,text/markdown,application/json" hidden></div>
        <div class="help">The ChatGPT prompt makes GPT answer in this app's exact format, so it imports 1:1. Photos of a printed test work too (Material below).</div></div>
    </div>

    <div class="tm-section" id="qSection"><div class="tm-head"><b>2. Questions</b></div>
      <div class="tm-row"><div class="field" style="flex:1"><label for="tCount">How many <b class="tm-num" id="tCountLbl">${opts.count || 10}</b></label><input type="range" id="tCount" min="1" max="50" value="${opts.count || 10}"></div>
        <div class="field" style="flex:1"><label for="tDiff">Difficulty <b class="tm-num" id="tDiffLbl">${DIFF_LABEL[(opts.difficulty || 3) - 1]}</b></label><input type="range" id="tDiff" min="1" max="5" value="${opts.difficulty || 3}"></div></div>
      <div class="field" id="typesField"><label>Question types</label><div class="btn-row">${Object.entries(TYPE_LABEL).map(([k, v]) => `<label class="chip tchip"><input type="checkbox" class="tType" value="${k}" ${(opts.types || ['mc', 'tf', 'short']).includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div></div>
      <div class="field"><label for="tAbout">Focus on <span class="muted">(optional)</span></label><input type="text" id="tAbout" class="input" value="${esc(opts.about || s.topic || '')}" placeholder="e.g. adding fractions, chapter 5 organelles, causes of WW1…"></div>
    </div>

    <details class="tm-section tm-details" ${pages.length > 1 || opts.instructions ? 'open' : ''}><summary class="tm-head"><b>3. Material and instructions</b><span class="muted small">pages · photos · links · your rules</span></summary>
      <div class="field"><label for="tInstr">Your instructions to the AI <span class="muted">(anything goes)</span></label><textarea id="tInstr" placeholder="e.g. make it like Mrs. K's tests · only vocab words · include 3 word problems · ask me to show my work · use soccer examples…" style="min-height:60px">${esc(opts.instructions || '')}</textarea></div>
      ${pages.length > 1 ? `<div class="field"><label>Pages to test on <span class="muted">(all if none picked)</span></label><div class="src-pages" style="max-height:140px">${pages.map(p => `<label><input type="checkbox" class="tPage" value="${p.id}"><span>p.${p.index} ${esc(p.title || '')}</span></label>`).join('')}</div></div>` : ''}
      <div class="field"><label>Photos of a test or worksheet <span class="muted">(up to 6)</span></label><div class="btn-row"><button type="button" class="btn sm" id="tAddPhoto">📷 Add photos</button><span class="muted small">Each page is read, the test is built from them, then re-checked page by page.</span></div><div class="btn-row" id="tPhotoThumbs" style="margin-top:6px"></div><input type="file" id="tPhotoIn" accept="image/*" multiple hidden></div>
      <div class="field"><label>Links to use as material</label><div class="links-box" id="linksBox">${(opts.links || []).map(u => `<div class="link-row"><span>🔗 ${esc(u)}</span><button type="button" class="btn icon sm ghost rmLink" aria-label="Remove link">${icon('x')}</button></div>`).join('')}<div class="row"><input class="input" id="linkIn" placeholder="https://…" aria-label="Link"><button type="button" class="btn sm" id="addLink">Add</button></div></div></div>
    </details>

    <div class="tm-section"><div class="tm-head"><b>4. Taking it</b></div>
      <div class="tm-row"><div class="field" style="flex:1"><label>Mode</label><div class="seg" id="modeSeg"><button type="button" data-m="exam" class="${(opts.mode || 'exam') === 'exam' ? 'active' : ''}">🎓 Exam</button><button type="button" data-m="practice" class="${opts.mode === 'practice' ? 'active' : ''}">🧪 Practice</button></div><div class="help" id="modeHelp"></div></div>
        <div class="field" style="flex:1"><label for="tTimer">Timer</label><select id="tTimer">${[0, 5, 10, 15, 20, 30, 45, 60].map(n => `<option value="${n}" ${(opts.timerMin || 0) === n ? 'selected' : ''}>${n ? n + ' minutes' : 'No timer'}</option>`).join('')}</select></div></div>
      <div class="btn-row"><label class="chip tchip"><input type="checkbox" id="tHints" ${opts.hints === false ? '' : 'checked'}> 💡 Hints</label><label class="chip tchip"><input type="checkbox" id="tShuffle" ${opts.shuffle ? 'checked' : ''}> 🔀 Shuffle</label><label class="chip tchip" title="After the test is written, the AI re-solves every question and fixes any wrong answers in the key"><input type="checkbox" id="tVerify" ${opts.verify === false ? '' : 'checked'}> ✓ Double-check answers</label></div>
    </div>
  </div>`;
}
// Prompt template for ChatGPT (or any AI): makes it output the test in this app's exact JSON format so imports are 1:1.
const GPT_TEST_PROMPT = `Make me a practice test on: [YOUR TOPIC — say how many questions, what types, and how hard].

When the test is ready, output it as ONE JSON code block in EXACTLY this format, with no text outside the code block:

{"title":"Test title","description":"1-2 sentences on what it covers","questions":[
{"id":"q1","type":"mc","question":"...","choices":["...","...","...","..."],"answer":0,"explanation":"why that answer is right","hint":"a nudge that doesn't give it away"},
{"id":"q2","type":"tf","question":"True or false: ...","answer":true,"explanation":"...","hint":"..."},
{"id":"q3","type":"short","question":"...","answer":"model answer","explanation":"...","hint":"..."},
{"id":"q4","type":"fill","question":"A sentence with one blank written as ____.","answer":"the missing word","explanation":"...","hint":"..."},
{"id":"q5","type":"explain","question":"Explain ...","answer":"model answer with the key points","explanation":"rubric: what earns full credit","hint":"..."}]}

Rules: "mc" has exactly 4 choices and "answer" is the index (0-3) of the correct choice. "tf" answer is true or false. "fill" has exactly one blank written as ____ in the question. Every question needs "answer", "explanation" and "hint". Number the ids q1, q2, q3… Write all math as LaTeX inside $...$ (escape backslashes for valid JSON, e.g. \\\\frac{1}{2}).`;
async function copyText(t) { return (await import('./core.js')).copyText(t); }
export function wireTestConfig(root = document) {
  const q = (sel) => $(sel, root);
  const mode = () => q('#modeSeg button.active')?.dataset.m || 'exam';
  const summary = () => {
    const st = q('input[name=tStyle]:checked')?.value || 'standard';
    const types = $$('.tType', root).filter(c => c.checked).map(c => TYPE_LABEL[c.value]);
    const n = q('#tCount')?.value, d = DIFF_LABEL[(+q('#tDiff')?.value || 3) - 1], t = +q('#tTimer')?.value;
    const photos = q('#tPhotoThumbs')?._photos?.length || 0;
    const parts = st === 'standard' ? [`${n} questions`, d.toLowerCase(), types.length ? types.join(', ') : '⚠ pick a type'] : st === 'remake' ? ['same problems, new numbers', d.toLowerCase()] : st === 'prompt' ? ['built from your description'] : ['imported as written'];
    parts.push(mode() === 'exam' ? 'exam mode' : 'practice mode'); if (t) parts.push(t + ' min timer'); if (photos) parts.push(photos + ' photo' + (photos === 1 ? '' : 's'));
    const el = q('#tSummary'); if (el) el.textContent = parts.join(' · ');
    const mh = q('#modeHelp'); if (mh) mh.textContent = mode() === 'exam' ? 'Answer everything, then get graded.' : 'Check each answer as you go, with hints.';
  };
  const upd = () => { const st = q('input[name=tStyle]:checked')?.value; $$('.tstyle', root).forEach(l => l.classList.toggle('on', $('input', l).checked)); const tf = q('#typesField'); if (tf) tf.style.display = st === 'standard' ? '' : 'none'; const qs = q('#qSection'); if (qs) qs.classList.toggle('hidden', st === 'import'); const pf = q('#promptField'); if (pf) pf.classList.toggle('hidden', st !== 'prompt'); const imf = q('#importField'); if (imf) imf.classList.toggle('hidden', st !== 'import'); summary(); };
  $$('input[name=tStyle]', root).forEach(r => r.onchange = upd);
  $$('#modeSeg button', root).forEach(b => b.onclick = () => { $$('#modeSeg button', root).forEach(x => x.classList.toggle('active', x === b)); summary(); });
  $$('.tType, #tTimer, #tHints, #tShuffle, #tVerify', root).forEach(el => el.addEventListener('change', summary));
  // presets
  const apply = (cfg) => {
    if (!cfg) return;
    const st = q(`input[name=tStyle][value="${cfg.style || 'standard'}"]`); if (st) st.checked = true;
    if (cfg.count) q('#tCount').value = cfg.count; if (cfg.difficulty) q('#tDiff').value = cfg.difficulty;
    if (cfg.types) $$('.tType', root).forEach(c => { c.checked = cfg.types.includes(c.value); });
    if (cfg.timerMin !== undefined) q('#tTimer').value = String(cfg.timerMin);
    if (cfg.hints !== undefined) q('#tHints').checked = cfg.hints; if (cfg.shuffle !== undefined) q('#tShuffle').checked = cfg.shuffle; if (cfg.verify !== undefined) q('#tVerify').checked = cfg.verify;
    if (cfg.mode) $$('#modeSeg button', root).forEach(x => x.classList.toggle('active', x.dataset.m === cfg.mode));
    if (cfg.about !== undefined && !q('#tAbout').value) q('#tAbout').value = cfg.about;
    if (cfg.instructions) q('#tInstr').value = cfg.instructions;
    q('#tCountLbl').textContent = q('#tCount').value; q('#tDiffLbl').textContent = DIFF_LABEL[q('#tDiff').value - 1];
    upd();
  };
  $$('.preset', root).forEach(b => b.onclick = () => { $$('.preset', root).forEach(x => x.classList.toggle('on', x === b)); const p = PRESETS.find(x => x.k === b.dataset.k); apply(p.k === 'last' ? lastCfg() : p.cfg); });
  // photos of a test/worksheet
  const pin = q('#tPhotoIn'), padd = q('#tAddPhoto'), pth = q('#tPhotoThumbs');
  if (pin && padd && pth) {
    pth._photos = pth._photos || [];
    const draw = () => { pth.innerHTML = pth._photos.map((p, i) => `<div class="tray-item" style="width:74px"><div class="ti-img" style="background-image:url('${p.thumb}')"></div><button type="button" class="btn icon sm ghost rmPhoto" data-i="${i}" aria-label="Remove photo">${icon('x')}</button></div>`).join(''); $$('.rmPhoto', pth).forEach(b => b.onclick = () => { pth._photos.splice(+b.dataset.i, 1); draw(); summary(); }); };
    padd.onclick = () => pin.click();
    pin.onchange = async () => { for (const f of [...pin.files].slice(0, 6 - pth._photos.length)) { try { const c = await fileToCanvas(f, 1600); pth._photos.push({ data: toDataURL(c, 0.85), thumb: toDataURL(scaleCanvas(c, 200), 0.6) }); } catch { toast('Could not read that image', 'err'); } } pin.value = ''; draw(); summary(); };
    draw();
  }
  const gpt = q('#tGptPrompt'); if (gpt) gpt.onclick = async () => { (await copyText(GPT_TEST_PROMPT)) ? toast('Prompt copied. Paste it into ChatGPT, then paste GPT\'s answer back here', 'ok') : toast('Could not copy', 'err'); };
  const fbtn = q('#tFileBtn'), fin = q('#tFileIn');
  if (fbtn && fin) { fbtn.onclick = () => fin.click(); fin.onchange = async () => { const f = fin.files[0]; fin.value = ''; if (!f) return; try { q('#tImport').value = (await f.text()).slice(0, 30000); toast('File loaded ✓', 'ok'); } catch { toast('Could not read that file. Paste the text instead.', 'err'); } }; }
  const wireRm = () => $$('.rmLink', root).forEach(b => b.onclick = () => b.closest('.link-row').remove()); wireRm();
  const addLink = q('#addLink'), linkIn = q('#linkIn');
  if (addLink) { const add = () => { const u = linkIn.value.trim(); if (!/^https?:\/\//i.test(u)) return toast('Paste a full link starting with http', 'err'); linkIn.value = ''; linkIn.closest('.row').insertAdjacentHTML('beforebegin', `<div class="link-row"><span>🔗 ${esc(u)}</span><button type="button" class="btn icon sm ghost rmLink" aria-label="Remove link">${icon('x')}</button></div>`); wireRm(); }; addLink.onclick = add; linkIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }; }
  const c = q('#tCount'), cl = q('#tCountLbl'); if (c) c.oninput = () => { cl.textContent = c.value; summary(); };
  const df = q('#tDiff'), dl = q('#tDiffLbl'); if (df) df.oninput = () => { dl.textContent = DIFF_LABEL[df.value - 1]; summary(); };
  upd();
}
export function readTestConfig(root = document) {
  const style = $('input[name=tStyle]:checked', root)?.value || 'standard';
  const types = $$('.tType', root).filter(c => c.checked).map(c => c.value);
  if (style === 'standard' && !types.length) { toast('Pick at least one question type', 'err'); return null; }
  const prompt = $('#tPrompt', root)?.value.trim() || '';
  if (style === 'prompt' && !prompt) { toast('Describe the test you want', 'err'); return null; }
  const images = ($('#tPhotoThumbs', root)?._photos || []).map(p => p.data);
  const importText = $('#tImport', root)?.value.trim() || '';
  if (style === 'import' && !importText && !images.length) { toast('Paste the test (or add photos of it) to import', 'err'); return null; }
  const links = $$('.link-row span', root).map(sp => sp.textContent.replace(/^🔗\s*/, '').trim());
  const cfg = { style, types, prompt, importText, images, verify: $('#tVerify', root)?.checked !== false, links, count: +$('#tCount', root).value, difficulty: +$('#tDiff', root).value, about: $('#tAbout', root)?.value.trim() || '', instructions: $('#tInstr', root)?.value.trim() || '', pageIds: $$('.tPage', root).filter(c => c.checked).map(c => c.value), hints: $('#tHints', root)?.checked !== false, shuffle: !!$('#tShuffle', root)?.checked, mode: $('#modeSeg button.active', root)?.dataset.m || 'exam', timerMin: +($('#tTimer', root)?.value || 0) };
  try { const { images: _i, importText: _t, pageIds: _p, links: _l, ...keep } = cfg; localStorage.setItem('dwb_test_cfg', JSON.stringify(keep)); } catch {}
  return cfg;
}
const genLabel = (cfg) => cfg.images?.length ? `Reading ${cfg.images.length} photo page${cfg.images.length === 1 ? '' : 's'}, building the test & double-checking it page by page…` : cfg.style === 'import' ? 'Converting your test & checking the answers…' : cfg.style === 'remake' ? 'Rewriting with new numbers…' : 'Writing your test…';
function startTest(s, test, cfg = {}, subset = null) {
  let order = (subset || test.questions.map(q => q.id));
  if (cfg.shuffle) order = order.slice().sort(() => Math.random() - 0.5);
  activeTest = { setId: s.id, test, answers: {}, attempt: null, subset, order, mode: cfg.mode || 'exam', checked: {}, flagged: new Set(), hints: new Set(), timerMin: cfg.timerMin || 0, timeLeft: (cfg.timerMin || 0) * 60, startedAt: Date.now(), timer: null };
}
// "Test on this page": create a study set from one page and generate a test right away.
export async function testOnPage(page, nb, o = {}) {
  const fake = { topic: '', title: page.title || nb.name };
  const m = modal(`<h2>Test on this page</h2><p class="muted small" style="margin:-6px 0 12px">“${esc(page.title || 'Page ' + page.index)}” · ${esc(nb.name)}</p>${testConfigHtml(fake, { about: o.about || page.title || '', count: 10, style: o.style })}<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="goTest">${icon('sparkle')} Make the test</button></div>`, { wide: true });
  wireTestConfig(m.el);
  $('#goTest', m.el).onclick = async () => {
    const cfg = readTestConfig(m.el); if (!cfg) return;
    busy($('#goTest', m.el), true, genLabel(cfg));
    try {
      const set = await api('/study', { body: { title: (page.title || 'Page ' + page.index) + ' — test', subject: nb.subject || '', topic: cfg.about, pageIds: [page.id] } });
      const t = await api(`/study/${set.id}/test`, { body: cfg });
      sessionStorage.setItem('dwb_take_cfg', JSON.stringify(cfg));
      invalidate(); m.close(); go(`#/study/${set.id}?tab=test&take=${t.id}`);
    } catch (e) { toast(e.message, 'err'); busy($('#goTest', m.el), false); }
  };
}
async function testTab(s, body) {
  if (activeTest && activeTest.setId === s.id) return drawQuiz(s, body);
  const pages = (s.pages || []).length > 1 ? s.pages : [];
  const cfg = testConfigHtml(s, { pages });
  body.innerHTML = `${s.tests.length ? `<div class="grid cols-2" style="margin-bottom:20px">${s.tests.slice().reverse().map(t => { const best = Math.max(0, ...t.attempts.map(a => a.percent)); const last = t.attempts[t.attempts.length - 1]; return `<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><b>${esc(t.title)}</b> ${t.style === 'remake' ? '<span class="chip purple">new numbers</span>' : ''}${t.style === 'import' ? '<span class="chip blue">imported</span>' : ''}${t.fromPhotos ? `<span class="chip blue">📷 ${t.fromPhotos} photo${t.fromPhotos === 1 ? '' : 's'}</span>` : ''}${t.checked && !t.checked.error ? `<span class="chip green" title="AI re-solved every question${t.fromPhotos ? ' page by page against your photos' : ''} and fixed ${t.checked.fixed || 0} answer${t.checked.fixed === 1 ? '' : 's'}">✓ double-checked</span>` : ''}${t.difficulty ? `<span class="chip">${['very easy', 'easy', 'medium', 'hard', 'very hard'][t.difficulty - 1]}</span>` : ''}${t.description ? `<div class="small" style="margin:2px 0 4px;color:var(--ink-2)">${esc(t.description)}</div>` : ''}<div class="muted small">${t.questions.length} questions · ${ago(t.createdAt)}${t.attempts.length ? ` · ${t.attempts.length} attempt${t.attempts.length === 1 ? '' : 's'} · best <b style="color:var(--green)">${best}%</b>` : ' · not taken yet'}</div></div><button class="btn icon sm ghost delT" data-id="${t.id}">${icon('trash')}</button></div><div class="btn-row" style="margin-top:10px"><button class="btn primary sm takeT" data-id="${t.id}" data-mode="exam">${icon('quiz')} ${t.attempts.length ? 'Take again' : 'Take test'}</button><button class="btn sm takeT" data-id="${t.id}" data-mode="practice">🧪 Practice</button>${last ? `<button class="btn sm reviewT" data-id="${t.id}">Review last (${last.percent}%)</button>` : ''}${last && last.results && Object.values(last.results).some(r => !r.correct) ? `<button class="btn sm retryT" data-id="${t.id}">↺ Retry missed</button>` : ''}<button class="btn sm ghost printT" data-id="${t.id}">${icon('print')} Print</button></div></div>`; }).join('')}</div>` : ''}
    ${genBox({ emoji: '✅', title: s.tests.length ? 'Make another test' : 'Make a practice test', text: 'You\'re in charge: pick the type, difficulty, how many, and tell the AI exactly what you want. Take it as an exam or in practice mode with hints.', btn: 'Generate test', id: 'gen', extra: cfg })}`;
  wireTestConfig();
  $('#gen').onclick = async () => {
    const cfgv = readTestConfig(); if (!cfgv) return;
    busy($('#gen'), true, genLabel(cfgv));
    try { const t = await api(`/study/${s.id}/test`, { body: cfgv }); s.tests.push(t); invalidate(); startTest(s, t, cfgv); drawQuiz(s, body); }
    catch (e) { toast(e.message, 'err'); busy($('#gen'), false); }
  };
  $$('.takeT').forEach(b => b.onclick = () => { const t = s.tests.find(t => t.id === b.dataset.id); startTest(s, t, { mode: b.dataset.mode }); drawQuiz(s, body); });
  $$('.reviewT').forEach(b => b.onclick = () => { const t = s.tests.find(t => t.id === b.dataset.id); const a = t.attempts[t.attempts.length - 1]; startTest(s, t, {}, a.subset || null); activeTest.answers = a.answers; activeTest.attempt = a; drawQuiz(s, body); });
  $$('.retryT').forEach(b => b.onclick = () => { const t = s.tests.find(t => t.id === b.dataset.id); const a = t.attempts[t.attempts.length - 1]; const missed = t.questions.filter(q => a.results?.[q.id] && !a.results[q.id].correct).map(q => q.id); startTest(s, t, { mode: 'exam' }, missed); drawQuiz(s, body); });
  $$('.printT').forEach(b => b.onclick = () => { const t = s.tests.find(t => t.id === b.dataset.id); printHtml(t.title, `<h1>${esc(t.title)}</h1><p>${esc(t.description || '')}</p><ol>${t.questions.map(q => `<li style="margin-bottom:14px">${mdi(q.question)}${q.type === 'mc' ? '<ol type="A">' + q.choices.map(c => `<li>${mdi(c)}</li>`).join('') + '</ol>' : q.type === 'tf' ? '<div>☐ True &nbsp; ☐ False</div>' : '<div style="border-bottom:1px solid #999;height:34px"></div>'}</li>`).join('')}</ol><h2 style="page-break-before:always">Answer key</h2><ol>${t.questions.map(q => `<li>${q.type === 'mc' ? mdi(q.choices[q.answer]) : q.type === 'tf' ? (q.answer ? 'True' : 'False') : mdi(q.answer)}</li>`).join('')}</ol>`); });
  $$('.delT').forEach(b => b.onclick = async () => { if (await confirm('Delete this test?', 'Its attempts will be removed too.')) { await api.del(`/study/${s.id}/test/${b.dataset.id}`); s.tests = s.tests.filter(t => t.id !== b.dataset.id); invalidate(); testTab(s, body); } });
}
function fmtClock(sec) { sec = Math.max(0, sec); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
function drawQuiz(s, body) {
  const A = activeTest; const { test, answers, attempt } = A;
  const L = 'ABCD';
  const qs = A.order.map(id => test.questions.find(q => q.id === id)).filter(Boolean);
  const answered = qs.filter(q => answers[q.id] !== undefined && answers[q.id] !== '').length;
  const practice = A.mode === 'practice' && !attempt;
  body.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px"><div><h2>${esc(test.title)}</h2>${test.description ? `<div style="color:var(--ink-2);margin:2px 0">${esc(test.description)}</div>` : ''}<div class="muted small">${qs.length} ${test.style === 'remake' ? 'problems · same as your page, new numbers' : 'questions'}${test.checked && !test.checked.error ? ' · ✓ double-checked' : ''}${A.subset ? ' · retrying the ones you missed' : ''}${practice ? ' · 🧪 practice mode' : attempt ? ' · graded' : ' · 🎓 exam mode'}</div></div><div class="btn-row">${A.timerMin && !attempt ? `<span class="chip ${A.timeLeft < 60 ? 'red' : 'blue'}" id="clock">⏱ ${fmtClock(A.timeLeft)}</span>` : ''}<button class="btn sm" id="backT">${icon('chevL')} All tests</button></div></div>
    ${!attempt ? `<div class="progress" style="margin-bottom:14px"><i id="prog" style="width:${Math.round(100 * answered / qs.length)}%"></i></div>` : ''}
    ${attempt ? `<div class="card score-card" style="margin-bottom:16px"><div class="score-ring" style="--p:${attempt.percent}"><div>${attempt.percent}%</div></div><div style="font-family:var(--serif);font-size:20px">${attempt.percent >= 90 ? 'Outstanding! 🌟' : attempt.percent >= 75 ? 'Nice work! 👏' : attempt.percent >= 50 ? 'Getting there — review the misses 💪' : 'Keep studying — you’ve got this 📚'}</div><div class="muted small">${Math.round(attempt.score * 10) / 10} / ${attempt.total} points${attempt.timeSpent ? ' · ' + fmtClock(Math.round(attempt.timeSpent / 1000)) : ''}</div><div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="again">${icon('refresh')} Try again</button>${Object.values(attempt.results || {}).some(r => !r.correct) ? `<button class="btn" id="retryMissed">↺ Retry missed only</button>` : ''}<button class="btn" id="practiceAgain">🧪 Practice mode</button><button class="btn" id="newT">${icon('sparkle')} New test</button></div></div>` : ''}
    <div id="qs">${qs.map((q, i) => { const r = attempt?.results?.[q.id] || A.checked[q.id]; const a = answers[q.id]; const graded = !!r; return `<div class="q ${A.flagged.has(q.id) ? 'flagged' : ''}" data-id="${q.id}"><div style="display:flex;justify-content:space-between;align-items:center"><div class="qn">Question ${i + 1} · ${TYPE_LABEL[q.type] || q.type}</div><div class="btn-row">${!attempt ? `<button class="btn icon sm ghost flagQ" title="Flag for later">${A.flagged.has(q.id) ? '🚩' : '⚑'}</button>` : ''}${q.hint && !graded ? `<button class="btn sm ghost hintQ">💡 Hint</button>` : ''}</div></div><div class="qt">${mdi(q.question)}</div>${A.hints.has(q.id) && q.hint ? `<div class="hint-box">💡 ${mdi(q.hint)}</div>` : ''}
      ${q.type === 'mc' ? `<div class="choices">${q.choices.map((c, ci) => `<div class="choice ${a === ci ? 'sel' : ''} ${graded ? (ci === Number(q.answer) ? 'right' : (a === ci ? 'wrong' : '')) : ''}" data-ci="${ci}"><span class="letter">${L[ci]}</span><span>${mdi(c)}</span></div>`).join('')}</div>`
        : q.type === 'tf' ? `<div class="choices">${[true, false].map(v => `<div class="choice ${String(a) === String(v) ? 'sel' : ''} ${graded ? (String(v) === String(q.answer) ? 'right' : (String(a) === String(v) ? 'wrong' : '')) : ''}" data-v="${v}"><span class="letter">${v ? 'T' : 'F'}</span><span>${v ? 'True' : 'False'}</span></div>`).join('')}</div>`
        : q.type === 'fill' ? `<input class="input fillin" placeholder="Type the missing word or number…" value="${esc(a || '')}" ${graded ? 'disabled' : ''}>`
        : `<textarea placeholder="${q.type === 'explain' ? 'Explain your thinking / show your work…' : 'Type your answer…'}" ${graded ? 'disabled' : ''} style="${q.type === 'explain' ? 'min-height:110px' : ''}">${esc(a || '')}</textarea>`}
      ${practice && !graded ? `<div class="btn-row" style="margin-top:8px"><button class="btn sm checkQ">${icon('check')} Check answer</button></div>` : ''}
      ${graded ? `<div class="fb ${r?.correct ? 'ok' : 'bad'}">${r?.correct ? '✅ Correct' : (r?.score === 0.5 ? '🟡 Partly right' : '❌ Not quite')}${['short', 'fill', 'explain'].includes(q.type) ? ` — <b>Model answer:</b> ${mdi(q.answer)}` : (r?.correct ? '' : ` — <b>Answer:</b> ${q.type === 'mc' ? mdi(q.choices[q.answer]) : (q.answer ? 'True' : 'False')}`)}${r?.feedback ? `<div style="margin-top:4px">${mdi(r.feedback)}</div>` : ''}${q.explanation ? `<div style="margin-top:4px;opacity:.85">${mdi(q.explanation)}</div>` : ''}</div>` : ''}
    </div>`; }).join('')}</div>
    ${!attempt ? `<div style="position:sticky;bottom:12px;text-align:center;margin-top:8px"><button class="btn primary lg" id="submit">${icon('check')} ${practice ? 'Finish & see score' : 'Submit test'}</button>${A.flagged.size ? `<div class="small muted" style="margin-top:6px">${A.flagged.size} flagged</div>` : ''}</div>` : ''}`;
  $('#backT').onclick = () => { clearInterval(A.timer); activeTest = null; testTab(s, body); };
  if (attempt) {
    $('#again').onclick = () => { startTest(s, test, { mode: 'exam' }); drawQuiz(s, body); };
    $('#newT').onclick = () => { activeTest = null; testTab(s, body).then?.(() => $('#gen')?.scrollIntoView({ behavior: 'smooth' })); };
    $('#practiceAgain').onclick = () => { startTest(s, test, { mode: 'practice' }); drawQuiz(s, body); };
    const rm = $('#retryMissed'); if (rm) rm.onclick = () => { const missed = qs.filter(q => attempt.results?.[q.id] && !attempt.results[q.id].correct).map(q => q.id); startTest(s, test, { mode: 'exam' }, missed); drawQuiz(s, body); };
    return;
  }
  const upProg = () => { const n = qs.filter(q => answers[q.id] !== undefined && answers[q.id] !== '').length; const p = $('#prog'); if (p) p.style.width = Math.round(100 * n / qs.length) + '%'; };
  $$('.q').forEach(qel => {
    const id = qel.dataset.id; const q = test.questions.find(x => x.id === id);
    if (A.checked[id]) return;
    $$('.choice', qel).forEach(c => c.onclick = () => { $$('.choice', qel).forEach(x => x.classList.remove('sel')); c.classList.add('sel'); answers[id] = c.dataset.ci !== undefined ? +c.dataset.ci : c.dataset.v === 'true'; upProg(); });
    const ta = $('textarea, input.fillin', qel); if (ta) ta.oninput = () => { answers[id] = ta.value; upProg(); };
    const fl = $('.flagQ', qel); if (fl) fl.onclick = () => { A.flagged.has(id) ? A.flagged.delete(id) : A.flagged.add(id); drawQuiz(s, body); qel.scrollIntoView({ block: 'center' }); };
    const hb = $('.hintQ', qel); if (hb) hb.onclick = () => { A.hints.add(id); const y = window.scrollY; drawQuiz(s, body); window.scrollTo(0, y); };
    const ck = $('.checkQ', qel); if (ck) ck.onclick = async () => {
      if (answers[id] === undefined || answers[id] === '') return toast('Answer first, then check', 'err');
      busy(ck, true, 'Checking…');
      try { const r = await api(`/study/${s.id}/test/${test.id}/grade`, { body: { answers: { [id]: answers[id] }, questionIds: [id], dryRun: true } }); A.checked[id] = r.results[id]; const y = window.scrollY; drawQuiz(s, body); window.scrollTo(0, y); }
      catch (e) { toast(e.message, 'err'); busy(ck, false); }
    };
  });
  // timer
  if (A.timerMin && !A.timer) {
    A.timer = setInterval(() => { A.timeLeft--; const c = $('#clock'); if (c) { c.textContent = '⏱ ' + fmtClock(A.timeLeft); c.classList.toggle('red', A.timeLeft < 60); } if (A.timeLeft <= 0) { clearInterval(A.timer); A.timer = null; toast('Time’s up — submitting', 'err'); $('#submit')?.click(); } }, 1000);
  }
  $('#submit').onclick = async () => {
    const missing = qs.filter(q => answers[q.id] === undefined || answers[q.id] === '').length;
    if (missing && A.timeLeft > 0 && !(await confirm(`${missing} unanswered`, 'Submit anyway? Blank answers count as wrong.', { danger: false, ok: 'Submit' }))) return;
    clearInterval(A.timer); A.timer = null;
    busy($('#submit'), true, 'Grading…');
    try { const a = await api(`/study/${s.id}/test/${test.id}/grade`, { body: { answers, questionIds: A.subset || undefined, mode: A.mode, timeSpent: Date.now() - A.startedAt } }); test.attempts.push(a); A.attempt = a; invalidate(); drawQuiz(s, body); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (e) { toast(e.message, 'err'); busy($('#submit'), false); }
  };
}

// --- flashcards
let deck = null; // { order, i, flipped, onlyUnknown }
function cardsTab(s, body) {
  const cfg = `<div class="field" style="max-width:220px;margin:0 auto 14px;text-align:left"><label>How many cards?</label><select id="cCount">${[10, 15, 20, 30, 40].map(n => `<option ${n === 20 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  if (!s.cards.length) {
    body.innerHTML = genBox({ emoji: '🃏', title: 'Make flashcards', text: 'AI turns your notes into flashcards for the most testable facts, terms and ideas. Flip, mark what you know, and drill the rest.', btn: 'Generate flashcards', id: 'gen', extra: cfg });
    $('#gen').onclick = () => genCards(s, body);
    return;
  }
  if (!deck || deck.setId !== s.id) deck = { setId: s.id, order: s.cards.map((_, i) => i), i: 0, flipped: false, onlyUnknown: false, view: 'study' };
  const known = s.cards.filter(c => c.box >= 1).length;
  const dueN = s.cards.filter(c => (c.due || 0) <= Date.now()).length;
  const cards = deck.onlyUnknown ? deck.order.filter(i => (s.cards[i].box || 0) < 1) : deck.order;
  if (deck.i >= cards.length) deck.i = 0;
  const cur = s.cards[cards[deck.i]];
  body.innerHTML = `<div class="fc-meta"><div><b style="color:var(--ink)">${s.cards.length} cards</b> · ${known} known · ${s.cards.length - known} still learning${dueN ? ` · <a href="#/review?set=${s.id}">${dueN} due for review</a>` : ''}</div><div class="btn-row"><div class="seg"><button class="${deck.view === 'study' ? 'active' : ''}" id="vStudy">Study</button><button class="${deck.view === 'list' ? 'active' : ''}" id="vList">All cards</button></div><button class="btn sm" id="more">${icon('plus')} More cards</button></div></div>
    ${deck.view === 'list' ? `<div class="fc-list">${s.cards.map((c, i) => `<div class="card"><span class="st chip ${c.box >= 1 ? 'green' : ''}">${c.box >= 1 ? 'known' : 'learning'}</span><b>${mdi(c.front)}</b><div class="muted">${mdi(c.back)}</div></div>`).join('')}</div>` :
      !cards.length ? `<div class="empty"><div class="big">🎉</div><h3>You know them all!</h3><p>Every card is marked known. Reset to drill again.</p><button class="btn" id="resetK">Reset progress</button></div>` :
      `<div class="fc-stage"><div class="fc ${deck.flipped ? 'flipped' : ''}" id="fc"><div class="face front"><span class="lab">Question · ${deck.i + 1} / ${cards.length}</span><div>${mdi(cur.front)}</div>${cur.hint ? `<span class="hint">Hint: ${esc(cur.hint)}</span>` : '<span class="hint">tap to flip · space</span>'}</div><div class="face back"><span class="lab">Answer</span><div>${mdi(cur.back)}</div></div></div>
        <div class="fc-controls"><button class="btn icon" id="sayCard" title="Read aloud">🔊</button><button class="btn" id="prev">${icon('chevL')} Prev</button><button class="btn danger" id="dunno">Still learning</button><button class="btn" style="color:var(--green)" id="know">${icon('check')} Got it</button><button class="btn" id="next">Next ${icon('chevR')}</button></div>
        <div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn sm ghost" id="shuffle">🔀 Shuffle</button><button class="btn sm ghost" id="onlyU">${deck.onlyUnknown ? '✓ Only unknown' : 'Only unknown'}</button><button class="btn sm ghost" id="resetK">Reset progress</button></div></div>`}`;
  $('#vStudy').onclick = () => { deck.view = 'study'; cardsTab(s, body); };
  $('#vList').onclick = () => { deck.view = 'list'; cardsTab(s, body); };
  $('#more').onclick = () => { const m = modal(`<h2>More flashcards</h2>${cfg}<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">${icon('sparkle')} Generate</button></div>`); $('#go', m.el).onclick = async () => { busy($('#go', m.el), true, 'Making cards…'); await genCards(s, body, +$('#cCount', m.el).value); m.close(); }; };
  const save = () => api.patch('/study/' + s.id, { cards: s.cards });
  const rk = $('#resetK'); if (rk) rk.onclick = async () => { s.cards.forEach(c => c.box = 0); await save(); deck.i = 0; cardsTab(s, body); };
  if (deck.view !== 'study' || !cards.length) return;
  const flip = () => { deck.flipped = !deck.flipped; $('#fc').classList.toggle('flipped', deck.flipped); };
  const move = (d) => { deck.i = (deck.i + d + cards.length) % cards.length; deck.flipped = false; cardsTab(s, body); };
  $('#fc').onclick = flip; $('#prev').onclick = () => move(-1); $('#next').onclick = () => move(1);
  $('#sayCard').onclick = (e) => { e.stopPropagation(); voice.speak(deck.flipped ? cur.back : cur.front); };
  $('#know').onclick = async () => { cur.box = Math.max(1, cur.box || 0); cur.due = Date.now() + 86400000; cur.seen = (cur.seen || 0) + 1; save(); move(1); };
  $('#dunno').onclick = async () => { cur.box = 0; cur.due = 0; cur.seen = (cur.seen || 0) + 1; save(); move(1); };
  $('#shuffle').onclick = () => { deck.order.sort(() => Math.random() - 0.5); deck.i = 0; deck.flipped = false; cardsTab(s, body); };
  $('#onlyU').onclick = () => { deck.onlyUnknown = !deck.onlyUnknown; deck.i = 0; cardsTab(s, body); };
  setKeys((e) => { if (e.target.closest('input,textarea')) return; if (e.code === 'Space') { e.preventDefault(); flip(); } if (e.key === 'ArrowRight') move(1); if (e.key === 'ArrowLeft') move(-1); if (e.key === '1') $('#dunno')?.click(); if (e.key === '2') $('#know')?.click(); });
}
async function genCards(s, body, count) {
  const btn = $('#gen'); if (btn) busy(btn, true, 'Making cards…');
  try { const r = await api(`/study/${s.id}/cards`, { body: { count: count || +($('#cCount')?.value || 20) } }); s.cards = r.cards; deck = null; invalidate(); cardsTab(s, body); toast('Flashcards ready!', 'ok'); }
  catch (e) { toast(e.message, 'err'); if (btn) busy(btn, false); }
}

// --- tutor
function tutorTab(s, body) {
  const msgs = s.chat || [];
  body.innerHTML = `<div class="chat"><div class="msgs" id="msgs">${msgs.length ? msgs.map(m => `<div class="m ${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'user' ? esc(m.content) : '<div class="md">' + md(m.content) + '</div>'}</div>`).join('') : `<div class="m ai"><div class="md"><p>Hi! I'm your tutor for <b>${esc(s.title)}</b>. I've read your notes${s.sheet ? ' and study sheet' : ''}. Ask me to explain anything, quiz you, or check your understanding. 😊</p></div></div>`}</div>
    <form id="chatForm"><button type="button" class="btn icon" id="micBtn" title="Speak your question">🎙</button><input id="chatIn" placeholder="Ask anything about this topic… (or tap the mic)" autocomplete="off"><button class="btn primary" type="submit">Send</button></form></div>
    <div class="btn-row" style="margin-top:8px;align-items:center"><label class="chip"><input type="checkbox" id="speakToggle" ${localStorage.getItem('dwb_speak') === '1' ? 'checked' : ''}> 🔊 Read answers aloud</label><button class="btn sm primary" id="voiceQuiz">🎙 Voice quiz</button><button class="btn sm ghost sug">Explain the hardest part simply</button><button class="btn sm ghost sug">Quiz me with 3 questions</button><button class="btn sm ghost sug">What should I focus on most?</button></div>`;
  const box = $('#msgs');
  const send = async (text) => {
    if (!text.trim()) return;
    msgs.push({ role: 'user', content: text });
    box.appendChild(h(`<div class="m user">${esc(text)}</div>`));
    const ai = h(`<div class="m ai"><div class="md"><span class="spinner"></span></div></div>`); box.appendChild(ai); box.scrollTop = box.scrollHeight;
    let reply = '';
    try {
      await stream(`/study/${s.id}/chat`, { messages: msgs }, (t) => { reply += t; $('.md', ai).innerHTML = md(reply); box.scrollTop = box.scrollHeight; });
      msgs.push({ role: 'assistant', content: reply }); s.chat = msgs;
      if (localStorage.getItem('dwb_speak') === '1') voice.speak(reply, () => { if (voiceMode) listen(); });
      else if (voiceMode) listen();
    } catch (e) { $('.md', ai).innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  };
  let voiceMode = false, rec = null;
  const listen = () => { const mic = $('#micBtn'); if (!mic) return; mic.classList.add('listening'); mic.textContent = '🔴'; rec = voice.listen((t, isFinal) => { $('#chatIn').value = t; if (isFinal && t.trim()) { $('#chatIn').value = ''; send(t); } }, () => { mic.classList.remove('listening'); mic.textContent = '🎙'; }); };
  $('#micBtn').onclick = () => { if (rec) { try { rec.stop(); } catch {} rec = null; return; } listen(); };
  $('#speakToggle').onchange = (e) => { localStorage.setItem('dwb_speak', e.target.checked ? '1' : '0'); if (!e.target.checked) voice.stop(); };
  $('#voiceQuiz').onclick = () => { voiceMode = !voiceMode; $('#voiceQuiz').textContent = voiceMode ? '⏹ Stop voice quiz' : '🎙 Voice quiz'; if (voiceMode) { localStorage.setItem('dwb_speak', '1'); $('#speakToggle').checked = true; send('Quiz me out loud: ask me ONE short question at a time from my notes, wait for my answer, tell me if I was right (briefly), then ask the next one. Start now.'); } else { voice.stop(); if (rec) { try { rec.stop(); } catch {} } } };
  window.addEventListener('hashchange', () => { voice.stop(); if (rec) { try { rec.stop(); } catch {} } }, { once: true });
  $('#chatForm').onsubmit = (e) => { e.preventDefault(); const v = $('#chatIn').value; $('#chatIn').value = ''; send(v); };
  $$('.sug').forEach(b => b.onclick = () => send(b.textContent));
  box.scrollTop = box.scrollHeight;
}

// --- sources
async function editSources(s) {
  const nbs = await loadNotebooks();
  const chosen = new Set(s.pageIds);
  const m = modal(`<h2>Study sources</h2>
    <div class="field"><label>Topic details</label><textarea id="topic">${esc(s.topic || '')}</textarea></div>
    <div class="field"><label>Links to study from <span class="muted">(websites, articles, class pages — the AI reads them)</span></label><div class="links-box" id="srcLinks">${(s.links || []).map(u => `<div class="link-row"><span>🔗 ${esc(u)}</span><button type="button" class="btn icon sm ghost rmLink">${icon('x')}</button></div>`).join('')}<div class="row"><input class="input" id="srcLinkIn" placeholder="https://…"><button type="button" class="btn sm" id="srcAddLink">Add</button></div></div></div>
    <div class="field"><label>Notebook pages</label><div class="row" style="margin-bottom:6px"><select id="stNb"><option value="">Choose a notebook…</option>${nbs.map(n => `<option value="${n.id}">${esc(n.name)} (${n.scanned} pages)</option>`).join('')}</select><button class="btn sm" id="selAll" type="button">Select all</button></div><div class="src-pages" id="srcPages"><span class="muted small">${chosen.size} page(s) currently selected. Pick a notebook to change.</span></div><div class="help" id="selCount">${chosen.size} page(s) selected</div></div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">Save</button></div>`, { wide: true });
  const el = m.el;
  $('#stNb', el).onchange = async () => {
    const id = $('#stNb', el).value; const box = $('#srcPages', el); if (!id) return;
    box.innerHTML = '<span class="spinner"></span>';
    const nb = await api('/notebooks/' + id + '?lite=1');
    box.innerHTML = nb.pages.length ? nb.pages.map(p => `<label><input type="checkbox" value="${p.id}" ${chosen.has(p.id) ? 'checked' : ''}><span>p.${p.index} ${esc(p.title || '')}</span></label>`).join('') : '<span class="muted small">No scanned pages yet.</span>';
    $$('input', box).forEach(c => c.onchange = () => { c.checked ? chosen.add(c.value) : chosen.delete(c.value); $('#selCount', el).textContent = chosen.size + ' page(s) selected'; });
    $('#selAll', el).onclick = () => { $$('input', box).forEach(c => { c.checked = true; chosen.add(c.value); }); $('#selCount', el).textContent = chosen.size + ' page(s) selected'; };
  };
  const wireRm2 = () => $$('.rmLink', el).forEach(b => b.onclick = () => b.closest('.link-row').remove()); wireRm2();
  $('#srcAddLink', el).onclick = () => { const u = $('#srcLinkIn', el).value.trim(); if (!/^https?:\/\//i.test(u)) return toast('Paste a full link starting with http', 'err'); $('#srcLinkIn', el).value = ''; $('#srcLinkIn', el).closest('.row').insertAdjacentHTML('beforebegin', `<div class="link-row"><span>🔗 ${esc(u)}</span><button type="button" class="btn icon sm ghost rmLink">${icon('x')}</button></div>`); wireRm2(); };
  $('#save', el).onclick = async () => { busy($('#save', el), true, 'Saving (reading links)…'); const links = $$('#srcLinks .link-row span', el).map(sp => sp.textContent.replace(/^🔗\s*/, '').trim()); await api.patch('/study/' + s.id, { topic: $('#topic', el).value, pageIds: [...chosen], links }); invalidate(); m.close(); toast('Sources updated — regenerate to use them', 'ok'); dispatch(); };
}
