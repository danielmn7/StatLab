/*
 * prism-import.js — Read GraphPad Prism ".prism" files.
 *
 * A modern .prism file is a ZIP archive (Prism 10+). Inside it:
 *   document.json                         — lists sheets and their titles
 *   data/sheets/<uid>/sheet.json          — a data table: format, dataFormat,
 *                                           replicate count, and the sets/columns it uses
 *   data/sets/<uid>.json                  — one column/group: title + which CSV columns
 *   data/tables/<uid>/data.csv            — the raw numbers (no header row)
 *   analyses/<uid>/sheet.json             — an analysis: title + which data sheet it ran on
 *   analyses/<uid>/floating_notes/*.json  — Prism's own written summary of the results
 *   info/<uid>/sheet.json                 — project info sheet (notes + constants)
 *
 * This module has two layers:
 *   - unzip()/parse()  : browser-only (uses DecompressionStream) — turns bytes into
 *                        a { path -> text } map and then interprets it.
 *   - interpret(files) : pure, no DOM/zip — maps the file map to StatLab table specs.
 *                        Kept separate so it can be unit-tested in Node.
 *
 * interpret() returns { tableSpecs, warnings } where each tableSpec is shaped for
 * DataLib.fromJSON (type, name, columns/rows or groupNames/nsub/rowTitles, notes).
 *
 * Exposes global `PrismImport`.
 */
const PrismImport = (function () {
  'use strict';

  // ============================================================= ZIP reading
  const u32 = (dv, o) => dv.getUint32(o, true);
  const u16 = (dv, o) => dv.getUint16(o, true);
  const SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;

  // Parse a ZIP archive into a Map<path, {method, comp:Uint8Array}> without
  // decompressing yet. Reads the central directory (authoritative sizes) and
  // uses each local header only to locate the start of the compressed bytes.
  function readZip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
    let eocd = -1;
    const start = Math.max(0, bytes.length - 22 - 65536);
    for (let i = bytes.length - 22; i >= start; i--) { if (u32(dv, i) === SIG_EOCD) { eocd = i; break; } }
    if (eocd < 0) throw new Error('Not a valid .prism file (no ZIP end-of-directory record).');
    const count = u16(dv, eocd + 10);
    let off = u32(dv, eocd + 16);
    const map = new Map();
    for (let i = 0; i < count && off + 46 <= bytes.length; i++) {
      if (u32(dv, off) !== SIG_CEN) break;
      const method = u16(dv, off + 10);
      const compSize = u32(dv, off + 20);
      const nameLen = u16(dv, off + 28);
      const extraLen = u16(dv, off + 30);
      const commentLen = u16(dv, off + 32);
      const localOff = u32(dv, off + 42);
      const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
      off += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue; // directory entry
      if (u32(dv, localOff) !== SIG_LOC) continue;
      const lNameLen = u16(dv, localOff + 26);
      const lExtraLen = u16(dv, localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      map.set(name, { method, comp: bytes.subarray(dataStart, dataStart + compSize) });
    }
    return map;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This environment cannot open compressed .prism files (DecompressionStream is unavailable).');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function entryBytes(rec) {
    if (rec.method === 0) return rec.comp;          // stored
    if (rec.method === 8) return inflateRaw(rec.comp); // deflate
    throw new Error('Unsupported ZIP compression method ' + rec.method + ' in .prism file.');
  }

  // Browser entry point: bytes -> { tableSpecs, warnings }
  async function parse(arrayBuffer) {
    const zip = readZip(arrayBuffer);
    const files = {};
    const decoder = new TextDecoder('utf-8');
    for (const [name, rec] of zip) {
      if (/\.(json|csv)$/i.test(name)) files[name] = decoder.decode(await entryBytes(rec));
    }
    return interpret(files);
  }

  // ============================================================= interpret (pure)
  const gj = (files, path) => { const t = files[path]; if (t == null) return null; try { return JSON.parse(t); } catch (e) { return null; } };

  // Minimal, quote-aware CSV parse (Prism data.csv has no header row).
  function csvParse(text) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
    if (text === '') return [];
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    row.push(cur); rows.push(row);
    return rows;
  }

  // A DataSet's Y-column span. Ranges look like "0~2" (inclusive). y_single sets
  // (survival, summary sub-values, plain columns) have no range — one column each.
  function setRange(set) {
    const rr = set && set['replicate ranges'];
    if (rr && rr.length) {
      let lo = Infinity, hi = -Infinity;
      rr.forEach((r) => {
        const str = (r && r.range) || '';
        const m = /(-?\d+)\s*~\s*(-?\d+)/.exec(str);        // a span, e.g. "0~2"
        if (m) { lo = Math.min(lo, +m[1]); hi = Math.max(hi, +m[2]); return; }
        const n = /(-?\d+)/.exec(str);                       // a single index, e.g. "2"
        if (n) { lo = Math.min(lo, +n[1]); hi = Math.max(hi, +n[1]); }
      });
      if (isFinite(lo)) return [lo, hi];
    }
    return null;
  }

  const FORMAT_LABEL = { xy: 'XY', grouped: 'Grouped (two-way)', column: 'Column', survival: 'Survival' };
  function prettyDataFormat(df) {
    return ({
      y_replicates: 'replicate values', y_single: 'single values', y_mean_sd_n: 'mean, SD, N', y_sd: 'mean & SD',
      y_sd_n: 'mean, SD, N', y_se: 'mean & SEM', y_se_n: 'mean, SEM, N', y_cv: 'mean & %CV', y_cv_n: 'mean, %CV, N',
      y_plus_minus: 'mean ± error', y_high_low: 'mean with high/low', y_upper_lower_limits: 'value with upper/lower limits',
    })[df] || (df || '').replace(/^y_/, '').replace(/_/g, ' ');
  }
  // Prism stores line breaks in note text as \r; normalise and drop help links.
  function cleanText(s) {
    return String(s).replace(/\r\n?/g, '\n').replace(/[ \t]*Learn more[ \t]*$/gim, '').split('\n').map((l) => l.trim()).filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n').trim();
  }

  // Collect analyses so their titles + Prism's result notes can be attached to
  // the data table they ran on (matched via inputSheets uid).
  function collectAnalyses(files, doc) {
    const uids = (doc && doc.sheets && doc.sheets.analyses) || [];
    return uids.map((uid) => {
      const sh = gj(files, 'analyses/' + uid + '/sheet.json');
      if (!sh) return null;
      const inputUids = (sh.inputSheets || []).map((s) => s && s.uid).filter(Boolean);
      const notes = [];
      Object.keys(files).forEach((p) => {
        if (p.indexOf('analyses/' + uid + '/floating_notes/') === 0 && p.endsWith('.json')) {
          const fn = gj(files, p); const str = fn && fn.text && fn.text.string;
          if (str) notes.push(cleanText(str));
        }
      });
      if (!notes.length && sh.alertText) notes.push(cleanText(sh.alertText));
      return { uid, title: sh.title || 'Analysis', inputUids, noteText: notes.join('\n') };
    }).filter(Boolean);
  }

  // A short project-info block (experiment date, filled-in constants, free notes).
  function collectProjectInfo(files, doc) {
    const uids = (doc && doc.sheets && doc.sheets.info) || [];
    const blocks = [];
    uids.forEach((uid) => {
      const sh = gj(files, 'info/' + uid + '/sheet.json'); if (!sh) return;
      const lines = [];
      (sh.constants || []).forEach((c) => { if (c && c.name && String(c.value).trim() !== '') lines.push(c.name + ': ' + c.value); });
      const notes = cleanText(sh.notesText || '');
      if (notes) lines.push(notes);
      if (lines.length) blocks.push(lines.join('\n'));
    });
    return blocks.join('\n');
  }

  // Assign each Y dataSet an absolute [lo,hi] Y-column span. Prism stores each
  // set's range RELATIVE to itself (e.g. every group says "0~2"), so the range
  // only tells us the WIDTH — absolute positions come from laying sets out
  // left-to-right with a running cursor.
  function spanSets(dataSets, defaultWidth) {
    let cursor = 0;
    return dataSets.map((s, i) => {
      const rg = setRange(s);
      const width = Math.max(1, rg ? (rg[1] - rg[0] + 1) : (defaultWidth || 1));
      const lo = cursor, hi = cursor + width - 1;
      cursor = hi + 1;
      return { set: s, i, lo, hi };
    });
  }

  function buildTableSpec(uid, sheet, files, warnings) {
    const table = sheet.table;
    const fmt = table.format;
    const name = sheet.title || 'Data';
    const rows = csvParse(files['data/tables/' + table.uid + '/data.csv'] || '');
    const cell = (r, c) => { const row = rows[r]; const v = row && row[c]; return v == null ? '' : String(v).trim(); };

    const rtCols = table.rowTitlesDataSet ? 1 : 0;
    const hasX = !!table.xDataSet;
    const xCol = hasX ? rtCols : -1;
    const leading = rtCols + (hasX ? 1 : 0);
    const dataSets = (table.dataSets || []).map((id) => gj(files, 'data/sets/' + id + '.json')).filter(Boolean);
    const nsub = Math.max(1, table.replicatesCount || 1);
    const spans = spanSets(dataSets, fmt === 'grouped' ? nsub : 1);
    const isRep = table.dataFormat === 'y_replicates';

    // trailing rows that are entirely empty add nothing — find last meaningful row
    let lastRow = -1;
    for (let r = 0; r < rows.length; r++) if (rows[r].some((v) => String(v).trim() !== '')) lastRow = r;
    const nRows = lastRow + 1;

    if (fmt === 'grouped') {
      const groupNames = spans.map((sp, i) => (sp.set.title || ('Group ' + String.fromCharCode(65 + i))));
      const rowTitles = [];
      const out = [];
      for (let r = 0; r < nRows; r++) {
        rowTitles.push(rtCols ? cell(r, 0) : '');
        const flat = [];
        spans.forEach((sp) => { for (let s = 0; s < nsub; s++) flat.push(cell(r, leading + sp.lo + s)); });
        out.push(flat);
      }
      return { type: 'grouped', name, groupNames, nsub, rowTitles, rows: out };
    }

    if (fmt === 'xy') {
      const xName = (hasX && gj(files, 'data/sets/' + table.xDataSet + '.json') || {}).title || 'X';
      const cols = [{ name: xName, role: 'x' }].concat(spans.map((sp, i) => ({ name: sp.set.title || ('Y' + (i + 1)), role: 'y' })));
      const out = [];
      for (let r = 0; r < nRows; r++) {
        const xv = cell(r, xCol < 0 ? 0 : xCol);
        const ys = spans.map((sp) => {
          if (isRep) { // average the replicates for one Y value per point
            const vals = [];
            for (let c = sp.lo; c <= sp.hi; c++) { const v = cell(r, leading + c); if (v !== '' && !Number.isNaN(Number(v))) vals.push(Number(v)); }
            if (!vals.length) return '';
            return String(+(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(6));
          }
          return cell(r, leading + sp.lo); // summary format: first sub-column is the central value
        });
        out.push([xv].concat(ys));
      }
      return { type: 'xy', name, columns: cols, rows: out };
    }

    if (fmt === 'survival') {
      // Long format: one row per subject. Time is X; each Y group column holds a
      // status code (1 = event/death, 0 = censored) for subjects in that group.
      const out = [];
      spans.forEach((sp) => {
        const group = sp.set.title || 'Group';
        for (let r = 0; r < nRows; r++) {
          const status = cell(r, leading + sp.lo);
          if (status === '') continue;
          const t = cell(r, xCol < 0 ? 0 : xCol);
          if (t === '') continue;
          out.push([t, status, group]);
        }
      });
      return { type: 'survival', name, columns: [{ name: 'Time', role: 'time' }, { name: 'Status', role: 'event' }, { name: 'Group', role: 'group' }], rows: out };
    }

    // Column table (and any unrecognised format): each dataSet is a group column;
    // stack its column(s) into one list of values.
    if (fmt !== 'column') warnings.push('Table "' + name + '" uses an unfamiliar Prism format ("' + fmt + '"); imported its columns as column data.');
    const cols = spans.map((sp, i) => ({ name: sp.set.title || ('Group ' + String.fromCharCode(65 + i)), role: 'group' }));
    const colValues = spans.map((sp) => {
      const vals = [];
      for (let r = 0; r < nRows; r++) for (let c = sp.lo; c <= sp.hi; c++) { const v = cell(r, leading + c); if (v !== '') vals.push(v); }
      return vals;
    });
    const maxLen = Math.max(1, ...colValues.map((v) => v.length));
    const out = [];
    for (let r = 0; r < maxLen; r++) out.push(colValues.map((v) => (v[r] != null ? v[r] : '')));
    return { type: 'column', name, columns: cols.length ? cols : [{ name: 'Group A', role: 'group' }], rows: out };
  }

  function buildNotes(uid, sheet, analyses, projectInfo) {
    const table = sheet.table;
    const L = ['━━ Imported from GraphPad Prism ━━'];
    let desc = 'Table type: ' + (FORMAT_LABEL[table.format] || table.format || 'Data');
    if (table.dataFormat) desc += ' · ' + prettyDataFormat(table.dataFormat);
    if (table.replicatesCount > 1 && table.dataFormat === 'y_replicates') desc += ' · ' + table.replicatesCount + ' replicates';
    L.push(desc);

    const linked = analyses.filter((a) => a.inputUids.indexOf(uid) >= 0);
    linked.forEach((a) => {
      L.push('');
      L.push('• Analysis run in Prism: ' + a.title);
      if (a.noteText) a.noteText.split('\n').forEach((t) => L.push('  ' + t));
    });
    if (table.format === 'xy' && table.dataFormat && table.dataFormat !== 'y_replicates') {
      L.push('');
      L.push('(This Prism table stored summarized values (' + prettyDataFormat(table.dataFormat) + '); StatLab imported the central value for each point.)');
    }
    if (projectInfo) { L.push(''); L.push('Project info:'); projectInfo.split('\n').forEach((t) => L.push('  ' + t)); }
    L.push('');
    L.push('─── Your notes ───');
    L.push('');
    return L.join('\n');
  }

  function interpret(files) {
    const warnings = [];
    const doc = gj(files, 'document.json');
    let dataUids = (doc && doc.sheets && doc.sheets.data) || [];
    if (!dataUids.length) { // fall back to scanning for data sheets if document.json is absent/odd
      const seen = {};
      Object.keys(files).forEach((p) => { const m = /^data\/sheets\/([^/]+)\/sheet\.json$/.exec(p); if (m) seen[m[1]] = 1; });
      dataUids = Object.keys(seen);
    }
    const analyses = collectAnalyses(files, doc);
    const projectInfo = collectProjectInfo(files, doc);
    const tableSpecs = [];
    dataUids.forEach((uid) => {
      const sheet = gj(files, 'data/sheets/' + uid + '/sheet.json');
      if (!sheet || !sheet.table || !sheet.table.uid) return;
      try {
        const spec = buildTableSpec(uid, sheet, files, warnings);
        spec.notes = buildNotes(uid, sheet, analyses, tableSpecs.length === 0 ? projectInfo : '');
        tableSpecs.push(spec);
      } catch (e) {
        warnings.push('Could not import table "' + (sheet.title || uid) + '": ' + (e && e.message || e));
      }
    });
    if (!tableSpecs.length) warnings.push('No data tables were found in this .prism file.');
    return { tableSpecs, warnings };
  }

  return { parse, interpret, readZip, entryBytes, _csvParse: csvParse };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PrismImport;
