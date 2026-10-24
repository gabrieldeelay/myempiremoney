import { normalizeAssetName } from "./asset-name.js?v=2.5.3-r1";
import { createSignalStabilizer } from "./signal-stability.js?v=3.9.5";
import { createSetupWarningTracker } from "./setup-warning-state.js?v=3.9.8";

const HEZILEX_ORIGIN = "https://app.hezilex.com";
const DASHBOARD_SOURCE = "atlas-guard-dashboard";
const EXTENSION_SOURCE = "atlas-guard-extension";
const DIRECT_EXTENSION_SOURCE = "atlas-guard-dashboard-extension";
const $ = id => document.getElementById(id);

const frame = $("hezilexFrame");
const pending = new Map();
let sequence = 0;
let extensionReady = false;
let screenReaderReady = false;
let directBridgeReady = false;
let iframeBridgeReady = false;
let verificationInFlight = false;
let toastTimer = null;
let lastLoginState = null;
let marketTrends = [];
let selectedRadarAsset = null;
const signalStabilizer = createSignalStabilizer();
const setupWarningTracker = createSetupWarningTracker();
let displayedAnalysis = null;
let setupWarningRenderKey = "";
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
  uiEvent: null,
  lastInspectionAt: null
};

function formatRobotMessage(value) {
  const raw = String(value || "").trim();
  const capitalized = raw.replace(/^(\s*(?:\[\[(?:good|bad):|\*\*|_)?)([a-zà-ÿ])/iu, (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("pt-BR")}`);
  return capitalized
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replace(/\[\[good:(.+?)\]\]/g, '<span class="good">$1</span>')
    .replace(/\[\[bad:(.+?)\]\]/g, '<span class="bad">$1</span>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

function formatRobotSpeech(value) {
  return String(value || "")
    .replace(/\[\[(?:good|bad):(.+?)\]\]/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/\b5M\b/gi, "cinco minutos")
    .replace(/\b1%\b/g, "um por cento")
    .replace(/\s+/g, " ")
    .trim();
}

function marketReady() {
  return Boolean(state.asset || state.chartDetected || state.account?.id || state.account?.verified || (state.balance != null && state.balanceConfidence));
}

function dataReady() {
  return extensionReady || screenReaderReady;
}

function trendForAsset(asset = state.asset || selectedRadarAsset) {
  const normalized = normalizeAssetName(asset);
  return normalized ? marketTrends.find(item => normalizeAssetName(item.asset) === normalized) || null : null;
}

function effectiveAnalysis() {
  const live = state.analysis || {};
  const trend = trendForAsset();
  const liveDirection = String(live.direction || "WAIT").toUpperCase();
  const trendDirection = String(trend?.direction || "WAIT").toUpperCase();
  if (!trend) {
    return {
      ...live,
      direction: "WAIT",
      confidence: 0,
      reason: "Sincronizando este ativo com o Radar Atlas 5M.",
      factors: ["A direção só é publicada quando o servidor central confirma o mesmo sinal para todos."],
      source: "market-radar-loading"
    };
  }
  const directional = ["BUY", "SELL"].includes(trendDirection);
  const visualAgrees = live.source === "screen-capture" && liveDirection === trendDirection;
  const localEntryBlocked = directional && visualAgrees && live.entryBlocked === true;
  const localTiming = directional && visualAgrees && !localEntryBlocked ? live.entryTiming : "NEXT_CANDLE";
  const side = trendDirection === "BUY" ? "compra" : trendDirection === "SELL" ? "venda" : "aguardar";
  const localContext = visualAgrees
    ? "A leitura da tela confirma a mesma direção e ajuda a escolher o momento da entrada."
    : directional
      ? "A tela ainda não confirmou o ponto; a direção central permanece a mesma para todos."
      : "O servidor ainda não encontrou vantagem técnica suficiente.";
  return {
    ...live,
    ...trend,
    direction: trendDirection,
    confidence: Math.round(Number(trend.confidence) || 0),
    entryTiming: localTiming,
    entryBlocked: localEntryBlocked,
    setup: visualAgrees ? live.setup : null,
    technical: live.technical,
    factors: [
      `Direção central de ${side} calculada na última vela de 5 minutos já fechada.`,
      trend.reason || "EMA9, EMA21, RSI e momentum calculados no servidor.",
      localContext
    ],
    reason: `Radar Atlas 5M: ${trend.reason || "tendência calculada com EMA9, EMA21, RSI e momentum"}. ${localContext}`,
    source: "market-radar-5m"
  };
}

function analysisForIdentifiedAsset() {
  if (state.asset) return effectiveAnalysis();
  return {
    direction: "WAIT",
    confidence: 0,
    reason: "Identificando o ativo selecionado antes de iniciar a nova leitura.",
    factors: ["A indicação anterior foi removida para não misturar análises de ativos diferentes."],
    source: "asset-identification"
  };
}

function currentAnalysis() {
  return displayedAnalysis || effectiveAnalysis();
}

function renderSignal(analysis = effectiveAnalysis()) {
  const direction = String(analysis?.direction || "WAIT").toUpperCase();
  const confidence = Math.round(Number(analysis?.confidence) || 0);
  const entryBlocked = analysis?.entryBlocked === true;
  const directional = ["BUY", "SELL"].includes(direction);
  const watchingReversal = !entryBlocked
    && analysis?.setup === "STRETCHED_CANDLE"
    && ["BUY", "SELL"].includes(analysis?.reversalDirection);
  const actionable = directional && confidence >= 62 && !entryBlocked;
  const probable = actionable && confidence < 75;
  const finalDirection = entryBlocked && directional
    ? direction
    : actionable
      ? direction
      : watchingReversal
        ? analysis.reversalDirection
        : "WAIT";
  const gale = !actionable ? "NÃO ENTRAR" : confidence >= 87 ? "SEM GALE" : confidence >= 75 ? "ATÉ GALE 1" : "ATÉ GALE 2";
  const timingCode = entryBlocked || watchingReversal || finalDirection === "WAIT"
    ? "WAIT_CONFIRMATION"
    : analysis?.entryTiming === "CURRENT_CANDLE" ? "CURRENT_CANDLE" : "NEXT_CANDLE";
  const timing = timingCode === "CURRENT_CANDLE" ? "NESTA VELA" : timingCode === "NEXT_CANDLE" ? "PRÓXIMA VELA" : "AGUARDE CONFIRMAÇÃO";
  const reversalSetup = analysis?.setup === "INTRACANDLE_REVERSAL";
  const entryAdvice = entryBlocked
    ? finalDirection === "BUY"
      ? "A direção continua compradora. O ponto desta vela passou; aguarde uma nova entrada."
      : "A direção continua vendedora. O ponto desta vela passou; aguarde uma nova entrada."
    : watchingReversal
      ? finalDirection === "BUY"
        ? "Queda forte detectada. Espere a vela reagir para cima antes de considerar compra."
        : "Alta forte detectada. Espere a vela reagir para baixo antes de considerar venda."
    : timingCode === "CURRENT_CANDLE"
    ? finalDirection === "BUY"
      ? reversalSetup
        ? "Nesta vela: espere a queda perder força e o preço reagir para cima antes de entrar."
        : "Nesta vela: aguarde um recuo curto e a compra voltar a ganhar força antes de entrar."
      : reversalSetup
        ? "Nesta vela: espere a alta perder força e o preço reagir para baixo antes de entrar."
        : "Nesta vela: aguarde um repique curto e a venda voltar a ganhar força antes de entrar."
    : timingCode === "NEXT_CANDLE"
      ? "Não entre agora. Aguarde a vela atual fechar; o sinal é para a próxima."
      : dataReady()
        ? "Análise ao vivo. Ainda não há vantagem técnica confirmada para uma entrada."
        : "Não entre agora. Aguarde uma leitura confirmada.";
  const card = $("signalCard");
  card.classList.toggle("buy", finalDirection === "BUY");
  card.classList.toggle("sell", finalDirection === "SELL");
  card.classList.toggle("probable", probable);
  card.classList.toggle("expired", entryBlocked);
  card.classList.toggle("observing", watchingReversal);
  card.classList.toggle("scanning", finalDirection === "WAIT" && dataReady());
  $("analysisDirection").textContent = entryBlocked
    ? `POSSÍVEL ${finalDirection === "BUY" ? "COMPRA" : "VENDA"}`
    : watchingReversal
      ? `POSSÍVEL ${finalDirection === "BUY" ? "COMPRA" : "VENDA"}`
    : finalDirection === "BUY"
    ? `${probable ? "PROVÁVEL " : ""}COMPRA`
    : finalDirection === "SELL" ? `${probable ? "PROVÁVEL " : ""}VENDA` : "AGUARDAR";
  $("signalIcon").textContent = finalDirection === "BUY" ? "↗" : finalDirection === "SELL" ? "↘" : "—";
  $("confidenceBadge").textContent = `${confidence}% CONFIANÇA`;
  const timingBadge = $("entryTiming");
  timingBadge.textContent = timing;
  timingBadge.className = `entry-timing ${timingCode === "CURRENT_CANDLE" ? "current" : timingCode === "NEXT_CANDLE" ? "next" : "waiting"}`;
  timingBadge.setAttribute("aria-label", `${timing}. ${entryAdvice}`);
  $("entryAdvice").textContent = entryAdvice;
  $("galeBadge").textContent = gale;
  $("galeBadge").className = `gale-badge gale-${gale === "SEM GALE" ? "none" : gale.includes("1") ? "one" : gale.includes("2") ? "two" : "wait"}`;
  const stability = $("signalStability");
  if (stability) {
    const checking = analysis?.stability === "checking";
    const initializing = analysis?.stability === "initializing";
    const reversal = analysis?.setup === "INTRACANDLE_REVERSAL";
    const stretched = analysis?.setup === "STRETCHED_CANDLE";
    stability.textContent = reversal && finalDirection !== "WAIT" ? "REVERSÃO TÉCNICA" : stretched && entryBlocked ? "DIREÇÃO MANTIDA" : stretched ? "NÃO ENTRE AGORA" : checking ? "MUDANÇA EM CONFIRMAÇÃO" : initializing ? "CONFIRMANDO LEITURA" : finalDirection === "WAIT" && dataReady() ? "ANÁLISE AO VIVO" : finalDirection === "WAIT" ? "SEM SINAL CONFIRMADO" : "SINAL ESTÁVEL";
    stability.className = `signal-stability ${checking || initializing || stretched ? "checking" : finalDirection === "WAIT" ? "waiting" : "stable"}`;
  }
  $("analysisReason").textContent = analysis?.reason || "Sem confirmação suficiente.";
  const details = Array.isArray(analysis?.factors) && analysis.factors.length
    ? analysis.factors
    : [analysis?.reason || "Ainda não há fatores suficientes para justificar uma entrada."];
  const transitionDetail = analysis?.transition
    ? `${analysis.transition.direction === "BUY" ? "Compra" : analysis.transition.direction === "SELL" ? "Venda" : "Indecisão"} foi observada, mas ainda não persistiu o suficiente para substituir o sinal atual.`
    : null;
  const explained = [...details];
  if (transitionDetail) explained.unshift(transitionDetail);
  if (actionable) explained.push("O limite de gale representa exposição máxima sugerida pela leitura visual, não garantia de resultado.");
  explained.push("A direção só muda após permanecer consistente em várias leituras e respeitar o tempo mínimo do sinal atual.");
  $("analysisDetails").replaceChildren(...explained.map(item => {
    const entry = document.createElement("li");
    entry.textContent = item;
    return entry;
  }));
}

function renderSetupWarnings(force = false) {
  const host = $("setupWarnings");
  if (!host) return;
  const setupReady = state.bridge !== "screen-capture" || state.setupChecked === true;
  const issues = setupReady ? setupWarningTracker.update(state) : [];
  const renderKey = `${state.asset || ""}|${issues.map(issue => `${issue.id}:${issue.detail}`).join("|")}`;
  if (!force && renderKey === setupWarningRenderKey) return;
  setupWarningRenderKey = renderKey;
  host.hidden = issues.length === 0;
  host.replaceChildren(...issues.map(issue => {
    const card = document.createElement("section");
    card.className = "setup-warning";
    card.dataset.setupWarning = issue.id;

    const icon = document.createElement("span");
    icon.className = "setup-warning-icon";
    icon.textContent = "!";

    const copy = document.createElement("div");
    copy.className = "setup-warning-copy";
    const title = document.createElement("strong");
    title.textContent = issue.title;
    const message = document.createElement("p");
    message.textContent = issue.message;
    const detail = document.createElement("small");
    detail.textContent = issue.detail;
    copy.append(title, message, detail);

    const actions = document.createElement("div");
    actions.className = "setup-warning-actions";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "setup-warning-accept";
    accept.dataset.setupWarningDismiss = issue.id;
    accept.textContent = "Vou mudar";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "setup-warning-close";
    close.dataset.setupWarningDismiss = issue.id;
    close.setAttribute("aria-label", `Fechar aviso: ${issue.message}`);
    close.textContent = "×";
    actions.append(accept, close);

    card.append(icon, copy, actions);
    return card;
  }));
}

const robot = {
  used: new Set(JSON.parse(localStorage.getItem("atlas-robot-variants-v2") || "[]")),
  lastContext: null,
  lastLine: null,
  currentContext: "hello",
  speechTimer: null,
  queueTimer: null,
  visibleUntil: 0,
  queue: [],
  holdMs: 8000,
  lastAutomaticAt: 0,
  automaticCooldownMs: 90000,
  soundEnabled: (() => {
    const saved = localStorage.getItem("atlas-robot-audio-enabled");
    if (saved != null) return saved !== "0";
    return localStorage.getItem("atlas-robot-sound") !== "0";
  })(),
  audioContext: null,
  soundReady: false,
  voiceQueue: [],
  voiceSpeaking: false,
  activeVoiceText: "",
  narratorVoice: null,
  voiceAudio: null,
  voiceObjectUrl: "",
  localNarrator: null,
  localNarratorPromise: null,
  localNarratorRetryAfter: 0,
  phrases: {
    waiting: ["Calma aí, tô esperando a tela terminar de falar comigo.", "A Hezilex abriu. Agora falta o gráfico parar de me dar gelo."],
    noaccess: ["A Hezilex abriu. Agora ative a leitura visual para eu interpretar as velas sem extensão.", "O gráfico está na tela, mas a leitura visual ainda está desligada. Clique em ‘Ativar leitura’ e escolha esta aba.", "Sem extensão, eu leio a imagem da aba. Só falta você autorizar o compartilhamento da tela."],
    loggedout: ["Olha, eu tô vendo um moço fuçando o aplicativo, mas que ainda não fez login. Tá esperando convite?", "Rapaz, você abriu tudo, menos a conta. Sem login eu analiso o quê, a tela laranja?", "Você tá passeando pela Hezilex sem entrar. Bonito turismo financeiro.", "Eu aqui pronto pra analisar e você namorando a tela de login. Sensacional."],
    connect: ["Agora sim: gráfico falando, eu julgando.", "Dados ao vivo. Acabaram as desculpas criativas.", "Mercado localizado. A calma continua desaparecida.", "Tudo conectado. Respira antes de inventar moda."],
    asset: ["{asset} na tela. Novo ativo, velhos impulsos.", "Trocou para {asset}. Curiosidade ou plano? Vou fingir que é plano.", "Analisando {asset}. Ele não sabe que você chegou.", "{asset} selecionado. Deixa a vela terminar o raciocínio.", "Chegamos em {asset}. Primeiro eu leio, depois você inventa coragem.", "{asset} entrou no radar. Ainda não confunda movimento com oportunidade.", "Mudança registrada: agora é {asset}. O mercado não precisa saber da sua pressa.", "Abriu {asset}. Vou conferir o contexto antes que seu dedo dê opinião."],
    buy: ["Compra no radar. Convicção não é licença para exagerar.", "Sinal comprador. O botão continua sendo problema seu.", "Os compradores acordaram. Não precisa acordar a ganância.", "Compra com {confidence}% de confiança. Ainda não é casamento.", "O gráfico apontou para cima. Seu ego não precisa acompanhar.", "{asset} inclina para compra em {confidence}%. É leitura, não passe livre para aumentar a mão.", "Fluxo comprador em {asset}. A parte difícil agora é não transformar sinal em torcida.", "A pressão está para cima em {asset}. Confirmação primeiro, comemoração nunca antes.", "{asset} favorece compra. Seu trabalho é respeitar o risco, não impressionar a vela."],
    sell: ["Venda no radar. Até a queda merece confirmação.", "Sinal vendedor. Drama no gráfico, calma no dedo.", "Os vendedores chegaram. Elegantes como uma porta batendo.", "Venda com {confidence}% de confiança. Sem heroísmo, por favor.", "O gráfico olhou para baixo. Não empurra.", "{asset} inclina para venda em {confidence}%. Tendência não é convite para perder a medida.", "Pressão vendedora em {asset}. O cenário caiu; seu juízo não precisa ir junto.", "{asset} está pesando para baixo. Espera a confirmação antes de bancar o vidente.", "Venda favorecida em {asset}. Risco pequeno, ego menor ainda."],
    wait: ["Nada claro ainda. Parabéns por quase não fazer besteira.", "Aguardar também é posição. A mais barata, inclusive.", "Mercado indeciso. Finalmente alguém combinando com ele.", "Sem sinal decente. O tédio está protegendo seu saldo.", "Hoje o melhor clique pode ser nenhum. Revolucionário.", "{asset} ainda não escolheu lado. Você também não precisa escolher no chute.", "O gráfico está conversando sozinho. Interromper com uma entrada seria falta de educação.", "Sem confirmação em {asset}. A pressa continua sem indicador próprio.", "Por enquanto, ficar fora tem a melhor relação entre paz e prejuízo."],
    timeframe: ["Gráfico em 5M. Agora a vela tem tempo de terminar a frase.", "Cinco minutos no gráfico. Menos ruído, menos novela.", "5M ajustado. Um pequeno passo para o gráfico, um salto para a paciência."],
    expiration: ["Expiração em 5M. Pelo menos o relógio sabe o plano.", "Cinco minutos de expiração. Cronômetro civilizado.", "Expiração alinhada. Agora não culpe o relógio."],
    risk: ["Um por cento. Finalmente uma ideia com juízo.", "Risco em 1%. Seu saldo agradeceu em silêncio.", "Valor calculado em 1%. A ganância perdeu essa rodada."],
    all: ["5M, 5M e 1%. Organização: conceito raro, porém bonito.", "Tudo alinhado. Agora falta só não improvisar.", "Configuração pronta. O caos foi adiado com sucesso."],
    open: ["**Decisão difícil de avaliar** sem confirmação clara. Em {asset}, o risco precisa compensar a dúvida.", "O contexto de {asset} ainda está _incompleto_. Melhor manter a exposição pequena.", "Sem direção confirmada, essa ideia fica **difícil de defender**. Proteja o capital.", "O cenário ainda não entregou vantagem clara. Aqui, tamanho de mão importa mais que convicção."],
    buyAligned: ["[[good:Boa escolha.]] O cenário favorecia **compra** em {asset}; agora preserve o risco.", "[[good:Leitura coerente.]] A força compradora de {asset} sustentava essa decisão.", "[[good:Opção bem alinhada.]] Tendência e momento apontavam para **compra** em {asset}.", "[[good:Fazia sentido.]] Em {asset}, o lado comprador tinha o argumento mais forte."],
    sellAligned: ["[[good:Boa escolha.]] O cenário favorecia **venda** em {asset}; agora preserve o risco.", "[[good:Leitura coerente.]] A pressão vendedora de {asset} sustentava essa decisão.", "[[good:Opção bem alinhada.]] Tendência e momento apontavam para **venda** em {asset}.", "[[good:Fazia sentido.]] Em {asset}, o lado vendedor tinha o argumento mais forte."],
    buyAgainstSell: ["[[bad:Escolha fraca.]] O cenário favorecia **venda** em {asset}; contrariar o fluxo aumenta o risco.", "[[bad:Pouco convincente.]] A pressão de {asset} estava vendedora, sem apoio técnico para o outro lado.", "[[bad:Contexto desfavorável.]] Em {asset}, tendência e momento apontavam para **venda**.", "[[bad:Risco elevado.]] A leitura de {asset} estava no sentido oposto e pedia cautela."],
    sellAgainstBuy: ["[[bad:Escolha fraca.]] O cenário favorecia **compra** em {asset}; contrariar o fluxo aumenta o risco.", "[[bad:Pouco convincente.]] A força de {asset} estava compradora, sem apoio técnico para o outro lado.", "[[bad:Contexto desfavorável.]] Em {asset}, tendência e momento apontavam para **compra**.", "[[bad:Risco elevado.]] A leitura de {asset} estava no sentido oposto e pedia cautela."],
    buyWithoutSignal: ["[[bad:Entrada precipitada.]] Faltava confirmação para **compra** em {asset}.", "[[bad:Argumento fraco.]] O cenário de {asset} ainda estava neutro; esperar era mais sólido.", "[[bad:Sem vantagem clara.]] A compra precisava de confirmação que o gráfico ainda não entregou.", "[[bad:Decisão apressada.]] Em {asset}, a leitura ainda recomendava _ficar de fora_."],
    sellWithoutSignal: ["[[bad:Entrada precipitada.]] Faltava confirmação para **venda** em {asset}.", "[[bad:Argumento fraco.]] O cenário de {asset} ainda estava neutro; esperar era mais sólido.", "[[bad:Sem vantagem clara.]] A venda precisava de confirmação que o gráfico ainda não entregou.", "[[bad:Decisão apressada.]] Em {asset}, a leitura ainda recomendava _ficar de fora_."],
    exposureDanger: ["[[bad:Mão pesada.]] {count} entradas já somam **{exposure}**, cerca de {risk}% do saldo.", "[[bad:Reduz a mão.]] Você acumulou {exposure} em poucos minutos; isso já virou risco, não convicção.", "[[bad:Exposição subindo.]] {count} entradas juntas estão grandes demais para um saldo de {balance}."],
    exposureCritical: ["[[bad:Para.]] {count} entradas somam **{exposure}** contra um saldo de {balance}. Isso passou de {risk}% da banca.", "[[bad:Completamente fora de escala.]] Você expôs {exposure} com apenas {balance} de saldo.", "[[bad:Isso não é proteção, é concentração.]] A exposição chegou a {risk}% da banca. Não aumenta mais essa mão."],
    protectionReady: ["**Proteção no ponto.** {asset} chegou à região planejada: mantenha **{direction}** e, se decidir proteger, a referência é {amount}.", "A região de proteção chegou. Em {asset}, a reentrada continua no lado de **{direction}**; referência de {amount}.", "Agora sim: preço na faixa de proteção em {asset}. Mesma direção, **{direction}**, com referência de {amount}."],
    protectionTaken: ["[[good:Proteção bem posicionada.]] O preço chegou à região prevista antes da nova **{direction}** em {asset}.", "[[good:Boa leitura da proteção.]] A reentrada em **{direction}** aconteceu na faixa planejada de {asset}.", "A proteção respeitou o nível técnico. Agora deixa o gráfico trabalhar sem inventar uma terceira entrada."],
    protectionEarly: ["[[bad:Proteção antecipada.]] O preço ainda não tinha alcançado a região planejada de {asset}.", "Você protegeu cedo em {asset}. A ideia era esperar o preço chegar ao nível marcado antes da nova **{direction}**.", "[[bad:Faltou esperar o nível.]] A proteção veio antes do preço confirmar a região em {asset}."],
    adclose: ["Fechou o anúncio. Finalmente uma operação com 100% de acerto.", "Anúncio eliminado. Essa entrada eu aprovo sem indicador.", "Boa. Menos propaganda, mais gráfico e só um pouco menos de caos.", "Fechou o anúncio com precisão. Se operar assim, talvez dê jogo."],
    dragged: ["Escolhe um canto e deixa eu acompanhar o gráfico.", "Eu sou analista, não ícone de desktop. Deixa eu trabalhar daqui.", "O gráfico está parado e eu fazendo turismo. Vamos focar na leitura.", "Pode me deixar neste canto. Se houver algo importante, eu aviso."],
    reversalBuy: ["Possível **reversão para compra** em {asset}. A queda esticou e começou a rejeitar o fundo; escolha com cuidado o ponto nesta vela.", "A pressão vendedora perdeu força em {asset}. Há fundamento para **possível compra nesta vela**, sem antecipar o clique."],
    reversalSell: ["Possível **reversão para venda** em {asset}. A alta esticou e começou a rejeitar o topo; escolha com cuidado o ponto nesta vela.", "A pressão compradora perdeu força em {asset}. Há fundamento para **possível venda nesta vela**, sem antecipar o clique."],
    win: ["[[good:Resultado positivo]] em {asset}. O mérito está na disciplina, não na euforia.", "[[good:Lucro confirmado]] em {asset}. Preserve o método que trouxe o resultado.", "{asset} terminou no [[good:positivo]]. Boa execução vale mais que comemoração antecipada."],
    loss: ["[[bad:Resultado negativo]] em {asset}. Revanche não é indicador.", "[[bad:Perda confirmada]] em {asset}. Revise o contexto sem aumentar a mão.", "{asset} terminou no [[bad:negativo]]. Aceite o dado e proteja a próxima decisão."],
    draw: ["Empate em {asset}. Nem o mercado quis bancar essa história.", "{asset} devolveu a entrada. Emoção gasta, saldo preservado.", "Resultado neutro em {asset}. Próxima vela, mesmo plano."],
    error: ["[[bad:Não funcionou desta vez.]] A tela pediu outra tentativa.", "[[bad:O ajuste falhou.]] Melhor tentar novamente do que fingir que deu certo.", "[[bad:Algo saiu errado.]] O Atlas preservou a configuração anterior."],
    live: ["Continuo analisando. Piscar é para humanos.", "O gráfico mexeu. Meu sarcasmo também.", "Ainda monitorando. Ansiedade não conta como indicador.", "Velas andando, eu observando, você respirando. Combinado?", "Sem clique necessário. Milagre tecnológico ou autocontrole?", "{asset} segue no radar. Se aparecer algo útil, eu interrompo o silêncio.", "Mercado em andamento. Nem toda vela merece uma opinião pública.", "Estou acompanhando {asset}. Por enquanto, a melhor ação é não fabricar ação.", "Leitura atualizada. O gráfico continua trabalhando sem precisar de torcida."]
  },
  canSpeakAutomatically() {
    const now = Date.now();
    if (now - this.lastAutomaticAt < this.automaticCooldownMs) return false;
    this.lastAutomaticAt = now;
    return true;
  },
  setSoundEnabled(enabled) {
    this.soundEnabled = Boolean(enabled);
    localStorage.setItem("atlas-robot-sound", this.soundEnabled ? "1" : "0");
    localStorage.setItem("atlas-robot-audio-enabled", this.soundEnabled ? "1" : "0");
    this.syncAudioControls();
    if (this.soundEnabled) {
      this.unlockSound();
      this.drainNarration();
      return;
    }
    this.voiceQueue = [];
    this.voiceSpeaking = false;
    this.activeVoiceText = "";
    if (this.voiceAudio) {
      this.voiceAudio.pause();
      this.voiceAudio.removeAttribute("src");
      this.voiceAudio = null;
    }
    if (this.voiceObjectUrl) URL.revokeObjectURL(this.voiceObjectUrl);
    this.voiceObjectUrl = "";
    window.speechSynthesis?.cancel();
    clearTimeout(this.speechTimer);
    $("robotOverlay").classList.remove("talking");
  },
  syncAudioControls() {
    const muted = !this.soundEnabled;
    const settingsToggle = $("robotSoundToggle");
    const voiceToggle = $("robotVoiceToggle");
    if (settingsToggle) settingsToggle.checked = this.soundEnabled;
    if (voiceToggle) {
      voiceToggle.textContent = muted ? "🔇" : "🔊";
      voiceToggle.setAttribute("aria-pressed", String(muted));
      voiceToggle.setAttribute("aria-label", muted ? "Ativar voz do Atlas" : "Silenciar voz do Atlas");
      voiceToggle.title = muted ? "Ativar voz do Atlas" : "Silenciar voz do Atlas";
    }
    $("robotOverlay")?.classList.toggle("voice-muted", muted);
  },
  unlockSound() {
    if (!this.soundEnabled) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.audioContext ||= new AudioContextClass();
    this.audioContext.resume?.();
    this.soundReady = true;
    this.prepareLocalNarrator().catch(() => {});
  },
  selectNarratorVoice() {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    const maleNames = /antonio|antônio|daniel|felipe|ricardo|thiago|paulo|joão|joao|rafael|luciano|male|masculin/i;
    const scored = voices.map(voice => {
      const language = String(voice.lang || "").toLowerCase();
      const label = `${voice.name} ${voice.voiceURI}`;
      let score = language === "pt-br" ? 120 : language.startsWith("pt") ? 80 : 0;
      if (maleNames.test(label)) score += 65;
      if (/natural|neural|online/i.test(label)) score += 18;
      if (/microsoft|google/i.test(label)) score += 8;
      return { voice, score };
    }).filter(item => item.score >= 80).sort((a, b) => b.score - a.score);
    this.narratorVoice = scored[0]?.voice || null;
    return this.narratorVoice;
  },
  canNarrate() {
    return this.soundEnabled && ("Audio" in window || ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window));
  },
  enqueueNarration(line) {
    if (!this.canNarrate()) return false;
    const spokenText = formatRobotSpeech(line);
    if (!spokenText || spokenText === this.activeVoiceText || spokenText === this.voiceQueue.at(-1)) return true;
    if (this.voiceSpeaking) this.voiceQueue = [spokenText];
    else this.voiceQueue.push(spokenText);
    this.drainNarration();
    return true;
  },
  playBrowserNarration(spokenText, finish) {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      finish();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(spokenText);
    const voice = this.narratorVoice || this.selectNarratorVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = "pt-BR";
    utterance.rate = .96;
    utterance.pitch = .82;
    utterance.volume = .92;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  },
  async prepareLocalNarrator() {
    if (this.localNarrator) return this.localNarrator;
    if (this.localNarratorPromise) return this.localNarratorPromise;
    if (Date.now() < this.localNarratorRetryAfter) throw new Error("Voz local temporariamente indisponível");
    this.localNarratorPromise = import("./vozz-piper.js?v=3.7.3")
      .then(({ Piper }) => Piper.carregar({
        dispositivo: "wasm",
        cdn: "https://cdn.jsdelivr.net/gh/Pedro21062014/vozz@178ff1640f950426790ea3b7257b15a1aa1238ea"
      }))
      .then(narrator => {
        this.localNarrator = narrator;
        return narrator;
      })
      .catch(error => {
        this.localNarratorRetryAfter = Date.now() + 60000;
        throw error;
      })
      .finally(() => { this.localNarratorPromise = null; });
    return this.localNarratorPromise;
  },
  async playNaturalNarration(spokenText, finish) {
    try {
      const narrator = await this.prepareLocalNarrator();
      const generated = await narrator.falar(spokenText, { velocidade: .98, maxFonemas: 200 });
      const blob = generated.paraBlob();
      if (!blob.size || !this.soundEnabled) return finish();
      this.voiceObjectUrl = URL.createObjectURL(blob);
      const audio = new Audio(this.voiceObjectUrl);
      this.voiceAudio = audio;
      audio.volume = .92;
      audio.onended = finish;
      audio.onerror = () => {
        audio.onended = null;
        this.voiceAudio = null;
        if (this.voiceObjectUrl) URL.revokeObjectURL(this.voiceObjectUrl);
        this.voiceObjectUrl = "";
        this.playBrowserNarration(spokenText, finish);
      };
      await audio.play();
    } catch (error) {
      if (!this.soundEnabled) finish();
      else this.playBrowserNarration(spokenText, finish);
    }
  },
  drainNarration() {
    if (!this.canNarrate() || this.voiceSpeaking || !this.voiceQueue.length) return;
    const spokenText = this.voiceQueue.shift();
    this.voiceSpeaking = true;
    this.activeVoiceText = spokenText;
    $("robotOverlay").classList.add("talking");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (this.voiceAudio) {
        this.voiceAudio.onended = null;
        this.voiceAudio.onerror = null;
        this.voiceAudio = null;
      }
      if (this.voiceObjectUrl) URL.revokeObjectURL(this.voiceObjectUrl);
      this.voiceObjectUrl = "";
      this.voiceSpeaking = false;
      this.activeVoiceText = "";
      if (this.soundEnabled && this.voiceQueue.length) this.drainNarration();
      else $("robotOverlay").classList.remove("talking");
    };
    this.playNaturalNarration(spokenText, finish);
  },
  playSound(context) {
    if (!this.soundEnabled || !this.soundReady || !this.audioContext) return;
    const audio = this.audioContext;
    const positive = ["buyAligned", "sellAligned", "win", "protectionReady", "protectionTaken"].includes(context);
    const negative = ["buyAgainstSell", "sellAgainstBuy", "buyWithoutSignal", "sellWithoutSignal", "loss", "error", "protectionEarly", "exposureDanger", "exposureCritical"].includes(context);
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(positive ? 660 : negative ? 330 : 480, audio.currentTime);
    gain.gain.setValueAtTime(.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.035, audio.currentTime + .018);
    gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .18);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + .19);
  },
  contextStillValid(context) {
    if (context === "loggedout") return !marketReady();
    if (context === "waiting" || context === "noaccess") return !dataReady();
    if (["connect", "asset", "buy", "sell", "wait", "live", "timeframe", "expiration", "risk", "all"].includes(context)) {
      return marketReady();
    }
    return true;
  },
  pruneQueue() {
    this.queue = this.queue.filter(item => this.contextStillValid(item.context)).slice(-1);
  },
  speak(context, values = {}, force = false, interrupt = false) {
    if (!force && this.lastContext === context) return;
    const source = this.phrases[context] || this.phrases.live;
    const candidates = source.map(line => line
      .replaceAll("{asset}", normalizeAssetName(values.asset || state.asset) || "ESSE ATIVO")
      .replaceAll("{confidence}", Math.round(Number(values.confidence ?? state.analysis.confidence) || 0))
      .replaceAll("{amount}", formatMoney(values.amount))
      .replaceAll("{exposure}", formatMoney(values.exposure))
      .replaceAll("{balance}", formatMoney(values.balance))
      .replaceAll("{risk}", Math.round(Number(values.risk) || 0))
      .replaceAll("{count}", Math.round(Number(values.count) || 1))
      .replaceAll("{direction}", values.direction === "SELL" ? "VENDA" : "COMPRA")
      .replaceAll("{reason}", String(values.reason || state.analysis.reason || "sem confirmação suficiente")));
    const variants = candidates.map((line, index) => ({ line, key: `${context}:${index}` }));
    let available = variants.filter(item => !this.used.has(item.key) && item.line !== this.lastLine);
    if (!available.length) {
      [...this.used].filter(key => key.startsWith(`${context}:`)).forEach(key => this.used.delete(key));
      available = variants.filter(item => item.line !== this.lastLine);
    }
    if (!available.length) available = variants;
    const selected = available[Math.floor(Math.random() * available.length)];
    const line = selected.line;
    this.used.add(selected.key);
    this.lastLine = line;
    if (this.used.size > 180) this.used = new Set([...this.used].slice(-90));
    localStorage.setItem("atlas-robot-variants-v2", JSON.stringify([...this.used]));
    this.lastContext = context;
    this.sayText(line, context, interrupt);
  },
  sayText(line, context = this.currentContext, interrupt = false) {
    const now = Date.now();
    if (!interrupt && now < this.visibleUntil) {
      this.queue = [{ line, context }];
      this.scheduleQueue();
      return;
    }
    clearTimeout(this.queueTimer);
    if (interrupt) this.queue = [];
    this.currentContext = context;
    this.updateQuestions(context);
    $("robotLine").innerHTML = formatRobotMessage(line);
    $("robotOverlay").classList.add("talking");
    this.playSound(context);
    const narrating = this.enqueueNarration(line);
    this.visibleUntil = now + this.holdMs;
    clearTimeout(this.speechTimer);
    if (!narrating) this.speechTimer = setTimeout(() => $("robotOverlay").classList.remove("talking"), 1900);
    this.scheduleQueue();
    requestAnimationFrame(keepRobotInViewport);
  },
  scheduleQueue() {
    clearTimeout(this.queueTimer);
    this.pruneQueue();
    if (!this.queue.length) return;
    const delay = Math.max(0, this.visibleUntil - Date.now());
    this.queueTimer = setTimeout(() => {
      this.pruneQueue();
      const next = this.queue.shift();
      if (next) this.sayText(next.line, next.context, true);
    }, delay);
  },
  commentOnOperation(operation) {
    if (!operation) return;
    if (operation.outcome !== "OPEN") {
      this.speak({ WIN: "win", LOSS: "loss", DRAW: "draw" }[operation.outcome] || "open", { asset: operation.asset }, true, true);
      return;
    }
    const exposure = operation.exposure;
    if (exposure?.severity === "critical" || exposure?.severity === "danger") {
      const context = exposure.severity === "critical" ? "exposureCritical" : "exposureDanger";
      this.speak(context, {
        exposure: exposure.cumulativeAmount,
        balance: exposure.balance,
        risk: exposure.cumulativeRiskPercent,
        count: exposure.operationCount
      }, true, true);
      showToast(exposure.severity === "critical"
        ? `Exposição crítica: ${formatMoney(exposure.cumulativeAmount)} em operações para ${formatMoney(exposure.balance)} de saldo.`
        : `Atenção: ${formatMoney(exposure.cumulativeAmount)} expostos em ${exposure.operationCount} operações.`, "error", 8000);
      return;
    }
    if (operation.isProtection) {
      const context = operation.protectionStatus === "READY" ? "protectionTaken" : "protectionEarly";
      this.speak(context, { asset: operation.asset, amount: operation.amount, direction: operation.direction }, true, true);
      return;
    }
    const picked = operation.direction;
    const advised = currentAnalysis().direction;
    let context = "open";
    if (picked === "BUY" && advised === "BUY") context = "buyAligned";
    else if (picked === "SELL" && advised === "SELL") context = "sellAligned";
    else if (picked === "BUY" && advised === "SELL") context = "buyAgainstSell";
    else if (picked === "SELL" && advised === "BUY") context = "sellAgainstBuy";
    else if (picked === "BUY") context = "buyWithoutSignal";
    else if (picked === "SELL") context = "sellWithoutSignal";
    this.speak(context, { asset: operation.asset, amount: operation.amount, confidence: operation.analysisConfidence, reason: operation.analysisReason }, true, true);
  },
  updateQuestions(context) {
    const buttons = [...$("robotQuestions").querySelectorAll("button")];
    const noAccessContext = context === "noaccess" || (!dataReady() && context !== "waiting");
    const loggedOutContext = context === "loggedout" || !marketReady();
    const signalContext = ["buy", "sell", "open", "win", "loss", "draw", "buyAligned", "sellAligned", "buyAgainstSell", "sellAgainstBuy", "buyWithoutSignal", "sellWithoutSignal", "protectionReady", "protectionTaken", "protectionEarly"].includes(context);
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
    if (!dataReady()) {
      const replies = {
        cantread: "A leitura visual ainda está desligada. Sem a imagem das velas, eu não vou fingir que analisei.",
        fixread: "Clique em ‘Ativar leitura’ no topo e escolha esta mesma aba. Não precisa instalar extensão.",
        reallylive: "Agora, não. Quando a leitura visual estiver ativa, o topo vai mostrar ‘Leitura visual ao vivo’."
      };
      this.sayText(replies[question] || replies.cantread, this.currentContext, true);
      return;
    }
    if (!marketReady()) {
      const replies = {
        loginseen: "Um moço fuçando o aplicativo sem fazer login. Por enquanto, essa é toda a análise técnica disponível.",
        nologin: "Não, né, mano. Sem login eu não tenho ativo, velas nem saldo. Aí seria palpite fantasiado de análise.",
        next: "Faz login na Hezilex. Quando o gráfico abrir, eu começo a analisar sozinho, sem você apertar mais nada."
      };
      this.sayText(replies[question] || replies.loginseen, this.currentContext, true);
      return;
    }
    const analysis = currentAnalysis();
    const direction = analysis.direction;
    const label = direction === "BUY" ? "uma compra" : direction === "SELL" ? "uma venda" : "ficar de fora";
    const reason = String(analysis.reason || "os critérios ainda não fecharam").replace(/\.$/, "");
    const shortReason = reason.length > 112 ? `${reason.slice(0, 109)}…` : reason;
    const baseAmount = formatMoney(state.risk.baseAmount);
    const protectionActive = Boolean(state.protection?.active);
    const replies = {
      what: direction === "WAIT"
        ? `Olha, nesse caso aí, mano, era melhor esperar. ${shortReason}.`
        : `Olha, nesse caso aí, mano, o lado mais forte era ${label}, porque ${shortReason.toLowerCase()}.`,
      why: direction === "WAIT"
        ? `Eu não escolhi um lado: ${shortReason}. Sem confirmação, melhor não inventar.`
        : `${label === "uma compra" ? "Compra" : "Venda"}, porque ${shortReason.toLowerCase()}. Confiança em ${Math.round(Number(analysis.confidence) || 0)}%.`,
      risk: protectionActive
        ? state.protection?.ready
          ? `A proteção chegou ao ponto em ${state.protection.asset || state.asset}. A referência é ${formatMoney(state.protection.suggestedAmount)} no mesmo sentido da primeira entrada.`
          : `A proteção está preparada em ${state.protection.asset || state.asset}, mas ainda não chegou ao nível. Espera o alerta.`
        : `Sem proteção ativa agora. O limite da entrada inicial é 1% do saldo, hoje ${baseAmount}.`,
      setup: `Gráfico ${state.timeframe || "não identificado"}, expiração ${state.expiration || "não identificada"} e 1% em ${baseAmount}. ${state.defaults?.timeframe && state.defaults?.expiration ? "Está alinhado." : "Ainda falta ajustar."}`,
      why5m: "Cinco minutos filtra parte do ruído e compara a análise com a mesma duração da operação. Menos bagunça, mais contexto.",
      seen: direction === "WAIT"
        ? `Estou vendo ${state.asset || "o ativo"}, mas ainda sem lado confiável: ${shortReason}.`
        : `${state.asset || selectedRadarAsset || "O ativo"} favorece ${label}, com ${Math.round(Number(analysis.confidence) || 0)}%: ${shortReason}.`,
      missing: direction === "WAIT" ? `Falta confirmação: ${shortReason}. Quando fechar, eu mudo o sinal sozinho.` : `O sinal já apareceu para ${label}. Agora falta você decidir sem pressa.`
    };
    this.sayText(replies[question] || replies.seen, this.currentContext, true);
  },
  toggleQuestions() {
    if ($("robotOverlay").classList.contains("minimized")) {
      this.toggle();
      return;
    }
    const panel = $("robotQuestions");
    panel.hidden = !panel.hidden;
    $("robotOverlay").classList.toggle("questions-open", !panel.hidden);
    requestAnimationFrame(keepRobotInViewport);
  },
  init() {
    const storedPreference = localStorage.getItem("atlas-robot-minimized");
    const minimized = storedPreference === "1" || (storedPreference == null && matchMedia("(max-width: 720px)").matches);
    $("robotOverlay").classList.toggle("minimized", minimized);
    $("robotToggle").textContent = minimized ? "+" : "−";
    $("robotToggle").setAttribute("aria-expanded", String(!minimized));
    this.syncAudioControls();
    this.selectNarratorVoice();
    restoreRobotPosition();
    this.speak("waiting", {}, true);
  },
  toggle() {
    const characterBefore = $("robotCharacter").getBoundingClientRect();
    const minimized = $("robotOverlay").classList.toggle("minimized");
    $("robotQuestions").hidden = true;
    $("robotOverlay").classList.remove("questions-open");
    $("robotToggle").textContent = minimized ? "+" : "−";
    $("robotToggle").setAttribute("aria-expanded", String(!minimized));
    $("robotToggle").setAttribute("aria-label", minimized ? "Abrir Atlas Bot" : "Minimizar Atlas Bot");
    localStorage.setItem("atlas-robot-minimized", minimized ? "1" : "0");
    requestAnimationFrame(() => {
      const overlay = $("robotOverlay");
      const characterAfter = $("robotCharacter").getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      applyRobotPosition(
        overlayRect.left + characterBefore.left - characterAfter.left,
        overlayRect.top + characterBefore.top - characterAfter.top,
        true
      );
      keepRobotInViewport();
    });
  }
};

function formatMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function showToast(message, kind = "info", duration = 4200) {
  const toast = $("toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${kind}`;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}

let tradeFlashTimer = null;
function flashTrade(direction, severity = "normal") {
  const flash = $("tradeFlash");
  if (!flash || !["BUY", "SELL"].includes(direction)) return;
  clearTimeout(tradeFlashTimer);
  flash.className = "trade-flash";
  void flash.offsetWidth;
  flash.classList.add(direction === "BUY" ? "buy" : "sell");
  if (["danger", "critical"].includes(severity)) flash.classList.add(severity);
  tradeFlashTimer = setTimeout(() => { flash.className = "trade-flash"; }, severity === "critical" ? 1500 : 1050);
}

function renderConnection(connected) {
  $("connectionState").classList.toggle("ready", connected);
  $("connectionText").textContent = connected
    ? screenReaderReady ? "Leitura visual ao vivo" : marketReady() ? "Análise ao vivo" : "Esperando login"
    : "Ative a leitura visual";
}

function renderState(next = {}, source = "extension") {
  const previousDirection = displayedAnalysis?.direction || "WAIT";
  const previousSetup = displayedAnalysis?.setup || "";
  const previousOperationKey = state.manualOperation?.key;
  const previousUiEventKey = state.uiEvent?.key;
  const nextAsset = "asset" in next ? normalizeAssetName(next.asset) : state.asset;
  const normalizedAsset = source === "screen" && !nextAsset ? state.asset : nextAsset;
  const normalizedOperation = next.manualOperation
    ? { ...next.manualOperation, asset: normalizeAssetName(next.manualOperation.asset) || normalizedAsset }
    : next.manualOperation;
  state = {
    ...state,
    ...next,
    asset: normalizedAsset,
    ...(normalizedOperation ? { manualOperation: normalizedOperation } : {}),
    analysis: { ...state.analysis, ...(next.analysis || {}) },
    risk: { ...state.risk, ...(next.risk || {}) },
    defaults: { ...state.defaults, ...(next.defaults || {}) }
  };
  if (source === "screen") screenReaderReady = true;
  else extensionReady = true;
  renderConnection(dataReady());

  $("agentAsset").textContent = state.asset || "Localizando";
  $("agentTimeframe").textContent = state.timeframe || (state.defaults.timeframe ? "5m" : "—");
  $("agentExpiration").textContent = state.expiration || (state.defaults.expiration ? "5 min" : "—");
  $("riskAmount").textContent = formatMoney(state.risk.baseAmount);
  renderSetupWarnings();

  const identifiedAnalysis = analysisForIdentifiedAsset();
  displayedAnalysis = identifiedAnalysis.source === "market-radar-5m"
    ? { ...identifiedAnalysis, stability: "stable" }
    : signalStabilizer.update(identifiedAnalysis, state.asset);
  renderSignal(displayedAnalysis);

  const pulse = $("monitorPulse");
  const inspectedAt = state.lastInspectionAt ? new Date(state.lastInspectionAt).getTime() : 0;
  const fresh = inspectedAt && Date.now() - inspectedAt < 9000;
  pulse.classList.toggle("live", Boolean(fresh));
  pulse.textContent = fresh ? "Analisando agora" : "Conectado · aguardando dados";
  const loggedIn = marketReady();
  const visualIdentificationActive = screenReaderReady && state.monitoring === true;
  const justLoggedIn = loggedIn && lastLoginState !== true;
  robot.pruneQueue();
  if (!loggedIn) {
    if (visualIdentificationActive) {
      $("agentAsset").textContent = "Identificando ativo";
      $("analysisReason").textContent = "A leitura está ativa. Estou localizando o nome e o gráfico do ativo selecionado.";
      pulse.classList.add("live");
      pulse.textContent = "Lendo a tela agora";
      return;
    }
    $("agentAsset").textContent = "Faça login";
    $("analysisReason").textContent = "Entre na Hezilex para eu começar a análise de verdade.";
    pulse.classList.remove("live");
    pulse.textContent = "Esperando você entrar";
    if (lastLoginState !== false || robot.currentContext !== "loggedout") robot.speak("loggedout", {}, true, true);
    lastLoginState = false;
    return;
  }
  lastLoginState = true;
  if (justLoggedIn) robot.speak("connect", {}, true, true);
  const newOperation = state.manualOperation?.key && state.manualOperation.key !== previousOperationKey;
  const newIntracandleReversal = displayedAnalysis?.setup === "INTRACANDLE_REVERSAL"
    && displayedAnalysis?.direction !== "WAIT"
    && (previousSetup !== "INTRACANDLE_REVERSAL" || previousDirection === "WAIT");
  const renewedSameDirection = displayedAnalysis?.entryOpportunityRenewed === true
    && displayedAnalysis.direction === previousDirection
    && ["BUY", "SELL"].includes(displayedAnalysis.direction);
  if (newOperation && state.manualOperation.outcome === "OPEN") {
    flashTrade(state.manualOperation.direction, state.manualOperation.exposure?.severity);
  }
  if (state.uiEvent?.type === "PROTECTION_READY" && state.uiEvent.key !== previousUiEventKey) {
    const amount = Number(state.uiEvent.suggestedAmount);
    robot.speak("protectionReady", { asset: state.uiEvent.asset, direction: state.uiEvent.direction, amount }, true, true);
    showToast(`Proteção no ponto em ${state.uiEvent.asset}: ${state.uiEvent.direction === "SELL" ? "VENDA" : "COMPRA"}${Number.isFinite(amount) ? ` de ${formatMoney(amount)}` : ""}.`, "success", 8000);
  }
  else if (newOperation) robot.commentOnOperation(state.manualOperation);
  else if (newIntracandleReversal) {
    const side = displayedAnalysis.direction === "BUY" ? "COMPRA" : "VENDA";
    showToast(`Possível reversão para ${side} nesta vela. Aguarde o melhor ponto de entrada.`, "info", 8000);
    robot.speak(displayedAnalysis.direction === "BUY" ? "reversalBuy" : "reversalSell", { asset: state.asset }, true, true);
  }
  else if (renewedSameDirection) {
    const side = displayedAnalysis.direction === "BUY" ? "COMPRA" : "VENDA";
    flashTrade(displayedAnalysis.direction);
    showToast(`Nova oportunidade de ${side} confirmada em ${state.asset}.`, "success", 7000);
    if (robot.canSpeakAutomatically()) {
      robot.speak(displayedAnalysis.direction === "BUY" ? "buy" : "sell", { confidence: displayedAnalysis.confidence }, true, true);
    }
  }
  else if (justLoggedIn) return;
  else if (displayedAnalysis.direction !== previousDirection
    && displayedAnalysis.direction !== "WAIT"
    && Number(displayedAnalysis.confidence) >= 70
    && robot.canSpeakAutomatically()) {
    robot.speak(displayedAnalysis.direction === "BUY" ? "buy" : displayedAnalysis.direction === "SELL" ? "sell" : "wait", { confidence: displayedAnalysis.confidence }, true, true);
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
    renderState(event.data.state || {}, "extension");
    return;
  }
  const request = pending.get(event.data.requestId);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(event.data.requestId);
  if (event.data.state) renderState(event.data.state, "extension");
  if (event.data.type === "error") request.reject(new Error(event.data.error || "Não foi possível aplicar a configuração."));
  else request.resolve(event.data.result);
});

async function verifyExtension() {
  if (screenReaderReady && !extensionReady) return;
  if (verificationInFlight) return;
  verificationInFlight = true;
  try {
    const result = await sendCommand("ping", {}, 1600);
    renderState(result, "extension");
  } catch {
    if (!dataReady()) {
      renderConnection(false);
      robot.speak("noaccess");
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
$("robotToggle").addEventListener("click", () => robot.toggle());
$("robotVoiceToggle")?.addEventListener("click", () => robot.setSoundEnabled(!robot.soundEnabled));
let suppressRobotClickUntil = 0;
const robotDrag = { active: false, moved: false, pointerId: null, startX: 0, startY: 0, left: 0, top: 0 };

function clampRobotPosition(left, top) {
  const overlay = $("robotOverlay");
  return {
    left: Math.max(8, Math.min(left, innerWidth - overlay.offsetWidth - 8)),
    top: Math.max(8, Math.min(top, innerHeight - overlay.offsetHeight - 8))
  };
}

function applyRobotPosition(left, top, persist = false) {
  const overlay = $("robotOverlay");
  const point = clampRobotPosition(left, top);
  overlay.classList.add("dragged-position");
  overlay.style.left = `${point.left}px`;
  overlay.style.top = `${point.top}px`;
  overlay.style.right = "auto";
  overlay.style.bottom = "auto";
  if (persist) localStorage.setItem("atlas-robot-position", JSON.stringify(point));
}

function keepRobotInViewport() {
  const overlay = $("robotOverlay");
  const rect = overlay.getBoundingClientRect();
  const point = clampRobotPosition(rect.left, rect.top);
  const escaped = rect.left < 8 || rect.top < 8 || rect.right > innerWidth - 8 || rect.bottom > innerHeight - 8;
  if (escaped) applyRobotPosition(point.left, point.top, false);
}

function restoreRobotPosition() {
  try {
    const point = JSON.parse(localStorage.getItem("atlas-robot-position") || "null");
    if (Number.isFinite(point?.left) && Number.isFinite(point?.top)) applyRobotPosition(point.left, point.top);
  } catch { /* posição padrão */ }
}

$("robotCharacter").addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  const rect = $("robotOverlay").getBoundingClientRect();
  Object.assign(robotDrag, { active: true, moved: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top });
  $("robotOverlay").classList.add("dragging");
  $("robotCharacter").setPointerCapture?.(event.pointerId);
});
$("robotCharacter").addEventListener("pointermove", event => {
  if (!robotDrag.active || event.pointerId !== robotDrag.pointerId) return;
  const dx = event.clientX - robotDrag.startX;
  const dy = event.clientY - robotDrag.startY;
  if (!robotDrag.moved && Math.hypot(dx, dy) < 7) return;
  robotDrag.moved = true;
  event.preventDefault();
  applyRobotPosition(robotDrag.left + dx, robotDrag.top + dy);
});
function finishRobotDrag(event) {
  if (!robotDrag.active || event.pointerId !== robotDrag.pointerId) return;
  robotDrag.active = false;
  $("robotOverlay").classList.remove("dragging");
  if (!robotDrag.moved) return;
  const rect = $("robotOverlay").getBoundingClientRect();
  applyRobotPosition(rect.left, rect.top, true);
  suppressRobotClickUntil = Date.now() + 350;
  const moves = Number(localStorage.getItem("atlas-robot-moves") || 0) + 1;
  localStorage.setItem("atlas-robot-moves", String(moves));
  if (moves % 3 === 0) robot.speak("dragged", {}, true, true);
}
$("robotCharacter").addEventListener("pointerup", finishRobotDrag);
$("robotCharacter").addEventListener("pointercancel", finishRobotDrag);
$("robotCharacter").addEventListener("click", () => {
  if (Date.now() < suppressRobotClickUntil) return;
  robot.toggleQuestions();
});
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
$("robotSoundToggle")?.addEventListener("change", event => robot.setSoundEnabled(event.currentTarget.checked));
addEventListener("pointerdown", () => {
  robot.unlockSound();
  robot.drainNarration();
}, { capture: true, once: true });
if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => robot.selectNarratorVoice());
}

$("setupWarnings")?.addEventListener("click", event => {
  const button = event.target.closest("[data-setup-warning-dismiss]");
  if (!button) return;
  setupWarningTracker.dismiss(button.dataset.setupWarningDismiss, state.asset);
  setupWarningRenderKey = "";
  renderSetupWarnings(true);
});

addEventListener("atlas:trends", event => {
  marketTrends = Array.isArray(event.detail?.items) ? event.detail.items : [];
  if (state.asset && trendForAsset(state.asset)) {
    displayedAnalysis = { ...effectiveAnalysis(), stability: "stable" };
    renderSignal(displayedAnalysis);
  }
});

addEventListener("atlas:trend-selected", event => {
  const trend = event.detail;
  if (!trend?.asset) return;
  selectedRadarAsset = normalizeAssetName(trend.asset);
  signalStabilizer.reset(selectedRadarAsset);
  displayedAnalysis = null;
  $("agentAsset").textContent = selectedRadarAsset;
  $("agentTimeframe").textContent = trend.timeframe || "5m";
  renderSignal({
    ...trend,
    reason: `Radar 5M: ${trend.reason || "tendência calculada com EMA9, EMA21, RSI e momentum"}`,
    source: "market-radar-5m"
  });
  $("monitorPulse").classList.add("live");
  $("monitorPulse").textContent = "Radar 5M selecionado";
  showToast(`${selectedRadarAsset}: ${trend.direction === "BUY" ? "COMPRA" : trend.direction === "SELL" ? "VENDA" : "AGUARDAR"} no Radar 5M.`, "info", 5000);
});

addEventListener("atlas:screen-started", () => {
  screenReaderReady = true;
  renderConnection(true);
  $("monitorPulse").classList.add("live");
  $("monitorPulse").textContent = "Iniciando leitura do gráfico…";
  $("analysisReason").textContent = "Leitura ativada. Localizando o ativo e reunindo as primeiras velas.";
  robot.pruneQueue();
});

addEventListener("atlas:screen-state", event => {
  screenReaderReady = true;
  renderState(event.detail || {}, "screen");
});

addEventListener("atlas:screen-stopped", () => {
  screenReaderReady = false;
  renderConnection(extensionReady);
  if (!extensionReady) $("monitorPulse").textContent = "Leitura visual desativada";
});

let glowFrame = 0;
let glowPoint = { x: innerWidth / 2, y: innerHeight * .32 };
addEventListener("pointermove", event => {
  glowPoint = { x: event.clientX, y: event.clientY };
  if (glowFrame) return;
  glowFrame = requestAnimationFrame(() => {
    document.documentElement.style.setProperty("--cursor-x", `${glowPoint.x}px`);
    document.documentElement.style.setProperty("--cursor-y", `${glowPoint.y}px`);
    glowFrame = 0;
  });
}, { passive: true });

robot.init();
renderConnection(false);
setInterval(verifyExtension, 2500);
function refreshReadingFeedback() {
  const inspectedAt = state.lastInspectionAt ? new Date(state.lastInspectionAt).getTime() : 0;
  if (!dataReady()) return;
  const ageSeconds = inspectedAt ? Math.max(0, Math.floor((Date.now() - inspectedAt) / 1000)) : null;
  const pulse = $("monitorPulse");
  if (ageSeconds == null) {
    pulse.classList.add("live");
    pulse.textContent = "Preparando a primeira leitura…";
    return;
  }
  if (ageSeconds > 12) {
    pulse.classList.remove("live");
    pulse.textContent = `Sem nova imagem há ${ageSeconds}s`;
    return;
  }
  pulse.classList.add("live");
  const asset = state.asset || "o ativo";
  const direction = String(currentAnalysis()?.direction || "WAIT").toUpperCase();
  pulse.textContent = direction === "WAIT"
    ? `Analisando ${asset} · leitura há ${ageSeconds}s`
    : `${direction === "BUY" ? "Compra" : "Venda"} mantida · leitura há ${ageSeconds}s`;
}
setInterval(refreshReadingFeedback, 1000);
addEventListener("resize", () => {
  keepRobotInViewport();
}, { passive: true });
new ResizeObserver(() => requestAnimationFrame(keepRobotInViewport)).observe($("robotOverlay"));
