/**
 * @fileoverview Claw-Swarm V5.0 - Logger Factory
 * 日志工厂 - 基于 pino 的结构化日志系统
 *
 * L1 Infrastructure Layer - Provides structured logging for all subsystems.
 * L1 基础设施层 - 为所有子系统提供结构化日志记录。
 *
 * Usage / 用法:
 *   import { createLogger, createChildLogger } from './logger.js';
 *
 *   const logger = createLogger({ name: 'orchestrator', level: 'debug' });
 *   logger.info('System started');
 *
 *   const childLogger = createChildLogger(logger, 'task-scheduler');
 *   childLogger.debug({ taskId: '123' }, 'Task scheduled');
 */

import pino from 'pino';

/**
 * Create a configured pino logger instance.
 * 创建一个已配置的 pino 日志实例。
 *
 * @param {Object} [options] - Logger configuration options / 日志配置选项
 * @param {string} [options.name='swarm'] - Logger name, appears in every log line / 日志名称，出现在每条日志中
 * @param {string} [options.level='info'] - Minimum log level (debug|info|warn|error|fatal) / 最低日志级别
 * @param {boolean} [options.pretty=false] - Enable pretty-printing for development / 启用开发环境美化输出
 * @returns {import('pino').Logger} Configured pino logger instance / 已配置的 pino 日志实例
 */
export function createLogger(options = {}) {
  const { name = 'swarm', level = 'info', pretty = false } = options;

  /** @type {import('pino').LoggerOptions} */
  const pinoOptions = {
    name,
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (pretty) {
    pinoOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(pinoOptions);
}

/**
 * Create a child logger bound to a specific module.
 * 创建绑定到特定模块的子日志器。
 *
 * Child loggers inherit the parent's configuration and add a `module` field
 * to every log entry, making it easy to trace logs back to their origin.
 * 子日志器继承父级配置，并在每条日志中添加 `module` 字段，便于追踪日志来源。
 *
 * @param {import('pino').Logger} parent - Parent logger instance / 父日志实例
 * @param {string} moduleName - Module identifier (e.g. 'pheromone-engine') / 模块标识符
 * @returns {import('pino').Logger} Child logger with module binding / 带模块绑定的子日志器
 */
export function createChildLogger(parent, moduleName) {
  return parent.child({ module: moduleName });
}
