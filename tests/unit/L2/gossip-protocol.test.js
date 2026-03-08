/**
 * GossipProtocol 单元测试 / GossipProtocol Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GossipProtocol } from '../../../src/L2-communication/gossip-protocol.js';
import { MessageBus } from '../../../src/L2-communication/message-bus.js';

describe('GossipProtocol', () => {
  let gp;

  beforeEach(() => {
    gp = new GossipProtocol({ fanout: 2 });
  });

  afterEach(() => {
    gp.destroy();
  });

  // ━━━ 状态管理 / State Management ━━━

  describe('状态管理 / state management', () => {
    it('updateState → getState 返回状态 / returns stored state', () => {
      gp.updateState('a1', { role: 'worker' });
      const s = gp.getState('a1');
      expect(s.role).toBe('worker');
      expect(s._version).toBe(1);
    });

    it('getState 不存在时返回 null / returns null for unknown agent', () => {
      expect(gp.getState('missing')).toBeNull();
    });

    it('getAllStates 返回所有状态 / returns all agent states', () => {
      gp.updateState('a1', { x: 1 });
      gp.updateState('a2', { x: 2 });
      const all = gp.getAllStates();
      expect(all.size).toBe(2);
      expect(all.get('a1').x).toBe(1);
    });

    it('removeState 删除指定状态 / removes agent state', () => {
      gp.updateState('a1', { x: 1 });
      gp.removeState('a1');
      expect(gp.getState('a1')).toBeNull();
      expect(gp.getAgentCount()).toBe(0);
    });
  });

  // ━━━ 版本递增 / State Versioning ━━━

  describe('版本递增 / state versioning', () => {
    it('多次更新版本号递增 / version increments on repeated updates', () => {
      gp.updateState('a1', { v: 0 });
      gp.updateState('a1', { v: 1 });
      gp.updateState('a1', { v: 2 });
      expect(gp.getState('a1')._version).toBe(3);
    });
  });

  // ━━━ 广播 / Broadcast ━━━

  describe('广播 / broadcast', () => {
    it('广播选取接收者 / selects recipients from registered agents', () => {
      gp.updateState('sender', {});
      gp.updateState('r1', {});
      gp.updateState('r2', {});
      const { recipients, round } = gp.broadcast('sender', { hello: 1 });
      expect(round).toBe(1);
      expect(recipients.length).toBeGreaterThan(0);
      expect(recipients).not.toContain('sender');
    });

    it('排除列表阻止发送 / exclude list prevents sending', () => {
      gp.updateState('s', {});
      gp.updateState('r1', {});
      gp.updateState('r2', {});
      const { recipients } = gp.broadcast('s', {}, { exclude: ['r1'] });
      expect(recipients).not.toContain('r1');
    });
  });

  // ━━━ 扇出限制 / Fanout Limit ━━━

  describe('扇出限制 / fanout limit', () => {
    it('接收者数量不超过 fanout / recipients capped at fanout', () => {
      const gp3 = new GossipProtocol({ fanout: 2 });
      gp3.updateState('s', {});
      for (let i = 0; i < 10; i++) gp3.updateState(`r${i}`, {});
      const { recipients } = gp3.broadcast('s', { data: 1 });
      expect(recipients.length).toBe(2);
      gp3.destroy();
    });
  });

  // ━━━ 状态合并 / State Merge ━━━

  describe('状态合并 / state merge', () => {
    it('高版本合并覆盖本地 / higher version overwrites local', () => {
      gp.updateState('a1', { old: true });
      const merged = gp.mergeState('a1', { new: true }, 99);
      expect(merged).toBe(true);
      expect(gp.getState('a1').new).toBe(true);
      expect(gp.getState('a1')._version).toBe(99);
    });

    it('低版本合并不更新 / lower version does not overwrite', () => {
      gp.updateState('a1', { keep: true });
      gp.updateState('a1', { keep: true }); // version = 2
      const merged = gp.mergeState('a1', { bad: true }, 1);
      expect(merged).toBe(false);
      expect(gp.getState('a1').keep).toBe(true);
    });
  });

  // ━━━ 活跃代理 / Active Agents ━━━

  describe('活跃代理 / active agents', () => {
    it('getActiveAgents 返回近期更新的代理 / returns recently seen agents', () => {
      gp.updateState('a1', {});
      gp.updateState('a2', {});
      const active = gp.getActiveAgents();
      expect(active).toContain('a1');
      expect(active).toContain('a2');
    });
  });

  // ━━━ 统计 / Statistics ━━━

  describe('统计 / statistics', () => {
    it('getStats 返回广播/合并/轮次/代理数 / returns broadcasts, merges, rounds, agentCount', () => {
      gp.updateState('a1', {});
      gp.updateState('a2', {});
      gp.broadcast('a1', {});
      gp.mergeState('a1', { x: 1 }, 100);
      const stats = gp.getStats();
      expect(stats.broadcasts).toBe(1);
      expect(stats.merges).toBe(1);
      expect(stats.rounds).toBe(1);
      expect(stats.agentCount).toBe(2);
    });
  });

  // ━━━ 销毁 / Destroy ━━━

  describe('销毁 / destroy', () => {
    it('destroy 清空状态并停止心跳 / clears state and stops heartbeat', () => {
      gp.updateState('a1', {});
      gp.startHeartbeat(100_000);
      gp.destroy();
      expect(gp.getAgentCount()).toBe(0);
      expect(gp.getStats().rounds).toBe(0);
      expect(gp._running).toBe(false);
    });
  });

  // ━━━ MessageBus 集成 / MessageBus Integration ━━━

  describe('MessageBus 集成 / MessageBus integration', () => {
    it('broadcast 通过 MessageBus 发布 gossip.broadcast / publishes via message bus', () => {
      const bus = new MessageBus();
      const gpBus = new GossipProtocol({ messageBus: bus, fanout: 3 });
      const received = [];
      bus.subscribe('gossip.broadcast', (msg) => received.push(msg));

      gpBus.updateState('s', {});
      gpBus.updateState('r1', {});
      gpBus.broadcast('s', { ping: true });

      expect(received.length).toBe(1);
      expect(received[0].data.senderId).toBe('s');
      expect(received[0].data.message.ping).toBe(true);

      gpBus.destroy();
      bus.destroy();
    });
  });
});
