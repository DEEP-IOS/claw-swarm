/**
 * TaskPresenter - Formats task results, failures, and progress into
 * human-readable presentations.
 *
 * CJK-aware: Chinese characters count as 2 for display width calculations.
 *
 * @module bridge/interaction/task-presenter
 * @version 9.0.0
 */

/**
 * Failure strategy descriptions (suggestedStrategy -> human message).
 */
const STRATEGY_MESSAGES = {
  retry_with_fix: 'Tool call failed — auto-retry with corrections',
  add_context: 'Model generated non-existent reference — adding context',
  split_task: 'Task too large — splitting into subtasks',
  escalate: 'Permission issue — needs elevated access',
  clarify: 'Task description ambiguous — needs clarification',
  retry: 'Transient failure — retrying',
  abort: 'Unrecoverable error — task aborted',
};

/**
 * File extension -> impact category mapping.
 */
const IMPACT_CATEGORIES = {
  config: ['.json', '.yaml', '.yml', '.toml', '.env', '.ini', '.conf'],
  source: ['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.py', '.go', '.rs'],
  test: ['.test.js', '.test.ts', '.spec.js', '.spec.ts', '.test.mjs'],
  style: ['.css', '.scss', '.less', '.styl'],
  doc: ['.md', '.txt', '.rst', '.adoc'],
};

export class TaskPresenter {
  /**
   * @param {Object} [config={}]
   * @param {number} [config.maxFilesShown=10]  - Max files to list in output
   * @param {number} [config.maxSummaryWidth=80] - Max display width for summary lines
   */
  constructor(config = {}) {
    this._config = config;
    this._maxFilesShown = config.maxFilesShown ?? 10;
    this._maxSummaryWidth = config.maxSummaryWidth ?? 80;
  }

  /**
   * Format a successful task completion result.
   * @param {Object} result
   * @param {string} [result.summary]       - Raw summary from the agent
   * @param {Array}  [result.filesChanged]  - Files modified (string or {path, action})
   * @param {number} [result.confidence]    - 0-1 confidence score
   * @param {string} [result.output]        - Agent output text
   * @returns {{ summary: string, filesChanged: string[], potentialImpact: Object, nextSteps: string[], confidence: number }}
   */
  formatCompletion(result) {
    const summary = this._buildSummary(result);
    const filesChanged = this._normalizeFiles(result?.filesChanged || []);
    const potentialImpact = this._assessImpact(filesChanged);
    const nextSteps = this._suggestNextSteps(result);
    const confidence = typeof result?.confidence === 'number'
      ? Math.max(0, Math.min(1, result.confidence))
      : 0.8;

    return { summary, filesChanged, potentialImpact, nextSteps, confidence };
  }

  /**
   * Format a task failure with classification context.
   * @param {Error|string} error
   * @param {Object} [classification]
   * @param {string} [classification.suggestedStrategy]
   * @param {string} [classification.severity]
   * @param {string} [classification.class]
   * @returns {{ reason: string, error: string, suggestion: string, severity: string }}
   */
  formatFailure(error, classification) {
    const strategy = classification?.suggestedStrategy || 'retry';
    const reason = STRATEGY_MESSAGES[strategy] || 'Task encountered an error';
    const errorMsg = error instanceof Error ? error.message : String(error || 'Unknown error');
    const severity = classification?.severity || 'medium';

    return {
      reason,
      error: errorMsg,
      suggestion: strategy,
      severity,
      class: classification?.class || 'unknown',
    };
  }

  /**
   * Format progress for display to the user.
   * @param {Array} steps   - Array of step objects
   * @param {Object} [estimate] - Estimate from ProgressTracker
   * @returns {string}
   */
  formatProgress(steps, estimate) {
    const count = steps?.length || 0;
    if (count === 0) return 'No progress yet.';

    let eta = '';
    if (estimate?.avgStepDurationMs) {
      const avgSec = Math.round(estimate.avgStepDurationMs / 1000);
      eta = avgSec > 0 ? ` (~${avgSec}s per step)` : '';
    }

    const lastStep = steps[steps.length - 1];
    const lastDesc = lastStep?.description || lastStep?.tool || '';
    const lastInfo = lastDesc ? ` Last: ${lastDesc}` : '';

    return `Progress: ${count} step(s) completed.${eta}${lastInfo}`;
  }

  // ─── CJK-Aware Text Length ────────────────────────────────────────

  /**
   * Calculate display width with CJK awareness.
   * Characters with charCode > 0x7F count as 2 (full-width).
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
   * Truncate text to fit within maxWidth display columns.
   * @param {string} text
   * @param {number} maxWidth
   * @returns {string}
   */
  _truncateToWidth(text, maxWidth) {
    if (!text) return '';
    let width = 0;
    let i = 0;
    for (const ch of text) {
      const charWidth = ch.charCodeAt(0) > 0x7F ? 2 : 1;
      if (width + charWidth > maxWidth - 3) {
        return text.slice(0, i) + '...';
      }
      width += charWidth;
      i += ch.length;
    }
    return text;
  }

  // ─── Internal Helpers ─────────────────────────────────────────────

  /**
   * Build a human-readable summary from the result.
   * @param {Object} result
   * @returns {string}
   */
  _buildSummary(result) {
    if (!result) return 'Task completed (no details available).';

    // Use provided summary if available
    if (result.summary && typeof result.summary === 'string') {
      return this._truncateToWidth(result.summary, this._maxSummaryWidth * 3);
    }

    // Build from output
    if (result.output && typeof result.output === 'string') {
      const firstLine = result.output.split('\n')[0] || '';
      return this._truncateToWidth(firstLine, this._maxSummaryWidth * 2);
    }

    // Build from files changed
    const files = result.filesChanged || [];
    if (files.length > 0) {
      return `Task completed: ${files.length} file(s) modified.`;
    }

    return result.success === false
      ? 'Task did not complete successfully.'
      : 'Task completed.';
  }

  /**
   * Normalize file entries to string paths with action annotations.
   * @param {Array} files - Array of strings or { path, action } objects
   * @returns {string[]}
   */
  _normalizeFiles(files) {
    const normalized = [];
    for (const f of files) {
      if (typeof f === 'string') {
        normalized.push(f);
      } else if (f && f.path) {
        const action = f.action || 'modified';
        normalized.push(`${f.path} (${action})`);
      }
    }
    // Limit display count
    if (normalized.length > this._maxFilesShown) {
      const shown = normalized.slice(0, this._maxFilesShown);
      shown.push(`... and ${normalized.length - this._maxFilesShown} more`);
      return shown;
    }
    return normalized;
  }

  /**
   * Assess potential impact based on file types changed.
   * @param {string[]} files - Normalized file path strings
   * @returns {{ categories: Object, riskLevel: string }}
   */
  _assessImpact(files) {
    const categories = { config: 0, source: 0, test: 0, style: 0, doc: 0, other: 0 };

    for (const filePath of files) {
      // Strip action annotation for extension detection
      const cleanPath = filePath.replace(/\s*\(.*\)$/, '').toLowerCase();
      let matched = false;

      for (const [cat, extensions] of Object.entries(IMPACT_CATEGORIES)) {
        if (extensions.some(ext => cleanPath.endsWith(ext))) {
          categories[cat]++;
          matched = true;
          break;
        }
      }
      if (!matched) categories.other++;
    }

    // Determine risk level
    let riskLevel = 'low';
    if (categories.config > 0) riskLevel = 'medium';
    if (categories.source > 5 || categories.config > 2) riskLevel = 'high';

    return { categories, riskLevel };
  }

  /**
   * Suggest next steps based on the result.
   * @param {Object} result
   * @returns {string[]}
   */
  _suggestNextSteps(result) {
    const steps = [];
    const files = result?.filesChanged || [];

    // Suggest tests if source files were changed
    const hasSourceChanges = files.some(f => {
      const path = typeof f === 'string' ? f : f?.path || '';
      return /\.(js|ts|mjs|cjs|py|go|rs)$/.test(path.toLowerCase());
    });
    if (hasSourceChanges) {
      steps.push('Run relevant test suites to verify changes');
    }

    // Suggest review if many files changed
    if (files.length > 5) {
      steps.push('Review the full diff before committing');
    }

    // Suggest config validation
    const hasConfigChanges = files.some(f => {
      const path = typeof f === 'string' ? f : f?.path || '';
      return /\.(json|yaml|yml|toml|env)$/.test(path.toLowerCase());
    });
    if (hasConfigChanges) {
      steps.push('Validate configuration files for correctness');
    }

    // If task failed, suggest re-run
    if (result?.success === false) {
      steps.push('Investigate the error and retry the task');
    }

    // Default: at least one suggestion
    if (steps.length === 0) {
      steps.push('Verify the output meets expectations');
    }

    return steps;
  }

  /**
   * Return aggregate statistics.
   * @returns {Object}
   */
  getStats() {
    return {
      maxFilesShown: this._maxFilesShown,
      maxSummaryWidth: this._maxSummaryWidth,
    };
  }
}
