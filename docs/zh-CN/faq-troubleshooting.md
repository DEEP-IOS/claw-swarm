# 常见问题与故障排查

## 常见问题

### Claw-Swarm 是什么？

OpenClaw 插件，通过群体智能实现多代理协作。使用信息素、蜂群调度、免疫检测等生物算法。详见[仿生学与设计哲学](biomimicry.md)。

### 暴露多少个工具？

4 个公开：`swarm_run`、`swarm_query`、`swarm_dispatch`、`swarm_checkpoint`。6 个内部（已废弃，功能并入钩子）。详见 [API 参考](api-reference.md)。

### 支持哪些模型？

支持任何工具调用模型。已测试：Kimi K2.5、Qwen 3.5 Plus/Max、GLM-5、MiniMax M2.5、DeepSeek Chat/Reasoner。参见 `src/index.js` MODEL_CAPABILITIES。

### 最低 Node.js 版本？

22.0.0。由 `package.json` engines 字段要求。

### 数据库在哪里？

`~/.openclaw/claw-swarm/claw-swarm.db`。SQLite WAL 模式，52 个表，模式版本 9。

---

## 故障排查

### 端口 19100 被占用

**现象：** `EADDRINUSE :::19100`。
**原因：** 孤立的 swarm-core.js 子进程。
**修复：** 查找并杀死占用进程，然后重启 Gateway。
```bash
# Windows: netstat -ano | findstr ":19100" → taskkill /F /PID <PID>
# Linux:   lsof -i :19100 → kill -9 <PID>
openclaw gateway stop && openclaw gateway start
```

### 工具返回 "not_ready"

**原因：** SwarmCore 子进程初始化中（`_swarmCoreReady` 标志未设置）。
**修复：** 等 3-5 秒重试。如持续，检查 Gateway 日志和数据库文件可访问性。

### Dashboard 全零

**原因：** `stateBroadcaster.start()` 未调用，或无事件发布。
**修复：** 触发蜂群操作生成事件。检查 SSE：`curl -N http://127.0.0.1:19100/events`。

### IPC 超时

**原因：** IPC 桥接卡住（默认 5 秒，工具代理 30 秒）。
**修复：** 检查子进程存活状态，重启 Gateway。来源：`src/L1-infrastructure/ipc-bridge.js`。

### WebSocket 连接失败

**原因：** Gateway 使用 `127.0.0.1:18789`，非 `localhost`。
**修复：** 所有内部 URL 使用 `127.0.0.1`。

### 信息素发射失败

**原因：** 缺少 `targetScope` 参数。
**修复：** 必须传入 `targetScope`（如 `/task/123`）。来源：`src/L2-communication/pheromone-engine.js`。

### Stigmergic Board 返回 undefined

**原因：** StigmergicBoard 需要 `dbManager.getDb()`，而非 `engines.db`。
**修复：** 内部初始化问题。如代码更新后出现此问题，检查 `plugin-adapter.js` 中 StigmergicBoard 是否接收了正确的数据库引用。

### Gateway 标签超过 64 字符

**现象：** 任务标签被静默截断或忽略。
**原因：** OpenClaw Gateway 对会话标签强制 64 字符上限。
**修复：** 标签中 taskId 已自动截断为 12 字符：`swarm:taskId.slice(-12):agentId`。格式定义见 `src/L5-application/tools/swarm-run-tool.js:44-58`。

### CJK 目标文本触发直接回复而非蜂群执行

**现象：** 短中文目标（如 5 个字符）绕过 swarm_run 规划，直接回复。
**原因：** `goal.length < 10` 按 UTF-16 码元计数，低估了 CJK 文本复杂度。
**修复：** 已知限制。使用更长的目标描述（>10 字符），或显式指定模式：`swarm_run({goal: "...", mode: "auto"})`。

### 模式版本不匹配

**修复：** MigrationRunner 自动升级。如失败：备份 → 删除 → 重启。

### 检查点卡住

**原因：** 用户未回复或未再次调用 swarm_run。
**修复：** 在父会话回复检查点问题，然后调用 swarm_run 触发自动检测。

---

## 诊断端点

| 端点 | 用途 |
|------|------|
| `GET /api/metrics` | RED 指标 + hook 统计 |
| `GET /api/v1/diagnostics` | 启动诊断报告 |
| `GET /api/v1/breaker-status` | 熔断器状态 |
| `GET /api/v1/last-inject` | 最近 Prompt 注入快照 |
| `GET /api/v1/subagent-stats` | 子代理计数器 |
| `GET /api/v1/governance` | 合规统计 |
| `GET /api/v1/ipc-stats` | IPC 延迟百分位 |
| `GET /api/v1/convergence` | 状态收敛（嫌疑/死亡代理） |

示例：`curl http://127.0.0.1:19100/api/v1/diagnostics | jq .`

---
[← 返回 README](../../README.md) | [English](../en/faq-troubleshooting.md)
