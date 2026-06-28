# 🐋 Leviathan

**Watch one market — BTC perp — breathe as a living creature, driven by live on-chain Hyperliquid data. Key-free, read-only, $0.**

> **v1 is live.** A breathing BTC-perp creature driven by live data, **live trades flash across its skin**, and a **recorded liquidation-cascade replay** makes it convulse — all key-free and $0.

A market rendered as a single breathing organism. Open interest is its **bulk**, funding its **color**, 24h volume its **glow**, each live trade a **flash across its skin**, and a liquidation cascade makes it **convulse**. All from Hyperliquid's **public Info API** — no API key, no login.

## Honest notes (盛らない)

- **read-only / key-free / public data only.** No signing, no orders, no key is ever handed over.
- The creature is a **metaphor for the market**, not biology.
- Funding color shows **crowding bias** (longs- vs shorts-heavy), **not** a price-direction prediction.
- The liquidation cascade (coming in v1) is a **stress scenario** — *liquidated size is a lower bound, price impact is overstated* — **not a forecast**.
- **Zero ML, zero training.** Just observation of public data and a deterministic mapping. Not investment advice.

## How it works

```
public Hyperliquid Info API ──▶ /api/hl proxy ──▶ parse + EMA smooth ──▶ creature parameters ──▶ (canvas, next)
```

- **`app/api/hl/route.ts`** — read-only proxy with a strict allowlist (`metaAndAssetCtxs`, `allMids`, `l2Book`, `predictedFundings`), 12s timeout, 10s cache. The browser can also hit the public API directly (CORS is open) — the proxy just keeps the request shape locked down.
- **`lib/hl.ts`** — parses asset contexts, EMA smoothing (the "breathing"), and a funding→body-color mapping.
- **`lib/prng.ts`** — deterministic seeded PRNG (mulberry32) for the creature's skeleton and particles, so replays are identical.
- **`lib/organism.ts`** — the Canvas-2D creature: seeded skeleton + per-frame draw with glow compositing (blur + `lighter`), live trade flashes, and the cascade convulsion.
- **`lib/hlws.ts`** — resilient browser WebSocket for live trades (auto-reconnect + 50s ping), a TS port of hl-read's stream supervisor.
- **`lib/cascade.ts` + `scripts/record-cascade.py`** — the recorded liquidation-cascade cassettes. The Python recorder (cascade math ported from hl-liqmap) sweeps real sampled positions against the live book and bakes a deterministic, scrubbable cassette per coin into `public/cascade-<COIN>.json`. The replay needs no backend and works even if the API is down.
- **`components/MarketStage.tsx`** — the live creature + the cascade stress-test panel (cassette picker, transport, verdict).

### Liquidation cascade — honest by construction

The cascade is the differentiator (no competitor ships it). Two real cassettes are recorded from the sampled positions (`scripts/data/positions.db`, 164 addresses):

- **HYPE** — ignites at −0.25% (the thin visible book is outrun by forced selling) → the creature convulses, stress escalating as you scrub deeper.
- **BTC** — **does not ignite**: the visible book absorbs the sampled flow. The creature only strains, and the verdict says so plainly.

That BTC shows "no cascade" is the point: liquidation volume is a **sampled lower bound** (164 addresses), price impact uses a **shallow book** (overstated). It is a stress scenario, never a forecast — and the UI says this on every frame.

### Data → creature mapping

| Market signal | Creature expression | Stage |
|---|---|---|
| mid pulse (EMA) | breathing (expand/contract) | v0 |
| open interest (USD) | body bulk / thickness | v0 |
| 24h volume | glow brightness / blood-flow | v0 |
| funding (signed) | body color (warm = long-heavy, cool = short-heavy) | v0 |
| trades (WS) | a flash running across the skin | v1 |
| liquidation cascade | convulsion + collapsing light | v1 (recorded replay) |
| top-OI coins | the body splits into organs (toward an ecosystem) | v2 |

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

## Tech

Next.js (App Router) · TypeScript · Canvas 2D (no WebGL) · Hyperliquid public Info API · deployed on Vercel.

The rendering core (deterministic seeded layout, glow compositing, RAF/scrub) is reused from [Mycelium](https://github.com/akagifreeez/mycelium); the data layer and resilience patterns from [hl-read](https://github.com/akagifreeez/hl-read); the liquidation-cascade model from hl-liqmap.

---

Built by [@akagifreeez](https://github.com/akagifreeez).
