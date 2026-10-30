function directional(view = {}) {
  return ["BUY", "SELL"].includes(String(view.direction || "WAIT").toUpperCase());
}

export function createSignalCandleLock() {
  const locked = new Map();

  function resolve({ asset = "", pane = "current", cycleKey = "", view = {} } = {}) {
    // The two tabs describe different entry moments. Lock each one for the
    // candle so an earlier next-candle forecast cannot suppress a valid
    // reversal detected during the current candle.
    const key = `${String(asset).trim().toUpperCase()}|${pane}`;
    const direction = String(view.direction || "WAIT").toUpperCase();
    const previous = locked.get(key);

    if (!cycleKey || !asset) return { ...view };

    if (!previous || previous.cycleKey !== cycleKey) {
      if (!directional(view)) {
        locked.delete(key);
        return { ...view };
      }
      const first = { ...view, direction };
      locked.set(key, { cycleKey, direction, views: new Map([[pane, first]]) });
      return first;
    }

    const paneView = previous.views.get(pane);

    if (!directional(view)) {
      return paneView ? { ...paneView, heldByCandle: true } : { ...view };
    }

    if (direction !== previous.direction) {
      if (paneView) return { ...paneView, heldByCandle: true };
      return {
        ...view,
        direction: "WAIT",
        confidence: 0,
        possible: false,
        actionable: false,
        entryConfirmed: false,
        signalKind: "direction-locked",
        heldByCandle: true,
        suppressedDirection: direction,
        reason: `A direção desta vela já foi fixada em ${previous.direction === "BUY" ? "COMPRA" : "VENDA"}. A leitura oposta foi descartada.`
      };
    }

    const upgraded = {
      ...(paneView || {}),
      ...view,
      direction,
      confidence: Math.max(Number(paneView?.confidence) || 0, Number(view.confidence) || 0),
      possible: paneView?.possible === false || view.possible === false ? false : Boolean(view.possible),
      heldByCandle: false
    };
    previous.views.set(pane, upgraded);
    return upgraded;
  }

  function clear(asset = "") {
    const normalized = String(asset).trim().toUpperCase();
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
