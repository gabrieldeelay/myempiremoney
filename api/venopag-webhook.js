const crypto = require("node:crypto");
const { getDb, one } = require("../lib/db");
const { activatePayment } = require("../lib/payments");
const { getVenoCredentials } = require("../lib/settings");

const REVOKED = new Set(["expired", "canceled", "contested", "chargedback", "refunded"]);

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  try {
    const db = getDb();
    const credentials = await getVenoCredentials(db);
    if (!credentials?.webhookSecret) return res.status(503).json({ error: "Webhook não configurado." });
    const rawBody = typeof req.body === "string"
      ? req.body
      : req.body && Object.keys(req.body).length
        ? JSON.stringify(req.body)
        : await readRawBody(req);
    const signature = String(req.headers["x-veno-signature"] || "");
    const entries = Object.fromEntries(signature.split(",").map(part => part.split("=").map(value => value.trim())));
    const timestamp = Number(entries.t);
    if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return res.status(401).json({ error: "Assinatura expirada." });
    const expected = crypto.createHmac("sha256", credentials.webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");
    if (!safeEqual(entries.v1, expected)) return res.status(401).json({ error: "Assinatura inválida." });
    const event = req.body && typeof req.body === "object" && Object.keys(req.body).length
      ? req.body
      : JSON.parse(rawBody);
    const requestNumber = String(event.request_number || event.data?.request_number || "");
    const status = String(event.status || event.data?.status || "").toLowerCase();
    if (!requestNumber || !status) return res.status(422).json({ error: "Evento incompleto." });
    const payment = await one("SELECT id,user_id,status FROM payments WHERE request_number=? LIMIT 1", [requestNumber]);
    if (!payment) return res.status(200).json({ ok: true });
    if (status === "confirmed") {
      await activatePayment(payment.id, event);
    } else {
      if (payment.status !== status) await db.execute("UPDATE payments SET status=?,raw=?,updated_at=UTC_TIMESTAMP() WHERE id=?", [status, JSON.stringify(event), payment.id]);
      if (REVOKED.has(status)) await db.execute("UPDATE users SET access_granted=0,access_status=?,updated_at=UTC_TIMESTAMP() WHERE id=?", [status, payment.user_id]);
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Falha ao processar webhook." });
  }
};

module.exports.config = { api: { bodyParser: false } };
