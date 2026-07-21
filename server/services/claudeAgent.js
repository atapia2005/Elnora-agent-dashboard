// claudeAgent.js
//
// Refreshes a single competitor's data using Claude with web search. All
// three tracked companies are private/small, so unlike the Cytokinetics
// project there's no free structured-data alternative -- every refresh here
// costs a small amount, which is why the frontend gates it behind an access
// code once deployed publicly (same pattern as before, just applied to all
// companies here instead of a subset).

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function buildPrompt(company) {
  const baseline = company.baseline;
  return `You are researching the company "${company.name}" (product: ${company.product}) for a \
competitive-intelligence dashboard built for Elnora AI, a startup building an AI agent that learns from \
successful AND failed biomedical experiments to design better lab protocols, with an in-house antiviral \
drug discovery arm.

Use web search to find the most current, factual information about:
1. How this company's product/positioning has changed or been described recently
2. Any new features, partnerships, funding, or customer wins
3. Anything relevant to how they compare with an AI agent focused on learning from negative/failed \
   experimental data specifically (most competitors do NOT focus on this -- note if that's still true)

Here is the current baseline record on file:
${JSON.stringify(baseline, null, 2)}

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:

{
  "summary": string (2-3 sentences),
  "keyFeatures": [string, ...],
  "recentNews": string (1-2 sentences, or restate baseline if nothing new found),
  "fundingKnown": string or null (e.g. "$12M Series A, March 2026" -- only if you actually found a real disclosed figure),
  "sources": [ [string title, string url], ... ]
}

If you cannot find anything more current than the baseline for a field, repeat the baseline's value rather \
than guessing. Do not fabricate a funding figure or a source URL.`;
}

function extractJson(text) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

async function refreshCompany(company) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: buildPrompt(company) }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 400)}`);
  }

  const data = await response.json();
  const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
  if (textBlocks.length === 0) throw new Error("Claude returned no text content to parse.");

  const finalText = textBlocks[textBlocks.length - 1];
  let parsed;
  try {
    parsed = extractJson(finalText);
  } catch (err) {
    throw new Error(`Could not parse Claude's response as JSON: ${err.message}`);
  }

  if (!parsed.summary || !Array.isArray(parsed.keyFeatures)) {
    throw new Error("Claude's response was missing required fields.");
  }
  return parsed;
}

module.exports = { refreshCompany };
