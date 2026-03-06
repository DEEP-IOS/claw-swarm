/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 3 Peer Directory
 * @module tests/unit/peer-directory.test
 *
 * 测试同伴目录：Agent 发现、格式化注入、查找功能。
 * Tests PeerDirectory: agent discovery, formatted injection, lookup.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PeerDirectory } from '../../src/layer3-intelligence/collaboration/peer-directory.js';

// ===========================================================================
// PeerDirectory — 同伴目录 / Peer Directory
// ===========================================================================

describe('PeerDirectory', () => {
  const mockAgents = [
    { id: 'agent-1', label: 'Scout', name: 'scout-agent', skills: ['exploration', 'research'] },
    { id: 'agent-2', label: 'Worker', name: 'worker-agent', skills: ['coding', 'testing'] },
    { id: 'agent-3', label: 'Guard', name: 'guard-agent', skills: [] },
  ];

  let directory;

  beforeEach(() => {
    directory = new PeerDirectory(() => ({ agents: mockAgents }));
  });

  // ── Constructor 构造函数 ─────────────────────────────────────────

  it('should construct with a config getter function (使用配置获取函数构造)', () => {
    const d = new PeerDirectory(() => ({}));
    assert.ok(d);
  });

  // ── getDirectory 获取目录 ───────────────────────────────────────

  it('should return agents from config (从配置返回 Agent 列表)', () => {
    const agents = directory.getDirectory();
    assert.equal(agents.length, 3);
    assert.equal(agents[0].id, 'agent-1');
  });

  it('should return empty array if no agents in config (配置中无 Agent 返回空数组)', () => {
    const d = new PeerDirectory(() => ({}));
    const agents = d.getDirectory();
    assert.deepEqual(agents, []);
  });

  it('should return empty array if config getter throws (配置获取函数抛错时返回空数组)', () => {
    const d = new PeerDirectory(() => { throw new Error('config error'); });
    const agents = d.getDirectory();
    assert.deepEqual(agents, []);
  });

  it('should lazy-read: modifying config changes results (延迟读取：修改配置改变结果)', () => {
    const configObj = { agents: [{ id: 'a1' }] };
    const d = new PeerDirectory(() => configObj);

    assert.equal(d.getDirectory().length, 1);

    // Modify the config object
    configObj.agents.push({ id: 'a2' });
    assert.equal(d.getDirectory().length, 2);
  });

  // ── formatForInjection 格式化注入 ──────────────────────────────

  it('should exclude self from injection (注入时排除自身)', () => {
    const result = directory.formatForInjection('agent-1');
    assert.ok(!result.includes('agent-1'));
    assert.ok(result.includes('agent-2'));
    assert.ok(result.includes('agent-3'));
  });

  it('should return empty string when no peers (无同伴时返回空字符串)', () => {
    const d = new PeerDirectory(() => ({ agents: [] }));
    const result = d.formatForInjection('agent-1');
    assert.equal(result, '');
  });

  it('should return empty string when only self exists (仅有自身时返回空字符串)', () => {
    const d = new PeerDirectory(() => ({ agents: [{ id: 'agent-1' }] }));
    const result = d.formatForInjection('agent-1');
    assert.equal(result, '');
  });

  it('should include agent skills in injection (注入中包含 Agent 技能)', () => {
    const result = directory.formatForInjection('agent-3');
    assert.ok(result.includes('exploration, research'));
    assert.ok(result.includes('coding, testing'));
  });

  it('should show "general" for agents without skills (无技能显示 general)', () => {
    const result = directory.formatForInjection('agent-1');
    assert.ok(result.includes('general'));
  });

  it('should include [Peer Directory] header (包含 [Peer Directory] 标题)', () => {
    const result = directory.formatForInjection('agent-1');
    assert.ok(result.startsWith('[Peer Directory]'));
  });

  // ── findPeer 查找同伴 ──────────────────────────────────────────

  it('should find peer by id (通过 id 查找同伴)', () => {
    const peer = directory.findPeer('agent-2');
    assert.ok(peer);
    assert.equal(peer.id, 'agent-2');
  });

  it('should find peer by label (通过 label 查找同伴)', () => {
    const peer = directory.findPeer('Scout');
    assert.ok(peer);
    assert.equal(peer.id, 'agent-1');
  });

  it('should find peer by name (通过 name 查找同伴)', () => {
    const peer = directory.findPeer('guard-agent');
    assert.ok(peer);
    assert.equal(peer.id, 'agent-3');
  });

  it('should return null for nonexistent peer (不存在的同伴返回 null)', () => {
    const peer = directory.findPeer('nonexistent');
    assert.equal(peer, null);
  });

  // ── count 计数 ─────────────────────────────────────────────────

  it('should return correct agent count (返回正确的 Agent 数量)', () => {
    assert.equal(directory.count(), 3);
  });
});
