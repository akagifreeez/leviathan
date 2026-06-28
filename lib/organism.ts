// Leviathan creature renderer — Canvas 2D only (no WebGL). Reuses Mycelium's
// proven approach: a logical-sized glow canvas drawn behind a crisp layer with
// blur + "lighter" compositing, and a seeded PRNG so the skeleton is identical
// every render. The creature's *shape* is deterministic; its *drive* (size,
// color, glow, breathing) comes from live, smoothed market vitals.
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

// Normalized 0..1 drive values, so rendering is stable regardless of absolute $.
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
    tilt: Math.max(-1, Math.min(1, v.change24h * 12)), // ~±8% saturates
  };
}

type Tentacle = { rim: number; len: number; phase: number; curl: number; width: number; waves: number };
type Particle = { x: number; y: number; r: number; phase: number; drift: number; spd: number };
export type Geom = { tentacles: Tentacle[]; arms: Tentacle[]; particles: Particle[] };

export function buildOrganism(seed = 7): Geom {
  const rng = mulberry32(seed);
  const tentacles: Tentacle[] = [];
  const N = 24;
  for (let i = 0; i < N; i++) {
    tentacles.push({
      rim: (i / (N - 1)) * 2 - 1, // -1..1 across the bell rim
      len: rangeOf(rng, 0.65, 1.15),
      phase: rangeOf(rng, 0, Math.PI * 2),
      curl: rangeOf(rng, -0.6, 0.6),
      width: rangeOf(rng, 0.6, 1.3),
      waves: rangeOf(rng, 1.4, 2.6),
    });
  }
  const arms: Tentacle[] = [];
  for (let i = 0; i < 6; i++) {
    arms.push({
      rim: ((i / 5) * 2 - 1) * 0.5,
      len: rangeOf(rng, 0.5, 0.85),
      phase: rangeOf(rng, 0, Math.PI * 2),
      curl: rangeOf(rng, -0.3, 0.3),
      width: rangeOf(rng, 1.8, 2.8),
      waves: rangeOf(rng, 1.0, 1.8),
    });
  }
  const particles: Particle[] = [];
  for (let i = 0; i < 80; i++) {
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
  const segs = 16;
  const swaySpeed = 1.1;
  const swayAmp = (9 + 20 * contraction) * (0.6 + 0.5 * tn.width);
  let px = x0;
  let py = y0;
  c.lineCap = "round";
  for (let i = 1; i <= segs; i++) {
    const f = i / segs;
    const pf = (i - 1) / segs;
    const sway = Math.sin(t * swaySpeed + tn.phase + f * tn.waves * Math.PI) * swayAmp * f;
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

function bellPath(c: CanvasRenderingContext2D, cx: number, cy: number, bw: number, bh: number) {
  c.beginPath();
  c.moveTo(cx - bw, cy);
  c.bezierCurveTo(cx - bw, cy - bh * 1.6, cx + bw, cy - bh * 1.6, cx + bw, cy);
  c.quadraticCurveTo(cx, cy + bh * 0.5, cx - bw, cy);
  c.closePath();
}

function drawCreature(
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
  glowPass: boolean
) {
  const a = glowPass ? 0.6 : 1.0;
  const baseW = 0.8 + 1.2 * drive.bulk;

  // tentacles (behind the bell)
  for (const tn of geom.tentacles) {
    drawStrand(c, cx + tn.rim * bw * 0.92, rimY, t, tn, tentLen * tn.len, baseW, contraction, rgb, 0.8 * a, glowPass);
  }
  // oral arms (center, thicker)
  for (const ar of geom.arms) {
    drawStrand(c, cx + ar.rim * bw * 0.5, rimY - 4, t, ar, tentLen * ar.len, baseW, contraction, rgb, 0.9 * a, glowPass);
  }

  // bell
  const grd = c.createRadialGradient(cx, cy - bh * 0.2, bh * 0.12, cx, cy, bw);
  grd.addColorStop(0, rgba(brighten(rgb, 0.25), (glowPass ? 0.5 : 0.5) * a));
  grd.addColorStop(0.6, rgba(rgb, (glowPass ? 0.28 : 0.2) * a));
  grd.addColorStop(1, rgba(rgb, 0));
  bellPath(c, cx, cy, bw, bh);
  c.fillStyle = grd;
  c.fill();
  c.lineWidth = glowPass ? 4 : 2;
  c.strokeStyle = rgba(rgb, (glowPass ? 0.5 : 0.9) * a);
  c.stroke();

  // inner muscle arcs (faint)
  for (let k = 1; k <= 3; k++) {
    const r = (k / 4) * bw;
    c.beginPath();
    c.ellipse(cx, cy - bh * 0.1, r, r * (bh / bw) * 1.1, 0, Math.PI, Math.PI * 2);
    c.lineWidth = glowPass ? 2 : 1;
    c.strokeStyle = rgba(rgb, (glowPass ? 0.18 : 0.16) * a * (1 - k / 4));
    c.stroke();
  }

  // bioluminescent rim dots
  const dots = 22;
  const lit = brighten(rgb, 0.4);
  for (let i = 0; i <= dots; i++) {
    const f = i / dots;
    const x = cx + (f * 2 - 1) * bw;
    const y = rimY - Math.cos(f * Math.PI) * 2;
    const tw = 0.5 + 0.5 * Math.sin(t * 2 + i * 0.6);
    const rad = (glowPass ? 2.6 : 1.3) * (0.6 + 0.7 * tw);
    c.fillStyle = rgba(lit, (glowPass ? 0.5 : 0.9) * (0.4 + 0.6 * tw) * (0.5 + 0.5 * drive.glow));
    c.beginPath();
    c.arc(x, y, rad, 0, Math.PI * 2);
    c.fill();
  }
}

export function drawScene(
  main: CanvasRenderingContext2D,
  glowCanvas: HTMLCanvasElement,
  t: number,
  drive: Drive,
  geom: Geom
) {
  const W = LOGICAL_W;
  const H = LOGICAL_H;
  const glow = glowCanvas.getContext("2d");
  if (!glow) return;

  // deep-sea background (opaque) on main
  const bg = main.createRadialGradient(W * 0.5, H * 0.32, 60, W * 0.5, H * 0.5, H * 0.95);
  bg.addColorStop(0, "#0a1622");
  bg.addColorStop(0.5, "#060c14");
  bg.addColorStop(1, "#03060a");
  main.fillStyle = bg;
  main.fillRect(0, 0, W, H);
  glow.clearRect(0, 0, W, H);

  // breathing (jellyfish swim): contract = narrower + taller, then relax
  const breath = Math.sin(t * 1.05); // -1..1
  const contraction = Math.max(0, breath); // 0..1
  const cx = W * 0.5;
  const cy = H * 0.36 - drive.tilt * 18 + Math.sin(t * 1.05 - 0.4) * 10;
  const bw = (150 + 120 * drive.bulk) * (1 - 0.1 * breath);
  const bh = (84 + 64 * drive.bulk) * (1 + 0.16 * breath);
  const rimY = cy + bh * 0.3;
  const tentLen = 150 + 230 * drive.bulk;
  const rgb = drive.rgb;

  // plankton on glow (so it blooms), tinted by the creature
  for (const p of geom.particles) {
    const px = ((((p.x + t * p.spd * 0.02 + p.drift) % 1) + 1) % 1) * W;
    const py = ((((p.y - t * p.spd * 0.012) % 1) + 1) % 1) * H;
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.6 + p.phase * 6.28));
    glow.fillStyle = rgba(rgb, 0.1 * tw * (0.5 + drive.glow));
    glow.beginPath();
    glow.arc(px, py, p.r * 2, 0, Math.PI * 2);
    glow.fill();
  }

  // creature on glow (bright, to be blurred)
  drawCreature(glow, cx, cy, bw, bh, rimY, t, contraction, tentLen, rgb, drive, geom, true);

  // composite blurred glow behind the crisp layer
  main.save();
  main.filter = `blur(${6 + 7 * drive.glow}px)`;
  main.globalCompositeOperation = "lighter";
  main.globalAlpha = 0.55 + 0.45 * drive.glow;
  main.drawImage(glowCanvas, 0, 0, W, H);
  main.restore();

  // faint crisp plankton on main
  for (const p of geom.particles) {
    const px = ((((p.x + t * p.spd * 0.02 + p.drift) % 1) + 1) % 1) * W;
    const py = ((((p.y - t * p.spd * 0.012) % 1) + 1) % 1) * H;
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.6 + p.phase * 6.28));
    main.fillStyle = `rgba(200,220,235,${0.07 * tw})`;
    main.beginPath();
    main.arc(px, py, p.r * 0.8, 0, Math.PI * 2);
    main.fill();
  }

  // creature crisp on main
  drawCreature(main, cx, cy, bw, bh, rimY, t, contraction, tentLen, rgb, drive, geom, false);
}
