/**
 * Zustand Persist Middleware / Zustand 持久化中间件
 *
 * 将指定的 state 键持久化到 localStorage。
 * Persists specified state keys to localStorage.
 *
 * 注意: Settings slice 已内置 localStorage 持久化。
 * 本中间件用于未来可能的其他 slice 持久化需求。
 *
 * @module store/middleware/persist
 * @author DEEP-IOS
 */

const STORAGE_PREFIX = 'claw-swarm-';

/**
 * 创建持久化中间件 / Create persist middleware
 *
 * @param {string[]} keys - 需要持久化的 state 键
 * @param {string} [namespace='store'] - localStorage 键前缀
 * @returns {Function} Middleware wrapper
 */
export function createPersistMiddleware(keys, namespace = 'store') {
  const storageKey = `${STORAGE_PREFIX}${namespace}`;

  return (config) => (set, get, api) => {
    // 加载持久化数据 / Load persisted data
    let persisted = {};
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) persisted = JSON.parse(raw);
    } catch { /* ignore */ }

    // 创建原始 state / Create original state
    const state = config(
      (...args) => {
        set(...args);
        // 保存到 localStorage / Save to localStorage
        const current = get();
        const toSave = {};
        for (const key of keys) {
          if (key in current && typeof current[key] !== 'function') {
            toSave[key] = current[key];
          }
        }
        try {
          localStorage.setItem(storageKey, JSON.stringify(toSave));
        } catch { /* quota exceeded */ }
      },
      get,
      api,
    );

    // 合并持久化数据 / Merge persisted data
    for (const key of keys) {
      if (key in persisted) {
        state[key] = persisted[key];
      }
    }

    return state;
  };
}
