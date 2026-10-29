const assert = require('assert');
const Charts = require('../js/charts.js');
const DataLib = require('../js/data.js');

let pass = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}

// Grouped tables must retain one value per typed cell and expose the matrix shape
// consumed by both grouped chart types.
const table = new DataLib.DataTable('grouped');
table.groupNames = ['WT', 'Mutant'];
table.nsub = 2;
table.rowTitles = ['Day 0', 'Day 7'];
table.rows[0][0] = '4';
table.rows[0][1] = '5';
table.rows[0][2] = '6';
table.rows[0][3] = '7';
const matrix = table.cellsMatrix();
ok('grouped cell value is not duplicated', matrix.cells[0][0][0] === 4 && matrix.cells[0][0][1] === 5);
ok('grouped matrix preserves row and series names', matrix.rowNames[0] === 'Day 0' && matrix.colNames[1] === 'Mutant');

const cells = [
  [[1, 2, 3], [2, 3, 4]],
  [[3, 4, 5], [5, 6, 7]],
  [[6, 7, 8], [8, 9, 10]],
];
const rows = ['Day 0', 'Day 7', 'Day 14'];
const cols = ['WT', 'Mutant'];
const line = Charts.groupedLine(cells, rows, cols, { title: 'Growth', legendPosition: 'right' });
ok('grouped line chart renders a series for each group', (line.match(/class="grouped-line-series/g) || []).length === cols.length);
ok('grouped line chart includes x-axis row labels', rows.every((r) => line.includes(r)));
ok('grouped line chart includes a positioned legend', line.includes('class="chart-legend" data-position="right"'));

const grouped = Charts.groupedBar(cells, rows, cols, {
  sig: [{ ca: 0, ja: 0, cb: 1, jb: 0, p: 0.01, on: true }],
  legendPosition: 'right',
});
ok('grouped bar chart keeps legend outside the plot by default', grouped.includes('class="chart-legend" data-position="right"'));
ok('grouped bar chart labels significance annotations', grouped.includes('class="sig-annotation"'));

// Column scatters must keep near-equal replicates from burying one another when
// there is horizontal room to separate them.
function pointsOf(svg) {
  const out = [], re = /data-pg="(\d+)" data-pi="(\d+)" data-px="([-\d.]+)" data-py="([-\d.]+)"/g;
  let m;
  while ((m = re.exec(svg))) out.push({ g: +m[1], i: +m[2], x: +m[3], y: +m[4] });
  return out;
}
function closestPair(points) {
  let best = Infinity;
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
    if (points[a].g === points[b].g) best = Math.min(best, Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y));
  }
  return best;
}
const plotLeft = 70, plotWidth = 580 - 70 - 24;   // default frame
const crowded = [
  { name: 'Ctrl', values: [10, 10.05, 10.1, 10.02, 12, 9.98, 10.07, 14, 10.03] },
  { name: 'Drug', values: [20, 20, 20, 20.1, 19.9, 25, 15, 20.05] },
  { name: 'Spread', values: [5, 8, 11, 14, 17, 20, 23] },
];
const dotPts = pointsOf(Charts.dotPlot(crowded, {}));
const barPts = pointsOf(Charts.barChart(crowded, { showPoints: true }));
ok('dot plot draws every replicate', dotPts.length === crowded.reduce((n, g) => n + g.values.length, 0));
ok('dot plot keeps near-equal replicates apart (no marker overlap)', closestPair(dotPts) >= 2 * 3.6);
ok('bar chart points keep near-equal replicates apart (no marker overlap)', closestPair(barPts) >= 2 * 3.1);
ok('identical values stay at the same height (y encodes the value)', (() => {
  const ys = dotPts.filter((p) => p.g === 1 && crowded[1].values[p.i] === 20).map((p) => p.y);
  return ys.length === 3 && ys.every((y) => y === ys[0]);
})());
ok('swarmed points stay inside their own category slot', [dotPts, barPts].every((pts) => pts.every((p) => {
  const slot = plotWidth / crowded.length, left = plotLeft + slot * p.g;
  return p.x > left && p.x < left + slot;
})));
ok('points whose jittered spot is already clear do not move', (() => {
  const slot = plotWidth / crowded.length, spread = Math.min(46, slot * 0.5), cx = plotLeft + slot * 2.5;
  let seed = 2 * 131 + 17;
  return dotPts.filter((p) => p.g === 2).every((p) => {
    seed = (seed * 9301 + 49297) % 233280;
    return Math.abs(p.x - (cx + (seed / 233280 - 0.5) * spread)) < 0.01;
  });
})());
ok('isolated points keep their jitter spot even when their group has a packed cluster', (() => {
  // Ctrl's ~10 cluster is too wide for the usual cloud, so the group is packed; 12 and 14 are far from it.
  const slot = plotWidth / crowded.length, spread = Math.min(46, slot * 0.5), cx = plotLeft + slot * 0.5;
  let seed = 0 * 131 + 17;
  const expected = crowded[0].values.map(() => { seed = (seed * 9301 + 49297) % 233280; return cx + (seed / 233280 - 0.5) * spread; });
  const ctrl = dotPts.filter((p) => p.g === 0);
  const cluster = ctrl.filter((p) => crowded[0].values[p.i] < 11);
  const moved = cluster.some((p) => Math.abs(p.x - expected[p.i]) > 0.01);
  return moved && ctrl.filter((p) => crowded[0].values[p.i] > 11).every((p) => Math.abs(p.x - expected[p.i]) < 0.01);
})());
ok('point layout is deterministic between renders', JSON.stringify(pointsOf(Charts.dotPlot(crowded, {}))) === JSON.stringify(dotPts));
ok('wide symbols (diamonds) also keep clear of each other', (() => {
  const pts = pointsOf(Charts.dotPlot(crowded, { markers: ['diamond', 'diamond', 'diamond'] }));
  return closestPair(pts) >= 2 * 3.6 * 1.4;
})());
ok('swarmOffsets packs exact ties side by side within the allowed width', (() => {
  const xs = Charts.swarmOffsets([0, 1, 2, 3, 4].map(() => ({ y: 100, pref: 0, r: 4 })), 30, 30).sort((a, b) => a - b);
  return xs.every((x, k) => k === 0 || x - xs[k - 1] >= 8.8 - 1e-9) && xs[0] >= -30 && xs[xs.length - 1] <= 30;
})());
ok('a very dense column stays finite, inside its slot and fast', (() => {
  const dense = [{ name: 'Dense', values: Array.from({ length: 1200 }, (_, k) => 50 + (k % 5) * 0.001) }, { name: 'Other', values: [1, 2, 3] }];
  const t0 = Date.now();
  const pts = pointsOf(Charts.dotPlot(dense, {}));
  const slot = plotWidth / 2;
  return Date.now() - t0 < 2000 && pts.length === 1203 && pts.every((p) => isFinite(p.x) && p.x > plotLeft + slot * p.g && p.x < plotLeft + slot * (p.g + 1));
})());
ok('box plot spreads tied outliers instead of stacking them', (() => {
  const svg = Charts.boxPlot([{ name: 'A', values: [10, 11, 12, 11, 10, 12, 11, 10, 11, 12, 11, 10, 40, 40, 40] }], {});
  const cx = Array.from(svg.matchAll(/class="box-outlier" cx="([-\d.]+)"/g), (m) => +m[1]).sort((a, b) => a - b);
  return cx.length === 3 && cx[1] - cx[0] >= 7.2 && cx[2] - cx[1] >= 7.2;
})());

console.log(`\n${pass} UI/data checks passed`);
