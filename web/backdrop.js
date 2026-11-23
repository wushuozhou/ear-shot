// Sculpted point surfaces, atmospheric light and rippled water. No renderer dependency.
const PRESETS = {
  'spring-garden': { name: '春日森林', colors: ['#6d9475', '#8c9cbd', '#cfb5ca'] },
  'point-cloud': { name: '点云倒影', colors: ['#83a187', '#8da8b9', '#c0adce'] },
  'particle-rain': { name: '粒子雨', colors: ['#b6c9c0', '#91a6b2', '#d4cbdc'] },
  'aurora-fog': { name: '体积光雾', colors: ['#8edfc5', '#95bfee', '#d7b3ee'] },
};
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function randomSeed(seed = 1026) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function rgb(hex) { return /^#[\da-f]{6}$/i.test(hex) ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) : [.65, .75, .7]; }
function hueColor(h, s, l) { const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; }

// Offline sampled from the archive's original forest point scan, keeping its colors.
// The packed asset is 640 KiB rather than shipping a Draco decoder to every call.
export function decodeForestGeometry(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 32 || view.getUint32(0, false) !== 0x54474631) throw new Error('Invalid forest geometry');
  const count = view.getUint32(4, true);
  if (count < 1 || count > 262144 || view.byteLength !== 32 + count * 10) throw new Error('Invalid forest point count');
  const minimum = [0, 1, 2].map(i => view.getFloat32(8 + i * 4, true)), maximum = [0, 1, 2].map(i => view.getFloat32(20 + i * 4, true));
  if (![...minimum, ...maximum].every(Number.isFinite)) throw new Error('Invalid forest bounds');
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const offset = 32 + i * 10;
    const p = [0, 1, 2].map(k => minimum[k] + view.getUint16(offset + k * 2, true) / 65535 * (maximum[k] - minimum[k]));
    positions.set([p[0] / 15, p[1] / 12 - .38, (22 - p[2]) / 26], i * 3);
    for (let k = 0; k < 3; k++) colors[i * 3 + k] = view.getUint8(offset + 6 + k) / 255;
  }
  return { positions, colors, count };
}

// Stable indices keep shapes coherent while changing density or color.
export function createGardenGeometry(count, scene = 'spring-garden', shape = '', palette = PRESETS['spring-garden'].colors, pattern = null) {
  count = clamp(Math.round(Number(count) || 12000), 256, 48000);
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), data = new Float32Array(count * 3);
  const rand = randomSeed(), shades = palette.map(c => Array.isArray(c) ? c : rgb(c));
  const trees = [{ x: -1.15, z: .45, h: .68, r: .58, lean: .09 }, { x: 1.28, z: .8, h: .9, r: .48, lean: -.1 }, { x: -.42, z: 1.65, h: .4, r: .45, lean: -.06 }];
  for (let i = 0; i < count; i++) {
    const u = rand(), v = rand(), angle = rand() * TAU, o = i * 3, group = i / count;
    let x, y, z, light = .55, size = .8 + rand() * .7, kind = 0, patternColor;
    if (pattern?.length && ['point-cloud','spring-garden'].includes(scene)) {
      const p = pattern[Math.floor(rand() * pattern.length)];
      x = p.x * 1.3 + (rand() - .5) * .012; y = .95 - p.y * 1.25; z = (rand() - .5) * .2; light = .5 + p.lum * .5; patternColor = p.color;
    } else if (scene === 'particle-rain') {
      x = (u - .5) * 5; y = v * 2.8 - .8; z = rand() * 3; kind = 2; light = .45 + rand() * .5;
    } else if (shape === 'aurora' || scene === 'aurora-fog') {
      const curtain = i % 5, t = v * 1.65;
      x = -1.65 + curtain * .73 + Math.sin(t * 3.8 + curtain) * .2 + (u - .5) * .11;
      y = t - .35; z = .3 + Math.sin(t * 2 + curtain) * .3 + rand() * .4; light = .3 + Math.sin(v * Math.PI) ** 2 * .55; size *= 1.4; kind = 1;
    } else if (group < .65) {
      const tree = trees[i % trees.length];
      if (u > .16) {
        const phi = Math.acos(2 * v - 1), fold = 1 + .11 * Math.sin(angle * 5 + phi * 4) + .06 * Math.cos(angle * 9 - phi * 3), r = tree.r * fold * (.86 + rand() * .14), sy = Math.sin(phi);
        x = tree.x + Math.cos(angle) * sy * r; y = tree.h + Math.cos(phi) * r * .58; z = tree.z + Math.sin(angle) * sy * r * .72;
        light = .3 + Math.max(0, sy * Math.cos(angle + .65)) * .55 + Math.max(0, Math.cos(phi)) * .24;
      } else {
        const radius = (.026 + .065 * (1 - v) ** 3) * (.9 + rand() * .15);
        const fork = Math.max(0, v - .42) ** 1.5 * .46, branch = i % 5 * 2.4;
        x = tree.x + Math.cos(angle) * radius + Math.sin(v * 3) * tree.lean + Math.cos(branch) * fork; y = -.38 + v * (tree.h + .32); z = tree.z + Math.sin(angle) * radius + Math.sin(branch) * fork; light = .35 + (Math.cos(angle + .6) + 1) * .22;
      }
    } else if (group < .84) {
      const stone = i % 4, cx = [-1.55, .88, 1.8, -.8][stone], cz = [.05, .05, .9, 1.35][stone], radius = [.32, .42, .34, .25][stone], phi = Math.acos(2 * v - 1);
      x = cx + Math.cos(angle) * Math.sin(phi) * radius; y = -.28 + Math.cos(phi) * radius * (stone === 1 ? .8 : .4); z = cz + Math.sin(angle) * Math.sin(phi) * radius;
      light = .25 + Math.max(0, Math.cos(phi)) * .55 + Math.max(0, Math.cos(angle + .7)) * .2;
    } else if (group < .95) {
      const reed = i % 34, side = reed % 2 ? -1 : 1, h = .25 + (reed % 6) * .085;
      x = side * (1.45 + (reed % 7) * .047) + side * Math.sin(v * 1.6) * (.08 + (reed % 3) * .05) + (u - .5) * .008;
      y = -.4 + v * h; z = -.1 + (reed % 4) * .12; light = .42 + v * .45; size *= .8;
    } else {
      x = (u - .5) * 5.4; y = rand() * 2.8 - .3; z = 1 + rand() * 3; kind = 2; light = .22 + rand() * .35; size *= .7;
    }
    if (shape === 'tree' && group < .84) { x *= .7; y = (y + .38) * 1.07 - .38; }
    positions.set([x, y, z], o); const color = patternColor || shades[i % shades.length], lum = light * (.82 + rand() * .18);
    colors.set(color.map(c => c * lum), o); data.set([size, rand() * TAU, kind], o);
  }
  return { positions, colors, data, count };
}

const QUAD_VERTEX = `attribute vec2 aPosition;varying mediump vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
const ATMOSPHERE_FRAGMENT = `precision mediump float;
varying mediump vec2 vUv;uniform vec2 uResolution;uniform float uTime;uniform float uFog;uniform float uForest;uniform vec3 uColor0;uniform vec3 uColor1;uniform vec3 uColor2;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
void main(){vec2 uv=vUv;vec2 p=vec2((uv.x-.5)*uResolution.x/uResolution.y,uv.y);float n=noise(p*3.+vec2(uTime*.006,0.))+noise(p*6.5-vec2(0.,uTime*.004))*.4;
vec3 color=vec3(.027,.031,.034);float haze=exp(-pow((uv.y-.35)*5.3,2.));
color+=uColor0*exp(-length((p-vec2(-.65,.43))*vec2(.9,1.8))*3.)*.075*(.7+n);
color+=uColor1*exp(-length((p-vec2(.7,.44))*vec2(1.,2.))*3.)*.11*(.6+n);
color+=uColor2*exp(-length((p-vec2(.05,.38))*vec2(.8,2.5))*3.)*.067;
color+=mix(uColor0,uColor1,uv.x)*haze*(.008+.06*uFog)*n;
float curtain=pow(max(0.,sin((uv.x+sin(uv.y*3.5+uTime*.07)*.17)*15.+n*1.7)),3.)*smoothstep(.1,.6,uv.y);
color+=mix(uColor0,uColor2,smoothstep(.1,.9,uv.x))*curtain*(.16+.34*n)*uFog;
if(uFog>.5){
 float ay=uv.y<.3?.6-uv.y:uv.y;float reflection=uv.y<.3?.28:1.;vec3 aurora=vec3(0.);
 for(int i=0;i<6;i++){
  float fi=float(i),cx=.1+fi*.15+sin(ay*2.8+fi*.85+uTime*.045)*(.08+.025*sin(fi));
  float dx=(uv.x-cx)*(1.05+.2*uResolution.x/uResolution.y);
  float fold=exp(-pow(dx/(.025+fi*.004),2.));
  float veil=smoothstep(.3,.5,ay)*(1.-smoothstep(.84,1.18,ay));
  float threads=.72+.28*noise(vec2(uv.x*140.+fi*17.,ay*3.-uTime*.025));
  vec3 tint=mix(uColor0,mix(uColor1,uColor2,.65),fi/5.);
  aurora+=tint*fold*veil*threads*(.62+.2*sin(ay*3.+fi));
 }
 float ripple=uv.y<.3?(.62+.38*sin(uv.y*uResolution.y*.48+n*4.)):1.;
 color=vec3(.018,.035,.046)+aurora*reflection*ripple+mix(uColor0,uColor2,uv.x)*haze*.12;
}
vec3 sky=mix(vec3(.12,.145,.19),vec3(.36,.25,.32),smoothstep(.15,.95,uv.x));
sky+=vec3(.13,.09,.115)*exp(-length((uv-vec2(.7,.9))*vec2(1.2,.7))*3.);
color=mix(color,sky*(.7+n*.3),uForest*smoothstep(.22,.85,uv.y)*.82);
float water=1.-smoothstep(.24,.38,uv.y);float lines=sin(uv.y*uResolution.y*.45+noise(vec2(uv.y*80.,uTime*.025))*4.);
color+=mix(uColor1,uColor2,uv.x)*water*(.012+.006*lines)*exp(-abs(uv.y-.3)*5.);
color*=.7+.3*(1.-smoothstep(.2,.9,length((uv-.5)*vec2(.8,1.))));
color+=(hash(gl_FragCoord.xy)-.5)*.012;gl_FragColor=vec4(color,1.);}`;
const POINT_VERTEX = `precision highp float;
attribute vec3 aPosition;attribute vec3 aColor;attribute vec3 aData;
uniform float uTime;uniform float uMotion;uniform float uAspect;uniform float uDpr;uniform float uReflect;uniform float uRain;uniform lowp float uForest;uniform vec4 uPointer;uniform float uIntensity;
varying mediump vec3 vColor;varying mediump float vAlpha;varying mediump float vReflect;
void main(){vec3 p=aPosition;float time=uTime*uMotion;
p.x+=sin(time*.17+p.y*2.+aData.y)*.009*uMotion;p.z+=cos(time*.11+p.x*2.+aData.y)*.008*uMotion;
if(uRain>.5)p.y=mod(p.y+time*(.025+aData.x*.02)+1.,3.)-1.;
float angle=sin(time*.023)*.018;float sx=p.x*cos(angle)+p.z*sin(angle);p.z=p.z*cos(angle)-p.x*sin(angle);p.x=sx;
p.x*=mix(.36,1.,smoothstep(.4,1.6,uAspect));
if(uReflect>.5){p.y=-.38-(p.y+.38)*.55;p.x+=sin(p.y*85.+time*.7)*.009+sin(p.y*143.-time*.3)*.005;}
float depth=2.9/(2.9+p.z);vec2 q=vec2(p.x/uAspect,(p.y+.05)*.9)*depth;
vec2 delta=(q-uPointer.xy)*vec2(uAspect,1.);float influence=exp(-dot(delta,delta)*16.);
q+=uPointer.zw*influence*.022*uMotion;q+=normalize(delta+vec2(.001))*length(uPointer.zw)*influence*.006*uMotion;
gl_Position=vec4(q,clamp(p.z*.07,-.9,.9),1.);gl_PointSize=clamp(aData.x*depth*uDpr*1.48,1.,4.8*uDpr);
vColor=aColor;vAlpha=mix(.55+depth*.22,.9,uForest)*uIntensity;vReflect=uReflect;
if(uReflect>.5)vAlpha*=.32*exp(-abs(p.y+.38)*1.3);if(aData.z>1.5&&aData.z<2.5)vAlpha*=.55;}`;
const POINT_FRAGMENT = `precision mediump float;varying mediump vec3 vColor;varying mediump float vAlpha;varying mediump float vReflect;uniform lowp float uForest;
void main(){float a=(1.-smoothstep(.15,.5,length(gl_PointCoord-.5)))*vAlpha;if(vReflect>.5)a*=.38+.62*smoothstep(-.5,.8,sin(gl_FragCoord.y*.65));if(a<.015)discard;vec3 color=mix(vColor*1.5,pow(max(vColor,vec3(0.)),vec3(.65))*vec3(.76,1.05,.94),uForest);gl_FragColor=vec4(color,a);}`;
function program(gl, vertexSource, fragmentSource) {
  const shaders = [], p = gl.createProgram();
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); gl.attachShader(p, shader);
    }
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
  } catch (error) { gl.deleteProgram(p); throw error; } finally { shaders.forEach(shader => gl.deleteShader(shader)); }
}

export class CallBackdrop {
  constructor(canvas, options = {}) {
    this.canvas = canvas; this.scene = 'spring-garden'; this.hue = null; this.density = 1; this.shape = ''; this.pattern = ''; this.patternPoints = null; this.fogPalette = null;
    this.fluidEnabled = true; this.intensity = 1; this.clock = 0; this.running = false; this.mounted = false; this.destroyed = false; this.patternRequest = 0; this.raf = 0; this.last = null; this.forest = null;
    this.media = matchMedia('(prefers-reduced-motion: reduce)'); this.reduced = this.media.matches;
    this.tier = /Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 4) <= 4 ? 1 : 2;
    this.pointer = { x: -4, y: -4, vx: 0, vy: 0, lastX: null, lastY: null };
    this.onResize = () => this.resize(); this.onPointer = event => this.handlePointer(event); this.onVisibility = () => document.hidden ? this.pause() : this.resume();
    this.onMotion = event => { this.reduced = event.matches; this.pause(); this.pointer.vx = this.pointer.vy = 0; this.resume(); };
    this.onContextLost = event => { event.preventDefault(); this.contextLost = true; this.pause(); };
    this.onContextRestored = () => { if (this.destroyed) return; this.contextLost = false; try { this.initGPU(); this.upload(); } catch (error) { this.useFallback(error); } this.resize(); this.resume(); };
    Object.assign(this, options);
    this.gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    if (this.gl) { try { this.initGPU(); } catch (error) { this.useFallback(error); } }
    else this.ctx = canvas.getContext('2d', { alpha: false });
    this.W = this.H = 1; this.DPR = 1;
  }
  get budget() { return { cloud: Math.min(262144, Math.round((this.tier === 1 ? 28000 : this.scene === 'spring-garden' ? 144000 : 32000) * this.density)), rain: Math.round(1700 * this.density) }; }
  palette() { return this.hue === null ? PRESETS[this.scene].colors : [0, 29, -24].map(offset => hueColor((this.hue + offset + 360) % 360, .25, .66)); }
  fogColors() { return this.fogPalette || this.palette(); }
  mount() {
    if (this.mounted || this.destroyed) return; this.mounted = true;
    addEventListener('resize', this.onResize); addEventListener('pointermove', this.onPointer, { passive: true }); document.addEventListener('visibilitychange', this.onVisibility); this.media.addEventListener?.('change', this.onMotion);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost); this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    if (typeof ResizeObserver !== 'undefined') { this.observer = new ResizeObserver(this.onResize); this.observer.observe(this.canvas); } this.resize(); this.resume(); if (this.scene === 'spring-garden') this.loadForest();
  }
  destroy() {
    if (this.destroyed) return; this.destroyed = true; this.mounted = false; this.patternRequest++; this.assetAbort?.abort(); this.pause(); this.observer?.disconnect();
    removeEventListener('resize', this.onResize); removeEventListener('pointermove', this.onPointer); document.removeEventListener('visibilitychange', this.onVisibility); this.media.removeEventListener?.('change', this.onMotion);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost); this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored); this.disposeGPU(); this.patternPoints = null; this.geometry = null;
  }
  setScene(scene) { if (!PRESETS[scene] || this.destroyed) return; this.scene = scene; this.build(); if (scene === 'spring-garden' && this.mounted) this.loadForest(); }
  setHue(hue) { this.hue = hue === '' || hue == null || !Number.isFinite(Number(hue)) ? null : (Number(hue) % 360 + 360) % 360; this.build(); }
  setDensity(value) { this.density = clamp(Number(value) || 1, .2, 2.2); this.build(); }
  setShape(shape) { this.shape = ['tree', 'aurora'].includes(shape) ? shape : ''; this.build(); }
  setFogColors(colors) { const valid = (Array.isArray(colors) ? colors : String(colors || '').split(',')).map(c => String(c).trim()).filter(c => /^#[\da-f]{6}$/i.test(c)); this.fogPalette = valid.length ? valid : null; if (this.scene === 'aurora-fog') this.build(); else this.redraw(); }
  setFluid(on) { this.fluidEnabled = !!on; if (!on) { this.pointer.vx = this.pointer.vy = 0; this.pointer.lastX = this.pointer.lastY = null; } this.redraw(); }
  async setPattern(url) {
    const request = ++this.patternRequest; this.pattern = url || ''; this.patternPoints = null;
    if (!url) { this.build(); return; }
    try {
      const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
      if (this.destroyed || request !== this.patternRequest) return;
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d', { willReadFrequently: true });
      const scale = Math.min(128 / image.width, 128 / image.height), w = image.width * scale, h = image.height * scale;
      g.drawImage(image, (128 - w) / 2, (128 - h) / 2, w, h); const pixels = g.getImageData(0, 0, 128, 128).data, points = [];
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const o = (y * 128 + x) * 4, lum = (pixels[o] * .299 + pixels[o + 1] * .587 + pixels[o + 2] * .114) / 255; if (pixels[o + 3] > 30 && lum > .1) points.push({ x: x / 64 - 1, y: y / 128, lum, color: [pixels[o] / 255, pixels[o + 1] / 255, pixels[o + 2] / 255] }); }
      this.patternPoints = points.length ? points : null;
    } catch (_) { if (this.destroyed || request !== this.patternRequest) return; } this.build();
  }
  resize() {
    if (this.destroyed) return; this.W = Math.max(1, this.canvas.clientWidth || innerWidth); this.H = Math.max(1, this.canvas.clientHeight || innerHeight); this.DPR = Math.min(window.devicePixelRatio || 1, this.tier === 1 ? 1.25 : 1.6);
    this.canvas.width = Math.round(this.W * this.DPR); this.canvas.height = Math.round(this.H * this.DPR); this.ctx?.setTransform(this.DPR, 0, 0, this.DPR, 0, 0); this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (!this.geometry) this.build(); else this.redraw();
  }
  async loadForest() {
    if (this.forest || this.loadingForest || this.destroyed) return; this.loadingForest = true;
    try {
      const url = new URL('./assets/spring-forest.bin', import.meta.url); this.assetAbort = new AbortController();
      const response = await fetch(url, { signal: this.assetAbort.signal }); if (!response.ok) throw new Error('Forest unavailable');
      const buffer = await response.arrayBuffer(); if (this.destroyed) return;
      this.forest = decodeForestGeometry(buffer); if (this.scene === 'spring-garden') this.build();
    } catch (_) { /* The sculpted garden remains usable when the local asset cannot load. */ }
    finally { this.loadingForest = false; }
  }
  build() {
    if (this.destroyed) return;
    if (this.forest && this.scene === 'spring-garden' && !this.shape && !this.patternPoints) {
      const count = Math.min(this.budget.cloud, this.forest.count), positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), data = new Float32Array(count * 3), rand = randomSeed(), tint = this.hue === null ? null : this.palette()[0];
      for (let i = 0; i < count; i++) { const source = Math.floor(i / count * this.forest.count) * 3; for (let k = 0; k < 3; k++) { positions[i * 3 + k] = this.forest.positions[source + k]; const color = this.forest.colors[source + k]; colors[i * 3 + k] = tint ? color * .5 + tint[k] * color * .7 : color; } data.set([1.15 + rand() * .8, rand() * TAU, 3], i * 3); }
      this.geometry = { positions, colors, data, count, forest: true };
    } else this.geometry = createGardenGeometry(this.scene === 'particle-rain' ? this.budget.rain : this.budget.cloud, this.scene, this.shape, this.scene === 'aurora-fog' ? this.fogColors() : this.palette(), this.patternPoints);
    this.upload(); this.redraw();
  }
  handlePointer(event) {
    if (!this.fluidEnabled || this.reduced || !this.mounted) return;
    const rect = this.canvas.getBoundingClientRect(), x = (event.clientX - rect.left) / this.W * 2 - 1, y = 1 - (event.clientY - rect.top) / this.H * 2, p = this.pointer;
    if (event.clientX < rect.left || event.clientY < rect.top || event.clientX > rect.left + this.W || event.clientY > rect.top + this.H) { p.lastX = p.lastY = null; return; }
    p.vx = p.lastX === null ? 0 : clamp(p.vx + (x - p.lastX) * 7, -.8, .8); p.vy = p.lastY === null ? 0 : clamp(p.vy + (y - p.lastY) * 7, -.8, .8); p.x = x; p.y = y; p.lastX = x; p.lastY = y;
  }
  resume() { if (!this.mounted || this.destroyed || document.hidden || this.contextLost || this.running) return; this.renderFrame(); if (this.reduced) return; this.running = true; this.last = null; this.raf = requestAnimationFrame(time => this.tick(time)); }
  pause() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.last = null; }
  tick(time) { if (!this.running || this.destroyed) return; const dt = this.last === null ? 0 : Math.min((time - this.last) / 1000, .05); this.last = time; this.clock += dt; const decay = Math.exp(-dt * 4.6); this.pointer.vx *= decay; this.pointer.vy *= decay; this.renderFrame(); this.raf = requestAnimationFrame(next => this.tick(next)); }
  redraw() { if (this.mounted && !this.contextLost) this.renderFrame(); }
  initGPU() {
    const gl = this.gl; this.backgroundProgram = program(gl, QUAD_VERTEX, ATMOSPHERE_FRAGMENT); this.pointProgram = program(gl, POINT_VERTEX, POINT_FRAGMENT);
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW); this.buffers = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()]; this.uniforms = new Map(); gl.disable(gl.DEPTH_TEST);
  }
  useFallback(error) {
    this.gpuError = String(error?.message || error); this.disposeGPU(); this.failedGPU = true; this.gl = null;
    const old = this.canvas, replacement = old.cloneNode(false); old.removeEventListener('webglcontextlost', this.onContextLost); old.removeEventListener('webglcontextrestored', this.onContextRestored);
    old.replaceWith(replacement); this.canvas = replacement; this.ctx = replacement.getContext('2d', { alpha: false }); this.observer?.disconnect(); if (this.mounted) this.observer?.observe(replacement);
  }
  disposeGPU() { const gl = this.gl; if (!gl) return; [this.quad, ...(this.buffers || [])].filter(Boolean).forEach(buffer => gl.deleteBuffer(buffer)); [this.backgroundProgram, this.pointProgram].filter(Boolean).forEach(p => gl.deleteProgram(p)); this.buffers = []; this.uniforms?.clear(); }
  upload() { if (!this.gl || this.failedGPU || this.contextLost || !this.geometry) return; const gl = this.gl; [this.geometry.positions, this.geometry.colors, this.geometry.data].forEach((data, i) => { gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[i]); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); }); }
  uniform(p, name, method, ...values) { const key = `${p === this.pointProgram ? 'p' : 'b'}:${name}`; if (!this.uniforms.has(key)) this.uniforms.set(key, this.gl.getUniformLocation(p, name)); this.gl[method](this.uniforms.get(key), ...values); }
  renderFrame() { if (!this.geometry || this.contextLost || this.destroyed) return; if (this.gl && !this.failedGPU) this.renderGPU(); else if (this.ctx) this.render2D(); }
  renderGPU() {
    const gl = this.gl, bg = this.backgroundProgram, points = this.pointProgram; gl.disable(gl.BLEND); gl.useProgram(bg); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const at = gl.getAttribLocation(bg, 'aPosition'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    const forest = this.geometry.forest ? 1 : 0;
    this.uniform(bg, 'uResolution', 'uniform2f', this.canvas.width, this.canvas.height); this.uniform(bg, 'uTime', 'uniform1f', this.reduced ? 0 : this.clock); this.uniform(bg, 'uFog', 'uniform1f', this.scene === 'aurora-fog' || this.shape === 'aurora' ? 1 : 0); this.uniform(bg, 'uForest', 'uniform1f', forest);
    const shades = this.fogColors().map(c => Array.isArray(c) ? c : rgb(c)); for (let i = 0; i < 3; i++) this.uniform(bg, `uColor${i}`, 'uniform3fv', shades[i % shades.length]); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.disableVertexAttribArray(at);
    if(this.scene === 'aurora-fog')return;
    gl.useProgram(points); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); ['aPosition', 'aColor', 'aData'].forEach((name, i) => { const loc = gl.getAttribLocation(points, name); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[i]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); });
    this.uniform(points, 'uTime', 'uniform1f', this.clock); this.uniform(points, 'uMotion', 'uniform1f', this.reduced ? 0 : 1); this.uniform(points, 'uAspect', 'uniform1f', this.W / this.H); this.uniform(points, 'uDpr', 'uniform1f', this.DPR); this.uniform(points, 'uIntensity', 'uniform1f', clamp(this.intensity * (this.scene === 'aurora-fog' || this.shape === 'aurora' ? 1.7 : 1), 0, 2)); this.uniform(points, 'uRain', 'uniform1f', this.scene === 'particle-rain' ? 1 : 0); this.uniform(points, 'uForest', 'uniform1f', forest);
    const p = this.pointer; this.uniform(points, 'uPointer', 'uniform4f', p.x, p.y, this.fluidEnabled ? p.vx : 0, this.fluidEnabled ? p.vy : 0);
    this.uniform(points, 'uReflect', 'uniform1f', 1); gl.drawArrays(gl.POINTS, 0, this.geometry.count); this.uniform(points, 'uReflect', 'uniform1f', 0); if (forest) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.POINTS, 0, this.geometry.count);
    ['aPosition', 'aColor', 'aData'].forEach(name => gl.disableVertexAttribArray(gl.getAttribLocation(points, name)));
  }
  render2D() {
    const ctx = this.ctx, w = this.W, h = this.H, shades = this.fogColors().map(c => Array.isArray(c) ? c : rgb(c)); ctx.globalAlpha = 1; ctx.fillStyle = '#090b0d'; ctx.fillRect(0, 0, w, h);
    shades.forEach((c, i) => { const x = w * (.18 + i * .33), y = h * .55, g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(w, h) * .55); g.addColorStop(0, `rgba(${c.map(v => Math.round(v * 255)).join(',')},.1)`); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
    const { positions, colors, data, count } = this.geometry, step = Math.max(1, Math.ceil(count / 7000));
    for (let i = 0; i < count; i += step) { const o = i * 3, depth = 2.9 / (2.9 + positions[o + 2]); let x = positions[o], y = positions[o + 1]; if (this.scene === 'particle-rain' && !this.reduced) y = (y + this.clock * .05 + 1) % 3 - 1;
      x = w * .5 + x * (.36 + .64 * clamp((w / h - .4) / 1.2, 0, 1)) * depth * h * .5; y = h * .5 - (y + .05) * .9 * depth * h * .5;
      if (this.fluidEnabled && !this.reduced) { const p = this.pointer, dx = (x / w * 2 - 1 - p.x) * w / h, dy = 1 - y / h * 2 - p.y, influence = Math.exp(-(dx * dx + dy * dy) * 16); x += p.vx * influence * w * .012; y -= p.vy * influence * h * .012; }
      const size = Math.max(.7, data[o] * depth * 1.3); ctx.fillStyle = `rgb(${Math.round(colors[o] * 255)},${Math.round(colors[o + 1] * 255)},${Math.round(colors[o + 2] * 255)})`; ctx.globalAlpha = .8; ctx.fillRect(x, y, size, size);
      const waterline = h * .5 + .33 * .9 * depth * h * .5, ry = waterline + (waterline - y) * .55; if (ry > waterline && ry < h) { ctx.globalAlpha = .18; ctx.fillRect(x + Math.sin(ry * .13) * 2, ry, size * 1.6, size * .6); }
    } ctx.globalAlpha = 1;
  }
}
export const CALL_BACKDROP_SCENES = Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name }));
export const CALL_BACKDROP_SHAPES = [{ id: '', name: '自然花园' }, { id: 'tree', name: '树状' }, { id: 'aurora', name: '极光' }];
