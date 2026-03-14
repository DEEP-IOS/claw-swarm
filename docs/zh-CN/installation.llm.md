# Claw-Swarm 安装指南 — LLM 代理专用

> 为 LLM 上下文窗口优化的精简安装指南。

## 前置条件

- Node.js >= 22.0.0
- OpenClaw CLI 已安装（`npm install -g openclaw`）

## 安装

```bash
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm && node install.js
openclaw gateway restart
```

## 验证

```bash
openclaw gateway status
# 应显示: claw-swarm 7.0.0 enabled
```

## 配置

配置路径：`~/.openclaw/openclaw.json` → `plugins.entries.claw-swarm.config`

零配置即可运行，所有参数有默认值。

核心配置项：
- `dashboard.port`：19100（默认）
- `pheromone.decayInterval`：60 秒（默认）
- `memory.focus`：5 个槽位（默认）
- `embedding.mode`：`local`（Xenova 384D）或 `api`（1536D）

## 网络端口

| 组件 | 端口 | 访问地址 |
|------|------|----------|
| Gateway | 18789 | `http://127.0.0.1:18789` |
| Dashboard | 19100 | `http://127.0.0.1:19100` |
| 控制台 | 19100 | `http://127.0.0.1:19100/v6/console` |

重要提示：必须使用 `127.0.0.1`，不要用 `localhost`。

## 特性标志

默认启用：`toolResilience`、`healthChecker`、`hierarchical`、`dagEngine`、`workStealing`、`evolution.scoring`

默认禁用：`speculativeExecution`、`contextEngine`、`skillGovernor`、`evolution.clustering/gep/abc/lotkaVolterra`

## 故障排查

- 端口 19100 被占用 → 杀死孤立的 `swarm-core.js` 进程后重启 Gateway
- 工具返回 "not_ready" → 等待 3-5 秒，SwarmCore 正在初始化
- Dashboard 数据全零 → 触发一次蜂群操作以生成事件
- IPC 超时 → 重启 Gateway：`openclaw gateway stop && openclaw gateway start`

## 数据库

路径：`~/.openclaw/claw-swarm/claw-swarm.db`
引擎：SQLite（WAL 模式），52 张表，模式版本 9
启动时由 MigrationRunner 自动迁移
