"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseMetaAndAssetCtxs,
  emaStep,
  fundingColor,
  fmtUsd,
  fmtPct,
  fmtApr,
  type AssetRow,
} from "@/lib/hl";

const COIN = "BTC";
const POLL_MS = 1500;

type Vitals = {
  markPx: number;
  oiUsd: number;
  dayVlm: number;
  fundingApr: number;
  fundingHourly: number;
  change24h: number;
};

async function fetchCoin(signal: AbortSignal): Promise<AssetRow | null> {
  const res = await fetch("/api/hl", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    signal,
  });
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  const json = await res.json();
  const rows = parseMetaAndAssetCtxs(json.data);
  return rows.find((r) => r.name === COIN) ?? null;
}

// v0 — the live data conduit. We poll BTC's vitals every 1.5s, smooth them with
// an EMA (the "breathing"), and show them as text. The creature canvas reads the
// exact same smoothed values next; for now this proves the data flows, $0, in
// the browser. On error we keep the last reading — the organism keeps breathing.
export default function Vitals() {
  const [v, setV] = useState<Vitals | null>(null);
  const [live, setLive] = useState(false);
  const [ago, setAgo] = useState<number | null>(null);
  const ema = useRef<Vitals | null>(null);
  const lastOk = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    let ctrl: AbortController | null = null;

    async function tick() {
      ctrl = new AbortController();
      try {
        const row = await fetchCoin(ctrl.signal);
        if (stopped || !row) return;
        const p = ema.current;
        const next: Vitals = {
          markPx: emaStep(p?.markPx, row.markPx, 0.25),
          oiUsd: emaStep(p?.oiUsd, row.oiUsd, 0.15),
          dayVlm: emaStep(p?.dayVlm, row.dayVlm, 0.15),
          fundingApr: emaStep(p?.fundingApr, row.fundingApr, 0.1),
          fundingHourly: emaStep(p?.fundingHourly, row.fundingHourly, 0.1),
          change24h: emaStep(p?.change24h, row.change24h, 0.2),
        };
        ema.current = next;
        setV(next);
        setLive(true);
        lastOk.current = Date.now();
      } catch {
        if (!stopped) setLive(false); // keep last value on screen
      }
    }

    tick();
    const pollId = setInterval(tick, POLL_MS);
    const agoId = setInterval(() => {
      if (lastOk.current) setAgo(Math.round((Date.now() - lastOk.current) / 1000));
    }, 1000);

    return () => {
      stopped = true;
      clearInterval(pollId);
      clearInterval(agoId);
      ctrl?.abort();
    };
  }, []);

  const color = v ? fundingColor(v.fundingHourly) : "#3a4150";
  const longHeavy = (v?.fundingHourly ?? 0) >= 0;

  return (
    <div className="vitalswrap">
      <div className="vitals-head">
        <span className={`dot ${live ? "on" : ""}`} />
        <span className="coin">{COIN}-PERP</span>
        <span>Hyperliquid · 公開Info API · 鍵不要</span>
        <span className="spacer" />
        <span>
          {live ? "ライブ" : "再接続中…"}
          {ago != null ? ` · ${ago}s前に更新` : ""}
        </span>
      </div>

      <div className="vitals">
        <div className="vital">
          <div className="k">Mark 価格</div>
          <div className="val">{v ? fmtUsd(v.markPx) : "—"}</div>
          <div className={`sub ${v && v.change24h >= 0 ? "up" : "down"}`}>
            {v ? `24h ${fmtPct(v.change24h)}` : " "}
          </div>
        </div>

        <div className="vital">
          <div className="k">建玉 OI（→ 胴体の太さ）</div>
          <div className="val">{v ? fmtUsd(v.oiUsd) : "—"}</div>
          <div className="sub">大きいほど太く重い体</div>
        </div>

        <div className="vital">
          <div className="k">24h 出来高（→ 発光）</div>
          <div className="val">{v ? fmtUsd(v.dayVlm) : "—"}</div>
          <div className="sub">血流の明るさ・流速</div>
        </div>

        <div className="vital">
          <div className="k">Funding（→ 体色）</div>
          <div className="val" style={{ color }}>
            {v ? fmtApr(v.fundingApr) : "—"}
          </div>
          <div className="sub">
            <span className="swatch" style={{ background: color }} />
            {v ? (longHeavy ? "ロング過熱（暖色）" : "ショート過熱（寒色）") : " "}
          </div>
        </div>
      </div>

      <div className="placeholder">
        ✅ <b>v0：データ疎通</b>。ブラウザが <code>metaAndAssetCtxs</code> を1.5秒ごとに取得→EMA平滑→
        生物パラメータに対応づけ済み。次の段階でこの値を <code>drawOrganism()</code> に流し、
        暗い深海に脈打つ生物として描画します（描画はまだ未実装）。
      </div>
    </div>
  );
}
