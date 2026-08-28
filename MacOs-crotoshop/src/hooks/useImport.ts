import { useState, useCallback } from 'react';
import { importFile } from '../engine/import';
import type { Imported } from '../engine/import';
import { useEditor } from '../store/editorStore';
import { isDesktop, nativeFiles, setDocumentSourceName } from '../desktop/native';
import type { NativeOpenKind } from '../desktop/native';

export type ImportMode = 'layer' | 'document';
export type PendingImport = Extract<Imported, { kind: 'vector' | 'pdf' }> & { mode: ImportMode };

/** Handles importing dropped/selected files: raster layers land immediately;
 *  vectors and PDFs open the rasterize dialog. */
export function useImport() {
  const [pending, setPending] = useState<PendingImport | null>(null);
  const addLayerCanvas = useEditor((s) => s.addLayerCanvas);
  const newDocumentFromCanvas = useEditor((s) => s.newDocumentFromCanvas);
  const toast = useEditor((s) => s.toast);

  const open = useCallback(
    async (files: File[] | FileList, mode: ImportMode = 'layer') => {
      const list = Array.from(files);
      for (const file of list) {
        try {
          const res = await importFile(file);
          if (res.kind === 'raster') {
            if (mode === 'document') {
              newDocumentFromCanvas(res.canvas, res.name);
              setDocumentSourceName(useEditor.getState().activeTabId, res.name);
            } else addLayerCanvas(res.canvas, res.name);
          } else {
            // One interactive import at a time.
            setPending({ ...res, mode });
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'No se pudo importar el archivo';
          toast(`${file.name}: ${msg}`, 'error');
        }
      }
    },
    [addLayerCanvas, newDocumentFromCanvas, toast],
  );

  return { pending, setPending, open };
}

/** Opens the OS file picker and returns selected files. */
export async function pickFiles(accept: string, multiple = true, nativeKind: NativeOpenKind = 'media'): Promise<File[]> {
  if (isDesktop) {
    return nativeFiles(nativeKind, multiple);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    input.click();
  });
}
