import test from "node:test";
import assert from "node:assert/strict";
import { createSetupWarningTracker, minuteFromOcr, minuteValue } from "../dist/modules/setup-warning-state.js";

test("normaliza valores de minuto exibidos na interface", () => {
  assert.equal(minuteValue("1m"), 1);
  assert.equal(minuteValue("5 min"), 5);
  assert.equal(minuteValue("5 minutos"), 5);
  assert.equal(minuteValue("—"), null);
});

test("tolera erros comuns do OCR nos controles de minuto", () => {
  assert.equal(minuteFromOcr("1 min"), 1);
  assert.equal(minuteFromOcr("5M"), 5);
  assert.equal(minuteFromOcr("I mIN"), 1);
  assert.equal(minuteFromOcr("00:14"), null);
});

test("avisa quando gráfico e expiração não estão em cinco minutos", () => {
  const tracker = createSetupWarningTracker();
  const issues = tracker.update({ asset: "BITCOIN", timeframe: "1m", expiration: "1 min" });
  assert.deepEqual(issues.map(issue => issue.id), ["timeframe", "expiration"]);
  assert.equal(tracker.update({ asset: "BITCOIN", timeframe: "5m", expiration: "5 min" }).length, 0);
});

test("vou mudar silencia o aviso somente durante a visita atual ao ativo", () => {
  const tracker = createSetupWarningTracker();
  const wrong = { timeframe: "1m", expiration: "5 min" };
  tracker.update({ asset: "BITCOIN", ...wrong });
  tracker.dismiss("timeframe", "BITCOIN");
  assert.equal(tracker.update({ asset: "BITCOIN", ...wrong }).length, 0);

  tracker.update({ asset: "LITECOIN", ...wrong });
  const returned = tracker.update({ asset: "BITCOIN", ...wrong });
  assert.deepEqual(returned.map(issue => issue.id), ["timeframe"]);
});
