const { getAdminClient } = require("../lib/supabase-admin");
const { getPublicSettings } = require("../lib/settings");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  try {
    const settings = await getPublicSettings(getAdminClient());
    const activePlans = Object.fromEntries(Object.entries(settings.plans || {}).filter(([, plan]) => plan.active !== false));
    return res.status(200).json({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
      ...settings,
      plans: activePlans
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Configuração temporariamente indisponível." });
  }
};
