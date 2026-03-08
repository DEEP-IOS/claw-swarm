# Contributing to Claw-Swarm V5.0 / 贡献指南

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

```
src/
├── L1-infrastructure/    # 基础设施: 数据库, 配置, 类型, 日志
├── L2-communication/     # 通信: 消息总线, 信息素引擎, Gossip
├── L3-agent/             # Agent: 记忆系统, 能力引擎, 人格进化
├── L4-orchestration/     # 编排: DAG 调度, 质量门控, CNP, ABC
├── L5-application/       # 应用: OpenClaw 插件适配, 工具
├── L6-monitoring/        # 监控: 仪表盘, 指标, SSE 广播
└── index.js              # 插件入口 / Plugin entry point
```

**Dependency rule / 依赖规则:** Layers depend strictly downward (L6 -> L5 -> ... -> L1). Never import upward.
层级严格向下依赖，禁止向上导入。

### Running Tests / 运行测试

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

1. Register via `PheromoneTypeRegistry` or add to `BUILTIN_DEFAULTS` in `L2-communication/pheromone-engine.js`
2. Define `decayRate`, `maxTTLMin`, `mmasMin`, `mmasMax`
3. Add tests in `tests/unit/L2/pheromone-engine.test.js`

### Adding a New Tool / 添加新工具

1. Create `src/L5-application/tools/swarm-<name>-tool.js`
2. Export a factory function: `export function createSwarmNameTool(engines) { ... }`
3. Register in `plugin-adapter.js` `getTools()` method
4. Add tests in `tests/unit/L5/tools.test.js`

### Adding a New Repository / 添加新仓储

1. Create `src/L1-infrastructure/database/repositories/<name>-repo.js`
2. Add table DDL in `schemas/database-schemas.js`
3. Wire into `DatabaseManager` and `PluginAdapter.init()`
4. Add tests in `tests/unit/L1/repositories.test.js`

---

## Release Process / 发布流程

1. Update version in `package.json` and `openclaw.plugin.json`
2. Update `CHANGELOG.md` with release notes (bilingual)
3. Run full test suite: `npm test`
4. Commit: `git commit -m "release: vX.Y.Z"`
5. Tag: `git tag vX.Y.Z`
6. Push: `git push origin main --tags`

---

## Code of Conduct / 行为准则

Be respectful, constructive, and collaborative.
请保持尊重、建设性和协作精神。

---

## License / 许可证

By contributing, you agree that your contributions will be licensed under the MIT License.
通过贡献代码，你同意你的贡献将在 MIT 许可证下发布。
