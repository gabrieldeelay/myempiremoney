import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { normalizeSignalAsset, signalWindow } = require("../lib/manual-signals.js");

test("normaliza os ativos do sinal da mesma forma que a tela", () => {
  assert.equal(normalizeSignalAsset("BTCUSDT"), "BITCOIN");
  assert.equal(normalizeSignalAsset("BNB Crypto"), "BNB");
  assert.equal(normalizeSignalAsset("eurusd forex"), "EUR/USD");
  assert.equal(normalizeSignalAsset("AUD/JPY"), "AUD/JPY");
});

test("sinal da vela atual termina no próximo fechamento e o próximo dura mais um ciclo", () => {
  const now = new Date("2026-10-25T12:02:30.000Z");
  const current = signalWindow("CURRENT_CANDLE", now);
  const next = signalWindow("NEXT_CANDLE", now);
  assert.equal(current.expiresAt.toISOString(), "2026-10-25T12:05:04.000Z");
  assert.equal(next.expiresAt.toISOString(), "2026-10-25T12:10:04.000Z");
});

test("interface possui canal administrativo e proteção por ativo", () => {
  const admin = fs.readFileSync(new URL("../dist/admin/index.html", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../dist/modules/app.js", import.meta.url), "utf8");
  assert.match(admin, /data-admin-panel="signals"/);
  assert.match(admin, /ENVIAR SINAL AGORA/);
  assert.match(app, /normalizeAssetName\(activeAdminSignal\.asset\) === normalizeAssetName\(asset\)/);
  assert.match(app, /setInterval\(\(\) => pollAdminSignal\(\), 1000\)/);
});
