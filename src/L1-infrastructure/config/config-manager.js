/**
 * ConfigManager — 分层配置管理 / Layered Configuration Management
 *
 * 提供:
 * - zod 校验 (ConfigSchema)
 * - 默认值 → 文件配置 → 运行时覆盖 三层合并
 * - 配置变更通知
 * - 热重载 (可选)
 *
 * Provides:
 * - zod validation (ConfigSchema)
 * - Default → File → Runtime override three-layer merge
 * - Configuration change notification
 * - Hot reload (optional)
 *
 * @module L1-infrastructure/config/config-manager
 * @author DEEP-IOS
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigSchema, DEFAULT_CONFIG, mergeConfig } from '../schemas/config-schemas.js';

export class ConfigManager {
  /**
   * @param {Object} [options]
   * @param {string} [options.configPath] - 配置文件路径 / Config file path
   * @param {Object} [options.overrides] - 运行时覆盖 / Runtime overrides
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    /** @type {Object} 最终合并配置 / Final merged config */
    this._config = null;

    /** @type {string | null} */
    this._configPath = options.configPath || null;

    /** @type {Object} */
    this._overrides = options.overrides || {};

    /** @type {Object} */
    this._logger = options.logger || console;

    /** @type {Set<Function>} 变更监听器 / Change listeners */
    this._listeners = new Set();
  }

  /**
   * 加载并校验配置
   * Load and validate configuration
   *
   * 合并顺序: DEFAULT_CONFIG → fileConfig → overrides
   *
   * @returns {Object} 校验后的配置
   */
  load() {
    let fileConfig = {};

    // 1. 尝试从文件加载 / Try loading from file
    if (this._configPath) {
      fileConfig = this._loadFile(this._configPath);
    }

    // 2. 合并: 默认 → 文件 → 覆盖 / Merge: default → file → overrides
    const merged = this._deepMerge(
      {},
      fileConfig,
      this._overrides,
    );

    // 3. zod 校验 / zod validation
    try {
      this._config = mergeConfig(merged);
    } catch (err) {
      this._logger.error?.(`[ConfigManager] Validation failed: ${err.message}`);
      // 降级到默认配置 / Fallback to default config
      this._config = { ...DEFAULT_CONFIG };
      this._logger.warn?.('[ConfigManager] Using default configuration');
    }

    this._logger.info?.('[ConfigManager] Configuration loaded');
    return this._config;
  }

  /**
   * 获取完整配置
   * Get full configuration
   *
   * @returns {Object}
   */
  getConfig() {
    if (!this._config) {
      return this.load();
    }
    return this._config;
  }

  /**
   * 获取配置子路径
   * Get config value by dot-path
   *
   * @param {string} path - 点分路径 / Dot-separated path (e.g. 'orchestration.maxWorkers')
   * @param {any} [defaultValue]
   * @returns {any}
   */
  get(path, defaultValue = undefined) {
    const config = this.getConfig();
    const parts = path.split('.');
    let current = config;

    for (const part of parts) {
      if (current == null || typeof current !== 'object') {
        return defaultValue;
      }
      current = current[part];
    }

    return current !== undefined ? current : defaultValue;
  }

  /**
   * 运行时更新配置 (会触发变更通知)
   * Runtime config update (triggers change notification)
   *
   * @param {string} path - 点分路径
   * @param {any} value
   */
  set(path, value) {
    const config = this.getConfig();
    const parts = path.split('.');
    let current = config;

    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }

    const oldValue = current[parts[parts.length - 1]];
    current[parts[parts.length - 1]] = value;

    // 重新校验 / Re-validate
    try {
      this._config = ConfigSchema.parse(config);
    } catch (err) {
      // 回滚 / Rollback
      current[parts[parts.length - 1]] = oldValue;
      throw new Error(`Invalid config value for '${path}': ${err.message}`);
    }

    // 通知监听器 / Notify listeners
    this._notifyChange(path, oldValue, value);
  }

  /**
   * 注册变更监听器
   * Register change listener
   *
   * @param {(path: string, oldValue: any, newValue: any) => void} listener
   * @returns {() => void} unsubscribe function
   */
  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * 重新加载配置
   * Reload configuration
   */
  reload() {
    const oldConfig = this._config;
    this.load();
    this._logger.info?.('[ConfigManager] Configuration reloaded');

    // 通知整体变更 / Notify full change
    if (oldConfig) {
      this._notifyChange('*', oldConfig, this._config);
    }

    return this._config;
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 从文件加载 JSON 配置
   * Load JSON config from file
   */
  _loadFile(filePath) {
    const absPath = resolve(filePath);

    if (!existsSync(absPath)) {
      this._logger.warn?.(`[ConfigManager] Config file not found: ${absPath}`);
      return {};
    }

    try {
      const content = readFileSync(absPath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      this._logger.error?.(`[ConfigManager] Failed to parse config file: ${err.message}`);
      return {};
    }
  }

  /**
   * 深度合并对象
   * Deep merge objects
   */
  _deepMerge(target, ...sources) {
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;

      for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          if (!target[key] || typeof target[key] !== 'object') {
            target[key] = {};
          }
          this._deepMerge(target[key], value);
        } else {
          target[key] = value;
        }
      }
    }
    return target;
  }

  /**
   * 通知变更监听器
   * Notify change listeners
   */
  _notifyChange(path, oldValue, newValue) {
    for (const listener of this._listeners) {
      try {
        listener(path, oldValue, newValue);
      } catch (err) {
        this._logger.warn?.(`[ConfigManager] Listener error: ${err.message}`);
      }
    }
  }
}
