/* ===== Search tab: one box, every table, pasted lists, bulk add of new victims ===== */
function splitTerms(text) {
  const raw = String(text || '');
  const listy = /[\n,;|\t]/.test(raw);
  const parts = (listy ? raw.split(/[\n,;|\t]+/) : [raw]).map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const seen = new Set(); const out = [];
  for (const p of parts) { const k = p.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(p); } }
  return { terms: out, listy };
}
function searchTables(terms, mode, scope) {
  const low = terms.map((t) => t.toLowerCase()); const perTerm = new Map(terms.map((t) => [t, 0]));
  const tables = [];
  const add = (t, tab) => { if (scope.has(tab === 'sheets' ? 'sheets' : t.id)) tables.push({ t, tab }); };
  add(DB.tables.victims, 'victims'); add(DB.tables.needles, 'needles'); add(DB.tables.groups, 'groups'); add(DB.tables.journal, 'journal');
  DB.sheets.forEach((t, si) => { if (scope.has('sheets')) tables.push({ t, tab: 'sheets', si }); });
  const results = []; let total = 0;
  for (const { t, tab, si } of tables) {
    const rows = [];
    for (const r of t.rows) {
      const text = rowText(r, t.cols); let hits;
      if (mode === 'all') { let ok = true; for (const w of low) if (!text.includes(w)) { ok = false; break; } if (!ok) continue; hits = terms; }
      else { hits = []; for (let i = 0; i < low.length; i++) if (text.includes(low[i])) hits.push(terms[i]); if (!hits.length) continue; }
      hits.forEach((h) => perTerm.set(h, perTerm.get(h) + 1)); rows.push({ r, hits });
    }
    if (rows.length) { results.push({ t, tab, si, rows }); total += rows.length; }
  }
  return { results, perTerm, total };
}

function mountSearch(host) {
  host.innerHTML = `<div class="dash" style="padding-top:10px">
    <div class="panel" style="padding:14px 16px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px"><h2 style="margin:0;font-size:16px">Search everything</h2><span style="color:var(--ink-3);font-size:12.5px">Victims, Needles, groups, leak sites, every sheet and your log, all at once.</span><span style="flex:1"></span>
        <span class="seg" data-mode><button data-m="auto" class="on" title="Lists match any item; a sentence matches all its words">Auto</button><button data-m="any" title="Find rows that contain any of the items">Any item</button><button data-m="all" title="Find rows that contain every word">All words</button></span></div>
      <div class="qbox" style="height:auto;align-items:flex-start;padding:4px 0">${ico('search').replace('class="i"', 'class="i qi"').replace('<svg', '<svg style="margin-top:10px"')}<textarea data-q rows="2" placeholder="Type anything: a company, a group, a domain, a country code, an onion address, an analyst… or paste a list (one per line, or separated by commas)" style="flex:1;border:0;background:none;outline:none;resize:vertical;min-height:40px;padding:8px 10px;font-size:14px;font-family:inherit;line-height:1.4"></textarea><button class="ib hide" data-qx aria-label="Clear" style="margin-top:7px">${ico('x')}</button></div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:12.5px;color:var(--ink-2)"><span>Look in:</span>
        ${[['victims', 'Victims'], ['needles', 'Needles'], ['groups', 'Groups & leak sites'], ['journal', 'Investigator log'], ['sheets', 'Raw sheets']].map(([k, l]) => `<label style="display:inline-flex;align-items:center;gap:4px"><input type="checkbox" data-scope="${k}" checked> ${l}</label>`).join('')}
        <span style="flex:1"></span><button class="btn sm" data-export disabled>${ico('download')}Export results</button></div>
    </div>
    <div data-terms style="margin-top:10px"></div>
    <div data-results style="margin-top:10px"></div>
    <div class="panel" style="padding:14px 16px;margin-top:14px" data-addpanel>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0;font-size:16px">Add new victims</h2><span style="color:var(--ink-3);font-size:12.5px">Paste one victim per line. Extra details are optional: <code>Victim, Group, Domain, Country, Sector, Date</code> (commas or tabs, straight from Excel).</span></div>
      <div style="display:grid;grid-template-columns:1fr 260px;gap:12px;margin-top:10px;align-items:start">
        <textarea data-bulk rows="6" placeholder="Acme Corp, Qilin, acme.com, US, Manufacturing, 2026-10-08&#10;Contoso Ltd&#10;Fabrikam GmbH, LockBit" style="width:100%;border:1px solid var(--grid);border-radius:6px;padding:8px 10px;font-size:13px;font-family:inherit;resize:vertical"></textarea>
        <div class="form" style="grid-template-columns:1fr">
          <label>Group for lines without one<input data-bgroup list="dl-groups" placeholder="Group name" autocomplete="off"></label>
          <label>Discovered date for lines without one<input data-bdate type="date" value="${todayISO()}"></label>
          <label>Data published<select data-bpub><option>Unknown</option><option>Yes</option><option>Partial</option><option>No</option></select></label>
          <label class="chk"><input type="checkbox" data-blog checked> Also log each one in Investigator</label>
        </div></div>
      <div data-bprev style="margin-top:8px;font-size:12.5px;color:var(--ink-2)"></div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center"><button class="btn accent" data-badd disabled>${ico('plus')}Add victims</button><button class="btn" data-bclear>Clear</button><span data-bmsg style="font-size:12.5px;color:var(--ink-3)"></span></div>
    </div></div>`;
  const el = { q: $('[data-q]', host), qx: $('[data-qx]', host), terms: $('[data-terms]', host), results: $('[data-results]', host), exp: $('[data-export]', host), bulk: $('[data-bulk]', host), bgroup: $('[data-bgroup]', host), bdate: $('[data-bdate]', host), bpub: $('[data-bpub]', host), blog: $('[data-blog]', host), bprev: $('[data-bprev]', host), badd: $('[data-badd]', host), bmsg: $('[data-bmsg]', host) };
  const S = { mode: 'auto', scope: new Set(['victims', 'needles', 'groups', 'journal', 'sheets']), last: null, expanded: new Set() };
  const view = {};

  /* ---- search ---- */
  function run() {
    const { terms, listy } = splitTerms(el.q.value); el.qx.classList.toggle('hide', !el.q.value);
    if (!terms.length) { el.terms.innerHTML = ''; el.results.innerHTML = `<div class="empty">Start typing, or paste a list of names to check them all at once.</div>`; el.exp.disabled = true; S.last = null; return; }
    let mode = S.mode; let useTerms = terms;
    if (mode === 'auto') mode = listy ? 'any' : 'all';
    if (mode === 'all' && !listy) useTerms = terms[0].split(/\s+/).filter(Boolean);
    if (mode === 'all' && listy) useTerms = terms;
    const t0 = performance.now(); const res = searchTables(useTerms, mode, S.scope); S.last = { res, terms: useTerms, mode };
    const hl = highlighter(useTerms.map((v) => ({ val: v.toLowerCase(), neg: false })));
    const found = useTerms.filter((t) => res.perTerm.get(t) > 0), missing = useTerms.filter((t) => !res.perTerm.get(t));
    el.terms.innerHTML = `<div class="panel" style="padding:10px 16px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px"><b>${fmtN(res.total)}</b> matching rows in ${res.results.length} table${res.results.length === 1 ? '' : 's'} · ${mode === 'all' ? 'every word must appear' : 'any item may appear'} · ${(performance.now() - t0).toFixed(0)} ms
      ${useTerms.length > 1 ? `<span style="color:var(--ink-3)">· ${found.length} of ${useTerms.length} items found</span>` : ''}<span style="flex:1"></span>
      ${missing.length ? `<button class="btn sm" data-copymiss>${ico('copy')}Copy not found (${missing.length})</button><button class="btn sm accent" data-addmiss>${ico('plus')}Add not found as new victims</button>` : ''}</div>
      ${useTerms.length > 1 ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${useTerms.map((t) => `<span class="pill ${res.perTerm.get(t) ? 'yes' : 'bad'}" title="${res.perTerm.get(t) ? 'Found' : 'Not found anywhere'}">${esc(t)} · ${fmtN(res.perTerm.get(t))}</span>`).join('')}</div>` : ''}</div>`;
    el.results.innerHTML = res.results.length ? res.results.map((sec, i) => renderSection(sec, i, hl)).join('') : `<div class="panel empty">Nothing found anywhere for that. Check the spelling, or search a shorter part of the name.</div>`;
    el.exp.disabled = !res.total;
  }
  const TABNAME = { victims: 'Victims', needles: 'Needles', groups: 'Groups & leak sites', journal: 'Investigator log', sheets: 'Sheet' };
  function keyCols(t, tab) {
    const pick = (ks) => ks.map((k) => t.cols.find((c) => c.k === k)).filter(Boolean);
    if (tab === 'victims') return pick(['group', 'victim', 'created', 'cc', 'sector', 'domain', 'onion']);
    if (tab === 'needles') return pick(['name', 'analyst', 'rstatus', 'pdate', 'rdate', 'sheet']);
    if (tab === 'groups') return pick(['name', 'site', 'onion', 'victims', 'last', 'collector']);
    if (tab === 'journal') return pick(['date', 'type', 'group', 'victim', 'analyst', 'notes']);
    return t.cols.slice(0, 6);
  }
  function renderSection(sec, i, hl) {
    const { t, tab, rows } = sec; const cols = keyCols(t, tab); const lim = S.expanded.has(i) ? 500 : 25;
    const cell = (r, c) => { const v = r[c.k]; if (v == null || v === '') return '<td></td>'; if (c.type === 'onion' || c.type === 'link') return `<td>${renderLinks(v, c.type, hl)}</td>`; if (c.type === 'enum') { const p = PILL(v); return `<td><span class="pill ${p}">${hl(String(v))}</span></td>`; } return `<td title="${esc(String(v).slice(0, 200))}">${hl(String(v).replace(/\s+/g, ' ').slice(0, 90))}</td>`; };
    return `<div class="panel" style="margin-bottom:10px"><div class="ph">${esc(tab === 'sheets' ? `Sheet: ${t.title}` : TABNAME[tab])}<span class="pill blue">${fmtN(rows.length)}</span><span class="sp"></span><button class="btn sm" data-open="${i}">Open in ${esc(tab === 'sheets' ? 'Sheets' : TABNAME[tab])} ${ico('ext')}</button></div>
      <div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr>${cols.map((c) => `<th style="text-align:left;padding:6px 10px;color:var(--ink-2);font-weight:600;white-space:nowrap;background:var(--head)">${esc(c.name)}</th>`).join('')}<th style="background:var(--head)"></th></tr></thead>
      <tbody>${rows.slice(0, lim).map(({ r, hits }) => `<tr data-row="${i}:${esc(r._id)}" style="cursor:pointer;border-top:1px solid #EDF2F4" title="${esc(hits.join(', '))}">${cols.map((c) => cell(r, c)).join('')}<td style="text-align:right;padding:4px 8px;white-space:nowrap"><button class="btn sm" data-log="${i}:${esc(r._id)}" title="Log an update for this row">${ico('flag')}</button></td></tr>`).join('')}</tbody></table></div>
      ${rows.length > lim ? `<div style="padding:8px 14px"><button class="btn sm" data-more="${i}">Show all ${fmtN(rows.length)}</button></div>` : ''}</div>`;
  }
  const open = (sec, id) => {
    if (sec.tab === 'sheets') APP.go('sheets', (v) => v.openSheet(sec.si, id));
    else if (sec.tab === 'journal') APP.go('journal', (v) => v.grid.focus(id));
    else APP.go(sec.tab, (v) => v.focus(id));
  };
  host.addEventListener('click', (e) => {
    const cp = e.target.closest('[data-copy]'); if (cp) { copyText(cp.dataset.copy); e.stopPropagation(); return; }
    if (e.target.closest('a')) return;
    const b = e.target.closest('[data-open],[data-more],[data-log],[data-row],[data-copymiss],[data-addmiss],[data-qx],[data-m],[data-badd],[data-bclear]'); if (!b || !S.last && !b.matches('[data-qx],[data-m],[data-badd],[data-bclear]')) return;
    if (b.matches('[data-qx]')) { el.q.value = ''; run(); el.q.focus(); return; }
    if (b.matches('[data-m]')) { S.mode = b.dataset.m; $$('[data-m]', host).forEach((x) => x.classList.toggle('on', x === b)); run(); return; }
    if (b.matches('[data-badd]')) { bulkAdd(); return; }
    if (b.matches('[data-bclear]')) { el.bulk.value = ''; previewBulk(); return; }
    const res = S.last.res;
    if (b.matches('[data-open]')) { const sec = res.results[+b.dataset.open]; const term = S.last.mode === 'all' ? S.last.terms.join(' ') : S.last.terms.length === 1 ? S.last.terms[0] : ''; if (sec.tab === 'sheets') APP.go('sheets', (v) => { v.openSheet(sec.si); if (term) v.setQuery(term); }); else if (sec.tab === 'journal') APP.go('journal', (v) => v.grid.setQuery(term)); else APP.go(sec.tab, (v) => v.setQuery(term)); return; }
    if (b.matches('[data-more]')) { S.expanded.add(+b.dataset.more); run(); return; }
    if (b.matches('[data-log]')) { const [i, id] = b.dataset.log.split(/:(.+)/); const sec = res.results[+i]; const r = sec.t.byId.get(id); if (r) APP.logFrom(r, sec.t); e.stopPropagation(); return; }
    if (b.matches('[data-row]')) { const [i, id] = b.dataset.row.split(/:(.+)/); open(res.results[+i], id); return; }
    if (b.matches('[data-copymiss]')) { copyText(S.last.terms.filter((t) => !res.perTerm.get(t)).join('\n')); return; }
    if (b.matches('[data-addmiss]')) { el.bulk.value = S.last.terms.filter((t) => !res.perTerm.get(t)).join('\n'); previewBulk(); $('[data-addpanel]', host).scrollIntoView({ behavior: 'smooth' }); el.bgroup.focus(); return; }
  });
  host.addEventListener('change', (e) => { if (e.target.matches('[data-scope]')) { if (e.target.checked) S.scope.add(e.target.dataset.scope); else S.scope.delete(e.target.dataset.scope); run(); } if (e.target.matches('[data-bgroup],[data-bdate],[data-bpub]')) previewBulk(); });
  el.q.addEventListener('input', debounce(run, 180));
  el.q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { el.q.value = ''; run(); } });
  el.exp.addEventListener('click', async () => {
    if (!S.last) return; busy('Building the workbook...');
    try { await xlsxDownload(`search_results_${todayISO()}.xlsx`, S.last.res.results.map((sec) => ({ name: sec.tab === 'sheets' ? sec.t.title : TABNAME[sec.tab], header: sec.t.cols.map((c) => c.name).concat(['Matched']), rows: sec.rows.map(({ r, hits }) => sec.t.cols.map((c) => r[c.k]).concat([hits.join(', ')])) }))); } catch (e) { toast('Export failed: ' + e.message); } finally { busy(false); }
  });

  /* ---- bulk add ---- */
  function parseBulk() {
    const lines = el.bulk.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); if (!lines.length) return { rows: [], header: null };
    const split = (l) => (l.includes('\t') ? l.split('\t') : l.split(/\s*[,;]\s*/)).map((s) => s.trim().replace(/^["']|["']$/g, ''));
    let header = null; const first = split(lines[0]).map((h) => norm(h));
    const HK = { victim: 'victim', victimname: 'victim', company: 'victim', name: 'victim', group: 'group', threatactor: 'group', actor: 'group', domain: 'domain', website: 'domain', country: 'cc', cc: 'cc', sector: 'sector', industry: 'sector', date: 'created', discovered: 'created', discoveredtracker: 'created', created: 'created', notes: 'notes', url: 'claim', claim: 'claim', leaksite: 'claim', onion: 'claim' };
    if (first.filter((h) => HK[h]).length >= 2) header = first.map((h) => HK[h] || '');
    const rows = [];
    for (const l of lines.slice(header ? 1 : 0)) {
      const p = split(l); const o = {};
      if (header) header.forEach((k, i) => { if (k && p[i]) o[k] = p[i]; });
      else { [o.victim, o.group, o.domain, o.cc, o.sector, o.created] = p; if (p.length > 6) o.notes = p.slice(6).join(', '); }
      if (!o.victim) continue;
      if (!o.group) o.group = el.bgroup.value.trim(); if (!o.created) o.created = el.bdate.value; o.created = dateClean(o.created) || todayISO(); o.pub = el.bpub.value; if (o.cc) o.cc = o.cc.toUpperCase().slice(0, 3);
      if (o.domain && !/\./.test(o.domain)) { o.cc = o.cc || o.domain; o.domain = ''; }
      if (!o.domain && /\.[a-z]{2,}$/i.test(o.victim) && !/\s/.test(o.victim)) o.domain = o.victim.toLowerCase();
      rows.push(o);
    }
    return { rows, header };
  }
  function previewBulk() {
    const { rows, header } = parseBulk();
    el.badd.disabled = !rows.length; el.badd.textContent = ''; el.badd.innerHTML = `${ico('plus')}Add ${rows.length ? fmtN(rows.length) + ' ' : ''}victim${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) { el.bprev.innerHTML = ''; return; }
    const noGroup = rows.filter((r) => !r.group).length; const existing = rows.filter((r) => DB.tables.victims.rows.some((v) => norm(v.victim) === norm(r.victim) && (!r.group || norm(v.group) === norm(r.group)))).length;
    el.bprev.innerHTML = `<div style="margin-bottom:4px">${header ? 'Header row recognised. ' : ''}${fmtN(rows.length)} victim${rows.length === 1 ? '' : 's'} ready${noGroup ? `, <span style="color:var(--bad)">${noGroup} without a group</span> (set one on the right)` : ''}${existing ? `, ${existing} already in Victims (will be skipped unless the date differs)` : ''}.</div>
      <table style="border-collapse:collapse;font-size:12px"><tr>${['Victim', 'Group', 'Domain', 'Country', 'Sector', 'Discovered'].map((h) => `<th style="text-align:left;padding:3px 10px 3px 0;color:var(--ink-3)">${h}</th>`).join('')}</tr>${rows.slice(0, 8).map((r) => `<tr>${[r.victim, r.group || '—', r.domain || '', r.cc || '', r.sector || '', r.created].map((v) => `<td style="padding:2px 10px 2px 0">${esc(v || '')}</td>`).join('')}</tr>`).join('')}${rows.length > 8 ? `<tr><td colspan="6" style="color:var(--ink-3)">… and ${fmtN(rows.length - 8)} more</td></tr>` : ''}</table>`;
  }
  function bulkAdd() {
    const { rows } = parseBulk(); if (!rows.length) return;
    const miss = rows.filter((r) => !r.group); if (miss.length) { toast(`${miss.length} line${miss.length === 1 ? '' : 's'} ha${miss.length === 1 ? 's' : 've'} no group. Type a group on the right.`); el.bgroup.focus(); return; }
    const res = APP.addTo('victims', rows);
    if (el.blog.checked && res.added.length) APP.addTo('journal', res.added.map((v) => ({ type: 'New victim', group: v.group, victim: v.victim, country: v.cc, sector: v.sector, onion: v.claim || v.onion, notes: v.notes || 'Added from the Search tab', date: dateOf(v.created) || todayISO(), status: 'Open' })));
    el.bmsg.textContent = `Added ${fmtN(res.added.length)} victim${res.added.length === 1 ? '' : 's'}${res.dup ? `, skipped ${fmtN(res.dup)} already present` : ''}.`;
    toast(el.bmsg.textContent); if (res.added.length) { el.bulk.value = ''; previewBulk(); if (el.q.value) run(); }
  }
  el.bulk.addEventListener('input', debounce(previewBulk, 150));
  el.bulk.addEventListener('paste', () => setTimeout(previewBulk, 50));

  onChange(() => { if (host.classList.contains('active')) { if (S.last) run(); if (el.bulk.value) previewBulk(); } else view.dirty = true; });
  view.show = () => { if (view.dirty) { view.dirty = false; if (S.last) run(); } setTimeout(() => el.q.focus(), 50); };
  view.search = (text) => { el.q.value = text; run(); };
  run();
  return view;
}
