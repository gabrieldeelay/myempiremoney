import test from "node:test";
import assert from "node:assert/strict";
import { composeDualSignalViews, signalLabel } from "../dist/modules/dual-signal.js";

test("estado neutro em processamento continua como analisando", () => {
  assert.equal(signalLabel({ direction: "WAIT" }), "ANALISANDO...");
});

test("análise concluída sem entrada não parece um carregamento infinito", () => {
  assert.equal(signalLabel({ direction: "WAIT", signalKind: "no-opportunity" }), "SEM OPORTUNIDADE");
});

test("separa uma possível compra intravela de uma venda para a próxima vela", () => {
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

  assert.equal(result.current.direction, "BUY");
  assert.equal(result.current.possible, true);
  assert.equal(result.current.timing, "CURRENT_CANDLE");
  assert.equal(result.next.direction, "SELL");
  assert.equal(result.next.timing, "NEXT_CANDLE");
  assert.equal(signalLabel(result.current), "POSSÍVEL COMPRA");
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
