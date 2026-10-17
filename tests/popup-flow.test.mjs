import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");

async function renderPopup({ tabUrl, installedVersion, publicVersion, allowedOrigins = [] }) {
  const ids = ["dot", "statusEyebrow", "statusTitle", "message", "installedVersion", "latestVersion", "updateBadge", "primaryAction", "openAtlas", "headerVersion"];
  const elements = Object.fromEntries(ids.map(id => [id, {
    id,
    textContent: "",
    className: "",
    disabled: false,
    addEventListener(type, listener) { this[`on${type}`] = listener; }
  }]));
  const context = vm.createContext({
    URL,
    Date,
    console,
    setTimeout,
    clearTimeout,
    document: { getElementById: id => elements[id] },
    window: { close() {} },
    fetch: async () => ({ ok: true, json: async () => ({ available: true, publicVersion, storeUrl: "https://example.test/store" }) }),
    chrome: {
      runtime: {
        getManifest: () => ({ version: installedVersion }),
        sendMessage: async message => message.type === "get_settings" ? { allowedOrigins } : { status: "no_update" }
      },
      tabs: {
        query: async () => [{ id: 7, url: tabUrl }],
        create: async () => ({}),
        reload: async () => ({})
      }
    }
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setTimeout(resolve, 0));
  return elements;
}

{
  const ui = await renderPopup({ tabUrl: "https://web.whatsapp.com/", installedVersion: "2.3.0", publicVersion: "2.3.0" });
  assert.equal(ui.primaryAction.textContent, "Abrir o Atlas");
  assert.equal(ui.statusTitle.textContent, "Atlas pronto");
}

{
  const origin = "https://atlas-guard-trading.vercel.app";
  const ui = await renderPopup({ tabUrl: `${origin}/`, installedVersion: "2.3.0", publicVersion: "2.3.0", allowedOrigins: [origin] });
  assert.equal(ui.primaryAction.textContent, "Reconectar painel");
  assert.equal(ui.updateBadge.textContent, "ATUALIZADA");
}

{
  const origin = "https://nossoatlas.com";
  const ui = await renderPopup({ tabUrl: `${origin}/`, installedVersion: "2.5.2", publicVersion: "2.5.2", allowedOrigins: [origin] });
  assert.equal(ui.primaryAction.textContent, "Reconectar painel");
  assert.equal(ui.updateBadge.textContent, "ATUALIZADA");
}

{
  const ui = await renderPopup({ tabUrl: "https://atlas-guard-trading.vercel.app/", installedVersion: "2.3.0", publicVersion: "2.4.0" });
  assert.equal(ui.primaryAction.textContent, "Atualizar agora");
  assert.equal(ui.latestVersion.textContent, "v2.4.0");
}

console.log("popup update flow: ok");
