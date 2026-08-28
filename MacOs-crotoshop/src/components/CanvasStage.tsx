import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import type React from 'react';
import { useEditor } from '../store/editorStore';
import {
  CANVAS_BACKGROUND_MOTION_CHECKER,
  CANVAS_BACKGROUND_MOTION_DIAGONAL,
  cropRatio,
  useSettings,
} from '../store/settingsStore';
import type { CropUpscale } from '../store/settingsStore';
import { composite } from '../engine/compositor';
import {
  clearSelectionPixels,
  combineSelections,
  createTransformedSelectionLayer,
  cropMask,
  extractSelection,
  flattenBezier,
  magicWand,
  magicWandCanvas,
  selectionContains,
  selectionFromShape,
  shapeBounds,
  shapePath,
  transformSelection,
} from '../engine/selection';
import type { BezierNode, SelectionCombineMode } from '../engine/selection';
import { DEFAULT_ADJUSTMENTS } from '../types';
import type { Layer, Pt, Selection, SelectionShape, VectorData, VectorNode, VectorShape, VectorSubpath } from '../types';
import { GuideLines, Rulers } from './RulersGuides';
import { ToolOptions } from './ToolOptions';
import { Icon } from './Icons';
import { documentToLayerPoint, layerBounds, layerToDocumentPoint } from '../engine/layerGeometry';
import { hexToRgb, rgbToHex } from '../engine/color';
import { selectObjectWithAi } from '../engine/aiSelection';
import {
  pixelStretchSource,
  renderPixelStretch,
  resolvePixelStretchSample,
  samplePixelStretchPath,
  type PixelStretchNode,
  type PixelStretchSample,
} from '../engine/pixelStretch';
import {
  createWarpMesh,
  renderWarpMesh,
  sampleWarpSurface,
  warpLayerSource,
  type WarpMesh,
} from '../engine/warpMesh';
import { desktop } from '../desktop/native';
import {
  constrainBoundsSize,
  normalizeRect,
  resizeBounds,
  rotatePoint,
  rotatedBounds,
  type Bounds,
  type HandleId,
} from '../engine/transformGeometry';
import { buildSnapCandidates, snapBoundsToCandidates } from '../engine/snapping';
import { recordComposite } from '../store/performanceStore';
import {
  cloneEditableVector,
  convertVectorNode,
  createVectorNode,
  findVectorNode,
  makeEditableVector,
  mapVectorNodes,
  nearestVectorSegment,
  paintVectorShape,
  setVectorNodeHandle,
  shapePath2D,
  splitVectorSegment,
} from '../engine/vectorPath';
import { createVectorPrimitive, primitiveName } from '../engine/vectorPrimitives';

export interface StageHandle {
  fit: () => void;
  actualPixels: () => void;
}

interface Props {
  onImport: () => void;
  onNewDocument: () => void;
  onNewFromClipboard: () => void;
  onEditText: (layerId: string) => void;
  onNewText: (pt: Pt) => void;
  editingTextLayerId: string | null;
}

interface CropRect { x: number; y: number; w: number; h: number; }
interface VectorControlHit {
  nodeId: string;
  shapeId: string;
  subpathId: string;
  kind: 'node' | 'in' | 'out';
}

interface VectorDragStart {
  layerId: string;
  vector: VectorData;
  pointerLocal: Pt;
  nodeId?: string;
  handle?: 'in' | 'out';
  selectedBefore: Set<string>;
  changed: boolean;
}
interface FloatingSelection {
  source: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  bounds: Bounds;
  angle: number;
  layerId: string;
  layerName: string;
  originalSelection: Selection;
  originalCanvas: HTMLCanvasElement;
  originalX: number;
  originalY: number;
  replaceLayer: boolean;
}

const HANDLES: { id: HandleId; ux: number; uy: number; cursor: string }[] = [
  { id: 'nw', ux: 0, uy: 0, cursor: 'nwse-resize' },
  { id: 'n', ux: 0.5, uy: 0, cursor: 'ns-resize' },
  { id: 'ne', ux: 1, uy: 0, cursor: 'nesw-resize' },
  { id: 'e', ux: 1, uy: 0.5, cursor: 'ew-resize' },
  { id: 'se', ux: 1, uy: 1, cursor: 'nwse-resize' },
  { id: 's', ux: 0.5, uy: 1, cursor: 'ns-resize' },
  { id: 'sw', ux: 0, uy: 1, cursor: 'nesw-resize' },
  { id: 'w', ux: 0, uy: 0.5, cursor: 'ew-resize' },
];

const CROP_HANDLES = HANDLES.filter((h) => h.ux !== 0.5 && h.uy !== 0.5);

const SNAP_SCREEN_PX = 8;
const MAX_CROP_DIMENSION = 32_768;

/** Topmost visible text layer whose display bounds contain the point. */
function hitTextLayer(p: Pt): string | null {
  const d = useEditor.getState().doc;
  if (!d) return null;
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const l = d.layers[i];
    if (!l.text || !l.visible) continue;
    const bounds = layerBounds(l);
    const point = l.rotation ? rotatePoint(p, bounds, -l.rotation) : p;
    if (
      point.x >= bounds.x
      && point.y >= bounds.y
      && point.x <= bounds.x + bounds.w
      && point.y <= bounds.y + bounds.h
    ) return l.id;
  }
  return null;
}

function measuredComposite(target: HTMLCanvasElement, sourceDoc: NonNullable<ReturnType<typeof useEditor.getState>['doc']>): void {
  const started = performance.now();
  composite(target, sourceDoc);
  recordComposite(performance.now() - started);
}

export const CanvasStage = forwardRef<StageHandle, Props>(function CanvasStage(
  { onImport, onNewDocument, onNewFromClipboard, onEditText, onNewText, editingTextLayerId }, ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const antsRef = useRef<HTMLCanvasElement>(null);
  const eyedropperLoupeRef = useRef<HTMLDivElement>(null);
  const eyedropperCanvasRef = useRef<HTMLCanvasElement>(null);
  const eyedropperCodeRef = useRef<HTMLSpanElement>(null);
  const eyedropperSwatchRef = useRef<HTMLSpanElement>(null);
  const brushCursorRef = useRef<HTMLDivElement>(null);
  const lastEyedropperColorRef = useRef<string | null>(null);
  const eyedropperErrorRef = useRef(false);
  const paintRenderRafRef = useRef(0);
  const cursorRafRef = useRef(0);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const vectorHitCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const doc = useEditor((s) => s.doc);
  const activeTabId = useEditor((s) => s.activeTabId);
  const rev = useEditor((s) => s.rev);
  const zoom = useEditor((s) => s.zoom);
  const panX = useEditor((s) => s.panX);
  const panY = useEditor((s) => s.panY);
  const tool = useEditor((s) => s.tool);
  const brushSize = useEditor((s) => s.brushSize);
  const selection = useEditor((s) => s.selection);
  const selectedLayerIds = useEditor((s) => s.selectedLayerIds);
  const maskTargetId = useEditor((s) => s.maskTargetId);
  const eyedropperActive = useEditor((s) => s.eyedropperActive);
  const showGuides = useSettings((s) => s.showGuides);
  const canvasBgColor = useSettings((s) => s.canvasBgColor);
  const solidCanvasBgColor = canvasBgColor?.startsWith('#') ? canvasBgColor : null;
  const cropAspect = useSettings((s) => s.cropAspect);
  const cropVertical = useSettings((s) => s.cropVertical);
  const cropUpscale = useSettings((s) => s.cropUpscale);
  const setCropUpscale = useSettings((s) => s.setCropUpscale);
  const pixelStretchOptionsKey = useSettings((s) => JSON.stringify([
    s.toolDefaults.pixelStretchSampleWidth,
    s.toolDefaults.pixelStretchOutputWidth,
    s.toolDefaults.pixelStretchOpacity,
    s.toolDefaults.pixelStretchFadeStart,
    s.toolDefaults.pixelStretchFadeEnd,
    s.toolDefaults.pixelStretchTwist,
    s.toolDefaults.pixelStretchPattern,
    s.toolDefaults.pixelStretchSource,
    s.toolDefaults.pixelStretchReverse,
    s.toolDefaults.pixelStretchSmoothing,
    s.toolDefaults.pixelStretchCurveMode,
    s.toolDefaults.pixelStretchCurveSmoothness,
    s.toolDefaults.pixelStretchTaperStart,
    s.toolDefaults.pixelStretchTaperEnd,
    s.toolDefaults.pixelStretchEdgeFeather,
  ]));
  const warpMeshColumns = useSettings((s) => s.toolDefaults.warpMeshColumns);
  const warpMeshRows = useSettings((s) => s.toolDefaults.warpMeshRows);
  const warpMeshSmoothing = useSettings((s) => s.toolDefaults.warpMeshSmoothing);
  const warpMeshFluidity = useSettings((s) => s.toolDefaults.warpMeshFluidity);
  const vectorNodeMode = useSettings((s) => s.toolDefaults.vectorNodeMode);

  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [snapLines, setSnapLines] = useState<{ x?: number; y?: number } | null>(null);
  const [emptyMenu, setEmptyMenu] = useState(false);
  const [floating, setFloatingState] = useState<FloatingSelection | null>(null);
  const [, setStretchRevision] = useState(0);
  const [stretchEditMode, setStretchEditMode] = useState<'path' | 'sample'>('path');
  const stretchEditModeRef = useRef(stretchEditMode);
  const [warpRevision, setWarpRevision] = useState(0);
  const floatingRef = useRef<FloatingSelection | null>(null);
  const commitFloatingSelectionRef = useRef<(createLayer?: boolean) => void>(() => {});
  const floatingCanvasRef = useRef<HTMLCanvasElement>(null);

  const setFloating = useCallback((next: FloatingSelection | null) => {
    floatingRef.current = next;
    setFloatingState(next);
    // `selection` queda en null mientras hay contenido flotante (ver
    // beginFloatingSelection) — este flag deja que otros atajos (Supr) sepan
    // que "sin selección" acá significa "en medio de un gesto", no "no hay
    // nada seleccionado".
    useEditor.getState().setSelectionTransformActive(next !== null);
  }, []);

  // Mirrors `cropRect` for the keydown effect below, which subscribes once on
  // mount — without this, its closure would keep seeing the initial (null)
  // crop rect and Enter would silently cancel instead of applying.
  const cropRectRef = useRef<CropRect | null>(null);
  useEffect(() => { cropRectRef.current = cropRect; }, [cropRect]);
  useEffect(() => { stretchEditModeRef.current = stretchEditMode; }, [stretchEditMode]);

  // Selection drafts live in refs: the marching-ants rAF loop reads them each
  // frame, so no React re-renders are needed while drawing.
  const draftShapeRef = useRef<SelectionShape | null>(null);
  const vectorShapeDraftRef = useRef<VectorShape | null>(null);
  const polyRef = useRef<Pt[]>([]);
  const vectorRef = useRef<VectorNode[]>([]);
  const vectorClosedRef = useRef(false);
  const vectorSelectedNodesRef = useRef<Set<string>>(new Set());
  const vectorHoverRef = useRef<VectorControlHit | { kind: 'segment'; point: Pt } | null>(null);
  const vectorMarqueeRef = useRef<Bounds | null>(null);
  const vectorDragStartRef = useRef<VectorDragStart | null>(null);
  const bezierRef = useRef<BezierNode[]>([]);
  const stretchNodesRef = useRef<PixelStretchNode[]>([]);
  const stretchSampleRef = useRef<PixelStretchSample | null>(null);
  const stretchSampleDragRef = useRef<{ sample: PixelStretchSample; pointer: Pt; width: number } | null>(null);
  const stretchPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const stretchSelectedNodeRef = useRef(-1);
  const stretchRenderRafRef = useRef(0);
  const warpMeshRef = useRef<WarpMesh | null>(null);
  const warpPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const warpLayerIdRef = useRef<string | null>(null);
  const warpSelectedNodeRef = useRef(-1);
  const warpDragStartRef = useRef<Pt[]>([]);
  const warpRenderRafRef = useRef(0);
  const hoverRef = useRef<Pt | null>(null);
  const draftModeRef = useRef<SelectionCombineMode>('replace');
  const maskTintRef = useRef<{ mask: HTMLCanvasElement; tint: HTMLCanvasElement } | null>(null);
  const wandPreviewRef = useRef<Selection | null>(null);
  const wandBaseRef = useRef<Selection | null>(null);
  const maskPreviewRef = useRef(false);

  const drag = useRef<{
    mode: 'move' | 'text-edit-move' | 'pan' | 'paint' | 'crop' | 'select-shape' | 'bezier-place' | 'selection-move' | 'wand-tolerance' | 'poly-node' | 'vector-shape' | 'vector-place' | 'vector-node' | 'vector-handle' | 'vector-marquee' | 'stretch-place' | 'stretch-node' | 'stretch-handle' | 'stretch-sample-move' | 'stretch-sample-angle' | 'warp-node' | null;
    lastX: number; lastY: number;      // screen
    startX: number;
    lastDocX: number; lastDocY: number; // doc
    startDocX: number; startDocY: number;
    startBounds: Bounds | null;
    startTolerance: number;
    nodeIndex: number;
    handleSide: -1 | 0 | 1;
    moved: boolean;
  }>({ mode: null, lastX: 0, lastY: 0, startX: 0, lastDocX: 0, lastDocY: 0, startDocX: 0, startDocY: 0, startBounds: null, startTolerance: 0, nodeIndex: -1, handleSide: 0, moved: false });

  // ── Recomposite whenever pixels/layers change ──
  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    if (tool === 'warp-mesh' && warpPreviewRef.current && warpLayerIdRef.current) {
      compositeWarpPreview();
    } else {
      measuredComposite(canvasRef.current, doc);
    }
  }, [rev, doc, tool, warpRevision]);

  useEffect(() => {
    if (eyedropperActive && doc) return;
    if (eyedropperLoupeRef.current) eyedropperLoupeRef.current.style.display = 'none';
    lastEyedropperColorRef.current = null;
    useEditor.getState().setEyedropperPreview(null);
    if (!doc && eyedropperActive) useEditor.getState().setEyedropperActive(false);
  }, [doc, eyedropperActive]);

  useEffect(() => () => {
    if (paintRenderRafRef.current) cancelAnimationFrame(paintRenderRafRef.current);
    if (cursorRafRef.current) cancelAnimationFrame(cursorRafRef.current);
    useEditor.getState().finishActiveStroke();
  }, []);

  useEffect(() => {
    if (!['eraser', 'brush', 'blur', 'sharpen'].includes(tool) && brushCursorRef.current) {
      brushCursorRef.current.style.display = 'none';
    }
  }, [tool]);

  useEffect(() => {
    if (tool === 'ai-mask' && desktop) void desktop.warmAi().catch(() => undefined);
  }, [tool]);

  // ── Fit view helper ──
  const fit = useCallback(() => {
    const cont = containerRef.current;
    const d = useEditor.getState().doc;
    if (!cont || !d) return;
    const cw = cont.clientWidth;
    const ch = cont.clientHeight;
    const z = Math.min((cw - 48) / d.width, (ch - 48) / d.height, 8);
    const zoom2 = Math.max(0.02, z);
    useEditor.getState().setZoom(zoom2);
    useEditor.getState().setPan(
      Math.round((cw - d.width * zoom2) / 2),
      Math.round((ch - d.height * zoom2) / 2),
    );
  }, []);

  const actualPixels = useCallback(() => {
    const cont = containerRef.current;
    const d = useEditor.getState().doc;
    if (!cont || !d) return;
    useEditor.getState().setZoom(1);
    useEditor.getState().setPan(
      Math.round((cont.clientWidth - d.width) / 2),
      Math.round((cont.clientHeight - d.height) / 2),
    );
  }, []);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const cont = containerRef.current;
    if (!cont) return;
    const s = useEditor.getState();
    const rect = cont.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const docX = (cx - s.panX) / s.zoom;
    const docY = (cy - s.panY) / s.zoom;
    const nextZoom = Math.max(0.02, Math.min(32, s.zoom * factor));
    s.setZoom(nextZoom);
    s.setPan(cx - docX * nextZoom, cy - docY * nextZoom);
  }, []);

  useImperativeHandle(ref, () => ({ fit, actualPixels }), [fit, actualPixels]);

  useEffect(() => {
    if (!floating || !floatingCanvasRef.current) return;
    const c = floatingCanvasRef.current;
    if (c.width !== floating.source.width || c.height !== floating.source.height) {
      c.width = floating.source.width;
      c.height = floating.source.height;
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(floating.source, 0, 0);
  }, [floating?.source, floating]);

  // Auto-fit when the document dimensions change (new import, crop, resize).
  const dimKey = doc ? `${doc.width}x${doc.height}` : '';
  const prevDim = useRef('');
  useEffect(() => {
    if (dimKey && dimKey !== prevDim.current) {
      prevDim.current = dimKey;
      fit();
    }
    if (!dimKey) prevDim.current = '';
  }, [dimKey, fit]);

  useEffect(() => {
    if (tool === 'pixel-stretch' && stretchNodesRef.current.length >= 2) schedulePixelStretchPreview();
  }, [pixelStretchOptionsKey, rev, selection, tool]);

  useEffect(() => () => {
    if (stretchRenderRafRef.current) cancelAnimationFrame(stretchRenderRafRef.current);
    if (warpRenderRafRef.current) cancelAnimationFrame(warpRenderRafRef.current);
  }, []);

  function cancelDrafts() {
    draftShapeRef.current = null;
    vectorShapeDraftRef.current = null;
    polyRef.current = [];
    vectorRef.current = [];
    vectorClosedRef.current = false;
    bezierRef.current = [];
    draftModeRef.current = 'replace';
    wandPreviewRef.current = null;
    wandBaseRef.current = null;
    cancelPixelStretch();
    cancelWarpMesh();
  }

  function selectionMode(e: Pick<MouseEvent | PointerEvent | React.PointerEvent, 'shiftKey' | 'altKey'>) {
    if (e.shiftKey && e.altKey) return 'intersect' as const;
    if (e.altKey) return 'subtract' as const;
    if (e.shiftKey) return 'add' as const;
    return useSettings.getState().toolDefaults.selectionCombineMode;
  }

  function commitSelection(next: Selection | null, mode: SelectionCombineMode) {
    const s = useEditor.getState();
    s.setSelection(combineSelections(s.selection, next, mode));
  }

  async function commitAiSelection(point: Pt, mode: SelectionCombineMode) {
    const s = useEditor.getState();
    const layer = s.activeLayer();
    const currentDoc = s.doc;
    if (!layer || !currentDoc) {
      s.toast('No hay ninguna capa activa', 'error');
      return;
    }
    if (s.busy) return;
    let canceled = false;
    s.setBusy(
      { title: 'Máscara IA', stage: 'Detectando el objeto…', fraction: -1, cancellable: true },
      () => { canceled = true; void desktop?.cancelAi().catch(() => undefined); },
    );
    try {
      const confidence = useSettings.getState().toolDefaults.aiMaskConfidence;
      const next = await selectObjectWithAi(layer, currentDoc, point, confidence);
      if (canceled) return;
      if (!next) {
        s.toast('No se detectó un objeto en ese punto. Probá bajar la confianza.', 'error');
        return;
      }
      const latest = useEditor.getState();
      latest.setSelection(combineSelections(latest.selection, next, mode));
      latest.toast('Objeto seleccionado con IA');
    } catch (error) {
      if (!canceled) s.toast(error instanceof Error ? error.message : 'Falló la máscara IA', 'error');
    } finally {
      useEditor.getState().setBusy(null);
    }
  }

  const closeDraft = useCallback((commit: boolean) => {
    const s = useEditor.getState();
    const d = s.doc;
    if (stretchNodesRef.current.length) {
      if (commit) applyPixelStretch();
      else cancelPixelStretch();
      return true;
    }
    if (polyRef.current.length) {
      const pts = polyRef.current;
      if (commit && pts.length >= 3 && d) {
        commitSelection(selectionFromShape({ kind: 'poly', points: [...pts] }, d.width, d.height), draftModeRef.current);
      }
      polyRef.current = [];
      draftModeRef.current = 'replace';
      return true;
    }
    if (vectorRef.current.length) {
      const nodes = vectorRef.current;
      const closed = vectorClosedRef.current;
      if (commit && nodes.length >= (closed ? 3 : 2)) {
        const defaults = useSettings.getState().toolDefaults;
        const id = s.addVectorPath(nodes, closed, {
          fill: closed && defaults.vectorFillEnabled ? defaults.vectorFill : null,
          stroke: defaults.vectorStrokeEnabled || !closed ? defaults.vectorStroke : null,
          strokeWidth: defaults.vectorStrokeWidth,
          strokeAlign: defaults.vectorStrokeAlign,
        });
        if (id) vectorSelectedNodesRef.current = new Set(nodes.map((node) => node.id));
      }
      vectorRef.current = [];
      vectorClosedRef.current = false;
      return true;
    }
    if (bezierRef.current.length) {
      const nodes = bezierRef.current;
      if (commit && nodes.length >= 2 && d) {
        const pts = flattenBezier(nodes);
        if (pts.length >= 3) {
          commitSelection(selectionFromShape({ kind: 'poly', points: pts }, d.width, d.height), draftModeRef.current);
        }
      }
      bezierRef.current = [];
      draftModeRef.current = 'replace';
      return true;
    }
    return false;
  }, []);
  const closeDraftRef = useRef(closeDraft);
  useEffect(() => { closeDraftRef.current = closeDraft; }, [closeDraft]);

  // ── Global keys: space-to-pan, Enter/Escape for crop & drafts ──
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === 'Space') { e.preventDefault(); setSpaceDown(true); }
      if (e.key === 'Alt') maskPreviewRef.current = true;
      const vectorLayer = useEditor.getState().tool === 'vector-node' ? activeEditableVectorLayer() : null;
      if (vectorLayer?.vector?.shapes && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopImmediatePropagation();
        vectorSelectedNodesRef.current = new Set(vectorLayer.vector.shapes.flatMap((shape) => shape.subpaths.flatMap((path) => path.nodes.map((node) => node.id))));
        return;
      }
      if (vectorLayer?.vector?.shapes && e.key.startsWith('Arrow') && vectorSelectedNodesRef.current.size) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const amount = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0;
        const dy = e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0;
        const localA = documentToLayerPoint(vectorLayer, { x: 0, y: 0 }, vectorLayer.vector.baseWidth, vectorLayer.vector.baseHeight);
        const localB = documentToLayerPoint(vectorLayer, { x: dx, y: dy }, vectorLayer.vector.baseWidth, vectorLayer.vector.baseHeight);
        if (!e.repeat) useEditor.getState().snapshot('Desplazar nodos');
        const shapes = detachEditedPrimitives(mapVectorNodes(vectorLayer.vector.shapes, vectorSelectedNodesRef.current, (node) => ({
          ...node,
          x: node.x + localB.x - localA.x,
          y: node.y + localB.y - localA.y,
        })), vectorSelectedNodesRef.current);
        useEditor.getState().updateEditableVector(vectorLayer.id, makeEditableVector(shapes, vectorLayer.vector.baseWidth, vectorLayer.vector.baseHeight), true);
        useEditor.getState().finishVectorEdit(vectorLayer.id);
        return;
      }
      if (vectorLayer && (e.key === 'Backspace' || e.key === 'Delete') && vectorSelectedNodesRef.current.size) {
        e.preventDefault();
        e.stopImmediatePropagation();
        deleteVectorNodes(vectorLayer, vectorSelectedNodesRef.current);
        return;
      }
      if (e.key === 'Escape') {
        if (vectorSelectedNodesRef.current.size && useEditor.getState().tool === 'vector-node') {
          vectorSelectedNodesRef.current.clear();
          vectorMarqueeRef.current = null;
        } else if (useEditor.getState().eyedropperActive) {
          useEditor.getState().setEyedropperActive(false);
          if (eyedropperLoupeRef.current) eyedropperLoupeRef.current.style.display = 'none';
        } else if (floatingRef.current) {
          commitFloatingSelection(false);
        } else if (wandPreviewRef.current) {
          wandPreviewRef.current = null;
          wandBaseRef.current = null;
          drag.current.mode = null;
        } else if (warpMeshRef.current) {
          cancelWarpMesh();
          useEditor.getState().setTool('move');
        } else if (stretchNodesRef.current.length || polyRef.current.length || vectorRef.current.length || bezierRef.current.length || draftShapeRef.current) {
          cancelPixelStretch();
          draftShapeRef.current = null;
          polyRef.current = [];
          vectorRef.current = [];
          vectorClosedRef.current = false;
          bezierRef.current = [];
        } else if (cropRectRef.current) {
          setCropRect(null);
        } else {
          useEditor.getState().setSelection(null);
        }
      }
      if (e.key === 'Enter') {
        if (floatingRef.current) commitFloatingSelection();
        else if (warpMeshRef.current) applyWarpMesh();
        else if (stretchNodesRef.current.length || polyRef.current.length || vectorRef.current.length || bezierRef.current.length) closeDraftRef.current(true);
        else if (useEditor.getState().tool === 'crop') applyCrop();
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && polyRef.current.length) {
        e.preventDefault();
        polyRef.current = polyRef.current.slice(0, -1);
        if (!polyRef.current.length) draftModeRef.current = 'replace';
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && stretchNodesRef.current.length) {
        e.preventDefault();
        const selected = stretchSelectedNodeRef.current >= 0
          ? stretchSelectedNodeRef.current
          : stretchNodesRef.current.length - 1;
        stretchNodesRef.current = stretchNodesRef.current.filter((_, index) => index !== selected);
        stretchSelectedNodeRef.current = Math.min(selected, stretchNodesRef.current.length - 1);
        schedulePixelStretchPreview();
        setStretchRevision((value) => value + 1);
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && warpMeshRef.current && warpSelectedNodeRef.current >= 0) {
        e.preventDefault();
        const mesh = warpMeshRef.current;
        const index = warpSelectedNodeRef.current;
        mesh.points = mesh.points.map((point, pointIndex) => pointIndex === index ? { ...mesh.source[index] } : point);
        scheduleWarpPreview();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
      if (e.key === 'Alt') maskPreviewRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (floatingRef.current) commitFloatingSelectionRef.current();
    if (tool !== 'crop') setCropRect(null);
    if (tool !== 'vector-node') {
      vectorSelectedNodesRef.current.clear();
      vectorHoverRef.current = null;
      vectorMarqueeRef.current = null;
      vectorDragStartRef.current = null;
    }
    setSnapLines(null);
    cancelDrafts();
  }, [tool]);

  useEffect(() => {
    // Drafts are canvas-local. Never let an unfinished path, marquee or warp
    // leak into a newly created or newly selected document tab.
    cancelDrafts();
    vectorSelectedNodesRef.current.clear();
    vectorHoverRef.current = null;
    vectorMarqueeRef.current = null;
    vectorDragStartRef.current = null;
    hoverRef.current = null;
    drag.current.mode = null;
    setCropRect(null);
    setSnapLines(null);
  }, [activeTabId]);

  useEffect(() => {
    const layer = activeEditableVectorLayer();
    const valid = new Set(layer?.vector?.shapes?.flatMap((shape) => shape.subpaths.flatMap((path) => path.nodes.map((node) => node.id))) ?? []);
    vectorSelectedNodesRef.current = new Set([...vectorSelectedNodesRef.current].filter((id) => valid.has(id)));
  }, [doc?.activeId]);

  useEffect(() => {
    if (tool === 'warp-mesh') initializeWarpMesh();
  }, [tool, warpMeshColumns, warpMeshRows, doc?.activeId]);

  useEffect(() => {
    if (tool === 'warp-mesh' && warpMeshRef.current) scheduleWarpPreview();
  }, [tool, warpMeshSmoothing, warpMeshFluidity]);

  function toDoc(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    const s = useEditor.getState();
    return {
      x: (clientX - rect.left - s.panX) / s.zoom,
      y: (clientY - rect.top - s.panY) / s.zoom,
    };
  }

  function scheduleCursor(cursor: { x: number; y: number } | null): void {
    pendingCursorRef.current = cursor;
    if (cursorRafRef.current) return;
    cursorRafRef.current = requestAnimationFrame(() => {
      cursorRafRef.current = 0;
      useEditor.getState().setCursor(pendingCursorRef.current);
    });
  }

  function updateBrushCursor(clientX: number, clientY: number): void {
    const cursor = brushCursorRef.current;
    const container = containerRef.current;
    if (!cursor || !container) return;
    const rect = container.getBoundingClientRect();
    const diameter = Math.max(1, brushSize * useEditor.getState().zoom);
    const x = clientX - rect.left - diameter / 2;
    const y = clientY - rect.top - diameter / 2;
    cursor.style.display = 'block';
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function schedulePaintRender(): void {
    if (paintRenderRafRef.current) return;
    paintRenderRafRef.current = requestAnimationFrame(() => {
      paintRenderRafRef.current = 0;
      useEditor.getState().bump();
    });
  }

  function checkerColor(x: number, y: number): [number, number, number] {
    if (solidCanvasBgColor) return hexToRgb(solidCanvasBgColor);
    return (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0
      ? [58, 58, 58]
      : [74, 74, 74];
  }

  function blendVisiblePixel(r: number, g: number, b: number, a: number, x: number, y: number): [number, number, number] {
    const alpha = a / 255;
    const [br, bg, bb] = checkerColor(x, y);
    return [
      Math.round(r * alpha + br * (1 - alpha)),
      Math.round(g * alpha + bg * (1 - alpha)),
      Math.round(b * alpha + bb * (1 - alpha)),
    ];
  }

  function updateEyedropper(clientX: number, clientY: number): string | null {
    const source = canvasRef.current;
    const container = containerRef.current;
    const loupe = eyedropperLoupeRef.current;
    const preview = eyedropperCanvasRef.current;
    if (!source || !container || !loupe || !preview || !doc) return null;

    const point = toDoc(clientX, clientY);
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) {
      loupe.style.display = 'none';
      return null;
    }

    try {
      const sourceCtx = source.getContext('2d', { willReadFrequently: true })!;
      const center = sourceCtx.getImageData(x, y, 1, 1).data;
      const color = rgbToHex(blendVisiblePixel(center[0], center[1], center[2], center[3], x, y));
      const radius = 5;
      const size = radius * 2 + 1;
      const sx = Math.max(0, x - radius);
      const sy = Math.max(0, y - radius);
      const ex = Math.min(source.width, x + radius + 1);
      const ey = Math.min(source.height, y + radius + 1);
      const sourcePixels = sourceCtx.getImageData(sx, sy, ex - sx, ey - sy);
      const previewCtx = preview.getContext('2d')!;
      const magnified = previewCtx.createImageData(size, size);

      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const docX = x - radius + px;
          const docY = y - radius + py;
          const out = (py * size + px) * 4;
          let visible = checkerColor(docX, docY);
          if (docX >= sx && docY >= sy && docX < ex && docY < ey) {
            const src = ((docY - sy) * sourcePixels.width + docX - sx) * 4;
            visible = blendVisiblePixel(
              sourcePixels.data[src],
              sourcePixels.data[src + 1],
              sourcePixels.data[src + 2],
              sourcePixels.data[src + 3],
              docX,
              docY,
            );
          }
          magnified.data[out] = visible[0];
          magnified.data[out + 1] = visible[1];
          magnified.data[out + 2] = visible[2];
          magnified.data[out + 3] = 255;
        }
      }
      previewCtx.putImageData(magnified, 0, 0);

      const rect = container.getBoundingClientRect();
      const screenX = clientX - rect.left;
      const screenY = clientY - rect.top;
      loupe.style.display = 'block';
      loupe.style.transform = `translate3d(${Math.round(screenX - 56)}px, ${Math.round(screenY - 56)}px, 0)`;
      if (eyedropperCodeRef.current) eyedropperCodeRef.current.textContent = color.toUpperCase();
      if (eyedropperSwatchRef.current) eyedropperSwatchRef.current.style.background = color;

      if (lastEyedropperColorRef.current !== color) {
        lastEyedropperColorRef.current = color;
        useEditor.getState().setEyedropperPreview(color);
      }
      eyedropperErrorRef.current = false;
      return color;
    } catch {
      loupe.style.display = 'none';
      if (!eyedropperErrorRef.current) {
        eyedropperErrorRef.current = true;
        useEditor.getState().toast('No se pudo leer el color de este contenido', 'error');
      }
      return null;
    }
  }

  function snapBounds(bounds: Bounds, excludeSelected = true): Bounds {
    const s = useEditor.getState();
    if (!useSettings.getState().snappingEnabled || !s.doc) {
      setSnapLines((current) => current ? null : current);
      return bounds;
    }
    const excluded = excludeSelected ? new Set(s.selectedLayerIds) : new Set<string>();
    const result = snapBoundsToCandidates(
      bounds,
      buildSnapCandidates(s.doc, s.guides, excluded),
      SNAP_SCREEN_PX / s.zoom,
    );
    const nextLines = result.x == null && result.y == null ? null : { x: result.x, y: result.y };
    setSnapLines((current) => current?.x === nextLines?.x && current?.y === nextLines?.y ? current : nextLines);
    return result.bounds;
  }

  function snapPoint(p: Pt, excludedLayerId?: string): Pt {
    const s = useEditor.getState();
    if (!useSettings.getState().snappingEnabled || !s.doc) {
      setSnapLines((current) => current ? null : current);
      return p;
    }
    const excluded = excludedLayerId ? new Set([excludedLayerId]) : new Set<string>();
    const result = snapBoundsToCandidates(
      { x: p.x, y: p.y, w: 0, h: 0 },
      buildSnapCandidates(s.doc, s.guides, excluded),
      SNAP_SCREEN_PX / s.zoom,
    );
    const nextLines = result.x == null && result.y == null ? null : { x: result.x, y: result.y };
    setSnapLines((current) => current?.x === nextLines?.x && current?.y === nextLines?.y ? current : nextLines);
    return { x: result.bounds.x, y: result.bounds.y };
  }

  function constrainPoint(from: Pt, to: Pt): Pt {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!length) return to;
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
  }

  function activeEditableVectorLayer(): Layer | null {
    const layer = useEditor.getState().activeLayer();
    return layer?.vector?.kind === 'editable' && layer.vector.shapes ? layer : null;
  }

  function vectorScale(layer: Layer): number {
    const vector = layer.vector;
    if (!vector) return 1;
    const scaleX = (layer.w ?? vector.baseWidth) / Math.max(1, vector.baseWidth);
    const scaleY = (layer.h ?? vector.baseHeight) / Math.max(1, vector.baseHeight);
    return Math.sqrt(Math.abs(scaleX * scaleY));
  }

  function vectorControlHitAt(documentPoint: Pt, layer: Layer): VectorControlHit | null {
    const vector = layer.vector;
    if (vector?.kind !== 'editable' || !vector.shapes) return null;
    const threshold = 8 / useEditor.getState().zoom;
    const selected = vectorSelectedNodesRef.current;
    const entries = vector.shapes.flatMap((shape) => shape.subpaths.flatMap((subpath) => (
      subpath.nodes.map((node) => ({ shape, subpath, node }))
    )));
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const { shape, subpath, node } = entries[index];
      if (!selected.has(node.id)) continue;
      for (const kind of ['in', 'out'] as const) {
        const offset = kind === 'in' ? { x: node.inX, y: node.inY } : { x: node.outX, y: node.outY };
        if (Math.hypot(offset.x, offset.y) < 1e-5) continue;
        const handle = layerToDocumentPoint(layer, { x: node.x + offset.x, y: node.y + offset.y }, vector.baseWidth, vector.baseHeight);
        if (Math.hypot(documentPoint.x - handle.x, documentPoint.y - handle.y) <= threshold) {
          return { nodeId: node.id, shapeId: shape.id, subpathId: subpath.id, kind };
        }
      }
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const { shape, subpath, node } = entries[index];
      const anchor = layerToDocumentPoint(layer, node, vector.baseWidth, vector.baseHeight);
      if (Math.hypot(documentPoint.x - anchor.x, documentPoint.y - anchor.y) <= threshold) {
        return { nodeId: node.id, shapeId: shape.id, subpathId: subpath.id, kind: 'node' };
      }
    }
    return null;
  }

  function vectorSegmentAt(documentPoint: Pt, layer: Layer) {
    const vector = layer.vector;
    if (vector?.kind !== 'editable' || !vector.shapes) return null;
    const local = documentToLayerPoint(layer, documentPoint, vector.baseWidth, vector.baseHeight);
    return nearestVectorSegment(vector.shapes, local, 9 / Math.max(0.001, useEditor.getState().zoom * vectorScale(layer)));
  }

  function vectorLayerAt(documentPoint: Pt): Layer | null {
    const state = useEditor.getState();
    const currentDoc = state.doc;
    if (!currentDoc) return null;
    vectorHitCanvasRef.current ??= document.createElement('canvas');
    const hitContext = vectorHitCanvasRef.current.getContext('2d');
    for (let index = currentDoc.layers.length - 1; index >= 0; index -= 1) {
      const layer = currentDoc.layers[index];
      const vector = layer.vector;
      if (!layer.visible || layer.locked || vector?.kind !== 'editable' || !vector.shapes) continue;
      const local = documentToLayerPoint(layer, documentPoint, vector.baseWidth, vector.baseHeight);
      for (let shapeIndex = vector.shapes.length - 1; shapeIndex >= 0; shapeIndex -= 1) {
        const shape = vector.shapes[shapeIndex];
        const path = shapePath2D(shape);
        const inside = !!hitContext?.isPointInPath(path, local.x, local.y, shape.style.fillRule);
        if ((shape.style.fill || shape.style.fillGradient) && inside) return layer;
        if (hitContext && (shape.style.stroke || shape.style.strokeGradient)) {
          const closed = shape.subpaths.length > 0 && shape.subpaths.every((subpath) => subpath.closed);
          const alignment = closed ? shape.style.strokeAlign ?? 'center' : 'center';
          const visualWidth = alignment === 'center' ? shape.style.strokeWidth : shape.style.strokeWidth * 2;
          hitContext.lineWidth = Math.max(visualWidth, 8 / Math.max(0.001, state.zoom * vectorScale(layer)));
          const onStroke = hitContext.isPointInStroke(path, local.x, local.y);
          if (onStroke && (alignment === 'center' || (alignment === 'inside' && inside) || (alignment === 'outside' && !inside))) return layer;
        }
      }
      if (vectorSegmentAt(documentPoint, layer)) return layer;
    }
    return null;
  }

  function replaceVectorSubpath(
    vector: VectorData,
    shapeId: string,
    subpathId: string,
    update: (subpath: VectorSubpath) => VectorSubpath,
  ): VectorData {
    const shapes = (vector.shapes ?? []).map((shape) => shape.id === shapeId
      ? { ...shape, primitive: undefined, subpaths: shape.subpaths.map((subpath) => subpath.id === subpathId ? update(subpath) : subpath) }
      : shape);
    return makeEditableVector(shapes, vector.baseWidth, vector.baseHeight);
  }

  function detachEditedPrimitives(shapes: VectorShape[], nodeIds: ReadonlySet<string>): VectorShape[] {
    return shapes.map((shape) => shape.subpaths.some((subpath) => subpath.nodes.some((node) => nodeIds.has(node.id)))
      ? { ...shape, primitive: undefined }
      : shape);
  }

  function deleteVectorNodes(layer: Layer, nodeIds: ReadonlySet<string>): void {
    const vector = layer.vector;
    if (vector?.kind !== 'editable' || !vector.shapes || !nodeIds.size) return;
    const shapes = vector.shapes.flatMap((shape) => {
      const subpaths = shape.subpaths.flatMap((subpath) => {
        const nodes = subpath.nodes.filter((node) => !nodeIds.has(node.id));
        return nodes.length >= (subpath.closed ? 3 : 2) ? [{ ...subpath, nodes }] : [];
      });
      return subpaths.length ? [{ ...shape, primitive: undefined, subpaths }] : [];
    });
    const state = useEditor.getState();
    if (!shapes.length) {
      state.removeLayer(layer.id);
      vectorSelectedNodesRef.current.clear();
      return;
    }
    state.snapshot(nodeIds.size > 1 ? 'Eliminar nodos' : 'Eliminar nodo');
    state.updateEditableVector(layer.id, makeEditableVector(shapes, vector.baseWidth, vector.baseHeight), true);
    state.finishVectorEdit(layer.id);
    for (const id of nodeIds) vectorSelectedNodesRef.current.delete(id);
  }

  function vectorDocumentPath(layer: Layer, subpath: VectorSubpath): Path2D {
    const vector = layer.vector!;
    const path = new Path2D();
    if (!subpath.nodes.length) return path;
    const first = layerToDocumentPoint(layer, subpath.nodes[0], vector.baseWidth, vector.baseHeight);
    path.moveTo(first.x, first.y);
    const count = subpath.closed ? subpath.nodes.length : subpath.nodes.length - 1;
    for (let index = 0; index < count; index += 1) {
      const from = subpath.nodes[index];
      const to = subpath.nodes[(index + 1) % subpath.nodes.length];
      const cp1 = layerToDocumentPoint(layer, { x: from.x + from.outX, y: from.y + from.outY }, vector.baseWidth, vector.baseHeight);
      const cp2 = layerToDocumentPoint(layer, { x: to.x + to.inX, y: to.y + to.inY }, vector.baseWidth, vector.baseHeight);
      const end = layerToDocumentPoint(layer, to, vector.baseWidth, vector.baseHeight);
      path.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
    }
    if (subpath.closed) path.closePath();
    return path;
  }

  function pixelStretchOptions() {
    const defaults = useSettings.getState().toolDefaults;
    return {
      sampleWidth: defaults.pixelStretchSampleWidth,
      outputWidth: defaults.pixelStretchOutputWidth,
      opacity: defaults.pixelStretchOpacity,
      fadeStart: defaults.pixelStretchFadeStart,
      fadeEnd: defaults.pixelStretchFadeEnd,
      twist: defaults.pixelStretchTwist,
      pattern: defaults.pixelStretchPattern,
      reverse: defaults.pixelStretchReverse,
      smoothing: defaults.pixelStretchSmoothing,
      curveMode: defaults.pixelStretchCurveMode,
      curveSmoothness: defaults.pixelStretchCurveSmoothness,
      taperStart: defaults.pixelStretchTaperStart,
      taperEnd: defaults.pixelStretchTaperEnd,
      edgeFeather: defaults.pixelStretchEdgeFeather,
    };
  }

  function rebuildPixelStretchPreview() {
    stretchRenderRafRef.current = 0;
    const s = useEditor.getState();
    const currentDoc = s.doc;
    const layer = s.activeLayer();
    const visible = canvasRef.current;
    if (!currentDoc || !layer || !visible || stretchNodesRef.current.length < 2) {
      stretchPreviewRef.current = null;
      setStretchRevision((value) => value + 1);
      return;
    }
    const defaults = useSettings.getState().toolDefaults;
    const source = pixelStretchSource(currentDoc, layer, visible, defaults.pixelStretchSource, s.selection);
    stretchPreviewRef.current = renderPixelStretch(
      source,
      stretchNodesRef.current,
      pixelStretchOptions(),
      stretchSampleRef.current,
    );
    setStretchRevision((value) => value + 1);
  }

  function schedulePixelStretchPreview() {
    if (stretchRenderRafRef.current) return;
    stretchRenderRafRef.current = requestAnimationFrame(rebuildPixelStretchPreview);
  }

  function cancelPixelStretch() {
    if (stretchRenderRafRef.current) cancelAnimationFrame(stretchRenderRafRef.current);
    stretchRenderRafRef.current = 0;
    stretchNodesRef.current = [];
    stretchSampleRef.current = null;
    stretchSampleDragRef.current = null;
    stretchPreviewRef.current = null;
    stretchSelectedNodeRef.current = -1;
    setStretchEditMode('path');
    setStretchRevision((value) => value + 1);
  }

  function applyPixelStretch() {
    const s = useEditor.getState();
    if (stretchNodesRef.current.length < 2 || !stretchPreviewRef.current || !s.doc) return;
    s.snapshot('Pixel Stretch');
    s.addLayerCanvasAt(stretchPreviewRef.current, 'Pixel Stretch', 0, 0, false);
    s.toast('Pixel Stretch creado en una capa nueva');
    cancelPixelStretch();
  }

  function stretchControlAt(point: Pt, zoomValue: number): { index: number; side: -1 | 0 | 1 } | null {
    const nodes = stretchNodesRef.current;
    const bezier = useSettings.getState().toolDefaults.pixelStretchCurveMode === 'bezier';
    for (let index = nodes.length - 1; index >= 0; index--) {
      const node = nodes[index];
      if (Math.hypot(point.x - node.x, point.y - node.y) * zoomValue <= 8) return { index, side: 0 };
      if (bezier && (node.outX || node.outY) && Math.hypot(point.x - node.x - node.outX, point.y - node.y - node.outY) * zoomValue <= 7) {
        return { index, side: 1 };
      }
      if (bezier && (node.inX || node.inY) && Math.hypot(point.x - node.x - node.inX, point.y - node.y - node.inY) * zoomValue <= 7) {
        return { index, side: -1 };
      }
    }
    return null;
  }

  function effectiveStretchSample(): PixelStretchSample | null {
    const defaults = useSettings.getState().toolDefaults;
    return resolvePixelStretchSample(
      stretchNodesRef.current,
      stretchSampleRef.current,
      defaults.pixelStretchCurveMode,
      defaults.pixelStretchCurveSmoothness,
    );
  }

  function stretchSampleControlAt(point: Pt, zoomValue: number): { kind: 'move' | 'angle'; side: -1 | 1 } | null {
    const sample = effectiveStretchSample();
    if (!sample) return null;
    const half = useSettings.getState().toolDefaults.pixelStretchSampleWidth / 2;
    const direction = { x: Math.cos(sample.angle), y: Math.sin(sample.angle) };
    const start = { x: sample.origin.x - direction.x * half, y: sample.origin.y - direction.y * half };
    const end = { x: sample.origin.x + direction.x * half, y: sample.origin.y + direction.y * half };
    if (Math.hypot(point.x - sample.origin.x, point.y - sample.origin.y) * zoomValue <= 14) return { kind: 'move', side: 1 };
    if (Math.hypot(point.x - start.x, point.y - start.y) * zoomValue <= 12) return { kind: 'angle', side: -1 };
    if (Math.hypot(point.x - end.x, point.y - end.y) * zoomValue <= 12) return { kind: 'angle', side: 1 };
    const length2 = Math.max(0.0001, (end.x - start.x) ** 2 + (end.y - start.y) ** 2);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / length2));
    const nearest = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    if (Math.hypot(point.x - nearest.x, point.y - nearest.y) * zoomValue <= 10) return { kind: 'move', side: 1 };
    return null;
  }

  function resetPixelStretchSample() {
    stretchSampleRef.current = null;
    stretchSampleDragRef.current = null;
    schedulePixelStretchPreview();
    setStretchRevision((value) => value + 1);
  }

  function initializeWarpMesh() {
    const s = useEditor.getState();
    const layer = s.activeLayer();
    if (!s.doc || !layer || layer.kind === 'group' || layer.kind === 'adjustment' || layer.locked || layer.lockPixels) {
      warpMeshRef.current = null;
      warpPreviewRef.current = null;
      warpLayerIdRef.current = null;
      setWarpRevision((value) => value + 1);
      if (layer?.locked || layer?.lockPixels) s.toast('Desbloqueá la capa para usar Warp Mesh', 'error');
      return;
    }
    const defaults = useSettings.getState().toolDefaults;
    const bounds = rotatedBounds(layerBounds(layer), layer.rotation ?? 0);
    warpLayerIdRef.current = layer.id;
    warpSelectedNodeRef.current = -1;
    warpMeshRef.current = createWarpMesh(bounds, defaults.warpMeshColumns, defaults.warpMeshRows);
    rebuildWarpPreview();
  }

  function rebuildWarpPreview() {
    warpRenderRafRef.current = 0;
    const s = useEditor.getState();
    const layer = s.doc?.layers.find((candidate) => candidate.id === warpLayerIdRef.current);
    const mesh = warpMeshRef.current;
    if (!s.doc || !layer || !mesh) {
      warpPreviewRef.current = null;
      setWarpRevision((value) => value + 1);
      return;
    }
    const source = warpLayerSource(s.doc, layer);
    const defaults = useSettings.getState().toolDefaults;
    warpPreviewRef.current = renderWarpMesh(source, mesh, defaults.warpMeshSmoothing, defaults.warpMeshFluidity);
    setWarpRevision((value) => value + 1);
  }

  function scheduleWarpPreview() {
    if (warpRenderRafRef.current) return;
    warpRenderRafRef.current = requestAnimationFrame(rebuildWarpPreview);
  }

  function compositeWarpPreview() {
    const s = useEditor.getState();
    const target = canvasRef.current;
    const preview = warpPreviewRef.current;
    const layerId = warpLayerIdRef.current;
    if (!s.doc || !target || !preview || !layerId) return;
    const layers = s.doc.layers.map((layer) => layer.id === layerId ? {
      ...layer,
      kind: 'raster' as const,
      canvas: preview,
      x: 0,
      y: 0,
      w: undefined,
      h: undefined,
      rotation: 0,
      mask: undefined,
      text: undefined,
      vector: undefined,
      adjustments: { ...DEFAULT_ADJUSTMENTS, recolor: { ...DEFAULT_ADJUSTMENTS.recolor, color: [...DEFAULT_ADJUSTMENTS.recolor.color] as [number, number, number] } },
    } : layer);
    measuredComposite(target, { ...s.doc, layers });
  }

  function resetWarpMesh() {
    const mesh = warpMeshRef.current;
    if (!mesh) {
      initializeWarpMesh();
      return;
    }
    mesh.points = mesh.source.map((point) => ({ ...point }));
    warpSelectedNodeRef.current = -1;
    warpDragStartRef.current = [];
    scheduleWarpPreview();
  }

  function cancelWarpMesh() {
    if (warpRenderRafRef.current) cancelAnimationFrame(warpRenderRafRef.current);
    warpRenderRafRef.current = 0;
    warpMeshRef.current = null;
    warpPreviewRef.current = null;
    warpLayerIdRef.current = null;
    warpSelectedNodeRef.current = -1;
    warpDragStartRef.current = [];
    const s = useEditor.getState();
    if (s.doc && canvasRef.current) measuredComposite(canvasRef.current, s.doc);
    setWarpRevision((value) => value + 1);
  }

  function applyWarpMesh() {
    const s = useEditor.getState();
    const preview = warpPreviewRef.current;
    const layerId = warpLayerIdRef.current;
    if (!preview || !layerId || !warpMeshRef.current) return;
    const result = s.commitWarpResult(layerId, preview);
    cancelWarpMesh();
    if (result) {
      s.toast('Warp Mesh creado en una capa nueva; el original quedó oculto');
      s.setTool('move');
    }
  }

  function warpControlAt(point: Pt, zoomValue: number): number {
    const mesh = warpMeshRef.current;
    if (!mesh) return -1;
    for (let index = mesh.points.length - 1; index >= 0; index--) {
      if (Math.hypot(point.x - mesh.points[index].x, point.y - mesh.points[index].y) * zoomValue <= 9) return index;
    }
    return -1;
  }

  function beginFloatingSelection(): FloatingSelection | null {
    const s = useEditor.getState();
    const d = s.doc;
    const layer = s.activeLayer();
    const sel = s.selection;
    if (!d || !layer || !sel) return null;
    if (layer.locked || layer.lockPixels) {
      s.toast('Desbloqueá la capa para transformar la selección', 'error');
      return null;
    }
    const extracted = extractSelection(layer, sel);
    if (!extracted) return null;
    const layerW = layer.w ?? layer.canvas.width;
    const layerH = layer.h ?? layer.canvas.height;
    const replaceLayer =
      Math.abs(layer.x - sel.bounds.x) < 0.5 &&
      Math.abs(layer.y - sel.bounds.y) < 0.5 &&
      Math.abs(layerW - sel.bounds.w) < 0.5 &&
      Math.abs(layerH - sel.bounds.h) < 0.5;
    s.snapshot('Transformar selección');
    const originalX = layer.x;
    const originalY = layer.y;
    // COW: vaciar la selección muta píxeles in-place — copia propia primero.
    // El canvas anterior queda inmutable, así que sirve tal cual de respaldo
    // para cancelar, sin clonarlo.
    const originalCanvas = layer.canvas;
    const fresh = s.unshareActiveCanvas();
    if (!fresh) return null;
    clearSelectionPixels(fresh, sel);
    s.setSelection(null);
    s.bump();
    s.refreshActiveThumb();
    const next = {
      source: extracted.canvas,
      mask: cropMask(sel),
      bounds: { ...sel.bounds },
      angle: 0,
      layerId: layer.id,
      layerName: layer.name,
      originalSelection: sel,
      originalCanvas,
      originalX,
      originalY,
      replaceLayer,
    };
    setFloating(next);
    return next;
  }

  function commitFloatingSelection(createLayer = true): void {
    const fl = floatingRef.current;
    const s = useEditor.getState();
    const d = s.doc;
    if (!fl || !d) return;
    if (!createLayer) {
      setFloating(null);
      s.replaceLayerCanvasAt(fl.layerId, fl.originalCanvas, fl.originalX, fl.originalY);
      s.setSelection(fl.originalSelection);
      return;
    }
    const created = createTransformedSelectionLayer(fl.source, fl.mask, fl.bounds, fl.angle, d.width, d.height);
    setFloating(null);
    if (!created) {
      s.replaceLayerCanvasAt(fl.layerId, fl.originalCanvas, fl.originalX, fl.originalY);
      s.setSelection(fl.originalSelection);
      return;
    }
    if (fl.replaceLayer) {
      s.replaceLayerCanvasAt(fl.layerId, created.canvas, created.x, created.y);
    } else {
      s.addLayerCanvasAt(created.canvas, `${fl.layerName} selección`, created.x, created.y, false);
    }
    s.setSelection(created.selection);
  }
  commitFloatingSelectionRef.current = commitFloatingSelection;

  function applyCrop() {
    const r = cropRectRef.current;
    if (!r || r.w < 2 || r.h < 2) { setCropRect(null); return; }
    const settings = useSettings.getState();
    if (useEditor.getState().cropTo(r, settings.cropUpscale)) {
      settings.setCropUpscale(1);
      setCropRect(null);
    }
  }

  // ── Marching ants / draft overlay (rAF-driven) ──
  useEffect(() => {
    let raf = 0;
    // Start dirty so a remount (including hot reload in development) clears
    // any pixels left in the persistent overlay canvas.
    let wasEmpty = false;
    let lastDraw = 0;
    const dash = 5;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      const canvas = antsRef.current;
      const cont = containerRef.current;
      if (!canvas || !cont) return;
      const s = useEditor.getState();
      const hasContent = !!s.doc && !!(
        s.selection || wandPreviewRef.current || draftShapeRef.current || vectorShapeDraftRef.current || polyRef.current.length || vectorRef.current.length || bezierRef.current.length || stretchNodesRef.current.length || warpMeshRef.current
        || (s.tool === 'vector-node' && s.activeLayer()?.vector?.kind === 'editable')
      );
      if (!hasContent) {
        if (!wasEmpty) {
          canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
          wasEmpty = true;
        }
        return;
      }
      if (time - lastDraw < 32) return;
      lastDraw = time;
      wasEmpty = false;

      const dpr = window.devicePixelRatio || 1;
      const w = cont.clientWidth;
      const h = cont.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const g = canvas.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const { zoom: z, panX: px, panY: py } = s;
      const offset = reduceMotion ? 0 : (time / 80) % (dash * 2);
      const motionPulse = reduceMotion ? 0.5 : (Math.sin(time / 230) + 1) / 2;

      if (stretchPreviewRef.current) {
        g.save();
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(
          stretchPreviewRef.current,
          0, 0, stretchPreviewRef.current.width, stretchPreviewRef.current.height,
          px, py, stretchPreviewRef.current.width * z, stretchPreviewRef.current.height * z,
        );
        g.restore();
      }

      const strokeDocPath = (path: Path2D, closedAnts = true) => {
        g.save();
        g.translate(px, py);
        g.scale(z, z);
        g.lineWidth = 1 / z;
        g.strokeStyle = 'rgba(0,0,0,0.85)';
        g.setLineDash([]);
        g.stroke(path);
        g.strokeStyle = '#ffffff';
        g.setLineDash([dash / z, dash / z]);
        g.lineDashOffset = -(closedAnts ? offset : offset * 0.55) / z;
        g.stroke(path);
        g.restore();
      };

      const sel = wandPreviewRef.current ?? s.selection;
      if (sel) {
        if (maskPreviewRef.current) {
          g.save();
          g.translate(px, py);
          g.scale(z, z);
          g.fillStyle = 'rgba(0,0,0,.78)';
          g.fillRect(0, 0, sel.mask.width, sel.mask.height);
          g.globalCompositeOperation = 'screen';
          g.drawImage(sel.mask, 0, 0);
          g.restore();
        }
        if (sel.shape) {
          strokeDocPath(shapePath(sel.shape));
        } else {
          // Wand/mask selection: tinted fill + animated bounds.
          if (maskTintRef.current?.mask !== sel.mask) {
            const tint = document.createElement('canvas');
            tint.width = sel.mask.width;
            tint.height = sel.mask.height;
            const tg = tint.getContext('2d')!;
            tg.drawImage(sel.mask, 0, 0);
            tg.globalCompositeOperation = 'source-in';
            tg.fillStyle = 'rgba(20,115,230,0.30)';
            tg.fillRect(0, 0, tint.width, tint.height);
            maskTintRef.current = { mask: sel.mask, tint };
          }
          g.drawImage(
            maskTintRef.current.tint,
            0, 0, sel.mask.width, sel.mask.height,
            px, py, sel.mask.width * z, sel.mask.height * z,
          );
          const b = sel.bounds;
          const p = new Path2D();
          p.rect(b.x, b.y, b.w, b.h);
          strokeDocPath(p);
        }
      }

      if (draftShapeRef.current) strokeDocPath(shapePath(draftShapeRef.current));

      if (vectorShapeDraftRef.current) {
        g.save();
        g.translate(px, py);
        g.scale(z, z);
        g.globalAlpha = 0.82;
        paintVectorShape(g, vectorShapeDraftRef.current);
        g.globalAlpha = 1;
        g.strokeStyle = 'rgba(109,177,255,.95)';
        g.lineWidth = 1 / z;
        g.setLineDash([4 / z, 4 / z]);
        g.lineDashOffset = -offset / z;
        g.stroke(shapePath2D(vectorShapeDraftRef.current));
        g.restore();
      }

      const drawVertex = (pt: Pt, first: boolean) => {
        const sx = px + pt.x * z;
        const sy = py + pt.y * z;
        g.save();
        g.fillStyle = first ? '#1473e6' : '#ffffff';
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.shadowColor = first ? 'rgba(38,128,235,.72)' : 'transparent';
        g.shadowBlur = first ? 2 + motionPulse * 3 : 0;
        g.setLineDash([]);
        g.lineWidth = 1;
        g.beginPath();
        g.rect(sx - 3, sy - 3, 6, 6);
        g.fill();
        g.stroke();
        g.restore();
      };

      if (polyRef.current.length) {
        const pts = polyRef.current;
        const canClose = !!hoverRef.current && pts.length >= 3 && Math.hypot(hoverRef.current.x - pts[0].x, hoverRef.current.y - pts[0].y) * z <= 12;
        const p = new Path2D();
        p.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
        if (hoverRef.current) p.lineTo(canClose ? pts[0].x : hoverRef.current.x, canClose ? pts[0].y : hoverRef.current.y);
        strokeDocPath(p, false);
        pts.forEach((pt, i) => drawVertex(pt, i === 0));
        if (canClose) {
          const sx = px + pts[0].x * z, sy = py + pts[0].y * z;
          g.save();
          g.strokeStyle = '#1473e6';
          g.lineWidth = 1.5;
          g.setLineDash([]);
          g.beginPath();
          g.arc(sx, sy, 7, 0, Math.PI * 2);
          g.stroke();
          g.restore();
        }
      }

      if (vectorRef.current.length) {
        const nodes = vectorRef.current;
        const p = new Path2D();
        p.moveTo(nodes[0].x, nodes[0].y);
        for (let index = 1; index < nodes.length; index += 1) {
          const from = nodes[index - 1];
          const to = nodes[index];
          p.bezierCurveTo(from.x + from.outX, from.y + from.outY, to.x + to.inX, to.y + to.inY, to.x, to.y);
        }
        if (hoverRef.current) {
          const from = nodes[nodes.length - 1];
          p.bezierCurveTo(from.x + from.outX, from.y + from.outY, hoverRef.current.x, hoverRef.current.y, hoverRef.current.x, hoverRef.current.y);
        }
        strokeDocPath(p, false);
        nodes.forEach((node, index) => {
          drawVertex(node, index === 0);
          if (Math.hypot(node.inX, node.inY) > 1e-5 || Math.hypot(node.outX, node.outY) > 1e-5) {
            const anchorX = px + node.x * z;
            const anchorY = py + node.y * z;
            const incomingX = px + (node.x + node.inX) * z;
            const incomingY = py + (node.y + node.inY) * z;
            const outgoingX = px + (node.x + node.outX) * z;
            const outgoingY = py + (node.y + node.outY) * z;
            g.save();
            g.strokeStyle = 'rgba(76,141,255,.9)';
            g.setLineDash([]);
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(incomingX, incomingY); g.lineTo(anchorX, anchorY); g.lineTo(outgoingX, outgoingY);
            g.stroke();
            g.fillStyle = '#fff';
            g.strokeStyle = '#4c8dff';
            for (const [handleX, handleY] of [[incomingX, incomingY], [outgoingX, outgoingY]]) {
              g.beginPath(); g.arc(handleX, handleY, 3, 0, Math.PI * 2); g.fill(); g.stroke();
            }
            g.restore();
          }
        });
        const canClose = !!hoverRef.current && nodes.length >= 3 && Math.hypot(hoverRef.current.x - nodes[0].x, hoverRef.current.y - nodes[0].y) * z <= 12;
        if (canClose) {
          g.save();
          g.strokeStyle = '#4c8dff';
          g.lineWidth = 1.5;
          g.setLineDash([]);
          g.beginPath(); g.arc(px + nodes[0].x * z, py + nodes[0].y * z, 8, 0, Math.PI * 2); g.stroke();
          g.restore();
        }
      }

      const editableLayer = s.tool === 'vector-node' ? s.activeLayer() : null;
      if (editableLayer?.vector?.kind === 'editable' && editableLayer.vector.shapes) {
        const vector = editableLayer.vector;
        const shapes = vector.shapes!;
        g.save();
        g.translate(px, py);
        g.scale(z, z);
        g.setLineDash([]);
        g.lineWidth = 2.5 / z;
        g.strokeStyle = 'rgba(0,0,0,.7)';
        for (const shape of shapes) for (const subpath of shape.subpaths) g.stroke(vectorDocumentPath(editableLayer, subpath));
        g.lineWidth = 1.2 / z;
        g.strokeStyle = `rgba(88,166,255,${0.72 + motionPulse * 0.24})`;
        for (const shape of shapes) for (const subpath of shape.subpaths) g.stroke(vectorDocumentPath(editableLayer, subpath));
        g.restore();

        const selectedNodes = vectorSelectedNodesRef.current;
        for (const shape of shapes) {
          for (const subpath of shape.subpaths) {
            for (const node of subpath.nodes) {
              if (selectedNodes.has(node.id)) {
                const anchor = layerToDocumentPoint(editableLayer, node, vector.baseWidth, vector.baseHeight);
                const incoming = layerToDocumentPoint(editableLayer, { x: node.x + node.inX, y: node.y + node.inY }, vector.baseWidth, vector.baseHeight);
                const outgoing = layerToDocumentPoint(editableLayer, { x: node.x + node.outX, y: node.y + node.outY }, vector.baseWidth, vector.baseHeight);
                const anchorX = px + anchor.x * z;
                const anchorY = py + anchor.y * z;
                g.save();
                g.strokeStyle = 'rgba(88,166,255,.85)';
                g.lineWidth = 1;
                g.setLineDash([]);
                g.beginPath();
                if (Math.hypot(node.inX, node.inY) > 1e-5) { g.moveTo(anchorX, anchorY); g.lineTo(px + incoming.x * z, py + incoming.y * z); }
                if (Math.hypot(node.outX, node.outY) > 1e-5) { g.moveTo(anchorX, anchorY); g.lineTo(px + outgoing.x * z, py + outgoing.y * z); }
                g.stroke();
                for (const [handle, visible] of [[incoming, Math.hypot(node.inX, node.inY) > 1e-5], [outgoing, Math.hypot(node.outX, node.outY) > 1e-5]] as const) {
                  if (!visible) continue;
                  g.fillStyle = '#18191b';
                  g.strokeStyle = '#58a6ff';
                  g.beginPath(); g.arc(px + handle.x * z, py + handle.y * z, 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
                }
                g.restore();
              }
              const anchor = layerToDocumentPoint(editableLayer, node, vector.baseWidth, vector.baseHeight);
              const screenX = px + anchor.x * z;
              const screenY = py + anchor.y * z;
              const isSelected = selectedNodes.has(node.id);
              g.save();
              g.fillStyle = isSelected ? '#58a6ff' : '#f4f5f6';
              g.strokeStyle = '#101113';
              g.lineWidth = 1;
              g.setLineDash([]);
              g.beginPath();
              if (node.kind === 'smooth') g.arc(screenX, screenY, isSelected ? 4 + motionPulse * 0.55 : 3.6, 0, Math.PI * 2);
              else {
                const size = isSelected ? 7.2 + motionPulse * 0.75 : 6.5;
                g.rect(screenX - size / 2, screenY - size / 2, size, size);
              }
              g.fill(); g.stroke(); g.restore();
            }
          }
        }
        const hover = vectorHoverRef.current;
        if (hover?.kind === 'segment') {
          g.save();
          g.fillStyle = '#58a6ff';
          g.strokeStyle = '#fff';
          g.lineWidth = 1;
          g.shadowColor = 'rgba(88,166,255,.68)';
          g.shadowBlur = 3 + motionPulse * 4;
          g.beginPath(); g.arc(px + hover.point.x * z, py + hover.point.y * z, 3.7 + motionPulse * .6, 0, Math.PI * 2); g.fill(); g.stroke();
          g.restore();
        }
        if (vectorMarqueeRef.current) {
          const marquee = vectorMarqueeRef.current;
          g.save();
          g.fillStyle = 'rgba(88,166,255,.1)';
          g.strokeStyle = '#58a6ff';
          g.setLineDash([4, 3]);
          g.lineWidth = 1;
          g.fillRect(px + marquee.x * z, py + marquee.y * z, marquee.w * z, marquee.h * z);
          g.strokeRect(px + marquee.x * z, py + marquee.y * z, marquee.w * z, marquee.h * z);
          g.restore();
        }
      }

      if (bezierRef.current.length) {
        const nodes = bezierRef.current;
        const p = new Path2D();
        p.moveTo(nodes[0].x, nodes[0].y);
        for (let i = 1; i < nodes.length; i++) {
          const a = nodes[i - 1];
          const b = nodes[i];
          p.bezierCurveTo(a.x + a.hx, a.y + a.hy, b.x - b.hx, b.y - b.hy, b.x, b.y);
        }
        if (hoverRef.current) {
          const a = nodes[nodes.length - 1];
          p.bezierCurveTo(
            a.x + a.hx, a.y + a.hy,
            hoverRef.current.x, hoverRef.current.y,
            hoverRef.current.x, hoverRef.current.y,
          );
        }
        strokeDocPath(p, false);
        nodes.forEach((n, i) => {
          drawVertex(n, i === 0);
          if (n.hx !== 0 || n.hy !== 0) {
            const cx = px + n.x * z, cy = py + n.y * z;
            const h1x = px + (n.x + n.hx) * z, h1y = py + (n.y + n.hy) * z;
            const h2x = px + (n.x - n.hx) * z, h2y = py + (n.y - n.hy) * z;
            g.strokeStyle = 'rgba(20,115,230,0.9)';
            g.beginPath();
            g.moveTo(h2x, h2y); g.lineTo(cx, cy); g.lineTo(h1x, h1y);
            g.stroke();
            for (const [hx, hy] of [[h1x, h1y], [h2x, h2y]]) {
              g.fillStyle = '#1473e6';
              g.beginPath();
              g.arc(hx, hy, 2.5, 0, Math.PI * 2);
              g.fill();
            }
          }
        });
      }

      if (warpMeshRef.current) {
        const mesh = warpMeshRef.current;
        const fluidity = useSettings.getState().toolDefaults.warpMeshFluidity;
        const samplesPerCell = 14;
        g.save();
        g.translate(px, py);
        g.scale(z, z);
        g.lineWidth = 1 / z;
        g.strokeStyle = `rgba(20,115,230,${0.68 + motionPulse * 0.26})`;
        g.setLineDash([]);
        for (let row = 0; row < mesh.rows; row++) {
          g.beginPath();
          const first = sampleWarpSurface(mesh, 0, row / (mesh.rows - 1), fluidity);
          g.moveTo(first.x, first.y);
          for (let sample = 1; sample <= (mesh.columns - 1) * samplesPerCell; sample++) {
            const point = sampleWarpSurface(mesh, sample / ((mesh.columns - 1) * samplesPerCell), row / (mesh.rows - 1), fluidity);
            g.lineTo(point.x, point.y);
          }
          g.stroke();
        }
        for (let column = 0; column < mesh.columns; column++) {
          g.beginPath();
          const first = sampleWarpSurface(mesh, column / (mesh.columns - 1), 0, fluidity);
          g.moveTo(first.x, first.y);
          for (let sample = 1; sample <= (mesh.rows - 1) * samplesPerCell; sample++) {
            const point = sampleWarpSurface(mesh, column / (mesh.columns - 1), sample / ((mesh.rows - 1) * samplesPerCell), fluidity);
            g.lineTo(point.x, point.y);
          }
          g.stroke();
        }
        mesh.points.forEach((point, pointIndex) => {
          const selected = pointIndex === warpSelectedNodeRef.current;
          g.beginPath();
          g.arc(point.x, point.y, (selected ? 4.6 + motionPulse * .85 : 3.5) / z, 0, Math.PI * 2);
          g.fillStyle = selected ? '#ff4fd8' : '#ffffff';
          g.fill();
          g.strokeStyle = selected ? '#ffffff' : '#1473e6';
          g.lineWidth = (selected ? 1.5 : 1) / z;
          g.stroke();
        });
        g.restore();
      }

      if (stretchNodesRef.current.length) {
        const nodes = stretchNodesRef.current;
        const defaults = useSettings.getState().toolDefaults;
        const editingSample = stretchEditModeRef.current === 'sample';
        const previewNodes = hoverRef.current && drag.current.mode == null && !editingSample
          ? [...nodes, { x: hoverRef.current.x, y: hoverRef.current.y, inX: 0, inY: 0, outX: 0, outY: 0 }]
          : nodes;
        const sampledPath = samplePixelStretchPath(previewNodes, defaults.pixelStretchCurveMode, defaults.pixelStretchCurveSmoothness);
        const path = new Path2D();
        if (sampledPath.length) {
          path.moveTo(sampledPath[0].x, sampledPath[0].y);
          for (let index = 1; index < sampledPath.length; index++) path.lineTo(sampledPath[index].x, sampledPath[index].y);
        }
        strokeDocPath(path, false);

        const sample = effectiveStretchSample();
        if (sample) {
          const direction = { x: Math.cos(sample.angle), y: Math.sin(sample.angle) };
          const halfSample = defaults.pixelStretchSampleWidth / 2;
          const start = { x: sample.origin.x - direction.x * halfSample, y: sample.origin.y - direction.y * halfSample };
          const end = { x: sample.origin.x + direction.x * halfSample, y: sample.origin.y + direction.y * halfSample };
          g.save();
          g.strokeStyle = '#ff4fd8';
          g.lineWidth = editingSample ? 2.2 + motionPulse * .55 : 1.5;
          g.setLineDash([]);
          g.beginPath();
          g.moveTo(px + start.x * z, py + start.y * z);
          g.lineTo(px + end.x * z, py + end.y * z);
          g.stroke();
          if (Math.hypot(sample.origin.x - nodes[0].x, sample.origin.y - nodes[0].y) * z > 8) {
            g.setLineDash([4, 4]);
            g.strokeStyle = 'rgba(255,79,216,.5)';
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(px + sample.origin.x * z, py + sample.origin.y * z);
            g.lineTo(px + nodes[0].x * z, py + nodes[0].y * z);
            g.stroke();
          }
          const controls = editingSample ? [start, sample.origin, end] : [sample.origin];
          controls.forEach((point, controlIndex) => {
            g.setLineDash([]);
            g.beginPath();
            g.arc(px + point.x * z, py + point.y * z, controlIndex === 1 || controls.length === 1 ? 5 : 4, 0, Math.PI * 2);
            g.fillStyle = controlIndex === 1 || controls.length === 1 ? '#ff4fd8' : '#ffffff';
            g.fill();
            g.strokeStyle = '#ffffff';
            g.lineWidth = 1;
            g.stroke();
          });
          g.restore();
        }

        nodes.forEach((node, index) => {
          const cx = px + node.x * z;
          const cy = py + node.y * z;
          const inX = px + (node.x + node.inX) * z;
          const inY = py + (node.y + node.inY) * z;
          const outX = px + (node.x + node.outX) * z;
          const outY = py + (node.y + node.outY) * z;
          g.save();
          g.setLineDash([]);
          if (defaults.pixelStretchCurveMode === 'bezier') {
            g.strokeStyle = 'rgba(20,115,230,.88)';
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(inX, inY); g.lineTo(cx, cy); g.lineTo(outX, outY);
            g.stroke();
            for (const [handleX, handleY] of [[inX, inY], [outX, outY]]) {
              g.fillStyle = '#1473e6';
              g.beginPath();
              g.arc(handleX, handleY, 3, 0, Math.PI * 2);
              g.fill();
            }
          }
          g.fillStyle = index === stretchSelectedNodeRef.current ? '#ff4fd8' : '#ffffff';
          g.strokeStyle = index === stretchSelectedNodeRef.current ? '#ffffff' : 'rgba(0,0,0,.9)';
          g.lineWidth = index === stretchSelectedNodeRef.current ? 1.6 + motionPulse * .7 : 1;
          g.beginPath();
          g.rect(cx - 4, cy - 4, 8, 8);
          g.fill();
          g.stroke();
          g.restore();
        });
      }

      if (drag.current.mode === 'wand-tolerance' && hoverRef.current) {
        const sx = px + hoverRef.current.x * z + 14;
        const sy = py + hoverRef.current.y * z + 14;
        const text = `Tolerancia ${useEditor.getState().wandTolerance}`;
        g.save();
        g.font = '600 11px system-ui, sans-serif';
        const width = g.measureText(text).width + 14;
        g.fillStyle = 'rgba(22, 23, 27, .92)';
        g.strokeStyle = 'rgba(255,255,255,.16)';
        g.beginPath();
        g.roundRect(sx, sy, width, 24, 5);
        g.fill(); g.stroke();
        g.fillStyle = '#e9edf5';
        g.fillText(text, sx + 7, sy + 16);
        g.restore();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!doc) return;
    if (eyedropperActive) {
      e.preventDefault();
      const color = updateEyedropper(e.clientX, e.clientY);
      if (color) useEditor.getState().commitEyedropperColor(color);
      return;
    }
    // Never start a canvas gesture from clicks on UI controls layered over the
    // stage (crop buttons, handles, guides, rulers…) — this was the bug where
    // pressing "Aplicar recorte" started drawing a new crop behind the button.
    const el = e.target as HTMLElement;
    if (el.closest('[data-ui], button, input, select, textarea')) return;

    const s = useEditor.getState();
    const p = toDoc(e.clientX, e.clientY);
    // Some browsers/input devices (trackpad gestures, pens) can reject this
    // for pointer ids they don't consider "active" — never let it abort the
    // gesture below, since that would silently break move/crop/erase.
    try { containerRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const usePan = tool === 'hand' || spaceDown || e.button === 1;

    if (usePan) {
      drag.current.mode = 'pan';
    } else if (tool === 'zoom') {
      zoomAt(e.clientX, e.clientY, e.altKey ? 1 / 1.5 : 1.5);
      return;
    } else if (editingTextLayerId) {
      const hit = hitTextLayer(p);
      if (hit === editingTextLayerId) {
        const layer = s.doc?.layers.find((candidate) => candidate.id === editingTextLayerId);
        if (!layer || layer.locked || layer.lockPixels) return;
        if (!s.selectedLayerIds.includes(layer.id) || s.selectedLayerIds.length !== 1) s.selectLayer(layer.id);
        drag.current.mode = 'text-edit-move';
        drag.current.moved = false;
      } else if (hit) {
        onEditText(hit);
        return;
      } else {
        return;
      }
    } else if (tool === 'move') {
      if (selection && selectionContains(selection, p) && s.activeLayer()) {
        drag.current.mode = 'selection-move';
        drag.current.startBounds = { ...selection.bounds };
        drag.current.startDocX = p.x;
        drag.current.startDocY = p.y;
        drag.current.moved = false;
      } else {
        const movable = s.doc?.layers.some((layer) => (s.selectedLayerIds.includes(layer.id) || layer.id === s.doc?.activeId) && !layer.locked && layer.kind !== 'adjustment');
        if (!movable) { s.toast('Las capas seleccionadas están bloqueadas', 'error'); return; }
        drag.current.mode = 'move';
        drag.current.moved = false;
      }
    } else if (tool === 'crop') {
      drag.current.mode = 'crop';
      drag.current.startDocX = p.x;
      drag.current.startDocY = p.y;
      drag.current.startX = e.clientX;
      setCropRect({ x: p.x, y: p.y, w: 0, h: 0 });
    } else if (tool === 'eraser' || tool === 'brush' || tool === 'blur' || tool === 'sharpen') {
      if (!s.activeLayer()) return;
      s.snapshot(tool === 'eraser' ? 'Borrar con pincel' : tool === 'blur' ? 'Desenfocar con pincel' : tool === 'sharpen' ? 'Enfocar con pincel' : 'Pintar con pincel');
      const mode = tool === 'eraser' ? 'erase' : tool === 'blur' ? 'blur' : tool === 'sharpen' ? 'sharpen' : 'paint';
      if (!s.paintActiveStroke(p, p, mode)) return;
      schedulePaintRender();
      drag.current.mode = 'paint';
    } else if (tool === 'select-rect' || tool === 'select-ellipse') {
      drag.current.mode = 'select-shape';
      drag.current.startDocX = p.x;
      drag.current.startDocY = p.y;
      draftShapeRef.current = null;
      // Capturar el modo (add/subtract/replace) al empezar el gesto, no al
      // soltarlo — igual que poly/bezier/wand. Si no, soltar Shift/Alt un
      // instante antes de levantar el botón cambia el modo silenciosamente.
      draftModeRef.current = selectionMode(e);
    } else if (tool === 'select-poly') {
      const pts = polyRef.current;
      const hitIndex = pts.findIndex((pt) => Math.hypot(p.x - pt.x, p.y - pt.y) * s.zoom <= 8);
      if (hitIndex >= 0 && e.altKey) {
        polyRef.current = pts.filter((_, index) => index !== hitIndex);
      } else if (hitIndex >= 0) {
        drag.current.mode = 'poly-node';
        drag.current.nodeIndex = hitIndex;
      } else if (pts.length >= 3 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) * s.zoom <= 8) {
        closeDraft(true);
      } else {
        if (!pts.length) draftModeRef.current = selectionMode(e);
        const previous = pts[pts.length - 1];
        const next = e.shiftKey && previous ? constrainPoint(previous, p) : p;
        polyRef.current = [...pts, snapPoint(next)];
      }
    } else if (tool === 'vector-shape') {
      const start = snapPoint(p);
      drag.current.mode = 'vector-shape';
      drag.current.startDocX = start.x;
      drag.current.startDocY = start.y;
      vectorShapeDraftRef.current = null;
    } else if (tool === 'vector-pen') {
      const nodes = vectorRef.current;
      if (nodes.length >= 3 && Math.hypot(p.x - nodes[0].x, p.y - nodes[0].y) * s.zoom <= 10) {
        vectorClosedRef.current = true;
        closeDraft(true);
      } else {
        const previous = nodes[nodes.length - 1];
        const target = e.shiftKey && previous ? constrainPoint(previous, p) : p;
        vectorRef.current = [...nodes, createVectorNode(snapPoint(target))];
        drag.current.mode = 'vector-place';
      }
    } else if (tool === 'vector-node') {
      let layer = activeEditableVectorLayer();
      const targetLayer = vectorLayerAt(p);
      if (targetLayer && targetLayer.id !== layer?.id) {
        s.selectLayer(targetLayer.id);
        layer = useEditor.getState().doc?.layers.find((candidate) => candidate.id === targetLayer.id) ?? null;
        vectorSelectedNodesRef.current.clear();
      }
      if (!layer?.vector?.shapes || layer.vector.kind !== 'editable') {
        vectorSelectedNodesRef.current.clear();
        return;
      }
      const nodeMode = useSettings.getState().toolDefaults.vectorNodeMode;
      const control = vectorControlHitAt(p, layer);
      const segment = vectorSegmentAt(p, layer);
      if (nodeMode === 'select' && e.altKey && control?.kind === 'node') {
        s.snapshot('Convertir nodo vectorial');
        const next = replaceVectorSubpath(layer.vector, control.shapeId, control.subpathId, (subpath) => convertVectorNode(subpath, control.nodeId));
        s.updateEditableVector(layer.id, next, true);
        s.finishVectorEdit(layer.id);
        vectorSelectedNodesRef.current = new Set([control.nodeId]);
        return;
      }
      if (nodeMode === 'add') {
        if (!segment) return;
        const shape = layer.vector.shapes.find((candidate) => candidate.id === segment.shapeId);
        const subpath = shape?.subpaths.find((candidate) => candidate.id === segment.subpathId);
        if (!subpath) return;
        const split = splitVectorSegment(subpath, segment.segmentIndex, segment.t);
        const inserted = split.nodes[segment.segmentIndex + 1];
        s.snapshot('Agregar nodo vectorial');
        s.updateEditableVector(layer.id, replaceVectorSubpath(layer.vector, segment.shapeId, segment.subpathId, () => split), true);
        vectorSelectedNodesRef.current = new Set(inserted ? [inserted.id] : []);
        return;
      }
      if (nodeMode === 'delete') {
        if (control?.kind === 'node') deleteVectorNodes(layer, new Set([control.nodeId]));
        return;
      }
      if (nodeMode === 'convert') {
        if (control?.kind !== 'node') return;
        s.snapshot('Convertir nodo vectorial');
        const next = replaceVectorSubpath(layer.vector, control.shapeId, control.subpathId, (subpath) => convertVectorNode(subpath, control.nodeId));
        s.updateEditableVector(layer.id, next, true);
        s.finishVectorEdit(layer.id);
        vectorSelectedNodesRef.current = new Set([control.nodeId]);
        return;
      }
      if (control?.kind === 'in' || control?.kind === 'out') {
        vectorSelectedNodesRef.current.add(control.nodeId);
        vectorDragStartRef.current = {
          layerId: layer.id,
          vector: cloneEditableVector(layer.vector),
          pointerLocal: documentToLayerPoint(layer, p, layer.vector.baseWidth, layer.vector.baseHeight),
          nodeId: control.nodeId,
          handle: control.kind,
          selectedBefore: new Set(vectorSelectedNodesRef.current),
          changed: false,
        };
        drag.current.mode = 'vector-handle';
      } else if (control?.kind === 'node') {
        if (e.shiftKey) {
          if (vectorSelectedNodesRef.current.has(control.nodeId)) vectorSelectedNodesRef.current.delete(control.nodeId);
          else vectorSelectedNodesRef.current.add(control.nodeId);
        } else if (!vectorSelectedNodesRef.current.has(control.nodeId)) {
          vectorSelectedNodesRef.current = new Set([control.nodeId]);
        }
        if (vectorSelectedNodesRef.current.has(control.nodeId)) {
          vectorDragStartRef.current = {
            layerId: layer.id,
            vector: cloneEditableVector(layer.vector),
            pointerLocal: documentToLayerPoint(layer, p, layer.vector.baseWidth, layer.vector.baseHeight),
            nodeId: control.nodeId,
            selectedBefore: new Set(vectorSelectedNodesRef.current),
            changed: false,
          };
          drag.current.mode = 'vector-node';
        }
      } else if (segment) {
        const subpath = layer.vector.shapes.find((shape) => shape.id === segment.shapeId)?.subpaths.find((path) => path.id === segment.subpathId);
        if (subpath) {
          const start = subpath.nodes[segment.segmentIndex];
          const end = subpath.nodes[(segment.segmentIndex + 1) % subpath.nodes.length];
          const endpoints = new Set([start.id, end.id]);
          vectorSelectedNodesRef.current = e.shiftKey
            ? new Set([...vectorSelectedNodesRef.current, ...endpoints])
            : endpoints;
          vectorDragStartRef.current = {
            layerId: layer.id,
            vector: cloneEditableVector(layer.vector),
            pointerLocal: documentToLayerPoint(layer, p, layer.vector.baseWidth, layer.vector.baseHeight),
            selectedBefore: new Set(vectorSelectedNodesRef.current),
            changed: false,
          };
          drag.current.mode = 'vector-node';
        }
      } else {
        if (!e.shiftKey) vectorSelectedNodesRef.current.clear();
        vectorMarqueeRef.current = { x: p.x, y: p.y, w: 0, h: 0 };
        vectorDragStartRef.current = {
          layerId: layer.id,
          vector: cloneEditableVector(layer.vector),
          pointerLocal: documentToLayerPoint(layer, p, layer.vector.baseWidth, layer.vector.baseHeight),
          selectedBefore: new Set(vectorSelectedNodesRef.current),
          changed: false,
        };
        drag.current.startDocX = p.x;
        drag.current.startDocY = p.y;
        drag.current.mode = 'vector-marquee';
      }
    } else if (tool === 'select-bezier') {
      const nodes = bezierRef.current;
      if (nodes.length >= 2 && Math.hypot(p.x - nodes[0].x, p.y - nodes[0].y) * s.zoom <= 8) {
        closeDraft(true);
      } else {
        if (!nodes.length) draftModeRef.current = selectionMode(e);
        const snapped = snapPoint(p);
        bezierRef.current = [...nodes, { x: snapped.x, y: snapped.y, hx: 0, hy: 0 }];
        drag.current.mode = 'bezier-place';
      }
    } else if (tool === 'pixel-stretch') {
      if (!s.activeLayer()) { s.toast('No hay ninguna capa activa', 'error'); return; }
      if (stretchEditMode === 'sample') {
        const current = effectiveStretchSample();
        const hit = stretchSampleControlAt(p, s.zoom);
        const sample: PixelStretchSample = current
          ? { origin: { ...current.origin }, angle: current.angle, manual: true }
          : { origin: snapPoint(p), angle: 0, manual: true };
        if (!hit) sample.origin = snapPoint(p);
        stretchSampleRef.current = sample;
        stretchSampleDragRef.current = {
          sample: { ...sample, origin: { ...sample.origin } },
          pointer: { ...p },
          width: useSettings.getState().toolDefaults.pixelStretchSampleWidth,
        };
        drag.current.handleSide = hit?.side ?? 1;
        drag.current.mode = !hit || hit.kind === 'move' ? 'stretch-sample-move' : 'stretch-sample-angle';
        schedulePixelStretchPreview();
        setStretchRevision((value) => value + 1);
      } else {
        const hit = stretchControlAt(p, s.zoom);
        if (hit) {
          stretchSelectedNodeRef.current = hit.index;
          drag.current.nodeIndex = hit.index;
          drag.current.handleSide = hit.side;
          drag.current.mode = hit.side === 0 ? 'stretch-node' : 'stretch-handle';
        } else {
          const snapped = snapPoint(p);
          stretchNodesRef.current = [
            ...stretchNodesRef.current,
            { x: snapped.x, y: snapped.y, inX: 0, inY: 0, outX: 0, outY: 0 },
          ];
          stretchSelectedNodeRef.current = stretchNodesRef.current.length - 1;
          drag.current.nodeIndex = stretchSelectedNodeRef.current;
          drag.current.handleSide = 1;
          drag.current.mode = 'stretch-place';
          schedulePixelStretchPreview();
          setStretchRevision((value) => value + 1);
        }
      }
    } else if (tool === 'warp-mesh') {
      if (!warpMeshRef.current) initializeWarpMesh();
      const hitIndex = warpControlAt(p, s.zoom);
      if (hitIndex < 0 || !warpMeshRef.current) return;
      warpSelectedNodeRef.current = hitIndex;
      warpDragStartRef.current = warpMeshRef.current.points.map((point) => ({ ...point }));
      drag.current.nodeIndex = hitIndex;
      drag.current.mode = 'warp-node';
      drag.current.startDocX = warpMeshRef.current.points[hitIndex].x;
      drag.current.startDocY = warpMeshRef.current.points[hitIndex].y;
      setWarpRevision((value) => value + 1);
    } else if (tool === 'wand') {
      const layer = s.activeLayer();
      if (!layer) { s.toast('No hay ninguna capa activa', 'error'); return; }
      draftModeRef.current = selectionMode(e);
      wandBaseRef.current = s.selection;
      drag.current.mode = 'wand-tolerance';
      drag.current.startX = e.clientX;
      drag.current.startDocX = p.x;
      drag.current.startDocY = p.y;
      drag.current.startTolerance = s.wandTolerance;
      const wandDefaults = useSettings.getState().toolDefaults;
      const next = wandDefaults.wandSampleSource === 'visible' && canvasRef.current
        ? magicWandCanvas(canvasRef.current, p, s.wandTolerance, s.wandContiguous, wandDefaults.wandIncludeTransparency)
        : magicWand(layer, p, doc.width, doc.height, s.wandTolerance, s.wandContiguous, wandDefaults.wandIncludeTransparency);
      wandPreviewRef.current = combineSelections(wandBaseRef.current, next, draftModeRef.current);
    } else if (tool === 'ai-mask') {
      void commitAiSelection(p, selectionMode(e));
      return;
    } else if (tool === 'bucket') {
      s.bucketFillAt(p);
    } else if (tool === 'text') {
      const hit = hitTextLayer(p);
      if (hit) onEditText(hit);
      else onNewText(p);
      return;
    }
    drag.current.lastX = e.clientX;
    drag.current.lastY = e.clientY;
    drag.current.lastDocX = p.x;
    drag.current.lastDocY = p.y;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = useEditor.getState();
    if (eyedropperActive) {
      const color = updateEyedropper(e.clientX, e.clientY);
      if (color) {
        const p = toDoc(e.clientX, e.clientY);
        scheduleCursor({ x: Math.floor(p.x), y: Math.floor(p.y) });
      }
      return;
    }
    if (doc) {
      const p = toDoc(e.clientX, e.clientY);
      scheduleCursor({ x: Math.round(p.x), y: Math.round(p.y) });
      hoverRef.current = (tool === 'select-poly' || tool === 'select-bezier' || tool === 'vector-shape' || tool === 'vector-pen' || tool === 'pixel-stretch' || tool === 'warp-mesh') ? snapPoint(p) : p;
      if (tool === 'vector-node' && !drag.current.mode) {
        const layer = activeEditableVectorLayer();
        if (layer) {
          const control = vectorControlHitAt(p, layer);
          if (control) vectorHoverRef.current = control;
          else {
            const segment = vectorSegmentAt(p, layer);
            vectorHoverRef.current = segment
              ? { kind: 'segment', point: layerToDocumentPoint(layer, segment.point, layer.vector!.baseWidth, layer.vector!.baseHeight) }
              : null;
          }
        } else vectorHoverRef.current = null;
      }
    }
    if (tool === 'eraser' || tool === 'brush' || tool === 'blur' || tool === 'sharpen') {
      updateBrushCursor(e.clientX, e.clientY);
    }

    const mode = drag.current.mode;
    if (!mode) return;
    const dxScreen = e.clientX - drag.current.lastX;
    const dyScreen = e.clientY - drag.current.lastY;
    const p = toDoc(e.clientX, e.clientY);

    if (mode === 'pan') {
      s.setPan(s.panX + dxScreen, s.panY + dyScreen);
    } else if (mode === 'text-edit-move') {
      const layer = editingTextLayerId
        ? s.doc?.layers.find((candidate) => candidate.id === editingTextLayerId)
        : null;
      if (layer) {
        if (!drag.current.moved && Math.hypot(dxScreen, dyScreen) >= 0.5) {
          s.snapshot('Mover texto');
          drag.current.moved = true;
        }
        const base = layerBounds(layer);
        const next = snapBounds({
          ...base,
          x: base.x + dxScreen / s.zoom,
          y: base.y + dyScreen / s.zoom,
        });
        s.setLayerPosition(layer.id, next.x, next.y);
      }
    } else if (mode === 'move') {
      const layer = s.activeLayer();
      if (layer) {
        if (!drag.current.moved && Math.hypot(dxScreen, dyScreen) >= 0.5) {
          s.snapshot('Mover capas');
          drag.current.moved = true;
        }
        const base = transformTarget?.kind === 'layer' ? transformTarget.b : layerBounds(layer);
        const nb = snapBounds({ ...base, x: base.x + dxScreen / s.zoom, y: base.y + dyScreen / s.zoom });
        s.moveActiveBy(nb.x - base.x, nb.y - base.y);
      }
    } else if (mode === 'selection-move') {
      const start = drag.current.startBounds;
      if (start) {
        const distance = Math.hypot(p.x - drag.current.startDocX, p.y - drag.current.startDocY) * s.zoom;
        if (!drag.current.moved && distance >= 2) {
          drag.current.moved = true;
          beginFloatingSelection();
        }
        const fl = floatingRef.current;
        if (fl && drag.current.moved) {
        const nb = snapBounds({
          ...start,
          x: start.x + (p.x - drag.current.startDocX),
          y: start.y + (p.y - drag.current.startDocY),
        });
        setFloating({ ...fl, bounds: nb });
        }
      }
    } else if (mode === 'wand-tolerance') {
      const tolerance = Math.max(0, Math.min(255, Math.round(drag.current.startTolerance + (e.clientX - drag.current.startX) / 2)));
      if (tolerance !== s.wandTolerance && doc) {
        s.setWand(tolerance);
        const layer = s.activeLayer();
        if (layer) {
          const origin = { x: drag.current.startDocX, y: drag.current.startDocY };
          const wandDefaults = useSettings.getState().toolDefaults;
          const next = wandDefaults.wandSampleSource === 'visible' && canvasRef.current
            ? magicWandCanvas(canvasRef.current, origin, tolerance, s.wandContiguous, wandDefaults.wandIncludeTransparency)
            : magicWand(layer, origin, doc.width, doc.height, tolerance, s.wandContiguous, wandDefaults.wandIncludeTransparency);
          wandPreviewRef.current = combineSelections(wandBaseRef.current, next, draftModeRef.current);
        }
      }
    } else if (mode === 'poly-node') {
      const index = drag.current.nodeIndex;
      const points = polyRef.current;
      if (index >= 0 && points[index]) {
        const next = e.shiftKey && index > 0 ? constrainPoint(points[index - 1], p) : p;
        polyRef.current = points.map((point, pointIndex) => pointIndex === index ? snapPoint(next) : point);
      }
    } else if (mode === 'vector-shape') {
      const sx = drag.current.startDocX;
      const sy = drag.current.startDocY;
      const fromCenter = e.altKey;
      let bounds = fromCenter
        ? { x: sx - Math.abs(p.x - sx), y: sy - Math.abs(p.y - sy), w: Math.abs(p.x - sx) * 2, h: Math.abs(p.y - sy) * 2 }
        : normalizeRect(sx, sy, p.x, p.y);
      if (e.shiftKey) {
        const side = Math.max(bounds.w, bounds.h);
        bounds = fromCenter
          ? { x: sx - side / 2, y: sy - side / 2, w: side, h: side }
          : { x: p.x >= sx ? sx : sx - side, y: p.y >= sy ? sy : sy - side, w: side, h: side };
      }
      bounds = snapBounds(bounds, false);
      const defaults = useSettings.getState().toolDefaults;
      vectorShapeDraftRef.current = createVectorPrimitive(defaults.vectorShapeKind, bounds, {
        sides: defaults.vectorPolygonSides,
        cornerRadius: defaults.vectorCornerRadius,
        style: {
          fill: defaults.vectorFillEnabled ? defaults.vectorFill : null,
          stroke: defaults.vectorStrokeEnabled ? defaults.vectorStroke : null,
          strokeWidth: defaults.vectorStrokeWidth,
          strokeAlign: defaults.vectorStrokeAlign,
          opacity: 1,
          fillRule: 'nonzero',
          lineCap: 'round',
          lineJoin: 'round',
          miterLimit: 4,
        },
      });
    } else if (mode === 'vector-place') {
      const nodes = vectorRef.current;
      const last = nodes[nodes.length - 1];
      if (last) {
        const target = e.shiftKey ? constrainPoint(last, p) : p;
        const outX = target.x - last.x;
        const outY = target.y - last.y;
        vectorRef.current = [
          ...nodes.slice(0, -1),
          {
            ...last,
            inX: -outX,
            inY: -outY,
            outX,
            outY,
            kind: Math.hypot(outX, outY) > 0.25 ? 'symmetric' : 'corner',
          },
        ];
      }
    } else if (mode === 'vector-node') {
      const start = vectorDragStartRef.current;
      const layer = start ? s.doc?.layers.find((candidate) => candidate.id === start.layerId) : null;
      if (start && layer?.vector?.kind === 'editable' && start.vector.shapes) {
        const constrained = e.shiftKey ? constrainPoint({ x: drag.current.startDocX, y: drag.current.startDocY }, p) : p;
        const local = documentToLayerPoint(layer, constrained, start.vector.baseWidth, start.vector.baseHeight);
        let delta = { x: local.x - start.pointerLocal.x, y: local.y - start.pointerLocal.y };
        const primaryId = start.nodeId ?? [...start.selectedBefore][0];
        const primary = primaryId ? findVectorNode(start.vector.shapes, primaryId)?.node : null;
        if (primary && useSettings.getState().snappingEnabled) {
          const proposed = layerToDocumentPoint(layer, { x: primary.x + delta.x, y: primary.y + delta.y }, start.vector.baseWidth, start.vector.baseHeight);
          const snapped = snapPoint(proposed, layer.id);
          const snappedLocal = documentToLayerPoint(layer, snapped, start.vector.baseWidth, start.vector.baseHeight);
          delta = { x: snappedLocal.x - primary.x, y: snappedLocal.y - primary.y };
        }
        if (!start.changed && Math.hypot(p.x - drag.current.startDocX, p.y - drag.current.startDocY) * s.zoom >= 0.5) {
          s.snapshot(start.selectedBefore.size > 1 ? 'Mover nodos vectoriales' : 'Mover nodo vectorial');
          start.changed = true;
        }
        if (start.changed) {
          const shapes = detachEditedPrimitives(
            mapVectorNodes(start.vector.shapes, start.selectedBefore, (node) => ({ ...node, x: node.x + delta.x, y: node.y + delta.y })),
            start.selectedBefore,
          );
          s.updateEditableVector(layer.id, makeEditableVector(shapes, start.vector.baseWidth, start.vector.baseHeight));
        }
      }
    } else if (mode === 'vector-handle') {
      const start = vectorDragStartRef.current;
      const layer = start ? s.doc?.layers.find((candidate) => candidate.id === start.layerId) : null;
      if (start?.nodeId && start.handle && layer?.vector?.kind === 'editable' && start.vector.shapes) {
        const found = findVectorNode(start.vector.shapes, start.nodeId);
        if (found) {
          const anchorDoc = layerToDocumentPoint(layer, found.node, start.vector.baseWidth, start.vector.baseHeight);
          const targetDoc = e.shiftKey ? constrainPoint(anchorDoc, p) : p;
          const local = documentToLayerPoint(layer, targetDoc, start.vector.baseWidth, start.vector.baseHeight);
          const handle = { x: local.x - found.node.x, y: local.y - found.node.y };
          if (!start.changed && Math.hypot(targetDoc.x - anchorDoc.x, targetDoc.y - anchorDoc.y) * s.zoom >= 0.5) {
            s.snapshot('Editar manejador Bézier');
            start.changed = true;
          }
          if (start.changed) {
            const ids = new Set([start.nodeId]);
            const shapes = detachEditedPrimitives(
              mapVectorNodes(start.vector.shapes, ids, (node) => setVectorNodeHandle(node, start.handle!, handle, e.altKey)),
              ids,
            );
            s.updateEditableVector(layer.id, makeEditableVector(shapes, start.vector.baseWidth, start.vector.baseHeight));
          }
        }
      }
    } else if (mode === 'vector-marquee') {
      vectorMarqueeRef.current = normalizeRect(drag.current.startDocX, drag.current.startDocY, p.x, p.y);
    } else if (mode === 'crop') {
      let next = normalizeRect(drag.current.startDocX, drag.current.startDocY, p.x, p.y);
      const ratio = cropRatio(cropAspect, cropVertical);
      if (ratio) {
        const wFromH = next.h * ratio;
        if (wFromH > next.w) next.h = next.w / ratio;
        else next.w = wFromH;
        if (p.x < drag.current.startDocX) next.x = drag.current.startDocX - next.w;
        if (p.y < drag.current.startDocY) next.y = drag.current.startDocY - next.h;
      }
      setCropRect(constrainBoundsSize(snapBounds(next, false), MAX_CROP_DIMENSION));
    } else if (mode === 'paint') {
      const paintMode = tool === 'eraser' ? 'erase' : tool === 'blur' ? 'blur' : tool === 'sharpen' ? 'sharpen' : 'paint';
      if (s.paintActiveStroke({ x: drag.current.lastDocX, y: drag.current.lastDocY }, p, paintMode, false)) {
        schedulePaintRender();
      }
    } else if (mode === 'select-shape') {
      const fromCenter = e.altKey;
      const sx = drag.current.startDocX;
      const sy = drag.current.startDocY;
      let r = fromCenter
        ? { x: sx - Math.abs(p.x - sx), y: sy - Math.abs(p.y - sy), w: Math.abs(p.x - sx) * 2, h: Math.abs(p.y - sy) * 2 }
        : normalizeRect(sx, sy, p.x, p.y);
      if (e.shiftKey) {
        // Shift constrains to a square/circle, anchored at the start corner
        // or symmetrically around it when Alt is held.
        const side = Math.max(r.w, r.h);
        r = fromCenter
          ? { x: sx - side / 2, y: sy - side / 2, w: side, h: side }
          : { x: p.x >= sx ? sx : sx - side, y: p.y >= sy ? sy : sy - side, w: side, h: side };
      }
      r = snapBounds(r, false);
      draftShapeRef.current = tool === 'select-rect'
        ? { kind: 'rect', ...r }
        : { kind: 'ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 };
    } else if (mode === 'bezier-place') {
      const nodes = bezierRef.current;
      const last = nodes[nodes.length - 1];
      if (last) {
        bezierRef.current = [
          ...nodes.slice(0, -1),
          { ...last, hx: p.x - last.x, hy: p.y - last.y },
        ];
      }
    } else if (mode === 'stretch-sample-move') {
      const start = stretchSampleDragRef.current;
      if (start) {
        const target = snapPoint({
          x: start.sample.origin.x + p.x - start.pointer.x,
          y: start.sample.origin.y + p.y - start.pointer.y,
        });
        stretchSampleRef.current = { ...start.sample, origin: target, manual: true };
        schedulePixelStretchPreview();
        setStretchRevision((value) => value + 1);
      }
    } else if (mode === 'stretch-sample-angle') {
      const start = stretchSampleDragRef.current;
      if (start) {
        const target = e.shiftKey ? constrainPoint(start.sample.origin, p) : p;
        const dx = target.x - start.sample.origin.x;
        const dy = target.y - start.sample.origin.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.5) {
          const angle = Math.atan2(dy, dx) + (drag.current.handleSide === -1 ? Math.PI : 0);
          stretchSampleRef.current = { ...start.sample, angle, manual: true };
          useSettings.getState().setToolDefaults({ pixelStretchSampleWidth: Math.round(Math.max(1, Math.min(2000, distance * 2))) });
          schedulePixelStretchPreview();
          setStretchRevision((value) => value + 1);
        }
      }
    } else if (mode === 'stretch-node') {
      const index = drag.current.nodeIndex;
      const node = stretchNodesRef.current[index];
      if (node) {
        const snapped = snapPoint(p);
        stretchNodesRef.current = stretchNodesRef.current.map((item, itemIndex) => itemIndex === index
          ? { ...item, x: snapped.x, y: snapped.y }
          : item);
        schedulePixelStretchPreview();
      }
    } else if (mode === 'stretch-place' || mode === 'stretch-handle') {
      const index = drag.current.nodeIndex;
      const node = stretchNodesRef.current[index];
      if (node) {
        const target = e.shiftKey ? constrainPoint(node, p) : p;
        const vx = target.x - node.x;
        const vy = target.y - node.y;
        const side = mode === 'stretch-place' ? 1 : drag.current.handleSide;
        stretchNodesRef.current = stretchNodesRef.current.map((item, itemIndex) => {
          if (itemIndex !== index) return item;
          if (side === 1) return {
            ...item,
            outX: vx,
            outY: vy,
            inX: e.altKey ? item.inX : -vx,
            inY: e.altKey ? item.inY : -vy,
          };
          return {
            ...item,
            inX: vx,
            inY: vy,
            outX: e.altKey ? item.outX : -vx,
            outY: e.altKey ? item.outY : -vy,
          };
        });
        schedulePixelStretchPreview();
      }
    } else if (mode === 'warp-node') {
      const mesh = warpMeshRef.current;
      const index = drag.current.nodeIndex;
      if (mesh && mesh.points[index]) {
        const origin = { x: drag.current.startDocX, y: drag.current.startDocY };
        const target = e.shiftKey ? constrainPoint(origin, p) : p;
        const snapped = snapPoint(target);
        const starts = warpDragStartRef.current.length === mesh.points.length ? warpDragStartRef.current : mesh.points;
        const selectedColumn = index % mesh.columns;
        const selectedRow = Math.floor(index / mesh.columns);
        const radius = e.altKey ? 0 : useSettings.getState().toolDefaults.warpMeshInfluence;
        const dx = snapped.x - origin.x;
        const dy = snapped.y - origin.y;
        mesh.points = starts.map((point, pointIndex) => {
          const column = pointIndex % mesh.columns;
          const row = Math.floor(pointIndex / mesh.columns);
          const distance = Math.hypot(column - selectedColumn, row - selectedRow);
          const weight = pointIndex === index ? 1 : radius > 0 ? Math.exp(-(distance * distance) / (2 * radius * radius)) : 0;
          return weight < 0.01 ? { ...point } : { x: point.x + dx * weight, y: point.y + dy * weight };
        });
        scheduleWarpPreview();
      }
    }
    drag.current.lastX = e.clientX;
    drag.current.lastY = e.clientY;
    drag.current.lastDocX = p.x;
    drag.current.lastDocY = p.y;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (eyedropperActive) return;
    const mode = drag.current.mode;
    try { containerRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (mode === 'paint') {
      if (paintRenderRafRef.current) {
        cancelAnimationFrame(paintRenderRafRef.current);
        paintRenderRafRef.current = 0;
      }
      useEditor.getState().finishActiveStroke();
    }
    if (mode === 'selection-move') commitFloatingSelection(drag.current.moved);
    if (mode === 'stretch-sample-move' || mode === 'stretch-sample-angle') stretchSampleDragRef.current = null;
    if (mode === 'wand-tolerance') {
      const preview = wandPreviewRef.current;
      wandPreviewRef.current = null;
      wandBaseRef.current = null;
      useEditor.getState().setSelection(preview);
    }
    if (mode === 'vector-shape') {
      const shape = vectorShapeDraftRef.current;
      vectorShapeDraftRef.current = null;
      const primitive = shape?.primitive;
      const bounds = primitive?.bounds;
      if (shape && primitive && bounds && bounds.w >= 2 && bounds.h >= 2) {
        if (!shape.style.fill && !shape.style.stroke) {
          useEditor.getState().toast('Activá un relleno o un trazo para crear la figura', 'error');
        } else {
          useEditor.getState().addVectorShape(shape, primitiveName(primitive.kind));
        }
      }
    }
    if (mode === 'select-shape') {
      const shape = draftShapeRef.current;
      draftShapeRef.current = null;
      const s = useEditor.getState();
      if (s.doc) {
        if (shape) {
          const b = shapeBounds(shape);
          if (b.w >= 2 && b.h >= 2) {
            commitSelection(selectionFromShape(shape, s.doc.width, s.doc.height), draftModeRef.current);
          } else {
            s.setSelection(null); // simple click deselects
          }
        } else {
          s.setSelection(null);
        }
      }
      draftModeRef.current = 'replace';
    }
    if (mode === 'vector-node' || mode === 'vector-handle') {
      const start = vectorDragStartRef.current;
      if (start?.changed) useEditor.getState().finishVectorEdit(start.layerId);
      vectorDragStartRef.current = null;
      vectorHoverRef.current = null;
    }
    if (mode === 'vector-marquee') {
      const start = vectorDragStartRef.current;
      const layer = start ? useEditor.getState().doc?.layers.find((candidate) => candidate.id === start.layerId) : null;
      const marquee = vectorMarqueeRef.current;
      if (layer?.vector?.shapes && marquee) {
        const inside = layer.vector.shapes.flatMap((shape) => shape.subpaths.flatMap((subpath) => subpath.nodes
          .filter((node) => {
            const point = layerToDocumentPoint(layer, node, layer.vector!.baseWidth, layer.vector!.baseHeight);
            return point.x >= marquee.x && point.x <= marquee.x + marquee.w && point.y >= marquee.y && point.y <= marquee.y + marquee.h;
          })
          .map((node) => node.id)));
        vectorSelectedNodesRef.current = new Set([...(start?.selectedBefore ?? []), ...inside]);
      }
      vectorMarqueeRef.current = null;
      vectorDragStartRef.current = null;
    }
    if (mode === 'warp-node') warpDragStartRef.current = [];
    setSnapLines(null);
    drag.current.mode = null;
    drag.current.startBounds = null;
    drag.current.nodeIndex = -1;
    drag.current.handleSide = 0;
    drag.current.moved = false;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!doc) return;
    const el = e.target as HTMLElement;
    if (el.closest('[data-ui], button, input, select')) return;
    if (tool === 'select-poly' || tool === 'select-bezier' || tool === 'vector-pen' || tool === 'pixel-stretch') {
      closeDraft(true);
      return;
    }
    if (tool === 'vector-node') {
      const layer = activeEditableVectorLayer();
      const point = toDoc(e.clientX, e.clientY);
      const segment = layer ? vectorSegmentAt(point, layer) : null;
      if (layer?.vector?.shapes && segment) {
        const shape = layer.vector.shapes.find((candidate) => candidate.id === segment.shapeId);
        const subpath = shape?.subpaths.find((candidate) => candidate.id === segment.subpathId);
        if (subpath) {
          const split = splitVectorSegment(subpath, segment.segmentIndex, segment.t);
          const inserted = split.nodes[segment.segmentIndex + 1];
          useEditor.getState().snapshot('Agregar nodo vectorial');
          useEditor.getState().updateEditableVector(layer.id, replaceVectorSubpath(layer.vector, segment.shapeId, segment.subpathId, () => split), true);
          vectorSelectedNodesRef.current = new Set(inserted ? [inserted.id] : []);
        }
      }
      return;
    }
    if (tool === 'move') {
      const hit = hitTextLayer(toDoc(e.clientX, e.clientY));
      if (hit) onEditText(hit);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (tool === 'vector-pen' && vectorRef.current.length >= 2) {
      e.preventDefault();
      closeDraft(true);
      return;
    }
    if (tool !== 'select-poly' || polyRef.current.length < 3) return;
    e.preventDefault();
    closeDraft(true);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!doc) return;
    const s = useEditor.getState();
    if (e.ctrlKey || e.metaKey) {
      const rect = containerRef.current!.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newZoom = Math.max(0.02, Math.min(32, s.zoom * factor));
      // Zoom anchored at cursor
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const docX = (cx - s.panX) / s.zoom;
      const docY = (cy - s.panY) / s.zoom;
      s.setZoom(newZoom);
      s.setPan(cx - docX * newZoom, cy - docY * newZoom);
    } else {
      s.setPan(s.panX - e.deltaX, s.panY - e.deltaY);
    }
  };

  // ── Transform handles (resize layer or selection) ──
  const transformTarget = ((): { kind: 'selection' | 'layer'; b: Bounds; angle: number } | null => {
    if (!doc) return null;
    if (floating) return { kind: 'selection', b: floating.bounds, angle: floating.angle };
    if (editingTextLayerId) {
      const layer = doc.layers.find((candidate) => candidate.id === editingTextLayerId);
      if (layer?.text && layer.visible && !layer.locked && !layer.lockPixels) {
        return { kind: 'layer', b: layerBounds(layer), angle: layer.rotation ?? 0 };
      }
    }
    const selectish = tool === 'move' || tool.startsWith('select-') || tool === 'wand' || tool === 'ai-mask';
    if (selection && selectish && selection.bounds.w >= 1 && selection.bounds.h >= 1) {
      return { kind: 'selection', b: selection.bounds, angle: 0 };
    }
    if (tool === 'move' && doc.activeId) {
      const selected = doc.layers.filter((layer) => selectedLayerIds.includes(layer.id) && layer.visible && !layer.locked && layer.kind !== 'group' && layer.kind !== 'adjustment');
      const layers = selected.length ? selected : doc.layers.filter((layer) => layer.id === doc.activeId && layer.visible && !layer.locked);
      if (layers.length) {
        const bounds = layers.map(layerBounds);
        const left = Math.min(...bounds.map((b) => b.x));
        const top = Math.min(...bounds.map((b) => b.y));
        const right = Math.max(...bounds.map((b) => b.x + b.w));
        const bottom = Math.max(...bounds.map((b) => b.y + b.h));
        return { kind: 'layer', b: { x: left, y: top, w: right - left, h: bottom - top }, angle: layers.length === 1 ? layers[0].rotation ?? 0 : 0 };
      }
    }
    return null;
  })();

  const beginTransform = (handle: HandleId) => (e: React.PointerEvent) => {
    if (!transformTarget) return;
    e.preventDefault();
    e.stopPropagation();
    const s = useEditor.getState();
    const kind = transformTarget.kind;

    // Con una herramienta de selección activa (no Mover) y una selección
    // todavía no flotante, los handles ajustan el ÁREA seleccionada — no
    // cortan píxeles de la capa. Cortar/mover el contenido sigue siendo
    // exclusivo de la herramienta Mover (Transformación libre), que es la
    // única que dispara beginFloatingSelection más abajo.
    if (kind === 'selection' && tool !== 'move' && !floatingRef.current) {
      const baseSelection = s.selection;
      if (!baseSelection) return;
      const start = { ...transformTarget.b };
      const startX = e.clientX;
      const startY = e.clientY;
      const onMove = (ev: PointerEvent) => {
        const st = useEditor.getState();
        if (!st.doc) return;
        const ddx = (ev.clientX - startX) / st.zoom;
        const ddy = (ev.clientY - startY) / st.zoom;
        const nb = snapBounds(resizeBounds(start, handle, ddx, ddy, ev.shiftKey));
        st.setSelection(transformSelection(baseSelection, nb, st.doc.width, st.doc.height));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    let start = { ...transformTarget.b };
    const selectedStarts = kind === 'layer' && s.doc
      ? s.doc.layers.filter((layer) => s.selectedLayerIds.includes(layer.id) && !layer.locked && layer.kind !== 'group' && layer.kind !== 'adjustment').map((layer) => ({ id: layer.id, b: layerBounds(layer) }))
      : [];
    let activeFloating = floatingRef.current;
    let changed = false;
    if (kind === 'selection') {
      if (activeFloating) start = { ...activeFloating.bounds };
    }
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      const st = useEditor.getState();
      const ddx = (ev.clientX - startX) / st.zoom;
      const ddy = (ev.clientY - startY) / st.zoom;
      if (!changed && Math.hypot(ddx, ddy) < 0.5) return;
      if (!changed) {
        changed = true;
        if (kind === 'layer') st.snapshot(selectedStarts.length > 1 ? 'Transformar capas' : 'Transformar capa');
        else if (!floatingRef.current) {
          activeFloating = beginFloatingSelection();
          if (!activeFloating) return;
          start = { ...activeFloating.bounds };
        }
      }
      const nb = snapBounds(resizeBounds(start, handle, ddx, ddy, ev.shiftKey));
      if (kind === 'layer' && st.doc?.activeId) {
        if (selectedStarts.length > 1) {
          const sx = nb.w / Math.max(1, start.w);
          const sy = nb.h / Math.max(1, start.h);
          selectedStarts.forEach((item) => st.setLayerBounds(item.id, {
            x: nb.x + (item.b.x - start.x) * sx,
            y: nb.y + (item.b.y - start.y) * sy,
            w: item.b.w * sx,
            h: item.b.h * sy,
          }));
        } else {
          st.setLayerBounds(st.doc.activeId, nb);
        }
      } else if (kind === 'selection') {
        const fl = floatingRef.current;
        if (fl) setFloating({ ...fl, bounds: nb });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const st = useEditor.getState();
      if (changed && kind === 'layer' && st.doc?.activeId) {
        const ids = selectedStarts.length > 1 ? selectedStarts.map((item) => item.id) : [st.doc.activeId];
        ids.forEach((id) => st.bakeLayerTransform(id));
      }
      if (changed && kind === 'selection' && floatingRef.current) commitFloatingSelection();
      setSnapLines(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const beginRotate = (e: React.PointerEvent) => {
    if (!transformTarget) return;
    if (transformTarget.kind === 'selection' && tool !== 'move' && !floatingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const kind = transformTarget.kind;
    const center = { x: transformTarget.b.x + transformTarget.b.w / 2, y: transformTarget.b.y + transformTarget.b.h / 2 };
    const startPt = toDoc(e.clientX, e.clientY);
    const startPointer = Math.atan2(startPt.y - center.y, startPt.x - center.x);
    const startAngle = transformTarget.angle;
    const state = useEditor.getState();
    const selected = state.doc?.layers.filter((layer) =>
      (state.selectedLayerIds.includes(layer.id) || layer.id === state.doc?.activeId) &&
      layer.kind !== 'group' && layer.kind !== 'adjustment' && !layer.locked,
    ) ?? [];
    const layerStarts = selected.map((layer) => {
      const bounds = layerBounds(layer);
      return {
        id: layer.id,
        bounds,
        angle: layer.rotation ?? 0,
        center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
      };
    });
    let changed = false;
    const onMove = (ev: PointerEvent) => {
      const cur = toDoc(ev.clientX, ev.clientY);
      const rawAngle = startAngle + Math.atan2(cur.y - center.y, cur.x - center.x) - startPointer;
      const angle = ev.shiftKey ? Math.round(rawAngle / (Math.PI / 12)) * (Math.PI / 12) : rawAngle;
      const delta = angle - startAngle;
      if (!changed && Math.abs(delta) < 0.002) return;
      if (!changed) {
        changed = true;
        if (kind === 'layer') state.snapshot(layerStarts.length > 1 ? 'Rotar capas' : 'Rotar capa');
        else if (!floatingRef.current && !beginFloatingSelection()) return;
      }
      if (kind === 'selection') {
        const current = floatingRef.current;
        if (current) setFloating({ ...current, angle });
        return;
      }
      const cos = Math.cos(delta);
      const sin = Math.sin(delta);
      const currentState = useEditor.getState();
      layerStarts.forEach((item) => {
        const dx = item.center.x - center.x;
        const dy = item.center.y - center.y;
        const nextCenter = { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
        currentState.setLayerBounds(item.id, {
          x: nextCenter.x - item.bounds.w / 2,
          y: nextCenter.y - item.bounds.h / 2,
          w: item.bounds.w,
          h: item.bounds.h,
        });
        currentState.setLayerRotation(item.id, item.angle + delta);
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (changed && kind === 'selection' && floatingRef.current) commitFloatingSelection();
      setSnapLines(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const cursorStyle =
    eyedropperActive ? 'none'
    : tool === 'hand' || spaceDown ? 'grab'
    : tool === 'zoom' ? 'zoom-in'
    : editingTextLayerId ? 'move'
    : tool === 'move' ? 'move'
    : tool === 'vector-node' ? vectorNodeMode === 'add' ? 'cell' : vectorNodeMode === 'delete' ? 'not-allowed' : vectorNodeMode === 'convert' ? 'crosshair' : 'default'
    : tool === 'crop' || tool.startsWith('select-') || tool === 'wand' || tool === 'ai-mask' || tool === 'pixel-stretch' || tool === 'warp-mesh' || tool === 'bucket' || tool === 'vector-shape' || tool === 'vector-pen' ? 'crosshair'
    : tool === 'text' ? 'text'
    : tool === 'eraser' || tool === 'brush' || tool === 'blur' || tool === 'sharpen' ? 'none'
    : 'default';

  // Exact crop size typed in ToolOptions (free aspect): resize the current
  // rect keeping its position, or create one centered if none exists yet.
  const setCropSize = (wPx: number, hPx: number) => {
    if (!doc) return;
    const w = Math.max(1, Math.min(Math.round(wPx), MAX_CROP_DIMENSION));
    const h = Math.max(1, Math.min(Math.round(hPx), MAX_CROP_DIMENSION));
    setCropRect((r) => {
      const x = r ? r.x : (doc.width - w) / 2;
      const y = r ? r.y : (doc.height - h) / 2;
      return { x: Math.round(x), y: Math.round(y), w, h };
    });
  };

  const beginCropResize = (handle: HandleId) => (e: React.PointerEvent) => {
    const start = cropRectRef.current;
    if (!start || !doc) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const ratio = cropRatio(useSettings.getState().cropAspect, useSettings.getState().cropVertical);
    const onMove = (ev: PointerEvent) => {
      const s = useEditor.getState();
      if (!s.doc) return;
      const ddx = (ev.clientX - startX) / s.zoom;
      const ddy = (ev.clientY - startY) / s.zoom;
      const resized = resizeBounds(start, handle, ddx, ddy, ratio != null || ev.shiftKey);
      setCropRect(constrainBoundsSize(snapBounds(resized, false), MAX_CROP_DIMENSION));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const beginCropMove = (e: React.PointerEvent) => {
    const start = cropRectRef.current;
    if (!start || !doc) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const s = useEditor.getState();
      if (!s.doc) return;
      const next = {
        ...start,
        x: start.x + (ev.clientX - startX) / s.zoom,
        y: start.y + (ev.clientY - startY) / s.zoom,
      };
      setCropRect(constrainBoundsSize(snapBounds(next, false), MAX_CROP_DIMENSION));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Crop overlay geometry in screen space
  const cropScreen = cropRect && {
    left: panX + cropRect.x * zoom,
    top: panY + cropRect.y * zoom,
    width: cropRect.w * zoom,
    height: cropRect.h * zoom,
  };
  const suggestedUpscale: CropUpscale = cropRect && doc
    ? Math.min(doc.width / Math.max(1, cropRect.w), doc.height / Math.max(1, cropRect.h)) >= 4
      ? 4
      : Math.min(doc.width / Math.max(1, cropRect.w), doc.height / Math.max(1, cropRect.h)) >= 2
        ? 2
        : 1
    : 1;
  const stageWidth = containerRef.current?.clientWidth ?? 0;
  const stageHeight = containerRef.current?.clientHeight ?? 0;
  const cropActionsLeft = cropScreen ? Math.max(8, Math.min(cropScreen.left, Math.max(8, stageWidth - 500))) : 8;
  const cropActionsTop = cropScreen
    ? cropScreen.top + cropScreen.height + 44 <= stageHeight
      ? cropScreen.top + cropScreen.height + 8
      : Math.max(8, cropScreen.top - 42)
    : 8;

  return (
    <div
      className={`stage ${eyedropperActive ? 'eyedropper-active' : ''} ${maskTargetId ? 'mask-editing' : ''}`}
      ref={containerRef}
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
      onPointerLeave={() => {
        scheduleCursor(null);
        if (brushCursorRef.current) brushCursorRef.current.style.display = 'none';
        setSnapLines(null);
        hoverRef.current = null;
        if (eyedropperLoupeRef.current) eyedropperLoupeRef.current.style.display = 'none';
      }}
    >
      {!doc && (
        <div className="empty-state">
          <div className="empty-start" data-ui>
            <button
              className="empty-image-button"
              onClick={() => setEmptyMenu((v) => !v)}
              title="Crear o abrir"
            >
              <Icon name="image-plus" size={76} />
            </button>
            {emptyMenu && (
              <div className="empty-start-menu">
                <button onClick={() => { setEmptyMenu(false); onNewDocument(); }}>Nuevo archivo</button>
                <button onClick={() => { setEmptyMenu(false); onNewFromClipboard(); }}>Desde portapapeles</button>
                <button onClick={() => { setEmptyMenu(false); onImport(); }}>Abrir imagen</button>
              </div>
            )}
          </div>
          <h2>Arrastrá una imagen para empezar</h2>
          <p>Soltá un archivo, pegá con <kbd>⌘V</kbd> o usá <kbd>Abrir</kbd>.</p>
          <p>Formatos: PNG · JPG · WEBP · SVG · PDF · EPS</p>
        </div>
      )}

      {doc && (
        <div
          className={`stage-canvas-wrap ${canvasBgColor === CANVAS_BACKGROUND_MOTION_DIAGONAL
            ? 'canvas-bg-motion-diagonal'
            : canvasBgColor === CANVAS_BACKGROUND_MOTION_CHECKER
              ? 'canvas-bg-motion-checker'
              : ''}`}
          style={{
            left: panX,
            top: panY,
            width: doc.width,
            height: doc.height,
            transform: `scale(${zoom})`,
            ...(solidCanvasBgColor
              ? { backgroundColor: solidCanvasBgColor, backgroundImage: 'none' }
              : null),
          }}
        >
          <canvas
            ref={canvasRef}
            width={doc.width}
            height={doc.height}
            style={{ width: doc.width, height: doc.height }}
          />
        </div>
      )}

      <div className="stage-overlay">
        <canvas ref={antsRef} className="ants-canvas" />

        {doc && snapLines?.x != null && <div className="snap-feedback-line vertical" style={{ left: panX + snapLines.x * zoom, top: panY, height: doc.height * zoom }} />}
        {doc && snapLines?.y != null && <div className="snap-feedback-line horizontal" style={{ left: panX, top: panY + snapLines.y * zoom, width: doc.width * zoom }} />}

        {(cropRect || transformTarget) && (
          <div className="geometry-readout" data-ui>
            <strong>{cropRect ? 'Recorte' : transformTarget?.kind === 'selection' ? 'Selección' : selectedLayerIds.length > 1 ? `${selectedLayerIds.length} capas` : 'Capa'}</strong>
            <span><b>X</b> {Math.round((cropRect ?? transformTarget!.b).x)}</span>
            <span><b>Y</b> {Math.round((cropRect ?? transformTarget!.b).y)}</span>
            <span><b>W</b> {Math.round((cropRect ?? transformTarget!.b).w)}</span>
            <span><b>H</b> {Math.round((cropRect ?? transformTarget!.b).h)}</span>
            {!cropRect && !!transformTarget?.angle && <span><b>∠</b> {Math.round(transformTarget.angle * 180 / Math.PI)}°</span>}
          </div>
        )}

        {maskTargetId && doc && <div className="stage-mask-badge" data-ui><Icon name="mask" size={13} /> Máscara</div>}

        {(doc?.artboards ?? []).map((board) => (
          <div key={board.id} className="artboard-outline" style={{
            left: panX + board.x * zoom, top: panY + board.y * zoom,
            width: board.w * zoom, height: board.h * zoom,
          }}><span>{board.name}</span></div>
        ))}

        {cropScreen && (
          <>
            <div className="crop-outside" style={{ left: 0, top: 0, right: 0, height: Math.max(0, cropScreen.top) }} />
            <div className="crop-outside" style={{ left: 0, top: cropScreen.top + cropScreen.height, right: 0, bottom: 0 }} />
            <div className="crop-outside" style={{ left: 0, top: cropScreen.top, width: Math.max(0, cropScreen.left), height: cropScreen.height }} />
            <div className="crop-outside" style={{ left: cropScreen.left + cropScreen.width, top: cropScreen.top, right: 0, height: cropScreen.height }} />
              <div
                className="crop-frame"
                data-ui
                style={{
                  position: 'absolute',
                  ...cropScreen,
                  pointerEvents: 'auto',
                  cursor: 'move',
                  touchAction: 'none',
                }}
                onPointerDown={beginCropMove}
                title="Arrastrar para mover el área de recorte"
              />
            {CROP_HANDLES.map((h) => (
              <div
                key={`crop-${h.id}`}
                data-ui
                className="crop-handle"
                style={{
                  left: cropScreen.left + cropScreen.width * h.ux - 5,
                  top: cropScreen.top + cropScreen.height * h.uy - 5,
                  cursor: h.cursor,
                }}
                onPointerDown={beginCropResize(h.id)}
                title="Arrastrar para reajustar el recorte"
              />
            ))}
            <div data-ui className="crop-actions" style={{
              position: 'absolute',
              left: cropActionsLeft, top: cropActionsTop,
              display: 'flex', gap: 6, pointerEvents: 'auto',
            }}>
              <button className="tbtn primary" onClick={applyCrop}>Aplicar recorte</button>
              <button className="tbtn" onClick={() => setCropRect(null)}>Cancelar</button>
              <span className="crop-output-label">Salida</span>
              {([1, 2, 4] as CropUpscale[]).map((scale) => (
                <button
                  key={scale}
                  className={`mini-btn ${cropUpscale === scale ? 'on' : ''} ${suggestedUpscale === scale && scale > 1 ? 'suggested' : ''}`}
                  onClick={() => setCropUpscale(scale)}
                  title={suggestedUpscale === scale && scale > 1 ? `Upscale ${scale}× sugerido para este recorte` : `Salida ${scale}×`}
                >{scale}×</button>
              ))}
              {suggestedUpscale > 1 && <span className="crop-suggestion">Sugerido {suggestedUpscale}×</span>}
              <span style={{ alignSelf: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
                {Math.round(cropRect!.w * cropUpscale)} × {Math.round(cropRect!.h * cropUpscale)} px
              </span>
            </div>
          </>
        )}

        <div
          ref={brushCursorRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            display: 'none',
            left: 0,
            top: 0,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.8)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            willChange: 'transform',
          }}
        />

        {transformTarget && (
          <>
            {floating && (
              <canvas
                ref={floatingCanvasRef}
                className="floating-selection"
                style={{
                  left: panX + (floating.bounds.x + floating.bounds.w / 2) * zoom,
                  top: panY + (floating.bounds.y + floating.bounds.h / 2) * zoom,
                  width: floating.bounds.w * zoom,
                  height: floating.bounds.h * zoom,
                  transform: `translate(-50%, -50%) rotate(${floating.angle}rad)`,
                }}
              />
            )}
            {transformTarget.kind === 'layer' && (
              <div className="transform-outline" style={{
                left: panX + (transformTarget.b.x + transformTarget.b.w / 2) * zoom,
                top: panY + (transformTarget.b.y + transformTarget.b.h / 2) * zoom,
                width: transformTarget.b.w * zoom,
                height: transformTarget.b.h * zoom,
                transform: `translate(-50%, -50%) rotate(${transformTarget.angle}rad)`,
              }} />
            )}
            {transformTarget.kind === 'selection' && (
              <div className="transform-outline" style={{
                left: panX + (transformTarget.b.x + transformTarget.b.w / 2) * zoom,
                top: panY + (transformTarget.b.y + transformTarget.b.h / 2) * zoom,
                width: transformTarget.b.w * zoom,
                height: transformTarget.b.h * zoom,
                transform: `translate(-50%, -50%) rotate(${transformTarget.angle}rad)`,
              }} />
            )}
            {(transformTarget.kind === 'layer' || tool === 'move' || floating) && (() => {
              const p = rotatePoint(
                {
                  x: transformTarget.b.x + transformTarget.b.w / 2,
                  y: transformTarget.b.y - 28 / zoom,
                },
                transformTarget.b,
                transformTarget.angle,
              );
              return (
                <div
                  data-ui
                  className="rotate-handle"
                  style={{ left: panX + p.x * zoom - 5, top: panY + p.y * zoom - 5 }}
                  onPointerDown={beginRotate}
                  title={`Arrastrar para rotar ${transformTarget.kind === 'selection' ? 'la selección' : selectedLayerIds.length > 1 ? 'las capas' : 'la capa'} · Shift: pasos de 15°`}
                />
              );
            })()}
            {HANDLES.map((h) => (
              (() => {
                const p = rotatePoint(
                  {
                    x: transformTarget.b.x + transformTarget.b.w * h.ux,
                    y: transformTarget.b.y + transformTarget.b.h * h.uy,
                  },
                  transformTarget.b,
                  transformTarget.angle,
                );
                return (
              <div
                key={h.id}
                data-ui
                className="transform-handle"
                style={{
                  left: panX + p.x * zoom - 4,
                  top: panY + p.y * zoom - 4,
                  cursor: h.cursor,
                }}
                onPointerDown={beginTransform(h.id)}
                title="Arrastrar para redimensionar · Shift: proporcional / simétrico"
              />
                );
              })()
            ))}
          </>
        )}
      </div>

      {eyedropperActive && (
        <div ref={eyedropperLoupeRef} className="eyedropper-loupe" data-ui>
          <div className="eyedropper-loupe-glass">
            <canvas ref={eyedropperCanvasRef} width={11} height={11} />
            <span className="eyedropper-pixel-target" />
          </div>
          <div className="eyedropper-readout">
            <span ref={eyedropperSwatchRef} className="eyedropper-readout-swatch" />
            <span ref={eyedropperCodeRef}>#000000</span>
          </div>
        </div>
      )}

      {doc && showGuides && <GuideLines />}
      {doc && showGuides && <Rulers />}
      <ToolOptions
        cropRect={cropRect}
        onCropSize={setCropSize}
        pixelStretchReady={stretchNodesRef.current.length >= 2}
        onApplyPixelStretch={applyPixelStretch}
        onCancelPixelStretch={cancelPixelStretch}
        pixelStretchEditMode={stretchEditMode}
        onPixelStretchEditMode={setStretchEditMode}
        onResetPixelStretchSample={resetPixelStretchSample}
        warpMeshReady={!!warpMeshRef.current}
        onApplyWarpMesh={applyWarpMesh}
        onCancelWarpMesh={() => { cancelWarpMesh(); useEditor.getState().setTool('move'); }}
        onResetWarpMesh={resetWarpMesh}
      />
    </div>
  );
});
