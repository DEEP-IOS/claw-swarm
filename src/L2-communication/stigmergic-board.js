/**
 * StigmergicBoard — 全局共享公告板 / Global Shared Bulletin Board
 *
 * V5.2: Agent 可以在公告板上留言/读取持久化公告。
 * 与信息素系统互补：信息素是短期信号，公告板是持久公告。
 *
 * V5.2: Agents can post/read persistent announcements on the board.
 * Complements pheromone system: pheromones are short-term signals,
 * the board provides persistent announcements.
 *
 * @module L2-communication/stigmergic-board
 * @version 5.2.0
 * @author DEEP-IOS
 */

import { randomUUID } from 'node:crypto';
import { EventTopics, wrapEvent } from '../event-catalog.js';

const SOURCE = 'stigmergic-board';
const DEFAULT_TTL_MINUTES = 1440; // 24 hours

export class StigmergicBoard {
  /**
   * @param {Object} deps
   * @param {Object} [deps.db] - SQLite database instance
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   */
  constructor({ db, messageBus, logger } = {}) {
    this._db = db || null;
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    /** @type {Map<string, Object>} in-memory fallback */
    this._posts = new Map();

    this._stats = { posted: 0, read: 0, expired: 0 };
  }

  // ━━━ 发布 / Post ━━━

  /**
   * 发布公告
   * Post an announcement
   *
   * @param {Object} params
   * @param {string} params.authorId - 发布者 ID
   * @param {string} params.scope - 范围 (e.g., '/zone/frontend')
   * @param {string} params.title - 标题
   * @param {string} params.content - 内容
   * @param {string} [params.category='general'] - 分类
   * @param {number} [params.priority=0] - 优先级
   * @param {number} [params.ttlMinutes=1440] - 存活时间(分钟)
   * @returns {string} post ID
   */
  post({ authorId, scope, title, content, category = 'general', priority = 0, ttlMinutes = DEFAULT_TTL_MINUTES }) {
    const id = randomUUID();
    const now = Date.now();
    const expiresAt = now + ttlMinutes * 60 * 1000;

    const record = { id, authorId, scope, category, title, content, priority, ttlMinutes, readCount: 0, createdAt: now, expiresAt };

    if (this._db) {
      try {
        this._db.prepare(`
          INSERT INTO stigmergic_posts (id, author_id, scope, category, title, content, priority, ttl_minutes, read_count, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(id, authorId, scope, category, title, content, priority, ttlMinutes, now, expiresAt);
      } catch { /* fallback to in-memory */ }
    }

    this._posts.set(id, record);
    this._stats.posted++;

    this._publish(EventTopics.STIGMERGIC_POST_CREATED, { id, authorId, scope, category, title, priority });

    return id;
  }

  // ━━━ 读取 / Read ━━━

  /**
   * 读取范围内的公告
   * Read posts in scope
   *
   * @param {string} scope - 范围前缀
   * @param {Object} [options]
   * @param {string} [options.category] - 过滤分类
   * @param {number} [options.limit=20] - 最大返回数
   * @returns {Array<Object>}
   */
  read(scope, { category, limit = 20 } = {}) {
    this._stats.read++;
    const now = Date.now();

    if (this._db) {
      try {
        let sql = 'SELECT * FROM stigmergic_posts WHERE (scope = ? OR scope LIKE ?) AND (expires_at IS NULL OR expires_at > ?)';
        const params = [scope, scope + '/%', now];
        if (category) {
          sql += ' AND category = ?';
          params.push(category);
        }
        sql += ' ORDER BY priority DESC, created_at DESC LIMIT ?';
        params.push(limit);

        const rows = this._db.prepare(sql).all(...params);

        // increment read count
        for (const row of rows) {
          this._db.prepare('UPDATE stigmergic_posts SET read_count = read_count + 1 WHERE id = ?').run(row.id);
        }

        return rows.map(r => ({
          id: r.id,
          authorId: r.author_id,
          scope: r.scope,
          category: r.category,
          title: r.title,
          content: r.content,
          priority: r.priority,
          readCount: r.read_count + 1,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
        }));
      } catch { /* fallback */ }
    }

    // In-memory fallback
    const results = [];
    for (const post of this._posts.values()) {
      if (post.expiresAt && post.expiresAt < now) continue;
      if (post.scope !== scope && !post.scope.startsWith(scope + '/')) continue;
      if (category && post.category !== category) continue;
      post.readCount++;
      results.push({ ...post });
    }
    results.sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
    return results.slice(0, limit);
  }

  // ━━━ 过期清理 / Expire ━━━

  /**
   * 清理过期公告
   * Clean up expired posts
   *
   * @returns {number} removed count
   */
  expireOld() {
    const now = Date.now();
    let removed = 0;

    if (this._db) {
      try {
        const result = this._db.prepare('DELETE FROM stigmergic_posts WHERE expires_at IS NOT NULL AND expires_at < ?').run(now);
        removed = result.changes || 0;
      } catch { /* ignore */ }
    }

    // In-memory cleanup
    for (const [id, post] of this._posts) {
      if (post.expiresAt && post.expiresAt < now) {
        this._posts.delete(id);
        removed++;
      }
    }

    this._stats.expired += removed;
    if (removed > 0) {
      this._publish(EventTopics.STIGMERGIC_POST_EXPIRED, { removed });
    }

    return removed;
  }

  // ━━━ 统计 / Stats ━━━

  getStats() {
    return { ...this._stats, activePosts: this._posts.size };
  }

  // ━━━ 内部 / Internal ━━━

  _publish(topic, payload) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
      } catch { /* ignore */ }
    }
  }
}
