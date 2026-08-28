import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { useSettings } from '../store/settingsStore';
import { formatDim } from '../engine/units';
import { Icon } from './Icons';

interface Props {
  onNew: () => void;
  onImport: () => void;
  onAddLayer: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onExport: () => void;
  onResize: () => void;
  onTrim: () => void;
  onRemoveBg: () => void;
  onSettings: () => void;
  onCommands: () => void;
  onTogglePanel: () => void;
}

export function TopBar({
  onNew, onImport, onAddLayer, onOpenProject, onSaveProject, onExport, onResize, onTrim, onRemoveBg, onSettings, onCommands, onTogglePanel,
}: Props) {
  const [openMenu, setOpenMenu] = useState<'file' | 'image' | 'view' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const doc = useEditor((s) => s.doc);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const saveCanvasConfig = useEditor((s) => s.saveCanvasConfig);
  const loadCanvasConfig = useEditor((s) => s.loadCanvasConfig);
  const alignActiveLayer = useEditor((s) => s.alignActiveLayer);
  const distributeLayers = useEditor((s) => s.distributeLayers);
  const unit = useSettings((s) => s.unit);
  const ppi = useSettings((s) => s.ppi);
  const showGuides = useSettings((s) => s.showGuides);
  const toggleGuides = useSettings((s) => s.toggleGuides);
  const snappingEnabled = useSettings((s) => s.snappingEnabled);
  const setSnappingEnabled = useSettings((s) => s.setSnappingEnabled);

  useEffect(() => {
    if (!openMenu) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const menuAction = (fn: () => void) => () => {
    setOpenMenu(null);
    fn();
  };

  return (
    <div className="topbar">
      <div className="brand"><span className="dot" /> <span className="btn-label">crotoshop</span></div>

      <div className="topbar-menus" ref={menuRef}>
        <div className="topbar-menu">
          <button
            className={`tbtn menu-trigger ${openMenu === 'file' ? 'toggled' : ''}`}
            onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
            title="Archivo"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'file'}
          >
            <Icon name="doc-file" size={15} /> <span className="btn-label">Archivo</span> <span className="menu-caret" />
          </button>
          {openMenu === 'file' && (
            <div className="topbar-dropdown" data-ui role="menu" aria-label="Archivo">
              <button onClick={menuAction(onNew)}>
                <Icon name="plus" size={16} />
                <span>Nuevo archivo</span>
              </button>
              <button onClick={menuAction(onImport)}>
                <Icon name="open" size={16} />
                <span>Abrir imagen</span>
                <kbd>⌘O</kbd>
              </button>
              <button onClick={menuAction(onAddLayer)} disabled={!doc}>
                <Icon name="plus" size={16} />
                <span>Nueva capa transparente</span>
              </button>
              <div className="menu-line" />
              <button onClick={menuAction(onOpenProject)}>
                <Icon name="project" size={16} />
                <span>Abrir proyecto</span>
              </button>
              <button onClick={menuAction(onSaveProject)} disabled={!doc}>
                <Icon name="save" size={16} />
                <span>Guardar proyecto</span>
              </button>
              <div className="menu-line" />
              <button onClick={menuAction(onExport)} disabled={!doc}>
                <Icon name="export" size={16} />
                <span>Exportar</span>
                <kbd>⌘S</kbd>
              </button>
            </div>
          )}
        </div>

        <div className="topbar-menu">
          <button
            className={`tbtn menu-trigger ${openMenu === 'image' ? 'toggled' : ''}`}
            onClick={() => setOpenMenu(openMenu === 'image' ? null : 'image')}
            disabled={!doc}
            title="Imagen"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'image'}
          >
            <Icon name="image-plus" size={15} /> <span className="btn-label">Imagen</span> <span className="menu-caret" />
          </button>
          {openMenu === 'image' && (
            <div className="topbar-dropdown" data-ui role="menu" aria-label="Imagen">
              <button onClick={menuAction(onResize)}>
                <span>Redimensionar lienzo</span>
              </button>
              <button onClick={menuAction(onTrim)}>
                <Icon name="trim" size={16} />
                <span>Recortar transparencia</span>
              </button>
              <button onClick={menuAction(onRemoveBg)}>
                <Icon name="bg" size={16} />
                <span>Quitar fondo</span>
              </button>
            </div>
          )}
        </div>

        <div className="topbar-menu">
          <button
            className={`tbtn menu-trigger ${openMenu === 'view' ? 'toggled' : ''}`}
            onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
            disabled={!doc}
            title="Vista"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'view'}
          >
            <Icon name="eye" size={15} /> <span className="btn-label">Vista</span> <span className="menu-caret" />
          </button>
          {openMenu === 'view' && (
            <div className="topbar-dropdown" data-ui role="menu" aria-label="Vista">
              <button onClick={menuAction(toggleGuides)}>
                <Icon name="ruler" size={16} />
                <span>{showGuides ? 'Ocultar reglas y guías' : 'Mostrar reglas y guías'}</span>
                <kbd>⌘;</kbd>
              </button>
              <button onClick={menuAction(saveCanvasConfig)}>
                <Icon name="save" size={16} />
                <span>Guardar configuración del lienzo</span>
              </button>
              <button onClick={menuAction(loadCanvasConfig)}>
                <Icon name="project" size={16} />
                <span>Cargar configuración del lienzo</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="sep" />
      <button className="tbtn icon" onClick={undo} disabled={!canUndo} title="Deshacer (⌘Z)">
        <Icon name="undo" size={16} />
      </button>
      <button className="tbtn icon" onClick={redo} disabled={!canRedo} title="Rehacer (⌘⇧Z)">
        <Icon name="redo" size={16} />
      </button>

      <div className="sep desktop-only" />
      <div className="toolbar-group desktop-only" title="Alineación">
        <button className="tbtn icon" onClick={() => alignActiveLayer('left')} disabled={!doc} title="Alinear a la izquierda">
          <Icon name="align-left" size={16} />
        </button>
        <button className="tbtn icon" onClick={() => alignActiveLayer('centerH')} disabled={!doc} title="Centrar horizontal">
          <Icon name="align-center-h" size={16} />
        </button>
        <button className="tbtn icon" onClick={() => alignActiveLayer('right')} disabled={!doc} title="Alinear a la derecha">
          <Icon name="align-right" size={16} />
        </button>
        <button className="tbtn icon" onClick={() => alignActiveLayer('top')} disabled={!doc} title="Alinear arriba">
          <Icon name="align-top" size={16} />
        </button>
        <button className="tbtn icon" onClick={() => alignActiveLayer('centerV')} disabled={!doc} title="Centrar vertical">
          <Icon name="align-center-v" size={16} />
        </button>
        <button className="tbtn icon" onClick={() => alignActiveLayer('bottom')} disabled={!doc} title="Alinear abajo">
          <Icon name="align-bottom" size={16} />
        </button>
        <button className="tbtn icon" onClick={() => distributeLayers('x')} disabled={!doc} title="Distribuir horizontal">
          <Icon name="distribute-horizontal" size={16} />
        </button>
        <button className="tbtn icon" onClick={() => distributeLayers('y')} disabled={!doc} title="Distribuir vertical">
          <Icon name="distribute-vertical" size={16} />
        </button>
      </div>

      <div className="sep desktop-only" />
      <div className="toolbar-group view-group desktop-only" title="Vista y guías">
        <button
          className={`tbtn icon ${showGuides ? 'toggled' : ''}`}
          onClick={toggleGuides}
          title={showGuides ? 'Ocultar reglas y guías (⌘;)' : 'Ver reglas y guías (⌘;)'}
        >
          <Icon name="ruler" size={16} />
        </button>
        <label className="topbar-check" title="Activar snapping a guías">
          <input
            type="checkbox"
            checked={snappingEnabled}
            onChange={(e) => setSnappingEnabled(e.target.checked)}
          />
          Snap
        </label>
      </div>

      <div className="spacer" />

      {doc && (
        <span className="doc-size">
          {formatDim(doc.width, unit, ppi)} × {formatDim(doc.height, unit, ppi)}{unit}
        </span>
      )}
      <button className="tbtn" onClick={onResize} disabled={!doc} title="Redimensionar lienzo">
        <Icon name="resize" size={16} /> <span className="btn-label">Redimensionar</span>
      </button>
      <button className="tbtn desktop-only" onClick={onRemoveBg} disabled={!doc}>
        <Icon name="bg" size={16} /> <span className="btn-label">Quitar fondo</span>
      </button>
      <button className="tbtn primary" onClick={onExport} disabled={!doc} title="Exportar (⌘S)">
        <Icon name="export" size={16} /> <span className="btn-label">Exportar</span>
      </button>
      <button className="tbtn icon mobile-only" onClick={onTogglePanel} title="Capas y ajustes">
        <Icon name="panel" size={16} />
      </button>
      <button className="tbtn icon" onClick={onCommands} title="Comandos (⌘K)"><Icon name="command" size={16} /></button>
      <button className="tbtn icon" onClick={onSettings} title="Opciones">
        <Icon name="gear" size={16} />
      </button>
    </div>
  );
}
