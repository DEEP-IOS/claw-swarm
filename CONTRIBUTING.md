# Contributing to Claw-Swarm v4.0 / 贡献指南

Thank you for your interest in contributing to Claw-Swarm!
感谢你有兴趣为蜂群项目做贡献！

---

## Getting Started / 开始

### Prerequisites / 前置条件

- **Node.js >= 22.0.0** (requires built-in `node:sqlite`)
- **Zero external dependencies** — no `npm install` needed for the plugin itself

### Project Structure / 项目结构

```
src/
├── layer1-core/          # Core infrastructure (DB, config, types, errors)
├── layer2-engines/       # Domain engines (memory, pheromone, governance)
├── layer3-intelligence/  # Swarm intelligence (soul, collaboration, orchestration)
└── layer4-adapter/       # OpenClaw plugin adapter (hooks, tools, services)
```

**Dependency rule:** Layers depend strictly downward (4 → 3 → 2 → 1). Never import upward.

### Running Tests / 运行测试

```bash
# All tests (unit + integration)
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Stress tests
npm run test:stress

# Migration tests (critical path)
npm run test:migration
```

---

## How to Contribute / 如何贡献

### Reporting Bugs / 报告 Bug

1. Search existing issues to avoid duplicates / 搜索已有 issue 避免重复
2. Include:
   - Node.js version (`node -v`)
   - OpenClaw version
   - Minimal reproduction steps / 最小复现步骤
   - Expected vs actual behavior / 期望行为 vs 实际行为

### Suggesting Features / 建议新功能

Open an issue with the `[Feature]` prefix. Please describe:
- The problem you're solving / 你要解决的问题
- Your proposed solution / 你建议的方案
- Which subsystem it affects (memory, pheromone, governance, soul, collaboration, orchestration)

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
- **Comments**: Bilingual (中英文双语). Module-level overview + key function why/how comments.
- **Documentation**: Bilingual Markdown files

### Style / 风格

- 2 spaces indent
- Single quotes for strings
- No semicolons (follow existing codebase style)
- Use `const` by default, `let` when reassignment is needed, never `var`

### Module Comments / 模块注释

Every file should have a module-level JSDoc comment explaining:
- **What** the module does (1-2 sentences)
- **Why** it exists (design rationale)
- Which layer it belongs to

```javascript
/**
 * PheromoneEngine — 信息素引擎 / Pheromone Engine
 *
 * 负责信息素的发射、读取、衰减和快照构建。
 * Handles pheromone emission, reading, decay, and snapshot building.
 *
 * [WHY] 信息素提供间接通信机制，与直接消息传递（collaborate-tool）互补。
 * Pheromones provide indirect communication, complementing direct messaging.
 *
 * @module pheromone-engine
 * @author DEEP-IOS
 */
```

### Testing / 测试

- Use Node.js built-in test runner (`node:test`)
- Use `node:assert/strict` for assertions
- Test files go in `tests/unit/` or `tests/integration/`
- Name pattern: `<module>.test.js`
- Each test should be independent (create/destroy DB per test file)

### Architecture Rules / 架构规则

| Rule | Description |
|------|-------------|
| **No upward imports** | Layer 2 cannot import from Layer 3 or 4 |
| **No cross-engine imports** | `memory/` cannot import from `pheromone/` |
| **Only Layer 4 touches OpenClaw API** | Layer 1-3 are framework-agnostic |
| **Zero external deps** | Only `node:*` built-in modules allowed |
| **Subsystem independence** | Each subsystem must work when others are disabled |

---

## Subsystem Guidelines / 子系统指南

### Adding a New Pheromone Type / 添加新信息素类型

1. Add the type to `src/layer2-engines/pheromone/pheromone-types.js`
2. Define default decay rate and max TTL
3. Add tests in `tests/unit/pheromone-engine.test.js`
4. Update `docs/pheromone-model.md`

### Adding a New Persona Template / 添加新人格模板

1. Add to `src/layer3-intelligence/soul/persona-templates.js`
2. Or provide via config: `config.soul.personas['my-bee'] = { ... }`
3. Add tests in `tests/unit/soul-designer.test.js`
4. Update `docs/soul-designer.md`

### Adding a New Collaboration Strategy / 添加新协作策略

1. Add to `src/layer3-intelligence/collaboration/strategies.js`
2. Add tests in `tests/unit/collaboration-strategies.test.js`

### Adding a New Tool / 添加新工具

1. Create `src/layer4-adapter/tools/my-tool.js`
2. Export `{ myToolDefinition, createMyToolHandler }`
3. Register in `plugin-adapter.js` under the appropriate subsystem guard
4. Add tests in `tests/unit/tools.test.js`

---

## Release Process / 发布流程

1. Update version in `package.json`
2. Update `CHANGELOG.md` with release notes
3. Run full test suite: `npm test && npm run test:stress`
4. Tag: `git tag v<version>`
5. Push: `git push origin main --tags`

---

## Code of Conduct / 行为准则

Be respectful, constructive, and collaborative.
请保持尊重、建设性和协作精神。

---

## License / 许可证

By contributing, you agree that your contributions will be licensed under the MIT License.
通过贡献代码，你同意你的贡献将在 MIT 许可证下发布。
