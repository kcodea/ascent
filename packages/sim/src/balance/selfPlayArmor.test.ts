/**
 * A Resolve / Armor gain during the SHOP must survive the self-play settlement (matrix smoke 2026-09-15: seven
 * lobbies censored as "seat/run health diverged" — Merrin / Ayse / Darah / Void seats, whose powers raise the run's
 * pools mid-turn while the table's seat still carried the stale creation-time number). Same defect the shipped
 * reducer fixed for seat 0 on 2026-09-10; the runner now re-seeds every seat from its run before charging.
 */
import { describe, expect, it } from 'vitest';
import { computeExperimentIdentity, resolveManifest } from './identity';
import { NOOP_RECORDER, type ExperimentManifest, type SeatPilot } from './types';
import { runSelfPlayLobby } from './selfPlayLobby';
import { pilotFor } from './pilots';

describe('self-play: mid-turn Armor / Resolve gains are charged from the RUN, never a stale seat', () => {
  // The exact lobbies the matrix smoke censored (hero pinned in seat 0, the rest rotated per the matrix rule):
  // `flash`/seed 1 → seat s1 "2/0 vs 7/0" (a +5 Resolve grant), `aevor`/seed 1 → seat s2 "9/0 vs 9/5" (Mend's
  // "set Armor to 5"). Without the re-seed both fail with "seat/run health diverged".
  for (const [hero, seed] of [['flash', 1], ['aevor', 1], ['cindara', 3]] as const) {
    it(`matrix lobby ${hero}/seed ${seed} settles without the table drifting from the runs`, () => {
      const pilot = pilotFor('generalist', { depth: 1, beam: 1, maxNodes: 40, positionCandidates: 2 });
      const base = resolveManifest({
        schemaVersion: 1, name: 'armor-sync', mode: 'selfPlayLobby', setId: 'set2',
        policy: { id: 'generalist', budget: { depth: 1, beam: 1, maxNodes: 40, positionCandidates: 2 } },
        seeds: { start: 1, count: 5 }, maxRounds: 60,
      } as ExperimentManifest);
      const manifest = { ...base, pinnedHero: hero } as ExperimentManifest;
      const identity = computeExperimentIdentity(manifest);
      const rec = runSelfPlayLobby(manifest, seed, (): SeatPilot => pilot, NOOP_RECORDER, identity);
      expect(rec.failure ?? '').not.toMatch(/diverged/);
      expect(rec.seats.every((x) => x.termination !== 'failed')).toBe(true);
    }, 120_000);
  }
});
