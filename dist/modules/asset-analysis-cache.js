const STORAGE_KEY = "atlas-asset-analysis-cache-v2";
const LAST_ASSET_KEY = "atlas-last-recognized-asset-v1";

const assetKey = value => String(value || "").trim().toUpperCase();

function readJson(storage, key, fallback) {
  try {
    return JSON.parse(storage?.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

export function createAssetAnalysisCache(options = {}) {
  const storage = options.storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const liveTtlMs = options.liveTtlMs ?? 120000;
  const trendTtlMs = options.trendTtlMs ?? 60000;
  const records = new Map(Object.entries(readJson(storage, STORAGE_KEY, {})));

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(records)));
    } catch {
      // O cache em memória continua funcionando quando o navegador bloqueia storage.
    }
  }

  function getRecord(asset) {
    return records.get(assetKey(asset)) || null;
  }

  function rememberTrend(asset, trend, updatedAt = null) {
    const key = assetKey(asset);
    if (!key || !trend) return null;
    const current = getRecord(key) || {};
    const previousDirection = String(current.trend?.direction || "WAIT").toUpperCase();
    const nextDirection = String(trend.direction || "WAIT").toUpperCase();
    const scoreDelta = Math.abs((Number(trend.score) || 0) - (Number(current.trend?.score) || 0));
    const meaningfulChange = Boolean(current.trend)
      && (previousDirection !== nextDirection || scoreDelta >= 8);
    const record = {
      ...current,
      trend: { ...trend },
      trendUpdatedAt: updatedAt || trend.updatedAt || new Date(now()).toISOString(),
      trendSeenAt: now(),
      ...(meaningfulChange ? { live: null, liveSeenAt: 0, rendered: null, renderedAt: 0 } : {})
    };
    records.set(key, record);
    persist();
    return { ...record };
  }

  function rememberState(asset, value = {}) {
    const key = assetKey(asset);
    if (!key) return null;
    const current = getRecord(key) || {};
    const record = {
      ...current,
      live: value.analysis ? { ...value.analysis } : current.live,
      timeframe: value.timeframe ?? current.timeframe ?? null,
      expiration: value.expiration ?? current.expiration ?? null,
      chartDetected: value.chartDetected ?? current.chartDetected ?? false,
      lastInspectionAt: value.lastInspectionAt ?? current.lastInspectionAt ?? null,
      liveSeenAt: now(),
      rendered: value.rendered ? { ...value.rendered } : current.rendered,
      renderedAt: value.rendered ? now() : current.renderedAt
    };
    records.set(key, record);
    setLastAsset(key);
    persist();
    return { ...record };
  }

  function trend(asset) {
    const record = getRecord(asset);
    if (!record?.trend || now() - Number(record.trendSeenAt || 0) > trendTtlMs) return null;
    return { ...record.trend, updatedAt: record.trendUpdatedAt };
  }

  function state(asset) {
    const record = getRecord(asset);
    if (!record || (!record.live && !record.rendered) || now() - Number(record.liveSeenAt || 0) > liveTtlMs) return null;
    return {
      analysis: record.live ? { ...record.live } : null,
      rendered: record.rendered ? { ...record.rendered } : null,
      timeframe: record.timeframe ?? null,
      expiration: record.expiration ?? null,
      chartDetected: Boolean(record.chartDetected),
      lastInspectionAt: record.lastInspectionAt ?? null,
      ageMs: now() - Number(record.liveSeenAt || 0)
    };
  }

  function setLastAsset(asset) {
    const key = assetKey(asset);
    if (!key || !storage) return;
    try { storage.setItem(LAST_ASSET_KEY, key); } catch { /* memória ainda funciona */ }
  }

  function lastAsset() {
    try { return assetKey(storage?.getItem(LAST_ASSET_KEY)); } catch { return ""; }
  }

  return { rememberTrend, rememberState, trend, state, setLastAsset, lastAsset };
}

