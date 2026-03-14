# 安装与配置

## 前置条件

| 要求 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 22.0.0 | `package.json` engines 字段要求 |
| OpenClaw | 最新版 | Gateway 必须已安装并运行 |
| npm | >= 9 | 随 Node.js 22+ 附带 |

**可选依赖：** `@xenova/transformers` ^2.0.0（本地嵌入，384D）、`usearch` ^2.0.0（HNSW 向量搜索）。

## 安装

```bash
openclaw plugin install claw-swarm
```

**验证：** `openclaw plugin list` — 应显示 `claw-swarm 7.0.0 enabled`。

## 生产依赖

`ajv` ^8.18.0、`eventemitter3` ^5.0.1、`fastify` ^5.8.2、`nanoid` ^5.1.2、`pino` ^9.6.0、`tiktoken` ^1.0.22、`zod` ^3.24.2。

## 架构模式

| 模式 | 描述 |
|------|------|
| `hybrid`（默认） | Fork 进程 + 4 线程工作池 |
| `legacy` | 单进程模式，不推荐 |

## 配置

位于 `~/.openclaw/openclaw.json` → `plugins.entries.claw-swarm.config`。零配置即可运行。

### 数据库

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `database.path` | `<dataDir>/claw-swarm.db` | SQLite 数据库位置 |

模式版本 9，52 张表，WAL 模式，8 MB 页缓存，256 MB 内存映射 I/O。

### Dashboard

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `dashboard.port` | `19100` | DashboardService HTTP/SSE 端口 |
| `dashboard.host` | `localhost` | 绑定地址 |

启动 Gateway 后访问 `http://127.0.0.1:19100/v6/console`。

### 信息素引擎

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `pheromone.decayInterval` | `60`（秒） | 衰减计算间隔 |
| `pheromone.decayRate` | `0.05` | 每间隔默认衰减率 |

### 记忆

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `memory.focus` | `5` | 工作记忆焦点缓冲区容量 |
| `memory.context` | `15` | 工作记忆上下文缓冲区容量 |
| `memory.scratch` | `30` | 工作记忆暂存区容量 |

### Gossip 协议

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `gossip.fanout` | `3` | 每轮心跳扇出数 |
| `gossip.heartbeatMs` | `5000` | 心跳间隔 |

### 嵌入

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `embedding.mode` | `local` | `local`（Xenova ONNX，384D）或 `api`（可配置端点，1536D） |
| `embedding.model` | `Xenova/all-MiniLM-L6-v2` | 本地模式模型标识 |

### 向量索引

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `vectorIndex.maxElements` | `50000` | 最大存储向量数 |
| `vectorIndex.metric` | `cosine` | 距离度量 |

### 其他子系统

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `shapley.samples` | `100` | MC Shapley 采样数 |
| `sna.computeInterval` | `50` | SNA 指标重算间隔（轮次） |
| `reputation.halfLifeDays` | `14` | 声誉指数衰减半衰期（天） |
| `signal.floor` | `0.03` | 信号校准器最小权重 |
| `signal.cap` | `0.40` | 信号校准器最大权重 |

## 模型兼容性

来源：`src/index.js`（MODEL_CAPABILITIES）

| 模型 | 工具调用 | 失败率 |
|------|---------|--------|
| Kimi K2.5 | 支持 | 12% |
| Qwen 3.5 Plus | 支持 | 5% |
| Qwen 3.5 Max | 支持 | 3% |
| GLM-5 | 支持 | 8% |
| MiniMax M2.5 | 支持 | 6% |
| DeepSeek Chat | 支持 | 4% |
| DeepSeek Reasoner | 支持 | 10% |
| 未知模型 | 支持 | 10%（回退） |

## 特性标志

| 标志 | 默认 | 依赖 |
|------|------|------|
| `dagEngine` | 启用 | `hierarchical` |
| `workStealing` | 启用 | `dagEngine` |
| `speculativeExecution` | 禁用 | `dagEngine` |
| `evolution.scoring` | 启用 | — |
| `evolution.clustering/gep/abc` | 禁用 | `evolution.scoring` |

## 网络端口

| 组件 | 端口 | URL |
|------|------|-----|
| Gateway | 18789 | `http://127.0.0.1:18789` |
| Dashboard | 19100 | `http://127.0.0.1:19100` |
| 控制台 | 19100 | `http://127.0.0.1:19100/v6/console` |

**注意：** Gateway 使用 `127.0.0.1`，非 `localhost`。

## 验证安装

1. `openclaw plugin list` → claw-swarm 7.0.0 enabled
2. 浏览器打开 `http://127.0.0.1:19100/v6/console`
3. `curl http://127.0.0.1:19100/api/metrics` → JSON
4. `curl -N http://127.0.0.1:19100/events` → SSE 流

---
[← 返回 README](../../README.md) | [English](../en/installation.md)
