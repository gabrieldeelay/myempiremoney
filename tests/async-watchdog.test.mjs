import test from "node:test";
import assert from "node:assert/strict";
import { isDeadlineError, withDeadline } from "../dist/modules/async-watchdog.js";

test("uma tarefa normal termina antes do limite", async () => {
  assert.equal(await withDeadline(() => Promise.resolve("ok"), 50, "Teste"), "ok");
});

test("uma leitura travada é interrompida pelo watchdog", async () => {
  await assert.rejects(
    withDeadline(() => new Promise(() => {}), 15, "OCR"),
    error => isDeadlineError(error) && /OCR excedeu/.test(error.message)
  );
});
