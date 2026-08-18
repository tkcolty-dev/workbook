import { state, api, stream, $, $$, esc, h, md, mdi, icon, toast, modal, confirm, busy, fmtDate, countdown, daysUntil, ago, loadNotebooks, loadEvents, loadStudy, invalidate, go, dispatch } from './core.js';
import { shell } from './app.js';

// ---------- list ----------
export async function studyListView(_, q = {}) {
  const main = shell('Study', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const [sets, evs] = await Promise.all([loadStudy(true), loadEvents(true)]);
  const today = new Date().toISOString().slice(0, 10);
  const testsSoon = evs.filter(e => !e.done && (e.type === 'test' || e.type === 'quiz') && e.date >= today && !e.studyId).slice(0, 4);
  main.innerHTML = `<div class="page-head"><div><h1>Study</h1><div class="sub">Study sheets from your notes, extra help from the web, practice tests and flashcards — all made by AI from what you scanned.</div></div><button class="btn primary" id="newSet">${icon('plus')} New study set</button></div>
    ${testsSoon.length ? `<div class="card" style="margin-bottom:18px;background:linear-gradient(135deg,#fff5f2,#fff);border-color:#f7d5cd"><h3>${icon('zap')} Tests coming up without a study set</h3><div class="btn-row" style="margin-top:8px">${testsSoon.map(e => `<a class="btn sm" href="#/study?new=1&event=${e.id}">${esc(e.title)} · <span class="muted">${countdown(e.date)}</span></a>`).join('')}</div></div>` : ''}
    <div class="study-list grid cols-2">${sets.sort((a, b) => b.updatedAt - a.updatedAt).map(s => { const ev = evs.find(e => e.id === s.eventId); const best = Math.max(0, ...s.tests.flatMap(t => t.attempts.map(a => a.percent))); return `<div class="card" onclick="location.hash='#/study/${s.id}'"><div class="icon">${icon('study')}</div><div style="flex:1;min-width:0"><b>${esc(s.title)}</b><div class="muted small">${esc(s.subject || '')}${ev ? ' · ' + fmtDate(ev.date) + ' (' + countdown(ev.date) + ')' : ''}</div><div class="chips" style="margin-top:6px">${s.sheet ? '<span class="chip green">📝 sheet</span>' : ''}${s.online ? '<span class="chip blue">🌐 online</span>' : ''}${s.tests.length ? `<span class="chip amber">✅ ${s.tests.length} test${s.tests.length === 1 ? '' : 's'}${best ? ' · best ' + best + '%' : ''}</span>` : ''}${s.cards.length ? `<span class="chip purple">🃏 ${s.cards.length} cards</span>` : ''}${!s.sheet && !s.online && !s.tests.length && !s.cards.length ? '<span class="chip">new</span>' : ''}</div></div>${icon('chevR', 'muted')}</div>`; }).join('')}</div>
    ${!sets.length ? `<div class="empty"><div class="big">🎓</div><h3>No study sets yet</h3><p>Pick a test from your planner (or any topic), choose the notebook pages it covers, and WorkBook builds your study kit.</p><button class="btn primary" id="newSet2">${icon('plus')} Create a study set</button></div>` : ''}`;
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
    <div class="field"><label>Notebook pages to study from</label>
      <div class="row" style="margin-bottom:6px"><select id="stNb"><option value="">Choose a notebook…</option>${nbs.map(n => `<option value="${n.id}" ${n.id === preNb ? 'selected' : ''}>${esc(n.name)} (${n.scanned} pages)</option>`).join('')}</select><button class="btn sm" id="selAll" type="button">Select all</button></div>
      <div class="src-pages" id="srcPages"><span class="muted small">Pick a notebook above.</span></div><div class="help" id="selCount"></div></div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="create">Create study set</button></div>`, { wide: true });
  const el = m.el; const chosen = new Set();
  const loadPages = async () => {
    const id = $('#stNb', el).value; const box = $('#srcPages', el);
    if (!id) { box.innerHTML = '<span class="muted small">Pick a notebook above.</span>'; return; }
    box.innerHTML = '<span class="spinner"></span>';
    const nb = await api('/notebooks/' + id);
    if (!nb.pages.length) { box.innerHTML = `<span class="muted small">No scanned pages in this notebook yet — <a href="#/scan/${nb.id}">scan some</a>.</span>`; return; }
    box.innerHTML = nb.pages.map(p => `<label><input type="checkbox" value="${p.id}" ${chosen.has(p.id) ? 'checked' : ''}><span>p.${p.index} ${esc(p.title || '')}</span></label>`).join('');
    $$('input', box).forEach(c => c.onchange = () => { c.checked ? chosen.add(c.value) : chosen.delete(c.value); $('#selCount', el).textContent = chosen.size + ' page(s) selected'; });
    $('#selAll', el).onclick = () => { $$('input', box).forEach(c => { c.checked = true; chosen.add(c.value); }); $('#selCount', el).textContent = chosen.size + ' page(s) selected'; };
  };
  $('#stNb', el).onchange = loadPages; loadPages();
  $('#create', el).onclick = async () => {
    const body = { title: $('#stTitle', el).value.trim(), subject: $('#stSubject', el).value.trim(), topic: $('#stTopic', el).value.trim(), eventId: $('#stEvent', el).value || null, pageIds: [...chosen] };
    if (!body.title) return toast('Give it a title', 'err');
    busy($('#create', el), true, 'Creating…');
    try { const s = await api('/study', { body }); invalidate(); m.close(); go('#/study/' + s.id); } catch (e) { toast(e.message, 'err'); busy($('#create', el), false); }
  };
}

// ---------- study room ----------
let tab = 'sheet';
export async function studyView({ id }, q = {}) {
  const main = shell('Study', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const [s, evs] = await Promise.all([api('/study/' + id), loadEvents()]);
  const ev = evs.find(e => e.id === s.eventId);
  if (q.tab) tab = q.tab;
  if (q.take) { const t = s.tests.find(t => t.id === q.take); if (t) { activeTest = { setId: s.id, test: t, answers: {}, attempt: null }; tab = 'test'; } }
  const TABS = [['sheet', 'sheet', 'Study sheet'], ['online', 'globe', 'More online'], ['test', 'quiz', 'Practice tests'], ['cards', 'cards', 'Flashcards'], ['tutor', 'chat', 'Tutor']];
  main.innerHTML = `<div class="crumbs"><a href="#/study">Study</a> › <span>${esc(s.title)}</span></div>
    <div class="page-head"><div><h1>${esc(s.title)}</h1><div class="sub">${esc(s.subject || '')}${ev ? ` · ${fmtDate(ev.date)} · <b class="countdown ${daysUntil(ev.date) <= 3 ? 'urgent' : ''}">${countdown(ev.date)}</b>` : ''} · ${s.pageIds.length} notebook page${s.pageIds.length === 1 ? '' : 's'}</div></div>
      <div class="btn-row"><button class="btn" id="editSrc">${icon('edit')} Sources</button><button class="btn danger icon" id="delSet">${icon('trash')}</button></div></div>
    <div class="tabs">${TABS.map(([k, ic, l]) => `<button data-t="${k}" class="${tab === k ? 'active' : ''}">${icon(ic)} ${l}${k === 'test' && s.tests.length ? `<span class="cnt">${s.tests.length}</span>` : ''}${k === 'cards' && s.cards.length ? `<span class="cnt">${s.cards.length}</span>` : ''}</button>`).join('')}</div>
    <div id="tabBody"></div>`;
  $$('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('.tabs button').forEach(x => x.classList.toggle('active', x === b)); drawTab(s); });
  $('#editSrc').onclick = () => editSources(s);
  $('#delSet').onclick = async () => { if (await confirm('Delete study set?', 'Sheet, tests and flashcards will be removed.')) { await api.del('/study/' + s.id); invalidate(); go('#/study'); } };
  drawTab(s);
}
function drawTab(s) {
  const body = $('#tabBody');
  ({ sheet: sheetTab, online: onlineTab, test: testTab, cards: cardsTab, tutor: tutorTab }[tab] || sheetTab)(s, body);
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
let activeTest = null; // { test, answers, attempt }
export function testConfigHtml(s, opts = {}) {
  return `<div class="card flat" style="margin:0 auto 14px;max-width:560px;text-align:left">
    <div class="field"><label>Test type</label><div class="test-styles">
      <label class="tstyle ${opts.style !== 'remake' ? 'on' : ''}"><input type="radio" name="tStyle" value="standard" ${opts.style !== 'remake' ? 'checked' : ''}><b>📝 Standard test</b><span>Multiple choice, true/false and short answers about the material</span></label>
      <label class="tstyle ${opts.style === 'remake' ? 'on' : ''}"><input type="radio" name="tStyle" value="remake" ${opts.style === 'remake' ? 'checked' : ''}><b>🔁 Same page, new numbers</b><span>A copy of your page's problems with different numbers/examples — great for math &amp; worksheets</span></label></div></div>
    <div class="field"><label>What's the test about? <span class="muted">(optional — helps the AI focus)</span></label><input type="text" id="tAbout" class="input" value="${esc(opts.about || s.topic || '')}" placeholder="e.g. adding fractions and repeating decimals, chapter 5 organelles…"></div>
    <div class="row"><div class="field"><label>Questions</label><select id="tCount">${[5, 10, 15, 20, 30].map(n => `<option ${n === (opts.count || 10) ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div class="field" id="diffField"><label>Difficulty</label><select id="tDiff"><option value="easy">Easy</option><option value="mixed" selected>Mixed</option><option value="hard">Hard</option></select></div></div>
    <div class="field" id="typesField"><label>Question types</label><div class="btn-row"><label class="chip"><input type="checkbox" class="tType" value="mc" checked> Multiple choice</label><label class="chip"><input type="checkbox" class="tType" value="tf" checked> True / False</label><label class="chip"><input type="checkbox" class="tType" value="short" checked> Short answer</label></div></div></div>`;
}
export function wireTestConfig(root = document) {
  const upd = () => { const remake = $('input[name=tStyle]:checked', root)?.value === 'remake'; $$('.tstyle', root).forEach(l => l.classList.toggle('on', $('input', l).checked)); const tf = $('#typesField', root), df = $('#diffField', root); if (tf) tf.style.display = remake ? 'none' : ''; if (df) df.style.display = remake ? 'none' : ''; };
  $$('input[name=tStyle]', root).forEach(r => r.onchange = upd); upd();
}
export function readTestConfig(root = document) {
  const style = $('input[name=tStyle]:checked', root)?.value || 'standard';
  const types = $$('.tType', root).filter(c => c.checked).map(c => c.value);
  if (style === 'standard' && !types.length) { toast('Pick at least one question type', 'err'); return null; }
  return { style, types, count: +$('#tCount', root).value, difficulty: $('#tDiff', root)?.value || 'mixed', about: $('#tAbout', root)?.value.trim() || '' };
}
// "Test on this page": create a study set from one page and generate a test right away.
export async function testOnPage(page, nb) {
  const fake = { topic: '', title: page.title || nb.name };
  const m = modal(`<h2>Test on this page</h2><p class="muted small" style="margin:-6px 0 12px">“${esc(page.title || 'Page ' + page.index)}” · ${esc(nb.name)}</p>${testConfigHtml(fake, { about: page.title || '', count: 10 })}<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="goTest">${icon('sparkle')} Make the test</button></div>`, { wide: true });
  wireTestConfig(m.el);
  $('#goTest', m.el).onclick = async () => {
    const cfg = readTestConfig(m.el); if (!cfg) return;
    busy($('#goTest', m.el), true, cfg.style === 'remake' ? 'Rewriting with new numbers…' : 'Writing your test…');
    try {
      const set = await api('/study', { body: { title: (page.title || 'Page ' + page.index) + ' — test', subject: nb.subject || '', topic: cfg.about, pageIds: [page.id] } });
      const t = await api(`/study/${set.id}/test`, { body: cfg });
      invalidate(); m.close(); go(`#/study/${set.id}?tab=test&take=${t.id}`);
    } catch (e) { toast(e.message, 'err'); busy($('#goTest', m.el), false); }
  };
}
function testTab(s, body) {
  if (activeTest && activeTest.setId === s.id) return drawQuiz(s, body);
  const cfg = testConfigHtml(s);
  body.innerHTML = `${s.tests.length ? `<div class="grid cols-2" style="margin-bottom:20px">${s.tests.slice().reverse().map(t => { const best = Math.max(0, ...t.attempts.map(a => a.percent)); const last = t.attempts[t.attempts.length - 1]; return `<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><b>${esc(t.title)}</b> ${t.style === 'remake' ? '<span class="chip purple">worksheet · new numbers</span>' : ''}${t.description ? `<div class="small" style="margin:2px 0 4px;color:var(--ink-2)">${esc(t.description)}</div>` : ''}<div class="muted small">${t.questions.length} questions · ${ago(t.createdAt)}${t.attempts.length ? ` · ${t.attempts.length} attempt${t.attempts.length === 1 ? '' : 's'} · best <b style="color:var(--green)">${best}%</b>` : ' · not taken yet'}</div></div><button class="btn icon sm ghost delT" data-id="${t.id}">${icon('trash')}</button></div><div class="btn-row" style="margin-top:10px"><button class="btn primary sm takeT" data-id="${t.id}">${icon('quiz')} ${t.attempts.length ? 'Take again' : 'Take test'}</button>${last ? `<button class="btn sm reviewT" data-id="${t.id}">Review last (${last.percent}%)</button>` : ''}</div></div>`; }).join('')}</div>` : ''}
    ${genBox({ emoji: '✅', title: s.tests.length ? 'Make another practice test' : 'Make a practice test', text: 'AI writes a real test on this material. You take it online and get graded instantly — including your written answers.', btn: 'Generate test', id: 'gen', extra: cfg })}`;
  wireTestConfig();
  $('#gen').onclick = async () => {
    const cfgv = readTestConfig(); if (!cfgv) return;
    busy($('#gen'), true, cfgv.style === 'remake' ? 'Rewriting your page with new numbers…' : 'Writing your test…');
    try { const t = await api(`/study/${s.id}/test`, { body: cfgv }); s.tests.push(t); invalidate(); activeTest = { setId: s.id, test: t, answers: {}, attempt: null }; drawQuiz(s, body); }
    catch (e) { toast(e.message, 'err'); busy($('#gen'), false); }
  };
  $$('.takeT').forEach(b => b.onclick = () => { activeTest = { setId: s.id, test: s.tests.find(t => t.id === b.dataset.id), answers: {}, attempt: null }; drawQuiz(s, body); });
  $$('.reviewT').forEach(b => b.onclick = () => { const t = s.tests.find(t => t.id === b.dataset.id); const a = t.attempts[t.attempts.length - 1]; activeTest = { setId: s.id, test: t, answers: a.answers, attempt: a }; drawQuiz(s, body); });
  $$('.delT').forEach(b => b.onclick = async () => { if (await confirm('Delete this test?', 'Its attempts will be removed too.')) { await api.del(`/study/${s.id}/test/${b.dataset.id}`); s.tests = s.tests.filter(t => t.id !== b.dataset.id); invalidate(); testTab(s, body); } });
}
function drawQuiz(s, body) {
  const { test, answers, attempt } = activeTest;
  const L = 'ABCD';
  body.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px"><div><h2>${esc(test.title)}</h2>${test.description ? `<div style="color:var(--ink-2);margin:2px 0">${esc(test.description)}</div>` : ''}<div class="muted small">${test.questions.length} ${test.style === 'remake' ? 'problems · same as your page, new numbers' : 'questions'}${attempt ? ' · graded' : ''}</div></div><button class="btn sm" id="backT">${icon('chevL')} All tests</button></div>
    ${attempt ? `<div class="card score-card" style="margin-bottom:16px"><div class="score-ring" style="--p:${attempt.percent}"><div>${attempt.percent}%</div></div><div style="font-family:var(--serif);font-size:20px">${attempt.percent >= 90 ? 'Outstanding! 🌟' : attempt.percent >= 75 ? 'Nice work! 👏' : attempt.percent >= 50 ? 'Getting there — review the misses 💪' : 'Keep studying — you’ve got this 📚'}</div><div class="muted small">${Math.round(attempt.score * 10) / 10} / ${attempt.total} points</div><div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="again">${icon('refresh')} Try again</button><button class="btn" id="newT">${icon('sparkle')} New test</button></div></div>` : ''}
    <div id="qs">${test.questions.map((q, i) => { const r = attempt?.results?.[q.id]; const a = answers[q.id]; return `<div class="q" data-id="${q.id}"><div class="qn">Question ${i + 1} · ${q.type === 'mc' ? 'Multiple choice' : q.type === 'tf' ? 'True or false' : 'Short answer'}</div><div class="qt">${mdi(q.question)}</div>
      ${q.type === 'mc' ? `<div class="choices">${q.choices.map((c, ci) => `<div class="choice ${a === ci ? 'sel' : ''} ${attempt ? (ci === Number(q.answer) ? 'right' : (a === ci ? 'wrong' : '')) : ''}" data-ci="${ci}"><span class="letter">${L[ci]}</span><span>${mdi(c)}</span></div>`).join('')}</div>`
        : q.type === 'tf' ? `<div class="choices">${[true, false].map(v => `<div class="choice ${String(a) === String(v) ? 'sel' : ''} ${attempt ? (String(v) === String(q.answer) ? 'right' : (String(a) === String(v) ? 'wrong' : '')) : ''}" data-v="${v}"><span class="letter">${v ? 'T' : 'F'}</span><span>${v ? 'True' : 'False'}</span></div>`).join('')}</div>`
        : `<textarea placeholder="Type your answer…" ${attempt ? 'disabled' : ''}>${esc(a || '')}</textarea>`}
      ${attempt ? `<div class="fb ${r?.correct ? 'ok' : 'bad'}">${r?.correct ? '✅ Correct' : (r?.score === 0.5 ? '🟡 Partly right' : '❌ Not quite')}${q.type === 'short' ? ` — <b>Model answer:</b> ${mdi(q.answer)}` : (r?.correct ? '' : ` — <b>Answer:</b> ${q.type === 'mc' ? mdi(q.choices[q.answer]) : (q.answer ? 'True' : 'False')}`)}${r?.feedback ? `<div style="margin-top:4px">${mdi(r.feedback)}</div>` : ''}${q.explanation ? `<div style="margin-top:4px;opacity:.85">${mdi(q.explanation)}</div>` : ''}</div>` : ''}
    </div>`; }).join('')}</div>
    ${!attempt ? `<div style="position:sticky;bottom:12px;text-align:center;margin-top:8px"><button class="btn primary lg" id="submit">${icon('check')} Submit test</button></div>` : ''}`;
  $('#backT').onclick = () => { activeTest = null; testTab(s, body); };
  if (attempt) { $('#again').onclick = () => { activeTest = { setId: s.id, test, answers: {}, attempt: null }; drawQuiz(s, body); }; $('#newT').onclick = () => { activeTest = null; testTab(s, body); $('#gen')?.scrollIntoView({ behavior: 'smooth' }); }; return; }
  $$('.q').forEach(qel => {
    const id = qel.dataset.id;
    $$('.choice', qel).forEach(c => c.onclick = () => { $$('.choice', qel).forEach(x => x.classList.remove('sel')); c.classList.add('sel'); answers[id] = c.dataset.ci !== undefined ? +c.dataset.ci : c.dataset.v === 'true'; });
    const ta = $('textarea', qel); if (ta) ta.oninput = () => { answers[id] = ta.value; };
  });
  $('#submit').onclick = async () => {
    const missing = test.questions.filter(q => answers[q.id] === undefined || answers[q.id] === '').length;
    if (missing && !(await confirm(`${missing} unanswered`, 'Submit anyway? Blank answers count as wrong.', { danger: false, ok: 'Submit' }))) return;
    busy($('#submit'), true, 'Grading…');
    try { const a = await api(`/study/${s.id}/test/${test.id}/grade`, { body: { answers } }); test.attempts.push(a); activeTest.attempt = a; invalidate(); drawQuiz(s, body); window.scrollTo({ top: 0, behavior: 'smooth' }); }
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
  const cards = deck.onlyUnknown ? deck.order.filter(i => (s.cards[i].box || 0) < 1) : deck.order;
  if (deck.i >= cards.length) deck.i = 0;
  const cur = s.cards[cards[deck.i]];
  body.innerHTML = `<div class="fc-meta"><div><b style="color:var(--ink)">${s.cards.length} cards</b> · ${known} known · ${s.cards.length - known} still learning</div><div class="btn-row"><div class="seg"><button class="${deck.view === 'study' ? 'active' : ''}" id="vStudy">Study</button><button class="${deck.view === 'list' ? 'active' : ''}" id="vList">All cards</button></div><button class="btn sm" id="more">${icon('plus')} More cards</button></div></div>
    ${deck.view === 'list' ? `<div class="fc-list">${s.cards.map((c, i) => `<div class="card"><span class="st chip ${c.box >= 1 ? 'green' : ''}">${c.box >= 1 ? 'known' : 'learning'}</span><b>${mdi(c.front)}</b><div class="muted">${mdi(c.back)}</div></div>`).join('')}</div>` :
      !cards.length ? `<div class="empty"><div class="big">🎉</div><h3>You know them all!</h3><p>Every card is marked known. Reset to drill again.</p><button class="btn" id="resetK">Reset progress</button></div>` :
      `<div class="fc-stage"><div class="fc ${deck.flipped ? 'flipped' : ''}" id="fc"><div class="face front"><span class="lab">Question · ${deck.i + 1} / ${cards.length}</span><div>${mdi(cur.front)}</div>${cur.hint ? `<span class="hint">Hint: ${esc(cur.hint)}</span>` : '<span class="hint">tap to flip · space</span>'}</div><div class="face back"><span class="lab">Answer</span><div>${mdi(cur.back)}</div></div></div>
        <div class="fc-controls"><button class="btn" id="prev">${icon('chevL')} Prev</button><button class="btn danger" id="dunno">Still learning</button><button class="btn" style="color:var(--green)" id="know">${icon('check')} Got it</button><button class="btn" id="next">Next ${icon('chevR')}</button></div>
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
  $('#know').onclick = async () => { cur.box = 1; cur.seen = (cur.seen || 0) + 1; save(); move(1); };
  $('#dunno').onclick = async () => { cur.box = 0; cur.seen = (cur.seen || 0) + 1; save(); move(1); };
  $('#shuffle').onclick = () => { deck.order.sort(() => Math.random() - 0.5); deck.i = 0; deck.flipped = false; cardsTab(s, body); };
  $('#onlyU').onclick = () => { deck.onlyUnknown = !deck.onlyUnknown; deck.i = 0; cardsTab(s, body); };
  document.onkeydown = (e) => { if (e.target.closest('input,textarea')) return; if (e.code === 'Space') { e.preventDefault(); flip(); } if (e.key === 'ArrowRight') move(1); if (e.key === 'ArrowLeft') move(-1); if (e.key === '1') $('#dunno').click(); if (e.key === '2') $('#know').click(); };
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
    <form id="chatForm"><input id="chatIn" placeholder="Ask anything about this topic…" autocomplete="off"><button class="btn primary" type="submit">Send</button></form></div>
    <div class="btn-row" style="margin-top:8px"><button class="btn sm ghost sug">Explain the hardest part simply</button><button class="btn sm ghost sug">Quiz me with 3 questions</button><button class="btn sm ghost sug">What should I focus on most?</button></div>`;
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
    } catch (e) { $('.md', ai).innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  };
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
    <div class="field"><label>Notebook pages</label><div class="row" style="margin-bottom:6px"><select id="stNb"><option value="">Choose a notebook…</option>${nbs.map(n => `<option value="${n.id}">${esc(n.name)} (${n.scanned} pages)</option>`).join('')}</select><button class="btn sm" id="selAll" type="button">Select all</button></div><div class="src-pages" id="srcPages"><span class="muted small">${chosen.size} page(s) currently selected. Pick a notebook to change.</span></div><div class="help" id="selCount">${chosen.size} page(s) selected</div></div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">Save</button></div>`, { wide: true });
  const el = m.el;
  $('#stNb', el).onchange = async () => {
    const id = $('#stNb', el).value; const box = $('#srcPages', el); if (!id) return;
    box.innerHTML = '<span class="spinner"></span>';
    const nb = await api('/notebooks/' + id);
    box.innerHTML = nb.pages.length ? nb.pages.map(p => `<label><input type="checkbox" value="${p.id}" ${chosen.has(p.id) ? 'checked' : ''}><span>p.${p.index} ${esc(p.title || '')}</span></label>`).join('') : '<span class="muted small">No scanned pages yet.</span>';
    $$('input', box).forEach(c => c.onchange = () => { c.checked ? chosen.add(c.value) : chosen.delete(c.value); $('#selCount', el).textContent = chosen.size + ' page(s) selected'; });
    $('#selAll', el).onclick = () => { $$('input', box).forEach(c => { c.checked = true; chosen.add(c.value); }); $('#selCount', el).textContent = chosen.size + ' page(s) selected'; };
  };
  $('#save', el).onclick = async () => { await api.patch('/study/' + s.id, { topic: $('#topic', el).value, pageIds: [...chosen] }); invalidate(); m.close(); toast('Sources updated — regenerate to use them', 'ok'); dispatch(); };
}
