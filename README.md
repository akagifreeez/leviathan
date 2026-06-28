# 🐋 Leviathan

**Watch one market — BTC perp — breathe as a living creature, driven by live on-chain Hyperliquid data. Key-free, read-only, $0.**

> ⚠️ Work in progress. **v0 is live: the data conduit.** The browser pulls BTC's vitals every 1.5s and maps them to the creature's parameters. The creature canvas itself is the next milestone.

A market rendered as a single breathing organism. Open interest is its **bulk**, funding its **color**, 24h volume its **glow**, and (coming next) a liquidation cascade makes it **convulse**. All from Hyperliquid's **public Info API** — no API key, no login.

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
- **`components/Vitals.tsx`** — v0 live conduit: poll → smooth → show vitals. The creature renderer reads these same smoothed values next.

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
