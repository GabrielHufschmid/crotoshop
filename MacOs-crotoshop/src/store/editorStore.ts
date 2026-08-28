import { create } from 'zustand';
import type { Adjustments, Artboard, BlendMode, Doc, Guide, Layer, PathfinderOperation, Pt, Selection, SelectionChannel, TextData, Tool, VectorData, VectorNode, VectorShape, VectorStyle, VectorizeOptions } from '../types';
import { DEFAULT_ADJUSTMENTS } from '../types';
import {
  cloneAdjustments,
  cloneCanvas,
  cloneLayer,
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
  invertSelection as invertSelectionMask,
  selectionFromMask,
  transformSelection,
  selectAll as buildSelectAll,
} from '../engine/selection';
import { bucketFill } from '../engine/fill';
import { hexToRgb } from '../engine/color';
import { renderText } from '../engine/text';
import { canvasToBlob } from '../engine/export';
import { flatten, renderLayerSource } from '../engine/compositor';
import { DEFAULT_TOOL_DEFAULTS, useSettings } from './settingsStore';
import { recolorSvgText, svgSourceFromText } from '../engine/import/svg';
import { brushStroke, type BrushMode } from '../engine/brush';
import { contextualFill, selectionMaskForLayer } from '../engine/inpaint';
import {
  alignSelectedLayers,
  distributeSelectedLayers,
  documentSizeToLayerPixels,
  documentToLayerPoint,
  layerToDocumentPoint,
  movableSelectionIds,
} from '../engine/layerGeometry';
import { refineTextAndLines } from '../engine/lineRefine';
import { canvasLimitMessage, isCanvasSizeAllowed } from '../engine/canvasLimits';
import { applyLayerMaskCanvas, effectiveLayerMask, invertLayerMaskCanvas } from '../engine/layerMask';
import { cloneDocumentSnapshot, trimHistoryEntries } from '../engine/history';
import {
  cloneEditableVector,
  makeEditableVector,
  mapVectorStyleGradients,
  normalizeVectorShapes,
  renderEditableVector,
} from '../engine/vectorPath';
import { editableVectorFromSvg, runPathfinder, simplifyVectorShapes } from '../engine/paperVector';
import { textToEditableVector } from '../engine/textToVector';
import { vectorizeCanvas } from '../engine/vectorize';
import { hasRoundableVectorCorners, rebuildVectorPrimitive, roundVectorShapeCorners } from '../engine/vectorPrimitives';

export interface Toast {
  id: string;
  kind: 'info' | 'error';
  msg: string;
}

export interface Busy {
  title: string;
  stage: string;
  fraction: number; // -1 = indeterminate
  cancellable?: boolean;
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
  changeId: string;
  savedChangeId: string | null;
  selectedLayerIds: string[];
  maskTargetId?: string | null;
}

export interface HistoryEntry {
  doc: Doc | null;
  label: string;
  guides: Guide[];
  changeId: string;
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
  changeId: string;
  savedChangeId: string | null;
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
  markTabSaved: (id: string) => void;
  workspaceTabs: () => EditorTab[];
  restoreWorkspace: (tabs: Array<Omit<EditorTab, 'past' | 'future' | 'selection' | 'rev' | 'dirty' | 'selectedLayerIds' | 'changeId' | 'savedChangeId'> & { dirty?: boolean }>, activeIndex: number) => void;
  openProject: (
    name: string,
    doc: Doc,
    guides: Guide[],
    view: { zoom: number; panX: number; panY: number },
  ) => void;
  replaceTabDocument: (
    id: string,
    name: string,
    doc: Doc,
    guides: Guide[],
    view: { zoom: number; panX: number; panY: number },
  ) => void;
  addLayerCanvas: (canvas: HTMLCanvasElement, name: string) => void;
  addLayerCanvasAt: (canvas: HTMLCanvasElement, name: string, x: number, y: number, snapshot?: boolean) => string | null;
  commitWarpResult: (sourceId: string, canvas: HTMLCanvasElement) => string | null;
  addEmptyLayer: () => void;
  duplicateSelectedLayers: () => void;
  mergeDown: () => void;
  mergeVisible: () => void;
  selectAdjacentLayer: (direction: -1 | 1) => void;
  moveSelectedLayerInStack: (direction: -1 | 1) => void;
  addVectorLayer: (vector: VectorData, preview: HTMLCanvasElement, name: string, asDocument?: boolean) => void;
  removeLayer: (id: string) => void;
  removeSelectedLayers: () => void;
  selectLayer: (id: string, mode?: 'replace' | 'toggle' | 'range') => void;
  toggleVisible: (id: string) => void;
  toggleSelectedVisibility: () => void;
  setOpacity: (id: string, opacity: number) => void; // no snapshot (gesture)
  setSelectedOpacity: (opacity: number) => void;
  renameLayer: (id: string, name: string) => void;
  reorderLayer: (fromId: string, toIndex: number) => void;
  addGroup: () => void;
  setLayerParent: (id: string, parentId?: string) => void;
  toggleLock: (id: string, pixels?: boolean) => void;
  toggleSelectedLock: (pixels?: boolean) => void;
  setLayerColorTag: (id: string, color?: string) => void;
  setBlendMode: (id: string, mode: BlendMode) => void;
  setSelectedBlendMode: (mode: BlendMode) => void;
  setSelectedInterpolation: (interpolation: 'smooth' | 'nearest') => void;
  addAdjustmentLayer: () => void;
  addLayerMask: (id: string) => void;
  setMaskEnabled: (id: string, enabled: boolean) => void;
  setMaskDensity: (id: string, density: number) => void;
  setMaskFeather: (id: string, feather: number) => void;
  invertLayerMask: (id: string) => void;
  applyLayerMask: (id: string) => void;
  removeLayerMask: (id: string) => void;
  setMaskTarget: (id: string | null) => void;

  // ── adjustments (gesture: snapshot handled by caller) ──
  setAdjustments: (id: string, patch: Partial<Adjustments>) => void;
  resetAdjustments: (id: string) => void;

  // ── transforms / raster ops ──
  moveActiveBy: (dx: number, dy: number) => void; // no snapshot (gesture)
  setLayerPosition: (id: string, x: number, y: number) => void; // no snapshot (gesture)
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
  invertSelection: () => void;
  saveSelectionChannel: (name?: string) => void;
  loadSelectionChannel: (id: string) => void;
  renameSelectionChannel: (id: string, name: string) => void;
  removeSelectionChannel: (id: string) => void;
  moveSelectionBy: (dx: number, dy: number) => void;
  deleteSelectionPixels: () => void;
  /**
   * Reemplaza la capa activa por una copia con canvas propio y la devuelve.
   * Obligatorio antes de cualquier mutación de píxeles in-place: el historial
   * copy-on-write comparte canvases entre snapshots (ver cloneDoc).
   */
  unshareActiveCanvas: () => Layer | null;
  /** Copies (or cuts) the active layer ∩ selection to the clipboard. */
  copySelection: (cut: boolean) => Promise<boolean>;
  /** Pastes the internal clipboard as a new layer; optionally preserves its document coordinates. */
  pasteInternal: (inPlace?: boolean) => boolean;
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
  setSelectedLayerBounds: (b: { x: number; y: number; w: number; h: number }) => void;
  setLayerRotation: (id: string, radians: number) => void;
  flipLayer: (id: string, axis: 'horizontal' | 'vertical') => void;
  flipSelectedLayers: (axis: 'horizontal' | 'vertical') => void;
  bakeLayerTransform: (id: string) => void;

  // ── text layers ──
  addTextLayer: (data: TextData, x: number, y: number) => string | null;
  updateTextLayer: (id: string, data: TextData) => void;
  addVectorPath: (nodes: VectorNode[], closed: boolean, style?: Partial<VectorStyle>) => string | null;
  addVectorShape: (shape: VectorShape, name?: string) => string | null;
  updateEditableVector: (id: string, vector: VectorData, refreshThumb?: boolean) => void;
  finishVectorEdit: (id: string) => void;
  setVectorStyle: (id: string, shapeId: string | null, patch: Partial<VectorStyle>, captureHistory?: boolean) => void;
  updateVectorPrimitive: (id: string, patch: Partial<NonNullable<VectorShape['primitive']>>, captureHistory?: boolean) => void;
  roundVectorCorners: (id: string, radius: number) => boolean;
  simplifyVectorLayer: (id: string, tolerance: number) => Promise<boolean>;
  makeCompoundPath: () => boolean;
  releaseCompoundPath: (id: string) => boolean;
  expandVectorLayer: (id: string) => Promise<boolean>;
  convertTextToCurves: (id: string) => Promise<boolean>;
  vectorizeLayer: (id: string, options: VectorizeOptions) => Promise<string | null>;
  applyPathfinder: (operation: PathfinderOperation, preserveOriginals?: boolean) => Promise<boolean>;

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
  paintActiveStroke: (from: Pt, to: Pt, mode: BrushMode, prepareCanvas?: boolean) => boolean;
  finishActiveStroke: () => void;
  setCursor: (c: { x: number; y: number } | null) => void;

  // ── ui ──
  setBusy: (b: Busy | null, cancel?: () => void) => void;
  cancelBusy: () => void;
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
const cloneDoc = cloneDocumentSnapshot;
const trimHistory = trimHistoryEntries;

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
    changeId: s.changeId,
    savedChangeId: s.savedChangeId,
    selectedLayerIds: s.selectedLayerIds,
    maskTargetId: s.maskTargetId,
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
  return {
    width: canvas.width,
    height: canvas.height,
    layers: [layer],
    activeId: layer.id,
    artboards: [],
    savedSelections: [],
  };
}

function whiteMask(w: number, h: number): HTMLCanvasElement {
  const mask = createCanvas(w, h);
  const g = ctx2d(mask);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, mask.width, mask.height);
  return mask;
}

function resampleCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const g = ctx2d(canvas);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function resizedMask(layer: Layer, width: number, height: number): Layer['mask'] {
  if (!layer.mask) return undefined;
  return {
    ...layer.mask,
    canvas: resampleCanvas(layer.mask.canvas, width, height),
  };
}

function fitEditableVectorLayer(layer: Layer, vector: VectorData): Layer {
  if (vector.kind !== 'editable' || !vector.shapes?.length) return layer;
  const normalized = normalizeVectorShapes(vector.shapes);
  const oldWidth = Math.max(1, vector.baseWidth);
  const oldHeight = Math.max(1, vector.baseHeight);
  const scaleX = (layer.w ?? oldWidth) / oldWidth;
  const scaleY = (layer.h ?? oldHeight) / oldHeight;
  const origin = layerToDocumentPoint(layer, normalized.offset, oldWidth, oldHeight);
  const displayWidth = normalized.width * scaleX;
  const displayHeight = normalized.height * scaleY;
  const angle = layer.rotation ?? 0;
  const halfX = (layer.flipX ? -1 : 1) * displayWidth / 2;
  const halfY = (layer.flipY ? -1 : 1) * displayHeight / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const centerX = origin.x + halfX * cos - halfY * sin;
  const centerY = origin.y + halfX * sin + halfY * cos;
  const nextVector = makeEditableVector(normalized.shapes, normalized.width, normalized.height);
  const canvas = renderEditableVector(nextVector);
  let mask = layer.mask;
  if (mask) {
    const shifted = createCanvas(canvas.width, canvas.height);
    ctx2d(shifted).drawImage(mask.canvas, -normalized.offset.x, -normalized.offset.y);
    mask = { ...mask, canvas: shifted };
  }
  return {
    ...layer,
    x: centerX - displayWidth / 2,
    y: centerY - displayHeight / 2,
    w: Math.abs(scaleX - 1) < 1e-6 ? undefined : displayWidth,
    h: Math.abs(scaleY - 1) < 1e-6 ? undefined : displayHeight,
    canvas,
    vector: nextVector,
    mask,
    text: undefined,
    thumb: makeThumb(canvas),
  };
}

function vectorShapeInDocument(layer: Layer, shape: VectorShape): VectorShape {
  const vector = layer.vector;
  if (!vector) return shape;
  const transform = (point: Pt) => layerToDocumentPoint(layer, point, vector.baseWidth, vector.baseHeight);
  return {
    ...shape,
    id: uid('shape'),
    primitive: undefined,
    style: mapVectorStyleGradients(shape.style, transform),
    subpaths: shape.subpaths.map((subpath) => ({
      ...subpath,
      id: uid('path'),
      nodes: subpath.nodes.map((node) => {
        const anchor = transform(node);
        const incoming = transform({ x: node.x + node.inX, y: node.y + node.inY });
        const outgoing = transform({ x: node.x + node.outX, y: node.y + node.outY });
        return {
          ...node,
          id: uid('node'),
          x: anchor.x,
          y: anchor.y,
          inX: incoming.x - anchor.x,
          inY: incoming.y - anchor.y,
          outX: outgoing.x - anchor.x,
          outY: outgoing.y - anchor.y,
        };
      }),
    })),
  };
}

function copyLayerPresentation(source: Layer, target: Layer): void {
  target.opacity = source.opacity;
  target.blendMode = source.blendMode;
  target.interpolation = source.interpolation;
  target.parentId = source.parentId;
  target.colorTag = source.colorTag;
}

function resizedSelectionChannel(channel: SelectionChannel, width: number, height: number): SelectionChannel | null {
  const mask = createCanvas(width, height);
  const context = ctx2d(mask);
  context.imageSmoothingEnabled = false;
  context.drawImage(channel.mask, 0, 0, width, height);
  const selection = selectionFromMask(mask);
  return selection ? { ...channel, mask, bounds: selection.bounds } : null;
}

function croppedSelectionChannel(
  channel: SelectionChannel,
  rect: { x: number; y: number; w: number; h: number },
  upscale: number,
): SelectionChannel | null {
  const width = Math.max(1, Math.round(rect.w) * upscale);
  const height = Math.max(1, Math.round(rect.h) * upscale);
  const mask = createCanvas(width, height);
  const context = ctx2d(mask);
  context.imageSmoothingEnabled = false;
  context.drawImage(channel.mask, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height);
  const selection = selectionFromMask(mask);
  return selection ? { ...channel, mask, bounds: selection.bounds } : null;
}

function selectedIds(state: Pick<EditorState, 'doc' | 'selectedLayerIds'>): string[] {
  if (!state.doc) return [];
  const ids = state.selectedLayerIds.filter((id) => state.doc!.layers.some((layer) => layer.id === id));
  return ids.length ? ids : state.doc.activeId ? [state.doc.activeId] : [];
}

function removeLayers(doc: Doc, ids: Set<string>): { doc: Doc; selectedLayerIds: string[] } {
  const removedGroups = new Set(doc.layers.filter((layer) => ids.has(layer.id) && layer.kind === 'group').map((layer) => layer.id));
  let layers = doc.layers
    .filter((layer) => !ids.has(layer.id))
    .map((layer) => layer.parentId && removedGroups.has(layer.parentId) ? { ...layer, parentId: undefined } : layer);
  if (!layers.length) {
    const blank = makeLayer(createCanvas(doc.width, doc.height), 'Capa 1');
    layers = [blank];
  }
  const activeId = layers.some((layer) => layer.id === doc.activeId)
    ? doc.activeId
    : layers[layers.length - 1].id;
  return { doc: { ...doc, layers, activeId }, selectedLayerIds: activeId ? [activeId] : [] };
}

/** In-app clipboard also keeps document coordinates for Paste in Place. */
let internalClipboard: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;
let activeStrokeClip: {
  layerId: string;
  target: HTMLCanvasElement;
  mask: HTMLCanvasElement | null;
  editingMask: boolean;
} | null = null;
let cancelBusyOperation: (() => void) | null = null;

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
  changeId: uid('change'),
  savedChangeId: null,
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
    const { doc, past, guides, changeId } = get();
    const next = trimHistory([...past, { doc: cloneDoc(doc), label, guides: [...guides], changeId }]);
    set({ past: next, future: [], changeId: uid('change'), dirty: true });
  },

  undo: () => {
    const { past, future, doc, guides, changeId, savedChangeId } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: trimHistory([...future, { doc: cloneDoc(doc), label: prev.label, guides: [...guides], changeId }]),
      doc: prev.doc,
      guides: prev.guides,
      rev: get().rev + 1,
      selection: null, // may reference stale doc geometry
      selectedLayerIds: prev.doc?.activeId ? [prev.doc.activeId] : [],
      maskTargetId: null,
      changeId: prev.changeId,
      dirty: prev.changeId !== savedChangeId,
    });
  },

  redo: () => {
    const { past, future, doc, guides, changeId, savedChangeId } = get();
    if (future.length === 0) return;
    const next = future[future.length - 1];
    set({
      future: future.slice(0, -1),
      past: trimHistory([...past, { doc: cloneDoc(doc), label: next.label, guides: [...guides], changeId }]),
      doc: next.doc,
      guides: next.guides,
      rev: get().rev + 1,
      selection: null,
      selectedLayerIds: next.doc?.activeId ? [next.doc.activeId] : [],
      maskTargetId: null,
      changeId: next.changeId,
      dirty: next.changeId !== savedChangeId,
    });
  },

  jumpToHistory: (index) => {
    const { past, future, doc, guides, changeId, savedChangeId } = get();
    if (index < 0 || index >= past.length) return;
    const target = past[index];
    const nextFuture = trimHistory([
      ...future,
      { doc: cloneDoc(doc), label: target.label, guides: [...guides], changeId },
      ...past.slice(index + 1),
    ]);
    set({
      past: past.slice(0, index),
      future: nextFuture,
      doc: target.doc,
      guides: target.guides,
      selection: null,
      selectedLayerIds: target.doc?.activeId ? [target.doc.activeId] : [],
      maskTargetId: null,
      changeId: target.changeId,
      dirty: target.changeId !== savedChangeId,
      rev: get().rev + 1,
    });
  },

  newDocument: (w, h, name = 'Sin título') => {
    const width = Math.round(w);
    const height = Math.round(h);
    if (!isCanvasSizeAllowed(width, height)) {
      get().toast(canvasLimitMessage(width, height), 'error');
      return;
    }
    const canvas = createCanvas(width, height);
    const id = uid('tab');
    const changeId = uid('change');
    const doc = makeDoc(canvas, 'Fondo');
    set((state) => ({
      tabs: [...saveActiveTab(state), {
        id, name, doc, past: [], future: [], selection: null, guides: [],
        zoom: 1, panX: 0, panY: 0, rev: state.rev + 1, dirty: true,
        changeId, savedChangeId: null, selectedLayerIds: [doc.activeId!],
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
      changeId,
      savedChangeId: null,
      selectedLayerIds: [doc.activeId!],
      maskTargetId: null,
    }));
  },

  newDocumentFromCanvas: (canvas, name) => {
    if (!isCanvasSizeAllowed(canvas.width, canvas.height)) {
      get().toast(canvasLimitMessage(canvas.width, canvas.height), 'error');
      return;
    }
    const id = uid('tab');
    const changeId = uid('change');
    const doc = makeDoc(canvas, name);
    set((state) => ({
      tabs: [...saveActiveTab(state), {
        id, name, doc, past: [], future: [], selection: null, guides: [],
        zoom: 1, panX: 0, panY: 0, rev: state.rev + 1, dirty: true,
        changeId, savedChangeId: null, selectedLayerIds: [doc.activeId!],
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
      changeId,
      savedChangeId: null,
      selectedLayerIds: [doc.activeId!],
      maskTargetId: null,
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
        changeId: tab.changeId,
        savedChangeId: tab.savedChangeId,
        selectedLayerIds: tab.selectedLayerIds,
        maskTargetId: tab.maskTargetId ?? null,
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
          changeId: uid('change'),
          savedChangeId: null,
          selectedLayerIds: [],
          maskTargetId: null,
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
        changeId: next.changeId,
        savedChangeId: next.savedChangeId,
        selectedLayerIds: next.selectedLayerIds,
        maskTargetId: next.maskTargetId ?? null,
      };
    });
  },

  markSaved: () => set((state) => {
    if (!state.activeTabId) return {};
    const savedChangeId = state.changeId;
    return {
      dirty: false,
      savedChangeId,
      tabs: saveActiveTab({ ...state, dirty: false, savedChangeId }),
    };
  }),

  markTabSaved: (id) => set((state) => {
    if (state.activeTabId === id) {
      const savedChangeId = state.changeId;
      return {
        dirty: false,
        savedChangeId,
        tabs: saveActiveTab({ ...state, dirty: false, savedChangeId }),
      };
    }
    return {
      tabs: state.tabs.map((tab) => tab.id === id
        ? { ...tab, dirty: false, savedChangeId: tab.changeId }
        : tab),
    };
  }),

  workspaceTabs: () => saveActiveTab(get()),

  restoreWorkspace: (incoming, activeIndex) => {
    const restored = incoming.map((tab) => {
      const changeId = uid('change');
      const dirty = tab.dirty ?? true;
      return {
        ...tab,
        id: uid('tab'),
        past: [],
        future: [],
        selection: null,
        rev: 1,
        dirty,
        changeId,
        savedChangeId: dirty ? null : changeId,
        selectedLayerIds: tab.doc?.activeId ? [tab.doc.activeId] : [],
      };
    });
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
      changeId: active?.changeId ?? uid('change'),
      savedChangeId: active?.savedChangeId ?? null,
      selectedLayerIds: active?.selectedLayerIds ?? [],
      maskTargetId: null,
    });
  },

  openProject: (name, doc, guides, view) => {
    const id = uid('tab');
    const changeId = uid('change');
    set((state) => ({
      tabs: [...saveActiveTab(state), {
        id, name, doc, past: [], future: [], selection: null, guides,
        zoom: view.zoom, panX: view.panX, panY: view.panY, rev: state.rev + 1, dirty: false,
        changeId, savedChangeId: changeId, selectedLayerIds: doc.activeId ? [doc.activeId] : [],
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
      changeId,
      savedChangeId: changeId,
      selectedLayerIds: doc.activeId ? [doc.activeId] : [],
      maskTargetId: null,
    }));
  },

  replaceTabDocument: (id, name, doc, guides, view) => {
    const changeId = uid('change');
    set((state) => {
      const tabs = saveActiveTab(state).map((tab) => tab.id === id ? {
        ...tab,
        name,
        doc,
        guides,
        zoom: view.zoom,
        panX: view.panX,
        panY: view.panY,
        past: [],
        future: [],
        selection: null,
        dirty: false,
        changeId,
        savedChangeId: changeId,
        selectedLayerIds: doc.activeId ? [doc.activeId] : [],
        maskTargetId: null,
      } : tab);
      if (state.activeTabId !== id) return { tabs };
      return {
        tabs,
        doc,
        guides,
        zoom: view.zoom,
        panX: view.panX,
        panY: view.panY,
        past: [],
        future: [],
        selection: null,
        dirty: false,
        changeId,
        savedChangeId: changeId,
        selectedLayerIds: doc.activeId ? [doc.activeId] : [],
        maskTargetId: null,
        rev: state.rev + 1,
      };
    });
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
          maskTargetId: null,
        };
      }
      const x = Math.round((d.width - canvas.width) / 2);
      const y = Math.round((d.height - canvas.height) / 2);
      const layer = makeLayer(canvas, name, x, y);
      return {
        doc: { ...d, layers: [...d.layers, layer], activeId: layer.id },
        rev: state.rev + 1,
        selectedLayerIds: [layer.id],
        maskTargetId: null,
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
          maskTargetId: null,
        };
      }
      return {
        doc: { ...d, layers: [...d.layers, layer], activeId: layer.id },
        rev: state.rev + 1,
        dirty: true,
        selectedLayerIds: [layer.id],
        maskTargetId: null,
      };
    });
    return id;
  },

  commitWarpResult: (sourceId, canvas) => {
    const source = get().doc?.layers.find((layer) => layer.id === sourceId);
    if (!source) return null;
    get().snapshot('Warp Mesh');
    let resultId: string | null = null;
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const sourceIndex = d.layers.findIndex((layer) => layer.id === sourceId);
      if (sourceIndex < 0) return {};
      const current = d.layers[sourceIndex];
      const warped = makeLayer(canvas, `${current.name} — Warp`, 0, 0);
      warped.parentId = current.parentId;
      warped.opacity = current.opacity;
      warped.blendMode = current.blendMode;
      warped.colorTag = current.colorTag;
      resultId = warped.id;
      const layers = d.layers.map((layer) => layer.id === sourceId ? { ...layer, visible: false } : layer);
      layers.splice(sourceIndex + 1, 0, warped);
      return {
        doc: { ...d, layers, activeId: warped.id },
        selectedLayerIds: [warped.id],
        maskTargetId: null,
        rev: state.rev + 1,
        dirty: true,
      };
    });
    return resultId;
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
      const activeIndex = doc.activeId ? doc.layers.findIndex((item) => item.id === doc.activeId) : -1;
      const layers = [...doc.layers];
      layers.splice(activeIndex >= 0 ? activeIndex + 1 : layers.length, 0, layer);
      return {
        doc: { ...doc, layers, activeId: layer.id },
        selectedLayerIds: [layer.id],
        maskTargetId: null,
        rev: state.rev + 1,
        dirty: true,
      };
    });
  },

  duplicateSelectedLayers: () => {
    const current = get();
    const d = current.doc;
    if (!d?.activeId) return;
    const ids = new Set(current.selectedLayerIds.length ? current.selectedLayerIds : [d.activeId]);
    current.snapshot(ids.size > 1 ? 'Duplicar capas' : 'Duplicar capa');
    set((state) => {
      const doc = state.doc;
      if (!doc) return {};
      const duplicates: string[] = [];
      const layers: Layer[] = [];
      for (const source of doc.layers) {
        layers.push(source);
        if (!ids.has(source.id)) continue;
        const copy = cloneLayer(source);
        copy.id = uid();
        copy.name = `${source.name} copia`;
        layers.push(copy);
        duplicates.push(copy.id);
      }
      if (!duplicates.length) return {};
      return {
        doc: { ...doc, layers, activeId: duplicates[duplicates.length - 1] },
        selectedLayerIds: duplicates,
        maskTargetId: null,
        rev: state.rev + 1,
        dirty: true,
      };
    });
  },

  mergeDown: () => {
    const current = get();
    const d = current.doc;
    const activeIndex = d?.activeId ? d.layers.findIndex((layer) => layer.id === d.activeId) : -1;
    if (!d || activeIndex <= 0) {
      current.toast('No hay una capa debajo para combinar', 'error');
      return;
    }
    const upper = d.layers[activeIndex];
    const lower = d.layers[activeIndex - 1];
    if (upper.kind === 'group' || lower.kind === 'group') {
      current.toast('Rasterizá los grupos antes de combinarlos', 'error');
      return;
    }
    current.snapshot('Combinar hacia abajo');
    const canvas = flatten({ ...d, layers: [lower, upper] });
    set((state) => {
      const doc = state.doc;
      if (!doc) return {};
      const merged = makeLayer(canvas, upper.name, 0, 0);
      if (upper.parentId === lower.parentId) merged.parentId = upper.parentId;
      const layers = [...doc.layers];
      layers.splice(activeIndex - 1, 2, merged);
      return {
        doc: { ...doc, layers, activeId: merged.id },
        selectedLayerIds: [merged.id],
        maskTargetId: null,
        selection: null,
        rev: state.rev + 1,
        dirty: true,
      };
    });
  },

  mergeVisible: () => {
    const current = get();
    const d = current.doc;
    if (!d || d.layers.filter((layer) => layer.visible).length < 2) {
      current.toast('Se necesitan al menos dos capas visibles', 'error');
      return;
    }
    current.snapshot('Combinar visibles');
    const canvas = flatten(d);
    set((state) => {
      const doc = state.doc;
      if (!doc) return {};
      const merged = makeLayer(canvas, 'Capas visibles combinadas', 0, 0);
      const layers = [...doc.layers.filter((layer) => !layer.visible), merged];
      return {
        doc: { ...doc, layers, activeId: merged.id },
        selectedLayerIds: [merged.id],
        maskTargetId: null,
        selection: null,
        rev: state.rev + 1,
        dirty: true,
      };
    });
  },

  selectAdjacentLayer: (direction) => {
    set((state) => {
      const d = state.doc;
      if (!d?.layers.length) return {};
      const index = d.activeId ? d.layers.findIndex((layer) => layer.id === d.activeId) : 0;
      const next = d.layers[Math.max(0, Math.min(d.layers.length - 1, index + direction))];
      return { doc: { ...d, activeId: next.id }, selectedLayerIds: [next.id], maskTargetId: null };
    });
  },

  moveSelectedLayerInStack: (direction) => {
    const current = get();
    const d = current.doc;
    const index = d?.activeId ? d.layers.findIndex((layer) => layer.id === d.activeId) : -1;
    if (!d || index < 0) return;
    const target = Math.max(0, Math.min(d.layers.length - 1, index + direction));
    if (target === index) return;
    current.snapshot(direction > 0 ? 'Subir capa' : 'Bajar capa');
    set((state) => {
      const doc = state.doc;
      if (!doc) return {};
      const layers = [...doc.layers];
      const [moved] = layers.splice(index, 1);
      layers.splice(target, 0, moved);
      return { doc: { ...doc, layers }, rev: state.rev + 1, dirty: true };
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
        const changeId = uid('change');
        const doc = {
          width: Math.round(vector.baseWidth),
          height: Math.round(vector.baseHeight),
          layers: [layer],
          activeId: layer.id,
          savedSelections: [],
        };
        return {
          tabs: [...saveActiveTab(state), {
            id, name, doc, past: [], future: [], selection: null, guides: [],
            zoom: 1, panX: 0, panY: 0, rev: state.rev + 1, dirty: true,
            changeId, savedChangeId: null, selectedLayerIds: [layer.id],
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
          changeId,
          savedChangeId: null,
          selectedLayerIds: [layer.id],
          maskTargetId: null,
        };
      }
      const d = state.doc;
      if (!d) {
        return {
          doc: { width: Math.round(vector.baseWidth), height: Math.round(vector.baseHeight), layers: [layer], activeId: layer.id },
          rev: state.rev + 1,
          dirty: true,
          selectedLayerIds: [layer.id],
          maskTargetId: null,
        };
      }
      const x = Math.round((d.width - vector.baseWidth) / 2);
      const y = Math.round((d.height - vector.baseHeight) / 2);
      return {
        doc: { ...d, layers: [...d.layers, { ...layer, x, y }], activeId: layer.id },
        rev: state.rev + 1,
        dirty: true,
        selectedLayerIds: [layer.id],
        maskTargetId: null,
      };
    });
  },

  removeLayer: (id) => {
    get().snapshot('Eliminar capa');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const next = removeLayers(d, new Set([id]));
      return { ...next, maskTargetId: state.maskTargetId === id ? null : state.maskTargetId, dirty: true, rev: state.rev + 1 };
    });
  },

  removeSelectedLayers: () => {
    const current = get();
    const ids = selectedIds(current);
    if (!current.doc || !ids.length) return;
    current.snapshot(ids.length > 1 ? `Eliminar ${ids.length} capas` : 'Eliminar capa');
    set((state) => {
      if (!state.doc) return {};
      const removed = new Set(ids);
      const next = removeLayers(state.doc, removed);
      return {
        ...next,
        maskTargetId: state.maskTargetId && removed.has(state.maskTargetId) ? null : state.maskTargetId,
        dirty: true,
        rev: state.rev + 1,
      };
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

  toggleSelectedVisibility: () => {
    const current = get();
    const ids = selectedIds(current);
    const active = current.doc?.layers.find((layer) => layer.id === current.doc?.activeId);
    if (!current.doc || !ids.length || !active) return;
    const visible = !active.visible;
    current.snapshot(visible ? 'Mostrar capas' : 'Ocultar capas');
    const selected = new Set(ids);
    set((state) => {
      if (!state.doc) return {};
      return {
        doc: { ...state.doc, layers: state.doc.layers.map((layer) => selected.has(layer.id) ? { ...layer, visible } : layer) },
        dirty: true,
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

  setSelectedOpacity: (opacity) =>
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const ids = new Set(selectedIds(state));
      return {
        doc: { ...d, layers: d.layers.map((layer) => ids.has(layer.id) ? { ...layer, opacity } : layer) },
        dirty: true,
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
      return { doc: { ...d, layers: [...d.layers, group], activeId: group.id }, selectedLayerIds: [group.id], maskTargetId: null, rev: state.rev + 1 };
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

  toggleSelectedLock: (pixels = false) => {
    const current = get();
    const ids = selectedIds(current);
    const active = current.doc?.layers.find((layer) => layer.id === current.doc?.activeId);
    if (!current.doc || !ids.length || !active) return;
    const locked = pixels ? !active.lockPixels : !active.locked;
    current.snapshot(pixels ? (locked ? 'Bloquear píxeles' : 'Desbloquear píxeles') : (locked ? 'Bloquear capas' : 'Desbloquear capas'));
    const selected = new Set(ids);
    set((state) => {
      if (!state.doc) return {};
      return {
        doc: { ...state.doc, layers: state.doc.layers.map((layer) => selected.has(layer.id)
          ? pixels ? { ...layer, lockPixels: locked } : { ...layer, locked }
          : layer) },
        dirty: true,
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

  setSelectedBlendMode: (blendMode) => {
    const current = get();
    const ids = selectedIds(current);
    if (!current.doc || !ids.length) return;
    current.snapshot('Cambiar modo de fusión');
    const selected = new Set(ids);
    set((state) => {
      if (!state.doc) return {};
      return {
        doc: { ...state.doc, layers: state.doc.layers.map((layer) => selected.has(layer.id) ? { ...layer, blendMode } : layer) },
        dirty: true,
        rev: state.rev + 1,
      };
    });
  },

  setSelectedInterpolation: (interpolation) => {
    const current = get();
    const ids = new Set(selectedIds(current));
    if (!current.doc || !ids.size) return;
    current.snapshot('Cambiar interpolación');
    set((state) => state.doc ? {
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => ids.has(layer.id) ? { ...layer, interpolation } : layer),
      },
      dirty: true,
      rev: state.rev + 1,
    } : {});
  },

  addAdjustmentLayer: () => {
    get().snapshot('Crear capa de ajuste');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const layer = makeLayer(createCanvas(1, 1), 'Ajuste');
      layer.kind = 'adjustment';
      layer.adjustmentLayer = cloneAdjustments(DEFAULT_ADJUSTMENTS);
      return { doc: { ...d, layers: [...d.layers, layer], activeId: layer.id }, selectedLayerIds: [layer.id], maskTargetId: null, rev: state.rev + 1 };
    });
  },

  addLayerMask: (id) => {
    const current = get();
    const layer = current.doc?.layers.find((candidate) => candidate.id === id);
    if (!current.doc || !layer || layer.mask || layer.kind === 'group' || layer.kind === 'adjustment') return;
    const canvas = current.selection
      ? selectionMaskForLayer(current.selection, layer, current.doc.width, current.doc.height)
      : whiteMask(layer.canvas.width, layer.canvas.height);
    current.snapshot(current.selection ? 'Crear máscara desde selección' : 'Agregar máscara');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: { ...d, layers: d.layers.map((l) => l.id === id
          ? { ...l, mask: { canvas, enabled: true, density: 1, feather: 0 } } : l) },
        selection: current.selection ? null : state.selection,
        maskTargetId: id,
        dirty: true,
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

  setMaskDensity: (id, density) => set((state) => {
    if (!state.doc) return {};
    const value = Math.max(0, Math.min(1, density));
    return {
      doc: { ...state.doc, layers: state.doc.layers.map((layer) => layer.id === id && layer.mask
        ? { ...layer, mask: { ...layer.mask, density: value } }
        : layer) },
      dirty: true,
      rev: state.rev + 1,
    };
  }),

  setMaskFeather: (id, feather) => set((state) => {
    if (!state.doc) return {};
    const value = Math.max(0, Math.min(250, feather));
    return {
      doc: { ...state.doc, layers: state.doc.layers.map((layer) => layer.id === id && layer.mask
        ? { ...layer, mask: { ...layer.mask, feather: value } }
        : layer) },
      dirty: true,
      rev: state.rev + 1,
    };
  }),

  invertLayerMask: (id) => {
    const current = get();
    const layer = current.doc?.layers.find((candidate) => candidate.id === id);
    if (!layer?.mask) return;
    current.snapshot('Invertir máscara');
    const canvas = invertLayerMaskCanvas(layer.mask.canvas);
    set((state) => state.doc ? {
      doc: { ...state.doc, layers: state.doc.layers.map((candidate) => candidate.id === id && candidate.mask
        ? { ...candidate, mask: { ...candidate.mask, canvas } }
        : candidate) },
      dirty: true,
      rev: state.rev + 1,
    } : {});
  },

  applyLayerMask: (id) => {
    const current = get();
    const layer = current.doc?.layers.find((candidate) => candidate.id === id);
    if (!layer?.mask || layer.locked || layer.lockPixels) {
      if (layer?.locked || layer?.lockPixels) current.toast('La capa está bloqueada', 'error');
      return;
    }
    current.snapshot('Aplicar máscara');
    const canvas = applyLayerMaskCanvas(layer.canvas, layer.mask);
    set((state) => state.doc ? {
      doc: { ...state.doc, layers: state.doc.layers.map((candidate) => candidate.id === id
        ? {
            ...candidate,
            canvas,
            mask: undefined,
            text: undefined,
            vector: undefined,
            kind: 'raster',
            w: candidate.w ?? canvas.width,
            h: candidate.h ?? canvas.height,
            thumb: makeThumb(canvas),
          }
        : candidate) },
      maskTargetId: state.maskTargetId === id ? null : state.maskTargetId,
      dirty: true,
      rev: state.rev + 1,
    } : {});
  },

  removeLayerMask: (id) => {
    const current = get();
    const layer = current.doc?.layers.find((candidate) => candidate.id === id);
    if (!layer?.mask) return;
    current.snapshot('Eliminar máscara');
    set((state) => state.doc ? {
      doc: { ...state.doc, layers: state.doc.layers.map((candidate) => candidate.id === id
        ? { ...candidate, mask: undefined }
        : candidate) },
      maskTargetId: state.maskTargetId === id ? null : state.maskTargetId,
      dirty: true,
      rev: state.rev + 1,
    } : {});
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

  setLayerPosition: (id, x, y) =>
    set((state) => {
      const d = state.doc;
      const layer = d?.layers.find((candidate) => candidate.id === id);
      if (!d || !layer || layer.locked || layer.kind === 'adjustment') return {};
      if (layer.x === x && layer.y === y) return {};
      return {
        doc: {
          ...d,
          layers: d.layers.map((candidate) => candidate.id === id ? { ...candidate, x, y } : candidate),
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
        selectedLayerIds: [id],
        maskTargetId: null,
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
    if (!isCanvasSizeAllowed(outputW, outputH)) {
      current.toast(`${canvasLimitMessage(outputW, outputH)} Reducí el recorte o el upscale.`, 'error');
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
          savedSelections: d.savedSelections?.flatMap((channel) => {
            const cropped = croppedSelectionChannel(channel, rect, upscale);
            return cropped ? [cropped] : [];
          }),
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
    const width = Math.round(w);
    const height = Math.round(h);
    if (!isCanvasSizeAllowed(width, height)) {
      get().toast(canvasLimitMessage(width, height), 'error');
      return;
    }
    get().snapshot('Redimensionar lienzo');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const sx = width / d.width;
      const sy = height / d.height;
      const layers = d.layers.map((l) => {
        const x = l.x * sx;
        const y = l.y * sy;
        const displayW = (l.w ?? l.canvas.width) * sx;
        const displayH = (l.h ?? l.canvas.height) * sy;

        if (l.kind === 'group' || l.kind === 'adjustment') {
          return {
            ...l,
            x,
            y,
            w: l.w == null ? undefined : displayW,
            h: l.h == null ? undefined : displayH,
          };
        }

        if (l.text) {
          const text: TextData = {
            ...l.text,
            size: Math.max(1, l.text.size * sy),
            letterSpacing: l.text.letterSpacing * sx,
          };
          const canvas = renderText(text);
          return {
            ...l,
            canvas,
            text,
            mask: resizedMask(l, canvas.width, canvas.height),
            x,
            y,
            w: displayW,
            h: displayH,
            thumb: makeThumb(canvas),
          };
        }

        const sourceW = Math.max(1, Math.round(l.canvas.width * sx));
        const sourceH = Math.max(1, Math.round(l.canvas.height * sy));
        if (!isCanvasSizeAllowed(sourceW, sourceH)) {
          return { ...l, x, y, w: displayW, h: displayH };
        }

        const canvas = resampleCanvas(l.canvas, sourceW, sourceH);
        return {
          ...l,
          canvas,
          mask: resizedMask(l, sourceW, sourceH),
          x,
          y,
          w: l.w == null ? undefined : displayW,
          h: l.h == null ? undefined : displayH,
          thumb: makeThumb(canvas),
        };
      });
      return {
        doc: {
          ...d,
          width,
          height,
          layers,
          artboards: d.artboards?.map((board) => ({
            ...board,
            x: board.x * sx,
            y: board.y * sy,
            w: board.w * sx,
            h: board.h * sy,
          })),
          savedSelections: d.savedSelections?.flatMap((channel) => {
            const resized = resizedSelectionChannel(channel, width, height);
            return resized ? [resized] : [];
          }),
        },
        guides: state.guides.map((g) => ({ ...g, pos: g.pos * (g.axis === 'x' ? sx : sy) })),
        selection: null,
        dirty: true,
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

  invertSelection: () => {
    const s = get();
    if (!s.selection) return;
    set({ selection: invertSelectionMask(s.selection) });
  },

  saveSelectionChannel: (name) => {
    const current = get();
    if (!current.doc || !current.selection) {
      current.toast('No hay una selección para guardar', 'error');
      return;
    }
    if ((current.doc.savedSelections?.length ?? 0) >= 100) {
      current.toast('El documento alcanzó el límite de 100 selecciones guardadas', 'error');
      return;
    }
    current.snapshot('Guardar selección');
    const channel: SelectionChannel = {
      id: uid('sel'),
      name: name?.trim() || `Selección ${(current.doc.savedSelections?.length ?? 0) + 1}`,
      mask: cloneCanvas(current.selection.mask),
      bounds: { ...current.selection.bounds },
    };
    set((state) => state.doc ? {
      doc: { ...state.doc, savedSelections: [...(state.doc.savedSelections ?? []), channel] },
      dirty: true,
      rev: state.rev + 1,
    } : {});
    current.toast('Selección guardada');
  },

  loadSelectionChannel: (id) => {
    const channel = get().doc?.savedSelections?.find((candidate) => candidate.id === id);
    if (!channel) return;
    set({ selection: { mask: cloneCanvas(channel.mask), bounds: { ...channel.bounds }, shape: null } });
  },

  renameSelectionChannel: (id, name) => {
    const value = name.trim();
    const current = get();
    if (!value || !current.doc?.savedSelections?.some((channel) => channel.id === id && channel.name !== value)) return;
    current.snapshot('Renombrar selección');
    set((state) => state.doc ? {
      doc: {
        ...state.doc,
        savedSelections: state.doc.savedSelections?.map((channel) => channel.id === id ? { ...channel, name: value } : channel),
      },
      dirty: true,
      rev: state.rev + 1,
    } : {});
  },

  removeSelectionChannel: (id) => {
    const current = get();
    if (!current.doc?.savedSelections?.some((channel) => channel.id === id)) return;
    current.snapshot('Eliminar selección guardada');
    set((state) => state.doc ? {
      doc: { ...state.doc, savedSelections: state.doc.savedSelections?.filter((channel) => channel.id !== id) },
      dirty: true,
      rev: state.rev + 1,
    } : {});
  },

  moveSelectionBy: (dx, dy) => {
    const s = get();
    if (!s.doc || !s.selection) return;
    const bounds = s.selection.bounds;
    set({
      selection: transformSelection(
        s.selection,
        { ...bounds, x: bounds.x + dx, y: bounds.y + dy },
        s.doc.width,
        s.doc.height,
      ),
    });
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
    internalClipboard = { canvas: ex.canvas, x: ex.x, y: ex.y };
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

  pasteInternal: (inPlace = false) => {
    if (!internalClipboard) return false;
    if (inPlace) {
      get().addLayerCanvasAt(
        cloneCanvas(internalClipboard.canvas),
        'Pegado en el lugar',
        internalClipboard.x,
        internalClipboard.y,
      );
      get().toast('Pegado en la posición original');
    } else {
      get().addLayerCanvas(cloneCanvas(internalClipboard.canvas), 'Pegado');
    }
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
            l.id === id && !l.locked ? { ...l, x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h) } : l,
          ),
        },
        dirty: true,
        rev: state.rev + 1,
      };
    }),

  setSelectedLayerBounds: (bounds) =>
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const ids = new Set(selectedIds(state));
      const selected = d.layers.filter((layer) => ids.has(layer.id) && layer.kind !== 'group' && layer.kind !== 'adjustment' && !layer.locked);
      if (!selected.length) return {};
      const sourceBounds = selected.map((layer) => ({
        layer,
        x: layer.x,
        y: layer.y,
        w: layer.w ?? layer.canvas.width,
        h: layer.h ?? layer.canvas.height,
      }));
      const left = Math.min(...sourceBounds.map((item) => item.x));
      const top = Math.min(...sourceBounds.map((item) => item.y));
      const right = Math.max(...sourceBounds.map((item) => item.x + item.w));
      const bottom = Math.max(...sourceBounds.map((item) => item.y + item.h));
      const sourceW = Math.max(1, right - left);
      const sourceH = Math.max(1, bottom - top);
      const nextW = Math.max(1, bounds.w);
      const nextH = Math.max(1, bounds.h);
      const sx = nextW / sourceW;
      const sy = nextH / sourceH;
      const byId = new Map(sourceBounds.map((item) => [item.layer.id, item]));
      return {
        doc: {
          ...d,
          layers: d.layers.map((layer) => {
            const item = byId.get(layer.id);
            if (!item) return layer;
            return {
              ...layer,
              x: bounds.x + (item.x - left) * sx,
              y: bounds.y + (item.y - top) * sy,
              w: Math.max(1, item.w * sx),
              h: Math.max(1, item.h * sy),
            };
          }),
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
        doc: { ...d, layers: d.layers.map((l) => (l.id === id && !l.locked ? { ...l, rotation } : l)) },
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

  flipSelectedLayers: (axis) => {
    const current = get();
    const ids = selectedIds(current);
    const allowed = new Set(current.doc?.layers
      .filter((layer) => ids.includes(layer.id) && layer.kind !== 'adjustment' && !layer.locked)
      .map((layer) => layer.id) ?? []);
    if (!current.doc || !allowed.size) {
      current.toast('No hay capas desbloqueadas para espejar', 'error');
      return;
    }
    current.snapshot(axis === 'horizontal' ? 'Espejar capas horizontalmente' : 'Espejar capas verticalmente');
    set((state) => {
      if (!state.doc) return {};
      return {
        doc: {
          ...state.doc,
          layers: state.doc.layers.map((layer) => allowed.has(layer.id)
            ? axis === 'horizontal' ? { ...layer, flipX: !layer.flipX } : { ...layer, flipY: !layer.flipY }
            : layer),
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
          selectedLayerIds: [layer.id],
          maskTargetId: null,
          rev: state.rev + 1,
        };
      }
      created = layer.id;
      return {
        doc: { ...d, layers: [...d.layers, layer], activeId: layer.id },
        selectedLayerIds: [layer.id],
        maskTargetId: null,
        rev: state.rev + 1,
      };
    });
    return created;
  },

  updateTextLayer: (id, data) =>
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const target = d.layers.find((layer) => layer.id === id);
      if (!target?.text || target.locked || target.lockPixels) return {};
      const canvas = renderText(data);
      return {
        doc: {
          ...d,
          layers: d.layers.map((l) =>
            l.id === id
              ? {
                  ...l,
                  canvas,
                  text: { ...data },
                  name: textLayerName(data),
                  mask: resizedMask(l, canvas.width, canvas.height),
                  thumb: makeThumb(canvas),
                  w: l.w == null ? undefined : canvas.width * (l.w / l.canvas.width),
                  h: l.h == null ? undefined : canvas.height * (l.h / l.canvas.height),
                }
              : l,
          ),
        },
        rev: state.rev + 1,
      };
    }),

  addVectorPath: (nodes, closed, stylePatch = {}) => {
    if (nodes.length < (closed ? 3 : 2)) return null;
    const style: VectorStyle = {
      fill: closed ? get().fgColor : null,
      stroke: closed ? null : get().fgColor,
      strokeWidth: 2,
      opacity: 1,
      fillRule: 'nonzero',
      lineCap: 'round',
      lineJoin: 'round',
      miterLimit: 4,
      ...stylePatch,
    };
    const shape = {
      id: uid('shape'),
      name: 'Trazado',
      subpaths: [{ id: uid('path'), nodes: nodes.map((node) => ({ ...node })), closed }],
      style,
    };
    const normalized = normalizeVectorShapes([shape]);
    const vector = makeEditableVector(normalized.shapes, normalized.width, normalized.height);
    const preview = renderEditableVector(vector);
    let created: string | null = null;
    get().snapshot('Agregar trazado vectorial');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const layer = makeLayer(preview, closed ? 'Forma vectorial' : 'Trazado vectorial', normalized.offset.x, normalized.offset.y);
      layer.vector = vector;
      created = layer.id;
      return {
        doc: { ...d, layers: [...d.layers, layer], activeId: layer.id },
        selectedLayerIds: [layer.id],
        maskTargetId: null,
        tool: 'vector-node',
        rev: state.rev + 1,
      };
    });
    return created;
  },

  addVectorShape: (shape, name = shape.name ?? 'Forma vectorial') => {
    const normalized = normalizeVectorShapes([shape]);
    const vector = makeEditableVector(normalized.shapes, normalized.width, normalized.height);
    const preview = renderEditableVector(vector);
    let created: string | null = null;
    get().snapshot('Agregar forma vectorial');
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      const layer = makeLayer(preview, name, normalized.offset.x, normalized.offset.y);
      layer.vector = vector;
      created = layer.id;
      return {
        doc: { ...d, layers: [...d.layers, layer], activeId: layer.id },
        selectedLayerIds: [layer.id],
        maskTargetId: null,
        rev: state.rev + 1,
        dirty: true,
      };
    });
    return created;
  },

  updateEditableVector: (id, vector, refreshThumb = false) => {
    if (vector.kind !== 'editable' || !vector.shapes) return;
    const runtime = cloneEditableVector(vector);
    const canvas = renderEditableVector(runtime);
    set((state) => {
      const d = state.doc;
      if (!d) return {};
      return {
        doc: {
          ...d,
          layers: d.layers.map((layer) => {
            if (layer.id !== id || layer.vector?.kind !== 'editable') return layer;
            const mask = layer.mask && (layer.canvas.width !== canvas.width || layer.canvas.height !== canvas.height)
              ? resizedMask(layer, canvas.width, canvas.height)
              : layer.mask;
            return {
              ...layer,
              canvas,
              vector: runtime,
              mask,
              thumb: refreshThumb ? makeThumb(canvas) : layer.thumb,
            };
          }),
        },
        dirty: true,
        rev: state.rev + 1,
      };
    });
  },

  finishVectorEdit: (id) => {
    set((state) => {
      const d = state.doc;
      const layer = d?.layers.find((candidate) => candidate.id === id);
      if (!d || !layer?.vector || layer.vector.kind !== 'editable') return {};
      const fitted = fitEditableVectorLayer(layer, layer.vector);
      return {
        doc: { ...d, layers: d.layers.map((candidate) => candidate.id === id ? fitted : candidate) },
        dirty: true,
        rev: state.rev + 1,
      };
    });
  },

  setVectorStyle: (id, shapeId, patch, captureHistory = true) => {
    const current = get();
    const layer = current.doc?.layers.find((candidate) => candidate.id === id);
    if (!layer?.vector?.shapes || layer.vector.kind !== 'editable') return;
    if (captureHistory) current.snapshot('Editar apariencia vectorial');
    const shapes = layer.vector.shapes.map((shape) => (
      !shapeId || shape.id === shapeId ? { ...shape, style: { ...shape.style, ...patch } } : shape
    ));
    const vector = makeEditableVector(shapes, layer.vector.baseWidth, layer.vector.baseHeight);
    const fitted = fitEditableVectorLayer(layer, vector);
    set((state) => state.doc ? {
      doc: { ...state.doc, layers: state.doc.layers.map((candidate) => candidate.id === id ? fitted : candidate) },
      dirty: true,
      rev: state.rev + 1,
    } : {});
  },

  updateVectorPrimitive: (id, patch, captureHistory = true) => {
    const current = get();
    const layer = current.doc?.layers.find((candidate) => candidate.id === id);
    if (!layer?.vector?.shapes || layer.vector.kind !== 'editable' || !layer.vector.shapes.some((shape) => shape.primitive)) return;
    if (captureHistory) current.snapshot('Editar forma vectorial');
    const shapes = layer.vector.shapes.map((shape) => shape.primitive ? rebuildVectorPrimitive(shape, patch) : shape);
    const fitted = fitEditableVectorLayer(layer, makeEditableVector(shapes, layer.vector.baseWidth, layer.vector.baseHeight));
    set((state) => state.doc ? {
      doc: { ...state.doc, layers: state.doc.layers.map((candidate) => candidate.id === id ? fitted : candidate) },
      dirty: true,
      rev: state.rev + 1,
    } : {});
  },

  roundVectorCorners: (id, radius) => {
    const current = get();
    const layer = current.doc?.layers.find((candidate) => candidate.id === id);
    if (!layer?.vector?.shapes || layer.vector.kind !== 'editable' || !layer.vector.shapes.some(hasRoundableVectorCorners)) return false;
    current.snapshot('Redondear esquinas vectoriales');
    const shapes = layer.vector.shapes.map((shape) => hasRoundableVectorCorners(shape) ? roundVectorShapeCorners(shape, Math.max(0, radius)) : shape);
    const fitted = fitEditableVectorLayer(layer, makeEditableVector(shapes, layer.vector.baseWidth, layer.vector.baseHeight));
    set((state) => state.doc ? {
      doc: { ...state.doc, layers: state.doc.layers.map((candidate) => candidate.id === id ? fitted : candidate) },
      dirty: true,
      rev: state.rev + 1,
    } : {});
    return true;
  },

  simplifyVectorLayer: async (id, tolerance) => {
    const current = get();
    const layer = current.doc?.layers.find((candidate) => candidate.id === id);
    if (!layer?.vector?.shapes || layer.vector.kind !== 'editable' || layer.locked) return false;
    try {
      const shapes = await simplifyVectorShapes(layer.vector.shapes, Math.max(0.01, tolerance));
      const latest = get();
      const target = latest.doc?.layers.find((candidate) => candidate.id === id);
      if (!target?.vector || target.vector !== layer.vector) {
        latest.toast('La capa cambió antes de terminar la simplificación', 'error');
        return false;
      }
      latest.snapshot('Simplificar trazado vectorial');
      const fitted = fitEditableVectorLayer(target, makeEditableVector(shapes, target.vector.baseWidth, target.vector.baseHeight));
      set((state) => state.doc ? {
        doc: { ...state.doc, layers: state.doc.layers.map((candidate) => candidate.id === id ? fitted : candidate) },
        dirty: true,
        rev: state.rev + 1,
      } : {});
      return true;
    } catch (error) {
      current.toast(error instanceof Error ? error.message : 'No se pudo simplificar el trazado', 'error');
      return false;
    }
  },

  makeCompoundPath: () => {
    const current = get();
    const d = current.doc;
    if (!d) return false;
    const ids = new Set(selectedIds(current));
    const vectors = d.layers.filter((layer) => ids.has(layer.id) && layer.vector?.kind === 'editable' && !layer.locked);
    const documentShapes = vectors.flatMap((layer) => layer.vector!.shapes!.map((shape) => vectorShapeInDocument(layer, shape)));
    const subpaths = documentShapes.flatMap((shape) => shape.subpaths);
    if (!vectors.length || subpaths.length < 2) {
      current.toast('Seleccioná dos formas vectoriales o una capa con varios trazados', 'error');
      return false;
    }
    const topVector = vectors[vectors.length - 1];
    const sourceStyle = documentShapes[documentShapes.length - 1]?.style;
    if (!sourceStyle) return false;
    const compound: VectorShape = {
      id: uid('shape'),
      name: 'Trazado compuesto',
      subpaths,
      style: { ...sourceStyle, dashArray: sourceStyle.dashArray ? [...sourceStyle.dashArray] : undefined, fillRule: 'evenodd' },
    };
    const normalized = normalizeVectorShapes([compound]);
    const vector = makeEditableVector(normalized.shapes, normalized.width, normalized.height);
    const result = makeLayer(renderEditableVector(vector), 'Trazado compuesto', normalized.offset.x, normalized.offset.y);
    result.vector = vector;
    copyLayerPresentation(topVector, result);
    result.parentId = vectors.every((layer) => layer.parentId === topVector.parentId) ? topVector.parentId : undefined;
    const removed = new Set(vectors.map((layer) => layer.id));
    const topIndex = Math.max(...vectors.map((layer) => d.layers.indexOf(layer)));
    const insertion = d.layers.slice(0, topIndex).filter((layer) => !removed.has(layer.id)).length;
    current.snapshot('Crear trazado compuesto');
    set((state) => {
      if (!state.doc) return {};
      const layers = state.doc.layers.filter((layer) => !removed.has(layer.id));
      layers.splice(Math.min(insertion, layers.length), 0, result);
      return {
        doc: { ...state.doc, layers, activeId: result.id },
        selectedLayerIds: [result.id],
        maskTargetId: null,
        tool: 'vector-node',
        dirty: true,
        rev: state.rev + 1,
      };
    });
    return true;
  },

  releaseCompoundPath: (id) => {
    const current = get();
    const d = current.doc;
    const layer = d?.layers.find((candidate) => candidate.id === id);
    if (!d || !layer?.vector?.shapes || layer.vector.kind !== 'editable' || layer.locked) return false;
    if (layer.mask) {
      current.toast('Aplicá o eliminá la máscara antes de liberar el trazado compuesto', 'error');
      return false;
    }
    const documentShapes = layer.vector.shapes.map((shape) => vectorShapeInDocument(layer, shape));
    const entries = documentShapes.flatMap((shape) => shape.subpaths.map((subpath) => ({ shape, subpath })));
    if (entries.length < 2) {
      current.toast('Esta capa no contiene un trazado compuesto', 'error');
      return false;
    }
    const results = entries.map(({ shape, subpath }, index) => {
      const single: VectorShape = {
        ...shape,
        id: uid('shape'),
        name: shape.name ? `${shape.name} ${index + 1}` : `Trazado ${index + 1}`,
        subpaths: [{ ...subpath, id: uid('path'), nodes: subpath.nodes.map((node) => ({ ...node, id: uid('node') })) }],
        style: { ...shape.style, dashArray: shape.style.dashArray ? [...shape.style.dashArray] : undefined, fillRule: 'nonzero' },
      };
      const normalized = normalizeVectorShapes([single]);
      const vector = makeEditableVector(normalized.shapes, normalized.width, normalized.height);
      const result = makeLayer(renderEditableVector(vector), single.name ?? `Trazado ${index + 1}`, normalized.offset.x, normalized.offset.y);
      result.vector = vector;
      copyLayerPresentation(layer, result);
      return result;
    });
    const index = d.layers.indexOf(layer);
    current.snapshot('Liberar trazado compuesto');
    set((state) => {
      if (!state.doc) return {};
      const layers = state.doc.layers.filter((candidate) => candidate.id !== id);
      layers.splice(Math.max(0, Math.min(index, layers.length)), 0, ...results);
      const activeId = results[results.length - 1].id;
      return {
        doc: { ...state.doc, layers, activeId },
        selectedLayerIds: results.map((result) => result.id),
        maskTargetId: null,
        tool: 'vector-node',
        dirty: true,
        rev: state.rev + 1,
      };
    });
    return true;
  },

  expandVectorLayer: async (id) => {
    const current = get();
    const layer = current.doc?.layers.find((candidate) => candidate.id === id);
    if (!layer?.vector) return false;
    if (layer.vector.kind === 'editable') {
      current.toast('La capa ya contiene nodos editables');
      return true;
    }
    if (!layer.vector.svgText) {
      current.toast('Este formato no conserva trazados expandibles; usá Vectorizar imagen', 'error');
      return false;
    }
    try {
      const vector = await editableVectorFromSvg(layer.vector.svgText, layer.vector.baseWidth, layer.vector.baseHeight);
      const canvas = renderEditableVector(vector);
      current.snapshot('Expandir vector');
      set((state) => {
        if (!state.doc) return {};
        return {
          doc: {
            ...state.doc,
            layers: state.doc.layers.map((candidate) => candidate.id === id
              ? { ...candidate, canvas, vector, thumb: makeThumb(canvas) }
              : candidate),
          },
          tool: 'vector-node',
          dirty: true,
          rev: state.rev + 1,
        };
      });
      return true;
    } catch (error) {
      current.toast(error instanceof Error ? error.message : 'No se pudo expandir el vector', 'error');
      return false;
    }
  },

  convertTextToCurves: async (id) => {
    const current = get();
    const layer = current.doc?.layers.find((candidate) => candidate.id === id);
    if (!layer?.text) return false;
    current.setBusy({ title: 'Texto a curvas', stage: `Leyendo ${layer.text.family}…`, fraction: -1 });
    try {
      const vector = await textToEditableVector(layer.text, layer.canvas.width, layer.canvas.height);
      const canvas = renderEditableVector(vector);
      current.snapshot('Convertir texto a curvas');
      set((state) => {
        if (!state.doc) return {};
        return {
          doc: {
            ...state.doc,
            layers: state.doc.layers.map((candidate) => candidate.id === id
              ? { ...candidate, name: `${candidate.name} (curvas)`, text: undefined, vector, canvas, thumb: makeThumb(canvas) }
              : candidate),
          },
          tool: 'vector-node',
          dirty: true,
          rev: state.rev + 1,
        };
      });
      return true;
    } catch (error) {
      current.toast(error instanceof Error ? error.message : 'No se pudo convertir el texto', 'error');
      return false;
    } finally {
      get().setBusy(null);
    }
  },

  vectorizeLayer: async (id, options) => {
    const current = get();
    const d = current.doc;
    const layer = d?.layers.find((candidate) => candidate.id === id);
    if (!d || !layer || layer.kind === 'group' || layer.kind === 'adjustment') return null;
    current.setBusy({ title: 'Vectorizar imagen', stage: 'Trazando contornos editables…', fraction: -1 });
    try {
      const source = renderLayerSource(layer);
      const traceCanvas = createCanvas(source.width, source.height);
      const context = ctx2d(traceCanvas);
      context.drawImage(source, 0, 0);
      if (layer.mask?.enabled) {
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(effectiveLayerMask(layer.mask), 0, 0, traceCanvas.width, traceCanvas.height);
      }
      if (current.selection) {
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(selectionMaskForLayer(current.selection, layer, d.width, d.height), 0, 0);
      }
      context.globalCompositeOperation = 'source-over';
      const vector = await vectorizeCanvas(traceCanvas, options, current.fgColor);
      const canvas = renderEditableVector(vector);
      const tracedLayer = makeLayer(canvas, `${layer.name} (vector)`, layer.x, layer.y);
      tracedLayer.vector = vector;
      tracedLayer.w = layer.w;
      tracedLayer.h = layer.h;
      tracedLayer.rotation = layer.rotation;
      tracedLayer.flipX = layer.flipX;
      tracedLayer.flipY = layer.flipY;
      tracedLayer.opacity = layer.opacity;
      tracedLayer.blendMode = layer.blendMode;
      tracedLayer.parentId = layer.parentId;
      const result = fitEditableVectorLayer(tracedLayer, vector);
      current.snapshot('Vectorizar imagen');
      set((state) => {
        if (!state.doc) return {};
        const index = state.doc.layers.findIndex((candidate) => candidate.id === id);
        const layers = options.preserveOriginal
          ? state.doc.layers.map((candidate) => candidate.id === id ? { ...candidate, visible: false } : candidate)
          : state.doc.layers.filter((candidate) => candidate.id !== id);
        layers.splice(Math.max(0, Math.min(layers.length, options.preserveOriginal ? index + 1 : index)), 0, result);
        return {
          doc: { ...state.doc, layers, activeId: result.id },
          selectedLayerIds: [result.id],
          maskTargetId: null,
          tool: 'vector-node',
          dirty: true,
          rev: state.rev + 1,
        };
      });
      return result.id;
    } catch (error) {
      current.toast(error instanceof Error ? error.message : 'No se pudo vectorizar la capa', 'error');
      return null;
    } finally {
      get().setBusy(null);
    }
  },

  applyPathfinder: async (operation, preserveOriginals = false) => {
    const current = get();
    const d = current.doc;
    if (!d) return false;
    const selected = d.layers.filter((layer) => current.selectedLayerIds.includes(layer.id));
    const vectors = selected.filter((layer) => layer.vector?.kind === 'editable' && !layer.locked);
    if (vectors.length < 2) {
      current.toast('Pathfinder necesita al menos dos capas vectoriales editables', 'error');
      return false;
    }
    try {
      const topVector = vectors[vectors.length - 1];
      const sourceStyle = topVector.vector!.shapes?.[0]?.style;
      const resultStyle = sourceStyle ? mapVectorStyleGradients(sourceStyle, (point) => (
        layerToDocumentPoint(topVector, point, topVector.vector!.baseWidth, topVector.vector!.baseHeight)
      )) : undefined;
      const shapes = await runPathfinder(vectors.map((layer) => ({
        vector: layer.vector!,
        transform: (point) => layerToDocumentPoint(layer, point, layer.vector!.baseWidth, layer.vector!.baseHeight),
      })), operation, resultStyle);
      const normalized = normalizeVectorShapes(shapes);
      const vector = makeEditableVector(normalized.shapes, normalized.width, normalized.height);
      const canvas = renderEditableVector(vector);
      const names = { unite: 'Unión', subtract: 'Resta', intersect: 'Intersección', exclude: 'Exclusión' } as const;
      const result = makeLayer(canvas, `Pathfinder: ${names[operation]}`, normalized.offset.x, normalized.offset.y);
      result.vector = vector;
      const sharedParent = vectors.every((layer) => layer.parentId === vectors[0].parentId) ? vectors[0].parentId : undefined;
      result.parentId = sharedParent;
      current.snapshot(`Pathfinder: ${names[operation]}`);
      set((state) => {
        if (!state.doc) return {};
        const selectedIds = new Set(vectors.map((layer) => layer.id));
        const layers = preserveOriginals
          ? [...state.doc.layers]
          : state.doc.layers.filter((layer) => !selectedIds.has(layer.id));
        const topIndex = Math.max(...vectors.map((layer) => state.doc!.layers.indexOf(layer)));
        layers.splice(Math.min(layers.length, topIndex + (preserveOriginals ? 1 : 0)), 0, result);
        return {
          doc: { ...state.doc, layers, activeId: result.id },
          selectedLayerIds: [result.id],
          maskTargetId: null,
          tool: 'vector-node',
          dirty: true,
          rev: state.rev + 1,
        };
      });
      return true;
    } catch (error) {
      current.toast(error instanceof Error ? error.message : 'Falló la operación Pathfinder', 'error');
      return false;
    }
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
    if (layer.locked || layer.lockPixels) {
      s.toast('La capa está bloqueada', 'error');
      return;
    }
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
    if (layer.vector || layer.text || layer.kind === 'group' || layer.kind === 'adjustment') {
      s.toast('Elegí una capa raster editable para el relleno inteligente', 'error');
      return;
    }
    s.snapshot('Relleno contextual');
    try {
      const mask = selectionMaskForLayer(s.selection, layer, d.width, d.height);
      const patch = contextualFill(layer.canvas, mask);
      const filled = makeLayer(patch, `${layer.name} · Relleno contextual`, layer.x, layer.y);
      filled.w = layer.w;
      filled.h = layer.h;
      filled.rotation = layer.rotation;
      filled.flipX = layer.flipX;
      filled.flipY = layer.flipY;
      filled.opacity = layer.opacity;
      filled.adjustments = cloneAdjustments(layer.adjustments);
      filled.blendMode = layer.blendMode;
      filled.parentId = layer.parentId;
      filled.colorTag = layer.colorTag;
      set((state) => {
        const doc = state.doc;
        if (!doc) return {};
        return {
          doc: { ...doc, layers: [...doc.layers, filled], activeId: filled.id },
          selectedLayerIds: [filled.id],
          maskTargetId: null,
          rev: state.rev + 1,
        };
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

  paintActiveStroke: (from, to, mode, prepareCanvas = true) => {
    const s = get();
    const layer = s.activeLayer();
    if (!layer || layer.locked || layer.lockPixels || layer.vector || layer.text || layer.kind === 'group' || layer.kind === 'adjustment') {
      if (layer?.locked || layer?.lockPixels) s.toast('La capa está bloqueada', 'error');
      return false;
    }
    const fresh = prepareCanvas ? s.unshareActiveCanvas() : layer;
    if (!fresh) return false;
    const editingMask = s.maskTargetId === fresh.id && fresh.mask?.enabled === true;
    const target = editingMask ? fresh.mask!.canvas : fresh.canvas;
    if (prepareCanvas) {
      activeStrokeClip = {
        layerId: fresh.id,
        target,
        editingMask,
        mask: s.selection && s.doc
          ? selectionMaskForLayer(s.selection, fresh, s.doc.width, s.doc.height, target.width, target.height)
          : null,
      };
    }
    const clip = activeStrokeClip?.layerId === fresh.id && activeStrokeClip.target === target
      ? activeStrokeClip.mask
      : null;
    const localFrom = documentToLayerPoint(fresh, from, target.width, target.height);
    const localTo = documentToLayerPoint(fresh, to, target.width, target.height);
    const localBrushSize = documentSizeToLayerPixels(fresh, s.brushSize, target.width, target.height);
    brushStroke(
      target,
      localFrom,
      localTo,
      localBrushSize,
      s.brushHardness,
      editingMask ? '#ffffff' : s.fgColor,
      editingMask ? (mode === 'erase' ? 'paint' : 'erase') : mode,
      clip,
    );
    bumpCanvasVersion(target);
    return true;
  },
  finishActiveStroke: () => {
    const stroke = activeStrokeClip;
    activeStrokeClip = null;
    if (!stroke) return;
    if (stroke.editingMask) set((state) => {
      const d = state.doc;
      if (!d) return { rev: state.rev + 1 };
      return {
        doc: {
          ...d,
          layers: d.layers.map((layer) => layer.id === stroke.layerId && layer.mask
            ? { ...layer, mask: { ...layer.mask } }
            : layer),
        },
        rev: state.rev + 1,
      };
    });
    else get().refreshActiveThumb();
  },
  setCursor: (cursor) => set({ cursor }),

  setBusy: (busy, cancel) => {
    if (!busy) cancelBusyOperation = null;
    else if (cancel) cancelBusyOperation = cancel;
    set((state) => ({
      busy: busy && state.busy?.cancellable && state.busy.title === busy.title && busy.cancellable == null
        ? { ...busy, cancellable: true }
        : busy,
    }));
  },
  cancelBusy: () => {
    const cancel = cancelBusyOperation;
    cancelBusyOperation = null;
    set({ busy: null });
    cancel?.();
  },
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
