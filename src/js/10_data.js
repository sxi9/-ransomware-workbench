/* ===== data: unpack, tables, deltas, joins ===== */
const DB = { raw: null, asOf: '', tables: {}, listeners: [] };
const PUBL = { Y: 'Yes', P: 'Partial', N: 'No', U: 'Unknown' }, TYPL = { N: 'Named', M: 'Masked', P: 'Placeholder' };
const PUBK = { Yes: 'Y', Partial: 'P', No: 'N', Unknown: 'U' }, TYPK = { Named: 'N', Masked: 'M', Placeholder: 'P' };
const RSTATUS = ['Yes', 'Update awaiting', 'Download link present', 'Download link not present', 'Victim removed', 'No update'];
const NSTATUS = ['Completed', 'Working on it', 'Need Help'];
const SITE = ['Up', 'Down', 'Seized', 'Telegram', 'Unknown'];
const JTYPES = ['New victim', 'Victim update', 'Data published', 'Victim removed', 'Needle published', 'Needle republished', 'New group', 'Leak site change', 'Takedown / seizure', 'Observation', 'Note'];
const JSTATUS = ['Open', 'In progress', 'Done', 'Watching'];
const PRIO = ['P0', 'P1', 'P2', 'P3', 'P4'];

async function unpack() {
  const el = $('#dbz'), bin = atob(el.textContent.trim()), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  el.textContent = '';
  if (window.DecompressionStream) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js');
  return JSON.parse(window.pako.ungzip(bytes, { to: 'string' }));
}

/* ---- table registry ----
 * table = { id, title, cols:[{k,name,type,w,edit,hide,opts,src}], rows:[obj], byId:Map, key(row) }
 * row = { _id, _src:'seed'|'added', _ed:{k:true}, ...fields }
 */
function defTable(id, title, cols, rows, keyFn) {
  const t = { id, title, cols, rows, byId: new Map(), key: keyFn || ((r) => r._id), ver: 0 };
  rows.forEach((r) => t.byId.set(r._id, r));
  DB.tables[id] = t; return t;
}
function col(k, name, type, w, o) { return Object.assign({ k, name, type: type || 'text', w: w || 140, edit: false, hide: false }, o || {}); }

/* ---- deltas (what you changed), persisted per table ---- */
function deltaKey(t) { return 'delta:' + t; }
function loadDelta(t) { return Object.assign({ added: [], edits: {}, deleted: [] }, store.get(deltaKey(t)) || {}); }
function saveDelta(t, d) { store.set(deltaKey(t), d); }
function applyDelta(table, d, mk) {
  const dead = new Set(d.deleted);
  if (dead.size) { table.rows = table.rows.filter((r) => !dead.has(r._id)); table.byId = new Map(table.rows.map((r) => [r._id, r])); }
  for (const o of d.added) { if (table.byId.has(o._id)) continue; const r = mk ? mk(o) : Object.assign({}, o); r._src = 'added'; table.rows.push(r); table.byId.set(r._id, r); }
  for (const id in d.edits) { const r = table.byId.get(id); if (!r) continue; r._ed = r._ed || {}; for (const k in d.edits[id]) { r[k] = d.edits[id][k]; r._ed[k] = true; } r._s = null; }
}
const UNDO = [];
function pushUndo(fn, label) { UNDO.push({ fn, label }); if (UNDO.length > 60) UNDO.shift(); updateUndo(); }
function updateUndo() { $$('[data-undo]').forEach((b) => { b.disabled = !UNDO.length; b.title = UNDO.length ? 'Undo: ' + UNDO[UNDO.length - 1].label : 'Nothing to undo'; }); }
function undo() { const u = UNDO.pop(); if (u) { u.fn(); toast('Undone: ' + u.label); } updateUndo(); }

/* generic mutators: every tab uses these so deltas, undo and listeners stay consistent */
function editCell(tid, id, k, val, opts) {
  const t = DB.tables[tid]; const r = t.byId.get(id); if (!r) return;
  const old = r[k] == null ? '' : r[k]; if (String(old) === String(val)) return;
  const d = loadDelta(tid); r[k] = val; r._ed = r._ed || {}; r._ed[k] = true; r._s = null;
  if (r._src === 'added') { const a = d.added.find((x) => x._id === id); if (a) a[k] = val; } else { d.edits[id] = d.edits[id] || {}; d.edits[id][k] = val; }
  saveDelta(tid, d); t.ver++;
  if (!(opts && opts.silent)) pushUndo(() => editCell(tid, id, k, old, { silent: true }), `${t.title}: ${k}`);
  emit(tid, { type: 'edit', id, k });
}
function addRows(tid, objs, opts) {
  const t = DB.tables[tid]; const d = loadDelta(tid); const out = [];
  const keys = new Set(t.rows.map((r) => t.key(r)));
  let dup = 0;
  for (const o of objs) {
    const r = Object.assign({ _id: o._id || (tid[0] + uid()), _src: 'added' }, o); r._id = r._id;
    const k = t.key(r); if (keys.has(k)) { dup++; continue; } keys.add(k);
    t.rows.push(r); t.byId.set(r._id, r); d.added.push(stripRow(r)); d.deleted = d.deleted.filter((x) => x !== r._id); out.push(r);
  }
  saveDelta(tid, d); t.ver++;
  if (out.length && !(opts && opts.silent)) pushUndo(() => deleteRows(tid, out.map((r) => r._id), { silent: true }), `add ${out.length} to ${t.title}`);
  emit(tid, { type: 'add', ids: out.map((r) => r._id) });
  return { added: out, dup };
}
function deleteRows(tid, ids, opts) {
  const t = DB.tables[tid]; const d = loadDelta(tid); const gone = [];
  for (const id of ids) {
    const r = t.byId.get(id); if (!r) continue; gone.push(r); t.byId.delete(id);
    if (r._src === 'added') d.added = d.added.filter((x) => x._id !== id); else d.deleted.push(id);
    delete d.edits[id];
  }
  const set = new Set(ids); t.rows = t.rows.filter((r) => !set.has(r._id));
  saveDelta(tid, d); t.ver++;
  if (gone.length && !(opts && opts.silent)) pushUndo(() => restoreRows(tid, gone), `delete ${gone.length} from ${t.title}`);
  emit(tid, { type: 'delete', ids });
  return gone.length;
}
function restoreRows(tid, rows) {
  const t = DB.tables[tid]; const d = loadDelta(tid);
  for (const r of rows) {
    if (t.byId.has(r._id)) continue; t.rows.push(r); t.byId.set(r._id, r);
    if (r._src === 'added') d.added.push(stripRow(r)); else { d.deleted = d.deleted.filter((x) => x !== r._id); if (r._ed) { d.edits[r._id] = {}; for (const k in r._ed) d.edits[r._id][k] = r[k]; } }
  }
  saveDelta(tid, d); t.ver++; emit(tid, { type: 'add', ids: rows.map((r) => r._id) });
}
function stripRow(r) { const o = {}; for (const k in r) if (k !== '_s' && k !== '_ed' && k !== '_src') o[k] = r[k]; return o; }
function emit(tid, ev) { DB.listeners.slice().forEach((fn) => { try { fn(tid, ev); } catch (e) { console.error(e); } }); }
function onChange(fn) { DB.listeners.push(fn); }

/* ---- groups helpers ---- */
const GKEY = new Map(); // normalised key -> group row
function groupKeyVariants(name) {
  const k = norm(name); const out = [k];
  for (const suf of ['ransomwaregroup', 'ransomware', 'ransom', 'group', 'gang', 'team']) if (k.endsWith(suf) && k.length - suf.length >= 3) { out.push(k.slice(0, -suf.length)); break; }
  return out;
}
function groupFor(name) { for (const k of groupKeyVariants(name)) { const g = GKEY.get(k); if (g) return g; } return null; }
function ensureGroup(name, extra) {
  let g = groupFor(name); if (g) return g;
  const r = Object.assign({ _id: 'g' + uid(), name: String(name).trim(), aliases: '', site: 'Unknown', onion: '', onions: '', leaksites: '', working: '', private: '', online: '', collector: '', analyst: '', kind: '', priority: '', added: todayISO(), source: 'Added in the workbench', tags: '', note: '', sheets: '', inledger: 'Yes' }, extra || {});
  addRows('groups', [r], { silent: true }); indexGroup(DB.tables.groups.byId.get(r._id)); return DB.tables.groups.byId.get(r._id);
}
function indexGroup(g) { for (const n of [g.name].concat(String(g.aliases || '').split(/,\s*/))) for (const k of groupKeyVariants(n)) if (k && !GKEY.has(k)) GKEY.set(k, g); }
const victimPart = (name) => { const m = /^(.{2,60}?)\s*:\s+(.+)$/.exec(String(name || '').trim()); return m ? { g: m[1].trim(), v: m[2].trim() } : { g: '', v: String(name || '').trim() }; };

/* ---- build everything from the packed database ---- */
function buildTables(raw) {
  DB.raw = raw; DB.asOf = raw.asOf; DB.countries = raw.countries || {};
  const GM = raw.groupsMeta;

  /* groups */
  const gcols = [
    col('name', 'Group', 'text', 170, { edit: true }), col('site', 'Site status', 'enum', 100, { edit: true, opts: SITE }),
    col('onion', 'Onion / leak site', 'onion', 300, { edit: true }), col('onions', 'More onion mirrors', 'onion', 220, { edit: true, hide: true }),
    col('victims', 'Victims', 'num', 80), col('last', 'Last post', 'date', 110), col('first', 'First seen', 'date', 110, { hide: true }), col('needles', 'Needles', 'num', 80),
    col('collector', 'Assigned collector', 'text', 150, { edit: true }), col('analyst', 'Analyst (master list)', 'text', 130, { edit: true }),
    col('kind', 'Type', 'text', 130, { edit: true }), col('priority', 'Priority', 'enum', 80, { edit: true, opts: PRIO }), col('online', 'Online? (assignments)', 'text', 140, { edit: true }),
    col('leaksites', 'All leak-site URLs', 'onion', 260, { edit: true, hide: true }), col('working', 'Working link', 'onion', 220, { edit: true, hide: true }), col('private', 'Private negotiation page', 'onion', 220, { edit: true, hide: true }),
    col('aliases', 'Aliases', 'text', 180, { edit: true, hide: true }), col('added', 'Date added', 'date', 110, { edit: true, hide: true }), col('source', 'Found via', 'text', 140, { edit: true, hide: true }),
    col('tags', 'Needle tags', 'text', 120, { edit: true, hide: true }), col('note', 'Notes', 'text', 260, { edit: true }), col('sheets', 'Assignment sheets', 'text', 200, { hide: true }), col('inledger', 'In ledger', 'enum', 90, { hide: true, opts: ['Yes', 'No'] })
  ];
  const grows = raw.groups.map((g, i) => Object.assign({ _id: 'g' + i, _src: 'seed', victims: 0, last: '', first: '', needles: 0 }, g));
  const groups = defTable('groups', 'Groups', gcols, grows, (r) => norm(r.name));
  applyDelta(groups, loadDelta('groups'));
  groups.rows.forEach(indexGroup);
  const gById = (i) => groups.byId.get('g' + i);

  /* victims */
  const vcols = [
    col('group', 'Group', 'text', 150, { edit: true }), col('victim', 'Victim', 'text', 280, { edit: true }), col('created', 'Discovered', 'date', 128, { edit: true }),
    col('pub', 'Data published', 'enum', 118, { edit: true, opts: ['Yes', 'Partial', 'No', 'Unknown'] }), col('cc', 'Country', 'text', 80, { edit: true }), col('country', 'Country name', 'text', 140, { hide: true }),
    col('sector', 'Sector', 'text', 150, { edit: true }), col('domain', 'Domain', 'text', 170, { edit: true }), col('attack', 'Attack (est.)', 'date', 110, { edit: true }),
    col('type', 'Entry type', 'enum', 100, { edit: true, opts: ['Named', 'Masked', 'Placeholder'] }), col('size', 'Data size', 'text', 100, { edit: true }),
    col('onion', 'Group onion site', 'onion', 260), col('claim', 'Leak-site claim URL', 'onion', 240, { edit: true }), col('rlurl', 'ransomware.live', 'link', 130),
    col('press', 'Press / notices', 'link', 160, { edit: true }), col('basis', 'Basis (listing text)', 'text', 200, { edit: true, hide: true }),
    col('collector', 'Assigned collector', 'text', 130, { hide: true }), col('sitestat', 'Group site status', 'enum', 110, { hide: true, opts: SITE }),
    col('added', 'Added to sheet', 'date', 130, { hide: true }), col('notes', 'Notes', 'text', 220, { edit: true })
  ];
  const V = raw.victims, VC = raw.victimCols; const ci = {}; VC.forEach((k, i) => { ci[k] = i; });
  const vrows = new Array(V.length);
  for (let i = 0; i < V.length; i++) {
    const a = V[i]; const gm = GM[a[ci.gi]]; const g = gById(a[ci.gi]);
    vrows[i] = { _id: 'v' + i, _src: 'seed', _gi: a[ci.gi], group: g ? g.name : gm.name, victim: a[ci.victim], domain: a[ci.domain], cc: a[ci.cc], country: DB.countries[a[ci.cc]] || '', sector: a[ci.sector], created: a[ci.created].replace('T', ' '), attack: a[ci.attack], pub: PUBL[a[ci.pub]] || 'Unknown', basis: a[ci.basis], type: TYPL[a[ci.type]] || 'Named', size: a[ci.size], claim: a[ci.claim], rl: a[ci.rl], rlurl: '', press: a[ci.press], added: a[ci.added].replace('T', ' '), onion: '', collector: '', sitestat: '', notes: '' };
  }
  const victims = defTable('victims', 'Victims', vcols, vrows, (r) => norm(r.group) + '|' + String(r.victim || '').trim().toLowerCase() + '|' + dateOf(r.created));
  applyDelta(victims, loadDelta('victims'));
  const b64 = (s) => { try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return ''; } };
  for (const r of victims.rows) {
    const g = groupFor(r.group) || ensureGroup(r.group);
    r.group = g.name; r.onion = g.onion || ''; r.collector = g.collector || ''; r.sitestat = g.site || '';
    if (!r.rlurl) { const slug = r._gi != null && GM[r._gi] ? GM[r._gi].slug : norm(g.name); const id = r.rl || b64(r.victim + '@' + slug); r.rlurl = id ? 'https://www.ransomware.live/id/' + id : ''; }
    if (!r.country && r.cc) r.country = DB.countries[r.cc] || '';
  }

  /* needles */
  const ncols = [
    col('name', 'Needle', 'text', 320, { edit: true }), col('sheet', 'Sheet', 'enum', 150, { edit: true }), col('analyst', 'Analyst', 'text', 100, { edit: true }), col('quarter', 'Quarter', 'text', 90, { edit: true }),
    col('actor', 'Threat actor', 'text', 140, { edit: true }), col('status', 'Status', 'enum', 110, { edit: true, opts: NSTATUS }), col('rstatus', 'Republish status', 'enum', 170, { edit: true, opts: RSTATUS }),
    col('pdate', 'Published', 'date', 110, { edit: true }), col('rdate', 'Republished', 'date', 120, { edit: true }), col('wagtail', 'Wagtail', 'link', 100, { edit: true }), col('intel', 'Live page', 'link', 100, { edit: true }),
    col('updby', 'Updated by', 'text', 140, { edit: true }), col('notes', 'Notes', 'text', 220, { edit: true }), col('extra', 'Extra column', 'text', 160, { edit: true, hide: true }),
    col('victim', 'Victim (from name)', 'text', 220, { hide: true }), col('match', 'Ledger match', 'enum', 110, { opts: ['Exact', 'Close', 'None'] }), col('onion', 'Group onion site', 'onion', 240, { hide: true }), col('srow', 'Sheet row', 'num', 80, { hide: true })
  ];
  const N = raw.needles, NC = raw.needleCols; const ni = {}; NC.forEach((k, i) => { ni[k] = i; });
  const nrows = new Array(N.length);
  for (let i = 0; i < N.length; i++) {
    const a = N[i]; const g = a[ni.gi] >= 0 ? gById(a[ni.gi]) : null;
    nrows[i] = { _id: 'n' + i, _src: 'seed', _vi: a[ni.vi], _gi: a[ni.gi], sheet: a[ni.sheet], name: a[ni.name], analyst: a[ni.analyst], quarter: a[ni.quarter], actor: a[ni.actor], wagtail: a[ni.wagtail], intel: a[ni.intel], status: a[ni.status], rstatus: a[ni.rstatus], pdate: a[ni.pdate], rdate: a[ni.rdate], updby: a[ni.updby], notes: a[ni.notes], extra: a[ni.extra], srow: a[ni.srow], victim: a[ni.vpart], score: a[ni.score], match: a[ni.vi] >= 0 ? (a[ni.score] >= 0.98 ? 'Exact' : 'Close') : 'None', onion: g ? g.onion : '' };
  }
  const needles = defTable('needles', 'Needles', ncols, nrows, (r) => norm(r.sheet) + '|' + String(r.name || '').trim().toLowerCase() + '|' + dateOf(r.pdate));
  applyDelta(needles, loadDelta('needles'));
  needles.cols.find((c) => c.k === 'sheet').opts = Array.from(new Set(needles.rows.map((r) => r.sheet))).filter(Boolean);

  /* raw sheets: one table per sheet */
  DB.sheets = raw.sheets.map((s, si) => {
    const cols = s.header.map((h, i) => col('c' + i, h, /date|published|updated/i.test(h) ? 'date' : /link|url|page|source|domain|site$/i.test(h) ? 'onion' : 'text', /link|url|page/i.test(h) ? 220 : /name|notes|observation|inference|reason/i.test(h) ? 240 : 130, { edit: true }));
    const rows = s.rows.map((r, ri) => { const o = { _id: 's' + si + '_' + ri, _src: 'seed', _row: ri + 2 }; r.forEach((v, i) => { o['c' + i] = v; }); return o; });
    const t = defTable('sheet' + si, s.name, cols, rows, (r) => r._id); t.wb = s.wb;
    applyDelta(t, loadDelta('sheet' + si));
    return t;
  });

  /* investigator journal: only what you add */
  const jcols = [
    col('date', 'Date', 'date', 108, { edit: true }), col('time', 'Time', 'text', 70, { edit: true }), col('type', 'Update type', 'enum', 150, { edit: true, opts: JTYPES }),
    col('group', 'Group', 'text', 140, { edit: true }), col('victim', 'Victim', 'text', 220, { edit: true }), col('status', 'Status', 'enum', 100, { edit: true, opts: JSTATUS }), col('priority', 'Priority', 'enum', 80, { edit: true, opts: PRIO }),
    col('analyst', 'Analyst', 'text', 110, { edit: true }), col('onion', 'Onion / leak URL', 'onion', 240, { edit: true }), col('needle', 'Needle / Wagtail link', 'link', 150, { edit: true }), col('link', 'Other link', 'link', 150, { edit: true }),
    col('country', 'Country', 'text', 80, { edit: true }), col('sector', 'Sector', 'text', 130, { edit: true }), col('tags', 'Tags', 'text', 130, { edit: true }), col('notes', 'Notes', 'text', 320, { edit: true }), col('created', 'Logged at', 'date', 130)
  ];
  const journal = defTable('journal', 'Investigator log', jcols, [], (r) => r._id);
  applyDelta(journal, loadDelta('journal'));

  recount();
  buildMixed();
}

/* counts on groups: victims, last post, needles */
function recount() {
  const groups = DB.tables.groups, victims = DB.tables.victims, needles = DB.tables.needles;
  for (const g of groups.rows) { g.victims = 0; g.needles = 0; g.last = ''; g.first = ''; g._s = null; }
  for (const r of victims.rows) { const g = groupFor(r.group); if (!g) continue; g.victims++; const d = dateOf(r.created); if (d && r.type !== 'Placeholder') { if (d > g.last) g.last = d; if (!g.first || d < g.first) g.first = d; } }
  for (const r of needles.rows) { const g = (r._gi >= 0 && groups.byId.get('g' + r._gi)) || groupFor(r.actor) || groupFor(victimPart(r.name).g); if (g) { g.needles++; r._g = g; } }
  groups.ver++;
}

/* ---- mixed database: victims joined with Needles and group leak sites ---- */
function buildMixed() {
  const victims = DB.tables.victims, needles = DB.tables.needles, groups = DB.tables.groups;
  const byV = new Map();
  const vIndex = new Map(); // norm(group)|norm(victim) -> victim row (for needles added later)
  for (const r of victims.rows) vIndex.set(norm(r.group) + '|' + norm(r.victim), r);
  for (const n of needles.rows) {
    let v = n._vi >= 0 ? victims.byId.get('v' + n._vi) : null;
    if (!v && n._src === 'added' && n.victim) { const g = n._g || groupFor(n.actor); if (g) v = vIndex.get(norm(g.name) + '|' + norm(n.victim)) || null; if (v) { n.match = 'Exact'; } }
    n._v = v;
    if (v) { const cur = byV.get(v._id); if (!cur || (n.pdate || '') > (cur.pdate || '')) byV.set(v._id, n); }
  }
  const cols = [
    col('group', 'Group', 'text', 150, { src: 'v' }), col('victim', 'Victim', 'text', 280, { src: 'v' }), col('match', 'Match', 'enum', 110, { opts: ['Exact', 'Close', 'Ledger only', 'Needle only'] }),
    col('created', 'Discovered', 'date', 128, { src: 'v' }), col('pub', 'Data published', 'enum', 118, { src: 'v', opts: ['Yes', 'Partial', 'No', 'Unknown'] }), col('rstatus', 'Republish status', 'enum', 170, { src: 'n', opts: RSTATUS }),
    col('nanalyst', 'Needle analyst', 'text', 110, { src: 'n', sk: 'analyst' }), col('quarter', 'Quarter', 'text', 90, { src: 'n' }), col('pdate', 'Needle published', 'date', 120, { src: 'n' }), col('rdate', 'Needle republished', 'date', 130, { src: 'n' }),
    col('nstatus', 'Needle status', 'enum', 110, { src: 'n', sk: 'status', opts: NSTATUS }), col('wagtail', 'Wagtail', 'link', 100, { src: 'n' }), col('intel', 'Live page', 'link', 100, { src: 'n' }),
    col('onion', 'Group onion site', 'onion', 260, { src: 'g' }), col('claim', 'Leak-site claim URL', 'onion', 240, { src: 'v' }), col('rlurl', 'ransomware.live', 'link', 130, { src: 'v' }), col('press', 'Press', 'link', 140, { src: 'v' }),
    col('cc', 'Country', 'text', 80, { src: 'v' }), col('sector', 'Sector', 'text', 150, { src: 'v' }), col('domain', 'Domain', 'text', 170, { src: 'v' }), col('attack', 'Attack (est.)', 'date', 110, { src: 'v', hide: true }),
    col('type', 'Entry type', 'enum', 100, { src: 'v', opts: ['Named', 'Masked', 'Placeholder'], hide: true }), col('size', 'Data size', 'text', 100, { src: 'v', hide: true }),
    col('sitestat', 'Group site status', 'enum', 110, { src: 'g', sk: 'site', opts: SITE }), col('collector', 'Assigned collector', 'text', 130, { src: 'g' }), col('ganalyst', 'Group analyst', 'text', 120, { src: 'g', sk: 'analyst', hide: true }), col('priority', 'Priority', 'enum', 80, { src: 'g', opts: PRIO, hide: true }),
    col('nname', 'Needle name', 'text', 300, { src: 'n', sk: 'name', hide: true }), col('sheet', 'Needle sheet', 'text', 150, { src: 'n', hide: true }), col('updby', 'Needle updated by', 'text', 140, { src: 'n', hide: true }), col('nnotes', 'Needle notes', 'text', 200, { src: 'n', sk: 'notes', hide: true }),
    col('vnotes', 'Victim notes', 'text', 200, { src: 'v', sk: 'notes' }), col('gnote', 'Group notes', 'text', 200, { src: 'g', sk: 'note', hide: true })
  ];
  cols.forEach((c) => { if (c.src) c.edit = true; });
  const rows = [];
  const fillG = (o, g) => { if (!g) return; o.onion = g.onion; o.sitestat = g.site; o.collector = g.collector; o.ganalyst = g.analyst; o.priority = g.priority; o.gnote = g.note; o._g = g; };
  const fillN = (o, n) => { if (!n) return; o.rstatus = n.rstatus; o.nanalyst = n.analyst; o.quarter = n.quarter; o.pdate = n.pdate; o.rdate = n.rdate; o.nstatus = n.status; o.wagtail = n.wagtail; o.intel = n.intel; o.nname = n.name; o.sheet = n.sheet; o.updby = n.updby; o.nnotes = n.notes; o._n = n; };
  for (const v of victims.rows) {
    const n = byV.get(v._id);
    const o = { _id: 'm' + v._id, _v: v, group: v.group, victim: v.victim, created: v.created, pub: v.pub, claim: v.claim, rlurl: v.rlurl, press: v.press, cc: v.cc, sector: v.sector, domain: v.domain, attack: v.attack, type: v.type, size: v.size, vnotes: v.notes, match: n ? (n.match === 'Exact' ? 'Exact' : 'Close') : 'Ledger only' };
    fillG(o, groupFor(v.group)); fillN(o, n); rows.push(o);
  }
  for (const n of needles.rows) {
    if (n._v) continue;
    const g = n._g; if (!g && !n.victim) continue; // CVEs, profiles and reports stay in the Needles tab
    const o = { _id: 'm' + n._id, group: g ? g.name : (n.actor || victimPart(n.name).g), victim: n.victim || n.name, match: 'Needle only', created: n.pdate };
    fillG(o, g); fillN(o, n); rows.push(o);
  }
  const t = defTable('mixed', 'Mixed database', cols, rows, (r) => r._id);
  t.derived = true; t.ver++;
  return t;
}
/* an edit in the mixed table writes through to the source table */
function editMixed(id, k, val) {
  const t = DB.tables.mixed, r = t.byId.get(id); if (!r) return;
  const c = t.cols.find((x) => x.k === k); const sk = c.sk || k;
  if (c.src === 'v') { if (!r._v) { toast('This row has no ledger victim yet. Add it from the Victims tab first.'); return; } editCell('victims', r._v._id, sk, val); }
  else if (c.src === 'n') { if (!r._n) { toast('No Needle is linked to this victim. Log one in the Needles tab.'); return; } editCell('needles', r._n._id, sk, val); }
  else if (c.src === 'g') { if (!r._g) { toast('Unknown group'); return; } editCell('groups', r._g._id, sk, val); }
}
