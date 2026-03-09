/**
 * StigmergicBoard 单元测试 / StigmergicBoard Unit Tests
 *
 * 测试 L2 间接协作板的发布、读取、过期清理功能。
 * Tests L2 stigmergic board post, read, and expiration functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StigmergicBoard } from '../../../src/L2-communication/stigmergic-board.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus / Mock MessageBus */
function createMockBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe(topic, handler) { return () => {}; },
    _published: published,
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('StigmergicBoard', () => {
  let messageBus, board;

  beforeEach(() => {
    messageBus = createMockBus();
    board = new StigmergicBoard({
      messageBus,
      db: null,
      logger: silentLogger,
    });
  });

  // ━━━ 1. post 创建帖子 / Post Creates Entry ━━━
  describe('post', () => {
    it('应创建帖子并返回字符串 ID / should create post and return string ID', () => {
      const result = board.post({
        scope: 'project/alpha',
        title: '支援请求 / Support request',
        content: '需要前端开发支援 / Need frontend dev support',
        authorId: 'agent-1',
      });

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('带优先级和 TTL 创建帖子 / should create post with priority and ttlMinutes', () => {
      const result = board.post({
        scope: 'project/beta',
        title: '安全告警 / Security alert',
        content: '紧急: 安全漏洞 / Urgent: security vulnerability',
        authorId: 'agent-2',
        priority: 10,
        ttlMinutes: 5,
      });

      expect(typeof result).toBe('string');
      expect(result).toBeTruthy();
    });

    it('不同帖子应有不同 ID / different posts should have different IDs', () => {
      const r1 = board.post({ scope: 's', title: 'a', content: 'a', authorId: 'x' });
      const r2 = board.post({ scope: 's', title: 'b', content: 'b', authorId: 'y' });
      expect(r1).not.toBe(r2);
    });
  });

  // ━━━ 2. read — 匹配 scope / Read Matching Scope ━━━
  describe('read — matching scope', () => {
    it('应返回匹配 scope 的帖子 / should return posts for matching scope', () => {
      board.post({ scope: 'zone/frontend', title: 'React', content: 'React 重构', authorId: 'agent-1' });
      board.post({ scope: 'zone/frontend', title: 'CSS', content: 'CSS 优化', authorId: 'agent-2' });

      const posts = board.read('zone/frontend');

      expect(Array.isArray(posts)).toBe(true);
      expect(posts.length).toBe(2);
    });

    it('read 带 limit 应限制数量 / read with limit should cap results', () => {
      board.post({ scope: 'zone/be', title: '帖子 1', content: '帖子 1', authorId: 'a1' });
      board.post({ scope: 'zone/be', title: '帖子 2', content: '帖子 2', authorId: 'a2' });
      board.post({ scope: 'zone/be', title: '帖子 3', content: '帖子 3', authorId: 'a3' });

      const posts = board.read('zone/be', { limit: 2 });
      expect(posts.length).toBeLessThanOrEqual(2);
    });
  });

  // ━━━ 3. read — 不匹配 scope / Read Non-Matching Scope ━━━
  describe('read — non-matching scope', () => {
    it('不匹配 scope 应返回空数组 / non-matching scope should return empty array', () => {
      board.post({ scope: 'zone/frontend', title: '前端公告', content: '仅前端 / frontend only', authorId: 'agent-1' });

      const posts = board.read('zone/backend');

      expect(Array.isArray(posts)).toBe(true);
      expect(posts.length).toBe(0);
    });

    it('空板读取应返回空数组 / reading empty board should return empty array', () => {
      const posts = board.read('any/scope');
      expect(Array.isArray(posts)).toBe(true);
      expect(posts.length).toBe(0);
    });
  });

  // ━━━ 4. 帖子字段结构 / Post Fields ━━━
  describe('post field structure', () => {
    it('帖子应包含正确字段 / posts should have correct fields', () => {
      board.post({
        scope: 'project/gamma',
        title: '测试标题 / Test title',
        content: '测试帖子内容 / Test post content',
        authorId: 'agent-3',
      });

      const posts = board.read('project/gamma');
      expect(posts.length).toBe(1);

      const post = posts[0];

      // id
      expect(post.id !== undefined && post.id !== null).toBe(true);

      // scope
      expect(post.scope).toBe('project/gamma');

      // content
      expect(post.content).toBe('测试帖子内容 / Test post content');

      // authorId
      expect(post.authorId).toBe('agent-3');

      // createdAt
      expect(post.createdAt !== undefined).toBe(true);
      expect(typeof post.createdAt === 'number' || post.createdAt instanceof Date).toBe(true);
    });
  });

  // ━━━ 5. expireOld 过期清理 / Expire Old Posts ━━━
  describe('expireOld', () => {
    it('expireOld 应为函数 / should be a function', () => {
      expect(typeof board.expireOld).toBe('function');
    });

    it('调用 expireOld 不应抛出异常 / calling expireOld should not throw', () => {
      board.post({ scope: 'expire/test', title: '过期测试', content: '会过期 / will expire', authorId: 'a1' });
      expect(() => board.expireOld()).not.toThrow();
    });
  });
});
