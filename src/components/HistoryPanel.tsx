import { useState } from 'react';
import { useEditor } from '../store/editorStore';
import { Icon } from './Icons';

export function HistoryPanel() {
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const jumpToHistory = useEditor((s) => s.jumpToHistory);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const [open, setOpen] = useState(false);
  return <div className="history-panel">
    <div className="subhead">
      <button className="collapse-trigger" onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron-down" size={12} className={`collapse-chevron ${open ? 'open' : ''}`} />
        Historial <span>{past.length + 1 + future.length} estados</span>
      </button>
      <div className="actions"><button className="icon-btn" onClick={undo} disabled={!past.length} title="Deshacer"><Icon name="undo" size={13} /></button><button className="icon-btn" onClick={redo} disabled={!future.length} title="Rehacer"><Icon name="redo" size={13} /></button></div>
    </div>
    <div className={`collapse-body ${open ? 'open' : ''}`}><div>
      <div className="history-list">
        {past.slice(-8).map((entry, localIndex) => {
          const index = Math.max(0, past.length - 8) + localIndex;
          return <button key={index} onClick={() => jumpToHistory(index)} title={`Volver a: ${entry.label}`}>{entry.label}</button>;
        })}
        <div className="history-current">Estado actual</div>
        {future.length > 0 && <div className="history-future">{future.length} estado{future.length === 1 ? '' : 's'} adelante</div>}
      </div>
    </div></div>
  </div>;
}
