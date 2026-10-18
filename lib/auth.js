const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { getDb, one, toIso } = require("./db");

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function profileFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name || "",
    phone: row.phone || "",
    document: row.document || "",
    role: row.role || "user",
    plan_id: row.plan_id || null,
    access_granted: Boolean(row.access_granted),
    access_status: row.access_status || "pending",
    access_expires_at: toIso(row.access_expires_at),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
}

async function createSession(userId) {
  const token = crypto.randomBytes(40).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  await getDb().execute(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    [tokenHash(token), userId, expiresAt]
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

async function destroySession(token) {
  if (token) await getDb().execute("DELETE FROM sessions WHERE token_hash = ?", [tokenHash(token)]);
}

async function requireUser(req) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error("Faça login para continuar.");
    error.status = 401;
    throw error;
  }
  const row = await one(
    `SELECT u.* FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()
      LIMIT 1`,
    [tokenHash(token)]
  );
  if (!row) {
    const error = new Error("Sua sessão expirou. Entre novamente.");
    error.status = 401;
    throw error;
  }
  return { db: getDb(), user: { id: row.id, email: row.email }, profile: profileFrom(row), token };
}

async function requireAdmin(req) {
  const context = await requireUser(req);
  if (context.profile?.role !== "admin") {
    const error = new Error("Acesso restrito ao administrador.");
    error.status = 403;
    throw error;
  }
  return context;
}

async function authenticate(identity, password) {
  const normalized = String(identity || "").trim().toLowerCase();
  const email = normalized === "admin" ? "admin@atlas.local" : normalized;
  const row = await one("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  const valid = row?.password_hash && await bcrypt.compare(String(password || ""), row.password_hash).catch(() => false);
  if (!row || !valid) {
    const error = new Error("E-mail ou senha incorretos.");
    error.status = 401;
    throw error;
  }
  const session = await createSession(row.id);
  return { ...session, user: { id: row.id, email: row.email }, profile: profileFrom(row) };
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), 12);
}

function sendError(res, error) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: status >= 500 ? "O Atlas encontrou um erro interno." : error.message });
}

module.exports = {
  authenticate,
  bearerToken,
  createSession,
  destroySession,
  hashPassword,
  profileFrom,
  requireAdmin,
  requireUser,
  sendError,
  tokenHash
};
