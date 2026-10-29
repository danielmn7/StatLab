// Exercise the real desktop window-open policy without opening a browser.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const Guidance = require('../js/guidance.js');
let handler;
const opened = [];
const electron = {
  app: { whenReady: () => ({ then: (fn) => fn() }), on: () => {} },
  BrowserWindow: class {
    constructor() { this.webContents = { setWindowOpenHandler: (fn) => { handler = fn; }, on: () => {} }; }
    loadFile() {}
  },
  Menu: { buildFromTemplate: (template) => template, setApplicationMenu: () => {} },
  ipcMain: { handle: () => {} },
  shell: { openExternal: (url) => { opened.push(url); } },
};
const filename = path.join(__dirname, '..', 'electron', 'main.js');
const requireMain = createRequire(filename);
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  require: (name) => name === 'electron' ? electron : requireMain(name),
  __dirname: path.dirname(filename), process,
}, { filename });
assert.strictEqual(typeof handler, 'function', 'desktop installs an external-reference policy');
for (const reference of Object.values(Guidance.REFERENCES)) {
  assert.ok(reference.url.startsWith('https://'), 'published references use HTTPS');
  assert.strictEqual(handler({ url: reference.url }).action, 'deny', 'reference never opens a new Electron window');
  assert.strictEqual(opened[opened.length - 1], reference.url, 'reference opens in the system browser');
}
const count = opened.length;
for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'mailto:test@example.com']) {
  assert.strictEqual(handler({ url }).action, 'deny');
}
assert.strictEqual(opened.length, count, 'non-web protocols are not passed to the OS');
console.log('PASS published references open externally; non-web protocols are blocked');
