// Exercise the actual renderer in Electron, with an isolated autosave directory.
// Run with: npm run test:ui
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-navigator-'));
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
async function click(selector, index = 0, button = 'left') {
  const point = await run(`(() => {
    const rect = document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button, clickCount: 1, ...point });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button, clickCount: 1, ...point });
}
async function key(key, code) {
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code });
}
async function openRename(list, index = 0) {
  await click(list + ' .nav-item', index, 'right');
  const labels = await run(`Array.from(document.querySelectorAll('#ctx-menu .ctx-item'), (item) => item.textContent)`);
  ok(list + ' right-click offers Rename', labels.includes('✎ Rename…'));
  await click('#ctx-menu .ctx-item', labels.indexOf('✎ Rename…'));
  ok('rename dialog opens and selects the existing name', await run(`(() => {
    const input = document.querySelector('#rename-name');
    return !document.querySelector('#modal-rename').hidden && document.activeElement === input &&
      input.selectionStart === 0 && input.selectionEnd === input.value.length;
  })()`));
}
async function submitName(name) {
  await run(`(() => {
    const input = document.querySelector('#rename-name');
    input.value = ${JSON.stringify(name)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#rename-form').requestSubmit();
  })()`);
}

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
  win.webContents.debugger.attach('1.3');
  await run('window.StatLab.newTable()');
  const initial = await state();
  ok('new table uses the default Column data label', initial.tables[0].name === 'Column data');

  await openRename('#nav-tables');
  await win.webContents.debugger.sendCommand('Input.insertText', { text: '  Cell viability — Day 7  ' });
  await key('Enter', 13);
  let saved = await state();
  ok('table rename trims surrounding whitespace', saved.tables[0].name === 'Cell viability — Day 7');
  ok('table rename preserves its id and data', saved.tables[0].id === initial.tables[0].id && JSON.stringify(saved.tables[0].rows) === JSON.stringify(initial.tables[0].rows));
  ok('table rename updates sidebar and open table heading', await run(`document.querySelector('#nav-tables .nav-item').textContent.includes('Cell viability — Day 7') && document.querySelector('.view-title input').value === 'Cell viability — Day 7'`));
  ok('successful rename closes the dialog', await run(`document.querySelector('#modal-rename').hidden`));

  await openRename('#nav-tables');
  await submitName('   ');
  ok('whitespace-only name is rejected without changing the table', (await state()).tables[0].name === saved.tables[0].name && await run(`!document.querySelector('#modal-rename').hidden && !document.querySelector('#rename-name').validity.valid`));
  await submitName('Repaired name');
  ok('typing clears validation and allows a valid rename', (await state()).tables[0].name === 'Repaired name');

  await openRename('#nav-tables');
  await submitName('');
  ok('empty name is rejected', await run(`!document.querySelector('#modal-rename').hidden && !document.querySelector('#rename-name').validity.valid`));
  await run(`document.querySelector('#modal-rename .modal-foot [data-close]').click()`);
  ok('Cancel leaves the previous name unchanged', (await state()).tables[0].name === 'Repaired name' && await run(`document.querySelector('#modal-rename').hidden`));

  await openRename('#nav-tables');
  await win.webContents.debugger.sendCommand('Input.insertText', { text: 'Do not save this' });
  await key('Escape', 27);
  ok('Escape cancels without changing the name', (await state()).tables[0].name === 'Repaired name' && await run(`document.querySelector('#modal-rename').hidden`));

  await openRename('#nav-tables');
  await run(`document.querySelector('#rename-name').value = 'Do not save this'; document.querySelector('#modal-rename .modal-x').click()`);
  ok('close button cancels without changing the name', (await state()).tables[0].name === 'Repaired name' && await run(`document.querySelector('#modal-rename').hidden`));

  await openRename('#nav-tables');
  await run(`document.querySelector('#rename-name').value = 'Do not save this'; document.querySelector('#modal-rename').click()`);
  ok('backdrop click cancels without changing the name', (await state()).tables[0].name === 'Repaired name' && await run(`document.querySelector('#modal-rename').hidden`));

  await openRename('#nav-tables');
  await win.webContents.debugger.sendCommand('Input.insertText', { text: 'Viability <treated> & "control"' });
  await click('#rename-form button[type="submit"]');
  ok('special characters display as text, not markup', await run(`document.querySelector('#nav-tables .nav-item').textContent.includes('Viability <treated> & "control"') && !document.querySelector('#nav-tables treated')`));

  await run(`window.StatLab.loadExample('twogroups')`);
  const beforeInactive = await state();
  await openRename('#nav-tables');
  await submitName('Cell viability — Day 7');
  saved = await state();
  ok('renaming an inactive table targets the right item without navigating', saved.tables[0].name === 'Cell viability — Day 7' && saved.tables[1].name === beforeInactive.tables[1].name && JSON.stringify(saved.active) === JSON.stringify(beforeInactive.active));

  await run(`Array.from(document.querySelectorAll('.view-actions button')).find((button) => button.textContent.includes('Analyze')).click(); document.querySelector('#analyze-go').click()`);
  const analyzed = await state();
  ok('analysis produces a linked result and graph', analyzed.results.length === 1 && analyzed.graphs.length === 1 && analyzed.results[0].graphId === analyzed.graphs[0].id);
  const resultHTML = await run(`document.querySelector('.result-card').textContent`);
  await openRename('#nav-results');
  await submitName('Day 7 treatment comparison');
  saved = await state();
  ok('result rename updates sidebar and heading', saved.results[0].name === 'Day 7 treatment comparison' && await run(`document.querySelector('#nav-results .nav-item').textContent.includes('Day 7 treatment comparison') && document.querySelector('.view-title').textContent === 'Day 7 treatment comparison'`));
  ok('result rename preserves computed statistics and graph link', await run(`document.querySelector('.result-card').textContent`) === resultHTML && saved.results[0].graphId === analyzed.results[0].graphId);

  await run(`document.querySelector('#nav-graphs .nav-item').click()`);
  const beforeGraph = await state();
  await openRename('#nav-graphs');
  await submitName('Viability figure');
  saved = await state();
  ok('graph rename updates sidebar and heading', saved.graphs[0].name === 'Viability figure' && await run(`document.querySelector('#nav-graphs .nav-item').textContent.includes('Viability figure') && document.querySelector('.view-title').textContent === 'Viability figure'`));
  ok('graph rename preserves figure title and source links', saved.graphs[0].spec.opts.title === beforeGraph.graphs[0].spec.opts.title && saved.graphs[0].tableId === beforeGraph.graphs[0].tableId && saved.graphs[0].resultId === beforeGraph.graphs[0].resultId);

  const beforeLinkedTable = await state();
  await openRename('#nav-tables', 1);
  await submitName('Drug response experiment');
  saved = await state();
  ok('renaming a source table preserves linked result and graph names', saved.results[0].name === beforeLinkedTable.results[0].name && saved.graphs[0].name === beforeLinkedTable.graphs[0].name);
  ok('renaming a source table preserves numerical data and graph spec', JSON.stringify(saved.tables[1].rows) === JSON.stringify(beforeLinkedTable.tables[1].rows) && JSON.stringify(saved.graphs[0].spec) === JSON.stringify(beforeLinkedTable.graphs[0].spec));

  // Autosave uses a debounced write, so wait on the actual saved state.
  await run(`new Promise((resolve, reject) => {
    const expected = window.StatLab.getStateJSON();
    const deadline = Date.now() + 3000;
    function check() {
      const stored = localStorage.getItem('statlab_state');
      if (stored && JSON.stringify(JSON.parse(stored)) === JSON.stringify(JSON.parse(expected))) return resolve();
      if (Date.now() > deadline) return reject(new Error('Rename was not autosaved'));
      setTimeout(check, 25);
    }
    check();
  })`);
  ok('renamed tables, results and graphs reach autosave', true);

  const project = path.join(temp, 'rename.statlab.json');
  fs.writeFileSync(project, await run('window.StatLab.getStateJSON()'), 'utf8');
  await run(`window.StatLab.loadStateJSON('{"tables":[],"results":[],"graphs":[]}')`);
  ok('saved project reopens successfully', await run(`window.StatLab.loadStateJSON(${JSON.stringify(fs.readFileSync(project, 'utf8'))})`));
  const reopened = await state();
  ok('all custom sidebar names survive saving and reopening a project', JSON.stringify(reopened) === JSON.stringify(saved));
  ok('reopened sidebar displays the saved table, result and graph names', await run(`document.querySelector('#nav-tables').textContent.includes('Cell viability — Day 7') && document.querySelector('#nav-tables').textContent.includes('Drug response experiment') && document.querySelector('#nav-results').textContent.includes('Day 7 treatment comparison') && document.querySelector('#nav-graphs').textContent.includes('Viability figure')`));
  ok('renderer reports no console errors', pageErrors.length === 0);
  console.log(`\n${pass} navigator checks passed`);
}).then(() => finish(0)).catch((err) => {
  console.error(err);
  finish(1);
});

function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
