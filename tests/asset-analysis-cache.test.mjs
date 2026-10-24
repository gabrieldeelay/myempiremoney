import test from "node:test";
import assert from "node:assert/strict";
import { createAssetAnalysisCache } from "../dist/modules/asset-analysis-cache.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

test("cada ativo conserva a própria leitura ao alternar rapidamente", () => {
  let clock = 1000;
  const cache = createAssetAnalysisCache({ storage: memoryStorage(), now: () => clock });
  cache.rememberTrend("CARDANO", { direction: "BUY", score: 20, confidence: 72 }, "2026-10-24T10:00:00Z");
  cache.rememberState("CARDANO", {
    analysis: { direction: "BUY", source: "screen-capture" },
    rendered: { direction: "BUY", signalKind: "entry", entryConfirmed: true },
    timeframe: "5m",
    expiration: "5 min",
    chartDetected: true
  });
  clock += 8000;
  cache.rememberState("BITCOIN", { analysis: { direction: "SELL" }, timeframe: "5m" });
  const restored = cache.state("CARDANO");
  assert.equal(restored.rendered.direction, "BUY");
  assert.equal(restored.timeframe, "5m");
  assert.equal(cache.lastAsset(), "BITCOIN");
});

test("uma mudança relevante do radar invalida o sinal salvo", () => {
  let clock = 1000;
  const cache = createAssetAnalysisCache({ storage: memoryStorage(), now: () => clock });
  cache.rememberTrend("BNB", { direction: "BUY", score: 18, confidence: 68 });
  cache.rememberState("BNB", {
    analysis: { direction: "BUY", source: "screen-capture" },
    rendered: { direction: "BUY", signalKind: "entry" }
  });
  clock += 15000;
  cache.rememberTrend("BNB", { direction: "SELL", score: -19, confidence: 69 });
  assert.equal(cache.state("BNB"), null);
  assert.equal(cache.trend("BNB").direction, "SELL");
});

test("uma leitura visual vencida não permanece indefinidamente", () => {
  let clock = 1000;
  const cache = createAssetAnalysisCache({ storage: memoryStorage(), now: () => clock, liveTtlMs: 60000 });
  cache.rememberState("EUR/USD", { analysis: { direction: "BUY" } });
  clock += 60001;
  assert.equal(cache.state("EUR/USD"), null);
});

