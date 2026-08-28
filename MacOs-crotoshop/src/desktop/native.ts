export type DesktopMenuCommand =
  | 'new' | 'open' | 'open-project' | 'save' | 'save-as' | 'export'
  | 'close-document' | 'remove-background' | 'resize' | 'paste-in-place' | 'settings'
  | 'undo' | 'redo' | 'copy' | 'cut' | 'select-all' | 'deselect' | 'inverse-selection'
  | 'free-transform' | 'new-layer' | 'duplicate-layer' | 'merge-down' | 'merge-visible'
  | 'save-selection' | 'add-layer-mask' | 'apply-layer-mask' | 'delete-layer-mask'
  | 'flip-horizontal' | 'flip-vertical'
  | 'edit-vector-nodes' | 'text-to-curves' | 'expand-vector' | 'vectorize-layer'
  | 'pathfinder-unite' | 'pathfinder-subtract' | 'pathfinder-intersect' | 'pathfinder-exclude'
  | 'select-layer-below' | 'select-layer-above' | 'move-layer-down' | 'move-layer-up'
  | 'fit-view' | 'actual-pixels' | 'zoom-in' | 'zoom-out' | 'toggle-panels' | 'toggle-guides'
  | 'toggle-color-panel' | 'toggle-layers-panel';

export interface NativeFile {
  name: string;
  path: string;
  data: Uint8Array;
}

export type NativeOpenKind = 'media' | 'project' | 'palette' | 'all';

interface DesktopApi {
  platform: string;
  openFiles: (options: { multiple?: boolean; kind?: NativeOpenKind }) => Promise<NativeFile[]>;
  saveFile: (options: { data: Uint8Array; suggestedName: string; path?: string }) => Promise<{ canceled: boolean; path?: string }>;
  chooseDirectory: () => Promise<string | null>;
  writeFile: (options: { path: string; data: Uint8Array }) => Promise<string>;
  revealFile: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<Uint8Array>;
  googleFont: (options: { family: string; bold: boolean; italic: boolean }) => Promise<Uint8Array>;
  watchFile: (tabId: string, path: string) => Promise<boolean>;
  unwatchFile: (tabId: string) => Promise<boolean>;
  removeBackground: (options: {
    width: number;
    height: number;
    pixels: Uint8Array;
  }) => Promise<{ width: number; height: number; pixels: Uint8Array }>;
  createAiMask: (options: {
    width: number;
    height: number;
    pixels: Uint8Array;
  }) => Promise<{ width: number; height: number; alpha: Uint8Array }>;
  warmAi: () => Promise<boolean>;
  cancelAi: () => Promise<boolean>;
  setDirty: (dirty: boolean) => void;
  updateDocumentState: (state: {
    name: string;
    path?: string;
    activeDirty: boolean;
    anyDirty: boolean;
    hasDocument: boolean;
    hasActiveLayer: boolean;
    hasSelection: boolean;
    hasMask: boolean;
    activeLayerKind?: 'text' | 'vector-placed' | 'vector-editable' | 'raster' | 'group' | 'adjustment';
    selectedEditableVectors: number;
    canUndo: boolean;
    canRedo: boolean;
    undoLabel?: string;
    redoLabel?: string;
  }) => void;
  readyForFiles: () => void;
  confirmClose: () => void;
  onMenuCommand: (callback: (command: DesktopMenuCommand) => void) => () => void;
  onCloseRequested: (callback: () => void) => () => void;
  onExternalFileChange: (callback: (change: { tabId: string; path: string }) => void) => () => void;
  onOpenFiles: (callback: (files: NativeFile[]) => void) => () => void;
}

declare global {
  interface Window {
    crotoshopDesktop?: DesktopApi;
  }
}

export const desktop = window.crotoshopDesktop;
export const isDesktop = !!desktop;

export function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function nativeFile(entry: NativeFile): File & { nativePath: string } {
  const file = new File([ownedBuffer(entry.data)], entry.name);
  Object.defineProperty(file, 'nativePath', { value: entry.path, enumerable: false });
  return file as File & { nativePath: string };
}

const projectPaths = new Map<string, string>();
const documentSourceNames = new Map<string, string>();

export function getProjectPath(tabId: string | null): string | undefined {
  return tabId ? projectPaths.get(tabId) : undefined;
}

export function setProjectPath(tabId: string | null, filePath: string): void {
  if (!tabId) return;
  projectPaths.set(tabId, filePath);
  void desktop?.watchFile(tabId, filePath).catch(() => undefined);
}

export function forgetDocument(tabId: string): void {
  projectPaths.delete(tabId);
  documentSourceNames.delete(tabId);
  void desktop?.unwatchFile(tabId).catch(() => undefined);
}

export function getDocumentSourceName(tabId: string | null): string | undefined {
  return tabId ? documentSourceNames.get(tabId) : undefined;
}

export function setDocumentSourceName(tabId: string | null, name: string): void {
  if (tabId) documentSourceNames.set(tabId, name);
}

export async function nativeFiles(kind: NativeOpenKind, multiple = true): Promise<Array<File & { nativePath?: string }>> {
  if (!desktop) return [];
  const files = await desktop.openFiles({ kind, multiple });
  return files.map(nativeFile);
}

export async function saveBlobNative(blob: Blob, suggestedName: string, filePath?: string) {
  if (!desktop) return null;
  return desktop.saveFile({ data: new Uint8Array(await blob.arrayBuffer()), suggestedName, path: filePath });
}

export async function saveTextNative(text: string, suggestedName: string, filePath?: string) {
  if (!desktop) return null;
  return desktop.saveFile({ data: new TextEncoder().encode(text), suggestedName, path: filePath });
}
