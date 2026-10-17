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
  } catch (error) { status("#loginStatus", error.message.includes("Invalid login") ? "E-mail, usuário ou senha incorretos." : error.message, "error"); submit.disabled = false; }
});

$("#signupForm").addEventListener("submit", async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true; status("#signupStatus", "Criando sua conta…");
  try {
    const { data, error } = await client.auth.signUp({ email: $("#signupEmail").value.trim(), password: $("#signupPassword").value, options: { data: { name: $("#signupName").value.trim() }, emailRedirectTo: `${location.origin}/checkout` } });
    if (error) throw error;
    if (data.session) location.replace("/checkout");
    else { status("#signupStatus", "Conta criada. Confira seu e-mail para confirmar o cadastro e depois faça login.", "success"); submit.disabled = false; }
  } catch (error) { status("#signupStatus", error.message, "error"); submit.disabled = false; }
});
