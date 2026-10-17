const { requireUser, sendError } = require("../lib/supabase-admin");
const { getVenoCredentials } = require("../lib/settings");

const REVOKED = new Set(["expired", "canceled", "contested", "chargedback", "refunded"]);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
  try {
    const { user, supabase } = await requireUser(req);
    const { data: payment } = await supabase.from("payments").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!payment) return res.status(404).json({ error: "Nenhuma cobrança encontrada." });
    const credentials = await getVenoCredentials(supabase);
    if (!credentials) return res.status(503).json({ error: "Venopag não configurada." });
    const url = new URL("https://venopagments.com/api/consult-transaction");
    url.searchParams.set("request_number", payment.request_number);
    const response = await fetch(url, { headers: { "X-Client-Id": credentials.clientId, "X-Client-Secret": credentials.clientSecret } });
    const payload = await response.json().catch(() => ({ ok: false, error: "Resposta inválida da Venopag." }));
    if (!payload.ok) return res.status(response.status === 429 ? 429 : 422).json({ error: payload.error || "Não foi possível consultar o PIX." });
    const status = String(payload.status || "pending").toLowerCase();
    await supabase.from("payments").update({ status, raw: payload, updated_at: new Date().toISOString() }).eq("id", payment.id);
    if (status === "confirmed") await supabase.from("profiles").update({ access_granted: true, access_status: "active", updated_at: new Date().toISOString() }).eq("id", user.id);
    else if (REVOKED.has(status)) await supabase.from("profiles").update({ access_granted: false, access_status: status, updated_at: new Date().toISOString() }).eq("id", user.id);
    return res.status(200).json({ status, accessGranted: status === "confirmed", remaining: payload.remaining ?? null });
  } catch (error) {
    return sendError(res, error);
  }
};
