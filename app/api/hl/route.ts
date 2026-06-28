import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy a small allowlist of read-only Hyperliquid Info API calls. No key, no
// writes. Same public endpoint the author's `hl-read` MCP wraps. The browser
// *can* hit this endpoint directly (CORS is open), but going through the proxy
// gives us a stable cache window and keeps the request shape locked down.
const ALLOWED = new Set(["metaAndAssetCtxs", "predictedFundings", "l2Book", "allMids"]);
const HL = "https://api.hyperliquid.xyz/info";

export async function POST(req: Request) {
  let body: { type?: string; coin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const type = body.type || "";
  if (!ALLOWED.has(type)) {
    return NextResponse.json({ error: "Unsupported request type." }, { status: 400 });
  }
  const payload: Record<string, unknown> = { type };
  if (type === "l2Book") {
    const coin = (body.coin || "BTC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    payload.coin = coin || "BTC";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(HL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) return NextResponse.json({ error: `Hyperliquid returned ${res.status}.` }, { status: 502 });
    const data = await res.json();
    return NextResponse.json({ data }, { headers: { "cache-control": "public, max-age=10" } });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Hyperliquid timed out." : "Could not reach Hyperliquid.";
    return NextResponse.json({ error: msg }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
