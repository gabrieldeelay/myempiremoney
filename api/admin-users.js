const { requireAdmin, sendError } = require("../lib/supabase-admin");

module.exports = async function handler(req, res) {
  try {
    const { supabase } = await requireAdmin(req);
    if (req.method === "GET") {
      const { data, error } = await supabase.from("profiles").select("id,email,name,phone,role,plan_id,access_granted,access_status,access_expires_at,created_at").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      const users = data || [];
      const normalized = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const q = normalized(req.query?.q).trim();
      const status = String(req.query?.status || "all").toLowerCase();
      const plan = String(req.query?.plan || "all").toLowerCase();
      const filtered = users.filter(user => {
        if (user.role === "admin") return false;
        const matchesSearch = !q || [user.name, user.email, user.phone].some(value => normalized(value).includes(q));
        const matchesStatus = status === "all" || String(user.access_status || "pending").toLowerCase() === status;
        const matchesPlan = plan === "all" || (plan === "none" ? !user.plan_id : String(user.plan_id || "").toLowerCase() === plan);
        return matchesSearch && matchesStatus && matchesPlan;
      });
      const customerUsers = users.filter(user => user.role !== "admin");
      const stats = {
        total: customerUsers.length,
        active: customerUsers.filter(user => user.access_granted && user.access_status === "active").length,
        pending: customerUsers.filter(user => !user.access_granted && user.access_status !== "blocked").length,
        blocked: customerUsers.filter(user => user.access_status === "blocked").length
      };
      return res.status(200).json({ users: filtered.slice(0, 250), total: filtered.length, stats });
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

