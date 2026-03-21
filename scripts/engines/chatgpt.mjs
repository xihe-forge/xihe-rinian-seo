const TIMEOUT_MS = 60_000;

export const name = "chatgpt";
export const envKey = "OPENAI_API_KEY";
export const setupUrl = "https://platform.openai.com/api-keys";

export function isAvailable() {
  return !!process.env.OPENAI_API_KEY;
}

export async function query(keyword, domain) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        tools: [{ type: "web_search_preview" }],
        input: keyword,
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const urls = extractUrls(data);
    const content = extractContent(data);
    const matched = urls.filter((url) => matchDomain(url, domain));

    return {
      cited: matched.length > 0,
      urls: matched,
      snippet: content ? content.slice(0, 300).replace(/\s+/g, " ").trim() : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractUrls(data) {
  const urls = [];
  if (!data.output) return urls;
  for (const item of data.output) {
    if (item.type === "web_search_call" && item.results) {
      for (const r of item.results) {
        if (r.url) urls.push(r.url);
      }
    }
    if (item.type === "message") {
      const text = item.content?.map((c) => c.text).join("") ?? "";
      const linkPattern = /https?:\/\/[^\s)\]"']+/g;
      for (const match of text.matchAll(linkPattern)) {
        urls.push(match[0]);
      }
      if (item.content) {
        for (const c of item.content) {
          if (c.annotations) {
            for (const ann of c.annotations) {
              if (ann.url) urls.push(ann.url);
            }
          }
        }
      }
    }
  }
  return [...new Set(urls)];
}

function extractContent(data) {
  if (!data.output) return null;
  for (const item of data.output) {
    if (item.type === "message" && item.content) {
      return item.content.map((c) => c.text || "").join("");
    }
  }
  return null;
}

function matchDomain(url, domain) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith("." + domain);
  } catch {
    return false;
  }
}
