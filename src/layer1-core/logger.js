/**
 * Logger — 日志工具 / Logging utility
 *
 * 统一的日志接口，支持级别过滤和前缀标记。
 * Unified logging interface with level filtering and prefix tagging.
 *
 * [WHY] OpenClaw 插件环境中 console.log 可能被重定向，
 * 所以提供统一接口便于未来切换日志后端。
 * In OpenClaw's plugin environment console.log may be redirected,
 * so a unified interface enables future backend switching.
 *
 * @module logger
 * @author DEEP-IOS
 */

const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

export function createLogger(prefix = 'swarm', level = 'info') {
  const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  const tag = `[${prefix}]`;

  return Object.freeze({
    debug(...args) { if (threshold >= LOG_LEVELS.debug) console.debug(tag, ...args); },
    info(...args)  { if (threshold >= LOG_LEVELS.info)  console.info(tag, ...args); },
    warn(...args)  { if (threshold >= LOG_LEVELS.warn)  console.warn(tag, ...args); },
    error(...args) { if (threshold >= LOG_LEVELS.error) console.error(tag, ...args); },

    // Create child logger with sub-prefix
    // 创建带子前缀的子日志器
    child(subPrefix) {
      return createLogger(`${prefix}:${subPrefix}`, level);
    },
  });
}
