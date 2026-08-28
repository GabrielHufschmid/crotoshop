import type { Doc, Layer, Pt, Selection } from '../types';
import { createCanvas, ctx2d } from './canvasUtils';
import { renderLayerSource } from './compositor';
import type { PixelStretchCurveMode, PixelStretchPattern } from '../store/settingsStore';

export interface PixelStretchNode extends Pt {
  inX: number;
  inY: number;
  outX: number;
  outY: number;
}

export interface PixelStretchSample {
  origin: Pt;
  /** Direction of the sampled cross-section, in radians. */
  angle: number;
  manual: boolean;
}

export interface PixelStretchOptions {
  sampleWidth: number;
  outputWidth: number;
  opacity: number;
  fadeStart: number;
  fadeEnd: number;
  twist: number;
  pattern: PixelStretchPattern;
  reverse: boolean;
  smoothing: boolean;
  curveMode: PixelStretchCurveMode;
  curveSmoothness: number;
  taperStart: number;
  taperEnd: number;
  edgeFeather: number;
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}

function mixPoint(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function extrapolate(edge: Pt, neighbor: Pt): Pt {
  return { x: edge.x * 2 - neighbor.x, y: edge.y * 2 - neighbor.y };
}

function knot(t: number, a: Pt, b: Pt): number {
  return t + Math.sqrt(Math.max(0.000001, Math.hypot(b.x - a.x, b.y - a.y)));
}

function knotMix(a: Pt, b: Pt, ta: number, tb: number, t: number): Pt {
  const span = Math.max(0.000001, tb - ta);
  return mixPoint(a, b, (t - ta) / span);
}

/** Centripetal Catmull-Rom avoids loops and overshoot around uneven nodes. */
function centripetalPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, progress: number): Pt {
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const t = t1 + (t2 - t1) * progress;
  const a1 = knotMix(p0, p1, t0, t1, t);
  const a2 = knotMix(p1, p2, t1, t2, t);
  const a3 = knotMix(p2, p3, t2, t3, t);
  const b1 = knotMix(a1, a2, t0, t2, t);
  const b2 = knotMix(a2, a3, t1, t3, t);
  return knotMix(b1, b2, t1, t2, t);
}

function roughPath(nodes: PixelStretchNode[], mode: PixelStretchCurveMode, smoothness: number): Pt[] {
  const points: Pt[] = [];
  for (let index = 0; index < nodes.length - 1; index++) {
    const a = nodes[index];
    const b = nodes[index + 1];
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(20, Math.min(960, Math.ceil(chord / 1.25)));
    const p0 = index > 0 ? nodes[index - 1] : extrapolate(a, b);
    const p3 = index + 2 < nodes.length ? nodes[index + 2] : extrapolate(b, a);
    for (let step = index === 0 ? 0 : 1; step <= steps; step++) {
      const t = step / steps;
      if (mode === 'auto') {
        const linear = mixPoint(a, b, t);
        const curved = centripetalPoint(p0, a, b, p3, t);
        points.push(mixPoint(linear, curved, Math.max(0, Math.min(1, smoothness))));
      } else {
        points.push({
          x: cubic(a.x, a.x + a.outX, b.x + b.inX, b.x, t),
          y: cubic(a.y, a.y + a.outY, b.y + b.inY, b.y, t),
        });
      }
    }
  }
  return points;
}

export function samplePixelStretchPath(
  nodes: PixelStretchNode[],
  mode: PixelStretchCurveMode = 'bezier',
  smoothness = 0.82,
): Pt[] {
  if (nodes.length < 2) return nodes.map(({ x, y }) => ({ x, y }));
  const rough = roughPath(nodes, mode, smoothness);
  const points: Pt[] = rough.length ? [{ ...rough[0] }] : [];
  const spacing = 0.65;
  let carry = 0;
  for (let index = 1; index < rough.length && points.length < 16_000; index++) {
    let a = rough[index - 1];
    const b = rough[index];
    let remaining = Math.hypot(b.x - a.x, b.y - a.y);
    while (carry + remaining >= spacing && remaining > 0.0001) {
      const ratio = (spacing - carry) / remaining;
      a = mixPoint(a, b, ratio);
      points.push(a);
      remaining = Math.hypot(b.x - a.x, b.y - a.y);
      carry = 0;
    }
    carry += remaining;
  }
  const end = rough[rough.length - 1];
  const last = points[points.length - 1];
  if (end && (!last || Math.hypot(end.x - last.x, end.y - last.y) > 0.01)) points.push({ ...end });
  return points;
}

export function resolvePixelStretchSample(
  nodes: PixelStretchNode[],
  sample: PixelStretchSample | null,
  mode: PixelStretchCurveMode = 'bezier',
  smoothness = 0.82,
): PixelStretchSample | null {
  if (sample) return sample;
  const points = samplePixelStretchPath(nodes, mode, smoothness);
  if (!points.length) return null;
  const first = points[0];
  const next = points.find((point) => Math.hypot(point.x - first.x, point.y - first.y) > 0.01);
  const tangent = next ? Math.atan2(next.y - first.y, next.x - first.x) : 0;
  return { origin: { ...first }, angle: tangent + Math.PI / 2, manual: false };
}

export function pixelStretchSource(
  doc: Doc,
  layer: Layer,
  visible: HTMLCanvasElement,
  source: 'layer' | 'visible',
  selection: Selection | null,
): HTMLCanvasElement {
  const out = createCanvas(doc.width, doc.height);
  const g = ctx2d(out);
  if (source === 'visible') {
    g.drawImage(visible, 0, 0);
  } else {
    const raw = renderLayerSource(layer);
    const masked = createCanvas(raw.width, raw.height);
    const mg = ctx2d(masked);
    mg.drawImage(raw, 0, 0);
    if (layer.mask?.enabled) {
      mg.globalCompositeOperation = 'destination-in';
      mg.drawImage(layer.mask.canvas, 0, 0, raw.width, raw.height);
    }
    const width = layer.w ?? raw.width;
    const height = layer.h ?? raw.height;
    g.globalAlpha = layer.opacity;
    g.translate(layer.x + width / 2, layer.y + height / 2);
    g.rotate(layer.rotation ?? 0);
    g.drawImage(masked, -width / 2, -height / 2, width, height);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
  }
  if (selection) {
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(selection.mask, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
  return out;
}

function makeSampleStrip(
  source: HTMLCanvasElement,
  sample: PixelStretchSample,
  width: number,
  smoothing: boolean,
): HTMLCanvasElement {
  const strip = createCanvas(1, width);
  const g = ctx2d(strip);
  g.imageSmoothingEnabled = smoothing;
  g.imageSmoothingQuality = 'high';
  const direction = { x: Math.cos(sample.angle), y: Math.sin(sample.angle) };
  const perpendicular = { x: -direction.y, y: direction.x };
  g.setTransform(
    perpendicular.x,
    direction.x,
    perpendicular.y,
    direction.y,
    0.5 - sample.origin.x * perpendicular.x - sample.origin.y * perpendicular.y,
    width / 2 - sample.origin.x * direction.x - sample.origin.y * direction.y,
  );
  g.drawImage(source, 0, 0);
  return strip;
}

function widthFactor(progress: number, start: number, end: number): number {
  const smooth = (t: number) => t * t * (3 - 2 * t);
  if (progress <= 0.5) return start + (1 - start) * smooth(progress * 2);
  return 1 + (end - 1) * smooth((progress - 0.5) * 2);
}

function buildRibbonVertices(points: Pt[], options: PixelStretchOptions): Float32Array {
  const values: number[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const before = points[Math.max(0, index - 2)];
    const after = points[Math.min(points.length - 1, index + 2)];
    const progress = index / Math.max(1, points.length - 1);
    const tangent = Math.atan2(after.y - before.y, after.x - before.x) + options.twist * Math.PI / 180 * progress;
    const halfWidth = Math.max(0.5, options.outputWidth * widthFactor(progress, options.taperStart, options.taperEnd) / 2);
    const nx = -Math.sin(tangent);
    const ny = Math.cos(tangent);
    values.push(point.x - nx * halfWidth, point.y - ny * halfWidth, 0, progress);
    values.push(point.x + nx * halfWidth, point.y + ny * halfWidth, 1, progress);
  }
  return new Float32Array(values);
}

function compileShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function renderRibbonWebGL(
  source: HTMLCanvasElement,
  strip: HTMLCanvasElement,
  vertices: Float32Array,
  options: PixelStretchOptions,
): HTMLCanvasElement | null {
  const gpuCanvas = createCanvas(source.width, source.height);
  const contextOptions = { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true };
  const webgl2 = gpuCanvas.getContext('webgl2', contextOptions) as WebGL2RenderingContext | null;
  const gl: WebGL2RenderingContext | WebGLRenderingContext | null = webgl2
    ?? gpuCanvas.getContext('webgl', contextOptions) as WebGLRenderingContext | null;
  if (!gl) return null;
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute float a_across;
    attribute float a_progress;
    uniform vec2 u_resolution;
    varying float v_across;
    varying float v_progress;
    void main() {
      vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      v_across = a_across;
      v_progress = a_progress;
    }
  `);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_strip;
    uniform float u_opacity;
    uniform float u_fadeStart;
    uniform float u_fadeEnd;
    uniform float u_edge;
    uniform float u_cycles;
    uniform int u_pattern;
    uniform bool u_reverse;
    varying float v_across;
    varying float v_progress;
    void main() {
      float across = clamp(v_across, 0.0, 1.0);
      float stripV = across;
      if (u_pattern == 1) stripV = fract(min(across, 0.999999) * u_cycles);
      if (u_pattern == 2) {
        float phase = mod(min(across, 0.999999) * u_cycles, 2.0);
        stripV = 1.0 - abs(phase - 1.0);
      }
      if (u_reverse) stripV = 1.0 - stripV;
      vec4 color = texture2D(u_strip, vec2(0.5, stripV));
      float fadeIn = u_fadeStart > 0.0 ? clamp(v_progress / u_fadeStart, 0.0, 1.0) : 1.0;
      float fadeOut = u_fadeEnd > 0.0 ? clamp((1.0 - v_progress) / u_fadeEnd, 0.0, 1.0) : 1.0;
      float edgeAlpha = u_edge > 0.0
        ? smoothstep(0.0, u_edge, across) * smoothstep(0.0, u_edge, 1.0 - across)
        : 1.0;
      float alpha = u_opacity * fadeIn * fadeOut * edgeAlpha;
      gl_FragColor = vec4(color.rgb * alpha, color.a * alpha);
    }
  `);
  if (!vertexShader || !fragmentShader) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!buffer || !texture) return null;
  gl.viewport(0, 0, gpuCanvas.width, gpuCanvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const position = gl.getAttribLocation(program, 'a_position');
  const across = gl.getAttribLocation(program, 'a_across');
  const progress = gl.getAttribLocation(program, 'a_progress');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(across);
  gl.vertexAttribPointer(across, 1, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
  gl.enableVertexAttribArray(progress);
  gl.vertexAttribPointer(progress, 1, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
  gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), gpuCanvas.width, gpuCanvas.height);
  gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), Math.max(0, Math.min(1, options.opacity)));
  gl.uniform1f(gl.getUniformLocation(program, 'u_fadeStart'), Math.max(0, options.fadeStart));
  gl.uniform1f(gl.getUniformLocation(program, 'u_fadeEnd'), Math.max(0, options.fadeEnd));
  gl.uniform1f(gl.getUniformLocation(program, 'u_edge'), Math.min(0.49, Math.max(0, options.edgeFeather) / Math.max(1, options.outputWidth)));
  gl.uniform1f(gl.getUniformLocation(program, 'u_cycles'), Math.max(1, options.outputWidth / Math.max(1, options.sampleWidth)));
  gl.uniform1i(gl.getUniformLocation(program, 'u_pattern'), options.pattern === 'repeat' ? 1 : options.pattern === 'mirror' ? 2 : 0);
  gl.uniform1i(gl.getUniformLocation(program, 'u_reverse'), options.reverse ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, options.smoothing ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, options.smoothing ? gl.LINEAR : gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, strip);
  gl.uniform1i(gl.getUniformLocation(program, 'u_strip'), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices.length / 4);
  gl.finish();
  const rendered = createCanvas(source.width, source.height);
  ctx2d(rendered).drawImage(gpuCanvas, 0, 0);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return rendered;
}

function makeMaterial(strip: HTMLCanvasElement, options: PixelStretchOptions): HTMLCanvasElement {
  const outputWidth = Math.max(1, Math.round(options.outputWidth));
  const material = createCanvas(1, outputWidth);
  const g = ctx2d(material);
  g.imageSmoothingEnabled = options.smoothing;
  g.imageSmoothingQuality = 'high';
  const drawTile = (y: number, height: number, flip: boolean) => {
    g.save();
    if (flip !== options.reverse) {
      g.translate(0, y + height);
      g.scale(1, -1);
      g.drawImage(strip, 0, 0, 1, strip.height, 0, 0, 1, height);
    } else {
      g.drawImage(strip, 0, 0, 1, strip.height, 0, y, 1, height);
    }
    g.restore();
  };
  if (options.pattern === 'stretch') {
    drawTile(0, outputWidth, false);
  } else {
    for (let y = 0, tile = 0; y < outputWidth; tile++) {
      const height = Math.min(strip.height, outputWidth - y);
      drawTile(y, height, options.pattern === 'mirror' && tile % 2 === 1);
      y += height;
    }
  }
  if (options.edgeFeather > 0) {
    const edge = Math.min(outputWidth / 2, options.edgeFeather);
    const mask = g.createLinearGradient(0, 0, 0, outputWidth);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(edge / outputWidth, '#000');
    mask.addColorStop(1 - edge / outputWidth, '#000');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = mask;
    g.fillRect(0, 0, 1, outputWidth);
  }
  return material;
}

function renderRibbonCanvas(
  source: HTMLCanvasElement,
  strip: HTMLCanvasElement,
  points: Pt[],
  options: PixelStretchOptions,
): HTMLCanvasElement {
  const output = createCanvas(source.width, source.height);
  const material = makeMaterial(strip, options);
  const g = ctx2d(output);
  g.imageSmoothingEnabled = options.smoothing;
  g.imageSmoothingQuality = 'high';
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) continue;
    const progress = index / Math.max(1, points.length - 2);
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 2)];
    const tangent = Math.atan2(after.y - before.y, after.x - before.x) + options.twist * Math.PI / 180 * progress;
    const width = options.outputWidth * widthFactor(progress, options.taperStart, options.taperEnd);
    const nx = -Math.sin(tangent) * width / Math.max(1, options.outputWidth);
    const ny = Math.cos(tangent) * width / Math.max(1, options.outputWidth);
    const fadeIn = options.fadeStart > 0 ? Math.min(1, progress / options.fadeStart) : 1;
    const fadeOut = options.fadeEnd > 0 ? Math.min(1, (1 - progress) / options.fadeEnd) : 1;
    g.globalAlpha = Math.max(0, Math.min(1, options.opacity * fadeIn * fadeOut));
    g.setTransform(
      dx + Math.cos(tangent) * 0.8,
      dy + Math.sin(tangent) * 0.8,
      nx,
      ny,
      a.x - nx * options.outputWidth / 2,
      a.y - ny * options.outputWidth / 2,
    );
    g.drawImage(material, 0, 0);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  return output;
}

export function renderPixelStretch(
  source: HTMLCanvasElement,
  nodes: PixelStretchNode[],
  options: PixelStretchOptions,
  sample: PixelStretchSample | null = null,
): HTMLCanvasElement {
  const points = samplePixelStretchPath(nodes, options.curveMode, options.curveSmoothness);
  if (points.length < 2) return createCanvas(source.width, source.height);
  const resolvedSample = resolvePixelStretchSample(nodes, sample, options.curveMode, options.curveSmoothness);
  if (!resolvedSample) return createCanvas(source.width, source.height);
  const strip = makeSampleStrip(source, resolvedSample, Math.max(1, Math.round(options.sampleWidth)), options.smoothing);
  const vertices = buildRibbonVertices(points, options);
  return renderRibbonWebGL(source, strip, vertices, options)
    ?? renderRibbonCanvas(source, strip, points, options);
}
