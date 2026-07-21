// digestService.js
//
// Builds a PDF digest of what's changed -- meant to be sent to a team, not
// just viewed on the dashboard. By default only includes APPROVED items
// (competitor updates that were approved, findings marked approved_for_export)
// since the last digest was generated. Callers can opt into also including
// currently-pending (not-yet-reviewed) items, clearly marked as such, for
// internal "here's everything in flight" use rather than external distribution.

const PDFDocument = require("pdfkit");

// Elnora AI's real brand palette, sampled from elnora.ai: a vivid purple
// accent (--ring CSS variable) plus near-black and white. We deliberately do
// NOT reproduce Elnora's actual wordmark/logo -- that's their trademark --
// but a text-based letterhead in a serif display face nods at their bold
// serif lettering without copying it, and the color palette is the real one.
const ELNORA_PURPLE = "#9959FF";
const ELNORA_INK = "#181521";   // near-black with a faint cool undertone, matching their wordmark
const MUTED = "#5B5866";        // neutral cool gray, replaces the old warm-brown tone
const PENDING_TAG = "#946B00";  // amber, kept distinct from the brand purple so "awaiting review" never reads as an approved/branded element

function formatDate(iso) {
  if (!iso) return "the beginning";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function sectionHeader(doc, text) {
  doc.moveDown(0.6);
  doc.fontSize(15).fillColor(ELNORA_PURPLE).font("Times-Bold").text(text);
  doc.moveDown(0.2);
  doc.strokeColor(ELNORA_PURPLE).opacity(0.3).lineWidth(1.5)
    .moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.opacity(1);
  doc.moveDown(0.4);
}

function pendingTag(doc) {
  doc.fontSize(8).fillColor(PENDING_TAG).font("Helvetica-Bold").text("AWAITING REVIEW \u2014 NOT YET APPROVED", { continued: false });
  doc.moveDown(0.15);
}

function buildDigest({ companies, findings, lastDigestAt, includePending }, res) {
  const doc = new PDFDocument({ margin: 54, size: "LETTER" });
  doc.pipe(res);

  // ---- Letterhead ----
  // Purple accent bar across the top, then a text-based letterhead using a
  // serif display face -- a tasteful nod to their bold serif wordmark
  // without reproducing the actual custom lettering.
  doc.rect(0, 0, doc.page.width, 8).fill(ELNORA_PURPLE);
  doc.moveDown(1.4);
  doc.fontSize(13).fillColor(ELNORA_PURPLE).font("Times-Bold")
    .text("elnora.", { characterSpacing: 0.3 });
  doc.fontSize(9).fillColor(MUTED).font("Helvetica")
    .text("Prepared for internal distribution \u2014 not an official Elnora AI publication");
  doc.moveDown(0.8);

  // ---- Cover ----
  doc.fontSize(22).fillColor(ELNORA_INK).font("Times-Bold").text("Intelligence Desk Digest", { align: "left" });
  doc.fontSize(13).fillColor(MUTED).font("Helvetica").text("Competitive & Negative-Data Summary");
  doc.moveDown(0.6);
  doc.fontSize(10).fillColor(MUTED).text(`Covering approved updates since ${formatDate(lastDigestAt)}`);
  doc.text(`Generated ${new Date().toLocaleString()}`);
  if (includePending) {
    doc.moveDown(0.3);
    doc.fillColor(PENDING_TAG).font("Helvetica-Bold")
      .text("Includes items still awaiting human review \u2014 not yet confirmed. Distribute internally only.");
  }
  doc.moveDown(1);

  // ---- Competitor updates ----
  const approvedCompanies = companies.filter((c) =>
    (c.history || []).some((h) => h.action === "approved" && (!lastDigestAt || h.at > lastDigestAt))
  );
  const pendingCompanies = includePending ? companies.filter((c) => c.pendingUpdate) : [];

  sectionHeader(doc, "Competitor Intel");
  if (approvedCompanies.length === 0 && pendingCompanies.length === 0) {
    doc.fontSize(10).fillColor(MUTED).font("Helvetica").text("No competitor updates in this period.");
  }
  for (const c of approvedCompanies) {
    doc.fontSize(12).fillColor(ELNORA_INK).font("Helvetica-Bold").text(c.name);
    doc.fontSize(10).fillColor(MUTED).font("Helvetica").text(c.baseline.summary);
    if (c.baseline.recentNews) {
      doc.fontSize(9).fillColor(MUTED).font("Helvetica-Oblique").text(`Recent: ${c.baseline.recentNews}`);
    }
    doc.moveDown(0.5);
  }
  for (const c of pendingCompanies) {
    pendingTag(doc);
    doc.fontSize(12).fillColor(ELNORA_INK).font("Helvetica-Bold").text(c.name);
    const pu = c.pendingUpdate;
    doc.fontSize(10).fillColor(MUTED).font("Helvetica").text(pu.summary);
    doc.fontSize(9).fillColor(MUTED).text(`${pu.changes.length} proposed change(s), fetched ${formatDate(pu.fetchedAt)}`);
    doc.moveDown(0.5);
  }

  // ---- Negative-data findings ----
  const approvedFindings = findings.filter((f) =>
    f.status === "approved_for_export" && (!lastDigestAt || f.exportedAt > lastDigestAt)
  );
  const pendingFindings = includePending ? findings.filter((f) => f.status === "pending_review") : [];

  sectionHeader(doc, "Negative-Data Findings");
  if (approvedFindings.length === 0 && pendingFindings.length === 0) {
    doc.fontSize(10).fillColor(MUTED).font("Helvetica").text("No approved negative-data findings in this period.");
  }
  for (const f of approvedFindings) {
    renderFinding(doc, f);
  }
  for (const f of pendingFindings) {
    pendingTag(doc);
    renderFinding(doc, f);
  }

  doc.end();
}

function renderFinding(doc, f) {
  doc.fontSize(12).fillColor(ELNORA_INK).font("Helvetica-Bold").text(f.title);
  doc.fontSize(9).fillColor(MUTED).font("Helvetica-Oblique").text(`${f.source}${f.publishedDate ? " \u00b7 " + f.publishedDate : ""}`);
  doc.moveDown(0.15);
  const rows = [
    ["Target/mechanism", f.target],
    ["What happened", f.outcomeSummary],
    ["Why it failed", f.whyItFailed],
    ["Reuse angle", f.reuseAngle],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    doc.fontSize(9).fillColor(ELNORA_PURPLE).font("Helvetica-Bold").text(`${label}: `, { continued: true });
    doc.fillColor(MUTED).font("Helvetica").text(value);
  }
  doc.moveDown(0.5);
}

module.exports = { buildDigest };
