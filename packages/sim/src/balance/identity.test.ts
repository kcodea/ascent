import { describe, expect, it } from 'vitest';
import { poolFor } from '@game/content';
import {
  canonicalJson, computeExperimentIdentity, contentDigestFor, digest, effectDigestFor, effectFactoryIds,
  manifestDigestOf, poolDigestFor, resolveManifest, MANIFEST_DEFAULTS,
} from './identity';
import type { ExperimentManifest } from './types';

const manifest: ExperimentManifest = {
  schemaVersion: 1,
  name: 'smoke',
  mode: 'selfPlayLobby',
  setId: 'set3',
  policy: { id: 'greedy', budget: { depth: 1, beam: 1, maxNodes: 40, positionCandidates: 2 } },
  seeds: { start: 1, count: 2 },
};

describe('balance identity (B0)', () => {
  it('digest is FNV-1a 64 — stable, 16 hex chars, sensitive to one character', () => {
    expect(digest('')).toBe('cbf29ce484222325');
    expect(digest('a')).toBe('af63dc4c8601ec8c');
    expect(digest('abc')).not.toBe(digest('abd'));
  });

  it('canonicalJson sorts keys and drops undefined, so two spellings of one object agree', () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: undefined }] })).toBe('{"a":[{"y":2}],"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('is deterministic and every set has a distinct content + pool digest', () => {
    const a = computeExperimentIdentity(manifest);
    const b = computeExperimentIdentity({ ...manifest });
    expect(a).toEqual(b);
    expect(a.engineRevision).toBe('unknown'); // no environment supplied — must never pass as a pinned build
    expect(new Set(['set1', 'set2', 'set3'].map((s) => contentDigestFor(s as ExperimentManifest['setId']))).size).toBe(3);
    expect(new Set(['set1', 'set2', 'set3'].map((s) => poolDigestFor(s as ExperimentManifest['setId']))).size).toBe(3);
  });

  it('poolDigest depends on pool ORDER (order affects seeded draws)', () => {
    const ids = poolFor('set2').all.map((c) => c.id);
    expect(poolDigestFor('set2')).toBe(digest(ids.join('\n')));
    expect(digest([...ids].reverse().join('\n'))).not.toBe(poolDigestFor('set2'));
  });

  it('effectDigest folds the sorted factory list AND the implementation sources', () => {
    expect(effectFactoryIds()).toEqual([...effectFactoryIds()].sort());
    expect(effectFactoryIds()).toContain('deathrattleSummon');
    expect(effectDigestFor([])).not.toBe(effectDigestFor(['// recruit', '// reducer']));
    expect(effectDigestFor(['x', 'y'])).not.toBe(effectDigestFor(['y', 'x']));
  });

  it('manifestDigest hashes the RESOLVED manifest — explicit defaults and omitted defaults agree; a real change differs', () => {
    const explicit: ExperimentManifest = { ...manifest, maxRounds: MANIFEST_DEFAULTS.maxRounds, maxActionsPerTurn: MANIFEST_DEFAULTS.maxActionsPerTurn, heroes: [] };
    expect(manifestDigestOf(explicit)).toBe(manifestDigestOf(manifest));
    expect(manifestDigestOf({ ...manifest, seeds: { start: 1, count: 3 } })).not.toBe(manifestDigestOf(manifest));
    expect(manifestDigestOf({ ...manifest, policy: { ...manifest.policy, budget: { ...manifest.policy.budget, depth: 2 } } })).not.toBe(manifestDigestOf(manifest));
    expect(resolveManifest(manifest)).toMatchObject({ maxRounds: 60, maxActionsPerTurn: 60, heroes: [] });
  });
});
