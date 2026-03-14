# Contributing to Claw-Swarm V7.0 / 贡献指南

Thank you for your interest in contributing to Claw-Swarm!
感谢你有兴趣为蜂群项目做贡献！

---

## Getting Started / 开始

### Prerequisites / 前置条件

- **Node.js >= 22.0.0** (requires built-in `node:sqlite`)
- **npm** (for dependency installation)

```bash
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm
npm install
npm test
```

### Project Structure / 项目结构

V7.0 organizes 173 source JS files across 6 layers with strict downward dependencies.
V7.0 将 173 个源文件组织在 6 个层级中，依赖严格向下流动。

```
src/
├── index.js                      # Plugin entry (19 hooks) / 插件入口（19 个钩子）
├── swarm-core.js                 # Fork child process entry / 子进程入口
├── event-catalog.js              # 122 EventTopics / 122 个事件主题
├── L1-infrastructure/  (25 files)  # Database (52 tables), config, IPC, workers
├── L2-communication/   (13 files)  # MessageBus, pheromone engine, gossip, relay
├── L3-agent/           (21 files)  # Memory, persona, reputation, embeddings, SNA
├── L4-orchestration/   (25 files)  # DAG, contract-net, ABC, Shapley, modulator
├── L5-application/     (18 files)  # Plugin adapter, tool resilience, 10 tools (4 public)
└── L6-monitoring/                  # Dashboard service (7 files) + console SPA (98 files)
```

**Dependency rule / 依赖规则:** Layers depend strictly downward (L6 -> L5 -> ... -> L1). Never import upward.
层级严格向下依赖，禁止向上导入。

### Running Tests / 运行测试

1463 tests across 105 test files, powered by Vitest.
105 个测试文件，1463 个测试用例，使用 Vitest。

```bash
npm test                  # All tests / 全部测试
npm run test:unit         # Unit tests / 单元测试
npm run test:integration  # Integration tests / 集成测试
npm run test:stress       # Stress tests / 压力测试

# Per-layer / 按层级
npm run test:L1           # Infrastructure
npm run test:L2           # Communication
npm run test:L3           # Agent
npm run test:L4           # Orchestration
npm run test:L5           # Application
npm run test:L6           # Monitoring

# Watch mode / 监听模式
npm run test:watch

# Coverage report / 覆盖率
npm run test:coverage
```

---

## How to Contribute / 如何贡献

### Reporting Bugs / 报告 Bug

1. Search existing issues to avoid duplicates / 搜索已有 issue 避免重复
2. Include / 请提供:
   - Node.js version (`node -v`)
   - OpenClaw version (if applicable)
   - Minimal reproduction steps / 最小复现步骤
   - Expected vs actual behavior / 期望行为 vs 实际行为

### Suggesting Features / 建议新功能

Open an issue with the `feature` label. Describe / 用 `feature` 标签提交 issue，描述:
- The problem you're solving / 你要解决的问题
- Your proposed solution / 你建议的方案
- Which layer it affects (L1-L6) / 涉及哪个层级

### Submitting Code / 提交代码

1. **Fork** the repository
2. Create a **feature branch**: `git checkout -b feature/my-feature`
3. Follow the coding standards below / 遵循下方编码规范
4. Write tests for your changes / 为你的改动编写测试
5. Ensure all tests pass: `npm test`
6. Submit a **Pull Request** with a clear description

---

## Coding Standards / 编码规范

### Language / 语言

- **Code**: JavaScript (ES modules, `import`/`export`)
- **Comments**: Bilingual (中英文双语). Module-level JSDoc + key function comments.
- **Documentation**: Bilingual Markdown

### Style / 风格

- 2 spaces indent
- Single quotes for strings
- No semicolons (follow existing codebase style)
- Use `const` by default, `let` when reassignment is needed, never `var`

### Module Comments / 模块注释

Every source file should have a module-level JSDoc header:

```javascript
/**
 * PheromoneEngine — 信息素引擎 / Pheromone Engine
 *
 * 负责信息素的发射、读取和衰减。
 * Handles pheromone emission, reading, and decay.
 *
 * @module L2-communication/pheromone-engine
 * @author DEEP-IOS
 */
```

### Testing / 测试

- Use **Vitest** (`import { describe, it, expect } from 'vitest'`)
- Test files: `tests/unit/L{n}/<module>.test.js`
- Each test should be independent (create/destroy DB per suite)
- Use `beforeEach` + `afterEach` for setup/teardown

### Architecture Rules / 架构规则

| Rule / 规则 | Description / 说明 |
|------|-------------|
| **No upward imports / 禁止向上导入** | L2 cannot import from L3+ |
| **Only L5 touches OpenClaw API** | L1-L4, L6 are framework-agnostic / 框架无关 |
| **Dependency injection / 依赖注入** | All engines receive deps via constructor |
| **Subsystem independence / 子系统独立** | Each module must work when others are absent |

---

## Subsystem Guidelines / 子系统指南

### Adding a New Pheromone Type / 添加新信息素类型

1. Register via `PheromoneTypeRegistry` or add to `BUILTIN_DEFAULTS` in `src/L2-communication/pheromone-engine.js`
2. Define `decayRate`, `maxTTLMin`, `mmasMin`, `mmasMax`
3. Add tests in `tests/unit/L2/pheromone-engine.test.js`

### Adding a New Tool / 添加新工具

1. Create `src/L5-application/tools/swarm-<name>-tool.js`
2. Export a factory function: `export function createSwarmNameTool(engines) { ... }`
3. Register in `plugin-adapter.js` `getTools()` method
4. Add tests in `tests/unit/L5/tools.test.js`

### Adding a New Repository / 添加新仓储

1. Create `src/L1-infrastructure/database/repositories/<name>-repo.js`
2. Add table DDL in `src/L1-infrastructure/schemas/database-schemas.js`
3. Wire into `DatabaseManager` and `PluginAdapter.init()`
4. Add tests in `tests/unit/L1/repositories.test.js`

---

## Documentation Contribution / 文档贡献

Claw-Swarm maintains bilingual documentation in `docs/en/` (English) and `docs/zh-CN/` (Chinese). When contributing documentation:

Claw-Swarm 在 `docs/en/`（英文）和 `docs/zh-CN/`（中文）维护双语文档。贡献文档时请注意：

1. **Parity** — every `docs/en/*.md` file must have a corresponding `docs/zh-CN/*.md` file with equivalent content.
   每个 `docs/en/*.md` 文件必须有对应的 `docs/zh-CN/*.md` 文件，内容等价。

2. **Glossary** — use the preferred translations defined in [`docs/qa/glossary.yml`](docs/qa/glossary.yml). Do not invent ad-hoc translations for established terms.
   使用 [`docs/qa/glossary.yml`](docs/qa/glossary.yml) 中定义的术语翻译，不要随意翻译已有术语。

3. **Metrics** — all numeric claims (table count, test count, file count, etc.) must match `docs/metadata.yml`. Run the verification commands listed there before submitting.
   所有数字指标必须与 `docs/metadata.yml` 一致，提交前请运行其中的验证命令。

4. **Source references** — every technical claim must cite the source file path. Do not describe features without linking to the implementation.
   每个技术陈述必须引用源文件路径，不要描述没有实现链接的功能。

---

## Release Process / 发布流程

1. Update version in `package.json` and `openclaw.plugin.json`
2. Update `CHANGELOG.md` with release notes (bilingual)
3. Verify metrics in `docs/metadata.yml` still match source code
4. Run full test suite: `npm test`
5. Commit: `git commit -m "release: vX.Y.Z"`
6. Tag: `git tag vX.Y.Z`
7. Push: `git push origin main --tags`

---

## Code of Conduct / 行为准则

Be respectful, constructive, and collaborative.
请保持尊重、建设性和协作精神。

---

## License / 许可证

By contributing, you agree that your contributions will be licensed under the MIT License.
通过贡献代码，你同意你的贡献将在 MIT 许可证下发布。
