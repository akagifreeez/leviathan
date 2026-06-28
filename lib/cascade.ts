// Recorded liquidation-cascade cassettes (see scripts/record-cascade.py).
// Deterministic, replayable, $0 — the data is baked, so the replay works even
// if the live API is down. Cascade math is ported from the author's hl-liqmap.
import { driveFrom, type Drive, type Vitals } from "@/lib/organism";

export type CascadeFrame = {
  pct: number;
  price: number;
  liqUsd: number;
  bookUsd: number;
  stress: number; // real cum_liquidations / cum_book at this level (≥1 = ignition)
  exhausted: boolean;
};

export type Cassette = {
  coin: string;
  direction: string;
  mark: number;
  sampledAt: string;
  positionsConsidered: number;
  totalBook: number;
  drive: { oiUsd: number; dayVlm: number; fundingHourly: number };
  maxPct: number;
  step: number;
  ignited: boolean;
  ignitionPct: number | null;
  exhaustPct: number | null;
  peakPct: number;
  peakStress: number;
  bookExhausted: boolean;
  liquidatedUsd: number;
  verdict: string;
  note: string;
  frames: CascadeFrame[];
};

export type CascadeIndexEntry = {
  coin: string;
  ignited: boolean;
  ignitionPct: number | null;
  peakPct: number;
  bookExhausted: boolean;
  positionsConsidered: number;
  sampledAt: string;
};

export async function loadCascadeIndex(): Promise<CascadeIndexEntry[]> {
  const r = await fetch("/cascades.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`index ${r.status}`);
  return (await r.json()).cassettes as CascadeIndexEntry[];
}

export async function loadCassette(coin: string): Promise<Cassette> {
  const r = await fetch(`/cascade-${coin}.json`, { cache: "no-store" });
  if (!r.ok) throw new Error(`cassette ${r.status}`);
  return (await r.json()) as Cassette;
}

export function frameAt(cas: Cassette, playhead: number): CascadeFrame {
  const n = cas.frames.length;
  if (!n) return { pct: 0, price: cas.mark, liqUsd: 0, bookUsd: 0, stress: 0, exhausted: false };
  const i = Math.max(0, Math.min(n - 1, Math.round(playhead * (n - 1))));
  return cas.frames[i];
}

// The creature should *look like* the cassette's coin during replay.
export function cassetteDrive(cas: Cassette): Drive {
  const v: Vitals = {
    markPx: cas.mark,
    oiUsd: cas.drive.oiUsd,
    dayVlm: cas.drive.dayVlm,
    fundingHourly: cas.drive.fundingHourly,
    fundingApr: cas.drive.fundingHourly * 24 * 365 * 100,
    change24h: 0,
  };
  return driveFrom(v);
}
