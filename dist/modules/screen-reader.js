import Tesseract from "/vendor/tesseract/tesseract.esm.min.js";

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

const ASSETS = [
  "BITCOIN", "ETHEREUM", "SOLANA", "CARDANO", "LITECOIN", "AVAX", "DOGE", "SUI",
  "XRP", "XPL", "STELLAR", "META", "TESLA", "MICROSOFT", "APPLE", "NETFLIX"
];
const FIAT = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD", "CHF"];

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

function normalizeText(value = "") {
  return String(value).toUpperCase().replace(/[|]/g, "I").replace(/\s+/g, " ").trim();
}

function assetFromText(value) {
  const text = normalizeText(value);
  const compact = text.replace(/[^A-Z]/g, "");
  for (const asset of ASSETS) {
    if (compact.includes(asset.replace(/[^A-Z]/g, ""))) return asset;
  }
  for (const left of FIAT) {
    for (const right of FIAT) {
      if (left !== right && compact.includes(`${left}${right}`)) return `${left}/${right}`;
    }
  }
  return null;
}

function balanceFromText(value) {
  const match = normalizeText(value).match(/R\$\s*([\d.]+(?:,\d{1,2})?)/);
  if (!match) return null;
  const parsed = Number(match[1].replaceAll(".", "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function analyzeCandles() {
  if (!context || !canvas.width || !canvas.height) return null;
  const left = Math.floor(canvas.width * .12);
  const right = Math.floor(canvas.width * .76);
  const top = Math.floor(canvas.height * .16);
  const bottom = Math.floor(canvas.height * .76);
  const width = right - left;
  const height = bottom - top;
  const pixels = context.getImageData(left, top, width, height).data;
  let green = 0;
  let red = 0;
  let greenWeight = 0;
  let redWeight = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const recentWeight = .55 + (x / width) * .9;
      if (g > 105 && g > r * 1.28 && g > b * 1.12) {
        green += 1;
        greenWeight += recentWeight;
      } else if (r > 145 && r > g * 1.3 && r > b * 1.08) {
        red += 1;
        redWeight += recentWeight;
      }
    }
  }
  const colored = green + red;
  if (colored < 85) return { direction: "WAIT", confidence: 0, chartDetected: false, reason: "Leitura visual ativa, aguardando o gráfico aparecer por completo." };
  const totalWeight = greenWeight + redWeight || 1;
  const pressure = (greenWeight - redWeight) / totalWeight;
  const direction = pressure > .085 ? "BUY" : pressure < -.085 ? "SELL" : "WAIT";
  const confidence = direction === "WAIT" ? Math.round(45 + Math.abs(pressure) * 35) : Math.round(Math.min(89, 56 + Math.abs(pressure) * 42));
  const reason = direction === "BUY"
    ? "Leitura visual: as velas recentes mostram pressão compradora."
    : direction === "SELL"
      ? "Leitura visual: as velas recentes mostram pressão vendedora."
      : "Leitura visual: compradores e vendedores ainda estão equilibrados.";
  return { direction, confidence, chartDetected: true, reason, source: "screen-capture", greenPixels: green, redPixels: red };
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

async function readVisibleText() {
  if (ocrBusy || Date.now() - lastOcrAt < 4500 || !canvas.width) return {};
  ocrBusy = true;
  lastOcrAt = Date.now();
  try {
    const reader = await ensureOcrWorker();
    ocrCanvas.width = canvas.width;
    ocrCanvas.height = Math.max(120, Math.floor(canvas.height * .34));
    ocrContext.drawImage(canvas, 0, 0, canvas.width, ocrCanvas.height, 0, 0, ocrCanvas.width, ocrCanvas.height);
    const result = await reader.recognize(ocrCanvas);
    const text = result?.data?.text || "";
    return { asset: assetFromText(text), balance: balanceFromText(text), timeframe: /\b5\s*M(?:IN)?\b/i.test(text) ? "5m" : null };
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
    const targetWidth = Math.min(960, video.videoWidth);
    const targetHeight = Math.round(video.videoHeight * (targetWidth / video.videoWidth));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    const analysis = analyzeCandles();
    const visible = await readVisibleText();
    lastAsset = visible.asset || lastAsset;
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
    analysisTimer = setInterval(inspectFrame, 2400);
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
