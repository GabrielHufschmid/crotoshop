import { create } from 'zustand';
import type { Adjustments, Artboard, BlendMode, Doc, Guide, Layer, Pt, Selection, TextData, Tool, VectorData } from '../types';
import { DEFAULT_ADJUSTMENTS } from '../types';
import {
  cloneAdjustments,
  cloneCanvas,
  createCanvas,
  ctx2d,
  makeLayer,
  makeThumb,
  uid,
  bumpCanvasVersion,
} from '../engine/canvasUtils';
import {
  adjustSelection,
  featherSelection,
  smoothSelection,
  clearSelectionPixels,
  extractSelection,
  selectAll as buildSelectAll,
} from '../engine/selection';
import { bucketFill } from '../engine/fill';
import { hexToRgb } from '../engine/color';
import { renderText } from '../engine/text';
import { canvasToBlob } from '../engine/export';
import { flatten } from '../engine/compositor';
import { DEFAULT_TOOL_DEFAULTS, useSettings } from './settingsStore';
import { recolorSvgText, svgSourceFromText } from '../engine/import/svg';
import { brushStroke, type BrushMode } from '../engine/brush';
import { contextualFill, selectionMaskForLayer } from '../engine/inpaint';
import { alignSelectedLayers, distributeSelectedLayers, movableSelectionIds } from '../engine/layerGeometry';
import { refineTextAndLines } from '../engine/lineRefine';

const MAX_HISTORY = 25;
const MAX_CROP_OUTPUT_DIMENSION = 16_384;
const MAX_CROP_OUTPUT_PIXELS = 100_000_000;

export interface Toast {
  id: string;
  kind: 'info' | 'error';
  msg: string;
}

export interface Busy {
  title: string;
  stage: string;
  fraction: number; // -1 = indeterminate
}

export interface EditorTab {
  id: string;
  name: string;
  doc: Doc | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  selection: Selection | null;
  guides: Guide[];
  zoom: number;
  panX: number;
  panY: number;
  rev: number;
  dirty: boolean;
  selectedLayerIds: string[];
}

export interface HistoryEntry {
  doc: Doc | null;
  label: string;
  guides: Guide[];
}

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  doc: Doc | null;
  tool: Tool;
  brushSize: number;
  brushHardness: number;
  wandTolerance: number;
  wandContiguous: boolean;
  fgColor: string;     // global foreground color (hex) — bucket, future paint tools
  primaryColor: string;
  eyedropperActive: boolean;
  eyedropperPreview: string | null;
  zoom: number;
  panX: number;
  panY: number;
  rev: number;         // bumps on any pixel/layer change to trigger recompositing
  cursor: { x: number; y: number } | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  busy: Busy | null;
  toasts: Toast[];
  selection: Selection | null;
  guides: Guide[];
  maskTargetId: string | null;
  dirty: boolean;
  selectedLayerIds: string[];

  // ── selectors ──
  activeLayer: () => Layer | null;

  // ── history ──
  snapshot: (label?: string) => void;        // capture current state before a mutation/gesture
  undo: () => void;
  redo: () => void;
  jumpToHistory: (index: number) => void;

  // ── document / layers ──
  newDocument: (w: number, h: number, name?: string) => void;
  newDocumentFromCanvas: (canvas: HTMLCanvasElement, name: string) => void;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  markSaved: () => void;
  workspaceTabs: () => EditorTab[];
  restoreWorkspace: (tabs: Array<Omit<EditorTab, 'past' | 'future' | 'selection' | 'rev' | 'dirty' | 'selectedLayerIds'> & { dirty?: boolean }>, activeIndex: number) => void;
  openProject: (
    name: string,
    doc: Doc,
    guides: Guide[],
    view: { zoom: number; panX: number; panY: number },
  ) => void;
  addLayerCanvas: (canvas: HTMLCanvasElement, name: string) => void;
  addLayerCanvasAt: (canvas: HTMLCanvasElement, name: string, x: number, y: number, snapshot?: boolean) => string | null;
  addEmptyLayer: () => void;
  addVectorLayer: (vector: VectorData, preview: HTMLCanvasElement, name: string, asDocument?: boolean) => void;
  removeLayer: (id: string) => void;
  selectLayer: (id: string, mode?: 'replace' | 'toggle' | 'range') => void;
  toggleVisible: (id: string) => void;
  setOpacity: (id: string, opacity: number) => void; // no snapshot (gesture)
  renameLayer: (id: string, name: string) => void;
  reorderLayer: (fromId: string, toIndex: number) => void;
  addGroup: () => void;
  setLayerParent: (id: string, parentId?: string) => void;
  toggleLock: (id: string, pixels?: boolean) => void;
  setLayerColorTag: (id: string, color?: string) => void;
  setBlendMode: (id: string, mode: BlendMode) => void;
  addAdjustmentLayer: () => void;
  addLayerMask: (id: string) => void;
  setMaskEnabled: (id: string, enabled: boolean) => void;
  setMaskTarget: (id: string | null) => void;

  // ── adjustments (gesture: snapshot handled by caller) ──
  setAdjustments: (id: string, patch: Partial<Adjustments>) => void;
  resetAdjustments: (id: string) => void;

  // ── transforms / raster ops ──
  moveActiveBy: (dx: number, dy: number) => void; // no snapshot (gesture)
  replaceActiveCanvas: (canvas: HTMLCanvasElement) => void;
  replaceLayerCanvasAt: (id: string, canvas: HTMLCanvasElement, x: number, y: number) => void;
  rasterizeLayer: (id: string) => Promise<void>;
  updateSvgVectorColors: (id: string, fill?: string, stroke?: string) => Promise<void>;
  refreshActiveThumb: () => void;
  cropTo: (rect: { x: number; y: number; w: number; h: number }, upscale?: 1 | 2 | 4) => boolean;
  resizeTo: (w: number, h: number) => void;
  trimTransparent: () => void;
  alignActiveLayer: (mode: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => void;
  distributeLayers: (axis: 'x' | 'y') => void;

  // ── selection ──
  setSelection: (sel: Selection | null) => void;
  adjustSelectionBy: (px: number) => void;
  smoothSelectionBy: (px: number) => void;
  featherSelectionBy: (px: number) => void;
  selectAllPixels: () => void;
  deleteSelectionPixels: () => void;
  /**
   * Reemplaza la capa activa por una copia con canvas propio y la devuelve.
   * Obligatorio antes de cualquier mutación de píxeles in-place: el historial
   * copy-on-write comparte canvases entre snapshots (ver cloneDoc).
   */
  unshareActiveCanvas: () => Layer | null;
  /** Copies (or cuts) the active layer ∩ selection to the clipboard. */
  copySelection: (cut: boolean) => Promise<boolean>;
  /** Pastes the internal clipboard as a new layer (fallback path). */
  pasteInternal: () => boolean;
  hasInternalClipboard: () => boolean;
  systemClipboardOk: boolean;
  /** True while CanvasStage has a selection's pixels extracted mid-gesture
   *  (move/resize/rotate before commit). `selection` is null during that
   *  window, so shortcuts that fall back on "no selection" must check this
   *  first — otherwise e.g. Delete would remove the whole active layer. */
  selectionTransformActive: boolean;
  setSelectionTransformActive: (active: boolean) => void;

  // ── guides ──
  addGuide: (axis: 'x' | 'y', pos: number) => string;
  moveGuide: (id: string, pos: number) => void;
  removeGuide: (id: string) => void;
  saveCanvasConfig: () => void;
  loadCanvasConfig: () => void;

  // ── layer transform (gesture: snapshot handled by caller) ──
  setLayerBounds: (id: string, b: { x: number; y: number; w: number; h: number }) => void;
  setLayerRotation: (id: string, radians: number) => void;
  flipLayer: (id: string, axis: 'horizontal' | 'vertical') => void;
  bakeLayerTransform: (id: string) => void;

  // ── text layers ──
  addTextLayer: (data: TextData, x: number, y: number) => string | null;
  updateTextLayer: (id: string, data: TextData) => void;
  addVectorPath: (points: Pt[]) => Promise<void>;

  // ── view ──
  setTool: (t: Tool) => void;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  setBrush: (size?: number, hardness?: number) => void;
  setWand: (tolerance?: number, contiguous?: boolean) => void;
  setFgColor: (hex: string) => void;
  setPrimaryColor: (hex: string) => void;
  setEyedropperActive: (active: boolean) => void;
  setEyedropperPreview: (hex: string | null) => void;
  commitEyedropperColor: (hex: string) => void;
  bucketFillAt: (p: Pt) => void;
  smartFillSelection: () => void;
  refineActiveTextLines: () => void;
  paintActiveStroke: (from: Pt, to: Pt, mode: BrushMode) => boolean;
  setCursor: (c: { x: number; y: number } | null) => void;

  // ── ui ──
  setBusy: (b: Busy | null) => void;
  toast: (msg: string, kind?: 'info' | 'error') => void;
  dismissToast: (id: string) => void;
  bump: () => void;

  // ── artboards ──
  addArtboard: (b: Omit<Artboard, 'id'>) => void;
  updateArtboard: (id: string, patch: Partial<Omit<Artboard, 'id'>>) => void;
  removeArtboard: (id: string) => void;
}

/**
 * Snapshot copy-on-write: los snapshots comparten los objetos Layer (y sus
 * canvases) con el doc vivo, así que capturar historial es O(capas) en vez de
 * copiar todos los píxeles del documento. El invariante que lo sostiene:
 * ninguna operación muta un Layer compartido — las que reemplazan campos ya
 * crean objetos nuevos, y las pocas que pintan píxeles in-place (borrador,
 * balde, borrar selección) pasan antes por unshareActiveCanvas().
 */
function cloneDoc(doc: Doc | null): Doc | null {
  if (!doc) return null;
  return { ...doc, layers: [...doc.layers] };
}

function tabFromState(s: EditorState): EditorTab | null {
  if (!s.activeTabId) return null;
  return {
    id: s.activeTabId,
    name: s.tabs.find((t) => t.id === s.activeTabId)?.name ?? docName(s.doc) ?? 'Sin título',
    doc: s.doc,
    past: s.past,
    future: s.future,
    selection: s.selection,
    guides: s.guides,
    zoom: s.zoom,
    panX: s.panX,
    panY: s.panY,
    rev: s.rev,
    dirty: s.dirty,
    selectedLayerIds: s.selectedLayerIds,
  };
}

function saveActiveTab(s: EditorState): EditorTab[] {
  const current = tabFromState(s);
  if (!current) return s.tabs;
  const i = s.tabs.findIndex((t) => t.id === current.id);
  if (i < 0) return [...s.tabs, current];
  const tabs = [...s.tabs];
  tabs[i] = current;
  return tabs;
}

function docName(doc: Doc | null): string | null {
  const first = doc?.layers[0]?.name;
  return first || null;
}

function makeDoc(canvas: HTMLCanvasElement, name: string): Doc {
  const layer = makeLayer(canvas, name, 0, 0);
  return { width: canvas.width, height: canvas.height, layers: [layer], activeId: layer.id, artboards: [] };
}

function whiteMask(w: number, h: number): HTMLCanvasElement {
  const mask = createCanvas(w, h);
  const g = ctx2d(mask);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, mask.width, mask.height);
  return mask;
}

/** In-app clipboard fallback for browsers without ClipboardItem write support. */
let internalClipboard: HTMLCanvasElement | null = null;

export const useEditor = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  doc: null,
  tool: 'move',
  brushSize: useSettings.getState().toolDefaults.brushSize ?? DEFAULT_TOOL_DEFAULTS.brushSize,
  brushHardness: useSettings.getState().toolDefaults.brushHardness ?? DEFAULT_TOOL_DEFAULTS.brushHardness,
  wandTolerance: useSettings.getState().toolDefaults.wandTolerance ?? DEFAULT_TOOL_DEFAULTS.wandTolerance,
  wandContiguous: useSettings.getState().toolDefaults.wandContiguous ?? DEFAULT_TOOL_DEFAULTS.wandContiguous,
  fgColor: useSettings.getState().toolDefaults.fgColor ?? DEFAULT_TOOL_DEFAULTS.fgColor,
  primaryColor: useSettings.getState().toolDefaults.fgColor ?? DEFAULT_TOOL_DEFAULTS.fgColor,
  eyedropperActive: false,
  eyedropperPreview: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  rev: 0,
  cursor: null,
  past: [],
  future: [],
  busy: null,
  toasts: [],
  selection: null,
  guides: [],
  maskTargetId: null,
  dirty: false,
  selectedLayerIds: [],
  systemClipboardOk: false,
  selectionTransformActive: false,
  setSelectionTransformActive: (active) => set({ selectionTransformActive: active }),

  activeLayer: () => {
    const d = get().doc;
    if (!d || !d.activeId) return null;
    return d.layers.find((l) => l.id === d.activeId) ?? null;
  },

  snapshot: (label = 'Edición') => {
    const { doc, past, guides } = get();
    const next = [...past, { doc: cloneDoc(doc), label, guides: [...guides] }];
    if (next.length > MAX_HISTORY) next.shift();
    set({ past: next, future: [], dirty: true });
  },

  undo: () => {
    const { past, future, doc, guides } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [...future, { doc: cloneDoc(doc), label: prev.label, guides: [...guides] }],
      doc: prev.doc,
      guides: prev.guides,
      rev: get().rev + 1,
      selection: null, // may reference stale doc geometry
      selectedLayerIds: prev.doc?.activeId ? [prev.doc.activeId] : [],
      dirty: true,
    });
  },

  redo: () => {
    const { past, future, doc, guides } = get();
    if (future.length === 0) return;
    const next = future[future.length - 1];
    set({
      future: future.slice(0, -1),
      past: [...past, { doc: cloneDoc(doc), label: next.label, guides: [...guides] }],
      doc: next.doc,
      guides: next.guides,
      rev: get().rev + 1,
      selection: null,
      selectedLayerIds: next.doc?.activeId ? [next.doc.activeId] : [],
      dirty: true,
    });
  },

  jumpToHistory: (index) => {
    const { past, future, doc, guides } = get();
    if (index < 0 || index >= past.length) return;
    const target = past[index];
    const nextFuture = [...future, { doc: cloneDoc(doc), label: target.label, guides: [...guides] }, ...past.slice(index + 1)];
    set({ past: past.slice(0, index), future: nextFuture, doc: target.doc, guides: target.guides, selection: null, selectedLayerIds: target.doc?.activeId ? [target.doc.activeId] : [], dirty: true, rev: get().rev + 1 });
  },

  newDocument: (w, h, name = 'Sin título') => {
    const canvas = createCanvas(w, h);
    const id = uid('tab');
    const doc = makeDoc(canvas, 'Fondo');
    set((state) => ({
      tabs: [...saveActiveTab(state), {
        id, name, doc, past: [], future: [], selection: null, guides: [],
        zoom: 1, panX: 0, panY: 0, rev: state.rev + 1, dirty: true, selectedLayerIds: [doc.activeId!],
      }],
      activeTabId: id,
      doc,
      past: [],
      future: [],
      selection: null,
      guides: [],
      zoom: 1,
      panX: 0,
      panY: 0,
      rev: state.rev + 1,
      cursor: null,
      dirty: true,
      selectedLayerIds: [doc.activeId!],
    }));
  },

  newDocumentFromCanvas: (canvas, name) => {
    const id = uid('tab');
    const doc = makeDoc(canvas, name);
    set((state) => ({
      tabs: [...saveActiveTab(state), {
        id, name, doc, past: [], future: [], selection: null, guides: [],
        zoom: 1, panX: 0, panY: 0, rev: state.rev + 1, dirty: true, selectedLayerIds: [doc.activeId!],
      }],
      activeTabId: id,
      doc,
      past: [],
      future: [],
      selection: null,
      guides: [],
      zoom: 1,
      panX: 0,
      panY: 0,
      rev: state.rev + 1,
      cursor: null,
      dirty: true,
      selectedLayerIds: [doc.activeId!],
    }));
  },

  switchTab: (id) => {
    set((state) => {
      if (state.activeTabId === id) return {};
      const tabs = saveActiveTab(state);
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return {};
      return {
        tabs,
        activeTabId: tab.id,
        doc: tab.doc,
        past: tab.past,
        future: tab.future,
        selection: tab.selection,
        guides: tab.guides,
        zoom: tab.zoom,
        panX: tab.panX,
        panY: tab.panY,
        rev: state.rev + 1,
        cursor: null,
        dirty: tab.dirty,
        selectedLayerIds: tab.selectedLayerIds,
      };
    });
  },

  closeTab: (id) => {
    set((state) => {
      const tabs = saveActiveTab(state);
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return {};
      const nextTabs = tabs.filter((t) => t.id !== id);
      if (state.activeTabId !== id) return { tabs: nextTabs };
      const next = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0] ?? null;
      if (!next) {
        return {
          tabs: [],
          activeTabId: null,
          doc: null,
          past: [],
          future: [],
          selection: null,
          guides: [],
          zoom: 1,
          panX: 0,
          panY: 0,
          rev: state.rev + 1,
          cursor: null,
          dirty: false,
          selectedLayerIds: [],
        };
      }
      return {
        tabs: nextTabs,
        activeTabId: next.id,
        doc: next.doc,
        past: next.past,
        future: next.future,
        selection: next.selection,
        guides: next.guides,
        zoom: next.zoom,
        panX: next.panX,
        panY: next.panY,
        rev: state.rev + 1,
        cursor: null,
        dirty: next.dirty,
        selectedLayerIds: next.selectedLayerIds,
      };
    });
  },

  markSaved: () => set((state) => {
    if (!state.activeTabId) return {};
    return {
      dirty: false,
      tabs: saveActiveTab({ ...state, dirty: false }),
    };
  }),

  workspaceTabs: () => saveActiveTab(get()),

  restoreWorkspace: (incoming, activeIndex) => {
    const restored = incoming.map((tab) => ({
      ...tab,
      id: uid('tab'),
      past: [],
      future: [],
      selection: null,
      rev: 1,
      dirty: tab.dirty ?? true,
      selectedLayerIds: tab.doc?.activeId ? [tab.doc.activeId] : [],
    }));
    const active = restored[Math.max(0, Math.min(restored.length - 1, activeIndex))] ?? null;
    set({
      tabs: restored,
      activeTabId: active?.id ?? null,
      doc: active?.doc ?? null,
      past: active?.past ?? [],
      future: active?.future ?? [],
      selection: null,
      guides: active?.guides ?? [],
      zoom: active?.zoom ?? 1,
      panX: active?.panX ?? 0,
      panY: active?.panY ?? 0,
      rev: get().rev + 1,
      cursor: null,
      dirty: active?.dirty ?? false,
      selectedLayerIds: active?.selectedLayerIds ?? [],
    });
  },

  openProject: (name, doc, guides, view) => {
    const id = uid('tab');
    set((state) => ({
      tabs: [...saveActiveTab(state), {
        id, name, doc, past: [], future: [], selection: null, guides,
        zoom: view.zoom, panX: view.panX, panY: view.panY, rev: state.rev + 1, dirty: false, selectedLayerIds: doc.activeId ? [doc.activeId] : [],
      }],
      activeTabId: id,
      doc,
      past: [],
      future: [],
      selection: null,
      guides,
      zoom: view.zoom,
      panX: view.panX,
      panY: view.panY,
      rev: state.rev + 1,
      cursor: null,
      dirty: false,
      selectedLayerIds: doc.activeId ? [doc.activeId] : [],
    }));
  },

  addLayerCanvas: (canvas, name) => {
    get().snapshot('Importar capa');
    set((state) => {
      const d = state.doc;
      if (!d) {
        const layer = makeLayer(canvas, name, 0, 0);
        return {
          doc: { width: canvas.width, height: canvas.height, layers: [layer], activeId: layer.id },
          rev: state.rev + 1,
          selectedLayerIds: [layer.id],
        };
      }
      const x = Math.round((d.width - canvas.width) / 2);
      const y = Math.round((d.height - canvas.height) / 2);
      const layer = makeLayer(canvas, name, x, y);
      return {
        doc: { ...d, layers: [...d.layers, layer], activeId: layer.id },
        rev: state.rev + 1,
        selectedLayerIds: [layer.id],
      };
    });
  },

  addLayerCanvasAt: (canvas, name, x, y, takeSnapshot = true) => {
    if (takeSnapshot) get().snapshot('Agregar capa');
    let id: string | null = null;
    set((state) => {
      const d = state.doc;
      const layer = makeLayer(canvas, name, Math.round(x), Math.round(y));
      id = layer.id;
      if (!d) {
        return {
          doc: { width: canvas.width, height: canvas.height, layers: [layer], activeId: layer.id },
          rev: state.rev + 1,
          dirty: true,
          selectedLayerIds: [layer.id],
        };
      }
      return {
        doc: { ...d, layers: [...d.layers, layer], activeId: layer.id },
        rev: state.rev + 1,
        dirty: true,
        selectedLayerIds: [layer.id],
      };
    });
    return id;
  },

  addEmptyLayer: () => {
    const d = get().doc;
    if (!d) return;
    get().snapshot('Nueva capa');
    set((state) => {
      const doc = state.doc;
      if (!doc) return {};
      const number = doc.layers.filter((layer) => layer.kind !== 'group' && layer.kind !== 'adjustment').length + 1;
      const layer = makeLayer(createCanvas(doc.width, doc.height), `Capa ${number}`, 0, 0);
      return {
        doc: { ...doc, layers: [...doc.layers, layer], activeId: layer.id },
        selectedLayerIds: [layer.id],
        rev: state.rev + 1,
        dirty: true,
      };
    });
  },

  addVectorLayer: (vector, preview, name, asDocument = false) => {
    get().snapshot('Importar vector');
    set((state) => {
      const layer = makeLayer(preview, name, 0, 0);
      layer.vector = vector;
      layer.w = vector.baseWidth;
      layer.h = vector.baseHeight;
      if (asDocument) {
        const id = uid('tab');
        const doc = {
          width: Math.round(vector.baseWidth),
          height: Math.round(vector.baseHeight),
          layers: [layer],
          activeId: layer.id,
        };
        return {
          tabs: [...saveActiveTab(state), {
            id, name, doc, past: [], future: [], selection: null, guides: [],
            zoom: 1, panX: 0, panY: 0, rev: state.rev + 1, dirty: true, selectedLayerIds: [layer.id],
          }],
          activeTabId: id,
          doc,
          past: [],
          future: [],
          selection: null,
          guides: [],
          zoom: 1,
          panX: 0,
          panY: 0,
          rev: state.rev + 1,
          cursor: null,
          dirty: true,
          selectedLayerIds: [layer.id],
        };
      }
      const d = state.doc;
      if (!d) {
        return {
          doc: { width: Math.round(vector.baseWidth), height: Math.round(vector.baseHeight), layers: [layer], activeId: layer.id },
          rev: state.rev + 1,
          dirty: true,
          selectedLayerIds: [layer.id],
        };
      }
      const x = Math.round((d.width - vector.baseWidth) / 2);
      const y = Math.round((d.height - vector.baseHeight) / 2);
      return {
        doc: { ...d, layers: [...d.layers, { ...layer, x, y }], activeId: layer.id },
        rev: state.rev + 1,
        dirty: true,
        selectedLayerIds: [layer.id],
      };
    });
  },

  removeLayer: (id) => {
    get().snapshot('Eliminar capa');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const removed = d.layers.find((layer) => layer.id === id);
      const layers = d.layers.filter((l) => l.id !== id).map((layer) => removed?.kind === 'group' && layer.parentId === id ? { ...layer, parentId: undefined } : layer);
      const activeId =
        d.activeId === id ? (layers.length ? layers[layers.length - 1].id : null) : d.activeId;
      if (layers.length === 0) return { doc: null, selectedLayerIds: [], rev: state.rev + 1 };
      const selectedLayerIds = state.selectedLayerIds.filter((layerId) => layerId !== id && layers.some((layer) => layer.id === layerId));
      return { doc: { ...d, layers, activeId }, selectedLayerIds: selectedLayerIds.length ? selectedLayerIds : activeId ? [activeId] : [], rev: state.rev + 1 };
    });
  },

  selectLayer: (id, mode = 'replace') =>
    set((state) => {
      const doc = state.doc;
      if (!doc || !doc.layers.some((layer) => layer.id === id)) return {};
      let selectedLayerIds: string[];
      if (mode === 'toggle') {
        selectedLayerIds = state.selectedLayerIds.includes(id)
          ? state.selectedLayerIds.filter((layerId) => layerId !== id)
          : [...state.selectedLayerIds, id];
        if (!selectedLayerIds.length) selectedLayerIds = [id];
      } else if (mode === 'range' && doc.activeId) {
        const a = doc.layers.findIndex((layer) => layer.id === doc.activeId);
        const b = doc.layers.findIndex((layer) => layer.id === id);
        const [from, to] = a < b ? [a, b] : [b, a];
        selectedLayerIds = doc.layers.slice(from, to + 1).map((layer) => layer.id);
      } else {
        selectedLayerIds = [id];
      }
      return { doc: { ...doc, activeId: id }, selectedLayerIds, maskTargetId: state.maskTargetId === id ? id : null };
    }),

  toggleVisible: (id) => {
    get().snapshot('Cambiar visibilidad');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: { ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) },
        rev: state.rev + 1,
      };
    });
  },

  setOpacity: (id, opacity) =>
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: { ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, opacity } : l)) },
        rev: state.rev + 1,
      };
    }),

  renameLayer: (id, name) => {
    get().snapshot('Renombrar capa');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return { doc: { ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, name } : l)) } };
    });
  },

  reorderLayer: (fromId, toIndex) => {
    get().snapshot('Reordenar capas');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const from = d.layers.findIndex((l) => l.id === fromId);
      if (from < 0) return {};
      const layers = [...d.layers];
      const [moved] = layers.splice(from, 1);
      const clamped = Math.max(0, Math.min(layers.length, toIndex));
      layers.splice(clamped, 0, moved);
      return { doc: { ...d, layers }, rev: state.rev + 1 };
    });
  },

  addGroup: () => {
    get().snapshot('Crear grupo');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const canvas = createCanvas(1, 1);
      const group = makeLayer(canvas, 'Grupo');
      group.kind = 'group';
      group.thumb = makeThumb(canvas);
      return { doc: { ...d, layers: [...d.layers, group], activeId: group.id }, selectedLayerIds: [group.id], rev: state.rev + 1 };
    });
  },

  setLayerParent: (id, parentId) => {
    get().snapshot('Mover a grupo');
    set((state) => {
      const d = state.doc;
      if (!d || (parentId && !d.layers.some((l) => l.id === parentId && l.kind === 'group'))) return {};
      return {
        doc: { ...d, layers: d.layers.map((l) => l.id === id ? { ...l, parentId } : l) },
        rev: state.rev + 1,
      };
    });
  },

  toggleLock: (id, pixels = false) => {
    get().snapshot(pixels ? 'Bloquear píxeles' : 'Bloquear capa');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: { ...d, layers: d.layers.map((l) => l.id === id
          ? (pixels ? { ...l, lockPixels: !l.lockPixels } : { ...l, locked: !l.locked }) : l) },
        rev: state.rev + 1,
      };
    });
  },

  setLayerColorTag: (id, color) => {
    get().snapshot('Etiquetar capa');
    set((state) => {
    const d = state.doc;
    if (!d) return {};
    return { doc: { ...d, layers: d.layers.map((l) => l.id === id ? { ...l, colorTag: color } : l) }, rev: state.rev + 1 };
    });
  },

  setBlendMode: (id, blendMode) => {
    get().snapshot('Cambiar modo de fusión');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return { doc: { ...d, layers: d.layers.map((l) => l.id === id ? { ...l, blendMode } : l) }, rev: state.rev + 1 };
    });
  },

  addAdjustmentLayer: () => {
    get().snapshot('Crear capa de ajuste');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const layer = makeLayer(createCanvas(1, 1), 'Ajuste');
      layer.kind = 'adjustment';
      layer.adjustmentLayer = cloneAdjustments(DEFAULT_ADJUSTMENTS);
      return { doc: { ...d, layers: [...d.layers, layer], activeId: layer.id }, selectedLayerIds: [layer.id], rev: state.rev + 1 };
    });
  },

  addLayerMask: (id) => {
    get().snapshot('Agregar máscara');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: { ...d, layers: d.layers.map((l) => l.id === id
          ? { ...l, mask: l.mask ?? { canvas: whiteMask(l.canvas.width, l.canvas.height), enabled: true } } : l) },
        rev: state.rev + 1,
      };
    });
  },

  setMaskEnabled: (id, enabled) => {
    get().snapshot(enabled ? 'Activar máscara' : 'Desactivar máscara');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return { doc: { ...d, layers: d.layers.map((l) => l.id === id && l.mask ? { ...l, mask: { ...l.mask, enabled } } : l) }, rev: state.rev + 1 };
    });
  },

  setMaskTarget: (maskTargetId) => set({ maskTargetId }),

  setAdjustments: (id, patch) =>
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: {
          ...d,
          layers: d.layers.map((l) =>
            l.id === id ? (l.kind === 'adjustment'
              ? { ...l, adjustmentLayer: { ...(l.adjustmentLayer ?? DEFAULT_ADJUSTMENTS), ...patch } }
              : { ...l, adjustments: { ...l.adjustments, ...patch } }) : l,
          ),
        },
        rev: state.rev + 1,
      };
    }),

  resetAdjustments: (id) => {
    get().snapshot('Restablecer ajustes');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: {
          ...d,
          layers: d.layers.map((l) =>
            l.id === id ? (l.kind === 'adjustment'
              ? { ...l, adjustmentLayer: cloneAdjustments(DEFAULT_ADJUSTMENTS) }
              : { ...l, adjustments: cloneAdjustments(DEFAULT_ADJUSTMENTS) }) : l,
          ),
        },
        rev: state.rev + 1,
      };
    });
  },

  moveActiveBy: (dx, dy) =>
    set((state) => {
      const d = state.doc;
      if (!d || !d.activeId) return {};
      const ids = movableSelectionIds(d, state.selectedLayerIds.length ? state.selectedLayerIds : [d.activeId]);
      return {
        doc: {
          ...d,
          layers: d.layers.map((l) =>
            ids.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l,
          ),
        },
        dirty: true,
        rev: state.rev + 1,
      };
    }),

  replaceActiveCanvas: (canvas) => {
    get().snapshot('Reemplazar píxeles');
    set((state) => {
      const d = state.doc;
      if (!d || !d.activeId) return {};
      return {
        doc: {
          ...d,
          layers: d.layers.map((l) =>
            l.id === d.activeId
              ? { ...l, canvas, thumb: makeThumb(canvas) }
              : l,
          ),
        },
        rev: state.rev + 1,
      };
    });
  },

  replaceLayerCanvasAt: (id, canvas, x, y) =>
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: {
          ...d,
          layers: d.layers.map((l) =>
            l.id === id
              ? { ...l, canvas, x: Math.round(x), y: Math.round(y), w: undefined, h: undefined, thumb: makeThumb(canvas) }
              : l,
          ),
          activeId: id,
        },
        rev: state.rev + 1,
      };
    }),

  rasterizeLayer: async (id) => {
    const s = get();
    const d = s.doc;
    const layer = d?.layers.find((l) => l.id === id);
    if (!d || !layer) return;
    if (!layer.vector) return;
    s.snapshot('Rasterizar capa');
    const outW = Math.max(1, Math.round(layer.w ?? layer.canvas.width));
    const outH = Math.max(1, Math.round(layer.h ?? layer.canvas.height));
    let canvas: HTMLCanvasElement;
    try {
      const sx = outW / layer.vector.baseWidth;
      const sy = outH / layer.vector.baseHeight;
      const hi = await layer.vector.rasterize(Math.max(sx, sy, 0.01));
      canvas = createCanvas(outW, outH);
      const g = ctx2d(canvas);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(hi, 0, 0, outW, outH);
    } catch {
      canvas = createCanvas(outW, outH);
      const g = ctx2d(canvas);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(layer.canvas, 0, 0, outW, outH);
    }
    set((state) => {
      const doc = state.doc;
      if (!doc) return {};
      return {
        doc: {
          ...doc,
          layers: doc.layers.map((l) =>
            l.id === id
              ? { ...l, canvas, vector: undefined, w: undefined, h: undefined, thumb: makeThumb(canvas) }
              : l,
          ),
        },
        rev: state.rev + 1,
      };
    });
  },

  updateSvgVectorColors: async (id, fill, stroke) => {
    const s = get();
    const d = s.doc;
    const layer = d?.layers.find((l) => l.id === id);
    if (!d || !layer?.vector?.svgText) return;
    s.snapshot('Recolorear vector');
    const svgText = recolorSvgText(layer.vector.svgText, fill, stroke);
    const src = svgSourceFromText(svgText);
    const w = Math.max(1, Math.round(layer.w ?? layer.vector.baseWidth));
    const h = Math.max(1, Math.round(layer.h ?? layer.vector.baseHeight));
    const preview = await src.rasterize(Math.max(w / src.baseWidth, h / src.baseHeight, 1));
    set((state) => {
      const doc = state.doc;
      if (!doc) return {};
      return {
        doc: {
          ...doc,
          layers: doc.layers.map((l) =>
            l.id === id
              ? {
                  ...l,
                  canvas: preview,
                  vector: {
                    kind: 'placed',
                    sourceType: 'svg',
                    svgText,
                    baseWidth: src.baseWidth,
                    baseHeight: src.baseHeight,
                    rasterize: src.rasterize,
                  },
                  thumb: makeThumb(preview),
                }
              : l,
          ),
        },
        rev: state.rev + 1,
      };
    });
  },

  refreshActiveThumb: () =>
    set((state) => {
      const d = state.doc;
      if (!d || !d.activeId) return {};
      return {
        doc: {
          ...d,
          layers: d.layers.map((l) =>
            l.id === d.activeId ? { ...l, thumb: makeThumb(l.canvas) } : l,
          ),
        },
        rev: state.rev + 1,
      };
    }),

  cropTo: (rect, upscale = 1) => {
    const current = get();
    if (!current.doc) return false;
    const w = Math.max(1, Math.round(rect.w));
    const h = Math.max(1, Math.round(rect.h));
    const outputW = w * upscale;
    const outputH = h * upscale;
    if (
      outputW > MAX_CROP_OUTPUT_DIMENSION || outputH > MAX_CROP_OUTPUT_DIMENSION ||
      outputW * outputH > MAX_CROP_OUTPUT_PIXELS
    ) {
      current.toast(`La salida de ${outputW} × ${outputH} px es demasiado grande. Reducí el recorte o el upscale.`, 'error');
      return false;
    }
    current.snapshot(upscale === 1 ? 'Recortar lienzo' : `Recortar y ampliar ${upscale}×`);
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const layers = d.layers.map((l) => {
        const x = l.x - rect.x;
        const y = l.y - rect.y;
        if (upscale === 1) return { ...l, x, y };
        const nextX = Math.round(x * upscale);
        const nextY = Math.round(y * upscale);
        if (l.kind === 'group' || l.kind === 'adjustment') {
          return { ...l, x: nextX, y: nextY };
        }
        if (l.text) {
          const text = {
            ...l.text,
            size: l.text.size * upscale,
            letterSpacing: l.text.letterSpacing * upscale,
          };
          const canvas = renderText(text);
          return {
            ...l,
            canvas,
            text,
            x: nextX,
            y: nextY,
            w: l.w == null ? undefined : l.w * upscale,
            h: l.h == null ? undefined : l.h * upscale,
            thumb: makeThumb(canvas),
          };
        }
        return {
          ...l,
          x: nextX,
          y: nextY,
          w: (l.w ?? l.canvas.width) * upscale,
          h: (l.h ?? l.canvas.height) * upscale,
        };
      });
      return {
        doc: {
          ...d,
          width: outputW,
          height: outputH,
          layers,
          artboards: d.artboards?.map((board) => ({
            ...board,
            x: (board.x - rect.x) * upscale,
            y: (board.y - rect.y) * upscale,
            w: board.w * upscale,
            h: board.h * upscale,
          })),
        },
        guides: state.guides
          .map((g) => ({ ...g, pos: (g.pos - (g.axis === 'x' ? rect.x : rect.y)) * upscale }))
          .filter((g) => g.pos >= 0 && g.pos <= (g.axis === 'x' ? w * upscale : h * upscale)),
        selection: null,
        dirty: true,
        rev: state.rev + 1,
      };
    });
    return true;
  },

  resizeTo: (w, h) => {
    get().snapshot('Redimensionar lienzo');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const sx = w / d.width;
      const sy = h / d.height;
      const layers = d.layers.map((l) => {
        const nw = Math.max(1, Math.round(l.canvas.width * sx));
        const nh = Math.max(1, Math.round(l.canvas.height * sy));
        const c = createCanvas(nw, nh);
        const g = ctx2d(c);
        g.imageSmoothingQuality = 'high';
        g.drawImage(l.canvas, 0, 0, nw, nh);
        return { ...l, canvas: c, x: Math.round(l.x * sx), y: Math.round(l.y * sy), thumb: makeThumb(c) };
      });
      return {
        doc: { ...d, width: Math.round(w), height: Math.round(h), layers },
        guides: state.guides.map((g) => ({ ...g, pos: g.pos * (g.axis === 'x' ? sx : sy) })),
        selection: null,
        rev: state.rev + 1,
      };
    });
  },

  trimTransparent: () => {
    const s = get();
    const d = s.doc;
    if (!d) return;
    const flat = flatten(d);
    const data = ctx2d(flat).getImageData(0, 0, flat.width, flat.height).data;
    let minX = flat.width, minY = flat.height, maxX = -1, maxY = -1;
    for (let y = 0; y < flat.height; y++) {
      for (let x = 0; x < flat.width; x++) {
        if (data[(y * flat.width + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return;
    s.cropTo({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  },

  alignActiveLayer: (mode) => {
    const current = get();
    if (!current.doc || !current.doc.activeId) return;
    const ids = current.selectedLayerIds.length ? current.selectedLayerIds : [current.doc.activeId];
    get().snapshot('Alinear capas');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: { ...d, layers: alignSelectedLayers(d, ids, mode) },
        rev: state.rev + 1,
      };
    });
  },

  distributeLayers: (axis) => {
    const current = get();
    const d = current.doc;
    const ids = d ? (current.selectedLayerIds.length ? current.selectedLayerIds : d.activeId ? [d.activeId] : []) : [];
    if (!d || ids.length < 3) {
      current.toast('Seleccioná al menos tres capas para distribuir', 'error');
      return;
    }
    get().snapshot('Distribuir capas');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: { ...d, layers: distributeSelectedLayers(d, ids, axis) },
        rev: state.rev + 1,
      };
    });
  },

  // ── selection ──
  setSelection: (selection) => set({ selection }),

  adjustSelectionBy: (px) => {
    const s = get();
    if (!s.selection) return;
    const next = adjustSelection(s.selection, px);
    set({ selection: next });
    s.toast(next ? `Selección ${px > 0 ? 'extendida' : 'contraída'} ${Math.abs(px)} px` : 'La selección quedó vacía');
  },

  smoothSelectionBy: (px) => {
    const s = get();
    if (!s.selection) return;
    const next = smoothSelection(s.selection, px);
    set({ selection: next });
    s.toast(next ? `Selección suavizada ${px}px` : 'La selección quedó vacía');
  },

  featherSelectionBy: (px) => {
    const s = get();
    if (!s.selection) return;
    const next = featherSelection(s.selection, px);
    set({ selection: next });
    s.toast(next ? `Borde suavizado ${px}px` : 'La selección quedó vacía');
  },

  selectAllPixels: () => {
    const d = get().doc;
    if (!d) return;
    set({ selection: buildSelectAll(d.width, d.height) });
  },

  unshareActiveCanvas: () => {
    const d = get().doc;
    if (!d || !d.activeId) return null;
    const idx = d.layers.findIndex((l) => l.id === d.activeId);
    if (idx < 0) return null;
    const cur = d.layers[idx];
    const fresh: Layer = {
      ...cur,
      canvas: cloneCanvas(cur.canvas),
      mask: cur.mask ? { ...cur.mask, canvas: cloneCanvas(cur.mask.canvas) } : undefined,
    };
    const layers = [...d.layers];
    layers[idx] = fresh;
    set({ doc: { ...d, layers } });
    return fresh;
  },

  deleteSelectionPixels: () => {
    const s = get();
    if (!s.activeLayer() || !s.selection) return;
    s.snapshot('Borrar selección');
    const layer = s.unshareActiveCanvas();
    if (!layer) return;
    clearSelectionPixels(layer, s.selection);
    set({ rev: get().rev + 1 });
    s.refreshActiveThumb();
    s.toast('Píxeles seleccionados eliminados');
  },

  copySelection: async (cut) => {
    const s = get();
    const layer = s.activeLayer();
    if (!layer || !s.selection) return false;
    const ex = extractSelection(layer, s.selection);
    if (!ex) return false;
    internalClipboard = ex.canvas;
    let systemOk = false;
    try {
      const blob = await canvasToBlob(ex.canvas, 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      systemOk = true;
    } catch {
      // Clipboard API unavailable/denied — the internal clipboard still works.
    }
    set({ systemClipboardOk: systemOk });
    if (cut) {
      s.snapshot('Cortar selección');
      const fresh = get().unshareActiveCanvas();
      if (fresh) {
        clearSelectionPixels(fresh, s.selection!);
        set({ rev: get().rev + 1 });
        s.refreshActiveThumb();
      }
    }
    return true;
  },

  pasteInternal: () => {
    if (!internalClipboard) return false;
    get().addLayerCanvas(cloneCanvas(internalClipboard), 'Pegado');
    return true;
  },

  hasInternalClipboard: () => internalClipboard !== null,

  // ── guides ──
  addGuide: (axis, pos) => {
    const id = uid('g');
    set((state) => ({ guides: [...state.guides, { id, axis, pos }], dirty: true }));
    return id;
  },

  moveGuide: (id, pos) =>
    set((state) => ({
      guides: state.guides.map((g) => (g.id === id ? { ...g, pos } : g)),
      dirty: true,
    })),

  removeGuide: (id) =>
    set((state) => ({ guides: state.guides.filter((g) => g.id !== id), dirty: true })),

  saveCanvasConfig: () => {
    const s = get();
    if (!s.doc) { s.toast('No hay lienzo para guardar', 'error'); return; }
    localStorage.setItem('lienzo-canvas-config', JSON.stringify({
      width: s.doc.width,
      height: s.doc.height,
      guides: s.guides,
      zoom: s.zoom,
      panX: s.panX,
      panY: s.panY,
    }));
    s.toast('Configuración del lienzo guardada');
  },

  loadCanvasConfig: () => {
    const s = get();
    if (!s.doc) { s.toast('No hay lienzo para restaurar', 'error'); return; }
    try {
      const raw = localStorage.getItem('lienzo-canvas-config');
      if (!raw) { s.toast('No hay configuración guardada', 'error'); return; }
      const cfg = JSON.parse(raw) as {
        width?: number; height?: number; guides?: Guide[]; zoom?: number; panX?: number; panY?: number;
      };
      if (cfg.width !== s.doc.width || cfg.height !== s.doc.height) {
        s.toast('La configuración guardada es de otro tamaño de lienzo', 'error');
        return;
      }
      set({
        guides: Array.isArray(cfg.guides) ? cfg.guides : [],
        zoom: typeof cfg.zoom === 'number' ? Math.max(0.02, Math.min(32, cfg.zoom)) : s.zoom,
        panX: typeof cfg.panX === 'number' ? cfg.panX : s.panX,
        panY: typeof cfg.panY === 'number' ? cfg.panY : s.panY,
      });
      s.toast('Configuración del lienzo restaurada');
    } catch {
      s.toast('No se pudo leer la configuración guardada', 'error');
    }
  },

  // ── layer transform ──
  setLayerBounds: (id, b) =>
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: {
          ...d,
          layers: d.layers.map((l) =>
            l.id === id ? { ...l, x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h) } : l,
          ),
        },
        dirty: true,
        rev: state.rev + 1,
      };
    }),

  setLayerRotation: (id, rotation) => {
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: { ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, rotation } : l)) },
        dirty: true,
        rev: state.rev + 1,
      };
    });
  },

  flipLayer: (id, axis) => {
    const layer = get().doc?.layers.find((candidate) => candidate.id === id);
    if (!layer || layer.kind === 'adjustment') return;
    if (layer.locked) {
      get().toast('La capa está bloqueada', 'error');
      return;
    }
    get().snapshot(axis === 'horizontal' ? 'Espejar capa horizontalmente' : 'Espejar capa verticalmente');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: {
          ...d,
          layers: d.layers.map((candidate) => candidate.id === id
            ? axis === 'horizontal'
              ? { ...candidate, flipX: !candidate.flipX }
              : { ...candidate, flipY: !candidate.flipY }
            : candidate),
        },
        dirty: true,
        rev: state.rev + 1,
      };
    });
  },

  bakeLayerTransform: (id) => {
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const l = d.layers.find((x) => x.id === id);
      if (!l || (l.w == null && l.h == null)) return {};
      const nw = Math.max(1, Math.round(l.w ?? l.canvas.width));
      const nh = Math.max(1, Math.round(l.h ?? l.canvas.height));
      let baked: Layer;
      if (l.vector || !l.text) {
        baked = {
          ...l,
          x: Math.round(l.x),
          y: Math.round(l.y),
          w: Math.max(1, Math.round(l.w ?? l.canvas.width)),
          h: Math.max(1, Math.round(l.h ?? l.canvas.height)),
        };
      } else if (l.text) {
        // Re-render text at the new size so it stays crisp and editable.
        const sy = nh / l.canvas.height;
        const sx = nw / l.canvas.width;
        const text: TextData = {
          ...l.text,
          size: Math.max(1, l.text.size * sy),
          letterSpacing: l.text.letterSpacing * sx,
        };
        const canvas = renderText(text);
        baked = { ...l, canvas, text, w: undefined, h: undefined, x: Math.round(l.x), y: Math.round(l.y), thumb: makeThumb(canvas) };
      } else if (nw === l.canvas.width && nh === l.canvas.height) {
        baked = { ...l, w: undefined, h: undefined, x: Math.round(l.x), y: Math.round(l.y) };
      } else {
        const c = createCanvas(nw, nh);
        const g = ctx2d(c);
        g.imageSmoothingQuality = 'high';
        g.drawImage(l.canvas, 0, 0, nw, nh);
        baked = { ...l, canvas: c, w: undefined, h: undefined, x: Math.round(l.x), y: Math.round(l.y), thumb: makeThumb(c) };
      }
      return {
        doc: { ...d, layers: d.layers.map((x) => (x.id === id ? baked : x)) },
        rev: state.rev + 1,
      };
    });

    // Placed vectors: the compositor scales the cached raster to w/h, which
    // goes soft. Re-rasterize from the source at the baked size in the
    // background and swap the cache in when ready — 1:1 draw, crisp again.
    const l = get().doc?.layers.find((x) => x.id === id);
    if (!l?.vector) return;
    const nw = Math.round(l.w ?? l.canvas.width);
    const nh = Math.round(l.h ?? l.canvas.height);
    if (nw === l.canvas.width && nh === l.canvas.height) return;
    const vec = l.vector;
    const scale = Math.min(
      Math.max(nw / vec.baseWidth, nh / vec.baseHeight),
      8192 / Math.max(vec.baseWidth, vec.baseHeight), // cap raster size
    );
    void vec.rasterize(Math.max(0.01, scale))
      .then((canvas) => {
        set((st) => {
          const d = st.doc;
          if (!d) return {};
          const cur = d.layers.find((x) => x.id === id);
          // Skip if the layer changed meanwhile (resized again, rasterized, deleted).
          if (!cur?.vector || Math.round(cur.w ?? 0) !== nw || Math.round(cur.h ?? 0) !== nh) return {};
          const updated = { ...cur, canvas, thumb: makeThumb(canvas) };
          return {
            doc: { ...d, layers: d.layers.map((x) => (x.id === id ? updated : x)) },
            rev: st.rev + 1,
          };
        });
      })
      .catch(() => { /* keep the scaled preview */ });
  },

  // ── text layers ──
  addTextLayer: (data, x, y) => {
    get().snapshot('Agregar texto');
    const canvas = renderText(data);
    const layer = makeLayer(canvas, textLayerName(data), Math.round(x), Math.round(y));
    layer.text = { ...data };
    let created: string | null = null;
    set((state) => {
      const d = state.doc;
      if (!d) {
        created = layer.id;
        return {
          doc: { width: canvas.width, height: canvas.height, layers: [layer], activeId: layer.id },
          rev: state.rev + 1,
        };
      }
      created = layer.id;
      return {
        doc: { ...d, layers: [...d.layers, layer], activeId: layer.id },
        rev: state.rev + 1,
      };
    });
    return created;
  },

  updateTextLayer: (id, data) =>
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const canvas = renderText(data);
      return {
        doc: {
          ...d,
          layers: d.layers.map((l) =>
            l.id === id
              ? { ...l, canvas, text: { ...data }, name: textLayerName(data), thumb: makeThumb(canvas), w: undefined, h: undefined }
              : l,
          ),
        },
        rev: state.rev + 1,
      };
    }),

  addVectorPath: async (points) => {
    if (points.length < 3) return;
    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxX = Math.max(...points.map((p) => p.x));
    const maxY = Math.max(...points.map((p) => p.y));
    const pad = 2;
    const w = Math.max(1, Math.ceil(maxX - minX + pad * 2));
    const h = Math.max(1, Math.ceil(maxY - minY + pad * 2));
    const commands = points.map((p, i) => `${i ? 'L' : 'M'} ${(p.x - minX + pad).toFixed(2)} ${(p.y - minY + pad).toFixed(2)}`).join(' ');
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${commands} Z" fill="${get().fgColor}" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1"/></svg>`;
    const src = svgSourceFromText(svgText);
    const preview = await src.rasterize(1);
    get().snapshot('Agregar trazado vectorial');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const layer = makeLayer(preview, 'Forma vectorial', Math.round(minX - pad), Math.round(minY - pad));
      layer.vector = { kind: 'placed', sourceType: 'svg', svgText, baseWidth: src.baseWidth, baseHeight: src.baseHeight, rasterize: src.rasterize };
      layer.w = src.baseWidth; layer.h = src.baseHeight;
      return { doc: { ...d, layers: [...d.layers, layer], activeId: layer.id }, rev: state.rev + 1 };
    });
  },

  setTool: (tool) => set({ tool }),
  setZoom: (zoom) => set({ zoom: Math.max(0.02, Math.min(32, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setBrush: (size, hardness) =>
    set((state) => {
      const next = {
        brushSize: size ?? state.brushSize,
        brushHardness: hardness ?? state.brushHardness,
      };
      useSettings.getState().setToolDefaults(next);
      return next;
    }),
  setWand: (tolerance, contiguous) =>
    set((state) => {
      const next = {
        wandTolerance: tolerance ?? state.wandTolerance,
        wandContiguous: contiguous ?? state.wandContiguous,
      };
      useSettings.getState().setToolDefaults(next);
      return next;
    }),
  setFgColor: (hex) => {
    set({ fgColor: hex });
  },
  setPrimaryColor: (hex) => {
    useSettings.getState().setToolDefaults({ fgColor: hex });
    set({ primaryColor: hex, fgColor: hex });
  },
  setEyedropperActive: (active) => set({ eyedropperActive: active, eyedropperPreview: null }),
  setEyedropperPreview: (hex) => set({ eyedropperPreview: hex }),
  commitEyedropperColor: (hex) => {
    useSettings.getState().setToolDefaults({ fgColor: hex });
    set({ primaryColor: hex, fgColor: hex, eyedropperActive: false, eyedropperPreview: null });
  },

  bucketFillAt: (p) => {
    const s = get();
    const layer = s.activeLayer();
    if (!layer) { s.toast('No hay ninguna capa activa', 'error'); return; }
    if (layer.vector || layer.text || layer.kind === 'group' || layer.kind === 'adjustment') {
      s.toast('Rasterizá la capa para pintar sobre ella', 'error');
      return;
    }
    s.snapshot('Rellenar área');
    const fresh = get().unshareActiveCanvas();
    if (!fresh) return;
    const ok = bucketFill(
      fresh, p, hexToRgb(s.fgColor), s.wandTolerance, s.wandContiguous, s.selection,
    );
    if (!ok) { s.toast('Nada para rellenar ahí', 'error'); return; }
    set({ rev: get().rev + 1 });
    s.refreshActiveThumb();
  },

  smartFillSelection: () => {
    const s = get();
    const d = s.doc;
    const layer = s.activeLayer();
    if (!d || !layer || !s.selection) {
      s.toast('Seleccioná el objeto que querés eliminar primero', 'error');
      return;
    }
    if (layer.vector || layer.text || layer.kind === 'group' || layer.kind === 'adjustment' || layer.rotation) {
      s.toast('Usá una capa raster sin rotación para el relleno inteligente', 'error');
      return;
    }
    s.snapshot('Relleno contextual');
    try {
      const mask = selectionMaskForLayer(s.selection, layer, d.width, d.height);
      const patch = contextualFill(layer.canvas, mask);
      const filled = makeLayer(patch, `${layer.name} · Relleno contextual`, layer.x, layer.y);
      filled.w = layer.w;
      filled.h = layer.h;
      filled.adjustments = cloneAdjustments(layer.adjustments);
      filled.blendMode = layer.blendMode;
      set((state) => {
        const doc = state.doc;
        if (!doc) return {};
        return { doc: { ...doc, layers: [...doc.layers, filled], activeId: filled.id }, rev: state.rev + 1 };
      });
      s.toast('Relleno contextual creado en una capa nueva');
    } catch {
      s.toast('No se pudo generar el relleno contextual', 'error');
    }
  },

  refineActiveTextLines: () => {
    const s = get();
    const layer = s.activeLayer();
    if (!layer) { s.toast('No hay ninguna capa activa', 'error'); return; }
    if (layer.locked || layer.lockPixels || layer.kind === 'group' || layer.kind === 'adjustment') {
      s.toast('Elegí una capa raster editable', 'error');
      return;
    }
    s.snapshot('Refinar texto y líneas');
    const fresh = s.unshareActiveCanvas();
    if (!fresh) return;
    fresh.canvas = refineTextAndLines(fresh.canvas);
    fresh.thumb = makeThumb(fresh.canvas);
    set({ rev: get().rev + 1 });
    s.toast('Texto y líneas refinados sin endurecer los bordes');
  },

  paintActiveStroke: (from, to, mode) => {
    const s = get();
    const layer = s.activeLayer();
    if (!layer || layer.locked || layer.lockPixels || layer.vector || layer.text || layer.kind === 'group' || layer.kind === 'adjustment') {
      if (layer?.locked || layer?.lockPixels) s.toast('La capa está bloqueada', 'error');
      return false;
    }
    const fresh = s.unshareActiveCanvas();
    if (!fresh) return false;
    const editingMask = s.maskTargetId === fresh.id && fresh.mask?.enabled;
    const target = editingMask ? fresh.mask!.canvas : fresh.canvas;
    const localFrom = { x: from.x - fresh.x, y: from.y - fresh.y };
    const localTo = { x: to.x - fresh.x, y: to.y - fresh.y };
    brushStroke(target, localFrom, localTo, s.brushSize, s.brushHardness, editingMask ? (mode === 'erase' ? '#ffffff' : '#000000') : s.fgColor, editingMask ? 'paint' : mode);
    bumpCanvasVersion(target);
    set({ rev: get().rev + 1 });
    if (!editingMask) s.refreshActiveThumb();
    return true;
  },
  setCursor: (cursor) => set({ cursor }),

  setBusy: (busy) => set({ busy }),
  toast: (msg, kind = 'info') => {
    const id = uid('t');
    set((state) => ({ toasts: [...state.toasts, { id, kind, msg }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  bump: () => set((state) => ({ rev: state.rev + 1 })),

  addArtboard: (board) => {
    get().snapshot('Agregar mesa de trabajo');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const artboard = { ...board, id: uid('ab'), w: Math.max(1, board.w), h: Math.max(1, board.h) };
      return { doc: { ...d, artboards: [...(d.artboards ?? []), artboard] }, rev: state.rev + 1 };
    });
  },
  updateArtboard: (id, patch) => set((state) => {
    const d = state.doc;
    if (!d) return {};
    return { doc: { ...d, artboards: (d.artboards ?? []).map((b) => b.id === id ? { ...b, ...patch, w: Math.max(1, patch.w ?? b.w), h: Math.max(1, patch.h ?? b.h) } : b) }, dirty: true, rev: state.rev + 1 };
  }),
  removeArtboard: (id) => {
    get().snapshot('Eliminar mesa de trabajo');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return { doc: { ...d, artboards: (d.artboards ?? []).filter((b) => b.id !== id) }, rev: state.rev + 1 };
    });
  },
}));

function textLayerName(data: TextData): string {
  const first = data.text.split('\n')[0].trim() || 'Texto';
  return first.length > 24 ? `${first.slice(0, 24)}…` : first;
}

// Convenience re-export used by a couple of ops that need a raw clone.
export { cloneCanvas };
