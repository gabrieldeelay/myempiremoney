const { authenticate, bearerToken, destroySession, hashPassword, requireUser, sendError } = require("../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  try {
    const action = String(req.body?.action || "login");
    if (action === "login") {
      const result = await authenticate(req.body?.email || req.body?.identity, req.body?.password);
      return res.status(200).json(result);
    }
    if (action === "logout") {
      await destroySession(bearerToken(req));
      return res.status(200).json({ ok: true });
    }
    if (action === "change_password") {
      const { user, db } = await requireUser(req);
      const password = String(req.body?.password || "");
      if (password.length < 8) return res.status(422).json({ error: "A nova senha precisa ter pelo menos 8 caracteres." });
      await db.execute("UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [await hashPassword(password), user.id]);
      return res.status(200).json({ ok: true });
    }
    return res.status(422).json({ error: "Ação de autenticação inválida." });
  } catch (error) {
    return sendError(res, error);
  }
};
