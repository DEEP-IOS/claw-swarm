/**
 * ComplianceMonitor - Monitors LLM output for policy violations
 *
 * Runs a set of regex-based violation rules against agent output text.
 * Tracks violation counts per session with an escalation model: repeated
 * violations increase the severity of injected warnings. Emits alarm
 * signals and publishes bus events on each violation.
 *
 * @module quality/analysis/compliance-monitor
 * @version 9.0.0
 */
import { ModuleBase } from '../../core/module-base.js';
import { DIM_ALARM, DIM_TRAIL } from '../../core/field/types.js';

// ─── Path Extraction Helper ──────────────────────────────────────────

/**
 * Extract file paths from LLM output text.
 * Matches common Unix and Windows path patterns.
 * @param {string} output
 * @returns {string[]}
 */
function _extractEditedPaths(output) {
  if (!output) return [];
  const pathPattern = /(?:[A-Za-z]:[/\\]|\/)[^\s'"`,;:*?<>|(){}[\]]+/g;
  const matches = output.match(pathPattern);
  return matches ? [...new Set(matches)] : [];
}

// ─── Violation Rule Definitions ──────────────────────────────────────

const VIOLATION_RULES = [
  {
    id: 'unsafe_operation',
    check: (output) => /rm\s+-rf|format\s+[cCdD]:|deltree/i.test(output),
    severity: 'critical',
    message: 'Unsafe operation command detected',
  },
  {
    id: 'unauthorized_file_access',
    check: (output) => /\/etc\/passwd|\.env|credentials|secret/i.test(output),
    severity: 'high',
    message: 'Sensitive file access detected',
  },
  {
    id: 'sensitive_data_exposure',
    check: (output) => /api[_-]?key|password\s*[:=]|token\s*[:=]/i.test(output),
    severity: 'high',
    message: 'Sensitive data exposure detected',
  },
  {
    id: 'scope_violation',
    check: (output, context) => {
      if (!context?.allowedPaths) return false;
      const paths = _extractEditedPaths(output);
      return paths.some(p => !context.allowedPaths.some(ap => p.startsWith(ap)));
    },
    severity: 'medium',
    message: 'Out-of-scope file modification detected',
  },
];

// ─── ComplianceMonitor ───────────────────────────────────────────────

export class ComplianceMonitor extends ModuleBase {
  static produces()   { return [DIM_ALARM]; }
  static consumes()   { return [DIM_TRAIL]; }
  static publishes()  { return ['quality.compliance.violation']; }
  static subscribes() { return []; }

  /**
   * @param {Object} deps
   * @param {Object} deps.field  - Signal field instance
   * @param {Object} deps.bus    - EventBus instance
   * @param {Object} [deps.config]
   */
  constructor({ field, bus, config = {} }) {
    super({ field, bus, config });
    this._violationCounters = new Map();
    this._stats = {
      totalViolations: 0,
      escalationDistribution: { 1: 0, 2: 0, 3: 0 },
    };
  }

  // ─── Core Compliance Check ───────────────────────────────────────

  /**
   * Check LLM output against all violation rules.
   *
   * @param {string} sessionId - Session or agent identifier
   * @param {string} llmOutput - Raw text output from the LLM
   * @param {Object} [context={}] - Additional context (e.g. { allowedPaths })
   * @returns {{ compliant: boolean, violations: Object[], escalationLevel: number }}
   */
  check(sessionId, llmOutput, context = {}) {
    const violations = [];

    for (const rule of VIOLATION_RULES) {
      if (rule.check(llmOutput, context)) {
        violations.push({
          id: rule.id,
          severity: rule.severity,
          message: rule.message,
        });
      }
    }

    if (violations.length === 0) {
      return { compliant: true, violations: [], escalationLevel: 0 };
    }

    // Increment violation counter for this session
    const prevCount = this._violationCounters.get(sessionId) || 0;
    const newCount = prevCount + 1;
    this._violationCounters.set(sessionId, newCount);

    const escalationLevel = Math.min(newCount, 3);

    // Signal field emission
    const strength = Math.min(0.3 + escalationLevel * 0.2, 1.0);
    this.field?.emit({
      dimension: DIM_ALARM,
      scope: sessionId,
      strength,
      emitterId: this.constructor.name,
      metadata: {
        event: 'compliance_violation',
        violations: violations.map(v => v.id),
        escalationLevel,
      },
    });

    // Bus publish
    this.bus?.publish(
      'quality.compliance.violation',
      { sessionId, violations, escalationLevel, totalViolations: newCount },
      this.constructor.name,
    );

    // Update stats
    this._stats.totalViolations++;
    if (escalationLevel >= 1 && escalationLevel <= 3) {
      this._stats.escalationDistribution[escalationLevel]++;
    }

    return { compliant: false, violations, escalationLevel };
  }

  // ─── Escalation Prompts ──────────────────────────────────────────

  /**
   * Get the escalation warning prompt for a session based on its violation count.
   *
   * @param {string} sessionId
   * @returns {string|null} Warning text to prepend to agent instructions, or null if clean
   */
  getEscalationPrompt(sessionId) {
    const count = this._violationCounters.get(sessionId) || 0;

    if (count === 0) return null;

    if (count === 1) {
      return 'Warning: Previous operation triggered compliance alert. Avoid sensitive files and dangerous commands.';
    }

    if (count === 2) {
      return 'Severe warning: 2 compliance violations occurred. Another violation will terminate the task. Operate strictly within scope.';
    }

    // count >= 3
    return 'Final warning: 3 compliance violations. Stop current operation immediately. Only complete safe, authorized steps.';
  }

  // ─── Session Management ──────────────────────────────────────────

  /**
   * Reset violation counter for a session.
   * @param {string} sessionId
   */
  resetSession(sessionId) {
    this._violationCounters.delete(sessionId);
  }

  /**
   * Get the violation count for a session.
   * @param {string} sessionId
   * @returns {number}
   */
  getViolationHistory(sessionId) {
    return this._violationCounters.get(sessionId) || 0;
  }

  // ─── Internal Helpers ────────────────────────────────────────────

  /**
   * Extract file paths from output text (delegates to module-level helper).
   * @param {string} output
   * @returns {string[]}
   */
  _extractEditedPaths(output) {
    return _extractEditedPaths(output);
  }

  // ─── Stats ───────────────────────────────────────────────────────

  /**
   * Return aggregate compliance monitoring statistics.
   * @returns {{ totalViolations: number, escalationDistribution: Object }}
   */
  getStats() {
    return {
      totalViolations: this._stats.totalViolations,
      escalationDistribution: { ...this._stats.escalationDistribution },
    };
  }
}

export default ComplianceMonitor;
