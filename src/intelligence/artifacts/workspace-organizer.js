/**
 * WorkspaceOrganizer — 工作空间结构分析与路径推荐
 * Analyzes project structure and suggests file placement conventions.
 *
 * @module intelligence/artifacts/workspace-organizer
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_KNOWLEDGE } from '../../core/field/types.js';
import { createRequire } from 'node:module';

const esmRequire = createRequire(import.meta.url);

// ============================================================================
// WorkspaceOrganizer
// ============================================================================

class WorkspaceOrganizer extends ModuleBase {
  /**
   * @param {object} deps
   * @param {object} deps.store - DomainStore
   */
  constructor({ store }) {
    super();
    this._store = store;
  }

  static consumes() { return [DIM_KNOWLEDGE]; }

  // --------------------------------------------------------------------------
  // Structure analysis
  // --------------------------------------------------------------------------

  /**
   * 分析项目目录结构 / Analyze a project's directory structure.
   * @param {string} projectRoot - absolute path
   * @returns {object} {type, sourceDir, testDir, configDir, conventions}
   */
  analyzeStructure(projectRoot) {
    const entries = safeReaddir(projectRoot);

    const hasSrc      = entries.includes('src');
    const hasPackages  = entries.includes('packages') || entries.includes('apps');
    const hasTests     = entries.includes('tests') || entries.includes('test') || entries.includes('__tests__');
    const hasConfig    = entries.includes('config') || entries.includes('.config');

    const type = hasPackages ? 'monorepo' : hasSrc ? 'standard' : 'flat';

    const sourceDir = hasSrc ? 'src' : '.';
    const testDir   = entries.includes('tests') ? 'tests'
                    : entries.includes('test')  ? 'test'
                    : entries.includes('__tests__') ? '__tests__'
                    : 'tests';
    const configDir = hasConfig
      ? (entries.includes('config') ? 'config' : '.config')
      : '.';

    const conventions = [];
    if (hasSrc)      conventions.push('Source code under src/');
    if (hasTests)    conventions.push(`Tests under ${testDir}/`);
    if (hasConfig)   conventions.push(`Config under ${configDir}/`);
    if (hasPackages) conventions.push('Monorepo with packages/apps directories');

    return { type, sourceDir, testDir, configDir, conventions };
  }

  /**
   * 推荐文件放置路径 / Suggest placement path for a new file.
   * @param {string} projectRoot
   * @param {string} fileType  - one of ARTIFACT_TYPES values
   * @param {string} fileName
   * @returns {string} suggested relative path
   */
  suggestPlacement(projectRoot, fileType, fileName) {
    const structure = this.getConventions(projectRoot);

    switch (fileType) {
      case 'code_change':
        return `${structure.sourceDir}/${fileName}`;
      case 'test':
        return `${structure.testDir}/${fileName}`;
      case 'config':
        return `${structure.configDir}/${fileName}`;
      case 'document':
        return `docs/${fileName}`;
      case 'analysis':
        return `docs/analysis/${fileName}`;
      default:
        return fileName;
    }
  }

  /**
   * 生成功能目录结构建议 / Suggest directory layout for a new feature.
   * @param {string} projectRoot
   * @param {string} featureName
   * @returns {string[]} list of suggested directories
   */
  scaffoldFeatureDirectory(projectRoot, featureName) {
    const structure = this.getConventions(projectRoot);
    const base = `${structure.sourceDir}/${featureName}`;
    return [
      base,
      `${base}/components`,
      `${base}/utils`,
      `${structure.testDir}/${featureName}`,
    ];
  }

  /**
   * 获取项目惯例（带缓存）/ Get conventions with caching.
   * @param {string} projectRoot
   * @returns {object} structure info
   */
  getConventions(projectRoot) {
    const cacheKey = `conventions_${projectRoot}`;
    const cached = this._store.get('workspace', cacheKey);
    if (cached) return cached;

    const structure = this.analyzeStructure(projectRoot);
    this._store.put('workspace', cacheKey, structure);
    return structure;
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Safe readdir that returns empty array on failure */
function safeReaddir(dir) {
  try {
    const fs = esmRequire('fs');
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export { WorkspaceOrganizer };
export default WorkspaceOrganizer;
