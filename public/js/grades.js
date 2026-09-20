// Grades: classes with weighted categories, a running grade, and a "what do I need on the final" calculator.
import { state, api, $, $$, esc, h, icon, toast, modal, confirm, busy, go, todayISO, fmtDate, COLORS, loading, navId, stale, plural } from './core.js';
import { shell } from './app.js';

let G = null; let saveT = null;
const uid = () => Math.random().toString(36).slice(2, 10);
const save = () => { clearTimeout(saveT); saveT = setTimeout(async () => { try { G = await api.put('/grades', G); } catch (e) { toast(e.message, 'err'); } }, 400); };
const LETTERS = [[93, 'A'], [90, 'A−'], [87, 'B+'], [83, 'B'], [80, 'B−'], [77, 'C+'], [73, 'C'], [70, 'C−'], [67, 'D+'], [63, 'D'], [60, 'D−'], [0, 'F']];
const letter = (p, scale) => { if (p == null) return '—'; if (scale === 'standard') return p >= 90 ? 'A' : p >= 80 ? 'B' : p >= 70 ? 'C' : p >= 60 ? 'D' : 'F'; return (LETTERS.find(([min]) => p >= min) || [0, 'F'])[1]; };
const color = (p) => p == null ? 'var(--ink-3)' : p >= 90 ? 'var(--green)' : p >= 80 ? 'var(--accent)' : p >= 70 ? 'var(--amber)' : 'var(--red)';

// category average (points-based, optionally dropping the lowest n by percent); overall = weighted mean of categories that have entries
export function calc(c) {
  const cats = c.categories.map(k => {
    let es = c.entries.filter(e => e.catId === k.id);
    if (k.drop && es.length > k.drop) es = es.slice().sort((a, b) => (a.score / a.max) - (b.score / b.max)).slice(k.drop);
    const sum = es.reduce((n, e) => n + e.score, 0), max = es.reduce((n, e) => n + e.max, 0);
    return { ...k, n: es.length, avg: max ? 100 * sum / max : null };
  });
  const used = cats.filter(k => k.avg != null && k.weight > 0);
  const wsum = used.reduce((n, k) => n + k.weight, 0);
  const overall = wsum ? used.reduce((n, k) => n + k.weight * k.avg, 0) / wsum : null;
  const uncategorized = c.entries.filter(e => !c.categories.find(k => k.id === e.catId));
  let simple = null; if (!c.categories.length && c.entries.length) { const sum = c.entries.reduce((n, e) => n + e.score, 0), max = c.entries.reduce((n, e) => n + e.max, 0); simple = max ? 100 * sum / max : null; }
  return { cats, overall: overall ?? simple, wsum, uncategorized };
}

export async function gradesView(_, q = {}) {
  const main = shell('Grades', loading());
  const seq = navId(); G = await api('/grades'); if (stale(seq)) return;
  G.classes ||= [];
  if (q.class) { const c = G.classes.find(x => x.id === q.class); if (c) return classView(main, c); }
  const list = G.classes.map(c => ({ c, r: calc(c) }));
  const overall = list.filter(x => x.r.overall != null);
  const gpa = overall.length ? (overall.reduce((n, x) => n + ({ A: 4, B: 3, C: 2, D: 1, F: 0 }[letter(x.r.overall, 'standard')]), 0) / overall.length).toFixed(2) : null;
  main.innerHTML = `<div class="page-head"><div><h1>Grades</h1><div class="sub">Track every score, see your real grade, and find out what you need on the next test.</div></div><div class="btn-row"><button class="btn primary" id="newClass">${icon('plus')} Add a class</button></div></div>
    ${list.length ? `<div class="today" style="margin-bottom:18px"><div class="t"><span class="lbl">Classes</span><b>${list.length}</b><span>${plural(G.classes.reduce((n, c) => n + c.entries.length, 0), 'score')} logged</span></div><div class="t"><span class="lbl">Average</span><b style="color:${color(overall.length ? overall.reduce((n, x) => n + x.r.overall, 0) / overall.length : null)}">${overall.length ? Math.round(overall.reduce((n, x) => n + x.r.overall, 0) / overall.length) + '%' : '—'}</b><span>across classes with scores</span></div><div class="t"><span class="lbl">GPA (4.0)</span><b>${gpa ?? '—'}</b><span>unweighted, by letter</span></div><div class="t"><span class="lbl">Below target</span><b style="color:${list.some(x => x.r.overall != null && x.r.overall < x.c.target) ? 'var(--red)' : 'var(--green)'}">${list.filter(x => x.r.overall != null && x.r.overall < x.c.target).length}</b><span>${list.some(x => x.r.overall != null && x.r.overall < x.c.target) ? 'needs attention' : 'all on target'}</span></div></div>
    <div class="grid cols-3">${list.map(({ c, r }) => `<div class="card class-card" data-id="${c.id}" role="link" tabindex="0"><div class="card-head"><h3><span class="nb-dot color-${esc(c.color)}"></span>${esc(c.name)}</h3><span class="chip ${r.overall == null ? '' : r.overall >= c.target ? 'green' : 'amber'}">${r.overall == null ? 'no scores' : r.overall >= c.target ? 'on target' : 'below ' + c.target + '%'}</span></div><div style="display:flex;align-items:baseline;gap:10px"><div class="grade-big" style="color:${color(r.overall)}">${r.overall == null ? '—' : Math.round(r.overall * 10) / 10 + '%'}</div><div class="display" style="font-size:22px;color:var(--ink-2)">${letter(r.overall, c.scale)}</div></div><div class="muted small">${esc(c.subject || '')}${c.subject ? ' · ' : ''}${plural(c.entries.length, 'score')}${c.categories.length ? ' · ' + plural(c.categories.length, 'category', 'categories') : ''}</div>${r.cats.filter(k => k.avg != null).length ? `<div style="margin-top:10px;display:flex;flex-direction:column;gap:4px">${r.cats.filter(k => k.avg != null).map(k => `<div class="small" style="display:flex;justify-content:space-between;gap:8px"><span class="muted">${esc(k.name)} · ${k.weight}%</span><b>${Math.round(k.avg)}%</b></div>`).join('')}</div>` : ''}</div>`).join('')}</div>`
    : `<div class="empty"><div class="big">📊</div><h3>No classes yet</h3><p>Add a class, set up its grading categories (tests 40%, homework 30%…), then log scores as they come back.</p><button class="btn primary" id="newClass2">${icon('plus')} Add a class</button></div>`}`;
  $('#newClass').onclick = () => classModal();
  const n2 = $('#newClass2'); if (n2) n2.onclick = () => classModal();
  $$('.class-card').forEach(el => { el.onclick = () => go('#/grades?class=' + el.dataset.id); el.onkeydown = (e) => { if (e.key === 'Enter') el.click(); }; });
}

function classModal(c) {
  const isNew = !c; c = c || { name: '', subject: '', color: COLORS[Math.floor(Math.random() * 8)], target: 90, scale: 'plusminus', categories: [{ id: uid(), name: 'Tests', weight: 40, drop: 0 }, { id: uid(), name: 'Homework', weight: 30, drop: 0 }, { id: uid(), name: 'Quizzes', weight: 20, drop: 0 }, { id: uid(), name: 'Participation', weight: 10, drop: 0 }], entries: [] };
  let cats = c.categories.map(k => ({ ...k })); let col = c.color;
  const m = modal(`<h2>${isNew ? 'Add a class' : 'Class settings'}</h2>
    <div class="row"><div class="field"><label for="cName">Class</label><input type="text" id="cName" value="${esc(c.name)}" placeholder="e.g. Algebra 1"></div><div class="field"><label for="cTarget">Target grade %</label><input type="number" id="cTarget" min="0" max="100" value="${c.target}"></div></div>
    <div class="row"><div class="field"><label for="cSubject">Teacher / period <span class="muted">(optional)</span></label><input type="text" id="cSubject" value="${esc(c.subject || '')}" placeholder="e.g. Mrs. K · 3rd"></div><div class="field"><label for="cScale">Letter scale</label><select id="cScale"><option value="plusminus" ${c.scale === 'plusminus' ? 'selected' : ''}>A− / B+ (plus-minus)</option><option value="standard" ${c.scale === 'standard' ? 'selected' : ''}>A B C D F</option></select></div></div>
    <div class="field"><label>Color</label><div class="swatches">${COLORS.map(x => `<div class="swatch color-${x} ${x === col ? 'active' : ''}" data-c="${x}" role="radio" tabindex="0" aria-label="${x}"></div>`).join('')}</div></div>
    <div class="field"><label>Grading categories and weights</label><div id="cats"></div><button type="button" class="btn sm" id="addCat" style="align-self:flex-start">${icon('plus')} Category</button><div class="help" id="wsum"></div></div>
    <div class="actions">${!isNew ? `<button class="btn danger" id="delC" style="margin-right:auto">${icon('trash')} Delete class</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="saveC">${isNew ? 'Add class' : 'Save'}</button></div>`, { wide: true });
  const el = m.el;
  const drawCats = () => { $('#cats', el).innerHTML = cats.map((k, i) => `<div class="grade-row" style="grid-template-columns:1fr 80px 90px 36px"><input class="input" data-i="${i}" data-f="name" value="${esc(k.name)}" placeholder="Category" aria-label="Category name"><input class="input" type="number" data-i="${i}" data-f="weight" value="${k.weight}" min="0" max="100" aria-label="Weight %"><select class="input" data-i="${i}" data-f="drop" aria-label="Drop lowest"><option value="0" ${!k.drop ? 'selected' : ''}>drop none</option><option value="1" ${k.drop === 1 ? 'selected' : ''}>drop lowest 1</option><option value="2" ${k.drop === 2 ? 'selected' : ''}>drop lowest 2</option></select><button type="button" class="btn icon sm ghost rmCat" data-i="${i}" aria-label="Remove category">${icon('x')}</button></div>`).join(''); const sum = cats.reduce((n, k) => n + (+k.weight || 0), 0); $('#wsum', el).textContent = `Weights add up to ${sum}%${sum !== 100 ? ' (they should total 100%)' : ''}`; $$('#cats input, #cats select', el).forEach(inp => inp.oninput = () => { const k = cats[+inp.dataset.i]; k[inp.dataset.f] = inp.dataset.f === 'name' ? inp.value : +inp.value; const sum2 = cats.reduce((n, x) => n + (+x.weight || 0), 0); $('#wsum', el).textContent = `Weights add up to ${sum2}%${sum2 !== 100 ? ' (they should total 100%)' : ''}`; }); $$('.rmCat', el).forEach(b => b.onclick = () => { cats.splice(+b.dataset.i, 1); drawCats(); }); };
  drawCats();
  $('#addCat', el).onclick = () => { cats.push({ id: uid(), name: '', weight: 0, drop: 0 }); drawCats(); $$('#cats input[data-f=name]', el).pop()?.focus(); };
  $$('.swatch', el).forEach(s => { const pick = () => { $$('.swatch', el).forEach(x => x.classList.remove('active')); s.classList.add('active'); col = s.dataset.c; }; s.onclick = pick; s.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(); } }; });
  $('#saveC', el).onclick = () => {
    const name = $('#cName', el).value.trim(); if (!name) return toast('Name the class', 'err');
    const next = { ...c, name, subject: $('#cSubject', el).value.trim(), target: +$('#cTarget', el).value || 90, scale: $('#cScale', el).value, color: col, categories: cats.filter(k => k.name.trim()) };
    if (isNew) { next.id = uid(); G.classes.push(next); } else Object.assign(c, next);
    save(); m.close(); go('#/grades?class=' + (isNew ? next.id : c.id));
  };
  const del = $('#delC', el); if (del) del.onclick = async () => { if (await confirm('Delete this class?', 'All its scores are removed.')) { G.classes = G.classes.filter(x => x !== c); save(); m.close(); go('#/grades'); } };
}

function classView(main, c) {
  const draw = () => {
    const r = calc(c);
    const byCat = (id) => c.entries.filter(e => e.catId === id).sort((a, b) => b.date.localeCompare(a.date));
    main.innerHTML = `<div class="crumbs"><a href="#/grades">Grades</a> › <span>${esc(c.name)}</span></div>
      <div class="page-head" style="margin-bottom:14px"><div><h1><span class="nb-dot big color-${esc(c.color)}" style="vertical-align:-2px;margin-right:8px"></span>${esc(c.name)}</h1><div class="sub">${esc(c.subject || '')}${c.subject ? ' · ' : ''}target ${c.target}%</div></div><div class="btn-row"><button class="btn primary" id="addEntry">${icon('plus')} Log a score</button><button class="btn" id="whatIf">${icon('question')} What do I need?</button><button class="btn icon" id="editC" aria-label="Class settings">${icon('settings')}</button></div></div>
      <div class="grid cols-3" style="margin-bottom:16px">
        <div class="card"><span class="muted small">Current grade</span><div style="display:flex;align-items:baseline;gap:10px"><div class="grade-big" style="color:${color(r.overall)}">${r.overall == null ? '—' : Math.round(r.overall * 10) / 10 + '%'}</div><div class="display" style="font-size:24px;color:var(--ink-2)">${letter(r.overall, c.scale)}</div></div><div class="muted small">${r.overall == null ? 'log a score to see it' : r.overall >= c.target ? `${Math.round((r.overall - c.target) * 10) / 10} points above target` : `${Math.round((c.target - r.overall) * 10) / 10} points below target`}</div></div>
        <div class="card" style="grid-column:span 2"><span class="muted small">By category</span>${r.cats.length ? `<div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">${r.cats.map(k => `<div><div class="small" style="display:flex;justify-content:space-between"><span><b>${esc(k.name)}</b> <span class="muted">· ${k.weight}% of grade${k.drop ? ' · drops lowest ' + k.drop : ''}</span></span><span>${k.avg == null ? '<span class="muted">no scores</span>' : `<b style="color:${color(k.avg)}">${Math.round(k.avg)}%</b>`}</span></div><div class="cat-bar"><i style="width:${k.avg ?? 0}%;background:${color(k.avg)}"></i></div></div>`).join('')}</div>` : '<p class="muted small">No categories: the grade is total points earned ÷ total possible. Add categories in settings for weighted grading.</p>'}</div>
      </div>
      ${c.entries.length ? (r.cats.length ? r.cats : [{ id: '', name: 'Scores' }]).map(k => { const es = r.cats.length ? byCat(k.id) : c.entries.slice().sort((a, b) => b.date.localeCompare(a.date)); if (!es.length && r.cats.length) return ''; return `<div class="card" style="margin-bottom:12px"><h3>${esc(k.name)} <span class="muted small">${plural(es.length, 'score')}</span></h3>${es.map(e => `<div class="grade-row" data-id="${e.id}"><div><b>${esc(e.title || 'Untitled')}</b><div class="muted small">${fmtDate(e.date)}${e.note ? ' · ' + esc(e.note) : ''}</div></div><div><b style="color:${color(100 * e.score / e.max)}">${Math.round(1000 * e.score / e.max) / 10}%</b></div><div class="muted small">${e.score} / ${e.max}</div><button class="btn icon sm ghost edE" aria-label="Edit score">${icon('edit')}</button></div>`).join('')}</div>`; }).join('') + (r.uncategorized.length && r.cats.length ? `<div class="card" style="margin-bottom:12px"><h3>Not in a category <span class="muted small">(not counted)</span></h3>${r.uncategorized.map(e => `<div class="grade-row" data-id="${e.id}"><div><b>${esc(e.title)}</b></div><div>${Math.round(1000 * e.score / e.max) / 10}%</div><div class="muted small">${e.score} / ${e.max}</div><button class="btn icon sm ghost edE" aria-label="Edit score">${icon('edit')}</button></div>`).join('')}</div>` : '')
      : `<div class="empty"><div class="big">✏️</div><h3>No scores yet</h3><p>Log each test, quiz and assignment as it comes back and the grade updates instantly.</p><button class="btn primary" id="addEntry2">${icon('plus')} Log a score</button></div>`}`;
    $('#addEntry').onclick = () => entryModal(); const a2 = $('#addEntry2'); if (a2) a2.onclick = () => entryModal();
    $('#editC').onclick = () => classModal(c);
    $('#whatIf').onclick = () => whatIf(c);
    $$('.edE').forEach(b => b.onclick = () => entryModal(c.entries.find(e => e.id === b.closest('.grade-row').dataset.id)));
  };
  const entryModal = (e) => {
    const isNew = !e; e = e || { title: '', catId: c.categories[0]?.id || '', score: '', max: 100, date: todayISO(), note: '' };
    const m = modal(`<h2>${isNew ? 'Log a score' : 'Edit score'}</h2>
      <div class="field"><label for="eTitle">What was it?</label><input type="text" id="eTitle" value="${esc(e.title)}" placeholder="e.g. Ch. 5 test, HW p.42"></div>
      ${c.categories.length ? `<div class="field"><label for="eCat">Category</label><select id="eCat">${c.categories.map(k => `<option value="${k.id}" ${k.id === e.catId ? 'selected' : ''}>${esc(k.name)} (${k.weight}%)</option>`).join('')}</select></div>` : ''}
      <div class="row"><div class="field"><label for="eScore">Score</label><input type="number" id="eScore" step="any" value="${e.score}" placeholder="e.g. 17"></div><div class="field"><label for="eMax">Out of</label><input type="number" id="eMax" step="any" value="${e.max}"></div><div class="field"><label for="eDate">Date</label><input type="date" id="eDate" value="${e.date}"></div></div>
      <div class="field"><label for="eNote">Note <span class="muted">(optional)</span></label><input type="text" id="eNote" value="${esc(e.note || '')}" placeholder="e.g. retake allowed"></div>
      <div class="actions">${!isNew ? `<button class="btn danger" id="delE" style="margin-right:auto" aria-label="Delete score">${icon('trash')}</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="saveE">${isNew ? 'Log it' : 'Save'}</button></div>`);
    const el = m.el; setTimeout(() => $('#eTitle', el).focus(), 60);
    $('#saveE', el).onclick = () => { const score = parseFloat($('#eScore', el).value), max = parseFloat($('#eMax', el).value); if (!Number.isFinite(score) || !(max > 0)) return toast('Enter the score and what it was out of', 'err'); const next = { ...e, id: e.id || uid(), title: $('#eTitle', el).value.trim(), catId: $('#eCat', el)?.value || '', score, max, date: $('#eDate', el).value || todayISO(), note: $('#eNote', el).value.trim() }; if (isNew) c.entries.push(next); else Object.assign(e, next); save(); m.close(); draw(); toast(isNew ? 'Logged' : 'Saved', 'ok'); };
    const de = $('#delE', el); if (de) de.onclick = () => { c.entries = c.entries.filter(x => x !== e); save(); m.close(); draw(); };
  };
  draw();
}
// needed score on an upcoming assessment to hit the target
function whatIf(c) {
  const r = calc(c);
  const m = modal(`<h2>What do I need?</h2><p class="muted small" style="margin:-6px 0 12px">Pick the upcoming test or assignment and a goal. The math uses your current category averages.</p>
    <div class="row"><div class="field"><label for="wCat">It counts in</label><select id="wCat">${c.categories.length ? c.categories.map(k => `<option value="${k.id}">${esc(k.name)} (${k.weight}%)</option>`).join('') : '<option value="">Points</option>'}</select></div><div class="field"><label for="wMax">Points possible</label><input type="number" id="wMax" value="100"></div></div>
    <div class="field"><label for="wTarget">Grade I want <span class="muted" id="wTLbl">(${c.target}%)</span></label><input type="range" id="wTarget" min="50" max="100" value="${c.target}"></div>
    <div class="card" id="wOut" style="text-align:center"></div>
    <div class="actions"><button class="btn primary" data-close>Done</button></div>`);
  const el = m.el;
  const upd = () => {
    const T = +$('#wTarget', el).value; $('#wTLbl', el).textContent = `(${T}%)`; const max = +$('#wMax', el).value || 100; const catId = $('#wCat', el).value;
    let need;
    if (c.categories.length) {
      const cat = r.cats.find(k => k.id === catId); const es = c.entries.filter(e => e.catId === catId);
      const catSum = es.reduce((n, e) => n + e.score, 0), catMax = es.reduce((n, e) => n + e.max, 0);
      // solve for x: overall(T) with this category's avg = (catSum + x)/(catMax + max)
      const others = r.cats.filter(k => k.id !== catId && k.avg != null); const wO = others.reduce((n, k) => n + k.weight, 0); const contribO = others.reduce((n, k) => n + k.weight * k.avg, 0);
      const wsum = wO + cat.weight; const needAvg = (T * wsum - contribO) / cat.weight; // required category avg in %
      need = needAvg / 100 * (catMax + max) - catSum;
    } else { const sum = c.entries.reduce((n, e) => n + e.score, 0), mx = c.entries.reduce((n, e) => n + e.max, 0); need = T / 100 * (mx + max) - sum; }
    const pct = 100 * need / max;
    $('#wOut', el).innerHTML = pct <= 0 ? `<div class="grade-big" style="color:var(--green)">Any score</div><div class="muted small">You already have ${T}% locked in for this one.</div>` : pct > 100 ? `<div class="grade-big" style="color:var(--red)">${Math.round(pct)}%</div><div class="muted small">More than 100% — not reachable with this one alone. Aim for the best you can, and check what else counts.</div>` : `<div class="grade-big" style="color:${color(pct)}">${Math.round(need * 10) / 10} / ${max}</div><div class="muted small">That's ${Math.round(pct)}% on it to end at ${T}%.</div>`;
  };
  $$('#wCat, #wMax, #wTarget', el).forEach(i => i.oninput = upd); upd();
}
