/**
 * Side-effect barrel: importing this registers every built-in primitive (each module calls
 * `registerPrimitive(...)` at load). The workbench imports THIS instead of each primitive, so a new
 * primitive appears in the picker just by being added here — and, like the individual imports before it,
 * it must stay behind a DEV-gated dynamic `import()` at the call site so the whole set (GLSL shader source
 * included) is dead-code-eliminated from the production bundle.
 */
import './ribbon';
import './burst';
import './shockwave';
import './emitter';
import './smoke';
