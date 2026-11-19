import { apiFetch, saveCheckoutSession } from "/modules/atlas-client.js";

const playingCount = document.querySelector("#playingCount");
const activeSessionsCopy = document.querySelector("#activeSessionsCopy");
const freeButton = document.querySelector("#freeQueueButton");
const freeStatus = document.querySelector("#freeQueueStatus");

async function refreshSessions() {
  try {
    const queue = await apiFetch("/api/cloud-queue");
    const count = Number(queue.displayPlayingCount || queue.playingCount || 30);
    if (playingCount) playingCount.textContent = String(count);
    if (activeSessionsCopy) activeSessionsCopy.textContent = `${count} sessões ativas`;
  } catch {
    if (activeSessionsCopy) activeSessionsCopy.textContent = "Servidores ativos";
  }
}

async function enterFreeQueue() {
  freeButton.disabled = true;
  freeStatus.textContent = "Reservando sua posição…";
  try {
    const result = await apiFetch("/api/free-queue", { method: "POST" });
    if (result.session) saveCheckoutSession(result.session);
    freeStatus.textContent = "Posição salva. Abrindo sua contagem…";
    location.assign("/play");
  } catch (error) {
    freeStatus.textContent = error.message;
    freeButton.disabled = false;
  }
}

refreshSessions();
setInterval(refreshSessions, 30000);
freeButton?.addEventListener("click", enterFreeQueue);
