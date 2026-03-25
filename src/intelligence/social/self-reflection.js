/**
 * SelfReflection - Post-task introspection and skill adjustment
 * Analyzes tool usage and error patterns, updates capability/reputation
 */
import ModuleBase from '../../core/module-base.js';
import { DIM_TRAIL, DIM_ALARM } from '../../core/field/types.js';

class SelfReflection extends ModuleBase {
  constructor({ field, bus, store, capabilityEngine, reputationCRDT }) {
    super();
    this.field = field;
    this.bus = bus;
    this.store = store;
    this._capabilityEngine = capabilityEngine || null;
    this._reputationCRDT = reputationCRDT || null;
  }

  static produces() { return []; }
  static consumes() { return [DIM_TRAIL, DIM_ALARM]; }
  static publishes() { return ['reflection.completed']; }
  static subscribes() { return ['agent.completed']; }

  reflect(agentId, roleId, taskResult) {
    const { success = false, files = [], tools = [], errors = [], duration = 0 } = taskResult || {};

    // Analyze tool usage patterns
    const toolFrequency = {};
    for (const tool of tools) {
      toolFrequency[tool] = (toolFrequency[tool] || 0) + 1;
    }

    // Identify error patterns
    const errorPatterns = {};
    for (const err of errors) {
      const category = this._categorizeError(err);
      errorPatterns[category] = (errorPatterns[category] || 0) + 1;
    }

    // Determine strengths and weaknesses
    const strengths = [];
    const weaknesses = [];

    if (success && duration > 0) {
      strengths.push('task-completion');
    }
    if (files.length > 0 && errors.length === 0) {
      strengths.push('clean-output');
    }
    if (tools.length > 0 && errors.length < tools.length * 0.2) {
      strengths.push('effective-tool-use');
    }

    if (errors.length > 3) {
      weaknesses.push('error-prone');
    }
    if (!success) {
      weaknesses.push('task-failure');
    }
    if (errors.some(e => typeof e === 'string' && e.includes('timeout'))) {
      weaknesses.push('slow-execution');
    }

    // Update capability engine if available
    if (this._capabilityEngine && roleId) {
      for (const skill of strengths) {
        this._capabilityEngine.updateSkill?.(roleId, skill, 0.1);
      }
      for (const skill of weaknesses) {
        this._capabilityEngine.updateSkill?.(roleId, skill, -0.1);
      }
    }

    // Update reputation if available
    if (this._reputationCRDT && agentId) {
      if (success) {
        this._reputationCRDT.increment(agentId);
      } else {
        this._reputationCRDT.decrement(agentId);
      }
    }

    // Persist reflection
    const reflection = {
      agentId,
      roleId,
      strengths,
      weaknesses,
      toolFrequency,
      errorPatterns,
      success,
      ts: Date.now()
    };

    this.store?.put('social', `reflections-${agentId}`, this._appendReflection(agentId, reflection));

    this.bus?.publish('reflection.completed', {
      agentId,
      strengths,
      weaknesses
    }, this.constructor.name);

    return reflection;
  }

  _categorizeError(err) {
    const msg = typeof err === 'string' ? err : (err?.message || 'unknown');
    if (msg.includes('timeout')) return 'timeout';
    if (msg.includes('syntax') || msg.includes('parse')) return 'syntax';
    if (msg.includes('permission') || msg.includes('access')) return 'permission';
    if (msg.includes('not found') || msg.includes('404')) return 'not-found';
    return 'other';
  }

  _appendReflection(agentId, reflection) {
    const existing = this.store?.get('social', `reflections-${agentId}`) || [];
    const history = Array.isArray(existing) ? existing : [];
    history.push(reflection);
    // Keep last 50 reflections
    return history.slice(-50);
  }

  getReflectionHistory(agentId, limit = 10) {
    const history = this.store?.get('social', `reflections-${agentId}`) || [];
    return Array.isArray(history) ? history.slice(-limit) : [];
  }
}

export { SelfReflection };
export default SelfReflection;
