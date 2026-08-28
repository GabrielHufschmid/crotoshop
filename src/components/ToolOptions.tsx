import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store/editorStore';
import { CROP_ASPECTS, cropAspectLabel, useSettings } from '../store/settingsStore';
import { formatDim, unitToPx } from '../engine/units';
import type { Unit } from '../types';
import { Icon } from './Icons';

const SELECTION_MODES = [
  { id: 'replace', icon: 'select-replace', label: 'Reemplazar selección' },
  { id: 'add', icon: 'select-add', label: 'Sumar a la selección (Shift)' },
  { id: 'subtract', icon: 'select-subtract', label: 'Restar de la selección (Ctrl / Cmd)' },
  { id: 'intersect', icon: 'select-intersect', label: 'Intersectar selección (Shift + Ctrl / Cmd)' },
] as const;

interface CropRectLike { x: number; y: number; w: number; h: number }

interface Props {
  cropRect?: CropRectLike | null;
  onCropSize?: (wPx: number, hPx: number) => void;
}

/** One crop dimension field: shows px or cm (per settings), commits on Enter/blur. */
function CropDimField({ label, px, unit, ppi, onCommit }: {
  label: string; px: number | null; unit: Unit; ppi: number;
  onCommit: (px: number) => void;
}) {
  const shown = px == null ? '' : formatDim(px, unit, ppi);
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);
  const commit = () => {
    const v = parseFloat(draft.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) { setDraft(shown); return; }
    onCommit(unitToPx(v, unit, ppi));
  };
  return (
    <label className="crop-dim">
      <span>{label}</span>
      <input
        className="mini-num" type="text" inputMode="decimal" value={draft}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
      />
    </label>
  );
}

/** Floating contextual options for the active tool, at the top of the stage. */
export function ToolOptions({ cropRect, onCropSize }: Props = {}) {
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const tool = useEditor((s) => s.tool);
  const doc = useEditor((s) => !!s.doc);
  const brushSize = useEditor((s) => s.brushSize);
  const brushHardness = useEditor((s) => s.brushHardness);
  const wandTolerance = useEditor((s) => s.wandTolerance);
  const wandContiguous = useEditor((s) => s.wandContiguous);
  const hasSelection = useEditor((s) => !!s.selection);
  const setBrush = useEditor((s) => s.setBrush);
  const setWand = useEditor((s) => s.setWand);
  const adjustSelectionBy = useEditor((s) => s.adjustSelectionBy);
  const smoothSelectionBy = useEditor((s) => s.smoothSelectionBy);
  const featherSelectionBy = useEditor((s) => s.featherSelectionBy);
  const deleteSelectionPixels = useEditor((s) => s.deleteSelectionPixels);
  const selectionPx = useSettings((s) => s.toolDefaults.selectionGrowPx);
  const selectionCombineMode = useSettings((s) => s.toolDefaults.selectionCombineMode);
  const wandSampleSource = useSettings((s) => s.toolDefaults.wandSampleSource);
  const wandIncludeTransparency = useSettings((s) => s.toolDefaults.wandIncludeTransparency);
  const setToolDefaults = useSettings((s) => s.setToolDefaults);
  const cropAspect = useSettings((s) => s.cropAspect);
  const setCropAspect = useSettings((s) => s.setCropAspect);
  const cropVertical = useSettings((s) => s.cropVertical);
  const setCropVertical = useSettings((s) => s.setCropVertical);
  const unit = useSettings((s) => s.unit);
  const ppi = useSettings((s) => s.ppi);
  const isSelectionTool = tool.startsWith('select-') || tool === 'wand';

  useEffect(() => {
    setPortalHost(document.getElementById('tool-options-slot'));
  }, []);

  if (!doc) return null;

  let content: React.ReactNode = null;
  if (tool === 'eraser' || tool === 'brush' || tool === 'blur' || tool === 'sharpen') {
    content = (
      <>
        <label>Tamaño</label>
        <input type="range" min={2} max={600} value={brushSize}
          onChange={(e) => setBrush(parseInt(e.target.value))} />
        <span className="val">{brushSize}px</span>
        <label>Dureza</label>
        <input type="range" min={0} max={1} step={0.05} value={brushHardness}
          onChange={(e) => setBrush(undefined, parseFloat(e.target.value))} />
        <span className="val">{Math.round(brushHardness * 100)}%</span>
        {tool === 'brush' && <span className="hint">Pinta con el color de primer plano</span>}
        {tool === 'blur' && <span className="hint">Desenfoque localizado</span>}
        {tool === 'sharpen' && <span className="hint">Acentúa detalle local</span>}
      </>
    );
  } else if (tool === 'wand' || tool === 'bucket') {
    content = (
      <>
        <label>Tolerancia</label>
        <input type="range" min={0} max={255} value={wandTolerance}
          onChange={(e) => setWand(parseInt(e.target.value))} />
        <input className="mini-num wand-tolerance-input" type="number" min={0} max={255} value={wandTolerance}
          aria-label="Tolerancia de la varita"
          onChange={(e) => setWand(Math.max(0, Math.min(255, parseInt(e.target.value) || 0)))} />
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
          <span className="hint">Arrastrar horizontal: ajustar y previsualizar · Esc: cancelar</span>
        </>}
        {tool === 'bucket' && <span className="hint">Click: rellenar con el color de primer plano</span>}
      </>
    );
  } else if (tool === 'select-poly') {
    content = <span className="hint">Click: puntos · Cerca del inicio: cerrar · Supr: deshacer punto · Enter: confirmar · Esc: cancelar</span>;
  } else if (tool === 'select-bezier') {
    content = <span className="hint">Click: nodo recto · Arrastrar: curva · Enter o doble click: cerrar · Esc: cancelar</span>;
  } else if (tool === 'select-rect' || tool === 'select-ellipse') {
    content = <span className="hint">Arrastrar: seleccionar · Shift: proporción 1:1 · Alt: desde el centro</span>;
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
            <span className="hint">{unit}</span>
          </>
        )}
      </>
    );
  } else if (tool === 'text') {
    content = <span className="hint">Click: agregar texto · Click sobre un texto: editarlo</span>;
  } else if (tool === 'vector-pen') {
    content = <span className="hint">Click: agregar nodos · Enter / doble click: cerrar la forma vectorial · Esc: cancelar</span>;
  }

  const selectionModeControls = isSelectionTool ? (
    <div className="selection-mode-group" role="group" aria-label="Modo de combinación de selección">
      {SELECTION_MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={`selection-mode ${selectionCombineMode === mode.id ? 'on' : ''}`}
          aria-label={mode.label}
          aria-pressed={selectionCombineMode === mode.id}
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
      <div className="selection-refine" role="group" aria-label="Refinar selección">
        <input
          className="mini-num"
          type="number"
          min={1}
          max={500}
          value={selectionPx}
          aria-label="Píxeles para expandir, contraer o suavizar"
          onChange={(e) => setToolDefaults({ selectionGrowPx: Math.max(1, parseInt(e.target.value) || 1) })}
        />
        <span className="selection-refine-unit">px</span>
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
