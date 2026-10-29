// Launch the real desktop shell twice: renderer reload alone cannot catch a lost
// main-process save destination. All projects/profiles live in an isolated temp dir.
// Run with: node tests/project-session.check.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.STATLAB_SESSION_TEST_PHASE) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  const DataLib = require('../js/data.js');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'statlab-project-session-'));
  const original = path.join(temp, 'original.statlab.json');
  const recovery = path.join(temp, 'profile', 'project-recovery.json');
  fs.writeFileSync(original, JSON.stringify({ tables: [DataLib.sample('twogroups')], results: [], graphs: [] }));
  try {
    for (const phase of ['seed', 'restore', 'restore-copy', 'checkpoint-failure-seed', 'checkpoint-failure-restore', 'start-fresh', 'restore-unsaved', 'missing', 'legacy', 'corrupt', 'window-recreate', 'window-transition', 'reload-transition', 'browser']) {
      if (phase === 'missing') {
        const record = JSON.parse(fs.readFileSync(recovery, 'utf8'));
        record.filePath = original;
        record.state.tables[0].notes = 'Recovery survives a missing original';
        fs.writeFileSync(recovery, JSON.stringify(record));
        fs.renameSync(original, path.join(temp, 'moved.statlab.json'));
      }
      if (phase === 'legacy') fs.rmSync(recovery, { force: true });
      if (phase === 'corrupt') fs.writeFileSync(recovery, '{broken recovery metadata');
      const env = { ...process.env, STATLAB_SESSION_TEST_ROOT: temp, STATLAB_SESSION_TEST_PHASE: phase };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(electron, [__filename], { env, encoding: 'utf8', timeout: 30000 });
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      assert.ifError(result.error);
      assert.strictEqual(result.status, 0, 'Desktop session phase failed: ' + phase);
    }
    console.log('\nNative project-session restart checks passed');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow, Menu, dialog } = require('electron');
  const temp = process.env.STATLAB_SESSION_TEST_ROOT;
  const phase = process.env.STATLAB_SESSION_TEST_PHASE;
  const original = path.join(temp, 'original.statlab.json');
  const copy = path.join(temp, 'other', 'original.statlab.json');
  const profile = path.join(temp, 'profile');
  const recovery = path.join(profile, 'project-recovery.json');
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  let win, saveDialogs = 0, saveDestination = null, openPath = original, exercising = false;
  const errors = [];
  const inputWindows = new WeakSet();
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [openPath] });
  dialog.showSaveDialog = async () => { saveDialogs++; return { canceled: !saveDestination, filePath: saveDestination }; };
  dialog.showErrorBox = (title, message) => errors.push(title + ': ' + message);
  const run = (code) => win.webContents.executeJavaScript(code, true);
  const state = async () => JSON.parse(await run('window.StatLab.getStateJSON()'));
  const ok = (name, value) => { assert.ok(value, name); console.log('PASS', name); };
  const record = () => JSON.parse(fs.readFileSync(recovery, 'utf8'));
  const filename = () => run(`document.querySelector('#project-file').textContent`);
  async function waitFor(condition, name) {
    const deadline = Date.now() + 5000;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + name);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  async function notes(text) {
    await run(`(() => {
      const input = document.querySelector('.notes-area');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  }
  async function replaceFirstCell(text, commit = true) {
    await run(`document.querySelector('#nav-tables .nav-item[data-view="data"]').click()`);
    const before = (await state()).tables[0].rows;
    if (!inputWindows.has(win)) { win.webContents.debugger.attach('1.3'); inputWindows.add(win); }
    const point = await run(`(() => {
      const cell = document.querySelector('td.dcell[data-r="0"][data-c="0"]');
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const rect = cell.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point });
    }
    let prefix = '';
    for (const ch of text) {
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      prefix += ch;
      assert.deepStrictEqual(await run(`(() => {
        const input = document.querySelector('input.celledit');
        return { value: input.value, start: input.selectionStart, end: input.selectionEnd };
      })()`), { value: prefix, start: prefix.length, end: prefix.length }, 'native replacement keeps its exact string and caret order');
    }
    assert.deepStrictEqual((await state()).tables[0].rows, before, 'a replacement draft remains uncommitted until Enter or explicit Save');
    if (commit) {
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 });
      const expected = before.map((row) => row.slice()); expected[0][0] = text;
      assert.deepStrictEqual((await state()).tables[0].rows, expected, 'committing a replacement changes only the targeted raw cell');
    }
  }
  async function waitForAutosave() {
    await waitFor(async () => run(`(() => {
      const raw = localStorage.getItem('statlab_state');
      if (!raw) return false;
      const stored = JSON.parse(raw); delete stored._desktopRecovery;
      return JSON.stringify(stored) === JSON.stringify(JSON.parse(window.StatLab.getStateJSON()));
    })()`), 'autosaved project');
    // Observe the real debounced checkpoint, not a test-triggered replacement.
    if (await run(`typeof window.desktop.checkpointSession === 'function'`)) {
      const expected = JSON.stringify(await state());
      await waitFor(() => fs.existsSync(recovery) && JSON.stringify(record().state) === expected, 'native paired recovery');
    }
    win.webContents.session.flushStorageData();
  }
  app.on('browser-window-created', (_event, created) => {
    win = created;
    created.hide();
    created.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
    created.webContents.once('did-finish-load', () => {
      if (!exercising) { exercising = true; exercise().catch(fail); }
    });
  });
  const fail = (error) => {
    console.error(error);
    errors.forEach((message) => console.error('Renderer/native error:', message));
    app.exit(1);
  };
  const timeout = setTimeout(() => fail(new Error('Desktop session test timed out')), 25000);
  async function restore() {
    await waitFor(async () => run(`!document.querySelector('#modal-restore').hidden`), 'Restore prompt');
    await run(`document.querySelector('#restore-yes').click()`);
    await waitFor(async () => run(`document.querySelector('#modal-restore').hidden && !document.querySelector('#restore-yes').disabled`), 'completed restore');
  }
  async function drop(json) {
    await run(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(json)}], 'dropped.json', { type: 'application/json' }));
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    })()`);
  }
  async function saveAsChecks() {
    const previousState = await state();
    const checkpointBefore = fs.readFileSync(recovery, 'utf8');
    for (const [name, graphs, active] of [
      ['invalid structure', { invalid: 'not an array' }, previousState.active],
      ['failed hydration', [null], previousState.active],
      ['failed rendering', [{ id: 'bad-graph', name: 'Broken', spec: null }], { view: 'graph', id: 'bad-graph' }],
    ]) {
      const malformed = JSON.stringify({ ...previousState,
        tables: previousState.tables.map((table) => ({ ...table, notes: 'Must not replace live data' })), graphs, active,
      });
      ok(name + ' replacement is rejected', await run(`window.desktop.replaceProject(${JSON.stringify(malformed)})`) === false);
      ok(name + ' preserves live data, rendering, and its file association', JSON.stringify(await state()) === JSON.stringify(previousState) && record().filePath === original && fs.readFileSync(recovery, 'utf8') === checkpointBefore && await run(`!!document.querySelector('.notes-area')`));
    }
    const before = fs.readFileSync(original, 'utf8');
    await run('window.desktop.saveProjectAs()');
    ok('canceled Save As preserves the original association', await filename() === 'original.statlab.json' && record().filePath === original);
    saveDestination = path.join(temp, 'missing-directory', 'failed.json');
    await run('window.desktop.saveProjectAs()');
    ok('failed Save As reports the failure and preserves the original association', errors.pop()?.startsWith('Save failed:') && record().filePath === original);
    saveDestination = null;
    await notes('Work retained after an injected write failure');
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      if (file === original) throw new Error('Injected project write failure');
      return write(file, ...args);
    };
    try { await run('window.desktop.saveProject()'); }
    finally { fs.writeFileSync = write; }
    ok('failed ordinary Save retains edits and does not claim success', errors.pop()?.includes('Injected project write failure') && (await state()).tables[0].notes === 'Work retained after an injected write failure' && fs.readFileSync(original, 'utf8') === before);
    await run('window.desktop.saveProject()');
    const oldToken = await run('window.StatLabApp.projectSessionToken');
    const oldJSON = await run('window.StatLab.getStateJSON()');
    fs.mkdirSync(path.dirname(copy));
    saveDestination = copy;
    await replaceFirstCell('9.87e-6', false);
    await run('window.desktop.saveProjectAs()');
    saveDestination = null;
    ok('Save As checkpoints the exact new directory even with an identical basename', record().filePath === copy && fs.existsSync(copy));
    ok('Save As includes the visible replacement draft without modifying the original file', JSON.parse(fs.readFileSync(copy, 'utf8')).tables[0].rows[0][0] === '9.87e-6' && JSON.parse(fs.readFileSync(original, 'utf8')).tables[0].rows[0][0] === '-12.34');
    const saved = fs.readFileSync(recovery, 'utf8');
    ok('an earlier workspace checkpoint cannot replace the new association', await run(`window.desktop.checkpointSession(${JSON.stringify(oldJSON)}, ${JSON.stringify(oldToken)})`) === false && fs.readFileSync(recovery, 'utf8') === saved);
    const portable = JSON.parse(fs.readFileSync(copy, 'utf8'));
    ok('portable JSON contains neither native paths nor recovery metadata', !JSON.stringify(portable).includes(temp) && !Object.hasOwn(portable, 'projectSessionToken') && !Object.hasOwn(portable, '_desktopRecovery'));
  }
  async function browserChecks() {
    const nativeWindow = win;
    const browser = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, partition: 'browser-session-test' } });
    try {
      await browser.loadFile(path.join(__dirname, '..', 'index.html'));
      ok('browser-only rendering does not depend on the desktop bridge', await run(`!window.desktop`));
      const dropped = JSON.parse(fs.readFileSync(copy, 'utf8'));
      dropped.tables[0].notes = 'Browser dropped work';
      // Model browser-granted handles without opening real browser file pickers.
      const picker = `(() => {
        window.pickerCalls = 0; window.writtenProject = null;
        window.showSaveFilePicker = async () => {
          window.pickerCalls++;
          return { name: 'browser-copy.json', createWritable: async () => ({
            write: async (text) => { window.writtenProject = text; }, close: async () => {},
          }) };
        };
      })()`;
      await run(picker);
      await run(`(() => {
        window.previousWrites = 0;
        window.StatLabApp.projectFileName = 'previous.json';
        window.StatLabApp.projectFileHandle = { createWritable: async () => {
          window.previousWrites++; return { write: async () => {}, close: async () => {} };
        } };
      })()`);
      await drop(JSON.stringify(dropped));
      await waitFor(async () => (await state()).tables[0]?.notes === 'Browser dropped work', 'browser JSON drop');
      ok('browser JSON drop clears an earlier writable handle', await run(`window.StatLabApp.projectFileHandle === null`));
      await run(`document.querySelector('#btn-save').click()`);
      await waitFor(async () => run('!!window.writtenProject'), 'browser Save As');
      ok('browser Save after replacement chooses a new handle instead of writing the old one', await run(`window.pickerCalls === 1 && window.previousWrites === 0 && JSON.parse(window.writtenProject).tables[0].notes === 'Browser dropped work'`));
      await waitFor(async () => run(`localStorage.getItem('statlab_state') && JSON.parse(localStorage.getItem('statlab_state')).tables[0].notes === 'Browser dropped work'`), 'browser autosave');
      await browser.loadFile(path.join(__dirname, '..', 'index.html'));
      await restore();
      await run(picker);
      await run(`document.querySelector('#btn-save').click()`);
      await waitFor(async () => run('!!window.writtenProject'), 'browser restored Save As');
      ok('browser recovery requires a newly granted writable handle', await run('window.pickerCalls === 1'));
    } finally { browser.destroy(); win = nativeWindow; }
  }
  async function exercise() {
    await waitFor(async () => run('!!window.StatLabApp.projectSessionToken'), 'native session initialized');
    if (phase === 'seed') {
      await run('window.desktop.openProject()');
      ok('native Open shows the source filename', await run(`document.querySelector('#project-file').textContent === 'original.statlab.json'`));
      ok('native Open checkpoints the association before any edit', record().filePath === original && record().state.tables.length === 1);
      await replaceFirstCell('1234');
      await notes('Recovered edit before restart');
      await waitForAutosave();
      ok('native typed replacement reaches paired recovery in the correct order', record().state.tables[0].rows[0][0] === '1234');
      ok('autosave does not implicitly overwrite the source project', JSON.parse(fs.readFileSync(original, 'utf8')).tables[0].notes !== 'Recovered edit before restart');
    } else if (phase === 'restore') {
      await waitFor(async () => run(`!document.querySelector('#modal-restore').hidden`), 'Restore prompt');
      ok('startup does not bind the saved destination before Restore', await filename() === 'Unsaved project');
      ok('an unrecognized recovery ID cannot bind a file', !(await run(`window.desktop.restoreSession('not-the-offered-record')`)).restored);
      const before = fs.readFileSync(original, 'utf8');
      if (process.env.STATLAB_SESSION_SCREENSHOTS) {
        fs.mkdirSync(process.env.STATLAB_SESSION_SCREENSHOTS, { recursive: true });
        await run('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(process.env.STATLAB_SESSION_SCREENSHOTS, 'restore-prompt.png'), (await win.webContents.capturePage()).toPNG());
      }
      ok('recovery summary names the file without overflowing the dialog', await run(`(() => { const summary = document.querySelector('#restore-summary'); return summary.textContent.includes('original.statlab.json') && summary.scrollWidth <= summary.clientWidth && document.querySelector('#restore-yes').checkVisibility(); })()`));
      await restore();
      await waitFor(async () => (await state()).tables[0]?.notes === 'Recovered edit before restart', 'restored data');
      ok('a full app restart preserves the exact typed replacement', (await state()).tables[0].rows[0][0] === '1234');
      ok('Restore itself does not overwrite the project file', fs.readFileSync(original, 'utf8') === before);
      await notes('Recovered edit, then saved after restart');
      await replaceFirstCell('-12.34', false);
      const fileMenu = Menu.getApplicationMenu().items.find((item) => item.label === 'File').submenu;
      fileMenu.items.find((item) => item.label === 'Save Project').click();
      await waitFor(() => JSON.parse(fs.readFileSync(original, 'utf8')).tables[0].rows[0][0] === '-12.34', 'native menu saves the visible replacement');
      await waitForAutosave();
      ok('Save after a full restart does not ask for a new destination', saveDialogs === 0);
      ok('Save after Restore updates the original JSON file', JSON.parse(fs.readFileSync(original, 'utf8')).tables[0].notes === 'Recovered edit, then saved after restart');
      ok('native Save commits the visible replacement draft into the original file', JSON.parse(fs.readFileSync(original, 'utf8')).tables[0].rows[0][0] === '-12.34' && (await state()).tables[0].rows[0][0] === '-12.34' && await run(`!document.querySelector('input.celledit')`));
      ok('Restore reinstates the project filename and title', await run(`document.querySelector('#project-file').textContent === 'original.statlab.json'`) && win.getTitle().includes('original.statlab.json'));
      ok('ordinary Save creates no extra project file', fs.readdirSync(temp).filter((file) => file.endsWith('.json')).length === 1);
      await saveAsChecks();
    } else if (phase === 'restore-copy') {
      await restore();
      const before = fs.readFileSync(original, 'utf8');
      await notes('Saved to the Save As copy after another restart');
      // Exercise the actual native File menu as well as the toolbar bridge.
      const fileMenu = Menu.getApplicationMenu().items.find((item) => item.label === 'File').submenu;
      await fileMenu.items.find((item) => item.label === 'Save Project').click();
      await waitFor(() => JSON.parse(fs.readFileSync(copy, 'utf8')).tables[0].notes === 'Saved to the Save As copy after another restart', 'native menu save');
      ok('native menu Save after relaunch updates only the Save As destination', saveDialogs === 0 && JSON.parse(fs.readFileSync(copy, 'utf8')).tables[0].notes === 'Saved to the Save As copy after another restart' && fs.readFileSync(original, 'utf8') === before);
      const copyBefore = fs.readFileSync(copy, 'utf8');
      const dropped = await state(); dropped.tables[0].notes = 'Dropped workspace';
      await drop(JSON.stringify(dropped));
      await waitFor(async () => (await state()).tables[0].notes === 'Dropped workspace' && await filename() === 'Unsaved project', 'dropped project detached');
      await run('window.desktop.saveProject()');
      ok('JSON drag-and-drop cannot overwrite the previously open project', saveDialogs === 1 && fs.readFileSync(copy, 'utf8') === copyBefore && record().filePath === null);
      openPath = copy;
      await run('window.desktop.openProject()');
    } else if (phase === 'checkpoint-failure-seed') {
      await restore();
      await waitForAutosave();
      const before = fs.readFileSync(recovery, 'utf8');
      const rename = fs.renameSync;
      let failures = 0;
      fs.renameSync = (source, destination) => {
        if (destination === recovery) { failures++; throw new Error('Injected recovery EACCES'); }
        return rename(source, destination);
      };
      try {
        await notes('LATEST work despite failed native checkpoints');
        await waitFor(async () => failures > 0 && await run(`JSON.parse(localStorage.getItem('statlab_state')).tables[0].notes === 'LATEST work despite failed native checkpoints'`), 'failed native checkpoint with a successful local backup');
        await run('window.desktop.saveProject()');
        ok('explicit Save can succeed even while native recovery writes fail', JSON.parse(fs.readFileSync(copy, 'utf8')).tables[0].notes === 'LATEST work despite failed native checkpoints' && fs.readFileSync(recovery, 'utf8') === before);
        ok('native recovery failure is reported separately from a successful project save', errors.pop()?.includes('Recovery autosave failed:'));
        win.webContents.session.flushStorageData();
      } finally { fs.renameSync = rename; }
    } else if (phase === 'checkpoint-failure-restore') {
      await restore();
      ok('newer local recovery wins over an older native checkpoint after restart', (await state()).tables[0].notes === 'LATEST work despite failed native checkpoints');
      ok('fallback recovery never inherits the stale native file association', await filename() === 'Unsaved project' && record().filePath === null);
      const before = fs.readFileSync(copy, 'utf8');
      await run('window.desktop.saveProject()');
      ok('fallback Save cannot overwrite the newer explicitly saved project', saveDialogs === 1 && fs.readFileSync(copy, 'utf8') === before);
      // An intentionally emptied workspace is still a newer backup, not an
      // invitation to resurrect the preceding nonempty native snapshot.
      const empty = { tables: [], results: [], graphs: [],
        _desktopRecovery: { checkpointId: 'newer-empty-checkpoint', baseCheckpointId: record().checkpointId } };
      await run(`localStorage.setItem('statlab_state', ${JSON.stringify(JSON.stringify(empty))})`);
      await win.loadFile(path.join(__dirname, '..', 'index.html'));
      await restore();
      ok('a newer empty fallback does not resurrect deleted tables', (await state()).tables.length === 0 && record().filePath === null);
      const staleBackup = await run(`localStorage.getItem('statlab_state')`);
      openPath = copy;
      await run('window.desktop.openProject()');
      // Simulate unavailable browser storage during that successful native Open.
      await run(`localStorage.setItem('statlab_state', ${JSON.stringify(staleBackup)})`);
      await win.loadFile(path.join(__dirname, '..', 'index.html'));
      await restore();
      ok('a newer successful native checkpoint wins over an older local backup', (await state()).tables[0].notes === 'LATEST work despite failed native checkpoints' && await filename() === 'original.statlab.json');
    } else if (phase === 'start-fresh') {
      await waitFor(async () => run(`!document.querySelector('#modal-restore').hidden`), 'Restore prompt');
      const before = fs.readFileSync(recovery, 'utf8');
      const projectBefore = fs.readFileSync(copy, 'utf8');
      await run(`document.querySelector('#restore-fresh').click()`);
      await waitFor(async () => run(`document.querySelector('#modal-restore').hidden && !document.querySelector('#restore-fresh').disabled`), 'Start fresh');
      ok('Start fresh preserves the previous recovery until new work exists', fs.readFileSync(recovery, 'utf8') === before && (await state()).tables.length === 0 && await filename() === 'Unsaved project');
      await run(`document.querySelector('#btn-new').click()`);
      await notes('Never-saved work');
      await waitForAutosave();
      await run('window.desktop.saveProject()');
      ok('fresh work requires a destination and leaves the old project untouched', saveDialogs === 1 && fs.readFileSync(copy, 'utf8') === projectBefore && record().filePath === null);
    } else if (phase === 'restore-unsaved') {
      await restore();
      ok('never-saved work survives a full restart without acquiring a path', (await state()).tables[0].notes === 'Never-saved work' && await filename() === 'Unsaved project');
      await run('window.desktop.saveProject()');
      ok('restored never-saved work still uses Save As', saveDialogs === 1);
    } else if (phase === 'missing') {
      await restore();
      ok('missing-original recovery retains edits and explains the Save As fallback', (await state()).tables[0].notes === 'Recovery survives a missing original' && await filename() === 'Unsaved project' && await run(`document.querySelector('#toast').textContent.includes('Original project file not found')`));
      await run('window.desktop.saveProject()');
      ok('Save does not silently recreate a missing original', saveDialogs === 1 && !fs.existsSync(original));
    } else if (phase === 'legacy' || phase === 'corrupt') {
      const legacy = JSON.parse(fs.readFileSync(copy, 'utf8'));
      legacy.tables[0].notes = 'Legacy browser autosave';
      await run(`localStorage.setItem('statlab_state', ${JSON.stringify(JSON.stringify(legacy))})`);
      await win.loadFile(path.join(__dirname, '..', 'index.html'));
      await restore();
      await run('window.desktop.saveProject()');
      ok(phase + ' recovery restores data but never guesses a destination', (await state()).tables[0].notes === 'Legacy browser autosave' && saveDialogs === 1 && record().filePath === null);
    } else if (phase === 'window-recreate') {
      openPath = copy;
      await run('window.desktop.openProject()');
      // Simulate macOS keeping the main process alive after the last window closes.
      app.removeAllListeners('window-all-closed');
      win.destroy();
      app.emit('activate');
      await waitFor(async () => !win.isDestroyed() && await run(`!!window.StatLabApp?.projectSessionToken && !document.querySelector('#modal-restore').hidden`).catch(() => false), 'new native window');
      await run('window.desktop.saveProject()');
      ok('a newly created window cannot use the old window destination before Restore', saveDialogs === 1 && await filename() === 'Unsaved project');
      await restore();
      await notes('Saved after native window recreation');
      await run('window.desktop.saveProject()');
      ok('Restore reconnects the correct destination in a recreated native window', saveDialogs === 1 && JSON.parse(fs.readFileSync(copy, 'utf8')).tables[0].notes === 'Saved after native window recreation');
    } else if (phase === 'window-transition' || phase === 'reload-transition') {
      openPath = copy;
      await run('window.desktop.openProject()');
      const before = fs.readFileSync(recovery, 'utf8');
      let finishDialog;
      dialog.showSaveDialog = () => new Promise((resolve) => { finishDialog = resolve; });
      // Destroying a frame can leave executeJavaScript's promise unsettled;
      // observe the replacement session and disk state instead of awaiting it.
      run('window.desktop.saveProjectAs()').catch(() => null);
      await waitFor(() => !!finishDialog, 'pending Save As dialog');
      if (phase === 'window-transition') {
        app.removeAllListeners('window-all-closed');
        win.destroy();
        app.emit('activate');
      } else await win.loadFile(path.join(__dirname, '..', 'index.html'));
      await waitFor(async () => !win.isDestroyed() && await run('!!window.StatLab').catch(() => false), 'replacement window loaded');
      const lateSave = path.join(temp, 'late-save.json');
      finishDialog({ canceled: false, filePath: lateSave });
      await waitFor(async () => run('!!window.StatLabApp.projectSessionToken'), 'replacement window session');
      ok(phase + ': a late dialog cannot write a file or replace recovery', !fs.existsSync(lateSave) && fs.readFileSync(recovery, 'utf8') === before);
      await restore();
      ok('the replacement window restores the preserved workspace, not an empty checkpoint', (await state()).tables.length === 1 && (await state()).tables[0].notes === 'Saved after native window recreation');
    } else if (phase === 'browser') {
      await browserChecks();
    }
    ok(phase + ' has no renderer or native errors', errors.length === 0);
    clearTimeout(timeout);
    if (phase !== 'browser' && phase !== 'checkpoint-failure-seed') await waitForAutosave();
    win.destroy();
    app.exit(0);
  }
  require('../electron/main.js');
}
