// Exercise figure hover tooltips in the real renderer with actual mouse moves: a data
// point under the cursor shows its own value(s), anywhere else over a bar still shows
// that bar's mean / median / mode / range, and the hover ring never reaches an export.
// Run with: npm run test:ui
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-hover-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);

let win, pass = 0;
const run = (code) => win.webContents.executeJavaScript(code, true);
function ok(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}
async function show(spec) {
  const project = { tables: [], results: [], graphs: [{ id: 'fig', name: 'Figure', tableId: null, spec }], active: { view: 'graph', id: 'fig' } };
  assert.ok(await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(project))})`), 'Project loads');
  // the window may be shorter than asked (screen size), and the figure sits beside the tall controls
  assert.ok(await run(`(() => {
    const svg = document.querySelector('#graph-canvas svg'); svg.scrollIntoView({ block: 'center' });
    const r = svg.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;
  })()`), 'Figure fits in the viewport');
}
async function move(point) {
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await run('new Promise((r) => requestAnimationFrame(() => r()))');
}
// What the tooltip shows right now (null when hidden), and the ring's centre on screen.
const tooltip = () => run(`(() => {
  const t = document.getElementById('chart-tip');
  if (!t || t.style.display !== 'block') return null;
  const ring = document.querySelector('#graph-canvas .pt-hover-ring');
  let at = null;
  if (ring) { const r = ring.getBoundingClientRect(); at = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
  return { title: t.querySelector('.tip-title').textContent, rows: Array.from(t.querySelectorAll('.tip-row'), (r) => [r.children[0].textContent, r.children[1].textContent]), ring: at };
})()`);
const ringShown = () => run(`!!document.querySelector('#graph-canvas .pt-hover-ring')`);
// Screen centres (CSS px) of every hoverable point, with the read-out it was drawn with.
const points = () => run(`(() => {
  const svg = document.querySelector('#graph-canvas svg'), m = svg.getScreenCTM();
  return Array.from(svg.querySelectorAll('[data-pt]'), (n) => {
    const p = new DOMPoint(+n.getAttribute('data-px'), +n.getAttribute('data-py')).matrixTransform(m);
    return { x: p.x, y: p.y, g: n.getAttribute('data-pg'), tip: JSON.parse(n.getAttribute('data-pt')) };
  });
})()`);
// A spot inside bar i, at least `gap` screen px from every point centre.
const clearSpotOnBar = (i, gap) => run(`(() => {
  const svg = document.querySelector('#graph-canvas svg');
  const bar = svg.querySelectorAll('g[clip-path] > rect[rx="1.5"]')[${i}].getBoundingClientRect();
  const m = svg.getScreenCTM();
  const pts = Array.from(svg.querySelectorAll('[data-pt]'), (n) => new DOMPoint(+n.getAttribute('data-px'), +n.getAttribute('data-py')).matrixTransform(m));
  for (let y = bar.bottom - 3; y > bar.top + 3; y -= 2) for (let x = bar.left + 3; x < bar.right - 3; x += 2) {
    if (pts.every((p) => Math.hypot(p.x - x, p.y - y) > ${gap})) return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
})()`);
const near = (a, b, d = 1.5) => a && b && Math.hypot(a.x - b.x, a.y - b.y) <= d;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const STATS = ['Mean', 'Median', 'Mode', 'Range', 'n'];

const G = (name, values) => ({ name, values });
const two = [G('Control', [10, 12, 11, 13, 9]), G('Treated', [18, 20.5, 17, 21, 19])];

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1400, height: 1200,
    webPreferences: { contextIsolation: true, spellcheck: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(root, 'index.html'));
  win.webContents.debugger.attach('1.3');

  // ---- bar chart with points: point first, the bar's stats everywhere else ----
  await show({ chartType: 'bar', groups: two, opts: { title: 'Hover', showPoints: true, errorType: 'sem' } });
  let pts = await points();
  ok('every bar point is hoverable', pts.length === 10);
  const target = pts.find((p) => p.g === '1' && p.tip.r[0][1] === '20.5');
  await move({ x: Math.round(target.x), y: Math.round(target.y) });
  let tip = await tooltip();
  ok('hovering a point shows its group and exact value', tip && tip.title === 'Treated' && same(tip.rows, [['Value', '20.5']]));
  ok('the hovered point is ringed', near(tip.ring, target));
  await move({ x: Math.round(target.x + 4), y: Math.round(target.y - 2) });
  tip = await tooltip();
  ok('a point stays hovered within a few pixels of its marker', tip && same(tip.rows, [['Value', '20.5']]));

  const onBar = await clearSpotOnBar(1, 16);
  await move(onBar);
  tip = await tooltip();
  ok('hovering the bar away from its points still shows the bar stats', tip && tip.title === 'Treated' && same(tip.rows.map((r) => r[0]), STATS) &&
    same(tip.rows[0], ['Mean', '19.1']) && same(tip.rows[4], ['n', '5']));
  ok('the ring goes away once no point is hovered', !(await ringShown()));

  await move({ x: Math.round(target.x), y: Math.round(target.y) });
  ok('moving back onto the point switches to its value', same((await tooltip()).rows, [['Value', '20.5']]));
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: Math.round(target.x), y: Math.round(target.y) });
  ok('pressing to drag hides the tooltip and the ring', (await tooltip()) === null && !(await ringShown()));
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: Math.round(target.x), y: Math.round(target.y) });
  await move({ x: Math.round(target.x), y: Math.round(target.y) });
  ok('exports never include the hover ring', await ringShown() && !/pt-hover-ring/.test(await run('window.StatLab.activeGraphSVG()')));
  const wrap = await run(`document.querySelector('.graph-wrap').getBoundingClientRect().toJSON()`);
  await move({ x: Math.round(wrap.x - 10), y: Math.round(target.y) });
  ok('leaving the figure hides the tooltip and the ring', (await tooltip()) === null && !(await ringShown()));

  // ---- without points: the bar tooltip is exactly what it was ----
  await show({ chartType: 'bar', groups: two, opts: { title: 'Hover', errorType: 'sem' } });
  ok('a bar chart without points has nothing point-hoverable', (await points()).length === 0);
  await move({ x: Math.round(target.x), y: Math.round(target.y) });
  tip = await tooltip();
  ok('hovering a bar without points shows its stats', tip && tip.title === 'Treated' && same(tip.rows.map((r) => r[0]), STATS) && !tip.ring);

  // ---- a point the axis range clips away is not hoverable ----
  // the axis stops at 20, so 20.5 would sit just above the plot, inside the figure's top margin
  await show({ chartType: 'bar', groups: two, opts: { title: 'Clipped', showPoints: true, errorType: 'sem', yAxis: { auto: false, min: '0', max: '20', log: false, sci: false, step: '' } } });
  const hidden = await run(`(() => {
    const svg = document.querySelector('#graph-canvas svg'), n = Array.from(svg.querySelectorAll('.data-point')).find((e) => JSON.parse(e.getAttribute('data-pt')).r[0][1] === '20.5');
    const p = new DOMPoint(+n.getAttribute('data-px'), +n.getAttribute('data-py')).matrixTransform(svg.getScreenCTM()), box = svg.getBoundingClientRect();
    return { x: Math.round(p.x), y: Math.round(p.y), inFigure: p.y > box.top && p.y < box.bottom && p.x > box.left && p.x < box.right };
  })()`);
  await move(hidden);
  tip = await tooltip();
  ok('a value clipped off the plot shows no read-out where it would have been', hidden.inFigure && !(tip && tip.rows.some((r) => r[1] === '20.5')));

  // ---- other chart types: their points show their own values ----
  const cases = [
    ['column scatter', { chartType: 'dot', groups: two, opts: { errorType: 'sd' } }, 'Control', [['Value', '10']]],
    ['XY scatter', { chartType: 'xy', xs: [1, 2, 4], ys: [3, 5.5, 9], opts: { xLabel: 'Dose', yLabel: 'Response' } }, 'Point 1', [['Dose', '1'], ['Response', '3']]],
    ['line plot', { chartType: 'grouped-line', rowNames: ['Day 0', 'Day 7'], colNames: ['WT', 'KO'], cells: [[[1, 2, 3], [2, 3, 4]], [[3, 4, 5], [5, 6, 7]]], opts: { errorType: 'sem' } }, 'WT · Day 0', [['Mean', '2'], ['± SEM', '0.5774'], ['n', '3']]],
    ['before–after plot', { chartType: 'paired', groups: two, opts: { colA: ['10', '12'], colB: ['18', '11.5'], labelA: 'Pre', labelB: 'Post' } }, 'Pair 1', [['Pre', '10'], ['Post', '18'], ['Change', '+8']]],
    ['box-plot outlier', { chartType: 'box', groups: [G('A', [10, 11, 12, 11, 10, 12, 11, 10, 11, 12, 11, 10, 40])], opts: {} }, 'A', [['Outlier', '40']]],
  ];
  for (const [name, spec, title, rows] of cases) {
    await show(spec);
    pts = await points();
    await move({ x: Math.round(pts[0].x), y: Math.round(pts[0].y) });
    tip = await tooltip();
    ok(name + ': hovering a point shows its value(s)', tip && tip.title === title && same(tip.rows, rows) && near(tip.ring, pts[0]));
  }

  ok('no renderer errors', errors.length === 0);
  console.log(`\n${pass} chart hover checks passed`);
  app.exit(0);
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
