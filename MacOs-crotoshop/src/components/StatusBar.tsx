import { useMemo, useState } from 'react';
import { useEditor } from '../store/editorStore';
import {
  CANVAS_BACKGROUND_MOTION_CHECKER,
  CANVAS_BACKGROUND_MOTION_DIAGONAL,
  useSettings,
} from '../store/settingsStore';
import { formatDim } from '../engine/units';
import { ColorPickerPopover } from './ColorPickerPopover';
import { Icon } from './Icons';
import type { Unit } from '../types';
import { usePerformanceMetrics } from '../store/performanceStore';
import { estimateHistoryBytes } from '../engine/history';

const CANVAS_BG_SWATCHES = [
  { color: '#000000', label: 'Fondo negro' },
  { color: '#ffffff', label: 'Fondo blanco' },
  { color: '#ff00ff', label: 'Fondo magenta' },
  { color: '#00c853', label: 'Fondo verde' },
];

export function StatusBar({ onFit, onPalettes }: { onFit: () => void; onPalettes: () => void }) {
  const doc = useEditor((s) => s.doc);
  const zoom = useEditor((s) => s.zoom);
  const cursor = useEditor((s) => s.cursor);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const selectedLayerIds = useEditor((s) => s.selectedLayerIds);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const maskTargetName = useEditor((s) => s.doc?.layers.find((layer) => layer.id === s.maskTargetId)?.name ?? null);
  const activeColor = useEditor((s) => s.fgColor);
  const primaryColor = useEditor((s) => s.primaryColor);
  const eyedropperActive = useEditor((s) => s.eyedropperActive);
  const eyedropperPreview = useEditor((s) => s.eyedropperPreview);
  const setZoom = useEditor((s) => s.setZoom);
  const setFgColor = useEditor((s) => s.setFgColor);
  const setPrimaryColor = useEditor((s) => s.setPrimaryColor);
  const setEyedropperActive = useEditor((s) => s.setEyedropperActive);
  const toast = useEditor((s) => s.toast);
  const unit = useSettings((s) => s.unit);
  const ppi = useSettings((s) => s.ppi);
  const canvasBgColor = useSettings((s) => s.canvasBgColor);
  const setUnit = useSettings((s) => s.setUnit);
  const setCanvasBgColor = useSettings((s) => s.setCanvasBgColor);
  const showPerformanceStats = useSettings((s) => s.showPerformanceStats);
  const performanceMetrics = usePerformanceMetrics();
  const [pickerOpen, setPickerOpen] = useState(false);
  const displayedColor = eyedropperPreview ?? activeColor;
  const documentMemory = useMemo(
    () => estimateHistoryBytes([{ doc }, ...past, ...future]),
    [doc, past, future],
  );

  const toggleEyedropper = () => {
    if (eyedropperActive) {
      setEyedropperActive(false);
      return;
    }
    if (!doc) {
      toast('Abrí o creá un documento para usar el cuentagotas', 'error');
      return;
    }
    setPickerOpen(false);
    setEyedropperActive(true);
  };

  const toolLabel: Record<string, string> = {
    move: 'Mover', crop: 'Recortar', eraser: 'Borrador', hand: 'Mano', zoom: 'Zoom',
    'select-rect': 'Selección rect.', 'select-ellipse': 'Selección elipse',
    'select-poly': 'Selección polígono', 'select-bezier': 'Selección bezier',
    wand: 'Varita mágica', text: 'Texto',
    brush: 'Pincel', bucket: 'Bote de pintura', blur: 'Desenfocar', sharpen: 'Enfocar',
    'ai-mask': 'Máscara IA', 'vector-shape': 'Forma vectorial', 'vector-pen': 'Pluma vectorial', 'vector-node': 'Selección directa', 'pixel-stretch': 'Pixel Stretch',
    'warp-mesh': 'Warp Mesh',
  };

  return (
    <div className="statusbar">
      <div className="footer-color-controls" data-ui>
        <div className="footer-color-group">
          <span className="footer-control-label">Color</span>
          <div className="fg-color-wrap">
            <button
              className={`fg-color footer-fg-color ${eyedropperActive ? 'sampling' : ''}`}
              aria-label="Abrir selector de color"
              title={`Color activo ${displayedColor}. Editar color primario ${primaryColor}`}
              style={{ background: displayedColor }}
              onClick={() => {
                setEyedropperActive(false);
                setFgColor(primaryColor);
                setPickerOpen((open) => !open);
              }}
            >
              {displayedColor.toLowerCase() !== primaryColor.toLowerCase() && (
                <span className="primary-color-indicator" style={{ background: primaryColor }} />
              )}
            </button>
            {pickerOpen && (
              <ColorPickerPopover
                color={primaryColor}
                onChange={setPrimaryColor}
                onClose={() => setPickerOpen(false)}
                style={{ left: 0, bottom: 'calc(100% + 8px)' }}
              />
            )}
          </div>
          <button
            className={`footer-icon-btn ${eyedropperActive ? 'active' : ''}`}
            title={eyedropperActive ? 'Cancelar cuentagotas (Esc)' : 'Tomar color del lienzo'}
            aria-label={eyedropperActive ? 'Cancelar cuentagotas' : 'Tomar color del lienzo'}
            aria-pressed={eyedropperActive}
            onClick={toggleEyedropper}
          >
            <Icon name="eyedropper" size={18} />
          </button>
          <button className="footer-icon-btn" title="Abrir paletas de colores" aria-label="Abrir paletas de colores" onClick={onPalettes}>
            <Icon name="palette" size={18} />
          </button>
        </div>
        <span className="footer-control-divider" />
        <div className="footer-background-group">
          <span className="footer-control-label">Fondo</span>
          <div className="footer-bg-swatches" title="Fondo visual del lienzo">
            {CANVAS_BG_SWATCHES.map((swatch) => (
              <button
                key={swatch.color}
                className={`canvas-bg-swatch ${canvasBgColor === swatch.color ? 'active' : ''}`}
                style={{ background: swatch.color }}
                title={swatch.label}
                aria-label={swatch.label}
                onClick={() => setCanvasBgColor(canvasBgColor === swatch.color ? null : swatch.color)}
              />
            ))}
            <button
              className={`canvas-bg-swatch checker ${canvasBgColor == null ? 'active' : ''}`}
              title="Fondo transparente"
              aria-label="Fondo transparente"
              onClick={() => setCanvasBgColor(null)}
            />
            <button
              className={`canvas-bg-swatch motion-diagonal ${canvasBgColor === CANVAS_BACKGROUND_MOTION_DIAGONAL ? 'active' : ''}`}
              title="Transparencia animada con líneas diagonales"
              aria-label="Transparencia animada con líneas diagonales"
              onClick={() => setCanvasBgColor(CANVAS_BACKGROUND_MOTION_DIAGONAL)}
            />
            <button
              className={`canvas-bg-swatch motion-checker ${canvasBgColor === CANVAS_BACKGROUND_MOTION_CHECKER ? 'active' : ''}`}
              title="Transparencia animada con cuadrados alternados"
              aria-label="Transparencia animada con cuadrados alternados"
              onClick={() => setCanvasBgColor(CANVAS_BACKGROUND_MOTION_CHECKER)}
            />
          </div>
        </div>
      </div>
      <div className="status-meta">
        <span className="status-tool">{toolLabel[tool] ?? tool}</span>
        {maskTargetName && <span className="status-target mask"><Icon name="mask" size={11} />{maskTargetName}</span>}
        {!maskTargetName && selectedLayerIds.length > 1 && <span className="status-target">{selectedLayerIds.length} capas</span>}
        {selection && <span className="status-selection">Selección {Math.round(selection.bounds.w)} × {Math.round(selection.bounds.h)} px</span>}
        {doc && (
          <span>
            {formatDim(doc.width, unit, ppi)} × {formatDim(doc.height, unit, ppi)}{unit}
          </span>
        )}
        {doc && <span>{doc.layers.length} capa{doc.layers.length === 1 ? '' : 's'}</span>}
        {cursor && doc && (
          <span>{formatDim(cursor.x, unit, ppi)}, {formatDim(cursor.y, unit, ppi)}{unit === 'cm' ? 'cm' : ''}</span>
        )}
      </div>
      <span className="spacer" />
      {showPerformanceStats && doc && <span className="performance-stats" title="Composiciones por segundo · promedio / p95 · memoria estimada de documento e historial">
        {performanceMetrics.rendersPerSecond} r/s · {performanceMetrics.averageCompositeMs.toFixed(1)}/{performanceMetrics.p95CompositeMs.toFixed(1)} ms · {(documentMemory / 1048576).toFixed(0)} MB
      </span>}
      <select
        className="unit-select"
        value={unit}
        title={`Unidad de medida (a ${ppi} ppi)`}
        onChange={(e) => setUnit(e.target.value as Unit)}
      >
        <option value="px">px</option>
        <option value="cm">cm</option>
      </select>
      <div className="zoom-ctl">
        <button aria-label="Alejar" title="Alejar" onClick={() => setZoom(zoom / 1.2)}><Icon name="zoom-out" size={14} /></button>
        <button aria-label="Ver a píxeles reales" onClick={() => setZoom(1)} title="Píxeles reales (⌘1)" style={{ minWidth: 42 }}>100%</button>
        <button aria-label="Ajustar a la vista" onClick={onFit} title="Ajustar a la vista (⌘0)" style={{ minWidth: 44 }}>
          {Math.round(zoom * 100)}%
        </button>
        <button aria-label="Acercar" title="Acercar" onClick={() => setZoom(zoom * 1.2)}><Icon name="zoom-in" size={14} /></button>
      </div>
    </div>
  );
}
