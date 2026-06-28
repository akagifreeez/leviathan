import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leviathan — a market breathing as a living creature",
  description:
    "BTC perp, alive. One market rendered as a single breathing creature, driven by live on-chain Hyperliquid data — open interest is its bulk, funding its color, volume its glow. Key-free, read-only, $0. Not a prediction, not investment advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
