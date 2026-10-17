const { getAdminClient, requireUser, sendError } = require("../lib/supabase-admin");

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
      const supabase = getAdminClient();
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, phone }
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) return res.status(409).json({ error: "Este e-mail já possui uma conta." });
        throw error;
      }
      await supabase.from("profiles").update({ name, phone, updated_at: new Date().toISOString() }).eq("id", data.user.id);
      return res.status(201).json({ ok: true });
    } catch (error) {
      return sendError(res, error);
    }
  }
  if (req.method !== "PUT") return res.status(405).json({ error: "Método não permitido." });
  try {
    const { user, supabase } = await requireUser(req);
    const name = String(req.body?.name || "").trim().slice(0, 120);
    const document = digits(req.body?.document);
    if (name.length < 3) return res.status(422).json({ error: "Informe seu nome completo." });
    if (![11, 14].includes(document.length)) return res.status(422).json({ error: "Informe um CPF ou CNPJ válido." });
    const { data, error } = await supabase.from("profiles").update({ name, document, updated_at: new Date().toISOString() }).eq("id", user.id).select("*").single();
    if (error) throw error;
    return res.status(200).json({ profile: data });
  } catch (error) {
    return sendError(res, error);
  }
};
