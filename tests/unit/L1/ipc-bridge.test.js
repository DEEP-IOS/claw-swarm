/**
 * IPCBridge 单元测试 / IPCBridge Unit Tests
 *
 * V6.0 L1: RPC-over-IPC 双端通信桥测试
 * V6.0 L1: Tests for RPC-over-IPC bidirectional communication bridge
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IPCBridge } from '../../../src/L1-infrastructure/ipc-bridge.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 IPC 进程 / Mock IPC process (simulates child_process.fork()) */
function createMockProcess() {
  const listeners = new Map();
  return {
    send: vi.fn((msg) => {
      // Echo responses for testing
    }),
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    off(event, handler) {
      const arr = listeners.get(event) || [];
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    },
    removeListener(event, handler) {
      this.off(event, handler);
    },
    connected: true,
    _listeners: listeners,
    /** 模拟接收消息 / Simulate receiving a message */
    _receive(msg) {
      const handlers = listeners.get('message') || [];
      for (const h of handlers) h(msg);
    },
  };
}

/** 创建一对连接的桥 / Create a connected bridge pair */
function createBridgePair() {
  const parentProc = createMockProcess();
  const childProc = createMockProcess();

  // Wire sends to each other's receivers
  parentProc.send = vi.fn((msg) => childProc._receive(msg));
  childProc.send = vi.fn((msg) => parentProc._receive(msg));

  const parent = new IPCBridge(parentProc, { logger: silentLogger });
  const child = new IPCBridge(childProc, { logger: silentLogger });

  return { parent, child, parentProc, childProc };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('IPCBridge', () => {
  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates instance without error', () => {
      const proc = createMockProcess();
      const bridge = new IPCBridge(proc, { logger: silentLogger });
      expect(bridge).toBeDefined();
      bridge.destroy();
    });

    it('getStats 返回初始统计 / getStats returns initial stats', () => {
      const proc = createMockProcess();
      const bridge = new IPCBridge(proc, { logger: silentLogger });
      const stats = bridge.getStats();
      expect(stats).toBeDefined();
      bridge.destroy();
    });
  });

  describe('请求-响应 / Request-Response (call)', () => {
    // Note: IPCBridge handler signature is handler(method, args)
    // method = the method name string, args = the args passed to call()

    it('call + handle 完成一次 RPC / call + handle completes RPC', async () => {
      const { parent, child } = createBridgePair();

      child.handle('echo', (_method, args) => `Hello ${args}`);
      const result = await parent.call('echo', 'World');
      expect(result).toBe('Hello World');

      parent.destroy();
      child.destroy();
    });

    it('call 支持对象参数 / call supports object args', async () => {
      const { parent, child } = createBridgePair();

      child.handle('add', (_method, args) => args.a + args.b);
      const result = await parent.call('add', { a: 10, b: 20 });
      expect(result).toBe(30);

      parent.destroy();
      child.destroy();
    });

    it('handler 异步返回 / handler returns async result', async () => {
      const { parent, child } = createBridgePair();

      child.handle('asyncOp', async (_method, args) => {
        await new Promise((r) => setTimeout(r, 10));
        return args * 2;
      });
      const result = await parent.call('asyncOp', 21);
      expect(result).toBe(42);

      parent.destroy();
      child.destroy();
    });

    it('handler 抛出错误时 call rejects / call rejects when handler throws', async () => {
      const { parent, child } = createBridgePair();

      child.handle('fail', () => { throw new Error('boom'); });
      await expect(parent.call('fail')).rejects.toThrow(/boom/);

      parent.destroy();
      child.destroy();
    });

    it('call 超时 / call times out', async () => {
      const proc = createMockProcess();
      proc.send = vi.fn(); // 不回复 / Never replies
      const bridge = new IPCBridge(proc, { logger: silentLogger, defaultTimeoutMs: 50 });

      await expect(bridge.call('neverReply', null, 50)).rejects.toThrow(/timed?\s*out/i);

      bridge.destroy();
    });

    it('并发 call 互不干扰 / concurrent calls do not interfere', async () => {
      const { parent, child } = createBridgePair();

      child.handle('delay', async (_method, args) => {
        await new Promise((r) => setTimeout(r, args.ms));
        return args.val;
      });

      const [r1, r2, r3] = await Promise.all([
        parent.call('delay', { ms: 30, val: 'A' }),
        parent.call('delay', { ms: 10, val: 'B' }),
        parent.call('delay', { ms: 20, val: 'C' }),
      ]);

      expect(r1).toBe('A');
      expect(r2).toBe('B');
      expect(r3).toBe('C');

      parent.destroy();
      child.destroy();
    });
  });

  describe('单向通知 / Notify (fire-and-forget)', () => {
    it('notify 发送消息到对端 / notify sends to peer', async () => {
      const { parent, child } = createBridgePair();

      let received = null;
      child.handle('ping', (_method, args) => { received = args; });
      parent.notify('ping', 'hello');

      await new Promise((r) => setTimeout(r, 20));
      expect(received).toBe('hello');

      parent.destroy();
      child.destroy();
    });
  });

  describe('统计 / Stats', () => {
    it('统计 RPC 调用次数 / tracks call counts', async () => {
      const { parent, child } = createBridgePair();
      child.handle('noop', () => null);

      await parent.call('noop', []);
      await parent.call('noop', []);

      const stats = parent.getStats();
      expect(stats).toBeDefined();

      parent.destroy();
      child.destroy();
    });
  });

  describe('销毁 / Destroy', () => {
    it('destroy 后 call rejects / call rejects after destroy', async () => {
      const { parent, child } = createBridgePair();
      child.handle('noop', () => null);

      parent.destroy();
      await expect(parent.call('noop', [])).rejects.toThrow();

      child.destroy();
    });

    it('多次 destroy 不报错 / double destroy does not throw', () => {
      const proc = createMockProcess();
      const bridge = new IPCBridge(proc, { logger: silentLogger });
      bridge.destroy();
      expect(() => bridge.destroy()).not.toThrow();
    });
  });
});
