import type { JSX } from 'react';

export type IconName =
  | 'move' | 'crop' | 'eraser' | 'recolor' | 'bg' | 'hand'
  | 'eye' | 'eye-off' | 'plus' | 'trash' | 'undo' | 'redo'
  | 'open' | 'export' | 'zoom-in' | 'zoom-out' | 'grip' | 'reset' | 'close'
  | 'select-rect' | 'select-ellipse' | 'select-poly' | 'select-bezier'
  | 'select-replace' | 'select-add' | 'select-subtract' | 'select-intersect'
  | 'select-expand' | 'select-contract' | 'select-smooth'
  | 'select-feather'
  | 'wand' | 'ai-mask' | 'text' | 'bucket' | 'ruler' | 'gear' | 'image-plus'
  | 'save' | 'project' | 'trim'
  | 'brush' | 'blur' | 'sharpen' | 'folder' | 'adjust' | 'mask' | 'lock' | 'lock-pixels' | 'artboard' | 'command'
  | 'pen' | 'direct-select' | 'node-select' | 'node-add' | 'node-delete' | 'node-convert'
  | 'shape' | 'shape-rectangle' | 'shape-ellipse' | 'shape-triangle' | 'shape-polygon'
  | 'stroke-inside' | 'stroke-center' | 'stroke-outside'
  | 'path-unite' | 'path-subtract' | 'path-intersect' | 'path-exclude' | 'compound' | 'release-compound' | 'simplify' | 'vectorize' | 'outline'
  | 'palette' | 'eyedropper'
  | 'palette-analogous' | 'palette-complementary' | 'palette-triad' | 'palette-split' | 'palette-mono'
  | 'magic-remove' | 'pixel-stretch' | 'warp-mesh'
  | 'align-left' | 'align-center-h' | 'align-right'
  | 'align-top' | 'align-center-v' | 'align-bottom'
  | 'distribute-horizontal' | 'distribute-vertical'
  | 'chevron-down' | 'panel' | 'doc-file' | 'resize' | 'link';

const P: Record<IconName, JSX.Element> = {
  move: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  crop: (
    <>
      <path d="M6 2v16a2 2 0 0 0 2 2h16" />
      <path d="M2 6h16a2 2 0 0 1 2 2v16" />
    </>
  ),
  eraser: (
    <>
      <path d="M4 14l7-7 6 6-7 7H7z" />
      <path d="M11 7l6 6M6 20h14" />
    </>
  ),
  recolor: (
    <>
      <path d="M12 3s6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 6-10 6-10z" />
    </>
  ),
  bg: (
    <>
      <path d="M5 5l6 6M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
      <path d="M11 13l8-8M20 20l-6-6" />
    </>
  ),
  hand: (
    <>
      <path d="M8 13V5a1.5 1.5 0 0 1 3 0v6" />
      <path d="M11 11V4a1.5 1.5 0 0 1 3 0v7" />
      <path d="M14 11V5a1.5 1.5 0 0 1 3 0v8c0 4-2.5 8-6 8s-6-3-6-6v-1l-1.5-2.5a1.5 1.5 0 0 1 2.5-1.6L8 13" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M3 3l18 18M10.6 10.6a2.5 2.5 0 0 0 3.4 3.4" />
      <path d="M6.5 6.6C4 8.2 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1M9.5 5.2A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.4 3.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </>
  ),
  undo: <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-1" />,
  redo: <path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h1" />,
  open: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  export: <path d="M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />,
  save: (
    <>
      <path d="M5 4h12l2 2v14H5z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </>
  ),
  project: (
    <>
      <path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M8 11h8M8 15h5" />
    </>
  ),
  trim: (
    <>
      <path d="M6 3v15h15" />
      <path d="M3 6h15v15" />
      <path d="M9 9h6v6H9z" />
    </>
  ),
  brush: (
    <>
      <path d="M9.1 13.8L17.7 5.2a2.2 2.2 0 0 1 3.1 3.1l-8.6 8.6" />
      <path d="M10.6 15.3c1.5 1.5 1.3 4-.3 5.4-1.8 1.6-4.8 1.1-7.3.3 1.5-1 1.4-2.2 1.5-3.4.1-2.9 3.8-4.6 6.1-2.3z" />
      <path d="M14.8 8.1l3.1 3.1" />
    </>
  ),
  blur: <><circle cx="11" cy="11" r="5" /><path d="M18 18l3 3M7 4l-2 2M15 4l2 2M4 12H2M20 12h2M7 20l-2-2M15 20l2-2" /></>,
  sharpen: <><path d="M12 3l8 17H4z" /><path d="M12 8v5M12 17h.01" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  adjust: <><circle cx="12" cy="12" r="8" /><path d="M12 4v16M4 12h16" /></>,
  mask: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="10" cy="12" r="3" /><path d="M14 9h4M14 12h4M14 15h4" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  'lock-pixels': <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h.01M15 17h.01" /></>,
  artboard: <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M8 2v4M16 2v4M8 18v4M16 18v4" /></>,
  command: <><path d="M9 9H6a3 3 0 1 1 3-3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3V6a3 3 0 1 1 3 3z" /></>,
  pen: <><path d="M5 19l1.5-5.5L15 5l4 4-8.5 8.5z" /><path d="M13 7l4 4M4 20h5" /></>,
  shape: <><rect x="4" y="5" width="11" height="11" rx="1.5" /><circle cx="16" cy="15" r="5" /></>,
  'shape-rectangle': <rect x="4" y="5" width="16" height="14" rx="2" />,
  'shape-ellipse': <ellipse cx="12" cy="12" rx="8" ry="6.5" />,
  'shape-triangle': <path d="M12 4l9 16H3z" />,
  'shape-polygon': <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />,
  'stroke-inside': <><rect x="4" y="4" width="16" height="16" rx="1" /><rect x="7" y="7" width="10" height="10" rx=".5" strokeWidth="2.5" /></>,
  'stroke-center': <><rect x="5.5" y="5.5" width="13" height="13" rx="1" strokeWidth="3" /><path d="M5.5 5.5h13v13h-13z" strokeDasharray="1 3" /></>,
  'stroke-outside': <><rect x="7" y="7" width="10" height="10" rx=".5" /><rect x="4" y="4" width="16" height="16" rx="1" strokeWidth="2.5" /></>,
  'direct-select': <><path d="M5 3l7.8 16 1.7-6.3L21 11z" /><rect x="17.5" y="16.5" width="3.5" height="3.5" rx=".3" /></>,
  'node-select': <><path d="M5 3l7.2 14.7 1.5-5.7 5.8-1.5z" /><rect x="16" y="16" width="5" height="5" rx=".5" /></>,
  'node-add': <><path d="M4 18C7 7 12 5 20 6" /><rect x="9" y="8" width="4" height="4" rx=".4" /><path d="M18 14v7M14.5 17.5h7" /></>,
  'node-delete': <><path d="M4 18C7 7 12 5 20 6" /><rect x="9" y="8" width="4" height="4" rx=".4" /><path d="M15 17.5h7" /></>,
  'node-convert': <><path d="M3 17C7 5 13 5 21 8" /><path d="M8 12h8M12 8v8" /><circle cx="12" cy="12" r="2" /></>,
  'path-unite': <><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /><path d="M12 7.2c1.8 1 3 2.7 3 4.8s-1.2 3.8-3 4.8c-1.8-1-3-2.7-3-4.8s1.2-3.8 3-4.8z" fill="currentColor" stroke="none" /></>,
  'path-subtract': <><circle cx="9" cy="12" r="6" /><path d="M12 7.2a6 6 0 1 1 0 9.6" /><path d="M12 7.2c1.8 1 3 2.7 3 4.8s-1.2 3.8-3 4.8" strokeDasharray="2 2" /></>,
  'path-intersect': <><circle cx="9" cy="12" r="6" strokeDasharray="2 2" /><circle cx="15" cy="12" r="6" strokeDasharray="2 2" /><path d="M12 7.2c1.8 1 3 2.7 3 4.8s-1.2 3.8-3 4.8c-1.8-1-3-2.7-3-4.8s1.2-3.8 3-4.8z" /></>,
  'path-exclude': <><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /><path d="M12 7.2c1.8 1 3 2.7 3 4.8s-1.2 3.8-3 4.8c-1.8-1-3-2.7-3-4.8s1.2-3.8 3-4.8z" fill="var(--panel, #222)" /></>,
  compound: <><path d="M4 5h11v11H4z" /><circle cx="15.5" cy="14.5" r="5.5" /><path d="M12 11.2a5.5 5.5 0 0 0 0 6.6" strokeDasharray="2 2" /></>,
  'release-compound': <><path d="M3 5h9v9H3z" /><circle cx="16.5" cy="16" r="4.5" /><path d="M11 12l3 3M11 12h4M11 12v4" /></>,
  simplify: <><path d="M3 17C6 5 14 5 21 8" /><rect x="2" y="15.5" width="3" height="3" rx=".4" /><rect x="19.5" y="6.5" width="3" height="3" rx=".4" /><path d="M8 19h8M13 16l3 3-3 3" /></>,
  vectorize: <><rect x="4" y="4" width="16" height="16" rx="1" strokeDasharray="2 2" /><path d="M6 17C8 7 14 6 18 9" /><rect x="5" y="15.5" width="3" height="3" rx=".3" /><rect x="16.5" y="7.5" width="3" height="3" rx=".3" /></>,
  outline: <><path d="M4 18C7 6 14 5 20 8" /><rect x="2.5" y="16.5" width="3" height="3" rx=".3" /><rect x="18.5" y="6.5" width="3" height="3" rx=".3" /><path d="M9 20h6M12 17v6" /></>,
  palette: <><path d="M12 3a9 9 0 0 0 0 18h1.3a1.7 1.7 0 0 0 0-3.4h-.7a1.7 1.7 0 0 1 0-3.4h3.1A5.3 5.3 0 0 0 21 8.9C20.4 5.5 16.8 3 12 3z" /><circle cx="7.8" cy="11" r=".8" /><circle cx="10.5" cy="7.5" r=".8" /><circle cx="14.7" cy="7.5" r=".8" /></>,
  eyedropper: <><path d="M18 3l3 3a2 2 0 0 1 0 3l-8.5 8.5-4-4L17 4a2 2 0 0 1 1-1z" /><path d="M10.5 15.5L5 21H2v-3l5.5-5.5M14.5 6.5l3 3" /></>,
  'palette-analogous': <><circle cx="5" cy="12" r="2" /><circle cx="9.5" cy="9" r="2" /><circle cx="14.5" cy="9" r="2" /><circle cx="19" cy="12" r="2" /><path d="M5 17h14" /></>,
  'palette-complementary': <><circle cx="6.5" cy="12" r="3.5" /><circle cx="17.5" cy="12" r="3.5" /><path d="M10 12h4" /></>,
  'palette-triad': <><circle cx="12" cy="5.5" r="2.5" /><circle cx="6" cy="17" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path d="M10 7.5l-2.5 7M14 7.5l2.5 7M8.5 17h7" /></>,
  'palette-split': <><circle cx="5.5" cy="12" r="2.5" /><circle cx="16" cy="7" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path d="M8 12l5.5-4M8 12l7.5 4" /></>,
  'palette-mono': <><circle cx="5" cy="12" r="2" /><circle cx="9.5" cy="12" r="2" /><circle cx="14" cy="12" r="2" /><circle cx="18.5" cy="12" r="2" /><path d="M4 17h16" /></>,
  'magic-remove': <><path d="M5 19l8-8 4 4-8 8H5z" /><path d="M14 4v4M12 6h4M19 9v3M17.5 10.5h3" /><path d="M7 17l2 2" /></>,
  'pixel-stretch': (
    <>
      <path d="M4 5h4M4 9h6M4 13h4M4 17h7" />
      <path d="M10 9c4 0 3 8 9 8M8 5c7 0 5 8 11 8M8 13c5 0 4 8 11 8" />
      <circle cx="19" cy="17" r="1.4" />
    </>
  ),
  'warp-mesh': (
    <>
      <path d="M4 5c5 2 11-2 16 0M4 12c5 2 11-2 16 0M4 19c5 2 11-2 16 0" />
      <path d="M5 4c-2 5 2 11 0 16M12 4c-2 5 2 11 0 16M19 4c-2 5 2 11 0 16" />
      <circle cx="12" cy="12" r="1.4" />
    </>
  ),
  'zoom-in': (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M11 8v6M8 11h6M20 20l-3.5-3.5" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M8 11h6M20 20l-3.5-3.5" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
    </>
  ),
  reset: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'select-rect': (
    <path d="M4 4h3M10 4h4M17 4h3M4 4v3M4 10v4M4 17v3M20 4v3M20 10v4M20 17v3M4 20h3M10 20h4M17 20h3" />
  ),
  'select-ellipse': (
    <>
      <path d="M12 4a8 8 0 0 1 8 8" strokeDasharray="3 3" />
      <path d="M20 12a8 8 0 0 1-8 8" strokeDasharray="3 3" />
      <path d="M12 20a8 8 0 0 1-8-8" strokeDasharray="3 3" />
      <path d="M4 12a8 8 0 0 1 8-8" strokeDasharray="3 3" />
    </>
  ),
  'select-poly': (
    <path d="M5 8l7-4 7 5-2 8-9 3z" strokeDasharray="3 3" />
  ),
  'select-bezier': (
    <>
      <path d="M5 19C5 9 12 5 19 5" />
      <path d="M2 19h6M16 2v6" />
      <circle cx="5" cy="19" r="1.5" /><circle cx="19" cy="5" r="1.5" />
    </>
  ),
  'select-replace': (
    <><rect x="5" y="5" width="14" height="14" rx="1" /><path d="M8 8h8M8 12h8M8 16h8" /></>
  ),
  'select-add': (
    <><path d="M4 5h10v10H4z" strokeDasharray="2 2" /><path d="M10 10h10v10H10z" /><path d="M15 13v4M13 15h4" /></>
  ),
  'select-subtract': (
    <><path d="M4 5h10v10H4z" strokeDasharray="2 2" /><path d="M10 10h10v10H10z" /><path d="M13 15h4" /></>
  ),
  'select-intersect': (
    <><path d="M4 7a5 5 0 0 1 9-3M20 17a5 5 0 0 1-9 3" /><path d="M9 5a5 5 0 0 1 6 8M15 19a5 5 0 0 1-6-8" /><path d="M10 10h4v4h-4z" /></>
  ),
  'select-expand': (
    <><rect x="7" y="7" width="10" height="10" rx="1" strokeDasharray="2 2" /><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></>
  ),
  'select-contract': (
    <><rect x="7" y="7" width="10" height="10" rx="1" strokeDasharray="2 2" /><path d="M4 4l5 5M20 4l-5 5M20 20l-5-5M4 20l5-5" /></>
  ),
  'select-smooth': (
    <><path d="M4 15c2-8 5 4 8-4s5 4 8-4" /><path d="M4 19h16" strokeDasharray="2 2" /></>
  ),
  'select-feather': (
    <><circle cx="12" cy="12" r="6" strokeDasharray="1.5 2.5" /><circle cx="12" cy="12" r="3" /></>
  ),
  wand: (
    <>
      <path d="M6 18L18 6" />
      <path d="M15 3v3M13.5 4.5h3M20 9h2M21 8v2M4 11l1.5 1.5M9 4L7.5 5.5" />
    </>
  ),
  'ai-mask': (
    <>
      <path d="M5 16.5c.8-2.3 2.6-3.7 4.8-3.7s4 1.4 4.8 3.7" strokeDasharray="2 2" />
      <circle cx="9.8" cy="8.2" r="3.1" strokeDasharray="2 2" />
      <path d="M18 3v4M16 5h4M19.5 10v2.5M18.25 11.25h2.5" />
      <path d="M4 20h12" strokeDasharray="2 2" />
    </>
  ),
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  bucket: (
    <>
      <path d="M10 2l9 9-7.5 7.5a2 2 0 0 1-2.8 0L4 13.7a2 2 0 0 1 0-2.8z" />
      <path d="M4.5 11h13" />
      <path d="M20 15s2 2.4 2 4a2 2 0 1 1-4 0c0-1.6 2-4 2-4z" />
    </>
  ),
  ruler: (
    <>
      <rect x="2" y="9" width="20" height="6" rx="1" />
      <path d="M6 9v3M10 9v2M14 9v3M18 9v2" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  'image-plus': (
    <>
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="M7 14l2.2-2.2a1 1 0 0 1 1.4 0L14 15" />
      <circle cx="8" cy="9" r="1.2" />
      <path d="M19 4v6M16 7h6" />
    </>
  ),
  'align-left': (
    <>
      <path d="M5 4v16" />
      <rect x="9" y="6" width="9" height="4" rx="1" />
      <rect x="9" y="14" width="6" height="4" rx="1" />
    </>
  ),
  'align-center-h': (
    <>
      <path d="M12 4v16" />
      <rect x="7" y="6" width="10" height="4" rx="1" />
      <rect x="9" y="14" width="6" height="4" rx="1" />
    </>
  ),
  'align-right': (
    <>
      <path d="M19 4v16" />
      <rect x="6" y="6" width="9" height="4" rx="1" />
      <rect x="9" y="14" width="6" height="4" rx="1" />
    </>
  ),
  'align-top': (
    <>
      <path d="M4 5h16" />
      <rect x="6" y="9" width="4" height="9" rx="1" />
      <rect x="14" y="9" width="4" height="6" rx="1" />
    </>
  ),
  'align-center-v': (
    <>
      <path d="M4 12h16" />
      <rect x="6" y="7" width="4" height="10" rx="1" />
      <rect x="14" y="9" width="4" height="6" rx="1" />
    </>
  ),
  'align-bottom': (
    <>
      <path d="M4 19h16" />
      <rect x="6" y="6" width="4" height="9" rx="1" />
      <rect x="14" y="9" width="4" height="6" rx="1" />
    </>
  ),
  'distribute-horizontal': (
    <>
      <path d="M4 5v14M20 5v14" />
      <rect x="7" y="8" width="3.5" height="8" rx="1" />
      <rect x="13.5" y="8" width="3.5" height="8" rx="1" />
      <path d="M10.5 12h3" />
    </>
  ),
  'distribute-vertical': (
    <>
      <path d="M5 4h14M5 20h14" />
      <rect x="8" y="7" width="8" height="3.5" rx="1" />
      <rect x="8" y="13.5" width="8" height="3.5" rx="1" />
      <path d="M12 10.5v3" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  'doc-file': (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  resize: (
    <>
      <path d="M4 4h6M4 4v6M4 4l6 6" />
      <path d="M20 20h-6M20 20v-6M20 20l-6-6" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
    </>
  ),
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {P[name]}
    </svg>
  );
}
