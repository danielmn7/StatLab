// Native grid replacement tests. Run: npm exec --offline -- electron tests/sheet-edit.check.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const D = require('../js/data.js');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-sheet-edit-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);
let win, pass = 0;
const run = (code) => win.webContents.executeJavaScript(code, true);
const state = async () => JSON.parse(await run('window.StatLab.getStateJSON()'));
const cell = (r, c) => `td.dcell[data-r="${r}"][data-c="${c}"]`;
const value = async (c = 0) => (await state()).tables[0].rows[0][c];
const editor = () => run(`(() => {
  const input = document.querySelector('input.celledit');
  return input && { value: input.value, start: input.selectionStart,
    end: input.selectionEnd, focused: document.activeElement === input };
})()`);
function check(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}
async function fixture(type = 'column', old = '9876', c = 0) {
  const table = new D.DataTable(type);
  table.id = 'sheet-edit-fixture';
  table.rows = Array.from({ length: 3 }, () => new Array(table.width()).fill(''));
  if (type === 'grouped') table.rowTitles = ['Row 1', 'Row 2', 'Row 3'];
  table.setCell(0, c, old);
  const json = JSON.stringify({ tables: [table], results: [], graphs: [],
    counter: 1, active: { view: 'data', id: table.id } });
  assert.strictEqual(await run(`window.StatLab.loadStateJSON(${JSON.stringify(json)})`), true);
  return (await state()).tables[0];
}
async function click(selector, count = 1, modifiers = 0) {
  const point = await run(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target || !target.checkVisibility()) throw new Error('Not visible: ' + ${JSON.stringify(selector)});
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  for (let clickCount = 1; clickCount <= count; clickCount++) {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', button: 'left', clickCount, modifiers, ...point,
    });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', button: 'left', clickCount, modifiers, ...point,
    });
  }
}
async function key(name, code, modifiers = 0) {
  const event = { key: name, windowsVirtualKeyCode: code, modifiers };
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown', ...event, ...(name === 'Enter' ? { text: '\r' } : {}),
  });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}
async function typeText(text) {
  // Include the initial keydown: bulk insertion would bypass type-to-replace.
  // Omit printable virtual-key codes so punctuation cannot become Delete/Insert.
  for (const ch of text) {
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown', key: ch, text: ch,
    });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  }
}
const active = (r, c) => run(`!!document.querySelector(${JSON.stringify(cell(r, c) + '.active')})`);
// Clipboard events carry their own DataTransfer, so these tests never touch the OS clipboard.
const copySelection = () => run(`(() => {
  const data = new DataTransfer();
  document.querySelector('.sheet-wrap').dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
  return data.getData('text/plain');
})()`);
const pasteIntoEditor = (text) => run(`(() => {
  const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(text)});
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  document.querySelector('input.celledit').dispatchEvent(event);
  return event.defaultPrevented;
})()`);
const selected = () => run(`Array.from(document.querySelectorAll('td.dcell.sel'), (td) => td.dataset.r + ',' + td.dataset.c).join(' ')`);
async function copyPasteFixture(destType) {
  const source = new D.DataTable('column');
  source.id = 'copy-source';
  source.rows = Array.from({ length: 4 }, () => new Array(source.width()).fill(''));
  ['1.5', '-2.25e-3', '0'].forEach((v, r) => source.setCell(r, 0, v));
  const dest = new D.DataTable(destType);
  dest.id = 'copy-dest';
  dest.rows = Array.from({ length: 4 }, () => new Array(dest.width()).fill(''));
  if (destType === 'grouped') dest.rowTitles = ['Row 1', 'Row 2', 'Row 3', 'Row 4'];
  const json = JSON.stringify({ tables: [source, dest], results: [], graphs: [],
    counter: 2, active: { view: 'data', id: source.id } });
  assert.strictEqual(await run(`window.StatLab.loadStateJSON(${JSON.stringify(json)})`), true);
  return JSON.parse(JSON.stringify(dest.rows));
}
const destRows = async () => (await state()).tables.find((t) => t.id === 'copy-dest').rows;

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1320, height: 860,
    webPreferences: { contextIsolation: true, spellcheck: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  await win.loadFile(path.join(root, 'index.html'));
  win.webContents.debugger.attach('1.3');

  const cases = [
    { type: 'column', c: 0, old: '9876', text: '1234' },
    { type: 'column', c: 0, old: '', text: '5678' },
    { type: 'column', c: 0, old: '0', text: '0.04' },
    { type: 'column', c: 1, old: '9876', text: '-12.34' },
    { type: 'xy', c: 1, old: '9876', text: '1.25e-3' },
    { type: 'grouped', c: 3, old: '9876', text: '1234' },
    { type: 'survival', c: 0, old: '9876', text: '12.5' },
    { type: 'survival', c: 2, old: 'Old group', text: 'Control' },
  ];
  for (const test of cases) {
    const before = await fixture(test.type, test.old, test.c);
    await click(cell(0, test.c));
    let prefix = '';
    for (const ch of test.text) {
      await typeText(ch);
      prefix += ch;
      assert.deepStrictEqual(await editor(), {
        value: prefix, start: prefix.length, end: prefix.length, focused: true,
      }, `native ${test.type} replacement ${JSON.stringify(test.text)} after ${JSON.stringify(prefix)}`);
    }
    assert.strictEqual(await value(test.c), test.old, 'draft does not mutate the model before commit');
    await key('Enter', 13);
    const expected = before.rows.map((row) => row.slice());
    expected[0][test.c] = test.text;
    assert.deepStrictEqual((await state()).tables[0].rows, expected, 'only the edited cell changes');
    assert.strictEqual(await run(`document.querySelector(${JSON.stringify(cell(0, test.c))}).textContent`), test.text);
    check(test.type + ' preserves ' + JSON.stringify(test.text) + ' replacing ' + JSON.stringify(test.old),
      await active(1, test.c));
  }

  for (const mode of ['F2', 'double-click']) {
    await fixture();
    await click(cell(0, 0), mode === 'double-click' ? 2 : 1);
    if (mode === 'F2') await key('F2', 113);
    assert.deepStrictEqual(await editor(), { value: '9876', start: 0, end: 4, focused: true },
      mode + ' still selects the complete existing value');
    await typeText('4321');
    await key('Enter', 13);
    check(mode + ' keeps select-all replacement', await value() === '4321');
  }

  await fixture();
  await click(cell(0, 0));
  await typeText('1234');
  await key('Escape', 27);
  check('Escape discards the draft and restores the original value',
    await value() === '9876' && await run(`!document.querySelector('input.celledit') &&
      document.querySelector('td.dcell[data-r="0"][data-c="0"]').textContent === '9876'`));

  await fixture();
  await click(cell(0, 0));
  await typeText('1234');
  await key('Tab', 9);
  check('Tab commits in order and selects the next column', await value() === '1234' && await active(0, 1));
  await typeText('5678');
  await key('Tab', 9, 8); // CDP modifier bit 8 = Shift.
  check('Shift+Tab commits and selects the previous column',
    await value(1) === '5678' && await value() === '1234' && await active(0, 0));

  await fixture();
  await click(cell(0, 0));
  await typeText('1234');
  await click('.notes-area');
  check('blur commits the exact replacement',
    await value() === '1234' && await run(`!document.querySelector('input.celledit')`));

  // Copy a column selection, then paste it into another table whose cell editor is open.
  for (const [destType, c] of [['column', 1], ['grouped', 3]]) {
    const empty = await copyPasteFixture(destType);
    await click(cell(0, 0));
    await click(cell(2, 0), 1, 8); // Shift-click extends the selection.
    const copied = await copySelection();
    assert.strictEqual(copied, '1.5\n-2.25e-3\n0', 'copying a column selection yields one line per row');
    await run(`document.querySelector('.nav-item[data-view="data"][data-id="copy-dest"]').click()`);
    await click(cell(0, c), 2);
    assert.ok(await editor(), 'double-click opens the destination cell editor');
    check(destType + ' editor paste keeps the copied rows in separate cells', await pasteIntoEditor(copied)
      && JSON.stringify((await destRows()).map((row) => row[c])) === JSON.stringify(['1.5', '-2.25e-3', '0', ''])
      && JSON.stringify((await destRows()).map((row) => row.filter((_, j) => j !== c)))
        === JSON.stringify(empty.map((row) => row.filter((_, j) => j !== c))));
    check(destType + ' editor paste closes the editor and selects the pasted range',
      await run(`!document.querySelector('input.celledit')`) && await selected() === `0,${c} 1,${c} 2,${c}` && await active(0, c));
  }

  const empty = await copyPasteFixture('column');
  await run(`document.querySelector('.nav-item[data-view="data"][data-id="copy-dest"]').click()`);
  await click(cell(1, 0));
  await typeText('99');
  check('multi-column editor paste replaces the typed draft across rows and columns',
    await pasteIntoEditor('4\t5\r\n6\t7\r\n') && JSON.stringify(await destRows())
      === JSON.stringify([empty[0], ['4', '5'], ['6', '7'], empty[3]]));

  await click(cell(3, 0));
  await typeText('1');
  check('a single copied value still pastes natively into the open editor',
    !(await pasteIntoEditor('42\n')) && (await editor()).value === '1' && (await destRows())[3][0] === '');
  await key('Escape', 27);

  await fixture();
  await click(cell(0, 0));
  await typeText('123');
  await key('Backspace', 8);
  await typeText('45');
  await key('Enter', 13);
  check('Backspace edits the draft without clearing the grid selection', await value() === '1245');

  await run(`new Promise((resolve, reject) => {
    const expected = window.StatLab.getStateJSON(), deadline = Date.now() + 3000;
    function poll() {
      const saved = localStorage.getItem('statlab_state');
      if (saved && JSON.stringify(JSON.parse(saved)) === JSON.stringify(JSON.parse(expected))) return resolve();
      if (Date.now() > deadline) return reject(new Error('Corrected cell was not autosaved'));
      setTimeout(poll, 25);
    }
    poll();
  })`);
  const expected = await state();
  await win.loadFile(path.join(root, 'index.html'));
  assert.strictEqual(await run(`!document.querySelector('#modal-restore').hidden`), true,
    'reload offers the isolated autosave');
  await click('#restore-yes');
  check('autosave and reload preserve the exact corrected value',
    JSON.stringify(await state()) === JSON.stringify(expected) && await value() === '1245');
  check('renderer reports no console errors', errors.length === 0);
  console.log(`\n${pass} sheet-edit checks passed`);
}).then(() => finish(0)).catch((err) => { console.error(err); finish(1); });
function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
