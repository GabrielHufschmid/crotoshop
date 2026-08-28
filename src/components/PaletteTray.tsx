import { useMemo, useState } from 'react';
import { generatePalette, HARMONIES, type PaletteHarmony } from '../engine/palette';
import { parsePaletteFile, paletteFileName, serializePaletteFile } from '../engine/paletteFile';
import { downloadBlob } from '../engine/export';
import { pickFiles } from '../hooks/useImport';
import { useEditor } from '../store/editorStore';
import { useSettings } from '../store/settingsStore';
import type { SavedPalette } from '../store/settingsStore';
import { Icon } from './Icons';
import type { IconName } from './Icons';

const HARMONY_ICONS: Record<PaletteHarmony, IconName> = {
  analogous: 'palette-analogous', complementary: 'palette-complementary', triad: 'palette-triad', split: 'palette-split', monochrome: 'palette-mono',
};

/** Best-effort primary for palettes saved before that field existed. */
function paletteFallbackPrimary(palette: SavedPalette): string {
  return palette.primary ?? palette.colors[Math.floor(palette.colors.length / 2)] ?? palette.colors[0] ?? '#888888';
}

export function PaletteTray({ onClose }: { onClose: () => void }) {
  const primaryColor = useEditor((s) => s.primaryColor);
  const activeColor = useEditor((s) => s.fgColor);
  const setFgColor = useEditor((s) => s.setFgColor);
  const toast = useEditor((s) => s.toast);
  const activePalette = useSettings((s) => s.activePalette);
  const savedPalettes = useSettings((s) => s.savedPalettes);
  const setActivePalette = useSettings((s) => s.setActivePalette);
  const savePalette = useSettings((s) => s.savePalette);
  const renamePalette = useSettings((s) => s.renamePalette);
  const removePalette = useSettings((s) => s.removePalette);
  const [harmony, setHarmony] = useState<PaletteHarmony>('analogous');
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const generated = useMemo(() => generatePalette(primaryColor, harmony), [primaryColor, harmony]);
  const activatePalette = (colors: string[]) => setActivePalette(colors);
  const swatches = (colors: string[]) => colors.map((color) => <button key={color} className={activeColor.toLowerCase() === color.toLowerCase() ? 'selected' : ''} style={{ background: color }} title={`Usar ${color}`} onClick={() => setFgColor(color)} />);

  const commitRename = () => {
    if (renaming?.value.trim()) renamePalette(renaming.id, renaming.value.trim());
    setRenaming(null);
  };

  const exportPalette = (palette: SavedPalette) => {
    const data = serializePaletteFile({
      name: palette.name,
      primary: paletteFallbackPrimary(palette),
      harmony: palette.harmony,
      colors: palette.colors,
    });
    downloadBlob(new Blob([data], { type: 'application/json' }), paletteFileName(palette.name));
  };

  const importPalette = async () => {
    const [file] = await pickFiles('.crotopalette,application/json', false);
    if (!file) return;
    try {
      const parsed = parsePaletteFile(await file.text());
      savePalette(parsed);
      activatePalette(parsed.colors);
      toast(`Paleta "${parsed.name}" importada`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo importar la paleta', 'error');
    }
  };

  const harmonyMeta = HARMONIES.find((item) => item.id === harmony)!;
  return <div className="palette-tray" data-ui>
    <div className="palette-tray-title">
      <Icon name="palette" size={17} />
      <button className="icon-btn" title="Importar paleta (.crotopalette)" onClick={() => void importPalette()}><Icon name="open" size={14} /></button>
      <button className="icon-btn" title="Cerrar paletas" onClick={onClose}><Icon name="close" size={14} /></button>
    </div>
    <div className="palette-tray-main">
      <button className="palette-tray-base" style={{ background: primaryColor }} title={`Color primario ${primaryColor}`} onClick={() => setFgColor(primaryColor)} />
      <div className="palette-harmonies">{HARMONIES.map((item) => <button key={item.id} className={harmony === item.id ? 'on' : ''} title={item.label} onClick={() => { setHarmony(item.id); activatePalette(generatePalette(primaryColor, item.id).colors); }}><Icon name={HARMONY_ICONS[item.id]} size={17} /></button>)}</div>
      <div className="palette-strip"><div>{swatches(generated.colors)}</div></div>
      <button className="icon-btn palette-save-icon" title="Guardar paleta" onClick={() => { savePalette({ name: `${generated.label} ${new Date().toLocaleDateString('es-AR')}`, colors: generated.colors, harmony, primary: primaryColor }); activatePalette(generated.colors); }}><Icon name="save" size={14} /></button>
      <div className="palette-description"><strong>{harmonyMeta.label}</strong><span>{harmonyMeta.description}</span></div>
    </div>
    {savedPalettes.length > 0 && <div className="palette-tray-saved">{savedPalettes.map((palette) => (
      <div className="tray-saved-palette" key={palette.id}>
        <div className="tray-saved-swatches">{swatches(palette.colors)}</div>
        {renaming?.id === palette.id ? (
          <input
            className="tray-saved-name-input"
            autoFocus
            value={renaming.value}
            onChange={(e) => setRenaming({ id: palette.id, value: e.target.value })}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
          />
        ) : (
          <span className="tray-saved-name" title="Doble click para renombrar" onDoubleClick={() => setRenaming({ id: palette.id, value: palette.name })}>{palette.name}</span>
        )}
        <button className="icon-btn" title={`Exportar "${palette.name}" (.crotopalette)`} onClick={() => exportPalette(palette)}><Icon name="export" size={13} /></button>
        <button className="icon-btn danger" title={`Eliminar ${palette.name}`} onClick={() => removePalette(palette.id)}><Icon name="trash" size={13} /></button>
      </div>
    ))}</div>}
    {activePalette.length > 0 && <i className="palette-active-dot" title="Paleta activa" />}
  </div>;
}
