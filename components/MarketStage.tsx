"use client";

import { useEffect, useRef, useState } from "react";
import { parseMetaAndAssetCtxs, emaStep, fundingColor, fmtUsd, fmtPct, fmtApr } from "@/lib/hl";
import {
  buildOrganism,
  driveFrom,
  drawScene,
  LOGICAL_W,
  LOGICAL_H,
  FLASH_LIFE,
  type Drive,
  type Vitals,
  type Flash,
} from "@/lib/organism";
import { openTradeStream } from "@/lib/hlws";
import {
  loadCascadeIndex,
  loadCassette,
  frameAt,
  cassetteDrive,
  type Cassette,
  type CascadeIndexEntry,
} from "@/lib/cascade";

const COIN = "BTC";
const POLL_MS = 1500;
const REPLAY_SEC = 7; // full cascade sweep duration

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

type Hud = {
  markPx: number;
  oiUsd: number;
  dayVlm: number;
  fundingApr: number;
  fundingHourly: number;
  change24h: number;
};

export default function MarketStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [live, setLive] = useState(false);
  const [wsUp, setWsUp] = useState(false);
  const [ago, setAgo] = useState<number | null>(null);

  // cascade replay
  const [cassettes, setCassettes] = useState<CascadeIndexEntry[]>([]);
  const [replayCoin, setReplayCoin] = useState<string | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [readout, setReadout] = useState<{ pct: number; stress: number } | null>(null);

  const ema = useRef<Hud | null>(null);
  const target = useRef<Drive>(driveFrom(null));
  const cur = useRef<Drive>(driveFrom(null));
  const lastOk = useRef<number | null>(null);
  const startRef = useRef(0);
  const flashes = useRef<Flash[]>([]);

  const casRef = useRef<Cassette | null>(null);
  const casDriveRef = useRef<Drive | null>(null);
  const playheadRef = useRef(0);
  const replayPlayRef = useRef(false);

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
    startRef.current = performance.now();
    let lastNow = startRef.current;

    const tick = (now: number) => {
      const t = (now - startRef.current) / 1000;
      const dt = (now - lastNow) / 1000;
      lastNow = now;

      const cas = casRef.current;
      const tg = cas && casDriveRef.current ? casDriveRef.current : target.current;
      const c = cur.current;
      const k = 0.05;
      c.bulk += (tg.bulk - c.bulk) * k;
      c.glow += (tg.glow - c.glow) * k;
      c.tilt += (tg.tilt - c.tilt) * k;
      c.rgb = [
        c.rgb[0] + (tg.rgb[0] - c.rgb[0]) * k,
        c.rgb[1] + (tg.rgb[1] - c.rgb[1]) * k,
        c.rgb[2] + (tg.rgb[2] - c.rgb[2]) * k,
      ];

      if (cas) {
        if (replayPlayRef.current) {
          playheadRef.current = Math.min(1, playheadRef.current + dt / REPLAY_SEC);
          if (playheadRef.current >= 1) replayPlayRef.current = false;
        }
        const f = frameAt(cas, playheadRef.current);
        drawScene(ctx, glow, t, c, geom, [], { stress: f.stress, exhausted: f.exhausted });
      } else {
        const fx = flashes.current;
        while (fx.length && t - fx[0].t0 > FLASH_LIFE) fx.shift();
        drawScene(ctx, glow, t, c, geom, fx);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // live trades → skin flashes
  useEffect(() => {
    const stop = openTradeStream({
      coin: COIN,
      onStatus: (up) => setWsUp(up),
      onTrade: (tr) => {
        if (!startRef.current || casRef.current) return; // skip during replay
        const notional = tr.px * tr.sz;
        const mag = clamp01((Math.log10(Math.max(notional, 1)) - 2) / 4);
        const t0 = (performance.now() - startRef.current) / 1000;
        const fx = flashes.current;
        fx.push({ t0, side: tr.side, mag, lane: Math.random() });
        if (fx.length > 240) fx.splice(0, fx.length - 240);
      },
    });
    return stop;
  }, []);

  // live vitals poll
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
        if (!stopped) setLive(false);
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

  // load cassette index once
  useEffect(() => {
    loadCascadeIndex()
      .then(setCassettes)
      .catch(() => setCassettes([]));
  }, []);

  // reconcile UI readout + slider from refs (no 60fps re-renders)
  useEffect(() => {
    const id = setInterval(() => {
      if (casRef.current) {
        const f = frameAt(casRef.current, playheadRef.current);
        setReadout({ pct: f.pct, stress: f.stress });
        setReplayPlaying(replayPlayRef.current);
        if (sliderRef.current && document.activeElement !== sliderRef.current) {
          sliderRef.current.value = String(playheadRef.current);
        }
      }
    }, 120);
    return () => clearInterval(id);
  }, []);

  async function selectCassette(coin: string) {
    try {
      const cas = await loadCassette(coin);
      casRef.current = cas;
      casDriveRef.current = cassetteDrive(cas);
      playheadRef.current = 0;
      replayPlayRef.current = true;
      setReplayCoin(coin);
      setReplayPlaying(true);
    } catch {
      /* ignore */
    }
  }
  function exitReplay() {
    casRef.current = null;
    casDriveRef.current = null;
    replayPlayRef.current = false;
    setReplayCoin(null);
    setReplayPlaying(false);
    setReadout(null);
  }
  function toggleReplay() {
    if (!casRef.current) return;
    if (playheadRef.current >= 1) playheadRef.current = 0; // restart from end
    replayPlayRef.current = !replayPlayRef.current;
    setReplayPlaying(replayPlayRef.current);
  }
  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    playheadRef.current = parseFloat(e.target.value);
    replayPlayRef.current = false;
    setReplayPlaying(false);
  }

  const color = hud ? fundingColor(hud.fundingHourly) : "#3a4150";
  const longHeavy = (hud?.fundingHourly ?? 0) >= 0;
  const activeCas = cassettes.find((c) => c.coin === replayCoin);

  return (
    <div className="vitalswrap">
      <div className="stagewrap">
        <canvas
          ref={canvasRef}
          className="stage"
          aria-label="A market rendered as a living, breathing creature"
        />
        <div className="livebadge">
          {replayCoin ? (
            <>
              <span className="dot rec" />
              録画再生 · {replayCoin} 清算カスケード（ストレス試算／予測ではない）
            </>
          ) : (
            <>
              <span className={`dot ${live ? "on" : ""}`} />
              {live ? "LIVE · BTC-PERP" : "再接続中…"}
              {ago != null ? ` · ${ago}s` : ""}
              <span className="sep" />
              <span className={`dot ${wsUp ? "on" : ""}`} />
              {wsUp ? "約定WS" : "WS再接続…"}
            </>
          )}
        </div>
      </div>

      {/* cascade replay controls */}
      <div className="cascade">
        <div className="cascade-head">
          <span className="cascade-title">清算カスケード ストレステスト</span>
          <span className="cascade-sub">
            実ポジション（標本）の清算価格を実板に通し、連鎖を試算 — 競合未実装の固有機能
          </span>
        </div>
        <div className="cascade-row">
          {cassettes.map((c) => (
            <button
              key={c.coin}
              className={`casbtn ${replayCoin === c.coin ? "active" : ""}`}
              onClick={() => selectCassette(c.coin)}
            >
              {c.coin}
              <span className="tag">
                {c.ignited ? `点火 −${c.ignitionPct}%` : "板が吸収（点火せず）"}
              </span>
            </button>
          ))}
          {replayCoin && (
            <button className="casbtn ghost" onClick={exitReplay}>
              ← ライブに戻る
            </button>
          )}
        </div>

        {replayCoin && (
          <div className="transport">
            <button onClick={toggleReplay} aria-label={replayPlaying ? "一時停止" : "再生"}>
              {replayPlaying ? "❚❚" : "▶"}
            </button>
            <input
              ref={sliderRef}
              className="scrub"
              type="range"
              min={0}
              max={1}
              step={0.001}
              defaultValue={0}
              onChange={onScrub}
              aria-label="カスケードのタイムライン"
            />
            <span className="readout">
              {readout ? `−${readout.pct.toFixed(2)}%` : "—"} ·{" "}
              <span style={{ color: (readout?.stress ?? 0) >= 1 ? "#ff6b56" : "#8b96a6" }}>
                応力 ×{(readout?.stress ?? 0).toFixed(2)}
              </span>
            </span>
          </div>
        )}

        {replayCoin && activeCas && (
          <div className="verdict">
            <b>{replayCoin}</b> ·{" "}
            {activeCas.ignited
              ? `−${activeCas.ignitionPct}%で点火${activeCas.bookExhausted ? "、可視板を食い尽くす" : ""}`
              : "可視板が標本清算フローを吸収＝自己強化カスケードなし"}
            <span className="caveat">
              清算量＝標本(164アドレス)の下限・価格影響＝可視板で過大。ストレス試算であり予測ではない。
            </span>
          </div>
        )}
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

      <div className="flashlegend">
        体表を走る光＝<b>ライブ約定</b>：
        <span className="swatch" style={{ background: "rgb(255,176,92)" }} /> 買い（上へ）
        <span className="swatch" style={{ background: "rgb(108,200,255)" }} /> 売り（下へ）
        ／ 大きさ＝約定サイズ。痙攣＝清算カスケード（上のストレステスト）。
      </div>
    </div>
  );
}
