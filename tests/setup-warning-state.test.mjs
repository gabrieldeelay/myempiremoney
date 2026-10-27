import test from "node:test";
import assert from "node:assert/strict";
import { createMinuteReadingStabilizer, createSetupWarningTracker, minuteFromOcr, minuteValue } from "../dist/modules/setup-warning-state.js";

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
  assert.equal(minuteFromOcr("1m 5 min"), null);
});

test("não aceita uma leitura isolada e descarta um valor antigo quando o OCR para de confirmar", () => {
  let clock = 0;
  const reading = createMinuteReadingStabilizer({ requiredHits: 2, staleAfterMs: 3000, now: () => clock });
  assert.equal(reading.update(1), null);
  clock = 800;
  assert.equal(reading.update(5), null);
  clock = 1600;
  assert.equal(reading.update(5), 5);
  clock = 5000;
  assert.equal(reading.update(null), null);
});

test("um 5m confirmado não vira aviso por ruídos isolados de 1m", () => {
  const reading = createMinuteReadingStabilizer({ requiredHits: 2, warningHits: 4 });
  assert.equal(reading.update(5), null);
  assert.equal(reading.update(5), 5);
  assert.equal(reading.update(1), 5);
  assert.equal(reading.update(1), 5);
  assert.equal(reading.update(1), 5);
  assert.equal(reading.update(1), 1);
});

test("trocar de ativo descarta o 5m confirmado do ativo anterior", () => {
  const reading = createMinuteReadingStabilizer({ requiredHits: 2, warningHits: 6 });
  assert.equal(reading.update(5), null);
  assert.equal(reading.update(5), 5);
  reading.reset();
  assert.equal(reading.update(1), null);
  assert.equal(reading.update(1), 1);
});

test("pode confirmar 1m já na primeira leitura ao abrir ou trocar o ativo", () => {
  const reading = createMinuteReadingStabilizer({ immediateInitialMismatch: true });
  assert.equal(reading.update(1), 1);
  reading.reset();
  assert.equal(reading.update(1), 1);
});

test("a expiração exige três leituras iguais para não transformar o contador em falso aviso", () => {
  const reading = createMinuteReadingStabilizer({ requiredHits: 3, warningHits: 7 });
  assert.equal(reading.update(1), null);
  assert.equal(reading.update(1), null);
  assert.equal(reading.update(5), null, "um 5 min visível deve invalidar a hipótese criada pelo contador");
  assert.equal(reading.update(5), null);
  assert.equal(reading.update(5), 5);
});

test("avisa quando gráfico e expiração não estão em cinco minutos", () => {
  const tracker = createSetupWarningTracker();
  const issues = tracker.update({ asset: "BITCOIN", timeframe: "1m", expiration: "1 min" });
  assert.deepEqual(issues.map(issue => issue.id), ["timeframe"], "a aba deve exibir somente um cartão de ajuste");
  assert.equal(tracker.update({ asset: "BITCOIN", timeframe: "5m", expiration: "5 min" }).length, 0);
});

test("avisa sobre o gráfico mesmo quando a expiração ainda não foi reconhecida", () => {
  const tracker = createSetupWarningTracker();
  const issues = tracker.update({ asset: "BNB", timeframe: "1m", expiration: null });
  assert.deepEqual(issues.map(issue => issue.id), ["timeframe"]);
});

test("depois de fechado o aviso não reaparece ao trocar de ativo", () => {
  const tracker = createSetupWarningTracker();
  const wrong = { timeframe: "1m", expiration: "5 min" };
  tracker.update({ asset: "BITCOIN", ...wrong });
  tracker.dismiss("timeframe", "BITCOIN");
  assert.equal(tracker.update({ asset: "BITCOIN", ...wrong }).length, 0);

  tracker.update({ asset: "LITECOIN", ...wrong });
  const returned = tracker.update({ asset: "BITCOIN", ...wrong });
  assert.equal(returned.length, 0);
});

test("o aviso continua silenciado após recarregar a mesma aba", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const wrong = { asset: "BNB", timeframe: "1m", expiration: "5 min" };
  const firstLoad = createSetupWarningTracker({ storage });
  assert.equal(firstLoad.update(wrong).length, 1);
  const reloaded = createSetupWarningTracker({ storage });
  assert.equal(reloaded.update(wrong).length, 0);
});

test("uma nova aba pode exibir novamente o lembrete", () => {
  const wrong = { asset: "BNB", timeframe: "1m", expiration: "5 min" };
  const storageForNewTab = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
  };
  assert.equal(createSetupWarningTracker({ storage: storageForNewTab() }).update(wrong).length, 1);
  assert.equal(createSetupWarningTracker({ storage: storageForNewTab() }).update(wrong).length, 1);
});
