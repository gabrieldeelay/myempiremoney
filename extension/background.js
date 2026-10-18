const DEFAULTS = {
  allowedOrigins: [],
  assets: {},
  updateState: null,
  lastUpdateCheckAt: 0
};

const UPDATE_INTERVAL = 4 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULTS));
  await chrome.storage.local.set({ ...DEFAULTS, ...current });
});

async function checkForUpdates(force = false) {
  const stored = await chrome.storage.local.get(["lastUpdateCheckAt"]);
  if (!force && Date.now() - Number(stored.lastUpdateCheckAt || 0) < UPDATE_INTERVAL) {
    return { status: "recently_checked", checkedAt: stored.lastUpdateCheckAt };
  }
  if (typeof chrome.runtime.requestUpdateCheck !== "function") return { status: "unsupported" };
  await chrome.storage.local.set({ lastUpdateCheckAt: Date.now() });
  try {
    const result = await chrome.runtime.requestUpdateCheck();
    const status = result?.status || "no_update";
    const updateState = { status, version: result?.version || null, checkedAt: Date.now() };
    await chrome.storage.local.set({ updateState });
    return updateState;
  } catch (error) {
    const updateState = { status: "error", error: error.message, checkedAt: Date.now() };
    await chrome.storage.local.set({ updateState });
    return updateState;
  }
}

chrome.runtime.onStartup.addListener(() => { checkForUpdates(false); });
chrome.runtime.onUpdateAvailable.addListener(async details => {
  await chrome.storage.local.set({ updateState: { status: "reloading", version: details.version, checkedAt: Date.now() } });
  chrome.runtime.reload();
});

function originCanBeAuthorized(origin) {
  try {
    const url = new URL(origin);
    return url.hostname === "127.0.0.1"
      || url.hostname === "localhost"
      || url.hostname === "nossoatlas.com"
      || url.hostname === "www.nossoatlas.com";
  } catch {
    return false;
  }
}

function senderOrigin(sender) {
  try { return new URL(sender.url || sender.tab?.url || "").origin; } catch { return null; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "authorize_origin") {
      if (!originCanBeAuthorized(message.origin)) throw new Error("Este endereço não pode ser autorizado");
      const { allowedOrigins = [] } = await chrome.storage.local.get("allowedOrigins");
      const next = [...new Set([...allowedOrigins, message.origin])].slice(-5);
      await chrome.storage.local.set({ allowedOrigins: next });
      return { ok: true, allowedOrigins: next };
    }
    if (message?.type === "revoke_origin") {
      const { allowedOrigins = [] } = await chrome.storage.local.get("allowedOrigins");
      const next = allowedOrigins.filter(origin => origin !== message.origin);
      await chrome.storage.local.set({ allowedOrigins: next });
      return { ok: true, allowedOrigins: next };
    }
    if (message?.type === "is_origin_allowed") {
      const { allowedOrigins = [] } = await chrome.storage.local.get("allowedOrigins");
      return { allowed: allowedOrigins.includes(message.origin) };
    }
    if (message?.type === "get_settings") {
      return chrome.storage.local.get(Object.keys(DEFAULTS));
    }
    if (message?.type === "check_for_updates") {
      return checkForUpdates(message.force === true);
    }
    if (message?.type === "extension_info") {
      const stored = await chrome.storage.local.get(["updateState", "lastUpdateCheckAt"]);
      return { version: chrome.runtime.getManifest().version, ...stored };
    }
    if (message?.type === "dashboard_command") {
      const origin = senderOrigin(sender);
      const { allowedOrigins = [] } = await chrome.storage.local.get("allowedOrigins");
      if (!origin || !allowedOrigins.includes(origin)) throw new Error("Painel Atlas não autorizado");
      if (!sender.tab?.id) throw new Error("Aba do Atlas não encontrada");
      try {
        const response = await chrome.tabs.sendMessage(sender.tab.id, {
          type: "atlas_dashboard_command",
          command: message.command
        });
        if (!response) throw new Error("A Hezilex ainda não respondeu");
        return response;
      } catch (error) {
        throw new Error("A Hezilex ainda não está carregada dentro do painel.");
      }
    }
    if (message?.type === "state_update" && sender.url?.startsWith("https://app.hezilex.com/")) {
      const stored = await chrome.storage.local.get(["assets"]);
      const assets = stored.assets || {};
      const key = message.state?.asset || "current";
      assets[key] = { ...message.state, updatedAt: Date.now() };
      await chrome.storage.local.set({ assets });
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, { type: "dashboard_state_update", state: message.state }, { frameId: 0 }).catch(() => {});
      }
      return { ok: true };
    }
    if (message?.type === "financial_permission") {
      return { allowed: false, reason: "O Atlas apenas analisa e configura a tela; operações financeiras são sempre manuais." };
    }
    return { ok: false };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
