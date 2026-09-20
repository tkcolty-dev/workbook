// Homework: a hub of every checked assignment, and a full-page report for one check (phone-first layout).
import { state, api, $, $$, esc, h, mdi, icon, toast, modal, confirm, busy, go, ago, fmtDate, loading, navId, stale, plural, setKeys } from './core.js';
import { shell, checkHomework, lightbox } from './app.js';

const color = (p) => p == null ? 'var(--ink-3)' : p >= 90 ? 'var(--green)' : p >= 75 ? 'var(--accent)' : p >= 50 ? 'var(--amber)' : 'var(--red)';
const V = { correct: ['✅', 'green', 'Correct'], partial: ['🟡', 'amber', 'Partly right'], wrong: ['❌', 'red', 'Wrong'], blank: ['⬜', '', 'No answer'] };

export async function homeworkView() {
  const main = shell('Homework', loading());
  const seq = navId(); const H = await api('/homework'); if (stale(seq)) return;
  const nbs = state.notebooks || []; const lastNb = nbs.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
  main.innerHTML = `<div class="page-head"><div><h1>Homework</h1><div class="sub">Snap finished homework and the AI checks every answer, shows the fix, and tells you what to practice.</div></div><div class="btn-row"><a class="btn primary lg" href="${lastNb ? '#/scan/' + lastNb.id + '?hw=1' : '#/scan?hw=1'}">${icon('camera')} Check new homework</a></div></div>
    ${H.total ? `<div class="today" style="margin-bottom:18px">
      <div class="t"><span class="lbl">Checked</span><b>${H.total}</b><span>${plural(H.problems, 'problem')} graded</span></div>
      <div class="t"><span class="lbl">Average</span><b style="color:${color(H.avg)}">${H.avg}%</b><span>all assignments</span></div>
      <div class="t"><span class="lbl">Last 5</span><b style="color:${color(H.recentAvg)}">${H.recentAvg}%</b><span>${H.recentAvg > H.avg ? 'trending up' : H.recentAvg < H.avg ? 'trending down' : 'steady'}</span></div>
      <div class="t"><span class="lbl">Needs work</span><b style="font-size:20px">${H.bySubject[0] ? esc(H.bySubject[0].subject) : '—'}</b><span>${H.bySubject[0] ? H.bySubject[0].avg + '% average' : ''}</span></div>
    </div>
    <div class="hw-list">${H.items.map(i => `<a class="hw-row" href="#/homework/${i.pageId}"><div class="hw-thumb" style="background-image:url('/api/pages/${i.pageId}/image?kind=thumb&r=${i.rev}')"></div><div class="hw-info"><b>${esc(i.assignment || i.title)}</b><span class="muted small"><span class="nb-dot color-${esc(i.color)}"></span>${esc(i.notebook)} · p.${i.index} · ${ago(i.checkedAt)} · ${plural(i.n, 'problem')}</span>${i.tips.length ? `<span class="small hw-tip">${mdi(i.tips[0])}</span>` : ''}</div><div class="hw-pct" style="color:${color(i.percent)}">${i.percent}%<small>${i.score.correct}✓${i.score.wrong ? ' ' + i.score.wrong + '✗' : ''}</small></div></a>`).join('')}</div>`
    : `<div class="empty"><div class="big">✏️</div><h3>Nothing checked yet</h3><p>Do the homework on paper, snap it, and the AI grades every answer with an explanation for anything off. It also works on any page you already scanned: open it and tap <b>Check homework</b>.</p><a class="btn primary" href="${lastNb ? '#/scan/' + lastNb.id + '?hw=1' : '#/scan?hw=1'}">${icon('camera')} Check homework</a></div>`}`;
}

export async function homeworkReportView({ id }) {
  const main = shell('Homework', loading());
  const seq = navId();
  let page, nb; try { const r = await api('/pages/' + id); page = r.page; nb = r.notebook; } catch { toast('Page not found', 'err'); return go('#/homework'); }
  if (stale(seq)) return;
  const hw = page.homework;
  if (!hw) { main.innerHTML = `<div class="crumbs"><a href="#/homework">Homework</a> › <span>${esc(page.title || 'Page ' + page.index)}</span></div><div class="empty"><div class="big">✏️</div><h3>This page hasn't been checked</h3><p>Run the AI check on it and the report shows up here.</p><button class="btn primary" id="chk">${icon('check')} Check this page</button></div>`; $('#chk').onclick = () => checkHomework(page, nb); return; }
  const wrong = hw.items.filter(i => i.verdict !== 'correct');
  const draw = (filter) => {
    const items = filter === 'wrong' ? wrong : hw.items;
    main.innerHTML = `<div class="crumbs"><a href="#/homework">Homework</a> › <a href="#/notebook/${nb.id}">${esc(nb.name)}</a> › <span>${esc(hw.assignment || page.title || 'Page ' + page.index)}</span></div>
      <div class="hw-hero card">
        <div class="hw-hero-left"><div class="score-ring" style="--p:${hw.score.percent};width:96px;height:96px;margin:0"><div style="width:76px;height:76px;font-size:22px">${hw.score.percent}%</div></div>
          <div><h1 style="font-size:24px">${esc(hw.assignment || page.title || 'Page ' + page.index)}</h1><div class="muted small">${esc(nb.name)} · p.${page.index} · checked ${ago(hw.checkedAt)}${hw.doubleChecked ? ' · ✓✓ double-checked' : ''}</div><div class="chips" style="margin-top:8px"><span class="chip green">${hw.score.correct} correct</span>${hw.score.partial ? `<span class="chip amber">${hw.score.partial} partly</span>` : ''}${hw.score.wrong ? `<span class="chip red">${hw.score.wrong} wrong</span>` : ''}${hw.score.blank ? `<span class="chip">${hw.score.blank} blank</span>` : ''}</div></div></div>
        ${hw.summary ? `<p class="hw-summary">${esc(hw.summary)}</p>` : ''}
        <div class="hw-scan" id="hwScan"><img src="/api/pages/${page.id}/image?kind=enh&r=${page.rev || 0}" alt="Your homework page"><span class="small">tap to zoom</span></div>
      </div>
      ${hw.tips?.length ? `<div class="card sun" style="margin:14px 0"><h3>What to practice</h3><ul class="kp" style="margin:6px 0 0;padding-left:20px">${hw.tips.map(t => `<li>${mdi(t)}</li>`).join('')}</ul></div>` : ''}
      <div class="list-tools" style="margin-top:14px"><div class="seg"><button class="${filter === 'wrong' ? 'active' : ''}" id="fWrong" ${wrong.length ? '' : 'disabled'}>Needs a fix (${wrong.length})</button><button class="${filter === 'all' ? 'active' : ''}" id="fAll">All ${hw.items.length}</button></div></div>
      <div class="hw-items report">${items.length ? items.map(it => `<div class="hw-item ${it.verdict}"><div class="hw-n">${esc(it.n)}</div><div class="hw-body"><div class="hw-q">${mdi(it.problem)}</div><div class="small"><span class="muted">You wrote:</span> <b>${it.studentAnswer ? mdi(it.studentAnswer) : '<i class="muted">nothing</i>'}</b> <span class="chip ${V[it.verdict][1]}">${V[it.verdict][0]} ${V[it.verdict][2]}</span></div>${it.work ? `<div class="small muted" style="margin-top:2px">Your work: ${mdi(it.work)}</div>` : ''}${it.verdict !== 'correct' && (it.correctAnswer || it.explanation) ? `<div class="hw-fix">${it.correctAnswer ? `<b>Correct answer:</b> ${mdi(it.correctAnswer)}` : ''}${it.explanation ? `<div style="margin-top:3px">${mdi(it.explanation)}</div>` : ''}</div>` : ''}</div></div>`).join('') : `<div class="empty"><div class="big">🎉</div><h3>Everything correct</h3><p>Nothing to fix on this one.</p></div>`}</div>
      <div class="hw-actions"><button class="btn primary" id="practice">${icon('quiz')} Practice similar problems</button><button class="btn" id="ask">${icon('chat')} Ask about a problem</button><button class="btn" id="recheck">${icon('refresh')} Check again</button><a class="btn ghost" href="#/page/${page.id}">${icon('eye')} Open page</a></div>`;
    $('#fWrong').onclick = () => draw('wrong'); $('#fAll').onclick = () => draw('all');
    $('#hwScan').onclick = () => lightbox(`/api/pages/${page.id}/image?kind=enh&r=${page.rev || 0}`, 'Homework page');
    $('#practice').onclick = () => import('./study.js').then(m => m.testOnPage(page, nb, { about: 'the problems I got wrong on this homework: ' + wrong.map(w => w.problem).slice(0, 8).join(' | '), style: 'remake' }));
    $('#ask').onclick = () => go('#/page/' + page.id + '?ask=1');
    $('#recheck').onclick = () => checkHomework(page, nb);
  };
  draw(wrong.length ? 'wrong' : 'all');
}
