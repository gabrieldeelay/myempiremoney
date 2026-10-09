const HEZILEX_ORIGIN = "https://app.hezilex.com";
const DASHBOARD_SOURCE = "atlas-guard-dashboard";
const EXTENSION_SOURCE = "atlas-guard-extension";
const DIRECT_EXTENSION_SOURCE = "atlas-guard-dashboard-extension";
const MINIMUM_BALANCE = 500;
const $ = id => document.getElementById(id);

const frame = $("hezilexFrame");
const loader = $("frameLoader");
const connection = $("connectionState");
const connectionText = $("connectionText");
const notice = $("securityNotice");
const mobileWarning = $("mobileWarning");
const supportCard = $("supportCard");
const supportLauncher = $("openSupport");
const workspace = document.querySelector(".workspace");
const startGate = $("startGate");
const pending = new Map();
let extensionReady = false;
let bridgeDetected = false;
let sequence = 0;
let verificationInFlight = false;
let silentMisses = 0;
let startPromptDismissed = false;
let bridgeState = {
  mode: "stopped",
  balance: null,
  analysis: { direction: "WAIT", confidence: 0, reason: "Aguardando extensão" },
  markings: { lta: false, ltb: false, total: 0 },
  defaults: { timeframe: false, expiration: false },
  events: []
};

function loadLogs() {
  try {
    const stored = JSON.parse(localStorage.getItem("atlas-robot-log") || "[]");
    return Array.isArray(stored) ? stored.slice(0, 120) : [];
  } catch { return []; }
}

let robotLogs = loadLogs();

function saveLogs() {
  localStorage.setItem("atlas-robot-log", JSON.stringify(robotLogs.slice(0, 120)));
}

function formatClock(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? "agora" : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderLogs() {
  const list = $("robotLog");
  list.replaceChildren();
  $("historyEmpty").classList.toggle("hidden", robotLogs.length > 0);
  $("historyCount").textContent = `${robotLogs.length} ${robotLogs.length === 1 ? "ação" : "ações"}`;
  for (const entry of robotLogs) {
    const item = document.createElement("li");
    item.className = entry.level || "info";
    const copy = document.createElement("div");
    copy.className = "log-copy";
    const header = document.createElement("header");
    const title = document.createElement("b");
    const time = document.createElement("time");
    const detail = document.createElement("p");
    title.textContent = entry.title;
    time.textContent = formatClock(entry.at);
    detail.textContent = entry.detail;
    header.append(title, time);
    copy.append(header, detail);
    item.append(document.createElement("span"), copy);
    list.append(item);
  }
}

function addLog(title, detail, level = "info", key = null, at = Date.now()) {
  const id = key || `${title}:${detail}`;
  const recent = robotLogs.find(entry => entry.id === id && Math.abs(new Date(at).getTime() - new Date(entry.at).getTime()) < 12000);
  if (recent) return;
  robotLogs.unshift({ id, title: String(title || "Atualização"), detail: String(detail || "Sem detalhes"), level, at });
  robotLogs = robotLogs.slice(0, 120);
  saveLogs();
  renderLogs();
}

function ingestEvents(events = []) {
  for (const event of events) addLog(event.title, event.detail, event.level, event.id, event.at);
}

function setHistoryCollapsed(collapsed) {
  workspace.classList.toggle("history-collapsed", collapsed);
  $("toggleHistory").setAttribute("aria-expanded", String(!collapsed));
  $("toggleHistory").setAttribute("aria-label", collapsed ? "Abrir histórico" : "Minimizar histórico");
  localStorage.setItem("atlas-history-collapsed", collapsed ? "1" : "0");
}

const storedHistoryState = localStorage.getItem("atlas-history-collapsed");
setHistoryCollapsed(storedHistoryState === "1" || (storedHistoryState === null && innerWidth <= 800));
$("toggleHistory").addEventListener("click", () => setHistoryCollapsed(!workspace.classList.contains("history-collapsed")));
$("clearHistory").addEventListener("click", () => {
  robotLogs = [];
  saveLogs();
  renderLogs();
  addLog("Histórico limpo", "O registro local foi reiniciado.", "info", `clear-${Date.now()}`);
});
renderLogs();

frame.addEventListener("load", () => {
  loader.classList.add("hidden");
  connection.classList.add("ready");
  connectionText.textContent = "Interface oficial carregada";
  addLog("Hezilex carregada", "A janela oficial terminou de carregar.", "success", "frame-loaded");
  setTimeout(() => verifyExtension(false), 900);
});

$("reloadFrame").addEventListener("click", () => {
  loader.classList.remove("hidden");
  connection.classList.remove("ready");
  connectionText.textContent = "Recarregando Hezilex oficial…";
  frame.src = "https://app.hezilex.com/login";
  addLog("Recarga solicitada", "A interface oficial da Hezilex está sendo recarregada.", "warning", `reload-${Date.now()}`);
});

$("closeNotice").addEventListener("click", () => notice.classList.add("hidden"));

function setSupportOpen(open) {
  supportCard.classList.toggle("closed", !open);
  supportLauncher.classList.toggle("show", !open);
  localStorage.setItem("atlas-support-closed", open ? "0" : "1");
}

function renderSupport(connected) {
  $("supportState").classList.toggle("connected", connected);
  supportLauncher.classList.toggle("connected", connected);
  supportLauncher.textContent = connected ? "✓" : "?";
  $("supportTitle").textContent = connected ? "Extensão conectada" : "Extensão opcional não detectada";
  $("supportText").textContent = connected
    ? "Conexão ativa. O Atlas monitora a Hezilex sem capturar sua senha."
    : "A Hezilex continua disponível em modo manual. Instale a extensão para habilitar o monitor do Atlas.";
}

$("closeSupport").addEventListener("click", () => setSupportOpen(false));
supportLauncher.addEventListener("click", () => setSupportOpen(true));
$("toggleInstallHelp").addEventListener("click", event => {
  const help = $("installHelp");
  help.hidden = !help.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!help.hidden));
  event.currentTarget.textContent = help.hidden ? "Como instalar" : "Ocultar instruções";
});
setSupportOpen(localStorage.getItem("atlas-support-closed") !== "1");
renderSupport(false);

function formatBalance(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function isBalanceAllowed() {
  return bridgeState.balance != null && bridgeState.balance !== "" && Number.isFinite(Number(bridgeState.balance)) && Number(bridgeState.balance) > MINIMUM_BALANCE;
}

function setAgentControls() {
  const connected = extensionReady;
  $("startAgent").disabled = !connected || !isBalanceAllowed() || bridgeState.mode === "running";
  $("pauseAgent").disabled = !connected || bridgeState.mode !== "running";
  $("emergencyStop").disabled = !connected || bridgeState.mode === "stopped";
}

function syncStartGate() {
  const shouldOpen = extensionReady && isBalanceAllowed() && bridgeState.mode === "stopped" && !startPromptDismissed;
  startGate.hidden = !shouldOpen;
}

function updateMonitorPulse() {
  const pulse = $("monitorPulse");
  const inspected = bridgeState.lastInspectionAt ? new Date(bridgeState.lastInspectionAt).getTime() : 0;
  const fresh = inspected && Date.now() - inspected < 7000;
  pulse.classList.toggle("live", Boolean(fresh));
  pulse.textContent = fresh ? `Monitorando agora · ${formatClock(inspected)}` : bridgeDetected ? "Extensão ativa · aguardando Traderoom" : "Monitor aguardando extensão";
}

function renderState(state = {}) {
  const previous = bridgeState;
  bridgeState = {
    ...bridgeState,
    ...state,
    analysis: { ...bridgeState.analysis, ...(state.analysis || {}) },
    markings: { ...bridgeState.markings, ...(state.markings || {}) },
    defaults: { ...bridgeState.defaults, ...(state.defaults || {}) }
  };
  extensionReady = true;
  bridgeDetected = true;
  silentMisses = 0;
  renderSupport(true);
  if (robotLogs.length === 0) {
    $("historyEmpty").querySelector("strong").textContent = "Extensão conectada";
    $("historyEmpty").querySelector("small").textContent = "Aguardando dados da Traderoom.";
  }

  const mode = bridgeState.mode || "stopped";
  $("agentDot").className = `agent-dot ${mode === "running" ? "busy" : "online"}`;
  $("agentStatus").textContent = mode === "running" ? "Monitorando oportunidade" : mode === "paused" ? "Pausado" : "Conectado";
  $("agentModeBadge").textContent = mode === "running" ? "EM EXECUÇÃO" : mode === "paused" ? "PAUSADO" : "AUTOMÁTICO";
  $("agentAsset").textContent = bridgeState.asset || "Localizando…";
  $("agentTimeframe").textContent = bridgeState.timeframe || (bridgeState.defaults.timeframe ? "5m" : "Verificando…");
  $("agentExpiration").textContent = bridgeState.expiration || (bridgeState.defaults.expiration ? "5 min" : "Verificando…");

  const balance = $("agentBalance");
  balance.textContent = formatBalance(bridgeState.balance);
  balance.classList.toggle("allowed", isBalanceAllowed());
  balance.classList.toggle("blocked", bridgeState.balance != null && bridgeState.balance !== "" && Number.isFinite(Number(bridgeState.balance)) && !isBalanceAllowed());
  const accountName = bridgeState.account?.name || "Conta não confirmada";
  const baseAmount = bridgeState.risk?.baseAmount;
  const protectionAmount = bridgeState.risk?.protectionAmount;
  $("balanceRule").textContent = bridgeState.balance == null
    ? "Procurando saldo"
    : isBalanceAllowed()
      ? `${accountName} · 1% ${formatBalance(baseAmount)} · proteção ${formatBalance(protectionAmount)}`
      : "Robô bloqueado abaixo de R$ 500";

  const lta = Boolean(bridgeState.markings?.lta);
  const ltb = Boolean(bridgeState.markings?.ltb);
  const protection = Boolean(bridgeState.markings?.protection || bridgeState.protection?.active || bridgeState.protection?.pending);
  $("markingsState").textContent = `LTA ${lta ? "✓" : "—"} · LTB ${ltb ? "✓" : "—"} · PROT ${protection ? "✓" : "—"}`;
  const direction = bridgeState.analysis?.direction;
  $("analysisDirection").textContent = direction === "BUY" ? "COMPRA" : direction === "SELL" ? "VENDA" : "AGUARDAR";
  $("analysisReason").textContent = bridgeState.analysis?.reason || "Aguardando dados reais";
  ingestEvents(state.events || []);

  if (state.asset && previous.asset !== state.asset) addLog("Ativo identificado", `${state.asset} entrou em monitoramento.`, "success", `asset-${state.asset}-${state.assetChangedAt || Date.now()}`);
  if (state.balance != null && previous.balance !== state.balance) {
    addLog("Saldo atualizado", isBalanceAllowed() ? `${formatBalance(state.balance)} identificado. Automação liberada para confirmação.` : `${formatBalance(state.balance)} identificado. Automação permanece bloqueada.`, isBalanceAllowed() ? "success" : "danger", `balance-${state.balance}`);
  }
  setAgentControls();
  syncStartGate();
  updateMonitorPulse();
}

function renderOffline(message = "Não detectada") {
  extensionReady = false;
  bridgeDetected = false;
  renderSupport(false);
  $("agentDot").className = "agent-dot offline";
  $("agentStatus").textContent = message;
  $("agentModeBadge").textContent = "DESCONECTADO";
  setAgentControls();
  startGate.hidden = true;
  updateMonitorPulse();
}

function sendCommand(action, payload = {}, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const requestId = `atlas-${Date.now()}-${++sequence}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("A extensão respondeu, mas a Traderoom da Hezilex ainda não está disponível."));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    const message = { source: DASHBOARD_SOURCE, type: "command", requestId, action, ...payload };
    window.postMessage(message, location.origin);
    if (frame.contentWindow) frame.contentWindow.postMessage(message, HEZILEX_ORIGIN);
  });
}

window.addEventListener("message", event => {
  const fromIframe = event.origin === HEZILEX_ORIGIN && event.source === frame.contentWindow && event.data?.source === EXTENSION_SOURCE;
  const fromDirectBridge = event.origin === location.origin && event.source === window && event.data?.source === DIRECT_EXTENSION_SOURCE;
  if (!fromIframe && !fromDirectBridge) return;
  if (event.data.type === "ready" || event.data.type === "state") {
    renderState(event.data.state || {});
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
  if (verificationInFlight) return;
  verificationInFlight = true;
  const button = $("verifyExtension");
  const original = button?.textContent;
  if (showMessage && button) {
    button.disabled = true;
    button.textContent = "Verificando…";
  }
  try {
    const result = await sendCommand("inspect", {}, showMessage ? 5000 : 2200);
    renderState(result);
  } catch (error) {
    silentMisses += 1;
    if (!bridgeDetected && (showMessage || silentMisses >= 2)) renderOffline(showMessage ? error.message : "Opcional · modo manual disponível");
    if (bridgeDetected) {
      $("agentStatus").textContent = "Conectado · aguardando Hezilex";
      $("analysisReason").textContent = error.message;
      renderSupport(true);
    }
  } finally {
    verificationInFlight = false;
    if (showMessage && button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function command(action, button, successMessage = null) {
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Processando…"; }
  try {
    const result = await sendCommand(action);
    if (result?.analysis || result?.bridge) renderState(result);
    if (successMessage) addLog(successMessage.title, successMessage.detail, successMessage.level || "success", `${action}-${Date.now()}`);
    return result;
  } catch (error) {
    $("analysisReason").textContent = error.message;
    addLog("Ação não concluída", error.message, "warning", `${action}-error-${Date.now()}`);
    return null;
  } finally {
    if (button) button.textContent = original;
    setAgentControls();
  }
}

$("startAgent").addEventListener("click", () => {
  startPromptDismissed = false;
  syncStartGate();
});
$("dismissStart").addEventListener("click", () => {
  startPromptDismissed = true;
  startGate.hidden = true;
  addLog("Início adiado", "O monitor permanece conectado, mas a análise ativa não foi iniciada.", "warning", `dismiss-${Date.now()}`);
});
$("confirmStart").addEventListener("click", async event => {
  if (!isBalanceAllowed()) return;
  const result = await command("start", event.currentTarget, { title: "Fluxo automático iniciado", detail: "Saldo validado. O Atlas assumiu 5m/5m, ativo, marcações e análise contínua sem criar sinais aleatórios.", level: "signal" });
  if (result) {
    startPromptDismissed = true;
    startGate.hidden = true;
  }
});
$("pauseAgent").addEventListener("click", event => command("pause", event.currentTarget, { title: "Robô pausado", detail: "Novas análises automáticas foram pausadas.", level: "warning" }));
$("emergencyStop").addEventListener("click", event => command("stop", event.currentTarget, { title: "Robô parado", detail: "O ciclo automático foi encerrado.", level: "danger" }));

setInterval(() => verifyExtension(false), 4000);
setInterval(updateMonitorPulse, 1000);

setTimeout(() => {
  if (window.innerWidth <= 800) mobileWarning.classList.add("show");
}, 9000);
