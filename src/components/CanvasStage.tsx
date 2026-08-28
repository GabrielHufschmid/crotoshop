import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import type React from 'react';
import { useEditor } from '../store/editorStore';
import { cropRatio, useSettings } from '../store/settingsStore';
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
import type { Pt, Selection, SelectionShape } from '../types';
import { GuideLines, Rulers } from './RulersGuides';
import { ToolOptions } from './ToolOptions';
import { Icon } from './Icons';
import { layerBounds } from '../engine/layerGeometry';
import { hexToRgb, rgbToHex } from '../engine/color';

export interface StageHandle {
  fit: () => void;
}

interface Props {
  onImport: () => void;
  onNewDocument: () => void;
  onNewFromClipboard: () => void;
  onEditText: (layerId: string) => void;
  onNewText: (pt: Pt) => void;
}

interface CropRect { x: number; y: number; w: number; h: number; }
interface Bounds { x: number; y: number; w: number; h: number; }
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

function normRect(ax: number, ay: number, bx: number, by: number): CropRect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

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

function constrainCropBounds(b: Bounds): Bounds {
  return {
    x: b.x,
    y: b.y,
    w: Math.max(1, Math.min(MAX_CROP_DIMENSION, b.w)),
    h: Math.max(1, Math.min(MAX_CROP_DIMENSION, b.h)),
  };
}

/**
 * Resizes a bounds rect by dragging one of its 8 handles.
 * Edges move one axis (shift: symmetric about the center); corners move both
 * (shift: keep aspect ratio, anchored at the opposite corner).
 */
function resizeBounds(b: Bounds, handle: HandleId, ddx: number, ddy: number, shift: boolean): Bounds {
  const dx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const dy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  const isCorner = dx !== 0 && dy !== 0;
  let { x, y, w, h } = b;

  if (!isCorner && shift) {
    if (dx === 1) { x = b.x - ddx; w = b.w + 2 * ddx; }
    if (dx === -1) { x = b.x + ddx; w = b.w - 2 * ddx; }
    if (dy === 1) { y = b.y - ddy; h = b.h + 2 * ddy; }
    if (dy === -1) { y = b.y + ddy; h = b.h - 2 * ddy; }
  } else {
    if (dx === 1) w = b.w + ddx;
    if (dx === -1) { x = b.x + ddx; w = b.w - ddx; }
    if (dy === 1) h = b.h + ddy;
    if (dy === -1) { y = b.y + ddy; h = b.h - ddy; }
    if (isCorner && shift && b.w > 0 && b.h > 0) {
      const ratio = b.w / b.h;
      if (Math.abs(w / b.w - 1) >= Math.abs(h / b.h - 1)) {
        const nh = w / ratio;
        if (dy === -1) y = b.y + (b.h - nh);
        h = nh;
      } else {
        const nw = h * ratio;
        if (dx === -1) x = b.x + (b.w - nw);
        w = nw;
      }
    }
  }
  if (w < 1) w = 1;
  if (h < 1) h = 1;
  return { x, y, w, h };
}

/** Topmost visible text layer whose display bounds contain the point. */
function hitTextLayer(p: Pt): string | null {
  const d = useEditor.getState().doc;
  if (!d) return null;
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const l = d.layers[i];
    if (!l.text || !l.visible) continue;
    const w = l.w ?? l.canvas.width;
    const h = l.h ?? l.canvas.height;
    if (p.x >= l.x && p.y >= l.y && p.x <= l.x + w && p.y <= l.y + h) return l.id;
  }
  return null;
}

export const CanvasStage = forwardRef<StageHandle, Props>(function CanvasStage(
  { onImport, onNewDocument, onNewFromClipboard, onEditText, onNewText }, ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const antsRef = useRef<HTMLCanvasElement>(null);
  const eyedropperLoupeRef = useRef<HTMLDivElement>(null);
  const eyedropperCanvasRef = useRef<HTMLCanvasElement>(null);
  const eyedropperCodeRef = useRef<HTMLSpanElement>(null);
  const eyedropperSwatchRef = useRef<HTMLSpanElement>(null);
  const lastEyedropperColorRef = useRef<string | null>(null);
  const eyedropperErrorRef = useRef(false);

  const doc = useEditor((s) => s.doc);
  const rev = useEditor((s) => s.rev);
  const zoom = useEditor((s) => s.zoom);
  const panX = useEditor((s) => s.panX);
  const panY = useEditor((s) => s.panY);
  const tool = useEditor((s) => s.tool);
  const brushSize = useEditor((s) => s.brushSize);
  const selection = useEditor((s) => s.selection);
  const selectedLayerIds = useEditor((s) => s.selectedLayerIds);
  const eyedropperActive = useEditor((s) => s.eyedropperActive);
  const showGuides = useSettings((s) => s.showGuides);
  const canvasBgColor = useSettings((s) => s.canvasBgColor);
  const cropAspect = useSettings((s) => s.cropAspect);
  const cropVertical = useSettings((s) => s.cropVertical);
  const cropUpscale = useSettings((s) => s.cropUpscale);
  const setCropUpscale = useSettings((s) => s.setCropUpscale);

  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [brushPos, setBrushPos] = useState<{ x: number; y: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [emptyMenu, setEmptyMenu] = useState(false);
  const [floating, setFloatingState] = useState<FloatingSelection | null>(null);
  const floatingRef = useRef<FloatingSelection | null>(null);
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

  // Selection drafts live in refs: the marching-ants rAF loop reads them each
  // frame, so no React re-renders are needed while drawing.
  const draftShapeRef = useRef<SelectionShape | null>(null);
  const polyRef = useRef<Pt[]>([]);
  const vectorRef = useRef<Pt[]>([]);
  const bezierRef = useRef<BezierNode[]>([]);
  const hoverRef = useRef<Pt | null>(null);
  const draftModeRef = useRef<SelectionCombineMode>('replace');
  const maskTintRef = useRef<{ mask: HTMLCanvasElement; tint: HTMLCanvasElement } | null>(null);
  const wandPreviewRef = useRef<Selection | null>(null);
  const wandBaseRef = useRef<Selection | null>(null);
  const maskPreviewRef = useRef(false);

  const drag = useRef<{
    mode: 'move' | 'pan' | 'paint' | 'crop' | 'select-shape' | 'bezier-place' | 'selection-move' | 'wand-tolerance' | 'poly-node' | null;
    lastX: number; lastY: number;      // screen
    startX: number;
    lastDocX: number; lastDocY: number; // doc
    startDocX: number; startDocY: number;
    startBounds: Bounds | null;
    startTolerance: number;
    nodeIndex: number;
    moved: boolean;
  }>({ mode: null, lastX: 0, lastY: 0, startX: 0, lastDocX: 0, lastDocY: 0, startDocX: 0, startDocY: 0, startBounds: null, startTolerance: 0, nodeIndex: -1, moved: false });

  // ── Recomposite whenever pixels/layers change ──
  useEffect(() => {
    if (doc && canvasRef.current) composite(canvasRef.current, doc);
  }, [rev, doc]);

  useEffect(() => {
    if (eyedropperActive && doc) return;
    if (eyedropperLoupeRef.current) eyedropperLoupeRef.current.style.display = 'none';
    lastEyedropperColorRef.current = null;
    useEditor.getState().setEyedropperPreview(null);
    if (!doc && eyedropperActive) useEditor.getState().setEyedropperActive(false);
  }, [doc, eyedropperActive]);

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

  useImperativeHandle(ref, () => ({ fit }), [fit]);

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

  function cancelDrafts() {
    draftShapeRef.current = null;
    polyRef.current = [];
    vectorRef.current = [];
    bezierRef.current = [];
    draftModeRef.current = 'replace';
    wandPreviewRef.current = null;
    wandBaseRef.current = null;
  }

  function selectionMode(e: Pick<MouseEvent | PointerEvent | React.PointerEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>) {
    if (e.shiftKey && (e.ctrlKey || e.metaKey)) return 'intersect' as const;
    if (e.ctrlKey || e.metaKey) return 'subtract' as const;
    if (e.shiftKey) return 'add' as const;
    return useSettings.getState().toolDefaults.selectionCombineMode;
  }

  function commitSelection(next: Selection | null, mode: SelectionCombineMode) {
    const s = useEditor.getState();
    s.setSelection(combineSelections(s.selection, next, mode));
  }

  const closeDraft = useCallback((commit: boolean) => {
    const s = useEditor.getState();
    const d = s.doc;
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
      const points = vectorRef.current;
      if (commit && points.length >= 3) void s.addVectorPath(points);
      vectorRef.current = [];
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
      if (e.key === 'Escape') {
        if (useEditor.getState().eyedropperActive) {
          useEditor.getState().setEyedropperActive(false);
          if (eyedropperLoupeRef.current) eyedropperLoupeRef.current.style.display = 'none';
        } else if (floatingRef.current) {
          commitFloatingSelection(false);
        } else if (wandPreviewRef.current) {
          wandPreviewRef.current = null;
          wandBaseRef.current = null;
          drag.current.mode = null;
        } else if (polyRef.current.length || vectorRef.current.length || bezierRef.current.length || draftShapeRef.current) {
          draftShapeRef.current = null;
          polyRef.current = [];
          vectorRef.current = [];
          bezierRef.current = [];
        } else if (cropRectRef.current) {
          setCropRect(null);
        } else {
          useEditor.getState().setSelection(null);
        }
      }
      if (e.key === 'Enter') {
        if (floatingRef.current) commitFloatingSelection();
        else if (polyRef.current.length || vectorRef.current.length || bezierRef.current.length) closeDraftRef.current(true);
        else if (useEditor.getState().tool === 'crop') applyCrop();
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && polyRef.current.length) {
        e.preventDefault();
        polyRef.current = polyRef.current.slice(0, -1);
        if (!polyRef.current.length) draftModeRef.current = 'replace';
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
    if (tool !== 'crop') setCropRect(null);
    cancelDrafts();
  }, [tool]);

  function toDoc(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    const s = useEditor.getState();
    return {
      x: (clientX - rect.left - s.panX) / s.zoom,
      y: (clientY - rect.top - s.panY) / s.zoom,
    };
  }

  function checkerColor(x: number, y: number): [number, number, number] {
    if (canvasBgColor) return hexToRgb(canvasBgColor);
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

  function snapBounds(b: Bounds): Bounds {
    const s = useEditor.getState();
    if (!useSettings.getState().snappingEnabled || !s.doc) return b;
    const threshold = SNAP_SCREEN_PX / s.zoom;
    let bestDx: number | null = null;
    let bestDy: number | null = null;
    const xs = [b.x, b.x + b.w / 2, b.x + b.w];
    const ys = [b.y, b.y + b.h / 2, b.y + b.h];
    const automaticGuides = [
      { axis: 'x' as const, pos: s.doc.width / 3 },
      { axis: 'x' as const, pos: s.doc.width / 2 },
      { axis: 'x' as const, pos: s.doc.width * 2 / 3 },
      { axis: 'y' as const, pos: s.doc.height / 3 },
      { axis: 'y' as const, pos: s.doc.height / 2 },
      { axis: 'y' as const, pos: s.doc.height * 2 / 3 },
    ];
    for (const g of [...s.guides, ...automaticGuides]) {
      if (g.axis === 'x') {
        for (const x of xs) {
          const dx = g.pos - x;
          if (Math.abs(dx) <= threshold && (bestDx == null || Math.abs(dx) < Math.abs(bestDx))) bestDx = dx;
        }
      } else {
        for (const y of ys) {
          const dy = g.pos - y;
          if (Math.abs(dy) <= threshold && (bestDy == null || Math.abs(dy) < Math.abs(bestDy))) bestDy = dy;
        }
      }
    }
    return { ...b, x: b.x + (bestDx ?? 0), y: b.y + (bestDy ?? 0) };
  }

  function snapPoint(p: Pt): Pt {
    const snapped = snapBounds({ x: p.x, y: p.y, w: 0, h: 0 });
    return { x: snapped.x, y: snapped.y };
  }

  function constrainPoint(from: Pt, to: Pt): Pt {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!length) return to;
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
  }

  function beginFloatingSelection(): FloatingSelection | null {
    const s = useEditor.getState();
    const d = s.doc;
    const layer = s.activeLayer();
    const sel = s.selection;
    if (!d || !layer || !sel) return null;
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
    let wasEmpty = true;
    const dash = 5;

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      const canvas = antsRef.current;
      const cont = containerRef.current;
      if (!canvas || !cont) return;
      const s = useEditor.getState();
      const hasContent = !!s.doc && !!(
        s.selection || wandPreviewRef.current || draftShapeRef.current || polyRef.current.length || vectorRef.current.length || bezierRef.current.length
      );
      if (!hasContent) {
        if (!wasEmpty) {
          canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
          wasEmpty = true;
        }
        return;
      }
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
      const offset = (time / 80) % (dash * 2);

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
        g.lineDashOffset = (closedAnts ? -offset : 0) / z;
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
            tg.fillStyle = 'rgba(76,141,255,0.30)';
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

      const drawVertex = (pt: Pt, first: boolean) => {
        const sx = px + pt.x * z;
        const sy = py + pt.y * z;
        g.fillStyle = first ? '#4c8dff' : '#ffffff';
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.setLineDash([]);
        g.lineWidth = 1;
        g.beginPath();
        g.rect(sx - 3, sy - 3, 6, 6);
        g.fill();
        g.stroke();
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
          g.strokeStyle = '#4c8dff';
          g.lineWidth = 1.5;
          g.setLineDash([]);
          g.beginPath();
          g.arc(sx, sy, 7, 0, Math.PI * 2);
          g.stroke();
          g.restore();
        }
      }

      if (vectorRef.current.length) {
        const pts = vectorRef.current;
        const p = new Path2D();
        p.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
        if (hoverRef.current) p.lineTo(hoverRef.current.x, hoverRef.current.y);
        strokeDocPath(p, false);
        pts.forEach((pt, i) => drawVertex(pt, i === 0));
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
            g.strokeStyle = 'rgba(76,141,255,0.9)';
            g.beginPath();
            g.moveTo(h2x, h2y); g.lineTo(cx, cy); g.lineTo(h1x, h1y);
            g.stroke();
            for (const [hx, hy] of [[h1x, h1y], [h2x, h2y]]) {
              g.fillStyle = '#4c8dff';
              g.beginPath();
              g.arc(hx, hy, 2.5, 0, Math.PI * 2);
              g.fill();
            }
          }
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
    } else if (tool === 'move') {
      if (selection && selectionContains(selection, p) && s.activeLayer()) {
        const fl = beginFloatingSelection();
        if (!fl) return;
        drag.current.mode = 'selection-move';
        drag.current.startBounds = { ...fl.bounds };
        drag.current.startDocX = p.x;
        drag.current.startDocY = p.y;
        drag.current.moved = false;
      } else {
        s.snapshot('Mover capas');
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
      drag.current.mode = 'paint';
    } else if (tool === 'select-rect' || tool === 'select-ellipse') {
      drag.current.mode = 'select-shape';
      drag.current.startDocX = p.x;
      drag.current.startDocY = p.y;
      draftShapeRef.current = null;
      // Capturar el modo (add/subtract/replace) al empezar el gesto, no al
      // soltarlo — igual que poly/bezier/wand. Si no, soltar Shift/Ctrl un
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
    } else if (tool === 'vector-pen') {
      const points = vectorRef.current;
      if (points.length >= 3 && Math.hypot(p.x - points[0].x, p.y - points[0].y) * s.zoom <= 8) {
        closeDraft(true);
      } else {
        vectorRef.current = [...points, p];
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
        s.setCursor({ x: Math.floor(p.x), y: Math.floor(p.y) });
      }
      return;
    }
    if (doc) {
      const p = toDoc(e.clientX, e.clientY);
      s.setCursor({ x: Math.round(p.x), y: Math.round(p.y) });
      hoverRef.current = (tool === 'select-poly' || tool === 'select-bezier') ? snapPoint(p) : p;
    }
    if (tool === 'eraser' || tool === 'brush' || tool === 'blur' || tool === 'sharpen') {
      const rect = containerRef.current!.getBoundingClientRect();
      setBrushPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }

    const mode = drag.current.mode;
    if (!mode) return;
    const dxScreen = e.clientX - drag.current.lastX;
    const dyScreen = e.clientY - drag.current.lastY;
    const p = toDoc(e.clientX, e.clientY);

    if (mode === 'pan') {
      s.setPan(s.panX + dxScreen, s.panY + dyScreen);
    } else if (mode === 'move') {
      const layer = s.activeLayer();
      if (layer) {
        const base = transformTarget?.kind === 'layer' ? transformTarget.b : layerBounds(layer);
        const nb = snapBounds({ ...base, x: base.x + dxScreen / s.zoom, y: base.y + dyScreen / s.zoom });
        s.moveActiveBy(nb.x - base.x, nb.y - base.y);
      }
    } else if (mode === 'selection-move') {
      const fl = floatingRef.current;
      const start = drag.current.startBounds;
      if (fl && start) {
        drag.current.moved = drag.current.moved || Math.hypot(e.clientX - drag.current.lastX, e.clientY - drag.current.lastY) > 0;
        const nb = snapBounds({
          ...start,
          x: start.x + (p.x - drag.current.startDocX),
          y: start.y + (p.y - drag.current.startDocY),
        });
        setFloating({ ...fl, bounds: nb });
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
    } else if (mode === 'crop') {
      let next = normRect(drag.current.startDocX, drag.current.startDocY, p.x, p.y);
      const ratio = cropRatio(cropAspect, cropVertical);
      if (ratio) {
        const wFromH = next.h * ratio;
        if (wFromH > next.w) next.h = next.w / ratio;
        else next.w = wFromH;
        if (p.x < drag.current.startDocX) next.x = drag.current.startDocX - next.w;
        if (p.y < drag.current.startDocY) next.y = drag.current.startDocY - next.h;
      }
      setCropRect(constrainCropBounds(snapBounds(next)));
    } else if (mode === 'paint') {
      const paintMode = tool === 'eraser' ? 'erase' : tool === 'blur' ? 'blur' : tool === 'sharpen' ? 'sharpen' : 'paint';
      s.paintActiveStroke({ x: drag.current.lastDocX, y: drag.current.lastDocY }, p, paintMode);
    } else if (mode === 'select-shape') {
      const fromCenter = e.altKey;
      const sx = drag.current.startDocX;
      const sy = drag.current.startDocY;
      let r = fromCenter
        ? { x: sx - Math.abs(p.x - sx), y: sy - Math.abs(p.y - sy), w: Math.abs(p.x - sx) * 2, h: Math.abs(p.y - sy) * 2 }
        : normRect(sx, sy, p.x, p.y);
      if (e.shiftKey) {
        // Shift constrains to a square/circle, anchored at the start corner
        // or symmetrically around it when Alt is held.
        const side = Math.max(r.w, r.h);
        r = fromCenter
          ? { x: sx - side / 2, y: sy - side / 2, w: side, h: side }
          : { x: p.x >= sx ? sx : sx - side, y: p.y >= sy ? sy : sy - side, w: side, h: side };
      }
      r = snapBounds(r);
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
    if (mode === 'paint') useEditor.getState().refreshActiveThumb();
    if (mode === 'selection-move') commitFloatingSelection(drag.current.moved);
    if (mode === 'wand-tolerance') {
      const preview = wandPreviewRef.current;
      wandPreviewRef.current = null;
      wandBaseRef.current = null;
      useEditor.getState().setSelection(preview);
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
    drag.current.mode = null;
    drag.current.startBounds = null;
    drag.current.nodeIndex = -1;
    drag.current.moved = false;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!doc) return;
    const el = e.target as HTMLElement;
    if (el.closest('[data-ui], button, input, select')) return;
    if (tool === 'select-poly' || tool === 'select-bezier' || tool === 'vector-pen') {
      closeDraft(true);
      return;
    }
    if (tool === 'move') {
      const hit = hitTextLayer(toDoc(e.clientX, e.clientY));
      if (hit) onEditText(hit);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
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
    const selectish = tool === 'move' || tool.startsWith('select-') || tool === 'wand';
    if (selection && selectish && selection.bounds.w >= 1 && selection.bounds.h >= 1) {
      return { kind: 'selection', b: selection.bounds, angle: 0 };
    }
    if (tool === 'move' && doc.activeId) {
      const selected = doc.layers.filter((layer) => selectedLayerIds.includes(layer.id) && layer.visible && layer.kind !== 'group' && layer.kind !== 'adjustment');
      const layers = selected.length ? selected : doc.layers.filter((layer) => layer.id === doc.activeId && layer.visible);
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
      ? s.doc.layers.filter((layer) => s.selectedLayerIds.includes(layer.id) && layer.kind !== 'group' && layer.kind !== 'adjustment').map((layer) => ({ id: layer.id, b: layerBounds(layer) }))
      : [];
    let activeFloating = floatingRef.current;
    if (kind === 'layer') s.snapshot('Transformar capa');
    else if (!activeFloating) activeFloating = beginFloatingSelection();
    if (kind === 'selection') {
      if (!activeFloating) return;
      start = { ...activeFloating.bounds };
    }
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      const st = useEditor.getState();
      const ddx = (ev.clientX - startX) / st.zoom;
      const ddy = (ev.clientY - startY) / st.zoom;
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
      if (kind === 'layer' && st.doc?.activeId) {
        const ids = selectedStarts.length > 1 ? selectedStarts.map((item) => item.id) : [st.doc.activeId];
        ids.forEach((id) => st.bakeLayerTransform(id));
      }
      if (kind === 'selection') commitFloatingSelection();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const beginRotate = (e: React.PointerEvent) => {
    if (!transformTarget || transformTarget.kind !== 'selection') return;
    // Rotar el marquee crudo (sin herramienta Mover) no está soportado de
    // forma no-destructiva — solo el contenido ya flotante (o Mover, que lo
    // flota bajo demanda) puede rotarse.
    if (tool !== 'move' && !floatingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    let fl = floatingRef.current;
    if (!fl) fl = beginFloatingSelection();
    if (!fl) return;
    const center = { x: fl.bounds.x + fl.bounds.w / 2, y: fl.bounds.y + fl.bounds.h / 2 };
    const startPt = toDoc(e.clientX, e.clientY);
    const startPointer = Math.atan2(startPt.y - center.y, startPt.x - center.x);
    const startAngle = fl.angle;
    const onMove = (ev: PointerEvent) => {
      const cur = toDoc(ev.clientX, ev.clientY);
      const angle = startAngle + Math.atan2(cur.y - center.y, cur.x - center.x) - startPointer;
      const current = floatingRef.current;
      if (current) setFloating({ ...current, angle });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      commitFloatingSelection();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  function rotateScreenPoint(x: number, y: number, b: Bounds, angle: number): Pt {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const dx = x - cx;
    const dy = y - cy;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  const cursorStyle =
    eyedropperActive ? 'none'
    : tool === 'hand' || spaceDown ? 'grab'
    : tool === 'move' ? 'move'
    : tool === 'crop' || tool.startsWith('select-') || tool === 'wand' || tool === 'bucket' || tool === 'vector-pen' ? 'crosshair'
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
      setCropRect(constrainCropBounds(snapBounds(resized)));
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
      setCropRect(constrainCropBounds(snapBounds(next)));
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

  return (
    <div
      className={`stage ${eyedropperActive ? 'eyedropper-active' : ''}`}
      ref={containerRef}
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
      onPointerLeave={() => {
        useEditor.getState().setCursor(null);
        setBrushPos(null);
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
          className="stage-canvas-wrap"
          style={{
            left: panX,
            top: panY,
            width: doc.width,
            height: doc.height,
            transform: `scale(${zoom})`,
            ...(canvasBgColor
              ? { backgroundColor: canvasBgColor, backgroundImage: 'none' }
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
              left: cropScreen.left, top: cropScreen.top + cropScreen.height + 8,
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

        {(tool === 'eraser' || tool === 'brush' || tool === 'blur' || tool === 'sharpen') && brushPos && (
          <div style={{
            position: 'absolute',
            left: brushPos.x - (brushSize * zoom) / 2,
            top: brushPos.y - (brushSize * zoom) / 2,
            width: brushSize * zoom,
            height: brushSize * zoom,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.8)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          }} />
        )}

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
            {transformTarget.kind === 'selection' && (tool === 'move' || floating) && (() => {
              const p = rotateScreenPoint(
                transformTarget.b.x + transformTarget.b.w / 2,
                transformTarget.b.y - 28 / zoom,
                transformTarget.b,
                transformTarget.angle,
              );
              return (
                <div
                  data-ui
                  className="rotate-handle"
                  style={{ left: panX + p.x * zoom - 5, top: panY + p.y * zoom - 5 }}
                  onPointerDown={beginRotate}
                  title="Arrastrar para rotar la selección"
                />
              );
            })()}
            {HANDLES.map((h) => (
              (() => {
                const p = rotateScreenPoint(
                  transformTarget.b.x + transformTarget.b.w * h.ux,
                  transformTarget.b.y + transformTarget.b.h * h.uy,
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
      <ToolOptions cropRect={cropRect} onCropSize={setCropSize} />
    </div>
  );
});
