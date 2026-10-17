const { requireAdmin, sendError } = require("../lib/supabase-admin");

module.exports = async function handler(req, res) {
  try {
    const { supabase } = await requireAdmin(req);
    if (req.method === "GET") {
      if (String(req.query?.view || "") === "payments") {
        const [{ data: payments, error: paymentError }, { data: profiles, error: profileError }] = await Promise.all([
          supabase.from("payments").select("id,user_id,request_number,transaction_id,amount,original_amount,discount_amount,status,created_at,updated_at,expires_at").order("created_at", { ascending: false }).limit(500),
          supabase.from("profiles").select("id,email,name,phone,created_at,access_status,access_expires_at").neq("role", "admin").order("created_at", { ascending: false }).limit(500)
        ]);
        if (paymentError) throw paymentError;
        if (profileError) throw profileError;
        const profileMap = new Map((profiles || []).map(profile => [profile.id, profile]));
        const enriched = (payments || []).map(payment => ({ ...payment, customer: profileMap.get(payment.user_id) || null }));
        const stats = {
          attempts: enriched.length,
          confirmed: enriched.filter(item => ["confirmed", "paid", "approved"].includes(String(item.status).toLowerCase())).length,
          pending: enriched.filter(item => String(item.status).toLowerCase() === "pending").length,
          accounts: (profiles || []).length
        };
        return res.status(200).json({ payments: enriched, accounts: profiles || [], stats });
      }
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
    if (!id) return res.status(422).json({ error: "Cliente não informado." });
    if (req.body?.action === "reset_password") {
      const password = String(req.body?.password || "");
      if (password.length < 8) return res.status(422).json({ error: "A nova senha precisa ter pelo menos 8 caracteres." });
      const { error: passwordError } = await supabase.auth.admin.updateUserById(id, { password });
      if (passwordError) throw passwordError;
      await supabase.from("profiles").update({ updated_at: new Date().toISOString() }).eq("id", id);
      return res.status(200).json({ ok: true });
    }
    const access = Boolean(req.body?.access);
    const update = { access_granted: access, access_status: access ? "active" : "blocked", updated_at: new Date().toISOString() };
    if (access) update.access_expires_at = new Date(Date.now() + 30 * 86400000).toISOString();
    const { data, error } = await supabase.from("profiles").update(update).eq("id", id).select("id,email,access_granted,access_status,access_expires_at").single();
    if (error) throw error;
    return res.status(200).json({ user: data });
  } catch (error) {
    return sendError(res, error);
  }
};
