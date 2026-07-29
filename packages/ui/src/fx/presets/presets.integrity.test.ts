import { describe, it, expect } from 'vitest';
import { presetTable } from './index';
import { getDef } from '../fxDefs';
import { getPrimitive } from '../registry';
import '../primitives'; // register the real primitives so specs resolve

describe('the shipped preset table', () => {
  it('every archetype names a base def that exists', () => {
    for (const a of presetTable().archetypes) {
      expect(getDef(a.base), `archetype '${a.id}' base '${a.base}'`).toBeDefined();
    }
  });

  it('every archetype base id is preset-prefixed, so Browse all excludes it', () => {
    for (const a of presetTable().archetypes) expect(a.base.startsWith('preset-')).toBe(true);
  });

  // The one that matters: an axis key reaching nothing is a variant that silently does nothing.
  it('every axis key resolves to a slider param on at least one base', () => {
    const table = presetTable();
    const bases = table.archetypes.map((a) => getDef(a.base)).filter((d) => d !== undefined);
    for (const axis of table.variantAxes) {
      for (const key of Object.keys(axis.transform)) {
        const hit = bases.some((d) =>
          d.layers.some((l) => getPrimitive(l.primitive)?.params[key]?.kind === 'slider'),
        );
        expect(hit, `axis '${axis.id}' key '${key}' reaches no slider param on any base`).toBe(true);
      }
    }
  });
});
