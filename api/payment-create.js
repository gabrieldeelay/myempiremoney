const crypto = require("node:crypto");
const { requireUser, sendError } = require("../lib/supabase-admin");
const { getPublicSettings, getVenoCredentials } = require("../lib/settings");

function digits(value) { return String(value || "").replace(/\D/g, ""); }

async function buildQuote(supabase, settings, planId, couponCode) {
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
    const { data } = await supabase.from("coupons").select("*").eq("code", code).eq("active", true).maybeSingle();
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
    const { user, profile, supabase } = await requireUser(req);
    if (profile?.access_granted) return res.status(200).json({ accessGranted: true });
    const settings = await getPublicSettings(supabase);
    const planId = req.body?.planId === "monthly" ? "monthly" : "lifetime";
    const quote = await buildQuote(supabase, settings, planId, req.body?.couponCode);
    if (req.body?.action === "quote") return res.status(200).json({ quote: { ...quote, coupon: quote.coupon ? { code: quote.coupon.code } : null } });
    const credentials = await getVenoCredentials(supabase);
    if (!credentials) return res.status(503).json({ error: "O pagamento ainda não foi ativado pelo administrador." });
    const name = String(req.body?.name || profile?.name || "").trim();
    const document = digits(req.body?.document || profile?.document);
    if (name.length < 3 || ![11, 14].includes(document.length)) return res.status(422).json({ error: "Informe nome completo e CPF/CNPJ para gerar o PIX." });
    const amount = quote.amount;
    const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host || "atlas-guard-trading.vercel.app"}`;
    const response = await fetch("https://venopagments.com/api/cashin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": credentials.clientId,
        "X-Client-Secret": credentials.clientSecret,
        "Idempotency-Key": `atlas-${user.id}-${crypto.randomUUID()}`
      },
      body: JSON.stringify({ amount, name, document, description: `${quote.plan.label} Atlas`, webhook_url: `${origin}/api/venopag-webhook` })
    });
    const payload = await response.json().catch(() => ({ ok: false, error: "Resposta inválida da Venopag." }));
    if (!payload.ok) return res.status(response.status === 429 ? 429 : 422).json({ error: payload.error || "Não foi possível gerar o PIX." });
    const expiresAt = new Date(Date.now() + Number(payload.expire_minutes || 30) * 60000).toISOString();
    const { error } = await supabase.from("payments").upsert({
      user_id: user.id,
      request_number: payload.request_number,
      transaction_id: payload.transaction_id || "",
      amount,
      original_amount: quote.originalPrice,
      discount_amount: quote.couponDiscount,
      plan_id: planId,
      coupon_id: quote.coupon?.id || null,
      status: payload.status || "pending",
      pix_code: payload.copyPaste || "",
      qr_url: payload.qr_url || "",
      expires_at: expiresAt,
      raw: payload,
      updated_at: new Date().toISOString()
    }, { onConflict: "request_number" });
    if (error) throw error;
    await supabase.from("profiles").update({ name, document, access_status: "pending", updated_at: new Date().toISOString() }).eq("id", user.id);
    return res.status(200).json({ quote: { ...quote, coupon: quote.coupon ? { code: quote.coupon.code } : null }, payment: { requestNumber: payload.request_number, amount, status: payload.status, pixCode: payload.copyPaste, qrUrl: payload.qr_url, qrImage: payload.qr_img ? `data:image/png;base64,${payload.qr_img}` : "", expiresAt } });
  } catch (error) {
    return sendError(res, error);
  }
};
