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
  const liveConfidence = confidenceOf(live.confidence);
  const directional = ["BUY", "SELL"].includes(trendDirection);
  const visualAgrees = live.source === "screen-capture" && liveDirection === trendDirection;
  const visualDirectional = live.source === "screen-capture" && ["BUY", "SELL"].includes(liveDirection) && live.chartDetected !== false;
  const setupVerified = isFiveMinutes(timeframe) && isFiveMinutes(expiration);
  const localEntryBlocked = directional && visualAgrees && live.entryBlocked === true;
  const validVisualOpportunity = visualAgrees && setupVerified && !localEntryBlocked && liveConfidence >= 50;
  const entryConfirmed = directional && validVisualOpportunity;
  // The server percentage is an observed historical hit rate. A visual
  // strength score cannot be averaged into it as though it were a probability.
  const combinedConfidence = trendConfidence;
  const localTiming = entryConfirmed ? live.entryTiming : "WAIT_CONFIRMATION";
  const side = trendDirection === "BUY" ? "alta" : trendDirection === "SELL" ? "baixa" : "neutra";

  const confirmedReversal = visualDirectional
    && setupVerified
    && live.setup === "INTRACANDLE_REVERSAL"
    && live.urgentReversal === true
    && liveConfidence >= 70;
  if (confirmedReversal && liveDirection !== trendDirection) {
    const reversalSide = liveDirection === "BUY" ? "compra" : "venda";
    const reversalConfidence = Math.min(69, liveConfidence);
    return {
      ...trend,
      ...live,
      direction: liveDirection,
      confidence: reversalConfidence,
      probabilityCalibrated: false,
      signalKind: "entry",
      entryConfirmed: true,
      entryTiming: "CURRENT_CANDLE",
      setupVerified: true,
      factors: [
        `A tela confirmou rejeição técnica para ${reversalSide} após um movimento extremo.`,
        ...(Array.isArray(live.factors) ? live.factors : []),
        "A reversão visual prevalece apenas nesta oportunidade; não presume que toda vela extrema irá inverter."
      ],
      reason: `Rejeição técnica confirmada: ${reversalSide} nesta vela, aguardando o melhor ponto de entrada.`,
      source: "market-radar-5m"
    };
  }

  if (!directional) {
    const visualOpportunity = visualDirectional
      && setupVerified
      && liveConfidence >= 72
      && (live.urgentReversal === true || Math.abs(Number(live.score) || 0) >= .38);
    if (visualOpportunity) {
      const visualSide = liveDirection === "BUY" ? "compra" : "venda";
      const visualConfidence = Math.min(69, liveConfidence);
      return {
        ...trend,
        ...live,
        direction: liveDirection,
        confidence: visualConfidence,
        probabilityCalibrated: false,
        signalKind: "entry",
        entryConfirmed: true,
        setupVerified: true,
        factors: [
          `As velas confirmaram uma oportunidade de ${visualSide} mesmo com o radar central ainda neutro.`,
          ...(Array.isArray(live.factors) ? live.factors : []),
          "Gráfico e expiração foram confirmados em 5 minutos."
        ],
        reason: `Sinal visual de ${visualSide} confirmado por força, sequência e deslocamento das velas.`,
        source: "market-radar-5m"
      };
    }
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

  if (combinedConfidence < 50) {
    return {
      ...live,
      ...trend,
      direction: "WAIT",
      confidence: combinedConfidence,
      signalKind: "no-opportunity",
      entryConfirmed: false,
      entryTiming: "WAIT_CONFIRMATION",
      entryBlocked: false,
      factors: [
        `A direção calculada ficou em ${combinedConfidence}%, abaixo do mínimo operacional de 50%.`,
        trend.reason || "Os indicadores ainda não entregaram força suficiente.",
        "A análise terminou normalmente e continuará sendo atualizada na próxima leitura."
      ],
      reason: "Sem oportunidade segura agora. A leitura ficou abaixo de 50% de confiança.",
      source: "market-radar-5m"
    };
  }

  const localContext = entryConfirmed
    ? "A leitura visual confirmou a direção e o gráfico e a expiração estão em 5 minutos."
    : localEntryBlocked
      ? "A direção permanece válida, mas o ponto seguro desta vela já passou."
      : !visualAgrees
        ? `Há provável ${trendDirection === "BUY" ? "compra" : "venda"} para a próxima vela; a leitura visual atualizará o momento.`
        : !setupVerified
          ? "A direção está confirmada, mas o Atlas ainda precisa validar gráfico e expiração em 5 minutos."
          : `Há provável ${trendDirection === "BUY" ? "compra" : "venda"} para a próxima vela.`;

  return {
    ...live,
    ...trend,
    direction: trendDirection,
    confidence: combinedConfidence,
    signalKind: entryConfirmed ? "entry" : "trend",
    entryConfirmed,
    entryTiming: localTiming,
    entryBlocked: localEntryBlocked,
    setup: visualAgrees ? live.setup : null,
    technical: live.technical,
    setupVerified,
    factors: [
      `Direção de ${side} calculada na última vela de 5 minutos já fechada.`,
      trend.reason || "EMA9, EMA21, RSI e momentum calculados no servidor.",
      localContext
    ],
    reason: entryConfirmed
      ? `Sinal de entrada confirmado: ${trend.reason || `direção de ${side}`}. ${localContext}`
      : `Provável ${trendDirection === "BUY" ? "compra" : "venda"} para a próxima vela. ${localContext}`,
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

