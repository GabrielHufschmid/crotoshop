const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

let mainWindow = null;
let rendererDirty = false;
let forceClose = false;
let aiProcess = null;
let aiSequence = 0;
const aiPending = new Map();
const AI_IDLE_MS = 5 * 60 * 1000;
let aiIdleTimer = null;
let lastOpenDirectory = null;
let lastSaveDirectory = null;
const documentWatches = new Map();
const supportedOpenExtensions = new Set([
  '.crotoshop', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif',
  '.svg', '.pdf', '.eps', '.ps', '.ai',
]);
let rendererReadyForFiles = false;
let deliveringOpenFiles = false;
const pendingOpenPaths = [];
const approvedFilePaths = new Set();
const approvedWriteDirectories = new Set();
const googleFontCache = new Map();

function approvedFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!approvedFilePaths.has(resolved)) throw new Error('El archivo no fue autorizado por el usuario');
  return resolved;
}

function approvedWriteFile(filePath) {
  const resolved = path.resolve(filePath);
  const allowed = [...approvedWriteDirectories].some((directory) => {
    const relative = path.relative(directory, resolved);
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
  });
  if (!allowed) throw new Error('La carpeta de destino no fue autorizada por el usuario');
  return resolved;
}

function commandLineFiles(args) {
  return args.filter((candidate) => {
    if (typeof candidate !== 'string' || !supportedOpenExtensions.has(path.extname(candidate).toLowerCase())) return false;
    try { return fsSync.statSync(candidate).isFile(); } catch { return false; }
  });
}

function queueOpenFiles(filePaths) {
  const known = new Set(pendingOpenPaths);
  for (const candidate of commandLineFiles(filePaths)) {
    const resolved = path.resolve(candidate);
    if (!known.has(resolved)) {
      known.add(resolved);
      pendingOpenPaths.push(resolved);
    }
  }
  void flushOpenFiles();
}

async function flushOpenFiles() {
  if (!rendererReadyForFiles || deliveringOpenFiles || !mainWindow || mainWindow.isDestroyed() || !pendingOpenPaths.length) return;
  deliveringOpenFiles = true;
  const paths = pendingOpenPaths.splice(0);
  try {
    const files = await Promise.all(paths.map(async (filePath) => ({
      name: path.basename(filePath),
      path: filePath,
      data: await fs.readFile(filePath),
    })));
    for (const filePath of paths) {
      approvedFilePaths.add(filePath);
      app.addRecentDocument(filePath);
    }
    mainWindow.webContents.send('file:open-request', files);
  } catch (error) {
    dialog.showErrorBox('No se pudo abrir el archivo', error instanceof Error ? error.message : String(error));
  } finally {
    deliveringOpenFiles = false;
    if (pendingOpenPaths.length) void flushOpenFiles();
  }
}

function stopDocumentWatch(tabId) {
  const existing = documentWatches.get(tabId);
  if (!existing) return;
  fsSync.unwatchFile(existing.path, existing.listener);
  documentWatches.delete(tabId);
}

function stopAllDocumentWatches() {
  for (const tabId of documentWatches.keys()) stopDocumentWatch(tabId);
}

function ignoreOwnFileChange(filePath) {
  const resolved = path.resolve(filePath);
  for (const watched of documentWatches.values()) {
    if (watched.path === resolved) watched.ignoreUntil = Date.now() + 1800;
  }
}

async function writeFileAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function sendMenu(command) {
  mainWindow?.webContents.send('menu:command', command);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Preferencias…', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('settings') },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new') },
        { label: 'Abrir…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { label: 'Abrir proyecto…', accelerator: 'CmdOrCtrl+Alt+O', click: () => sendMenu('open-project') },
        ...(isMac ? [{ label: 'Abrir recientes', role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] }] : []),
        { type: 'separator' },
        { id: 'file-save', label: 'Guardar', accelerator: 'CmdOrCtrl+S', enabled: false, click: () => sendMenu('save') },
        { id: 'file-save-as', label: 'Guardar como…', accelerator: 'CmdOrCtrl+Shift+S', enabled: false, click: () => sendMenu('save-as') },
        { id: 'file-export', label: 'Exportar…', accelerator: 'CmdOrCtrl+Alt+Shift+W', enabled: false, click: () => sendMenu('export') },
        { type: 'separator' },
        { id: 'file-close', label: 'Cerrar documento', accelerator: 'CmdOrCtrl+W', enabled: false, click: () => sendMenu('close-document') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { id: 'edit-undo', label: 'Deshacer', accelerator: 'CmdOrCtrl+Z', enabled: false, click: () => sendMenu('undo') },
        { id: 'edit-redo', label: 'Rehacer', accelerator: 'CmdOrCtrl+Shift+Z', enabled: false, click: () => sendMenu('redo') },
        { type: 'separator' },
        { id: 'edit-cut', label: 'Cortar', accelerator: 'CmdOrCtrl+X', enabled: false, click: () => sendMenu('cut') },
        { id: 'edit-copy', label: 'Copiar', accelerator: 'CmdOrCtrl+C', enabled: false, click: () => sendMenu('copy') },
        { role: 'paste', label: 'Pegar' },
        { label: 'Pegar en el lugar', accelerator: 'CmdOrCtrl+Shift+V', click: () => sendMenu('paste-in-place') },
      ],
    },
    {
      label: 'Selección',
      submenu: [
        { id: 'selection-all', label: 'Seleccionar todo', accelerator: 'CmdOrCtrl+A', enabled: false, click: () => sendMenu('select-all') },
        { id: 'selection-deselect', label: 'Deseleccionar', accelerator: 'CmdOrCtrl+D', enabled: false, click: () => sendMenu('deselect') },
        { id: 'selection-inverse', label: 'Invertir selección', accelerator: 'CmdOrCtrl+Shift+I', enabled: false, click: () => sendMenu('inverse-selection') },
        { type: 'separator' },
        { id: 'selection-save', label: 'Guardar selección', enabled: false, click: () => sendMenu('save-selection') },
        { id: 'selection-transform', label: 'Transformación libre', accelerator: 'CmdOrCtrl+T', enabled: false, click: () => sendMenu('free-transform') },
      ],
    },
    {
      label: 'Capa',
      submenu: [
        { id: 'layer-new', label: 'Nueva capa', accelerator: 'CmdOrCtrl+Shift+N', enabled: false, click: () => sendMenu('new-layer') },
        { id: 'layer-duplicate', label: 'Duplicar capa', accelerator: 'CmdOrCtrl+J', enabled: false, click: () => sendMenu('duplicate-layer') },
        { type: 'separator' },
        { id: 'layer-add-mask', label: 'Agregar máscara', enabled: false, click: () => sendMenu('add-layer-mask') },
        { id: 'layer-apply-mask', label: 'Aplicar máscara', enabled: false, click: () => sendMenu('apply-layer-mask') },
        { id: 'layer-delete-mask', label: 'Eliminar máscara', enabled: false, click: () => sendMenu('delete-layer-mask') },
        { type: 'separator' },
        { id: 'layer-flip-h', label: 'Espejar horizontalmente', enabled: false, click: () => sendMenu('flip-horizontal') },
        { id: 'layer-flip-v', label: 'Espejar verticalmente', enabled: false, click: () => sendMenu('flip-vertical') },
        { type: 'separator' },
        { label: 'Seleccionar capa inferior', accelerator: 'Alt+[', click: () => sendMenu('select-layer-below') },
        { label: 'Seleccionar capa superior', accelerator: 'Alt+]', click: () => sendMenu('select-layer-above') },
        { label: 'Bajar capa', accelerator: 'CmdOrCtrl+[', click: () => sendMenu('move-layer-down') },
        { label: 'Subir capa', accelerator: 'CmdOrCtrl+]', click: () => sendMenu('move-layer-up') },
        { type: 'separator' },
        { label: 'Combinar hacia abajo', accelerator: 'CmdOrCtrl+E', click: () => sendMenu('merge-down') },
        { label: 'Combinar visibles', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendMenu('merge-visible') },
      ],
    },
    {
      label: 'Objeto',
      submenu: [
        { id: 'object-edit-nodes', label: 'Editar nodos', accelerator: 'A', enabled: false, click: () => sendMenu('edit-vector-nodes') },
        { id: 'object-text-curves', label: 'Convertir texto a curvas', accelerator: 'CmdOrCtrl+Shift+O', enabled: false, click: () => sendMenu('text-to-curves') },
        { id: 'object-expand', label: 'Expandir vector colocado', enabled: false, click: () => sendMenu('expand-vector') },
        { id: 'object-vectorize', label: 'Vectorizar imagen…', enabled: false, click: () => sendMenu('vectorize-layer') },
        { type: 'separator' },
        {
          label: 'Pathfinder',
          submenu: [
            { id: 'pathfinder-unite', label: 'Unir', enabled: false, click: () => sendMenu('pathfinder-unite') },
            { id: 'pathfinder-subtract', label: 'Restar frente', enabled: false, click: () => sendMenu('pathfinder-subtract') },
            { id: 'pathfinder-intersect', label: 'Intersectar', enabled: false, click: () => sendMenu('pathfinder-intersect') },
            { id: 'pathfinder-exclude', label: 'Excluir', enabled: false, click: () => sendMenu('pathfinder-exclude') },
          ],
        },
      ],
    },
    {
      label: 'Imagen',
      submenu: [
        { label: 'Quitar fondo con IA', click: () => sendMenu('remove-background') },
        { label: 'Redimensionar lienzo…', click: () => sendMenu('resize') },
      ],
    },
    {
      label: 'Vista',
      submenu: [
        { role: 'reload', visible: !app.isPackaged },
        { role: 'toggleDevTools', visible: !app.isPackaged },
        { type: 'separator', visible: !app.isPackaged },
        { label: 'Píxeles reales', accelerator: 'CmdOrCtrl+1', click: () => sendMenu('actual-pixels') },
        { label: 'Encajar en pantalla', accelerator: 'CmdOrCtrl+0', click: () => sendMenu('fit-view') },
        { label: 'Acercar', accelerator: 'CmdOrCtrl+=', click: () => sendMenu('zoom-in') },
        { label: 'Alejar', accelerator: 'CmdOrCtrl+-', click: () => sendMenu('zoom-out') },
        { type: 'separator' },
        { label: 'Mostrar/ocultar paneles', accelerator: 'Tab', click: () => sendMenu('toggle-panels') },
        { label: 'Color', accelerator: 'F6', click: () => sendMenu('toggle-color-panel') },
        { label: 'Capas', accelerator: 'F7', click: () => sendMenu('toggle-layers-panel') },
        { label: 'Mostrar/ocultar guías', accelerator: 'CmdOrCtrl+;', click: () => sendMenu('toggle-guides') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
    { label: 'Ventana', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  forceClose = false;
  rendererDirty = false;
  rendererReadyForFiles = false;
  mainWindow = new BrowserWindow({
    minWidth: 980,
    minHeight: 680,
    width: 1480,
    height: 960,
    backgroundColor: '#111214',
    title: 'Crotoshop',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const revealWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    mainWindow.maximize();
    mainWindow.show();
  };
  mainWindow.once('ready-to-show', revealWindow);
  mainWindow.webContents.once('did-finish-load', () => setTimeout(revealWindow, 100));
  const load = app.isPackaged
    ? mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
    : mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
  void load.catch((error) => dialog.showErrorBox('No se pudo iniciar Crotoshop', error.message));

  mainWindow.on('closed', () => {
    rendererReadyForFiles = false;
    rendererDirty = false;
    stopAllDocumentWatches();
    stopAiBackend();
    mainWindow = null;
  });

  mainWindow.on('close', async (event) => {
    if (forceClose || !rendererDirty) return;
    event.preventDefault();
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Cambios sin guardar',
      message: 'Hay documentos con cambios sin guardar.',
      detail: '¿Querés guardar todos los documentos pendientes antes de cerrar Crotoshop?',
      buttons: ['Guardar', 'No guardar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
    });
    if (result.response === 0) mainWindow.webContents.send('window:request-save');
    if (result.response === 1) {
      forceClose = true;
      mainWindow.close();
    }
  });
}

function fileFilters(kind) {
  if (kind === 'project') return [{ name: 'Proyecto Crotoshop', extensions: ['crotoshop'] }];
  if (kind === 'palette') return [{ name: 'Paleta Crotoshop', extensions: ['crotopalette'] }];
  const media = {
    name: 'Imágenes y documentos',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'pdf', 'eps', 'ps', 'ai'],
  };
  if (kind === 'media') return [media, { name: 'Todos los archivos', extensions: ['*'] }];
  return [
    { name: 'Archivos compatibles', extensions: [...media.extensions, 'crotoshop'] },
    { name: 'Todos los archivos', extensions: ['*'] },
  ];
}

ipcMain.handle('native:open-files', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', ...(options.multiple === false ? [] : ['multiSelections'])],
    filters: fileFilters(options.kind),
    defaultPath: lastOpenDirectory || undefined,
  });
  if (result.canceled) return [];
  lastOpenDirectory = path.dirname(result.filePaths[0]);
  for (const filePath of result.filePaths) {
    approvedFilePaths.add(path.resolve(filePath));
    app.addRecentDocument(filePath);
  }
  return Promise.all(result.filePaths.map(async (filePath) => ({
    name: path.basename(filePath),
    path: filePath,
    data: await fs.readFile(filePath),
  })));
});

ipcMain.handle('native:save-file', async (_event, options) => {
  let filePath = options.path;
  if (filePath) filePath = approvedFile(filePath);
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: lastSaveDirectory ? path.join(lastSaveDirectory, options.suggestedName) : options.suggestedName,
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    filePath = path.resolve(result.filePath);
    approvedFilePaths.add(filePath);
  }
  await writeFileAtomic(filePath, Buffer.from(options.data));
  ignoreOwnFileChange(filePath);
  lastSaveDirectory = path.dirname(filePath);
  if (path.extname(filePath).toLowerCase() === '.crotoshop') app.addRecentDocument(filePath);
  return { canceled: false, path: filePath };
});

ipcMain.handle('native:choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: lastSaveDirectory || undefined });
  if (result.canceled) return null;
  const directory = path.resolve(result.filePaths[0]);
  approvedWriteDirectories.add(directory);
  lastSaveDirectory = directory;
  return directory;
});

ipcMain.handle('native:write-file', async (_event, options) => {
  const filePath = approvedWriteFile(options.path);
  await writeFileAtomic(filePath, Buffer.from(options.data));
  approvedFilePaths.add(filePath);
  ignoreOwnFileChange(filePath);
  lastSaveDirectory = path.dirname(filePath);
  return filePath;
});

ipcMain.handle('native:reveal-file', (_event, filePath) => shell.showItemInFolder(approvedFile(filePath)));
ipcMain.handle('native:read-file', async (_event, filePath) => fs.readFile(approvedFile(filePath)));

ipcMain.handle('native:google-font', async (_event, options = {}) => {
  const family = typeof options.family === 'string' ? options.family.trim() : '';
  if (!family || family.length > 200 || /[\r\n]/.test(family)) throw new Error('Tipografía inválida');
  const weight = options.bold === true ? 700 : 400;
  const italic = options.italic === true;
  const key = `${family}:${weight}:${italic ? 1 : 0}`;
  let pending = googleFontCache.get(key);
  if (!pending) {
    pending = (async () => {
      const encodedFamily = encodeURIComponent(family).replace(/%20/g, '+');
      const axes = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
      const cssUrl = `https://fonts.googleapis.com/css2?family=${encodedFamily}:${axes}`;
      const cssResponse = await fetch(cssUrl, { headers: { 'user-agent': 'Mozilla/4.0' } });
      if (!cssResponse.ok) throw new Error(`Google Fonts respondió ${cssResponse.status}`);
      const css = await cssResponse.text();
      const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/i);
      if (!match) throw new Error('Google Fonts no devolvió un archivo OpenType compatible');
      const fontResponse = await fetch(match[1]);
      if (!fontResponse.ok) throw new Error(`No se pudo descargar la tipografía (${fontResponse.status})`);
      const data = new Uint8Array(await fontResponse.arrayBuffer());
      if (!data.byteLength || data.byteLength > 32 * 1024 * 1024) throw new Error('Archivo tipográfico inválido');
      return data;
    })();
    googleFontCache.set(key, pending);
    void pending.catch(() => googleFontCache.delete(key));
  }
  return pending;
});
ipcMain.handle('native:watch-file', async (_event, options) => {
  const tabId = typeof options?.tabId === 'string' ? options.tabId : '';
  const filePath = typeof options?.path === 'string' ? approvedFile(options.path) : '';
  if (!tabId || !filePath) throw new Error('Solicitud de vigilancia inválida');
  stopDocumentWatch(tabId);
  const watched = { path: filePath, ignoreUntil: Date.now() + 1200, listener: null };
  watched.listener = (current, previous) => {
    if (Date.now() < watched.ignoreUntil) return;
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
    mainWindow?.webContents.send('file:changed', { tabId, path: filePath });
  };
  documentWatches.set(tabId, watched);
  fsSync.watchFile(filePath, { persistent: false, interval: 1000 }, watched.listener);
  return true;
});
ipcMain.handle('native:unwatch-file', (_event, tabId) => {
  if (typeof tabId === 'string') stopDocumentWatch(tabId);
  return true;
});
ipcMain.on('renderer:ready-for-files', () => {
  rendererReadyForFiles = true;
  void flushOpenFiles();
});
ipcMain.on('document:set-dirty', (_event, dirty) => { rendererDirty = !!dirty; });
ipcMain.on('document:update-state', (_event, state = {}) => {
  rendererDirty = !!state.anyDirty;
  if (!mainWindow) return;
  if (process.platform === 'darwin') mainWindow.setDocumentEdited(!!state.activeDirty);
  mainWindow.setRepresentedFilename(state.path || '');
  const name = typeof state.name === 'string' && state.name.trim() ? state.name.trim() : 'Crotoshop';
  mainWindow.setTitle(name === 'Crotoshop' ? name : `${name} — Crotoshop`);
  const menu = Menu.getApplicationMenu();
  const enable = (id, value) => { const item = menu?.getMenuItemById(id); if (item) item.enabled = !!value; };
  const hasDocument = !!state.hasDocument;
  const hasLayer = !!state.hasActiveLayer;
  const hasSelection = !!state.hasSelection;
  ['file-save', 'file-save-as', 'file-export', 'file-close', 'selection-all', 'layer-new'].forEach((id) => enable(id, hasDocument));
  enable('edit-undo', state.canUndo);
  enable('edit-redo', state.canRedo);
  enable('edit-copy', hasLayer && hasSelection);
  enable('edit-cut', hasLayer && hasSelection);
  enable('selection-deselect', hasSelection);
  enable('selection-inverse', hasSelection);
  enable('selection-save', hasSelection);
  enable('selection-transform', hasSelection || hasLayer);
  ['layer-duplicate', 'layer-flip-h', 'layer-flip-v'].forEach((id) => enable(id, hasLayer));
  enable('layer-add-mask', hasLayer && !state.hasMask);
  enable('layer-apply-mask', hasLayer && state.hasMask);
  enable('layer-delete-mask', hasLayer && state.hasMask);
  enable('object-edit-nodes', state.activeLayerKind === 'vector-editable');
  enable('object-text-curves', state.activeLayerKind === 'text');
  enable('object-expand', state.activeLayerKind === 'vector-placed');
  enable('object-vectorize', state.activeLayerKind === 'raster');
  ['pathfinder-unite', 'pathfinder-subtract', 'pathfinder-intersect', 'pathfinder-exclude']
    .forEach((id) => enable(id, state.selectedEditableVectors >= 2));
  const undoItem = menu?.getMenuItemById('edit-undo');
  const redoItem = menu?.getMenuItemById('edit-redo');
  if (undoItem) undoItem.label = state.undoLabel ? `Deshacer ${state.undoLabel}` : 'Deshacer';
  if (redoItem) redoItem.label = state.redoLabel ? `Rehacer ${state.redoLabel}` : 'Rehacer';
});
ipcMain.on('window:confirm-close', () => {
  forceClose = true;
  mainWindow?.close();
});

function backendCommand() {
  const executable = process.platform === 'win32' ? 'crotoshop-ai.exe' : 'crotoshop-ai';
  if (app.isPackaged) return { command: path.join(process.resourcesPath, 'backend', 'crotoshop-ai', executable), args: [] };
  const script = path.join(__dirname, '..', 'backend', 'crotoshop_ai.py');
  const venvPython = process.platform === 'win32'
    ? path.join(__dirname, '..', 'backend', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', 'backend', '.venv', 'bin', 'python');
  return { command: venvPython, args: [script] };
}

function clearAiIdleTimer() {
  if (aiIdleTimer) clearTimeout(aiIdleTimer);
  aiIdleTimer = null;
}

function stopAiBackend(reason) {
  clearAiIdleTimer();
  const child = aiProcess;
  aiProcess = null;
  if (reason && aiPending.size) {
    const error = new Error(reason);
    for (const pending of aiPending.values()) pending.reject(error);
    aiPending.clear();
  }
  if (child && !child.killed) child.kill();
}

function scheduleAiShutdown() {
  clearAiIdleTimer();
  if (!aiProcess || aiPending.size) return;
  aiIdleTimer = setTimeout(() => {
    if (!aiPending.size) stopAiBackend();
  }, AI_IDLE_MS);
  aiIdleTimer.unref?.();
}

function validateAiImageOptions(options) {
  const width = Number(options?.width);
  const height = Number(options?.height);
  const pixels = options?.pixels;
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 || width > 16_384 || height > 16_384 ||
    width * height > 100_000_000 || !ArrayBuffer.isView(pixels) ||
    pixels.byteLength !== width * height * 4
  ) throw new Error('La imagen enviada al backend de IA no es válida');
  return { width, height, pixels };
}

function startAiBackend() {
  clearAiIdleTimer();
  if (aiProcess && !aiProcess.killed && aiProcess.exitCode === null) return aiProcess;
  const backend = backendCommand();
  const modelHome = app.isPackaged ? path.join(process.resourcesPath, 'backend-models') : path.join(__dirname, '..', 'backend-models');
  const aiCache = path.join(app.getPath('userData'), 'ai-cache');
  const child = spawn(backend.command, backend.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      U2NET_HOME: modelHome,
      CROTOSHOP_AI_CACHE: aiCache,
    },
  });
  aiProcess = child;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const pending = aiPending.get(message.id);
      if (!pending) return;
      aiPending.delete(message.id);
      if (message.ok) pending.resolve(message);
      else pending.reject(new Error(message.error || 'Falló el backend de IA'));
      scheduleAiShutdown();
    } catch { /* backend diagnostics are written to stderr */ }
  });
  child.stderr.on('data', (chunk) => console.error(`[crotoshop-ai] ${chunk}`));
  child.on('error', (error) => {
    for (const pending of aiPending.values()) pending.reject(error);
    aiPending.clear();
    if (aiProcess === child) aiProcess = null;
  });
  child.on('exit', (code, signal) => {
    if (aiProcess === child) aiProcess = null;
    if (aiPending.size) {
      const error = new Error(`El backend de IA se cerró inesperadamente (${signal || code || 'sin código'})`);
      for (const pending of aiPending.values()) pending.reject(error);
      aiPending.clear();
    }
  });
  return child;
}

function askAi(payload, timeoutMs = 180000) {
  const child = startAiBackend();
  const id = ++aiSequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      aiPending.delete(id);
      reject(new Error('El backend de IA tardó demasiado'));
      scheduleAiShutdown();
    }, timeoutMs);
    aiPending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    try {
      child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
    } catch (error) {
      aiPending.delete(id);
      clearTimeout(timer);
      reject(error);
      scheduleAiShutdown();
    }
  });
}

ipcMain.handle('ai:warm', async () => {
  await askAi({ action: 'health' }, 180000);
  return true;
});

ipcMain.handle('ai:cancel', () => {
  stopAiBackend('Operación cancelada');
  return true;
});

ipcMain.handle('ai:remove-background', async (_event, options) => {
  const image = validateAiImageOptions(options);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crotoshop-ai-'));
  const input = path.join(dir, 'input.rgba');
  const output = path.join(dir, 'output.rgba');
  try {
    await fs.writeFile(input, image.pixels);
    await askAi({
      action: 'remove_background',
      format: 'rgba',
      width: image.width,
      height: image.height,
      input,
      output,
    });
    return {
      width: image.width,
      height: image.height,
      pixels: await fs.readFile(output),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

ipcMain.handle('ai:create-mask', async (_event, options) => {
  const image = validateAiImageOptions(options);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crotoshop-mask-'));
  const input = path.join(dir, 'input.rgba');
  const output = path.join(dir, 'mask.alpha');
  try {
    await fs.writeFile(input, image.pixels);
    await askAi({
      action: 'create_ai_mask',
      format: 'rgba',
      width: image.width,
      height: image.height,
      input,
      output,
    });
    return {
      width: image.width,
      height: image.height,
      alpha: await fs.readFile(output),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    queueOpenFiles(commandLine);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    queueOpenFiles([filePath]);
  });
  queueOpenFiles(process.argv.slice(1));
  app.whenReady().then(() => {
    app.setName('Crotoshop');
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
    const trustedRenderer = (url) => url.startsWith('file://') || url.startsWith(devServerUrl);
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => (
      permission === 'local-fonts' && !!webContents && trustedRenderer(webContents.getURL())
    ));
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(permission === 'local-fonts' && trustedRenderer(webContents.getURL()));
    });
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  stopAllDocumentWatches();
  stopAiBackend();
});
