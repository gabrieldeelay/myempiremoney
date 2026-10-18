const { one, toIso } = require("../lib/db");
const { hashPassword, profileFrom, requireAdmin, sendError } = require("../lib/auth");

function normalizeDates(record) {
  if (!record) return record;
  for (const key of ["created_at", "updated_at", "expires_at", "access_expires_at"]) {
    if (record[key]) record[key] = toIso(record[key]);
  }
  if ("access_granted" in record) record.access_granted = Boolean(record.access_granted);
  return record;
}

module.exports = async function handler(req, res) {
  try {
    const { db } = await requireAdmin(req);
    if (req.method === "GET") {
      if (String(req.query?.view || "") === "payments") {
        const [[payments], [accounts]] = await Promise.all([
          db.query(`SELECT p.id,p.user_id,p.request_number,p.transaction_id,p.amount,p.original_amount,p.discount_amount,p.status,p.created_at,p.updated_at,p.expires_at,
            u.email AS customer_email,u.name AS customer_name,u.phone AS customer_phone,u.access_status AS customer_access_status,u.access_expires_at AS customer_access_expires_at
            FROM payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 500`),
          db.query("SELECT id,email,name,phone,created_at,access_status,access_expires_at FROM users WHERE role <> 'admin' ORDER BY created_at DESC LIMIT 500")
        ]);
        const enriched = payments.map(payment => {
          normalizeDates(payment);
          const customer = payment.customer_email ? { id: payment.user_id, email: payment.customer_email, name: payment.customer_name, phone: payment.customer_phone, access_status: payment.customer_access_status, access_expires_at: toIso(payment.customer_access_expires_at) } : null;
          for (const key of ["customer_email", "customer_name", "customer_phone", "customer_access_status", "customer_access_expires_at"]) delete payment[key];
          return { ...payment, customer };
        });
        accounts.forEach(normalizeDates);
        const stats = {
          attempts: enriched.length,
          confirmed: enriched.filter(item => ["confirmed", "paid", "approved"].includes(String(item.status).toLowerCase())).length,
          pending: enriched.filter(item => String(item.status).toLowerCase() === "pending").length,
          accounts: accounts.length
        };
        return res.status(200).json({ payments: enriched, accounts, stats });
      }
      const [users] = await db.query("SELECT id,email,name,phone,role,plan_id,access_granted,access_status,access_expires_at,created_at,updated_at FROM users ORDER BY created_at DESC LIMIT 1000");
      users.forEach(normalizeDates);
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
      return res.status(200).json({
        users: filtered.slice(0, 250),
        total: filtered.length,
        stats: {
          total: customerUsers.length,
          active: customerUsers.filter(user => user.access_granted && user.access_status === "active").length,
          pending: customerUsers.filter(user => !user.access_granted && user.access_status !== "blocked").length,
          blocked: customerUsers.filter(user => user.access_status === "blocked").length
        }
      });
    }
    if (req.method !== "PUT") return res.status(405).json({ error: "Método não permitido." });
    const id = String(req.body?.id || "");
    if (!id) return res.status(422).json({ error: "Cliente não informado." });
    if (req.body?.action === "reset_password") {
      const password = String(req.body?.password || "");
      if (password.length < 8) return res.status(422).json({ error: "A nova senha precisa ter pelo menos 8 caracteres." });
      await db.execute("UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [await hashPassword(password), id]);
      return res.status(200).json({ ok: true });
    }
    const access = Boolean(req.body?.access);
    await db.execute(
      `UPDATE users SET access_granted = ?, access_status = ?, access_expires_at = IF(?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY), access_expires_at), updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      [access ? 1 : 0, access ? "active" : "blocked", access ? 1 : 0, id]
    );
    const user = profileFrom(await one("SELECT * FROM users WHERE id = ?", [id]));
    return res.status(200).json({ user });
  } catch (error) {
    return sendError(res, error);
  }
};
