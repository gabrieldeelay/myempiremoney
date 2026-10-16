const EXTENSION_ID = "celdhajbbhljfcofpgkpfcmhcbpdafog";
const STORE_URL = `https://microsoftedge.microsoft.com/addons/detail/${EXTENSION_ID}`;
const DASHBOARD_SOURCE = "atlas-guard-dashboard";
const EXTENSION_SOURCE = "atlas-guard-dashboard-extension";

let extensionDetected = false;
let storeAvailable = false;
let installPopup = null;
let requestSequence = 0;
let popupWatcher = null;
let installAttempted = false;
let resumeHandled = false;

const selectors = {
  action: "[data-install-action]",
  message: "[data-install-message]",
  browser: "[data-browser-label]",
  store: "[data-store-label]",
  extension: "[data-extension-label]",
  status: "[data-install-status]"
};

function all(selector) {
  return [...document.querySelectorAll(selector)];
}

function setText(selector, value) {
  all(selector).forEach(element => { element.textContent = value; });
}

function setStep(name, mode) {
  all(`[data-install-step="${name}"]`).forEach(element => {
    element.classList.toggle("done", mode === "done");
    element.classList.toggle("waiting", mode === "waiting");
    const marker = element.querySelector(":scope > span");
    if (mode === "done" && marker) marker.textContent = "✓";
  });
}

function setMessage(message, kind = "") {
  all(selectors.message).forEach(element => {
    element.textContent = message;
    element.className = `install-message${kind ? ` ${kind}` : ""}`;
  });
}

function isEdge() {
  return /Edg\//.test(navigator.userAgent);
}

function updateUI() {
  const edge = isEdge();
  setText(selectors.browser, edge ? "Microsoft Edge identificado" : "Abra no Microsoft Edge");
  setStep("browser", edge ? "done" : "waiting");

  setText(selectors.store, storeAvailable ? "Liberada pela Microsoft" : "Em análise na Microsoft");
  setStep("store", storeAvailable ? "done" : "waiting");

  setText(selectors.extension, extensionDetected ? "Extensão ativa" : "Aguardando instalação");
  setStep("extension", extensionDetected ? "done" : "waiting");

  all("[data-install-trigger]").forEach(button => {
    button.textContent = extensionDetected ? "Extensão ativa" : "Instalar extensão";
    button.classList.toggle("connected", extensionDetected);
  });

  const actions = all(selectors.action);
  if (extensionDetected) {
    setText(selectors.status, "Extensão ativa e conectada");
    setMessage("Tudo pronto. A extensão já está ativa e o Atlas pode receber os dados da Hezilex.", "success");
    actions.forEach(button => {
      button.disabled = true;
      button.textContent = "Extensão instalada";
      button.classList.remove("ready");
    });
    return;
  }

  if (!edge) {
    setText(selectors.status, "Abra no Microsoft Edge");
    setMessage("Abra este mesmo endereço no Microsoft Edge para usar a instalação oficial.", "warning");
    actions.forEach(button => {
      button.disabled = true;
      button.textContent = "Disponível no Microsoft Edge";
      button.classList.remove("ready");
    });
    return;
  }

  if (!storeAvailable) {
    setText(selectors.status, "Em análise na Microsoft");
    setMessage("A versão 2.3.0 já foi enviada. Esta tela verifica a liberação automaticamente; não será necessário baixar outro arquivo.", "warning");
    actions.forEach(button => {
      button.disabled = false;
      button.textContent = "Verificar novamente";
      button.classList.remove("ready");
    });
    return;
  }

  setText(selectors.status, "Pronta para instalar");
  setMessage("Aprovada. O Atlas continuará aberto enquanto o Edge mostra somente a confirmação oficial.", "success");
  actions.forEach(button => {
    button.disabled = false;
    button.textContent = "Instalar agora";
    button.classList.add("ready");
  });
}

async function checkStore() {
  try {
    const response = await fetch(`/api/extension-status?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("status unavailable");
    const result = await response.json();
    storeAvailable = result.available === true;
  } catch {
    storeAvailable = false;
  }
  updateUI();
}

function pingExtension() {
  const requestId = `atlas-install-${Date.now()}-${++requestSequence}`;
  window.postMessage({ source: DASHBOARD_SOURCE, type: "command", requestId, action: "ping" }, location.origin);
}

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (event.data?.source !== EXTENSION_SOURCE) return;
  extensionDetected = true;
  updateUI();
  if (installPopup && !installPopup.closed) installPopup.close();
});

function openInstaller() {
  if (!storeAvailable) {
    setMessage("Conferindo novamente com a Microsoft…");
    checkStore();
    return;
  }
  installPopup = window.open(STORE_URL, "atlas-edge-install", "popup,width=1080,height=760");
  if (!installPopup) {
    setMessage("O Edge bloqueou a janela de confirmação. Libere pop-ups para este site e tente novamente.", "warning");
    return;
  }
  installAttempted = true;
  resumeHandled = false;
  setMessage("Confirme a instalação na janela do Edge. Esta página continuará verificando sozinha.");
  clearInterval(popupWatcher);
  popupWatcher = setInterval(() => {
    pingExtension();
    if (installPopup?.closed) {
      clearInterval(popupWatcher);
      if (!extensionDetected) {
        localStorage.setItem("atlas-install-check", "1");
        setMessage("Finalizando a conexão…");
        setTimeout(() => location.reload(), 900);
      }
    }
  }, 1000);
}

function finishAfterStoreReturn() {
  if (!installAttempted || resumeHandled || extensionDetected || document.hidden) return;
  resumeHandled = true;
  setMessage("Finalizando a conexão com o Atlas…");
  pingExtension();
  setTimeout(() => {
    if (!extensionDetected) location.reload();
  }, 1100);
}

all(selectors.action).forEach(button => button.addEventListener("click", openInstaller));
all("[data-direct-download]").forEach(link => link.addEventListener("click", () => {
  setMessage("Download iniciado. O arquivo atlas-edge-v2.3.0.zip está sendo salvo no seu dispositivo.", "success");
}));

const modal = document.getElementById("installModal");
all("[data-install-trigger]").forEach(button => button.addEventListener("click", () => {
  if (!modal) {
    location.href = "/install";
    return;
  }
  modal.hidden = false;
  document.body.classList.add("install-open");
  checkStore();
  pingExtension();
}));
all("[data-install-close]").forEach(button => button.addEventListener("click", () => {
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("install-open");
}));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && modal && !modal.hidden) {
    modal.hidden = true;
    document.body.classList.remove("install-open");
  }
});
window.addEventListener("focus", finishAfterStoreReturn);
document.addEventListener("visibilitychange", finishAfterStoreReturn);

updateUI();
checkStore();
pingExtension();
setInterval(pingExtension, 1400);
setInterval(checkStore, 30000);

