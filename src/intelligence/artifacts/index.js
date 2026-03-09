/**
 * Artifact subsystem — 产物管理子系统入口
 * Barrel export and factory for the artifact subsystem modules.
 *
 * @module intelligence/artifacts
 * @version 9.0.0
 */

import { ArtifactRegistry, ARTIFACT_TYPES } from './artifact-registry.js';
import { WorkspaceOrganizer } from './workspace-organizer.js';
import { ExecutionJournal } from './execution-journal.js';

/**
 * 创建产物子系统 / Create the artifact subsystem with all modules wired.
 * @param {object} deps - { field, bus, store }
 * @returns {object} subsystem facade
 */
export function createArtifactSystem(deps) {
  const { field, bus, store } = deps;

  return {
    artifacts: new ArtifactRegistry({ field, bus, store }),
    workspace: new WorkspaceOrganizer({ store }),
    journal:   new ExecutionJournal({ field, bus, store }),

    allModules() {
      return [this.artifacts, this.workspace, this.journal];
    },

    async start() {
      for (const m of this.allModules()) {
        if (m.start) await m.start();
      }
    },

    async stop() {
      for (const m of this.allModules()) {
        if (m.stop) await m.stop();
      }
    },
  };
}

export { ArtifactRegistry, WorkspaceOrganizer, ExecutionJournal };
export { ARTIFACT_TYPES };
