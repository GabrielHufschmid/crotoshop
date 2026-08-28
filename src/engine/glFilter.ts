import type { Adjustments } from '../types';
import { createCanvas } from './canvasUtils';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 1.0 - (a_pos.y * 0.5 + 0.5));
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_gamma;
uniform float u_hue;        // radians
uniform float u_invert;
uniform float u_recolor;    // 0/1
uniform vec3  u_recolorColor;
uniform float u_preserveLuma;
out vec4 outColor;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735026919);
  float cosA = cos(a);
  return c * cosA + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cosA);
}

void main() {
  vec4 tex = texture(u_tex, v_uv);
  vec3 c = tex.rgb;
  float a = tex.a;

  if (u_recolor > 0.5) {
    float luma = dot(c, LUMA);
    vec3 flatCol = u_recolorColor;
    vec3 litCol = u_recolorColor * luma;
    c = mix(flatCol, litCol, u_preserveLuma);
  } else {
    c += u_brightness;
    c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
    c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / u_gamma));
    float l = dot(c, LUMA);
    c = mix(vec3(l), c, 1.0 + u_saturation);
    c = hueRotate(c, u_hue);
    c = mix(c, 1.0 - c, u_invert);
  }

  // Premultiplied output: guarantees fully-transparent texels stay (0,0,0,0)
  // no matter what the color math produced, and semi-transparent edges
  // composite exactly when the 2D compositor consumes this canvas.
  outColor = vec4(clamp(c, 0.0, 1.0) * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile error: ' + log);
  }
  return sh;
}

/**
 * Reusable WebGL2 pipeline that applies the adjustment chain to a source
 * canvas and renders the result into its own (offscreen) canvas.
 */
export class GLFilter {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private tex: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor() {
    this.canvas = createCanvas(1, 1);
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      // Must match the shader, which writes premultiplied alpha (see FRAG):
      // drawImage() then composites this canvas without any conversion pass.
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;

    const prog = gl.createProgram();
    if (!prog) throw new Error('createProgram failed');
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
    }
    this.program = prog;
    gl.useProgram(prog);

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture failed');
    this.tex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    for (const name of [
      'u_tex', 'u_brightness', 'u_contrast', 'u_saturation', 'u_gamma',
      'u_hue', 'u_invert', 'u_recolor', 'u_recolorColor', 'u_preserveLuma',
    ]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    gl.uniform1i(this.u.u_tex, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  /** Applies adjustments to `src`, returns the internal canvas holding the result. */
  apply(src: HTMLCanvasElement, a: Adjustments): HTMLCanvasElement {
    const gl = this.gl;
    if (this.canvas.width !== src.width || this.canvas.height !== src.height) {
      this.canvas.width = src.width;
      this.canvas.height = src.height;
    }
    gl.viewport(0, 0, src.width, src.height);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);

    gl.uniform1f(this.u.u_brightness, a.brightness);
    gl.uniform1f(this.u.u_contrast, a.contrast);
    gl.uniform1f(this.u.u_saturation, a.saturation);
    gl.uniform1f(this.u.u_gamma, a.gamma);
    gl.uniform1f(this.u.u_hue, (a.hue * Math.PI) / 180);
    gl.uniform1f(this.u.u_invert, a.invert);
    gl.uniform1f(this.u.u_recolor, a.recolor.enabled ? 1 : 0);
    gl.uniform3f(
      this.u.u_recolorColor,
      a.recolor.color[0] / 255,
      a.recolor.color[1] / 255,
      a.recolor.color[2] / 255,
    );
    gl.uniform1f(this.u.u_preserveLuma, a.recolor.preserveLuma ? 1 : 0);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
}

let shared: GLFilter | null = null;
export function getFilter(): GLFilter {
  if (!shared) shared = new GLFilter();
  return shared;
}
