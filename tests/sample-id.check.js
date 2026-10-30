// Sample ID (Prism-style row title) column. Run: npm exec --offline -- electron tests/sample-id.check.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const D = require('../js/data.js');
const Charts = require('../js/charts.js');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-sample-id-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);
let win, pass = 0;
const run = (code) => win.webContents.executeJavaScript(code, true);
const state = async () => JSON.parse(await run('window.StatLab.getStateJSON()'));
const table0 = async () => (await state()).tables[0];
const cell = (r, c) => `td.dcell[data-r="${r}"][data-c="${c}"]`;
function check(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}
async function load(tables, activeId) {
  const json = JSON.stringify({ tables, results: [], graphs: [], counter: 1, active: { view: 'data', id: activeId || tables[0].id } });
  assert.strictEqual(await run(`window.StatLab.loadStateJSON(${JSON.stringify(json)})`), true);
}
function columnTable(id, ids) {
  const t = new D.DataTable('column');
  t.id = id;
  t.setColumns(['High', 'Low']);
  t.rows = [[8, 1], [11, 2], [9, 3], [14, 4], [12, 5], [15, 6]].map((r) => r.map(String));
  t.sampleIds = ids ? ids.slice() : [];
  t.ensureRows(8);
  return t;
}
async function click(selector, count = 1, modifiers = 0) {
  const point = await run(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target || !target.checkVisibility()) throw new Error('Not visible: ' + ${JSON.stringify(selector)});
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  for (let clickCount = 1; clickCount <= count; clickCount++) {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount, modifiers, ...point });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount, modifiers, ...point });
  }
}
async function key(name, code, modifiers = 0) {
  const event = { key: name, windowsVirtualKeyCode: code, modifiers };
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...event, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}
async function typeText(text) {
  for (const ch of text) {
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  }
}
const active = (r, c) => run(`!!document.querySelector(${JSON.stringify(cell(r, c) + '.active')})`);
const selected = () => run(`Array.from(document.querySelectorAll('td.dcell.sel'), (td) => td.dataset.r + ',' + td.dataset.c).join(' ')`);
// Clipboard events carry their own DataTransfer, so these tests never touch the OS clipboard.
const copySelection = () => run(`(() => {
  const data = new DataTransfer();
  document.querySelector('.sheet-wrap').dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
  return data.getData('text/plain');
})()`);
const pasteOnSheet = (text) => run(`(() => {
  const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(text)});
  document.querySelector('.sheet-wrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
})()`);
async function analyze(kind) {
  await run(`document.querySelector('#nav-tables .nav-item[data-view="data"]').click();
    Array.from(document.querySelectorAll('.view-actions button')).find((b) => b.textContent.includes('Analyze')).click()`);
  await run(`window.__statlabTestKind = ${JSON.stringify(kind)}`);
  await run(`Array.from(document.querySelectorAll('.test-opt')).find((c) => c.dataset.kind === window.__statlabTestKind).click(); document.querySelector('#analyze-go').click()`);
}
const openView = (view) => run(`document.querySelector('#nav-tables .nav-item[data-view="${view}"]').click()`);
// Move the real mouse onto the plotted point whose read-out shows `value`, then
// return the tooltip as displayed ({title, rows}), or null when none is shown.
async function hoverValue(value) {
  const at = await run(`(() => {
    const svg = document.querySelector('#graph-canvas svg');
    const node = Array.from(svg.querySelectorAll('[data-pt]')).find((n) => JSON.parse(n.getAttribute('data-pt')).r.some((r) => r[1] === ${JSON.stringify(value)}));
    if (!node) throw new Error('No plotted point shows ' + ${JSON.stringify(value)});
    node.scrollIntoView({ block: 'center', inline: 'center' });
    const p = new DOMPoint(+node.getAttribute('data-px'), +node.getAttribute('data-py')).matrixTransform(svg.getScreenCTM());
    if (p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight) throw new Error('Point is off screen');
    return { x: Math.round(p.x), y: Math.round(p.y) };
  })()`);
  for (const point of [{ x: 2, y: 2 }, at]) {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await run('new Promise((r) => requestAnimationFrame(() => r()))');
  }
  return run(`(() => {
    const t = document.getElementById('chart-tip');
    if (!t || t.style.display !== 'block') return null;
    return { title: t.querySelector('.tip-title').textContent, rows: Array.from(t.querySelectorAll('.tip-row'), (r) => [r.children[0].textContent, r.children[1].textContent]) };
  })()`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function unpairedP() {
  await analyze('unpaired-t');
  return run(`(() => {
    const card = document.querySelector('.result-card');
    const row = Array.from(card.querySelectorAll('tr')).find((tr) => tr.querySelector('th')?.textContent.startsWith('P value'));
    return { p: row.querySelector('td').textContent, text: card.textContent };
  })()`);
}

// ---------- model (no DOM) ----------
// Called inside the promise chain so a failure exits non-zero instead of hanging Electron.
function modelChecks() {
  const t = new D.DataTable('column');
  t.setCell(0, 0, '5'); t.setCell(1, 0, '6'); t.setCell(0, 1, '7');
  t.setSampleId(0, '1001'); t.setSampleId(1, 'M-2');
  check('numeric-looking sample IDs never enter the analyzed groups',
    JSON.stringify(t.groups()) === JSON.stringify([{ name: 'Group A', values: [5, 6] }, { name: 'Group B', values: [7] }])
    && JSON.stringify(t.rawColumn(0).slice(0, 2)) === JSON.stringify(['5', '6']));
  t.transpose();
  check('transpose turns sample IDs into column names and column names into sample IDs',
    JSON.stringify(t.columns.map((c) => c.name)) === JSON.stringify(['1001', 'M-2'])
    && JSON.stringify(t.sampleIdList().slice(0, 2)) === JSON.stringify(['Group A', 'Group B'])
    && JSON.stringify(t.rows.slice(0, 2)) === JSON.stringify([['5', '6'], ['7', '']]));
  t.transpose();
  check('a second transpose restores the original names, IDs and values',
    JSON.stringify(t.columns.map((c) => c.name)) === JSON.stringify(['Group A', 'Group B'])
    && JSON.stringify(t.sampleIdList().slice(0, 2)) === JSON.stringify(['1001', 'M-2'])
    && JSON.stringify(t.rows.slice(0, 2)) === JSON.stringify([['5', '7'], ['6', '']]));
  t.setSampleId(11, 'late');
  check('setting an ID past the last row adds aligned rows', t.rows.length === 12 && t.getSampleId(11) === 'late' && t.getSampleId(10) === '');
  const legacy = D.fromJSON({ type: 'xy', name: 'old', columns: [{ name: 'X', role: 'x' }, { name: 'Y', role: 'y' }], rows: [['1', '2']] });
  check('projects saved before sample IDs load with blank IDs', legacy.getSampleId(0) === '' && Array.isArray(legacy.sampleIds));
  check('grouped tables keep their row-factor column instead of a Sample ID column', !new D.DataTable('grouped').hasSampleIdColumn());

  // labeledGroups(): IDs follow the values, which skip blank/non-numeric cells and empty columns.
  const lg = new D.DataTable('column');
  lg.setColumns(['A', 'Empty', 'B']);
  lg.rows = [['1', '', ''], ['', '', '5'], ['3', '', '6'], ['x', '', '7']];
  lg.sampleIds = ['r0', 'r1', 'r2', 'r3'];
  check('labeled groups align each sample ID with its plotted value, not its row number',
    JSON.stringify(lg.labeledGroups()) === JSON.stringify([
      { name: 'A', values: [1, 3], ids: ['r0', 'r2'] }, { name: 'B', values: [5, 6, 7], ids: ['r1', 'r2', 'r3'] }]));
  lg.sampleIds = [];
  check('tables without sample IDs produce exactly the unlabeled groups', JSON.stringify(lg.labeledGroups()) === JSON.stringify(lg.groups()));

  // Every point read-out names its sample; points without an ID keep the old read-out.
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const tips = (svg) => Array.from(svg.matchAll(/data-pt="([^"]*)"/g), (m) => JSON.parse(unesc(m[1])));
  const has = (svg, tip) => tips(svg).some((t) => JSON.stringify(t) === JSON.stringify(tip));
  const labeled = [{ name: 'A', values: [1, 3], ids: ['r0', ''] }, { name: 'B', values: [5, 6], ids: ['<b>"M&1"</b>', 'r2'] }];
  for (const [name, svg] of [['bar', Charts.barChart(labeled, { showPoints: true })], ['dot', Charts.dotPlot(labeled, {})]]) {
    check(name + ' point read-outs lead with the sample ID',
      has(svg, { t: 'A', r: [['Sample ID', 'r0'], ['Value', '1']] }) && has(svg, { t: 'B', r: [['Sample ID', 'r2'], ['Value', '6']] })
      && has(svg, { t: 'A', r: [['Value', '3']] }) && has(svg, { t: 'B', r: [['Sample ID', '<b>"M&1"</b>'], ['Value', '5']] })
      && !svg.includes('<b>"M&1"'));
  }
  const boxVals = [10, 11, 12, 40, 11, 10, 12, -20, 10, 11, 12, 11, 10];
  const box = Charts.boxPlot([{ name: 'A', values: boxVals, ids: boxVals.map((_, k) => 's' + k) }], {});
  check('box-plot outliers keep their own sample IDs after sorting',
    has(box, { t: 'A', r: [['Sample ID', 's3'], ['Outlier', '40']] }) && has(box, { t: 'A', r: [['Sample ID', 's7'], ['Outlier', '-20']] }));
  const paired = Charts.pairedPlot(['10', '', '12', '9'], ['18', '5', '11.5', '9'], { labelA: 'Pre', labelB: 'Post', rowIds: ['p0', 'p1', 'p2', 'p3'] });
  check('before–after pairs take the ID of their data row when rows are skipped',
    has(paired, { t: 'Pair 2', r: [['Sample ID', 'p2'], ['Pre', '12'], ['Post', '11.5'], ['Change', '-0.5']] })
    && has(paired, { t: 'Pair 3', r: [['Sample ID', 'p3'], ['Pre', '9'], ['Post', '9'], ['Change', '0']] }));
  const xy = Charts.xyPlot([1, 2, 4], [3, 5, 9], { xLabel: 'Dose', yLabel: 'Response', pointIds: ['a', '', 'c'] });
  check('XY point read-outs show the ID, and unlabeled points are unchanged',
    has(xy, { t: 'Point 3', r: [['Sample ID', 'c'], ['Dose', '4'], ['Response', '9']] }) && has(xy, { t: 'Point 2', r: [['Dose', '2'], ['Response', '5']] }));
}

app.whenReady().then(async () => {
  modelChecks();
  win = new BrowserWindow({ show: false, width: 1320, height: 860,
    webPreferences: { contextIsolation: true, spellcheck: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(root, 'index.html'));
  win.webContents.debugger.attach('1.3');

  // ---------- layout: leftmost column after the row numbers, for every non-grouped type ----------
  for (const type of ['column', 'xy', 'survival']) {
    const t = new D.DataTable(type); t.id = 'layout-' + type;
    await load([t]);
    const layout = await run(`(() => {
      const heads = Array.from(document.querySelectorAll('table.sheet thead tr:first-child th'));
      const firstRow = Array.from(document.querySelectorAll('table.sheet tbody tr:first-child td'));
      const x = (sel) => document.querySelector(sel).getBoundingClientRect().x;
      return { head: heads[1] && heads[1].textContent.trim(), cls: firstRow[1] && firstRow[1].className,
        ordered: x('td.dcell[data-r="0"][data-c="-1"]') < x('td.dcell[data-r="0"][data-c="0"]') && x('td.rowhead') < x('td.dcell[data-r="0"][data-c="-1"]'),
        rows: document.querySelectorAll('td.dcell.sampleid').length, tableRows: document.querySelectorAll('table.sheet tbody tr').length,
        align: getComputedStyle(document.querySelector('td.dcell.sampleid .cellval')).textAlign };
    })()`);
    check(type + ' sheet shows "Sample ID" as the leftmost data column on every row',
      layout.head === 'Sample ID' && /\bsampleid\b/.test(layout.cls) && layout.ordered && layout.rows === layout.tableRows && layout.align === 'left');
  }
  {
    const g = new D.DataTable('grouped'); g.id = 'layout-grouped';
    await load([g]);
    check('grouped sheet is unchanged: row-factor column, no Sample ID column',
      await run(`!document.querySelector('td.sampleid, th.sampleid-head') && !!document.querySelector('th.rowtitle-head')`));
  }

  // ---------- typing and keyboard navigation ----------
  const base = columnTable('ids');
  await load([base]);
  const rowsBefore = (await table0()).rows;
  await click(cell(0, -1));
  await typeText('M-01');
  check('typing into a Sample ID cell opens a left-aligned text editor',
    await run(`(() => { const i = document.querySelector('td.sampleid input.celledit'); return !!i && i.value === 'M-01' && getComputedStyle(i).textAlign === 'left'; })()`));
  await key('Enter', 13);
  let s = await table0();
  check('Enter commits the ID, moves down, and leaves the data untouched',
    s.sampleIds[0] === 'M-01' && JSON.stringify(s.rows) === JSON.stringify(rowsBefore) && await active(1, -1)
    && await run(`document.querySelector(${JSON.stringify(cell(0, -1))}).textContent`) === 'M-01');
  await typeText('M-02');
  await key('Tab', 9);
  check('Tab from the Sample ID column commits and moves into the first data column',
    (await table0()).sampleIds[1] === 'M-02' && await active(1, 0));
  await key('ArrowLeft', 37);
  await key('ArrowLeft', 37);
  check('ArrowLeft reaches the Sample ID column and stops there', await active(1, -1));
  await key('Delete', 46);
  check('Delete clears a sample ID', (await table0()).sampleIds[1] === '' && (await table0()).sampleIds[0] === 'M-01');
  await click(cell(1, 0));
  await key('Tab', 9, 8);
  check('Shift+Tab from the first data column selects its sample ID', await active(1, -1));

  // ---------- paste / copy across the ID column ----------
  await click(cell(0, -1));
  await pasteOnSheet('S1\t1.5\t2\r\nS2\t3\t4\r\n');
  s = await table0();
  check('a paste starting in the Sample ID column fills IDs, then the data columns',
    JSON.stringify(s.sampleIds.slice(0, 3)) === JSON.stringify(['S1', 'S2', ''])
    && JSON.stringify(s.rows.slice(0, 3)) === JSON.stringify([['1.5', '2'], ['3', '4'], ['9', '3']]));
  check('the pasted range is selected from the Sample ID column', await selected() === '0,-1 0,0 0,1 1,-1 1,0 1,1' && await active(0, -1));
  await click(cell(0, -1));
  await click(cell(1, 0), 1, 8);
  check('copying a selection that includes IDs keeps them as the first column', await copySelection() === 'S1\t1.5\nS2\t3');
  await click(cell(2, 0));
  await pasteOnSheet('77\n');
  check('a paste into a data column does not touch sample IDs', (await table0()).rows[2][0] === '77' && (await table0()).sampleIds[2] === '');
  await click(cell(0, 0));
  await key('a', 65, process.platform === 'darwin' ? 4 : 2); // Meta (4) on macOS, Ctrl (2) elsewhere
  check('select-all includes the Sample ID column', (await selected()).split(' ')[0] === '0,-1' && await active(0, -1));

  // ---------- analyses ignore IDs, even numeric-looking ones ----------
  await load([columnTable('plain')]);
  const plain = await unpairedP();
  await load([columnTable('numeric-ids', ['101', '102', '103', '104', '105', '106'])]);
  const labeled = await unpairedP();
  check('numeric-looking sample IDs do not change the analysis',
    plain.p === labeled.p && plain.text === labeled.text && labeled.text.includes('(n=6)'));

  // ---------- graph point hover shows the sample ID ----------
  // Blank cells shift values away from their rows: Control's 12 is its 2nd value but row 3 (M-03).
  const hoverTable = () => {
    const t = new D.DataTable('column');
    t.id = 'hover-ids';
    t.setColumns(['Control', 'Treated']);
    t.rows = [['10', '18'], ['', '20.5'], ['12', '17'], ['11', '21'], ['13', '19'], ['9', '']];
    t.sampleIds = ['M-01', 'M-02', 'M-03', 'M-04', 'M-05', 'M-06'];
    t.ensureRows(8);
    return t;
  };
  await load([hoverTable()]);
  await analyze('mannwhitney');
  await openView('graph');
  check('hovering a graph point shows the sample ID of its own row',
    same(await hoverValue('12'), { title: 'Control', rows: [['Sample ID', 'M-03'], ['Value', '12']] })
    && same(await hoverValue('20.5'), { title: 'Treated', rows: [['Sample ID', 'M-02'], ['Value', '20.5']] }));
  await openView('data');
  await click(cell(2, -1));
  await typeText('Mouse 3');
  await key('Enter', 13);
  await openView('graph');
  check('editing a sample ID updates the linked graph read-out',
    same(await hoverValue('12'), { title: 'Control', rows: [['Sample ID', 'Mouse 3'], ['Value', '12']] }));
  await openView('data');
  await click(cell(2, -1));
  await key('Delete', 46);
  await openView('graph');
  check('a point whose ID is cleared shows just its value again',
    same(await hoverValue('12'), { title: 'Control', rows: [['Value', '12']] }));

  await load([hoverTable()]);
  await analyze('paired-t');
  await openView('graph');
  check('before–after points show the ID of the pair\'s row',
    same(await hoverValue('13'), { title: 'Pair 4', rows: [['Sample ID', 'M-05'], ['Control', '13'], ['Treated', '19'], ['Change', '+6']] }));

  const xyIds = new D.DataTable('xy');
  xyIds.id = 'xy-ids';
  xyIds.rows = [['1', '3'], ['2', ''], ['4', '9'], ['5', '11']]; // 3 valid points: n = 2 has no regression band
  xyIds.sampleIds = ['a', 'b', 'c', 'd'];
  xyIds.ensureRows(8);
  await load([xyIds]);
  await run(`Array.from(document.querySelectorAll('.view-actions button')).find((b) => b.textContent.includes('Graph')).click()`);
  check('XY quick-graph points show their sample IDs',
    same(await hoverValue('9'), { title: 'Point 2', rows: [['Sample ID', 'c'], ['X', '4'], ['Y', '9']] }));

  await load([columnTable('no-ids')]);
  await analyze('mannwhitney');
  await openView('graph');
  const spec = (await state()).graphs[0].spec;
  check('graphs of tables without IDs store no ID data and keep the plain read-out',
    spec.groups.every((g) => !('ids' in g)) && !('rowIds' in spec.opts)
    && same(await hoverValue('14'), { title: 'High', rows: [['Value', '14']] }));

  // ---------- type changes, transpose, persistence ----------
  await load([columnTable('round-trip', ['A-1', 'A-2', 'A-3'])]);
  await run(`(() => { const sel = document.querySelector('.view-actions select'); sel.value = 'grouped'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await run(`(() => { const sel = document.querySelector('.view-actions select'); sel.value = 'xy'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('IDs survive a round trip through a grouped table and show again',
    JSON.stringify((await table0()).sampleIds.slice(0, 3)) === JSON.stringify(['A-1', 'A-2', 'A-3'])
    && await run(`document.querySelector(${JSON.stringify(cell(2, -1))}).textContent`) === 'A-3');
  await run(`(() => { const sel = document.querySelector('.view-actions select'); sel.value = 'column'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await run(`Array.from(document.querySelectorAll('.grid-tools button')).find((b) => b.textContent.includes('Transpose')).click()`);
  s = await table0();
  check('the Transpose button swaps IDs and column names in the rendered sheet',
    JSON.stringify(s.columns.slice(0, 3).map((c) => c.name)) === JSON.stringify(['A-1', 'A-2', 'A-3'])
    && JSON.stringify(s.sampleIds.slice(0, 2)) === JSON.stringify(['X', 'Y']) // the XY step renamed the columns
    && await run(`document.querySelector(${JSON.stringify(cell(0, -1))}).textContent`) === 'X');

  await load([columnTable('persist')]);
  check('tables without IDs do not write a sampleIds field', !('sampleIds' in await table0()));
  await click(cell(4, -1));
  await typeText('Mouse 5');
  await key('Enter', 13);
  await run(`new Promise((resolve, reject) => {
    const expected = window.StatLab.getStateJSON(), deadline = Date.now() + 3000;
    (function poll() {
      const saved = localStorage.getItem('statlab_state');
      if (saved && JSON.stringify(JSON.parse(saved)) === JSON.stringify(JSON.parse(expected))) return resolve();
      if (Date.now() > deadline) return reject(new Error('Sample ID was not autosaved'));
      setTimeout(poll, 25);
    })();
  })`);
  const expected = await state();
  await win.loadFile(path.join(root, 'index.html'));
  assert.strictEqual(await run(`!document.querySelector('#modal-restore').hidden`), true, 'reload offers the isolated autosave');
  await click('#restore-yes');
  check('autosave and reload restore the sample ID in its row',
    JSON.stringify(await state()) === JSON.stringify(expected) && (await table0()).sampleIds[4] === 'Mouse 5'
    && await run(`document.querySelector(${JSON.stringify(cell(4, -1))}).textContent`) === 'Mouse 5');
  if (errors.length) console.error('Renderer errors:', errors);
  check('renderer reports no console errors', errors.length === 0);
  console.log(`\n${pass} sample-id checks passed`);
}).then(() => finish(0)).catch((err) => { console.error(err); finish(1); });
function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
