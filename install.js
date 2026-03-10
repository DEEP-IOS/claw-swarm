#!/usr/bin/env node
/**
 * Claw-Swarm V5.5 — One-click installer / 一键安装脚本
 *
 * Usage / 用法:
 *   node install.js           # Auto-detect best method / 自动检测最佳安装方式
 *   node install.js --help    # Show help / 显示帮助
 *
 * This script:
 * 1. Checks prerequisites (Node.js >= 22, OpenClaw installed)
 * 2. Installs npm dependencies if needed
 * 3. Registers the plugin via `openclaw plugins install --link`
 *    or falls back to config-based load.paths if CLI is unavailable
 * 4. Enables the plugin in openclaw.json
 * 5. Restarts the gateway
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Helpers ──────────────────────────────────────────────────

const PLUGIN_DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const CONFIG_DIR = join(homedir(), '.openclaw');
const CONFIG_FILE = join(CONFIG_DIR, 'openclaw.json');
const EXTENSIONS_DIR = join(CONFIG_DIR, 'extensions');

const color = process.stdout.isTTY || process.env.FORCE_COLOR;
const c = (code, msg) => color ? `\x1b[${code}m${msg}\x1b[0m` : msg;
const log = (msg) => console.log(`${c(36, '[claw-swarm]')} ${msg}`);
const warn = (msg) => console.log(`${c(33, '[claw-swarm]')} ${msg}`);
const error = (msg) => console.log(`${c(31, '[claw-swarm]')} ${msg}`);
const ok = (msg) => console.log(`${c(32, '[claw-swarm]')} ${msg}`);

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts }).trim();
  } catch { return null; }
}

function readConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')); } catch { return null; }
}

function writeConfig(config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// ── Checks ───────────────────────────────────────────────────

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 22) {
    error(`Node.js >= 22 required, found v${process.versions.node}`);
    error('Node.js >= 22 是必需的，请升级。');
    process.exit(1);
  }
  log(`Node.js v${process.versions.node} ✓`);
}

function checkOpenClaw() {
  const version = run('openclaw --version', { silent: true });
  if (!version) {
    warn('OpenClaw CLI not found in PATH.');
    warn('OpenClaw CLI 未找到。将使用手动配置模式。');
    return false;
  }
  log(`OpenClaw ${version.trim()} ✓`);
  return true;
}

// ── Install ──────────────────────────────────────────────────

function installDeps() {
  if (!existsSync(join(PLUGIN_DIR, 'node_modules'))) {
    log('Installing dependencies... / 安装依赖...');
    run('npm install --omit=dev', { cwd: PLUGIN_DIR });
  } else {
    log('Dependencies already installed ✓ / 依赖已安装 ✓');
  }
}

function registerViaConfig() {
  log('Registering plugin via openclaw.json... / 通过配置文件注册插件...');

  let config = readConfig();
  if (!config) {
    error(`Config file not found: ${CONFIG_FILE}`);
    error('Please run "openclaw doctor" first to initialize config.');
    process.exit(1);
  }

  // Ensure plugins section
  if (!config.plugins) config.plugins = {};

  // Add load.paths (avoids Windows junction issue)
  if (!config.plugins.load) config.plugins.load = {};
  if (!config.plugins.load.paths) config.plugins.load.paths = [];

  const normalizedPluginDir = PLUGIN_DIR.replace(/\\/g, '/').replace(/\/$/, '');
  const existingPaths = config.plugins.load.paths.map(p => p.replace(/\\/g, '/').replace(/\/$/, ''));

  if (!existingPaths.includes(normalizedPluginDir)) {
    config.plugins.load.paths.push(PLUGIN_DIR);
    log(`Added load path: ${PLUGIN_DIR}`);
  } else {
    log('Load path already registered ✓ / 加载路径已注册 ✓');
  }

  // Enable in entries
  if (!config.plugins.entries) config.plugins.entries = {};
  if (!config.plugins.entries['claw-swarm']) {
    config.plugins.entries['claw-swarm'] = {
      enabled: true,
      config: {
        dbPath: '~/.openclaw/claw-swarm/claw-swarm.db',
        pheromone: { decayIntervalMs: 60000, decayRate: 0.05 },
        memory: { maxFocus: 5, maxContext: 15, maxScratch: 30 },
        orchestration: { qualityGates: true, pipelineBreaker: true },
        gossip: { fanout: 3, heartbeatMs: 5000 },
        dashboard: { enabled: false, port: 19100 }
      }
    };
    log('Added claw-swarm to plugins.entries with default config');
  } else {
    if (!config.plugins.entries['claw-swarm'].enabled) {
      config.plugins.entries['claw-swarm'].enabled = true;
      log('Enabled claw-swarm in plugins.entries');
    } else {
      log('Plugin already enabled in config ✓ / 插件已启用 ✓');
    }
  }

  writeConfig(config);
  ok('Config updated ✓ / 配置已更新 ✓');
}

// ── Main ─────────────────────────────────────────────────────

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
Claw-Swarm V5.5 Installer / 安装脚本

Usage / 用法:
  node install.js              Install and configure / 安装并配置
  node install.js --uninstall  Remove from config / 从配置中移除
  node install.js --help       Show this help / 显示帮助

What this does / 功能:
  1. Checks Node.js >= 22 and OpenClaw
  2. Installs npm dependencies
  3. Registers plugin path in ~/.openclaw/openclaw.json
  4. Enables the plugin with default configuration
`);
    return;
  }

  if (process.argv.includes('--uninstall')) {
    log('Uninstalling... / 卸载中...');
    const config = readConfig();
    if (config?.plugins?.entries?.['claw-swarm']) {
      delete config.plugins.entries['claw-swarm'];
    }
    if (config?.plugins?.load?.paths) {
      const normalizedPluginDir = PLUGIN_DIR.replace(/\\/g, '/').replace(/\/$/, '');
      config.plugins.load.paths = config.plugins.load.paths.filter(
        p => p.replace(/\\/g, '/').replace(/\/$/, '') !== normalizedPluginDir
      );
      if (config.plugins.load.paths.length === 0) delete config.plugins.load.paths;
      if (config.plugins.load && Object.keys(config.plugins.load).length === 0) delete config.plugins.load;
    }
    writeConfig(config);
    ok('Claw-Swarm removed from config. / 已从配置中移除。');
    ok('Run "openclaw gateway restart" to apply. / 运行 "openclaw gateway restart" 生效。');
    return;
  }

  console.log('\n  🐝 Claw-Swarm V5.5 Installer\n');

  checkNodeVersion();
  checkOpenClaw();
  installDeps();
  registerViaConfig();

  console.log('');
  ok('Installation complete! / 安装完成！');
  ok('Run "openclaw gateway restart" to load the plugin.');
  ok('运行 "openclaw gateway restart" 加载插件。');
  ok('Verify with "openclaw plugins list".');
  console.log('');
}

main();
