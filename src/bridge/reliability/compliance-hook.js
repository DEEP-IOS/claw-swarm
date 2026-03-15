/**
 * ComplianceHook - monitors LLM output for compliance violations.
 * Tracks escalation levels per session and can trigger termination
 * after repeated violations.
 */
export class ComplianceHook {
  constructor({ quality, config = {} } = {}) {
    this._quality = quality || null;
    this._escalations = new Map(); // sessionId -> violation count
    this._maxViolations = config.maxViolations ?? 3;
    this._stats = { checked: 0, compliant: 0, violations: 0, terminations: 0 };
  }

  /**
   * Check LLM output for compliance.
   * @param {string} sessionId
   * @param {string} output - the LLM output text
   * @param {object} context - additional context (roleId, toolName, etc.)
   * @returns {{ compliant: boolean, violations?: string[], escalationLevel?: number, shouldTerminate?: boolean }}
   */
  onLlmOutput(sessionId, output, context = {}) {
    this._stats.checked++;

    const result = this._quality?.checkCompliance?.(sessionId, output, context);

    if (!result || result.compliant) {
      this._stats.compliant++;
      return { compliant: true };
    }

    // Violation detected: escalate
    const count = (this._escalations.get(sessionId) || 0) + 1;
    this._escalations.set(sessionId, count);
    this._stats.violations++;

    const shouldTerminate = count >= this._maxViolations;
    if (shouldTerminate) {
      this._stats.terminations++;
    }

    return {
      compliant: false,
      violations: result.violations || [],
      escalationLevel: Math.min(count, this._maxViolations),
      shouldTerminate,
    };
  }

  /**
   * Get the escalation correction prompt for a session, if available.
   * @param {string} sessionId
   * @returns {string|null}
   */
  getPrompt(sessionId) {
    return this._quality?.getEscalationPrompt?.(sessionId) ?? null;
  }

  /**
   * Clear escalation state for a session.
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    this._escalations.delete(sessionId);
  }

  /**
   * Return aggregate statistics.
   */
  getStats() {
    return {
      ...this._stats,
      activeSessions: this._escalations.size,
      maxViolations: this._maxViolations,
    };
  }
}
