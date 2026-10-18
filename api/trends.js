const { getDb } = require("../lib/db");
const { getPublicSettings } = require("../lib/settings");

function ema(values, period) {
  const k = 2 / (period + 1);
  return values.slice(1).reduce((current, value) => value * k + current * (1 - k), values[0]);
}

function rsi(values, period = 14) {
  const changes = values.slice(1).map((value, index) => value - values[index]);
  const recent = changes.slice(-period);
  const gains = recent.reduce((sum, value) => sum + Math.max(0, value), 0) / period;
  const losses = recent.reduce((sum, value) => sum + Math.max(0, -value), 0) / period;
  if (!losses) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function displayName(symbol) {
  const names = { BTC: "BITCOIN", ETH: "ETHEREUM", SOL: "SOLANA", XRP: "XRP", BNB: "BNB", ADA: "CARDANO", DOGE: "DOGE", LTC: "LITECOIN", AVAX: "AVAX" };
  const base = symbol.replace(/USDT$/, "");
  return names[base] || base;
}

async function analyze(symbol) {
  const url = new URL("https://data-api.binance.vision/api/v3/klines");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "5m");
  url.searchParams.set("limit", "80");
  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`${symbol}: ${response.status}`);
  const candles = await response.json();
  const closes = candles.map(candle => Number(candle[4])).filter(Number.isFinite);
  if (closes.length < 30) throw new Error(`${symbol}: dados insuficientes`);
  const last = closes.at(-1);
  const fast = ema(closes.slice(-40), 9);
  const slow = ema(closes.slice(-55), 21);
  const strength = rsi(closes);
  const momentum = (last / closes.at(-7) - 1) * 100;
  const spread = (fast / slow - 1) * 100;
  const score = Math.max(-100, Math.min(100, spread * 45 + momentum * 12 + (strength - 50) * 0.9));
  const direction = score >= 8 ? "BUY" : score <= -8 ? "SELL" : "WAIT";
  const confidence = Math.round(Math.min(96, 50 + Math.abs(score) * 0.46));
  return { symbol, asset: displayName(symbol), direction, confidence, score: Number(score.toFixed(2)), rsi: Number(strength.toFixed(1)), price: last, timeframe: "5m", reason: direction === "BUY" ? "EMA9 acima da EMA21, RSI e momentum compradores" : direction === "SELL" ? "EMA9 abaixo da EMA21, RSI e momentum vendedores" : "Indicadores sem vantagem suficiente" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=90");
  try {
    const settings = await getPublicSettings(getDb());
    const settled = await Promise.allSettled(settings.market.symbols.slice(0, 12).map(analyze));
    const items = settled.filter(item => item.status === "fulfilled").map(item => item.value).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 5);
    if (!items.length) throw new Error("Nenhum ativo respondeu.");
    return res.status(200).json({ items, source: "Binance Spot", method: "EMA9 + EMA21 + RSI14 + momentum, velas de 5 minutos", updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: "As tendências estão atualizando. Tente novamente em instantes.", items: [] });
  }
};
