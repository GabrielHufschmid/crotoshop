import { useEffect, useState } from 'react';
import type React from 'react';
import { useEditor } from '../store/editorStore';
import { comboLabel, useSettings } from '../store/settingsStore';
import { Icon } from './Icons';
import type { IconName } from './Icons';
import type { Tool } from '../types';

interface ToolItem { tool: Tool; icon: IconName; label: string; action: string; }
const TOOL_GROUPS: { label: string; color: string; tools: ToolItem[] }[] = [
  { label: 'Edición', color: 'var(--grp-edicion)', tools: [
    { tool: 'move', icon: 'move', label: 'Mover', action: 'tool.move' },
    { tool: 'crop', icon: 'crop', label: 'Recortar', action: 'tool.crop' },
    { tool: 'warp-mesh', icon: 'warp-mesh', label: 'Warp Mesh', action: 'tool.warp-mesh' },
  ] },
  { label: 'Selección', color: 'var(--grp-seleccion)', tools: [
    { tool: 'select-rect', icon: 'select-rect', label: 'Selección rectangular', action: 'tool.select-rect' },
    { tool: 'select-ellipse', icon: 'select-ellipse', label: 'Selección elíptica', action: 'tool.select-ellipse' },
    { tool: 'select-poly', icon: 'select-poly', label: 'Selección poligonal', action: 'tool.select-poly' },
    { tool: 'select-bezier', icon: 'select-bezier', label: 'Selección bezier', action: 'tool.select-bezier' },
    { tool: 'wand', icon: 'wand', label: 'Varita mágica', action: 'tool.wand' },
    { tool: 'ai-mask', icon: 'ai-mask', label: 'Máscara IA', action: 'tool.ai-mask' },
  ] },
  { label: 'Dibujo', color: 'var(--grp-dibujo)', tools: [
    { tool: 'brush', icon: 'brush', label: 'Pincel', action: 'tool.brush' },
    { tool: 'bucket', icon: 'bucket', label: 'Balde de pintura', action: 'tool.bucket' },
    { tool: 'text', icon: 'text', label: 'Texto', action: 'tool.text' },
  ] },
  { label: 'Vector', color: 'var(--grp-dibujo)', tools: [
    { tool: 'vector-node', icon: 'direct-select', label: 'Selección directa', action: 'tool.vector-node' },
    { tool: 'vector-shape', icon: 'shape', label: 'Formas vectoriales', action: 'tool.vector-shape' },
    { tool: 'vector-pen', icon: 'pen', label: 'Pluma vectorial', action: 'tool.vector-pen' },
  ] },
  { label: 'Retoque', color: 'var(--grp-retoque)', tools: [
    { tool: 'eraser', icon: 'eraser', label: 'Borrador', action: 'tool.eraser' },
    { tool: 'blur', icon: 'blur', label: 'Desenfocar', action: 'tool.blur' },
    { tool: 'sharpen', icon: 'sharpen', label: 'Enfocar', action: 'tool.sharpen' },
    { tool: 'pixel-stretch', icon: 'pixel-stretch', label: 'Pixel Stretch', action: 'tool.pixel-stretch' },
  ] },
  { label: 'Vista', color: 'var(--grp-vista)', tools: [
    { tool: 'hand', icon: 'hand', label: 'Mano / Pan', action: 'tool.hand' },
    { tool: 'zoom', icon: 'zoom-in', label: 'Zoom', action: 'tool.zoom' },
  ] },
];

export function Toolbar({ onRemoveBg, onRefineTextLines }: { onRemoveBg: () => void; onRefineTextLines: () => void }) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const hasDoc = useEditor((s) => !!s.doc);
  const smartFillSelection = useEditor((s) => s.smartFillSelection);
  const bindings = useSettings((s) => s.bindings);
  const [mobileGroup, setMobileGroup] = useState(TOOL_GROUPS[0].label);
  const mobileIcons: Record<string, IconName> = { Edición: 'move', Selección: 'select-rect', Dibujo: 'brush', Vector: 'shape', Retoque: 'eraser', Vista: 'hand' };
  useEffect(() => {
    const group = TOOL_GROUPS.find((item) => item.tools.some((entry) => entry.tool === tool));
    if (group) setMobileGroup(group.label);
  }, [tool]);

  return (
    <div className="toolbar">
      <div className="toolbar-tool-scroll">
      <div className="mobile-tool-groups mobile-only" aria-label="Categorías de herramientas">
        {TOOL_GROUPS.map((group) => <button key={group.label} className={`tool ${mobileGroup === group.label ? 'active' : ''}`} title={group.label} aria-pressed={mobileGroup === group.label} onClick={() => setMobileGroup(group.label)}><Icon name={mobileIcons[group.label]} /></button>)}
      </div>
      {TOOL_GROUPS.map((group) => (
        <div className={`tool-group ${mobileGroup === group.label ? 'mobile-active' : ''}`} key={group.label} data-label={group.label} style={{ '--group-color': group.color } as React.CSSProperties}>
          {group.tools.map((t) => {
            const combo = bindings[t.action];
            return <button key={t.tool} className={`tool ${tool === t.tool ? 'active' : ''}`} title={combo ? `${t.label} (${comboLabel(combo)})` : t.label} onClick={() => setTool(t.tool)}><Icon name={t.icon} /></button>;
          })}
          {group.label === 'Retoque' && <>
            <button className="tool" title="Quitar fondo (IA)" disabled={!hasDoc} onClick={onRemoveBg}><Icon name="bg" /></button>
            <button className="tool" title="Eliminar objeto con relleno contextual" disabled={!hasDoc} onClick={smartFillSelection}><Icon name="magic-remove" /></button>
            <button className="tool" title="Refinar texto y líneas sin crear halos" disabled={!hasDoc} onClick={onRefineTextLines}><Icon name="sharpen" /></button>
          </>}
        </div>
      ))}
      </div>
    </div>
  );
}
