import { useState } from 'react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editorStore';
import { useSettings } from '../../store/settingsStore';
import { pxToUnit, unitToPx } from '../../engine/units';
import type { Unit } from '../../types';

export function ResizeDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const resizeTo = useEditor((s) => s.resizeTo);
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
    unit === 'px' ? String(Math.round(px)) : String(parseFloat(pxToUnit(px, unit, ppi).toFixed(2)));

  const changeW = (raw: string) => {
    const val = unitToPx(parseFloat(raw) || 0, unit, ppi);
    setW(val);
    if (lock) setH(Math.max(1, val / ratio));
  };
  const changeH = (raw: string) => {
    const val = unitToPx(parseFloat(raw) || 0, unit, ppi);
    setH(val);
    if (lock) setW(Math.max(1, val * ratio));
  };

  const apply = () => {
    if (w >= 1 && h >= 1) resizeTo(Math.round(w), Math.round(h));
    onClose();
  };

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
      <div className="field-row">
        <label>Ancho</label>
        <div>
          <input className="num-input" type="number" min={0} step={unit === 'cm' ? 0.01 : 1}
            value={display(w)} onChange={(e) => changeW(e.target.value)} /> <span>{unit}</span>
        </div>
      </div>
      <div className="field-row">
        <label>Alto</label>
        <div>
          <input className="num-input" type="number" min={0} step={unit === 'cm' ? 0.01 : 1}
            value={display(h)} onChange={(e) => changeH(e.target.value)} /> <span>{unit}</span>
        </div>
      </div>
      {unit === 'cm' && (
        <div className="field-row">
          <label>Resolución</label>
          <div>
            <input className="num-input" type="number" min={1} max={2400} value={ppi}
              onChange={(e) => setPpi(parseInt(e.target.value) || 96)} /> <span>ppi</span>
          </div>
        </div>
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
