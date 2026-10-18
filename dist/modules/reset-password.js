import { getAtlasClient } from "/modules/atlas-client.js";
const form = document.querySelector("#newPassword"); const status = document.querySelector("#status");
form.addEventListener("submit", async event => {
  event.preventDefault(); const button = form.querySelector("button"); button.disabled = true;
  try {
    const token = new URLSearchParams(location.search).get("token");
    if (token) {
      const response = await fetch("/api/password-reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", token, password: password.value }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
    } else {
      const client = await getAtlasClient(); const { error } = await client.auth.updateUser({ password: password.value }); if (error) throw error;
    }
    status.textContent = "Senha alterada. Você já pode entrar novamente."; status.className = "status success"; setTimeout(() => location.replace("/acesso"), 1300);
  } catch (error) { status.textContent = error.message || "Este link é inválido ou expirou."; status.className = "status error"; button.disabled = false; }
});
