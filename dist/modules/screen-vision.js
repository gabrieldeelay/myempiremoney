const ASSETS = [
  "BITCOIN", "ETHEREUM", "SOLANA", "CARDANO", "LITECOIN", "AVAX", "DOGE", "SUI",
  "XRP", "XPL", "STELLAR", "BNB", "TRON", "POLKADOT", "CHAINLINK", "BITCOIN CASH",
  "META", "TESLA", "MICROSOFT", "APPLE", "NETFLIX"
];
const ASSETS_BY_LENGTH = [...ASSETS].sort((left, right) => right.length - left.length);

const FIAT = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD", "CHF"];

function pixelOffset(width, x, y) {
  return (y * width + x) * 4;
}

function isActiveBlue(r, g, b) {
  return b > 145 && g > 65 && b > r * 1.35 && b > g * 1.04;
}

function candleColor(r, g, b) {
  if (g >= 95 && g - r >= 34 && g - b >= 18) return "BUY";
  if (r >= 135 && r - g >= 38 && r - b >= 12) return "SELL";
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

export function fuzzyMatchAsset(value = "") {
  const rawText = String(value).toUpperCase();
  const rawTokens = rawText.split(/[^A-Z0-9]+/).filter(token => token.length >= 3);
  for (const token of rawTokens) {
    if (/^[8B][NMH][8B]$/.test(token) || /^(?:BN8|8NB|BMB)$/.test(token)) return "BNB";
    if (/^XP(?:L|I|1)$/.test(token)) return "XPL";
  }
  const text = rawText.replace(/[|]/g, "I");
  const compact = text.replace(/[^A-Z]/g, "");
  const tokens = text.split(/[^A-Z]+/).filter(token => token.length >= 3);
  for (const left of FIAT) {
    for (const right of FIAT) {
      if (left !== right && compact.includes(`${left}${right}`)) return `${left}/${right}`;
    }
  }
  for (const asset of ASSETS_BY_LENGTH) {
    const compactAsset = asset.replace(/[^A-Z]/g, "");
    if (compactAsset.length <= 3 ? tokens.includes(compactAsset) : compact.includes(compactAsset)) return asset;
  }

  let best = null;
  for (const token of tokens) {
    for (const asset of ASSETS_BY_LENGTH) {
      if (asset.length <= 3) continue;
      const variants = [token];
      if (token.length > asset.length) {
        for (let start = 0; start <= token.length - Math.max(3, asset.length - 2); start += 1) {
          for (let length = Math.max(3, asset.length - 2); length <= Math.min(token.length - start, asset.length + 2); length += 1) {
            variants.push(token.slice(start, start + length));
          }
        }
      }
      for (const variant of variants) {
        const distance = editDistance(variant, asset);
        const similarity = 1 - distance / Math.max(variant.length, asset.length);
        if (!best || similarity > best.similarity) best = { asset, similarity };
      }
    }
  }

  let bestFiat = null;
  const forexSources = [compact, ...tokens].filter(value => value.length >= 5);
  for (const source of forexSources) {
    for (const length of [5, 6, 7]) {
      for (let start = 0; start <= source.length - length; start += 1) {
        const candidate = source.slice(start, start + length);
        for (const left of FIAT) {
          for (const right of FIAT) {
            if (left === right) continue;
            const pair = `${left}${right}`;
            const distance = editDistance(candidate, pair);
            const similarity = 1 - distance / Math.max(candidate.length, pair.length);
            if (!bestFiat || similarity > bestFiat.similarity) bestFiat = { asset: `${left}/${right}`, similarity };
          }
        }
      }
    }
  }
  if (bestFiat?.similarity >= .66 && bestFiat.similarity >= (best?.similarity || 0)) return bestFiat.asset;
  return best?.similarity >= .58 ? best.asset : null;
}

export function findActiveTabRect(data, width, height) {
  if (!data?.length || !width || !height) return null;
  const startX = Math.floor(width * .045);
  const endX = Math.floor(width * .72);
  const startY = Math.floor(height * .1);
  const endY = Math.floor(height * .3);
  const minRun = Math.max(14, Math.floor(width * .014));
  const maxRun = Math.floor(width * .18);
  let best = null;

  for (let y = startY; y < endY; y += 1) {
    let runStart = -1;
    let lastMatch = -1;
    for (let x = startX; x <= endX; x += 1) {
      const offset = pixelOffset(width, x, y);
      const matches = x < endX && isActiveBlue(data[offset], data[offset + 1], data[offset + 2]);
      if (matches) {
        if (runStart < 0) runStart = x;
        lastMatch = x;
      }
      if (runStart >= 0 && (!matches && x - lastMatch > 3 || x === endX)) {
        const runWidth = lastMatch - runStart + 1;
        if (runWidth >= minRun && runWidth <= maxRun) {
          const score = runWidth + y / height * 8;
          if (!best || score > best.score) best = { x: runStart, y, width: runWidth, score };
        }
        runStart = -1;
      }
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, width: best.width, height: Math.max(34, Math.round(height * .075)) };
}

function collectBodiesForColor(data, width, bounds, direction) {
  const chartHeight = bounds.bottom - bounds.top;
  const minColumnPixels = Math.max(3, Math.floor(chartHeight * .007));
  const activeColumns = [];
  for (let x = bounds.left; x < bounds.right; x += 1) {
    let count = 0;
    for (let y = bounds.top; y < bounds.bottom; y += 1) {
      const offset = pixelOffset(width, x, y);
      if (candleColor(data[offset], data[offset + 1], data[offset + 2]) === direction) count += 1;
    }
    if (count >= minColumnPixels) activeColumns.push(x);
  }

  const groups = [];
  let start = null;
  let previous = null;
  for (const x of activeColumns) {
    if (start == null) start = x;
    else if (x - previous > 2) {
      groups.push([start, previous]);
      start = x;
    }
    previous = x;
  }
  if (start != null) groups.push([start, previous]);

  return groups.map(([x0, x1]) => {
    let wickTop = bounds.bottom;
    let wickBottom = bounds.top;
    let y0 = bounds.bottom;
    let y1 = bounds.top;
    let pixels = 0;
    const bodyWidth = x1 - x0 + 1;
    for (let y = bounds.top; y < bounds.bottom; y += 1) {
      let rowPixels = 0;
      for (let x = x0; x <= x1; x += 1) {
        const offset = pixelOffset(width, x, y);
        if (candleColor(data[offset], data[offset + 1], data[offset + 2]) !== direction) continue;
        rowPixels += 1;
      }
      if (!rowPixels) continue;
      wickTop = Math.min(wickTop, y);
      wickBottom = Math.max(wickBottom, y);
      if (rowPixels < Math.max(3, Math.ceil(bodyWidth * .55))) continue;
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      pixels += rowPixels;
    }
    const bodyHeight = y1 - y0 + 1;
    const density = pixels / Math.max(1, bodyWidth * bodyHeight);
    return { direction, x0, x1, y0, y1, width: bodyWidth, height: bodyHeight, density,
      upperWick: Math.max(0, y0 - wickTop), lowerWick: Math.max(0, wickBottom - y1),
      centerX: (x0 + x1) / 2 };
  }).filter(body => body.width >= 3
    && body.width <= Math.max(48, width * .055)
    && body.height >= 5
    && body.density >= .14);
}

export function extractCandleBodies(data, width, height) {
  if (!data?.length || !width || !height) return [];
  const bounds = {
    left: Math.floor(width * .075),
    right: Math.floor(width * .78),
    top: Math.floor(height * .235),
    bottom: Math.floor(height * .79)
  };
  const bodies = [
    ...collectBodiesForColor(data, width, bounds, "BUY"),
    ...collectBodiesForColor(data, width, bounds, "SELL")
  ].sort((a, b) => a.centerX - b.centerX);

  const merged = [];
  for (const body of bodies) {
    const previous = merged.at(-1);
    if (previous && previous.direction === body.direction && body.x0 <= previous.x1 + 2) {
      previous.x1 = Math.max(previous.x1, body.x1);
      previous.y0 = Math.min(previous.y0, body.y0);
      previous.y1 = Math.max(previous.y1, body.y1);
      previous.width = previous.x1 - previous.x0 + 1;
      previous.height = previous.y1 - previous.y0 + 1;
      previous.centerX = (previous.x0 + previous.x1) / 2;
      previous.upperWick = Math.max(previous.upperWick || 0, body.upperWick || 0);
      previous.lowerWick = Math.max(previous.lowerWick || 0, body.lowerWick || 0);
    } else merged.push({ ...body });
  }
  const minimumBodyHeight = Math.max(6, Math.floor(height * .014));
  return merged.filter(body => body.centerX > width * .18
    && body.centerX < width * .755
    && body.height >= minimumBodyHeight).slice(-12);
}

export function classifyCandleSequence(bodies = []) {
  const recent = bodies.slice(-10);
  if (recent.length < 3) {
    return {
      direction: "WAIT",
      confidence: 0,
      chartDetected: recent.length > 0,
      score: 0,
      candleCount: recent.length,
      entryTiming: "WAIT_CONFIRMATION",
      factors: ["Ainda não há velas reconhecíveis suficientes para comparar direção, força e exaustão."],
      reason: "Leitura visual ativa, aguardando mais velas reconhecíveis."
    };
  }

  const closes = recent.map(body => body.direction === "BUY" ? body.y0 : body.y1);
  const heights = recent.map(body => Math.max(5, body.height));
  const last = recent.at(-1);
  const previous = recent.slice(0, -1);
  const previousHeights = previous.map(body => Math.max(5, body.height));
  const previousCloses = previous.map(body => body.direction === "BUY" ? body.y0 : body.y1);
  const averagePreviousHeight = Math.max(5, average(previousHeights));
  const spikeRatio = last.height / averagePreviousHeight;
  const lastClose = last.direction === "BUY" ? last.y0 : last.y1;
  const closeStretch = last.direction === "BUY"
    ? (average(previousCloses) - lastClose) / averagePreviousHeight
    : (lastClose - average(previousCloses)) / averagePreviousHeight;
  const previousExtremeClose = last.direction === "BUY" ? Math.min(...previousCloses) : Math.max(...previousCloses);
  const extremeBreak = last.direction === "BUY"
    ? (previousExtremeClose - lastClose) / averagePreviousHeight
    : (lastClose - previousExtremeClose) / averagePreviousHeight;
  const referenceLevel = last.direction === "BUY"
    ? Math.min(...previous.map(body => body.y0))
    : Math.max(...previous.map(body => body.y1));
  const lastExtreme = last.direction === "BUY" ? last.y0 : last.y1;
  const levelDistance = Math.abs(lastExtreme - referenceLevel) / averagePreviousHeight;
  const levelTouch = levelDistance <= .5 || extremeBreak >= .1;
  const recentSameSide = previous.slice(-4).filter(body => body.direction === last.direction).length;
  const impulseStretch = spikeRatio >= 1.35
    && closeStretch >= .55
    && extremeBreak >= .28
    && (recentSameSide >= 1 || spikeRatio >= 1.65);
  const matureRunStretch = recent.length >= 6
    && recentSameSide >= 2
    && closeStretch >= .68
    && extremeBreak >= -.05;
  const extremeBodyStretch = recent.length >= 6
    && spikeRatio >= 1.65
    && closeStretch >= .9
    && extremeBreak >= -.05;
  const levelExhaustion = levelTouch
    && spikeRatio >= 1.28
    && closeStretch >= .48
    && recentSameSide >= 1;
  const contextualExhaustion = recent.length >= 4
    && levelTouch
    && spikeRatio >= 1.32
    && closeStretch >= .32
    && (recentSameSide >= 1 || extremeBreak >= .12 || spikeRatio >= 1.45);
  const stretchedCandle = impulseStretch || matureRunStretch || extremeBodyStretch || levelExhaustion || contextualExhaustion;
  const technical = {
    lastCandle: { direction: last.direction, centerX: last.centerX, width: last.width, height: last.height },
    averagePreviousHeight,
    spikeRatio,
    closeStretch,
    extremeBreak,
    levelDistance,
    levelTouch,
    upperWickRatio: (Number(last.upperWick) || 0) / Math.max(1, last.height),
    lowerWickRatio: (Number(last.lowerWick) || 0) / Math.max(1, last.height)
  };
  const rejectionWick = last.direction === "BUY" ? technical.upperWickRatio : technical.lowerWickRatio;
  if (recent.length >= 4 && levelTouch && recentSameSide >= 1
    && last.height >= averagePreviousHeight * .65
    && rejectionWick >= .55) {
    const reversalDirection = last.direction === "BUY" ? "SELL" : "BUY";
    const side = reversalDirection === "BUY" ? "compra" : "venda";
    return {
      direction: reversalDirection,
      confidence: Math.round(clamp(54 + rejectionWick * 7 + recentSameSide * 2, 55, 69)),
      chartDetected: true, score: 0, candleCount: recent.length,
      setup: "INTRACANDLE_REVERSAL", entryTiming: "CURRENT_CANDLE",
      technical,
      factors: [
        `Pavio de rejeição com ${rejectionWick.toFixed(1)}x o corpo da vela atual.`,
        `O preço testou uma região recente de ${last.direction === "BUY" ? "resistência" : "suporte"}.`,
        `A reação ainda é preliminar; confirme a força antes de considerar ${side}.`
      ],
      reason: `Rejeição visual em região recente: provável ${side} nesta vela, sujeita à confirmação.`
    };
  }
  if (stretchedCandle) {
    const reversalDirection = last.direction === "BUY" ? "SELL" : "BUY";
    const stretchedSide = last.direction === "BUY" ? "compradora" : "vendedora";
    const blockedSide = last.direction === "BUY" ? "compra" : "venda";
    const correctionSide = reversalDirection === "BUY" ? "compra" : "venda";
    return {
      direction: "WAIT",
      confidence: Math.round(clamp(54 + (spikeRatio - 1.35) * 8 + (extremeBreak - .28) * 5, 54, 61)),
      chartDetected: true,
      score: 0,
      candleCount: recent.length,
      setup: "STRETCHED_CANDLE",
      blockedDirection: last.direction,
      reversalDirection,
      entryTiming: "WAIT_CONFIRMATION",
      technical,
      factors: [
        `A última vela é ${spikeRatio.toFixed(1)}x maior que a média recente.`,
        `O preço avançou ${Math.max(0, extremeBreak).toFixed(1)} corpos médios além do extremo recente.`,
        `O movimento alcançou uma região recente de ${last.direction === "BUY" ? "resistência" : "suporte"}.`,
        `A pressão ${stretchedSide} está esticada; entrar em ${blockedSide} agora seria perseguir um movimento atrasado.`,
        `O Atlas só considerará ${correctionSide} nesta vela se o corpo rejeitar parte relevante do movimento ou trocar de direção.`
      ],
      reason: `Vela ${stretchedSide} muito esticada. ${blockedSide[0].toUpperCase()}${blockedSide.slice(1)} tardia bloqueada; aguardando rejeição técnica para provável ${correctionSide}.`
    };
  }
  const split = Math.max(1, Math.floor(recent.length / 2));
  const oldClose = average(closes.slice(0, split));
  const newClose = average(closes.slice(split));
  const normalizedMove = clamp((oldClose - newClose) / Math.max(8, average(heights)), -1, 1);
  let voteTotal = 0;
  let voteWeight = 0;
  recent.forEach((body, index) => {
    const weight = .55 + .45 * ((index + 1) / recent.length);
    voteTotal += (body.direction === "BUY" ? 1 : -1) * weight;
    voteWeight += weight;
  });
  const colorVote = voteTotal / voteWeight;
  const score = clamp(normalizedMove * .68 + colorVote * .32, -1, 1);
  const direction = score >= .16 ? "BUY" : score <= -.16 ? "SELL" : "WAIT";
  const confidence = direction === "WAIT"
    ? Math.round(42 + Math.abs(score) * 35)
    : Math.round(clamp(57 + Math.abs(score) * 34 + Math.min(8, recent.length), 0, 91));
  const recentAgreement = recent.slice(-3).filter(body => body.direction === direction).length;
  const currentCandleEntry = direction !== "WAIT"
    && Math.abs(score) >= .3
    && last.direction === direction
    && recentAgreement >= 2
    && last.height >= averagePreviousHeight * .65
    && spikeRatio <= 1.35;
  const entryTiming = direction === "WAIT" ? "WAIT_CONFIRMATION" : currentCandleEntry ? "CURRENT_CANDLE" : "NEXT_CANDLE";
  const reason = direction === "BUY"
    ? `Leitura visual: ${recent.length} velas recentes mostram fechamentos e pressão para cima.`
    : direction === "SELL"
      ? `Leitura visual: ${recent.length} velas recentes mostram fechamentos e pressão para baixo.`
      : `Leitura visual: as ${recent.length} velas recentes ainda estão sem direção confirmada.`;
  const buyerShare = recent.filter(body => body.direction === "BUY").length / recent.length;
  const factors = [
    `Deslocamento dos fechamentos: ${normalizedMove >= 0 ? "para cima" : "para baixo"} (${Math.round(Math.abs(normalizedMove) * 100)}%).`,
    `Distribuição das velas: ${Math.round(buyerShare * 100)}% compradoras e ${Math.round((1 - buyerShare) * 100)}% vendedoras.`,
    `Força combinada de deslocamento e sequência: ${Math.round(Math.abs(score) * 100)}%.`,
    direction === "WAIT"
      ? "A entrada deve esperar uma nova confirmação."
      : currentCandleEntry
        ? "A sequência e a vela atual estão alinhadas; a leitura vale para esta vela, escolhendo com cuidado o melhor momento de entrada."
        : "A leitura ainda precisa do fechamento atual; prepare a entrada somente para a próxima vela."
  ];
  return {
    direction,
    confidence,
    chartDetected: true,
    score,
    candleCount: recent.length,
    setup: "TREND_CONTINUATION",
    entryTiming,
    technical,
    factors,
    reason
  };
}

export function createIntracandleReversalTracker(options = {}) {
  const retracementThreshold = options.retracementThreshold ?? .1;
  const flipBodyRatio = options.flipBodyRatio ?? .16;
  let watch = null;

  function reset() {
    watch = null;
  }

  function update(input = null, asset = "") {
    if (!input) return input;
    const candle = input.technical?.lastCandle;
    const normalizedAsset = String(asset || "").trim().toUpperCase();
    if (!candle) {
      reset();
      return input;
    }

    const sameCandle = watch
      && watch.asset === normalizedAsset
      && Math.abs(Number(candle.centerX) - watch.centerX) <= Math.max(5, watch.width * .7);
    if (!sameCandle) watch = null;

    if (!watch && input.setup === "STRETCHED_CANDLE") {
      watch = {
        asset: normalizedAsset,
        centerX: Number(candle.centerX),
        width: Math.max(1, Number(candle.width) || 1),
        direction: input.blockedDirection,
        reversalDirection: input.reversalDirection,
        peakHeight: Number(candle.height) || 0,
        averagePreviousHeight: Number(input.technical.averagePreviousHeight) || 1,
        factors: [...(input.factors || [])]
      };
    }
    if (!watch) return input;

    watch.peakHeight = Math.max(watch.peakHeight, Number(candle.height) || 0);
    const flipped = candle.direction !== watch.direction
      && Number(candle.height) >= watch.averagePreviousHeight * flipBodyRatio;
    const retracement = candle.direction === watch.direction
      ? Math.max(0, (watch.peakHeight - Number(candle.height)) / Math.max(1, watch.peakHeight))
      : 1;
    const rejected = flipped || retracement >= retracementThreshold;
    if (rejected) {
      const directionLabel = watch.reversalDirection === "BUY" ? "compra" : "venda";
      const rejectionLabel = flipped
        ? "A vela trocou de direção depois do movimento esticado."
        : `O corpo devolveu ${Math.round(retracement * 100)}% depois de atingir o extremo.`;
      return {
        ...input,
        direction: watch.reversalDirection,
        confidence: Math.round(clamp(68 + (flipped ? 6 : 0) + retracement * 35, 68, 84)),
        setup: "INTRACANDLE_REVERSAL",
        blockedDirection: watch.direction,
        entryTiming: "CURRENT_CANDLE",
        urgentReversal: true,
        factors: [
          ...watch.factors,
          rejectionLabel,
          `A reversão tem fundamento técnico para provável ${directionLabel} nesta vela, mas o ponto de entrada ainda deve ser escolhido com cuidado.`
        ],
        reason: `Rejeição confirmada após movimento esticado: provável ${directionLabel} ainda nesta vela.`
      };
    }

    return {
      ...input,
      direction: "WAIT",
      confidence: Math.min(61, Number(input.confidence) || 58),
      setup: "STRETCHED_CANDLE",
      blockedDirection: watch.direction,
      reversalDirection: watch.reversalDirection,
      entryTiming: "WAIT_CONFIRMATION",
      factors: watch.factors,
      reason: `Movimento esticado detectado. Entrada atrasada bloqueada; aguardando rejeição real antes de considerar a direção contrária.`
    };
  }

  return { update, reset };
}

export function analyzeChartPixels(data, width, height) {
  const bodies = extractCandleBodies(data, width, height);
  return { ...classifyCandleSequence(bodies), source: "screen-capture", bodies };
}
