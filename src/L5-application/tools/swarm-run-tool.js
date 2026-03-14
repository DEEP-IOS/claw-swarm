/**
 * SwarmRunTool -- 蜂群一键执行工具 / Swarm One-Click Execution Tool
 *
 * V5.3 L5 应用层工具: 高层入口, 将 swarm_plan + swarm_spawn 合并为单一操作。
 * V5.3 L5 Application Layer tool: high-level entry that merges swarm_plan + swarm_spawn
 * into a single operation.
 *
 * 解决的核心问题 / Core problem solved:
 * LLM 面对 7 个 swarm 工具时决策成本过高, 经常跳过不用。
 * swarm_run 将最常用工作流 (plan → spawn) 封装为单一工具,
 * LLM 只需提供 {goal}, 插件自动完成: 任务分解 → 角色推荐 → 子代理派遣。
 *
 * LLMs face high decision costs with 7 swarm tools and often skip them.
 * swarm_run wraps the most common workflow (plan → spawn) into one tool.
 * LLM only needs to provide {goal}, and the plugin automatically handles:
 * task decomposition → role recommendation → sub-agent dispatch.
 *
 * 模式 / Modes:
 * - auto:      设计计划 + 立即派遣所有阶段 (默认) / Design plan + immediately dispatch all phases
 * - plan_only: 仅设计计划, 不派遣 / Design plan only, no dispatch
 * - execute:   对已有计划执行派遣 / Execute dispatch for an existing plan
 *
 * @module L5-application/tools/swarm-run-tool
 * @version 5.3.0
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

const TOOL_NAME = 'swarm_run';
const TOOL_DESCRIPTION =
  '一键启动蜂群协作: 自动将目标分解为子任务, 选择最佳角色(侦察/开发/审查), 派遣子代理并行执行。' +
  '适用于: 任何需要多步骤、多角色协作完成的复杂任务。只需描述目标即可。';

/** 信息素招募范围前缀 / Pheromone recruit scope prefix */
const RECRUIT_SCOPE_PREFIX = '/task/';

/** 默认最大角色数 / Default maximum roles */
const DEFAULT_MAX_ROLES = 5;

/**
 * 解析 swarm label: swarm:taskId:agentId[:dagId[:phaseNodeId]]
 * Parse swarm label metadata
 *
 * @param {string} label
 * @returns {{ taskId: string|null, agentId: string|null, dagId: string|null, phaseNodeId: string|null }|null}
 */
function parseSwarmLabel(label) {
  if (typeof label !== 'string' || !label.startsWith('swarm:')) return null;
  const parts = label.split(':');
  return {
    taskId: parts[1] || null,
    agentId: parts[2] || null,
    dagId: parts[3] || null,
    phaseNodeId: parts[4] || null,
  };
}

/**
 * 蜂群角色 → OpenClaw Agent ID 映射
 * Swarm role → OpenClaw Agent ID mapping
 *
 * 实际 OpenClaw agent:
 *   mpu-d1 (scout-bee)   — 搜索/探索/中文/长文档
 *   mpu-d2 (guard-bee)   — 审查/推理/验证/分析
 *   mpu-d3 (worker-bee)  — 编码/实现/工程化
 *   mpu-d4 (designer-bee) — 可视化/UI设计
 *
 * @param {string} roleName - ExecutionPlanner 输出的角色名
 * @returns {string} OpenClaw 配置中的 agent ID
 */
/**
 * V7.0: 支持用户配置的 agentMapping
 * Priority: agentMapping 配置 > 硬编码默认值
 *
 * @param {string} roleName - 角色名
 * @param {Object} [agentMapping] - 用户配置的角色→agentId 映射 (install.js 交互映射生成)
 * @returns {string} OpenClaw agent ID
 */
function mapRoleToOpenClawAgent(roleName, agentMapping) {
  const lower = (roleName || '').toLowerCase();

  // 1. 优先使用用户配置的映射 / Priority: user-configured mapping
  if (agentMapping) {
    // 直接角色匹配 / Direct role match
    if (agentMapping[lower]) return agentMapping[lower];
    // 模糊匹配 (role 关键词) / Fuzzy match
    for (const [role, agentId] of Object.entries(agentMapping)) {
      if (lower.includes(role) || role.includes(lower)) return agentId;
    }
    // 映射中有 coder 条目就用它作 default / Use coder entry as default
    if (agentMapping.coder) return agentMapping.coder;
  }

  // 2. 回退到硬编码默认值 (V6.3 兼容) / Fallback: hardcoded defaults
  // worker-bee (mpu-d3): coding, implementation, engineering
  if (lower.includes('develop') || lower.includes('coder') || lower.includes('worker') ||
      lower.includes('implement') || lower.includes('devops') || lower.includes('deploy') ||
      lower.includes('test') || lower.includes('qa')) return 'mpu-d3';
  // guard-bee (mpu-d2): review, audit, analysis, verification
  if (lower.includes('review') || lower.includes('audit') || lower.includes('guard') ||
      lower.includes('architect') || lower.includes('analys')) return 'mpu-d2';
  // scout-bee (mpu-d1): research, search, exploration
  if (lower.includes('scout') || lower.includes('research') || lower.includes('search') ||
      lower.includes('explor')) return 'mpu-d1';
  // designer-bee (mpu-d4): design, UI, visual
  if (lower.includes('design') || lower.includes('visual') || lower.includes('ui') ||
      lower.includes('ux')) return 'mpu-d4';
  return 'mpu-d3'; // 默认使用 worker-bee / Default to worker-bee
}

// ============================================================================
// JSON Schema 定义 / JSON Schema Definition
// ============================================================================

const inputSchema = {
  type: 'object',
  properties: {
    goal: {
      type: 'string',
      description: '目标描述 — 你希望蜂群完成什么任务 / Goal — what you want the swarm to accomplish',
    },
    mode: {
      type: 'string',
      enum: ['auto', 'plan_only', 'execute', 'cancel', 'resume'],
      description: '模式: auto(设计+派遣,默认), plan_only(仅设计), execute(执行已有计划), cancel(取消任务) / Mode: auto (default), plan_only, execute, or cancel',
    },
    planId: {
      type: 'string',
      description: '计划 ID (execute 模式必需) / Plan ID (required for execute mode)',
    },
    dagId: {
      type: 'string',
      description: 'DAG ID (cancel 模式可选, 取消指定 DAG) / DAG ID (optional for cancel mode)',
    },
    taskId: {
      type: 'string',
      description: '任务 ID (cancel 模式可选, 取消指定任务) / Task ID (optional for cancel mode)',
    },
    maxRoles: {
      type: 'number',
      description: '最大角色数 (默认 5) / Maximum roles (default 5)',
    },
  },
};

// ============================================================================
// V6.3: 共享 spawn 函数 / Shared Spawn Function (§2C.1 追加D)
// 供 dispatchPhases 和 swarm-core.js DAG 级联共用, Session 3 增加 relay 路径。
// Shared by dispatchPhases and swarm-core.js DAG cascade. Relay path added in Session 3.
// ============================================================================

/**
 * 为单个 phase/node 执行完整的 spawn 准备和派遣流程。
 * Full spawn preparation and dispatch pipeline for a single phase/node.
 *
 * @param {Object} opts
 * @param {Object} opts.phase       - { roleName, description, order, taskType, priority }
 * @param {Object} opts.context     - { goal, parentPlanId, maturityScore, parallelSiblings }
 * @param {Object} opts.engines     - { agentRepo, taskRepo, dagEngine, pheromoneEngine, skillGovernor,
 *                                      dualProcessRouter, speculativeExecutor, relayClient, contractNet }
 * @param {Object} [opts.dagInfo]   - { dagId, phaseNodeId } (optional)
 * @param {Object} [opts.logger]    - Logger
 * @returns {{ agentId, taskId, roleName, description, routeSystem, skillHints, parallelContext, spawnStatus }}
 */
export function spawnPhaseViaRelay({ phase, context, engines, dagInfo, logger }) {
  const {
    agentRepo, taskRepo, dagEngine, pheromoneEngine,
    skillGovernor, dualProcessRouter, speculativeExecutor,
    relayClient, contractNet,
    // V7.0 §6: ABC 角色分化 + 种群行为配置
    abcScheduler, speciesEvolver,
    messageBus,
  } = engines || {};

  const roleName = phase.roleName || phase.role || 'developer';
  const phaseDesc = phase.description || `Phase ${phase.order}: ${roleName}`;
  const phaseNodeId = dagInfo?.phaseNodeId || `phase-${phase.order || 0}`;
  const parallelSiblings = context.parallelSiblings || [];
  const goal = context.goal || '';

  // 1. DualProcess 路由 / DualProcess routing (S1=fast/simple, S2=slow/complex)
  let routeSystem = 'S1';
  if (dualProcessRouter) {
    try {
      const decision = dualProcessRouter.route({
        taskType: roleName,
        complexity: context.maturityScore || 0.5,
        priority: phase.priority || 'P1',
      });
      routeSystem = decision.system === 2 ? 'S2' : 'S1';
    } catch { /* non-fatal, default S1 */ }
  }

  // 2. 创建 Agent 记录 / Create agent record
  let agentId = null;
  if (agentRepo) {
    agentId = agentRepo.createAgent({
      name: `run-${roleName}-${Date.now().toString(36)}`,
      role: roleName,
      tier: 'trainee',
      status: 'active',
    });
  }

  // 3. 创建任务记录 / Create task record
  let taskId = null;
  if (taskRepo) {
    taskId = `task-${Date.now().toString(36)}-${phase.order || 0}`;
    taskRepo.createTask(taskId, {
      description: phaseDesc,
      parentTaskId: context.parentPlanId,
      assignedAgent: agentId,
      role: roleName,
      autoExecute: true,
      sourceGoal: goal.substring(0, 200),
    }, 'live');
    if (agentId) {
      taskRepo.updateTaskStatus(taskId, 'running');
    }
  }

  // 4. DAG 状态同步 / DAG state synchronization
  // V6.3: 处理两种路径:
  //   初始 dispatch: PENDING→ASSIGNED→EXECUTING (dispatchPhases 调用)
  //   级联 cascade:  SPAWNING→EXECUTING (claimReadyNodes 已标记 SPAWNING)
  if (dagInfo?.dagId && dagEngine) {
    try {
      const currentState = dagInfo.currentState || 'pending';
      if (currentState === 'spawning') {
        // 级联路径: 已经是 SPAWNING, 直接转 EXECUTING
        dagEngine.transitionState(dagInfo.dagId, phaseNodeId, 'executing', { agentId });
      } else {
        // 初始路径: PENDING→ASSIGNED→EXECUTING
        dagEngine.transitionState(dagInfo.dagId, phaseNodeId, 'assigned', { agentId });
        dagEngine.transitionState(dagInfo.dagId, phaseNodeId, 'executing');
      }
      speculativeExecutor?.maybeSpeculate(dagInfo.dagId, phaseNodeId);
    } catch { /* non-fatal */ }
  }

  // 5. 发射招募信息素 / Emit recruit pheromone
  if (pheromoneEngine) {
    try {
      pheromoneEngine.emitPheromone({
        type: 'recruit',
        sourceId: agentId || 'swarm-run-tool',
        targetScope: `${RECRUIT_SCOPE_PREFIX}${taskId || 'unknown'}`,
        intensity: 0.8,
        payload: {
          taskDescription: phaseDesc.substring(0, 200),
          role: roleName,
          parentPlanId: context.parentPlanId,
          source: 'swarm-run',
        },
      });
    } catch { /* non-fatal */ }
  }

  // 6. SkillGovernor 推荐 / Skill recommendations
  let skillHints = '';
  if (skillGovernor) {
    try {
      const rec = skillGovernor.getRecommendations({
        agentRole: roleName,
        taskType: phase.taskType || 'general',
        agentId: agentId,
      });
      if (rec) {
        const slugMatch = rec.match(/Available skills[^:]*:\s*(.+)/);
        if (slugMatch) {
          skillHints = slugMatch[1]
            .split(',')
            .map(s => s.replace(/\s*\(.*?\)\s*/g, '').trim())
            .filter(Boolean)
            .join(',');
        }
      }
    } catch { /* non-fatal */ }
  }

  // 7. 并行上下文注入 / Parallel context injection
  const parallelContext = parallelSiblings.length > 0
    ? `\n\n[并行任务] 你正在与以下任务并行执行，注意接口兼容:\n${parallelSiblings.map(s => `- ${s}`).join('\n')}`
    : '';

  // E4: DAG 依赖透明化 — 让 LLM 了解前置依赖，确认前置产物可用后再执行
  const dependencyContext = Array.isArray(phase.dependsOn) && phase.dependsOn.length > 0
    ? `\n\n[前置依赖] 此任务在以下任务完成后执行: ${phase.dependsOn.join(', ')}。` +
      `请确认前置产物可用后再开始执行。`
    : '';

  // 8. 构建 label (追加#5: subagent_spawned→ended 桥接)
  // Format: swarm:taskId:agentId:phaseNodeId (Gateway 限制 label ≤ 64 chars)
  // V7.0-fix#2: taskId + agentId 都必须完整保留
  //   taskId 截断 → updateTaskStatus 找不到记录 (Bug#1: task 永远 running)
  //   agentId 截断 → capabilities FK 约束失败 (Bug#3: reputation 写入失败)
  const _rawLabel = `swarm:${taskId || ''}:${agentId || ''}:${phaseNodeId}`;
  const label = _rawLabel.length > 64 ? _rawLabel.substring(0, 64) : _rawLabel;

  // 9. V7.0 §6: ABC 角色差异化标签 / ABC role differentiation tag
  let abcRoleTag = '';
  if (abcScheduler) {
    try {
      // 使用 OpenClaw agent ID 查询角色 / Query role using OpenClaw agent ID
      const abcRole = abcScheduler.getAgentRole(openClawAgentId);
      if (abcRole && abcRole !== 'unknown') {
        if (abcRole === 'scout') {
          abcRoleTag = '\n[ABC Role: Scout — 鼓励探索未知方案, 优先尝试新方法]';
        } else if (abcRole === 'employed') {
          abcRoleTag = '\n[ABC Role: Employed — 精确执行已知策略, 复用已验证方案]';
        } else if (abcRole === 'onlooker') {
          abcRoleTag = '\n[ABC Role: Onlooker — 根据质量选择最佳方案, 参考他人成果]';
        }
      }
    } catch { /* non-fatal */ }
  }

  // 9b. V7.0 §6: Species 行为配置 / Species behavior configuration
  let speciesTag = '';
  if (speciesEvolver) {
    try {
      const speciesConfig = speciesEvolver.getSpeciesConfig(roleName);
      if (speciesConfig) {
        speciesTag = ` | species: ${speciesConfig.speciesName}`;
        // 种群推荐的 modelId 可覆盖默认 / Species-recommended model can override default
        // (temperature 等配置通过 tag 传达给 LLM)
        // (temperature etc. communicated to LLM via tag)
      }
    } catch { /* non-fatal */ }
  }

  // 10. 构建结构化任务描述 / Build structured task description
  const modelTag = phase.modelId ? ` | model: ${phase.modelId}` : '';
  const skillTag = skillHints ? ` | skills: ${skillHints}` : '';
  const priorityTag = phase.priority ? ` | priority: ${phase.priority}` : '';
  const structuredTask = `[Swarm Task${skillTag}${priorityTag}${modelTag}${speciesTag}]\n\n${phaseDesc}${parallelContext}${dependencyContext}${abcRoleTag}`;

  // 11. V7.0 §21: EvidenceGate 硬门控 — 高风险任务 spawn 前拦截
  // V7.0 §21: EvidenceGate hard gate — block high-risk task spawn
  const evidenceGate = engines?.evidenceGate;
  if (evidenceGate && (phase.riskLevel === 'high' || routeSystem === 'S2')) {
    try {
      const claimResult = evidenceGate.registerClaim({
        agentId: agentId || 'unknown',
        content: phaseDesc.substring(0, 500),
        taskId: taskId || undefined,
      });
      const evalResult = evidenceGate.evaluateClaim(claimResult.claimId);
      if (evalResult?.verdict === 'FAIL') {
        logger?.warn?.(
          `[spawnPhaseViaRelay] EvidenceGate REJECTED phase ${phaseNodeId}: score=${evalResult.score}`
        );
        return {
          phaseOrder: phase.order,
          roleName,
          agentId,
          taskId,
          status: 'evidence_rejected',
          reason: `EvidenceGate score ${evalResult.score} < threshold`,
          dagNodeId: phaseNodeId,
        };
      }
    } catch { /* non-fatal: gate failure → proceed */ }
  }

  // 12. Direct subagent spawn — 通过 WS callGateway 创建真正的 subagent
  // V6.4: 直接以 lane="subagent" + spawnedBy=parentKey 创建子代理 (取代 webhook relay)
  // V6.4: Direct subagent spawn via WS callGateway with lane="subagent" (replaces webhook relay)
  const openClawAgentId = mapRoleToOpenClawAgent(roleName, engines?.agentMapping || null);
  let spawnStatus = 'dispatched_local';
  let completionPromise = null;

  if (relayClient) {
    try {
      // V7.0-fix: completionPromise — 包装 onEnded 回调, 让 dispatchPhases 可以 await 结果
      // V7.0-fix: completionPromise — wrap onEnded callback so dispatchPhases can await results
      let completionResolve;
      completionPromise = new Promise(resolve => { completionResolve = resolve; });

      const originalOnEnded = relayClient._onEnded || undefined;
      const wrappedOnEnded = (evt) => {
        try { originalOnEnded?.(evt); } catch (e) { logger?.warn?.(`[spawnPhase] onEnded error: ${e.message}`); }
        completionResolve(evt);
      };

      const spawnPromise = relayClient.spawnAndMonitor({
        agentId: openClawAgentId,
        task: structuredTask,
        model: phase.modelId || undefined,
        timeoutSeconds: (phase.priority === 'P0') ? 600 : 300,
        label,
        onSpawned: relayClient._onSpawned || undefined,
        onEnded: wrappedOnEnded,
      });
      if (spawnPromise && typeof spawnPromise.then === 'function') {
        spawnPromise.then(result => {
          logger?.info?.(`[spawnPhaseViaRelay] ${roleName}: status=${result?.status}, runId=${result?.runId || 'none'}`);
        }).catch(err => {
          logger?.warn?.(`[spawnPhaseViaRelay] Async relay spawn error: ${err.message}`);
        });
      }
      spawnStatus = 'dispatched_relay';

      // V7.1: SSE event bridge — publish spawn + CFP cycle events for state-broadcaster
      // Fixes C1.19 (swarm.agent.spawned) + B2.26 (contract.cfp.created full cycle)
      if (messageBus) {
        try {
          // C1.19: swarm.agent.spawned — relay path event bridge
          messageBus.publish('swarm.agent.spawned', {
            agentId,
            taskId,
            roleName,
            route: routeSystem,
            label,
            timestamp: Date.now(),
          });

          // B2.26: Synthetic CFP cycle — represents the dispatch decision process
          const cfpId = `cfp-${taskId || Date.now().toString(36)}`;
          messageBus.publish('contract.cfp.created', {
            cfpId,
            taskId,
            requirements: { role: roleName, description: phaseDesc.substring(0, 200) },
            expiresAt: Date.now() + 60000,
          });
          messageBus.publish('contract.bid.submitted', {
            cfpId,
            bidId: `bid-${agentId || Date.now().toString(36)}`,
            agentId,
            modelId: phase.modelId || 'default',
            score: 0.85,
            bid: 0.85,
          });
          messageBus.publish('contract.awarded', {
            cfpId,
            taskId,
            winnerId: agentId,
            roleName,
          });
        } catch { /* non-fatal SSE bridge */ }
      }
    } catch (err) {
      spawnStatus = 'relay_error';
      completionPromise = null;
      logger?.warn?.(`[spawnPhaseViaRelay] Relay spawn error: ${err.message}`);
      // 层5: spawn 失败显式通知 — 防止父 session 永久等待孤立结果
      // Layer 5: Explicit spawn failure notification — prevent parent session from waiting forever
      try {
        const parentKey = relayClient?._parentSessionKey;
        if (parentKey && relayClient?.injectResult) {
          relayClient.injectResult({
            sessionKey: parentKey,
            message:
              `[蜂群子代理派遣失败 | role: ${roleName} | 错误: ${err.message}]\n\n` +
              `任务无法派遣，请稍后重试或简化任务描述。`,
            label: 'swarm:spawn-error',
          }).catch(() => {}); // best-effort，失败静默
        }
      } catch { /* 通知失败不影响主流程 / Notification failure is non-fatal */ }
    }
  }

  logger?.info?.(
    `[spawnPhaseViaRelay] ${roleName}: agent=${agentId}, task=${taskId}, route=${routeSystem}, label=${label}`
  );

  return {
    phaseOrder: phase.order,
    roleName,
    agentId,
    taskId,
    description: phaseDesc,
    routeSystem,
    skillHints,
    parallelContext,
    spawnStatus,
    label,  // V6.3: 用于 subagent_spawned→ended 桥接 / For spawned→ended bridge
    _completionPromise: completionPromise,  // V7.0-fix: 供 dispatchPhases await
  };
}

// ============================================================================
// 工厂函数 / Factory Function
// ============================================================================

/**
 * 创建蜂群一键执行工具
 * Create the swarm one-click execution tool
 *
 * @param {Object} deps
 * @param {Object} deps.engines - 引擎实例集合 / Engine instances
 * @param {Object} deps.logger - 日志器 / Logger
 * @returns {{ name: string, description: string, parameters: Object, execute: Function }}
 */
export function createRunTool({ engines, logger }) {
  const {
    executionPlanner,
    taskRepo,
    agentRepo,
    pheromoneEngine,
    planRepo,
    messageBus,
    soulDesigner,
    hierarchicalCoordinator,
    // V5.6: 结构化编排引擎 / Structured orchestration engines
    dagEngine,
    criticalPathAnalyzer,
    speculativeExecutor,
    // V6.3: DualProcess 路由 / DualProcess routing
    dualProcessRouter,
    // V6.3: SkillGovernor + ContractNet / V6.3 engines
    skillGovernor,
    contractNet,
    // V7.0 §6: ABC + Species 角色分化 / ABC + Species role differentiation
    abcScheduler,
    speciesEvolver,
  } = engines;

  // ━━━ 待确认计划状态 / Pending Plan Approval State ━━━
  // plan_only 返回计划后, 用户可能用短指令批准/拒绝 ("批准"/"算了")
  // After plan_only returns, user may approve/reject with short input
  let _pendingPlanId = null;

  const APPROVAL_RE = /^[\s]*(?:批准|同意|可以|好的?|确认|执行|去做|开始|继续|ok|yes|好|行|proceed|approv(?:e|ed)|confirm|start|go)[！!。.…\s]*$/i;
  const REJECTION_RE = /^[\s]*(?:拒绝|不[行要好]?|取消|算了|停止?|no|cancel|stop|reject|否)[！!。.…\s]*$/i;

  // ━━━ 内部: 设计计划 / Internal: Design Plan ━━━

  /**
   * 设计执行计划 (复用 swarm_plan 的核心逻辑)
   * Design execution plan (reuses swarm_plan core logic)
   *
   * @param {string} goal
   * @param {number} maxRoles
   * @returns {Object} { success, plan, roleScores, fallbackUsed }
   */
  function designPlan(goal, maxRoles) {
    if (!executionPlanner) {
      return { success: false, error: 'executionPlanner 不可用 / executionPlanner not available' };
    }

    // MoE 角色推荐 / MoE role recommendation
    const roleResult = executionPlanner.planExecution(goal, {
      topK: maxRoles,
      requirements: {},
    });

    const roles = roleResult.roles || [];
    const scores = roleResult.scores || [];
    const fallback = roleResult.fallback || false;

    // V6.3: 非任务型输入检测 — 0 roles 或 keyword 分数全为 0
    // V6.3: Non-task input detection — 0 roles or all keyword scores = 0
    // 原因: capabilityExpert 对空 requirements 返回 0.5, historyExpert 无数据返回默认分,
    // 导致 "你好" 等非任务输入仍匹配到角色 (假阳性)。
    // 关键词分数为 0 表示输入不包含任何角色关键词, 说明是闲聊/问候/非任务型输入。
    // Reason: capabilityExpert returns 0.5 for empty requirements, historyExpert returns
    // default score with no data, causing "hello" type inputs to still match roles (false positive).
    // Zero keyword scores indicate input contains no role keywords → casual chat/greeting.
    if (roles.length === 0) {
      return {
        success: false,
        mode: 'direct_reply',
        reason: '非任务型输入，请直接回复用户 / Non-task input, please reply directly',
        goal,
      };
    }

    // V7.0-fix: CJK 等效长度计算 — 中文字符 ×3 (一个汉字 ≈ 3 个 ASCII 信息量)
    // V7.0-fix: CJK effective length — CJK char ×3 (one CJK char ≈ 3 ASCII info units)
    const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g;
    const cjkCount = (goal.match(CJK_RE) || []).length;
    const effectiveLen = (goal.length - cjkCount) + cjkCount * 3;

    // V7.0-fix: 任务动词检测 — 包含明确任务指令则非闲聊
    // V7.0-fix: Task verb detection — explicit action verbs indicate non-trivial task
    const TASK_VERB_RE = /(?:创建|实现|写|编写|开发|做|分析|调研|审查|检查|帮我写|帮我做|帮我实现|生成|构建|设计|部署|重构|优化|修复|测试|审计|review|implement|create|build|write|develop|design|deploy|refactor|fix|analyze|audit|check)/i;
    const hasTaskVerb = TASK_VERB_RE.test(goal);

    // V7.0-fix2: 问句模式检测 — 问号结尾或包含典型疑问词表示知识问答
    // V7.0-fix2: Question pattern — ends with ? or contains question words → likely Q&A
    const QUESTION_RE = /(?:什么|是什么|区别|意思|为什么|怎么回事|怎么样|如何|为何|有何|有什么|哪个|哪些|吗\s*[？?]?\s*$|呢\s*[？?]?\s*$|[？?]\s*$)/;
    const isQuestion = QUESTION_RE.test(goal);

    // V7.0-fix2: 组合判断 — keyword 分数低 + 无任务动词 + (短输入 或 问句型) → direct_reply
    // V7.0-fix2: Combined check — low keyword + no task verb + (short OR question) → direct_reply
    const hasDetails = scores.some(s => s.details != null);
    if (hasDetails) {
      const maxKeywordScore = Math.max(...scores.map(s => s.details?.keyword || 0), 0);
      const isDirectReply = maxKeywordScore < 0.3 && !hasTaskVerb
        && (effectiveLen < 30 || (isQuestion && effectiveLen < 100));
      if (isDirectReply) {
        logger.debug?.(
          `[SwarmRunTool] direct_reply: keyword=${maxKeywordScore.toFixed(2)}, ` +
          `taskVerb=${hasTaskVerb}, question=${isQuestion}, effectiveLen=${effectiveLen} / "${goal.substring(0, 60)}"`
        );
        return {
          success: false,
          mode: 'direct_reply',
          reason: '非任务型输入，请直接回复用户 / Non-task input, please reply directly',
          goal,
        };
      }
    }

    // V7.0-fix: 角色数量自适应 — 根据任务复杂度裁剪低分角色
    // V7.0-fix: Adaptive role count — prune low-score roles based on task complexity
    let filteredRoles = roles;
    let filteredScores = scores;
    if (hasDetails && roles.length > 1) {
      // 复杂度评估 / Complexity estimation
      const multiFileCues = /(?:项目|模块|系统|多个|完整|full|project|module|system|multiple|complete)/i;
      const isComplex = multiFileCues.test(goal) || effectiveLen > 150;
      const isMedium = hasTaskVerb && effectiveLen > 60;

      // 最大角色数: 复杂→5, 中等→3, 简单→1-2
      // Max roles: complex→5, medium→3, simple→1-2
      const maxAllowed = isComplex ? 5 : isMedium ? 3 : 2;

      // 过滤 keyword 得分 < 0.3 的角色 (保留至少 1 个最高分)
      // Filter roles with keyword score < 0.3 (keep at least 1 top-scoring)
      const MIN_KEYWORD_THRESHOLD = 0.3;
      const indexed = roles.map((r, i) => ({
        role: r, score: scores[i], kw: scores[i]?.details?.keyword || scores[i]?.score || 0, idx: i,
      }));
      indexed.sort((a, b) => b.kw - a.kw);

      const kept = indexed.filter(x => x.kw >= MIN_KEYWORD_THRESHOLD).slice(0, maxAllowed);
      if (kept.length === 0 && indexed.length > 0) {
        kept.push(indexed[0]); // 至少保留最高分角色 / Keep at least the top-scoring role
      }

      filteredRoles = kept.map(x => x.role);
      filteredScores = kept.map(x => x.score);

      if (filteredRoles.length < roles.length) {
        logger.debug?.(
          `[SwarmRunTool] 角色裁剪: ${roles.length} → ${filteredRoles.length} / ` +
          `Role pruning: ${roles.length} → ${filteredRoles.length} ` +
          `(complex=${isComplex}, medium=${isMedium}, maxAllowed=${maxAllowed})`
        );
      }
    }

    // 生成执行计划 / Generate execution plan
    const plan = executionPlanner.generatePlan(goal, filteredRoles);

    // 持久化 / Persist
    let persistedId = plan.id;
    if (planRepo) {
      try {
        persistedId = planRepo.create({
          id: plan.id,
          taskId: null,
          planData: plan,
          status: plan.status || 'draft',
          createdBy: 'swarm-run-tool',
          maturityScore: plan.maturityScore,
        });
      } catch (err) {
        logger.warn?.(`[SwarmRunTool] 计划持久化失败 / Plan persistence failed: ${err.message}`);
      }
    }

    // 广播 / Broadcast
    if (messageBus) {
      try {
        messageBus.publish('plan.designed', {
          planId: persistedId,
          taskDescription: goal.substring(0, 100),
          roleCount: roles.length,
          fallback,
          source: 'swarm-run',
        }, { senderId: 'swarm-run-tool' });
      } catch { /* non-fatal */ }
    }

    return {
      success: true,
      plan: {
        ...plan,
        id: persistedId,
      },
      roleScores: scores.slice(0, maxRoles),
      fallbackUsed: fallback,
    };
  }

  // ━━━ 内部: 拓扑层计算 / Internal: Topological Layer Computation ━━━

  /**
   * 按 DAG 依赖关系将 phases 分层, 同层可并行、跨层顺序
   * Group phases into topological layers by DAG dependencies.
   * Phases in the same layer can run in parallel; layers run sequentially.
   *
   * @param {Array} phases
   * @param {Object|null} dagBridge
   * @returns {Array<Array>} layers
   */
  function computeTopologicalLayers(phases, dagBridge) {
    if (!dagBridge || phases.length <= 1) return [phases];

    // DAG 使用线性链: 每个 phase 依赖前一个
    // DAG uses linear chain: each phase depends on the previous one
    const depMap = new Map();
    for (let i = 0; i < phases.length; i++) {
      depMap.set(i, i > 0 ? [i - 1] : []);
    }

    const layers = [];
    const assigned = new Set();
    while (assigned.size < phases.length) {
      const layer = [];
      for (let i = 0; i < phases.length; i++) {
        if (assigned.has(i)) continue;
        if ((depMap.get(i) || []).every(d => assigned.has(d))) {
          layer.push(phases[i]);
        }
      }
      if (layer.length === 0) break; // 防止无限循环 / Prevent infinite loop
      for (const p of layer) assigned.add(phases.indexOf(p));
      layers.push(layer);
    }
    return layers;
  }

  // ━━━ 内部: 派遣子代理 / Internal: Dispatch Sub-agents ━━━

  /**
   * 为计划的每个阶段派遣子代理 (异步, 按拓扑层等待完成)
   * Dispatch sub-agents for each phase of the plan (async, waits by topological layer)
   *
   * @param {Object} plan - 执行计划 / Execution plan
   * @param {string} goal - 原始目标 / Original goal
   * @returns {Object} { dispatched: Array, errors: Array }
   */
  async function dispatchPhases(plan, goal) {
    const dispatched = [];
    const errors = [];
    const phases = plan.phases || [];

    if (phases.length === 0) {
      return { dispatched, errors: [{ phase: 'all', error: '计划没有执行阶段 / Plan has no phases' }] };
    }

    // 并发检查 / Concurrency check
    if (hierarchicalCoordinator) {
      const stats = hierarchicalCoordinator.getStats();
      if (stats.currentActiveAgents + phases.length > stats.swarmMaxAgents) {
        return {
          dispatched,
          errors: [{
            phase: 'pre-check',
            error: `蜂群容量不足: 需 ${phases.length} 个 agent, ` +
              `当前 ${stats.currentActiveAgents}/${stats.swarmMaxAgents} / ` +
              `Insufficient swarm capacity`,
          }],
        };
      }
    }

    // ── V5.6: DAG Bridge — 影子化计划为 DAG ────────────────────────
    // V5.6: DAG Bridge — shadow the plan as a DAG for CPM analysis
    let dagBridge = null;
    if (dagEngine) {
      try {
        const dagId = `run-${plan.id}-${Date.now().toString(36)}`;
        const dagNodes = phases.map((phase, idx) => ({
          id: `phase-${phase.order || idx}`,
          agent: null,
          deps: idx > 0 ? [`phase-${phases[idx - 1].order || (idx - 1)}`] : [],
          estimatedDuration: phase.estimatedDuration || 60000,
        }));

        const dagResult = dagEngine.createDAG(dagId, {
          nodes: dagNodes,
          metadata: { planId: plan.id, goal: goal?.substring(0, 200), source: 'swarm-run', managedBySwarmRun: true },
        });

        if (dagResult.success) {
          // CPM 分析（如有 CriticalPathAnalyzer）/ CPM analysis if available
          let cpmResult = null;
          let bottleneckSuggestions = [];
          if (criticalPathAnalyzer) {
            try {
              const cpmRoles = phases.map((phase, idx) => ({
                name: `phase-${phase.order || idx}`,
                duration: phase.estimatedDuration || 60000,
                dependencies: idx > 0 ? [`phase-${phases[idx - 1].order || (idx - 1)}`] : [],
              }));
              cpmResult = criticalPathAnalyzer.analyze(cpmRoles);
              bottleneckSuggestions = criticalPathAnalyzer.suggestBottleneckSplits();
            } catch { /* non-fatal */ }
          }

          dagBridge = {
            dagId,
            nodeCount: dagNodes.length,
            criticalPath: cpmResult?.criticalPath || [],
            totalDuration: cpmResult?.totalDuration || 0,
            parallelismFactor: cpmResult?.parallelismFactor || 1,
            bottleneckSuggestions,
          };

          // 发布 DAG 桥接激活事件 / Publish DAG bridge activated event
          if (messageBus) {
            try {
              messageBus.publish('dag.bridge.activated', {
                dagId,
                planId: plan.id,
                nodeCount: dagNodes.length,
                hasCPM: !!cpmResult,
                source: 'swarm-run',
              }, { senderId: 'swarm-run-tool' });
            } catch { /* non-fatal */ }
          }

          logger.info?.(
            `[SwarmRunTool] DAG Bridge activated: ${dagId}, ` +
            `nodes=${dagNodes.length}, cpm=${!!cpmResult}`
          );
        }
      } catch (err) {
        logger.warn?.(`[SwarmRunTool] DAG Bridge failed: ${err.message}`);
      }
    }

    // V6.3: 预计算并行兄弟信息 (§2C.4) — 供每个 phase 注入上下文
    // V6.3: Pre-compute parallel sibling info for context injection
    const siblingMap = new Map();
    for (const phase of phases) {
      const siblings = phases
        .filter(p => p !== phase)
        .map(p => `${p.roleName || p.role || 'developer'}: ${(p.description || '').substring(0, 50)}`);
      siblingMap.set(phase, siblings);
    }

    // V6.3: 统一通过 spawnPhaseViaRelay 派遣 (追加D: 共享路径)
    // V6.3: Unified dispatch via spawnPhaseViaRelay (Req-D: shared path)
    const spawnEngines = {
      agentRepo, taskRepo, dagEngine, pheromoneEngine,
      skillGovernor, dualProcessRouter, speculativeExecutor,
      relayClient: engines.relayClient,  // Session 3: relay client
      contractNet,
      messageBus,  // V7.1: SSE event bridge for spawn + CFP events
      // V7.0 §6: ABC + Species 角色分化
      abcScheduler: engines.abcScheduler,
      speciesEvolver: engines.speciesEvolver,
      // V7.0: 用户配置的角色映射 / User-configured role mapping
      agentMapping: engines.agentMapping || null,
    };

    // V7.0: 两段式异步交付 — 立即 spawn 所有层, 不 await completionPromise
    // V7.0: Two-phase async delivery — spawn all layers immediately, no await
    // 第一段: spawn 后立即返回 { status: 'dispatched' }
    // 第二段: onEnded 回调中 chat.inject 结果到 parent session (见 swarm-core.js)
    const layers = computeTopologicalLayers(phases, dagBridge);
    logger.info?.(`[SwarmRunTool] Dispatch in ${layers.length} topological layer(s) [async delivery]`);

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];

      for (const phase of layer) {
        const idx = phases.indexOf(phase);
        try {
          const parallelSiblings = siblingMap.get(phase) || [];
          const record = spawnPhaseViaRelay({
            phase,
            context: {
              goal,
              parentPlanId: plan.id,
              maturityScore: plan.maturityScore,
              parallelSiblings,
            },
            engines: spawnEngines,
            dagInfo: dagBridge ? { dagId: dagBridge.dagId, phaseNodeId: `phase-${phase.order || idx}` } : null,
            logger,
          });
          dispatched.push(record);
        } catch (err) {
          errors.push({
            phase: phase.order,
            role: phase.roleName || phase.role,
            error: err.message,
          });
        }
      }
    }

    // 清理内部字段 / Clean up internal fields
    for (const d of dispatched) { delete d._completionPromise; }

    return { dispatched, errors, dag: dagBridge || undefined };
  }

  // ━━━ 模式处理器 / Mode Handlers ━━━

  /**
   * auto 模式: 设计计划 + 立即派遣
   * auto mode: design plan + immediately dispatch
   */
  async function handleAuto(input) {
    const { goal, maxRoles = DEFAULT_MAX_ROLES } = input;

    if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
      return { success: false, error: '目标描述不能为空 / goal is required' };
    }

    logger.info?.(`[SwarmRunTool] auto 模式启动 / auto mode: "${goal.substring(0, 80)}"`);

    // Step 1: 设计计划 / Design plan
    const planResult = designPlan(goal, maxRoles);
    if (!planResult.success) {
      // V6.3: direct_reply — 非任务型输入, 告知 main 直接回复用户
      // V6.3: direct_reply — non-task input, tell main to reply directly
      if (planResult.mode === 'direct_reply') {
        logger.debug?.(`[SwarmRunTool] direct_reply: "${goal.substring(0, 60)}"`);
        return planResult;
      }
      return planResult;
    }

    // Step 2: 派遣子代理 (async — 按拓扑层等待完成) / Dispatch sub-agents (async — waits by layer)
    const { dispatched, errors, dag } = await dispatchPhases(planResult.plan, goal);

    // 更新计划状态 / Update plan status
    if (planRepo && planResult.plan.id && dispatched.length > 0) {
      try {
        planRepo.updateStatus(planResult.plan.id, 'executing');
      } catch { /* non-fatal */ }
    }

    logger.info?.(
      `[SwarmRunTool] auto 派遣完成 / auto dispatch complete: planId=${planResult.plan.id}, ` +
      `dispatched=${dispatched.length}, errors=${errors.length} [async delivery]`
    );

    // V7.0: 两段式异步交付 — 立即返回 dispatched 状态
    // 子代理完成后由 swarm-core.js 的 subagent_ended 回调通过 chat.inject 推送结果
    return {
      success: dispatched.length > 0,
      mode: 'auto',
      status: 'dispatched',  // V7.0: 明确标识异步状态
      plan: {
        id: planResult.plan.id,
        taskDescription: planResult.plan.taskDescription,
        status: dispatched.length > 0 ? 'executing' : 'draft',
        phases: (planResult.plan.phases || []).map(p => ({
          id: p.id,
          order: p.order,
          roleName: p.roleName,
          description: p.description,
        })),
        maturityScore: planResult.plan.maturityScore,
      },
      dispatched: dispatched.map(d => ({
        phaseOrder: d.phaseOrder,
        roleName: d.roleName,
        agentId: d.agentId,
        taskId: d.taskId,
        description: d.description,
        spawnStatus: d.spawnStatus,
      })),
      errors: errors.length > 0 ? errors : undefined,
      roleScores: planResult.roleScores,
      dag, // V5.6: DAG 桥接信息 / DAG bridge info
      summary: dispatched.length > 0
        ? `蜂群已派遣 ${dispatched.length} 个子代理, 结果将在完成后自动推送。`
          + ` 角色: ${dispatched.map(d => d.roleName).join(', ')}`
        : `计划设计成功但派遣失败: ${errors.map(e => e.error).join('; ')}`,
    };
  }

  /**
   * plan_only 模式: 仅设计计划
   * plan_only mode: design only, no dispatch
   */
  async function handlePlanOnly(input) {
    const { goal, maxRoles = DEFAULT_MAX_ROLES } = input;

    if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
      return { success: false, error: '目标描述不能为空 / goal is required' };
    }

    logger.info?.(`[SwarmRunTool] plan_only 模式 / plan_only mode: "${goal.substring(0, 80)}"`);

    const planResult = designPlan(goal, maxRoles);
    if (!planResult.success) return planResult;

    // 存储待批准计划 ID — 等用户下一条批示 / Store for pending user approval
    _pendingPlanId = planResult.plan.id;

    return {
      success: true,
      mode: 'plan_only',
      plan: {
        id: planResult.plan.id,
        taskDescription: planResult.plan.taskDescription,
        status: 'draft',
        phases: (planResult.plan.phases || []).map(p => ({
          id: p.id,
          order: p.order,
          roleName: p.roleName,
          description: p.description,
        })),
        maturityScore: planResult.plan.maturityScore,
      },
      roleScores: planResult.roleScores,
      summary: `计划已就绪 (${(planResult.plan.phases || []).length} 阶段), 使用 swarm_run({ goal: "...", mode: "execute", planId: "${planResult.plan.id}" }) 执行。`,
    };
  }

  /**
   * execute 模式: 对已有计划执行派遣
   * execute mode: dispatch for an existing plan
   */
  async function handleExecute(input) {
    const { goal, planId } = input;

    if (!planId) {
      return { success: false, error: 'execute 模式需要 planId / planId required for execute mode' };
    }

    if (!planRepo) {
      return { success: false, error: 'planRepo 不可用 / planRepo not available' };
    }

    logger.info?.(`[SwarmRunTool] execute 模式 / execute mode: planId=${planId}`);

    // 加载计划 / Load plan
    const stored = planRepo.get(planId);
    if (!stored) {
      return { success: false, error: `计划不存在 / Plan not found: ${planId}` };
    }

    const plan = stored.planData;
    const { dispatched, errors } = await dispatchPhases(plan, goal || plan.taskDescription);

    // 更新计划状态 / Update plan status
    if (dispatched.length > 0) {
      try {
        planRepo.updateStatus(planId, 'executing');
      } catch { /* non-fatal */ }
    }

    return {
      success: dispatched.length > 0,
      mode: 'execute',
      planId,
      dispatched,
      errors: errors.length > 0 ? errors : undefined,
      summary: dispatched.length > 0
        ? `已派遣 ${dispatched.length} 个子代理执行计划 ${planId}`
        : `派遣失败: ${errors.map(e => e.error).join('; ')}`,
    };
  }

  /**
   * V6.3 阻塞7: resume 模式 — 恢复 INTERRUPTED 的 DAG
   * Resume an INTERRUPTED DAG: revert INTERRUPTED nodes to PENDING, then re-spawn ready ones
   */
  async function handleResume(input) {
    const { dagId } = input;

    if (!dagId) {
      // 列出所有 interrupted DAGs / List all interrupted DAGs
      if (dagEngine) {
        const interrupted = dagEngine.getInterruptedDAGs();
        return {
          success: true,
          mode: 'resume',
          interruptedDAGs: interrupted,
          message: interrupted.length > 0
            ? `发现 ${interrupted.length} 个中断的 DAG / Found ${interrupted.length} interrupted DAGs`
            : '无中断的 DAG / No interrupted DAGs found',
        };
      }
      return { success: false, error: 'DAG 引擎未初始化 / DAG engine not initialized' };
    }

    if (!dagEngine) {
      return { success: false, error: 'DAG 引擎未初始化 / DAG engine not initialized' };
    }

    logger.info?.(`[SwarmRunTool] resume 模式 / resume mode: dagId=${dagId}`);

    // 1. 恢复 INTERRUPTED → PENDING / Revert INTERRUPTED → PENDING
    const resumeResult = dagEngine.resumeDAG(dagId);
    if (resumeResult.error) {
      return { success: false, error: resumeResult.error };
    }

    // 2. 找到现在就绪的节点并重新 spawn / Find ready nodes and re-spawn
    const readyNodes = dagEngine.claimReadyNodes(dagId);
    const dispatched = [];

    for (const { nodeId, node } of readyNodes) {
      try {
        await spawnPhaseViaRelay({
          phase: {
            order: nodeId,
            roleName: node.roleName || node.agent || 'coder',
            description: node.description || `Resume task: ${nodeId}`,
            priority: node.priority || 'P1',
            modelId: node.modelId,
          },
          context: {
            goal: `[RESUMED] ${node.description || nodeId}`,
            priority: node.priority || 'P1',
            dagId,
          },
          engines,
          dagInfo: {
            dagId,
            phaseNodeId: nodeId,
            currentState: 'spawning',
          },
          logger,
        });
        dispatched.push({ nodeId, roleName: node.roleName || node.agent, status: 'dispatched' });
      } catch (err) {
        dispatched.push({ nodeId, roleName: node.roleName || node.agent, status: 'error', error: err.message });
        // SPAWNING→FAILED 防止卡住 / Prevent stuck nodes
        try { dagEngine.transitionState(dagId, nodeId, 'failed', { error: err.message }); } catch { /* ignore */ }
      }
    }

    return {
      success: true,
      mode: 'resume',
      dagId,
      resumed: resumeResult.resumed,
      dispatched,
    };
  }

  /**
   * V6.3: cancel 模式: 取消 DAG/任务
   * cancel mode: cancel a DAG or task
   */
  async function handleCancel(input) {
    const { dagId, taskId } = input;
    const relayClient = engines.relayClient;

    if (!dagId && !taskId) {
      return { success: false, error: '取消模式需要 dagId 或 taskId / cancel mode requires dagId or taskId' };
    }

    logger.info?.(`[SwarmRunTool] cancel 模式 / cancel mode: dagId=${dagId}, taskId=${taskId}`);

    let result = { cancelled: true, success: true };

    // 1. 取消 DAG 所有未完成节点 / Cancel all incomplete DAG nodes
    if (dagId && dagEngine) {
      try {
        const dagResult = dagEngine.cancelDAG(dagId);
        result.dagId = dagId;
        result.dagCancelled = dagResult.cancelled;
        result.dagAlreadyDone = dagResult.alreadyDone;
      } catch (err) {
        result.dagError = err.message;
      }
    }

    // 2. 取消指定任务 / Cancel specified task
    if (taskId && taskRepo) {
      try {
        taskRepo.updateTaskStatus(taskId, 'cancelled');
        result.taskId = taskId;
        result.taskCancelled = true;
      } catch (err) {
        result.taskError = err.message;
      }
    }

    // 3. 终止匹配的子代理 session / Terminate matching subagent sessions
    if (relayClient?.listActiveSessions && relayClient?.endSession) {
      try {
        const listed = await relayClient.listActiveSessions();
        const sessions = Array.isArray(listed?.sessions) ? listed.sessions : [];
        const parentKey = relayClient._parentSessionKey || null;

        const candidates = sessions.filter((s) => {
          const key = typeof s?.key === 'string' ? s.key : '';
          if (!key.includes(':subagent:')) return false;

          if (parentKey && s?.spawnedBy && s.spawnedBy !== parentKey) return false;

          const meta = parseSwarmLabel(s?.label);
          if (!meta) return false;

          const taskMatch = taskId ? meta.taskId === taskId : false;
          const dagMatch = dagId ? meta.dagId === dagId : false;
          return taskMatch || dagMatch;
        });

        const endedSessions = [];
        const sessionEndErrors = [];

        for (const s of candidates) {
          const endResult = await relayClient.endSession(s.key, {
            deleteTranscript: false,
            emitLifecycleHooks: true,
          });

          if (endResult.status === 'ended') endedSessions.push(s.key);
          else sessionEndErrors.push({ sessionKey: s.key, error: endResult.error || 'end_failed' });
        }

        result.sessionsMatched = candidates.length;
        result.sessionsEnded = endedSessions.length;
        if (sessionEndErrors.length > 0) result.sessionEndErrors = sessionEndErrors;

        if (candidates.length > 0 && endedSessions.length === 0) {
          result.success = false;
          result.cancelled = false;
          result.error = '匹配到子代理会话但终止失败 / matched sessions but none terminated';
        }
      } catch (err) {
        result.sessionScanError = err.message;
        result.success = false;
        result.cancelled = false;
      }
    }

    return result;
  }

  // ━━━ 主处理函数 / Main Handler ━━━

  async function handler(input) {
    logger.info?.(`[SwarmRunTool] ▶ CALLED: goal="${(input.goal || '').substring(0, 80)}", mode=${input.mode || 'auto'}`);
    try {
      const mode = input.mode || 'auto';

      // ── 待批准计划拦截 / Pending Plan Approval Intercept ──
      // 当 plan_only 返回后用户输入短批示 ("批准"/"算了"), 在 designPlan 之前拦截
      // Intercept user approval/rejection before designPlan runs (avoids direct_reply misclassification)
      if (_pendingPlanId && mode === 'auto') {
        const goal = (input.goal || '').trim();
        if (APPROVAL_RE.test(goal)) {
          logger.info?.(`[SwarmRunTool] 用户批准待执行计划 / User approved pending plan: planId=${_pendingPlanId}`);
          const approvedPlanId = _pendingPlanId;
          _pendingPlanId = null;
          return await handleExecute({ planId: approvedPlanId, goal });
        }
        if (REJECTION_RE.test(goal)) {
          logger.info?.(`[SwarmRunTool] 用户拒绝待执行计划 / User rejected pending plan: planId=${_pendingPlanId}`);
          _pendingPlanId = null;
          return {
            success: false,
            mode: 'direct_reply',
            reason: '用户已取消计划，请告知用户计划已取消 / Plan cancelled by user',
            goal,
          };
        }
        // 用户输入了全新目标, 清除旧计划 / New unrelated goal — discard old pending plan
        logger.debug?.(`[SwarmRunTool] 清除待批准计划 (新目标输入) / Clearing pending plan (new goal): ${_pendingPlanId}`);
        _pendingPlanId = null;
      }

      // ── DB 人机检查点检测 / DB Human-in-the-loop Checkpoint Detection ──
      // 跨进程检查点 — 子代理执行中途通过 swarm_checkpoint 工具注册，写入共享 DB
      // Cross-process checkpoints registered by sub-agents via swarm_checkpoint, stored in shared DB
      if (engines.userCheckpointRepo && mode === 'auto') {
        try {
          const pending = engines.userCheckpointRepo.getPending();
          if (pending.length > 0) {
            const ckpt = pending[0];
            const goal = (input.goal || '').trim();
            engines.userCheckpointRepo.resolve(ckpt.id, goal);
            logger.info?.(`[SwarmRunTool] 用户检查点已解析 / Checkpoint resolved: ${ckpt.id}, answer="${goal}"`);

            // 有足够上下文时自动重新派遣 / Auto re-spawn if phase context available
            if (ckpt.phase_role && (ckpt.phase_desc || ckpt.original_goal)) {
              const answerSoul =
                `[用户决策 / User Decision]\n` +
                `问题: "${ckpt.question}"\n用户回复: "${goal}"\n` +
                `请基于以上决策继续执行: ${ckpt.phase_desc || ckpt.original_goal}`;
              try {
                const spawnRecord = spawnPhaseViaRelay({
                  phase: {
                    roleName: ckpt.phase_role,
                    description: ckpt.phase_desc || ckpt.question,
                    soulSnippet: answerSoul,
                  },
                  context: { goal: ckpt.original_goal || ckpt.question },
                  engines,
                  logger,
                });
                return {
                  success: true,
                  mode: 'checkpoint_resolved',
                  checkpointId: ckpt.id,
                  question: ckpt.question,
                  answer: goal,
                  respawned: true,
                  agentId: spawnRecord?.agentId,
                  message: `用户已确认"${goal}"，已重新派遣 ${ckpt.phase_role} 子代理继续执行。`,
                };
              } catch (spawnErr) {
                logger.warn?.(`[SwarmRunTool] 检查点重新派遣失败 / Re-spawn failed: ${spawnErr.message}`);
              }
            }

            return {
              success: true,
              mode: 'checkpoint_resolved',
              checkpointId: ckpt.id,
              question: ckpt.question,
              answer: goal,
              respawned: false,
              message: `已记录用户回复"${goal}"。如需继续任务请重新调用 swarm_run。`,
            };
          }
        } catch (ckptErr) {
          logger.warn?.(`[SwarmRunTool] 检查点查询失败 / Checkpoint query failed: ${ckptErr.message}`);
        }
      }

      switch (mode) {
        case 'auto':
          return await handleAuto(input);
        case 'plan_only':
          return await handlePlanOnly(input);
        case 'execute':
          return await handleExecute(input);
        case 'cancel':
          return await handleCancel(input);
        case 'resume':
          return await handleResume(input);
        default:
          return {
            success: false,
            error: `未知模式 / Unknown mode: ${mode}. 支持 / Supported: auto, plan_only, execute, cancel, resume`,
          };
      }
    } catch (err) {
      logger.error?.(`[SwarmRunTool] 未捕获错误 / Uncaught error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: inputSchema,
    handler,
    execute: async (toolCallId, params) => {
      const result = await handler(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  };
}
