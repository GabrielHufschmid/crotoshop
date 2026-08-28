import { useEffect } from 'react';
import { useEditor } from '../store/editorStore';
import { actionForCombo, comboFromEvent, useSettings } from '../store/settingsStore';
import type { Tool } from '../types';

interface Handlers {
  onExport: () => void;
  onImport: () => void;
  onFit: () => void;
}

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function useKeyboardShortcuts({ onExport, onImport, onFit }: Handlers): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      const s = useEditor.getState();
      const settings = useSettings.getState();
      const mod = e.metaKey || e.ctrlKey;

      // ── Fixed keys (not rebindable) ──
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selection && s.activeLayer()) {
          e.preventDefault();
          s.deleteSelectionPixels();
        } else if (!s.selectionTransformActive) {
          // Nunca borrar la capa entera mientras hay una selección "flotando"
          // a mitad de un mover/redimensionar/rotar (selection es null en ese
          // momento por diseño, no porque no haya nada seleccionado).
          const active = s.activeLayer();
          if (active) s.removeLayer(active.id);
        }
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        // Fallback paste: only when the system clipboard couldn't be written
        // on copy — otherwise the native paste event imports the image.
        if (!s.systemClipboardOk && s.hasInternalClipboard()) {
          e.preventDefault();
          s.pasteInternal();
        }
        return;
      }

      const combo = comboFromEvent(e);
      if (!combo) return;
      const action = actionForCombo(settings.bindings, combo);
      if (!action) return;

      if (action.startsWith('tool.')) {
        e.preventDefault();
        s.setTool(action.slice(5) as Tool);
        return;
      }

      switch (action) {
        case 'undo': e.preventDefault(); s.undo(); break;
        case 'redo': e.preventDefault(); s.redo(); break;
        case 'export': e.preventDefault(); onExport(); break;
        case 'open': e.preventDefault(); onImport(); break;
        case 'fit': e.preventDefault(); onFit(); break;
        case 'zoomIn': e.preventDefault(); s.setZoom(s.zoom * 1.2); break;
        case 'zoomOut': e.preventDefault(); s.setZoom(s.zoom / 1.2); break;
        case 'brushSmaller': s.setBrush(Math.max(2, s.brushSize - 4)); break;
        case 'brushBigger': s.setBrush(Math.min(600, s.brushSize + 4)); break;
        case 'copy':
          if (s.selection && s.activeLayer()) {
            e.preventDefault();
            void s.copySelection(false).then((ok) => { if (ok) s.toast('Selección copiada'); });
          }
          break;
        case 'cut':
          if (s.selection && s.activeLayer()) {
            e.preventDefault();
            void s.copySelection(true).then((ok) => { if (ok) s.toast('Selección cortada'); });
          }
          break;
        case 'deselect':
          e.preventDefault();
          s.setSelection(null);
          break;
        case 'selectAll':
          e.preventDefault();
          s.selectAllPixels();
          break;
        case 'toggleGuides':
          e.preventDefault();
          settings.toggleGuides();
          break;
        default: break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExport, onImport, onFit]);
}
