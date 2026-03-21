#!/usr/bin/env node
/**
 * lighthouse-pull.mjs
 * Fetch Lighthouse audit results via Google PageSpeed Insights API (free, no auth required).
 *
 * Usage:
 *   node lighthouse-pull.mjs --url https://getsubtextai.com
 *   node lighthouse-pull.mjs --url https://getsubtextai.com --strategy desktop
 *   node lighthouse-pull.mjs --url https://getsubtextai.com --categories seo,performance,accessibility,best-practices
 *   node lighthouse-pull.mjs --url https://getsubtextai.com --output ./result.json
 *
 * Env:
 *   PAGESPEED_API_KEY  (optional) — appends &key= for higher quota
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGESPEED_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DEFAULT_CATEGORIES = ['seo', 'best-practices'];
const DEFAULT_STRATEGY = 'mobile';
const TIMEOUT_MS = 60_000;

// Category display labels
const CATEGORY_LABELS = {
  seo: 'SEO',
  performance: 'Performance',
  accessibility: 'Accessibility',
  'best-practices': 'Best Practices',
  pwa: 'PWA',
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    url: null,
    strategy: DEFAULT_STRATEGY,
    categories: DEFAULT_CATEGORIES,
    output: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        result.url = args[++i];
        break;
      case '--strategy':
        result.strategy = args[++i];
        break;
      case '--categories':
        result.categories = args[++i].split(',').map((c) => c.trim().toLowerCase());
        break;
      case '--output':
        result.output = args[++i];
        break;
      default:
        if (args[i].startsWith('--url=')) result.url = args[i].slice(6);
        else if (args[i].startsWith('--strategy=')) result.strategy = args[i].slice(11);
        else if (args[i].startsWith('--categories='))
          result.categories = args[i]
            .slice(13)
            .split(',')
            .map((c) => c.trim().toLowerCase());
        else if (args[i].startsWith('--output=')) result.output = args[i].slice(9);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Build PageSpeed Insights API URL
// ---------------------------------------------------------------------------

function buildApiUrl(url, strategy, categories) {
  const params = new URLSearchParams({ url, strategy });

  for (const cat of categories) {
    params.append('category', cat);
  }

  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey) {
    params.set('key', apiKey);
  }

  return `${PAGESPEED_API}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Fetch with timeout
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s. PageSpeed Insights can be slow — try again.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Determine which category an audit belongs to
// We use the lighthouseResult.categories[cat].auditRefs to map audit ids.
// ---------------------------------------------------------------------------

function buildAuditCategoryMap(lighthouseResult, categories) {
  // auditCategoryMap: auditId -> categoryId
  const map = {};
  for (const catId of categories) {
    const catData = lighthouseResult.categories?.[catId];
    if (!catData) continue;
    for (const ref of catData.auditRefs ?? []) {
      // An audit can appear in multiple categories; last write wins (acceptable).
      map[ref.id] = catId;
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Parse the raw Lighthouse response into our clean structure
// ---------------------------------------------------------------------------

function parseResponse(raw, url, strategy, categories) {
  const lr = raw.lighthouseResult;

  if (!lr) {
    const errorMsg =
      raw.error?.message ?? raw.error?.errors?.[0]?.message ?? JSON.stringify(raw.error ?? raw);
    throw new Error(`PageSpeed Insights returned an error: ${errorMsg}`);
  }

  // --- Scores per category ---
  const scores = {};
  for (const catId of categories) {
    const catData = lr.categories?.[catId];
    if (catData != null) {
      // score is 0-1 from Lighthouse; multiply by 100 and round
      scores[catId] = catData.score != null ? Math.round(catData.score * 100) : null;
    }
  }

  // --- Build a per-category list of audits ---
  const auditCategoryMap = buildAuditCategoryMap(lr, categories);

  // Initialise empty arrays for each category
  const auditsByCategory = Object.fromEntries(categories.map((c) => [c, []]));

  let totalAudits = 0;
  let passed = 0;
  let failed = 0;
  let notApplicable = 0;

  for (const [auditId, auditData] of Object.entries(lr.audits ?? {})) {
    const catId = auditCategoryMap[auditId];
    if (!catId) continue; // audit belongs to a category we didn't request

    const score = auditData.score; // null | 0-1
    const scoreDisplayMode = auditData.scoreDisplayMode; // 'binary' | 'numeric' | 'notApplicable' | 'informative' | 'manual' | 'error'

    let isPassed = null;
    if (scoreDisplayMode === 'notApplicable' || scoreDisplayMode === 'manual') {
      isPassed = null; // N/A
    } else if (score === null || scoreDisplayMode === 'informative' || scoreDisplayMode === 'error') {
      isPassed = null;
    } else {
      isPassed = score >= 0.9; // Lighthouse convention: >=0.9 = pass, <0.9 = fail
    }

    const auditEntry = {
      id: auditId,
      title: auditData.title ?? auditId,
      score: score,
      passed: isPassed,
      displayValue: auditData.displayValue ?? null,
      description: auditData.description ?? null,
    };

    auditsByCategory[catId].push(auditEntry);
    totalAudits++;

    if (scoreDisplayMode === 'notApplicable') {
      notApplicable++;
    } else if (isPassed === true) {
      passed++;
    } else if (isPassed === false) {
      failed++;
    } else {
      // informative / manual / null — count as N/A for summary purposes
      notApplicable++;
    }
  }

  // Sort audits within each category: failed first, then passed, then N/A
  const scorePriority = (a) => {
    if (a.passed === false) return 0;
    if (a.passed === true) return 1;
    return 2;
  };
  for (const catId of categories) {
    auditsByCategory[catId].sort((a, b) => scorePriority(a) - scorePriority(b));
  }

  return {
    url,
    fetchedAt: new Date().toISOString(),
    strategy,
    scores,
    audits: auditsByCategory,
    summary: {
      totalAudits,
      passed,
      failed,
      notApplicable,
    },
  };
}

// ---------------------------------------------------------------------------
// Human-readable summary printed to stderr
// ---------------------------------------------------------------------------

function printSummary(result) {
  const { scores, summary, audits, categories } = result;
  const cats = Object.keys(scores);

  // Scores line(s)
  for (const catId of cats) {
    const label = CATEGORY_LABELS[catId] ?? catId;
    const score = scores[catId];
    const display = score != null ? `${score}/100` : 'N/A';
    process.stderr.write(`Lighthouse ${label}: ${display}\n`);
  }

  process.stderr.write('\n');
  process.stderr.write(
    `Passed: ${summary.passed}  Failed: ${summary.failed}  N/A: ${summary.notApplicable}\n`
  );

  // List failed audits across all categories
  const failedAudits = [];
  for (const catId of cats) {
    for (const audit of audits[catId] ?? []) {
      if (audit.passed === false) {
        failedAudits.push(audit);
      }
    }
  }

  if (failedAudits.length > 0) {
    process.stderr.write('\nFailed:\n');
    for (const audit of failedAudits) {
      const detail = audit.displayValue ? ` (${audit.displayValue})` : '';
      process.stderr.write(`  \u2717 ${audit.id}: ${audit.title}${detail}\n`);
    }
  }

  process.stderr.write('\n');
}

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

async function writeOutput(result, outputPath) {
  const json = JSON.stringify(result, null, 2);

  if (outputPath) {
    const { writeFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const abs = resolve(outputPath);
    await writeFile(abs, json, 'utf8');
    process.stderr.write(`Saved to ${abs}\n`);
  } else {
    process.stdout.write(json + '\n');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.url) {
    process.stderr.write(
      'Usage: node lighthouse-pull.mjs --url <URL> [--strategy mobile|desktop] [--categories seo,best-practices,...] [--output path/to/result.json]\n'
    );
    process.exit(1);
  }

  // Validate strategy
  if (!['mobile', 'desktop'].includes(args.strategy)) {
    process.stderr.write(`Error: --strategy must be "mobile" or "desktop", got "${args.strategy}"\n`);
    process.exit(1);
  }

  const apiUrl = buildApiUrl(args.url, args.strategy, args.categories);

  process.stderr.write(
    `Fetching Lighthouse results for ${args.url} [${args.strategy}] categories: ${args.categories.join(', ')} …\n`
  );

  let response;
  try {
    response = await fetchWithTimeout(apiUrl, TIMEOUT_MS);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

  if (!response.ok) {
    // Try to parse the error body for a useful message
    let body;
    try {
      body = await response.json();
    } catch {
      body = { error: { message: await response.text() } };
    }
    const msg =
      body?.error?.message ??
      body?.error?.errors?.[0]?.message ??
      `HTTP ${response.status} ${response.statusText}`;
    process.stderr.write(`PageSpeed Insights API error: ${msg}\n`);
    if (response.status === 400) {
      process.stderr.write('Hint: Check that the URL is publicly accessible and well-formed.\n');
    } else if (response.status === 429) {
      process.stderr.write(
        'Hint: Rate limited. Set PAGESPEED_API_KEY env var for a higher quota.\n'
      );
    }
    process.exit(1);
  }

  let raw;
  try {
    raw = await response.json();
  } catch (err) {
    process.stderr.write(`Failed to parse API response as JSON: ${err.message}\n`);
    process.exit(1);
  }

  let result;
  try {
    result = parseResponse(raw, args.url, args.strategy, args.categories);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  printSummary(result);
  await writeOutput(result, args.output);
}

main().catch((err) => {
  process.stderr.write(`Unexpected error: ${err.message}\n`);
  process.exit(1);
});
