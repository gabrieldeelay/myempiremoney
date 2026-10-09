const authorize = document.getElementById("authorize");
const originLabel = document.getElementById("origin");
const message = document.getElementById("message");
const dot = document.getElementById("dot");
let currentOrigin = null;

function eligible(origin) {
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host.endsWith(".vercel.app") || host.endsWith(".chatgpt.site");
  } catch { return false; }
}

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { currentOrigin = new URL(tab.url).origin; } catch { currentOrigin = null; }
  originLabel.textContent = currentOrigin || "Aba não compatível";
  if (!eligible(currentOrigin)) {
    authorize.disabled = true;
    message.textContent = "Abra o painel Atlas Guard e clique novamente no ícone da extensão.";
    return;
  }
  const settings = await chrome.runtime.sendMessage({ type: "get_settings" });
  if (settings.allowedOrigins?.includes(currentOrigin)) {
    dot.classList.add("ready");
    authorize.textContent = "Painel autorizado";
    message.textContent = "Recarregue o painel Atlas para concluir a conexão com a Hezilex.";
  }
}

authorize.addEventListener("click", async () => {
  if (!eligible(currentOrigin)) return;
  const result = await chrome.runtime.sendMessage({ type: "authorize_origin", origin: currentOrigin });
  if (result.ok) {
    dot.classList.add("ready");
    authorize.textContent = "Painel autorizado";
    message.textContent = "Agora recarregue o painel Atlas Guard.";
  }
});

load();

