import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CLOUD_PLANS } = require("../lib/cloud-plans");
const { enqueuePaidSession } = require("../lib/cloud-queue");

test("os passes usam os valores e tempos definidos para a Vice Cloud", () => {
  assert.equal(CLOUD_PLANS.session_15.currentPrice, 19.90);
  assert.equal(CLOUD_PLANS.session_15.durationMinutes, 15);
  assert.equal(CLOUD_PLANS.session_60.currentPrice, 49.90);
  assert.equal(CLOUD_PLANS.session_60.durationMinutes, 60);
  assert.equal(CLOUD_PLANS.session_60.priority, true);
});

test("um pagamento confirmado recebe posição persistida entre 550 e 967", async () => {
  let statement;
  let values;
  const connection = { async execute(sql, params) { statement = sql; values = params; return [{ affectedRows: 1 }]; } };
  await enqueuePaidSession(connection, { id: "payment-1", user_id: "user-1", plan_id: "session_15" });
  assert.match(statement, /display_position,display_total/);
  assert.equal(values[3], 15);
  assert.ok(values[4] >= 550 && values[4] <= 967, `posição ${values[4]} fora do intervalo`);
});

test("a confirmação repetida não cria outra posição para o mesmo pagamento", async () => {
  let statement;
  const connection = { async execute(sql) { statement = sql; return [{ affectedRows: 0 }]; } };
  await enqueuePaidSession(connection, { id: "payment-1", user_id: "user-1", plan_id: "session_60" });
  assert.match(statement, /INSERT IGNORE/);
  assert.match(statement, /payment_id/);
});

test("a sessão completa recebe faixa prioritária sem sair do intervalo informado", async () => {
  let values;
  const connection = { async execute(_sql, params) { values = params; return [{ affectedRows: 1 }]; } };
  await enqueuePaidSession(connection, { id: "payment-2", user_id: "user-2", plan_id: "session_60" });
  assert.equal(values[3], 60);
  assert.ok(values[4] >= 550 && values[4] <= 720, `posição prioritária ${values[4]} fora do intervalo`);
});
