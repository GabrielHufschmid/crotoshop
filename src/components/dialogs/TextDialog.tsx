import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editorStore';
import { DEFAULT_TEXT_SETTINGS, useSettings } from '../../store/settingsStore';
import {
  DEFAULT_TEXT, GOOGLE_FONTS, SYSTEM_FONTS, loadGoogleFont, queryLocalFontFamilies,
  tryLoadGoogleFont,
} from '../../engine/text';
import type { Pt, TextAlign, TextData } from '../../types';

export type TextTarget =
  | { kind: 'new'; pt: Pt }
  | { kind: 'edit'; layerId: string };

interface Props {
  target: TextTarget;
  onClose: () => void;
}

export function TextDialog({ target, onClose }: Props) {
  const toast = useEditor((s) => s.toast);
  const textDefaults = useSettings((s) => s.textDefaults);
  const setTextDefaults = useSettings((s) => s.setTextDefaults);
  const [layerId, setLayerId] = useState<string | null>(
    target.kind === 'edit' ? target.layerId : null,
  );
  const [data, setData] = useState<TextData>({ ...DEFAULT_TEXT, ...textDefaults, text: DEFAULT_TEXT.text });
  const [source, setSource] = useState<'system' | 'google'>(textDefaults.googleFont ? 'google' : 'system');
  const [systemFonts, setSystemFonts] = useState<string[]>(SYSTEM_FONTS);
  const [loadingFont, setLoadingFont] = useState(false);
  const [fontQuery, setFontQuery] = useState('');
  const recentGoogleFonts = useSettings((s) => s.recentGoogleFonts);
  const addRecentGoogleFont = useSettings((s) => s.addRecentGoogleFont);
  const createdRef = useRef(false);

  // Create the layer (new) or snapshot + load existing data (edit) on mount.
  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    const s = useEditor.getState();
    if (target.kind === 'edit') {
      s.snapshot('Editar texto');
      const l = s.doc?.layers.find((x) => x.id === target.layerId);
      if (l?.text) {
        setData({ ...l.text });
        setSource(l.text.googleFont ? 'google' : 'system');
      }
    } else {
      const initial = { ...DEFAULT_TEXT, ...useSettings.getState().textDefaults, text: DEFAULT_TEXT.text };
      if (initial.googleFont) void loadGoogleFont(initial.family);
      const id = s.addTextLayer(initial, target.pt.x, target.pt.y);
      setLayerId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (next: TextData) => {
    setData(next);
    setTextDefaults({ ...next, text: DEFAULT_TEXT_SETTINGS.text });
    if (layerId) useEditor.getState().updateTextLayer(layerId, next);
  };

  const changeFamily = async (family: string, googleFont: boolean) => {
    if (googleFont) {
      setLoadingFont(true);
      // Optimistic UI: select immediately, re-render once loaded.
      setData((d) => ({ ...d, family, googleFont }));
      await loadGoogleFont(family);
      setLoadingFont(false);
    }
    commit({ ...data, family, googleFont });
  };

  const loadLocalFonts = async () => {
    const fams = await queryLocalFontFamilies();
    if (fams && fams.length) setSystemFonts(fams);
    else toast('El navegador no permite listar las fuentes del equipo', 'error');
  };

  const searchGoogleFont = async () => {
    const q = fontQuery.trim();
    if (!q || loadingFont) return;
    setLoadingFont(true);
    const family = await tryLoadGoogleFont(q);
    setLoadingFont(false);
    if (!family) {
      toast(`No se encontró "${q}" en Google Fonts`, 'error');
      return;
    }
    addRecentGoogleFont(family);
    setFontQuery('');
    commit({ ...data, family, googleFont: true });
  };

  const cancel = () => {
    useEditor.getState().undo();
    onClose();
  };

  const googleList = [...new Set([...recentGoogleFonts, ...GOOGLE_FONTS])];
  const fonts = source === 'system' ? systemFonts : googleList;

  return (
    <Modal
      title={target.kind === 'new' ? 'Agregar texto' : 'Editar texto'}
      width={420}
      onClose={cancel}
      footer={
        <>
          <button className="tbtn" onClick={cancel}>Cancelar</button>
          <button className="tbtn primary" onClick={onClose}>Aceptar</button>
        </>
      }
    >
      <textarea
        className="text-input"
        style={{ height: 72, resize: 'vertical', paddingTop: 6, fontFamily: 'inherit' }}
        autoFocus
        value={data.text}
        onChange={(e) => commit({ ...data, text: e.target.value })}
      />

      <div className="field-row">
        <label>Origen</label>
        <div className="seg">
          <button className={source === 'system' ? 'on' : ''} onClick={() => setSource('system')}>
            Del equipo
          </button>
          <button className={source === 'google' ? 'on' : ''} onClick={() => setSource('google')}>
            Google Fonts
          </button>
        </div>
      </div>

      {source === 'google' && (
        <div className="field-row">
          <label>Buscar fuente</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              className="text-input"
              style={{ width: 148 }}
              placeholder="ej. Lobster, DM Serif…"
              list="gf-suggestions"
              value={fontQuery}
              disabled={loadingFont}
              onChange={(e) => setFontQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void searchGoogleFont(); } }}
            />
            <datalist id="gf-suggestions">
              {googleList.map((f) => <option key={f} value={f} />)}
            </datalist>
            <button className="tbtn" disabled={loadingFont || !fontQuery.trim()}
              onClick={() => void searchGoogleFont()}>
              {loadingFont ? 'Cargando…' : 'Cargar'}
            </button>
          </div>
        </div>
      )}

      <div className="field-row">
        <label>Tipografía</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            className="text-input"
            style={{ width: 190, fontFamily: `"${data.family}", sans-serif` }}
            value={fonts.includes(data.family) ? data.family : ''}
            onChange={(e) => changeFamily(e.target.value, source === 'google')}
          >
            {!fonts.includes(data.family) && <option value="">{data.family}</option>}
            {fonts.map((f) => <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>)}
          </select>
          {loadingFont && source !== 'google' && <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>cargando…</span>}
        </div>
      </div>
      {source === 'system' && systemFonts === SYSTEM_FONTS && (
        <button className="link" style={{ alignSelf: 'flex-end', fontSize: 11 }} onClick={loadLocalFonts}>
          Listar todas las fuentes instaladas…
        </button>
      )}

      <div className="field-row">
        <label>Estilo</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="seg">
            <button className={data.bold ? 'on' : ''} style={{ fontWeight: 700 }}
              onClick={() => commit({ ...data, bold: !data.bold })}>B</button>
            <button className={data.italic ? 'on' : ''} style={{ fontStyle: 'italic' }}
              onClick={() => commit({ ...data, italic: !data.italic })}>I</button>
          </div>
          <input type="color" value={data.color}
            onChange={(e) => commit({ ...data, color: e.target.value })}
            style={{ width: 34, height: 26, background: 'none', border: 'none', cursor: 'pointer' }} />
        </div>
      </div>

      <div className="field-row">
        <label>Alineado</label>
        <div className="seg">
          {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
            <button key={a} className={data.align === a ? 'on' : ''}
              onClick={() => commit({ ...data, align: a })}>
              {a === 'left' ? '⟸' : a === 'center' ? '⟺' : '⟹'}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <label>Tamaño</label>
        <div>
          <input className="num-input" type="number" min={4} max={800} value={Math.round(data.size)}
            onChange={(e) => commit({ ...data, size: Math.max(1, parseInt(e.target.value) || 12) })} /> <span>px</span>
        </div>
      </div>

      <div className="field">
        <div className="row">
          <label>Interlineado</label>
          <span className="val">{data.lineHeight.toFixed(2)}×</span>
        </div>
        <input type="range" min={0.8} max={3} step={0.05} value={data.lineHeight}
          onChange={(e) => commit({ ...data, lineHeight: parseFloat(e.target.value) })} />
      </div>

      <div className="field">
        <div className="row">
          <label>Espacio entre caracteres</label>
          <span className="val">{data.letterSpacing}px</span>
        </div>
        <input type="range" min={-20} max={100} step={1} value={data.letterSpacing}
          onChange={(e) => commit({ ...data, letterSpacing: parseInt(e.target.value) })} />
      </div>
    </Modal>
  );
}
