import test from "node:test";
import assert from "node:assert/strict";
import { createScreenRevisionGuard } from "../dist/modules/screen-session.js";

test("uma leitura atrasada de outro ativo nunca substitui a revisão atual", () => {
  const guard = createScreenRevisionGuard();
  assert.equal(guard.accepts({ asset: "BITCOIN", assetRevision: 4 }), true);
  assert.equal(guard.accepts({ asset: "BNB", assetRevision: 5 }), true);
  assert.equal(guard.accepts({ asset: "BITCOIN", assetRevision: 4 }), false);
  assert.equal(guard.latest(), 5);
});

test("a identificação pendente e o ativo confirmado podem compartilhar a mesma revisão", () => {
  const guard = createScreenRevisionGuard();
  assert.equal(guard.accepts({ asset: null, assetPending: true, assetRevision: 7 }), true);
  assert.equal(guard.accepts({ asset: "XPL", assetPending: false, assetRevision: 7 }), true);
});
