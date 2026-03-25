# ─────────────────────────────────────────────────────────────────────
# Claw-Swarm 一键安装脚本 (Windows PowerShell)
#
# 用法:  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 [-OpenClawDir <路径>] [-NoPatch]
#
# 步骤:
#   1. 检查 Node ≥22
#   2. 安装 npm 依赖
#   3. 运行 swarm-patcher.js 解除 OpenClaw 限制
#   4. 写入 OpenClaw 配置覆盖
#   5. 信任插件
# ─────────────────────────────────────────────────────────────────────
param(
  [string]$OpenClawDir = "",
  [switch]$NoPatch
)

$ErrorActionPreference = "Stop"

function Info($msg)  { Write-Host "[swarm] $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "[swarm] $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "[swarm] $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "[swarm] $msg" -ForegroundColor Red; exit 1 }

$SwarmDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# ─── 自动检测 OpenClaw 目录 ──────────────────────────────────────────
if (-not $OpenClawDir) {
  $candidates = @(
    (Join-Path $SwarmDir "..\runtime\node_modules\openclaw"),
    (Join-Path $SwarmDir "node_modules\openclaw"),
    (Join-Path $env:USERPROFILE ".openclaw"),
    (Join-Path $env:APPDATA "openclaw"),
    (Join-Path $env:LOCALAPPDATA "openclaw")
  )
  foreach ($c in $candidates) {
    if (Test-Path (Join-Path $c "dist")) {
      $OpenClawDir = (Resolve-Path $c).Path
      break
    }
  }
}

if (-not $OpenClawDir -or -not (Test-Path (Join-Path $OpenClawDir "dist"))) {
  Fail "找不到 OpenClaw 安装目录。请使用 -OpenClawDir <路径>"
}

Info "Swarm 目录:    $SwarmDir"
Info "OpenClaw 目录: $OpenClawDir"

# ─── 步骤 1: 检查 Node 版本 ──────────────────────────────────────────
try {
  $nodeVer = (node -v 2>$null)
} catch {
  $nodeVer = ""
}
if (-not $nodeVer) {
  Fail "未找到 Node.js。请先安装 Node >= 22。"
}
$major = [int]($nodeVer -replace '^v(\d+)\..*', '$1')
if ($major -lt 22) {
  Fail "Node $nodeVer 版本过低，需要 >= 22。"
}
Ok "Node $nodeVer ✓"

# ─── 步骤 2: 安装依赖 ────────────────────────────────────────────────
Info "正在安装 npm 依赖..."
Push-Location $SwarmDir
try {
  npm install --prefer-offline --no-audit --no-fund 2>$null
  if ($LASTEXITCODE -ne 0) { npm install }
} catch {
  npm install
}
Ok "依赖安装完成 ✓"
Pop-Location

# ─── 步骤 3: 运行 Patcher ────────────────────────────────────────────
if (-not $NoPatch) {
  Info "正在运行 swarm-patcher (解除 OpenClaw 限制)..."
  node (Join-Path $SwarmDir "scripts\swarm-patcher.js") --openclaw-dir $OpenClawDir --verbose
  if ($LASTEXITCODE -ne 0) { Fail "Patcher 运行失败" }
  Ok "Patcher 完成 ✓"
} else {
  Warn "跳过 Patcher (-NoPatch)"
}

# ─── 步骤 4: 写入配置覆盖 ────────────────────────────────────────────
Info "正在写入 OpenClaw 配置覆盖..."

$configCandidates = @(
  (Join-Path $OpenClawDir "config.json"),
  (Join-Path $env:USERPROFILE ".openclaw\config.json"),
  (Join-Path $env:APPDATA "openclaw\config.json")
)

$configPath = ""
foreach ($c in $configCandidates) {
  if (Test-Path $c) {
    $configPath = $c
    break
  }
}

if (-not $configPath) {
  $configPath = Join-Path $env:USERPROFILE ".openclaw\config.json"
  $configDir = Split-Path -Parent $configPath
  if (-not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }
  Set-Content -Path $configPath -Value "{}" -Encoding UTF8
  Info "已创建配置文件: $configPath"
}

$nodeScript = @"
const fs = require('fs');
const configPath = process.argv[1];
const swarmDir = process.argv[2];

let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}

if (!config.plugins) config.plugins = {};
if (!config.plugins.entries) config.plugins.entries = {};
config.plugins.entries['openclaw-swarm'] = {
  ...(config.plugins.entries['openclaw-swarm'] || {}),
  trusted: true,
  path: swarmDir,
};

if (!config.tools) config.tools = {};
if (!config.tools.sessions) config.tools.sessions = {};
config.tools.sessions.visibility = 'all';
config.tools.profile = 'coding';

if (!config.tools.exec) config.tools.exec = {};
config.tools.exec.safeBinTrustedDirs = ['C:\\\\Windows\\\\System32', 'C:\\\\Windows', 'C:\\\\Program Files\\\\Git\\\\usr\\\\bin'];

if (!config.gateway) config.gateway = {};
if (!config.gateway.tools) config.gateway.tools = {};
config.gateway.tools.allow = ['sessions_spawn', 'sessions_send', 'sessions_yield'];

if (!config.agents) config.agents = {};
if (!config.agents.defaults) config.agents.defaults = {};
if (!config.agents.defaults.subagents) config.agents.defaults.subagents = {};
config.agents.defaults.subagents.maxSpawnDepth = 5;
config.agents.defaults.subagents.maxChildrenPerAgent = 20;

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('[swarm] 配置已写入 ' + configPath);
"@

node -e $nodeScript $configPath $SwarmDir
Ok "配置覆盖写入完成 ✓"

# ─── 步骤 5: 验证 ────────────────────────────────────────────────────
Info "正在运行验证测试..."
Push-Location $SwarmDir
try {
  npx vitest run tests/bridge/hooks/hook-adapter.test.js --reporter=dot 2>$null
  if ($LASTEXITCODE -eq 0) { Ok "验证通过 ✓" }
  else { Warn "部分测试未通过 — 请手动检查" }
} catch {
  Warn "无法运行测试 — 请手动检查"
}
Pop-Location

Write-Host ""
Ok "═══════════════════════════════════════════════════════"
Ok "  Claw-Swarm V9.1 安装成功!"
Ok "  OpenClaw: $OpenClawDir"
Ok "  配置文件:  $configPath"
Ok "═══════════════════════════════════════════════════════"
Write-Host ""
Info "下一步: 重启 OpenClaw Gateway 以加载插件。"
