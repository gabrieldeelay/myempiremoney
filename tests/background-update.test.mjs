import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const data = {};
let messageListener;
let availableListener;
let reloaded = false;

const chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter(key => key in data).map(key => [key, data[key]]));
      },
      async set(values) { Object.assign(data, values); }
    }
  },
  runtime: {
    getManifest: () => ({ version: "2.3.0" }),
    requestUpdateCheck: async () => ({ status: "update_available", version: "2.4.0" }),
    reload: () => { reloaded = true; },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onUpdateAvailable: { addListener(listener) { availableListener = listener; } },
    onMessage: { addListener(listener) { messageListener = listener; } }
  },
  tabs: { sendMessage: async () => ({}) }
};

vm.runInNewContext(source, { chrome, URL, Date, console, setTimeout, clearTimeout });
assert.equal(typeof messageListener, "function");
assert.equal(typeof availableListener, "function");

const response = await new Promise(resolve => {
  const keepOpen = messageListener({ type: "check_for_updates", force: true }, {}, resolve);
  assert.equal(keepOpen, true);
});
assert.equal(response.status, "update_available");
assert.equal(response.version, "2.4.0");

await availableListener({ version: "2.4.0" });
assert.equal(reloaded, true);
assert.equal(data.updateState.status, "reloading");

console.log("background update check: ok");
