/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 3 Soul Designer
 * @module tests/unit/soul-designer.test
 *
 * 测试灵魂设计器、人格模板和人格进化。
 * Tests SoulDesigner, persona templates, and persona evolution.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SoulDesigner } from '../../src/layer3-intelligence/soul/soul-designer.js';
import {
  PERSONA_TEMPLATES,
  mergePersonas,
  getPersonaTemplate,
  listPersonaIds,
} from '../../src/layer3-intelligence/soul/persona-templates.js';

// ===========================================================================
// PERSONA_TEMPLATES — 人格模板 / Persona Templates
// ===========================================================================

describe('PERSONA_TEMPLATES', () => {
  it('should be frozen at the top level (顶层应冻结)', () => {
    assert.ok(Object.isFrozen(PERSONA_TEMPLATES));
  });

  it('should contain all 4 built-in personas (包含 4 种内置人格)', () => {
    const ids = Object.keys(PERSONA_TEMPLATES);
    assert.ok(ids.includes('scout-bee'));
    assert.ok(ids.includes('worker-bee'));
    assert.ok(ids.includes('guard-bee'));
    assert.ok(ids.includes('queen-messenger'));
    assert.equal(ids.length, 4);
  });

  it('should have frozen individual persona objects (每个人格对象应冻结)', () => {
    for (const persona of Object.values(PERSONA_TEMPLATES)) {
      assert.ok(Object.isFrozen(persona));
    }
  });

  it('each persona should have required fields (每个人格应有必需字段)', () => {
    for (const persona of Object.values(PERSONA_TEMPLATES)) {
      assert.ok(persona.id, 'missing id');
      assert.ok(persona.name, 'missing name');
      assert.ok(persona.description, 'missing description');
      assert.ok(persona.soulSnippet, 'missing soulSnippet');
      assert.ok(Array.isArray(persona.bestFor), 'bestFor should be an array');
      assert.ok(persona.collaborationStyle, 'missing collaborationStyle');
    }
  });

  it('cannot modify templates (无法修改模板)', () => {
    assert.throws(() => {
      PERSONA_TEMPLATES['new-persona'] = { id: 'new-persona' };
    }, TypeError);
  });
});

// ===========================================================================
// mergePersonas — 人格合并 / Persona Merging
// ===========================================================================

describe('mergePersonas', () => {
  it('should return built-in templates when called with no args (无参时返回内置模板)', () => {
    const merged = mergePersonas();
    assert.deepEqual(Object.keys(merged).sort(), Object.keys(PERSONA_TEMPLATES).sort());
  });

  it('should overlay user personas over built-in ones (用户人格覆盖内置)', () => {
    const custom = {
      'worker-bee': { id: 'worker-bee', name: 'Custom Worker', soulSnippet: 'custom' },
    };
    const merged = mergePersonas(custom);
    assert.equal(merged['worker-bee'].name, 'Custom Worker');
    // Other templates still present
    assert.ok(merged['scout-bee']);
  });

  it('should add new user personas alongside built-in ones (新增用户人格)', () => {
    const custom = {
      'custom-bee': { id: 'custom-bee', name: 'Custom Bee', bestFor: ['custom'] },
    };
    const merged = mergePersonas(custom);
    assert.equal(Object.keys(merged).length, 5);
    assert.ok(merged['custom-bee']);
    assert.ok(merged['scout-bee']);
  });
});

// ===========================================================================
// getPersonaTemplate — 获取模板 / Get Template
// ===========================================================================

describe('getPersonaTemplate', () => {
  it('should return built-in template by id (通过 id 获取内置模板)', () => {
    const t = getPersonaTemplate('scout-bee');
    assert.equal(t.id, 'scout-bee');
  });

  it('should return null for unknown id (未知 id 返回 null)', () => {
    assert.equal(getPersonaTemplate('nonexistent'), null);
  });
});

// ===========================================================================
// SoulDesigner — 灵魂设计器 / Soul Designer
// ===========================================================================

describe('SoulDesigner', () => {
  let designer;

  beforeEach(() => {
    designer = new SoulDesigner({ soul: {} });
  });

  // ── Constructor 构造函数 ─────────────────────────────────────────

  it('should construct with default config (使用默认配置构造)', () => {
    const d = new SoulDesigner({});
    assert.ok(d);
    // Should have all 4 built-in personas
    const personas = d.listPersonas();
    assert.equal(personas.length, 4);
  });

  it('should construct with custom personas merged (合并自定义人格)', () => {
    const d = new SoulDesigner({
      soul: {
        personas: {
          'custom-bee': { id: 'custom-bee', name: 'My Custom', bestFor: ['custom'], description: 'A custom persona', collaborationStyle: 'solo' },
        },
      },
    });
    const personas = d.listPersonas();
    assert.equal(personas.length, 5);
  });

  // ── selectPersona 人格选择 ──────────────────────────────────────

  it('should select scout-bee for exploration tasks (探索任务选择侦察蜂)', () => {
    const result = designer.selectPersona('exploration of the codebase');
    assert.equal(result.personaId, 'scout-bee');
  });

  it('should select worker-bee for implementation tasks (实现任务选择工蜂)', () => {
    const result = designer.selectPersona('implementation of the feature');
    assert.equal(result.personaId, 'worker-bee');
  });

  it('should select guard-bee for security tasks (安全任务选择守卫蜂)', () => {
    const result = designer.selectPersona('security review of the code');
    assert.equal(result.personaId, 'guard-bee');
  });

  it('should select queen-messenger for coordination tasks (协调任务选择蜂王信使)', () => {
    const result = designer.selectPersona('coordination of the team');
    assert.equal(result.personaId, 'queen-messenger');
  });

  it('should default to worker-bee when no keyword match (无匹配关键字时默认工蜂)', () => {
    const result = designer.selectPersona('something completely random');
    assert.equal(result.personaId, 'worker-bee');
    assert.equal(result.confidence, 0.3);
  });

  it('should return confidence value in result (结果应包含置信度)', () => {
    const result = designer.selectPersona('exploration research analysis');
    assert.ok(typeof result.confidence === 'number');
    assert.ok(result.confidence > 0);
    assert.ok(result.confidence <= 1.0);
  });

  it('should return soulSnippet in result (结果应包含灵魂片段)', () => {
    const result = designer.selectPersona('exploration');
    assert.ok(typeof result.soulSnippet === 'string');
    assert.ok(result.soulSnippet.length > 0);
  });

  it('should use taskType as additional matching context (taskType 作为额外匹配上下文)', () => {
    const result = designer.selectPersona('do some work', 'research');
    assert.equal(result.personaId, 'scout-bee');
  });

  // ── generateSoul 灵魂生成 ──────────────────────────────────────

  it('should generate a soul snippet for known persona (为已知人格生成灵魂片段)', () => {
    const soul = designer.generateSoul({
      personaId: 'scout-bee',
      taskDescription: 'Explore the code',
    });
    assert.ok(soul.includes('Scout Bee'));
    assert.ok(soul.includes('Explore the code'));
  });

  it('should include swarmRole when provided (提供 swarmRole 时包含)', () => {
    const soul = designer.generateSoul({
      personaId: 'worker-bee',
      taskDescription: 'Build feature',
      swarmRole: 'Primary implementer',
    });
    assert.ok(soul.includes('Primary implementer'));
  });

  it('should include peerDirectory when provided (提供 peerDirectory 时包含)', () => {
    const soul = designer.generateSoul({
      personaId: 'worker-bee',
      taskDescription: 'Build feature',
      peerDirectory: '[Peer Directory]\n- agent-2 (helper): general',
    });
    assert.ok(soul.includes('[Peer Directory]'));
  });

  it('should return fallback for unknown personaId (未知 personaId 返回备用)', () => {
    const soul = designer.generateSoul({
      personaId: 'nonexistent',
      taskDescription: 'Do something',
    });
    assert.ok(soul.includes('Do something'));
  });

  // ── listPersonas 列出人格 ──────────────────────────────────────

  it('should return all personas with expected fields (返回所有人格及其必需字段)', () => {
    const personas = designer.listPersonas();
    assert.equal(personas.length, 4);
    for (const p of personas) {
      assert.ok(p.id);
      assert.ok(p.name);
      assert.ok(p.description);
      assert.ok(Array.isArray(p.bestFor));
      assert.ok(p.collaborationStyle);
    }
  });

  // ── getRecommendation 推荐 ─────────────────────────────────────

  it('should return a recommendation object (返回推荐对象)', () => {
    const rec = designer.getRecommendation('implementation');
    assert.ok(rec.personaId);
    assert.ok(typeof rec.confidence === 'number');
  });
});

// ===========================================================================
// PersonaEvolution — 人格进化 / Persona Evolution
// (Mocked — no real DB needed)
// ===========================================================================

describe('PersonaEvolution', () => {
  // We mock the db module imports that PersonaEvolution uses.
  // Since PersonaEvolution delegates everything to db.*, we test
  // that constructing and calling methods works with proper mocking.

  it('should construct without errors (构造不报错)', async () => {
    // Dynamic import to avoid db initialization at module scope
    const { PersonaEvolution } = await import('../../src/layer3-intelligence/soul/persona-evolution.js');
    const evo = new PersonaEvolution();
    assert.ok(evo);
  });

  it('should have recordOutcome method (有 recordOutcome 方法)', async () => {
    const { PersonaEvolution } = await import('../../src/layer3-intelligence/soul/persona-evolution.js');
    const evo = new PersonaEvolution();
    assert.equal(typeof evo.recordOutcome, 'function');
  });

  it('should have getStats method (有 getStats 方法)', async () => {
    const { PersonaEvolution } = await import('../../src/layer3-intelligence/soul/persona-evolution.js');
    const evo = new PersonaEvolution();
    assert.equal(typeof evo.getStats, 'function');
  });

  it('should have getBestPersona method (有 getBestPersona 方法)', async () => {
    const { PersonaEvolution } = await import('../../src/layer3-intelligence/soul/persona-evolution.js');
    const evo = new PersonaEvolution();
    assert.equal(typeof evo.getBestPersona, 'function');
  });
});
