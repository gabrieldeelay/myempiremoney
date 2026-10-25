const { getDb, toIso } = require("../lib/db");
const { sendError } = require("../lib/auth");
const { ensureRobotSpeechSchema } = require("../lib/robot-speech-defaults");

function publicSpeech(row) {
  return {
    id: row.id,
    context: row.context_key,
    phrase: row.phrase,
    audioUrl: row.audio_path ? `/robot-audio/${encodeURIComponent(row.audio_path)}?v=${encodeURIComponent(toIso(row.updated_at) || "1")}` : null
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
    const db = getDb();
    await ensureRobotSpeechSchema(db);
    const [rows] = await db.query("SELECT id,context_key,phrase,audio_path,updated_at FROM robot_speeches WHERE active=1 ORDER BY context_key,created_at,id");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ speeches: rows.map(publicSpeech) });
  } catch (error) {
    return sendError(res, error);
  }
};
