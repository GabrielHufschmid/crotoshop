export type RGB = [number, number, number];

export interface Recolor {
  enabled: boolean;
  color: RGB;          // 0..255
  preserveLuma: boolean;
}

export interface Adjustments {
  brightness: number;  // -1 .. 1   (0 = neutral)
  contrast: number;    // -1 .. 1   (0)
  saturation: number;  // -1 .. 1   (0)
  gamma: number;       // 0.2 .. 3  (1)
  hue: number;         // -180 .. 180 degrees (0)
  invert: number;      // 0 .. 1    (0)
  recolor: Recolor;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextData {
  text: string;
  family: string;        // CSS font-family name
  googleFont: boolean;   // true if it must be loaded from Google Fonts
  size: number;          // px
  color: string;         // hex
  align: TextAlign;
  lineHeight: number;    // multiplier (e.g. 1.2)
  letterSpacing: number; // px
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

export type VectorNodeKind = 'corner' | 'smooth' | 'symmetric';
export type VectorStrokeAlign = 'inside' | 'center' | 'outside';
export type VectorPrimitiveKind = 'rectangle' | 'ellipse' | 'triangle' | 'polygon';

/** A Bezier anchor. Handle coordinates are offsets from the anchor. */
export interface VectorNode {
  id: string;
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
  kind: VectorNodeKind;
}

export interface VectorSubpath {
  id: string;
  nodes: VectorNode[];
  closed: boolean;
}

export interface VectorGradientStop {
  offset: number;
  color: string;
}

export interface VectorGradient {
  type: 'linear' | 'radial';
  from: Pt;
  to: Pt;
  highlight?: Pt;
  stops: VectorGradientStop[];
}

export interface VectorStyle {
  fill: string | null;
  stroke: string | null;
  fillGradient?: VectorGradient;
  strokeGradient?: VectorGradient;
  strokeWidth: number;
  /** Closed paths can place their stroke inside, centered, or outside. */
  strokeAlign?: VectorStrokeAlign;
  opacity: number;
  fillRule: 'nonzero' | 'evenodd';
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  /** Alternating painted/gap lengths in local vector units. Empty means solid. */
  dashArray?: number[];
  dashOffset?: number;
}

export interface VectorShape {
  id: string;
  name?: string;
  subpaths: VectorSubpath[];
  style: VectorStyle;
  /** Retained while a generated primitive remains parametrically editable. */
  primitive?: {
    kind: VectorPrimitiveKind;
    bounds: { x: number; y: number; w: number; h: number };
    sides: number;
    cornerRadius: number;
  };
}

export interface VectorData {
  /** Placed sources are preserved verbatim; editable vectors expose shapes. */
  kind: 'placed' | 'editable';
  baseWidth: number;
  baseHeight: number;
  sourceType?: 'svg' | 'eps' | 'pdf';
  svgText?: string;
  shapes?: VectorShape[];
  rasterize: (scale: number) => Promise<HTMLCanvasElement>;
}

export type VectorNodeMode = 'select' | 'add' | 'delete' | 'convert';
export type PathfinderOperation = 'unite' | 'subtract' | 'intersect' | 'exclude';

export interface VectorizeOptions {
  mode: 'color' | 'silhouette';
  colors: number;
  threshold: number;
  detail: number;
  smoothing: number;
  ignoreWhite: boolean;
  preserveOriginal: boolean;
}

/** Canvas blend operations intentionally limited to the portable 2D set. */
export type BlendMode =
  | 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export interface LayerMask {
  /** Local, greyscale alpha mask. White reveals and black conceals. */
  canvas: HTMLCanvasElement;
  enabled: boolean;
  /** 0 keeps the layer fully revealed; 1 applies the mask at full strength. */
  density?: number;
  /** Non-destructive edge softness in source pixels. */
  feather?: number;
}

export interface Artboard {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;     // 0 .. 1
  x: number;           // offset in document space
  y: number;
  /** Display size override during a live transform; baked on release. */
  w?: number;
  h?: number;
  rotation?: number;       // radians, center-origin display transform
  flipX?: boolean;         // non-destructive horizontal mirror around layer center
  flipY?: boolean;         // non-destructive vertical mirror around layer center
  /** Source-of-truth raster/cache for this layer. Mutated by destructive ops. */
  canvas: HTMLCanvasElement;
  adjustments: Adjustments;
  /** Present on text layers: canvas is a render of this data. */
  text?: TextData;
  /** Present on placed vector layers. Canvas is a preview/cache. */
  vector?: VectorData;
  /** Folder layers are non-rendering containers for children with parentId. */
  kind?: 'raster' | 'group' | 'adjustment';
  parentId?: string;
  blendMode?: BlendMode;
  /** Resampling used while the layer is displayed at a non-native size. */
  interpolation?: 'smooth' | 'nearest';
  /** An adjustment layer filters the already-composited layers beneath it. */
  adjustmentLayer?: Adjustments;
  mask?: LayerMask;
  locked?: boolean;
  lockPixels?: boolean;
  colorTag?: string;
  /** dataURL thumbnail, regenerated after pixel changes. */
  thumb: string;
}

export interface Doc {
  width: number;
  height: number;
  /** Bottom layer first (index 0), top layer last. */
  layers: Layer[];
  activeId: string | null;
  artboards?: Artboard[];
  savedSelections?: SelectionChannel[];
}

export interface Pt { x: number; y: number; }

export type SelectionShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'poly'; points: Pt[] };

export interface Selection {
  /** Doc-sized canvas; alpha > 0 marks selected pixels. */
  mask: HTMLCanvasElement;
  bounds: { x: number; y: number; w: number; h: number };
  /** Parametric shape when available (rect/ellipse/poly); null for wand masks. */
  shape: SelectionShape | null;
}

export interface SelectionChannel {
  id: string;
  name: string;
  /** Document-sized alpha mask. */
  mask: HTMLCanvasElement;
  bounds: { x: number; y: number; w: number; h: number };
}

export interface Guide {
  id: string;
  axis: 'x' | 'y';  // 'x' = vertical line at doc x; 'y' = horizontal at doc y
  pos: number;      // doc-space px
}

export type Tool =
  | 'move' | 'crop' | 'eraser' | 'hand' | 'zoom'
  | 'select-rect' | 'select-ellipse' | 'select-poly' | 'select-bezier'
  | 'wand' | 'ai-mask' | 'text' | 'bucket' | 'brush' | 'blur' | 'sharpen' | 'pixel-stretch' | 'warp-mesh' | 'vector-shape' | 'vector-pen' | 'vector-node';

export type Unit = 'px' | 'cm';

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 1,
  hue: 0,
  invert: 0,
  recolor: { enabled: false, color: [255, 255, 255], preserveLuma: false },
};

export function isNeutral(a: Adjustments): boolean {
  return (
    !a.recolor.enabled &&
    a.brightness === 0 &&
    a.contrast === 0 &&
    a.saturation === 0 &&
    a.gamma === 1 &&
    a.hue === 0 &&
    a.invert === 0
  );
}
