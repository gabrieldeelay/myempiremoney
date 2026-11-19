const CLOUD_PLANS = {
  session_15: {
    id: "session_15",
    label: "Passe rápido",
    billing: "15 minutos de gameplay",
    oldPrice: 19.90,
    currentPrice: 19.90,
    durationMinutes: 15,
    active: true,
    benefits: ["15 minutos de sessão", "Entrada automática na fila", "Acesso pelo navegador"]
  },
  session_60: {
    id: "session_60",
    label: "Sessão completa",
    billing: "1 hora de gameplay",
    oldPrice: 49.90,
    currentPrice: 49.90,
    durationMinutes: 60,
    active: true,
    priority: true,
    benefits: ["60 minutos de sessão", "Prioridade e fila mais rápida", "Acesso pelo navegador"]
  }
};

function getCloudPlan(planId) {
  return CLOUD_PLANS[String(planId || "")];
}

module.exports = { CLOUD_PLANS, getCloudPlan };
