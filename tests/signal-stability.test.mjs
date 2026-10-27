import test from "node:test";
import assert from "node:assert/strict";
import { createSignalStabilizer } from "../dist/modules/signal-stability.js";

test("confirma o primeiro sinal antes de publicá-lo", () => {
  let clock = 0;
  const filter = createSignalStabilizer({ now: () => clock, initialConfirmMs: 1000, initialHits: 3 });
  const input = { direction: "SELL", confidence: 82, reason: "pressão vendedora" };

  assert.equal(filter.update(input, "BITCOIN").direction, "WAIT");
  clock = 500;
  assert.equal(filter.update(input, "BITCOIN").direction, "WAIT");
  clock = 1100;
  const confirmed = filter.update(input, "BITCOIN");
  assert.equal(confirmed.direction, "SELL");
  assert.equal(confirmed.stability, "stable");
});

test("aceita imediatamente possível compra ou venda a partir de cinquenta por cento", () => {
  const filter = createSignalStabilizer({ initialConfirmMs: 0, initialHits: 1 });
  const possible = filter.update({ direction: "SELL", confidence: 54, signalKind: "trend" }, "STELLAR");
  assert.equal(possible.direction, "SELL");
  assert.equal(possible.confidence, 54);
  assert.equal(possible.stability, "stable");
});

test("não troca o sinal por oscilações rápidas da vela aberta", () => {
  let clock = 0;
  const filter = createSignalStabilizer({
    now: () => clock,
    initialConfirmMs: 0,
    initialHits: 1,
    minHoldMs: 5000,
    switchConfirmMs: 2000,
    switchHits: 3
  });
  const sell = { direction: "SELL", confidence: 84, reason: "venda" };
  const buy = { direction: "BUY", confidence: 81, reason: "compra" };

  assert.equal(filter.update(sell, "SOLANA").direction, "SELL");
  clock = 1000;
  assert.equal(filter.update(buy, "SOLANA").direction, "SELL");
  clock = 1800;
  assert.equal(filter.update(sell, "SOLANA").direction, "SELL");
  clock = 2600;
  const noisy = filter.update(buy, "SOLANA");
  assert.equal(noisy.direction, "SELL");
  assert.equal(noisy.stability, "stable");
  assert.equal(noisy.candleLocked, true);
});

test("aceita a direção contrária somente depois de persistência e tempo mínimo", () => {
  let clock = 0;
  const filter = createSignalStabilizer({
    now: () => clock,
    initialConfirmMs: 0,
    initialHits: 1,
    minHoldMs: 3000,
    switchConfirmMs: 2000,
    switchHits: 3
  });
  const sell = { direction: "SELL", confidence: 84 };
  const buy = { direction: "BUY", confidence: 79 };

  filter.update(sell, "CARDANO");
  clock = 1000;
  assert.equal(filter.update(buy, "CARDANO").direction, "SELL");
  clock = 2000;
  assert.equal(filter.update(buy, "CARDANO").direction, "SELL");
  clock = 3100;
  assert.equal(filter.update(buy, "CARDANO").direction, "SELL");
  clock = 300100;
  assert.equal(filter.update(buy, "CARDANO").direction, "SELL");
  clock = 301200;
  assert.equal(filter.update(buy, "CARDANO").direction, "SELL");
  clock = 302300;
  const switched = filter.update(buy, "CARDANO");
  assert.equal(switched.direction, "BUY");
  assert.equal(switched.stability, "stable");
});

test("reinicia a confirmação quando o ativo muda", () => {
  let clock = 0;
  const filter = createSignalStabilizer({ now: () => clock, initialConfirmMs: 1000, initialHits: 2 });
  const buy = { direction: "BUY", confidence: 80 };

  filter.update(buy, "BITCOIN");
  clock = 1200;
  assert.equal(filter.update(buy, "BITCOIN").direction, "BUY");
  clock = 1300;
  assert.equal(filter.update(buy, "ETHEREUM").direction, "WAIT");
});

test("ignora possível reversão oposta depois que a direção foi confirmada na vela", () => {
  let clock = 0;
  const filter = createSignalStabilizer({ now: () => clock, initialConfirmMs: 0, initialHits: 1 });
  assert.equal(filter.update({ direction: "SELL", confidence: 82 }, "LITECOIN").direction, "SELL");
  clock = 400;
  const blocked = filter.update({
    direction: "WAIT",
    confidence: 60,
    setup: "STRETCHED_CANDLE",
    blockedDirection: "SELL",
    reversalDirection: "BUY",
    technical: { lastCandle: { centerX: 181, width: 12 } },
    reason: "queda esticada"
  }, "LITECOIN");
  assert.equal(blocked.direction, "SELL");
  assert.equal(blocked.candleLocked, true);
  assert.equal(blocked.reversalDirection, undefined);
});

test("mantém a direção confirmada mesmo quando leituras seguintes voltam para aguardar", () => {
  let clock = 0;
  const filter = createSignalStabilizer({ now: () => clock, initialConfirmMs: 0, initialHits: 1 });
  assert.equal(filter.update({ direction: "SELL", confidence: 80 }, "AUD/JPY").direction, "SELL");
  clock = 90000;
  const held = filter.update({ direction: "WAIT", confidence: 44 }, "AUD/JPY");
  assert.equal(held.direction, "SELL");
  assert.equal(held.stability, "stable");
  assert.equal(held.candleLocked, true);
});

test("não reabre na mesma vela um ponto de entrada que já foi bloqueado", () => {
  let clock = 0;
  const filter = createSignalStabilizer({ now: () => clock, initialConfirmMs: 0, initialHits: 1 });
  filter.update({ direction: "SELL", confidence: 84, technical: { lastCandle: { centerX: 180, width: 12 } } }, "AUD/JPY");
  clock = 300500;
  filter.update({ direction: "WAIT", confidence: 60, setup: "STRETCHED_CANDLE", blockedDirection: "SELL", technical: { lastCandle: { centerX: 200, width: 12 } } }, "AUD/JPY");
  clock = 305000;
  const sameCandle = filter.update({ direction: "SELL", confidence: 82, setup: "TREND_CONTINUATION", technical: { lastCandle: { centerX: 202, width: 12 } } }, "AUD/JPY");
  assert.equal(sameCandle.direction, "SELL");
  assert.equal(sameCandle.entryBlocked, true);
  clock = 600500;
  const nextCandle = filter.update({ direction: "SELL", confidence: 82, setup: "TREND_CONTINUATION", technical: { lastCandle: { centerX: 230, width: 12 } } }, "AUD/JPY");
  assert.equal(nextCandle.direction, "SELL");
  assert.equal(nextCandle.entryBlocked, undefined);
  assert.equal(nextCandle.entryOpportunityRenewed, true);
  assert.equal(nextCandle.stability, "stable");
});

test("não anuncia nova venda sem uma nova leitura vendedora confirmada", () => {
  let clock = 0;
  const filter = createSignalStabilizer({ now: () => clock, initialConfirmMs: 0, initialHits: 1 });
  filter.update({ direction: "SELL", confidence: 84, technical: { lastCandle: { centerX: 180, width: 12 } } }, "AUD/JPY");
  clock = 500;
  filter.update({ direction: "WAIT", confidence: 60, setup: "STRETCHED_CANDLE", blockedDirection: "SELL", technical: { lastCandle: { centerX: 180, width: 12 } } }, "AUD/JPY");
  clock = 8000;
  const noEntry = filter.update({ direction: "WAIT", confidence: 50, technical: { lastCandle: { centerX: 202, width: 12 } } }, "AUD/JPY");
  assert.equal(noEntry.direction, "SELL");
  assert.equal(noEntry.entryOpportunityRenewed, undefined);
});

test("mantém uma possível compra visível durante falhas breves da leitura da mesma vela", () => {
  let clock = 0;
  const filter = createSignalStabilizer({ now: () => clock, observationGraceMs: 15000 });
  const observed = filter.update({
    direction: "WAIT",
    confidence: 54,
    setup: "STRETCHED_CANDLE",
    blockedDirection: "SELL",
    reversalDirection: "BUY",
    technical: { lastCandle: { centerX: 180, width: 12 } }
  }, "AUD/JPY");
  assert.equal(observed.setup, "STRETCHED_CANDLE");
  assert.equal(observed.reversalDirection, "BUY");

  clock = 2200;
  const held = filter.update({ direction: "WAIT", confidence: 0, technical: { lastCandle: { centerX: 181, width: 12 } } }, "AUD/JPY");
  assert.equal(held.setup, "STRETCHED_CANDLE");
  assert.equal(held.reversalDirection, "BUY");
  assert.equal(held.observationHeld, true);
  assert.equal(held.confidence, 54);
});

test("encerra a observação quando uma nova vela substitui a hipótese anterior", () => {
  let clock = 0;
  const filter = createSignalStabilizer({ now: () => clock });
  filter.update({
    direction: "WAIT",
    confidence: 54,
    setup: "STRETCHED_CANDLE",
    blockedDirection: "SELL",
    reversalDirection: "BUY",
    technical: { lastCandle: { centerX: 180, width: 10 } }
  }, "AUD/JPY");
  clock = 5000;
  const nextCandle = filter.update({ direction: "WAIT", confidence: 0, technical: { lastCandle: { centerX: 205, width: 10 } } }, "AUD/JPY");
  assert.equal(nextCandle.setup, undefined);
  assert.equal(nextCandle.direction, "WAIT");
  assert.equal(nextCandle.confidence, 0);
});

test("uma compra confirmada não muda de opinião dentro da mesma vela", () => {
  let clock = 60000;
  const filter = createSignalStabilizer({ now: () => clock, initialConfirmMs: 0, initialHits: 1 });
  const buy = { direction: "BUY", confidence: 82, technical: { lastCandle: { centerX: 180, width: 12 } } };
  const sellReversal = { direction: "SELL", confidence: 80, setup: "INTRACANDLE_REVERSAL", urgentReversal: true, technical: { lastCandle: { centerX: 181, width: 12 } } };
  assert.equal(filter.update(buy, "BITCOIN").direction, "BUY");

  clock = 120000;
  const held = filter.update(sellReversal, "BITCOIN");
  assert.equal(held.direction, "BUY");
  assert.equal(held.candleLocked, true);

  clock = 300100;
  assert.equal(filter.update(sellReversal, "BITCOIN").direction, "BUY");
  clock = 301000;
  assert.equal(filter.update(sellReversal, "BITCOIN").direction, "SELL");
});

test("uma venda confirmada não publica possível compra na mesma vela", () => {
  let clock = 60000;
  const filter = createSignalStabilizer({ now: () => clock, initialConfirmMs: 0, initialHits: 1 });
  const sell = { direction: "SELL", confidence: 82, technical: { lastCandle: { centerX: 180, width: 12 } } };
  assert.equal(filter.update(sell, "EUR/USD").direction, "SELL");

  clock = 120000;
  const stretched = filter.update({
    direction: "WAIT",
    confidence: 54,
    setup: "STRETCHED_CANDLE",
    blockedDirection: "SELL",
    reversalDirection: "BUY",
    technical: { lastCandle: { centerX: 181, width: 12 } }
  }, "EUR/USD");
  assert.equal(stretched.direction, "SELL");
  assert.equal(stretched.candleLocked, true);

  clock = 121000;
  const held = filter.update({ direction: "WAIT", confidence: 0, technical: { lastCandle: { centerX: 182, width: 12 } } }, "EUR/USD");
  assert.equal(held.direction, "SELL");
  assert.equal(held.candleLocked, true);
});

test("mantém possível compra até o fim da vela antes de aceitar sem oportunidade", () => {
  let clock = 61000;
  const filter = createSignalStabilizer({ now: () => clock, initialConfirmMs: 0, initialHits: 1 });
  const possibleBuy = { direction: "BUY", confidence: 63, signalKind: "trend", entryConfirmed: false };
  const noOpportunity = { direction: "WAIT", confidence: 46, signalKind: "no-opportunity" };

  assert.equal(filter.update(possibleBuy, "BNB").direction, "BUY");
  clock = 299900;
  const held = filter.update(noOpportunity, "BNB");
  assert.equal(held.direction, "BUY");
  assert.equal(held.candleLocked, true);

  clock = 300100;
  const released = filter.update(noOpportunity, "BNB");
  assert.equal(released.direction, "WAIT");
  assert.equal(released.signalKind, "no-opportunity");
});

test("confirma reversão intravela rapidamente sem publicar um único quadro isolado", () => {
  let clock = 0;
  const filter = createSignalStabilizer({ now: () => clock });
  const reversal = { direction: "BUY", confidence: 74, setup: "INTRACANDLE_REVERSAL", urgentReversal: true, entryTiming: "CURRENT_CANDLE" };
  assert.equal(filter.update(reversal, "LITECOIN").direction, "WAIT");
  clock = 850;
  const confirmed = filter.update(reversal, "LITECOIN");
  assert.equal(confirmed.direction, "BUY");
  assert.equal(confirmed.entryTiming, "CURRENT_CANDLE");
  assert.equal(confirmed.setup, "INTRACANDLE_REVERSAL");
});
