export function minuteValue(value) {
  const match = String(value || "").toLowerCase().match(/\b(\d{1,2})\s*(?:m|min|minuto(?:s)?)\b/);
  return match ? Number(match[1]) : null;
}

export function minuteFromOcr(value) {
  const normalized = String(value || "").toUpperCase().replace(/[IL|]/g, "1");
  const matches = [...normalized.matchAll(/\b([15])\s*M(?:1N|IN)?\b/g)].map(match => Number(match[1]));
  const distinct = [...new Set(matches)];
  return distinct.length === 1 ? distinct[0] : null;
}

export function createMinuteReadingStabilizer(options = {}) {
  const requiredHits = options.requiredHits ?? 2;
  const warningHits = options.warningHits ?? 6;
  const immediateInitialMismatch = options.immediateInitialMismatch === true;
  const staleAfterMs = options.staleAfterMs ?? 15000;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  let stable = null;
  let candidate = null;
  let candidateHits = 0;
  let lastValidAt = 0;

  function reset() {
    stable = null;
    candidate = null;
    candidateHits = 0;
    lastValidAt = 0;
  }

  function update(value) {
    const timestamp = now();
    if (![1, 5].includes(value)) {
      candidate = null;
      candidateHits = 0;
      if (stable != null && timestamp - lastValidAt >= staleAfterMs) stable = null;
      return stable;
    }
    lastValidAt = timestamp;
    if (value === stable) {
      candidate = null;
      candidateHits = 0;
      return stable;
    }
    if (value !== candidate) {
      candidate = value;
      candidateHits = 1;
      if (stable == null && value === 1 && immediateInitialMismatch) {
        stable = value;
        candidate = null;
        candidateHits = 0;
      }
      return stable;
    }
    candidateHits += 1;
    const hitsNeeded = stable === 5 && candidate === 1 ? warningHits : requiredHits;
    if (candidateHits >= hitsNeeded) {
      stable = candidate;
      candidate = null;
      candidateHits = 0;
    }
    return stable;
  }

  return { update, reset };
}

export function createSetupWarningTracker(options = {}) {
  const storage = options.storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  const storageKey = options.storageKey || "atlas-setup-warning-shown-v1";
  let shownWithoutStorage = false;
  let active = null;

  function wasShownInThisTab() {
    try { return storage ? storage.getItem(storageKey) === "1" : shownWithoutStorage; }
    catch { return shownWithoutStorage; }
  }

  function rememberShownInThisTab() {
    shownWithoutStorage = true;
    try { storage?.setItem(storageKey, "1"); }
    catch { /* A memória local do rastreador ainda evita repetições. */ }
  }

  function update({ asset, timeframe, expiration } = {}) {
    const normalizedAsset = String(asset || "").trim().toUpperCase();
    if (!normalizedAsset) {
      active = null;
      return [];
    }

    const issues = [];
    const timeframeMinutes = minuteValue(timeframe);
    const expirationMinutes = minuteValue(expiration);
    if (timeframeMinutes != null && timeframeMinutes !== 5) {
      issues.push({
        id: "timeframe",
        title: "Ajuste o gráfico",
        message: "Coloque o gráfico em 5m (5 minutos).",
        detail: `O gráfico está em ${timeframeMinutes}m. O Atlas usa velas de cinco minutos para manter a leitura consistente.`
      });
    }
    if (expirationMinutes != null && expirationMinutes !== 5) {
      issues.push({
        id: "expiration",
        title: "Ajuste a expiração",
        message: "Coloque a expiração em 5 minutos.",
        detail: `A expiração está em ${expirationMinutes} minuto${expirationMinutes === 1 ? "" : "s"}. Ela deve acompanhar o gráfico em 5M.`
      });
    }
    if (active) {
      if (active.asset !== normalizedAsset) {
        active = null;
        return [];
      }
      const current = issues.find(issue => issue.id === active.issue.id);
      if (!current) {
        active = null;
        return [];
      }
      active.issue = current;
      return [current];
    }

    if (wasShownInThisTab() || issues.length === 0) return [];
    active = { asset: normalizedAsset, issue: issues[0] };
    rememberShownInThisTab();
    return [issues[0]];
  }

  function dismiss(id) {
    if (!active || active.issue.id !== id) return;
    active = null;
  }

  return { update, dismiss };
}
