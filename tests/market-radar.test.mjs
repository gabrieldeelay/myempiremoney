import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { HEZILEX_INSTRUMENTS, analyzeCandles, analyzeHistory } = require("../lib/market-radar");

function candles(values) {
  return values.map((close, index) => [index, close, close, close, close, 1]);
}

test("o radar do servidor calcula compra e venda antes da tela ser aberta", () => {
  const rising = analyzeCandles("BTCUSDT", candles(Array.from({ length: 80 }, (_, index) => 100 + index * .8)));
  const falling = analyzeCandles("ETHUSDT", candles(Array.from({ length: 80 }, (_, index) => 200 - index * .8)));
  assert.equal(rising.direction, "BUY");
  assert.equal(falling.direction, "SELL");
  assert.equal(rising.timeframe, "5m");
  assert.ok(rising.confidence >= 75);
  assert.ok(falling.confidence >= 75);
});

test("o radar ignora intervalos vazios de Forex em vez de convertê-los em preço zero", () => {
  const values = Array.from({ length: 80 }, (_, index) => 1.1 + index * .0001);
  values.splice(30, 0, null, null);
  const result = analyzeCandles("EURUSD=X", candles(values));
  assert.ok(result.price > 1);
  assert.ok(Number.isFinite(result.confidence));
  assert.ok(Number.isFinite(result.score));
});

test("o radar central cobre criptos, Forex e ações exibidos pela Hezilex", () => {
  const assets = new Set(HEZILEX_INSTRUMENTS.map(item => item.asset));
  for (const asset of ["BNB", "XPL", "BITCOIN", "STELLAR", "EUR/USD", "AUD/JPY", "GBP/USD", "APPLE", "NETFLIX", "META", "TESLA", "MICROSOFT"]) {
    assert.ok(assets.has(asset), `${asset} precisa existir no radar central`);
  }
});

test("o sinal publicado usa acerto histórico medido e recusa uma fonte antiga", () => {
  const start = Date.now() - 120 * 300000;
  const bars = Array.from({ length: 120 }, (_, index) => ({
    time: start + index * 300000,
    open: 100 + index,
    close: 100.8 + index
  }));
  const fresh = analyzeHistory({ symbol: "BTCUSDT", asset: "BITCOIN", provider: "binance" }, bars);
  assert.equal(fresh.direction, "BUY");
  assert.equal(fresh.probabilityCalibrated, true);
  assert.ok(fresh.validationSampleSize >= 30);
  assert.ok(fresh.validation.recent.every(record => "outcome" in record && "correct" in record));
  const old = analyzeHistory({ symbol: "BTCUSDT", asset: "BITCOIN", provider: "binance" },
    bars.map(bar => ({ ...bar, time: bar.time - 86400000 })));
  assert.equal(old.direction, "WAIT");
  assert.match(old.reason, /ainda não atualizou/);
});
