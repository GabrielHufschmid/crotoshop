import { useEditor } from '../store/editorStore';
import { Icon } from './Icons';

export function DocumentTabs({ onNew }: { onNew: () => void }) {
  const tabs = useEditor((s) => s.tabs);
  const activeId = useEditor((s) => s.activeTabId);
  const activeDirty = useEditor((s) => s.dirty);
  const switchTab = useEditor((s) => s.switchTab);
  const closeTab = useEditor((s) => s.closeTab);

  return (
    <div className="doc-tabs" data-ui>
      <div className="doc-tab-list">
        {tabs.map((tab) => {
          const dirty = tab.id === activeId ? activeDirty : tab.dirty;
          const close = () => {
            if (dirty && !window.confirm(`“${tab.name}” tiene cambios sin guardar. ¿Cerrar igualmente?`)) return;
            closeTab(tab.id);
          };
          return <div key={tab.id} className={`doc-tab ${tab.id === activeId ? 'active' : ''}`}>
            <button className="doc-tab-select" onClick={() => switchTab(tab.id)} title={tab.name} aria-current={tab.id === activeId ? 'page' : undefined}>
              <span>{tab.name}</span>
              {dirty && <i className="doc-tab-dirty" title="Cambios sin guardar" />}
            </button>
            <button className="doc-tab-close" onClick={close} title={`Cerrar ${tab.name}`} aria-label={`Cerrar ${tab.name}`}>
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
