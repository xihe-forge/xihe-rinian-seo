#!/usr/bin/env node

import { writeFileSync } from "fs";
import { parseArgs } from "util";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER_AGENT = "xihe-search-forge/0.2 (SEO audit tool)";
const REQUEST_TIMEOUT_MS = 10_000;
const INTER_REQUEST_DELAY_MS = 1_000;

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    brand:  { type: "string" },
    domain: { type: "string" },
    output: { type: "string" },
  },
});

if (!args.brand || !args.domain) {
  process.stderr.write(`Usage: node platform-presence.mjs --brand <name> --domain <domain> [--output <file>]

Examples:
  node scripts/platform-presence.mjs --brand "SubtextAI" --domain "getsubtextai.com"
  node scripts/platform-presence.mjs --brand "SubtextAI" --domain "getsubtextai.com" --output presence.json
`);
  process.exit(1);
}

const brand  = args.brand.trim();
const domain = args.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with a timeout signal and a consistent User-Agent.
 * Returns { ok, status, text } — never throws on network errors (caller handles).
 */
async function safeFetch(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/html, */*",
        ...extraHeaders,
      },
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: "", error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Platform checkers
// ---------------------------------------------------------------------------

// 1. Reddit (~40% of AI citations)
async function checkReddit(brand) {
  const q = encodeURIComponent(brand);
  const url = `https://www.reddit.com/search.json?q=${q}&sort=relevance&limit=10`;
  const res = await safeFetch(url, { "Accept": "application/json" });

  if (!res.ok) {
    if (res.status === 429 || res.status === 403) {
      return { status: "unknown", reason: `HTTP ${res.status} — rate limited` };
    }
    return { status: "unknown", reason: `HTTP ${res.status}` };
  }

  let data;
  try { data = JSON.parse(res.text); } catch { return { status: "unknown", reason: "JSON parse error" }; }

  const posts = data?.data?.children ?? [];
  if (posts.length === 0) {
    return {
      status: "not_found",
      details: { postCount: 0, topSubreddits: [], recentActivity: false, avgUpvotes: 0 },
    };
  }

  const brandLower = brand.toLowerCase();
  const relevant = posts.filter((p) => {
    const title = (p.data?.title ?? "").toLowerCase();
    const body  = (p.data?.selftext ?? "").toLowerCase();
    return title.includes(brandLower) || body.includes(brandLower);
  });

  const subredditsSet = new Set();
  let totalUpvotes = 0;
  let mostRecent = 0;

  for (const p of relevant) {
    if (p.data?.subreddit_name_prefixed) subredditsSet.add(p.data.subreddit_name_prefixed);
    totalUpvotes += p.data?.score ?? 0;
    if (p.data?.created_utc > mostRecent) mostRecent = p.data.created_utc;
  }

  const now = Date.now() / 1000;
  const recentActivity = mostRecent > 0 && (now - mostRecent) < 90 * 24 * 3600; // 90 days

  const postCount = relevant.length;
  const topSubreddits = [...subredditsSet].slice(0, 5);
  const avgUpvotes = postCount > 0 ? Math.round(totalUpvotes / postCount) : 0;

  // Score: up to 10
  // 1-3 posts → 3, 4-9 → 5, 10+ → 7; recency +1, multi-subreddit +1, avg upvotes ≥10 +1
  let score = postCount >= 10 ? 7 : postCount >= 4 ? 5 : postCount >= 1 ? 3 : 0;
  if (recentActivity) score = Math.min(10, score + 1);
  if (topSubreddits.length >= 2) score = Math.min(10, score + 1);
  if (avgUpvotes >= 10) score = Math.min(10, score + 1);

  const suggestions = [];
  if (postCount < 5)       suggestions.push("Post more in r/SaaS and r/startups for broader reach");
  if (!recentActivity)     suggestions.push("Activity is stale — post or engage within the last 90 days");
  if (topSubreddits.length < 3) suggestions.push("Expand to more subreddits: r/entrepreneur, r/smallbusiness, r/productivity");

  return {
    status: "found",
    score,
    details: { postCount, topSubreddits, recentActivity, avgUpvotes },
    suggestions,
  };
}

// 2. YouTube (~23% of AI citations)
async function checkYouTube(brand) {
  const q = encodeURIComponent(brand);
  const url = `https://www.youtube.com/results?search_query=${q}`;
  const res = await safeFetch(url, { "Accept": "text/html" });

  if (!res.ok) {
    return { status: "unknown", reason: `HTTP ${res.status}` };
  }

  const brandLower = brand.toLowerCase();
  const html = res.text.toLowerCase();

  // ytInitialData contains video metadata as JSON embedded in the page
  const titleMatches = (html.match(/"title":\s*\{"runs":\s*\[\{"text":\s*"[^"]*"/g) ?? [])
    .filter((m) => m.toLowerCase().includes(brandLower));

  // Rough video count from title occurrences
  const videoCount = titleMatches.length;
  const found = videoCount > 0;

  if (!found) {
    return {
      status: "not_found",
      details: { videoCount: 0 },
      suggestions: [
        "Create a product demo video",
        "Encourage user reviews on YouTube",
        "Post tutorials or walkthroughs to build citation surface",
      ],
    };
  }

  let score = videoCount >= 5 ? 8 : videoCount >= 2 ? 5 : 3;

  const suggestions = [];
  if (videoCount < 3) suggestions.push("Create more brand-named video content — even short demos help");
  if (videoCount < 5) suggestions.push("Reach out to YouTubers for reviews/mentions");

  return {
    status: "found",
    score,
    details: { videoCount },
    suggestions,
  };
}

// 3. Wikipedia (~26% of AI citations)
async function checkWikipedia(brand) {
  const q = encodeURIComponent(brand);
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&format=json&srlimit=5`;
  const res = await safeFetch(url);

  if (!res.ok) {
    return { status: "unknown", reason: `HTTP ${res.status}` };
  }

  let data;
  try { data = JSON.parse(res.text); } catch { return { status: "unknown", reason: "JSON parse error" }; }

  const results = data?.query?.search ?? [];
  const brandLower = brand.toLowerCase();

  const ownArticle = results.some(
    (r) => r.title?.toLowerCase() === brandLower || r.title?.toLowerCase().includes(brandLower)
  );
  const mentions = results.filter((r) =>
    r.snippet?.toLowerCase().includes(brandLower)
  ).length;

  if (results.length === 0) {
    return {
      status: "not_found",
      details: { ownArticle: false, mentionCount: 0 },
      suggestions: [
        "Wikipedia presence is hard to earn but very impactful — build notability through press coverage first",
        "Ensure brand is mentioned in related technology or SaaS articles",
      ],
    };
  }

  let score = ownArticle ? 9 : mentions >= 2 ? 4 : mentions >= 1 ? 2 : 1;

  const suggestions = [];
  if (!ownArticle) suggestions.push("Work toward a Wikipedia article — requires significant third-party coverage");
  if (mentions < 2) suggestions.push("Get mentioned in existing Wikipedia articles about your category/niche");

  return {
    status: ownArticle || mentions > 0 ? "found" : "not_found",
    score,
    details: { ownArticle, mentionCount: mentions, totalResults: results.length },
    suggestions,
  };
}

// 4. GitHub
async function checkGitHub(brand) {
  const q = encodeURIComponent(brand);
  const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=5`;
  const res = await safeFetch(url, {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      return { status: "unknown", reason: "GitHub API rate limit reached" };
    }
    return { status: "unknown", reason: `HTTP ${res.status}` };
  }

  let data;
  try { data = JSON.parse(res.text); } catch { return { status: "unknown", reason: "JSON parse error" }; }

  const items = data?.items ?? [];
  const brandLower = brand.toLowerCase();

  const relevant = items.filter(
    (r) =>
      r.full_name?.toLowerCase().includes(brandLower) ||
      r.description?.toLowerCase().includes(brandLower)
  );

  if (relevant.length === 0) {
    return {
      status: "not_found",
      details: { repoCount: 0, totalStars: 0 },
      suggestions: [
        "Open-source a related tool or library under the brand name",
        "Publish SDKs or integrations on GitHub",
      ],
    };
  }

  const totalStars = relevant.reduce((sum, r) => sum + (r.stargazers_count ?? 0), 0);
  let score = totalStars >= 100 ? 8 : totalStars >= 10 ? 5 : 2;

  const suggestions = [];
  if (totalStars < 50) suggestions.push("Grow GitHub stars through open-source contributions or public tools");

  return {
    status: "found",
    score,
    details: {
      repoCount: relevant.length,
      totalStars,
      topRepos: relevant.slice(0, 3).map((r) => ({ name: r.full_name, stars: r.stargazers_count })),
    },
    suggestions,
  };
}

// 5. Stack Overflow
async function checkStackOverflow(brand) {
  const q = encodeURIComponent(brand);
  const url = `https://api.stackexchange.com/2.3/search?order=desc&sort=relevance&intitle=${q}&site=stackoverflow&pagesize=10`;
  const res = await safeFetch(url);

  if (!res.ok) {
    if (res.status === 400 || res.status === 429) {
      return { status: "unknown", reason: `HTTP ${res.status} — quota or rate limit` };
    }
    return { status: "unknown", reason: `HTTP ${res.status}` };
  }

  let data;
  try { data = JSON.parse(res.text); } catch { return { status: "unknown", reason: "JSON parse error" }; }

  const items = data?.items ?? [];
  const brandLower = brand.toLowerCase();

  const relevant = items.filter(
    (item) =>
      item.title?.toLowerCase().includes(brandLower) ||
      (item.tags ?? []).some((t) => t.toLowerCase().includes(brandLower))
  );

  const questionCount = relevant.length;

  if (questionCount === 0) {
    return {
      status: "not_found",
      details: { questionCount: 0 },
      suggestions: [
        "Create a Stack Overflow tag for the brand/product",
        "Answer questions where the tool is relevant to build visibility",
      ],
    };
  }

  let score = questionCount >= 5 ? 6 : questionCount >= 2 ? 4 : 2;

  return {
    status: "found",
    score,
    details: { questionCount },
    suggestions: questionCount < 5
      ? ["Increase Stack Overflow presence by publishing integration guides that generate questions"]
      : [],
  };
}

// 6. Hacker News
async function checkHackerNews(brand) {
  const q = encodeURIComponent(brand);
  const url = `https://hn.algolia.com/api/v1/search?query=${q}&tags=story&hitsPerPage=10`;
  const res = await safeFetch(url);

  if (!res.ok) {
    return { status: "unknown", reason: `HTTP ${res.status}` };
  }

  let data;
  try { data = JSON.parse(res.text); } catch { return { status: "unknown", reason: "JSON parse error" }; }

  const hits = data?.hits ?? [];
  const brandLower = brand.toLowerCase();

  const relevant = hits.filter(
    (h) =>
      h.title?.toLowerCase().includes(brandLower) ||
      h.url?.toLowerCase().includes(brandLower.replace(/\s+/g, ""))
  );

  const storyCount = relevant.length;
  const totalPoints = relevant.reduce((sum, h) => sum + (h.points ?? 0), 0);

  if (storyCount === 0) {
    return {
      status: "not_found",
      details: { storyCount: 0, totalPoints: 0 },
      suggestions: [
        "Submit a Show HN post — even a single high-quality HN thread drives lasting AI citations",
        "Write a technical blog post worth sharing on HN",
      ],
    };
  }

  let score = totalPoints >= 100 ? 8 : totalPoints >= 20 ? 5 : 2;

  return {
    status: "found",
    score,
    details: { storyCount, totalPoints },
    suggestions: totalPoints < 50
      ? ["Aim for a Show HN post with 50+ points to boost citation probability"]
      : [],
  };
}

// 7. Medium
async function checkMedium(brand) {
  const q = encodeURIComponent(brand);
  const url = `https://medium.com/search?q=${q}`;
  const res = await safeFetch(url, { "Accept": "text/html" });

  if (!res.ok) {
    // 403 is common from Medium behind Cloudflare; status 0 means timeout/network error — treat both as unknown
    return { status: "unknown", reason: res.status === 0 ? "unknown" : `HTTP ${res.status}` };
  }

  const html = res.text.toLowerCase();
  const brandLower = brand.toLowerCase();
  const found = html.includes(brandLower);

  if (!found) {
    return {
      status: "not_found",
      details: { articlesDetected: false },
      suggestions: [
        "Publish brand-named articles on Medium",
        "Cross-post blog content to Medium for additional citation surface",
      ],
    };
  }

  // Rough count of mentions
  const count = (html.match(new RegExp(brandLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
  const score = count >= 10 ? 6 : count >= 3 ? 4 : 2;

  return {
    status: "found",
    score,
    details: { articlesDetected: true, approximateMentions: count },
    suggestions: count < 5
      ? ["Increase Medium presence — publish a series of articles under the brand name"]
      : [],
  };
}

// 8. Quora / Zhihu
async function checkQuora(brand) {
  const slug = brand.toLowerCase().replace(/\s+/g, "-");
  const url = `https://www.quora.com/topic/${encodeURIComponent(slug)}`;
  const res = await safeFetch(url, { "Accept": "text/html" });

  // Quora often blocks scrapers with 403 or redirects; we treat non-5xx as "reachable"
  if (res.status === 0 || res.status >= 500) {
    return { status: "unknown", reason: `HTTP ${res.status} — unreachable` };
  }

  const html = res.text.toLowerCase();
  const brandLower = brand.toLowerCase();
  const found = res.status === 200 && html.includes(brandLower);

  if (!found) {
    return {
      status: res.status === 403 ? "unknown" : "not_found",
      reason: res.status === 403 ? "Access blocked (Quora)" : undefined,
      details: { topicExists: false },
      suggestions: [
        "Answer Quora questions in your product's niche",
        "Create a Quora Space for the brand",
      ],
    };
  }

  return {
    status: "found",
    score: 4,
    details: { topicExists: true },
    suggestions: ["Actively answer related questions to grow Quora authority"],
  };
}

// ---------------------------------------------------------------------------
// Platform registry
// ---------------------------------------------------------------------------

const PLATFORMS = [
  {
    name: "reddit",
    label: "Reddit",
    citationWeight: 0.40,
    check: (brand, _domain) => checkReddit(brand),
  },
  {
    name: "wikipedia",
    label: "Wikipedia",
    citationWeight: 0.26,
    check: (brand, _domain) => checkWikipedia(brand),
  },
  {
    name: "youtube",
    label: "YouTube",
    citationWeight: 0.23,
    check: (brand, _domain) => checkYouTube(brand),
  },
  {
    name: "github",
    label: "GitHub",
    citationWeight: 0.05,
    check: (brand, _domain) => checkGitHub(brand),
  },
  {
    name: "stackoverflow",
    label: "Stack Overflow",
    citationWeight: 0.03,
    check: (brand, _domain) => checkStackOverflow(brand),
  },
  {
    name: "hackernews",
    label: "Hacker News",
    citationWeight: 0.02,
    check: (brand, _domain) => checkHackerNews(brand),
  },
  {
    name: "medium",
    label: "Medium",
    citationWeight: 0.01,
    check: (brand, _domain) => checkMedium(brand),
  },
  {
    name: "quora",
    label: "Quora",
    citationWeight: 0.005,
    check: (brand, _domain) => checkQuora(brand),
  },
];

// ---------------------------------------------------------------------------
// Scoring & actions
// ---------------------------------------------------------------------------

/**
 * Compute overall score (0–100) weighted by platform citation weight.
 * Platforms with unknown status contribute 0.
 */
function computeOverallScore(platforms) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const p of platforms) {
    if (p.status === "unknown") continue; // indeterminate — exclude from both numerator and denominator
    totalWeight += p.citationWeight;
    if (p.found && typeof p.score === "number") {
      // Normalise per-platform score (0–10) to 0–1, weight by citation share
      weightedSum += (p.score / 10) * p.citationWeight;
    }
  }

  if (totalWeight === 0) return null; // indeterminate — all platforms returned unknown
  return Math.round((weightedSum / totalWeight) * 100);
}

function buildTopActions(platforms) {
  const actions = [];

  for (const p of platforms) {
    if (p.status === "unknown") continue;

    const weightPct = Math.round(p.citationWeight * 100);

    if (!p.found) {
      const priority = p.citationWeight >= 0.2 ? "HIGH IMPACT" : p.citationWeight >= 0.05 ? "MEDIUM" : "LOW";
      actions.push(
        `[${priority}] Create ${p.label} presence — ${weightPct}% of AI citations come from ${p.label} but you have 0 presence`
      );
    } else if (p.score < 5 && p.suggestions?.length > 0) {
      const priority = p.citationWeight >= 0.1 ? "MEDIUM" : "LOW";
      actions.push(`[${priority}] Improve ${p.label} presence (score ${p.score}/10): ${p.suggestions[0]}`);
    }
  }

  // Sort: HIGH first, then MEDIUM, then LOW
  const order = { "HIGH IMPACT": 0, MEDIUM: 1, LOW: 2 };
  actions.sort((a, b) => {
    const levelA = a.match(/\[([^\]]+)\]/)?.[1] ?? "LOW";
    const levelB = b.match(/\[([^\]]+)\]/)?.[1] ?? "LOW";
    return (order[levelA] ?? 3) - (order[levelB] ?? 3);
  });

  return actions;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  process.stderr.write(`\nPlatform Presence Audit\n`);
  process.stderr.write(`  Brand:  ${brand}\n`);
  process.stderr.write(`  Domain: ${domain}\n`);
  process.stderr.write(`  Date:   ${new Date().toISOString()}\n\n`);

  const results = [];

  for (let i = 0; i < PLATFORMS.length; i++) {
    const platform = PLATFORMS[i];

    if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);

    process.stderr.write(`[${i + 1}/${PLATFORMS.length}] ${platform.label.padEnd(15)} ... `);

    let result;
    try {
      result = await platform.check(brand, domain);
    } catch (err) {
      result = { status: "unknown", reason: err.message };
    }

    const found    = result.status === "found";
    const unknown  = result.status === "unknown";
    const score    = found ? (result.score ?? 0) : 0;
    const label    = unknown ? "UNKNOWN" : found ? `FOUND  (score ${score}/10)` : "NOT FOUND";

    process.stderr.write(`${label}\n`);

    results.push({
      name:           platform.name,
      label:          platform.label,
      citationWeight: platform.citationWeight,
      found,
      status:         result.status,
      score:          found ? score : 0,
      details:        result.details ?? null,
      suggestions:    result.suggestions ?? [],
      ...(result.reason ? { reason: result.reason } : {}),
    });
  }

  const overallScore = computeOverallScore(results);
  const topActions   = buildTopActions(results);

  process.stderr.write(`\nOverall presence score: ${overallScore !== null ? `${overallScore}/100` : "n/a (all platforms unknown)"}\n`);
  if (topActions.length > 0) {
    process.stderr.write(`\nTop actions:\n`);
    for (const action of topActions.slice(0, 5)) {
      process.stderr.write(`  • ${action}\n`);
    }
  }
  process.stderr.write("\n");

  const output = {
    brand,
    domain,
    checkedAt:    new Date().toISOString(),
    overallScore,
    platforms:    results,
    topActions,
  };

  const json = JSON.stringify(output, null, 2);

  if (args.output) {
    writeFileSync(args.output, json, "utf8");
    process.stderr.write(`Results written to ${args.output}\n`);
  } else {
    process.stdout.write(json + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
