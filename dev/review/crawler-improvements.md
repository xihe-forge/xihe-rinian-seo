# crawl-page.mjs 改进意见

> 来源：SubtextAI 项目 SEO 修复过程中发现的问题
> 日期：2026-03-21
> 参考标准：Google Search Central、Lighthouse SEO audit

---

## 问题 1：`<summary>` 文本提取包含装饰性内容

**文件**: `scripts/crawl-page.mjs` 第 205 行

```js
const q = $(el).find("summary").first().text().trim();
```

**现象**: `<summary>` 内如果有装饰性子元素（展开/折叠指示符如 `+`、`▸`、图标等），`.text()` 会把它们全部拼进问题文本，产出类似 `"What is SubtextAI?+"` 的脏数据。

**修复建议**:

```js
// 方案 A：排除 aria-hidden 和纯装饰元素
const $summary = $(el).find("summary").first().clone();
$summary.find('[aria-hidden="true"], .icon, svg').remove();
const q = $summary.text().trim();

// 方案 B：只取第一个文本容器的内容（更精确）
const $summary = $(el).find("summary").first();
const $textEl = $summary.find('span, p, .question-text').first();
const q = ($textEl.length ? $textEl : $summary).text().trim();
```

---

## 问题 2：FAQ 去重逻辑——JSON-LD Schema 和 HTML 内容被当作"重复"

**文件**: `scripts/crawl-page.mjs` 第 173-236 行

**现象**: 爬虫从3个来源提取 FAQ（JSON-LD Schema、`<details>` 元素、FAQ heading 下的 dt/dd），然后用 `seen` Set 做精确字符串去重。但同一个问题在 Schema 和 HTML 中措辞可能略有不同（例如 "What languages does SubtextAI support?" vs "What languages does it support?"），导致去重失败，同一个问题出现两次。

**根本问题**: JSON-LD Schema 和 HTML 可见内容包含相同 FAQ 是 **Google 官方推荐的做法**（structured data 应与页面可见内容一致）。爬虫不应该把这两个来源的内容叠加计数。

**修复建议**:

```js
function extractFaq($, schemas) {
  // 1. 优先从 JSON-LD Schema 提取（最权威的结构化来源）
  const schemaFaqs = extractFromSchemas(schemas);

  // 2. 从 HTML 提取（details/summary、dt/dd 等）
  const htmlFaqs = extractFromHtml($);

  // 3. 如果有 Schema FAQ，以 Schema 为准，HTML 仅用于补充 Schema 中没有的问题
  //    使用模糊匹配去重（而非精确字符串匹配）
  if (schemaFaqs.length > 0) {
    const merged = [...schemaFaqs];
    for (const hf of htmlFaqs) {
      const isDuplicate = schemaFaqs.some(sf =>
        fuzzyMatch(sf.question, hf.question)
      );
      if (!isDuplicate) merged.push(hf);
    }
    return merged;
  }

  return htmlFaqs;
}

// 模糊匹配：忽略大小写、标点、常见缩写差异
function fuzzyMatch(a, b) {
  const normalize = s => s.toLowerCase()
    .replace(/[^\w\s\u3000-\u9fff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  // 一方包含另一方的核心关键词
  if (na.includes(nb) || nb.includes(na)) return true;
  // Jaccard 相似度 > 0.7
  const wordsA = new Set(na.split(' '));
  const wordsB = new Set(nb.split(' '));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && intersection / union > 0.7;
}
```

---

## 问题 3：未标注 FAQ 来源

**现象**: 输出的 `faq` 数组只有 `question` 和 `answer`，无法区分来源（Schema vs HTML vs heading-based）。审计报告里说"FAQ 为空"时，不知道是哪种提取方式失败了。

**修复建议**: 给每条 FAQ 加一个 `source` 字段：

```js
faqs.push({
  question: q,
  answer: a,
  source: 'schema:FAQPage'  // 或 'html:details' 或 'html:heading-section'
});
```

---

## 问题 4：评分体系缺少与 Lighthouse 的对标

审计报告的评分维度（Schema、Headings、FAQ、AI 爬虫等共8维，满分80）是自定义标准。建议：

1. 在报告中注明这是**自定义评分**，不等同于 Google 的 SEO 评分
2. 增加一个 `lighthouseComparison` 字段，跑一次 Lighthouse CLI 拿到 Google 官方 SEO 分数作为参考
3. AEO（AI Engine Optimization）维度是自定义的有价值的补充，但应明确区分"Google SEO"和"AEO"的分数

---

## 补充：Lighthouse 对比结果

SubtextAI 在修复前后的对比：

| 工具 | 修前 | 修后 |
|------|------|------|
| xihe-seo-aeo 自定义评分 | 16/80 | ~65/80 (FAQ仍有误报) |
| **Google Lighthouse SEO** | 未测 | **100/100** |
| **Google Lighthouse Best Practices** | 未测 | **100/100** |

这说明 xihe-seo-aeo 的评分标准比 Lighthouse 更严格（这本身不是坏事，AEO 维度有价值），但 FAQ 的误报计数需要修复以提高可信度。
