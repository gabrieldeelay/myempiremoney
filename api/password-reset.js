const crypto = require("node:crypto");
const { Resend } = require("resend");
const { getAdminClient } = require("../lib/supabase-admin");

const GENERIC = { ok: true, message: "Se esse e-mail estiver cadastrado, você receberá as instruções." };

async function requestReset(req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(200).json(GENERIC);
  const supabase = getAdminClient();
  const { data: profile } = await supabase.from("profiles").select("id,email").eq("email", email).maybeSingle();
  if (!profile) return res.status(200).json(GENERIC);
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host || "atlas-guard-trading.vercel.app"}`;
  if (!process.env.RESEND_API_KEY) {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/redefinir-senha` });
    return res.status(200).json(GENERIC);
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await supabase.from("password_reset_tokens").delete().eq("user_id", profile.id).is("used_at", null);
  const { error } = await supabase.from("password_reset_tokens").insert({ user_id: profile.id, token_hash: tokenHash, expires_at: new Date(Date.now() + 30 * 60000).toISOString() });
  if (error) throw error;
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "Atlas <onboarding@resend.dev>",
    to: email,
    subject: "Redefina sua senha do Atlas",
    html: `<div style="font-family:Arial,sans-serif;background:#061426;color:#f5f8ff;padding:32px"><h1>ATLAS</h1><p>Recebemos um pedido para redefinir sua senha.</p><p><a style="display:inline-block;background:#4f8cff;color:white;padding:14px 20px;border-radius:10px;text-decoration:none" href="${origin}/redefinir-senha?token=${encodeURIComponent(token)}">Criar nova senha</a></p><p>Este link expira em 30 minutos.</p></div>`
  });
  return res.status(200).json(GENERIC);
}

async function confirmReset(req, res) {
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
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  try {
    return req.body?.action === "confirm" ? await confirmReset(req, res) : await requestReset(req, res);
  } catch (error) {
    console.error(error);
    if (req.body?.action === "confirm") return res.status(500).json({ error: "Não foi possível redefinir a senha." });
    return res.status(200).json(GENERIC);
  }
};
