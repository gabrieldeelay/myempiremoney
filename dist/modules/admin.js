import { apiFetch, getAccessToken, getAtlasClient } from "/modules/atlas-client.js";

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const client = await getAtlasClient();
let settingsCache;
let userSearchTimer;
let paymentCache = [];
let speechCache = [];

const statusLabel = status => ({ active: "ATIVO", blocked: "BLOQUEADO", pending: "PENDENTE" })[status] || "PENDENTE";
const dateLabel = value => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value)) : "—";
const dateTimeLabel = value => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

function accessTimeLabel(user) {
  if (!user.access_granted) return "Aguardando pagamento";
  if (!user.access_expires_at) return "Data não definida";
  const milliseconds = new Date(user.access_expires_at).getTime() - Date.now();
  const days = Math.ceil(milliseconds / 86400000);
  if (days <= 0) return "Expirado";
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

function setAdminTab(tab) {
  const allowed = ["overview", "clients", "payments", "sales", "content", "speeches", "integrations", "security"];
  const next = allowed.includes(tab) ? tab : "overview";
  document.querySelectorAll("[data-admin-tab]").forEach(button => button.classList.toggle("active", button.dataset.adminTab === next));
  document.querySelectorAll("[data-admin-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.adminPanel === next));
  $("#saveDock").classList.toggle("hidden", !["sales", "content", "integrations"].includes(next));
  history.replaceState(null, "", `#${next}`);
  scrollTo({ top: 0, behavior: "smooth" });
}

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
  $("#eyebrow").value = settings.content.eyebrow;
  $("#headline").value = settings.content.headline;
  $("#subheadline").value = settings.content.subheadline;
  $("#newsQuery").value = settings.market.newsQuery;
  $("#symbols").value = settings.market.symbols.join("\n");
  $("#venoState").textContent = settings.venopag.configured ? "Integração ativa. Credenciais carregadas com segurança." : "Ainda não configurada. Preencha as credenciais para ativar o PIX.";
  $("#venoClientId").value = settings.venopag.clientId || "";
  $("#venoClientSecret").value = settings.venopag.clientSecret || "";
  $("#venoWebhookSecret").value = settings.venopag.webhookSecret || "";
  $("#venoUpdatedAt").textContent = settings.venopag.updatedAt ? `Última configuração: ${dateTimeLabel(settings.venopag.updatedAt)}` : "Nenhuma configuração salva.";
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
  const params = new URLSearchParams();
  const search = $("#userSearch")?.value.trim();
  const status = $("#userStatus")?.value;
  if (search) params.set("q", search);
  if (status && status !== "all") params.set("status", status);
  $("#userList").innerHTML = '<div class="empty-admin">Carregando clientes…</div>';
  const payload = await apiFetch(`/api/admin-users?${params}`);
  $("#statTotal").textContent = payload.stats.total;
  $("#statActive").textContent = payload.stats.active;
  $("#statPending").textContent = payload.stats.pending;
  $("#statBlocked").textContent = payload.stats.blocked;
  $("#userResultCount").textContent = `${payload.total} ${payload.total === 1 ? "cliente" : "clientes"}`;
  $("#userList").innerHTML = payload.users.length ? payload.users.map(user => {
    const status = user.access_status || "pending";
    const initial = String(user.name || user.email || "C").trim().charAt(0).toUpperCase();
    return `<article class="user-row"><div class="user-identity"><span class="user-avatar">${escapeHtml(initial)}</span><span><b>${escapeHtml(user.name || "Cliente sem nome")}</b><small>${escapeHtml(user.email)}${user.phone ? ` · ${escapeHtml(user.phone)}` : ""}</small></span></div><span class="access-time ${user.access_granted && user.access_expires_at && new Date(user.access_expires_at) < new Date() ? "expired" : ""}">${escapeHtml(accessTimeLabel(user))}</span><span class="user-status ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span><span class="user-date">${escapeHtml(dateLabel(user.created_at))}</span><span class="user-actions"><button class="tiny" type="button" data-password-user="${escapeHtml(user.id)}" data-password-name="${escapeHtml(user.name || user.email)}" data-password-email="${escapeHtml(user.email)}">Nova senha</button><button class="tiny${user.access_granted ? " danger" : ""}" type="button" data-user="${escapeHtml(user.id)}" data-access="${user.access_granted ? "0" : "1"}">${user.access_granted ? "Suspender" : "Ativar acesso"}</button></span></article>`;
  }).join("") : '<div class="empty-admin"><b>Nenhum cliente encontrado.</b><br>Revise a busca ou limpe os filtros.</div>';
}

function paymentStatusLabel(status) {
  const value = String(status || "pending").toLowerCase();
  if (["confirmed", "paid", "approved"].includes(value)) return "CONFIRMADO";
  if (["failed", "cancelled", "expired", "denied"].includes(value)) return "FALHOU";
  return "PENDENTE";
}

function renderPayments() {
  const filter = $("#paymentStatusFilter").value;
  const visible = paymentCache.filter(payment => {
    const label = paymentStatusLabel(payment.status).toLowerCase();
    return filter === "all" || (filter === "confirmed" && label === "confirmado") || (filter === "failed" && label === "falhou") || (filter === "pending" && label === "pendente");
  });
  $("#paymentList").innerHTML = visible.length ? visible.map(payment => {
    const customer = payment.customer || {};
    const status = paymentStatusLabel(payment.status);
    return `<article class="payment-row"><div><b>${escapeHtml(customer.name || customer.email || "Cliente não identificado")}</b><small>${escapeHtml(customer.email || payment.user_id)}</small></div><div><strong>${escapeHtml(money(Number(payment.amount || 0)))}</strong><small>${escapeHtml(payment.request_number || "Sem referência")}</small></div><span class="payment-status ${status.toLowerCase()}">${status}</span><time>${escapeHtml(dateTimeLabel(payment.created_at))}</time></article>`;
  }).join("") : '<div class="empty-admin">Nenhuma tentativa encontrada neste filtro.</div>';
}

async function loadPayments() {
  $("#paymentList").innerHTML = '<div class="empty-admin">Carregando pagamentos…</div>';
  $("#accountList").innerHTML = '<div class="empty-admin">Carregando cadastros…</div>';
  const payload = await apiFetch("/api/admin-users?view=payments");
  paymentCache = payload.payments || [];
  $("#paymentAttempts").textContent = payload.stats.attempts;
  $("#paymentConfirmed").textContent = payload.stats.confirmed;
  $("#paymentPending").textContent = payload.stats.pending;
  $("#accountCreations").textContent = payload.stats.accounts;
  renderPayments();
  $("#accountList").innerHTML = payload.accounts.length ? payload.accounts.map(account => `<article class="account-row"><span class="user-avatar">${escapeHtml(String(account.name || account.email || "C").charAt(0).toUpperCase())}</span><div><b>${escapeHtml(account.name || "Cliente sem nome")}</b><small>${escapeHtml(account.email)}${account.phone ? ` · ${escapeHtml(account.phone)}` : ""}</small></div><time>${escapeHtml(dateTimeLabel(account.created_at))}</time></article>`).join("") : '<div class="empty-admin">Nenhuma conta criada.</div>';
}

function speechMatches(speech) {
  const query = $("#speechSearch").value.trim().toLowerCase();
  const context = $("#speechContextFilter").value;
  const haystack = `${speech.context} ${speech.contextDescription} ${speech.phrase}`.toLowerCase();
  return (!query || haystack.includes(query)) && (context === "all" || speech.context === context);
}

function renderSpeechFilters() {
  const select = $("#speechContextFilter");
  const selected = select.value || "all";
  const contexts = [...new Set(speechCache.map(item => item.context))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  select.innerHTML = `<option value="all">Todos os contextos</option>${contexts.map(context => `<option value="${escapeHtml(context)}">${escapeHtml(context)}</option>`).join("")}`;
  select.value = contexts.includes(selected) ? selected : "all";
  $("#speechContextOptions").innerHTML = contexts.map(context => `<option value="${escapeHtml(context)}"></option>`).join("");
}

function renderSpeeches() {
  const visible = speechCache.filter(speechMatches);
  $("#speechTotal").textContent = speechCache.length;
  $("#speechWithAudio").textContent = speechCache.filter(item => item.audioUrl).length;
  $("#speechActive").textContent = speechCache.filter(item => item.active).length;
  $("#speechContexts").textContent = new Set(speechCache.map(item => item.context)).size;
  $("#speechList").innerHTML = visible.length ? visible.map(speech => `<article class="speech-card ${speech.active ? "" : "is-paused"}">
    <div><div class="speech-card-head"><span class="speech-context">${escapeHtml(speech.context)}</span><span class="speech-audio-state ${speech.audioUrl ? "ready" : ""}">${speech.audioUrl ? "ÁUDIO PRONTO" : "SEM ÁUDIO"}</span></div><h3>${escapeHtml(speech.phrase)}</h3><p>${escapeHtml(speech.contextDescription)}</p></div>
    <div class="speech-card-actions">${speech.audioUrl ? `<audio controls preload="none" src="${escapeHtml(speech.audioUrl)}"></audio>` : ""}<label class="speech-toggle"><input type="checkbox" data-speech-toggle="${escapeHtml(speech.id)}" ${speech.active ? "checked" : ""}> Ativa</label><button class="tiny" type="button" data-edit-speech="${escapeHtml(speech.id)}">Editar</button></div>
  </article>`).join("") : '<div class="empty-admin"><b>Nenhuma fala encontrada.</b><br>Ajuste os filtros ou crie uma nova fala.</div>';
}

async function loadSpeeches() {
  const payload = await apiFetch("/api/admin-speeches");
  speechCache = payload.speeches || [];
  renderSpeechFilters();
  renderSpeeches();
}

function openSpeechEditor(id = "") {
  const speech = speechCache.find(item => item.id === id);
  $("#speechDialogTitle").textContent = speech ? "Editar fala" : "Nova fala";
  $("#speechId").value = speech?.id || "";
  $("#speechContext").value = speech?.context || "";
  $("#speechDescription").value = speech?.contextDescription || "";
  $("#speechPhrase").value = speech?.phrase || "";
  $("#speechEnabled").checked = speech?.active !== false;
  $("#speechAudio").value = "";
  $("#speechAudioPreview").hidden = !speech?.audioUrl;
  $("#speechAudioPreview").src = speech?.audioUrl || "";
  $("#deleteSpeech").classList.toggle("hidden", !speech);
  $("#speechEditorStatus").textContent = "";
  $("#speechDialog").showModal();
}

async function uploadSpeechAudio(id, file) {
  const token = await getAccessToken();
  const response = await fetch(`/api/admin-speeches/audio?id=${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": file.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: file
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível enviar o áudio.");
  return payload;
}

async function saveSpeech() {
  const button = $("#saveSpeech");
  const id = $("#speechId").value;
  const audio = $("#speechAudio").files[0];
  if (audio && audio.size > 15 * 1024 * 1024) throw new Error("O áudio deve ter no máximo 15 MB.");
  button.disabled = true;
  $("#speechEditorStatus").textContent = id ? "Salvando alterações…" : "Criando fala…";
  try {
    const payload = await apiFetch("/api/admin-speeches", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({ id, context: $("#speechContext").value, contextDescription: $("#speechDescription").value, phrase: $("#speechPhrase").value, active: $("#speechEnabled").checked })
    });
    const speechId = payload.speech.id;
    if (audio) {
      $("#speechEditorStatus").textContent = "Enviando áudio…";
      await uploadSpeechAudio(speechId, audio);
    }
    await loadSpeeches();
    $("#speechEditorStatus").textContent = "Fala salva e publicada.";
    $("#speechEditorStatus").className = "status success";
    setTimeout(() => $("#speechDialog").close(), 650);
  } finally { button.disabled = false; }
}

async function deleteSpeech(id = $("#speechId").value) {
  if (!id || !confirm("Excluir esta fala e o áudio enviado?")) return;
  await apiFetch(`/api/admin-speeches?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  $("#speechDialog").close();
  await loadSpeeches();
  setStatus("Fala excluída.", "success");
}

async function loadSettings() { const settings = await apiFetch("/api/admin-settings"); fill(settings); }

async function openDashboard() {
  try {
    const account = await apiFetch("/api/me");
    if (account.profile?.role !== "admin") { await client.auth.signOut(); showLogin("Esta conta não possui permissão administrativa."); return; }
    showDashboard();
    await Promise.all([loadSettings(), loadUsers(), loadPayments(), loadSpeeches()]);
    $("#adminForm").classList.remove("hidden");
    setAdminTab(location.hash.replace("#", "") || "overview");
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
    const venopag = { clientId: $("#venoClientId").value, clientSecret: $("#venoClientSecret").value, webhookSecret: $("#venoWebhookSecret").value };
    const credentialsChanged = ["clientId", "clientSecret", "webhookSecret"].some(key => venopag[key] !== (settingsCache.venopag?.[key] || ""));
    await apiFetch("/api/admin-settings", { method: "PUT", body: JSON.stringify({ plans: { monthly: readPlan("monthly", "monthly") }, content: { eyebrow: $("#eyebrow").value, headline: $("#headline").value, subheadline: $("#subheadline").value }, market: { newsQuery: $("#newsQuery").value, symbols: $("#symbols").value.split(/\s+/) }, venopag: credentialsChanged ? venopag : {} }) });
    setStatus("Configurações salvas e publicadas.", "success"); await loadSettings();
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

document.querySelectorAll("[data-admin-tab]").forEach(button => button.addEventListener("click", () => setAdminTab(button.dataset.adminTab)));
document.querySelectorAll("[data-switch-tab]").forEach(button => button.addEventListener("click", () => setAdminTab(button.dataset.switchTab)));
$("#userSearch").addEventListener("input", () => { clearTimeout(userSearchTimer); userSearchTimer = setTimeout(() => loadUsers().catch(error => setStatus(error.message, "error")), 260); });
$("#userStatus").addEventListener("change", () => loadUsers().catch(error => setStatus(error.message, "error")));
$("#clearUserFilters").addEventListener("click", () => { $("#userSearch").value = ""; $("#userStatus").value = "all"; loadUsers().catch(error => setStatus(error.message, "error")); });
$("#userList").addEventListener("click", async event => {
  const button = event.target.closest("[data-user]");
  if (!button) return;
  button.disabled = true;
  try { await apiFetch("/api/admin-users", { method: "PUT", body: JSON.stringify({ id: button.dataset.user, access: button.dataset.access === "1" }) }); await loadUsers(); }
  catch (error) { setStatus(error.message, "error"); button.disabled = false; }
});

$("#userList").addEventListener("click", event => {
  const button = event.target.closest("[data-password-user]");
  if (!button) return;
  $("#passwordCustomerId").value = button.dataset.passwordUser;
  $("#passwordCustomer").textContent = `${button.dataset.passwordName} · ${button.dataset.passwordEmail}`;
  $("#customerNewPassword").value = "";
  $("#customerPasswordStatus").textContent = "";
  $("#userPasswordDialog").showModal();
});
$("#saveCustomerPassword").addEventListener("click", async () => {
  const button = $("#saveCustomerPassword"); button.disabled = true;
  try {
    await apiFetch("/api/admin-users", { method: "PUT", body: JSON.stringify({ action: "reset_password", id: $("#passwordCustomerId").value, password: $("#customerNewPassword").value }) });
    $("#customerPasswordStatus").textContent = "Nova senha salva. Envie-a ao cliente por um canal seguro."; $("#customerPasswordStatus").className = "status success";
    setTimeout(() => $("#userPasswordDialog").close(), 1100);
  } catch (error) { $("#customerPasswordStatus").textContent = error.message; $("#customerPasswordStatus").className = "status error"; } finally { button.disabled = false; }
});
$("#refreshPayments").addEventListener("click", () => loadPayments().catch(error => setStatus(error.message, "error")));
$("#paymentStatusFilter").addEventListener("change", renderPayments);
$("#newSpeech").addEventListener("click", () => openSpeechEditor());
$("#speechSearch").addEventListener("input", renderSpeeches);
$("#speechContextFilter").addEventListener("change", renderSpeeches);
$("#clearSpeechFilters").addEventListener("click", () => { $("#speechSearch").value = ""; $("#speechContextFilter").value = "all"; renderSpeeches(); });
$("#speechList").addEventListener("click", event => {
  const button = event.target.closest("[data-edit-speech]");
  if (button) openSpeechEditor(button.dataset.editSpeech);
});
$("#speechList").addEventListener("change", async event => {
  const toggle = event.target.closest("[data-speech-toggle]");
  if (!toggle) return;
  const speech = speechCache.find(item => item.id === toggle.dataset.speechToggle);
  if (!speech) return;
  toggle.disabled = true;
  try {
    await apiFetch("/api/admin-speeches", { method: "PUT", body: JSON.stringify({ ...speech, active: toggle.checked }) });
    await loadSpeeches();
  } catch (error) { toggle.checked = speech.active; setStatus(error.message, "error"); }
  finally { toggle.disabled = false; }
});
$("#speechAudio").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  $("#speechAudioPreview").src = URL.createObjectURL(file);
  $("#speechAudioPreview").hidden = false;
});
$("#saveSpeech").addEventListener("click", () => saveSpeech().catch(error => { $("#speechEditorStatus").textContent = error.message; $("#speechEditorStatus").className = "status error"; }));
$("#deleteSpeech").addEventListener("click", () => deleteSpeech().catch(error => { $("#speechEditorStatus").textContent = error.message; $("#speechEditorStatus").className = "status error"; }));
document.querySelectorAll("[data-toggle-secret]").forEach(button => button.addEventListener("click", () => {
  const input = $(`#${button.dataset.toggleSecret}`); input.type = input.type === "password" ? "text" : "password"; button.textContent = input.type === "password" ? "Mostrar" : "Ocultar";
}));

$("#changePassword").addEventListener("click", async () => {
  const button = $("#changePassword"); button.disabled = true;
  try { const { error } = await client.auth.updateUser({ password: $("#newPassword").value }); if (error) throw error; $("#newPassword").value = ""; $("#passwordStatus").textContent = "Senha alterada com sucesso."; $("#passwordStatus").className = "status success"; }
  catch (error) { $("#passwordStatus").textContent = error.message; $("#passwordStatus").className = "status error"; } finally { button.disabled = false; }
});
$("#signOut").addEventListener("click", async () => { await client.auth.signOut(); location.reload(); });

const { data: authData } = await client.auth.getSession();
if (authData.session) await openDashboard(); else showLogin();
