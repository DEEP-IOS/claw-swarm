/**
 * PersonaEvolution — 人格进化 / Persona Evolution
 *
 * 记录每种人格模板在不同任务类型上的表现，
 * 通过胜率分析持续改进推荐准确度。
 *
 * Records the performance of each persona template across different task types,
 * and continuously improves recommendation accuracy through win-rate analysis.
 *
 * [WHY] 静态的人格推荐无法适应实际表现差异。
 * 通过持久化 persona-task 胜率数据，系统可以学习"哪个人格最适合哪类任务"，
 * 实现数据驱动的人格分配。
 * Static persona recommendations cannot adapt to real-world performance differences.
 * By persisting persona-task win-rate data, the system learns "which persona works
 * best for which task type", enabling data-driven persona assignment.
 *
 * @module soul/persona-evolution
 * @author DEEP-IOS
 */

import * as db from '../../layer1-core/db.js';

export class PersonaEvolution {
  // Record the outcome of a persona being used on a task
  recordOutcome({ personaId, taskType, success, qualityScore, durationMs, notes }) {
    return db.recordPersonaOutcome({
      personaId, taskType,
      success: success ? 1 : 0,
      qualityScore: qualityScore ?? null,
      durationMs: durationMs ?? null,
      notes: notes ? JSON.stringify(notes) : null,
    });
  }

  // Get win rate statistics for a persona on a given task type
  getStats(personaId, taskType) {
    return db.getPersonaStats(personaId, taskType || null);
  }

  // Get the best persona for a task type based on historical win rates
  getBestPersona(taskType) {
    return db.getBestPersona(taskType);
  }
}
