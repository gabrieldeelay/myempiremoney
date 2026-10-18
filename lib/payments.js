const { getDb } = require("./db");

async function activatePayment(paymentId, raw) {
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [records] = await connection.execute("SELECT * FROM payments WHERE id = ? FOR UPDATE", [paymentId]);
    const payment = records[0];
    if (!payment) { await connection.rollback(); return; }
    if (payment.coupon_id && !payment.coupon_redeemed_at) {
      await connection.execute("UPDATE coupons SET uses_count = uses_count + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?", [payment.coupon_id]);
      await connection.execute("UPDATE payments SET coupon_redeemed_at = UTC_TIMESTAMP() WHERE id = ?", [payment.id]);
    }
    await connection.execute("UPDATE payments SET status='confirmed',raw=?,updated_at=UTC_TIMESTAMP() WHERE id=?", [JSON.stringify(raw || {}), payment.id]);
    await connection.execute(
      `UPDATE users SET access_granted=1,access_status='active',plan_id='monthly',
       access_expires_at=DATE_ADD(GREATEST(UTC_TIMESTAMP(),COALESCE(access_expires_at,UTC_TIMESTAMP())),INTERVAL 30 DAY),updated_at=UTC_TIMESTAMP()
       WHERE id=?`,
      [payment.user_id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { activatePayment };
