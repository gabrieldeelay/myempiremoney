import { apiFetch, getAtlasClient } from "/modules/supabase-client.js";
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const client = await getAtlasClient();
const { data: sessionData } = await client.auth.getSession();
if (!sessionData.session) location.replace("/acesso?returnTo=/checkout");

let polling;
try {
  const [account, config] = await Promise.all([apiFetch("/api/me"), fetch("/api/public-config").then(response => response.json())]);
  if (account.profile?.role === "admin") location.replace("/admin");
  if (account.profile?.access_granted) location.replace("/app");
  $("#name").value = account.profile?.name || "";
  $("#document").value = account.profile?.document || "";
  $("#oldPrice").textContent = money(config.pricing.oldPrice);
  $("#currentPrice").textContent = money(config.pricing.currentPrice);
  if (account.payment?.status === "pending") checkStatus();
} catch (error) { $("#paymentStatus").textContent = error.message; $("#paymentStatus").classList.add("error"); }

function showPayment(payment) {
  $("#emptyPix").classList.add("hidden"); $("#pixReady").classList.remove("hidden");
  $("#qrImage").src = payment.qrUrl || payment.qrImage;
  $("#pixAmount").textContent = money(payment.amount);
  $("#pixCode").textContent = payment.pixCode;
  clearInterval(polling); polling = setInterval(checkStatus, 5000); checkStatus();
}

async function checkStatus() {
  try {
    const result = await apiFetch("/api/payment-status");
    if (result.accessGranted) { clearInterval(polling); $("#pixStatus").textContent = "Pagamento confirmado. Abrindo o Atlas…"; $("#pixStatus").className = "status success"; setTimeout(() => location.replace("/app"), 900); }
    else $("#pixStatus").textContent = result.status === "pending" ? "Aguardando a confirmação do PIX…" : `Status: ${result.status}`;
  } catch (error) { if (!error.message.includes("Nenhuma cobrança")) { $("#pixStatus").textContent = error.message; $("#pixStatus").className = "status error"; } }
}

$("#paymentForm").addEventListener("submit", async event => {
  event.preventDefault(); const submit = event.currentTarget.querySelector("button[type=submit]"); submit.disabled = true;
  try { const payment = await apiFetch("/api/payment-create", { method: "POST", body: JSON.stringify({ name: $("#name").value, document: $("#document").value }) }); if (payment.accessGranted) location.replace("/app"); else showPayment(payment.payment); }
  catch (error) { $("#paymentStatus").textContent = error.message; $("#paymentStatus").className = "status error"; } finally { submit.disabled = false; }
});
$("#copyPix").addEventListener("click", async () => { await navigator.clipboard.writeText($("#pixCode").textContent); $("#copyPix").textContent = "Código copiado ✓"; setTimeout(() => $("#copyPix").textContent = "Copiar código PIX", 1800); });
$("#signOut").addEventListener("click", async () => { await client.auth.signOut(); location.replace("/"); });
