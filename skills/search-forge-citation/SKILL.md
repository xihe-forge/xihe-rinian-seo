---
name: search-forge:citation
description: 监测域名在 5 个 AI 搜索引擎中的引用状态和品牌情感
---

# /search-forge:citation — AI 引用监测

检测目标域名是否被 Perplexity、ChatGPT、Gemini、Kimi、You.com 引用。

## 工具

```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/check-ai-citation.mjs \
  --domain <域名> \
  --keywords "<关键词，逗号分隔>" \
  [--engines perplexity,chatgpt,gemini,kimi,youcom] \
  [--competitors "竞品1.com,竞品2.com"] \
  [--baseline data/baselines/prev.json] \
  [--output data/baselines/latest.json]
```

## 需要 API Key（至少一个）

| 引擎 | 环境变量 |
|------|---------|
| Perplexity | PERPLEXITY_API_KEY |
| ChatGPT | OPENAI_API_KEY |
| Gemini | GEMINI_API_KEY |
| Kimi | MOONSHOT_API_KEY |
| You.com | YOU_API_KEY |

## 步骤

1. 确认用户有至少一个 API Key
2. 确定关键词（用户提供或从页面提取）
3. 运行引用检测
4. 分析结果：引用率、情感、竞品对比
5. 建议针对未被引用的关键词进行内容优化
