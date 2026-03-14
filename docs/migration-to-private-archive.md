# Migration to Private Archive / 非开源资产迁移记录

**Date / 日期**: 2026-03-14
**Source / 源仓库**: `E:\OpenClaw\data\swarm`
**Target / 归档目标**: `E:\OpenClaw\data\Swarm-data\swarm-private-archive\`

---

## Migrated Items / 已迁移项

| Source Path / 源路径 | Target Path / 目标路径 | Files / 文件数 | Reason / 迁移原因 | Verified / 校验 |
|---|---|---|---|---|
| `.sisyphus/` | `swarm-private-archive/.sisyphus/` | 157 | Internal audit evidence / 内部审计证据链 | OK |
| `test-reports/` | `swarm-private-archive/test-reports/` | 25 | Runtime test reports / 运行时测试报告 | OK |
| `coverage/` | `swarm-private-archive/coverage/` | 217 | Vitest coverage output / 覆盖率产物 | OK |
| `internal/legacy-docs/` | `swarm-private-archive/internal/legacy-docs/` | 11 | Outdated V5/V6 docs / 旧版文档 | OK |
| `.gateway.pid` | `swarm-private-archive/.gateway.pid` | 1 | Runtime PID file / 运行时进程文件 | OK |
| `nul` | `swarm-private-archive/nul` | 1 | Windows artifact / Windows 空文件 | OK |
| `tools/audit-plan-compliance.mjs` | `swarm-private-archive/tools/audit-plan-compliance.mjs` | 1 | Internal audit script / 内部审计脚本 | OK |
| `tools/verify-followup-report.mjs` | `swarm-private-archive/tools/verify-followup-report.mjs` | 1 | Internal audit script / 内部审计脚本 | OK |
| `e2e-batch-tasks.mjs` | `swarm-private-archive/e2e-batch-tasks.mjs` | 1 | No automation reference / 无自动化引用 | OK |
| `e2e-debug.mjs` | `swarm-private-archive/e2e-debug.mjs` | 1 | No automation reference / 无自动化引用 | OK |
| `glossary.yml` (root) | `swarm-private-archive/glossary.yml` | 1 | Duplicate of `docs/qa/glossary.yml` / 与 QA 版重复 | OK |

**Total migrated / 总计**: 417 files

---

## Retained Items / 保留项

| Path / 路径 | Reason / 保留原因 |
|---|---|
| `src/` | Core source code / 核心源码 |
| `docs/` | Documentation / 文档 |
| `tests/` | Test suites / 测试集 |
| `souls/` | Agent persona definitions / 代理人格定义 |
| `tools/db-inspect.js` | Developer database tool / 开发者数据库工具 |
| `tools/export-pheromones.js` | Pheromone export tool / 信息素导出工具 |
| `tools/test-advisory.js` | Diagnostic script / 诊断脚本 |
| `tools/test-monitor.js` | Test monitor / 测试监控 |
| `tools/verify-e2e.js` | E2E verification / E2E 验证 |
| `README.md` | Bilingual README / 双语说明 |
| `README.zh-CN.md` | Chinese deep README / 中文详细说明 |
| `CHANGELOG.md` | Release history / 发布历史 |
| `CONTRIBUTING.md` | Contribution guide / 贡献指南 |
| `LICENSE` | MIT License |
| `package.json` | Package manifest |
| `package-lock.json` | Dependency lock |
| `openclaw.plugin.json` | Plugin manifest |
| `.github/` | CI + templates |
| `AGENTS.md` | Rewritten as historical note / 改写为历史说明 |
| `playwright.config.ts` | Referenced by CI and package.json / CI 引用 |
| `.markdown-link-check.json` | Docs QA config / 文档 QA 配置 |
| `docs/qa/glossary.yml` | Canonical terminology file / 规范术语表 |
