/**
 * Unit tests for bridge/interaction/task-presenter.js
 * TaskPresenter: completion/failure formatting, CJK width, truncation, impact
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TaskPresenter } from '../../../src/bridge/interaction/task-presenter.js';

describe('TaskPresenter', () => {
  let presenter;

  beforeEach(() => {
    presenter = new TaskPresenter({ maxFilesShown: 5, maxSummaryWidth: 40 });
  });

  // ── formatCompletion ─────────────────────────────────────────────

  it('returns summary, filesChanged, potentialImpact, nextSteps, confidence', () => {
    const result = presenter.formatCompletion({
      summary: 'Refactored auth module',
      filesChanged: ['src/auth.js'],
      confidence: 0.95,
    });
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('filesChanged');
    expect(result).toHaveProperty('potentialImpact');
    expect(result).toHaveProperty('nextSteps');
    expect(result.confidence).toBe(0.95);
  });

  it('clamps confidence to [0, 1]', () => {
    expect(presenter.formatCompletion({ confidence: 5 }).confidence).toBe(1);
    expect(presenter.formatCompletion({ confidence: -1 }).confidence).toBe(0);
  });

  it('defaults confidence to 0.8 when not provided', () => {
    expect(presenter.formatCompletion({}).confidence).toBe(0.8);
  });

  it('builds summary from output first line when summary is absent', () => {
    const result = presenter.formatCompletion({ output: 'Line one\nLine two' });
    expect(result.summary).toContain('Line one');
    expect(result.summary).not.toContain('Line two');
  });

  it('builds summary from filesChanged count when no text is available', () => {
    const result = presenter.formatCompletion({ filesChanged: ['a.js', 'b.js'] });
    expect(result.summary).toContain('2 file(s) modified');
  });

  // ── formatFailure ────────────────────────────────────────────────

  it('returns reason, error, suggestion, severity, class', () => {
    const err = new Error('ENOENT: file not found');
    const cls = { suggestedStrategy: 'retry_with_fix', severity: 'high', class: 'tool_error' };
    const out = presenter.formatFailure(err, cls);

    expect(out.error).toBe('ENOENT: file not found');
    expect(out.suggestion).toBe('retry_with_fix');
    expect(out.severity).toBe('high');
    expect(out.class).toBe('tool_error');
    expect(out.reason).toContain('auto-retry');
  });

  it('handles string error', () => {
    const out = presenter.formatFailure('timeout', null);
    expect(out.error).toBe('timeout');
    expect(out.suggestion).toBe('retry');
  });

  it('handles null error gracefully', () => {
    const out = presenter.formatFailure(null);
    expect(out.error).toBe('Unknown error');
  });

  // ── CJK display length ──────────────────────────────────────────

  it('counts ASCII characters as width 1', () => {
    expect(presenter._getDisplayLength('hello')).toBe(5);
  });

  it('counts CJK characters as width 2', () => {
    // 3 CJK chars = 6 width
    expect(presenter._getDisplayLength('测试中')).toBe(6);
  });

  it('handles mixed ASCII + CJK', () => {
    // 'ab' = 2 + '中文' = 4 => 6
    expect(presenter._getDisplayLength('ab中文')).toBe(6);
  });

  it('returns 0 for empty/null input', () => {
    expect(presenter._getDisplayLength('')).toBe(0);
    expect(presenter._getDisplayLength(null)).toBe(0);
  });

  // ── Text truncation ──────────────────────────────────────────────

  it('truncates long text to maxWidth with ellipsis', () => {
    const long = 'A'.repeat(100);
    const truncated = presenter._truncateToWidth(long, 20);
    expect(truncated.length).toBeLessThanOrEqual(20);
    expect(truncated).toContain('...');
  });

  it('does not truncate short text', () => {
    expect(presenter._truncateToWidth('short', 20)).toBe('short');
  });

  it('handles CJK truncation correctly', () => {
    // Each CJK char = 2 width; max 10 means at most 3 chars + '...' (3 chars)
    const truncated = presenter._truncateToWidth('测试一二三四五', 10);
    expect(truncated).toContain('...');
    expect(presenter._getDisplayLength(truncated.replace('...', ''))).toBeLessThanOrEqual(10);
  });

  // ── formatProgress ───────────────────────────────────────────────

  it('returns "No progress yet." for empty steps', () => {
    expect(presenter.formatProgress([])).toBe('No progress yet.');
  });

  it('includes step count and last step description', () => {
    const steps = [
      { description: 'Scanned files' },
      { description: 'Applied patch' },
    ];
    const out = presenter.formatProgress(steps);
    expect(out).toContain('2 step(s) completed');
    expect(out).toContain('Applied patch');
  });

  // ── _normalizeFiles ──────────────────────────────────────────────

  it('normalizes object entries with path+action', () => {
    const files = presenter._normalizeFiles([
      { path: 'a.js', action: 'created' },
      'b.js',
    ]);
    expect(files).toContain('a.js (created)');
    expect(files).toContain('b.js');
  });

  it('truncates file list when exceeding maxFilesShown', () => {
    const many = Array.from({ length: 8 }, (_, i) => `file${i}.js`);
    const normalized = presenter._normalizeFiles(many);
    // maxFilesShown = 5 → 5 entries + 1 "... and N more"
    expect(normalized).toHaveLength(6);
    expect(normalized[5]).toContain('and 3 more');
  });

  // ── _assessImpact ────────────────────────────────────────────────

  it('classifies source and config files and sets risk level', () => {
    const impact = presenter._assessImpact(['src/index.js', 'config.json']);
    expect(impact.categories.source).toBe(1);
    expect(impact.categories.config).toBe(1);
    expect(impact.riskLevel).toBe('medium'); // config present
  });

  // ── Empty input safety ───────────────────────────────────────────

  it('formatCompletion handles null result gracefully', () => {
    const result = presenter.formatCompletion(null);
    expect(result.summary).toBe('Task completed (no details available).');
    expect(result.filesChanged).toEqual([]);
  });
});
