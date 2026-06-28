// Leviathan creature renderer — Canvas 2D only (no WebGL). Reuses Mycelium's
// proven approach: a logical-sized glow canvas drawn behind a crisp layer with
// blur + "lighter" compositing, and a seeded PRNG so each skeleton is identical
// every render. v2 renders a *sea* of creatures — one per top market — each
// breathing on its own phase, sized by OI, colored by funding, lit by volume,
// and able to convulse on its own recorded liquidation cascade.
import { mulberry32, rangeOf } from "@/lib/prng";
import { fundingRgb } from "@/lib/hl";

export const LOGICAL_W = 1120;
export const LOGICAL_H = 640;

export type Vitals = {
  markPx: number;
  oiUsd: number;
  dayVlm: number;
  fundingHourly: number;
  fundingApr: number;
  change24h: number;
};

export type Drive = {
  bulk: number; // 0..1 from open interest → body bulk
  glow: number; // 0..1 from 24h volume → bioluminescence
  rgb: [number, number, number]; // from funding → body color
  tilt: number; // -1..1 from 24h change → rise / sink
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function logNorm(v: number, lo: number, hi: number) {
  if (!isFinite(v) || v <= 0) return 0;
  return clamp01((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)));
}

export function driveFrom(v: Vitals | null): Drive {
  if (!v) return { bulk: 0.4, glow: 0.3, rgb: [210, 222, 232], tilt: 0 };
  return {
    bulk: logNorm(v.oiUsd, 10e6, 5e9),
    glow: logNorm(v.dayVlm, 10e6, 5e9),
    rgb: fundingRgb(v.fundingHourly),
    tilt: Math.max(-1, Math.min(1, v.change24h * 12)),
  };
}

type Tentacle = { rim: number; len: number; phase: number; curl: number; width: number; waves: number };
type Particle = { x: number; y: number; r: number; phase: number; drift: number; spd: number };
export type Geom = { tentacles: Tentacle[]; arms: Tentacle[]; particles: Particle[] };

// A live trade flashing across a creature's skin. B (buy) = warm flash rising up
// the bell; A (sell) = cool flash sinking down the tentacles. mag 0..1 from size.
export type Flash = { t0: number; side: "A" | "B"; mag: number; lane: number };
export const FLASH_LIFE = 1.15; // seconds

// A recorded liquidation-cascade frame driving the convulsion. stress is the real
// cum_liquidations / cum_book ratio at the scrub position (≥1 = ignition).
export type Convulse = { stress: number; exhausted: boolean };

// One creature in the sea.
export type SeaCreature = {
  coin: string;
  drive: Drive;
  geom: Geom;
  cx: number;
  cy: number;
  scale: number;
  phase: number; // breathing phase offset
  depth: number; // 0 (far/dim) .. 1 (near/bright)
  flashes: Flash[];
  convulse?: Convulse;
};

export function buildOrganism(seed = 7): Geom {
  const rng = mulberry32(seed);
  const tentacles: Tentacle[] = [];
  const N = 22;
  for (let i = 0; i < N; i++) {
    tentacles.push({
      rim: (i / (N - 1)) * 2 - 1,
      len: rangeOf(rng, 0.65, 1.15),
      phase: rangeOf(rng, 0, Math.PI * 2),
      curl: rangeOf(rng, -0.6, 0.6),
      width: rangeOf(rng, 0.6, 1.3),
      waves: rangeOf(rng, 1.4, 2.6),
    });
  }
  const arms: Tentacle[] = [];
  for (let i = 0; i < 5; i++) {
    arms.push({
      rim: ((i / 4) * 2 - 1) * 0.5,
      len: rangeOf(rng, 0.5, 0.85),
      phase: rangeOf(rng, 0, Math.PI * 2),
      curl: rangeOf(rng, -0.3, 0.3),
      width: rangeOf(rng, 1.8, 2.8),
      waves: rangeOf(rng, 1.0, 1.8),
    });
  }
  const particles: Particle[] = [];
  for (let i = 0; i < 90; i++) {
    particles.push({
      x: rng(),
      y: rng(),
      r: rangeOf(rng, 0.5, 2.2),
      phase: rangeOf(rng, 0, Math.PI * 2),
      drift: rangeOf(rng, -0.4, 0.4),
      spd: rangeOf(rng, 0.15, 0.5),
    });
  }
  return { tentacles, arms, particles };
}

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const brighten = (c: [number, number, number], k: number): [number, number, number] => [
  Math.round(c[0] + (255 - c[0]) * k),
  Math.round(c[1] + (255 - c[1]) * k),
  Math.round(c[2] + (255 - c[2]) * k),
];
const lerpRgb = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const BUY_RGB: [number, number, number] = [255, 176, 92];
const SELL_RGB: [number, number, number] = [108, 200, 255];

function drawStrand(
  c: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  t: number,
  tn: Tentacle,
  lenPx: number,
  baseW: number,
  contraction: number,
  rgb: [number, number, number],
  alpha: number,
  glowPass: boolean
) {
  const segs = 14;
  const swayAmp = (9 + 20 * contraction) * (0.6 + 0.5 * tn.width);
  let px = x0;
  let py = y0;
  c.lineCap = "round";
  for (let i = 1; i <= segs; i++) {
    const f = i / segs;
    const pf = (i - 1) / segs;
    const sway = Math.sin(t * 1.1 + tn.phase + f * tn.waves * Math.PI) * swayAmp * f;
    const curlX = tn.curl * f * f * 46;
    const x = x0 + sway + curlX;
    const y = y0 + lenPx * f;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(x, y);
    c.lineWidth = (glowPass ? 2.2 : 1.3) * baseW * tn.width * (1 - 0.82 * pf);
    c.strokeStyle = rgba(rgb, alpha * (1 - 0.55 * f) * (glowPass ? 0.55 : 0.9));
    c.stroke();
    px = x;
    py = y;
  }
}

function drawFlashes(
  c: CanvasRenderingContext2D,
  flashes: Flash[],
  t: number,
  cx: number,
  bw: number,
  bellTopY: number,
  rimY: number,
  tipY: number,
  scale: number,
  glowPass: boolean
) {
  for (const fl of flashes) {
    const age = t - fl.t0;
    if (age < 0 || age > FLASH_LIFE) continue;
    const p = age / FLASH_LIFE;
    const fade = Math.sin(p * Math.PI);
    const x = cx + (fl.lane - 0.5) * bw * 1.5 + Math.sin(p * 3 + fl.lane * 6) * 6 * scale;
    const y = fl.side === "B" ? rimY + (bellTopY - rimY) * p : rimY + (tipY - rimY) * p;
    const rgb = fl.side === "B" ? BUY_RGB : SELL_RGB;
    const size = (glowPass ? 2.4 : 1.0) * (1.6 + 6 * fl.mag) * scale;
    c.fillStyle = rgba(rgb, (glowPass ? 0.55 : 0.95) * fade * (0.45 + 0.55 * fl.mag));
    c.beginPath();
    c.arc(x, y, size, 0, Math.PI * 2);
    c.fill();
    const dir = fl.side === "B" ? 1 : -1;
    c.strokeStyle = rgba(rgb, (glowPass ? 0.4 : 0.6) * fade * (0.4 + 0.6 * fl.mag));
    c.lineWidth = size * 0.7;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x, y + dir * (10 + 26 * fl.mag) * scale);
    c.stroke();
  }
}

function drawRupture(
  c: CanvasRenderingContext2D,
  cx: number,
  rimY: number,
  bw: number,
  t: number,
  st: number,
  exhausted: boolean,
  glowPass: boolean
) {
  const warm: [number, number, number] = [255, 90, 64];
  const n = Math.floor(6 + st * 22);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = (18 + ((i * 53) % 70)) * (0.5 + st) * (0.6 + ((i * 13) % 10) / 10);
    const x = cx + Math.cos(ang) * r * 1.2;
    const y = rimY + Math.sin(ang) * r * 0.7 + 10;
    const sz = (glowPass ? 2.2 : 1.0) * (1 + 3 * st);
    c.fillStyle = rgba(warm, (glowPass ? 0.5 : 0.85) * st);
    c.beginPath();
    c.arc(x, y, sz, 0, Math.PI * 2);
    c.fill();
  }
  if (exhausted) {
    const ring = (t % 1.6) / 1.6;
    c.strokeStyle = rgba(warm, (glowPass ? 0.4 : 0.6) * (1 - ring));
    c.lineWidth = glowPass ? 5 : 2.5;
    c.beginPath();
    c.ellipse(cx, rimY, bw * (0.6 + ring * 1.4), bw * (0.4 + ring), 0, 0, Math.PI * 2);
    c.stroke();
  }
}

function drawCreatureBody(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  bw: number,
  bh: number,
  rimY: number,
  t: number,
  contraction: number,
  tentLen: number,
  rgb: [number, number, number],
  drive: Drive,
  geom: Geom,
  scale: number,
  depthA: number,
  glowPass: boolean
) {
  const a = (glowPass ? 0.6 : 1.0) * depthA;
  const baseW = (0.8 + 1.2 * drive.bulk) * scale;

  for (const tn of geom.tentacles) {
    drawStrand(c, cx + tn.rim * bw * 0.92, rimY, t, tn, tentLen * tn.len, baseW, contraction, rgb, 0.8 * a, glowPass);
  }
  for (const ar of geom.arms) {
    drawStrand(c, cx + ar.rim * bw * 0.5, rimY - 4, t, ar, tentLen * ar.len, baseW, contraction, rgb, 0.9 * a, glowPass);
  }

  const grd = c.createRadialGradient(cx, cy - bh * 0.2, bh * 0.12, cx, cy, bw);
  grd.addColorStop(0, rgba(brighten(rgb, 0.25), 0.5 * a));
  grd.addColorStop(0.6, rgba(rgb, (glowPass ? 0.28 : 0.2) * a));
  grd.addColorStop(1, rgba(rgb, 0));
  c.beginPath();
  c.moveTo(cx - bw, cy);
  c.bezierCurveTo(cx - bw, cy - bh * 1.6, cx + bw, cy - bh * 1.6, cx + bw, cy);
  c.quadraticCurveTo(cx, cy + bh * 0.5, cx - bw, cy);
  c.closePath();
  c.fillStyle = grd;
  c.fill();
  c.lineWidth = (glowPass ? 4 : 2) * Math.max(0.5, scale);
  c.strokeStyle = rgba(rgb, (glowPass ? 0.5 : 0.9) * a);
  c.stroke();

  for (let k = 1; k <= 3; k++) {
    const r = (k / 4) * bw;
    c.beginPath();
    c.ellipse(cx, cy - bh * 0.1, r, r * (bh / bw) * 1.1, 0, Math.PI, Math.PI * 2);
    c.lineWidth = (glowPass ? 2 : 1) * Math.max(0.5, scale);
    c.strokeStyle = rgba(rgb, (glowPass ? 0.18 : 0.16) * a * (1 - k / 4));
    c.stroke();
  }

  const dots = 20;
  const lit = brighten(rgb, 0.4);
  for (let i = 0; i <= dots; i++) {
    const f = i / dots;
    const x = cx + (f * 2 - 1) * bw;
    const y = rimY - Math.cos(f * Math.PI) * 2;
    const tw = 0.5 + 0.5 * Math.sin(t * 2 + i * 0.6);
    const rad = (glowPass ? 2.6 : 1.3) * (0.6 + 0.7 * tw) * Math.max(0.5, scale);
    c.fillStyle = rgba(lit, (glowPass ? 0.5 : 0.9) * (0.4 + 0.6 * tw) * (0.5 + 0.5 * drive.glow) * depthA);
    c.beginPath();
    c.arc(x, y, rad, 0, Math.PI * 2);
    c.fill();
  }
}

function drawOneCreature(c: CanvasRenderingContext2D, sc: SeaCreature, t: number, glowPass: boolean) {
  const st = sc.convulse ? clamp01(sc.convulse.stress) : 0;
  const exhausted = sc.convulse?.exhausted ?? false;
  const s = sc.scale;
  const breath = Math.sin(t * 1.05 + sc.phase);
  const contraction = Math.min(1, Math.max(0, breath) + st);
  const shakeX = st ? (Math.sin(t * 47 + sc.phase) * st * 7 + Math.sin(t * 31.3) * st * 4) * s : 0;
  const shakeY = st ? Math.cos(t * 41) * st * 5 * s : 0;
  const cx = sc.cx + shakeX;
  const cy = sc.cy + shakeY + Math.sin(t * 1.05 + sc.phase - 0.4) * 8 * s;
  const bw = (150 + 120 * sc.drive.bulk) * s * (1 - 0.1 * breath) * (1 - 0.12 * st);
  const bh = (84 + 64 * sc.drive.bulk) * s * (1 + 0.16 * breath);
  const rimY = cy + bh * 0.3;
  const tentLen = (150 + 230 * sc.drive.bulk) * s;
  const rgb = st ? lerpRgb(sc.drive.rgb, [255, 70, 55], st * 0.7) : sc.drive.rgb;
  const bellTopY = cy - bh * 1.5;
  const tipY = rimY + tentLen;
  const depthA = 0.4 + 0.6 * sc.depth;

  drawCreatureBody(c, cx, cy, bw, bh, rimY, t, contraction, tentLen, rgb, sc.drive, sc.geom, s, depthA, glowPass);
  drawFlashes(c, sc.flashes, t, cx, bw, bellTopY, rimY, tipY, s, glowPass);
  if (st > 0.12) drawRupture(c, cx, rimY, bw, t, st, exhausted, glowPass);
}

export function drawSea(
  main: CanvasRenderingContext2D,
  glowCanvas: HTMLCanvasElement,
  t: number,
  creatures: SeaCreature[],
  ambient: Geom
) {
  const W = LOGICAL_W;
  const H = LOGICAL_H;
  const glow = glowCanvas.getContext("2d");
  if (!glow) return;

  const bg = main.createRadialGradient(W * 0.5, H * 0.3, 60, W * 0.5, H * 0.5, H * 1.05);
  bg.addColorStop(0, "#0a1622");
  bg.addColorStop(0.5, "#060c14");
  bg.addColorStop(1, "#03060a");
  main.fillStyle = bg;
  main.fillRect(0, 0, W, H);
  glow.clearRect(0, 0, W, H);

  // plankton (on glow → blooms)
  for (const p of ambient.particles) {
    const px = ((((p.x + t * p.spd * 0.02 + p.drift) % 1) + 1) % 1) * W;
    const py = ((((p.y - t * p.spd * 0.012) % 1) + 1) % 1) * H;
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.6 + p.phase * 6.28));
    glow.fillStyle = `rgba(110,160,180,${0.07 * tw})`;
    glow.beginPath();
    glow.arc(px, py, p.r * 2, 0, Math.PI * 2);
    glow.fill();
  }

  // creatures: paint far→near so nearer ones overlap on top
  const ordered = [...creatures].sort((a, b) => a.depth - b.depth);
  for (const sc of ordered) drawOneCreature(glow, sc, t, true);

  main.save();
  main.filter = "blur(7px)";
  main.globalCompositeOperation = "lighter";
  main.globalAlpha = 0.7;
  main.drawImage(glowCanvas, 0, 0, W, H);
  main.restore();

  for (const p of ambient.particles) {
    const px = ((((p.x + t * p.spd * 0.02 + p.drift) % 1) + 1) % 1) * W;
    const py = ((((p.y - t * p.spd * 0.012) % 1) + 1) % 1) * H;
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.6 + p.phase * 6.28));
    main.fillStyle = `rgba(200,220,235,${0.05 * tw})`;
    main.beginPath();
    main.arc(px, py, p.r * 0.7, 0, Math.PI * 2);
    main.fill();
  }

  for (const sc of ordered) drawOneCreature(main, sc, t, false);
}

// Deterministic sea layout: each rank gets a fixed scattered berth, sized by OI
// rank (biggest = largest + nearest). Positions are seeded so they never jump.
export function layoutSea(coins: string[]): Omit<SeaCreature, "drive" | "flashes" | "convulse">[] {
  const rng = mulberry32(1337);
  const n = coins.length;
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const rows = Math.ceil(n / cols);
  return coins.map((coin, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jx = rangeOf(rng, -0.5, 0.5);
    const jy = rangeOf(rng, -0.4, 0.4);
    const cx = ((col + 0.5 + jx * 0.7) / cols) * LOGICAL_W;
    const cy = (0.16 + ((row + 0.5 + jy * 0.7) / rows) * 0.7) * LOGICAL_H;
    const rank = i / Math.max(1, n - 1); // 0 = biggest
    const scale = 0.34 + 0.62 * (1 - rank); // biggest ~0.96, smallest ~0.34
    const depth = 0.45 + 0.55 * (1 - rank);
    const phase = rangeOf(rng, 0, Math.PI * 2);
    return { coin, geom: buildOrganism(i + 3), cx, cy, scale, phase, depth };
  });
}
