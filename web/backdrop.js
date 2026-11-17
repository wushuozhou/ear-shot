// 通话背景场景引擎：零依赖 Canvas 2D，一个 rAF 驱动三种氛围层。
// 参数取自「动效提示词 × 效果对照表」Spring '26：
//   S01 加载粒子雨   纯黑 #090909，白点自下而上匀速升起，横向漂移，中心向外淡出
//   S02 Hero 点云    4200 点，低饱和，镜面倒影随波碎裂，相机极慢推进
//   S05 流体光标扰动 splat 半径 0.28 屏宽，回流阻尼 0.93，推开后缓慢回流
// 设计约束（apple-design）：只动 transform/opacity 级别的画布合成，不做全屏闪烁；
// 页面隐藏即暂停；prefers-reduced-motion 下渲染静帧并关掉指针扰动。

const PRESETS = {
  'particle-rain': { name: '粒子雨', accents: ['#FFFFFF', '#AFEEFF'], base: '#090909' },
  'point-cloud': { name: '点云倒影', accents: ['#203D27', '#496F85', '#C478DB'], base: '#090909' },
  'aurora-fog': { name: '体积光雾', accents: ['#8040C1', '#7FD3CF'], base: '#090909' },
};

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function hexToRgb(hex) {
  const s = String(hex || '').replace('#', '');
  if (s.length !== 6) return [255, 255, 255];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// 用户色环给的是色相角，转成一组同色系低饱和强调色
function paletteFromHue(hue) {
  const h = ((Number(hue) || 0) % 360 + 360) % 360;
  const hsl = (hh, s, l) => `hsl(${(hh % 360 + 360) % 360} ${s}% ${l}%)`;
  return [hsl(h, 42, 46), hsl(h + 28, 34, 58), hsl(h - 32, 48, 62)];
}

export class CallBackdrop {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.scene = 'point-cloud';
    this.hue = null;           // null = 用预设配色；数字 = 用户色环
    this.intensity = 1;
    this.fluidEnabled = true;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.running = false;
    this.clock = 0;
    this.last = 0;
    this.W = 0; this.H = 0; this.DPR = 1;
    // 流体速度场：粗网格 + 回流阻尼，避免每帧全屏 shader 的开销
    this.grid = { cols: 0, rows: 0, vx: null, vy: null, damp: 0.93 };
    this.pointer = { x: -1, y: -1, px: -1, py: -1, active: false };
    this.rain = [];
    this.cloud = [];
    this.tier = this.detectTier();
    this.onResize = () => this.resize();
    this.onPointer = e => this.handlePointer(e);
    this.onVisibility = () => { if (document.hidden) this.pause(); else this.resume(); };
    Object.assign(this, options);
  }

  // 低端设备少画点：粒子数与 DPR 都按档位压。
  detectTier() {
    const cores = navigator.hardwareConcurrency || 2;
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    if (mobile || cores <= 2) return 1;
    if (cores <= 4) return 2;
    return 3;
  }

  get budget() {
    const scale = this.tier === 1 ? 0.25 : this.tier === 2 ? 0.55 : 1;
    return { rain: Math.round(120 * scale), cloud: Math.round(4200 * scale) };
  }

  palette() {
    if (this.hue !== null && this.hue !== undefined && this.hue !== '') return paletteFromHue(this.hue);
    return (PRESETS[this.scene] || PRESETS['point-cloud']).accents;
  }

  mount() {
    this.resize();
    addEventListener('resize', this.onResize);
    addEventListener('pointermove', this.onPointer, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resume();
  }

  destroy() {
    this.pause();
    removeEventListener('resize', this.onResize);
    removeEventListener('pointermove', this.onPointer);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  setScene(scene) {
    if (!PRESETS[scene]) return;
    this.scene = scene;
    this.build();
  }

  setHue(hue) { this.hue = hue === '' || hue === null ? null : Number(hue); this.build(); }
  setFluid(on) {
    this.fluidEnabled = !!on;
    if (!on) { this.grid.vx?.fill(0); this.grid.vy?.fill(0); }
  }

  resize() {
    // DPR 上限 1.5（低端 1.0），文档性能规格要求
    this.DPR = Math.min(window.devicePixelRatio || 1, this.tier === 1 ? 1 : 1.5);
    this.W = this.canvas.clientWidth || window.innerWidth;
    this.H = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.max(1, Math.round(this.W * this.DPR));
    this.canvas.height = Math.max(1, Math.round(this.H * this.DPR));
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    const cell = 48;
    this.grid.cols = Math.max(2, Math.ceil(this.W / cell));
    this.grid.rows = Math.max(2, Math.ceil(this.H / cell));
    this.grid.vx = new Float32Array(this.grid.cols * this.grid.rows);
    this.grid.vy = new Float32Array(this.grid.cols * this.grid.rows);
    this.build();
  }

  build() {
    const { rain, cloud } = this.budget;
    const colors = this.palette();
    this.rain = [];
    for (let i = 0; i < rain; i++) {
      this.rain.push({
        x: Math.random() * this.W,
        y: Math.random() * this.H,
        speed: 24 + Math.random() * 54,      // 匀速升起，但每颗速度不同
        drift: (Math.random() - 0.5) * 10,   // 轻微横向漂移
        r: 0.6 + Math.random() * 1.4,
        a: 0.25 + Math.random() * 0.55,
      });
    }
    this.cloud = [];
    for (let i = 0; i < cloud; i++) {
      const [r, g, b] = hexToRgb(colors[i % colors.length]);
      this.cloud.push({
        // 起伏地形：x/z 铺面，y 由正弦噪声给高度
        bx: Math.random() * 2 - 1,
        bz: Math.random(),
        phase: Math.random() * Math.PI * 2,
        amp: 0.04 + Math.random() * 0.09,
        r, g, b,
        a: 0.3 + Math.random() * 0.5,
        ox: 0, oy: 0,                        // 流体位移，缓慢回流到 0
      });
    }
  }

  handlePointer(event) {
    if (!this.fluidEnabled || this.reduced) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (this.pointer.x >= 0) { this.pointer.px = this.pointer.x; this.pointer.py = this.pointer.y; }
    this.pointer.x = x; this.pointer.y = y; this.pointer.active = true;
    this.splat(x, y, x - this.pointer.px, y - this.pointer.py);
  }

  // splat：以 0.28 屏宽为半径，把指针速度注入速度场
  splat(x, y, dx, dy) {
    const { cols, rows, vx, vy } = this.grid;
    if (!vx) return;
    const radius = 0.28 * Math.min(this.W, this.H);
    const cw = this.W / cols, ch = this.H / rows;
    const strength = Math.min(1, Math.hypot(dx, dy) / 40);
    if (strength <= 0.001) return;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const gx = (c + 0.5) * cw, gy = (r + 0.5) * ch;
        const d = Math.hypot(gx - x, gy - y);
        if (d > radius) continue;
        const fall = 1 - d / radius;            // 柔和衰减，不做爆裂
        const i = r * cols + c;
        vx[i] += dx * fall * strength * 0.9;
        vy[i] += dy * fall * strength * 0.9;
      }
    }
  }

  sampleField(x, y) {
    const { cols, rows, vx, vy } = this.grid;
    if (!vx) return [0, 0];
    const c = Math.min(cols - 1, Math.max(0, Math.floor(x / (this.W / cols))));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(y / (this.H / rows))));
    const i = r * cols + c;
    return [vx[i], vy[i]];
  }

  decayField() {
    const { vx, vy, damp } = this.grid;
    if (!vx) return;
    for (let i = 0; i < vx.length; i++) { vx[i] *= damp; vy[i] *= damp; }
  }

  resume() {
    if (this.running) return;
    this.running = true;
    if (this.reduced) { this.renderFrame(0); this.running = false; return; }
    this.last = 0;
    this.raf = requestAnimationFrame(t => this.tick(t));
  }

  pause() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  tick(now) {
    if (!this.running) return;
    if (!this.last) this.last = now;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.renderFrame(dt);
    this.decayField();
    this.raf = requestAnimationFrame(t => this.tick(t));
  }

  renderFrame(dt) {
    const ctx = this.ctx;
    const base = (PRESETS[this.scene] || PRESETS['point-cloud']).base;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, this.W, this.H);
    if (this.scene === 'particle-rain') this.drawRain(dt);
    else if (this.scene === 'aurora-fog') this.drawFog(dt);
    else this.drawCloud(dt);
    this.drawGrain();
  }

  // S01：白色细点自下而上升起，中心向四周柔和淡出
  drawRain(dt) {
    const ctx = this.ctx;
    const colors = this.palette();
    const speed = this.reduced ? 0.25 : 1;      // reduced-motion 减速 4 倍
    for (const p of this.rain) {
      if (!this.reduced) {
        p.y -= p.speed * dt * speed;
        p.x += p.drift * dt;
        if (p.y < -4) { p.y = this.H + 4; p.x = Math.random() * this.W; }
        if (p.x < -4) p.x = this.W + 4; else if (p.x > this.W + 4) p.x = -4;
      }
      const [fx, fy] = this.fluidEnabled ? this.sampleField(p.x, p.y) : [0, 0];
      // 中心向外淡出：横竖双向渐变遮罩
      const mx = 1 - Math.abs(p.x / this.W - 0.5) * 2;
      const my = 1 - Math.abs(p.y / this.H - 0.5) * 2;
      const mask = clamp01(0.35 + (1 - mx * my) * 0.85);
      ctx.globalAlpha = p.a * mask * this.intensity;
      ctx.fillStyle = colors[0] || '#FFFFFF';
      ctx.beginPath();
      ctx.arc(p.x + fx * 0.25, p.y + fy * 0.25, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // S02：点云起伏地形 + 下方镜面倒影（倒影随波碎裂）
  drawCloud(dt) {
    const ctx = this.ctx;
    const horizon = this.H * 0.62;             // 地平线压在下 1/3 偏上
    const camera = this.reduced ? 0.5 : (Math.sin(this.clock * 0.08) * 0.5 + 0.5); // 极慢推进
    ctx.save();
    for (const p of this.cloud) {
      // 近大远小的伪透视
      const z = 0.12 + p.bz * 0.88;
      const persp = 1 / (0.35 + z * 1.5);
      const wave = Math.sin(this.clock * 0.35 + p.phase + p.bz * 4) * p.amp;
      const x = this.W * 0.5 + p.bx * this.W * 0.62 * persp;
      const y = horizon - (wave + 0.08) * this.H * persp - z * this.H * 0.06 * camera;
      if (x < -20 || x > this.W + 20) continue;
      // 流体扰动：推开后缓慢回流
      if (this.fluidEnabled && !this.reduced) {
        const [fx, fy] = this.sampleField(x, y);
        p.ox = (p.ox + fx * dt * 2.2) * 0.94;
        p.oy = (p.oy + fy * dt * 2.2) * 0.94;
      } else { p.ox *= 0.9; p.oy *= 0.9; }
      const px = x + p.ox, py = y + p.oy;
      const size = Math.max(0.5, 1.9 * persp);
      const fade = clamp01(persp * 0.9) * this.intensity;
      ctx.globalAlpha = p.a * fade;
      ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      ctx.fillRect(px, py, size, size);
      // 镜面倒影：垂直翻转、30% 不透明度、随波做 <2px 的横向碎裂
      const ry = horizon + (horizon - py);
      if (ry < this.H + 10) {
        const ripple = Math.sin(this.clock * 1.7 + ry * 0.06) * 1.6;
        ctx.globalAlpha = p.a * fade * 0.3;
        ctx.fillRect(px + ripple, ry, size, size);
      }
    }
    ctx.restore();
    // 水面本身：一层压暗的渐变，让倒影读起来是水
    const water = ctx.createLinearGradient(0, horizon, 0, this.H);
    water.addColorStop(0, 'rgba(9,9,9,0)');
    water.addColorStop(1, 'rgba(9,9,9,.72)');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, this.W, this.H - horizon);
    ctx.globalAlpha = 1;
  }

  // S03 近似：半透明径向光柱叠加 + 加色混合，8s 呼吸
  drawFog(dt) {
    const ctx = this.ctx;
    const colors = this.palette();
    const breathe = 0.78 + Math.sin(this.clock * (Math.PI * 2 / 8)) * 0.22;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < colors.length; i++) {
      const t = this.clock * 0.06 + i * 1.7;
      const cx = this.W * (0.5 + Math.sin(t) * 0.26);
      const cy = this.H * (0.42 + Math.cos(t * 0.8) * 0.2);
      let ox = 0, oy = 0;
      if (this.fluidEnabled && !this.reduced) { const f = this.sampleField(cx, cy); ox = f[0] * 0.6; oy = f[1] * 0.6; }
      const radius = Math.min(this.W, this.H) * (0.42 + i * 0.1);
      const grad = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, radius);
      const [r, g, b] = hexToRgb(colors[i]);
      grad.addColorStop(0, `rgba(${r},${g},${b},${0.3 * breathe * this.intensity})`);
      grad.addColorStop(0.55, `rgba(${r},${g},${b},${0.1 * breathe * this.intensity})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    ctx.restore();
  }

  // 全局颗粒 6–8%，避免大面积纯色带状感
  drawGrain() {
    const ctx = this.ctx;
    if (!this.grainPattern) {
      const g = document.createElement('canvas');
      g.width = g.height = 64;
      const gc = g.getContext('2d');
      const img = gc.createImageData(64, 64);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 120 + Math.random() * 135;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      gc.putImageData(img, 0, 0);
      this.grainPattern = ctx.createPattern(g, 'repeat');
    }
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = this.grainPattern;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.restore();
  }
}

export const CALL_BACKDROP_SCENES = Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name }));
