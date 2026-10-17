const { decryptJson } = require("./crypto-store");

const DEFAULTS = {
  pricing: { oldPrice: 1499, currentPrice: 499.90 },
  content: {
    eyebrow: "SEU ASSISTENTE DE OPERAÇÃO",
    headline: "Operar sozinho é uma burrice cara.",
    subheadline: "O Atlas lê o contexto, organiza as informações e fica ao seu lado antes de cada decisão. Você continua no controle — só não precisa decidir no escuro."
  },
  market: {
    newsQuery: "(bitcoin OR ethereum OR \"central bank\" OR inflation OR markets)",
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "ADAUSDT", "DOGEUSDT", "LTCUSDT", "AVAXUSDT"]
  }
};

async function getPublicSettings(supabase) {
  const { data } = await supabase.from("app_settings").select("key,value").in("key", ["pricing", "content", "market"]);
  const result = structuredClone(DEFAULTS);
  for (const item of data || []) result[item.key] = { ...result[item.key], ...(item.value || {}) };
  return result;
}

async function getVenoCredentials(supabase) {
  const { data } = await supabase.from("private_settings").select("value").eq("key", "venopag").maybeSingle();
  return data?.value ? decryptJson(data.value) : null;
}

module.exports = { DEFAULTS, getPublicSettings, getVenoCredentials };
