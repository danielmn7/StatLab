// StatLab — preload. Exposes a tiny, safe bridge so the in-app toolbar buttons
// can trigger the same native save/open handlers as the File menu.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  saveProject: () => ipcRenderer.invoke('project:save'),
  saveProjectAs: () => ipcRenderer.invoke('project:saveAs'),
  openProject: () => ipcRenderer.invoke('project:open'),
});
