const { decryptJson } = require("./crypto-store");
const { CLOUD_PLANS } = require("./cloud-plans");

const DEFAULTS = {
  pricing: { oldPrice: 49.90, currentPrice: 19.90 },
  plans: CLOUD_PLANS,
  content: {
    eyebrow: "SEU ASSISTENTE DE OPERAÇÃO",
    headline: "Operar no escuro, não dá certo.",
    subheadline: "O Atlas lê o contexto, organiza as informações e fica ao seu lado antes de cada decisão. Você continua no controle e não precisa decidir no escuro."
  },
  market: {
    newsQuery: "(bitcoin OR ethereum OR criptomoedas OR mercado OR inflação OR juros OR \"banco central\")",
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "ADAUSDT", "DOGEUSDT", "LTCUSDT", "AVAXUSDT"]
  }
};

const { getDb, parseJson } = require("./db");

async function getPublicSettings(db = getDb()) {
  const [data] = await db.execute("SELECT `key`, `value` FROM app_settings WHERE `key` IN ('pricing','plans','content','market')");
  const result = structuredClone(DEFAULTS);
  for (const item of data || []) {
    const value = parseJson(item.value, {});
    if (item.key === "plans") {
      result.plans = Object.fromEntries(Object.entries(CLOUD_PLANS).map(([id, plan]) => [id, { ...plan, ...(value?.[id] || {}) }]));
    } else result[item.key] = { ...result[item.key], ...(value || {}) };
  }
  return result;
}

async function getVenoCredentials(db = getDb()) {
  const [data] = await db.execute("SELECT `value`, updated_at FROM private_settings WHERE `key` = 'venopag' LIMIT 1");
  return data[0]?.value ? { ...decryptJson(data[0].value), updatedAt: data[0].updated_at } : null;
}

module.exports = { DEFAULTS, getPublicSettings, getVenoCredentials };
