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
  process.exit(0);
}

if (!args.domain || !args.keywords) {
  console.error(
    `Usage: node check-ai-citation.mjs --domain <domain> --keywords <kw1,kw2,...> [options]

Options:
  --engines <names>    Comma-separated engine list (default: all available)
                       Available: ${ALL_ENGINE_NAMES.join(", ")}
  --baseline <path>    Previous result JSON for comparison
  --output <path>      Write results to file (default: stdout)
  --list               Show available engines and their status`
  );
  process.exit(1);
}

const domain = args.domain.toLowerCase().replace(/^https?:\/\//, "");
const keywords = args.keywords.split(",").map((k) => k.trim()).filter(Boolean);

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
  process.stderr.write(`Keywords: ${keywords.length}\n\n`);

  const keywordResults = [];

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const results = {};

    for (let j = 0; j < engines.length; j++) {
      const engine = engines[j];

      if (i > 0 || j > 0) await sleep(2000);

      process.stderr.write(`[${i + 1}/${keywords.length}] ${engine.name}: "${kw}" ... `);

      try {
        const result = await engine.query(kw, domain);
        results[engine.name] = result;
        process.stderr.write(result.cited ? "CITED\n" : "not cited\n");
      } catch (err) {
        results[engine.name] = { cited: false, urls: [], snippet: null, error: err.message };
        process.stderr.write(`ERROR: ${err.message}\n`);
      }
    }

    keywordResults.push({ keyword: kw, results });
  }

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

  const output = {
    domain,
    checkedAt: new Date().toISOString(),
    engines: engineNames,
    keywords: keywordResults,
    summary: {
      totalKeywords: keywords.length,
      perEngine,
      overallCitationRate:
        keywords.length > 0 ? Math.round((totalCited / keywords.length) * 100) / 100 : 0,
    },
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
