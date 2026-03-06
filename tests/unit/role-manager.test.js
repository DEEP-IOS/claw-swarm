/**
 * Unit tests for RoleManager (src/layer3-intelligence/orchestration/role-manager.js)
 *
 * Tests role generation, requirement analysis, dependency sorting,
 * validation, custom roles, and immutability.
 *
 * Ported from Swarm Lite v3.0 to Claw-Swarm v4.0.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { RoleManager } from '../../src/layer3-intelligence/orchestration/role-manager.js';
import { SwarmValidationError, SwarmTopologyError } from '../../src/layer1-core/errors.js';

describe('RoleManager', () => {
  /** @type {RoleManager} */
  let rm;

  beforeEach(() => {
    rm = new RoleManager();
  });

  // -----------------------------------------------------------------------
  // generateRoles
  // -----------------------------------------------------------------------

  describe('generateRoles', () => {
    it('returns array for web app task', () => {
      const roles = rm.generateRoles({
        description: 'Build a web application with React frontend',
        type: 'web-app',
      });

      assert.ok(Array.isArray(roles), 'Should return an array');
      assert.ok(roles.length >= 2, 'Should return at least 2 roles');

      const names = roles.map((r) => r.name);
      assert.ok(names.includes('Architect'), 'Should include Architect');
      assert.ok(names.includes('FrontendDev'), 'Should include FrontendDev');
    });

    it('returns array for backend task', () => {
      const roles = rm.generateRoles({
        description: 'Create a REST API with database storage',
      });

      assert.ok(Array.isArray(roles));
      const names = roles.map((r) => r.name);
      assert.ok(names.includes('BackendDev'), 'Should include BackendDev');
    });

    it('returns default roles for empty description', () => {
      const roles = rm.generateRoles({ description: '', type: 'generic' });
      assert.ok(Array.isArray(roles));
      assert.ok(roles.length >= 2, 'Should return at least architect + one implementer');

      const names = roles.map((r) => r.name);
      assert.ok(names.includes('Architect'), 'Default set should include Architect');
      assert.ok(names.includes('BackendDev'), 'Default set should include BackendDev');
    });
  });

  // -----------------------------------------------------------------------
  // analyzeRequirements
  // -----------------------------------------------------------------------

  describe('analyzeRequirements', () => {
    it('detects frontend needs', () => {
      const reqs = rm.analyzeRequirements({
        description: 'Build a React UI with components',
      });

      assert.equal(reqs.needsFrontend, true);
    });

    it('detects backend needs', () => {
      const reqs = rm.analyzeRequirements({
        description: 'Create an API server with database',
      });

      assert.equal(reqs.needsBackend, true);
    });

    it('handles full-stack type', () => {
      const reqs = rm.analyzeRequirements({
        description: 'A simple project',
        type: 'full-stack',
      });

      assert.equal(reqs.needsDesign, true);
      assert.equal(reqs.needsFrontend, true);
      assert.equal(reqs.needsBackend, true);
      assert.equal(reqs.needsTesting, true);
    });
  });

  // -----------------------------------------------------------------------
  // sortByDependencies
  // -----------------------------------------------------------------------

  describe('sortByDependencies', () => {
    it('returns correct topological order (Architect before FrontendDev)', () => {
      const architect = rm.getTemplate('architect');
      const frontend = rm.getTemplate('frontend-dev');

      const sorted = rm.sortByDependencies([frontend, architect]);
      const names = sorted.map((r) => r.name);

      const archIdx = names.indexOf('Architect');
      const feIdx = names.indexOf('FrontendDev');
      assert.ok(archIdx < feIdx, 'Architect should come before FrontendDev');
    });

    it('detects circular dependency and throws SwarmTopologyError', () => {
      // Create roles with A -> B -> C -> A cycle
      const roleA = {
        name: 'RoleA',
        description: 'Role A',
        capabilities: ['a'],
        priority: 1,
        dependencies: ['RoleC'],
      };
      const roleB = {
        name: 'RoleB',
        description: 'Role B',
        capabilities: ['b'],
        priority: 2,
        dependencies: ['RoleA'],
      };
      const roleC = {
        name: 'RoleC',
        description: 'Role C',
        capabilities: ['c'],
        priority: 3,
        dependencies: ['RoleB'],
      };

      assert.throws(
        () => rm.sortByDependencies([roleA, roleB, roleC]),
        (err) => {
          assert.ok(err instanceof SwarmTopologyError);
          assert.ok(err.message.includes('cycle'), 'Error should mention cycle');
          return true;
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // validateRole
  // -----------------------------------------------------------------------

  describe('validateRole', () => {
    it('rejects invalid role (missing name)', () => {
      assert.throws(
        () => rm.validateRole({ description: 'no name', capabilities: [], priority: 1, dependencies: [] }),
        (err) => {
          assert.ok(err instanceof SwarmValidationError);
          return true;
        },
      );
    });

    it('rejects null role', () => {
      assert.throws(
        () => rm.validateRole(null),
        (err) => {
          assert.ok(err instanceof SwarmValidationError);
          return true;
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Custom roles
  // -----------------------------------------------------------------------

  describe('custom roles', () => {
    it('custom roles are included when provided in taskConfig', () => {
      const roles = rm.generateRoles({
        description: 'A custom project',
        type: 'web-app',
        customRoles: {
          'my-custom': {
            name: 'CustomAgent',
            description: 'Does custom things',
            capabilities: ['custom'],
            priority: 5,
            dependencies: [],
          },
        },
      });

      const names = roles.map((r) => r.name);
      assert.ok(names.includes('CustomAgent'), 'Custom role should be in the generated set');
    });
  });

  // -----------------------------------------------------------------------
  // Immutability
  // -----------------------------------------------------------------------

  describe('immutability', () => {
    it('generated roles are frozen (immutable)', () => {
      const roles = rm.generateRoles({
        description: 'Build a web app',
        type: 'web-app',
      });

      for (const role of roles) {
        assert.ok(Object.isFrozen(role), `Role "${role.name}" should be frozen`);
      }
    });
  });
});
