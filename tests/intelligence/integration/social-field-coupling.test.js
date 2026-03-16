/**
 * R3 社交-场 耦合集成测试
 * 验证 social / understanding / artifacts 模块通过信号场进行耦合通信
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SignalStore } from '../../../src/core/field/signal-store.js';
import { DomainStore } from '../../../src/core/store/domain-store.js';
import { EventBus } from '../../../src/core/bus/event-bus.js';
// R3 social
import { ReputationCRDT } from '../../../src/intelligence/social/reputation-crdt.js';
import { SNAAnalyzer } from '../../../src/intelligence/social/sna-analyzer.js';
import { EmotionalState } from '../../../src/intelligence/social/emotional-state.js';
import { TrustDynamics } from '../../../src/intelligence/social/trust-dynamics.js';
import { EpisodeLearner } from '../../../src/intelligence/social/episode-learner.js';
// R3 understanding
import { IntentClassifier } from '../../../src/intelligence/understanding/intent-classifier.js';
import { RequirementClarifier } from '../../../src/intelligence/understanding/requirement-clarifier.js';
import { ScopeEstimator } from '../../../src/intelligence/understanding/scope-estimator.js';
// R3 artifacts
import { ArtifactRegistry } from '../../../src/intelligence/artifacts/artifact-registry.js';
import { ExecutionJournal } from '../../../src/intelligence/artifacts/execution-journal.js';
import {
  DIM_EMOTION, DIM_SNA, DIM_REPUTATION, DIM_TRAIL, DIM_KNOWLEDGE,
} from '../../../src/core/field/types.js';
import os from 'node:os';
import path from 'node:path';

describe('R3 Social-Field Coupling Integration', () => {
  let field, bus, store;

  beforeEach(() => {
    const tmpDir = path.join(os.tmpdir(), `r3-integ-${Date.now()}`);
    field = new SignalStore();
    bus = new EventBus();
    store = new DomainStore({ domain: 'test-r3-integ', snapshotDir: tmpDir });
  });

  it('Agent 连续失败 → EmotionalState frustration 上升 → DIM_EMOTION 写入场 → superpose 可读', () => {
    const emo = new EmotionalState({ field, bus });
    // Manually wire field/bus since ModuleBase does not assign them
    emo.field = field;
    emo.bus = bus;

    // Record 3 consecutive failures
    emo.recordOutcome('agent-fail', false);
    emo.recordOutcome('agent-fail', false);
    emo.recordOutcome('agent-fail', false);

    const emotion = emo.getEmotion('agent-fail');
    expect(emotion.frustration).toBeGreaterThan(0);

    // DIM_EMOTION should be readable from the field
    const vec = field.superpose('agent-fail');
    expect(vec.emotion).toBeGreaterThan(0);
  });

  it('两 Agent 多次成功协作 → SNAAnalyzer strongPairs 包含该对 → DIM_SNA 写入', () => {
    const sna = new SNAAnalyzer({ field, bus });
    sna.field = field;
    sna.bus = bus;

    // Record 4 successful collaborations (>= minWeight=3 default)
    for (let i = 0; i < 4; i++) {
      sna.recordCollaboration('alice', 'bob', true);
    }

    const strongPairs = sna.getStrongPairs();
    expect(strongPairs.length).toBeGreaterThanOrEqual(1);
    const pair = strongPairs.find(
      p => (p.agentA === 'alice' && p.agentB === 'bob') ||
           (p.agentA === 'bob' && p.agentB === 'alice')
    );
    expect(pair).toBeDefined();
    expect(pair.edge.successes).toBe(4);

    // DIM_SNA should be in the field for the normalized key
    const normalizedKey = ['alice', 'bob'].sort().join('::');
    const signals = field.query({ dimension: DIM_SNA, scope: normalizedKey });
    expect(signals.length).toBeGreaterThan(0);
  });

  it('Agent 完成任务 → ReputationCRDT.increment → DIM_REPUTATION 可读', () => {
    const rep = new ReputationCRDT({ field, bus, store });
    rep.field = field;
    rep.bus = bus;
    rep.store = store;

    rep.increment('agent-star');
    rep.increment('agent-star');
    rep.increment('agent-star');

    const score = rep.getScore('agent-star');
    expect(score.positive).toBe(3);
    expect(score.ratio).toBe(1.0); // all positive

    // DIM_REPUTATION should be in the field
    const vec = field.superpose('agent-star');
    expect(vec.reputation).toBeGreaterThan(0);
  });

  it('IntentClassifier 低 confidence → RequirementClarifier 生成问题 → ScopeEstimator 估算', () => {
    const classifier = new IntentClassifier({ field, bus });
    const clarifier = new RequirementClarifier({ field, bus });
    const estimator = new ScopeEstimator({ field });

    // Ambiguous input that matches multiple intents
    const intentResult = classifier.classify('fix and add new optimization feature');

    // Should produce a classification
    expect(intentResult).toHaveProperty('primary');
    expect(intentResult).toHaveProperty('confidence');

    // Generate clarification questions
    const questions = clarifier.generateQuestions(intentResult);
    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBeGreaterThan(0);
    // Each question has question and impact
    expect(questions[0]).toHaveProperty('question');
    expect(questions[0]).toHaveProperty('impact');

    // Estimate scope
    const estimation = estimator.estimate(intentResult, {
      affectedFiles: ['src/a.js', 'src/b.js'],
    });
    expect(estimation).toHaveProperty('estimatedAgents');
    expect(estimation).toHaveProperty('estimatedPhases');
    expect(estimation).toHaveProperty('riskLevel');
    expect(estimation).toHaveProperty('recommendation');
    expect(estimation.estimatedAgents).toBeGreaterThanOrEqual(1);
  });

  it('产物注册 → ArtifactRegistry 写 DIM_TRAIL → ExecutionJournal 记录 → generateReport 包含信息', () => {
    const registry = new ArtifactRegistry({ field, bus, store });
    const journal = new ExecutionJournal({ field, bus, store });

    // Register an artifact
    const art = registry.register('dag-prod', {
      type: 'code_change',
      path: 'src/main.js',
      description: 'Implemented login flow',
      createdBy: 'agent-coder',
      quality: 0.85,
    });

    // DIM_TRAIL should now be in the field
    const vec = field.superpose('dag-prod');
    expect(vec.trail).toBeGreaterThan(0);

    // Journal logs the same DAG
    journal.log('dag-prod', {
      phase: 'implementation',
      agentId: 'agent-coder',
      action: `Created artifact: ${art.path}`,
      outcome: 'success',
      reasoning: 'Login flow implemented successfully',
    });

    // Generate report
    const report = journal.generateReport('dag-prod');
    expect(report).toContain('## 任务执行报告');
    expect(report).toContain('agent-coder');
    expect(report).toContain('src/main.js');
    expect(report).toContain('Login flow implemented successfully');

    // Verify DIM_KNOWLEDGE is also written by generateReport
    const knowledgeVec = field.superpose('dag-prod');
    expect(knowledgeVec.knowledge).toBeGreaterThan(0);
  });
});
