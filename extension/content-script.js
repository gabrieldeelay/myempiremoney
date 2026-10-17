(() => {
  if (window.__atlasGuardBridgeLoaded || window.top === window) return;
  window.__atlasGuardBridgeLoaded = true;

  const VERSION = "2.5.2";
  const BRIDGE_SOURCE = "atlas-guard-extension";
  const DASHBOARD_SOURCE = "atlas-guard-dashboard";
  const CANDLE_MINUTES = 5;
  const BASE_RISK = 0.01;
  const MAX_MARKINGS = 5;

  const internal = {
    mode: "stopped",
    task: Promise.resolve(),
    lastUserActivity: 0,
    lastAsset: null,
    lastAnalysisAt: 0,
    lastHistoryCheckAt: 0,
    lastAccountCheckAt: 0,
    lastUiEventAt: 0,
    lastObservedOperationKey: null,
    lastManualClick: null,
    recentOperations: [],
    markings: [],
    trendLines: [],
    nativeDrawing: { task: Promise.resolve(), signatures: new Map() },
    eventSequence: 0,
    mutationTimer: null,
    monitorPromise: null,
    macroActive: false,
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
      protection: { active: false, ready: false, status: "idle", reason: null, direction: null, entryPrice: null, triggerPrice: null, suggestedAmount: null, expiresAt: null },
      risk: { percent: 1, baseAmount: null },
      markings: { lta: false, ltb: false, protection: false, total: 0, source: null },
      manualOperation: null,
      uiEvent: null,
      executionEnabled: false,
      events: [],
      lastInspectionAt: null
    }
  };

  for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    addEventListener(eventName, event => {
      if (event.isTrusted && !event.target?.closest?.('[id^="__atlas_guard"]')) {
        internal.lastUserActivity = Date.now();
        if (eventName === "pointerdown") detectAdvertisementClose(event);
      }
    }, { capture: true, passive: true });
  }
  addEventListener("click", event => {
    if (event.isTrusted) detectManualOperationClick(event);
  }, { capture: true, passive: true });

  function compact(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  const cryptoAssets = new Map([
    ["BTC", "BITCOIN"], ["XBT", "BITCOIN"], ["BITCOIN", "BITCOIN"],
    ["ETH", "ETHEREUM"], ["ETHEREUM", "ETHEREUM"], ["SOL", "SOLANA"], ["SOLANA", "SOLANA"],
    ["LTC", "LITECOIN"], ["LITECOIN", "LITECOIN"], ["ADA", "CARDANO"], ["CARDANO", "CARDANO"],
    ["XRP", "XRP"], ["AVAX", "AVAX"], ["DOGE", "DOGE"], ["SUI", "SUI"],
    ["XLM", "STELLAR"], ["STELLAR", "STELLAR"], ["BNB", "BNB"], ["TRX", "TRON"],
    ["TRON", "TRON"], ["DOT", "POLKADOT"], ["LINK", "CHAINLINK"], ["BCH", "BITCOIN CASH"]
  ]);
  const fiatCodes = new Set(["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD", "CHF"]);
  function normalizeAssetName(value) {
    const label = compact(value).replace(/\b(?:CRYPTO|FOREX|OTC)\b/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();
    if (!label) return null;
    const symbol = label.replace(/[^A-Z]/g, "");
    if (symbol.length === 6 && fiatCodes.has(symbol.slice(0, 3)) && fiatCodes.has(symbol.slice(3))) return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
    for (const [code, name] of cryptoAssets) {
      if (symbol === code || (symbol.startsWith(code) && /^(?:USDT|USDC|USD|BRL)$/.test(symbol.slice(code.length)))) return name;
    }
    return label.replace(/\s*\/\s*/g, "/");
  }
  function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function waitFor(check, timeout = 1000, interval = 45) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const result = check();
      if (result) return result;
      await sleep(interval);
    }
    return null;
  }
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
    const cleaned = String(raw || "").replace(/[^\d.,-]/g, "");
    const normalized = cleaned.includes(",")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : /^-?\d+\.\d{1,2}$/.test(cleaned) ? cleaned : cleaned.replace(/\./g, "");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function logEvent(title, detail, level = "info", key = title) {
    const last = internal.state.events[0];
    if (last?.key === key && Date.now() - new Date(last.at).getTime() < 12000) return;
    internal.state.events.unshift({ id: `${Date.now()}-${++internal.eventSequence}`, key, title, detail, level, at: new Date().toISOString() });
    internal.state.events = internal.state.events.slice(0, 50);
  }
  function protectionLevelReached(protection = internal.state.protection, price = internal.state.analysis.lastPrice) {
    if (!protection?.active || !Number.isFinite(price) || !Number.isFinite(protection.triggerPrice)) return false;
    return protection.direction === "BUY" ? price <= protection.triggerPrice : price >= protection.triggerPrice;
  }
  function protectionLine(protection = internal.state.protection) {
    const minimum = Number(internal.state.analysis.priceMinimum);
    const range = Number(internal.state.analysis.priceRange);
    if (!protection?.active || protection.asset !== internal.state.asset || !Number.isFinite(protection.triggerPrice) || !Number.isFinite(minimum) || !(range > 0)) return null;
    return { type: "PROTECTION", y1: clamp(1 - (protection.triggerPrice - minimum) / range), expiresAt: protection.expiresAt };
  }
  function refreshNativeMarkings() {
    const protection = protectionLine();
    return renderMarkings(protection ? [...internal.trendLines, protection] : internal.trendLines, "official-5m-feed");
  }
  function armProtection({ asset, direction, amount, observedAt }) {
    const entryPrice = Number(internal.state.analysis.lastPrice);
    if (!Number.isFinite(entryPrice) || !["BUY", "SELL"].includes(direction)) return;
    const averageRange = Number(internal.state.analysis.averageRange);
    const distance = Math.max(Number.isFinite(averageRange) ? averageRange * .45 : 0, Math.abs(entryPrice) * .0006);
    const triggerPrice = direction === "BUY" ? entryPrice - distance : entryPrice + distance;
    internal.state.protection = {
      active: true,
      ready: false,
      taken: false,
      status: "armed",
      reason: direction === "BUY" ? "Reentrada compradora em preço inferior" : "Reentrada vendedora em preço superior",
      asset,
      symbol: internal.state.symbol,
      direction,
      entryPrice,
      triggerPrice,
      originalAmount: Number(amount) || null,
      suggestedAmount: Number(amount) > 0 ? Math.round(Number(amount) * 2 * 100) / 100 : null,
      armedAt: new Date(observedAt).toISOString(),
      expiresAt: fiveMinuteBoundary(observedAt) + 300000
    };
    refreshNativeMarkings();
    logEvent("Proteção preparada", `${asset}: ${direction === "BUY" ? "nova compra abaixo" : "nova venda acima"} em ${triggerPrice.toFixed(5)}.`, "warning", `protection-armed-${asset}-${observedAt}`);
  }
  function updateProtectionOpportunity(price = internal.state.analysis.lastPrice) {
    const protection = internal.state.protection;
    if (!protection?.active || protection.taken || protection.ready || !protectionLevelReached(protection, Number(price))) return false;
    protection.ready = true;
    protection.status = "ready";
    protection.readyAt = new Date().toISOString();
    const amountText = Number.isFinite(protection.suggestedAmount) ? ` com R$ ${formatMoney(protection.suggestedAmount)}` : "";
    internal.state.uiEvent = {
      key: `protection-ready-${protection.asset}-${Date.now()}-${++internal.eventSequence}`,
      type: "PROTECTION_READY",
      asset: protection.asset,
      direction: protection.direction,
      triggerPrice: protection.triggerPrice,
      suggestedAmount: protection.suggestedAmount,
      observedAt: protection.readyAt
    };
    logEvent("Proteção no ponto", `${protection.asset}: ${protection.direction === "BUY" ? "COMPRA" : "VENDA"}${amountText} na região planejada.`, "signal", internal.state.uiEvent.key);
    return true;
  }
  async function refreshArmedProtection() {
    const protection = internal.state.protection;
    if (!protection?.active || protection.ready || !protection.symbol) return false;
    if (protection.asset === internal.state.asset) return updateProtectionOpportunity();
    try {
      const candles = await fetchMarketCandles(protection.symbol);
      return updateProtectionOpportunity(candles.at(-1)?.close);
    } catch { return false; }
  }
  function detectAdvertisementClose(event) {
    const element = event.target instanceof Element
      ? event.target.closest('button,a,[role="button"],[aria-label],[title]')
      : null;
    if (!element || Date.now() - internal.lastUiEventAt < 1500) return;
    const label = compact(`${element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`).toLowerCase();
    const closeIntent = /(^|\s)(fechar|close|dispensar|dismiss|pular|skip)(\s|$)|n[aã]o mostrar|[×✕]/i.test(label);
    if (!closeIntent) return;
    let container = element;
    let context = "";
    for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
      context += ` ${compact(container.textContent).slice(0, 360)} ${container.id || ""} ${String(container.className || "")}`;
    }
    const adContext = /b[oô]nus|deposit|promo|pr[eê]mio|cupom|campaign|offer|oferta|advert|an[uú]ncio|banner|popup|modal/i.test(context);
    if (!adContext && !/n[aã]o mostrar/i.test(label)) return;
    internal.lastUiEventAt = Date.now();
    internal.state.uiEvent = {
      key: `ad-closed-${internal.lastUiEventAt}-${++internal.eventSequence}`,
      type: "AD_CLOSED",
      label: "Anúncio fechado",
      observedAt: new Date().toISOString()
    };
    logEvent("Anúncio fechado", "O Atlas percebeu que você limpou a tela.", "success", internal.state.uiEvent.key);
    setTimeout(publishState, 0);
  }
  function detectManualOperationClick(event) {
    const element = event.target instanceof Element
      ? event.target.closest('button,[role="button"],a,input[type="button"],input[type="submit"]')
      : null;
    if (!element || element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") return;
    const label = compact(`${element.textContent || ""} ${element.value || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`).toLowerCase();
    const direction = /^(?:comprar|compra|buy|call|alta)(?:\s|$)/i.test(label) ? "BUY"
      : /^(?:vender|venda|sell|put|baixa)(?:\s|$)/i.test(label) ? "SELL"
      : null;
    if (!direction) return;
    const observedAt = Date.now();
    const asset = internal.state.asset || activeInstrument().asset || "Ativo atual";
    const key = `click-${observedAt}-${direction}-${++internal.eventSequence}`;
    const protection = internal.state.protection;
    const isProtection = Boolean(protection?.active && !protection.taken && protection.asset === asset && protection.direction === direction && protection.expiresAt > observedAt);
    const protectionStatus = isProtection ? (protectionLevelReached(protection) ? "READY" : "EARLY") : null;
    const amount = locateAmountControl()?.amount ?? null;
    internal.recentOperations = internal.recentOperations.filter(item => observedAt - item.at <= 300000);
    if (Number.isFinite(amount) && amount > 0) internal.recentOperations.push({ key, asset, direction, amount, at: observedAt });
    const balance = Number(internal.state.balance);
    const cumulativeAmount = internal.recentOperations.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const assetAmount = internal.recentOperations.filter(item => item.asset === asset).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const singleRiskPercent = balance > 0 && Number.isFinite(amount) ? amount / balance * 100 : null;
    const cumulativeRiskPercent = balance > 0 ? cumulativeAmount / balance * 100 : null;
    const severity = (singleRiskPercent >= 10 || cumulativeRiskPercent >= 20 || cumulativeAmount > balance) ? "critical"
      : (singleRiskPercent >= 2 || cumulativeRiskPercent >= 5 || internal.recentOperations.length >= 3) ? "danger"
      : "normal";
    const exposure = {
      balance: Number.isFinite(balance) ? balance : null,
      operationCount: internal.recentOperations.length,
      singleAmount: amount,
      singleRiskPercent,
      cumulativeAmount,
      cumulativeRiskPercent,
      assetAmount,
      severity,
      exceedsBalance: balance > 0 && cumulativeAmount > balance
    };
    internal.lastManualClick = { direction, asset, at: observedAt };
    internal.state.manualOperation = {
      key,
      asset,
      direction,
      outcome: "OPEN",
      amount,
      exposure,
      analysisDirection: internal.state.analysis.direction,
      analysisConfidence: internal.state.analysis.confidence,
      analysisReason: internal.state.analysis.reason,
      isProtection,
      protectionStatus,
      protectionTriggerPrice: isProtection ? protection.triggerPrice : null,
      observedAt: new Date(observedAt).toISOString(),
      source: "interface-click"
    };
    if (isProtection) {
      protection.active = false;
      protection.ready = protectionStatus === "READY";
      protection.taken = true;
      protection.status = protectionStatus === "READY" ? "taken-ready" : "taken-early";
      protection.takenAt = new Date(observedAt).toISOString();
      refreshNativeMarkings();
    } else {
      armProtection({ asset, direction, amount: internal.state.manualOperation.amount, observedAt });
    }
    logEvent(
      isProtection ? "Proteção manual detectada" : direction === "BUY" ? "Compra manual detectada" : "Venda manual detectada",
      isProtection
        ? `${asset}: reentrada ${protectionStatus === "READY" ? "na região planejada" : "antes da região planejada"}.`
        : `${asset}: o Atlas registrou a operação e preparou a região de proteção.`,
      "signal",
      key
    );
    if (severity !== "normal") {
      logEvent(
        severity === "critical" ? "Exposição crítica" : "Exposição elevada",
        `${internal.recentOperations.length} operação(ões) em 5 minutos somam R$ ${formatMoney(cumulativeAmount)}${Number.isFinite(cumulativeRiskPercent) ? ` (${Math.round(cumulativeRiskPercent)}% do saldo)` : ""}.`,
        "danger",
        `exposure-${key}`
      );
    }
    setTimeout(publishState, 0);
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
    const rawAsset = compact(document.querySelector(".item.active .title")?.textContent) || compact(section?.dataset?.symbol) || null;
    return {
      asset: normalizeAssetName(rawAsset),
      symbol: compact(section?.dataset?.symbol) || null
    };
  }
  function timeframeButtons() {
    return queryAll('button[aria-label*="minuto" i],button,[role="button"],a')
      .filter(visible)
      .map(element => ({ element, text: compact(element.textContent), label: compact(element.getAttribute("aria-label")) }))
      .filter(item => /^(?:1m|2m|3m|5m|10m|15m|30m|1h|4h)$/i.test(item.text) || /\b\d+\s*minuto/i.test(item.label));
  }
  function fiveMinuteOption() {
    const trigger = timeframeTrigger()?.element;
    const candidates = queryAll('button,[role="menuitem"],[role="option"],[role="button"],a,li,div,span')
      .filter(visible)
      .filter(element => element !== trigger)
      .filter(element => /^(?:5m|5\s*minutos?)$/i.test(compact(element.textContent)) || /^(?:5m|5\s*minutos?)$/i.test(compact(element.getAttribute("aria-label"))))
      .sort((left, right) => {
        const score = element => {
          const box = element.getBoundingClientRect();
          const role = compact(element.getAttribute("role"));
          const css = element.ownerDocument.defaultView?.getComputedStyle(element);
          let value = 0;
          if (/^(?:menuitem|option)$/.test(role)) value += 120;
          if (element.matches("button,li,a")) value += 80;
          if (/item|option|period|timeframe/i.test(compact(element.className))) value += 45;
          if (css?.cursor === "pointer") value += 25;
          if (box.width >= 60 && box.height >= 24 && box.height <= 80) value += 25;
          if (box.width * box.height > 70000) value -= 120;
          return value;
        };
        return score(right) - score(left);
      });
    return candidates[0] || null;
  }
  function timeframeTrigger() {
    const buttons = timeframeButtons();
    return buttons.find(item => /^(?:1m|2m|3m|5m|10m|15m|30m|1h|4h)$/i.test(item.text))
      || buttons.find(item => /\b\d+\s*minuto/i.test(item.label))
      || null;
  }
  function timeframeIsFive() {
    const trigger = timeframeTrigger();
    return Boolean(trigger && (/^5m$/i.test(trigger.text) || /5\s*minutos?/i.test(trigger.label)));
  }
  function clickableOption(element) {
    let current = element;
    let best = element;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const view = current.ownerDocument?.defaultView;
      const css = view?.getComputedStyle(current);
      const role = compact(current.getAttribute?.("role"));
      const className = compact(current.className);
      const exact = /^(?:5m|5\s*minutos?)$/i.test(compact(current.textContent)) || /^(?:5m|5\s*minutos?)$/i.test(compact(current.getAttribute?.("aria-label")));
      if (exact && current.matches?.('button,a,li,[role="menuitem"],[role="option"],[role="button"],[onclick],[tabindex]')) return current;
      if ((css?.cursor === "pointer" || /(?:item|option|period|timeframe)/i.test(className)) && /^(?:5m|5\s*minutos?)$/i.test(compact(current.textContent))) best = current;
      if (compact(current.textContent).length > 30) break;
    }
    return best;
  }
  function activateElement(element) {
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    element.focus?.({ preventScroll: true });
    const view = element.ownerDocument.defaultView;
    const box = element.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true, view, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, button: 0, buttons: 1 };
    if (view.PointerEvent) element.dispatchEvent(new view.PointerEvent("pointerdown", { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    element.dispatchEvent(new view.MouseEvent("mousedown", init));
    if (view.PointerEvent) element.dispatchEvent(new view.PointerEvent("pointerup", { ...init, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    element.dispatchEvent(new view.MouseEvent("mouseup", { ...init, buttons: 0 }));
    element.dispatchEvent(new view.MouseEvent("click", { ...init, buttons: 0 }));
  }
  async function selectFiveMinute() {
    if (timeframeIsFive()) return false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const trigger = timeframeTrigger();
      if (!trigger) throw new Error("Controle do gráfico não localizado");
      activateElement(trigger.element);
      const option = await waitFor(fiveMinuteOption, 1200, 30);
      if (!option) continue;
      const target = attempt % 2 === 0 ? clickableOption(option) : option;
      activateElement(target);
      if (await waitFor(timeframeIsFive, 1500, 30)) return true;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      await sleep(80);
    }
    throw new Error("A opção 5 minutos abriu, mas a Hezilex não confirmou a seleção");
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
  function moneyFromHost(host) {
    const values = [...host.querySelectorAll('input,[contenteditable="true"],[role="spinbutton"],strong,b,span,div')]
      .filter(element => element.tagName === "INPUT" || visible(element))
      .map(element => element.tagName === "INPUT" ? element.value : compact(element.textContent))
      .filter(text => text && text.length < 40)
      .map(text => ({
        raw: text,
        match: text.match(/(?:R\$|\$)?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:[.,]\d{1,2})?)/)?.[1]
      }))
      .filter(item => item.match)
      .map(item => ({ value: parseBRL(item.match), score: /R\$|\$/.test(item.raw) ? 20 : /[.,]\d{1,2}\b/.test(item.raw) ? 10 : 0 }))
      .filter(item => Number.isFinite(item.value))
      .sort((left, right) => right.score - left.score);
    return values[0]?.value ?? null;
  }
  function controlLabel(element) {
    return compact(`${element?.textContent || ""} ${element?.value || ""} ${element?.getAttribute?.("aria-label") || ""} ${element?.getAttribute?.("title") || ""}`);
  }
  function adjustmentButtons(host) {
    const buttons = [...host.querySelectorAll('button,[role="button"],[tabindex],[onclick]')].filter(visible);
    const minus = buttons.find(button => /^(?:-|−|–)$/.test(controlLabel(button)) || /diminuir|menos|decrease/i.test(controlLabel(button)));
    const plus = buttons.find(button => /^\+$/.test(controlLabel(button)) || /aumentar|mais|increase/i.test(controlLabel(button)));
    return { minus, plus };
  }
  function amountHostScore(host) {
    const text = compact(host.textContent);
    const identity = compact(`${host.id || ""} ${host.className || ""} ${host.getAttribute?.("data-tour") || ""} ${host.getAttribute?.("data-testid") || ""}`);
    const box = host.getBoundingClientRect();
    let score = 0;
    if (/tour_amount|amount/i.test(identity)) score += 360;
    if (/(^|\s)valor(?:\s|$)/i.test(text)) score += 190;
    if (/R\$|\$/.test(text)) score += 120;
    if (/expira[cç][aã]o|lucro|payout/i.test(text)) score -= 260;
    if (box.width <= 260) score += 40;
    if (box.height <= 180) score += 25;
    return score;
  }
  function locateAmountControl() {
    const hosts = new Set();
    for (const doc of allDocuments()) {
      const directNodes = [...doc.querySelectorAll('#tour_amount,[data-tour*="amount" i],[data-testid*="amount" i],[id*="amount" i],[class*="amount" i]')];
      for (const node of directNodes) {
        let current = node;
        for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
          if (visible(current) && current.getBoundingClientRect().width <= 540) hosts.add(current);
          if (/\bvalor\b/i.test(compact(current.textContent)) && current.querySelector('button,[role="button"],[tabindex]')) break;
        }
      }
      for (const label of [...doc.querySelectorAll("div,section,span,label")].filter(visible)) {
        if (!/^(?:valor|amount)$/i.test(compact(label.textContent))) continue;
        let current = label.parentElement;
        for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
          if (visible(current) && current.getBoundingClientRect().width <= 540) hosts.add(current);
          if (moneyFromHost(current) != null && current.querySelector('button,[role="button"],[tabindex]')) break;
        }
      }
      const adjusters = [...doc.querySelectorAll('button,[role="button"],[tabindex],[onclick]')]
        .filter(visible)
        .filter(element => /^(?:\+|-|−|–)$/.test(controlLabel(element)));
      for (const adjuster of adjusters) {
        let current = adjuster.parentElement;
        for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
          if (!visible(current) || current.getBoundingClientRect().width > 540) continue;
          const pair = adjustmentButtons(current);
          if (pair.plus && pair.minus && moneyFromHost(current) != null) hosts.add(current);
        }
      }
    }
    const ranked = [...hosts].sort((left, right) => {
      const score = amountHostScore(right) - amountHostScore(left);
      if (score) return score;
      return left.getBoundingClientRect().width * left.getBoundingClientRect().height - right.getBoundingClientRect().width * right.getBoundingClientRect().height;
    });
    for (const host of ranked) {
      if (!visible(host) || host.getBoundingClientRect().width > 540) continue;
      const input = [...host.querySelectorAll('input.form-control,input[type="number"],input[type="text"],input,[contenteditable="true"],[role="spinbutton"]')]
        .find(element => element.tagName === "INPUT" || visible(element)) || null;
      const { minus, plus } = adjustmentButtons(host);
      const amount = input?.tagName === "INPUT" ? parseBRL(input.value) : moneyFromHost(host);
      if (amount == null) continue;
      return {
        host,
        input: input || null,
        amount,
        minus,
        plus
      };
    }
    return null;
  }

  async function detectAccount(force = false) {
    const resumeText = compact(document.querySelector(".account-resume")?.textContent);
    const selectedName = /conta\s+demo/i.test(resumeText) ? "Conta Demo" : /conta\s+(?:principal|real)/i.test(resumeText) ? "Conta Principal" : null;
    if (!force && Date.now() - internal.lastAccountCheckAt < 10000 && internal.state.account.name === selectedName) return internal.state.account;
    internal.lastAccountCheckAt = Date.now();
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
    return internal.state.account;
  }

  async function inspect() {
    const instrument = activeInstrument();
    const expiration = locateExpirationControl();
    const balance = detectBalance();
    const previousAsset = internal.state.asset;
    const previousBalance = internal.state.balance;
    const buttons = timeframeButtons();
    const activeTimeframe = timeframeTrigger();
    const selectedFive = timeframeIsFive();
    internal.state.asset = instrument.asset;
    internal.state.symbol = instrument.symbol;
    internal.state.timeframe = selectedFive ? "5m" : (activeTimeframe?.text || activeTimeframe?.label || null);
    internal.state.expiration = expiration?.minutes ? `${expiration.minutes} min` : null;
    internal.state.defaults = { timeframe: selectedFive, expiration: expiration?.minutes === 5 };
    internal.state.balance = balance.value;
    internal.state.balanceConfidence = balance.confidence;
    internal.state.chartDetected = queryAll("canvas,svg").some(visible);
    internal.state.userActive = Date.now() - internal.lastUserActivity < 2200;
    internal.state.lastInspectionAt = new Date().toISOString();
    await detectAccount();
    const baseAmount = balance.value == null ? null : Math.max(1, Math.round(balance.value * BASE_RISK * 100) / 100);
    internal.state.risk = {
      percent: 1,
      baseAmount
    };
    if (instrument.asset && instrument.asset !== previousAsset) {
      internal.state.assetChangedAt = internal.state.lastInspectionAt;
      internal.lastAnalysisAt = 0;
      renderMarkings([]);
      logEvent("Ativo alterado", `${instrument.asset} detectado. Ajustando velas e expiração para 5 minutos.`, "success", `asset-${instrument.asset}`);
    }
    if (balance.value != null && balance.value !== previousBalance) {
      logEvent("Saldo verificado", `R$ ${formatMoney(balance.value)}: valor de referência calculado em R$ ${formatMoney(baseAmount)} (1%).`, "success", `balance-${balance.value}`);
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
      changed = await selectFiveMinute() || changed;
      logEvent("Velas ajustadas", "Timeframe alterado automaticamente para 5 minutos.", "success", `timeframe-${internal.state.asset || "current"}`);
    }
    let expiration = locateExpirationControl();
    for (let attempt = 0; expiration?.minutes && expiration.minutes !== 5 && attempt < 20; attempt += 1) {
      const control = expiration.minutes < 5 ? expiration.plus : expiration.minus;
      if (!control) break;
      const before = expiration.minutes;
      activateElement(control);
      changed = true;
      expiration = await waitFor(() => {
        const next = locateExpirationControl();
        return next?.minutes !== before ? next : null;
      }, 650, 40) || locateExpirationControl();
    }
    await inspect();
    if (internal.state.defaults.timeframe && internal.state.defaults.expiration) logEvent("Configuração confirmada", "Velas de 5m e expiração de 5 min estão ativas.", "success", `defaults-ok-${internal.state.asset || "current"}`);
    return { changed, blocked: false, state: snapshot() };
  }

  async function setTimeframeFive() {
    await inspect();
    if (internal.state.defaults.timeframe) return { changed: false, state: snapshot() };
    await selectFiveMinute();
    await inspect();
    if (!internal.state.defaults.timeframe) throw new Error("A Hezilex não confirmou o gráfico em 5 minutos");
    logEvent("Gráfico configurado", "Timeframe ajustado para 5 minutos pelo macro.", "success", `macro-timeframe-${Date.now()}`);
    await publishState();
    return { changed: true, state: snapshot() };
  }

  async function setExpirationFive() {
    await inspect();
    let expiration = locateExpirationControl();
    if (!expiration) throw new Error("Controle de expiração não localizado");
    let changed = false;
    for (let attempt = 0; expiration.minutes !== 5 && attempt < 20; attempt += 1) {
      const control = expiration.minutes < 5 ? expiration.plus : expiration.minus;
      if (!control) throw new Error("Botão de ajuste da expiração não localizado");
      const before = expiration.minutes;
      activateElement(control);
      changed = true;
      expiration = await waitFor(() => {
        const next = locateExpirationControl();
        return next?.minutes !== before ? next : null;
      }, 650, 40) || locateExpirationControl();
      if (!expiration) break;
    }
    await inspect();
    if (!internal.state.defaults.expiration) throw new Error("A Hezilex não confirmou a expiração em 5 minutos");
    logEvent("Expiração configurada", "Expiração ajustada para 5 minutos pelo macro.", "success", `macro-expiration-${Date.now()}`);
    await publishState();
    return { changed, state: snapshot() };
  }

  async function setRiskOnePercent() {
    await inspect();
    const amount = internal.state.risk.baseAmount;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Saldo não localizado para calcular 1%");
    await applyRiskAmount(amount);
    logEvent("Valor configurado", `Campo ajustado para R$ ${formatMoney(amount)}, equivalente a 1% do saldo exibido.`, "success", `macro-risk-${Date.now()}`);
    await publishState();
    return { changed: true, amount, state: snapshot() };
  }

  async function applySetup() {
    const defaults = await ensureDefaults();
    if (defaults.blocked) throw new Error("Espere um instante sem mexer na tela e tente novamente");
    if (!internal.state.defaults.timeframe || !internal.state.defaults.expiration) throw new Error("A Hezilex não confirmou gráfico e expiração em 5 minutos");
    await setRiskOnePercent();
    return { changed: true, state: snapshot() };
  }

  function chartViewport() {
    const anchor = queryAll("canvas").filter(visible).sort((a, b) => {
      const aa = a.getBoundingClientRect();
      const bb = b.getBoundingClientRect();
      return bb.width * bb.height - aa.width * aa.height;
    })[0];
    if (!anchor) return null;
    return { anchor, doc: anchor.ownerDocument, box: anchor.getBoundingClientRect() };
  }
  function nativeToolButton(doc, type) {
    const selectors = type === "PROTECTION"
      ? ['[data-name*="horizontal-line" i]', '[data-name*="linetoolhorizontal" i]', '[data-tool*="horizontal" i]', '[class*="horizontal-line" i]', '[aria-label*="horizontal line" i]', '[aria-label*="linha horizontal" i]', '[title*="horizontal line" i]', '[title*="linha horizontal" i]']
      : ['[data-name*="trend-line" i]', '[data-name*="trendline" i]', '[data-name*="linetooltrendline" i]', '[data-tool*="trend" i]', '[class*="trend-line" i]', '[class*="trendline" i]', '[aria-label*="trend line" i]', '[aria-label*="linha de tend" i]', '[title*="trend line" i]', '[title*="linha de tend" i]'];
    for (const selector of selectors) {
      const match = [...doc.querySelectorAll(selector)].find(visible);
      if (!match) continue;
      return match.closest('button,[role="button"],[tabindex],[onclick]') || match;
    }
    return null;
  }
  function nativeMenuChoice(doc, type) {
    const matcher = type === "PROTECTION" ? /linha horizontal|horizontal line/i : /linha de tend[eê]ncia|trend line/i;
    return [...doc.querySelectorAll('[role="menuitem"], [role="option"], button, [class*="item" i], [data-name], [data-tool]')]
      .filter(visible)
      .find(element => matcher.test(compact(`${element.textContent} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${element.getAttribute("data-tooltip") || ""}`))) || null;
  }
  async function openNativeDrawingChoice(doc, type, viewport) {
    const directChoice = nativeMenuChoice(doc, type);
    if (directChoice) return directChoice;
    const exactTool = nativeToolButton(doc, type);
    if (exactTool) {
      activateElement(exactTool);
      const choice = await waitFor(() => nativeMenuChoice(doc, type), 500, 25);
      if (choice) return choice;
    }
    const chartBox = viewport.anchor.getBoundingClientRect();
    const candidates = [...doc.querySelectorAll('button,[role="button"],[data-tooltip],[tabindex]')]
      .filter(visible)
      .filter(element => {
        const box = element.getBoundingClientRect();
        return box.width >= 20 && box.width <= 72 && box.height >= 20 && box.height <= 72
          && box.left >= chartBox.left - 100 && box.left <= chartBox.left + 110
          && box.top >= chartBox.top - 16 && box.bottom <= chartBox.bottom + 16;
      })
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
    for (const candidate of candidates) {
      activateElement(candidate);
      const choice = await waitFor(() => nativeMenuChoice(doc, type), 260, 20);
      if (choice) return choice;
      doc.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      await sleep(25);
    }
    return null;
  }
  function dispatchChartPoint(doc, x, y) {
    const target = doc.elementFromPoint(x, y);
    if (!target) return false;
    const view = doc.defaultView;
    const common = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
    target.dispatchEvent(new view.MouseEvent("mousemove", { ...common, buttons: 0 }));
    if (view.PointerEvent) target.dispatchEvent(new view.PointerEvent("pointerdown", { ...common, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    target.dispatchEvent(new view.MouseEvent("mousedown", { ...common, buttons: 1 }));
    if (view.PointerEvent) target.dispatchEvent(new view.PointerEvent("pointerup", { ...common, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    target.dispatchEvent(new view.MouseEvent("mouseup", { ...common, buttons: 0 }));
    target.dispatchEvent(new view.MouseEvent("click", { ...common, buttons: 0 }));
    return true;
  }
  async function drawNativeLine(line) {
    let viewport = chartViewport();
    if (!viewport) return false;
    const { doc } = viewport;
    const choice = await openNativeDrawingChoice(doc, line.type, viewport);
    if (!choice) return false;
    activateElement(clickableOption(choice));
    await sleep(90);
    if (nativeMenuChoice(doc, line.type)) return false;
    viewport = chartViewport();
    if (!viewport || viewport.doc !== doc) return false;
    const box = viewport.anchor.getBoundingClientRect();
    const plot = {
      left: box.left + Math.max(26, box.width * .035),
      top: box.top + Math.max(25, box.height * .045),
      width: box.width * .88,
      height: box.height * .86
    };
    const start = { x: plot.left + clamp(line.x1 || 0) * plot.width, y: plot.top + clamp(line.y1) * plot.height };
    const end = line.type === "PROTECTION"
      ? { x: plot.left + plot.width * .84, y: start.y }
      : { x: plot.left + clamp(line.x2 ?? 1) * plot.width, y: plot.top + clamp(line.y2 ?? line.y1) * plot.height };
    const first = dispatchChartPoint(doc, start.x, start.y);
    await sleep(95);
    const second = dispatchChartPoint(doc, end.x, end.y);
    await sleep(120);
    doc.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    return first && second;
  }
  function removeAtlasOverlay() {
    for (const doc of allDocuments()) {
      doc.querySelectorAll('#__atlas_guard_chart_overlay,[id^="__atlas_guard_chart_overlay"],[data-atlas-marking-overlay],.atlas-chart-marking').forEach(element => element.remove());
    }
  }
  function nativeTypesForAsset(assetKey) {
    return ["LTA", "LTB", "PROTECTION"].filter(type => internal.nativeDrawing.signatures.has(`${assetKey}:${type}`));
  }
  function updateNativeMarkingState(lines = internal.markings) {
    const assetKey = internal.state.symbol || internal.state.asset || "current";
    const requested = new Set(lines.map(line => line.type));
    const native = nativeTypesForAsset(assetKey).filter(type => requested.has(type));
    internal.state.markings = {
      lta: native.includes("LTA"),
      ltb: native.includes("LTB"),
      protection: native.includes("PROTECTION"),
      total: native.length,
      source: native.length ? "native-hezilex" : null
    };
  }
  function scheduleNativeMarkings(lines, source) {
    if (source !== "official-5m-feed" || !lines.length || internal.state.userActive) return;
    const assetKey = internal.state.symbol || internal.state.asset || "current";
    internal.nativeDrawing.task = internal.nativeDrawing.task.then(async () => {
      if (Date.now() - internal.lastUserActivity < 2200) return;
      let rendered = 0;
      for (const line of lines) {
        const signature = `${assetKey}:${line.type}`;
        if (internal.nativeDrawing.signatures.has(signature)) continue;
        if (await drawNativeLine(line)) {
          internal.nativeDrawing.signatures.set(signature, true);
          rendered += 1;
        }
      }
      updateNativeMarkingState(lines);
      if (rendered) {
        logEvent("Linhas fixadas no gráfico", `${lines.map(line => line.type).join(" e ")} criadas com a ferramenta nativa da Hezilex.`, "success", `native-lines-${assetKey}-${lines.map(line => line.type).join("-")}`);
        await publishState();
      }
    }).catch(error => logEvent("Marcação nativa aguardando", error.message, "warning", `native-lines-wait-${assetKey}`));
  }
  function renderMarkings(lines = [], source = null) {
    internal.markings = lines.slice(0, MAX_MARKINGS).filter(line => ["LTA", "LTB", "PROTECTION"].includes(line.type));
    removeAtlasOverlay();
    updateNativeMarkingState(internal.markings);
    scheduleNativeMarkings(internal.markings, source);
    return { rendered: internal.state.markings.total, source: internal.state.markings.source };
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
    return { type, x1, y1: clamp(y1), x2: x2Point, y2: clamp(y2Point) };
  }

  async function analyzeChart() {
    let raw;
    try { raw = await fetchMarketCandles(); } catch (error) {
      internal.state.analysis = { direction: "WAIT", confidence: 0, reason: `Feed oficial indisponível: ${error.message}` };
      return internal.state.analysis;
    }
    const live = raw.at(-1);
    const history = raw.filter(item => item.time + 300000 <= Date.now()).slice(-80);
    const visibleCandles = history.slice(-24);
    const candles = history;
    if (candles.length < 30) {
      renderMarkings([], null);
      internal.state.analysis = { direction: "WAIT", confidence: 0, reason: "Histórico oficial insuficiente", source: "official-5m-feed", candles: candles.length };
      return internal.state.analysis;
    }
    const values = visibleCandles.flatMap(item => [item.high, item.low]);
    const minimum = Math.min(...values);
    const priceRange = Math.max(...values) - minimum || 1;
    const lowPair = swings(visibleCandles, "low", "low").slice(-2);
    const highPair = swings(visibleCandles, "high", "high").slice(-2);
    const hasLta = lowPair.length === 2 && lowPair[1].index - lowPair[0].index >= 3 && lowPair[1].value > lowPair[0].value;
    const hasLtb = highPair.length === 2 && highPair[1].index - highPair[0].index >= 3 && highPair[1].value < highPair[0].value;
    const lines = [];
    if (hasLta) lines.push(trendLine("LTA", lowPair[0], lowPair[1], visibleCandles, minimum, priceRange));
    if (hasLtb) lines.push(trendLine("LTB", highPair[0], highPair[1], visibleCandles, minimum, priceRange));
    const recentRanges = candles.slice(-21, -1).map(item => item.high - item.low);
    const averageRange = recentRanges.reduce((sum, value) => sum + value, 0) / recentRanges.length;
    const last = candles.at(-1);
    const spike = averageRange > 0 && last.high - last.low > averageRange * 2.35;
    internal.trendLines = lines;
    const closes = candles.map(item => item.close);
    const ema9 = ema(closes.slice(-36), 9);
    const ema21 = ema(closes.slice(-60), 21);
    const momentum = last.close - candles.at(-4).close;
    const bullish = candles.slice(-5).filter(item => item.close > item.open).length;
    const bearish = candles.slice(-5).filter(item => item.close < item.open).length;
    let direction = "WAIT";
    let confidence = 0;
    let reason = "Critérios mínimos ainda não foram atingidos";
    if (spike) reason = "Pico de volatilidade: aguarde a amplitude normalizar";
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
    internal.state.analysis = {
      direction,
      confidence: Math.min(94, confidence),
      reason,
      source: "official-5m-feed",
      candles: candles.length,
      candleTime: last.time,
      lastPrice: Number.isFinite(live?.close) ? live.close : last.close,
      averageRange,
      priceMinimum: minimum,
      priceRange,
      volatilitySpike: spike
    };
    refreshNativeMarkings();
    updateProtectionOpportunity();
    if (spike) logEvent("Proteção contra pico", `${internal.state.asset}: nenhuma entrada durante esta janela.`, "danger", `spike-${internal.state.symbol}-${last.time}`);
    else if (direction === "WAIT") logEvent("Sem entrada", `${internal.state.asset}: ${reason}.`, "info", `wait-${internal.state.symbol}-${last.time}`);
    else logEvent(`Cenário de ${direction === "BUY" ? "COMPRA" : "VENDA"}`, `${reason}. Confiança ${internal.state.analysis.confidence}%.`, "signal", `signal-${internal.state.symbol}-${direction}-${last.time}`);
    if (hasLta || hasLtb) logEvent("Marcações atualizadas", `${lines.filter(line => /LT[AB]/.test(line.type)).map(line => line.type).join(" e ")} com ${candles.length} velas oficiais.`, "success", `lines-${internal.state.symbol}-${last.time}`);
    return internal.state.analysis;
  }

  function setEditableValue(input, value) {
    const view = input.ownerDocument.defaultView;
    input.focus();
    if (input.tagName === "INPUT") Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set?.call(input, value);
    else input.textContent = value;
    input.dispatchEvent(new view.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    input.dispatchEvent(new view.Event("change", { bubbles: true }));
    input.dispatchEvent(new view.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    input.dispatchEvent(new view.KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    input.blur();
  }
  async function applyRiskAmount(amount) {
    let control = locateAmountControl();
    const fallbackInput = queryAll('input.form-control,input,[contenteditable="true"],[role="spinbutton"]').find(item => {
      const identity = `${item.name || ""} ${item.id || ""} ${item.className || ""} ${item.placeholder || ""} ${item.getAttribute("aria-label") || ""}`;
      const context = compact(item.parentElement?.parentElement?.textContent || item.parentElement?.textContent || "");
      return /valor|amount|tour_amount/i.test(`${identity} ${context}`) && !/expira[cç][aã]o/i.test(context);
    });
    const input = control?.input || fallbackInput;
    if (input) {
      const formatted = input.tagName === "INPUT" && input.type === "number" ? Number(amount).toFixed(2) : Number(amount).toFixed(2).replace(".", ",");
      setEditableValue(input, formatted);
      const current = await waitFor(() => {
        const value = parseBRL(input.tagName === "INPUT" ? input.value : input.textContent);
        return value != null && Math.abs(value - amount) <= .51 ? value : null;
      }, 450, 30);
      if (current != null) return current;
    }

    control = locateAmountControl();
    if (!control || (!control.plus && !control.minus)) throw new Error("Controle de valor não localizado");
    if (Math.abs(control.amount - amount) <= .51) return control.amount;
    if (!input) {
      const display = [...control.host.querySelectorAll("strong,b,span,div")]
        .filter(visible)
        .find(element => parseBRL(compact(element.textContent)) === control.amount && compact(element.textContent).length < 20);
      display?.click();
      const openedInput = await waitFor(() => locateAmountControl()?.input, 650, 25);
      if (openedInput) {
        const formatted = openedInput.tagName === "INPUT" && openedInput.type === "number" ? Number(amount).toFixed(2) : Number(amount).toFixed(2).replace(".", ",");
        setEditableValue(openedInput, formatted);
        const direct = await waitFor(() => {
          const current = locateAmountControl()?.amount;
          return current != null && Math.abs(current - amount) <= .51 ? current : null;
        }, 450, 30);
        if (direct != null) return direct;
      }
    }
    const direction = amount > control.amount ? "plus" : "minus";
    let button = control[direction];
    if (!button) throw new Error(`Botão para ${direction === "plus" ? "aumentar" : "diminuir"} o valor não localizado`);
    const start = control.amount;
    button.click();
    control = await waitFor(() => {
      const next = locateAmountControl();
      return next && next.amount !== start ? next : null;
    }, 700, 35);
    if (!control) {
      const unchanged = locateAmountControl();
      if (unchanged && direction === "minus" && unchanged.amount > amount) return unchanged.amount;
      throw new Error("A Hezilex não respondeu ao ajuste do valor");
    }
    const step = Math.abs(control.amount - start);
    if (!Number.isFinite(step) || step <= 0) throw new Error("Não foi possível identificar o intervalo do valor");
    const nearest = Math.max(step, Math.round(amount / step) * step);
    if (Math.round(Math.abs(nearest - control.amount) / step) > 300) throw new Error("O valor calculado está distante demais para o controle atual");
    for (let frame = 0; frame < 360; frame += 1) {
      control = locateAmountControl();
      if (!control || Math.abs(control.amount - nearest) <= step / 2 + .011) break;
      const liveDirection = nearest > control.amount ? "plus" : "minus";
      const remaining = Math.max(1, Math.round(Math.abs(nearest - control.amount) / step));
      const burst = Math.min(24, remaining);
      button = control[liveDirection];
      if (!button) break;
      for (let index = 0; index < burst; index += 1) button.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const confirmed = await waitFor(() => {
      const value = locateAmountControl()?.amount;
      return value != null && Math.abs(value - nearest) <= step / 2 + .011 ? value : null;
    }, 1400, 55);
    if (confirmed == null) throw new Error("A Hezilex não confirmou o valor mais próximo de 1%");
    return confirmed;
  }
  function operationOutcome(item) {
    const numericStatus = Number(item.status);
    if (numericStatus === 2) return "WIN";
    if (numericStatus === 3) return "LOSS";
    if (numericStatus === 4) return "DRAW";
    const status = compact(item.status).toLowerCase();
    const amount = Number(item.amount ?? Number(item.amount_cents || 0) / 100);
    const returned = Number(item.return ?? Number(item.return_cents || 0) / 100);
    if (/win|won|ganh|success|profit/.test(status) || returned > amount) return "WIN";
    if (/loss|lost|perd|fail/.test(status) || (/clos|finish|expir/.test(status) && returned <= amount)) return "LOSS";
    if (/draw|tie|empate|refund/.test(status)) return "DRAW";
    return "OPEN";
  }
  async function observeManualOperation() {
    if (Date.now() - internal.lastHistoryCheckAt < 1500) return;
    internal.lastHistoryCheckAt = Date.now();
    try {
      const response = await fetch("/binary/history/0", { credentials: "include", cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const history = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
      const latest = history.sort((left, right) => Number(right.created_at_timestamp || right.expiration_timestamp || right.id || 0) - Number(left.created_at_timestamp || left.expiration_timestamp || left.id || 0))[0];
      if (!latest) return;
      const outcome = operationOutcome(latest);
      const id = String(latest.id ?? latest.operation_id ?? latest.created_at_timestamp ?? latest.expiration_timestamp ?? "latest");
      const key = `${id}-${outcome}`;
      if (key === internal.lastObservedOperationKey) return;
      const rawTimestamp = Number(latest.updated_at_timestamp || latest.expiration_timestamp || latest.created_at_timestamp || 0);
      const eventTimestamp = rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
      const firstObservation = internal.lastObservedOperationKey == null;
      internal.lastObservedOperationKey = key;
      if (firstObservation && (!eventTimestamp || Date.now() - eventTimestamp > 15 * 60 * 1000)) return;
      const directionText = compact(latest.direction || latest.type || latest.operation || latest.option_type).toLowerCase();
      const direction = /buy|call|up|compra|alta/.test(directionText) ? "BUY" : /sell|put|down|venda|baixa/.test(directionText) ? "SELL" : null;
      const asset = normalizeAssetName(latest.asset || latest.symbol || latest.instrument || internal.state.asset);
      const recentClick = internal.lastManualClick;
      const sameClick = outcome === "OPEN" && recentClick && Date.now() - recentClick.at < 12000
        && recentClick.direction === direction;
      if (sameClick) return;
      internal.state.manualOperation = {
        key,
        asset,
        direction,
        outcome,
        amount: Number(latest.amount ?? Number(latest.amount_cents || 0) / 100) || null,
        analysisDirection: internal.state.analysis.direction,
        analysisConfidence: internal.state.analysis.confidence,
        analysisReason: internal.state.analysis.reason,
        observedAt: new Date().toISOString()
      };
    } catch { /* o humor continua sem o histórico */ }
  }
  function cleanupExpiredMarkings() {
    const protectionExpired = internal.state.protection?.active
      && Number(internal.state.protection.expiresAt) <= Date.now();
    const active = internal.markings.filter(line => !line.expiresAt || line.expiresAt > Date.now());
    if (protectionExpired || active.length !== internal.markings.length) {
      internal.state.protection.active = false;
      internal.state.protection.ready = false;
      internal.state.protection.status = "expired";
      internal.nativeDrawing.signatures.delete(`${internal.state.protection.symbol || internal.state.symbol || internal.state.asset}:PROTECTION`);
      refreshNativeMarkings();
      logEvent("Linha de proteção removida", "A vela terminou e a marcação temporária foi limpa.", "success", `protection-clean-${Date.now()}`);
    }
  }
  function snapshot() {
    return {
      ...internal.state,
      account: { ...internal.state.account }, defaults: { ...internal.state.defaults }, analysis: { ...internal.state.analysis },
      protection: { ...internal.state.protection }, risk: { ...internal.state.risk }, markings: { ...internal.state.markings },
      events: internal.state.events.map(event => ({ ...event }))
    };
  }
  async function publishState() {
    try { await chrome.runtime.sendMessage({ type: "state_update", state: snapshot() }); } catch { /* painel indisponível */ }
  }

  async function monitorCycle(forceAnalysis = false) {
    if (internal.macroActive && !forceAnalysis) return snapshot();
    await inspect();
    const changedAsset = internal.state.asset && internal.state.asset !== internal.lastAsset;
    const candleChanged = fiveMinuteBoundary() > Number(internal.state.analysis.candleTime || 0);
    const protectionNeedsLivePrice = internal.state.protection?.active && internal.state.protection.asset === internal.state.asset;
    if (internal.state.chartDetected && (forceAnalysis || changedAsset || candleChanged || protectionNeedsLivePrice || Date.now() - internal.lastAnalysisAt > 12000)) {
      await analyzeChart();
      internal.lastAnalysisAt = Date.now();
    }
    await refreshArmedProtection();
    await observeManualOperation();
    cleanupExpiredMarkings();
    internal.lastAsset = internal.state.asset;
    await publishState();
    return snapshot();
  }

  async function dispatchCommand(command) {
    if (command.action === "ping") return snapshot();
    if (command.action === "inspect") return monitorCycle(false);
    if (command.action === "ensure_defaults") return ensureDefaults();
    if (command.action === "set_timeframe") return setTimeframeFive();
    if (command.action === "set_expiration") return setExpirationFive();
    if (command.action === "set_risk") return setRiskOnePercent();
    if (command.action === "apply_setup") return applySetup();
    if (command.action === "set_markings") return renderMarkings(command.lines || [], "dashboard");
    if (["start", "buy", "sell", "place_order"].includes(command.action)) throw new Error("O Atlas analisa e configura a tela, mas não executa operações.");
    throw new Error("Ação desconhecida");
  }
  function enqueue(command) {
    const run = internal.task.then(async () => {
      internal.macroActive = command.action !== "ping" && command.action !== "inspect";
      try { return await dispatchCommand(command); }
      finally { internal.macroActive = false; }
    });
    internal.task = run.catch(() => {});
    return run;
  }

  function scheduleMonitor(forceAnalysis = false) {
    if (internal.macroActive) return internal.monitorPromise || Promise.resolve(snapshot());
    if (internal.monitorPromise) return internal.monitorPromise;
    internal.monitorPromise = monitorCycle(forceAnalysis).finally(() => { internal.monitorPromise = null; });
    return internal.monitorPromise;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "atlas_dashboard_command") return false;
    if (message.command?.action === "ping") {
      sendResponse({ ok: true, type: "result", result: snapshot(), state: snapshot() });
      return false;
    }
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
    internal.mutationTimer = setTimeout(() => scheduleMonitor(false), 180);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-selected", "aria-pressed"] });
  setInterval(() => scheduleMonitor(false), 2000);
  (async () => {
    removeAtlasOverlay();
    logEvent("Monitor conectado", "O Atlas iniciou o acompanhamento contínuo usando o feed oficial de 5 minutos.", "success", "monitor-connected");
    await scheduleMonitor(true);
    const origin = parentOrigin();
    if (await originAllowed(origin)) window.parent.postMessage({ source: BRIDGE_SOURCE, type: "ready", state: snapshot() }, origin);
  })();
})();
