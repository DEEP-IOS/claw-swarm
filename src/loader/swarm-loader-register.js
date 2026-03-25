/**
 * Claw-Swarm Loader Registration
 *
 * 使用 Node.js 20+ 的 module.register() 注册 ESM loader hook。
 *
 * 用法:
 *   node --import ./src/loader/swarm-loader-register.js your-app.js
 *
 * 或设置环境变量:
 *   NODE_OPTIONS="--import=./src/loader/swarm-loader-register.js"
 *
 * 效果:
 *   OpenClaw 进程加载时，所有 dist/* 模块在进入 V8 前被自动 transform。
 *   不修改任何磁盘文件。每次进程启动自动生效。
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
  './swarm-loader.js',
  pathToFileURL(import.meta.url),
);

if (process.env.SWARM_LOADER_VERBOSE) {
  console.log('[swarm-loader] Registered — all openclaw/dist modules will be transformed at load time');
}
