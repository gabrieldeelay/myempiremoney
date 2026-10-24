import test from "node:test";
import assert from "node:assert/strict";
import { composeCentralAnalysis, strongestTrend } from "../dist/modules/analysis-policy.js";

const buyTrend = {
  asset: "CARDANO",
  direction: "BUY",
  confidence: 78,
  score: 31,
  reason: "EMA9 acima da EMA21"
};

test("uma possível entrada aparece imediatamente com momento definido", () => {
  const analysis = composeCentralAnalysis({ trend: buyTrend });
  assert.equal(analysis.direction, "BUY");
  assert.equal(analysis.signalKind, "trend");
  assert.equal(analysis.entryConfirmed, false);
  assert.match(analysis.reason, /Possível compra para a próxima vela/);
});

test("uma oportunidade válida entre 50 e 69 conserva o momento da entrada", () => {
  const analysis = composeCentralAnalysis({
    trend: { ...buyTrend, confidence: 58 },
    live: { direction: "BUY", confidence: 64, source: "screen-capture", entryTiming: "NEXT_CANDLE" },
    timeframe: "5m",
    expiration: "5 min"
  });
  assert.equal(analysis.signalKind, "entry");
  assert.equal(analysis.entryConfirmed, true);
  assert.equal(analysis.entryTiming, "NEXT_CANDLE");
  assert.ok(analysis.confidence >= 50 && analysis.confidence < 70);
});

test("rejeição técnica confirmada pode superar a direção anterior sem virar palpite", () => {
  const analysis = composeCentralAnalysis({
    trend: { ...buyTrend, confidence: 82 },
    live: {
      direction: "SELL",
      confidence: 80,
      source: "screen-capture",
      chartDetected: true,
      setup: "INTRACANDLE_REVERSAL",
      urgentReversal: true,
      entryTiming: "CURRENT_CANDLE"
    },
    timeframe: "5m",
    expiration: "5 min"
  });
  assert.equal(analysis.direction, "SELL");
  assert.equal(analysis.signalKind, "entry");
  assert.equal(analysis.entryTiming, "CURRENT_CANDLE");
  assert.ok(analysis.confidence >= 70);
});

test("a tendência vira sinal somente quando tela, gráfico e expiração estão alinhados", () => {
  const analysis = composeCentralAnalysis({
    trend: buyTrend,
    live: { direction: "BUY", confidence: 81, source: "screen-capture", entryTiming: "CURRENT_CANDLE" },
    timeframe: "5m",
    expiration: "5 min"
  });
  assert.equal(analysis.signalKind, "entry");
  assert.equal(analysis.entryConfirmed, true);
  assert.equal(analysis.entryTiming, "CURRENT_CANDLE");
  assert.ok(analysis.confidence > buyTrend.confidence, "a confirmação visual mais forte deve participar da confiança final");
});

test("uma oportunidade visual forte pode gerar entrada quando o radar central está neutro", () => {
  const analysis = composeCentralAnalysis({
    trend: { ...buyTrend, direction: "WAIT", confidence: 55 },
    live: {
      direction: "SELL",
      confidence: 84,
      score: -.61,
      chartDetected: true,
      source: "screen-capture",
      entryTiming: "CURRENT_CANDLE"
    },
    timeframe: "5m",
    expiration: "5 min"
  });
  assert.equal(analysis.signalKind, "entry");
  assert.equal(analysis.direction, "SELL");
  assert.ok(analysis.confidence >= 75);
});

test("uma análise neutra termina como sem oportunidade em vez de carregar indefinidamente", () => {
  const analysis = composeCentralAnalysis({ trend: { ...buyTrend, direction: "WAIT", confidence: 54 } });
  assert.equal(analysis.direction, "WAIT");
  assert.equal(analysis.signalKind, "no-opportunity");
  assert.match(analysis.reason, /Sem oportunidade segura agora/);
});

test("uma direção abaixo de cinquenta por cento termina como sem oportunidade", () => {
  const analysis = composeCentralAnalysis({ trend: { ...buyTrend, confidence: 47 } });
  assert.equal(analysis.direction, "WAIT");
  assert.equal(analysis.signalKind, "no-opportunity");
  assert.match(analysis.reason, /abaixo de 50%/);
});

test("o destaque inicial prioriza uma direção clara em vez de um ativo neutro", () => {
  const result = strongestTrend([
    { asset: "BITCOIN", direction: "WAIT", confidence: 90 },
    { asset: "CARDANO", direction: "BUY", confidence: 70 },
    { asset: "BNB", direction: "SELL", confidence: 76 }
  ]);
  assert.equal(result.asset, "BNB");
});

