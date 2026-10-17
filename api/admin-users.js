const { requireAdmin, sendError } = require("../lib/supabase-admin");

module.exports = async function handler(req, res) {
  try {
    const { supabase } = await requireAdmin(req);
    if (req.method === "GET") {
      const { data, error } = await supabase.from("profiles").select("id,email,name,phone,role,plan_id,access_granted,access_status,access_expires_at,created_at").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return res.status(200).json({ users: data });
    }
    if (req.method !== "PUT") return res.status(405).json({ error: "Método não permitido." });
    const id = String(req.body?.id || "");
    const access = Boolean(req.body?.access);
    const { data, error } = await supabase.from("profiles").update({ access_granted: access, access_status: access ? "active" : "blocked", updated_at: new Date().toISOString() }).eq("id", id).select("id,email,access_granted,access_status").single();
    if (error) throw error;
    return res.status(200).json({ user: data });
  } catch (error) {
    return sendError(res, error);
  }
};
