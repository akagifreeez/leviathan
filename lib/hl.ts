// Helpers over Hyperliquid's PUBLIC Info API (no key, read-only) — the same data
// the author's published `hl-read` MCP server exposes as tools. Copied from
// hl-read-live and extended with EMA smoothing + a funding→color mapping that
// the creature renderer will use.

export type AssetRow = {
  name: string;
  markPx: number;
  fundingHourly: number; // per-hour funding rate (decimal)
  fundingApr: number; // annualized %
  oiUsd: number;
  dayVlm: number;
  change24h: number; // fraction
};

type Universe = { name: string; isDelisted?: boolean }[];
type AssetCtx = {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  markPx: string;
  midPx: string;
};

export function parseMetaAndAssetCtxs(raw: unknown): AssetRow[] {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const universe = (raw[0] as { universe: Universe }).universe || [];
  const ctxs = raw[1] as AssetCtx[];
  const rows: AssetRow[] = [];
  for (let i = 0; i < universe.length; i++) {
    const u = universe[i];
    const c = ctxs[i];
    if (!u || !c || u.isDelisted) continue;
    const mark = Number(c.markPx);
    const oi = Number(c.openInterest);
    const prev = Number(c.prevDayPx);
    const funding = Number(c.funding);
    if (!isFinite(mark) || !isFinite(oi)) continue;
    rows.push({
      name: u.name,
      markPx: mark,
      fundingHourly: funding,
      fundingApr: funding * 24 * 365 * 100,
      oiUsd: oi * mark,
      dayVlm: Number(c.dayNtlVlm) || 0,
      change24h: prev ? (mark - prev) / prev : 0,
    });
  }
  return rows;
}

export const topByAbsFunding = (rows: AssetRow[], n = 12) =>
  [...rows].sort((a, b) => Math.abs(b.fundingHourly) - Math.abs(a.fundingHourly)).slice(0, n);
export const topByOi = (rows: AssetRow[], n = 12) =>
  [...rows].sort((a, b) => b.oiUsd - a.oiUsd).slice(0, n);

export function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}
export const fmtPct = (frac: number, dp = 2) => `${frac >= 0 ? "+" : ""}${(frac * 100).toFixed(dp)}%`;
export const fmtApr = (apr: number) => `${apr >= 0 ? "+" : ""}${apr.toFixed(1)}%`;

// l2Book level row
export type Level = { px: number; sz: number };
export function parseL2(raw: unknown): { bids: Level[]; asks: Level[] } {
  const levels = (raw as { levels?: [{ px: string; sz: string }[], { px: string; sz: string }[]] })?.levels;
  const map = (a?: { px: string; sz: string }[]) => (a || []).map((l) => ({ px: Number(l.px), sz: Number(l.sz) }));
  return { bids: map(levels?.[0]), asks: map(levels?.[1]) };
}

// --- additions for Leviathan ---------------------------------------------

// Exponential moving average step. Smooths jittery live reads so the creature
// breathes instead of twitching. alpha in (0,1]; higher = snappier.
export function emaStep(prev: number | null | undefined, next: number, alpha = 0.2): number {
  if (prev == null || !isFinite(prev)) return next;
  return prev + alpha * (next - prev);
}

// Funding → body color temperature. Positive funding (longs pay = long-heavy)
// runs warm/red; negative (shorts pay = short-heavy) runs cool/teal; near zero
// is pale. This is an *observation of crowding bias*, NOT a price direction.
// hourlyFunding is the raw decimal (e.g. 0.0000125 ≈ 0.00125%/hr).
export function fundingRgb(hourlyFunding: number): [number, number, number] {
  // Saturate around ±0.05%/hr (a strong funding regime on HL).
  const t = Math.max(-1, Math.min(1, hourlyFunding / 0.0005));
  const neutral = [210, 222, 232]; // pale
  const warm = [255, 96, 86]; // long-heavy
  const cool = [86, 220, 200]; // short-heavy
  const target = t >= 0 ? warm : cool;
  const k = Math.abs(t);
  return neutral.map((n, i) => Math.round(n + (target[i] - n) * k)) as [number, number, number];
}

export function fundingColor(hourlyFunding: number): string {
  const c = fundingRgb(hourlyFunding);
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
