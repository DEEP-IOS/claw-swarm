/**
 * LifecycleManager 单元测试
 * @module tests/intelligence/identity/lifecycle-manager.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LifecycleManager } from '../../../src/intelligence/identity/lifecycle-manager.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'
import { DomainStore } from '../../../src/core/store/domain-store.js'

describe('LifecycleManager', () => {
  let lm, signalStore, eventBus, domainStore

  beforeEach(() => {
    eventBus = new EventBus()
    signalStore = new SignalStore({ eventBus })
    domainStore = new DomainStore({ domain: 'lm-test', snapshotDir: '/tmp/lm-test' })
    lm = new LifecycleManager({ signalStore, domainStore, eventBus })
  })

  // --- 正常流程 ---

  it('正常流程: spawn -> markReady -> markCompleted -> markEnded', () => {
    lm.spawn('a1', 'researcher')
    lm.markReady('a1')
    lm.markCompleted('a1', { summary: 'done' })
    lm.markEnded('a1')
    const state = lm.getState('a1')
    expect(state.state).toBe('ended')
  })

  // --- 失败流程 ---

  it('失败流程: spawn -> markFailed -> markEnded', () => {
    lm.spawn('a2', 'tester')
    lm.markFailed('a2', new Error('timeout'))
    lm.markEnded('a2')
    const state = lm.getState('a2')
    expect(state.state).toBe('ended')
    expect(state.error).toBe('timeout')
  })

  // --- 状态转换 ---

  it('spawn: 新 agent 从 IDLE->SPAWNING', () => {
    lm.spawn('a3', 'planner')
    expect(lm.getState('a3').state).toBe('spawning')
  })

  it('markReady: SPAWNING->ACTIVE', () => {
    lm.spawn('a4', 'analyst')
    lm.markReady('a4')
    expect(lm.getState('a4').state).toBe('active')
  })

  it('markCompleted: ACTIVE->COMPLETING', () => {
    lm.spawn('a5', 'implementer')
    lm.markReady('a5')
    lm.markCompleted('a5', 'ok')
    expect(lm.getState('a5').state).toBe('completing')
  })

  it('markEnded: COMPLETING->ENDED', () => {
    lm.spawn('a6', 'debugger')
    lm.markReady('a6')
    lm.markCompleted('a6')
    lm.markEnded('a6')
    expect(lm.getState('a6').state).toBe('ended')
  })

  it('markEnded: FAILED->ENDED', () => {
    lm.spawn('a7', 'reviewer')
    lm.markFailed('a7', 'error')
    lm.markEnded('a7')
    expect(lm.getState('a7').state).toBe('ended')
  })

  // --- 非法转换 ---

  it('非法转换: 直接 markReady 未 spawn 的 agent 抛错', () => {
    expect(() => lm.markReady('nonexistent')).toThrow()
  })

  it('非法转换: SPAWNING->COMPLETING 抛错 (跳过 ACTIVE)', () => {
    lm.spawn('a8', 'coordinator')
    expect(() => lm.markCompleted('a8')).toThrow(/Illegal transition/)
  })

  it('非法转换: ENDED -> 任何状态 抛错', () => {
    lm.spawn('a9', 'librarian')
    lm.markReady('a9')
    lm.markCompleted('a9')
    lm.markEnded('a9')
    expect(() => lm.markReady('a9')).toThrow(/Illegal transition/)
    expect(() => lm.markFailed('a9', 'err')).toThrow(/Illegal transition/)
  })

  // --- getState / getActiveAgents / getStats ---

  it('getState 返回正确状态字符串', () => {
    lm.spawn('a10', 'tester')
    expect(lm.getState('a10').state).toBe('spawning')
    expect(lm.getState('a10').roleId).toBe('tester')
  })

  it('getActiveAgents: 只返回 ACTIVE 的', () => {
    lm.spawn('b1', 'researcher')
    lm.spawn('b2', 'analyst')
    lm.markReady('b1')
    // b1 is ACTIVE, b2 is SPAWNING
    const active = lm.getActiveAgents()
    expect(active).toHaveLength(1)
    expect(active[0].agentId).toBe('b1')
  })

  it('getStats: total, active, failed 准确', () => {
    lm.spawn('c1', 'researcher')
    lm.markReady('c1')
    lm.spawn('c2', 'analyst')
    lm.markFailed('c2', 'err')
    const stats = lm.getStats()
    expect(stats.total).toBe(2)
    expect(stats.active).toBe(1)
    expect(stats.failed).toBe(1)
  })

  // --- 事件与信号 ---

  it('eventBus 接收 lifecycle 事件', () => {
    const spawned = vi.fn()
    const active = vi.fn()
    const completed = vi.fn()
    const ended = vi.fn()
    eventBus.subscribe('agent.lifecycle.spawned', spawned)
    eventBus.subscribe('agent.lifecycle.active', active)
    eventBus.subscribe('agent.lifecycle.completed', completed)
    eventBus.subscribe('agent.lifecycle.ended', ended)

    lm.spawn('d1', 'researcher')
    lm.markReady('d1')
    lm.markCompleted('d1', 'result')
    lm.markEnded('d1')

    expect(spawned).toHaveBeenCalledTimes(1)
    expect(active).toHaveBeenCalledTimes(1)
    expect(completed).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('signalStore.emit(DIM_COORDINATION) 在 spawn 时', () => {
    const emitSpy = vi.spyOn(signalStore, 'emit')
    lm.spawn('e1', 'planner')
    const coordCall = emitSpy.mock.calls.find(
      c => c[0] && c[0].dimension === 'coordination'
    )
    expect(coordCall).toBeTruthy()
  })

  it('signalStore.emit(DIM_ALARM) 在 fail 时', () => {
    lm.spawn('e2', 'tester')
    const emitSpy = vi.spyOn(signalStore, 'emit')
    lm.markFailed('e2', 'crash')
    const alarmCall = emitSpy.mock.calls.find(
      c => c[0] && c[0].dimension === 'alarm'
    )
    expect(alarmCall).toBeTruthy()
  })
})
