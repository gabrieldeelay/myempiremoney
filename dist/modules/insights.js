const tabs = [...document.querySelectorAll("[data-intel-tab]")];
const panels = [...document.querySelectorAll("[data-intel-panel]")];

function stars(count) {
  return `<span class="impact-stars" aria-label="Impacto ${count} de 5">${"★".repeat(count)}${"☆".repeat(5 - count)}</span>`;
}

function safeUrl(value) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : "#"; }
  catch { return "#"; }
}

function formatDate(value) {
  if (!value) return "Agora";
  const normalized = /^\d{14}$/.test(value) ? `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? "Agora" : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(date);
}

async function loadNews() {
  const feed = document.querySelector("#newsFeed");
  try {
    const response = await fetch("/api/news");
    const payload = await response.json();
    if (!response.ok || !payload.items?.length) throw new Error(payload.error || "Sem notícias no momento.");
    feed.innerHTML = payload.items.map(item => `<a class="news-chip" href="${safeUrl(item.url)}" target="_blank" rel="noreferrer"><span class="news-source">${item.source}</span><b>${item.title}</b><span class="news-meta">${stars(item.impact)} <em>${formatDate(item.publishedAt)}</em></span></a>`).join("");
  } catch (error) {
    feed.innerHTML = `<div class="intel-empty"><b>Radar atualizando</b><span>${error.message}</span><button type="button" data-retry-news>Tentar novamente</button></div>`;
    feed.querySelector("[data-retry-news]")?.addEventListener("click", loadNews);
  }
}

async function loadTrends() {
  const feed = document.querySelector("#trendsFeed");
  try {
    const response = await fetch("/api/trends");
    const payload = await response.json();
    if (!response.ok || !payload.items?.length) throw new Error(payload.error || "Sem tendências no momento.");
    feed.innerHTML = payload.items.map((item, index) => `<button type="button" class="trend-row ${item.direction.toLowerCase()}" data-trend-asset="${item.asset}" aria-label="Ver leitura de ${item.asset}"><span class="trend-rank">0${index + 1}</span><span><b>${item.asset}</b><small>RSI ${item.rsi} · ${item.timeframe}</small></span><strong>${item.direction === "BUY" ? "COMPRA" : item.direction === "SELL" ? "VENDA" : "AGUARDAR"}<small>${item.confidence}%</small></strong></button>`).join("");
    window.dispatchEvent(new CustomEvent("atlas:trends", { detail: { items: payload.items, source: payload.source, updatedAt: payload.updatedAt } }));
    feed.querySelectorAll("[data-trend-asset]").forEach(button => button.addEventListener("click", () => {
      const item = payload.items.find(trend => trend.asset === button.dataset.trendAsset);
      if (item) window.dispatchEvent(new CustomEvent("atlas:trend-selected", { detail: item }));
    }));
  } catch (error) {
    feed.innerHTML = `<div class="intel-empty"><b>Cálculo atualizando</b><span>${error.message}</span><button type="button" data-retry-trends>Tentar novamente</button></div>`;
    feed.querySelector("[data-retry-trends]")?.addEventListener("click", loadTrends);
  }
}

tabs.forEach(tab => tab.addEventListener("click", () => {
  tabs.forEach(item => item.classList.toggle("active", item === tab));
  panels.forEach(panel => { panel.hidden = panel.dataset.intelPanel !== tab.dataset.intelTab; });
}));

loadNews();
loadTrends();
setInterval(loadNews, 180000);
setInterval(loadTrends, 45000);
