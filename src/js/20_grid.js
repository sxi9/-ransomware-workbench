/* ===== TableView: search bar + filters + virtual grid + detail drawer + add/import/export ===== */
const RH = 34;
const PILL = (v) => {
  const s = String(v || '').toLowerCase();
  if (!s) return '';
  if (/^(yes|exact|up|completed|done|active|p0|p1|new victim|data published)$/.test(s)) return 'yes';
  if (/awaiting|partial|close|working|in progress|p2|watching|update|download link present/.test(s)) return 'warn';
  if (/removed|seized|^no$|dead|^down$|not present|p3|p4|takedown/.test(s)) return 'bad';
  if (/needle only|ledger only|telegram|open|placeholder|masked/.test(s)) return 'blue';
  if (/needle|group|observation|note|leak site/.test(s)) return 'purple';
  return '';
};
function linkLabel(u) { u = String(u || '').trim(); const m = /^(?:[a-z]+:\/\/)?([^/\s?#]+)/i.exec(u); return m ? m[1].replace(/^www\./, '') : u; }
function splitLinks(v) { return String(v || '').split(/[\n;]+|,\s+(?=https?:|www\.|[a-z2-7]{16,}\.onion)/i).map((s) => s.trim()).filter(Boolean); }
function renderLinks(v, type, h) {
  const parts = splitLinks(v); if (!parts.length) return '';
  const first = parts[0]; const more = parts.length > 1 ? ` <small style="color:var(--ink-3)">+${parts.length - 1}</small>` : '';
  if (type === 'onion' && (isOnion(first) || !isUrl(first))) {
    if (!isUrl(first) && !isOnion(first)) return `<span>${h(first)}</span>`;
    return `<span class="tor" data-copy="${esc(first)}" title="Click to copy. Open it in Tor Browser.&#10;${esc(first)}"><span class="tag">TOR</span><span class="u">${h(linkLabel(first))}</span></span>${more}`;
  }
  if (isUrl(first)) return `<a href="${esc(hrefOf(first))}" target="_blank" rel="noopener noreferrer" title="${esc(first)}">${h(linkLabel(first))}</a>${more}`;
  return `<span title="${esc(v)}">${h(first)}</span>${more}`;
}

function TableView(host, opts) {
  const self = { host, opts };
  const T = () => (typeof opts.table === 'function' ? opts.table() : DB.tables[opts.table]);
  const pk = 'tv:' + (opts.id || opts.table);
  const prefs = Object.assign({ hidden: null, sort: null, w: {} }, store.get(pk) || {});
  const S = { q: '', toks: [], facet: {}, from: '', to: '', sort: prefs.sort || opts.defaultSort || null, hidden: new Set(prefs.hidden || T().cols.filter((c) => c.hide).map((c) => c.k)), sel: new Set(), active: null, rows: [], preset: null, ver: -1, facets: null, drawer: true };
  const savePrefs = () => store.set(pk, { hidden: Array.from(S.hidden), sort: S.sort, w: prefs.w });
  const dateCol = () => T().cols.find((c) => c.k === (opts.dateKey || '')) || T().cols.find((c) => c.type === 'date');

  host.innerHTML = `
    <div class="bar"><h2>${esc(opts.title || T().title)}</h2><span class="meta" data-meta></span><span class="sp"></span>
      <span data-extra></span>
      ${opts.noAdd ? '' : `<button class="btn accent sm" data-add>${ico('plus')}Add</button>`}
      ${opts.noImport ? '' : `<button class="btn sm" data-import title="Merge rows from an Excel, CSV or JSON file">${ico('upload')}Import</button>`}
      <button class="btn sm" data-export>${ico('download')}Export${ico('chev')}</button>
      <button class="btn sm" data-cols title="Show or hide columns">${ico('cols')}Columns</button>
      <button class="btn sm icon" data-undo title="Undo" aria-label="Undo">${ico('undo')}</button>
    </div>
    <div class="qwrap"><div class="qbox">${ico('search').replace('class="i"', 'class="i qi"')}<input type="search" data-q placeholder="${esc(opts.placeholder || 'Search every column, word by word')}" autocomplete="off" spellcheck="false"><span class="kbd">/</span><button class="ib hide" data-qx aria-label="Clear search">${ico('x')}</button></div>
      <span class="seg" data-presets></span></div>
    <div class="filters" data-filters></div>
    <div class="hint">Every word must appear somewhere in the row. Use <kbd>"exact phrase"</kbd>, <kbd>-word</kbd> to exclude, <kbd>column:value</kbd> to search one column (for example <kbd>group:qilin</kbd>, <kbd>country:US</kbd>).</div>
    <div class="tool"><span class="sum" data-sum></span><span class="sp" style="flex:1"></span><span data-tools></span></div>
    <div class="selbar hide" data-selbar></div>
    <div class="gridwrap"><div class="gridmain"><div class="ghead"><div class="hrow" data-hrow></div></div><div class="gbody" data-body><div class="spacer" data-spacer></div></div><div class="noresult hide" data-none></div></div><aside class="drawer hide" data-drawer></aside></div>`;

  const el = {
    q: $('[data-q]', host), qx: $('[data-qx]', host), presets: $('[data-presets]', host), filters: $('[data-filters]', host), sum: $('[data-sum]', host), meta: $('[data-meta]', host), selbar: $('[data-selbar]', host),
    hrow: $('[data-hrow]', host), body: $('[data-body]', host), spacer: $('[data-spacer]', host), none: $('[data-none]', host), drawer: $('[data-drawer]', host), ghead: $('.ghead', host), tools: $('[data-tools]', host), extra: $('[data-extra]', host)
  };
  if (opts.extraHtml) el.extra.innerHTML = opts.extraHtml;
  if (opts.toolsHtml) el.tools.innerHTML = opts.toolsHtml;

  /* ---- columns ---- */
  const visCols = () => T().cols.filter((c) => !S.hidden.has(c.k));
  const cw = (c) => prefs.w[c.k] || c.w;
  function renderHead() {
    const cols = visCols();
    el.hrow.innerHTML = `<div class="hcell chk"><input type="checkbox" data-all aria-label="Select all"></div>` + cols.map((c) => `<div class="hcell" data-k="${c.k}" style="width:${cw(c)}px" title="Sort by ${esc(c.name)}">${esc(c.name)}${S.sort && S.sort.k === c.k ? `<span class="srt">${S.sort.d > 0 ? '▲' : '▼'}</span>` : ''}<span class="rz" data-rz="${c.k}"></span></div>`).join('');
  }
  el.hrow.addEventListener('click', (e) => {
    if (e.target.closest('[data-rz]') || e.target.closest('[data-all]')) return;
    const h = e.target.closest('.hcell[data-k]'); if (!h) return;
    const k = h.dataset.k; S.sort = S.sort && S.sort.k === k ? (S.sort.d > 0 ? { k, d: -1 } : null) : { k, d: 1 }; savePrefs(); run();
  });
  el.hrow.addEventListener('change', (e) => { if (e.target.matches('[data-all]')) { if (e.target.checked) S.rows.forEach((r) => S.sel.add(r._id)); else S.sel.clear(); renderRows(true); renderSel(); } });
  el.hrow.addEventListener('mousedown', (e) => {
    const rz = e.target.closest('[data-rz]'); if (!rz) return; e.preventDefault();
    const k = rz.dataset.rz, c = T().cols.find((x) => x.k === k), x0 = e.clientX, w0 = cw(c);
    const mv = (ev) => { prefs.w[k] = Math.max(50, w0 + ev.clientX - x0); renderHead(); renderRows(true); };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); savePrefs(); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });

  /* ---- filters (facets + date range) ---- */
  function computeFacets() {
    const t = T(); const out = [];
    for (const c of t.cols) {
      if (c.type === 'num' || c.type === 'link' || c.type === 'onion') continue;
      if (c.type === 'enum' || (opts.facets || []).includes(c.k) || (c.type === 'text' && !/name|victim|note|domain|url|link/i.test(c.k))) {
        const m = new Map(); let too = false;
        for (const r of t.rows) { const v = r[c.k]; if (v == null || v === '') continue; const s = String(v); m.set(s, (m.get(s) || 0) + 1); if (m.size > (c.type === 'enum' || (opts.facets || []).includes(c.k) ? 600 : 60)) { too = true; break; } }
        if (!too && m.size > 0 && (m.size > 1 || c.type === 'enum')) out.push({ c, vals: Array.from(m.entries()).sort((a, b) => b[1] - a[1]) });
      }
    }
    return out;
  }
  function renderFilters() {
    const dc = dateCol(); const f = S.facets;
    const span = dc && S.span ? ` title="${esc(dc.name)} in this table runs from ${S.span[0]} to ${S.span[1]}"` : '';
    el.filters.innerHTML = (dc ? `<label${span}>${esc(dc.name)} <input type="date" data-from value="${S.from}" class="${S.from ? 'active' : ''}"${span}> to <input type="date" data-to value="${S.to}" class="${S.to ? 'active' : ''}"${span}>${S.span ? `<small style="color:var(--ink-3)">(data: ${S.span[0]} to ${S.span[1]})</small>` : ''}</label>` : '')
      + f.map(({ c }) => { const m = (S.counts && S.counts.get(c.k)) || new Map(); const sel = S.facet[c.k]; let vals = Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); if (sel != null && !m.has(sel)) vals.unshift([sel, 0]); return `<select data-facet="${c.k}" aria-label="${esc(c.name)}" title="${esc(c.name)}" class="${sel ? 'active' : ''}"><option value="">${esc(c.name)}: any</option>${vals.map(([v, n]) => `<option value="${esc(v)}"${sel === v ? ' selected' : ''}>${esc(sel === v ? c.name + ': ' : '')}${esc(v.length > 40 ? v.slice(0, 40) + '…' : v)} (${fmtN(n)})</option>`).join('')}</select>`; }).join('')
      + `<button class="btn sm${Object.keys(S.facet).length || S.from || S.to || S.q ? '' : ' hide'}" data-clear>Clear all</button>`;
  }
  el.filters.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-facet]')) { if (t.value) S.facet[t.dataset.facet] = t.value; else delete S.facet[t.dataset.facet]; }
    else if (t.matches('[data-from]')) S.from = t.value; else if (t.matches('[data-to]')) S.to = t.value;
    run();
  });
  const clearAll = () => { S.facet = {}; S.from = S.to = ''; S.q = ''; el.q.value = ''; S.preset = null; run(); };
  el.sum.addEventListener('click', (e) => { if (e.target.closest('[data-clear2]')) clearAll(); });
  el.none.addEventListener('click', (e) => { if (e.target.closest('[data-clear3]')) clearAll(); });
  el.filters.addEventListener('click', (e) => { if (e.target.closest('[data-clear]')) { S.facet = {}; S.from = S.to = ''; S.q = ''; el.q.value = ''; S.preset = null; run(); } });
  function renderPresets() {
    const p = opts.presets || [];
    el.presets.innerHTML = p.map((x, i) => `<button data-p="${i}" class="${S.preset === i ? 'on' : ''}" title="${esc(x.tip || '')}">${esc(x.label)}</button>`).join('');
    el.presets.classList.toggle('hide', !p.length);
  }
  el.presets.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; const i = +b.dataset.p; S.preset = S.preset === i ? null : i; run(); });

  /* ---- search ---- */
  el.q.addEventListener('input', debounce(() => { S.q = el.q.value; run(); }, 110));
  el.q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { el.q.value = ''; S.q = ''; run(); } });
  el.qx.addEventListener('click', () => { el.q.value = ''; S.q = ''; run(); el.q.focus(); });

  /* ---- compute ---- */
  function run(keepScroll) {
    const t = T();
    if (S.ver !== t.ver || !S.facets) { S.facets = computeFacets(); S.ver = t.ver; const dcc = dateCol(); S.span = null; if (dcc) { let lo = '', hi = ''; for (const r of t.rows) { const d = dateOf(r[dcc.k]); if (!d) continue; if (!lo || d < lo) lo = d; if (d > hi) hi = d; } if (lo) S.span = [lo, hi]; } }
    S.toks = parseQuery(S.q, t.cols); el.qx.classList.toggle('hide', !S.q);
    const fk = Object.keys(S.facet); const dc = dateCol(); const fromMs = S.from ? msOf(S.from) : null, toMs = S.to ? msOf(S.to) + DAY : null;
    const preset = S.preset != null && opts.presets ? opts.presets[S.preset] : null;
    const out = []; const facetCols = S.facets.map((x) => x.c); const counts = new Map(facetCols.map((c) => [c.k, new Map()]));
    const dateOn = dc && (fromMs != null || toMs != null);
    for (const r of t.rows) {
      if (preset && !preset.filter(r)) continue;
      if (dateOn) { const ms = msOf(r[dc.k]); if (isNaN(ms) || (fromMs != null && ms < fromMs) || (toMs != null && ms >= toMs)) continue; }
      if (S.toks.length && !matchRow(r, S.toks, t.cols)) continue;
      let nf = 0, failK = null;
      for (const k of fk) if (String(r[k] == null ? '' : r[k]) !== S.facet[k]) { nf++; failK = k; if (nf > 1) break; }
      if (nf === 0) out.push(r);
      if (nf <= 1) for (const c of facetCols) { if (nf === 1 && failK !== c.k) continue; const v = r[c.k]; if (v == null || v === '') continue; const m = counts.get(c.k), s = String(v); m.set(s, (m.get(s) || 0) + 1); }
    }
    S.counts = counts;
    if (S.sort) {
      const { k, d } = S.sort; const c = t.cols.find((x) => x.k === k); const num = c && c.type === 'num';
      out.sort((a, b) => { let x = a[k], y = b[k]; if (num) { x = +x || 0; y = +y || 0; return (x - y) * d; } x = x == null ? '' : String(x); y = y == null ? '' : String(y); if (x === '' && y !== '') return 1; if (y === '' && x !== '') return -1; return x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true }) * d; });
    }
    S.rows = out; S.hl = highlighter(S.toks);
    renderHead(); renderPresets(); renderFilters();
    const active = [];
    if (preset) active.push(preset.label); if (S.q) active.push(`search "${S.q}"`);
    fk.forEach((k) => { const c = t.cols.find((x) => x.k === k); active.push(`${c ? c.name : k} = ${S.facet[k]}`); });
    if (dateOn) active.push(`${dc.name} ${S.from || '…'} to ${S.to || '…'}`);
    el.sum.innerHTML = `<b>${fmtN(out.length)}</b> of ${fmtN(t.rows.length)} rows${S.sel.size ? ` · ${fmtN(S.sel.size)} selected` : ''}${active.length ? ` <span style="color:var(--ink-3)">· filters: ${esc(active.join(' · '))}</span> <button class="btn sm" data-clear2 style="height:22px;padding:0 8px;font-size:11.5px;margin-left:4px">Clear all</button>` : ''}`;
    el.meta.textContent = opts.meta ? opts.meta(t) : '';
    el.none.classList.toggle('hide', out.length > 0);
    el.none.innerHTML = out.length ? '' : (active.length ? `<div style="font-size:15px;font-weight:600;color:var(--ink)">No rows match these filters</div><ul style="margin:4px 0 0;padding-left:18px;font-size:13px;text-align:left">${active.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>${dateOn && S.span ? `<div style="font-size:12.5px">${esc(dc.name)} in this table runs from ${S.span[0]} to ${S.span[1]}.</div>` : ''}<button class="btn accent sm" data-clear3 style="margin-top:6px">Clear all filters</button>` : `<div>This table is empty.</div>`);
    if (!keepScroll) el.body.scrollTop = 0;
    el.spacer.style.height = Math.max(1, out.length * RH) + 'px';
    el.spacer.style.width = (36 + visCols().reduce((a, c) => a + cw(c), 0)) + 'px';
    renderRows(true);
    renderSel();
    if (S.active && !t.byId.has(S.active) && !(t.derived && t.byId.get(S.active))) { S.active = null; renderDrawer(); }
    if (opts.onRun) opts.onRun(S);
  }
  self.run = run;

  /* ---- virtual rows ---- */
  const rendered = new Map();
  function cellHtml(r, c) {
    const v = r[c.k]; const h = S.hl; const ed = c.edit || (T().derived && c.src);
    const cls = `cell${c.type === 'num' ? ' num' : ''}${ed ? ' edit' : ''}${r._ed && r._ed[c.k] ? ' ed' : ''}`;
    let inner = '';
    if (v == null || v === '') inner = '';
    else if (c.type === 'enum') { const p = PILL(v); inner = `<span class="pill${p ? ' ' + p : ''}">${h(String(v))}</span>`; }
    else if (c.type === 'link' || c.type === 'onion') inner = renderLinks(v, c.type, h);
    else if (c.type === 'num') inner = `<span>${fmtN(v)}</span>`;
    else inner = `<span title="${esc(String(v).slice(0, 300))}">${h(String(v).replace(/\s+/g, ' '))}</span>`;
    return `<div class="${cls}" data-k="${c.k}" style="width:${cw(c)}px">${inner}</div>`;
  }
  function rowHtml(r, i) {
    const cls = `row${S.sel.has(r._id) ? ' sel' : ''}${S.active === r._id ? ' on' : ''}${r._src === 'added' ? ' added' : ''}${r._ed ? ' edited' : ''}`;
    return `<div class="${cls}" data-id="${esc(r._id)}" data-i="${i}" style="top:${i * RH}px"><div class="cell chk"><input type="checkbox" ${S.sel.has(r._id) ? 'checked' : ''} aria-label="Select row"></div>${visCols().map((c) => cellHtml(r, c)).join('')}</div>`;
  }
  function renderRows(force) {
    const top = el.body.scrollTop, h = el.body.clientHeight;
    const a = Math.max(0, Math.floor(top / RH) - 6), b = Math.min(S.rows.length, Math.ceil((top + h) / RH) + 6);
    if (force) { rendered.forEach((n) => n.remove()); rendered.clear(); }
    for (const [i, n] of rendered) if (i < a || i >= b) { n.remove(); rendered.delete(i); }
    let html = '';
    for (let i = a; i < b; i++) if (!rendered.has(i)) html += rowHtml(S.rows[i], i);
    if (html) { const tpl = document.createElement('template'); tpl.innerHTML = html; Array.from(tpl.content.children).forEach((n) => { rendered.set(+n.dataset.i, n); el.spacer.appendChild(n); }); }
  }
  function refreshRow(id) { for (const [i, n] of rendered) if (n.dataset.id === id) { const r = S.rows[i]; if (!r) continue; const tpl = document.createElement('template'); tpl.innerHTML = rowHtml(r, i); const nn = tpl.content.firstChild; n.replaceWith(nn); rendered.set(i, nn); } }
  el.body.addEventListener('scroll', () => { el.ghead.scrollLeft = el.body.scrollLeft; renderRows(false); });
  new ResizeObserver(() => renderRows(false)).observe(el.body);

  /* ---- row interaction ---- */
  el.body.addEventListener('click', (e) => {
    const cp = e.target.closest('[data-copy]'); if (cp) { copyText(cp.dataset.copy); e.stopPropagation(); return; }
    if (e.target.closest('a')) { e.stopPropagation(); return; }
    const row = e.target.closest('.row'); if (!row) return; const id = row.dataset.id;
    if (e.target.matches('input[type=checkbox]')) {
      if (e.shiftKey && S.lastSel != null) { const i = +row.dataset.i, j = S.lastSel; for (let k = Math.min(i, j); k <= Math.max(i, j); k++) S.sel.add(S.rows[k]._id); }
      else if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
      S.lastSel = +row.dataset.i; rendered.forEach((n) => { n.classList.toggle('sel', S.sel.has(n.dataset.id)); const cb = n.querySelector('.chk input'); if (cb) cb.checked = S.sel.has(n.dataset.id); }); renderSel(); return;
    }
    if (e.detail > 1) return; // part of a double-click: leave the cell in place for editing
    clearTimeout(clickT); clickT = setTimeout(() => { S.active = S.active === id ? null : id; rendered.forEach((n) => n.classList.toggle('on', n.dataset.id === S.active)); renderDrawer(); }, 230);
  });
  let clickT = 0;
  el.body.addEventListener('dblclick', (e) => { clearTimeout(clickT); const cell = e.target.closest('.cell.edit'); const row = e.target.closest('.row'); if (cell && row) startEdit(row.dataset.id, cell.dataset.k, cell); });
  function startEdit(id, k, cell) {
    const t = T(); const r = t.byId.get(id); const c = t.cols.find((x) => x.k === k); if (!r || !c) return;
    const cur = r[k] == null ? '' : String(r[k]);
    let inp;
    if (c.type === 'enum' && c.opts) { inp = document.createElement('select'); inp.innerHTML = `<option value=""></option>` + c.opts.concat(cur && !c.opts.includes(cur) ? [cur] : []).map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join(''); }
    else { inp = document.createElement('input'); inp.type = c.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(cur || todayISO()) ? 'date' : 'text'; inp.value = cur; }
    cell.innerHTML = ''; cell.appendChild(inp); inp.focus(); if (inp.select) inp.select();
    let done = false;
    const commit = (save) => { if (done) return; done = true; const v = inp.value; if (save && v !== cur) { if (opts.onEdit) opts.onEdit(id, k, v); else editCell(t.id, id, k, v); } refreshRow(id); if (S.active === id) renderDrawer(); };
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(true); else if (ev.key === 'Escape') commit(false); ev.stopPropagation(); });
    inp.addEventListener('blur', () => commit(true));
  }

  /* ---- selection bar ---- */
  function renderSel() {
    const n = S.sel.size; el.selbar.classList.toggle('hide', !n); if (!n) return;
    el.selbar.innerHTML = `<b>${fmtN(n)} selected</b><button class="btn sm" data-s="copy">${ico('copy')}Copy rows</button><button class="btn sm" data-s="csv">${ico('download')}Export selected</button>${opts.noDelete ? '' : `<button class="btn sm danger" data-s="del">${ico('trash')}Delete</button>`}${opts.selActions ? opts.selActions.map((a, i) => `<button class="btn sm" data-s="x${i}">${esc(a.label)}</button>`).join('') : ''}<span style="flex:1"></span><button class="ib" data-s="clear" aria-label="Clear selection">${ico('x')}</button>`;
  }
  el.selbar.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-s]'); if (!b) return; const a = b.dataset.s; const rows = S.rows.filter((r) => S.sel.has(r._id));
    if (a === 'clear') { S.sel.clear(); renderRows(true); renderSel(); }
    else if (a === 'copy') copyText(tsv(rows));
    else if (a === 'csv') download(fileName('selected', 'csv'), csvOf(visCols().map((c) => c.name), rows.map((r) => visCols().map((c) => r[c.k]))), 'text/csv');
    else if (a === 'del') { if (await confirmDlg('Delete rows', `Delete ${fmtN(rows.length)} row${rows.length === 1 ? '' : 's'} from ${T().title}? You can undo this.`)) { deleteRows(T().id, rows.map((r) => r._id)); S.sel.clear(); } }
    else if (a[0] === 'x') { opts.selActions[+a.slice(1)].run(rows); S.sel.clear(); run(true); }
  });
  const tsv = (rows) => [visCols().map((c) => c.name).join('\t')].concat(rows.map((r) => visCols().map((c) => String(r[c.k] == null ? '' : r[c.k]).replace(/[\t\n]+/g, ' ')).join('\t'))).join('\n');
  const fileName = (what, ext) => `${(opts.title || T().title).toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${what}_${todayISO()}.${ext}`;

  /* ---- drawer ---- */
  function renderDrawer() {
    const t = T(); const r = S.active ? t.byId.get(S.active) : null;
    el.drawer.classList.toggle('hide', !r); if (!r) return;
    const title = opts.rowTitle ? opts.rowTitle(r) : (r.victim || r.name || r.group || r[t.cols[0].k] || 'Row');
    const kv = t.cols.map((c) => { const v = r[c.k]; if (v == null || v === '') return ''; let body;
      if (c.type === 'link' || c.type === 'onion') body = splitLinks(v).map((u) => isUrl(u) ? (isOnion(u) ? `<div class="tor" data-copy="${esc(u)}" title="Copy"><span class="tag">TOR</span><span class="u" style="white-space:normal;word-break:break-all">${esc(u)}</span></div>` : `<a href="${esc(hrefOf(u))}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`) : esc(u)).join('<br>');
      else if (c.type === 'enum') { const p = PILL(v); body = `<span class="pill${p ? ' ' + p : ''}">${esc(v)}</span>`; }
      else body = esc(String(v));
      return `<div class="kv"><div class="k">${esc(c.name)}${r._ed && r._ed[c.k] ? ' <span class="pill warn" style="text-transform:none">edited</span>' : ''}<button class="ib" data-copy="${esc(String(v))}" title="Copy">${ico('copy')}</button></div><div class="v${c.type === 'onion' || c.type === 'link' ? ' mono' : ''}">${body}</div></div>`; }).join('');
    const rel = opts.related ? opts.related(r) : [];
    const relHtml = rel.map((sec) => `<h4>${esc(sec.title)}</h4><div class="rel">${sec.items.length ? sec.items.map((it, i) => `<button data-rel="${sec.id}:${i}">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('') : `<div class="empty-note" style="color:var(--ink-3);font-size:12.5px;padding:4px 6px">${esc(sec.empty || 'None')}</div>`}</div>`).join('');
    el.drawer.innerHTML = `<div class="dh"><h3>${esc(title)}</h3><button class="ib" data-dx aria-label="Close">${ico('x')}</button></div><div class="db">${kv}${relHtml}</div><div class="df">${opts.noLog ? '' : `<button class="btn sm accent" data-d="log">${ico('flag')}Log an update</button>`}<button class="btn sm" data-d="copy">${ico('copy')}Copy row</button>${opts.noDelete ? '' : `<button class="btn sm danger" data-d="del">${ico('trash')}Delete</button>`}</div>`;
    self._rel = rel;
  }
  el.drawer.addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-copy]'); if (cp) { copyText(cp.dataset.copy); return; }
    if (e.target.closest('[data-dx]')) { S.active = null; renderRows(true); renderDrawer(); return; }
    const rb = e.target.closest('[data-rel]'); if (rb) { const [sid, i] = rb.dataset.rel.split(':'); const sec = self._rel.find((s) => s.id === sid); if (sec) sec.items[+i].go(); return; }
    const b = e.target.closest('[data-d]'); if (!b) return; const r = T().byId.get(S.active); if (!r) return;
    if (b.dataset.d === 'copy') copyText(T().cols.filter((c) => r[c.k] != null && r[c.k] !== '').map((c) => c.name + ': ' + r[c.k]).join('\n'));
    else if (b.dataset.d === 'log') APP.logFrom(r, T());
    else if (b.dataset.d === 'del') { if (await confirmDlg('Delete row', `Delete this row from ${T().title}? You can undo this.`)) { deleteRows(T().id, [r._id]); S.active = null; } }
  });

  /* ---- toolbar ---- */
  host.querySelector('[data-undo]').addEventListener('click', undo);
  const addBtn = host.querySelector('[data-add]'); if (addBtn) addBtn.addEventListener('click', () => (opts.onAdd ? opts.onAdd() : addForm(T())));
  const impBtn = host.querySelector('[data-import]'); if (impBtn) impBtn.addEventListener('click', () => importInto(T()));
  host.querySelector('[data-cols]').addEventListener('click', (e) => {
    const t = T();
    menu(e.currentTarget, `<div class="h">Columns</div>` + t.cols.map((c) => `<label><input type="checkbox" data-c="${c.k}" ${S.hidden.has(c.k) ? '' : 'checked'}> ${esc(c.name)}</label>`).join('') + `<hr><button data-act="all">Show all</button><button data-act="reset">Reset to default</button>`, (act) => {
      if (act === 'all') S.hidden.clear(); if (act === 'reset') { S.hidden = new Set(t.cols.filter((c) => c.hide).map((c) => c.k)); prefs.w = {}; } savePrefs(); run(true);
    }).addEventListener('change', (ev) => { const c = ev.target.dataset.c; if (!c) return; if (ev.target.checked) S.hidden.delete(c); else S.hidden.add(c); savePrefs(); run(true); });
  });
  host.querySelector('[data-export]').addEventListener('click', (e) => {
    menu(e.currentTarget, `<div class="h">${esc(T().title)} · ${fmtN(S.rows.length)} rows shown</div><button data-act="xlsx">${ico('download')}Excel (.xlsx), shown rows</button><button data-act="xlsxall">${ico('download')}Excel, all rows and columns</button><button data-act="csv">${ico('download')}CSV, shown rows</button><button data-act="json">${ico('download')}JSON, shown rows</button><button data-act="tsv">${ico('copy')}Copy shown rows (paste into Excel)</button><hr><button data-act="wb">${ico('layers')}Whole database as one Excel workbook</button>`, async (act) => {
      const t = T(); const vc = visCols();
      if (act === 'csv') download(fileName('rows', 'csv'), csvOf(vc.map((c) => c.name), S.rows.map((r) => vc.map((c) => r[c.k]))), 'text/csv');
      else if (act === 'json') download(fileName('rows', 'json'), JSON.stringify(S.rows.map((r) => { const o = {}; vc.forEach((c) => { o[c.k] = r[c.k]; }); return o; }), null, 1), 'application/json');
      else if (act === 'tsv') copyText(tsv(S.rows));
      else if (act === 'xlsx') { busy('Building the workbook...'); try { await xlsxDownload(fileName('rows', 'xlsx'), [{ name: t.title, header: vc.map((c) => c.name), rows: S.rows.map((r) => vc.map((c) => r[c.k])) }]); } finally { busy(false); } }
      else if (act === 'xlsxall') { busy('Building the workbook...'); try { await xlsxDownload(fileName('all', 'xlsx'), [{ name: t.title, header: t.cols.map((c) => c.name), rows: t.rows.map((r) => t.cols.map((c) => r[c.k])) }]); } finally { busy(false); } }
      else if (act === 'wb') APP.exportAll();
    });
  });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !e.ctrlKey && !e.metaKey && host.closest('.host.active') && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); el.q.focus(); el.q.select(); } });

  /* react to data changes */
  onChange((tid) => { const t = T(); if (tid === t.id || (t.derived && ['victims', 'needles', 'groups'].includes(tid)) || (opts.watch || []).includes(tid)) { S.ver = -1; scheduleRun(); } });
  const scheduleRun = debounce(() => { if (host.closest('.host.active')) run(true); else self.dirty = true; }, 60);
  self.show = () => { if (self.dirty || S.ver !== T().ver) { self.dirty = false; run(true); } else renderRows(false); };
  self.setQuery = (q) => { el.q.value = q; S.q = q; run(); };
  self.setFilter = (facet, from, to, preset) => { S.facet = facet || {}; S.from = from || ''; S.to = to || ''; S.preset = preset == null ? null : preset; run(); };
  self.focus = (id) => { S.active = id; run(true); const i = S.rows.findIndex((r) => r._id === id); if (i >= 0) el.body.scrollTop = Math.max(0, i * RH - el.body.clientHeight / 2); renderRows(true); renderDrawer(); };
  self.state = S;
  run();
  return self;
}

/* ---- add form from the table's editable columns ---- */
function addForm(t, preset, after) {
  const cols = t.cols.filter((c) => c.edit || c.k === 'group' || c.k === 'victim');
  const body = `<div class="form">${cols.map((c) => `<label class="${/note|basis/i.test(c.k) ? 'full' : ''}">${esc(c.name)}${c.type === 'enum' && c.opts ? `<select name="${c.k}"><option value=""></option>${c.opts.map((o) => `<option${(preset || {})[c.k] === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>` : /note|basis/i.test(c.k) ? `<textarea name="${c.k}">${esc((preset || {})[c.k] || '')}</textarea>` : `<input name="${c.k}" type="${c.type === 'date' ? 'date' : 'text'}" value="${esc((preset || {})[c.k] || '')}" ${c.k === 'group' ? 'list="dl-groups"' : ''}>`}</label>`).join('')}</div>`;
  modal({ title: 'Add to ' + t.title, body, wide: true, foot: `<button class="btn" data-x>Cancel</button><button class="btn accent" data-ok>Add row</button>`, wire: (bg, close) => {
    bg.querySelector('[data-ok]').onclick = () => {
      const o = {}; cols.forEach((c) => { const f = bg.querySelector(`[name="${c.k}"]`); o[c.k] = f ? f.value.trim() : ''; });
      if (!Object.values(o).some(Boolean)) { toast('Fill in at least one field'); return; }
      const res = APP.addTo(t.id, [o]);
      if (res.added.length) { toast('Added to ' + t.title); close(); if (after) after(res.added[0]); } else toast('That row is already in the table');
    };
  } });
}

/* ---- import with column mapping ---- */
async function importInto(t) {
  const f = await pickFile(); if (!f) return;
  let sheets; try { busy('Reading ' + f.name + '...'); sheets = await readTable(f); } catch (e) { toast('Could not read the file: ' + e.message); return; } finally { busy(false); }
  if (!Array.isArray(sheets)) sheets = [sheets];
  sheets = sheets.filter((s) => s.header && s.header.length && s.rows && s.rows.length);
  if (!sheets.length) { toast('No rows found in that file'); return; }
  const target = t.cols.filter((c) => c.edit || c.imp || ['group', 'victim'].includes(c.k));
  const RULES = { victims: VRULES, needles: NRULES, groups: GRULES, mixed: VRULES }[t.id] || [];
  const ALIAS = { countryName: 'country', description: 'basis', url: 'leaksites' };
  const guess = (h, used) => {
    const hs = String(h || '').trim(), n = norm(hs); if (!n) return '';
    let best = target.find((c) => norm(c.name) === n || norm(c.k) === n);
    if (!best) { const rule = RULES.find(([k, re]) => re.test(hs) && target.some((c) => c.k === (ALIAS[k] || k))); if (rule) best = target.find((c) => c.k === (ALIAS[rule[0]] || rule[0])); }
    if (!best) best = target.find((c) => norm(c.name).includes(n) || n.includes(norm(c.name)));
    if (best && used && used.has(best.k)) return ''; if (best && used) used.add(best.k);
    return best ? best.k : '';
  };
  let si = 0;
  const render = () => { const used = new Set(); const G = sheets[si].header.map((h) => guess(h, used)); return `<label style="display:block;margin-bottom:10px;font-size:12.5px">Sheet <select data-sheet>${sheets.map((s, i) => `<option value="${i}"${i === si ? ' selected' : ''}>${esc(s.name)} (${fmtN(s.rows.length)} rows)</option>`).join('')}</select></label><table style="width:100%;border-collapse:collapse;font-size:12.5px"><tr><th style="text-align:left;padding:4px">Column in file</th><th style="text-align:left;padding:4px">Goes into</th><th style="text-align:left;padding:4px">Example</th></tr>${sheets[si].header.map((h, i) => `<tr><td style="padding:4px;border-top:1px solid var(--grid)">${esc(h || 'Column ' + (i + 1))}</td><td style="padding:4px;border-top:1px solid var(--grid)"><select data-m="${i}" style="max-width:220px"><option value="">(skip)</option>${target.map((c) => `<option value="${c.k}"${G[i] === c.k ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></td><td style="padding:4px;border-top:1px solid var(--grid);color:var(--ink-3);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((sheets[si].rows[0] || [])[i] || '')}</td></tr>`).join('')}</table>`; };
  modal({ title: 'Import into ' + t.title, wide: true, body: `<div data-body>${render()}</div><p style="font-size:12.5px;color:var(--ink-3)">Rows that already exist (same key) are skipped. Everything you import is marked as added and can be undone.</p>`, foot: `<button class="btn" data-x>Cancel</button><button class="btn accent" data-ok>Import</button>`, wire: (bg, close) => {
    bg.addEventListener('change', (e) => { if (e.target.matches('[data-sheet]')) { si = +e.target.value; bg.querySelector('[data-body]').innerHTML = render(); } });
    bg.querySelector('[data-ok]').onclick = () => {
      const map = {}; $$('[data-m]', bg).forEach((s) => { if (s.value) map[+s.dataset.m] = s.value; });
      if (!Object.keys(map).length) { toast('Map at least one column'); return; }
      const objs = sheets[si].rows.map((r) => { const o = {}; for (const i in map) o[map[i]] = r[+i] == null ? '' : String(r[+i]).trim(); return o; }).filter((o) => Object.values(o).some(Boolean));
      const res = APP.addTo(t.id, objs); toast(`Imported ${fmtN(res.added.length)} row${res.added.length === 1 ? '' : 's'}${res.dup ? `, skipped ${fmtN(res.dup)} already present` : ''}`); close();
    };
  } });
}
