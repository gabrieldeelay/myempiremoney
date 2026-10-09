(() => {
  if (window.__atlasGuardDashboardBridgeLoaded) return;
  window.__atlasGuardDashboardBridgeLoaded = true;

  const DASHBOARD_SOURCE = "atlas-guard-dashboard";
  const EXTENSION_SOURCE = "atlas-guard-dashboard-extension";

  function post(payload) {
    window.postMessage({ source: EXTENSION_SOURCE, ...payload }, location.origin);
  }

  async function authorizeAndAnnounce() {
    try {
      const authorized = await chrome.runtime.sendMessage({
        type: "authorize_origin",
        origin: location.origin
      });
      if (!authorized?.ok) throw new Error(authorized?.error || "Falha na autorização");
      post({
        type: "ready",
        state: {
          bridge: "ready",
          mode: "stopped",
          asset: null,
          timeframe: null,
          expiration: null,
          analysis: {
            direction: "WAIT",
            confidence: 0,
            reason: "Extensão conectada; aguardando a Hezilex carregar"
          }
        }
      });
    } catch (error) {
      post({ type: "error", error: error.message });
    }
  }

  window.addEventListener("message", async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== DASHBOARD_SOURCE || event.data?.type !== "command") return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "dashboard_command",
        command: event.data
      });
      if (!response?.ok) throw new Error(response?.error || "A extensão não conseguiu executar o comando");
      post({
        type: response.type || "result",
        requestId: event.data.requestId,
        result: response.result,
        state: response.state
      });
    } catch (error) {
      post({ type: "error", requestId: event.data.requestId, error: error.message });
    }
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== "dashboard_state_update") return false;
    post({ type: "state", state: message.state });
    return false;
  });

  authorizeAndAnnounce();
})();
