#!/usr/bin/env python3
"""Build the Samurai Scan workbench.

Reads
  data/ledger_seed.json.gz           victims + groups (from the ransomware workbench)
  data/Needles_Tracker_from_2025.xlsx the Needles tracker (all sheets)
  data/Needle_Assignments.xlsx        leak-site, Telegram, forum and collector assignments (all sheets)
and writes
  dist/samurai_scan_workbench.html    one self-contained page with the data embedded (gzip + base64)
  dist/db.json                        the merged database, for inspection

Run:  python3 build/build.py
"""
import base64
import collections
import datetime as dt
import difflib
import gzip
import json
import os
import re
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
SRC = os.path.join(ROOT, 'src', 'app.html')
DIST = os.path.join(ROOT, 'dist')

TRACKER = os.path.join(DATA, 'Needles_Tracker_from_2025.xlsx')
ASSIGN = os.path.join(DATA, 'Needle_Assignments.xlsx')
SEED = os.path.join(DATA, 'ledger_seed.json.gz')


# ---------------------------------------------------------------- helpers
def norm(s):
    return re.sub(r'[^a-z0-9]', '', str(s or '').lower())


def norm_group(s):
    """Normalised group key with common suffixes removed."""
    k = norm(s)
    for suf in ('ransomwaregroup', 'ransomware', 'ransom', 'group', 'gang', 'team', 'leaks', 'leak'):
        if k.endswith(suf) and len(k) - len(suf) >= 3:
            k = k[: -len(suf)]
            break
    return k


def cell(v):
    if v is None:
        return ''
    if isinstance(v, dt.datetime):
        if v.hour or v.minute:
            return v.strftime('%Y-%m-%d %H:%M')
        return v.strftime('%Y-%m-%d')
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def date_only(s):
    m = re.match(r'^(\d{4}-\d{2}-\d{2})', s or '')
    return m.group(1) if m else ''


def read_sheet(ws):
    rows = []
    for r in ws.iter_rows(values_only=True):
        vals = [cell(c) for c in r]
        while vals and vals[-1] == '':
            vals.pop()
        if any(vals):
            rows.append(vals)
    return rows


def col_letter(i):
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def host_of(url):
    m = re.match(r'^(?:[a-z]+:/+)?([^/\s]+)', url.strip(), re.I)
    return m.group(1).lower() if m else ''


ONION_RE = re.compile(r'[a-z2-7]{16,56}\.onion', re.I)


def onions_in(text):
    return [m.group(0).lower() for m in ONION_RE.finditer(text or '')]


def split_urls(text):
    out = []
    for part in re.split(r'[\s,]+', text or ''):
        part = part.strip().strip('"\'')
        if part and ('.' in part or '/' in part):
            out.append(part)
    return out


# ---------------------------------------------------------------- ledger
def load_seed():
    with gzip.open(SEED, 'rt', encoding='utf-8') as f:
        return json.load(f)


PUBL = {'Y': 'Yes', 'P': 'Partial', 'N': 'No', 'U': 'Unknown'}
TYPL = {'N': 'Named', 'M': 'Masked', 'P': 'Placeholder'}


def build_groups_index(groups):
    idx = {}
    for gi, g in enumerate(groups):
        keys = {norm(g['name'])} | {norm(s) for s in g.get('slugs', [])} | {norm(a) for a in g.get('aliases', [])}
        keys.discard('')
        for k in keys:
            idx.setdefault(k, gi)
    # suffix-stripped keys only when unambiguous
    stripped = collections.defaultdict(set)
    for gi, g in enumerate(groups):
        for s in [g['name']] + g.get('slugs', []) + g.get('aliases', []):
            k = norm_group(s)
            if k:
                stripped[k].add(gi)
    for k, s in stripped.items():
        if len(s) == 1 and k not in idx:
            idx[k] = next(iter(s))
    return idx


def find_group(idx, name):
    if not name:
        return -1
    k = norm(name)
    if k in idx:
        return idx[k]
    k2 = norm_group(name)
    if k2 in idx:
        return idx[k2]
    # "APT73(BASHE)" -> try the part in brackets, then the part before
    m = re.match(r'^([^(]+)\(([^)]+)\)', name)
    if m:
        for part in (m.group(2), m.group(1)):
            r = find_group(idx, part.strip())
            if r >= 0:
                return r
    return -1


# ---------------------------------------------------------------- needles
ROLE_RULES = [
    ('name', re.compile(r'^name$', re.I)),
    ('analyst', re.compile(r'^(analyst|publisher)$', re.I)),
    ('quarter', re.compile(r'^quarter$', re.I)),
    ('actor', re.compile(r'^(threat actor|source name|affected vendor|group|actor)$', re.I)),
    ('wagtail', re.compile(r'wagtail', re.I)),
    ('intel', re.compile(r'^(intel live link|platform link|advance dark web link)$', re.I)),
    ('status', re.compile(r'^status$', re.I)),
    ('rstatus', re.compile(r'^(republish status|updated)$', re.I)),
    ('pdate', re.compile(r'^published (date|data)$', re.I)),
    ('rdate', re.compile(r'^(re ?-? ?published date|republish date|updated date)$', re.I)),
    ('notes', re.compile(r'^notes?$', re.I)),
]
NEEDLE_COLS = ['sheet', 'name', 'analyst', 'quarter', 'actor', 'wagtail', 'intel', 'status', 'rstatus', 'pdate', 'rdate', 'updby', 'notes', 'extra', 'srow']


def victim_part(name):
    """'Akira Ransomware: Moorman, Harting & Company' -> ('Akira Ransomware', 'Moorman, Harting & Company')"""
    name = (name or '').strip()
    m = re.match(r'^(.{2,60}?)\s*:\s+(.+)$', name)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return '', name


def classify_header(header):
    roles = {}
    used = set()
    for i, h in enumerate(header):
        for role, rx in ROLE_RULES:
            if role not in used and h and rx.search(h):
                roles[role] = i
                used.add(role)
                break
    return roles


def build_needles(wb, groups_idx, victims, groups):
    """Return (needle rows, sheet summaries)."""
    needles = []
    # victim index: per group -> list of (norm name, idx); plus global exact
    by_group = collections.defaultdict(list)
    exact = collections.defaultdict(list)
    for vi, v in enumerate(victims):
        n = norm(v['victim'])
        if not n:
            continue
        by_group[v['gi']].append((n, vi))
        exact[(v['gi'], n)].append(vi)
    domain_exact = collections.defaultdict(list)
    for vi, v in enumerate(victims):
        if v['domain']:
            lab = norm(v['domain'].split('.')[0])
            if len(lab) >= 4:
                domain_exact[(v['gi'], lab)].append(vi)

    def pick_closest(cands, pdate):
        if len(cands) == 1 or not pdate:
            return cands[0]
        best, bd = cands[0], None
        for vi in cands:
            c = victims[vi]['created'][:10]
            if not c:
                continue
            d = abs((dt.date.fromisoformat(pdate) - dt.date.fromisoformat(c)).days)
            if bd is None or d < bd:
                best, bd = vi, d
        return best

    def match(gi, vname, pdate):
        n = norm(vname)
        if gi < 0 or not n:
            return -1, 0.0
        c = exact.get((gi, n))
        if c:
            return pick_closest(c, pdate), 1.0
        c = domain_exact.get((gi, n))
        if c:
            return pick_closest(c, pdate), 0.97
        best, bs = -1, 0.0
        head = n[:4]
        for vn, vi in by_group.get(gi, ()):
            if not (vn.startswith(head) or n.startswith(vn[:4])):
                continue
            if vn.startswith(n) or n.startswith(vn):
                s = 0.9 + 0.08 * min(len(vn), len(n)) / max(len(vn), len(n))
            else:
                s = difflib.SequenceMatcher(None, n, vn).ratio()
            if s > bs:
                best, bs = vi, s
        if bs >= 0.86:
            return best, round(bs, 2)
        return -1, 0.0

    stats = collections.Counter()
    for ws in wb.worksheets:
        rows = read_sheet(ws)
        if not rows:
            continue
        # header row: the first row that contains "Name" as a cell
        hi = next((i for i, r in enumerate(rows[:6]) if any(c.lower() == 'name' for c in r)), 0)
        header = rows[hi]
        roles = classify_header(header)
        if 'name' not in roles:
            continue
        ncol = max(len(r) for r in rows)
        # unnamed trailing columns: K -> updated by, L -> notes/extra (matches the tracker's habit)
        named = {i for i in roles.values()}
        unnamed = [i for i in range(ncol) if i >= len(header) or not header[i]]
        if unnamed and 'updby' not in roles:
            roles['updby'] = unnamed[0]
        if len(unnamed) > 1:
            roles['extra'] = unnamed[1]
        for ci, h in enumerate(header):
            if h and ci not in named and 'extra' not in roles:
                roles['extra'] = ci
        hset = {norm(c) for c in header if c}
        for ri, r in enumerate(rows):
            if ri <= hi:
                continue
            get = lambda role: (r[roles[role]] if role in roles and roles[role] < len(r) else '')
            name = get('name')
            if not name or norm(name) in hset or norm(name) == 'name':
                continue
            if not any(c for i, c in enumerate(r) if i != roles['name']) and re.match(r'^\d{4}-\d{2}-\d{2}', name):
                continue
            actor = get('actor')
            gpart, vpart = victim_part(name)
            gi = find_group(groups_idx, actor) if actor else -1
            if gi < 0 and gpart:
                gi = find_group(groups_idx, gpart)
            pdate = date_only(get('pdate'))
            vi, score = match(gi, vpart, pdate)
            if vi < 0 and gi >= 0 and vpart != name:
                vi, score = match(gi, name, pdate)
            rec = [ws.title, name, get('analyst'), get('quarter'), actor, get('wagtail'), get('intel'), get('status').strip(),
                   get('rstatus').strip(), pdate or get('pdate'), date_only(get('rdate')) or get('rdate'), get('updby'), get('notes'), get('extra'), str(ri + 1),
                   gi, vpart if gpart or gi >= 0 else '', vi, score]
            needles.append(rec)
            stats[ws.title] += 1
            if vi >= 0:
                stats[ws.title + ' matched'] += 1
    return needles, stats


# ---------------------------------------------------------------- assignments -> groups
def build_assignment_groups(wb, groups, groups_idx):
    """Fold the assignments workbook into per-group leak-site records."""
    rec = collections.defaultdict(lambda: {
        'leaksites': [], 'working': [], 'private': [], 'online': [], 'collector': [], 'analyst': [], 'kind': [],
        'lsstatus': [], 'priority': [], 'added': [], 'source': [], 'notes': [], 'sheets': [], 'tags': [], 'title': []})
    extra_groups = {}  # key -> display name for names not in the ledger

    def key_for(name):
        gi = find_group(groups_idx, name)
        if gi >= 0:
            return ('g', gi)
        k = norm_group(name) or norm(name)
        if not k:
            return None
        extra_groups.setdefault(k, name.strip())
        return ('x', k)

    def add(k, field, val):
        val = (val or '').strip()
        if val and val not in rec[k][field]:
            rec[k][field].append(val)

    def by_header(ws, wanted):
        rows = read_sheet(ws)
        if not rows:
            return [], {}
        header = rows[0]
        pos = {}
        for i, h in enumerate(header):
            hn = norm(h)
            for key, pats in wanted.items():
                if key not in pos and any(hn == norm(p) or (p.endswith('*') and hn.startswith(norm(p[:-1]))) for p in pats):
                    pos[key] = i
        return rows[1:], pos

    for ws in wb.worksheets:
        title = ws.title.strip()
        tn = norm(title)
        rows, pos = by_header(ws, {
            'name': ['Leaksite', 'Leak site', 'Site Name', 'Name'], 'url': ['Leak site', 'Site URL', 'Source URLs', 'Public page', 'Leak site'],
            'private': ['Private negotiation page', 'Private negotiation link'], 'online': ['Online?', 'Online ?', 'Leak Site Status'],
            'collector': ['Assingend  Collector', 'Assigned Collector', 'Analyst'], 'kind': ['Ransomware/Non Ransomware', 'Ransomware/Data Leak'],
            'working': [' Working Link', 'Working Link'], 'notes': ['Notes', 'Remarks'], 'added': ['Date Added'], 'source': ['Source'],
            'tags': ['Needle Tags'], 'title': ['Title Format']})
        if tn in ('leaksitesassignemnts',):
            # columns: A name, C leak site, D private, E online, F collector, G kind, H priority, I second collector
            for r in rows:
                g = lambda i: r[i] if i < len(r) else ''
                name = g(0)
                if not name:
                    continue
                k = key_for(name)
                if not k:
                    continue
                add(k, 'sheets', title)
                for u in split_urls(g(2)):
                    add(k, 'leaksites', u)
                for u in split_urls(g(3)):
                    add(k, 'private', u)
                add(k, 'online', g(4))
                if re.match(r'^(yes|no|yet to assign|to be assigned|live.*|on hold.*)$', g(5), re.I):
                    add(k, 'notes', g(5)) if not re.match(r'^(yes|no)$', g(5), re.I) else None
                else:
                    add(k, 'collector', g(5))
                add(k, 'kind', g(6))
                if re.match(r'^p[0-4]$', g(7), re.I):
                    add(k, 'priority', g(7).upper())
                elif g(7):
                    add(k, 'notes', g(7))
                add(k, 'collector', g(8))
            continue
        if tn == 'masterlist':
            for r in rows:
                g = lambda i: r[i] if i < len(r) else ''
                name = g(0)
                if not name:
                    continue
                k = key_for(name)
                if not k:
                    continue
                add(k, 'sheets', title)
                for u in split_urls(g(1)):
                    add(k, 'leaksites', u)
                if re.match(r'^(not live|yes|no|live.*|file server|threat actor.*|leak server.*)', g(2), re.I):
                    add(k, 'notes', g(2))
                else:
                    add(k, 'analyst', g(2))
                add(k, 'notes', g(3))
            continue
        if 'name' not in pos and 'url' not in pos:
            continue
        if tn in ('telegram', 'forummarketplace', 'forumsmarkets', 'toolsutlities', 'threatactorgroupobservations', 'dailycoverage'):
            continue
        is_analyst_sheet = norm(title) in {norm(x) for x in ('Sai Krishna', 'Rajveer', 'Mohit', 'Lichu', 'Anikait')}
        for r in rows:
            g = lambda key: (r[pos[key]] if key in pos and pos[key] < len(r) else '')
            name = g('name')
            if not name:
                continue
            k = key_for(name)
            if not k:
                continue
            add(k, 'sheets', title)
            for u in split_urls(g('url')):
                add(k, 'leaksites', u)
            for u in split_urls(g('working')):
                add(k, 'working', u)
            for u in split_urls(g('private')):
                add(k, 'private', u)
            if tn.startswith('inactivesites'):
                add(k, 'online', 'No')
            else:
                add(k, 'online', g('online'))
            if is_analyst_sheet:
                add(k, 'analyst', title)
            else:
                add(k, 'collector', g('collector'))
            add(k, 'kind', g('kind'))
            add(k, 'notes', g('notes'))
            add(k, 'added', date_only(g('added')) or g('added'))
            add(k, 'source', g('source'))
            add(k, 'tags', g('tags'))
            add(k, 'title', g('title'))
            if tn.startswith('ransomwaredigitalextortion'):
                add(k, 'kind', 'Ransomware')
    return rec, extra_groups


def build_groups(seed, victims, assign_rec, extra_groups):
    groups = seed['groups']
    claim_hosts = collections.defaultdict(collections.Counter)
    for v in victims:
        if v['claim']:
            h = host_of(v['claim'])
            if h:
                claim_hosts[v['gi']][h] += 1
    out = []
    for gi, g in enumerate(groups):
        a = assign_rec.get(('g', gi), {})
        hosts = [h for h, _ in claim_hosts[gi].most_common()]
        onion_hosts = [h for h in hosts if h.endswith('.onion')]
        more = []
        for field in ('leaksites', 'working', 'private'):
            for u in a.get(field, []):
                more += onions_in(u)
        for h in more:
            if h not in onion_hosts:
                onion_hosts.append(h)
        primary = ('http://' + onion_hosts[0] + '/') if onion_hosts else ((('http://' + hosts[0] + '/') if hosts else (a.get('leaksites') or [''])[0]))
        if primary and not re.match(r'^[a-z]+://', primary):
            primary = 'http://' + primary
        out.append({
            'id': g['id'], 'name': g['name'], 'aliases': ', '.join(x for x in dict.fromkeys(g.get('aliases', []) + g.get('slugs', [])) if x and x != g['name']),
            'site': g.get('site', 'Unknown'), 'onion': primary,
            'onions': '\n'.join('http://' + h + '/' for h in onion_hosts[1:6]),
            'leaksites': '\n'.join(a.get('leaksites', [])), 'working': '\n'.join(a.get('working', [])), 'private': '\n'.join(a.get('private', [])),
            'online': ' / '.join(a.get('online', [])), 'collector': ', '.join(a.get('collector', [])), 'analyst': ', '.join(a.get('analyst', [])),
            'kind': ' / '.join(a.get('kind', [])), 'priority': ', '.join(a.get('priority', [])), 'added': ', '.join(a.get('added', [])),
            'source': ' / '.join(a.get('source', [])), 'tags': ', '.join(a.get('tags', [])),
            'note': ' | '.join([g.get('note', '')] + a.get('notes', [])).strip(' |'),
            'sheets': ', '.join(a.get('sheets', [])), 'inledger': 'Yes',
        })
    for k, name in sorted(extra_groups.items(), key=lambda x: x[1].lower()):
        a = assign_rec.get(('x', k), {})
        onion_hosts = []
        for field in ('leaksites', 'working', 'private'):
            for u in a.get(field, []):
                for h in onions_in(u):
                    if h not in onion_hosts:
                        onion_hosts.append(h)
        primary = ('http://' + onion_hosts[0] + '/') if onion_hosts else (a.get('leaksites') or [''])[0]
        if primary and not re.match(r'^[a-z]+://', primary):
            primary = 'http://' + primary
        online = ' / '.join(a.get('online', []))
        site = 'Up' if re.search(r'yes|active|live', online, re.I) and not re.search(r'no\b|dead|inactive', online, re.I) else ('Down' if re.search(r'no\b|dead|inactive|down', online, re.I) else 'Unknown')
        out.append({
            'id': 'x_' + k, 'name': name, 'aliases': '', 'site': site, 'onion': primary,
            'onions': '\n'.join('http://' + h + '/' for h in onion_hosts[1:6]),
            'leaksites': '\n'.join(a.get('leaksites', [])), 'working': '\n'.join(a.get('working', [])), 'private': '\n'.join(a.get('private', [])),
            'online': online, 'collector': ', '.join(a.get('collector', [])), 'analyst': ', '.join(a.get('analyst', [])),
            'kind': ' / '.join(a.get('kind', [])), 'priority': ', '.join(a.get('priority', [])), 'added': ', '.join(a.get('added', [])),
            'source': ' / '.join(a.get('source', [])), 'tags': ', '.join(a.get('tags', [])),
            'note': ' | '.join(a.get('notes', [])), 'sheets': ', '.join(a.get('sheets', [])), 'inledger': 'No',
        })
    return out


# ---------------------------------------------------------------- raw sheets
def raw_sheets(wb, wbname):
    out = []
    for ws in wb.worksheets:
        rows = read_sheet(ws)
        if not rows:
            continue
        hi = 0
        if norm(ws.title) == 'previousentries':
            hi = next((i for i, r in enumerate(rows[:6]) if any(c.lower() == 'name' for c in r)), 0)
        header = list(rows[hi])
        ncol = max(len(r) for r in rows[hi:])
        header += [''] * (ncol - len(header))
        header = [(h or ('Name' if i == 0 else 'Column ' + col_letter(i))) for i, h in enumerate(header)]
        seen = collections.Counter()
        for i, h in enumerate(header):
            seen[h] += 1
            if seen[h] > 1:
                header[i] = f'{h} ({seen[h]})'
        body = []
        hset = tuple(rows[hi])
        for r in rows[hi + 1:]:
            if tuple(r) == hset:
                continue
            body.append(r + [''] * (ncol - len(r)))
        out.append({'wb': wbname, 'name': ws.title.strip(), 'header': header, 'rows': body})
    return out


# ---------------------------------------------------------------- main
def main():
    seed = load_seed()
    groups = seed['groups']
    gidx = build_groups_index(groups)

    victims = []
    for a in seed['rows']:
        gi = a[0]
        slug = (groups[gi].get('slugs') or [groups[gi]['id']])[0]
        rl = a[12] or ''
        try:
            dec = base64.b64decode(rl).decode('utf-8') if rl else ''
        except Exception:
            dec = None
        rl_out = '' if (dec is not None and dec == f'{a[1]}@{slug}') else rl
        victims.append({'gi': gi, 'victim': a[1], 'domain': a[2] or '', 'cc': a[3] or '', 'sector': a[4] or '', 'created': a[5] or '',
                        'attack': a[6] or '', 'pub': a[7] or 'U', 'basis': a[8] or '', 'type': a[9] or 'N', 'size': a[10] or '',
                        'claim': a[11] or '', 'rl': rl_out, 'press': a[13] or '', 'added': a[14] or ''})

    twb = openpyxl.load_workbook(TRACKER, read_only=True, data_only=True)
    awb = openpyxl.load_workbook(ASSIGN, read_only=True, data_only=True)

    needles, nstats = build_needles(twb, gidx, victims, groups)
    assign_rec, extra_groups = build_assignment_groups(awb, groups, gidx)
    grows = build_groups(seed, victims, assign_rec, extra_groups)

    sheets = raw_sheets(twb, 'Needles Tracker from 2025') + raw_sheets(awb, 'Needle Assignments')

    # compact victims as arrays
    VC = ['gi', 'victim', 'domain', 'cc', 'sector', 'created', 'attack', 'pub', 'basis', 'type', 'size', 'claim', 'rl', 'press', 'added']
    db = {
        'asOf': seed.get('asOf', dt.date.today().isoformat()),
        'built': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
        'countries': seed.get('countries', {}),
        'groupsMeta': [{'id': g['id'], 'name': g['name'], 'slug': (g.get('slugs') or [g['id']])[0], 'keys': sorted({norm(x) for x in [g['name']] + g.get('slugs', []) + g.get('aliases', [])} - {''})} for g in groups],
        'victimCols': VC,
        'victims': [[v[k] for k in VC] for v in victims],
        'needleCols': NEEDLE_COLS + ['gi', 'vpart', 'vi', 'score'],
        'needles': needles,
        'groups': grows,
        'sheets': sheets,
    }
    os.makedirs(DIST, exist_ok=True)
    raw = json.dumps(db, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    with open(os.path.join(DIST, 'db.json'), 'wb') as f:
        f.write(raw)
    gz = gzip.compress(raw, 9)
    b64 = base64.b64encode(gz).decode('ascii')

    with open(SRC, encoding='utf-8') as f:
        html = f.read()
    if '__DATA_B64__' not in html:
        sys.exit('src/app.html has no __DATA_B64__ placeholder')
    js = ''
    jsdir = os.path.join(ROOT, 'src', 'js')
    for fn in sorted(os.listdir(jsdir)):
        if fn.endswith('.js'):
            with open(os.path.join(jsdir, fn), encoding='utf-8') as f:
                js += f'/* ---- {fn} ---- */\n' + f.read() + '\n'
    html = html.replace('<!-- @@JS@@ -->', '<script>\n' + js + '</script>')
    vendor = os.path.join(ROOT, 'vendor', 'xlsx.full.min.js')
    if os.path.exists(vendor):
        with open(vendor, encoding='utf-8') as f:
            html = html.replace('<!-- @@VENDOR@@ -->', '<script>/* SheetJS CE 0.18.5, Apache-2.0 */\n' + f.read() + '\n</script>')
    page = html.replace('__BUILT__', db['built']).replace('__ASOF__', db['asOf'])
    out = os.path.join(DIST, 'samurai_scan_workbench.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(page.replace('__DATA_B64__', b64))
    # standalone: same app, no data inside; the user loads CSV / Excel files in the browser
    out2 = os.path.join(DIST, 'samurai_scan_standalone.html')
    with open(out2, 'w', encoding='utf-8') as f:
        f.write(page.replace('__DATA_B64__', '').replace('<title>Samurai Scan</title>', '<title>Samurai Scan (load your files)</title>'))
    print(f'standalone page -> {out2} ({os.path.getsize(out2)/1e3:.0f} KB)')

    print(f'victims {len(victims):,}  groups {len(grows):,} ({len(extra_groups)} only in assignments)  needles {len(needles):,}  raw sheets {len(sheets)}')
    for k in sorted(nstats):
        print(f'  {k}: {nstats[k]:,}')
    print(f'db.json {len(raw)/1e6:.1f} MB  gzip {len(gz)/1e6:.1f} MB  page {os.path.getsize(out)/1e6:.1f} MB -> {out}')


if __name__ == '__main__':
    main()
