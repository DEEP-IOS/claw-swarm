/**
 * EpisodicMemory V6.2 单元测试 / EpisodicMemory V6.2 Unit Tests
 *
 * 测试 P1-5 extractPatterns: 从情景记忆中提取高频 predicate::object 模式,
 * 注入语义记忆, 发布 memory.pattern.extracted 事件。
 *
 * Tests P1-5 extractPatterns: extract high-frequency predicate::object
 * patterns from episodic memory, inject into semantic memory,
 * publish memory.pattern.extracted event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EpisodicMemory } from '../../../src/L3-agent/memory/episodic-memory.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

const AGENT = 'agent-pattern';

/**
 * 生成包含重复 predicate::object 对的事件列表
 * Generate events with repeated predicate-object pairs
 *
 * 模式分布:
 *   'completed'::'task-A'  x5  (超过默认阈值 3)
 *   'deployed'::'service-X' x4  (超过默认阈值 3)
 *   'failed'::'task-B'     x2  (低于阈值)
 *   'observed'::'metric-C'  x1  (低于阈值)
 */
function generateEvents() {
  const events = [];
  const patterns = [
    { predicate: 'completed', object: 'task-A', count: 5 },
    { predicate: 'deployed', object: 'service-X', count: 4 },
    { predicate: 'failed', object: 'task-B', count: 2 },
    { predicate: 'observed', object: 'metric-C', count: 1 },
  ];

  let id = 1;
  for (const p of patterns) {
    for (let i = 0; i < p.count; i++) {
      events.push({
        id: `evt-${id++}`,
        agentId: AGENT,
        eventType: 'action',
        subject: AGENT,
        predicate: p.predicate,
        object: p.object,
        importance: 0.5 + Math.random() * 0.3,
        timestamp: Date.now() - (id * 1000),
      });
    }
  }
  return events;
}

function createMockRepo() {
  return {
    recall: vi.fn(() => generateEvents()),
    record: vi.fn(() => 'new-evt-id'),
  };
}

function createMockBus() {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  };
}

function createMockSemanticMemory() {
  return {
    addConcept: vi.fn(() => 'node-1'),
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('EpisodicMemory.extractPatterns (V6.2)', () => {
  let episodicRepo;
  let messageBus;
  let semanticMemory;
  let mem;

  beforeEach(() => {
    episodicRepo = createMockRepo();
    messageBus = createMockBus();
    semanticMemory = createMockSemanticMemory();
    mem = new EpisodicMemory({
      episodicRepo,
      messageBus,
      logger: silentLogger,
    });
  });

  // ━━━ 1. extractPatterns 方法存在 / Method existence ━━━

  it('should have extractPatterns method', () => {
    expect(typeof mem.extractPatterns).toBe('function');
  });

  // ━━━ 2. setSemanticMemory 方法存在 / setSemanticMemory existence ━━━

  it('should have setSemanticMemory method', () => {
    expect(typeof mem.setSemanticMemory).toBe('function');
    // 设置后不应抛异常 / Should not throw after setting
    expect(() => mem.setSemanticMemory(semanticMemory)).not.toThrow();
  });

  // ━━━ 3. 提取足够出现次数的模式 / Extract patterns with sufficient occurrences ━━━

  it('should extract patterns with sufficient occurrences', () => {
    const { patterns, injected } = mem.extractPatterns(AGENT);

    // 默认 minOccurrences=3, 应提取 'completed::task-A'(5次) 和 'deployed::service-X'(4次)
    // Default minOccurrences=3, should extract 'completed::task-A'(5x) and 'deployed::service-X'(4x)
    expect(patterns.length).toBe(2);
    expect(patterns[0].occurrences).toBeGreaterThanOrEqual(patterns[1].occurrences);
    expect(patterns[0].predicate).toBe('completed');
    expect(patterns[0].object).toBe('task-A');
    expect(patterns[0].occurrences).toBe(5);
    expect(patterns[1].predicate).toBe('deployed');
    expect(patterns[1].object).toBe('service-X');
    expect(patterns[1].occurrences).toBe(4);
  });

  // ━━━ 4. 低于阈值不提取 / No extraction below minOccurrences ━━━

  it('should not extract patterns below minOccurrences threshold', () => {
    const { patterns } = mem.extractPatterns(AGENT, { minOccurrences: 3 });

    // 'failed::task-B'(2次) 和 'observed::metric-C'(1次) 不应被提取
    // 'failed::task-B'(2x) and 'observed::metric-C'(1x) should not be extracted
    const failedPattern = patterns.find(p => p.predicate === 'failed');
    const observedPattern = patterns.find(p => p.predicate === 'observed');
    expect(failedPattern).toBeUndefined();
    expect(observedPattern).toBeUndefined();
  });

  // ━━━ 5. 注入语义记忆 / Inject into semantic memory ━━━

  it('should inject patterns into semantic memory', () => {
    mem.setSemanticMemory(semanticMemory);
    const { patterns, injected } = mem.extractPatterns(AGENT);

    // 应注入与 patterns 数量相同的概念节点 / Should inject same number of concept nodes as patterns
    expect(injected).toBe(patterns.length);
    expect(semanticMemory.addConcept).toHaveBeenCalledTimes(patterns.length);

    // 验证 addConcept 调用参数 / Verify addConcept call arguments
    const firstCall = semanticMemory.addConcept.mock.calls[0][0];
    expect(firstCall.label).toContain('pattern:');
    expect(firstCall.nodeType).toBe('extracted_pattern');
    expect(firstCall.properties).toHaveProperty('predicate');
    expect(firstCall.properties).toHaveProperty('object');
    expect(firstCall.properties).toHaveProperty('occurrences');
    expect(firstCall.properties).toHaveProperty('agentId', AGENT);
    expect(firstCall.properties).toHaveProperty('extractedAt');
  });

  // ━━━ 6. 发布模式提取事件 / Publish pattern extraction event ━━━

  it('should publish memory.pattern.extracted event', () => {
    mem.extractPatterns(AGENT);

    expect(messageBus.publish).toHaveBeenCalledWith(
      'memory.pattern.extracted',
      expect.objectContaining({
        agentId: AGENT,
        patternsFound: 2,
      }),
      expect.objectContaining({
        senderId: 'episodic-memory',
      }),
    );
  });

  // ━━━ 7. 空事件列表优雅处理 / Handle empty event list gracefully ━━━

  it('should handle empty event list gracefully', () => {
    episodicRepo.recall.mockReturnValue([]);

    const { patterns, injected } = mem.extractPatterns(AGENT);

    expect(patterns).toEqual([]);
    expect(injected).toBe(0);
    // 仍应发布事件 / Should still publish event
    expect(messageBus.publish).toHaveBeenCalledWith(
      'memory.pattern.extracted',
      expect.objectContaining({
        agentId: AGENT,
        totalEvents: 0,
        patternsFound: 0,
        injected: 0,
      }),
      expect.any(Object),
    );
  });

  // ━━━ 8. 自定义 minOccurrences 参数 / Custom minOccurrences parameter ━━━

  it('should respect custom minOccurrences parameter', () => {
    // minOccurrences=5: 只有 'completed::task-A'(5次) 达标
    // minOccurrences=5: only 'completed::task-A'(5x) qualifies
    const result5 = mem.extractPatterns(AGENT, { minOccurrences: 5 });
    expect(result5.patterns.length).toBe(1);
    expect(result5.patterns[0].predicate).toBe('completed');

    // minOccurrences=1: 所有模式都达标
    // minOccurrences=1: all patterns qualify
    const result1 = mem.extractPatterns(AGENT, { minOccurrences: 1 });
    expect(result1.patterns.length).toBe(4);

    // minOccurrences=100: 无模式达标
    // minOccurrences=100: no pattern qualifies
    const result100 = mem.extractPatterns(AGENT, { minOccurrences: 100 });
    expect(result100.patterns.length).toBe(0);
  });
});
