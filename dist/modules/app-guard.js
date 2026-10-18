import { apiFetch, getAtlasClient } from "/modules/atlas-client.js";

document.documentElement.classList.add("auth-checking");

try {
  const client = await getAtlasClient();
  const { data } = await client.auth.getSession();
  if (!data.session) location.replace("/acesso?returnTo=/app");
  else {
    const account = await apiFetch("/api/me");
    if (account.profile?.role === "admin") location.replace("/admin");
    else if (!account.profile?.access_granted) location.replace("/checkout");
    else document.documentElement.classList.remove("auth-checking");
  }
} catch (error) {
  console.error(error);
  location.replace("/acesso?error=session");
}
