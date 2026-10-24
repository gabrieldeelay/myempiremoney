export const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
export const FIVE_MINUTE_CANDLE_MS = 5 * 60 * 1000;

const pad = value => String(value).padStart(2, "0");
const saoPauloParts = new Intl.DateTimeFormat("pt-BR", {
  timeZone: SAO_PAULO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export function saoPauloFiveMinuteCycle(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const values = Object.fromEntries(
    saoPauloParts.formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, Number(part.value)])
  );
  const candleMinute = Math.floor(values.minute / 5) * 5;
  const elapsedMs = (((values.minute - candleMinute) * 60) + values.second) * 1000 + date.getMilliseconds();
  return {
    key: `${values.year}-${pad(values.month)}-${pad(values.day)}T${pad(values.hour)}:${pad(candleMinute)}`,
    label: `${pad(values.hour)}:${pad(candleMinute)}`,
    timeZone: SAO_PAULO_TIME_ZONE,
    remainingMs: Math.max(1, FIVE_MINUTE_CANDLE_MS - elapsedMs)
  };
}

export function signalEffectTone(direction, possible = false) {
  const side = String(direction || "WAIT").toUpperCase();
  if (side === "BUY") return possible ? "possible-buy" : "buy";
  if (side === "SELL") return possible ? "possible-sell" : "sell";
  return "neutral";
}

export function createSaoPauloCandleClock(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const setTimer = typeof options.setTimer === "function" ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === "function" ? options.clearTimer : clearTimeout;
  const onCycle = typeof options.onCycle === "function" ? options.onCycle : () => {};
  let lastKey = null;
  let timer = null;
  let running = false;

  function inspect(emit = true) {
    const cycle = saoPauloFiveMinuteCycle(now());
    const changed = lastKey !== null && cycle.key !== lastKey;
    lastKey = cycle.key;
    if (changed && emit) onCycle(cycle);
    return { cycle, changed };
  }

  function schedule() {
    if (!running) return;
    if (timer != null) clearTimer(timer);
    const { cycle } = inspect(false);
    timer = setTimer(() => {
      timer = null;
      inspect(true);
      schedule();
    }, cycle.remainingMs + 35);
  }

  return {
    start() {
      if (running) return;
      running = true;
      inspect(false);
      schedule();
    },
    sync() {
      const result = inspect(true);
      if (running) schedule();
      return result;
    },
    stop() {
      running = false;
      if (timer != null) clearTimer(timer);
      timer = null;
    },
    current() {
      return saoPauloFiveMinuteCycle(now());
    }
  };
}
