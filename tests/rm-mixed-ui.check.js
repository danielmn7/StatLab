// Repeated-measures two-way ANOVA and the mixed-effects model in the real renderer:
// the two "Repeated measures" questions, the subject preview, the method choice and
// the sphericity guidance must reach the stored spec, the calculation, the result
// card and the linked graph. Run with: npm run test:ui
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const D = require('../js/data.js');
const T = require('../js/stats-tests.js');
const M = require('../js/stats-mixed.js');
const fx = require('./rm-mixed-fixtures.json');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-rm-mixed-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);

let win, pass = 0;
const run = (code) => win.webContents.executeJavaScript(code, true);
function ok(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}
// A number as the result cards print it: fixed decimals, trailing zeros dropped.
const shown = (x, d) => String(parseFloat(x.toFixed(d)));
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1e-12, Math.abs(b));
// Field order is not part of a spec's meaning.
const sameSpec = (a, b) => JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k]])) === JSON.stringify(Object.keys(b).sort().map((k) => [k, b[k]]));
async function state() { return JSON.parse(await run('window.StatLab.getStateJSON()')); }
async function load(json) { assert.ok(await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(json))})`)); }
async function openAnalysis(name) {
  await run(`document.querySelector('#nav-tables .nav-item[data-view="data"]').click();
    Array.from(document.querySelectorAll('.view-actions button')).find((button) => button.textContent.includes('Analyze')).click()`);
  await run(`(() => {
    const card = Array.from(document.querySelectorAll('.test-opt')).find((item) => item.querySelector('.t-name').textContent.startsWith(${JSON.stringify(name)}));
    if (!card) throw new Error('Test option not found: ' + ${JSON.stringify(name)});
    card.click();
  })()`);
}
async function choose(selector, value) {
  await run(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error('No control ' + ${JSON.stringify(selector)});
    if (!Array.from(input.options).some((o) => o.value === ${JSON.stringify(String(value))})) throw new Error(${JSON.stringify(selector)} + ' has no option ' + ${JSON.stringify(String(value))});
    input.value = ${JSON.stringify(String(value))};
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}
const click = (selector) => run(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) throw new Error('No control ' + ${JSON.stringify(selector)}); n.click(); })()`);
const has = (selector) => run(`!!document.querySelector(${JSON.stringify(selector)})`);
const textOf = (selector) => run(`(document.querySelector(${JSON.stringify(selector)}) || { textContent: null }).textContent`);
const options = (selector) => run(`Array.from(document.querySelectorAll(${JSON.stringify(selector + ' option')})).map((o) => o.value)`);
const go = () => run(`document.querySelector('#analyze-go').click()`);
const cardText = () => run(`document.querySelector('.result-card').textContent`);
// data-subject of the preview cell at row i, column group j, subcolumn s (4 subcolumns, 2 groups).
const subjectAt = (i, j, s, nsub) => run(`(() => { const tr = document.querySelectorAll('#analyze-subjects .subject-table tr')[${i} + 2]; return tr.children[1 + ${j} * ${nsub} + ${s}].dataset.subject || null; })()`);

function groupedTable(grid, rowTitles, groupNames) {
  const table = new D.DataTable('grouped');
  const nsub = grid[0][0].length;
  while (table.groupNames.length < groupNames.length) table.addGroup();
  while (table.nsub < nsub) table.addReplicate();
  table.groupNames = groupNames.slice();
  table.ensureRows(grid.length);
  grid.forEach((row, i) => { table.rowTitles[i] = rowTitles[i]; row.forEach((cell, j) => cell.forEach((v, s) => { if (v != null) table.setCell(i, j * nsub + s, String(v)); })); });
  return table;
}
const TIMES = ['Baseline', 'Week 2', 'Week 4'], ARMS = ['Vehicle', 'Drug'];
const BASE = { kind: 'twoway', rowFactor: 'Rows', colFactor: 'Columns', phmethod: 'sidak', phdir: 'colsWithinRow', phfamily: 'each' };

app.whenReady().then(async () => {
  win = new BrowserWindow({
    show: false, width: 1320, height: 900,
    webPreferences: { contextIsolation: true, spellcheck: false, backgroundThrottling: false },
  });
  const pageErrors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') pageErrors.push(details.message); });
  await win.loadFile(path.join(root, 'index.html'));
  let s, text;

  // ---- complete data: the two questions and the subject preview ----
  const full = groupedTable(fx.splitBalanced.grid, TIMES, ARMS), sg = full.subcolumnGrid();
  await load({ tables: [full], results: [], graphs: [], counter: 1, active: { view: 'data', id: full.id } });
  await openAnalysis('Two-way ANOVA');
  ok('two questions, neither ticked', (await run(`[document.querySelector('#analyze-repeat-rows').checked, document.querySelector('#analyze-repeat-cols').checked].join()`)) === 'false,false');
  ok('unmatched: every value is its own subject', (await textOf('#analyze-subjects-summary')).startsWith('24 values, each from a different subject.') && !(await has('#analyze-subjects td[data-subject]')));
  ok('unmatched: no method or sphericity rows, model choice offered', !(await has('#analyze-rm-method')) && !(await has('#analyze-sphericity')) && (await has('#analyze-interaction')));
  await go();
  s = await state();
  ok('nothing ticked leaves the ordinary two-way spec unchanged', sameSpec(s.results[0].spec, BASE) && !('matching' in s.results[0].spec) && (await cardText()).startsWith('Two-way ANOVA'));

  await openAnalysis('Two-way ANOVA');
  await click('#analyze-repeat-rows');
  text = await textOf('#analyze-subjects-summary');
  ok('rows repeated: eight subjects', text.startsWith('8 subjects, each measured in 3 rows.') && text.includes('Subcolumn 1 of Vehicle and subcolumn 1 of Drug are different subjects.'));
  ok('rows repeated: a subcolumn is one subject down the rows, and differs between groups',
    (await subjectAt(0, 0, 1, 4)) === (await subjectAt(2, 0, 1, 4)) && (await subjectAt(0, 0, 1, 4)) !== (await subjectAt(0, 1, 1, 4)) && (await run(`document.querySelectorAll('#analyze-subjects td[data-subject]').length`)) === 24);
  ok('method choices, automatic first', JSON.stringify(await options('#analyze-rm-method')) === JSON.stringify(['auto', 'rm', 'mixed']) && (await textOf('#analyze-rm-method-note')) === 'No values are missing: this runs as repeated-measures ANOVA.');
  const eps = M.sphericityPreview(sg.grid, 'rows')[0].epsilon;
  ok('sphericity guidance shows this table’s epsilon', (await textOf('#analyze-sphericity-eps')).startsWith('ε = ' + eps.toFixed(2)) && (await textOf('#analyze-sphericity-why')).startsWith('Rows has 3 repeated levels')
    && (await textOf('#analyze-sphericity-status')).startsWith('Correction on.') && (await textOf('#analyze-sphericity-guide')).includes('Mauchly'));
  ok('repeated measures always fit the interaction', !(await has('#analyze-interaction')) && (await has('#analyze-rm-model-note')));
  await choose('#analyze-sphericity', 'assumed');
  ok('assuming sphericity is flagged', (await textOf('#analyze-sphericity-status')).startsWith('Correction off.') && (await run(`document.querySelector('#analyze-sphericity-status').classList.contains('caution')`)));
  await choose('#analyze-sphericity', 'gg');
  await click('#analyze-repeat-cols');
  ok('both repeated: the subcolumn number is the subject', (await textOf('#analyze-subjects-summary')).startsWith('4 subjects, each measured in 3 × 2 cells.') && (await subjectAt(0, 0, 3, 4)) === (await subjectAt(2, 1, 3, 4)));
  await click('#analyze-repeat-rows');
  ok('columns repeated: one subject per row and subcolumn', (await textOf('#analyze-subjects-summary')).startsWith('12 subjects, each measured in 2 column groups.')
    && (await subjectAt(1, 0, 2, 4)) === (await subjectAt(1, 1, 2, 4)) && (await subjectAt(1, 0, 2, 4)) !== (await subjectAt(2, 0, 2, 4)));
  ok('two repeated levels: nothing to choose', (await run(`document.querySelector('#analyze-sphericity').disabled`)) && (await textOf('#analyze-sphericity-why')).includes('has only 2 levels') && !(await has('#analyze-sphericity-status')));
  await click('#analyze-repeat-cols');
  await click('#analyze-repeat-rows');
  await go();
  s = await state();
  let res = s.results.find((r) => r.spec.matching);
  ok('rows-repeated spec', s.results.length === 2 && sameSpec(res.spec, Object.assign({}, BASE, { matching: 'rows', rmMethod: 'auto' })));
  const rm = M.twoWayRepeated(sg.grid, sg.rowNames, sg.colNames, { matching: 'rows', rowFactor: 'Rows', colFactor: 'Columns' });
  text = await cardText();
  ok('repeated-measures card', text.startsWith('Repeated-measures two-way ANOVA') && text.includes('Geisser-Greenhouse ε — Rows') && text.includes('Subjects (matching)') && text.includes('Was the matching effective?')
    && text.includes('Subjects analyzed8') && text.includes(shown(rm.effects[0].F, 4)));
  let graph = s.graphs.find((g) => g.resultId === res.id);
  let expected = M.twoWayRepeatedPosthoc(rm, 'sidak', 'colsWithinRow', { families: 'each' }).comparisons;
  ok('its graph brackets are the engine comparisons (Welch between groups)', graph.spec.opts.sig.length === 3 && graph.spec.opts.sig.every((b, i) => close(b.p, expected[i].p)) && expected[0].df !== expected[1].df);
  ok('result is named for the design', /RM ANOVA/.test(res.name));

  // ---- two values missing ----
  const gappy = groupedTable(fx.splitMissing.grid, TIMES, ARMS), gg = gappy.subcolumnGrid();
  await load({ tables: [gappy], results: [], graphs: [], counter: 1, active: { view: 'data', id: gappy.id } });
  await openAnalysis('Two-way ANOVA');
  await click('#analyze-repeat-rows');
  ok('incomplete subjects are named and marked', (await textOf('#analyze-subjects-summary')).includes('S2 and S7 have a missing value.') && (await run(`Array.from(document.querySelectorAll('#analyze-subjects td.miss')).map((td) => td.dataset.subject).join()`)) === '2,7');
  ok('automatic becomes the mixed-effects model', (await textOf('#analyze-rm-method-note')).startsWith('2 subjects have a missing value, so this runs as a mixed-effects model and uses all 22 values.'));
  ok('the model takes no sphericity correction', (await run(`document.querySelector('#analyze-sphericity').disabled`)) && (await textOf('#analyze-sphericity-why')).includes('Kenward-Roger'));
  await go();
  s = await state();
  const mm = M.twoWayRepeated(gg.grid, gg.rowNames, gg.colNames, { matching: 'rows', rowFactor: 'Rows', colFactor: 'Columns' });
  text = await cardText();
  ok('mixed-effects card', mm.mode === 'mixed' && text.startsWith('Mixed-effects model (two-way, repeated measures)') && text.includes('Random effect: Subject') && text.includes('Values analyzed22')
    && text.includes('2 subjects have a missing value; every value is used') && text.includes(shown(mm.effects[0].F, 4) + '2, ' + shown(mm.effects[0].df2, 3)));
  expected = M.twoWayRepeatedPosthoc(mm, 'sidak', 'colsWithinRow', { families: 'each' }).comparisons;
  ok('mixed-model graph: every value, engine comparisons', s.graphs[0].spec.cells.flat().flat().length === 22 && s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, expected[i].p)));
  ok('mixed-model result name', /Mixed-effects model/.test(s.results[0].name));

  await openAnalysis('Two-way ANOVA');
  await click('#analyze-repeat-rows');
  await choose('#analyze-rm-method', 'rm');
  ok('ANOVA-always warns how much is left out', (await textOf('#analyze-rm-method-note')).includes('2 subjects with a missing value would be left out: 18 of 22 values used.') && !(await run(`document.querySelector('#analyze-sphericity').disabled`)));
  await go();
  s = await state();
  res = s.results.find((r) => r.spec.rmMethod === 'rm');
  text = await cardText();
  ok('ANOVA on complete subjects is a separate analysis that says what it left out', s.results.length === 2 && text.startsWith('Repeated-measures two-way ANOVA')
    && text.includes('2 subjects with a missing value were left out (Vehicle · 2; Drug · 3)') && text.includes('Subjects analyzed6 of 8'));
  graph = s.graphs.find((g) => g.resultId === res.id);
  ok('its graph shows only the analyzed subjects', graph.spec.cells.flat().every((cell) => cell.length === 3));

  await openAnalysis('Two-way ANOVA');
  await click('#analyze-repeat-rows');
  await click('#analyze-repeat-cols');
  await choose('#analyze-sphericity', 'gg');
  await choose('#analyze-rm-method', 'mixed');
  await choose('#analyze-phdir', 'rowMeans');
  await go();
  s = await state();
  res = s.results.find((r) => r.spec.matching === 'both');
  const both = M.twoWayRepeated(gg.grid, gg.rowNames, gg.colNames, { matching: 'both', method: 'mixed', rowFactor: 'Rows', colFactor: 'Columns' });
  text = await cardText();
  ok('both factors repeated, model always', sameSpec(res.spec, { kind: 'twoway', rowFactor: 'Rows', colFactor: 'Columns', phmethod: 'sidak', phdir: 'rowMeans', matching: 'both', rmMethod: 'mixed' })
    && text.includes('Random effect: Rows × Subject') && text.includes('Random effect: Columns × Subject') && text.includes('Repeated factorRows and Columns') && both.random.length === 3);

  // ---- reopening recomputes the same analysis ----
  await load(Object.assign({}, s, { active: { view: 'result', id: res.id } }));
  ok('a saved repeated-measures analysis reopens', (await cardText()).startsWith('Mixed-effects model (two-way, repeated measures)'));

  // ---- one-way ----
  const names = ['Base', 'Wk1', 'Wk2', 'Wk3'];
  const column = (rows) => { const t = new D.DataTable('column'); t.setColumns(names); t.rows = rows.map((r) => r.map((v) => (v == null ? '' : String(v)))); t.ensureRows(rows.length + 2); return t; };
  const cols = (rows) => names.map((_, j) => rows.map((r) => (r[j] == null ? '' : r[j])));
  let table = column(fx.oneWayMissing.rows);
  await load({ tables: [table], results: [], graphs: [], counter: 1, active: { view: 'data', id: table.id } });
  await openAnalysis('Repeated-measures ANOVA');
  ok('one-way: rows with a gap switch automatic to the model', (await textOf('#analyze-rm-method-note')).startsWith('3 rows have a missing value, so this runs as a mixed-effects model and uses all 28 values.')
    && (await run(`document.querySelector('#analyze-sphericity').disabled`)));
  await go();
  s = await state();
  const one = M.oneWayMixed(cols(fx.oneWayMissing.rows), names);
  text = await cardText();
  ok('one-way mixed-effects spec and card', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'rm-anova', posthoc: 'tukey', rmMethod: 'auto' })
    && text.startsWith('Mixed-effects model (one-way, repeated measures)') && text.includes('Random effect: subjects') && text.includes('Values analyzed28 (3 rows with a missing value)') && text.includes(`F(3, ${shown(one.df2, 3)}) = ${shown(one.F, 4)}`));
  expected = M.oneWayMixedPosthoc(one, 'tukey', {}).comparisons;
  ok('one-way mixed-effects graph: every value, model comparisons', s.graphs[0].spec.groups.map((g) => g.values.length).join() === one.counts.join() && s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, expected[i].p)));

  // An analysis saved before the method choice existed keeps leaving incomplete rows out.
  await load({ tables: [table], results: [{ id: 'r-old', tableId: table.id, kind: 'rm-anova', name: 'Repeated-measures ANOVA', spec: { kind: 'rm-anova', posthoc: 'tukey' } }], graphs: [], counter: 5, active: { view: 'result', id: 'r-old' } });
  text = await cardText();
  const legacy = T.rmANOVA(cols(fx.oneWayMissing.rows), names);
  ok('an older saved analysis keeps its calculation', text.startsWith('Repeated-measures one-way ANOVA') && text.includes('3 rows with a missing value were left out') && text.includes('Matched rows analyzed' + legacy.n));
  await openAnalysis('Repeated-measures ANOVA');
  ok('and the new default is not mistaken for it', (await run(`document.querySelector('#analyze-existing').hidden`)));
  await choose('#analyze-rm-method', 'rm');
  ok('choosing ANOVA-always finds the older analysis', !(await run(`document.querySelector('#analyze-existing').hidden`)));

  table = column(fx.oneWayComplete.rows);
  await load({ tables: [table], results: [], graphs: [], counter: 1, active: { view: 'data', id: table.id } });
  await openAnalysis('Repeated-measures ANOVA');
  const whole = T.rmANOVA(cols(fx.oneWayComplete.rows), names);
  ok('one-way complete: ANOVA, with this table’s epsilon', (await textOf('#analyze-rm-method-note')) === 'No values are missing: this runs as repeated-measures ANOVA.' && (await textOf('#analyze-sphericity-eps')).startsWith('ε = ' + whole.epsilon.toFixed(2)));
  await choose('#analyze-sphericity', 'assumed');
  await choose('#analyze-rm-method', 'mixed');
  await go();
  s = await state();
  ok('model-always stores no sphericity choice', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'rm-anova', posthoc: 'tukey', rmMethod: 'mixed' }) && (await cardText()).startsWith('Mixed-effects model (one-way, repeated measures)'));

  ok('renderer reports no console errors', pageErrors.length === 0);
  console.log(`\n${pass} repeated-measures UI checks passed`);
}).then(() => finish(0)).catch((err) => {
  console.error(err);
  finish(1);
});

function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
