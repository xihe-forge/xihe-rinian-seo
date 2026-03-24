#!/usr/bin/env node
/**
 * audit.mjs
 * One-command entry point for the entire xihe-search-forge tool suite.
 *
 * Usage:
 *   node scripts/audit.mjs --url https://getsubtextai.com
 *   node scripts/audit.mjs --url https://getsubtextai.com --brand "SubtextAI"
 *   node scripts/audit.mjs \
 *     --url https://getsubtextai.com \
 *     --brand "SubtextAI" \
 *     --keywords "subtext decoder,conversation analyzer,chat analysis tool" \
 *     --competitors "crystalknows.com,textbehind.com" \
 *     --output report.json
 *
 * npm run audit -- --url https://getsubtextai.com --brand SubtextAI
 */

import { execFile } from "node:child_process";
import { writeFile, unlink, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Active child process tracking (for SIGINT cleanup)
// ---------------------------------------------------------------------------

const activeChildren = new Set();

function runToolWithHandle(scriptName, args, timeout = 120_000, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "node",
      [join(__dirname, scriptName), ...args],
      {
        timeout,
        env: { ...process.env },
        maxBuffer: 10 * 1024 * 1024,
        ...opts,
      },
      (err, stdout, stderr) => {
        activeChildren.delete(child);
        if (err) reject(err);
        else resolve({ stdout, stderr });
      }
    );
    activeChildren.add(child);
  });
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    url: null,
    brand: null,
    keywords: null,
    competitors: null,
    output: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--url":        result.url         = args[++i]; break;
      case "--brand":      result.brand       = args[++i]; break;
      case "--keywords":   result.keywords    = args[++i]; break;
      case "--competitors":result.competitors = args[++i]; break;
      case "--output":     result.output      = args[++i]; break;
      default:
        if (arg.startsWith("--url="))          result.url         = arg.split("=").slice(1).join("=");
        else if (arg.startsWith("--brand="))   result.brand       = arg.split("=").slice(1).join("=");
        else if (arg.startsWith("--keywords="))result.keywords    = arg.split("=").slice(1).join("=");
        else if (arg.startsWith("--competitors="))result.competitors = arg.split("=").slice(1).join("=");
        else if (arg.startsWith("--output=")) result.output       = arg.split("=").slice(1).join("=");
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract domain from a URL string.
 * "https://getsubtextai.com/foo" -> "getsubtextai.com"
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
}

/**
 * Derive brand name from domain.
 * "getsubtextai.com" -> "getsubtextai"
 */
function brandFromDomain(domain) {
  // Second-level TLDs that should be stripped as a two-part suffix (e.g. "example.co.jp" -> "example")
  const secondLevelTlds = new Set([
    "com.cn", "co.jp", "co.kr", "com.au", "co.nz", "com.br", "co.in",
    "com.sg", "com.hk", "com.tw", "co.uk", "org.uk",
  ]);
  // Single-part TLDs to strip
  const tlds = new Set([
    "com", "org", "net", "io", "co", "uk", "us", "ai", "app", "dev",
    // Country-code TLDs
    "cn", "de", "fr", "jp", "kr", "in", "ru", "br", "au", "ca", "it",
    "es", "nl", "se", "no", "fi", "dk", "pl", "cz", "ch", "at", "be",
    "pt", "ie", "nz", "sg", "hk", "tw", "mx", "ar", "za", "th", "vn",
    "id", "my", "ph",
  ]);
  const parts = domain.split(".");
  // Check for a matching second-level TLD suffix (last two parts joined)
  if (parts.length > 2) {
    const twoPartSuffix = parts.slice(-2).join(".");
    if (secondLevelTlds.has(twoPartSuffix)) {
      // Strip both suffix parts and return the preceding label
      return parts[parts.length - 3];
    }
  }
  // Remove trailing single-part TLD parts (e.g. "com", "de", "co")
  while (parts.length > 1 && tlds.has(parts[parts.length - 1])) {
    parts.pop();
  }
  // The registrable domain is now the last remaining part
  return parts[parts.length - 1];
}

/**
 * Build a progress bar string: 10 chars, █ filled, ░ empty.
 */
function progressBar(value, max = 100, width = 10) {
  const filled = Math.round((Math.min(value, max) / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * Run a script as a subprocess, capturing stdout JSON output.
 */
async function runTool(scriptName, args, label, stepNum, totalSteps, timeout = 120_000) {
  process.stderr.write(`[${stepNum}/${totalSteps}] ${label}...\n`);
  try {
    const { stdout } = await runToolWithHandle(scriptName, args, timeout);
    let result;
    try {
      result = JSON.parse(stdout);
    } catch {
      // stdout might have trailing newline / extra text — try trimming
      result = JSON.parse(stdout.trim());
    }
    process.stderr.write(`[${stepNum}/${totalSteps}] ${label} ✓\n`);
    return result;
  } catch (err) {
    const msg = err.message?.split("\n")[0] || "failed";
    process.stderr.write(`[${stepNum}/${totalSteps}] ${label} ✗ (${msg})\n`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// "Silent start" variant: does NOT print [N/M] prefix (used for parallel steps
// that we announce manually before awaiting).
// ---------------------------------------------------------------------------
async function runToolSilent(scriptName, args, timeout = 120_000) {
  try {
    const { stdout } = await runToolWithHandle(scriptName, args, timeout);
    try {
      return JSON.parse(stdout);
    } catch {
      return JSON.parse(stdout.trim());
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Temp file cleanup
// ---------------------------------------------------------------------------
async function cleanupTempFiles(crawlTmpFile, dir) {
  try {
    if (crawlTmpFile) await unlink(crawlTmpFile).catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Score extraction helpers
// ---------------------------------------------------------------------------

function getLighthouseScores(lhResult) {
  if (!lhResult?.scores) return null;
  return {
    seo:           lhResult.scores.seo           ?? null,
    bestPractices: lhResult.scores["best-practices"] ?? null,
  };
}

function getContentOptimizationScore(coResult) {
  return coResult?.overallScore ?? null;
}

function getPlatformPresenceScore(ppResult) {
  return ppResult?.overallScore ?? null;
}

function getFreshnessScore(frResult) {
  return frResult?.overallScore ?? null;
}

/**
 * AI citation rate as a 0-100 score.
 * overallCitationRate is 0-1 from check-ai-citation.mjs.
 */
function getAiCitationScore(acResult) {
  if (acResult == null) return null;
  const rate = acResult?.summary?.overallCitationRate;
  if (rate == null) return null;
  return Math.min(100, Math.round(rate * 100));
}

/**
 * Share of voice as a 0-100 score (your SoV percentage among tracked brands).
 */
function getSovScore(sovResult, domain) {
  if (sovResult == null) return null;
  const sov = sovResult?.overall?.shareOfVoice;
  if (!sov) return null;
  // Find our domain key (may be normalised)
  const key = Object.keys(sov).find((k) => k.includes(domain.split(".")[0]));
  if (!key) return null;
  return Math.min(100, Math.round(sov[key] * 100));
}

/**
 * Compute overall score as average of available dimension scores.
 * Weights: lighthouse 20%, content 20%, platform 20%, freshness 15%, citation 15%, sov 10%
 */
function computeOverallScore(scores) {
  const weights = [
    { key: "lighthouse",          weight: 0.20, value: scores.lighthouse?.seo       ?? null },
    { key: "contentOptimization", weight: 0.20, value: scores.contentOptimization   ?? null },
    { key: "platformPresence",    weight: 0.20, value: scores.platformPresence       ?? null },
    { key: "freshness",           weight: 0.15, value: scores.freshness             ?? null },
    { key: "aiCitation",          weight: 0.15, value: scores.aiCitation            ?? null },
    { key: "shareOfVoice",        weight: 0.10, value: scores.shareOfVoice          ?? null },
  ];

  let weightedSum = 0;
  let totalWeight = 0;
  for (const { weight, value } of weights) {
    if (value != null) {
      weightedSum += weight * value;
      totalWeight += weight;
    }
  }
  if (totalWeight === 0) return null;
  return Math.min(100, Math.max(0, Math.round(weightedSum / totalWeight)));
}

// ---------------------------------------------------------------------------
// Top actions aggregation
// ---------------------------------------------------------------------------

/**
 * Assign a numeric priority level (lower = higher priority).
 * P0 = 0, P1 = 1, P2 = 2, P3 = 3
 */
function assignPriority(action) {
  const lower = action.toLowerCase();
  // P0: critical blockers
  if (
    lower.includes("ssr") ||
    lower.includes("server-side") ||
    lower.includes("client-render") ||
    lower.includes("empty page") ||
    lower.includes("critical") ||
    lower.includes("broken")
  ) return 0;
  // P1: high impact structural fixes
  if (
    lower.includes("schema") ||
    lower.includes("json-ld") ||
    lower.includes("canonical") ||
    lower.includes("high impact") ||
    lower.includes("high priority") ||
    lower.includes("0 citations") ||
    lower.includes("0 presence")
  ) return 1;
  // P2: medium impact
  if (
    lower.includes("quote") ||
    lower.includes("statistic") ||
    lower.includes("expert") ||
    lower.includes("medium") ||
    lower.includes("improve") ||
    lower.includes("update") ||
    lower.includes("create")
  ) return 2;
  // P3: nice to have
  return 3;
}

function formatPriority(level) {
  switch (level) {
    case 0: return "🔴 [P0]";
    case 1: return "🟠 [P1]";
    case 2: return "🟡 [P2]";
    default: return "⚪ [P3]";
  }
}

/**
 * Extract failed audit titles from Lighthouse result as action items.
 */
function collectLighthouseActions(lhResult) {
  if (!lhResult?.audits) return [];
  const actions = [];
  for (const audits of Object.values(lhResult.audits)) {
    if (!Array.isArray(audits)) continue;
    for (const audit of audits) {
      if (audit.passed === false) {
        actions.push(`修复 Lighthouse 审计项: ${audit.title}`);
      }
    }
  }
  return actions;
}

function aggregateTopActions(sections) {
  const allActions = [];

  // Collect from each section's topActions array
  const sources = [
    sections.lighthouse   && collectLighthouseActions(sections.lighthouse),
    sections.contentOptimization?.topActions,
    sections.platformPresence?.topActions,
    sections.freshness?.topActions,
    sections.aiCitation?.topActions,
    sections.shareOfVoice?.topActions,
  ].filter(Boolean);

  for (const list of sources) {
    if (Array.isArray(list)) {
      for (const action of list) {
        if (typeof action === "string" && action.trim()) {
          allActions.push(action.trim());
        }
      }
    }
  }

  // Deduplicate (simple prefix similarity)
  const deduped = [];
  const seenNorm = new Set();
  for (const action of allActions) {
    const norm = action.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").slice(0, 60);
    if (!seenNorm.has(norm)) {
      seenNorm.add(norm);
      deduped.push(action);
    }
  }

  // Sort by priority and take top 10
  deduped.sort((a, b) => assignPriority(a) - assignPriority(b));
  const top10 = deduped.slice(0, 10);

  // Prefix with priority tag
  return top10.map((action) => {
    const level = assignPriority(action);
    const tag = formatPriority(level);
    // Avoid double-tagging if action already starts with emoji/bracket
    if (/^[\[🔴🟠🟡⚪]/u.test(action)) return action;
    return `${tag} ${action}`;
  });
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

function generateSummary(scores, brand) {
  const overall = scores.overall;
  if (overall == null) return `${brand} 综合审计完成。部分数据因缺少 API 密钥无法获取。`;

  // Find lowest scoring areas
  const areas = [
    { name: "Lighthouse SEO",  value: scores.lighthouse?.seo         ?? null },
    { name: "内容优化",         value: scores.contentOptimization     ?? null },
    { name: "平台存在感",        value: scores.platformPresence        ?? null },
    { name: "内容新鲜度",        value: scores.freshness               ?? null },
    { name: "AI 引用率",         value: scores.aiCitation              ?? null },
  ].filter((a) => a.value != null).sort((a, b) => a.value - b.value);

  const lowestAreas = areas.slice(0, 2).map((a) => a.name).join("和");

  if (overall < 30) {
    return `${brand} 综合评分 ${overall}/100 — 严重不足，大部分维度需要改进。请优先解决关键阻塞问题。`;
  } else if (overall <= 60) {
    return `${brand} 综合评分 ${overall}/100 — 有基础但需提升。重点关注${lowestAreas || "低分维度"}以提升可见性。`;
  } else if (overall <= 80) {
    return `${brand} 综合评分 ${overall}/100 — 良好。优化${lowestAreas || "剩余维度"}可进一步提升 AI 搜索可见性。`;
  } else {
    return `${brand} 综合评分 ${overall}/100 — 优秀。保持监控，持续优化。`;
  }
}

// ---------------------------------------------------------------------------
// Human-readable stderr report
// ---------------------------------------------------------------------------

function printReport(report) {
  const { url, brand, scores, topActions, output: outputPath } = report;
  const LINE = "═".repeat(52);
  const DIVIDER = "─".repeat(43);

  process.stderr.write(`\n${LINE}\n`);
  process.stderr.write(`  xihe-search-forge — 综合审计报告\n`);
  process.stderr.write(`  ${url} (${brand})\n`);
  process.stderr.write(`${LINE}\n\n`);

  const renderRow = (label, value, max = 100, unit = "/100") => {
    if (value == null) {
      process.stderr.write(`  ${label.padEnd(26)} N/A    (skipped)\n`);
      return;
    }
    const bar = progressBar(value, max);
    process.stderr.write(`  ${label.padEnd(26)} ${String(value).padStart(3)}${unit} ${bar}\n`);
  };

  renderRow("Lighthouse SEO:",       scores.lighthouse?.seo         ?? null);
  renderRow("Best Practices:",       scores.lighthouse?.bestPractices ?? null);
  renderRow("Content Optimization:", scores.contentOptimization     ?? null);
  renderRow("Platform Presence:",    scores.platformPresence        ?? null);
  renderRow("Content Freshness:",    scores.freshness               ?? null);
  renderRow("AI Citation Rate:",     scores.aiCitation              ?? null, 100, "%   ");
  renderRow("Share of Voice:",       scores.shareOfVoice            ?? null, 100, "%   ");
  process.stderr.write(`  ${DIVIDER}\n`);
  renderRow("Overall:",              scores.overall                 ?? null);
  process.stderr.write("\n");

  if (topActions?.length > 0) {
    const top3 = topActions.slice(0, 3);
    process.stderr.write(`  Top ${top3.length} Actions:\n`);
    top3.forEach((action, i) => {
      // Strip long action text for display
      const display = action.length > 72 ? action.slice(0, 69) + "..." : action;
      process.stderr.write(`  ${i + 1}. ${display}\n`);
    });
    process.stderr.write("\n");
  }

  if (outputPath) {
    process.stderr.write(`  Full report: ${outputPath}\n`);
  }

  process.stderr.write(`${LINE}\n\n`);
}

// ---------------------------------------------------------------------------
// Extract keywords from crawl result metadata
// ---------------------------------------------------------------------------

function extractKeywordsFromCrawl(crawlResult, brand) {
  if (!crawlResult) return null;

  const parts = [];

  // Meta keywords
  if (crawlResult.meta?.keywords) {
    parts.push(
      ...crawlResult.meta.keywords.split(",").map((k) => k.trim()).filter(Boolean)
    );
  }

  // Title words (as a fallback keyword)
  if (crawlResult.meta?.title) {
    parts.push(crawlResult.meta.title.trim());
  }

  // Brand itself
  if (brand) parts.push(brand.toLowerCase());

  // Deduplicate and limit
  const unique = [...new Set(parts)].slice(0, 5);
  return unique.length > 0 ? unique.join(",") : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.url) {
    process.stderr.write(
      `Usage: node scripts/audit.mjs --url <URL> [options]\n\n` +
      `  --url          Target URL (required)\n` +
      `  --brand        Brand name (default: derived from domain)\n` +
      `  --keywords     Comma-separated keywords for AI citation check\n` +
      `  --competitors  Comma-separated competitor domains for SoV\n` +
      `  --output       Write JSON report to file (default: stdout)\n\n` +
      `Example:\n` +
      `  node scripts/audit.mjs --url https://getsubtextai.com --brand SubtextAI\n`
    );
    process.exit(1);
  }

  const url    = args.url;
  const domain = extractDomain(url);
  const brand  = args.brand || brandFromDomain(domain);

  process.stderr.write(`\nxihe-search-forge — 综合审计\n`);
  process.stderr.write(`URL:    ${url}\n`);
  process.stderr.write(`品牌:   ${brand}\n`);
  process.stderr.write(`域名:   ${domain}\n`);
  process.stderr.write(`时间:   ${new Date().toISOString()}\n\n`);

  const TOTAL_STEPS = 7;

  // Track temp files for cleanup
  let tmpDir = null;
  let crawlTmpFile = null;

  // Graceful Ctrl+C cleanup
  process.on("SIGINT", async () => {
    process.stderr.write("\n已中断 — 正在清理...\n");
    for (const child of activeChildren) child.kill();
    await cleanupTempFiles(crawlTmpFile, tmpDir);
    process.exit(130);
  });

  try {
    // -------------------------------------------------------------------------
    // Steps 1 & 2: Lighthouse + Crawl (parallel)
    // -------------------------------------------------------------------------
    process.stderr.write(`[1/${TOTAL_STEPS}] 🔍 Lighthouse SEO 基线检测...\n`);
    process.stderr.write(`[2/${TOTAL_STEPS}] 🕷️  抓取页面信号...\n`);

    const [lighthouseResult, crawlResult] = await Promise.all([
      runToolSilent("lighthouse-pull.mjs", ["--url", url, "--strategy", "mobile"]),
      runToolSilent("crawl-page.mjs",      [url]),
    ]);

    const lhOk = lighthouseResult != null;
    const crawlOk = crawlResult != null;

    process.stderr.write(
      `[1/${TOTAL_STEPS}] 🔍 Lighthouse SEO 基线检测 ${lhOk ? "✓" : "✗ (失败)"}\n`
    );
    process.stderr.write(
      `[2/${TOTAL_STEPS}] 🕷️  抓取页面信号 ${crawlOk ? "✓" : "✗ (失败)"}\n`
    );

    // -------------------------------------------------------------------------
    // Step 3: Content Optimize (depends on crawl)
    // -------------------------------------------------------------------------
    let contentOptResult = null;
    if (crawlOk) {
      // Save crawl result to temp file
      tmpDir = await mkdtemp(join(tmpdir(), "xihe-audit-"));
      crawlTmpFile = join(tmpDir, "crawl.json");
      await writeFile(crawlTmpFile, JSON.stringify(crawlResult), "utf8");

      contentOptResult = await runTool(
        "content-optimize.mjs",
        ["--input", crawlTmpFile],
        "📝 分析内容 GEO 优化",
        3,
        TOTAL_STEPS
      );
    } else {
      process.stderr.write(
        `[3/${TOTAL_STEPS}] 📝 分析内容 GEO 优化 ✗ (已跳过 — 抓取失败)\n`
      );
    }

    // -------------------------------------------------------------------------
    // Resolve keywords: CLI arg > crawl-derived > null
    // -------------------------------------------------------------------------
    let resolvedKeywords = args.keywords || extractKeywordsFromCrawl(crawlResult, brand);

    // -------------------------------------------------------------------------
    // Steps 4 & 5: Platform Presence + Freshness (parallel)
    // -------------------------------------------------------------------------
    process.stderr.write(`[4/${TOTAL_STEPS}] 🌐 检查平台存在感...\n`);
    process.stderr.write(`[5/${TOTAL_STEPS}] 📊 检查内容新鲜度...\n`);

    const [platformResult, freshnessResult] = await Promise.all([
      runToolSilent("platform-presence.mjs", ["--brand", brand, "--domain", domain]),
      runToolSilent("freshness-check.mjs",   ["--url", url]),
    ]);

    process.stderr.write(
      `[4/${TOTAL_STEPS}] 🌐 检查平台存在感 ${platformResult != null ? "✓" : "✗ (失败)"}\n`
    );
    process.stderr.write(
      `[5/${TOTAL_STEPS}] 📊 检查内容新鲜度 ${freshnessResult != null ? "✓" : "✗ (失败)"}\n`
    );

    // -------------------------------------------------------------------------
    // Step 6: AI Citation (skip if no keywords or no engines)
    // -------------------------------------------------------------------------
    let aiCitationResult = null;
    if (resolvedKeywords) {
      aiCitationResult = await runTool(
        "check-ai-citation.mjs",
        ["--domain", domain, "--keywords", resolvedKeywords],
        "🤖 检查 AI 引擎引用情况",
        6,
        TOTAL_STEPS,
        600_000
      );
    } else {
      process.stderr.write(
        `[6/${TOTAL_STEPS}] 🤖 检查 AI 引擎引用情况 — 已跳过（无关键词）\n`
      );
    }

    // -------------------------------------------------------------------------
    // Step 7: Share of Voice (skip if no competitors)
    // -------------------------------------------------------------------------
    let sovResult = null;
    if (args.competitors && resolvedKeywords) {
      sovResult = await runTool(
        "share-of-voice.mjs",
        [
          "--domain", domain,
          "--keywords", resolvedKeywords,
          "--competitors", args.competitors,
        ],
        "📈 计算声量份额",
        7,
        TOTAL_STEPS,
        600_000
      );
    } else if (!args.competitors) {
      process.stderr.write(
        `[7/${TOTAL_STEPS}] 📈 计算声量份额 — 已跳过（未提供 --competitors）\n`
      );
    } else {
      process.stderr.write(
        `[7/${TOTAL_STEPS}] 📈 计算声量份额 — 已跳过（无关键词）\n`
      );
    }

    // -------------------------------------------------------------------------
    // Build unified report
    // -------------------------------------------------------------------------
    const lhScores    = getLighthouseScores(lighthouseResult);
    const coScore     = getContentOptimizationScore(contentOptResult);
    const ppScore     = getPlatformPresenceScore(platformResult);
    const frScore     = getFreshnessScore(freshnessResult);
    const acScore     = getAiCitationScore(aiCitationResult);
    const sovScore    = getSovScore(sovResult, domain);

    const scores = {
      lighthouse:           lhScores,
      contentOptimization:  coScore,
      platformPresence:     ppScore,
      freshness:            frScore,
      aiCitation:           acScore,
      shareOfVoice:         sovScore,
      overall:              null, // computed below
    };
    scores.overall = computeOverallScore(scores);

    const sections = {
      lighthouse:           lighthouseResult,
      crawl:                crawlResult,
      contentOptimization:  contentOptResult,
      platformPresence:     platformResult,
      freshness:            freshnessResult,
      aiCitation:           aiCitationResult,
      shareOfVoice:         sovResult,
    };

    const topActions = aggregateTopActions(sections);
    const summary    = generateSummary(scores, brand);

    const report = {
      url,
      brand,
      domain,
      auditedAt: new Date().toISOString(),
      scores,
      sections,
      topActions,
      summary,
    };

    // -------------------------------------------------------------------------
    // Output
    // -------------------------------------------------------------------------
    printReport({ url, brand, scores, topActions, output: args.output });

    const json = JSON.stringify(report, null, 2);

    if (args.output) {
      await writeFile(args.output, json, "utf8");
    } else {
      process.stdout.write(json + "\n");
    }

  } finally {
    await cleanupTempFiles(crawlTmpFile, tmpDir);
  }
}

main().catch((err) => {
  process.stderr.write(`致命错误: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
