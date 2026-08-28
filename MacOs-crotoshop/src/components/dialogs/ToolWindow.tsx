import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { snapPanelPosition } from '../../engine/panelSnap';
import type { PanelBounds, PanelPosition, PanelSize, PanelSnapLines } from '../../engine/panelSnap';
import { Icon } from '../Icons';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  storageKey?: string;
  initialPosition?: 'right' | 'center';
  snap?: boolean;
  onInteractOutside?: () => void;
  ignoreOutsideSelector?: string;
}

interface InterfaceLayout {
  bounds: PanelBounds;
  lines: PanelSnapLines;
  preferredRight: number;
  preferredTop: number;
}

const EDGE_MARGIN = 8;
const SNAP_DISTANCE = 14;
const STORAGE_PREFIX = 'crotoshop:floating-panel:';

function visibleRect(selector: string): DOMRect | null {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element || getComputedStyle(element).display === 'none') return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function uniqueLines(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).map((value) => Math.round(value)))];
}

function interfaceLayout(): InterfaceLayout {
  const topbar = visibleRect('.topbar');
  const tabs = visibleRect('.doc-tabs');
  const options = visibleRect('.tool-options-slot');
  const toolbar = visibleRect('.toolbar');
  const stage = visibleRect('.stage');
  const side = visibleRect('.side');
  const palette = visibleRect('.palette-tray');
  const status = visibleRect('.statusbar');
  const top = Math.max(EDGE_MARGIN, (topbar?.bottom ?? 0) + 6);
  const bottomObstacle = Math.min(
    status?.top ?? window.innerHeight,
    palette?.top ?? window.innerHeight,
  );
  const bottom = Math.max(top + 120, bottomObstacle - 6);
  const right = Math.max(EDGE_MARGIN + 120, window.innerWidth - EDGE_MARGIN);
  const bounds = { left: EDGE_MARGIN, right, top, bottom };

  return {
    bounds,
    lines: {
      vertical: uniqueLines([
        bounds.left,
        bounds.right,
        toolbar?.right,
        stage?.left,
        stage?.right,
        side?.left,
      ]),
      horizontal: uniqueLines([
        bounds.top,
        bounds.bottom,
        topbar?.bottom,
        tabs?.bottom,
        options?.bottom,
        stage?.top,
        stage?.bottom,
        palette?.top,
        status?.top,
      ]),
    },
    preferredRight: side?.left ?? stage?.right ?? bounds.right,
    preferredTop: Math.max(bounds.top, stage?.top ?? tabs?.bottom ?? bounds.top) + EDGE_MARGIN,
  };
}

function defaultPosition(size: PanelSize, layout: InterfaceLayout, side: 'right' | 'center'): PanelPosition {
  if (side === 'center') {
    return {
      x: (layout.bounds.left + layout.bounds.right - size.width) / 2,
      y: (layout.bounds.top + layout.bounds.bottom - size.height) / 2,
    };
  }
  return {
    x: layout.preferredRight - size.width - EDGE_MARGIN,
    y: layout.preferredTop,
  };
}

function loadPosition(storageKey?: string): PanelPosition | null {
  if (!storageKey) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`) ?? 'null') as Partial<PanelPosition> | null;
    return parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
      ? { x: Number(parsed.x), y: Number(parsed.y) }
      : null;
  } catch {
    return null;
  }
}

function savePosition(storageKey: string | undefined, position: PanelPosition): void {
  if (!storageKey) return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify(position));
  } catch {
    // Position persistence is a convenience and must never block the tool.
  }
}

/** Floating, visually modeless tool window with magnetic interface docking. */
export function ToolWindow({
  title,
  onClose,
  children,
  footer,
  width = 640,
  storageKey,
  initialPosition = 'right',
  snap = true,
  onInteractOutside,
  ignoreOutsideSelector,
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const positionRef = useRef<PanelPosition | null>(null);
  const draggingRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [entering, setEntering] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  const updatePosition = useCallback((next: PanelPosition) => {
    positionRef.current = next;
    setPosition(next);
  }, []);

  const fitPosition = useCallback((reset = false) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const size = { width: rect.width, height: rect.height };
    const layout = interfaceLayout();
    const desired = reset
      ? defaultPosition(size, layout, initialPosition)
      : positionRef.current ?? loadPosition(storageKey) ?? defaultPosition(size, layout, initialPosition);
    const fitted = snapPanelPosition(desired, size, layout.bounds, layout.lines, 0).position;
    updatePosition(fitted);
    if (reset) savePosition(storageKey, fitted);
  }, [initialPosition, storageKey, updatePosition]);

  useLayoutEffect(() => {
    fitPosition();
    const panel = panelRef.current;
    if (!panel) return undefined;
    const observer = new ResizeObserver(() => {
      if (!draggingRef.current) fitPosition();
    });
    const onResize = () => fitPosition();
    observer.observe(panel);
    window.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [fitPosition]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  useEffect(() => {
    if (!onInteractOutside) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        panelRef.current?.contains(target)
        || target.closest('.color-popover')
        || (ignoreOutsideSelector && target.closest(ignoreOutsideSelector))
      ) return;
      onInteractOutside();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [ignoreOutsideSelector, onInteractOutside]);

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !positionRef.current) return;
    if ((event.target as HTMLElement).closest('button, input, select, textarea')) return;
    event.preventDefault();
    event.stopPropagation();
    dragCleanupRef.current?.();
    setEntering(false);

    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const size = { width: rect.width, height: rect.height };
    const layout = interfaceLayout();
    const origin = { ...positionRef.current };
    const pointer = { x: event.clientX, y: event.clientY };
    draggingRef.current = true;
    setDragging(true);
    document.body.classList.add('tool-window-dragging');

    const move = (nextEvent: PointerEvent) => {
      const raw = {
        x: origin.x + nextEvent.clientX - pointer.x,
        y: origin.y + nextEvent.clientY - pointer.y,
      };
      const result = snapPanelPosition(
        raw,
        size,
        layout.bounds,
        layout.lines,
        snap ? SNAP_DISTANCE : 0,
      );
      updatePosition(result.position);
      setGuides(snap ? result.guides : { x: null, y: null });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('tool-window-dragging');
      draggingRef.current = false;
      setDragging(false);
      setGuides({ x: null, y: null });
      if (positionRef.current) savePosition(storageKey, positionRef.current);
      dragCleanupRef.current = null;
    };

    dragCleanupRef.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  const moveWithKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!positionRef.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const raw = { ...positionRef.current };
    if (event.key === 'ArrowLeft') raw.x -= amount;
    if (event.key === 'ArrowRight') raw.x += amount;
    if (event.key === 'ArrowUp') raw.y -= amount;
    if (event.key === 'ArrowDown') raw.y += amount;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const layout = interfaceLayout();
    const next = snapPanelPosition(raw, { width: rect.width, height: rect.height }, layout.bounds, layout.lines, 0).position;
    updatePosition(next);
    savePosition(storageKey, next);
  };

  const style: CSSProperties = {
    width,
    left: position?.x ?? 0,
    top: position?.y ?? 0,
    visibility: position ? 'visible' : 'hidden',
  };

  return (
    <div className="tool-window-layer" data-ui>
      {dragging && guides.x != null && <div className="tool-window-snap-guide vertical" style={{ left: guides.x }} />}
      {dragging && guides.y != null && <div className="tool-window-snap-guide horizontal" style={{ top: guides.y }} />}
      <section
        ref={panelRef}
        className={`modal tool-window ${entering ? 'entering' : ''} ${dragging ? 'dragging' : ''} ${guides.x != null || guides.y != null ? 'snapped' : ''}`}
        style={style}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setEntering(false);
        }}
      >
        <header
          className="modal-head tool-window-head"
          tabIndex={0}
          title="Arrastrar para mover · doble clic para volver a la derecha"
          onPointerDown={beginDrag}
          onDoubleClick={() => fitPosition(true)}
          onKeyDown={moveWithKeyboard}
        >
          <span className="tool-window-grip" aria-hidden="true"><Icon name="grip" size={15} /></span>
          <span id={titleId} className="tool-window-title">{title}</span>
          <button className="icon-btn" title="Cerrar" onClick={onClose}><Icon name="close" size={15} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </section>
    </div>
  );
}
