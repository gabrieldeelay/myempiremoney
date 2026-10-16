const CRYPTO_ASSETS = new Map([
  ["BTC", "BITCOIN"], ["XBT", "BITCOIN"], ["BITCOIN", "BITCOIN"],
  ["ETH", "ETHEREUM"], ["ETHEREUM", "ETHEREUM"],
  ["SOL", "SOLANA"], ["SOLANA", "SOLANA"],
  ["LTC", "LITECOIN"], ["LITECOIN", "LITECOIN"],
  ["ADA", "CARDANO"], ["CARDANO", "CARDANO"],
  ["XRP", "XRP"], ["AVAX", "AVAX"], ["DOGE", "DOGE"], ["SUI", "SUI"],
  ["XLM", "STELLAR"], ["STELLAR", "STELLAR"], ["BNB", "BNB"],
  ["TRX", "TRON"], ["TRON", "TRON"], ["DOT", "POLKADOT"],
  ["LINK", "CHAINLINK"], ["BCH", "BITCOIN CASH"]
]);
const FIAT_CODES = new Set(["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD", "CHF"]);

export function normalizeAssetName(value) {
  const label = String(value || "").replace(/\b(?:CRYPTO|FOREX|OTC)\b/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();
  if (!label) return null;
  const symbol = label.replace(/[^A-Z]/g, "");
  if (symbol.length === 6 && FIAT_CODES.has(symbol.slice(0, 3)) && FIAT_CODES.has(symbol.slice(3))) {
    return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
  }
  for (const [code, name] of CRYPTO_ASSETS) {
    if (symbol === code || (symbol.startsWith(code) && /^(?:USDT|USDC|USD|BRL)$/.test(symbol.slice(code.length)))) return name;
  }
  return label.replace(/\s*\/\s*/g, "/");
}
