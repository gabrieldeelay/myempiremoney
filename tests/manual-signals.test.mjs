import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { createManualSignal, normalizeSignalAsset, signalWindow } = require("../lib/manual-signals.js");

test("normaliza os ativos do sinal da mesma forma que a tela", () => {
  assert.equal(normalizeSignalAsset("BTCUSDT"), "BITCOIN");
  assert.equal(normalizeSignalAsset("BNB Crypto"), "BNB");
  assert.equal(normalizeSignalAsset("eurusd forex"), "EUR/USD");
  assert.equal(normalizeSignalAsset("AUD/JPY"), "AUD/JPY");
});

test("todo sinal manual termina exatamente no próximo fechamento de cinco minutos", () => {
  const now = new Date("2026-10-25T12:02:30.000Z");
  const current = signalWindow("CURRENT_CANDLE", now);
  const next = signalWindow("NEXT_CANDLE", now);
  assert.equal(current.expiresAt.toISOString(), "2026-10-25T12:05:00.000Z");
  assert.equal(next.expiresAt.toISOString(), "2026-10-25T12:05:00.000Z");
  assert.equal(signalWindow("CURRENT_CANDLE", new Date("2026-10-25T12:05:00.000Z")).expiresAt.toISOString(), "2026-10-25T12:10:00.000Z");
});

test("interface possui canal administrativo e proteção por ativo", () => {
  const admin = fs.readFileSync(new URL("../dist/admin/index.html", import.meta.url), "utf8");
  const adminJs = fs.readFileSync(new URL("../dist/modules/admin.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../dist/modules/app.js", import.meta.url), "utf8");
  assert.match(admin, /data-admin-panel="signals"/);
  assert.match(admin, /ENVIAR SINAL AGORA/);
  assert.match(app, /normalizeAssetName\(activeAdminSignal\.asset\) === normalizeAssetName\(asset\)/);
  assert.match(app, /setInterval\(\(\) => pollAdminSignal\(\), 500\)/);
  assert.match(app, /views\[otherPane\] = adminSignalWaitingView\(adminSignal\)/);
  assert.match(app, /else if \(manualOverride\) return/);
  assert.match(adminJs, /BroadcastChannel\("atlas-manual-signals"\)/);
  assert.match(adminJs, /localStorage\.setItem\("atlas-manual-signal-event"/);
});

test("a criação usa o relógio UTC do MySQL e não serializa o fuso do servidor", () => {
  const source = fs.readFileSync(new URL("../lib/manual-signals.js", import.meta.url), "utf8");
  assert.match(source, /DATE_ADD\(UTC_TIMESTAMP\(\), INTERVAL \(300 - MOD\(UNIX_TIMESTAMP\(UTC_TIMESTAMP\(\)\), 300\)\) SECOND\)/);
  assert.match(source, /TIMESTAMPDIFF\(MICROSECOND, UTC_TIMESTAMP\(3\), expires_at\)/);
});

test("a transmissão criada já retorna o tempo restante para entrega imediata", async () => {
  const calls = [];
  const now = new Date("2026-10-27T12:00:00.000Z");
  const db = { execute: async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT")) return [[{
      id: "signal-1", asset: "LITECOIN", direction: "SELL", timing: "CURRENT_CANDLE",
      confidence: 95, status: "active", starts_at: now, expires_at: new Date(now.getTime() + 120000),
      remaining_ms: 120000, created_at: now
    }]];
    return [[]];
  } };
  const signal = await createManualSignal(db, { asset: "LTC", direction: "SELL", timing: "CURRENT_CANDLE", confidence: 95 }, "admin-1");
  assert.equal(signal.asset, "LITECOIN");
  assert.equal(signal.remainingMs, 120000);
  assert.match(calls[1].sql, /300 - MOD/);
  assert.deepEqual(calls[1].params.slice(1, 5), ["LITECOIN", "SELL", "CURRENT_CANDLE", 95]);
});
