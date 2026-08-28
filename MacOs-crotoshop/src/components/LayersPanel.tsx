import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { DEFAULT_TEXT_SETTINGS, useSettings } from '../store/settingsStore';
import { Icon } from './Icons';
import { NumericControl } from './NumericControl';
import type { BlendMode, Layer } from '../types';
import { canvasVersion } from '../engine/canvasUtils';
import { DEFAULT_TEXT } from '../engine/text';
import { TextControls } from './TextControls';
import { VectorAppearanceEditor } from './VectorAppearanceEditor';
import { vectorGeometryBounds } from '../engine/vectorPath';

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
const LAYER_MENU_HEIGHT = 640;
const LAYER_MENU_MARGIN = 8;

function kindLabel(layer: Layer): string | null {
  if (layer.kind === 'group') return 'G';
  if (layer.kind === 'adjustment') return 'A';
  if (layer.vector) return 'V';
  if (layer.text) return 'T';
  return null;
}

function MaskThumbnail({
  source,
  version,
  enabled,
  editing,
  title,
  onClick,
}: {
  source: HTMLCanvasElement;
  version: number;
  enabled: boolean;
  editing: boolean;
  title: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [source, version]);

  return (
    <button
      className={`mask-mini ${editing ? 'editing' : ''} ${enabled ? '' : 'off'}`}
      title={title}
      aria-pressed={editing}
      onClick={onClick}
    >
      <canvas ref={canvasRef} width={52} height={64} aria-hidden="true" />
    </button>
  );
}

export function LayersPanel({
  onAddLayer,
  onEditText,
  onVectorize,
  textEditorOpen,
}: {
  onAddLayer: () => void;
  onEditText: (layerId: string) => void;
  onVectorize: (layerId: string) => void;
  textEditorOpen: boolean;
}) {
  const doc = useEditor((s) => s.doc);
  const selectLayer = useEditor((s) => s.selectLayer);
  const selectedLayerIds = useEditor((s) => s.selectedLayerIds);
  const tool = useEditor((s) => s.tool);
  const toggleVisible = useEditor((s) => s.toggleVisible);
  const toggleSelectedVisibility = useEditor((s) => s.toggleSelectedVisibility);
  const removeSelectedLayers = useEditor((s) => s.removeSelectedLayers);
  const renameLayer = useEditor((s) => s.renameLayer);
  const reorderLayer = useEditor((s) => s.reorderLayer);
  const setSelectedOpacity = useEditor((s) => s.setSelectedOpacity);
  const snapshot = useEditor((s) => s.snapshot);
  const undo = useEditor((s) => s.undo);
  const rasterizeLayer = useEditor((s) => s.rasterizeLayer);
  const updateSvgVectorColors = useEditor((s) => s.updateSvgVectorColors);
  const expandVectorLayer = useEditor((s) => s.expandVectorLayer);
  const convertTextToCurves = useEditor((s) => s.convertTextToCurves);
  const applyPathfinder = useEditor((s) => s.applyPathfinder);
  const setVectorStyle = useEditor((s) => s.setVectorStyle);
  const updateVectorPrimitive = useEditor((s) => s.updateVectorPrimitive);
  const roundVectorCorners = useEditor((s) => s.roundVectorCorners);
  const simplifyVectorLayer = useEditor((s) => s.simplifyVectorLayer);
  const makeCompoundPath = useEditor((s) => s.makeCompoundPath);
  const releaseCompoundPath = useEditor((s) => s.releaseCompoundPath);
  const setLayerRotation = useEditor((s) => s.setLayerRotation);
  const flipSelectedLayers = useEditor((s) => s.flipSelectedLayers);
  const setSelectedLayerBounds = useEditor((s) => s.setSelectedLayerBounds);
  const setSelectedBlendMode = useEditor((s) => s.setSelectedBlendMode);
  const setSelectedInterpolation = useEditor((s) => s.setSelectedInterpolation);
  const toggleSelectedLock = useEditor((s) => s.toggleSelectedLock);
  const setLayerColorTag = useEditor((s) => s.setLayerColorTag);
  const addLayerMask = useEditor((s) => s.addLayerMask);
  const setMaskEnabled = useEditor((s) => s.setMaskEnabled);
  const setMaskDensity = useEditor((s) => s.setMaskDensity);
  const setMaskFeather = useEditor((s) => s.setMaskFeather);
  const invertLayerMask = useEditor((s) => s.invertLayerMask);
  const applyLayerMask = useEditor((s) => s.applyLayerMask);
  const removeLayerMask = useEditor((s) => s.removeLayerMask);
  const maskTargetId = useEditor((s) => s.maskTargetId);
  const setMaskTarget = useEditor((s) => s.setMaskTarget);
  const setTool = useEditor((s) => s.setTool);
  const addGroup = useEditor((s) => s.addGroup);
  const duplicateSelectedLayers = useEditor((s) => s.duplicateSelectedLayers);
  const mergeDown = useEditor((s) => s.mergeDown);
  const mergeVisible = useEditor((s) => s.mergeVisible);
  const addAdjustmentLayer = useEditor((s) => s.addAdjustmentLayer);
  const setLayerParent = useEditor((s) => s.setLayerParent);
  const addArtboard = useEditor((s) => s.addArtboard);
  const updateArtboard = useEditor((s) => s.updateArtboard);
  const removeArtboard = useEditor((s) => s.removeArtboard);
  const selection = useEditor((s) => s.selection);
  const saveSelectionChannel = useEditor((s) => s.saveSelectionChannel);
  const loadSelectionChannel = useEditor((s) => s.loadSelectionChannel);
  const renameSelectionChannel = useEditor((s) => s.renameSelectionChannel);
  const removeSelectionChannel = useEditor((s) => s.removeSelectionChannel);
  const updateTextLayer = useEditor((s) => s.updateTextLayer);
  const setTextDefaults = useSettings((s) => s.setTextDefaults);
  const vectorCornerRadius = useSettings((s) => s.toolDefaults.vectorCornerRadius);
  const vectorSimplifyTolerance = useSettings((s) => s.toolDefaults.vectorSimplifyTolerance);
  const setToolDefaults = useSettings((s) => s.setToolDefaults);

  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [artboardsOpen, setArtboardsOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<{ id: string; value: string } | null>(null);
  const [lockAspect, setLockAspect] = useState(true);
  const [textOpen, setTextOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<'layer' | 'vector'>('layer');
  const previousTextLayerRef = useRef<string | null>(null);
  const previousVectorLayerRef = useRef<string | null>(null);

  const layers = doc?.layers ?? [];
  const display = [...layers].reverse();
  const active = doc?.activeId ? layers.find((l) => l.id === doc.activeId) ?? null : null;
  const menuLayer = menu ? layers.find((layer) => layer.id === menu.id) ?? null : null;
  const groups = layers.filter((l) => l.kind === 'group');
  const selected = layers.filter((layer) => selectedLayerIds.includes(layer.id));
  const transformable = selected.filter((layer) => layer.kind !== 'group' && layer.kind !== 'adjustment');
  const geometry = transformable.length ? {
    x: Math.min(...transformable.map((layer) => layer.x)),
    y: Math.min(...transformable.map((layer) => layer.y)),
    w: Math.max(...transformable.map((layer) => layer.x + (layer.w ?? layer.canvas.width))) - Math.min(...transformable.map((layer) => layer.x)),
    h: Math.max(...transformable.map((layer) => layer.y + (layer.h ?? layer.canvas.height))) - Math.min(...transformable.map((layer) => layer.y)),
  } : null;
  const selectedCount = selected.length;
  const selectedEditableVectors = selected.filter((layer) => layer.vector?.kind === 'editable').length;
  const activeVectorPathCount = active?.vector?.kind === 'editable'
    ? active.vector.shapes?.reduce((total, shape) => total + shape.subpaths.length, 0) ?? 0
    : 0;
  const menuVectorPathCount = menuLayer?.vector?.kind === 'editable'
    ? menuLayer.vector.shapes?.reduce((total, shape) => total + shape.subpaths.length, 0) ?? 0
    : 0;
  useEffect(() => {
    const nextTextId = selectedCount === 1 && active?.text ? active.id : null;
    if (nextTextId && nextTextId !== previousTextLayerRef.current) setTextOpen(true);
    previousTextLayerRef.current = nextTextId;
  }, [active?.id, active?.text, selectedCount]);
  useEffect(() => {
    const nextVectorId = selectedCount === 1 && active?.vector ? active.id : null;
    if (nextVectorId && nextVectorId !== previousVectorLayerRef.current) setInspectorTab('vector');
    if (!nextVectorId) setInspectorTab('layer');
    previousVectorLayerRef.current = nextVectorId;
  }, [active?.id, active?.vector, selectedCount]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);
  const commitRename = () => {
    if (editing?.value.trim()) renameLayer(editing.id, editing.value.trim());
    setEditing(null);
  };
  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId || !over) { setDragId(null); setOver(null); return; }
    const nextDisplay = display.filter((layer) => layer.id !== dragId);
    const targetDisplayIndex = nextDisplay.findIndex((layer) => layer.id === targetId);
    nextDisplay.splice(targetDisplayIndex + (over.edge === 'after' ? 1 : 0), 0, layers.find((layer) => layer.id === dragId)!);
    reorderLayer(dragId, nextDisplay.length - 1 - nextDisplay.findIndex((layer) => layer.id === dragId));
    setDragId(null); setOver(null);
  };
  const setBound = (key: 'x' | 'y' | 'w' | 'h', raw: string) => {
    if (!geometry) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const next = { ...geometry, [key]: key === 'w' || key === 'h' ? Math.max(1, n) : n };
    if (lockAspect && key === 'w') next.h = Math.max(1, n / Math.max(0.0001, geometry.w / geometry.h));
    if (lockAspect && key === 'h') next.w = Math.max(1, n * (geometry.w / Math.max(0.0001, geometry.h)));
    setSelectedLayerBounds(next);
  };

  return (
    <div className="panel layers" onPointerDown={() => setMenu(null)}>
      <div className="panel-head">
        <span>Capas {selectedCount > 1 && <i className="panel-count">{selectedCount}</i>}</span>
        <div className="actions">
          <button className="icon-btn" title="Nueva capa transparente" disabled={!doc} onClick={onAddLayer}><Icon name="plus" size={15} /></button>
          <button className="icon-btn" title="Nuevo grupo" disabled={!doc} onClick={addGroup}><Icon name="folder" size={15} /></button>
          <button className="icon-btn" title="Nueva capa de ajuste" disabled={!doc} onClick={addAdjustmentLayer}><Icon name="adjust" size={15} /></button>
          <button className="icon-btn danger" title={selectedCount > 1 ? `Eliminar ${selectedCount} capas` : 'Eliminar capa'} disabled={!active} onClick={removeSelectedLayers}><Icon name="trash" size={15} /></button>
        </div>
      </div>

      <div className="layer-list" role="listbox" aria-label="Capas" aria-multiselectable="true">
        {!display.length && <div className="hint-empty">Sin capas todavía.</div>}
        {display.map((layer) => {
          const label = kindLabel(layer);
          return (
            <div key={layer.id}
              className={['layer', layer.id === active?.id ? 'active' : '', selectedLayerIds.includes(layer.id) ? 'selected' : '', maskTargetId === layer.id ? 'mask-editing' : '', layer.visible ? '' : 'hidden', layer.locked ? 'locked' : '', over?.id === layer.id ? `dragover-${over.edge}` : ''].join(' ')}
              style={{ paddingLeft: layer.parentId ? 22 : 6, borderLeftColor: layer.colorTag ?? 'transparent' }}
              draggable onDragStart={() => setDragId(layer.id)} onDragEnd={() => { setDragId(null); setOver(null); }}
              onDragOver={(e) => { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); setOver({ id: layer.id, edge: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after' }); }}
              onDragLeave={() => setOver((value) => value?.id === layer.id ? null : value)} onDrop={() => onDrop(layer.id)}
              role="option" aria-selected={selectedLayerIds.includes(layer.id)} tabIndex={0}
              onClick={(e) => selectLayer(layer.id, e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'replace')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLayer(layer.id, e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'replace'); } }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selectedLayerIds.includes(layer.id)) selectLayer(layer.id);
                setMenu({
                  id: layer.id,
                  x: Math.max(LAYER_MENU_MARGIN, Math.min(e.clientX, window.innerWidth - LAYER_MENU_WIDTH - LAYER_MENU_MARGIN)),
                  y: Math.max(LAYER_MENU_MARGIN, Math.min(e.clientY, window.innerHeight - LAYER_MENU_HEIGHT - LAYER_MENU_MARGIN)),
                });
              }}>
              <button className="vis" title={layer.visible ? 'Ocultar' : 'Mostrar'} onClick={(e) => { e.stopPropagation(); if (selectedLayerIds.includes(layer.id) && selectedLayerIds.length > 1) toggleSelectedVisibility(); else toggleVisible(layer.id); }}><Icon name={layer.visible ? 'eye' : 'eye-off'} size={16} /></button>
              <button className={`layer-thumb-button ${maskTargetId === layer.id ? '' : 'editing'}`} title={layer.text ? 'Editar texto con doble clic' : 'Editar contenido de capa'}
                onClick={(e) => { e.stopPropagation(); selectLayer(layer.id); setMaskTarget(null); }}
                onDoubleClick={(e) => { e.stopPropagation(); if (layer.text) onEditText(layer.id); }}>
                <img className="thumb" src={layer.thumb} alt="" draggable={false} />
              </button>
              {label && <span className="layer-kind">{label}</span>}
              {layer.mask && <MaskThumbnail
                source={layer.mask.canvas}
                version={canvasVersion(layer.mask.canvas)}
                enabled={layer.mask.enabled}
                editing={maskTargetId === layer.id}
                title={layer.mask.enabled ? 'Editar máscara · Shift click para desactivar' : 'Máscara desactivada · Shift click para activar'}
                onClick={(e) => {
                  e.stopPropagation();
                  selectLayer(layer.id);
                  if (e.shiftKey) setMaskEnabled(layer.id, !layer.mask!.enabled);
                  else setMaskTarget(maskTargetId === layer.id ? null : layer.id);
                }} />}
              {editing?.id === layer.id ? <input className="layer-name-input" autoFocus value={editing.value} onChange={(e) => setEditing({ id: layer.id, value: e.target.value })} onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(null); }} onClick={(e) => e.stopPropagation()} />
                : <span className="layer-name" onDoubleClick={(e) => { e.stopPropagation(); setEditing({ id: layer.id, value: layer.name }); }}>{layer.name}</span>}
              {(layer.locked || layer.lockPixels) && <Icon name="lock" size={13} />}
              <span className="grip"><Icon name="grip" size={16} /></span>
            </div>
          );
        })}
      </div>

      {maskTargetId && active?.id === maskTargetId && active.mask && (
        <div className="mask-edit-banner" data-ui>
          <Icon name="mask" size={16} />
          <span><strong>Editando máscara</strong><small>{active.name}</small></span>
          <button className={`mask-mode-swatch black ${tool === 'brush' ? 'on' : ''}`} title="Ocultar con pincel" onClick={() => setTool('brush')} />
          <button className={`mask-mode-swatch white ${tool === 'eraser' ? 'on' : ''}`} title="Revelar con borrador" onClick={() => setTool('eraser')} />
          <button className="icon-btn" title="Volver al contenido de la capa" onClick={() => setMaskTarget(null)}><Icon name="close" size={13} /></button>
        </div>
      )}

      {active?.vector && selectedCount === 1 && (
        <div className="layer-inspector-tabs" role="tablist" aria-label="Inspector de capa vectorial">
          <button
            type="button"
            role="tab"
            aria-selected={inspectorTab === 'layer'}
            className={inspectorTab === 'layer' ? 'on' : ''}
            onClick={() => setInspectorTab('layer')}
          >
            <Icon name="panel" size={13} />
            Capa
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inspectorTab === 'vector'}
            className={inspectorTab === 'vector' ? 'on' : ''}
            onClick={() => setInspectorTab('vector')}
          >
            <Icon name="direct-select" size={13} />
            Vector
          </button>
        </div>
      )}

      {active && (!active.vector || selectedCount !== 1 || inspectorTab === 'layer') && (
        <div className="layer-props properties-panel">
          <div className="field-row compact"><span>Modo</span><select className="text-input" value={active.blendMode ?? 'source-over'} onChange={(e) => setSelectedBlendMode(e.target.value as BlendMode)}>{BLENDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select></div>
          {active.kind !== 'group' && active.kind !== 'adjustment' && <div className="field-row compact"><span>Interpolación</span><select className="text-input" value={active.interpolation ?? 'smooth'} onChange={(event) => setSelectedInterpolation(event.target.value as 'smooth' | 'nearest')}><option value="smooth">Suave</option><option value="nearest">Píxel nítido</option></select></div>}
          <div className="opacity-bar">
            <NumericControl label="Opacidad" value={Math.round(active.opacity * 100)} min={0} max={100} step={1} suffix="%"
              resetValue={100} onBegin={() => snapshot('Cambiar opacidad')} onCancel={undo}
              onChange={(value) => setSelectedOpacity(value / 100)} />
            <input type="range" aria-label="Opacidad de capa" min={0} max={1} step={0.01} value={active.opacity}
              onPointerDown={() => snapshot('Cambiar opacidad')} onChange={(e) => setSelectedOpacity(Number(e.target.value))} />
          </div>
          {geometry && <div className="transform-properties">
            <div className="transform-properties-head">
              <span>{selectedCount > 1 ? `Transformar ${selectedCount} capas` : 'Transformar'}</span>
              <button className={`icon-btn ${lockAspect ? 'on' : ''}`} title={lockAspect ? 'Desvincular proporciones' : 'Vincular proporciones'} aria-pressed={lockAspect} onClick={() => setLockAspect((value) => !value)}><Icon name="link" size={13} /></button>
            </div>
            <div className="prop-grid">
              {(['x', 'y', 'w', 'h'] as const).map((key) => (
                <NumericControl key={key} className="compact" label={key.toUpperCase()}
                  value={Math.round(geometry[key])} min={key === 'w' || key === 'h' ? 1 : undefined} step={1} suffix="px"
                  onBegin={() => snapshot(selectedCount > 1 ? 'Transformar capas' : 'Transformar capa')}
                  onCancel={undo} onChange={(value) => setBound(key, String(value))} />
              ))}
            </div>
            {selectedCount === 1 && <NumericControl className="rotation-control" label="Rotación"
              value={Math.round(((active.rotation ?? 0) * 180) / Math.PI)} min={-3600} max={3600} step={1} suffix="°" resetValue={0}
              onBegin={() => snapshot('Rotar capa')} onCancel={undo}
              onChange={(value) => setLayerRotation(active.id, value * Math.PI / 180)} />}
          </div>}
          <div className="layer-actions">
            <button className={`icon-btn ${active.locked ? 'on' : ''}`} title="Bloquear transformación" onClick={() => toggleSelectedLock()}><Icon name="lock" size={14} /></button>
            <button className={`icon-btn ${active.lockPixels ? 'on' : ''}`} title="Bloquear píxeles" onClick={() => toggleSelectedLock(true)}><Icon name="lock-pixels" size={14} /></button>
            <button className="icon-btn" title="Agregar máscara" disabled={!!active.mask || active.kind === 'group' || active.kind === 'adjustment'} onClick={() => addLayerMask(active.id)}><Icon name="mask" size={14} /></button>
            {active.mask && <label className="mask-enabled" title="Activar máscara"><input type="checkbox" checked={active.mask.enabled} onChange={(e) => setMaskEnabled(active.id, e.target.checked)} /> Máscara</label>}
            {TAGS.map((color) => <button key={color} className={`tag-dot ${active.colorTag === color ? 'on' : ''}`} style={{ background: color }} title="Etiqueta de capa" onClick={() => setLayerColorTag(active.id, active.colorTag === color ? undefined : color)} />)}
          </div>
          {active.mask && <div className="mask-properties">
            <div className="subhead">Máscara de capa</div>
            <NumericControl label="Densidad" value={Math.round((active.mask.density ?? 1) * 100)} min={0} max={100} step={1} suffix="%"
              resetValue={100} onBegin={() => snapshot('Cambiar densidad de máscara')} onCancel={undo}
              onChange={(value) => setMaskDensity(active.id, value / 100)} />
            <NumericControl label="Desvanecer" value={active.mask.feather ?? 0} min={0} max={250} step={0.5} suffix="px"
              resetValue={0} onBegin={() => snapshot('Desvanecer máscara')} onCancel={undo}
              onChange={(value) => setMaskFeather(active.id, value)} />
            <div className="mask-property-actions">
              <button className="tbtn" onClick={() => invertLayerMask(active.id)}>Invertir</button>
              <button className="tbtn" disabled={active.locked || active.lockPixels} onClick={() => applyLayerMask(active.id)}>Aplicar</button>
              <button className="tbtn danger" onClick={() => removeLayerMask(active.id)}>Eliminar</button>
            </div>
          </div>}
          {groups.length > 0 && active.kind !== 'group' && <div className="field-row compact"><span>Grupo</span><select className="text-input" value={active.parentId ?? ''} onChange={(e) => setLayerParent(active.id, e.target.value || undefined)}><option value="">Sin grupo</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>}
        </div>
      )}

      {active?.text && selectedCount === 1 && !textEditorOpen && (() => {
        const text = { ...DEFAULT_TEXT, ...active.text };
        const locked = active.locked || active.lockPixels;
        return <div className={`text-inspector ${textOpen ? 'open' : ''}`} data-ui>
          <div className="text-inspector-head subhead">
            <button className="collapse-trigger" onClick={() => setTextOpen((open) => !open)}>
              <Icon name="chevron-down" size={12} className={`collapse-chevron ${textOpen ? 'open' : ''}`} />
              Texto
            </button>
            <span>{text.family} · {Math.round(text.size)} px</span>
            <button className="icon-btn" title="Abrir editor de texto grande" disabled={locked} onClick={() => onEditText(active.id)}>
              <Icon name="text" size={14} />
            </button>
          </div>
          <div className={`collapse-body ${textOpen ? 'open' : ''}`}><div>
            <div className="text-flyout-head">
              <span><strong>Propiedades de texto</strong><small>{text.family} · {Math.round(text.size)} px</small></span>
              <button className="icon-btn" title="Cerrar panel de texto" onClick={() => setTextOpen(false)}><Icon name="close" size={13} /></button>
            </div>
            {locked && <div className="text-inspector-locked"><Icon name="lock" size={12} /> Desbloqueá la capa para editar el texto</div>}
            <TextControls
              key={active.id}
              value={text}
              layout="inspector"
              disabled={locked}
              onBegin={snapshot}
              onChange={(next) => {
                updateTextLayer(active.id, next);
                setTextDefaults({ ...next, text: DEFAULT_TEXT_SETTINGS.text });
              }}
            />
            <div className="text-inspector-actions">
              <button className="tbtn" disabled={locked} onClick={() => onEditText(active.id)}>Editor grande</button>
              <button className="tbtn" disabled={locked} onClick={() => void convertTextToCurves(active.id)}>Pasar a curvas</button>
            </div>
          </div></div>
        </div>;
      })()}

      {active?.vector && selectedCount === 1 && inspectorTab === 'vector' && <div className="vector-inspector" role="tabpanel">
        <div className="subhead" style={{ margin: '0 0 8px' }}>Vector</div>
        {active.vector.kind === 'editable'
          ? (() => {
              const shape = active.vector.shapes?.[0];
              const style = shape?.style;
              const vectorBounds = vectorGeometryBounds(active.vector.shapes ?? []) ?? {
                x: 0,
                y: 0,
                w: active.vector.baseWidth,
                h: active.vector.baseHeight,
              };
              return <>
                <div className="vector-summary"><span>{active.vector.shapes?.reduce((total, item) => total + item.subpaths.reduce((sum, path) => sum + path.nodes.length, 0), 0) ?? 0} nodos</span><span>{shape?.primitive ? shape.name : `${active.vector.shapes?.length ?? 0} formas`}</span></div>
                {style && <VectorAppearanceEditor
                  style={style}
                  bounds={vectorBounds}
                  onBegin={(label) => snapshot(label ?? 'Editar apariencia vectorial')}
                  onPatch={(patch, captureHistory = true) => setVectorStyle(active.id, null, patch, captureHistory)}
                />}
                {shape?.primitive && <div className="vector-primitive-controls">
                  {shape.primitive.kind === 'polygon' && <NumericControl label="Lados" value={shape.primitive.sides} min={3} max={64} step={1}
                    onBegin={() => snapshot('Editar forma vectorial')} onChange={(value) => updateVectorPrimitive(active.id, { sides: Math.round(value) }, false)} />}
                  {shape.primitive.kind !== 'ellipse' && <NumericControl label="Radio de esquina" value={shape.primitive.cornerRadius} min={0} max={4000} step={1}
                    suffix="px" onBegin={() => snapshot('Editar forma vectorial')} onChange={(value) => updateVectorPrimitive(active.id, { cornerRadius: Math.max(0, value) }, false)} />}
                </div>}
                {!shape?.primitive && <div className="vector-round-controls">
                  <NumericControl label="Redondeo" value={vectorCornerRadius} min={0} max={4000} step={1} suffix="px"
                    onChange={(value) => setToolDefaults({ vectorCornerRadius: Math.max(0, value) })} />
                  <button className="tbtn" onClick={() => {
                    if (!roundVectorCorners(active.id, vectorCornerRadius)) useEditor.getState().toast('Este trazado no tiene esquinas rectas para redondear', 'error');
                  }}>Aplicar a esquinas</button>
                </div>}
                <div className="vector-path-utilities">
                  <div className="vector-simplify-row">
                    <NumericControl label="Tolerancia" value={vectorSimplifyTolerance} min={0.05} max={50} step={0.05} decimals={2} suffix="px"
                      onChange={(value) => setToolDefaults({ vectorSimplifyTolerance: value })} />
                    <button className="tbtn" title="Reducir nodos y suavizar el trazado conservando su forma"
                      onClick={() => void simplifyVectorLayer(active.id, vectorSimplifyTolerance)}><Icon name="simplify" size={14} />Simplificar</button>
                  </div>
                  <div className="vector-compound-actions">
                    <button className="tbtn" disabled={activeVectorPathCount < 2} title="Combinar subtrazados y crear huecos con regla par-impar"
                      onClick={() => makeCompoundPath()}><Icon name="compound" size={14} />Crear compuesto</button>
                    <button className="tbtn" disabled={activeVectorPathCount < 2} title="Separar cada subtrazado en su propia capa"
                      onClick={() => releaseCompoundPath(active.id)}><Icon name="release-compound" size={14} />Liberar</button>
                  </div>
                </div>
                <div className="vector-inspector-actions">
                  <button className="tbtn" onClick={() => setTool('vector-node')}><Icon name="direct-select" size={14} />Editar nodos Bézier</button>
                  <button className="tbtn" onClick={() => void rasterizeLayer(active.id)}>Rasterizar</button>
                </div>
              </>;
            })()
          : <>
              {active.vector.svgText && <div className="field-row compact"><span>Relleno</span><input type="color" onChange={(e) => void updateSvgVectorColors(active.id, e.target.value)} /></div>}
              <button className="tbtn" disabled={!active.vector.svgText} onClick={() => void expandVectorLayer(active.id)}><Icon name="outline" size={14} />Expandir trazados</button>
              <button className="tbtn" onClick={() => void rasterizeLayer(active.id)}>Rasterizar capa</button>
            </>}
      </div>}

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

      {doc && <div className="selection-channels">
        <div className="subhead">
          <button className="collapse-trigger" onClick={() => setChannelsOpen((open) => !open)}>
            <Icon name="chevron-down" size={12} className={`collapse-chevron ${channelsOpen ? 'open' : ''}`} />
            Selecciones guardadas
          </button>
          <button className="icon-btn" title="Guardar selección actual" disabled={!selection}
            onClick={() => { setChannelsOpen(true); saveSelectionChannel(); }}><Icon name="save" size={14} /></button>
        </div>
        <div className={`collapse-body ${channelsOpen ? 'open' : ''}`}><div>
          <div className="selection-channel-list">
            {!doc.savedSelections?.length && <span className="hint-empty">No hay selecciones guardadas.</span>}
            {(doc.savedSelections ?? []).map((channel) => (
              <div className="selection-channel-row" key={channel.id}>
                <button className="selection-channel-load" title="Cargar selección"
                  onClick={() => loadSelectionChannel(channel.id)}><Icon name="select-rect" size={14} /></button>
                {editingChannel?.id === channel.id
                  ? <input className="text-input" autoFocus value={editingChannel.value}
                    onChange={(event) => setEditingChannel({ id: channel.id, value: event.target.value })}
                    onBlur={() => { renameSelectionChannel(channel.id, editingChannel.value); setEditingChannel(null); }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { renameSelectionChannel(channel.id, editingChannel.value); setEditingChannel(null); }
                      if (event.key === 'Escape') setEditingChannel(null);
                    }} />
                  : <button className="selection-channel-name" title="Cargar selección · Doble clic para renombrar"
                    onClick={() => loadSelectionChannel(channel.id)}
                    onDoubleClick={() => setEditingChannel({ id: channel.id, value: channel.name })}>{channel.name}</button>}
                <span>{Math.round(channel.bounds.w)}×{Math.round(channel.bounds.h)}</span>
                <button className="icon-btn danger" title="Eliminar selección guardada"
                  onClick={() => removeSelectionChannel(channel.id)}><Icon name="trash" size={13} /></button>
              </div>
            ))}
          </div>
        </div></div>
      </div>}

      {menu && <div className="layer-menu" data-ui style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => { if (menuLayer?.text) onEditText(menu.id); setMenu(null); }} disabled={selectedCount > 1 || !menuLayer?.text || menuLayer.locked || menuLayer.lockPixels}>Editar texto</button>
        <button onClick={() => { if (menuLayer?.text) void convertTextToCurves(menu.id); setMenu(null); }} disabled={selectedCount > 1 || !menuLayer?.text || menuLayer.locked || menuLayer.lockPixels}>Convertir texto a curvas</button>
        <button onClick={() => { if (menuLayer?.vector?.kind === 'placed') void expandVectorLayer(menu.id); setMenu(null); }} disabled={selectedCount > 1 || menuLayer?.vector?.kind !== 'placed' || !menuLayer.vector.svgText}>Expandir trazados</button>
        <button onClick={() => { setTool('vector-node'); setMenu(null); }} disabled={selectedCount > 1 || menuLayer?.vector?.kind !== 'editable'}>Editar nodos</button>
        <button onClick={() => { makeCompoundPath(); setMenu(null); }} disabled={selectedEditableVectors < 2 && menuVectorPathCount < 2}>Crear trazado compuesto</button>
        <button onClick={() => { releaseCompoundPath(menu.id); setMenu(null); }} disabled={selectedCount > 1 || menuVectorPathCount < 2}>Liberar trazado compuesto</button>
        <button onClick={() => { onVectorize(menu.id); setMenu(null); }} disabled={selectedCount > 1 || !!menuLayer?.vector || !!menuLayer?.text || menuLayer?.kind === 'group' || menuLayer?.kind === 'adjustment'}>Vectorizar imagen…</button>
        {selectedEditableVectors >= 2 && <>
          <span className="layer-menu-sep" />
          <button onClick={() => { applyPathfinder('unite'); setMenu(null); }}>Pathfinder: Unir</button>
          <button onClick={() => { applyPathfinder('subtract'); setMenu(null); }}>Pathfinder: Restar frente</button>
          <button onClick={() => { applyPathfinder('intersect'); setMenu(null); }}>Pathfinder: Intersectar</button>
          <button onClick={() => { applyPathfinder('exclude'); setMenu(null); }}>Pathfinder: Excluir</button>
        </>}
        <button onClick={() => { duplicateSelectedLayers(); setMenu(null); }}>Duplicar {selectedCount > 1 ? 'capas' : 'capa'}</button>
        <button onClick={() => { mergeDown(); setMenu(null); }} disabled={selectedCount > 1}>Combinar hacia abajo</button>
        <button onClick={() => { mergeVisible(); setMenu(null); }}>Combinar visibles</button>
        <span className="layer-menu-sep" />
        <button onClick={() => { addLayerMask(menu.id); setMenu(null); }} disabled={selectedCount > 1 || !!menuLayer?.mask || menuLayer?.kind === 'group' || menuLayer?.kind === 'adjustment'}>Agregar máscara</button>
        <button onClick={() => { invertLayerMask(menu.id); setMenu(null); }} disabled={selectedCount > 1 || !menuLayer?.mask}>Invertir máscara</button>
        <button onClick={() => { applyLayerMask(menu.id); setMenu(null); }} disabled={selectedCount > 1 || !menuLayer?.mask || menuLayer.locked || menuLayer.lockPixels}>Aplicar máscara</button>
        <button onClick={() => { removeLayerMask(menu.id); setMenu(null); }} disabled={selectedCount > 1 || !menuLayer?.mask}>Eliminar máscara</button>
        <button onClick={() => { if (menuLayer?.vector) void rasterizeLayer(menu.id); setMenu(null); }} disabled={selectedCount > 1 || !menuLayer?.vector}>Rasterizar</button>
        <span className="layer-menu-sep" />
        <button onClick={() => { flipSelectedLayers('horizontal'); setMenu(null); }} disabled={selected.every((layer) => layer.kind === 'adjustment' || layer.locked)}>Espejar horizontalmente</button>
        <button onClick={() => { flipSelectedLayers('vertical'); setMenu(null); }} disabled={selected.every((layer) => layer.kind === 'adjustment' || layer.locked)}>Espejar verticalmente</button>
        <span className="layer-menu-sep" />
        <button onClick={() => { toggleSelectedLock(); setMenu(null); }}>{active?.locked ? 'Desbloquear transformación' : 'Bloquear transformación'}</button>
        <button className="danger" onClick={() => { removeSelectedLayers(); setMenu(null); }}>Eliminar {selectedCount > 1 ? `${selectedCount} capas` : 'capa'}</button>
      </div>}
    </div>
  );
}
