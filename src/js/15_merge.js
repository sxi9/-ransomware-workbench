/* ===== merge: build the packed-database shape in the browser from CSV / Excel files =====
 * Used by the standalone page (no embedded data) and by "Load data" in both pages.
 * Recognises: the ransomware ledger export (Group, Victim, Discovered...), this app's own Victims /
 * Needles / Groups / Investigator exports, every Needles tracker sheet, and every assignments sheet.
 */
const IDB = {
  open() { return new Promise((ok, no) => { const r = indexedDB.open('samurai-scan', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); },
  async get(k) { try { const db = await this.open(); return await new Promise((ok, no) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result == null ? null : r.result); r.onerror = () => no(r.error); }); } catch (e) { return null; } },
  async set(k, v) { const db = await this.open(); return new Promise((ok, no) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = ok; tx.onerror = () => no(tx.error); }); },
  async del(k) { try { const db = await this.open(); return await new Promise((ok) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = ok; tx.onerror = ok; }); } catch (e) { /* none */ } }
};
const hash36 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const normG = (s) => { const k = norm(s); for (const suf of ['ransomwaregroup', 'ransomware', 'ransom', 'group', 'gang', 'team', 'leaks', 'leak']) if (k.endsWith(suf) && k.length - suf.length >= 3) return k.slice(0, -suf.length); return k; };
const dateClean = (v) => { v = String(v == null ? '' : v).trim(); let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(v); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}` + (m[4] ? ` ${pad(m[4])}:${m[5]}` : ''); m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(v); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[1])}-${pad(m[2])}` + (m[4] ? ` ${pad(m[4])}:${m[5]}` : ''); return v; };
const ONION_RX = /[a-z2-7]{16,56}\.onion/gi;
const hostOf = (u) => { const m = /^(?:[a-z]+:\/+)?([^/\s]+)/i.exec(String(u || '').trim()); return m ? m[1].toLowerCase() : ''; };
const splitUrls = (t) => String(t || '').split(/[\s,]+/).map((s) => s.trim().replace(/^["']|["']$/g, '')).filter((s) => s && (s.includes('.') || s.includes('/')));
const dice = (a, b) => { if (a === b) return 1; if (a.length < 2 || b.length < 2) return 0; const m = new Map(); for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } let hit = 0; for (let i = 0; i < b.length - 1; i++) { const g = b.slice(i, i + 2); const n = m.get(g); if (n) { hit++; m.set(g, n - 1); } } return (2 * hit) / (a.length + b.length - 2); };

/* what kind of sheet is this? */
function classifySheet(header) {
  const H = new Set(header.map(norm));
  const has = (...ks) => ks.some((k) => H.has(k));
  if (has('match') && has('needleanalyst')) return 'mixed';
  if (has('updatetype') && has('date')) return 'journal';
  if (has('group') && has('onionleaksite', 'sitestatus', 'moreonionmirrors')) return 'groups';
  if (has('victim', 'victimname', 'company') && has('group', 'discovered', 'discoveredtracker', 'datapublished', 'threatactor')) return 'victims';
  if (has('name', 'needle', 'title') && has('analyst', 'publisher') && has('wagtaillink', 'wagtail', 'intellivelink', 'platformlink', 'advancedarkweblink', 'livepage')) return 'needles';
  if (has('leaksite', 'leaksites', 'sourceurls', 'publicpage', 'siteurl', 'privatenegotiationpage', 'privatenegotiationlink', 'workinglink') || (header[0] === '' && has('sourceurls'))) return 'assign';
  return 'raw';
}
const findCol = (header, rules) => { const out = {}; const used = new Set(); for (const [k, re] of rules) { const i = header.findIndex((h, idx) => !used.has(idx) && re.test(String(h).trim())); if (i >= 0) { out[k] = i; used.add(i); } } return out; };

const VRULES = [['victim', /^victim( name)?$|^company$|^organi[sz]ation$/i], ['group', /^group$|^threat ?actor$|^actor$|^ransomware group$/i], ['created', /^discovered|^created|^date discovered|^post(ed)? date|^first seen/i], ['pub', /^data ?published\??$|^published\??$|^leak published/i], ['cc', /^country( code)?$|^cc$/i], ['countryName', /^country name$/i], ['sector', /^sector$|^industry$|^activity$/i], ['domain', /^domain|^website|^url$/i], ['attack', /^attack/i], ['type', /^entry ?type$|^type$/i], ['size', /size/i], ['claim', /claim|^leak-? ?site (claim )?url|^post url|^screenshot/i], ['rlurl', /ransomware\.?live/i], ['press', /^press|notice/i], ['basis', /^basis/i], ['added', /^added/i], ['notes', /^notes?$/i], ['description', /^description$/i]];
const NRULES = [['name', /^(name|needle|title)$/i], ['analyst', /^(analyst|publisher|needle analyst)$/i], ['quarter', /^quarter$/i], ['actor', /^(threat ?actor|source ?name|affected ?vendor|group|actor)$/i], ['wagtail', /wagtail/i], ['intel', /^(intel live link|platform link|advance dark web link|live page|live link)$/i], ['status', /^(status|needle status)$/i], ['rstatus', /^(republish status|updated)$/i], ['pdate', /^(published( date| data)?|needle published)$/i], ['rdate', /^(re ?-? ?published( date)?|republish date|updated date|needle republished|republished)$/i], ['updby', /updated by/i], ['notes', /^notes?$/i], ['sheet', /^sheet$/i], ['extra', /^extra/i], ['victim', /^victim/i]];
const ARULES = [['name', /^(leak ?site|site name|name|leaksite|channel name|source name)$/i], ['url', /^(leak ?sites?(\(s\))?|site url|source urls?|public page|site domain|source link|channel link)$/i], ['working', /working link/i], ['private', /private negotiation/i], ['online', /^online|leak site status/i], ['collector', /collector|assigned/i], ['analyst', /^analyst$/i], ['kind', /ransomware\s*\//i], ['notes', /^(notes?|remarks|reason\/comment)$/i], ['added', /date added/i], ['source', /^source$/i], ['tags', /needle tags/i]];
const GRULES = [['name', /^group$|^name$/i], ['site', /^site status$/i], ['onion', /^onion/i], ['onions', /mirrors/i], ['collector', /collector/i], ['analyst', /^analyst/i], ['kind', /^type$/i], ['priority', /^priority$/i], ['online', /^online/i], ['leaksites', /all leak-site urls/i], ['working', /working link/i], ['private', /private negotiation/i], ['aliases', /^aliases$/i], ['added', /date added/i], ['source', /found via|^source$/i], ['tags', /tags/i], ['note', /^notes?$/i]];
const PUBV = (v) => { v = String(v || '').trim().toLowerCase(); return v.startsWith('y') ? 'Y' : v.startsWith('p') ? 'P' : v.startsWith('n') ? 'N' : 'U'; };
const TYPV = (v) => { v = String(v || '').trim().toLowerCase(); return v.startsWith('m') ? 'M' : v.startsWith('p') ? 'P' : 'N'; };

/* ---- merge base (embedded, may be null) + user files -> raw database shape ---- */
function mergeAll(base, files) {
  const VC = ['gi', 'victim', 'domain', 'cc', 'sector', 'created', 'attack', 'pub', 'basis', 'type', 'size', 'claim', 'rl', 'press', 'added', 'id', 'rlurl', 'notes'];
  const NC = ['sheet', 'name', 'analyst', 'quarter', 'actor', 'wagtail', 'intel', 'status', 'rstatus', 'pdate', 'rdate', 'updby', 'notes', 'extra', 'srow', 'gi', 'vpart', 'vi', 'score', 'id'];
  const raw = { asOf: base ? base.asOf : '', built: base ? base.built : 'from your files', countries: (base && base.countries) || {}, groupsMeta: [], victimCols: VC, victims: [], needleCols: NC, needles: [], groups: [], sheets: [], journal: [], sources: [] };
  const gkey = new Map(); // norm key -> gi
  const addGroup = (name, extra) => {
    const nm = String(name || 'Unknown').trim() || 'Unknown';
    for (const k of [norm(nm), normG(nm)]) if (gkey.has(k)) return gkey.get(k);
    const gi = raw.groups.length;
    raw.groupsMeta.push({ id: norm(nm), name: nm, slug: norm(nm), keys: [norm(nm)] });
    raw.groups.push(Object.assign({ id: 'x_' + norm(nm), name: nm, aliases: '', site: 'Unknown', onion: '', onions: '', leaksites: '', working: '', private: '', online: '', collector: '', analyst: '', kind: '', priority: '', added: '', source: '', tags: '', note: '', sheets: '', inledger: 'Yes' }, extra || {}));
    gkey.set(norm(nm), gi); if (normG(nm) && !gkey.has(normG(nm))) gkey.set(normG(nm), gi);
    // "Qilin / Agenda", "APT73(BASHE)", "Hunters International, Hunters": every part is an alias
    for (const part of nm.split(/\s*[\/,|]\s*|\s*[()]\s*/)) for (const k of [norm(part), normG(part)]) if (k && k.length >= 3 && !gkey.has(k)) gkey.set(k, gi);
    return gi;
  };
  const findGroup = (name) => { if (!name) return -1; for (const k of [norm(name), normG(name)]) if (gkey.has(k)) return gkey.get(k); const m = /^([^(]+)\(([^)]+)\)/.exec(name); if (m) { for (const p of [m[2], m[1]]) { const r = findGroup(p.trim()); if (r >= 0) return r; } } return -1; };
  if (base) {
    base.groups.forEach((G, gi) => {
      const g = base.groupsMeta[gi] || { id: G.id, name: G.name, slug: norm(G.name), keys: [norm(G.name)].concat(String(G.aliases || '').split(/,\s*/).map(norm)).filter(Boolean) };
      raw.groupsMeta.push(g); raw.groups.push(G);
      for (const k of g.keys) { if (!gkey.has(k)) gkey.set(k, gi); const s = normG(k); if (s && !gkey.has(s)) gkey.set(s, gi); }
      for (const part of G.name.split(/\s*[\/,|]\s*|\s*[()]\s*/)) for (const k of [norm(part), normG(part)]) if (k && k.length >= 3 && !gkey.has(k)) gkey.set(k, gi);
    });
    const bvc = base.victimCols; base.victims.forEach((a) => { const o = {}; bvc.forEach((k, i) => { o[k] = a[i]; }); raw.victims.push(VC.map((k) => (o[k] == null ? '' : o[k]))); });
    const bnc = base.needleCols; base.needles.forEach((a) => { const o = {}; bnc.forEach((k, i) => { o[k] = a[i]; }); raw.needles.push(NC.map((k) => (o[k] == null ? (k === 'gi' || k === 'vi' ? -1 : k === 'score' ? 0 : '') : o[k]))); });
    raw.sheets = base.sheets.slice();
  }
  const baseVictims = raw.victims.length, baseGroups = raw.groups.length;
  const vkeys = new Set(raw.victims.map((a) => a[0] + '|' + norm(a[1]) + '|' + dateOf(a[5])));
  const nkeys = new Set(raw.needles.map((a) => norm(a[0]) + '|' + norm(a[1]) + '|' + dateOf(a[9])));
  const assign = new Map(); // gi -> {field: [values]}
  const arec = (gi) => { if (!assign.has(gi)) assign.set(gi, {}); return assign.get(gi); };
  const aadd = (gi, f, v) => { v = String(v || '').trim(); if (!v) return; const r = arec(gi); r[f] = r[f] || []; if (!r[f].includes(v)) r[f].push(v); };
  const pendingNeedles = [];
  const stats = { files: [], victims: 0, needles: 0, groups: 0, sheets: 0, journal: 0, dupVictims: 0, dupNeedles: 0, skipped: [] };

  for (const f of files) {
    const fs = { name: f.name, kinds: [] };
    for (const s of f.sheets) {
      if (!s.header || !s.rows || !s.rows.length) continue;
      const kind = classifySheet(s.header); fs.kinds.push(`${s.name}: ${kind}`);
      const header = s.header.map((h) => String(h || '').trim());
      if (kind === 'mixed') { stats.skipped.push(`${f.name} › ${s.name} (mixed view, derived)`); continue; }
      if (kind === 'victims') {
        const c = findCol(header, VRULES); const g = (r, k) => (c[k] != null ? String(r[c[k]] == null ? '' : r[c[k]]).trim() : '');
        for (const r of s.rows) {
          const victim = g(r, 'victim'); if (!victim) continue;
          const gi = addGroup(g(r, 'group') || 'Unknown');
          const created = dateClean(g(r, 'created')) || todayISO();
          const key = gi + '|' + norm(victim) + '|' + dateOf(created); if (vkeys.has(key)) { stats.dupVictims++; continue; } vkeys.add(key);
          const id = 'vf' + hash36(key);
          raw.victims.push([gi, victim, g(r, 'domain'), g(r, 'cc').toUpperCase().slice(0, 3), g(r, 'sector'), created, dateClean(g(r, 'attack')), PUBV(g(r, 'pub')), g(r, 'basis') || g(r, 'description'), TYPV(g(r, 'type')), g(r, 'size'), g(r, 'claim'), '', g(r, 'press'), dateClean(g(r, 'added')), id, g(r, 'rlurl'), g(r, 'notes')]);
          stats.victims++;
        }
      } else if (kind === 'needles') {
        const c = findCol(header, NRULES);
        const named = new Set(Object.values(c)); const unnamed = header.map((h, i) => (!h || /^column [a-z]+$/i.test(h)) && !named.has(i) ? i : -1).filter((i) => i >= 0);
        if (c.updby == null && unnamed.length) c.updby = unnamed.shift(); if (c.extra == null && unnamed.length) c.extra = unnamed.shift();
        const g = (r, k) => (c[k] != null ? String(r[c[k]] == null ? '' : r[c[k]]).trim() : '');
        const hset = new Set(header.map(norm));
        s.rows.forEach((r, ri) => { const name = g(r, 'name'); if (!name || hset.has(norm(name))) return; pendingNeedles.push({ sheet: g(r, 'sheet') || s.name, name, analyst: g(r, 'analyst'), quarter: g(r, 'quarter'), actor: g(r, 'actor'), wagtail: g(r, 'wagtail'), intel: g(r, 'intel'), status: g(r, 'status'), rstatus: g(r, 'rstatus'), pdate: dateClean(g(r, 'pdate')), rdate: dateClean(g(r, 'rdate')), updby: g(r, 'updby'), notes: g(r, 'notes'), extra: g(r, 'extra'), srow: String(ri + 2), victimCol: g(r, 'victim') }); });
        raw.sheets.push({ wb: f.name, name: s.name, header, rows: s.rows.map((r) => header.map((_, i) => (r[i] == null ? '' : String(r[i])))) }); stats.sheets++;
      } else if (kind === 'groups') {
        const c = findCol(header, GRULES); const g = (r, k) => (c[k] != null ? String(r[c[k]] == null ? '' : r[c[k]]).trim() : '');
        for (const r of s.rows) { const nm = g(r, 'name'); if (!nm) continue; const gi = addGroup(nm); const G = raw.groups[gi]; for (const k of Object.keys(c)) { if (k === 'name') continue; const v = g(r, k); if (v && (!G[k] || k === 'site')) G[k] = v; } stats.groups++; }
      } else if (kind === 'journal') {
        const map = {}; header.forEach((h, i) => { const k = ({ date: 'date', time: 'time', updatetype: 'type', group: 'group', victim: 'victim', status: 'status', priority: 'priority', analyst: 'analyst', onionleakurl: 'onion', needlewagtaillink: 'needle', otherlink: 'link', country: 'country', sector: 'sector', tags: 'tags', notes: 'notes', loggedat: 'created' })[norm(h)]; if (k) map[i] = k; });
        for (const r of s.rows) { const o = {}; for (const i in map) o[map[i]] = String(r[+i] == null ? '' : r[+i]).trim(); if (o.date || o.victim || o.notes) { raw.journal.push(o); stats.journal++; } }
      } else {
        // assignments or any other sheet: keep it raw, and fold leak-site details into groups when recognised
        raw.sheets.push({ wb: f.name, name: s.name, header: header.map((h, i) => h || (i === 0 ? 'Name' : 'Column ' + String.fromCharCode(65 + (i % 26)))), rows: s.rows.map((r) => header.map((_, i) => (r[i] == null ? '' : String(r[i])))) }); stats.sheets++;
        if (kind === 'assign') {
          const c = findCol(header, ARULES); if (c.name == null) c.name = 0;
          const isAnalystSheet = header.some((h) => /working link/i.test(h)) && !header.some((h) => /collector/i.test(h));
          const g = (r, k) => (c[k] != null ? String(r[c[k]] == null ? '' : r[c[k]]).trim() : '');
          const prioCol = header.findIndex((h, i) => !Object.values(c).includes(i) && s.rows.filter((r) => /^p[0-4]$/i.test(String(r[i] || '').trim())).length >= 3);
          for (const r of s.rows) {
            const nm = g(r, 'name'); if (!nm || /^(name|leak ?site|site name)$/i.test(nm)) continue;
            const hasData = ['url', 'working', 'private', 'online', 'collector', 'kind', 'added'].some((k) => g(r, k));
            let gi = findGroup(nm); if (gi < 0) { if (!hasData) continue; gi = addGroup(nm, { source: s.name }); }
            aadd(gi, 'sheets', s.name);
            splitUrls(g(r, 'url')).forEach((u) => aadd(gi, 'leaksites', u)); splitUrls(g(r, 'working')).forEach((u) => aadd(gi, 'working', u)); splitUrls(g(r, 'private')).forEach((u) => aadd(gi, 'private', u));
            aadd(gi, 'online', /inactive/i.test(s.name) ? 'No' : g(r, 'online'));
            if (isAnalystSheet) aadd(gi, 'analyst', s.name); else { const col = g(r, 'collector'); if (/^(yes|no|yet to assign|to be assigned|live.*|on hold.*)$/i.test(col)) aadd(gi, 'notes', col); else aadd(gi, 'collector', col); if (/master list/i.test(s.name)) aadd(gi, 'analyst', g(r, 'analyst')); }
            aadd(gi, 'kind', g(r, 'kind')); aadd(gi, 'notes', g(r, 'notes')); aadd(gi, 'added', dateClean(g(r, 'added'))); aadd(gi, 'source', g(r, 'source')); aadd(gi, 'tags', g(r, 'tags'));
            if (prioCol >= 0 && /^p[0-4]$/i.test(String(r[prioCol] || '').trim())) aadd(gi, 'priority', String(r[prioCol]).trim().toUpperCase());
          }
        }
      }
    }
    stats.files.push(fs);
  }

  /* fold assignment details into groups (fill what is empty, append what is new) */
  const joinNew = (cur, vals, sep) => { const have = new Set(String(cur || '').split(/\n|,\s*|\s\/\s|\s\|\s/).map((x) => x.trim()).filter(Boolean)); const add = (vals || []).filter((v) => !have.has(v)); return [cur, ...add].filter(Boolean).join(sep); };
  for (const [gi, a] of assign) {
    const G = raw.groups[gi];
    G.leaksites = joinNew(G.leaksites, a.leaksites, '\n'); G.working = joinNew(G.working, a.working, '\n'); G.private = joinNew(G.private, a.private, '\n');
    G.online = joinNew(G.online, a.online, ' / '); G.collector = joinNew(G.collector, a.collector, ', '); G.analyst = joinNew(G.analyst, a.analyst, ', '); G.kind = joinNew(G.kind, a.kind, ' / ');
    G.priority = joinNew(G.priority, a.priority, ', '); G.added = G.added || (a.added || []).join(', '); G.source = joinNew(G.source, a.source, ' / '); G.tags = joinNew(G.tags, a.tags, ', '); G.note = joinNew(G.note, a.notes, ' | '); G.sheets = joinNew(G.sheets, a.sheets, ', ');
    if (!G.site || G.site === 'Unknown') { const on = (a.online || []).join(' '); G.site = /yes|active|live/i.test(on) && !/\bno\b|dead|inactive/i.test(on) ? 'Up' : /\bno\b|dead|inactive|down/i.test(on) ? 'Down' : G.site || 'Unknown'; }
  }
  /* onion address per group: most common .onion host among claim URLs, then assignment URLs */
  const hosts = new Map();
  raw.victims.forEach((a) => { if (a[11]) { const h = hostOf(a[11]); if (h) { const m = hosts.get(a[0]) || new Map(); m.set(h, (m.get(h) || 0) + 1); hosts.set(a[0], m); } } });
  raw.groups.forEach((G, gi) => {
    const ranked = Array.from((hosts.get(gi) || new Map()).entries()).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    const onions = ranked.filter((h) => h.endsWith('.onion'));
    for (const u of [G.leaksites, G.working, G.private, G.onion, G.onions]) for (const m of String(u || '').matchAll(ONION_RX)) if (!onions.includes(m[0].toLowerCase())) onions.push(m[0].toLowerCase());
    if (!G.onion || !isOnion(G.onion)) G.onion = onions.length ? 'http://' + onions[0] + '/' : G.onion || (ranked.length ? 'http://' + ranked[0] + '/' : splitUrls(G.leaksites)[0] || '');
    if (G.onion && !/^[a-z]+:\/\//i.test(G.onion)) G.onion = 'http://' + G.onion;
    const primary = hostOf(G.onion); const more = onions.filter((h) => h !== primary).slice(0, 5).map((h) => 'http://' + h + '/'); if (more.length) G.onions = joinNew(G.onions, more, '\n');
  });

  /* match new Needles to victims */
  if (pendingNeedles.length) {
    const exact = new Map(), byGroup = new Map(), dom = new Map();
    raw.victims.forEach((a, vi) => { const n = norm(a[1]); if (!n) return; const k = a[0] + '|' + n; (exact.get(k) || exact.set(k, []).get(k)).push(vi); (byGroup.get(a[0]) || byGroup.set(a[0], []).get(a[0])).push([n, vi]); if (a[2]) { const lab = norm(String(a[2]).split('.')[0]); if (lab.length >= 4) { const dk = a[0] + '|' + lab; (dom.get(dk) || dom.set(dk, []).get(dk)).push(vi); } } });
    const closest = (c, pdate) => { if (c.length === 1 || !pdate) return c[0]; let best = c[0], bd = Infinity; for (const vi of c) { const ms = msOf(raw.victims[vi][5]); if (isNaN(ms)) continue; const d = Math.abs(msOf(pdate) - ms); if (d < bd) { bd = d; best = vi; } } return best; };
    const match = (gi, vname, pdate) => { const n = norm(vname); if (gi < 0 || !n) return [-1, 0]; let c = exact.get(gi + '|' + n); if (c) return [closest(c, pdate), 1]; c = dom.get(gi + '|' + n); if (c) return [closest(c, pdate), 0.97]; let best = -1, bs = 0; const head = n.slice(0, 4); for (const [vn, vi] of byGroup.get(gi) || []) { if (!(vn.startsWith(head) || n.startsWith(vn.slice(0, 4)))) continue; const s = vn.startsWith(n) || n.startsWith(vn) ? 0.9 + 0.08 * Math.min(vn.length, n.length) / Math.max(vn.length, n.length) : dice(n, vn); if (s > bs) { bs = s; best = vi; } } return bs >= 0.86 ? [best, Math.round(bs * 100) / 100] : [-1, 0]; };
    for (const p of pendingNeedles) {
      const key = norm(p.sheet) + '|' + norm(p.name) + '|' + dateOf(p.pdate); if (nkeys.has(key)) { stats.dupNeedles++; continue; } nkeys.add(key);
      const vp = victimPart(p.name); const vpart = p.victimCol || vp.v;
      let gi = findGroup(p.actor); if (gi < 0 && vp.g) gi = findGroup(vp.g);
      let [vi, score] = match(gi, vpart, p.pdate); if (vi < 0 && gi >= 0 && vpart !== p.name) [vi, score] = match(gi, p.name, p.pdate);
      raw.needles.push([p.sheet, p.name, p.analyst, p.quarter, p.actor, p.wagtail, p.intel, p.status, p.rstatus, p.pdate, p.rdate, p.updby, p.notes, p.extra, p.srow, gi, vp.g || gi >= 0 ? vpart : '', vi, score, 'nf' + hash36(key)]);
      stats.needles++;
    }
  }
  { const has = new Set(raw.victims.map((a) => a[0])); raw.groups.forEach((G, gi) => { if (gi >= baseGroups) G.inledger = has.has(gi) ? 'Yes' : 'No'; }); stats.newGroups = raw.groups.length - baseGroups; }
  if (!raw.asOf) { let last = ''; raw.victims.forEach((a) => { const d = dateOf(a[5]); if (d > last && d <= todayISO()) last = d; }); raw.asOf = last || todayISO(); }
  raw.stats = stats;
  return raw;
}

function mergeSummary(st) {
  const parts = [`${fmtN(st.victims)} new victims` + (st.dupVictims ? ` (${fmtN(st.dupVictims)} already present, skipped)` : ''), `${fmtN(st.needles)} new Needles` + (st.dupNeedles ? ` (${fmtN(st.dupNeedles)} already present)` : '')];
  if (st.newGroups) parts.push(`${fmtN(st.newGroups)} new groups`); if (st.sheets) parts.push(`${fmtN(st.sheets)} sheets kept under Sheets`); if (st.journal) parts.push(`${fmtN(st.journal)} log entries`);
  return parts.join(', ') + '.';
}
/* ---- loader UI ---- */
let LOADED_KEY = 'files';
async function loadedFiles() { return (await IDB.get(LOADED_KEY)) || []; }
async function saveLoadedFiles(files) { await IDB.set(LOADED_KEY, files); }

async function parseFiles(fileList) {
  const out = [];
  for (const f of fileList) {
    busy('Reading ' + f.name + '...');
    try { let sheets = await readTable(f); if (!Array.isArray(sheets)) sheets = sheets && sheets.sheets ? sheets.sheets : []; sheets = sheets.filter((s) => s && s.header && s.rows && s.rows.length).map((s) => ({ name: s.name, header: s.header, rows: s.rows })); out.push({ name: f.name, when: nowISO(), sheets }); }
    catch (e) { toast('Could not read ' + f.name + ': ' + e.message, 5000); }
  }
  busy(false);
  return out;
}
function describeFile(f) { return f.sheets.map((s) => `${s.name} (${fmtN(s.rows.length)} rows, ${classifySheet(s.header)})`).join(' · '); }

/* full-page loader for the standalone page when nothing is loaded yet */
function loaderScreen(hasBase) {
  return new Promise((resolve) => {
    busy(false);
    const bg = document.createElement('div'); bg.className = 'busy'; bg.id = 'loader'; document.body.appendChild(bg);
    bg.innerHTML = `<div class="modal" style="width:min(720px,94vw)"><div class="mh"><h3>Load your data</h3></div><div class="mb">
      <p style="margin-top:0">This page keeps no data inside it. Drop your files here and they are read in the browser only, then remembered in this browser so next time you can start working at once.</p>
      <div data-drop style="border:2px dashed var(--grid);border-radius:8px;padding:28px;text-align:center;background:var(--wash)">
        <div style="font-size:15px;font-weight:600">Drop Excel or CSV files here</div>
        <div style="color:var(--ink-3);font-size:12.5px;margin:6px 0 12px">Ransomware ledger export (CSV or XLSX) · Needles tracker (.xlsx) · Needle assignments (.xlsx) · any export from this workbench</div>
        <button class="btn accent" data-pick>${ico('upload')}Choose files</button>
      </div>
      <ul data-list style="margin:12px 0 0 18px;font-size:12.5px;color:var(--ink-2)"></ul>
      <p style="font-size:12.5px;color:var(--ink-3)">Any sheet is accepted. Sheets with Group and Victim columns become the ledger, Needle sheets are matched to victims, leak-site and assignment sheets fill the Groups tab, and everything else stays as a raw sheet you can search and edit.</p>
    </div><div class="mf"><button class="btn accent" data-start disabled>Start working</button></div></div>`;
    const files = []; const list = $('[data-list]', bg); const start = $('[data-start]', bg);
    const add = async (fl) => { const parsed = await parseFiles(Array.from(fl)); files.push(...parsed); list.innerHTML = files.map((f) => `<li><b>${esc(f.name)}</b>: ${esc(describeFile(f))}</li>`).join(''); start.disabled = !files.length; };
    $('[data-pick]', bg).onclick = async () => { const inp = $('#file'); inp.accept = '.xlsx,.xls,.csv,.json'; inp.multiple = true; inp.value = ''; inp.onchange = () => add(inp.files); inp.click(); };
    const drop = $('[data-drop]', bg); drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; }; drop.ondragleave = () => { drop.style.borderColor = ''; }; drop.ondrop = (e) => { e.preventDefault(); drop.style.borderColor = ''; add(e.dataTransfer.files); };
    start.onclick = async () => { await saveLoadedFiles(files); bg.remove(); busy('Building tables...'); resolve(files); };
  });
}
/* "Data" dialog in the top bar: see, add and remove loaded files */
async function dataDialog() {
  const files = await loadedFiles(); const hasBase = !!DB.embedded;
  const render = () => `<p style="margin-top:0">${hasBase ? `This page carries a packed ledger as of ${DB.asOf}. ` : ''}Files you load are merged in: new victims and Needles are added, Needles are matched to victims, leak-site sheets fill the Groups tab, and every sheet appears under Sheets. The files stay in this browser only.</p>
    <ul style="margin:0 0 12px 18px;font-size:12.5px">${files.length ? files.map((f, i) => `<li style="margin-bottom:4px"><b>${esc(f.name)}</b> <span style="color:var(--ink-3)">loaded ${esc(f.when)}</span><br>${esc(describeFile(f))} <button class="ib" data-rm="${i}" title="Remove this file" style="vertical-align:middle">${ico('trash')}</button></li>`).join('') : '<li>No files loaded</li>'}</ul>
    ${DB.raw && DB.raw.stats ? `<p style="font-size:12.5px"><b>Result of the last load:</b> ${esc(mergeSummary(DB.raw.stats))}</p>` : ''}
    ${DB.raw && DB.raw.stats && DB.raw.stats.skipped.length ? `<p style="font-size:12px;color:var(--ink-3)">Skipped: ${esc(DB.raw.stats.skipped.join('; '))}</p>` : ''}`;
  modal({ title: 'Data files', wide: true, body: `<div data-body>${render()}</div>`, foot: `<button class="btn" data-x>Close</button><button class="btn accent" data-add>${ico('upload')}Add files</button><button class="btn" data-apply disabled>${ico('check')}Apply and reload</button>`, wire: (bg, close) => {
    let dirty = false; const apply = $('[data-apply]', bg);
    bg.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-rm]'); if (rm) { files.splice(+rm.dataset.rm, 1); dirty = true; apply.disabled = false; $('[data-body]', bg).innerHTML = render(); return; }
      if (e.target.closest('[data-add]')) { const inp = $('#file'); inp.accept = '.xlsx,.xls,.csv,.json'; inp.multiple = true; inp.value = ''; inp.onchange = async () => { const parsed = await parseFiles(Array.from(inp.files)); files.push(...parsed); dirty = true; apply.disabled = false; $('[data-body]', bg).innerHTML = render(); }; inp.click(); return; }
      if (e.target.closest('[data-apply]')) { await saveLoadedFiles(files); close(); busy('Rebuilding...'); location.reload(); }
    });
  } });
};
