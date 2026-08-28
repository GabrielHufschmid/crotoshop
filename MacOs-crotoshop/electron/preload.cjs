const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crotoshopDesktop', {
  platform: process.platform,
  openFiles: (options) => ipcRenderer.invoke('native:open-files', options),
  saveFile: (options) => ipcRenderer.invoke('native:save-file', options),
  chooseDirectory: () => ipcRenderer.invoke('native:choose-directory'),
  writeFile: (options) => ipcRenderer.invoke('native:write-file', options),
  revealFile: (path) => ipcRenderer.invoke('native:reveal-file', path),
  readFile: (path) => ipcRenderer.invoke('native:read-file', path),
  googleFont: (options) => ipcRenderer.invoke('native:google-font', options),
  watchFile: (tabId, path) => ipcRenderer.invoke('native:watch-file', { tabId, path }),
  unwatchFile: (tabId) => ipcRenderer.invoke('native:unwatch-file', tabId),
  removeBackground: (options) => ipcRenderer.invoke('ai:remove-background', options),
  createAiMask: (options) => ipcRenderer.invoke('ai:create-mask', options),
  warmAi: () => ipcRenderer.invoke('ai:warm'),
  cancelAi: () => ipcRenderer.invoke('ai:cancel'),
  setDirty: (dirty) => ipcRenderer.send('document:set-dirty', dirty),
  updateDocumentState: (state) => ipcRenderer.send('document:update-state', state),
  readyForFiles: () => ipcRenderer.send('renderer:ready-for-files'),
  confirmClose: () => ipcRenderer.send('window:confirm-close'),
  onMenuCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  },
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('window:request-save', listener);
    return () => ipcRenderer.removeListener('window:request-save', listener);
  },
  onExternalFileChange: (callback) => {
    const listener = (_event, change) => callback(change);
    ipcRenderer.on('file:changed', listener);
    return () => ipcRenderer.removeListener('file:changed', listener);
  },
  onOpenFiles: (callback) => {
    const listener = (_event, files) => callback(files);
    ipcRenderer.on('file:open-request', listener);
    return () => ipcRenderer.removeListener('file:open-request', listener);
  },
});
