/**
 * SubagentFailureMessage - Generates human-readable failure messages
 * for sub-agent errors based on failure classification.
 *
 * CJK-aware: Chinese characters count as 2 for display width.
 *
 * @module bridge/interaction/subagent-failure-message
 * @version 9.0.0
 */

/**
 * Mapping from failure class to message template and default suggestion.
 */
const FAILURE_TEMPLATES = {
  tool_error: {
    template: (agentId, toolName) =>
      `Agent ${agentId} encountered a tool error${toolName ? ` with ${toolName}` : ''}. Suggested: fix and retry.`,
    suggestion: 'retry_with_fix',
  },
  model_hallucination: {
    template: (agentId) =>
      `Agent ${agentId} referenced non-existent resources. Suggested: provide more context.`,
    suggestion: 'add_context',
  },
  context_overflow: {
    template: (agentId) =>
      `Agent ${agentId} exceeded context limits. Suggested: split the task.`,
    suggestion: 'split_task',
  },
  permission_denied: {
    template: (agentId) =>
      `Agent ${agentId} lacks required permissions. Suggested: escalate or adjust scope.`,
    suggestion: 'escalate',
  },
  task_ambiguity: {
    template: (agentId) =>
      `Agent ${agentId} could not determine task requirements. Suggested: clarify the task.`,
    suggestion: 'clarify',
  },
  timeout: {
    template: (agentId, toolName) =>
      `Agent ${agentId} timed out${toolName ? ` while calling ${toolName}` : ''}. Suggested: retry with a simpler approach.`,
    suggestion: 'retry',
  },
  rate_limit: {
    template: (agentId) =>
      `Agent ${agentId} was rate-limited. Suggested: wait and retry.`,
    suggestion: 'retry',
  },
};

export class SubagentFailureMessage {
  constructor() {
    this._generated = 0;
  }

  /**
   * Generate a structured failure message from failure context and classification.
   *
   * @param {Object} failureContext
   * @param {string} [failureContext.agentId]   - ID of the failed agent
   * @param {string|Error} [failureContext.error] - Error message or Error object
   * @param {string} [failureContext.toolName]  - Tool that caused the failure (if applicable)
   * @param {Object} [classification]
   * @param {string} [classification.class]              - Failure class (tool_error, model_hallucination, etc.)
   * @param {string} [classification.severity]           - low | medium | high | critical
   * @param {string} [classification.suggestedStrategy]  - Recommended recovery strategy
   * @returns {{ message: string, severity: string, suggestion: string, agentId: string, displayLength: number }}
   */
  generate(failureContext, classification) {
    this._generated++;

    const agentId = failureContext?.agentId || 'unknown';
    const errorStr = failureContext?.error instanceof Error
      ? failureContext.error.message
      : String(failureContext?.error || 'unknown');
    const toolName = failureContext?.toolName || null;

    const cls = classification?.class || 'unknown';
    const sev = classification?.severity || 'medium';
    const strategy = classification?.suggestedStrategy;

    // Look up the template for this failure class
    const tmpl = FAILURE_TEMPLATES[cls];
    let message;

    if (tmpl) {
      message = tmpl.template(agentId, toolName);
    } else {
      // Fallback: generic message with the raw error
      message = `Agent ${agentId} failed: ${errorStr}.`;
    }

    const suggestion = strategy || tmpl?.suggestion || 'retry';

    return {
      message,
      severity: sev,
      suggestion,
      agentId,
      failureClass: cls,
      displayLength: this._getDisplayLength(message),
    };
  }

  /**
   * Generate a concise one-line version for log display.
   * @param {Object} failureContext
   * @param {Object} [classification]
   * @returns {string}
   */
  generateOneLiner(failureContext, classification) {
    const agentId = failureContext?.agentId || '?';
    const cls = classification?.class || 'error';
    const sev = classification?.severity || 'med';
    return `[${sev}] ${agentId}: ${cls}`;
  }

  /**
   * CJK-aware display length. Characters with charCode > 0x7F count as 2.
   * @param {string} text
   * @returns {number}
   */
  _getDisplayLength(text) {
    if (!text) return 0;
    let len = 0;
    for (const ch of text) {
      len += ch.charCodeAt(0) > 0x7F ? 2 : 1;
    }
    return len;
  }

  /**
   * Return the count of messages generated.
   * @returns {{ generated: number }}
   */
  getStats() {
    return { generated: this._generated };
  }
}
