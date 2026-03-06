/**
 * @fileoverview Claw-Swarm v4.0 - Layer 1 Core Error Hierarchy
 * @module layer1-core/errors
 * @author DEEP-IOS
 *
 * 功能概述 / Function Overview:
 * ─────────────────────────────
 * 本模块定义 Claw-Swarm v4.0 核心层（Layer 1）的完整错误类层级结构。
 * This module defines the complete error class hierarchy for the Claw-Swarm v4.0 core layer (Layer 1).
 *
 * 包含内容 / Contents:
 *   - 从 Swarm Lite v3.0 移植的 10 个错误类
 *     10 error classes ported from Swarm Lite v3.0
 *   - v4.0 新增的 1 个错误类 (PheromoneError)
 *     1 new error class added in v4.0 (PheromoneError)
 *
 * 错误层级 / Error Hierarchy:
 *   SwarmError (base / 基类)
 *   ├── SwarmValidationError
 *   ├── SwarmTimeoutError
 *   ├── SwarmConflictError
 *   ├── SwarmDBError
 *   ├── SwarmTopologyError
 *   ├── CircuitOpenError
 *   ├── LockLostError
 *   ├── GovernanceError
 *   ├── VotingError
 *   └── PheromoneError (v4.0 新增 / new in v4.0)
 */

// ============================================================================
// 基础错误类 / Base Error Class
// ============================================================================

/**
 * Swarm 基础错误 / Swarm base error
 * 所有 Swarm 错误的根基类，提供统一的错误编码和上下文机制。
 * Root base class for all Swarm errors, providing a unified error code and context mechanism.
 */
export class SwarmError extends Error {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {string} [code='SWARM_ERROR'] - 错误编码 / Error code
   * @param {Object} [context={}] - 附加上下文信息 / Additional context information
   */
  constructor(message, code = 'SWARM_ERROR', context = {}) {
    super(message);
    /** @type {string} 错误名称 / Error name */
    this.name = 'SwarmError';
    /** @type {string} 错误编码 / Error code */
    this.code = code;
    /** @type {Object} 上下文信息 / Context information */
    this.context = context;
    /** @type {string} 错误发生时间 / Timestamp when the error occurred */
    this.timestamp = new Date().toISOString();

    // 确保原型链正确 / Ensure correct prototype chain
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * 将错误序列化为 JSON 格式 / Serialize the error to JSON format
   * @returns {Object} 可序列化的错误对象 / Serializable error object
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

// ============================================================================
// 从 Swarm Lite v3.0 移植的错误类
// Error Classes Ported from Swarm Lite v3.0
// ============================================================================

/**
 * 验证错误 / Validation error
 * 在输入验证或参数校验失败时抛出。
 * Thrown when input validation or parameter checks fail.
 */
export class SwarmValidationError extends SwarmError {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {Object} [context={}] - 附加上下文 / Additional context
   */
  constructor(message, context = {}) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'SwarmValidationError';
  }
}

/**
 * 超时错误 / Timeout error
 * 在操作超过允许的时间限制时抛出。
 * Thrown when an operation exceeds the allowed time limit.
 */
export class SwarmTimeoutError extends SwarmError {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {number} timeoutMs - 超时时间（毫秒）/ Timeout duration in milliseconds
   * @param {Object} [context={}] - 附加上下文 / Additional context
   */
  constructor(message, timeoutMs, context = {}) {
    super(message, 'TIMEOUT_ERROR', context);
    this.name = 'SwarmTimeoutError';
    /** @type {number} 超时时间（毫秒）/ Timeout duration in milliseconds */
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 冲突错误 / Conflict error
 * 在资源竞争或状态冲突时抛出。
 * Thrown when resource contention or state conflicts occur.
 */
export class SwarmConflictError extends SwarmError {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {string} resource - 冲突的资源标识 / Conflicting resource identifier
   * @param {Object} [context={}] - 附加上下文 / Additional context
   */
  constructor(message, resource, context = {}) {
    super(message, 'CONFLICT_ERROR', context);
    this.name = 'SwarmConflictError';
    /** @type {string} 冲突的资源标识 / Conflicting resource identifier */
    this.resource = resource;
  }
}

/**
 * 数据库错误 / Database error
 * 在数据库操作失败时抛出。
 * Thrown when a database operation fails.
 */
export class SwarmDBError extends SwarmError {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {string} operation - 失败的数据库操作 / Failed database operation
   * @param {Object} [context={}] - 附加上下文 / Additional context
   */
  constructor(message, operation, context = {}) {
    super(message, 'DB_ERROR', context);
    this.name = 'SwarmDBError';
    /** @type {string} 失败的数据库操作 / Failed database operation */
    this.operation = operation;
  }
}

/**
 * 拓扑错误 / Topology error
 * 在任务依赖图中检测到循环或非法拓扑时抛出。
 * Thrown when a cycle or illegal topology is detected in the task dependency graph.
 */
export class SwarmTopologyError extends SwarmError {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {Array<string>} cycle - 形成循环的节点路径 / Node path forming the cycle
   * @param {Object} [context={}] - 附加上下文 / Additional context
   */
  constructor(message, cycle, context = {}) {
    super(message, 'TOPOLOGY_ERROR', context);
    this.name = 'SwarmTopologyError';
    /** @type {Array<string>} 循环路径 / Cycle path */
    this.cycle = cycle;
  }
}

/**
 * 熔断器开启错误 / Circuit open error
 * 当熔断器处于开启状态、拒绝请求时抛出。
 * Thrown when the circuit breaker is in the open state and rejecting requests.
 */
export class CircuitOpenError extends SwarmError {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {number} retryAfterMs - 建议的重试等待时间（毫秒）/ Suggested retry wait time in milliseconds
   * @param {Object} [context={}] - 附加上下文 / Additional context
   */
  constructor(message, retryAfterMs, context = {}) {
    super(message, 'CIRCUIT_OPEN', context);
    this.name = 'CircuitOpenError';
    /** @type {number} 建议重试等待时间（毫秒）/ Suggested retry wait time in milliseconds */
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * 锁丢失错误 / Lock lost error
 * 当分布式锁在操作过程中丢失时抛出。
 * Thrown when a distributed lock is lost during an operation.
 */
export class LockLostError extends SwarmError {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {string} resource - 锁定的资源标识 / Locked resource identifier
   * @param {string} owner - 原锁持有者 / Original lock owner
   * @param {Object} [context={}] - 附加上下文 / Additional context
   */
  constructor(message, resource, owner, context = {}) {
    super(message, 'LOCK_LOST', context);
    this.name = 'LockLostError';
    /** @type {string} 锁定的资源标识 / Locked resource identifier */
    this.resource = resource;
    /** @type {string} 原锁持有者 / Original lock owner */
    this.owner = owner;
  }
}

/**
 * 治理错误 / Governance error
 * 在治理操作（如层级变更、权限检查）失败时抛出。
 * Thrown when governance operations (e.g., tier changes, permission checks) fail.
 */
export class GovernanceError extends SwarmError {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {string} agentId - 相关代理 ID / Related agent ID
   * @param {Object} [context={}] - 附加上下文 / Additional context
   */
  constructor(message, agentId, context = {}) {
    super(message, 'GOVERNANCE_ERROR', context);
    this.name = 'GovernanceError';
    /** @type {string} 相关代理 ID / Related agent ID */
    this.agentId = agentId;
  }
}

/**
 * 投票错误 / Voting error
 * 在投票操作失败时抛出（如重复投票、无效投票等）。
 * Thrown when voting operations fail (e.g., duplicate vote, invalid vote, etc.).
 */
export class VotingError extends SwarmError {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {string} voteId - 相关投票 ID / Related vote ID
   * @param {Object} [context={}] - 附加上下文 / Additional context
   */
  constructor(message, voteId, context = {}) {
    super(message, 'VOTING_ERROR', context);
    this.name = 'VotingError';
    /** @type {string} 相关投票 ID / Related vote ID */
    this.voteId = voteId;
  }
}

// ============================================================================
// v4.0 新增错误类
// New Error Classes in v4.0
// ============================================================================

/**
 * 信息素错误 / Pheromone error
 * 在信息素系统操作失败时抛出（如信号发送失败、信号衰减异常等）。
 * Thrown when pheromone system operations fail (e.g., signal emission failure, abnormal signal decay, etc.).
 */
export class PheromoneError extends SwarmError {
  /**
   * @param {string} message - 错误消息 / Error message
   * @param {string} pheromoneType - 相关的信息素类型 / Related pheromone type (see PheromoneType)
   * @param {Object} [context={}] - 附加上下文 / Additional context
   */
  constructor(message, pheromoneType, context = {}) {
    super(message, 'PHEROMONE_ERROR', context);
    this.name = 'PheromoneError';
    /** @type {string} 相关的信息素类型 / Related pheromone type */
    this.pheromoneType = pheromoneType;
  }
}
