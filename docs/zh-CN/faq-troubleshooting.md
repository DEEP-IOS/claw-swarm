# 常见问题与故障排查

> Claw-Swarm V9.0.0 — 常见问题解答与故障排查指南

[← 返回 README](../../README.zh-CN.md) | [English](../en/faq-troubleshooting.md)

---

## 常见问题

### Claw-Swarm 是什么？

Claw-Swarm 是一个 OpenClaw 插件，通过仿生群体智能实现多代理协作。它使用生物算法——信息素轨迹（蚁群优化）、蜂群调度（ABC）、免疫系统异常检测、Lotka-Volterra 种群动态——来协调 LLM 代理，而非集中式控制。系统采用单进程网关内架构，拥有 7 个域、121 个源文件和 1,365 个测试。详见[仿生学与设计哲学](biomimicry.md)。

### 信号-网格架构与传统事件系统有什么区别？

传统事件系统使用扁平的发布/订阅模式：发布者向命名频道发送事件，该频道上的所有订阅者都会收到消息，不论上下文如何。V9.0 的 12 维信号场架构引入三个关键差异：

1. **场中介耦合：** 模块通过 SignalStore 进行交互。每个 `ModuleBase` 子类（约 110 个模块）声明 `produces` 和 `consumes` 信号维度，无需显式配线即可自动耦合。
2. **类型化受体与阈值：** 每个模块声明类型化受体，只有当信号强度超过可配置阈值时才会触发。这防止噪声激发昂贵的下游计算。
3. **12 维信号空间：** 信号在 12 个正交维度上刻画，实现细粒度过滤和路由，无需层级作用域图。

### 支持哪些模型？

Claw-Swarm 内置 35+ 个模型配置文件，每个模型由 8 维能力向量刻画。支持的模型包括前沿模型（claude-opus-4-6、claude-sonnet-4-6、gpt-4o、gpt-4.1、gemini-2.5-pro）、推理专家（deepseek-r1）以及通用模型（deepseek-chat、qwen3.5-max、kimi-k2.5、glm-5、minimax-m2.5 等）。任何 OpenClaw 兼容模型均可使用；未知模型获得 10% 假定失败率的回退配置。

### MoE 路由如何工作？

混合专家（Mixture-of-Experts）路由使用 8 维点积匹配。每个任务用 8D 需求向量刻画（编码、架构、测试、文档、安全、性能、沟通、领域专长），每个模型有一个 8D 能力配置。双过程路由器计算任务需求与每个可用模型能力向量的点积，选择得分最高的模型。System 1（快速路径）使用缓存的路由决策处理常规任务；System 2（慢速路径）对新颖或复杂任务执行完整的能力匹配。

### 不用 OpenClaw 能运行吗？

7 个域中的 5 个（core、communication、intelligence、orchestration、quality）设计为可复用模块，无直接 OpenClaw 依赖。bridge 域包含需要 OpenClaw 的插件钩子、工具定义和 Gateway 集成。observe 域可独立运行用于可视化。如果要在其他宿主中嵌入蜂群引擎，可以直接导入 5 个核心域并提供自定义 bridge 层。

### 记忆如何在 LLM 上下文重置后存活？

Claw-Swarm 使用 3 层记忆架构：

1. **工作记忆**（进程内）— 焦点缓冲区（5 条目）、上下文缓冲区（15 条目）、暂存区（30 条目）。进程重启后丢失。
2. **情节记忆**（DomainStore）— 持久化的事件记录，以 JSON 快照存储，带时间戳和代理关联。重启后保留。衰减由可配置半衰期控制。
3. **语义记忆**（DomainStore + 向量索引）— 通过 HNSW 向量搜索索引的嵌入知识片段。重启后保留。用于检索增强的上下文注入。

新代理会话启动时，`before_agent_start` 钩子将相关的情节记忆和语义记忆注入系统提示，有效地在上下文重置间恢复知识。

### 性能开销如何？

钩子执行按延迟预算分三级：

| 层级 | 目标延迟 | 示例 |
|------|----------|------|
| A 级 | < 0.1 ms | `before_model_resolve`，模块耦合验证 |
| B 级 | 2-5 ms | `before_agent_start`（提示注入）、`llm_output`（合规扫描） |
| C 级 | 异步 | 信息素衰减、SNA 重算、物种进化 |

单进程网关内架构意味着所有计算在 Gateway 进程内运行。CPU 密集操作（嵌入、向量搜索、Shapley 信用）使用异步调度避免阻塞请求处理。

### 情绪状态如何影响路由？

全局调制器维护一个 6 维情绪状态向量（通过指数移动平均更新），影响代理行为：

- **工作负载调节：** 高压力或疲劳信号会降低允许的最大并发子代理数，防止过度承诺。
- **冲突敏感：** 升高的冲突信号会提高 System 2 路由的阈值，在争议任务中强制更审慎的决策。
- **探索与利用：** 好奇和信心信号调整 ACO（蚁群优化）的探索-利用平衡。高好奇增加信息素随机性；高信心强化现有轨迹。

情绪状态从蜂群级指标（错误率、任务时长、队列深度）推导，而非文本内容的情感分析。

---

## 故障排查

### 插件未加载

**症状：** `openclaw gateway status` 未列出 `claw-swarm`，或显示为禁用。

**排查步骤：**

1. 检查 `~/.openclaw/openclaw.json` 在 `plugins.entries` 下是否包含 `claw-swarm` 条目：
   ```bash
   cat ~/.openclaw/openclaw.json | grep claw-swarm
   ```
2. 确保插件路径指向包含 `openclaw.plugin.json` 的有效目录。
3. 重启 Gateway：
   ```bash
   openclaw gateway stop
   openclaw gateway start
   ```
4. 检查 Gateway 启动日志中是否有插件加载错误或缺失依赖。

---

### 端口 19100 不可达

**症状：** 浏览器访问 `http://127.0.0.1:19100/v9/console` 时显示"连接被拒绝"。

**可能原因与解决方案：**

1. **Dashboard 被禁用：** 检查 `openclaw.json` 中 `dashboard.enabled` 是否为 `true`（或未显式设为 `false`）。

2. **孤立进程占用端口：** 上一个 Gateway 进程可能未被终止。查找并终止：
   ```bash
   # Windows
   netstat -ano | findstr ":19100"
   taskkill /F /PID <PID>

   # Linux/macOS
   lsof -i :19100
   kill -9 <PID>
   ```

3. **Gateway 未运行：** 用 `openclaw gateway status` 确认。

4. **防火墙：** 确保端口 19100 未被本地防火墙拦截。

---

### 重启后端口 19100 被占用

**症状：** `openclaw gateway stop` 再 `openclaw gateway start` 后，端口 19100 已被绑定。

**原因：** 上一个 Gateway 进程可能未完全释放端口。当进程被强制终止时可能出现此情况。

**修复：**

```bash
# 查找占用端口的进程
# Windows:
netstat -ano | findstr ":19100" | findstr "LISTENING"
# 记下 PID，然后:
taskkill /F /PID <PID>

# Linux/macOS:
lsof -i :19100
kill -9 <PID>

# 现在干净重启
openclaw gateway stop
openclaw gateway start
```

重启 Gateway 前务必确认端口 19100 已空闲。

---

### V8 数据迁移

**症状：** 启动时出现 V8 SQLite 数据迁移的警告。

**原因：** V9.0 使用 DomainStore + JSON 快照替代 SQLite。首次启动时系统会尝试自动迁移已有的 V8 数据。

**修复：**

1. 迁移在启动时自动执行。检查日志中的具体迁移错误。
2. 如果自动迁移失败，备份并全新启动：
   ```bash
   # 备份现有数据目录
   cp -r ~/.openclaw/claw-swarm/ ~/.openclaw/claw-swarm.backup/

   # 删除旧数据（下次启动时自动重建）
   rm -rf ~/.openclaw/claw-swarm/

   # 重启
   openclaw gateway restart
   ```
3. 历史数据将丢失。如需保留数据，检查迁移错误并手动修复。

---

### 测试失败

**症状：** `npx vitest run` 报告失败。

**排查步骤：**

1. 确认 Node.js >= 22：
   ```bash
   node --version
   ```
2. 安装依赖：
   ```bash
   npm install
   ```
3. 运行完整测试套件：
   ```bash
   npx vitest run
   ```
   V9.0 期望 1,365 个测试全部通过。
4. 如果特定测试失败，检查是否依赖可选包（`@xenova/transformers`、`usearch`）且未安装。

---

### 信号不传播

**症状：** 一个 ModuleBase 发射的信号未被应消费该信号的其他模块接收。

**可能原因：**

1. **produces/consumes 不匹配：** 验证发射模块在其 `produces` 列表中声明了该信号维度，接收模块在其 `consumes` 列表中声明了该信号维度。
2. **模块未初始化：** 每个 ModuleBase 必须在 Gateway 启动时正确初始化。检查该模块是否出现在域注册表中。
3. **信号维度不匹配：** 12 维信号场要求精确的维度匹配。验证存入的信号类型与消费模块期望的类型是否一致。

使用诊断端点 `GET /api/v1/diagnostics` 检查当前模块耦合拓扑。

---

### 受体不触发

**症状：** ModuleBase 模块已声明 `consumes` 某信号类型，但其受体回调未执行。

**可能原因：**

1. **阈值未达到：** 每个受体有最小强度阈值。如果到达的信号强度低于阈值，受体不会触发。降低阈值或在源头增强信号。
2. **信号子类型不匹配：** 受体是类型化的。注册为 `signal:pheromone.trail` 的受体不会对 `signal:pheromone.alarm` 触发。验证发射的信号子类型与受体注册是否匹配。
3. **模块注册顺序：** 在单进程架构中，模块初始化顺序很重要。确保消费模块在信号开始流动前已注册。

---

### 内存使用过高

**症状：** Gateway 进程消耗过多内存。

**可能原因与解决方案：**

1. **嵌入模型：** 本地 ONNX 嵌入模型（`@xenova/transformers`）将模型权重加载到内存（~100 MB）。切换到 `embedding.mode: "api"` 将嵌入卸载到外部 API。
2. **信息素累积：** 如果信息素衰减过慢或被禁用，信息素记录在内存中累积。提高 `pheromone.decayRate` 或缩短 `pheromone.decayInterval`。
3. **向量索引大小：** 如果 `vectorIndex.maxElements` 设得很高，HNSW 索引占用相应内存。若不需大规模向量搜索，降低此限制。
4. **JSON 快照大小：** 大型 DomainStore 快照在序列化时会消耗内存。监控 `~/.openclaw/claw-swarm/` 下的快照大小。

---

### 子代理生成失败

**症状：** `swarm_run` 分派了任务但子代理未能生成，或立即返回错误。

**可能原因：**

1. **超过最大深度：** 层级生成有 5 层最大深度限制。超过此深度的子代理生成请求会被拒绝。
2. **超过并发上限：** 默认最大并发子代理数为 10。达到此限制后，新的生成请求将排队或被拒绝。
3. **Gateway 连接失败：** 生成机制连接 Gateway（`http://127.0.0.1:18789`）。如果 Gateway 不可达，生成将失败。
4. **Gateway 标签长度：** 会话标签限制为 64 字符。任务 ID 自动截断为最后 12 个字符以适应此限制。

通过 `GET /api/v1/subagent-stats` 查看子代理的生成尝试、成功和失败计数器。

---

## 诊断端点

以下 REST API 端点可用于调试。所有端点在端口 19100 上提供服务。

| 端点 | 用途 |
|------|------|
| `GET /api/metrics` | RED 指标（速率、错误率、时延）+ 钩子统计 |
| `GET /api/v1/diagnostics` | 完整启动诊断报告 |
| `GET /api/v1/breaker-status` | 所有工具的熔断器状态 |
| `GET /api/v1/last-inject` | 最近一次提示注入快照 |
| `GET /api/v1/subagent-stats` | 子代理生成/成功/失败计数器 |
| `GET /api/v1/governance` | 合规统计（合规 vs 非合规轮次） |
| `GET /api/v1/ipc-stats` | IPC 延迟百分位数 |
| `GET /api/v1/convergence` | 状态收敛（嫌疑/死亡代理） |
| `GET /api/v1/dead-letters` | 死信队列条目 |
| `GET /api/v1/topology` | 代理协作拓扑 |
| `GET /api/v1/traces` | 近期执行追踪 |
| `GET /api/v1/affinity` | 任务-代理亲和度评分 |

**示例：**

```bash
curl http://127.0.0.1:19100/api/v1/diagnostics | jq .
```

---

## 获取帮助

1. **查看日志：** Gateway 日志和 SwarmCore 子进程日志包含详细的错误信息和源文件引用。
2. **运行诊断：** `curl http://127.0.0.1:19100/api/v1/diagnostics` 提供全面的健康报告。
3. **运行测试：** `npx vitest run` 验证环境中所有 1,365 个测试是否通过。
4. **检查事件：** `curl -N http://127.0.0.1:19100/events` 流式输出实时事件用于在线调试。
5. **浏览器开发者工具：** 在控制台 SPA 页面打开浏览器开发者控制台。SSE 连接状态和事件分发均有日志记录。

---

[← 返回 README](../../README.zh-CN.md) | [English](../en/faq-troubleshooting.md)
