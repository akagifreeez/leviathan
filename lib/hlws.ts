// Resilient browser WebSocket to Hyperliquid's PUBLIC ws endpoint — live trades
// for one or more coins on a single socket. No key, read-only. Auto-reconnect
// with backoff, 50s ping keepalive (HL drops idle sockets), skips the
// subscriptionResponse and any non-trade frames. TS reimplementation of
// hl-read's Python ResilientStream supervisor (that code can't run in a browser).

export type Trade = { coin: string; side: "A" | "B"; px: number; sz: number; time: number }; // A=sell, B=buy

type Opts = { coins: string[]; onTrade: (t: Trade) => void; onStatus?: (up: boolean) => void };

export function openTradeStream({ coins, onTrade, onStatus }: Opts): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 500;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const clearPing = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
    } catch {
      schedule();
      return;
    }

    ws.onopen = () => {
      backoff = 500;
      onStatus?.(true);
      for (const coin of coins) {
        ws?.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin } }));
      }
      clearPing();
      pingTimer = setInterval(() => {
        try {
          ws?.send(JSON.stringify({ method: "ping" }));
        } catch {
          /* surfaced via onclose */
        }
      }, 50000);
    };

    ws.onmessage = (ev) => {
      let msg: { channel?: string; data?: unknown };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (msg.channel !== "trades" || !Array.isArray(msg.data)) return; // skip subscriptionResponse / pong
      for (const raw of msg.data as Array<{ coin?: string; side?: string; px?: string; sz?: string; time?: number }>) {
        const px = Number(raw.px);
        const sz = Number(raw.sz);
        if (!isFinite(px) || !isFinite(sz)) continue;
        onTrade({
          coin: raw.coin || "",
          side: raw.side === "B" ? "B" : "A",
          px,
          sz,
          time: Number(raw.time) || 0,
        });
      }
    };

    const down = () => {
      onStatus?.(false);
      clearPing();
      schedule();
    };
    ws.onclose = down;
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    };
  };

  function schedule() {
    if (closed) return;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 8000);
  }

  connect();

  return () => {
    closed = true;
    clearPing();
    try {
      ws?.close();
    } catch {
      /* noop */
    }
  };
}
