const { requireUser, sendError } = require("../lib/supabase-admin");

function digits(value) { return String(value || "").replace(/\D/g, ""); }

module.exports = async function handler(req, res) {
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
