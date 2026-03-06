/**
 * ModuleBase — 所有 V9 模块的抽象基类
 * Abstract base class for all V9 modules
 *
 * 每个模块必须声明自己产生/消费的信号维度和发布/订阅的事件主题，
 * 从而实现模块间依赖的静态分析与编排验证。
 * Each module must declare the signal dimensions it produces/consumes
 * and the event topics it publishes/subscribes, enabling static analysis
 * of inter-module dependencies and orchestration validation.
 *
 * @module core/module-base
 * @version 9.0.0
 */

export class ModuleBase {
  /**
   * 该模块向信号场发射的维度列表
   * Dimensions this module emits into the signal field
   * @returns {string[]} DIM_* constants
   */
  static produces() { return [] }

  /**
   * 该模块从信号场读取的维度列表
   * Dimensions this module reads from the signal field
   * @returns {string[]} DIM_* constants
   */
  static consumes() { return [] }

  /**
   * 该模块在 EventBus 上发布的事件主题
   * Event topics this module publishes on the EventBus
   * @returns {string[]} event topic strings
   */
  static publishes() { return [] }

  /**
   * 该模块在 EventBus 上订阅的事件主题
   * Event topics this module subscribes to on the EventBus
   * @returns {string[]} event topic strings
   */
  static subscribes() { return [] }

  /**
   * 启动模块（初始化资源、注册订阅等）
   * Start the module (init resources, register subscriptions, etc.)
   * @returns {Promise<void>}
   */
  async start() {}

  /**
   * 停止模块（释放资源、取消订阅等）
   * Stop the module (release resources, unsubscribe, etc.)
   * @returns {Promise<void>}
   */
  async stop() {}
}

export default ModuleBase;
