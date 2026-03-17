> **ARCHIVED**: V8 stress test matrix. V9 uses Vitest-based testing (107 files, 1,365 tests)

# Stress Matrix (Release)

This matrix defines the release-oriented runtime stress checks and their pass criteria.

## Scenarios

| Scenario | Goal | Test File | Pass Criteria |
|---|---|---|---|
| `concurrency_cancel_32` | Validate cancel path stability under concurrent requests | `tests/stress/swarm-runtime-release.stress.test.js` | 32/32 cancel calls return `success=true`, each ends exactly one matched session, total runtime < 5s |
| `long_stability_200` | Validate no degradation across repeated operations | `tests/stress/swarm-runtime-release.stress.test.js` | 200 sequential cancel cycles all return `success=true` and `cancelled=true` |
| `resource_ceiling_1000_scan` | Validate bounded behavior when active session count spikes | `tests/stress/swarm-runtime-release.stress.test.js` | Scan 1000 sessions, terminate only matched subset (25), zero over-termination, runtime < 8s |
| `cancel_chain_regression` | Validate cancel semantics and failure signaling | `tests/stress/swarm-run-cancel.stress.test.js` | Matched sessions end successfully in normal case; if none can terminate, returns `success=false` |

## Commands

- Full stress suite: `npm run test:stress`
- Release stress subset: `npm run test:stress:release`

## Notes

- These tests run with mocked engines for deterministic regression and gate stability.
- Production soak/throughput tests against live Gateway should be run in a dedicated perf environment with telemetry enabled.
