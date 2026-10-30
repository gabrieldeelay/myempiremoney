import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateNextCandles } = require("../lib/signal-validation");

test("avalia a próxima vela sem incluir seu resultado na previsão ou na calibração anterior", () => {
  const candles = Array.from({ length: 100 }, (_, index) => ({
    time: index * 300000,
    open: 100 + index,
    close: 101 + index
  }));
  const report = validateNextCandles(candles, closes => ({
    direction: "BUY",
    score: 45,
    lastSeenClose: closes.at(-1)
  }));
  assert.equal(report.validation.overall.count, 44);
  assert.equal(report.validation.overall.accuracy, 100);
  assert.equal(report.validation.recent.at(-1).probability > 50, true);
  assert.equal(report.confidence < 100, true);
  assert.equal(report.calibrated, true);
});

test("não publica taxa de acerto com amostra pequena", () => {
  const candles = Array.from({ length: 65 }, (_, index) => [index * 300000, 100, 101, 99, index % 2 ? 101 : 99]);
  const report = validateNextCandles(candles, () => ({ direction: "SELL", score: -40 }));
  assert.equal(report.calibrated, false);
  assert.equal(report.confidence, null);
  assert.equal(report.validation.overall.count, 9);
});

test("compara acerto real e direção invertida sem trocar sinais automaticamente", () => {
  const candles = Array.from({ length: 100 }, (_, index) => [index * 300000, 100, 101, 99, 99]);
  const report = validateNextCandles(candles, () => ({ direction: "BUY", score: 50 }));
  assert.equal(report.validation.overall.accuracy, 0);
  assert.equal(report.validation.invertedAccuracy, 100);
  assert.equal(report.latest.direction, "BUY");
});
