#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { parseArgs } from "util";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function importEngine(name) {
  const fullPath = join(__dirname, "engines", `${name}.mjs`);
  return import(pathToFileURL(fullPath).href);
}

const ALL_ENGINE_NAMES = ["perplexity", "chatgpt", "gemini", "kimi", "youcom"];

const { values: args } = parseArgs({
  options: {
    domain: { type: "string" },
    keywords: { type: "string" },
    engines: { type: "string" },
    baseline: { type: "string" },
    output: { type: "string" },
    competitors: { type: "string" },
    list: { type: "boolean", default: false },
  },
});

if (args.list) {
  console.log("Available AI search engines:\n");
  for (const name of ALL_ENGINE_NAMES) {
    const engine = await importEngine(name);
    const status = engine.isAvailable() ? "ready" : `needs ${engine.envKey}`;
    console.log(`  ${name.padEnd(12)} ${status.padEnd(30)} ${engine.setupUrl}`);
  }
  console.log(`
Additional flags:
  --competitors <c1.com,c2.com>   Check if competitor domains are cited alongside your domain
`);
  process.exit(0);
}

if (!args.domain || !args.keywords) {
  console.error(
    `Usage: node check-ai-citation.mjs --domain <domain> --keywords <kw1,kw2,...> [options]

Options:
  --engines <names>          Comma-separated engine list (default: all available)
                             Available: ${ALL_ENGINE_NAMES.join(", ")}
  --baseline <path>          Previous result JSON for comparison
  --output <path>            Write results to file (default: stdout)
  --competitors <domains>    Comma-separated competitor domains to track
  --list                     Show available engines and their status`
  );
  process.exit(1);
}

const domain = args.domain.toLowerCase().replace(/^https?:\/\//, "");
const keywords = args.keywords.split(",").map((k) => k.trim()).filter(Boolean);

const competitorDomains = args.competitors
  ? args.competitors.split(",").map((c) => c.trim().toLowerCase().replace(/^https?:\/\//, "")).filter(Boolean)
  : [];

const requestedEngines = args.engines
  ? args.engines.split(",").map((e) => e.trim().toLowerCase())
  : ALL_ENGINE_NAMES;

const engines = [];
const unavailable = [];

for (const name of requestedEngines) {
  if (!ALL_ENGINE_NAMES.includes(name)) {
    console.error(`Unknown engine: ${name}. Available: ${ALL_ENGINE_NAMES.join(", ")}`);
    process.exit(1);
  }
  const engine = await importEngine(name);
  if (engine.isAvailable()) {
    engines.push(engine);
  } else {
    unavailable.push({ name, envKey: engine.envKey, setupUrl: engine.setupUrl });
  }
}

if (unavailable.length > 0) {
  process.stderr.write("\nEngines not configured (skipped):\n");
  for (const e of unavailable) {
    process.stderr.write(`  ${e.name}: set ${e.envKey} — ${e.setupUrl}\n`);
  }
  process.stderr.write("\n");
}

// ---------------------------------------------------------------------------
// Sentiment analysis
// ---------------------------------------------------------------------------

const POSITIVE_WORDS = [
  "best", "great", "powerful", "excellent", "recommend", "popular",
  "leading", "innovative", "好用", "推荐", "优秀", "强大",
];

const NEGATIVE_WORDS = [
  "poor", "bad", "issue", "problem", "avoid", "scam",
  "差", "不好", "骗", "问题",
];

/**
 * Extract a window of text around the first occurrence of the domain/brand.
 * Returns a ~300-character excerpt centred on the match, lower-cased.
 */
function extractWindow(content, domain) {
  const lower = content.toLowerCase();
  // Try the full domain, then just the brand part (before the first dot)
  const brand = domain.split(".")[0];
  const idx = lower.indexOf(domain) !== -1 ? lower.indexOf(domain) : lower.indexOf(brand);
  if (idx === -1) return null;

  const start = Math.max(0, idx - 150);
  const end = Math.min(lower.length, idx + 150);
  return lower.slice(start, end);
}

/**
 * Analyse the AI response content for sentiment toward the given domain.
 * @param {string|null} content  - The snippet / full response text
 * @param {string}      domain   - Normalised domain (no protocol)
 * @returns {{ label: "positive"|"neutral"|"negative"|null, reason: string|null }}
 */
export function analyzeSentiment(content, domain) {
  if (!content || typeof content !== "string") {
    return { label: null, reason: null };
  }

  const window = extractWindow(content, domain);
  if (window === null) {
    return { label: null, reason: null };
  }

  // Check positive words first
  for (const word of POSITIVE_WORDS) {
    if (window.includes(word.toLowerCase())) {
      return {
        label: "positive",
        reason: `Detected positive indicator "${word}" near domain mention`,
      };
    }
  }

  // Check negative words
  for (const word of NEGATIVE_WORDS) {
    if (window.includes(word.toLowerCase())) {
      return {
        label: "negative",
        reason: `Detected negative indicator "${word}" near domain mention`,
      };
    }
  }

  // Domain mentioned but no strong sentiment words
  return {
    label: "neutral",
    reason: "Domain mentioned without strong positive or negative indicators",
  };
}

// ---------------------------------------------------------------------------
// Competitor check (reuses data already returned by engine.query)
// ---------------------------------------------------------------------------

/**
 * Check whether a competitor domain appears in the citation URLs or snippet
 * returned by a single engine result.
 * @param {{ cited: boolean, urls: string[], snippet: string|null }} engineResult
 * @param {string} competitorDomain
 * @returns {{ cited: boolean, urls: string[] }}
 */
function checkCompetitor(engineResult, competitorDomain) {
  const urls = (engineResult.urls || []).filter(
    (u) => typeof u === "string" && u.toLowerCase().includes(competitorDomain)
  );
  const citedInSnippet =
    engineResult.snippet &&
    typeof engineResult.snippet === "string" &&
    engineResult.snippet.toLowerCase().includes(competitorDomain);

  return {
    cited: urls.length > 0 || !!citedInSnippet,
    urls,
  };
}

// ---------------------------------------------------------------------------
// No-engines path: template baseline
// ---------------------------------------------------------------------------

if (engines.length === 0) {
  process.stderr.write("No engines available. Generating template baseline.\n\n");

  const result = {
    domain,
    checkedAt: new Date().toISOString(),
    engines: requestedEngines,
    keywords: keywords.map((kw) => ({
      keyword: kw,
      results: Object.fromEntries(requestedEngines.map((e) => [e, { cited: null, urls: null, snippet: null }])),
    })),
    summary: {
      totalKeywords: keywords.length,
      perEngine: Object.fromEntries(requestedEngines.map((e) => [e, { citedCount: null, citationRate: null }])),
      overallCitationRate: null,
    },
    diff: null,
  };

  outputResult(result);
  process.exit(0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let baseline = null;
  if (args.baseline) {
    try {
      baseline = JSON.parse(readFileSync(args.baseline, "utf8"));
    } catch (err) {
      console.error(`Failed to load baseline: ${err.message}`);
      process.exit(1);
    }
  }

  const engineNames = engines.map((e) => e.name);
  process.stderr.write(`Engines: ${engineNames.join(", ")}\n`);
  process.stderr.write(`Keywords: ${keywords.length}\n`);
  if (competitorDomains.length > 0) {
    process.stderr.write(`Competitors: ${competitorDomains.join(", ")}\n`);
  }
  process.stderr.write("\n");

  const keywordResults = [];

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const results = {};

    for (let j = 0; j < engines.length; j++) {
      const engine = engines[j];

      if (i > 0 || j > 0) await sleep(2000);

      process.stderr.write(`[${i + 1}/${keywords.length}] ${engine.name}: "${kw}" ... `);

      try {
        const engineResult = await engine.query(kw, domain);

        // Attach sentiment when domain is cited
        if (engineResult.cited || engineResult.snippet) {
          const sentiment = analyzeSentiment(engineResult.snippet || "", domain);
          if (sentiment.label !== null) {
            engineResult.sentiment = sentiment;
          }
        }

        results[engine.name] = engineResult;
        process.stderr.write(engineResult.cited ? "CITED\n" : "not cited\n");
      } catch (err) {
        results[engine.name] = { cited: false, urls: [], snippet: null, error: err.message };
        process.stderr.write(`ERROR: ${err.message}\n`);
      }
    }

    const kwEntry = { keyword: kw, results };

    // Competitor analysis (no extra API calls — reuse engine results)
    if (competitorDomains.length > 0) {
      const competitors = {};
      for (const comp of competitorDomains) {
        const compEngineResults = {};
        for (const engine of engines) {
          const engineResult = results[engine.name];
          compEngineResults[engine.name] = checkCompetitor(engineResult, comp);
        }
        competitors[comp] = compEngineResults;
      }
      kwEntry.competitors = competitors;
    }

    keywordResults.push(kwEntry);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const perEngine = {};
  for (const engine of engines) {
    const cited = keywordResults.filter((k) => k.results[engine.name]?.cited === true).length;
    perEngine[engine.name] = {
      citedCount: cited,
      citationRate: keywords.length > 0 ? Math.round((cited / keywords.length) * 100) / 100 : 0,
    };
  }

  const totalCited = keywordResults.filter((k) =>
    Object.values(k.results).some((r) => r.cited === true)
  ).length;

  // Sentiment breakdown (across all keyword+engine pairs that have a sentiment)
  const sentimentBreakdown = { positive: 0, neutral: 0, negative: 0 };
  let hasSentiment = false;
  for (const kwEntry of keywordResults) {
    for (const engineResult of Object.values(kwEntry.results)) {
      if (engineResult.sentiment?.label) {
        hasSentiment = true;
        sentimentBreakdown[engineResult.sentiment.label] =
          (sentimentBreakdown[engineResult.sentiment.label] || 0) + 1;
      }
    }
  }

  // Competitor citation rates
  let competitorComparison;
  if (competitorDomains.length > 0) {
    competitorComparison = {};
    for (const comp of competitorDomains) {
      let compCitedKeywords = 0;
      for (const kwEntry of keywordResults) {
        const citedInAnyEngine = Object.values(kwEntry.competitors?.[comp] || {}).some(
          (r) => r.cited === true
        );
        if (citedInAnyEngine) compCitedKeywords++;
      }
      competitorComparison[comp] = {
        citationRate:
          keywords.length > 0
            ? Math.round((compCitedKeywords / keywords.length) * 100) / 100
            : 0,
      };
    }
  }

  const diff = baseline ? computeDiff(baseline, keywordResults, engineNames) : null;

  if (diff) {
    process.stderr.write("\n--- Diff vs baseline ---\n");
    for (const [engine, changes] of Object.entries(diff)) {
      if (changes.gained.length || changes.lost.length) {
        process.stderr.write(`  ${engine}:\n`);
        if (changes.gained.length) process.stderr.write(`    + gained: ${changes.gained.join(", ")}\n`);
        if (changes.lost.length) process.stderr.write(`    - lost: ${changes.lost.join(", ")}\n`);
      }
    }
  }

  const summary = {
    totalKeywords: keywords.length,
    perEngine,
    overallCitationRate:
      keywords.length > 0 ? Math.round((totalCited / keywords.length) * 100) / 100 : 0,
  };

  if (hasSentiment) {
    summary.sentimentBreakdown = sentimentBreakdown;
  }

  if (competitorComparison) {
    summary.competitorComparison = competitorComparison;
  }

  const output = {
    domain,
    checkedAt: new Date().toISOString(),
    engines: engineNames,
    keywords: keywordResults,
    summary,
    diff,
  };

  outputResult(output);
}

function computeDiff(baseline, current, engineNames) {
  const diff = {};

  for (const engineName of engineNames) {
    const gained = [];
    const lost = [];
    const unchanged = [];

    for (const curr of current) {
      const kw = curr.keyword;
      const prev = baseline.keywords?.find((k) => k.keyword === kw);
      const prevCited = prev?.results?.[engineName]?.cited ?? prev?.perplexity?.cited ?? false;
      const currCited = curr.results[engineName]?.cited ?? false;

      if (!prevCited && currCited) gained.push(kw);
      else if (prevCited && !currCited) lost.push(kw);
      else unchanged.push(kw);
    }

    diff[engineName] = { gained, lost, unchanged };
  }

  return diff;
}

function outputResult(result) {
  const json = JSON.stringify(result, null, 2);
  if (args.output) {
    writeFileSync(args.output, json, "utf8");
    process.stderr.write(`\nResults written to ${args.output}\n`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
