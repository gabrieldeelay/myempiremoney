const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { requireAdmin, sendError } = require("../lib/auth");
const { one, toIso } = require("../lib/db");
const { ensureRobotSpeechSchema } = require("../lib/robot-speech-defaults");

const audioRoot = path.join(__dirname, "..", "storage", "robot-audio");
const audioTypes = new Map([
  ["audio/mpeg", "mp3"], ["audio/mp3", "mp3"], ["audio/wav", "wav"], ["audio/x-wav", "wav"],
  ["audio/ogg", "ogg"], ["audio/mp4", "m4a"], ["audio/x-m4a", "m4a"]
]);

function cleanContext(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
}

function speechPayload(row) {
  return {
    id: row.id,
    context: row.context_key,
    contextDescription: row.context_description,
    phrase: row.phrase,
    audioUrl: row.audio_path ? `/robot-audio/${encodeURIComponent(row.audio_path)}?v=${encodeURIComponent(toIso(row.updated_at) || "1")}` : null,
    audioMime: row.audio_mime || null,
    active: Boolean(row.active),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function readSpeech(db, id) {
  const row = await one("SELECT * FROM robot_speeches WHERE id=? LIMIT 1", [id]);
  return row ? speechPayload(row) : null;
}

async function uploadAudio(req, res, db) {
  const id = String(req.query?.id || "").trim();
  if (!id) return res.status(422).json({ error: "Fala não informada." });
  const existing = await one("SELECT * FROM robot_speeches WHERE id=? LIMIT 1", [id]);
  if (!existing) return res.status(404).json({ error: "Fala não encontrada." });
  const contentType = String(req.headers["content-type"] || "").split(";")[0].toLowerCase();
  const extension = audioTypes.get(contentType);
  if (!extension || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(422).json({ error: "Envie um áudio MP3, WAV, OGG ou M4A válido." });
  fs.mkdirSync(audioRoot, { recursive: true });
  if (existing.audio_path) {
    const oldFile = path.join(audioRoot, path.basename(existing.audio_path));
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
  }
  const filename = `${id}.${extension}`;
  fs.writeFileSync(path.join(audioRoot, filename), req.body);
  await db.execute("UPDATE robot_speeches SET audio_path=?,audio_mime=?,updated_at=UTC_TIMESTAMP() WHERE id=?", [filename, contentType, id]);
  return res.status(200).json({ speech: await readSpeech(db, id) });
}

module.exports = async function handler(req, res) {
  try {
    const { db } = await requireAdmin(req);
    await ensureRobotSpeechSchema(db);
    if (req.path.endsWith("/audio") && req.method === "PUT") return uploadAudio(req, res, db);
    if (req.method === "GET") {
      const [rows] = await db.query("SELECT * FROM robot_speeches ORDER BY context_key,created_at,id");
      return res.status(200).json({ speeches: rows.map(speechPayload) });
    }
    if (req.method === "POST") {
      const context = cleanContext(req.body?.context);
      const contextDescription = String(req.body?.contextDescription || "").trim().slice(0, 255);
      const phrase = String(req.body?.phrase || "").trim().slice(0, 800);
      if (!context || !contextDescription || !phrase) return res.status(422).json({ error: "Preencha o contexto, a descrição e a frase." });
      const id = crypto.randomUUID();
      await db.execute("INSERT INTO robot_speeches (id,context_key,context_description,phrase,active) VALUES (?,?,?,?,?)", [id, context, contextDescription, phrase, req.body?.active === false ? 0 : 1]);
      return res.status(201).json({ speech: await readSpeech(db, id) });
    }
    if (req.method === "PUT") {
      const id = String(req.body?.id || "").trim();
      const existing = id ? await one("SELECT id FROM robot_speeches WHERE id=? LIMIT 1", [id]) : null;
      if (!existing) return res.status(404).json({ error: "Fala não encontrada." });
      const context = cleanContext(req.body?.context);
      const contextDescription = String(req.body?.contextDescription || "").trim().slice(0, 255);
      const phrase = String(req.body?.phrase || "").trim().slice(0, 800);
      if (!context || !contextDescription || !phrase) return res.status(422).json({ error: "Preencha o contexto, a descrição e a frase." });
      await db.execute("UPDATE robot_speeches SET context_key=?,context_description=?,phrase=?,active=?,updated_at=UTC_TIMESTAMP() WHERE id=?", [context, contextDescription, phrase, req.body?.active === false ? 0 : 1, id]);
      return res.status(200).json({ speech: await readSpeech(db, id) });
    }
    if (req.method === "DELETE") {
      const id = String(req.query?.id || "").trim();
      const existing = id ? await one("SELECT audio_path FROM robot_speeches WHERE id=? LIMIT 1", [id]) : null;
      if (!existing) return res.status(404).json({ error: "Fala não encontrada." });
      await db.execute("DELETE FROM robot_speeches WHERE id=?", [id]);
      if (existing.audio_path) {
        const file = path.join(audioRoot, path.basename(existing.audio_path));
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Método não permitido." });
  } catch (error) {
    return sendError(res, error);
  }
};
