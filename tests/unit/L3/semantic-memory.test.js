/**
 * SemanticMemory 单元测试 / SemanticMemory Unit Tests
 *
 * 使用真实 DatabaseManager + 内存 SQLite 测试语义记忆服务核心功能:
 * 概念/关系管理、标签查询、BFS 遍历、最短路径、知识融合、上下文片段生成等。
 *
 * Uses real DatabaseManager + in-memory SQLite to test semantic memory
 * service core: concept/relation management, label query, BFS traversal,
 * shortest path, knowledge merge, context snippet generation, statistics.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { KnowledgeRepository } from '../../../src/L1-infrastructure/database/repositories/knowledge-repo.js';
import { SemanticMemory } from '../../../src/L3-agent/memory/semantic-memory.js';
import { TABLE_SCHEMAS } from '../../../src/L1-infrastructure/schemas/database-schemas.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// 最小 MessageBus 桩 / Minimal MessageBus stub
function createStubBus() {
  const published = [];
  return {
    publish(topic, data, opts) { published.push({ topic, data, opts }); },
    _published: published,
  };
}

describe('SemanticMemory', () => {
  /** @type {DatabaseManager} */
  let dbManager;
  /** @type {KnowledgeRepository} */
  let repo;
  /** @type {ReturnType<typeof createStubBus>} */
  let bus;
  /** @type {SemanticMemory} */
  let mem;

  beforeEach(() => {
    // 创建内存数据库并初始化所有表 / Create in-memory DB and bootstrap all tables
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open(TABLE_SCHEMAS);
    repo = new KnowledgeRepository(dbManager);
    bus = createStubBus();
    mem = new SemanticMemory({ knowledgeRepo: repo, messageBus: bus, logger: silentLogger });
  });

  afterEach(() => { dbManager.close(); });

  // ━━━ 1. 添加概念 / addConcept ━━━
  describe('addConcept', () => {
    it('应创建节点并返回 ID / should create a node and return its ID', () => {
      const id = mem.addConcept({ label: 'React', nodeType: 'concept', importance: 0.8 });
      expect(id).toBeTruthy();

      // 通过 query 验证节点存在 / Verify node exists via query
      const nodes = mem.query('React');
      expect(nodes.length).toBe(1);
      expect(nodes[0].label).toBe('React');
      expect(nodes[0].nodeType).toBe('concept');
    });

    it('应广播事件到 MessageBus / should broadcast event to message bus', () => {
      mem.addConcept({ label: 'Vue', importance: 0.6 });
      const msg = bus._published.find(p => p.topic === 'memory.semantic.concept.added');
      expect(msg).toBeTruthy();
      expect(msg.data.label).toBe('Vue');
    });
  });

  // ━━━ 2. 添加关系 / addRelation ━━━
  describe('addRelation', () => {
    it('应创建边并返回 ID / should create an edge and return its ID', () => {
      const nodeA = mem.addConcept({ label: 'JavaScript' });
      const nodeB = mem.addConcept({ label: 'TypeScript' });

      const edgeId = mem.addRelation({
        sourceId: nodeA,
        targetId: nodeB,
        edgeType: 'evolved_from',
        weight: 0.9,
      });
      expect(edgeId).toBeTruthy();

      // 验证边已创建 / Verify edge created
      const outEdges = repo.getOutEdges(nodeA);
      expect(outEdges.length).toBe(1);
      expect(outEdges[0].edgeType).toBe('evolved_from');
      expect(outEdges[0].targetId).toBe(nodeB);
    });

    it('应广播关系事件 / should broadcast relation event', () => {
      const a = mem.addConcept({ label: 'A' });
      const b = mem.addConcept({ label: 'B' });
      mem.addRelation({ sourceId: a, targetId: b, edgeType: 'related_to' });

      const msg = bus._published.find(p => p.topic === 'memory.semantic.relation.added');
      expect(msg).toBeTruthy();
      expect(msg.data.edgeType).toBe('related_to');
    });
  });

  // ━━━ 3. 查询 / query ━━━
  describe('query', () => {
    it('应按标签模糊匹配查找节点 / should find nodes by label pattern', () => {
      mem.addConcept({ label: 'React Router' });
      mem.addConcept({ label: 'React Query' });
      mem.addConcept({ label: 'Vue Router' });

      const results = mem.query('React');
      expect(results.length).toBe(2);
      expect(results.every(n => n.label.includes('React'))).toBe(true);
    });

    it('按节点类型过滤 / should filter by nodeType', () => {
      mem.addConcept({ label: 'npm', nodeType: 'tool' });
      mem.addConcept({ label: 'npm patterns', nodeType: 'concept' });

      const tools = mem.query('npm', { nodeType: 'tool' });
      expect(tools.length).toBe(1);
      expect(tools[0].nodeType).toBe('tool');
    });

    it('无匹配时返回空数组 / returns empty array when no match', () => {
      expect(mem.query('nonexistent')).toEqual([]);
    });
  });

  // ━━━ 4. BFS 遍历 / getRelated ━━━
  describe('getRelated', () => {
    it('应返回 N-hop 内的相关节点 / should return nodes within N hops', () => {
      // 构建小图: A -> B -> C
      // Build small graph: A -> B -> C
      const a = mem.addConcept({ label: 'A' });
      const b = mem.addConcept({ label: 'B' });
      const c = mem.addConcept({ label: 'C' });
      mem.addRelation({ sourceId: a, targetId: b, edgeType: 'uses' });
      mem.addRelation({ sourceId: b, targetId: c, edgeType: 'uses' });

      // 从 A 出发, maxHops=2 应能到达 A, B, C
      // From A, maxHops=2 should reach A, B, C
      const related = mem.getRelated(a, { maxHops: 2 });
      const labels = related.map(r => r.node.label);
      expect(labels).toContain('A');
      expect(labels).toContain('B');
      expect(labels).toContain('C');
    });

    it('maxHops=1 不应到达 2-hop 远的节点 / maxHops=1 should not reach 2-hop nodes', () => {
      const a = mem.addConcept({ label: 'X' });
      const b = mem.addConcept({ label: 'Y' });
      const c = mem.addConcept({ label: 'Z' });
      mem.addRelation({ sourceId: a, targetId: b, edgeType: 'uses' });
      mem.addRelation({ sourceId: b, targetId: c, edgeType: 'uses' });

      const related = mem.getRelated(a, { maxHops: 1 });
      const labels = related.map(r => r.node.label);
      expect(labels).toContain('X');
      expect(labels).toContain('Y');
      expect(labels).not.toContain('Z');
    });
  });

  // ━━━ 5. 最短路径 / findPath ━━━
  describe('findPath', () => {
    it('应找到两节点间的最短路径 / should find shortest path between two nodes', () => {
      // A -> B -> C -> D
      const a = mem.addConcept({ label: 'Start' });
      const b = mem.addConcept({ label: 'Mid1' });
      const c = mem.addConcept({ label: 'Mid2' });
      const d = mem.addConcept({ label: 'End' });
      mem.addRelation({ sourceId: a, targetId: b, edgeType: 'uses' });
      mem.addRelation({ sourceId: b, targetId: c, edgeType: 'uses' });
      mem.addRelation({ sourceId: c, targetId: d, edgeType: 'uses' });

      const path = mem.findPath(a, d);
      expect(path).not.toBeNull();
      expect(path.length).toBe(4); // A -> B -> C -> D
      expect(path[0]).toBe(a);
      expect(path[path.length - 1]).toBe(d);
    });

    it('不可达时返回 null / returns null when unreachable', () => {
      const a = mem.addConcept({ label: 'Island1' });
      const b = mem.addConcept({ label: 'Island2' });
      // 无边连接 / No edges between them
      expect(mem.findPath(a, b)).toBeNull();
    });

    it('自身到自身应返回单元素路径 / same node returns single-element path', () => {
      const a = mem.addConcept({ label: 'Self' });
      const path = mem.findPath(a, a);
      expect(path).toEqual([a]);
    });
  });

  // ━━━ 6. 知识融合 / merge ━━━
  describe('merge', () => {
    it('应将被合并节点的边重定向到保留节点 / should redirect edges of merged node to kept node', () => {
      // 构建: A -> B, C -> B  (B 将被合并到 A)
      // Build: A -> B, C -> B  (B will be merged into A)
      const a = mem.addConcept({ label: 'React' });
      const b = mem.addConcept({ label: 'ReactJS' }); // 重复概念 / Duplicate concept
      const c = mem.addConcept({ label: 'Next.js' });
      mem.addRelation({ sourceId: c, targetId: b, edgeType: 'depends_on' });

      mem.merge(a, b);

      // B 应已被删除 / B should be deleted
      const bQuery = mem.query('ReactJS');
      expect(bQuery.length).toBe(0);

      // C -> B 的边应重定向为 C -> A / C -> B edge should redirect to C -> A
      const cEdges = repo.getOutEdges(c);
      expect(cEdges.length).toBe(1);
      expect(cEdges[0].targetId).toBe(a);
    });

    it('合并应广播事件 / merge should broadcast event', () => {
      const a = mem.addConcept({ label: 'Keep' });
      const b = mem.addConcept({ label: 'Discard' });
      mem.merge(a, b);

      const msg = bus._published.find(p => p.topic === 'memory.semantic.merged');
      expect(msg).toBeTruthy();
      expect(msg.data.keepLabel).toBe('Keep');
      expect(msg.data.mergeLabel).toBe('Discard');
    });

    it('节点不存在时不报错 / non-existent node should not throw', () => {
      const a = mem.addConcept({ label: 'Valid' });
      // 合并不存在的节点, 不应抛异常 / Merging non-existent node should not throw
      expect(() => mem.merge(a, 'non-existent-id')).not.toThrow();
    });
  });

  // ━━━ 7. 上下文片段生成 / buildContextSnippet ━━━
  describe('buildContextSnippet', () => {
    it('应生成格式化的知识片段 / should generate formatted knowledge snippet', () => {
      // 构建小图 / Build small graph
      const react = mem.addConcept({ label: 'React' });
      const jsx = mem.addConcept({ label: 'JSX' });
      const js = mem.addConcept({ label: 'JavaScript' });
      mem.addRelation({ sourceId: react, targetId: jsx, edgeType: 'uses' });
      mem.addRelation({ sourceId: react, targetId: js, edgeType: 'depends_on' });

      const snippet = mem.buildContextSnippet(react, { maxHops: 1 });
      expect(snippet).toContain('[Knowledge: "React"]');
      expect(snippet).toContain('-> uses:');
      expect(snippet).toContain('"JSX"');
      expect(snippet).toContain('-> depends_on:');
      expect(snippet).toContain('"JavaScript"');
    });

    it('不存在的节点应返回空字符串 / non-existent node returns empty string', () => {
      expect(mem.buildContextSnippet('fake-id')).toBe('');
    });

    it('无边的孤立节点应只返回标题行 / isolated node returns only header line', () => {
      const lonely = mem.addConcept({ label: 'Orphan' });
      const snippet = mem.buildContextSnippet(lonely);
      expect(snippet).toContain('[Knowledge: "Orphan"]');
      // 不应有箭头行 / No arrow lines
      expect(snippet).not.toContain('->');
    });
  });

  // ━━━ 8. 统计 / getStats ━━━
  describe('getStats', () => {
    it('应返回正确的节点和边数量 / should return correct node and edge counts', () => {
      // 初始为空 / Initially empty
      let stats = mem.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);

      // 添加节点和边 / Add nodes and edges
      const a = mem.addConcept({ label: 'Node1' });
      const b = mem.addConcept({ label: 'Node2' });
      const c = mem.addConcept({ label: 'Node3' });
      mem.addRelation({ sourceId: a, targetId: b, edgeType: 'uses' });
      mem.addRelation({ sourceId: b, targetId: c, edgeType: 'related_to' });

      stats = mem.getStats();
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2);
    });

    it('合并后统计应正确反映变化 / stats should reflect merge changes', () => {
      const a = mem.addConcept({ label: 'A' });
      const b = mem.addConcept({ label: 'B' });
      mem.addRelation({ sourceId: a, targetId: b, edgeType: 'uses' });

      // 合并前 / Before merge
      expect(mem.getStats().nodeCount).toBe(2);

      const c = mem.addConcept({ label: 'C' });
      mem.addRelation({ sourceId: c, targetId: b, edgeType: 'depends_on' });

      mem.merge(a, b);

      // 合并后: A 保留, B 删除, 自环被清理 / After merge: A kept, B deleted, self-loop cleaned
      const stats = mem.getStats();
      expect(stats.nodeCount).toBe(2); // A + C
    });
  });
});
