/**
 * Communication subsystem integration tests
 * End-to-end scenarios: pheromone -> field, stigmergy -> gossip, channel -> coordination
 * @module tests/communication/integration.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SignalStore } from '../../src/core/field/signal-store.js'
import { EventBus } from '../../src/core/bus/event-bus.js'
import { DomainStore } from '../../src/core/store/domain-store.js'
import { PheromoneEngine } from '../../src/communication/pheromone/pheromone-engine.js'
import { TaskChannel } from '../../src/communication/channel/task-channel.js'
import { StigmergicBoard } from '../../src/communication/stigmergy/stigmergic-board.js'
import { GossipProtocol } from '../../src/communication/stigmergy/gossip-protocol.js'
import { DIM_TRAIL, DIM_ALARM, DIM_KNOWLEDGE, DIM_COORDINATION } from '../../src/core/field/types.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('Communication Integration', () => {
  let eventBus, field

  beforeEach(() => {
    eventBus = new EventBus()
    field = new SignalStore({ eventBus })
  })

  afterEach(async () => {
    await field.stop()
  })

  // ── Scenario 1: trail deposit -> acoSelect bias ────────────

  describe('trail pheromone influences acoSelect', () => {
    it('candidate with stronger trail is selected more often', () => {
      const engine = new PheromoneEngine({ field, eventBus })

      // Agent-A leaves strong trail, Agent-B leaves weak trail
      engine.deposit('trail', 'task:T1:cand-A', 0.8, {}, 'agent-A')
      engine.deposit('trail', 'task:T1:cand-B', 0.2, {}, 'agent-B')

      const counts = { 'cand-A': 0, 'cand-B': 0 }
      for (let i = 0; i < 100; i++) {
        const winner = engine.acoSelect(
          [{ id: 'cand-A', eta: 1 }, { id: 'cand-B', eta: 1 }],
          'task:T1',
        )
        counts[winner.id]++
      }

      // cand-A has tau=0.8, cand-B has tau=0.2 → cand-A should win more
      expect(counts['cand-A']).toBeGreaterThan(counts['cand-B'])

      engine.stop()
    })
  })

  // ── Scenario 2: stigmergic write -> gossip delay -> visible ─

  describe('stigmergic board + gossip delay', () => {
    let tmpDir

    beforeEach(async () => {
      tmpDir = await mkdtemp(path.join(tmpdir(), 'integ-stigmergy-'))
    })

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true })
    })

    it('cross-session agent cannot read until gossip delay passes', () => {
      vi.useFakeTimers()
      try {
        const ROUND = 100
        const gossip = new GossipProtocol({ eventBus, roundDurationMs: ROUND })
        const domainStore = new DomainStore({ domain: 'integ', snapshotDir: tmpDir })
        const board = new StigmergicBoard({ domainStore, field, eventBus, gossipProtocol: gossip })

        gossip.registerAgent('agent-A', { session: 'sess-1', scope: 'global' })
        gossip.registerAgent('agent-B', { session: 'sess-2', scope: 'global' })

        board.write('agent-A', 'discovery-X', 'some insight', { scope: 'global', session: 'sess-1' })

        // agent-B in different session+scope -> global delay = 3 rounds
        expect(board.read('discovery-X', 'agent-B')).toBeUndefined()

        vi.advanceTimersByTime(3 * ROUND)
        const entry = board.read('discovery-X', 'agent-B')
        expect(entry).toBeDefined()
        expect(entry.value).toBe('some insight')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // ── Scenario 3: channel message -> DIM_COORDINATION signal ─

  describe('TaskChannel emits coordination signal', () => {
    it('post message creates DIM_COORDINATION signal in field', () => {
      const channel = new TaskChannel({
        channelId: 'ch-integ-1',
        field,
        eventBus,
      })

      channel.join('agent-1')
      channel.post('agent-1', { type: 'finding', data: 'found a bug' })

      const signals = field.query({ dimension: DIM_COORDINATION })
      const match = signals.find(s => s.scope === 'ch-integ-1')
      expect(match).toBeDefined()
      expect(match._actualStrength).toBeGreaterThan(0)

      channel.close()
    })
  })

  // ── Scenario 4: alarm deposit -> DIM_ALARM in field ────────

  describe('alarm pheromone -> DIM_ALARM signal', () => {
    it('deposited alarm is readable from field and readAll', () => {
      const engine = new PheromoneEngine({ field, eventBus })

      engine.deposit('alarm', 'task:critical', 0.9, {}, 'detector-1')

      const signals = field.query({ dimension: DIM_ALARM })
      expect(signals.length).toBeGreaterThanOrEqual(1)
      const alarmSig = signals.find(s => s.scope === 'task:critical')
      expect(alarmSig).toBeDefined()
      expect(alarmSig._actualStrength).toBeGreaterThan(0)

      const all = engine.readAll('task:critical')
      expect(all.alarm).toBeGreaterThan(0)

      engine.stop()
    })
  })

  // ── Scenario 5: 6 pheromone types -> field dimension mapping ─

  describe('6 pheromone types map to correct field dimensions', () => {
    /** @type {Record<string, string>} expected mapping */
    const TYPE_TO_DIM = {
      trail:   DIM_TRAIL,
      alarm:   DIM_ALARM,
      recruit: DIM_COORDINATION,
      queen:   DIM_COORDINATION,
      dance:   DIM_KNOWLEDGE,
      food:    DIM_TRAIL,
    }

    it('each pheromone type deposits a signal in its mapped dimension', () => {
      const engine = new PheromoneEngine({ field, eventBus })

      for (const [type, expectedDim] of Object.entries(TYPE_TO_DIM)) {
        const scope = `mapping-test:${type}`
        engine.deposit(type, scope, 0.5, {}, 'sys')

        const signals = field.query({ dimension: expectedDim, scope })
        const match = signals.find(s => s.metadata?.pheromoneType === type)
        expect(match, `${type} should produce signal in ${expectedDim}`).toBeDefined()
      }

      engine.stop()
    })
  })
})
