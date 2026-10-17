import { apiFetch, getAtlasClient } from "/modules/supabase-client.js";
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const client = await getAtlasClient();
const { data: authData } = await client.auth.getSession();
if (!authData.session) location.replace("/acesso");

function setStatus(message, kind = "") { $("#globalStatus").textContent = message; $("#globalStatus").className = `status ${kind}`; }
function fill(settings) {
  $("#oldPrice").value = settings.pricing.oldPrice; $("#currentPrice").value = settings.pricing.currentPrice;
  $("#eyebrow").value = settings.content.eyebrow; $("#headline").value = settings.content.headline; $("#subheadline").value = settings.content.subheadline;
  $("#newsQuery").value = settings.market.newsQuery; $("#symbols").value = settings.market.symbols.join("\n");
  $("#venoState").textContent = settings.venopag.configured ? `Integração ativa · ${settings.venopag.clientIdHint}` : "Ainda não configurada. Preencha as credenciais para ativar o PIX.";
  $("#webhookUrl").textContent = `${location.origin}/api/venopag-webhook`;
}
async function loadUsers() {
  const payload = await apiFetch("/api/admin-users");
  $("#userList").innerHTML = payload.users.map(user => `<div class="user-row"><span><b>${escapeHtml(user.name || user.email)}</b><small>${escapeHtml(user.email)}${user.phone ? ` · ${escapeHtml(user.phone)}` : ""} · ${escapeHtml(user.role)} · ${escapeHtml(user.access_status)}</small></span>${user.role === "admin" ? "<strong>ADMIN</strong>" : `<button class="tiny" type="button" data-user="${escapeHtml(user.id)}" data-access="${user.access_granted ? "0" : "1"}">${user.access_granted ? "Bloquear" : "Liberar"}</button>`}</div>`).join("");
  document.querySelectorAll("[data-user]").forEach(button => button.addEventListener("click", async () => { button.disabled = true; await apiFetch("/api/admin-users", { method: "PUT", body: JSON.stringify({ id: button.dataset.user, access: button.dataset.access === "1" }) }); await loadUsers(); }));
}

try {
  const account = await apiFetch("/api/me"); if (account.profile?.role !== "admin") location.replace("/app");
  const settings = await apiFetch("/api/admin-settings"); fill(settings); await loadUsers(); $("#adminForm").classList.remove("hidden"); setStatus("Painel pronto.", "success");
} catch (error) { setStatus(error.message, "error"); }

$("#adminForm").addEventListener("submit", async event => {
  event.preventDefault(); const submit = event.currentTarget.querySelector("button[type=submit]"); submit.disabled = true; setStatus("Salvando…");
  try {
    await apiFetch("/api/admin-settings", { method: "PUT", body: JSON.stringify({ pricing: { oldPrice: $("#oldPrice").value, currentPrice: $("#currentPrice").value }, content: { eyebrow: $("#eyebrow").value, headline: $("#headline").value, subheadline: $("#subheadline").value }, market: { newsQuery: $("#newsQuery").value, symbols: $("#symbols").value.split(/\s+/) }, venopag: { clientId: $("#venoClientId").value, clientSecret: $("#venoClientSecret").value, webhookSecret: $("#venoWebhookSecret").value } }) });
    $("#venoClientSecret").value = ""; $("#venoWebhookSecret").value = ""; setStatus("Configurações salvas e publicadas.", "success");
  } catch (error) { setStatus(error.message, "error"); } finally { submit.disabled = false; }
});

$("#changePassword").addEventListener("click", async () => {
  const button = $("#changePassword"); button.disabled = true;
  try { const { error } = await client.auth.updateUser({ password: $("#newPassword").value }); if (error) throw error; $("#newPassword").value = ""; $("#passwordStatus").textContent = "Senha alterada com sucesso."; $("#passwordStatus").className = "status success"; }
  catch (error) { $("#passwordStatus").textContent = error.message; $("#passwordStatus").className = "status error"; } finally { button.disabled = false; }
});
$("#signOut").addEventListener("click", async () => { await client.auth.signOut(); location.replace("/"); });
