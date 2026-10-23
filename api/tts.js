const crypto = require("node:crypto");
const { requireUser, sendError } = require("../lib/auth");
const { getGoogleTtsCredentials } = require("../lib/settings");

const ALLOWED_VOICES = new Set([
  "pt-BR-Chirp3-HD-Fenrir",
  "pt-BR-Chirp3-HD-Charon",
  "pt-BR-Chirp3-HD-Orus",
  "pt-BR-Chirp3-HD-Puck"
]);

const audioCache = new Map();
const requestWindows = new Map();

function allowRequest(userId) {
  const now = Date.now();
  const recent = (requestWindows.get(userId) || []).filter(timestamp => now - timestamp < 60000);
  if (recent.length >= 20) return false;
  recent.push(now);
  requestWindows.set(userId, recent);
  return true;
}

function sendAudio(res, audio) {
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Length", audio.length);
  res.setHeader("Cache-Control", "private, max-age=86400");
  return res.status(200).send(audio);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
    const { user, db } = await requireUser(req);
    if (!allowRequest(user.id)) return res.status(429).json({ error: "A voz está recebendo mensagens demais. Aguarde alguns segundos." });
    const text = String(req.body?.text || "").replace(/\s+/g, " ").trim().slice(0, 480);
    if (!text) return res.status(422).json({ error: "Mensagem vazia." });

    const credentials = await getGoogleTtsCredentials(db);
    if (!credentials?.apiKey) return res.status(503).json({ error: "Voz natural ainda não configurada." });
    const voice = ALLOWED_VOICES.has(credentials.voice) ? credentials.voice : "pt-BR-Chirp3-HD-Fenrir";
    const cacheKey = crypto.createHash("sha256").update(`${voice}:${text}`).digest("hex");
    if (audioCache.has(cacheKey)) return sendAudio(res, audioCache.get(cacheKey));

    const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": credentials.apiKey,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "pt-BR", name: voice },
        audioConfig: { audioEncoding: "MP3" }
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const error = new Error("A voz neural não respondeu. O Atlas usará a voz de reserva.");
      error.status = 502;
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    const audio = payload.audioContent ? Buffer.from(payload.audioContent, "base64") : Buffer.alloc(0);
    if (!audio.length) {
      const error = new Error("A voz neural retornou um áudio vazio.");
      error.status = 502;
      throw error;
    }
    audioCache.set(cacheKey, audio);
    if (audioCache.size > 80) audioCache.delete(audioCache.keys().next().value);
    return sendAudio(res, audio);
  } catch (error) {
    return sendError(res, error);
  }
};
