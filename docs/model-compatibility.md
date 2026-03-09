# Model Compatibility Guide / 模型兼容性指南

Claw-Swarm V5.1 relies heavily on **tool calling** (7 tools with complex JSON schemas), **long context understanding** (6000+ chars of injected memory/pheromone/knowledge), and **multi-step reasoning** (autonomous task decomposition). This guide rates mainstream models on their compatibility.

Claw-Swarm V5.1 高度依赖**工具调用**（7 个工具，复杂 JSON schema）、**长上下文理解**（注入 6000+ 字符的记忆/信息素/知识图谱）和**多步推理**（自主任务分解）。本指南评估主流模型的兼容性。

---

## Rating Criteria / 评分标准

| Dimension / 维度 | Weight / 权重 | Why / 原因 |
|---|---|---|
| **Tool Calling Accuracy** | 35% | 7 tools with enums, optional fields, nested objects. A single malformed call breaks the pipeline. / 7 个工具含枚举、可选字段、嵌套对象，一次调用错误就会中断流程。 |
| **Long Context** | 20% | ContextService injects working memory + episodic memory + knowledge graph + pheromone signals. / 上下文服务注入工作记忆 + 情景记忆 + 知识图谱 + 信息素信号。 |
| **Multi-Step Reasoning** | 20% | Agent must decide when to decompose tasks, spawn sub-agents, and coordinate. / Agent 需要自主判断何时分解任务、派出子代理、协调工作。 |
| **Chinese Language** | 15% | SOUL snippets, tool descriptions, and pheromone signals are bilingual. / SOUL 片段、工具描述和信息素信号均为中英双语。 |
| **Cost Efficiency** | 10% | Swarm mode spawns multiple agents — cost multiplies. / 蜂群模式会派出多个子代理，成本成倍增加。 |

---

## Compatibility Matrix / 兼容性矩阵

### Tier S — Highly Recommended / 强烈推荐

Best-in-class tool calling + reasoning. Use these for the main orchestrating agent.

工具调用和推理能力顶级。适合作为主协调 agent。

| Model / 模型 | Provider | Tool Calling | Context | Reasoning | Chinese | Cost | Overall |
|---|---|---|---|---|---|---|---|
| **Opus 4.6** | Anthropic | ★★★★★ | 200K | ★★★★★ | ★★★★☆ | High | **S** |
| **Sonnet 4.6** | Anthropic | ★★★★★ | 200K | ★★★★★ | ★★★★☆ | Medium | **S** |
| **GPT-5.4** | OpenAI | ★★★★★ | 1M | ★★★★★ | ★★★★☆ | Medium-High | **S** |
| **GPT-5.3-Codex** | OpenAI | ★★★★★ | 400K | ★★★★★ | ★★★★☆ | Medium | **S** |
| **Gemini 2.5 Pro** | Google | ★★★★★ | 1M | ★★★★★ | ★★★★☆ | Medium | **S** |

**Notes / 备注:**
- Opus 4.6: Best overall reasoning + tool calling. Ideal as swarm orchestrator and quality gate. Expensive for sub-agents. / 综合推理和工具调用最强，理想的蜂群协调者和质量门控，但作为子代理成本高。
- Sonnet 4.6: Best balance of capability and cost. Recommended as default. / 能力与成本最佳平衡，推荐作为默认选择。
- GPT-5.4: Million-token context + strong reasoning. Excellent for complex multi-step orchestration. / 百万 token 上下文 + 强推理，复杂多步编排优秀。
- GPT-5.3-Codex: Code-optimized with 400K context. Ideal as coding-focused worker-bee. / 代码优化 + 400K 上下文，理想的编码工蜂。
- Gemini 2.5 Pro: Strong tool calling, excellent at structured output. 1M context. / 工具调用强，结构化输出优秀。

---

### Tier A — Recommended / 推荐

Strong tool calling with minor trade-offs. Good for both main agent and sub-agents.

工具调用能力强，有少量取舍。适合主 agent 和子 agent。

| Model / 模型 | Provider | Tool Calling | Context | Reasoning | Chinese | Cost | Overall |
|---|---|---|---|---|---|---|---|
| **Kimi K2.5** | Moonshot | ★★★★☆ | 262K | ★★★★☆ | ★★★★★ | Low | **A** |
| **Qwen3.5-Plus** | Alibaba | ★★★★☆ | 1M | ★★★★☆ | ★★★★★ | Low | **A** |
| **Qwen3.5-Max** | Alibaba | ★★★★☆ | 262K | ★★★★☆ | ★★★★★ | Low | **A** |
| **DeepSeek-V3** | DeepSeek | ★★★★☆ | 200K | ★★★★☆ | ★★★★★ | Low | **A** |
| **Gemini 2.5 Flash** | Google | ★★★★☆ | 1M | ★★★★☆ | ★★★☆☆ | Low | **A** |
| **Haiku 4.5** | Anthropic | ★★★★☆ | 200K | ★★★☆☆ | ★★★★☆ | Low | **A** |
| **o4-mini** | OpenAI | ★★★★☆ | 200K | ★★★★★ | ★★★★☆ | Medium | **A** |
| **Grok 3** | xAI | ★★★★☆ | 128K | ★★★★☆ | ★★★☆☆ | Medium | **A** |

**Notes / 备注:**
- Kimi K2.5: Excellent Chinese + good tool calling + Anthropic-compatible API. Best value for Chinese-centric swarms. Supports kimi-coding endpoint. / 中文能力顶级 + 工具调用好 + 兼容 Anthropic API，中文蜂群最佳性价比。支持 kimi-coding 端点。
- Qwen3.5-Plus: 1M context + native Chinese + free/cheap via Bailian. Ideal for scout-bee sub-agents. / 百万上下文 + 原生中文 + 百炼免费/低价，理想的侦察蜂模型。
- DeepSeek-V3: Strong Chinese reasoning. Tool calling reliable but occasionally verbose. / 中文推理强，工具调用可靠但偶尔冗长。
- Gemini 2.5 Flash: Fast + cheap + 1M context. Weaker Chinese but strong for English sub-agents. / 快速 + 便宜 + 百万上下文。中文稍弱但英文子代理很好。
- Haiku 4.5: Fast and cheap, good for high-volume sub-agent tasks. / 快速便宜，适合高频子代理任务。
- o4-mini: Strong reasoning for complex decomposition, but slower due to chain-of-thought. / 推理能力强，适合复杂分解，但因思维链较慢。

---

### Tier B — Usable with Caveats / 可用但有限制

Functional for specific roles but not ideal as the main orchestrator.

可用于特定角色但不适合作为主协调者。

| Model / 模型 | Provider | Tool Calling | Context | Reasoning | Chinese | Cost | Overall |
|---|---|---|---|---|---|---|---|
| **Qwen3-Coder-Next** | Alibaba | ★★★☆☆ | 262K | ★★★★☆ | ★★★★★ | Low | **B** |
| **DeepSeek-Reasoner** | DeepSeek | ★★★☆☆ | 200K | ★★★★★ | ★★★★★ | Low | **B** |
| **GLM-5** | Zhipu | ★★★☆☆ | 200K | ★★★★☆ | ★★★★★ | Low | **B** |
| **Mistral Large** | Mistral | ★★★★☆ | 128K | ★★★★☆ | ★★☆☆☆ | Medium | **B** |
| **MiniMax-M2.5** | MiniMax | ★★★☆☆ | 200K | ★★★☆☆ | ★★★★☆ | Low | **B** |
| **Llama 4 Maverick** | Meta | ★★★☆☆ | 1M | ★★★★☆ | ★★☆☆☆ | Free/Low | **B** |
| **Gemini 2.0 Flash** | Google | ★★★☆☆ | 1M | ★★★☆☆ | ★★★☆☆ | Low | **B** |

**Notes / 备注:**
- DeepSeek-Reasoner: Outstanding reasoning but tool calling is less reliable (tends to "think" instead of calling tools). Best as a reasoning sub-agent for guard-bee fallback. / 推理能力卓越但工具调用不够可靠（倾向于"思考"而非调用工具），适合作为守卫蜂备选推理子代理。
- Qwen3-Coder-Next: Optimized for code, weaker at general tool calling schemas. Good as worker-bee for coding tasks. / 针对代码优化，通用工具调用稍弱，适合作为编码 worker-bee。
- GLM-5: Good Chinese but tool calling accuracy drops with complex nested schemas. / 中文好但复杂嵌套 schema 的工具调用准确度下降。
- Mistral Large: Strong tool calling but poor Chinese support. Use for English-only swarms. / 工具调用强但中文支持差，仅适合英文蜂群。
- MiniMax-M2.5: Fast with large output capacity (131K max tokens). Suitable as coding sub-agent. / 速度快、输出容量大（131K max tokens），适合作为编码子代理。
- Llama 4 Maverick: Open-source, cheap, huge context. But tool calling needs careful prompt engineering. / 开源、便宜、大上下文，但工具调用需要精心提示工程。

---

### Tier C — Not Recommended / 不推荐

Significant issues with tool calling reliability.

工具调用可靠性有严重问题。

| Model / 模型 | Provider | Issue / 问题 |
|---|---|---|
| **Llama 4 Scout** | Meta | Tool calling unreliable with complex schemas. / 复杂 schema 工具调用不可靠。 |
| **o1** | OpenAI | No native tool calling support. Reasoning-only model. / 不支持原生工具调用，纯推理模型。 |
| **o3** | OpenAI | Extremely expensive + slow for sub-agent use. / 作为子代理极其昂贵且慢。 |
| **Codestral** | Mistral | Code-focused, weak general tool calling. / 聚焦代码，通用工具调用弱。 |

---

## Recommended Configurations / 推荐配置方案

### Budget-Friendly (Chinese) / 经济型（中文优先）

Best for Chinese-speaking users with cost constraints. Uses free/low-cost Chinese models.

适合中文用户的经济方案，使用免费/低成本中文模型。

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "kimi-coding/k2p5",
        "fallbacks": ["bailian/qwen3.5-plus", "deepseek/deepseek-chat"]
      }
    }
  }
}
```

| Role / 角色 | Model / 模型 | Reason / 原因 |
|---|---|---|
| Main agent | Kimi K2.5 | Best Chinese tool calling at low cost / 低成本最佳中文工具调用 |
| Sub-agents | Qwen3.5-Plus | 1M context, free via Bailian / 百万上下文，百炼免费 |
| Fallback | DeepSeek-V3 | Reliable backup / 可靠备选 |

### Balanced / 均衡型

Best overall balance of quality and cost.

质量与成本的最佳平衡。

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/sonnet-4-6",
        "fallbacks": ["openai-codex/gpt-5.4", "bailian/qwen3.5-plus"]
      }
    }
  }
}
```

| Role / 角色 | Model / 模型 | Reason / 原因 |
|---|---|---|
| Main agent | Sonnet 4.6 | Top tool calling + reasoning / 顶级工具调用 + 推理 |
| Sub-agents | GPT-5.4 or Qwen3.5-Plus | Strong tool calling at lower cost / 强工具调用，成本更低 |

### Maximum Quality / 最高质量

For complex swarm operations where accuracy is critical.

用于准确性至关重要的复杂蜂群操作。

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/opus-4-6",
        "fallbacks": ["openai-codex/gpt-5.4", "anthropic/sonnet-4-6"]
      }
    }
  }
}
```

### Mixed Strategy (Recommended) / 混合策略（推荐）

Use different models optimized for each bee role. This is the production configuration used by the OpenClaw MPU team.

为每个蜂群角色选择最优模型。这是 OpenClaw MPU 团队的生产配置。

```json
{
  "agents": {
    "list": [
      {"id": "mpu-d1", "model": {"primary": "bailian/qwen3.5-plus", "fallbacks": ["openai-codex/gpt-5.4", "anthropic/sonnet-4-6"]}},
      {"id": "mpu-d2", "model": {"primary": "anthropic/opus-4-6", "fallbacks": ["anthropic/sonnet-4-6", "openai-codex/o4-mini"]}},
      {"id": "mpu-d3", "model": {"primary": "openai-codex/gpt-5.3-codex", "fallbacks": ["anthropic/sonnet-4-6", "bailian/MiniMax-M2.5"]}},
      {"id": "mpu-d4", "model": {"primary": "kimi-coding/k2p5", "fallbacks": ["anthropic/sonnet-4-6", "openai-codex/gpt-5.4"]}}
    ]
  }
}
```

| Agent / 角色 | Model / 模型 | Why / 原因 |
|---|---|---|
| D1 scout-bee | Qwen3.5-Plus | 1M context for long document analysis + native Chinese / 百万上下文长文档分析 + 原生中文 |
| D2 guard-bee | Opus 4.6 | Strongest reasoning for quality gates / 最强推理用于质量门控 |
| D3 worker-bee | GPT-5.3-Codex | Code-optimized + fast delivery / 代码优化 + 快速交付 |
| D4 designer-bee | Kimi K2.5 | Strong code generation + image understanding + cost-effective / 强代码生成 + 图像理解 + 性价比高 |

> **Note**: The `subagents.model` field may not be available in all OpenClaw versions. Check your version's documentation.
>
> **注意**: `subagents.model` 字段可能不是所有 OpenClaw 版本都支持。请查阅你的版本文档。

---

## Key Requirements / 关键要求

Regardless of model choice, ensure:

无论选择哪个模型，请确保：

1. **Tool calling support is enabled** — Some providers require explicit opt-in for function calling. / 工具调用支持已启用 — 部分供应商需要显式开启。
2. **Sufficient context window** — Minimum 32K recommended. 128K+ preferred for complex swarms. / 上下文窗口足够 — 建议最低 32K，复杂蜂群推荐 128K+。
3. **JSON mode or structured output** — Helps with tool parameter accuracy. / JSON 模式或结构化输出 — 有助于提高工具参数准确度。
4. **Streaming support** — For real-time sub-agent status updates. / 流式支持 — 用于实时子代理状态更新。

---

## Testing Your Model / 测试你的模型

After configuring a model, verify tool calling works by asking the agent:

配置模型后，通过以下对话验证工具调用是否正常：

```
"Use swarm_query to check the current swarm status"
"用 swarm_query 查看当前蜂群状态"
```

A compatible model will correctly call `swarm_query` with `{ "action": "status" }`. If the model outputs the JSON as text instead of making a tool call, it's not compatible.

兼容的模型会正确调用 `swarm_query`（参数 `{ "action": "status" }`）。如果模型把 JSON 当文本输出而不是发起工具调用，则不兼容。

---

*Last updated: 2026-03-09 | Based on model capabilities as of March 2026 | V5.1*
