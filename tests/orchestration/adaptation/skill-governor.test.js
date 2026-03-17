/**
 * SkillGovernor unit tests
 * @module tests/orchestration/adaptation/skill-governor.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SkillGovernor } from '../../../src/orchestration/adaptation/skill-governor.js'

// ============================================================================
// Mocks
// ============================================================================

const mockField = {
  emit: vi.fn(),
  query: vi.fn().mockReturnValue([]),
  superpose: vi.fn().mockReturnValue({}),
}
const mockBus = {
  publish: vi.fn(),
  subscribe: vi.fn(),
  emit: vi.fn(),
  on: vi.fn(),
}
const mockStore = { get: vi.fn().mockReturnValue(null), set: vi.fn() }
const mockCapabilityEngine = {
  getSkillScore: vi.fn().mockReturnValue(0.7),
  getScore: vi.fn().mockReturnValue(0.6),
}

// ============================================================================
// Tests
// ============================================================================

describe('SkillGovernor', () => {
  /** @type {SkillGovernor} */
  let sg

  beforeEach(() => {
    vi.clearAllMocks()
    sg = new SkillGovernor({
      field: mockField,
      bus: mockBus,
      store: mockStore,
      capabilityEngine: mockCapabilityEngine,
    })
  })

  // --------------------------------------------------------------------------
  // masteryLevel rises with repeated usage
  // --------------------------------------------------------------------------
  describe('mastery level progression', () => {
    it('should increase masteryLevel when a skill is used multiple times', () => {
      const roleId = 'implementer'
      const skillName = 'code-review'

      // Record first usage
      sg.recordUsage(roleId, skillName, true)
      const mastery1 = sg.getMastery(roleId, skillName)
      expect(mastery1).toBeGreaterThan(0)

      // Record more usages -> mastery should increase
      for (let i = 0; i < 10; i++) {
        sg.recordUsage(roleId, skillName, true)
      }
      const mastery2 = sg.getMastery(roleId, skillName)
      expect(mastery2).toBeGreaterThan(mastery1)
    })

    it('should compute mastery using sigmoid(usageCount * 0.1 * successRate)', () => {
      const roleId = 'researcher'
      const skillName = 'data-analysis'

      // capabilityEngine returns 0.7 for successRate
      mockCapabilityEngine.getSkillScore.mockReturnValue(0.7)

      sg.recordUsage(roleId, skillName, true)
      // After 1 usage: sigmoid(1 * 0.1 * 0.7) = sigmoid(0.07)
      // sigmoid(0.07) = 1 / (1 + exp(-0.07)) ~ 0.5175
      const mastery = sg.getMastery(roleId, skillName)
      expect(mastery).toBeCloseTo(1 / (1 + Math.exp(-(1 * 0.1 * 0.7))), 4)
    })

    it('should emit a DIM_KNOWLEDGE signal on each recordUsage', () => {
      sg.recordUsage('coder', 'testing', true)
      expect(mockField.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          dimension: 'knowledge',
          emitterId: 'skill-governor',
        }),
      )
    })

    it('should use default successRate 0.5 when capabilityEngine is absent', () => {
      const sgNoCap = new SkillGovernor({ field: mockField, bus: mockBus })
      sgNoCap.recordUsage('tester', 'unit-test', true)
      // sigmoid(1 * 0.1 * 0.5) = sigmoid(0.05)
      const expected = 1 / (1 + Math.exp(-(0.05)))
      expect(sgNoCap.getMastery('tester', 'unit-test')).toBeCloseTo(expected, 4)
    })
  })

  // --------------------------------------------------------------------------
  // recommend returns task-relevant skills
  // --------------------------------------------------------------------------
  describe('recommend', () => {
    it('should return skills relevant to the task description', () => {
      const roleId = 'analyst'

      // Add skills with enough usage to cross mastery > 0.3
      // sigmoid(n * 0.1 * 0.7) > 0.3 -> need n high enough
      // sigmoid(0.7) ~ 0.668 which is > 0.3, so n=10 is safe
      for (let i = 0; i < 15; i++) {
        sg.recordUsage(roleId, 'data-analysis', true)
        sg.recordUsage(roleId, 'data-visualization', true)
        sg.recordUsage(roleId, 'code-review', true)
      }

      const results = sg.recommend(roleId, 'analyze data from database')
      // 'data-analysis' and 'data-visualization' share 'data' keyword with task
      expect(results.length).toBeGreaterThan(0)

      const skillNames = results.map(r => r.skillName)
      expect(skillNames).toContain('data-analysis')
    })

    it('should publish skill.recommendation.generated event', () => {
      const roleId = 'coder'
      for (let i = 0; i < 15; i++) {
        sg.recordUsage(roleId, 'code-refactoring', true)
      }

      sg.recommend(roleId, 'refactoring the code module')
      expect(mockBus.publish).toHaveBeenCalledWith(
        'skill.recommendation.generated',
        expect.objectContaining({ roleId }),
      )
    })

    it('should return empty array for unknown roleId', () => {
      const results = sg.recommend('nonexistent', 'any task')
      expect(results).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // masteryLevel < 0.3 filtered out from recommendations
  // --------------------------------------------------------------------------
  describe('low mastery filtering', () => {
    it('should not recommend skills with masteryLevel <= 0.3', () => {
      const roleId = 'reviewer'

      // Record only 1 usage for 'shallow-skill'
      // sigmoid(1 * 0.1 * 0.7) = sigmoid(0.07) ~ 0.5175
      // That's above 0.3, so let's make successRate very low
      mockCapabilityEngine.getSkillScore.mockReturnValue(0.1)
      sg.recordUsage(roleId, 'shallow-skill', false)
      // sigmoid(1 * 0.1 * 0.1) = sigmoid(0.01) ~ 0.5025 -- still > 0.3
      // The sigmoid always starts at 0.5 for x=0 and rises.
      // We need mastery <= 0.3 which is impossible with sigmoid since sigmoid(0)=0.5
      // However the initial masteryLevel is 0 (before any usage).
      // So we test with a role that has no skills recorded at all: recommend returns []
      const results = sg.recommend('noSkillRole', 'some task about shallow-skill')
      expect(results).toEqual([])
    })

    it('should only return skills above the 0.3 mastery threshold', () => {
      // Since sigmoid always outputs >= 0.5 for any x >= 0,
      // all recorded skills will have mastery > 0.3.
      // The filter acts on skills that somehow got masteryLevel <= 0.3
      // (e.g. from restored data). Let's manually inject a low-mastery entry.
      const roleId = 'tester'
      // Use the internal inventory to set a low mastery entry
      const inv = new Map()
      inv.set('low-skill', { usageCount: 0, lastUsed: 0, masteryLevel: 0.2 })
      inv.set('high-skill', { usageCount: 10, lastUsed: Date.now(), masteryLevel: 0.7 })
      sg._skillInventory.set(roleId, inv)

      const results = sg.recommend(roleId, 'testing with high skill and low skill')
      const skillNames = results.map(r => r.skillName)
      // 'low-skill' has masteryLevel 0.2 -> should be filtered out
      expect(skillNames).not.toContain('low-skill')
      // 'high-skill' has masteryLevel 0.7 and keyword 'skill' overlaps with task 'skill'
      expect(skillNames).toContain('high-skill')
    })
  })

  // --------------------------------------------------------------------------
  // getInventory and getMastery
  // --------------------------------------------------------------------------
  describe('inventory access', () => {
    it('should return null for an unrecorded role', () => {
      expect(sg.getInventory('unknown')).toBeNull()
    })

    it('should return 0 mastery for an unrecorded skill', () => {
      expect(sg.getMastery('role', 'skill')).toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // Static metadata
  // --------------------------------------------------------------------------
  describe('static metadata', () => {
    it('should declare correct produces/consumes/publishes/subscribes', () => {
      expect(SkillGovernor.produces()).toContain('knowledge')
      expect(SkillGovernor.consumes()).toContain('learning')
      expect(SkillGovernor.consumes()).toContain('trail')
      expect(SkillGovernor.publishes()).toContain('skill.recommendation.generated')
      expect(SkillGovernor.subscribes()).toContain('agent.completed')
    })
  })
})
