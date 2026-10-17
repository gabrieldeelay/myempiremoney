const { requireAdmin, sendError } = require("../lib/supabase-admin");
const { encryptJson } = require("../lib/crypto-store");
const { getPublicSettings, getVenoCredentials } = require("../lib/settings");

function cleanSymbols(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value).toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(value => value.endsWith("USDT")))].slice(0, 20);
}

module.exports = async function handler(req, res) {
  try {
    const { supabase } = await requireAdmin(req);
    if (req.method === "GET") {
      const settings = await getPublicSettings(supabase);
      const veno = await getVenoCredentials(supabase).catch(() => null);
      return res.status(200).json({ ...settings, venopag: { configured: Boolean(veno?.clientId && veno?.clientSecret && veno?.webhookSecret), clientIdHint: veno?.clientId ? `${veno.clientId.slice(0, 4)}••••` : "" } });
    }
    if (req.method !== "PUT") return res.status(405).json({ error: "Método não permitido." });
    const oldPrice = Number(req.body?.pricing?.oldPrice);
    const currentPrice = Number(req.body?.pricing?.currentPrice);
    if (!(oldPrice > 0) || !(currentPrice > 0)) return res.status(422).json({ error: "Os preços precisam ser maiores que zero." });
    const content = {
      eyebrow: String(req.body?.content?.eyebrow || "").trim().slice(0, 80),
      headline: String(req.body?.content?.headline || "").trim().slice(0, 140),
      subheadline: String(req.body?.content?.subheadline || "").trim().slice(0, 420)
    };
    const symbols = cleanSymbols(req.body?.market?.symbols);
    if (!symbols.length) return res.status(422).json({ error: "Adicione ao menos um ativo terminado em USDT." });
    const market = { newsQuery: String(req.body?.market?.newsQuery || "").trim().slice(0, 240), symbols };
    for (const [key, value] of Object.entries({ pricing: { oldPrice, currentPrice }, content, market })) {
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
