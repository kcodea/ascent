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

// Disable the live-ops "anomaly" patch (CONFIG.anomaly) inside the test suite. Anomalies are a temporary
// overlay on the base economy/rules; the deterministic economy + quest tests assert the *base* game, so we
// neutralize it here. The dedicated anomaly test (freedomAnomaly.test.ts) opts back in around its own body.
import { CONFIG } from './packages/sim/src/config';
CONFIG.anomaly = null;
