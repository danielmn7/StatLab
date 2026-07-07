/*
 * data.js — Data model, clipboard/CSV parsing, and sample datasets.
 * Pure data logic (no DOM). Exposes global `DataLib`.
 */
const DataLib = (function () {
  'use strict';
  let _uid = 1;
  const uid = (p) => p + Date.now().toString(36) + '_' + (_uid++);

  class DataTable {
    constructor(type = 'column', name) {
      this.id = uid('tbl_');
      this.type = type; // 'column' | 'xy' | 'survival'
      this.name = name || defaultName(type);
      this.columns = [];
      this.rows = [];
      if (type === 'column') this.setColumns(['Group A', 'Group B']);
      else if (type === 'xy') this.setColumns(['X', 'Y']);
      else if (type === 'survival') this.setColumns(['Time', 'Status', 'Group']);
      else if (type === 'grouped') { this.groupNames = ['Group A', 'Group B']; this.nsub = 3; this.rowTitles = []; }
      this.ensureRows(type === 'grouped' ? 4 : 8);
    }

    // ----- grouped (two-way) helpers -----
    width() { return this.type === 'grouped' ? this.groupNames.length * this.nsub : this.columns.length; }
    addGroup(name) {
      this.groupNames.push(name || ('Group ' + String.fromCharCode(65 + this.groupNames.length)));
      this.rows.forEach((r) => { for (let s = 0; s < this.nsub; s++) r.push(''); });
    }
    removeGroup(i) {
      if (this.groupNames.length <= 2) return;
      this.groupNames.splice(i, 1);
      this.rows.forEach((r) => r.splice(i * this.nsub, this.nsub));
    }
    addReplicate() {
      const g = this.groupNames.length, old = this.nsub;
      this.rows = this.rows.map((row) => { const nr = []; for (let gi = 0; gi < g; gi++) { for (let s = 0; s < old; s++) nr.push(row[gi * old + s]); nr.push(''); } return nr; });
      this.nsub = old + 1;
    }
    // {rowNames, colNames, cells[i][j] = numeric replicates}; only rows with data
    cellsMatrix() {
      const g = this.groupNames.length, n = this.nsub;
      const rowIdx = [];
      this.rows.forEach((row, ri) => { if (row.some((v) => v !== '' && v != null && !Number.isNaN(Number(v)))) rowIdx.push(ri); });
      const cells = rowIdx.map((ri) => {
        const row = this.rows[ri];
        return this.groupNames.map((_, gi) => {
          const vals = [];
          for (let s = 0; s < n; s++) { const v = row[gi * n + s]; if (v !== '' && v != null && !Number.isNaN(Number(v))) vals.push(Number(v)); }
          return vals;
        });
      });
      const rowNames = rowIdx.map((ri) => (this.rowTitles[ri] && String(this.rowTitles[ri]).trim()) || ('Row ' + (ri + 1)));
      return { rowNames, colNames: this.groupNames.slice(), cells };
    }

    // Swap rows and columns of the data (Excel-style transpose).
    transpose() {
      if (this.type === 'grouped') { this._transposeGrouped(); return; }
      const nC = this.columns.length;
      let nR = 0;
      for (let r = 0; r < this.rows.length; r++) if (this.rows[r].some((v) => String(v).trim() !== '')) nR = r + 1;
      const newColCount = Math.max(1, nR);
      const get = (r, c) => (this.rows[r] && this.rows[r][c] != null ? this.rows[r][c] : '');
      const names = [];
      for (let i = 0; i < newColCount; i++) names.push(this.type === 'xy' ? (i === 0 ? 'X' : 'Y' + i) : 'Group ' + String.fromCharCode(65 + i));
      const newRows = [];
      for (let c = 0; c < nC; c++) { const row = []; for (let r = 0; r < newColCount; r++) row.push(get(r, c)); newRows.push(row); }
      this.setColumns(names);
      this.rows = newRows;
      this.ensureRows(Math.max(8, newRows.length));
    }
    // Grouped transpose = swap the row factor and the column (group) factor.
    _transposeGrouped() {
      const cm = this.cellsMatrix();
      if (!cm.cells.length) return;
      let nsub = 1;
      cm.cells.forEach((row) => row.forEach((c) => { if (c.length > nsub) nsub = c.length; }));
      const newRowNames = cm.colNames.slice();     // old groups become rows
      const newColNames = cm.rowNames.slice();      // old rows become groups
      const newCells = cm.colNames.map((_, J) => cm.rowNames.map((_, I) => cm.cells[I][J]));
      this.groupNames = newColNames;
      this.rowTitles = newRowNames;
      this.nsub = nsub;
      this.rows = newRowNames.map((_, i) => {
        const flat = [];
        newColNames.forEach((_, j) => { const reps = newCells[i][j] || []; for (let s = 0; s < nsub; s++) flat.push(reps[s] != null ? String(reps[s]) : ''); });
        return flat;
      });
      this.ensureRows(Math.max(2, this.rows.length));
    }

    setColumns(names) {
      this.columns = names.map((n, i) => ({ name: n, role: roleFor(this.type, i) }));
    }
    addColumn(name) {
      const i = this.columns.length;
      this.columns.push({ name: name || nextColName(this), role: roleFor(this.type, i) });
      this.rows.forEach((r) => r.push(''));
    }
    removeColumn(i) {
      if (this.columns.length <= 1) return;
      this.columns.splice(i, 1);
      this.rows.forEach((r) => r.splice(i, 1));
      // reassign XY/survival roles by position
      this.columns.forEach((c, idx) => { c.role = roleFor(this.type, idx); });
    }
    addRow() {
      if (this.type === 'grouped') { this.rows.push(new Array(this.width()).fill('')); this.rowTitles.push('Row ' + this.rows.length); }
      else this.rows.push(new Array(this.columns.length).fill(''));
    }
    ensureRows(n) { while (this.rows.length < n) this.addRow(); }
    ensureSize(r, c) {
      while (this.columns.length < c) this.addColumn();
      while (this.rows.length < r) this.addRow();
    }
    setCell(r, c, v) {
      if (this.type === 'grouped') { while (this.rows.length <= r) this.addRow(); if (c < this.width()) this.rows[r][c] = v; return; }
      this.ensureSize(r + 1, c + 1); this.rows[r][c] = v;
    }
    getCell(r, c) { return (this.rows[r] && this.rows[r][c] != null) ? this.rows[r][c] : ''; }

    // raw values of a column (strings), trimmed
    rawColumn(c) { return this.rows.map((r) => (r[c] == null ? '' : String(r[c]).trim())); }
    // numeric values (filtered)
    numColumn(c) {
      return this.rawColumn(c).filter((v) => v !== '' && !Number.isNaN(Number(v))).map(Number);
    }
    // is this column entirely non-numeric (categorical)?
    isCategorical(c) {
      const vals = this.rawColumn(c).filter((v) => v !== '');
      if (!vals.length) return false;
      return vals.some((v) => Number.isNaN(Number(v)));
    }
    hasData() { return this.rows.some((r) => r.some((v) => String(v).trim() !== '')); }

    // groups for column-type analyses: [{name, values:[...]}]
    groups() {
      return this.columns.map((c, i) => ({ name: c.name, values: this.numColumn(i) }))
        .filter((g) => g.values.length > 0);
    }
    // survival rows: [{time, event, group}]
    survivalRows() {
      const ti = this.columns.findIndex((c) => c.role === 'time');
      const si = this.columns.findIndex((c) => c.role === 'event');
      const gi = this.columns.findIndex((c) => c.role === 'group');
      const out = [];
      this.rows.forEach((r) => {
        const t = r[ti];
        if (t === '' || t == null || Number.isNaN(Number(t))) return;
        out.push({
          time: Number(t),
          event: si >= 0 ? (Number(r[si]) ? 1 : 0) : 1,
          group: gi >= 0 && String(r[gi]).trim() !== '' ? String(r[gi]).trim() : 'All',
        });
      });
      return out;
    }
  }

  function roleFor(type, i) {
    if (type === 'xy') return i === 0 ? 'x' : 'y';
    if (type === 'survival') return ['time', 'event', 'group'][i] || 'extra';
    return 'group';
  }
  function defaultName(type) {
    return { column: 'Column data', xy: 'XY data', survival: 'Survival data', grouped: 'Grouped data' }[type] || 'Data';
  }
  function nextColName(t) {
    if (t.type === 'column') return 'Group ' + String.fromCharCode(65 + t.columns.length);
    if (t.type === 'xy') return 'Y' + t.columns.length;
    return 'Col ' + (t.columns.length + 1);
  }

  // ---------- clipboard / CSV parsing ----------
  function parseDelimited(text) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
    if (!text.trim()) return { rows: [] };
    const lines = text.split('\n');
    const delim = detectDelimiter(lines);
    const rows = lines.map((line) => splitLine(line, delim));
    const maxCols = Math.max(...rows.map((r) => r.length));
    rows.forEach((r) => { while (r.length < maxCols) r.push(''); });
    return { rows, delim };
  }
  function detectDelimiter(lines) {
    const sample = lines.slice(0, 5).join('\n');
    const tabs = (sample.match(/\t/g) || []).length;
    const commas = (sample.match(/,/g) || []).length;
    const semis = (sample.match(/;/g) || []).length;
    if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
    if (semis > commas) return ';';
    return tabs > 0 ? '\t' : ',';
  }
  function splitLine(line, delim) {
    if (delim !== ',') return line.split(delim).map((s) => s.trim());
    // CSV with quote handling
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function looksLikeHeader(row) {
    return row.some((v) => v !== '' && Number.isNaN(Number(v)));
  }

  function tableFromParsed(parsed, type, useHeader) {
    const rows = parsed.rows.slice();
    let header = null;
    if (useHeader && rows.length) header = rows.shift();
    const ncol = Math.max(header ? header.length : 0, ...rows.map((r) => r.length), 1);
    const t = new DataTable(type);
    t.columns = [];
    for (let i = 0; i < ncol; i++) {
      const nm = header && header[i] ? header[i] : nextColNameStatic(type, i);
      t.columns.push({ name: nm, role: roleFor(type, i) });
    }
    t.rows = rows.map((r) => { const rr = r.slice(0, ncol); while (rr.length < ncol) rr.push(''); return rr; });
    t.ensureRows(Math.max(8, t.rows.length + 2));
    return t;
  }
  function groupedFromParsed(parsed, useHeader, reps) {
    reps = Math.max(1, reps || 3);
    const rows = parsed.rows.slice();
    let header = null;
    if (useHeader && rows.length) header = rows.shift();
    const totalCols = Math.max(header ? header.length : 0, ...rows.map((r) => r.length), 2);
    const dataCols = totalCols - 1; // first column holds row titles
    const g = Math.max(1, Math.ceil(dataCols / reps));
    const t = new DataTable('grouped');
    t.nsub = reps;
    t.groupNames = [];
    for (let gi = 0; gi < g; gi++) { const hc = header && header[1 + gi * reps]; t.groupNames.push(hc && String(hc).trim() ? String(hc).trim() : 'Group ' + String.fromCharCode(65 + gi)); }
    t.rowTitles = [];
    t.rows = rows.map((r) => {
      t.rowTitles.push(r[0] != null ? String(r[0]) : '');
      const flat = []; for (let c = 0; c < g * reps; c++) flat.push(r[1 + c] != null ? String(r[1 + c]) : '');
      return flat;
    });
    t.ensureRows(Math.max(2, t.rows.length));
    return t;
  }
  function nextColNameStatic(type, i) {
    if (type === 'xy') return i === 0 ? 'X' : 'Y' + i;
    if (type === 'survival') return ['Time', 'Status', 'Group'][i] || 'Col ' + (i + 1);
    return 'Group ' + String.fromCharCode(65 + i);
  }

  // ---------- sample datasets ----------
  function sample(key) {
    const mk = (type, cols, data, name) => {
      const t = new DataTable(type);
      t.name = name;
      t.columns = cols.map((c, i) => ({ name: c, role: roleFor(type, i) }));
      t.rows = data.map((r) => r.map((v) => (v == null ? '' : String(v))));
      t.ensureRows(t.rows.length + 2);
      return t;
    };
    if (key === 'twogroups') {
      return mk('column', ['Control', 'Treated'], [
        [5.1, 6.1], [4.9, 6.3], [6.2, 5.9], [5.7, 6.8], [5.5, 6.5],
        [6.0, 7.0], [5.8, 6.2], [5.4, 6.6], [5.9, 6.9], [5.6, 6.4],
      ], 'Enzyme activity: Control vs Treated');
    }
    if (key === 'threegroups') {
      return mk('column', ['Placebo', 'Low dose', 'High dose'], [
        [22, 30, 26], [24, 28, 25], [21, 31, 27], [25, 27, 24], [23, 29, 28],
        [20, 32, 26], [24, 30, 25], [22, 28, 27],
      ], 'Tumor volume: three treatments');
    }
    if (key === 'xy') {
      return mk('xy', ['Dose (mg)', 'Response'], [
        [0, 2.1], [1, 3.9], [2, 6.2], [3, 7.8], [4, 10.1],
        [5, 12.2], [6, 13.8], [7, 16.1], [8, 18.0], [9, 19.7],
      ], 'Dose–response relationship');
    }
    if (key === 'outlier') {
      return mk('column', ['Measurement'], [
        [199.31], [199.53], [200.19], [200.82], [201.92],
        [201.95], [202.18], [245.57], [200.4], [201.1],
      ], 'Replicate measurements (contains an outlier)');
    }
    if (key === 'survival') {
      const rows = [];
      const sixMP = [[6, 1], [6, 1], [6, 1], [6, 0], [7, 1], [9, 0], [10, 1], [10, 0], [11, 0], [13, 1], [16, 1], [17, 0], [19, 0], [20, 0], [22, 1], [23, 1], [25, 0], [32, 0], [32, 0], [34, 0], [35, 0]];
      const placebo = [[1, 1], [1, 1], [2, 1], [2, 1], [3, 1], [4, 1], [4, 1], [5, 1], [5, 1], [8, 1], [8, 1], [8, 1], [8, 1], [11, 1], [11, 1], [12, 1], [12, 1], [15, 1], [17, 1], [22, 1], [23, 1]];
      sixMP.forEach(([t, e]) => rows.push([t, e, '6-MP']));
      placebo.forEach(([t, e]) => rows.push([t, e, 'Placebo']));
      return mk('survival', ['Time (weeks)', 'Status', 'Group'], rows, 'Leukemia remission (6-MP vs placebo)');
    }
    if (key === 'paired') {
      return mk('column', ['Before', 'After'], [
        [120, 115], [132, 128], [125, 120], [140, 138], [128, 122],
        [135, 130], [122, 119], [130, 127], [138, 133], [126, 121],
      ], 'Blood pressure: before vs after (paired)');
    }
    if (key === 'grouped') {
      const t = new DataTable('grouped');
      t.name = 'Bacterial load: genotype × infection';
      t.groupNames = ['WT', 'RAGKO'];
      t.nsub = 6;
      t.rowTitles = ['Pre-infection', 'Post-infection'];
      const data = [
        [4.6, 4.4, 4.7, 4.5, 4.3, 4.8, 4.4, 4.6, 4.5, 4.7, 4.3, 4.5],  // Pre: WT reps | RAGKO reps
        [4.1, 4.3, 4.0, 4.2, 4.4, 4.1, 5.7, 5.9, 5.6, 6.0, 5.8, 5.5],  // Post
      ];
      t.rows = data.map((r) => r.map(String));
      t.ensureRows(t.rows.length + 1);
      return t;
    }
    return null;
  }

  const sampleList = [
    { key: 'twogroups', label: 'Two groups (t test / Mann-Whitney)', type: 'column' },
    { key: 'paired', label: 'Paired before–after', type: 'column' },
    { key: 'threegroups', label: 'Three groups (ANOVA / Kruskal-Wallis)', type: 'column' },
    { key: 'grouped', label: 'Grouped: two factors (two-way ANOVA)', type: 'grouped' },
    { key: 'xy', label: 'XY dose–response (regression)', type: 'xy' },
    { key: 'outlier', label: 'Data with an outlier (Grubbs)', type: 'column' },
    { key: 'survival', label: 'Survival curves (Kaplan-Meier)', type: 'survival' },
  ];

  function fromJSON(o) {
    const t = new DataTable(o.type || 'column');
    t.id = o.id || uid('tbl_');
    t.name = o.name;
    t.type = o.type;
    if (o.type === 'grouped') {
      t.groupNames = o.groupNames || ['Group A', 'Group B'];
      t.nsub = o.nsub || 3;
      t.rowTitles = o.rowTitles || [];
      t.columns = [];
      t.rows = (o.rows || []).map((r) => r.slice());
      if (!t.rows.length) t.ensureRows(4);
      return t;
    }
    t.columns = (o.columns || []).map((c) => ({ name: c.name, role: c.role }));
    t.rows = (o.rows || []).map((r) => r.slice());
    if (!t.rows.length) t.ensureRows(8);
    return t;
  }

  return { DataTable, parseDelimited, looksLikeHeader, tableFromParsed, groupedFromParsed, sample, sampleList, roleFor, fromJSON };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DataLib;
