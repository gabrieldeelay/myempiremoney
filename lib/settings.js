const { decryptJson } = require("./crypto-store");

const DEFAULTS = {
  pricing: { oldPrice: 1499, currentPrice: 499.90 },
  plans: {
    monthly: {
      id: "monthly",
      label: "Acesso Atlas",
      billing: "Acesso completo ao Atlas",
      oldPrice: 1499,
      currentPrice: 499.90,
      active: true,
      benefits: ["Radar de notícias e tendências", "Assistente durante as operações", "Atualizações incluídas"]
    },
    lifetime: {
      id: "lifetime",
      label: "Acesso descontinuado",
      billing: "",
      oldPrice: 1499,
      currentPrice: 499.90,
      active: false,
      benefits: []
    }
  },
  content: {
    eyebrow: "SEU ASSISTENTE DE OPERAÇÃO",
    headline: "Operar no escuro, não dá certo.",
    subheadline: "O Atlas lê o contexto, organiza as informações e fica ao seu lado antes de cada decisão. Você continua no controle e não precisa decidir no escuro."
  },
  market: {
    newsQuery: "(bitcoin OR ethereum OR \"central bank\" OR inflation OR markets)",
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "ADAUSDT", "DOGEUSDT", "LTCUSDT", "AVAXUSDT"]
  }
};

async function getPublicSettings(supabase) {
  const { data } = await supabase.from("app_settings").select("key,value").in("key", ["pricing", "plans", "content", "market"]);
  const result = structuredClone(DEFAULTS);
  for (const item of data || []) {
    if (item.key === "plans") {
      result.plans = {
        monthly: { ...result.plans.monthly, ...(item.value?.monthly || {}) },
        lifetime: { ...result.plans.lifetime, ...(item.value?.lifetime || {}) }
      };
    } else result[item.key] = { ...result[item.key], ...(item.value || {}) };
  }
  return result;
}

async function getVenoCredentials(supabase) {
  const { data } = await supabase.from("private_settings").select("value,updated_at").eq("key", "venopag").maybeSingle();
  return data?.value ? { ...decryptJson(data.value), updatedAt: data.updated_at } : null;
}

module.exports = { DEFAULTS, getPublicSettings, getVenoCredentials };
