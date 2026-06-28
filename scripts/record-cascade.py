#!/usr/bin/env python3
"""Record a liquidation-cascade cassette for the Leviathan replay.

The cascade math is ported from the author's hl-liqmap (liqmap/simulate.py).
What is DATA vs MODEL, stated up front because honesty is the whole pitch:

  * Liquidation VOLUME is data — the cumulative notional whose real sampled
    liquidation prices are reached by a given price level. It is a SAMPLE
    (positions.db = 164 sampled addresses), so it is a LOWER BOUND.
  * Price IMPACT is a model — we walk the *current visible* order book, which
    market makers refill in reality, so it OVERSTATES impact.
  The two biases point opposite ways. The cassette is a stress scenario, never
  a forecast. We bake those words into the cassette so the UI always shows them.

Output: public/cascade-<COIN>.json (a deterministic, replayable cassette) and
public/cascades.json (the index the UI reads). No key, public Info API only.

Usage:  python scripts/record-cascade.py HYPE BTC
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import urllib.request
from datetime import datetime, timezone

HL = "https://api.hyperliquid.xyz/info"
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "data", "positions.db")
OUT = os.path.join(HERE, "..", "public")
MAX_PCT = 15.0
STEP = 0.25


def info(payload: dict) -> object:
    req = urllib.request.Request(
        HL, data=json.dumps(payload).encode(), headers={"content-type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def load_positions(coin: str) -> list[dict]:
    c = sqlite3.connect(DB)
    cols = ["coin", "size", "side", "liq_px"]
    rows = [dict(zip(cols, r)) for r in c.execute(
        f'SELECT {",".join(cols)} FROM positions WHERE coin=?', (coin,))]
    c.close()
    return rows


def valid_longs(rows: list[dict], mark: float) -> list[dict]:
    out = []
    for r in rows:
        if r["side"] != "long":
            continue
        liq, size = r["liq_px"], r.get("size") or 0.0
        if not liq or liq <= 0 or size == 0:
            continue
        out.append({"liq_px": liq, "notional": abs(size) * mark})
    return out


def asset_ctx(coin: str) -> dict:
    raw = info({"type": "metaAndAssetCtxs"})
    uni = raw[0]["universe"]
    for i, u in enumerate(uni):
        if u["name"] == coin:
            c = raw[1][i]
            mark = float(c["markPx"])
            return {
                "markPx": mark,
                "oiUsd": float(c["openInterest"]) * mark,
                "dayVlm": float(c.get("dayNtlVlm") or 0),
                "fundingHourly": float(c["funding"]),
            }
    raise SystemExit(f"{coin} not found in universe")


def record(coin: str) -> dict:
    ctx = asset_ctx(coin)
    l2 = info({"type": "l2Book", "coin": coin})
    lv = l2["levels"]
    bids = [{"px": float(x["px"]), "sz": float(x["sz"])} for x in lv[0]]
    mark = ctx["markPx"]
    longs = valid_longs(load_positions(coin), mark)
    total_book = sum(b["px"] * b["sz"] for b in bids)

    # Record the FULL ladder (we do NOT stop at exhaustion) so the replay has a
    # scrubbable descent: stress builds level by level. Each frame carries the
    # real cum_liq/cum_book ratio + whether the visible book is exhausted by then.
    frames = []
    ignited = exhausted = False
    ignition_pct = None
    exhaust_pct = None
    peak_pct = 0.0
    peak_stress = 0.0
    liquidated = 0.0
    steps = int(MAX_PCT / STEP)
    for i in range(1, steps + 1):
        pct = round(i * STEP, 4)
        p = mark * (1 - pct / 100)
        cum_liq = sum(r["notional"] for r in longs if r["liq_px"] >= p)
        cum_book = sum(b["px"] * b["sz"] for b in bids if b["px"] >= p)
        stress = (cum_liq / cum_book) if cum_book > 0 else (2.0 if cum_liq > 0 else 0.0)
        frame_exhausted = cum_book >= total_book - 1e-9 and cum_liq > 0
        frames.append({
            "pct": pct, "price": round(p, 6),
            "liqUsd": round(cum_liq, 2), "bookUsd": round(cum_book, 2),
            "stress": round(stress, 4), "exhausted": bool(frame_exhausted and cum_liq > cum_book),
        })
        peak_stress = max(peak_stress, stress)
        if cum_liq > cum_book:
            if not ignited:
                ignited, ignition_pct = True, pct
            peak_pct, liquidated = pct, cum_liq
            if frame_exhausted and not exhausted:
                exhausted, exhaust_pct = True, pct

    if not ignited:
        verdict_text = (
            f"自己強化カスケードなし（−{MAX_PCT:.0f}%以内）：可視板が標本清算フローを吸収。"
        )
    elif exhausted:
        verdict_text = (
            f"−{ignition_pct:.2f}%で点火 → −{exhaust_pct:.2f}%で可視板を食い尽くす"
            f"（${liquidated/1e6:,.2f}M 清算）。真の下落は可視流動性の先（モデルの限界）。"
        )
    else:
        verdict_text = (
            f"−{ignition_pct:.2f}%で点火（${liquidated/1e6:,.2f}M 清算）。"
        )

    return {
        "coin": coin,
        "direction": "down",
        "mark": round(mark, 6),
        "sampledAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "positionsConsidered": len(longs),
        "totalBook": round(total_book, 2),
        "drive": {
            "oiUsd": round(ctx["oiUsd"], 2),
            "dayVlm": round(ctx["dayVlm"], 2),
            "fundingHourly": ctx["fundingHourly"],
        },
        "maxPct": MAX_PCT,
        "step": STEP,
        "ignited": ignited,
        "ignitionPct": ignition_pct,
        "exhaustPct": exhaust_pct,
        "peakPct": peak_pct,
        "peakStress": round(peak_stress, 4),
        "bookExhausted": exhausted,
        "liquidatedUsd": round(liquidated, 2),
        "verdict": verdict_text,
        "note": "清算量＝標本(164アドレス)の下限・価格影響＝可視板で過大。ストレス試算であり予測ではない。",
        "frames": frames,
    }


def main():
    coins = sys.argv[1:] or ["HYPE", "BTC"]
    os.makedirs(OUT, exist_ok=True)
    index = []
    for coin in coins:
        cas = record(coin)
        path = os.path.join(OUT, f"cascade-{coin}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cas, f, ensure_ascii=False, separators=(",", ":"))
        index.append({
            "coin": coin,
            "ignited": cas["ignited"],
            "ignitionPct": cas["ignitionPct"],
            "peakPct": cas["peakPct"],
            "bookExhausted": cas["bookExhausted"],
            "positionsConsidered": cas["positionsConsidered"],
            "sampledAt": cas["sampledAt"],
        })
        print(f"  {coin}: ignited={cas['ignited']} ignite={cas['ignitionPct']} "
              f"peak={cas['peakPct']} exhausted={cas['bookExhausted']} "
              f"pos={cas['positionsConsidered']} -> {os.path.relpath(path)}")
    with open(os.path.join(OUT, "cascades.json"), "w", encoding="utf-8") as f:
        json.dump({"cassettes": index}, f, ensure_ascii=False, indent=2)
    print(f"wrote {len(index)} cassette(s) + index")


if __name__ == "__main__":
    main()
