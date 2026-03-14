import { describe, it, expect, vi } from 'vitest';
import { SwarmRelayClient } from '../../../src/L2-communication/swarm-relay-client.js';

function makeClient(opts = {}) {
  return new SwarmRelayClient({
    gatewayUrl: 'http://127.0.0.1:18789',
    gatewayToken: 'token',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...opts,
  });
}

describe('SwarmRelayClient spawn attachment policy', () => {
  it('detaches subagent from parent session by default', async () => {
    const client = makeClient();
    client.setParentSessionKey('agent:main:parent');

    const ws = {};
    const sent = [];
    client._connectAndAuth = vi.fn(async () => ws);
    client._sendRequest = vi.fn(async (_ws, method, params) => {
      sent.push({ method, params });
      if (method === 'agent') return { runId: 'run-1' };
      return {};
    });
    client._closeWs = vi.fn();

    const result = await client._spawnDirect('agent:mpu-d1:subagent:abc', {
      agentId: 'mpu-d1',
      task: 'do work',
      model: 'openai/gpt-5',
      timeoutSeconds: 120,
      label: 'swarm:task-x:mpu-d1:dag-x:phase-1',
    });

    expect(result.status).toBe('spawned');
    const agentCall = sent.find((x) => x.method === 'agent');
    expect(agentCall).toBeTruthy();
    expect(agentCall.params.spawnedBy).toBeUndefined();
  });

  it('can preserve parent-child attachment when explicitly configured', async () => {
    const client = makeClient({ detachSubagentsOnParentDisconnect: false });
    client.setParentSessionKey('agent:main:parent');

    const ws = {};
    const sent = [];
    client._connectAndAuth = vi.fn(async () => ws);
    client._sendRequest = vi.fn(async (_ws, method, params) => {
      sent.push({ method, params });
      if (method === 'agent') return { runId: 'run-2' };
      return {};
    });
    client._closeWs = vi.fn();

    await client._spawnDirect('agent:mpu-d2:subagent:def', {
      agentId: 'mpu-d2',
      task: 'do work',
      model: null,
      timeoutSeconds: 60,
      label: 'swarm:task-y:mpu-d2:dag-y:phase-1',
    });

    const agentCall = sent.find((x) => x.method === 'agent');
    expect(agentCall.params.spawnedBy).toBe('agent:main:parent');
  });
});
