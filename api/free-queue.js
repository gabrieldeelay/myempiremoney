const crypto = require("node:crypto");
const { bearerToken, createSession, hashPassword, requireUser, sendError } = require("../lib/auth");
const { getDb } = require("../lib/db");
const { enqueueFreeSession, ensureCloudQueueSchema, getQueueSnapshot } = require("../lib/cloud-queue");

async function createFreeGuest(db) {
  const id = crypto.randomUUID();
  const email = `free.${id}@checkout.gtajogar.local`;
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString("base64url"));
  await db.execute(
    `INSERT INTO users (id,email,password_hash,name,document,role,access_granted,access_status,created_at,updated_at)
     VALUES (?,?,?,'Jogador grátis',NULL,'user',0,'pending',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
    [id, email, passwordHash]
  );
  const session = await createSession(id);
  return { user: { id, email }, session };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  try {
    const db = getDb();
    await ensureCloudQueueSchema(db);
    let context = null;
    if (bearerToken(req)) {
      try { context = await requireUser(req); }
      catch (error) { if (Number(error?.status) !== 401) throw error; }
    }
    let guest = false;
    if (!context) {
      context = { db, ...(await createFreeGuest(db)) };
      guest = true;
    }
    let current = await getQueueSnapshot(context.user.id, db);
    const resetRequested = req.body?.reset === true && current.myTicket?.free === true;
    if (resetRequested) {
      await db.execute(
        "UPDATE cloud_queue SET status='completed',completed_at=UTC_TIMESTAMP(3) WHERE id=? AND user_id=? AND status IN ('waiting','ready')",
        [current.myTicket.id, context.user.id]
      );
      current = { ...current, myTicket: null };
    }
    if (!current.myTicket) {
      const paymentId = crypto.randomUUID();
      const requestNumber = `free-${crypto.randomUUID()}`;
      await db.execute(
        `INSERT INTO payments (id,user_id,request_number,transaction_id,amount,original_amount,discount_amount,plan_id,status,pix_code,qr_url,expires_at,raw,created_at,updated_at)
         VALUES (?,?,?,?,0,0,0,'free_queue','confirmed','','',NULL,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
        [paymentId, context.user.id, requestNumber, requestNumber, JSON.stringify({ source: "free_queue" })]
      );
      await enqueueFreeSession(db, { id: paymentId, user_id: context.user.id, plan_id: "free_queue" });
      await db.execute(
        "UPDATE users SET access_granted=1,access_status='queued',plan_id='free_queue',updated_at=UTC_TIMESTAMP() WHERE id=?",
        [context.user.id]
      );
    }
    const queue = await getQueueSnapshot(context.user.id, db);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      queue,
      reset: resetRequested,
      session: guest ? { access_token: context.session.token, expires_at: context.session.expiresAt, user: context.user } : null
    });
  } catch (error) {
    return sendError(res, error);
  }
};
