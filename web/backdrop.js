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

// ── 点云形状发生器 ──
// 参考 Shopify Editions 的点云：形体由大量细点堆出来，靠密度而不是轮廓线成形。
// 每个发生器返回归一化坐标 { nx: -1..1, ny: 0..1(上到下), depth: 0..1, lum: 0..1 }
const SHAPES = {
  // 树状：主干 + 递归分叉 + 冠层散点，像参考站里缓慢呼吸的有机体
  tree(count) {
    const pts = [];
    const branches = [];
    // 先生成骨架：从根部向上递归分叉
    const grow = (x, y, angle, len, width, depth) => {
      if (depth > 7 || len < 0.012) return;
      const x2 = x + Math.cos(angle) * len;
      const y2 = y - Math.sin(angle) * len;
      branches.push({ x1: x, y1: y, x2, y2, width, depth });
      const spread = 0.38 + Math.random() * 0.3;
      const shrink = 0.72 + Math.random() * 0.12;
      grow(x2, y2, angle - spread, len * shrink, width * 0.68, depth + 1);
      grow(x2, y2, angle + spread, len * shrink, width * 0.68, depth + 1);
      // 偶尔抽一根细枝，避免过于对称
      if (depth < 4 && Math.random() < 0.45) {
        grow(x2, y2, angle + (Math.random() - 0.5) * 0.5, len * shrink * 0.8, width * 0.5, depth + 2);
      }
    };
    grow(0, 0.98, Math.PI / 2, 0.2, 0.055, 0);
    const total = branches.reduce((s, b) => s + Math.hypot(b.x2 - b.x1, b.y2 - b.y1) * (1 + b.depth * 0.5), 0) || 1;
    for (let i = 0; i < count; i++) {
      // 按长度加权挑一段枝，越细的枝分到越多点 → 冠层自然浓密
      let pick = Math.random() * total;
      let b = branches[0];
      for (const br of branches) {
        pick -= Math.hypot(br.x2 - br.x1, br.y2 - br.y1) * (1 + br.depth * 0.5);
        if (pick <= 0) { b = br; break; }
      }
      const t = Math.random();
      // 沿枝干散开，末梢散得更开形成树冠
      const jitter = b.width * (0.5 + b.depth * 0.42);
      const nx = b.x1 + (b.x2 - b.x1) * t + (Math.random() - 0.5) * jitter * 2.2;
      const ny = b.y1 + (b.y2 - b.y1) * t + (Math.random() - 0.5) * jitter * 1.6;
      pts.push({
        nx: Math.max(-1, Math.min(1, nx)),
        ny: Math.max(0, Math.min(1, ny)),
        depth: Math.random(),
        lum: 0.45 + b.depth * 0.08 + Math.random() * 0.25,
      });
    }
    return pts;
  },
  // 极光：数条垂直光幕，沿 x 正弦飘动，底部浓顶部散
  aurora(count) {
    const pts = [];
    const curtains = 4;
    const seeds = Array.from({ length: curtains }, (_, i) => ({
      cx: -0.62 + i * (1.24 / (curtains - 1)),
      freq: 1.6 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
      amp: 0.1 + Math.random() * 0.14,
      width: 0.05 + Math.random() * 0.06,
    }));
    for (let i = 0; i < count; i++) {
      const s = seeds[(Math.random() * curtains) | 0];
      // v 沿光幕高度：0 顶 1 底
      const v = Math.random();
      // 顶部越稀薄：用幂次把点往下压
      const vy = Math.pow(v, 0.72);
      const wave = Math.sin(vy * s.freq * Math.PI + s.phase) * s.amp;
      // 横向用高斯状抖动，边缘自然羽化
      const spread = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      pts.push({
        nx: Math.max(-1, Math.min(1, s.cx + wave + spread * s.width * (1 + vy))),
        ny: 0.14 + vy * 0.74,
        depth: Math.random(),
        lum: 0.3 + (1 - vy) * 0.55 + Math.random() * 0.2,
      });
    }
    return pts;
  },
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
    this.density = 1;          // 粒子密度倍率，设置页可调
    this.pattern = '';         // 自绘/导入图案（data URL），点云按其明暗分布汇聚
    this.patternPoints = null; // 从图案采样出的归一化坐标与颜色
    this.shape = '';           // 内置形状：'' 自然起伏 | 'tree' 树状 | 'aurora' 极光
    this.fogPalette = null;    // 体积光雾自定义配色（#rrggbb 数组），null 用场景/色环配色
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
    // density 为用户可调倍率（0.4–2.2），和设备档位相乘
    const d = Math.max(0.2, Math.min(2.2, Number(this.density) || 1));
    return { rain: Math.round(120 * scale * d), cloud: Math.round(4200 * scale * d) };
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
  setDensity(value) {
    this.density = Math.max(0.2, Math.min(2.2, Number(value) || 1));
    this.build();
  }
  setShape(shape) {
    this.shape = SHAPES[shape] ? shape : '';
    this.build();
  }
  // 体积光雾配色：传入 #rrggbb 数组即生效，传空恢复场景配色
  setFogColors(colors) {
    const list = (Array.isArray(colors) ? colors : String(colors || '').split(','))
      .map(c => String(c).trim())
      .filter(c => /^#[0-9a-fA-F]{6}$/.test(c));
    this.fogPalette = list.length ? list : null;
  }
  // 图案：自绘笔迹或导入图片。把明暗分布采样成点云的汇聚目标。
  async setPattern(dataUrl) {
    this.pattern = dataUrl || '';
    if (!this.pattern) { this.patternPoints = null; this.build(); return; }
    try {
      const bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图案无法解析'));
        img.src = this.pattern;
      });
      const side = 160;
      const off = document.createElement('canvas');
      off.width = off.height = side;
      const g = off.getContext('2d');
      // 导入的照片可能带透明或亮底，先铺黑底统一成"亮处=有点"的语义
      g.fillStyle = '#000';
      g.fillRect(0, 0, side, side);
      // 等比适配，避免长图被拉变形
      const scale = Math.min(side / bitmap.width, side / bitmap.height);
      const dw = bitmap.width * scale, dh = bitmap.height * scale;
      g.drawImage(bitmap, (side - dw) / 2, (side - dh) / 2, dw, dh);
      const data = g.getImageData(0, 0, side, side).data;
      const points = [];
      const cell = 1 / side;
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          const i = (y * side + x) * 4;
          const alpha = data[i + 3] / 255;
          const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
          if (alpha < 0.12 || lum < 0.08) continue;
          // 亮度越高权重越大：同一格可重复入选，密度自然随明暗变化
          const weight = Math.max(1, Math.round(lum * 3));
          const p = { nx: x / side * 2 - 1, ny: y / side, lum, cell, r: data[i], g: data[i + 1], b: data[i + 2] };
          for (let k = 0; k < weight; k++) points.push(p);
        }
      }
      this.patternPoints = points.length ? points : null;
    } catch (_) {
      this.patternPoints = null;
    }
    this.build();
  }
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
    const pts = this.patternPoints;
    // 形状优先级：自绘/导入图案 > 内置形状（树状/极光）> 自然起伏地形
    const shaped = pts && pts.length
      ? null
      : (SHAPES[this.shape] ? SHAPES[this.shape](cloud) : null);
    for (let i = 0; i < cloud; i++) {
      const [r, g, b] = hexToRgb(colors[i % colors.length]);
      if (pts && pts.length) {
        // 图案模式：大量点按笔迹的亮度分布汇聚成该形状
        const p = pts[(Math.random() * pts.length) | 0];
        // 每个点在采样格内再做亚像素抖动，点多时才不会叠成硬方块
        const jx = (Math.random() - 0.5) * p.cell * 2;
        const jy = (Math.random() - 0.5) * p.cell;
        this.cloud.push({
          bx: Math.max(-1, Math.min(1, p.nx + jx)),
          by: Math.max(0, Math.min(1, p.ny + jy)),
          bz: Math.random(),
          phase: Math.random() * Math.PI * 2,
          amp: 0.008 + Math.random() * 0.014,   // 图案要认得出，起伏幅度收小
          r: Math.round((p.r + r) / 2), g: Math.round((p.g + g) / 2), b: Math.round((p.b + b) / 2),
          a: 0.3 + p.lum * 0.55,
          ox: 0, oy: 0,
          pinned: true,
        });
        continue;
      }
      if (shaped) {
        const p = shaped[i];
        this.cloud.push({
          bx: p.nx,
          by: p.ny,
          bz: p.depth,
          phase: Math.random() * Math.PI * 2,
          amp: 0.012 + Math.random() * 0.022,
          r, g, b,
          a: 0.26 + p.lum * 0.52,
          ox: 0, oy: 0,
          pinned: true,
        });
        continue;
      }
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
      // 形状点（图案/树/极光）带 by，按归一化高度直接定位在水面之上，
      // 这样形体才认得出；自然地形仍用原来的起伏算法。
      const x = p.pinned
        ? this.W * 0.5 + p.bx * this.W * 0.42
        : this.W * 0.5 + p.bx * this.W * 0.62 * persp;
      const y = p.pinned
        ? horizon - (1 - p.by) * this.H * 0.52 - wave * this.H
        : horizon - (wave + 0.08) * this.H * persp - z * this.H * 0.06 * camera;
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

  // S03 体积光雾：沿深度排列的半透明切片 + 斜向光束穿行 + 边缘渐隐噪声，8s 呼吸。
  // 关键是"光有厚度"：多层切片用加色混合叠出体积感，而不是单层径向渐变。
  drawFog(dt) {
    const ctx = this.ctx;
    const colors = this.fogColors();
    const breathe = 0.78 + Math.sin(this.clock * (Math.PI * 2 / 8)) * 0.22;
    const slices = this.tier === 1 ? 5 : this.tier === 2 ? 7 : 9;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 1) 体积光束：每条光束是一片倾斜的梯形光幕，沿深度方向分层
    for (let i = 0; i < slices; i++) {
      const depth = i / (slices - 1);           // 0 近 1 远
      const c = colors[i % colors.length];
      const [r, g, b] = hexToRgb(c);
      const t = this.clock * 0.05 + i * 0.9;
      // 远层更慢更淡，近层更快更亮 —— 视差造出厚度
      const sway = Math.sin(t) * (0.2 - depth * 0.12);
      const cx = this.W * (0.5 + sway);
      const cy = this.H * (0.38 + Math.cos(t * 0.7) * 0.12);
      let ox = 0, oy = 0;
      if (this.fluidEnabled && !this.reduced) {
        const f = this.sampleField(cx, cy);
        ox = f[0] * (0.8 - depth * 0.5); oy = f[1] * (0.8 - depth * 0.5);
      }
      const alpha = (0.16 - depth * 0.1) * breathe * this.intensity;
      if (alpha <= 0.002) continue;
      // 斜向光柱：上窄下宽，模拟自上方透下的体积光
      const topW = this.W * (0.08 + depth * 0.1);
      const botW = this.W * (0.42 + depth * 0.3);
      const tilt = Math.sin(t * 0.6) * this.W * 0.12;
      const beam = ctx.createLinearGradient(cx + ox, 0, cx + ox + tilt, this.H);
      beam.addColorStop(0, `rgba(${r},${g},${b},0)`);
      beam.addColorStop(0.28, `rgba(${r},${g},${b},${alpha})`);
      beam.addColorStop(0.72, `rgba(${r},${g},${b},${alpha * 0.55})`);
      beam.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(cx + ox - topW / 2, -10);
      ctx.lineTo(cx + ox + topW / 2, -10);
      ctx.lineTo(cx + ox + tilt + botW / 2, this.H + 10);
      ctx.lineTo(cx + ox + tilt - botW / 2, this.H + 10);
      ctx.closePath();
      ctx.fill();
    }

    // 2) 弥散光团：给光束之间填上雾的"体"，边缘羽化
    for (let i = 0; i < colors.length; i++) {
      const t = this.clock * 0.06 + i * 1.7;
      const cx = this.W * (0.5 + Math.sin(t) * 0.26);
      const cy = this.H * (0.42 + Math.cos(t * 0.8) * 0.2);
      let ox = 0, oy = 0;
      if (this.fluidEnabled && !this.reduced) { const f = this.sampleField(cx, cy); ox = f[0] * 0.6; oy = f[1] * 0.6; }
      const radius = Math.min(this.W, this.H) * (0.42 + i * 0.1);
      const grad = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, radius);
      const [r, g, b] = hexToRgb(colors[i]);
      grad.addColorStop(0, `rgba(${r},${g},${b},${0.26 * breathe * this.intensity})`);
      grad.addColorStop(0.55, `rgba(${r},${g},${b},${0.09 * breathe * this.intensity})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    ctx.restore();

    // 3) 顶部压暗 + 底部收拢，避免整屏发白、保证文字可读
    const vign = ctx.createLinearGradient(0, 0, 0, this.H);
    vign.addColorStop(0, 'rgba(9,9,9,.5)');
    vign.addColorStop(0.45, 'rgba(9,9,9,0)');
    vign.addColorStop(1, 'rgba(9,9,9,.55)');
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  // 体积光雾配色：优先用户自定义色；否则色环；再否则场景预设
  fogColors() {
    if (Array.isArray(this.fogPalette) && this.fogPalette.length) return this.fogPalette;
    return this.palette();
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
export const CALL_BACKDROP_SHAPES = [
  { id: '', name: '自然起伏' },
  { id: 'tree', name: '树状' },
  { id: 'aurora', name: '极光' },
];
