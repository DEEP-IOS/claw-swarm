/**
 * Node.js ESM Loader — Claw-Swarm Runtime Transform
 *
 * 注册为 Node.js customize hook:
 *   node --import ./src/loader/swarm-loader-register.js app.js
 *
 * 拦截所有 openclaw/dist/* 模块的加载，在源码进入 V8 前应用 transform。
 */

import { transformSource, getStats, validatePatches } from './swarm-loader-hooks.js';

const OPENCLAW_DIST_RE = /[/\\]openclaw[/\\]dist[/\\]/;

// ── 延迟验证: 在进程加载完主要模块后检查 patch 完整性 ─────────────
let _validationScheduled = false;
function scheduleValidation() {
  if (_validationScheduled) return;
  _validationScheduled = true;
  // 延迟 5 秒执行验证，确保大部分 dist 模块已加载
  setTimeout(() => {
    const result = validatePatches();
    if (result.ok) {
      if (process.env.SWARM_LOADER_VERBOSE) {
        console.log(`[swarm-loader] ✓ Patch 验证通过: ${result.actual}/${result.expected} patches applied`);
      }
    }
    // 警告在 validatePatches() 内部已输出
  }, 5000).unref?.(); // unref 防止阻止进程退出
}

/**
 * Node.js load hook — 拦截模块源码
 */
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);

  // 只处理 openclaw/dist 下的 JS 文件
  if (!OPENCLAW_DIST_RE.test(url)) return result;
  if (result.format !== 'module' && result.format !== 'commonjs') return result;

  // 获取源码
  let source;
  if (typeof result.source === 'string') {
    source = result.source;
  } else if (result.source instanceof Uint8Array || Buffer.isBuffer(result.source)) {
    source = Buffer.from(result.source).toString('utf-8');
  } else {
    return result;
  }

  // 应用 transform
  const { source: transformed, patched } = transformSource(source, url);

  if (patched) {
    const stats = getStats();
    // 静默，除非设置了 SWARM_LOADER_VERBOSE
    if (process.env.SWARM_LOADER_VERBOSE) {
      const shortUrl = url.split('/openclaw/dist/')[1] || url;
      console.log(`[swarm-loader] ${shortUrl} — patched (total: ${stats.patchCount} patches across ${stats.fileCount} files)`);
    }
    // 调度延迟验证
    scheduleValidation();
  }

  return {
    ...result,
    source: transformed,
    shortCircuit: true,
  };
}

/**
 * Node.js resolve hook — 不需要修改，直接透传
 */
export async function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, context);
}
