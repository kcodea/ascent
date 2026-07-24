import { validateSpecs } from './params';
import type { FxPrimitive } from './primitive';

const REGISTRY = new Map<string, FxPrimitive>();

export function registerPrimitive(p: FxPrimitive): void {
  if (REGISTRY.has(p.id)) throw new Error(`[fx] primitive '${p.id}' is already registered`);
  const problems = validateSpecs(p.params);
  if (problems.length > 0) console.warn(`[fx] primitive '${p.id}' has invalid param specs:\n  ${problems.join('\n  ')}`);
  REGISTRY.set(p.id, p);
}

export function getPrimitive(id: string): FxPrimitive | undefined {
  return REGISTRY.get(id);
}

export function listPrimitives(): FxPrimitive[] {
  return [...REGISTRY.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Test-only: reset between cases. Not called by app code. */
export function clearPrimitives(): void {
  REGISTRY.clear();
}
