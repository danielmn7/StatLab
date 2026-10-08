// Exercise nested navigation in the real renderer, without touching user projects.
// Run with: npm run test:ui
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-sidebar-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);
let win, pass = 0;
const run = (code) => win.webContents.executeJavaScript(code, true);
const state = async () => JSON.parse(await run('window.StatLab.getStateJSON()'));
const branch = (id) => `.nav-branch[data-table-id="${id}"]`;
const item = (view, id) => `.nav-item[data-view="${view}"][data-id="${id}"]`;
const toggle = (id, view) => branch(id) + (view === 'data' ? ' .nav-toggle' : ` .nav-group[data-view="${view}"] .nav-group-toggle`);
function ok(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}
async function click(selector, button = 'left') {
  const point = await run(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target || !target.checkVisibility()) throw new Error('Not visible: ' + ${JSON.stringify(selector)});
    target.scrollIntoView({ block: 'nearest' });
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button, clickCount: 1, ...point });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button, clickCount: 1, ...point });
}
async function expanded(id, view) {
  return run(`document.querySelector(${JSON.stringify(toggle(id, view))}).getAttribute('aria-expanded') === 'true'`);
}
async function action(label) {
  await run(`Array.from(document.querySelectorAll('.view-actions button')).find((b) => b.textContent.includes(${JSON.stringify(label)})).click()`);
}
async function analyze() { await action('Analyze'); await click('#analyze-go'); }
async function load(project) {
  assert.ok(await run(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(project))})`), 'Project loads');
}
async function contextAction(selector, label) {
  await click(selector, 'right');
  await run(`Array.from(document.querySelectorAll('#ctx-menu .ctx-item')).find((entry) => entry.textContent === ${JSON.stringify(label)}).click()`);
}
async function verifySidebar(name) {
  ok(name, await run(`(() => {
    const s = JSON.parse(window.StatLab.getStateJSON());
    const nodes = Array.from(document.querySelectorAll('#navigator .nav-item'));
    const expected = s.tables.map((t) => ({ item: t, view: 'data' }))
      .concat(s.results.map((r) => ({ item: r, view: 'result' })), s.graphs.map((g) => ({ item: g, view: 'graph' })));
    return nodes.length === expected.length && expected.every(({ item, view }) => {
      const matches = nodes.filter((node) => node.dataset.id === item.id && node.dataset.view === view);
      if (matches.length !== 1 || matches[0].querySelector('.nav-label').textContent !== item.name) return false;
      const parent = matches[0].closest('.nav-branch');
      if (view === 'data') return parent && parent.dataset.tableId === item.id;
      const linked = s.tables.some((t) => t.id === item.tableId);
      return linked ? parent && parent.dataset.tableId === item.tableId && matches[0].closest('.nav-group').dataset.view === view
        : !parent && !!matches[0].closest('#nav-unlinked');
    });
  })()`));
}
async function waitForAutosave() {
  await run(`new Promise((resolve, reject) => {
    const expected = window.StatLab.getStateJSON(), deadline = Date.now() + 3000;
    function check() {
      const stored = localStorage.getItem('statlab_state');
      if (stored && JSON.stringify(JSON.parse(stored)) === JSON.stringify(JSON.parse(expected))) return resolve();
      if (Date.now() > deadline) return reject(new Error('Sidebar state was not autosaved'));
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
  ok('sidebar uses a nested hierarchy rather than global Results and Graphs lists', await run(`!!document.querySelector('#nav-tables') && !document.querySelector('#nav-results') && !document.querySelector('#nav-graphs')`));
  ok('empty workspace has one table placeholder and no unlinked section', await run(`document.querySelectorAll('#nav-tables .nav-empty').length === 1 && document.querySelector('#nav-unlinked-section').hidden`));

  await run(`window.StatLab.loadExample('twogroups')`);
  const first = (await state()).tables[0].id;
  ok('table without children has no disclosure or empty folders', await run(`!document.querySelector(${JSON.stringify(branch(first))}).querySelector('.nav-toggle, .nav-group')`));
  await analyze();
  await click(item('data', first));
  await analyze();
  await run(`window.StatLab.loadExample('twogroups')`);
  const second = (await state()).tables[1].id;
  await analyze();
  await click(item('data', second));
  await action('Graph');
  const fixture = await state();
  ok('fixture includes repeated analyses and a standalone graph', fixture.results.length === 3 && fixture.graphs.length === 4 && fixture.graphs.some((g) => !g.resultId));
  await verifySidebar('same-named tables own exactly their linked results/graphs, with no duplicates');
  ok('table, Results and Graphs badges have exact counts', await run(`(() => {
    const s = JSON.parse(window.StatLab.getStateJSON());
    return Array.from(document.querySelectorAll('.nav-branch')).every((node) => {
      const id = node.dataset.tableId;
      const results = s.results.filter((r) => r.tableId === id).length, graphs = s.graphs.filter((g) => g.tableId === id).length;
      return Number(node.querySelector('.nav-table-row .nav-count').textContent) === results + graphs &&
        Number(node.querySelector('.nav-group[data-view="result"] .nav-count').textContent) === results &&
        Number(node.querySelector('.nav-group[data-view="graph"] .nav-count').textContent) === graphs;
    });
  })()`));
  ok('folders and leaves are visually indented under their table', await run(`(() => {
    const node = document.querySelector(${JSON.stringify(branch(first))});
    const x = (selector) => node.querySelector(selector).getBoundingClientRect().x;
    return x('.nav-table-row .nav-label') < x('.nav-group-toggle .nav-label') && x('.nav-group-toggle .nav-label') < x('.nav-results .nav-label');
  })()`));
  ok('disclosures are accessible buttons controlling real lists', await run(`Array.from(document.querySelectorAll('#navigator [aria-expanded]')).every((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') && document.getElementById(node.getAttribute('aria-controls'))) `));

  const beforeCollapse = await state();
  await click(toggle(first, 'data'));
  ok('collapsing a table hides only its children, not another table', !(await expanded(first, 'data')) && await expanded(second, 'data') && await run(`!document.querySelector(${JSON.stringify(item('result', fixture.results[0].id))}).checkVisibility()`));
  ok('table disclosure does not navigate or mutate data', JSON.stringify((await state()).active) === JSON.stringify(beforeCollapse.active) && JSON.stringify((await state()).tables) === JSON.stringify(beforeCollapse.tables));
  await click(item('data', first));
  ok('clicking a collapsed table name opens its data without expanding it', (await state()).active.id === first && !(await expanded(first, 'data')) && await run(`!!document.querySelector('.sheet')`));
  await click(toggle(first, 'data'));
  await click(toggle(first, 'result'));
  ok('Results can collapse independently while Graphs remain visible', !(await expanded(first, 'result')) && await expanded(first, 'graph') && await run(`document.querySelector(${JSON.stringify(item('graph', fixture.graphs[0].id))}).checkVisibility()`));
  ok('toggle retains keyboard focus after collapsing', await run(`document.activeElement === document.querySelector(${JSON.stringify(toggle(first, 'result'))})`));
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 });
  ok('keyboard Enter expands a focused group', await expanded(first, 'result'));

  const result = fixture.results[0];
  await click(item('result', result.id));
  ok('nested result click selects only the result, not its parent table', (await state()).active.view === 'result' && (await state()).active.id === result.id && await run(`document.querySelectorAll('#navigator .nav-item.active').length === 1 && document.querySelector('.view-title').textContent === ${JSON.stringify(result.name)}`));
  const resultText = await run(`document.querySelector('.result-card').textContent`);
  await click(toggle(first, 'graph'));
  await click(toggle(first, 'data'));
  await action('View graph');
  ok('View graph opens collapsed ancestors and selects the linked graph', await expanded(first, 'data') && await expanded(first, 'graph') && (await state()).active.id === result.graphId && await run(`!!document.querySelector('#graph-canvas svg')`));
  await click(item('result', result.id));
  ok('nested navigation preserves the computed result', await run(`document.querySelector('.result-card').textContent`) === resultText);

  await click(toggle(first, 'result'));
  await click(toggle(first, 'data'));
  await click(toggle(second, 'graph'));
  const collapsed = await state();
  await waitForAutosave();
  ok('collapsed table and folder state reaches autosave', await run(`JSON.parse(localStorage.getItem('statlab_state')).navigator.collapsed.length === 3`));
  const project = path.join(temp, 'nested.statlab.json');
  fs.writeFileSync(project, JSON.stringify(collapsed), 'utf8');
  await load({ tables: [], results: [], graphs: [] });
  await load(JSON.parse(fs.readFileSync(project, 'utf8')));
  ok('save/reopen restores the exact project and collapse state', JSON.stringify(await state()) === JSON.stringify(collapsed) && !(await expanded(first, 'data')) && !(await expanded(first, 'result')) && !(await expanded(second, 'graph')));
  await waitForAutosave();
  await win.loadFile(path.join(root, 'index.html'));
  ok('restarting offers the saved project', await run(`!document.querySelector('#modal-restore').hidden`));
  await click('#restore-yes');
  ok('session restore retains nested collapse state', JSON.stringify(await state()) === JSON.stringify(collapsed));

  const legacy = JSON.parse(JSON.stringify(fixture));
  delete legacy.navigator;
  await load(legacy);
  ok('older projects group automatically and start expanded', await expanded(first, 'data') && await expanded(second, 'result') && (await state()).navigator.collapsed.length === 0);
  await verifySidebar('old-project grouping preserves every name, item and source association');
  ok('old-project grouping preserves all statistics specs and data', JSON.stringify((await state()).tables) === JSON.stringify(legacy.tables) && JSON.stringify((await state()).results) === JSON.stringify(legacy.results) && JSON.stringify((await state()).graphs) === JSON.stringify(legacy.graphs));
  await load({ ...legacy, navigator: { collapsed: ['data:' + first, 'graph:missing-table', null, 'result:' + first] } });
  ok('restore discards stale or invalid disclosure keys', JSON.stringify((await state()).navigator.collapsed) === JSON.stringify(['data:' + first, 'result:' + first]));
  await click(item('data', first));
  await analyze();
  const newResult = (await state()).results.at(-1);
  ok('new analysis reveals its collapsed source table and Results group', await expanded(first, 'data') && await expanded(first, 'result') && (await state()).active.id === newResult.id && await run(`document.querySelector(${JSON.stringify(item('result', newResult.id))}).checkVisibility()`));
  await click(toggle(first, 'graph'));
  await click(toggle(first, 'data'));
  await click(item('data', first));
  await action('Graph');
  ok('quick graph reveals its collapsed source table and Graphs group', await expanded(first, 'data') && await expanded(first, 'graph') && (await state()).active.view === 'graph');
  await click(toggle(second, 'data'));
  await click('#btn-graph-all');
  await verifySidebar('Graph All keeps every graph under its correct source table');
  ok('Graph All preserves unrelated collapsed branches', !(await expanded(second, 'data')));

  await load(legacy);
  await contextAction(item('graph', legacy.graphs[0].id), '🗑 Delete graph');
  ok('deleting a nested graph removes its item and dangling result link', !(await state()).graphs.some((g) => g.id === legacy.graphs[0].id) && !(await state()).results.some((r) => r.graphId === legacy.graphs[0].id));
  await verifySidebar('nested graph deletion updates the hierarchy without affecting other items');
  await contextAction(item('result', legacy.results[0].id), '🗑 Delete result');
  ok('deleting a nested result leaves its source table and remaining graph intact', (await state()).tables.length === legacy.tables.length && (await state()).results.length === legacy.results.length - 1 && (await state()).graphs.length === legacy.graphs.length - 1);
  await click(toggle(first, 'result'));
  await click(toggle(first, 'data'));
  await run(`void (window.confirm = () => true)`);
  await contextAction(item('data', first), '🗑 Delete table & related');
  ok('deleting a collapsed table removes only its own results/graphs and disclosure state', (await state()).tables.length === 1 && (await state()).tables[0].id === second && (await state()).results.every((r) => r.tableId === second) && (await state()).graphs.every((g) => g.tableId === second) && (await state()).navigator.collapsed.length === 0);
  await verifySidebar('remaining table hierarchy is valid after cascading deletion');
  for (const r of (await state()).results) await contextAction(item('result', r.id), '🗑 Delete result');
  ok('an empty Results group disappears while Graphs remain', await run(`!document.querySelector(${JSON.stringify(branch(second))}).querySelector('.nav-results') && !!document.querySelector(${JSON.stringify(branch(second))}).querySelector('.nav-graphs')`));
  for (const g of (await state()).graphs) await contextAction(item('graph', g.id), '🗑 Delete graph');
  ok('removing the last child removes empty folders and table disclosure', await run(`!document.querySelector(${JSON.stringify(branch(second))}).querySelector('.nav-group, .nav-toggle')`));

  const orphaned = JSON.parse(JSON.stringify(legacy));
  orphaned.results[0].tableId = 'missing-table';
  delete orphaned.graphs[0].tableId;
  await load(orphaned);
  ok('missing-source results and graphs remain visible under Unlinked items', await run(`!document.querySelector('#nav-unlinked-section').hidden && document.querySelectorAll('#nav-unlinked .nav-item').length === 2`));
  await verifySidebar('unlinked fallback shows each orphan once and keeps linked items under their tables');
  await click(item('result', orphaned.results[0].id));
  ok('orphan result still opens with its missing-source explanation', await run(`document.querySelector('#content').textContent.includes('(source table missing)')`));
  await click(item('graph', orphaned.graphs[0].id));
  ok('orphan graph remains viewable', await run(`!!document.querySelector('#graph-canvas svg')`));
  await load({ ...orphaned, tables: [] });
  await verifySidebar('projects containing only unlinked items do not lose any results or graphs');
  await load(legacy);
  ok('switching to a linked project hides the Unlinked items section', await run(`document.querySelector('#nav-unlinked-section').hidden && !document.querySelector('#nav-unlinked .nav-item')`));

  const longNames = JSON.parse(JSON.stringify(legacy));
  longNames.tables[0].name = 'Viability <treated> & "control" — an intentionally long source table name';
  longNames.results[0].name = 'Welch comparison <treated> & control — intentionally long result name';
  await load(longNames);
  await verifySidebar('special characters and long names remain literal text');
  ok('nested sidebar truncates long names instead of overflowing horizontally', await run(`(() => {
    const nav = document.querySelector('#navigator'), label = document.querySelector(${JSON.stringify(item('data', first))}).querySelector('.nav-label');
    return nav.scrollWidth === nav.clientWidth && label.scrollWidth > label.clientWidth && getComputedStyle(label).textOverflow === 'ellipsis' && !nav.querySelector('treated');
  })()`));
  win.setSize(900, 600);
  ok('nested sidebar stays within its width at the minimum window size', await run(`document.querySelector('#navigator').scrollWidth === document.querySelector('#navigator').clientWidth`));
  const manyTables = JSON.parse(JSON.stringify(legacy));
  manyTables.tables = Array.from({ length: 30 }, (_, i) => ({ ...legacy.tables[0], id: 'scroll-table-' + i, name: 'Experiment ' + i }));
  manyTables.results = []; manyTables.graphs = [];
  manyTables.active = { view: 'data', id: manyTables.tables.at(-1).id };
  await load(manyTables);
  await analyze();
  ok('new analysis scrolls its nested entry into view in a long sidebar', await run(`(() => {
    const nav = document.querySelector('#navigator').getBoundingClientRect();
    const active = document.querySelector('#navigator .nav-item.active').getBoundingClientRect();
    return active.top >= nav.top && active.bottom <= nav.bottom;
  })()`));
  ok('renderer reports no console errors', errors.length === 0);
  console.log(`\n${pass} nested sidebar checks passed`);
}).then(() => finish(0)).catch((err) => { console.error(err); finish(1); });
function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
