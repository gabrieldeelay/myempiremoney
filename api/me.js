const { one, toIso } = require("../lib/db");
const { profileFrom, requireUser, sendError } = require("../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
  try {
    const { user, profile, db } = await requireUser(req);
    let currentProfile = profile;
    if (profile?.plan_id === "monthly" && profile?.access_granted && profile?.access_expires_at && new Date(profile.access_expires_at) <= new Date()) {
      await db.execute("UPDATE users SET access_granted = 0, access_status = 'expired', updated_at = UTC_TIMESTAMP() WHERE id = ?", [user.id]);
      currentProfile = profileFrom(await one("SELECT * FROM users WHERE id = ?", [user.id]));
    }
    const payment = await one("SELECT request_number,status,amount,expires_at,created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", [user.id]);
    if (payment) {
      payment.expires_at = toIso(payment.expires_at);
      payment.created_at = toIso(payment.created_at);
    }
    return res.status(200).json({ user, profile: currentProfile, payment: payment || null });
  } catch (error) {
    return sendError(res, error);
  }
};
