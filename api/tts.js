const crypto = require("node:crypto");
const { requireUser, sendError } = require("../lib/auth");
const { getSpeechCredentials } = require("../lib/settings");

const audioCache = new Map();
const requestWindows = new Map();

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]);
}

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

    const credentials = await getSpeechCredentials(db);
    if (!credentials?.apiKey || !credentials?.region) return res.status(503).json({ error: "Voz neural ainda não configurada." });
    const region = String(credentials.region).toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!region) return res.status(503).json({ error: "Região da voz neural inválida." });
    const voice = "pt-BR-AntonioNeural";
    const cacheKey = crypto.createHash("sha256").update(`${voice}:${text}`).digest("hex");
    if (audioCache.has(cacheKey)) return sendAudio(res, audioCache.get(cacheKey));

    const ssml = `<speak version="1.0" xml:lang="pt-BR"><voice name="${voice}"><prosody rate="-3%" pitch="-2Hz">${escapeXml(text)}</prosody></voice></speak>`;
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": credentials.apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
        "User-Agent": "AtlasMarketAssistant"
      },
      body: ssml,
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const error = new Error("A voz neural não respondeu. O Atlas usará a voz de reserva.");
      error.status = 502;
      throw error;
    }
    const audio = Buffer.from(await response.arrayBuffer());
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
