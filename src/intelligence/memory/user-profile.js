/**
 * UserProfile — 用户画像管理（偏好推断 + 增量更新）
 * User profile management with preference inference and incremental updates
 *
 * 从会话历史推断用户专业水平、语言偏好、代码风格等属性，
 * 通过 DomainStore 持久化，监听代理完成事件进行增量更新。
 *
 * Infers user expertise level, language preferences, code style, etc. from
 * session history. Persisted via DomainStore, incrementally updated on
 * agent lifecycle completion events.
 *
 * @module intelligence/memory/user-profile
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';

const COLLECTION = 'user-profiles';

// CJK 检测 / CJK detection
const CJK_REGEX = /[一-鿿㐀-䶿𠀀-𪛟𪜀-𫜿぀-ゟ゠-ヿ가-힯]/u;

// ─── UserProfile ────────────────────────────────────────────────────
export class UserProfile extends ModuleBase {
  static produces() { return []; }
  static consumes() { return []; }
  static publishes() { return []; }
  static subscribes() { return ['agent.lifecycle.completed']; }

  /**
   * @param {object} opts
   * @param {import('../../core/store/domain-store.js').DomainStore} opts.domainStore
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.eventBus
   */
  constructor({ domainStore, eventBus } = {}) {
    super();
    this._store = domainStore;
    this._eventBus = eventBus;

    if (this._eventBus) {
      this._eventBus.subscribe('agent.lifecycle.completed', (data) => {
        this._onAgentCompleted(data);
      });
    }
  }

  /**
   * 从会话历史推断用户属性 / Infer profile attributes from session history
   * @param {Array<{ type: string, content: string }>} sessionHistory
   * @returns {object} inferred attributes
   */
  infer(sessionHistory) {
    if (!sessionHistory || sessionHistory.length === 0) {
      return { expertiseLevel: 'unknown', languagePreferences: [], codeStyle: {}, communicationStyle: 'standard' };
    }

    // 专业水平：从工具使用复杂度推断 / expertise from tool usage complexity
    const toolCalls = sessionHistory.filter((e) => e.type === 'tool_call');
    let expertiseLevel = 'beginner';
    if (toolCalls.length > 10) expertiseLevel = 'advanced';
    else if (toolCalls.length > 3) expertiseLevel = 'intermediate';

    // 语言偏好：从 CJK 字符比例推断 / language preferences from CJK ratio
    const userMessages = sessionHistory.filter((e) => e.type === 'user_message');
    let totalChars = 0;
    let cjkChars = 0;
    for (const msg of userMessages) {
      const text = typeof msg.content === 'string' ? msg.content : '';
      for (const ch of text) {
        totalChars++;
        if (CJK_REGEX.test(ch)) cjkChars++;
      }
    }
    const cjkRatio = totalChars > 0 ? cjkChars / totalChars : 0;
    const languagePreferences = [];
    if (cjkRatio > 0.3) languagePreferences.push('zh');
    if (cjkRatio < 0.7) languagePreferences.push('en');

    // 代码风格 / code style detection
    const allText = sessionHistory.map((e) => (typeof e.content === 'string' ? e.content : '')).join('\n');
    const codeStyle = {};
    if (/typescript|.ts/.test(allText)) codeStyle.typescript = true;
    if (/python|.py/.test(allText)) codeStyle.python = true;
    if (/javascript|.js/.test(allText)) codeStyle.javascript = true;

    // 沟通风格 / communication style
    const avgLength = userMessages.length > 0
      ? userMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0) / userMessages.length
      : 0;
    const communicationStyle = avgLength > 200 ? 'detailed' : avgLength > 50 ? 'standard' : 'concise';

    // 常用工具 / frequent tools
    const toolNames = toolCalls.map((t) => {
      try {
        const parsed = typeof t.content === 'string' ? JSON.parse(t.content) : t.content;
        return parsed?.name || parsed?.tool || 'unknown';
      } catch (_e) { return 'unknown'; }
    });
    const toolFreq = {};
    for (const name of toolNames) toolFreq[name] = (toolFreq[name] || 0) + 1;
    const frequentTools = Object.entries(toolFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);

    return {
      expertiseLevel,
      languagePreferences,
      codeStyle,
      communicationStyle,
      frequentTools,
      frequentFrameworks: Object.keys(codeStyle),
    };
  }

  /**
   * 获取用户画像 / Get user profile
   * @param {string} userId
   * @returns {object|undefined}
   */
  get(userId) {
    return this._store.get(COLLECTION, userId);
  }

  /**
   * 部分更新 / Partial update
   * @param {string} userId
   * @param {object} partial
   * @returns {object} updated profile
   */
  update(userId, partial) {
    const existing = this._store.get(COLLECTION, userId) || {
      userId,
      expertiseLevel: 'unknown',
      languagePreferences: [],
      codeStyle: {},
      communicationStyle: 'standard',
      frequentTools: [],
      frequentFrameworks: [],
      sessionCount: 0,
      lastActive: Date.now(),
    };

    const updated = { ...existing, ...partial, lastActive: Date.now() };
    this._store.put(COLLECTION, userId, updated);
    return updated;
  }

  /**
   * 获取用于 PromptBuilder 的偏好 / Get preferences for PromptBuilder
   * @param {string} userId
   * @returns {object}
   */
  getPreferences(userId) {
    const profile = this.get(userId);
    if (!profile) {
      return { language: 'en', detail: 'standard', expertise: 'unknown' };
    }
    return {
      language: profile.languagePreferences?.[0] || 'en',
      detail: profile.communicationStyle || 'standard',
      expertise: profile.expertiseLevel || 'unknown',
      codeStyle: profile.codeStyle || {},
      frequentTools: profile.frequentTools || [],
    };
  }

  /**
   * 事件回调：代理完成时增量更新 / On agent completed: incremental update
   */
  _onAgentCompleted(data) {
    if (!data?.userId || !data?.sessionHistory) return;
    const inferred = this.infer(data.sessionHistory);
    const existing = this.get(data.userId);

    this.update(data.userId, {
      ...inferred,
      sessionCount: (existing?.sessionCount || 0) + 1,
    });
  }
}

export default UserProfile;
