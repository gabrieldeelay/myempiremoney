const { bearerToken, requireUser, sendError } = require("../lib/auth");
const { getQueueSnapshot } = require("../lib/cloud-queue");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
  try {
    let userId = null;
    if (bearerToken(req)) {
      const context = await requireUser(req);
      userId = context.user.id;
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(await getQueueSnapshot(userId));
  } catch (error) {
    return sendError(res, error);
  }
};
