/**
 * Notification Slice / 通知切片
 *
 * 管理 Toast 通知栈。
 * Manages Toast notification stack.
 *
 * @module store/slices/notification-slice
 * @author DEEP-IOS
 */

/**
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {Object} Notification slice
 */
export const createNotificationSlice = (set, get) => ({
  // ── 通知列表 / Notification List ──
  notifications: [],
  timelineEvents: [],

  // ── 添加通知 / Add notification ──
  addNotification: (notif) => set((s) => {
    // 防御性: 确保所有字段为原始值 / Defensive: ensure all fields are primitive values
    const safe = { ...notif };
    for (const key of Object.keys(safe)) {
      if (safe[key] && typeof safe[key] === 'object' && !(safe[key] instanceof Date)) {
        safe[key] = JSON.stringify(safe[key]);
      }
    }
    const event = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      ...safe,
    };
    return {
      notifications: [event, ...s.notifications].slice(0, 50),
      timelineEvents: [event, ...s.timelineEvents].slice(0, 200),
    };
  }),

  // ── 仅添加时间线事件 / Add timeline-only event ──
  addTimelineEvent: (evt) => set((s) => {
    // 防御性: 确保所有字段为原始值 / Defensive: stringify object fields
    const safe = { ...evt };
    for (const key of Object.keys(safe)) {
      if (safe[key] && typeof safe[key] === 'object' && !(safe[key] instanceof Date)) {
        safe[key] = JSON.stringify(safe[key]);
      }
    }
    return { timelineEvents: [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        ...safe,
      },
      ...s.timelineEvents,
    ].slice(0, 200) };
  }),

  // ── 关闭通知 / Dismiss notification ──
  dismissNotification: (id) => set((s) => ({
    notifications: s.notifications.filter((n) => n.id !== id),
  })),

  // ── 清空通知 / Clear toast notifications ──
  clearNotifications: () => set({ notifications: [] }),

  // ── 清空时间线 / Clear timeline ──
  clearTimelineEvents: () => set({ timelineEvents: [] }),
});
