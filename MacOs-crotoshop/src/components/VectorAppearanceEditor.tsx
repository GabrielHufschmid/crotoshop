import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { VectorGradient, VectorStyle, VectorStrokeAlign } from '../types';
import type { VectorBounds } from '../engine/vectorPath';
import { hexToRgb, rgbToHex, tuneHexColor } from '../engine/color';
import { ColorPickerPopover } from './ColorPickerPopover';
import { Icon } from './Icons';
import { NumericControl } from './NumericControl';

type PaintTarget = 'fill' | 'stroke';
type PaintMode = 'none' | 'solid' | 'linear' | 'radial';

interface Props {
  style: VectorStyle;
  bounds: VectorBounds;
  onBegin: (label?: string) => void;
  onPatch: (patch: Partial<VectorStyle>, captureHistory?: boolean) => void;
}

function usableHex(value: string | null | undefined, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : fallback;
}

function mixHex(left: string, right: string, amount: number): string {
  const a = hexToRgb(usableHex(left, '#4c8dff'));
  const b = hexToRgb(usableHex(right, '#ffffff'));
  return rgbToHex(a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount)) as [number, number, number]);
}

function paintMode(style: VectorStyle, target: PaintTarget): PaintMode {
  const gradient = target === 'fill' ? style.fillGradient : style.strokeGradient;
  if (gradient) return gradient.type;
  return (target === 'fill' ? style.fill : style.stroke) ? 'solid' : 'none';
}

function defaultGradient(type: VectorGradient['type'], bounds: VectorBounds, color: string): VectorGradient {
  const width = Math.max(1, bounds.w);
  const height = Math.max(1, bounds.h);
  const center = { x: bounds.x + width / 2, y: bounds.y + height / 2 };
  const dark = tuneHexColor(usableHex(color, '#4c8dff'), { brightness: -28, saturation: 8 });
  return {
    type,
    from: type === 'radial' ? center : { x: bounds.x, y: center.y },
    to: type === 'radial' ? { x: center.x + Math.max(width, height) / 2, y: center.y } : { x: bounds.x + width, y: center.y },
    stops: [
      { offset: 0, color: usableHex(color, '#4c8dff') },
      { offset: 1, color: dark },
    ],
  };
}

function gradientCss(gradient: VectorGradient): string {
  const stops = [...gradient.stops]
    .sort((left, right) => left.offset - right.offset)
    .map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
    .join(', ');
  return `linear-gradient(90deg, ${stops})`;
}

function gradientAngle(gradient: VectorGradient): number {
  return (Math.atan2(gradient.to.y - gradient.from.y, gradient.to.x - gradient.from.x) * 180 / Math.PI + 360) % 360;
}

function withGradientAngle(gradient: VectorGradient, degrees: number): VectorGradient {
  const radians = degrees * Math.PI / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  if (gradient.type === 'radial') {
    const radius = Math.max(1, Math.hypot(gradient.to.x - gradient.from.x, gradient.to.y - gradient.from.y));
    return { ...gradient, to: { x: gradient.from.x + direction.x * radius, y: gradient.from.y + direction.y * radius } };
  }
  const center = { x: (gradient.from.x + gradient.to.x) / 2, y: (gradient.from.y + gradient.to.y) / 2 };
  const radius = Math.max(0.5, Math.hypot(gradient.to.x - gradient.from.x, gradient.to.y - gradient.from.y) / 2);
  return {
    ...gradient,
    from: { x: center.x - direction.x * radius, y: center.y - direction.y * radius },
    to: { x: center.x + direction.x * radius, y: center.y + direction.y * radius },
  };
}

function dashPreset(style: VectorStyle): 'solid' | 'dash' | 'dot' | 'dash-dot' | 'custom' {
  const dash = style.dashArray ?? [];
  if (!dash.length) return 'solid';
  if (dash.length === 2 && dash[0] === 0) return 'dot';
  if (dash.length === 2) return 'dash';
  if (dash.length === 4 && dash[2] === 0) return 'dash-dot';
  return 'custom';
}

export function VectorAppearanceEditor({ style, bounds, onBegin, onPatch }: Props) {
  const [activeGradient, setActiveGradient] = useState<PaintTarget>('fill');
  const [selectedStop, setSelectedStop] = useState(0);
  const [colorTarget, setColorTarget] = useState<PaintTarget | 'stop' | null>(null);
  const continuousRef = useRef(false);
  const fillColorRef = useRef<HTMLButtonElement>(null);
  const strokeColorRef = useRef<HTMLButtonElement>(null);
  const stopColorRef = useRef<HTMLButtonElement>(null);

  const fillMode = paintMode(style, 'fill');
  const strokeMode = paintMode(style, 'stroke');
  const gradient = activeGradient === 'fill' ? style.fillGradient : style.strokeGradient;
  const selectedStopIndex = gradient ? Math.min(selectedStop, gradient.stops.length - 1) : 0;
  const stop = gradient?.stops[selectedStopIndex];

  const beginContinuous = (label = 'Editar apariencia vectorial') => {
    if (continuousRef.current) return;
    onBegin(label);
    continuousRef.current = true;
  };
  const endContinuous = () => { continuousRef.current = false; };

  const patchGradient = (target: PaintTarget, next: VectorGradient, captureHistory = true) => {
    if (target === 'fill') onPatch({ fill: null, fillGradient: next }, captureHistory);
    else onPatch({ stroke: null, strokeGradient: next }, captureHistory);
  };

  const changeMode = (target: PaintTarget, mode: PaintMode) => {
    setActiveGradient(target);
    setSelectedStop(0);
    const currentGradient = target === 'fill' ? style.fillGradient : style.strokeGradient;
    const solid = target === 'fill'
      ? usableHex(style.fill ?? currentGradient?.stops[0]?.color, '#4c8dff')
      : usableHex(style.stroke ?? currentGradient?.stops[0]?.color, '#ffffff');
    if (mode === 'none') {
      onPatch(target === 'fill' ? { fill: null, fillGradient: undefined } : { stroke: null, strokeGradient: undefined });
    } else if (mode === 'solid') {
      onPatch(target === 'fill' ? { fill: solid, fillGradient: undefined } : { stroke: solid, strokeGradient: undefined });
    } else {
      patchGradient(target, currentGradient ? { ...currentGradient, type: mode } : defaultGradient(mode, bounds, solid));
    }
  };

  const setSolidColor = (target: PaintTarget, color: string) => {
    beginContinuous(target === 'fill' ? 'Cambiar relleno vectorial' : 'Cambiar trazo vectorial');
    onPatch(target === 'fill' ? { fill: color, fillGradient: undefined } : { stroke: color, strokeGradient: undefined }, false);
  };

  const updateGradient = (next: VectorGradient) => {
    patchGradient(activeGradient, next, false);
  };

  const updateStop = (patch: Partial<NonNullable<typeof stop>>) => {
    if (!gradient || !stop) return;
    const stops = gradient.stops.map((candidate, index) => index === selectedStopIndex ? { ...candidate, ...patch } : candidate);
    updateGradient({ ...gradient, stops });
  };

  const addStop = () => {
    if (!gradient || gradient.stops.length >= 16) return;
    const sorted = [...gradient.stops].sort((left, right) => left.offset - right.offset);
    let left = sorted[0];
    let right = sorted[sorted.length - 1];
    let widest = -1;
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const span = sorted[index + 1].offset - sorted[index].offset;
      if (span > widest) {
        widest = span;
        left = sorted[index];
        right = sorted[index + 1];
      }
    }
    const offset = (left.offset + right.offset) / 2;
    const color = mixHex(left.color, right.color, 0.5);
    const stops = [...gradient.stops, { offset, color }];
    setSelectedStop(stops.length - 1);
    patchGradient(activeGradient, { ...gradient, stops });
  };

  const removeStop = () => {
    if (!gradient || gradient.stops.length <= 2) return;
    const stops = gradient.stops.filter((_, index) => index !== selectedStopIndex);
    setSelectedStop(Math.max(0, Math.min(selectedStopIndex, stops.length - 1)));
    patchGradient(activeGradient, { ...gradient, stops });
  };

  const renderPaintRow = (target: PaintTarget, mode: PaintMode) => {
    const label = target === 'fill' ? 'Relleno' : 'Trazo';
    const solid = target === 'fill' ? usableHex(style.fill, '#4c8dff') : usableHex(style.stroke, '#ffffff');
    const targetGradient = target === 'fill' ? style.fillGradient : style.strokeGradient;
    const buttonRef = target === 'fill' ? fillColorRef : strokeColorRef;
    return (
      <div className={`vector-paint-row ${activeGradient === target && targetGradient ? 'active' : ''}`}>
        <span>{label}</span>
        <select value={mode} aria-label={`Tipo de ${label.toLowerCase()}`} onChange={(event) => changeMode(target, event.target.value as PaintMode)}>
          <option value="none">Ninguno</option>
          <option value="solid">Color</option>
          <option value="linear">Lineal</option>
          <option value="radial">Radial</option>
        </select>
        {mode === 'solid' && <button ref={buttonRef} className="vector-color-button" title={`Color de ${label.toLowerCase()}`} onClick={() => setColorTarget(target)}>
          <i style={{ background: solid }} /><code>{solid.toUpperCase()}</code>
        </button>}
        {targetGradient && <button className="vector-gradient-mini" title={`Editar degradado de ${label.toLowerCase()}`}
          style={{ background: gradientCss(targetGradient) }} onClick={() => { setActiveGradient(target); setSelectedStop(0); }} />}
      </div>
    );
  };

  const dash = dashPreset(style);
  const dashLength = style.dashArray?.[0] ?? Math.max(1, style.strokeWidth * 4);
  const gapLength = style.dashArray?.[1] ?? Math.max(1, style.strokeWidth * 2);
  const setDashPreset = (preset: string) => {
    const width = Math.max(0.1, style.strokeWidth);
    if (preset === 'solid') onPatch({ dashArray: undefined, dashOffset: 0 });
    else if (preset === 'dash') onPatch({ dashArray: [width * 4, width * 2.5] });
    else if (preset === 'dot') onPatch({ dashArray: [0, width * 2.25], lineCap: 'round' });
    else if (preset === 'dash-dot') onPatch({ dashArray: [width * 4, width * 2, 0, width * 2], lineCap: 'round' });
    else onPatch({ dashArray: [width * 4, width * 2] });
  };

  return (
    <div className="vector-appearance-editor">
      {renderPaintRow('fill', fillMode)}
      {renderPaintRow('stroke', strokeMode)}

      {gradient && stop && <div className="vector-gradient-editor">
        <div className="vector-gradient-track" style={{ background: gradientCss(gradient) }}>
          {gradient.stops.map((candidate, index) => <button key={`${index}-${candidate.offset}`} className={selectedStopIndex === index ? 'on' : ''}
            title={`${Math.round(candidate.offset * 100)}%`} style={{ left: `${candidate.offset * 100}%`, background: candidate.color }}
            onClick={() => { setSelectedStop(index); setActiveGradient(activeGradient); }} />)}
        </div>
        <div className="vector-gradient-controls">
          <button ref={stopColorRef} className="vector-stop-color" title="Color de la parada" onClick={() => setColorTarget('stop')}>
            <i style={{ background: usableHex(stop.color, '#ffffff') }} />
          </button>
          <NumericControl label="Pos." value={stop.offset * 100} min={0} max={100} step={1} suffix="%"
            onBegin={() => onBegin('Mover parada de degradado')} onChange={(value) => updateStop({ offset: value / 100 })} />
          <NumericControl label="Ángulo" value={gradientAngle(gradient)} min={0} max={360} step={1} suffix="°"
            onBegin={() => onBegin('Girar degradado')} onChange={(value) => updateGradient(withGradientAngle(gradient, value))} />
          <button className="icon-btn" title="Agregar parada" onClick={addStop}><Icon name="plus" size={13} /></button>
          <button className="icon-btn" title="Eliminar parada" disabled={gradient.stops.length <= 2} onClick={removeStop}><Icon name="trash" size={13} /></button>
        </div>
      </div>}

      {strokeMode !== 'none' && <div className="vector-stroke-editor">
        <NumericControl label="Grosor" value={style.strokeWidth} min={0.1} max={500} step={0.1} decimals={1} suffix="px"
          onBegin={() => onBegin('Cambiar grosor vectorial')} onChange={(value) => onPatch({ strokeWidth: value }, false)} />
        <div className="seg vector-stroke-align" aria-label="Alineación del trazo">
          {(['inside', 'center', 'outside'] as VectorStrokeAlign[]).map((value) => <button key={value} className={(style.strokeAlign ?? 'center') === value ? 'on' : ''}
            title={value === 'inside' ? 'Trazo hacia adentro' : value === 'center' ? 'Trazo centrado' : 'Trazo hacia afuera'}
            onClick={() => onPatch({ strokeAlign: value })}>
            <Icon name={value === 'inside' ? 'stroke-inside' : value === 'center' ? 'stroke-center' : 'stroke-outside'} size={14} />
          </button>)}
        </div>
        <label><span>Extremos</span><select value={style.lineCap} onChange={(event) => onPatch({ lineCap: event.target.value as VectorStyle['lineCap'] })}>
          <option value="butt">Rectos</option><option value="round">Redondos</option><option value="square">Cuadrados</option>
        </select></label>
        <label><span>Uniones</span><select value={style.lineJoin} onChange={(event) => onPatch({ lineJoin: event.target.value as VectorStyle['lineJoin'] })}>
          <option value="miter">Punta</option><option value="round">Redondas</option><option value="bevel">Bisel</option>
        </select></label>
        <label><span>Línea</span><select value={dash} onChange={(event) => setDashPreset(event.target.value)}>
          <option value="solid">Continua</option><option value="dash">Guiones</option><option value="dot">Puntos</option><option value="dash-dot">Guión y punto</option><option value="custom">Personalizada</option>
        </select></label>
        {dash !== 'solid' && <>
          <NumericControl label="Guión" value={dashLength} min={0} max={1000} step={0.5} decimals={1} suffix="px"
            onBegin={() => onBegin('Editar patrón de trazo')} onChange={(value) => onPatch({ dashArray: [value, gapLength, ...(style.dashArray?.slice(2) ?? [])] }, false)} />
          <NumericControl label="Espacio" value={gapLength} min={0.1} max={1000} step={0.5} decimals={1} suffix="px"
            onBegin={() => onBegin('Editar patrón de trazo')} onChange={(value) => onPatch({ dashArray: [dashLength, value, ...(style.dashArray?.slice(2) ?? [])] }, false)} />
          <NumericControl label="Desfase" value={style.dashOffset ?? 0} min={-10000} max={10000} step={0.5} decimals={1} suffix="px"
            onBegin={() => onBegin('Desplazar patrón de trazo')} onChange={(value) => onPatch({ dashOffset: value }, false)} />
        </>}
        {style.lineJoin === 'miter' && <NumericControl label="Límite" value={style.miterLimit} min={1} max={100} step={0.5} decimals={1}
          onBegin={() => onBegin('Editar límite de unión')} onChange={(value) => onPatch({ miterLimit: value }, false)} />}
      </div>}

      <div className="vector-opacity-rule">
        <NumericControl label="Opacidad" value={style.opacity * 100} min={0} max={100} step={1} suffix="%"
          onBegin={() => onBegin('Cambiar opacidad vectorial')} onChange={(value) => onPatch({ opacity: value / 100 }, false)} />
        <label><span>Relleno</span><select value={style.fillRule} onChange={(event) => onPatch({ fillRule: event.target.value as VectorStyle['fillRule'] })}>
          <option value="nonzero">No cero</option><option value="evenodd">Par-impar</option>
        </select></label>
      </div>

      {colorTarget && <ColorPickerPopover
        color={colorTarget === 'fill' ? usableHex(style.fill, '#4c8dff') : colorTarget === 'stroke' ? usableHex(style.stroke, '#ffffff') : usableHex(stop?.color, '#ffffff')}
        anchorRef={(colorTarget === 'fill' ? fillColorRef : colorTarget === 'stroke' ? strokeColorRef : stopColorRef) as RefObject<HTMLElement | null>}
        placement="top"
        onChange={(color) => {
          if (colorTarget === 'stop') {
            beginContinuous('Cambiar color de degradado');
            updateStop({ color });
          }
          else setSolidColor(colorTarget, color);
        }}
        onClose={() => { endContinuous(); setColorTarget(null); }}
      />}
    </div>
  );
}
