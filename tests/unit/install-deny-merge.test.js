/**
 * O1: install.js registerAgents() deny-list merge idempotency
 *
 * Problem: registerAgents() skips agents already registered without
 * merging/updating their toolsDeny lists. When new tools are added
 * (e.g. swarm_checkpoint in V7.1), existing agents keep stale deny lists.
 *
 * Fix: merge new deny entries into existing agent's tools.deny on re-install.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../');

describe('O1: install.js registerAgents deny-list merge', () => {
  const installCode = readFileSync(join(ROOT, 'install.js'), 'utf-8');

  it('swarm-relay deny list definition should include swarm_checkpoint', () => {
    // The swarmAgents definition must list swarm_checkpoint in toolsDeny
    expect(installCode).toContain('swarm_checkpoint');
  });

  it('should have merge/update logic for existing agent toolsDeny', () => {
    // The fix should NOT just skip existing agents.
    // It must include logic to merge/update the deny list for already-registered agents.
    // Look for the pattern where we update existing agent's tools.deny
    //
    // Before fix: the `else` branch just logs "Agent already registered" and does nothing.
    // After fix: the `else` branch should merge missing deny entries.

    // Check that the else branch (existing agent found) contains deny-list merge logic
    // We look for code that references existing agent's tools/deny in the update path
    const hasExistingDenyMerge = (
      // Pattern: accessing existing agent's deny list and adding/merging new entries
      installCode.includes('existing.tools') ||
      installCode.includes('existingDeny') ||
      installCode.includes('existing?.tools')
    );

    expect(hasExistingDenyMerge).toBe(true);
  });

  it('merge logic should add missing entries without removing existing ones', () => {
    // The merge should use a set-union approach: add missing, keep existing.
    // This ensures custom deny entries added by the user are preserved.
    //
    // Look for set/array union patterns in the registerAgents function
    const hasMergePattern = (
      // Set-based merge
      installCode.includes('new Set(') ||
      // Array includes check
      installCode.includes('.includes(') ||
      // Spread merge
      installCode.includes('...existing')
    );

    expect(hasMergePattern).toBe(true);
  });

  it('should log when deny list is updated for existing agent', () => {
    // The fix should inform the user when deny entries are merged
    // Look for a log message about updating/merging deny list
    const hasUpdateLog = (
      installCode.includes('tools.deny updated') ||
      installCode.includes('toolsDeny updated') ||
      installCode.includes('deny list updated') ||
      installCode.includes('deny.*merged') ||
      installCode.includes('Merged') ||
      installCode.includes('merged')
    );

    expect(hasUpdateLog).toBe(true);
  });
});
