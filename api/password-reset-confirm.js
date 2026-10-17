const crypto = require("node:crypto");
const { getAdminClient } = require("../lib/supabase-admin");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  try {
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    if (password.length < 8) return res.status(422).json({ error: "A senha precisa ter ao menos 8 caracteres." });
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const supabase = getAdminClient();
    const { data: record } = await supabase.from("password_reset_tokens").select("id,user_id,expires_at,used_at").eq("token_hash", tokenHash).maybeSingle();
    if (!record || record.used_at || new Date(record.expires_at) < new Date()) return res.status(422).json({ error: "Este link é inválido ou expirou." });
    const { error } = await supabase.auth.admin.updateUserById(record.user_id, { password });
    if (error) throw error;
    await supabase.from("password_reset_tokens").update({ used_at: new Date().toISOString() }).eq("id", record.id);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Não foi possível redefinir a senha." });
  }
};
