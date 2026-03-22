#!/usr/bin/env node
/**
 * share-of-voice.mjs
 *
 * Calculates "AI Share of Voice" — what percentage of AI search engine
 * citations for your category keywords mention YOUR brand vs competitors.
 *
 * Usage:
 *   node scripts/share-of-voice.mjs \
 *     --domain getsubtextai.com \
 *     --competitors "textbehind.com,crystalknows.com" \
 *     --keywords "conversation analysis tool,subtext decoder,chat analyzer" \
 *     [--engines perplexity,chatgpt] \
 *     [--output sov.json]
 */

import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Arg parsing (manual — zero extra deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

const args = parseArgs(process.argv);

const ALL_ENGINE_NAMES = ["perplexity", "chatgpt", "gemini", "kimi", "youcom"];

if (!args.domain || !args.keywords) {
  process.stderr.write(
    `Usage: node share-of-voice.mjs --domain <domain> --keywords <kw1,kw2,...> [options]

Options:
  --competitors <domains>    Comma-separated competitor domains to track
  --engines <names>          Comma-separated engine list (default: all available)
                             Available: ${ALL_ENGINE_NAMES.join(", ")}
  --output <path>            Write JSON to file (default: stdout)

Human-readable progress is written to stderr; JSON result to stdout (or --output file).
`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Engine loading
// ---------------------------------------------------------------------------

function importEngine(name) {
  const fullPath = join(__dirname, "engines", `${name}.mjs`);
  return import(pathToFileURL(fullPath).href);
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

function normalizeDomain(d) {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function matchDomain(url, domain) {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const target = domain.replace(/^www\./, "");
    return hostname === target || hostname.endsWith("." + target);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Normalise inputs
// ---------------------------------------------------------------------------

const myDomain = normalizeDomain(args.domain);

const competitorDomains = args.competitors
  ? args.competitors
      .split(",")
      .map(normalizeDomain)
      .filter(Boolean)
  : [];

const allTrackedDomains = [myDomain, ...competitorDomains];

const keywords = args.keywords
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const requestedEngineNames = args.engines
  ? args.engines.split(",").map((e) => e.trim().toLowerCase())
  : ALL_ENGINE_NAMES;

// ---------------------------------------------------------------------------
// Validate & load engines
// ---------------------------------------------------------------------------

for (const name of requestedEngineNames) {
  if (!ALL_ENGINE_NAMES.includes(name)) {
    process.stderr.write(
      `Unknown engine: ${name}. Available: ${ALL_ENGINE_NAMES.join(", ")}\n`
    );
    process.exit(1);
  }
}

const engines = [];
const unavailable = [];

for (const name of requestedEngineNames) {
  try {
    const engine = await importEngine(name);
    if (engine.isAvailable()) {
      engines.push(engine);
    } else {
      unavailable.push({ name, envKey: engine.envKey, setupUrl: engine.setupUrl });
    }
  } catch (err) {
    process.stderr.write(`Warning: failed to load engine "${name}": ${err.message}\n`);
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
// No-engines path: template with null values
// ---------------------------------------------------------------------------

function outputResult(result) {
  const json = JSON.stringify(result, null, 2);
  if (args.output) {
    writeFileSync(args.output, json, "utf8");
    process.stderr.write(`\nResults written to ${args.output}\n`);
  } else {
    process.stdout.write(json + "\n");
  }
}

if (engines.length === 0) {
  process.stderr.write(
    "No engines available. Generating template with null values.\n\n" +
    "Set at least one API key to enable queries:\n" +
    unavailable.map((e) => `  ${e.name}: ${e.envKey} — ${e.setupUrl}`).join("\n") +
    "\n"
  );

  const nullCitations = Object.fromEntries(
    allTrackedDomains.map((d) => [d, { count: null, engines: null }])
  );
  nullCitations._other = { count: null };

  const result = {
    domain: myDomain,
    competitors: competitorDomains,
    checkedAt: new Date().toISOString(),
    engines: requestedEngineNames,
    keywords: keywords.map((kw) => ({
      keyword: kw,
      citations: nullCitations,
      shareOfVoice: null,
    })),
    overall: {
      shareOfVoice: null,
      totalCitations: null,
      yourCitations: null,
      topCompetitor: null,
    },
    topActions: ["Configure at least one engine API key to run a real analysis."],
  };

  outputResult(result);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Query an engine for a keyword and return the URLs that match the given domain.
 * Each engine's query(keyword, domain) returns { cited, urls, snippet } where
 * `urls` contains only URLs matching `domain`. We call once per tracked domain
 * to collect citation URLs for every domain we care about.
 *
 * Returns { urls: string[], cited: boolean, error?: string }
 */
async function queryEngine(engine, keyword, domain) {
  try {
    const result = await engine.query(keyword, domain);
    return { urls: result.urls || [], cited: result.cited === true };
  } catch (err) {
    return { urls: [], cited: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const engineNames = engines.map((e) => e.name);

  process.stderr.write(`Domain:      ${myDomain}\n`);
  process.stderr.write(`Competitors: ${competitorDomains.length > 0 ? competitorDomains.join(", ") : "(none)"}\n`);
  process.stderr.write(`Keywords:    ${keywords.length}\n`);
  process.stderr.write(`Engines:     ${engineNames.join(", ")}\n`);
  process.stderr.write(
    `Queries:     ${keywords.length} keywords × ${engines.length} engines × ${allTrackedDomains.length} domains = ` +
    `${keywords.length * engines.length * allTrackedDomains.length} API calls\n`
  );
  process.stderr.write("\n");

  // Results structure:
  // rawData[kwIndex][engineName][domain] = { urls: string[], cited: boolean, error?: string }
  const rawData = [];

  let queryCount = 0;
  const totalQueries = keywords.length * engines.length * allTrackedDomains.length;

  for (let ki = 0; ki < keywords.length; ki++) {
    const kw = keywords[ki];
    const kwData = {};

    for (let ei = 0; ei < engines.length; ei++) {
      const engine = engines[ei];
      kwData[engine.name] = {};

      for (let di = 0; di < allTrackedDomains.length; di++) {
        const domain = allTrackedDomains[di];

        // Rate-limit: 2-second sleep between queries (skip before very first)
        if (queryCount > 0) await sleep(2000);
        queryCount++;

        process.stderr.write(
          `[${queryCount}/${totalQueries}] ${engine.name} | "${kw}" | ${domain} ... `
        );

        const result = await queryEngine(engine, kw, domain);

        if (result.error) {
          process.stderr.write(`ERROR: ${result.error}\n`);
        } else {
          process.stderr.write(result.cited ? `cited (${result.urls.length} url(s))\n` : "not cited\n");
        }

        kwData[engine.name][domain] = result;
      }
    }

    rawData.push(kwData);
  }

  // ---------------------------------------------------------------------------
  // Aggregate per keyword
  // ---------------------------------------------------------------------------

  /**
   * For each keyword, collapse rawData across all engines.
   * We estimate `_other` as 0 since we can only count what we queried for.
   * NOTE: Because each engine only returns URLs for the queried domain,
   * we cannot reliably count citations for domains we did not query.
   * `_other` is therefore not computed and omitted from the output,
   * which is the honest representation of what the data supports.
   *
   * ShareOfVoice is calculated as:
   *   domain_citations / sum(all_tracked_domain_citations)
   * This is the relative SoV among tracked brands only.
   */

  const keywordResults = keywords.map((kw, ki) => {
    const kwData = rawData[ki];

    // citations[domain] = { count: number, engines: string[] }
    const citations = {};
    let otherCount = 0; // We cannot compute this without all-citation access

    for (const domain of allTrackedDomains) {
      let count = 0;
      const citedByEngines = [];

      for (const engine of engines) {
        const r = kwData[engine.name][domain];
        if (r && r.cited) {
          count += 1;  // One citation event per (keyword, engine, domain) query
          citedByEngines.push(engine.name);
        }
      }

      citations[domain] = { count, engines: citedByEngines };
    }

    // _other is unknown; represent as null to be honest
    citations._other = { count: null, note: "unknown — engines only return citations for queried domain" };

    // SoV among tracked domains only
    const trackedTotal = allTrackedDomains.reduce((s, d) => s + (citations[d]?.count || 0), 0);

    let shareOfVoice = null;
    if (trackedTotal > 0) {
      shareOfVoice = {};
      for (const domain of allTrackedDomains) {
        const c = citations[domain]?.count || 0;
        shareOfVoice[domain] = Math.round((c / trackedTotal) * 1000) / 1000;
      }
    }

    return { keyword: kw, citations, shareOfVoice };
  });

  // ---------------------------------------------------------------------------
  // Overall aggregation
  // ---------------------------------------------------------------------------

  let totalTrackedCitations = 0;
  let yourTotalCitations = 0;
  const domainTotals = Object.fromEntries(allTrackedDomains.map((d) => [d, 0]));

  for (const kwResult of keywordResults) {
    for (const domain of allTrackedDomains) {
      const c = kwResult.citations[domain]?.count || 0;
      domainTotals[domain] += c;
      totalTrackedCitations += c;
    }
    yourTotalCitations += kwResult.citations[myDomain]?.count || 0;
  }

  let overallShareOfVoice = null;
  if (totalTrackedCitations > 0) {
    overallShareOfVoice = {};
    for (const domain of allTrackedDomains) {
      overallShareOfVoice[domain] =
        Math.round((domainTotals[domain] / totalTrackedCitations) * 1000) / 1000;
    }
  }

  // Top competitor by citation count
  let topCompetitor = null;
  if (competitorDomains.length > 0) {
    topCompetitor = competitorDomains.reduce((best, d) =>
      (domainTotals[d] || 0) > (domainTotals[best] || 0) ? d : best
    );
  }

  // ---------------------------------------------------------------------------
  // Top action items
  // ---------------------------------------------------------------------------

  const topActions = [];

  // Keywords where user has zero citations
  const zeroCitationKws = keywordResults.filter(
    (kr) => (kr.citations[myDomain]?.count || 0) === 0
  );
  if (zeroCitationKws.length > 0) {
    for (const kr of zeroCitationKws) {
      topActions.push(
        `You have 0 citations for "${kr.keyword}" — high priority content gap`
      );
    }
  }

  // Keywords dominated by a competitor (competitor SoV > 2× yours)
  for (const kr of keywordResults) {
    if (!kr.shareOfVoice) continue;
    const yourSov = kr.shareOfVoice[myDomain] || 0;
    for (const comp of competitorDomains) {
      const compSov = kr.shareOfVoice[comp] || 0;
      if (compSov > 0 && (yourSov === 0 || compSov >= yourSov * 2)) {
        topActions.push(
          `${comp} dominates "${kr.keyword}" (SoV ${Math.round(compSov * 100)}% vs your ${Math.round(yourSov * 100)}%) — consider creating targeted content`
        );
      }
    }
  }

  // Generic encouragement if nothing flagged
  if (topActions.length === 0 && yourTotalCitations > 0) {
    topActions.push(
      `Good visibility across tracked keywords — continue publishing and monitoring`
    );
  }

  if (topActions.length === 0) {
    topActions.push(
      `No citations found for any tracked domain — check that your keywords match how AI engines describe your category`
    );
  }

  // ---------------------------------------------------------------------------
  // Human-readable summary to stderr
  // ---------------------------------------------------------------------------

  process.stderr.write("\n=== Share of Voice Summary ===\n\n");
  process.stderr.write(`Domain:          ${myDomain}\n`);
  process.stderr.write(`Your citations:  ${yourTotalCitations} / ${totalTrackedCitations} tracked\n`);

  if (overallShareOfVoice) {
    process.stderr.write("\nOverall SoV (among tracked brands):\n");
    for (const domain of allTrackedDomains) {
      const pct = Math.round((overallShareOfVoice[domain] || 0) * 100);
      const bar = "█".repeat(Math.round(pct / 5));
      const marker = domain === myDomain ? " ← you" : "";
      process.stderr.write(`  ${domain.padEnd(30)} ${String(pct).padStart(3)}%  ${bar}${marker}\n`);
    }
  }

  process.stderr.write("\nTop actions:\n");
  for (const action of topActions) {
    process.stderr.write(`  • ${action}\n`);
  }
  process.stderr.write("\n");

  // ---------------------------------------------------------------------------
  // Final result
  // ---------------------------------------------------------------------------

  const output = {
    domain: myDomain,
    competitors: competitorDomains,
    checkedAt: new Date().toISOString(),
    engines: engineNames,
    keywords: keywordResults,
    overall: {
      shareOfVoice: overallShareOfVoice,
      totalTrackedCitations,
      yourCitations: yourTotalCitations,
      topCompetitor,
      note: "shareOfVoice is relative among tracked brands only; _other citations are not measured (engines filter to queried domain)",
    },
    topActions,
  };

  outputResult(output);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
