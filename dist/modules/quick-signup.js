import { apiFetch, getAtlasClient } from "/modules/supabase-client.js";

const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const storageKey = "atlas-fast-checkout-v1";
const saved = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
const state = { step: Number(saved.step) || 0, name: saved.name || "", email: saved.email || "", phone: saved.phone || "", planId: saved.planId || new URLSearchParams(location.search).get("plan") || "lifetime", fullName: saved.fullName || "", document: saved.document || "", couponCode: saved.couponCode || "", accountCreated: false };
const steps = [...document.querySelectorAll("[data-quick-step]")];
const messages = ["Leva menos de dois minutos", "Seu acesso", "Contato", "Conta segura", "Metade concluída", "Escolha seu plano", "Estamos quase lá", "Último dado", "Oferta pronta"];
let config;
let quote;
let polling;

function formatPhone(value) {
  const digits = String(value).replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatDocument(value) {
  const digits = String(value).replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 11) return digits.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return digits.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

function persist() {
  state.name = $("#quickName").value.trim(); state.email = $("#quickEmail").value.trim(); state.phone = $("#quickPhone").value; state.fullName = $("#quickFullName").value.trim(); state.document = $("#quickDocument").value; state.couponCode = $("#quickCoupon").value.trim().toUpperCase();
  sessionStorage.setItem(storageKey, JSON.stringify({ step: state.step, name: state.name, email: state.email, phone: state.phone, planId: state.planId, fullName: state.fullName, document: state.document, couponCode: state.couponCode }));
}

function setStatus(message, error = false) { $("#quickStatus").textContent = message; $("#quickStatus").className = `step-message${error ? " error" : ""}`; }

function renderStep() {
  steps.forEach((step, index) => step.classList.toggle("active", index === state.step));
  $("#quickProgressText").textContent = `Passo ${state.step + 1} de ${steps.length}`;
  $("#quickProgressMessage").textContent = messages[state.step];
  $("#quickProgressBar").style.width = `${((state.step + 1) / steps.length) * 100}%`;
  $("#quickBack").hidden = state.step === 0 || state.step === 8 || (state.accountCreated && state.step <= 5);
  $("#quickNext").textContent = state.step === 7 ? "Ver minha oferta" : "Continuar";
  $("#quickNavigation").classList.toggle("hidden", state.step === 8);
  setStatus(""); persist();
  const activeInput = steps[state.step]?.querySelector("input:not([type=radio])");
  activeInput?.focus();
}

function renderPlans() {
  const container = $("#quickPlans"); container.replaceChildren();
  Object.values(config.plans).filter(plan => plan.active !== false).forEach(plan => {
    const label = document.createElement("label"); label.className = "plan-choice";
    const input = document.createElement("input"); input.type = "radio"; input.name = "quickPlan"; input.value = plan.id; input.checked = state.planId === plan.id;
    input.addEventListener("change", () => { state.planId = plan.id; persist(); });
    const title = document.createElement("b"); title.textContent = plan.label;
    const billing = document.createElement("small"); billing.textContent = plan.billing;
    const badge = document.createElement("em"); badge.textContent = `${Math.max(0, Math.round((1 - plan.currentPrice / plan.oldPrice) * 100))}% DE DESCONTO`;
    label.append(input, title, billing, badge); container.append(label);
  });
  if (!container.querySelector("input:checked")) { const first = container.querySelector("input"); if (first) { first.checked = true; state.planId = first.value; } }
}

function currentField() {
  return [$("#quickName"), $("#quickEmail"), $("#quickPhone"), $("#quickPassword"), $("#quickPasswordConfirmation"), document.querySelector('input[name="quickPlan"]:checked'), $("#quickFullName"), $("#quickDocument")][state.step];
}

function validateStep() {
  const field = currentField();
  if (!field) { setStatus("Escolha um plano para continuar.", true); return false; }
  if (field.reportValidity && !field.reportValidity()) return false;
  if (state.step === 0 && /\s/.test(field.value.trim())) { setStatus("Digite somente seu primeiro nome.", true); return false; }
  if (state.step === 2 && ![10, 11].includes(field.value.replace(/\D/g, "").length)) { setStatus("Informe um telefone com DDD.", true); return false; }
  if (state.step === 4 && field.value !== $("#quickPassword").value) { setStatus("As senhas não são iguais.", true); return false; }
  if (state.step === 6 && !/\s/.test(field.value.trim())) { setStatus("Informe seu nome completo.", true); return false; }
  if (state.step === 7 && ![11, 14].includes(field.value.replace(/\D/g, "").length)) { setStatus("Informe um CPF ou CNPJ válido.", true); return false; }
  return true;
}

async function ensureAccount() {
  persist();
  const client = await getAtlasClient();
  let { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    const password = $("#quickPassword").value;
    const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "signup", name: state.name, email: state.email, phone: state.phone, password, passwordConfirmation: $("#quickPasswordConfirmation").value }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível criar sua conta.");
    const login = await client.auth.signInWithPassword({ email: state.email, password });
    if (login.error) throw login.error;
    sessionData = login.data;
  }
  await apiFetch("/api/profile", { method: "PUT", body: JSON.stringify({ name: state.fullName, document: state.document }) });
  state.accountCreated = true;
}

async function loadQuote() {
  const result = await apiFetch("/api/payment-create", { method: "POST", body: JSON.stringify({ action: "quote", planId: state.planId, couponCode: state.couponCode }) });
  quote = result.quote; renderQuote();
}

function renderQuote() {
  $("#offerPlanName").textContent = quote.plan.label;
  $("#offerBilling").textContent = quote.plan.billing;
  $("#offerOldPrice").textContent = money(quote.originalPrice);
  $("#offerFinalPrice").textContent = money(quote.amount);
  $("#offerDiscount").textContent = `${quote.discountPercent}% DE DESCONTO`;
  $("#offerSavings").textContent = `Você economiza ${money(quote.savings)} nesta oferta.`;
  $("#offerBenefits").replaceChildren(...quote.plan.benefits.map(text => { const item = document.createElement("li"); item.textContent = text; return item; }));
  $("#offerValues").classList.remove("price-pop"); requestAnimationFrame(() => $("#offerValues").classList.add("price-pop"));
}

async function advance() {
  if (!validateStep()) return;
  const button = $("#quickNext"); button.disabled = true;
  try {
    if (state.step === 5) state.planId = document.querySelector('input[name="quickPlan"]:checked').value;
    if (state.step === 7) { setStatus("Preparando sua oferta…"); await ensureAccount(); state.step = 8; await loadQuote(); }
    else state.step += 1;
    renderStep();
  } catch (error) { setStatus(error.message, true); } finally { button.disabled = false; }
}

function showPayment(payment) {
  $("#offerBeforePix").classList.add("hidden"); $("#quickPix").classList.remove("hidden");
  $("#quickQrImage").src = payment.qrUrl || payment.qrImage;
  $("#quickPixAmount").textContent = money(payment.amount);
  $("#quickPixCode").textContent = payment.pixCode;
  clearInterval(polling); polling = setInterval(checkPayment, 5000); checkPayment();
}

async function checkPayment() {
  try {
    const result = await apiFetch("/api/payment-status");
    if (result.accessGranted) { clearInterval(polling); $("#quickPixStatus").textContent = "Pagamento confirmado. Abrindo o Atlas…"; $("#quickPixStatus").className = "status success"; sessionStorage.removeItem(storageKey); setTimeout(() => location.replace("/app"), 900); }
    else $("#quickPixStatus").textContent = result.status === "pending" ? "Aguardando a confirmação do PIX…" : `Status: ${result.status}`;
  } catch (error) { $("#quickPixStatus").textContent = error.message; $("#quickPixStatus").className = "status error"; }
}

$("#quickName").value = state.name; $("#quickEmail").value = state.email; $("#quickPhone").value = state.phone; $("#quickFullName").value = state.fullName; $("#quickDocument").value = state.document; $("#quickCoupon").value = state.couponCode;
$("#quickPhone").addEventListener("input", event => { event.currentTarget.value = formatPhone(event.currentTarget.value); persist(); });
$("#quickDocument").addEventListener("input", event => { event.currentTarget.value = formatDocument(event.currentTarget.value); persist(); });
document.querySelectorAll("#quickName,#quickEmail,#quickFullName,#quickCoupon").forEach(input => input.addEventListener("input", persist));
$("#quickNext").addEventListener("click", advance);
$("#quickBack").addEventListener("click", () => { if (state.step > 0) { state.step -= 1; renderStep(); } });
$("#quickForm").addEventListener("submit", event => { event.preventDefault(); advance(); });
$("#applyCoupon").addEventListener("click", async () => { const button = $("#applyCoupon"); button.disabled = true; try { state.couponCode = $("#quickCoupon").value.trim().toUpperCase(); await loadQuote(); $("#couponMessage").textContent = quote.coupon ? `Cupom ${quote.coupon.code} aplicado.` : "Preço da oferta atualizado."; $("#couponMessage").className = "step-message"; persist(); } catch (error) { $("#couponMessage").textContent = error.message; $("#couponMessage").className = "step-message error"; } finally { button.disabled = false; } });
$("#finishPayment").addEventListener("click", async () => { const button = $("#finishPayment"); button.disabled = true; try { const result = await apiFetch("/api/payment-create", { method: "POST", body: JSON.stringify({ planId: state.planId, couponCode: state.couponCode, name: state.fullName, document: state.document }) }); if (result.accessGranted) location.replace("/app"); else showPayment(result.payment); } catch (error) { $("#couponMessage").textContent = error.message; $("#couponMessage").className = "step-message error"; } finally { button.disabled = false; } });
$("#quickCopyPix").addEventListener("click", async () => { await navigator.clipboard.writeText($("#quickPixCode").textContent); $("#quickCopyPix").textContent = "Código copiado ✓"; });

config = await fetch("/api/public-config").then(response => response.json());
renderPlans();
const client = await getAtlasClient();
const { data: currentSession } = await client.auth.getSession();
if (currentSession.session) {
  const account = await apiFetch("/api/me");
  if (account.profile?.access_granted) location.replace("/app");
  state.accountCreated = true; state.email = currentSession.session.user.email; state.name = account.profile?.name?.split(" ")[0] || state.name; state.phone = account.profile?.phone || state.phone; state.fullName = account.profile?.name || state.fullName; state.document = account.profile?.document || state.document; state.step = Math.max(5, Math.min(state.step, 8));
  $("#quickName").value = state.name; $("#quickEmail").value = state.email; $("#quickPhone").value = formatPhone(state.phone); $("#quickFullName").value = state.fullName; $("#quickDocument").value = formatDocument(state.document);
  if (state.step === 8) await loadQuote();
} else if (state.step > 3) state.step = 3;
renderStep();
