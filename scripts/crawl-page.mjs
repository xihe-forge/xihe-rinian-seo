import { load } from "cheerio";
import { writeFileSync } from "fs";
import { URL } from "url";

const TIMEOUT_MS = 15_000;
const WORDS_PER_MIN = 200;

function parseArgs() {
  const args = process.argv.slice(2);
  let url = null;
  let outputPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    } else if (!url && !args[i].startsWith("--")) {
      url = args[i];
    }
  }
  return { url, outputPath };
}

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

async function fetchText(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function countWords(text) {
  const cjkPattern = /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;
  const cjkChars = (text.match(cjkPattern) || []).length;
  const latinWords = text
    .replace(cjkPattern, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return cjkChars + latinWords;
}

function isValidXml(text) {
  return text.trim().startsWith("<?xml") || text.trim().startsWith("<urlset") || text.trim().startsWith("<sitemapindex");
}

function extractMeta($, baseUrl) {
  const meta = {
    title: $("title").first().text().trim() || null,
    description: null,
    keywords: null,
    robots: null,
    viewport: null,
    canonical: null,
    og: {},
    twitter: {},
  };

  $("meta").each((_, el) => {
    const name = ($(el).attr("name") || "").toLowerCase();
    const property = ($(el).attr("property") || "").toLowerCase();
    const content = $(el).attr("content") || null;

    if (name === "description") meta.description = content;
    else if (name === "keywords") meta.keywords = content;
    else if (name === "robots") meta.robots = content;
    else if (name === "viewport") meta.viewport = content;
    else if (property.startsWith("og:")) meta.og[property.slice(3)] = content;
    else if (name.startsWith("twitter:")) meta.twitter[name.slice(8)] = content;
  });

  const canonicalEl = $('link[rel="canonical"]').first();
  if (canonicalEl.length) {
    meta.canonical = canonicalEl.attr("href") || null;
  }

  return meta;
}

function extractHeadings($) {
  const headings = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    headings.push({
      level: parseInt(el.tagName.slice(1), 10),
      text: $(el).text().trim(),
    });
  });
  return headings;
}

function extractSchema($) {
  const schemas = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = JSON.parse($(el).html());
      const items = Array.isArray(raw) ? raw : [raw];
      for (const item of items) {
        schemas.push({
          type: item["@type"] || null,
          raw: item,
        });
      }
    } catch {
      // skip malformed
    }
  });
  return schemas;
}

function extractLinks($, baseUrl) {
  const parsedBase = new URL(baseUrl);
  let internal = 0;
  let external = 0;
  const anchors = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname === parsedBase.hostname) {
        internal++;
      } else {
        external++;
      }
    } catch {
      // relative or malformed
      internal++;
    }
    if (text) anchors.push(text);
  });

  return { internal, external, anchors };
}

function extractImages($) {
  let total = 0;
  const noAltList = [];

  $("img").each((_, el) => {
    total++;
    const alt = $(el).attr("alt");
    if (alt === undefined || alt === null || alt.trim() === "") {
      noAltList.push($(el).attr("src") || "");
    }
  });

  return { total, missingAlt: noAltList.length, noAltList };
}

function extractHreflang($) {
  const tags = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    tags.push({
      lang: $(el).attr("hreflang") || "",
      href: $(el).attr("href") || "",
    });
  });
  return tags;
}

function fuzzyMatch(a, b) {
  const normalize = s => s.toLowerCase()
    .replace(/[^\w\s\u3000-\u9fff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wordsA = new Set(na.split(' '));
  const wordsB = new Set(nb.split(' '));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && intersection / union > 0.7;
}

function extractFaq($, schemas) {
  function extractFromSchema() {
    const items = [];
    for (const schema of schemas) {
      if (schema.type === "FAQPage" && Array.isArray(schema.raw.mainEntity)) {
        for (const item of schema.raw.mainEntity) {
          const q = item.name || "";
          const a =
            typeof item.acceptedAnswer === "object"
              ? item.acceptedAnswer.text || ""
              : "";
          if (q) items.push({ question: q, answer: a, source: "schema:FAQPage" });
        }
      }
      if (schema.type === "QAPage") {
        const q = schema.raw.name || schema.raw.headline || "";
        const a =
          schema.raw.acceptedAnswer?.text ||
          schema.raw.suggestedAnswer?.[0]?.text ||
          "";
        if (q) items.push({ question: q, answer: a, source: "schema:QAPage" });
      }
    }
    return items;
  }

  function extractFromHtml() {
    const items = [];

    $("details").each((_, el) => {
      const $summary = $(el).find("summary").first().clone();
      $summary.find('[aria-hidden="true"], .icon, svg').remove();
      const q = $summary.text().trim();
      const a = $(el)
        .clone()
        .find("summary")
        .remove()
        .end()
        .text()
        .trim();
      if (q) items.push({ question: q, answer: a, source: "html:details" });
    });

    const faqHeadings = ["faq", "frequently asked questions", "常见问题", "常见问题解答"];
    $("h2, h3").each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      if (faqHeadings.some((kw) => text.includes(kw))) {
        const container = $(el).parent();
        container.find("dt, .question").each((__, qEl) => {
          const q = $(qEl).text().trim();
          const a = $(qEl).next("dd, .answer").text().trim();
          if (q) items.push({ question: q, answer: a, source: "html:heading-section" });
        });
      }
    });

    return items;
  }

  const schemaFaqs = extractFromSchema();
  const htmlFaqs = extractFromHtml();

  // Deduplicate schema FAQs by exact question
  const faqs = [];
  const seenExact = new Set();
  for (const item of schemaFaqs) {
    if (!seenExact.has(item.question)) {
      seenExact.add(item.question);
      faqs.push(item);
    }
  }

  // HTML FAQs only added if no fuzzy match exists in schema set
  if (schemaFaqs.length > 0) {
    for (const item of htmlFaqs) {
      const hasFuzzyMatch = faqs.some(s => fuzzyMatch(s.question, item.question));
      if (!hasFuzzyMatch) {
        faqs.push(item);
      }
    }
  } else {
    // No schema FAQs — add HTML FAQs with dedup among themselves
    for (const item of htmlFaqs) {
      if (!seenExact.has(item.question)) {
        seenExact.add(item.question);
        faqs.push(item);
      }
    }
  }

  return faqs;
}

const AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "Google-Extended",
  "ClaudeBot",
  "PerplexityBot",
  "Bytespider",
  "CCBot",
  "Amazonbot",
];

function parseRobotsTxtForAiBots(robotsTxtContent) {
  if (!robotsTxtContent || robotsTxtContent.trim() === "") {
    return {
      parsed: false,
      aiBots: Object.fromEntries(
        AI_BOTS.map((bot) => [bot, { status: "allowed", rule: null }])
      ),
      summary: { total: AI_BOTS.length, blocked: 0, allowed: AI_BOTS.length },
    };
  }

  // Parse all user-agent sections into a map: lowercased agent -> { allow: string[], disallow: string[] }
  const sections = {};
  let currentAgents = [];

  for (const rawLine of robotsTxtContent.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim(); // strip inline comments
    if (line === "") {
      currentAgents = [];
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === "user-agent") {
      const agent = value.toLowerCase();
      if (!sections[agent]) sections[agent] = { allow: [], disallow: [] };
      currentAgents.push(agent);
    } else if (field === "disallow") {
      for (const agent of currentAgents) {
        sections[agent].disallow.push(value);
      }
    } else if (field === "allow") {
      for (const agent of currentAgents) {
        sections[agent].allow.push(value);
      }
    }
  }

  // Determine status for a given rule set
  function resolveStatus(rules) {
    if (!rules) return null; // no section found

    // Check if there's a Disallow: / (covers everything) or Disallow: (empty = allow all)
    const hasDisallowAll = rules.disallow.some((v) => v === "/");
    const hasDisallowEmpty = rules.disallow.some((v) => v === "");
    const hasAllowRoot = rules.allow.some((v) => v === "/" || v === "");

    if (hasDisallowEmpty) {
      // Empty Disallow means "allow everything"
      return { status: "allowed", rule: "Disallow:" };
    }
    if (hasDisallowAll && hasAllowRoot) {
      // Allow takes precedence over Disallow per robots.txt spec
      return { status: "allowed", rule: "Allow: /" };
    }
    if (hasDisallowAll) {
      return { status: "blocked", rule: "Disallow: /" };
    }
    if (hasAllowRoot) {
      return { status: "allowed", rule: "Allow: /" };
    }
    // Section exists but no definitive root-level rule
    return { status: "allowed", rule: null };
  }

  const wildcardRules = sections["*"] || null;
  const wildcardResult = resolveStatus(wildcardRules);

  const aiBots = {};
  for (const bot of AI_BOTS) {
    const specificRules = sections[bot.toLowerCase()] || null;
    const specificResult = resolveStatus(specificRules);

    if (specificResult !== null) {
      aiBots[bot] = specificResult;
    } else {
      // No specific section — fall back to wildcard
      if (wildcardResult !== null) {
        aiBots[bot] = {
          status: wildcardResult.status,
          rule: wildcardResult.rule,
          fallback: wildcardResult.status === "blocked"
            ? "wildcard_blocked"
            : "wildcard_allowed",
        };
      } else {
        // No wildcard either — default is allowed
        aiBots[bot] = { status: "allowed", rule: null, fallback: "default_allowed" };
      }
    }
  }

  const blockedCount = Object.values(aiBots).filter((b) => b.status === "blocked").length;

  return {
    parsed: true,
    aiBots,
    summary: {
      total: AI_BOTS.length,
      blocked: blockedCount,
      allowed: AI_BOTS.length - blockedCount,
    },
  };
}

async function crawl(rawUrl) {
  let pageRes;
  let pageText;

  try {
    pageRes = await fetchWithTimeout(rawUrl);
    pageText = await pageRes.text();
  } catch (err) {
    return {
      url: rawUrl,
      crawledAt: new Date().toISOString(),
      error: err.message || String(err),
    };
  }

  const $ = load(pageText);
  const parsedUrl = new URL(rawUrl);
  const origin = parsedUrl.origin;

  const httpHeaders = {};
  for (const [k, v] of pageRes.headers.entries()) {
    const lower = k.toLowerCase();
    if (["content-type", "x-robots-tag", "cache-control"].includes(lower)) {
      httpHeaders[lower] = v;
    }
  }

  const [llmsTxtContent, robotsTxtContent, sitemapFetch] = await Promise.all([
    fetchText(`${origin}/llms.txt`),
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/sitemap.xml`),
  ]);

  const $cleanBody = $("body").clone();
  $cleanBody.find("script, style, nav, footer, header, aside, [role=navigation]").remove();
  const bodyText = $cleanBody.text().replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const wordCount = countWords(bodyText);
  const pageSizeBytes = Buffer.byteLength(pageText, "utf8");

  const schemas = extractSchema($);

  return {
    url: rawUrl,
    crawledAt: new Date().toISOString(),
    http: {
      status: pageRes.status,
      headers: httpHeaders,
    },
    meta: extractMeta($, rawUrl),
    headings: extractHeadings($),
    schema: schemas,
    links: extractLinks($, rawUrl),
    images: extractImages($),
    hreflang: extractHreflang($),
    llmsTxt: llmsTxtContent,
    robotsTxt: robotsTxtContent,
    aiBotAccess: parseRobotsTxtForAiBots(robotsTxtContent),
    sitemap: {
      exists: sitemapFetch !== null,
      url: `${origin}/sitemap.xml`,
      valid: sitemapFetch !== null ? isValidXml(sitemapFetch) : false,
    },
    content: {
      wordCount,
      readingTimeMin: Math.ceil(wordCount / WORDS_PER_MIN),
      pageSizeBytes,
    },
    bodyText,
    faq: extractFaq($, schemas),
  };
}

async function main() {
  const { url, outputPath } = parseArgs();

  if (!url) {
    console.error("Usage: node crawl-page.mjs <url> [--output path/to/output.json]");
    process.exit(1);
  }

  const result = await crawl(url);
  const json = JSON.stringify(result, null, 2);

  if (outputPath) {
    writeFileSync(outputPath, json, "utf8");
    console.error(`Saved to ${outputPath}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
