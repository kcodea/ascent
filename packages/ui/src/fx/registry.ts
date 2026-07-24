import { validateSpecs } from './params';
import type { FxPrimitive } from './primitive';

// Note: nothing here sets up an `import.meta.hot` accept/dispose boundary for this module. Editing a
// primitive file that self-registers via a top-level `registerPrimitive(...)` call currently triggers a
// full page reload under Vite dev rather than a hot swap (the registration side effect can't safely re-run
// against a still-populated Map — see `clearPrimitives` below). Not a defect today; whoever builds the dev
// editor (a later task) needs to either accept that or design the HMR boundary deliberately.
const REGISTRY = new Map<string, FxPrimitive>();

export function registerPrimitive(p: FxPrimitive): void {
  if (REGISTRY.has(p.id)) throw new Error(`[fx] primitive '${p.id}' is already registered`);
  const problems = validateSpecs(p.params);
  // Dev-only: a broken spec is something a developer can act on immediately in their own console.
  // Shipping this warning to the production console helps no one there (a player can't fix a param spec)
  // and CI's `typecheck && lint && test && build:web` doesn't catch it either — so this is the only gate.
  if (problems.length > 0 && import.meta.env.DEV) {
    console.warn(`[fx] primitive '${p.id}' has invalid param specs:\n  ${problems.join('\n  ')}`);
  }
  REGISTRY.set(p.id, p);
}

export function getPrimitive(id: string): FxPrimitive | undefined {
  return REGISTRY.get(id);
}

export function listPrimitives(): FxPrimitive[] {
  return [...REGISTRY.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Test-only: reset between cases. Not called by app code.
 *
 * Note the gotcha for a primitive that self-registers via a top-level `registerPrimitive(...)` module side
 * effect (rather than being registered explicitly by the test): clearing the registry does NOT undo that
 * registration for the next test, because ES module caching means re-importing the primitive's module
 * won't re-run its top-level code — the module is already in the cache. A test that wants both isolation
 * (via `clearPrimitives`) and a real (non-stub) primitive must re-register it manually after clearing, not
 * rely on import side effects to restore it.
 */
export function clearPrimitives(): void {
  REGISTRY.clear();
}
