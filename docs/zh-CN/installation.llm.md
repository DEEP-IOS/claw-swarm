# Claw-Swarm 安装指南 — LLM 代理专用

> 为 LLM 上下文窗口优化的精简安装指南。

## 前置条件

- Node.js >= 22.0.0
- OpenClaw CLI 已安装（`npm install -g openclaw`）

## 安装

```bash
# 方式 A: npm（推荐）
npm install openclaw-swarm && cd node_modules/openclaw-swarm && node install.js

# 方式 B: git 克隆
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm && node install.js

openclaw gateway restart
```

## 验证

```bash
openclaw gateway status
# 应显示: claw-swarm 9.2.0 enabled
```

## 配置

配置路径：`~/.openclaw/openclaw.json` → `plugins.entries.openclaw-swarm.config`

零配置即可运行。零功能开关——所有模块始终活跃。

核心配置项（7域结构）：
- `field.maxSignals`：100000（默认）
- `observe.dashboard.port`：19100（默认）
- `communication.pheromone.decayInterval`：60000 ms（默认）
- `intelligence.embedding.mode`：`local`（Xenova 384D）或 `api`（1536D）
- `orchestration.budget.maxTokens`：1000000（默认）

## 网络端口

| 组件 | 端口 | 访问地址 |
|------|------|----------|
| Gateway | 18789 | `http://127.0.0.1:18789` |
| Dashboard API | 19100 | `http://127.0.0.1:19100/api/v9/health` |

重要提示：必须使用 `127.0.0.1`，不要用 `localhost`。

## 数据存储

路径：`~/.openclaw/claw-swarm/snapshots/`
引擎：内存 DomainStore + JSON 快照持久化
无 SQLite 依赖。

## 故障排查

- 端口 19100 被占用 → 杀死孤立进程后重启 Gateway
- 工具返回 "not_ready" → 等待 3-5 秒，SwarmCoreV9 正在初始化
- Dashboard 数据全零 → 触发一次蜂群操作以生成事件
