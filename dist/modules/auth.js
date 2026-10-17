import { apiFetch, getAtlasClient } from "/modules/supabase-client.js";

const $ = selector => document.querySelector(selector);
const buttons = [...document.querySelectorAll("[data-mode]")];

function status(id, message, kind = "") { const node = $(id); node.textContent = message; node.className = `status ${kind}`; }
function setMode(mode) {
  document.querySelectorAll("[data-auth]").forEach(node => node.classList.toggle("hidden", node.dataset.auth !== mode));
  buttons.filter(button => button.closest(".tabs")).forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  history.replaceState({}, "", mode === "signup" ? "/acesso?mode=signup" : "/acesso");
}

buttons.forEach(button => button.addEventListener("click", () => setMode(button.dataset.mode)));
if (new URLSearchParams(location.search).get("mode") === "signup") setMode("signup");
const adminMode = new URLSearchParams(location.search).get("admin") === "1";
if (adminMode) {
  $("#loginTitle").textContent = "Acesso administrativo.";
  $("#loginIntro").textContent = "Entre com o usuário e a senha do administrador.";
  $("#loginLabel").textContent = "Usuário";
  $("#loginId").type = "text";
  $("#loginId").value = "admin";
  document.querySelector(".tabs").classList.add("hidden");
}

function formatPhone(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

$("#signupPhone").addEventListener("input", event => { event.currentTarget.value = formatPhone(event.currentTarget.value); });

const client = await getAtlasClient();
const { data: existing } = await client.auth.getSession();
if (existing.session) {
  apiFetch("/api/me").then(account => location.replace(account.profile?.role === "admin" ? "/admin" : account.profile?.access_granted ? "/app" : "/checkout")).catch(() => {});
}

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true; status("#loginStatus", "Entrando…");
  try {
    const identity = $("#loginId").value.trim();
    const email = identity.toLowerCase() === "admin" ? "admin@atlas.local" : identity;
    const { error } = await client.auth.signInWithPassword({ email, password: $("#loginPassword").value });
    if (error) throw error;
    const account = await apiFetch("/api/me");
    location.replace(account.profile?.role === "admin" ? "/admin" : account.profile?.access_granted ? "/app" : "/checkout");
  } catch (error) { status("#loginStatus", error.message.includes("Invalid login") ? "E-mail ou senha incorretos." : error.message, "error"); submit.disabled = false; }
});

const signupSteps = [...document.querySelectorAll("[data-signup-step]")];
const signupFields = [$("#signupName"), $("#signupEmail"), $("#signupPhone"), $("#signupPassword"), $("#signupPasswordConfirmation")];
const signupMessages = ["Vamos começar", "Bom começo", "Metade concluída", "Estamos quase lá", "Último passo"];
let signupStep = 0;

function renderSignupStep() {
  signupSteps.forEach((step, index) => step.classList.toggle("active", index === signupStep));
  $("#signupProgressText").textContent = `Passo ${signupStep + 1} de ${signupSteps.length}`;
  $("#signupProgressMessage").textContent = signupMessages[signupStep];
  $("#signupProgressBar").style.width = `${((signupStep + 1) / signupSteps.length) * 100}%`;
  $("#signupBack").hidden = signupStep === 0;
  $("#signupNext").textContent = signupStep === signupSteps.length - 1 ? "Criar conta e continuar" : "Continuar";
  $("#signupStatus").textContent = "";
  signupFields[signupStep]?.focus();
}

function validateSignupStep() {
  const field = signupFields[signupStep];
  if (!field.reportValidity()) return false;
  if (signupStep === 0 && /\s/.test(field.value.trim())) {
    $("#signupStatus").textContent = "Digite somente seu primeiro nome.";
    $("#signupStatus").className = "step-message error";
    return false;
  }
  if (signupStep === 4 && field.value !== $("#signupPassword").value) {
    $("#signupStatus").textContent = "As senhas não são iguais.";
    $("#signupStatus").className = "step-message error";
    return false;
  }
  return true;
}

async function finishSignup() {
  const submit = $("#signupNext");
  submit.disabled = true;
  $("#signupStatus").textContent = "Criando sua conta…";
  try {
    const email = $("#signupEmail").value.trim();
    const password = $("#signupPassword").value;
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signup", name: $("#signupName").value.trim(), email, phone: $("#signupPhone").value, password, passwordConfirmation: $("#signupPasswordConfirmation").value })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível criar sua conta.");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    location.replace("/checkout");
  } catch (error) {
    $("#signupStatus").textContent = error.message;
    $("#signupStatus").className = "step-message error";
    submit.disabled = false;
  }
}

$("#signupNext").addEventListener("click", async () => {
  if (!validateSignupStep()) return;
  if (signupStep < signupSteps.length - 1) { signupStep += 1; renderSignupStep(); }
  else await finishSignup();
});
$("#signupBack").addEventListener("click", () => { if (signupStep > 0) { signupStep -= 1; renderSignupStep(); } });
$("#signupForm").addEventListener("submit", event => { event.preventDefault(); $("#signupNext").click(); });
renderSignupStep();
