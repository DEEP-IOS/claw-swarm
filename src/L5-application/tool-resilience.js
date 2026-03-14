/**
 * Claw-Swarm V5.5 — 工具调用韧性增强层 / Tool Call Resilience Layer
 *
 * 针对 Kimi K2.5 约 12% 的 tool_call 失败率，提供多层韧性保护:
 * 1. 参数预校验（before_tool_call）— AJV JSON Schema 校验 + 自动修复
 * 2. 失败检测 + 下轮提示注入 — 利用 LLM 自纠错重试
 * 3. per-tool 断路器 — 复用 CircuitBreaker，每工具独立状态
 * 4. 降级策略 — 文本意图解析 fallback
 * 5. 自适应修复记忆 — 历史策略查询 + 修复结果沉淀 [V5.5]
 *
 * Addresses Kimi K2.5's ~12% tool_call failure rate with multi-layer resilience:
 * 1. Parameter pre-validation (before_tool_call) — AJV JSON Schema + auto-fix
 * 2. Failure detection + next-turn prompt injection — leverage LLM self-correction
 * 3. Per-tool circuit breaker — reuse CircuitBreaker, per-tool independent state
 * 4. Degradation strategy — text intent parsing fallback
 * 5. Adaptive repair memory — historical strategy query + outcome persistence [V5.5]
 *
 * @module L5-application/tool-resilience
 * @version 5.5.0
 */

import Ajv from 'ajv';
import { CircuitBreaker } from './circuit-breaker.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 失败工具调用 Map TTL (ms) / Failed tool calls Map TTL */
const FAILED_CALLS_TTL_MS = 60000;

/** 失败工具调用 Map 上限 / Failed tool calls Map max size */
const FAILED_CALLS_MAX = 100;

/** 最大重试提示轮数 / Max retry prompt rounds */
const MAX_RETRY_ROUNDS = 3;

/** 断路器默认配置 / Circuit breaker defaults */
const CB_DEFAULTS = {
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeoutMs: 30000,
};

// ============================================================================
// ToolResilience
// ============================================================================

export class ToolResilience {
  /**
   * @param {Object} options
   * @param {Object} options.logger
   * @param {Object} [options.config] - 韧性配置 / Resilience config
   * @param {Object} [options.messageBus] - MessageBus 实例
   */
  constructor({ logger, config = {}, messageBus, db }) {
    this._logger = logger;
    this._config = config;
    this._messageBus = messageBus;
    /** @type {Object|null} V5.2: SQLite DB for repair memory queries */
    this._db = db || null;

    // ── AJV 懒编译缓存 / AJV lazy compilation cache ──
    this._ajv = new Ajv({
      allErrors: true,
      coerceTypes: true,       // 自动类型强转 / Auto type coercion
      useDefaults: true,       // 自动填充默认值 / Auto-fill defaults
      removeAdditional: false,
    });

    /** @type {Map<string, import('ajv').ValidateFunction>} */
    this._schemaCache = new Map();

    // ── 失败工具调用缓冲区 / Failed tool calls buffer ──
    /** @type {Map<string, { toolName: string, params: Object, error: string, retryCount: number, timestamp: number }>} */
    this._failedToolCalls = new Map();

    // ── Per-tool 断路器 / Per-tool circuit breakers ──
    /** @type {Map<string, CircuitBreaker>} */
    this._circuitBreakers = new Map();

    // ── 每工具修复统计 / Per-tool coercion stats ──
    /** @type {Map<string, { total: number, coerced: number }>} */
    this._coercionStats = new Map();

    /** @type {import('../L3-agent/failure-mode-analyzer.js').FailureModeAnalyzer|null} V6.0 */
    this._failureModeAnalyzer = null;
  }

  /**
   * V6.0: 注入失败模式分析器 / Inject failure mode analyzer
   * @param {import('../L3-agent/failure-mode-analyzer.js').FailureModeAnalyzer} fma
   */
  setFailureModeAnalyzer(fma) {
    this._failureModeAnalyzer = fma;
  }

  // ============================================================================
  // before_tool_call handler
  // ============================================================================

  /**
   * before_tool_call hook handler
   * 预校验参数 + 断路器检查
   *
   * @param {Object} event - OpenClaw hook event
   * @param {string} event.toolName - 工具名
   * @param {Object} event.params - 工具参数
   * @param {string} [event.toolCallId] - SDK 原生 tool call ID
   * @param {Object} [event.inputSchema] - 工具的 JSON Schema
   * @returns {Object|undefined} 修改后的参数或 block 指令
   */
  handleBeforeToolCall(event) {
    const { toolName, params, toolCallId, inputSchema } = event;

    // 1. 断路器检查 / Circuit breaker check
    const cb = this._getOrCreateBreaker(toolName);
    if (cb.getState() === 'OPEN') {
      const resetMs = cb._resetTimeoutMs || CB_DEFAULTS.resetTimeoutMs;
      this._logger.warn?.(
        `[ToolResilience] Circuit breaker OPEN for ${toolName}, blocking call`
      );
      return {
        block: true,
        blockReason: `[CircuitBreaker] tool ${toolName} is OPEN, retry in ${Math.ceil(resetMs / 1000)}s`,
      };
    }

    // 2. JSON Schema 预校验 + 自动修复 / JSON Schema pre-validation + auto-fix
    if (inputSchema && params && typeof params === 'object') {
      try {
        const validate = this._getOrCompileSchema(toolName, inputSchema);
        if (validate) {
          // 深拷贝参数进行校验（AJV coerceTypes 会修改原对象）
          // Deep copy params for validation (AJV coerceTypes modifies in-place)
          const fixedParams = JSON.parse(JSON.stringify(params));
          const valid = validate(fixedParams);

          // 更新修复统计 / Update coercion stats
          const stats = this._coercionStats.get(toolName) || { total: 0, coerced: 0 };
          stats.total++;

          if (!valid) {
            // 参数校验失败但类型强转可能已修复部分问题
            // Validation failed but type coercion may have fixed some issues
            stats.coerced++;
            this._logger.warn?.(
              `[ToolResilience] Schema validation issues for ${toolName}: ` +
              `${validate.errors?.map(e => `${e.instancePath} ${e.message}`).join('; ')}`
            );
          }

          // 检测是否有参数被修复（比较前后差异）
          const wasCoerced = JSON.stringify(params) !== JSON.stringify(fixedParams);
          if (wasCoerced) {
            stats.coerced++;
            this._logger.warn?.(
              `[ToolResilience] Auto-coerced params for ${toolName}`
            );
          }

          this._coercionStats.set(toolName, stats);

          // 修复率过高时发布警告事件 / Publish warning when coercion rate too high
          if (stats.total >= 10 && (stats.coerced / stats.total) > 0.5) {
            this._messageBus?.publish?.('tool.coercion.excessive', {
              toolName,
              total: stats.total,
              coerced: stats.coerced,
              rate: (stats.coerced / stats.total).toFixed(2),
            });
          }

          // 返回修复后的参数 / Return fixed params
          if (wasCoerced || !valid) {
            return { params: fixedParams };
          }
        }
      } catch (err) {
        this._logger.warn?.(
          `[ToolResilience] Schema validation error for ${toolName}: ${err.message}`
        );
      }
    }

    return undefined; // 不修改 / No modification
  }

  // ============================================================================
  // after_tool_call handler
  // ============================================================================

  /**
   * after_tool_call hook handler
   * 检测失败并记录到缓冲区
   *
   * @param {Object} event
   * @param {string} event.toolName
   * @param {Object} [event.params]
   * @param {boolean} event.success - 是否成功
   * @param {string} [event.error] - 错误信息
   * @param {string} [event.toolCallId]
   * @param {number} [event.durationMs] - 执行耗时
   */
  handleAfterToolCall(event) {
    const { toolName, params, success, error, toolCallId, durationMs } = event;
    const cb = this._getOrCreateBreaker(toolName);

    if (success) {
      // 成功：记录到断路器 / Success: record to circuit breaker
      cb.recordSuccess();
      this._logger.debug?.(`[ToolResilience] ${toolName} OK (${durationMs ?? '?'}ms)`);

      // V5.5+V6.0: 如果之前有修复策略被使用，记录成功结果 (含 errorCategory)
      // V5.5+V6.0: If a repair strategy was previously used, record successful outcome (with errorCategory)
      const pendingRepair = this._pendingRepairs?.get(toolName);
      if (pendingRepair) {
        this.recordRepairOutcome(toolName, pendingRepair.errorSignature, pendingRepair.strategy, true, pendingRepair.errorCategory);
        this._pendingRepairs.delete(toolName);
        this._messageBus?.publish?.('repair.strategy.outcome', {
          toolName,
          errorSignature: pendingRepair.errorSignature,
          strategy: pendingRepair.strategy,
          success: true,
          errorCategory: pendingRepair.errorCategory,
        });
      }
      return;
    }

    // 失败：记录到断路器 + 缓冲区
    // Failure: record to circuit breaker + buffer
    cb.recordFailure();

    // V6.0: 失败根因分类 / Failure root cause classification
    const errorMsg = error || 'unknown error';
    let errorCategory = null;
    if (this._failureModeAnalyzer) {
      const classification = this._failureModeAnalyzer.classify(errorMsg, { toolName });
      errorCategory = classification.category;
    }

    // V5.5+V6.0: 查询修复记忆 (优先按 error_category 精确匹配)
    // V5.5+V6.0: Query repair memory (prefer exact error_category match)
    const repairResult = this.findRepairStrategy(toolName, errorMsg, errorCategory);
    let repairHint = null;
    if (repairResult) {
      repairHint = repairResult.strategy;
      // 记录待验证的修复策略 / Track pending repair for outcome validation
      if (!this._pendingRepairs) this._pendingRepairs = new Map();
      this._pendingRepairs.set(toolName, {
        errorSignature: errorMsg.substring(0, 200),
        strategy: repairResult.strategy,
        errorCategory,
        timestamp: Date.now(),
      });
      this._messageBus?.publish?.('repair.strategy.found', {
        toolName,
        errorSignature: errorMsg.substring(0, 200),
        strategy: repairResult.strategy,
        confidence: repairResult.confidence,
        errorCategory,
      });
    }

    // 生成幂等性 key / Generate idempotency key
    const idempotencyKey = toolCallId || this._hashToolCall(toolName, params);

    // 检查是否已在缓冲区（防止 LLM 自重试 + 提示注入重试重复）
    // Check if already in buffer (prevent duplicate from LLM retry + prompt injection retry)
    if (this._failedToolCalls.has(idempotencyKey)) {
      const existing = this._failedToolCalls.get(idempotencyKey);
      existing.retryCount++;
      existing.error = errorMsg;
      existing.timestamp = Date.now();
      if (repairHint) existing.repairHint = repairHint;
      return;
    }

    // 清理过期+超量条目 / Clean expired + overflow entries
    this._cleanupFailedCalls();

    // 记录失败 / Record failure
    this._failedToolCalls.set(idempotencyKey, {
      toolName,
      params: params || {},
      error: errorMsg,
      retryCount: 0,
      timestamp: Date.now(),
      repairHint, // V5.5: 附加修复建议 / Attach repair hint
    });

    this._logger.warn?.(
      `[ToolResilience] ${toolName} FAILED: ${errorMsg} ` +
      `(breaker state: ${cb.getState()})` +
      (repairHint ? ` [repair hint available]` : '')
    );
  }

  // ============================================================================
  // before_prompt_build handler — 失败提示注入
  // ============================================================================

  /**
   * before_prompt_build hook handler
   * 将失败信息注入下一轮 prompt，让 LLM 自然地重试
   *
   * @returns {string|undefined} 要注入的上下文文本
   */
  getFailureContext() {
    if (this._failedToolCalls.size === 0) return undefined;

    const parts = [];
    const toRemove = [];

    for (const [key, call] of this._failedToolCalls) {
      if (call.retryCount >= MAX_RETRY_ROUNDS) {
        // 重试耗尽，标记清除 + 记录失败修复结果
        // Retry exhausted, mark for removal + record failed repair outcome
        toRemove.push(key);
        // V5.5: 修复策略失败时记录 / Record when repair strategy failed
        if (call.repairHint && this._pendingRepairs?.has(call.toolName)) {
          const pending = this._pendingRepairs.get(call.toolName);
          this.recordRepairOutcome(call.toolName, pending.errorSignature, pending.strategy, false);
          this._pendingRepairs.delete(call.toolName);
          this._messageBus?.publish?.('repair.strategy.outcome', {
            toolName: call.toolName,
            errorSignature: pending.errorSignature,
            strategy: pending.strategy,
            success: false,
          });
        }
        continue;
      }

      // V5.5: 如果有修复建议，包含在提示注入中
      // V5.5: If repair hint available, include in prompt injection
      let msg = `[TOOL_RETRY] 上次 ${call.toolName} 调用失败 (原因: ${call.error})。`;
      if (call.repairHint) {
        msg += `历史修复建议: ${call.repairHint}。`;
      }
      msg += `建议修正参数后重试。(重试 ${call.retryCount + 1}/${MAX_RETRY_ROUNDS})`;
      parts.push(msg);
    }

    // 清除已耗尽的条目 / Remove exhausted entries
    for (const key of toRemove) {
      this._failedToolCalls.delete(key);
    }

    if (parts.length === 0) return undefined;

    // 硬限制 ≤ 150 tokens（约 300 个中文字符）— V5.5 增加限制以容纳修复建议
    // Hard limit ≤ 150 tokens (~300 Chinese characters) — V5.5 increased for repair hints
    const text = parts.join('\n');
    return text.length > 600 ? text.substring(0, 600) + '...' : text;
  }

  // ============================================================================
  // 断路器管理 / Circuit Breaker Management
  // ============================================================================

  /**
   * 获取或创建 per-tool 断路器
   * Get or create per-tool circuit breaker
   *
   * @param {string} toolName
   * @returns {CircuitBreaker}
   * @private
   */
  _getOrCreateBreaker(toolName) {
    if (!this._circuitBreakers.has(toolName)) {
      const cb = new CircuitBreaker({
        failureThreshold: this._config.breakerFailureThreshold || CB_DEFAULTS.failureThreshold,
        successThreshold: this._config.breakerSuccessThreshold || CB_DEFAULTS.successThreshold,
        resetTimeoutMs: this._config.breakerResetTimeoutMs || CB_DEFAULTS.resetTimeoutMs,
        logger: this._logger,
        messageBus: this._messageBus,
      });
      this._circuitBreakers.set(toolName, cb);
    }
    return this._circuitBreakers.get(toolName);
  }

  /**
   * 获取所有断路器状态摘要
   * Get all circuit breaker state summary
   *
   * @returns {Object<string, string>}
   */
  getCircuitBreakerStates() {
    const states = {};
    for (const [name, cb] of this._circuitBreakers) {
      states[name] = cb.getState();
    }
    return states;
  }

  // ============================================================================
  // Schema 缓存 / Schema Cache
  // ============================================================================

  /**
   * 获取或编译 JSON Schema 校验函数
   * Get or compile JSON Schema validation function
   *
   * @param {string} toolName
   * @param {Object} schema
   * @returns {import('ajv').ValidateFunction|null}
   * @private
   */
  _getOrCompileSchema(toolName, schema) {
    if (this._schemaCache.has(toolName)) {
      return this._schemaCache.get(toolName);
    }

    try {
      const validate = this._ajv.compile(schema);
      this._schemaCache.set(toolName, validate);
      return validate;
    } catch (err) {
      this._logger.warn?.(
        `[ToolResilience] Failed to compile schema for ${toolName}: ${err.message}`
      );
      this._schemaCache.set(toolName, null); // 缓存失败，不反复尝试
      return null;
    }
  }

  // ============================================================================
  // 内部辅助 / Internal Helpers
  // ============================================================================

  /**
   * 生成工具调用哈希（fallback 幂等性 key）
   * Generate tool call hash (fallback idempotency key)
   *
   * @param {string} toolName
   * @param {Object} params
   * @returns {string}
   * @private
   */
  _hashToolCall(toolName, params) {
    try {
      // 排序 key 的 JSON.stringify 保证一致性
      // Sorted-key JSON.stringify for consistency
      const canonical = JSON.stringify(params, Object.keys(params || {}).sort());
      return `${toolName}:${canonical}`;
    } catch {
      return `${toolName}:${Date.now()}`;
    }
  }

  /**
   * 清理过期和超量的失败调用记录
   * Clean up expired and overflow failed call records
   * @private
   */
  _cleanupFailedCalls() {
    const now = Date.now();

    // 清理过期（TTL=60s）/ Clean expired (TTL=60s)
    for (const [key, call] of this._failedToolCalls) {
      if (now - call.timestamp > FAILED_CALLS_TTL_MS) {
        this._failedToolCalls.delete(key);
      }
    }

    // 如果仍然超量，删除最旧的 / If still over limit, remove oldest
    while (this._failedToolCalls.size >= FAILED_CALLS_MAX) {
      const firstKey = this._failedToolCalls.keys().next().value;
      this._failedToolCalls.delete(firstKey);
    }
  }

  // ============================================================================
  // V5.5: 自适应修复记忆 / Adaptive Repair Memory (activated)
  // ============================================================================

  /**
   * 查询修复记忆寻找匹配的修复策略
   * Query repair memory for matching repair strategies
   *
   * 当工具调用失败时，先查 repair_memory 表寻找历史成功修复策略，
   * 找到则返回修复建议，否则返回 null。
   *
   * DB schema: error_signature TEXT, tool_name TEXT, strategy TEXT,
   *            affinity REAL, hit_count INTEGER, last_hit_at INTEGER
   *
   * @param {string} toolName - 失败的工具名
   * @param {string} errorSignature - 错误信息签名
   * @param {string} [errorCategory] - V6.0: 失败根因分类 / Failure root cause category
   * @returns {{ strategy: string, confidence: number } | null}
   */
  findRepairStrategy(toolName, errorSignature, errorCategory) {
    if (!this._db) return null;

    try {
      // V6.0: 优先按 (tool_name, error_type) 精确匹配 / Prefer exact (tool_name, error_type) match
      let rows = null;
      if (errorCategory) {
        rows = this._db.all(
          `SELECT strategy, affinity, hit_count
           FROM repair_memory
           WHERE tool_name = ? AND error_type = ?
           ORDER BY affinity DESC LIMIT 3`,
          toolName, errorCategory
        );
      }

      // 无分类结果或无匹配 → 降级到签名模糊匹配 / Fallback to signature fuzzy match
      if (!rows || rows.length === 0) {
        rows = this._db.all(
          `SELECT strategy, affinity, hit_count
           FROM repair_memory
           WHERE tool_name = ? AND error_signature LIKE ?
           ORDER BY affinity DESC LIMIT 3`,
          toolName, `%${errorSignature.substring(0, 50)}%`
        );
      }

      if (!rows || rows.length === 0) return null;

      const best = rows[0];
      if (best.affinity < 0.3) return null; // 信心不足 / Insufficient confidence

      this._logger.info?.(
        `[ToolResilience] Repair strategy found for ${toolName}: ` +
        `affinity=${best.affinity.toFixed(2)}, hits=${best.hit_count}`
      );

      return { strategy: best.strategy, confidence: best.affinity };
    } catch (err) {
      this._logger.debug?.(`[ToolResilience] Repair memory query failed: ${err.message}`);
      return null;
    }
  }

  /**
   * 记录修复策略结果（成功或失败）
   * Record repair strategy outcome (success or failure)
   *
   * 使用 EMA (指数移动平均) 更新 affinity:
   *   new_aff = 0.8 * old_aff + 0.2 * (success ? 1 : 0)
   *
   * @param {string} toolName
   * @param {string} errorSignature - 错误签名
   * @param {string} strategy - 修复策略描述
   * @param {boolean} success - 修复是否成功
   * @param {string} [errorCategory] - V6.0: 失败根因分类 / Failure root cause category
   */
  recordRepairOutcome(toolName, errorSignature, strategy, success, errorCategory) {
    if (!this._db) return;

    try {
      const existing = this._db.get(
        'SELECT id, affinity, hit_count FROM repair_memory WHERE tool_name = ? AND error_signature = ? AND strategy = ?',
        toolName, errorSignature.substring(0, 200), strategy
      );

      if (existing) {
        // EMA 更新 affinity / EMA update affinity
        const newAffinity = 0.8 * existing.affinity + 0.2 * (success ? 1 : 0);
        // V6.0: 同时更新 error_type (如果有分类) / Also update error_type if classified
        if (errorCategory) {
          this._db.run(
            `UPDATE repair_memory SET
              affinity = ?,
              hit_count = hit_count + 1,
              last_hit_at = ?,
              error_type = ?
            WHERE id = ?`,
            newAffinity, Date.now(), errorCategory, existing.id
          );
        } else {
          this._db.run(
            `UPDATE repair_memory SET
              affinity = ?,
              hit_count = hit_count + 1,
              last_hit_at = ?
            WHERE id = ?`,
            newAffinity, Date.now(), existing.id
          );
        }
      } else {
        // 新策略：成功初始 affinity=0.6, 失败初始=0.3
        // New strategy: success initial affinity=0.6, failure=0.3
        this._db.run(
          `INSERT INTO repair_memory (error_signature, tool_name, strategy, affinity, hit_count, last_hit_at, error_type)
          VALUES (?, ?, ?, ?, 1, ?, ?)`,
          errorSignature.substring(0, 200), toolName, strategy, success ? 0.6 : 0.3, Date.now(),
          errorCategory || null
        );
      }
    } catch (err) {
      this._logger.debug?.(`[ToolResilience] Repair memory write failed: ${err.message}`);
    }
  }
}
