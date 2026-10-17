const { requireUser, sendError } = require("../lib/supabase-admin");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
  try {
    const { user, profile, supabase } = await requireUser(req);
    const { data: payment } = await supabase.from("payments").select("request_number,status,amount,expires_at,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return res.status(200).json({
      user: { id: user.id, email: user.email },
      profile: profile || { email: user.email, role: "user", access_granted: false, access_status: "pending" },
      payment: payment || null
    });
  } catch (error) {
    return sendError(res, error);
  }
};
