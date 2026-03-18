import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const wsModule = require('C:/Users/ASUS/AppData/Roaming/npm/node_modules/openclaw/node_modules/ws/index.js');
const WebSocket = wsModule.WebSocket || wsModule;
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const cfg = JSON.parse(readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8'));
const token = cfg.gateway?.auth?.token || '';
console.log('Token found:', token ? 'yes' : 'NO');

function sendReq(ws, method, params) {
  return new Promise((resolve, reject) => {
    const reqId = randomUUID();
    const timer = setTimeout(() => reject(new Error(method + ' timeout 15s')), 15000);
    const handler = (data) => {
      try {
        const f = JSON.parse(data.toString());
        if (f.type !== 'res' || f.id !== reqId) return;
        clearTimeout(timer);
        ws.removeListener('message', handler);
        if (f.ok) resolve(f.payload || {});
        else reject(new Error(f.error?.message || method + ' failed'));
      } catch {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'req', id: reqId, method, params }));
  });
}

// 1. Connect & Auth
const ws = new WebSocket('ws://127.0.0.1:18789');

ws.on('error', (err) => {
  console.error('WS error:', err.message);
  process.exit(1);
});

ws.on('open', () => console.log('WS connected'));

ws.on('message', async (data) => {
  const frame = JSON.parse(data.toString());

  if (frame.type === 'event' && frame.event === 'connect.challenge') {
    console.log('Got challenge, sending auth...');
    const connectReqId = randomUUID();

    const authHandler = async (data2) => {
      const f = JSON.parse(data2.toString());
      if (f.type !== 'res' || f.id !== connectReqId) return;
      ws.removeListener('message', authHandler);

      if (!f.ok) {
        console.error('Auth FAILED:', f.error?.message);
        process.exit(1);
      }

      console.log('Auth OK!');
      ws.removeAllListeners('message');

      // Run the test
      await runTest(ws);
    };

    ws.on('message', authHandler);
    ws.send(JSON.stringify({
      type: 'req', id: connectReqId, method: 'connect',
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'gateway-client', displayName: 'Claw-Swarm DiagTest', version: '6.4.0', platform: 'win32', mode: 'backend', instanceId: randomUUID() },
        role: 'operator', scopes: ['operator.admin'],
        auth: { token }
      }
    }));
  }
});

async function runTest(ws) {
  const testKey = 'agent:mpu-d1:subagent:diag-' + randomUUID();

  // Step 1: sessions.patch
  console.log('\n=== Step 1: sessions.patch ===');
  console.log('Key:', testKey);
  try {
    const patchResult = await sendReq(ws, 'sessions.patch', { key: testKey, spawnDepth: 1 });
    console.log('OK:', JSON.stringify(patchResult).substring(0, 300));
  } catch (e) {
    console.error('FAILED:', e.message);
  }

  // Step 2: agent call
  console.log('\n=== Step 2: agent ===');
  try {
    const agentResult = await sendReq(ws, 'agent', {
      message: 'Reply with exactly: DIAG_OK. Nothing else.',
      sessionKey: testKey,
      idempotencyKey: randomUUID(),
      deliver: false,
      lane: 'subagent',
      timeout: 60,
      label: 'diag-test',
    });
    console.log('OK:', JSON.stringify(agentResult).substring(0, 500));
  } catch (e) {
    console.error('FAILED:', e.message);
  }

  // Step 3: Wait & check
  console.log('\n=== Step 3: Wait 20s then check session ===');
  await new Promise(r => setTimeout(r, 20000));

  try {
    const session = await sendReq(ws, 'sessions.get', { key: testKey });
    const msgs = session?.messages || [];
    console.log('Message count:', msgs.length);
    for (const m of msgs) {
      const text = Array.isArray(m.content)
        ? m.content.map(c => c.text || '').join('')
        : (m.content || '');
      console.log(`  [${m.role}] stopReason=${m.stopReason || 'none'} text="${text.substring(0, 150)}"`);
    }
    if (msgs.length === 0) {
      console.log('WARNING: No messages! LLM did not process the request.');
    }
  } catch (e) {
    console.error('sessions.get FAILED:', e.message);
  }

  ws.close();
  console.log('\n=== Done ===');
  process.exit(0);
}
