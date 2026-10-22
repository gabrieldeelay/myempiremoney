export function minuteValue(value) {
  const match = String(value || "").toLowerCase().match(/\b(\d{1,2})\s*(?:m|min|minuto(?:s)?)\b/);
  return match ? Number(match[1]) : null;
}

export function minuteFromOcr(value) {
  const normalized = String(value || "").toUpperCase().replace(/[IL|]/g, "1");
  const match = normalized.match(/\b([15])\s*M(?:1N|IN)?\b/);
  return match ? Number(match[1]) : null;
}

export function createSetupWarningTracker() {
  let currentAsset = "";
  const dismissed = new Set();

  function update({ asset, timeframe, expiration } = {}) {
    const normalizedAsset = String(asset || "").trim().toUpperCase();
    if (normalizedAsset !== currentAsset) {
      currentAsset = normalizedAsset;
      dismissed.clear();
    }
    if (!currentAsset) return [];

    const issues = [];
    const timeframeMinutes = minuteValue(timeframe);
    const expirationMinutes = minuteValue(expiration);
    if (timeframeMinutes != null && timeframeMinutes !== 5 && !dismissed.has("timeframe")) {
      issues.push({
        id: "timeframe",
        title: "Ajuste o gráfico",
        message: "Coloque o gráfico em 5m (5 minutos).",
        detail: `O gráfico está em ${timeframeMinutes}m. O Atlas usa velas de cinco minutos para manter a leitura consistente.`
      });
    }
    if (expirationMinutes != null && expirationMinutes !== 5 && !dismissed.has("expiration")) {
      issues.push({
        id: "expiration",
        title: "Ajuste a expiração",
        message: "Coloque a expiração em 5 minutos.",
        detail: `A expiração está em ${expirationMinutes} minuto${expirationMinutes === 1 ? "" : "s"}. Ela deve acompanhar o gráfico em 5M.`
      });
    }
    return issues;
  }

  function dismiss(id, asset) {
    if (String(asset || "").trim().toUpperCase() !== currentAsset) return;
    if (["timeframe", "expiration"].includes(id)) dismissed.add(id);
  }

  return { update, dismiss };
}
