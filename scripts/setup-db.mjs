import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

for (const file of [".env", ".env.mysql", ".env.local"]) {
  const fullPath = path.join(process.cwd(), file);
  if (fs.existsSync(fullPath)) dotenv.config({ path: fullPath, override: true });
}

for (const name of ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"]) {
  if (!process.env[name]) throw new Error(`${name} não configurada.`);
}

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  timezone: "Z"
});

const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(120) NULL, phone VARCHAR(24) NULL, document VARCHAR(24) NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user', plan_id VARCHAR(40) NULL,
    access_granted TINYINT(1) NOT NULL DEFAULT 0, access_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    access_expires_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_users_role (role), INDEX idx_users_access (access_status, access_granted)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_sessions_expiry (expires_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    \`key\` VARCHAR(64) PRIMARY KEY, \`value\` JSON NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS private_settings (
    \`key\` VARCHAR(64) PRIMARY KEY, \`value\` LONGTEXT NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS coupons (
    id CHAR(36) PRIMARY KEY, code VARCHAR(32) NOT NULL UNIQUE, type VARCHAR(20) NOT NULL,
    value DECIMAL(12,2) NOT NULL, valid_from DATETIME(3) NULL, valid_until DATETIME(3) NULL,
    max_uses INT NULL, uses_count INT NOT NULL DEFAULT 0, active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS payments (
    id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, request_number VARCHAR(190) NOT NULL UNIQUE,
    transaction_id VARCHAR(190) NULL, amount DECIMAL(12,2) NOT NULL, original_amount DECIMAL(12,2) NULL,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0, plan_id VARCHAR(40) NOT NULL DEFAULT 'monthly',
    coupon_id CHAR(36) NULL, coupon_redeemed_at DATETIME(3) NULL, status VARCHAR(40) NOT NULL DEFAULT 'pending',
    pix_code LONGTEXT NULL, qr_url LONGTEXT NULL, expires_at DATETIME(3) NULL, raw JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_payments_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL,
    INDEX idx_payments_user_created (user_id, created_at), INDEX idx_payments_status (status)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME(3) NOT NULL, used_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_reset_expiry (expires_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS robot_speeches (
    id CHAR(36) PRIMARY KEY, context_key VARCHAR(64) NOT NULL, context_description VARCHAR(255) NOT NULL,
    phrase TEXT NOT NULL, audio_path VARCHAR(255) NULL, audio_mime VARCHAR(80) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_robot_speeches_context (context_key, active)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
];

for (const statement of schema) await db.execute(statement);

const defaults = {
  pricing: { oldPrice: 1499, currentPrice: 499.9 },
  plans: { monthly: { id: "monthly", label: "Acesso Atlas", billing: "Acesso completo ao Atlas", oldPrice: 1499, currentPrice: 499.9, active: true, benefits: ["Radar de notícias e tendências", "Assistente durante as operações", "Atualizações incluídas"] } },
  content: { eyebrow: "SEU ASSISTENTE DE OPERAÇÃO", headline: "Operar no escuro, não dá certo.", subheadline: "O Atlas lê o contexto, organiza as informações e fica ao seu lado antes de cada decisão. Você continua no controle e não precisa decidir no escuro." },
  market: { newsQuery: "(bitcoin OR ethereum OR \"central bank\" OR inflation OR markets)", symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "ADAUSDT", "DOGEUSDT", "LTCUSDT", "AVAXUSDT"] }
};
for (const [key, value] of Object.entries(defaults)) {
  await db.execute("INSERT IGNORE INTO app_settings (`key`,`value`) VALUES (?,?)", [key, JSON.stringify(value)]);
}

const { DEFAULT_ROBOT_SPEECHES } = await import("../lib/robot-speech-defaults.js").then(module => module.default || module);
for (const speech of DEFAULT_ROBOT_SPEECHES) {
  await db.execute("INSERT IGNORE INTO robot_speeches (id,context_key,context_description,phrase,active) VALUES (?,?,?,?,1)", [speech.id, speech.context, speech.contextDescription, speech.phrase]);
}

const [admins] = await db.execute("SELECT id FROM users WHERE role='admin' LIMIT 1");
if (!admins.length) {
  if (!process.env.ATLAS_ADMIN_SEED_PASSWORD) throw new Error("ATLAS_ADMIN_SEED_PASSWORD é necessária apenas para criar o administrador inicial.");
  await db.execute(
    "INSERT INTO users (id,email,password_hash,name,role,access_granted,access_status) VALUES (?,?,?,?,\'admin\',1,\'active\')",
    [crypto.randomUUID(), "admin@atlas.local", await bcrypt.hash(process.env.ATLAS_ADMIN_SEED_PASSWORD, 12), "Administrador Atlas"]
  );
}

await db.execute("DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()");
await db.end();
console.log("MySQL e administrador Atlas configurados.");
