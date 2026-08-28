import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editorStore';
import type { PendingImport } from '../../hooks/useImport';

const SCALES = [0.5, 1, 2, 3, 4];

export function RasterizeDialog({ pending, onClose }: { pending: PendingImport; onClose: () => void }) {
  const addLayerCanvas = useEditor((s) => s.addLayerCanvas);
  const addVectorLayer = useEditor((s) => s.addVectorLayer);
  const newDocumentFromCanvas = useEditor((s) => s.newDocumentFromCanvas);
  const toast = useEditor((s) => s.toast);
  const [scale, setScale] = useState(2);
  const [importAs, setImportAs] = useState<'vector' | 'raster'>('vector');
  const [page, setPage] = useState(1);
  const [base, setBase] = useState<{ w: number; h: number } | null>(
    pending.kind === 'vector' ? { w: pending.baseWidth, h: pending.baseHeight } : null,
  );
  const [rendering, setRendering] = useState(false);

  // Fetch PDF page dimensions when the selected page changes.
  useEffect(() => {
    let cancelled = false;
    if (pending.kind === 'pdf') {
      pending.pageSize(page).then((sz) => { if (!cancelled) setBase(sz); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [pending, page]);

  const outW = base ? Math.round(base.w * scale) : null;
  const outH = base ? Math.round(base.h * scale) : null;

  const doImport = async () => {
    setRendering(true);
    try {
      if (pending.kind === 'vector' && importAs === 'vector') {
        const preview = await pending.rasterize(1);
        addVectorLayer(
          {
            kind: 'placed',
            sourceType: pending.svgText ? 'svg' : 'eps',
            svgText: pending.svgText,
            baseWidth: pending.baseWidth,
            baseHeight: pending.baseHeight,
            rasterize: pending.rasterize,
          },
          preview,
          pending.name,
          pending.mode === 'document',
        );
        onClose();
        return;
      }
      if (pending.kind === 'pdf' && importAs === 'vector') {
        // Placed PDF page: keep the page renderer as the vector source so
        // transforms re-rasterize crisply.
        const sz = base ?? (await pending.pageSize(page));
        const rasterize = (s: number) => pending.renderPage(page, s);
        const preview = await rasterize(1);
        const name = pending.numPages > 1 ? `${pending.name} (p.${page})` : pending.name;
        addVectorLayer(
          {
            kind: 'placed',
            sourceType: 'pdf',
            baseWidth: sz.w,
            baseHeight: sz.h,
            rasterize,
          },
          preview,
          name,
          pending.mode === 'document',
        );
        onClose();
        return;
      }
      const canvas =
        pending.kind === 'pdf'
          ? await pending.renderPage(page, scale)
          : await pending.rasterize(scale);
      const name = pending.kind === 'pdf' ? `${pending.name} (p.${page})` : pending.name;
      if (pending.mode === 'document') newDocumentFromCanvas(canvas, name);
      else addLayerCanvas(canvas, name);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo rasterizar', 'error');
      onClose();
    } finally {
      setRendering(false);
    }
  };

  return (
    <Modal
      title={pending.kind === 'pdf' ? 'Importar PDF' : 'Importar vector'}
      onClose={onClose}
      footer={
        <>
          <button className="tbtn" onClick={onClose} disabled={rendering}>Cancelar</button>
          <button className="tbtn primary" onClick={doImport} disabled={rendering}>
            {rendering ? 'Rasterizando…' : 'Importar'}
          </button>
        </>
      }
    >
      <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
        Los archivos vectoriales pueden conservarse como vectores colocados o rasterizarse a píxeles.
      </div>

      <div className="field-row">
        <label>Importar como</label>
        <div className="seg">
          <button className={importAs === 'vector' ? 'on' : ''} onClick={() => setImportAs('vector')}>
            Vectores
          </button>
          <button className={importAs === 'raster' ? 'on' : ''} onClick={() => setImportAs('raster')}>
            Rasterizado
          </button>
        </div>
      </div>

      {pending.kind === 'pdf' && pending.numPages > 1 && (
        <div className="field-row">
          <label>Página</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input className="num-input" type="number" min={1} max={pending.numPages}
              value={page}
              onChange={(e) => setPage(Math.max(1, Math.min(pending.numPages, parseInt(e.target.value) || 1)))} />
            <span style={{ color: 'var(--text-faint)' }}>de {pending.numPages}</span>
          </div>
        </div>
      )}

      {importAs === 'raster' && (
        <div className="field-row">
          <label>Escala</label>
          <select className="text-input" style={{ width: 120 }}
            value={scale} onChange={(e) => setScale(parseFloat(e.target.value))}>
            {SCALES.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </div>
      )}

      <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
        {importAs === 'vector'
          ? base ? `Vector colocado: ${Math.round(base.w)} × ${Math.round(base.h)}px` : 'Calculando tamaño…'
          : outW && outH ? `Resultado: ${outW} × ${outH}px` : 'Calculando tamaño…'}
      </div>
    </Modal>
  );
}
