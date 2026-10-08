/* ===== core: utilities, storage, search, files ===== */
'use strict';
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (n) => `<svg class="i"><use href="#i-${n}"/></svg>`;
const fmtN = (n) => Number(n || 0).toLocaleString('en-US');
const pad = (n) => String(n).padStart(2, '0');
const DAY = 864e5;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowISO = () => { const d = new Date(); return `${todayISO()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dateOf = (s) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || '')); return m ? m[1] : ''; };
const msOf = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0) : NaN; };
const addDays = (iso, n) => { const d = new Date(msOf(iso) + n * DAY); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
const isUrl = (s) => /^(https?:\/\/|www\.|t\.me\/)/i.test(String(s || '').trim()) || /^[a-z2-7]{16,56}\.onion/i.test(String(s || '').trim());
const isOnion = (s) => /\.onion(\/|$|:)/i.test(String(s || ''));
const hrefOf = (u) => { u = String(u || '').trim(); return /^[a-z]+:\/\//i.test(u) ? u : 'http://' + u; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* toast / busy */
let toastT;
function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 2600); }
function busy(msg) { const b = $('#busy'); if (!b) return; if (msg === false) b.classList.add('hide'); else { const m = $('#busyMsg'); if (m) m.textContent = msg; b.classList.remove('hide'); } }
async function copyText(s) { try { await navigator.clipboard.writeText(s); toast('Copied'); } catch (e) { const ta = document.createElement('textarea'); ta.value = s; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Copied'); } }

/* storage: localStorage with memory fallback */
let PFX = 'ss1:';
function setStorageMode(embedded) { PFX = embedded ? 'ss1:' : 'ss1s:'; }
const mem = {};
const store = {
  get(k) { try { const v = localStorage.getItem(PFX + k); if (v != null) return JSON.parse(v); } catch (e) { /* blocked */ } return mem[k] == null ? null : JSON.parse(mem[k]); },
  set(k, v) { const s = JSON.stringify(v); mem[k] = s; try { localStorage.setItem(PFX + k, s); return true; } catch (e) { toast('Browser storage is full or blocked. Changes stay in this tab only; use Backup to keep them.', 5000); return false; } },
  del(k) { delete mem[k]; try { localStorage.removeItem(PFX + k); } catch (e) { /* none */ } },
  keys() { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(PFX)) out.push(k.slice(PFX.length)); } } catch (e) { /* none */ } return out; }
};

/* ---- search: every word must appear somewhere in the row ----
 * tokens: plain words, "quoted phrases", -excluded, field:value (field = column name or key)
 */
function parseQuery(q, cols) {
  const toks = [];
  const re = /(-)?(?:([a-z0-9_]+):)?("([^"]*)"|(\S+))/gi;
  let m;
  const colIdx = {};
  (cols || []).forEach((c) => { colIdx[norm(c.k)] = c.k; colIdx[norm(c.name)] = c.k; });
  const s = String(q || '').trim();
  // rejoin quoted field values like name:"a b"
  while ((m = re.exec(s))) {
    const neg = !!m[1];
    let field = m[2] ? colIdx[norm(m[2])] || null : null;
    const val = (m[4] != null ? m[4] : m[5] || '').toLowerCase();
    if (!val) continue;
    if (m[2] && !field) { toks.push({ neg, field: null, val: (m[2] + ':' + val).toLowerCase() }); continue; }
    toks.push({ neg, field, val });
  }
  return toks;
}
function rowText(row, cols) {
  if (row._s != null) return row._s;
  let s = '';
  for (const c of cols) { const v = row[c.k]; if (v != null && v !== '') s += String(v).toLowerCase() + '\n'; }
  row._s = s; return s;
}
function matchRow(row, toks, cols) {
  for (const t of toks) {
    let hit;
    if (t.field) hit = String(row[t.field] == null ? '' : row[t.field]).toLowerCase().includes(t.val);
    else hit = rowText(row, cols).includes(t.val);
    if (hit === t.neg) return false;
  }
  return true;
}
function highlighter(toks) {
  const words = toks.filter((t) => !t.neg && t.val.length >= 2).map((t) => t.val.replace(/^[a-z0-9_]+:/, '')).filter(Boolean);
  if (!words.length) return (s) => esc(s);
  const re = new RegExp('(' + words.sort((a, b) => b.length - a.length).map(rx).join('|') + ')', 'gi');
  return (s) => esc(s).replace(re, '<mark>$1</mark>');
}

/* ---- files ---- */
function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function csvOf(header, rows) {
  const q = (v) => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return '﻿' + [header.map(q).join(',')].concat(rows.map((r) => r.map(q).join(','))).join('\r\n');
}
function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('could not load ' + src)); document.head.appendChild(s); }); }
async function ensureXLSX() { if (!window.XLSX) { busy('Loading the spreadsheet library...'); try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); } finally { busy(false); } } return window.XLSX; }
async function xlsxDownload(name, sheets) {
  const X = await ensureXLSX(); const wb = X.utils.book_new();
  const used = new Set();
  sheets.forEach((s) => {
    let nm = String(s.name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet'; let i = 2; const base = nm;
    while (used.has(nm.toLowerCase())) nm = (base.slice(0, 28) + ' ' + i++);
    used.add(nm.toLowerCase());
    const ws = X.utils.aoa_to_sheet([s.header].concat(s.rows));
    ws['!cols'] = s.header.map((h, i) => ({ wch: Math.min(60, Math.max(10, ...[h].concat(s.rows.slice(0, 200).map((r) => r[i])).map((v) => String(v == null ? '' : v).length))) }));
    X.utils.book_append_sheet(wb, ws, nm);
  });
  X.writeFile(wb, name);
}
function pickFile(accept) { return new Promise((ok) => { const f = $('#file'); f.accept = accept || '.xlsx,.xls,.csv,.json'; f.value = ''; f.onchange = () => ok(f.files[0] || null); f.click(); }); }
async function readTable(file) {
  /* -> [{name, header, rows}] */
  const nm = file.name.toLowerCase();
  if (nm.endsWith('.json')) { const j = JSON.parse(await file.text()); return jsonToSheets(j, file.name); }
  if (nm.endsWith('.csv') || nm.endsWith('.txt')) {
    const X = await ensureXLSX(); const wb = X.read(await file.text(), { type: 'string', raw: true });
    return wb.SheetNames.map((n) => sheetToTable(X, wb.Sheets[n], n));
  }
  const X = await ensureXLSX(); const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: false, cellNF: true });
  return wb.SheetNames.map((n) => sheetToTable(X, wb.Sheets[n], n));
}
function sheetToTable(X, ws, name) {
  /* read cell by cell so Excel dates become plain text without any timezone shift */
  if (!ws || !ws['!ref']) return { name, header: [], rows: [] };
  const range = X.utils.decode_range(ws['!ref']); const aoa = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    const row = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[X.utils.encode_cell({ r: R, c: C })]; let v = '';
      if (cell && cell.v != null) {
        if (cell.t === 'n' && (cell.z && X.SSF.is_date(cell.z))) { const d = X.SSF.parse_date_code(cell.v); if (d) v = `${d.y}-${pad(d.m)}-${pad(d.d)}` + (d.H || d.M ? ` ${pad(d.H)}:${pad(d.M)}` : ''); else v = String(cell.v); }
        else if (cell.t === 'd' || cell.v instanceof Date) { const d = cell.v; v = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` + (d.getUTCHours() || d.getUTCMinutes() ? ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : ''); }
        else if (cell.t === 'n') v = Number.isInteger(cell.v) ? String(cell.v) : String(Math.round(cell.v * 1e6) / 1e6);
        else if (cell.t === 'b') v = cell.v ? 'TRUE' : 'FALSE';
        else v = String(cell.w != null && cell.t === 's' ? cell.v : cell.v).trim();
      }
      row.push(v);
    }
    aoa.push(row);
  }
  const rows = aoa.filter((r) => r.some((v) => v !== ''));
  if (!rows.length) return { name, header: [], rows: [] };
  const hi = rows.findIndex((r) => r.filter(Boolean).length >= 2);
  return { name, header: rows[hi] || [], rows: rows.slice(hi + 1) };
}

/* ---- popup menu / modal ---- */
let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; document.removeEventListener('mousedown', onMenuDoc, true); } }
function onMenuDoc(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
function menu(anchor, html, onClick) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu'; m.innerHTML = html; document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(); const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left)) + 'px';
  m.style.top = (r.bottom + h + 6 > window.innerHeight ? Math.max(6, r.top - h - 4) : r.bottom + 4) + 'px';
  m.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) { onClick(b.dataset.act, b, e); if (!b.dataset.keep) closeMenu(); } });
  menuEl = m; setTimeout(() => document.addEventListener('mousedown', onMenuDoc, true), 0);
  return m;
}
function modal(opts) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true"><div class="mh"><h3>${esc(opts.title)}</h3><button class="ib" data-x aria-label="Close">${ico('x')}</button></div><div class="mb">${opts.body}</div><div class="mf">${opts.foot || `<button class="btn" data-x>Close</button>`}</div></div>`;
  document.body.appendChild(bg);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) close(); });
  if (opts.wire) opts.wire(bg, close);
  const first = bg.querySelector('input,select,textarea,button:not([data-x])'); if (first) setTimeout(() => first.focus(), 30);
  return { el: bg, close };
}
function confirmDlg(title, text, okLabel) {
  return new Promise((ok) => modal({ title, body: `<p style="margin:0">${esc(text)}</p>`, foot: `<button class="btn" data-x>Cancel</button><button class="btn danger" data-ok>${esc(okLabel || 'Delete')}</button>`, onClose: () => ok(false), wire: (bg, close) => { bg.querySelector('[data-ok]').onclick = () => { bg.querySelector('[data-ok]').onclick = null; ok(true); close(); }; } }));
}
