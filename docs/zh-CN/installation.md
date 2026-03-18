# 安装与配置

> Claw-Swarm V9.0.0 — 仿生群体智能插件（OpenClaw 生态）

[← 返回 README](../../README.zh-CN.md) | [English](../en/installation.md)

---

## 前置条件

| 要求 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 22.0.0 | `package.json` engines 字段强制要求 |
| npm | >= 9 | 随 Node.js 22+ 自带 |
| git | >= 2.30 | 用于克隆代码仓库 |
| OpenClaw | 最新版 | Gateway 必须已全局安装 |

**可选依赖**（安装后自动检测）：

| 包 | 用途 | 回退方案 |
|----|------|----------|
| `@xenova/transformers` ^2.0.0 | 本地嵌入模型（Xenova/all-MiniLM-L6-v2，384D） | 走 API 嵌入 |
| `usearch` ^2.0.0 | HNSW 向量搜索 | 线性扫描回退 |

---

## 安装步骤

### 第一步 — 全局安装 OpenClaw

```bash
npm install -g openclaw
```

验证安装：

```bash
openclaw --version
```

### 第二步 — 获取 Claw-Swarm

**方式 A — npm（推荐）**：

```bash
npm install openclaw-swarm
cd node_modules/openclaw-swarm
```

**方式 B — Git 克隆**：

```bash
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm
```

### 第三步 — 运行安装器

```bash
node install.js
```

此命令会将 Claw-Swarm 注册为 OpenClaw 插件，安装生产依赖，初始化 7 域架构（所有模块启用，零特性标志），并在 `~/.openclaw/openclaw.json` 中创建默认配置条目。

### 第四步 — 启动 Gateway

```bash
openclaw gateway restart
```

如果是首次启动，使用 `openclaw gateway start`。

### 第五步 — 验证安装

```bash
openclaw gateway status
```

输出中应包含：

```
claw-swarm  9.0.0  enabled
```

### 第六步 — 打开控制台

在浏览器中访问 `http://127.0.0.1:19100/v9/console`。控制台由 Gateway 进程内的 DashboardService 直接提供服务，无需单独启动开发服务器。

---

## 架构模式

V9.0 采用 **单进程网关内** 架构。所有 7 个域（约 121 个源文件）在 OpenClaw Gateway 进程内运行。无子进程 fork，无 IPC 桥接，无工作线程池。

| 属性 | 值 |
|------|-----|
| 进程模型 | 单进程，网关内运行 |
| 模块数量 | 约 110 个模块，横跨 7 个域 |
| 源文件数量 | 约 121 个源文件 |
| 信号架构 | 12 维信号场，ModuleBase produces/consumes 耦合 |

---

## 配置

所有配置位于 `~/.openclaw/openclaw.json` → `plugins.entries.openclaw-swarm.config`。每个设置都有合理默认值，插件可零配置运行。

### 信息素引擎（pheromone）

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `pheromone.decayInterval` | `60` | 衰减计算间隔（秒） |
| `pheromone.decayRate` | `0.05` | 每间隔默认衰减率 |

### 记忆（memory）

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `memory.inMemory` | `false` | 使用内存存储（不持久化到 DomainStore） |
| `memory.maxFocus` | `5` | 工作记忆焦点缓冲区容量 |
| `memory.maxContext` | `15` | 工作记忆上下文缓冲区容量 |
| `memory.maxScratch` | `30` | 工作记忆暂存区容量 |

### Dashboard

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `dashboard.enabled` | `true` | 启用 DashboardService |
| `dashboard.port` | `19100` | HTTP/SSE 端口 |

### 嵌入（embedding）

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `embedding.enabled` | `true` | 启用嵌入子系统 |
| `embedding.mode` | `local` | `local`（ONNX，384D）或 `api`（1536D） |
| `embedding.localModel` | `Xenova/all-MiniLM-L6-v2` | 本地模式模型标识 |
| `embedding.dimensions` | `384` | 嵌入向量维度 |

### 向量索引（vectorIndex）

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `vectorIndex.enabled` | `true` | 启用 HNSW 向量索引 |
| `vectorIndex.maxElements` | `50000` | 最大存储向量数 |
| `vectorIndex.metric` | `cosine` | 距离度量 |

### 信号校准器（signalCalibrator）

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `signal.floor` | `0.03` | 信号校准器最小权重 |
| `signal.cap` | `0.40` | 信号校准器最大权重 |

### 其他子系统

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `shapley.samples` | `100` | Monte Carlo Shapley 采样数 |
| `sna.computeInterval` | `50` | SNA 指标重算间隔（轮次） |
| `dualProcess.threshold` | `0.6` | System 1/2 路由阈值 |
| `hybridRetrieval.enabled` | `true` | 启用混合检索引擎 |
| `failureModeAnalyzer.enabled` | `true` | 启用失败模式分析 |
| `budgetForecaster.enabled` | `true` | 启用 token 预算预测 |
| `reputation.halfLifeDays` | `14` | 声誉指数衰减半衰期（天） |
| `metricsAlerting.enabled` | `true` | 启用指标告警子系统 |

---

## 12 维信号场

信号场是 V9.0 架构的基础底层。它提供响应式通信层，所有 7 个域都依赖于此。

信号场通过三个核心组件运作：

- **SignalStore** — 12 维信号存储与查询
- **ModuleBase** — 约 110 种模块子类，通过 produces/consumes 声明信号耦合
- **场中介耦合** — 模块通过信号存入和订阅进行交互，无需显式路由配置

无需显式配置。信号场在 Gateway 启动时自动初始化。

---

## 数据存储

Claw-Swarm V9.0 使用 DomainStore + JSON 快照进行持久化，替代 V8 的 SQLite 数据库。

| 属性 | 值 |
|------|-----|
| 默认路径 | `~/.openclaw/claw-swarm/` |
| 格式 | 按域分组的 JSON 快照 |
| 迁移 | 启动时自动从 V8 SQLite 迁移（如存在） |

数据按域组织（core、communication、intelligence、orchestration、quality、observe、bridge）。每个域管理自己的快照生命周期。

---

## 模型兼容性

Claw-Swarm 内置 35+ 个模型配置文件，每个模型使用 8 维能力向量进行 MoE（混合专家）路由。任何 OpenClaw 兼容模型均可使用；未知模型会获得回退配置。

代表性模型配置（全部支持工具调用）：

| 模型 | 失败率 | 模型 | 失败率 |
|------|--------|------|--------|
| `claude-opus-4-6` | 2% | `deepseek-r1` | 8% |
| `claude-sonnet-4-6` | 3% | `deepseek-chat` | 4% |
| `gpt-4o` | 3% | `qwen3.5-max` | 3% |
| `gpt-4.1` | 2% | `kimi-k2.5` | 12% |
| `gemini-2.5-pro` | 4% | `glm-5` / `minimax-m2.5` | 8% / 6% |

未知模型默认使用 10% 失败率。失败率影响熔断器灵敏度和双过程路由决策。

---

## 模块激活

V9.0 采用**零特性标志**架构。所有约 110 个模块（横跨 7 个域）始终激活。模块激活完全通过 `ModuleBase` 的 produces/consumes 耦合机制控制：声明了 `consumes: ['signal_type']` 的模块在该类型信号存入信号场时自动激活。无需手动标志配置。

---

## 网络端口

| 组件 | 默认端口 | URL |
|------|----------|-----|
| OpenClaw Gateway | 18789 | `http://127.0.0.1:18789` |
| Claw-Swarm Dashboard | 19100 | `http://127.0.0.1:19100` |
| Console SPA | 19100 | `http://127.0.0.1:19100/v9/console` |

**重要：** Gateway 使用 `127.0.0.1`，而非 `localhost`。所有内部 WebSocket 和 HTTP 连接必须使用 `127.0.0.1`，以避免 DNS 解析不一致导致的问题。

---

## 验证安装

`openclaw gateway start` 完成后，逐层验证：

```bash
openclaw gateway status                        # 应显示: claw-swarm 9.0.0 enabled
curl http://127.0.0.1:19100/api/metrics        # 应返回 RED 指标 JSON
curl -N http://127.0.0.1:19100/events          # 应输出实时 SSE 事件流
```

然后在浏览器中打开 `http://127.0.0.1:19100/v9/console`（应加载 6 个视图），并在 OpenClaw 对话中确认代理可使用 10 个工具。

---

## 常见安装问题

| 问题 | 解决方案 |
|------|----------|
| 插件未检测到 | 检查 `openclaw.json` 是否包含 `claw-swarm` 条目，然后 `openclaw gateway restart` |
| 端口 19100 被占用 | 孤立的 Gateway 进程；通过 `netstat` 查找 PID 并终止。参见[常见问题](faq-troubleshooting.md) |
| 数据目录权限错误 | 确保对 `~/.openclaw/claw-swarm/` 有写入权限 |
| Node.js 版本过低 | 需要 Node.js 22+，使用 `node --version` 检查 |
| Gateway 启动失败 | 先运行 `openclaw gateway stop`，检查端口 18789 是否可用 |

---

[← 返回 README](../../README.zh-CN.md) | [English](../en/installation.md)
