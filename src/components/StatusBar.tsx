import { useState } from 'react';
import { useEditor } from '../store/editorStore';
import { useSettings } from '../store/settingsStore';
import { formatDim } from '../engine/units';
import { ColorPickerPopover } from './ColorPickerPopover';
import { Icon } from './Icons';
import type { Unit } from '../types';

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const displayedColor = eyedropperPreview ?? activeColor;

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
    move: 'Mover', crop: 'Recortar', eraser: 'Borrador', hand: 'Mano',
    'select-rect': 'Selección rect.', 'select-ellipse': 'Selección elipse',
    'select-poly': 'Selección polígono', 'select-bezier': 'Selección bezier',
    wand: 'Varita mágica', text: 'Texto',
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
          </div>
        </div>
      </div>
      <div className="status-meta">
        <span>{toolLabel[tool]}</span>
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
        <button onClick={() => setZoom(zoom / 1.2)}><Icon name="zoom-out" size={14} /></button>
        <button onClick={() => setZoom(1)} title="100%" style={{ minWidth: 42 }}>100%</button>
        <button onClick={onFit} title="Ajustar a la vista (0)" style={{ minWidth: 44 }}>
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => setZoom(zoom * 1.2)}><Icon name="zoom-in" size={14} /></button>
      </div>
    </div>
  );
}
