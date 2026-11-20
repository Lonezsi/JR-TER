/* The glass's backdrop, drawn.
 *
 * One WebGL2 canvas behind the interface. It does exactly two things a stylesheet cannot
 * do without flickering:
 *
 *   1. BLUR what is behind each pane of glass (the song's artwork and the drifting
 *      particles), and
 *   2. SPLIT that blurred picture into its red, green and blue at the pane's rim: the
 *      chromatic aberration of a real glass edge.
 *
 * Everything else about a pane is CSS and stays CSS: its film, its 1.5px edge line, its
 * shadow, its radius. So a pane looks the same with or without this canvas apart from the
 * blur and the split, and nothing switches on late.
 *
 * WHY NOT backdrop-filter. A backdrop-filter re-reads the screen under a pane whenever
 * anything inside the pane repaints; every hover is a repaint, and on some GPUs that read
 * picks up the pane's own previous output, giving a hard-edged patch that flickers. Here the
 * blur is computed from the picture itself, never from the screen, so a hover cannot change
 * it: the DOM is not in the picture at all.
 *
 * COST. The ground is drawn at a quarter of the resolution and only when it changes (a new
 * song, a cross fade). The blur runs at an eighth of the resolution and only when the ground
 * or the particles change. Each frame then costs one bilinear tap per screen pixel plus the
 * pixels of the panes themselves, and an idle app draws nothing at all.
 *
 * Coordinates: "device px" are canvas pixels, origin top left.
 */

export interface PaneInfo {
  x: number; y: number; w: number; h: number;
  /** Corner radius, device px. */
  r: number;
  /** 0..1: the pane's opacity, ancestors included. */
  a: number;
}

/** One particle: position and radius in device px, and its brightness 0..1. */
export interface Speck { x: number; y: number; r: number; a: number }

export interface GroundSpec { url: string | null; hue: number | null }

export const MAX_PANES = 16;
export const MAX_SPECKS = 96;

const FULL_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ── the ground: artwork (or a hue wash), blurred and graded, into a quarter size texture ──
const GROUND_FS = `#version 300 es
precision highp float;
uniform vec2 uSize;            // the texture being drawn
uniform vec2 uRes;             // the canvas
uniform float uMix;
uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform vec2 uImg[2];
uniform float uSc[2];
uniform float uLod[2];
uniform float uKind[2];        // 0 nothing, 1 picture, 2 hue wash
uniform float uHue[2];
out vec4 outColor;

vec3 hsl2rgb(float h, float s, float l) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h * 12.0, 12.0);
  float a = s * min(l, 1.0 - l);
  return l - a * max(min(min(k - 3.0, 9.0 - k), 1.0), -1.0);
}
vec3 blurTex(sampler2D t, vec2 uv, vec2 texel, float lod) {
  vec3 s = vec3(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    float w = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
    s += w * textureLod(t, uv + vec2(float(x), float(y)) * texel * 1.15, lod).rgb;
  }
  return s / 16.0;
}
// Where the picture may show: the top of the screen, away from the sidebar. Two fades
// multiplied, eased so neither ends on a visible line: down from the top, and in from the
// left edge where the sidebar sits. The CSS ground masks .art with the same two.
float reach(vec2 uv) {
  float down = 1.0 - smoothstep(0.0, 0.62, uv.y);
  float side = smoothstep(0.04, 0.42, uv.x);
  return down * down * side;
}
vec3 washAt(float hue, vec2 uv) {
  float h = hue / 360.0;
  vec3 c = vec3(0.0);
  float d1 = length((uv - vec2(0.22, 0.18)) / vec2(0.70, 0.60));
  c = mix(c, hsl2rgb(h, 0.85, 0.42), 0.55 * (1.0 - clamp(d1 / 0.7, 0.0, 1.0)));
  float d2 = length((uv - vec2(0.82, 0.78)) / vec2(0.60, 0.55));
  c = mix(c, hsl2rgb(fract(h + 50.0 / 360.0), 0.80, 0.36), 0.42 * (1.0 - clamp(d2 / 0.7, 0.0, 1.0)));
  return c;
}
vec3 wash(float hue, vec2 uv) {
  return washAt(hue, uv) * reach(uv) * 0.25;
}
vec3 picture(sampler2D t, int k, vec2 p) {
  vec2 img = uImg[k];
  vec2 uv = (p - uRes * 0.5) / (img * uSc[k]) + 0.5;
  vec3 c = blurTex(t, uv, exp2(uLod[k]) / img, uLod[k]);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(l), c, 1.5) * 0.5, 0.0, 1.0) * reach(p / uRes);   // the CSS ground's grading
}
vec3 layer0(vec2 p, vec2 uv) {
  if (uKind[0] > 1.5) return wash(uHue[0], uv);
  if (uKind[0] > 0.5) return picture(uTex0, 0, p);
  return vec3(0.0);
}
vec3 layer1(vec2 p, vec2 uv) {
  if (uKind[1] > 1.5) return wash(uHue[1], uv);
  if (uKind[1] > 0.5) return picture(uTex1, 1, p);
  return vec3(0.0);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) * (uRes / uSize);
  vec2 uv = p / uRes;
  vec3 c;
  if (uMix < 0.001) c = layer0(p, uv);
  else if (uMix > 0.999) c = layer1(p, uv);
  else c = mix(layer0(p, uv), layer1(p, uv), uMix);
  // The veil: a little darkness at the edges and, eased in, toward the bottom.
  float v1 = smoothstep(0.4, 1.0, length((uv - vec2(0.5, 0.0)) / vec2(1.2, 0.9))) * 0.5;
  float v2 = pow(smoothstep(0.5, 1.0, uv.y), 1.3) * 0.55;
  outColor = vec4(c * (1.0 - v1) * (1.0 - v2), 1.0);
}`;

// ── the particles, as soft discs, added into their own quarter size texture ──
const SPECK_VS = `#version 300 es
uniform vec2 uSize;
uniform vec4 uSpeck[${MAX_SPECKS}];   // x, y, radius (texture px, origin top left), brightness
out vec2 vLocal;
out float vA;
void main() {
  vec4 s = uSpeck[gl_InstanceID];
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner;
  vA = s.w;
  vec2 px = s.xy + corner * s.z;
  gl_Position = vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const SPECK_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vA;
out vec4 outColor;
void main() {
  float f = clamp(1.0 - length(vLocal), 0.0, 1.0);
  f *= f;
  outColor = vec4(vec3(f * vA), 1.0);
}`;

// ── ground + particles, halved again, ready to blur ──
const DOWN_FS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform sampler2D uGround;
uniform sampler2D uSpecks;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 t = 0.25 / uSize;
  vec3 g = texture(uGround, uv + vec2(-t.x, -t.y)).rgb + texture(uGround, uv + vec2(t.x, -t.y)).rgb
         + texture(uGround, uv + vec2(-t.x, t.y)).rgb + texture(uGround, uv + vec2(t.x, t.y)).rgb;
  vec3 s = texture(uSpecks, uv + vec2(-t.x, -t.y)).rgb + texture(uSpecks, uv + vec2(t.x, -t.y)).rgb
         + texture(uSpecks, uv + vec2(-t.x, t.y)).rgb + texture(uSpecks, uv + vec2(t.x, t.y)).rgb;
  outColor = vec4(min((g + s) * 0.25, vec3(1.0)), 1.0);
}`;

// ── a separable gaussian, one direction per pass ──
const BLUR_FS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform vec2 uStep;            // one tap, in uv
uniform sampler2D uSrc;
out vec4 outColor;
const float W[5] = float[5](0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = texture(uSrc, uv).rgb * W[0];
  for (int i = 1; i < 5; i++) {
    c += texture(uSrc, uv + uStep * float(i)).rgb * W[i];
    c += texture(uSrc, uv - uStep * float(i)).rgb * W[i];
  }
  outColor = vec4(c, 1.0);
}`;

// ── the screen: the ground everywhere ──
const FINAL_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform sampler2D uGround;
out vec4 outColor;
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
void main() {
  vec3 c = texture(uGround, gl_FragCoord.xy / uRes).rgb;
  // Static triangular noise of one level: stops a smooth dark gradient banding, and being
  // a function of the pixel alone it never moves.
  c += (hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.31) - 1.0) / 255.0;
  outColor = vec4(c, 1.0);
}`;

// ── the panes: the blurred picture, split at the rim, drawn only over each pane ──
const PANE_VS = `#version 300 es
uniform vec2 uRes;
uniform vec4 uRect[${MAX_PANES}];
flat out int vI;
void main() {
  vec4 R = uRect[gl_InstanceID];
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 p = R.xy - 2.0 + corner * (R.zw + 4.0);
  vI = gl_InstanceID;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;
const PANE_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform float uSplit;          // css px of red to blue separation at the very edge
uniform float uNative;         // 1: the browser blurs (backdrop-filter); hand it the sharp picture
uniform sampler2D uBlur;
uniform sampler2D uGround;
uniform sampler2D uSpecks;
uniform vec4 uRect[${MAX_PANES}];
uniform vec4 uInfo[${MAX_PANES}];   // radius, opacity
flat in int vI;
out vec4 outColor;
void main() {
  vec4 R = uRect[vI];
  vec2 h = R.zw * 0.5;
  vec2 c = R.xy + h;
  float r = min(uInfo[vI].x, min(h.x, h.y));
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 rel = p - c;
  vec2 q = abs(rel) - (h - vec2(r));
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float cover = 1.0 - smoothstep(-0.5, 0.5, d);
  if (cover <= 0.0) discard;

  // Outward, from the shape itself: along the corner's radius on a corner, straight out on
  // a side. Screen space has y down; the texture has y up.
  vec2 g = (q.x > 0.0 && q.y > 0.0) ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 n = g * sign(rel + 1e-4);
  float rim = 1.0 - smoothstep(0.0, 18.0 * uDpr, -d);
  rim *= rim;
  vec2 off = vec2(n.x, -n.y) * (uSplit * uDpr * rim) / uRes;
  vec2 uv = gl_FragCoord.xy / uRes;

  if (uNative > 0.5) {
    // The particles only exist under glass, exactly as the 2D dust did: drawn here, sharp,
    // they are what the pane's backdrop-filter finds and blurs. Split at the rim here too,
    // and twice as far, because the browser's blur then softens the fringe the way a lens
    // does; on the plain picture it would be gone under the blur.
    vec2 o = off * 2.0;
    vec3 sr = texture(uGround, uv + o).rgb + texture(uSpecks, uv + o).rgb;
    vec3 sg = texture(uGround, uv).rgb + texture(uSpecks, uv).rgb;
    vec3 sb = texture(uGround, uv - o).rgb + texture(uSpecks, uv - o).rgb;
    outColor = vec4(min(vec3(sr.r, sg.g, sb.b), vec3(1.0)), cover * uInfo[vI].y);
    return;
  }

  vec3 col = vec3(texture(uBlur, uv + off).r, texture(uBlur, uv).g, texture(uBlur, uv - off).b);
  outColor = vec4(col, cover * uInfo[vI].y);
}`;

interface Layer { tex: WebGLTexture; kind: 0 | 1 | 2; hue: number; w: number; h: number; key: string }
interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

const FADE_MS = 700;

export class GlassGL {
  readonly gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private progs: Record<string, { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }> = {};
  private blank: WebGLTexture;
  private layers: [Layer, Layer];
  private mix = 1;
  private fadeAt = 0;
  private fading = false;
  private want = "";
  private width = 1;
  private height = 1;
  private dpr = 1;
  private split = 6;             // css px at a dial of 100
  private native = false;
  private ground!: Target;
  private specks!: Target;
  private blurA!: Target;
  private blurB!: Target;
  /** Which stages need drawing again. */
  private dirtyGround = true;
  private dirtyBlur = true;
  private dirtyFrame = true;
  private speckCount = 0;
  private speckData = new Float32Array(MAX_SPECKS * 4);

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("no webgl2");
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.program("ground", FULL_VS, GROUND_FS, ["uSize", "uRes", "uMix", "uTex0", "uTex1", "uImg", "uSc", "uLod", "uKind", "uHue"]);
    this.program("speck", SPECK_VS, SPECK_FS, ["uSize", "uSpeck"]);
    this.program("down", FULL_VS, DOWN_FS, ["uSize", "uGround", "uSpecks"]);
    this.program("blur", FULL_VS, BLUR_FS, ["uSize", "uStep", "uSrc"]);
    this.program("final", FULL_VS, FINAL_FS, ["uRes", "uGround"]);
    this.program("pane", PANE_VS, PANE_FS, ["uRes", "uDpr", "uSplit", "uNative", "uBlur", "uGround", "uSpecks", "uRect", "uInfo"]);
    this.blank = this.texture(null);
    this.layers = [this.empty(), this.empty()];
  }

  private program(name: string, vs: string, fs: string, uniforms: string[]) {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`glass ${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`glass ${name}: ${gl.getProgramInfoLog(p)}`);
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
    this.progs[name] = { p, u };
  }

  private use(name: string) {
    const prog = this.progs[name];
    this.gl.useProgram(prog.p);
    return prog.u;
  }

  private texture(source: TexImageSource | null): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (source) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return tex;
  }

  private target(w: number, h: number, old?: Target): Target {
    const gl = this.gl;
    if (old) { gl.deleteFramebuffer(old.fb); gl.deleteTexture(old.tex); }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  private empty(): Layer { return { tex: this.blank, kind: 0, hue: 0, w: 1, h: 1, key: "-" }; }

  resize(cssW: number, cssH: number, dpr: number) {
    this.dpr = dpr;
    this.width = Math.max(1, Math.round(cssW * dpr));
    this.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const qw = Math.max(1, Math.ceil(this.width / 4)), qh = Math.max(1, Math.ceil(this.height / 4));
    const ew = Math.max(1, Math.ceil(this.width / 8)), eh = Math.max(1, Math.ceil(this.height / 8));
    this.ground = this.target(qw, qh, this.ground);
    this.specks = this.target(qw, qh, this.specks);
    this.blurA = this.target(ew, eh, this.blurA);
    this.blurB = this.target(ew, eh, this.blurB);
    this.dirtyGround = this.dirtyBlur = this.dirtyFrame = true;
  }

  /** Red to blue separation at the rim, as the Chromatic aberration dial (0..200). */
  setEdge(dial: number) {
    const next = 6 * Math.max(0, Math.min(2, dial / 100));
    if (next !== this.split) { this.split = next; this.dirtyFrame = true; }
  }

  /** Native: the browser's backdrop-filter does the blur; the shader hands it the picture. */
  setNative(on: boolean) {
    if (on !== this.native) { this.native = on; this.dirtyFrame = true; }
  }

  /** The particles for this frame, in device px. An empty list is no particles. */
  setSpecks(list: Speck[]) {
    const n = Math.min(MAX_SPECKS, list.length);
    // Texture px of the quarter size target, with the energy kept when a speck is smaller
    // than one of them: a tiny bright dot and a one texel dim one blur to the same glow.
    for (let i = 0; i < n; i++) {
      const s = list[i];
      let r = s.r / 4, a = s.a;
      if (r < 1) { a *= r * r; r = 1; }
      this.speckData[i * 4] = s.x / 4;
      this.speckData[i * 4 + 1] = s.y / 4;
      this.speckData[i * 4 + 2] = r;
      this.speckData[i * 4 + 3] = a;
    }
    if (n || this.speckCount) this.dirtyBlur = true;
    this.speckCount = n;
  }

  /** Change what is behind everything; the old one fades out under the new. */
  setGround(spec: GroundSpec, now: number) {
    const key = spec.url ? "u:" + spec.url : spec.hue !== null ? "h:" + spec.hue : "-";
    if (key === this.layers[1].key || key === this.want) return;
    this.want = key;
    const take = (layer: Layer) => {
      if (key !== this.want) return;
      this.freeOld();
      this.layers[0] = this.layers[1];
      this.layers[1] = layer;
      this.mix = 0;
      this.fadeAt = now;
      this.fading = true;
      this.dirtyGround = true;
    };
    if (spec.url) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (key !== this.want) return;
        // Blurred to nothing anyway: nothing past this size is worth the memory.
        const k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        take({ tex: this.texture(c), kind: 1, hue: 0, w, h, key });
      };
      img.onerror = () => take({ ...this.empty(), key });
      img.src = spec.url;
    } else if (spec.hue !== null) {
      take({ tex: this.blank, kind: 2, hue: spec.hue, w: 1, h: 1, key });
    } else {
      take(this.empty());
    }
  }

  private freeOld() {
    const old = this.layers[0];
    if (old.tex !== this.blank) this.gl.deleteTexture(old.tex);
    this.layers[0] = this.empty();
  }

  /** Is a cross fade still running, so the caller keeps asking for frames. */
  get busy() { return this.fading; }

  /** Ask for the frame to be drawn again on the next render(). */
  touch() { this.dirtyFrame = true; }

  /** Draw what has changed. Panes always in device px. */
  render(panes: PaneInfo[], now: number, panesMoved: boolean) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    if (this.fading) {
      const f = Math.min(1, (now - this.fadeAt) / FADE_MS);
      this.mix = 1 - Math.pow(1 - f, 3);
      this.dirtyGround = true;
      if (f >= 1) { this.fading = false; this.mix = 1; this.freeOld(); }
    }

    if (this.dirtyGround) {
      const u = this.use("ground");
      this.bind(this.ground);
      gl.uniform2f(u.uSize, this.ground.w, this.ground.h);
      gl.uniform2f(u.uRes, this.width, this.height);
      gl.uniform1f(u.uMix, this.mix);
      const img = new Float32Array(4), sc = new Float32Array(2), lod = new Float32Array(2);
      const kind = new Float32Array(2), hue = new Float32Array(2);
      this.layers.forEach((L, k) => {
        img[k * 2] = L.w; img[k * 2 + 1] = L.h; kind[k] = L.kind; hue[k] = L.hue;
        if (L.kind === 1) {
          const cover = Math.max(this.width / L.w, this.height / L.h) * 1.25;
          sc[k] = cover;
          lod[k] = Math.max(0, Math.min(Math.log2(Math.max(L.w, L.h)), Math.log2(Math.max(1, 70 * this.dpr / cover))));
        } else { sc[k] = 1; lod[k] = 0; }
      });
      gl.uniform2fv(u.uImg, img); gl.uniform1fv(u.uSc, sc); gl.uniform1fv(u.uLod, lod);
      gl.uniform1fv(u.uKind, kind); gl.uniform1fv(u.uHue, hue);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.layers[0].tex); gl.uniform1i(u.uTex0, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.layers[1].tex); gl.uniform1i(u.uTex1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.dirtyGround = false;
      this.dirtyBlur = true;
    }

    if (this.dirtyBlur) {
      // the particles
      this.bind(this.specks);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (this.speckCount) {
        const u = this.use("speck");
        gl.uniform2f(u.uSize, this.specks.w, this.specks.h);
        gl.uniform4fv(u.uSpeck, this.speckData);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.speckCount);
        gl.disable(gl.BLEND);
      }
      // down to an eighth, ground and particles together
      let u = this.use("down");
      this.bind(this.blurA);
      gl.uniform2f(u.uSize, this.blurA.w, this.blurA.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.ground.tex); gl.uniform1i(u.uGround, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.specks.tex); gl.uniform1i(u.uSpecks, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // two gaussian passes. About 16 css px of blur, whatever the screen's density.
      const sigma = (16 * this.dpr) / 8;                 // in eighth size texels
      const step = Math.max(1, sigma / 2);
      u = this.use("blur");
      gl.uniform2f(u.uSize, this.blurA.w, this.blurA.h);
      gl.uniform1i(u.uSrc, 0);
      gl.activeTexture(gl.TEXTURE0);
      this.bind(this.blurB);
      gl.bindTexture(gl.TEXTURE_2D, this.blurA.tex);
      gl.uniform2f(u.uStep, step / this.blurA.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.bind(this.blurA);
      gl.bindTexture(gl.TEXTURE_2D, this.blurB.tex);
      gl.uniform2f(u.uStep, 0, step / this.blurA.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.dirtyBlur = false;
      this.dirtyFrame = true;
    }

    if (!this.dirtyFrame && !panesMoved) return;
    this.dirtyFrame = false;

    // the screen: the ground everywhere
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    let u = this.use("final");
    gl.uniform2f(u.uRes, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.ground.tex); gl.uniform1i(u.uGround, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // the panes: only their own pixels
    const n = Math.min(MAX_PANES, panes.length);
    if (!n) return;
    const rects = new Float32Array(MAX_PANES * 4), info = new Float32Array(MAX_PANES * 4);
    for (let i = 0; i < n; i++) {
      const p = panes[i];
      rects.set([p.x, p.y, p.w, p.h], i * 4);
      info.set([p.r, p.a, 0, 0], i * 4);
    }
    u = this.use("pane");
    gl.uniform2f(u.uRes, this.width, this.height);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform1f(u.uSplit, this.split);
    gl.uniform1f(u.uNative, this.native ? 1 : 0);
    gl.uniform4fv(u.uRect, rects);
    gl.uniform4fv(u.uInfo, info);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.blurA.tex); gl.uniform1i(u.uBlur, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ground.tex); gl.uniform1i(u.uGround, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.specks.tex); gl.uniform1i(u.uSpecks, 2);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.BLEND);
  }

  private bind(t: Target) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, t.fb);
    this.gl.viewport(0, 0, t.w, t.h);
  }

  destroy() {
    const gl = this.gl;
    for (const L of this.layers) if (L.tex !== this.blank) gl.deleteTexture(L.tex);
    gl.deleteTexture(this.blank);
    for (const t of [this.ground, this.specks, this.blurA, this.blurB]) {
      if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    }
    for (const prog of Object.values(this.progs)) gl.deleteProgram(prog.p);
    gl.deleteVertexArray(this.vao);
  }
}
