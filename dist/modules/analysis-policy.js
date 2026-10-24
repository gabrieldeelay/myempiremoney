const directionOf = value => {
  const direction = String(value || "WAIT").toUpperCase();
  return ["BUY", "SELL"].includes(direction) ? direction : "WAIT";
};

const confidenceOf = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const isFiveMinutes = value => /(?:^|\D)5\s*(?:m|min)(?:\D|$)/i.test(String(value || ""));

export function composeCentralAnalysis({ live = {}, trend = null, timeframe = null, expiration = null } = {}) {
  if (!trend) {
    return {
      ...live,
      direction: "WAIT",
      confidence: 0,
      signalKind: "syncing",
      entryConfirmed: false,
      reason: "Sincronizando este ativo com o Radar Atlas 5M.",
      factors: ["A direção só é publicada quando o servidor central confirma o mesmo sinal para todos."],
      source: "market-radar-loading"
    };
  }

  const trendDirection = directionOf(trend.direction);
  const trendConfidence = confidenceOf(trend.confidence);
  const liveDirection = directionOf(live.direction);
  const directional = ["BUY", "SELL"].includes(trendDirection);
  const visualAgrees = live.source === "screen-capture" && liveDirection === trendDirection;
  const setupVerified = isFiveMinutes(timeframe) && isFiveMinutes(expiration);
  const localEntryBlocked = directional && visualAgrees && live.entryBlocked === true;
  const entryConfirmed = directional && visualAgrees && setupVerified && !localEntryBlocked;
  const localTiming = entryConfirmed ? live.entryTiming : "WAIT_CONFIRMATION";
  const side = trendDirection === "BUY" ? "alta" : trendDirection === "SELL" ? "baixa" : "neutra";

  if (!directional) {
    return {
      ...live,
      ...trend,
      direction: "WAIT",
      confidence: trendConfidence,
      signalKind: "no-opportunity",
      entryConfirmed: false,
      entryTiming: "WAIT_CONFIRMATION",
      entryBlocked: false,
      setup: null,
      factors: [
        "O Radar Atlas 5M está atualizado, mas os indicadores não oferecem vantagem técnica suficiente.",
        trend.reason || "EMA9, EMA21, RSI e momentum estão sem direção consistente.",
        "Isso é um resultado válido da análise, não uma tela carregando."
      ],
      reason: "Sem oportunidade segura agora. O radar continuará atualizando automaticamente.",
      source: "market-radar-5m"
    };
  }

  const localContext = entryConfirmed
    ? "A leitura visual confirmou a direção e o gráfico e a expiração estão em 5 minutos."
    : localEntryBlocked
      ? "A direção permanece válida, mas o ponto seguro desta vela já passou."
      : !visualAgrees
        ? "A direção do mercado está definida, mas a tela ainda não confirmou um ponto de entrada."
        : !setupVerified
          ? "A direção está confirmada, mas o Atlas ainda precisa validar gráfico e expiração em 5 minutos."
          : "A direção está definida, mas o ponto de entrada ainda não foi confirmado.";

  return {
    ...live,
    ...trend,
    direction: trendDirection,
    confidence: trendConfidence,
    signalKind: entryConfirmed ? "entry" : "trend",
    entryConfirmed,
    entryTiming: localTiming,
    entryBlocked: localEntryBlocked,
    setup: visualAgrees ? live.setup : null,
    technical: live.technical,
    setupVerified,
    factors: [
      `Tendência de ${side} calculada na última vela de 5 minutos já fechada.`,
      trend.reason || "EMA9, EMA21, RSI e momentum calculados no servidor.",
      localContext
    ],
    reason: entryConfirmed
      ? `Sinal de entrada confirmado: ${trend.reason || `tendência de ${side}`}. ${localContext}`
      : `Tendência de ${side} no Radar Atlas 5M. ${localContext}`,
    source: "market-radar-5m"
  };
}

export function strongestTrend(items = []) {
  const ranked = [...items].sort((a, b) => {
    const aDirectional = directionOf(a.direction) === "WAIT" ? 0 : 1;
    const bDirectional = directionOf(b.direction) === "WAIT" ? 0 : 1;
    return bDirectional - aDirectional
      || confidenceOf(b.confidence) - confidenceOf(a.confidence)
      || Math.abs(Number(b.score) || 0) - Math.abs(Number(a.score) || 0);
  });
  return ranked[0] || null;
}

