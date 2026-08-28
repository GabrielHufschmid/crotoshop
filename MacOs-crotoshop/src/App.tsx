import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useEditor } from './store/editorStore';
import { useSettings } from './store/settingsStore';
import { TopBar } from './components/TopBar';
import { DocumentTabs } from './components/DocumentTabs';
import { Toolbar } from './components/Toolbar';
import { CanvasStage } from './components/CanvasStage';
import type { StageHandle } from './components/CanvasStage';
import { AdjustmentsPanel } from './components/AdjustmentsPanel';
import { LayersPanel } from './components/LayersPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { PaletteTray } from './components/PaletteTray';
import { StatusBar } from './components/StatusBar';
import { ExportDialog } from './components/dialogs/ExportDialog';
import { ResizeDialog } from './components/dialogs/ResizeDialog';
import { RasterizeDialog } from './components/dialogs/RasterizeDialog';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { TextDialog } from './components/dialogs/TextDialog';
import type { TextTarget } from './components/dialogs/TextDialog';
import { BgRemoveDialog } from './components/dialogs/BgRemoveDialog';
import { NewDocumentDialog } from './components/dialogs/NewDocumentDialog';
import { VectorizeDialog } from './components/dialogs/VectorizeDialog';
import { Modal } from './components/dialogs/Modal';
import { CommandPalette } from './components/CommandPalette';
import { useImport, pickFiles } from './hooks/useImport';
import { ACCEPT } from './engine/import';
import { loadRasterFile } from './engine/import/raster';
import { downloadBlob } from './engine/export';
import { serializeProject, parseProject } from './engine/project';
import { clearRecoveryWorkspace, loadRecoveryWorkspace, saveRecoveryWorkspace } from './engine/recovery';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { removeBg } from './engine/backgroundRemoval';
import { defaultDocumentFileName, fileBaseName } from './engine/fileNames';
import type { Pt } from './types';
import {
  desktop,
  forgetDocument,
  getDocumentSourceName,
  getProjectPath,
  isDesktop,
  nativeFile,
  ownedBuffer,
  saveBlobNative,
  setDocumentSourceName,
  setProjectPath,
} from './desktop/native';

function ProgressOverlay() {
  const busy = useEditor((s) => s.busy);
  const cancelBusy = useEditor((s) => s.cancelBusy);
  if (!busy) return null;
  const pct = busy.fraction >= 0 ? Math.round(busy.fraction * 100) : null;
  return (
    <div className="progress-overlay">
      <div className="progress-card">
        {pct === null && <div className="spinner" />}
        <div className="title">{busy.title}</div>
        <div className="sub">{busy.stage}</div>
        {pct !== null && (
          <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        )}
        {busy.cancellable && <button className="tbtn" onClick={cancelBusy}>Cancelar</button>}
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <span className="toast-tag">{t.kind === 'error' ? 'Error' : 'Listo'}</span>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function discardRecovery(): void {
  void clearRecoveryWorkspace().catch(() => undefined);
}

function focusedTextControl(): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  const element = document.activeElement;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element;
  return element instanceof HTMLElement && element.isContentEditable ? element : null;
}

function runTextEditCommand(command: 'undo' | 'redo' | 'copy' | 'cut' | 'selectAll'): boolean {
  const control = focusedTextControl();
  if (!control) return false;
  if (command === 'selectAll' && 'select' in control) control.select();
  else document.execCommand(command);
  return true;
}

export default function App() {
  const stageRef = useRef<StageHandle>(null);
  const { pending, setPending, open } = useImport();
  const [showExport, setShowExport] = useState(false);
  const [showResize, setShowResize] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newFromClipboard, setNewFromClipboard] = useState(false);
  const [textTarget, setTextTarget] = useState<TextTarget | null>(null);
  const [textEditingLayerId, setTextEditingLayerId] = useState<string | null>(null);
  const [vectorizeLayerId, setVectorizeLayerId] = useState<string | null>(null);
  const [bgResult, setBgResult] = useState<HTMLCanvasElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showPalettes, setShowPalettes] = useState(false);
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [rightPanelHidden, setRightPanelHidden] = useState(false);
  // Drawer del panel lateral (Ajustes/Capas/Historial) en pantallas chicas —
  // en desktop la clase 'open' no hace nada (el panel siempre está visible).
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [closingTabId, setClosingTabId] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState<{ tabId: string; path: string } | null>(null);
  const [recovery, setRecovery] = useState<{ activeIndex: number; tabs: Array<{ id: string; name: string; doc: NonNullable<ReturnType<typeof useEditor.getState>['doc']>; guides: ReturnType<typeof useEditor.getState>['guides']; zoom: number; panX: number; panY: number; dirty?: boolean; sourceName?: string }> } | null>(null);
  const dragCounter = useRef(0);
  const hadDocument = useRef(false);
  const recoveryProjectCache = useRef(new Map<string, { changeId: string; project: Blob }>());

  const setBusy = useEditor((s) => s.setBusy);
  const toast = useEditor((s) => s.toast);
  const trimTransparent = useEditor((s) => s.trimTransparent);
  const doc = useEditor((s) => s.doc);
  const dirty = useEditor((s) => s.dirty);
  const guides = useEditor((s) => s.guides);

  const openProjectFile = useCallback(async (file: File) => {
    const project = await parseProject(file);
    useEditor.getState().openProject(project.name, project.doc, project.guides, project.view);
    const nativePath = (file as File & { nativePath?: string }).nativePath;
    const activeTabId = useEditor.getState().activeTabId;
    setDocumentSourceName(activeTabId, fileBaseName(file.name));
    if (nativePath) setProjectPath(activeTabId, nativePath);
  }, []);

  const openIncomingFiles = useCallback(async (files: File[] | FileList) => {
    const media: File[] = [];
    for (const file of Array.from(files)) {
      if (/\.crotoshop$/i.test(file.name)) {
        try {
          await openProjectFile(file);
        } catch (error) {
          toast(error instanceof Error ? error.message : `No se pudo abrir ${file.name}`, 'error');
        }
      } else {
        media.push(file);
      }
    }
    if (media.length) await open(media, 'document');
  }, [open, openProjectFile, toast]);

  const onImport = useCallback(async () => {
    const files = await pickFiles(`${ACCEPT},.crotoshop`, true, 'all');
    if (files.length) await openIncomingFiles(files);
  }, [openIncomingFiles]);
  const onAddLayer = useCallback(() => {
    const s = useEditor.getState();
    if (!s.doc) {
      toast('Abrí o creá un documento antes de agregar una capa', 'error');
      return;
    }
    s.addEmptyLayer();
  }, [toast]);

  const onFit = useCallback(() => stageRef.current?.fit(), []);
  const onActualPixels = useCallback(() => stageRef.current?.actualPixels(), []);
  const onSaveProject = useCallback(async (saveAs = false): Promise<boolean> => {
    try {
      const s = useEditor.getState();
      if (!s.doc) return false;
      const tabName = s.tabs.find((t) => t.id === s.activeTabId)?.name ?? 'Nueva imagen';
      const suggestedName = `${defaultDocumentFileName(getDocumentSourceName(s.activeTabId))}.crotoshop`;
      const archive = await serializeProject(tabName, s.doc, s.guides, { zoom: s.zoom, panX: s.panX, panY: s.panY });
      if (isDesktop) {
        const result = await saveBlobNative(
          archive,
          suggestedName,
          saveAs ? undefined : getProjectPath(s.activeTabId),
        );
        if (!result || result.canceled || !result.path) return false;
        setProjectPath(s.activeTabId, result.path);
        s.markSaved();
        s.toast(`Guardado en ${result.path}`);
        return true;
      }
      downloadBlob(archive, suggestedName);
      s.markSaved();
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudo guardar el proyecto', 'error');
      return false;
    }
  }, [toast]);
  const onOpenProject = useCallback(async () => {
    const files = await pickFiles('.crotoshop,application/json', false, 'project');
    const file = files[0];
    if (!file) return;
    try {
      await openProjectFile(file);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el proyecto', 'error');
    }
  }, [openProjectFile, toast]);

  const saveAllDirtyProjects = useCallback(async (): Promise<boolean> => {
    try {
      const state = useEditor.getState();
      const dirtyTabs = state.workspaceTabs().filter((tab) => tab.dirty && tab.doc);
      for (const tab of dirtyTabs) {
        const archive = await serializeProject(tab.name, tab.doc!, tab.guides, { zoom: tab.zoom, panX: tab.panX, panY: tab.panY });
        const suggestedName = `${defaultDocumentFileName(getDocumentSourceName(tab.id))}.crotoshop`;
        const result = await saveBlobNative(archive, suggestedName, getProjectPath(tab.id));
        if (!result || result.canceled || !result.path) return false;
        setProjectPath(tab.id, result.path);
        useEditor.getState().markTabSaved(tab.id);
      }
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudieron guardar todos los proyectos', 'error');
      return false;
    }
  }, [toast]);

  const closeTabNow = useCallback((id: string) => {
    forgetDocument(id);
    useEditor.getState().closeTab(id);
    setExternalChange((current) => current?.tabId === id ? null : current);
  }, []);

  const requestCloseTab = useCallback((id: string) => {
    const s = useEditor.getState();
    const tab = s.workspaceTabs().find((candidate) => candidate.id === id);
    if (!tab) return;
    if (!tab.dirty) closeTabNow(id);
    else setClosingTabId(id);
  }, [closeTabNow]);

  const reloadExternalDocument = useCallback(async () => {
    const change = externalChange;
    const native = desktop;
    if (!change || !native) return;
    setBusy({ title: 'Recargando proyecto', stage: 'Leyendo cambios externos…', fraction: -1 });
    try {
      const bytes = await native.readFile(change.path);
      const project = await parseProject(ownedBuffer(bytes));
      useEditor.getState().replaceTabDocument(change.tabId, project.name, project.doc, project.guides, project.view);
      const sourceName = change.path.split(/[\\/]/).pop() ?? project.name;
      setDocumentSourceName(change.tabId, fileBaseName(sourceName));
      setExternalChange(null);
      toast('Proyecto recargado desde disco');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudo recargar el proyecto', 'error');
    } finally {
      setBusy(null);
    }
  }, [externalChange, setBusy, toast]);

  const onRemoveBg = useCallback(async () => {
    const s = useEditor.getState();
    const layer = s.activeLayer();
    if (!layer) { toast('No hay ninguna capa activa', 'error'); return; }
    let canceled = false;
    setBusy(
      { title: 'Quitar fondo', stage: 'Preparando modelo…', fraction: -1, cancellable: true },
      () => { canceled = true; void desktop?.cancelAi().catch(() => undefined); },
    );
    try {
      const out = await removeBg(layer.canvas, (p) =>
        setBusy({ title: 'Quitar fondo', stage: p.stage, fraction: p.fraction }));
      // El resultado no se aplica todavía: se afina y confirma en el diálogo.
      if (!canceled) setBgResult(out);
    } catch (e) {
      if (!canceled) toast(e instanceof Error ? e.message : 'Falló el quitado de fondo', 'error');
    } finally {
      setBusy(null);
    }
  }, [setBusy, toast]);

  const onEditText = useCallback((layerId: string) => {
    const layer = useEditor.getState().doc?.layers.find((candidate) => candidate.id === layerId);
    if (!layer?.text) return;
    if (layer.locked || layer.lockPixels) {
      toast('Desbloqueá la capa para editar el texto', 'error');
      return;
    }
    setTextEditingLayerId(layerId);
    setTextTarget({ kind: 'edit', layerId, sessionId: crypto.randomUUID() });
  }, [toast]);
  const onNewText = useCallback((pt: Pt) => {
    setTextEditingLayerId(null);
    setTextTarget({ kind: 'new', pt, sessionId: crypto.randomUUID() });
  }, []);

  const onNewShortcut = useCallback(() => {
    setNewFromClipboard(false);
    setShowNew(true);
  }, []);
  const onSaveShortcut = useCallback(() => { void onSaveProject(false); }, [onSaveProject]);
  const onSaveAsShortcut = useCallback(() => { void onSaveProject(true); }, [onSaveProject]);
  const onExportShortcut = useCallback(() => setShowExport(true), []);
  const onTogglePanels = useCallback(() => setPanelsHidden((value) => !value), []);
  const onToggleColorPanel = useCallback(() => {
    setPanelsHidden(false);
    setShowPalettes((value) => !value);
  }, []);
  const onToggleLayersPanel = useCallback(() => {
    setPanelsHidden(false);
    setRightPanelHidden((value) => !value);
  }, []);

  useKeyboardShortcuts({
    onNew: onNewShortcut,
    onSave: onSaveShortcut,
    onSaveAs: onSaveAsShortcut,
    onExport: onExportShortcut,
    onImport,
    onFit,
    onActualPixels,
    onTogglePanels,
    onToggleColorPanel,
    onToggleLayersPanel,
  });

  useEffect(() => {
    const native = desktop;
    if (!native) return undefined;
    document.documentElement.classList.add('desktop-app');
    let lastNativeState = '';
    const syncNativeState = () => {
      const state = useEditor.getState();
      const tabs = state.workspaceTabs();
      const active = tabs.find((tab) => tab.id === state.activeTabId);
      const activeLayer = state.activeLayer();
      const activeLayerKind: 'text' | 'vector-placed' | 'vector-editable' | 'raster' | 'group' | 'adjustment' | undefined = activeLayer?.text
        ? 'text'
        : activeLayer?.vector?.kind === 'editable'
          ? 'vector-editable'
          : activeLayer?.vector
            ? 'vector-placed'
            : activeLayer?.kind === 'group'
              ? 'group'
              : activeLayer?.kind === 'adjustment'
                ? 'adjustment'
                : activeLayer
                  ? 'raster'
                  : undefined;
      const payload = {
        name: active?.name ?? 'Crotoshop',
        path: getProjectPath(state.activeTabId),
        activeDirty: !!active?.dirty,
        anyDirty: tabs.some((tab) => tab.dirty),
        hasDocument: !!state.doc,
        hasActiveLayer: !!activeLayer,
        hasSelection: !!state.selection,
        hasMask: !!activeLayer?.mask,
        activeLayerKind,
        selectedEditableVectors: state.doc?.layers.filter((layer) =>
          state.selectedLayerIds.includes(layer.id) && layer.vector?.kind === 'editable').length ?? 0,
        canUndo: state.past.length > 0,
        canRedo: state.future.length > 0,
        undoLabel: state.past.at(-1)?.label,
        redoLabel: state.future.at(-1)?.label,
      };
      const key = JSON.stringify(payload);
      if (key === lastNativeState) return;
      lastNativeState = key;
      native.updateDocumentState(payload);
    };
    syncNativeState();
    const unsubscribeStore = useEditor.subscribe(syncNativeState);
    const unsubscribeMenu = native.onMenuCommand((command) => {
      const s = useEditor.getState();
      if (command === 'new') setShowNew(true);
      else if (command === 'open') void onImport();
      else if (command === 'open-project') void onOpenProject();
      else if (command === 'save') void onSaveProject(false);
      else if (command === 'save-as') void onSaveProject(true);
      else if (command === 'export') setShowExport(true);
      else if (command === 'remove-background') void onRemoveBg();
      else if (command === 'resize') setShowResize(true);
      else if (command === 'paste-in-place') {
        if (!s.pasteInternal(true)) s.toast('Copiá una selección dentro de Crotoshop primero', 'error');
      }
      else if (command === 'undo') { if (!runTextEditCommand('undo')) s.undo(); }
      else if (command === 'redo') { if (!runTextEditCommand('redo')) s.redo(); }
      else if (command === 'copy') {
        if (!runTextEditCommand('copy') && s.selection && s.activeLayer()) void s.copySelection(false);
      }
      else if (command === 'cut') {
        if (!runTextEditCommand('cut') && s.selection && s.activeLayer()) void s.copySelection(true);
      }
      else if (command === 'select-all') { if (!runTextEditCommand('selectAll')) s.selectAllPixels(); }
      else if (command === 'deselect') s.setSelection(null);
      else if (command === 'inverse-selection') s.invertSelection();
      else if (command === 'free-transform') s.setTool('move');
      else if (command === 'save-selection') s.saveSelectionChannel();
      else if (command === 'new-layer') s.addEmptyLayer();
      else if (command === 'duplicate-layer') s.duplicateSelectedLayers();
      else if (command === 'add-layer-mask' && s.doc?.activeId) s.addLayerMask(s.doc.activeId);
      else if (command === 'apply-layer-mask' && s.doc?.activeId) s.applyLayerMask(s.doc.activeId);
      else if (command === 'delete-layer-mask' && s.doc?.activeId) s.removeLayerMask(s.doc.activeId);
      else if (command === 'flip-horizontal') s.flipSelectedLayers('horizontal');
      else if (command === 'flip-vertical') s.flipSelectedLayers('vertical');
      else if (command === 'edit-vector-nodes') s.setTool('vector-node');
      else if (command === 'text-to-curves' && s.doc?.activeId) void s.convertTextToCurves(s.doc.activeId);
      else if (command === 'expand-vector' && s.doc?.activeId) void s.expandVectorLayer(s.doc.activeId);
      else if (command === 'vectorize-layer' && s.doc?.activeId) setVectorizeLayerId(s.doc.activeId);
      else if (command === 'pathfinder-unite') void s.applyPathfinder('unite');
      else if (command === 'pathfinder-subtract') void s.applyPathfinder('subtract');
      else if (command === 'pathfinder-intersect') void s.applyPathfinder('intersect');
      else if (command === 'pathfinder-exclude') void s.applyPathfinder('exclude');
      else if (command === 'merge-down') s.mergeDown();
      else if (command === 'merge-visible') s.mergeVisible();
      else if (command === 'select-layer-below') s.selectAdjacentLayer(-1);
      else if (command === 'select-layer-above') s.selectAdjacentLayer(1);
      else if (command === 'move-layer-down') s.moveSelectedLayerInStack(-1);
      else if (command === 'move-layer-up') s.moveSelectedLayerInStack(1);
      else if (command === 'fit-view') onFit();
      else if (command === 'actual-pixels') onActualPixels();
      else if (command === 'zoom-in') s.setZoom(s.zoom * 1.2);
      else if (command === 'zoom-out') s.setZoom(s.zoom / 1.2);
      else if (command === 'toggle-panels') onTogglePanels();
      else if (command === 'toggle-color-panel') onToggleColorPanel();
      else if (command === 'toggle-layers-panel') onToggleLayersPanel();
      else if (command === 'toggle-guides') useSettings.getState().toggleGuides();
      else if (command === 'settings') setShowSettings(true);
      else if (command === 'close-document' && s.activeTabId) {
        requestCloseTab(s.activeTabId);
      }
    });
    const unsubscribeClose = native.onCloseRequested(() => {
      void saveAllDirtyProjects().then((saved) => { if (saved) native.confirmClose(); });
    });
    const unsubscribeExternal = native.onExternalFileChange((change) => {
      if (!useEditor.getState().workspaceTabs().some((tab) => tab.id === change.tabId)) return;
      setExternalChange(change);
    });
    const unsubscribeOpenFiles = native.onOpenFiles((files) => {
      void openIncomingFiles(files.map(nativeFile));
    });
    native.readyForFiles();
    return () => {
      unsubscribeStore();
      unsubscribeMenu();
      unsubscribeClose();
      unsubscribeExternal();
      unsubscribeOpenFiles();
      document.documentElement.classList.remove('desktop-app');
    };
  }, [onActualPixels, onFit, onImport, onOpenProject, onRemoveBg, onSaveProject, onToggleColorPanel, onToggleLayersPanel, onTogglePanels, openIncomingFiles, requestCloseTab, saveAllDirtyProjects]);

  // Recovery uses IndexedDB and captures every tab. Serialization is deferred
  // until the browser is idle so large canvases do not interrupt a gesture.
  useEffect(() => {
    let live = true;
    if (useEditor.getState().doc) return undefined;
    void loadRecoveryWorkspace().then(async (workspace) => {
      if (!workspace?.tabs.length || !live) return;
      const parsed = await Promise.all(workspace.tabs.map(async (tab) => {
        const project = await parseProject(tab.project);
        return { id: '', name: tab.name, doc: project.doc, guides: project.guides, zoom: project.view.zoom, panX: project.view.panX, panY: project.view.panY, dirty: tab.dirty, sourceName: tab.sourceName };
      }));
      if (live && !useEditor.getState().doc) setRecovery({ activeIndex: workspace.activeIndex, tabs: parsed });
    }).catch(discardRecovery);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if ((doc || pending) && recovery) setRecovery(null);
  }, [doc, pending, recovery]);
  useEffect(() => {
    if (!doc) {
      if (hadDocument.current) discardRecovery();
      return undefined;
    }
    hadDocument.current = true;
    let live = true;
    let idleId: number | null = null;
    const timer = window.setTimeout(() => {
      const run = async () => {
        const s = useEditor.getState();
        const tabs = s.workspaceTabs().filter((tab): tab is typeof tab & { doc: NonNullable<typeof tab.doc> } => !!tab.doc);
        if (!tabs.length) return;
        const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === s.activeTabId));
        try {
          const liveTabIds = new Set(tabs.map((tab) => tab.id));
          for (const id of recoveryProjectCache.current.keys()) {
            if (!liveTabIds.has(id)) recoveryProjectCache.current.delete(id);
          }
          const payload = await Promise.all(tabs.map(async (tab) => {
            const cached = recoveryProjectCache.current.get(tab.id);
            const project = cached?.changeId === tab.changeId
              ? cached.project
              : await serializeProject(tab.name, tab.doc, tab.guides, { zoom: tab.zoom, panX: tab.panX, panY: tab.panY });
            if (cached?.project !== project) recoveryProjectCache.current.set(tab.id, { changeId: tab.changeId, project });
            return {
              name: tab.name,
              dirty: tab.dirty,
              sourceName: getDocumentSourceName(tab.id),
              project,
            };
          }));
          if (live) await saveRecoveryWorkspace({ version: 2, savedAt: Date.now(), activeIndex, tabs: payload });
        } catch { /* recovery must never interrupt editing */ }
      };
      if ('requestIdleCallback' in window) idleId = window.requestIdleCallback(() => { void run(); }, { timeout: 3000 });
      else void run();
    }, 5000);
    return () => {
      live = false;
      window.clearTimeout(timer);
      if (idleId != null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
    };
  }, [doc, dirty, guides]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const s = useEditor.getState();
      if (isDesktop || !s.workspaceTabs().some((tab) => tab.dirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setShowCommands(true); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Clipboard paste of images.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      let firstImage: File | null = null;
      for (const it of Array.from(items)) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) {
            files.push(f);
            if (!firstImage && f.type.startsWith('image/')) firstImage = f;
          }
        }
      }
      const s = useEditor.getState();
      if (!s.doc && firstImage) {
        e.preventDefault();
        void loadRasterFile(firstImage)
          .then((canvas) => useEditor.getState().newDocumentFromCanvas(canvas, 'Portapapeles'))
          .catch((err) => toast(err instanceof Error ? err.message : 'No se pudo pegar la imagen', 'error'));
        return;
      }
      if (files.length) open(files, s.doc ? 'layer' : 'document');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, toast]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length) void openIncomingFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={`app ${showPalettes ? 'palette-open' : ''} ${panelsHidden ? 'panels-hidden' : ''} ${rightPanelHidden ? 'right-panel-hidden' : ''}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) setDragging(false); }}
      onDrop={onDrop}
    >
      <TopBar
        onNew={() => { setNewFromClipboard(false); setShowNew(true); }}
        onImport={onImport}
        onAddLayer={onAddLayer}
        onOpenProject={onOpenProject}
        onSaveProject={() => { void onSaveProject(false); }}
        onSaveProjectAs={() => { void onSaveProject(true); }}
        onExport={() => setShowExport(true)}
        onResize={() => setShowResize(true)}
        onTrim={trimTransparent}
        onRemoveBg={onRemoveBg}
        onSettings={() => setShowSettings(true)}
        onCommands={() => setShowCommands(true)}
        onTogglePanel={() => setSidePanelOpen((v) => !v)}
      />
      {showPalettes && <PaletteTray onClose={() => setShowPalettes(false)} />}
      <DocumentTabs onNew={() => { setNewFromClipboard(false); setShowNew(true); }} onRequestClose={requestCloseTab} />
      <div id="tool-options-slot" className="tool-options-slot" />
      <Toolbar
        onRemoveBg={onRemoveBg}
        onRefineTextLines={() => useEditor.getState().refineActiveTextLines()}
      />
      <CanvasStage
        ref={stageRef}
        onImport={onImport}
        onNewDocument={() => { setNewFromClipboard(false); setShowNew(true); }}
        onNewFromClipboard={() => { setNewFromClipboard(true); setShowNew(true); }}
        onEditText={onEditText}
        onNewText={onNewText}
        editingTextLayerId={textEditingLayerId}
      />
      {sidePanelOpen && <div className="side-backdrop" onClick={() => setSidePanelOpen(false)} />}
      <div className={`side ${sidePanelOpen ? 'open' : ''}`}>
        <AdjustmentsPanel />
        <LayersPanel
          onAddLayer={onAddLayer}
          onEditText={onEditText}
          onVectorize={setVectorizeLayerId}
          textEditorOpen={textTarget != null}
        />
        {doc && <HistoryPanel />}
      </div>
      <StatusBar onFit={onFit} onPalettes={() => setShowPalettes((value) => !value)} />

      {dragging && <div className="drop-hint">Soltá para importar</div>}

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showResize && <ResizeDialog onClose={() => setShowResize(false)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showNew && (
        <NewDocumentDialog
          autoClipboard={newFromClipboard}
          onClose={() => { setShowNew(false); setNewFromClipboard(false); }}
        />
      )}
      {closingTabId && (() => {
        const tab = useEditor.getState().workspaceTabs().find((candidate) => candidate.id === closingTabId);
        if (!tab) return null;
        return <Modal
          title="Guardar cambios"
          width={390}
          onClose={() => setClosingTabId(null)}
          footer={<>
            <button className="tbtn" onClick={() => setClosingTabId(null)}>Cancelar</button>
            <button className="tbtn danger" onClick={() => { closeTabNow(closingTabId); setClosingTabId(null); }}>No guardar</button>
            <button className="tbtn primary" onClick={() => {
              const s = useEditor.getState();
              if (s.activeTabId !== closingTabId) s.switchTab(closingTabId);
              void onSaveProject(false).then((saved) => {
                if (!saved) return;
                closeTabNow(closingTabId);
                setClosingTabId(null);
              });
            }}>Guardar</button>
          </>}
        >
          <p className="save-changes-copy">“{tab.name}” tiene cambios sin guardar.</p>
          <p className="hint-sub">Podés guardar el proyecto, cerrar sin conservar los cambios o volver al documento.</p>
        </Modal>;
      })()}
      {textTarget && (
        <TextDialog
          key={textTarget.sessionId}
          target={textTarget}
          onLayerReady={setTextEditingLayerId}
          onClose={() => {
            setTextTarget(null);
            setTextEditingLayerId(null);
          }}
        />
      )}
      {vectorizeLayerId && <VectorizeDialog layerId={vectorizeLayerId} onClose={() => setVectorizeLayerId(null)} />}
      {bgResult && <BgRemoveDialog raw={bgResult} onClose={() => setBgResult(null)} />}
      {pending && <RasterizeDialog pending={pending} onClose={() => setPending(null)} />}
      {recovery && (
        <div className="recovery-bar" data-ui>
          <span>Hay una sesión anterior con {recovery.tabs.length} documento{recovery.tabs.length === 1 ? '' : 's'}.</span>
          <button onClick={() => {
            useEditor.getState().restoreWorkspace(recovery.tabs, recovery.activeIndex);
            useEditor.getState().workspaceTabs().forEach((tab, index) => {
              const sourceName = recovery.tabs[index]?.sourceName;
              if (sourceName) setDocumentSourceName(tab.id, sourceName);
            });
            setRecovery(null);
          }}>Restaurar</button>
          <button onClick={() => { discardRecovery(); setRecovery(null); }}>Descartar</button>
        </div>
      )}
      {externalChange && (() => {
        const tab = useEditor.getState().workspaceTabs().find((candidate) => candidate.id === externalChange.tabId);
        return <div className="recovery-bar external-file-bar" data-ui>
          <span>“{tab?.name ?? 'El proyecto'}” cambió fuera de Crotoshop{tab?.dirty ? ' y tiene cambios locales sin guardar' : ''}.</span>
          <button onClick={() => { void reloadExternalDocument(); }}>Recargar desde disco</button>
          <button onClick={() => setExternalChange(null)}>Conservar versión local</button>
        </div>;
      })()}
      {showCommands && <CommandPalette onClose={() => setShowCommands(false)} commands={[
        { label: 'Nuevo archivo', hint: '⌘N', run: () => { setNewFromClipboard(false); setShowNew(true); } },
        { label: 'Abrir imagen', hint: '⌘O', run: onImport },
        { label: 'Guardar proyecto', hint: '⌘S', run: () => { void onSaveProject(false); } },
        { label: 'Guardar proyecto como', hint: '⌘⇧S', run: () => { void onSaveProject(true); } },
        { label: 'Exportar', hint: '⌘⌥⇧W', run: () => setShowExport(true) },
        { label: 'Ajustar a la vista', hint: '⌘0', run: onFit },
        { label: 'Deshacer', hint: '⌘Z', run: () => useEditor.getState().undo() },
        { label: 'Rehacer', hint: '⌘⇧Z', run: () => useEditor.getState().redo() },
        { label: 'Agregar grupo', run: () => useEditor.getState().addGroup() },
        { label: 'Agregar capa de ajuste', run: () => useEditor.getState().addAdjustmentLayer() },
        { label: 'Formas vectoriales', hint: 'U', run: () => useEditor.getState().setTool('vector-shape') },
        { label: 'Pluma vectorial', hint: 'P', run: () => useEditor.getState().setTool('vector-pen') },
        { label: 'Editar nodos vectoriales', hint: 'A', run: () => useEditor.getState().setTool('vector-node') },
        ...(doc?.layers.find((layer) => layer.id === doc.activeId)?.text ? [{
          label: 'Convertir texto a curvas', hint: '⌘⇧O', run: () => { const id = useEditor.getState().doc?.activeId; if (id) void useEditor.getState().convertTextToCurves(id); },
        }] : []),
        ...(doc?.layers.find((layer) => layer.id === doc.activeId)?.vector?.kind === 'placed' ? [{
          label: 'Expandir vector colocado', run: () => { const id = useEditor.getState().doc?.activeId; if (id) void useEditor.getState().expandVectorLayer(id); },
        }] : []),
        ...(doc?.layers.find((layer) => layer.id === doc.activeId) && !doc.layers.find((layer) => layer.id === doc.activeId)?.vector && !doc.layers.find((layer) => layer.id === doc.activeId)?.text ? [{
          label: 'Vectorizar imagen', run: () => { const id = useEditor.getState().doc?.activeId; if (id) setVectorizeLayerId(id); },
        }] : []),
        { label: 'Pincel', hint: 'B', run: () => useEditor.getState().setTool('brush') },
        { label: 'Recortar', hint: 'C', run: () => useEditor.getState().setTool('crop') },
      ]} />}

      <ProgressOverlay />
      <Toasts />
    </div>
  );
}
