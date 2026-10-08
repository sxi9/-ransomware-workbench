/* ===== sync: pull new victims from ransomware.live, or load its JSON files ===== */
const RL_API = 'https://api.ransomware.live/v2';
const RL_HEADER = ['Group', 'Victim', 'Entry type', 'Domain', 'Country', 'Sector', 'Attack date', 'Discovered (tracker)', 'Data size claimed', 'Leak-site claim URL (source)', 'ransomware.live URL (source)', 'Press / breach-notice links (source)', 'Basis (from listing text)'];
const isRlVictim = (o) => o && typeof o === 'object' && 'victim' in o && 'group' in o && ('discovered' in o || 'attackdate' in o);
const isRlGroup = (o) => o && typeof o === 'object' && 'name' in o && ('locations' in o || 'url' in o) && !('victim' in o);
function rlGroupName(slug) { const g = typeof groupFor === 'function' && DB.tables && DB.tables.groups ? groupFor(slug) : null; if (g) return g.name; const s = String(slug || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : 'Unknown'; }
function rlVictimsToSheet(list, name) {
  const rows = list.filter(isRlVictim).map((o) => {
    const victim = String(o.victim || '').trim(); const press = o.press && typeof o.press === 'object' ? (o.press.source || o.press.link || '') : (o.press || '');
    return [rlGroupName(o.group), victim, /\*{2,}/.test(victim) ? 'Masked' : victim ? 'Named' : 'Placeholder', o.domain || '', o.country || '', o.activity || '', dateClean(o.attackdate || ''), dateClean(o.discovered || o.attackdate || ''), o.data_size || '', o.claim_url || '', o.url || '', press, String(o.description || '').replace(/\s+/g, ' ').slice(0, 400)];
  });
  return { name: name || 'ransomware.live victims', header: RL_HEADER, rows };
}
function rlGroupsToSheet(list) {
  const parse = (v) => { if (Array.isArray(v)) return v; try { return JSON.parse(String(v || '[]').replace(/'/g, '"').replace(/\b(True|False|None)\b/g, (m) => ({ True: 'true', False: 'false', None: 'null' }[m]))); } catch (e) { return []; } };
  const rows = list.filter(isRlGroup).map((o) => { const locs = parse(o.locations); const sites = locs.map((l) => l.slug || (l.fqdn ? 'http://' + l.fqdn + '/' : '')).filter(Boolean); const live = locs.some((l) => l.available); const nm = String(o.name || '').trim(); return [/[A-Z]/.test(nm) ? nm : nm[0].toUpperCase() + nm.slice(1), sites.join('\n'), locs.length ? (live ? 'Yes' : 'No') : '', dateClean(o.added_date || ''), 'ransomware.live', o.altname || '']; });
  return { name: 'ransomware.live groups', header: ['Name', 'Leak site', 'Online?', 'Date added', 'Source', 'Also known as'], rows };
}
/* any JSON file -> sheets: ransomware.live victims or groups, a plain array of objects, or this page's own sheet export */
function jsonToSheets(j, fileName) {
  if (Array.isArray(j) && j.length && j[0] && j[0].header && j[0].rows) return j;
  if (j && Array.isArray(j.sheets)) return j.sheets;
  const arr = Array.isArray(j) ? j : (j && Array.isArray(j.data)) ? j.data : (j && Array.isArray(j.victims)) ? j.victims : null;
  if (!arr || !arr.length) return [];
  if (arr.some(isRlVictim)) return [rlVictimsToSheet(arr, 'ransomware.live victims')];
  if (arr.some(isRlGroup)) return [rlGroupsToSheet(arr)];
  if (typeof arr[0] === 'object') { const keys = Array.from(new Set(arr.flatMap((o) => Object.keys(o || {})))); return [{ name: (fileName || 'json').replace(/\.json$/i, ''), header: keys, rows: arr.map((o) => keys.map((k) => (o[k] == null ? '' : typeof o[k] === 'object' ? JSON.stringify(o[k]) : String(o[k])))) }]; }
  return [];
}

/* months between the last known date and today */
function monthsSince(iso) {
  const out = []; const now = new Date(); let y = +iso.slice(0, 4), m = +iso.slice(5, 7); const ey = now.getFullYear(), em = now.getMonth() + 1;
  while (y < ey || (y === ey && m <= em)) { out.push([y, m]); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
function lastKnownDate() { let last = ''; for (const r of DB.tables.victims.rows) { const d = dateOf(r.created); if (d > last && d <= todayISO()) last = d; } return last || DB.asOf || todayISO(); }

async function syncNow() {
  const last = lastKnownDate(); const months = monthsSince(last);
  const m = modal({ title: 'Sync new victims from ransomware.live', body: `<p style="margin-top:0">Newest victim in this page: <b>${last}</b>. Fetching ${months.length} month${months.length === 1 ? '' : 's'} of listings and keeping everything discovered on or after that day.</p><div data-log style="font-family:var(--mono);font-size:12px;white-space:pre-wrap;color:var(--ink-2);max-height:40vh;overflow:auto"></div>`, foot: `<button class="btn" data-x>Cancel</button>` });
  const log = (s) => { const el = m.el.querySelector('[data-log]'); if (el) el.textContent += s + '\n'; };
  const all = []; let groups = null;
  try {
    for (const [y, mo] of months) {
      const url = `${RL_API}/victims/${y}/${pad(mo)}`; log(`GET ${url}`);
      const res = await fetch(url, { headers: { Accept: 'application/json' } }); if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json(); const keep = list.filter((o) => dateOf(dateClean(o.discovered || o.attackdate || '')) >= last); log(`  ${fmtN(list.length)} listings, ${fmtN(keep.length)} on or after ${last}`); all.push(...keep);
    }
    try { log(`GET ${RL_API}/groups`); const res = await fetch(`${RL_API}/groups`); if (res.ok) groups = await res.json(); } catch (e) { log('  groups skipped: ' + e.message); }
  } catch (e) {
    m.close();
    syncFallback(last, months, e);
    return;
  }
  const sheets = [rlVictimsToSheet(all, `ransomware.live victims since ${last}`)]; if (groups) sheets.push(rlGroupsToSheet(groups));
  const files = await loadedFiles(); files.push({ name: `ransomware.live sync ${nowISO()}`, when: nowISO(), sheets }); await saveLoadedFiles(files);
  log(`Saved ${fmtN(all.length)} listings. Reloading...`); busy('Merging the new victims...'); setTimeout(() => location.reload(), 600);
}
function syncFallback(last, months, err) {
  const links = months.map(([y, mo]) => `${RL_API}/victims/${y}/${pad(mo)}`);
  const py = helperScript(last);
  modal({ title: 'Your browser blocked the direct download', wide: true, body: `
    <p style="margin-top:0">ransomware.live's API does not allow web pages to call it directly (${esc(err.message || 'blocked by the browser')}), so the page cannot fetch on its own. Two ways that take under a minute, no install needed for the first:</p>
    <h4 style="margin:12px 0 6px">1. Open, save, drop (no tools needed)</h4>
    <ol style="margin:0 0 8px 18px;font-size:13px">
      <li>Open each link below. The browser shows the JSON listing for that month.</li>
      <li>Press <kbd>Ctrl</kbd>+<kbd>S</kbd> and save it as a .json file (any name).</li>
      <li>Click <b>Load the saved files</b> here, or use <b>Data</b> in the top bar later. New victims are added, duplicates skipped.</li></ol>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${links.map((u) => `<a class="btn sm" href="${u}" target="_blank" rel="noopener">${ico('ext')}${esc(u.replace(RL_API + '/victims/', 'Victims '))}</a>`).join('')}<a class="btn sm" href="${RL_API}/groups" target="_blank" rel="noopener">${ico('ext')}Groups and leak-site status</a></div>
    <button class="btn accent" data-loadjson>${ico('upload')}Load the saved files</button>
    <h4 style="margin:16px 0 6px">2. One small script (needs Python on the computer)</h4>
    <p style="margin:0 0 8px;font-size:13px">Download <code>sync_victims.py</code>, double-click it (or run <code>python sync_victims.py</code>). It fetches everything since ${esc(last)} and writes <code>ransomware_live_since_${esc(last)}.json</code> next to it. Load that file with <b>Data</b>.</p>
    <button class="btn" data-py>${ico('download')}Download sync_victims.py</button>
    <p style="font-size:12px;color:var(--ink-3);margin-top:14px">Why: a page opened from your disk may only talk to sites that explicitly allow it, and ransomware.live does not. If that ever changes, the Sync button will simply work.</p>`,
    wire: (bg, close) => {
      bg.querySelector('[data-py]').onclick = () => download('sync_victims.py', py, 'text/x-python');
      bg.querySelector('[data-loadjson]').onclick = async () => { const inp = $('#file'); inp.accept = '.json,.xlsx,.csv'; inp.multiple = true; inp.value = ''; inp.onchange = async () => { const parsed = await parseFiles(Array.from(inp.files)); if (!parsed.length) return; const files = await loadedFiles(); files.push(...parsed); await saveLoadedFiles(files); close(); busy('Merging the new victims...'); location.reload(); }; inp.click(); };
    } });
}
function helperScript(last) {
  return `#!/usr/bin/env python3
"""Fetch ransomware.live victims discovered since ${last} and write them as JSON for the Samurai Scan workbench.
Run:  python sync_victims.py            (uses the Python standard library only)
Then: open the workbench, click Data, add the ransomware_live_since_*.json file."""
import json, sys, urllib.request, datetime as dt
SINCE = sys.argv[1] if len(sys.argv) > 1 else "${last}"
API = "${RL_API}"
def get(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "samurai-scan-sync"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)
y, m = int(SINCE[:4]), int(SINCE[5:7]); today = dt.date.today(); out = []
while (y, m) <= (today.year, today.month):
    url = f"{API}/victims/{y}/{m:02d}"; print("GET", url)
    rows = get(url); keep = [r for r in rows if str(r.get("discovered") or r.get("attackdate") or "")[:10] >= SINCE]
    print(f"  {len(rows)} listings, {len(keep)} since {SINCE}"); out += keep
    m += 1
    if m > 12: m = 1; y += 1
try:
    groups = get(f"{API}/groups"); print(f"GET {API}/groups: {len(groups)} groups")
except Exception as e:
    groups = None; print("groups skipped:", e)
name = f"ransomware_live_since_{SINCE}.json"
with open(name, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print(f"wrote {name} with {len(out)} victims")
if groups:
    with open("ransomware_live_groups.json", "w", encoding="utf-8") as f:
        json.dump(groups, f, ensure_ascii=False)
    print("wrote ransomware_live_groups.json")
input("Done. Press Enter to close.") if sys.stdin and sys.stdin.isatty() else None
`;
}
