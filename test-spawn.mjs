/**
 * Test script: OpenClaw Gateway subagent spawning
 *
 * Uses two channels:
 * 1. WebSocket — monitor real-time events (scopes not required for event broadcast)
 * 2. HTTP Hooks API — trigger agent spawning via POST /hooks/agent
 *
 * Tested against Gateway v2026.3.13 which requires device identity for WS scopes.
 * The hooks API uses a separate token (hooks.token) and bypasses WS scope restrictions.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// --- Config ---
const CONFIG_PATH = 'E:\\OpenClaw\\.openclaw\\openclaw.json';
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const GW_TOKEN = config.gateway.auth.token;
const HOOK_TOKEN = config.hooks.token;
const GW_PORT = config.gateway.port || 18789;
const GW_URL = `ws://127.0.0.1:${GW_PORT}`;
const GW_HTTP = `http://127.0.0.1:${GW_PORT}`;

console.log(`[config] Gateway WS:   ${GW_URL}`);
console.log(`[config] Gateway HTTP:  ${GW_HTTP}`);
console.log(`[config] GW Token:      ${GW_TOKEN.slice(0, 8)}...${GW_TOKEN.slice(-4)}`);
console.log(`[config] Hook Token:    ${HOOK_TOKEN.slice(0, 8)}...${HOOK_TOKEN.slice(-4)}`);

// --- Helpers ---
const rid = () => randomUUID();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ts() {
  return new Date().toISOString().slice(11, 23);
}

// --- HTTP helpers ---
async function httpPost(path, body, token = HOOK_TOKEN) {
  const resp = await fetch(`${GW_HTTP}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: resp.status, ok: resp.ok, data: json };
}

async function httpGet(path, token = HOOK_TOKEN) {
  const resp = await fetch(`${GW_HTTP}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: resp.status, ok: resp.ok, data: json };
}

// --- WebSocket event monitor ---
let eventCount = 0;
const ws = new WebSocket(GW_URL);

ws.addEventListener('open', () => {
  console.log(`\n[${ts()}] WS opened`);
});

ws.addEventListener('message', (event) => {
  const text = typeof event.data === 'string' ? event.data : event.data.toString();
  let msg;
  try { msg = JSON.parse(text); } catch { return; }

  // Handle challenge -> connect (for event monitoring only, no scopes needed)
  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    const connectMsg = {
      type: 'req',
      id: rid(),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'gateway-client',
          displayName: 'Spawn Test Monitor',
          version: '6.4.0',
          platform: 'win32',
          mode: 'backend',
          instanceId: rid()
        },
        role: 'operator',
        scopes: ['operator.admin'],
        auth: { token: GW_TOKEN }
      }
    };
    ws.send(JSON.stringify(connectMsg));
    return;
  }

  // Handle hello-ok
  if (msg.type === 'res' && msg.ok === true && msg.payload?.type === 'hello-ok') {
    console.log(`[${ts()}] WS connected (event monitor). Protocol: ${msg.payload.protocol}`);
    console.log(`[${ts()}] Note: WS scopes cleared (no device identity) - using HTTP hooks for RPC`);

    // Start the actual test
    runTest().catch(err => {
      console.error(`[${ts()}] Test error:`, err);
      process.exit(1);
    });
    return;
  }

  // Log interesting events (skip ticks and health pings)
  if (msg.type === 'event' && msg.event !== 'tick' && msg.event !== 'health') {
    eventCount++;
    const payloadStr = JSON.stringify(msg.payload || {}).slice(0, 600);
    console.log(`[${ts()}] EVENT #${eventCount}: ${msg.event}`);
    console.log(`[${ts()}]   payload: ${payloadStr}`);
  }

  // Also log session/agent events from health updates (less verbose)
  if (msg.type === 'event' && msg.event === 'health' && msg.payload?.sessions?.length > 0) {
    const sessions = msg.payload.sessions;
    console.log(`[${ts()}] HEALTH: ${sessions.length} active session(s): ${sessions.map(s => s.key || s.sessionKey || 'unknown').join(', ')}`);
  }
});

ws.addEventListener('error', (event) => {
  console.error(`[${ts()}] WS error:`, event.message || event.type);
});

ws.addEventListener('close', (event) => {
  console.log(`[${ts()}] WS closed: code=${event.code}`);
});

// --- Main test ---
async function runTest() {
  const targetAgentId = 'mpu-d3';

  console.log('\n' + '='.repeat(60));
  console.log('STEP 1: POST /hooks/agent — spawn a subagent via HTTP hooks');
  console.log('='.repeat(60));

  const spawnResult = await httpPost('/hooks/agent', {
    message: 'Say hello in one sentence. Then stop.',
    agentId: targetAgentId,
  });
  console.log(`[${ts()}] POST /hooks/agent response:`, JSON.stringify(spawnResult, null, 2));

  if (!spawnResult.ok) {
    console.log(`[${ts()}] Spawn failed, aborting test.`);
    ws.close();
    process.exit(1);
  }

  const runId = spawnResult.data.runId;
  console.log(`[${ts()}] Agent spawned: runId=${runId}`);

  // Wait for agent to process
  console.log(`\n[${ts()}] Waiting 20s for agent to process...`);
  console.log(`[${ts()}] (Watching WS events for real-time updates)`);
  await sleep(20000);

  console.log('\n' + '='.repeat(60));
  console.log('STEP 2: GET /health — check gateway state');
  console.log('='.repeat(60));

  const healthResult = await httpGet('/health');
  console.log(`[${ts()}] /health status=${healthResult.status}, ok=${healthResult.data?.ok}`);
  if (healthResult.data?.sessions) {
    console.log(`[${ts()}] Active sessions: ${healthResult.data.sessions.length}`);
    for (const s of healthResult.data.sessions) {
      console.log(`[${ts()}]   - ${s.key || s.sessionKey}: agent=${s.agentId}, status=${s.status || 'unknown'}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`STEP 3: POST /hooks/agent — send follow-up to ${targetAgentId}`);
  console.log('='.repeat(60));

  const followUp = await httpPost('/hooks/agent', {
    message: 'What is 2+2? Reply with just the number.',
    agentId: targetAgentId,
  });
  console.log(`[${ts()}] Follow-up response:`, JSON.stringify(followUp, null, 2));

  console.log(`\n[${ts()}] Waiting 15s for follow-up processing...`);
  await sleep(15000);

  console.log('\n' + '='.repeat(60));
  console.log('STEP 4: Check Swarm Dashboard API');
  console.log('='.repeat(60));

  // Check the claw-swarm dashboard for metrics
  try {
    const dashResp = await fetch('http://127.0.0.1:19100/api/v1/agents');
    const dashData = await dashResp.json();
    console.log(`[${ts()}] Dashboard /api/v1/agents:`, JSON.stringify(dashData, null, 2).slice(0, 500));
  } catch (err) {
    console.log(`[${ts()}] Dashboard not accessible: ${err.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`SUMMARY`);
  console.log('='.repeat(60));
  console.log(`Total WS events captured: ${eventCount}`);
  console.log(`Agent ID: ${targetAgentId}`);
  console.log(`Run ID: ${runId}`);
  console.log(`Follow-up Run ID: ${followUp.data?.runId || 'n/a'}`);

  console.log('\n' + '='.repeat(60));
  console.log('TEST COMPLETE');
  console.log('='.repeat(60));

  ws.close();
  setTimeout(() => process.exit(0), 2000);
}

// Safety timeout
setTimeout(() => {
  console.log(`\n[${ts()}] Global timeout (90s) reached, exiting.`);
  ws.close();
  process.exit(1);
}, 90000);
