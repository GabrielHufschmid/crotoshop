import { useEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { hexToRgb, isValidHex, normalizeHex, rgbToHex, tuneHexColor } from '../engine/color';

interface Props {
  color: string;              // hex #rrggbb
  onChange: (hex: string) => void;
  onClose: () => void;
  /** CSS positioning of the popover relative to its positioned parent. */
  style?: React.CSSProperties;
}

/** Color picker popover with visual picker + hex + RGB numeric inputs. */
export function ColorPickerPopover({ color, onChange, onClose, style }: Props) {
  const [hexDraft, setHexDraft] = useState(color);
  const [tuning, setTuning] = useState({ saturation: 0, brightness: 0, contrast: 0, hue: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const rgb = hexToRgb(color);

  // Keep the hex field in sync when the color changes from the visual picker.
  useEffect(() => { setHexDraft(color); }, [color]);

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const commitHex = () => {
    if (isValidHex(hexDraft)) onChange(normalizeHex(hexDraft));
    else setHexDraft(color);
  };

  const setChannel = (i: number, v: number) => {
    const next: [number, number, number] = [...rgb];
    next[i] = Math.max(0, Math.min(255, Math.round(v) || 0));
    onChange(rgbToHex(next));
  };
  const adjust = (key: keyof typeof tuning, next: number) => {
    const delta = next - tuning[key];
    onChange(tuneHexColor(color, { [key]: delta }));
    setTuning((current) => ({ ...current, [key]: next }));
  };
  const finishAdjust = (key: keyof typeof tuning) => setTuning((current) => ({ ...current, [key]: 0 }));

  return (
    <div className="popover color-popover" ref={ref} style={style} data-ui>
      <HexColorPicker color={color} onChange={onChange} />
      <div className="color-inputs">
        <label className="hex-field">
          <span>Hex</span>
          <input
            value={hexDraft}
            spellCheck={false}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={commitHex}
            onKeyDown={(e) => { if (e.key === 'Enter') commitHex(); }}
          />
        </label>
        {(['R', 'G', 'B'] as const).map((ch, i) => (
          <label key={ch} className="rgb-field">
            <span>{ch}</span>
            <input
              type="number" min={0} max={255} value={rgb[i]}
              onChange={(e) => setChannel(i, parseInt(e.target.value))}
            />
          </label>
        ))}
      </div>
      <div className="color-tuning">
        {([
          ['saturation', 'Sat.', -100, 100], ['brightness', 'Brillo', -100, 100],
          ['contrast', 'Contr.', -100, 100], ['hue', 'Hue', -180, 180],
        ] as const).map(([key, label, min, max]) => (
          <label key={key} title={label}><span>{label}</span><input type="range" min={min} max={max} value={tuning[key]} onChange={(e) => adjust(key, Number(e.target.value))} onPointerUp={() => finishAdjust(key)} /></label>
        ))}
      </div>
    </div>
  );
}
