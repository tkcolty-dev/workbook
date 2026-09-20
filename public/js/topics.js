// Topics: a map of every topic across your notebooks, how they connect, and the pages under each.
import { state, api, $, $$, esc, h, icon, toast, go, loading, navId, stale, plural, loadNotebooks } from './core.js';
import { shell } from './app.js';

export async function topicsView(_, q = {}) {
  const main = shell('Topics', loading());
  const seq = navId(); const [T, nbs] = await Promise.all([api('/topics'), loadNotebooks()]); if (stale(seq)) return;
  let sel = q.t || ''; let filter = '';
  const byKey = Object.fromEntries(T.topics.map(t => [t.key, t]));
  const neighbors = (key) => T.links.filter(l => l.a === key || l.b === key).map(l => ({ key: l.a === key ? l.b : l.a, n: l.n })).filter(x => byKey[x.key]).sort((a, b) => b.n - a.n);
  const draw = () => {
    const max = Math.max(1, ...T.topics.map(t => t.n));
    const list = T.topics.filter(t => !filter || t.topic.toLowerCase().includes(filter.toLowerCase()));
    const cur = sel ? byKey[sel] : null;
    main.innerHTML = `<div class="page-head"><div><h1>Topics</h1><div class="sub">Every topic the AI found across your notebooks. Bigger means more pages. Pick one to see its pages and what it connects to.</div></div><div class="btn-row"><div class="search-box">${icon('search')}<input class="input" id="tq" placeholder="Find a topic…" value="${esc(filter)}" aria-label="Find a topic"></div></div></div>
      ${T.topics.length ? `<div class="topics-layout"><div class="card"><div class="topic-cloud">${list.map(t => { const size = 13 + Math.round(11 * Math.sqrt(t.n / max)); return `<button type="button" class="topic ${sel === t.key ? 'on' : ''}" data-k="${esc(t.key)}" style="font-size:${size}px">${esc(t.topic)}<small>${t.n}</small></button>`; }).join('')}${!list.length ? '<span class="muted small">No topic matches.</span>' : ''}</div><div class="muted small" style="margin-top:8px">${plural(T.topics.length, 'topic')} across ${plural(nbs.length, 'notebook')}</div></div>
        <div>${cur ? `<div class="card"><div class="card-head"><h3>${esc(cur.topic)}</h3><span class="chip blue">${plural(cur.n, 'page')}</span></div><div class="chips" style="margin:4px 0 10px">${cur.notebooks.map(n => `<a class="chip" href="#/notebook/${n.id}" style="text-decoration:none"><span class="nb-dot color-${esc(n.color)}"></span>${esc(n.name)}</a>`).join('')}</div>
          <div class="recent-list">${cur.pages.map(id => T.pages[id]).filter(Boolean).map(p => { const nb = nbs.find(n => n.id === p.notebookId); return `<a class="recent-row" href="#/page/${p.id}"><div class="rthumb" style="background-image:url('/api/pages/${p.id}/image?kind=thumb&r=${p.rev}')"></div><div class="rinfo"><b>${esc(p.title)}</b><span class="muted small">${esc(nb?.name || '')} · p.${p.index}</span></div>${icon('chevR', 'muted')}</a>`; }).join('')}</div>
          ${neighbors(cur.key).length ? `<h3 style="margin-top:14px">Connects to</h3><div class="chips" style="margin-top:6px">${neighbors(cur.key).slice(0, 14).map(x => `<button type="button" class="chip purple topic-link" data-k="${esc(x.key)}">${esc(byKey[x.key].topic)} <span class="muted">${x.n}</span></button>`).join('')}</div><div class="help" style="margin-top:6px">Topics that appear on the same pages.</div>` : ''}
          <div class="btn-row" style="margin-top:14px"><a class="btn sm primary" href="#/study?new=1&topic=${encodeURIComponent(cur.topic)}">${icon('study')} Study this topic</a></div></div>`
        : `<div class="card"><h3>Pick a topic</h3><p class="muted small">Tap any topic on the left. You'll see its pages across every notebook and the topics it tends to appear with.</p>${T.links.length ? `<h3 style="margin-top:12px">Strongest connections</h3><div class="link-list">${T.links.slice(0, 8).map(l => `<div class="link-item"><button type="button" class="topic-link" data-k="${esc(l.a)}">${esc(byKey[l.a].topic)}</button><span class="muted">↔</span><button type="button" class="topic-link" data-k="${esc(l.b)}">${esc(byKey[l.b].topic)}</button><span class="muted small">${plural(l.n, 'page')}</span></div>`).join('')}</div>` : ''}</div>`}</div></div>`
      : `<div class="empty"><div class="big">🗺️</div><h3>No topics yet</h3><p>Topics appear as the AI reads your scanned pages.</p><a class="btn primary" href="#/scan">${icon('camera')} Scan pages</a></div>`}`;
    $$('.topic, .topic-link').forEach(b => b.onclick = () => { sel = b.dataset.k; draw(); history.replaceState(null, '', '#/topics?t=' + encodeURIComponent(sel)); });
    const tq = $('#tq'); if (tq) tq.oninput = () => { filter = tq.value; const y = window.scrollY; draw(); $('#tq').focus(); $('#tq').setSelectionRange(filter.length, filter.length); window.scrollTo(0, y); };
  };
  draw();
}
