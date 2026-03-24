const TIMEOUT_MS = 60_000;

export const name = "kimi";
export const envKey = "MOONSHOT_API_KEY";
export const setupUrl = "https://platform.moonshot.cn/console/api-keys";

export function isAvailable() {
  return !!process.env.MOONSHOT_API_KEY;
}

export async function queryRaw(keyword) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "kimi-latest",
        messages: [
          { role: "system", content: "你是一个搜索助手，请联网搜索并回答问题，在回答中引用来源URL。" },
          { role: "user", content: keyword },
        ],
        use_search: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const urls = extractUrls(content);

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

  try {
    const res = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "kimi-latest",
        messages: [
          { role: "system", content: "你是一个搜索助手，请联网搜索并回答问题，在回答中引用来源URL。" },
          { role: "user", content: keyword },
        ],
        use_search: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const urls = extractUrls(content);
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

function extractUrls(text) {
  const pattern = /https?:\/\/[^\s)\]"'，。、]+/g;
  const matches = text.matchAll(pattern);
  return [...new Set([...matches].map((m) => m[0].replace(/[.,;:!?]+$/, "")))];
}

function matchDomain(url, domain) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith("." + domain);
  } catch {
    return false;
  }
}
