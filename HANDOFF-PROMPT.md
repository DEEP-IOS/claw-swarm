# 交接 Prompt — 直接粘贴到新 session

---

```
你正在接手 Claw-Swarm V9.0.0 的后续工作。这是一个 OpenClaw 蜂群智能插件，7域架构 + 双基座 + 12维信号场，121个源文件(25,447行)，1,365个测试。

## 项目位置
- 源码: E:\OpenClaw\data\swarm\
- 入口: src/index.js → src/index-v9.js → src/swarm-core-v9.js
- Gateway 配置: C:\Users\ASUS\.openclaw\openclaw.json
- 快照存储: ~/.openclaw/claw-swarm/snapshots/
- Dashboard: http://127.0.0.1:19100/api/v9/health
- Gateway: http://127.0.0.1:18789

## 当前状态 (2026-03-18)
- 版本: V9.0.0
- 架构: 7域 (core/communication/intelligence/orchestration/quality/observe/bridge)
- 双基座: SignalField (12维前向衰减) + DomainStore (内存+JSON快照) + EventBus (27事件)
- 工具: 10个 (swarm_run/query/dispatch/checkpoint/spawn/pheromone/gate/memory/plan/zone)
- 钩子: 16个 (通过 bridge/hooks/hook-adapter.js 注册)
- REST端点: 57+ (port 19100, dashboard-service.js)
- 测试: 1,365/1,366 (1个已知非阻塞失败)
- Feature Flag: 零
- V8遗留: 已完全删除 (src/L0-L6 + swarm-core.js 全部移除)

## 7域结构
- core/ (12文件, 1,953行): signal-store.js, domain-store.js, event-bus.js, module-base.js
- communication/ (8文件, 1,281行): pheromone-engine.js, task-channel.js, stigmergic-board.js
- intelligence/ (34文件, 5,606行): identity/ memory/ social/ artifacts/ understanding/
- orchestration/ (24文件, 6,889行): planning/ adaptation/ scheduling/
- quality/ (10文件, 2,738行): gate/ resilience/ analysis/
- observe/ (13文件, 1,651行): dashboard/ metrics/ health/ broadcast/
- bridge/ (24文件, 4,526行): tools/ hooks/ session/ reliability/ interaction/

## 关键设计决策
- ModuleBase 替代 MeshNode: 每模块声明 produces()/consumes()/publishes()/subscribes()
- 单进程模型: 不再 fork, SwarmCoreV9 直接在 Gateway 进程内运行
- 场中介耦合: 域间通过 SignalField 交互, 不直接导入
- _verifyCoupling(): 启动时静态检查所有维度都有生产者和消费者

## 用户硬性约束
- 禁止 "claude" 字样 (模型名除外)
- 作者仅 DEEP-IOS, License AGPL-3.0
- 测试必须真实浏览器验证 (Chrome MCP), 不用 preview 工具
- Dashboard 用 port 19100 (DashboardService), 不启动 vite
- URL 用 127.0.0.1 不用 localhost
- 中文交流
- 只有版本能完美运行时才 commit

## 规划文档
- docs/v9/ (27个文件, ~15,000行): 完整V9规划与spec
- docs/v9/05-behavior/system-behavior-guide.md: 14章系统行为指南
- docs/v9/99-signoff/: 验证报告 (代码级55/55 + 浏览器58/58)

## 你的第一步
请先阅读 HANDOFF-CODE-MAP.md 获取代码定位信息，然后告诉我你已了解当前状态。
```

---

## 使用说明

1. 将上面 ``` 包裹的内容完整粘贴到新 session 的第一条消息
2. 等 AI 确认已阅读交接文件
3. 然后告诉它你要做的下一步工作

如果新 session 需要更多上下文，MEMORY.md (`C:\Users\ASUS\.claude\projects\E--\memory\MEMORY.md`) 包含从 V5.1 到 V9.0 的完整历史。
