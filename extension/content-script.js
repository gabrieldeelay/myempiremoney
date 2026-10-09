(() => {
  if (window.__atlasGuardBridgeLoaded) return;
  window.__atlasGuardBridgeLoaded = true;

  const VERSION = "1.0.0";
  const BRIDGE_SOURCE = "atlas-guard-extension";
  const DASHBOARD_SOURCE = "atlas-guard-dashboard";
  const MINIMUM_BALANCE = 500;
  const MAX_MARKINGS = 8;
  const internal = {
    mode: "stopped",
    task: Promise.resolve(),
    lastUserActivity: 0,
    markings: [],
    eventSequence: 0,
    lastAsset: null,
    lastAnalysisAt: 0,
    monitorTimer: null,
    mutationTimer: null,
    state: {
      bridge: "ready",
      version: VERSION,
      mode: "stopped",
      monitoring: true,
      balance: null,
      balanceConfidence: null,
      asset: null,
      assetChangedAt: null,
      timeframe: null,
      expiration: null,
      defaults: { timeframe: false, expiration: false },
      userActive: false,
      chartDetected: false,
      analysis: { direction: "WAIT", confidence: 0, reason: "Aguardando dados reais da Traderoom" },
      protection: { active: false, reason: null },
      markings: { lta: false, ltb: false, total: 0, source: null },
      gale: { current: 0, maximum: 2 },
      realOrderExecution: false,
      events: [],
      lastInspectionAt: null
    }
  };

  for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    addEventListener(eventName, event => {
      if (event.isTrusted) internal.lastUserActivity = Date.now();
    }, { capture: true, passive: true });
  }

  function compact(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
  function visible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0 && box.width > 1 && box.height > 1;
  }

  function logEvent(title, detail, level = "info", key = title) {
    const last = internal.state.events[0];
    if (last?.key === key && Date.now() - new Date(last.at).getTime() < 12000) return;
    internal.eventSequence += 1;
    internal.state.events.unshift({
      id: `${Date.now()}-${internal.eventSequence}`,
      key,
      title,
      detail,
      level,
      at: new Date().toISOString()
    });
    internal.state.events = internal.state.events.slice(0, 40);
  }

  function parentOrigin() {
    try { return document.referrer ? new URL(document.referrer).origin : null; } catch { return null; }
  }

  async function originAllowed(origin) {
    if (!origin) return false;
    const response = await chrome.runtime.sendMessage({ type: "is_origin_allowed", origin });
    return Boolean(response?.allowed);
  }

  function parseBRL(raw) {
    const normalized = String(raw || "").replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function detectBalance() {
    const elements = [...document.querySelectorAll('[data-balance],[class*="balance" i],[class*="saldo" i],span,div,strong,b')]
      .filter(visible);
    const seen = new Set();
    const candidates = [];
    for (const element of elements) {
      const text = compact(element.textContent);
      const match = text.match(/R\$\s*([\d.]+,\d{2})/i);
      if (!match || text.length > 130) continue;
      const box = element.getBoundingClientRect();
      const signature = `${match[1]}:${Math.round(box.left)}:${Math.round(box.top)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      const context = compact(element.closest('[class*="balance" i],[class*="saldo" i]')?.textContent || element.parentElement?.textContent || text).slice(0, 180);
      const className = String(element.className || "");
      const color = getComputedStyle(element).color.match(/\d+/g)?.map(Number) || [];
      let score = 0;
      if (/balance|saldo/i.test(className)) score += 70;
      if (/saldo|conta real|dispon[ií]vel/i.test(context)) score += 45;
      if (box.top < Math.max(130, innerHeight * .18)) score += 25;
      if (box.right > innerWidth * .48) score += 8;
      if (color.length >= 3 && color[1] > color[0] + 20) score += 12;
      if (/valor|lucro|expira[cç][aã]o/i.test(context)) score -= 55;
      candidates.push({ value: parseBRL(match[1]), score, text });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates.find(item => item.value != null);
    if (!best || best.score < 18) return { value: null, confidence: null };
    return { value: best.value, confidence: best.score >= 55 ? "high" : "medium" };
  }

  function timeframeCandidates() {
    return [...document.querySelectorAll('button,[role="button"],a,span,div')]
      .filter(visible)
      .filter(element => /^(?:1m|2m|3m|5m|10m|15m|30m|1h|4h)$/i.test(compact(element.textContent)))
      .map(element => {
        const target = element.closest('button,[role="button"],a') || element;
        const box = target.getBoundingClientRect();
        const active = /active|selected|checked|current/i.test(String(target.className || "")) || target.getAttribute("aria-pressed") === "true" || target.getAttribute("aria-selected") === "true";
        return { target, text: compact(element.textContent), active, box, score: (box.top < innerHeight * .42 ? 12 : 0) + (box.width < 170 ? 5 : 0) + (active ? 40 : 0) };
      })
      .sort((a, b) => b.score - a.score);
  }

  function locateExpirationControl() {
    const labels = [...document.querySelectorAll('div,span,label,strong,b')]
      .filter(visible)
      .filter(element => /expira[cç][aã]o/i.test(compact(element.textContent)) && compact(element.textContent).length < 160);
    for (const label of labels) {
      let host = label;
      for (let depth = 0; host && depth < 5; depth += 1, host = host.parentElement) {
        const text = compact(host.textContent);
        const match = text.match(/(\d+)\s*(?:min|m)\b/i);
        const box = host.getBoundingClientRect();
        if (!match || box.width > 520 || box.height > 320) continue;
        const buttons = [...host.querySelectorAll('button,[role="button"]')].filter(visible);
        const minus = buttons.find(button => /^(?:-|−|–)$/.test(compact(button.textContent)) || /diminuir|menos/i.test(button.getAttribute("aria-label") || ""));
        const plus = buttons.find(button => /^\+$/.test(compact(button.textContent)) || /aumentar|mais/i.test(button.getAttribute("aria-label") || ""));
        return { host, minutes: Number(match[1]), minus, plus };
      }
    }
    return null;
  }

  function detectAsset(bodyText) {
    const match = bodyText.match(/\b(?:EUR|GBP|AUD|NZD|USD|CAD|CHF|JPY|BTC|ETH|SOL|XAU)[\s/\-](?:USD|EUR|GBP|JPY|CAD|CHF)\b/i);
    if (match) return match[0].replace(/\s+/g, "/").replace("-", "/").toUpperCase();
    const named = bodyText.match(/\b(BITCOIN|ETHEREUM|SOLANA|OURO|GOLD)\b/i)?.[1]?.toUpperCase();
    return named || null;
  }

  function inspect() {
    const bodyText = compact(document.body?.innerText).slice(0, 24000);
    const asset = detectAsset(bodyText);
    const timeframes = timeframeCandidates();
    const selectedTimeframe = timeframes.find(item => item.active) || timeframes[0];
    const expiration = locateExpirationControl();
    const balance = detectBalance();
    const previousAsset = internal.state.asset;
    const previousBalance = internal.state.balance;

    internal.state.asset = asset;
    internal.state.timeframe = selectedTimeframe?.text || null;
    internal.state.expiration = expiration?.minutes ? `${expiration.minutes} min` : null;
    internal.state.defaults = {
      timeframe: internal.state.timeframe?.toLowerCase() === "5m",
      expiration: expiration?.minutes === 5
    };
    internal.state.balance = balance.value;
    internal.state.balanceConfidence = balance.confidence;
    internal.state.chartDetected = Boolean(document.querySelector("canvas,svg"));
    internal.state.userActive = Date.now() - internal.lastUserActivity < 2400;
    internal.state.lastInspectionAt = new Date().toISOString();

    if (asset && asset !== previousAsset) {
      internal.lastAsset = previousAsset;
      internal.state.assetChangedAt = internal.state.lastInspectionAt;
      internal.lastAnalysisAt = 0;
      renderMarkings([]);
      logEvent("Ativo alterado", `${asset} detectado. O Atlas iniciou a verificação de 5 minutos.`, "success", `asset-${asset}`);
    }
    if (balance.value != null && balance.value !== previousBalance) {
      const allowed = balance.value > MINIMUM_BALANCE;
      logEvent("Saldo verificado", allowed ? `R$ ${balance.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}: monitoramento pode ser iniciado após sua confirmação.` : `R$ ${balance.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}: robô bloqueado, mínimo superior a R$ 500,00.`, allowed ? "success" : "danger", `balance-${balance.value}`);
    }
    if (!internal.state.chartDetected) internal.state.analysis = { direction: "WAIT", confidence: 0, reason: "Traderoom ainda não detectada" };
    return snapshot();
  }

  function ensureDefaults() {
    inspect();
    if (internal.state.userActive) {
      logEvent("Ajuste adiado", "Interação manual detectada; o Atlas aguardará antes de tocar nos controles.", "warning", "defaults-user-active");
      return { changed: false, blocked: true, reason: "Interação manual recente", state: snapshot() };
    }

    let changed = false;
    const candidates = timeframeCandidates();
    const five = candidates.find(item => item.text.toLowerCase() === "5m");
    if (five && internal.state.timeframe?.toLowerCase() !== "5m") {
      five.target.click();
      changed = true;
      internal.state.timeframe = "5m";
      internal.state.defaults.timeframe = true;
      logEvent("Velas ajustadas", "Timeframe alterado automaticamente para 5 minutos.", "success", `timeframe-${internal.state.asset || "current"}`);
    }

    const expiration = locateExpirationControl();
    if (expiration?.minutes && expiration.minutes !== 5) {
      const control = expiration.minutes < 5 ? expiration.plus : expiration.minus;
      if (control && Math.abs(expiration.minutes - 5) <= 30) {
        control.click();
        changed = true;
        logEvent("Expiração em ajuste", `Expiração encontrada em ${expiration.minutes} min; aproximando de 5 min.`, "warning", `expiration-${internal.state.asset || "current"}-${expiration.minutes}`);
      }
    }
    if (expiration?.minutes === 5) internal.state.defaults.expiration = true;
    if (internal.state.defaults.timeframe && internal.state.defaults.expiration) {
      logEvent("Configuração confirmada", "Velas de 5m e expiração de 5 min estão ativas.", "success", `defaults-ok-${internal.state.asset || "current"}`);
    }
    setTimeout(() => { inspect(); publishState(); }, 500);
    return {
      changed,
      blocked: false,
      timeframe: { found: Boolean(five), verified: internal.state.defaults.timeframe },
      expiration: { found: Boolean(expiration), verified: internal.state.defaults.expiration },
      state: snapshot()
    };
  }

  function chartHost() {
    const anchors = [...document.querySelectorAll("canvas,svg")].filter(visible).sort((a, b) => {
      const aa = a.getBoundingClientRect();
      const bb = b.getBoundingClientRect();
      return bb.width * bb.height - aa.width * aa.height;
    });
    const anchor = anchors[0];
    if (!anchor) return null;
    let host = anchor.parentElement;
    while (host && host !== document.body) {
      const box = host.getBoundingClientRect();
      if (box.width > innerWidth * .34 && box.height > innerHeight * .24) return host;
      host = host.parentElement;
    }
    return anchor.parentElement;
  }

  function renderMarkings(lines = [], source = null) {
    const host = chartHost();
    internal.markings = lines.slice(0, MAX_MARKINGS).filter(line => ["LTA", "LTB", "HORIZONTAL", "PROTECTION"].includes(line.type));
    internal.state.markings = {
      lta: internal.markings.some(line => line.type === "LTA"),
      ltb: internal.markings.some(line => line.type === "LTB"),
      total: internal.markings.length,
      source
    };
    if (!host) return { rendered: 0, reason: "Gráfico não encontrado" };
    let svg = host.querySelector(":scope > #__atlas_guard_chart_overlay");
    if (!svg) {
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "__atlas_guard_chart_overlay";
      svg.setAttribute("viewBox", "0 0 1000 600");
      svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000;overflow:visible";
      host.appendChild(svg);
    }
    svg.replaceChildren();
    for (const line of internal.markings) {
      const element = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const horizontal = line.type === "HORIZONTAL" || line.type === "PROTECTION";
      element.setAttribute("x1", String(horizontal ? 0 : clamp(line.x1 ?? 0) * 1000));
      element.setAttribute("y1", String(clamp(line.y1 ?? .5) * 600));
      element.setAttribute("x2", String(horizontal ? 1000 : clamp(line.x2 ?? 1) * 1000));
      element.setAttribute("y2", String(clamp(line.y2 ?? line.y1 ?? .5) * 600));
      element.setAttribute("stroke", line.type === "PROTECTION" ? "#ffb84d" : line.type === "LTB" ? "#ff647c" : "#b8f53f");
      element.setAttribute("stroke-width", line.type === "PROTECTION" ? "2.5" : "2");
      element.setAttribute("stroke-dasharray", horizontal ? "8 6" : "0");
      svg.appendChild(element);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String((horizontal ? .02 : clamp(line.x1 ?? 0)) * 1000));
      label.setAttribute("y", String(Math.max(18, clamp(line.y1 ?? .5) * 600 - 8)));
      label.setAttribute("fill", line.type === "LTB" ? "#ff647c" : line.type === "PROTECTION" ? "#ffb84d" : "#b8f53f");
      label.setAttribute("font-size", "18");
      label.setAttribute("font-family", "system-ui,sans-serif");
      label.setAttribute("font-weight", "800");
      label.textContent = line.type;
      svg.appendChild(label);
    }
    return { rendered: internal.markings.length };
  }

  function structuredCandles() {
    const raw = [];
    for (const element of document.querySelectorAll('[data-open][data-high][data-low][data-close]')) {
      const open = Number(element.getAttribute("data-open"));
      const high = Number(element.getAttribute("data-high"));
      const low = Number(element.getAttribute("data-low"));
      const close = Number(element.getAttribute("data-close"));
      if ([open, high, low, close].every(Number.isFinite)) raw.push({ open, high, low, close });
    }
    if (raw.length < 12) {
      for (const element of document.querySelectorAll('[aria-label*="open" i],[aria-label*="abertura" i]')) {
        const label = element.getAttribute("aria-label") || "";
        const open = Number(label.match(/(?:open|abertura)\D+([\d.]+)/i)?.[1]);
        const high = Number(label.match(/(?:high|m[aá]xima)\D+([\d.]+)/i)?.[1]);
        const low = Number(label.match(/(?:low|m[ií]nima)\D+([\d.]+)/i)?.[1]);
        const close = Number(label.match(/(?:close|fechamento)\D+([\d.]+)/i)?.[1]);
        if ([open, high, low, close].every(Number.isFinite)) raw.push({ open, high, low, close });
      }
    }
    if (raw.length < 12) return [];
    const values = raw.flatMap(item => [item.high, item.low]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return raw.slice(-80).map((item, index, list) => ({
      x: index / Math.max(1, list.length - 1),
      highY: (max - item.high) / range,
      lowY: (max - item.low) / range,
      midY: (max - (item.open + item.close) / 2) / range,
      direction: item.close >= item.open ? "up" : "down"
    }));
  }

  function visualCandles() {
    const canvases = [...document.querySelectorAll("canvas")].filter(visible).sort((a, b) => b.width * b.height - a.width * a.height);
    let best = [];
    for (const canvas of canvases.slice(0, 3)) {
      if (canvas.width < 280 || canvas.height < 160 || canvas.width * canvas.height > 3500000) continue;
      let context;
      try { context = canvas.getContext("2d", { willReadFrequently: true }); } catch { context = null; }
      if (!context) continue;
      let pixels;
      try { pixels = context.getImageData(0, 0, canvas.width, canvas.height).data; } catch { continue; }
      const columns = [];
      for (let x = 0; x < canvas.width; x += 1) {
        let top = canvas.height;
        let bottom = -1;
        let green = 0;
        let red = 0;
        for (let y = 0; y < canvas.height; y += 2) {
          const offset = (y * canvas.width + x) * 4;
          const r = pixels[offset];
          const g = pixels[offset + 1];
          const b = pixels[offset + 2];
          const a = pixels[offset + 3];
          if (a < 120) continue;
          const isGreen = g > 85 && g > r + 28 && g > b * .72;
          const isRed = r > 100 && r > g + 28 && r > b * .72;
          if (!isGreen && !isRed) continue;
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          if (isGreen) green += 1;
          if (isRed) red += 1;
        }
        columns.push({ x, top, bottom, green, red, active: green + red >= 2 });
      }
      const groups = [];
      let current = null;
      for (const column of columns) {
        if (column.active) {
          if (!current) current = { start: column.x, end: column.x, top: column.top, bottom: column.bottom, green: 0, red: 0, pixels: 0 };
          current.end = column.x;
          current.top = Math.min(current.top, column.top);
          current.bottom = Math.max(current.bottom, column.bottom);
          current.green += column.green;
          current.red += column.red;
          current.pixels += column.green + column.red;
        } else if (current) {
          groups.push(current);
          current = null;
        }
      }
      if (current) groups.push(current);
      const candles = groups
        .filter(group => group.end - group.start + 1 >= 2 && group.end - group.start + 1 <= 28 && group.bottom - group.top >= 4 && group.pixels >= 7)
        .map(group => ({
          x: ((group.start + group.end) / 2) / canvas.width,
          highY: group.top / canvas.height,
          lowY: group.bottom / canvas.height,
          midY: ((group.top + group.bottom) / 2) / canvas.height,
          direction: group.green >= group.red ? "up" : "down"
        }))
        .slice(-80);
      if (candles.length > best.length) best = candles;
    }
    return best;
  }

  function swingPoints(candles, property, mode) {
    const points = [];
    for (let index = 2; index < candles.length - 2; index += 1) {
      const value = candles[index][property];
      const neighbors = [candles[index - 2][property], candles[index - 1][property], candles[index + 1][property], candles[index + 2][property]];
      const match = mode === "max" ? neighbors.every(other => value >= other) : neighbors.every(other => value <= other);
      if (match) points.push({ index, x: candles[index].x, y: value });
    }
    return points;
  }

  function extendedLine(type, first, second) {
    const deltaX = Math.max(.001, second.x - first.x);
    const slope = (second.y - first.y) / deltaX;
    return { type, x1: first.x, y1: first.y, x2: 1, y2: clamp(second.y + slope * (1 - second.x)) };
  }

  function analyzeChart() {
    let source = "structured-candles";
    let candles = structuredCandles();
    if (candles.length < 12) {
      source = "chart-pixels";
      candles = visualCandles();
    }
    if (candles.length < 12) {
      renderMarkings([], null);
      internal.state.analysis = { direction: "WAIT", confidence: 0, reason: "Candles reais insuficientes para criar LTA/LTB com segurança" };
      logEvent("Sem entrada", `${internal.state.asset || "Ativo atual"}: candles suficientes ainda não foram identificados; nenhuma linha ou sinal foi inventado.`, "warning", `no-candles-${internal.state.asset || "current"}`);
      return internal.state.analysis;
    }

    const lows = swingPoints(candles, "lowY", "max");
    const highs = swingPoints(candles, "highY", "min");
    const lowPair = lows.slice(-2);
    const highPair = highs.slice(-2);
    const lines = [];
    const hasLta = lowPair.length === 2 && lowPair[1].index - lowPair[0].index >= 3 && lowPair[1].y < lowPair[0].y - .006;
    const hasLtb = highPair.length === 2 && highPair[1].index - highPair[0].index >= 3 && highPair[1].y > highPair[0].y + .006;
    if (hasLta) lines.push(extendedLine("LTA", lowPair[0], lowPair[1]));
    if (hasLtb) lines.push(extendedLine("LTB", highPair[0], highPair[1]));
    renderMarkings(lines, source);
    if (lines.length) logEvent("Marcações atualizadas", `${lines.map(line => line.type).join(" e ")} criadas a partir de ${candles.length} candles visíveis.`, "success", `lines-${internal.state.asset || "current"}-${hasLta}-${hasLtb}`);

    const recent = candles.slice(-10);
    const meanX = (recent.length - 1) / 2;
    const meanY = recent.reduce((sum, item) => sum + item.midY, 0) / recent.length;
    const denominator = recent.reduce((sum, _item, index) => sum + Math.pow(index - meanX, 2), 0) || 1;
    const slope = recent.reduce((sum, item, index) => sum + (index - meanX) * (item.midY - meanY), 0) / denominator;
    const ranges = recent.slice(0, -1).map(item => Math.abs(item.lowY - item.highY));
    const averageRange = ranges.reduce((sum, value) => sum + value, 0) / Math.max(1, ranges.length);
    const lastRange = Math.abs(recent.at(-1).lowY - recent.at(-1).highY);
    const spike = averageRange > 0 && lastRange > averageRange * 2.35;
    const ups = recent.slice(-5).filter(item => item.direction === "up").length;
    const downs = recent.slice(-5).filter(item => item.direction === "down").length;
    internal.state.protection = { active: spike, reason: spike ? "Amplitude da vela atual acima de 2,35× a média recente" : null };

    let direction = "WAIT";
    let confidence = 0;
    let reason = "Estrutura sem confirmação suficiente";
    if (spike) {
      reason = "Proteção ativa: pico de volatilidade detectado";
      logEvent("Proteção ativada", reason, "danger", `spike-${internal.state.asset || "current"}`);
    } else if (hasLta && slope < -.002 && ups >= 3) {
      direction = "BUY";
      confidence = Math.min(92, Math.round(62 + Math.abs(slope) * 1700 + ups * 3));
      reason = `LTA válida + inclinação favorável + ${ups}/5 velas compradoras`;
    } else if (hasLtb && slope > .002 && downs >= 3) {
      direction = "SELL";
      confidence = Math.min(92, Math.round(62 + Math.abs(slope) * 1700 + downs * 3));
      reason = `LTB válida + inclinação favorável + ${downs}/5 velas vendedoras`;
    } else if (!hasLta && !hasLtb) {
      reason = "Nenhuma LTA ou LTB válida confirmada nos candles visíveis";
    }
    const previousDirection = internal.state.analysis.direction;
    internal.state.analysis = { direction, confidence, reason, source, candles: candles.length };
    if (direction !== "WAIT" && direction !== previousDirection) {
      logEvent(`Cenário de ${direction === "BUY" ? "COMPRA" : "VENDA"}`, `${reason}. Confiança técnica ${confidence}%.`, "signal", `signal-${internal.state.asset || "current"}-${direction}-${Date.now()}`);
    }
    if (direction === "WAIT") logEvent("Sem entrada", `${internal.state.asset || "Ativo atual"}: ${reason}.`, "info", `wait-${internal.state.asset || "current"}-${reason}`);
    return internal.state.analysis;
  }

  function cleanupExpiredMarkings() {
    const now = Date.now();
    const active = internal.markings.filter(line => !line.expiresAt || line.expiresAt > now);
    if (active.length !== internal.markings.length) renderMarkings(active, internal.state.markings.source);
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
    const balance = internal.state.balance == null ? "Saldo não localizado" : `Saldo R$ ${internal.state.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
    panel.innerHTML = `<div><div style="color:#b8f53f;font-size:9px;font-weight:800;letter-spacing:.14em">ATLAS GUARD · ${balance}</div><strong style="display:block;margin-top:6px;font-size:13px">${internal.state.analysis.reason}</strong></div><div style="text-align:right"><span style="display:block;color:#8195ac;font-size:8px">DIREÇÃO</span><b style="display:block;margin-top:5px;color:${color};font-size:12px">${direction}</b></div>`;
    return true;
  }

  function snapshot() {
    return {
      ...internal.state,
      defaults: { ...internal.state.defaults },
      analysis: { ...internal.state.analysis },
      protection: { ...internal.state.protection },
      markings: { ...internal.state.markings },
      gale: { ...internal.state.gale },
      events: internal.state.events.map(event => ({ ...event }))
    };
  }

  async function publishState() {
    try { await chrome.runtime.sendMessage({ type: "state_update", state: snapshot() }); } catch { /* painel ainda não disponível */ }
  }

  async function monitorCycle(forceAnalysis = false) {
    inspect();
    const changedAsset = internal.state.asset && internal.state.asset !== internal.lastAsset;
    if (!internal.state.userActive && internal.state.asset && (!internal.state.defaults.timeframe || !internal.state.defaults.expiration || changedAsset)) ensureDefaults();
    if (internal.state.chartDetected && (forceAnalysis || changedAsset || Date.now() - internal.lastAnalysisAt > 12000)) {
      analyzeChart();
      internal.lastAnalysisAt = Date.now();
    }
    cleanupExpiredMarkings();
    if (internal.mode === "running") injectAnalysisPanel();
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
      internal.mode = "running";
      internal.state.mode = "running";
      logEvent("Monitoramento iniciado", "Saldo validado. O Atlas está aguardando uma oportunidade real.", "signal", `start-${Date.now()}`);
      injectAnalysisPanel();
      await publishState();
      return snapshot();
    }
    if (command.action === "pause") {
      internal.mode = "paused";
      internal.state.mode = "paused";
      logEvent("Robô pausado", "Análise ativa pausada pelo usuário.", "warning", `pause-${Date.now()}`);
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
    if (["buy", "sell", "place_order"].includes(command.action)) {
      const permission = await chrome.runtime.sendMessage({ type: "financial_permission" });
      throw new Error(permission?.reason || "Execução financeira bloqueada");
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
    enqueue(message.command)
      .then(result => sendResponse({ ok: true, type: "result", result, state: snapshot() }))
      .catch(error => sendResponse({ ok: false, type: "error", error: error.message, state: snapshot() }));
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
  internal.monitorTimer = setInterval(() => monitorCycle(false), 3000);

  (async () => {
    logEvent("Monitor conectado", "O Atlas iniciou o acompanhamento contínuo da tela.", "success", "monitor-connected");
    await monitorCycle(true);
    const origin = parentOrigin();
    if (await originAllowed(origin)) window.parent.postMessage({ source: BRIDGE_SOURCE, type: "ready", state: snapshot() }, origin);
  })();
})();

