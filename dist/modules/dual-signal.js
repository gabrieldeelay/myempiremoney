const directionOf = value => {
  const direction = String(value || "WAIT").toUpperCase();
  return ["BUY", "SELL"].includes(direction) ? direction : "WAIT";
};

const confidenceOf = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const isFiveMinutes = value => /(?:^|\D)5\s*(?:m|min)(?:\D|$)/i.test(String(value || ""));

function waitingView(timing, reason, confidence = 0, source = null) {
  return {
    direction: "WAIT",
    confidence: confidenceOf(confidence),
    possible: false,
    actionable: false,
    signalKind: "syncing",
    timing,
    setup: null,
    reason,
    factors: Array.isArray(source?.factors) ? source.factors : [],
    technical: source?.technical || null,
    source: source?.source || "dual-signal"
  };
}

function directionalView(source, direction, timing, options = {}) {
  const confidence = confidenceOf(options.confidence ?? source?.confidence);
  const possible = options.possible ?? confidence < 70;
  return {
    ...source,
    direction: directionOf(direction),
    confidence,
    possible,
    actionable: !possible && confidence >= 70,
    timing,
    entryTiming: timing,
    entryConfirmed: true,
    signalKind: "entry",
    setup: options.setup ?? source?.setup ?? null,
    reason: options.reason || source?.reason || "Leitura técnica atualizada.",
    factors: Array.isArray(source?.factors) ? source.factors : []
  };
}

export function composeDualSignalViews({ live = {}, central = {}, trend = null, timeframe = null, expiration = null } = {}) {
  const setupVerified = isFiveMinutes(timeframe) && isFiveMinutes(expiration);
  const liveDirection = directionOf(live.direction);
  const centralDirection = directionOf(central.direction);
  const trendDirection = directionOf(trend?.direction);
  const liveConfidence = confidenceOf(live.confidence);
  const visualReady = live.source === "screen-capture" && live.chartDetected !== false;

  let current;
  if (!setupVerified) {
    current = waitingView(
      "CURRENT_CANDLE",
      "Confirme o gráfico e a expiração em 5 minutos antes de usar uma entrada nesta vela.",
      0,
      live
    );
  } else if (visualReady && live.setup === "INTRACANDLE_REVERSAL" && liveDirection !== "WAIT" && liveConfidence >= 50) {
    current = directionalView(live, liveDirection, "CURRENT_CANDLE", {
      possible: liveConfidence < 70,
      setup: "INTRACANDLE_REVERSAL"
    });
  } else if (visualReady && live.entryTiming === "CURRENT_CANDLE" && liveDirection !== "WAIT" && liveConfidence >= 50) {
    current = directionalView(live, liveDirection, "CURRENT_CANDLE");
  } else if (centralDirection !== "WAIT" && central.entryTiming === "CURRENT_CANDLE" && confidenceOf(central.confidence) >= 50) {
    current = directionalView(central, centralDirection, "CURRENT_CANDLE");
  } else {
    current = waitingView(
      "CURRENT_CANDLE",
      visualReady
        ? "Sem entrada confirmada nesta vela. O Atlas continua acompanhando força, suporte, resistência e rejeição."
        : "Aguardando a leitura visual do gráfico para avaliar a vela atual.",
      visualReady ? liveConfidence : 0,
      live
    );
    if (visualReady) current.signalKind = "no-opportunity";
  }

  const nextSource = trend || central || {};
  const nextDirection = trendDirection !== "WAIT" ? trendDirection : centralDirection;
  const nextConfidence = confidenceOf(trend?.confidence ?? central?.confidence);
  const next = nextDirection !== "WAIT" && nextConfidence >= 50
    ? directionalView(nextSource, nextDirection, "NEXT_CANDLE", {
      confidence: nextConfidence,
      possible: nextConfidence < 70,
      setup: null,
      reason: trend?.reason || central?.reason || "Direção provável calculada para a próxima vela de 5 minutos."
    })
    : waitingView(
      "NEXT_CANDLE",
      "Ainda não há direção suficientemente consistente para a próxima vela.",
      nextConfidence,
      nextSource
    );

  return { current, next, setupVerified };
}

export function signalLabel(view = {}) {
  const direction = directionOf(view.direction);
  if (direction === "WAIT") return "AGUARDANDO CONFIRMAÇÃO";
  const side = direction === "BUY" ? "COMPRA" : "VENDA";
  return `${view.possible ? "PROVÁVEL " : ""}${side}`;
}

