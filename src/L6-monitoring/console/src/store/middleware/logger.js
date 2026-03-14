/**
 * Zustand Logger Middleware / Zustand 日志中间件
 *
 * 开发模式下记录 state 变更，便于调试。
 * Logs state changes in development mode for debugging.
 *
 * @module store/middleware/logger
 * @author DEEP-IOS
 */

const IS_DEV = typeof import.meta !== 'undefined' &&
  import.meta.env?.DEV === true;

/**
 * Logger 中间件 / Logger middleware
 *
 * 在开发模式下将每次 state 变更打印到 console，
 * 生产模式下为直通 (无性能影响)。
 *
 * @param {Function} config - Zustand state creator
 * @returns {Function} Wrapped state creator
 */
export function createLoggerMiddleware(config) {
  if (!IS_DEV) return config;

  return (set, get, api) =>
    config(
      (...args) => {
        const prev = get();
        set(...args);
        const next = get();

        // 仅在有实际变更时打印 / Only log actual changes
        const changedKeys = [];
        for (const key of Object.keys(next)) {
          if (typeof next[key] !== 'function' && prev[key] !== next[key]) {
            changedKeys.push(key);
          }
        }

        if (changedKeys.length > 0) {
          console.groupCollapsed(
            `%c[Store] ${changedKeys.join(', ')}`,
            'color: #8B5CF6; font-weight: 600;',
          );
          for (const key of changedKeys) {
            console.log(`  ${key}:`, prev[key], '→', next[key]);
          }
          console.groupEnd();
        }
      },
      get,
      api,
    );
}
