import { useEffect, useRef, useState } from 'react';

interface NumericControlProps {
  label?: string;
  ariaLabel?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  suffix?: string;
  resetValue?: number;
  disabled?: boolean;
  className?: string;
  onBegin?: () => void;
  onChange: (value: number) => void;
  onCancel?: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function precisionFor(step: number, decimals?: number): number {
  if (decimals != null) return decimals;
  const text = String(step);
  return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
}

function formatNumber(value: number, precision: number): string {
  return precision > 0 ? value.toFixed(precision) : String(Math.round(value));
}

/**
 * Compact numeric field shared by tool and property controls. Its label is a
 * scrub target: drag horizontally, Shift for fine changes and Alt for coarse.
 */
export function NumericControl({
  label,
  ariaLabel,
  value,
  min = -Number.MAX_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  decimals,
  suffix,
  resetValue,
  disabled = false,
  className = '',
  onBegin,
  onChange,
  onCancel,
}: NumericControlProps) {
  const precision = precisionFor(step, decimals);
  const [draft, setDraft] = useState(formatNumber(value, precision));
  const editingRef = useRef(false);
  const changedRef = useRef(false);
  const startValueRef = useRef(value);
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;
    if (!editingRef.current) setDraft(formatNumber(value, precision));
  }, [value, precision]);

  const begin = (initial = latestValueRef.current) => {
    if (changedRef.current) return;
    startValueRef.current = initial;
    changedRef.current = true;
    onBegin?.();
  };

  const apply = (next: number, initial?: number, updateDraft = true) => {
    if (!Number.isFinite(next)) return;
    const bounded = clamp(next, min, max);
    begin(initial);
    if (updateDraft) setDraft(formatNumber(bounded, precision));
    onChange(bounded);
  };

  const finish = () => {
    editingRef.current = false;
    changedRef.current = false;
    setDraft(formatNumber(latestValueRef.current, precision));
  };

  const cancel = () => {
    if (changedRef.current) {
      if (onCancel) onCancel();
      else onChange(startValueRef.current);
    }
    editingRef.current = false;
    changedRef.current = false;
    setDraft(formatNumber(startValueRef.current, precision));
  };

  const beginScrub = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const initial = latestValueRef.current;
    let dragged = false;
    editingRef.current = true;
    document.body.classList.add('numeric-scrubbing');

    const move = (nextEvent: PointerEvent) => {
      const dx = nextEvent.clientX - startX;
      if (!dragged && Math.abs(dx) < 2) return;
      dragged = true;
      const modifier = nextEvent.shiftKey ? 0.1 : nextEvent.altKey ? 10 : 1;
      apply(initial + dx * step * 0.25 * modifier, initial);
    };
    const cleanup = (syncDraft = true) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', keydown);
      document.body.classList.remove('numeric-scrubbing');
      editingRef.current = false;
      changedRef.current = false;
      if (syncDraft) setDraft(formatNumber(latestValueRef.current, precision));
    };
    const up = () => cleanup();
    const keydown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      cancel();
      cleanup(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('keydown', keydown);
  };

  return (
    <label className={`numeric-control ${disabled ? 'disabled' : ''} ${className}`.trim()}>
      {label && (
        <span
          className="numeric-label"
          title={resetValue == null ? 'Arrastrar para ajustar' : 'Arrastrar para ajustar · doble clic para restaurar'}
          onPointerDown={beginScrub}
          onDoubleClick={() => {
            if (!disabled && resetValue != null && resetValue !== latestValueRef.current) apply(resetValue);
          }}
        >
          {label}
        </span>
      )}
      <span className="numeric-input-wrap">
        <input
          className="numeric-input"
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          onFocus={() => {
            editingRef.current = true;
            changedRef.current = false;
            startValueRef.current = latestValueRef.current;
          }}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            const parsed = Number(text.replace(',', '.'));
            if (Number.isFinite(parsed)) apply(parsed, startValueRef.current, false);
          }}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancel();
              event.currentTarget.blur();
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
              return;
            }
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? 1 : -1;
            const modifier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
            apply(latestValueRef.current + direction * step * modifier, startValueRef.current);
          }}
        />
        {suffix && <span className="numeric-suffix">{suffix}</span>}
      </span>
    </label>
  );
}
