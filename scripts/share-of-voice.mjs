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
    `用法: node share-of-voice.mjs --domain <域名> --keywords <关键词1,关键词2,...> [选项]

选项:
  --competitors <domains>    逗号分隔的竞品域名
  --engines <names>          逗号分隔的引擎名称（默认：全部可用）
                             可用引擎：${ALL_ENGINE_NAMES.join(", ")}
  --output <path>            将 JSON 写入文件（默认：stdout）

可读进度输出至 stderr；JSON 结果输出至 stdout（或 --output 文件）。
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
      `未知引擎：${name}。可用引擎：${ALL_ENGINE_NAMES.join(", ")}\n`
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
    process.stderr.write(`警告：加载引擎 "${name}" 失败：${err.message}\n`);
  }
}

if (unavailable.length > 0) {
  process.stderr.write("\n未配置的引擎（已跳过）：\n");
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
    process.stderr.write(`\n结果已写入 ${args.output}\n`);
  } else {
    process.stdout.write(json + "\n");
  }
}

if (engines.length === 0) {
  process.stderr.write(
    "无可用引擎，将生成空值模板。\n\n" +
    "请设置至少一个 API 密钥以启用查询：\n" +
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
 * Query an engine for a keyword and return all cited URLs (unfiltered).
 *
 * Prefers the engine's `queryRaw(keyword)` export which returns every URL in
 * the response so that one API call covers all tracked domains.  Falls back to
 * calling the legacy `query(keyword, domain)` once per tracked domain when
 * `queryRaw` is not available (backward-compat path).
 *
 * Returns { urls: string[], snippet: string|null, error?: string }
 */
async function queryEngineRaw(engine, keyword) {
  if (typeof engine.queryRaw === "function") {
    try {
      const result = await engine.queryRaw(keyword);
      if (result.error) return { urls: [], snippet: null, error: result.error };
      return { urls: result.urls || [], snippet: result.snippet ?? null };
    } catch (err) {
      return { urls: [], snippet: null, error: err.message };
    }
  }

  // Fallback: call legacy query() once per domain and merge results.
  // Note: this re-introduces multiple API calls for old adapters, by design.
  const allUrls = [];
  let snippet = null;
  for (const domain of allTrackedDomains) {
    try {
      const result = await engine.query(keyword, domain);
      for (const u of result.urls || []) {
        if (!allUrls.includes(u)) allUrls.push(u);
      }
      if (!snippet && result.snippet) snippet = result.snippet;
    } catch {
      // ignore per-domain errors in fallback path
    }
  }
  return { urls: allUrls, snippet };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const engineNames = engines.map((e) => e.name);

  const totalQueries = keywords.length * engines.length;

  process.stderr.write(`域名:        ${myDomain}\n`);
  process.stderr.write(`竞品:        ${competitorDomains.length > 0 ? competitorDomains.join(", ") : "（无）"}\n`);
  process.stderr.write(`关键词:      ${keywords.length}\n`);
  process.stderr.write(`引擎:        ${engineNames.join(", ")}\n`);
  process.stderr.write(
    `查询量:      ${keywords.length} 个关键词 × ${engines.length} 个引擎 = ` +
    `${totalQueries} 次 API 调用（域名从响应中本地匹配，不单独查询）\n`
  );
  process.stderr.write("\n");

  // Results structure:
  // rawData[kwIndex][engineName] = { urls: string[], snippet: string|null, error?: string }
  // Domain matching is done in the aggregation step below.
  const rawData = [];

  let queryCount = 0;

  for (let ki = 0; ki < keywords.length; ki++) {
    const kw = keywords[ki];
    const kwData = {};

    for (let ei = 0; ei < engines.length; ei++) {
      const engine = engines[ei];

      // Rate-limit: 2-second sleep between API calls (skip before the very first)
      if (queryCount > 0) await sleep(2000);
      queryCount++;

      process.stderr.write(
        `[${queryCount}/${totalQueries}] ${engine.name} | "${kw}" ... `
      );

      const result = await queryEngineRaw(engine, kw);

      if (result.error) {
        process.stderr.write(`错误：${result.error}\n`);
      } else {
        const matchedCount = allTrackedDomains.reduce(
          (n, d) => n + (result.urls.some((u) => matchDomain(u, d)) ? 1 : 0),
          0
        );
        process.stderr.write(
          `共 ${result.urls.length} 个 URL，${matchedCount} 个追踪域名被引用\n`
        );
      }

      kwData[engine.name] = result;
    }

    rawData.push(kwData);
  }

  // ---------------------------------------------------------------------------
  // Aggregate per keyword
  // ---------------------------------------------------------------------------

  /**
   * For each keyword, fan out the single per-(keyword, engine) raw response
   * across all tracked domains using local URL matching.  Because all domains
   * are evaluated against the SAME response, comparisons are consistent.
   *
   * ShareOfVoice is calculated as:
   *   domain_citations / sum(all_tracked_domain_citations)
   * This is the relative SoV among tracked brands only.
   *
   * _other counts URLs in the response that don't match ANY tracked domain,
   * which is now computable because we have the full URL list.
   */

  const keywordResults = keywords.map((kw, ki) => {
    const kwData = rawData[ki];

    // citations[domain] = { count: number, engines: string[], urls: string[] }
    const citations = {};
    let otherCount = 0;

    for (const domain of allTrackedDomains) {
      let count = 0;
      const citedByEngines = [];
      const citedUrls = [];

      for (const engine of engines) {
        const r = kwData[engine.name];
        if (!r || r.error) continue;  // skip failed queries — don't count as "not cited"
        const domainUrls = r.urls.filter((u) => matchDomain(u, domain));
        if (domainUrls.length > 0) {
          count += 1;  // One citation event per (keyword, engine) that mentioned this domain
          citedByEngines.push(engine.name);
          for (const u of domainUrls) {
            if (!citedUrls.includes(u)) citedUrls.push(u);
          }
        }
      }

      citations[domain] = { count, engines: citedByEngines, urls: citedUrls };
    }

    // _other: URLs from successful responses that don't match any tracked domain
    for (const engine of engines) {
      const r = kwData[engine.name];
      if (!r || r.error) continue;
      const untracked = r.urls.filter(
        (u) => !allTrackedDomains.some((d) => matchDomain(u, d))
      );
      otherCount += untracked.length;
    }
    citations._other = { count: otherCount };

    // Collect failed engines for this keyword (one entry per engine, not per domain)
    const incomplete = [];
    for (const engine of engines) {
      const r = kwData[engine.name];
      if (r && r.error) {
        incomplete.push({ engine: engine.name, error: r.error });
      }
    }

    // SoV among tracked domains only, counting only queries that succeeded
    // For each domain, the denominator is the number of engines that did NOT error for that domain
    const trackedTotal = allTrackedDomains.reduce((s, d) => s + (citations[d]?.count || 0), 0);

    let shareOfVoice = null;
    if (trackedTotal > 0) {
      shareOfVoice = {};
      for (const domain of allTrackedDomains) {
        const c = citations[domain]?.count || 0;
        shareOfVoice[domain] = Math.round((c / trackedTotal) * 1000) / 1000;
      }
    }

    const result = { keyword: kw, citations, shareOfVoice };
    if (incomplete.length > 0) result.incomplete = incomplete;
    return result;
  });

  // ---------------------------------------------------------------------------
  // Overall aggregation
  // ---------------------------------------------------------------------------

  let totalTrackedCitations = 0;
  let yourTotalCitations = 0;
  const domainTotals = Object.fromEntries(allTrackedDomains.map((d) => [d, 0]));

  for (const kwResult of keywordResults) {
    // Skip keywords with incomplete data so that engine failures for one domain
    // don't silently deflate its overall SoV relative to competitors.
    if (kwResult.incomplete) continue;
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

  // Keywords where user has zero citations (skip keywords with incomplete data to avoid false gaps)
  const zeroCitationKws = keywordResults.filter(
    (kr) => (kr.citations[myDomain]?.count || 0) === 0 && !kr.incomplete
  );
  if (zeroCitationKws.length > 0) {
    for (const kr of zeroCitationKws) {
      topActions.push(
        `You have 0 citations for "${kr.keyword}" — high priority content gap`
      );
    }
  }

  // Keywords dominated by a competitor (competitor SoV > 2× yours; skip incomplete keywords)
  for (const kr of keywordResults) {
    if (!kr.shareOfVoice || kr.incomplete) continue;
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

  // Note any keywords with incomplete data
  const incompleteKws = keywordResults.filter((kr) => kr.incomplete);
  if (incompleteKws.length > 0) {
    topActions.push(
      `${incompleteKws.length} keyword(s) have incomplete data due to engine errors — results may undercount citations`
    );
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

  process.stderr.write("\n=== 声量份额汇总 ===\n\n");
  process.stderr.write(`域名:            ${myDomain}\n`);
  process.stderr.write(`我方引用量:      ${yourTotalCitations} / ${totalTrackedCitations} 次追踪引用\n`);

  if (overallShareOfVoice) {
    process.stderr.write("\n整体声量份额（仅限追踪品牌）：\n");
    for (const domain of allTrackedDomains) {
      const pct = Math.round((overallShareOfVoice[domain] || 0) * 100);
      const bar = "█".repeat(Math.round(pct / 5));
      const marker = domain === myDomain ? " ← 我方" : "";
      process.stderr.write(`  ${domain.padEnd(30)} ${String(pct).padStart(3)}%  ${bar}${marker}\n`);
    }
  }

  process.stderr.write("\n优先操作：\n");
  for (const action of topActions) {
    process.stderr.write(`  • ${action}\n`);
  }
  process.stderr.write("\n");

  // ---------------------------------------------------------------------------
  // Final result
  // ---------------------------------------------------------------------------

  // Collect all unique failed queries across all keywords for the top-level warnings field
  const allIncomplete = [];
  for (const kr of keywordResults) {
    if (kr.incomplete) {
      for (const entry of kr.incomplete) {
        allIncomplete.push({ keyword: kr.keyword, ...entry });
      }
    }
  }

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
      note: "shareOfVoice is relative among tracked brands only; _other counts untracked URLs from the same responses",
    },
    topActions,
    ...(allIncomplete.length > 0 && { warnings: allIncomplete }),
  };

  outputResult(output);
}

main().catch((err) => {
  process.stderr.write(`致命错误：${err.message}\n`);
  process.exit(1);
});
