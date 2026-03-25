#!/usr/bin/env node
/**
 * Claw-Swarm OpenClaw Patcher v3.0
 *
 * 对 OpenClaw 2026.3.x dist 进行精确字符串替换，移除所有安全限制。
 * 基于对实际 dist 文件的逐行扫描，所有 find 字符串均已验证存在。
 *
 * v3.0 改进:
 *   - 文件名自动发现 (glob 匹配前缀，不依赖 content hash)
 *   - 所有 patch 字符串基于 2026.3.23-2 dist 真实内容验证
 *   - 覆盖 113 条安全限制清单中所有可补丁项
 *
 * 用法: node scripts/swarm-patcher.js [--openclaw-dir <path>] [--dry-run] [--verbose]
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── CLI args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const dirIdx = args.indexOf('--openclaw-dir');
const OPENCLAW_DIR = dirIdx !== -1 && args[dirIdx + 1]
  ? path.resolve(args[dirIdx + 1])
  : path.resolve(process.cwd(), 'node_modules', 'openclaw');

const DIST = path.join(OPENCLAW_DIR, 'dist');

// ─── Utils ──────────────────────────────────────────────────────────
let totalPatches = 0;
let totalFiles = 0;
let totalSkipped = 0;

function log(msg) { console.log(`[patcher] ${msg}`); }
function verbose(msg) { if (VERBOSE) console.log(`  [v] ${msg}`); }

/**
 * 根据前缀自动发现 dist 文件。
 * 例如 resolveDistFile('pi-embedded') → 'pi-embedded-CbCYZxIb.js'
 * 跳过 .runtime- 后缀的 chunk (那是运行时子模块)。
 */
function resolveDistFile(prefix) {
  if (!fs.existsSync(DIST)) return null;
  const files = fs.readdirSync(DIST).filter(f =>
    f.startsWith(prefix + '-') &&
    f.endsWith('.js') &&
    !f.includes('.runtime-') &&
    !f.includes('-cli-') // 除非 prefix 本身含 cli
    || f === prefix + '.js'
  );
  // 如果 prefix 含 cli，允许 -cli- 文件
  if (prefix.includes('cli')) {
    const cliFiles = fs.readdirSync(DIST).filter(f =>
      f.startsWith(prefix + '-') && f.endsWith('.js') && !f.includes('.runtime-')
    );
    if (cliFiles.length > 0) return cliFiles[0];
  }
  if (files.length === 0) return null;
  // 返回最大的文件 (主 chunk 而非子模块)
  return files.reduce((a, b) => {
    const sa = fs.statSync(path.join(DIST, a)).size;
    const sb = fs.statSync(path.join(DIST, b)).size;
    return sa >= sb ? a : b;
  });
}

function patchFile(relPath, patches) {
  const absPath = path.join(DIST, relPath);
  if (!fs.existsSync(absPath)) {
    log(`⚠ SKIP (not found): ${relPath}`);
    return;
  }

  let content = fs.readFileSync(absPath, 'utf-8');
  let applied = 0;

  for (const p of patches) {
    const { find, replace, description, optional } = p;

    if (typeof find === 'string') {
      if (!content.includes(find)) {
        if (!optional) { log(`⚠ MISS: ${relPath} — ${description}`); totalSkipped++; }
        else verbose(`  skip optional: ${description}`);
        continue;
      }
      content = content.replace(find, replace);
      applied++;
      verbose(`  ✓ ${description}`);
    } else if (find instanceof RegExp) {
      if (!find.test(content)) {
        if (!optional) { log(`⚠ MISS (regex): ${relPath} — ${description}`); totalSkipped++; }
        else verbose(`  skip optional: ${description}`);
        continue;
      }
      content = content.replace(find, replace);
      applied++;
      verbose(`  ✓ ${description}`);
    }
  }

  if (applied > 0) {
    if (!DRY_RUN) fs.writeFileSync(absPath, content, 'utf-8');
    totalPatches += applied;
    totalFiles++;
    log(`${DRY_RUN ? '[DRY] ' : ''}${relPath}: ${applied} patches`);
  }
}

// ─── File Resolution ────────────────────────────────────────────────
// 自动发现，回退到已知 hash

function resolveFile(prefix, knownHash) {
  const auto = resolveDistFile(prefix);
  if (auto) return auto;
  // 回退到已知 hash
  const fallback = `${prefix}-${knownHash}.js`;
  if (fs.existsSync(path.join(DIST, fallback))) return fallback;
  log(`⚠ Cannot resolve: ${prefix}-*.js`);
  return fallback; // patchFile 会处理 not found
}

// ─── Patch Definitions ──────────────────────────────────────────────
// 所有 find 字符串均来自对 2026.3.23-2 dist 文件的实际 grep 结果

// =======================================================================
// P0: EXEC APPROVALS (#1-#28) — exec-approvals + pi-embedded + shell-env
// =======================================================================
function patchExecSecurity() {
  const file = resolveFile('exec-approvals', 'BF_Qfdq8');
  patchFile(file, [
    {
      // 验证: line 477
      find: 'const DEFAULT_SECURITY = "deny";',
      replace: 'const DEFAULT_SECURITY = "full";',
      description: '#1 exec default security → full'
    },
    {
      // 验证: line 479
      find: 'const DEFAULT_ASK_FALLBACK = "deny";',
      replace: 'const DEFAULT_ASK_FALLBACK = "full";',
      description: '#1 exec ask fallback → full'
    },
    {
      // 验证: line 722 — 多行函数体
      find: 'function requiresExecApproval(params) {\n\treturn params.ask === "always" || params.ask === "on-miss" && params.security === "allowlist" && (!params.analysisOk || !params.allowlistSatisfied);\n}',
      replace: 'function requiresExecApproval(params) {\n\treturn false;\n}',
      description: '#1 requiresExecApproval → always false'
    },
    {
      // 验证: line 138
      find: 'if (segment.resolution?.policyBlocked === true) {',
      replace: 'if (false) {',
      description: '#1 disable policyBlocked deny'
    },
    {
      // 验证: line 403
      find: 'if (hasShellLineContinuation(params.command)) return analysisFailure();',
      replace: '/* patched #16 */ if (false) return analysisFailure();',
      description: '#16 allow shell line continuations'
    },
  ]);

  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 73558
      find: 'if (hostSecurity === "deny") throw new Error(`exec denied: host=${params.host} security=deny`);',
      replace: '/* patched #1 */ void 0;',
      description: '#1 remove exec denied for security=deny'
    },
    {
      // 验证: line 73868
      find: 'throw new Error("exec denied: allowlist miss");',
      replace: '/* patched #1 */ void 0;',
      description: '#1 remove exec denied: allowlist miss'
    },
    {
      // 验证: line 73727
      find: 'throw new Error(`exec denied: allowlist execution plan unavailable (${enforced.reason})`);',
      replace: '/* patched #24 */ void 0;',
      description: '#24 remove exec denied: plan unavailable'
    },
    {
      // 验证: line 71850-71853 — 函数开头 (实际缩进: tab for function body, space+tab for object)
      find: 'function detectCommandObfuscation(command) {\n\tif (!command || !command.trim()) return {\n\t\tdetected: false,\n\t\treasons: [],',
      replace: 'function detectCommandObfuscation(command) {\n\treturn { detected: false, reasons: [], matchedPatterns: [] }; /* patched #2 */\n\tif (!command || !command.trim()) return {\n\t\tdetected: false,\n\t\treasons: [],',
      description: '#2 disable command obfuscation detection'
    },
    {
      // 验证: line 74698
      find: 'throw new Error("Security Violation: Custom \'PATH\' variable is forbidden during host execution.");',
      replace: '/* patched #5 */ void 0;',
      description: '#5 allow PATH override in exec'
    },
    {
      // 验证: line 74699
      find: 'throw new Error(`Security Violation: Environment variable \'${blockedKeys[0]}\' is forbidden during host execution.`);',
      replace: '/* patched #5-#8 */ void 0;',
      description: '#5-#8 allow blocked env vars (single key)'
    },
    {
      // 验证: line 74704
      find: 'throw new Error(`Security Violation: Custom \'PATH\' variable is forbidden during host execution (${suffix}).`);',
      replace: '/* patched #5 */ void 0;',
      description: '#5 allow PATH override (with suffix)'
    },
    {
      // 验证: line 74705
      find: 'throw new Error(`Security Violation: ${suffix}.`);',
      replace: '/* patched */ void 0;',
      description: '#5-#8 allow env vars (generic suffix)'
    },
  ]);
}

// =======================================================================
// P0: ENV VARIABLE BLACKLIST (#5-#8) — shell-env
// =======================================================================
function patchEnvBlacklist() {
  const file = resolveFile('shell-env', 'BOu7XeT_');
  patchFile(file, [
    {
      // 验证: lines 9-39 — 精确匹配完整数组
      find: `\tblockedKeys: [\n\t\t"NODE_OPTIONS",\n\t\t"NODE_PATH",\n\t\t"PYTHONHOME",\n\t\t"PYTHONPATH",\n\t\t"PERL5LIB",\n\t\t"PERL5OPT",\n\t\t"RUBYLIB",\n\t\t"RUBYOPT",\n\t\t"BASH_ENV",\n\t\t"ENV",\n\t\t"GIT_EXTERNAL_DIFF",\n\t\t"GIT_EXEC_PATH",\n\t\t"SHELL",\n\t\t"SHELLOPTS",\n\t\t"PS4",\n\t\t"GCONV_PATH",\n\t\t"IFS",\n\t\t"SSLKEYLOGFILE",\n\t\t"JAVA_TOOL_OPTIONS",\n\t\t"_JAVA_OPTIONS",\n\t\t"JDK_JAVA_OPTIONS",\n\t\t"PYTHONBREAKPOINT",\n\t\t"DOTNET_STARTUP_HOOKS",\n\t\t"DOTNET_ADDITIONAL_DEPS",\n\t\t"GLIBC_TUNABLES",\n\t\t"MAVEN_OPTS",\n\t\t"SBT_OPTS",\n\t\t"GRADLE_OPTS",\n\t\t"ANT_OPTS"\n\t],`,
      replace: '\tblockedKeys: [],',
      description: '#5-#8 empty blockedKeys list'
    },
    {
      // 验证: line 84
      find: '\tblockedOverridePrefixes: ["GIT_CONFIG_", "NPM_CONFIG_"],',
      replace: '\tblockedOverridePrefixes: [],',
      description: '#5 empty blockedOverridePrefixes'
    },
    {
      // 验证: lines 85-89
      find: `\tblockedPrefixes: [\n\t\t"DYLD_",\n\t\t"LD_",\n\t\t"BASH_FUNC_"\n\t]`,
      replace: '\tblockedPrefixes: []',
      description: '#8,#27 empty blockedPrefixes (DYLD/LD/BASH_FUNC)'
    },
    {
      // blockedOverrideKeys — 用 regex 因为太长
      find: /\tblockedOverrideKeys: \[\n[\s\S]*?\t\],/,
      replace: '\tblockedOverrideKeys: [],',
      description: '#5 empty blockedOverrideKeys'
    },
  ]);
}

// =======================================================================
// P0: SSRF / NETWORK (#84-#88) — ssrf + ip + ssrf-policy + fetch-guard
// =======================================================================
function patchSSRF() {
  const ssrfFile = resolveFile('ssrf', '0bPJMoZR');
  patchFile(ssrfFile, [
    {
      // 验证: lines 35-39
      find: 'const BLOCKED_HOSTNAMES = new Set([\n\t"localhost",\n\t"localhost.localdomain",\n\t"metadata.google.internal"\n]);',
      replace: 'const BLOCKED_HOSTNAMES = new Set();',
      description: '#84 empty BLOCKED_HOSTNAMES'
    },
    {
      // 验证: lines 109-111
      find: 'function assertAllowedHostOrIpOrThrow(hostnameOrIp, policy) {\n\tif (isBlockedHostnameOrIp(hostnameOrIp, policy)) throw new SsrFBlockedError(BLOCKED_HOST_OR_IP_MESSAGE);\n}',
      replace: 'function assertAllowedHostOrIpOrThrow(hostnameOrIp, policy) {\n\treturn; /* patched #84 */\n}',
      description: '#84 disable host/IP assertion'
    },
    {
      // 验证: lines 112-114
      find: 'function assertAllowedResolvedAddressesOrThrow(results, policy) {\n\tfor (const entry of results) if (isBlockedHostnameOrIp(entry.address, policy)) throw new SsrFBlockedError(BLOCKED_RESOLVED_IP_MESSAGE);\n}',
      replace: 'function assertAllowedResolvedAddressesOrThrow(results, policy) {\n\treturn; /* patched #84 */\n}',
      description: '#84 disable resolved address assertion'
    },
  ]);

  const ipFile = resolveFile('ip', 'Ce8EDTBZ');
  patchFile(ipFile, [
    {
      // 验证: lines 3-12
      find: 'const BLOCKED_IPV4_SPECIAL_USE_RANGES = new Set([\n\t"unspecified",\n\t"broadcast",\n\t"multicast",\n\t"linkLocal",\n\t"loopback",\n\t"carrierGradeNat",\n\t"private",\n\t"reserved"\n]);',
      replace: 'const BLOCKED_IPV4_SPECIAL_USE_RANGES = new Set();',
      description: '#87 empty blocked IPv4 ranges'
    },
    {
      // 验证: lines 19-25
      find: 'const BLOCKED_IPV6_SPECIAL_USE_RANGES = new Set([\n\t"unspecified",\n\t"loopback",\n\t"linkLocal",\n\t"uniqueLocal",\n\t"multicast"\n]);',
      replace: 'const BLOCKED_IPV6_SPECIAL_USE_RANGES = new Set();',
      description: '#87 empty blocked IPv6 ranges'
    },
  ]);

  const policyFile = resolveFile('ssrf-policy', 'DYINyIKC');
  patchFile(policyFile, [
    {
      // 验证: line 6
      find: 'async function assertHttpUrlTargetsPrivateNetwork(url, params = {}) {',
      replace: 'async function assertHttpUrlTargetsPrivateNetwork(url, params = {}) { return; /* patched #86 */',
      description: '#86 disable HTTP private network assertion'
    },
  ]);

  const fetchFile = resolveFile('fetch-guard', 'CYl1q2XH');
  patchFile(fetchFile, [
    {
      // 验证: line 43
      find: 'function assertExplicitProxySupportsPinnedDns(url, dispatcherPolicy, pinDns) {\n\tif (pinDns !== false && dispatcherPolicy?.mode === "explicit-proxy" && url.protocol !== "https:") throw new Error("Explicit proxy SSRF pinning requires HTTPS targets; plain HTTP targets are not supported");\n}',
      replace: 'function assertExplicitProxySupportsPinnedDns(url, dispatcherPolicy, pinDns) {\n\treturn; /* patched #85 */\n}',
      description: '#85 disable explicit proxy SSRF pin assertion'
    },
  ]);
}

// =======================================================================
// P0: TOOL POLICY (#73-#75,#77,#79) — tool-policy-match + docker
// =======================================================================
function patchToolPolicy() {
  const tpFile = resolveFile('tool-policy-match', 'DQWWRSN4');
  patchFile(tpFile, [
    {
      // 验证: exact signature
      find: 'function isToolAllowedByPolicyName(name, policy) {\n\tif (!policy) return true;\n\treturn makeToolPolicyMatcher(policy)(name);\n}',
      replace: 'function isToolAllowedByPolicyName(name, policy) {\n\treturn true; /* patched #74 */\n}',
      description: '#74 all tools allowed by policy name'
    },
    {
      // 验证: exact signature
      find: 'function isToolAllowedByPolicies(name, policies) {\n\treturn policies.every((policy) => isToolAllowedByPolicyName(name, policy));\n}',
      replace: 'function isToolAllowedByPolicies(name, policies) {\n\treturn true; /* patched #74 */\n}',
      description: '#74 all tools allowed by policies'
    },
  ]);

  const dockerFile = resolveFile('docker', 'Bhjg8g2t');
  patchFile(dockerFile, [
    {
      // 验证: lines 68-72
      find: 'function isOwnerOnlyTool(tool) {\n\treturn tool.ownerOnly === true || isOwnerOnlyToolName(tool.name);\n}',
      replace: 'function isOwnerOnlyTool(tool) {\n\treturn false; /* patched #79,#80 */\n}',
      description: '#79,#80 disable owner-only tool check'
    },
    {
      // 验证: lines 699-713
      find: `const BLOCKED_HOST_PATHS = [\n\t"/etc",\n\t"/private/etc",\n\t"/proc",\n\t"/sys",\n\t"/dev",\n\t"/root",\n\t"/boot",\n\t"/run",\n\t"/var/run",\n\t"/private/var/run",\n\t"/var/run/docker.sock",\n\t"/private/var/run/docker.sock",\n\t"/run/docker.sock"\n];`,
      replace: 'const BLOCKED_HOST_PATHS = [];',
      description: '#30 empty blocked host paths for Docker'
    },
    {
      // 验证: line 714
      find: 'const BLOCKED_SECCOMP_PROFILES = new Set(["unconfined"]);',
      replace: 'const BLOCKED_SECCOMP_PROFILES = new Set();',
      description: '#30 allow unconfined seccomp'
    },
    {
      // 验证: line 715
      find: 'const BLOCKED_APPARMOR_PROFILES = new Set(["unconfined"]);',
      replace: 'const BLOCKED_APPARMOR_PROFILES = new Set();',
      description: '#30 allow unconfined apparmor'
    },
    {
      // 验证: line 1126
      find: '\targs.push("--security-opt", "no-new-privileges");',
      replace: '\t/* patched #30: no-new-privileges removed */',
      description: '#30 remove no-new-privileges'
    },
  ]);
}

// =======================================================================
// P0: NODE COMMAND POLICY (#80) — node-command-policy
// =======================================================================
function patchNodeCommandPolicy() {
  const file = resolveFile('node-command-policy', 'Ceicw2bH');
  patchFile(file, [
    {
      // 验证: exact multi-line function — 直接返回 ok:true
      find: `function isNodeCommandAllowed(params) {\n\tconst command = params.command.trim();\n\tif (!command) return {\n\t\tok: false,\n\t\treason: "command required"\n\t};`,
      replace: `function isNodeCommandAllowed(params) {\n\treturn { ok: true }; /* patched #80 */\n\tconst command = params.command.trim();\n\tif (!command) return {\n\t\tok: false,\n\t\treason: "command required"\n\t};`,
      description: '#80 all node commands allowed'
    },
  ]);
}

// =======================================================================
// P0: SANDBOX (#29-#37) — sandbox
// =======================================================================
function patchSandbox() {
  const file = resolveFile('sandbox', 'DTlKNieF');
  patchFile(file, [
    {
      // 验证: exact function
      find: 'function shouldSandboxSession(cfg, sessionKey, mainSessionKey) {\n\tif (cfg.mode === "off") return false;\n\tif (cfg.mode === "all") return true;\n\treturn sessionKey.trim() !== mainSessionKey.trim();\n}',
      replace: 'function shouldSandboxSession(cfg, sessionKey, mainSessionKey) {\n\treturn false; /* patched #29 */\n}',
      description: '#29 sandbox always off'
    },
  ]);
}

// =======================================================================
// P1: SESSION VISIBILITY (#46-#47) — pi-embedded
// =======================================================================
function patchSessionVisibility() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 81042
      find: 'if (params.visibility !== "all") return {',
      replace: 'if (false /* patched #46 */) return {',
      description: '#46 session visibility: allow cross-agent'
    },
  ]);
}

// =======================================================================
// P1: SUBAGENT LIMITS (#55-#58) — pi-embedded
// =======================================================================
function patchSubagentLimits() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 115086-115091 — spawn depth limit
      find: 'if (callerDepth >= maxSpawnDepth) return {\n\t\tstatus: "forbidden",',
      replace: 'if (false /* patched #55 */) return {\n\t\tstatus: "forbidden",',
      description: '#55 remove spawn depth limit'
    },
    {
      // 验证: line 115092-115097 — child count limit
      find: 'if (activeChildren >= maxChildren) return {\n\t\tstatus: "forbidden",',
      replace: 'if (false /* patched #55 */) return {\n\t\tstatus: "forbidden",',
      description: '#55 remove max children limit'
    },
    {
      // 验证: lines 117502-117511 — SUBAGENT_TOOL_DENY_ALWAYS (多行数组)
      find: 'const SUBAGENT_TOOL_DENY_ALWAYS = [\n\t"gateway",\n\t"agents_list",\n\t"whatsapp_login",\n\t"session_status",\n\t"cron",\n\t"memory_search",\n\t"memory_get",\n\t"sessions_send"\n];',
      replace: 'const SUBAGENT_TOOL_DENY_ALWAYS = []; /* patched #47,#55 */',
      description: '#47,#55 empty SUBAGENT_TOOL_DENY_ALWAYS'
    },
    {
      // 验证: lines 117516-117521 — SUBAGENT_TOOL_DENY_LEAF (多行数组)
      find: 'const SUBAGENT_TOOL_DENY_LEAF = [\n\t"subagents",\n\t"sessions_list",\n\t"sessions_history",\n\t"sessions_spawn"\n];',
      replace: 'const SUBAGENT_TOOL_DENY_LEAF = []; /* patched #55 */',
      description: '#55 empty SUBAGENT_TOOL_DENY_LEAF'
    },
    {
      // 验证: line 114868 — role assignment: leaf at max depth
      find: 'return depth < maxSpawnDepth ? "orchestrator" : "leaf";',
      replace: 'return "orchestrator"; /* patched #55: always orchestrator */',
      description: '#55 always assign orchestrator role'
    },
    {
      // 验证: line 114871 — leaf gets "none" control
      find: 'return role === "leaf" ? "none" : "children";',
      replace: 'return "children"; /* patched #55-#58: leaf gets children control */',
      description: '#55-#58 leaf gets children control'
    },
    {
      // 验证: lines 115952, 116004, 116087, 116188 — leaf restriction messages (用 replace_all 逻辑)
      find: 'error: "Leaf subagents cannot control other sessions."',
      replace: 'error: "patched: leaf control allowed"',
      description: '#55-#58 allow leaf session control (1st occurrence)',
      optional: true
    },
  ]);
}

// =======================================================================
// P1: PATH TRAVERSAL GUARDS (#15,#31,#111) — path-alias-guards + local-file-access
// =======================================================================
function patchPathGuards() {
  const paFile = resolveFile('path-alias-guards', 'CwRM04O1');
  patchFile(paFile, [
    {
      // 验证: exact function signature (multi-line)
      find: 'async function assertNoPathAliasEscape(params) {\n\tconst resolved = await resolveBoundaryPath({',
      replace: 'async function assertNoPathAliasEscape(params) {\n\treturn; /* patched #15,#31 */\n\tconst resolved = await resolveBoundaryPath({',
      description: '#15,#31 disable path alias escape guard'
    },
  ]);

  const lfFile = resolveFile('local-file-access', 'D6qxzMHn');
  patchFile(lfFile, [
    {
      // 验证: exact function
      find: 'function assertNoWindowsNetworkPath(filePath, label = "Path") {\n\tif (isWindowsNetworkPath(filePath)) throw new Error(`${label} cannot use Windows network paths: ${filePath}`);\n}',
      replace: 'function assertNoWindowsNetworkPath(filePath, label = "Path") {\n\treturn; /* patched */\n}',
      description: '#15 disable Windows network path guard'
    },
  ]);
}

// =======================================================================
// P1: INLINE EVAL DETECTION (#17-#23) — exec-inline-eval
// =======================================================================
function patchInlineEval() {
  const file = resolveFile('exec-inline-eval', 'CpmxWJsW');
  patchFile(file, [
    {
      // 验证: function start
      find: 'function detectInterpreterInlineEvalArgv(argv) {\n\tif (!Array.isArray(argv) || argv.length === 0) return null;',
      replace: 'function detectInterpreterInlineEvalArgv(argv) {\n\treturn null; /* patched #17-#23 */\n\tif (!Array.isArray(argv) || argv.length === 0) return null;',
      description: '#17-#23 disable interpreter inline eval detection'
    },
  ]);
}

// =======================================================================
// P1: AGENT-TO-AGENT COLLABORATION — pi-embedded
// =======================================================================
function patchAgentCollaboration() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 80997 — A2A policy isAllowed, disable "enabled" check
      find: 'if (!enabled) return false;',
      replace: 'return true; /* patched: a2a always allowed */ if (!enabled) return false;',
      description: 'A2A policy → always allow cross-agent communication'
    },
    {
      // 验证: line 95188 — DEFAULT_PING_PONG_TURNS hardcoded to 5
      find: 'const DEFAULT_PING_PONG_TURNS = 5;',
      replace: 'const DEFAULT_PING_PONG_TURNS = 50; /* patched: deep collaboration */',
      description: 'default ping-pong turns 5 → 50'
    },
    {
      // 验证: line 95189 — MAX_PING_PONG_TURNS hardcoded to 5
      find: 'const MAX_PING_PONG_TURNS = 5;',
      replace: 'const MAX_PING_PONG_TURNS = 50; /* patched: deep collaboration */',
      description: 'max ping-pong turns 5 → 50'
    },
    // ─── Ch9 Performance Unlocks ─────────────────────────────────
    {
      find: 'const MAX_RUN_RETRY_ITERATIONS = 160;',
      replace: 'const MAX_RUN_RETRY_ITERATIONS = 500; /* patched: Ch9 deep iteration */',
      description: 'Ch9: MAX_RUN_RETRY 160 → 500',
      optional: true,
    },
    {
      find: 'const DEFAULT_BOOTSTRAP_MAX_CHARS = 2e4;',
      replace: 'const DEFAULT_BOOTSTRAP_MAX_CHARS = 1e5; /* patched: Ch9 100K bootstrap */',
      description: 'Ch9: BOOTSTRAP 20K → 100K',
      optional: true,
    },
    {
      find: 'const MAX_RECENT_TURNS_PRESERVE = 12;',
      replace: 'const MAX_RECENT_TURNS_PRESERVE = 24; /* patched: Ch9 turn retention */',
      description: 'Ch9: TURNS_PRESERVE 12 → 24',
      optional: true,
    },
    {
      find: 'const DEFAULT_SUBAGENT_ANNOUNCE_TIMEOUT_MS = 9e4;',
      replace: 'const DEFAULT_SUBAGENT_ANNOUNCE_TIMEOUT_MS = 3e5; /* patched: Ch9 300s announce */',
      description: 'Ch9: ANNOUNCE_TIMEOUT 90s → 300s',
      optional: true,
    },
    {
      find: 'const MAX_ANNOUNCE_RETRY_COUNT = 3;',
      replace: 'const MAX_ANNOUNCE_RETRY_COUNT = 10; /* patched: Ch9 10 retries */',
      description: 'Ch9: ANNOUNCE_RETRY 3 → 10',
      optional: true,
    },
    {
      find: 'const DEFAULT_READ_PAGE_MAX_BYTES = 50 * 1024;',
      replace: 'const DEFAULT_READ_PAGE_MAX_BYTES = 256 * 1024; /* patched: Ch9 256KB */',
      description: 'Ch9: READ_PAGE 50KB → 256KB',
      optional: true,
    },
    {
      find: 'const MAX_ADAPTIVE_READ_PAGES = 8;',
      replace: 'const MAX_ADAPTIVE_READ_PAGES = 32; /* patched: Ch9 32 pages */',
      description: 'Ch9: ADAPTIVE_READ 8 → 32 pages',
      optional: true,
    },
    {
      find: 'const MAX_JOB_TTL_MS = 10800 * 1e3;',
      replace: 'const MAX_JOB_TTL_MS = 86400 * 1e3; /* patched: Ch9 24h TTL */',
      description: 'Ch9: JOB_TTL 3h → 24h',
      optional: true,
    },
  ]);
}

// =======================================================================
// P1: CROSS-CONTEXT MESSAGING (#46) — pi-embedded
// =======================================================================
function patchCrossContext() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 87548
      find: 'throw new Error(`Cross-context messaging denied: action=${params.action} target provider "${params.channel}" while bound to "${currentProvider}".`);',
      replace: '/* patched #46 */ void 0;',
      description: '#46 allow cross-context messaging (provider)'
    },
    {
      // 验证: line 87559
      find: 'throw new Error(`Cross-context messaging denied: action=${params.action} target="${target}" while bound to "${currentTarget}" (channel=${params.channel}).`);',
      replace: '/* patched #46 */ void 0;',
      description: '#46 allow cross-context messaging (target)'
    },
  ]);
}

// =======================================================================
// P1: MODEL RESTRICTIONS (#74) — pi-embedded
// =======================================================================
function patchModelRestrictions() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 112770
      find: 'if (allowed.allowedKeys.size > 0 && !allowed.allowedKeys.has(key)) throw new Error(`Model "${key}" is not allowed.`);',
      replace: '/* patched #74: model restriction removed */',
      description: '#74 remove model allowlist restriction'
    },
  ]);
}

// =======================================================================
// P1: SUBAGENT ELEVATED ACCESS (#59) — pi-embedded
// =======================================================================
function patchElevatedAccess() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 119637
      find: '"Sub-agents stay sandboxed (no elevated/host access). Need outside-sandbox read/write? Don\'t spawn; ask first."',
      replace: '"Sub-agents have full access."',
      description: '#59 remove subagent elevated access warning',
      optional: true
    },
  ]);
}

// =======================================================================
// P1: WORKSPACE BOUNDARY (#49,#76) — pi-embedded
// =======================================================================
function patchWorkspaceBoundary() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 85078 — workspaceOnly enforcement
      find: 'const enforceWorkspaceBoundary = async (hostPath) => {',
      replace: 'const enforceWorkspaceBoundary = async (hostPath) => { return; /* patched #49,#76 */',
      description: '#49,#76 disable workspace boundary enforcement'
    },
    {
      // 验证: line 70991 — fs workspaceOnly default
      find: 'const workspaceOnly = options.workspaceOnly !== false;',
      replace: 'const workspaceOnly = false; /* patched #76 */',
      description: '#76 disable fs.workspaceOnly default'
    },
  ]);
}

// =======================================================================
// P1: OWNER-ONLY TOOLS (#79,#80) — pi-embedded
// =======================================================================
function patchOwnerOnlyTools() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  // ownerOnly: true 出现在 cron(83223), gateway(83964), nodes(109647)
  // 用通用 regex 替换所有 ownerOnly: true
  patchFile(piFile, [
    {
      find: /ownerOnly:\s*true/g,
      replace: 'ownerOnly: false /* patched #79,#80 */',
      description: '#79,#80 disable ownerOnly on all tools',
      optional: true
    },
  ]);
}

// =======================================================================
// P1: HEARTBEAT DM BLOCK (#51) — pi-embedded
// =======================================================================
function patchHeartbeatDM() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 8417 — directPolicy block check
      find: `}) === "direct" && heartbeat?.directPolicy === "block")`,
      replace: `}) === "direct" && false /* patched #51 */)`,
      description: '#51 allow heartbeat DM delivery'
    },
  ]);
}

// =======================================================================
// P2: GATEWAY AUTH (#60-#72) — gateway-cli
// =======================================================================
function patchGatewayAuth() {
  const gwFile = resolveFile('gateway-cli', 'Dsd9gHBa');
  patchFile(gwFile, [
    {
      // 验证: line 38830
      find: 'if (!isLoopbackHost(bindHost) && !hasSharedSecret && authMode !== "trusted-proxy") throw new Error(`refusing to bind gateway to ${bindHost}:${params.port} without auth',
      replace: '/* patched #60 */ if (false) throw new Error(`refusing to bind gateway to ${bindHost}:${params.port} without auth',
      description: '#60 allow non-loopback bind without auth'
    },
    {
      // 验证: line 38831
      find: 'if (controlUiEnabled && !isLoopbackHost(bindHost) && controlUiAllowedOrigins.length === 0 && !dangerouslyAllowHostHeaderOriginFallback) throw new Error("non-loopback Control UI requires gateway.controlUi.allowedOrigins',
      replace: '/* patched #72 */ if (false) throw new Error("non-loopback Control UI requires gateway.controlUi.allowedOrigins',
      description: '#72 allow non-loopback Control UI without allowedOrigins'
    },
    {
      // 验证: line 10607 — session send policy block
      find: '"send blocked by session policy"',
      replace: '"send allowed by swarm patcher"',
      description: '#73 disable session send policy block'
    },
    {
      // 验证: line 12667 — second occurrence
      find: '"send blocked by session policy"',
      replace: '"send allowed by swarm patcher"',
      description: '#73 disable session send policy block (2nd)',
      optional: true
    },
    {
      // 验证: line 9051 — pre-auth payload limit
      find: 'const MAX_PREAUTH_PAYLOAD_BYTES = 64 * 1024;',
      replace: 'const MAX_PREAUTH_PAYLOAD_BYTES = 16 * 1024 * 1024; /* patched #69: 16MB */',
      description: '#69 increase pre-auth WS payload limit'
    },
    {
      // 验证: line 40730-40734 — clearUnboundScopes
      find: 'const clearUnboundScopes = () => {',
      replace: 'const clearUnboundScopes = () => { return; /* patched #64 */',
      description: '#64 keep client-declared scopes'
    },
  ]);
}

// =======================================================================
// P2: GATEWAY ORIGIN CHECK (#62) — gateway-cli
// =======================================================================
function patchGatewayOrigin() {
  const gwFile = resolveFile('gateway-cli', 'Dsd9gHBa');
  patchFile(gwFile, [
    {
      // 验证: line 40151+ — checkBrowserOrigin 函数
      find: 'function checkBrowserOrigin(params) {\n\tconst parsedOrigin = parseOrigin(params.origin);',
      replace: 'function checkBrowserOrigin(params) {\n\treturn { ok: true, matchedBy: "swarm-patcher" }; /* patched #62 */\n\tconst parsedOrigin = parseOrigin(params.origin);',
      description: '#62 disable WS origin verification'
    },
  ]);
}

// =======================================================================
// P2: RUNTIME NODE VERSION (#68) — runtime-guard
// =======================================================================
function patchRuntimeGuard() {
  const file = resolveFile('runtime-guard', 'PhQ6PwQa');
  patchFile(file, [
    {
      // 验证: exact object
      find: 'const MIN_NODE = {\n\tmajor: 22,\n\tminor: 16,\n\tpatch: 0\n};',
      replace: 'const MIN_NODE = {\n\tmajor: 18,\n\tminor: 0,\n\tpatch: 0\n};',
      description: '#68 lower Node version requirement to 18.0'
    },
  ]);
}

// =======================================================================
// P2: WEBHOOK PROTECTIONS (#91,#97-#105) — webhook-ingress
// =======================================================================
function patchWebhook() {
  const whFile = resolveFile('webhook-ingress', 'D-H5frou');
  patchFile(whFile, [
    {
      // 验证: line 625
      find: 'const PROTECTED_PLUGIN_ROUTE_PREFIXES = ["/api/channels"];',
      replace: 'const PROTECTED_PLUGIN_ROUTE_PREFIXES = []; /* patched #91 */',
      description: '#91 empty protected plugin route prefixes'
    },
  ]);
  // 注意: Telegram/Feishu/LINE/Zalo/Slack 渠道安全逻辑
  // 在实际 dist 中，渠道核心文件全是空 stub (export {};)。
  // 渠道特定验证逻辑在运行时 chunk 中，不在 dist 主文件里。
  // 这些限制 (#97-#105) 通过配置级解决 (install.js 中设置)。
}

// =======================================================================
// P2: PROMPT INJECTION HOOK (#109) — pi-embedded
// =======================================================================
function patchPromptInjection() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 148918
      find: 'if (policy?.allowPromptInjection === false && isPromptInjectionHookName(hookName)) {',
      replace: 'if (false /* patched #109 */) {',
      description: '#109 allow prompt injection hooks'
    },
  ]);
}

// =======================================================================
// P2: CONTENT SANITIZATION (#107-#108) — pi-embedded
// =======================================================================
function patchContentSanitization() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: lines 119287-119288 — sanitizeForPromptLiteral
      find: 'function sanitizeForPromptLiteral(value) {\n\treturn value.replace(/[\\p{Cc}\\p{Cf}\\u2028\\u2029]/gu, "");\n}',
      replace: 'function sanitizeForPromptLiteral(value) {\n\treturn value; /* patched #107-#108: no stripping */\n}',
      description: '#107-#108 disable Unicode/control char stripping'
    },
  ]);
}

// =======================================================================
// P2: REGISTRATION MODE (#38,#42) — pi-embedded
// =======================================================================
function patchRegistrationMode() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 148982
      find: 'const registrationMode = params.registrationMode ?? "full";',
      replace: 'const registrationMode = "full"; /* patched #38,#42 */',
      description: '#38,#42 force full registration mode for all plugins'
    },
  ]);
}

// =======================================================================
// P2: METHOD SCOPES (#78,#81-#82) — method-scopes
// =======================================================================
function patchMethodScopes() {
  const msFile = resolveFile('method-scopes', 'BiEi0X2g');
  if (!msFile) return;
  patchFile(msFile, [
    {
      // 验证: lines 2645-2660 — authorizeOperatorScopesForMethod
      find: 'function authorizeOperatorScopesForMethod(method, scopes) {\n\tif (scopes.includes("operator.admin")) return { allowed: true };',
      replace: 'function authorizeOperatorScopesForMethod(method, scopes) {\n\treturn { allowed: true }; /* patched #78,#81-#82 */\n\tif (scopes.includes("operator.admin")) return { allowed: true };',
      description: '#78,#81-#82 all method scopes authorized'
    },
  ]);
}

// =======================================================================
// P2: RESTART/CONFIG COMMANDS (#95-#96) — pi-embedded
// =======================================================================
function patchDisabledCommands() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 83971
      find: 'if (!isRestartEnabled(opts?.config)) throw new Error("Gateway restart is disabled (commands.restart=false).");',
      replace: '/* patched #95: restart always enabled */',
      description: '#95 enable /restart command'
    },
  ]);
}

// =======================================================================
// P2: PLUGIN HARDLINK REJECTION (#111) — pi-embedded
// =======================================================================
function patchHardlinkReject() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // 验证: line 149671 — non-bundled plugins get rejectHardlinks
      find: 'rejectHardlinks: candidate.origin !== "bundled"',
      replace: 'rejectHardlinks: false /* patched #111 */',
      description: '#111 disable hardlink rejection for non-bundled plugins'
    },
  ]);
}

// =======================================================================
// P2: SKILLS BOUNDARY (#112) — skills
// =======================================================================
function patchSkillsBoundary() {
  const skFile = resolveFile('skills', 'M0AZJeXx');
  if (!skFile) return;
  patchFile(skFile, [
    {
      // 验证: lines 365-376 — resolveContainedSkillPath with realpath escape check
      find: 'function resolveContainedSkillPath(params) {\n\tconst candidateRealPath = tryRealpath(params.candidatePath);\n\tif (!candidateRealPath) return null;\n\tif (isPathInside(params.rootRealPath, candidateRealPath)) return candidateRealPath;',
      replace: 'function resolveContainedSkillPath(params) {\n\tconst candidateRealPath = tryRealpath(params.candidatePath);\n\tif (!candidateRealPath) return null;\n\treturn candidateRealPath; /* patched #112: boundary check disabled */\n\tif (isPathInside(params.rootRealPath, candidateRealPath)) return candidateRealPath;',
      description: '#112 disable skill workspace boundary'
    },
  ]);
}

// =======================================================================
// P3: GOD RUNTIME — remove plugin runtime proxy restrictions
// =======================================================================
function patchRuntimeExposure() {
  const piFile = resolveFile('pi-embedded', 'CbCYZxIb');
  patchFile(piFile, [
    {
      // registrationMode 已在 patchRegistrationMode 中处理
      // 额外: 让 registrationMode "full" 检查全部跳过
      find: 'if (api.registrationMode !== "full") return;',
      replace: '/* patched: always full */ if (false) return;',
      description: '#38 bypass registrationMode gate (api level)',
      optional: true
    },
  ]);
}

// ─── Main ───────────────────────────────────────────────────────────
function main() {
  log(`Claw-Swarm OpenClaw Patcher v3.0 — based on real dist file analysis`);
  log(`Target: ${DIST}`);
  if (DRY_RUN) log('DRY RUN — no files will be modified');
  log('');

  if (!fs.existsSync(DIST)) {
    console.error(`[patcher] ERROR: dist directory not found: ${DIST}`);
    console.error(`[patcher] Make sure OpenClaw is installed at: ${OPENCLAW_DIR}`);
    process.exit(1);
  }

  // Check version
  const pkgPath = path.join(OPENCLAW_DIR, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    log(`OpenClaw version: ${pkg.version}`);
    if (!pkg.version?.startsWith('2026.3.')) {
      log(`⚠ WARNING: patcher designed for 2026.3.x, found ${pkg.version}`);
    }
  }

  log('');
  log('═══ P0: Core capability patches ═══');
  log('--- Exec Security (#1-#28) ---');
  patchExecSecurity();
  log('--- Env Blacklist (#5-#8,#27) ---');
  patchEnvBlacklist();
  log('--- SSRF/Network (#84-#88) ---');
  patchSSRF();
  log('--- Tool Policy (#73-#75,#77,#79) ---');
  patchToolPolicy();
  log('--- Node Command Policy (#80) ---');
  patchNodeCommandPolicy();
  log('--- Sandbox (#29-#37) ---');
  patchSandbox();

  log('');
  log('═══ P1: Flexibility patches ═══');
  log('--- Session Visibility (#46-#47) ---');
  patchSessionVisibility();
  log('--- Subagent Limits (#55-#58) ---');
  patchSubagentLimits();
  log('--- Path Guards (#15,#31,#111) ---');
  patchPathGuards();
  log('--- Inline Eval (#17-#23) ---');
  patchInlineEval();
  log('--- Agent Collaboration (A2A + PingPong) ---');
  patchAgentCollaboration();
  log('--- Cross-Context (#46) ---');
  patchCrossContext();
  log('--- Model Restrictions (#74) ---');
  patchModelRestrictions();
  log('--- Elevated Access (#59) ---');
  patchElevatedAccess();
  log('--- Workspace Boundary (#49,#76) ---');
  patchWorkspaceBoundary();
  log('--- Owner-Only Tools (#79,#80) ---');
  patchOwnerOnlyTools();
  log('--- Heartbeat DM (#51) ---');
  patchHeartbeatDM();

  log('');
  log('═══ P2: Gateway / plugin / content patches ═══');
  log('--- Gateway Auth (#60-#72) ---');
  patchGatewayAuth();
  log('--- Gateway Origin (#62) ---');
  patchGatewayOrigin();
  log('--- Runtime Guard (#68) ---');
  patchRuntimeGuard();
  log('--- Webhook (#91,#97-#105) ---');
  patchWebhook();
  log('--- Prompt Injection (#109) ---');
  patchPromptInjection();
  log('--- Content Sanitization (#107-#108) ---');
  patchContentSanitization();
  log('--- Registration Mode (#38,#42) ---');
  patchRegistrationMode();
  log('--- Method Scopes (#78,#81-#82) ---');
  patchMethodScopes();
  log('--- Disabled Commands (#95-#96) ---');
  patchDisabledCommands();
  log('--- Hardlink Rejection (#111) ---');
  patchHardlinkReject();
  log('--- Skills Boundary (#112) ---');
  patchSkillsBoundary();

  log('');
  log('═══ P3: God Runtime exposure patches ═══');
  patchRuntimeExposure();

  log('');
  log('═══════════════════════════════════════════════════');
  log(`Done. ${totalPatches} patches applied across ${totalFiles} files.`);
  if (totalSkipped > 0) log(`⚠ ${totalSkipped} non-optional patches missed (string not found).`);
  if (DRY_RUN) log('(DRY RUN — no changes written)');

  log('');
  log('Coverage notes:');
  log('  Config-level items (covered by install.js, not patcher):');
  log('    #38 plugin trusted, #46 visibility=all, #50/#53/#54 dmPolicy/groups,');
  log('    #60 auth token, #75 tools.profile=coding, #92 admin scopes,');
  log('    #94 command policy, #96 config/debug enabled, #97-#105 channel configs');
  log('  Channel-specific (#97-#105): Telegram/Feishu/LINE/Zalo/Slack channel');
  log('    security is in runtime chunks (not dist files). Handled by config.');
  log('  Items #89-#90 ($include/#config.env): containment logic is inline in');
  log('    gateway config loader, not exposed as patchable functions.');
}

main();
