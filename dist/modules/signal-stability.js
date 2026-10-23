const normalizedDirection = value => {
  const direction = String(value || "WAIT").toUpperCase();
  return ["BUY", "SELL"].includes(direction) ? direction : "WAIT";
};

const normalizedConfidence = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

function waitingAnalysis(candidate = null) {
  return {
    direction: "WAIT",
    confidence: 0,
    reason: candidate
      ? "A leitura ainda está sendo confirmada. O Atlas só publica a direção quando ela permanece consistente."
      : "Aguardando uma direção consistente nas próximas leituras.",
    factors: [
      candidate
        ? `${candidate.direction === "BUY" ? "Compra" : "Venda"} apareceu, mas ainda precisa persistir antes de virar recomendação.`
        : "Ainda não há repetição suficiente para confirmar compra ou venda.",
      "O filtro de estabilidade evita trocar o sinal por causa de uma oscilação isolada da vela aberta."
    ],
    stability: candidate ? "initializing" : "waiting",
    transition: candidate ? {
      direction: candidate.direction,
      confidence: candidate.analysis.confidence,
      hits: candidate.hits
    } : null
  };
}

export function createSignalStabilizer(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const initialConfirmMs = options.initialConfirmMs ?? 3000;
  const switchConfirmMs = options.switchConfirmMs ?? 12000;
  const minHoldMs = options.minHoldMs ?? 35000;
  const initialHits = options.initialHits ?? 3;
  const switchHits = options.switchHits ?? 7;

  let asset = "";
  let stable = null;
  let candidate = null;
  let entryBlock = null;

  function reset(nextAsset = "") {
    asset = String(nextAsset || "").trim().toUpperCase();
    stable = null;
    candidate = null;
    entryBlock = null;
  }

  function rememberCandidate(analysis, timestamp) {
    const direction = normalizedDirection(analysis.direction);
    if (!candidate || candidate.direction !== direction) {
      candidate = { direction, analysis, hits: 1, since: timestamp, updatedAt: timestamp };
      return candidate;
    }
    candidate.analysis = analysis;
    candidate.hits += 1;
    candidate.updatedAt = timestamp;
    return candidate;
  }

  function promote(analysis, timestamp) {
    stable = { ...analysis, direction: normalizedDirection(analysis.direction), confidence: normalizedConfidence(analysis.confidence), since: timestamp };
    candidate = null;
    entryBlock = null;
    return { ...stable, stability: "stable", transition: null };
  }

  function blockedView(analysis, transition = null) {
    const direction = entryBlock?.direction || stable?.direction || "WAIT";
    const side = direction === "BUY" ? "compradora" : "vendedora";
    return {
      ...stable,
      ...analysis,
      setup: "STRETCHED_CANDLE",
      direction,
      confidence: Math.min(stable?.confidence || 100, analysis.confidence || stable?.confidence || 0),
      entryBlocked: true,
      expiredDirection: direction,
      since: stable?.since,
      stability: "checking",
      transition,
      reason: `A direção ${side} permanece, mas o ponto seguro desta vela já passou. Aguarde uma nova entrada na mesma direção ou uma reversão confirmada.`
    };
  }

  function movedToNewCandle(analysis, timestamp) {
    const currentX = Number(analysis?.technical?.lastCandle?.centerX);
    const blockedX = Number(entryBlock?.candleX);
    if (Number.isFinite(currentX) && Number.isFinite(blockedX)) {
      const width = Math.max(4, Number(entryBlock?.candleWidth) || 4);
      return Math.abs(currentX - blockedX) > width * .75;
    }
    return timestamp - Number(entryBlock?.since || timestamp) >= 60000;
  }

  function update(input = {}, nextAsset = "") {
    const timestamp = now();
    const normalizedAsset = String(nextAsset || "").trim().toUpperCase();
    if (normalizedAsset !== asset) reset(normalizedAsset);

    const analysis = {
      ...input,
      direction: normalizedDirection(input.direction),
      confidence: normalizedConfidence(input.confidence)
    };

    if (analysis.setup === "STRETCHED_CANDLE") {
      candidate = null;
      if (stable && analysis.blockedDirection === stable.direction) {
        const candle = analysis?.technical?.lastCandle;
        entryBlock ||= {
          direction: stable.direction,
          since: timestamp,
          candleX: Number(candle?.centerX),
          candleWidth: Number(candle?.width)
        };
        return blockedView(analysis);
      }
      stable = null;
      return { ...analysis, direction: "WAIT", stability: "checking", transition: null };
    }

    if (analysis.setup === "INTRACANDLE_REVERSAL" && analysis.urgentReversal) {
      const nextCandidate = rememberCandidate(analysis, timestamp);
      const confirmed = nextCandidate.hits >= 2 && timestamp - nextCandidate.since >= 700;
      if (confirmed) return promote(analysis, timestamp);
      const transition = {
        direction: analysis.direction,
        confidence: analysis.confidence,
        hits: nextCandidate.hits,
        elapsedMs: timestamp - nextCandidate.since,
        requiredMs: 700,
        requiredHits: 2,
        holdRemainingMs: 0
      };
      if (stable) return entryBlock ? blockedView(analysis, transition) : { ...stable, stability: "checking", transition };
      return {
        ...analysis,
        direction: "WAIT",
        stability: "checking",
        transition
      };
    }

    let entryOpportunityRenewed = false;
    if (entryBlock) {
      if (!movedToNewCandle(analysis, timestamp)) {
        candidate = null;
        return blockedView(analysis);
      }
      entryOpportunityRenewed = analysis.direction === stable?.direction && analysis.confidence >= 62;
      entryBlock = null;
    }

    if (!stable) {
      if (analysis.direction === "WAIT" || analysis.confidence < 62) {
        candidate = null;
        return waitingAnalysis();
      }
      const nextCandidate = rememberCandidate(analysis, timestamp);
      const confirmed = nextCandidate.hits >= initialHits && timestamp - nextCandidate.since >= initialConfirmMs;
      return confirmed ? promote(analysis, timestamp) : waitingAnalysis(nextCandidate);
    }

    if (analysis.direction === stable.direction) {
      candidate = null;
      const confidence = Math.round((stable.confidence * .72) + (analysis.confidence * .28));
      stable = { ...stable, ...analysis, confidence, since: stable.since };
      return { ...stable, stability: "stable", transition: null, ...(entryOpportunityRenewed ? { entryOpportunityRenewed: true } : {}) };
    }

    if (analysis.direction === "WAIT") {
      candidate = null;
      return {
        ...stable,
        stability: "checking",
        transition: {
          direction: "WAIT",
          confidence: analysis.confidence,
          hits: 0,
          elapsedMs: 0,
          requiredMs: null,
          requiredHits: null,
          holdRemainingMs: 0
        }
      };
    }

    const nextCandidate = rememberCandidate(analysis, timestamp);
    const candidateAge = timestamp - nextCandidate.since;
    const stableAge = timestamp - stable.since;
    const requiredMs = switchConfirmMs;
    const requiredHits = switchHits;
    const confidenceEnough = nextCandidate.analysis.confidence >= 62;
    const confirmed = stableAge >= minHoldMs
      && candidateAge >= requiredMs
      && nextCandidate.hits >= requiredHits
      && confidenceEnough;

    if (confirmed) return promote(analysis, timestamp);

    return {
      ...stable,
      stability: "checking",
      transition: {
        direction: nextCandidate.direction,
        confidence: nextCandidate.analysis.confidence,
        hits: nextCandidate.hits,
        elapsedMs: candidateAge,
        requiredMs,
        requiredHits,
        holdRemainingMs: Math.max(0, minHoldMs - stableAge)
      }
    };
  }

  return {
    update,
    reset,
    snapshot: () => ({ asset, stable: stable ? { ...stable } : null, candidate: candidate ? { ...candidate } : null, entryBlock: entryBlock ? { ...entryBlock } : null })
  };
}
