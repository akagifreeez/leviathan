"use client";

import { useEffect, useRef, useState } from "react";
import { parseMetaAndAssetCtxs, emaStep, fundingColor, fmtUsd, fmtPct, fmtApr } from "@/lib/hl";
import {
  buildOrganism,
  driveFrom,
  drawScene,
  LOGICAL_W,
  LOGICAL_H,
  type Drive,
  type Vitals,
} from "@/lib/organism";

const COIN = "BTC";
const POLL_MS = 1500;

type Hud = {
  markPx: number;
  oiUsd: number;
  dayVlm: number;
  fundingApr: number;
  fundingHourly: number;
  change24h: number;
};

// The live creature. Two loops run independently:
//  - a 1.5s poll that reads BTC's vitals, EMA-smooths them, and sets a *target*
//    drive (bulk / glow / color / tilt);
//  - a RAF loop that eases the current drive toward the target every frame and
//    renders the creature (breathing comes from wall-clock, so it never stalls).
// On a failed poll we keep the last reading — the creature keeps breathing.
export default function MarketStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [live, setLive] = useState(false);
  const [ago, setAgo] = useState<number | null>(null);

  const ema = useRef<Hud | null>(null);
  const target = useRef<Drive>(driveFrom(null));
  const cur = useRef<Drive>(driveFrom(null));
  const lastOk = useRef<number | null>(null);

  // render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = LOGICAL_W * dpr;
    canvas.height = LOGICAL_H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const glow = document.createElement("canvas");
    glow.width = LOGICAL_W;
    glow.height = LOGICAL_H;
    const geom = buildOrganism(7);

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const c = cur.current;
      const tg = target.current;
      const k = 0.05; // ease toward target (~0.3s glide between 1.5s polls)
      c.bulk += (tg.bulk - c.bulk) * k;
      c.glow += (tg.glow - c.glow) * k;
      c.tilt += (tg.tilt - c.tilt) * k;
      c.rgb = [
        c.rgb[0] + (tg.rgb[0] - c.rgb[0]) * k,
        c.rgb[1] + (tg.rgb[1] - c.rgb[1]) * k,
        c.rgb[2] + (tg.rgb[2] - c.rgb[2]) * k,
      ];
      drawScene(ctx, glow, t, c, geom);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // poll loop
  useEffect(() => {
    let stopped = false;
    let ctrl: AbortController | null = null;

    async function poll() {
      ctrl = new AbortController();
      try {
        const res = await fetch("/api/hl", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "metaAndAssetCtxs" }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`proxy ${res.status}`);
        const j = await res.json();
        const row = parseMetaAndAssetCtxs(j.data).find((r) => r.name === COIN);
        if (stopped || !row) return;
        const p = ema.current;
        const next: Hud = {
          markPx: emaStep(p?.markPx, row.markPx, 0.25),
          oiUsd: emaStep(p?.oiUsd, row.oiUsd, 0.15),
          dayVlm: emaStep(p?.dayVlm, row.dayVlm, 0.15),
          fundingApr: emaStep(p?.fundingApr, row.fundingApr, 0.1),
          fundingHourly: emaStep(p?.fundingHourly, row.fundingHourly, 0.1),
          change24h: emaStep(p?.change24h, row.change24h, 0.2),
        };
        ema.current = next;
        target.current = driveFrom(next as Vitals);
        setHud(next);
        setLive(true);
        lastOk.current = Date.now();
      } catch {
        if (!stopped) setLive(false); // keep last drive → creature keeps breathing
      }
    }

    poll();
    const pid = setInterval(poll, POLL_MS);
    const aid = setInterval(() => {
      if (lastOk.current) setAgo(Math.round((Date.now() - lastOk.current) / 1000));
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(pid);
      clearInterval(aid);
      ctrl?.abort();
    };
  }, []);

  const color = hud ? fundingColor(hud.fundingHourly) : "#3a4150";
  const longHeavy = (hud?.fundingHourly ?? 0) >= 0;

  return (
    <div className="vitalswrap">
      <div className="stagewrap">
        <canvas
          ref={canvasRef}
          className="stage"
          aria-label="BTC perp market rendered as a living, breathing creature"
        />
        <div className="livebadge">
          <span className={`dot ${live ? "on" : ""}`} />
          {live ? "LIVE · BTC-PERP" : "再接続中…"}
          {ago != null ? ` · ${ago}s` : ""}
        </div>
      </div>

      <div className="vitals">
        <div className="vital">
          <div className="k">Mark 価格</div>
          <div className="val">{hud ? fmtUsd(hud.markPx) : "—"}</div>
          <div className={`sub ${hud && hud.change24h >= 0 ? "up" : "down"}`}>
            {hud ? `24h ${fmtPct(hud.change24h)}` : " "}
          </div>
        </div>
        <div className="vital">
          <div className="k">建玉 OI → 胴体の太さ</div>
          <div className="val">{hud ? fmtUsd(hud.oiUsd) : "—"}</div>
          <div className="sub">大きいほど太く重い体</div>
        </div>
        <div className="vital">
          <div className="k">24h 出来高 → 発光</div>
          <div className="val">{hud ? fmtUsd(hud.dayVlm) : "—"}</div>
          <div className="sub">血流の明るさ・流速</div>
        </div>
        <div className="vital">
          <div className="k">Funding → 体色</div>
          <div className="val" style={{ color }}>
            {hud ? fmtApr(hud.fundingApr) : "—"}
          </div>
          <div className="sub">
            <span className="swatch" style={{ background: color }} />
            {hud ? (longHeavy ? "ロング過熱（暖色）" : "ショート過熱（寒色）") : " "}
          </div>
        </div>
      </div>
    </div>
  );
}
