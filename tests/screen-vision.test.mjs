import test from "node:test";
import assert from "node:assert/strict";
import { analyzeChartPixels, classifyCandleSequence, createIntracandleReversalTracker, findActiveTabRect, fuzzyMatchAsset } from "../dist/modules/screen-vision.js";

function frame(width = 240, height = 140) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data[index + 3] = 255;
  return { data, width, height };
}

function paint(image, x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const offset = (y * image.width + x) * 4;
      [image.data[offset], image.data[offset + 1], image.data[offset + 2]] = color;
    }
  }
}

test("reconhece o ativo mesmo com erro comum do OCR", () => {
  assert.equal(fuzzyMatchAsset("PSARDANG"), "CARDANO");
  assert.equal(fuzzyMatchAsset("ETHEREUM"), "ETHEREUM");
  assert.equal(fuzzyMatchAsset("BNB"), "BNB");
  assert.equal(fuzzyMatchAsset("CHAINLINK"), "CHAINLINK");
  assert.equal(fuzzyMatchAsset("CAD JPY"), "CAD/JPY");
  assert.equal(fuzzyMatchAsset("AUD/JPY"), "AUD/JPY");
  assert.equal(fuzzyMatchAsset("8N8"), "BNB");
  assert.equal(fuzzyMatchAsset("BN8"), "BNB");
  assert.equal(fuzzyMatchAsset("BMB"), "BNB");
  // OCR output reproduced from the user's selected BNB tab on 30 October.
  assert.equal(fuzzyMatchAsset("WF BME"), "BNB");
  assert.equal(fuzzyMatchAsset("BNE"), "BNB");
  assert.equal(fuzzyMatchAsset("XP1"), "XPL");
  assert.equal(fuzzyMatchAsset("XPI"), "XPL");
});

test("reconhece todo o catálogo de nomes usado no radar da Hezilex", () => {
  for (const asset of ["BITCOIN", "ETHEREUM", "SOLANA", "CARDANO", "LITECOIN", "AVAX", "DOGE", "SUI", "XRP", "XPL", "STELLAR", "BNB", "TRON", "POLKADOT", "CHAINLINK", "BITCOIN CASH", "META", "TESLA", "MICROSOFT", "APPLE", "NETFLIX"]) {
    assert.equal(fuzzyMatchAsset(asset), asset);
  }
});

test("reconhece pares de moedas mesmo com uma letra confundida pelo OCR", () => {
  assert.equal(fuzzyMatchAsset("EUR/USO"), "EUR/USD");
  assert.equal(fuzzyMatchAsset("AUD/JRY"), "AUD/JPY");
  assert.equal(fuzzyMatchAsset("AUP/JY"), "AUD/JPY");
  assert.equal(fuzzyMatchAsset("AUOJPY"), "AUD/JPY");
});

test("não confunde ruído de uma aba Forex com o ticker curto XRP", () => {
  assert.equal(fuzzyMatchAsset("EUR/USD XRP"), "EUR/USD");
  assert.equal(fuzzyMatchAsset("XXRPXX"), null);
  assert.equal(fuzzyMatchAsset("XRP"), "XRP");
});

test("localiza a linha azul da aba ativa", () => {
  const image = frame();
  paint(image, 55, 25, 89, 27, [0, 138, 255]);
  const tab = findActiveTabRect(image.data, image.width, image.height);
  assert.ok(tab);
  assert.equal(tab.x, 55);
  assert.equal(tab.width, 35);
});

test("sequência descendente resulta em venda", () => {
  const image = frame(320, 200);
  paint(image, 90, 62, 100, 82, [238, 78, 82]);
  paint(image, 115, 76, 125, 98, [238, 78, 82]);
  paint(image, 140, 91, 150, 116, [238, 78, 82]);
  paint(image, 165, 109, 175, 137, [238, 78, 82]);
  const result = analyzeChartPixels(image.data, image.width, image.height);
  assert.equal(result.direction, "SELL");
  assert.ok(result.confidence >= 65);
});

test("sequência ascendente resulta em compra", () => {
  const image = frame(320, 200);
  paint(image, 90, 110, 100, 135, [13, 199, 144]);
  paint(image, 115, 94, 125, 117, [13, 199, 144]);
  paint(image, 140, 78, 150, 100, [13, 199, 144]);
  paint(image, 165, 60, 175, 84, [13, 199, 144]);
  const result = analyzeChartPixels(image.data, image.width, image.height);
  assert.equal(result.direction, "BUY");
  assert.equal(result.entryTiming, "CURRENT_CANDLE");
});

test("a vela em formação continua visível quando o gráfico ocupa a borda direita da captura", () => {
  const image = frame(320, 200);
  paint(image, 120, 109, 130, 128, [13, 199, 144]);
  paint(image, 180, 94, 190, 115, [13, 199, 144]);
  paint(image, 240, 79, 250, 100, [13, 199, 144]);
  paint(image, 300, 64, 310, 86, [13, 199, 144]);
  const result = analyzeChartPixels(image.data, image.width, image.height);
  assert.equal(result.technical.lastCandle.centerX, 305);
  assert.equal(result.direction, "BUY");
  assert.equal(result.entryTiming, "CURRENT_CANDLE");
});

test("uma vela ainda pequena pode mostrar possível compra nesta vela quando a sequência já confirma a direção", () => {
  const bodies = Array.from({ length: 6 }, (_, index) => ({
    direction: "BUY", centerX: 70 + index * 22, width: 12,
    y0: 110 - index * 6, y1: 110 - index * 6 + (index === 5 ? 9 : 19),
    height: index === 5 ? 10 : 20, upperWick: 0, lowerWick: 0
  }));
  const early = classifyCandleSequence(bodies);
  assert.equal(early.direction, "BUY");
  assert.equal(early.entryTiming, "CURRENT_CANDLE");
  assert.equal(early.setup, "EARLY_CONTINUATION");
  assert.ok(early.confidence >= 50 && early.confidence < 70);

  bodies[5].height = 15;
  bodies[5].y1 = bodies[5].y0 + 14;
  const confirmed = classifyCandleSequence(bodies);
  assert.equal(confirmed.entryTiming, "CURRENT_CANDLE");
  assert.ok(confirmed.confidence >= 70);
});

test("um pavio de rejeição em suporte pode gerar leitura preliminar nesta vela", () => {
  const image = frame(320, 200);
  paint(image, 90, 98, 100, 118, [13, 199, 144]);
  paint(image, 115, 100, 125, 119, [238, 78, 82]);
  paint(image, 140, 105, 150, 128, [238, 78, 82]);
  paint(image, 165, 120, 175, 140, [238, 78, 82]);
  paint(image, 170, 141, 170, 153, [238, 78, 82]);
  const result = analyzeChartPixels(image.data, image.width, image.height);
  assert.equal(result.direction, "BUY");
  assert.equal(result.setup, "INTRACANDLE_REVERSAL");
  assert.equal(result.entryTiming, "CURRENT_CANDLE");
  assert.ok(result.confidence < 70);
  assert.ok(result.technical.lowerWickRatio >= .55);
});

test("vela compradora esticada bloqueia uma compra atrasada sem presumir reversão", () => {
  const image = frame(320, 200);
  paint(image, 90, 112, 100, 128, [13, 199, 144]);
  paint(image, 115, 102, 125, 119, [13, 199, 144]);
  paint(image, 140, 94, 150, 111, [238, 78, 82]);
  paint(image, 165, 51, 175, 101, [13, 199, 144]);
  const result = analyzeChartPixels(image.data, image.width, image.height);
  assert.equal(result.direction, "WAIT");
  assert.equal(result.setup, "STRETCHED_CANDLE");
  assert.equal(result.blockedDirection, "BUY");
  assert.equal(result.reversalDirection, "SELL");
  assert.equal(result.entryTiming, "WAIT_CONFIRMATION");
  assert.ok(result.factors.some(item => item.includes("maior que a média")));
  assert.ok(result.factors.some(item => item.includes("resistência")));
});

test("rejeição mensurável após vela vendedora esticada confirma possível compra na vela atual", () => {
  const tracker = createIntracandleReversalTracker({ retracementThreshold: .16 });
  const watch = {
    direction: "WAIT",
    confidence: 60,
    chartDetected: true,
    setup: "STRETCHED_CANDLE",
    blockedDirection: "SELL",
    reversalDirection: "BUY",
    factors: ["Vela vendedora esticada."],
    technical: {
      averagePreviousHeight: 20,
      lastCandle: { direction: "SELL", centerX: 180, width: 10, height: 50 }
    }
  };
  assert.equal(tracker.update(watch, "LITECOIN").direction, "WAIT");
  const rejected = tracker.update({
    ...watch,
    setup: "TREND_CONTINUATION",
    technical: {
      averagePreviousHeight: 20,
      lastCandle: { direction: "SELL", centerX: 180, width: 10, height: 40 }
    }
  }, "LITECOIN");
  assert.equal(rejected.direction, "BUY");
  assert.equal(rejected.setup, "INTRACANDLE_REVERSAL");
  assert.equal(rejected.entryTiming, "CURRENT_CANDLE");
  assert.equal(rejected.urgentReversal, true);
});

test("queda relevante em suporte abre possível compra ainda na vela atual", () => {
  const bodies = [
    { direction: "BUY", centerX: 90, width: 10, height: 20, y0: 94, y1: 113 },
    { direction: "SELL", centerX: 110, width: 10, height: 18, y0: 96, y1: 113 },
    { direction: "BUY", centerX: 130, width: 10, height: 21, y0: 91, y1: 111 },
    { direction: "SELL", centerX: 150, width: 10, height: 22, y0: 101, y1: 122 },
    { direction: "SELL", centerX: 170, width: 10, height: 29, y0: 108, y1: 136 }
  ];
  const result = classifyCandleSequence(bodies);
  assert.equal(result.setup, "STRETCHED_CANDLE");
  assert.equal(result.reversalDirection, "BUY");
  assert.ok(result.confidence >= 50);
});

test("alta relevante em resistência abre possível venda ainda na vela atual", () => {
  const bodies = [
    { direction: "SELL", centerX: 90, width: 10, height: 20, y0: 89, y1: 108 },
    { direction: "BUY", centerX: 110, width: 10, height: 18, y0: 88, y1: 105 },
    { direction: "SELL", centerX: 130, width: 10, height: 21, y0: 90, y1: 110 },
    { direction: "BUY", centerX: 150, width: 10, height: 22, y0: 78, y1: 99 },
    { direction: "BUY", centerX: 170, width: 10, height: 29, y0: 64, y1: 92 }
  ];
  const result = classifyCandleSequence(bodies);
  assert.equal(result.setup, "STRETCHED_CANDLE");
  assert.equal(result.reversalDirection, "SELL");
  assert.ok(result.confidence >= 50);
});

test("reação de dez por cento confirma rapidamente a reversão intravela contextual", () => {
  const tracker = createIntracandleReversalTracker();
  const watch = {
    direction: "WAIT",
    confidence: 56,
    setup: "STRETCHED_CANDLE",
    blockedDirection: "SELL",
    reversalDirection: "BUY",
    factors: ["Queda em suporte."],
    technical: {
      averagePreviousHeight: 20,
      lastCandle: { direction: "SELL", centerX: 180, width: 10, height: 50 }
    }
  };
  tracker.update(watch, "BNB");
  const reacted = tracker.update({
    ...watch,
    technical: {
      averagePreviousHeight: 20,
      lastCandle: { direction: "SELL", centerX: 180, width: 10, height: 45 }
    }
  }, "BNB");
  assert.equal(reacted.direction, "BUY");
  assert.equal(reacted.entryTiming, "CURRENT_CANDLE");
});

test("deslocamento acumulado bloqueia venda tardia mesmo sem uma última vela isoladamente gigante", () => {
  const bodies = [
    { direction: "BUY", centerX: 100, width: 10, height: 80, y0: 80, y1: 159 },
    { direction: "BUY", centerX: 120, width: 10, height: 75, y0: 92, y1: 166 },
    { direction: "SELL", centerX: 140, width: 10, height: 95, y0: 100, y1: 194 },
    { direction: "SELL", centerX: 160, width: 10, height: 70, y0: 145, y1: 214 },
    { direction: "SELL", centerX: 180, width: 10, height: 82, y0: 165, y1: 246 },
    { direction: "SELL", centerX: 200, width: 10, height: 88, y0: 190, y1: 277 }
  ];
  const result = classifyCandleSequence(bodies);
  assert.equal(result.direction, "WAIT");
  assert.equal(result.setup, "STRETCHED_CANDLE");
  assert.equal(result.blockedDirection, "SELL");
  assert.equal(result.reversalDirection, "BUY");
  assert.ok(result.factors.some(item => item.includes("suporte")));
});

test("linha horizontal colorida não vira vela nem sinal", () => {
  const image = frame(320, 200);
  paint(image, 30, 100, 245, 101, [13, 199, 144]);
  const result = analyzeChartPixels(image.data, image.width, image.height);
  assert.equal(result.direction, "WAIT");
  assert.equal(result.chartDetected, false);
});
