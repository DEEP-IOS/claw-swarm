#!/usr/bin/env node
/**
 * export-pheromones.js — 信息素 JSON 导出工具
 * Pheromone JSON export utility
 *
 * 将当前 swarm 数据库中所有活跃信息素导出为结构化 JSON。
 * Exports all active pheromones from the swarm DB to structured JSON.
 *
 * Usage:
 *   node tools/export-pheromones.js [options]
 *
 * Options:
 *   --type <type>          只导出指定类型 (trail/alarm/recruit/queen/dance)
 *   --scope <scope>        只导出匹配范围前缀的信息素 (e.g. /task/42)
 *   --min-intensity <num>  最低强度阈值，范围 [0,1]（default: 0.01）
 *   --out <file>           输出到文件（需在 swarm 根目录内；加 --force 解除限制）
 *   --force                允许 --out 写入 swarm 根目录外
 *   --pretty               美化 JSON 输出
 *
 * Examples:
 *   node tools/export-pheromones.js --pretty
 *   node tools/export-pheromones.js --type alarm --pretty
 *   node tools/export-pheromones.js --scope /task/42 --out exports/ph.json
 *   node tools/export-pheromones.js --out /tmp/ph.json --force
 */

import { writeFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 解析命令行参数 / Parse CLI args ──────────────────────────────────────────
const args = process.argv.slice(2);

/**
 * 获取 flag 的值，带越界和误读校验
 * @param {string} flag
 * @returns {string|null}
 */
const get = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const val = args[i + 1];
  if (val === undefined || val.startsWith('--')) {
    console.error(`❌ ${flag} 需要一个值`);
    process.exit(1);
  }
  return val;
};

const has = (flag) => args.includes(flag);

// ── 参数解析与校验 / Arg parsing & validation ─────────────────────────────────
const opts = {
  type:         get('--type'),
  scope:        get('--scope'),
  minIntensity: 0.01,
  out:          get('--out'),
  force:        has('--force'),
  pretty:       has('--pretty'),
};

// --min-intensity 范围校验 [0, 1]
const rawMin = get('--min-intensity');
if (rawMin !== null) {
  const val = parseFloat(rawMin);
  if (Number.isNaN(val) || val < 0 || val > 1) {
    console.error('❌ --min-intensity 必须在 0~1 之间');
    process.exit(1);
  }
  opts.minIntensity = val;
}

// --out 路径穿越校验 / Path traversal guard
if (opts.out && !opts.force) {
  const SWARM_ROOT = resolve(__dirname, '..');
  const outAbs = resolve(opts.out);
  const rel = relative(SWARM_ROOT, outAbs);
  // 如果 relative 路径以 .. 开头，说明在 swarm 根目录外
  if (rel.startsWith('..')) {
    console.error(
      `❌ --out 路径 "${outAbs}" 在 swarm 根目录外。\n` +
      `   如果确认要写入该路径，请加 --force 参数。`
    );
    process.exit(1);
  }
}

// ── 动态引入 swarm 依赖栈 ─────────────────────────────────────────────────────
async function main() {
  const swarmRoot = resolve(__dirname, '..');

  const { DatabaseManager }    = await import(`${swarmRoot}/src/L1-infrastructure/database/database-manager.js`);
  const { PheromoneRepository } = await import(`${swarmRoot}/src/L1-infrastructure/database/repositories/pheromone-repo.js`);
  const { PheromoneEngine }    = await import(`${swarmRoot}/src/L2-communication/pheromone-engine.js`);
  const { ConfigManager }      = await import(`${swarmRoot}/src/L1-infrastructure/config/config-manager.js`);

  // 初始化 / Init
  const configManager = new ConfigManager();
  await configManager.load();
  const config = configManager.get();

  const dbManager = new DatabaseManager({ config });
  await dbManager.initialize();

  const pheromoneRepo = new PheromoneRepository({ db: dbManager.db });
  const engine = new PheromoneEngine({ pheromoneRepo });

  // 执行导出 / Run export
  const json = engine.exportToJSON({
    type:         opts.type,
    scope:        opts.scope,
    minIntensity: opts.minIntensity,
    pretty:       opts.pretty,
  });

  // 输出 / Output
  if (opts.out) {
    writeFileSync(opts.out, json, 'utf8');
    console.error(`✅ 导出完成: ${resolve(opts.out)}`);
  } else {
    process.stdout.write(json + '\n');
  }

  await dbManager.close();
}

main().catch(err => {
  console.error('❌ 导出失败:', err.message);
  process.exit(1);
});
