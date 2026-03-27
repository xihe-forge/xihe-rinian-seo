---
name: xihe-rinian-seo:defense
description: 检测 AI 搜索中的负面 GEO 攻击 — 情感突变、协同攻击识别
---

# /xihe-rinian-seo:defense — 负面 GEO 防御检测

与历史基线对比，检测 AI 搜索中针对品牌的负面情感变化和攻击模式。

## 工具

```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/negative-geo-detect.mjs \
  --domain <域名> \
  --keywords "<关键词>" \
  --baseline <基线文件路径>
```

需要基线文件（check-ai-citation.mjs 的输出）。无 API Key 时自动切换为基线扫描模式 / Without API Keys, automatically switches to baseline-only analysis mode。

## 告警类型

| 类型 | 严重级别 |
|------|---------|
| sentiment_shift | high |
| new_negative_source | medium |
| attack_signal_detected | medium |
| citation_lost | low |
| coordinated_attack | critical |
| cross_engine_source | high |

## 步骤

1. 确认有基线文件（如没有，先运行 /xihe-rinian-seo:citation 建立基线）
2. 运行检测
3. 按 riskLevel 分级响应
4. 对可疑来源给出应对建议
