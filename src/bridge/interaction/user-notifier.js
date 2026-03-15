/**
 * UserNotifier - Publishes user-facing notifications via the event bus.
 *
 * Supports four notification types:
 *   - progress: periodic task progress updates (throttled)
 *   - blocked:  agent is blocked and needs user input
 *   - choice:   present a set of options to the user
 *   - complete: task finished (always delivered, never throttled)
 *
 * Progress notifications are throttled per-session to avoid flooding.
 * Blocked, choice, and complete notifications bypass throttling.
 *
 * @module bridge/interaction/user-notifier
 * @version 9.0.0
 */

export class UserNotifier {
  /**
   * @param {Object} deps
   * @param {Object} deps.bus              - EventBus for publishing notifications
   * @param {Object} [deps.config={}]
   * @param {number} [deps.config.throttleMs=30000] - Min ms between progress notifications per session
   */
  constructor({ bus, config = {} }) {
    this._bus = bus;
    this._throttleMs = config.throttleMs ?? 30000;
    this._lastNotifyAt = new Map(); // sessionId -> timestamp
    this._stats = { progress: 0, blocked: 0, choice: 0, complete: 0, throttled: 0 };
  }

  /**
   * Send a progress notification (subject to throttling).
   * @param {string} sessionId
   * @param {string} message - Human-readable progress message
   * @returns {boolean} true if notification was sent, false if throttled
   */
  notifyProgress(sessionId, message) {
    if (this._shouldThrottle(sessionId)) {
      this._stats.throttled++;
      return false;
    }
    this._bus?.publish('user.notification', {
      sessionId,
      type: 'progress',
      message,
      ts: Date.now(),
    });
    this._stats.progress++;
    return true;
  }

  /**
   * Send a blocked notification (bypasses throttling).
   * Indicates the agent cannot proceed without user input.
   * @param {string} sessionId
   * @param {string} reason   - Why the agent is blocked
   * @param {string[]} [options=[]] - Suggested resolution options
   * @returns {boolean} always true
   */
  notifyBlocked(sessionId, reason, options = []) {
    this._bus?.publish('user.notification', {
      sessionId,
      type: 'blocked',
      reason,
      options,
      ts: Date.now(),
    });
    this._stats.blocked++;
    return true;
  }

  /**
   * Present a choice to the user (bypasses throttling).
   * @param {string} sessionId
   * @param {string} question  - The question to ask
   * @param {Array} choices    - Array of { label, value } or plain strings
   * @returns {boolean} always true
   */
  notifyChoice(sessionId, question, choices) {
    const normalizedChoices = (choices || []).map(c =>
      typeof c === 'string' ? { label: c, value: c } : c
    );
    this._bus?.publish('user.notification', {
      sessionId,
      type: 'choice',
      question,
      choices: normalizedChoices,
      ts: Date.now(),
    });
    this._stats.choice++;
    return true;
  }

  /**
   * Send a completion notification (bypasses throttling).
   * @param {string} sessionId
   * @param {Object} result - Task result (from TaskPresenter.formatCompletion)
   * @returns {boolean} always true
   */
  notifyComplete(sessionId, result) {
    this._bus?.publish('user.notification', {
      sessionId,
      type: 'complete',
      result,
      ts: Date.now(),
    });
    this._stats.complete++;
    return true;
  }

  // ─── Throttle Logic ───────────────────────────────────────────────

  /**
   * Check whether a progress notification should be throttled for this session.
   * Updates the last-notify timestamp if not throttled.
   * @param {string} sessionId
   * @returns {boolean} true if should suppress
   */
  _shouldThrottle(sessionId) {
    const last = this._lastNotifyAt.get(sessionId) || 0;
    const now = Date.now();
    if (now - last < this._throttleMs) {
      return true;
    }
    this._lastNotifyAt.set(sessionId, now);
    return false;
  }

  // ─── Cleanup & Stats ─────────────────────────────────────────────

  /**
   * Clear throttle state for a session (e.g., on session end).
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    this._lastNotifyAt.delete(sessionId);
  }

  /**
   * Return aggregate statistics.
   * @returns {{ trackedSessions: number, progress: number, blocked: number, choice: number, complete: number, throttled: number }}
   */
  getStats() {
    return {
      trackedSessions: this._lastNotifyAt.size,
      ...this._stats,
    };
  }
}
