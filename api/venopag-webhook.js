const crypto = require("node:crypto");
const { getAdminClient } = require("../lib/supabase-admin");
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
    const supabase = getAdminClient();
    const credentials = await getVenoCredentials(supabase);
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
    const { data: payment } = await supabase.from("payments").select("id,user_id,status").eq("request_number", requestNumber).maybeSingle();
    if (!payment) return res.status(200).json({ ok: true });
    if (payment.status !== status) await supabase.from("payments").update({ status, raw: event, updated_at: new Date().toISOString() }).eq("id", payment.id);
    if (status === "confirmed") await supabase.from("profiles").update({ access_granted: true, access_status: "active", updated_at: new Date().toISOString() }).eq("id", payment.user_id);
    else if (REVOKED.has(status)) await supabase.from("profiles").update({ access_granted: false, access_status: status, updated_at: new Date().toISOString() }).eq("id", payment.user_id);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Falha ao processar webhook." });
  }
};

module.exports.config = { api: { bodyParser: false } };
