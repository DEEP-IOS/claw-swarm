import { describe, it, expect } from 'vitest';
import {
  buildSubagentFailureMessage,
  extractSubagentFailureReason,
  summarizeFailureContext,
} from '../../../src/L5-application/subagent-failure-message.js';

describe('subagent failure message helpers', () => {
  it('prefers event.error.message', () => {
    const reason = extractSubagentFailureReason({
      error: { message: '模型超时' },
      result: { error: 'result error' },
      reason: 'fallback reason',
    });
    expect(reason).toBe('模型超时');
  });

  it('falls back to result error/message then reason', () => {
    expect(extractSubagentFailureReason({ result: { error: 'quota exceeded' } })).toBe('quota exceeded');
    expect(extractSubagentFailureReason({ result: { message: 'context overflow' } })).toBe('context overflow');
    expect(extractSubagentFailureReason({ reason: 'manual abort' })).toBe('manual abort');
  });

  it('returns default text when no details exist', () => {
    expect(extractSubagentFailureReason({})).toBe('子代理执行未完成');
  });

  it('builds user-friendly failure message without legacy text', () => {
    const text = buildSubagentFailureMessage({
      taskId: 'task-123',
      roleName: 'reviewer',
      event: { error: { message: 'tool timeout' }, agentId: 'mpu-d2', childSessionKey: 'agent:mpu-d2:subagent:x' },
    });

    expect(text).toContain('[蜂群任务失败 | taskId: task-123 | 角色: reviewer]');
    expect(text).toContain('原因: tool timeout');
    expect(text).toContain('上下文: agent=mpu-d2 | session=agent:mpu-d2:subagent:x');
    expect(text).toContain('任务可能过大');
    expect(text).not.toContain('SubAgent ended');
  });

  it('summarizes structured context fields', () => {
    const context = summarizeFailureContext({
      agentId: 'mpu-d3',
      childSessionKey: 'agent:mpu-d3:subagent:abc',
      outcome: 'error',
      stopReason: 'tool_use_error',
    });
    expect(context).toContain('agent=mpu-d3');
    expect(context).toContain('session=agent:mpu-d3:subagent:abc');
    expect(context).toContain('outcome=error');
    expect(context).toContain('stopReason=tool_use_error');
  });
});
