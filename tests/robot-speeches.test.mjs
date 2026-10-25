import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DEFAULT_ROBOT_SPEECHES } = require("../lib/robot-speech-defaults.js");

test("o catálogo inicial contém as falas contextualizadas", () => {
  assert.equal(DEFAULT_ROBOT_SPEECHES.length, 44);
  assert.ok(DEFAULT_ROBOT_SPEECHES.every(item => item.id && item.context && item.contextDescription && item.phrase));
});

test("há variações no mesmo contexto para permitir escolha aleatória", () => {
  const counts = DEFAULT_ROBOT_SPEECHES.reduce((result, item) => result.set(item.context, (result.get(item.context) || 0) + 1), new Map());
  assert.ok(counts.get("buy") >= 4);
  assert.ok(counts.get("sell") >= 4);
  assert.equal(counts.get("dragged"), 5);
  assert.ok(DEFAULT_ROBOT_SPEECHES.some(item => item.context === "hello" && item.phrase === "Calma aí, tô esperando a tela terminar de falar comigo."));
});
