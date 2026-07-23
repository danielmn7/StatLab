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

console.log(`\n${pass} UI/data checks passed`);
