---
name: search-forge:voice
description: 计算品牌在 AI 搜索中的引用占比 vs 竞品
---

# /search-forge:voice — AI 声量占比

对比你的品牌和竞品在 AI 搜索引擎中的引用频率。

## 工具

```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/share-of-voice.mjs \
  --domain <域名> \
  --keywords "<关键词>" \
  --competitors "<竞品域名>" \
  [--engines perplexity,chatgpt]
```

需要至少一个 AI 引擎 API Key。

## 步骤

1. 确认域名、关键词、竞品
2. 运行声量分析
3. 识别竞品主导的关键词
4. 针对零引用关键词制定内容策略
