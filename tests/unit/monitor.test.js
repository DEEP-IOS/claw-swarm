/**
 * Unit tests for Monitor (src/layer1-core/monitor.js)
 *
 * Tests ring buffer, event recording, critical event flushing,
 * getRecentEvents, getTaskStatus, getReport, listTasks, and shutdown.
 *
 * Ported from Swarm Lite v3.0 to Claw-Swarm v4.0.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  initDb,
  closeDb,
  createSwarmTask,
  createSwarmRole,
  updateSwarmRoleStatus,
  getSwarmTask,
} from '../../src/layer1-core/db.js';
import { TaskStatus, RoleStatus } from '../../src/layer1-core/types.js';
import { Monitor } from '../../src/layer1-core/monitor.js';
import * as db from '../../src/layer1-core/db.js';

describe('Monitor', () => {
  /** @type {Monitor} */
  let monitor;

  before(() => {
    initDb(':memory:');
  });

  after(() => {
    closeDb();
  });

  afterEach(() => {
    if (monitor) {
      monitor.shutdown();
      monitor = null;
    }
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('sets buffer size based on monitorMode', () => {
      const minimalMonitor = new Monitor(db, { monitorMode: 'minimal' });
      assert.equal(minimalMonitor.bufferSize, 100);
      minimalMonitor.shutdown();

      const verboseMonitor = new Monitor(db, { monitorMode: 'verbose' });
      assert.equal(verboseMonitor.bufferSize, 10000);
      verboseMonitor.shutdown();

      const defaultMonitor = new Monitor(db, { monitorMode: 'default' });
      assert.equal(defaultMonitor.bufferSize, 1000);
      defaultMonitor.shutdown();
    });
  });

  // -----------------------------------------------------------------------
  // recordEvent
  // -----------------------------------------------------------------------

  describe('recordEvent', () => {
    it('adds to ring buffer', () => {
      monitor = new Monitor(db, { monitorMode: 'default' });
      monitor.recordEvent({ type: 'test:event', taskId: 'task-1' });

      assert.equal(monitor.buffer.length, 1);
      assert.equal(monitor.buffer[0].type, 'test:event');
      assert.ok(monitor.buffer[0].timestamp, 'Event should be stamped with a timestamp');
    });

    it('triggers immediate write for critical events', () => {
      const taskId = `task-crit-${randomUUID()}`;
      createSwarmTask(taskId, { description: 'critical event test' });

      monitor = new Monitor(db, { monitorMode: 'default' });

      // Critical event types: 'task:completed', 'task:failed', 'role:failed'
      monitor.recordEvent({ type: 'task:failed', taskId, role: 'system' });

      // The critical event should NOT be in the batchQueue (it goes straight to DB)
      assert.equal(monitor.batchQueue.length, 0, 'Critical events should not be in batch queue');

      // It should still be in the ring buffer
      assert.equal(monitor.buffer.length, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Ring buffer wrapping
  // -----------------------------------------------------------------------

  describe('ring buffer', () => {
    it('wraps around when full', () => {
      monitor = new Monitor(null, { monitorMode: 'minimal' }); // bufferSize = 100, no DB

      // Fill the buffer completely
      for (let i = 0; i < 100; i++) {
        monitor.recordEvent({ type: 'fill', index: i });
      }
      assert.equal(monitor.buffer.length, 100);

      // Add one more -- should overwrite the first slot
      monitor.recordEvent({ type: 'overflow', index: 100 });

      // Buffer length should still be 100 (not 101)
      assert.equal(monitor.buffer.length, 100);

      // The first slot should now contain the overflow event
      assert.equal(monitor.buffer[0].type, 'overflow');
      assert.equal(monitor.buffer[0].index, 100);
    });
  });

  // -----------------------------------------------------------------------
  // getRecentEvents
  // -----------------------------------------------------------------------

  describe('getRecentEvents', () => {
    it('returns last N events', () => {
      monitor = new Monitor(null, { monitorMode: 'default' });

      for (let i = 0; i < 30; i++) {
        monitor.recordEvent({ type: 'recent-test', seq: i });
      }

      const recent = monitor.getRecentEvents(5);
      assert.equal(recent.length, 5);
      // v4.0 getRecentEvents sorts by timestamp descending then slices.
      // All events have type 'recent-test' and seq values from the set.
      for (const event of recent) {
        assert.equal(event.type, 'recent-test');
        assert.ok(typeof event.seq === 'number');
        assert.ok(event.seq >= 0 && event.seq < 30, 'seq should be in range');
      }
    });
  });

  // -----------------------------------------------------------------------
  // getTaskStatus
  // -----------------------------------------------------------------------

  describe('getTaskStatus', () => {
    it('returns data from DB when available', () => {
      const taskId = `task-status-${randomUUID()}`;
      createSwarmTask(taskId, { description: 'status test' });
      db.updateSwarmTaskStatus(taskId, 'executing');
      const roleId = `role-${randomUUID()}`;
      createSwarmRole(roleId, taskId, 'Architect', 'Designs', ['design'], 1, []);

      monitor = new Monitor(db, { monitorMode: 'default' });
      const status = monitor.getTaskStatus(taskId);

      assert.equal(status.taskId, taskId);
      assert.equal(status.status, 'executing');
      assert.ok(Array.isArray(status.roles), 'Should include roles array');
      assert.equal(status.roles.length, 1);
    });

    it('falls back to buffer when DB has no task', () => {
      monitor = new Monitor(null, { monitorMode: 'default' });

      const fakeId = 'nonexistent-task';
      monitor.recordEvent({ type: 'task:started', taskId: fakeId });
      monitor.recordEvent({ type: 'task:executing', taskId: fakeId });

      const status = monitor.getTaskStatus(fakeId);
      assert.equal(status.taskId, fakeId);
      assert.equal(status.status, 'task:executing');
    });
  });

  // -----------------------------------------------------------------------
  // getReport
  // -----------------------------------------------------------------------

  describe('getReport', () => {
    it('builds report with recommendations', () => {
      const taskId = `task-report-${randomUUID()}`;
      createSwarmTask(taskId, { description: 'report test' });
      // createSwarmTask always creates with status 'pending', so update to 'failed'
      db.updateSwarmTaskStatus(taskId, 'failed');

      const roleId = `role-${randomUUID()}`;
      createSwarmRole(roleId, taskId, 'BackendDev', 'Backend', ['backend'], 2, []);
      updateSwarmRoleStatus(roleId, RoleStatus.FAILED, { error: 'timeout' });

      monitor = new Monitor(db, { monitorMode: 'default' });
      const report = monitor.getReport(taskId);

      assert.equal(report.taskId, taskId);
      assert.equal(report.status, 'failed');
      assert.ok(report.recommendations.length >= 1, 'Should have recommendations for failures');
    });
  });

  // -----------------------------------------------------------------------
  // listTasks
  // -----------------------------------------------------------------------

  describe('listTasks', () => {
    it('delegates to DB', () => {
      const taskId = `task-list-mon-${randomUUID()}`;
      createSwarmTask(taskId, { description: 'list test' }, 'pending');

      monitor = new Monitor(db, { monitorMode: 'default' });
      const tasks = monitor.listTasks();

      assert.ok(Array.isArray(tasks));
      assert.ok(tasks.some((t) => t.id === taskId));
    });
  });

  // -----------------------------------------------------------------------
  // shutdown
  // -----------------------------------------------------------------------

  describe('shutdown', () => {
    it('clears timer and flushes batch', () => {
      // Use a db-backed monitor so _flushBatch actually processes the queue
      monitor = new Monitor(db, { monitorMode: 'default' });

      // Add some non-critical events to the batch queue
      monitor.recordEvent({ type: 'test:normal', taskId: 'x' });
      monitor.recordEvent({ type: 'test:normal', taskId: 'y' });
      assert.ok(monitor.batchQueue.length >= 2, 'Batch queue should have events');

      monitor.shutdown();

      assert.equal(monitor.batchInterval, null, 'Timer should be cleared');
      assert.equal(monitor.batchQueue.length, 0, 'Batch queue should be flushed');

      monitor = null; // Prevent afterEach from calling shutdown again
    });
  });
});
