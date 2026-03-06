/**
 * PeerDirectory — 同伴目录 / Peer Directory
 *
 * 从 OpenClaw 的 Agent 配置中实时发现可用的同伴 Agent，
 * 提供格式化注入和查找功能。
 *
 * Discovers available peer agents from OpenClaw's agent configuration in real-time,
 * providing formatted injection and lookup capabilities.
 *
 * [WHY] 不缓存，每次调用 getDirectory() 时实时读取 api.config。
 * OpenClaw 支持热插拔，缓存会导致过期数据。
 * 性能开销可接受（读配置对象，非 DB 操作）。
 *
 * No caching — reads api.config in real-time on every call.
 * OpenClaw supports hot-plug, caching would cause stale data.
 * Performance is acceptable (config object read, not DB operation).
 *
 * @module collaboration/peer-directory
 * @author DEEP-IOS
 */
export class PeerDirectory {
  constructor(apiConfigGetter) {
    this._getConfig = apiConfigGetter;
  }

  getDirectory() {
    try {
      const config = this._getConfig();
      return config?.agents || [];
    } catch {
      return [];
    }
  }

  formatForInjection(currentAgentId) {
    const peers = this.getDirectory().filter(a => a.id !== currentAgentId);
    if (peers.length === 0) return '';
    const lines = peers.map(p =>
      `- ${p.id} (${p.label || p.name || 'agent'}): ${(p.skills || []).join(', ') || 'general'}`
    );
    return `[Peer Directory]\n${lines.join('\n')}`;
  }

  findPeer(idOrLabel) {
    return this.getDirectory().find(a =>
      a.id === idOrLabel || a.label === idOrLabel || a.name === idOrLabel
    ) || null;
  }

  count() {
    return this.getDirectory().length;
  }
}
