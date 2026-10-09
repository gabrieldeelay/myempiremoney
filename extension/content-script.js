(() => {
  if (window.__atlasGuardBridgeLoaded) return;
  window.__atlasGuardBridgeLoaded = true;

  const BRIDGE_SOURCE = "atlas-guard-extension";
  const DASHBOARD_SOURCE = "atlas-guard-dashboard";
  const MAX_MARKINGS = 8;
  const internal = {
    mode: "stopped",
    task: Promise.resolve(),
    lastUserActivity: Date.now(),
    markings: [],
    state: {
      bridge: "ready",
      mode: "stopped",
      asset: null,
      timeframe: null,
      expiration: null,
      userActive: false,
      chartDetected: false,
      analysis: { direction: "WAIT", confidence: 0, reason: "Aguardando identificação segura do feed de candles" },
      protection: { active: false, level: null },
      gale: { current: 0, maximum: 2 },
      realOrderExecution: false,
      lastInspectionAt: null
    }
  };

  for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    addEventListener(eventName, () => { internal.lastUserActivity = Date.now(); }, { capture: true, passive: true });
  }

  function compact(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function visible(element) {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && box.width > 1 && box.height > 1;
  }

  function parentOrigin() {
    try { return document.referrer ? new URL(document.referrer).origin : null; } catch { return null; }
  }

  async function originAllowed(origin) {
    if (!origin) return false;
    const response = await chrome.runtime.sendMessage({ type: "is_origin_allowed", origin });
    return Boolean(response?.allowed);
  }

  function inspect() {
    const nodes = [...document.querySelectorAll('button,[role="button"],a,span,div')]
      .filter(visible)
      .map(element => ({ element, text: compact(element.textContent).slice(0, 80), className: String(element.className || "").slice(0, 120) }))
      .filter(item => item.text && item.text.length <= 80)
      .slice(0, 1000);
    const bodyText = compact(document.body?.innerText).slice(0, 18000);
    const assetMatch = bodyText.match(/\b(?:EUR|GBP|AUD|NZD|USD|CAD|CHF|JPY|BTC|ETH|SOL|XAU)[\/ -](?:USD|EUR|GBP|JPY|CAD|CHF)\b/i);
    const expirationMatch = bodyText.match(/Expira[cç][aã]o.{0,70}?(\d+\s*(?:min|m))/i);
    const timeframes = nodes.filter(item => /^(?:1m|5m|15m|30m|1h|4h)$/i.test(item.text));
    internal.state.asset = assetMatch?.[0] || null;
    internal.state.timeframe = timeframes.find(item => /active|selected|checked|current/i.test(item.className))?.text || null;
    internal.state.expiration = expirationMatch?.[1] || null;
    internal.state.chartDetected = Boolean(document.querySelector("canvas,svg"));
    internal.state.userActive = Date.now() - internal.lastUserActivity < 3500;
    internal.state.lastInspectionAt = new Date().toISOString();
    if (!internal.state.chartDetected) internal.state.analysis.reason = "Traderoom ainda não detectada";
    else if (internal.state.analysis.confidence === 0) internal.state.analysis.reason = "Gráfico detectado; aguardando mapeamento seguro do feed real";
    chrome.runtime.sendMessage({ type: "state_update", state: internal.state }).catch(() => {});
    return { ...internal.state, capabilities: { timeframeCandidates: timeframes.length, chartCanvas: document.querySelectorAll("canvas").length, chartSvg: document.querySelectorAll("svg").length } };
  }

  function ensureDefaults() {
    if (Date.now() - internal.lastUserActivity < 3500) return { changed: false, blocked: true, reason: "Interação manual recente" };
    const exact = [...document.querySelectorAll('button,[role="button"],a,span,div')].filter(visible).filter(element => compact(element.textContent) === "5m");
    const ranked = exact.map(element => {
      const target = element.closest('button,[role="button"],a') || element;
      const box = target.getBoundingClientRect();
      const active = /active|selected|checked|current/i.test(String(target.className || "")) || target.getAttribute("aria-pressed") === "true";
      return { target, active, score: (box.top < innerHeight * .45 ? 10 : 0) + (box.width < 160 ? 5 : 0) + (active ? 20 : 0) };
    }).sort((a, b) => b.score - a.score);
    let changed = false;
    if (ranked[0] && !ranked[0].active) { ranked[0].target.click(); changed = true; }
    const expirationVerified = /Expira[cç][aã]o[\s\S]{0,90}?5\s*min/i.test(document.body?.innerText || "");
    setTimeout(inspect, 450);
    return {
      changed,
      blocked: false,
      timeframe: { found: Boolean(ranked[0]), verified: Boolean(ranked[0]?.active || changed) },
      expiration: { verified: expirationVerified, changed: false, reason: expirationVerified ? null : "Controle ainda não mapeado com segurança" }
    };
  }

  function chartHost() {
    const anchor = document.querySelector("canvas") || document.querySelector("svg");
    if (!anchor) return null;
    let host = anchor.parentElement;
    while (host && host !== document.body) {
      const box = host.getBoundingClientRect();
      if (box.width > innerWidth * .35 && box.height > innerHeight * .25) return host;
      host = host.parentElement;
    }
    return anchor.parentElement;
  }

  function renderMarkings(lines = []) {
    const host = chartHost();
    if (!host) return { rendered: 0, reason: "Gráfico não encontrado" };
    internal.markings = lines.slice(0, MAX_MARKINGS).filter(line => ["LTA", "LTB", "HORIZONTAL", "PROTECTION"].includes(line.type));
    let svg = host.querySelector(":scope > #__atlas_guard_chart_overlay");
    if (!svg) {
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "__atlas_guard_chart_overlay";
      svg.setAttribute("viewBox", "0 0 1000 600");
      svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000;overflow:visible";
      host.appendChild(svg);
    }
    svg.replaceChildren();
    for (const line of internal.markings) {
      const element = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const horizontal = line.type === "HORIZONTAL" || line.type === "PROTECTION";
      element.setAttribute("x1", String(horizontal ? 0 : Math.max(0, Math.min(1, line.x1 ?? 0)) * 1000));
      element.setAttribute("y1", String(Math.max(0, Math.min(1, line.y1 ?? .5)) * 600));
      element.setAttribute("x2", String(horizontal ? 1000 : Math.max(0, Math.min(1, line.x2 ?? 1)) * 1000));
      element.setAttribute("y2", String(Math.max(0, Math.min(1, line.y2 ?? line.y1 ?? .5)) * 600));
      element.setAttribute("stroke", line.type === "PROTECTION" ? "#ffb84d" : line.type === "LTB" ? "#ff647c" : "#b8f53f");
      element.setAttribute("stroke-width", line.type === "PROTECTION" ? "2.5" : "2");
      element.setAttribute("stroke-dasharray", horizontal ? "8 6" : "0");
      svg.appendChild(element);
    }
    return { rendered: internal.markings.length };
  }

  function cleanupExpiredMarkings() {
    const now = Date.now();
    const active = internal.markings.filter(line => !line.expiresAt || line.expiresAt > now);
    if (active.length !== internal.markings.length) renderMarkings(active);
  }

  function injectAnalysisPanel() {
    let panel = document.getElementById("__atlas_guard_panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "__atlas_guard_panel";
      panel.style.cssText = "position:fixed;z-index:2147483647;left:18px;right:18px;bottom:16px;min-height:68px;padding:12px 16px;border:1px solid rgba(184,245,63,.34);border-radius:12px;background:rgba(5,15,27,.94);box-shadow:0 18px 48px rgba(0,0,0,.45);color:#edf6ff;font-family:Inter,system-ui,sans-serif;pointer-events:none;display:flex;align-items:center;justify-content:space-between;gap:18px";
      document.documentElement.appendChild(panel);
    }
    const direction = internal.state.analysis.direction === "BUY" ? "COMPRA" : internal.state.analysis.direction === "SELL" ? "VENDA" : "AGUARDAR";
    const color = direction === "COMPRA" ? "#47dfa0" : direction === "VENDA" ? "#ff647c" : "#f4b955";
    panel.innerHTML = `<div><div style="color:#b8f53f;font-size:9px;font-weight:800;letter-spacing:.14em">ATLAS GUARD · EXTENSÃO CONECTADA</div><strong style="display:block;margin-top:6px;font-size:13px">${internal.state.analysis.reason}</strong></div><div style="text-align:right"><span style="display:block;color:#8195ac;font-size:8px">DIREÇÃO</span><b style="display:block;margin-top:5px;color:${color};font-size:12px">${direction}</b></div>`;
    return true;
  }

  async function dispatchCommand(command) {
    if (command.action === "inspect") return inspect();
    if (command.action === "ensure_defaults") return ensureDefaults();
    if (command.action === "overlay") return injectAnalysisPanel();
    if (command.action === "set_markings") return renderMarkings(command.lines || []);
    if (command.action === "start") { internal.mode = "running"; internal.state.mode = "running"; injectAnalysisPanel(); return inspect(); }
    if (command.action === "pause") { internal.mode = "paused"; internal.state.mode = "paused"; return inspect(); }
    if (command.action === "stop") { internal.mode = "stopped"; internal.state.mode = "stopped"; internal.state.realOrderExecution = false; return inspect(); }
    if (["buy", "sell", "place_order"].includes(command.action)) {
      const permission = await chrome.runtime.sendMessage({ type: "financial_permission" });
      throw new Error(permission?.reason || "Execução financeira bloqueada");
    }
    throw new Error("Ação desconhecida");
  }

  function enqueue(command) {
    const run = internal.task.then(() => dispatchCommand(command));
    internal.task = run.catch(() => {});
    return run;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "atlas_dashboard_command") return false;
    enqueue(message.command)
      .then(result => sendResponse({ ok: true, type: "result", result, state: internal.state }))
      .catch(error => sendResponse({ ok: false, type: "error", error: error.message, state: internal.state }));
    return true;
  });

  addEventListener("message", async event => {
    if (event.source !== window.parent || event.data?.source !== DASHBOARD_SOURCE || event.data?.type !== "command") return;
    if (!(await originAllowed(event.origin))) return;
    try {
      const result = await enqueue(event.data);
      window.parent.postMessage({ source: BRIDGE_SOURCE, type: "result", requestId: event.data.requestId, result, state: internal.state }, event.origin);
    } catch (error) {
      window.parent.postMessage({ source: BRIDGE_SOURCE, type: "error", requestId: event.data.requestId, error: error.message, state: internal.state }, event.origin);
    }
  });

  setInterval(() => {
    cleanupExpiredMarkings();
    if (internal.mode === "running") {
      inspect();
      injectAnalysisPanel();
    }
  }, 2000);

  (async () => {
    const origin = parentOrigin();
    if (await originAllowed(origin)) {
      inspect();
      window.parent.postMessage({ source: BRIDGE_SOURCE, type: "ready", state: internal.state }, origin);
    }
  })();
})();

