import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editorStore';
import { useSettings } from '../../store/settingsStore';
import { createCanvas, ctx2d } from '../../engine/canvasUtils';

const PRESETS = [
  { label: 'HD', width: 1920, height: 1080, note: '16:9' },
  { label: 'Vertical HD', width: 1080, height: 1920, note: '9:16' },
  { label: 'Cuadrado', width: 1080, height: 1080, note: '1:1' },
  { label: '4K', width: 3840, height: 2160, note: '16:9' },
  { label: 'Historia', width: 1080, height: 1920, note: '9:16' },
  { label: 'Post', width: 1080, height: 1350, note: '4:5' },
] as const;

async function imageBlobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const canvas = createCanvas(bmp.width, bmp.height);
  ctx2d(canvas).drawImage(bmp, 0, 0);
  bmp.close();
  return canvas;
}

async function readClipboardImage(): Promise<HTMLCanvasElement | null> {
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) return imageBlobToCanvas(await item.getType(type));
  }
  return null;
}

export function NewDocumentDialog({ onClose, autoClipboard = false }: { onClose: () => void; autoClipboard?: boolean }) {
  const newDocument = useEditor((s) => s.newDocument);
  const newDocumentFromCanvas = useEditor((s) => s.newDocumentFromCanvas);
  const toast = useEditor((s) => s.toast);
  const newDefaults = useSettings((s) => s.newDocumentDefaults);
  const setNewDocumentDefaults = useSettings((s) => s.setNewDocumentDefaults);
  const [w, setW] = useState(newDefaults.width);
  const [h, setH] = useState(newDefaults.height);
  const [name, setName] = useState(newDefaults.name);
  const [clip, setClip] = useState<HTMLCanvasElement | null>(null);
  const [reading, setReading] = useState(false);
  const didAuto = useRef(false);

  const fromClipboard = async () => {
    setReading(true);
    try {
      const canvas = await readClipboardImage();
      if (!canvas) {
        toast('El portapapeles no contiene una imagen', 'error');
        return;
      }
      setClip(canvas);
      setW(canvas.width);
      setH(canvas.height);
      setName('Portapapeles');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo leer el portapapeles', 'error');
    } finally {
      setReading(false);
    }
  };

  useEffect(() => {
    if (!autoClipboard || didAuto.current) return;
    didAuto.current = true;
    void fromClipboard();
  });

  const create = () => {
    const width = Math.max(1, Math.round(w));
    const height = Math.max(1, Math.round(h));
    const finalName = name.trim() || (clip ? 'Portapapeles' : 'Sin título');
    setNewDocumentDefaults({ width, height, name: finalName });
    if (clip) {
      if (clip.width === width && clip.height === height) {
        newDocumentFromCanvas(clip, finalName);
      } else {
        const scaled = createCanvas(width, height);
        const g = ctx2d(scaled);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(clip, 0, 0, width, height);
        newDocumentFromCanvas(scaled, finalName);
      }
    } else {
      newDocument(width, height, finalName);
    }
    onClose();
  };

  const applyPreset = (preset: typeof PRESETS[number]) => {
    setW(preset.width);
    setH(preset.height);
  };

  return (
    <Modal
      title="Nuevo archivo"
      width={380}
      onClose={onClose}
      footer={
        <>
          <button className="tbtn" onClick={onClose}>Cancelar</button>
          <button className="tbtn primary" onClick={create}>Crear</button>
        </>
      }
    >
      <div className="field-row">
        <label>Nombre</label>
        <input className="text-input" style={{ width: 170 }} value={name}
          onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field-row">
        <label>Ancho</label>
        <div>
          <input className="num-input" type="number" min={1} value={w}
            onChange={(e) => setW(parseInt(e.target.value) || 1)} /> <span>px</span>
        </div>
      </div>
      <div className="field-row">
        <label>Alto</label>
        <div>
          <input className="num-input" type="number" min={1} value={h}
            onChange={(e) => setH(parseInt(e.target.value) || 1)} /> <span>px</span>
        </div>
      </div>
      <div className="new-document-presets" aria-label="Presets de documento">
        <span>Presets</span>
        <div>
          {PRESETS.map((preset) => (
            <button
              key={`${preset.width}x${preset.height}-${preset.label}`}
              type="button"
              className={`new-document-preset ${w === preset.width && h === preset.height ? 'on' : ''}`}
              onClick={() => applyPreset(preset)}
            >
              <strong>{preset.label}</strong>
              <small>{preset.width} × {preset.height} · {preset.note}</small>
            </button>
          ))}
        </div>
      </div>
      <button className="tbtn" onClick={fromClipboard} disabled={reading}>
        {reading ? 'Leyendo…' : 'Usar imagen del portapapeles'}
      </button>
      {clip && (
        <div className="hint-sub">
          Portapapeles: {clip.width} × {clip.height}px. Se creará con esa imagen si no cambiás las dimensiones.
        </div>
      )}
    </Modal>
  );
}
