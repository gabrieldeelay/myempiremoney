import Tesseract from "/vendor/tesseract/tesseract.esm.min.js";
import { analyzeChartPixels, createIntracandleReversalTracker, findActiveTabRect, fuzzyMatchAsset } from "./screen-vision.js?v=3.22.0";
import { createMinuteReadingStabilizer, minuteFromOcr } from "./setup-warning-state.js?v=3.19.4";
import { isDeadlineError, withDeadline } from "./async-watchdog.js?v=3.19.5";

const ASSET_OCR_INTERVAL_MS = 450;
const READING_ISSUE_AFTER_MS = 6500;
const OCR_JOB_TIMEOUT_MS = 4500;
const OCR_START_TIMEOUT_MS = 12000;

const buttons = [...document.querySelectorAll("[data-screen-reader-start]")];
const statusLabels = [...document.querySelectorAll("[data-screen-reader-status]")];
const video = document.getElementById("screenReaderVideo");
const canvas = document.getElementById("screenReaderCanvas");
const context = canvas?.getContext("2d", { willReadFrequently: true });
const ocrCanvas = document.createElement("canvas");
const ocrContext = ocrCanvas.getContext("2d", { willReadFrequently: true });
const modal = document.getElementById("installModal");
const activationPrompts = [...document.querySelectorAll("[data-screen-reader-prompt]")];

let stream = null;
let worker = null;
let workerPromise = null;
let workerGeneration = 0;
let processing = false;
let textProcessing = false;
let inspectionEpoch = 0;
let lastCompletedInspectionAt = 0;
let lastTextInspectionAt = 0;
let lastVisualAnalysis = null;
let missingTabFrames = 0;
let ocrBusy = false;
let analysisTimer = null;
let videoFrameHandle = null;
let lastAsset = null;
let lastOcrAt = 0;
let lastTabCenter = null;
let missedAssetReads = 0;
let lastSetupOcrAt = { timeframe: 0, expiration: 0 };
let lastTimeframe = null;
let lastExpiration = null;
let captureStartedAt = 0;
let missedChartReads = 0;
let assetRevision = 0;
const timeframeReading = createMinuteReadingStabilizer({ requiredHits: 2, warningHits: 4 });
// Expiration sits next to a changing countdown. Requiring three matching OCR
// samples keeps a timer such as 01:34 from becoming a false "1 min" warning.
const expirationReading = createMinuteReadingStabilizer({ requiredHits: 3, warningHits: 7 });
const reversalTracker = createIntracandleReversalTracker();

function resetSetupReadings() {
  timeframeReading.reset();
  expirationReading.reset();
  lastTimeframe = null;
  lastExpiration = null;
  lastSetupOcrAt = { timeframe: 0, expiration: 0 };
}

function setStatus(label, kind = "") {
  statusLabels.forEach(element => {
    element.textContent = label;
    element.className = kind;
  });
}

function setButtons(label, disabled = false) {
  buttons.forEach(button => {
    button.textContent = label;
    button.disabled = disabled;
    button.classList.toggle("active", Boolean(stream));
  });
}

function showActivationPrompt(visible) {
  activationPrompts.forEach(prompt => { prompt.hidden = !visible; });
}

function balanceFromText(value) {
  const match = String(value).toUpperCase().match(/R\$\s*([\d.]+(?:,\d{1,2})?)/);
  if (!match) return null;
  const parsed = Number(match[1].replaceAll(".", "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function prepareOcrCrop(tab, textOnly = false) {
  // `tab.y` is the blue underline, not the top of the tab. Keep the crop inside
  // the selected tab so nearby labels (for example APPLE in the asset list) can
  // never replace the selected ticker.
  const cropTop = Math.max(0, Math.round(tab.y - tab.height * .82));
  const cropLeft = Math.max(0, Math.round(tab.x + tab.width * (textOnly ? .30 : .02)));
  const cropWidth = Math.min(canvas.width - cropLeft, Math.round(tab.width * (textOnly ? .66 : .97)));
  const cropHeight = Math.min(canvas.height - cropTop, Math.round(tab.height * .68));
  const scale = 4;
  const source = document.createElement("canvas");
  source.width = cropWidth;
  source.height = cropHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  sourceContext.drawImage(canvas, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const pixels = sourceContext.getImageData(0, 0, cropWidth, cropHeight);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const r = pixels.data[index];
    const g = pixels.data[index + 1];
    const b = pixels.data[index + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const ink = max > 135 && max - min < 70;
    pixels.data[index] = ink ? 0 : 255;
    pixels.data[index + 1] = ink ? 0 : 255;
    pixels.data[index + 2] = ink ? 0 : 255;
    pixels.data[index + 3] = 255;
  }
  sourceContext.putImageData(pixels, 0, 0);
  ocrCanvas.width = cropWidth * scale;
  ocrCanvas.height = cropHeight * scale;
  ocrContext.imageSmoothingEnabled = false;
  ocrContext.fillStyle = "#fff";
  ocrContext.fillRect(0, 0, ocrCanvas.width, ocrCanvas.height);
  ocrContext.drawImage(source, 0, 0, ocrCanvas.width, ocrCanvas.height);
}

function frameBounds() {
  const frame = document.getElementById("hezilexFrame");
  const rect = frame?.getBoundingClientRect();
  if (!rect?.width || !rect?.height || !window.innerWidth || !window.innerHeight) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }
  const scaleX = canvas.width / window.innerWidth;
  const scaleY = canvas.height / window.innerHeight;
  return {
    x: Math.max(0, Math.round(rect.left * scaleX)),
    y: Math.max(0, Math.round(rect.top * scaleY)),
    width: Math.min(canvas.width, Math.round(rect.width * scaleX)),
    height: Math.min(canvas.height, Math.round(rect.height * scaleY))
  };
}

function prepareSetupCrop(kind, activeTab) {
  const frame = frameBounds();
  const region = kind === "timeframe"
    // Read only the small 1m/5m selector. The wider toolbar contains other
    // numbers that repeatedly turned a visible 5m into a false 1m result.
    ? { left: .07, width: .10 }
    // Expiration is the narrow control at the far right of the chart. Keeping
    // this crop tight prevents the changing countdown above it from becoming
    // a false "1 min" reading.
    : { left: .78, width: .16 };
  const cropLeft = Math.max(0, Math.round(frame.x + frame.width * region.left));
  const cropTop = Math.max(0, Math.round(activeTab?.y
    ? activeTab.y + (kind === "expiration" ? Math.max(28, frame.height * .06) : 4)
    : frame.y + frame.height * (kind === "expiration" ? .235 : .18)));
  const cropWidth = Math.min(canvas.width - cropLeft, Math.round(frame.width * region.width));
  // The narrow expiration strip contains the selected "5 min" row but not
  // the countdown rendered above it. Timeframe keeps the larger tab crop.
  const cropHeight = Math.min(canvas.height - cropTop, Math.round(frame.height * (kind === "expiration" ? .05 : .085)));
  const scale = 4;
  ocrCanvas.width = Math.max(1, cropWidth * scale);
  ocrCanvas.height = Math.max(1, cropHeight * scale);
  ocrContext.imageSmoothingEnabled = false;
  ocrContext.fillStyle = "#fff";
  ocrContext.fillRect(0, 0, ocrCanvas.width, ocrCanvas.height);
  ocrContext.drawImage(canvas, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, ocrCanvas.width, ocrCanvas.height);
}

async function readSetupValue(kind, activeTab) {
  if (ocrBusy || Date.now() - lastSetupOcrAt[kind] < 700 || !canvas.width) {
    return kind === "timeframe" ? lastTimeframe : lastExpiration;
  }
  ocrBusy = true;
  lastSetupOcrAt[kind] = Date.now();
  try {
    const reader = await withDeadline(() => ensureOcrWorker(), OCR_START_TIMEOUT_MS, "Inicialização do OCR");
    const result = await withDeadline(async () => {
      await reader.setParameters({
        tessedit_pageseg_mode: kind === "timeframe" ? Tesseract.PSM.SINGLE_WORD : Tesseract.PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "015mMINin :"
      });
      prepareSetupCrop(kind, activeTab);
      return reader.recognize(ocrCanvas);
    }, OCR_JOB_TIMEOUT_MS, `Leitura de ${kind}`);
    const minutes = (kind === "timeframe" ? timeframeReading : expirationReading)
      .update(minuteFromOcr(result?.data?.text));
    const value = minutes == null ? null : `${minutes}${kind === "timeframe" ? "m" : " min"}`;
    if (kind === "timeframe") lastTimeframe = value;
    else lastExpiration = value;
    return value;
  } catch (error) {
    console.warn("Atlas setup OCR", error);
    if (isDeadlineError(error)) restartOcrWorker("Reiniciando leitura visual…");
    const minutes = (kind === "timeframe" ? timeframeReading : expirationReading).update(null);
    const value = minutes == null ? null : `${minutes}${kind === "timeframe" ? "m" : " min"}`;
    if (kind === "timeframe") lastTimeframe = value;
    else lastExpiration = value;
    return value;
  } finally {
    ocrBusy = false;
  }
}

async function ensureOcrWorker() {
  if (worker) return worker;
  if (workerPromise) return workerPromise;
  setStatus("Preparando leitura de texto…", "waiting");
  const generation = workerGeneration;
  workerPromise = (async () => {
    const created = await Tesseract.createWorker("eng", 1, {
      workerPath: "/vendor/tesseract/worker.min.js",
      corePath: "/vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js",
      langPath: "/vendor/tesseract/lang",
      gzip: true,
      logger: message => {
        if (message.status === "recognizing text") setStatus(`Lendo a tela · ${Math.round((message.progress || 0) * 100)}%`, "waiting");
      }
    });
    if (generation !== workerGeneration) {
      Promise.resolve(created.terminate?.()).catch(() => {});
      throw new Error("Leitor antigo descartado.");
    }
    await created.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1"
    });
    worker = created;
    return created;
  })();
  try {
    return await workerPromise;
  } finally {
    if (generation === workerGeneration) workerPromise = null;
  }
}

function restartOcrWorker(status = "Recuperando leitura visual…") {
  const staleWorker = worker;
  workerGeneration += 1;
  worker = null;
  workerPromise = null;
  ocrBusy = false;
  setStatus(status, "waiting");
  Promise.resolve(staleWorker?.terminate?.()).catch(() => {});
}

async function readVisibleText(activeTab, force = false) {
  if (!activeTab || ocrBusy || (!force && Date.now() - lastOcrAt < ASSET_OCR_INTERVAL_MS) || !canvas.width) return {};
  ocrBusy = true;
  lastOcrAt = Date.now();
  try {
    const reader = await withDeadline(() => ensureOcrWorker(), OCR_START_TIMEOUT_MS, "Inicialização do OCR");
    prepareOcrCrop(activeTab);
    const result = await withDeadline(async () => {
      await reader.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ/0185"
      });
      return reader.recognize(ocrCanvas);
    }, OCR_JOB_TIMEOUT_MS, "Leitura do ativo");
    let text = result?.data?.text || "";
    let asset = fuzzyMatchAsset(text);
    if (!asset) {
      prepareOcrCrop(activeTab, true);
      const fallbackResult = await withDeadline(async () => {
        await reader.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ/0185"
        });
        return reader.recognize(ocrCanvas);
      }, OCR_JOB_TIMEOUT_MS, "Confirmação do ativo");
      const fallbackText = fallbackResult?.data?.text || "";
      const fallbackAsset = fuzzyMatchAsset(fallbackText);
      text = `${text} ${fallbackText}`;
      // A fallback exists to rescue difficult short tickers. It must never
      // overwrite a ticker that the tighter first crop already recognized.
      asset = asset || fallbackAsset || fuzzyMatchAsset(text);
    }
    missedAssetReads = asset ? 0 : missedAssetReads + 1;
    return {
      asset,
      recognizedAsset: asset,
      balance: balanceFromText(text),
      activeTabDetected: true
    };
  } catch (error) {
    console.warn("Atlas screen OCR", error);
    if (isDeadlineError(error)) restartOcrWorker("Reiniciando identificação do ativo…");
    return {};
  } finally {
    ocrBusy = false;
  }
}

function publishFrameState(activeTab, analysis = null, visible = {}) {
  const readingAge = Date.now() - captureStartedAt;
  const readingIssue = readingAge < READING_ISSUE_AFTER_MS
    ? null
    : !activeTab
      ? "Não consegui localizar a aba ativa da Hezilex. Deixe a área das abas visível."
      : !lastAsset
        ? "Não consegui confirmar o nome do ativo. A leitura continua tentando, sem reutilizar outro ativo."
        : missedChartReads >= 8
          ? `Reconheci ${lastAsset}, mas não consegui interpretar as velas do gráfico.`
          : null;
  window.dispatchEvent(new CustomEvent("atlas:screen-state", {
    detail: {
      version: "visual-1.1",
      bridge: "screen-capture",
      monitoring: true,
      asset: lastAsset,
      assetPending: !lastAsset,
      assetRevision,
      timeframe: lastTimeframe,
      expiration: lastExpiration,
      timeframeChecked: Boolean(lastTimeframe),
      expirationChecked: Boolean(lastExpiration),
      setupChecked: Boolean(lastTimeframe && lastExpiration),
      ...(visible.balance != null ? { balance: visible.balance, balanceConfidence: "visual" } : {}),
      chartDetected: Boolean(analysis?.chartDetected),
      readingIssue,
      readingHealth: {
        activeTab: Boolean(activeTab),
        asset: Boolean(lastAsset),
        chart: Boolean(analysis?.chartDetected),
        timeframe: Boolean(lastTimeframe),
        expiration: Boolean(lastExpiration)
      },
      analysis: analysis || { direction: "WAIT", confidence: 0,
        reason: lastAsset ? "Não consegui interpretar as velas desta imagem." : "Identificando o ativo selecionado.",
        source: "screen-capture" },
      lastInspectionAt: new Date().toISOString()
    }
  }));
}

async function inspectText(activeTab, epoch) {
  if (textProcessing || !activeTab || !stream) return;
  textProcessing = true;
  lastTextInspectionAt = Date.now();
  try {
    // OCR runs separately from the video loop. A slow worker must never stop
    // current-candle updates while it recognizes the asset and setup labels.
    const visible = await readVisibleText(activeTab, !lastAsset);
    if (epoch !== inspectionEpoch || !stream) return;
    if (visible.recognizedAsset && visible.recognizedAsset !== lastAsset) {
      lastAsset = visible.recognizedAsset;
      assetRevision += 1;
      missedAssetReads = 0;
      reversalTracker.reset();
      resetSetupReadings();
      publishFrameState(activeTab, reversalTracker.update(lastVisualAnalysis, lastAsset), visible);
    } else if (!visible.recognizedAsset && missedAssetReads >= 3 && lastAsset) {
      // A ticker that cannot be re-read cannot retain another asset's signal.
      lastAsset = null;
      assetRevision += 1;
      reversalTracker.reset();
      resetSetupReadings();
      publishFrameState(activeTab);
    }
    await readSetupValue("timeframe", activeTab);
    if (epoch !== inspectionEpoch || !stream) return;
    await readSetupValue("expiration", activeTab);
    if (epoch !== inspectionEpoch || !stream) return;
    const analysis = lastAsset ? reversalTracker.update(lastVisualAnalysis, lastAsset) : null;
    publishFrameState(activeTab, analysis, visible);
  } catch (error) {
    if (epoch === inspectionEpoch) console.warn("Atlas text inspection", error);
  } finally {
    textProcessing = false;
  }
}

function inspectFrame() {
  if (!stream || processing || !video.videoWidth || !context) return;
  processing = true;
  try {
    const targetWidth = Math.min(1920, video.videoWidth);
    const targetHeight = Math.round(video.videoHeight * (targetWidth / video.videoWidth));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    lastVisualAnalysis = analyzeChartPixels(frame.data, canvas.width, canvas.height);
    const activeTab = findActiveTabRect(frame.data, canvas.width, canvas.height);
    const tabCenter = activeTab ? activeTab.x + activeTab.width / 2 : null;
    const tabMoved = tabCenter != null && lastTabCenter != null
      && Math.abs(tabCenter - lastTabCenter) > Math.max(18, canvas.width * .025);
    if (tabCenter != null) {
      lastTabCenter = tabCenter;
      missingTabFrames = 0;
    } else {
      missingTabFrames += 1;
    }
    if (tabMoved || missingTabFrames === 3 && lastAsset) {
      inspectionEpoch += 1;
      lastAsset = null;
      missedAssetReads = 0;
      assetRevision += 1;
      reversalTracker.reset();
      resetSetupReadings();
      publishFrameState(activeTab);
    }
    const analysis = lastAsset ? reversalTracker.update(lastVisualAnalysis, lastAsset) : null;
    missedChartReads = analysis?.chartDetected ? 0 : missedChartReads + 1;
    publishFrameState(activeTab, analysis);
    lastCompletedInspectionAt = Date.now();
    setStatus(analysis?.chartDetected ? "Leitura visual ao vivo" : "Procurando o gráfico…", analysis?.chartDetected ? "connected" : "waiting");
    if (activeTab && !textProcessing && Date.now() - lastTextInspectionAt >= 400) {
      void inspectText(activeTab, inspectionEpoch);
    }
  } catch (error) {
    console.warn("Atlas frame inspection", error);
    setStatus("Recuperando a análise ao vivo…", "waiting");
  } finally {
    processing = false;
  }
}

function startFrameLoop() {
  if (!stream) return;
  if (typeof video.requestVideoFrameCallback === "function") {
    const onFrame = () => {
      if (!stream) return;
      inspectFrame();
      videoFrameHandle = video.requestVideoFrameCallback(onFrame);
    };
    videoFrameHandle = video.requestVideoFrameCallback(onFrame);
  } else {
    analysisTimer = setInterval(inspectFrame, 125);
  }
}

function stopFrameLoop() {
  if (videoFrameHandle != null && typeof video.cancelVideoFrameCallback === "function") {
    video.cancelVideoFrameCallback(videoFrameHandle);
  }
  videoFrameHandle = null;
  clearInterval(analysisTimer);
  analysisTimer = null;
}

function recoverStalledReader() {
  if (!stream || document.hidden) return;
  const lastProgress = lastCompletedInspectionAt || captureStartedAt;
  if (Date.now() - lastProgress < 22000) return;
  inspectionEpoch += 1;
  processing = false;
  lastCompletedInspectionAt = Date.now();
  restartOcrWorker("Leitura interrompida. Reconectando automaticamente…");
  video.play().catch(() => {});
  window.dispatchEvent(new CustomEvent("atlas:screen-state", {
    detail: {
      bridge: "screen-capture", monitoring: true, asset: lastAsset,
      assetRevision, chartDetected: false,
      readingIssue: "A leitura visual ficou sem novas imagens. O Atlas está reconectando automaticamente.",
      analysis: { direction: "WAIT", confidence: 0, source: "screen-capture", chartDetected: false,
        reason: "Leitura visual interrompida; aguardando a reconexão antes de indicar uma entrada." }
    }
  }));
  inspectFrame();
}

async function stopReading(reason = "Leitura visual desativada") {
  inspectionEpoch += 1;
  processing = false;
  stopFrameLoop();
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  reversalTracker.reset();
  captureStartedAt = 0;
  lastCompletedInspectionAt = 0;
  missedChartReads = 0;
  missedAssetReads = 0;
  lastAsset = null;
  lastVisualAnalysis = null;
  lastTabCenter = null;
  missingTabFrames = 0;
  lastTextInspectionAt = 0;
  resetSetupReadings();
  showActivationPrompt(true);
  setStatus(reason, "");
  setButtons("Ativar leitura da tela");
  window.dispatchEvent(new CustomEvent("atlas:screen-stopped"));
}

async function startReading() {
  if (stream) {
    await stopReading();
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus("Este navegador não oferece captura de aba.", "error");
    return;
  }
  setButtons("Escolha a aba da Hezilex…", true);
  setStatus("Aguardando sua escolha da aba…", "waiting");
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", frameRate: { ideal: 8, max: 12 } },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "include"
    });
    video.srcObject = stream;
    await video.play();
    captureStartedAt = Date.now();
    lastCompletedInspectionAt = captureStartedAt;
    missedAssetReads = 0;
    missedChartReads = 0;
    lastOcrAt = 0;
    lastSetupOcrAt = { timeframe: 0, expiration: 0 };
    lastTextInspectionAt = 0;
    missingTabFrames = 0;
    showActivationPrompt(false);
    stream.getVideoTracks()[0]?.addEventListener("ended", () => stopReading("Compartilhamento encerrado"), { once: true });
    stream.getVideoTracks()[0]?.addEventListener("unmute", () => inspectFrame());
    setButtons("Encerrar leitura");
    setStatus("Iniciando leitura visual…", "waiting");
    window.dispatchEvent(new CustomEvent("atlas:screen-started"));
    inspectFrame();
    startFrameLoop();
  } catch (error) {
    stream = null;
    showActivationPrompt(true);
    const denied = error?.name === "NotAllowedError";
    setStatus(denied ? "Compartilhamento não autorizado" : "Não foi possível iniciar a leitura", "error");
    setButtons("Ativar leitura da tela");
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && stream) {
    video.play().catch(() => {});
    inspectFrame();
  }
});
setInterval(recoverStalledReader, 5000);

buttons.forEach(button => button.addEventListener("click", startReading));
document.querySelectorAll("[data-settings-trigger]").forEach(button => button.addEventListener("click", () => {
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("install-open");
}));
document.querySelectorAll("[data-install-close]").forEach(button => button.addEventListener("click", () => {
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("install-open");
}));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && modal && !modal.hidden) {
    modal.hidden = true;
    document.body.classList.remove("install-open");
  }
});
setStatus("Pronta para ativar", "");
showActivationPrompt(true);
