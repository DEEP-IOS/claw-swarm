/**
 * 端到端诊断：发送触发 swarm_run 的消息给主代理，然后监控 relay 统计变化
 * End-to-end diagnostic: sends a message to main agent that should trigger swarm_run,
 * then monitors relay stats for changes.
 *
 * Usage: node tools/diag-e2e-swarm.mjs
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const stateDir = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
const cfg = JSON.parse(readFileSync(join(stateDir, 'openclaw.json'), 'utf8'));
const token = cfg.gateway?.auth?.token || '';
console.log('Token:', token ? 'found' : 'MISSING');

// ── Step 0: 检查初始 relay stats ──
async function getRelayStats() {
  try {
    const resp = await fetch('http://127.0.0.1:19100/api/v1/subagent-stats');
    return await resp.json();
  } catch (e) {
    console.error('Cannot reach dashboard:', e.message);
    return null;
  }
}

async function main() {
  console.log('\n=== Step 0: Initial relay stats ===');
  const before = await getRelayStats();
  if (before) {
    console.log('callAttempts:', before.relayDiag?.internalStats?.callAttempts);
    console.log('spawned:', before.relayDiag?.internalStats?.spawned);
    console.log('parentSessionKey:', before.relayDiag?.parentSessionKey);
    console.log('hasOnSpawned:', before.relayDiag?.hasOnSpawned);
  }

  // ── Step 1: 发送 swarm 触发消息 ──
  console.log('\n=== Step 1: Sending agent message (swarm trigger) ===');
  const testKey = 'agent:main:main'; // Main agent session
  const agentReqId = randomUUID();

  const WS = globalThis.WebSocket;
  if (!WS) {
    console.error('FATAL: No WebSocket');
    process.exit(1);
  }

  const ws = new WS('ws://127.0.0.1:18789');

  ws.addEventListener('error', (err) => {
    console.error('WS error:', err.message || err);
    process.exit(1);
  });

  ws.addEventListener('open', () => console.log('WS connected'));

  // Promise-based message exchange
  function sendReq(method, params) {
    return new Promise((resolve, reject) => {
      const reqId = randomUUID();
      const timer = setTimeout(() => reject(new Error(method + ' timeout 30s')), 30000);
      const handler = (evt) => {
        try {
          const frame = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
          if (frame.type !== 'res' || frame.id !== reqId) return;
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          if (frame.ok) resolve(frame.payload || {});
          else reject(new Error(frame.error?.message || method + ' failed'));
        } catch {}
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ type: 'req', id: reqId, method, params }));
    });
  }

  // Wait for challenge + auth
  await new Promise((resolve, reject) => {
    const challengeHandler = async (evt) => {
      const frame = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        ws.removeEventListener('message', challengeHandler);
        console.log('Got challenge, authenticating...');
        try {
          await sendReq('connect', {
            minProtocol: 3, maxProtocol: 3,
            client: { id: 'gateway-client', displayName: 'DiagE2E', version: '7.0.2', platform: 'win32', mode: 'backend', instanceId: randomUUID() },
            role: 'operator', scopes: ['operator.admin', 'operator.read', 'operator.write'],
            auth: { token },
          });
          console.log('Auth OK!');
          resolve();
        } catch (e) {
          reject(e);
        }
      }
    };
    ws.addEventListener('message', challengeHandler);
  });

  // 发送一条会触发 swarm_run 的消息
  // 使用明确的任务动词，确保不被 direct_reply 过滤
  console.log('\n=== Step 2: Sending swarm task message ===');
  try {
    const result = await sendReq('agent', {
      message: '请使用 swarm_run 工具帮我分析当前系统的健康状态，执行一个简单的系统诊断任务。',
      sessionKey: testKey,
      idempotencyKey: randomUUID(),
      deliver: false,
      lane: 'main',
      timeout: 120,
      label: 'diag-e2e-swarm',
    });
    console.log('Agent response:', JSON.stringify(result).substring(0, 500));
  } catch (e) {
    console.error('Agent call failed:', e.message);
  }

  // ── Step 3: 等待并检查 relay stats ──
  console.log('\n=== Step 3: Waiting 30s then checking relay stats ===');
  await new Promise(r => setTimeout(r, 30000));

  const after = await getRelayStats();
  if (after) {
    console.log('\n--- Relay Stats After ---');
    console.log('callAttempts:', after.relayDiag?.internalStats?.callAttempts);
    console.log('spawned:', after.relayDiag?.internalStats?.spawned);
    console.log('failed:', after.relayDiag?.internalStats?.failed);
    console.log('spawnErrors:', JSON.stringify(after.relayDiag?.internalStats?.spawnErrors));
    console.log('spawned count (outer):', after.spawned);
    console.log('succeeded:', after.succeeded);
    console.log('failed (outer):', after.failed);
  }

  // ── Step 4: 检查 session 获取 LLM 响应 ──
  console.log('\n=== Step 4: Check session messages ===');
  try {
    const session = await sendReq('sessions.get', { key: testKey });
    const msgs = session?.messages || [];
    console.log('Total messages:', msgs.length);
    // 只显示最后 5 条
    const recent = msgs.slice(-5);
    for (const m of recent) {
      const text = Array.isArray(m.content)
        ? m.content.map(c => c.text || (c.type === 'tool_use' ? `[tool_use: ${c.name}(${JSON.stringify(c.input).substring(0, 100)})]` : '')).join(' ')
        : (m.content || '');
      console.log(`  [${m.role}] stop=${m.stopReason || '-'} "${text.substring(0, 300)}"`);
    }
  } catch (e) {
    console.error('sessions.get failed:', e.message);
  }

  ws.close();
  console.log('\n=== Done ===');
  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
