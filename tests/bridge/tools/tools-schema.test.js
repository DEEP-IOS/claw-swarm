import { describe, it, expect, vi } from 'vitest';
import { createRunTool } from '../../../src/bridge/tools/run-tool.js';
import { createQueryTool } from '../../../src/bridge/tools/query-tool.js';
import { createCheckpointTool } from '../../../src/bridge/tools/checkpoint-tool.js';
import { createDispatchTool } from '../../../src/bridge/tools/dispatch-tool.js';
import { createGateTool } from '../../../src/bridge/tools/gate-tool.js';
import { createMemoryTool } from '../../../src/bridge/tools/memory-tool.js';
import { createPheromoneTool } from '../../../src/bridge/tools/pheromone-tool.js';
import { createPlanTool } from '../../../src/bridge/tools/plan-tool.js';
import { createSpawnTool } from '../../../src/bridge/tools/spawn-tool.js';
import { createZoneTool } from '../../../src/bridge/tools/zone-tool.js';

// ─── Shared stub deps ─────────────────────────────────────────────────

const stubDeps = {
  core: {
    orchestration: {},
    intelligence: {},
    communication: {},
    field: {},
    store: {},
  },
  quality: {},
  sessionBridge: {},
  spawnClient: {},
};

// ─── Tool registry ────────────────────────────────────────────────────

const toolFactories = [
  { factory: createRunTool, expectedName: 'swarm_run' },
  { factory: createQueryTool, expectedName: 'swarm_query' },
  { factory: createCheckpointTool, expectedName: 'swarm_checkpoint' },
  { factory: createDispatchTool, expectedName: 'swarm_dispatch' },
  { factory: createGateTool, expectedName: 'swarm_gate' },
  { factory: createMemoryTool, expectedName: 'swarm_memory' },
  { factory: createPheromoneTool, expectedName: 'swarm_pheromone' },
  { factory: createPlanTool, expectedName: 'swarm_plan' },
  { factory: createSpawnTool, expectedName: 'swarm_spawn' },
  { factory: createZoneTool, expectedName: 'swarm_zone' },
];

// ─── Helper: recursively validate object schemas ──────────────────────

function collectObjectSchemas(schema, path = 'root') {
  const issues = [];
  if (!schema || typeof schema !== 'object') return issues;

  if (schema.type === 'object') {
    const hasProps = schema.properties && typeof schema.properties === 'object';
    const hasAdditional = schema.additionalProperties !== undefined;
    if (!hasProps && !hasAdditional) {
      issues.push(`${path}: type 'object' without properties or additionalProperties`);
    }
    // Recurse into properties
    if (hasProps) {
      for (const [key, val] of Object.entries(schema.properties)) {
        issues.push(...collectObjectSchemas(val, `${path}.${key}`));
      }
    }
  }

  // Recurse into array items
  if (schema.type === 'array' && schema.items) {
    issues.push(...collectObjectSchemas(schema.items, `${path}[items]`));
  }

  return issues;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('Bridge tools schema validation (all 10 tools)', () => {
  const tools = toolFactories.map(({ factory, expectedName }) => ({
    tool: factory(stubDeps),
    expectedName,
    factoryName: factory.name,
  }));

  describe('all 10 create*Tool factories exist and are callable', () => {
    it('has exactly 10 tool factories', () => {
      expect(toolFactories).toHaveLength(10);
    });

    it.each(toolFactories.map(t => [t.factory.name, t.factory]))('%s is a function', (_name, factory) => {
      expect(typeof factory).toBe('function');
    });
  });

  describe('each tool returns { name, description or parameters, execute }', () => {
    it.each(tools.map(t => [t.expectedName, t.tool]))('%s has name, parameters, execute', (_name, tool) => {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('parameters');
      expect(tool).toHaveProperty('execute');
    });
  });

  describe('each tool parameters.type === "object"', () => {
    it.each(tools.map(t => [t.expectedName, t.tool]))('%s parameters.type is object', (_name, tool) => {
      expect(tool.parameters.type).toBe('object');
    });
  });

  describe('each tool parameters has properties', () => {
    it.each(tools.map(t => [t.expectedName, t.tool]))('%s has properties defined', (_name, tool) => {
      expect(tool.parameters.properties).toBeDefined();
      expect(typeof tool.parameters.properties).toBe('object');
      expect(Object.keys(tool.parameters.properties).length).toBeGreaterThan(0);
    });
  });

  describe('nested type:"object" schemas have properties or additionalProperties', () => {
    it.each(tools.map(t => [t.expectedName, t.tool]))('%s passes nested object schema check', (_name, tool) => {
      const issues = collectObjectSchemas(tool.parameters, `${tool.name}.parameters`);
      expect(issues).toEqual([]);
    });
  });

  describe('all tool names start with swarm_', () => {
    it.each(tools.map(t => [t.expectedName, t.tool]))('%s starts with swarm_', (_name, tool) => {
      expect(tool.name.startsWith('swarm_')).toBe(true);
    });
  });

  describe('tool names match expected values', () => {
    it.each(tools.map(t => [t.expectedName, t.tool]))('%s has correct name', (expectedName, tool) => {
      expect(tool.name).toBe(expectedName);
    });
  });

  describe('execute is an async function', () => {
    it.each(tools.map(t => [t.expectedName, t.tool]))('%s execute is async', (_name, tool) => {
      // AsyncFunction constructor name check
      expect(tool.execute.constructor.name).toBe('AsyncFunction');
    });
  });

  describe('parameters has required array', () => {
    it.each(tools.map(t => [t.expectedName, t.tool]))('%s has required field', (_name, tool) => {
      expect(Array.isArray(tool.parameters.required)).toBe(true);
      expect(tool.parameters.required.length).toBeGreaterThan(0);
    });
  });

  describe('all 10 expected tool names are present', () => {
    it('covers the full tool set', () => {
      const names = tools.map(t => t.tool.name).sort();
      const expected = [
        'swarm_checkpoint', 'swarm_dispatch', 'swarm_gate',
        'swarm_memory', 'swarm_pheromone', 'swarm_plan',
        'swarm_query', 'swarm_run', 'swarm_spawn', 'swarm_zone',
      ].sort();
      expect(names).toEqual(expected);
    });
  });
});
