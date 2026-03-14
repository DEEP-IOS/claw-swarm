#!/usr/bin/env node
/**
 * Claw-Swarm V7.0 — One-click installer / 一键安装脚本
 *
 * Usage / 用法:
 *   node install.js                 # Auto-detect best method / 自动检测最佳安装方式
 *   node install.js --no-interactive # Skip interactive mapping (CI) / 跳过交互映射
 *   node install.js --help          # Show help / 显示帮助
 *
 * This script:
 * 1. Checks prerequisites (Node.js >= 22, OpenClaw installed)
 * 2. Installs npm dependencies if needed
 * 3. Detects existing OpenClaw environment (agents, sessions, swarm DB)
 * 4. Registers the plugin via config-based load.paths
 * 5. Enables the plugin in openclaw.json
 * 6. Registers swarm agents (relay) with tools.deny
 * 7. Adds all feature flags including V7.0
 * 8. Interactive swarm role mapping (maps existing agents to swarm roles)
 * 9. Warm start detection (imports historical reputation from swarm DB)
 * 10. Restarts the gateway
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { createRequire as _createRequire } from 'node:module';

// ── Helpers ──────────────────────────────────────────────────

const PLUGIN_DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const CONFIG_DIR = join(homedir(), '.openclaw');
const CONFIG_FILE = join(CONFIG_DIR, 'openclaw.json');
const EXTENSIONS_DIR = join(CONFIG_DIR, 'extensions');
const SWARM_DB_DIR = join(CONFIG_DIR, 'claw-swarm');
const SWARM_DB_FILE = join(SWARM_DB_DIR, 'claw-swarm.db');

const noInteractive = process.argv.includes('--no-interactive');

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

/**
 * 构建 Console 前端 (V7.1 新增)
 * Build the Console frontend — required for dashboard UI to work
 *
 * 检查 dist/ 是否存在或 src/ 比 dist/ 新, 如有需要则触发 vite build。
 * Checks if dist/ is missing or stale; triggers vite build if needed.
 */
function buildConsoleFrontend() {
  const consoleSrc  = join(PLUGIN_DIR, 'src', 'L6-monitoring', 'console');
  const consoleDist = join(consoleSrc, 'dist');
  const indexHtml   = join(consoleDist, 'index.html');

  // 已构建且最近 24 小时内不重复构建 / Skip if recently built (< 24h)
  if (existsSync(indexHtml)) {
    const { mtimeMs } = statSync(indexHtml);
    if (Date.now() - mtimeMs < 86_400_000) {
      log('Console frontend already built ✓ / 控制台前端已构建 ✓');
      return;
    }
  }

  // 确保 vite 可用 (devDependencies 在 --omit=dev 模式下不会被安装)
  // Ensure vite is available — devDependencies are skipped by --omit=dev
  const viteBin = join(PLUGIN_DIR, 'node_modules', '.bin', 'vite');
  if (!existsSync(viteBin)) {
    log('Installing console build tools... / 安装控制台构建工具...');
    run('npm install', { cwd: PLUGIN_DIR }); // Full install including devDeps
  }

  log('Building console frontend... / 构建控制台前端...');
  const result = run('npx vite build', { cwd: consoleSrc, silent: true });
  if (result !== null) {
    ok('Console frontend built ✓ / 控制台前端构建完成 ✓');
  } else {
    warn('Console build failed — dashboard UI may be unavailable.');
    warn('控制台构建失败，仪表板界面可能不可用。');
  }
}

// ── V7.0: Environment Detection ─────────────────────────────

/**
 * 检测已有 OpenClaw 环境 / Detect existing OpenClaw environment
 *
 * 读取 openclaw.json 配置，统计:
 *  - 已配置 agent 列表 (排除 swarm-relay)
 *  - 已安装 claw-swarm 版本 (升级 vs 全新)
 *  - 蜂群数据库是否存在
 *
 * @returns {{ agents: Array<{id:string, model?:object}>, existingVersion: string|null, hasSwarmDb: boolean, isUpgrade: boolean }}
 */
function detectExistingEnvironment() {
  log('Detecting existing environment... / 检测已有环境...');

  const config = readConfig();
  if (!config) {
    log('  No existing config found — fresh install');
    return { agents: [], existingVersion: null, hasSwarmDb: false, isUpgrade: false };
  }

  // 统计 agent (排除 swarm-relay) / Count agents (exclude swarm-relay)
  const agentList = config.agents?.list || [];
  const userAgents = agentList
    .filter(a => a.id !== 'swarm-relay')
    .map(a => ({
      id: a.id,
      name: a.name || a.id,
      model: a.model || null,
    }));

  // 检查已有 claw-swarm 安装 / Check existing claw-swarm installation
  const swarmEntry = config.plugins?.entries?.['claw-swarm'];
  const existingVersion = swarmEntry?.config?.version || null;
  const hasSwarmDb = existsSync(SWARM_DB_FILE);
  const isUpgrade = !!swarmEntry;

  // 打印摘要 / Print summary
  console.log('');
  console.log(`  ${c(36, '检测到已有 OpenClaw 环境 / Existing environment detected:')}`);
  console.log(`    - ${userAgents.length} 个已配置 agent / ${userAgents.length} configured agents: ${userAgents.map(a => a.id).join(', ') || '(none)'}`);
  console.log(`    - 蜂群数据库: ${hasSwarmDb ? '存在 / exists' : '不存在 / not found'}`);
  if (isUpgrade && existingVersion) {
    console.log(`    - 已安装版本: ${existingVersion} → 升级到 7.0.0 / Upgrading to 7.0.0`);
  } else if (isUpgrade) {
    console.log(`    - 已安装 claw-swarm (版本未知) → 升级到 7.0.0 / Upgrading to 7.0.0`);
  } else {
    console.log(`    - 全新安装 / Fresh install`);
  }
  console.log('');

  return { agents: userAgents, existingVersion, hasSwarmDb, isUpgrade };
}

/**
 * 推断蜂群角色 / Infer swarm role from agent ID and config
 *
 * 三级推断:
 *   1. ID/name 关键词匹配
 *   2. model 特征推断 (昂贵→reviewer/architect, 便宜→coder/scout)
 *   3. 无法推断 → 'unknown'
 *
 * @param {string} agentId
 * @param {{ model?: { primary?: string } }} agentConfig
 * @returns {string} 角色: scout | coder | reviewer | architect | designer | skip | unknown
 */
function inferSwarmRole(agentId, agentConfig) {
  const lower = (agentId || '').toLowerCase();

  // ── Level 1: ID/name 关键词匹配 / Keyword matching ──
  // scout 侦察蜂
  if (lower.includes('scout') || lower.includes('research') || lower.includes('search') ||
      lower.includes('explor') || lower.includes('recon') || lower.includes('survey')) {
    return 'scout';
  }
  // reviewer 审查蜂
  if (lower.includes('review') || lower.includes('guard') || lower.includes('audit') ||
      lower.includes('check') || lower.includes('verify') || lower.includes('inspect')) {
    return 'reviewer';
  }
  // coder 工蜂
  if (lower.includes('code') || lower.includes('dev') || lower.includes('worker') ||
      lower.includes('implement') || lower.includes('build') || lower.includes('engineer')) {
    return 'coder';
  }
  // architect 架构蜂
  if (lower.includes('architect') || lower.includes('plan') || lower.includes('design')) {
    return 'architect';
  }
  // designer 设计蜂
  if (lower.includes('visual') || lower.includes('ui') || lower.includes('ux') ||
      lower.includes('style') || lower.includes('css')) {
    return 'designer';
  }
  // skip — 主 agent / 个人助手
  if (lower === 'main' || lower.includes('personal') || lower.includes('assistant')) {
    return 'skip';
  }

  // ── Level 2: model 特征推断 / Model cost inference ──
  const modelPrimary = (agentConfig?.model?.primary || '').toLowerCase();
  if (modelPrimary) {
    // 昂贵模型 (opus, gpt-5, reasoner) → reviewer
    if (modelPrimary.includes('opus') || modelPrimary.includes('gpt-5') ||
        modelPrimary.includes('reasoner') || modelPrimary.includes('o1') ||
        modelPrimary.includes('o4')) {
      return 'reviewer';
    }
    // 便宜快速模型 (haiku, mini, flash) → scout
    if (modelPrimary.includes('haiku') || modelPrimary.includes('mini') ||
        modelPrimary.includes('flash') || modelPrimary.includes('lite')) {
      return 'scout';
    }
  }

  // ── Level 3: 无法推断 → unknown ──
  return 'unknown';
}

/**
 * 交互式蜂群映射 / Interactive swarm role mapping
 *
 * 显示检测到的 agent 列表，自动推断角色，对无法推断的标记 ⚠，
 * 交互模式下强制用户指定，--no-interactive 模式 fallback 到 coder。
 *
 * @param {{ agents: Array<{id:string, name?:string, model?:object}> }} envInfo
 * @returns {Promise<Object>} agentMapping { role: agentId }
 */
async function interactiveSwarmMapping(envInfo) {
  const agents = envInfo.agents;
  if (!agents || agents.length === 0) return {};

  const availableRoles = ['scout', 'coder', 'reviewer', 'architect', 'designer', 'skip'];
  const roleLabels = {
    scout: '侦察蜂: 调研/搜索',
    coder: '工蜂: 编码执行',
    reviewer: '审查蜂: 代码审查',
    architect: '架构蜂: 设计规划',
    designer: '设计蜂: UI/可视化',
    skip: '不纳入蜂群',
    unknown: '⚠ 未识别，请指定角色',
  };

  // 推断每个 agent 的角色 / Infer role for each agent
  const assignments = agents.map((agent, idx) => ({
    index: idx + 1,
    id: agent.id,
    role: inferSwarmRole(agent.id, agent),
  }));

  // 打印映射表 / Print mapping table
  console.log(`  ${c(36, '蜂群角色映射 / Swarm Role Mapping')}`);
  console.log(`  ${'━'.repeat(48)}`);
  console.log(`  检测到以下 agent / Detected agents:\n`);

  for (const a of assignments) {
    const label = roleLabels[a.role] || a.role;
    const roleDisplay = a.role === 'unknown' ? c(33, a.role) : c(32, a.role);
    console.log(`    ${a.index}. ${a.id.padEnd(16)} → ${roleDisplay.padEnd(24)} (${label})`);
  }

  console.log(`\n  可用角色: ${availableRoles.join(', ')}`);

  const unknowns = assignments.filter(a => a.role === 'unknown');

  if (unknowns.length > 0 && !noInteractive) {
    // 交互模式: 强制用户指定 unknown 角色
    console.log(`\n  ${c(33, `⚠ 有 ${unknowns.length} 个 agent 无法自动推断角色，请指定`)}`);
    console.log(`  格式: ${unknowns.map(u => `${u.index}=角色`).join(' ')} (例: ${unknowns[0].index}=coder)`);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const askQuestion = (q) => new Promise(resolve => rl.question(q, resolve));

    // 循环直到所有 unknown 都被赋值 / Loop until all unknowns assigned
    while (assignments.some(a => a.role === 'unknown')) {
      const answer = await askQuestion(`  > `);
      const parts = (answer || '').trim().split(/\s+/);

      for (const part of parts) {
        const match = part.match(/^(\d+)=(\w+)$/);
        if (match) {
          const idx = parseInt(match[1], 10);
          const role = match[2].toLowerCase();
          const target = assignments.find(a => a.index === idx);
          if (target && availableRoles.includes(role)) {
            target.role = role;
            ok(`  ${target.id} → ${role}`);
          } else if (target && !availableRoles.includes(role)) {
            warn(`  无效角色: ${role}。可用: ${availableRoles.join(', ')}`);
          } else {
            warn(`  无效序号: ${idx}`);
          }
        }
      }

      const stillUnknown = assignments.filter(a => a.role === 'unknown');
      if (stillUnknown.length > 0) {
        console.log(`  还有 ${stillUnknown.length} 个未指定: ${stillUnknown.map(u => `${u.index}.${u.id}`).join(', ')}`);
      }
    }

    rl.close();
  } else if (unknowns.length > 0 && noInteractive) {
    // --no-interactive 模式: fallback 到 coder + 打印 warning
    for (const u of unknowns) {
      u.role = 'coder';
      warn(`  ${u.id} → coder (--no-interactive fallback)`);
    }
  }

  // 构建 agentMapping / Build agentMapping { role: agentId }
  // 同一角色多个 agent → 仅保留第一个 (后续可用数组)
  const agentMapping = {};
  for (const a of assignments) {
    if (a.role === 'skip') continue;
    if (!agentMapping[a.role]) {
      agentMapping[a.role] = a.id;
    }
  }

  // 写入配置 / Write to config
  const config = readConfig();
  if (config?.plugins?.entries?.['claw-swarm']?.config) {
    config.plugins.entries['claw-swarm'].config.agentMapping = agentMapping;
    writeConfig(config);
    ok('Agent mapping saved to config ✓ / 角色映射已保存 ✓');
  }

  console.log('');
  return agentMapping;
}

/**
 * 热启动数据检测 / Detect warm start capability
 *
 * 如果已有 claw-swarm.db，尝试读取 agent 声誉数据摘要。
 * 将热启动标志写入配置。
 *
 * @param {{ existingVersion: string|null, hasSwarmDb: boolean }} envInfo
 */
function detectWarmStartCapability(envInfo) {
  if (!envInfo.hasSwarmDb) return;

  log('Detecting warm start capability... / 检测热启动能力...');

  let agentCount = 0;
  let affinityCount = 0;

  try {
    // 尝试用 better-sqlite3 读取 (依赖已安装后)
    const Database = await_import_sqlite();
    if (Database) {
      const db = new Database(SWARM_DB_FILE, { readonly: true });
      try {
        const agents = db.prepare('SELECT COUNT(*) as cnt FROM agents WHERE status = ?').get('active');
        agentCount = agents?.cnt || 0;
      } catch { /* table may not exist */ }
      try {
        const affinity = db.prepare('SELECT COUNT(*) as cnt FROM task_affinity').get();
        affinityCount = affinity?.cnt || 0;
      } catch { /* table may not exist */ }
      db.close();
    }
  } catch { /* non-fatal: DB read failure */ }

  if (agentCount > 0 || affinityCount > 0) {
    console.log(`    - Agent 记录: ${agentCount} 条 / ${agentCount} agent records`);
    console.log(`    - 任务亲和性: ${affinityCount} 条 / ${affinityCount} affinity records`);
  }

  // 写入 warmStart 配置 / Write warmStart config
  const config = readConfig();
  if (config?.plugins?.entries?.['claw-swarm']?.config) {
    config.plugins.entries['claw-swarm'].config.warmStart = {
      enabled: true,
      sourceVersion: envInfo.existingVersion || 'unknown',
    };
    writeConfig(config);
    ok('Warm start flag saved ✓ / 热启动标志已保存 ✓');
  }
}

/**
 * 同步尝试导入 better-sqlite3
 * @returns {Function|null}
 */
function await_import_sqlite() {
  try {
    // better-sqlite3 是同步库, 用 createRequire 加载 CJS 模块
    const modulePath = join(PLUGIN_DIR, 'node_modules', 'better-sqlite3');
    if (!existsSync(modulePath)) return null;
    const _require = _createRequire(import.meta.url);
    return _require(modulePath);
  } catch { return null; }
}

// ── Plugin Registration ─────────────────────────────────────

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
        dashboard: { enabled: true, port: 19100 },
        // V5.1 核心模块 — 全部开启 / V5.1 core modules — all enabled
        toolResilience: { enabled: true },
        healthChecker: { enabled: true },
        hierarchical: { enabled: true },
        dagEngine: { enabled: true },
        workStealing: { enabled: true },
        speculativeExecution: { enabled: true },
        skillGovernor: { enabled: true },
        // V5.1 进化子系统 / Evolution subsystem
        evolution: {
          scoring: true, clustering: true,
          gep: true, abc: true, lotkaVolterra: true,
        },
        // V6.3 核心标记 / V6.3 core flags
        toolConsolidation: true,
        webhookRelay: true,
        physicalIsolation: true,
        conditionalContext: true,
        crossAgentMemory: true,
      }
    };
    log('Added claw-swarm to plugins.entries with full config (all features enabled)');
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

// ── V6.3 追加A: Agent Registration + Webhook Relay ──────────

/**
 * Register swarm agent configs in openclaw.json.
 * 在 openclaw.json 中注册蜂群代理配置。
 *
 * V6.3: 不再设置 soul 字段 (OpenClaw 不支持), SOUL.md 内容通过
 * before_agent_start 钩子注入。
 * V6.3: No longer sets soul field (unsupported by OpenClaw). SOUL.md
 * content is injected via before_agent_start hook.
 */
function registerAgents() {
  log('Registering swarm agents... / 注册蜂群代理...');

  const config = readConfig();
  if (!config) {
    warn('Config not found, skipping agent registration');
    return;
  }

  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  // Agent 定义 / Agent definitions
  // 注意: 不设置 soul 字段, OpenClaw 会拒绝未知配置键
  // Note: No soul field — OpenClaw rejects unknown config keys
  const swarmAgents = [
    {
      id: 'swarm-relay',
      toolsDeny: ['swarm_run', 'swarm_query', 'swarm_dispatch', 'swarm_checkpoint', 'exec', 'browser'],
      extra: { subagents: { allowAgents: ['*'] } },
    },
  ];

  let changed = false;

  for (const agent of swarmAgents) {
    const existing = config.agents.list.find(a => a.id === agent.id);
    if (!existing) {
      const entry = { id: agent.id };
      if (agent.toolsDeny) {
        entry.tools = { deny: agent.toolsDeny };
      }
      if (agent.extra) {
        Object.assign(entry, agent.extra);
      }
      config.agents.list.push(entry);
      log(`  + Agent registered: ${agent.id}`);
      changed = true;
    } else {
      // O1: Merge toolsDeny — add any new entries from code that are missing in config
      // This ensures re-install picks up newly added tools (e.g. swarm_checkpoint in V7.1)
      if (agent.toolsDeny) {
        if (!existing.tools) existing.tools = {};
        const existingDeny = existing.tools.deny || [];
        const merged = [...new Set([...existingDeny, ...agent.toolsDeny])];
        if (merged.length !== existingDeny.length) {
          const added = merged.filter(t => !existingDeny.includes(t));
          existing.tools.deny = merged;
          log(`  Agent ${agent.id}: tools.deny updated — merged ${added.join(', ')}`);
          changed = true;
        } else {
          log(`  Agent already registered: ${agent.id} ✓`);
        }
      } else {
        log(`  Agent already registered: ${agent.id} ✓`);
      }
    }
  }

  // V6.3: 创建 swarm-relay workspace 目录 / Create workspace dir
  // OpenClaw 要求 agent workspace 目录存在, 否则跳过该 agent
  const relayWorkspace = join(CONFIG_DIR, 'workspace-swarm-relay');
  if (!existsSync(relayWorkspace)) {
    mkdirSync(relayWorkspace, { recursive: true });
    log('  + Created swarm-relay workspace directory');
    log(`    ${relayWorkspace}`);
  }

  ensureWorkspaceTemplates(relayWorkspace);

  // V6.3: Webhook relay 配置 / Webhook relay config
  // 保留已有 hooks.internal 配置, 仅追加 relay 相关字段
  if (!config.hooks) config.hooks = {};

  // 生成唯一 token (必须不同于 gateway auth token)
  // Generate unique token (must differ from gateway auth token)
  if (!config.hooks.token) {
    config.hooks.token = randomBytes(24).toString('hex');
    log('  + Generated unique hooks token');
    changed = true;
  }

  if (!config.hooks.mappings) {
    config.hooks.enabled = true;
    config.hooks.path = '/hooks';
    config.hooks.mappings = [
      { match: { path: 'swarm-relay' }, action: 'agent', agentId: 'swarm-relay' },
    ];
    log('  + Webhook relay mapping configured');
    changed = true;
  }

  // V6.3: cron 配置
  if (!config.cron) config.cron = {};
  if (!config.cron.maxConcurrentRuns) {
    config.cron.maxConcurrentRuns = 8;
    changed = true;
  }

  if (changed) {
    writeConfig(config);
    ok('Agent configs updated ✓ / 代理配置已更新 ✓');
  }
}

function ensureWorkspaceTemplates(workspaceDir) {
  if (!workspaceDir) return;

  const agentsMd = join(workspaceDir, 'AGENTS.md');
  if (!existsSync(agentsMd)) {
    writeFileSync(agentsMd, [
      '# Swarm Relay Agent Workspace',
      '',
      'This workspace is used by `swarm-relay` for deterministic forwarding only.',
      '',
      '- Role: forward JSON tool payloads to child sessions',
      '- Behavior: no reasoning, no planning',
      '- Safety: do not run shell/browser operations directly',
      '',
      '该工作区用于 `swarm-relay` 的确定性转发，不做任务分析。',
    ].join('\n'), 'utf-8');
    log('  + Created AGENTS.md template in relay workspace');
  }

  const soulMd = join(workspaceDir, 'SOUL.md');
  if (!existsSync(soulMd)) {
    writeFileSync(soulMd, [
      '# SOUL Template',
      '',
      'Identity: swarm-relay (deterministic forwarder)',
      'Core Rule: parse and forward tool calls without interpretation.',
      'Hard Limits: no autonomous task analysis, no side decisions.',
      '',
      '身份: swarm-relay（确定性转发器）',
      '核心规则: 仅解析并转发工具调用，不做解释。',
      '硬限制: 不做自主分析，不做额外决策。',
    ].join('\n'), 'utf-8');
    log('  + Created SOUL.md template in relay workspace');
  }
}

/**
 * 追加所有 feature flags + relay config 到 claw-swarm 插件配置
 * 所有设计的功能默认全部开启 — 开箱即用
 * Add ALL feature flags + relay config to claw-swarm plugin config
 * Every designed feature defaults to enabled — out-of-box ready
 */
function ensureAllFeatureFlags() {
  log('Ensuring ALL feature flags enabled... / 确认所有功能标记已开启...');

  const config = readConfig();
  if (!config?.plugins?.entries?.['claw-swarm']?.config) {
    warn('claw-swarm config not found, skipping feature flags');
    return;
  }

  const swarmConfig = config.plugins.entries['claw-swarm'].config;
  let changed = false;

  // ── V5.1 核心模块 / V5.1 Core Modules ──
  const moduleFlags = {
    toolResilience:        { enabled: true },  // AJV 预校验 + 断路器 + 重试
    healthChecker:         { enabled: true },  // 多维健康检查
    hierarchical:          { enabled: true },  // 层级蜂群协调
    dagEngine:             { enabled: true },  // DAG 任务编排
    workStealing:          { enabled: true },  // 工作窃取负载均衡
    speculativeExecution:  { enabled: true },  // 推测性并行执行
    skillGovernor:         { enabled: true },  // 技能清单 + 推荐引擎
  };

  for (const [key, defaultValue] of Object.entries(moduleFlags)) {
    if (swarmConfig[key] === undefined) {
      swarmConfig[key] = defaultValue;
      changed = true;
    } else if (typeof swarmConfig[key] === 'object' && swarmConfig[key].enabled === undefined) {
      swarmConfig[key].enabled = true;
      changed = true;
    }
  }

  // ── V5.1 进化子系统 / V5.1 Evolution Subsystem ──
  if (!swarmConfig.evolution) {
    swarmConfig.evolution = {
      scoring: true,        // 能力评分 (其他进化功能的前置依赖)
      clustering: true,     // 物种聚类
      gep: true,            // 基因表达式编程
      abc: true,            // 人工蜂群算法
      lotkaVolterra: true,  // Lotka-Volterra 种群动力学
    };
    changed = true;
  } else {
    const evoDefaults = { scoring: true, clustering: true, gep: true, abc: true, lotkaVolterra: true };
    for (const [key, val] of Object.entries(evoDefaults)) {
      if (swarmConfig.evolution[key] === undefined) {
        swarmConfig.evolution[key] = val;
        changed = true;
      }
    }
  }

  // ── V6.3 核心标记 / V6.3 Core Flags ──
  const v63Flags = {
    toolConsolidation: true,   // 工具精简 8→3
    webhookRelay: true,        // 必须开启, 否则 relay 不初始化
    physicalIsolation: true,   // 必须开启, 否则 tools.deny 不生效
    conditionalContext: true,  // 按需上下文注入
    crossAgentMemory: true,    // 跨 agent 记忆查询
  };

  for (const [key, defaultValue] of Object.entries(v63Flags)) {
    if (swarmConfig[key] === undefined) {
      swarmConfig[key] = defaultValue;
      changed = true;
    }
  }

  // ── V7.0 全系统落地标志 / V7.0 Full System Landing Flags ──
  if (!swarmConfig.v70FullLanding) {
    swarmConfig.v70FullLanding = {
      // 稳定功能 — 默认开启 / Stable features — enabled by default
      communicationSensing: true,     // 通信感知
      shapleyInjection: true,         // Shapley 信用分配注入
      piActuation: true,              // PI 控制器执行
      abcDifferentiation: true,       // ABC 角色分化
      sessionHistoryExtraction: true, // Session 历史提取
      sharedWorkingMemory: true,      // 共享工作记忆
      budgetDegradation: true,        // 预算降级
      evidenceGateHard: true,         // 证据门硬闸
      // 高风险/未验证功能 — 默认关闭 / High-risk — disabled by default
      knowledgeDistillation: false,
      speculativeExecution: false,
      liveBidding: false,
      negativeSelection: false,
      realtimeIntervention: false,
      lotkaVolterra: false,
      planEvolution: false,
      dreamConsolidation: false,
    };
    changed = true;
    log('  + Added V7.0 full landing feature flags');
  }

  // ── Relay 配置 / Relay Config ──
  // 默认启用, hookToken 从 hooks.token 复用
  if (!swarmConfig.relay) {
    const hooksToken = config.hooks?.token || '';
    swarmConfig.relay = {
      enabled: true,
      gatewayUrl: 'http://127.0.0.1:18789',
      hookToken: hooksToken,
      detachSubagentsOnParentDisconnect: true,
    };
    changed = true;
    log('  + Added relay config (enabled)');
  } else if (swarmConfig.relay.detachSubagentsOnParentDisconnect === undefined) {
    swarmConfig.relay.detachSubagentsOnParentDisconnect = true;
    changed = true;
  }

  if (changed) {
    writeConfig(config);
    ok('All feature flags enabled ✓ / 所有功能标记已开启 ✓');
  } else {
    log('All feature flags already set ✓');
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
Claw-Swarm V7.0 Installer / 安装脚本

Usage / 用法:
  node install.js                  Install and configure / 安装并配置
  node install.js --no-interactive Skip interactive mapping / 跳过交互映射 (CI)
  node install.js --uninstall      Remove from config / 从配置中移除
  node install.js --help           Show this help / 显示帮助

What this does / 功能:
  1. Checks Node.js >= 22 and OpenClaw
  2. Installs npm dependencies
  3. Detects existing OpenClaw environment (agents, DB, version)
  4. Registers plugin path in ~/.openclaw/openclaw.json
  5. Enables the plugin with default configuration
  6. Registers swarm agents (relay) with tools.deny
  7. Creates workspace directories for agents
  8. Generates unique webhook token and configures relay mapping
  9. Adds V6.3 + V7.0 feature flags and relay config
 10. Interactive swarm mapping — assigns swarm roles to existing agents
 11. Warm start detection — imports historical reputation from swarm DB

Flags / 选项:
  --no-interactive  Skip interactive role mapping (CI/automation)
                    跳过交互式角色映射，未识别 agent 默认为 coder
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

  console.log('\n  🐝 Claw-Swarm V7.0 Installer\n');

  // Step 1-2: Prerequisites
  checkNodeVersion();
  checkOpenClaw();
  installDeps();

  // Step 3: Detect existing environment (V7.0 NEW)
  const envInfo = detectExistingEnvironment();

  // Step 4-6: Plugin registration
  registerViaConfig();
  registerAgents();

  // Step 7: Feature flags (including V7.0)
  ensureAllFeatureFlags();

  // Step 8: Interactive swarm mapping (V7.0 NEW)
  if (envInfo.agents.length > 0) {
    await interactiveSwarmMapping(envInfo);
  }

  // Step 9: Warm start detection (V7.0 NEW)
  if (envInfo.hasSwarmDb) {
    detectWarmStartCapability(envInfo);
  }

  // Step 10: Build console frontend (V7.1)
  buildConsoleFrontend();

  console.log('');
  ok('Installation complete! / 安装完成！');
  ok('Run "openclaw gateway restart" to load the plugin.');
  ok('运行 "openclaw gateway restart" 加载插件。');
  ok('Verify with "openclaw plugins list".');
  console.log('');
}

main();
