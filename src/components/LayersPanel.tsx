import { useState } from 'react';
import { useEditor } from '../store/editorStore';
import { Icon } from './Icons';
import type { BlendMode, Layer } from '../types';

const BLENDS: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' }, { value: 'multiply', label: 'Multiplicar' },
  { value: 'screen', label: 'Trama' }, { value: 'overlay', label: 'Superponer' },
  { value: 'soft-light', label: 'Luz suave' }, { value: 'hard-light', label: 'Luz fuerte' },
  { value: 'darken', label: 'Oscurecer' }, { value: 'lighten', label: 'Aclarar' },
  { value: 'color-dodge', label: 'Sobreexponer color' }, { value: 'color-burn', label: 'Subexponer color' },
  { value: 'difference', label: 'Diferencia' }, { value: 'exclusion', label: 'Exclusión' },
  { value: 'hue', label: 'Tono' }, { value: 'saturation', label: 'Saturación' },
  { value: 'color', label: 'Color' }, { value: 'luminosity', label: 'Luminosidad' },
];

const TAGS = ['#ef5350', '#ffb300', '#66bb6a', '#42a5f5', '#ab47bc'];
const LAYER_MENU_WIDTH = 188;
const LAYER_MENU_HEIGHT = 202;
const LAYER_MENU_MARGIN = 8;

function kindLabel(layer: Layer): string | null {
  if (layer.kind === 'group') return 'G';
  if (layer.kind === 'adjustment') return 'A';
  if (layer.vector) return 'V';
  if (layer.text) return 'T';
  return null;
}

export function LayersPanel({ onAddLayer }: { onAddLayer: () => void }) {
  const doc = useEditor((s) => s.doc);
  const selectLayer = useEditor((s) => s.selectLayer);
  const selectedLayerIds = useEditor((s) => s.selectedLayerIds);
  const toggleVisible = useEditor((s) => s.toggleVisible);
  const removeLayer = useEditor((s) => s.removeLayer);
  const renameLayer = useEditor((s) => s.renameLayer);
  const reorderLayer = useEditor((s) => s.reorderLayer);
  const setOpacity = useEditor((s) => s.setOpacity);
  const snapshot = useEditor((s) => s.snapshot);
  const rasterizeLayer = useEditor((s) => s.rasterizeLayer);
  const updateSvgVectorColors = useEditor((s) => s.updateSvgVectorColors);
  const setLayerRotation = useEditor((s) => s.setLayerRotation);
  const flipLayer = useEditor((s) => s.flipLayer);
  const setLayerBounds = useEditor((s) => s.setLayerBounds);
  const setBlendMode = useEditor((s) => s.setBlendMode);
  const toggleLock = useEditor((s) => s.toggleLock);
  const setLayerColorTag = useEditor((s) => s.setLayerColorTag);
  const addLayerMask = useEditor((s) => s.addLayerMask);
  const setMaskEnabled = useEditor((s) => s.setMaskEnabled);
  const maskTargetId = useEditor((s) => s.maskTargetId);
  const setMaskTarget = useEditor((s) => s.setMaskTarget);
  const addGroup = useEditor((s) => s.addGroup);
  const addAdjustmentLayer = useEditor((s) => s.addAdjustmentLayer);
  const setLayerParent = useEditor((s) => s.setLayerParent);
  const addArtboard = useEditor((s) => s.addArtboard);
  const updateArtboard = useEditor((s) => s.updateArtboard);
  const removeArtboard = useEditor((s) => s.removeArtboard);

  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [artboardsOpen, setArtboardsOpen] = useState(false);

  const layers = doc?.layers ?? [];
  const display = [...layers].reverse();
  const active = doc?.activeId ? layers.find((l) => l.id === doc.activeId) ?? null : null;
  const menuLayer = menu ? layers.find((layer) => layer.id === menu.id) ?? null : null;
  const groups = layers.filter((l) => l.kind === 'group');
  const commitRename = () => {
    if (editing?.value.trim()) renameLayer(editing.id, editing.value.trim());
    setEditing(null);
  };
  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const targetDisplayIndex = display.findIndex((l) => l.id === targetId);
    reorderLayer(dragId, layers.length - 1 - targetDisplayIndex);
    setDragId(null); setOverId(null);
  };
  const setBound = (key: 'x' | 'y' | 'w' | 'h', raw: string) => {
    if (!active) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setLayerBounds(active.id, {
      x: key === 'x' ? n : active.x,
      y: key === 'y' ? n : active.y,
      w: key === 'w' ? Math.max(1, n) : active.w ?? active.canvas.width,
      h: key === 'h' ? Math.max(1, n) : active.h ?? active.canvas.height,
    });
  };

  return (
    <div className="panel layers" onPointerDown={() => setMenu(null)}>
      <div className="panel-head">
        Capas
        <div className="actions">
          <button className="icon-btn" title="Nueva capa transparente" disabled={!doc} onClick={onAddLayer}><Icon name="plus" size={15} /></button>
          <button className="icon-btn" title="Nuevo grupo" disabled={!doc} onClick={addGroup}><Icon name="folder" size={15} /></button>
          <button className="icon-btn" title="Nueva capa de ajuste" disabled={!doc} onClick={addAdjustmentLayer}><Icon name="adjust" size={15} /></button>
          <button className="icon-btn danger" title="Eliminar capa" disabled={!active} onClick={() => active && removeLayer(active.id)}><Icon name="trash" size={15} /></button>
        </div>
      </div>

      <div className="layer-list" role="listbox" aria-label="Capas" aria-multiselectable="true">
        {!display.length && <div className="hint-empty">Sin capas todavía.</div>}
        {display.map((layer) => {
          const label = kindLabel(layer);
          return (
            <div key={layer.id}
              className={['layer', layer.id === active?.id ? 'active' : '', selectedLayerIds.includes(layer.id) ? 'selected' : '', layer.visible ? '' : 'hidden', overId === layer.id ? 'dragover' : ''].join(' ')}
              style={{ paddingLeft: layer.parentId ? 22 : 6, borderLeftColor: layer.colorTag ?? 'transparent' }}
              draggable onDragStart={() => setDragId(layer.id)} onDragOver={(e) => { e.preventDefault(); setOverId(layer.id); }}
              onDragLeave={() => setOverId((id) => id === layer.id ? null : id)} onDrop={() => onDrop(layer.id)}
              role="option" aria-selected={selectedLayerIds.includes(layer.id)} tabIndex={0}
              onClick={(e) => selectLayer(layer.id, e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'replace')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLayer(layer.id, e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'replace'); } }}
              onContextMenu={(e) => {
                e.preventDefault();
                selectLayer(layer.id);
                setMenu({
                  id: layer.id,
                  x: Math.max(LAYER_MENU_MARGIN, Math.min(e.clientX, window.innerWidth - LAYER_MENU_WIDTH - LAYER_MENU_MARGIN)),
                  y: Math.max(LAYER_MENU_MARGIN, Math.min(e.clientY, window.innerHeight - LAYER_MENU_HEIGHT - LAYER_MENU_MARGIN)),
                });
              }}>
              <button className="vis" title={layer.visible ? 'Ocultar' : 'Mostrar'} onClick={(e) => { e.stopPropagation(); toggleVisible(layer.id); }}><Icon name={layer.visible ? 'eye' : 'eye-off'} size={16} /></button>
              <img className="thumb" src={layer.thumb} alt="" draggable={false} />
              {label && <span className="layer-kind">{label}</span>}
              {layer.mask && <button className={`mask-mini ${maskTargetId === layer.id ? 'editing' : ''} ${layer.mask.enabled ? '' : 'off'}`} title="Editar máscara" onClick={(e) => { e.stopPropagation(); setMaskTarget(maskTargetId === layer.id ? null : layer.id); }} />}
              {editing?.id === layer.id ? <input className="layer-name-input" autoFocus value={editing.value} onChange={(e) => setEditing({ id: layer.id, value: e.target.value })} onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(null); }} onClick={(e) => e.stopPropagation()} />
                : <span className="layer-name" onDoubleClick={(e) => { e.stopPropagation(); setEditing({ id: layer.id, value: layer.name }); }}>{layer.name}</span>}
              {(layer.locked || layer.lockPixels) && <Icon name="lock" size={13} />}
              <span className="grip"><Icon name="grip" size={16} /></span>
            </div>
          );
        })}
      </div>

      {active && (
        <div className="layer-props properties-panel">
          <div className="field-row compact"><span>Modo</span><select className="text-input" value={active.blendMode ?? 'source-over'} onChange={(e) => setBlendMode(active.id, e.target.value as BlendMode)}>{BLENDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select></div>
          <div className="opacity-bar"><span>Opacidad</span><input type="range" min={0} max={1} step={0.01} value={active.opacity} onPointerDown={() => snapshot('Cambiar opacidad')} onChange={(e) => setOpacity(active.id, Number(e.target.value))} /><span>{Math.round(active.opacity * 100)}%</span></div>
          {active.kind !== 'group' && active.kind !== 'adjustment' && <div className="prop-grid">
            {(['x', 'y', 'w', 'h'] as const).map((key) => <label key={key}>{key.toUpperCase()}<input className="num-input" type="number" value={Math.round(key === 'x' ? active.x : key === 'y' ? active.y : key === 'w' ? active.w ?? active.canvas.width : active.h ?? active.canvas.height)} onPointerDown={() => snapshot('Transformar capa')} onChange={(e) => setBound(key, e.target.value)} /></label>)}
          </div>}
          <div className="field-row compact"><span>Rotación</span><input className="num-input" type="number" value={Math.round(((active.rotation ?? 0) * 180) / Math.PI)} onPointerDown={() => snapshot('Rotar capa')} onChange={(e) => setLayerRotation(active.id, (Number(e.target.value) || 0) * Math.PI / 180)} /></div>
          <div className="layer-actions">
            <button className={`icon-btn ${active.locked ? 'on' : ''}`} title="Bloquear transformación" onClick={() => toggleLock(active.id)}><Icon name="lock" size={14} /></button>
            <button className={`icon-btn ${active.lockPixels ? 'on' : ''}`} title="Bloquear píxeles" onClick={() => toggleLock(active.id, true)}><Icon name="lock-pixels" size={14} /></button>
            <button className="icon-btn" title="Agregar máscara" disabled={!!active.mask || active.kind === 'group' || active.kind === 'adjustment'} onClick={() => addLayerMask(active.id)}><Icon name="mask" size={14} /></button>
            {active.mask && <label className="mask-enabled" title="Activar máscara"><input type="checkbox" checked={active.mask.enabled} onChange={(e) => setMaskEnabled(active.id, e.target.checked)} /> Máscara</label>}
            {TAGS.map((color) => <button key={color} className={`tag-dot ${active.colorTag === color ? 'on' : ''}`} style={{ background: color }} title="Etiqueta de capa" onClick={() => setLayerColorTag(active.id, active.colorTag === color ? undefined : color)} />)}
          </div>
          {groups.length > 0 && active.kind !== 'group' && <div className="field-row compact"><span>Grupo</span><select className="text-input" value={active.parentId ?? ''} onChange={(e) => setLayerParent(active.id, e.target.value || undefined)}><option value="">Sin grupo</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>}
        </div>
      )}

      {active?.vector && <div className="vector-inspector"><div className="subhead" style={{ margin: '0 0 8px' }}>Vector</div>{active.vector.svgText && <div className="field-row compact"><span>Relleno</span><input type="color" onChange={(e) => void updateSvgVectorColors(active.id, e.target.value)} /></div>}<button className="tbtn" onClick={() => void rasterizeLayer(active.id)}>Rasterizar capa</button></div>}

      {doc && <div className="artboards">
        <div className="subhead">
          <button className="collapse-trigger" onClick={() => setArtboardsOpen((o) => !o)}>
            <Icon name="chevron-down" size={12} className={`collapse-chevron ${artboardsOpen ? 'open' : ''}`} />
            Mesas de trabajo
          </button>
          <button className="icon-btn" title="Agregar mesa" onClick={() => { setArtboardsOpen(true); addArtboard({ name: `Mesa ${(doc.artboards?.length ?? 0) + 1}`, x: 0, y: 0, w: Math.min(1080, doc.width), h: Math.min(1080, doc.height) }); }}><Icon name="artboard" size={14} /></button>
        </div>
        <div className={`collapse-body ${artboardsOpen ? 'open' : ''}`}><div>
          <div className="artboard-list">
            {(doc.artboards ?? []).map((b) => <div className="artboard-row" key={b.id}><input className="text-input" value={b.name} onFocus={() => snapshot('Editar mesa de trabajo')} onChange={(e) => updateArtboard(b.id, { name: e.target.value })} /><span>{Math.round(b.w)}×{Math.round(b.h)}</span><button className="icon-btn danger" title="Eliminar mesa" onClick={() => removeArtboard(b.id)}><Icon name="trash" size={13} /></button></div>)}
          </div>
        </div></div>
      </div>}

      {menu && <div className="layer-menu" data-ui style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => { addLayerMask(menu.id); setMenu(null); }}>Agregar máscara</button>
        <button onClick={() => { const layer = layers.find((l) => l.id === menu.id); if (layer?.vector) void rasterizeLayer(menu.id); setMenu(null); }} disabled={!layers.find((l) => l.id === menu.id)?.vector}>Rasterizar</button>
        <button onClick={() => { flipLayer(menu.id, 'horizontal'); setMenu(null); }} disabled={menuLayer?.kind === 'adjustment' || menuLayer?.locked}>Espejar horizontalmente</button>
        <button onClick={() => { flipLayer(menu.id, 'vertical'); setMenu(null); }} disabled={menuLayer?.kind === 'adjustment' || menuLayer?.locked}>Espejar verticalmente</button>
        <button onClick={() => { toggleLock(menu.id); setMenu(null); }}>Bloquear / desbloquear</button>
        <button onClick={() => { removeLayer(menu.id); setMenu(null); }}>Eliminar capa</button>
      </div>}
    </div>
  );
}
