import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { analyzeCandles } = require("../lib/market-radar");

function candles(values) {
  return values.map((close, index) => [index, close, close, close, close, 1]);
}

test("o radar do servidor calcula compra e venda antes da tela ser aberta", () => {
  const rising = analyzeCandles("BTCUSDT", candles(Array.from({ length: 80 }, (_, index) => 100 + index * .8)));
  const falling = analyzeCandles("ETHUSDT", candles(Array.from({ length: 80 }, (_, index) => 200 - index * .8)));
  assert.equal(rising.direction, "BUY");
  assert.equal(falling.direction, "SELL");
  assert.equal(rising.timeframe, "5m");
});
