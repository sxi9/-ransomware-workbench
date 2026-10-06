/* ===== tabs, dashboard, investigator log, backup, boot ===== */
const APP = { views: {}, me: '' };

/* ---- adding rows with per-table normalisation ---- */
APP.addTo = function (tid, objs) {
  const stamp = nowISO();
  if (tid === 'victims') {
    objs = objs.filter((o) => (o.victim || '').trim()).map((o) => {
      const g = ensureGroup(o.group || 'Unknown');
      const r = Object.assign({ created: stamp, pub: 'Unknown', type: 'Named', added: stamp }, o, { group: g.name, cc: String(o.cc || '').toUpperCase() });
      r.country = DB.countries[r.cc] || r.country || ''; r.onion = g.onion || ''; r.collector = g.collector || ''; r.sitestat = g.site || '';
      if (!r.rlurl) r.rlurl = '';
      return r;
    });
  } else if (tid === 'needles') {
    objs = objs.filter((o) => (o.name || '').trim()).map((o) => {
      const vp = victimPart(o.name); const g = groupFor(o.actor) || groupFor(vp.g);
      const r = Object.assign({ sheet: 'Needle tracker FY27', status: 'Completed', pdate: todayISO(), analyst: APP.me }, o, { victim: vp.v, actor: o.actor || (g ? g.name : vp.g), onion: g ? g.onion : '', _gi: -1, _vi: -1, match: 'None' });
      if (g) { const v = DB.tables.victims.rows.find((x) => norm(x.group) === norm(g.name) && norm(x.victim) === norm(vp.v)); if (v) { r._vi = +v._id.slice(1); r.match = 'Exact'; } }
      return r;
    });
  } else if (tid === 'groups') {
    objs = objs.filter((o) => (o.name || '').trim()).map((o) => Object.assign({ site: 'Unknown', added: todayISO(), inledger: 'Yes', source: 'Added in the workbench' }, o));
  } else if (tid === 'journal') {
    objs = objs.map((o) => Object.assign({ date: todayISO(), time: stamp.slice(11), analyst: APP.me, status: 'Open', created: stamp }, o));
  }
  const res = addRows(tid, objs);
  if (tid === 'groups') res.added.forEach(indexGroup);
  if (tid === 'needles') res.added.forEach((r) => { r._g = groupFor(r.actor); });
  return res;
};

/* keep derived data in step */
let rebuildT = 0;
onChange((tid, ev) => {
  if (['victims', 'needles', 'groups'].includes(tid)) {
    clearTimeout(rebuildT);
    rebuildT = setTimeout(() => { if (tid === 'groups' && ev.type === 'edit') { for (const v of DB.tables.victims.rows) { const g = groupFor(v.group); if (g) { v.onion = g.onion; v.collector = g.collector; v.sitestat = g.site; v._s = null; } } } recount(); buildMixed(); APP.counts(); }, 80);
  } else APP.counts();
});
APP.counts = function () {
  const n = (id, v) => { const e = $('#n-' + id); if (e) e.textContent = fmtN(v); };
  n('mixed', DB.tables.mixed.rows.length); n('victims', DB.tables.victims.rows.length); n('needles', DB.tables.needles.rows.length); n('groups', DB.tables.groups.rows.length); n('sheets', DB.sheets.length); n('journal', DB.tables.journal.rows.length);
  const day = APP.day || DB.asOf; n('today', DB.tables.victims.rows.filter((r) => dateOf(r.created) === day).length);
};

/* ---- cross-tab navigation ---- */
APP.go = function (tab, fn) { $$('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); $$('.host').forEach((h) => h.classList.toggle('active', h.id === 'host-' + tab)); const v = APP.views[tab]; if (v && v.show) v.show(); if (fn) fn(v); };
APP.showGroup = (name) => APP.go('groups', (v) => { v.setQuery('group:"' + name + '"'); const g = groupFor(name); if (g) v.focus(g._id); });
APP.showVictims = (q, filter) => APP.go('victims', (v) => { v.setFilter(filter && filter.facet, filter && filter.from, filter && filter.to); v.setQuery(q || ''); });
APP.showNeedles = (q) => APP.go('needles', (v) => v.setQuery(q || ''));

/* related items for the drawer */
function relVictim(r) {
  const v = r._v || r; const g = groupFor(v.group); const out = [];
  if (g) out.push({ id: 'g', title: 'Group', items: [{ label: g.name, sub: `${fmtN(g.victims)} victims · site ${g.site}${g.collector ? ' · ' + g.collector : ''}`, go: () => APP.showGroup(g.name) }] });
  const ns = DB.tables.needles.rows.filter((n) => n._v === v || (n._vi >= 0 && DB.vByPos[n._vi] === v));
  out.push({ id: 'n', title: 'Needles for this victim', empty: 'No Needle yet', items: ns.map((n) => ({ label: n.name, sub: `${n.rstatus || n.status || ''} ${n.pdate || ''}`.trim(), go: () => APP.go('needles', (x) => x.focus(n._id)) })) });
  const same = DB.tables.victims.rows.filter((x) => x !== v && norm(x.victim) === norm(v.victim)).slice(0, 8);
  if (same.length) out.push({ id: 's', title: 'Same victim elsewhere', items: same.map((x) => ({ label: x.group, sub: dateOf(x.created), go: () => APP.go('victims', (t) => t.focus(x._id)) })) });
  const js = DB.tables.journal.rows.filter((j) => norm(j.victim) === norm(v.victim)).slice(0, 8);
  if (js.length) out.push({ id: 'j', title: 'Investigator log', items: js.map((j) => ({ label: `${j.date} ${j.type}`, sub: j.analyst, go: () => APP.go('journal', (t) => t.grid.focus(j._id)) })) });
  return out;
}
function relNeedle(n) {
  const out = [];
  if (n._v) out.push({ id: 'v', title: 'Ledger victim', items: [{ label: n._v.victim, sub: `${n._v.group} · ${dateOf(n._v.created)} · ${n.match}`, go: () => APP.go('victims', (t) => t.focus(n._v._id)) }] });
  const g = n._g || groupFor(n.actor); if (g) out.push({ id: 'g', title: 'Group', items: [{ label: g.name, sub: `${fmtN(g.victims)} victims · ${fmtN(g.needles)} Needles`, go: () => APP.showGroup(g.name) }] });
  return out;
}
function relGroup(g) {
  const vs = DB.tables.victims.rows.filter((v) => norm(v.group) === norm(g.name)).sort((a, b) => (b.created || '').localeCompare(a.created || '')).slice(0, 10);
  const ns = DB.tables.needles.rows.filter((n) => n._g === g).sort((a, b) => (b.pdate || '').localeCompare(a.pdate || '')).slice(0, 10);
  return [
    { id: 'v', title: `Latest victims (${fmtN(g.victims)})`, empty: 'No victims in the ledger', items: vs.map((v) => ({ label: v.victim, sub: dateOf(v.created), go: () => APP.go('victims', (t) => t.focus(v._id)) })).concat(g.victims > 10 ? [{ label: 'Show all in Victims', sub: '', go: () => APP.showVictims('group:"' + g.name + '"') }] : []) },
    { id: 'n', title: `Latest Needles (${fmtN(g.needles)})`, empty: 'No Needles', items: ns.map((n) => ({ label: n.name, sub: n.pdate, go: () => APP.go('needles', (t) => t.focus(n._id)) })).concat(g.needles > 10 ? [{ label: 'Show all in Needles', sub: '', go: () => APP.showNeedles('actor:"' + g.name + '"') }] : []) }
  ];
}

/* ---- log an update from any row ---- */
APP.logFrom = function (r, t) {
  const pre = { type: 'Victim update', analyst: APP.me };
  if (t.id === 'groups') { pre.group = r.name; pre.onion = r.onion; pre.type = 'Leak site change'; }
  else if (t.id === 'needles') { const g = r._g || groupFor(r.actor); pre.group = g ? g.name : r.actor; pre.victim = r.victim; pre.needle = r.wagtail || r.intel; pre.onion = g ? g.onion : ''; pre.type = r.rstatus === 'Yes' ? 'Needle republished' : 'Needle published'; }
  else if (t.id === 'journal') { Object.assign(pre, stripRow(r)); delete pre._id; }
  else { const v = r._v || r; pre.group = v.group; pre.victim = v.victim; pre.onion = r.claim || v.claim || r.onion || v.onion; pre.country = v.cc; pre.sector = v.sector; if (r._n || r.wagtail) pre.needle = (r._n && r._n.wagtail) || r.wagtail || ''; }
  APP.go('journal', (v) => v.prefill(pre));
};

/* ---- Today dashboard ---- */
function mountToday(host) {
  { let last = ''; for (const r of DB.tables.victims.rows) { const d = dateOf(r.created); if (d > last && d <= todayISO()) last = d; } APP.day = last || DB.asOf; }
  host.innerHTML = `<div class="bar"><h2>Today's updates</h2><span class="meta" data-meta></span><span class="sp"></span>
    <label class="meta">Day <input type="date" data-day value="${APP.day}" style="height:30px;border:1px solid var(--grid);border-radius:5px;padding:0 6px"></label>
    <button class="btn sm" data-prev>‹ Previous day</button><button class="btn sm" data-next>Next day ›</button><button class="btn sm" data-asof>Ledger date</button>
    <button class="btn sm accent" data-log>${ico('flag')}Log an update</button><button class="btn sm" data-addv>${ico('plus')}Add victim</button></div>
    <div class="dash"><div class="cards" data-cards></div><div class="cols2"><div class="panel"><div class="ph">Groups posting that day<span class="sp"></span><small style="font-weight:400;color:var(--ink-3)">click to open</small></div><div class="pb" data-groups></div></div>
    <div class="panel"><div class="ph">Needles that day<span class="sp"></span></div><div class="pb" data-needles></div></div>
    <div class="panel"><div class="ph">Investigator log that day<span class="sp"></span><button class="btn sm" data-digest>${ico('copy')}Copy digest</button></div><div class="pb" data-journal></div></div>
    <div class="panel"><div class="ph">Last 14 days: victims discovered</div><div class="bars" data-trend></div></div></div></div>`;
  const view = {};
  function render() {
    const day = APP.day; const V = DB.tables.victims.rows, N = DB.tables.needles.rows, J = DB.tables.journal.rows;
    const dayV = V.filter((r) => dateOf(r.created) === day); const d7 = addDays(day, -6);
    const wk = V.filter((r) => { const d = dateOf(r.created); return d >= d7 && d <= day; });
    const pubDay = dayV.filter((r) => r.pub === 'Yes' || r.pub === 'Partial');
    const nDay = N.filter((n) => dateOf(n.pdate) === day), nRe = N.filter((n) => dateOf(n.rdate) === day), nAw = N.filter((n) => /awaiting/i.test(n.rstatus));
    const noNeedle = dayV.filter((r) => r.type === 'Named' && !DB.tables.mixed.byId.get('m' + r._id)._n);
    const jDay = J.filter((j) => j.date === day);
    const gs = new Map(); dayV.forEach((r) => gs.set(r.group, (gs.get(r.group) || 0) + 1));
    $('[data-meta]', host).textContent = day === DB.asOf ? `Ledger is current to ${DB.asOf}. Log newer victims in Investigator or add them to Victims.` : day > DB.asOf ? `After the ledger's last sync (${DB.asOf}): only what you added shows here.` : '';
    const cards = [
      { n: dayV.length, l: 'victims discovered', hi: true, go: () => APP.showVictims('', { from: day, to: day }) },
      { n: gs.size, l: 'groups posting', go: () => APP.showVictims('', { from: day, to: day }) },
      { n: wk.length, l: 'victims, last 7 days', go: () => APP.showVictims('', { from: d7, to: day }) },
      { n: pubDay.length, l: 'data published that day', go: () => APP.showVictims('', { facet: { pub: 'Yes' }, from: day, to: day }) },
      { n: noNeedle.length, l: 'named victims without a Needle', go: () => APP.go('mixed', (v) => { v.setFilter({ match: 'Ledger only', type: 'Named' }, day, day); }) },
      { n: nDay.length, l: 'Needles published', go: () => APP.go('needles', (v) => v.setFilter({}, day, day)) },
      { n: nRe.length, l: 'Needles republished', go: () => APP.go('needles', (v) => { v.setFilter({}); v.setQuery('republished:' + day); }) },
      { n: nAw.length, l: 'Needles awaiting update', go: () => APP.go('needles', (v) => v.setFilter({ rstatus: 'Update awaiting' })) },
      { n: jDay.length, l: 'log entries that day', go: () => APP.go('journal', (v) => v.setDay(day)) },
      { n: DB.tables.groups.rows.filter((g) => g.site === 'Up').length, l: 'leak sites up', go: () => APP.go('groups', (v) => v.setFilter({ site: 'Up' })) }
    ];
    $('[data-cards]', host).innerHTML = cards.map((c, i) => `<button class="card${c.hi ? ' hi' : ''}" data-card="${i}"><div class="n">${fmtN(c.n)}</div><div class="l">${esc(c.l)}</div></button>`).join('');
    $$('[data-card]', host).forEach((b) => { b.onclick = () => cards[+b.dataset.card].go(); });
    const gl = Array.from(gs.entries()).sort((a, b) => b[1] - a[1]);
    $('[data-groups]', host).innerHTML = gl.length ? gl.map(([g, n]) => { const G = groupFor(g); return `<button class="li" data-g="${esc(g)}"><span class="dot ${G ? esc(G.site) : ''}"></span><span class="nm">${esc(g)}</span>${G && G.onion ? `<span class="tag mono" style="font-size:10px;color:var(--purple)">TOR</span>` : ''}<span class="ct"><b>${n}</b> new</span></button>`; }).join('') : `<div class="empty">No victims discovered on ${day}</div>`;
    $$('[data-g]', host).forEach((b) => { b.onclick = () => APP.showVictims('group:"' + b.dataset.g + '"', { from: day, to: day }); });
    const nl = nDay.concat(nRe.filter((n) => !nDay.includes(n))).slice(0, 60);
    $('[data-needles]', host).innerHTML = nl.length ? nl.map((n) => `<button class="li" data-n="${n._id}"><span class="nm">${esc(n.name)}</span><span class="pill ${PILL(n.rstatus)}">${esc(n.rstatus || n.status || '')}</span><span class="ct">${esc(n.analyst || '')}</span></button>`).join('') : `<div class="empty">No Needles published or republished on ${day}</div>`;
    $$('[data-n]', host).forEach((b) => { b.onclick = () => APP.go('needles', (v) => v.focus(b.dataset.n)); });
    $('[data-journal]', host).innerHTML = jDay.length ? jDay.sort((a, b) => (b.time || '').localeCompare(a.time || '')).map((j) => `<button class="li" data-j="${j._id}"><span class="ct">${esc(j.time || '')}</span><span class="pill ${PILL(j.type)}">${esc(j.type)}</span><span class="nm">${esc([j.group, j.victim].filter(Boolean).join(': '))}${j.notes ? ` <small style="color:var(--ink-3)">${esc(j.notes.slice(0, 80))}</small>` : ''}</span><span class="ct">${esc(j.analyst || '')}</span></button>`).join('') : `<div class="empty">Nothing logged on ${day}. Use "Log an update".</div>`;
    $$('[data-j]', host).forEach((b) => { b.onclick = () => APP.go('journal', (v) => v.grid.focus(b.dataset.j)); });
    const days = []; for (let i = 13; i >= 0; i--) days.push(addDays(day, -i));
    const cnt = new Map(days.map((d) => [d, 0])); for (const r of V) { const d = dateOf(r.created); if (cnt.has(d)) cnt.set(d, cnt.get(d) + 1); }
    const mx = Math.max(1, ...cnt.values());
    $('[data-trend]', host).innerHTML = days.map((d) => `<div class="b"><span class="t${d === day ? '" style="font-weight:600' : ''}">${d}</span><span class="bar2"><i style="width:${(cnt.get(d) / mx) * 100}%"></i></span><span class="n">${fmtN(cnt.get(d))}</span></div>`).join('');
    APP.counts();
  }
  $('[data-day]', host).onchange = (e) => { if (e.target.value) { APP.day = e.target.value; render(); } };
  $('[data-prev]', host).onclick = () => { APP.day = addDays(APP.day, -1); $('[data-day]', host).value = APP.day; render(); };
  $('[data-next]', host).onclick = () => { APP.day = addDays(APP.day, 1); $('[data-day]', host).value = APP.day; render(); };
  $('[data-asof]', host).onclick = () => { APP.day = DB.asOf; $('[data-day]', host).value = APP.day; render(); };
  $('[data-log]', host).onclick = () => APP.go('journal', (v) => v.prefill({ date: APP.day }));
  $('[data-addv]', host).onclick = () => addForm(DB.tables.victims, { created: APP.day + ' ' + nowISO().slice(11) }, () => render());
  $('[data-digest]', host).onclick = () => copyText(APP.digest(APP.day));
  onChange(() => { if (host.classList.contains('active')) render(); else view.dirty = true; });
  view.show = () => { render(); view.dirty = false; };
  render();
  return view;
}
APP.digest = function (day) {
  const V = DB.tables.victims.rows.filter((r) => dateOf(r.created) === day), J = DB.tables.journal.rows.filter((j) => j.date === day);
  const gs = new Map(); V.forEach((r) => gs.set(r.group, (gs.get(r.group) || []).concat(r.victim)));
  const lines = [`Daily digest ${day}`, `${V.length} new victims across ${gs.size} groups`];
  Array.from(gs.entries()).sort((a, b) => b[1].length - a[1].length).forEach(([g, vs]) => lines.push(`- ${g} (${vs.length}): ${vs.slice(0, 12).join('; ')}${vs.length > 12 ? '; …' : ''}`));
  if (J.length) { lines.push('', `Investigator log (${J.length})`); J.forEach((j) => lines.push(`- ${j.time || ''} ${j.type} · ${[j.group, j.victim].filter(Boolean).join(': ')}${j.analyst ? ' · ' + j.analyst : ''}${j.notes ? ' · ' + j.notes.replace(/\s+/g, ' ') : ''}`)); }
  return lines.join('\n');
};

/* ---- Sheets tab: every raw tab from both workbooks ---- */
function mountSheets(host) {
  let cur = 0;
  const sel = `<select data-sheet style="height:30px;border:1px solid var(--grid);border-radius:5px;background:#fff;padding:0 6px;max-width:340px">${DB.sheets.map((t, i) => `<option value="${i}">${esc(t.wb)} › ${esc(t.title)} (${fmtN(t.rows.length)})</option>`).join('')}</select>`;
  const tv = TableView(host, { id: 'sheets', table: () => DB.sheets[cur], title: 'Sheets', extraHtml: sel, meta: (t) => `${t.wb} · ${fmtN(t.rows.length)} rows · ${t.cols.length} columns`, rowTitle: (r) => r.c0 || 'Row ' + r._row, noLog: false });
  host.querySelector('[data-sheet]').onchange = (e) => { cur = +e.target.value; tv.state.ver = -1; tv.state.active = null; tv.state.sel.clear(); tv.state.facet = {}; tv.state.hidden = new Set(); tv.run(); };
  return tv;
}

/* ---- Investigator tab ---- */
function mountJournal(host) {
  host.innerHTML = `<div class="logform"><div class="fh"><h3>${ico('flag')} Log an update</h3><span class="sp"></span><span class="meta" style="font-size:12px;color:var(--ink-3)">Saved in this browser. Use Backup to keep a copy or move it to another computer.</span></div>
    <form class="form" data-form>
      <label>Date<input name="date" type="date" value="${todayISO()}" required></label>
      <label>Time<input name="time" type="time" value="${nowISO().slice(11)}"></label>
      <label>Update type<select name="type">${JTYPES.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label>Analyst<input name="analyst" list="dl-analysts" value="${esc(APP.me)}" placeholder="Your name"></label>
      <label>Group<input name="group" list="dl-groups" placeholder="Start typing a group" autocomplete="off"></label>
      <label>Victim<input name="victim" list="dl-victims" placeholder="Company or organisation" autocomplete="off"></label>
      <label>Status<select name="status">${JSTATUS.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label>Priority<select name="priority"><option value=""></option>${PRIO.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label class="full">Onion / leak-site URL<input name="onion" placeholder="http://….onion/… (filled from the group when known)" class="mono"></label>
      <label>Needle / Wagtail link<input name="needle" placeholder="https://intel-api.zerofox.com/…"></label>
      <label>Other link<input name="link" placeholder="Press, ransomware.live, screenshot…"></label>
      <label>Country<input name="country" placeholder="US"></label>
      <label>Sector<input name="sector" list="dl-sectors"></label>
      <label>Tags<input name="tags" placeholder="comma separated"></label>
      <label class="full">Notes<textarea name="notes" placeholder="What changed, what you saw, what is next"></textarea></label>
      <label class="chk full"><input type="checkbox" name="alsoVictim"> Also add this as a new victim in the Victims ledger (for "New victim")</label>
      <div class="full" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-reset>Clear</button><button type="submit" class="btn accent">${ico('plus')}Save entry</button></div>
    </form></div>
    <div data-grid style="display:flex;flex-direction:column;flex:1;min-height:0"></div>
    <datalist id="dl-groups"></datalist><datalist id="dl-victims"></datalist><datalist id="dl-analysts"></datalist><datalist id="dl-sectors"></datalist>`;
  const form = $('[data-form]', host);
  const fillLists = () => {
    $('#dl-groups').innerHTML = DB.tables.groups.rows.slice().sort((a, b) => b.victims - a.victims).map((g) => `<option value="${esc(g.name)}">`).join('');
    const an = new Set(DB.tables.needles.rows.map((n) => n.analyst).filter(Boolean)); DB.tables.journal.rows.forEach((j) => j.analyst && an.add(j.analyst));
    $('#dl-analysts').innerHTML = Array.from(an).sort().map((a) => `<option value="${esc(a)}">`).join('');
    $('#dl-sectors').innerHTML = Array.from(new Set(DB.tables.victims.rows.map((v) => v.sector).filter(Boolean))).sort().map((a) => `<option value="${esc(a)}">`).join('');
  };
  fillLists();
  form.group.addEventListener('change', () => {
    const g = groupFor(form.group.value); if (g) { form.group.value = g.name; if (!form.onion.value) form.onion.value = g.onion || ''; }
    const vs = DB.tables.victims.rows.filter((v) => g ? norm(v.group) === norm(g.name) : true).sort((a, b) => (b.created || '').localeCompare(a.created || '')).slice(0, 400);
    $('#dl-victims').innerHTML = vs.map((v) => `<option value="${esc(v.victim)}">${esc(dateOf(v.created))}</option>`).join('');
  });
  form.victim.addEventListener('change', () => { const g = groupFor(form.group.value); const v = DB.tables.victims.rows.find((x) => norm(x.victim) === norm(form.victim.value) && (!g || norm(x.group) === norm(g.name))); if (v) { if (!form.country.value) form.country.value = v.cc; if (!form.sector.value) form.sector.value = v.sector; if (!form.onion.value) form.onion.value = v.claim || v.onion; if (!form.group.value) form.group.value = v.group; } });
  form.addEventListener('submit', (e) => {
    e.preventDefault(); const o = {}; Array.from(form.elements).forEach((f) => { if (f.name && f.type !== 'checkbox') o[f.name] = f.value.trim(); });
    if (!o.group && !o.victim && !o.notes) { toast('Add at least a group, a victim or a note'); return; }
    if (o.analyst && o.analyst !== APP.me) APP.setMe(o.analyst);
    const res = APP.addTo('journal', [o]);
    if (form.alsoVictim.checked && o.victim) { const r = APP.addTo('victims', [{ group: o.group || 'Unknown', victim: o.victim, cc: o.country, sector: o.sector, created: o.date + ' ' + (o.time || '00:00'), claim: isOnion(o.onion) ? o.onion : '', press: o.link, notes: o.notes, pub: o.type === 'Data published' ? 'Yes' : 'Unknown' }]); toast(r.added.length ? 'Logged and added to Victims' : 'Logged (victim was already in the ledger)'); }
    else toast('Logged');
    form.reset(); form.date.value = todayISO(); form.time.value = nowISO().slice(11); form.analyst.value = APP.me; fillLists();
    if (res.added[0]) view.grid.focus(res.added[0]._id);
  });
  $('[data-reset]', host).onclick = () => { form.reset(); form.date.value = todayISO(); form.time.value = nowISO().slice(11); form.analyst.value = APP.me; };
  const view = {};
  view.grid = TableView($('[data-grid]', host), {
    table: 'journal', title: 'Investigator log', defaultSort: { k: 'created', d: -1 }, dateKey: 'date', noLog: true, noAdd: true,
    presets: [{ label: 'Today', filter: (r) => r.date === todayISO() }, { label: 'Open', filter: (r) => r.status === 'Open' || r.status === 'In progress' }, { label: 'New victims', filter: (r) => r.type === 'New victim' }, { label: 'Mine', filter: (r) => r.analyst && r.analyst === APP.me }],
    toolsHtml: `<button class="btn sm" data-digest>${ico('copy')}Copy day digest</button>`,
    related: (r) => { const out = []; const g = groupFor(r.group); if (g) out.push({ id: 'g', title: 'Group', items: [{ label: g.name, sub: `${fmtN(g.victims)} victims · ${g.site}`, go: () => APP.showGroup(g.name) }] }); const v = DB.tables.victims.rows.find((x) => norm(x.victim) === norm(r.victim) && (!g || norm(x.group) === norm(g.name))); if (v) out.push({ id: 'v', title: 'Ledger victim', items: [{ label: v.victim, sub: `${v.group} · ${dateOf(v.created)}`, go: () => APP.go('victims', (t) => t.focus(v._id)) }] }); return out; },
    rowTitle: (r) => `${r.date} · ${r.type}${r.group || r.victim ? ' · ' + [r.group, r.victim].filter(Boolean).join(': ') : ''}`
  });
  host.querySelector('[data-digest]').onclick = () => { const d = view.grid.state.from || todayISO(); copyText(APP.digest(d)); };
  view.prefill = (pre) => { form.reset(); form.date.value = pre.date || todayISO(); form.time.value = nowISO().slice(11); Object.keys(pre).forEach((k) => { if (form[k] && form[k].type !== 'checkbox' && pre[k] != null) form[k].value = pre[k]; }); if (!form.analyst.value) form.analyst.value = APP.me; form.group.dispatchEvent(new Event('change')); if (pre.onion) form.onion.value = pre.onion; form.notes.focus(); host.scrollTop = 0; };
  view.setDay = (d) => view.grid.setFilter({}, d, d);
  view.show = () => { view.grid.show(); fillLists(); };
  return view;
}

/* ---- me, backup, help, export all ---- */
APP.setMe = function (name) { APP.me = String(name || '').trim(); store.set('me', APP.me); $('#meLbl').textContent = APP.me || 'Set your name'; };
APP.exportAll = async function () {
  busy('Building the full workbook... this takes a few seconds');
  try {
    const sheets = ['mixed', 'victims', 'needles', 'groups', 'journal'].map((id) => { const t = DB.tables[id]; return { name: t.title, header: t.cols.map((c) => c.name), rows: t.rows.map((r) => t.cols.map((c) => r[c.k])) }; });
    DB.sheets.forEach((t) => sheets.push({ name: t.title, header: t.cols.map((c) => c.name), rows: t.rows.map((r) => t.cols.map((c) => r[c.k])) }));
    await xlsxDownload(`samurai_scan_database_${todayISO()}.xlsx`, sheets);
  } catch (e) { toast('Export failed: ' + e.message); } finally { busy(false); }
};
APP.backup = function () {
  const keys = store.keys(); const size = keys.reduce((a, k) => a + (localStorage.getItem(PFX + k) || '').length, 0);
  const changed = ['victims', 'needles', 'groups', 'journal'].concat(DB.sheets.map((s) => s.id)).map((id) => { const d = loadDelta(id); const n = d.added.length + Object.keys(d.edits).length + d.deleted.length; return n ? `${DB.tables[id].title}: ${d.added.length} added, ${Object.keys(d.edits).length} edited, ${d.deleted.length} deleted` : ''; }).filter(Boolean);
  modal({ title: 'Backup and restore', body: `<p style="margin-top:0">Everything you add or edit is kept in this browser (${(size / 1024).toFixed(0)} KB). The packed ledger itself never changes, so a backup holds only your changes and is small.</p>
    <ul style="margin:0 0 12px 18px;font-size:13px">${changed.length ? changed.map((c) => `<li>${esc(c)}</li>`).join('') : '<li>No changes yet</li>'}</ul>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn accent" data-b="save">${ico('download')}Download backup (.json)</button><button class="btn" data-b="load">${ico('upload')}Restore from a backup</button><button class="btn" data-b="xlsx">${ico('layers')}Export whole database (.xlsx)</button><button class="btn danger" data-b="wipe">${ico('trash')}Discard all my changes</button></div>
    <p style="font-size:12.5px;color:var(--ink-3)">Restoring merges the backup into what is here. To move your work to another computer, download a backup here and restore it there.</p>`, wire: (bg, close) => {
    bg.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-b]'); if (!b) return; const a = b.dataset.b;
      if (a === 'save') { const o = { app: 'samurai-scan', version: 1, saved: nowISO(), me: APP.me, data: {} }; keys.forEach((k) => { o.data[k] = store.get(k); }); download(`samurai_scan_backup_${todayISO()}.json`, JSON.stringify(o), 'application/json'); }
      else if (a === 'xlsx') { close(); APP.exportAll(); }
      else if (a === 'load') { const f = await pickFile('.json'); if (!f) return; try { const o = JSON.parse(await f.text()); if (!o.data) throw new Error('not a Samurai Scan backup'); let n = 0; for (const k in o.data) { if (k.startsWith('delta:')) { const cur = loadDelta(k.slice(6)), inc = o.data[k]; const ids = new Set(cur.added.map((x) => x._id)); inc.added.forEach((x) => { if (!ids.has(x._id)) cur.added.push(x); }); Object.assign(cur.edits, inc.edits || {}); cur.deleted = Array.from(new Set(cur.deleted.concat(inc.deleted || []))); store.set(k, cur); n++; } else if (k.startsWith('tv:') || k === 'me') store.set(k, o.data[k]); } toast(`Restored ${n} tables. Reloading...`); setTimeout(() => location.reload(), 800); } catch (err) { toast('Could not restore: ' + err.message); } }
      else if (a === 'wipe') { if (await confirmDlg('Discard changes', 'Remove every row you added, every edit and every log entry from this browser? Download a backup first if you may want them back.', 'Discard everything')) { keys.forEach((k) => { if (k.startsWith('delta:')) store.del(k); }); location.reload(); } }
    });
  } });
};
APP.help = function () {
  modal({ title: 'How this workbench works', wide: true, body: `
  <h4>Tabs</h4><ul>
  <li><b>Today</b>: what was discovered, published and logged on a given day. Click any number to open the matching rows.</li>
  <li><b>Mixed database</b>: one row per ledger victim, joined with its Needle (analyst, republish status, dates, Wagtail and live links) and its group's onion site, collector and status. Needles with no ledger victim appear as "Needle only". Edits write through to Victims, Needles or Groups.</li>
  <li><b>Victims</b>: the full ransomware ledger (${fmtN(DB.tables.victims.rows.length)} rows) with the group's onion site and the leak-site claim URL in every row.</li>
  <li><b>Needles</b>: every row of every Needle tracker sheet, including CVEs, threat-actor profiles and monthly reports.</li>
  <li><b>Groups &amp; leak sites</b>: ${fmtN(DB.tables.groups.rows.length)} groups with onion addresses, mirrors, private negotiation pages, assigned collector, analyst and live victim and Needle counts.</li>
  <li><b>Sheets</b>: the ${DB.sheets.length} original tabs of both workbooks, untouched, each searchable and editable.</li>
  <li><b>Investigator</b>: your daily log. Add new victims, updates, republishes, leak-site changes and notes. "Log an update" on any row pre-fills the form.</li></ul>
  <h4>Search</h4><p>Each tab has its own search. Type words in any order: every word must appear somewhere in the row. <code>"exact phrase"</code>, <code>-word</code> to exclude, <code>column:value</code> to restrict to one column (<code>group:qilin country:US sector:health</code>). Press <kbd>/</kbd> to jump to the search box. Dropdown filters and the date range combine with the search.</p>
  <h4>Editing</h4><p>Double-click a cell to edit it. Enter saves, Escape cancels. Click a row for the detail panel with every field, copy buttons and related rows. Select rows with the checkboxes to copy, export or delete them. Undo is in the toolbar. Everything is saved in this browser; use <b>Backup</b> to download your changes or move them to another computer.</p>
  <h4>Onion links</h4><p>Addresses ending in .onion show a TOR tag. Click one to copy it, then open it in Tor Browser. Other links open in a new tab.</p>
  <h4>Export and import</h4><p>Export gives Excel, CSV or JSON of what you see, or the whole database as one workbook with every tab. Import merges rows from Excel, CSV or JSON with a column mapping; duplicates are skipped.</p>
  <h4>Loading data</h4><p>${DB.embedded ? `The packed ledger is current to ${DB.asOf}. <b>Data</b> in the top bar merges more files (a newer ledger CSV, tracker or assignments workbook, or exports from this page) without rebuilding.` : 'This page has no data inside it. <b>Data</b> in the top bar shows the files you loaded, lets you add newer ones or remove old ones, and remembers them in this browser.'} Recognised sheets: ledger victims (Group, Victim, Discovered…), Needle trackers (Name, Analyst, Wagtail…), leak-site and assignment sheets, and this page's own Victims, Needles, Groups and Investigator exports. Anything else becomes a raw sheet.</p>` });
};

/* ---- boot ---- */
async function boot() {
  let base, raw;
  try { base = await unpack(); } catch (e) { $('#busyMsg').textContent = 'Could not unpack the database: ' + e.message + '. Use a current Chrome, Edge, Firefox or Safari.'; return; }
  DB.embedded = !!base; setStorageMode(DB.embedded); LOADED_KEY = DB.embedded ? 'files:embedded' : 'files:standalone'; APP.me = store.get('me') || '';
  let files = await loadedFiles();
  if (!base && !files.length) files = await loaderScreen(false);
  busy('Building tables...'); await new Promise((r) => setTimeout(r, 20));
  try { raw = files.length || !base ? mergeAll(base, files) : base; } catch (e) { console.error(e); toast('Could not merge the loaded files: ' + e.message, 6000); raw = base || mergeAll(null, []); }
  if (!raw.victims.length && !raw.needles.length && !raw.sheets.length) { await IDB.del(LOADED_KEY); files = await loaderScreen(false); raw = mergeAll(null, files); }
  buildTables(raw);
  if (raw.journal && raw.journal.length) { const res = addRows('journal', raw.journal.map((o) => Object.assign({ created: nowISO() }, o)), { silent: true }); if (res.added.length) console.info('journal rows imported from files:', res.added.length); }
  if (files.length && raw.stats) setTimeout(() => toast(`Loaded ${files.length} file${files.length === 1 ? '' : 's'}: ` + mergeSummary(raw.stats), 7000), 400);
  $('#stat').textContent = DB.embedded ? `Ledger as of ${DB.asOf} · built __BUILT__` : `Data from ${files.length} file${files.length === 1 ? '' : 's'} · ${fmtN(raw.victims.length)} victims · ${fmtN(raw.needles.length)} Needles`;
  APP.setMe(APP.me);
  $('#meLbl').textContent = APP.me || 'Set your name';
  APP.views.victims = TableView($('#host-victims'), { table: 'victims', defaultSort: { k: 'created', d: -1 }, dateKey: 'created', facets: ['group', 'sector', 'cc'], related: relVictim, placeholder: 'Search victims: company, group, domain, country, sector, onion…',
    presets: [{ label: 'Last 24h', filter: (r) => dateOf(r.created) >= addDays(DB.asOf, -1) }, { label: 'Last 7 days', filter: (r) => msOf(r.created) >= msOf(DB.asOf) - 6 * DAY }, { label: 'Data published', filter: (r) => r.pub === 'Yes' || r.pub === 'Partial' }, { label: 'Added by me', filter: (r) => r._src === 'added' }, { label: 'Onion known', filter: (r) => isOnion(r.onion) || isOnion(r.claim) }] });
  APP.views.needles = TableView($('#host-needles'), { table: 'needles', defaultSort: { k: 'pdate', d: -1 }, dateKey: 'pdate', facets: ['analyst', 'quarter', 'actor', 'sheet'], related: relNeedle, placeholder: 'Search Needles: name, actor, analyst, quarter, status…',
    presets: [{ label: 'Update awaiting', filter: (r) => /awaiting/i.test(r.rstatus) }, { label: 'Download link present', filter: (r) => /link present/i.test(r.rstatus) }, { label: 'Republished', filter: (r) => r.rstatus === 'Yes' }, { label: 'Victim removed', filter: (r) => /removed/i.test(r.rstatus) }, { label: 'Not in ledger', filter: (r) => r.match === 'None' && r.victim }] });
  APP.views.groups = TableView($('#host-groups'), { table: 'groups', defaultSort: { k: 'last', d: -1 }, dateKey: 'last', facets: ['site', 'collector', 'analyst', 'kind', 'priority'], related: relGroup, rowTitle: (r) => r.name, placeholder: 'Search groups: name, alias, onion address, collector, analyst…',
    presets: [{ label: 'Site up', filter: (r) => r.site === 'Up' }, { label: 'Posted this month', filter: (r) => r.last && r.last >= addDays(DB.asOf, -30) }, { label: 'Has onion', filter: (r) => isOnion(r.onion) }, { label: 'Unassigned', filter: (r) => !r.collector && r.victims > 0 }, { label: 'Not in ledger', filter: (r) => r.inledger === 'No' }] });
  APP.views.mixed = TableView($('#host-mixed'), { table: 'mixed', defaultSort: { k: 'created', d: -1 }, dateKey: 'created', facets: ['group', 'nanalyst', 'quarter', 'collector', 'sheet'], related: (r) => (r._v ? relVictim(r) : r._n ? relNeedle(r._n) : []), onEdit: editMixed, placeholder: 'Search across victims, Needles and leak sites at once…', noDelete: true, noImport: true,
    onAdd: () => addForm(DB.tables.victims), meta: (t) => `${fmtN(t.rows.filter((r) => r.match === 'Exact' || r.match === 'Close').length)} victims have a Needle · ${fmtN(t.rows.filter((r) => r.match === 'Needle only').length)} Needles without a ledger row`,
    presets: [{ label: 'Needs a Needle (30 days)', tip: 'Named victims posted in the last 30 days with no Needle', filter: (r) => r.match === 'Ledger only' && r.type === 'Named' && msOf(r.created) >= msOf(DB.asOf) - 30 * DAY }, { label: 'Has Needle', filter: (r) => r.match === 'Exact' || r.match === 'Close' }, { label: 'Close matches', filter: (r) => r.match === 'Close' }, { label: 'Needle only', filter: (r) => r.match === 'Needle only' }, { label: 'Update awaiting', filter: (r) => /awaiting/i.test(r.rstatus) }] });
  APP.views.sheets = mountSheets($('#host-sheets'));
  APP.views.journal = mountJournal($('#host-journal'));
  APP.views.today = mountToday($('#host-today'));
  $$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => APP.go(b.dataset.tab)));
  $('#btnMe').onclick = () => modal({ title: 'Your name', body: `<label class="form" style="display:block">Analyst name<input data-me value="${esc(APP.me)}" list="dl-analysts" style="height:32px;border:1px solid var(--grid);border-radius:5px;padding:0 8px;width:100%;margin-top:4px"></label><p style="font-size:12.5px;color:var(--ink-3)">Used as the default analyst on log entries and Needles you add.</p>`, foot: `<button class="btn" data-x>Cancel</button><button class="btn accent" data-ok>Save</button>`, wire: (bg, close) => { const save = () => { APP.setMe(bg.querySelector('[data-me]').value); close(); }; bg.querySelector('[data-ok]').onclick = save; bg.querySelector('[data-me]').onkeydown = (e) => { if (e.key === 'Enter') save(); }; } });
  $('#btnBackup').onclick = APP.backup;
  APP.dataDialog = dataDialog; $('#btnData').onclick = dataDialog;
  $('#btnHelp').onclick = APP.help;
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); undo(); } });
  APP.counts(); updateUndo();
  busy(false);
  if (!store.get('seen') && !files.length) { store.set('seen', 1); setTimeout(() => toast('Tip: press / to search, double-click a cell to edit, click a row for details', 5000), 600); }
}
boot();
