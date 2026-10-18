const crypto = require("node:crypto");
const { Resend } = require("resend");
const { getDb, one } = require("../lib/db");
const { hashPassword } = require("../lib/auth");

const GENERIC = { ok: true, message: "Se esse e-mail estiver cadastrado, você receberá as instruções." };

async function requestReset(req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(200).json(GENERIC);
  const db = getDb();
  const profile = await one("SELECT id,email FROM users WHERE email=? LIMIT 1", [email]);
  if (!profile) return res.status(200).json(GENERIC);
  if (!process.env.RESEND_API_KEY) return res.status(200).json(GENERIC);
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host || "nossoatlas.com"}`;
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await db.execute("DELETE FROM password_reset_tokens WHERE user_id=? AND used_at IS NULL", [profile.id]);
  await db.execute("INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP())", [crypto.randomUUID(), profile.id, tokenHash, new Date(Date.now() + 30 * 60000)]);
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
  const db = getDb();
  const record = await one("SELECT id,user_id,expires_at,used_at FROM password_reset_tokens WHERE token_hash=? LIMIT 1", [tokenHash]);
  if (!record || record.used_at || new Date(record.expires_at) < new Date()) return res.status(422).json({ error: "Este link é inválido ou expirou." });
  await db.execute("UPDATE users SET password_hash=?,updated_at=UTC_TIMESTAMP() WHERE id=?", [await hashPassword(password), record.user_id]);
  await db.execute("UPDATE password_reset_tokens SET used_at=UTC_TIMESTAMP() WHERE id=?", [record.id]);
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
