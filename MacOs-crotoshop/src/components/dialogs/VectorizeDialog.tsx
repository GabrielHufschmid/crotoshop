import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../store/editorStore';
import { useSettings } from '../../store/settingsStore';
import type { VectorizeOptions } from '../../types';
import { Icon } from '../Icons';
import { Modal } from './Modal';
import { NumericControl } from '../NumericControl';

interface Props {
  layerId: string;
  onClose: () => void;
}

const PRESETS: Array<{ name: string; options: Partial<VectorizeOptions> }> = [
  { name: 'Logo', options: { mode: 'silhouette', threshold: 155, detail: 88, smoothing: 24, colors: 2, ignoreWhite: true } },
  { name: 'Ilustración', options: { mode: 'color', colors: 12, detail: 76, smoothing: 38, ignoreWhite: true } },
  { name: 'Foto', options: { mode: 'color', colors: 24, detail: 62, smoothing: 48, ignoreWhite: false } },
];

export function VectorizeDialog({ layerId, onClose }: Props) {
  const layer = useEditor((state) => state.doc?.layers.find((candidate) => candidate.id === layerId) ?? null);
  const vectorizeLayer = useEditor((state) => state.vectorizeLayer);
  const defaults = useSettings((state) => state.vectorizeDefaults);
  const setDefaults = useSettings((state) => state.setVectorizeDefaults);
  const [options, setOptions] = useState<VectorizeOptions>({ ...defaults });
  const [working, setWorking] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const patch = (next: Partial<VectorizeOptions>) => {
    setOptions((current) => ({ ...current, ...next }));
    setDefaults(next);
  };

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !layer) return;
    const context = preview.getContext('2d');
    if (!context) return;
    const scale = Math.min(preview.width / layer.canvas.width, preview.height / layer.canvas.height);
    const width = layer.canvas.width * scale;
    const height = layer.canvas.height * scale;
    context.clearRect(0, 0, preview.width, preview.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(layer.canvas, (preview.width - width) / 2, (preview.height - height) / 2, width, height);
    if (options.mode === 'silhouette') {
      const image = context.getImageData(0, 0, preview.width, preview.height);
      for (let index = 0; index < image.data.length; index += 4) {
        const alpha = image.data[index + 3];
        const luma = image.data[index] * 0.2126 + image.data[index + 1] * 0.7152 + image.data[index + 2] * 0.0722;
        const inside = alpha > 0 && luma <= options.threshold;
        image.data[index] = inside ? 20 : 0;
        image.data[index + 1] = inside ? 115 : 0;
        image.data[index + 2] = inside ? 230 : 0;
        image.data[index + 3] = inside ? 255 : 0;
      }
      context.putImageData(image, 0, 0);
    }
  }, [layer, options.mode, options.threshold]);

  const apply = async () => {
    if (working) return;
    setWorking(true);
    const result = await vectorizeLayer(layerId, options);
    setWorking(false);
    if (result) onClose();
  };

  return (
    <Modal
      title="Vectorizar imagen"
      width={500}
      onClose={working ? () => undefined : onClose}
      footer={<>
        <button className="tbtn" disabled={working} onClick={onClose}>Cancelar</button>
        <button className="tbtn primary" disabled={working || !layer} onClick={() => void apply()}>
          <Icon name="vectorize" size={15} />{working ? 'Vectorizando…' : 'Vectorizar'}
        </button>
      </>}
    >
      <div className="vectorize-layout">
        <div className="vectorize-preview checker"><canvas ref={previewRef} width={210} height={154} /></div>
        <div className="vectorize-controls">
          <div className="seg vectorize-presets">
            {PRESETS.map((preset) => <button key={preset.name} onClick={() => patch(preset.options)}>{preset.name}</button>)}
          </div>
          <div className="field-row compact">
            <span>Modo</span>
            <div className="seg">
              <button className={options.mode === 'color' ? 'on' : ''} onClick={() => patch({ mode: 'color' })}>Color</button>
              <button className={options.mode === 'silhouette' ? 'on' : ''} onClick={() => patch({ mode: 'silhouette' })}>Silueta</button>
            </div>
          </div>
          {options.mode === 'color'
            ? <NumericControl label="Colores" value={options.colors} min={2} max={32} step={1}
                onChange={(value) => patch({ colors: Math.round(value) })} />
            : <NumericControl label="Umbral" value={options.threshold} min={1} max={254} step={1}
                onChange={(value) => patch({ threshold: Math.round(value) })} />}
          <NumericControl label="Detalle" value={options.detail} min={0} max={100} step={1} suffix="%"
            onChange={(value) => patch({ detail: value })} />
          <input type="range" min={0} max={100} step={1} value={options.detail}
            aria-label="Detalle" onChange={(event) => patch({ detail: Number(event.target.value) })} />
          <NumericControl label="Suavidad" value={options.smoothing} min={0} max={100} step={1} suffix="%"
            onChange={(value) => patch({ smoothing: value })} />
          <input type="range" min={0} max={100} step={1} value={options.smoothing}
            aria-label="Suavidad" onChange={(event) => patch({ smoothing: Number(event.target.value) })} />
          <label className="checkbox"><input type="checkbox" checked={options.ignoreWhite}
            onChange={(event) => patch({ ignoreWhite: event.target.checked })} />Ignorar blanco</label>
          <label className="checkbox"><input type="checkbox" checked={options.preserveOriginal}
            onChange={(event) => patch({ preserveOriginal: event.target.checked })} />Conservar original oculto</label>
        </div>
      </div>
    </Modal>
  );
}
