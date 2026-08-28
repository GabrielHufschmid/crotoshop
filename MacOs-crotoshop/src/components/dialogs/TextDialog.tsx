import { useEffect, useRef, useState } from 'react';
import { ToolWindow } from './ToolWindow';
import { useEditor } from '../../store/editorStore';
import { DEFAULT_TEXT_SETTINGS, useSettings } from '../../store/settingsStore';
import { DEFAULT_TEXT, loadGoogleFont } from '../../engine/text';
import type { Pt, TextData } from '../../types';
import { TextControls, TextPreview } from '../TextControls';
import { NumericControl } from '../NumericControl';
import { Icon } from '../Icons';

export type TextTarget =
  | { kind: 'new'; pt: Pt; sessionId: string }
  | { kind: 'edit'; layerId: string; sessionId: string };

interface Props {
  target: TextTarget;
  onClose: () => void;
  onLayerReady: (layerId: string | null) => void;
}

type EditorCheckpoint = Pick<
  ReturnType<typeof useEditor.getState>,
  | 'doc'
  | 'past'
  | 'future'
  | 'selection'
  | 'guides'
  | 'selectedLayerIds'
  | 'maskTargetId'
  | 'dirty'
  | 'changeId'
  | 'savedChangeId'
>;

export function TextDialog({ target, onClose, onLayerReady }: Props) {
  const textDefaults = useSettings((state) => state.textDefaults);
  const setTextDefaults = useSettings((state) => state.setTextDefaults);
  const [layerId, setLayerId] = useState<string | null>(target.kind === 'edit' ? target.layerId : null);
  const [data, setData] = useState<TextData>({ ...DEFAULT_TEXT, ...textDefaults, text: DEFAULT_TEXT.text });
  const layerX = useEditor((state) => layerId == null
    ? 0
    : state.doc?.layers.find((layer) => layer.id === layerId)?.x ?? 0);
  const layerY = useEditor((state) => layerId == null
    ? 0
    : state.doc?.layers.find((layer) => layer.id === layerId)?.y ?? 0);
  const setLayerPosition = useEditor((state) => state.setLayerPosition);
  const initializedRef = useRef(false);
  const historyStartedRef = useRef(target.kind === 'new');
  const checkpointRef = useRef<EditorCheckpoint | null>(null);

  if (!checkpointRef.current) {
    const editor = useEditor.getState();
    checkpointRef.current = {
      doc: editor.doc,
      past: editor.past,
      future: editor.future,
      selection: editor.selection,
      guides: editor.guides,
      selectedLayerIds: editor.selectedLayerIds,
      maskTargetId: editor.maskTargetId,
      dirty: editor.dirty,
      changeId: editor.changeId,
      savedChangeId: editor.savedChangeId,
    };
  }

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const editor = useEditor.getState();
    if (target.kind === 'edit') {
      const layer = editor.doc?.layers.find((candidate) => candidate.id === target.layerId);
      if (!layer?.text) {
        onClose();
        return;
      }
      const initial = { ...DEFAULT_TEXT, ...layer.text };
      setData(initial);
      if (initial.googleFont) void loadGoogleFont(initial.family);
      return;
    }
    const initial = { ...DEFAULT_TEXT, ...useSettings.getState().textDefaults, text: DEFAULT_TEXT.text };
    if (initial.googleFont) void loadGoogleFont(initial.family);
    const id = editor.addTextLayer(initial, target.pt.x, target.pt.y);
    setData(initial);
    setLayerId(id);
  }, [onClose, target]);

  useEffect(() => {
    onLayerReady(layerId);
  }, [layerId, onLayerReady]);

  const commit = (next: TextData) => {
    setData(next);
    setTextDefaults({ ...next, text: DEFAULT_TEXT_SETTINGS.text });
    if (layerId) useEditor.getState().updateTextLayer(layerId, next);
  };

  const beginEdit = () => {
    if (target.kind !== 'edit' || historyStartedRef.current) return;
    useEditor.getState().snapshot('Editar texto');
    historyStartedRef.current = true;
  };

  const changePosition = (axis: 'x' | 'y', value: number) => {
    if (!layerId) return;
    const layer = useEditor.getState().doc?.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    setLayerPosition(layerId, axis === 'x' ? value : layer.x, axis === 'y' ? value : layer.y);
  };

  const cancel = () => {
    const checkpoint = checkpointRef.current;
    if ((target.kind === 'new' || historyStartedRef.current) && checkpoint) {
      useEditor.setState((editor) => ({ ...checkpoint, rev: editor.rev + 1 }));
    }
    onClose();
  };

  return (
    <ToolWindow
      title={target.kind === 'new' ? 'Agregar texto' : 'Editar texto'}
      width={700}
      storageKey="text-editor"
      initialPosition="right"
      snap
      onClose={cancel}
      onInteractOutside={onClose}
      ignoreOutsideSelector=".stage"
      footer={
        <>
          <span className="text-dialog-live-status">Los cambios se muestran en tiempo real</span>
          <button className="tbtn" onClick={cancel}>Cancelar</button>
          <button className="tbtn primary" onClick={onClose}>Aceptar</button>
        </>
      }
    >
      <div className="text-position-bar">
        <span className="text-position-icon" title="Posición de la capa de texto"><Icon name="move" size={14} /></span>
        <NumericControl
          label="X"
          ariaLabel="Posición horizontal del texto"
          value={layerX}
          step={1}
          suffix="px"
          disabled={!layerId}
          className="text-position-control"
          onBegin={beginEdit}
          onChange={(value) => changePosition('x', value)}
        />
        <NumericControl
          label="Y"
          ariaLabel="Posición vertical del texto"
          value={layerY}
          step={1}
          suffix="px"
          disabled={!layerId}
          className="text-position-control"
          onBegin={beginEdit}
          onChange={(value) => changePosition('y', value)}
        />
      </div>
      <div className="text-dialog-layout">
        <TextControls value={data} onChange={commit} onBegin={beginEdit} layout="dialog" autoFocus />
        <TextPreview data={data} />
      </div>
    </ToolWindow>
  );
}
