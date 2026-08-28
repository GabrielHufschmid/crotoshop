import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useEditor } from './store/editorStore';
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
import { CommandPalette } from './components/CommandPalette';
import { useImport, pickFiles } from './hooks/useImport';
import { ACCEPT } from './engine/import';
import { loadRasterFile } from './engine/import/raster';
import { downloadBlob } from './engine/export';
import { serializeProject, parseProject } from './engine/project';
import { clearRecoveryWorkspace, loadRecoveryWorkspace, saveRecoveryWorkspace } from './engine/recovery';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { removeBg } from './engine/backgroundRemoval';
import type { Pt } from './types';

function ProgressOverlay() {
  const busy = useEditor((s) => s.busy);
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

export default function App() {
  const stageRef = useRef<StageHandle>(null);
  const { pending, setPending, open } = useImport();
  const [showExport, setShowExport] = useState(false);
  const [showResize, setShowResize] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newFromClipboard, setNewFromClipboard] = useState(false);
  const [textTarget, setTextTarget] = useState<TextTarget | null>(null);
  const [bgResult, setBgResult] = useState<HTMLCanvasElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showPalettes, setShowPalettes] = useState(false);
  // Drawer del panel lateral (Ajustes/Capas/Historial) en pantallas chicas —
  // en desktop la clase 'open' no hace nada (el panel siempre está visible).
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [recovery, setRecovery] = useState<{ activeIndex: number; tabs: Array<{ id: string; name: string; doc: NonNullable<ReturnType<typeof useEditor.getState>['doc']>; guides: ReturnType<typeof useEditor.getState>['guides']; zoom: number; panX: number; panY: number; dirty?: boolean }> } | null>(null);
  const dragCounter = useRef(0);
  const hadDocument = useRef(false);

  const setBusy = useEditor((s) => s.setBusy);
  const toast = useEditor((s) => s.toast);
  const trimTransparent = useEditor((s) => s.trimTransparent);
  const doc = useEditor((s) => s.doc);
  const rev = useEditor((s) => s.rev);
  const dirty = useEditor((s) => s.dirty);
  const guides = useEditor((s) => s.guides);
  const zoom = useEditor((s) => s.zoom);
  const panX = useEditor((s) => s.panX);
  const panY = useEditor((s) => s.panY);

  const onImport = useCallback(async () => {
    const files = await pickFiles(ACCEPT);
    if (files.length) open(files, 'document');
  }, [open]);
  const onAddLayer = useCallback(() => {
    const s = useEditor.getState();
    if (!s.doc) {
      toast('Abrí o creá un documento antes de agregar una capa', 'error');
      return;
    }
    s.addEmptyLayer();
  }, [toast]);

  const onFit = useCallback(() => stageRef.current?.fit(), []);
  const onSaveProject = useCallback(() => {
    const s = useEditor.getState();
    if (!s.doc) return;
    const tabName = s.tabs.find((t) => t.id === s.activeTabId)?.name ?? 'crotoshop';
    const text = serializeProject(tabName, s.doc, s.guides, { zoom: s.zoom, panX: s.panX, panY: s.panY });
    downloadBlob(new Blob([text], { type: 'application/json' }), `${tabName || 'crotoshop'}.crotoshop`);
    s.markSaved();
  }, []);
  const onOpenProject = useCallback(async () => {
    const files = await pickFiles('.crotoshop,application/json', false);
    const file = files[0];
    if (!file) return;
    try {
      const project = await parseProject(await file.text());
      useEditor.getState().openProject(project.name, project.doc, project.guides, project.view);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el proyecto', 'error');
    }
  }, [toast]);

  const onRemoveBg = useCallback(async () => {
    const s = useEditor.getState();
    const layer = s.activeLayer();
    if (!layer) { toast('No hay ninguna capa activa', 'error'); return; }
    setBusy({ title: 'Quitar fondo', stage: 'Preparando modelo…', fraction: -1 });
    try {
      const out = await removeBg(layer.canvas, (p) =>
        setBusy({ title: 'Quitar fondo', stage: p.stage, fraction: p.fraction }));
      // El resultado no se aplica todavía: se afina y confirma en el diálogo.
      setBgResult(out);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falló el quitado de fondo', 'error');
    } finally {
      setBusy(null);
    }
  }, [setBusy, toast]);

  const onEditText = useCallback((layerId: string) => {
    setTextTarget({ kind: 'edit', layerId });
  }, []);
  const onNewText = useCallback((pt: Pt) => {
    setTextTarget({ kind: 'new', pt });
  }, []);

  useKeyboardShortcuts({
    onExport: () => setShowExport(true),
    onImport,
    onFit,
  });

  // Recovery uses IndexedDB and captures every tab. Serialization is deferred
  // until the browser is idle so large canvases do not interrupt a gesture.
  useEffect(() => {
    let live = true;
    if (useEditor.getState().doc) return undefined;
    void loadRecoveryWorkspace().then(async (workspace) => {
      if (!workspace?.tabs.length || !live) return;
      const parsed = await Promise.all(workspace.tabs.map(async (tab) => {
        const project = await parseProject(tab.project);
        return { id: '', name: tab.name, doc: project.doc, guides: project.guides, zoom: project.view.zoom, panX: project.view.panX, panY: project.view.panY, dirty: tab.dirty };
      }));
      if (live) setRecovery({ activeIndex: workspace.activeIndex, tabs: parsed });
    }).catch(discardRecovery);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!doc) {
      if (hadDocument.current) discardRecovery();
      return undefined;
    }
    hadDocument.current = true;
    let idleId: number | null = null;
    const timer = window.setTimeout(() => {
      const run = () => {
      const s = useEditor.getState();
      const tabs = s.workspaceTabs().filter((tab): tab is typeof tab & { doc: NonNullable<typeof tab.doc> } => !!tab.doc);
      if (!tabs.length) return;
      const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === s.activeTabId));
      try {
        const payload = tabs.map((tab) => ({
          name: tab.name,
          dirty: tab.dirty,
          project: serializeProject(tab.name, tab.doc, tab.guides, { zoom: tab.zoom, panX: tab.panX, panY: tab.panY }),
        }));
        void saveRecoveryWorkspace({ version: 1, savedAt: Date.now(), activeIndex, tabs: payload }).catch(() => undefined);
      } catch { /* recovery must never interrupt editing */ }
      };
      if ('requestIdleCallback' in window) idleId = window.requestIdleCallback(run, { timeout: 2500 });
      else run();
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      if (idleId != null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
    };
  }, [doc, rev, dirty, guides, zoom, panX, panY]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const s = useEditor.getState();
      if (!s.workspaceTabs().some((tab) => tab.dirty)) return;
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
    if (e.dataTransfer.files.length) open(e.dataTransfer.files, 'document');
  };

  return (
    <div
      className={`app ${showPalettes ? 'palette-open' : ''}`}
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
        onSaveProject={onSaveProject}
        onExport={() => setShowExport(true)}
        onResize={() => setShowResize(true)}
        onTrim={trimTransparent}
        onRemoveBg={onRemoveBg}
        onSettings={() => setShowSettings(true)}
        onCommands={() => setShowCommands(true)}
        onTogglePanel={() => setSidePanelOpen((v) => !v)}
      />
      {showPalettes && <PaletteTray onClose={() => setShowPalettes(false)} />}
      <DocumentTabs onNew={() => { setNewFromClipboard(false); setShowNew(true); }} />
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
      />
      {sidePanelOpen && <div className="side-backdrop" onClick={() => setSidePanelOpen(false)} />}
      <div className={`side ${sidePanelOpen ? 'open' : ''}`}>
        <AdjustmentsPanel />
        <LayersPanel onAddLayer={onAddLayer} />
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
      {textTarget && <TextDialog target={textTarget} onClose={() => setTextTarget(null)} />}
      {bgResult && <BgRemoveDialog raw={bgResult} onClose={() => setBgResult(null)} />}
      {pending && <RasterizeDialog pending={pending} onClose={() => setPending(null)} />}
      {recovery && (
        <div className="recovery-bar" data-ui>
          <span>Hay una sesión anterior con {recovery.tabs.length} documento{recovery.tabs.length === 1 ? '' : 's'}.</span>
          <button onClick={() => { useEditor.getState().restoreWorkspace(recovery.tabs, recovery.activeIndex); setRecovery(null); }}>Restaurar</button>
          <button onClick={() => { discardRecovery(); setRecovery(null); }}>Descartar</button>
        </div>
      )}
      {showCommands && <CommandPalette onClose={() => setShowCommands(false)} commands={[
        { label: 'Nuevo archivo', hint: '⌘N', run: () => { setNewFromClipboard(false); setShowNew(true); } },
        { label: 'Abrir imagen', hint: '⌘O', run: onImport },
        { label: 'Exportar', hint: '⌘S', run: () => setShowExport(true) },
        { label: 'Guardar proyecto', run: onSaveProject },
        { label: 'Ajustar a la vista', hint: '0', run: onFit },
        { label: 'Deshacer', hint: '⌘Z', run: () => useEditor.getState().undo() },
        { label: 'Rehacer', hint: '⌘⇧Z', run: () => useEditor.getState().redo() },
        { label: 'Agregar grupo', run: () => useEditor.getState().addGroup() },
        { label: 'Agregar capa de ajuste', run: () => useEditor.getState().addAdjustmentLayer() },
        { label: 'Pincel', hint: 'B', run: () => useEditor.getState().setTool('brush') },
        { label: 'Recortar', hint: 'C', run: () => useEditor.getState().setTool('crop') },
      ]} />}

      <ProgressOverlay />
      <Toasts />
    </div>
  );
}
