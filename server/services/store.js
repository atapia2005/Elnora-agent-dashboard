// store.js
//
// Two independent JSON-file-backed collections: companies (competitor intel)
// and findings (negative-data signals). Same "pending review before publish"
// principle as the Cytokinetics project applies to companies here; findings
// use an analogous pending -> approved/rejected status instead of a diff,
// since a finding is a new item rather than an update to an existing one.

const fs = require("fs");
const path = require("path");

const COMPANIES_PATH = path.join(__dirname, "..", "data", "companies.json");
const FINDINGS_PATH = path.join(__dirname, "..", "data", "findings.json");

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ---------- Companies ----------

function getAllCompanies() {
  return readJSON(COMPANIES_PATH);
}
function getCompany(id) {
  const c = getAllCompanies().find((c) => c.id === id);
  if (!c) throw new Error(`No company with id "${id}"`);
  return c;
}

// Free-text diff: flags a field as changed if the new value differs from the
// old one. Not numeric like the Cytokinetics runway model -- these fields are
// mostly prose, so we just show old vs. new and let the human reviewer judge.
function diffCompanySnapshot(oldSnap, newSnap) {
  const changes = [];
  for (const field of ["summary", "recentNews", "fundingKnown"]) {
    const oldVal = oldSnap[field] || null;
    const newVal = newSnap[field] || null;
    if (oldVal !== newVal) {
      changes.push({ field, from: oldVal, to: newVal });
    }
  }
  // Key features: flag any additions the agent found that weren't in baseline
  const oldFeatures = new Set(oldSnap.keyFeatures || []);
  const added = (newSnap.keyFeatures || []).filter((f) => !oldFeatures.has(f));
  if (added.length > 0) {
    changes.push({ field: "keyFeatures_added", from: null, to: added.join("; ") });
  }
  return changes;
}

function applyCompanyRefresh(id, newSnapshot) {
  const companies = getAllCompanies();
  const company = companies.find((c) => c.id === id);
  if (!company) throw new Error(`No company with id "${id}"`);

  const changes = diffCompanySnapshot(company.baseline, newSnapshot);
  company.pendingUpdate = { ...newSnapshot, fetchedAt: new Date().toISOString(), changes };
  company.history.push({ action: "refreshed", at: new Date().toISOString(), changeCount: changes.length });

  writeJSON(COMPANIES_PATH, companies);
  return company;
}

function approveCompany(id) {
  const companies = getAllCompanies();
  const company = companies.find((c) => c.id === id);
  if (!company) throw new Error(`No company with id "${id}"`);
  if (!company.pendingUpdate) throw new Error(`No pending update for "${id}"`);

  const { fetchedAt, changes, ...snapshot } = company.pendingUpdate;
  company.baseline = snapshot;
  company.pendingUpdate = null;
  company.history.push({ action: "approved", at: new Date().toISOString() });

  writeJSON(COMPANIES_PATH, companies);
  return company;
}

function rejectCompany(id) {
  const companies = getAllCompanies();
  const company = companies.find((c) => c.id === id);
  if (!company) throw new Error(`No company with id "${id}"`);

  company.pendingUpdate = null;
  company.history.push({ action: "rejected", at: new Date().toISOString() });

  writeJSON(COMPANIES_PATH, companies);
  return company;
}

// ---------- Findings ----------

function getAllFindings() {
  return readJSON(FINDINGS_PATH);
}

function addFindings(newFindings) {
  const findings = getAllFindings();
  const existingUrls = new Set(findings.map((f) => f.url));
  const added = [];
  for (const f of newFindings) {
    if (existingUrls.has(f.url)) continue; // de-dupe by source URL
    const record = {
      id: `finding_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "pending_review",
      fetchedAt: new Date().toISOString(),
      exportedAt: null,
      ...f,
    };
    findings.push(record);
    added.push(record);
  }
  writeJSON(FINDINGS_PATH, findings);
  return added;
}

function setFindingStatus(id, status) {
  const findings = getAllFindings();
  const finding = findings.find((f) => f.id === id);
  if (!finding) throw new Error(`No finding with id "${id}"`);
  finding.status = status;
  if (status === "approved_for_export") finding.exportedAt = new Date().toISOString();
  writeJSON(FINDINGS_PATH, findings);
  return finding;
}

module.exports = {
  getAllCompanies, getCompany, applyCompanyRefresh, approveCompany, rejectCompany,
  getAllFindings, addFindings, setFindingStatus,
};
