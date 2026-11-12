// Symbol palette + \shortcut UI tests. Run: npm exec --offline -- electron tests/symbols-ui.check.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const D = require('../js/data.js');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-symbols-'));
app.setPath('userData', temp);
app.setPath('sessionData', temp);
let win, pass = 0;
const run = (code) => win.webContents.executeJavaScript(code, true);
const state = async () => JSON.parse(await run('window.StatLab.getStateJSON()'));
const cell = (r, c) => `td.dcell[data-r="${r}"][data-c="${c}"]`;
const CTRL = process.platform === 'darwin' ? 4 : 2;
function check(name, condition) {
  assert.ok(condition, name);
  console.log('PASS', name);
  pass++;
}
async function fixture(type = 'column') {
  const table = new D.DataTable(type);
  table.id = 'symbols-fixture';
  table.rows = Array.from({ length: 3 }, () => new Array(table.width()).fill(''));
  [['1', '4'], ['2', '5'], ['3', '6']].forEach((r, i) => { table.setCell(i, 0, r[0]); table.setCell(i, 1, r[1]); });
  const json = JSON.stringify({ tables: [table], results: [], graphs: [],
    counter: 1, active: { view: 'data', id: table.id } });
  assert.strictEqual(await run(`window.StatLab.loadStateJSON(${JSON.stringify(json)})`), true);
}
async function pointOf(selector) {
  return run(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target || !target.checkVisibility()) throw new Error('Not visible: ' + ${JSON.stringify(selector)});
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
}
async function click(selector) {
  const point = await pointOf(selector);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point });
  }
}
async function key(name, code, modifiers = 0, text) {
  const event = { key: name, windowsVirtualKeyCode: code, modifiers };
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown', ...event, ...(text != null ? { text } : name === 'Enter' ? { text: '\r' } : {}),
  });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}
async function typeText(text) {
  for (const ch of text) {
    const code = ch === ' ' ? 32 : undefined;
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, ...(code ? { windowsVirtualKeyCode: code } : {}) });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  }
}
const focused = () => run(`(() => { const a = document.activeElement; return a && { tag: a.tagName, cls: a.className, value: a.value }; })()`);
const visible = (sel) => run(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); return !!n && !n.hidden && n.checkVisibility(); })()`);

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1320, height: 860,
    webPreferences: { contextIsolation: true, spellcheck: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(root, 'index.html'));
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.bringToFront');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });

  // --- column name: \shortcut + Space ---
  await fixture();
  await click('th input.colname');
  check('Ω button appears beside a focused column name', await visible('.sym-trigger'));
  await key('End', 35);
  await typeText(' \\alpha ');
  let f = await focused();
  check('\\alpha + Space becomes α (the Space is consumed)', f.value.endsWith(' α'));
  await typeText('\\^2');
  await key('Enter', 13);
  let s = await state();
  check('Enter expands \\^2 and finishes the rename', s.tables[0].columns[0].name.endsWith(' α²'));
  check('Enter still returns the keyboard to the grid', (await focused()).cls.includes('sheet-wrap'));

  // --- palette via the Ω button, on another column ---
  await click('th:nth-child(4) input.colname');
  await key('End', 35);
  const before = (await focused()).value;
  await click('.sym-trigger');
  check('Ω button opens the palette', await visible('.sym-panel'));
  check('opening the palette keeps focus in the field', (await focused()).cls.includes('colname'));
  await click('.sym-btn[data-sym="β"]');
  f = await focused();
  check('clicking β inserts it at the caret and keeps focus', f.cls.includes('colname') && f.value === before + 'β');
  check('palette stays open for several symbols', await visible('.sym-panel'));
  await click('.sym-tab[data-group="units"]');
  await click('.sym-btn[data-sym="µ"]');
  s = await state();
  check('inserted symbols update the table model like typing', s.tables[0].columns[1].name === before + 'βµ');
  await key('Escape', 27);
  check('Escape closes the palette first', !(await visible('.sym-panel')));
  check('…without abandoning the rename', (await focused()).cls.includes('colname') && (await state()).tables[0].columns[1].name === before + 'βµ');
  await key('Enter', 13);
  check('recently used symbols get their own tab', await run(`(Symbols.open(document.querySelector('th input.colname')), !!document.querySelector('.sym-tab[data-group="recent"]'))`));
  await run('Symbols.close(); document.activeElement.blur && document.activeElement.blur()');

  // --- grid: Ctrl+G on a selected Sample ID cell ---
  await click(cell(0, -1));
  await key('g', 71, CTRL);
  check('Ctrl+G on a selected cell starts editing it with the palette open', await visible('.sym-panel') && (await focused()).cls.includes('celledit'));
  await click('.sym-tab[data-group="greek"]');
  await key('ArrowRight', 39);
  await key('ArrowRight', 39);
  await key('Enter', 13);
  check('arrow keys + Enter pick a symbol without leaving the cell', (await focused()).value === 'β');
  await key('Escape', 27);
  await typeText('-cell');
  await key('Enter', 13);
  s = await state();
  check('the cell commits normally afterwards', s.tables[0].sampleIds[0] === 'β-cell');

  // --- numeric cell: no Ω button, but shortcuts work ---
  await click(cell(1, 0));
  await typeText('\\');
  check('numeric cell editors skip the Ω button', !(await visible('.sym-trigger')));
  await typeText('pm');
  await key('Tab', 9);
  s = await state();
  check('shortcut expands before Tab commits the cell', s.tables[0].rows[1][0] === '±');

  // --- graph axis label ---
  await fixture();
  await run(`Array.from(document.querySelectorAll('.view-actions .btn')).find((b) => b.textContent.includes('Graph')).click()`);
  await run(`(() => { const g = Array.from(document.querySelectorAll('.ctrl-group')).find((n) => n.querySelector('label') && n.querySelector('label').textContent === 'Y-axis label'); g.querySelector('input').id = 'ylabel-under-test'; })()`);
  await click('#ylabel-under-test');
  await run(`(() => { const i = document.querySelector('#ylabel-under-test'); i.setSelectionRange(i.value.length, i.value.length); })()`);
  await typeText('\\Delta F (\\micro g/mL)');
  const svg = await run('window.StatLab.activeGraphSVG()');
  check('Y-axis label accepts symbols and the figure renders them', svg.includes('ΔF (µg/mL)'));

  // --- rename dialog ---
  await run(`(() => { const m = document.querySelector('#modal-rename'); m.hidden = false; const i = document.querySelector('#rename-name'); i.value = 'x'; i.focus(); i.setSelectionRange(1, 1); })()`);
  await typeText('\\_0');
  await key('Escape', 27);
  check('Escape without the palette open still closes dialogs', await run(`document.querySelector('#modal-rename').hidden`));
  check('plain shortcuts are left as typed until finished', await run(`document.querySelector('#rename-name').value`) === 'x\\_0');

  check('renderer reports no console errors', errors.length === 0);
  console.log(`\n${pass} symbol UI checks passed`);
}).then(() => finish(0)).catch((err) => { console.error(err); finish(1); });
function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(code);
}
