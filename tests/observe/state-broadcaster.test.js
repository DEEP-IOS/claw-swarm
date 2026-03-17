/**
 * StateBroadcaster unit tests
 * Tests SSE client management, broadcast delivery, rate limiting, and lifecycle.
 * @module tests/observe/state-broadcaster
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateBroadcaster } from '../../src/observe/broadcast/state-broadcaster.js';

// ── Mock factories ───────────────────────────────────────────────────────────

function createMockBus() {
  const handlers = new Map();
  return {
    publish: vi.fn((topic, data) => {
      (handlers.get(topic) || []).forEach(fn => fn(data));
    }),
    subscribe: vi.fn((topic, fn) => {
      if (!handlers.has(topic)) handlers.set(topic, []);
      handlers.get(topic).push(fn);
      return () => {};
    }),
    unsubscribe: vi.fn(),
    _handlers: handlers,
    _trigger(topic, data) {
      (handlers.get(topic) || []).forEach(fn => fn(data));
    },
  };
}

function createMockClient() {
  const written = [];
  return {
    writeHead: vi.fn(),
    write: vi.fn((data) => written.push(data)),
    end: vi.fn(),
    on: vi.fn(),
    _written: written,
  };
}

describe('StateBroadcaster', () => {
  let bus, broadcaster;

  beforeEach(() => {
    bus = createMockBus();
    broadcaster = new StateBroadcaster({ bus, config: { maxEventsPerSecond: 5 } });
  });

  // ── 1. Constructor ─────────────────────────────────────────────

  it('creates instance with empty clients set', () => {
    expect(broadcaster).toBeDefined();
    expect(broadcaster.getClientCount()).toBe(0);
    expect(broadcaster._clients).toBeInstanceOf(Set);
    expect(broadcaster._clients.size).toBe(0);
  });

  // ── 2. addClient ──────────────────────────────────────────────

  it('addClient adds client to set and sets SSE headers', () => {
    const client = createMockClient();
    broadcaster.addClient(client);

    expect(broadcaster.getClientCount()).toBe(1);
    expect(client.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    }));
    // Initial keepalive comment
    expect(client.write).toHaveBeenCalledWith(':ok\n\n');
    // Auto-remove on close
    expect(client.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  // ── 3. removeClient ───────────────────────────────────────────

  it('removeClient removes client from set', () => {
    const client = createMockClient();
    broadcaster.addClient(client);
    expect(broadcaster.getClientCount()).toBe(1);

    broadcaster.removeClient(client);
    expect(broadcaster.getClientCount()).toBe(0);
  });

  // ── 4. broadcast sends data to all clients ────────────────────

  it('broadcast sends SSE-formatted data to all connected clients', () => {
    const client1 = createMockClient();
    const client2 = createMockClient();
    broadcaster.addClient(client1);
    broadcaster.addClient(client2);

    broadcaster.broadcast('agent.spawned', { agentId: 'a1' });

    // Both clients should receive the broadcast (initial write + broadcast)
    // client.write calls: 1 for ':ok\n\n' + 1 for broadcast
    expect(client1.write).toHaveBeenCalledTimes(2);
    expect(client2.write).toHaveBeenCalledTimes(2);

    // Verify broadcast payload structure
    const lastPayload1 = client1._written[1];
    expect(lastPayload1).toContain('data:');
    expect(lastPayload1).toContain('agent.spawned');
    expect(lastPayload1).toContain('a1');

    const parsed = JSON.parse(lastPayload1.replace('data: ', '').trim());
    expect(parsed.topic).toBe('agent.spawned');
    expect(parsed.data).toEqual({ agentId: 'a1' });
    expect(parsed.ts).toBeGreaterThan(0);
  });

  // ── 5. broadcast removes dead clients on write error ──────────

  it('broadcast removes dead clients when write throws', () => {
    const goodClient = createMockClient();
    const deadClient = createMockClient();

    broadcaster.addClient(goodClient);
    broadcaster.addClient(deadClient);
    expect(broadcaster.getClientCount()).toBe(2);

    // Now make the dead client throw on subsequent writes (simulating disconnect)
    deadClient.write = vi.fn(() => { throw new Error('Connection reset'); });

    broadcaster.broadcast('agent.completed', { agentId: 'a2' });

    // Dead client should have been removed
    expect(broadcaster.getClientCount()).toBe(1);
    expect(broadcaster._clients.has(goodClient)).toBe(true);
    expect(broadcaster._clients.has(deadClient)).toBe(false);
  });

  // ── 6. start subscribes to bus topics ─────────────────────────

  it('start subscribes to SSE_TOPICS and V8 aliases on the bus', () => {
    broadcaster.start();

    // StateBroadcaster subscribes to 27 SSE_TOPICS + 5 EVENT_ALIASES = 32 subscriptions
    expect(bus.subscribe).toHaveBeenCalled();
    const subscribeCount = bus.subscribe.mock.calls.length;
    expect(subscribeCount).toBeGreaterThanOrEqual(27);

    // Verify specific topics are subscribed
    const subscribedTopics = bus.subscribe.mock.calls.map(c => c[0]);
    expect(subscribedTopics).toContain('agent.spawned');
    expect(subscribedTopics).toContain('field.signal.emitted');
    expect(subscribedTopics).toContain('quality.gate.evaluated');
  });

  // ── 7. stop unsubscribes and closes all clients ───────────────

  it('stop unsubscribes all listeners and closes all clients', () => {
    const client = createMockClient();
    broadcaster.addClient(client);
    broadcaster.start();

    broadcaster.stop();

    // All subscriptions should be unsubscribed
    expect(bus.unsubscribe).toHaveBeenCalled();
    const unsubCount = bus.unsubscribe.mock.calls.length;
    expect(unsubCount).toBeGreaterThanOrEqual(27);

    // Client should be ended and removed
    expect(client.end).toHaveBeenCalled();
    expect(broadcaster.getClientCount()).toBe(0);
  });

  // ── 8. getClientCount ─────────────────────────────────────────

  it('getClientCount returns correct count as clients are added/removed', () => {
    expect(broadcaster.getClientCount()).toBe(0);

    const c1 = createMockClient();
    const c2 = createMockClient();
    const c3 = createMockClient();

    broadcaster.addClient(c1);
    expect(broadcaster.getClientCount()).toBe(1);

    broadcaster.addClient(c2);
    broadcaster.addClient(c3);
    expect(broadcaster.getClientCount()).toBe(3);

    broadcaster.removeClient(c2);
    expect(broadcaster.getClientCount()).toBe(2);
  });

  // ── 9. Rate limiting for field.signal.emitted ─────────────────

  it('throttles field.signal.emitted after maxEventsPerSecond', () => {
    const client = createMockClient();
    broadcaster.addClient(client);

    // maxEventsPerSecond is 5 in our config
    // First 5 broadcasts should go through
    for (let i = 0; i < 5; i++) {
      broadcaster.broadcast('field.signal.emitted', { dim: 'task_load' });
    }
    // client writes: 1 initial + 5 broadcasts = 6
    expect(client.write).toHaveBeenCalledTimes(6);

    // 6th broadcast of field.signal.emitted should be throttled
    broadcaster.broadcast('field.signal.emitted', { dim: 'task_load' });
    // Still 6 — the 6th was dropped
    expect(client.write).toHaveBeenCalledTimes(6);

    // Non-field events are NOT throttled
    broadcaster.broadcast('agent.spawned', { agentId: 'a1' });
    expect(client.write).toHaveBeenCalledTimes(7);
  });

  // ── 10. getStats returns broadcast and throttle counts ────────

  it('getStats returns totalBroadcasts, throttled, and activeClients', () => {
    const client = createMockClient();
    broadcaster.addClient(client);

    // Send some regular broadcasts
    broadcaster.broadcast('agent.spawned', {});
    broadcaster.broadcast('agent.completed', {});

    // Send field.signal broadcasts to trigger throttling
    for (let i = 0; i < 7; i++) {
      broadcaster.broadcast('field.signal.emitted', { dim: 'error_rate' });
    }

    const stats = broadcaster.getStats();

    expect(stats.totalBroadcasts).toBeGreaterThanOrEqual(7); // 2 regular + 5 unthrottled field
    expect(stats.throttled).toBeGreaterThanOrEqual(2); // 2 throttled (6th and 7th out of 7)
    expect(stats.activeClients).toBe(1);
    expect(typeof stats.clientsServed).toBe('number');
    expect(stats.clientsServed).toBeGreaterThanOrEqual(1);
  });
});
