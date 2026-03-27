const TIMEOUT_MS = 30_000;

export const name = "gemini";
export const envKey = "GEMINI_API_KEY";
export const setupUrl = "https://aistudio.google.com/apikey";

export function isAvailable() {
  return !!process.env.GEMINI_API_KEY;
}

export async function queryRaw(keyword) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: keyword }] }],
          tools: [{ google_search: {} }],
        }),
        signal: controller.signal,
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const { urls, content } = extractGroundingData(data);

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
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: keyword }] }],
          tools: [{ google_search: {} }],
        }),
        signal: controller.signal,
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const { urls, content } = extractGroundingData(data);
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

function extractGroundingData(data) {
  const urls = [];
  let content = "";

  const candidates = data.candidates || [];
  for (const cand of candidates) {
    if (cand.content?.parts) {
      for (const part of cand.content.parts) {
        if (part.text) content += part.text;
      }
    }

    const metadata = cand.groundingMetadata;
    if (metadata) {
      if (metadata.groundingChunks) {
        for (const chunk of metadata.groundingChunks) {
          if (chunk.web?.uri) urls.push(chunk.web.uri);
        }
      }
      if (metadata.webSearchQueries) {
        // queries are logged but not URLs
      }
    }
  }

  const linkPattern = /https?:\/\/[^\s)\]"']+/g;
  for (const match of content.matchAll(linkPattern)) {
    urls.push(match[0]);
  }

  return { urls: [...new Set(urls)], content };
}

function matchDomain(url, domain) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith("." + domain);
  } catch {
    return false;
  }
}
