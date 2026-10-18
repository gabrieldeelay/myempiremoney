const crypto = require("node:crypto");
const { requireUser, sendError } = require("../lib/auth");
const { one } = require("../lib/db");
const { getPublicSettings, getVenoCredentials } = require("../lib/settings");

function digits(value) { return String(value || "").replace(/\D/g, ""); }

async function buildQuote(db, settings, planId, couponCode) {
  const plan = settings.plans?.[planId];
  if (!plan || plan.active === false) {
    const error = new Error("Este plano não está disponível.");
    error.status = 422;
    throw error;
  }
  const originalPrice = Number(plan.oldPrice);
  const offerPrice = Number(plan.currentPrice);
  let coupon = null;
  let couponDiscount = 0;
  const code = String(couponCode || "").trim().toUpperCase();
  if (code) {
    const data = await one("SELECT * FROM coupons WHERE code = ? AND active = 1 LIMIT 1", [code]);
    const now = Date.now();
    if (!data || (data.valid_from && new Date(data.valid_from).getTime() > now) || (data.valid_until && new Date(data.valid_until).getTime() < now) || (data.max_uses && data.uses_count >= data.max_uses)) {
      const error = new Error("Cupom inválido, expirado ou esgotado.");
      error.status = 422;
      throw error;
    }
    coupon = data;
    couponDiscount = data.type === "fixed" ? Number(data.value) : offerPrice * (Number(data.value) / 100);
  }
  const amount = Number(Math.max(1, offerPrice - couponDiscount).toFixed(2));
  couponDiscount = Number((offerPrice - amount).toFixed(2));
  return {
    plan: { id: planId, label: plan.label, billing: plan.billing, benefits: plan.benefits || [] },
    coupon,
    originalPrice,
    offerPrice,
    couponDiscount,
    amount,
    savings: Number(Math.max(0, originalPrice - amount).toFixed(2)),
    discountPercent: Math.max(0, Math.round((1 - amount / originalPrice) * 100))
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  try {
    const { user, profile, db } = await requireUser(req);
    if (profile?.access_granted) return res.status(200).json({ accessGranted: true });
    const settings = await getPublicSettings(db);
    const planId = "monthly";
    const quote = await buildQuote(db, settings, planId, req.body?.couponCode);
    if (req.body?.action === "quote") return res.status(200).json({ quote: { ...quote, coupon: quote.coupon ? { code: quote.coupon.code } : null } });
    const credentials = await getVenoCredentials(db);
    if (!credentials) return res.status(503).json({ error: "O pagamento ainda não foi ativado pelo administrador." });
    const name = String(req.body?.name || profile?.name || "").trim();
    const document = digits(req.body?.document || profile?.document);
    if (name.length < 3 || ![11, 14].includes(document.length)) return res.status(422).json({ error: "Informe nome completo e CPF/CNPJ para gerar o PIX." });
    const amount = quote.amount;
    const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host || "nossoatlas.com"}`;
    const response = await fetch("https://venopagments.com/api/cashin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": credentials.clientId,
        "X-Client-Secret": credentials.clientSecret,
        "Idempotency-Key": `atlas-${user.id}-${crypto.randomUUID()}`
      },
      body: JSON.stringify({ amount, name, document, description: quote.plan.label, webhook_url: `${origin}/api/venopag-webhook` })
    });
    const payload = await response.json().catch(() => ({ ok: false, error: "Resposta inválida da Venopag." }));
    if (!payload.ok) return res.status(response.status === 429 ? 429 : 422).json({ error: payload.error || "Não foi possível gerar o PIX." });
    const expiresAt = new Date(Date.now() + Number(payload.expire_minutes || 30) * 60000).toISOString();
    await db.execute(
      `INSERT INTO payments (id,user_id,request_number,transaction_id,amount,original_amount,discount_amount,plan_id,coupon_id,status,pix_code,qr_url,expires_at,raw,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE transaction_id=VALUES(transaction_id),amount=VALUES(amount),original_amount=VALUES(original_amount),discount_amount=VALUES(discount_amount),plan_id=VALUES(plan_id),coupon_id=VALUES(coupon_id),status=VALUES(status),pix_code=VALUES(pix_code),qr_url=VALUES(qr_url),expires_at=VALUES(expires_at),raw=VALUES(raw),updated_at=UTC_TIMESTAMP()`,
      [crypto.randomUUID(), user.id, payload.request_number, payload.transaction_id || "", amount, quote.originalPrice, quote.couponDiscount, planId, quote.coupon?.id || null, payload.status || "pending", payload.copyPaste || "", payload.qr_url || "", new Date(expiresAt), JSON.stringify(payload)]
    );
    await db.execute("UPDATE users SET name=?,document=?,access_status='pending',updated_at=UTC_TIMESTAMP() WHERE id=?", [name, document, user.id]);
    return res.status(200).json({ quote: { ...quote, coupon: quote.coupon ? { code: quote.coupon.code } : null }, payment: { requestNumber: payload.request_number, amount, status: payload.status, pixCode: payload.copyPaste, qrUrl: payload.qr_url, qrImage: payload.qr_img ? `data:image/png;base64,${payload.qr_img}` : "", expiresAt } });
  } catch (error) {
    return sendError(res, error);
  }
};
