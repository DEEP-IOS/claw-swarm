[English](README.md) | **中文**

# Claw-Swarm

仿生群体智能插件 —— 基于蜂群协作模型的 [OpenClaw](https://github.com/nicepkg/openclaw) 多代理协调系统。

![Version](https://img.shields.io/badge/version-7.0.0-blue)
![Tests](https://img.shields.io/badge/tests-1463_passing-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

---

## 解决什么问题

协调多个 LLM 代理面临以下困境：代理无法看到彼此的进度，上下文窗口重置后知识丢失，单个工具故障即可导致全线崩溃。手动任务路由无法规模化，且缺乏标准方式在运行时观察代理群体行为。

## Claw-Swarm 做了什么

- **信息素间接通信** —— 代理通过类型化信号踪迹间接协调，无需直接消息传递（`src/L2-communication/pheromone-engine.js`）
- **三层记忆 + 遗忘曲线** —— 工作记忆、情景记忆、语义记忆跨上下文重置存活（`src/L3-agent/memory/`）
- **DAG 任务分解 + 合同竞标** —— 自动任务拆分、关键路径分析、拍卖式分配（`src/L4-orchestration/task-dag-engine.js`、`src/L4-orchestration/contract-net.js`）
- **工具级熔断器 + 重试注入** —— AJV 预校验将故障隔离在扩散之前（`src/L5-application/tool-resilience.js`）
- **6 视图实时监控控制台** —— React SPA：蜂巢、管线、认知、生态、网络、控制（`src/L6-monitoring/console/`）
- **人在回路检查点** —— 代理在不可逆操作前暂停执行，等待用户批准（`src/L5-application/tools/swarm-checkpoint-tool.js`）

---

## 控制台

![Console](docs/dashboard-preview.png)

6 视图 React SPA 监控面板，端口 19100。视图：Hive、Pipeline、Cognition、Ecology、Network、Control。包含命令面板（Ctrl+K）、事件时间线、代理检查器、实时通知 Toast（通过 SSE）。

---

## 快速开始

**1. 安装 OpenClaw 和 Claw-Swarm：**

```bash
npm install -g openclaw
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm && node install.js
```

**2. 启用插件：**

```bash
openclaw gateway restart
```

**3. 验证插件已加载：**

```bash
openclaw gateway status
# 在已加载插件列表中查找 "claw-swarm"
```

**4. 打开控制台：**

```
http://127.0.0.1:19100
```

详见 [docs/zh-CN/installation.md](docs/zh-CN/installation.md) 了解手动安装、配置选项和模型兼容性。

---

## 架构一览

```
层     名称           描述                                          文件数
-----  -----------    -------------------------------------------   -----
 L1    基础设施       SQLite（52 表）、配置、IPC 桥接、                 25
                      工作线程池、迁移、8 个仓库
 L2    通信           消息总线、信息素引擎、Gossip、                     13
                      痕迹协作板、协议语义
 L3    代理           三层记忆、人格进化、声誉、                         21
                      嵌入（HNSW）、SNA、失败疫苗
 L4    编排           DAG 引擎、合同网、ABC 调度、                       25
                      种群进化、Shapley 信用、调节器
 L5    应用           插件适配器、工具弹性、10 个工具                     18
                      工厂、技能治理、检查点
 L6    监控           Dashboard 服务（38 REST 端点）、                 7+98
                      状态广播、指标、控制台 SPA
```

依赖严格向下流动（L6 -> L1）。仅 L5 耦合 OpenClaw Plugin SDK。L1-L4 和 L6 可在任何 Node.js 22+ 环境复用。

进程模型：`child_process.fork()` 将蜂群核心与 OpenClaw Gateway 隔离。4 线程 `WorkerPool` 在主事件循环外处理计算密集任务（ACO、k-means、HNSW、Shapley Monte Carlo）。

-> [完整架构指南](docs/zh-CN/architecture.md)

---

## 仿生算法

| 算法 | 来源 | 用途 |
|---|---|---|
| MMAS（最大最小蚁群系统） | `src/L2-communication/pheromone-engine.js` | 信息素浓度边界控制 |
| ACO 轮盘选择 | `src/L2-communication/pheromone-engine.js` | 概率性任务路径选择 |
| Ebbinghaus 遗忘曲线 | `src/L3-agent/memory/episodic-memory.js` | 记忆随时间衰减 |
| FRTM + PI 控制器 | `src/L3-agent/response-threshold.js` | 自适应代理任务响应阈值 |
| 失败疫苗 | `src/L3-agent/failure-vaccination.js` | 基于模式的免疫记忆 |
| FIPA 合同网协议 | `src/L4-orchestration/contract-net.js` | 拍卖式任务竞标 |
| ABC（人工蜂群） | `src/L4-orchestration/abc-scheduler.js` | 三阶段雇佣蜂/旁观蜂/侦察蜂调度 |
| Lotka-Volterra 动力学 | `src/L4-orchestration/species-evolver.js` | 带承载容量的种群竞争 |
| Monte Carlo Shapley | `src/L4-orchestration/shapley-credit.js` | 跨代理联盟公平信用分配 |
| 互信息校准 | `src/L4-orchestration/signal-calibrator.js` | 决策信号自动权重校准 |

-> [完整仿生学指南](docs/zh-CN/biomimicry.md)

---

## 工具与钩子

### 公开工具（暴露给 LLM 代理）

| 工具 | 用途 | 来源 |
|---|---|---|
| `swarm_run` | 规划 + 生成一键执行 | `src/L5-application/tools/swarm-run-tool.js` |
| `swarm_query` | 查询蜂群状态、代理、任务进度 | `src/L5-application/tools/swarm-query-tool.js` |
| `swarm_dispatch` | 通过中继向子代理分派任务 | `src/L5-application/tools/swarm-dispatch-tool.js` |
| `swarm_checkpoint` | 暂停执行等待人工批准 | `src/L5-application/tools/swarm-checkpoint-tool.js` |

另有 6 个内部工具（spawn、pheromone、gate、memory、plan、zone）供编排层使用，不直接暴露给终端用户代理。

**钩子：** 19 个 OpenClaw 钩子注册在 `src/index.js`，覆盖完整代理生命周期——Gateway 启停、模型解析、Prompt 组装、工具调用、代理启停、子代理生命周期、LLM 输出、会话重置。

-> [API 参考](docs/zh-CN/api-reference.md)

---

## 关键数字

| 指标 | 值 | 来源 |
|---|---|---|
| 版本 | 7.0.0 | `package.json` |
| 测试通过 | 1463 | `npx vitest run` |
| 事件主题 | 122 | `src/event-catalog.js` |
| 数据库表 | 52 | `src/L1-infrastructure/schemas/database-schemas.js` |
| 注册钩子 | 19 | `src/index.js` |
| 源 JS 文件 | 173 | `find src -name "*.js"（排除 node_modules）` |
| 控制台源文件 | 98 | `src/L6-monitoring/console/src/` |
| 工具文件 | 10（4 个公开） | `src/L5-application/tools/` |

所有指标均源自源代码。验证命令列于 `docs/metadata.yml`。

---

## 文档

| 指南 | 描述 |
|---|---|
| [架构设计](docs/zh-CN/architecture.md) | 6 层设计、进程模型、依赖流 |
| [API 参考](docs/zh-CN/api-reference.md) | 工具、钩子、REST 端点、SSE 事件 |
| [仿生学与设计哲学](docs/zh-CN/biomimicry.md) | 算法目录及源码引用 |
| [模块指南 (L1-L6)](docs/zh-CN/module-guide.md) | 每模块职责与接口文档 |
| [安装与配置](docs/zh-CN/installation.md) | 安装、配置选项、模型兼容性 |
| [常见问题与故障排查](docs/zh-CN/faq-troubleshooting.md) | 常见问题与解决方案 |
| [控制台指南](docs/zh-CN/console-guide.md) | Dashboard 视图、快捷键、SSE |

英文文档：[docs/en/](docs/en/)

---

## 贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发设置、编码规范、架构规则和 Pull Request 指南。

## 安全

详见 [SECURITY.md](SECURITY.md) 了解支持版本和漏洞报告。

## 许可证

MIT License. Copyright 2025-2026 DEEP-IOS. 详见 [LICENSE](LICENSE)。
