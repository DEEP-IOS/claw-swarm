/**
 * ZoneManager -- unit tests
 * @module tests/orchestration/planning/zone-manager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZoneManager, ZONES } from '../../../src/orchestration/planning/zone-manager.js';

// ============================================================================
// Shared mocks
// ============================================================================

const makeMocks = () => ({
  field: {
    emit: vi.fn(),
    read: vi.fn().mockReturnValue([]),
  },
  store: {},
});

// ============================================================================
// Tests
// ============================================================================

describe('ZoneManager', () => {
  /** @type {ReturnType<typeof makeMocks>} */
  let mocks;
  /** @type {ZoneManager} */
  let zm;

  beforeEach(() => {
    mocks = makeMocks();
    zm = new ZoneManager({ field: mocks.field, store: mocks.store });
  });

  // --------------------------------------------------------------------------
  // 1. identifyZone correctly classifies paths
  // --------------------------------------------------------------------------
  describe('identifyZone', () => {
    it('classifies test/ paths as TEST zone', () => {
      expect(zm.identifyZone('tests/unit/foo.test.js')).toBe(ZONES.TEST);
      expect(zm.identifyZone('test/integration/bar.spec.ts')).toBe(ZONES.TEST);
      expect(zm.identifyZone('src/__tests__/baz.js')).toBe(ZONES.TEST);
    });

    it('classifies src/core/ paths as CORE zone', () => {
      expect(zm.identifyZone('src/core/module-base.js')).toBe(ZONES.CORE);
      expect(zm.identifyZone('src/core/field/types.js')).toBe(ZONES.CORE);
      expect(zm.identifyZone('lib/utils.js')).toBe(ZONES.CORE);
    });

    it('classifies config paths as CONFIG zone', () => {
      expect(zm.identifyZone('webpack.config.js')).toBe(ZONES.CONFIG);
      expect(zm.identifyZone('.env')).toBe(ZONES.CONFIG);
      expect(zm.identifyZone('src/config/database.js')).toBe(ZONES.CONFIG);
    });

    it('classifies components/ paths as UI zone', () => {
      expect(zm.identifyZone('src/components/Button.jsx')).toBe(ZONES.UI);
      expect(zm.identifyZone('pages/index.tsx')).toBe(ZONES.UI);
      expect(zm.identifyZone('views/Dashboard.vue')).toBe(ZONES.UI);
    });

    it('classifies docs/ and .md files as DOCS zone', () => {
      expect(zm.identifyZone('docs/api.md')).toBe(ZONES.DOCS);
      expect(zm.identifyZone('README.md')).toBe(ZONES.DOCS);
    });

    it('classifies docker/ci/scripts as INFRASTRUCTURE zone', () => {
      expect(zm.identifyZone('docker/Dockerfile')).toBe(ZONES.INFRASTRUCTURE);
      expect(zm.identifyZone('ci/pipeline.yml')).toBe(ZONES.INFRASTRUCTURE);
      expect(zm.identifyZone('scripts/deploy.sh')).toBe(ZONES.INFRASTRUCTURE);
    });

    it('returns "unknown" for unrecognized paths', () => {
      expect(zm.identifyZone('src/orchestration/planning/dag-engine.js')).toBe('unknown');
      expect(zm.identifyZone('random/file.js')).toBe('unknown');
    });

    it('returns "unknown" for null/empty input', () => {
      expect(zm.identifyZone(null)).toBe('unknown');
      expect(zm.identifyZone('')).toBe('unknown');
      expect(zm.identifyZone(undefined)).toBe('unknown');
    });

    it('handles backslash paths (Windows-style)', () => {
      expect(zm.identifyZone('src\\core\\module.js')).toBe(ZONES.CORE);
      expect(zm.identifyZone('tests\\unit\\foo.test.js')).toBe(ZONES.TEST);
    });
  });

  // --------------------------------------------------------------------------
  // 2. getZoneConstraints returns non-empty constraint list
  // --------------------------------------------------------------------------
  describe('getZoneConstraints', () => {
    it('returns constraints for TEST zone', () => {
      const constraints = zm.getZoneConstraints(ZONES.TEST);
      expect(constraints.length).toBeGreaterThan(0);
      expect(Array.isArray(constraints)).toBe(true);
    });

    it('returns constraints for CORE zone', () => {
      const constraints = zm.getZoneConstraints(ZONES.CORE);
      expect(constraints.length).toBeGreaterThan(0);
    });

    it('returns constraints for CONFIG zone', () => {
      const constraints = zm.getZoneConstraints(ZONES.CONFIG);
      expect(constraints.length).toBeGreaterThan(0);
    });

    it('returns constraints for UI zone', () => {
      const constraints = zm.getZoneConstraints(ZONES.UI);
      expect(constraints.length).toBeGreaterThan(0);
    });

    it('returns constraints for INFRASTRUCTURE zone', () => {
      const constraints = zm.getZoneConstraints(ZONES.INFRASTRUCTURE);
      expect(constraints.length).toBeGreaterThan(0);
    });

    it('returns constraints for DOCS zone', () => {
      const constraints = zm.getZoneConstraints(ZONES.DOCS);
      expect(constraints.length).toBeGreaterThan(0);
    });

    it('returns empty array for unknown zone', () => {
      const constraints = zm.getZoneConstraints('unknown');
      expect(constraints).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // 3. getZoneLockGranularity: core -> 'file', test -> 'directory'
  // --------------------------------------------------------------------------
  describe('getZoneLockGranularity', () => {
    it('returns "file" for CORE zone', () => {
      expect(zm.getZoneLockGranularity(ZONES.CORE)).toBe('file');
    });

    it('returns "file" for CONFIG zone', () => {
      expect(zm.getZoneLockGranularity(ZONES.CONFIG)).toBe('file');
    });

    it('returns "directory" for TEST zone', () => {
      expect(zm.getZoneLockGranularity(ZONES.TEST)).toBe('directory');
    });

    it('returns "directory" for UI zone', () => {
      expect(zm.getZoneLockGranularity(ZONES.UI)).toBe('directory');
    });

    it('returns "directory" for DOCS zone', () => {
      expect(zm.getZoneLockGranularity(ZONES.DOCS)).toBe('directory');
    });

    it('returns "directory" for INFRASTRUCTURE zone', () => {
      expect(zm.getZoneLockGranularity(ZONES.INFRASTRUCTURE)).toBe('directory');
    });
  });

  // --------------------------------------------------------------------------
  // 4. analyzeProject correctly groups files
  // --------------------------------------------------------------------------
  describe('analyzeProject', () => {
    it('groups file paths by zone', () => {
      const files = [
        'tests/unit/a.test.js',
        'tests/unit/b.test.js',
        'src/core/engine.js',
        'src/components/Header.jsx',
        'webpack.config.js',
        'docs/readme.md',
        'src/orchestration/planner.js',
      ];

      const zoneMap = zm.analyzeProject(files);

      expect(zoneMap.get(ZONES.TEST)).toEqual([
        'tests/unit/a.test.js',
        'tests/unit/b.test.js',
      ]);
      expect(zoneMap.get(ZONES.CORE)).toEqual(['src/core/engine.js']);
      expect(zoneMap.get(ZONES.UI)).toEqual(['src/components/Header.jsx']);
      expect(zoneMap.get(ZONES.CONFIG)).toEqual(['webpack.config.js']);
      expect(zoneMap.get(ZONES.DOCS)).toEqual(['docs/readme.md']);
      expect(zoneMap.get('unknown')).toEqual(['src/orchestration/planner.js']);
    });

    it('returns empty map for non-array input', () => {
      const result = zm.analyzeProject(null);
      expect(result.size).toBe(0);
    });

    it('returns empty map for empty array', () => {
      const result = zm.analyzeProject([]);
      expect(result.size).toBe(0);
    });
  });
});
