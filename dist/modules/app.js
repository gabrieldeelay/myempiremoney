const HEZILEX_ORIGIN = "https://app.hezilex.com";
const DASHBOARD_SOURCE = "atlas-guard-dashboard";
const EXTENSION_SOURCE = "atlas-guard-extension";
const $ = id => document.getElementById(id);
const frame = $("hezilexFrame");
const loader = $("frameLoader");
const connection = $("connectionState");
const connectionText = $("connectionText");
const notice = $("securityNotice");
const mobileWarning = $("mobileWarning");
const pending = new Map();
let extensionReady = false;
let sequence = 0;

frame.addEventListener("load", () => {
  loader.classList.add("hidden");
  connection.classList.add("ready");
  connectionText.textContent = "Interface oficial carregada";
  setTimeout(() => verifyExtension(false), 900);
});

$("reloadFrame").addEventListener("click", () => {
  loader.classList.remove("hidden");
  connection.classList.remove("ready");
  connectionText.textContent = "Recarregando Hezilex oficial…";
  extensionReady = false;
  renderOffline("Aguardando recarga");
  frame.src = "https://app.hezilex.com/login";
});

$("closeNotice").addEventListener("click", () => notice.classList.add("hidden"));

function setAgentControls(enabled) {
  for (const id of ["inspectAgent", "ensureDefaults", "showOverlay", "startAgent", "pauseAgent", "emergencyStop"]) {
    $(id).disabled = !enabled;
  }
}

function renderState(state = {}) {
  extensionReady = true;
  const mode = state.mode || state.robot || "ready";
  $("agentDot").className = `agent-dot ${mode === "running" ? "busy" : "online"}`;
  $("agentStatus").textContent = mode === "running" ? "Analisando" : mode === "paused" ? "Pausada" : "Conectada";
  $("agentAsset").textContent = state.asset || "Não detectado";
  $("agentTimeframe").textContent = state.timeframe || "Não verificado";
  $("agentExpiration").textContent = state.expiration || "Não verificada";
  $("analysisDirection").textContent = state.analysis?.direction === "BUY" ? "COMPRA" : state.analysis?.direction === "SELL" ? "VENDA" : "AGUARDAR";
  $("analysisReason").textContent = state.analysis?.reason || "Aguardando dados reais";
  setAgentControls(true);
}

function renderOffline(message = "Não detectada · autorize no ícone da extensão") {
  extensionReady = false;
  $("agentDot").className = "agent-dot offline";
  $("agentStatus").textContent = message;
  setAgentControls(false);
}

function sendCommand(action, payload = {}, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    if (!frame.contentWindow) return reject(new Error("Hezilex ainda não carregou"));
    const requestId = `atlas-${Date.now()}-${++sequence}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Extensão não respondeu. Autorize este painel e recarregue a página."));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    frame.contentWindow.postMessage({ source: DASHBOARD_SOURCE, type: "command", requestId, action, ...payload }, HEZILEX_ORIGIN);
  });
}

window.addEventListener("message", event => {
  if (event.origin !== HEZILEX_ORIGIN || event.source !== frame.contentWindow || event.data?.source !== EXTENSION_SOURCE) return;
  if (event.data.type === "ready") {
    renderState(event.data.state);
    return;
  }
  const item = pending.get(event.data.requestId);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(event.data.requestId);
  if (event.data.state) renderState(event.data.state);
  if (event.data.type === "error") item.reject(new Error(event.data.error || "Falha na extensão"));
  else item.resolve(event.data.result);
});

async function verifyExtension(showMessage = true) {
  const button = $("verifyExtension");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Verificando…";
  try {
    const result = await sendCommand("inspect");
    renderState(result);
  } catch (error) {
    renderOffline(showMessage ? error.message : undefined);
    if (showMessage) $("analysisReason").textContent = "Clique no ícone Atlas Guard Bridge, autorize este site e recarregue.";
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function command(action, button) {
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Processando…"; }
  try {
    const result = await sendCommand(action);
    if (result?.analysis || result?.bridge) renderState(result);
    return result;
  } catch (error) {
    $("analysisReason").textContent = error.message;
    throw error;
  } finally {
    if (button) { button.textContent = original; button.disabled = !extensionReady; }
  }
}

$("verifyExtension").addEventListener("click", () => verifyExtension(true));
$("inspectAgent").addEventListener("click", event => command("inspect", event.currentTarget));
$("ensureDefaults").addEventListener("click", event => command("ensure_defaults", event.currentTarget));
$("showOverlay").addEventListener("click", event => command("overlay", event.currentTarget));
$("startAgent").addEventListener("click", event => command("start", event.currentTarget));
$("pauseAgent").addEventListener("click", event => command("pause", event.currentTarget));
$("emergencyStop").addEventListener("click", event => command("stop", event.currentTarget));

setTimeout(() => {
  if (window.innerWidth <= 800) mobileWarning.classList.add("show");
}, 9000);

