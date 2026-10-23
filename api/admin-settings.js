const crypto = require("node:crypto");
const { requireAdmin, sendError } = require("../lib/auth");
const { one, toIso } = require("../lib/db");
const { encryptJson } = require("../lib/crypto-store");
const { getPublicSettings, getSpeechCredentials, getVenoCredentials } = require("../lib/settings");

function cleanSymbols(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value).toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(value => value.endsWith("USDT")))].slice(0, 20);
}

function cleanPlan(input, fallbackId) {
  const oldPrice = Number(input?.oldPrice);
  const currentPrice = Number(input?.currentPrice);
  if (!(oldPrice > 0) || !(currentPrice > 0) || currentPrice > oldPrice) {
    const error = new Error(`Revise os preços do plano ${fallbackId}.`);
    error.status = 422;
    throw error;
  }
  return {
    id: fallbackId,
    label: String(input?.label || "").trim().slice(0, 60),
    billing: String(input?.billing || "").trim().slice(0, 90),
    oldPrice,
    currentPrice,
    active: input?.active !== false,
    benefits: (Array.isArray(input?.benefits) ? input.benefits : String(input?.benefits || "").split("\n")).map(value => String(value).trim()).filter(Boolean).slice(0, 6)
  };
}

module.exports = async function handler(req, res) {
  try {
    const { db } = await requireAdmin(req);
    if (req.method === "GET") {
      const settings = await getPublicSettings(db);
      const veno = await getVenoCredentials(db).catch(() => null);
      const speech = await getSpeechCredentials(db).catch(() => null);
      const [coupons] = await db.query("SELECT * FROM coupons ORDER BY created_at DESC");
      coupons.forEach(coupon => { coupon.active = Boolean(coupon.active); coupon.valid_from = toIso(coupon.valid_from); coupon.valid_until = toIso(coupon.valid_until); coupon.created_at = toIso(coupon.created_at); coupon.updated_at = toIso(coupon.updated_at); });
      return res.status(200).json({ ...settings, coupons: coupons || [], venopag: { configured: Boolean(veno?.clientId && veno?.clientSecret && veno?.webhookSecret), clientId: veno?.clientId || "", clientSecret: veno?.clientSecret || "", webhookSecret: veno?.webhookSecret || "", updatedAt: veno?.updatedAt || null }, speech: { configured: Boolean(speech?.apiKey && speech?.region), apiKey: speech?.apiKey || "", region: speech?.region || "brazilsouth", voice: "pt-BR-AntonioNeural", updatedAt: speech?.updatedAt || null } });
    }
    if (req.method === "POST" && req.body?.action === "coupon") {
      const id = String(req.body?.coupon?.id || "").trim();
      const code = String(req.body?.coupon?.code || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
      const type = req.body?.coupon?.type === "fixed" ? "fixed" : "percent";
      const value = Number(req.body?.coupon?.value);
      const parsedMaxUses = req.body?.coupon?.maxUses ? Number.parseInt(req.body.coupon.maxUses, 10) : null;
      const maxUses = Number.isFinite(parsedMaxUses) ? Math.max(1, parsedMaxUses) : null;
      const parsedValidUntil = req.body?.coupon?.validUntil ? new Date(req.body.coupon.validUntil) : null;
      const validUntil = parsedValidUntil && Number.isFinite(parsedValidUntil.getTime()) ? parsedValidUntil.toISOString() : null;
      if (code.length < 3 || !(value > 0) || (type === "percent" && value > 100)) return res.status(422).json({ error: "Revise o código e o desconto do cupom." });
      const active = req.body?.coupon?.active !== false ? 1 : 0;
      const couponId = id || crypto.randomUUID();
      if (id) await db.execute("UPDATE coupons SET code=?,type=?,value=?,max_uses=?,valid_until=?,active=?,updated_at=UTC_TIMESTAMP() WHERE id=?", [code, type, value, maxUses, validUntil ? new Date(validUntil) : null, active, id]);
      else await db.execute("INSERT INTO coupons (id,code,type,value,max_uses,valid_until,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())", [couponId, code, type, value, maxUses, validUntil ? new Date(validUntil) : null, active]);
      const data = await one("SELECT * FROM coupons WHERE id=?", [couponId]);
      data.active = Boolean(data.active);
      return res.status(id ? 200 : 201).json({ coupon: data });
    }
    if (req.method === "DELETE") {
      const id = String(req.query?.id || req.body?.id || "");
      if (!id) return res.status(422).json({ error: "Cupom não informado." });
      await db.execute("DELETE FROM coupons WHERE id = ?", [id]);
      return res.status(200).json({ ok: true });
    }
    if (req.method !== "PUT") return res.status(405).json({ error: "Método não permitido." });
    const monthly = cleanPlan(req.body?.plans?.monthly, "monthly");
    monthly.active = true;
    const plans = {
      monthly,
      lifetime: { id: "lifetime", label: "Acesso descontinuado", billing: "", oldPrice: monthly.oldPrice, currentPrice: monthly.currentPrice, active: false, benefits: [] }
    };
    const content = {
      eyebrow: String(req.body?.content?.eyebrow || "").trim().slice(0, 80),
      headline: String(req.body?.content?.headline || "").trim().slice(0, 140),
      subheadline: String(req.body?.content?.subheadline || "").trim().slice(0, 420)
    };
    const symbols = cleanSymbols(req.body?.market?.symbols);
    if (!symbols.length) return res.status(422).json({ error: "Adicione ao menos um ativo terminado em USDT." });
    const market = { newsQuery: String(req.body?.market?.newsQuery || "").trim().slice(0, 240), symbols };
    for (const [key, value] of Object.entries({ pricing: { oldPrice: monthly.oldPrice, currentPrice: monthly.currentPrice }, plans, content, market })) {
      await db.execute("INSERT INTO app_settings (`key`,`value`,updated_at) VALUES (?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`),updated_at=UTC_TIMESTAMP()", [key, JSON.stringify(value)]);
    }
    const venoInput = req.body?.venopag || {};
    if (venoInput.clientId || venoInput.clientSecret || venoInput.webhookSecret) {
      if (!venoInput.clientId || !venoInput.clientSecret || !venoInput.webhookSecret) return res.status(422).json({ error: "Preencha as três credenciais da Venopag." });
      const value = encryptJson({ clientId: String(venoInput.clientId).trim(), clientSecret: String(venoInput.clientSecret).trim(), webhookSecret: String(venoInput.webhookSecret).trim() });
      await db.execute("INSERT INTO private_settings (`key`,`value`,updated_at) VALUES ('venopag',?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`),updated_at=UTC_TIMESTAMP()", [value]);
    }
    const speechInput = req.body?.speech || {};
    if (speechInput.apiKey || speechInput.region) {
      if (!speechInput.apiKey || !speechInput.region) return res.status(422).json({ error: "Preencha a chave e a região do Azure Speech." });
      const region = String(speechInput.region).trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
      const value = encryptJson({ apiKey: String(speechInput.apiKey).trim(), region });
      await db.execute("INSERT INTO private_settings (`key`,`value`,updated_at) VALUES ('speech',?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`),updated_at=UTC_TIMESTAMP()", [value]);
    }
    return res.status(200).json({ ok: true, settings: await getPublicSettings(db) });
  } catch (error) {
    return sendError(res, error);
  }
};
