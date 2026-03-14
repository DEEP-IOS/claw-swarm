/**
 * Zustand 全局状态管理 / Zustand Global State Management
 *
 * 蜂群控制台唯一数据源，由 SSE 事件驱动更新。
 * Single source of truth for the Swarm Console, driven by SSE events.
 *
 * 9 个 Slice 合并:
 *   agent, task, pheromone, view, metrics, network, bid, settings, notification
 *
 * @module store
 * @author DEEP-IOS
 */
import { create } from 'zustand';
import { createAgentSlice } from './slices/agent-slice.js';
import { createTaskSlice } from './slices/task-slice.js';
import { createPheromoneSlice } from './slices/pheromone-slice.js';
import { createViewSlice } from './slices/view-slice.js';
import { createMetricsSlice } from './slices/metrics-slice.js';
import { createNetworkSlice } from './slices/network-slice.js';
import { createBidSlice } from './slices/bid-slice.js';
import { createSettingsSlice } from './slices/settings-slice.js';
import { createNotificationSlice } from './slices/notification-slice.js';
import { createLoggerMiddleware } from './middleware/logger.js';

/**
 * 合并 Store / Combined Store
 *
 * Zustand 的 slice pattern: 每个 createXxxSlice 返回部分 state+actions,
 * 由 create() 合并为单一 store。
 *
 * @type {import('zustand').StoreApi}
 */
const useStore = create(
  createLoggerMiddleware(
    (set, get, api) => ({
      ...createAgentSlice(set, get),
      ...createTaskSlice(set, get),
      ...createPheromoneSlice(set, get),
      ...createViewSlice(set, get),
      ...createMetricsSlice(set, get),
      ...createNetworkSlice(set, get),
      ...createBidSlice(set, get),
      ...createSettingsSlice(set, get),
      ...createNotificationSlice(set, get),

      // ── 批量更新 / Bulk update from SSE batch ──
      batchUpdate: (patch) => set(patch),
    }),
  ),
);

export default useStore;
