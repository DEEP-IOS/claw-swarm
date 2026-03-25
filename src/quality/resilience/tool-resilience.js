/**
 * ToolResilience - 工具调用参数验证与自动重试管理
 * Tool call parameter validation and automatic retry management
 *
 * 提供轻量级 JSON Schema 验证（无外部依赖），当工具调用参数不合法时
 * 生成修复提示词引导 LLM 重新生成正确参数，同时通过指数退避控制重试节奏。
 *
 * @module quality/resilience/tool-resilience
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_ALARM } from '../../core/field/types.js'

// ============================================================================
// ToolResilience
// ============================================================================

export class ToolResilience extends ModuleBase {
  // --------------------------------------------------------------------------
  // Static declarations
  // --------------------------------------------------------------------------

  static produces() { return [DIM_ALARM] }
  static consumes() { return [] }
  static publishes() { return ['quality.tool.validation_failed', 'quality.tool.retry_injected'] }
  static subscribes() { return [] }

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  /**
   * @param {Object} opts
   * @param {import('../../core/field/signal-store.js').SignalStore} opts.field
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.bus
   * @param {Object} [opts.config={}]
   */
  constructor({ field, bus, config = {} }) {
    super()

    /** @private */ this._field = field
    /** @private */ this._bus = bus

    /** @private @type {Map<string, Function>} compiled validators keyed by tool name */
    this._validators = new Map()

    /** @private @type {Map<string, number>} retry counters keyed by toolName:toolCallId */
    this._retryCounters = new Map()

    /** @private */ this._maxRetries = config.maxRetries ?? 3

    /** @private @type {Map<string, Object>} raw schemas for hint generation */
    this._schemas = new Map()

    /** @private */
    this._stats = {
      validationFailures: 0,
      retryCount: 0,
      successAfterRetry: 0,
    }
  }

  // --------------------------------------------------------------------------
  // Schema Registration
  // --------------------------------------------------------------------------

  /**
   * Register tool definitions and compile lightweight validators
   * @param {Array<{name: string, parameters: Object}>} toolDefinitions
   */
  registerToolSchemas(toolDefinitions) {
    for (const def of toolDefinitions) {
      if (!def.name || !def.parameters) continue
      this._schemas.set(def.name, def.parameters)
      this._validators.set(def.name, this._compileValidator(def.parameters))
    }
  }

  // --------------------------------------------------------------------------
  // Validation & Repair
  // --------------------------------------------------------------------------

  /**
   * Validate parameters and generate repair prompt on failure
   * @param {string} toolName
   * @param {Object} params
   * @returns {{ valid: boolean, repairPrompt?: string, errors?: string }}
   */
  validateAndRepair(toolName, params) {
    const validator = this._validators.get(toolName)
    if (!validator) {
      return { valid: true }
    }

    const errors = validator(params)
    if (errors.length === 0) {
      // valid — clear any retry counter for this tool
      for (const [key] of this._retryCounters) {
        if (key.startsWith(toolName + ':')) {
          this._retryCounters.delete(key)
        }
      }
      return { valid: true }
    }

    // Validation failed
    this._stats.validationFailures++
    const errorMsg = errors.join('; ')
    const schemaHint = this._getSchemaHint(toolName)
    const repairPrompt =
      `Tool "${toolName}" received invalid parameters.\n` +
      `Errors: ${errorMsg}\n` +
      `Expected schema: ${schemaHint}\n` +
      `Please re-generate the tool call with corrected parameters.`

    // Emit alarm signal into the field
    this._field?.emit?.({
      dimension: DIM_ALARM,
      scope: toolName,
      strength: 0.5,
      emitterId: 'ToolResilience',
      metadata: { event: 'tool_validation_failed', errors: errorMsg },
    })

    // Publish bus event
    this._bus?.publish?.('quality.tool.validation_failed', {
      toolName,
      errors: errorMsg,
      timestamp: Date.now(),
    }, 'ToolResilience')

    return { valid: false, repairPrompt, errors: errorMsg }
  }

  // --------------------------------------------------------------------------
  // Retry Management
  // --------------------------------------------------------------------------

  /**
   * Determine whether a tool call should be retried
   * @param {string} toolCallId
   * @param {string} toolName
   * @returns {{ retry: boolean, delay?: number, attempt?: number, reason?: string }}
   */
  shouldRetry(toolCallId, toolName) {
    const key = toolName + ':' + toolCallId
    const current = (this._retryCounters.get(key) || 0) + 1
    this._retryCounters.set(key, current)
    this._stats.retryCount++

    if (current > this._maxRetries) {
      return { retry: false, reason: 'max retries exceeded' }
    }

    const delay = Math.min(1000 * Math.pow(2, current - 1), 8000)

    this._bus?.publish?.('quality.tool.retry_injected', {
      toolName,
      toolCallId,
      attempt: current,
      delay,
      timestamp: Date.now(),
    }, 'ToolResilience')

    return { retry: true, delay, attempt: current }
  }

  /**
   * Record a successful tool execution — resets retry counter
   * @param {string} toolName
   */
  recordSuccess(toolName) {
    let wasRetrying = false
    for (const [key] of this._retryCounters) {
      if (key.startsWith(toolName + ':')) {
        wasRetrying = true
        this._retryCounters.delete(key)
      }
    }
    if (wasRetrying) {
      this._stats.successAfterRetry++
    }
  }

  /**
   * Record a tool execution failure
   * @param {string} toolName
   * @param {Error|string} _error
   */
  recordFailure(toolName, _error) {
    this._stats.validationFailures++
  }

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  /**
   * Return a human-readable schema summary for a tool
   * @private
   * @param {string} toolName
   * @returns {string}
   */
  _getSchemaHint(toolName) {
    const schema = this._schemas.get(toolName)
    if (!schema) return '(no schema registered)'

    const parts = []
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        const required = (schema.required || []).includes(prop) ? ' (required)' : ''
        parts.push(`${prop}: ${propSchema.type || 'any'}${required}`)
      }
    }
    return `{ ${parts.join(', ')} }`
  }

  /**
   * Compile a lightweight JSON Schema validator function
   * Supports: required, type checking (string, number, boolean, object, array),
   * nested object properties
   * @private
   * @param {Object} schema
   * @returns {function(Object): string[]} returns array of error strings (empty = valid)
   */
  _compileValidator(schema) {
    return (params) => {
      const errors = []
      this._validateObject(params, schema, '', errors)
      return errors
    }
  }

  /**
   * Recursively validate an object against a schema
   * @private
   * @param {*} value
   * @param {Object} schema
   * @param {string} path - current property path for error messages
   * @param {string[]} errors - accumulator
   */
  _validateObject(value, schema, path, errors) {
    const displayPath = path || 'root'

    // Type check
    if (schema.type) {
      const actualType = this._getJsonType(value)
      if (schema.type !== actualType) {
        errors.push(`${displayPath}: expected type "${schema.type}" but got "${actualType}"`)
        return // no further checks if type is wrong
      }
    }

    // For object type, check required fields and nested properties
    if (schema.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Required fields
      if (Array.isArray(schema.required)) {
        for (const field of schema.required) {
          if (value[field] === undefined || value[field] === null) {
            errors.push(`${displayPath}.${field}: required field is missing`)
          }
        }
      }

      // Nested property validation
      if (schema.properties) {
        for (const [prop, propSchema] of Object.entries(schema.properties)) {
          if (value[prop] !== undefined) {
            this._validateObject(value[prop], propSchema, path ? `${path}.${prop}` : prop, errors)
          }
        }
      }
    }

    // For array type, validate items if items schema is present
    if (schema.type === 'array' && Array.isArray(value) && schema.items) {
      for (let i = 0; i < value.length; i++) {
        this._validateObject(value[i], schema.items, `${displayPath}[${i}]`, errors)
      }
    }
  }

  /**
   * Map a JS value to its JSON Schema type string
   * @private
   * @param {*} value
   * @returns {string}
   */
  _getJsonType(value) {
    if (value === null || value === undefined) return 'null'
    if (Array.isArray(value)) return 'array'
    const t = typeof value
    if (t === 'object') return 'object'
    if (t === 'string') return 'string'
    if (t === 'number') return 'number'
    if (t === 'boolean') return 'boolean'
    return 'unknown'
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  /**
   * Return current statistics
   * @returns {{ validationFailures: number, retryCount: number, successAfterRetry: number }}
   */
  getStats() {
    return { ...this._stats }
  }
}
