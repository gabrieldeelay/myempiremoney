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
  assert.equal(fuzzyMatchAsset("CAD JPY"), "CAD/JPY");
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
});

test("linha horizontal colorida não vira vela nem sinal", () => {
  const image = frame(320, 200);
  paint(image, 30, 100, 245, 101, [13, 199, 144]);
  const result = analyzeChartPixels(image.data, image.width, image.height);
  assert.equal(result.direction, "WAIT");
  assert.equal(result.chartDetected, false);
});
