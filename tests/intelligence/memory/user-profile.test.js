/**
 * UserProfile — 用户画像管理 单元测试
 * @module tests/intelligence/memory/user-profile
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UserProfile } from '../../../src/intelligence/memory/user-profile.js';
import { DomainStore } from '../../../src/core/store/domain-store.js';
import { EventBus } from '../../../src/core/bus/event-bus.js';

describe('UserProfile', () => {
  let domainStore;
  let eventBus;
  let profile;

  beforeEach(() => {
    domainStore = new DomainStore({ domain: 'profile-test', snapshotDir: '/tmp/profile-test' });
    eventBus = new EventBus();
    profile = new UserProfile({ domainStore, eventBus });
  });

  it('get returns undefined for unknown user', () => {
    expect(profile.get('unknown-user')).toBeUndefined();
  });

  it('update creates profile if not exists', () => {
    const result = profile.update('u1', { expertiseLevel: 'advanced' });
    expect(result.userId).toBe('u1');
    expect(result.expertiseLevel).toBe('advanced');
    expect(result.lastActive).toBeDefined();
  });

  it('update merges partial data', () => {
    profile.update('u1', { expertiseLevel: 'beginner' });
    profile.update('u1', { communicationStyle: 'detailed' });
    const u = profile.get('u1');
    expect(u.expertiseLevel).toBe('beginner');
    expect(u.communicationStyle).toBe('detailed');
  });

  it('get/update persistence round-trip', () => {
    profile.update('u1', { expertiseLevel: 'expert', languagePreferences: ['zh', 'en'] });
    const u = profile.get('u1');
    expect(u.expertiseLevel).toBe('expert');
    expect(u.languagePreferences).toEqual(['zh', 'en']);
  });

  it('infer: CJK-heavy session -> zh in languagePreferences', () => {
    const history = [
      { type: 'user_message', content: '请帮我实现一个认证模块' },
      { type: 'user_message', content: '需要支持多种登录方式' },
      { type: 'user_message', content: '谢谢' },
    ];
    const result = profile.infer(history);
    expect(result.languagePreferences).toContain('zh');
  });

  it('infer: many tool calls -> advanced expertise', () => {
    const history = [];
    // 15 tool calls -> should infer 'advanced'
    for (let i = 0; i < 15; i++) {
      history.push({ type: 'tool_call', content: JSON.stringify({ name: 'read_file' }) });
    }
    history.push({ type: 'user_message', content: 'please fix the bug' });
    const result = profile.infer(history);
    expect(result.expertiseLevel).toBe('advanced');
  });

  it('infer: few tool calls -> beginner expertise', () => {
    const history = [
      { type: 'user_message', content: 'hello' },
      { type: 'tool_call', content: JSON.stringify({ name: 'search' }) },
    ];
    const result = profile.infer(history);
    expect(result.expertiseLevel).toBe('beginner');
  });

  it('infer: empty history returns defaults', () => {
    const result = profile.infer([]);
    expect(result.expertiseLevel).toBe('unknown');
    expect(result.languagePreferences).toEqual([]);
  });

  it('getPreferences returns formatted preferences', () => {
    profile.update('u1', {
      expertiseLevel: 'expert',
      languagePreferences: ['zh', 'en'],
      communicationStyle: 'detailed',
      codeStyle: { typescript: true },
      frequentTools: ['read_file', 'search'],
    });
    const prefs = profile.getPreferences('u1');
    expect(prefs.language).toBe('zh');
    expect(prefs.detail).toBe('detailed');
    expect(prefs.expertise).toBe('expert');
    expect(prefs.codeStyle).toEqual({ typescript: true });
    expect(prefs.frequentTools).toEqual(['read_file', 'search']);
  });

  it('getPreferences returns defaults for unknown user', () => {
    const prefs = profile.getPreferences('unknown');
    expect(prefs.language).toBe('en');
    expect(prefs.detail).toBe('standard');
    expect(prefs.expertise).toBe('unknown');
  });

  it('EventBus subscription for agent.lifecycle.completed is registered', () => {
    const subs = eventBus.listSubscriptions();
    expect(subs['agent.lifecycle.completed']).toBeGreaterThanOrEqual(1);
  });
});
