import test from "node:test";
import assert from "node:assert/strict";
import {
  SAO_PAULO_TIME_ZONE,
  createSaoPauloCandleClock,
  saoPauloFiveMinuteCycle,
  signalEffectTone
} from "../dist/modules/candle-cycle.js";

test("sincroniza a vela de cinco minutos pelo horário de Brasília", () => {
  const cycle = saoPauloFiveMinuteCycle("2026-10-24T17:52:34.250Z");
  assert.equal(cycle.key, "2026-10-24T14:50");
  assert.equal(cycle.label, "14:50");
  assert.equal(cycle.timeZone, SAO_PAULO_TIME_ZONE);
  assert.equal(cycle.remainingMs, 145750);
});

test("inicia um novo ciclo nos minutos divisíveis por cinco", () => {
  assert.equal(saoPauloFiveMinuteCycle("2026-10-24T17:55:00.000Z").label, "14:55");
  assert.equal(saoPauloFiveMinuteCycle("2026-10-24T18:00:00.000Z").label, "15:00");
});

test("emite uma única atualização por vela mesmo após ressincronizar", () => {
  let now = Date.parse("2026-10-24T17:54:59.900Z");
  let scheduled = null;
  const events = [];
  const clock = createSaoPauloCandleClock({
    now: () => now,
    setTimer: callback => { scheduled = callback; return 1; },
    clearTimer: () => {},
    onCycle: cycle => events.push(cycle.key)
  });

  clock.start();
  now = Date.parse("2026-10-24T17:55:00.040Z");
  scheduled();
  clock.sync();
  assert.deepEqual(events, ["2026-10-24T14:55"]);

  now = Date.parse("2026-10-24T18:00:00.010Z");
  clock.sync();
  clock.sync();
  assert.deepEqual(events, ["2026-10-24T14:55", "2026-10-24T15:00"]);
  clock.stop();
});

test("mapeia os quatro sinais para identidades visuais distintas", () => {
  assert.equal(signalEffectTone("BUY", false), "buy");
  assert.equal(signalEffectTone("SELL", false), "sell");
  assert.equal(signalEffectTone("BUY", true), "possible-buy");
  assert.equal(signalEffectTone("SELL", true), "possible-sell");
  assert.equal(signalEffectTone("WAIT", false), "neutral");
});
