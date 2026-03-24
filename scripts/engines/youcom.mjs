const TIMEOUT_MS = 30_000;

export const name = "youcom";
export const envKey = "YOU_API_KEY";
export const setupUrl = "https://api.you.com/dashboard";

export function isAvailable() {
  return !!process.env.YOU_API_KEY;
}

export async function queryRaw(keyword) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const apiKey = process.env.YOU_API_KEY;

  try {
    const params = new URLSearchParams({ query: keyword });
    const res = await fetch(`https://chat-api.you.com/smart?${params}`, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
      },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const content = data.answer || "";
    const citations = data.citations || data.hits || [];
    const urls = [...new Set(citations.map((c) => c.url || c).filter(Boolean))];

    return {
      urls,
      snippet: content ? content.slice(0, 300).replace(/\s+/g, " ").trim() : null,
      raw: content,
    };
  } catch (err) {
    return { urls: [], snippet: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

export async function query(keyword, domain) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const apiKey = process.env.YOU_API_KEY;

  try {
    const params = new URLSearchParams({ query: keyword });
    const res = await fetch(`https://chat-api.you.com/smart?${params}`, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
      },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const content = data.answer || "";
    const citations = data.citations || data.hits || [];
    const urls = citations.map((c) => c.url || c).filter(Boolean);
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

function matchDomain(url, domain) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith("." + domain);
  } catch {
    return false;
  }
}
