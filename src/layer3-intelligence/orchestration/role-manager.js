/**
 * RoleManager — 角色管理器 / Role Manager
 *
 * 根据任务分析动态生成角色，并使用 Kahn 算法对角色依赖进行拓扑排序。
 *
 * Dynamic role generation from task analysis and topological sorting
 * of role dependencies using Kahn's algorithm.
 *
 * [WHY] 从 v3.0 移植，更新导入路径以适应 v4.0 分层架构。
 * 业务逻辑保持不变。
 * Ported from v3.0 with updated import paths for the v4.0 layered
 * architecture. Business logic unchanged.
 *
 * @module orchestration/role-manager
 * @author DEEP-IOS
 */

import { RoleStatus } from '../../layer1-core/types.js';
import { SwarmValidationError, SwarmTopologyError } from '../../layer1-core/errors.js';

// ---------------------------------------------------------------------------
// 内置角色模板 / Built-in Role Templates
// ---------------------------------------------------------------------------

/**
 * 覆盖典型软件开发生命周期的 8 个内置角色模板。
 * 模板键用作跨角色的依赖标识符。
 *
 * Eight built-in role templates covering a typical software development lifecycle.
 * Template keys are used as dependency identifiers across roles.
 *
 * @type {Record<string, import('../../layer1-core/types.js').Role>}
 */
const ROLE_TEMPLATES = {
  'architect': {
    name: 'Architect',
    description: 'Designs system architecture and component structure',
    capabilities: ['design', 'planning', 'architecture'],
    priority: 1,
    dependencies: [],
  },
  'frontend-dev': {
    name: 'FrontendDev',
    description: 'Implements user interface and client-side logic',
    capabilities: ['frontend', 'ui', 'react', 'css'],
    priority: 2,
    dependencies: ['architect'],
  },
  'backend-dev': {
    name: 'BackendDev',
    description: 'Implements server-side logic and APIs',
    capabilities: ['backend', 'api', 'database', 'server'],
    priority: 2,
    dependencies: ['architect'],
  },
  'qa-tester': {
    name: 'QATester',
    description: 'Tests functionality and ensures quality',
    capabilities: ['testing', 'qa', 'validation'],
    priority: 3,
    dependencies: ['frontend-dev', 'backend-dev'],
  },
  'devops-engineer': {
    name: 'DevOpsEngineer',
    description: 'Handles deployment and infrastructure',
    capabilities: ['deployment', 'docker', 'ci-cd', 'infrastructure'],
    priority: 4,
    dependencies: ['frontend-dev', 'backend-dev'],
  },
  'security-analyst': {
    name: 'SecurityAnalyst',
    description: 'Analyzes security and identifies risks',
    capabilities: ['security', 'audit', 'compliance'],
    priority: 3,
    dependencies: ['architect'],
  },
  'data-analyst': {
    name: 'DataAnalyst',
    description: 'Analyzes data and extracts insights',
    capabilities: ['data', 'analytics', 'visualization'],
    priority: 2,
    dependencies: [],
  },
  'technical-writer': {
    name: 'TechnicalWriter',
    description: 'Creates documentation and reports',
    capabilities: ['documentation', 'writing', 'markdown'],
    priority: 4,
    dependencies: ['architect'],
  },
};

// ---------------------------------------------------------------------------
// 需求分析关键词模式 / Keyword Patterns for Requirement Analysis
// ---------------------------------------------------------------------------

/** @type {Record<string, RegExp>} */
const REQUIREMENT_PATTERNS = {
  needsDesign:         /web|app|application|frontend|ui|interface|api|backend|server|database/i,
  needsFrontend:       /web|app|frontend|ui|interface|react|component/i,
  needsBackend:        /api|backend|server|database|storage|rest|graphql/i,
  needsTesting:        /test|qa|quality|verify|validation/i,
  needsDeployment:     /deploy|docker|kubernetes|ci-cd|infrastructure/i,
  needsSecurity:       /security|audit|vulnerability|compliance/i,
  needsDataAnalysis:   /data|analytics|visualization|statistics|report/i,
  needsDocumentation:  /document|report|manual|readme|guide/i,
};

/** 暗示全栈项目的任务类型 / Task types that imply a full-stack project. */
const FULL_STACK_TYPES = new Set(['web-app', 'full-stack']);

// ---------------------------------------------------------------------------
// RoleManager 类 / RoleManager Class
// ---------------------------------------------------------------------------

/**
 * 管理蜂群任务的角色生成、验证和依赖排序。
 * Manages role generation, validation, and dependency ordering for swarm tasks.
 */
export class RoleManager {
  /**
   * 使用内置模板的深拷贝创建新的 RoleManager。
   * Create a new RoleManager with a deep clone of the built-in templates.
   */
  constructor() {
    /** @type {Record<string, import('../../layer1-core/types.js').Role>} */
    this.templates = JSON.parse(JSON.stringify(ROLE_TEMPLATES));
  }

  // -----------------------------------------------------------------------
  // 公共 API / Public API
  // -----------------------------------------------------------------------

  /**
   * 为给定的任务配置生成有序的角色列表。
   * Generate an ordered list of roles for the given task configuration.
   *
   * 流程 / Pipeline:
   *  1. 验证任务配置 / Validate the task config
   *  2. 从描述分析需求 / Analyse requirements from the description
   *  3. 选择匹配的角色（加上自定义角色）/ Select matching roles (plus custom)
   *  4. 按依赖拓扑排序（Kahn 算法）/ Topologically sort by dependencies
   *  5. 返回深冻结副本 / Return deep-frozen copies
   *
   * @param {import('../../layer1-core/types.js').TaskConfig} taskConfig
   * @returns {import('../../layer1-core/types.js').Role[]} 排序后的冻结角色对象 / Sorted, frozen role objects.
   * @throws {SwarmValidationError} taskConfig 无效时 / If taskConfig is invalid.
   * @throws {SwarmTopologyError}   检测到依赖循环时 / If a dependency cycle is detected.
   */
  generateRoles(taskConfig) {
    // 1. 验证 / Validate
    if (!taskConfig || (!taskConfig.description && !taskConfig.type)) {
      throw new SwarmValidationError(
        'Task config must include a description or type',
        { context: { taskConfig } },
      );
    }

    // 2. 分析 / Analyse
    const requirements = this.analyzeRequirements(taskConfig);

    // 3. 选择 / Select
    const selectedRoles = this.selectRoles(requirements, taskConfig);

    // 4. 排序 / Sort
    const sorted = this.sortByDependencies(selectedRoles);

    // 5. 深冻结副本 / Deep-freeze copies
    return sorted.map((role) => {
      const copy = JSON.parse(JSON.stringify(role));
      return Object.freeze(copy);
    });
  }

  /**
   * 分析任务配置并根据关键词匹配确定需要哪些能力类别。
   *
   * Analyse a task configuration and determine which capability categories
   * are needed based on keyword matching against the description.
   *
   * @param {import('../../layer1-core/types.js').TaskConfig} taskConfig
   * @returns {Record<string, boolean>} 需求标志映射 / Map of requirement flags.
   */
  analyzeRequirements(taskConfig) {
    const description = (taskConfig.description || '').toLowerCase();
    const taskType = (taskConfig.type || '').toLowerCase();

    /** @type {Record<string, boolean>} */
    const requirements = {};

    // 将每个模式与描述匹配 / Match each pattern against the description
    for (const [key, pattern] of Object.entries(REQUIREMENT_PATTERNS)) {
      requirements[key] = pattern.test(description);
    }

    // 全栈类型自动启用设计 + 前端 + 后端 + 测试
    // Full-stack types automatically enable design + frontend + backend + testing
    if (FULL_STACK_TYPES.has(taskType)) {
      requirements.needsDesign = true;
      requirements.needsFrontend = true;
      requirements.needsBackend = true;
      requirements.needsTesting = true;
    }

    return requirements;
  }

  /**
   * 将分析后的需求映射到具体的角色实例，
   * 尊重任务配置中的自定义角色并强制执行最大角色上限。
   *
   * Map analysed requirements to concrete role instances, honouring custom
   * roles from the task config and enforcing the maximum role cap.
   *
   * @param {Record<string, boolean>} requirements - 来自 analyzeRequirements 的需求标志 / Requirement flags.
   * @param {import('../../layer1-core/types.js').TaskConfig} taskConfig
   * @returns {import('../../layer1-core/types.js').Role[]} 选中的（未排序）角色 / Selected (unsorted) roles.
   */
  selectRoles(requirements, taskConfig) {
    const maxRoles = taskConfig.constraints?.maxRoles
      ?? taskConfig.safety?.maxRoles
      ?? 8;

    /** @type {Map<string, import('../../layer1-core/types.js').Role>} */
    const selected = new Map();

    // 将需求标志映射到模板键 / Map requirement flags to template keys
    const mapping = [
      ['needsDesign',        'architect'],
      ['needsFrontend',      'frontend-dev'],
      ['needsBackend',       'backend-dev'],
      ['needsTesting',       'qa-tester'],
      ['needsDeployment',    'devops-engineer'],
      ['needsSecurity',      'security-analyst'],
      ['needsDataAnalysis',  'data-analyst'],
      ['needsDocumentation', 'technical-writer'],
    ];

    for (const [flag, templateKey] of mapping) {
      if (requirements[flag] && this.templates[templateKey]) {
        selected.set(templateKey, JSON.parse(JSON.stringify(this.templates[templateKey])));
      }
    }

    // 合并任务配置中的自定义角色 / Merge custom roles from taskConfig
    if (taskConfig.customRoles && typeof taskConfig.customRoles === 'object') {
      for (const [key, customRole] of Object.entries(taskConfig.customRoles)) {
        this.validateRole(customRole);
        selected.set(key, JSON.parse(JSON.stringify(customRole)));
      }
    }

    // 未选中任何角色时确保至少有架构师 + 一个实现者
    // Ensure at least architect + one implementer when nothing was selected
    if (selected.size === 0) {
      selected.set('architect', JSON.parse(JSON.stringify(this.templates['architect'])));
      selected.set('backend-dev', JSON.parse(JSON.stringify(this.templates['backend-dev'])));
    }

    // 解析依赖闭包：确保每个依赖都存在
    // Resolve dependency closure: ensure every dependency is present
    let changed = true;
    while (changed) {
      changed = false;
      for (const role of selected.values()) {
        for (const dep of role.dependencies) {
          if (!selected.has(dep) && this.templates[dep]) {
            selected.set(dep, JSON.parse(JSON.stringify(this.templates[dep])));
            changed = true;
          }
        }
      }
    }

    // 强制最大角色上限 — 按优先级升序保留（最重要的优先）
    // Enforce max roles cap — keep by ascending priority (most important first)
    const roles = [...selected.values()];
    if (roles.length > maxRoles) {
      roles.sort((a, b) => a.priority - b.priority);
      return roles.slice(0, maxRoles);
    }

    return roles;
  }

  /**
   * 验证角色对象是否具有所有必需字段和正确类型。
   * Validate that a role object has all required fields with correct types.
   *
   * @param {any} role - 候选角色对象 / Candidate role object.
   * @throws {SwarmValidationError} 如果缺少必需字段或类型无效 / If any required field is missing or invalid.
   */
  validateRole(role) {
    if (!role || typeof role !== 'object') {
      throw new SwarmValidationError('Role must be a non-null object', {
        context: { role },
      });
    }

    if (typeof role.name !== 'string' || role.name.trim().length === 0) {
      throw new SwarmValidationError('Role must have a non-empty string "name"', {
        context: { role },
      });
    }

    if (typeof role.description !== 'string') {
      throw new SwarmValidationError('Role must have a string "description"', {
        context: { role },
      });
    }

    if (!Array.isArray(role.capabilities)) {
      throw new SwarmValidationError('Role must have an array "capabilities"', {
        context: { role },
      });
    }

    if (!Number.isInteger(role.priority)) {
      throw new SwarmValidationError('Role must have an integer "priority"', {
        context: { role },
      });
    }

    if (!Array.isArray(role.dependencies)) {
      throw new SwarmValidationError('Role must have an array "dependencies"', {
        context: { role },
      });
    }
  }

  /**
   * 使用 Kahn 算法按依赖图拓扑排序角色。
   * Topologically sort roles by their dependency graph using Kahn's algorithm.
   *
   * 步骤 / Steps:
   *  1. 从角色依赖构建邻接表和入度映射
   *     Build an adjacency list and in-degree map from role dependencies
   *  2. 用入度为 0 的角色初始化队列
   *     Seed the queue with roles whose in-degree is 0
   *  3. 处理队列：出队、追加到排序结果、递减依赖者
   *     Process the queue: dequeue, append to sorted, decrement dependents
   *  4. 如果 sorted.length !== roles.length 则存在循环 — 检测并抛出
   *     If sorted.length !== roles.length a cycle exists — detect and throw
   *
   * @param {import('../../layer1-core/types.js').Role[]} roles
   * @returns {import('../../layer1-core/types.js').Role[]} 拓扑排序后的角色 / Topologically sorted roles.
   * @throws {SwarmTopologyError} 检测到依赖循环时 / If a dependency cycle is detected.
   */
  sortByDependencies(roles) {
    if (roles.length === 0) return [];

    // 为提供的集合构建名称到角色的查找 / Build a name-to-role lookup
    /** @type {Map<string, import('../../layer1-core/types.js').Role>} */
    const roleByName = new Map();
    for (const role of roles) {
      roleByName.set(role.name, role);
    }

    // 邻接表：依赖 -> [依赖者] / Adjacency list: dependency -> [dependents]
    /** @type {Map<string, string[]>} */
    const adjacency = new Map();

    // 每个角色名称的入度计数 / In-degree count per role name
    /** @type {Map<string, number>} */
    const inDegree = new Map();

    // 为每个角色初始化映射 / Initialise maps for every role
    for (const role of roles) {
      adjacency.set(role.name, []);
      inDegree.set(role.name, 0);
    }

    // 构建边：对于每个角色，每个依赖添加一条边 dep -> role
    // Build edges: for each role, each dependency adds an edge dep -> role
    for (const role of roles) {
      for (const depKey of role.dependencies) {
        // 将模板键解析为角色名称 / Resolve template key to role name
        const depTemplate = this.templates[depKey];
        const depName = depTemplate ? depTemplate.name : depKey;

        // 仅计算选中集合内的边 / Only count edges within the selected set
        if (roleByName.has(depName)) {
          adjacency.get(depName).push(role.name);
          inDegree.set(role.name, (inDegree.get(role.name) || 0) + 1);
        }
      }
    }

    // 用零入度角色初始化队列 / Seed queue with zero in-degree roles
    /** @type {string[]} */
    const queue = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) {
        queue.push(name);
      }
    }

    // 处理 / Process
    /** @type {import('../../layer1-core/types.js').Role[]} */
    const sorted = [];

    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(roleByName.get(current));

      for (const dependent of (adjacency.get(current) || [])) {
        const newDegree = inDegree.get(dependent) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // 循环检测 / Cycle detection
    if (sorted.length !== roles.length) {
      // 识别剩余的角色（非零入度）/ Identify remaining roles (non-zero in-degree)
      const remaining = [];
      for (const [name, degree] of inDegree) {
        if (degree > 0) {
          remaining.push(name);
        }
      }

      // 构建人类可读的循环链 / Build a human-readable cycle chain
      const cycleChain = remaining.join(' -> ') + ' -> ' + remaining[0];

      throw new SwarmTopologyError(
        `Dependency cycle detected: ${cycleChain}`,
        { cycle: remaining },
      );
    }

    return sorted;
  }

  /**
   * 返回单个角色模板的深拷贝 / Return a deep copy of a single role template.
   *
   * @param {string} templateKey - 模板标识符 / Template identifier (e.g. 'architect').
   * @returns {import('../../layer1-core/types.js').Role | null} 深拷贝或 null / Deep copy or null.
   */
  getTemplate(templateKey) {
    const template = this.templates[templateKey];
    if (!template) return null;
    return JSON.parse(JSON.stringify(template));
  }

  /**
   * 列出所有可用的模板键 / List all available template keys.
   *
   * @returns {string[]} 模板键字符串数组 / Array of template key strings.
   */
  listTemplates() {
    return Object.keys(this.templates);
  }
}
