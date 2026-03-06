/**
 * PheromoneDecayService — 信息素衰减后台服务 / Pheromone Decay Background Service
 *
 * 通过 api.registerService() 注册的后台服务，
 * 定期执行信息素衰减清理。
 *
 * Background service registered via api.registerService(),
 * periodically runs pheromone decay cleanup.
 *
 * [WHY] 使用 registerService 而非直接 setInterval，
 * 让 OpenClaw 管理服务生命周期。同时在 gateway_stop 中
 * 显式停止，双重保障不泄露资源。
 *
 * Uses registerService instead of raw setInterval so OpenClaw manages
 * the service lifecycle. Also explicitly stopped in gateway_stop
 * as a double guarantee against resource leaks.
 *
 * @module services/pheromone-decay-service
 * @author DEEP-IOS
 */

/**
 * 创建信息素衰减后台服务实例 / Create a pheromone decay background service instance
 *
 * 返回的对象包含 name / start() / stop() 方法，
 * 符合 OpenClaw registerService 接口。
 *
 * Returns an object with name / start() / stop() methods,
 * conforming to the OpenClaw registerService interface.
 *
 * @param {import('../../layer2-engines/pheromone/pheromone-engine.js').PheromoneEngine} pheromoneEngine
 *   信息素引擎实例 / Pheromone engine instance
 * @param {Object} config - 插件配置 / Plugin configuration
 * @param {number} [config.pheromone.decayIntervalMs=60000]
 *   衰减清理间隔毫秒数 / Decay cleanup interval in milliseconds
 * @returns {{ name: string, start: () => void, stop: () => void }}
 */
export function createPheromoneDecayService(pheromoneEngine, config) {
  return {
    name: 'pheromone-decay',

    /** @private 定时器句柄 / Interval handle */
    _interval: null,

    /**
     * 启动衰减服务 / Start the decay service
     *
     * 创建 setInterval 定期调用 pheromoneEngine.decayPass()。
     * 使用 unref() 确保定时器不阻止 Node.js 进程退出。
     */
    start() {
      const intervalMs = config.pheromone?.decayIntervalMs ?? 60000;

      this._interval = setInterval(() => {
        try {
          pheromoneEngine.decayPass();
        } catch {
          // 静默处理衰减错误，防止服务崩溃
          // Silently handle decay errors to prevent service crash
        }
      }, intervalMs);

      // 允许 Node.js 自然退出 / Allow Node.js to exit naturally
      if (this._interval && typeof this._interval.unref === 'function') {
        this._interval.unref();
      }
    },

    /**
     * 停止衰减服务 / Stop the decay service
     *
     * 清除定时器并释放引用。
     */
    stop() {
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
    },
  };
}
