// negativeDataAgent.js
//
// Two-stage pipeline for the negative-data signal feed:
//   1. FREE: search Europe PMC (covers both bioRxiv preprints and PubMed --
//      no API key required) for recent papers whose language suggests a
//      negative or null result in Elnora's focus areas.
//   2. PAID (Claude, no web search needed -- we already have the abstract):
//      classify whether each candidate genuinely reports negative/null data
//      relevant to Elnora, and extract structured fields. This is the only
//      part of this module that costs anything.
//
// This mirrors Elnora's own founding thesis: negative results get buried in
// the literature and never reused. The product surfaces them instead.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const EUROPEPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

const NEGATIVE_LANGUAGE_TERMS = [
  "negative", "null", "ineffective", "failed",
  '"did not show"', '"no significant difference"', '"lack of efficacy"',
];

function buildEuropePmcQuery() {
  const focusTerms = (process.env.FOCUS_TERMS || "antiviral,host-targeting")
    .split(",").map((t) => t.trim()).filter(Boolean)
    .map((t) => (t.includes(" ") ? `"${t}"` : t)); // only quote genuine multi-word phrases
  const focusClause = `(${focusTerms.join(" OR ")})`;
  const negativeClause = `(${NEGATIVE_LANGUAGE_TERMS.join(" OR ")})`;
  // Deliberately loose: single-word OR-groups on both sides, only quoting true
  // multi-word phrases. Requiring exact multi-word phrases on BOTH sides
  // (an earlier version of this query) returned zero hits in practice --
  // the intersection was too small. Loosen further via FOCUS_TERMS in .env
  // if this still under- or over-matches for your use case.
  return `${focusClause} AND ${negativeClause}`;
}

async function fetchCandidatePapers(limit = 15) {
  const query = buildEuropePmcQuery();
  const params = new URLSearchParams({
    query,
    format: "json",
    pageSize: String(limit),
    resultType: "core", // required to get abstractText back at all -- the
                        // default "lite" result type omits it entirely,
                        // which was silently filtering out every result
    // No `sort` param: Europe PMC's default relevance sort is reliable;
    // an earlier version specified a sort field that wasn't confirmed valid
    // and may have silently caused zero results instead of erroring.
  });
  const url = `${EUROPEPMC_BASE}?${params.toString()}`;
  console.log(`[negativeDataAgent] Europe PMC query: ${query}`);
  console.log(`[negativeDataAgent] Full request URL: ${url}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Europe PMC search failed: ${res.status}`);
  const data = await res.json();
  const hitCount = data.hitCount ?? 0;
  const results = data.resultList?.result || [];
  console.log(`[negativeDataAgent] Europe PMC reported hitCount=${hitCount}, returned ${results.length} result(s)`);

  const rawResults = results.length;
  const missingUrl = results.filter((r) => !(r.doi || r.fullTextUrlList?.fullTextUrl?.[0]?.url)).length;
  const missingAbstract = results.filter((r) => !r.abstractText).length;

  const papers = results.map((r) => ({
    title: r.title,
    authors: r.authorString || null,
    source: r.source === "PPR" ? "Preprint (bioRxiv/medRxiv, via Europe PMC)" : "PubMed (via Europe PMC)",
    url: r.doi ? `https://doi.org/${r.doi}` : (r.fullTextUrlList?.fullTextUrl?.[0]?.url || null),
    publishedDate: r.firstPublicationDate || r.pubYear || null,
    abstractText: r.abstractText || null,
  })).filter((p) => p.url && p.abstractText); // need both to classify meaningfully

  console.log(`[negativeDataAgent] Raw results: ${rawResults}, missing URL: ${missingUrl}, ` +
              `missing abstract: ${missingAbstract}, usable after filtering: ${papers.length}`);

  papers.hitCount = hitCount; // attach for callers that want the raw pre-filter count
  papers.queryUsed = query;
  return papers;
}

function extractJson(text) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

async function classifyPaper(paper) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const prompt = `You are screening scientific papers for a negative-data signal feed built for Elnora AI, \
a company whose thesis is that failed/negative experimental results get buried and should be reused to \
improve future experimental design -- particularly in antiviral and host-targeting drug discovery.

Paper title: ${paper.title}
Abstract: ${paper.abstractText}

Decide: does this abstract genuinely report a negative, null, or failed result (not just mention negative \
results as background/motivation)? If yes, extract structured fields. If no, say so.

Respond with ONLY a JSON object, no markdown fences, no commentary, in exactly this shape:
{
  "isNegativeResult": boolean,
  "target": string or null (the drug target, pathway, or mechanism studied),
  "method": string or null (brief description of the experimental approach),
  "hypothesis": string or null (what the researchers expected to find),
  "outcomeSummary": string or null (what actually happened, in plain language),
  "whyItFailed": string or null (the stated or inferable reason for the negative outcome),
  "reuseAngle": string or null (one sentence: how could this be useful to someone else's future experimental design)
}
If isNegativeResult is false, the other fields can be null.`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-5",
      max_tokens: 1024, // was 700 -- too tight for some longer abstracts, causing
                        // truncated (invalid) JSON or empty responses on a few papers
      messages: [{ role: "user", content: prompt }],
      // No web_search tool here -- we already have the abstract text, so this
      // is a pure reasoning/extraction call, cheaper and faster than the
      // competitor-refresh calls that need live search.
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 300)}`);
  }
  const data = await response.json();
  if (data.stop_reason === "max_tokens") {
    console.warn(`[negativeDataAgent] Classification for "${paper.title}" hit max_tokens -- response may be truncated.`);
  }
  const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
  if (textBlocks.length === 0) {
    throw new Error(`Claude returned no text content (stop_reason: ${data.stop_reason || "unknown"}).`);
  }

  const finalText = textBlocks[textBlocks.length - 1];
  try {
    return extractJson(finalText);
  } catch (err) {
    throw new Error(`Could not parse Claude's response as JSON (${err.message}). Raw: ${finalText.slice(0, 200)}`);
  }
}

async function scanForNegativeData(limit = 15) {
  const candidates = await fetchCandidatePapers(limit);
  const findings = [];
  const skipped = [];

  for (const paper of candidates) {
    try {
      const classification = await classifyPaper(paper);
      if (classification.isNegativeResult) {
        findings.push({
          title: paper.title,
          authors: paper.authors,
          source: paper.source,
          url: paper.url,
          publishedDate: paper.publishedDate,
          target: classification.target,
          method: classification.method,
          hypothesis: classification.hypothesis,
          outcomeSummary: classification.outcomeSummary,
          whyItFailed: classification.whyItFailed,
          reuseAngle: classification.reuseAngle,
        });
      } else {
        skipped.push(paper.title);
      }
    } catch (err) {
      skipped.push(`${paper.title} (classification error: ${err.message})`);
    }
  }

  return {
    candidatesScanned: candidates.length,
    hitCount: candidates.hitCount,
    queryUsed: candidates.queryUsed,
    findings,
    skipped,
  };
}

module.exports = { fetchCandidatePapers, classifyPaper, scanForNegativeData };
