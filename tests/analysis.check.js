// Exercise hypothesis controls, reports, graphs and persistence in the real renderer.
// Run with: npm run test:ui
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const D = require('../js/data.js');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-analysis-'));
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
async function screenshot(name) {
  if (!process.env.STATLAB_SCREENSHOTS) return;
  fs.mkdirSync(process.env.STATLAB_SCREENSHOTS, { recursive: true });
  await run('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(process.env.STATLAB_SCREENSHOTS, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
async function fixture(type, names, rows) {
  const table = new D.DataTable(type);
  table.setColumns(names);
  table.rows = rows.map((row) => row.map((v) => v == null ? '' : String(v)));
  table.ensureRows(rows.length + 2);
  const json = JSON.stringify({ tables: [table], results: [], graphs: [], counter: 1, active: { view: 'data', id: table.id } });
  assert.ok(await run(`window.StatLab.loadStateJSON(${JSON.stringify(json)})`));
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
async function choose(selector, value, event = 'change') {
  await run(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  })()`);
}
async function resultDetails() {
  return run(`(() => {
    const card = document.querySelector('.result-card');
    if (!card) throw new Error('No result card');
    const pRow = Array.from(card.querySelectorAll('tr')).find((row) => row.querySelector('th')?.textContent.startsWith('P value'));
    return { text: card.textContent, hypothesis: card.querySelector('.hypothesis-note')?.textContent,
      report: card.querySelector('.apa')?.textContent, pLabel: pRow?.querySelector('th').textContent,
      p: pRow?.querySelector('td').textContent, significant: !!card.querySelector('.verdict.sig') };
  })()`);
}

const high = [8, 11, 9, 14, 12, 15, 16, 18];
const low = [1, 2, 3, 4, 5, 6, 7, 8];
const pairedRows = high.map((v, i) => [v, low[i]]);
const xyRows = low.map((v, i) => [v, [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1][i]]);
const cases = [
  { name: 'Unpaired t test', kind: 'unpaired-t', names: ['High', 'Low'], rows: pairedRows },
  { name: 'Unpaired t test', kind: 'unpaired-t', names: ['High', 'Low'], rows: pairedRows, student: true },
  { name: 'Paired t test', kind: 'paired-t', names: ['High', 'Low'], rows: pairedRows },
  { name: 'Mann-Whitney U', kind: 'mannwhitney', names: ['High', 'Low'], rows: pairedRows },
  { name: 'Wilcoxon matched-pairs', kind: 'wilcoxon', names: ['High', 'Low'], rows: pairedRows },
  { name: 'One-sample t test', kind: 'onesample-t', names: ['Measurement'], rows: low.map((v) => [v]), mu0: '1' },
  { name: 'Wilcoxon signed-rank', kind: 'wilcoxon', names: ['Measurement'], rows: low.map((v) => [v]), mu0: '1' },
  { name: 'Pearson correlation', kind: 'pearson', type: 'xy', names: ['X', 'Y'], rows: xyRows },
  { name: 'Spearman correlation', kind: 'spearman', type: 'xy', names: ['X', 'Y'], rows: xyRows },
  { name: 'Linear regression', kind: 'regression', type: 'xy', names: ['X', 'Y'], rows: xyRows },
];

app.whenReady().then(async () => {
  win = new BrowserWindow({
    show: false, width: 1320, height: 860,
    webPreferences: {
      contextIsolation: true, spellcheck: false, backgroundThrottling: false,
      preload: path.join(root, 'electron', 'preload.js'),
    },
  });
  const pageErrors = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') pageErrors.push(details.message);
  });
  await win.loadFile(path.join(root, 'index.html'));
  for (const test of cases) {
    await fixture(test.type || 'column', test.names, test.rows);
    const label = test.name + (test.student ? ' (Student)' : test.mu0 ? ' (one sample)' : '');
    let twoSided;
    for (const alternative of ['two-sided', 'greater', 'less']) {
      await openAnalysis(test.name);
      ok(label + ' exposes a hypothesis control', await run(`!!document.querySelector('#analyze-alternative')`));
      ok(label + ' defaults to two-tailed', await run(`document.querySelector('#analyze-alternative').value === 'two-sided'`));
      ok(label + ' offers both one-tailed directions', await run(`Array.from(document.querySelector('#analyze-alternative').options, (o) => o.value).join(',') === 'two-sided,greater,less'`));
      ok(label + ' hypothesis control fits within the modal', await run(`(() => {
        const control = document.querySelector('#analyze-alternative'), rect = control.getBoundingClientRect();
        const modal = document.querySelector('#modal-analyze .modal').getBoundingClientRect();
        return getComputedStyle(control).display !== 'none' && rect.width > 100 && rect.height > 0 && rect.left >= modal.left && rect.right <= modal.right;
      })()`));
      if (test.mu0) await choose('#analyze-opts input[type="number"]', test.mu0, 'input');
      if (test.student) await choose('#analyze-opts select', 'student');
      await choose('#analyze-alternative', alternative);
      if (test === cases[0] && alternative === 'greater') await screenshot('one-tailed-options');
      await run(`document.querySelector('#analyze-go').click()`);
      const saved = await state();
      const result = saved.results[saved.results.length - 1];
      const details = await resultDetails();
      ok(label + ' stores ' + alternative, result.kind === test.kind && result.spec.alternative === alternative);
      ok(label + ' nests the analysis and graph under their source table', await run(`(() => {
        const result = document.querySelector('.nav-item[data-view="result"][data-id="${result.id}"]');
        const graph = document.querySelector('.nav-item[data-view="graph"][data-id="${result.graphId}"]');
        return result.closest('.nav-branch').dataset.tableId === ${JSON.stringify(result.tableId)} &&
          graph.closest('.nav-branch').dataset.tableId === ${JSON.stringify(result.tableId)};
      })()`));
      ok(label + ' labels ' + alternative + ' in result and report', details.pLabel === 'P value (' + (alternative === 'two-sided' ? 'two-tailed' : 'one-tailed, ' + alternative) + ')' && details.hypothesis.includes('H₁:') && details.report.includes(alternative === 'two-sided' ? 'two-tailed' : 'one-tailed, ' + alternative));
      ok(label + ' uses direction-aware significance for ' + alternative, details.significant === (alternative !== 'less'));
      ok(label + ' formats extreme p values without duplicate operators', !details.report.includes('p = >') && !details.report.includes('p = <'));
      if (alternative === 'two-sided') twoSided = details;
      if (alternative !== 'two-sided' && ['onesample-t', 'unpaired-t', 'paired-t', 'pearson', 'spearman', 'regression'].includes(test.kind)) {
        ok(label + ' explicitly retains two-sided CIs', details.text.includes('remain two-sided 95% intervals'));
      }
      if (test.mu0) ok(label + ' records the nonzero reference value', result.spec.mu0 === 1 && details.hypothesis.endsWith(alternative === 'greater' ? '> 1' : alternative === 'less' ? '< 1' : '≠ 1'));
      if (test.kind === 'unpaired-t') ok(label + ' keeps its variance assumption', result.spec.welch === !test.student);
      const json = JSON.stringify(saved);
      assert.ok(await run(`window.StatLab.loadStateJSON(${JSON.stringify(json)})`));
      ok(label + ' preserves hypothesis and result after reopening', (await resultDetails()).text === details.text && (await state()).results.find((r) => r.id === result.id).spec.alternative === alternative);
      if (test === cases[0] && alternative === 'greater') await screenshot('one-tailed-result');
      if (test.mu0 && test.kind === 'wilcoxon' && alternative === 'greater') await screenshot('one-sample-wilcoxon');
    }
    // Project files created before this feature have no alternative field.
    const legacy = await state();
    legacy.results = [legacy.results[0]];
    delete legacy.results[0].spec.alternative;
    legacy.active = { view: 'result', id: legacy.results[0].id };
    assert.ok(await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(legacy))})`));
    ok(label + ' opens legacy analyses as two-tailed', (await resultDetails()).text === twoSided.text);
  }

  // Paired tests must use the named nonempty groups, preserving blank row matches.
  await fixture('column', ['Unused', 'High', 'Low'], pairedRows.map((row, i) => ['', row[0], i === 2 ? '' : row[1]]));
  for (const name of ['Paired t test', 'Wilcoxon matched-pairs']) {
    await openAnalysis(name);
    await choose('#analyze-alternative', 'greater');
    await run(`document.querySelector('#analyze-go').click()`);
    const details = await resultDetails();
    ok(name + ' ignores leading empty columns, not blank paired rows', details.significant && details.hypothesis.includes('(High − Low)') && details.text.includes('n pairs') && await run(`Array.from(document.querySelectorAll('.stats tr')).some((row) => row.querySelector('th').textContent.startsWith('n pairs') && row.querySelector('td').textContent === '7')`));
    const graph = (await state()).graphs.slice(-1)[0];
    ok(name + ' graph uses the same matched columns', graph.spec.opts.colA[0] === '8' && graph.spec.opts.colB[2] === '');
  }
  await fixture('column', ['Unused', 'Measurement'], low.map((v) => ['', v]));
  await openAnalysis('Wilcoxon signed-rank');
  await choose('#analyze-alternative', 'greater');
  await run(`document.querySelector('#analyze-go').click()`);
  ok('one-sample Wilcoxon uses the first nonempty column and a single-group plot', (await resultDetails()).significant && (await state()).graphs[0].spec.chartType === 'dot');

  // Changing data recomputes the stored alternative and the linked graph p value.
  await fixture('column', ['High', 'Low'], pairedRows);
  await openAnalysis('Unpaired t test');
  await run(`document.querySelector('#analyze-go').click();
    document.querySelector('.nav-group[data-view="result"] .nav-group-toggle').click();
    document.querySelector('.nav-group[data-view="graph"] .nav-group-toggle').click();
    document.querySelector('.nav-toggle').click()`);
  await openAnalysis('Unpaired t test');
  ok('opening data for a directional analysis leaves collapsed folders alone', await run(`document.querySelector('.nav-toggle').getAttribute('aria-expanded') === 'false'`));
  await choose('#analyze-alternative', 'greater');
  await run(`document.querySelector('#analyze-go').click()`);
  const before = await state();
  const directional = before.results.at(-1);
  const sourceGraph = before.graphs.find((graph) => graph.id === directional.graphId);
  ok('new one-tailed result reveals its table and Results folder but preserves the Graphs fold', await run(`document.querySelector('.nav-toggle').getAttribute('aria-expanded') === 'true' && document.querySelector('.nav-group[data-view="result"] .nav-group-toggle').getAttribute('aria-expanded') === 'true' && document.querySelector('.nav-group[data-view="graph"] .nav-group-toggle').getAttribute('aria-expanded') === 'false' && document.querySelector('.nav-item[data-view="result"][data-id="${directional.id}"]').checkVisibility()`));
  await screenshot('nested-one-tailed-result');
  await run(`document.querySelector('#nav-tables .nav-item[data-view="data"]').click();
    const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(pairedRows.map((row) => row.slice().reverse().join('\t')).join('\n'))});
    document.querySelector('.sheet-wrap').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    document.querySelector('.nav-item[data-view="result"][data-id="${directional.id}"]').click()`);
  const after = await state();
  const updatedGraph = after.graphs.find((graph) => graph.id === directional.graphId);
  ok('data edits retain the chosen alternative', after.results.find((result) => result.id === directional.id).spec.alternative === 'greater');
  ok('data edits recompute directional results and graph significance', !(await resultDetails()).significant && sourceGraph.spec.opts.sig[0].p < 0.05 && updatedGraph.spec.opts.sig[0].p > 0.95 && !updatedGraph.spec.opts.sig[0].sig);
  ok('directional recomputation preserves collapsed folders and the separate two-tailed analysis', after.navigator.collapsed.includes('graph:' + directional.tableId) && after.results[0].spec.alternative === 'two-sided' && after.graphs[0].spec.opts.sig[0].p < 0.05);
  ok('opposite-direction reports correctly show p > 0.9999', (await resultDetails()).report.includes('p > 0.9999'));

  await run(`new Promise((resolve, reject) => {
    const expected = window.StatLab.getStateJSON(), deadline = Date.now() + 3000;
    function check() {
      const stored = localStorage.getItem('statlab_state');
      if (stored && JSON.stringify(JSON.parse(stored)) === JSON.stringify(JSON.parse(expected))) return resolve();
      if (Date.now() > deadline) return reject(new Error('Directional analysis was not autosaved'));
      setTimeout(check, 25);
    }
    check();
  })`);
  ok('one-tailed analysis and linked graph reach autosave', true);
  const expectedReload = await state();
  const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.reload();
  await reloaded;
  ok('renderer reload offers to restore the saved analysis', await run(`!document.querySelector('#modal-restore').hidden`));
  await run(`document.querySelector('#restore-yes').click()`);
  ok('actual reload and restore preserve directional results and graphs', JSON.stringify(await state()) === JSON.stringify(expectedReload) && !(await resultDetails()).significant);

  await fixture('column', ['High <treated> & "A"', 'Low'], pairedRows);
  await openAnalysis('Unpaired t test');
  await choose('#analyze-alternative', 'greater');
  await run(`document.querySelector('#analyze-go').click()`);
  ok('hypothesis group names render as text, not markup', (await resultDetails()).hypothesis.includes('High <treated> & "A"') && await run(`!document.querySelector('.result-card treated') && document.querySelector('.verdict').textContent.includes('<treated>')`));

  await fixture('column', ['A', 'B', 'C'], low.map((v) => [v, v + 1, v + 2]));
  for (const name of ['One-way ANOVA', 'Kruskal-Wallis', 'Normality tests', "Grubbs' outlier test", 'Descriptive statistics']) {
    await openAnalysis(name);
    ok(name + ' does not offer inapplicable directional options', await run(`!document.querySelector('#analyze-alternative')`));
  }
  ok('renderer reports no console errors', pageErrors.length === 0);
  console.log(`\n${pass} analysis UI checks passed`);
}).then(() => finish(0)).catch((err) => {
  console.error(err);
  finish(1);
});

function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
