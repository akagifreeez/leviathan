import MarketStage from "@/components/MarketStage";

export default function Home() {
  return (
    <main>
      <section className="hero">
        <h1>Leviathan</h1>
        <p className="tagline">
          <strong style={{ color: "#cfe8df" }}>市場を、生き物の海として。</strong>{" "}
          Hyperliquid 上位銘柄が、ライブなオンチェーン・データで脈打つ生物の群れになる。
          建玉が<b>胴体の太さ</b>に、ファンディングが<b>体色</b>に、出来高が<b>発光</b>に、
          約定が<b>体表を走る光</b>に。生物をクリックすれば、その<b>清算カスケード</b>で痙攣する——APIキーもログインもなしで。
        </p>
      </section>

      <MarketStage />

      <p className="honest">
        <b>正直な但し書き（盛らない）：</b>{" "}
        これは <b>read-only・鍵不要・公開データのみ</b>で動きます（署名・発注・鍵の預かりは一切なし）。
        生物は<b>市場の比喩</b>であって生物学ではありません。
        体色のファンディングは「建玉の過熱の偏り」であって価格の上下予想ではありません。
        清算カスケード（痙攣）は<b>「清算量＝標本(164アドレス)の下限・価格影響＝可視板で過大」のストレス試算であり、予測ではありません</b>。
        機械学習・自前学習は一切なく、<b>公開データの観測と決定論的な写像のみ</b>です。投資助言ではありません。
      </p>

      <div className="about">
        <div className="card">
          <h3>これは何？</h3>
          <p>
            Hyperliquid の公開 Info API / WS から上位銘柄の mark / 建玉 / 出来高 / ファンディング / 約定を
            ブラウザが直接取得し、決定論レンダラで「生きている海」に翻訳するライブデータアート。
          </p>
        </div>
        <div className="card">
          <h3>なぜ $0 で動く？</h3>
          <p>
            データは鍵不要の公開 API、描画はクライアント側 canvas、LLM 呼び出しなし。
            API が落ちても最後の値で呼吸を続け、清算カスケードは録画を決定論再生するので常時動きます。
          </p>
        </div>
        <div className="card">
          <h3>段階</h3>
          <p>
            v0＝呼吸する生物 → v1＝ライブ約定の光＋清算カスケード痙攣 → <b>v2（今ここ）</b>＝
            上位銘柄の生態系（生物の海）。次は BYOK の AI ナレーター実況。各段階を公開しながら進めます。
          </p>
        </div>
      </div>

      <p className="foot">
        powered by the public Hyperliquid Info API · 関連:{" "}
        <a href="https://github.com/akagifreeez/hl-read" target="_blank" rel="noreferrer">
          hl-read
        </a>{" "}
        (鍵を渡さない読み取り専用 MCP) ·{" "}
        <a href="https://mycelium-dusky.vercel.app" target="_blank" rel="noreferrer">
          Mycelium
        </a>{" "}
        (姉妹作)
      </p>
    </main>
  );
}
