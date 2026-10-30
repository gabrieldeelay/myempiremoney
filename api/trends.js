const { getMarketRadar } = require("../lib/market-radar");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=5, must-revalidate");
  try {
    const snapshot = await getMarketRadar();
    if (!snapshot.signals.length) throw new Error("Nenhum ativo respondeu.");
    return res.status(200).json({
      items: snapshot.signals.slice(0, 5),
      signals: snapshot.signals,
      source: snapshot.source,
      method: "EMA9 + EMA21 + RSI14 + momentum; taxa de acerto medida em velas históricas de 5 minutos, sem antecipar o resultado da vela seguinte",
      updatedAt: snapshot.updatedAt,
      refreshing: snapshot.refreshing
    });
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: "As tendências estão atualizando. Tente novamente em instantes.", items: [], signals: [] });
  }
};
