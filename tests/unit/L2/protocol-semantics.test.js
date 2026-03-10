/**
 * ProtocolSemantics v0 单元测试 / ProtocolSemantics v0 Unit Tests
 *
 * 测试 9 种语义消息类型的发送、查询、协议验证:
 * Tests 9 semantic message types: send, query, protocol validation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ProtocolSemantics, MESSAGE_TYPES } from '../../../src/L2-communication/protocol-semantics.js';

function createMockBus() {
  const _published = [];
  return {
    publish(topic, data) { _published.push({ topic, data }); },
    subscribe() {},
    _published,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('ProtocolSemantics', () => {
  let proto;
  let mockBus;

  beforeEach(() => {
    mockBus = createMockBus();
    proto = new ProtocolSemantics({ messageBus: mockBus, logger });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MESSAGE_TYPES 常量
  // ═══════════════════════════════════════════════════════════════════════

  describe('MESSAGE_TYPES', () => {
    it('导出 9 种消息类型 / exports 9 message types', () => {
      const types = Object.keys(MESSAGE_TYPES);
      expect(types.length).toBe(9);
      expect(types).toContain('REQUEST');
      expect(types).toContain('COMMIT');
      expect(types).toContain('ACK');
      expect(types).toContain('DELEGATE');
      expect(types).toContain('ESCALATE');
      expect(types).toContain('REJECT');
      expect(types).toContain('REVISE');
      expect(types).toContain('REPAIR');
      expect(types).toContain('REPORT');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // send
  // ═══════════════════════════════════════════════════════════════════════

  describe('send', () => {
    it('发送标准消息 / sends standard message', () => {
      const msg = proto.send({
        type: MESSAGE_TYPES.REQUEST,
        from: 'MPU-T',
        to: 'D1',
        payload: { task: { goal: '调研API' } },
      });

      expect(msg.messageId).toBeDefined();
      expect(msg.type).toBe('REQUEST');
      expect(msg.from).toBe('MPU-T');
      expect(msg.to).toBe('D1');
      expect(msg.conversationId).toBeDefined();
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('无效 type 抛出错误 / invalid type throws', () => {
      expect(() => proto.send({
        type: 'INVALID',
        from: 'A',
        to: 'B',
      })).toThrow('Invalid message type');
    });

    it('无 from 抛出错误 / missing from throws', () => {
      expect(() => proto.send({
        type: MESSAGE_TYPES.REQUEST,
        to: 'B',
      })).toThrow('sender');
    });

    it('无 to 抛出错误 / missing to throws', () => {
      expect(() => proto.send({
        type: MESSAGE_TYPES.REQUEST,
        from: 'A',
      })).toThrow('recipient');
    });

    it('同一 conversationId 消息归入同一会话 / same convId groups messages', () => {
      proto.send({ type: MESSAGE_TYPES.REQUEST, from: 'A', to: 'B', conversationId: 'conv-1' });
      proto.send({ type: MESSAGE_TYPES.ACK, from: 'B', to: 'A', conversationId: 'conv-1', replyTo: 'x' });

      const conv = proto.getConversation('conv-1');
      expect(conv.length).toBe(2);
    });

    it('发布 PROTOCOL_MESSAGE_SENT 事件 / publishes event', () => {
      proto.send({ type: MESSAGE_TYPES.REQUEST, from: 'A', to: 'B' });
      const events = mockBus._published.filter(e => e.topic === 'protocol.message.sent');
      expect(events.length).toBe(1);
    });

    it('更新统计 / updates statistics', () => {
      proto.send({ type: MESSAGE_TYPES.REQUEST, from: 'A', to: 'B' });
      proto.send({ type: MESSAGE_TYPES.COMMIT, from: 'B', to: 'A' });

      const stats = proto.getStats();
      expect(stats.totalMessages).toBe(2);
      expect(stats.byType.REQUEST).toBe(1);
      expect(stats.byType.COMMIT).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 快捷方法 / Shorthand Methods
  // ═══════════════════════════════════════════════════════════════════════

  describe('shorthand methods', () => {
    it('request / sends REQUEST', () => {
      const msg = proto.request('MPU-T', 'D1', { goal: '调研API' });
      expect(msg.type).toBe('REQUEST');
      expect(msg.payload.task.goal).toBe('调研API');
    });

    it('commit / sends COMMIT', () => {
      const req = proto.request('MPU-T', 'D1', { goal: '任务' }, 'conv-1');
      const msg = proto.commit('D1', 'MPU-T', req.messageId, { steps: 3 }, 'conv-1');
      expect(msg.type).toBe('COMMIT');
      expect(msg.replyTo).toBe(req.messageId);
    });

    it('ack / sends ACK', () => {
      const msg = proto.ack('D1', 'MPU-T', 'msg-123', 'conv-1');
      expect(msg.type).toBe('ACK');
      expect(msg.replyTo).toBe('msg-123');
    });

    it('delegate / sends DELEGATE', () => {
      const msg = proto.delegate('D1', 'D3', 'req-1', '此任务需要代码实现', { goal: '编码' });
      expect(msg.type).toBe('DELEGATE');
      expect(msg.reason).toBe('此任务需要代码实现');
    });

    it('escalate / sends ESCALATE', () => {
      const msg = proto.escalate('D1', 'MPU-T', '任务超出能力范围', { attempts: 3 });
      expect(msg.type).toBe('ESCALATE');
      expect(msg.reason).toContain('超出能力');
    });

    it('reject / sends REJECT', () => {
      const msg = proto.reject('D2', 'MPU-T', 'req-1', '不具备所需技能');
      expect(msg.type).toBe('REJECT');
      expect(msg.reason).toContain('技能');
    });

    it('revise / sends REVISE', () => {
      const msg = proto.revise('D2', 'D3', 'report-1', '代码质量不达标', { fixes: ['增加错误处理'] });
      expect(msg.type).toBe('REVISE');
      expect(msg.payload.suggestions.fixes[0]).toContain('错误处理');
    });

    it('repair / sends REPAIR', () => {
      const msg = proto.repair('D3', 'MPU-T', {
        failurePattern: 'ECONNREFUSED',
        strategy: 'retry with backoff',
        result: 'success',
      });
      expect(msg.type).toBe('REPAIR');
      expect(msg.payload.repair.failurePattern).toBe('ECONNREFUSED');
    });

    it('report / sends REPORT', () => {
      const req = proto.request('MPU-T', 'D1', { goal: '调研' }, 'conv-2');
      const msg = proto.report('D1', 'MPU-T', req.messageId, { data: '调研结果' }, 'conv-2');
      expect(msg.type).toBe('REPORT');
      expect(msg.replyTo).toBe(req.messageId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 查询 / Query
  // ═══════════════════════════════════════════════════════════════════════

  describe('query', () => {
    it('getConversation 返回会话消息 / returns conversation messages', () => {
      proto.request('A', 'B', { goal: 'task' }, 'conv-q');
      proto.ack('B', 'A', 'x', 'conv-q');

      const msgs = proto.getConversation('conv-q');
      expect(msgs.length).toBe(2);
      expect(msgs[0].type).toBe('REQUEST');
      expect(msgs[1].type).toBe('ACK');
    });

    it('getConversation 不存在返回空数组 / unknown returns empty', () => {
      expect(proto.getConversation('nonexistent')).toEqual([]);
    });

    it('getMessagesByType 过滤消息类型 / filters by type', () => {
      proto.request('A', 'B', {}, 'conv-t');
      proto.request('A', 'C', {}, 'conv-t');
      proto.ack('B', 'A', 'x', 'conv-t');

      const requests = proto.getMessagesByType('conv-t', MESSAGE_TYPES.REQUEST);
      expect(requests.length).toBe(2);

      const acks = proto.getMessagesByType('conv-t', MESSAGE_TYPES.ACK);
      expect(acks.length).toBe(1);
    });

    it('getReplyChain 追溯回复链 / traces reply chain', () => {
      const req = proto.request('MPU-T', 'D1', { goal: 'task' }, 'conv-chain');
      const commit = proto.commit('D1', 'MPU-T', req.messageId, {}, 'conv-chain');
      const report = proto.report('D1', 'MPU-T', commit.messageId, { done: true }, 'conv-chain');

      const chain = proto.getReplyChain('conv-chain', report.messageId);
      expect(chain.length).toBe(3);
      expect(chain[0].type).toBe('REPORT');
      expect(chain[1].type).toBe('COMMIT');
      expect(chain[2].type).toBe('REQUEST');
    });

    it('getAgentConversations 返回 agent 参与的会话 / returns agent conversations', () => {
      proto.request('MPU-T', 'D1', {}, 'conv-a1');
      proto.request('MPU-T', 'D2', {}, 'conv-a2');
      proto.request('D1', 'D3', {}, 'conv-a3');

      const d1Convs = proto.getAgentConversations('D1');
      expect(d1Convs.length).toBe(2); // conv-a1 (as receiver), conv-a3 (as sender)
      expect(d1Convs).toContain('conv-a1');
      expect(d1Convs).toContain('conv-a3');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 协议验证 / Protocol Validation
  // ═══════════════════════════════════════════════════════════════════════

  describe('validateConversation', () => {
    it('合法会话通过验证 / valid conversation passes', () => {
      const req = proto.request('MPU-T', 'D1', { goal: 'task' }, 'conv-v1');
      proto.commit('D1', 'MPU-T', req.messageId, {}, 'conv-v1');
      proto.report('D1', 'MPU-T', req.messageId, { done: true }, 'conv-v1');

      const result = proto.validateConversation('conv-v1');
      expect(result.valid).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    it('COMMIT 无 replyTo → 违规 / COMMIT without replyTo → violation', () => {
      proto.send({
        type: MESSAGE_TYPES.COMMIT,
        from: 'D1',
        to: 'MPU-T',
        conversationId: 'conv-v2',
        // 没有 replyTo
      });

      const result = proto.validateConversation('conv-v2');
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toContain('COMMIT');
    });

    it('ACK 无 replyTo → 违规 / ACK without replyTo → violation', () => {
      proto.send({
        type: MESSAGE_TYPES.ACK,
        from: 'D1',
        to: 'MPU-T',
        conversationId: 'conv-v3',
      });

      const result = proto.validateConversation('conv-v3');
      expect(result.valid).toBe(false);
    });

    it('不存在的会话 → 通过 / nonexistent → valid', () => {
      expect(proto.validateConversation('nonexistent').valid).toBe(true);
    });

    it('COMMIT 回复非 REQUEST → 违规 / COMMIT replying to non-REQUEST → violation', () => {
      const ack = proto.send({
        type: MESSAGE_TYPES.ACK,
        from: 'D1',
        to: 'MPU-T',
        conversationId: 'conv-v4',
        replyTo: 'some-msg',
      });
      proto.send({
        type: MESSAGE_TYPES.COMMIT,
        from: 'D1',
        to: 'MPU-T',
        conversationId: 'conv-v4',
        replyTo: ack.messageId, // replyTo 指向 ACK 而非 REQUEST
      });

      const result = proto.validateConversation('conv-v4');
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes('expected REQUEST'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 端到端工作流 / E2E Workflow
  // ═══════════════════════════════════════════════════════════════════════

  describe('e2e workflow', () => {
    it('完整 REQUEST-COMMIT-REPORT 流程 / full request-commit-report flow', () => {
      const convId = 'workflow-1';

      // MPU-T 发送任务请求给 D1
      const req = proto.request('MPU-T', 'D1', { goal: '调研Tushare API' }, convId);
      expect(req.type).toBe('REQUEST');

      // D1 确认接收
      const ackMsg = proto.ack('D1', 'MPU-T', req.messageId, convId);
      expect(ackMsg.type).toBe('ACK');

      // D1 承诺执行
      const commitMsg = proto.commit('D1', 'MPU-T', req.messageId, { steps: ['调研', '验证'] }, convId);
      expect(commitMsg.type).toBe('COMMIT');

      // D1 报告结果
      const reportMsg = proto.report('D1', 'MPU-T', req.messageId, {
        data: 'API 支持 daily/weekly/monthly',
      }, convId);
      expect(reportMsg.type).toBe('REPORT');

      // 验证会话
      const conv = proto.getConversation(convId);
      expect(conv.length).toBe(4);

      const validation = proto.validateConversation(convId);
      expect(validation.valid).toBe(true);
    });

    it('REQUEST-REJECT-DELEGATE 流程 / request rejected and delegated', () => {
      const convId = 'workflow-2';

      const req = proto.request('MPU-T', 'D2', { goal: '编写代码' }, convId);
      const rejectMsg = proto.reject('D2', 'MPU-T', req.messageId, '我是审查蜂，不擅长编码', convId);
      proto.delegate('MPU-T', 'D3', req.messageId, '重新分配给工蜂', { goal: '编写代码' }, convId);

      const conv = proto.getConversation(convId);
      expect(conv.length).toBe(3);
      expect(conv[1].type).toBe('REJECT');
      expect(conv[2].type).toBe('DELEGATE');
    });

    it('REPORT-REVISE-REPAIR 修复循环 / review-revise-repair cycle', () => {
      const convId = 'workflow-3';

      const req = proto.request('MPU-T', 'D3', { goal: '实现功能' }, convId);
      const report1 = proto.report('D3', 'MPU-T', req.messageId, { code: '...' }, convId);

      // D2 审查后要求修订
      proto.revise('D2', 'D3', report1.messageId, '缺少错误处理', { fixes: ['增加 try-catch'] }, convId);

      // D3 修复后重新报告
      proto.repair('D3', 'D2', { failurePattern: '缺少错误处理', strategy: '增加 try-catch', result: 'done' }, convId);
      proto.report('D3', 'MPU-T', req.messageId, { code: '... with error handling' }, convId);

      const conv = proto.getConversation(convId);
      expect(conv.length).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getStats
  // ═══════════════════════════════════════════════════════════════════════

  describe('getStats', () => {
    it('返回综合统计 / returns comprehensive stats', () => {
      proto.request('A', 'B', {}, 'conv-s1');
      proto.commit('B', 'A', 'x', {}, 'conv-s1');
      proto.request('A', 'C', {}, 'conv-s2');

      const stats = proto.getStats();
      expect(stats.totalMessages).toBe(3);
      expect(stats.byType.REQUEST).toBe(2);
      expect(stats.byType.COMMIT).toBe(1);
      expect(stats.activeConversations).toBe(2);
      expect(stats.conversations).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 边界情况 / Edge Cases
  // ═══════════════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('无 messageBus 不影响功能 / works without messageBus', () => {
      const bareProto = new ProtocolSemantics({ logger });
      const msg = bareProto.request('A', 'B', { goal: 'test' });
      expect(msg.type).toBe('REQUEST');
    });

    it('超过 MAX_CONVERSATIONS 自动清理 / exceeding max conversations auto-cleanup', () => {
      for (let i = 0; i < 110; i++) {
        proto.request('A', 'B', {}, `conv-edge-${i}`);
      }
      expect(proto.getStats().activeConversations).toBeLessThanOrEqual(100);
    });

    it('getReplyChain 无匹配返回单条 / no match returns single entry', () => {
      const msg = proto.request('A', 'B', {}, 'conv-chain2');
      const chain = proto.getReplyChain('conv-chain2', msg.messageId);
      expect(chain.length).toBe(1);
      expect(chain[0].type).toBe('REQUEST');
    });
  });
});
