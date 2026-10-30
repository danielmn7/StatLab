// Re-running an analysis or graph reuses it; Duplicate makes an independent copy.
// Runs the real renderer with an isolated profile. Run with: npm run test:ui
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const D = require('../js/data.js');
const T = require('../js/stats-tests.js');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-reuse-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);

const CHAR_MAP = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\0': '\\0',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
};

function escapeUnsafeChars(str) {
  return str.replace(/[<>\/\\\b\f\n\r\t\0\u2028\u2029]/g, (x) => CHAR_MAP[x]);
}

function jsLiteral(value) {
  return escapeUnsafeChars(JSON.stringify(value));
}

let win, pass = 0;
const run = (code) => win.webContents.executeJavaScript(code, true);
const state = async () => JSON.parse(await run('window.StatLab.getStateJSON()'));
const item = (view, id) => `.nav-item[data-view="${view}"][data-id="${id}"]`;
const JS_EMBED_CHAR_MAP = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\0': '\\0',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
};
function toSafeJSLiteral(value) {
  return JSON.stringify(value).replace(/[<>\/\\\b\f\n\r\t\0\u2028\u2029]/g, (ch) => JS_EMBED_CHAR_MAP[ch]);
}
function ok(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}
function near(actual, expected) { return Math.abs(actual - expected) <= 1e-10 * (1 + Math.abs(expected)); }
const jsCharMap = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\0': '\\0',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
};
function escapeUnsafeChars(str) {
  return str.replace(/[<>\/\\\b\f\n\r\t\0\u2028\u2029]/g, (ch) => jsCharMap[ch]);
}
async function click(selector, index = 0, button = 'left') {
  const point = await run(`(() => {
    const target = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!target || !target.checkVisibility()) throw new Error('Not visible: ' + ${JSON.stringify(selector)});
    target.scrollIntoView({ block: 'nearest' });
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button, clickCount: 1, ...point });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button, clickCount: 1, ...point });
}
// Click a header button by its visible label.
async function action(label) {
  const index = await run(`Array.from(document.querySelectorAll('.view-actions button')).findIndex((b) => b.textContent.includes(${toSafeJSLiteral(label)}))`);
  if (index < 0) throw new Error('No action button: ' + label);
  await click('.view-actions button', index);
}
async function contextAction(selector, label) {
  await click(selector, 0, 'right');
  const index = await run(`Array.from(document.querySelectorAll('#ctx-menu .ctx-item')).findIndex((entry) => entry.textContent === ${JSON.stringify(label)})`);
  if (index < 0) throw new Error('No context-menu entry: ' + label);
  await click('#ctx-menu .ctx-item', index);
}
async function choose(selector, value) {
  await run(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}
const notice = () => run(`(() => {
  const box = document.querySelector('#analyze-existing');
  return { shown: !!box && !box.hidden && box.checkVisibility(), text: box ? box.textContent : '', button: document.querySelector('#analyze-go').textContent };
})()`);
async function openAnalyze(tableId, testName) {
  await click(item('data', tableId));
  await action('Analyze');
  if (testName) {
    const safeTestName = escapeUnsafeChars(JSON.stringify(testName));
    const index = await run(`Array.from(document.querySelectorAll('.test-opt')).findIndex((c) => c.querySelector('.t-name').textContent.startsWith(${safeTestName}))`);
    await click('.test-opt', index);
  }
}
async function load(project) {
  assert.ok(await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(project))})`), 'Project loads');
}
async function paste(rows) {
  await click('td.dcell[data-r="0"][data-c="0"]');
  await run(`(() => {
    const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(rows.map((r) => r.join('\t')).join('\n'))});
    document.querySelector('.sheet-wrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  })()`);
}

const a = [12, 15, 14, 18, 16, 17], b = [7, 9, 8, 10, 6, 9];
function fixture() {
  const table = new D.DataTable('column');
  table.name = 'Enzyme assay';
  table.setColumns(['Control', 'Treated']);
  table.rows = a.map((v, i) => [String(v), String(b[i])]);
  table.ensureRows(8);
  return { tables: [table], results: [], graphs: [], counter: 1, active: { view: 'data', id: table.id } };
}

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1320, height: 860,
    webPreferences: { contextIsolation: true, spellcheck: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(root, 'index.html'));
  win.webContents.debugger.attach('1.3');
  const project = fixture(), tableId = project.tables[0].id;
  await load(project);

  // ---------- Analyze: identical runs reuse the analysis ----------
  await openAnalyze(tableId, 'Unpaired t test');
  ok('a first run has no reuse notice and keeps the Run analysis label', (await notice()).shown === false && (await notice()).button === 'Run analysis');
  await click('#analyze-go');
  const first = await state();
  const welch = first.results[0];
  ok('the first run creates one result and one linked graph', first.results.length === 1 && first.graphs.length === 1 && welch.graphId === first.graphs[0].id);
  ok('the analysis graph is named after its analysis; the figure title is still the table name',
    first.graphs[0].name === welch.name && welch.name.startsWith('t test') && first.graphs[0].spec.opts.title === 'Enzyme assay');

  await openAnalyze(tableId, 'Unpaired t test');
  let n = await notice();
  ok('the Analyze dialog says the same analysis already exists and names it', n.shown && n.text.includes(welch.name) && n.text.includes('instead of adding a duplicate') && n.button === 'Open existing result');
  await choose('#analyze-alternative', 'greater');
  ok('changing an option to a new analysis clears the notice', (await notice()).shown === false && (await notice()).button === 'Run analysis');
  await choose('#analyze-alternative', 'two-sided');
  ok('changing it back shows the notice again', (await notice()).shown);
  await click('#analyze-go');
  let s = await state();
  ok('re-running an unchanged analysis creates no result or graph', s.results.length === 1 && s.graphs.length === 1);
  ok('re-running opens the existing result', s.active.view === 'result' && s.active.id === welch.id && await run(`document.querySelector('.view-title').textContent === ${JSON.stringify(welch.name)}`));
  ok('a toast explains that no duplicate was made', await run(`document.querySelector('#toast').textContent.includes('no duplicate')`));

  // Data edits keep the reused analysis current (it is not a stale copy).
  const editedB = [11, 13, 12, 14, 10, 13];
  await click(item('data', tableId));
  await paste(a.map((v, i) => [v, editedB[i]]));
  await openAnalyze(tableId, 'Unpaired t test');
  await click('#analyze-go');
  s = await state();
  ok('a reused analysis reflects edited data', s.results.length === 1 && near(s.graphs[0].spec.opts.sig[0].p, T.unpairedT(a, editedB, true).p));

  // The guide's sparse Welch spec (no alternative) is the same analysis as the dialog's.
  await click('#btn-guide');
  for (const index of [0, 1, 0, 0]) await click('#guide-body .guide-opt', index);
  await click('#guide-body .guide-opt', 0);
  await click('#guide-body .btn-accent');
  s = await state();
  ok('the guide reopens an equivalent analysis instead of duplicating it', s.results.length === 1 && s.active.id === welch.id);

  // ---------- Different options are a different, distinguishable analysis ----------
  await openAnalyze(tableId, 'Unpaired t test');
  await choose('#unpaired-variance', 'student');
  ok('Student’s is a different analysis, so no notice is shown', (await notice()).shown === false);
  await click('#analyze-go');
  await openAnalyze(tableId, 'Unpaired t test');
  await choose('#analyze-alternative', 'greater');
  await click('#analyze-go');
  s = await state();
  const names = s.results.map((r) => r.name);
  ok('each changed option adds one analysis', s.results.length === 3 && s.graphs.length === 3);
  ok('same-test variants get names that tell them apart', new Set(names).size === 3 && names[1].includes('Student’s') && names[2].includes('one-tailed, greater'));
  ok('their graphs share the distinguishing names', s.results.every((r) => s.graphs.find((g) => g.id === r.graphId).name === r.name));
  const variantVisible = (view, id) => run(`(() => {
    const label = document.querySelector(${JSON.stringify(item(view, id) + ' .nav-label')});
    const main = label.querySelector('.nav-label-main'), variant = label.querySelector('.nav-label-variant');
    return { text: label.textContent, mainCut: main.scrollWidth > main.clientWidth, shown: variant.checkVisibility(),
      fits: variant.scrollWidth <= variant.clientWidth && variant.scrollHeight <= variant.clientHeight, line: variant.textContent };
  })()`);
  let v = await variantVisible('result', s.results[1].id);
  ok('the sidebar keeps a variant’s options visible even when its title is cut off', v.text === names[1] && v.mainCut && v.shown && v.fits && v.line === ' · Student’s, two-tailed');
  v = await variantVisible('graph', s.results[2].graphId);
  ok('graph entries show their options the same way', v.shown && v.fits && v.line.includes('one-tailed, greater'));

  // ---------- A deliberate separate copy ----------
  await openAnalyze(tableId, 'Unpaired t test');
  await click('#analyze-separate');
  ok('ticking "Make a separate copy" relabels the button', (await notice()).button === 'Run as separate copy');
  await click('#analyze-go');
  s = await state();
  const copyResult = s.results.at(-1);
  ok('a separate copy adds a result and its own graph', s.results.length === 4 && s.graphs.length === 4 && copyResult.name === welch.name + ' (copy)' && copyResult.graphId && copyResult.graphId !== welch.graphId);
  ok('the sidebar never truncates the “(copy)” suffix', await run(`(() => {
    const label = document.querySelector(${JSON.stringify(item('result', copyResult.id) + ' .nav-label')});
    const suffix = label.querySelector('.nav-label-suffix'), main = label.querySelector('.nav-label-main');
    return label.textContent === ${JSON.stringify(copyResult.name)} && suffix.textContent === ' (copy)' && main.scrollWidth > main.clientWidth &&
      suffix.scrollWidth <= suffix.clientWidth && suffix.getBoundingClientRect().right <= label.getBoundingClientRect().right + 0.5;
  })()`));
  await openAnalyze(tableId, 'Unpaired t test');
  ok('the copy choice resets for the next run', (await notice()).button === 'Open existing result' && await run(`!document.querySelector('#analyze-separate').checked`));
  await run(`document.querySelector('#modal-analyze .modal-x').click()`);

  // ---------- A deleted analysis graph is recreated, not the whole analysis ----------
  await contextAction(item('graph', welch.graphId), '🗑 Delete graph');
  await openAnalyze(tableId, 'Unpaired t test');
  await click('#analyze-go');
  s = await state();
  const rebuilt = s.results.find((r) => r.id === welch.id);
  ok('re-running restores a deleted graph without a second result', s.results.length === 4 && s.graphs.length === 4 && rebuilt.graphId && s.graphs.some((g) => g.id === rebuilt.graphId && g.resultId === welch.id));

  // ---------- ◧ Graph reuses the table's quick graph ----------
  await click(item('data', tableId));
  await action('Graph');
  await click(item('data', tableId));
  await action('Graph');
  s = await state();
  const quick = s.graphs.filter((g) => !g.resultId);
  ok('repeated ◧ Graph clicks keep one quick graph named after the table', quick.length === 1 && quick[0].name === 'Enzyme assay' && s.graphs.length === 5);

  // ---------- Duplicate an analysis graph ----------
  const original = s.graphs.find((g) => g.id === rebuilt.graphId);
  await click(item('graph', original.id));
  await action('Duplicate');
  s = await state();
  const copy = s.graphs.find((g) => g.id === s.active.id);
  ok('Duplicate opens a new graph', s.graphs.length === 6 && s.active.view === 'graph' && copy && copy.id !== original.id);
  // "(copy)" is already the separate analysis copy's graph, so this one is numbered.
  ok('the copy gets an unused copy name and is listed right below the original', copy.name === original.name + ' (copy 2)' &&
    s.graphs.findIndex((g) => g.id === copy.id) === s.graphs.findIndex((g) => g.id === original.id) + 1 &&
    await run(`(() => { const items = Array.from(document.querySelectorAll('.nav-graphs .nav-item')).map((x) => x.dataset.id); return items.indexOf(${jsLiteral(copy.id)}) === items.indexOf(${jsLiteral(original.id)}) + 1; })()`));
  // Opening a graph fills in its display defaults, so compare with the original as it is now.
  ok('the copy stays linked to the same analysis and table with the same figure', copy.resultId === welch.id && copy.tableId === tableId && JSON.stringify(copy.spec) === JSON.stringify(s.graphs.find((g) => g.id === original.id).spec));
  ok('the analysis still points at its original graph', s.results.find((r) => r.id === welch.id).graphId === original.id);

  // Tinker with the copy: title and comparison display.
  await run(`(() => {
    const input = Array.from(document.querySelectorAll('.ctrl-group')).find((g) => g.querySelector('label')?.textContent === 'Title').querySelector('input');
    input.value = 'Copy for the poster'; input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click('.sig-item input');
  s = await state();
  let o = s.graphs.find((g) => g.id === original.id), c = s.graphs.find((g) => g.id === copy.id);
  ok('editing the copy leaves the original untouched', c.spec.opts.title === 'Copy for the poster' && c.spec.opts.sig[0].on === false && o.spec.opts.title === 'Enzyme assay' && o.spec.opts.sig[0].on !== false);

  // Data edits refresh both, each keeping its own settings; nested state is not shared.
  const editedA = [20, 22, 21, 25, 23, 24];
  await click(item('data', tableId));
  await paste(editedA.map((v, i) => [v, editedB[i]]));
  s = await state();
  o = s.graphs.find((g) => g.id === original.id); c = s.graphs.find((g) => g.id === copy.id);
  const expected = T.unpairedT(editedA, editedB, true).p;
  ok('a data edit recomputes the original and the copy', near(o.spec.opts.sig[0].p, expected) && near(c.spec.opts.sig[0].p, expected));
  ok('each graph keeps its own title after the edit', c.spec.opts.title === 'Copy for the poster' && o.spec.opts.title === 'Enzyme assay');
  await click(item('graph', copy.id));
  await click('.sig-item input');
  s = await state();
  o = s.graphs.find((g) => g.id === original.id); c = s.graphs.find((g) => g.id === copy.id);
  ok('after a refresh, toggling a comparison on the copy still leaves the original alone', c.spec.opts.sig[0].on !== o.spec.opts.sig[0].on);

  // The quick graph is never taken over by a duplicate of an analysis graph.
  await click(item('data', tableId));
  await action('Graph');
  s = await state();
  c = s.graphs.find((g) => g.id === copy.id);
  ok('◧ Graph still opens the quick graph, not the analysis copy', s.active.id === quick[0].id && c.spec.opts.sig.length === 1 && c.spec.opts.title === 'Copy for the poster' && s.graphs.length === 6);

  // ---------- Result view lists every graph of an analysis ----------
  await click(item('result', welch.id));
  await action('View graphs (2)');
  const menu = await run(`Array.from(document.querySelectorAll('#ctx-menu .ctx-item'), (x) => x.textContent)`);
  ok('a result with a duplicate offers both graphs', menu.length === 2 && menu[0] === '◧ ' + original.name && menu[1] === '◧ ' + copy.name);
  await click('#ctx-menu .ctx-item', 1);
  ok('choosing a graph from that menu opens it', (await state()).active.id === copy.id);

  // ---------- Duplicate from the sidebar, including a quick graph ----------
  await contextAction(item('graph', quick[0].id), '⧉ Duplicate graph');
  s = await state();
  const quickCopy = s.graphs.find((g) => g.id === s.active.id);
  ok('right-click Duplicate copies a quick graph as another table graph', s.graphs.length === 7 && quickCopy.name === 'Enzyme assay (copy)' && !quickCopy.resultId && quickCopy.tableId === tableId);
  await contextAction(item('graph', quickCopy.id), '⧉ Duplicate graph');
  ok('duplicating a copy numbers it instead of stacking suffixes', (await state()).graphs.some((g) => g.name === 'Enzyme assay (copy 2)'));
  await click(item('data', tableId));
  await action('Graph');
  ok('◧ Graph keeps reusing the original quick graph', (await state()).active.id === quick[0].id && (await state()).graphs.length === 8);

  // ---------- Persistence and deletion ----------
  const saved = await state();
  await load({ tables: [], results: [], graphs: [] });
  await load(saved);
  ok('save/reopen keeps every copy and its links', JSON.stringify(await state()) === JSON.stringify(saved));
  await click(item('data', tableId));
  await paste(a.map((v, i) => [v, b[i]]));
  s = await state();
  ok('after reopening, data edits still refresh the analysis copy', near(s.graphs.find((g) => g.id === copy.id).spec.opts.sig[0].p, T.unpairedT(a, b, true).p));
  await contextAction(item('graph', original.id), '🗑 Delete graph');
  s = await state();
  ok('deleting the original graph hands the analysis link to its copy', s.results.find((r) => r.id === welch.id).graphId === copy.id);
  await click(item('result', welch.id));
  await action('View graph');
  ok('View graph then opens the surviving copy', (await state()).active.id === copy.id);

  // ---------- Older projects ----------
  // Files from before the tail option and graph.resultId existed.
  const fresh = fixture(), legacyTableId = fresh.tables[0].id;
  await load(fresh);
  await openAnalyze(legacyTableId, 'Unpaired t test');
  await click('#analyze-go');
  const legacy = await state();
  ok('the older-project fixture has the expected ids', legacy.results[0].id === 'res_1' && legacy.graphs[0].id === 'gr_1');
  delete legacy.results[0].spec.alternative;
  delete legacy.graphs[0].resultId;
  legacy.graphs[0].name = 'Enzyme assay';
  await load(legacy);
  await openAnalyze(legacyTableId, 'Unpaired t test');
  ok('an older analysis without a tail matches the default two-tailed run', (await notice()).shown);
  await click('#analyze-go');
  s = await state();
  ok('re-running it does not duplicate the older analysis', s.results.length === 1 && s.graphs.length === 1 && s.active.id === 'res_1');
  await click(item('graph', 'gr_1'));
  await action('Duplicate');
  s = await state();
  ok('a graph linked only through result.graphId duplicates with a link to its result', s.graphs.length === 2 && s.graphs[1].resultId === 'res_1' && s.results[0].graphId === 'gr_1');

  win.setContentSize(900, 600);
  await openAnalyze(legacy.tables[0].id, 'Unpaired t test');
  ok('the notice and buttons fit the minimum window size', await run(`(() => {
    const modal = document.querySelector('#modal-analyze .modal').getBoundingClientRect(), box = document.querySelector('#analyze-existing');
    const go = document.querySelector('#analyze-go').getBoundingClientRect();
    return box.checkVisibility() && box.scrollWidth === box.clientWidth && box.getBoundingClientRect().right <= modal.right && go.bottom <= innerHeight && go.right <= modal.right;
  })()`));
  if (process.env.STATLAB_SCREENSHOTS) {
    fs.mkdirSync(process.env.STATLAB_SCREENSHOTS, { recursive: true });
    await run('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(process.env.STATLAB_SCREENSHOTS, 'analyze-existing.png'), (await win.webContents.capturePage()).toPNG());
  }
  ok('renderer reports no console errors', errors.length === 0);
  console.log(`\n${pass} reuse/duplicate checks passed`);
}).then(() => finish(0)).catch((err) => { console.error(err); finish(1); });
function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
