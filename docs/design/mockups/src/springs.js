// Whim mockups: the six springs from 01-direction.md §9.2, a small interruptible spring driver,
// and the helpers the motion page uses (momentum projection, rubber band, CSS linear() sampling).

const SPRINGS = {
  instant: { response: 0.12, damping: 1.0, use: 'Press-in' },
  snappy: { response: 0.28, damping: 1.0, use: 'Press-out, toggles, selection' },
  smooth: { response: 0.40, damping: 1.0, use: 'Push, pop, sheets, steps' },
  fling: { response: 0.35, damping: 0.80, use: 'Released drags, with velocity' },
  morph: { response: 0.50, damping: 0.90, use: 'Tile to app, ghost to tile' },
  spark: { response: 0.55, damping: 0.55, use: 'Rare celebrations' },
};

function springConsts(cfg) {
  const w = (2 * Math.PI) / cfg.response;
  return { k: w * w, c: 2 * cfg.damping * w };
}

let REDUCED = false;
try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* no matchMedia */ }

// A value that springs toward a target. Retargeting keeps position and velocity, so motion never jumps.
class SpringValue {
  constructor(value, onUpdate, { precision = 0.001 } = {}) {
    this.x = value; this.v = 0; this.target = value; this.onUpdate = onUpdate; this.raf = 0;
    this.cfg = SPRINGS.smooth; this.precision = precision; this.onRest = null;
  }
  to(target, cfg = SPRINGS.smooth, velocity) {
    this.target = target; this.cfg = cfg;
    if (velocity !== undefined) this.v = velocity;
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.step(t)); }
  }
  set(x) { this.stop(); this.x = x; this.v = 0; this.target = x; this.onUpdate(x); }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  step(t) {
    const dt = Math.min((t - this.last) / 1000, 1 / 20); this.last = t;
    const { k, c } = springConsts(this.cfg);
    const n = Math.max(1, Math.ceil(dt * 480)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -k * (this.x - this.target) - c * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    this.onUpdate(this.x);
    if (Math.abs(this.x - this.target) < this.precision && Math.abs(this.v) < this.precision * 10) {
      this.x = this.target; this.v = 0; this.onUpdate(this.x); this.raf = 0;
      if (this.onRest) this.onRest();
      return;
    }
    this.raf = requestAnimationFrame((tt) => this.step(tt));
  }
}

// Apple's projection: where a flick of velocity v (px/s) comes to rest.
function project(v, d = 0.998) { return ((v / 1000) * d) / (1 - d); }
// Progressive resistance past a bound.
function rubberband(over, dim, c = 0.55) { return (over * dim * c) / (dim + c * Math.abs(over)); }

// Velocity tracker over the last ~80 ms of pointer samples.
class VelocityTracker {
  constructor() { this.s = []; }
  add(x, t = performance.now()) { this.s.push([x, t]); while (this.s.length > 2 && t - this.s[0][1] > 80) this.s.shift(); }
  velocity() { if (this.s.length < 2) return 0; const [x0, t0] = this.s[0], [x1, t1] = this.s[this.s.length - 1]; return t1 > t0 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0; }
  reset() { this.s = []; }
}

// Step response sampled at 60 Hz until it settles: the curve a WAAPI `linear()` easing would carry.
function sampleSpring(cfg, { max = 2.5 } = {}) {
  const { k, c } = springConsts(cfg);
  let x = 0, v = 0, t = 0; const pts = [0]; const h = 1 / 960; let settle = 0;
  while (t < max) {
    for (let i = 0; i < 16; i++) { const a = -k * (x - 1) - c * v; v += a * h; x += v * h; }
    t += 1 / 60; pts.push(x);
    if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) { settle = t; break; }
  }
  return { pts, duration: settle || max };
}
function linearEasing(cfg) {
  const { pts, duration } = sampleSpring(cfg);
  const step = Math.max(1, Math.floor(pts.length / 40));
  const kept = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  return { css: `linear(${kept.map((p) => +p.toFixed(3)).join(', ')})`, ms: Math.round(duration * 1000) };
}
