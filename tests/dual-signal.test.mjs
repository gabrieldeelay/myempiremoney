import test from "node:test";
import assert from "node:assert/strict";
import { composeDualSignalViews, signalLabel } from "../dist/modules/dual-signal.js";
import { classifyCandleSequence } from "../dist/modules/screen-vision.js";
import { createSignalCandleLock } from "../dist/modules/signal-candle-lock.js";

test("estado neutro informa que falta confirmação", () => {
  assert.equal(signalLabel({ direction: "WAIT" }), "AGUARDANDO CONFIRMAÇÃO");
});

test("análise concluída sem entrada mantém o nome padronizado", () => {
  assert.equal(signalLabel({ direction: "WAIT", signalKind: "no-opportunity" }), "AGUARDANDO CONFIRMAÇÃO");
});

test("não inventa reversão intravela só porque a vela ficou esticada", () => {
  const result = composeDualSignalViews({
    live: {
      source: "screen-capture",
      chartDetected: true,
      direction: "WAIT",
      confidence: 59,
      setup: "STRETCHED_CANDLE",
      reversalDirection: "BUY",
      reason: "Queda esticada em suporte."
    },
    central: { direction: "SELL", confidence: 80, entryTiming: "NEXT_CANDLE" },
    trend: { direction: "SELL", confidence: 80, reason: "Pressão vendedora na última vela fechada." },
    timeframe: "5m",
    expiration: "5 min"
  });

  assert.equal(result.current.direction, "WAIT");
  assert.equal(result.next.direction, "SELL");
  assert.equal(result.next.timing, "NEXT_CANDLE");
  assert.equal(signalLabel(result.current), "AGUARDANDO CONFIRMAÇÃO");
  assert.equal(signalLabel(result.next), "VENDA");
});

test("não publica entrada intravela antes de confirmar os dois controles em cinco minutos", () => {
  const result = composeDualSignalViews({
    live: { source: "screen-capture", chartDetected: true, direction: "BUY", confidence: 82, entryTiming: "CURRENT_CANDLE" },
    trend: { direction: "BUY", confidence: 76 },
    timeframe: "5m",
    expiration: null
  });
  assert.equal(result.current.direction, "WAIT");
  assert.equal(result.next.direction, "BUY");
});

test("uma rejeição confirmada pode virar compra nesta vela sem alterar a previsão seguinte", () => {
  const result = composeDualSignalViews({
    live: {
      source: "screen-capture",
      chartDetected: true,
      direction: "BUY",
      confidence: 78,
      setup: "INTRACANDLE_REVERSAL",
      entryTiming: "CURRENT_CANDLE"
    },
    trend: { direction: "SELL", confidence: 72 },
    timeframe: "5m",
    expiration: "5 min"
  });
  assert.equal(signalLabel(result.current), "COMPRA");
  assert.equal(signalLabel(result.next), "VENDA");
});

test("a vela em formação publica uma possibilidade e a mantém até o fechamento", () => {
  const bodies = Array.from({ length: 6 }, (_, index) => ({
    direction: "BUY", centerX: 70 + index * 22, width: 12,
    y0: 110 - index * 6, y1: 110 - index * 6 + (index === 5 ? 9 : 19),
    height: index === 5 ? 10 : 20, upperWick: 0, lowerWick: 0
  }));
  const live = { ...classifyCandleSequence(bodies), source: "screen-capture" };
  const views = composeDualSignalViews({
    live, trend: { direction: "SELL", confidence: 71 },
    timeframe: "5m", expiration: "5 min"
  });
  const lock = createSignalCandleLock();
  const current = lock.resolve({ asset: "BNB", pane: "current", cycleKey: "10:00", view: views.current });
  const next = lock.resolve({ asset: "BNB", pane: "next", cycleKey: "10:00", view: views.next });
  assert.equal(signalLabel(current), "PROVÁVEL COMPRA");
  assert.equal(current.entryTiming, "CURRENT_CANDLE");
  assert.equal(signalLabel(next), "VENDA");
  const held = lock.resolve({ asset: "BNB", pane: "current", cycleKey: "10:00", view: { direction: "WAIT", confidence: 0 } });
  assert.equal(signalLabel(held), "PROVÁVEL COMPRA");
});
