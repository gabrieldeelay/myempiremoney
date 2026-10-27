function directional(view = {}) {
  return ["BUY", "SELL"].includes(String(view.direction || "WAIT").toUpperCase());
}

export function createSignalCandleLock() {
  const locked = new Map();

  function resolve({ asset = "", pane = "current", cycleKey = "", view = {} } = {}) {
    const key = `${String(asset).toUpperCase()}|${pane}`;
    const direction = String(view.direction || "WAIT").toUpperCase();
    const previous = locked.get(key);

    if (!cycleKey || !asset) return { ...view };

    if (!previous || previous.cycleKey !== cycleKey) {
      if (!directional(view)) {
        locked.delete(key);
        return { ...view };
      }
      const first = { ...view, direction };
      locked.set(key, { cycleKey, view: first });
      return first;
    }

    if (!directional(view) || direction !== previous.view.direction) {
      return { ...previous.view, heldByCandle: true };
    }

    const upgraded = {
      ...previous.view,
      ...view,
      direction,
      confidence: Math.max(Number(previous.view.confidence) || 0, Number(view.confidence) || 0),
      possible: previous.view.possible === false || view.possible === false ? false : Boolean(view.possible),
      heldByCandle: false
    };
    locked.set(key, { cycleKey, view: upgraded });
    return upgraded;
  }

  function clear(asset = "") {
    const normalized = String(asset).toUpperCase();
    for (const key of locked.keys()) {
      if (!normalized || key.startsWith(`${normalized}|`)) locked.delete(key);
    }
  }

  return { resolve, clear };
}

const spokenDirection = context => {
  if (["buy", "reversalBuy"].includes(context)) return "BUY";
  if (["sell", "reversalSell"].includes(context)) return "SELL";
  return "";
};

export function createSpokenSignalLock() {
  const locked = new Map();

  function accept({ asset = "", cycleKey = "", context = "" } = {}) {
    const normalizedAsset = String(asset || "").trim().toUpperCase();
    const direction = spokenDirection(context);
    if (!normalizedAsset || !cycleKey || !direction) return true;

    const previous = locked.get(normalizedAsset);
    if (previous?.cycleKey === cycleKey && previous.direction !== direction) return false;
    locked.set(normalizedAsset, { cycleKey, direction });
    return true;
  }

  function direction(asset = "", cycleKey = "") {
    const current = locked.get(String(asset || "").trim().toUpperCase());
    return current?.cycleKey === cycleKey ? current.direction : "";
  }

  return { accept, direction };
}
