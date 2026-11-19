const crypto = require("node:crypto");
const { bearerToken, createSession, hashPassword, requireUser, sendError } = require("../lib/auth");
const { getDb, one } = require("../lib/db");
const { getPublicSettings, getVenoCredentials } = require("../lib/settings");
const { getCloudPlan } = require("../lib/cloud-plans");

function digits(value) { return String(value || "").replace(/\D/g, ""); }

async function createGuestCheckoutUser(db, name, document) {
  const id = crypto.randomUUID();
  const email = `guest.${id}@checkout.nossoatlas.local`;
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString("base64url"));
  await db.execute(
    `INSERT INTO users (id,email,password_hash,name,document,role,access_granted,access_status,created_at,updated_at)
     VALUES (?,?,?,?,?,'user',0,'pending',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
    [id, email, passwordHash, name, document]
  );
  const session = await createSession(id);
  return { user: { id, email }, profile: { name, document }, session };
}

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
    const db = getDb();
    const settings = await getPublicSettings(db);
    const planId = String(req.body?.planId || "session_15");
    if (!getCloudPlan(planId)) return res.status(422).json({ error: "Escolha um passe de jogo válido." });
    const quote = await buildQuote(db, settings, planId, req.body?.couponCode);
    if (req.body?.action === "quote") return res.status(200).json({ quote: { ...quote, coupon: quote.coupon ? { code: quote.coupon.code } : null } });
    const credentials = await getVenoCredentials(db);
    if (!credentials) return res.status(503).json({ error: "O pagamento ainda não foi ativado pelo administrador." });
    let context = null;
    if (bearerToken(req)) {
      try { context = await requireUser(req); }
      catch (error) { if (Number(error?.status) !== 401) throw error; }
    }
    const name = String(req.body?.name || context?.profile?.name || "").trim();
    const document = digits(req.body?.document || context?.profile?.document);
    if (name.length < 3 || ![11, 14].includes(document.length)) return res.status(422).json({ error: "Informe nome completo e CPF/CNPJ para gerar o PIX." });
    if (!context) context = { db, ...(await createGuestCheckoutUser(db, name, document)), guest: true };
    const { user, profile } = context;
    const amount = quote.amount;
    const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host || "nossoatlas.com"}`;
    const response = await fetch("https://venopagments.com/api/cashin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": credentials.clientId,
        "X-Client-Secret": credentials.clientSecret,
        "Idempotency-Key": `vice-cloud-${user.id}-${crypto.randomUUID()}`
      },
      body: JSON.stringify({ amount, name, document, description: quote.plan.label, webhook_url: `${origin}/api/venopag-webhook` })
    });
    const payload = await response.json().catch(() => ({ ok: false, error: "Resposta inválida da Venopag." }));
    if (!payload.ok) {
      if (context.guest) await db.execute("DELETE FROM users WHERE id=?", [user.id]).catch(() => {});
      return res.status(response.status === 429 ? 429 : 422).json({ error: payload.error || "Não foi possível gerar o PIX." });
    }
    const expiresAt = new Date(Date.now() + Number(payload.expire_minutes || 30) * 60000).toISOString();
    await db.execute(
      `INSERT INTO payments (id,user_id,request_number,transaction_id,amount,original_amount,discount_amount,plan_id,coupon_id,status,pix_code,qr_url,expires_at,raw,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE transaction_id=VALUES(transaction_id),amount=VALUES(amount),original_amount=VALUES(original_amount),discount_amount=VALUES(discount_amount),plan_id=VALUES(plan_id),coupon_id=VALUES(coupon_id),status=VALUES(status),pix_code=VALUES(pix_code),qr_url=VALUES(qr_url),expires_at=VALUES(expires_at),raw=VALUES(raw),updated_at=UTC_TIMESTAMP()`,
      [crypto.randomUUID(), user.id, payload.request_number, payload.transaction_id || "", amount, quote.originalPrice, quote.couponDiscount, planId, quote.coupon?.id || null, payload.status || "pending", payload.copyPaste || "", payload.qr_url || "", new Date(expiresAt), JSON.stringify(payload)]
    );
    await db.execute("UPDATE users SET name=?,document=?,access_status='pending',updated_at=UTC_TIMESTAMP() WHERE id=?", [name, document, user.id]);
    return res.status(200).json({
      quote: { ...quote, coupon: quote.coupon ? { code: quote.coupon.code } : null },
      payment: { requestNumber: payload.request_number, amount, status: payload.status, pixCode: payload.copyPaste, qrUrl: payload.qr_url, qrImage: payload.qr_img ? `data:image/png;base64,${payload.qr_img}` : "", expiresAt },
      session: context.guest ? { token: context.session.token, expiresAt: context.session.expiresAt, user } : null
    });
  } catch (error) {
    return sendError(res, error);
  }
};
