// Run the actual renderer with an isolated autosave/profile. No user project or clipboard is used.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const T = require('../js/stats-tests.js');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-variance-ui-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);
let win, pass = 0;
const run = (code) => win.webContents.executeJavaScript(code, true);
const state = async () => JSON.parse(await run('window.StatLab.getStateJSON()'));
function ok(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}
function near(actual, expected) { return Math.abs(actual - expected) <= 1e-10 * (1 + Math.abs(expected)); }
async function click(selector, index = 0) {
  const point = await run(`(() => {
    const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!element) throw new Error('Missing element: ' + ${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function openAnalyze() {
  await run(`Array.from(document.querySelectorAll('.view-actions button')).find((b) => b.textContent.includes('Analyze')).click()`);
}
async function choose(value) {
  await run(`(() => {
    const select = document.querySelector('#unpaired-variance');
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}
async function pasteGroups(groups) {
  await click('td.dcell[data-r="0"][data-c="0"]');
  const rows = Array.from({ length: Math.max(10, ...groups.map((g) => g.length)) }, (_, i) => groups.map((g) => g[i] == null ? '' : g[i]).join('\t'));
  await run(`(() => {
    const transfer = new DataTransfer(); transfer.setData('text/plain', ${JSON.stringify(rows.join('\n'))});
    document.querySelector('.sheet-wrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  })()`);
}
async function importGroups(names, groups, name) {
  const rows = Array.from({ length: Math.max(...groups.map((g) => g.length)) }, (_, i) => groups.map((g) => g[i] == null ? '' : g[i]).join('\t'));
  await run(`window.StatLab.importText(${JSON.stringify([names.join('\t'), ...rows].join('\n'))}, 'column')`);
  if (name) await run(`(() => {
    const input = document.querySelector('.view-title input');
    input.value = ${JSON.stringify(name)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  return (await state()).active.id;
}
async function guideToVarianceQuestion() {
  await click('#btn-guide');
  for (const index of [0, 1, 0, 0]) await click('#guide-body .guide-opt', index);
}
async function waitForAutosave() {
  await run(`new Promise((resolve, reject) => {
    const expected = window.StatLab.getStateJSON();
    const deadline = Date.now() + 4000;
    function check() {
      const stored = localStorage.getItem('statlab_state');
      if (stored && JSON.stringify(JSON.parse(stored)) === JSON.stringify(JSON.parse(expected))) return resolve();
      if (Date.now() > deadline) return reject(new Error('Variance result was not autosaved'));
      setTimeout(check, 25);
    }
    check();
  })`);
}

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1320, height: 860,
    webPreferences: { contextIsolation: true, spellcheck: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(root, 'index.html'));
  win.webContents.debugger.attach('1.3');
  const a = [9, 10, 11, 10, 9, 11, 10, 10, 9, 11];
  const b = [1, 5, 9, 13, 17, 21, 25, 29, 33, 37];
  const tableId = await importGroups(['Control', 'Treated'], [a, b], 'Spread experiment');
  await openAnalyze();
  ok('variance diagnostic is offered for independent Column groups', await run(`!!document.querySelector('.test-opt[data-kind="variance"]')`));
  ok('new unpaired analyses still default to Welch, even before a variance result', await run(`document.querySelector('#unpaired-variance').value === 'welch'`));
  ok('t-test selector has a programmatic label', await run(`document.querySelector('label[for="unpaired-variance"]').textContent === 'Unpaired t test'`));
  ok('unequal-spread diagnostic is visible without running a second analysis', await run(`document.querySelector('#analyze-opts .variance-check').dataset.status === 'unequal'`));
  ok('diagnostic shows sample sizes, SD and sample variances for both groups', await run(`document.querySelectorAll('.variance-summary tbody tr').length === 2 && document.querySelector('.variance-summary').textContent.includes('Sample variance')`));
  ok('inline diagnostic has the independently checked engine p-value', near(+await run(`document.querySelector('.variance-check').dataset.p`), T.brownForsythe([a, b]).p));
  ok('cited guidance includes the original paper, correction, method and NIST', await run(`document.querySelectorAll('.variance-references a').length === 4 && document.querySelector('.variance-references a[href="https://doi.org/10.5334/irsp.661"]') !== null`));
  ok('guidance warns against p-value-based test selection and nonnormality overclaims', await run(`document.querySelector('.variance-references').textContent.includes('p-value alone') && document.querySelector('.variance-references').textContent.includes('severe skew')`));
  await choose('student');
  ok('selecting Student shows a warning but does not override the choice', await run(`!document.querySelector('.variance-choice').hidden && document.querySelector('.variance-choice').textContent.includes('evidence of unequal variances') && document.querySelector('#unpaired-variance').value === 'student'`));
  await choose('welch');
  ok('returning to Welch hides only the Student warning', await run(`document.querySelector('.variance-choice').hidden && document.querySelector('.variance-check').dataset.status === 'unequal'`));
  await click('#analyze-go');
  let saved = await state();
  const welch = T.unpairedT(a, b, true);
  ok('Welch choice reaches the saved analysis spec', saved.results[0].spec.welch === true);
  ok('Welch result identifies the selected test and a separately labeled variance diagnostic', await run(`document.querySelector('.result-card h3').textContent.includes("Welch's") && document.querySelector('.result-card').textContent.includes('P value (means, two-tailed)') && document.querySelector('.variance-stat').textContent.includes('variance-test p')`));
  ok('linked graph keeps the mean-comparison p-value, not the variance p-value', near(saved.graphs[0].spec.opts.sig[0].p, welch.p) && !near(welch.p, T.brownForsythe([a, b]).p));
  ok('results include a copyable variance-test report with the F approximation stated', await run(`document.querySelector('.variance-check .apa').textContent.includes('median-centered Levene') && document.querySelector('.variance-check .apa').textContent.includes('approximate F reference')`));

  await click('#nav-tables .nav-item');
  await openAnalyze();
  await choose('student');
  await click('#analyze-go');
  saved = await state();
  const student = T.unpairedT(a, b, false);
  ok('explicit Student selection is saved and its pooled calculation actually runs', saved.results[1].spec.welch === false && near(saved.graphs[1].spec.opts.sig[0].p, student.p) && !near(student.p, welch.p));
  ok('Student results retain the caution rather than silently switching to Welch', await run(`document.querySelector('.result-card h3').textContent.includes('Student') && !document.querySelector('.variance-choice').hidden`));
  await click('#nav-tables .nav-item');
  await openAnalyze();
  await click('.test-opt[data-kind="variance"]');
  await click('#analyze-go');
  saved = await state();
  ok('standalone variance analysis creates a saved result but no graph', saved.results.length === 3 && saved.graphs.length === 2 && saved.results[2].kind === 'variance' && !saved.results[2].graphId);
  await run(`void Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copiedResult = text; } } })`);
  await click('.view-actions .btn');
  ok('Copy exports the actual variance report without touching the OS clipboard', await run(`window.__copiedResult.includes('Brown–Forsythe') && window.__copiedResult.includes('W(') && window.__copiedResult.includes('population spreads')`));

  await waitForAutosave();
  const snapshot = await state();
  await win.webContents.reload();
  await run(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 4000;
    function check() {
      const modal = document.querySelector('#modal-restore');
      if (modal && !modal.hidden) return resolve();
      if (Date.now() > deadline) return reject(new Error('Restore prompt not shown'));
      setTimeout(check, 25);
    }
    check();
  })`);
  await click('#restore-yes');
  ok('autosave Restore preserves both choices and the standalone diagnostic', JSON.stringify(await state()) === JSON.stringify(snapshot));
  ok('restored variance result is recomputed, not an empty or stale HTML block', await run(`document.querySelector('.variance-check').dataset.status === 'unequal' && !!document.querySelector('.variance-check .apa')`));
  const project = path.join(temp, 'variance.statlab.json');
  fs.writeFileSync(project, JSON.stringify(snapshot));
  await run(`window.StatLab.loadStateJSON('{"tables":[],"results":[],"graphs":[]}')`);
  ok('project-file round trip reopens successfully', await run(`window.StatLab.loadStateJSON(${JSON.stringify(fs.readFileSync(project, 'utf8'))})`));
  ok('project round trip preserves diagnostic, t-test choices and graph links exactly', JSON.stringify(await state()) === JSON.stringify(snapshot));
  const legacy = JSON.parse(JSON.stringify(snapshot));
  delete legacy.results[1].spec.welch;
  legacy.active = { view: 'result', id: legacy.results[1].id };
  await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(legacy))})`);
  ok('legacy missing-welch specs retain the historical Student calculation', await run(`document.querySelector('.result-card h3').textContent.includes('Student') && !document.querySelector('.variance-choice').hidden`));
  await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(snapshot))})`);

  // Use the actual spreadsheet paste event so linked-result refresh is exercised.
  const editedA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const editedB = editedA.map((v) => v + 50);
  await click('#nav-tables .nav-item');
  await click('td.dcell[data-r="0"][data-c="0"]');
  const pasted = editedA.map((v, i) => `${v}\t${editedB[i]}`).join('\n');
  await run(`(() => {
    const transfer = new DataTransfer(); transfer.setData('text/plain', ${JSON.stringify(pasted)});
    document.querySelector('.sheet-wrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  })()`);
  saved = await state();
  const statuses = await run(`window.StatLabApp.results.map((r) => r.html.querySelector('.variance-check').dataset.status)`);
  ok('source edits recompute all inline and standalone variance diagnostics', statuses.every((status) => status === 'inconclusive'));
  ok('source edits never switch either stored t-test choice', saved.results[0].spec.welch === true && saved.results[1].spec.welch === false);
  ok('source edits refresh linked graphs using each chosen mean test', near(saved.graphs[0].spec.opts.sig[0].p, T.unpairedT(editedA, editedB, true).p) && near(saved.graphs[1].spec.opts.sig[0].p, T.unpairedT(editedA, editedB, false).p));
  await click('#nav-results .nav-item', 2);
  ok('nonsignificance is not displayed as proof of equal variances', await run(`document.querySelector('.variance-status').textContent.includes('does not establish equal variances') && !document.querySelector('.variance-status.pass')`));
  ok('p = 1 uses an inequality, never the malformed equals-inequality notation', await run(`document.querySelector('.variance-stat').textContent.includes('p > 0.9999') && !document.querySelector('.variance-check').textContent.includes('= >')`));

  const validProject = await state();
  for (const fixture of [
    { name: 'too few observations', groups: [[1], editedB] },
    { name: 'a removed group', groups: [editedA, []] },
    { name: 'a third group', groups: [editedA, editedB, editedA] },
    { name: 'an infinite observation', groups: [['Infinity', ...editedA.slice(1)], editedB] },
    { name: 'different constants', groups: [Array(10).fill(4), Array(10).fill(8)] },
    { name: 'identical constants', groups: [Array(10).fill(4), Array(10).fill(4)] },
  ]) {
    await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(validProject))})`);
    await click('#nav-tables .nav-item');
    await pasteGroups(fixture.groups);
    let invalidState = await state();
    ok(fixture.name + ' invalidates linked mean-test p-values', invalidState.graphs.every((g) => g.spec.unavailable && g.spec.opts.sig.length === 0));
    ok(fixture.name + ' cannot produce a nonsignificant mean-test verdict', await run(`window.StatLabApp.results.filter((r) => r.kind === 'unpaired-t').every((r) => r.html.textContent.includes('unavailable') && !r.html.querySelector('.verdict.ns, .verdict.sig'))`));
    await click('#nav-graphs .nav-item');
    ok(fixture.name + ' hides the stale graph and disables both export paths', await run(`!!document.querySelector('.graph-unavailable') && !document.querySelector('.graph-canvas') && !window.StatLab.hasActiveGraph() && window.StatLab.activeGraphSVG() === null && Array.from(document.querySelectorAll('.view-actions button')).filter((b) => /SVG|PNG/.test(b.textContent)).every((b) => b.disabled)`));
    invalidState = await state();
    await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(invalidState))})`);
    ok(fixture.name + ' remains honestly unavailable after project reopening', await run(`!!document.querySelector('.graph-unavailable') && window.StatLab.activeGraphSVG() === null`) && (await state()).graphs.every((g) => g.spec.unavailable && g.spec.opts.sig.length === 0));
    // Older files may contain stale graph specs without an invalidation marker.
    const legacyInvalid = JSON.parse(JSON.stringify(invalidState));
    legacyInvalid.graphs.forEach((g, i) => { g.spec = validProject.graphs[i].spec; });
    await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(legacyInvalid))})`);
    ok(fixture.name + ' is also invalidated when reopening a legacy stale graph', (await state()).graphs.every((g) => g.spec.unavailable && g.spec.opts.sig.length === 0));
    await click('#nav-tables .nav-item');
    const recovered = fixture.groups.length === 3 ? [editedA, editedB, []] : [editedA, editedB];
    await pasteGroups(recovered);
    const recoveredState = await state();
    ok(fixture.name + ' recovers fresh inference when valid data return', recoveredState.graphs.every((g) => !g.spec.unavailable && g.spec.opts.sig.length === 1) && recoveredState.results[0].spec.welch === true && recoveredState.results[1].spec.welch === false && near(recoveredState.graphs[0].spec.opts.sig[0].p, T.unpairedT(editedA, editedB, true).p));
  }
  await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(validProject))})`);

  // Active-table guidance must not accidentally use the earlier experiment.
  const targetId = await importGroups(['First', 'Second'], [[1, 2, 3, 4, 5], [5, 6, 7, 8, 9]], 'Guide target');
  await guideToVarianceQuestion();
  ok('decision tree recommends Welch first and rejects the variance-pretest rule', await run(`document.querySelector('#guide-body .g-main').textContent.includes('Welch') && document.querySelector('#guide-body').textContent.includes('not use a nonsignificant variance test')`));
  ok('variance-check shortcut targets the active dataset', await run(`document.querySelector('#guide-body button').textContent.includes('Guide target')`));
  await click('#guide-body button');
  ok('guide opens the standalone diagnostic without creating or changing a mean test', await run(`!document.querySelector('#modal-analyze').hidden && document.querySelector('.test-opt.selected').dataset.kind === 'variance'`) && (await state()).results.length === 3);
  await run(`document.querySelector('#modal-analyze .modal-x').click()`);
  await guideToVarianceQuestion();
  await click('#guide-body .guide-opt');
  await click('#guide-body .btn-accent');
  saved = await state();
  ok('guided Welch recommendation runs on the active two-group table', saved.results[3].tableId === targetId && saved.results[3].spec.welch === true);
  await guideToVarianceQuestion();
  await click('#guide-body .guide-opt', 1);
  await click('#guide-body .btn-accent');
  saved = await state();
  ok('independently justified Student branch remains available and explicit', saved.results[4].tableId === targetId && saved.results[4].spec.welch === false);

  await importGroups(['One', 'Two', 'Three'], [[1, 2, 3, 4], [2, 5, 8, 11], [1, 2, 5, 9]], 'Three groups');
  await openAnalyze();
  ok('variance test supports 3+ groups without offering a two-group t test', await run(`!!document.querySelector('.test-opt[data-kind="variance"]') && !document.querySelector('.test-opt[data-kind="unpaired-t"]')`));
  await click('.test-opt[data-kind="variance"]');
  ok('multi-group diagnostic is labeled omnibus, not a pairwise t-test decision', await run(`document.querySelector('.variance-advice').textContent.includes('omnibus') && document.querySelectorAll('.variance-summary tbody tr').length === 3`));
  await click('#analyze-go');
  ok('multi-group diagnostic stores the right analysis kind and source', (await state()).results[5].kind === 'variance');

  for (const fixture of [
    { name: 'Too small', groups: [[1], [2, 3, 4]] },
    { name: 'Constants', groups: [[4, 4, 4], [8, 8, 8]] },
    { name: 'Identical constants', groups: [[4, 4, 4], [4, 4, 4]] },
    { name: 'Two-point degeneracy', groups: [[1, 2], [4, 6]] },
    { name: 'Nonfinite', groups: [['Infinity', 2, 3], [4, 5, 6]] },
  ]) {
    await importGroups(['A', 'B'], fixture.groups, fixture.name);
    await openAnalyze();
    await click('.test-opt[data-kind="variance"]');
    ok(fixture.name + ' is unavailable, not falsely significant or equal', await run(`document.querySelector('.variance-check').dataset.status === 'unavailable' && !document.querySelector('.variance-stat') && !document.querySelector('.variance-status.pass')`));
    await click('#analyze-go');
    ok(fixture.name + ' saves an honest unavailable result without a numeric p-value', await run(`document.querySelector('.variance-status').textContent.includes('unavailable') && !document.querySelector('.variance-check .apa')`));
    for (const choice of ['welch', 'student']) {
      await click('#nav-tables .nav-item', (await state()).tables.length - 1);
      await openAnalyze();
      await choose(choice);
      const before = await state();
      await click('#analyze-go');
      const after = await state();
      if (fixture.name === 'Two-point degeneracy') {
        ok(choice + ' still runs when only the variance diagnostic is undefined', after.results.length === before.results.length + 1 && after.graphs.length === before.graphs.length + 1 && await run(`!!document.querySelector('.verdict') && !document.querySelector('.unpaired-unavailable')`));
      } else {
        ok(fixture.name + ' ' + choice + ' mean test is unavailable, not ns', after.results.length === before.results.length + 1 && after.graphs.length === before.graphs.length && await run(`!!document.querySelector('.unpaired-unavailable') && !document.querySelector('.verdict.ns, .verdict.sig') && !!document.querySelector('.variance-check')`));
      }
    }
  }

  const label = 'Control <em>not markup</em> & X';
  await importGroups(['Control', 'Treated'], [a, b], 'Escaped labels');
  await run(`(() => { const input = document.querySelector('input.colname'); input.value = ${JSON.stringify(label)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await openAnalyze();
  ok('inline variance summary renders arbitrary group labels as text', await run(`document.querySelector('.variance-summary').textContent.includes(${JSON.stringify(label)}) && !document.querySelector('.variance-summary em')`));
  await click('#analyze-go');
  ok('result verdict and variance summary both preserve labels without markup', await run(`document.querySelector('.verdict').textContent.includes(${JSON.stringify(label)}) && !document.querySelector('.result-card em')`));

  win.setContentSize(900, 600);
  await click('#nav-tables .nav-item', (await state()).tables.length - 1);
  await openAnalyze();
  ok('new controls fit the minimum supported window width', await run(`(() => {
    const modal = document.querySelector('#modal-analyze .modal');
    const panel = document.querySelector('.variance-check');
    return modal.getBoundingClientRect().right <= innerWidth && panel.scrollWidth === panel.clientWidth && document.querySelector('#analyze-body').scrollWidth === document.querySelector('#analyze-body').clientWidth;
  })()`));
  await click('#analyze-opts .variance-references summary');
  ok('published guidance expands through the actual disclosure control', await run(`document.querySelector('#analyze-opts .variance-references').open`));
  ok('reference links are safe new-tab web links', await run(`Array.from(document.querySelectorAll('#analyze-opts .variance-references a')).every((a) => a.protocol === 'https:' && a.target === '_blank' && a.rel.includes('noopener'))`));
  ok('Run analysis remains visible outside the scrollable modal body', await run(`(() => { const rect = document.querySelector('#analyze-go').getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; })()`));
  ok('all exercised renderer paths report no console errors', errors.length === 0);
  console.log(`\n${pass} variance renderer checks passed`);
}).then(() => finish(0)).catch((error) => { console.error(error); finish(1); });
function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
