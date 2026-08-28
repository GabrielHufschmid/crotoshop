import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import type { TextData, Unit, VectorNodeMode, VectorPrimitiveKind, VectorStrokeAlign, VectorizeOptions } from '../types';
import type { PaletteHarmony } from '../engine/palette';

/**
 * Serialized key combo: lowercase key with optional "shift+" / "mod+"
 * prefixes (mod = ⌘ on macOS, Ctrl elsewhere). E.g. "v", "mod+z", "shift+mod+z".
 */
export type KeyCombo = string;

export const CROP_ASPECTS = ['free', '1:1', '4:5', '4:3', '16:9'] as const;
export type CropAspect = (typeof CROP_ASPECTS)[number];
export type CropUpscale = 1 | 2 | 4;
export type SelectionCombinePreference = 'replace' | 'add' | 'subtract' | 'intersect';
export type WandSampleSource = 'layer' | 'visible';
export type PixelStretchPattern = 'stretch' | 'repeat' | 'mirror';
export type PixelStretchSource = 'layer' | 'visible';
export type PixelStretchCurveMode = 'auto' | 'bezier';
export const CANVAS_BACKGROUND_MOTION_DIAGONAL = 'motion-diagonal';
export const CANVAS_BACKGROUND_MOTION_CHECKER = 'motion-checker';

/** Width/height ratio of a crop preset; null = free. `vertical` swaps sides. */
export function cropRatio(aspect: CropAspect, vertical: boolean): number | null {
  if (aspect === 'free') return null;
  const [a, b] = aspect.split(':').map(Number);
  return vertical ? b / a : a / b;
}

/** Button label of a preset ("16:9" → "9:16" in vertical mode). */
export function cropAspectLabel(aspect: CropAspect, vertical: boolean): string {
  if (aspect === 'free') return 'Libre';
  if (!vertical) return aspect;
  const [a, b] = aspect.split(':');
  return `${b}:${a}`;
}

export interface ActionDef {
  id: string;
  label: string;
  fixed?: boolean; // shown but not rebindable
}

export const ACTIONS: ActionDef[] = [
  { id: 'tool.move', label: 'Herramienta Mover' },
  { id: 'tool.crop', label: 'Herramienta Recortar' },
  { id: 'tool.eraser', label: 'Herramienta Borrador' },
  { id: 'tool.brush', label: 'Herramienta Pincel' },
  { id: 'tool.blur', label: 'Herramienta Desenfocar' },
  { id: 'tool.sharpen', label: 'Herramienta Enfocar' },
  { id: 'tool.pixel-stretch', label: 'Pixel Stretch' },
  { id: 'tool.warp-mesh', label: 'Warp Mesh' },
  { id: 'tool.hand', label: 'Herramienta Mano' },
  { id: 'tool.zoom', label: 'Herramienta Zoom' },
  { id: 'tool.select-rect', label: 'Selección rectangular' },
  { id: 'tool.select-ellipse', label: 'Selección elíptica' },
  { id: 'tool.select-poly', label: 'Selección poligonal' },
  { id: 'tool.select-bezier', label: 'Selección bezier (pluma)' },
  { id: 'tool.wand', label: 'Varita mágica' },
  { id: 'tool.ai-mask', label: 'Máscara IA' },
  { id: 'tool.text', label: 'Texto' },
  { id: 'tool.vector-shape', label: 'Formas vectoriales' },
  { id: 'tool.vector-pen', label: 'Pluma vectorial' },
  { id: 'tool.vector-node', label: 'Selección directa de nodos' },
  { id: 'undo', label: 'Deshacer' },
  { id: 'redo', label: 'Rehacer' },
  { id: 'new', label: 'Nuevo documento' },
  { id: 'save', label: 'Guardar' },
  { id: 'saveAs', label: 'Guardar como' },
  { id: 'export', label: 'Exportar' },
  { id: 'open', label: 'Abrir / importar' },
  { id: 'fit', label: 'Ajustar a la vista' },
  { id: 'actualPixels', label: 'Píxeles reales (100%)' },
  { id: 'zoomIn', label: 'Acercar' },
  { id: 'zoomOut', label: 'Alejar' },
  { id: 'brushSmaller', label: 'Pincel más chico' },
  { id: 'brushBigger', label: 'Pincel más grande' },
  { id: 'copy', label: 'Copiar selección' },
  { id: 'cut', label: 'Cortar selección' },
  { id: 'pasteInPlace', label: 'Pegar en el lugar' },
  { id: 'deselect', label: 'Deseleccionar' },
  { id: 'toggleGuides', label: 'Ver / ocultar reglas y guías' },
  { id: 'selectAll', label: 'Seleccionar todo' },
  { id: 'inverseSelection', label: 'Invertir selección' },
  { id: 'freeTransform', label: 'Transformación libre' },
  { id: 'newLayer', label: 'Nueva capa' },
  { id: 'duplicateLayer', label: 'Duplicar capa' },
  { id: 'mergeDown', label: 'Combinar hacia abajo' },
  { id: 'mergeVisible', label: 'Combinar visibles' },
  { id: 'selectLayerBelow', label: 'Seleccionar capa inferior' },
  { id: 'selectLayerAbove', label: 'Seleccionar capa superior' },
  { id: 'moveLayerDown', label: 'Bajar capa' },
  { id: 'moveLayerUp', label: 'Subir capa' },
  { id: 'togglePanels', label: 'Mostrar / ocultar paneles' },
  { id: 'toggleColorPanel', label: 'Mostrar / ocultar color' },
  { id: 'toggleLayersPanel', label: 'Mostrar / ocultar capas' },
  { id: 'eyedropper', label: 'Cuentagotas' },
];

const LEGACY_DEFAULT_BINDINGS: Record<string, KeyCombo> = {
  'tool.move': 'v', 'tool.crop': 'c', 'tool.eraser': 'e', 'tool.brush': 'b',
  'tool.blur': 'shift+b', 'tool.sharpen': 'shift+s', 'tool.hand': 'h',
  'tool.select-rect': 'm', 'tool.select-ellipse': 'shift+m', 'tool.select-poly': 'l',
  'tool.select-bezier': 'p', 'tool.wand': 'w', 'tool.text': 't', 'tool.vector-pen': 'u',
  'tool.vector-node': 'a',
  undo: 'mod+z', redo: 'shift+mod+z', export: 'shift+alt+mod+w', open: 'mod+o',
  fit: '0', zoomIn: '=', zoomOut: '-', brushSmaller: '[', brushBigger: ']',
  copy: 'mod+c', cut: 'mod+x', pasteInPlace: 'shift+mod+v', deselect: 'mod+d',
  toggleGuides: 'mod+;', selectAll: 'mod+a',
};

const SHORTCUT_PRESET_VERSION = 2;

export const DEFAULT_BINDINGS: Record<string, KeyCombo> = {
  'tool.move': 'v',
  'tool.crop': 'c',
  'tool.eraser': 'e',
  'tool.brush': 'b',
  'tool.hand': 'h',
  'tool.zoom': 'z',
  'tool.select-rect': 'm',
  'tool.select-ellipse': 'shift+m',
  'tool.select-poly': 'l',
  'tool.select-bezier': 'shift+l',
  'tool.wand': 'w',
  'tool.ai-mask': 'shift+w',
  'tool.text': 't',
  'tool.vector-shape': 'u',
  'tool.vector-pen': 'p',
  'tool.vector-node': 'a',
  undo: 'mod+z',
  redo: 'shift+mod+z',
  new: 'mod+n',
  save: 'mod+s',
  saveAs: 'shift+mod+s',
  export: 'shift+alt+mod+w',
  open: 'mod+o',
  fit: 'mod+0',
  actualPixels: 'mod+1',
  zoomIn: 'mod+=',
  zoomOut: 'mod+-',
  brushSmaller: '[',
  brushBigger: ']',
  copy: 'mod+c',
  cut: 'mod+x',
  pasteInPlace: 'shift+mod+v',
  deselect: 'mod+d',
  toggleGuides: 'mod+;',
  selectAll: 'mod+a',
  inverseSelection: 'shift+mod+i',
  freeTransform: 'mod+t',
  newLayer: 'shift+mod+n',
  duplicateLayer: 'mod+j',
  mergeDown: 'mod+e',
  mergeVisible: 'shift+mod+e',
  selectLayerBelow: 'alt+[',
  selectLayerAbove: 'alt+]',
  moveLayerDown: 'mod+[',
  moveLayerUp: 'mod+]',
  togglePanels: 'tab',
  toggleColorPanel: 'f6',
  toggleLayersPanel: 'f7',
  eyedropper: 'i',
};

export interface ToolDefaults {
  brushSize: number;
  brushHardness: number;
  wandTolerance: number;
  wandContiguous: boolean;
  wandSampleSource: WandSampleSource;
  wandIncludeTransparency: boolean;
  aiMaskConfidence: number;
  pixelStretchSampleWidth: number;
  pixelStretchOutputWidth: number;
  pixelStretchOpacity: number;
  pixelStretchFadeStart: number;
  pixelStretchFadeEnd: number;
  pixelStretchTwist: number;
  pixelStretchPattern: PixelStretchPattern;
  pixelStretchSource: PixelStretchSource;
  pixelStretchReverse: boolean;
  pixelStretchSmoothing: boolean;
  pixelStretchCurveMode: PixelStretchCurveMode;
  pixelStretchCurveSmoothness: number;
  pixelStretchTaperStart: number;
  pixelStretchTaperEnd: number;
  pixelStretchEdgeFeather: number;
  warpMeshColumns: number;
  warpMeshRows: number;
  warpMeshSmoothing: boolean;
  warpMeshFluidity: number;
  warpMeshInfluence: number;
  selectionGrowPx: number;
  selectionCombineMode: SelectionCombinePreference;
  vectorNodeMode: VectorNodeMode;
  vectorFillEnabled: boolean;
  vectorFill: string;
  vectorStrokeEnabled: boolean;
  vectorStroke: string;
  vectorStrokeWidth: number;
  vectorStrokeAlign: VectorStrokeAlign;
  vectorShapeKind: VectorPrimitiveKind;
  vectorPolygonSides: number;
  vectorCornerRadius: number;
  vectorSimplifyTolerance: number;
  pathfinderPreserveOriginals: boolean;
  fgColor: string;
}

export interface NewDocumentDefaults {
  width: number;
  height: number;
  name: string;
}

export interface SavedPalette {
  id: string;
  name: string;
  colors: string[];
  harmony?: PaletteHarmony;
  /** Fuente de verdad para regenerar `colors`; ausente en paletas guardadas
   *  antes de que este campo existiera. */
  primary?: string;
}

const pendingStorageWrites = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>();

function flushSettingsStorage(): void {
  if (typeof localStorage === 'undefined') return;
  for (const [name, pending] of pendingStorageWrites) {
    clearTimeout(pending.timer);
    localStorage.setItem(name, pending.value);
  }
  pendingStorageWrites.clear();
}

const deferredSettingsStorage: StateStorage = {
  getItem: (name) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(name)),
  setItem: (name, value) => {
    const previous = pendingStorageWrites.get(name);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      pendingStorageWrites.delete(name);
      if (typeof localStorage !== 'undefined') localStorage.setItem(name, value);
    }, 180);
    pendingStorageWrites.set(name, { value, timer });
  },
  removeItem: (name) => {
    const pending = pendingStorageWrites.get(name);
    if (pending) clearTimeout(pending.timer);
    pendingStorageWrites.delete(name);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(name);
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSettingsStorage);
}

export const DEFAULT_TEXT_SETTINGS: TextData = {
  text: 'Texto',
  family: 'Arial',
  googleFont: false,
  size: 64,
  color: '#ffffff',
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
};

export const DEFAULT_TOOL_DEFAULTS: ToolDefaults = {
  brushSize: 40,
  brushHardness: 0.6,
  wandTolerance: 32,
  wandContiguous: true,
  wandSampleSource: 'layer',
  wandIncludeTransparency: true,
  aiMaskConfidence: 35,
  pixelStretchSampleWidth: 96,
  pixelStretchOutputWidth: 96,
  pixelStretchOpacity: 1,
  pixelStretchFadeStart: 0,
  pixelStretchFadeEnd: 0,
  pixelStretchTwist: 0,
  pixelStretchPattern: 'stretch',
  pixelStretchSource: 'layer',
  pixelStretchReverse: false,
  pixelStretchSmoothing: true,
  pixelStretchCurveMode: 'auto',
  pixelStretchCurveSmoothness: 0.82,
  pixelStretchTaperStart: 1,
  pixelStretchTaperEnd: 1,
  pixelStretchEdgeFeather: 3,
  warpMeshColumns: 4,
  warpMeshRows: 4,
  warpMeshSmoothing: true,
  warpMeshFluidity: 0.85,
  warpMeshInfluence: 0.8,
  selectionGrowPx: 8,
  selectionCombineMode: 'replace',
  vectorNodeMode: 'select',
  vectorFillEnabled: true,
  vectorFill: '#4c8dff',
  vectorStrokeEnabled: false,
  vectorStroke: '#ffffff',
  vectorStrokeWidth: 2,
  vectorStrokeAlign: 'center',
  vectorShapeKind: 'rectangle',
  vectorPolygonSides: 6,
  vectorCornerRadius: 0,
  vectorSimplifyTolerance: 1,
  pathfinderPreserveOriginals: false,
  fgColor: '#4c8dff',
};

export const DEFAULT_NEW_DOCUMENT: NewDocumentDefaults = {
  width: 1200,
  height: 800,
  name: 'Sin título',
};

export const DEFAULT_VECTORIZE_OPTIONS: VectorizeOptions = {
  mode: 'color',
  colors: 8,
  threshold: 128,
  detail: 72,
  smoothing: 35,
  ignoreWhite: true,
  preserveOriginal: true,
};

/** Serializes a KeyboardEvent to a KeyCombo (or null for bare modifiers). */
export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  const rawKey = e.key.toLowerCase();
  const key = rawKey === '+' ? '=' : rawKey;
  if (key === 'shift' || key === 'meta' || key === 'control' || key === 'alt') return null;
  let combo = '';
  if (e.shiftKey && rawKey !== '+') combo += 'shift+';
  if (e.altKey) combo += 'alt+';
  if (e.metaKey || e.ctrlKey) combo += 'mod+';
  return combo + key;
}

/** Human-readable version of a combo, for tooltips and the settings UI. */
export function comboLabel(combo: KeyCombo): string {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  return combo
    .split('+')
    .map((part) => {
      if (part === 'mod') return isMac ? '⌘' : 'Ctrl';
      if (part === 'shift') return '⇧';
      if (part === 'alt') return isMac ? '⌥' : 'Alt';
      if (part === ' ') return 'Espacio';
      if (part === '=') return '+';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(isMac ? '' : '+');
}

interface SettingsState {
  shortcutPresetVersion: number;
  unit: Unit;
  ppi: number;
  showGuides: boolean;
  snappingEnabled: boolean;
  canvasBgColor: string | null;
  cropAspect: CropAspect;
  cropVertical: boolean;
  cropUpscale: CropUpscale;
  bindings: Record<string, KeyCombo>;
  toolDefaults: ToolDefaults;
  textDefaults: TextData;
  newDocumentDefaults: NewDocumentDefaults;
  vectorizeDefaults: VectorizeOptions;
  recentGoogleFonts: string[];
  activePalette: string[];
  savedPalettes: SavedPalette[];
  showPerformanceStats: boolean;

  setUnit: (u: Unit) => void;
  setPpi: (ppi: number) => void;
  toggleGuides: () => void;
  setSnappingEnabled: (enabled: boolean) => void;
  setCanvasBgColor: (color: string | null) => void;
  setCropAspect: (aspect: CropAspect) => void;
  setCropVertical: (vertical: boolean) => void;
  setCropUpscale: (upscale: CropUpscale) => void;
  setToolDefaults: (patch: Partial<ToolDefaults>) => void;
  setTextDefaults: (patch: TextData) => void;
  setNewDocumentDefaults: (patch: Partial<NewDocumentDefaults>) => void;
  setVectorizeDefaults: (patch: Partial<VectorizeOptions>) => void;
  setBinding: (action: string, combo: KeyCombo) => void;
  resetBindings: () => void;
  addRecentGoogleFont: (family: string) => void;
  setActivePalette: (colors: string[]) => void;
  savePalette: (palette: Omit<SavedPalette, 'id'>) => void;
  renamePalette: (id: string, name: string) => void;
  removePalette: (id: string) => void;
  setShowPerformanceStats: (show: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      shortcutPresetVersion: SHORTCUT_PRESET_VERSION,
      unit: 'px',
      ppi: 96,
      showGuides: true,
      snappingEnabled: true,
      canvasBgColor: null,
      cropAspect: 'free',
      cropVertical: false,
      cropUpscale: 1,
      bindings: { ...DEFAULT_BINDINGS },
      toolDefaults: { ...DEFAULT_TOOL_DEFAULTS },
      textDefaults: { ...DEFAULT_TEXT_SETTINGS },
      newDocumentDefaults: { ...DEFAULT_NEW_DOCUMENT },
      vectorizeDefaults: { ...DEFAULT_VECTORIZE_OPTIONS },
      recentGoogleFonts: [],
      activePalette: [],
      savedPalettes: [],
      showPerformanceStats: false,

      setUnit: (unit) => set({ unit }),
      setPpi: (ppi) => set({ ppi: Math.max(1, Math.min(2400, Math.round(ppi))) }),
      toggleGuides: () => set((s) => ({ showGuides: !s.showGuides })),
      setSnappingEnabled: (snappingEnabled) => set({ snappingEnabled }),
      setCanvasBgColor: (canvasBgColor) => set({ canvasBgColor }),
      setCropAspect: (cropAspect) => set({ cropAspect }),
      setCropVertical: (cropVertical) => set({ cropVertical }),
      setCropUpscale: (cropUpscale) => set({ cropUpscale }),
      setToolDefaults: (patch) => set((s) => Object.entries(patch).every(([key, value]) => s.toolDefaults[key as keyof ToolDefaults] === value)
        ? s
        : { toolDefaults: { ...s.toolDefaults, ...patch } }),
      setTextDefaults: (textDefaults) => set({ textDefaults: { ...textDefaults } }),
      setNewDocumentDefaults: (patch) =>
        set((s) => ({ newDocumentDefaults: { ...s.newDocumentDefaults, ...patch } })),
      setVectorizeDefaults: (patch) =>
        set((s) => ({ vectorizeDefaults: { ...s.vectorizeDefaults, ...patch } })),
      setBinding: (action, combo) =>
        set((s) => {
          const bindings = { ...s.bindings };
          // Un caso por combo: si otra acción ya lo usaba, se lo quitamos.
          for (const [a, c] of Object.entries(bindings)) {
            if (c === combo && a !== action) delete bindings[a];
          }
          bindings[action] = combo;
          return { bindings };
        }),
      resetBindings: () => set({ bindings: { ...DEFAULT_BINDINGS } }),
      addRecentGoogleFont: (family) =>
        set((s) => ({
          recentGoogleFonts: [family, ...s.recentGoogleFonts.filter((f) => f !== family)].slice(0, 12),
        })),
      setActivePalette: (activePalette) => set({ activePalette: activePalette.slice(0, 5) }),
      savePalette: (palette) => set((s) => ({
        savedPalettes: [{ ...palette, id: `palette-${Date.now().toString(36)}`, colors: palette.colors.slice(0, 5) }, ...s.savedPalettes].slice(0, 40),
      })),
      renamePalette: (id, name) => set((s) => ({
        savedPalettes: s.savedPalettes.map((p) => (p.id === id ? { ...p, name } : p)),
      })),
      removePalette: (id) => set((s) => ({ savedPalettes: s.savedPalettes.filter((palette) => palette.id !== id) })),
      setShowPerformanceStats: (showPerformanceStats) => set({ showPerformanceStats }),
    }),
    {
      name: 'lienzo-settings',
      storage: createJSONStorage(() => deferredSettingsStorage),
      merge: (persisted, current) => {
        const p = persisted as Partial<SettingsState>;
        const savedBindings = { ...(p.bindings ?? {}) };
        if ((p.shortcutPresetVersion ?? 1) < SHORTCUT_PRESET_VERSION) {
          for (const [action, oldCombo] of Object.entries(LEGACY_DEFAULT_BINDINGS)) {
            if (savedBindings[action] === oldCombo) delete savedBindings[action];
          }
        }
        return {
          ...current,
          ...p,
          shortcutPresetVersion: SHORTCUT_PRESET_VERSION,
          bindings: { ...DEFAULT_BINDINGS, ...savedBindings },
          toolDefaults: { ...DEFAULT_TOOL_DEFAULTS, ...(p.toolDefaults ?? {}) },
          textDefaults: { ...DEFAULT_TEXT_SETTINGS, ...(p.textDefaults ?? {}) },
          newDocumentDefaults: { ...DEFAULT_NEW_DOCUMENT, ...(p.newDocumentDefaults ?? {}) },
          vectorizeDefaults: { ...DEFAULT_VECTORIZE_OPTIONS, ...(p.vectorizeDefaults ?? {}) },
        };
      },
    },
  ),
);

/** Finds the action bound to a combo, if any. */
export function actionForCombo(
  bindings: Record<string, KeyCombo>,
  combo: KeyCombo,
): string | null {
  for (const [action, c] of Object.entries(bindings)) {
    if (c === combo) return action;
  }
  return null;
}
