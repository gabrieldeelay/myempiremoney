const MIN_HISTORY = 55;
const MIN_CALIBRATION = 30;

function band(score) {
  const strength = Math.abs(Number(score) || 0);
  return strength < 35 ? "weak" : strength < 60 ? "medium" : "strong";
}

function summarize(records) {
  const decided = records.filter(record => record.correct != null);
  const correct = decided.filter(record => record.correct).length;
  const count = decided.length;
  return { count, correct, wrong: count - correct, accuracy: count ? Math.round(correct / count * 100) : null };
}

function calibratedRate(records, direction, score) {
  const sameBand = records.filter(record => record.direction === direction && record.band === band(score));
  const sample = sameBand.length >= MIN_CALIBRATION
    ? sameBand
    : records.filter(record => record.direction === direction);
  const result = summarize(sample);
  if (result.count < MIN_CALIBRATION) return { ...result, calibrated: false, probability: null };
  // A small prior keeps a sample of 30 from being presented as certainty.
  return { ...result, calibrated: true, probability: Math.round((result.correct + 2) / (result.count + 4) * 100) };
}

function normalizeCandle(candle) {
  if (Array.isArray(candle)) {
    return { open: candle[1] == null ? NaN : Number(candle[1]), close: candle[4] == null ? NaN : Number(candle[4]), time: Number(candle[0]) };
  }
  return { open: candle?.open == null ? NaN : Number(candle.open), close: candle?.close == null ? NaN : Number(candle.close), time: Number(candle?.time) };
}

function validateNextCandles(candles, predict) {
  const bars = candles.map(normalizeCandle).filter(bar => Number.isFinite(bar.open) && Number.isFinite(bar.close));
  const records = [];
  for (let index = MIN_HISTORY; index < bars.length - 1; index += 1) {
    const prediction = predict(bars.slice(0, index + 1).map(bar => bar.close));
    if (!["BUY", "SELL"].includes(prediction.direction)) continue;
    const next = bars[index + 1];
    const delta = next.close - next.open;
    const prior = calibratedRate(records, prediction.direction, prediction.score);
    records.push({
      time: next.time || null,
      direction: prediction.direction,
      band: band(prediction.score),
      score: prediction.score,
      probability: prior.probability,
      outcome: delta > 0 ? "BUY" : delta < 0 ? "SELL" : "DRAW",
      correct: delta === 0 ? null : (prediction.direction === "BUY" ? delta > 0 : delta < 0)
    });
  }
  const latest = predict(bars.map(bar => bar.close));
  const calibration = calibratedRate(records, latest.direction, latest.score);
  const overall = summarize(records);
  const byDirection = {
    BUY: summarize(records.filter(record => record.direction === "BUY")),
    SELL: summarize(records.filter(record => record.direction === "SELL"))
  };
  return {
    latest,
    confidence: calibration.probability,
    calibrated: calibration.calibrated,
    sampleSize: calibration.count,
    validation: {
      method: "walk-forward-5m",
      overall,
      byDirection,
      invertedAccuracy: overall.count ? 100 - overall.accuracy : null,
      recent: records.slice(-12)
    }
  };
}

module.exports = { validateNextCandles, calibratedRate, summarize };
