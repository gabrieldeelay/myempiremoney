import test from "node:test";
import assert from "node:assert/strict";
import { createSignalCandleLock, createSpokenSignalLock } from "../dist/modules/signal-candle-lock.js";

test("mantém o sinal quando a leitura volta a aguardar na mesma vela", () => {
  const lock = createSignalCandleLock();
  const signal = lock.resolve({ asset: "BNB", pane: "current", cycleKey: "10:00", view: { direction: "BUY", confidence: 72, possible: false } });
  const held = lock.resolve({ asset: "BNB", pane: "current", cycleKey: "10:00", view: { direction: "WAIT", confidence: 0 } });
  assert.equal(signal.direction, "BUY");
  assert.equal(held.direction, "BUY");
  assert.equal(held.heldByCandle, true);
});

test("mantém também um possível sinal até o fechamento da vela", () => {
  const lock = createSignalCandleLock();
  lock.resolve({ asset: "BNB", pane: "current", cycleKey: "10:00", view: { direction: "SELL", confidence: 58, possible: true } });
  const held = lock.resolve({ asset: "BNB", pane: "current", cycleKey: "10:00", view: { direction: "WAIT", confidence: 0 } });
  assert.equal(held.direction, "SELL");
  assert.equal(held.possible, true);
  assert.equal(held.heldByCandle, true);
});

test("não troca a direção confirmada no meio da mesma vela", () => {
  const lock = createSignalCandleLock();
  lock.resolve({ asset: "EUR/USD", pane: "next", cycleKey: "10:00", view: { direction: "SELL", confidence: 65, possible: true } });
  const held = lock.resolve({ asset: "EUR/USD", pane: "next", cycleKey: "10:00", view: { direction: "BUY", confidence: 80, possible: false } });
  assert.equal(held.direction, "SELL");
  assert.equal(held.possible, true);
});

test("libera uma nova leitura no início da próxima vela", () => {
  const lock = createSignalCandleLock();
  lock.resolve({ asset: "XPL", pane: "current", cycleKey: "10:00", view: { direction: "BUY", confidence: 71 } });
  const nextCycle = lock.resolve({ asset: "XPL", pane: "current", cycleKey: "10:05", view: { direction: "WAIT", confidence: 0 } });
  assert.equal(nextCycle.direction, "WAIT");
});

test("o robô não fala a direção oposta depois de publicar um sinal na mesma vela", () => {
  const lock = createSpokenSignalLock();
  assert.equal(lock.accept({ asset: "BITCOIN", cycleKey: "10:00", context: "sell" }), true);
  assert.equal(lock.direction("BITCOIN", "10:00"), "SELL");
  assert.equal(lock.accept({ asset: "BITCOIN", cycleKey: "10:00", context: "buy" }), false);
  assert.equal(lock.accept({ asset: "BITCOIN", cycleKey: "10:00", context: "reversalBuy" }), false);
  assert.equal(lock.accept({ asset: "BITCOIN", cycleKey: "10:00", context: "reversalSell" }), true);
});

test("o robô pode assumir uma nova direção somente na vela seguinte", () => {
  const lock = createSpokenSignalLock();
  lock.accept({ asset: "BITCOIN", cycleKey: "10:00", context: "sell" });
  assert.equal(lock.accept({ asset: "BITCOIN", cycleKey: "10:05", context: "buy" }), true);
  assert.equal(lock.direction("BITCOIN", "10:05"), "BUY");
});
