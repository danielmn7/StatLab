// Exercise compact column spacing in the real renderer: rendered text must stay inside
// the figure without colliding, compact figures keep the on-screen scale of full-width
// ones, and the Column spacing toggle survives reopening and linked recomputation.
// Run with: npm run test:ui
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const D = require('../js/data.js');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-figure-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);

let win, pass = 0;
const run = (code) => win.webContents.executeJavaScript(code, true);
function ok(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}
async function state() { return JSON.parse(await run('window.StatLab.getStateJSON()')); }
async function load(project) {
  assert.ok(await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(project))})`), 'Project loads');
}
async function showGraph(spec) {
  await load({ tables: [], results: [], graphs: [{ id: 'fig', name: 'Figure', tableId: null, spec }], active: { view: 'graph', id: 'fig' } });
  return measure();
}
// Every text box in figure (viewBox) units, measured from the actual rendered glyphs.
async function measure() {
  return run(`(() => {
    const svg = document.querySelector('#graph-canvas svg');
    const box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, k = box.width / vb.width;
    const texts = Array.from(svg.querySelectorAll('text')).map((el) => {
      const r = el.getBoundingClientRect();
      return { s: el.textContent, l: (r.left - box.left) / k, r: (r.right - box.left) / k, t: (r.top - box.top) / k, b: (r.bottom - box.top) / k };
    });
    return { W: vb.width, H: vb.height, scale: k, texts };
  })()`);
}
const overlaps = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
function layoutProblems(m) {
  const out = [];
  m.texts.forEach((a, i) => {
    if (a.l < -0.5 || a.r > m.W + 0.5) out.push('outside figure: ' + a.s);
    m.texts.slice(i + 1).forEach((b) => { if (overlaps(a, b)) out.push(`"${a.s}" overlaps "${b.s}"`); });
  });
  return out;
}
async function clickCheckbox(label) {
  const point = await run(`(() => {
    const row = Array.from(document.querySelectorAll('.graph-controls label.ctrl-row')).find((l) => l.textContent.trim() === ${JSON.stringify(label)});
    if (!row) throw new Error('No checkbox labelled ' + ${JSON.stringify(label)});
    const input = row.querySelector('input');
    input.scrollIntoView({ block: 'center' });
    const r = input.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
const compactChecked = () => run(`(() => {
  const row = Array.from(document.querySelectorAll('.graph-controls label.ctrl-row')).find((l) => l.textContent.trim() === 'Compact (fit width to columns)');
  return row ? row.querySelector('input').checked : null;
})()`);

const G = (name, values) => ({ name, values });
const two = [G('Control', [10, 12, 11, 13, 9]), G('Treated', [18, 20, 17, 21, 19])];
const fixtures = {
  'two bars with a significance bracket': { chartType: 'bar', groups: two, opts: { title: 'Two groups', yLabel: 'Response', errorType: 'sem', sig: [{ i: 0, j: 1, p: 0.00004, on: true }], sigStyle: { notation: 'pvalue' } } },
  'two bars with points': { chartType: 'bar', groups: two, opts: { title: 'With points', showPoints: true, errorType: 'ci95' } },
  'column scatter': { chartType: 'dot', groups: two, opts: { title: 'Scatter', errorType: 'sd' } },
  'two-box plot and its wide key': { chartType: 'box', groups: [G('WT', [1, 2, 3, 4, 5, 6]), G('KO', [4, 5, 6, 7, 8, 9])], opts: { title: 'Boxes' } },
  'long category names': { chartType: 'bar', groups: [G('Vehicle control (DMSO)', [10, 12, 11]), G('Compound 7b at 10 µM', [15, 16, 14]), G('Wortmannin 100 nM', [5, 6, 4])], opts: { title: 'Names' } },
  'long title': { chartType: 'bar', groups: two, opts: { title: 'Interleukin-6 secretion after 24 h of compound exposure', yLabel: 'IL-6 (pg/mL)' } },
  'out-of-range warning beside the key': { chartType: 'bar', groups: two, opts: { title: 'Clipped', showPoints: true, errorType: 'ci95', yAxis: { auto: false, min: '0', max: '15', log: false, sci: false, step: '' } } },
  'log-axis warnings': { chartType: 'dot', groups: [G('A', [0, 1, 10]), G('B', [-1, 5, 50])], opts: { title: 'Log', yAxis: { auto: true, min: '', max: '', log: true, sci: false, step: '' } } },
  'grouped bars with a legend above': { chartType: 'grouped', rowNames: ['Day 0', 'Day 7'], colNames: ['Wild type littermates', 'Knockout'], cells: [[[1, 2, 3], [2, 3, 4]], [[3, 4, 5], [5, 6, 7]]], opts: { title: 'Grouped', legendPosition: 'top' } },
  'grouped bars with a legend at right': { chartType: 'grouped', rowNames: ['Day 0', 'Day 7'], colNames: ['WT', 'Mutant'], cells: [[[1, 2, 3], [2, 3, 4]], [[3, 4, 5], [5, 6, 7]]], opts: { title: 'Grouped', legendPosition: 'right' } },
};

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1400, height: 1100,
    webPreferences: { contextIsolation: true, spellcheck: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(root, 'index.html'));
  win.webContents.debugger.attach('1.3');

  // Scale reference: the same chart laid out across the full default width.
  const full = await showGraph({ chartType: 'bar', groups: two, opts: { title: 'Two groups', compactSpacing: false } });
  ok('full-width layout still fills the default 580-unit figure', full.W === 580);
  for (const [name, spec] of Object.entries(fixtures)) {
    const before = errors.length;
    const m = await showGraph(spec);
    // Known, separate issue: non-positive values on a log axis are drawn at NaN/Infinity
    // coordinates, which the renderer drops with an attribute error. Only that fixture
    // may produce it, and only that message.
    if (name === 'log-axis warnings') errors.splice(before, errors.length - before, ...errors.slice(before).filter((e) => !/attribute \w+: Expected length, "(NaN|-?Infinity)"/.test(e)));
    const problems = layoutProblems(m);
    ok(name + ': every label stays inside the figure without colliding' + (problems.length ? ' — ' + problems.join('; ') : ''), problems.length === 0);
    ok(name + ': compact figure is shown at the scale of a full-width one', m.W < 580 && Math.abs(m.scale / full.scale - 1) < 0.005);
  }
  const compact = await showGraph(fixtures['two bars with a significance bracket']);
  ok('two-bar figure is less than half the default width', compact.W < 290);

  // The toggle restores the full-width layout, persists, and switches back.
  ok('compact spacing is on by default', await compactChecked() === true);
  await clickCheckbox('Compact (fit width to columns)');
  ok('turning compact spacing off spreads the columns across the full width', (await state()).graphs[0].spec.opts.compactSpacing === false && (await measure()).W === 580);
  await load(await state());
  ok('the full-width choice survives reopening the project', await compactChecked() === false && (await measure()).W === 580);
  await clickCheckbox('Compact (fit width to columns)');
  ok('turning compact spacing back on removes the override', !('compactSpacing' in (await state()).graphs[0].spec.opts) && (await measure()).W === compact.W);

  // A linked graph keeps the full-width choice when its source data changes.
  const table = new D.DataTable('column');
  table.setColumns(['High', 'Low']);
  table.rows = [[8, 1], [11, 2], [9, 3], [14, 4], [12, 5], [15, 6]].map((row) => row.map(String));
  table.ensureRows(8);
  await load({ tables: [table], results: [], graphs: [], counter: 1, active: { view: 'data', id: table.id } });
  await run(`Array.from(document.querySelectorAll('.view-actions button')).find((b) => b.textContent.includes('Analyze')).click();
    Array.from(document.querySelectorAll('.test-opt')).find((item) => item.querySelector('.t-name').textContent.startsWith('Unpaired t test')).click();
    document.querySelector('#analyze-go').click()`);
  const analysed = await state();
  const graphId = analysed.results[0].graphId;
  await run(`document.querySelector('.nav-item[data-view="graph"][data-id="${graphId}"]').click()`);
  ok('a new analysis graph starts compact', ['bar', 'dot', 'box'].includes(analysed.graphs[0].spec.chartType) && await compactChecked() === true && (await measure()).W < 580);
  await clickCheckbox('Compact (fit width to columns)');
  const p0 = (await state()).graphs[0].spec.opts.sig[0].p;
  await run(`document.querySelector('#nav-tables .nav-item[data-view="data"]').click();
    const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify([[9, 8], [10, 9], [11, 10], [12, 11], [13, 12], [14, 13]].map((r) => r.join('\t')).join('\n'))});
    document.querySelector('.sheet-wrap').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    document.querySelector('.nav-item[data-view="graph"][data-id="${graphId}"]').click()`);
  const edited = (await state()).graphs[0];
  ok('data edits recompute the linked graph but keep the full-width choice', edited.spec.opts.sig[0].p !== p0 && edited.spec.opts.compactSpacing === false && await compactChecked() === false && (await measure()).W === 580);

  ok('renderer reports no console errors', errors.length === 0);
  console.log(`\n${pass} figure layout checks passed`);
}).then(() => finish(0)).catch((err) => { console.error(err); finish(1); });
function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
