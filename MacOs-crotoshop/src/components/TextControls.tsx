import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TextAlign, TextData } from '../types';
import { DEFAULT_TEXT, GOOGLE_FONTS, SYSTEM_FONTS, loadGoogleFont, queryLocalFontFamilies, renderText, tryLoadGoogleFont } from '../engine/text';
import { useEditor } from '../store/editorStore';
import { useSettings } from '../store/settingsStore';
import { ColorPickerPopover } from './ColorPickerPopover';
import { Icon } from './Icons';
import { NumericControl } from './NumericControl';

interface TextControlsProps {
  value: TextData;
  onChange: (next: TextData) => void;
  onBegin?: (label: string) => void;
  layout?: 'dialog' | 'inspector';
  autoFocus?: boolean;
  disabled?: boolean;
}

function fontStack(family: string): string {
  return `"${family.replace(/["\\]/g, '')}", sans-serif`;
}

export function TextPreview({ data }: { data: TextData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const lines = data.text.split('\n').length;
  useLayoutEffect(() => {
    const preview = canvasRef.current;
    if (!preview) return;
    const source = renderText(data);
    const nextScale = Math.min(1, 520 / source.width, 320 / source.height);
    preview.width = Math.max(1, Math.round(source.width * nextScale));
    preview.height = Math.max(1, Math.round(source.height * nextScale));
    const context = preview.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, preview.width, preview.height);
    context.drawImage(source, 0, 0, preview.width, preview.height);
    setScale(nextScale);
  }, [data]);
  return (
    <div className="text-preview" aria-label="Vista previa tipográfica">
      <div className="text-preview-head">
        <span>Vista previa</span>
        <span>{data.family} · {Math.round(data.size)} px · {lines} línea{lines === 1 ? '' : 's'}</span>
      </div>
      <div className="text-preview-stage">
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      {scale < 1 && <div className="text-preview-scale">Vista ajustada al {Math.round(scale * 100)}%</div>}
    </div>
  );
}

export function TextControls({
  value,
  onChange,
  onBegin,
  layout = 'dialog',
  autoFocus = false,
  disabled = false,
}: TextControlsProps) {
  const toast = useEditor((state) => state.toast);
  const recentGoogleFonts = useSettings((state) => state.recentGoogleFonts);
  const addRecentGoogleFont = useSettings((state) => state.addRecentGoogleFont);
  const activePalette = useSettings((state) => state.activePalette);
  const [source, setSource] = useState<'system' | 'google'>(value.googleFont ? 'google' : 'system');
  const [systemFonts, setSystemFonts] = useState<string[]>(SYSTEM_FONTS);
  const [localFontsLoaded, setLocalFontsLoaded] = useState(false);
  const [loadingFont, setLoadingFont] = useState(false);
  const [fontQuery, setFontQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const fontLoadRef = useRef(0);
  const typingRef = useRef(false);
  const colorEditingRef = useRef(false);
  const colorButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { setSource(value.googleFont ? 'google' : 'system'); }, [value.googleFont]);

  useEffect(() => {
    if (!value.googleFont) return;
    const request = ++fontLoadRef.current;
    setLoadingFont(true);
    void loadGoogleFont(value.family).then(() => {
      if (request !== fontLoadRef.current) return;
      setLoadingFont(false);
      const current = valueRef.current;
      if (current.googleFont && current.family === value.family) onChangeRef.current({ ...current });
    });
  }, [value.family, value.googleFont]);

  const begin = (label: string) => {
    if (!disabled) onBegin?.(label);
  };
  const commit = (patch: Partial<TextData>, label?: string) => {
    if (disabled) return;
    if (label) begin(label);
    onChange({ ...valueRef.current, ...patch });
  };

  const loadLocalFonts = async () => {
    const families = await queryLocalFontFamilies();
    if (!families?.length) {
      toast('No se pudieron listar las fuentes del equipo', 'error');
      return;
    }
    setSystemFonts(families);
    setLocalFontsLoaded(true);
  };

  const searchGoogleFont = async () => {
    const query = fontQuery.trim();
    if (!query || loadingFont || disabled) return;
    setLoadingFont(true);
    const family = await tryLoadGoogleFont(query);
    setLoadingFont(false);
    if (!family) {
      toast(`No se encontró “${query}” en Google Fonts`, 'error');
      return;
    }
    begin('Cambiar tipografía');
    addRecentGoogleFont(family);
    setFontQuery('');
    onChange({ ...valueRef.current, family, googleFont: true });
  };

  const googleFonts = useMemo(() => [...new Set([...recentGoogleFonts, ...GOOGLE_FONTS])], [recentGoogleFonts]);
  const fonts = source === 'system' ? systemFonts : googleFonts;
  const quickColors = useMemo(
    () => [...new Set(activePalette)].slice(0, 6),
    [activePalette],
  );
  const alignments: Array<{ value: TextAlign; icon: 'align-left' | 'align-center-h' | 'align-right'; label: string }> = [
    { value: 'left', icon: 'align-left', label: 'Alinear a la izquierda' },
    { value: 'center', icon: 'align-center-h', label: 'Centrar' },
    { value: 'right', icon: 'align-right', label: 'Alinear a la derecha' },
  ];
  const metricBegin = (label: string) => () => begin(label);

  return (
    <div className={`text-controls ${layout} ${disabled ? 'disabled' : ''}`} aria-disabled={disabled}>
      <label className="text-content-field">
        <span>Contenido</span>
        <textarea
          className="text-input text-content-input"
          autoFocus={autoFocus}
          disabled={disabled}
          value={value.text}
          onFocus={() => { typingRef.current = false; }}
          onBlur={() => { typingRef.current = false; }}
          onChange={(event) => {
            if (!typingRef.current) {
              begin('Editar contenido de texto');
              typingRef.current = true;
            }
            commit({ text: event.target.value });
          }}
        />
      </label>

      <div className="text-source-row">
        <span>Origen</span>
        <div className="seg text-source-tabs">
          <button type="button" className={source === 'system' ? 'on' : ''} disabled={disabled} onClick={() => setSource('system')}>Equipo</button>
          <button type="button" className={source === 'google' ? 'on' : ''} disabled={disabled} onClick={() => setSource('google')}>Google</button>
        </div>
      </div>

      {source === 'google' && (
        <div className="text-font-search">
          <input
            className="text-input"
            placeholder="Buscar Google Font…"
            list="text-google-font-suggestions"
            value={fontQuery}
            disabled={disabled || loadingFont}
            onChange={(event) => setFontQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void searchGoogleFont();
              }
            }}
          />
          <datalist id="text-google-font-suggestions">
            {googleFonts.map((font) => <option key={font} value={font} />)}
          </datalist>
          <button type="button" className="icon-btn" title="Cargar fuente" disabled={disabled || loadingFont || !fontQuery.trim()} onClick={() => void searchGoogleFont()}>
            <Icon name={loadingFont ? 'reset' : 'plus'} size={14} />
          </button>
        </div>
      )}

      <div className="text-family-row">
        <label htmlFor={`text-family-${layout}`}>Tipografía</label>
        <select
          id={`text-family-${layout}`}
          className="text-input"
          style={{ fontFamily: fontStack(value.family) }}
          value={fonts.includes(value.family) ? value.family : ''}
          disabled={disabled || loadingFont}
          onChange={(event) => {
            const family = event.target.value;
            if (!family) return;
            commit({ family, googleFont: source === 'google' }, 'Cambiar tipografía');
          }}
        >
          {!fonts.includes(value.family) && <option value="">{value.family}</option>}
          {fonts.map((font) => <option key={font} value={font} style={{ fontFamily: fontStack(font) }}>{font}</option>)}
        </select>
        {source === 'system' && !localFontsLoaded && (
          <button type="button" className="icon-btn" title="Listar todas las fuentes instaladas" disabled={disabled} onClick={() => void loadLocalFonts()}>
            <Icon name="reset" size={13} />
          </button>
        )}
        {loadingFont && <span className="text-font-loading" aria-label="Cargando tipografía" />}
      </div>

      <div className="text-format-row">
        <div className="seg text-style-buttons" aria-label="Estilo tipográfico">
          <button type="button" className={value.bold ? 'on' : ''} disabled={disabled} title="Negrita" aria-pressed={value.bold} onClick={() => commit({ bold: !value.bold }, 'Cambiar estilo de texto')}><b>B</b></button>
          <button type="button" className={value.italic ? 'on' : ''} disabled={disabled} title="Cursiva" aria-pressed={value.italic} onClick={() => commit({ italic: !value.italic }, 'Cambiar estilo de texto')}><i>I</i></button>
          <button type="button" className={value.underline ? 'on' : ''} disabled={disabled} title="Subrayado" aria-pressed={value.underline} onClick={() => commit({ underline: !value.underline }, 'Cambiar decoración de texto')}><u>U</u></button>
          <button type="button" className={value.strikethrough ? 'on' : ''} disabled={disabled} title="Tachado" aria-pressed={value.strikethrough} onClick={() => commit({ strikethrough: !value.strikethrough }, 'Cambiar decoración de texto')}><s>S</s></button>
        </div>
        <div className="seg text-align-buttons" aria-label="Alineación">
          {alignments.map((alignment) => (
            <button type="button" key={alignment.value} className={value.align === alignment.value ? 'on' : ''} disabled={disabled}
              title={alignment.label} aria-label={alignment.label} aria-pressed={value.align === alignment.value}
              onClick={() => commit({ align: alignment.value }, 'Alinear texto')}>
              <Icon name={alignment.icon} size={14} />
            </button>
          ))}
        </div>
      </div>

      <div className="text-color-row">
        <span>Color</span>
        <div className="text-color-anchor">
          <button
            type="button"
            ref={colorButtonRef}
            className={`text-color-button ${pickerOpen ? 'on' : ''}`}
            disabled={disabled}
            title="Abrir selector de color"
            aria-expanded={pickerOpen}
            onClick={() => {
              colorEditingRef.current = false;
              setPickerOpen((open) => !open);
            }}
          >
            <i style={{ background: value.color }} />
            <code>{value.color.toUpperCase()}</code>
            <Icon name="chevron-down" size={12} />
          </button>
          {pickerOpen && (
            <ColorPickerPopover
              color={value.color}
              anchorRef={colorButtonRef}
              placement={layout === 'inspector' ? 'top' : 'bottom'}
              onChange={(color) => {
                if (!colorEditingRef.current) {
                  begin('Cambiar color de texto');
                  colorEditingRef.current = true;
                }
                commit({ color });
              }}
              onClose={() => {
                colorEditingRef.current = false;
                setPickerOpen(false);
              }}
            />
          )}
        </div>
        {quickColors.length > 0 && <div className="text-quick-colors" aria-label="Colores rápidos">
          {quickColors.map((color) => (
            <button type="button" key={color} className={value.color.toLowerCase() === color.toLowerCase() ? 'on' : ''}
              style={{ background: color }} title={color} disabled={disabled}
              onClick={() => commit({ color }, 'Cambiar color de texto')} />
          ))}
        </div>}
      </div>

      <div className="text-metrics">
        <div className="text-metric">
          <NumericControl label="Tamaño" value={value.size} min={1} max={2000} step={1} suffix="px" disabled={disabled}
            resetValue={DEFAULT_TEXT.size} onBegin={metricBegin('Cambiar tamaño de texto')} onChange={(size) => commit({ size })} />
          <input type="range" aria-label="Tamaño de texto" min={1} max={300} step={1} value={Math.min(300, value.size)} disabled={disabled}
            onPointerDown={metricBegin('Cambiar tamaño de texto')} onChange={(event) => commit({ size: Number(event.target.value) })} />
        </div>
        <div className="text-metric">
          <NumericControl label="Interlineado" value={value.lineHeight} min={0.5} max={5} step={0.05} decimals={2} suffix="×" disabled={disabled}
            resetValue={DEFAULT_TEXT.lineHeight} onBegin={metricBegin('Cambiar interlineado')} onChange={(lineHeight) => commit({ lineHeight })} />
          <input type="range" aria-label="Interlineado" min={0.5} max={3} step={0.05} value={Math.min(3, value.lineHeight)} disabled={disabled}
            onPointerDown={metricBegin('Cambiar interlineado')} onChange={(event) => commit({ lineHeight: Number(event.target.value) })} />
        </div>
        <div className="text-metric">
          <NumericControl label="Tracking" value={value.letterSpacing} min={-100} max={500} step={0.5} decimals={1} suffix="px" disabled={disabled}
            resetValue={DEFAULT_TEXT.letterSpacing} onBegin={metricBegin('Cambiar espaciado de texto')} onChange={(letterSpacing) => commit({ letterSpacing })} />
          <input type="range" aria-label="Espacio entre caracteres" min={-20} max={100} step={0.5} value={Math.max(-20, Math.min(100, value.letterSpacing))} disabled={disabled}
            onPointerDown={metricBegin('Cambiar espaciado de texto')} onChange={(event) => commit({ letterSpacing: Number(event.target.value) })} />
        </div>
      </div>
    </div>
  );
}
