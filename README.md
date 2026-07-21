# The Intelligence Desk — Elnora AI

A two-part dashboard built as a portfolio piece exploring Elnora AI's competitive landscape and its own
core thesis: negative/failed experimental results get buried in the literature and should be reused.

## The two modules

**Competitor Intel** — tracks three AI-copilot-for-biomedical-R&D companies (Labguru Assistant, R-COP by
ThinkBio.Ai, and Benchling) via Claude with web search. Unlike a prior project on public biotech companies,
all three of these are private, so there's no free structured-data alternative here — every refresh runs
through the paid Claude API. Refreshes land as a "pending update" with a diff against the current baseline;
nothing publishes without a human clicking Approve.

**Negative-Data Darkroom** — searches Europe PMC (free, no key, covers both bioRxiv preprints and PubMed)
for recent papers whose language suggests a negative or null result in Elnora's focus areas (antiviral,
host-targeting drug discovery), then uses Claude to read each abstract, confirm it's a genuine negative
finding (not just background context), and extract structured fields: target, method, hypothesis, outcome,
why it failed, and a "reuse angle." Only the classification step costs anything — the literature search
itself is free.

## Why findings visually "develop"

Each finding card renders first in an inverted, high-contrast state and settles into its normal readable
form a moment after loading — a literal photographic-negative effect. It's not just decoration: it
dramatizes the product's actual pitch, that there's real information sitting in what looks discarded or
illegible until you know how to read it.

## "Integrate into pipeline" — what's actually built vs. what would need to exist

Approving a finding marks it `approved_for_export` and, if `ELNORA_WEBHOOK_URL` is set in `.env`, makes a
**real** HTTP POST of that finding's structured JSON to that URL. Until a real endpoint exists to receive
it, this correctly reports "no webhook configured" rather than pretending to have sent something. Every
finding also has a "View export JSON" link regardless, for manual copy/paste into whatever system exists.
This is a ready integration point, not a live connection into Elnora's actual internal systems — being
upfront about that distinction is more credible than implying otherwise.

## Setup

```bash
cd server
npm install
cp .env.example .env
# add your ANTHROPIC_API_KEY
npm start
```
Then open `client/index.html` in a browser. Default backend address: `http://localhost:4001/api` (edit
`window.ELNORA_API_BASE` in `client/index.html` to point elsewhere).

## Deployment

Same pattern as a prior Cytokinetics project: GitHub → Render (backend) → Netlify (frontend). Key
differences to remember:
- **Every refresh/scan here costs money** (no free-data-source split), so setting `DASHBOARD_ACCESS_CODE`
  before hosting this publicly matters more here than it did there.
- Watch for the same CORS gotchas: exact-string origin matching, no trailing slash, and confirm Render
  auto-deploy actually fires (check the Events tab, use Manual Deploy if not).

## What would need to change for real production use
- A real database instead of two JSON files
- Real authentication instead of a shared access code
- Rate limiting on the scan/refresh endpoints (each Europe PMC scan can trigger many Claude calls)
- A human-in-the-loop check on classification accuracy before fully trusting "isNegativeResult" at scale
- An actual, agreed-upon webhook contract with Elnora's own systems, not just a stub endpoint
