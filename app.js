const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, ".env") });
const mysqlEnvironment = path.join(__dirname, ".env.mysql");
if (fs.existsSync(mysqlEnvironment)) require("dotenv").config({ path: mysqlEnvironment, override: true });

const express = require("express");

const app = express();
const distRoot = path.join(__dirname, "dist");

app.disable("x-powered-by");
app.set("trust proxy", true);

function run(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

const apiHandlers = {
  "/api/auth": require("./api/auth"),
  "/api/admin-settings": require("./api/admin-settings"),
  "/api/admin-users": require("./api/admin-users"),
  "/api/extension-status": require("./api/extension-status"),
  "/api/me": require("./api/me"),
  "/api/news": require("./api/news"),
  "/api/password-reset": require("./api/password-reset"),
  "/api/payment-create": require("./api/payment-create"),
  "/api/payment-status": require("./api/payment-status"),
  "/api/profile": require("./api/profile"),
  "/api/public-config": require("./api/public-config"),
  "/api/trends": require("./api/trends")
};

app.post(
  "/api/venopag-webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  (req, _res, next) => {
    if (Buffer.isBuffer(req.body)) req.body = req.body.toString("utf8");
    next();
  },
  run(require("./api/venopag-webhook"))
);

app.use(express.json({ limit: "1mb" }));
for (const [route, handler] of Object.entries(apiHandlers)) app.all(route, run(handler));

app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "atlas" }));
app.use(express.static(distRoot, { index: false, maxAge: "5m" }));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Rota não encontrada." });
  const cleanPath = decodeURIComponent(req.path).replace(/^\/+|\/+$/g, "");
  const candidates = cleanPath
    ? [path.join(distRoot, cleanPath, "index.html"), path.join(distRoot, `${cleanPath}.html`)]
    : [path.join(distRoot, "index.html")];
  const file = candidates.find(candidate => fs.existsSync(candidate));
  if (file) return res.sendFile(file);
  return next();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).json({ error: "O Atlas encontrou um erro interno." });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => console.log(`Atlas ativo na porta ${port}`));

