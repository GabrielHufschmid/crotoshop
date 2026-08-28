import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import {
  ACTIONS, comboFromEvent, comboLabel, useSettings,
} from '../../store/settingsStore';
import type { Unit } from '../../types';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const unit = useSettings((s) => s.unit);
  const ppi = useSettings((s) => s.ppi);
  const bindings = useSettings((s) => s.bindings);
  const setUnit = useSettings((s) => s.setUnit);
  const setPpi = useSettings((s) => s.setPpi);
  const setBinding = useSettings((s) => s.setBinding);
  const resetBindings = useSettings((s) => s.resetBindings);

  const [capturing, setCapturing] = useState<string | null>(null);

  // While capturing, the next keydown becomes the new binding.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); return; }
      const combo = comboFromEvent(e);
      if (!combo) return; // bare modifier — keep waiting
      setBinding(capturing, combo);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturing, setBinding]);

  return (
    <Modal
      title="Opciones"
      width={440}
      onClose={onClose}
      footer={<button className="tbtn primary" onClick={onClose}>Listo</button>}
    >
      <div className="subhead" style={{ margin: 0 }}>General</div>
      <div className="field-row">
        <label>Unidad de medida</label>
        <select className="text-input" style={{ width: 90 }}
          value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          <option value="px">px</option>
          <option value="cm">cm</option>
        </select>
      </div>
      <div className="field-row">
        <label>Resolución de trabajo</label>
        <div>
          <input className="num-input" type="number" min={1} max={2400} value={ppi}
            onChange={(e) => setPpi(parseInt(e.target.value) || 96)} /> <span>ppi</span>
        </div>
      </div>

      <div className="subhead" style={{ marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Atajos de teclado
        <button className="link" style={{ fontSize: 11, textTransform: 'none', letterSpacing: 0 }}
          onClick={resetBindings}>
          Restaurar predeterminados
        </button>
      </div>
      <div className="hint-sub" style={{ marginTop: -8 }}>
        Hacé click en un atajo y presioná la combinación nueva. Esc cancela.
      </div>
      <div className="bindings-list">
        {ACTIONS.map((a) => {
          const combo = bindings[a.id];
          const isCapturing = capturing === a.id;
          return (
            <div key={a.id} className="binding-row">
              <span>{a.label}</span>
              <button
                className={`kbd-btn ${isCapturing ? 'capturing' : ''}`}
                onClick={() => setCapturing(isCapturing ? null : a.id)}
              >
                {isCapturing ? 'Presioná una tecla…' : combo ? comboLabel(combo) : '—'}
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
