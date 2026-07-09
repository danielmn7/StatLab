// StatLab — Electron main process. Wraps the web app as a native desktop application.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'StatLab',
    backgroundColor: '#f4f6f9',
    webPreferences: { contextIsolation: true, spellcheck: false },
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  buildMenu();
}

// Run JS in the renderer's page context and get the result back.
function run(js) { return win.webContents.executeJavaScript(js, true); }

async function openProject() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open StatLab project',
    filters: [{ name: 'StatLab Project', extensions: ['json', 'statlab'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return;
  try {
    const text = fs.readFileSync(filePaths[0], 'utf8');
    const ok = await run(`window.StatLab.loadStateJSON(${JSON.stringify(text)})`);
    if (!ok) dialog.showErrorBox('Open failed', 'That file is not a valid StatLab project.');
  } catch (e) { dialog.showErrorBox('Open failed', String(e)); }
}

async function saveProject() {
  const json = await run('window.StatLab.getStateJSON()');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save StatLab project',
    defaultPath: 'project.statlab.json',
    filters: [{ name: 'StatLab Project', extensions: ['json'] }],
  });
  if (canceled || !filePath) return;
  fs.writeFileSync(filePath, json, 'utf8');
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
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: openProject },
        { label: 'Save Project…', accelerator: 'CmdOrCtrl+S', click: saveProject },
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
