import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store/editorStore';
import { CROP_ASPECTS, cropAspectLabel, useSettings } from '../store/settingsStore';
import { pxToUnit, unitToPx } from '../engine/units';
import type { PathfinderOperation, Unit, VectorNodeMode, VectorPrimitiveKind, VectorStrokeAlign } from '../types';
import { Icon } from './Icons';
import { NumericControl } from './NumericControl';

const SELECTION_MODES = [
  { id: 'replace', icon: 'select-replace', label: 'Reemplazar selección' },
  { id: 'add', icon: 'select-add', label: 'Sumar a la selección (Shift)' },
  { id: 'subtract', icon: 'select-subtract', label: 'Restar de la selección (Alt / Opción)' },
  { id: 'intersect', icon: 'select-intersect', label: 'Intersectar selección (Shift + Alt / Opción)' },
] as const;

interface CropRectLike { x: number; y: number; w: number; h: number }

interface Props {
  cropRect?: CropRectLike | null;
  onCropSize?: (wPx: number, hPx: number) => void;
  pixelStretchReady?: boolean;
  onApplyPixelStretch?: () => void;
  onCancelPixelStretch?: () => void;
  pixelStretchEditMode?: 'path' | 'sample';
  onPixelStretchEditMode?: (mode: 'path' | 'sample') => void;
  onResetPixelStretchSample?: () => void;
  warpMeshReady?: boolean;
  onApplyWarpMesh?: () => void;
  onCancelWarpMesh?: () => void;
  onResetWarpMesh?: () => void;
}

/** One crop dimension field, using the same scrub interaction as every tool. */
function CropDimField({ label, px, unit, ppi, onCommit }: {
  label: string; px: number | null; unit: Unit; ppi: number;
  onCommit: (px: number) => void;
}) {
  if (px == null) return null;
  return (
    <NumericControl
      className="compact crop-dim"
      label={label}
      value={pxToUnit(px, unit, ppi)}
      min={unit === 'px' ? 1 : 0.01}
      max={unit === 'px' ? 32768 : pxToUnit(32768, unit, ppi)}
      step={unit === 'px' ? 1 : 0.01}
      decimals={unit === 'px' ? 0 : 2}
      suffix={unit}
      onChange={(value) => onCommit(unitToPx(value, unit, ppi))}
    />
  );
}

/** Floating contextual options for the active tool, at the top of the stage. */
export function ToolOptions({
  cropRect,
  onCropSize,
  pixelStretchReady = false,
  onApplyPixelStretch,
  onCancelPixelStretch,
  pixelStretchEditMode = 'path',
  onPixelStretchEditMode,
  onResetPixelStretchSample,
  warpMeshReady = false,
  onApplyWarpMesh,
  onCancelWarpMesh,
  onResetWarpMesh,
}: Props = {}) {
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [stretchAdvanced, setStretchAdvanced] = useState(false);
  const [stretchAdvancedPos, setStretchAdvancedPos] = useState({ left: 0, top: 0 });
  const [modifiers, setModifiers] = useState({ shift: false, alt: false });
  const stretchAdvancedButtonRef = useRef<HTMLButtonElement>(null);
  const tool = useEditor((s) => s.tool);
  const doc = useEditor((s) => !!s.doc);
  const brushSize = useEditor((s) => s.brushSize);
  const brushHardness = useEditor((s) => s.brushHardness);
  const wandTolerance = useEditor((s) => s.wandTolerance);
  const wandContiguous = useEditor((s) => s.wandContiguous);
  const hasSelection = useEditor((s) => !!s.selection);
  const selectionBounds = useEditor((s) => s.selection?.bounds ?? null);
  const maskTargetId = useEditor((s) => s.maskTargetId);
  const maskTargetName = useEditor((s) => s.doc?.layers.find((layer) => layer.id === s.maskTargetId)?.name ?? null);
  const activeLayer = useEditor((s) => s.doc?.layers.find((layer) => layer.id === s.doc?.activeId) ?? null);
  const selectedEditableVectors = useEditor((s) => s.doc?.layers.filter((layer) => s.selectedLayerIds.includes(layer.id) && layer.vector?.kind === 'editable').length ?? 0);
  const setBrush = useEditor((s) => s.setBrush);
  const setWand = useEditor((s) => s.setWand);
  const adjustSelectionBy = useEditor((s) => s.adjustSelectionBy);
  const smoothSelectionBy = useEditor((s) => s.smoothSelectionBy);
  const featherSelectionBy = useEditor((s) => s.featherSelectionBy);
  const deleteSelectionPixels = useEditor((s) => s.deleteSelectionPixels);
  const snapshot = useEditor((s) => s.snapshot);
  const setTool = useEditor((s) => s.setTool);
  const setVectorStyle = useEditor((s) => s.setVectorStyle);
  const updateVectorPrimitive = useEditor((s) => s.updateVectorPrimitive);
  const applyPathfinder = useEditor((s) => s.applyPathfinder);
  const makeCompoundPath = useEditor((s) => s.makeCompoundPath);
  const selectionPx = useSettings((s) => s.toolDefaults.selectionGrowPx);
  const selectionCombineMode = useSettings((s) => s.toolDefaults.selectionCombineMode);
  const wandSampleSource = useSettings((s) => s.toolDefaults.wandSampleSource);
  const wandIncludeTransparency = useSettings((s) => s.toolDefaults.wandIncludeTransparency);
  const aiMaskConfidence = useSettings((s) => s.toolDefaults.aiMaskConfidence);
  const pixelStretchSampleWidth = useSettings((s) => s.toolDefaults.pixelStretchSampleWidth);
  const pixelStretchOutputWidth = useSettings((s) => s.toolDefaults.pixelStretchOutputWidth);
  const pixelStretchOpacity = useSettings((s) => s.toolDefaults.pixelStretchOpacity);
  const pixelStretchFadeStart = useSettings((s) => s.toolDefaults.pixelStretchFadeStart);
  const pixelStretchFadeEnd = useSettings((s) => s.toolDefaults.pixelStretchFadeEnd);
  const pixelStretchTwist = useSettings((s) => s.toolDefaults.pixelStretchTwist);
  const pixelStretchPattern = useSettings((s) => s.toolDefaults.pixelStretchPattern);
  const pixelStretchSource = useSettings((s) => s.toolDefaults.pixelStretchSource);
  const pixelStretchReverse = useSettings((s) => s.toolDefaults.pixelStretchReverse);
  const pixelStretchSmoothing = useSettings((s) => s.toolDefaults.pixelStretchSmoothing);
  const pixelStretchCurveMode = useSettings((s) => s.toolDefaults.pixelStretchCurveMode);
  const pixelStretchCurveSmoothness = useSettings((s) => s.toolDefaults.pixelStretchCurveSmoothness);
  const pixelStretchTaperStart = useSettings((s) => s.toolDefaults.pixelStretchTaperStart);
  const pixelStretchTaperEnd = useSettings((s) => s.toolDefaults.pixelStretchTaperEnd);
  const pixelStretchEdgeFeather = useSettings((s) => s.toolDefaults.pixelStretchEdgeFeather);
  const warpMeshColumns = useSettings((s) => s.toolDefaults.warpMeshColumns);
  const warpMeshRows = useSettings((s) => s.toolDefaults.warpMeshRows);
  const warpMeshSmoothing = useSettings((s) => s.toolDefaults.warpMeshSmoothing);
  const warpMeshFluidity = useSettings((s) => s.toolDefaults.warpMeshFluidity);
  const warpMeshInfluence = useSettings((s) => s.toolDefaults.warpMeshInfluence);
  const vectorNodeMode = useSettings((s) => s.toolDefaults.vectorNodeMode);
  const vectorFillEnabled = useSettings((s) => s.toolDefaults.vectorFillEnabled);
  const vectorFill = useSettings((s) => s.toolDefaults.vectorFill);
  const vectorStrokeEnabled = useSettings((s) => s.toolDefaults.vectorStrokeEnabled);
  const vectorStroke = useSettings((s) => s.toolDefaults.vectorStroke);
  const vectorStrokeWidth = useSettings((s) => s.toolDefaults.vectorStrokeWidth);
  const vectorStrokeAlign = useSettings((s) => s.toolDefaults.vectorStrokeAlign);
  const vectorShapeKind = useSettings((s) => s.toolDefaults.vectorShapeKind);
  const vectorPolygonSides = useSettings((s) => s.toolDefaults.vectorPolygonSides);
  const vectorCornerRadius = useSettings((s) => s.toolDefaults.vectorCornerRadius);
  const pathfinderPreserveOriginals = useSettings((s) => s.toolDefaults.pathfinderPreserveOriginals);
  const setToolDefaults = useSettings((s) => s.setToolDefaults);
  const cropAspect = useSettings((s) => s.cropAspect);
  const setCropAspect = useSettings((s) => s.setCropAspect);
  const cropVertical = useSettings((s) => s.cropVertical);
  const setCropVertical = useSettings((s) => s.setCropVertical);
  const unit = useSettings((s) => s.unit);
  const ppi = useSettings((s) => s.ppi);
  const isSelectionTool = tool.startsWith('select-') || tool === 'wand' || tool === 'ai-mask';

  useEffect(() => {
    setPortalHost(document.getElementById('tool-options-slot'));
  }, []);
  useEffect(() => {
    if (tool !== 'pixel-stretch') setStretchAdvanced(false);
  }, [tool]);
  useEffect(() => {
    const sync = (event: KeyboardEvent) => setModifiers({ shift: event.shiftKey, alt: event.altKey });
    const clear = () => setModifiers({ shift: false, alt: false });
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  if (!doc) return null;

  const effectiveSelectionMode = modifiers.shift && modifiers.alt
    ? 'intersect'
    : modifiers.shift
      ? 'add'
      : modifiers.alt
        ? 'subtract'
        : selectionCombineMode;

  let content: React.ReactNode = null;
  if (tool === 'eraser' || tool === 'brush' || tool === 'blur' || tool === 'sharpen') {
    content = (
      <>
        <NumericControl className="compact" label="Tamaño" value={brushSize} min={2} max={600} step={1}
          suffix="px" onChange={(value) => setBrush(Math.round(value))} />
        <input type="range" min={2} max={600} value={brushSize}
          aria-label="Tamaño de pincel"
          onChange={(e) => setBrush(parseInt(e.target.value))} />
        <NumericControl className="compact" label="Dureza" value={Math.round(brushHardness * 100)} min={0} max={100} step={1}
          suffix="%" onChange={(value) => setBrush(undefined, value / 100)} />
        <input type="range" min={0} max={1} step={0.05} value={brushHardness}
          aria-label="Dureza del pincel"
          onChange={(e) => setBrush(undefined, parseFloat(e.target.value))} />
        {maskTargetId && maskTargetName && (
          <span className={`mask-paint-chip ${tool === 'eraser' ? 'reveal' : 'hide'}`} title={`Editando la máscara de ${maskTargetName}`}>
            <i />{tool === 'eraser' ? 'Revelar' : 'Ocultar'}
          </span>
        )}
      </>
    );
  } else if (tool === 'vector-shape' || tool === 'vector-pen' || tool === 'vector-node') {
    const activeShape = activeLayer?.vector?.kind === 'editable' ? activeLayer.vector.shapes?.[0] : null;
    const activeStyle = activeShape?.style ?? null;
    const primitive = activeShape?.primitive;
    const inputColor = (value: string | null | undefined, fallback: string) => /^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : fallback;
    const fillEnabled = activeStyle ? !!(activeStyle.fill || activeStyle.fillGradient) : vectorFillEnabled;
    const fill = inputColor(activeStyle?.fill, vectorFill);
    const strokeEnabled = activeStyle ? !!(activeStyle.stroke || activeStyle.strokeGradient) : vectorStrokeEnabled;
    const stroke = inputColor(activeStyle?.stroke, vectorStroke);
    const strokeWidth = activeStyle?.strokeWidth ?? vectorStrokeWidth;
    const strokeAlign = activeStyle?.strokeAlign ?? vectorStrokeAlign;
    const styleTarget = activeLayer?.vector?.kind === 'editable' ? activeLayer.id : null;
    const changeStyle = (patch: Parameters<typeof setVectorStyle>[2], captureHistory = true) => {
      if (styleTarget) setVectorStyle(styleTarget, null, patch, captureHistory);
    };
    const nodeModes: Array<{ mode: VectorNodeMode; icon: 'node-select' | 'node-add' | 'node-delete' | 'node-convert'; title: string }> = [
      { mode: 'select', icon: 'node-select', title: 'Seleccionar y mover nodos (A)' },
      { mode: 'add', icon: 'node-add', title: 'Agregar nodo sobre un segmento' },
      { mode: 'delete', icon: 'node-delete', title: 'Eliminar nodo' },
      { mode: 'convert', icon: 'node-convert', title: 'Convertir esquina / suave / simétrico' },
    ];
    const shapeModes: Array<{ kind: VectorPrimitiveKind; icon: 'shape-rectangle' | 'shape-ellipse' | 'shape-triangle' | 'shape-polygon'; title: string }> = [
      { kind: 'rectangle', icon: 'shape-rectangle', title: 'Rectángulo' },
      { kind: 'ellipse', icon: 'shape-ellipse', title: 'Elipse' },
      { kind: 'triangle', icon: 'shape-triangle', title: 'Triángulo' },
      { kind: 'polygon', icon: 'shape-polygon', title: 'Polígono regular' },
    ];
    const strokeAlignments: Array<{ align: VectorStrokeAlign; icon: 'stroke-inside' | 'stroke-center' | 'stroke-outside'; title: string }> = [
      { align: 'inside', icon: 'stroke-inside', title: 'Trazo hacia adentro' },
      { align: 'center', icon: 'stroke-center', title: 'Trazo centrado' },
      { align: 'outside', icon: 'stroke-outside', title: 'Trazo hacia afuera' },
    ];
    const pathfinder: Array<{ operation: PathfinderOperation; icon: 'path-unite' | 'path-subtract' | 'path-intersect' | 'path-exclude'; title: string }> = [
      { operation: 'unite', icon: 'path-unite', title: 'Unir formas' },
      { operation: 'subtract', icon: 'path-subtract', title: 'Restar frente' },
      { operation: 'intersect', icon: 'path-intersect', title: 'Intersectar' },
      { operation: 'exclude', icon: 'path-exclude', title: 'Excluir superposición' },
    ];
    content = (
      <>
        <div className="seg vector-modes" aria-label="Modo vectorial">
          <button className={tool === 'vector-shape' ? 'on' : ''} title="Dibujar formas vectoriales (U)" aria-label="Formas"
            onClick={() => setTool('vector-shape')}><Icon name="shape" size={15} /></button>
          <button className={tool === 'vector-pen' ? 'on' : ''} title="Dibujar trazado con Pluma (P)" aria-label="Pluma"
            onClick={() => setTool('vector-pen')}><Icon name="pen" size={15} /></button>
          {nodeModes.map((item) => <button key={item.mode} className={tool === 'vector-node' && vectorNodeMode === item.mode ? 'on' : ''}
            title={item.title} aria-label={item.title} onClick={() => { setToolDefaults({ vectorNodeMode: item.mode }); setTool('vector-node'); }}>
            <Icon name={item.icon} size={15} />
          </button>)}
        </div>
        {tool === 'vector-shape' && <>
          <span className="tool-sep" />
          <div className="seg vector-shape-modes" aria-label="Tipo de figura">
            {shapeModes.map((item) => <button key={item.kind} className={vectorShapeKind === item.kind ? 'on' : ''}
              title={item.title} aria-label={item.title} onClick={() => setToolDefaults({ vectorShapeKind: item.kind })}>
              <Icon name={item.icon} size={15} />
            </button>)}
          </div>
        </>}
        <span className="tool-sep" />
        <label className="vector-paint-control" title="Activar o desactivar relleno">
          <input type="checkbox" checked={fillEnabled} onChange={(event) => {
            setToolDefaults({ vectorFillEnabled: event.target.checked });
            changeStyle({ fill: event.target.checked ? vectorFill : null, fillGradient: undefined });
          }} />
          <span>R</span>
          <input type="color" value={fill} onChange={(event) => {
            setToolDefaults({ vectorFill: event.target.value, vectorFillEnabled: true });
            changeStyle({ fill: event.target.value, fillGradient: undefined }, false);
          }} onPointerDown={() => { if (styleTarget) snapshot('Cambiar relleno vectorial'); }} />
        </label>
        <label className="vector-paint-control" title="Activar o desactivar trazo">
          <input type="checkbox" checked={strokeEnabled} onChange={(event) => {
            setToolDefaults({ vectorStrokeEnabled: event.target.checked });
            changeStyle({ stroke: event.target.checked ? vectorStroke : null, strokeGradient: undefined });
          }} />
          <span>T</span>
          <input type="color" value={stroke} onChange={(event) => {
            setToolDefaults({ vectorStroke: event.target.value, vectorStrokeEnabled: true });
            changeStyle({ stroke: event.target.value, strokeGradient: undefined }, false);
          }} onPointerDown={() => { if (styleTarget) snapshot('Cambiar trazo vectorial'); }} />
        </label>
        <NumericControl className="compact vector-stroke-width" label="Grosor" value={strokeWidth} min={0.1} max={500} step={0.1}
          decimals={1} suffix="px" onChange={(value) => {
            setToolDefaults({ vectorStrokeWidth: value });
            changeStyle({ strokeWidth: value }, false);
          }} onBegin={() => { if (styleTarget) snapshot('Cambiar grosor vectorial'); }} />
        <div className="seg vector-stroke-align" aria-label="Alineación del trazo">
          {strokeAlignments.map((item) => <button key={item.align} className={strokeAlign === item.align ? 'on' : ''}
            title={item.title} aria-label={item.title} onClick={() => {
              setToolDefaults({ vectorStrokeAlign: item.align });
              changeStyle({ strokeAlign: item.align });
            }}><Icon name={item.icon} size={14} /></button>)}
        </div>
        {tool === 'vector-shape' && vectorShapeKind === 'polygon' && <NumericControl className="compact vector-sides" label="Lados"
          value={primitive?.kind === 'polygon' ? primitive.sides : vectorPolygonSides} min={3} max={64} step={1}
          onChange={(value) => {
            const sides = Math.round(value);
            setToolDefaults({ vectorPolygonSides: sides });
            if (styleTarget && primitive?.kind === 'polygon') updateVectorPrimitive(styleTarget, { sides }, false);
          }} onBegin={() => { if (styleTarget && primitive?.kind === 'polygon') snapshot('Editar forma vectorial'); }} />}
        {tool === 'vector-shape' && vectorShapeKind !== 'ellipse' && <NumericControl className="compact vector-radius" label="Radio"
          value={primitive && primitive.kind !== 'ellipse' ? primitive.cornerRadius : vectorCornerRadius} min={0} max={4000} step={1}
          suffix="px" onChange={(value) => {
            const cornerRadius = Math.max(0, value);
            setToolDefaults({ vectorCornerRadius: cornerRadius });
            if (styleTarget && primitive && primitive.kind !== 'ellipse') updateVectorPrimitive(styleTarget, { cornerRadius }, false);
          }} onBegin={() => { if (styleTarget && primitive && primitive.kind !== 'ellipse') snapshot('Editar forma vectorial'); }} />}
        {selectedEditableVectors >= 2 && <>
          <span className="tool-sep" />
          <div className="seg pathfinder-controls" aria-label="Pathfinder">
            {pathfinder.map((item) => <button key={item.operation} title={item.title} aria-label={item.title}
              onClick={() => applyPathfinder(item.operation, pathfinderPreserveOriginals)}><Icon name={item.icon} size={15} /></button>)}
            <button title="Crear trazado compuesto" aria-label="Crear trazado compuesto" onClick={() => makeCompoundPath()}>
              <Icon name="compound" size={15} />
            </button>
          </div>
          <label className="checkbox compact-check" title="Mantener las capas de entrada">
            <input type="checkbox" checked={pathfinderPreserveOriginals}
              onChange={(event) => setToolDefaults({ pathfinderPreserveOriginals: event.target.checked })} />Originales
          </label>
        </>}
      </>
    );
  } else if (tool === 'zoom') {
    content = <span className="tool-icon-label" title="Zoom · Opción para alejar"><Icon name="zoom-in" size={15} /></span>;
  } else if (tool === 'wand' || tool === 'bucket') {
    content = (
      <>
        <NumericControl className="compact" label="Tolerancia" value={wandTolerance} min={0} max={255} step={1}
          onChange={(value) => setWand(Math.round(value))} />
        <input type="range" min={0} max={255} value={wandTolerance}
          aria-label="Tolerancia"
          onChange={(e) => setWand(parseInt(e.target.value))} />
        <label className="checkbox">
          <input type="checkbox" checked={wandContiguous}
            onChange={(e) => setWand(undefined, e.target.checked)} />
          Contiguo
        </label>
        {tool === 'wand' && <>
          <select className="wand-source" value={wandSampleSource} aria-label="Fuente de muestra"
            onChange={(e) => setToolDefaults({ wandSampleSource: e.target.value as 'layer' | 'visible' })}>
            <option value="layer">Capa</option>
            <option value="visible">Visible</option>
          </select>
          <label className="checkbox" title="Comparar también la transparencia de cada píxel">
            <input type="checkbox" checked={wandIncludeTransparency}
              onChange={(e) => setToolDefaults({ wandIncludeTransparency: e.target.checked })} />
            Alfa
          </label>
        </>}
      </>
    );
  } else if (tool === 'select-poly' || tool === 'select-bezier' || tool === 'select-rect' || tool === 'select-ellipse') {
    content = null;
  } else if (tool === 'ai-mask') {
    content = (
      <>
        <NumericControl className="compact" label="Confianza" value={aiMaskConfidence} min={5} max={90} step={1}
          suffix="%" onChange={(value) => setToolDefaults({ aiMaskConfidence: Math.round(value) })} />
        <input type="range" min={5} max={90} value={aiMaskConfidence}
          aria-label="Confianza de máscara IA"
          onChange={(e) => setToolDefaults({ aiMaskConfidence: parseInt(e.target.value) })} />
      </>
    );
  } else if (tool === 'pixel-stretch') {
    content = (
      <>
        <span className="tool-icon-label" title="Pixel Stretch por curva Bézier"><Icon name="pixel-stretch" size={15} /></span>
        <div className="pixel-stretch-mode" role="group" aria-label="Edición de Pixel Stretch">
          <button className={`mini-btn ${pixelStretchEditMode === 'path' ? 'on' : ''}`}
            title="Editar el recorrido" onClick={() => onPixelStretchEditMode?.('path')}>Trazo</button>
          <button className={`mini-btn ${pixelStretchEditMode === 'sample' ? 'on' : ''}`}
            title="Editar el origen y la dirección de la muestra" onClick={() => onPixelStretchEditMode?.('sample')}>Origen</button>
        </div>
        <NumericControl className="compact" label="Muestra" value={pixelStretchSampleWidth} min={1} max={2000} step={1}
          suffix="px" onChange={(value) => setToolDefaults({ pixelStretchSampleWidth: Math.round(value) })} />
        <NumericControl className="compact" label="Ancho" value={pixelStretchOutputWidth} min={1} max={4000} step={1}
          suffix="px" onChange={(value) => setToolDefaults({ pixelStretchOutputWidth: Math.round(value) })} />
        <select className="wand-source" value={pixelStretchSource} aria-label="Fuente de píxeles"
          onChange={(e) => setToolDefaults({ pixelStretchSource: e.target.value as 'layer' | 'visible' })}>
          <option value="layer">Capa</option>
          <option value="visible">Visible</option>
        </select>
        <select className="wand-source" value={pixelStretchPattern} aria-label="Distribución de la muestra"
          onChange={(e) => setToolDefaults({ pixelStretchPattern: e.target.value as 'stretch' | 'repeat' | 'mirror' })}>
          <option value="stretch">Estirar</option>
          <option value="repeat">Repetir</option>
          <option value="mirror">Espejar</option>
        </select>
        <select className="wand-source" value={pixelStretchCurveMode} aria-label="Tipo de curva"
          onChange={(e) => setToolDefaults({ pixelStretchCurveMode: e.target.value as 'auto' | 'bezier' })}>
          <option value="auto">Curva auto</option>
          <option value="bezier">Bézier manual</option>
        </select>
        {pixelStretchEditMode === 'sample' && (
          <button className="selection-action" title="Vincular muestra al inicio del trazo" aria-label="Vincular muestra al inicio del trazo"
            onClick={onResetPixelStretchSample}><Icon name="reset" size={15} /></button>
        )}
        <button ref={stretchAdvancedButtonRef} className={`selection-action ${stretchAdvanced ? 'on' : ''}`}
          title="Ajustes avanzados de Pixel Stretch" aria-label="Ajustes avanzados de Pixel Stretch"
          onClick={() => {
            const rect = stretchAdvancedButtonRef.current?.getBoundingClientRect();
            if (rect) setStretchAdvancedPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 310)), top: rect.bottom + 6 });
            setStretchAdvanced((value) => !value);
          }}><Icon name="adjust" size={15} /></button>
        {stretchAdvanced && createPortal(
          <div className="pixel-stretch-advanced" data-ui style={stretchAdvancedPos}>
            <div className="pixel-stretch-advanced-title">
              <span>Ajustes avanzados</span>
              <button className="selection-action" title="Cerrar" aria-label="Cerrar ajustes avanzados"
                onClick={() => setStretchAdvanced(false)}><Icon name="close" size={14} /></button>
            </div>
            <NumericControl className="pixel-stretch-field" label="Giro progresivo" value={pixelStretchTwist} min={-720} max={720} step={1}
              suffix="°" resetValue={0} onChange={(value) => setToolDefaults({ pixelStretchTwist: value })} />
            <label>Suavidad de curva</label>
            <div className="pixel-stretch-opacity"><input type="range" min={0} max={1} step={0.05} value={pixelStretchCurveSmoothness}
              disabled={pixelStretchCurveMode !== 'auto'}
              onChange={(e) => setToolDefaults({ pixelStretchCurveSmoothness: parseFloat(e.target.value) })} />
              <NumericControl className="compact" value={Math.round(pixelStretchCurveSmoothness * 100)} min={0} max={100} step={1} suffix="%"
                disabled={pixelStretchCurveMode !== 'auto'} ariaLabel="Suavidad de curva"
                onChange={(value) => setToolDefaults({ pixelStretchCurveSmoothness: value / 100 })} /></div>
            <NumericControl className="pixel-stretch-field" label="Ancho inicial" value={Math.round(pixelStretchTaperStart * 100)} min={0} max={200} step={1}
              suffix="%" resetValue={100} onChange={(value) => setToolDefaults({ pixelStretchTaperStart: value / 100 })} />
            <NumericControl className="pixel-stretch-field" label="Ancho final" value={Math.round(pixelStretchTaperEnd * 100)} min={0} max={200} step={1}
              suffix="%" resetValue={100} onChange={(value) => setToolDefaults({ pixelStretchTaperEnd: value / 100 })} />
            <NumericControl className="pixel-stretch-field" label="Borde suave" value={Math.round(pixelStretchEdgeFeather)} min={0} max={200} step={1}
              suffix="px" resetValue={0} onChange={(value) => setToolDefaults({ pixelStretchEdgeFeather: value })} />
            <NumericControl className="pixel-stretch-field" label="Fade de entrada" value={Math.round(pixelStretchFadeStart * 100)} min={0} max={100} step={1}
              suffix="%" resetValue={0} onChange={(value) => setToolDefaults({ pixelStretchFadeStart: value / 100 })} />
            <NumericControl className="pixel-stretch-field" label="Fade de salida" value={Math.round(pixelStretchFadeEnd * 100)} min={0} max={100} step={1}
              suffix="%" resetValue={0} onChange={(value) => setToolDefaults({ pixelStretchFadeEnd: value / 100 })} />
            <label>Opacidad</label>
            <div className="pixel-stretch-opacity"><input type="range" min={0.05} max={1} step={0.05} value={pixelStretchOpacity}
              onChange={(e) => setToolDefaults({ pixelStretchOpacity: parseFloat(e.target.value) })} />
              <NumericControl className="compact" value={Math.round(pixelStretchOpacity * 100)} min={5} max={100} step={1} suffix="%"
                ariaLabel="Opacidad" onChange={(value) => setToolDefaults({ pixelStretchOpacity: value / 100 })} /></div>
            <label className="checkbox pixel-stretch-check" title="Invertir el orden de los píxeles de la franja">
              <input type="checkbox" checked={pixelStretchReverse}
                onChange={(e) => setToolDefaults({ pixelStretchReverse: e.target.checked })} />Invertir muestra
            </label>
            <label className="checkbox pixel-stretch-check" title="Interpolar la franja al cambiar su ancho">
              <input type="checkbox" checked={pixelStretchSmoothing}
                onChange={(e) => setToolDefaults({ pixelStretchSmoothing: e.target.checked })} />Interpolación suave
            </label>
          </div>,
          document.body,
        )}
        {pixelStretchReady && <>
          <button className="mini-btn on" onClick={onApplyPixelStretch}>Aplicar</button>
          <button className="mini-btn" onClick={onCancelPixelStretch}>Cancelar</button>
        </>}
      </>
    );
  } else if (tool === 'warp-mesh') {
    content = (
      <>
        <span className="tool-icon-label" title="Deformación libre por malla"><Icon name="warp-mesh" size={15} /></span>
        <NumericControl className="compact" label="Columnas" value={warpMeshColumns} min={2} max={12} step={1}
          onChange={(value) => setToolDefaults({ warpMeshColumns: Math.round(value) })} />
        <NumericControl className="compact" label="Filas" value={warpMeshRows} min={2} max={12} step={1}
          onChange={(value) => setToolDefaults({ warpMeshRows: Math.round(value) })} />
        <label className="checkbox" title="Interpolar los píxeles durante la deformación">
          <input type="checkbox" checked={warpMeshSmoothing}
            onChange={(e) => setToolDefaults({ warpMeshSmoothing: e.target.checked })} />Suave
        </label>
        <NumericControl className="compact" label="Curva" ariaLabel="Suavidad de curva" value={Math.round(warpMeshFluidity * 100)} min={0} max={100} step={1}
          suffix="%" resetValue={85} onChange={(value) => setToolDefaults({ warpMeshFluidity: value / 100 })} />
        <input type="range" min={0} max={1} step={0.05} value={warpMeshFluidity}
          aria-label="Suavidad de curva"
          onChange={(e) => setToolDefaults({ warpMeshFluidity: parseFloat(e.target.value) })} />
        <NumericControl className="compact" label="Radio" value={warpMeshInfluence} min={0} max={3} step={0.1} decimals={1}
          resetValue={1.2} onChange={(value) => setToolDefaults({ warpMeshInfluence: value })} />
        <input type="range" min={0} max={3} step={0.1} value={warpMeshInfluence}
          aria-label="Radio de influencia"
          onChange={(e) => setToolDefaults({ warpMeshInfluence: parseFloat(e.target.value) })} />
        <button className="selection-action" title="Restablecer malla" aria-label="Restablecer malla" onClick={onResetWarpMesh}>
          <Icon name="reset" size={15} />
        </button>
        {warpMeshReady && <>
          <button className="mini-btn on" onClick={onApplyWarpMesh}>Aplicar</button>
          <button className="mini-btn" onClick={onCancelWarpMesh}>Cancelar</button>
        </>}
      </>
    );
  } else if (tool === 'crop') {
    content = (
      <>
        <span className="tool-icon-label" title="Arrastrar fuera: redibujar · Interior: mover · Vértices: reajustar · Enter: aplicar · Esc: cancelar">
          <Icon name="crop" size={15} />
        </span>
        <span className="tool-sep" />
        {CROP_ASPECTS.map((ratio) => (
          <button key={ratio} className={`mini-btn ${cropAspect === ratio ? 'on' : ''}`}
            onClick={() => setCropAspect(ratio)}>
            {cropAspectLabel(ratio, cropVertical)}
          </button>
        ))}
        <label className="checkbox">
          <input type="checkbox" checked={cropVertical}
            onChange={(e) => setCropVertical(e.target.checked)} />
          Vertical
        </label>
        {cropAspect === 'free' && onCropSize && (
          <>
            <span className="tool-sep" />
            <CropDimField label="An." px={cropRect?.w ?? null} unit={unit} ppi={ppi}
              onCommit={(w) => onCropSize(w, cropRect?.h ?? w)} />
            <CropDimField label="Al." px={cropRect?.h ?? null} unit={unit} ppi={ppi}
              onCommit={(h) => onCropSize(cropRect?.w ?? h, h)} />
          </>
        )}
      </>
    );
  }

  if (!content) {
    const passiveTool = tool === 'move'
      ? { icon: 'move' as const, title: 'Mover' }
      : tool === 'hand'
        ? { icon: 'hand' as const, title: 'Desplazar lienzo' }
        : tool === 'text'
          ? { icon: 'text' as const, title: 'Texto' }
          : null;
    if (passiveTool) {
      content = <span className="tool-icon-label" title={passiveTool.title}><Icon name={passiveTool.icon} size={15} /></span>;
    }
  }

  const selectionModeControls = isSelectionTool ? (
    <div className="selection-mode-group" role="group" aria-label="Modo de combinación de selección">
      {SELECTION_MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={`selection-mode ${effectiveSelectionMode === mode.id ? 'on' : ''} ${effectiveSelectionMode === mode.id && effectiveSelectionMode !== selectionCombineMode ? 'temporary' : ''}`}
          aria-label={mode.label}
          aria-pressed={effectiveSelectionMode === mode.id}
          title={mode.label}
          onClick={() => setToolDefaults({ selectionCombineMode: mode.id })}
        >
          <Icon name={mode.icon} size={15} />
        </button>
      ))}
    </div>
  ) : null;

  const selectionControls = hasSelection ? (
    <>
      <span className="tool-sep" />
      {selectionBounds && (
        <span className="selection-geometry" title="Posición y tamaño de la selección">
          <b>X</b>{Math.round(selectionBounds.x)} <b>Y</b>{Math.round(selectionBounds.y)}
          <b>W</b>{Math.round(selectionBounds.w)} <b>H</b>{Math.round(selectionBounds.h)}
        </span>
      )}
      <div className="selection-refine" role="group" aria-label="Refinar selección">
        <NumericControl className="compact" value={selectionPx} min={1} max={500} step={1} suffix="px"
          ariaLabel="Píxeles para refinar la selección"
          onChange={(value) => setToolDefaults({ selectionGrowPx: Math.round(value) })} />
        <button className="selection-action" title="Expandir selección" aria-label="Expandir selección"
          onClick={() => adjustSelectionBy(selectionPx)}><Icon name="select-expand" size={15} /></button>
        <button className="selection-action" title="Contraer selección" aria-label="Contraer selección"
          onClick={() => adjustSelectionBy(-selectionPx)}><Icon name="select-contract" size={15} /></button>
        <button className="selection-action" title="Suavizar borde de selección" aria-label="Suavizar borde de selección"
          onClick={() => smoothSelectionBy(selectionPx)}><Icon name="select-smooth" size={15} /></button>
        <button className="selection-action" title="Aplicar feather al borde" aria-label="Aplicar feather al borde"
          onClick={() => featherSelectionBy(selectionPx)}><Icon name="select-feather" size={15} /></button>
        <span className="tool-sep" />
        <button className="selection-action danger" title="Eliminar píxeles seleccionados (Supr)" aria-label="Eliminar píxeles seleccionados"
          onClick={deleteSelectionPixels}><Icon name="trash" size={15} /></button>
      </div>
    </>
  ) : null;

  if (!content && !selectionControls && !selectionModeControls) return null;
  if (!portalHost) return null;
  return createPortal(
    <div className="tool-options" data-ui>{selectionModeControls}{content && selectionModeControls && <span className="tool-sep" />}{content}{selectionControls}</div>,
    portalHost,
  );
}
