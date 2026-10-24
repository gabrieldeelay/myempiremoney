const { getDb } = require("./db");
const { getPublicSettings } = require("./settings");

const REFRESH_INTERVAL_MS = 15000;
const STALE_AFTER_MS = 45000;

const BINANCE_NAMES = {
  BTC: "BITCOIN", ETH: "ETHEREUM", SOL: "SOLANA", XRP: "XRP", BNB: "BNB",
  ADA: "CARDANO", DOGE: "DOGE", LTC: "LITECOIN", AVAX: "AVAX", XLM: "STELLAR",
  SUI: "SUI", TRX: "TRON", DOT: "POLKADOT", LINK: "CHAINLINK", BCH: "BITCOIN CASH", XPL: "XPL"
};

const HEZILEX_INSTRUMENTS = [
  ...Object.entries(BINANCE_NAMES).map(([base, asset]) => ({ asset, provider: "binance", symbol: `${base}USDT` })),
  ...[
    ["EUR/USD", "EURUSD=X"], ["EUR/GBP", "EURGBP=X"], ["AUD/JPY", "AUDJPY=X"],
    ["EUR/JPY", "EURJPY=X"], ["GBP/USD", "GBPUSD=X"], ["AUD/CAD", "AUDCAD=X"],
    ["USD/CAD", "USDCAD=X"], ["USD/JPY", "USDJPY=X"], ["GBP/JPY", "GBPJPY=X"],
    ["AUD/USD", "AUDUSD=X"], ["NZD/USD", "NZDUSD=X"], ["USD/CHF", "USDCHF=X"],
    ["EUR/AUD", "EURAUD=X"], ["EUR/CAD", "EURCAD=X"], ["EUR/CHF", "EURCHF=X"],
    ["GBP/AUD", "GBPAUD=X"], ["GBP/CAD", "GBPCAD=X"], ["CAD/JPY", "CADJPY=X"]
  ].map(([asset, symbol]) => ({ asset, provider: "yahoo", symbol })),
  ...[
    ["APPLE", "AAPL"], ["NETFLIX", "NFLX"], ["META", "META"],
    ["TESLA", "TSLA"], ["MICROSOFT", "MSFT"]
  ].map(([asset, symbol]) => ({ asset, provider: "yahoo", symbol }))
];

let snapshot = { signals: [], updatedAt: null, source: "Radar Atlas 5M", refreshing: false };
let refreshPromise = null;
let refreshTimer = null;

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function displayName(symbol) {
  const base = String(symbol || "").replace(/USDT$/, "");
  return BINANCE_NAMES[base] || base;
}

function analyzeCloses(symbol, asset, closes) {
  const values = closes
    .filter(value => value != null && value !== "")
    .map(Number)
    .filter(Number.isFinite);
  if (values.length < 30) throw new Error(`${symbol}: dados insuficientes`);
  const last = values.at(-1);
  const fast = ema(values.slice(-40), 9);
  const slow = ema(values.slice(-55), 21);
  const strength = rsi(values);
  const momentum = (last / values.at(-7) - 1) * 100;
  const shortMomentum = (last / values.at(-3) - 1) * 100;
  const spread = (fast / slow - 1) * 100;
  const recentChanges = values.slice(-13).slice(1).map((value, index) => value / values.slice(-13)[index] - 1);
  const averageMove = Math.max(.00005, recentChanges.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, recentChanges.length) * 100);
  const consistency = recentChanges.reduce((sum, value) => sum + (value > 0 ? 1 : value < 0 ? -1 : 0), 0) / Math.max(1, recentChanges.length);
  const spreadEvidence = clamp(spread / Math.max(.03, averageMove * 2.2), -1, 1);
  const momentumEvidence = clamp(momentum / Math.max(.08, averageMove * 6), -1, 1);
  const shortEvidence = clamp(shortMomentum / Math.max(.04, averageMove * 2.4), -1, 1);
  const rsiEvidence = clamp((strength - 50) / 35, -1, 1);
  const score = clamp(
    spreadEvidence * 25
      + momentumEvidence * 27
      + shortEvidence * 14
      + rsiEvidence * 18
      + consistency * 16,
    -100,
    100
  );
  const direction = score >= 14 ? "BUY" : score <= -14 ? "SELL" : "WAIT";
  const side = direction === "BUY" ? 1 : direction === "SELL" ? -1 : 0;
  const alignedEvidence = side === 0 ? 0 : [spread, momentum, shortMomentum, strength - 50, consistency]
    .filter(value => Math.sign(value) === side).length;
  const confidence = direction === "WAIT"
    ? Math.round(clamp(44 + Math.abs(score) * .55, 44, 59))
    : Math.round(clamp(50 + Math.abs(score) * .34 + alignedEvidence * 3.2, 55, 94));
  return {
    symbol,
    asset,
    direction,
    confidence,
    score: Number(score.toFixed(2)),
    rsi: Number(strength.toFixed(1)),
    evidence: {
      emaSpread: Number(spread.toFixed(4)),
      momentum: Number(momentum.toFixed(4)),
      shortMomentum: Number(shortMomentum.toFixed(4)),
      consistency: Number(consistency.toFixed(3)),
      aligned: alignedEvidence
    },
    price: last,
    timeframe: "5m",
    reason: direction === "BUY"
      ? "EMA9 acima da EMA21, RSI e momentum compradores"
      : direction === "SELL"
        ? "EMA9 abaixo da EMA21, RSI e momentum vendedores"
        : "Indicadores sem vantagem suficiente"
  };
}

function analyzeCandles(symbol, candles) {
  return analyzeCloses(symbol, displayName(symbol), candles.map(candle => candle[4]));
}

async function analyzeBinance(instrument) {
  const url = new URL("https://data-api.binance.vision/api/v3/klines");
  url.searchParams.set("symbol", instrument.symbol);
  url.searchParams.set("interval", "5m");
  url.searchParams.set("limit", "80");
  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`${instrument.symbol}: ${response.status}`);
  const candles = await response.json();
  return analyzeCloses(instrument.symbol, instrument.asset, candles.slice(0, -1).map(candle => candle[4]));
}

async function analyzeYahoo(instrument) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(instrument.symbol)}`);
  url.searchParams.set("interval", "5m");
  url.searchParams.set("range", "5d");
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`${instrument.symbol}: ${response.status}`);
  const result = (await response.json())?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  return analyzeCloses(instrument.symbol, instrument.asset, closes.slice(0, -1));
}

async function analyzeInstrument(instrument) {
  return instrument.provider === "yahoo" ? analyzeYahoo(instrument) : analyzeBinance(instrument);
}

function configuredInstruments(symbols = []) {
  return symbols.map(symbol => ({ asset: displayName(symbol), provider: "binance", symbol }));
}

async function refreshMarketRadar() {
  if (refreshPromise) return refreshPromise;
  snapshot = { ...snapshot, refreshing: true };
  refreshPromise = (async () => {
    try {
      const settings = await getPublicSettings(getDb());
      const instruments = [...configuredInstruments(settings.market.symbols), ...HEZILEX_INSTRUMENTS]
        .filter((item, index, all) => all.findIndex(candidate => candidate.asset === item.asset) === index);
      const settled = await Promise.allSettled(instruments.map(analyzeInstrument));
      const signals = settled
        .filter(item => item.status === "fulfilled")
        .map(item => item.value)
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
      if (signals.length) snapshot = { signals, updatedAt: new Date().toISOString(), source: "Radar Atlas 5M", refreshing: false };
      else snapshot = { ...snapshot, refreshing: false };
    } catch (error) {
      console.error("Atlas market radar", error);
      snapshot = { ...snapshot, refreshing: false };
    } finally {
      refreshPromise = null;
    }
    return snapshot;
  })();
  return refreshPromise;
}

async function getMarketRadar() {
  const age = snapshot.updatedAt ? Date.now() - new Date(snapshot.updatedAt).getTime() : Infinity;
  if (!snapshot.signals.length || age > STALE_AFTER_MS) await refreshMarketRadar();
  return snapshot;
}

function startMarketRadar() {
  if (refreshTimer) return;
  refreshMarketRadar();
  refreshTimer = setInterval(refreshMarketRadar, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}

module.exports = { HEZILEX_INSTRUMENTS, analyzeCandles, getMarketRadar, refreshMarketRadar, startMarketRadar };
