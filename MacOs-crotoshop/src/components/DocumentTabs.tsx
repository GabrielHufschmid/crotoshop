import { useEditor } from '../store/editorStore';
import { Icon } from './Icons';

export function DocumentTabs({ onNew, onRequestClose }: { onNew: () => void; onRequestClose: (id: string) => void }) {
  const tabs = useEditor((s) => s.tabs);
  const activeId = useEditor((s) => s.activeTabId);
  const activeDirty = useEditor((s) => s.dirty);
  const switchTab = useEditor((s) => s.switchTab);

  return (
    <div className="doc-tabs" data-ui>
      <div className="doc-tab-list">
        {tabs.map((tab) => {
          const dirty = tab.id === activeId ? activeDirty : tab.dirty;
          return <div key={tab.id} className={`doc-tab ${tab.id === activeId ? 'active' : ''}`}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onRequestClose(tab.id); } }}>
            <button className="doc-tab-select" onClick={() => switchTab(tab.id)} title={tab.name} aria-current={tab.id === activeId ? 'page' : undefined}>
              <span>{tab.name}</span>
              {dirty && <i className="doc-tab-dirty" title="Cambios sin guardar" />}
            </button>
            <button className="doc-tab-close" onClick={() => onRequestClose(tab.id)} title={`Cerrar ${tab.name}`} aria-label={`Cerrar ${tab.name}`}>
              <Icon name="close" size={12} />
            </button>
          </div>;
        })}
      </div>
      <button className="doc-tab-new" onClick={onNew} title="Nuevo archivo">
        <Icon name="plus" size={15} />
      </button>
    </div>
  );
}
