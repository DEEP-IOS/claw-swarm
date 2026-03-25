/**
 * EmotionalState - Tracks 6D agent emotional vectors based on task outcomes
 * Dimensions: frustration, confidence, fatigue, joy, urgency, curiosity
 */
import ModuleBase from '../../core/module-base.js';
import { DIM_EMOTION, DIM_ALARM, DIM_REPUTATION } from '../../core/field/types.js';

class EmotionalState extends ModuleBase {
  constructor({ field, bus }) {
    super();
    this.field = field;
    this.bus = bus;
    this._agentStates = new Map(); // agentId -> {history, current}
    this._unsubscribers = [];
  }

  static produces() { return [DIM_EMOTION]; }
  static consumes() { return [DIM_ALARM, DIM_REPUTATION]; }
  static publishes() { return ['emotion.changed']; }
  static subscribes() { return ['agent.lifecycle.completed', 'agent.lifecycle.failed']; }

  async start() {
    const listen = this.bus?.on?.bind(this.bus);
    if (!listen) return;

    this._unsubscribers.push(
      listen('agent.lifecycle.completed', (payload) => {
        if (payload?.agentId) {
          this.recordOutcome(payload.agentId, true);
        }
      }),
      listen('agent.lifecycle.failed', (payload) => {
        if (payload?.agentId) {
          this.recordOutcome(payload.agentId, false);
        }
      }),
    );
  }

  async stop() {
    for (const unsubscribe of this._unsubscribers.splice(0)) {
      unsubscribe?.();
    }
  }

  _ensureState(agentId) {
    if (!this._agentStates.has(agentId)) {
      this._agentStates.set(agentId, {
        history: [],
        current: { frustration: 0, confidence: 0.5, fatigue: 0, joy: 0.3, urgency: 0.2, curiosity: 0.5 }
      });
    }
    return this._agentStates.get(agentId);
  }

  recordOutcome(agentId, success) {
    const state = this._ensureState(agentId);
    state.history.push({ success, ts: Date.now() });
    if (state.history.length > 10) {
      state.history = state.history.slice(-10);
    }

    const prev = { ...state.current };
    this._computeEmotion(agentId);

    const dims = ['frustration', 'confidence', 'fatigue', 'joy', 'urgency', 'curiosity'];
    const delta = dims.reduce((sum, d) => sum + Math.abs((state.current[d] || 0) - (prev[d] || 0)), 0);

    if (delta > 0.15) {
      this.bus?.publish('emotion.changed', {
        agentId,
        previous: prev,
        current: { ...state.current },
        delta
      }, this.constructor.name);
    }

    this.emitToField(agentId);
    return state.current;
  }

  _computeEmotion(agentId) {
    const state = this._agentStates.get(agentId);
    if (!state) return;

    const recent = state.history.slice(-5);
    const total = recent.length;
    if (total === 0) return;

    const successes = recent.filter(e => e.success).length;
    const failures = total - successes;

    // Streak detection for joy/curiosity
    const lastThree = recent.slice(-3);
    const streak = lastThree.length >= 3 && lastThree.every(e => e.success);
    const mixedResults = successes > 0 && failures > 0;

    state.current = {
      frustration: Math.min(1, failures * 0.25),
      confidence: Math.min(1, successes * 0.25),
      fatigue: Math.min(1, total * 0.1),
      joy: streak ? Math.min(1, successes * 0.3) : Math.max(0, successes * 0.15),
      urgency: Math.min(1, failures * 0.2 + (state.current?.urgency || 0) * 0.3),
      curiosity: mixedResults ? 0.6 : (successes > failures ? 0.4 : 0.2),
    };
  }

  getEmotion(agentId) {
    const state = this._ensureState(agentId);
    return { agentId, ...state.current, historyLength: state.history.length };
  }

  getAll() {
    const states = {};
    for (const agentId of this._agentStates.keys()) {
      states[agentId] = this.getEmotion(agentId);
    }
    return states;
  }

  emitToField(agentId) {
    const state = this._agentStates.get(agentId);
    if (!state) return;
    const { frustration, confidence, urgency } = state.current;
    this.field?.emit({
      dimension: DIM_EMOTION,
      scope: agentId,
      strength: Math.max(frustration, 1 - confidence, urgency),
      emitterId: this.constructor.name,
      metadata: { agentId, ...state.current }
    });
  }

  cleanup(agentId) {
    this._agentStates.delete(agentId);
  }
}

export { EmotionalState };
export default EmotionalState;
