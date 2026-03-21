const TIMEOUT_MS = 30_000;

export const name = "perplexity";
export const envKey = "PERPLEXITY_API_KEY";
export const setupUrl = "https://www.perplexity.ai/settings/api";

export function isAvailable() {
  return !!process.env.PERPLEXITY_API_KEY;
}

export async function query(keyword, domain) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: keyword }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const citations = data.citations ?? [];
    const matched = citations.filter((url) => matchDomain(url, domain));

    return {
      cited: matched.length > 0,
      urls: matched,
      snippet: extractSnippet(content, keyword, domain),
    };
  } finally {
    clearTimeout(timer);
  }
}

function matchDomain(url, domain) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith("." + domain);
  } catch {
    return false;
  }
}

function extractSnippet(content, keyword, domain) {
  if (!content) return null;
  const lower = content.toLowerCase();
  const idx = lower.indexOf(domain);
  if (idx !== -1) {
    return content.slice(Math.max(0, idx - 100), idx + 200).replace(/\s+/g, " ").trim();
  }
  const kwIdx = lower.indexOf(keyword.toLowerCase().split(" ")[0]);
  if (kwIdx !== -1) {
    return content.slice(Math.max(0, kwIdx - 50), kwIdx + 200).replace(/\s+/g, " ").trim();
  }
  return content.slice(0, 200).replace(/\s+/g, " ").trim();
}
