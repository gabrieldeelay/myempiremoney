import Tesseract from "/vendor/tesseract/tesseract.esm.min.js";
import { analyzeChartPixels, findActiveTabRect, fuzzyMatchAsset } from "./screen-vision.js?v=3.3.0";

const buttons = [...document.querySelectorAll("[data-screen-reader-start]")];
const statusLabels = [...document.querySelectorAll("[data-screen-reader-status]")];
const video = document.getElementById("screenReaderVideo");
const canvas = document.getElementById("screenReaderCanvas");
const context = canvas?.getContext("2d", { willReadFrequently: true });
const ocrCanvas = document.createElement("canvas");
const ocrContext = ocrCanvas.getContext("2d", { willReadFrequently: true });
const modal = document.getElementById("installModal");

let stream = null;
let worker = null;
let processing = false;
let ocrBusy = false;
let analysisTimer = null;
let lastAsset = null;
let lastOcrAt = 0;
let lastTabCenter = null;
let missedAssetReads = 0;

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

function prepareOcrCrop(tab) {
  const cropTop = Math.max(0, Math.round(tab.y - tab.height * .82));
  const cropLeft = Math.max(0, Math.round(tab.x + tab.width * .3));
  const cropWidth = Math.min(canvas.width - cropLeft, Math.round(tab.width * .76));
  const cropHeight = Math.min(canvas.height - cropTop, Math.round(tab.height * .72));
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
  if (!activeTab || ocrBusy || (!force && Date.now() - lastOcrAt < 5000) || !canvas.width) return {};
  ocrBusy = true;
  lastOcrAt = Date.now();
  try {
    const reader = await ensureOcrWorker();
    prepareOcrCrop(activeTab);
    await reader.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ/"
    });
    const result = await reader.recognize(ocrCanvas);
    const text = result?.data?.text || "";
    const asset = fuzzyMatchAsset(text);
    missedAssetReads = asset ? 0 : missedAssetReads + 1;
    return {
      asset: asset || (missedAssetReads >= 2 ? null : lastAsset),
      balance: balanceFromText(text),
      timeframe: "5m",
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
    const analysis = analyzeCandles();
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const activeTab = findActiveTabRect(frame.data, canvas.width, canvas.height);
    const tabCenter = activeTab ? activeTab.x + activeTab.width / 2 : null;
    const tabMoved = tabCenter != null && lastTabCenter != null
      && Math.abs(tabCenter - lastTabCenter) > Math.max(18, canvas.width * .025);
    if (tabCenter != null) lastTabCenter = tabCenter;
    if (tabMoved) {
      lastAsset = null;
      missedAssetReads = 0;
    }
    const visible = await readVisibleText(activeTab, tabMoved || !lastAsset);
    if ("asset" in visible) lastAsset = visible.asset;
    window.dispatchEvent(new CustomEvent("atlas:screen-state", {
      detail: {
        version: "visual-1.0",
        bridge: "screen-capture",
        monitoring: true,
        asset: lastAsset,
        timeframe: visible.timeframe || "5m",
        balance: visible.balance,
        balanceConfidence: visible.balance != null ? "visual" : null,
        chartDetected: Boolean(analysis?.chartDetected),
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
    stream.getVideoTracks()[0]?.addEventListener("ended", () => stopReading("Compartilhamento encerrado"), { once: true });
    setButtons("Encerrar leitura");
    setStatus("Iniciando leitura visual…", "waiting");
    window.dispatchEvent(new CustomEvent("atlas:screen-started"));
    await inspectFrame();
    analysisTimer = setInterval(inspectFrame, 850);
  } catch (error) {
    stream = null;
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
