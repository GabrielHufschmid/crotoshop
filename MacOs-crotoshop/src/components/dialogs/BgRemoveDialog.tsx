import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editorStore';
import { refineAlpha } from '../../engine/bgRefine';
import type { RefineOptions } from '../../engine/bgRefine';

interface Props {
  /** Raw output of the AI model, before any refinement. */
  raw: HTMLCanvasElement;
  onClose: () => void;
}

export function BgRemoveDialog({ raw, onClose }: Props) {
  const replaceActiveCanvas = useEditor((s) => s.replaceActiveCanvas);
  const toast = useEditor((s) => s.toast);
  const [opts, setOpts] = useState<RefineOptions>({ threshold: 0, feather: 0 });
  const previewRef = useRef<HTMLCanvasElement>(null);
  const refinedRef = useRef<HTMLCanvasElement>(raw);

  // Refine + redraw the preview (debounced while sliding).
  useEffect(() => {
    const t = setTimeout(() => {
      refinedRef.current = refineAlpha(raw, opts);
      const cv = previewRef.current;
      if (!cv) return;
      const maxW = 372, maxH = 280;
      const scale = Math.min(maxW / raw.width, maxH / raw.height, 1);
      cv.width = Math.max(1, Math.round(raw.width * scale));
      cv.height = Math.max(1, Math.round(raw.height * scale));
      const g = cv.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(refinedRef.current, 0, 0, cv.width, cv.height);
    }, 60);
    return () => clearTimeout(t);
  }, [raw, opts]);

  const apply = () => {
    replaceActiveCanvas(refinedRef.current);
    toast('Fondo eliminado');
    onClose();
  };

  return (
    <Modal
      title="Quitar fondo — ajustar resultado"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button className="tbtn" onClick={onClose}>Cancelar</button>
          <button className="tbtn primary" onClick={apply}>Aplicar</button>
        </>
      }
    >
      <div className="bg-preview">
        <canvas ref={previewRef} />
      </div>

      <div className="field">
        <div className="row">
          <label>Umbral de transparencia</label>
          <span className="val">{opts.threshold}</span>
        </div>
        <input type="range" min={0} max={200} step={1} value={opts.threshold}
          onChange={(e) => setOpts({ ...opts, threshold: parseInt(e.target.value) })} />
        <div className="hint-sub">Sube para eliminar restos semitransparentes del fondo.</div>
      </div>

      <div className="field">
        <div className="row">
          <label>Suavizado del borde</label>
          <span className="val">{opts.feather}px</span>
        </div>
        <input type="range" min={0} max={20} step={1} value={opts.feather}
          onChange={(e) => setOpts({ ...opts, feather: parseInt(e.target.value) })} />
        <div className="hint-sub">Difumina el contorno para integrarlo mejor.</div>
      </div>
    </Modal>
  );
}
