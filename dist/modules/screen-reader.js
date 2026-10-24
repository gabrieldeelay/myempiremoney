import Tesseract from "/vendor/tesseract/tesseract.esm.min.js";
import { analyzeChartPixels, createIntracandleReversalTracker, findActiveTabRect, fuzzyMatchAsset } from "./screen-vision.js?v=3.11.0";
import { createMinuteReadingStabilizer, minuteFromOcr } from "./setup-warning-state.js?v=3.10.0";

const ASSET_OCR_INTERVAL_MS = 900;
const READING_ISSUE_AFTER_MS = 6500;

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
let processing = false;
let ocrBusy = false;
let analysisTimer = null;
let lastAsset = null;
let lastOcrAt = 0;
let lastTabCenter = null;
let missedAssetReads = 0;
let lastSetupOcrAt = 0;
let lastTimeframe = null;
let lastExpiration = null;
let captureStartedAt = 0;
let missedChartReads = 0;
const timeframeReading = createMinuteReadingStabilizer();
const expirationReading = createMinuteReadingStabilizer();
const reversalTracker = createIntracandleReversalTracker();

function resetSetupReadings() {
  timeframeReading.reset();
  expirationReading.reset();
  lastTimeframe = null;
  lastExpiration = null;
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

function analyzeCandles() {
  if (!context || !canvas.width || !canvas.height) return null;
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  return analyzeChartPixels(frame.data, canvas.width, canvas.height);
}

function prepareOcrCrop(tab, textOnly = false) {
  const cropTop = Math.max(0, Math.round(tab.y - tab.height * 1.08));
  const cropLeft = Math.max(0, Math.round(tab.x + tab.width * (textOnly ? .12 : .02)));
  const cropWidth = Math.min(canvas.width - cropLeft, Math.round(tab.width * (textOnly ? .86 : .97)));
  const cropHeight = Math.min(canvas.height - cropTop, Math.round(tab.height * .9));
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
    ? { left: .045, width: .23 }
    : { left: .58, width: .3 };
  const cropLeft = Math.max(0, Math.round(frame.x + frame.width * region.left));
  const cropTop = Math.max(0, Math.round(activeTab?.y ? activeTab.y + 4 : frame.y + frame.height * .18));
  const cropWidth = Math.min(canvas.width - cropLeft, Math.round(frame.width * region.width));
  const cropHeight = Math.min(canvas.height - cropTop, Math.round(frame.height * .085));
  const scale = 4;
  ocrCanvas.width = Math.max(1, cropWidth * scale);
  ocrCanvas.height = Math.max(1, cropHeight * scale);
  ocrContext.imageSmoothingEnabled = false;
  ocrContext.fillStyle = "#fff";
  ocrContext.fillRect(0, 0, ocrCanvas.width, ocrCanvas.height);
  ocrContext.drawImage(canvas, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, ocrCanvas.width, ocrCanvas.height);
}

async function readSetupValues(activeTab) {
  if (ocrBusy || Date.now() - lastSetupOcrAt < 700 || !canvas.width) {
    return { timeframe: lastTimeframe, expiration: lastExpiration };
  }
  ocrBusy = true;
  lastSetupOcrAt = Date.now();
  try {
    const reader = await ensureOcrWorker();
    await reader.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      tessedit_char_whitelist: "015mMINin :"
    });
    prepareSetupCrop("timeframe", activeTab);
    const timeframeResult = await reader.recognize(ocrCanvas);
    prepareSetupCrop("expiration", activeTab);
    const expirationResult = await reader.recognize(ocrCanvas);
    const timeframeMinutes = timeframeReading.update(minuteFromOcr(timeframeResult?.data?.text));
    const expirationMinutes = expirationReading.update(minuteFromOcr(expirationResult?.data?.text));
    lastTimeframe = timeframeMinutes == null ? null : `${timeframeMinutes}m`;
    lastExpiration = expirationMinutes == null ? null : `${expirationMinutes} min`;
    return { timeframe: lastTimeframe, expiration: lastExpiration };
  } catch (error) {
    console.warn("Atlas setup OCR", error);
    const timeframeMinutes = timeframeReading.update(null);
    const expirationMinutes = expirationReading.update(null);
    lastTimeframe = timeframeMinutes == null ? null : `${timeframeMinutes}m`;
    lastExpiration = expirationMinutes == null ? null : `${expirationMinutes} min`;
    return { timeframe: lastTimeframe, expiration: lastExpiration };
  } finally {
    ocrBusy = false;
  }
}

async function ensureOcrWorker() {
  if (worker) return worker;
  setStatus("Preparando leitura de texto…", "waiting");
  worker = await Tesseract.createWorker("eng", 1, {
    workerPath: "/vendor/tesseract/worker.min.js",
    corePath: "/vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js",
    langPath: "/vendor/tesseract/lang",
    gzip: true,
    logger: message => {
      if (message.status === "recognizing text") setStatus(`Lendo a tela · ${Math.round((message.progress || 0) * 100)}%`, "waiting");
    }
  });
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    preserve_interword_spaces: "1"
  });
  return worker;
}

async function readVisibleText(activeTab, force = false) {
  if (!activeTab || ocrBusy || (!force && Date.now() - lastOcrAt < ASSET_OCR_INTERVAL_MS) || !canvas.width) return {};
  ocrBusy = true;
  lastOcrAt = Date.now();
  try {
    const reader = await ensureOcrWorker();
    prepareOcrCrop(activeTab);
    await reader.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ/0185"
    });
    const result = await reader.recognize(ocrCanvas);
    let text = result?.data?.text || "";
    let asset = fuzzyMatchAsset(text);
    if (!asset || ["BNB", "XPL", "XRP"].includes(asset)) {
      prepareOcrCrop(activeTab, true);
      await reader.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ/0185"
      });
      const fallbackResult = await reader.recognize(ocrCanvas);
      const fallbackText = fallbackResult?.data?.text || "";
      const fallbackAsset = fuzzyMatchAsset(fallbackText);
      text = `${text} ${fallbackText}`;
      asset = fallbackAsset || asset || fuzzyMatchAsset(text);
    }
    missedAssetReads = asset ? 0 : missedAssetReads + 1;
    return {
      asset: asset || lastAsset,
      recognizedAsset: asset,
      balance: balanceFromText(text),
      activeTabDetected: true
    };
  } catch (error) {
    console.warn("Atlas screen OCR", error);
    return {};
  } finally {
    ocrBusy = false;
  }
}

async function inspectFrame() {
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
    const rawAnalysis = analyzeCandles();
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const activeTab = findActiveTabRect(frame.data, canvas.width, canvas.height);
    const tabCenter = activeTab ? activeTab.x + activeTab.width / 2 : null;
    const tabMoved = tabCenter != null && lastTabCenter != null
      && Math.abs(tabCenter - lastTabCenter) > Math.max(18, canvas.width * .025);
    if (tabCenter != null) lastTabCenter = tabCenter;
    if (tabMoved) {
      missedAssetReads = 0;
    }
    const visible = await readVisibleText(activeTab, tabMoved || !lastAsset);
    const detectedNewAsset = Boolean(visible.recognizedAsset && visible.recognizedAsset !== lastAsset);
    if (detectedNewAsset) {
      reversalTracker.reset();
      resetSetupReadings();
    }
    if ("asset" in visible) lastAsset = visible.asset;
    if (detectedNewAsset) {
      window.dispatchEvent(new CustomEvent("atlas:screen-state", {
        detail: {
          bridge: "screen-capture",
          monitoring: true,
          asset: lastAsset,
          timeframe: null,
          expiration: null,
          chartDetected: Boolean(rawAnalysis?.chartDetected),
          readingIssue: null,
          analysis: rawAnalysis || { direction: "WAIT", confidence: 0, source: "screen-capture" },
          lastInspectionAt: new Date().toISOString()
        }
      }));
    }
    const setup = await readSetupValues(activeTab);
    const analysis = reversalTracker.update(rawAnalysis, lastAsset);
    missedChartReads = analysis?.chartDetected ? 0 : missedChartReads + 1;
    const readingAge = Date.now() - captureStartedAt;
    const readingIssue = readingAge < READING_ISSUE_AFTER_MS
      ? null
      : !activeTab
        ? "Não consegui localizar a aba ativa da Hezilex. Deixe a área das abas visível."
        : !lastAsset || missedAssetReads >= 4
          ? "Não consegui confirmar o nome do ativo. O Atlas continuará tentando sem trocar a análise atual."
          : missedChartReads >= 8
            ? `Reconheci ${lastAsset}, mas não consegui interpretar as velas do gráfico.`
            : (!setup.timeframe || !setup.expiration) && readingAge >= 9000
              ? "Não consegui confirmar o tempo do gráfico e da expiração. Verifique se os controles estão visíveis."
              : null;
    window.dispatchEvent(new CustomEvent("atlas:screen-state", {
      detail: {
        version: "visual-1.0",
        bridge: "screen-capture",
        monitoring: true,
        asset: lastAsset,
        timeframe: setup.timeframe,
        expiration: setup.expiration,
        timeframeChecked: Boolean(setup.timeframe),
        expirationChecked: Boolean(setup.expiration),
        setupChecked: Boolean(setup.timeframe && setup.expiration),
        balance: visible.balance,
        balanceConfidence: visible.balance != null ? "visual" : null,
        chartDetected: Boolean(analysis?.chartDetected),
        readingIssue,
        readingHealth: {
          activeTab: Boolean(activeTab),
          asset: Boolean(lastAsset),
          chart: Boolean(analysis?.chartDetected),
          timeframe: Boolean(setup.timeframe),
          expiration: Boolean(setup.expiration)
        },
        analysis: analysis || { direction: "WAIT", confidence: 0, reason: "Preparando a leitura visual.", source: "screen-capture" },
        lastInspectionAt: new Date().toISOString()
      }
    }));
    setStatus(analysis?.chartDetected ? "Leitura visual ao vivo" : "Procurando o gráfico…", analysis?.chartDetected ? "connected" : "waiting");
  } finally {
    processing = false;
  }
}

async function stopReading(reason = "Leitura visual desativada") {
  clearInterval(analysisTimer);
  analysisTimer = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  reversalTracker.reset();
  captureStartedAt = 0;
  missedChartReads = 0;
  missedAssetReads = 0;
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
    missedAssetReads = 0;
    missedChartReads = 0;
    lastOcrAt = 0;
    lastSetupOcrAt = 0;
    showActivationPrompt(false);
    stream.getVideoTracks()[0]?.addEventListener("ended", () => stopReading("Compartilhamento encerrado"), { once: true });
    setButtons("Encerrar leitura");
    setStatus("Iniciando leitura visual…", "waiting");
    window.dispatchEvent(new CustomEvent("atlas:screen-started"));
    await inspectFrame();
    analysisTimer = setInterval(inspectFrame, 850);
  } catch (error) {
    stream = null;
    showActivationPrompt(true);
    const denied = error?.name === "NotAllowedError";
    setStatus(denied ? "Compartilhamento não autorizado" : "Não foi possível iniciar a leitura", "error");
    setButtons("Ativar leitura da tela");
  }
}

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
