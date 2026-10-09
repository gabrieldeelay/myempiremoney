(() => {
  if (window.__atlasGuardBridgeLoaded || window.top === window) return;
  window.__atlasGuardBridgeLoaded = true;

  const VERSION = "1.1.0";
  const BRIDGE_SOURCE = "atlas-guard-extension";
  const DASHBOARD_SOURCE = "atlas-guard-dashboard";
  const MINIMUM_BALANCE = 500;
  const CANDLE_MINUTES = 5;
  const BASE_RISK = 0.01;
  const PROTECTION_MULTIPLIER = 2;
  const MAX_GALES = 2;
  const MIN_CONFIDENCE = 72;
  const MAX_MARKINGS = 5;

  const internal = {
    mode: "stopped",
    task: Promise.resolve(),
    lastUserActivity: 0,
    lastAsset: null,
    lastAnalysisAt: 0,
    lastOrderCandle: null,
    pendingOrder: null,
    protectionBase: null,
    historyBaseline: new Set(),
    markings: [],
    eventSequence: 0,
    mutationTimer: null,
    state: {
      bridge: "ready",
      version: VERSION,
      mode: "stopped",
      monitoring: true,
      balance: null,
      balanceConfidence: null,
      account: { id: null, name: null, isDemo: false, isReal: null, verified: false },
      asset: null,
      symbol: null,
      assetChangedAt: null,
      timeframe: null,
      expiration: null,
      defaults: { timeframe: false, expiration: false },
      userActive: false,
      chartDetected: false,
      analysis: { direction: "WAIT", confidence: 0, reason: "Aguardando dados oficiais de 5 minutos" },
      protection: { active: false, pending: false, reason: null, multiplier: PROTECTION_MULTIPLIER },
      risk: { percent: 1, baseAmount: null, nextAmount: null, protectionAmount: null },
      markings: { lta: false, ltb: false, protection: false, total: 0, source: null },
      gale: { current: 0, maximum: MAX_GALES },
      lastOperation: null,
      realOrderExecution: false,
      events: [],
      lastInspectionAt: null
    }
  };

  for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    addEventListener(eventName, event => {
      if (event.isTrusted && !event.target?.closest?.('[id^="__atlas_guard"]')) internal.lastUserActivity = Date.now();
    }, { capture: true, passive: true });
  }

  function compact(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function fiveMinuteBoundary(timestamp = Date.now()) { return Math.floor(timestamp / 300000) * 300000; }
  function formatMoney(value) { return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function allDocuments() {
    const result = [document];
    for (const frame of document.querySelectorAll("iframe")) {
      try { if (frame.contentDocument) result.push(frame.contentDocument); } catch { /* origem isolada */ }
    }
    return result;
  }
  function queryAll(selector) { return allDocuments().flatMap(doc => [...doc.querySelectorAll(selector)]); }
  function visible(element) {
    const view = element?.ownerDocument?.defaultView;
    if (!view) return false;
    const style = view.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0 && box.width > 1 && box.height > 1;
  }
  function parseBRL(raw) {
    const normalized = String(raw || "").replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function logEvent(title, detail, level = "info", key = title) {
    const last = internal.state.events[0];
    if (last?.key === key && Date.now() - new Date(last.at).getTime() < 12000) return;
    internal.state.events.unshift({ id: `${Date.now()}-${++internal.eventSequence}`, key, title, detail, level, at: new Date().toISOString() });
    internal.state.events = internal.state.events.slice(0, 50);
  }
  function parentOrigin() {
    try { return document.referrer ? new URL(document.referrer).origin : null; } catch { return null; }
  }
  async function originAllowed(origin) {
    if (!origin) return false;
    const response = await chrome.runtime.sendMessage({ type: "is_origin_allowed", origin });
    return Boolean(response?.allowed);
  }

  function detectBalance() {
    const accountResume = document.querySelector(".account-resume");
    const direct = compact(accountResume?.textContent).match(/R\$\s*([\d.]+,\d{2})/i);
    if (direct) return { value: parseBRL(direct[1]), confidence: "high" };
    const candidates = [];
    for (const element of [...document.querySelectorAll('[data-balance],[class*="balance" i],[class*="saldo" i],span,div,strong,b')].filter(visible)) {
      const text = compact(element.textContent);
      const match = text.match(/R\$\s*([\d.]+,\d{2})/i);
      if (!match || text.length > 130) continue;
      const context = compact(element.parentElement?.textContent || text).slice(0, 180);
      let score = /balance|saldo/i.test(String(element.className || "")) ? 70 : 0;
      if (/saldo|conta demo|conta real|dispon[ií]vel/i.test(context)) score += 45;
      if (element.getBoundingClientRect().top < 150) score += 25;
      if (/valor|lucro|expira[cç][aã]o/i.test(context)) score -= 60;
      candidates.push({ value: parseBRL(match[1]), score });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return best?.score >= 18 ? { value: best.value, confidence: best.score >= 55 ? "high" : "medium" } : { value: null, confidence: null };
  }

  function activeInstrument() {
    const section = document.querySelector('section#window.active[data-symbol],section.w-active[data-symbol]');
    return {
      asset: compact(document.querySelector(".item.active .title")?.textContent) || compact(section?.dataset?.symbol) || null,
      symbol: compact(section?.dataset?.symbol) || null
    };
  }
  function timeframeButtons() {
    return queryAll('button[aria-label*="minuto" i],button,[role="button"],a')
      .filter(visible)
      .map(element => ({ element, text: compact(element.textContent), label: compact(element.getAttribute("aria-label")) }))
      .filter(item => /^(?:1m|2m|3m|5m|10m|15m|30m|1h|4h)$/i.test(item.text) || /\b\d+\s*minuto/i.test(item.label));
  }
  function locateExpirationControl() {
    const direct = document.querySelector("#tour_expiration");
    const hosts = direct ? [direct] : [...document.querySelectorAll("div,section")].filter(element => /expira[cç][aã]o/i.test(compact(element.textContent)));
    for (const host of hosts) {
      if (!visible(host)) continue;
      const match = compact(host.textContent).match(/(\d+)\s*(?:min|m)\b/i);
      if (!match || host.getBoundingClientRect().width > 540) continue;
      const buttons = [...host.querySelectorAll('button,[role="button"]')].filter(visible);
      return {
        minutes: Number(match[1]),
        minus: buttons.find(button => /^(?:-|−|–)$/.test(compact(button.textContent)) || /diminuir|menos/i.test(button.getAttribute("aria-label") || "")),
        plus: buttons.find(button => /^\+$/.test(compact(button.textContent)) || /aumentar|mais/i.test(button.getAttribute("aria-label") || ""))
      };
    }
    return null;
  }

  async function detectAccount() {
    const resumeText = compact(document.querySelector(".account-resume")?.textContent);
    const selectedName = /conta\s+demo/i.test(resumeText) ? "Conta Demo" : /conta\s+(?:principal|real)/i.test(resumeText) ? "Conta Principal" : null;
    let accounts = [];
    try {
      const response = await fetch("/binary/accounts/get?selected_account=0", { credentials: "include", cache: "no-store" });
      const payload = await response.json();
      accounts = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.accounts) ? payload.accounts : [];
    } catch { /* desconhecida permanece bloqueada */ }
    const account = accounts.find(item => /demo/i.test(selectedName || "") === !Boolean(Number(item.is_real)));
    const isReal = account ? Boolean(Number(account.is_real)) : selectedName ? !/demo/i.test(selectedName) : null;
    internal.state.account = {
      id: account?.id ?? account?.account_id ?? null,
      name: account?.name || account?.account_name || selectedName,
      isDemo: isReal === false && /demo/i.test(account?.name || account?.account_name || selectedName || ""),
      isReal,
      verified: Boolean(account && selectedName)
    };
    internal.state.realOrderExecution = false;
    return internal.state.account;
  }

  async function inspect() {
    const instrument = activeInstrument();
    const expiration = locateExpirationControl();
    const balance = detectBalance();
    const previousAsset = internal.state.asset;
    const previousBalance = internal.state.balance;
    const buttons = timeframeButtons();
    const selectedFive = buttons.find(item => /5 minutos/i.test(item.label)) || buttons.find(item => item.text === "5m");
    internal.state.asset = instrument.asset;
    internal.state.symbol = instrument.symbol;
    internal.state.timeframe = selectedFive ? "5m" : (buttons.find(item => item.text)?.text || null);
    internal.state.expiration = expiration?.minutes ? `${expiration.minutes} min` : null;
    internal.state.defaults = { timeframe: Boolean(selectedFive), expiration: expiration?.minutes === 5 };
    internal.state.balance = balance.value;
    internal.state.balanceConfidence = balance.confidence;
    internal.state.chartDetected = queryAll("canvas,svg").some(visible);
    internal.state.userActive = Date.now() - internal.lastUserActivity < 2200;
    internal.state.lastInspectionAt = new Date().toISOString();
    await detectAccount();
    const baseAmount = balance.value == null ? null : Math.max(1, Math.round(balance.value * BASE_RISK * 100) / 100);
    const cycleBase = internal.protectionBase ?? baseAmount;
    internal.state.risk = {
      percent: 1,
      baseAmount,
      protectionAmount: cycleBase == null ? null : Math.round(cycleBase * 2 * 100) / 100,
      nextAmount: cycleBase == null ? null : Math.round(cycleBase * Math.pow(2, internal.state.gale.current) * 100) / 100
    };
    if (instrument.asset && instrument.asset !== previousAsset) {
      internal.state.assetChangedAt = internal.state.lastInspectionAt;
      internal.lastAnalysisAt = 0;
      internal.lastOrderCandle = null;
      renderMarkings([]);
      logEvent("Ativo alterado", `${instrument.asset} detectado. Ajustando velas e expiração para 5 minutos.`, "success", `asset-${instrument.asset}`);
    }
    if (balance.value != null && balance.value !== previousBalance) {
      logEvent("Saldo verificado", balance.value > MINIMUM_BALANCE ? `R$ ${formatMoney(balance.value)}: entrada-base calculada em R$ ${formatMoney(baseAmount)} (1%).` : `R$ ${formatMoney(balance.value)}: robô bloqueado, mínimo superior a R$ 500,00.`, balance.value > MINIMUM_BALANCE ? "success" : "danger", `balance-${balance.value}`);
    }
    if (internal.state.account.isReal) logEvent("Conta real bloqueada", "O Atlas detectou a conta principal e desativou qualquer clique de compra ou venda.", "danger", "real-account-block");
    return snapshot();
  }

  async function ensureDefaults() {
    await inspect();
    if (internal.state.userActive) {
      logEvent("Ajuste adiado", "Interação manual detectada; o Atlas aguardará antes de tocar nos controles.", "warning", "defaults-user-active");
      return { changed: false, blocked: true, state: snapshot() };
    }
    let changed = false;
    if (!internal.state.defaults.timeframe) {
      const trigger = timeframeButtons().find(item => /\b(?:1|2|3|10|15|30)\s*minuto/i.test(item.label) || /^(?:1m|2m|3m|10m|15m|30m)$/i.test(item.text));
      if (trigger) {
        trigger.element.click();
        await sleep(140);
        const option = queryAll('[role="menuitem"],div,span').filter(visible).find(element => /^5 minutos$/i.test(compact(element.textContent)) && compact(element.textContent).length < 15);
        if (option) {
          (option.closest('[role="menuitem"]') || option).click();
          changed = true;
          await sleep(260);
          logEvent("Velas ajustadas", "Timeframe alterado automaticamente para 5 minutos.", "success", `timeframe-${internal.state.asset || "current"}`);
        }
      }
    }
    let expiration = locateExpirationControl();
    for (let attempt = 0; expiration?.minutes && expiration.minutes !== 5 && attempt < 20; attempt += 1) {
      const control = expiration.minutes < 5 ? expiration.plus : expiration.minus;
      if (!control) break;
      control.click();
      changed = true;
      await sleep(90);
      expiration = locateExpirationControl();
    }
    await inspect();
    if (internal.state.defaults.timeframe && internal.state.defaults.expiration) logEvent("Configuração confirmada", "Velas de 5m e expiração de 5 min estão ativas.", "success", `defaults-ok-${internal.state.asset || "current"}`);
    return { changed, blocked: false, state: snapshot() };
  }

  function chartHost() {
    const anchor = queryAll("canvas").filter(visible).sort((a, b) => {
      const aa = a.getBoundingClientRect();
      const bb = b.getBoundingClientRect();
      return bb.width * bb.height - aa.width * aa.height;
    })[0];
    if (!anchor) return null;
    const view = anchor.ownerDocument.defaultView;
    let host = anchor.parentElement;
    while (host && host !== anchor.ownerDocument.body) {
      const box = host.getBoundingClientRect();
      if (box.width > view.innerWidth * .42 && box.height > view.innerHeight * .35) return host;
      host = host.parentElement;
    }
    return anchor.parentElement;
  }
  function renderMarkings(lines = [], source = null) {
    const host = chartHost();
    internal.markings = lines.slice(0, MAX_MARKINGS).filter(line => ["LTA", "LTB", "PROTECTION"].includes(line.type));
    internal.state.markings = {
      lta: internal.markings.some(line => line.type === "LTA"),
      ltb: internal.markings.some(line => line.type === "LTB"),
      protection: internal.markings.some(line => line.type === "PROTECTION"),
      total: internal.markings.length,
      source
    };
    if (!host) return { rendered: 0 };
    const doc = host.ownerDocument;
    let svg = host.querySelector(":scope > #__atlas_guard_chart_overlay");
    if (!svg) {
      if (doc.defaultView.getComputedStyle(host).position === "static") host.style.position = "relative";
      svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "__atlas_guard_chart_overlay";
      svg.setAttribute("viewBox", "0 0 1000 600");
      svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000";
      host.appendChild(svg);
    }
    svg.replaceChildren();
    for (const line of internal.markings) {
      const horizontal = line.type === "PROTECTION";
      const element = doc.createElementNS("http://www.w3.org/2000/svg", "line");
      element.setAttribute("x1", String(horizontal ? 0 : clamp(line.x1) * 1000));
      element.setAttribute("y1", String(clamp(line.y1) * 600));
      element.setAttribute("x2", String(horizontal ? 1000 : clamp(line.x2) * 1000));
      element.setAttribute("y2", String(clamp(line.y2 ?? line.y1) * 600));
      element.setAttribute("stroke", line.type === "PROTECTION" ? "#ffb84d" : line.type === "LTB" ? "#ff647c" : "#b8f53f");
      element.setAttribute("stroke-width", line.type === "PROTECTION" ? "3" : "2.4");
      if (horizontal) element.setAttribute("stroke-dasharray", "10 7");
      svg.appendChild(element);
      const label = doc.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String((horizontal ? .02 : clamp(line.x1)) * 1000));
      label.setAttribute("y", String(Math.max(20, clamp(line.y1) * 600 - 9)));
      label.setAttribute("fill", line.type === "LTB" ? "#ff647c" : line.type === "PROTECTION" ? "#ffb84d" : "#b8f53f");
      label.setAttribute("font-size", "18");
      label.setAttribute("font-family", "system-ui,sans-serif");
      label.setAttribute("font-weight", "800");
      label.textContent = line.type;
      svg.appendChild(label);
    }
    return { rendered: internal.markings.length };
  }

  async function fetchMarketCandles(symbol = internal.state.symbol) {
    if (!symbol) return [];
    const url = new URL("/publicapi/tradingview/udf-history", location.origin);
    const to = Math.floor(Date.now() / 1000);
    for (const [key, value] of Object.entries({ symbol, resolution: "5", from: String(to - 86400), to: String(to), countback: "120", site: location.hostname })) url.searchParams.set(key, value);
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`Feed de velas respondeu ${response.status}`);
    const payload = await response.json();
    if (payload?.s !== "ok" || !Array.isArray(payload.t)) return [];
    return payload.t.map((time, index) => ({
      time: Number(time) * 1000,
      open: Number(payload.o[index]), high: Number(payload.h[index]), low: Number(payload.l[index]), close: Number(payload.c[index])
    })).filter(item => [item.time, item.open, item.high, item.low, item.close].every(Number.isFinite)).slice(-120);
  }
  function ema(values, period) {
    const factor = 2 / (period + 1);
    return values.reduce((current, value, index) => index === 0 ? value : value * factor + current * (1 - factor), values[0] || 0);
  }
  function swings(candles, property, kind) {
    const points = [];
    for (let index = 2; index < candles.length - 2; index += 1) {
      const value = candles[index][property];
      const neighbors = [candles[index - 2][property], candles[index - 1][property], candles[index + 1][property], candles[index + 2][property]];
      if (kind === "low" ? neighbors.every(other => value <= other) : neighbors.every(other => value >= other)) points.push({ index, value });
    }
    return points;
  }
  function trendLine(type, first, second, candles, minimum, priceRange) {
    const x1 = first.index / (candles.length - 1);
    const x2Point = second.index / (candles.length - 1);
    const y1 = 1 - (first.value - minimum) / priceRange;
    const y2Point = 1 - (second.value - minimum) / priceRange;
    const slope = (y2Point - y1) / Math.max(.001, x2Point - x1);
    return { type, x1, y1: clamp(y1), x2: 1, y2: clamp(y2Point + slope * (1 - x2Point)) };
  }

  async function analyzeChart() {
    let raw;
    try { raw = await fetchMarketCandles(); } catch (error) {
      internal.state.analysis = { direction: "WAIT", confidence: 0, reason: `Feed oficial indisponível: ${error.message}` };
      return internal.state.analysis;
    }
    const candles = raw.filter(item => item.time + 300000 <= Date.now()).slice(-80);
    if (candles.length < 30) {
      renderMarkings([], null);
      internal.state.analysis = { direction: "WAIT", confidence: 0, reason: "Histórico oficial insuficiente", source: "official-5m-feed", candles: candles.length };
      return internal.state.analysis;
    }
    const values = candles.flatMap(item => [item.high, item.low]);
    const minimum = Math.min(...values);
    const priceRange = Math.max(...values) - minimum || 1;
    const lowPair = swings(candles, "low", "low").slice(-2);
    const highPair = swings(candles, "high", "high").slice(-2);
    const hasLta = lowPair.length === 2 && lowPair[1].index - lowPair[0].index >= 3 && lowPair[1].value > lowPair[0].value;
    const hasLtb = highPair.length === 2 && highPair[1].index - highPair[0].index >= 3 && highPair[1].value < highPair[0].value;
    const lines = [];
    if (hasLta) lines.push(trendLine("LTA", lowPair[0], lowPair[1], candles, minimum, priceRange));
    if (hasLtb) lines.push(trendLine("LTB", highPair[0], highPair[1], candles, minimum, priceRange));
    const recentRanges = candles.slice(-21, -1).map(item => item.high - item.low);
    const averageRange = recentRanges.reduce((sum, value) => sum + value, 0) / recentRanges.length;
    const last = candles.at(-1);
    const spike = averageRange > 0 && last.high - last.low > averageRange * 2.35;
    if (spike) lines.push({ type: "PROTECTION", y1: clamp(1 - ((last.close >= last.open ? last.high : last.low) - minimum) / priceRange), expiresAt: last.time + 300000 });
    renderMarkings(lines, "official-5m-feed");
    const closes = candles.map(item => item.close);
    const ema9 = ema(closes.slice(-36), 9);
    const ema21 = ema(closes.slice(-60), 21);
    const momentum = last.close - candles.at(-4).close;
    const bullish = candles.slice(-5).filter(item => item.close > item.open).length;
    const bearish = candles.slice(-5).filter(item => item.close < item.open).length;
    internal.state.protection.active = spike;
    internal.state.protection.reason = spike ? "Amplitude acima de 2,35× a média das 20 velas anteriores" : internal.state.protection.pending ? "Proteção 2x aguardando novo sinal válido" : null;
    let direction = "WAIT";
    let confidence = 0;
    let reason = "Critérios mínimos ainda não foram atingidos";
    if (spike) reason = "Proteção ativa: pico de volatilidade na última vela fechada";
    else {
      const buyScore = (ema9 > ema21 ? 2 : 0) + (momentum > 0 ? 1 : 0) + (bullish >= 3 ? 1 : 0) + (hasLta ? 2 : 0);
      const sellScore = (ema9 < ema21 ? 2 : 0) + (momentum < 0 ? 1 : 0) + (bearish >= 3 ? 1 : 0) + (hasLtb ? 2 : 0);
      if (buyScore >= 5 && buyScore > sellScore) {
        direction = "BUY";
        confidence = 70 + buyScore * 4;
        reason = `LTA válida + EMA9 acima da EMA21 + momentum positivo + ${bullish}/5 velas compradoras`;
      } else if (sellScore >= 5 && sellScore > buyScore) {
        direction = "SELL";
        confidence = 70 + sellScore * 4;
        reason = `LTB válida + EMA9 abaixo da EMA21 + momentum negativo + ${bearish}/5 velas vendedoras`;
      } else if (!hasLta && !hasLtb) reason = "Nenhuma LTA ou LTB válida confirmada nas velas fechadas";
    }
    internal.state.analysis = { direction, confidence: Math.min(94, confidence), reason, source: "official-5m-feed", candles: candles.length, candleTime: last.time };
    if (spike) logEvent("Proteção contra pico", `${internal.state.asset}: nenhuma entrada durante esta janela.`, "danger", `spike-${internal.state.symbol}-${last.time}`);
    else if (direction === "WAIT") logEvent("Sem entrada", `${internal.state.asset}: ${reason}.`, "info", `wait-${internal.state.symbol}-${last.time}`);
    else logEvent(`Cenário de ${direction === "BUY" ? "COMPRA" : "VENDA"}`, `${reason}. Confiança ${internal.state.analysis.confidence}%.`, "signal", `signal-${internal.state.symbol}-${direction}-${last.time}`);
    if (hasLta || hasLtb) logEvent("Marcações atualizadas", `${lines.filter(line => /LT[AB]/.test(line.type)).map(line => line.type).join(" e ")} com ${candles.length} velas oficiais.`, "success", `lines-${internal.state.symbol}-${last.time}`);
    return internal.state.analysis;
  }

  function setNativeInput(input, value) {
    Object.getOwnPropertyDescriptor(input.ownerDocument.defaultView.HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  async function applyRiskAmount(amount) {
    const input = document.querySelector("#tour_amount input") || [...document.querySelectorAll("input")].find(item => /valor|amount/i.test(`${item.name} ${item.placeholder}`));
    if (!input || !visible(input)) throw new Error("Campo de valor não localizado");
    setNativeInput(input, Number(amount).toFixed(2).replace(".", ","));
    await sleep(120);
    const current = parseBRL(input.value);
    if (current == null || Math.abs(current - amount) > .011) throw new Error("A plataforma não confirmou o valor calculado");
  }
  async function loadHistory() {
    const response = await fetch("/binary/history/0", { credentials: "include", cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  }
  function isDemoHistory(item) { return /demo/i.test(compact(item.account_name || item.account?.name)); }
  function outcomeOf(item) {
    const numericStatus = Number(item.status);
    if (numericStatus === 1) return null;
    if (numericStatus === 2) return "WIN";
    if (numericStatus === 3) return "LOSS";
    if (numericStatus === 4) return "DRAW";
    const status = compact(item.status).toLowerCase();
    const amount = Number(item.amount ?? Number(item.amount_cents || 0) / 100);
    const returned = Number(item.return ?? Number(item.return_cents || 0) / 100);
    if (/win|won|ganh|success|profit/.test(status) || returned > amount) return "WIN";
    if (/loss|lost|perd|fail/.test(status) || (/clos|finish|expir/.test(status) && returned <= amount)) return "LOSS";
    if (/draw|tie|empate|refund/.test(status)) return "DRAW";
    return null;
  }
  async function reconcileLastOperation() {
    if (!internal.pendingOrder) return;
    const history = await loadHistory();
    const candidates = history.filter(item => isDemoHistory(item) && !internal.historyBaseline.has(String(item.id)));
    const match = candidates.find(item => !internal.pendingOrder.symbol || compact(item.symbol) === compact(internal.pendingOrder.symbol)) || candidates[0];
    if (!match) return;
    internal.pendingOrder.id = match.id;
    internal.pendingOrder.expirationAt = Number(match.expiration_timestamp || 0) * 1000 || internal.pendingOrder.expirationAt;
    internal.pendingOrder.strike = Number(match.symbol_price) || internal.pendingOrder.strike;
    let outcome = outcomeOf(match);
    let inferredFromCandle = false;
    if (!outcome && internal.pendingOrder.expirationAt && Date.now() > internal.pendingOrder.expirationAt + 30000 && Number.isFinite(internal.pendingOrder.strike)) {
      const candles = await fetchMarketCandles(internal.pendingOrder.symbol);
      const finalCandle = candles.filter(item => item.time < internal.pendingOrder.expirationAt).at(-1);
      if (finalCandle) {
        const difference = finalCandle.close - internal.pendingOrder.strike;
        if (Math.abs(difference) < Number.EPSILON) outcome = "DRAW";
        else outcome = internal.pendingOrder.direction === "BUY" ? (difference > 0 ? "WIN" : "LOSS") : (difference < 0 ? "WIN" : "LOSS");
        inferredFromCandle = true;
      }
    }
    if (!outcome) return;
    internal.state.lastOperation = { ...internal.pendingOrder, id: match.id, outcome, status: inferredFromCandle ? `INFERRED_${outcome}` : match.status, finishedAt: new Date().toISOString() };
    if (inferredFromCandle) logEvent("Resultado confirmado pela vela", `O histórico da Hezilex ainda estava aberto; o fechamento oficial de 5m confirmou ${outcome === "WIN" ? "resultado positivo" : outcome === "LOSS" ? "resultado negativo" : "empate"}.`, outcome === "LOSS" ? "warning" : "success", `inferred-${match.id}`);
    if (outcome === "LOSS" && internal.state.gale.current < MAX_GALES) {
      internal.state.gale.current += 1;
      internal.state.protection.pending = true;
      if (internal.state.symbol === internal.pendingOrder.symbol) {
        const candles = await fetchMarketCandles(internal.pendingOrder.symbol);
        const values = candles.slice(-80).flatMap(item => [item.high, item.low]);
        const minimum = Math.min(...values);
        const priceRange = Math.max(...values) - minimum || 1;
        renderMarkings([...internal.markings.filter(line => line.type !== "PROTECTION"), { type: "PROTECTION", y1: clamp(1 - (internal.pendingOrder.strike - minimum) / priceRange) }], "loss-protection");
      }
      logEvent("Proteção preparada", `Resultado negativo na Conta Demo. Próxima entrada válida em ${Math.pow(2, internal.state.gale.current)}x, com teto de ${MAX_GALES} proteções.`, "warning", `protection-${match.id}`);
    } else if (outcome === "LOSS") {
      internal.mode = "stopped";
      internal.state.mode = "stopped";
      internal.state.protection.pending = false;
      logEvent("Limite de proteção atingido", "Duas proteções foram usadas. O Atlas parou automaticamente.", "danger", `gale-stop-${match.id}`);
    } else {
      internal.state.gale.current = 0;
      internal.state.protection.pending = false;
      internal.protectionBase = null;
      renderMarkings(internal.markings.filter(line => line.type !== "PROTECTION"), internal.state.markings.source);
      logEvent(outcome === "WIN" ? "Resultado positivo" : "Operação devolvida", "Proteção reiniciada para a entrada-base de 1%.", "success", `result-${match.id}`);
    }
    internal.pendingOrder = null;
  }

  async function placeDemoOrder() {
    const analysis = internal.state.analysis;
    if (internal.mode !== "running" || analysis.direction === "WAIT" || analysis.confidence < MIN_CONFIDENCE) return false;
    if (internal.pendingOrder || internal.lastOrderCandle === analysis.candleTime || internal.state.userActive || internal.state.protection.active) return false;
    if (!internal.state.account.verified || !internal.state.account.isDemo || internal.state.account.isReal !== false) {
      logEvent("Entrada bloqueada", "A Conta Demo não pôde ser confirmada; nenhum botão foi acionado.", "danger", "demo-not-verified");
      return false;
    }
    if (!(Number(internal.state.balance) > MINIMUM_BALANCE) || !internal.state.defaults.timeframe || !internal.state.defaults.expiration) return false;
    const cycleBase = internal.protectionBase ?? internal.state.risk.baseAmount;
    const amount = Math.round(cycleBase * Math.pow(2, internal.state.gale.current) * 100) / 100;
    const permission = await chrome.runtime.sendMessage({ type: "financial_permission", demoVerified: true, isReal: false, amount });
    if (!permission?.allowed) throw new Error(permission?.reason || "Operação não autorizada");
    const history = await loadHistory();
    internal.historyBaseline = new Set(history.filter(isDemoHistory).map(item => String(item.id)));
    await applyRiskAmount(amount);
    await detectAccount();
    if (!internal.state.account.verified || !internal.state.account.isDemo || internal.state.account.isReal !== false) throw new Error("Conta mudou durante a preparação; operação cancelada");
    const pattern = analysis.direction === "BUY" ? /comprar/i : /vender/i;
    const button = [...document.querySelectorAll("button")].filter(visible).find(item => pattern.test(compact(item.textContent)));
    if (!button) throw new Error("Botão de compra/venda não localizado");
    button.click();
    if (internal.state.gale.current === 0) internal.protectionBase = amount;
    internal.lastOrderCandle = analysis.candleTime;
    internal.pendingOrder = { id: null, symbol: internal.state.symbol, asset: internal.state.asset, direction: analysis.direction, amount, gale: internal.state.gale.current, reason: analysis.reason, placedAt: new Date().toISOString(), account: "Conta Demo" };
    internal.state.lastOperation = { ...internal.pendingOrder, status: "OPEN" };
    logEvent(`Entrada de ${analysis.direction === "BUY" ? "COMPRA" : "VENDA"} realizada`, `${internal.state.asset}, Conta Demo, R$ ${formatMoney(amount)}. Motivos: ${analysis.reason}.`, "signal", `order-${internal.state.symbol}-${analysis.candleTime}`);
    return true;
  }

  function cleanupExpiredMarkings() {
    const active = internal.markings.filter(line => !line.expiresAt || line.expiresAt > Date.now());
    if (active.length !== internal.markings.length) {
      renderMarkings(active, internal.state.markings.source);
      internal.state.protection.active = false;
      logEvent("Linha de proteção removida", "A vela terminou e a marcação temporária foi limpa.", "success", `protection-clean-${Date.now()}`);
    }
  }
  function injectAnalysisPanel() {
    let panel = document.getElementById("__atlas_guard_panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "__atlas_guard_panel";
      panel.style.cssText = "position:fixed;z-index:2147483647;left:18px;right:18px;bottom:16px;min-height:68px;padding:12px 16px;border:1px solid rgba(184,245,63,.34);border-radius:12px;background:rgba(5,15,27,.94);box-shadow:0 18px 48px rgba(0,0,0,.45);color:#edf6ff;font-family:Inter,system-ui,sans-serif;pointer-events:none;display:flex;align-items:center;justify-content:space-between;gap:18px";
      document.documentElement.appendChild(panel);
    }
    const direction = internal.state.analysis.direction === "BUY" ? "COMPRA" : internal.state.analysis.direction === "SELL" ? "VENDA" : "AGUARDAR";
    const color = direction === "COMPRA" ? "#47dfa0" : direction === "VENDA" ? "#ff647c" : "#f4b955";
    const amount = internal.state.risk.nextAmount == null ? "—" : `R$ ${formatMoney(internal.state.risk.nextAmount)}`;
    panel.innerHTML = `<div><div style="color:#b8f53f;font-size:9px;font-weight:800;letter-spacing:.14em">ATLAS GUARD · CONTA DEMO · PRÓXIMA ${amount}</div><strong style="display:block;margin-top:6px;font-size:13px">${internal.state.analysis.reason}</strong></div><div style="text-align:right"><span style="display:block;color:#8195ac;font-size:8px">DIREÇÃO</span><b style="display:block;margin-top:5px;color:${color};font-size:12px">${direction}</b></div>`;
    return true;
  }
  function snapshot() {
    return {
      ...internal.state,
      account: { ...internal.state.account }, defaults: { ...internal.state.defaults }, analysis: { ...internal.state.analysis },
      protection: { ...internal.state.protection }, risk: { ...internal.state.risk }, markings: { ...internal.state.markings }, gale: { ...internal.state.gale },
      lastOperation: internal.state.lastOperation ? { ...internal.state.lastOperation } : null,
      events: internal.state.events.map(event => ({ ...event }))
    };
  }
  async function publishState() {
    try { await chrome.runtime.sendMessage({ type: "state_update", state: snapshot() }); } catch { /* painel indisponível */ }
  }

  async function monitorCycle(forceAnalysis = false) {
    await inspect();
    const changedAsset = internal.state.asset && internal.state.asset !== internal.lastAsset;
    if (!internal.state.userActive && internal.state.asset && (!internal.state.defaults.timeframe || !internal.state.defaults.expiration || changedAsset)) await ensureDefaults();
    const candleChanged = fiveMinuteBoundary() > Number(internal.state.analysis.candleTime || 0);
    if (internal.state.chartDetected && (forceAnalysis || changedAsset || candleChanged || Date.now() - internal.lastAnalysisAt > 12000)) {
      await analyzeChart();
      internal.lastAnalysisAt = Date.now();
    }
    cleanupExpiredMarkings();
    await reconcileLastOperation();
    if (internal.mode === "running") {
      injectAnalysisPanel();
      try { await placeDemoOrder(); } catch (error) { logEvent("Operação cancelada", error.message, "danger", `order-error-${error.message}`); }
    }
    internal.lastAsset = internal.state.asset;
    await publishState();
    return snapshot();
  }

  async function dispatchCommand(command) {
    if (command.action === "inspect") return monitorCycle(true);
    if (command.action === "ensure_defaults") return ensureDefaults();
    if (command.action === "overlay") return injectAnalysisPanel();
    if (command.action === "set_markings") return renderMarkings(command.lines || [], "dashboard");
    if (command.action === "start") {
      await monitorCycle(true);
      if (!(Number(internal.state.balance) > MINIMUM_BALANCE)) throw new Error("Saldo precisa estar acima de R$ 500,00 para iniciar");
      if (!internal.state.account.verified || !internal.state.account.isDemo || internal.state.account.isReal !== false) throw new Error("Selecione e confirme a Conta Demo. A conta real permanece bloqueada.");
      internal.mode = "running";
      internal.state.mode = "running";
      logEvent("Robô iniciado na Conta Demo", `Entrada-base de 1% (R$ ${formatMoney(internal.state.risk.baseAmount)}) e proteção 2x, limitada a ${MAX_GALES}.`, "signal", `start-${Date.now()}`);
      injectAnalysisPanel();
      await publishState();
      return snapshot();
    }
    if (command.action === "pause") {
      internal.mode = "paused";
      internal.state.mode = "paused";
      logEvent("Robô pausado", "Novas entradas foram pausadas.", "warning", `pause-${Date.now()}`);
      await publishState();
      return snapshot();
    }
    if (command.action === "stop") {
      internal.mode = "stopped";
      internal.state.mode = "stopped";
      internal.state.realOrderExecution = false;
      document.getElementById("__atlas_guard_panel")?.remove();
      logEvent("Robô parado", "O ciclo automático foi encerrado.", "danger", `stop-${Date.now()}`);
      await publishState();
      return snapshot();
    }
    throw new Error("Ação desconhecida");
  }
  function enqueue(command) {
    const run = internal.task.then(() => dispatchCommand(command));
    internal.task = run.catch(() => {});
    return run;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "atlas_dashboard_command") return false;
    enqueue(message.command).then(result => sendResponse({ ok: true, type: "result", result, state: snapshot() })).catch(error => sendResponse({ ok: false, type: "error", error: error.message, state: snapshot() }));
    return true;
  });
  addEventListener("message", async event => {
    if (event.source !== window.parent || event.data?.source !== DASHBOARD_SOURCE || event.data?.type !== "command") return;
    if (!(await originAllowed(event.origin))) return;
    try {
      const result = await enqueue(event.data);
      window.parent.postMessage({ source: BRIDGE_SOURCE, type: "result", requestId: event.data.requestId, result, state: snapshot() }, event.origin);
    } catch (error) {
      window.parent.postMessage({ source: BRIDGE_SOURCE, type: "error", requestId: event.data.requestId, error: error.message, state: snapshot() }, event.origin);
    }
  });

  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : null;
      return !target?.closest('[id^="__atlas_guard"]');
    });
    if (!relevant) return;
    clearTimeout(internal.mutationTimer);
    internal.mutationTimer = setTimeout(() => monitorCycle(false), 700);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-selected", "aria-pressed"] });
  setInterval(() => monitorCycle(false), 3000);

  (async () => {
    logEvent("Monitor conectado", "O Atlas iniciou o acompanhamento contínuo usando o feed oficial de 5 minutos.", "success", "monitor-connected");
    await monitorCycle(true);
    const origin = parentOrigin();
    if (await originAllowed(origin)) window.parent.postMessage({ source: BRIDGE_SOURCE, type: "ready", state: snapshot() }, origin);
  })();
})();
