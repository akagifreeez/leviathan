"use client";

import { useEffect, useRef, useState } from "react";
import { parseMetaAndAssetCtxs, fundingColor, fmtUsd, fmtPct, fmtApr, topByOi, type AssetRow } from "@/lib/hl";
import {
  buildOrganism,
  driveFrom,
  drawSea,
  layoutSea,
  LOGICAL_W,
  LOGICAL_H,
  FLASH_LIFE,
  type Drive,
  type Vitals,
  type Flash,
  type SeaCreature,
} from "@/lib/organism";
import { openTradeStream } from "@/lib/hlws";
import { loadCascadeIndex, loadCassette, frameAt, type Cassette, type CascadeIndexEntry } from "@/lib/cascade";

const POLL_MS = 1500;
const TOP_N = 12; // creatures in the sea
const TRADE_N = 6; // coins we open live trades for
const REPLAY_SEC = 7;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

type Hud = { coin: string; markPx: number; oiUsd: number; dayVlm: number; fundingApr: number; fundingHourly: number; change24h: number };
type SeaEntry = {
  coin: string;
  geom: ReturnType<typeof buildOrganism>;
  cx: number;
  cy: number;
  scale: number;
  phase: number;
  depth: number;
  cur: Drive;
  target: Drive;
  flashes: Flash[];
};

const toVit = (r: AssetRow): Vitals => ({
  markPx: r.markPx,
  oiUsd: r.oiUsd,
  dayVlm: r.dayVlm,
  fundingHourly: r.fundingHourly,
  fundingApr: r.fundingApr,
  change24h: r.change24h,
});
const toHud = (r: AssetRow): Hud => ({
  coin: r.name,
  markPx: r.markPx,
  oiUsd: r.oiUsd,
  dayVlm: r.dayVlm,
  fundingApr: r.fundingApr,
  fundingHourly: r.fundingHourly,
  change24h: r.change24h,
});

export default function MarketStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const [focusHud, setFocusHud] = useState<Hud | null>(null);
  const [live, setLive] = useState(false);
  const [wsUp, setWsUp] = useState(false);
  const [ago, setAgo] = useState<number | null>(null);
  const [tradeCoins, setTradeCoins] = useState<string[]>([]);

  const [cassettes, setCassettes] = useState<CascadeIndexEntry[]>([]);
  const [replayCoin, setReplayCoin] = useState<string | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [readout, setReadout] = useState<{ pct: number; stress: number } | null>(null);

  const seaRef = useRef<SeaEntry[]>([]);
  const focusCoinRef = useRef<string | null>(null);
  const startRef = useRef(0);
  const lastOk = useRef<number | null>(null);

  const casRef = useRef<Cassette | null>(null);
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
    const ambient = buildOrganism(999);

    let raf = 0;
    startRef.current = performance.now();
    let lastNow = startRef.current;

    const tick = (now: number) => {
      const t = (now - startRef.current) / 1000;
      const dt = (now - lastNow) / 1000;
      lastNow = now;

      // cascade playhead
      let convCoin: string | null = null;
      let conv = { stress: 0, exhausted: false };
      if (casRef.current) {
        if (replayPlayRef.current) {
          playheadRef.current = Math.min(1, playheadRef.current + dt / REPLAY_SEC);
          if (playheadRef.current >= 1) replayPlayRef.current = false;
        }
        const f = frameAt(casRef.current, playheadRef.current);
        convCoin = casRef.current.coin;
        conv = { stress: f.stress, exhausted: f.exhausted };
      }

      const creatures: SeaCreature[] = [];
      for (const e of seaRef.current) {
        const c = e.cur;
        const tg = e.target;
        const k = 0.05;
        c.bulk += (tg.bulk - c.bulk) * k;
        c.glow += (tg.glow - c.glow) * k;
        c.tilt += (tg.tilt - c.tilt) * k;
        c.rgb = [
          c.rgb[0] + (tg.rgb[0] - c.rgb[0]) * k,
          c.rgb[1] + (tg.rgb[1] - c.rgb[1]) * k,
          c.rgb[2] + (tg.rgb[2] - c.rgb[2]) * k,
        ];
        while (e.flashes.length && t - e.flashes[0].t0 > FLASH_LIFE) e.flashes.shift();
        creatures.push({
          coin: e.coin,
          drive: c,
          geom: e.geom,
          cx: e.cx,
          cy: e.cy,
          scale: e.scale,
          phase: e.phase,
          depth: e.depth,
          flashes: e.flashes,
          convulse: convCoin === e.coin ? conv : undefined,
        });
      }
      drawSea(ctx, glow, t, creatures, ambient);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // poll vitals for all sea coins; builds the sea on first response
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
        const rows = parseMetaAndAssetCtxs((await res.json()).data);
        if (stopped || !rows.length) return;

        if (!seaRef.current.length) {
          const top = topByOi(rows, TOP_N).map((r) => r.name);
          seaRef.current = layoutSea(top).map((L) => {
            const row = rows.find((r) => r.name === L.coin)!;
            const d = driveFrom(toVit(row));
            return { ...L, cur: { ...d, rgb: [...d.rgb] as Drive["rgb"] }, target: d, flashes: [] };
          });
          focusCoinRef.current = top[0];
          setTradeCoins(top.slice(0, TRADE_N));
        } else {
          for (const e of seaRef.current) {
            const row = rows.find((r) => r.name === e.coin);
            if (row) e.target = driveFrom(toVit(row));
          }
        }
        const fc = focusCoinRef.current;
        const frow = rows.find((r) => r.name === fc);
        if (frow) setFocusHud(toHud(frow));
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

  // live trades for the top coins → skin flashes on the matching creature
  useEffect(() => {
    if (!tradeCoins.length) return;
    const stop = openTradeStream({
      coins: tradeCoins,
      onStatus: (up) => setWsUp(up),
      onTrade: (tr) => {
        if (!startRef.current) return;
        const e = seaRef.current.find((x) => x.coin === tr.coin);
        if (!e) return;
        const notional = tr.px * tr.sz;
        const mag = clamp01((Math.log10(Math.max(notional, 1)) - 2) / 4);
        e.flashes.push({ t0: (performance.now() - startRef.current) / 1000, side: tr.side, mag, lane: Math.random() });
        if (e.flashes.length > 120) e.flashes.splice(0, e.flashes.length - 120);
      },
    });
    return stop;
  }, [tradeCoins]);

  useEffect(() => {
    loadCascadeIndex().then(setCassettes).catch(() => setCassettes([]));
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

  async function selectCascade(coin: string) {
    focusCoinRef.current = coin;
    try {
      const cas = await loadCassette(coin);
      casRef.current = cas;
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
    replayPlayRef.current = false;
    setReplayCoin(null);
    setReplayPlaying(false);
    setReadout(null);
  }
  function toggleReplay() {
    if (!casRef.current) return;
    if (playheadRef.current >= 1) playheadRef.current = 0;
    replayPlayRef.current = !replayPlayRef.current;
    setReplayPlaying(replayPlayRef.current);
  }
  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    playheadRef.current = parseFloat(e.target.value);
    replayPlayRef.current = false;
    setReplayPlaying(false);
  }
  function onCanvasClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * LOGICAL_W;
    const y = ((ev.clientY - rect.top) / rect.height) * LOGICAL_H;
    let best: SeaEntry | null = null;
    let bd = 1e9;
    for (const e of seaRef.current) {
      const d = Math.hypot(e.cx - x, e.cy - y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best && bd < 130) {
      focusCoinRef.current = best.coin;
      if (cassettes.find((c) => c.coin === best!.coin)) selectCascade(best.coin);
    }
  }

  const color = focusHud ? fundingColor(focusHud.fundingHourly) : "#3a4150";
  const longHeavy = (focusHud?.fundingHourly ?? 0) >= 0;
  const fcoin = focusHud?.coin ?? "—";
  const activeCas = cassettes.find((c) => c.coin === replayCoin);

  return (
    <div className="vitalswrap">
      <div className="stagewrap">
        <canvas
          ref={canvasRef}
          className="stage"
          onClick={onCanvasClick}
          title="生物をクリックでその銘柄の清算カスケードを再生"
          aria-label="The Hyperliquid market rendered as a sea of living creatures"
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
              {live ? `LIVE · 上位${TOP_N}銘柄の海` : "再接続中…"}
              {ago != null ? ` · ${ago}s` : ""}
              <span className="sep" />
              <span className={`dot ${wsUp ? "on" : ""}`} />
              {wsUp ? "約定WS" : "WS再接続…"}
            </>
          )}
        </div>
      </div>

      {/* cascade stress-test */}
      <div className="cascade">
        <div className="cascade-head">
          <span className="cascade-title">清算カスケード ストレステスト</span>
          <span className="cascade-sub">
            生物をクリック or 銘柄を選択 → その実ポジション（標本）を実板に通し連鎖を試算（競合未実装の固有機能）
          </span>
        </div>
        <div className="cascade-row">
          {cassettes.map((c) => (
            <button
              key={c.coin}
              className={`casbtn ${replayCoin === c.coin ? "active" : ""}`}
              onClick={() => selectCascade(c.coin)}
            >
              {c.coin}
              <span className="tag">{c.ignited ? `点火 −${c.ignitionPct}%` : "板が吸収"}</span>
            </button>
          ))}
          {replayCoin && (
            <button className="casbtn ghost" onClick={exitReplay}>
              ← ライブの海に戻る
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
          <div className="k">{fcoin} · Mark</div>
          <div className="val">{focusHud ? fmtUsd(focusHud.markPx) : "—"}</div>
          <div className={`sub ${focusHud && focusHud.change24h >= 0 ? "up" : "down"}`}>
            {focusHud ? `24h ${fmtPct(focusHud.change24h)}` : " "}
          </div>
        </div>
        <div className="vital">
          <div className="k">建玉 OI → 胴体</div>
          <div className="val">{focusHud ? fmtUsd(focusHud.oiUsd) : "—"}</div>
          <div className="sub">大きいほど太い体</div>
        </div>
        <div className="vital">
          <div className="k">24h 出来高 → 発光</div>
          <div className="val">{focusHud ? fmtUsd(focusHud.dayVlm) : "—"}</div>
          <div className="sub">血流の明るさ</div>
        </div>
        <div className="vital">
          <div className="k">Funding → 体色</div>
          <div className="val" style={{ color }}>
            {focusHud ? fmtApr(focusHud.fundingApr) : "—"}
          </div>
          <div className="sub">
            <span className="swatch" style={{ background: color }} />
            {focusHud ? (longHeavy ? "ロング過熱（暖色）" : "ショート過熱（寒色）") : " "}
          </div>
        </div>
      </div>

      <div className="flashlegend">
        海の各生物＝<b>上位{TOP_N}銘柄</b>（大きさ=OI／色=funding／発光=出来高／呼吸=各々の位相）。
        体表を走る光＝<b>ライブ約定</b>
        <span className="swatch" style={{ background: "rgb(255,176,92)" }} />買い
        <span className="swatch" style={{ background: "rgb(108,200,255)" }} />売り。
        痙攣＝清算カスケード（生物クリック）。
      </div>
    </div>
  );
}
