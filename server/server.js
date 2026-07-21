require("dotenv").config();
const express = require("express");
const cors = require("cors");

const store = require("./services/store");
const { refreshCompany } = require("./services/claudeAgent");
const { scanForNegativeData } = require("./services/negativeDataAgent");
const { toExportPayload, forwardToWebhook } = require("./services/exportService");

const app = express();
app.use(express.json());

const corsOriginSetting = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: corsOriginSetting === "*" ? "*" : corsOriginSetting.split(",").map((s) => s.trim()),
  })
);

function requireAccessCode(req, res, next) {
  const required = process.env.DASHBOARD_ACCESS_CODE;
  if (!required) return next(); // no code configured -- local/dev mode
  const provided = req.get("x-dashboard-code");
  if (provided !== required) {
    return res.status(401).json({ error: "Missing or incorrect access code." });
  }
  next();
}

// ---------- Companies ----------

app.get("/api/companies", (req, res) => {
  try {
    res.json(store.getAllCompanies());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/companies/:id/refresh", requireAccessCode, async (req, res) => {
  try {
    const company = store.getCompany(req.params.id);
    const result = await refreshCompany(company);
    res.json(store.applyCompanyRefresh(req.params.id, result));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/companies/:id/approve", (req, res) => {
  try {
    res.json(store.approveCompany(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/companies/:id/reject", (req, res) => {
  try {
    res.json(store.rejectCompany(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Negative-data findings ----------

app.get("/api/findings", (req, res) => {
  try {
    res.json(store.getAllFindings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Triggers the free Europe PMC search + paid Claude classification pipeline.
app.post("/api/findings/scan", requireAccessCode, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 15;
    const { candidatesScanned, hitCount, queryUsed, findings, skipped } = await scanForNegativeData(limit);
    const added = store.addFindings(findings);
    res.json({ hitCount, queryUsed, candidatesScanned, added: added.length, skippedCount: skipped.length, skipped, findings: added });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/findings/:id/approve", async (req, res) => {
  try {
    const finding = store.setFindingStatus(req.params.id, "approved_for_export");
    const webhookResult = await forwardToWebhook(finding);
    res.json({ finding, webhook: webhookResult });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/findings/:id/reject", (req, res) => {
  try {
    res.json(store.setFindingStatus(req.params.id, "rejected"));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/findings/:id/export", (req, res) => {
  try {
    const finding = store.getAllFindings().find((f) => f.id === req.params.id);
    if (!finding) return res.status(404).json({ error: "Finding not found." });
    res.json(toExportPayload(finding));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`Elnora agent dashboard API listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("WARNING: ANTHROPIC_API_KEY is not set -- refresh/scan endpoints will fail until it is.");
  }
  if (!process.env.ELNORA_WEBHOOK_URL) {
    console.log("No ELNORA_WEBHOOK_URL set -- approving findings will only return the export payload, not forward it anywhere.");
  }
});
