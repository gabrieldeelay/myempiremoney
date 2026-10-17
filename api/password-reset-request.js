const crypto = require("node:crypto");
const { Resend } = require("resend");
const { getAdminClient } = require("../lib/supabase-admin");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  const generic = { ok: true, message: "Se esse e-mail estiver cadastrado, você receberá as instruções." };
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(200).json(generic);
    const supabase = getAdminClient();
    const { data: profile } = await supabase.from("profiles").select("id,email").eq("email", email).maybeSingle();
    if (!profile) return res.status(200).json(generic);
    const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host || "atlas-guard-trading.vercel.app"}`;
    if (!process.env.RESEND_API_KEY) {
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/redefinir-senha` });
      return res.status(200).json(generic);
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await supabase.from("password_reset_tokens").delete().eq("user_id", profile.id).is("used_at", null);
    const { error: tokenError } = await supabase.from("password_reset_tokens").insert({ user_id: profile.id, token_hash: tokenHash, expires_at: new Date(Date.now() + 30 * 60000).toISOString() });
    if (tokenError) throw tokenError;
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "Atlas <onboarding@resend.dev>",
      to: email,
      subject: "Redefina sua senha do Atlas",
      html: `<div style="font-family:Arial,sans-serif;background:#061426;color:#f5f8ff;padding:32px"><h1>ATLAS</h1><p>Recebemos um pedido para redefinir sua senha.</p><p><a style="display:inline-block;background:#4f8cff;color:white;padding:14px 20px;border-radius:10px;text-decoration:none" href="${origin}/redefinir-senha?token=${encodeURIComponent(token)}">Criar nova senha</a></p><p>Este link expira em 30 minutos.</p></div>`
    });
    return res.status(200).json(generic);
  } catch (error) {
    console.error(error);
    return res.status(200).json(generic);
  }
};
