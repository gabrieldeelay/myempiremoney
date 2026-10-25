const crypto = require("node:crypto");
const { toIso } = require("./db");

const ASSET_ALIASES = new Map([
  ["BTC", "BITCOIN"], ["XBT", "BITCOIN"], ["ETH", "ETHEREUM"], ["SOL", "SOLANA"],
  ["LTC", "LITECOIN"], ["ADA", "CARDANO"], ["XLM", "STELLAR"], ["TRX", "TRON"],
  ["DOT", "POLKADOT"], ["LINK", "CHAINLINK"], ["BCH", "BITCOIN CASH"]
]);
const FIAT = new Set(["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD", "CHF"]);
let schemaPromise = null;
const activeSignalCache = new Map();

function normalizeSignalAsset(value) {
  const label = String(value || "").replace(/\b(?:CRYPTO|FOREX|OTC)\b/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const symbol = label.replace(/[^A-Z]/g, "");
  if (!symbol) return "";
  if (symbol.length === 6 && FIAT.has(symbol.slice(0, 3)) && FIAT.has(symbol.slice(3))) return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
  for (const [code, name] of ASSET_ALIASES) {
    if (symbol === code || (symbol.startsWith(code) && /^(?:USDT|USDC|USD|BRL)$/.test(symbol.slice(code.length)))) return name;
  }
  return label.replace(/\s*\/\s*/g, "/").slice(0, 40);
}

async function ensureManualSignalsSchema(db) {
  if (!schemaPromise) schemaPromise = db.execute(`CREATE TABLE IF NOT EXISTS manual_signals (
    id CHAR(36) PRIMARY KEY,
    asset VARCHAR(40) NOT NULL,
    direction VARCHAR(8) NOT NULL,
    timing VARCHAR(24) NOT NULL,
    confidence INT NOT NULL DEFAULT 95,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    starts_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    created_by CHAR(36) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_manual_signal_active (status, expires_at),
    INDEX idx_manual_signal_asset (asset, status, expires_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`).catch(error => { schemaPromise = null; throw error; });
  await schemaPromise;
}

function signalWindow(timing, now = new Date()) {
  const boundary = Math.ceil((now.getTime() + 50) / 300000) * 300000;
  const expiresAt = new Date(boundary + (timing === "NEXT_CANDLE" ? 300000 : 0) + 4000);
  return { startsAt: now, expiresAt };
}

function signalPayload(row) {
  return row ? {
    id: row.id,
    asset: row.asset,
    direction: row.direction,
    timing: row.timing,
    confidence: Number(row.confidence) || 95,
    status: row.status,
    startsAt: toIso(row.starts_at),
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at)
  } : null;
}

async function createManualSignal(db, input, adminId) {
  const asset = normalizeSignalAsset(input.asset);
  const direction = String(input.direction || "").toUpperCase();
  const timing = String(input.timing || "").toUpperCase();
  if (!asset) throw Object.assign(new Error("Escolha um ativo."), { status: 422 });
  if (!["BUY", "SELL"].includes(direction)) throw Object.assign(new Error("Escolha COMPRA ou VENDA."), { status: 422 });
  if (!["CURRENT_CANDLE", "NEXT_CANDLE"].includes(timing)) throw Object.assign(new Error("Escolha NESTA VELA ou PRÓXIMA VELA."), { status: 422 });
  const confidence = Math.min(99, Math.max(70, Math.round(Number(input.confidence) || 95)));
  const { startsAt, expiresAt } = signalWindow(timing);
  const durationMicros = Math.max(1000, expiresAt.getTime() - startsAt.getTime()) * 1000;
  const id = crypto.randomUUID();
  await db.execute("UPDATE manual_signals SET status='superseded',updated_at=UTC_TIMESTAMP(3) WHERE asset=? AND status='active'", [asset]);
  await db.execute(
    "INSERT INTO manual_signals (id,asset,direction,timing,confidence,status,starts_at,expires_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'active',UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MICROSECOND),?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [id, asset, direction, timing, confidence, durationMicros, adminId || null]
  );
  activeSignalCache.delete(asset);
  const [createdRows] = await db.execute("SELECT * FROM manual_signals WHERE id=? LIMIT 1", [id]);
  return signalPayload(createdRows[0]);
}

async function getActiveManualSignal(db, assetValue) {
  const asset = normalizeSignalAsset(assetValue);
  if (!asset) return null;
  const cached = activeSignalCache.get(asset);
  if (cached && cached.until > Date.now()) return cached.signal;
  await db.execute(
    `UPDATE manual_signals
      SET starts_at=UTC_TIMESTAMP(3),
          expires_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL IF(timing='NEXT_CANDLE', 604, 304) SECOND),
          updated_at=UTC_TIMESTAMP(3)
      WHERE asset=? AND status='active' AND starts_at>DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 SECOND)`,
    [asset]
  );
  const [rows] = await db.execute(
    "SELECT * FROM manual_signals WHERE asset=? AND status='active' AND expires_at>UTC_TIMESTAMP(3) ORDER BY created_at DESC LIMIT 1",
    [asset]
  );
  const signal = signalPayload(rows[0]);
  activeSignalCache.set(asset, { signal, until: Date.now() + 650 });
  return signal;
}

function invalidateManualSignalCache(asset) {
  if (asset) activeSignalCache.delete(normalizeSignalAsset(asset));
  else activeSignalCache.clear();
}

module.exports = { createManualSignal, ensureManualSignalsSchema, getActiveManualSignal, invalidateManualSignalCache, normalizeSignalAsset, signalPayload, signalWindow };
