/**
 * gateway_stop Hook — 网关停止钩子 / Gateway Stop Hook
 *
 * 显式清理所有资源，不依赖 unref() 行为。
 * Explicitly cleans up all resources, not relying on unref() behavior.
 *
 * [WHY] Node.js 的 unref() 在某些平台上不可靠，
 * 可能导致定时器和后台服务在进程退出后仍然泄漏。
 * 在 gateway_stop 中逐一关闭衰减服务、评估队列和监控器，
 * 确保无论退出路径如何，资源都被确定性地释放。
 * Node.js unref() is unreliable on some platforms and can leave
 * timers and background services leaking after process exit.
 * Shutting down the decay service, evaluation queue, and monitor
 * one by one in gateway_stop ensures deterministic resource release
 * regardless of the exit path.
 *
 * @module hooks/gateway-stop
 * @author DEEP-IOS
 */
export function handleGatewayStop(engines, config, logger, decayInterval) {
  logger.info('Claw-Swarm v4.0 shutting down...');

  // 1. Stop pheromone decay service
  if (decayInterval) {
    clearInterval(decayInterval);
    logger.debug('Pheromone decay service stopped');
  }

  // 2. Flush evaluation queue
  if (engines.evaluationQueue) {
    try {
      engines.evaluationQueue.shutdown();
      logger.debug('Evaluation queue flushed');
    } catch (err) {
      logger.warn('Evaluation queue flush failed:', err.message);
    }
  }

  // 3. Shutdown capability engine (停止预计算定时器 / Stop precompute timer)
  if (engines.capabilityEngine) {
    try {
      engines.capabilityEngine.shutdown();
      logger.debug('Capability engine shut down');
    } catch (err) {
      logger.warn('Capability engine shutdown failed:', err.message);
    }
  }

  // 4. Shutdown monitor
  if (engines.monitor) {
    engines.monitor.shutdown();
    logger.debug('Monitor shut down');
  }

  logger.info('Claw-Swarm v4.0 shutdown complete');
}
