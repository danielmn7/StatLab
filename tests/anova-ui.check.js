// ANOVA-family options in the real renderer: every choice must reach the stored
// spec, the calculation, the result card and the linked graph, and survive reopening.
// Run with: npm run test:ui
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const D = require('../js/data.js');
const T = require('../js/stats-tests.js');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-anova-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);

let win, pass = 0;
const run = (code) => win.webContents.executeJavaScript(code, true);
function ok(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1e-12, Math.abs(b));
async function state() { return JSON.parse(await run('window.StatLab.getStateJSON()')); }
async function load(json) { assert.ok(await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(json))})`)); }
function makeTable(type, names, rows) {
  const table = new D.DataTable(type);
  table.setColumns(names);
  table.rows = rows.map((row) => row.map((v) => v == null ? '' : String(v)));
  table.ensureRows(rows.length + 2);
  return table;
}
async function fixture(type, names, rows) {
  const table = makeTable(type, names, rows);
  await load({ tables: [table], results: [], graphs: [], counter: 1, active: { view: 'data', id: table.id } });
}
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
const options = (selector) => run(`Array.from(document.querySelectorAll(${JSON.stringify(selector + ' option')})).map((o) => o.value)`);
const go = () => run(`document.querySelector('#analyze-go').click()`);
// Rows of the first post-hoc table of the open result card, as arrays of cell text.
const tableRows = (selector) => run(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((row) => Array.from(row.children).map((cell) => cell.textContent))`);
const cardText = () => run(`document.querySelector('.result-card').textContent`);
const pNumber = (text) => text.startsWith('<') ? 0 : parseFloat(text);

const A = [22, 24, 21, 25, 23, 26], B = [30, 28, 31, 27, 29], Cc = [26, 25, 27, 24, 28, 30, 31], Dd = [35, 31, 38, 29];
const names = ['Ctl', 'Low', 'Mid', 'High'];
const cols = [A, B, Cc, Dd];
const colRows = Array.from({ length: 7 }, (_, r) => cols.map((c) => c[r]));
const groups = cols.map((values, i) => ({ name: names[i], values }));
const RM = [[10, 12, 15, 14], [8, 9, 13, 15], [11, 11, 14, 13], [9, 13, 12, 17], [12, 14, 18, 16], [7, 10, 11, 15]];

app.whenReady().then(async () => {
  win = new BrowserWindow({
    show: false, width: 1320, height: 900,
    webPreferences: { contextIsolation: true, spellcheck: false, backgroundThrottling: false },
  });
  const pageErrors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') pageErrors.push(details.message); });
  await win.loadFile(path.join(root, 'index.html'));

  // ---- the option inventory ----
  await fixture('column', names, colRows);
  await openAnalysis('One-way ANOVA');
  ok('one-way ANOVA offers every comparison family', JSON.stringify(await options('#analyze-family')) === JSON.stringify(['all', 'control', 'custom', 'trend', 'none']));
  ok('every-pair methods', JSON.stringify(await options('#analyze-method')) === JSON.stringify(['tukey', 'holm-sidak', 'bonferroni', 'sidak', 'snk', 'lsd', 'fdr-bh', 'fdr-bky', 'fdr-by', 'games-howell', 'tamhane-t2', 'dunnett-t3']));
  await choose('#analyze-family', 'control');
  ok('control methods start with Dunnett and offer no range methods', JSON.stringify(await options('#analyze-method')) === JSON.stringify(['dunnett', 'holm-sidak', 'bonferroni', 'sidak', 'lsd', 'fdr-bh', 'fdr-bky', 'fdr-by', 'tamhane-t2', 'dunnett-t3']));
  ok('control family asks for the control group', JSON.stringify(await options('#analyze-control')) === JSON.stringify(['0', '1', '2', '3']));
  await choose('#analyze-family', 'trend');
  ok('trend and none need no method', !(await run(`!!document.querySelector('#analyze-method')`)));
  ok('ANOVA options still offer no one-tailed control', await run(`!document.querySelector('#analyze-alternative')`));

  // ---- default spec is the one older versions stored ----
  await openAnalysis('One-way ANOVA');
  await go();
  let s = await state();
  ok('default one-way spec is unchanged', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'anova', posthoc: 'tukey' }));
  const av = T.oneWayANOVA(groups);
  let text = await cardText();
  ok('ANOVA card reports Brown–Forsythe ANOVA and both variance tests', text.includes('Brown–Forsythe F') && text.includes('Equal-variance tests') && text.includes('Bartlett'));
  let rows = await tableRows('.result-card table.posthoc tbody tr');
  ok('Tukey table keeps its columns', JSON.stringify(await tableRows('.result-card table.posthoc thead tr')) === JSON.stringify([['Comparison', 'Mean diff', '95% CI', 'q', 'P', '']]) && rows.length === 6);
  await openAnalysis('One-way ANOVA');
  ok('re-running the default opens the existing result', (await run(`document.querySelector('#analyze-go').textContent`)).includes('Open existing'));

  // ---- each method computes what it names ----
  const expectAll = async (method, check) => {
    await fixture('column', names, colRows);
    await openAnalysis('One-way ANOVA');
    await choose('#analyze-method', method);
    await go();
    const st = await state();
    ok(method + ' is stored in the spec', st.results[0].spec.posthoc === method && st.results[0].spec.family === undefined);
    const expected = T.posthoc(av, method).comparisons;
    const sig = st.graphs[0].spec.opts.sig;
    ok(method + ' reaches the linked graph', sig.length === 6 && sig.every((b, i) => close(b.p, expected[i].p) && b.sig === expected[i].sig));
    if (check) await check(expected, st);
  };
  await expectAll('games-howell', async (expected) => {
    const head = await tableRows('.result-card table.posthoc thead tr');
    ok('Games-Howell shows a CI, q and per-pair df', JSON.stringify(head[0]) === JSON.stringify(['Comparison', 'Mean diff', '95% CI', 'q', 'df', 'P (adj)', '']));
    ok('Games-Howell differs from Tukey', Math.abs(expected[0].p - T.posthoc(av, 'tukey').comparisons[0].p) > 1e-6);
  });
  await expectAll('dunnett-t3');
  await expectAll('tamhane-t2');
  await expectAll('snk', async () => ok('Newman-Keuls explains itself', (await cardText()).includes('Newman-Keuls is more powerful')));
  await expectAll('lsd', async () => ok('LSD is labelled uncorrected', (await tableRows('.result-card table.posthoc thead tr'))[0].includes('P (uncorrected)')));
  await expectAll('fdr-bky', async () => ok('FDR reports q values', (await tableRows('.result-card table.posthoc thead tr'))[0].includes('q (FDR)') && (await cardText()).includes('false discovery rate')));
  await expectAll('sidak');

  // ---- each vs control ----
  await fixture('column', names, colRows);
  await openAnalysis('One-way ANOVA');
  await choose('#analyze-family', 'control');
  await choose('#analyze-control', 1);
  await go();
  s = await state();
  ok('Dunnett keeps its stored shape', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'anova', posthoc: 'dunnett', control: 1 }));
  let expected = T.posthoc(av, 'dunnett', { control: 1 }).comparisons;
  rows = await tableRows('.result-card table.posthoc tbody tr');
  ok('Dunnett compares each group with the chosen control', rows.length === 3 && rows.every((r) => r[0].endsWith('vs Low')) && (await cardText()).includes('Dunnett vs Low'));
  ok('Dunnett with unequal n reaches the graph', s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, expected[i].p)));
  ok('Dunnett now shows simultaneous intervals', (await tableRows('.result-card table.posthoc thead tr'))[0].includes('95% CI'));

  await fixture('column', names, colRows);
  await openAnalysis('One-way ANOVA');
  await choose('#analyze-family', 'control');
  await choose('#analyze-method', 'bonferroni');
  await choose('#analyze-control', 3);
  await go();
  s = await state();
  ok('control family with another method is stored', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'anova', posthoc: 'bonferroni', control: 3, family: 'control' }));
  expected = T.posthoc(av, 'bonferroni', { family: 'control', control: 3 }).comparisons;
  ok('control-family Bonferroni adjusts over k − 1 comparisons', s.graphs[0].spec.opts.sig.length === 3 && s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, expected[i].p)));
  ok('its result names the control', (await cardText()).includes('each vs High (Bonferroni)') && s.results[0].name !== undefined);

  // ---- selected pairs ----
  await fixture('column', names, colRows);
  await openAnalysis('One-way ANOVA');
  await choose('#analyze-family', 'custom');
  ok('selected pairs default to Šídák, as before', (await run(`document.querySelector('#analyze-method').value`)) === 'sidak');
  await choose('#analyze-method', 'fdr-bh');
  await run(`(() => { const boxes = document.querySelectorAll('#analyze-opts input[type=checkbox]'); boxes[0].click(); boxes[5].click(); })()`);
  await go();
  s = await state();
  ok('selected pairs keep the stored custom shape', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'anova', pairs: [[0, 1], [2, 3]], posthoc: 'custom', correction: 'fdr-bh' }));
  expected = T.posthoc(av, 'custom', { pairs: [[0, 1], [2, 3]], correction: 'fdr-bh' }).comparisons;
  ok('selected pairs are adjusted over the selection only', s.graphs[0].spec.opts.sig.length === 2 && s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, expected[i].p)));

  // ---- trend and none ----
  await fixture('column', names, colRows);
  await openAnalysis('One-way ANOVA');
  await choose('#analyze-family', 'trend');
  await go();
  s = await state();
  const tr = T.linearTrend(av);
  text = await cardText();
  ok('linear trend is stored and reported', s.results[0].spec.posthoc === 'trend' && text.includes('Test for linear trend') && text.includes(`F(1, ${tr.df2})`) && text.includes('Departure from a straight line'));
  ok('linear trend draws no pairwise brackets', s.graphs[0].spec.opts.sig.length === 0 && !(await run(`!!document.querySelector('.result-card table.posthoc')`)));
  await fixture('column', names, colRows);
  await openAnalysis('One-way ANOVA');
  await choose('#analyze-family', 'none');
  await go();
  s = await state();
  ok('no multiple comparisons', s.results[0].spec.posthoc === 'off' && s.graphs[0].spec.opts.sig.length === 0 && !(await cardText()).includes('Post-hoc'));

  // ---- Kruskal-Wallis / Dunn ----
  const kw = T.kruskalWallis(groups);
  await fixture('column', names, colRows);
  await openAnalysis('Kruskal-Wallis');
  ok('Dunn families and methods', JSON.stringify(await options('#analyze-family')) === JSON.stringify(['all', 'control', 'custom', 'none'])
    && JSON.stringify(await options('#analyze-method')) === JSON.stringify(['holm-sidak', 'bonferroni', 'sidak', 'none', 'fdr-bh', 'fdr-bky', 'fdr-by']));
  await go();
  s = await state();
  ok('default Kruskal-Wallis spec is unchanged', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'kruskal', posthoc: 'holm-sidak' }));
  await fixture('column', names, colRows);
  await openAnalysis('Kruskal-Wallis');
  await choose('#analyze-family', 'control');
  await choose('#analyze-method', 'none');
  await choose('#analyze-control', 0);
  await go();
  s = await state();
  expected = T.dunnPosthoc(kw, 'none', { family: 'control', control: 0 }).comparisons;
  ok('uncorrected Dunn vs control is stored and computed', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'kruskal', posthoc: 'none', control: 0, family: 'control' })
    && s.graphs[0].spec.opts.sig.length === 3 && s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, expected[i].pRaw)));
  ok('uncorrected Dunn is labelled', (await cardText()).includes("Dunn's post-hoc (each vs Ctl, uncorrected)"));

  // ---- repeated measures ----
  const rmNames = ['Base', 'Wk1', 'Wk2', 'Wk3'];
  const rmCols = [0, 1, 2, 3].map((j) => RM.map((r) => r[j]));
  const rm = T.rmANOVA(rmCols, rmNames);
  await fixture('column', rmNames, RM);
  await openAnalysis('Repeated-measures ANOVA');
  ok('repeated measures offers sphericity and no unequal-variance or trend choices', JSON.stringify(await options('#analyze-sphericity')) === JSON.stringify(['gg', 'assumed'])
    && JSON.stringify(await options('#analyze-family')) === JSON.stringify(['all', 'control', 'custom', 'none'])
    && JSON.stringify(await options('#analyze-method')) === JSON.stringify(['tukey', 'holm-sidak', 'bonferroni', 'sidak', 'snk', 'lsd', 'fdr-bh', 'fdr-bky', 'fdr-by']));
  await go();
  s = await state();
  ok('default repeated-measures spec', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'rm-anova', posthoc: 'tukey', rmMethod: 'auto' }));
  text = await cardText();
  ok('repeated-measures card reports the Geisser-Greenhouse result', text.includes('P value (Geisser-Greenhouse)') && text.includes('Geisser-Greenhouse ε') && text.includes('Was the matching effective?') && text.includes('Individual (between rows)'));
  rows = await tableRows('.result-card table.stats:not(.posthoc) tbody tr');
  const fRow = rows.find((r) => r[0] === 'Treatment (between columns)');
  ok('repeated-measures F is the engine F', close(parseFloat(fRow[4]), parseFloat(rm.F.toPrecision(4))) || Math.abs(parseFloat(fRow[4]) - rm.F) < 0.01);
  expected = T.rmPosthoc(rm, 'tukey').comparisons;
  ok('repeated-measures comparisons use each pair’s own differences', s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, expected[i].p)) && expected[0].df === 5);

  await openAnalysis('Repeated-measures ANOVA');
  await choose('#analyze-sphericity', 'assumed');
  await choose('#analyze-family', 'control');
  await go();
  s = await state();
  const pooled = T.rmANOVA(rmCols, rmNames, { sphericity: true });
  const spherical = s.results.find((r) => r.spec.sphericity);
  ok('assuming sphericity is a separate analysis', s.results.length === 2 && JSON.stringify(spherical.spec) === JSON.stringify({ kind: 'rm-anova', posthoc: 'dunnett', control: 0, rmMethod: 'auto', sphericity: true }));
  expected = T.rmPosthoc(pooled, 'dunnett', { control: 0 }).comparisons;
  const sphGraph = s.graphs.find((g) => g.resultId === spherical.id) || s.graphs[s.graphs.length - 1];
  ok('sphericity-assumed Dunnett uses the pooled residual', sphGraph.spec.opts.sig.length === 3 && sphGraph.spec.opts.sig.every((b, i) => close(b.p, expected[i].p)) && expected[0].df === 15);
  ok('its card says so', (await cardText()).includes('P value (sphericity assumed)'));

  // With "Repeated-measures ANOVA always", a blank cell drops that subject everywhere
  // and says so; rows are never shifted. (The default now fits a mixed-effects model
  // instead: see rm-mixed-ui.check.js.)
  const gappy = RM.map((r) => r.slice()); gappy.splice(2, 0, ['', 99, 99, 99]);
  await fixture('column', rmNames, gappy);
  await openAnalysis('Repeated-measures ANOVA');
  await choose('#analyze-rm-method', 'rm');
  await go();
  s = await state();
  text = await cardText();
  ok('an incomplete row is left out with a warning', text.includes('1 row with a missing value was left out') && s.graphs[0].spec.groups.every((g) => g.values.length === 6));
  ok('the remaining rows stay matched', s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, T.rmPosthoc(rm, 'tukey').comparisons[i].p)));
  await fixture('column', rmNames, [[1, 2, 3, 4], ['', 5, 6, 7]]);
  await openAnalysis('Repeated-measures ANOVA');
  await choose('#analyze-rm-method', 'rm');
  await go();
  ok('too few matched rows is an explicit unavailable state', (await cardText()).includes('needs at least two rows with a value in every column') && !(await run(`!!document.querySelector('.result-card .verdict.sig')`)));

  // ---- Friedman ----
  const fr = T.friedman(rmCols, rmNames);
  await fixture('column', rmNames, RM);
  await openAnalysis('Friedman test');
  await go();
  s = await state();
  ok('default Friedman spec', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'friedman', posthoc: 'holm-sidak' }));
  expected = T.friedmanDunn(fr, 'holm-sidak').comparisons;
  text = await cardText();
  ok('Friedman card and graph', text.includes('Friedman statistic') && text.includes('Rank sums') && text.includes("Dunn's post-hoc (Holm-Šídák)") && s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, expected[i].p)));

  // ---- persistence and recomputation ----
  await fixture('column', rmNames, RM);
  await openAnalysis('Repeated-measures ANOVA');
  await choose('#analyze-method', 'fdr-by');
  await go();
  const saved = await state();
  await load(saved);
  s = await state();
  ok('a reopened project keeps the choice and the result', s.results[0].spec.posthoc === 'fdr-by' && s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, saved.graphs[0].spec.opts.sig[i].p)));
  // Paste the columns in reverse order over the sheet, as a user would.
  await run(`document.querySelector('#nav-tables .nav-item[data-view="data"]').click();
    const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(RM.map((row) => row.slice().reverse().join('\t')).join('\n'))});
    document.querySelector('.sheet-wrap').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    document.querySelector('.nav-item[data-view="result"]').click()`);
  s = await state();
  ok('the paste changed the data', s.tables[0].rows[0][0] === '14');
  const flipped = T.rmPosthoc(T.rmANOVA([3, 2, 1, 0].map((j) => RM.map((r) => r[j])), rmNames), 'fdr-by').comparisons;
  ok('changed data recompute with the stored method', s.results[0].spec.posthoc === 'fdr-by' && s.graphs[0].spec.opts.sig.every((b, i) => close(b.p, flipped[i].p)));

  // Projects saved before these options keep computing what they computed.
  const legacyTable = makeTable('column', names, colRows);
  const legacy = (spec) => ({ tables: [legacyTable], results: [{ id: 'r1', tableId: legacyTable.id, name: 'Legacy', spec }], graphs: [], counter: 5, active: { view: 'result', id: 'r1' } });
  await load(legacy({ kind: 'anova', posthoc: 'custom', pairs: [[0, 2]], correction: 'holm-sidak' }));
  rows = await tableRows('.result-card table.posthoc tbody tr');
  expected = T.posthoc(av, 'custom', { pairs: [[0, 2]], correction: 'holm-sidak' }).comparisons;
  ok('legacy selected-pairs analysis recomputes', rows.length === 1 && rows[0][0] === 'Ctl vs Mid' && Math.abs(pNumber(rows[0][rows[0].length - 2]) - expected[0].p) < 5e-4);
  await load(legacy({ kind: 'kruskal', posthoc: 'bonferroni', pairs: [[1, 3]] }));
  rows = await tableRows('.result-card table.posthoc tbody tr');
  ok('legacy Dunn selected pairs recompute', rows.length === 1 && rows[0][0] === 'Low vs High' && (await cardText()).includes("Dunn's post-hoc (selected pairs, Bonferroni)"));

  // ---- two-way ----
  const TW = [[[4, 5, 6], [7, 9, null], [10, 12, 11]], [[5, 7, null], [8, 8.5, 10], [15, 14, 17]]];
  const gt = new D.DataTable('grouped'); // two column groups × three replicate subcolumns
  gt.addGroup();
  gt.groupNames = ['Veh', 'DrugA', 'DrugB'];
  TW.forEach((row, i) => row.forEach((cell, j) => cell.forEach((v, k) => { if (v != null) gt.setCell(i, j * gt.nsub + k, String(v)); })));
  const cm = gt.cellsMatrix();
  await load({ tables: [gt], results: [], graphs: [], counter: 1, active: { view: 'data', id: gt.id } });
  await openAnalysis('Two-way ANOVA');
  ok('two-way offers the model choice and the added methods', JSON.stringify(await options('#analyze-interaction')) === JSON.stringify(['full', 'additive'])
    && JSON.stringify(await options('#analyze-phmethod')) === JSON.stringify(['sidak', 'tukey', 'holm-sidak', 'bonferroni', 'dunnett', 'lsd', 'fdr-bh', 'fdr-bky', 'fdr-by'])
    && !(await run(`!!document.querySelector('#analyze-phcontrol')`)));
  ok('simple effects ask how many families, one per row by default', JSON.stringify(await options('#analyze-phfamily')) === JSON.stringify(['each', 'all'])
    && (await run(`document.querySelector('#analyze-phfamily').value`)) === 'each'
    && (await run(`document.querySelector('#analyze-phfamily option').textContent`)).includes('One family per row'));
  await go();
  s = await state();
  ok('default two-way spec adds only the family choice', JSON.stringify(s.results[0].spec) === JSON.stringify({ kind: 'twoway', rowFactor: 'Rows', colFactor: 'Columns', phmethod: 'sidak', phdir: 'colsWithinRow', phfamily: 'each' }));
  const fitted = T.twoWayANOVA(cm.cells, cm.rowNames, cm.colNames);
  text = await cardText();
  expected = T.twoWayPosthoc(fitted, 'sidak', 'colsWithinRow', { families: 'each' }).comparisons;
  let pooledP = T.twoWayPosthoc(fitted, 'sidak', 'colsWithinRow', { families: 'all' }).comparisons;
  ok('per-row and whole-table families give different p-values in this fixture', expected.some((c, i) => !close(c.p, pooledP[i].p)));
  ok('the card names the family and shows per-row p-values', text.includes('one family per Rows') && s.graphs[0].spec.opts.sig.every((b2, i) => close(b2.p, expected[i].p)));
  // One family for all: a separate analysis; Tukey and Dunnett cannot use it.
  await openAnalysis('Two-way ANOVA');
  await choose('#analyze-phfamily', 'all');
  await go();
  s = await state();
  const whole = s.results.find((r) => r.spec.phfamily === 'all');
  text = await cardText();
  const wholeGraph = s.graphs.find((g) => g.resultId === whole.id) || s.graphs[s.graphs.length - 1];
  ok('one family for all is stored, named and computed', s.results.length === 2 && text.includes('one family for all comparisons') && wholeGraph.spec.opts.sig.every((b2, i) => close(b2.p, pooledP[i].p)));
  await openAnalysis('Two-way ANOVA');
  await choose('#analyze-phfamily', 'all');
  await choose('#analyze-phmethod', 'tukey');
  ok('Tukey keeps one family per row', (await run(`document.querySelector('#analyze-phfamily').value`)) === 'each' && (await run(`document.querySelector('#analyze-phfamily option[value=all]').disabled`)) === true);
  await choose('#analyze-phdir', 'colMeans');
  ok('main effects have no family choice', !(await run(`!!document.querySelector('#analyze-phfamily')`)));
  await run(`document.querySelector('#modal-analyze [data-close]').click()`);
  // A project saved before the choice existed keeps its pooled Šídák numbers.
  const legacySpec = { kind: 'twoway', rowFactor: 'Rows', colFactor: 'Columns', phmethod: 'sidak', phdir: 'colsWithinRow' };
  await load({ tables: [gt], results: [{ id: 'r-old', tableId: gt.id, kind: 'twoway', name: 'Two-way ANOVA', spec: legacySpec }], graphs: [], counter: 5, active: { view: 'result', id: 'r-old' } });
  text = await cardText();
  ok('an older saved analysis still pools every row into one family', text.includes('one family for all comparisons') && pooledP.every((c) => text.includes(c.a + ' vs ' + c.b)));
  await openAnalysis('Two-way ANOVA');
  await choose('#analyze-phfamily', 'all');
  ok('the older analysis is recognised as the one-family-for-all analysis', (await run(`document.querySelector('#analyze-go').textContent`)) === 'Open existing result');
  await choose('#analyze-phfamily', 'each');
  ok('one family per row is a new analysis beside it', (await run(`document.querySelector('#analyze-go').textContent`)) === 'Run analysis');
  // Main effects only: simple effects are not offered; comparisons use marginal means.
  await choose('#analyze-interaction', 'additive');
  ok('without an interaction only main effects are offered', JSON.stringify(await options('#analyze-phdir')) === JSON.stringify(['colMeans', 'rowMeans'])
    && !(await run(`!!document.querySelector('#analyze-phfamily')`)) && (await run(`document.querySelector('#analyze-phdir-note').textContent`)).includes('estimated marginal means'));
  await choose('#analyze-phmethod', 'dunnett');
  ok('Dunnett asks for a control among the compared levels', JSON.stringify(await run(`Array.from(document.querySelectorAll('#analyze-phcontrol option')).map((o) => o.textContent)`)) === JSON.stringify(cm.colNames));
  await choose('#analyze-phdir', 'rowMeans');
  ok('the control list follows the comparison direction', JSON.stringify(await run(`Array.from(document.querySelectorAll('#analyze-phcontrol option')).map((o) => o.textContent)`)) === JSON.stringify(cm.rowNames));
  await choose('#analyze-phdir', 'colMeans');
  await choose('#analyze-phcontrol', 1);
  await go();
  s = await state();
  const tw = s.results.find((r) => r.spec.interaction === false);
  ok('main-effects-only Dunnett is a separate, stored analysis', s.results.length === 2 && tw.spec.phmethod === 'dunnett' && tw.spec.phcontrol === 1 && tw.spec.phdir === 'colMeans' && tw.spec.phfamily === undefined);
  const model = T.twoWayANOVA(cm.cells, cm.rowNames, cm.colNames, { interaction: false });
  expected = T.twoWayPosthoc(model, 'dunnett', 'colMeans', { control: 1 }).comparisons;
  text = await cardText();
  ok('two-way card reflects both choices', text.includes('Main effects only') && text.includes('Dunnett vs DrugA') && !text.includes('Interaction (') && text.includes('estimated marginal means'));
  ok('the card shows the marginal-mean differences', expected.length === 2 && expected.every((c) => text.includes(c.a + ' vs ' + c.b)) && Math.abs(expected[0].diff - (model.marginal.col.means[0] - model.marginal.col.means[1])) < 1e-12);
  const twGraph = s.graphs.find((g) => g.resultId === tw.id) || s.graphs[s.graphs.length - 1];
  ok('main-effect comparisons draw no brackets on single bars', (twGraph.spec.opts.sig || []).length === 0);
  // An older main-effects-only analysis that asked for simple effects shows the main effect and says why.
  await load({ tables: [gt], results: [{ id: 'r-add', tableId: gt.id, kind: 'twoway', name: 'Two-way ANOVA', spec: Object.assign({}, legacySpec, { interaction: false }) }], graphs: [], counter: 6, active: { view: 'result', id: 'r-add' } });
  text = await cardText();
  ok('an older no-interaction analysis is answered with the main effect', text.includes('need an interaction term') && text.includes('averaged over Rows') && !text.includes('one family'));

  ok('renderer reports no console errors', pageErrors.length === 0);
  console.log(`\n${pass} ANOVA UI checks passed`);
}).then(() => finish(0)).catch((err) => {
  console.error(err);
  finish(1);
});

function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
