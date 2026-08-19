import { state, api, stream, $, $$, esc, h, md, mdi, icon, toast, modal, confirm, busy, fmtDate, countdown, daysUntil, ago, loadNotebooks, loadEvents, loadStudy, invalidate, go, dispatch } from './core.js';
import { shell } from './app.js';
import { cramTab, voice, shareThing } from './extras.js';

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
    const nb = await api('/notebooks/' + id);
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
  const main = shell('Study', `<div class="thinking"><span class="spinner"></span> Loading…</div>`);
  const [s, evs] = await Promise.all([api('/study/' + id), loadEvents()]);
  const ev = evs.find(e => e.id === s.eventId);
  if (q.tab) tab = q.tab;
  if (q.take) { const t = s.tests.find(t => t.id === q.take); if (t) { let cfg = {}; try { cfg = JSON.parse(sessionStorage.getItem('dwb_take_cfg') || '{}'); } catch {} sessionStorage.removeItem('dwb_take_cfg'); startTest(s, t, cfg); tab = 'test'; } }
  const TABS = [['sheet', 'sheet', 'Study sheet'], ['online', 'globe', 'More online'], ['test', 'quiz', 'Practice tests'], ['cards', 'cards', 'Flashcards'], ['tutor', 'chat', 'Tutor'], ['cram', 'zap', '⚡ Cram']];
  if (q.fixit && s.graded) tab = 'cards';
  main.innerHTML = `<div class="crumbs"><a href="#/study">Study</a> › <span>${esc(s.title)}</span></div>
    <div class="page-head"><div><h1>${esc(s.title)}</h1><div class="sub">${esc(s.subject || '')}${ev ? ` · ${fmtDate(ev.date)} · <b class="countdown ${daysUntil(ev.date) <= 3 ? 'urgent' : ''}">${countdown(ev.date)}</b>` : ''} · ${s.pageIds.length} notebook page${s.pageIds.length === 1 ? '' : 's'}${s.links?.length ? ` · 🔗 ${s.links.length} link${s.links.length === 1 ? '' : 's'}` : ''}</div></div>
      <div class="btn-row"><button class="btn" id="shareSet">${icon('upload')} Share</button><button class="btn" id="editSrc">${icon('edit')} Sources</button><button class="btn danger icon" id="delSet">${icon('trash')}</button></div></div>
    ${s.graded ? `<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#fff5f2,#fff);border-color:#f7d5cd"><h3>📝 Fix-it set from your graded test${s.graded.testName ? ' — ' + esc(s.graded.testName) : ''}${s.graded.score ? ` <span class="chip red">${esc(s.graded.score)}</span>` : ''}</h3><div class="small" style="margin:6px 0">You missed <b>${s.graded.items.filter(i => i.markedWrong).length}</b> of ${s.graded.items.length}. Concepts to fix: ${(s.graded.missedConcepts || []).map(c => `<span class="chip amber">${esc(c)}</span>`).join(' ')}</div><details><summary class="small" style="cursor:pointer">See what was marked wrong</summary><div class="hw-items" style="margin-top:8px">${s.graded.items.filter(i => i.markedWrong).map(i => `<div class="hw-item wrong"><div class="hw-n">${esc(i.n)}</div><div class="hw-body"><div class="hw-q">${mdi(i.question)}</div><div class="small"><span class="muted">You wrote:</span> <b>${mdi(i.studentAnswer || '—')}</b>${i.correction ? ` · <span class="muted">Correct:</span> <b>${mdi(i.correction)}</b>` : ''}${i.concept ? ` · <span class="chip">${esc(i.concept)}</span>` : ''}</div></div></div>`).join('')}</div></details><div class="small muted" style="margin-top:6px">Flashcards and practice tests in this set are built from exactly these misses.</div></div>` : ''}
    <div class="tabs">${TABS.map(([k, ic, l]) => `<button data-t="${k}" class="${tab === k ? 'active' : ''}">${icon(ic)} ${l}${k === 'test' && s.tests.length ? `<span class="cnt">${s.tests.length}</span>` : ''}${k === 'cards' && s.cards.length ? `<span class="cnt">${s.cards.length}</span>` : ''}</button>`).join('')}</div>
    <div id="tabBody"></div>`;
  $$('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('.tabs button').forEach(x => x.classList.toggle('active', x === b)); drawTab(s); });
  $('#editSrc').onclick = () => editSources(s);
  $('#shareSet').onclick = () => shareThing('study', s.id, s.title);
  if (q.fixit && s.graded && !s.cards.length && sessionStorage.getItem('dwb_fixit')) { sessionStorage.removeItem('dwb_fixit'); toast('Making fix-it flashcards + a practice test…'); api(`/study/${s.id}/cards`, { body: { count: 12 } }).then(r => { s.cards = r.cards; if (tab === 'cards') drawTab(s); }).catch(() => {}); api(`/study/${s.id}/test`, { body: { count: 8, types: ['mc', 'short', 'fill'], about: 'only the concepts I missed on the graded test', difficulty: 3 } }).then(t => { s.tests.push(t); toast('Fix-it practice test ready ✅', 'ok'); }).catch(() => {}); }
  $('#delSet').onclick = async () => { if (await confirm('Delete study set?', 'Sheet, tests and flashcards will be removed.')) { await api.del('/study/' + s.id); invalidate(); go('#/study'); } };
  drawTab(s);
}
function drawTab(s) {
  const body = $('#tabBody');
  ({ sheet: sheetTab, online: onlineTab, test: testTab, cards: cardsTab, tutor: tutorTab, cram: cramTab }[tab] || sheetTab)(s, body);
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
const TYPE_LABEL = { mc: 'Multiple choice', tf: 'True or false', short: 'Short answer', fill: 'Fill in the blank', explain: 'Explain / show your work' };
export function testConfigHtml(s, opts = {}) {
  const pages = (opts.pages || []);
  return `<div class="card flat test-cfg" style="margin:0 auto 14px;max-width:640px;text-align:left">
    <div class="field"><label>Test type</label><div class="test-styles">
      <label class="tstyle ${opts.style !== 'remake' ? 'on' : ''}"><input type="radio" name="tStyle" value="standard" ${opts.style !== 'remake' ? 'checked' : ''}><b>📝 Standard test</b><span>Pick the question types below</span></label>
      <label class="tstyle ${opts.style === 'remake' ? 'on' : ''}"><input type="radio" name="tStyle" value="remake" ${opts.style === 'remake' ? 'checked' : ''}><b>🔁 Same page, new numbers</b><span>A copy of your page's problems with different numbers/examples</span></label>
      <label class="tstyle ${opts.style === 'prompt' ? 'on' : ''}"><input type="radio" name="tStyle" value="prompt" ${opts.style === 'prompt' ? 'checked' : ''}><b>✨ Custom — just tell it</b><span>Describe the test you want in your own words and the AI builds exactly that</span></label></div></div>
    <div class="field hidden" id="promptField"><label>Describe the test</label><textarea id="tPrompt" style="min-height:90px" placeholder="e.g. 12 questions on the causes of WW1, half multiple choice half short answer, hard, ask me to explain at least 2 · or: a 5-question vocab quiz from my notes, then 3 word problems like Mrs. K gives…">${esc(opts.prompt || '')}</textarea></div>
    <div class="field"><label>Links to use as material <span class="muted">(optional — websites, articles, class pages)</span></label><div class="links-box" id="linksBox">${(opts.links || []).map(u => `<div class="link-row"><span>🔗 ${esc(u)}</span><button type="button" class="btn icon sm ghost rmLink">${icon('x')}</button></div>`).join('')}<div class="row"><input class="input" id="linkIn" placeholder="https://…"><button type="button" class="btn sm" id="addLink">Add</button></div></div></div>
    <div class="field" id="typesField"><label>Question types</label><div class="btn-row">${Object.entries(TYPE_LABEL).map(([k, v]) => `<label class="chip"><input type="checkbox" class="tType" value="${k}" ${['mc', 'tf', 'short'].includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div></div>
    <div class="row"><div class="field"><label>How many questions <span class="muted" id="tCountLbl">(${opts.count || 10})</span></label><input type="range" id="tCount" min="1" max="50" value="${opts.count || 10}"></div>
      <div class="field"><label>Difficulty <span class="muted" id="tDiffLbl">(medium)</span></label><input type="range" id="tDiff" min="1" max="5" value="3"></div></div>
    <div class="field"><label>What's the test about? <span class="muted">(optional)</span></label><input type="text" id="tAbout" class="input" value="${esc(opts.about || s.topic || '')}" placeholder="e.g. adding fractions and repeating decimals, chapter 5 organelles…"></div>
    <div class="field"><label>Your instructions to the AI <span class="muted">(optional — anything goes)</span></label><textarea id="tInstr" placeholder="e.g. make it like Mrs. K's tests · only vocab words · include 3 word problems · ask me to show my work · make question 1 easy and the last one really hard · use soccer examples…" style="min-height:64px">${esc(opts.instructions || '')}</textarea></div>
    ${pages.length > 1 ? `<div class="field"><label>Pages to test on <span class="muted">(all if none picked)</span></label><div class="src-pages" style="max-height:140px">${pages.map(p => `<label><input type="checkbox" class="tPage" value="${p.id}"><span>p.${p.index} ${esc(p.title || '')}</span></label>`).join('')}</div></div>` : ''}
    <div class="field"><label>How you'll take it</label><div class="test-styles">
      <label class="tstyle on"><input type="radio" name="tMode" value="exam" checked><b>🎓 Exam mode</b><span>Answer everything, then get graded</span></label>
      <label class="tstyle"><input type="radio" name="tMode" value="practice"><b>🧪 Practice mode</b><span>Check each answer as you go, with hints</span></label></div></div>
    <div class="row"><div class="field"><label>Timer</label><select id="tTimer"><option value="0">No timer</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="20">20 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option></select></div>
      <div class="field"><label>Extras</label><div class="btn-row"><label class="chip"><input type="checkbox" id="tHints" checked> Hints available</label><label class="chip"><input type="checkbox" id="tShuffle"> Shuffle order</label></div></div></div>
  </div>`;
}
export function wireTestConfig(root = document) {
  const upd = () => { const st = $('input[name=tStyle]:checked', root)?.value; $$('.tstyle', root).forEach(l => l.classList.toggle('on', $('input', l).checked)); const tf = $('#typesField', root); if (tf) tf.style.display = st === 'standard' ? '' : 'none'; const pf = $('#promptField', root); if (pf) pf.classList.toggle('hidden', st !== 'prompt'); };
  $$('input[name=tStyle], input[name=tMode]', root).forEach(r => r.onchange = upd); upd();
  const addLink = $('#addLink', root), linkIn = $('#linkIn', root);
  if (addLink) { const add = () => { const u = linkIn.value.trim(); if (!/^https?:\/\//i.test(u)) return toast('Paste a full link starting with http', 'err'); linkIn.value = ''; linkIn.closest('.row').insertAdjacentHTML('beforebegin', `<div class="link-row"><span>🔗 ${esc(u)}</span><button type="button" class="btn icon sm ghost rmLink">${icon('x')}</button></div>`); wireRm(); }; addLink.onclick = add; linkIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }; }
  const wireRm = () => $$('.rmLink', root).forEach(b => b.onclick = () => b.closest('.link-row').remove()); wireRm();
  const c = $('#tCount', root), cl = $('#tCountLbl', root); if (c) c.oninput = () => { cl.textContent = '(' + c.value + ')'; };
  const df = $('#tDiff', root), dl = $('#tDiffLbl', root); if (df) df.oninput = () => { dl.textContent = '(' + ['very easy', 'easy', 'medium', 'hard', 'very hard'][df.value - 1] + ')'; };
}
export function readTestConfig(root = document) {
  const style = $('input[name=tStyle]:checked', root)?.value || 'standard';
  const types = $$('.tType', root).filter(c => c.checked).map(c => c.value);
  if (style === 'standard' && !types.length) { toast('Pick at least one question type', 'err'); return null; }
  const prompt = $('#tPrompt', root)?.value.trim() || '';
  if (style === 'prompt' && !prompt) { toast('Describe the test you want', 'err'); return null; }
  const links = $$('.link-row span', root).map(sp => sp.textContent.replace(/^🔗\s*/, '').trim());
  return { style, types, prompt, links, count: +$('#tCount', root).value, difficulty: +$('#tDiff', root).value, about: $('#tAbout', root)?.value.trim() || '', instructions: $('#tInstr', root)?.value.trim() || '', pageIds: $$('.tPage', root).filter(c => c.checked).map(c => c.value), hints: $('#tHints', root)?.checked !== false, shuffle: !!$('#tShuffle', root)?.checked, mode: $('input[name=tMode]:checked', root)?.value || 'exam', timerMin: +($('#tTimer', root)?.value || 0) };
}
function startTest(s, test, cfg = {}, subset = null) {
  let order = (subset || test.questions.map(q => q.id));
  if (cfg.shuffle) order = order.slice().sort(() => Math.random() - 0.5);
  activeTest = { setId: s.id, test, answers: {}, attempt: null, subset, order, mode: cfg.mode || 'exam', checked: {}, flagged: new Set(), hints: new Set(), timerMin: cfg.timerMin || 0, timeLeft: (cfg.timerMin || 0) * 60, startedAt: Date.now(), timer: null };
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
      sessionStorage.setItem('dwb_take_cfg', JSON.stringify(cfg));
      invalidate(); m.close(); go(`#/study/${set.id}?tab=test&take=${t.id}`);
    } catch (e) { toast(e.message, 'err'); busy($('#goTest', m.el), false); }
  };
}
async function testTab(s, body) {
  if (activeTest && activeTest.setId === s.id) return drawQuiz(s, body);
  let pages = [];
  if (s.pageIds?.length > 1) { try { const nbs = await loadNotebooks(); const seen = new Set(); for (const nb of nbs) { const full = await api('/notebooks/' + nb.id); for (const p of full.pages) if (s.pageIds.includes(p.id) && !seen.has(p.id)) { seen.add(p.id); pages.push(p); } } } catch {} }
  const cfg = testConfigHtml(s, { pages });
  body.innerHTML = `${s.tests.length ? `<div class="grid cols-2" style="margin-bottom:20px">${s.tests.slice().reverse().map(t => { const best = Math.max(0, ...t.attempts.map(a => a.percent)); const last = t.attempts[t.attempts.length - 1]; return `<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><b>${esc(t.title)}</b> ${t.style === 'remake' ? '<span class="chip purple">worksheet · new numbers</span>' : ''}${t.difficulty ? `<span class="chip">${['very easy', 'easy', 'medium', 'hard', 'very hard'][t.difficulty - 1]}</span>` : ''}${t.description ? `<div class="small" style="margin:2px 0 4px;color:var(--ink-2)">${esc(t.description)}</div>` : ''}<div class="muted small">${t.questions.length} questions · ${ago(t.createdAt)}${t.attempts.length ? ` · ${t.attempts.length} attempt${t.attempts.length === 1 ? '' : 's'} · best <b style="color:var(--green)">${best}%</b>` : ' · not taken yet'}</div></div><button class="btn icon sm ghost delT" data-id="${t.id}">${icon('trash')}</button></div><div class="btn-row" style="margin-top:10px"><button class="btn primary sm takeT" data-id="${t.id}" data-mode="exam">${icon('quiz')} ${t.attempts.length ? 'Take again' : 'Take test'}</button><button class="btn sm takeT" data-id="${t.id}" data-mode="practice">🧪 Practice</button>${last ? `<button class="btn sm reviewT" data-id="${t.id}">Review last (${last.percent}%)</button>` : ''}${last && last.results && Object.values(last.results).some(r => !r.correct) ? `<button class="btn sm retryT" data-id="${t.id}">↺ Retry missed</button>` : ''}<button class="btn sm ghost printT" data-id="${t.id}">${icon('print')} Print</button></div></div>`; }).join('')}</div>` : ''}
    ${genBox({ emoji: '✅', title: s.tests.length ? 'Make another test' : 'Make a practice test', text: 'You\'re in charge: pick the type, difficulty, how many, and tell the AI exactly what you want. Take it as an exam or in practice mode with hints.', btn: 'Generate test', id: 'gen', extra: cfg })}`;
  wireTestConfig();
  $('#gen').onclick = async () => {
    const cfgv = readTestConfig(); if (!cfgv) return;
    busy($('#gen'), true, cfgv.style === 'remake' ? 'Rewriting your page with new numbers…' : 'Writing your test…');
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
  body.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px"><div><h2>${esc(test.title)}</h2>${test.description ? `<div style="color:var(--ink-2);margin:2px 0">${esc(test.description)}</div>` : ''}<div class="muted small">${qs.length} ${test.style === 'remake' ? 'problems · same as your page, new numbers' : 'questions'}${A.subset ? ' · retrying the ones you missed' : ''}${practice ? ' · 🧪 practice mode' : attempt ? ' · graded' : ' · 🎓 exam mode'}</div></div><div class="btn-row">${A.timerMin && !attempt ? `<span class="chip ${A.timeLeft < 60 ? 'red' : 'blue'}" id="clock">⏱ ${fmtClock(A.timeLeft)}</span>` : ''}<button class="btn sm" id="backT">${icon('chevL')} All tests</button></div></div>
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
  const cards = deck.onlyUnknown ? deck.order.filter(i => (s.cards[i].box || 0) < 1) : deck.order;
  if (deck.i >= cards.length) deck.i = 0;
  const cur = s.cards[cards[deck.i]];
  body.innerHTML = `<div class="fc-meta"><div><b style="color:var(--ink)">${s.cards.length} cards</b> · ${known} known · ${s.cards.length - known} still learning</div><div class="btn-row"><div class="seg"><button class="${deck.view === 'study' ? 'active' : ''}" id="vStudy">Study</button><button class="${deck.view === 'list' ? 'active' : ''}" id="vList">All cards</button></div><button class="btn sm" id="more">${icon('plus')} More cards</button></div></div>
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
    const nb = await api('/notebooks/' + id);
    box.innerHTML = nb.pages.length ? nb.pages.map(p => `<label><input type="checkbox" value="${p.id}" ${chosen.has(p.id) ? 'checked' : ''}><span>p.${p.index} ${esc(p.title || '')}</span></label>`).join('') : '<span class="muted small">No scanned pages yet.</span>';
    $$('input', box).forEach(c => c.onchange = () => { c.checked ? chosen.add(c.value) : chosen.delete(c.value); $('#selCount', el).textContent = chosen.size + ' page(s) selected'; });
    $('#selAll', el).onclick = () => { $$('input', box).forEach(c => { c.checked = true; chosen.add(c.value); }); $('#selCount', el).textContent = chosen.size + ' page(s) selected'; };
  };
  const wireRm2 = () => $$('.rmLink', el).forEach(b => b.onclick = () => b.closest('.link-row').remove()); wireRm2();
  $('#srcAddLink', el).onclick = () => { const u = $('#srcLinkIn', el).value.trim(); if (!/^https?:\/\//i.test(u)) return toast('Paste a full link starting with http', 'err'); $('#srcLinkIn', el).value = ''; $('#srcLinkIn', el).closest('.row').insertAdjacentHTML('beforebegin', `<div class="link-row"><span>🔗 ${esc(u)}</span><button type="button" class="btn icon sm ghost rmLink">${icon('x')}</button></div>`); wireRm2(); };
  $('#save', el).onclick = async () => { busy($('#save', el), true, 'Saving (reading links)…'); const links = $$('#srcLinks .link-row span', el).map(sp => sp.textContent.replace(/^🔗\s*/, '').trim()); await api.patch('/study/' + s.id, { topic: $('#topic', el).value, pageIds: [...chosen], links }); invalidate(); m.close(); toast('Sources updated — regenerate to use them', 'ok'); dispatch(); };
}
