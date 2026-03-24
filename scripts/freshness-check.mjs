#!/usr/bin/env node

import { writeFileSync } from "fs";

const TIMEOUT_MS = 10_000;
const MAX_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const argv = process.argv.slice(2);
  let url = null;
  let threshold = 90;
  let output = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) {
      url = argv[++i];
    } else if (argv[i] === "--threshold" && argv[i + 1]) {
      threshold = parseInt(argv[++i], 10);
    } else if (argv[i] === "--output" && argv[i + 1]) {
      output = argv[++i];
    }
  }

  return { url, threshold, output };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Sitemap parsing (regex, no XML parser)
// ---------------------------------------------------------------------------

function parseSitemap(xml) {
  // Try <url> entries first (standard urlset)
  const urls = [];
  const urlPattern = /<url>([\s\S]*?)<\/url>/g;
  let match;
  while ((match = urlPattern.exec(xml)) !== null) {
    const block = match[1];
    const loc = block.match(/<loc>(.*?)<\/loc>/)?.[1]?.trim();
    const lastmod = block.match(/<lastmod>(.*?)<\/lastmod>/)?.[1]?.trim();
    if (loc) urls.push({ url: loc, lastmod: lastmod || null });
  }

  if (urls.length > 0) return { urls, isIndex: false };

  // Try sitemap index
  const sitemapPattern = /<sitemap>([\s\S]*?)<\/sitemap>/g;
  const childSitemaps = [];
  while ((match = sitemapPattern.exec(xml)) !== null) {
    const loc = match[1].match(/<loc>(.*?)<\/loc>/)?.[1]?.trim();
    if (loc) childSitemaps.push(loc);
  }

  return { urls: [], isIndex: true, childSitemaps };
}

// ---------------------------------------------------------------------------
// Nav link fallback: extract internal links from homepage
// ---------------------------------------------------------------------------

function extractNavLinks(html, baseUrl) {
  const parsedBase = new URL(baseUrl);
  const seen = new Set();
  const links = [];
  const hrefPattern = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = hrefPattern.exec(html)) !== null) {
    const href = m[1];
    try {
      const resolved = new URL(href, baseUrl);
      resolved.hash = "";
      const cleanHref = resolved.href;
      if (
        resolved.hostname === parsedBase.hostname &&
        resolved.protocol.startsWith("http") &&
        !seen.has(cleanHref)
      ) {
        seen.add(cleanHref);
        links.push({ url: cleanHref, lastmod: null });
      }
    } catch {
      // skip malformed
    }
  }
  return links;
}

// ---------------------------------------------------------------------------
// Date extraction from HTML (cheerio)
// ---------------------------------------------------------------------------

async function extractPageDates(html, lastModifiedHeader) {
  const { load } = await import("cheerio");
  const $ = load(html);

  const candidates = [];

  // 1. article:modified_time
  const modifiedTime = $('meta[property="article:modified_time"]').attr("content");
  if (modifiedTime) candidates.push({ date: new Date(modifiedTime), source: "meta" });

  // 2. article:published_time
  const publishedTime = $('meta[property="article:published_time"]').attr("content");
  if (publishedTime) candidates.push({ date: new Date(publishedTime), source: "meta" });

  // 3. JSON-LD schema: dateModified, datePublished
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = JSON.parse($(el).html());
      const items = Array.isArray(raw) ? raw : [raw];
      for (const item of items) {
        if (item.dateModified) candidates.push({ date: new Date(item.dateModified), source: "schema" });
        if (item.datePublished) candidates.push({ date: new Date(item.datePublished), source: "schema" });
      }
    } catch {
      // skip malformed JSON-LD
    }
  });

  // 4. <time datetime="...">
  $("time[datetime]").each((_, el) => {
    const dt = $(el).attr("datetime");
    if (dt) candidates.push({ date: new Date(dt), source: "meta" });
  });

  // 5. Last-Modified HTTP header fallback
  if (lastModifiedHeader) {
    candidates.push({ date: new Date(lastModifiedHeader), source: "header" });
  }

  // Filter valid dates and pick most recent
  const valid = candidates.filter((c) => c.date instanceof Date && !isNaN(c.date.getTime()));
  if (valid.length === 0) return { date: null, source: "unknown" };

  valid.sort((a, b) => b.date - a.date);
  return { date: valid[0].date, source: valid[0].source };
}

// ---------------------------------------------------------------------------
// Semaphore for concurrency limiting
// ---------------------------------------------------------------------------

function createSemaphore(max) {
  let count = 0;
  const queue = [];

  function acquire() {
    return new Promise((resolve) => {
      if (count < max) {
        count++;
        resolve();
      } else {
        queue.push(resolve);
      }
    });
  }

  function release() {
    count--;
    if (queue.length > 0) {
      count++;
      queue.shift()();
    }
  }

  return { acquire, release };
}

// ---------------------------------------------------------------------------
// Check a single page
// ---------------------------------------------------------------------------

async function checkPage(entry, semaphore) {
  await semaphore.acquire();
  try {
    const { url, lastmod } = entry;
    let lastModifiedHeader = null;
    let html = null;
    let httpStatus = null;
    let fetchError = null;

    // Try HEAD first for Last-Modified header
    try {
      const headRes = await fetchWithTimeout(url, { method: "HEAD" });
      httpStatus = headRes.status;
      lastModifiedHeader = headRes.headers.get("last-modified") || null;
    } catch (err) {
      fetchError = err.name === "AbortError" ? "timeout" : err.message;
    }

    // If HEAD succeeded and we need page content, do GET
    if (httpStatus && httpStatus >= 200 && httpStatus < 300) {
      try {
        const getRes = await fetchWithTimeout(url);
        if (getRes.ok) {
          html = await getRes.text();
          if (!lastModifiedHeader) {
            lastModifiedHeader = getRes.headers.get("last-modified") || null;
          }
        }
      } catch {
        // GET failed — we still have HEAD info
      }
    } else if (!httpStatus || httpStatus < 200 || httpStatus >= 300) {
      // HEAD failed entirely OR returned any non-2xx — try GET
      try {
        const getRes = await fetchWithTimeout(url);
        httpStatus = getRes.status;
        if (getRes.ok) {
          html = await getRes.text();
          lastModifiedHeader = getRes.headers.get("last-modified") || null;
        }
      } catch (err) {
        fetchError = err.name === "AbortError" ? "timeout" : err.message;
      }
    }

    // Handle non-2xx or errors
    if (fetchError || (httpStatus && (httpStatus < 200 || httpStatus >= 400))) {
      return {
        url,
        lastModified: null,
        source: "unknown",
        daysSinceUpdate: null,
        status: "error",
        httpStatus: httpStatus || null,
        error: fetchError || `HTTP ${httpStatus}`,
        suggestion: null,
      };
    }

    // Determine best date
    let bestDate = null;
    let bestSource = "unknown";

    // Priority: sitemap lastmod first (it's explicitly set by the site owner)
    if (lastmod) {
      const d = new Date(lastmod);
      if (!isNaN(d.getTime())) {
        bestDate = d;
        bestSource = "sitemap";
      }
    }

    // If HTML available, extract page-level dates and compare
    if (html) {
      const pageResult = await extractPageDates(html, lastModifiedHeader);
      if (pageResult.date) {
        if (!bestDate || pageResult.date > bestDate) {
          bestDate = pageResult.date;
          bestSource = pageResult.source;
        }
      }
    } else if (lastModifiedHeader && !bestDate) {
      const d = new Date(lastModifiedHeader);
      if (!isNaN(d.getTime())) {
        bestDate = d;
        bestSource = "header";
      }
    }

    return {
      url,
      lastModified: bestDate ? bestDate.toISOString() : null,
      source: bestSource,
      daysSinceUpdate: null, // filled in after
      status: null,          // filled in after
      httpStatus,
      suggestion: null,      // filled in after
    };
  } finally {
    semaphore.release();
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function classifyPage(page, threshold, checkedAt) {
  if (page.status === "error") return page;

  const now = new Date(checkedAt);

  if (!page.lastModified) {
    return {
      ...page,
      daysSinceUpdate: null,
      status: "unknown",
      suggestion: "No date signals found — add article:modified_time meta tag",
    };
  }

  const days = Math.floor((now - new Date(page.lastModified)) / (1000 * 60 * 60 * 24));
  const status = days > threshold ? "stale" : "fresh";
  const suggestion =
    status === "stale"
      ? `Update this page — ${days} days old, AI engines may deprioritize`
      : null;

  return { ...page, daysSinceUpdate: days, status, suggestion };
}

function computeScore(pages) {
  const classified = pages.filter((p) => p.status !== "error");
  if (classified.length === 0) return 0;
  const fresh = classified.filter((p) => p.status === "fresh").length;
  return Math.round((fresh / classified.length) * 100);
}

function buildTopActions(pages, threshold) {
  const actions = [];
  const stale = pages.filter((p) => p.status === "stale");
  const unknown = pages.filter((p) => p.status === "unknown");
  const errors = pages.filter((p) => p.status === "error");

  if (stale.length > 0) {
    actions.push(
      `${stale.length} page${stale.length > 1 ? "s are" : " is"} stale (>${threshold} days) — update content or add recent information`
    );
  }
  if (unknown.length > 0) {
    actions.push(
      `${unknown.length} page${unknown.length > 1 ? "s have" : " has"} no date signals — add article:modified_time meta tag`
    );
  }
  if (errors.length > 0) {
    actions.push(
      `${errors.length} page${errors.length > 1 ? "s" : ""} could not be fetched — check for broken links or server errors`
    );
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { url: rawUrl, threshold, output } = parseArgs();

  if (!rawUrl) {
    process.stderr.write(
      `Usage: node scripts/freshness-check.mjs --url <url> [--threshold <days>] [--output <file>]\n\n` +
      `  --url        Base URL of the site to check (required)\n` +
      `  --threshold  Days since last update to flag as stale (default: 90)\n` +
      `  --output     Write JSON to file instead of stdout\n`
    );
    process.exit(1);
  }

  // Normalise base URL
  let baseUrl;
  try {
    baseUrl = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
  } catch {
    process.stderr.write(`Invalid URL: ${rawUrl}\n`);
    process.exit(1);
  }

  const domain = baseUrl.hostname;
  const checkedAt = new Date().toISOString();

  process.stderr.write(`Freshness check: ${baseUrl.href}\n`);
  process.stderr.write(`Threshold: ${threshold} days\n\n`);

  // Step 1: Fetch sitemap
  let urlEntries = [];
  const sitemapUrl = `${baseUrl.origin}/sitemap.xml`;

  process.stderr.write(`Fetching sitemap: ${sitemapUrl} ... `);
  try {
    const sitemapRes = await fetchWithTimeout(sitemapUrl);
    if (sitemapRes.ok) {
      const xml = await sitemapRes.text();
      const parsed = parseSitemap(xml);
      if (parsed.isIndex && parsed.childSitemaps.length > 0) {
        process.stderr.write(`sitemap index with ${parsed.childSitemaps.length} child sitemaps — fetching...\n`);
        const childSem = createSemaphore(MAX_CONCURRENCY);
        const childResults = await Promise.all(
          parsed.childSitemaps.map((childUrl) =>
            childSem.acquire().then(async () => {
              try {
                process.stderr.write(`  Fetching child sitemap: ${childUrl} ... `);
                const childRes = await fetchWithTimeout(childUrl);
                if (childRes.ok) {
                  const childXml = await childRes.text();
                  const childParsed = parseSitemap(childXml);
                  process.stderr.write(`${childParsed.urls.length} URLs\n`);
                  return childParsed.urls;
                } else {
                  process.stderr.write(`${childRes.status} — skipped\n`);
                  return [];
                }
              } catch (err) {
                process.stderr.write(`failed (${err.message}) — skipped\n`);
                return [];
              } finally {
                childSem.release();
              }
            })
          )
        );
        urlEntries = childResults.flat();
        process.stderr.write(`Total URLs from sitemap index: ${urlEntries.length}\n`);
      } else {
        urlEntries = parsed.urls;
        process.stderr.write(`${urlEntries.length} URLs found\n`);
      }
    } else {
      process.stderr.write(`${sitemapRes.status} — falling back to nav link crawl\n`);
    }
  } catch (err) {
    process.stderr.write(`failed (${err.message}) — falling back to nav link crawl\n`);
  }

  // Fallback: crawl nav links from homepage
  if (urlEntries.length === 0) {
    process.stderr.write(`Crawling homepage for nav links: ${baseUrl.href} ... `);
    try {
      const homeRes = await fetchWithTimeout(baseUrl.href);
      if (homeRes.ok) {
        const html = await homeRes.text();
        urlEntries = extractNavLinks(html, baseUrl.href);
        // Always include the homepage itself
        if (!urlEntries.some((e) => e.url === baseUrl.href)) {
          urlEntries.unshift({ url: baseUrl.href, lastmod: null });
        }
        process.stderr.write(`${urlEntries.length} links found\n`);
      } else {
        process.stderr.write(`${homeRes.status}\n`);
      }
    } catch (err) {
      process.stderr.write(`failed (${err.message})\n`);
    }
  }

  if (urlEntries.length === 0) {
    process.stderr.write("No pages to check.\n");
    process.exit(1);
  }

  process.stderr.write(`\nChecking ${urlEntries.length} pages (concurrency: ${MAX_CONCURRENCY})...\n`);

  // Step 2: Check each page
  const semaphore = createSemaphore(MAX_CONCURRENCY);

  const rawPages = await Promise.all(
    urlEntries.map((entry) => {
      return checkPage(entry, semaphore).then((result) => {
        const icon = result.status === "error" ? "!" : result.lastModified ? "." : "?";
        process.stderr.write(icon);
        return result;
      });
    })
  );
  process.stderr.write("\n");

  // Step 3: Classify and score
  const pages = rawPages.map((p) => classifyPage(p, threshold, checkedAt));

  const freshPages = pages.filter((p) => p.status === "fresh");
  const stalePages = pages.filter((p) => p.status === "stale");
  const unknownPages = pages.filter((p) => p.status === "unknown");
  const errorPages = pages.filter((p) => p.status === "error");

  const daysKnown = pages.filter((p) => typeof p.daysSinceUpdate === "number");
  const avgDays =
    daysKnown.length > 0
      ? Math.round(daysKnown.reduce((sum, p) => sum + p.daysSinceUpdate, 0) / daysKnown.length)
      : null;

  const oldestPage =
    daysKnown.length > 0
      ? daysKnown.reduce((max, p) => (p.daysSinceUpdate > max.daysSinceUpdate ? p : max))
      : null;

  const overallScore = computeScore(pages);
  const topActions = buildTopActions(pages, threshold);

  const result = {
    domain,
    checkedAt,
    threshold,
    overallScore,
    summary: {
      totalPages: pages.length,
      freshPages: freshPages.length,
      stalePages: stalePages.length,
      unknownPages: unknownPages.length,
      errorPages: errorPages.length,
      avgDaysSinceUpdate: avgDays,
      oldestPage: oldestPage
        ? { url: oldestPage.url, daysSinceUpdate: oldestPage.daysSinceUpdate }
        : null,
    },
    pages: pages.map(({ httpStatus, ...rest }) => rest), // strip internal httpStatus from output
    topActions,
  };

  // Human-readable summary to stderr
  process.stderr.write(`\n--- Summary ---\n`);
  process.stderr.write(`Score:         ${overallScore}/100\n`);
  process.stderr.write(`Total pages:   ${pages.length}\n`);
  process.stderr.write(`Fresh:         ${freshPages.length}\n`);
  process.stderr.write(`Stale:         ${stalePages.length}\n`);
  process.stderr.write(`Unknown:       ${unknownPages.length}\n`);
  process.stderr.write(`Errors:        ${errorPages.length}\n`);
  if (avgDays !== null) process.stderr.write(`Avg age:       ${avgDays} days\n`);
  if (oldestPage) process.stderr.write(`Oldest page:   ${oldestPage.url} (${oldestPage.daysSinceUpdate} days)\n`);
  if (topActions.length > 0) {
    process.stderr.write(`\nTop actions:\n`);
    for (const action of topActions) {
      process.stderr.write(`  - ${action}\n`);
    }
  }
  process.stderr.write("\n");

  const json = JSON.stringify(result, null, 2);

  if (output) {
    writeFileSync(output, json, "utf8");
    process.stderr.write(`Results written to ${output}\n`);
  } else {
    process.stdout.write(json + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
