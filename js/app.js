/*
 * app.js — StatLab application controller.
 */
(function () {
  'use strict';
  const C = StatCore, T = StatTests, N = StatNorm, S = Survival, D = DataLib, G = Guidance;

  // ---------- formatting helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
  }
  function num(v, d = 4) {
    if (v == null || Number.isNaN(v)) return '—';
    if (!isFinite(v)) return v > 0 ? '∞' : '−∞';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-4)) return v.toExponential(2);
    return (+v.toFixed(d)).toString();
  }
  function fmtP(p) {
    if (p == null || Number.isNaN(p)) return '—';
    if (p < 0.0001) return '< 0.0001';
    if (p > 0.9999) return '> 0.9999';
    return p.toFixed(4);
  }
  function stars(p) { return p < 0.0001 ? '****' : p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : 'ns'; }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2400);
  }
  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- state ----------
  const App = {
    tables: [], results: [], graphs: [],
    active: null, // {view:'data'|'result'|'graph', id}
    counter: 1,
    projectFileName: null,  // display name of the open project file, or null when unsaved
    projectFileHandle: null, // File System Access handle (browser) so Save can overwrite
  };
  function activeObj() {
    if (!App.active) return null;
    const list = App.active.view === 'data' ? App.tables : App.active.view === 'result' ? App.results : App.graphs;
    return list.find((x) => x.id === App.active.id);
  }
  function tableById(id) { return App.tables.find((t) => t.id === id); }
  function setActive(view, id) { App.active = { view, id }; renderNavigator(); renderContent(); }

  // Data edits must invalidate every graph/result derived from the edited table.
  // Visual controls are intentionally preserved while data-derived fields (means,
  // curves, regression and significance values) are rebuilt from the source table.
  const LINKED_VISUAL_OPTIONS = ['title', 'xLabel', 'yLabel', 'percent', 'atRisk', 'showCI', 'showPoints', 'errorType', 'colors', 'paletteId', 'barBorder', 'barWidth', 'markers', 'marker', 'pointColor', 'pointMarkers', 'fontStyle', 'sigStyle', 'legendPosition', 'yAxis', 'xAxis'];
  function compatibleChartType(current, fresh) {
    const families = {
      grouped: ['grouped', 'grouped-line'],
      bar: ['bar', 'dot', 'box'],
      paired: ['paired', 'bar', 'dot', 'box'],
    };
    const family = families[fresh];
    return family && family.includes(current) ? current : fresh;
  }
  function mergeLinkedGraphSpec(graph, fresh) {
    const old = graph.spec || {}, oldOpts = old.opts || {}, nextOpts = Object.assign({}, fresh.opts || {});
    LINKED_VISUAL_OPTIONS.forEach((key) => { if (oldOpts[key] !== undefined) nextOpts[key] = oldOpts[key]; });
    graph.spec = Object.assign({}, fresh, { chartType: compatibleChartType(old.chartType, fresh.chartType), opts: nextOpts });
  }
  function refreshLinkedGraphs(table) {
    const tableResults = App.results.filter((r) => r.tableId === table.id);
    const resultGraphIds = new Set();
    tableResults.forEach((result) => {
      let computed;
      try { computed = compute(table, result.spec); }
      catch (err) {
        result.html = el('div', { class: 'note' }, 'Could not recompute this result after the data changed: ' + err.message);
        return;
      }
      result.html = computed.html;
      if (result.graphId && computed.graphSpec) {
        const graph = App.graphs.find((g) => g.id === result.graphId);
        if (graph) { mergeLinkedGraphSpec(graph, computed.graphSpec); resultGraphIds.add(graph.id); }
      }
    });
    App.graphs.filter((g) => g.tableId === table.id && !resultGraphIds.has(g.id) && !tableResults.some((r) => r.graphId === g.id)).forEach((graph) => {
      try { mergeLinkedGraphSpec(graph, makeQuickGraphSpec(table)); }
      catch (err) { /* keep the last valid graph while the source is temporarily invalid */ }
    });
  }
  function tableChanged(table, rerender = false) {
    refreshLinkedGraphs(table);
    renderNavigator();
    saveState();
    const active = App.active;
    const activeSource = active && ((active.view === 'graph' && App.graphs.some((g) => g.id === active.id && g.tableId === table.id)) || (active.view === 'result' && App.results.some((r) => r.id === active.id && r.tableId === table.id)));
    if (rerender || activeSource) renderContent();
  }

  // ---------- navigator ----------
  function renderNavigator() {
    const mk = (item, view, icon) => {
      const isTable = view === 'data';
      const hasGraph = isTable && App.graphs.some((g) => g.tableId === item.id);
      return el('li', {
        class: 'nav-item' + (App.active && App.active.view === view && App.active.id === item.id ? ' active' : ''),
        title: 'Right-click for options',
        onclick: () => setActive(view, item.id),
        oncontextmenu: (e) => navContextMenu(e, item, view),
      }, el('span', { class: 'ico' }, icon), item.name,
        hasGraph ? el('span', { class: 'graph-status', title: 'This table has a graph' }, '✓') : null);
    };
    const tl = $('#nav-tables'); tl.innerHTML = '';
    if (!App.tables.length) tl.append(el('li', { class: 'nav-empty' }, 'No tables yet'));
    App.tables.forEach((t) => tl.append(mk(t, 'data', t.type === 'survival' ? '⏱️' : t.type === 'xy' ? '📈' : '▦')));
    const rl = $('#nav-results'); rl.innerHTML = '';
    if (!App.results.length) rl.append(el('li', { class: 'nav-empty' }, 'No results yet'));
    App.results.forEach((r) => rl.append(mk(r, 'result', '∑')));
    const gl = $('#nav-graphs'); gl.innerHTML = '';
    if (!App.graphs.length) gl.append(el('li', { class: 'nav-empty' }, 'No graphs yet'));
    App.graphs.forEach((g) => gl.append(mk(g, 'graph', '◧')));
  }

  // ---------- content dispatch ----------
  function renderContent() {
    const c = $('#content'); c.innerHTML = '';
    if (!App.active) { c.append(emptyState()); return; }
    if (App.active.view === 'data') renderDataView(c, activeObj());
    else if (App.active.view === 'result') renderResultView(c, activeObj());
    else renderGraphView(c, activeObj());
  }
  function emptyState() {
    return el('div', { class: 'empty-state' },
      el('div', { class: 'es-ico' }, '📊'),
      el('h2', {}, 'Welcome to StatLab'),
      el('div', {}, 'Create a data table, import from Excel/CSV, or load an example to get started.'),
      el('div', { style: 'margin-top:18px;display:flex;gap:10px;justify-content:center' },
        el('button', { class: 'btn btn-accent', onclick: () => loadExample('twogroups') }, 'Load an example'),
        el('button', { class: 'btn', onclick: newTable }, '＋ New table'),
        el('button', { class: 'btn', onclick: openImport }, '⇪ Import data')));
  }

  // ---------- data view ----------
  function renderDataView(root, table) {
    if (!table) return;
    const head = el('div', { class: 'view-head' });
    const titleInput = el('input', {
      value: table.name, oninput: (e) => { table.name = e.target.value; tableChanged(table); },
    });
    head.append(el('h1', { class: 'view-title' }, titleInput));
    const typeLabels = { column: 'Column data', xy: 'XY data', survival: 'Survival data', grouped: 'Grouped data' };
    head.append(el('span', { class: 'badge' }, typeLabels[table.type] || 'Data'));

    const typeSel = el('select', { class: 'inp', onchange: (e) => changeType(table, e.target.value) },
      ...['column', 'grouped', 'xy', 'survival'].map((t) => el('option', { value: t, selected: table.type === t }, { column: 'Column (groups)', grouped: 'Grouped (two-way)', xy: 'XY (correlation)', survival: 'Survival' }[t])));
    const actions = el('div', { class: 'view-actions' },
      el('span', { class: 'muted', style: 'align-self:center;font-size:12px' }, 'Type:'), typeSel,
      el('button', { class: 'btn btn-accent', onclick: () => openAnalyze(table) }, '∑ Analyze'),
      el('button', { class: 'btn', onclick: () => quickGraph(table) }, '◧ Graph'),
      el('button', { class: 'btn btn-ghost', title: 'Delete this table and its analyses and graphs', onclick: () => deleteTable(table.id) }, '🗑 Delete'));
    head.append(actions);
    root.append(head);

    root.append(el('div', { class: 'tip' }, '💡',
      table.type === 'survival'
        ? el('span', {}, 'Each row is one subject. ', el('b', {}, 'Time'), ' = follow-up time, ', el('b', {}, 'Status'), ' = 1 for event/death or 0 for censored, ', el('b', {}, 'Group'), ' = treatment label. Paste from Excel with Ctrl+V.')
        : table.type === 'xy'
          ? el('span', {}, 'First column is ', el('b', {}, 'X'), '; the next column is ', el('b', {}, 'Y'), '. Paste from Excel/CSV with Ctrl+V.')
          : table.type === 'grouped'
            ? el('span', {}, 'A ', el('b', {}, 'two-factor'), ' layout: each ', el('b', {}, 'row'), ' is one level of the first factor (e.g. time), each ', el('b', {}, 'column group'), ' is a level of the second factor (e.g. genotype), and the ', el('b', {}, 'side-by-side subcolumns'), ' are replicates. Runs a two-way ANOVA.')
            : el('span', {}, 'Each column is a group/condition; each row is a replicate. ', el('b', {}, 'Paste from Excel or CSV with Ctrl+V'), ' — empty cells are ignored.')));

    const sheetCol = el('div', { class: 'sheet-col' });
    sheetCol.append(buildSheet(table));

    const tools = el('div', { class: 'grid-tools' },
      el('button', { class: 'btn btn-sm', onclick: () => { table.addRow(); tableChanged(table, true); } }, '＋ Row'),
      table.type === 'grouped'
        ? el('button', { class: 'btn btn-sm', onclick: () => { table.addGroup(); tableChanged(table, true); } }, '＋ Group')
        : el('button', { class: 'btn btn-sm', onclick: () => { table.addColumn(); tableChanged(table, true); } }, '＋ Column'),
      table.type === 'grouped'
        ? el('button', { class: 'btn btn-sm', onclick: () => { table.addReplicate(); tableChanged(table, true); } }, '＋ Replicate')
        : null,
      table.type !== 'survival'
        ? el('button', { class: 'btn btn-sm', title: 'Swap rows and columns', onclick: () => { table.transpose(); tableChanged(table, true); toast('Transposed rows ↔ columns'); } }, '⇄ Transpose')
        : null,
      el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { table.rows.forEach((r) => r.fill('')); tableChanged(table, true); toast('Cleared'); } }, 'Clear data'));
    sheetCol.append(tools);
    if (table.type !== 'survival') sheetCol.append(el('div', { class: 'note', style: 'margin-top:6px;font-size:11.5px' }, 'Tip: paste with Ctrl+V, or Ctrl+Shift+V to paste transposed. Use ⇄ Transpose to flip existing data.'));

    root.append(el('div', { class: 'data-body' }, buildNotesPanel(table), sheetCol));
  }

  // ---------- per-dataset notes panel (left of the sheet) ----------
  let notesCollapsed = false;
  function buildNotesPanel(table) {
    if (notesCollapsed) {
      return el('div', { class: 'notes-panel collapsed' },
        el('button', { class: 'notes-showbtn', title: 'Show notes', onclick: () => { notesCollapsed = false; renderContent(); } }, '📝'));
    }
    const ta = el('textarea', {
      class: 'notes-area', spellcheck: 'true',
      placeholder: 'Notes for this dataset…\n\nRecord observations, methods, or context here. Opening a .prism file drops what Prism recorded (which tests were run and their results) into this space automatically — then you can add your own notes below it.',
      oninput: (e) => { table.notes = e.target.value; saveState(); },
    });
    ta.value = table.notes || '';
    return el('div', { class: 'notes-panel' },
      el('div', { class: 'notes-head' },
        el('span', { class: 'notes-title' }, '📝 Notes'),
        el('button', { class: 'notes-collapse', title: 'Hide notes', onclick: () => { notesCollapsed = true; renderContent(); } }, '⟨ Hide')),
      ta);
  }

  function changeType(table, type) {
    const prev = table.type;
    table.type = type;
    if (type === 'grouped') {
      if (!table.groupNames) { table.groupNames = ['Group A', 'Group B']; table.nsub = 3; table.rowTitles = []; }
      // reshape existing rows to the grouped width
      const w = table.width();
      table.rows = table.rows.map((r) => { const nr = r.slice(0, w); while (nr.length < w) nr.push(''); return nr; });
      table.ensureRows(Math.max(2, table.rows.length));
    } else {
      if (prev === 'grouped') {
        table.setColumns(type === 'xy' ? ['X', 'Y'] : type === 'survival' ? ['Time', 'Status', 'Group'] : ['Group A', 'Group B']);
        const w = table.columns.length; // keep row width in sync with the new column count
        table.rows = table.rows.map((r) => { const nr = r.slice(0, w); while (nr.length < w) nr.push(''); return nr; });
      }
      if (type === 'xy' && table.columns.length < 2) table.setColumns(['X', 'Y']);
      if (type === 'survival' && table.columns.length < 3) table.setColumns(['Time', 'Status', 'Group']);
      table.columns.forEach((c, i) => { c.role = D.roleFor(type, i); });
    }
    renderContent(); tableChanged(table);
  }

  // ---------- spreadsheet grid (selection, drag, copy/paste, edit-in-place) ----------
  let pendingSel = null; // {tableId, sel, active} restored across structural re-renders
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rectOf = (a, b) => ({ r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) });

  function columnHeader(table) {
    const thead = el('thead'); const hr = el('tr');
    hr.append(el('th', { class: 'rowhead' }, '#'));
    table.columns.forEach((col, ci) => {
      const roleLabel = table.type === 'xy' ? (col.role === 'x' ? 'X' : 'Y' + ci) : table.type === 'survival' ? col.role : '';
      const nameInput = el('input', { class: 'colname', value: col.name, title: 'Click to rename this column (right-click for options)',
        onfocus: (e) => { e.target.dataset.orig = col.name; },
        oninput: (e) => { col.name = e.target.value; tableChanged(table); },
        onchange: (e) => { const orig = e.target.dataset.orig; if (orig != null && orig !== col.name) { propagateColumnRename(table, orig, col.name, ci); saveState(); } },
        ondblclick: (e) => e.target.select() });
      nameInput.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        const items = [{ label: '✎ Rename', onClick: () => { nameInput.focus(); nameInput.select(); } }];
        if (table.columns.length > 1) items.push({ sep: true }, { label: '🗑 Delete column', danger: true, onClick: () => { if (confirm('Delete column "' + col.name + '"?')) { table.removeColumn(ci); tableChanged(table, true); } } });
        showContextMenu(e.clientX, e.clientY, items);
      });
      const colhead = el('div', { class: 'colhead' }, nameInput);
      if (roleLabel) colhead.append(el('div', { class: 'colrole' }, roleLabel));
      const th = el('th', {}, colhead);
      if (table.columns.length > 1) {
        th.append(el('button', { class: 'coldel', title: 'Delete this column', tabindex: '-1',
          onclick: () => { if (confirm('Delete column "' + col.name + '"?')) { table.removeColumn(ci); tableChanged(table, true); } } }, '×'));
      }
      hr.append(th);
    });
    thead.append(hr); return thead;
  }
  function groupedHeader(table) {
    const n = table.nsub, g = table.groupNames.length;
    const thead = el('thead');
    const hr1 = el('tr');
    hr1.append(el('th', { class: 'rowhead', rowspan: 2 }, '#'));
    hr1.append(el('th', { rowspan: 2, class: 'rowtitle-head' }, el('div', { class: 'colrole', style: 'padding:6px 8px' }, 'Row factor')));
    table.groupNames.forEach((gn, gi) => {
      const gInput = el('input', { class: 'colname', value: gn, title: 'Click to rename this group (right-click for options)',
        onfocus: (e) => { e.target.dataset.orig = table.groupNames[gi]; },
        oninput: (e) => { table.groupNames[gi] = e.target.value; tableChanged(table); },
        onchange: (e) => { const orig = e.target.dataset.orig; if (orig != null && orig !== table.groupNames[gi]) { propagateGroupedRename(table, orig, table.groupNames[gi]); saveState(); } },
        ondblclick: (e) => e.target.select() });
      gInput.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        const items = [{ label: '✎ Rename', onClick: () => { gInput.focus(); gInput.select(); } }];
        if (g > 2) items.push({ sep: true }, { label: '🗑 Delete group', danger: true, onClick: () => { if (confirm('Delete group "' + table.groupNames[gi] + '"?')) { table.removeGroup(gi); tableChanged(table, true); } } });
        showContextMenu(e.clientX, e.clientY, items);
      });
      const th = el('th', { colspan: n, style: 'text-align:center' }, gInput);
      if (g > 2) {
        th.append(el('button', { class: 'coldel', title: 'Delete this group', tabindex: '-1',
          onclick: () => { if (confirm('Delete group "' + gn + '"?')) { table.removeGroup(gi); tableChanged(table, true); } } }, '×'));
      }
      hr1.append(th);
    });
    thead.append(hr1);
    const hr2 = el('tr');
    for (let gi = 0; gi < g; gi++) for (let s = 0; s < n; s++) hr2.append(el('th', { class: 'colrole subhead' }, String(s + 1)));
    thead.append(hr2);
    return thead;
  }

  function buildSheet(table) {
    const grouped = table.type === 'grouped';
    const dataCols = grouped ? table.groupNames.length * table.nsub : table.columns.length;
    const wrap = el('div', { class: 'grid-wrap sheet-wrap', tabindex: '0' });
    const tbl = el('table', { class: 'grid sheet' });
    tbl.append(grouped ? groupedHeader(table) : columnHeader(table));
    const tbody = el('tbody');
    table.rows.forEach((row, ri) => {
      const tr = el('tr');
      tr.append(el('td', { class: 'rowhead' }, String(ri + 1)));
      if (grouped) {
        tr.append(el('td', { class: 'cat rowtitle' },
          el('input', { class: 'titleinput', value: table.rowTitles[ri] || '', placeholder: 'Row ' + (ri + 1), oninput: (e) => { table.rowTitles[ri] = e.target.value; tableChanged(table); } })));
      }
      for (let c = 0; c < dataCols; c++) {
        const td = el('td', { class: 'dcell', 'data-r': ri, 'data-c': c });
        td.append(el('div', { class: 'cellval' }, row[c] == null ? '' : String(row[c])));
        tr.append(td);
      }
      tbody.append(tr);
    });
    tbl.append(tbody);
    wrap.append(tbl);
    const ctrl = new SheetController(wrap, tbl, table, dataCols);
    if (pendingSel && pendingSel.tableId === table.id) { ctrl.restore(pendingSel); pendingSel = null; }
    return wrap;
  }

  class SheetController {
    constructor(wrap, tbl, table, dataCols) {
      this.wrap = wrap; this.tbl = tbl; this.table = table; this.cols = dataCols; this.nrows = table.rows.length;
      this.sel = null; this.active = null; this.anchor = null; this.dragging = false; this.editing = false;
      wrap.addEventListener('mousedown', (e) => this.onMouseDown(e));
      wrap.addEventListener('mouseover', (e) => this.onMouseOver(e));
      wrap.addEventListener('dblclick', (e) => { const td = this.tdFrom(e); if (td) { this.active = this.coords(td); this.enterEdit(null); } });
      wrap.addEventListener('keydown', (e) => this.onKeyDown(e));
      wrap.addEventListener('copy', (e) => this.onCopy(e, false));
      wrap.addEventListener('cut', (e) => this.onCopy(e, true));
      wrap.addEventListener('paste', (e) => this.onPaste(e));
      this._up = () => { this.dragging = false; document.removeEventListener('mouseup', this._up); };
    }
    cellTd(r, c) { return this.tbl.querySelector(`td.dcell[data-r="${r}"][data-c="${c}"]`); }
    tdFrom(e) { const td = e.target.closest && e.target.closest('td.dcell'); return td && this.tbl.contains(td) ? td : null; }
    coords(td) { return { r: +td.dataset.r, c: +td.dataset.c }; }
    highlight() {
      const s = this.sel, a = this.active;
      this.tbl.querySelectorAll('td.dcell').forEach((td) => {
        const r = +td.dataset.r, c = +td.dataset.c;
        td.classList.toggle('sel', !!(s && r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2));
        td.classList.toggle('active', !!(a && a.r === r && a.c === c));
      });
    }
    scrollTo(r, c) { const td = this.cellTd(r, c); if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    onMouseDown(e) {
      const td = this.tdFrom(e); if (!td) return;
      if (this.editing) this.commitEdit();
      e.preventDefault(); this.wrap.focus();
      const cell = this.coords(td); this.active = cell;
      if (e.shiftKey && this.anchor) this.sel = rectOf(this.anchor, cell);
      else { this.anchor = cell; this.sel = { r1: cell.r, c1: cell.c, r2: cell.r, c2: cell.c }; }
      this.dragging = true; document.addEventListener('mouseup', this._up); this.highlight();
    }
    onMouseOver(e) {
      if (!this.dragging) return;
      const td = this.tdFrom(e); if (!td) return;
      const cell = this.coords(td); this.active = cell; this.sel = rectOf(this.anchor, cell); this.highlight();
    }
    onKeyDown(e) {
      if (e.target.tagName === 'INPUT') return; // typing in column-name / row-title inputs
      if (!this.active) { this.active = { r: 0, c: 0 }; this.anchor = this.active; }
      const k = e.key;
      if (e.ctrlKey || e.metaKey) {
        if (k === 'a' || k === 'A') { e.preventDefault(); this.selectAll(); }
        else if ((k === 'v' || k === 'V') && e.shiftKey) { e.preventDefault(); this.pasteTransposed(); }
        return;
      }
      if (k === 'ArrowUp') { e.preventDefault(); this.moveOrExtend(-1, 0, e.shiftKey); }
      else if (k === 'ArrowDown') { e.preventDefault(); this.moveOrExtend(1, 0, e.shiftKey); }
      else if (k === 'ArrowLeft') { e.preventDefault(); this.moveOrExtend(0, -1, e.shiftKey); }
      else if (k === 'ArrowRight') { e.preventDefault(); this.moveOrExtend(0, 1, e.shiftKey); }
      else if (k === 'Enter') { e.preventDefault(); this.move(1, 0); }
      else if (k === 'Tab') { e.preventDefault(); this.move(0, e.shiftKey ? -1 : 1); }
      else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.clearSel(); }
      else if (k === 'F2') { e.preventDefault(); this.enterEdit(null); }
      else if (k.length === 1 && !e.altKey) { e.preventDefault(); this.enterEdit(k); }
    }
    move(dr, dc) {
      let r = this.active.r + dr, c = clamp(this.active.c + dc, 0, this.cols - 1);
      if (r < 0) r = 0;
      if (r > this.nrows - 1) { this.table.addRow(); this.rerenderKeep({ r, c }); return; }
      this.active = { r, c }; this.anchor = { r, c }; this.sel = { r1: r, c1: c, r2: r, c2: c }; this.highlight(); this.scrollTo(r, c);
    }
    moveOrExtend(dr, dc, shift) {
      if (!shift) return this.move(dr, dc);
      const r = clamp(this.active.r + dr, 0, this.nrows - 1), c = clamp(this.active.c + dc, 0, this.cols - 1);
      this.active = { r, c }; this.sel = rectOf(this.anchor, { r, c }); this.highlight(); this.scrollTo(r, c);
    }
    selectAll() { this.active = { r: 0, c: 0 }; this.anchor = { r: 0, c: 0 }; this.sel = { r1: 0, c1: 0, r2: this.nrows - 1, c2: this.cols - 1 }; this.highlight(); }
    clearSel() {
      const s = this.sel; if (!s) return;
      for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) { this.table.setCell(r, c, ''); const td = this.cellTd(r, c); if (td) td.querySelector('.cellval').textContent = ''; }
      tableChanged(this.table);
    }
    enterEdit(initial) {
      const { r, c } = this.active; const td = this.cellTd(r, c); if (!td) return;
      this.editing = true;
      const cur = this.table.getCell(r, c);
      const inp = el('input', { class: 'celledit', value: initial != null ? initial : (cur == null ? '' : cur) });
      td.innerHTML = ''; td.append(inp); inp.focus(); if (initial == null) inp.select();
      inp.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); this.commitEdit(); this.move(1, 0); }
        else if (ev.key === 'Tab') { ev.preventDefault(); this.commitEdit(); this.move(0, ev.shiftKey ? -1 : 1); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); this.commitEdit(); this.move(-1, 0); }
        else if (ev.key === 'ArrowDown') { ev.preventDefault(); this.commitEdit(); this.move(1, 0); }
        else if (ev.key === 'ArrowLeft') { ev.preventDefault(); this.commitEdit(); this.move(0, -1); }
        else if (ev.key === 'ArrowRight') { ev.preventDefault(); this.commitEdit(); this.move(0, 1); }
        else if (ev.key === 'Escape') { ev.preventDefault(); this.cancelEdit(); }
      });
      inp.addEventListener('blur', () => { if (this.editing) this.commitEdit(); });
    }
    commitEdit() {
      const { r, c } = this.active; const td = this.cellTd(r, c);
      const inp = td && td.querySelector('input.celledit'); const val = inp ? inp.value : '';
      this.editing = false; this.table.setCell(r, c, val);
      if (td) { td.innerHTML = ''; td.append(el('div', { class: 'cellval' }, val)); }
      tableChanged(this.table); this.highlight(); this.wrap.focus();
    }
    cancelEdit() {
      const { r, c } = this.active; const td = this.cellTd(r, c); this.editing = false;
      const cur = this.table.getCell(r, c);
      if (td) { td.innerHTML = ''; td.append(el('div', { class: 'cellval' }, cur == null ? '' : String(cur))); }
      this.highlight(); this.wrap.focus();
    }
    onCopy(e, cut) {
      if (this.editing || e.target.tagName === 'INPUT' || !this.sel) return;
      const s = this.sel; const lines = [];
      for (let r = s.r1; r <= s.r2; r++) { const cells = []; for (let c = s.c1; c <= s.c2; c++) { const v = this.table.getCell(r, c); cells.push(v == null ? '' : String(v)); } lines.push(cells.join('\t')); }
      e.clipboardData.setData('text/plain', lines.join('\n')); e.preventDefault();
      if (cut) this.clearSel();
    }
    onPaste(e) {
      if (this.editing || e.target.tagName === 'INPUT') return;
      const text = (e.clipboardData || window.clipboardData).getData('text'); if (!text) return;
      e.preventDefault();
      const start = this.active || { r: 0, c: 0 };
      const parsed = D.parseDelimited(text);
      parsed.rows.forEach((rrow, i) => rrow.forEach((v, j) => this.table.setCell(start.r + i, start.c + j, v)));
      tableChanged(this.table);
      const nr = parsed.rows.length, nc = parsed.rows[0] ? parsed.rows[0].length : 0;
      pendingSel = { tableId: this.table.id, sel: { r1: start.r, c1: start.c, r2: start.r + nr - 1, c2: start.c + nc - 1 }, active: { r: start.r, c: start.c } };
      renderContent();
      toast(`Pasted ${nr} × ${nc}`);
    }
    // Ctrl+Shift+V — read the clipboard and paste it transposed (rows↔columns).
    pasteTransposed() {
      const doFill = (text) => {
        if (!text) return;
        const grid = D.parseDelimited(text).rows;
        const R = grid.length, Cc = Math.max(...grid.map((r) => r.length), 1);
        const start = this.active || { r: 0, c: 0 };
        for (let i = 0; i < Cc; i++) for (let j = 0; j < R; j++) this.table.setCell(start.r + i, start.c + j, grid[j][i] != null ? grid[j][i] : '');
        tableChanged(this.table);
        pendingSel = { tableId: this.table.id, sel: { r1: start.r, c1: start.c, r2: start.r + Cc - 1, c2: start.c + R - 1 }, active: { r: start.r, c: start.c } };
        renderContent();
        toast(`Pasted transposed (${Cc} × ${R})`);
      };
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(doFill).catch(() => toast('Clipboard blocked — use Ctrl+V, then ⇄ Transpose'));
      } else toast('Use Ctrl+V, then click ⇄ Transpose');
    }
    rerenderKeep(cell) { pendingSel = { tableId: this.table.id, sel: { r1: cell.r, c1: cell.c, r2: cell.r, c2: cell.c }, active: cell }; tableChanged(this.table, true); }
    restore(p) {
      const maxR = this.nrows - 1, maxC = this.cols - 1;
      this.active = { r: clamp(p.active.r, 0, maxR), c: clamp(p.active.c, 0, maxC) }; this.anchor = this.active;
      const s = p.sel; this.sel = { r1: clamp(s.r1, 0, maxR), c1: clamp(s.c1, 0, maxC), r2: clamp(s.r2, 0, maxR), c2: clamp(s.c2, 0, maxC) };
      this.highlight(); this.wrap.focus(); this.scrollTo(this.active.r, this.active.c);
    }
  }

  // ---------- analyze modal ----------
  let analyzeState = null;
  function applicableTests(table) {
    if (table.type === 'survival') {
      return [{ kind: 'survival', name: 'Kaplan-Meier + log-rank', desc: 'Survival curves and group comparison', tag: 'Survival' }];
    }
    if (table.type === 'xy') {
      return [
        { kind: 'regression', name: 'Linear regression', desc: 'Fit Y = slope·X + intercept with 95% bands', tag: 'XY' },
        { kind: 'pearson', name: 'Pearson correlation', desc: 'Linear association (r)', tag: 'XY' },
        { kind: 'spearman', name: 'Spearman correlation', desc: 'Monotonic association (ρ), rank-based', tag: 'XY' },
        { kind: 'descriptive', name: 'Descriptive statistics', desc: 'Summary of each column', tag: 'Summary' },
      ];
    }
    if (table.type === 'grouped') {
      return [
        { kind: 'twoway', name: 'Two-way ANOVA', desc: 'Two factors + interaction + multiple comparisons', tag: 'Parametric', rec: true },
        { kind: 'srh', name: 'Scheirer-Ray-Hare', desc: 'Nonparametric two-way (rank-based)', tag: 'Rank-based' },
        { kind: 'normality', name: 'Normality tests', desc: 'Shapiro-Wilk, D’Agostino, A-D', tag: 'Diagnostics' },
        { kind: 'grubbs', name: "Grubbs' outlier test", desc: 'Detect extreme values', tag: 'Diagnostics' },
        { kind: 'descriptive', name: 'Descriptive statistics', desc: 'Mean, SD, SEM, median, CI…', tag: 'Summary' },
      ];
    }
    const ng = table.groups().length;
    const list = [];
    if (ng >= 3) {
      list.push({ kind: 'anova', name: 'One-way ANOVA', desc: 'Compare 3+ means + post-hoc', tag: 'Parametric', rec: true });
      list.push({ kind: 'kruskal', name: 'Kruskal-Wallis', desc: 'Non-parametric 3+ groups + Dunn’s', tag: 'Rank-based' });
    }
    if (ng === 2) {
      list.push({ kind: 'unpaired-t', name: 'Unpaired t test', desc: "Student's or Welch's correction", tag: 'Parametric', rec: true });
      list.push({ kind: 'mannwhitney', name: 'Mann-Whitney U', desc: 'Non-parametric two groups', tag: 'Rank-based' });
      list.push({ kind: 'paired-t', name: 'Paired t test', desc: 'If columns are matched', tag: 'Paired' });
      list.push({ kind: 'wilcoxon', name: 'Wilcoxon matched-pairs', desc: 'Non-parametric paired', tag: 'Paired' });
    }
    if (ng === 1) {
      list.push({ kind: 'onesample-t', name: 'One-sample t test', desc: 'Compare mean to a value', tag: 'Parametric', rec: true });
      list.push({ kind: 'wilcoxon', name: 'Wilcoxon signed-rank', desc: 'Non-parametric one sample', tag: 'Rank-based' });
    }
    list.push({ kind: 'normality', name: 'Normality tests', desc: 'Shapiro-Wilk, D’Agostino, A-D', tag: 'Diagnostics' });
    list.push({ kind: 'grubbs', name: "Grubbs' outlier test", desc: 'Detect extreme values', tag: 'Diagnostics' });
    list.push({ kind: 'descriptive', name: 'Descriptive statistics', desc: 'Mean, SD, SEM, median, CI…', tag: 'Summary' });
    return list;
  }

  function openAnalyze(table, preselect) {
    if (!table.hasData()) { toast('Enter or paste some data first'); return; }
    analyzeState = { table, kind: preselect || null, params: {} };
    const body = $('#analyze-body'); body.innerHTML = '';
    const tests = applicableTests(table);
    if (!analyzeState.kind && tests.length) analyzeState.kind = (tests.find((t) => t.rec) || tests[0]).kind;
    const grid = el('div', { class: 'test-grid' });
    tests.forEach((t) => {
      const card = el('div', {
        class: 'test-opt' + (analyzeState.kind === t.kind ? ' selected' : ''),
        onclick: () => { analyzeState.kind = t.kind; analyzeState.params = {}; $$('.test-opt', grid).forEach((c) => c.classList.remove('selected')); card.classList.add('selected'); renderAnalyzeOpts(); },
      },
        el('div', { class: 't-name' }, t.name, t.rec ? el('span', { style: 'color:var(--accent);font-size:11px;font-weight:700' }, '  ★ suggested') : ''),
        el('div', { class: 't-desc' }, t.desc),
        el('span', { class: 't-tag' }, t.tag));
      grid.append(card);
    });
    body.append(grid);
    body.append(el('div', { id: 'analyze-opts', class: 'analyze-opts' }));
    renderAnalyzeOpts();
    showModal('modal-analyze');
  }

  function renderAnalyzeOpts() {
    const box = $('#analyze-opts'); box.innerHTML = '';
    const kind = analyzeState.kind, table = analyzeState.table, p = analyzeState.params;
    const sel = (label, key, options, def) => {
      p[key] = p[key] || def;
      return el('div', { class: 'opt-row' }, el('label', {}, label),
        el('select', { class: 'inp', onchange: (e) => { p[key] = e.target.value; } },
          ...options.map((o) => el('option', { value: o.v, selected: p[key] === o.v }, o.t))));
    };
    if (kind === 'unpaired-t') {
      box.append(sel('Variance assumption', 'welch', [{ v: 'welch', t: "Welch's correction (recommended — unequal variances)" }, { v: 'student', t: "Student's (assume equal variances)" }], 'welch'));
    }
    if (kind === 'onesample-t') {
      p.mu0 = p.mu0 || '0';
      box.append(el('div', { class: 'opt-row' }, el('label', {}, 'Hypothetical mean (H₀)'),
        el('input', { class: 'inp', type: 'number', value: p.mu0, oninput: (e) => { p.mu0 = e.target.value; } })));
    }
    const pairPicker = (gnames) => {
      if (!p.pairs) p.pairs = [];
      const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:3px;margin:6px 0 2px;max-height:150px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px' });
      for (let i = 0; i < gnames.length; i++) for (let j = i + 1; j < gnames.length; j++) {
        const has = () => p.pairs.some((pr) => pr[0] === i && pr[1] === j);
        const cb = el('input', { type: 'checkbox' }); if (has()) cb.checked = true;
        cb.addEventListener('change', () => { if (cb.checked) { if (!has()) p.pairs.push([i, j]); } else { p.pairs = p.pairs.filter((pr) => !(pr[0] === i && pr[1] === j)); } });
        wrap.append(el('label', { class: 'ctrl-row' }, cb, gnames[i] + '  vs  ' + gnames[j]));
      }
      return wrap;
    };
    if (kind === 'anova') {
      const gnames = table.groups().map((g) => g.name);
      p.compMode = p.compMode || 'tukey';
      box.append(el('div', { class: 'opt-row' }, el('label', {}, 'Comparisons'),
        el('select', { class: 'inp', onchange: (e) => { p.compMode = e.target.value; renderAnalyzeOpts(); } },
          ...[['tukey', 'Every pair — Tukey'], ['holm-sidak', 'Every pair — Holm-Šídák'], ['bonferroni', 'Every pair — Bonferroni'], ['dunnett', 'Each vs. control — Dunnett'], ['custom', 'Choose specific comparisons…']].map(([v, t]) => el('option', { value: v, selected: p.compMode === v }, t)))));
      if (p.compMode === 'dunnett') {
        p.control = p.control != null ? p.control : 0;
        box.append(el('div', { class: 'opt-row' }, el('label', {}, 'Control group'),
          el('select', { class: 'inp', onchange: (e) => { p.control = +e.target.value; } }, ...gnames.map((nm, i) => el('option', { value: i, selected: +p.control === i }, nm)))));
      }
      if (p.compMode === 'custom') {
        box.append(el('div', { class: 'opt-row', style: 'align-items:flex-start' }, el('label', {}, 'Select pairs'), pairPicker(gnames)));
        box.append(sel('Correction', 'customCorr', [{ v: 'sidak', t: 'Šídák' }, { v: 'bonferroni', t: 'Bonferroni' }, { v: 'holm-sidak', t: 'Holm-Šídák' }], 'sidak'));
      }
    }
    if (kind === 'kruskal') {
      const gnames = table.groups().map((g) => g.name);
      p.compMode = p.compMode || 'holm-sidak';
      box.append(el('div', { class: 'opt-row' }, el('label', {}, "Dunn comparisons"),
        el('select', { class: 'inp', onchange: (e) => { p.compMode = e.target.value; renderAnalyzeOpts(); } },
          ...[['holm-sidak', 'Every pair — Holm-Šídák'], ['bonferroni', 'Every pair — Bonferroni'], ['sidak', 'Every pair — Šídák'], ['custom', 'Choose specific comparisons…']].map(([v, t]) => el('option', { value: v, selected: p.compMode === v }, t)))));
      if (p.compMode === 'custom') {
        box.append(el('div', { class: 'opt-row', style: 'align-items:flex-start' }, el('label', {}, 'Select pairs'), pairPicker(gnames)));
        box.append(sel('Correction', 'customCorr', [{ v: 'sidak', t: 'Šídák' }, { v: 'bonferroni', t: 'Bonferroni' }, { v: 'holm-sidak', t: 'Holm-Šídák' }], 'sidak'));
      }
    }
    if (kind === 'srh') {
      p.rowFactor = p.rowFactor || 'Rows'; p.colFactor = p.colFactor || 'Columns';
      box.append(el('div', { class: 'opt-row' }, el('label', {}, 'Name the row factor'), el('input', { class: 'inp', value: p.rowFactor, oninput: (e) => { p.rowFactor = e.target.value; } })));
      box.append(el('div', { class: 'opt-row' }, el('label', {}, 'Name the column factor'), el('input', { class: 'inp', value: p.colFactor, oninput: (e) => { p.colFactor = e.target.value; } })));
      box.append(el('div', { class: 'note' }, 'Nonparametric two-way test — ranks the data, then partitions the effects. Use when residuals are non-normal.'));
    }
    if (kind === 'twoway') {
      p.rowFactor = p.rowFactor || 'Rows'; p.colFactor = p.colFactor || 'Columns';
      box.append(el('div', { class: 'opt-row' }, el('label', {}, 'Name the row factor'), el('input', { class: 'inp', value: p.rowFactor, oninput: (e) => { p.rowFactor = e.target.value; } })));
      box.append(el('div', { class: 'opt-row' }, el('label', {}, 'Name the column factor'), el('input', { class: 'inp', value: p.colFactor, oninput: (e) => { p.colFactor = e.target.value; } })));
      box.append(sel('Multiple comparisons', 'phmethod', [{ v: 'sidak', t: 'Šídák (recommended)' }, { v: 'tukey', t: 'Tukey' }, { v: 'holm-sidak', t: 'Holm-Šídák' }, { v: 'bonferroni', t: 'Bonferroni' }], 'sidak'));
      box.append(sel('Compare', 'phdir', [
        { v: 'colsWithinRow', t: 'Column groups within each row (simple effects)' },
        { v: 'rowsWithinCol', t: 'Rows within each column group (simple effects)' },
        { v: 'colMeans', t: 'Column-group means (main effect)' },
        { v: 'rowMeans', t: 'Row means (main effect)' },
        { v: 'cells', t: 'Every cell vs every cell' },
      ], 'colsWithinRow'));
    }
    if (kind === 'grubbs') {
      box.append(sel('Mode', 'iterative', [{ v: 'single', t: 'Single most extreme value' }, { v: 'iterative', t: 'Iterative (find several / ESD)' }], 'single'));
    }
    if (kind === 'normality') {
      box.append(el('div', { class: 'note' }, 'Runs Shapiro-Wilk, D’Agostino-Pearson and Anderson-Darling on each group.'));
    }
    // guidance blurb
    const g = G.TESTS[kind];
    if (g) {
      const help = el('details', { class: 'help' }, el('summary', {}, 'When to use this & how to read it'));
      const hb = el('div', { class: 'help-body' });
      hb.append(el('div', {}, el('b', {}, 'Use when: '), g.use));
      if (g.assumptions && g.assumptions.length) hb.append(el('div', {}, el('b', {}, 'Assumptions: '), el('ul', {}, ...g.assumptions.map((a) => el('li', {}, a)))));
      hb.append(el('div', {}, el('b', {}, 'Interpretation: '), g.interpret));
      if (g.alt) hb.append(el('div', { style: 'margin-top:5px' }, el('b', {}, 'Alternatives: '), g.alt));
      help.append(hb); box.append(help);
    }
  }

  function runAnalyzeFromModal() {
    const { table, kind, params } = analyzeState;
    hideModal('modal-analyze');
    runAnalysis(table, Object.assign({ kind }, normalizeParams(kind, params)));
  }
  function normalizeParams(kind, p) {
    const out = {};
    if (kind === 'unpaired-t') out.welch = p.welch !== 'student';
    if (kind === 'onesample-t') out.mu0 = parseFloat(p.mu0) || 0;
    if (kind === 'anova') {
      const mode = p.compMode || 'tukey';
      if (mode === 'custom') { out.posthoc = 'custom'; out.pairs = p.pairs || []; out.correction = p.customCorr || 'sidak'; }
      else if (mode === 'dunnett') { out.posthoc = 'dunnett'; out.control = p.control || 0; }
      else out.posthoc = mode;
    }
    if (kind === 'kruskal') {
      const mode = p.compMode || 'holm-sidak';
      if (mode === 'custom') { out.posthoc = p.customCorr || 'sidak'; out.pairs = p.pairs || []; }
      else out.posthoc = mode;
    }
    if (kind === 'grubbs') out.iterative = p.iterative === 'iterative';
    if (kind === 'twoway') { out.rowFactor = p.rowFactor || 'Rows'; out.colFactor = p.colFactor || 'Columns'; out.phmethod = p.phmethod || 'sidak'; out.phdir = p.phdir || 'colsWithinRow'; }
    if (kind === 'srh') { out.rowFactor = p.rowFactor || 'Rows'; out.colFactor = p.colFactor || 'Columns'; }
    return out;
  }

  // ---------- run analysis ----------
  function runAnalysis(table, spec) {
    let res;
    try { res = compute(table, spec); }
    catch (err) { console.error(err); toast('Could not run: ' + err.message); return; }
    if (!res) return;
    const result = { id: 'res_' + App.counter, name: res.title, tableId: table.id, html: res.html, kind: spec.kind, spec };
    App.results.push(result);
    if (res.graphSpec) {
      const graph = { id: 'gr_' + App.counter, name: res.graphSpec.opts.title || res.title, tableId: table.id, resultId: result.id, spec: res.graphSpec };
      App.graphs.push(graph);
      result.graphId = graph.id;
    }
    App.counter++;
    renderNavigator();
    setActive('result', result.id);
    saveState();
  }

  function verdict(p, sigText, nsText) {
    const sig = p < 0.05;
    const ps = fmtP(p);
    const pPhrase = /^[<>]/.test(ps) ? 'p ' + ps : 'p = ' + ps;
    return el('div', { class: 'verdict ' + (sig ? 'sig' : 'ns') },
      el('span', { class: 'vicon' }, sig ? '✓' : '○'),
      el('span', { html: (sig ? sigText : nsText) + ` <b>(${pPhrase}${sig ? ', ' + stars(p) : ''})</b>` }));
  }
  function statRow(k, v) { return el('tr', {}, el('th', {}, k), el('td', { class: 'num' }, v)); }
  function statsTable(rows) { return el('table', { class: 'stats' }, el('tbody', {}, ...rows.map(([k, v]) => statRow(k, v)))); }
  function apaLine(text) { return el('div', {}, el('div', { class: 'section-label' }, 'Report text'), el('div', { class: 'apa' }, text)); }
  function card(title, ...body) {
    return el('div', { class: 'result-card' },
      el('div', { class: 'result-head' }, el('h3', {}, title)),
      el('div', { class: 'result-body' }, ...body));
  }

  // Reduce a grouped (two-way) table to named value-sets for column-style
  // diagnostics (normality / outliers / descriptives). With replicates each
  // row×column cell is its own experimental group; without replicates each
  // dataset column is pooled across its rows.
  function groupedUnits(table) {
    const cm = table.cellsMatrix();
    const out = [];
    if (table.nsub > 1) {
      for (let j = 0; j < cm.colNames.length; j++)
        for (let i = 0; i < cm.rowNames.length; i++) {
          const vals = cm.cells[i][j];
          if (vals && vals.length) out.push({ name: cm.colNames[j] + ' · ' + cm.rowNames[i], values: vals.slice() });
        }
    } else {
      for (let j = 0; j < cm.colNames.length; j++) {
        const vals = [];
        for (let i = 0; i < cm.rowNames.length; i++) { const c = cm.cells[i][j]; if (c && c.length) vals.push(c[0]); }
        if (vals.length) out.push({ name: cm.colNames[j], values: vals });
      }
    }
    return out;
  }
  function groupedUnitNote(table) {
    if (table.type !== 'grouped') return null;
    return el('div', { class: 'note' }, table.nsub > 1
      ? 'Grouped table — each column × row cell (its replicate subcolumns) is analyzed as one group.'
      : 'Grouped table — each dataset column is analyzed as one group (values pooled across rows).');
  }

  function compute(table, spec) {
    const kind = spec.kind;
    const groups = table.type === 'column' ? table.groups() : (table.type === 'grouped' ? groupedUnits(table) : null);
    const wrap = (title, node, graphSpec) => ({ title, html: node, graphSpec });

    if (kind === 'descriptive') {
      const gs = table.type === 'xy' ? table.columns.map((c, i) => ({ name: c.name, values: table.numColumn(i) })) : groups;
      const rows = gs.map((g) => { const d = T.describe(g.values); return { name: g.name, d }; });
      const tbl = el('table', { class: 'stats' });
      tbl.append(el('thead', {}, el('tr', {}, el('th', {}, 'Group'), ...['n', 'Mean', 'SD', 'SEM', 'Median', 'Min', 'Max', '95% CI'].map((h) => el('th', {}, h)))));
      const tb = el('tbody');
      rows.forEach((r) => tb.append(el('tr', {},
        el('td', {}, r.name),
        el('td', { class: 'num' }, r.d.n), el('td', { class: 'num' }, num(r.d.mean)), el('td', { class: 'num' }, num(r.d.sd)),
        el('td', { class: 'num' }, num(r.d.sem)), el('td', { class: 'num' }, num(r.d.median)),
        el('td', { class: 'num' }, num(r.d.min)), el('td', { class: 'num' }, num(r.d.max)),
        el('td', { class: 'num' }, `${num(r.d.ci95lo)} – ${num(r.d.ci95hi)}`))));
      tbl.append(tb);
      const node = card('Descriptive statistics', tbl,
        el('div', { class: 'section-label' }, 'Skewness & kurtosis'),
        statsTable(rows.map((r) => [r.name, `skew ${num(r.d.skewness, 3)} · kurtosis ${num(r.d.kurtosis, 3)}`])),
        groupedUnitNote(table));
      const gspec = table.type === 'xy' ? null : graphSpec('bar', groups, { title: table.name, yLabel: 'Value', errorType: 'sd' });
      return wrap('Descriptive statistics', node, gspec);
    }

    if (kind === 'onesample-t') {
      const g = groups[0]; const r = T.oneSampleT(g.values, spec.mu0);
      const node = card('One-sample t test — ' + g.name,
        verdict(r.p, `The mean (${num(r.mean)}) is significantly different from ${num(spec.mu0)}.`, `No significant difference from ${num(spec.mu0)}.`),
        statsTable([['Mean (95% CI)', `${num(r.mean)}  (${num(r.ci95lo)} – ${num(r.ci95hi)})`], ['Hypothetical mean', num(spec.mu0)], ['t', num(r.t, 4)], ['df', r.df], ['P value', fmtP(r.p)], ["Cohen's d", num(r.cohenD, 3)]]),
        apaLine(`t(${r.df}) = ${num(r.t, 3)}, p ${r.p < 0.0001 ? '< .0001' : '= ' + fmtP(r.p)}, d = ${num(r.cohenD, 2)}.`),
        assumptionNote(g.values));
      return wrap('One-sample t: ' + g.name, node, graphSpec('bar', groups, { title: table.name, yLabel: g.name, errorType: 'sem' }));
    }

    if (kind === 'unpaired-t') {
      const [a, b] = groups; const r = T.unpairedT(a.values, b.values, spec.welch);
      const sg = [{ i: 0, j: 1, name: `${a.name} vs ${b.name}`, label: stars(r.p), p: r.p, sig: r.p < 0.05, on: true }];
      const node = card(r.test + ` — ${a.name} vs ${b.name}`,
        verdict(r.p, `${a.name} and ${b.name} differ significantly.`, `No significant difference between ${a.name} and ${b.name}.`),
        statsTable([
          [a.name + ' (mean ± SD)', `${num(r.mean1)} ± ${num(r.sd1)}  (n=${r.n1})`],
          [b.name + ' (mean ± SD)', `${num(r.mean2)} ± ${num(r.sd2)}  (n=${r.n2})`],
          ['Difference (95% CI)', `${num(r.diff)}  (${num(r.ci95lo)} – ${num(r.ci95hi)})`],
          ['t', num(r.t, 4)], ['df', num(r.df, r.welch ? 2 : 0)], ['P value', fmtP(r.p)], ["Cohen's d", num(r.cohenD, 3)],
        ]),
        apaLine(`${a.name} (M = ${num(r.mean1, 3)}, SD = ${num(r.sd1, 3)}) vs ${b.name} (M = ${num(r.mean2, 3)}, SD = ${num(r.sd2, 3)}); ${r.welch ? "Welch's " : ''}t(${num(r.df, 2)}) = ${num(r.t, 3)}, p ${r.p < 0.0001 ? '< .0001' : '= ' + fmtP(r.p)}, d = ${num(r.cohenD, 2)}.`),
        assumptionNote(a.values, b.values));
      return wrap(`t test: ${a.name} vs ${b.name}`, node, graphSpec('bar', groups, { title: table.name, yLabel: 'Value', errorType: 'sem', sig: sg }));
    }

    if (kind === 'paired-t') {
      const [a, b] = groups; const r = T.pairedT(table.rawColumn(0), table.rawColumn(1));
      const node = card('Paired t test — ' + a.name + ' vs ' + b.name,
        verdict(r.p, 'The paired difference is statistically significant.', 'No significant paired difference.'),
        statsTable([['Mean difference (95% CI)', `${num(r.meanDiff)}  (${num(r.ci95lo)} – ${num(r.ci95hi)})`], ['SD of differences', num(r.sdDiff)], ['n pairs', r.n], ['t', num(r.t, 4)], ['df', r.df], ['P value', fmtP(r.p)], ["Cohen's dz", num(r.cohenDz, 3)]]),
        apaLine(`t(${r.df}) = ${num(r.t, 3)}, p ${r.p < 0.0001 ? '< .0001' : '= ' + fmtP(r.p)}, dz = ${num(r.cohenDz, 2)}.`));
      return wrap(`Paired t: ${a.name} vs ${b.name}`, node, graphSpec('paired', groups, { title: table.name, yLabel: 'Value', labelA: a.name, labelB: b.name, colA: table.rawColumn(0), colB: table.rawColumn(1) }));
    }

    if (kind === 'mannwhitney') {
      const [a, b] = groups; const r = T.mannWhitney(a.values, b.values);
      const node = card('Mann-Whitney U test — ' + a.name + ' vs ' + b.name,
        verdict(r.p, `${a.name} and ${b.name} differ significantly.`, `No significant difference between ${a.name} and ${b.name}.`),
        statsTable([['Mann-Whitney U', num(r.U, 1)], ['Sum of ranks', `${num(r.R1, 1)} / ${num(r.R2, 1)}`], ['Median ' + a.name, num(T.describe(a.values).median)], ['Median ' + b.name, num(T.describe(b.values).median)], ['Method', r.method], ['P value (two-tailed)', fmtP(r.p)]]),
        el('div', { class: 'note' }, r.method.startsWith('exact') ? 'Exact p-value (small sample, no ties).' : 'Normal approximation with continuity correction' + (r.hasTies ? ' and tie correction.' : '.')));
      return wrap(`Mann-Whitney: ${a.name} vs ${b.name}`, node, graphSpec('dot', groups, { title: table.name, yLabel: 'Value', errorType: 'none', sig: [{ i: 0, j: 1, name: `${a.name} vs ${b.name}`, label: stars(r.p), p: r.p, sig: r.p < 0.05, on: true }] }));
    }

    if (kind === 'wilcoxon') {
      const r = T.wilcoxonSignedRank(table.rawColumn(0), table.rawColumn(1));
      const node = card('Wilcoxon matched-pairs signed rank test',
        verdict(r.p, 'The paired difference is statistically significant.', 'No significant paired difference.'),
        statsTable([['W (signed-rank)', num(r.W, 1)], ['Sum of positive ranks', num(r.Wpos, 1)], ['Sum of negative ranks', num(r.Wneg, 1)], ['n pairs (non-zero)', r.n], ['P value', fmtP(r.p)]]));
      return wrap('Wilcoxon signed-rank', node, graphSpec('paired', groups, { title: table.name, yLabel: 'Value', labelA: groups[0].name, labelB: groups[1].name, colA: table.rawColumn(0), colB: table.rawColumn(1) }));
    }

    if (kind === 'anova') {
      const r = T.oneWayANOVA(groups);
      const ph = T.posthoc(r, spec.posthoc, { control: spec.control, pairs: spec.pairs, correction: spec.correction });
      const at = el('table', { class: 'stats' });
      at.append(el('thead', {}, el('tr', {}, ...['Source', 'SS', 'df', 'MS', 'F', 'P'].map((h) => el('th', {}, h)))));
      at.append(el('tbody', {},
        el('tr', {}, el('td', {}, 'Between groups'), el('td', { class: 'num' }, num(r.ssB)), el('td', { class: 'num' }, r.dfB), el('td', { class: 'num' }, num(r.msB)), el('td', { class: 'num' }, num(r.F, 4)), el('td', { class: 'num' }, fmtP(r.p))),
        el('tr', {}, el('td', {}, 'Within groups'), el('td', { class: 'num' }, num(r.ssW)), el('td', { class: 'num' }, r.dfW), el('td', { class: 'num' }, num(r.msW)), el('td', {}, ''), el('td', {}, '')),
        el('tr', {}, el('td', {}, 'Total'), el('td', { class: 'num' }, num(r.ssT)), el('td', { class: 'num' }, r.dfB + r.dfW), el('td', {}, ''), el('td', {}, ''), el('td', {}, ''))));
      const phTable = posthocTable(ph, spec.posthoc);
      const sg = sigFromPosthoc(ph, groups);
      const node = card('One-way ANOVA',
        verdict(r.p, 'At least one group mean differs significantly.', 'No significant differences among group means.'),
        at,
        statsTable([['F', `F(${r.dfB}, ${r.dfW}) = ${num(r.F, 4)}`], ['P value', fmtP(r.p)], ['R² (η²)', num(r.eta2, 4)], ['ω²', num(r.omega2, 4)]]),
        el('div', { class: 'section-label' }, 'Welch ANOVA (does not assume equal variances)'),
        statsTable([['Welch F', `F(${r.welch.df1}, ${num(r.welch.df2, 1)}) = ${num(r.welch.F, 4)}`], ['Welch P', fmtP(r.welch.p)]]),
        el('div', { class: 'section-label' }, 'Post-hoc: ' + (spec.posthoc === 'dunnett' ? 'Dunnett vs ' + groups[spec.control || 0].name : posthocName(spec.posthoc))),
        phTable,
        spec.note ? el('div', { class: 'note', style: 'color:var(--warn)' }, '⚠ Your design is repeated/matched — a repeated-measures ANOVA would be more appropriate. These results assume independent groups.') : null,
        assumptionNoteMulti(groups));
      return wrap('One-way ANOVA', node, graphSpec('bar', groups, { title: table.name, yLabel: 'Value', errorType: 'sem', sig: sg }));
    }

    if (kind === 'kruskal') {
      const r = T.kruskalWallis(groups);
      const ph = T.dunnPosthoc(r, spec.posthoc, { pairs: spec.pairs });
      const node = card('Kruskal-Wallis test',
        verdict(r.p, 'At least one group differs significantly (by ranks).', 'No significant differences among groups.'),
        statsTable([['Kruskal-Wallis H', num(r.H, 4)], ['df', r.df], ['P value', fmtP(r.p)], ['Tie correction', num(r.tieCorrection, 4)]]),
        el('div', { class: 'section-label' }, 'Mean ranks'),
        statsTable(r.names.map((nm, i) => [nm, num(r.meanRanks[i], 2) + `  (n=${r.ns[i]})`])),
        el('div', { class: 'section-label' }, "Dunn's post-hoc (" + posthocName(spec.posthoc) + ')'),
        posthocTable(ph, spec.posthoc, true));
      return wrap('Kruskal-Wallis', node, graphSpec('dot', groups, { title: table.name, yLabel: 'Value', errorType: 'none', sig: sigFromPosthoc(ph, groups) }));
    }

    if (kind === 'pearson' || kind === 'spearman') {
      const xr = table.rawColumn(0), yr = table.rawColumn(1);
      const r = kind === 'pearson' ? T.pearson(xr, yr) : T.spearman(xr, yr);
      const coef = kind === 'pearson' ? r.r : r.rho;
      const node = card((kind === 'pearson' ? 'Pearson' : 'Spearman') + ' correlation',
        verdict(r.p, `Significant ${kind === 'pearson' ? 'linear' : 'monotonic'} correlation (${kind === 'pearson' ? 'r' : 'ρ'} = ${num(coef, 3)}).`, 'No significant correlation.'),
        statsTable([[kind === 'pearson' ? 'r' : 'ρ (rho)', num(coef, 4)], ...(kind === 'pearson' ? [['95% CI for r', `${num(r.ci95lo, 3)} – ${num(r.ci95hi, 3)}`], ['R²', num(r.r2, 4)]] : []), ['n', r.n], ['P value (two-tailed)', fmtP(r.p)]]),
        apaLine(`${kind === 'pearson' ? 'r' : 'rₛ'}(${r.n - 2}) = ${num(coef, 2)}, p ${r.p < 0.0001 ? '< .0001' : '= ' + fmtP(r.p)}.`));
      const reg = T.linearRegression(xr, yr);
      return wrap((kind === 'pearson' ? 'Pearson' : 'Spearman') + ' correlation', node, xySpec(table, reg, kind === 'pearson' ? `r = ${num(coef, 3)}, p = ${fmtP(r.p)}` : `ρ = ${num(coef, 3)}, p = ${fmtP(r.p)}`));
    }

    if (kind === 'regression') {
      const r = T.linearRegression(table.rawColumn(0), table.rawColumn(1));
      const node = card('Simple linear regression',
        verdict(r.pSlope, 'The slope is significantly non-zero.', 'The slope is not significantly different from zero.'),
        statsTable([
          ['Slope (95% CI)', `${num(r.slope, 5)}  (${num(r.slopeCIlo, 4)} – ${num(r.slopeCIhi, 4)})`],
          ['Y-intercept (95% CI)', `${num(r.intercept, 5)}  (${num(r.intCIlo, 4)} – ${num(r.intCIhi, 4)})`],
          ['R²', num(r.r2, 5)], ['Sy.x (residual SD)', num(r.sy_x, 4)], ['n', r.n],
          ['t (slope)', num(r.tSlope, 4)], ['df', r.df], ['P value (slope ≠ 0)', fmtP(r.pSlope)],
        ]),
        apaLine(`Y = ${num(r.slope, 4)}·X ${r.intercept >= 0 ? '+' : '−'} ${num(Math.abs(r.intercept), 4)};  R² = ${num(r.r2, 3)}, p ${r.pSlope < 0.0001 ? '< .0001' : '= ' + fmtP(r.pSlope)}.`));
      return wrap('Linear regression', node, xySpec(table, r, `Y = ${num(r.slope, 3)}X ${r.intercept >= 0 ? '+' : '−'} ${num(Math.abs(r.intercept), 3)}  ·  R² = ${num(r.r2, 3)}`));
    }

    if (kind === 'normality') {
      const gs = groups;
      const blocks = gs.map((g) => {
        const sw = N.shapiroWilk(g.values), da = N.dagostinoPearson(g.values), ad = N.andersonDarling(g.values);
        const rows = [];
        rows.push(['Shapiro-Wilk', sw.error ? sw.error : `W = ${num(sw.W, 4)}, p = ${fmtP(sw.p)} ${sw.p < 0.05 ? '✗' : '✓'}`]);
        rows.push(["D'Agostino-Pearson", da.error ? da.error : `K² = ${num(da.K2, 3)}, p = ${fmtP(da.p)} ${da.p < 0.05 ? '✗' : '✓'}`]);
        rows.push(['Anderson-Darling', ad.error ? ad.error : `A* = ${num(ad.Astar, 4)}, p = ${fmtP(ad.p)} ${ad.p < 0.05 ? '✗' : '✓'}`]);
        const anyNon = [sw, da, ad].some((t) => !t.error && t.p < 0.05);
        return el('div', { style: 'margin-bottom:14px' },
          el('div', { class: 'section-label' }, g.name + `  (n=${g.values.length})`),
          statsTable(rows),
          el('div', { class: 'assump ' + (anyNon ? 'fail' : 'pass') }, anyNon ? '✗ At least one test rejects normality — consider a non-parametric test.' : '✓ Consistent with a normal distribution — parametric tests are reasonable.'));
      });
      const node = card('Normality tests', ...blocks, groupedUnitNote(table), el('div', { class: 'note' }, '✓ = consistent with normal (p ≥ 0.05); ✗ = deviates from normal (p < 0.05). With large n, tiny deviations become significant — also inspect the plot.'));
      // Diagnostic test — no auto-graph (issue #34): don't clutter the graphs workspace
      // with an unrequested column scatter. Users can still make one via ◧ Graph.
      return wrap('Normality tests', node, null);
    }

    if (kind === 'grubbs') {
      const blocks = groups.map((g) => {
        const head = el('div', { class: 'section-label' }, g.name + `  (n=${g.values.length})`);
        if (g.values.length < 3) return el('div', { style: 'margin-bottom:14px' }, head, el('div', { class: 'note' }, 'Need at least 3 values to test for an outlier.'));
        if (spec.iterative) {
          const r = N.grubbsIterative(g.values);
          return el('div', { style: 'margin-bottom:14px' }, head,
            r.outliers.length ? el('div', { class: 'verdict sig' }, el('span', { class: 'vicon' }, '✓'), el('span', {}, `Detected ${r.outliers.length} outlier(s).`)) : el('div', { class: 'verdict ns' }, el('span', { class: 'vicon' }, '○'), el('span', {}, 'No outliers detected.')),
            r.outliers.length ? el('table', { class: 'stats' }, el('thead', {}, el('tr', {}, ...['Outlier value', 'G', 'G critical', 'P'].map((h) => el('th', { class: 'num' }, h)))), el('tbody', {}, ...r.outliers.map((o) => el('tr', {}, el('td', { class: 'num' }, num(o.value)), el('td', { class: 'num' }, num(o.G, 4)), el('td', { class: 'num' }, num(o.Gcrit, 4)), el('td', { class: 'num' }, fmtP(o.p)))))) : null,
            el('div', { class: 'note' }, `${r.cleanedN} of ${g.values.length} values remain after removing outliers.`));
        }
        const r = N.grubbs(g.values);
        return el('div', { style: 'margin-bottom:14px' }, head,
          verdict(r.p, `The value ${num(r.value)} is a significant outlier.`, `No significant outlier (most extreme value = ${num(r.value)}).`),
          statsTable([['Most extreme value', num(r.value)], ['G (test statistic)', num(r.G, 4)], ['G critical (α=0.05)', num(r.Gcrit, 4)], ['Mean / SD', `${num(r.mean)} / ${num(r.sd)}`], ['n', r.n], ['P value (two-sided)', fmtP(r.p)]]));
      });
      const node = card("Grubbs' outlier test" + (spec.iterative ? ' (iterative ESD)' : ''), ...blocks,
        groupedUnitNote(table),
        el('div', { class: 'note' }, 'Grubbs assumes the rest of the data are approximately normal. Investigate outliers before deleting them.'));
      // Diagnostic test — no auto-graph (issue #34): don't clutter the graphs workspace
      // with an unrequested column scatter. Users can still make one via ◧ Graph.
      return wrap("Grubbs' outlier test", node, null);
    }

    if (kind === 'survival') {
      const rows = table.survivalRows();
      const res = S.analyze(rows);
      const summary = el('table', { class: 'stats' });
      summary.append(el('thead', {}, el('tr', {}, ...['Group', 'n', 'Events', 'Censored', 'Median survival'].map((h) => el('th', {}, h)))));
      const tb = el('tbody');
      res.groups.forEach((nm) => { const k = res.km[nm]; tb.append(el('tr', {}, el('td', {}, nm), el('td', { class: 'num' }, k.n), el('td', { class: 'num' }, k.events), el('td', { class: 'num' }, k.censored), el('td', { class: 'num' }, k.median == null ? 'not reached' : num(k.median)))); });
      summary.append(tb);
      const parts = [summary];
      if (res.logRank) {
        parts.push(verdict(res.logRank.p, 'Survival curves differ significantly between groups.', 'No significant difference between survival curves.'));
        parts.push(el('div', { class: 'section-label' }, 'Log-rank (Mantel-Cox) test'));
        parts.push(statsTable([['Chi-square', num(res.logRank.chi2, 4)], ['df', res.logRank.df], ['P value', fmtP(res.logRank.p)], ...(res.logRank.hazardRatio != null ? [['Hazard ratio', num(res.logRank.hazardRatio, 4)]] : [])]));
        parts.push(el('div', { class: 'section-label' }, 'Gehan-Breslow-Wilcoxon test (weights early events)'));
        parts.push(statsTable([['Chi-square', num(res.gehan.chi2, 4)], ['P value', fmtP(res.gehan.p)]]));
      }
      const node = card('Survival analysis (Kaplan-Meier)', ...(res.logRank ? [parts[1], summary, ...parts.slice(2)] : parts));
      const curves = res.groups.map((nm) => ({ name: nm, steps: res.km[nm].steps, censorTimes: res.km[nm].censorTimes, n0: res.km[nm].n }));
      return wrap('Survival analysis', node, { chartType: 'survival', curves, opts: { title: table.name, xLabel: 'Time', yLabel: 'Percent survival', percent: true, atRisk: true, showCI: false } });
    }

    if (kind === 'twoway') {
      const cm = table.cellsMatrix();
      const m = T.twoWayANOVA(cm.cells, cm.rowNames, cm.colNames, { rowFactor: spec.rowFactor, colFactor: spec.colFactor });
      if (m.error) {
        const node = card('Two-way ANOVA', el('div', { class: 'verdict warn' }, el('span', { class: 'vicon' }, '⚠'), el('span', {}, m.error)));
        return wrap('Two-way ANOVA', node, null);
      }
      const at = el('table', { class: 'stats' });
      at.append(el('thead', {}, el('tr', {}, ...['Source', 'SS', 'df', 'MS', 'F', 'P', 'ηp²'].map((h) => el('th', {}, h)))));
      const tb = el('tbody');
      m.effects.forEach((e) => tb.append(el('tr', {}, el('td', {}, e.name), el('td', { class: 'num' }, num(e.ss)), el('td', { class: 'num' }, e.df), el('td', { class: 'num' }, num(e.ms)), el('td', { class: 'num' }, num(e.F, 4)), el('td', { class: 'num' }, fmtP(e.p)), el('td', { class: 'num' }, num(e.partialEta2, 3)))));
      tb.append(el('tr', {}, el('td', {}, 'Residual'), el('td', { class: 'num' }, num(m.residual.ss)), el('td', { class: 'num' }, m.residual.df), el('td', { class: 'num' }, num(m.residual.ms)), el('td', {}, ''), el('td', {}, ''), el('td', {}, '')));
      at.append(tb);
      const sigEffects = m.effects.filter((e) => e.p < 0.05);
      const vnode = sigEffects.length
        ? el('div', { class: 'verdict sig' }, el('span', { class: 'vicon' }, '✓'), el('span', { html: 'Significant: ' + sigEffects.map((e) => e.name + ' (' + (e.p < 0.0001 ? 'p < 0.0001' : 'p = ' + fmtP(e.p)) + ')').join('; ') }))
        : el('div', { class: 'verdict ns' }, el('span', { class: 'vicon' }, '○'), el('span', {}, 'No effect reached significance.'));
      const cmeans = el('table', { class: 'stats' });
      cmeans.append(el('thead', {}, el('tr', {}, el('th', {}, spec.rowFactor + ' \\ ' + spec.colFactor), ...cm.colNames.map((c) => el('th', {}, c)))));
      const cb = el('tbody');
      cm.rowNames.forEach((rn, i) => cb.append(el('tr', {}, el('td', {}, rn), ...cm.colNames.map((_, j) => el('td', { class: 'num' }, m.cellN[i][j] ? num(m.cellMeans[i][j]) + ' ±' + num(m.cellSD[i][j], 2) + ' (n=' + m.cellN[i][j] + ')' : '—')))));
      cmeans.append(cb);
      const ph = T.twoWayPosthoc(m, spec.phmethod, spec.phdir);
      const dirTextMap = {
        colsWithinRow: spec.colFactor + ' within each ' + spec.rowFactor,
        rowsWithinCol: spec.rowFactor + ' within each ' + spec.colFactor,
        colMeans: spec.colFactor + ' means (main effect, averaged over ' + spec.rowFactor + ')',
        rowMeans: spec.rowFactor + ' means (main effect, averaged over ' + spec.colFactor + ')',
        cells: 'every cell mean vs every other cell',
      };
      const dirText = dirTextMap[spec.phdir] || dirTextMap.colsWithinRow;
      const node = card('Two-way ANOVA', vnode, at,
        m.interaction ? null : el('div', { class: 'note', style: 'color:var(--warn)' }, '⚠ Only one value per cell — the interaction cannot be estimated, so this fits an additive model (assumes no interaction).'),
        el('div', { class: 'section-label' }, 'Cell means (mean ± SD)'), cmeans,
        el('div', { class: 'section-label' }, 'Multiple comparisons: ' + dirText + ' (' + posthocName(spec.phmethod) + ')'),
        twoWayPosthocTable(ph),
        residualNormalityNote(cm.cells));
      const sigInfo = phSigForGrouped(ph);
      const gspec = { chartType: 'grouped', cells: cm.cells, rowNames: cm.rowNames, colNames: cm.colNames, opts: { title: table.name, yLabel: 'Value', errorType: 'sem', sig: sigInfo.sig, sigNote: sigInfo.note } };
      return wrap('Two-way ANOVA', node, gspec);
    }

    if (kind === 'srh') {
      const cm = table.cellsMatrix();
      const m = T.scheirerRayHare(cm.cells, cm.rowNames, cm.colNames, { rowFactor: spec.rowFactor, colFactor: spec.colFactor });
      if (m.error) {
        const node = card('Scheirer-Ray-Hare', el('div', { class: 'verdict warn' }, el('span', { class: 'vicon' }, '⚠'), el('span', {}, m.error)));
        return wrap('Scheirer-Ray-Hare', node, null);
      }
      const at = el('table', { class: 'stats' });
      at.append(el('thead', {}, el('tr', {}, ...['Source', 'H', 'df', 'P'].map((h) => el('th', {}, h)))));
      at.append(el('tbody', {}, ...m.effects.map((e) => el('tr', {}, el('td', {}, e.name), el('td', { class: 'num' }, num(e.H, 4)), el('td', { class: 'num' }, e.df), el('td', { class: 'num' }, fmtP(e.p))))));
      const sigEffects = m.effects.filter((e) => e.p < 0.05);
      const vnode = sigEffects.length
        ? el('div', { class: 'verdict sig' }, el('span', { class: 'vicon' }, '✓'), el('span', { html: 'Significant: ' + sigEffects.map((e) => e.name + ' (' + (e.p < 0.0001 ? 'p < 0.0001' : 'p = ' + fmtP(e.p)) + ')').join('; ') }))
        : el('div', { class: 'verdict ns' }, el('span', { class: 'vicon' }, '○'), el('span', {}, 'No effect reached significance.'));
      // cell medians (nonparametric summary)
      const med = (arr) => { const s = arr.slice().sort((x, y) => x - y); return T.quantile(s, 0.5); };
      const cmed = el('table', { class: 'stats' });
      cmed.append(el('thead', {}, el('tr', {}, el('th', {}, spec.rowFactor + ' \\ ' + spec.colFactor), ...cm.colNames.map((c) => el('th', {}, c)))));
      cmed.append(el('tbody', {}, ...cm.rowNames.map((rn, i) => el('tr', {}, el('td', {}, rn), ...cm.colNames.map((_, j) => el('td', { class: 'num' }, cm.cells[i][j].length ? num(med(cm.cells[i][j])) + ' (n=' + cm.cells[i][j].length + ')' : '—'))))));
      const node = card('Scheirer-Ray-Hare test (nonparametric two-way)', vnode, at,
        m.interaction ? null : el('div', { class: 'note', style: 'color:var(--warn)' }, '⚠ Only one value per cell — the interaction cannot be estimated (additive model).'),
        el('div', { class: 'section-label' }, 'Cell medians'), cmed,
        el('div', { class: 'note' }, 'H statistics are compared to the chi-square distribution. This is the two-way analogue of the Kruskal-Wallis test.'));
      const gspec = { chartType: 'grouped', cells: cm.cells, rowNames: cm.rowNames, colNames: cm.colNames, opts: { title: table.name, yLabel: 'Value', errorType: 'sem' } };
      return wrap('Scheirer-Ray-Hare', node, gspec);
    }
    throw new Error('Unknown analysis: ' + kind);
  }

  function assumptionNote(...arrs) {
    const checks = arrs.map((a, i) => { if (a.length < 3) return null; const sw = N.shapiroWilk(a); return sw.error ? null : { i, p: sw.p }; }).filter(Boolean);
    if (!checks.length) return null;
    const bad = checks.filter((c) => c.p < 0.05);
    return el('div', { class: 'assump ' + (bad.length ? 'fail' : 'pass') },
      bad.length ? `⚠ Normality check: ${bad.length} group(s) deviate from normal (Shapiro-Wilk p < 0.05). Consider a non-parametric test (Mann-Whitney/Wilcoxon).` : '✓ Normality check passed (Shapiro-Wilk p ≥ 0.05 for all groups).');
  }
  function assumptionNoteMulti(groups) { return assumptionNote(...groups.map((g) => g.values)); }

  function posthocName(m) { return { tukey: 'Tukey HSD', dunnett: "Dunnett (vs control)", bonferroni: 'Bonferroni', sidak: 'Šídák', 'holm-sidak': 'Holm-Šídák', custom: 'Selected comparisons' }[m] || m; }
  function posthocTable(ph, method, isDunn) {
    const t = el('table', { class: 'stats' });
    const cols = method === 'tukey' ? ['Comparison', 'Mean diff', '95% CI', 'q', 'P', ''] : isDunn ? ['Comparison', 'z', 'P (adj)', ''] : method === 'dunnett' ? ['Comparison', 'Mean diff', 't', 'P', ''] : ['Comparison', 'Mean diff', 'P (adj)', ''];
    t.append(el('thead', {}, el('tr', {}, ...cols.map((h) => el('th', {}, h)))));
    const tb = el('tbody');
    ph.comparisons.forEach((c) => {
      const cells = [el('td', {}, `${c.a} vs ${c.b}`)];
      if (method === 'tukey') { cells.push(el('td', { class: 'num' }, num(c.diff)), el('td', { class: 'num' }, `${num(c.ci95lo, 3)} – ${num(c.ci95hi, 3)}`), el('td', { class: 'num' }, num(c.q, 3)), el('td', { class: 'num' }, fmtP(c.p))); }
      else if (isDunn) { cells.push(el('td', { class: 'num' }, num(c.z, 3)), el('td', { class: 'num' }, fmtP(c.p))); }
      else if (method === 'dunnett') { cells.push(el('td', { class: 'num' }, num(c.diff)), el('td', { class: 'num' }, num(c.t, 3)), el('td', { class: 'num' }, fmtP(c.p))); }
      else { cells.push(el('td', { class: 'num' }, num(c.diff)), el('td', { class: 'num' }, fmtP(c.p))); }
      cells.push(el('td', { class: 'num sig-star' }, c.sig ? stars(c.p) : 'ns'));
      tb.append(el('tr', {}, ...cells));
    });
    t.append(tb); return t;
  }
  // Every post-hoc comparison becomes a candidate bracket. Significant ones are shown
  // by default (capped so a busy figure isn't flooded); the rest ride along with on:false
  // so the graph's "Comparisons shown" list can toggle any of them. See renderGraphView.
  function sigFromPosthoc(ph, groups) {
    const idx = {}; groups.forEach((g, i) => { idx[g.name] = i; });
    let shown = 0;
    return ph.comparisons
      .map((c) => ({ i: idx[c.a], j: idx[c.b], name: `${c.a} vs ${c.b}`, label: stars(c.p), p: c.p, sig: !!c.sig }))
      .filter((s) => s.i != null && s.j != null)
      .map((s) => { const on = s.sig && shown < 6; if (on) shown++; return Object.assign(s, { on }); });
  }
  function twoWayPosthocTable(ph) {
    const t = el('table', { class: 'stats' });
    const hasWithin = ph.direction === 'colsWithinRow' || ph.direction === 'rowsWithinCol';
    const statCol = ph.method === 'tukey' ? 'q' : 't', pCol = ph.method === 'tukey' ? 'P' : 'P (adj)';
    const cols = (hasWithin ? ['Within'] : []).concat(['Comparison', 'Mean diff', statCol, pCol, '']);
    t.append(el('thead', {}, el('tr', {}, ...cols.map((h) => el('th', {}, h)))));
    const tb = el('tbody');
    if (!ph.comparisons.length) tb.append(el('tr', {}, el('td', { colspan: cols.length, class: 'muted' }, 'No comparisons available for this design.')));
    ph.comparisons.forEach((c) => {
      const cells = [];
      if (hasWithin) cells.push(el('td', {}, c.within));
      cells.push(el('td', {}, c.a + ' vs ' + c.b), el('td', { class: 'num' }, num(c.diff)));
      cells.push(el('td', { class: 'num' }, ph.method === 'tukey' ? num(c.q, 3) : num(c.t, 3)));
      cells.push(el('td', { class: 'num' }, fmtP(c.p)));
      cells.push(el('td', { class: 'num sig-star' }, c.sig ? stars(c.p) : 'ns'));
      tb.append(el('tr', {}, ...cells));
    });
    t.append(tb); return t;
  }
  // Map each two-way post-hoc comparison to a significance bracket on the grouped-bar
  // figure (categories = rows, bars-within = column groups). Cell-level comparisons
  // (columns within a row, rows within a column, or every cell vs every cell) reference
  // their two bars via {ca,ja,cb,jb}; a bracket may span bars in the same cluster OR
  // across clusters. Significant ones are shown by default, capped so a busy figure
  // isn't flooded; the rest ride along on:false so the graph's "Comparisons shown" list
  // can toggle any of them. Main-effect comparisons of marginal means (colMeans/rowMeans)
  // have no single bar to anchor to, so they return an explanatory note instead.
  function phSigForGrouped(ph) {
    let shown = 0;
    const sig = ph.comparisons
      .filter((c) => c.cellA && c.cellB)
      .map((c) => ({
        ca: c.cellA[0], ja: c.cellA[1], cb: c.cellB[0], jb: c.cellB[1],
        name: (c.within && c.within !== '—' ? c.within + ': ' : '') + c.a + ' vs ' + c.b,
        label: stars(c.p), p: c.p, sig: !!c.sig,
      }))
      .filter((s) => s.ca != null && s.ja != null && s.cb != null && s.jb != null)
      .map((s) => { const on = s.sig && shown < 8; if (on) shown++; return Object.assign(s, { on }); });
    let note = null;
    if (!sig.length && (ph.direction === 'colMeans' || ph.direction === 'rowMeans')) {
      const which = ph.direction === 'colMeans' ? 'Column-group' : 'Row';
      const over = ph.direction === 'colMeans' ? 'rows' : 'column groups';
      note = which + ' main-effect comparisons average over the ' + over + ', so no single bar represents them — they aren’t drawn on the figure. See the multiple-comparisons table above for these p-values.';
    }
    return { sig, note };
  }
  function residualNormalityNote(cells) {
    const res = [];
    cells.forEach((row) => row.forEach((v) => { if (v.length >= 2) { const m = v.reduce((s, x) => s + x, 0) / v.length; v.forEach((x) => res.push(x - m)); } }));
    if (res.length < 8) return null;
    const sw = N.shapiroWilk(res);
    if (sw.error) return null;
    return el('div', { class: 'assump ' + (sw.p < 0.05 ? 'fail' : 'pass') },
      sw.p < 0.05 ? '⚠ Residuals deviate from normal (Shapiro-Wilk p < 0.05). Two-way ANOVA is fairly robust, but interpret with care.' : '✓ Residuals are consistent with normality (Shapiro-Wilk p ≥ 0.05).');
  }

  // ---------- column / group renaming ----------
  // Renaming happens inline via the header inputs (click, or right-click →
  // Rename); on change we propagate the new name into any graphs already
  // derived from this table so they reflect it too.
  // Rewrite "A vs B"-style comparison labels when one side is renamed.
  function renameInComparison(name, oldName, newName) {
    if (typeof name !== 'string') return name;
    return name.split(' vs ').map((p) => (p === oldName ? newName : p)).join(' vs ');
  }
  // Update every graph derived from this table so it reflects the new column name.
  function propagateColumnRename(table, oldName, newName, ci) {
    App.graphs.forEach((gr) => {
      if (gr.tableId !== table.id) return;
      const spec = gr.spec || {}; const o = spec.opts || {};
      if (Array.isArray(spec.groups)) spec.groups.forEach((g) => { if (g.name === oldName) g.name = newName; });
      if (o.labelA === oldName) o.labelA = newName;
      if (o.labelB === oldName) o.labelB = newName;
      if (spec.chartType === 'xy') {
        if (ci === 0 && o.xLabel === oldName) o.xLabel = newName;
        if (ci === 1 && o.yLabel === oldName) o.yLabel = newName;
      }
      if (Array.isArray(o.sig)) o.sig.forEach((s) => { if (s && s.name) s.name = renameInComparison(s.name, oldName, newName); });
    });
  }
  // Grouped tables: the renamed group is a column factor level.
  function propagateGroupedRename(table, oldName, newName) {
    App.graphs.forEach((gr) => {
      if (gr.tableId !== table.id) return;
      const spec = gr.spec || {};
      if (Array.isArray(spec.colNames)) spec.colNames = spec.colNames.map((n) => (n === oldName ? newName : n));
      // Column-style analyses of grouped data name units "group · row".
      if (Array.isArray(spec.groups)) spec.groups.forEach((g) => {
        if (g.name === oldName) g.name = newName;
        else if (typeof g.name === 'string' && g.name.startsWith(oldName + ' · ')) g.name = newName + g.name.slice(oldName.length);
      });
    });
  }

  // Lightweight popup menu used by header right-clicks. items:
  // [{ label, onClick, danger }] with { sep: true } for separators.
  function showContextMenu(x, y, items) {
    const existing = document.getElementById('ctx-menu'); if (existing) existing.remove();
    const menu = el('div', { id: 'ctx-menu', class: 'ctx-menu' });
    items.forEach((it) => {
      if (it.sep) { menu.append(el('div', { class: 'ctx-sep' })); return; }
      menu.append(el('div', { class: 'ctx-item' + (it.danger ? ' danger' : ''), onclick: () => { menu.remove(); it.onClick(); } }, it.label));
    });
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function h(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', h); }
    }), 0);
  }

  // ---------- graph spec builders ----------
  function graphSpec(chartType, groups, opts) {
    return { chartType, groups: groups.map((g) => ({ name: g.name, values: g.values.slice() })), opts: Object.assign({ errorType: 'sem' }, opts) };
  }
  function xySpec(table, regression, annotation) {
    const xr = table.rawColumn(0), yr = table.rawColumn(1);
    const xs = [], ys = [];
    for (let i = 0; i < xr.length; i++) if (xr[i] !== '' && yr[i] !== '' && !isNaN(+xr[i]) && !isNaN(+yr[i])) { xs.push(+xr[i]); ys.push(+yr[i]); }
    return { chartType: 'xy', xs, ys, regression, opts: { title: table.name, xLabel: table.columns[0].name, yLabel: table.columns[1].name, annotation } };
  }

  function buildSVG(spec) {
    const o = spec.opts || {};
    if (spec.chartType === 'bar') return Charts.barChart(spec.groups, Object.assign({ showPoints: o.showPoints }, o));
    if (spec.chartType === 'dot') return Charts.dotPlot(spec.groups, o);
    if (spec.chartType === 'box') return Charts.boxPlot(spec.groups, o);
    if (spec.chartType === 'paired') return Charts.pairedPlot(o.colA, o.colB, o);
    if (spec.chartType === 'xy') return Charts.xyPlot(spec.xs, spec.ys, Object.assign({ regression: spec.regression }, o));
    if (spec.chartType === 'survival') return Charts.survivalPlot(spec.curves, o);
    if (spec.chartType === 'grouped') return Charts.groupedBar(spec.cells, spec.rowNames, spec.colNames, o);
    if (spec.chartType === 'grouped-line') return Charts.groupedLine(spec.cells, spec.rowNames, spec.colNames, o);
    return '<svg viewBox="0 0 100 40"><text x="10" y="24">No chart</text></svg>';
  }

  // ---------- result view ----------
  function renderResultView(root, result) {
    if (!result) return;
    const head = el('div', { class: 'view-head' },
      el('h1', { class: 'view-title' }, result.name),
      el('div', { class: 'view-actions' },
        result.graphId ? el('button', { class: 'btn', onclick: () => setActive('graph', result.graphId) }, '◧ View graph') : null,
        el('button', { class: 'btn', onclick: () => copyResultText(result) }, '⧉ Copy'),
        el('button', { class: 'btn btn-ghost', onclick: () => deleteResult(result.id) }, '🗑 Delete')));
    root.append(head);
    root.append(result.html);
  }
  function copyResultText(result) {
    const text = result.html.innerText || result.html.textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Results copied'), () => toast('Copy failed'));
    else toast('Clipboard not available');
  }

  // ---------- graph view ----------
  function renderGraphView(root, graph) {
    if (!graph) return;
    const o = graph.spec.opts;
    const ct = graph.spec.chartType;
    if (['bar', 'dot', 'box', 'xy', 'grouped', 'grouped-line'].includes(ct)) o.yAxis = o.yAxis || { auto: true, min: '', max: '', log: false, sci: false, step: '' };
    if (['xy', 'survival'].includes(ct)) o.xAxis = o.xAxis || { auto: true, min: '', max: '', log: false, sci: false, step: '' };
    const srcTable = tableById(graph.tableId);
    const head = el('div', { class: 'view-head' },
      el('h1', { class: 'view-title' }, graph.name),
      el('div', { class: 'view-actions' },
        srcTable ? el('button', { class: 'btn btn-accent', onclick: () => openAnalyze(srcTable) }, '∑ Analyze') : null,
        srcTable ? el('button', { class: 'btn', onclick: () => setActive('data', srcTable.id) }, '▦ Data') : null,
        el('button', { class: 'btn', onclick: () => exportSVG(graph) }, '⭳ SVG'),
        el('button', { class: 'btn', onclick: () => exportPNG(graph) }, '⭳ PNG'),
        el('button', { class: 'btn btn-ghost', onclick: () => deleteGraph(graph.id) }, '🗑 Delete')));
    root.append(head);

    const wrap = el('div', { class: 'graph-wrap' });
    const canvas = el('div', { class: 'graph-canvas', id: 'graph-canvas' });
    canvas.innerHTML = buildSVG(graph.spec);
    wrap.append(canvas);

    const controls = el('div', { class: 'graph-controls' });
    const rerender = () => { canvas.innerHTML = buildSVG(graph.spec); saveState(); };

    // ---- category reordering (persists to spec; remaps significance brackets) ----
    const refresh = () => { saveState(); renderContent(); };
    const moveArr = (arr, idx) => idx.map((oi) => arr[oi]);
    function reorderGroups(from, to) {
      const idx = moveOrder(graph.spec.groups.length, from, to), inv = []; idx.forEach((oi, np) => (inv[oi] = np));
      graph.spec.groups = moveArr(graph.spec.groups, idx);
      if (Array.isArray(o.colors)) o.colors = moveArr(o.colors, idx);
      if (Array.isArray(o.markers)) o.markers = moveArr(o.markers, idx);
      if (o.pointMarkers) o.pointMarkers = remapPointGroups(o.pointMarkers, inv);
      if (o.sig) o.sig = o.sig.map((s) => Object.assign({}, s, { i: inv[s.i], j: inv[s.j] }));
      refresh();
    }
    function reorderRows(from, to) {
      const idx = moveOrder(graph.spec.rowNames.length, from, to), inv = []; idx.forEach((oi, np) => (inv[oi] = np));
      graph.spec.rowNames = moveArr(graph.spec.rowNames, idx);
      graph.spec.cells = moveArr(graph.spec.cells, idx);
      // remap the category index of every bracket endpoint: ca/cb (cross-category shape)
      // and legacy cat (older figures kept both endpoints in one category).
      if (o.sig) o.sig = o.sig.map((s) => { const t = Object.assign({}, s); if (t.cat != null) t.cat = inv[t.cat]; if (t.ca != null) t.ca = inv[t.ca]; if (t.cb != null) t.cb = inv[t.cb]; return t; });
      refresh();
    }
    function reorderSeries(from, to) {
      const idx = moveOrder(graph.spec.colNames.length, from, to), inv = []; idx.forEach((oi, np) => (inv[oi] = np));
      graph.spec.colNames = moveArr(graph.spec.colNames, idx);
      graph.spec.cells = graph.spec.cells.map((row) => moveArr(row, idx));
      if (Array.isArray(o.colors)) o.colors = moveArr(o.colors, idx);
      if (o.sig) o.sig = o.sig.map((s) => Object.assign({}, s, { ja: inv[s.ja], jb: inv[s.jb] }));
      refresh();
    }
    if (['bar', 'dot', 'box'].includes(ct)) enableCatDrag(canvas, reorderGroups);
    enableBarTooltip(canvas);
    if (['dot', 'bar', 'xy'].includes(ct)) enablePointSymbolEdit(canvas, graph, ct, refresh);

    // chart type (depends on data)
    const types = graph.spec.chartType === 'survival' ? [['survival', 'Survival curve']]
      : graph.spec.chartType === 'xy' ? [['xy', 'Scatter + regression']]
        : ['grouped', 'grouped-line'].includes(graph.spec.chartType) ? [['grouped', 'Grouped bar'], ['grouped-line', 'Line / XY']]
          : graph.spec.chartType === 'paired' ? [['paired', 'Before–after'], ['bar', 'Bar (group means)'], ['dot', 'Column scatter'], ['box', 'Box & whisker']]
            : [['bar', 'Bar + error'], ['dot', 'Column scatter'], ['box', 'Box & whisker']];
    controls.append(ctrlGroup('Chart type', el('select', { onchange: (e) => { graph.spec.chartType = e.target.value; refresh(); } }, ...types.map(([v, t]) => el('option', { value: v, selected: graph.spec.chartType === v }, t)))));

    if (['bar', 'dot', 'grouped', 'grouped-line'].includes(graph.spec.chartType)) {
      controls.append(ctrlGroup('Error bars', el('select', { onchange: (e) => { o.errorType = e.target.value; rerender(); } },
        ...[['sem', 'Mean ± SEM'], ['sd', 'Mean ± SD'], ['ci95', 'Mean ± 95% CI'], ['none', 'Mean only']].map(([v, t]) => el('option', { value: v, selected: o.errorType === v }, t)))));
    }
    if (['grouped', 'grouped-line'].includes(graph.spec.chartType)) {
      controls.append(ctrlGroup('Legend position', el('select', { onchange: (e) => { o.legendPosition = e.target.value; rerender(); } },
        ...[['right', 'Right of plot'], ['left', 'Left of plot'], ['top', 'Above plot'], ['bottom', 'Below plot']].map(([v, t]) => el('option', { value: v, selected: (o.legendPosition || 'right') === v }, t)))));
    }
    if (graph.spec.chartType === 'bar') {
      controls.append(ctrlGroup('', checkbox('Show individual points', o.showPoints, (v) => { o.showPoints = v; refresh(); })));
      controls.append(el('div', { class: 'ctrl-note' }, 'Tip: hover any bar to see its mean, median, mode & range.'));
    }
    if (graph.spec.chartType === 'survival') {
      controls.append(ctrlGroup('', checkbox('Show 95% CI bands', o.showCI, (v) => { o.showCI = v; rerender(); })));
      controls.append(ctrlGroup('', checkbox('Numbers at risk', o.atRisk !== false, (v) => { o.atRisk = v; rerender(); })));
    }
    // bar / box thickness & point spread (issue #15): narrower marks ⇒ more space between categories
    if (['bar', 'dot', 'box'].includes(graph.spec.chartType)) {
      const ctb = graph.spec.chartType;
      const wLabel = ctb === 'box' ? 'Box width' : ctb === 'dot' ? 'Point spread' : 'Bar width';
      const defFrac = ctb === 'bar' ? 0.6 : 0.5;
      const cur = () => (o.barWidth != null && isFinite(+o.barWidth)) ? +o.barWidth : defFrac;
      const readout = el('span', { class: 'width-readout' }, Math.round(cur() * 100) + '%');
      const slider = el('input', { type: 'range', min: '0.1', max: '1', step: '0.05', value: cur(),
        oninput: (e) => { o.barWidth = parseFloat(e.target.value); readout.textContent = Math.round(o.barWidth * 100) + '%'; rerender(); } });
      const sliderRow = el('div', { class: 'range-row' }, slider, readout);
      sliderRow.style.display = o.barWidth == null ? 'none' : 'flex';
      const auto = checkbox('Auto width', o.barWidth == null, (v) => {
        if (v) delete o.barWidth; else { o.barWidth = parseFloat(slider.value) || defFrac; readout.textContent = Math.round(o.barWidth * 100) + '%'; }
        sliderRow.style.display = v ? 'none' : 'flex'; rerender();
      });
      controls.append(ctrlGroup(wLabel, el('div', { class: 'axis-ctrls' }, auto, sliderRow)));
      controls.append(el('div', { class: 'ctrl-note' }, ctb === 'dot'
        ? 'Wider spreads the points apart; narrower packs them into a tighter column.'
        : 'Narrower ' + (ctb === 'box' ? 'boxes' : 'bars') + ' leave more space between categories.'));
    }
    // title & axis labels
    controls.append(ctrlGroup('Title', el('input', { type: 'text', value: o.title || '', oninput: (e) => { o.title = e.target.value; rerender(); } })));
    controls.append(ctrlGroup('Y-axis label', el('input', { type: 'text', value: o.yLabel || '', oninput: (e) => { o.yLabel = e.target.value; rerender(); } })));
    if (o.yAxis) controls.append(axisScaleControls('Y', o.yAxis, { log: true, rerender }));
    if (ct === 'xy' || ct === 'survival') controls.append(ctrlGroup('X-axis label', el('input', { type: 'text', value: o.xLabel || '', oninput: (e) => { o.xLabel = e.target.value; rerender(); } })));
    if (o.xAxis) controls.append(axisScaleControls('X', o.xAxis, { log: ct === 'xy', rerender }));
    // fonts: title size, axis-label size (also scales category & tick text), shared bold (issue #16)
    o.fontStyle = o.fontStyle || {};
    const fst = o.fontStyle, feff = Charts.textStyleOf(o);
    controls.append(ctrlGroup('Title size (px)', el('input', { type: 'number', min: '8', max: '40', step: '0.5', value: feff.titleSize, oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { fst.titleSize = v; rerender(); } } })));
    controls.append(ctrlGroup('Axis label size (px)', el('input', { type: 'number', min: '7', max: '22', step: '0.5', value: feff.labelSize, oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { fst.labelSize = v; rerender(); } } })));
    controls.append(ctrlGroup('', checkbox('Bold title & axis labels', feff.bold, (v) => { fst.bold = v; rerender(); })));
    controls.append(el('div', { class: 'ctrl-note' }, 'Axis-label size also scales the category names and tick numbers; tick numbers stay smaller so they don’t crowd the plot.'));

    // ---- color palette + per-series color overrides ----
    // only chart types whose builders honor opts.colors (paired/xy use fixed colors)
    const colorItems = ['bar', 'dot', 'box'].includes(ct) ? (graph.spec.groups || []).map((g) => g.name)
      : ['grouped', 'grouped-line'].includes(ct) ? graph.spec.colNames
        : (ct === 'survival' && graph.spec.curves) ? graph.spec.curves.map((c) => c.name)
          : null;
    if (colorItems && colorItems.length) {
      // one color per item, cycling the current palette so swatches line up 1:1
      const src = (o.colors && o.colors.length) ? o.colors : Charts.PALETTE;
      o.colors = Charts.expandPalette(src, colorItems.length).map(toHex);
      if (o.paletteId == null) o.paletteId = detectPaletteId(o.colors);
      controls.append(ctrlGroup('Color palette', palettePicker(o, colorItems.length, refresh)));
      const sw = el('div', { class: 'swatch' });
      colorItems.forEach((nm, i) => {
        sw.append(el('input', { type: 'color', value: toHex(o.colors[i]), title: nm, oninput: (e) => { o.colors[i] = e.target.value; o.paletteId = null; rerender(); } }));
      });
      controls.append(ctrlGroup('Fine-tune colors', sw));
    }
    // ---- bar outline: custom border color + bold (issue #14) ----
    if (ct === 'bar' || ct === 'grouped') {
      o.barBorder = o.barBorder || {};
      const bb = o.barBorder;
      const picker = el('input', { type: 'color', value: toHex(bb.color || '#1c2733'),
        oninput: (e) => { bb.color = e.target.value; rerender(); } });
      const pickerRow = el('div', { class: 'range-row' }, picker);
      pickerRow.style.display = bb.color ? 'flex' : 'none';
      const custom = checkbox('Custom border color', !!bb.color, (v) => {
        bb.color = v ? (bb.color || '#1c2733') : null;
        pickerRow.style.display = v ? 'flex' : 'none';
        rerender();
      });
      const bold = checkbox('Bold border', !!bb.bold, (v) => { bb.bold = v; rerender(); });
      controls.append(ctrlGroup('Bar border', el('div', { class: 'axis-ctrls' }, custom, pickerRow, bold)));
      controls.append(el('div', { class: 'ctrl-note' }, 'Off matches each bar’s fill colour; turn on to outline every bar in one colour.'));
    }
    // ---- point symbols (per-series marker shape, plus per-point overrides) ----
    if (ct === 'dot' || (ct === 'bar' && o.showPoints)) {
      o.markers = o.markers || [];
      const box = el('div', { class: 'marker-list' });
      (graph.spec.groups || []).forEach((g, i) => {
        const sel = el('select', { onchange: (e) => { o.markers[i] = e.target.value; rerender(); } },
          ...Charts.MARKERS.map(([v, t]) => el('option', { value: v, selected: (o.markers[i] || 'circle') === v }, t)));
        box.append(el('div', { class: 'marker-row' }, el('span', { class: 'marker-name', title: g.name }, g.name), sel));
      });
      controls.append(ctrlGroup('Point symbols', box));
      controls.append(el('div', { class: 'ctrl-note' }, 'Double-click a single point on the figure to give that one replicate its own symbol.'));
      appendCustomPointsNote(controls, o, refresh);
    }
    if (ct === 'xy') {
      controls.append(ctrlGroup('Point symbol', el('select', { onchange: (e) => { o.marker = e.target.value; rerender(); } },
        ...Charts.MARKERS.map(([v, t]) => el('option', { value: v, selected: (o.marker || 'circle') === v }, t)))));
      controls.append(ctrlGroup('Point color', el('div', { class: 'swatch' },
        el('input', { type: 'color', value: toHex(o.pointColor || '#2563eb'), title: 'Point color', oninput: (e) => { o.pointColor = e.target.value; rerender(); } }))));
      controls.append(el('div', { class: 'ctrl-note' }, 'Double-click a single point on the figure to give it its own symbol.'));
      appendCustomPointsNote(controls, o, refresh);
    }
    // significance brackets: pick which comparisons appear, then style them
    if (o.sig && o.sig.length && ['bar', 'dot', 'box', 'grouped'].includes(ct)) {
      controls.append(ctrlGroup('Comparisons shown', sigChecklist(graph.spec, rerender)));
      if (o.sig.length > 1) controls.append(el('div', { class: 'ctrl-note' }, 'Tick a comparison to draw its significance bracket on the figure.'));
      o.sigStyle = o.sigStyle || {};
      const ss = o.sigStyle, eff = Charts.sigStyleOf(o);
      controls.append(ctrlGroup('Significance labels', el('select', { onchange: (e) => { ss.notation = e.target.value; rerender(); } },
        ...[['stars', 'Asterisks (*, **, ***)'], ['pvalue', 'Exact P value'], ['psummary', 'P < threshold']].map(([v, t]) => el('option', { value: v, selected: eff.notation === v }, t)))));
      const colorSw = el('div', { class: 'swatch' }, el('input', { type: 'color', value: toHex(eff.color), title: 'Label & bracket color', oninput: (e) => { ss.color = e.target.value; rerender(); } }));
      controls.append(ctrlGroup('Significance color', colorSw));
      controls.append(ctrlGroup('Text size (px)', el('input', { type: 'number', min: '8', max: '30', step: '0.5', value: eff.fontSize, oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { ss.fontSize = v; rerender(); } } })));
      controls.append(ctrlGroup('', checkbox('Bold labels', eff.bold, (v) => { ss.bold = v; rerender(); })));
      const thick = ctrlGroup('Bracket thickness', el('input', { type: 'number', min: '0.5', max: '4', step: '0.1', value: eff.lineWidth, oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { ss.lineWidth = v; rerender(); } } }));
      thick.style.display = eff.showLine ? '' : 'none';
      controls.append(ctrlGroup('', checkbox('Show connecting bracket', eff.showLine, (v) => { ss.showLine = v; thick.style.display = v ? '' : 'none'; rerender(); })));
      controls.append(thick);
    } else if (o.sigNote && ct === 'grouped') {
      controls.append(ctrlGroup('Comparisons', el('div', { class: 'ctrl-note' }, o.sigNote)));
    }
    // reorder categories (drag chips; also draggable directly on bar/dot/box charts)
    if (['bar', 'dot', 'box'].includes(ct) && graph.spec.groups && graph.spec.groups.length > 1)
      controls.append(ctrlGroup('Category order — drag', reorderChips(graph.spec.groups.map((g) => g.name), reorderGroups)));
    if (['grouped', 'grouped-line'].includes(ct)) {
      if (graph.spec.rowNames && graph.spec.rowNames.length > 1) controls.append(ctrlGroup('Row order — drag', reorderChips(graph.spec.rowNames, reorderRows)));
      if (graph.spec.colNames && graph.spec.colNames.length > 1) controls.append(ctrlGroup('Series order — drag', reorderChips(graph.spec.colNames, reorderSeries)));
    }
    wrap.append(controls);
    root.append(wrap);
  }
  function ctrlGroup(label, control) { return el('div', { class: 'ctrl-group' }, label ? el('label', {}, label) : null, control); }
  function checkbox(label, checked, on) { const c = el('input', { type: 'checkbox', onchange: (e) => on(e.target.checked) }); if (checked) c.checked = true; return el('label', { class: 'ctrl-row' }, c, label); }
  // Checklist of every candidate significance comparison; ticking one draws its bracket
  // (charts.js hides entries with on:false). Handles column charts (i/j group indices)
  // and grouped bars (cat/ja/jb), and figures saved before names existed (falls back to
  // positions). Toggling only re-renders the SVG, so the box is left scrollable & compact.
  function sigChecklist(spec, rerender) {
    const o = spec.opts, grouped = spec.chartType === 'grouped';
    const nameOf = (b) => {
      if (b.name) return b.name;
      if (grouped) {
        const rn = (spec.rowNames || [])[b.cat], ca = (spec.colNames || [])[b.ja], cb = (spec.colNames || [])[b.jb];
        return `${rn != null ? rn + ': ' : ''}${ca != null ? ca : '#' + (b.ja + 1)} vs ${cb != null ? cb : '#' + (b.jb + 1)}`;
      }
      const ga = (spec.groups || [])[b.i], gb = (spec.groups || [])[b.j];
      return `${ga ? ga.name : '#' + (b.i + 1)} vs ${gb ? gb.name : '#' + (b.j + 1)}`;
    };
    const box = el('div', { class: 'sig-list' });
    o.sig.forEach((b) => {
      const cb = el('input', { type: 'checkbox', onchange: (e) => { b.on = e.target.checked; rerender(); } });
      if (b.on !== false) cb.checked = true;
      const nm = nameOf(b), badge = b.p != null ? stars(b.p) : (b.label || '');
      box.append(el('label', { class: 'sig-item', title: nm },
        cb, el('span', { class: 'sig-name' }, nm),
        el('span', { class: 'sig-badge' + (b.sig ? ' is-sig' : '') }, badge)));
    });
    return box;
  }
  function toHex(c) { if (/^#/.test(c)) return c; return '#0d9488'; }
  // If the current colors exactly match a known palette (cycled to length), return its
  // id so the picker highlights it; else null (e.g. after a manual per-series tweak).
  function detectPaletteId(colors) {
    const norm = colors.map((c) => String(c).toLowerCase());
    const hit = Charts.PALETTES.find((p) => Charts.expandPalette(p.colors, norm.length).every((c, i) => c.toLowerCase() === norm[i]));
    return hit ? hit.id : null;
  }
  // Scrollable gallery of named color palettes, grouped with subheaders and a "CB"
  // badge on colorblind-safe schemes. Clicking a row applies it to every group/series
  // (cycling colors to the item count) and records opts.paletteId for the highlight.
  function palettePicker(o, n, refresh) {
    const box = el('div', { class: 'palette-list' });
    const preview = Math.min(Math.max(n, 5), 10);
    let lastGroup = null;
    Charts.PALETTES.forEach((p) => {
      if (p.group !== lastGroup) { box.append(el('div', { class: 'palette-group-head' }, p.group)); lastGroup = p.group; }
      const strip = el('div', { class: 'palette-swatches' });
      Charts.expandPalette(p.colors, preview).forEach((c) => strip.append(el('span', { class: 'palette-sw', style: 'background:' + c })));
      const meta = el('div', { class: 'palette-meta' },
        el('span', { class: 'palette-name' }, p.name),
        p.cb ? el('span', { class: 'pal-badge', title: 'Colorblind-safe' }, 'CB') : null);
      box.append(el('div', {
        class: 'palette-item' + (o.paletteId === p.id ? ' selected' : ''),
        title: p.name + (p.cb ? ' — colorblind-safe' : ''),
        onclick: () => { o.colors = Charts.expandPalette(p.colors, n).map(toHex); o.paletteId = p.id; refresh(); },
      }, meta, strip));
    });
    return box;
  }
  function numInput(val, ph, on) { return el('input', { type: 'number', step: 'any', placeholder: ph, value: (val === 0 || val) ? val : '', oninput: (e) => on(e.target.value.trim()) }); }
  // one labeled group: Auto-range checkbox → reveals Min/Max, plus optional Log + Scientific-notation toggles
  function axisScaleControls(dim, axis, cfg) {
    const rr = cfg.rerender;
    const minI = numInput(axis.min, 'Min', (v) => { axis.min = v; if (axis.auto === false) rr(); });
    const maxI = numInput(axis.max, 'Max', (v) => { axis.max = v; if (axis.auto === false) rr(); });
    const rangeRow = el('div', { class: 'range-row' }, minI, maxI);
    rangeRow.style.display = axis.auto === false ? 'flex' : 'none';
    const kids = [checkbox('Auto range', axis.auto !== false, (v) => { axis.auto = v; rangeRow.style.display = v ? 'none' : 'flex'; rr(); }), rangeRow];
    if (cfg.log) kids.push(checkbox('Log scale', !!axis.log, (v) => { axis.log = v; rr(); }));
    kids.push(checkbox('Scientific notation', !!axis.sci, (v) => { axis.sci = v; rr(); }));
    // custom tick interval (blank = automatic); ignored on a log axis, where ticks are decades
    const stepI = numInput(axis.step, 'auto', (v) => { axis.step = v; rr(); });
    stepI.min = '0';
    kids.push(el('div', { class: 'range-row axis-step' }, el('span', {}, 'Tick interval'), stepI));
    return ctrlGroup(dim + '-axis scale', el('div', { class: 'axis-ctrls' }, ...kids));
  }
  // new index order after moving item from→to
  function moveOrder(n, from, to) { const idx = []; for (let i = 0; i < n; i++) idx.push(i); const x = idx.splice(from, 1)[0]; idx.splice(to, 0, x); return idx; }
  function reorderChips(names, onMove) {
    const box = el('div', { class: 'chips' });
    names.forEach((nm, i) => {
      const chip = el('div', { class: 'chip', draggable: 'true', title: 'Drag to reorder' }, '⠿ ' + nm);
      chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; chip.classList.add('dragging'); });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
      chip.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; chip.classList.add('drop-target'); });
      chip.addEventListener('dragleave', () => chip.classList.remove('drop-target'));
      chip.addEventListener('drop', (e) => { e.preventDefault(); chip.classList.remove('drop-target'); const from = +e.dataTransfer.getData('text/plain'); if (!isNaN(from) && from !== i) onMove(from, i); });
      box.append(chip);
    });
    return box;
  }
  // remap per-point overrides ("group:index" → shape) after a category reorder
  function remapPointGroups(pm, inv) {
    const out = {};
    for (const k in pm) { const s = k.split(':'); out[inv[+s[0]] + ':' + s[1]] = pm[k]; }
    return out;
  }
  // small "N custom points · clear all" line under the point-symbol controls
  function appendCustomPointsNote(controls, o, refresh) {
    const n = o.pointMarkers ? Object.keys(o.pointMarkers).length : 0;
    if (!n) return;
    controls.append(el('div', { class: 'ctrl-note' }, `${n} custom point${n > 1 ? 's' : ''} · `,
      el('span', { class: 'ctrl-link', onclick: () => { o.pointMarkers = {}; refresh(); } }, 'clear all')));
  }
  // double-click a single point to override its symbol. Hit-tests by nearest .data-point
  // (charts.js stamps each point's group/index/coords) so overlays don't block it.
  function enablePointSymbolEdit(canvas, graph, ct, refresh) {
    canvas.addEventListener('dblclick', (ev) => {
      const hit = pointAt(canvas, ev);
      if (!hit) return;
      ev.preventDefault();
      const pg = +hit.getAttribute('data-pg'), pi = +hit.getAttribute('data-pi'), key = pg + ':' + pi;
      const o = graph.spec.opts; o.pointMarkers = o.pointMarkers || {};
      const g = graph.spec.groups && graph.spec.groups[pg];
      const label = ct === 'xy' ? `Point ${pi + 1}` : `${g ? g.name : 'Group ' + (pg + 1)} · point ${pi + 1}`;
      openPointSymbolMenu(ev.clientX, ev.clientY, o.pointMarkers[key] || null, label, (shape) => {
        if (shape) o.pointMarkers[key] = shape; else delete o.pointMarkers[key];
        refresh();
      });
    });
  }
  // nearest data point (in SVG user units) to the click, or null if none is close
  function pointAt(canvas, ev) {
    const svg = canvas.querySelector('svg');
    if (!svg || !svg.getScreenCTM) return null;
    const pts = svg.querySelectorAll('.data-point');
    if (!pts.length) return null;
    const ctm = svg.getScreenCTM(); if (!ctm) return null;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    let best = null, bestD = Infinity;
    pts.forEach((el2) => { const dx = +el2.getAttribute('data-px') - p.x, dy = +el2.getAttribute('data-py') - p.y; const d = dx * dx + dy * dy; if (d < bestD) { bestD = d; best = el2; } });
    return bestD <= 16 * 16 ? best : null;
  }
  function closePointMenu() { const m = document.getElementById('pt-menu'); if (m) { if (m._cleanup) m._cleanup(); m.remove(); } }
  // floating popup at (clientX,clientY): pick a shape for this one point, or reset it
  function openPointSymbolMenu(clientX, clientY, current, label, onPick) {
    closePointMenu();
    const shapes = el('div', { class: 'pt-menu-shapes' },
      ...Charts.MARKERS.map(([v, t]) => el('button', { class: 'pt-shape' + (current === v ? ' active' : ''), title: t, onclick: () => { onPick(v); closePointMenu(); } }, t.split(' ')[0])));
    const menu = el('div', { class: 'pt-menu', id: 'pt-menu' },
      el('div', { class: 'pt-menu-title' }, label),
      shapes,
      el('button', { class: 'pt-reset', onclick: () => { onPick(null); closePointMenu(); } }, '↺ Reset to series default'));
    document.body.append(menu);
    const pad = 10, mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = clientX + pad, top = clientY + pad;
    if (left + mw > window.innerWidth - 8) left = clientX - pad - mw;
    if (top + mh > window.innerHeight - 8) top = clientY - pad - mh;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    const outside = (e) => { if (!menu.contains(e.target)) closePointMenu(); };
    const esc = (e) => { if (e.key === 'Escape') closePointMenu(); };
    menu._cleanup = () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); };
    setTimeout(() => { document.addEventListener('mousedown', outside); document.addEventListener('keydown', esc); }, 0);
  }
  // drag a category directly on the chart via the transparent .cat-hit rects
  function enableCatDrag(canvas, onMove) {
    let from = null;
    canvas.addEventListener('mousedown', (e) => {
      const hit = e.target.closest && e.target.closest('.cat-hit');
      if (!hit) return;
      from = +hit.dataset.i; canvas.classList.add('dragging'); e.preventDefault();
      const up = (ev) => {
        document.removeEventListener('mouseup', up); canvas.classList.remove('dragging');
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const tgt = under && under.closest ? under.closest('.cat-hit') : null;
        if (tgt && from != null) { const to = +tgt.dataset.i; if (!isNaN(to) && to !== from) onMove(from, to); }
        from = null;
      };
      document.addEventListener('mouseup', up);
    });
  }
  // hover tooltip for bar charts — mean / median / mode / range per group, at a glance.
  // Reads data-* attributes off the transparent .cat-hit rects emitted by Charts.barChart.
  function enableBarTooltip(canvas) {
    const ensureTip = () => {
      let t = document.getElementById('chart-tip');
      if (!t) { t = el('div', { class: 'chart-tip', id: 'chart-tip' }); document.body.appendChild(t); }
      return t;
    };
    const hide = () => { const t = document.getElementById('chart-tip'); if (t) t.style.display = 'none'; };
    canvas.addEventListener('mousemove', (e) => {
      const hit = e.target.closest && e.target.closest('.cat-hit[data-tip]');
      if (!hit || canvas.classList.contains('dragging')) { hide(); return; }
      const d = hit.dataset;
      const tip = ensureTip();
      tip.innerHTML = '';
      tip.append(el('div', { class: 'tip-title' }, d.name));
      [['Mean', d.mean], ['Median', d.median], ['Mode', d.mode], ['Range', d.range], ['n', d.n]]
        .forEach(([k, v]) => tip.append(el('div', { class: 'tip-row' }, el('span', {}, k), el('b', {}, v))));
      tip.style.display = 'block';
      const pad = 14, tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = e.clientX + pad, top = e.clientY + pad;
      if (left + tw > window.innerWidth - 8) left = e.clientX - pad - tw;
      if (top + th > window.innerHeight - 8) top = e.clientY - pad - th;
      tip.style.left = Math.max(8, left) + 'px';
      tip.style.top = Math.max(8, top) + 'px';
    });
    canvas.addEventListener('mouseleave', hide);
    canvas.addEventListener('mousedown', hide);   // don't cover the chart while dragging to reorder
  }

  function exportSVG(graph) { download((graph.name || 'figure').replace(/\W+/g, '_') + '.svg', buildSVG(graph.spec), 'image/svg+xml'); toast('SVG downloaded'); }
  function exportPNG(graph) { Charts.svgToPNG(buildSVG(graph.spec), 2, (blob) => { download((graph.name || 'figure').replace(/\W+/g, '_') + '.png', blob); toast('PNG downloaded'); }); }

  function makeQuickGraphSpec(table) {
    if (table.type === 'survival') {
      const res = S.analyze(table.survivalRows());
      return { chartType: 'survival', curves: res.groups.map((nm) => ({ name: nm, steps: res.km[nm].steps, censorTimes: res.km[nm].censorTimes, n0: res.km[nm].n })), opts: { title: table.name, xLabel: 'Time', yLabel: 'Percent survival', percent: true, atRisk: true } };
    }
    if (table.type === 'xy') {
      const r = T.linearRegression(table.rawColumn(0), table.rawColumn(1));
      return xySpec(table, r, `Y = ${num(r.slope, 3)}X ${r.intercept >= 0 ? '+' : '−'} ${num(Math.abs(r.intercept), 3)}`);
    }
    if (table.type === 'grouped') {
      const cm = table.cellsMatrix();
      return { chartType: 'grouped', cells: cm.cells, rowNames: cm.rowNames, colNames: cm.colNames, opts: { title: table.name, yLabel: 'Value', errorType: 'sem' } };
    }
    return graphSpec('bar', table.groups(), { title: table.name, yLabel: 'Value', errorType: 'sem' });
  }
  function quickGraph(table, options = {}) {
    if (!table.hasData()) { toast('Enter or paste some data first'); return null; }
    let graph = App.graphs.find((g) => g.tableId === table.id && !App.results.some((r) => r.graphId === g.id));
    if (graph) mergeLinkedGraphSpec(graph, makeQuickGraphSpec(table));
    else {
      graph = { id: 'gr_' + App.counter++, name: table.name, tableId: table.id, spec: makeQuickGraphSpec(table) };
      App.graphs.push(graph);
    }
    if (options.activate !== false) { renderNavigator(); setActive('graph', graph.id); saveState(); }
    return graph;
  }
  function graphAll() {
    const graphs = App.tables.filter((table) => table.hasData()).map((table) => quickGraph(table, { activate: false })).filter(Boolean);
    renderNavigator();
    if (graphs.length) setActive('graph', graphs[0].id);
    saveState();
    toast(graphs.length ? 'Graph ready for ' + graphs.length + ' data table' + (graphs.length === 1 ? '' : 's') : 'Enter data into a table first');
  }

  // ---------- import ----------
  function openImport() { $('#import-text').value = ''; showModal('modal-import'); }
  function doImport() {
    const text = $('#import-text').value;
    if (!text.trim()) { toast('Paste some data first'); return; }
    const type = $('#import-type .seg-btn.active').dataset.type;
    const useHeader = $('#import-header').checked;
    const parsed = D.parseDelimited(text);
    const table = type === 'grouped'
      ? D.groupedFromParsed(parsed, useHeader, parseInt($('#import-reps').value, 10) || 3)
      : D.tableFromParsed(parsed, type, useHeader);
    App.tables.push(table); hideModal('modal-import'); renderNavigator(); setActive('data', table.id);
    saveState(); toast('Imported ' + table.rows.length + ' rows');
  }

  // ---------- GraphPad Prism (.prism) import ----------
  function openPrism() {
    const inp = el('input', { type: 'file', accept: '.prism' });
    inp.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importPrismFile(f); });
    inp.click();
  }
  async function importPrismFile(file) {
    try {
      toast('Reading ' + file.name + '…');
      const buf = await file.arrayBuffer();
      const { tableSpecs, warnings } = await PrismImport.parse(buf);
      addPrismTables(tableSpecs, warnings, file.name);
    } catch (err) {
      toast('Could not open .prism file: ' + ((err && err.message) || err));
    }
  }
  function addPrismTables(tableSpecs, warnings, fname) {
    if (!tableSpecs || !tableSpecs.length) { toast('No data tables found in ' + (fname || 'that file')); return; }
    const created = tableSpecs.map((s) => D.fromJSON(s));
    created.forEach((t) => App.tables.push(t));
    renderNavigator(); setActive('data', created[0].id); saveState();
    const n = created.length;
    let msg = 'Imported ' + n + ' table' + (n === 1 ? '' : 's') + ' from Prism';
    if (warnings && warnings.length) { msg += ' · ' + warnings.length + ' note' + (warnings.length === 1 ? '' : 's'); console.warn('Prism import notes:', warnings); }
    toast(msg);
  }

  // Accept a .prism (or .json project) file dropped anywhere on the window.
  function initDragDrop() {
    const allow = (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some((it) => it.kind === 'file')) e.preventDefault(); };
    document.addEventListener('dragover', allow);
    document.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      if (/\.prism$/i.test(f.name)) importPrismFile(f);
      else if (/\.json$/i.test(f.name)) {
        const fr = new FileReader();
        fr.onload = () => { try { restoreSnapshot(JSON.parse(fr.result)); renderNavigator(); renderContent(); saveState(); toast('Project opened'); } catch (err) { toast('Invalid project file'); } };
        fr.readAsText(f);
      }
    });
  }

  // ---------- guide modal ----------
  let guideStack = [];
  function openGuide() { guideStack = [G.START]; renderGuide(); showModal('modal-guide'); }
  function renderGuide() {
    const body = $('#guide-body'); body.innerHTML = '';
    const node = G.NODES[guideStack[guideStack.length - 1]];
    $('#guide-back').hidden = guideStack.length <= 1;
    if (node.rec) { renderGuideRec(body, node); return; }
    body.append(el('div', { class: 'guide-q' }, node.q));
    if (node.hint) body.append(el('div', { class: 'note', style: 'margin-bottom:12px' }, '💡 ' + node.hint));
    const opts = el('div', { class: 'guide-opts' });
    node.opts.forEach((o) => opts.append(el('div', { class: 'guide-opt', onclick: () => { guideStack.push(o.next); renderGuide(); } },
      el('span', { class: 'g-ico' }, o.ico),
      el('div', {}, el('div', { class: 'g-main' }, o.label), el('div', { class: 'g-sub' }, o.sub)))));
    body.append(opts);
    // offer quick normality check when relevant
    if (/normal/i.test(node.q)) {
      const tbl = App.tables.find((t) => (t.type === 'column' || t.type === 'grouped') && t.hasData());
      if (tbl) body.append(el('button', { class: 'btn btn-sm', style: 'margin-top:14px', onclick: () => { hideModal('modal-guide'); runAnalysis(tbl, { kind: 'normality' }); } }, '🔔 Run a normality test on "' + tbl.name + '" now'));
    }
  }
  function renderGuideRec(body, node) {
    const path = guideStack.slice(0, -1).map((id) => { const n = G.NODES[id]; return n && n.q ? n.q.replace(/\?.*/, '') : ''; }).filter(Boolean);
    const g = G.TESTS[node.guidance];
    const box = el('div', { class: 'guide-result' },
      el('h3', {}, '✓ Recommended: ' + node.title),
      el('div', {}, node.why));
    if (g) {
      if (g.assumptions && g.assumptions.length) box.append(el('div', { style: 'margin-top:10px' }, el('b', {}, 'Assumptions: '), g.assumptions.join('; ')));
      box.append(el('div', { style: 'margin-top:6px' }, el('b', {}, 'How to read it: '), g.interpret));
    }
    body.append(box);
    // run button if there's a matching table
    const matchType = node.analysis.kind === 'survival' ? 'survival' : node.analysis.kind === 'twoway' ? 'grouped' : ['pearson', 'spearman', 'regression'].includes(node.analysis.kind) ? 'xy' : 'column';
    const tbl = App.tables.find((t) => t.type === matchType && t.hasData());
    const actions = el('div', { style: 'margin-top:16px;display:flex;gap:9px;flex-wrap:wrap' });
    if (tbl) actions.append(el('button', { class: 'btn btn-accent', onclick: () => { hideModal('modal-guide'); runAnalysis(tbl, node.analysis); } }, '▶ Run on "' + tbl.name + '"'));
    else actions.append(el('div', { class: 'note' }, `Create a ${matchType === 'xy' ? 'XY' : matchType} data table, then run ${node.title}.`));
    actions.append(el('button', { class: 'btn', onclick: () => { guideStack = [G.START]; renderGuide(); } }, '↻ Start over'));
    body.append(actions);
  }

  // ---------- modals ----------
  function showModal(id) { $('#' + id).hidden = false; }
  function hideModal(id) { $('#' + id).hidden = true; }

  // ---------- persistence ----------
  let _saveTimer = null;
  function saveState() { clearTimeout(_saveTimer); _saveTimer = setTimeout(persist, 400); }
  function persist() { try { localStorage.setItem('statlab_state', JSON.stringify(snapshot())); } catch (e) { /* storage full or unavailable */ } }
  function snapshot() {
    return {
      v: 1, counter: App.counter,
      tables: App.tables.map((t) => ({ id: t.id, type: t.type, name: t.name, notes: t.notes, columns: t.columns, rows: t.rows, groupNames: t.groupNames, nsub: t.nsub, rowTitles: t.rowTitles })),
      results: App.results.map((r) => ({ id: r.id, name: r.name, tableId: r.tableId, kind: r.kind, spec: r.spec, graphId: r.graphId })),
      graphs: App.graphs.map((g) => ({ id: g.id, name: g.name, tableId: g.tableId, resultId: g.resultId, spec: g.spec })),
      active: App.active,
    };
  }
  function restoreSnapshot(s) {
    App.counter = s.counter || 1;
    App.tables = (s.tables || []).map(D.fromJSON);
    App.graphs = (s.graphs || []).map((g) => ({ id: g.id, name: g.name, tableId: g.tableId, resultId: g.resultId, spec: g.spec }));
    App.results = [];
    (s.results || []).forEach((r) => {
      const table = tableById(r.tableId);
      let html;
      try { html = table && r.spec ? compute(table, r.spec).html : el('div', { class: 'note' }, '(source table missing)'); }
      catch (e) { html = el('div', { class: 'note' }, 'Could not recompute this result.'); }
      App.results.push({ id: r.id, name: r.name, tableId: r.tableId, kind: r.kind, spec: r.spec, html, graphId: r.graphId });
    });
    const ids = App.tables.concat(App.results, App.graphs).map((x) => x.id);
    App.active = s.active && ids.includes(s.active.id) ? s.active : (App.tables[0] ? { view: 'data', id: App.tables[0].id } : null);
  }
  // Read the autosaved session WITHOUT loading it, so startup can offer a choice.
  function peekSavedState() {
    let raw; try { raw = localStorage.getItem('statlab_state'); } catch (e) { return null; }
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      if (!s.tables || !s.tables.length) return null;
      return { state: s, tables: s.tables.length, results: (s.results || []).length, graphs: (s.graphs || []).length };
    } catch (e) { return null; }
  }
  // Startup prompt: restore the previous autosaved session, or begin with a clean workspace.
  // "Start fresh" leaves the autosave untouched — it is overwritten only once new work is saved —
  // so choosing it can never destroy the previous session by accident.
  function showRestorePrompt(info) {
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    const parts = [plural(info.tables, 'data table')];
    if (info.graphs) parts.push(plural(info.graphs, 'graph'));
    if (info.results) parts.push(plural(info.results, 'result'));
    const summary = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
    $('#restore-summary').textContent = 'Your last session has ' + summary + '.';
    const modal = $('#modal-restore');
    $('#restore-yes').onclick = () => { restoreSnapshot(info.state); renderNavigator(); renderContent(); modal.hidden = true; };
    $('#restore-fresh').onclick = () => { modal.hidden = true; toast('Started fresh — your previous session is still saved'); };
    modal.hidden = false;
  }
  // Reflect the current project file name in the toolbar and window title.
  function renderProjectFile() {
    const elp = $('#project-file'); if (!elp) return;
    const name = App.projectFileName;
    elp.textContent = name || 'Unsaved project';
    elp.title = name ? 'Current project file: ' + name : 'This project has not been saved to a file yet';
    elp.classList.toggle('is-saved', !!name);
    elp.classList.toggle('is-unsaved', !name);
    document.title = (name ? name + ' — ' : '') + 'StatLab — Scientific Statistics & Figures';
  }
  function setProjectFile(name, handle) {
    App.projectFileName = name || null;
    if (handle !== undefined) App.projectFileHandle = handle;
    renderProjectFile();
  }

  const PROJECT_JSON = () => JSON.stringify(snapshot(), null, 2);
  const FS_TYPES = [{ description: 'StatLab Project', accept: { 'application/json': ['.json'] } }];
  async function writeToHandle(handle, text) {
    const w = await handle.createWritable();
    await w.write(text); await w.close();
  }

  // Save: in the desktop app defer to the native handler (writes to the open
  // file, prompting only when there isn't one). In the browser, overwrite the
  // open file via its handle, falling back to Save As when there is none.
  async function saveProject() {
    if (window.desktop) { window.desktop.saveProject(); return; }
    if (App.projectFileHandle && window.showSaveFilePicker) {
      try { await writeToHandle(App.projectFileHandle, PROJECT_JSON()); toast('Saved ' + App.projectFileName); return; }
      catch (e) { /* handle went stale — fall through to Save As */ }
    }
    return saveProjectAs();
  }

  // Save As: always choose a new destination.
  async function saveProjectAs() {
    if (window.desktop) { window.desktop.saveProjectAs(); return; }
    const text = PROJECT_JSON();
    if (window.showSaveFilePicker) {
      let handle;
      try { handle = await window.showSaveFilePicker({ suggestedName: App.projectFileName || 'project.statlab.json', types: FS_TYPES }); }
      catch (e) { return; } // user dismissed the picker
      try { await writeToHandle(handle, text); setProjectFile(handle.name, handle); toast('Saved ' + handle.name); }
      catch (e) { toast('Save failed'); }
    } else {
      // Older browsers without the File System Access API: download a copy.
      const name = App.projectFileName || 'statlab_project.json';
      download(name, text, 'application/json'); setProjectFile(name, null); toast('Project file saved');
    }
  }

  async function openProjectFile() {
    if (window.desktop) { window.desktop.openProject(); return; }
    if (window.showOpenFilePicker) {
      let handle;
      try { [handle] = await window.showOpenFilePicker({ types: FS_TYPES, multiple: false }); }
      catch (e) { return; } // user dismissed the picker
      try {
        const text = await (await handle.getFile()).text();
        restoreSnapshot(JSON.parse(text)); renderNavigator(); renderContent(); saveState();
        setProjectFile(handle.name, handle); toast('Opened ' + handle.name);
      } catch (err) { toast('Invalid project file'); }
      return;
    }
    // Fallback: <input type=file> (no writable handle, so later Save acts as Save As).
    const inp = el('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => { try { restoreSnapshot(JSON.parse(fr.result)); renderNavigator(); renderContent(); saveState(); setProjectFile(f.name, null); toast('Project opened'); } catch (err) { toast('Invalid project file'); } };
      fr.readAsText(f);
    });
    inp.click();
  }

  // ---------- deletion ----------
  // How many results/graphs were derived from a given table (they store its id).
  function relatedCounts(tableId) {
    return {
      results: App.results.filter((r) => r.tableId === tableId).length,
      graphs: App.graphs.filter((g) => g.tableId === tableId).length,
    };
  }
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  // After removing whatever the user was viewing, fall back to another item so
  // the content pane is never left pointing at something that no longer exists.
  function afterDelete() {
    if (!App.active || !activeObj()) {
      App.active = App.tables[0] ? { view: 'data', id: App.tables[0].id }
        : App.results[0] ? { view: 'result', id: App.results[0].id }
          : App.graphs[0] ? { view: 'graph', id: App.graphs[0].id } : null;
    }
    renderNavigator(); renderContent(); saveState();
  }
  // Delete a data table together with every result and graph derived from it.
  function deleteTable(id, opts) {
    const t = tableById(id); if (!t) return;
    const c = relatedCounts(id);
    if (!(opts && opts.skipConfirm)) {
      const extra = [];
      if (c.results) extra.push(plural(c.results, 'result'));
      if (c.graphs) extra.push(plural(c.graphs, 'graph'));
      const tail = extra.length ? ' and its ' + extra.join(' and ') : '';
      if (!confirm('Delete data table "' + t.name + '"' + tail + '? This cannot be undone.')) return;
    }
    App.tables = App.tables.filter((x) => x.id !== id);
    App.results = App.results.filter((r) => r.tableId !== id);
    App.graphs = App.graphs.filter((g) => g.tableId !== id);
    afterDelete();
    toast('Deleted "' + t.name + '"' + (c.results + c.graphs ? ' and related analyses/graphs' : ''));
  }
  function deleteResult(id) {
    const r = App.results.find((x) => x.id === id); if (!r) return;
    App.results = App.results.filter((x) => x.id !== id);
    afterDelete(); toast('Deleted result');
  }
  function deleteGraph(id) {
    const g = App.graphs.find((x) => x.id === id); if (!g) return;
    App.graphs = App.graphs.filter((x) => x.id !== id);
    // a result may link to this graph via graphId — drop the now-dangling link
    App.results.forEach((r) => { if (r.graphId === id) delete r.graphId; });
    afterDelete(); toast('Deleted graph');
  }

  // ---------- lightweight context menu (right-click on navigator items) ----------
  function showContextMenu(x, y, items) {
    const existing = $('#ctx-menu'); if (existing) existing.remove();
    const menu = el('div', { id: 'ctx-menu', class: 'ctx-menu' });
    items.forEach((it) => {
      if (it.sep) { menu.append(el('div', { class: 'ctx-sep' })); return; }
      menu.append(el('div', { class: 'ctx-item' + (it.danger ? ' danger' : ''), onclick: () => { menu.remove(); it.onClick(); } }, it.label));
    });
    document.body.append(menu);
    // keep the menu inside the viewport
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function h(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', h); }
    }), 0);
  }
  function navContextMenu(e, item, view) {
    e.preventDefault();
    const items = [{ label: 'Open', onClick: () => setActive(view, item.id) }, { sep: true }];
    if (view === 'data') {
      const c = relatedCounts(item.id);
      const tail = (c.results + c.graphs) ? ' & related' : '';
      items.push({ label: '🗑 Delete table' + tail, danger: true, onClick: () => deleteTable(item.id) });
    } else if (view === 'result') {
      items.push({ label: '🗑 Delete result', danger: true, onClick: () => deleteResult(item.id) });
    } else {
      items.push({ label: '🗑 Delete graph', danger: true, onClick: () => deleteGraph(item.id) });
    }
    showContextMenu(e.clientX, e.clientY, items);
  }

  // ---------- top-level actions ----------
  function newTable() { const t = new D.DataTable('column'); App.tables.push(t); renderNavigator(); setActive('data', t.id); saveState(); }
  function loadExample(key) {
    const t = D.sample(key); App.tables.push(t); renderNavigator(); setActive('data', t.id);
    toast('Loaded: ' + t.name); saveState();
  }

  // ---------- init ----------
  function init() {
    $('#btn-new').addEventListener('click', newTable);
    $('#btn-import').addEventListener('click', openImport);
    $('#btn-example').addEventListener('click', () => showExampleMenu());
    $('#btn-prism').addEventListener('click', openPrism);
    $('#btn-save').addEventListener('click', saveProject);
    $('#btn-saveas').addEventListener('click', saveProjectAs);
    $('#btn-open').addEventListener('click', openProjectFile);
    $('#btn-guide').addEventListener('click', openGuide);
    $('#btn-graph-all').addEventListener('click', graphAll);
    $('#analyze-go').addEventListener('click', runAnalyzeFromModal);
    $('#import-go').addEventListener('click', doImport);
    $('#guide-back').addEventListener('click', () => { guideStack.pop(); renderGuide(); });
    $$('#import-type .seg-btn').forEach((b) => b.addEventListener('click', () => { $$('#import-type .seg-btn').forEach((x) => x.classList.remove('active')); b.classList.add('active'); $('#import-reps-row').hidden = b.dataset.type !== 'grouped'; }));
    $$('[data-close]').forEach((b) => b.addEventListener('click', (e) => { const m = e.target.closest('.modal-backdrop'); if (m) m.hidden = true; }));
    $$('.modal-backdrop').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal-backdrop').forEach((m) => m.hidden = true); });
    initDragDrop();
    const saved = peekSavedState();
    renderNavigator(); renderContent(); renderProjectFile();
    if (saved) showRestorePrompt(saved);
  }

  function showExampleMenu() {
    // simple inline menu via the import modal area; reuse guide modal-like popup
    const existing = $('#example-menu'); if (existing) { existing.remove(); return; }
    const r = $('#btn-example').getBoundingClientRect();
    const menu = el('div', { id: 'example-menu', style: `position:absolute;top:${r.bottom + 6}px;left:${r.left}px;background:#fff;border:1px solid var(--line-strong);border-radius:10px;box-shadow:var(--shadow-lg);z-index:60;overflow:hidden;min-width:300px` });
    D.sampleList.forEach((s) => menu.append(el('div', { style: 'padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--line)', onmouseover: (e) => e.target.style.background = '#f1f5f9', onmouseout: (e) => e.target.style.background = '#fff', onclick: () => { menu.remove(); loadExample(s.key); } }, s.label)));
    document.body.append(menu);
    setTimeout(() => document.addEventListener('click', function h(ev) { if (!menu.contains(ev.target) && ev.target.id !== 'btn-example') { menu.remove(); document.removeEventListener('click', h); } }), 0);
  }

  document.addEventListener('DOMContentLoaded', init);
  window.StatLabApp = App;

  // API surface for the Electron desktop shell (native menu → these calls)
  window.StatLab = {
    getStateJSON: () => JSON.stringify(snapshot(), null, 2),
    loadStateJSON: (json) => { try { restoreSnapshot(JSON.parse(json)); renderNavigator(); renderContent(); saveState(); return true; } catch (e) { return false; } },
    // Called by the desktop shell after a native save/open to show the file name.
    setProjectFile: (name) => { setProjectFile(name); },
    importText: (text, type) => {
      const parsed = D.parseDelimited(text);
      const useHeader = D.looksLikeHeader(parsed.rows[0] || []);
      const table = D.tableFromParsed(parsed, type || 'column', useHeader);
      App.tables.push(table); renderNavigator(); setActive('data', table.id); saveState();
      return table.rows.length;
    },
    newTable: () => { newTable(); },
    loadExample: (key) => { loadExample(key); },
    openGuide: () => { openGuide(); },
    // Open a .prism file passed from the native shell as a base64 string.
    openPrismBase64: async (b64) => {
      try {
        const bin = atob(b64); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const { tableSpecs, warnings } = await PrismImport.parse(bytes.buffer);
        addPrismTables(tableSpecs, warnings, 'Prism file');
        return tableSpecs.length;
      } catch (e) { return -1; }
    },
    hasActiveGraph: () => !!(App.active && App.active.view === 'graph'),
    activeGraphSVG: () => { const g = activeObj(); return (App.active && App.active.view === 'graph' && g) ? buildSVG(g.spec) : null; },
    activeGraphName: () => { const g = activeObj(); return g ? (g.name || 'figure') : 'figure'; },
  };
  window.__inElectron = /Electron/.test(navigator.userAgent);
})();
