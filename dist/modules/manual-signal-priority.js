export function manualSignalIsActive(signal, now = Date.now()) {
  return Boolean(signal?.id) && Number(signal.clientExpiresAtMs || 0) > Number(now);
}

export function shouldReleaseManualSignal(signal, options = {}) {
  if (!signal?.id) return false;
  if (options.signalId && options.signalId !== signal.id) return false;
  if (options.force === true) return true;
  return !manualSignalIsActive(signal, options.now ?? Date.now());
}

export function keepManualSignalAfterPoll(signal, options = {}) {
  if (!manualSignalIsActive(signal, options.now ?? Date.now())) return false;
  const normalize = typeof options.normalize === "function"
    ? options.normalize
    : value => String(value || "").trim().toUpperCase();
  return normalize(signal.asset) === normalize(options.asset);
}
