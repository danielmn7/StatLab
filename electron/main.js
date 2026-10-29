// StatLab — Electron main process. Wraps the web app as a native desktop application.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { readRecovery, writeRecovery } = require('./project-session');

let win;
// Absolute path of the project file currently being edited, or null when the
// workspace has never been saved. "Save" writes here; "Save As" always prompts.
let currentProjectPath = null;
let workspaceToken = randomUUID();
let offeredRecovery = null;
let projectQueue = Promise.resolve();
let documentVersion = 0;
let lastCheckpointId = null;

function activeContext(context) {
  return context.window === win && !context.window.isDestroyed() && context.documentVersion === documentVersion;
}
function assertContext(context) {
  if (!activeContext(context)) throw new Error('The project window changed during this operation');
}
async function runProject(js, context) {
  assertContext(context);
  const result = await context.window.webContents.executeJavaScript(js, true);
  assertContext(context);
  return result;
}

// Serialize native project transitions and autosave checkpoints. A checkpoint
// carries the renderer's workspace token, so an old IPC message cannot attach
// an old snapshot to the destination of a newly opened project.
function queueProject(operation) {
  const context = { window: win, documentVersion };
  const result = projectQueue.then(() => { assertContext(context); return operation(context); }).catch((e) => {
    // A dialog/IPC response from a destroyed or reloaded document is canceled,
    // never redirected through the mutable global win to its replacement.
    if (!activeContext(context)) return null;
    throw e;
  });
  projectQueue = result.catch(() => {});
  return result;
}
const recoveryFile = () => path.join(app.getPath('userData'), 'project-recovery.json');
async function checkpoint(context, json, token) {
  assertContext(context);
  if (token !== workspaceToken) return false;
  const checkpointId = randomUUID();
  // Stage a path-free local backup with its exact lineage before attempting the
  // native write. If that write fails, startup can recognize the newer fallback
  // without borrowing an older checkpoint's file association or using clocks.
  await runProject(`window.StatLab.stageRecoveryCheckpoint(${JSON.stringify(json)}, ${JSON.stringify(checkpointId)}, ${JSON.stringify(lastCheckpointId)})`, context);
  if (token !== workspaceToken) return false;
  writeRecovery(recoveryFile(), json, currentProjectPath, checkpointId);
  lastCheckpointId = checkpointId;
  return true;
}
async function checkpointCurrent(context) {
  try { await checkpoint(context, await runProject('window.StatLab.getStateJSON()', context), workspaceToken); }
  catch (e) { if (activeContext(context)) dialog.showErrorBox('Recovery autosave failed', 'Your workspace is still open. Use Save to protect your work.\n\n' + String(e)); }
}
function existingProject(filePath) {
  try { return !!filePath && fs.statSync(filePath).isFile(); }
  catch (e) { return false; }
}

function createWindow() {
  documentVersion++;
  currentProjectPath = null;
  workspaceToken = randomUUID();
  offeredRecovery = null;
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'StatLab',
    backgroundColor: '#f4f6f9',
    webPreferences: {
      contextIsolation: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // Published references open in the system browser, never in a new app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const owner = win;
  win.webContents.on('did-start-loading', () => {
    if (owner !== win) return;
    documentVersion++;
    currentProjectPath = null;
    workspaceToken = randomUUID();
    offeredRecovery = null;
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  buildMenu();
}

// Run JS in the renderer's page context and get the result back.
function run(js) { return win.webContents.executeJavaScript(js, true); }

// Record the active project file and reflect its name in the window title and
// the in-app UI. Passing null marks the workspace as an unsaved project.
async function setCurrentProject(filePath, context) {
  assertContext(context);
  currentProjectPath = filePath || null;
  workspaceToken = randomUUID();
  offeredRecovery = null;
  const name = currentProjectPath ? path.basename(currentProjectPath) : null;
  win.setTitle(name ? `StatLab — ${name}` : 'StatLab');
  await runProject(`window.StatLab.setProjectFile(${JSON.stringify(name)}, ${JSON.stringify(workspaceToken)})`, context);
}

async function openProject(context) {
  const { canceled, filePaths } = await dialog.showOpenDialog(context.window, {
    title: 'Open StatLab project',
    filters: [{ name: 'StatLab Project', extensions: ['json', 'statlab'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return;
  try {
    assertContext(context);
    const text = fs.readFileSync(filePaths[0], 'utf8');
    const ok = await runProject(`window.StatLab.loadStateJSON(${JSON.stringify(text)})`, context);
    if (!ok) { dialog.showErrorBox('Open failed', 'That file is not a valid StatLab project.'); return; }
    await setCurrentProject(filePaths[0], context);
    await checkpointCurrent(context);
  } catch (e) { if (activeContext(context)) dialog.showErrorBox('Open failed', String(e)); }
}

// Save to the current project file, or fall back to "Save As" when there isn't
// one yet. Pass forceDialog=true to always prompt for a new location.
async function saveProject(forceDialog, context) {
  let json = await runProject('window.StatLab.getStateJSON()', context);
  let filePath = currentProjectPath;
  if (filePath && !existingProject(filePath)) {
    await setCurrentProject(null, context);
    filePath = null;
  }
  if (forceDialog || !filePath) {
    const res = await dialog.showSaveDialog(context.window, {
      title: forceDialog ? 'Save StatLab project as…' : 'Save StatLab project',
      defaultPath: filePath || 'project.statlab.json',
      filters: [{ name: 'StatLab Project', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return;
    assertContext(context);
    filePath = res.filePath;
    json = await runProject('window.StatLab.getStateJSON()', context);
  }
  try {
    fs.writeFileSync(filePath, json, 'utf8');
    await setCurrentProject(filePath, context);
    await checkpointCurrent(context);
  } catch (e) { if (activeContext(context)) dialog.showErrorBox('Save failed', String(e)); }
}

function saveProjectAs(context) { return saveProject(true, context); }

// Reading recovery metadata never binds its destination. Only accepting this
// exact offered record may reestablish the main process's trusted file path.
async function getSession(context) {
  await setCurrentProject(null, context);
  const record = readRecovery(recoveryFile());
  lastCheckpointId = record ? record.checkpointId : null;
  offeredRecovery = record ? { ...record, id: randomUUID() } : null;
  return {
    token: workspaceToken,
    recovery: offeredRecovery ? {
      id: offeredRecovery.id, state: offeredRecovery.state,
      checkpointId: offeredRecovery.checkpointId,
      name: offeredRecovery.filePath ? path.basename(offeredRecovery.filePath) : null,
    } : null,
  };
}
async function restoreSession(context, id) {
  const record = offeredRecovery;
  if (!record || record.id !== id) return { restored: false };
  const ok = await runProject(`window.StatLab.loadStateJSON(${JSON.stringify(JSON.stringify(record.state))})`, context);
  if (!ok) return { restored: false };
  const missing = !!record.filePath && !existingProject(record.filePath);
  await setCurrentProject(missing ? null : record.filePath, context);
  await checkpointCurrent(context);
  return { restored: true, missing };
}
async function startFresh(context) {
  // Do not checkpoint the empty workspace: preserve the recovery record until
  // the user actually creates new work or explicitly saves it.
  await setCurrentProject(null, context);
}
async function replaceProject(context, json) {
  const ok = await runProject(`window.StatLab.loadStateJSON(${JSON.stringify(json)})`, context);
  if (!ok) return false;
  await setCurrentProject(null, context);
  await checkpointCurrent(context);
  return true;
}

function menuProject(operation) {
  return () => queueProject(operation).catch((e) => dialog.showErrorBox('Project operation failed', String(e)));
}

async function openPrism() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open GraphPad Prism file',
    filters: [{ name: 'GraphPad Prism', extensions: ['prism'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return;
  try {
    const b64 = fs.readFileSync(filePaths[0]).toString('base64');
    const n = await run(`window.StatLab.openPrismBase64(${JSON.stringify(b64)})`);
    if (n < 0) dialog.showErrorBox('Open failed', 'That file could not be read as a .prism file.');
    else win.webContents.focus();
  } catch (e) { dialog.showErrorBox('Open failed', String(e)); }
}

async function importData() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import data (CSV / TSV / text)',
    filters: [{ name: 'Data files', extensions: ['csv', 'tsv', 'txt'] }, { name: 'All files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return;
  const text = fs.readFileSync(filePaths[0], 'utf8');
  const n = await run(`window.StatLab.importText(${JSON.stringify(text)}, 'column')`);
  if (n != null) win.webContents.focus();
}

async function exportFigure() {
  const has = await run('window.StatLab.hasActiveGraph()');
  if (!has) {
    dialog.showMessageBox(win, { type: 'info', message: 'No graph selected', detail: 'Open a graph from the sidebar, then export it.' });
    return;
  }
  const svg = await run('window.StatLab.activeGraphSVG()');
  const name = await run('window.StatLab.activeGraphName()');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export figure as SVG',
    defaultPath: String(name).replace(/\W+/g, '_') + '.svg',
    filters: [{ name: 'SVG image', extensions: ['svg'] }],
  });
  if (canceled || !filePath) return;
  fs.writeFileSync(filePath, svg, 'utf8');
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Table', accelerator: 'CmdOrCtrl+N', click: () => run('window.StatLab.newTable()') },
        { type: 'separator' },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: menuProject(openProject) },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: menuProject((context) => saveProject(false, context)) },
        { label: 'Save Project As…', accelerator: 'CmdOrCtrl+Shift+S', click: menuProject(saveProjectAs) },
        { type: 'separator' },
        { label: 'Open Prism File…', accelerator: 'CmdOrCtrl+Shift+O', click: openPrism },
        { label: 'Import Data…', accelerator: 'CmdOrCtrl+I', click: importData },
        { label: 'Export Figure…', accelerator: 'CmdOrCtrl+E', click: exportFigure },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Analyze',
      submenu: [
        { label: 'Which test should I use?', click: () => run('window.StatLab.openGuide()') },
      ],
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    {
      label: 'Help',
      submenu: [
        { label: 'About StatLab', click: () => dialog.showMessageBox(win, { type: 'info', title: 'StatLab', message: 'StatLab', detail: 'Scientific statistics & figures.\nDesktop edition.' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Toolbar buttons in the renderer call these so the in-app controls share the
// same native save-with-path behaviour as the File menu.
function projectIPC(channel, operation) {
  ipcMain.handle(channel, (event, ...args) => {
    const sender = event.sender;
    const frame = event.senderFrame;
    return queueProject((context) => {
      if (!win || win.isDestroyed() || sender !== win.webContents || frame !== win.webContents.mainFrame) {
        throw new Error('Project request from an inactive window');
      }
      return operation(context, ...args);
    });
  });
}
projectIPC('project:save', (context) => saveProject(false, context));
projectIPC('project:saveAs', saveProjectAs);
projectIPC('project:open', openProject);
projectIPC('session:get', getSession);
projectIPC('session:checkpoint', checkpoint);
projectIPC('session:restore', restoreSession);
projectIPC('session:fresh', startFresh);
projectIPC('project:replace', replaceProject);

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
