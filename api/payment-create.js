const crypto = require("node:crypto");
const { requireUser, sendError } = require("../lib/supabase-admin");
const { getPublicSettings, getVenoCredentials } = require("../lib/settings");

function digits(value) { return String(value || "").replace(/\D/g, ""); }

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  try {
    const { user, profile, supabase } = await requireUser(req);
    if (profile?.access_granted) return res.status(200).json({ accessGranted: true });
    const credentials = await getVenoCredentials(supabase);
    if (!credentials) return res.status(503).json({ error: "O pagamento ainda não foi ativado pelo administrador." });
    const name = String(req.body?.name || profile?.name || "").trim();
    const document = digits(req.body?.document || profile?.document);
    if (name.length < 3 || ![11, 14].includes(document.length)) return res.status(422).json({ error: "Informe nome completo e CPF/CNPJ para gerar o PIX." });
    const settings = await getPublicSettings(supabase);
    const amount = Number(Number(settings.pricing.currentPrice).toFixed(2));
    const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host || "atlas-guard-trading.vercel.app"}`;
    const response = await fetch("https://venopagments.com/api/cashin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": credentials.clientId,
        "X-Client-Secret": credentials.clientSecret,
        "Idempotency-Key": `atlas-${user.id}-${crypto.randomUUID()}`
      },
      body: JSON.stringify({ amount, name, document, description: "Acesso Atlas", webhook_url: `${origin}/api/venopag-webhook` })
    });
    const payload = await response.json().catch(() => ({ ok: false, error: "Resposta inválida da Venopag." }));
    if (!payload.ok) return res.status(response.status === 429 ? 429 : 422).json({ error: payload.error || "Não foi possível gerar o PIX." });
    const expiresAt = new Date(Date.now() + Number(payload.expire_minutes || 30) * 60000).toISOString();
    const { error } = await supabase.from("payments").upsert({
      user_id: user.id,
      request_number: payload.request_number,
      transaction_id: payload.transaction_id || "",
      amount,
      status: payload.status || "pending",
      pix_code: payload.copyPaste || "",
      qr_url: payload.qr_url || "",
      expires_at: expiresAt,
      raw: payload,
      updated_at: new Date().toISOString()
    }, { onConflict: "request_number" });
    if (error) throw error;
    await supabase.from("profiles").update({ name, document, access_status: "pending", updated_at: new Date().toISOString() }).eq("id", user.id);
    return res.status(200).json({ payment: { requestNumber: payload.request_number, amount, status: payload.status, pixCode: payload.copyPaste, qrUrl: payload.qr_url, qrImage: payload.qr_img ? `data:image/png;base64,${payload.qr_img}` : "", expiresAt } });
  } catch (error) {
    return sendError(res, error);
  }
};
