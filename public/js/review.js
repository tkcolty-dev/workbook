// Daily review: one spaced-repetition queue across every study set (Leitner boxes 0–5).
import { state, api, $, $$, esc, h, mdi, icon, toast, modal, busy, go, setKeys, plural, loading, navId, stale } from './core.js';
import { shell, updateReviewBadge } from './app.js';

let R = null; // { cards, i, flipped, done, again, setId }
const DAYS = ['now', '1 day', '3 days', '7 days', '14 days', '30 days']; // next gap by box (mirrors BOX_DAYS on the server)
export async function reviewView(_, q = {}) {
  const main = shell('Review', loading());
  const seq = navId();
  const setId = q.set || '';
  const data = await api('/review?limit=60' + (setId ? '&set=' + encodeURIComponent(setId) : '')); if (stale(seq)) return;
  updateReviewBadge(data.due);
  R = { cards: data.cards, i: 0, flipped: false, done: 0, again: 0, setId, ratings: { again: 0, hard: 0, good: 0, easy: 0 } };
  const maxBox = Math.max(1, ...data.byBox);
  const head = `<div class="page-head"><div><h1>Review</h1><div class="sub">Cards come back right before you'd forget them. Rate honestly and the schedule takes care of itself.</div></div><div class="btn-row"><a class="btn" href="#/study">${icon('study')} Study sets</a></div></div>
    <div class="today" style="margin-bottom:16px">
      <div class="t ${data.due ? 'hot' : ''}"><span class="lbl">Due now</span><b>${data.due}</b><span>${data.dueSoon ? data.dueSoon + ' more due later today' : 'nothing else today'}</span></div>
      <div class="t"><span class="lbl">All cards</span><b>${data.total}</b><span>across ${plural(data.sets.length, 'set')}</span></div>
      <div class="t"><span class="lbl">Known</span><b>${data.total ? Math.round(100 * (data.total - data.byBox[0]) / data.total) : 0}%</b><span>box 1 or higher</span></div>
      <div class="t"><span class="lbl">Boxes</span><div class="boxes" aria-label="Cards per box">${data.byBox.map((n, i) => `<i data-n="${n}" class="${i >= 3 ? 'hi' : ''}" style="height:${Math.max(6, Math.round(100 * n / maxBox))}%" title="Box ${i}: ${n}"></i>`).join('')}</div><span>new → every 30 days</span></div>
    </div>
    ${data.sets.length > 1 ? `<div class="chips" style="margin-bottom:14px"><a class="chip ${!setId ? 'on' : ''}" href="#/review" style="text-decoration:none">All sets</a>${data.sets.map(s => `<a class="chip ${s.due ? 'blue' : ''} ${setId === s.id ? 'on' : ''}" href="#/review?set=${s.id}" style="text-decoration:none">${esc(s.title)}${s.due ? ' · ' + s.due : ''}</a>`).join('')}</div>` : ''}
    <div id="session"></div>`;
  main.innerHTML = head;
  drawCard();
  setKeys((e) => { if (e.target.closest('input,textarea')) return; if (!R || !R.cards[R.i]) return; if (e.code === 'Space') { e.preventDefault(); flip(); } if (R.flipped && ['1', '2', '3', '4'].includes(e.key)) rate(['again', 'hard', 'good', 'easy'][+e.key - 1]); });
}
function flip() { R.flipped = !R.flipped; const fc = $('#fc'); if (fc) fc.classList.toggle('flipped', R.flipped); const rb = $('#rating'); if (rb) rb.classList.toggle('hidden', !R.flipped); }
function drawCard() {
  const box = $('#session'); if (!box) return;
  const c = R.cards[R.i];
  if (!c) {
    const n = R.done;
    box.innerHTML = `<div class="empty" style="background:var(--card)"><div class="big">${n ? '🎉' : '🃏'}</div><h3>${n ? `Reviewed ${plural(n, 'card')}` : 'Nothing due right now'}</h3><p>${n ? `${R.ratings.good + R.ratings.easy} solid · ${R.ratings.hard} shaky · ${R.ratings.again} to see again soon.` : 'Cards show up here when their next review comes around. Make flashcards from any study set or a notebook’s vocab.'}</p><div class="btn-row" style="justify-content:center"><a class="btn primary" href="#/">Home</a><a class="btn" href="#/study">Study sets</a>${n ? `<button class="btn" id="moreRev">Keep going</button>` : ''}</div></div>`;
    const mr = $('#moreRev'); if (mr) mr.onclick = () => reviewView({}, { set: R.setId });
    return;
  }
  box.innerHTML = `<div class="fc-meta"><div><b style="color:var(--ink)">${R.i + 1} / ${R.cards.length}</b> · ${esc(c.set)}${c.subject ? ' · ' + esc(c.subject) : ''}</div><div class="muted small">box ${c.box}</div></div>
    <div class="progress" style="margin-bottom:14px"><i style="width:${Math.round(100 * R.i / R.cards.length)}%"></i></div>
    <div class="fc-stage"><div class="fc ${R.flipped ? 'flipped' : ''}" id="fc" role="button" tabindex="0" aria-label="Flashcard, press space to flip"><div class="face front"><span class="lab">Question</span><div>${mdi(c.front)}</div>${c.hint ? `<span class="hint">Hint: ${esc(c.hint)}</span>` : '<span class="hint">tap to flip · space</span>'}</div><div class="face back"><span class="lab">Answer</span><div>${mdi(c.back)}</div></div></div>
      <div class="rating ${R.flipped ? '' : 'hidden'}" id="rating"><button class="again" data-r="again">Again<small>10 min · 1</small></button><button class="hard" data-r="hard">Hard<small>soon · 2</small></button><button class="good" data-r="good">Good<small>${DAYS[Math.min(5, c.box + 1)]} · 3</small></button><button class="easy" data-r="easy">Easy<small>${DAYS[Math.min(5, c.box + 2)]} · 4</small></button></div>
      <div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn sm ghost" id="sayCard">${icon('speaker')} Read aloud</button><a class="btn sm ghost" href="#/study/${c.setId}?tab=cards">Open set</a><button class="btn sm ghost" id="skipCard">Skip</button></div></div>`;
  $('#fc').onclick = flip; $('#fc').onkeydown = (e) => { if (e.key === 'Enter') flip(); };
  $$('#rating button').forEach(b => b.onclick = () => rate(b.dataset.r));
  $('#skipCard').onclick = () => { R.i++; R.flipped = false; drawCard(); };
  $('#sayCard').onclick = async () => (await import('./extras.js')).voice.speak(R.flipped ? R.cards[R.i].back : R.cards[R.i].front);
}
async function rate(r) {
  const c = R.cards[R.i]; if (!c) return;
  R.ratings[r]++; R.done++; if (r === 'again') R.again++;
  R.i++; R.flipped = false; drawCard();
  try { const res = await api('/review/grade', { body: { setId: c.setId, cardId: c.id, rating: r } }); updateReviewBadge(res.remaining); } catch (e) { toast(e.message, 'err'); }
}
