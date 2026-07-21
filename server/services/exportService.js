// exportService.js
//
// Handles turning an approved finding into something Elnora could actually
// plug into their own pipeline. Two paths:
//   1. Clean JSON export (always available -- just returns the structured record)
//   2. Webhook forward (only if ELNORA_WEBHOOK_URL is configured) -- a REAL
//      HTTP POST to whatever URL is set, so this becomes a genuine
//      integration point the moment a real endpoint exists, not just a
//      mockup. Until then, it clearly reports that no URL is configured.

function toExportPayload(finding) {
  return {
    finding_id: finding.id,
    title: finding.title,
    authors: finding.authors,
    source: finding.source,
    url: finding.url,
    published_date: finding.publishedDate,
    target: finding.target,
    method: finding.method,
    hypothesis: finding.hypothesis,
    outcome_summary: finding.outcomeSummary,
    why_it_failed: finding.whyItFailed,
    reuse_angle: finding.reuseAngle,
    approved_at: finding.exportedAt,
  };
}

async function forwardToWebhook(finding) {
  const url = process.env.ELNORA_WEBHOOK_URL;
  const payload = toExportPayload(finding);

  if (!url) {
    return { sent: false, reason: "No ELNORA_WEBHOOK_URL configured.", payload };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { sent: res.ok, status: res.status, payload };
  } catch (err) {
    return { sent: false, reason: err.message, payload };
  }
}

module.exports = { toExportPayload, forwardToWebhook };
