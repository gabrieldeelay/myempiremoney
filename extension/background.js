const DEFAULTS = {
  allowedOrigins: [],
  mode: "stopped",
  realOrdersEnabled: false,
  maxGales: 2,
  assets: {}
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULTS));
  await chrome.storage.local.set({ ...DEFAULTS, ...current, realOrdersEnabled: false, maxGales: Math.min(2, Number(current.maxGales ?? 2)) });
});

function originCanBeAuthorized(origin) {
  try {
    const url = new URL(origin);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname.endsWith(".vercel.app") || url.hostname.endsWith(".chatgpt.site");
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
        throw new Error("A extensão foi detectada, mas a Hezilex ainda não está carregada dentro do painel.");
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
      return { allowed: false, reason: "Execução financeira bloqueada nesta versão até validar seletores, feed e limites de risco." };
    }
    return { ok: false };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

