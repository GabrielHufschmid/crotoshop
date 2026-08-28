import { useState } from 'react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editorStore';
import { useSettings } from '../../store/settingsStore';
import { pxToUnit, unitToPx } from '../../engine/units';
import type { Unit } from '../../types';
import { canvasLimitMessage, isCanvasSizeAllowed, MAX_CANVAS_DIMENSION } from '../../engine/canvasLimits';
import { NumericControl } from '../NumericControl';

export function ResizeDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const resizeTo = useEditor((s) => s.resizeTo);
  const toast = useEditor((s) => s.toast);
  const globalUnit = useSettings((s) => s.unit);
  const ppi = useSettings((s) => s.ppi);
  const setPpi = useSettings((s) => s.setPpi);

  const [unit, setUnit] = useState<Unit>(globalUnit);
  const [w, setW] = useState(doc?.width ?? 0);   // always px internally
  const [h, setH] = useState(doc?.height ?? 0);
  const [lock, setLock] = useState(true);

  if (!doc) return null;
  const ratio = doc.width / doc.height;

  const display = (px: number) =>
    unit === 'px' ? Math.round(px) : parseFloat(pxToUnit(px, unit, ppi).toFixed(2));

  const changeW = (raw: number) => {
    const val = unitToPx(raw, unit, ppi);
    setW(val);
    if (lock) setH(Math.max(1, val / ratio));
  };
  const changeH = (raw: number) => {
    const val = unitToPx(raw, unit, ppi);
    setH(val);
    if (lock) setW(Math.max(1, val * ratio));
  };

  const apply = () => {
    const width = Math.round(w);
    const height = Math.round(h);
    if (!isCanvasSizeAllowed(width, height)) {
      toast(canvasLimitMessage(width, height), 'error');
      return;
    }
    resizeTo(width, height);
    onClose();
  };

  const maxDisplay = unit === 'px'
    ? MAX_CANVAS_DIMENSION
    : pxToUnit(MAX_CANVAS_DIMENSION, unit, ppi);

  return (
    <Modal
      title="Redimensionar documento"
      onClose={onClose}
      footer={
        <>
          <button className="tbtn" onClick={onClose}>Cancelar</button>
          <button className="tbtn primary" onClick={apply}>Aplicar</button>
        </>
      }
    >
      <div className="field-row">
        <label>Unidad</label>
        <select className="text-input" style={{ width: 90 }}
          value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          <option value="px">px</option>
          <option value="cm">cm</option>
        </select>
      </div>
      <NumericControl className="dialog-numeric" label="Ancho" value={display(w)}
        min={unit === 'px' ? 1 : 0.01} max={maxDisplay} step={unit === 'cm' ? 0.01 : 1}
        decimals={unit === 'cm' ? 2 : 0} suffix={unit} onChange={changeW} />
      <NumericControl className="dialog-numeric" label="Alto" value={display(h)}
        min={unit === 'px' ? 1 : 0.01} max={maxDisplay} step={unit === 'cm' ? 0.01 : 1}
        decimals={unit === 'cm' ? 2 : 0} suffix={unit} onChange={changeH} />
      {unit === 'cm' && (
        <NumericControl className="dialog-numeric" label="Resolución" value={ppi}
          min={1} max={2400} step={1} suffix="ppi" onChange={setPpi} />
      )}
      <label className="checkbox">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
        Mantener proporción
      </label>
      <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
        Actual: {doc.width} × {doc.height}px · Resultado: {Math.round(w)} × {Math.round(h)}px
      </div>
    </Modal>
  );
}
