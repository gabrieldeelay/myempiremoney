import { apiFetch, saveCheckoutSession } from "/modules/atlas-client.js";

const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
let polling;
let config;
let planId = new URLSearchParams(location.search).get("plan") || "session_15";
let couponCode = "";
let quote;

function renderPlans() {
  const access = config.plans?.[planId] || config.plans?.session_15 || Object.values(config.plans || {}).find(plan => plan.active !== false);
  if (access) planId = access.id;
}

async function loadQuote() {
  const result = await apiFetch("/api/payment-create", { method: "POST", body: JSON.stringify({ action: "quote", planId, couponCode }) });
  quote = result.quote;
  $("#oldPrice").textContent = quote.discountPercent ? money(quote.originalPrice) : ""; $("#currentPrice").textContent = money(quote.amount); $("#checkoutSavings").textContent = quote.discountPercent ? `Você economiza ${money(quote.savings)} nesta oferta.` : "Pagamento único para esta sessão."; $("#discountBadge").textContent = quote.discountPercent ? `${quote.discountPercent}% DE DESCONTO` : "PASSE SELECIONADO";
  $("#checkoutBenefits").replaceChildren(...quote.plan.benefits.map(text => { const item = document.createElement("li"); item.textContent = text; return item; }));
  $("#checkoutValues").classList.remove("price-pop"); requestAnimationFrame(() => $("#checkoutValues").classList.add("price-pop"));
}

try {
  config = await fetch("/api/public-config").then(response => response.json()); renderPlans();
  await loadQuote();
} catch (error) { $("#paymentStatus").textContent = error.message; $("#paymentStatus").className = "status error"; }

function showPayment(payment) {
  $("#emptyPix").classList.add("hidden"); $("#pixReady").classList.remove("hidden");
  $("#qrImage").src = payment.qrUrl || payment.qrImage; $("#pixAmount").textContent = money(payment.amount); $("#pixCode").textContent = payment.pixCode;
  clearInterval(polling); polling = setInterval(checkStatus, 5000); checkStatus();
}

async function checkStatus() {
  try {
    const result = await apiFetch("/api/payment-status");
    if (result.accessGranted) { clearInterval(polling); $("#pixStatus").textContent = "Pagamento confirmado. Colocando você na fila…"; $("#pixStatus").className = "status success"; setTimeout(() => location.replace("/play"), 900); }
    else $("#pixStatus").textContent = result.status === "pending" ? "Aguardando a confirmação do PIX…" : `Status: ${result.status}`;
  } catch (error) { if (!error.message.includes("Nenhuma cobrança")) { $("#pixStatus").textContent = error.message; $("#pixStatus").className = "status error"; } }
}

$("#applyCoupon").addEventListener("click", async () => { const button = $("#applyCoupon"); button.disabled = true; try { couponCode = $("#coupon").value.trim().toUpperCase(); await loadQuote(); $("#couponStatus").textContent = quote.coupon ? `Cupom ${quote.coupon.code} aplicado.` : "Oferta atualizada."; $("#couponStatus").className = "step-message"; } catch (error) { $("#couponStatus").textContent = error.message; $("#couponStatus").className = "step-message error"; } finally { button.disabled = false; } });
$("#paymentForm").addEventListener("submit", async event => {
  event.preventDefault(); const submit = event.currentTarget.querySelector("button[type=submit]"); submit.disabled = true;
  try {
    const result = await apiFetch("/api/payment-create", { method: "POST", body: JSON.stringify({ planId, couponCode, name: $("#name").value, document: $("#document").value }) });
    if (result.session?.token) saveCheckoutSession({ access_token: result.session.token, expires_at: result.session.expiresAt, user: result.session.user });
    showPayment(result.payment);
  }
  catch (error) { $("#paymentStatus").textContent = error.message; $("#paymentStatus").className = "status error"; } finally { submit.disabled = false; }
});
$("#copyPix").addEventListener("click", async () => { await navigator.clipboard.writeText($("#pixCode").textContent); $("#copyPix").textContent = "Código copiado ✓"; });
