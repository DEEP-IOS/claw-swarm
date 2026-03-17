import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpawnClient } from '../../../src/bridge/session/spawn-client.js';

describe('SpawnClient', () => {
  let client;

  beforeEach(() => {
    client = new SpawnClient();
  });

  it('constructor defaults to 127.0.0.1:18789', () => {
    expect(client.getGatewayUrl()).toBe('http://127.0.0.1:18789');
  });

  it('constructor accepts custom config', () => {
    const c = new SpawnClient({ config: { gatewayHost: '10.0.0.1', gatewayPort: 9999 } });
    expect(c.getGatewayUrl()).toBe('http://10.0.0.1:9999');
  });

  it('spawn returns a unique agentId string', async () => {
    const id1 = await client.spawn({ role: 'coder', prompt: 'hello' });
    const id2 = await client.spawn({ role: 'reviewer', prompt: 'check' });
    expect(typeof id1).toBe('string');
    expect(id1).toMatch(/^agent-/);
    expect(id1).not.toBe(id2);
  });

  it('spawn uses 127.0.0.1:18789 not localhost', () => {
    // Verify the default gateway host
    expect(client._gatewayHost).toBe('127.0.0.1');
    expect(client._gatewayPort).toBe(18789);
    expect(client.getGatewayUrl()).not.toContain('localhost');
  });

  it('cancel marks agent as cancelled and returns true', async () => {
    const id = await client.spawn({ role: 'worker', prompt: 'task' });
    const cancelled = await client.cancel(id);
    expect(cancelled).toBe(true);
    expect(client.getStatus(id).status).toBe('cancelled');
    expect(client.getStats().cancelled).toBe(1);
  });

  it('cancel returns false for unknown agent', async () => {
    const result = await client.cancel('nonexistent');
    expect(result).toBe(false);
  });

  it('label truncates to 64 characters', async () => {
    const longLabel = 'A'.repeat(100);
    const id = await client.spawn({ role: 'worker', prompt: 'x', label: longLabel });
    const status = client.getStatus(id);
    expect(status.label.length).toBe(64);
  });

  it('long CJK label truncates correctly at 64 chars', async () => {
    const cjkLabel = '\u6D4B\u8BD5'.repeat(50); // 100 CJK chars
    const id = await client.spawn({ role: 'worker', prompt: 'x', label: cjkLabel });
    const status = client.getStatus(id);
    expect(status.label.length).toBe(64);
  });

  it('onEnded callback fires when agent completes', async () => {
    const id = await client.spawn({ role: 'worker', prompt: 'task' });
    const cb = vi.fn();
    client.onEnded(id, cb);

    client.notifyEnded(id, { success: true, output: 'done' });
    expect(cb).toHaveBeenCalledWith({ success: true, output: 'done' });
    expect(client.getStats().completed).toBe(1);
  });

  it('onEnded fires immediately if agent already ended', async () => {
    const id = await client.spawn({ role: 'worker', prompt: 'task' });
    client.notifyEnded(id, { success: true, output: 'fast' });

    const cb = vi.fn();
    client.onEnded(id, cb);
    expect(cb).toHaveBeenCalledWith({ success: true, output: 'fast' });
  });

  it('onEnded returns false for unknown agent', () => {
    expect(client.onEnded('ghost', vi.fn())).toBe(false);
  });

  it('getActiveAgents returns only running agents', async () => {
    const id1 = await client.spawn({ role: 'a', prompt: 'x' });
    const id2 = await client.spawn({ role: 'b', prompt: 'y' });
    await client.cancel(id1);

    const active = client.getActiveAgents();
    expect(active.length).toBe(1);
    expect(active[0].agentId).toBe(id2);
  });
});
