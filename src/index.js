/**
 * Claw-Swarm v4.0 — 蜂群统一智能插件 / Unified Swarm Intelligence Plugin
 *
 * 合并 OME 记忆引擎 + Swarm Lite 治理层 + 信息素通信 + 灵魂设计器
 * 为 OpenClaw 提供完整的多 Agent 协作基础设施。
 *
 * Merges OME memory engine + Swarm Lite governance + pheromone communication
 * + soul designer into a complete multi-agent collaboration infrastructure
 * for OpenClaw.
 *
 * @module claw-swarm
 * @version 4.0.0
 * @author DEEP-IOS
 * @license MIT
 */

import { PluginAdapter } from './layer4-adapter/plugin-adapter.js';

export default {
  id: 'claw-swarm',
  name: 'Claw-Swarm',
  version: '4.0.0',
  description: '蜂群 Claw-Swarm — Unified swarm intelligence: memory, pheromones, governance, and agent design',

  register(api) {
    const adapter = new PluginAdapter();
    adapter.register(api);
  }
};
