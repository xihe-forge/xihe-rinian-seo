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

function extractFaq($, schemas) {
  const faqs = [];
  const seen = new Set();

  for (const schema of schemas) {
    if (schema.type === "FAQPage" && Array.isArray(schema.raw.mainEntity)) {
      for (const item of schema.raw.mainEntity) {
        const q = item.name || "";
        const a =
          typeof item.acceptedAnswer === "object"
            ? item.acceptedAnswer.text || ""
            : "";
        if (q && !seen.has(q)) {
          seen.add(q);
          faqs.push({ question: q, answer: a });
        }
      }
    }
    if (schema.type === "QAPage") {
      const q = schema.raw.name || schema.raw.headline || "";
      const a =
        schema.raw.acceptedAnswer?.text ||
        schema.raw.suggestedAnswer?.[0]?.text ||
        "";
      if (q && !seen.has(q)) {
        seen.add(q);
        faqs.push({ question: q, answer: a });
      }
    }
  }

  $("details").each((_, el) => {
    const q = $(el).find("summary").first().text().trim();
    const a = $(el)
      .clone()
      .find("summary")
      .remove()
      .end()
      .text()
      .trim();
    if (q && !seen.has(q)) {
      seen.add(q);
      faqs.push({ question: q, answer: a });
    }
  });

  const faqHeadings = ["faq", "frequently asked questions", "常见问题", "常见问题解答"];
  $("h2, h3").each((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (faqHeadings.some((kw) => text.includes(kw))) {
      const container = $(el).parent();
      container.find("dt, .question").each((__, qEl) => {
        const q = $(qEl).text().trim();
        const a = $(qEl).next("dd, .answer").text().trim();
        if (q && !seen.has(q)) {
          seen.add(q);
          faqs.push({ question: q, answer: a });
        }
      });
    }
  });

  return faqs;
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

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
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
