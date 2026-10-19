const EXTENSION_ID = "celdhajbbhljfcofpgkpfcmhcbpdafog";
const STORE_URL = `https://microsoftedge.microsoft.com/addons/detail/${EXTENSION_ID}`;
const CRX_URL = `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=${encodeURIComponent(`id=${EXTENSION_ID}&installsource=ondemand&uc`)}`;

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  response.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const result = await fetch(CRX_URL, { redirect: "manual" });
    const available = result.status >= 200 && result.status < 400;
    response.status(200).json({
      available,
      status: available ? "available" : "review",
      publicVersion: "2.3.0",
      candidateVersion: "2.5.3",
      storeUrl: available ? STORE_URL : null
    });
  } catch {
    response.status(200).json({
      available: false,
      status: "review",
      publicVersion: "2.3.0",
      candidateVersion: "2.5.3",
      storeUrl: null
    });
  }
};
