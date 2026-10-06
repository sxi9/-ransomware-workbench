# Samurai Scan

One self-contained HTML workbench that merges the ransomware ledger, the Needles tracker and the
Needle assignments workbook into a single searchable, editable database.

Two ready-to-use pages live in `dist/`:

* **`samurai_scan_workbench.html`**: the data is packed inside (ledger, Needles, assignments as of the
  build date). Open it and work. **Data** in the top bar merges newer files in without a rebuild.
* **`samurai_scan_standalone.html`**: no data inside. Open it, drop in your CSV or Excel files (ledger
  export, Needles tracker, Needle assignments, or exports from either page) and start working. The
  files are remembered in your browser; **Data** in the top bar adds, replaces or removes them.

Both need nothing else: the spreadsheet library is inside the page, so they work offline. All edits
and log entries stay in your browser; use **Backup** in the top bar to download them or move them to
another computer. The two pages keep separate storage, so you can use both side by side.

## Tabs

| Tab | What is in it |
| --- | --- |
| Today | New victims, groups posting, Needles published or republished, and your log entries for any day. Click a number to open the rows. |
| Mixed database | One row per ledger victim joined with its Needle (analyst, republish status, dates, Wagtail and live links) and its group's onion site, collector, status and priority. Needles without a ledger victim appear as "Needle only". |
| Victims | The full ransomware ledger with the group onion site and leak-site claim URL in every row. |
| Needles | Every row of every tracker sheet (FY27, FY26, previous entries, CVEs, profiles, monthly reports). |
| Groups & leak sites | Every group with onion address, mirrors, private negotiation pages, assigned collector, analyst, type, priority and live victim and Needle counts. |
| Sheets | All 24 original tabs of both workbooks, untouched, each searchable and editable. |
| Investigator | Your daily log: new victims, updates, republishes, leak-site changes, notes. "Log an update" on any row pre-fills the form. |

## Search, edit, export

* Each tab has its own search box. Every word you type must appear somewhere in the row.
  `"exact phrase"`, `-word` to exclude, `column:value` to search one column (`group:qilin country:US`).
  Dropdown filters and the date range combine with the search. Press `/` to focus the search.
* Double-click a cell to edit it. Click a row for the detail panel with every field, copy buttons and
  related rows. Select rows to copy, export or delete them. Undo is in the toolbar (Ctrl+Z).
* Export gives Excel, CSV or JSON of what you see, or the whole database as one workbook.
  Import merges rows from Excel, CSV or JSON with a column mapping; duplicates are skipped.
* `.onion` addresses carry a TOR tag: click to copy, then open in Tor Browser.

## Rebuilding with new data

```
pip install openpyxl
python3 build/build.py
```

Inputs live in `data/`: `ledger_seed.json.gz` (victims and groups), `Needles_Tracker_from_2025.xlsx`
and `Needle_Assignments.xlsx`. Replace them and rebuild; then restore your backup in the new file.
The build matches Needles to ledger victims by group and name, folds every assignment sheet into the
groups table, and inlines `src/app.html`, `src/js/*.js` and `vendor/xlsx.full.min.js` with the
gzip-packed data. The same matching and folding logic runs in the browser (`src/js/15_merge.js`) for
files loaded into either page, so the standalone page does not need the build at all.
