import { apiFetch, getAtlasClient } from "/modules/supabase-client.js";

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const client = await getAtlasClient();
let settingsCache;

function setStatus(message, kind = "") { $("#globalStatus").textContent = message; $("#globalStatus").className = `status ${kind}`; }
function showLogin(message = "") {
  $("#adminLogin").classList.remove("hidden");
  $("#adminDashboard").classList.add("hidden");
  if (message) { $("#adminLoginStatus").textContent = message; $("#adminLoginStatus").className = "status error"; }
}
function showDashboard() { $("#adminLogin").classList.add("hidden"); $("#adminDashboard").classList.remove("hidden"); }

function fillPlan(prefix, plan) {
  $(`#${prefix}Label`).value = plan.label || "";
  $(`#${prefix}OldPrice`).value = plan.oldPrice;
  $(`#${prefix}CurrentPrice`).value = plan.currentPrice;
  $(`#${prefix}Billing`).value = plan.billing || "";
  $(`#${prefix}Benefits`).value = (plan.benefits || []).join("\n");
  $(`#${prefix}Active`).checked = plan.active !== false;
}

function readPlan(prefix, id) {
  return {
    id,
    label: $(`#${prefix}Label`).value,
    oldPrice: $(`#${prefix}OldPrice`).value,
    currentPrice: $(`#${prefix}CurrentPrice`).value,
    billing: $(`#${prefix}Billing`).value,
    benefits: $(`#${prefix}Benefits`).value.split("\n").map(value => value.trim()).filter(Boolean),
    active: $(`#${prefix}Active`).checked
  };
}

function fill(settings) {
  settingsCache = settings;
  fillPlan("monthly", settings.plans.monthly);
  fillPlan("lifetime", settings.plans.lifetime);
  $("#eyebrow").value = settings.content.eyebrow;
  $("#headline").value = settings.content.headline;
  $("#subheadline").value = settings.content.subheadline;
  $("#newsQuery").value = settings.market.newsQuery;
  $("#symbols").value = settings.market.symbols.join("\n");
  $("#venoState").textContent = settings.venopag.configured ? `Integração ativa · ${settings.venopag.clientIdHint}` : "Ainda não configurada. Preencha as credenciais para ativar o PIX.";
  $("#webhookUrl").textContent = `${location.origin}/api/venopag-webhook`;
  renderCoupons(settings.coupons || []);
}

function renderCoupons(coupons) {
  $("#couponList").innerHTML = coupons.length ? coupons.map(coupon => {
    const discount = coupon.type === "percent" ? `${Number(coupon.value)}%` : money(coupon.value);
    const validity = coupon.valid_until ? new Date(coupon.valid_until).toLocaleDateString("pt-BR") : "sem validade";
    const usage = coupon.max_uses ? `${coupon.uses_count}/${coupon.max_uses} usos` : `${coupon.uses_count} usos`;
    return `<article class="coupon-item"><div><b>${escapeHtml(coupon.code)}</b><small>${escapeHtml(discount)} · ${escapeHtml(validity)} · ${escapeHtml(usage)}</small></div><span class="coupon-state ${coupon.active ? "on" : ""}">${coupon.active ? "ATIVO" : "PAUSADO"}</span><div><button class="tiny" type="button" data-edit-coupon="${escapeHtml(coupon.id)}">Editar</button> <button class="tiny danger" type="button" data-delete-coupon="${escapeHtml(coupon.id)}">Excluir</button></div></article>`;
  }).join("") : '<div class="empty-admin">Nenhum cupom criado.</div>';
  document.querySelectorAll("[data-edit-coupon]").forEach(button => button.addEventListener("click", () => editCoupon(button.dataset.editCoupon)));
  document.querySelectorAll("[data-delete-coupon]").forEach(button => button.addEventListener("click", () => deleteCoupon(button.dataset.deleteCoupon)));
}

function clearCoupon() {
  $("#couponId").value = ""; $("#couponCode").value = ""; $("#couponType").value = "percent"; $("#couponValue").value = ""; $("#couponMaxUses").value = ""; $("#couponValidUntil").value = ""; $("#couponActive").checked = true; $("#couponStatus").textContent = "";
}

function editCoupon(id) {
  const coupon = settingsCache.coupons.find(item => item.id === id);
  if (!coupon) return;
  $("#couponId").value = coupon.id; $("#couponCode").value = coupon.code; $("#couponType").value = coupon.type; $("#couponValue").value = coupon.value; $("#couponMaxUses").value = coupon.max_uses || ""; $("#couponValidUntil").value = coupon.valid_until ? new Date(new Date(coupon.valid_until).getTime() - new Date(coupon.valid_until).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""; $("#couponActive").checked = coupon.active;
  $("#couponCode").focus();
}

async function deleteCoupon(id) {
  try {
    await apiFetch(`/api/admin-settings?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadSettings();
    $("#couponStatus").textContent = "Cupom excluído."; $("#couponStatus").className = "status success";
  } catch (error) { $("#couponStatus").textContent = error.message; $("#couponStatus").className = "status error"; }
}

async function loadUsers() {
  const payload = await apiFetch("/api/admin-users");
  $("#userList").innerHTML = payload.users.map(user => `<div class="user-row"><span><b>${escapeHtml(user.name || user.email)}</b><small>${escapeHtml(user.email)}${user.phone ? ` · ${escapeHtml(user.phone)}` : ""}${user.plan_id ? ` · ${escapeHtml(user.plan_id)}` : ""} · ${escapeHtml(user.access_status)}</small></span>${user.role === "admin" ? "<strong>ADMIN</strong>" : `<button class="tiny" type="button" data-user="${escapeHtml(user.id)}" data-access="${user.access_granted ? "0" : "1"}">${user.access_granted ? "Bloquear" : "Liberar"}</button>`}</div>`).join("");
  document.querySelectorAll("[data-user]").forEach(button => button.addEventListener("click", async () => { button.disabled = true; await apiFetch("/api/admin-users", { method: "PUT", body: JSON.stringify({ id: button.dataset.user, access: button.dataset.access === "1" }) }); await loadUsers(); }));
}

async function loadSettings() { const settings = await apiFetch("/api/admin-settings"); fill(settings); }

async function openDashboard() {
  try {
    const account = await apiFetch("/api/me");
    if (account.profile?.role !== "admin") { await client.auth.signOut(); showLogin("Esta conta não possui permissão administrativa."); return; }
    showDashboard();
    await Promise.all([loadSettings(), loadUsers()]);
    $("#adminForm").classList.remove("hidden");
    setStatus("Painel pronto.", "success");
  } catch (error) { await client.auth.signOut(); showLogin(error.message); }
}

$("#adminLoginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]"); button.disabled = true;
  $("#adminLoginStatus").textContent = "Entrando…";
  try {
    const identity = $("#adminUser").value.trim().toLowerCase();
    const email = identity === "admin" ? "admin@atlas.local" : identity;
    const { error } = await client.auth.signInWithPassword({ email, password: $("#adminPassword").value });
    if (error) throw error;
    await openDashboard();
  } catch (error) { $("#adminLoginStatus").textContent = error.message.includes("Invalid login") ? "Usuário ou senha incorretos." : error.message; $("#adminLoginStatus").className = "status error"; } finally { button.disabled = false; }
});

$("#adminForm").addEventListener("submit", async event => {
  event.preventDefault(); const submit = event.currentTarget.querySelector("button[type=submit]"); submit.disabled = true; setStatus("Salvando…");
  try {
    await apiFetch("/api/admin-settings", { method: "PUT", body: JSON.stringify({ plans: { monthly: readPlan("monthly", "monthly"), lifetime: readPlan("lifetime", "lifetime") }, content: { eyebrow: $("#eyebrow").value, headline: $("#headline").value, subheadline: $("#subheadline").value }, market: { newsQuery: $("#newsQuery").value, symbols: $("#symbols").value.split(/\s+/) }, venopag: { clientId: $("#venoClientId").value, clientSecret: $("#venoClientSecret").value, webhookSecret: $("#venoWebhookSecret").value } }) });
    $("#venoClientSecret").value = ""; $("#venoWebhookSecret").value = ""; setStatus("Configurações salvas e publicadas.", "success"); await loadSettings();
  } catch (error) { setStatus(error.message, "error"); } finally { submit.disabled = false; }
});

$("#couponSave").addEventListener("click", async () => {
  const button = $("#couponSave"); button.disabled = true;
  try {
    await apiFetch("/api/admin-settings", { method: "POST", body: JSON.stringify({ action: "coupon", coupon: { id: $("#couponId").value, code: $("#couponCode").value, type: $("#couponType").value, value: $("#couponValue").value, maxUses: $("#couponMaxUses").value, validUntil: $("#couponValidUntil").value, active: $("#couponActive").checked } }) });
    clearCoupon(); await loadSettings(); $("#couponStatus").textContent = "Cupom salvo."; $("#couponStatus").className = "status success";
  } catch (error) { $("#couponStatus").textContent = error.message; $("#couponStatus").className = "status error"; } finally { button.disabled = false; }
});
$("#couponClear").addEventListener("click", clearCoupon);

$("#changePassword").addEventListener("click", async () => {
  const button = $("#changePassword"); button.disabled = true;
  try { const { error } = await client.auth.updateUser({ password: $("#newPassword").value }); if (error) throw error; $("#newPassword").value = ""; $("#passwordStatus").textContent = "Senha alterada com sucesso."; $("#passwordStatus").className = "status success"; }
  catch (error) { $("#passwordStatus").textContent = error.message; $("#passwordStatus").className = "status error"; } finally { button.disabled = false; }
});
$("#signOut").addEventListener("click", async () => { await client.auth.signOut(); location.reload(); });

const { data: authData } = await client.auth.getSession();
if (authData.session) await openDashboard(); else showLogin();
