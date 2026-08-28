import { useEffect, useRef } from 'react';
import { useEditor } from '../store/editorStore';
import { actionForCombo, comboFromEvent, useSettings } from '../store/settingsStore';
import type { Tool } from '../types';

interface Handlers {
  onNew: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onImport: () => void;
  onFit: () => void;
  onActualPixels: () => void;
  onTogglePanels: () => void;
  onToggleColorPanel: () => void;
  onToggleLayersPanel: () => void;
}

interface SpringTool {
  key: string;
  previous: Tool;
  timer: ReturnType<typeof setTimeout>;
  armed: boolean;
}

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function useKeyboardShortcuts({
  onNew,
  onSave,
  onSaveAs,
  onExport,
  onImport,
  onFit,
  onActualPixels,
  onTogglePanels,
  onToggleColorPanel,
  onToggleLayersPanel,
}: Handlers): void {
  const springTool = useRef<SpringTool | null>(null);

  useEffect(() => {
    function cancelSpring(restore: boolean) {
      const spring = springTool.current;
      if (!spring) return;
      clearTimeout(spring.timer);
      if (restore && spring.armed) useEditor.getState().setTool(spring.previous);
      springTool.current = null;
    }

    function activateTool(e: KeyboardEvent, tool: Tool) {
      const s = useEditor.getState();
      const bareKey = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
      if (!bareKey || e.repeat) {
        s.setTool(tool);
        return;
      }
      cancelSpring(false);
      const spring: SpringTool = {
        key: e.key.toLowerCase(),
        previous: s.tool,
        armed: false,
        timer: setTimeout(() => { spring.armed = true; }, 200),
      };
      springTool.current = spring;
      s.setTool(tool);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      const s = useEditor.getState();
      const settings = useSettings.getState();
      const mod = e.metaKey || e.ctrlKey;

      // Fixed interaction keys mirror Photoshop and remain independent from
      // the editable shortcut preset.
      if (!mod && !e.altKey && (e.key.startsWith('Arrow'))) {
        if (s.tool === 'vector-node') return;
        if (!s.doc?.activeId || s.selectionTransformActive) return;
        e.preventDefault();
        const amount = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0;
        const dy = e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0;
        const selectionTool = s.tool.startsWith('select-') || s.tool === 'wand' || s.tool === 'ai-mask';
        if (s.selection && selectionTool) {
          s.moveSelectionBy(dx, dy);
        } else {
          if (!e.repeat) s.snapshot('Desplazar capa');
          s.moveActiveBy(dx, dy);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.tool === 'pixel-stretch' || s.tool === 'warp-mesh' || s.tool === 'vector-node') return;
        if (s.selection && s.activeLayer()) {
          e.preventDefault();
          s.deleteSelectionPixels();
        } else if (!s.selectionTransformActive) {
          if (s.activeLayer()) {
            e.preventDefault();
            s.removeSelectedLayers();
          }
        }
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'v' && s.hasInternalClipboard()) {
        e.preventDefault();
        s.pasteInternal(true);
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'v') {
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
        activateTool(e, action.slice(5) as Tool);
        return;
      }

      switch (action) {
        case 'undo': e.preventDefault(); s.undo(); break;
        case 'redo': e.preventDefault(); s.redo(); break;
        case 'new': e.preventDefault(); onNew(); break;
        case 'save': e.preventDefault(); onSave(); break;
        case 'saveAs': e.preventDefault(); onSaveAs(); break;
        case 'export': e.preventDefault(); onExport(); break;
        case 'open': e.preventDefault(); onImport(); break;
        case 'fit': e.preventDefault(); onFit(); break;
        case 'actualPixels': e.preventDefault(); onActualPixels(); break;
        case 'zoomIn': e.preventDefault(); s.setZoom(s.zoom * 1.2); break;
        case 'zoomOut': e.preventDefault(); s.setZoom(s.zoom / 1.2); break;
        case 'brushSmaller': e.preventDefault(); s.setBrush(Math.max(2, s.brushSize - 4)); break;
        case 'brushBigger': e.preventDefault(); s.setBrush(Math.min(600, s.brushSize + 4)); break;
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
        case 'pasteInPlace':
          if (s.hasInternalClipboard()) {
            e.preventDefault();
            s.pasteInternal(true);
          }
          break;
        case 'deselect': e.preventDefault(); s.setSelection(null); break;
        case 'selectAll': e.preventDefault(); s.selectAllPixels(); break;
        case 'inverseSelection': e.preventDefault(); s.invertSelection(); break;
        case 'toggleGuides': e.preventDefault(); settings.toggleGuides(); break;
        case 'freeTransform': e.preventDefault(); s.setTool('move'); break;
        case 'newLayer': e.preventDefault(); s.addEmptyLayer(); break;
        case 'duplicateLayer': e.preventDefault(); s.duplicateSelectedLayers(); break;
        case 'mergeDown': e.preventDefault(); s.mergeDown(); break;
        case 'mergeVisible': e.preventDefault(); s.mergeVisible(); break;
        case 'selectLayerBelow': e.preventDefault(); s.selectAdjacentLayer(-1); break;
        case 'selectLayerAbove': e.preventDefault(); s.selectAdjacentLayer(1); break;
        case 'moveLayerDown': e.preventDefault(); s.moveSelectedLayerInStack(-1); break;
        case 'moveLayerUp': e.preventDefault(); s.moveSelectedLayerInStack(1); break;
        case 'togglePanels': e.preventDefault(); onTogglePanels(); break;
        case 'toggleColorPanel': e.preventDefault(); onToggleColorPanel(); break;
        case 'toggleLayersPanel': e.preventDefault(); onToggleLayersPanel(); break;
        case 'eyedropper':
          e.preventDefault();
          if (s.doc) s.setEyedropperActive(true);
          break;
        default: break;
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      const spring = springTool.current;
      if (!spring || e.key.toLowerCase() !== spring.key) return;
      cancelSpring(true);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      cancelSpring(false);
    };
  }, [onNew, onSave, onSaveAs, onExport, onImport, onFit, onActualPixels, onTogglePanels, onToggleColorPanel, onToggleLayersPanel]);
}
