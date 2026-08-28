import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editorStore';
import { useSettings } from '../../store/settingsStore';
import { estimateExportSize, exportArtboard, exportDoc, exportLayer, exportVectorLayerSvg, downloadBlob } from '../../engine/export';
import type { ExportFormat } from '../../engine/export';
import { humanSize } from '../../engine/canvasUtils';
import { pxToUnit, unitToPx } from '../../engine/units';
import type { Unit } from '../../types';
import { desktop, getDocumentSourceName, isDesktop, saveBlobNative } from '../../desktop/native';
import { defaultDocumentFileName, safeFileName } from '../../engine/fileNames';

const FORMATS: { value: ExportFormat; label: string; ext: string; alpha: boolean }[] = [
  { value: 'image/png', label: 'PNG (sin pérdida, con transparencia)', ext: 'png', alpha: true },
  { value: 'image/jpeg', label: 'JPEG (comprimido, sin transparencia)', ext: 'jpg', alpha: false },
  { value: 'image/webp', label: 'WEBP (comprimido, con transparencia)', ext: 'webp', alpha: true },
  { value: 'image/svg+xml', label: 'SVG (vectores editables + imágenes)', ext: 'svg', alpha: true },
];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const activeTabId = useEditor((s) => s.activeTabId);
  const toast = useEditor((s) => s.toast);
  const globalUnit = useSettings((s) => s.unit);
  const globalPpi = useSettings((s) => s.ppi);

  const [format, setFormat] = useState<ExportFormat>('image/png');
  const [quality, setQuality] = useState(0.92);
  const [matte, setMatte] = useState('#ffffff');
  const [defaultFilename] = useState(() => defaultDocumentFileName(getDocumentSourceName(activeTabId)));
  const [filename, setFilename] = useState(defaultFilename);
  const [unit, setUnit] = useState<Unit>(globalUnit);
  const [ppi, setPpi] = useState(globalPpi);
  const [outW, setOutW] = useState(doc?.width ?? 0);  // px
  const [outH, setOutH] = useState(doc?.height ?? 0); // px
  const [lock, setLock] = useState(true);
  const [size, setSize] = useState<number | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [scope, setScope] = useState<'document' | 'layer' | 'artboards'>('document');
  const [resampling, setResampling] = useState<'smooth' | 'nearest'>('smooth');

  const activeLayer = doc?.layers.find((layer) => layer.id === doc.activeId) ?? null;
  const canExportSvg = scope !== 'layer' || !!activeLayer?.vector;
  const fmt = FORMATS.find((f) => f.value === format)!;
  const isSvg = format === 'image/svg+xml';
  const isLossy = format === 'image/jpeg' || format === 'image/webp';
  const ratio = outH > 0 ? outW / outH : 1;

  useEffect(() => {
    if (scope === 'layer' && activeLayer) {
      const width = activeLayer.w ?? activeLayer.vector?.baseWidth ?? activeLayer.canvas.width;
      const height = activeLayer.h ?? activeLayer.vector?.baseHeight ?? activeLayer.canvas.height;
      const angle = activeLayer.rotation ?? 0;
      setOutW(Math.max(1, Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height));
      setOutH(Math.max(1, Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height));
    } else if (scope === 'document' && doc) {
      setOutW(doc.width);
      setOutH(doc.height);
    }
  }, [activeLayer, doc, scope]);

  useEffect(() => {
    if (isSvg && !canExportSvg) setFormat('image/png');
  }, [canExportSvg, isSvg, scope]);

  const display = (px: number) =>
    unit === 'px' ? String(Math.round(px)) : String(parseFloat(pxToUnit(px, unit, ppi).toFixed(2)));

  const changeW = (raw: string) => {
    const val = unitToPx(parseFloat(raw) || 0, unit, ppi);
    setOutW(val);
    if (lock) setOutH(Math.max(1, val / ratio));
  };
  const changeH = (raw: string) => {
    const val = unitToPx(parseFloat(raw) || 0, unit, ppi);
    setOutH(val);
    if (lock) setOutW(Math.max(1, val * ratio));
  };

  const applyPreset = (preset: 'transparent' | 'webjpg' | '2x') => {
    if (!doc) return;
    if (preset === 'transparent') {
      setFormat('image/png');
      setOutW(doc.width);
      setOutH(doc.height);
      setPpi(globalPpi);
    } else if (preset === 'webjpg') {
      setFormat('image/jpeg');
      setQuality(0.86);
      setMatte('#ffffff');
      setPpi(72);
    } else {
      setFormat('image/png');
      setOutW(doc.width * 2);
      setOutH(doc.height * 2);
    }
  };

  // Live estimated size (debounced).
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setCalculating(true);
    const t = setTimeout(async () => {
      try {
        // Encodeo en worker: no congela la UI mientras se ajustan los sliders.
        const bytes = isSvg && scope === 'layer' && activeLayer
          ? exportVectorLayerSvg(activeLayer, { width: outW, height: outH }).size
          : scope === 'artboards' && doc.artboards?.[0]
            ? (await exportArtboard(doc, doc.artboards[0], { format, quality, matte, width: outW, height: outH, ppi, resampling })).size
            : await estimateExportSize(doc, { format, quality, matte, width: outW, height: outH, ppi, resampling });
        if (!cancelled) setSize(bytes);
      } catch {
        if (!cancelled) setSize(null);
      } finally {
        if (!cancelled) setCalculating(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [activeLayer, doc, format, isSvg, quality, matte, outW, outH, ppi, resampling, scope]);

  const doExport = async () => {
    if (!doc) return;
    try {
      const exportName = safeFileName(filename.trim() || defaultFilename);
      const options = { format, quality, matte, width: outW, height: outH, ppi, resampling };
      if (scope === 'layer') {
        const layer = doc.layers.find((l) => l.id === doc.activeId);
        if (!layer) throw new Error('No hay capa activa');
        const blob = await exportLayer(layer, options);
        const name = `${exportName}.${fmt.ext}`;
        if (isDesktop) {
          const result = await saveBlobNative(blob, name);
          if (result?.canceled) return;
        } else downloadBlob(blob, name);
      } else if (scope === 'artboards') {
        const boards = doc.artboards ?? [];
        if (!boards.length) throw new Error('No hay mesas de trabajo para exportar');
        if (desktop) {
          const directory = await desktop.chooseDirectory();
          if (!directory) return;
          const separator = desktop.platform === 'win32' ? '\\' : '/';
          for (const board of boards) {
            const blob = await exportArtboard(doc, board, options);
            const name = `${exportName}-${safeFileName(board.name)}.${fmt.ext}`;
            await desktop.writeFile({ path: `${directory}${separator}${name}`, data: new Uint8Array(await blob.arrayBuffer()) });
          }
        } else {
          for (const board of boards) downloadBlob(await exportArtboard(doc, board, options), `${exportName}-${safeFileName(board.name)}.${fmt.ext}`);
        }
      } else {
        const blob = await exportDoc(doc, options);
        const name = `${exportName}.${fmt.ext}`;
        if (isDesktop) {
          const result = await saveBlobNative(blob, name);
          if (result?.canceled) return;
        } else downloadBlob(blob, name);
      }
      toast(isDesktop ? 'Archivo exportado' : 'Descarga iniciada');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al exportar', 'error');
    }
  };

  const pxW = Math.round(outW);
  const pxH = Math.round(outH);
  const cmW = pxToUnit(pxW, 'cm', ppi).toFixed(2);
  const cmH = pxToUnit(pxH, 'cm', ppi).toFixed(2);
  const ppm = Math.round((ppi / 2.54) * 100); // píxeles por metro (pHYs PNG)

  return (
    <Modal
      title="Exportar imagen"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button className="tbtn" onClick={onClose}>Cancelar</button>
          <button className="tbtn primary" onClick={doExport}>{isDesktop ? 'Guardar' : 'Descargar'}</button>
        </>
      }
    >
      <div className="field-row">
        <label>Exportar</label>
        <select className="text-input" style={{ width: 240 }} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="document">Documento completo</option>
          <option value="layer">Capa activa</option>
          <option value="artboards" disabled={!(doc?.artboards?.length)}>Todas las mesas de trabajo</option>
        </select>
      </div>

      <div className="field-row">
        <label>Formato</label>
        <select className="text-input" style={{ width: 240 }}
          value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
          {FORMATS.map((f) => <option key={f.value} value={f.value}
            disabled={f.value === 'image/svg+xml' && !canExportSvg}>{f.label}</option>)}
        </select>
      </div>

      {!isSvg && <div className="export-presets">
        <button className="mini-btn" onClick={() => applyPreset('transparent')}>PNG transparente</button>
        <button className="mini-btn" onClick={() => applyPreset('webjpg')}>JPEG web</button>
        <button className="mini-btn" onClick={() => applyPreset('2x')}>PNG 2x</button>
      </div>}

      {isLossy && (
        <div className="field">
          <div className="row">
            <label>Calidad</label>
            <span className="val">{Math.round(quality * 100)}%</span>
          </div>
          <input type="range" min={0.1} max={1} step={0.01}
            value={quality} onChange={(e) => setQuality(parseFloat(e.target.value))} />
        </div>
      )}

      {!fmt.alpha && (
        <div className="field-row">
          <label>Fondo (matte)</label>
          <input type="color" value={matte} onChange={(e) => setMatte(e.target.value)}
            style={{ width: 40, height: 28, background: 'none', border: 'none' }} />
        </div>
      )}

      <div className="field-row">
        <label>Tamaño</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <input className="num-input" style={{ width: 76 }} type="number" min={0}
            step={unit === 'cm' ? 0.01 : 1}
            value={display(outW)} onChange={(e) => changeW(e.target.value)} />
          <span style={{ color: 'var(--text-faint)' }}>×</span>
          <input className="num-input" style={{ width: 76 }} type="number" min={0}
            step={unit === 'cm' ? 0.01 : 1}
            value={display(outH)} onChange={(e) => changeH(e.target.value)} />
          <select className="text-input" style={{ width: 62 }}
            value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="px">px</option>
            <option value="cm">cm</option>
          </select>
        </div>
      </div>

      {!isSvg && <div className="field-row">
        <label>Resolución</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input className="num-input" type="number" min={1} max={2400} value={ppi}
            onChange={(e) => setPpi(Math.max(1, parseInt(e.target.value) || 96))} />
          <span style={{ color: 'var(--text-dim)' }}>ppi</span>
          <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>({ppm} px/m)</span>
        </div>
      </div>}

      <label className="checkbox">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
        Mantener proporción
      </label>

      {!isSvg && <div className="field-row">
        <label>Interpolación</label>
        <select className="text-input" style={{ width: 180 }} value={resampling}
          onChange={(event) => setResampling(event.target.value as 'smooth' | 'nearest')}>
          <option value="smooth">Suave, fotografía</option>
          <option value="nearest">Vecino más cercano, píxel</option>
        </select>
      </div>}

      <div className="field-row">
        <label>Nombre</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input className="text-input" style={{ width: 150 }}
            value={filename} onChange={(e) => setFilename(e.target.value)} />
          <span style={{ color: 'var(--text-faint)' }}>.{fmt.ext}</span>
        </div>
      </div>

      <div style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'right', lineHeight: 1.5 }}>
        {isSvg ? `SVG escalable · viewport ${pxW} × ${pxH}px` : `Final: ${pxW} × ${pxH}px · ${cmW} × ${cmH}cm a ${ppi}ppi`}
        <br />
        {isSvg
          ? scope === 'layer' ? 'Trazados, rellenos y transformaciones conservados · ' : 'Vectores conservados; píxeles y texto sin convertir se incrustan · '
          : format === 'image/webp'
          ? 'WEBP no guarda resolución en el archivo · '
          : `Resolución embebida${format === 'image/png' ? ' · sRGB' : ''} · `}
        {calculating ? 'calculando…' : size != null ? `≈ ${humanSize(size)}` : '—'}
      </div>
    </Modal>
  );
}
