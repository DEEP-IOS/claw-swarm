/**
 * 测试 Node.js 内置 WebSocket + 适配器是否能正常连接 Gateway
 * Tests whether Node.js native WebSocket with adapter can connect to Gateway
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const cfg = JSON.parse(readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8'));
const token = cfg.gateway?.auth?.token || '';
console.log('Token:', token ? 'found' : 'MISSING');
console.log('globalThis.WebSocket:', typeof globalThis.WebSocket);

if (!globalThis.WebSocket) {
  console.error('FATAL: No built-in WebSocket in this Node.js version');
  process.exit(1);
}

// ── 适配器 (从 swarm-relay-client.js 复制) ──
function _createAdaptedWebSocket(NativeWS) {
  function AdaptedWebSocket(url) {
    const ws = new NativeWS(url);
    const _listeners = new Map();
    ws.on = (event, fn) => {
      const wrapped = (e) => {
        if (event === 'message') fn(e.data ?? e);
        else if (event === 'error') fn(e.error ?? e);
        else fn(e);
      };
      if (!_listeners.has(event)) _listeners.set(event, new Set());
      _listeners.get(event).add({ original: fn, wrapped });
      ws.addEventListener(event, wrapped);
    };
    ws.removeListener = (event, fn) => {
      const set = _listeners.get(event);
      if (!set) return;
      for (const entry of set) {
        if (entry.original === fn) {
          ws.removeEventListener(event, entry.wrapped);
          set.delete(entry);
          break;
        }
      }
    };
    ws.removeAllListeners = (event) => {
      const set = _listeners.get(event);
      if (!set) return;
      for (const entry of set) {
        ws.removeEventListener(event, entry.wrapped);
      }
      set.clear();
    };
    return ws;
  }
  AdaptedWebSocket.CONNECTING = NativeWS.CONNECTING ?? 0;
  AdaptedWebSocket.OPEN = NativeWS.OPEN ?? 1;
  AdaptedWebSocket.CLOSING = NativeWS.CLOSING ?? 2;
  AdaptedWebSocket.CLOSED = NativeWS.CLOSED ?? 3;
  return AdaptedWebSocket;
}

const WS = _createAdaptedWebSocket(globalThis.WebSocket);

function sendReq(ws, method, params) {
  return new Promise((resolve, reject) => {
    const reqId = randomUUID();
    const timer = setTimeout(() => reject(new Error(method + ' timeout 15s')), 15000);
    const handler = (data) => {
      try {
        const frame = JSON.parse(data.toString());
        if (frame.type !== 'res' || frame.id !== reqId) return;
        clearTimeout(timer);
        ws.removeListener('message', handler);
        if (frame.ok) resolve(frame.payload || {});
        else reject(new Error(frame.error?.message || method + ' failed'));
      } catch (e) {
        console.error('Parse error:', e.message, 'data type:', typeof data, 'data:', String(data).substring(0, 100));
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'req', id: reqId, method, params }));
  });
}

// ── 连接 ──
const ws = new WS('ws://127.0.0.1:18789');

ws.on('open', () => console.log('WS connected'));
ws.on('error', (err) => {
  console.error('WS error:', err?.message || err);
  process.exit(1);
});

ws.on('message', async (data) => {
  console.log('First message type:', typeof data, '| preview:', String(data).substring(0, 100));

  let frame;
  try {
    frame = JSON.parse(data.toString());
  } catch (e) {
    console.error('Cannot parse first message:', e.message);
    console.error('Raw data:', data);
    process.exit(1);
  }

  if (frame.type === 'event' && frame.event === 'connect.challenge') {
    console.log('Got challenge, sending auth...');
    const connectReqId = randomUUID();

    const authHandler = async (data2) => {
      let f;
      try {
        f = JSON.parse(data2.toString());
      } catch (e) {
        console.error('Cannot parse auth response:', e.message, 'type:', typeof data2);
        return;
      }
      if (f.type !== 'res' || f.id !== connectReqId) return;
      ws.removeListener('message', authHandler);

      if (!f.ok) {
        console.error('Auth FAILED:', f.error?.message);
        process.exit(1);
      }

      console.log('Auth OK!');
      ws.removeAllListeners('message');
      await runTest(ws);
    };

    ws.on('message', authHandler);
    ws.send(JSON.stringify({
      type: 'req', id: connectReqId, method: 'connect',
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'gateway-client', displayName: 'DiagNativeWS', version: '6.4.0', platform: 'win32', mode: 'backend', instanceId: randomUUID() },
        role: 'operator', scopes: ['operator.admin'],
        auth: { token }
      }
    }));
  }
});

async function runTest(ws) {
  const testKey = 'agent:mpu-d1:subagent:native-' + randomUUID();

  console.log('\n=== sessions.patch ===');
  try {
    const r = await sendReq(ws, 'sessions.patch', { key: testKey, spawnDepth: 1 });
    console.log('OK:', JSON.stringify(r).substring(0, 200));
  } catch (e) {
    console.error('FAILED:', e.message);
  }

  console.log('\n=== agent ===');
  try {
    const r = await sendReq(ws, 'agent', {
      message: 'Reply EXACTLY: NATIVE_WS_OK',
      sessionKey: testKey,
      idempotencyKey: randomUUID(),
      deliver: false,
      lane: 'subagent',
      timeout: 60,
      label: 'diag-native',
    });
    console.log('OK:', JSON.stringify(r).substring(0, 300));
  } catch (e) {
    console.error('FAILED:', e.message);
  }

  console.log('\n=== Wait 15s then check ===');
  await new Promise(r => setTimeout(r, 15000));

  try {
    const s = await sendReq(ws, 'sessions.get', { key: testKey });
    const msgs = s?.messages || [];
    console.log('Messages:', msgs.length);
    for (const m of msgs) {
      const t = Array.isArray(m.content) ? m.content.map(c => c.text || '').join('') : (m.content || '');
      console.log(`  [${m.role}] stop=${m.stopReason || '-'} "${t.substring(0, 100)}"`);
    }
  } catch (e) {
    console.error('FAILED:', e.message);
  }

  try { ws.close(); } catch {}
  console.log('\n=== Done ===');
  process.exit(0);
}
