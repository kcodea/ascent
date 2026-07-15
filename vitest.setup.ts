// Vitest global setup — runs before every test file is imported.
//
// pixi.js reads `navigator` at MODULE-LOAD time (its `isSafari()` → `getNavigator()` runs as an import
// side-effect of `glUploadVideoResource.ts`). Node < 21 has no global `navigator`, so importing anything
// from 'pixi.js' throws `ReferenceError: navigator is not defined` in the bare-node test environment. CI
// pins Node 20 (see .github/workflows/ci.yml), while local dev often runs Node 21+ where `navigator` exists
// — which is exactly why the combat-choreographer channel tests (impact/lunge/engine, the first to pull
// pixiFx → pixi.js into the test graph) passed locally but failed in CI.
//
// Polyfill a minimal `navigator` when absent so pixi's `isSafari()` resolves (to false) under Node 20. This
// is a no-op on Node 21+ where `navigator` already exists.
if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node' },
    configurable: true,
    writable: true,
  });
}

// Disable every live-ops "anomaly" (see ANOMALIES in packages/sim/src/config.ts) inside the test suite.
// Anomalies are a temporary overlay on the base economy/rules; `createRun` pins the active one onto each run,
// but the deterministic economy + quest tests assert the *base* game — so we retire them here. The dedicated
// anomaly test (freedomAnomaly.test.ts) drives the behaviour by pinning `anomaly` on its own run states.
import { ANOMALIES } from './packages/sim/src/config';
for (const a of Object.values(ANOMALIES)) a.enabled = false;
