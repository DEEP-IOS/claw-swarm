# Contributing to Claw-Swarm V9.2 / 贡献指南

Thank you for your interest in contributing to Claw-Swarm!
感谢你有兴趣为蜂群项目做贡献！

---

## Getting Started / 开始

### Prerequisites / 前置条件

- **Node.js >= 22.0.0**
- **npm** (for dependency installation)

```bash
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm
npm install
npm test
```

### Project Structure / 项目结构

V9.2 organizes 121 source JS files across 7 domains with field-mediated coupling.
V9.2 将 121 个源文件组织在 7 个域中，通过场中介耦合连接。

```
src/
├── index.js                          # Plugin entry (V8 API adapter) / 插件入口
├── index-v9.js                       # V9 activation / V9 激活
├── swarm-core-v9.js                  # Core orchestrator (475 lines) / 核心编排器
├── core/                (12 files)    # SignalField, DomainStore, EventBus, ModuleBase
├── communication/        (8 files)    # Pheromones (MMAS), task channels, stigmergy
├── intelligence/        (34 files)    # Memory, identity, social, artifacts, understanding
├── orchestration/       (24 files)    # DAG planner, adaptation, scheduling
├── quality/             (10 files)    # Evidence gate, circuit breaker, vaccination
├── observe/             (13 files)    # Dashboard (57+ REST), metrics, health, SSE
└── bridge/              (24 files)    # 10 tools, 16 hooks, session, model fallback
```

**Coupling rule / 耦合规则:** Domains communicate through the signal field, event bus, and domain store — not through direct imports. Each module extends `ModuleBase` and declares `produces()`/`consumes()` for static coupling verification.

域间通过信号场、事件总线和域存储通信，不通过直接导入。每个模块继承 `ModuleBase` 并声明 `produces()`/`consumes()` 以支持静态耦合验证。

### Running Tests / 运行测试

1,697 tests across 107 test files, powered by Vitest 2.1.8.

```bash
npm test                  # All tests / 全部测试
npx vitest run            # Same, explicit / 显式运行
npx vitest run tests/core/        # Core domain / 核心域
npx vitest run tests/bridge/      # Bridge domain / 桥接域
npx vitest run --watch    # Watch mode / 监视模式
npx vitest run --coverage # Coverage report / 覆盖率报告
```

---

## How to Contribute / 如何贡献

### Reporting Bugs / 报告 Bug

1. Search existing issues to avoid duplicates
2. Include: Node.js version, OpenClaw version, reproduction steps, expected vs actual behavior

### Submitting Code / 提交代码

1. **Fork** the repository
2. Create a **feature branch**: `git checkout -b feature/my-feature`
3. Follow coding standards (2-space indent, single quotes, no semicolons, ES modules)
4. Write tests for your changes
5. Ensure all 1,697+ tests pass: `npm test`
6. Submit a **Pull Request**

---

## Architecture Rules / 架构规则

| Rule / 规则 | Description / 描述 |
|------|-------------|
| Field-mediated coupling | Domains interact through SignalField, not direct imports / 域通过信号场交互 |
| ModuleBase contract | All modules declare `produces()`/`consumes()`/`publishes()`/`subscribes()` |
| Only bridge/ touches OpenClaw API | core/ through observe/ are framework-agnostic / 仅 bridge 层接触 OpenClaw |
| Dependency injection | All modules receive deps via constructor / 所有模块通过构造函数接收依赖 |
| Zero feature flags | No `enabled: true/false` config. Code exists = code runs / 无功能开关 |
| Zero idle modules | Every module must have producers and consumers in the field / 每个模块必须有场耦合 |

### Adding a New V9 Module / 添加新的 V9 模块

1. Extend `ModuleBase` from `src/core/module-base.js`
2. Implement `static produces()` — return `DIM_*` constants this module emits
3. Implement `static consumes()` — return `DIM_*` constants this module reads
4. Implement `static publishes()` / `static subscribes()` for EventBus topics
5. Add to the domain factory (`src/{domain}/index.js`) inside `allModules()` return
6. Verify coupling: `SwarmCoreV9._verifyCoupling()` will check produces/consumes connectivity
7. Add tests in `tests/{domain}/`

---

## Documentation / 文档

- Bilingual: `docs/en/` + `docs/zh-CN/` (11 pairs)
- V9 planning: `docs/v9/` (27 files, ~15,000 lines)
- Every technical claim must cite a source file path
- All numbers must match: `find src -name "*.js" -not -path "*/console/*" | wc -l` → 121

---

## License / 许可证

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 License.
通过贡献代码，你同意你的贡献将在 AGPL-3.0 许可证下发布。
