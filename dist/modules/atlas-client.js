const STORAGE_KEY = "atlas-session-v2";
let client;

function loadSession() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
}

function saveSession(session) {
  if (session?.access_token) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

async function authRequest(action, body = {}) {
  const session = loadSession();
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
    },
    body: JSON.stringify({ action, ...body })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { data: null, error: new Error(payload.error || "Não foi possível concluir esta ação.") };
  return { data: payload, error: null };
}

export async function getAtlasClient() {
  if (!client) {
    client = {
      auth: {
        async getSession() { return { data: { session: loadSession() }, error: null }; },
        async signInWithPassword({ email, password }) {
          const result = await authRequest("login", { email, password });
          if (!result.error) {
            const session = { access_token: result.data.token, expires_at: result.data.expiresAt, user: result.data.user };
            saveSession(session);
            return { data: { session, user: result.data.user }, error: null };
          }
          return result;
        },
        async signOut() {
          await authRequest("logout").catch(() => {});
          saveSession(null);
          return { error: null };
        },
        async updateUser({ password }) {
          const result = await authRequest("change_password", { password });
          return { data: result.data, error: result.error };
        }
      }
    };
  }
  return client;
}

export async function getAccessToken() {
  return loadSession()?.access_token || "";
}

export async function apiFetch(path, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) saveSession(null);
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir esta ação.");
  return payload;
}
