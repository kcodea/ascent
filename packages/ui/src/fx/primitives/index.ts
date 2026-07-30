/**
 * Side-effect barrel: importing this registers every built-in primitive (each module calls
 * `registerPrimitive(...)` at load). `playDef.ts`'s `ensureDefsReady()` and the workbench both import THIS
 * instead of each primitive, so a new primitive appears in the picker — and becomes playable — just by being
 * added here.
 *
 * This SHIPS: authored defs play for players, so their primitives (GLSL shader source included) are part of
 * the production bundle — a measured **133,773 B raw / 29,338 B gzipped**, which is the bulk of what un-gating
 * defs costs. It stays behind a DYNAMIC `import()` at every call site so it lands in its OWN chunk rather than
 * the entry chunk: the registration is a top-level function CALL, a side effect Rollup cannot prove away, so a
 * static import would pull all 133 kB into the critical path ahead of first paint. Verified in a real build —
 * the primitives resolve to a separate `assets/index-*.js`, imported from `ensureDefsReady`'s `import()`.
 */
import './ribbon';
import './burst';
import './shockwave';
import './emitter';
import './smoke';
