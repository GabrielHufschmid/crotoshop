import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { useEditor } from '../store/editorStore';
import { Icon } from './Icons';
import type { Adjustments, RGB } from '../types';

function rgbToHex([r, g, b]: RGB): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defVal: number;
  format: (v: number) => string;
  onStart: () => void;
  onChange: (v: number) => void;
  onReset: () => void;
}

function Slider(p: SliderProps) {
  return (
    <div className="field">
      <div className="row">
        <label>{p.label}</label>
        <span
          className={`val ${p.value !== p.defVal ? 'reset' : ''}`}
          onClick={p.value !== p.defVal ? p.onReset : undefined}
          title={p.value !== p.defVal ? 'Restablecer' : undefined}
        >
          {p.format(p.value)}
        </span>
      </div>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        onPointerDown={p.onStart}
        onChange={(e) => p.onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function AdjustmentsPanel() {
  const doc = useEditor((s) => s.doc);
  const activeId = doc?.activeId ?? null;
  const layer = useEditor((s) => s.doc?.layers.find((l) => l.id === s.doc?.activeId) ?? null);
  const setAdjustments = useEditor((s) => s.setAdjustments);
  const resetAdjustments = useEditor((s) => s.resetAdjustments);
  const snapshot = useEditor((s) => s.snapshot);
  const snapshotAdjustment = () => snapshot('Cambiar ajustes');
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!layer || !activeId) {
    return (
      <div className="panel" style={{ flex: '1 1 auto' }}>
        <div className="panel-head">Ajustes</div>
        <div className="hint-empty">Seleccioná una capa para ajustar<br />brillo, color y más.</div>
      </div>
    );
  }

  const a = layer.kind === 'adjustment' ? layer.adjustmentLayer ?? layer.adjustments : layer.adjustments;
  const set = (patch: Partial<Adjustments>) => setAdjustments(activeId, patch);
  const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;

  return (
    <div className="panel" style={{ flex: '1 1 auto', minHeight: 0 }}>
      <div className="panel-head">
        {layer.kind === 'adjustment' ? 'Ajuste no destructivo' : 'Ajustes'}
        <div className="actions">
          <button className="icon-btn" title="Restablecer todo" onClick={() => resetAdjustments(activeId)}>
            <Icon name="reset" size={14} />
          </button>
        </div>
      </div>

      <div className="adjust">
        <Slider label="Brillo" value={a.brightness} min={-1} max={1} step={0.01} defVal={0}
          format={pct} onStart={snapshotAdjustment} onChange={(v) => set({ brightness: v })}
          onReset={() => { snapshotAdjustment(); set({ brightness: 0 }); }} />
        <Slider label="Contraste" value={a.contrast} min={-1} max={1} step={0.01} defVal={0}
          format={pct} onStart={snapshotAdjustment} onChange={(v) => set({ contrast: v })}
          onReset={() => { snapshotAdjustment(); set({ contrast: 0 }); }} />
        <Slider label="Saturación" value={a.saturation} min={-1} max={1} step={0.01} defVal={0}
          format={pct} onStart={snapshotAdjustment} onChange={(v) => set({ saturation: v })}
          onReset={() => { snapshotAdjustment(); set({ saturation: 0 }); }} />
        <Slider label="Gama" value={a.gamma} min={0.2} max={3} step={0.01} defVal={1}
          format={(v) => v.toFixed(2)} onStart={snapshotAdjustment} onChange={(v) => set({ gamma: v })}
          onReset={() => { snapshotAdjustment(); set({ gamma: 1 }); }} />
        <Slider label="Tono (Hue)" value={a.hue} min={-180} max={180} step={1} defVal={0}
          format={(v) => `${Math.round(v)}°`} onStart={snapshotAdjustment} onChange={(v) => set({ hue: v })}
          onReset={() => { snapshotAdjustment(); set({ hue: 0 }); }} />

        <label className="checkbox" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={a.invert > 0.5}
            onChange={(e) => { snapshotAdjustment(); set({ invert: e.target.checked ? 1 : 0 }); }} />
          Invertir colores
        </label>

        <div className="subhead">Recolorear (por alfa)</div>
        <label className="checkbox">
          <input type="checkbox" checked={a.recolor.enabled}
            onChange={(e) => { snapshotAdjustment(); set({ recolor: { ...a.recolor, enabled: e.target.checked } }); }} />
          Reemplazar color visible
        </label>

        {a.recolor.enabled && (
          <div style={{ marginTop: 10 }}>
            <div className="field-row" style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
              <span style={{ color: 'var(--text-dim)' }}>Color</span>
              <div className="color-swatch"
                style={{ background: rgbToHex(a.recolor.color) }}
                onClick={() => setPickerOpen((o) => !o)} />
              <code style={{ color: 'var(--text-faint)' }}>{rgbToHex(a.recolor.color)}</code>
              {pickerOpen && (
                <div className="popover" style={{ right: 0, top: 30 }}
                  onPointerDown={snapshotAdjustment}>
                  <HexColorPicker color={rgbToHex(a.recolor.color)}
                    onChange={(hex) => set({ recolor: { ...a.recolor, color: hexToRgb(hex) } })} />
                </div>
              )}
            </div>
            <label className="checkbox" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={a.recolor.preserveLuma}
                onChange={(e) => { snapshotAdjustment(); set({ recolor: { ...a.recolor, preserveLuma: e.target.checked } }); }} />
              Preservar luminancia
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
