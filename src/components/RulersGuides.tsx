import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useEditor } from '../store/editorStore';
import { useSettings } from '../store/settingsStore';
import type { Unit } from '../types';
import { CM_PER_INCH } from '../engine/units';

export const RULER_SIZE = 22;

const PX_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const CM_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

function pickStep(zoom: number, unit: Unit, ppi: number): { stepPx: number; label: (docPx: number) => string } {
  if (unit === 'px') {
    const step = PX_STEPS.find((s) => s * zoom >= 55) ?? PX_STEPS[PX_STEPS.length - 1];
    return { stepPx: step, label: (d) => `${Math.round(d)}` };
  }
  const pxPerCm = ppi / CM_PER_INCH;
  const stepCm = CM_STEPS.find((s) => s * pxPerCm * zoom >= 55) ?? CM_STEPS[CM_STEPS.length - 1];
  return {
    stepPx: stepCm * pxPerCm,
    label: (d) => {
      const cm = d / pxPerCm;
      return `${parseFloat(cm.toFixed(2))}`;
    },
  };
}

function drawRuler(
  canvas: HTMLCanvasElement,
  axis: 'x' | 'y', // 'x': horizontal ruler (measures doc x)
  lengthCss: number,
  pan: number,
  zoom: number,
  unit: Unit,
  ppi: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  const wCss = axis === 'x' ? lengthCss : RULER_SIZE;
  const hCss = axis === 'x' ? RULER_SIZE : lengthCss;
  if (canvas.width !== Math.round(wCss * dpr) || canvas.height !== Math.round(hCss * dpr)) {
    canvas.width = Math.round(wCss * dpr);
    canvas.height = Math.round(hCss * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, wCss, hCss);
  g.fillStyle = '#16181d';
  g.fillRect(0, 0, wCss, hCss);
  g.strokeStyle = '#2b303a';
  g.beginPath();
  if (axis === 'x') { g.moveTo(0, RULER_SIZE - 0.5); g.lineTo(wCss, RULER_SIZE - 0.5); }
  else { g.moveTo(RULER_SIZE - 0.5, 0); g.lineTo(RULER_SIZE - 0.5, hCss); }
  g.stroke();

  const { stepPx, label } = pickStep(zoom, unit, ppi);
  const minorPx = stepPx / 5;
  const showMinor = minorPx * zoom >= 5;

  const docStart = (0 - pan) / zoom;
  const docEnd = (lengthCss - pan) / zoom;
  const k0 = Math.floor(docStart / stepPx);
  const k1 = Math.ceil(docEnd / stepPx);

  g.font = '9px -apple-system, sans-serif';
  g.fillStyle = '#6b7280';
  g.strokeStyle = '#3a414f';
  g.beginPath();
  for (let k = k0; k <= k1; k++) {
    const doc = k * stepPx;
    const s = pan + doc * zoom;
    if (axis === 'x') {
      g.moveTo(s + 0.5, 6); g.lineTo(s + 0.5, RULER_SIZE);
      g.fillText(label(doc), s + 3, 10);
    } else {
      g.moveTo(6, s + 0.5); g.lineTo(RULER_SIZE, s + 0.5);
      g.save();
      g.translate(10, s + 3);
      g.rotate(-Math.PI / 2);
      g.textAlign = 'right';
      g.fillText(label(doc), 0, 0);
      g.restore();
    }
    if (showMinor) {
      for (let m = 1; m < 5; m++) {
        const sm = pan + (doc + m * minorPx) * zoom;
        if (axis === 'x') { g.moveTo(sm + 0.5, RULER_SIZE - 6); g.lineTo(sm + 0.5, RULER_SIZE); }
        else { g.moveTo(RULER_SIZE - 6, sm + 0.5); g.lineTo(RULER_SIZE, sm + 0.5); }
      }
    }
  }
  g.stroke();

}

/** Starts dragging a guide; shared by ruler creation and guide re-drag. */
function startGuideDrag(
  guideId: string,
  axis: 'x' | 'y',
  stage: HTMLElement,
): void {
  const onMove = (ev: PointerEvent) => {
    const rect = stage.getBoundingClientRect();
    const s = useEditor.getState();
    const pos = axis === 'x'
      ? (ev.clientX - rect.left - s.panX) / s.zoom
      : (ev.clientY - rect.top - s.panY) / s.zoom;
    s.moveGuide(guideId, pos);
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const rect = stage.getBoundingClientRect();
    // Dropping back onto (or past) the ruler removes the guide.
    const overRuler = axis === 'x'
      ? ev.clientX - rect.left <= RULER_SIZE
      : ev.clientY - rect.top <= RULER_SIZE;
    if (overRuler) useEditor.getState().removeGuide(guideId);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

export function Rulers() {
  const zoom = useEditor((s) => s.zoom);
  const panX = useEditor((s) => s.panX);
  const panY = useEditor((s) => s.panY);
  const cursor = useEditor((s) => s.cursor);
  const unit = useSettings((s) => s.unit);
  const ppi = useSettings((s) => s.ppi);

  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    axis: 'x' | 'y';
    x: number;
    y: number;
    value: number;
  } | null>(null);

  // El cursor NO está en las deps a propósito: redibujar dos canvas completos
  // de regla en cada pointermove era el mayor costo por frame del stage. El
  // indicador de posición son dos divs baratos (ver JSX) que React reposiciona
  // sin tocar los canvas.
  useEffect(() => {
    const draw = () => {
      const stage = wrapRef.current?.parentElement;
      if (!stage) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (topRef.current) {
        drawRuler(topRef.current, 'x', w - RULER_SIZE, panX - RULER_SIZE, zoom, unit, ppi);
      }
      if (leftRef.current) {
        drawRuler(leftRef.current, 'y', h - RULER_SIZE, panY - RULER_SIZE, zoom, unit, ppi);
      }
    };
    draw();
    const stage = wrapRef.current?.parentElement;
    if (!stage) return;
    const ro = new ResizeObserver(draw);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [zoom, panX, panY, unit, ppi]);

  const beginGuide = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const stage = wrapRef.current?.parentElement as HTMLElement | null;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const s = useEditor.getState();
    s.snapshot('Agregar guía');
    const pos = axis === 'x'
      ? (e.clientX - rect.left - s.panX) / s.zoom
      : (e.clientY - rect.top - s.panY) / s.zoom;
    const id = s.addGuide(axis, pos);
    startGuideDrag(id, axis, stage);
  };

  const openGuideInput = (axis: 'x' | 'y') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const stage = wrapRef.current?.parentElement as HTMLElement | null;
    const wrap = wrapRef.current;
    if (!stage || !wrap) return;
    const stageRect = stage.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const s = useEditor.getState();
    const pos = axis === 'x'
      ? (e.clientX - stageRect.left - s.panX) / s.zoom
      : (e.clientY - stageRect.top - s.panY) / s.zoom;
    setMenu({
      axis,
      x: e.clientX - wrapRect.left,
      y: e.clientY - wrapRect.top,
      value: Math.round(pos),
    });
  };

  const addManualGuide = () => {
    if (!menu) return;
    useEditor.getState().snapshot('Agregar guía');
    useEditor.getState().addGuide(menu.axis, menu.value);
    setMenu(null);
  };

  return (
    <div ref={wrapRef} data-ui className="rulers">
      <div className="ruler-corner" />
      {/* Arrastrar desde la regla superior crea una guía horizontal y viceversa. */}
      <canvas ref={topRef} className="ruler ruler-top"
        style={{ width: `calc(100% - ${RULER_SIZE}px)`, height: RULER_SIZE }}
        onPointerDown={beginGuide('y')}
        onContextMenu={openGuideInput('y')} />
      <canvas ref={leftRef} className="ruler ruler-left"
        style={{ width: RULER_SIZE, height: `calc(100% - ${RULER_SIZE}px)` }}
        onPointerDown={beginGuide('x')}
        onContextMenu={openGuideInput('x')} />
      {cursor && (
        <>
          <div className="ruler-cursor h" style={{ left: panX + cursor.x * zoom }} />
          <div className="ruler-cursor v" style={{ top: panY + cursor.y * zoom }} />
        </>
      )}
      {menu && (
        <div
          className="guide-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <label>{menu.axis === 'x' ? 'X' : 'Y'}</label>
          <input
            className="num-input"
            type="number"
            autoFocus
            value={menu.value}
            onChange={(e) => setMenu({ ...menu, value: parseFloat(e.target.value) || 0 })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addManualGuide();
              if (e.key === 'Escape') setMenu(null);
            }}
          />
          <span>px</span>
          <button className="mini-btn" onClick={addManualGuide}>+</button>
        </div>
      )}
    </div>
  );
}

export function GuideLines() {
  const guides = useEditor((s) => s.guides);
  const zoom = useEditor((s) => s.zoom);
  const panX = useEditor((s) => s.panX);
  const panY = useEditor((s) => s.panY);
  const [menu, setMenu] = useState<{
    id: string;
    axis: 'x' | 'y';
    x: number;
    y: number;
    value: number;
  } | null>(null);

  if (!guides.length && !menu) return null;
  return (
    <>
      {guides.map((g) => {
        const isV = g.axis === 'x';
        const screen = (isV ? panX : panY) + g.pos * zoom;
        return (
          <div
            key={g.id}
            data-ui
            className={`guide ${isV ? 'v' : 'h'}`}
            style={isV ? { left: screen - 3 } : { top: screen - 3 }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              const stage = (e.currentTarget as HTMLElement).closest('.stage') as HTMLElement | null;
              if (stage) { useEditor.getState().snapshot('Mover guía'); startGuideDrag(g.id, g.axis, stage); }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ id: g.id, axis: g.axis, x: e.clientX, y: e.clientY, value: Math.round(g.pos) });
            }}
          />
        );
      })}
      {menu && (
        <div
          data-ui
          className="guide-menu fixed"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <label>{menu.axis === 'x' ? 'X' : 'Y'}</label>
          <input
            className="num-input"
            type="number"
            autoFocus
            value={menu.value}
            onChange={(e) => setMenu({ ...menu, value: parseFloat(e.target.value) || 0 })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                useEditor.getState().snapshot('Mover guía');
                useEditor.getState().moveGuide(menu.id, menu.value);
                setMenu(null);
              }
              if (e.key === 'Escape') setMenu(null);
            }}
          />
          <span>px</span>
          <button className="mini-btn" onClick={() => {
            useEditor.getState().snapshot('Mover guía');
            useEditor.getState().moveGuide(menu.id, menu.value);
            setMenu(null);
          }}>OK</button>
          <button className="mini-btn danger" onClick={() => {
            useEditor.getState().snapshot('Eliminar guía');
            useEditor.getState().removeGuide(menu.id);
            setMenu(null);
          }}>Eliminar</button>
        </div>
      )}
    </>
  );
}
