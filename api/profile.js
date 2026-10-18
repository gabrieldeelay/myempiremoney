const crypto = require("node:crypto");
const { getDb, one } = require("../lib/db");
const { hashPassword, profileFrom, requireUser, sendError } = require("../lib/auth");

function digits(value) { return String(value || "").replace(/\D/g, ""); }

module.exports = async function handler(req, res) {
  if (req.method === "POST" && req.body?.action === "signup") {
    try {
      const name = String(req.body?.name || "").trim();
      const email = String(req.body?.email || "").trim().toLowerCase();
      const phone = digits(req.body?.phone);
      const password = String(req.body?.password || "");
      const passwordConfirmation = String(req.body?.passwordConfirmation || "");
      if (!/^[\p{L}][\p{L}'-]{1,39}$/u.test(name)) return res.status(422).json({ error: "Informe somente seu primeiro nome." });
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(422).json({ error: "Informe um e-mail válido." });
      if (![10, 11].includes(phone.length)) return res.status(422).json({ error: "Informe um telefone com DDD." });
      if (password.length < 8) return res.status(422).json({ error: "A senha precisa ter ao menos 8 caracteres." });
      if (password !== passwordConfirmation) return res.status(422).json({ error: "As senhas não são iguais." });
      const db = getDb();
      if (await one("SELECT id FROM users WHERE email = ? LIMIT 1", [email])) return res.status(409).json({ error: "Este e-mail já possui uma conta." });
      const id = crypto.randomUUID();
      await db.execute(
        `INSERT INTO users (id,email,password_hash,name,phone,role,access_granted,access_status,created_at,updated_at)
         VALUES (?,?,?,?,?,'user',0,'pending',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
        [id, email, await hashPassword(password), name, phone]
      );
      return res.status(201).json({ ok: true });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Este e-mail já possui uma conta." });
      return sendError(res, error);
    }
  }
  if (req.method !== "PUT") return res.status(405).json({ error: "Método não permitido." });
  try {
    const { user, db } = await requireUser(req);
    const name = String(req.body?.name || "").trim().slice(0, 120);
    const document = digits(req.body?.document);
    if (name.length < 3) return res.status(422).json({ error: "Informe seu nome completo." });
    if (![11, 14].includes(document.length)) return res.status(422).json({ error: "Informe um CPF ou CNPJ válido." });
    await db.execute("UPDATE users SET name = ?, document = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [name, document, user.id]);
    return res.status(200).json({ profile: profileFrom(await one("SELECT * FROM users WHERE id = ?", [user.id])) });
  } catch (error) {
    return sendError(res, error);
  }
};
