import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TextData, Unit } from '../types';
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
  { id: 'tool.hand', label: 'Herramienta Mano' },
  { id: 'tool.select-rect', label: 'Selección rectangular' },
  { id: 'tool.select-ellipse', label: 'Selección elíptica' },
  { id: 'tool.select-poly', label: 'Selección poligonal' },
  { id: 'tool.select-bezier', label: 'Selección bezier (pluma)' },
  { id: 'tool.wand', label: 'Varita mágica' },
  { id: 'tool.text', label: 'Texto' },
  { id: 'tool.vector-pen', label: 'Pluma vectorial' },
  { id: 'undo', label: 'Deshacer' },
  { id: 'redo', label: 'Rehacer' },
  { id: 'export', label: 'Exportar' },
  { id: 'open', label: 'Abrir / importar' },
  { id: 'fit', label: 'Ajustar a la vista' },
  { id: 'zoomIn', label: 'Acercar' },
  { id: 'zoomOut', label: 'Alejar' },
  { id: 'brushSmaller', label: 'Pincel más chico' },
  { id: 'brushBigger', label: 'Pincel más grande' },
  { id: 'copy', label: 'Copiar selección' },
  { id: 'cut', label: 'Cortar selección' },
  { id: 'deselect', label: 'Deseleccionar' },
  { id: 'toggleGuides', label: 'Ver / ocultar reglas y guías' },
  { id: 'selectAll', label: 'Seleccionar todo' },
];

export const DEFAULT_BINDINGS: Record<string, KeyCombo> = {
  'tool.move': 'v',
  'tool.crop': 'c',
  'tool.eraser': 'e',
  'tool.brush': 'b',
  'tool.blur': 'shift+b',
  'tool.sharpen': 'shift+s',
  'tool.hand': 'h',
  'tool.select-rect': 'm',
  'tool.select-ellipse': 'shift+m',
  'tool.select-poly': 'l',
  'tool.select-bezier': 'p',
  'tool.wand': 'w',
  'tool.text': 't',
  'tool.vector-pen': 'u',
  undo: 'mod+z',
  redo: 'shift+mod+z',
  export: 'mod+s',
  open: 'mod+o',
  fit: '0',
  zoomIn: '=',
  zoomOut: '-',
  brushSmaller: '[',
  brushBigger: ']',
  copy: 'mod+c',
  cut: 'mod+x',
  deselect: 'mod+d',
  toggleGuides: 'mod+;',
  selectAll: 'mod+a',
};

export interface ToolDefaults {
  brushSize: number;
  brushHardness: number;
  wandTolerance: number;
  wandContiguous: boolean;
  wandSampleSource: WandSampleSource;
  wandIncludeTransparency: boolean;
  selectionGrowPx: number;
  selectionCombineMode: SelectionCombinePreference;
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
};

export const DEFAULT_TOOL_DEFAULTS: ToolDefaults = {
  brushSize: 40,
  brushHardness: 0.6,
  wandTolerance: 32,
  wandContiguous: true,
  wandSampleSource: 'layer',
  wandIncludeTransparency: true,
  selectionGrowPx: 8,
  selectionCombineMode: 'replace',
  fgColor: '#4c8dff',
};

export const DEFAULT_NEW_DOCUMENT: NewDocumentDefaults = {
  width: 1200,
  height: 800,
  name: 'Sin título',
};

/** Serializes a KeyboardEvent to a KeyCombo (or null for bare modifiers). */
export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  const key = e.key.toLowerCase();
  if (key === 'shift' || key === 'meta' || key === 'control' || key === 'alt') return null;
  let combo = '';
  if (e.shiftKey) combo += 'shift+';
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
      if (part === ' ') return 'Espacio';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(isMac ? '' : '+');
}

interface SettingsState {
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
  recentGoogleFonts: string[];
  activePalette: string[];
  savedPalettes: SavedPalette[];

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
  setBinding: (action: string, combo: KeyCombo) => void;
  resetBindings: () => void;
  addRecentGoogleFont: (family: string) => void;
  setActivePalette: (colors: string[]) => void;
  savePalette: (palette: Omit<SavedPalette, 'id'>) => void;
  renamePalette: (id: string, name: string) => void;
  removePalette: (id: string) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
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
      recentGoogleFonts: [],
      activePalette: [],
      savedPalettes: [],

      setUnit: (unit) => set({ unit }),
      setPpi: (ppi) => set({ ppi: Math.max(1, Math.min(2400, Math.round(ppi))) }),
      toggleGuides: () => set((s) => ({ showGuides: !s.showGuides })),
      setSnappingEnabled: (snappingEnabled) => set({ snappingEnabled }),
      setCanvasBgColor: (canvasBgColor) => set({ canvasBgColor }),
      setCropAspect: (cropAspect) => set({ cropAspect }),
      setCropVertical: (cropVertical) => set({ cropVertical }),
      setCropUpscale: (cropUpscale) => set({ cropUpscale }),
      setToolDefaults: (patch) => set((s) => ({ toolDefaults: { ...s.toolDefaults, ...patch } })),
      setTextDefaults: (textDefaults) => set({ textDefaults: { ...textDefaults } }),
      setNewDocumentDefaults: (patch) =>
        set((s) => ({ newDocumentDefaults: { ...s.newDocumentDefaults, ...patch } })),
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
    }),
    {
      name: 'lienzo-settings',
      merge: (persisted, current) => {
        const p = persisted as Partial<SettingsState>;
        return {
          ...current,
          ...p,
          bindings: { ...DEFAULT_BINDINGS, ...(p.bindings ?? {}) },
          toolDefaults: { ...DEFAULT_TOOL_DEFAULTS, ...(p.toolDefaults ?? {}) },
          textDefaults: { ...DEFAULT_TEXT_SETTINGS, ...(p.textDefaults ?? {}) },
          newDocumentDefaults: { ...DEFAULT_NEW_DOCUMENT, ...(p.newDocumentDefaults ?? {}) },
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
