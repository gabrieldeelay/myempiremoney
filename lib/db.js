const mysql = require("mysql2/promise");

let pool;

function getDb() {
  if (!pool) {
    const host = process.env.MYSQL_HOST;
    const user = process.env.MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD;
    const database = process.env.MYSQL_DATABASE;
    if (!host || !user || !password || !database) throw new Error("MySQL não configurado.");
    pool = mysql.createPool({
      host,
      port: Number(process.env.MYSQL_PORT || 3306),
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 8,
      maxIdle: 8,
      idleTimeout: 60000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      decimalNumbers: true,
      timezone: "Z"
    });
  }
  return pool;
}

async function rows(sql, params = []) {
  const [result] = await getDb().execute(sql, params);
  return result;
}

async function one(sql, params = []) {
  const result = await rows(sql, params);
  return result[0] || null;
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

module.exports = { getDb, rows, one, parseJson, toIso };
