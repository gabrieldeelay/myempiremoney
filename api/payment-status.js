const { requireUser, sendError } = require("../lib/auth");
const { one } = require("../lib/db");
const { activatePayment } = require("../lib/payments");
const { getVenoCredentials } = require("../lib/settings");

const REVOKED = new Set(["expired", "canceled", "contested", "chargedback", "refunded"]);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
  try {
    const { user, db } = await requireUser(req);
    const payment = await one("SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 1", [user.id]);
    if (!payment) return res.status(404).json({ error: "Nenhuma cobrança encontrada." });
    const credentials = await getVenoCredentials(db);
    if (!credentials) return res.status(503).json({ error: "Venopag não configurada." });
    const url = new URL("https://venopagments.com/api/consult-transaction");
    url.searchParams.set("request_number", payment.request_number);
    const response = await fetch(url, { headers: { "X-Client-Id": credentials.clientId, "X-Client-Secret": credentials.clientSecret } });
    const payload = await response.json().catch(() => ({ ok: false, error: "Resposta inválida da Venopag." }));
    if (!payload.ok) return res.status(response.status === 429 ? 429 : 422).json({ error: payload.error || "Não foi possível consultar o PIX." });
    const status = String(payload.status || "pending").toLowerCase();
    if (status === "confirmed") {
      await activatePayment(payment.id, payload);
    } else {
      await db.execute("UPDATE payments SET status=?,raw=?,updated_at=UTC_TIMESTAMP() WHERE id=?", [status, JSON.stringify(payload), payment.id]);
      if (REVOKED.has(status)) await db.execute("UPDATE users SET access_granted=0,access_status=?,updated_at=UTC_TIMESTAMP() WHERE id=?", [status, user.id]);
    }
    return res.status(200).json({ status, accessGranted: status === "confirmed", remaining: payload.remaining ?? null });
  } catch (error) {
    return sendError(res, error);
  }
};
