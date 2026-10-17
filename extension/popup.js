const DASHBOARD_URL = "https://atlas-guard-trading.vercel.app/";
const STATUS_URL = `${DASHBOARD_URL}api/extension-status`;
const RELEASE_URL = `${DASHBOARD_URL}extension-release.json`;
const installedVersion = chrome.runtime.getManifest().version;
const elements = Object.fromEntries(["dot", "statusEyebrow", "statusTitle", "message", "installedVersion", "latestVersion", "updateBadge", "primaryAction", "openAtlas", "headerVersion"].map(id => [id, document.getElementById(id)]));
let activeTab = null;
let currentOrigin = null;
let action = "open";
let release = null;

function eligible(origin) {
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "atlas-guard-trading.vercel.app";
  } catch { return false; }
}

function compareVersions(left, right) {
  const a = String(left || "0").split(".").map(Number);
  const b = String(right || "0").split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function setStatus(kind, eyebrow, title, copy) {
  elements.dot.className = `status-dot${kind ? ` ${kind}` : ""}`;
  elements.statusEyebrow.textContent = eyebrow;
  elements.statusTitle.textContent = title;
  elements.message.textContent = copy;
}

async function getRelease() {
  try {
    let response = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) response = await fetch(`${RELEASE_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("release unavailable");
    return response.json();
  } catch { return null; }
}

function render(settings = {}) {
  const publicVersion = release?.publicVersion || release?.version || null;
  const outdated = publicVersion && compareVersions(publicVersion, installedVersion) > 0;
  const candidateVersion = release?.candidateVersion || null;
  const candidatePending = candidateVersion && compareVersions(candidateVersion, installedVersion) > 0
    && (!publicVersion || compareVersions(publicVersion, candidateVersion) < 0);
  const authorized = eligible(currentOrigin) && settings.allowedOrigins?.includes(currentOrigin);
  elements.installedVersion.textContent = `v${installedVersion}`;
  elements.headerVersion.textContent = `v${installedVersion}`;
  elements.latestVersion.textContent = candidatePending ? `v${candidateVersion} • em análise` : publicVersion ? `v${publicVersion}` : "Indisponível";
  elements.primaryAction.disabled = false;

  if (outdated || candidatePending) {
    action = "update";
    elements.updateBadge.textContent = candidatePending ? "EM LIBERAÇÃO" : "ATUALIZAÇÃO";
    elements.updateBadge.className = "outdated";
    elements.primaryAction.textContent = candidatePending ? "Verificar atualização" : "Atualizar agora";
    setStatus("update", candidatePending ? "NOVA VERSÃO EM LIBERAÇÃO" : "NOVA VERSÃO", `v${candidateVersion || publicVersion}`, candidatePending
      ? "Clique para consultar o Edge agora. Assim que a Microsoft liberar, a atualização será aplicada automaticamente."
      : "Clique uma vez. O Edge baixa e aplica a atualização oficial automaticamente.");
    return;
  }

  elements.updateBadge.textContent = publicVersion ? "ATUALIZADA" : "SEM RESPOSTA";
  elements.updateBadge.className = publicVersion ? "current" : "";
  if (!eligible(currentOrigin)) {
    action = "open";
    const host = (() => { try { return new URL(activeTab?.url).hostname; } catch { return "esta aba"; } })();
    elements.primaryAction.textContent = "Abrir o Atlas";
    setStatus("ready", "EXTENSÃO ATIVA", "Atlas pronto", `Você abriu a extensão em ${host}. O Atlas só precisa se conectar dentro do próprio painel.`);
    return;
  }
  if (!authorized) {
    action = "authorize";
    elements.primaryAction.textContent = "Conectar este painel";
    setStatus("update", "PAINEL ENCONTRADO", "Falta conectar", "Este é o painel certo. Um clique conclui a conexão local.");
    return;
  }
  action = "refresh";
  elements.primaryAction.textContent = "Reconectar painel";
  setStatus("ready", "TUDO CERTO", "Painel conectado", "A extensão está atualizada, autorizada e pronta para ler a Hezilex.");
}

async function load() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { currentOrigin = new URL(activeTab?.url).origin; } catch { currentOrigin = null; }
  const [settings, releaseResult] = await Promise.all([
    chrome.runtime.sendMessage({ type: "get_settings" }),
    getRelease()
  ]);
  release = releaseResult;
  render(settings || {});
}

elements.primaryAction.addEventListener("click", async () => {
  elements.primaryAction.disabled = true;
  if (action === "update") {
    const result = await chrome.runtime.sendMessage({ type: "check_for_updates", force: true });
    if (result?.status === "update_available" || result?.status === "reloading") {
      elements.primaryAction.textContent = "Aplicando atualização…";
      elements.message.textContent = "Atualização encontrada. O Atlas será reiniciado pelo Edge em instantes.";
      return;
    }
    const candidateVersion = release?.candidateVersion;
    const candidatePending = candidateVersion && compareVersions(candidateVersion, installedVersion) > 0
      && (!release?.publicVersion || compareVersions(release.publicVersion, candidateVersion) < 0);
    elements.primaryAction.disabled = false;
    elements.primaryAction.textContent = candidatePending ? "Verificar novamente" : "Abrir página oficial";
    elements.message.textContent = candidatePending
      ? `A verificação funcionou. A v${candidateVersion} ainda está aguardando liberação da Microsoft.`
      : "O Edge ainda não recebeu a atualização. Você pode tentar novamente pela página oficial.";
    action = candidatePending ? "update" : "store";
    return;
  }
  if (action === "store") {
    await chrome.tabs.create({ url: release?.storeUrl || DASHBOARD_URL });
    window.close();
    return;
  }
  if (action === "authorize") {
    await chrome.runtime.sendMessage({ type: "authorize_origin", origin: currentOrigin });
    if (activeTab?.id) await chrome.tabs.reload(activeTab.id);
    window.close();
    return;
  }
  if (action === "refresh") {
    if (activeTab?.id) await chrome.tabs.reload(activeTab.id);
    window.close();
    return;
  }
  await chrome.tabs.create({ url: DASHBOARD_URL });
  window.close();
});

elements.openAtlas.addEventListener("click", async () => {
  await chrome.tabs.create({ url: DASHBOARD_URL });
  window.close();
});

load();
