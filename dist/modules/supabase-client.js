import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.75.1/+esm";

let clientPromise;

export async function getAtlasClient() {
  if (!clientPromise) {
    clientPromise = fetch("/api/public-config", { headers: { Accept: "application/json" } })
      .then(async response => {
        const config = await response.json();
        if (!response.ok || !config.supabaseUrl || !config.supabaseAnonKey) throw new Error(config.error || "Configuração de acesso indisponível.");
        window.__ATLAS_PUBLIC_CONFIG__ = config;
        return createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
      });
  }
  return clientPromise;
}

export async function getAccessToken() {
  const client = await getAtlasClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token || "";
}

export async function apiFetch(path, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir esta ação.");
  return payload;
}
