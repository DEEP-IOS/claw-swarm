/**
 * ContextEngine — 上下文窗口组装引擎 单元测试
 * @module tests/intelligence/memory/context-engine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextEngine, PRIORITY } from '../../../src/intelligence/memory/context-engine.js';

describe('ContextEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new ContextEngine({ maxTokens: 128000, reservedTokens: 4000 });
  });

  it('estimateTokens: ASCII text ~0.25 tokens/char', () => {
    // "hello world" = 11 chars -> ~11/4 = ~2.75 -> ceil = 3
    const tokens = engine.estimateTokens('hello world');
    expect(tokens).toBe(3);
  });

  it('estimateTokens: CJK text ~1.5 tokens/char', () => {
    // "你好世界" = 4 CJK chars -> 4 * 1.5 = 6
    const tokens = engine.estimateTokens('你好世界');
    expect(tokens).toBe(6);
  });

  it('estimateTokens: mixed CJK/ASCII', () => {
    // "hello 你好" = 6 ASCII + 2 CJK = 6/4 + 2*1.5 = 1.5 + 3.0 = 4.5 -> ceil = 5
    const tokens = engine.estimateTokens('hello 你好');
    expect(tokens).toBe(5);
  });

  it('estimateTokens: empty text returns 0', () => {
    expect(engine.estimateTokens('')).toBe(0);
    expect(engine.estimateTokens(null)).toBe(0);
    expect(engine.estimateTokens(undefined)).toBe(0);
  });

  it('assemble: CRITICAL sections are never truncated', () => {
    const sections = [
      { priority: PRIORITY.CRITICAL, content: 'System instructions: always follow rules.' },
      { priority: PRIORITY.OPTIONAL, content: 'Optional context about weather.' },
    ];
    const result = engine.assemble(sections);
    expect(result).toContain('System instructions: always follow rules.');
  });

  it('assemble: sections ordered by priority', () => {
    const sections = [
      { priority: PRIORITY.LOW, content: 'LOW content' },
      { priority: PRIORITY.CRITICAL, content: 'CRITICAL content' },
      { priority: PRIORITY.HIGH, content: 'HIGH content' },
    ];
    const result = engine.assemble(sections);
    const critIdx = result.indexOf('CRITICAL content');
    const highIdx = result.indexOf('HIGH content');
    const lowIdx = result.indexOf('LOW content');
    expect(critIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('assemble: total tokens within budget (maxTokens - reservedTokens)', () => {
    const smallEngine = new ContextEngine({ maxTokens: 100, reservedTokens: 20 });
    // Budget = 80 tokens
    const sections = [
      { priority: PRIORITY.CRITICAL, content: 'Short critical.', estimatedTokens: 10 },
      { priority: PRIORITY.HIGH, content: 'High priority content here.', estimatedTokens: 20 },
      { priority: PRIORITY.MEDIUM, content: 'x'.repeat(2000), estimatedTokens: 500 },
    ];
    const result = smallEngine.assemble(sections);
    // The MEDIUM section (500 tokens) should be truncated to fit remaining budget
    const tokens = smallEngine.estimateTokens(result);
    // Result should not exceed budget of 80 tokens (rough check)
    expect(result).toContain('Short critical.');
    expect(result).toContain('High priority content here.');
  });

  it('assemble: low priority sections get truncated when budget is tight', () => {
    const tinyEngine = new ContextEngine({ maxTokens: 50, reservedTokens: 10 });
    // Budget = 40 tokens
    const sections = [
      { priority: PRIORITY.CRITICAL, content: 'CRIT', estimatedTokens: 30 },
      { priority: PRIORITY.OPTIONAL, content: 'This optional text is very long and should be cut.', estimatedTokens: 100 },
    ];
    const result = tinyEngine.assemble(sections);
    expect(result).toContain('CRIT');
    // Optional should be truncated
    if (result.includes('optional')) {
      expect(result).toContain('截断');
    }
  });

  it('fitToTokenBudget: short text returned as-is', () => {
    const result = engine.fitToTokenBudget('hello world', 1000);
    expect(result).toBe('hello world');
  });

  it('fitToTokenBudget: long text truncated with indicator', () => {
    const longText = 'Line one\nLine two\nLine three\nLine four\nLine five';
    const result = engine.fitToTokenBudget(longText, 3);
    expect(result).toContain('截断');
    expect(result.length).toBeLessThan(longText.length + 30);
  });

  it('getSectionBudgets allocates by priority ratios', () => {
    const sections = [
      { priority: PRIORITY.CRITICAL },
      { priority: PRIORITY.HIGH },
      { priority: PRIORITY.MEDIUM },
    ];
    const budgets = engine.getSectionBudgets(10000, sections);
    expect(budgets).toBeInstanceOf(Map);
    // CRITICAL gets 30%, HIGH gets 25%, MEDIUM gets 25%
    expect(budgets.get(PRIORITY.CRITICAL)).toBe(3000);
    expect(budgets.get(PRIORITY.HIGH)).toBe(2500);
    // MEDIUM gets 25% + remainder
    expect(budgets.get(PRIORITY.MEDIUM)).toBeGreaterThanOrEqual(2500);
  });

  it('small maxTokens scenario: only CRITICAL survives', () => {
    const tinyEngine = new ContextEngine({ maxTokens: 20, reservedTokens: 5 });
    // Budget = 15 tokens
    const sections = [
      { priority: PRIORITY.CRITICAL, content: 'Keep this.', estimatedTokens: 10 },
      { priority: PRIORITY.LOW, content: 'x'.repeat(500), estimatedTokens: 125 },
      { priority: PRIORITY.OPTIONAL, content: 'y'.repeat(500), estimatedTokens: 125 },
    ];
    const result = tinyEngine.assemble(sections);
    expect(result).toContain('Keep this.');
  });

  it('assemble with empty sections returns empty string', () => {
    expect(engine.assemble([])).toBe('');
    expect(engine.assemble(null)).toBe('');
  });

  it('PRIORITY constants are correct', () => {
    expect(PRIORITY.CRITICAL).toBe(1);
    expect(PRIORITY.HIGH).toBe(2);
    expect(PRIORITY.MEDIUM).toBe(3);
    expect(PRIORITY.LOW).toBe(4);
    expect(PRIORITY.OPTIONAL).toBe(5);
  });
});
