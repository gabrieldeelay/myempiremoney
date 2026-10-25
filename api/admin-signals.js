const { requireAdmin, sendError } = require("../lib/auth");
const { createManualSignal, ensureManualSignalsSchema, invalidateManualSignalCache, signalPayload } = require("../lib/manual-signals");

module.exports = async function handler(req, res) {
  try {
    const { db, profile } = await requireAdmin(req);
    await ensureManualSignalsSchema(db);
    await db.execute("UPDATE manual_signals SET status='expired' WHERE status='active' AND expires_at<=UTC_TIMESTAMP(3)");
    if (req.method === "GET") {
      const [rows] = await db.query("SELECT * FROM manual_signals ORDER BY created_at DESC LIMIT 60");
      return res.status(200).json({ signals: rows.map(signalPayload) });
    }
    if (req.method === "POST") {
      const signal = await createManualSignal(db, req.body || {}, profile.id);
      return res.status(201).json({ signal });
    }
    if (req.method === "DELETE") {
      const id = String(req.query?.id || "").trim();
      if (!id) return res.status(422).json({ error: "Sinal não informado." });
      await db.execute("UPDATE manual_signals SET status='cancelled',updated_at=UTC_TIMESTAMP(3) WHERE id=?", [id]);
      invalidateManualSignalCache();
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Método não permitido." });
  } catch (error) { return sendError(res, error); }
};
