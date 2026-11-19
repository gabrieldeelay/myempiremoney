const crypto = require("node:crypto");
const { getDb } = require("./db");
const { getCloudPlan } = require("./cloud-plans");

let schemaPromise;
function stableNumber(seed) {
  return crypto.createHash("sha256").update(String(seed)).digest().readUInt32BE(0);
}

function freeWaitSeconds(ticketId) {
  const minimum = 70 * 3600;
  const maximum = 250 * 3600;
  return minimum + stableNumber(`${ticketId}:wait`) % (maximum - minimum + 1);
}

function visualPlayingCount(nowMs = Date.now()) {
  const fiveMinuteBucket = Math.floor(Number(nowMs) / (5 * 60 * 1000));
  return 30 + stableNumber(`${fiveMinuteBucket}:visual:9`) % 36;
}

function ensureCloudQueueSchema(db = getDb()) {
  if (!schemaPromise) schemaPromise = db.execute(`CREATE TABLE IF NOT EXISTS cloud_queue (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    payment_id CHAR(36) NOT NULL,
    game_key VARCHAR(40) NOT NULL DEFAULT 'gta6',
    duration_minutes SMALLINT UNSIGNED NOT NULL,
    display_position SMALLINT UNSIGNED NOT NULL,
    display_total SMALLINT UNSIGNED NOT NULL DEFAULT 967,
    status VARCHAR(24) NOT NULL DEFAULT 'waiting',
    joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    started_at DATETIME(3) NULL,
    ends_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    last_seen_at DATETIME(3) NULL,
    UNIQUE KEY uq_cloud_queue_payment (payment_id),
    INDEX idx_cloud_queue_order (game_key,status,joined_at),
    INDEX idx_cloud_queue_user (user_id,status),
    CONSTRAINT fk_cloud_queue_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_queue_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`).catch(error => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

async function enqueuePaidSession(connection, payment) {
  const plan = getCloudPlan(payment.plan_id);
  if (!plan || plan.free) return null;
  await connection.execute(
    "UPDATE cloud_queue SET status='completed',completed_at=UTC_TIMESTAMP(3) WHERE user_id=? AND duration_minutes=0 AND status IN ('waiting','ready')",
    [payment.user_id]
  );
  const id = crypto.randomUUID();
  const displayPosition = plan.priority ? crypto.randomInt(550, 721) : crypto.randomInt(550, 968);
  await connection.execute(
    `INSERT IGNORE INTO cloud_queue (id,user_id,payment_id,game_key,duration_minutes,display_position,display_total,status,joined_at)
     VALUES (?,?,?,'gta6',?,?,967,'waiting',UTC_TIMESTAMP(3))`,
    [id, payment.user_id, payment.id, plan.durationMinutes, displayPosition]
  );
  return id;
}

async function enqueueFreeSession(connection, payment) {
  const id = crypto.randomUUID();
  await connection.execute(
    `INSERT IGNORE INTO cloud_queue (id,user_id,payment_id,game_key,duration_minutes,display_position,display_total,status,joined_at)
     VALUES (?,?,?,'gta6',0,1,1,'waiting',UTC_TIMESTAMP(3))`,
    [id, payment.user_id, payment.id]
  );
  return id;
}

function publicName(name) {
  const first = String(name || "Jogador").trim().split(/\s+/)[0] || "Jogador";
  return first.length > 2 ? `${first.slice(0, -1)}•` : `${first[0] || "J"}•`;
}

async function getActiveSessionCount(db = getDb()) {
  await ensureCloudQueueSchema(db);
  const [rows] = await db.query(
    "SELECT COUNT(*) AS total FROM cloud_queue WHERE game_key='gta6' AND status='playing' AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))"
  );
  return Math.max(0, Number(rows?.[0]?.total || 0));
}

async function getQueueSnapshot(userId = null, db = getDb()) {
  const playingCount = await getActiveSessionCount(db);
  const displayPlayingCount = visualPlayingCount();
  if (!userId) return { game: "GTA VI", online: true, playingCount, displayPlayingCount, players: [], myTicket: null };
  const [rows] = await db.query(
    `SELECT q.id,q.user_id,q.duration_minutes,q.display_position,q.display_total,q.status,q.joined_at,q.started_at,q.ends_at,u.name
       FROM cloud_queue q INNER JOIN users u ON u.id=q.user_id
      WHERE q.game_key='gta6' AND q.status IN ('waiting','ready','playing')
      ORDER BY (q.user_id=?) DESC,FIELD(q.status,'playing','ready','waiting'),q.joined_at ASC LIMIT 80`,
    [userId]
  );
  const shownPosition = row => {
    const elapsedSeconds = Math.max(0, (Date.now() - new Date(row.joined_at).getTime()) / 1000);
    const priority = Number(row.duration_minutes) >= 60;
    if (Number(row.duration_minutes) === 0) return 1;
    return Math.max(1, Number(row.display_position || 550) - Math.floor(elapsedSeconds / (priority ? 6 : 12)));
  };
  const players = rows.map((row, index) => ({
    id: row.id,
    name: publicName(row.name),
    durationMinutes: Number(row.duration_minutes),
    status: row.status,
    position: row.status === "waiting" ? shownPosition(row) : 0,
    total: Number(row.display_total || 967)
  }));
  const own = userId ? rows.find(row => row.user_id === userId) : null;
  const ownPosition = own?.status === "waiting" ? shownPosition(own) : 0;
  const ownPriority = Number(own?.duration_minutes) >= 60;
  const ownFree = Number(own?.duration_minutes) === 0;
  const waitEndsAt = ownFree && own ? new Date(new Date(own.joined_at).getTime() + freeWaitSeconds(own.id) * 1000) : null;
  const remainingSeconds = waitEndsAt ? Math.max(0, Math.ceil((waitEndsAt.getTime() - Date.now()) / 1000)) : 0;
  const minutesAhead = ownPosition > 0 && !ownFree ? Math.max(1, Math.ceil(ownPosition / (ownPriority ? 14 : 8))) : 0;
  return {
    game: "GTA VI",
    online: true,
    playingCount,
    displayPlayingCount,
    players,
    myTicket: own ? {
      id: own.id,
      status: own.status,
      durationMinutes: Number(own.duration_minutes),
      position: ownPosition,
      total: Number(own.display_total || 967),
      priority: ownPriority,
      free: ownFree,
      estimatedMinutes: minutesAhead,
      remainingSeconds,
      waitEndsAt: waitEndsAt?.toISOString() || null
    } : null
  };
}

module.exports = { enqueueFreeSession, enqueuePaidSession, ensureCloudQueueSchema, freeWaitSeconds, getActiveSessionCount, getQueueSnapshot, visualPlayingCount };
