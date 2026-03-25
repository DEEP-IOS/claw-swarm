/**
 * ExternalAPIRegistry — 外部 API 集成注册中心
 *
 * 为蜂群的非编码场景提供外部数据获取能力:
 *   - 社交媒体 API (微博、Twitter/X、微信公众号)
 *   - 学术 API (Semantic Scholar, arXiv, Google Scholar proxy)
 *   - 金融 API (Yahoo Finance, Alpha Vantage, 同花顺)
 *   - 搜索 API (Google, Bing, DuckDuckGo)
 *   - 内容发布 API (WordPress, Ghost, Medium)
 *
 * 设计原则:
 *   1. 注册制 — 用户通过 config 注册 API 凭证
 *   2. 工具暴露 — 每个 API 自动暴露为 swarm tool
 *   3. 速率限制 — 内置 per-API 速率限制
 *   4. 回退 — API 失败时通过 WebFetch/WebSearch 降级
 *
 * @module bridge/integrations/external-api-registry
 * @version 9.2.0
 */

const DEFAULT_RATE_LIMIT = { maxPerMinute: 30, maxPerHour: 500 };

/**
 * 内置 API 适配器定义
 */
const BUILTIN_ADAPTERS = {
  // ── 学术搜索 ──
  'semantic-scholar': {
    name: 'Semantic Scholar',
    category: 'academic',
    baseUrl: 'https://api.semanticscholar.org/graph/v1',
    rateLimit: { maxPerMinute: 10, maxPerHour: 100 },
    methods: {
      search: {
        path: '/paper/search',
        params: ['query', 'limit', 'fields'],
        description: '搜索学术论文',
      },
      paper: {
        path: '/paper/{paperId}',
        params: ['paperId', 'fields'],
        description: '获取论文详情',
      },
      citations: {
        path: '/paper/{paperId}/citations',
        params: ['paperId', 'limit'],
        description: '获取引用论文',
      },
    },
  },

  'arxiv': {
    name: 'arXiv',
    category: 'academic',
    baseUrl: 'http://export.arxiv.org/api',
    rateLimit: { maxPerMinute: 5, maxPerHour: 60 },
    methods: {
      search: {
        path: '/query',
        params: ['search_query', 'max_results', 'sortBy'],
        description: '搜索 arXiv 论文',
      },
    },
  },

  // ── 金融数据 ──
  'yahoo-finance': {
    name: 'Yahoo Finance',
    category: 'finance',
    baseUrl: 'https://query1.finance.yahoo.com/v8/finance',
    rateLimit: { maxPerMinute: 20, maxPerHour: 200 },
    methods: {
      quote: {
        path: '/chart/{symbol}',
        params: ['symbol', 'range', 'interval'],
        description: '获取股票行情',
      },
    },
  },

  // ── 搜索 ──
  'duckduckgo': {
    name: 'DuckDuckGo',
    category: 'search',
    baseUrl: 'https://api.duckduckgo.com',
    rateLimit: { maxPerMinute: 10, maxPerHour: 100 },
    methods: {
      search: {
        path: '/',
        params: ['q', 'format'],
        defaults: { format: 'json' },
        description: '搜索网页',
      },
    },
  },

  // ── 内容发布 ──
  'wordpress': {
    name: 'WordPress REST API',
    category: 'publishing',
    baseUrl: null, // 需要用户提供
    requiresAuth: true,
    authType: 'bearer',
    rateLimit: { maxPerMinute: 30, maxPerHour: 300 },
    methods: {
      createPost: {
        path: '/wp-json/wp/v2/posts',
        method: 'POST',
        params: ['title', 'content', 'status', 'categories', 'tags'],
        description: '发布文章',
      },
      listPosts: {
        path: '/wp-json/wp/v2/posts',
        params: ['per_page', 'page', 'search'],
        description: '获取文章列表',
      },
    },
  },
};

export class ExternalAPIRegistry {
  /**
   * @param {Object} opts
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.bus
   * @param {Object} [opts.config]
   * @param {Object} [opts.config.apis] - 用户自定义 API 配置 { apiId: { apiKey, baseUrl, ... } }
   */
  constructor({ bus, config = {} }) {
    this._bus = bus;

    /** @type {Map<string, Object>} */
    this._adapters = new Map();

    /** @type {Map<string, { count: number, resetAt: number }>} */
    this._rateLimits = new Map();

    /** @type {Object} */
    this._userConfig = config.apis || {};

    this._stats = { totalCalls: 0, successes: 0, failures: 0, rateLimited: 0 };

    // 注册内置适配器
    for (const [id, adapter] of Object.entries(BUILTIN_ADAPTERS)) {
      this._adapters.set(id, { ...adapter, userConfig: this._userConfig[id] || {} });
    }

    // 注册用户自定义 API
    for (const [id, userApi] of Object.entries(this._userConfig)) {
      if (!this._adapters.has(id) && userApi.baseUrl) {
        this._adapters.set(id, {
          name: userApi.name || id,
          category: userApi.category || 'custom',
          baseUrl: userApi.baseUrl,
          rateLimit: userApi.rateLimit || DEFAULT_RATE_LIMIT,
          methods: userApi.methods || {},
          requiresAuth: !!userApi.apiKey,
          userConfig: userApi,
        });
      }
    }
  }

  /**
   * 列出所有可用 API
   * @returns {Array<{ id: string, name: string, category: string, available: boolean }>}
   */
  listAPIs() {
    const result = [];
    for (const [id, adapter] of this._adapters) {
      const available = !adapter.requiresAuth ||
        !!(adapter.userConfig?.apiKey || adapter.userConfig?.token);
      result.push({
        id,
        name: adapter.name,
        category: adapter.category,
        available,
        methods: Object.keys(adapter.methods || {}),
      });
    }
    return result;
  }

  /**
   * 调用外部 API
   * @param {string} apiId - API 标识
   * @param {string} method - 方法名
   * @param {Object} params - 参数
   * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
   */
  async call(apiId, method, params = {}) {
    const adapter = this._adapters.get(apiId);
    if (!adapter) {
      return { ok: false, error: `Unknown API: ${apiId}` };
    }

    const methodDef = adapter.methods?.[method];
    if (!methodDef) {
      return { ok: false, error: `Unknown method: ${apiId}.${method}` };
    }

    // 速率限制检查
    if (this._isRateLimited(apiId, adapter.rateLimit || DEFAULT_RATE_LIMIT)) {
      this._stats.rateLimited++;
      return { ok: false, error: `Rate limited: ${apiId}` };
    }

    // 构建 URL
    const baseUrl = adapter.userConfig?.baseUrl || adapter.baseUrl;
    if (!baseUrl) {
      return { ok: false, error: `No baseUrl configured for: ${apiId}` };
    }

    let path = methodDef.path;
    // 替换路径参数 {param}
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    }

    const url = new URL(path, baseUrl);

    // 添加查询参数
    const httpMethod = (methodDef.method || 'GET').toUpperCase();
    const defaults = methodDef.defaults || {};
    const queryParams = { ...defaults };

    if (httpMethod === 'GET') {
      for (const [key, value] of Object.entries(params)) {
        if (!path.includes(`{${key}}`)) {
          queryParams[key] = value;
        }
      }
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    // 构建 headers
    const headers = { 'Accept': 'application/json' };
    const apiKey = adapter.userConfig?.apiKey || adapter.userConfig?.token;
    if (apiKey) {
      if (adapter.authType === 'bearer') {
        headers['Authorization'] = `Bearer ${apiKey}`;
      } else {
        headers['x-api-key'] = apiKey;
      }
    }

    this._stats.totalCalls++;

    try {
      const fetchOpts = { method: httpMethod, headers };
      if (httpMethod === 'POST' && Object.keys(params).length > 0) {
        headers['Content-Type'] = 'application/json';
        fetchOpts.body = JSON.stringify(params);
      }

      const response = await fetch(url.toString(), fetchOpts);

      if (!response.ok) {
        this._stats.failures++;
        return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const contentType = response.headers.get('content-type') || '';
      let data;
      if (contentType.includes('json')) {
        data = await response.json();
      } else if (contentType.includes('xml')) {
        data = await response.text(); // XML 返回原始文本
      } else {
        data = await response.text();
      }

      this._stats.successes++;
      this._bus?.publish?.('api.external.called', {
        apiId, method, success: true, ts: Date.now(),
      }, 'external-api');

      return { ok: true, data };
    } catch (err) {
      this._stats.failures++;
      return { ok: false, error: err.message };
    }
  }

  // ── 速率限制 ──────────────────────────────────────────────

  _isRateLimited(apiId, limits) {
    const now = Date.now();
    const key = apiId;
    let window = this._rateLimits.get(key);

    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + 60000 };
      this._rateLimits.set(key, window);
    }

    window.count++;
    return window.count > (limits.maxPerMinute || 30);
  }

  // ── 生成 swarm tools ──────────────────────────────────────

  /**
   * 为所有可用 API 生成 swarm tool 定义
   * @returns {Array<Object>} tool definitions
   */
  generateTools() {
    const tools = [];
    for (const [apiId, adapter] of this._adapters) {
      for (const [methodName, methodDef] of Object.entries(adapter.methods || {})) {
        tools.push({
          name: `api_${apiId}_${methodName}`.replace(/-/g, '_'),
          description: `[${adapter.name}] ${methodDef.description || methodName}`,
          input_schema: {
            type: 'object',
            properties: Object.fromEntries(
              (methodDef.params || []).map(p => [p, { type: 'string', description: p }])
            ),
          },
          handler: async (input) => {
            const result = await this.call(apiId, methodName, input);
            return result;
          },
        });
      }
    }
    return tools;
  }

  getStats() {
    return {
      ...this._stats,
      registeredAPIs: this._adapters.size,
      availableAPIs: this.listAPIs().filter(a => a.available).length,
    };
  }
}
