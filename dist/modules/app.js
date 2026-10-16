const HEZILEX_ORIGIN = "https://app.hezilex.com";
const DASHBOARD_SOURCE = "atlas-guard-dashboard";
const EXTENSION_SOURCE = "atlas-guard-extension";
const DIRECT_EXTENSION_SOURCE = "atlas-guard-dashboard-extension";
const $ = id => document.getElementById(id);

const frame = $("hezilexFrame");
const pending = new Map();
let sequence = 0;
let extensionReady = false;
let directBridgeReady = false;
let iframeBridgeReady = false;
let verificationInFlight = false;
let macroInFlight = false;
let toastTimer = null;
let lastLoginState = null;
let state = {
  version: null,
  asset: null,
  timeframe: null,
  expiration: null,
  balance: null,
  analysis: { direction: "WAIT", confidence: 0, reason: "Aguardando a Hezilex" },
  risk: { baseAmount: null },
  defaults: { timeframe: false, expiration: false },
  manualOperation: null,
  lastInspectionAt: null
};

function marketReady() {
  return Boolean(state.asset || state.account?.id || state.account?.verified || (state.balance != null && state.balanceConfidence));
}

const robot = {
  used: new Set(JSON.parse(localStorage.getItem("atlas-robot-used") || "[]")),
  lastContext: null,
  currentContext: "hello",
  speechTimer: null,
  phrases: {
    waiting: ["Calma aí, tô esperando a tela terminar de falar comigo.", "A Hezilex abriu. Agora falta o gráfico parar de me dar gelo."],
    noaccess: ["Eu tô vendo que a tela abriu, mas este navegador não tá me entregando as velas. Sem dados, sem palpite fantasiado.", "O gráfico tá aí, bonitão, mas o Atlas ainda não recebeu os dados. Enquanto o topo disser ‘Aguardando conexão’, eu não vou inventar análise.", "Você tá mexendo na Hezilex, eu sei. Só que este navegador ainda não deixou eu ler o gráfico por dentro."],
    loggedout: ["Olha, eu tô vendo um moço fuçando o aplicativo, mas que ainda não fez login. Tá esperando convite?", "Rapaz, você abriu tudo, menos a conta. Sem login eu analiso o quê, a tela laranja?", "Você tá passeando pela Hezilex sem entrar. Bonito turismo financeiro.", "Eu aqui pronto pra analisar e você namorando a tela de login. Sensacional."],
    connect: ["Agora sim: gráfico falando, eu julgando.", "Dados ao vivo. Acabaram as desculpas criativas.", "Mercado localizado. A calma continua desaparecida.", "Tudo conectado. Respira antes de inventar moda."],
    asset: ["{asset} na tela. Novo ativo, velhos impulsos.", "Trocou para {asset}. Curiosidade ou plano? Vou fingir que é plano.", "Analisando {asset}. Ele não sabe que você chegou.", "{asset} selecionado. Deixa a vela terminar o raciocínio."],
    buy: ["Compra no radar. Convicção não é licença para exagerar.", "Sinal comprador. O botão continua sendo problema seu.", "Os compradores acordaram. Não precisa acordar a ganância.", "Compra com {confidence}% de confiança. Ainda não é casamento.", "O gráfico apontou para cima. Seu ego não precisa acompanhar."],
    sell: ["Venda no radar. Até a queda merece confirmação.", "Sinal vendedor. Drama no gráfico, calma no dedo.", "Os vendedores chegaram. Elegantes como uma porta batendo.", "Venda com {confidence}% de confiança. Sem heroísmo, por favor.", "O gráfico olhou para baixo. Não empurra."],
    wait: ["Nada claro ainda. Parabéns por quase não fazer besteira.", "Aguardar também é posição. A mais barata, inclusive.", "Mercado indeciso. Finalmente alguém combinando com ele.", "Sem sinal decente. O tédio está protegendo seu saldo.", "Hoje o melhor clique pode ser nenhum. Revolucionário."],
    timeframe: ["Gráfico em 5M. Agora a vela tem tempo de terminar a frase.", "Cinco minutos no gráfico. Menos ruído, menos novela.", "5M ajustado. Um pequeno passo para o gráfico, um salto para a paciência."],
    expiration: ["Expiração em 5M. Pelo menos o relógio sabe o plano.", "Cinco minutos de expiração. Cronômetro civilizado.", "Expiração alinhada. Agora não culpe o relógio."],
    risk: ["Um por cento. Finalmente uma ideia com juízo.", "Risco em 1%. Seu saldo agradeceu em silêncio.", "Valor calculado em 1%. A ganância perdeu essa rodada."],
    all: ["5M, 5M e 1%. Organização: conceito raro, porém bonito.", "Tudo alinhado. Agora falta só não improvisar.", "Configuração pronta. O caos foi adiado com sucesso."],
    open: ["Operação aberta. Agora mexer cinco vezes nela não vira estratégia.", "Entrada feita. O gráfico não aceita negociação emocional.", "Operação em andamento. Fiscalizar cada segundo não ajuda, mas eu sei que você vai."],
    win: ["Deu bom. Não transforma um acerto em doutorado.", "Vitória confirmada. Pode sorrir, só não aumenta a mão por empolgação.", "Ponto seu. O mercado não pediu discurso de campeão."],
    loss: ["Deu ruim. O mercado cobrou a mensalidade.", "Loss confirmado. Respira: vingança não é indicador.", "Essa não veio. O botão não tem culpa, curiosamente."],
    draw: ["Empate. Nem o mercado quis assumir essa decisão.", "Devolvida. Foi quase alguma coisa.", "Empate técnico: emoção desperdiçada com eficiência."],
    error: ["Não foi dessa vez. Até meus circuitos sabem esperar.", "Falhou com elegância. Melhor que acertar por acidente.", "A tela não colaborou. Ela também tem personalidade difícil."],
    live: ["Continuo analisando. Piscar é para humanos.", "O gráfico mexeu. Meu sarcasmo também.", "Ainda monitorando. Ansiedade não conta como indicador.", "Velas andando, eu observando, você respirando. Combinado?", "Sem clique necessário. Milagre tecnológico ou autocontrole?"]
  },
  speak(context, values = {}, force = false) {
    if (!force && this.lastContext === context) return;
    const source = this.phrases[context] || this.phrases.live;
    const candidates = source.map(line => line
      .replaceAll("{asset}", values.asset || state.asset || "esse ativo")
      .replaceAll("{confidence}", Math.round(Number(values.confidence ?? state.analysis.confidence) || 0)));
    const available = candidates.filter(line => !this.used.has(line));
    this.currentContext = context;
    this.updateQuestions(context);
    if (!available.length) return;
    const line = available[Math.floor(Math.random() * available.length)];
    this.used.add(line);
    localStorage.setItem("atlas-robot-used", JSON.stringify([...this.used]));
    this.lastContext = context;
    $("robotLine").textContent = line;
    $("robotOverlay").classList.add("talking");
    clearTimeout(this.speechTimer);
    this.speechTimer = setTimeout(() => $("robotOverlay").classList.remove("talking"), 1900);
  },
  updateQuestions(context) {
    const buttons = [...$("robotQuestions").querySelectorAll("button")];
    const noAccessContext = context === "noaccess" || (!extensionReady && context !== "waiting");
    const loggedOutContext = context === "loggedout" || !marketReady();
    const signalContext = ["buy", "sell", "open", "win", "loss", "draw"].includes(context);
    const setupContext = ["timeframe", "expiration", "risk", "all"].includes(context);
    const options = noAccessContext
      ? [["cantread", "Por que você não tá lendo?"], ["fixread", "Como faço funcionar?"], ["reallylive", "Você tá analisando agora?"]]
      : loggedOutContext
      ? [["loginseen", "O que você tá vendo?"], ["nologin", "Dá pra analisar sem login?"], ["next", "Tá, e agora?"]]
      : signalContext
        ? [["what", "O que eu deveria ter feito?"], ["why", "Por que essa direção?"], ["risk", "Qual é o risco agora?"]]
        : setupContext
          ? [["setup", "Minha tela está certa?"], ["why5m", "Por que usar 5 minutos?"], ["risk", "Quanto é 1% agora?"]]
          : [["seen", "O que você tá vendo?"], ["missing", "O que falta pra uma entrada?"], ["setup", "Tá tudo configurado?"]];
    buttons.forEach((button, index) => {
      button.dataset.question = options[index][0];
      button.textContent = options[index][1];
    });
  },
  answer(question) {
    if (!extensionReady) {
      const replies = {
        cantread: "Porque este navegador abriu a Hezilex, mas não liberou os dados do gráfico pro Atlas. Eu não vou fingir que li.",
        fixread: "Abra o endereço oficial no Chrome, Edge ou Brave onde a conexão local do Atlas já está ativa. Quando conectar, o topo muda sozinho.",
        reallylive: "Agora, não. O topo ainda diz ‘Aguardando conexão’. Quando eu receber ativo e velas, aí sim começa a análise real."
      };
      $("robotLine").textContent = replies[question] || replies.cantread;
      $("robotOverlay").classList.add("talking");
      clearTimeout(this.speechTimer);
      this.speechTimer = setTimeout(() => $("robotOverlay").classList.remove("talking"), 1900);
      return;
    }
    if (!marketReady()) {
      const replies = {
        loginseen: "Um moço fuçando o aplicativo sem fazer login. Por enquanto, essa é toda a análise técnica disponível.",
        nologin: "Não, né, mano. Sem login eu não tenho ativo, velas nem saldo. Aí seria palpite fantasiado de análise.",
        next: "Faz login na Hezilex. Quando o gráfico abrir, eu começo a analisar sozinho — sem você apertar mais nada."
      };
      $("robotLine").textContent = replies[question] || replies.loginseen;
      $("robotOverlay").classList.add("talking");
      clearTimeout(this.speechTimer);
      this.speechTimer = setTimeout(() => $("robotOverlay").classList.remove("talking"), 1900);
      return;
    }
    const direction = state.analysis.direction;
    const label = direction === "BUY" ? "uma compra" : direction === "SELL" ? "uma venda" : "ficar de fora";
    const reason = String(state.analysis.reason || "os critérios ainda não fecharam").replace(/\.$/, "");
    const shortReason = reason.length > 112 ? `${reason.slice(0, 109)}…` : reason;
    const baseAmount = formatMoney(state.risk.baseAmount);
    const protectionActive = Boolean(state.protection?.active);
    const replies = {
      what: direction === "WAIT"
        ? `Olha, nesse caso aí, mano, era melhor esperar. ${shortReason}.`
        : `Olha, nesse caso aí, mano, o lado mais forte era ${label}, porque ${shortReason.toLowerCase()}.`,
      why: direction === "WAIT"
        ? `Eu não escolhi um lado: ${shortReason}. Sem confirmação, melhor não inventar.`
        : `${label === "uma compra" ? "Compra" : "Venda"}, porque ${shortReason.toLowerCase()}. Confiança em ${Math.round(Number(state.analysis.confidence) || 0)}%.`,
      risk: protectionActive
        ? `Risco alto agora: a proteção detectou pico de volatilidade. Eu ficaria fora até normalizar.`
        : `Sem pico ativo. O limite sugerido é 1% do saldo, hoje ${baseAmount}; nada de dobrar no impulso.`,
      setup: `Gráfico ${state.timeframe || "não identificado"}, expiração ${state.expiration || "não identificada"} e 1% em ${baseAmount}. ${state.defaults?.timeframe && state.defaults?.expiration ? "Está alinhado." : "Ainda falta ajustar."}`,
      why5m: "Cinco minutos filtra parte do ruído e compara a análise com a mesma duração da operação. Menos bagunça, mais contexto.",
      seen: direction === "WAIT"
        ? `Estou vendo ${state.asset || "o ativo"}, mas ainda sem lado confiável: ${shortReason}.`
        : `${state.asset || "O ativo"} favorece ${label}, com ${Math.round(Number(state.analysis.confidence) || 0)}%: ${shortReason}.`,
      missing: direction === "WAIT" ? `Falta confirmação: ${shortReason}. Quando fechar, eu mudo o sinal sozinho.` : `O sinal já apareceu para ${label}. Agora falta você decidir sem pressa.`
    };
    $("robotLine").textContent = replies[question] || replies.seen;
    $("robotOverlay").classList.add("talking");
    clearTimeout(this.speechTimer);
    this.speechTimer = setTimeout(() => $("robotOverlay").classList.remove("talking"), 1900);
  },
  toggleQuestions() {
    if ($("robotOverlay").classList.contains("minimized")) {
      this.toggle();
      return;
    }
    const panel = $("robotQuestions");
    panel.hidden = !panel.hidden;
    $("robotOverlay").classList.toggle("questions-open", !panel.hidden);
  },
  init() {
    const storedPreference = localStorage.getItem("atlas-robot-minimized");
    const minimized = storedPreference === "1" || (storedPreference == null && matchMedia("(max-width: 720px)").matches);
    $("robotOverlay").classList.toggle("minimized", minimized);
    $("robotToggle").textContent = minimized ? "+" : "−";
    $("robotToggle").setAttribute("aria-expanded", String(!minimized));
    this.speak("waiting", {}, true);
  },
  toggle() {
    const minimized = $("robotOverlay").classList.toggle("minimized");
    $("robotQuestions").hidden = true;
    $("robotOverlay").classList.remove("questions-open");
    $("robotToggle").textContent = minimized ? "+" : "−";
    $("robotToggle").setAttribute("aria-expanded", String(!minimized));
    $("robotToggle").setAttribute("aria-label", minimized ? "Abrir Atlas Bot" : "Minimizar Atlas Bot");
    localStorage.setItem("atlas-robot-minimized", minimized ? "1" : "0");
    if (!minimized) this.speak("live", {}, true);
  }
};

function formatMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function showToast(message, kind = "info") {
  const toast = $("toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${kind}`;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
}

function setControls(enabled) {
  for (const id of ["setTimeframe", "setExpiration", "setRisk", "applyAll"]) $(id).disabled = !enabled;
}

function renderConnection(connected) {
  extensionReady = connected;
  $("connectionState").classList.toggle("ready", connected);
  $("connectionText").textContent = connected ? (marketReady() ? "Análise ao vivo" : "Esperando login") : "Aguardando mercado";
  setControls(connected && marketReady());
}

function renderState(next = {}) {
  const previousAsset = state.asset;
  const previousDirection = state.analysis.direction;
  const previousOperationKey = state.manualOperation?.key;
  state = {
    ...state,
    ...next,
    analysis: { ...state.analysis, ...(next.analysis || {}) },
    risk: { ...state.risk, ...(next.risk || {}) },
    defaults: { ...state.defaults, ...(next.defaults || {}) }
  };
  renderConnection(true);

  $("agentAsset").textContent = state.asset || "Localizando";
  $("agentTimeframe").textContent = state.timeframe || (state.defaults.timeframe ? "5m" : "—");
  $("agentExpiration").textContent = state.expiration || (state.defaults.expiration ? "5 min" : "—");
  $("riskAmount").textContent = formatMoney(state.risk.baseAmount);

  const direction = state.analysis.direction;
  const card = $("signalCard");
  card.classList.toggle("buy", direction === "BUY");
  card.classList.toggle("sell", direction === "SELL");
  $("analysisDirection").textContent = direction === "BUY" ? "COMPRA" : direction === "SELL" ? "VENDA" : "AGUARDAR";
  $("signalIcon").textContent = direction === "BUY" ? "↗" : direction === "SELL" ? "↘" : "—";
  $("confidenceBadge").textContent = `${Math.round(Number(state.analysis.confidence) || 0)}%`;
  $("analysisReason").textContent = state.analysis.reason || "Sem confirmação suficiente.";

  const pulse = $("monitorPulse");
  const inspectedAt = state.lastInspectionAt ? new Date(state.lastInspectionAt).getTime() : 0;
  const fresh = inspectedAt && Date.now() - inspectedAt < 9000;
  pulse.classList.toggle("live", Boolean(fresh));
  pulse.textContent = fresh ? "Analisando agora" : "Conectado · aguardando dados";
  const loggedIn = marketReady();
  const justLoggedIn = loggedIn && lastLoginState !== true;
  if (!loggedIn) {
    $("agentAsset").textContent = "Faça login";
    $("analysisReason").textContent = "Entre na Hezilex para eu começar a análise de verdade.";
    pulse.classList.remove("live");
    pulse.textContent = "Esperando você entrar";
    if (lastLoginState !== false || robot.currentContext !== "loggedout") robot.speak("loggedout", {}, true);
    lastLoginState = false;
    return;
  }
  lastLoginState = true;
  if (justLoggedIn) robot.speak("connect", {}, true);
  else if (state.manualOperation?.key && state.manualOperation.key !== previousOperationKey) {
    robot.speak({ WIN: "win", LOSS: "loss", DRAW: "draw", OPEN: "open" }[state.manualOperation.outcome] || "open", { asset: state.manualOperation.asset }, true);
  } else if (state.asset && state.asset !== previousAsset) robot.speak("asset", { asset: state.asset }, true);
  else if (state.analysis.direction !== previousDirection) {
    robot.speak(state.analysis.direction === "BUY" ? "buy" : state.analysis.direction === "SELL" ? "sell" : "wait", { confidence: state.analysis.confidence }, true);
  }
}

function sendCommand(action, payload = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const requestId = `atlas-${Date.now()}-${++sequence}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("A Hezilex não respondeu a tempo. Recarregue a página e tente novamente."));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    const message = { source: DASHBOARD_SOURCE, type: "command", requestId, action, ...payload };
    if (directBridgeReady || !iframeBridgeReady) window.postMessage(message, location.origin);
    else frame.contentWindow?.postMessage(message, HEZILEX_ORIGIN);
  });
}

window.addEventListener("message", event => {
  const fromIframe = event.origin === HEZILEX_ORIGIN && event.source === frame.contentWindow && event.data?.source === EXTENSION_SOURCE;
  const fromDirect = event.origin === location.origin && event.source === window && event.data?.source === DIRECT_EXTENSION_SOURCE;
  if (!fromIframe && !fromDirect) return;
  if (fromDirect) directBridgeReady = true;
  if (fromIframe) iframeBridgeReady = true;

  if (event.data.type === "ready" || event.data.type === "state") {
    renderState(event.data.state || {});
    return;
  }
  const request = pending.get(event.data.requestId);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(event.data.requestId);
  if (event.data.state) renderState(event.data.state);
  if (event.data.type === "error") request.reject(new Error(event.data.error || "Não foi possível aplicar a configuração."));
  else request.resolve(event.data.result);
});

async function runMacro(action, button, successMessage) {
  if (macroInFlight) {
    showToast("Termine o ajuste atual antes de iniciar outro.", "info");
    return null;
  }
  macroInFlight = true;
  const original = button.innerHTML;
  setControls(false);
  button.classList.add("loading");
  button.innerHTML = "<span>·</span><b>Aplicando…</b>";
  try {
    const timeout = action === "apply_setup" ? 22000 : action === "set_risk" ? 16000 : 9000;
    const result = await sendCommand(action, {}, timeout);
    if (result?.state) renderState(result.state);
    else if (result?.analysis || result?.bridge) renderState(result);
    showToast(successMessage, "success");
    robot.speak({ set_timeframe: "timeframe", set_expiration: "expiration", set_risk: "risk", apply_setup: "all" }[action] || "live", {}, true);
    return result;
  } catch (error) {
    const needsUpdate = /desconhecida|unknown|não reconhecida/i.test(error.message);
    if (needsUpdate && ["set_timeframe", "set_expiration"].includes(action)) {
      try {
        const fallback = await sendCommand("ensure_defaults", {}, 12000);
        if (fallback?.state) renderState(fallback.state);
        else if (fallback?.analysis || fallback?.bridge) renderState(fallback);
        showToast(action === "set_timeframe" ? "Gráfico e expiração ajustados para 5 minutos." : "Expiração e gráfico ajustados para 5 minutos.", "success");
        robot.speak(action === "set_timeframe" ? "timeframe" : "expiration", {}, true);
        return fallback;
      } catch (fallbackError) {
        showToast(fallbackError.message, "error");
        robot.speak("error", {}, true);
        return null;
      }
    }
    showToast(needsUpdate ? "Sua configuração local precisa ser atualizada para usar este macro." : error.message, "error");
    robot.speak("error", {}, true);
    return null;
  } finally {
    macroInFlight = false;
    button.classList.remove("loading");
    button.innerHTML = original;
    setControls(extensionReady && marketReady());
  }
}

async function verifyExtension() {
  if (verificationInFlight) return;
  verificationInFlight = true;
  try {
    const result = await sendCommand("ping", {}, 1600);
    renderState(result);
  } catch {
    if (!extensionReady) {
      renderConnection(false);
      robot.speak("noaccess", {}, true);
    }
  } finally {
    verificationInFlight = false;
  }
}

frame.addEventListener("load", () => {
  $("frameLoader").classList.add("hidden");
  setTimeout(verifyExtension, 700);
});

$("reloadFrame").addEventListener("click", () => {
  $("frameLoader").classList.remove("hidden");
  frame.src = "https://app.hezilex.com/";
});
$("setTimeframe").addEventListener("click", event => runMacro("set_timeframe", event.currentTarget, "Gráfico ajustado para 5 minutos."));
$("setExpiration").addEventListener("click", event => runMacro("set_expiration", event.currentTarget, "Expiração ajustada para 5 minutos."));
$("setRisk").addEventListener("click", event => runMacro("set_risk", event.currentTarget, "Valor ajustado para 1% do saldo."));
$("applyAll").addEventListener("click", event => runMacro("apply_setup", event.currentTarget, "Configuração aplicada: gráfico 5M, expiração 5M e valor em 1%."));
$("robotToggle").addEventListener("click", () => robot.toggle());
$("robotCharacter").addEventListener("click", () => robot.toggleQuestions());
$("robotCharacter").addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    robot.toggleQuestions();
  }
});
$("robotQuestions").addEventListener("click", event => {
  const button = event.target.closest("button[data-question]");
  if (button) robot.answer(button.dataset.question);
});

robot.init();
renderConnection(false);
setInterval(verifyExtension, 2500);
setInterval(() => {
  const inspectedAt = state.lastInspectionAt ? new Date(state.lastInspectionAt).getTime() : 0;
  if (extensionReady && inspectedAt && Date.now() - inspectedAt > 12000) $("monitorPulse").textContent = "Aguardando atualização";
}, 2000);
setInterval(() => {
  if (!extensionReady) {
    robot.speak("noaccess", {}, true);
    return;
  }
  if (!marketReady()) robot.speak("loggedout", {}, true);
  else robot.speak(state.analysis.direction === "BUY" ? "buy" : state.analysis.direction === "SELL" ? "sell" : "live", { confidence: state.analysis.confidence }, true);
}, 42000);
