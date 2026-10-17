const { requireAdmin, sendError } = require("../lib/supabase-admin");
const { encryptJson } = require("../lib/crypto-store");
const { getPublicSettings, getVenoCredentials } = require("../lib/settings");

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
    const { supabase } = await requireAdmin(req);
    if (req.method === "GET") {
      const settings = await getPublicSettings(supabase);
      const veno = await getVenoCredentials(supabase).catch(() => null);
      const { data: coupons, error: couponError } = await supabase.from("coupons").select("*").order("created_at", { ascending: false });
      if (couponError) throw couponError;
      return res.status(200).json({ ...settings, coupons: coupons || [], venopag: { configured: Boolean(veno?.clientId && veno?.clientSecret && veno?.webhookSecret), clientIdHint: veno?.clientId ? `${veno.clientId.slice(0, 4)}••••` : "" } });
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
      const record = { code, type, value, max_uses: maxUses, valid_until: validUntil, active: req.body?.coupon?.active !== false, updated_at: new Date().toISOString() };
      const query = id ? supabase.from("coupons").update(record).eq("id", id) : supabase.from("coupons").insert(record);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return res.status(id ? 200 : 201).json({ coupon: data });
    }
    if (req.method === "DELETE") {
      const id = String(req.query?.id || req.body?.id || "");
      if (!id) return res.status(422).json({ error: "Cupom não informado." });
      const { error } = await supabase.from("coupons").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    if (req.method !== "PUT") return res.status(405).json({ error: "Método não permitido." });
    const plans = {
      monthly: cleanPlan(req.body?.plans?.monthly, "monthly"),
      lifetime: cleanPlan(req.body?.plans?.lifetime, "lifetime")
    };
    if (!plans.monthly.active && !plans.lifetime.active) return res.status(422).json({ error: "Mantenha pelo menos um plano ativo." });
    const content = {
      eyebrow: String(req.body?.content?.eyebrow || "").trim().slice(0, 80),
      headline: String(req.body?.content?.headline || "").trim().slice(0, 140),
      subheadline: String(req.body?.content?.subheadline || "").trim().slice(0, 420)
    };
    const symbols = cleanSymbols(req.body?.market?.symbols);
    if (!symbols.length) return res.status(422).json({ error: "Adicione ao menos um ativo terminado em USDT." });
    const market = { newsQuery: String(req.body?.market?.newsQuery || "").trim().slice(0, 240), symbols };
    for (const [key, value] of Object.entries({ pricing: { oldPrice: plans.lifetime.oldPrice, currentPrice: plans.lifetime.currentPrice }, plans, content, market })) {
      const { error } = await supabase.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    const venoInput = req.body?.venopag || {};
    if (venoInput.clientId || venoInput.clientSecret || venoInput.webhookSecret) {
      if (!venoInput.clientId || !venoInput.clientSecret || !venoInput.webhookSecret) return res.status(422).json({ error: "Preencha as três credenciais da Venopag." });
      const value = encryptJson({ clientId: String(venoInput.clientId).trim(), clientSecret: String(venoInput.clientSecret).trim(), webhookSecret: String(venoInput.webhookSecret).trim() });
      const { error } = await supabase.from("private_settings").upsert({ key: "venopag", value, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    return res.status(200).json({ ok: true, settings: await getPublicSettings(supabase) });
  } catch (error) {
    return sendError(res, error);
  }
};
