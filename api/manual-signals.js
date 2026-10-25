const { sendError } = require("../lib/auth");
const { getDb } = require("../lib/db");
const { ensureManualSignalsSchema, getActiveManualSignal, normalizeSignalAsset } = require("../lib/manual-signals");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
    const db = getDb();
    await ensureManualSignalsSchema(db);
    const asset = normalizeSignalAsset(req.query?.asset);
    if (!asset) return res.status(200).json({ signal: null });
    res.set("Cache-Control", "no-store, max-age=0");
    return res.status(200).json({ signal: await getActiveManualSignal(db, asset) });
  } catch (error) { return sendError(res, error); }
};
