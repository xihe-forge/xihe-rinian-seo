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
    baseline: { type: "string" },
    output: { type: "string" },
  },
});

if (!args.domain || !args.keywords || !args.baseline) {
  process.stderr.write(
    `Usage: node scripts/negative-geo-detect.mjs --domain <domain> --keywords <kw1,kw2,...> --baseline <path> [--output <path>]

Options:
  --domain <domain>      Target domain to monitor (e.g. getsubtextai.com)
  --keywords <list>      Comma-separated keywords to check
  --baseline <path>      Previous check-ai-citation.mjs output JSON for comparison
  --output <path>        Write alert report to file (default: stdout)
`
  );
  process.exit(1);
}

// Fix 4: strip trailing slashes from domain normalization
const domain = args.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
const keywords = args.keywords.split(",").map((k) => k.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Sentiment analysis constants
// ---------------------------------------------------------------------------

const POSITIVE_WORDS = [
  "best", "top", "recommended", "excellent", "great", "reliable", "trusted",
  "popular", "leading", "innovative",
  "推荐", "最好", "优秀", "领先", "可靠",
];

const NEGATIVE_WORDS = [
  "worst", "scam", "avoid", "terrible", "bad", "unreliable", "expensive",
  "slow", "broken", "alternative to",
  "骗", "垃圾", "差", "避免", "不推荐",
];

const ATTACK_SIGNALS = [
  "better alternative", "switch from", "don't use", "moved away from",
  "replaced by", "outdated", "security concern", "data breach",
  "比...好", "替代", "别用", "已弃用", "安全隐患",
];

// ---------------------------------------------------------------------------
// ALL function definitions — before any top-level execution
// ---------------------------------------------------------------------------

/**
 * Extract a window of text around the first occurrence of the domain/brand.
 * Returns a ~300-character excerpt centred on the match, lower-cased.
 */
function extractWindow(content, domain) {
  const lower = content.toLowerCase();
  const brand = domain.split(".")[0];
  const idx = lower.indexOf(domain) !== -1 ? lower.indexOf(domain) : lower.indexOf(brand);
  if (idx === -1) return null;

  const start = Math.max(0, idx - 150);
  const end = Math.min(lower.length, idx + 150);
  return lower.slice(start, end);
}

/**
 * Enhanced sentiment analysis with ATTACK_SIGNALS detection.
 * @param {string|null} content
 * @param {string}      domain
 * @returns {{ label: "positive"|"neutral"|"negative"|null, reason: string|null, attackSignals: string[] }}
 */
function analyzeSentiment(content, domain) {
  if (!content || typeof content !== "string") {
    return { label: null, reason: null, attackSignals: [] };
  }

  const window = extractWindow(content, domain);
  if (window === null) {
    return { label: null, reason: null, attackSignals: [] };
  }

  // Collect any attack signals present
  const foundAttackSignals = ATTACK_SIGNALS.filter((sig) =>
    window.includes(sig.toLowerCase())
  );

  // Attack signals count as negative weight — check before positive words
  if (foundAttackSignals.length > 0) {
    return {
      label: "negative",
      reason: `Detected attack signal(s): ${foundAttackSignals.map((s) => `"${s}"`).join(", ")} near domain mention`,
      attackSignals: foundAttackSignals,
    };
  }

  // Check positive words
  for (const word of POSITIVE_WORDS) {
    if (window.includes(word.toLowerCase())) {
      return {
        label: "positive",
        reason: `Detected positive indicator "${word}" near domain mention`,
        attackSignals: [],
      };
    }
  }

  // Check negative words
  for (const word of NEGATIVE_WORDS) {
    if (window.includes(word.toLowerCase())) {
      return {
        label: "negative",
        reason: `Detected negative indicator "${word}" near domain mention`,
        attackSignals: [],
      };
    }
  }

  // Domain mentioned but no strong sentiment
  return {
    label: "neutral",
    reason: "Domain mentioned without strong positive or negative indicators",
    attackSignals: [],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function countBySeverity(alerts) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const a of alerts) {
    if (counts[a.severity] !== undefined) counts[a.severity]++;
  }
  return counts;
}

function computeRiskLevel(alerts, suspiciousSources) {
  if (alerts.some((a) => a.severity === "critical")) return "critical";

  const highCount = alerts.filter((a) => a.severity === "high").length;
  const mediumCount = alerts.filter((a) => a.severity === "medium").length;
  const lowCount = alerts.filter((a) => a.severity === "low").length;

  const sentimentShifts = alerts.filter((a) => a.type === "sentiment_shift").length;
  const newNegSources = alerts.filter((a) => a.type === "new_negative_source").length;

  if (highCount >= 2 || sentimentShifts >= 2 || (newNegSources > 0 && highCount > 0)) return "high";
  if (mediumCount >= 2 || highCount >= 1 || sentimentShifts >= 1) return "medium";
  if (lowCount >= 1 || mediumCount >= 1) return "low";
  return "low";
}

// Fix 3: correct filter logic in generateRecommendations
function generateRecommendations(alerts, suspiciousSources, domain, keywords) {
  const recs = [];

  for (const src of suspiciousSources) {
    const related = alerts.filter(
      (a) => a.sourceUrl?.includes(src) || a.occurrences?.some((o) => o.sourceUrl?.includes(src))
    );
    const engines = [...new Set(related.map(a => a.engine).filter(Boolean))];
    const engineInfo = engines.length > 0 ? ` (${engines.join(", ")})` : "";
    recs.push(
      `Investigate ${src} — appeared in ${related.length} negative citation(s)${engineInfo}`
    );
  }

  const shiftedKeywords = [...new Set(alerts.filter((a) => a.type === "sentiment_shift").map((a) => a.keyword))];
  for (const kw of shiftedKeywords) {
    recs.push(
      `Publish fresh positive content targeting "${kw}" to counter detected negative sentiment shift`
    );
  }

  const lostKeywords = [...new Set(alerts.filter((a) => a.type === "citation_lost").map((a) => `${a.keyword} (${a.engine})`))];
  for (const kwEngine of lostKeywords) {
    recs.push(
      `Monitor citation for ${kwEngine} — displacement detected`
    );
  }

  const attackKeywords = [...new Set(
    alerts.filter((a) => a.attackSignals?.length > 0 || a.current?.attackSignals?.length > 0).map((a) => a.keyword)
  )];
  for (const kw of attackKeywords) {
    recs.push(
      `Attack language patterns detected for "${kw}" — consider GEO content hardening (publish authoritative sources)`
    );
  }

  if (alerts.some((a) => a.type === "coordinated_attack" || a.type === "cross_engine_source")) {
    recs.push(
      "Coordinated negative seeding detected — consider filing a dispute or legal notice against identified domains"
    );
    recs.push(
      `Publish high-authority content for ${domain} to reclaim citation rankings across affected engines`
    );
  }

  if (recs.length === 0 && alerts.length === 0) {
    recs.push("No negative signals detected. Continue routine monitoring.");
  }

  return recs;
}

function outputResult(result) {
  const json = JSON.stringify(result, null, 2);
  if (args.output) {
    writeFileSync(args.output, json, "utf8");
    process.stderr.write(`Results written to ${args.output}\n`);
  } else {
    process.stdout.write(json + "\n");
  }
}

// Build a lookup: { keyword -> { engineName -> { cited, sentiment, urls } } }
function buildBaselineLookup(baseline) {
  const lookup = {};
  for (const kwEntry of baseline.keywords ?? []) {
    lookup[kwEntry.keyword] = {};
    for (const [engineName, result] of Object.entries(kwEntry.results ?? {})) {
      lookup[kwEntry.keyword][engineName] = {
        cited: result.cited ?? false,
        sentiment: result.sentiment ?? null,
        urls: result.urls ?? [],
        snippet: result.snippet ?? null,
      };
    }
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Load baseline
// ---------------------------------------------------------------------------

let baseline;
try {
  baseline = JSON.parse(readFileSync(args.baseline, "utf8"));
} catch (err) {
  process.stderr.write(`Failed to load baseline: ${err.message}\n`);
  process.exit(1);
}

const baselineDate = baseline.checkedAt ?? null;
const baselineLookup = buildBaselineLookup(baseline);

// ---------------------------------------------------------------------------
// Load engines
// Fix 2: wrap importEngine calls in try/catch
// ---------------------------------------------------------------------------

const engines = [];
const unavailableEngines = [];

for (const name of ALL_ENGINE_NAMES) {
  try {
    const engine = await importEngine(name);
    if (engine.isAvailable()) {
      engines.push(engine);
    } else {
      unavailableEngines.push({ name, envKey: engine.envKey, setupUrl: engine.setupUrl });
    }
  } catch (err) {
    process.stderr.write(`Warning: failed to load engine "${name}": ${err.message}\n`);
  }
}

if (unavailableEngines.length > 0) {
  process.stderr.write("Engines not configured (skipped):\n");
  for (const e of unavailableEngines) {
    process.stderr.write(`  ${e.name}: set ${e.envKey} — ${e.setupUrl}\n`);
  }
  process.stderr.write("\n");
}

// ---------------------------------------------------------------------------
// Baseline-only analysis (no live engines available)
// ---------------------------------------------------------------------------

if (engines.length === 0) {
  process.stderr.write("No engines available. Performing baseline-only negative pattern analysis.\n\n");

  const alerts = [];

  for (const kwEntry of (baseline.keywords ?? []).filter(e => keywords.includes(e.keyword))) {
    const kw = kwEntry.keyword;
    for (const [engineName, result] of Object.entries(kwEntry.results ?? {})) {
      const snippet = result.snippet ?? null;
      if (!snippet) continue;

      const sentiment = analyzeSentiment(snippet, domain);
      if (sentiment.label === "negative") {
        const negUrls = result.urls ?? [];
        const alert = {
          type: "baseline_negative",
          severity: sentiment.attackSignals.length > 0 ? "high" : "medium",
          keyword: kw,
          engine: engineName,
          description: "Negative sentiment detected in baseline — no live comparison available",
          baseline: {
            sentiment: sentiment.label,
            snippet: snippet.slice(0, 200),
            reason: sentiment.reason,
          },
          attackSignals: sentiment.attackSignals,
          sourceUrls: negUrls,
        };
        alerts.push(alert);
      }
    }
  }

  const bySeverity = countBySeverity(alerts);
  const riskLevel = computeRiskLevel(alerts, []);

  const report = {
    domain,
    checkedAt: new Date().toISOString(),
    baselineDate,
    riskLevel,
    mode: "baseline_only",
    alerts,
    summary: {
      totalAlerts: alerts.length,
      bySeverity,
      sentimentTrend: null,
      suspiciousSources: [],
      citationChanges: null,
    },
    recommendations: generateRecommendations(alerts, [], domain, keywords),
  };

  outputResult(report);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live check
// ---------------------------------------------------------------------------

process.stderr.write(`Domain: ${domain}\n`);
process.stderr.write(`Keywords: ${keywords.join(", ")}\n`);
process.stderr.write(`Engines: ${engines.map((e) => e.name).join(", ")}\n`);
process.stderr.write(`Baseline: ${baselineDate ?? "unknown date"}\n\n`);

const currentResults = []; // [{ keyword, results: { engineName: { cited, urls, snippet, sentiment } } }]

for (let i = 0; i < keywords.length; i++) {
  const kw = keywords[i];
  const results = {};

  for (let j = 0; j < engines.length; j++) {
    const engine = engines[j];

    if (i > 0 || j > 0) await sleep(2000);

    process.stderr.write(`[${i + 1}/${keywords.length}] ${engine.name}: "${kw}" ... `);

    try {
      const engineResult = await engine.query(kw, domain);

      if (engineResult.cited || engineResult.snippet) {
        const sentiment = analyzeSentiment(engineResult.snippet ?? "", domain);
        if (sentiment.label !== null) {
          engineResult.sentiment = sentiment;
        }
      }

      results[engine.name] = engineResult;
      process.stderr.write(engineResult.cited ? "CITED\n" : "not cited\n");
    } catch (err) {
      results[engine.name] = { cited: false, urls: [], snippet: null, error: err.message, failed: true };
      process.stderr.write(`ERROR: ${err.message}\n`);
    }
  }

  currentResults.push({ keyword: kw, results });
}

// ---------------------------------------------------------------------------
// Alert detection
// ---------------------------------------------------------------------------

const alerts = [];

// Track source domain appearances for coordinated-attack detection
// sourceDomainMap: { domain -> [{ keyword, engine }] }
const sourceDomainMap = {};

function recordSourceDomain(urlOrDomain, keyword, engine) {
  const d = urlOrDomain.includes("://") ? extractDomain(urlOrDomain) : urlOrDomain;
  if (!d) return;
  if (!sourceDomainMap[d]) sourceDomainMap[d] = [];
  sourceDomainMap[d].push({ keyword, engine });
}

for (const currEntry of currentResults) {
  const kw = currEntry.keyword;
  const baselineKw = baselineLookup[kw] ?? {};

  for (const engine of engines) {
    const eName = engine.name;
    const curr = currEntry.results[eName];
    const prev = baselineKw[eName] ?? null;

    if (!curr) continue;

    // Record source domains only for negative/attack citations
    const isNegative = curr.sentiment?.label === "negative";
    const hasAttackSignals = curr.sentiment?.attackSignals?.length > 0;
    if (isNegative || hasAttackSignals) {
      for (const url of curr.urls ?? []) {
        recordSourceDomain(url, kw, eName);
      }
    }

    // ---- Alert: sentiment shift (positive/neutral → negative) ----
    if (curr.sentiment?.label === "negative" && prev?.sentiment?.label && prev.sentiment.label !== "negative") {
      const sourceUrls = curr.urls ?? [];
      alerts.push({
        type: "sentiment_shift",
        severity: "high",
        keyword: kw,
        engine: eName,
        description: `Sentiment changed from ${prev.sentiment.label} to negative`,
        baseline: {
          sentiment: prev.sentiment.label,
          snippet: (prev.snippet ?? "").slice(0, 200),
        },
        current: {
          sentiment: curr.sentiment.label,
          snippet: (curr.snippet ?? "").slice(0, 200),
          reason: curr.sentiment.reason,
          attackSignals: curr.sentiment.attackSignals ?? [],
        },
        sourceUrl: sourceUrls[0] ?? null,
      });
    }

    // ---- Alert: new negative source not in baseline ----
    if (curr.sentiment?.label === "negative") {
      const prevUrls = new Set(prev?.urls ?? []);
      const newNegUrls = (curr.urls ?? []).filter((u) => !prevUrls.has(u));
      for (const url of newNegUrls) {
        // Only if it wasn't already raised as a sentiment_shift
        const alreadyRaisedShift = alerts.some(
          (a) => a.type === "sentiment_shift" && a.keyword === kw && a.engine === eName && a.sourceUrl === url
        );
        if (!alreadyRaisedShift) {
          alerts.push({
            type: "new_negative_source",
            severity: "medium",
            keyword: kw,
            engine: eName,
            description: "New negative source not present in baseline",
            sourceUrl: url,
            attackSignals: curr.sentiment.attackSignals ?? [],
          });
        }
      }

      // No prior citation at all — this engine+keyword was not cited before
      if (!prev && (curr.urls ?? []).length > 0) {
        for (const url of curr.urls ?? []) {
          const alreadyRaised = alerts.some(
            (a) => (a.type === "sentiment_shift" || a.type === "new_negative_source") &&
              a.keyword === kw && a.engine === eName && a.sourceUrl === url
          );
          if (!alreadyRaised) {
            alerts.push({
              type: "new_negative_source",
              severity: "medium",
              keyword: kw,
              engine: eName,
              description: "New negative source in engine with no prior baseline entry",
              sourceUrl: url,
              attackSignals: curr.sentiment.attackSignals ?? [],
            });
          }
        }
      }
    }

    // ---- Alert: citation lost ----
    if (prev?.cited === true && curr.cited === false && !curr.failed) {
      alerts.push({
        type: "citation_lost",
        severity: "low",
        keyword: kw,
        engine: eName,
        description: "Was cited in baseline but no longer cited — possible content displacement",
      });
    }

    // ---- Alert: attack signals even without full negative label ----
    if (
      curr.sentiment?.attackSignals?.length > 0 &&
      curr.sentiment.label !== "negative"
    ) {
      // e.g. label could be null but attack signal found in snippet
      alerts.push({
        type: "attack_signal_detected",
        severity: "medium",
        keyword: kw,
        engine: eName,
        description: `Attack language patterns detected near domain mention: ${curr.sentiment.attackSignals.map((s) => `"${s}"`).join(", ")}`,
        current: {
          sentiment: curr.sentiment.label,
          snippet: (curr.snippet ?? "").slice(0, 200),
          attackSignals: curr.sentiment.attackSignals,
        },
        sourceUrl: (curr.urls ?? [])[0] ?? null,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Coordinated attack detection — same source domain across 3+ engine/keyword pairs
// ---------------------------------------------------------------------------

const suspiciousSources = [];
for (const [srcDomain, occurrences] of Object.entries(sourceDomainMap)) {
  if (occurrences.length >= 3 && srcDomain !== domain) {
    suspiciousSources.push(srcDomain);
    alerts.push({
      type: "coordinated_attack",
      severity: "critical",
      description: `Source domain "${srcDomain}" appears in ${occurrences.length} engine/keyword combinations — possible coordinated seeding`,
      occurrences,
    });
  }
}

// Also flag domains that appear across 2+ different engines for the same keyword
for (const currEntry of currentResults) {
  const kw = currEntry.keyword;
  const enginesBySourceDomain = {};
  for (const engine of engines) {
    for (const url of currEntry.results[engine.name]?.urls ?? []) {
      const d = extractDomain(url);
      if (!d || d === domain) continue;
      if (!enginesBySourceDomain[d]) enginesBySourceDomain[d] = new Set();
      enginesBySourceDomain[d].add(engine.name);
    }
  }
  for (const [srcDomain, enginesSet] of Object.entries(enginesBySourceDomain)) {
    if (enginesSet.size >= 2 && !suspiciousSources.includes(srcDomain)) {
      // Only flag if there is negative sentiment in at least one engine for this keyword.
      // A brand-new domain with no negative evidence is not sufficient to trigger the alert.
      const baselineKwEngines = baselineLookup[kw] ?? {};
      const baselineUrlsForKw = Object.values(baselineKwEngines).flatMap((r) => r.urls ?? []);
      const isNewDomain = !baselineUrlsForKw.some((u) => extractDomain(u) === srcDomain);
      const hasNegativeEngine = [...enginesSet].some(
        (eName) => currEntry.results[eName]?.sentiment?.label === "negative"
      );
      if (!hasNegativeEngine) continue;

      suspiciousSources.push(srcDomain);
      alerts.push({
        type: "cross_engine_source",
        severity: "high",
        keyword: kw,
        description: `Source domain "${srcDomain}" cited across ${enginesSet.size} engines for keyword "${kw}" — possible coordinated seeding${isNewDomain ? " (domain not present in baseline)" : ""}`,
        engines: [...enginesSet],
        sourceUrl: `https://${srcDomain}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const bySeverity = countBySeverity(alerts);

// Sentiment trend: baseline vs current
function buildSentimentCount(kwEntries, engineNames) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const kwEntry of kwEntries) {
    for (const eName of engineNames) {
      const r = kwEntry.results?.[eName];
      const label = r?.sentiment?.label;
      if (label && counts[label] !== undefined) counts[label]++;
    }
  }
  return counts;
}

const engineNames = engines.map((e) => e.name);

const baselineSentimentCount = buildSentimentCount((baseline.keywords ?? []).filter(e => keywords.includes(e.keyword)), engineNames);
const currentSentimentCount = buildSentimentCount(currentResults, engineNames);

// Citation changes
let gained = 0, lost = 0, unchanged = 0;
for (const currEntry of currentResults) {
  const kw = currEntry.keyword;
  const baselineKw = baselineLookup[kw] ?? {};
  for (const eName of engineNames) {
    const prevCited = baselineKw[eName]?.cited ?? false;
    const currCited = currEntry.results[eName]?.cited ?? false;
    if (!prevCited && currCited) gained++;
    else if (prevCited && !currCited && !currEntry.results[eName]?.failed) lost++;
    else unchanged++;
  }
}

// Deduplicate suspicious sources
const uniqueSuspiciousSources = [...new Set(suspiciousSources)];

// ---------------------------------------------------------------------------
// Risk level & recommendations
// ---------------------------------------------------------------------------

const riskLevel = computeRiskLevel(alerts, uniqueSuspiciousSources);
const recommendations = generateRecommendations(alerts, uniqueSuspiciousSources, domain, keywords);

// ---------------------------------------------------------------------------
// Print human-readable summary to stderr
// ---------------------------------------------------------------------------

process.stderr.write("\n--- Negative GEO Detection Report ---\n");
process.stderr.write(`Risk level: ${riskLevel.toUpperCase()}\n`);
process.stderr.write(`Total alerts: ${alerts.length}\n`);
if (alerts.length > 0) {
  process.stderr.write(`  critical: ${bySeverity.critical}  high: ${bySeverity.high}  medium: ${bySeverity.medium}  low: ${bySeverity.low}\n`);
}
if (uniqueSuspiciousSources.length > 0) {
  process.stderr.write(`Suspicious sources: ${uniqueSuspiciousSources.join(", ")}\n`);
}
const baselineSentimentTotal = baselineSentimentCount.positive + baselineSentimentCount.neutral + baselineSentimentCount.negative;
process.stderr.write("\nSentiment trend:\n");
if (baselineSentimentTotal === 0) {
  process.stderr.write(`  baseline  — N/A (sentiment field not present in baseline)\n`);
} else {
  process.stderr.write(
    `  baseline  — positive: ${baselineSentimentCount.positive}, neutral: ${baselineSentimentCount.neutral}, negative: ${baselineSentimentCount.negative}\n`
  );
}
process.stderr.write(
  `  current   — positive: ${currentSentimentCount.positive}, neutral: ${currentSentimentCount.neutral}, negative: ${currentSentimentCount.negative}\n`
);
process.stderr.write(`\nCitation changes: +${gained} gained, -${lost} lost, ${unchanged} unchanged\n`);
if (recommendations.length > 0) {
  process.stderr.write("\nRecommendations:\n");
  for (const rec of recommendations) {
    process.stderr.write(`  • ${rec}\n`);
  }
}
process.stderr.write("\n");

// ---------------------------------------------------------------------------
// Final output
// Fix 5: add mode: "live" for schema consistency with baseline-only path
// ---------------------------------------------------------------------------

const report = {
  domain,
  checkedAt: new Date().toISOString(),
  baselineDate,
  riskLevel,
  mode: "live",
  alerts,
  summary: {
    totalAlerts: alerts.length,
    bySeverity,
    sentimentTrend: {
      baseline: baselineSentimentTotal === 0 ? null : baselineSentimentCount,
      current: currentSentimentCount,
    },
    suspiciousSources: uniqueSuspiciousSources,
    citationChanges: { gained, lost, unchanged },
  },
  recommendations,
};

outputResult(report);
