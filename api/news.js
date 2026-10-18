const { getDb } = require("../lib/db");
const { getPublicSettings } = require("../lib/settings");

const HIGH = /(banco central|central bank|fed\b|fomc|taxa de juros|interest rate|infla[cç][aã]o|inflation|payroll|emprego|guerra|war\b|san[cç][aã]o|sanction|hack|exploit|etf|regula[cç][aã]o|regulation)/i;
const MEDIUM = /(pib|gdp|desemprego|unemployment|elei[cç][aã]o|election|petr[oó]leo|oil\b|tarifa|tariff|cripto|crypto|bitcoin|ethereum|mercado|market)/i;

function impactFor(article) {
  const text = `${article.title || ""} ${article.seendate || ""}`;
  if (HIGH.test(text)) return 5;
  if (MEDIUM.test(text)) return 4;
  return 3;
}

function decodeXml(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, "").trim();
}

function tag(xml, name) {
  return decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
}

async function googleNewsFallback(query) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query.replace(/[()\"]/g, ""));
  url.searchParams.set("hl", "pt-BR");
  url.searchParams.set("gl", "BR");
  url.searchParams.set("ceid", "BR:pt-419");
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`Google News ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 10).map(match => {
    const body = match[1];
    const article = { title: tag(body, "title"), url: tag(body, "link"), source: tag(body, "source") || "Google News", publishedAt: tag(body, "pubDate"), image: "", language: "pt" };
    return { ...article, impact: impactFor(article), impactLabel: "Impacto estimado pelo Atlas" };
  }).filter(article => article.title && article.url);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
  res.setHeader("Cache-Control", "public, s-maxage=180, stale-while-revalidate=600");
  try {
    const settings = await getPublicSettings(getDb());
    const rssItems = await googleNewsFallback(settings.market.newsQuery).catch(() => []);
    if (rssItems.length) return res.status(200).json({ items: rssItems, source: "Google News RSS", updatedAt: new Date().toISOString() });
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", settings.market.newsQuery);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "datedesc");
    url.searchParams.set("maxrecords", "10");
    url.searchParams.set("timespan", "12h");
    const response = await fetch(url, { headers: { "User-Agent": "AtlasMarketAssistant/3.0" }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      const items = await googleNewsFallback(settings.market.newsQuery);
      return res.status(200).json({ items, source: "Google News RSS (fallback do GDELT)", updatedAt: new Date().toISOString() });
    }
    const payload = await response.json();
    const seen = new Set();
    const items = (payload.articles || []).filter(article => article.url && article.title).filter(article => {
      const key = String(article.title).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10).map(article => ({
      title: article.title,
      url: article.url,
      source: article.domain || "Fonte externa",
      image: article.socialimage || "",
      publishedAt: article.seendate || "",
      language: article.language || "",
      impact: impactFor(article),
      impactLabel: "Impacto estimado pelo Atlas"
    }));
    return res.status(200).json({ items, source: "GDELT", updatedAt: new Date().toISOString() });
  } catch (error) {
    try {
      const settings = await getPublicSettings(getDb());
      const items = await googleNewsFallback(settings.market.newsQuery);
      return res.status(200).json({ items, source: "Google News RSS (fallback do GDELT)", updatedAt: new Date().toISOString() });
    } catch (fallbackError) {
      console.error(error, fallbackError);
      return res.status(502).json({ error: "As notícias estão atualizando. Tente novamente em instantes.", items: [] });
    }
  }
};
