import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { useEditor } from '../store/editorStore';
import { Icon } from './Icons';
import { NumericControl } from './NumericControl';
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
  scale?: number;
  suffix?: string;
  decimals?: number;
  onStart: () => void;
  onChange: (v: number) => void;
  onCancel: () => void;
}

function Slider(p: SliderProps) {
  return (
    <div className="field">
      <div className="row">
        <NumericControl
          label={p.label}
          value={p.value * (p.scale ?? 1)}
          min={p.min * (p.scale ?? 1)}
          max={p.max * (p.scale ?? 1)}
          step={p.step * (p.scale ?? 1)}
          decimals={p.decimals}
          suffix={p.suffix}
          resetValue={p.defVal * (p.scale ?? 1)}
          onBegin={p.onStart}
          onCancel={p.onCancel}
          onChange={(value) => p.onChange(value / (p.scale ?? 1))}
        />
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
  const undo = useEditor((s) => s.undo);
  const snapshotAdjustment = () => snapshot('Cambiar ajustes');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [open, setOpen] = useState(false);

  if (!layer || !activeId) {
    return (
      <div className={`panel adjustments-panel ${open ? 'open' : ''}`}>
        <div className="panel-head">
          <button className="collapse-trigger" onClick={() => setOpen((value) => !value)}>
            <Icon name="chevron-down" size={12} className={`collapse-chevron ${open ? 'open' : ''}`} />
            Ajustes
          </button>
        </div>
        {open && <div className="hint-empty">Seleccioná una capa para ajustar<br />brillo, color y más.</div>}
      </div>
    );
  }

  const a = layer.kind === 'adjustment' ? layer.adjustmentLayer ?? layer.adjustments : layer.adjustments;
  const set = (patch: Partial<Adjustments>) => setAdjustments(activeId, patch);

  return (
    <div className={`panel adjustments-panel ${open ? 'open' : ''}`}>
      <div className="panel-head">
        <button className="collapse-trigger" onClick={() => setOpen((value) => !value)}>
          <Icon name="chevron-down" size={12} className={`collapse-chevron ${open ? 'open' : ''}`} />
          {layer.kind === 'adjustment' ? 'Ajuste no destructivo' : 'Ajustes'}
        </button>
        <div className="actions">
          <button className="icon-btn" title="Restablecer todo" onClick={() => resetAdjustments(activeId)}>
            <Icon name="reset" size={14} />
          </button>
        </div>
      </div>

      {open && <div className="adjust">
        <Slider label="Brillo" value={a.brightness} min={-1} max={1} step={0.01} defVal={0}
          scale={100} suffix="%" onStart={snapshotAdjustment} onCancel={undo}
          onChange={(v) => set({ brightness: v })} />
        <Slider label="Contraste" value={a.contrast} min={-1} max={1} step={0.01} defVal={0}
          scale={100} suffix="%" onStart={snapshotAdjustment} onCancel={undo}
          onChange={(v) => set({ contrast: v })} />
        <Slider label="Saturación" value={a.saturation} min={-1} max={1} step={0.01} defVal={0}
          scale={100} suffix="%" onStart={snapshotAdjustment} onCancel={undo}
          onChange={(v) => set({ saturation: v })} />
        <Slider label="Gama" value={a.gamma} min={0.2} max={3} step={0.01} defVal={1}
          decimals={2} onStart={snapshotAdjustment} onCancel={undo}
          onChange={(v) => set({ gamma: v })} />
        <Slider label="Tono (Hue)" value={a.hue} min={-180} max={180} step={1} defVal={0}
          suffix="°" onStart={snapshotAdjustment} onCancel={undo}
          onChange={(v) => set({ hue: v })} />

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
      </div>}
    </div>
  );
}
