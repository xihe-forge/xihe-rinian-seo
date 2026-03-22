#!/usr/bin/env node
// content-optimize.mjs
// Analyzes crawl-page.mjs JSON output and produces GEO optimization suggestions
// based on Princeton GEO paper quantified findings.
//
// Usage:
//   node scripts/content-optimize.mjs --input data/crawl-result.json [--output suggestions.json]
//   node scripts/crawl-page.mjs https://example.com | node scripts/content-optimize.mjs
//   node scripts/content-optimize.mjs --url https://example.com [--output suggestions.json]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let inputPath = null;
  let outputPath = null;
  let url = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      inputPath = args[++i];
    } else if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    } else if (args[i] === "--url" && args[i + 1]) {
      url = args[++i];
    }
  }

  return { inputPath, outputPath, url };
}

// ---------------------------------------------------------------------------
// HTTP helpers (used when --url is provided)
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 15_000;

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
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Collapse excessive whitespace for cleaner pattern matching.
 */
function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

/**
 * Count CJK characters + Latin words.
 */
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

/**
 * Split text into sentences (simple heuristic, handles CJK sentence-enders too).
 */
function splitSentences(text) {
  return text
    .split(/[.!?。！？]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Analysis: Quotations (+42% visibility)
// ---------------------------------------------------------------------------

const QUOTE_PATTERNS = [
  /[""][^""]{4,}[""]/g,                     // English curly quotes
  /"[^"]{4,}"/g,                             // English straight quotes
  /「[^」]{2,}」/g,                           // Japanese/Chinese 「」
  /『[^』]{2,}』/g,                           // Japanese/Chinese 『』
  /«[^»]{4,}»/g,                             // French guillemets
  /‹[^›]{4,}›/g,                             // Single guillemets
];

function analyzeQuotations(allText, crawlData) {
  const findings = [];
  let quotationCount = 0;

  for (const pattern of QUOTE_PATTERNS) {
    const matches = allText.match(pattern) || [];
    quotationCount += matches.length;
  }

  // Count blockquote elements if HTML info is embedded (future-proof)
  const blockquoteCount = crawlData._blockquoteCount || 0;
  if (blockquoteCount > 0) {
    findings.push(`Found ${blockquoteCount} <blockquote> element(s)`);
  }
  if (quotationCount > 0) {
    findings.push(`Found ${quotationCount} quoted phrase(s) in content`);
  }

  let score;
  const suggestions = [];

  if (quotationCount + blockquoteCount >= 3) {
    score = 9;
    findings.push("Good quote density — AI systems can extract authoritative statements");
  } else if (quotationCount + blockquoteCount >= 1) {
    score = 5;
    suggestions.push("Add 2–3 more expert quotes with clear attribution (e.g., 'According to Dr. X, \"...\"')");
    suggestions.push("Wrap key statements in blockquote elements for semantic clarity");
  } else {
    score = 0;
    suggestions.push("No quotes detected — add expert quotes with full attribution (+42% AI visibility boost)");
    suggestions.push("Include at least one blockquote with a named source");
    suggestions.push("Quote industry reports or studies using exact pulled phrases");
  }

  return {
    name: "quotations",
    label: "Expert Quotes & Citations",
    score,
    maxScore: 10,
    impactLevel: "critical",
    expectedBoost: "+42%",
    findings,
    suggestions,
    _counts: { quotationCount, blockquoteCount },
  };
}

// ---------------------------------------------------------------------------
// Analysis: Statistics / Numbers (+33% visibility)
// ---------------------------------------------------------------------------

const STAT_PATTERNS = [
  /\d+(\.\d+)?%/g,                                 // percentages: 47%, 3.5%
  /\$[\d,]+(\.\d+)?[KMBTkmbt]?/g,                 // dollar amounts: $5B, $1,200
  /[\d,]+(\.\d+)?\s*[KMBTkmbt]\s*(users?|downloads?|views?|records?|customers?)/gi, // 10M users
  /\b\d{4}\b(?!\s*[-–]\s*\d{4}\b)/g,              // standalone years used as data points
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(times?|x|fold)/gi, // multipliers
  /\b\d+\s*(ms|milliseconds?|seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/gi, // time measurements
  /\b(increased?|decreased?|grew?|reduced?|improved?)\s+(by\s+)?\d+/gi,  // growth figures
];

function analyzeStatistics(allText) {
  const findings = [];
  let statisticCount = 0;
  const seenMatches = new Set();

  for (const pattern of STAT_PATTERNS) {
    let matches = allText.match(pattern) || [];
    // Filter out standalone years (1900-2099) that aren't in a data context
    matches = matches.filter(m => {
      const yearMatch = m.match(/^\d{4}$/);
      if (!yearMatch) return true;
      const year = parseInt(yearMatch[0]);
      return year < 1900 || year > 2099;
    });
    for (const m of matches) {
      if (!seenMatches.has(m)) {
        seenMatches.add(m);
        statisticCount++;
      }
    }
  }

  let score;
  const suggestions = [];

  if (statisticCount >= 8) {
    score = 9;
    findings.push(`Found ${statisticCount} statistical data points — strong evidence density`);
  } else if (statisticCount >= 4) {
    score = 6;
    findings.push(`Found ${statisticCount} statistical data points`);
    suggestions.push("Add more specific numbers — aim for 8+ data points per page (+33% AI visibility)");
  } else if (statisticCount >= 1) {
    score = 3;
    findings.push(`Only ${statisticCount} statistical data point(s) found`);
    suggestions.push("Add specific statistics with percentages, counts, or monetary figures");
    suggestions.push("Include benchmark data or research findings with exact numbers");
    suggestions.push("Replace vague qualifiers ('many', 'most', 'several') with precise figures");
  } else {
    score = 0;
    findings.push("No statistical data detected");
    suggestions.push("Add at least 5 statistical data points — percentages, user counts, benchmark figures (+33% AI visibility)");
    suggestions.push("Include industry statistics or original data with proper sourcing");
    suggestions.push("Quantify claims: instead of 'fast', write '< 200ms response time'");
  }

  return {
    name: "statistics",
    label: "Data & Statistics",
    score,
    maxScore: 10,
    impactLevel: "critical",
    expectedBoost: "+33%",
    findings,
    suggestions,
    _counts: { statisticCount },
  };
}

// ---------------------------------------------------------------------------
// Analysis: Source Citations (+30% visibility)
// ---------------------------------------------------------------------------

const AUTHORITATIVE_TLDS = [".edu", ".gov", ".ac.uk", ".ac.jp"];
const AUTHORITATIVE_DOMAINS = [
  "who.int", "cdc.gov", "nih.gov", "ieee.org", "acm.org", "nature.com",
  "sciencedirect.com", "pubmed.ncbi.nlm.nih.gov", "arxiv.org", "jstor.org",
  "springer.com", "wiley.com", "tandfonline.com",
];

const CITATION_PHRASES = [
  /according to/i,
  /research (shows?|finds?|suggests?|indicates?)/i,
  /study (shows?|finds?|suggests?|indicates?)/i,
  /source:/i,
  /cited? (in|from|by)/i,
  /as (reported|noted|stated) (in|by)/i,
  /data from/i,
  /published (in|by)/i,
  /via\s+[A-Z]/,
  /根据/,
  /研究(表明|显示|发现)/,
  /来源：/,
  /数据来自/,
];

function analyzeSourceCitations(allText, links) {
  const findings = [];
  const suggestions = [];
  let citationCount = 0;

  // Check external links for authoritative domains
  let authoritativeLinks = 0;
  const externalLinkCount = links?.external || 0;

  // We don't have full anchor href data from crawl JSON, only counts
  // Use citation phrase patterns in text instead
  for (const pattern of CITATION_PHRASES) {
    const matches = allText.match(pattern);
    if (matches) citationCount++;
  }

  // Rough heuristic: external links suggest citations exist
  if (externalLinkCount > 0) {
    findings.push(`${externalLinkCount} external link(s) found — potential source citations`);
    authoritativeLinks = Math.min(Math.floor(externalLinkCount / 3), 3); // conservative estimate
  }

  let score;

  const totalSignals = citationCount + authoritativeLinks;

  if (totalSignals >= 5) {
    score = 9;
    findings.push(`${citationCount} citation phrase(s) detected in text`);
    findings.push("Strong sourcing signals — content appears well-cited");
  } else if (totalSignals >= 2) {
    score = 5;
    findings.push(`${citationCount} citation phrase(s) detected in text`);
    suggestions.push("Add links to .edu or .gov sources for authority signals");
    suggestions.push("Use explicit attribution phrases like 'According to [Source]'");
  } else {
    score = 1;
    findings.push("Few or no source citation signals found");
    suggestions.push("Add external links to authoritative sources: .edu, .gov, WHO, IEEE, peer-reviewed journals (+30% AI visibility)");
    suggestions.push("Use explicit attribution phrases ('According to Stanford research...', 'Per WHO data...')");
    suggestions.push("Add a 'References' or 'Sources' section at the bottom of the page");
  }

  return {
    name: "citations",
    label: "Source Citations",
    score,
    maxScore: 10,
    impactLevel: "critical",
    expectedBoost: "+30%",
    findings,
    suggestions,
    _counts: { citationCount, externalLinkCount },
  };
}

// ---------------------------------------------------------------------------
// Analysis: Technical Terms (+12% visibility)
// ---------------------------------------------------------------------------

// Generic filler words to flag
const VAGUE_TERMS = [
  "things", "stuff", "very", "really", "quite", "basically", "generally",
  "a lot of", "many", "most", "several", "some", "various", "different",
  "good", "bad", "nice", "big", "small", "fast", "slow",
  "东西", "很多", "一些", "各种", "比较", "非常",
];

// Indicators of technical specificity
const TECHNICAL_INDICATORS = [
  /\b[A-Z]{2,}(?:-[A-Z0-9]+)?\b/g,          // acronyms: API, REST, GEO
  /\b\w+\.(js|ts|py|go|rs|java|rb|php)\b/gi, // file extensions as tech terms
  /\b(algorithm|architecture|infrastructure|framework|protocol|interface|implementation|integration)\b/gi,
  /\b(latency|throughput|bandwidth|scalability|reliability|availability|redundancy)\b/gi,
  /\b(regex|boolean|string|integer|array|object|function|class|module|package)\b/gi,
  /[\u4e00-\u9fff]{2,}(?:技术|算法|架构|协议|框架|接口|实现|集成|系统|平台)/g,
];

function analyzeTechnicalTerms(allText) {
  const findings = [];
  const suggestions = [];

  let technicalCount = 0;
  for (const pattern of TECHNICAL_INDICATORS) {
    const matches = allText.match(pattern) || [];
    technicalCount += matches.length;
  }

  // Count vague terms
  let vagueCount = 0;
  const foundVague = [];
  for (const term of VAGUE_TERMS) {
    // If term contains CJK characters, don't use \b (it doesn't work for CJK)
    const hasCJK = /[\u3000-\u9fff\uf900-\ufaff]/.test(term);
    const pattern = hasCJK ? new RegExp(term, "gi") : new RegExp(`\\b${term}\\b`, "gi");
    const matches = allText.match(pattern) || [];
    if (matches.length > 0) {
      vagueCount += matches.length;
      if (foundVague.length < 5) foundVague.push(`"${term}" (${matches.length}x)`);
    }
  }

  const wordCount = countWords(allText);
  const technicalDensity = wordCount > 0 ? technicalCount / wordCount : 0;

  let score;

  if (technicalDensity > 0.05 && vagueCount < 10) {
    score = 8;
    findings.push(`Technical term density: ${(technicalDensity * 100).toFixed(1)}% — domain-specific language present`);
  } else if (technicalDensity > 0.02) {
    score = 5;
    findings.push(`Technical term density: ${(technicalDensity * 100).toFixed(1)}%`);
    if (vagueCount > 0) {
      findings.push(`${vagueCount} vague/generic term(s) detected: ${foundVague.join(", ")}`);
      suggestions.push("Replace generic terms with domain-specific vocabulary");
    }
    suggestions.push("Increase use of precise technical terminology appropriate to your domain (+12% AI visibility)");
  } else {
    score = 2;
    findings.push(`Low technical term density: ${(technicalDensity * 100).toFixed(1)}%`);
    if (vagueCount > 0) {
      findings.push(`${vagueCount} vague/generic term(s): ${foundVague.join(", ")}`);
    }
    suggestions.push("Use precise, domain-specific terms throughout the content (+12% AI visibility boost)");
    suggestions.push("Replace vague qualifiers with specific technical descriptors");
    suggestions.push("Include industry-standard terminology, acronyms, and proper nouns");
  }

  return {
    name: "technicalTerms",
    label: "Technical Term Density",
    score,
    maxScore: 10,
    impactLevel: "low",
    expectedBoost: "+12%",
    findings,
    suggestions,
    _counts: { technicalCount, vagueCount, technicalDensity: parseFloat(technicalDensity.toFixed(4)) },
  };
}

// ---------------------------------------------------------------------------
// Analysis: Content Structure
// ---------------------------------------------------------------------------

function analyzeContentStructure(headings, faq, allText) {
  const findings = [];
  const suggestions = [];

  // Heading hierarchy check
  const headingCount = headings.length;
  let h1Count = 0;
  let h2Count = 0;
  let h3Count = 0;
  let hierarchyIssues = 0;

  for (const h of headings) {
    if (h.level === 1) h1Count++;
    if (h.level === 2) h2Count++;
    if (h.level === 3) h3Count++;
  }

  // Check for heading level skips
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level - headings[i - 1].level > 1) {
      hierarchyIssues++;
    }
  }

  if (h1Count === 0) {
    findings.push("No H1 heading found");
    suggestions.push("Add a single H1 heading that clearly states the page's primary topic");
  } else if (h1Count > 1) {
    findings.push(`${h1Count} H1 headings found — only one is recommended`);
    suggestions.push("Consolidate to a single H1; use H2s for major sections");
  } else {
    findings.push("H1 heading present");
  }

  if (hierarchyIssues > 0) {
    findings.push(`${hierarchyIssues} heading hierarchy gap(s) detected (e.g., H1 → H3 without H2)`);
    suggestions.push("Fix heading hierarchy — AI systems use headings as document outline signals");
  }

  findings.push(`${headingCount} total headings (H1: ${h1Count}, H2: ${h2Count}, H3: ${h3Count})`);

  // Paragraph length check
  const paragraphs = allText.split(/\n\n+/).filter((p) => p.trim().length > 30);
  let longParagraphs = 0;
  let totalSentences = 0;

  for (const p of paragraphs) {
    const sentences = splitSentences(p);
    totalSentences += sentences.length;
    if (sentences.length > 5) longParagraphs++;
  }

  const paragraphAvgSentences = paragraphs.length > 0
    ? parseFloat((totalSentences / paragraphs.length).toFixed(1))
    : 0;

  if (longParagraphs > 0) {
    findings.push(`${longParagraphs} paragraph(s) exceed 5 sentences — may hinder AI extraction`);
    suggestions.push("Break long paragraphs into 2–4 sentence chunks for easier AI extraction");
  }

  // FAQ check
  const faqCount = faq.length;
  if (faqCount === 0) {
    suggestions.push("Add an FAQ section with 3–5 questions — FAQ schema significantly boosts AI snippet selection");
  } else {
    findings.push(`${faqCount} FAQ item(s) found`);
  }

  // Lists/tables signal (heuristic: look for list-like patterns in text)
  const hasBulletContent = /^\s*[-•*]\s+.{10,}/m.test(allText) || /^\s*\d+\.\s+.{10,}/m.test(allText);
  if (!hasBulletContent) {
    suggestions.push("Add bulleted or numbered lists — AI systems frequently extract list content for featured snippets");
  }

  let score;
  const issueCount = suggestions.length;

  if (issueCount === 0) {
    score = 9;
  } else if (issueCount <= 2) {
    score = 6;
  } else if (issueCount <= 4) {
    score = 4;
  } else {
    score = 2;
  }

  return {
    name: "structure",
    label: "Content Structure",
    score,
    maxScore: 10,
    impactLevel: "high",
    expectedBoost: "variable",
    findings,
    suggestions,
    _counts: { headingCount, h1Count, h2Count, h3Count, faqCount, paragraphAvgSentences },
  };
}

// ---------------------------------------------------------------------------
// Analysis: Answer Density
// ---------------------------------------------------------------------------

// Patterns that signal a direct, definitive answer
const DIRECT_ANSWER_PATTERNS = [
  /^(yes|no)[,.]?\s/i,
  /^(the|a|an)\s+\w+\s+(is|are|was|were|can|will|does|do)\b/i,
  /\bis\s+(defined|described|characterized|known)\s+as\b/i,
  /\b(means?|refers?\s+to|stands?\s+for)\b/i,
  /\bthe\s+(answer|solution|key|main|primary|best)\s+(is|involves?|requires?)\b/i,
  /\b(首先|其次|最后|总之|综上|因此|所以|这意味着)\b/,
  /^[\u4e00-\u9fff]+(是|指|为|即)/,
];

// Filler / fluff patterns
const FILLER_PATTERNS = [
  /\bin (today's|this day and age|the modern)\s+(world|era|landscape|environment)/i,
  /\b(needless to say|it goes without saying|as we all know|it is (worth|important) (noting|mentioning))/i,
  /\bin (conclusion|summary|closing), (it is|we can|let's|we've)\b/i,
  /\b(very|really|quite|extremely|absolutely|certainly|definitely)\s+(important|essential|crucial|vital)\b/i,
  /在(如今|当今|现代)(社会|时代|世界|环境)中/,
];

function analyzeAnswerDensity(allText) {
  const findings = [];
  const suggestions = [];

  const sentences = splitSentences(allText);
  if (sentences.length === 0) {
    return {
      name: "answerDensity",
      label: "Answer Density",
      score: 0,
      maxScore: 10,
      impactLevel: "high",
      expectedBoost: "variable",
      findings: ["No extractable sentences found"],
      suggestions: ["Add substantive content with direct answers"],
      _counts: { totalSentences: 0, directAnswerCount: 0, fillerCount: 0 },
    };
  }

  let directAnswerCount = 0;
  let fillerCount = 0;

  for (const sentence of sentences) {
    const s = sentence.trim();
    for (const pattern of DIRECT_ANSWER_PATTERNS) {
      if (pattern.test(s)) {
        directAnswerCount++;
        break;
      }
    }
    for (const pattern of FILLER_PATTERNS) {
      if (pattern.test(s)) {
        fillerCount++;
        break;
      }
    }
  }

  const totalSentences = sentences.length;
  const directRatio = totalSentences > 0 ? directAnswerCount / totalSentences : 0;

  findings.push(`${totalSentences} total sentences, ${directAnswerCount} appear to be direct-answer sentences`);
  findings.push(`Direct answer ratio: ${(directRatio * 100).toFixed(1)}%`);

  if (fillerCount > 0) {
    findings.push(`${fillerCount} filler/fluff sentence(s) detected`);
    suggestions.push(`Remove or rewrite ${fillerCount} filler sentence(s) that add no informational value`);
  }

  let score;

  if (directRatio >= 0.3 && fillerCount <= 2) {
    score = 8;
    findings.push("Good answer density — content is direct and informative");
  } else if (directRatio >= 0.15) {
    score = 5;
    suggestions.push("Increase direct-answer sentences — start more sentences with definitive statements");
    suggestions.push("Open paragraphs with the answer, then provide supporting context");
  } else {
    score = 2;
    suggestions.push("Low answer density — rewrite content to front-load answers before explanations");
    suggestions.push("Use the 'inverted pyramid' structure: answer first, details after");
    suggestions.push("Eliminate preamble — AI extractors prefer content that answers immediately");
  }

  return {
    name: "answerDensity",
    label: "Answer Density",
    score,
    maxScore: 10,
    impactLevel: "high",
    expectedBoost: "variable",
    findings,
    suggestions,
    _counts: { totalSentences, directAnswerCount, fillerCount, directRatio: parseFloat(directRatio.toFixed(4)) },
  };
}

// ---------------------------------------------------------------------------
// Build consolidated text from crawl JSON
// ---------------------------------------------------------------------------

function buildTextFromCrawlData(crawlData) {
  const parts = [];

  if (crawlData.meta?.title) parts.push(crawlData.meta.title);
  if (crawlData.meta?.description) parts.push(crawlData.meta.description);

  if (Array.isArray(crawlData.headings)) {
    for (const h of crawlData.headings) {
      if (h.text) parts.push(h.text);
    }
  }

  if (Array.isArray(crawlData.faq)) {
    for (const item of crawlData.faq) {
      if (item.question) parts.push(item.question);
      if (item.answer) parts.push(item.answer);
    }
  }

  // Schema text
  if (Array.isArray(crawlData.schema)) {
    for (const s of crawlData.schema) {
      const raw = s.raw || {};
      if (raw.description) parts.push(raw.description);
      if (raw.name) parts.push(raw.name);
      if (raw.headline) parts.push(raw.headline);
    }
  }

  // Links anchor text
  if (Array.isArray(crawlData.links?.anchors)) {
    parts.push(crawlData.links.anchors.join(" "));
  }

  // Raw body text if present (from direct --url fetch path)
  if (crawlData._bodyText) parts.push(crawlData._bodyText);

  return normalizeText(parts.join(" "));
}

// ---------------------------------------------------------------------------
// Direct URL fetch + cheerio parse
// ---------------------------------------------------------------------------

async function crawlAndEnrich(url) {
  process.stderr.write(`Fetching ${url} ...\n`);

  let pageText;
  let pageRes;
  try {
    pageRes = await fetchWithTimeout(url);
    pageText = await pageRes.text();
  } catch (err) {
    process.stderr.write(`Failed to fetch URL: ${err.message}\n`);
    process.exit(1);
  }

  // Dynamic cheerio import — only loads when --url path is used
  let load;
  try {
    ({ load } = await import("cheerio"));
  } catch {
    process.stderr.write("Error: --url mode requires cheerio. Run: npm install cheerio\n");
    process.exit(1);
  }
  const $ = load(pageText);

  // Remove non-content elements
  $("script, style, nav, footer, header, aside, [role=navigation]").remove();

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const blockquoteCount = $("blockquote").length;

  const headings = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    headings.push({ level: parseInt(el.tagName.slice(1), 10), text: $(el).text().trim() });
  });

  const schemas = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = JSON.parse($(el).html());
      const items = Array.isArray(raw) ? raw : [raw];
      for (const item of items) schemas.push({ type: item["@type"] || null, raw: item });
    } catch { /* skip */ }
  });

  const faq = [];
  for (const schema of schemas) {
    if (schema.type === "FAQPage" && Array.isArray(schema.raw.mainEntity)) {
      for (const item of schema.raw.mainEntity) {
        faq.push({
          question: item.name || "",
          answer: typeof item.acceptedAnswer === "object" ? item.acceptedAnswer.text || "" : "",
        });
      }
    }
  }

  let externalLinks = 0;
  const parsedBase = new URL(url);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    try {
      const resolved = new URL(href, url);
      if (resolved.hostname !== parsedBase.hostname) externalLinks++;
    } catch { /* skip */ }
  });

  const meta = {
    title: $("title").first().text().trim() || null,
    description: $('meta[name="description"]').attr("content") || null,
  };

  return {
    url,
    crawledAt: new Date().toISOString(),
    meta,
    headings,
    schema: schemas,
    faq,
    links: { external: externalLinks },
    content: { wordCount: countWords(bodyText) },
    _bodyText: bodyText,
    _blockquoteCount: blockquoteCount,
  };
}

// ---------------------------------------------------------------------------
// Main analysis orchestrator
// ---------------------------------------------------------------------------

function analyze(crawlData) {
  const allText = buildTextFromCrawlData(crawlData);

  const dimQuotations = analyzeQuotations(allText, crawlData);
  const dimStatistics = analyzeStatistics(allText);
  const dimCitations = analyzeSourceCitations(allText, crawlData.links);
  const dimTechnical = analyzeTechnicalTerms(allText);
  const dimStructure = analyzeContentStructure(
    crawlData.headings || [],
    crawlData.faq || [],
    allText
  );
  const dimAnswerDensity = analyzeAnswerDensity(allText);

  const dimensions = [
    dimQuotations,
    dimStatistics,
    dimCitations,
    dimTechnical,
    dimStructure,
    dimAnswerDensity,
  ];

  // Overall score: weighted sum based on Princeton impact levels
  // critical (3 dims): weight 25 each -> 75 pts
  // high (2 dims):     weight 10 each -> 20 pts
  // low (1 dim):        weight  5     ->  5 pts
  const WEIGHTS = {
    quotations:    25,
    statistics:    25,
    citations:     25,
    technicalTerms: 5,
    structure:     10,
    answerDensity: 10,
  };

  let weightedTotal = 0;
  let maxWeightedTotal = 0;
  for (const dim of dimensions) {
    const w = WEIGHTS[dim.name] || 5;
    weightedTotal += (dim.score / dim.maxScore) * w;
    maxWeightedTotal += w;
  }

  const overallScore = Math.round((weightedTotal / maxWeightedTotal) * 100);

  // Top actions: pull the first suggestion from each low-scoring critical/high dim
  const topActions = [];
  const priorityOrder = ["quotations", "statistics", "citations", "structure", "answerDensity", "technicalTerms"];
  for (const name of priorityOrder) {
    const dim = dimensions.find((d) => d.name === name);
    if (dim && dim.suggestions.length > 0) {
      const boost = dim.expectedBoost !== "variable" ? ` (${dim.expectedBoost} visibility)` : "";
      topActions.push(`${dim.suggestions[0]}${boost}`);
    }
    if (topActions.length >= 4) break;
  }

  // Aggregate content metrics
  const wordCount = crawlData.content?.wordCount || countWords(allText);
  const content = {
    wordCount,
    quotationCount: dimQuotations._counts.quotationCount,
    statisticCount: dimStatistics._counts.statisticCount,
    citationCount: dimCitations._counts.citationCount,
    headingCount: dimStructure._counts.headingCount,
    faqCount: dimStructure._counts.faqCount,
    paragraphAvgSentences: dimStructure._counts.paragraphAvgSentences,
  };

  // Strip internal _counts fields from output
  const cleanDimensions = dimensions.map(({ _counts, ...rest }) => rest);

  return {
    url: crawlData.url || "unknown",
    analyzedAt: new Date().toISOString(),
    overallScore,
    dimensions: cleanDimensions,
    topActions,
    content,
  };
}

// ---------------------------------------------------------------------------
// Human-readable summary to stderr
// ---------------------------------------------------------------------------

function printSummary(result) {
  const bar = (score, max = 10) => {
    const filled = Math.round((score / max) * 10);
    return "█".repeat(filled) + "░".repeat(10 - filled);
  };

  process.stderr.write("\n");
  process.stderr.write(`  GEO Content Optimization Report\n`);
  process.stderr.write(`  URL: ${result.url}\n`);
  process.stderr.write(`  Overall Score: ${result.overallScore}/100\n`);
  process.stderr.write(`  Word Count: ${result.content.wordCount}\n`);
  process.stderr.write("\n");
  process.stderr.write(`  Dimension Scores\n`);
  process.stderr.write(`  ${"─".repeat(60)}\n`);

  for (const dim of result.dimensions) {
    const scoreStr = `${dim.score}/${dim.maxScore}`.padStart(5);
    const boost = dim.expectedBoost !== "variable" ? `  ${dim.expectedBoost}` : "";
    process.stderr.write(`  ${dim.label.padEnd(30)} ${bar(dim.score)} ${scoreStr}${boost}\n`);
  }

  process.stderr.write("\n");
  process.stderr.write(`  Top Actions\n`);
  process.stderr.write(`  ${"─".repeat(60)}\n`);
  for (let i = 0; i < result.topActions.length; i++) {
    process.stderr.write(`  ${i + 1}. ${result.topActions[i]}\n`);
  }
  process.stderr.write("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const { inputPath, outputPath, url } = parseArgs();

  let crawlData;

  if (url) {
    // Direct URL mode: fetch + parse with cheerio
    crawlData = await crawlAndEnrich(url);
  } else {
    // JSON input mode: from --input file or stdin
    let rawJson;

    if (inputPath) {
      const fullPath = resolve(process.cwd(), inputPath);
      try {
        rawJson = readFileSync(fullPath, "utf8");
      } catch (err) {
        process.stderr.write(`Error reading input file: ${err.message}\n`);
        process.exit(1);
      }
    } else if (!process.stdin.isTTY) {
      // Read from piped stdin
      rawJson = "";
      process.stdin.setEncoding("utf8");
      for await (const chunk of process.stdin) {
        rawJson += chunk;
      }
    } else {
      process.stderr.write(
        `Usage: node scripts/content-optimize.mjs --input data/crawl-result.json [--output suggestions.json]\n` +
        `       node scripts/content-optimize.mjs --url https://example.com [--output suggestions.json]\n` +
        `       node scripts/crawl-page.mjs https://example.com | node scripts/content-optimize.mjs\n`
      );
      process.exit(1);
    }

    try {
      crawlData = JSON.parse(rawJson);
    } catch (err) {
      process.stderr.write(`Error parsing JSON input: ${err.message}\n`);
      process.exit(1);
    }
  }

  if (crawlData.error) {
    process.stderr.write(`Crawl data contains error: ${crawlData.error}\n`);
    process.exit(1);
  }

  const result = analyze(crawlData);

  printSummary(result);

  const json = JSON.stringify(result, null, 2);

  if (outputPath) {
    const fullOutput = resolve(process.cwd(), outputPath);
    writeFileSync(fullOutput, json, "utf8");
    process.stderr.write(`Results saved to ${fullOutput}\n`);
  } else {
    process.stdout.write(json + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message || err}\n`);
  process.exit(1);
});
