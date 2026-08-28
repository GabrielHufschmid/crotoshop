import type { Doc, Layer, Pt } from '../types';
import { createCanvas, ctx2d } from './canvasUtils';
import { renderLayerSource } from './compositor';

export interface WarpMesh {
  columns: number;
  rows: number;
  source: Pt[];
  points: Pt[];
}

export interface WarpBounds { x: number; y: number; w: number; h: number }

export function createWarpMesh(bounds: WarpBounds, columns: number, rows: number): WarpMesh {
  const cols = Math.max(2, Math.round(columns));
  const rowCount = Math.max(2, Math.round(rows));
  const source: Pt[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let column = 0; column < cols; column++) {
      source.push({
        x: bounds.x + bounds.w * column / (cols - 1),
        y: bounds.y + bounds.h * row / (rowCount - 1),
      });
    }
  }
  return { columns: cols, rows: rowCount, source, points: source.map((point) => ({ ...point })) };
}

/** Renders the adjusted/masked layer into document coordinates without opacity. */
export function warpLayerSource(doc: Doc, layer: Layer): HTMLCanvasElement {
  const output = createCanvas(doc.width, doc.height);
  const g = ctx2d(output);
  const raw = renderLayerSource(layer);
  let source = raw;
  if (layer.mask?.enabled) {
    source = createCanvas(raw.width, raw.height);
    const masked = ctx2d(source);
    masked.drawImage(raw, 0, 0);
    masked.globalCompositeOperation = 'destination-in';
    masked.drawImage(layer.mask.canvas, 0, 0, raw.width, raw.height);
  }
  const width = layer.w ?? raw.width;
  const height = layer.h ?? raw.height;
  g.translate(layer.x + width / 2, layer.y + height / 2);
  g.rotate(layer.rotation ?? 0);
  g.drawImage(source, -width / 2, -height / 2, width, height);
  return output;
}

function expandedTriangle(points: [Pt, Pt, Pt], amount = 0.45): [Pt, Pt, Pt] {
  const cx = (points[0].x + points[1].x + points[2].x) / 3;
  const cy = (points[0].y + points[1].y + points[2].y) / 3;
  return points.map((point) => {
    const distance = Math.max(1, Math.hypot(point.x - cx, point.y - cy));
    const scale = (distance + amount) / distance;
    return { x: cx + (point.x - cx) * scale, y: cy + (point.y - cy) * scale };
  }) as [Pt, Pt, Pt];
}

function lerpPoint(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function extrapolatedGridPoint(mesh: WarpMesh, column: number, row: number): Pt {
  const pointAt = (c: number, r: number) => mesh.points[r * mesh.columns + c];
  const horizontal = (c: number, r: number): Pt => {
    if (c < 0) {
      const edge = pointAt(0, r);
      const next = pointAt(1, r);
      return { x: edge.x * 2 - next.x, y: edge.y * 2 - next.y };
    }
    if (c >= mesh.columns) {
      const edge = pointAt(mesh.columns - 1, r);
      const previous = pointAt(mesh.columns - 2, r);
      return { x: edge.x * 2 - previous.x, y: edge.y * 2 - previous.y };
    }
    return pointAt(c, r);
  };
  if (row < 0) {
    const edge = horizontal(column, 0);
    const next = horizontal(column, 1);
    return { x: edge.x * 2 - next.x, y: edge.y * 2 - next.y };
  }
  if (row >= mesh.rows) {
    const edge = horizontal(column, mesh.rows - 1);
    const previous = horizontal(column, mesh.rows - 2);
    return { x: edge.x * 2 - previous.x, y: edge.y * 2 - previous.y };
  }
  return horizontal(column, row);
}

function organicCurve(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number, fluidity: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  const catmull = {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
  return lerpPoint(lerpPoint(p1, p2, t), catmull, Math.max(0, Math.min(1, fluidity)));
}

/** Samples the continuous destination surface at normalized mesh coordinates. */
export function sampleWarpSurface(mesh: WarpMesh, u: number, v: number, fluidity = 0.85): Pt {
  const gx = Math.max(0, Math.min(1, u)) * (mesh.columns - 1);
  const gy = Math.max(0, Math.min(1, v)) * (mesh.rows - 1);
  const column = Math.min(mesh.columns - 2, Math.floor(gx));
  const row = Math.min(mesh.rows - 2, Math.floor(gy));
  const tx = gx - column;
  const ty = gy - row;
  const horizontal: Pt[] = [];
  for (let offset = -1; offset <= 2; offset++) {
    horizontal.push(organicCurve(
      extrapolatedGridPoint(mesh, column - 1, row + offset),
      extrapolatedGridPoint(mesh, column, row + offset),
      extrapolatedGridPoint(mesh, column + 1, row + offset),
      extrapolatedGridPoint(mesh, column + 2, row + offset),
      tx,
      fluidity,
    ));
  }
  return organicCurve(horizontal[0], horizontal[1], horizontal[2], horizontal[3], ty, fluidity);
}

function sampleSource(mesh: WarpMesh, u: number, v: number): Pt {
  const gx = Math.max(0, Math.min(1, u)) * (mesh.columns - 1);
  const gy = Math.max(0, Math.min(1, v)) * (mesh.rows - 1);
  const column = Math.min(mesh.columns - 2, Math.floor(gx));
  const row = Math.min(mesh.rows - 2, Math.floor(gy));
  const tx = gx - column;
  const ty = gy - row;
  const index = (c: number, r: number) => r * mesh.columns + c;
  const top = lerpPoint(mesh.source[index(column, row)], mesh.source[index(column + 1, row)], tx);
  const bottom = lerpPoint(mesh.source[index(column, row + 1)], mesh.source[index(column + 1, row + 1)], tx);
  return lerpPoint(top, bottom, ty);
}

function buildWarpVertices(source: HTMLCanvasElement, mesh: WarpMesh, fluidity: number): Float32Array {
  const values: number[] = [];
  const cellWidth = Math.abs(mesh.source[mesh.columns - 1].x - mesh.source[0].x) / (mesh.columns - 1);
  const cellHeight = Math.abs(mesh.source[(mesh.rows - 1) * mesh.columns].y - mesh.source[0].y) / (mesh.rows - 1);
  const subdivisions = Math.max(5, Math.min(18, Math.ceil(Math.max(cellWidth, cellHeight) / 36)));
  const vertex = (u: number, v: number) => {
    const destination = sampleWarpSurface(mesh, u, v, fluidity);
    const original = sampleSource(mesh, u, v);
    return [destination.x, destination.y, original.x / source.width, original.y / source.height];
  };
  const push = (...vertices: number[][]) => vertices.forEach((item) => values.push(...item));
  for (let row = 0; row < mesh.rows - 1; row++) {
    for (let column = 0; column < mesh.columns - 1; column++) {
      for (let sy = 0; sy < subdivisions; sy++) {
        for (let sx = 0; sx < subdivisions; sx++) {
          const u0 = (column + sx / subdivisions) / (mesh.columns - 1);
          const u1 = (column + (sx + 1) / subdivisions) / (mesh.columns - 1);
          const v0 = (row + sy / subdivisions) / (mesh.rows - 1);
          const v1 = (row + (sy + 1) / subdivisions) / (mesh.rows - 1);
          const tl = vertex(u0, v0);
          const tr = vertex(u1, v0);
          const bl = vertex(u0, v1);
          const br = vertex(u1, v1);
          push(tl, tr, br, tl, br, bl);
        }
      }
    }
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

function renderWarpWebGL(source: HTMLCanvasElement, vertices: Float32Array, smoothing: boolean): HTMLCanvasElement | null {
  const output = createCanvas(source.width, source.height);
  const options = { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true };
  const webgl2 = output.getContext('webgl2', options) as WebGL2RenderingContext | null;
  const gl: WebGL2RenderingContext | WebGLRenderingContext | null = webgl2
    ?? output.getContext('webgl', options) as WebGLRenderingContext | null;
  if (!gl) return null;
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    uniform vec2 u_resolution;
    varying vec2 v_texCoord;
    void main() {
      vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_image;
    varying vec2 v_texCoord;
    void main() { gl_FragColor = texture2D(u_image, v_texCoord); }
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
  gl.viewport(0, 0, output.width, output.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const position = gl.getAttribLocation(program, 'a_position');
  const texCoord = gl.getAttribLocation(program, 'a_texCoord');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(texCoord);
  gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
  gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), output.width, output.height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smoothing ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smoothing ? gl.LINEAR : gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 4);
  gl.finish();
  const rendered = createCanvas(source.width, source.height);
  ctx2d(rendered).drawImage(output, 0, 0);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return rendered;
}

function renderWarpCanvas(source: HTMLCanvasElement, mesh: WarpMesh, fluidity: number, smoothing: boolean): HTMLCanvasElement {
  const output = createCanvas(source.width, source.height);
  const g = ctx2d(output);
  g.imageSmoothingEnabled = smoothing;
  g.imageSmoothingQuality = 'high';
  const subdivisions = 6;
  for (let row = 0; row < mesh.rows - 1; row++) {
    for (let column = 0; column < mesh.columns - 1; column++) {
      for (let sy = 0; sy < subdivisions; sy++) {
        for (let sx = 0; sx < subdivisions; sx++) {
          const u0 = (column + sx / subdivisions) / (mesh.columns - 1);
          const u1 = (column + (sx + 1) / subdivisions) / (mesh.columns - 1);
          const v0 = (row + sy / subdivisions) / (mesh.rows - 1);
          const v1 = (row + (sy + 1) / subdivisions) / (mesh.rows - 1);
          const s00 = sampleSource(mesh, u0, v0), s10 = sampleSource(mesh, u1, v0);
          const s01 = sampleSource(mesh, u0, v1), s11 = sampleSource(mesh, u1, v1);
          const d00 = sampleWarpSurface(mesh, u0, v0, fluidity), d10 = sampleWarpSurface(mesh, u1, v0, fluidity);
          const d01 = sampleWarpSurface(mesh, u0, v1, fluidity), d11 = sampleWarpSurface(mesh, u1, v1, fluidity);
          drawTriangle(g, source, [s00, s10, s11], [d00, d10, d11]);
          drawTriangle(g, source, [s00, s11, s01], [d00, d11, d01]);
        }
      }
    }
  }
  return output;
}

function drawTriangle(
  g: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  source: [Pt, Pt, Pt],
  destination: [Pt, Pt, Pt],
): void {
  const [s0, s1, s2] = source;
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 0.00001) return;
  const [d0, d1, d2] = destination;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const clip = expandedTriangle(destination);
  g.save();
  g.beginPath();
  g.moveTo(clip[0].x, clip[0].y);
  g.lineTo(clip[1].x, clip[1].y);
  g.lineTo(clip[2].x, clip[2].y);
  g.closePath();
  g.clip();
  g.setTransform(a, b, c, d, e, f);
  g.drawImage(image, 0, 0);
  g.restore();
}

export function renderWarpMesh(source: HTMLCanvasElement, mesh: WarpMesh, smoothing = true, fluidity = 0.85): HTMLCanvasElement {
  const vertices = buildWarpVertices(source, mesh, fluidity);
  return renderWarpWebGL(source, vertices, smoothing) ?? renderWarpCanvas(source, mesh, fluidity, smoothing);
}
