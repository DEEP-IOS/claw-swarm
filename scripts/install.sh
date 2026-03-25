#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Claw-Swarm One-Click Installer (macOS / Linux)
#
# Usage:  bash scripts/install.sh [--openclaw-dir <path>] [--no-patch]
#
# Steps:
#   1. Verify Node ≥22
#   2. Install npm dependencies
#   3. Run swarm-patcher.js to unlock OpenClaw restrictions
#   4. Write OpenClaw config overrides for full capability
#   5. Trust the plugin
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[swarm]${NC} $*"; }
ok()    { echo -e "${GREEN}[swarm]${NC} $*"; }
warn()  { echo -e "${YELLOW}[swarm]${NC} $*"; }
fail()  { echo -e "${RED}[swarm]${NC} $*"; exit 1; }

# ─── Args ─────────────────────────────────────────────────────────────
OPENCLAW_DIR=""
NO_PATCH=false
SWARM_DIR="$(cd "$(dirname "$0")/.." && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --openclaw-dir) OPENCLAW_DIR="$2"; shift 2 ;;
    --no-patch)     NO_PATCH=true; shift ;;
    *)              warn "Unknown arg: $1"; shift ;;
  esac
done

# Auto-detect OpenClaw dir
if [[ -z "$OPENCLAW_DIR" ]]; then
  # Look for common locations
  for candidate in \
    "$SWARM_DIR/../runtime/node_modules/openclaw" \
    "$SWARM_DIR/node_modules/openclaw" \
    "$HOME/.openclaw" \
    "/usr/local/lib/node_modules/openclaw" \
    "$HOME/.local/share/openclaw"; do
    if [[ -d "$candidate/dist" ]]; then
      OPENCLAW_DIR="$(cd "$candidate" && pwd)"
      break
    fi
  done
fi

if [[ -z "$OPENCLAW_DIR" ]] || [[ ! -d "$OPENCLAW_DIR/dist" ]]; then
  fail "Cannot find OpenClaw installation. Use --openclaw-dir <path>"
fi

info "Swarm dir:    $SWARM_DIR"
info "OpenClaw dir: $OPENCLAW_DIR"

# ─── Step 1: Node version check ──────────────────────────────────────
NODE_VER="$(node -v 2>/dev/null || true)"
if [[ -z "$NODE_VER" ]]; then
  fail "Node.js not found. Install Node ≥22 first."
fi

NODE_MAJOR="${NODE_VER#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if (( NODE_MAJOR < 22 )); then
  fail "Node $NODE_VER too old. Need ≥22."
fi
ok "Node $NODE_VER ✓"

# ─── Step 2: Install dependencies ────────────────────────────────────
info "Installing npm dependencies..."
cd "$SWARM_DIR"
npm install --prefer-offline --no-audit --no-fund 2>/dev/null || npm install
ok "Dependencies installed ✓"

# ─── Step 3: Run patcher ─────────────────────────────────────────────
if [[ "$NO_PATCH" == "false" ]]; then
  info "Running swarm-patcher (unlocking OpenClaw)..."
  node scripts/swarm-patcher.js --openclaw-dir "$OPENCLAW_DIR" --verbose
  ok "Patcher complete ✓"
else
  warn "Skipping patcher (--no-patch)"
fi

# ─── Step 4: Write OpenClaw config overrides ─────────────────────────
info "Writing OpenClaw config overrides..."

# Find or create OpenClaw config
OPENCLAW_CONFIG=""
for candidate in \
  "$OPENCLAW_DIR/config.json" \
  "$HOME/.openclaw/config.json" \
  "$HOME/.config/openclaw/config.json"; do
  if [[ -f "$candidate" ]]; then
    OPENCLAW_CONFIG="$candidate"
    break
  fi
done

if [[ -z "$OPENCLAW_CONFIG" ]]; then
  OPENCLAW_CONFIG="$HOME/.openclaw/config.json"
  mkdir -p "$(dirname "$OPENCLAW_CONFIG")"
  echo '{}' > "$OPENCLAW_CONFIG"
  info "Created config at $OPENCLAW_CONFIG"
fi

# Use node to merge config (safe JSON handling)
node -e "
const fs = require('fs');
const configPath = process.argv[1];
const swarmDir = process.argv[2];

let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}

// Plugin trust
if (!config.plugins) config.plugins = {};
if (!config.plugins.entries) config.plugins.entries = {};
config.plugins.entries['openclaw-swarm'] = {
  ...(config.plugins.entries['openclaw-swarm'] || {}),
  trusted: true,
  path: swarmDir,
};

// Session visibility: allow cross-tree access
if (!config.tools) config.tools = {};
if (!config.tools.sessions) config.tools.sessions = {};
config.tools.sessions.visibility = 'all';

// Tool profile: full coding capability
config.tools.profile = 'coding';

// Exec: trust common bin dirs
if (!config.tools.exec) config.tools.exec = {};
config.tools.exec.safeBinTrustedDirs = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];

// Gateway: allow high-risk tool invocation via HTTP API
if (!config.gateway) config.gateway = {};
if (!config.gateway.tools) config.gateway.tools = {};
config.gateway.tools.allow = ['sessions_spawn', 'sessions_send', 'sessions_yield'];

// Subagent limits: generous for swarm
if (!config.agents) config.agents = {};
if (!config.agents.defaults) config.agents.defaults = {};
if (!config.agents.defaults.subagents) config.agents.defaults.subagents = {};
config.agents.defaults.subagents.maxSpawnDepth = 5;
config.agents.defaults.subagents.maxChildrenPerAgent = 20;

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('[swarm] Config written to ' + configPath);
" "$OPENCLAW_CONFIG" "$SWARM_DIR"

ok "Config overrides written ✓"

# ─── Step 5: Verify ──────────────────────────────────────────────────
info "Running verification..."
cd "$SWARM_DIR"
if command -v npx &>/dev/null; then
  npx vitest run tests/bridge/hooks/hook-adapter.test.js --reporter=dot 2>/dev/null && ok "Verification passed ✓" || warn "Some tests failed — check manually"
else
  warn "npx not found, skipping verification"
fi

echo ""
ok "═══════════════════════════════════════════════════════"
ok "  Claw-Swarm V9.1 installed successfully!"
ok "  OpenClaw: $OPENCLAW_DIR"
ok "  Config:   $OPENCLAW_CONFIG"
ok "═══════════════════════════════════════════════════════"
echo ""
info "Next: restart OpenClaw gateway to load the plugin."
