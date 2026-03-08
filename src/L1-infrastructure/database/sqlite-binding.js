/**
 * SQLite Binding — node:sqlite 兼容层 / node:sqlite compatibility layer
 *
 * 封装 node:sqlite 的 DatabaseSync, 使其在 Vitest/Vite 环境下可用。
 * Wraps node:sqlite's DatabaseSync to work in Vitest/Vite environments.
 *
 * [WHY] 为什么不能直接 `import { DatabaseSync } from 'node:sqlite'`?
 *       因为 Vite/Vitest 的 ESM 模块解析器不认识 node: 前缀的内置模块,
 *       会尝试将其作为外部 npm 包解析并报 ERR_MODULE_NOT_FOUND。
 *       使用 createRequire() 可以走 CJS 模块解析路径, 绕过 Vite 限制。
 *
 * [WHY] Why not just `import { DatabaseSync } from 'node:sqlite'`?
 *       Vite/Vitest ESM module resolver doesn't recognize node: prefixed
 *       builtins and will try to resolve them as external npm packages,
 *       resulting in ERR_MODULE_NOT_FOUND. Using createRequire() goes
 *       through the CJS resolution path, bypassing Vite's limitation.
 *
 * [PREREQ] 前提条件 / Prerequisites:
 *       - Node.js >= 22.0.0 (node:sqlite 自 Node 22 起内置)
 *       - node:sqlite is built-in since Node 22
 *
 * [MAINTAINER] 维护者注意 / Maintainer notes:
 *       如果未来 Vite 支持 node: 前缀解析, 可直接改为 ESM import 并删除此文件。
 *       If Vite adds native node: prefix support in the future, this file
 *       can be replaced with a direct ESM import.
 *
 * @module L1-infrastructure/database/sqlite-binding
 * @author DEEP-IOS
 */

import { createRequire } from 'node:module';

// 使用 createRequire 构建 CJS require 函数, 以兼容 Vite 的模块解析
// Build a CJS require function via createRequire for Vite module resolution compatibility
const require = createRequire(import.meta.url);

// 加载 node:sqlite 内置模块并导出 DatabaseSync 类
// Load node:sqlite built-in module and re-export DatabaseSync class
const sqliteModule = require('node:sqlite');

export const DatabaseSync = sqliteModule.DatabaseSync;
