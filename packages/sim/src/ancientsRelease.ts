/**
 * THE ANCIENTS RELEASE SWITCH (owner 2026-11-16: "Ancients will go live everywhere, so build the flip to turn them
 * on/off as needed. When on, they're live everywhere").
 *
 * ── How to flip it ────────────────────────────────────────────────────────────────────────────────────────────
 * Owner 2026-11-16 (later the same day): "Ship the ancient switch off. I'll tell you when to turn it on." So it ships
 * `false`. FLIPPING IT ON is a one-line change here PLUS `VERSUS_CF_PROTOCOL` 4 -> 5 in workers/versus/src/protocol.ts
 * (a fight-rules change with no content change, R-VERSUS-WORKER-RULES-01) and a Versus Worker deploy; the tripwire in
 * packages/ui/src/versus/ancientsReleaseProtocol.test.ts fails CI until the bump is made.
 *
 * `ANCIENTS_LIVE` below is the ONE switch. `true` = every new player run (ranked + casual lobby, Practice incl. God
 * Mode, Gauntlet, Versus 1v1 / group / Duos / Ranked Duos) and every generated / bot seat starts with the Ancients
 * meter. `false` = none do (only the Scene Builder's toggle and the DEV Versus seam).
 *
 * ── Pinned at creation (the card-sets rule, docs/card-sets.md) ─────────────────────────────────────────────────
 * The switch is read ONLY when a run is created (`releaseAncients`, called by `createLobbyRun`, `createVersusRun`,
 * `createGauntletRun`, and the generated-seat runs in `autoplayRun` / `botSeat`). The run then carries
 * `ancientsEnabled` + its `ancients` meter, so flipping the switch never changes an in-flight, saved, restored or
 * replayed run: `deserialize` merges a save over a plain `createRun`, which never reads the switch, so a save made
 * with Ancients keeps them and one made without stays without.
 *
 * ── Who never gets them ───────────────────────────────────────────────────────────────────────────────────────
 *  · The TUTORIAL (`createTutorialRun`): its scripted course has no step for the awakening offer, which blocks End
 *    Turn. It goes through `createRun` directly and never calls `releaseAncients`.
 *  · A hero with NO written pairings (`heroHasAncientPairings`): Runesmith and Guardian today. The owner writes
 *    pairings; until they are written those heroes get no meter (an offer of "Not written yet" cards would do nothing).
 *    And while the switch is ON such a hero is ARCHIVED (`heroArchivedByAncients`, owner 2026-11-17): never offered
 *    anywhere, so in practice no new run of it exists. A recorded seat of it still serves, like any archived hero.
 *  · A set without Ancients (`ancientsSetSupported`): Sets 2 and 3 have them, the same rule the Scene Builder uses.
 *  · The Scene Builder keeps its own toggle (`createLobbyRun(..., { ancients: false })`, then `enableAncients` when
 *    its toggle is on), so it can test Ancients with the switch off.
 */
import type { SetId } from '@game/content';
import { ANCIENT_IDS, ANCIENT_PAIRINGS, enableAncients } from './ancients';
import { setHeroReleaseArchiveGate } from './heroes';
import type { RunState } from './state';

/** THE RELEASE SWITCH. OFF until the owner says (2026-11-16). `true` turns Ancients on for every NEW run; in-flight runs
 *  keep what they pinned either way. See the header for the protocol bump that must ship with the flip. */
export const ANCIENTS_LIVE: boolean = true; // ON: owner 2026-11-17 "okay turn on ancients"

/** A scoped override of the switch for tests and tools (`withAncientsLive`). Undefined = the real switch. */
let liveOverride: boolean | undefined;

/** Is the release switch on? Read only at run creation and when a hero offer is dealt (see the header). */
export function ancientsLive(): boolean {
  return liveOverride ?? ANCIENTS_LIVE;
}

/** Run `fn` as if the release switch were `live` (tests, tools), restoring the real switch afterwards. Synchronous
 *  only: the override is a module-level value, so never hold it across an await. */
export function withAncientsLive<T>(live: boolean, fn: () => T): T {
  const prev = liveOverride;
  liveOverride = live;
  try {
    return fn();
  } finally {
    liveOverride = prev;
  }
}

/** The card sets whose runs can play Ancients (the Scene Builder's `sceneAncientsSet` reads this too). */
export function ancientsSetSupported(setId: string | undefined): boolean {
  return setId === 'set2' || setId === 'set3';
}

/** Does this hero have its Ancient pairings written (all six)? A hero without them gets no meter. */
export function heroHasAncientPairings(heroId: string): boolean {
  const p = ANCIENT_PAIRINGS[heroId];
  return !!p && ANCIENT_IDS.every((id) => !!p[id]);
}

/**
 * UNPAIRED HEROES ARE ARCHIVED WHILE ANCIENTS ARE LIVE (owner 2026-11-17, verbatim: "when ancients go live, any hero
 * that does not have ancients CANNOT be offered. this means that any hero that does not have ancients should join
 * the archived heroes list until re-added. (guardian + runesmith)"). With the switch on, a hero with no written
 * pairings reads as archived through `isArchivedHero`, so every picker that withholds an archived hero withholds it
 * too: the Play / Ranked / Practice / Gauntlet hero select, generated and bot seats, Versus / group / Duos / Ranked
 * Duos deals, synthesized pool boards, the Mimic / Void / Power Shifter Discovers and the Compendium. The Scene
 * Builder still lists it (marked archived). There is no list: writing all six pairings re-adds the hero by itself.
 * With the switch off it archives nothing. The gate does not look at the card set (the ruling names no set).
 */
export function heroArchivedByAncients(heroId: string): boolean {
  return ancientsLive() && !heroHasAncientPairings(heroId);
}
setHeroReleaseArchiveGate(heroArchivedByAncients);

/** Would a new run of this hero on this set start with Ancients? `live` overrides the switch (tests, tools). */
export function ancientsForNewRun(heroId: string, setId: SetId | string | undefined, live: boolean = ancientsLive()): boolean {
  return live && ancientsSetSupported(setId) && heroHasAncientPairings(heroId);
}

/**
 * Stamp Ancients on a freshly created run when the release switch (or `live`) says so. Pure: returns the run itself
 * when nothing changes, else a new run. A tutorial run, a run that already has Ancients (a dev seam), a hero with no
 * pairings and an unsupported set are all returned unchanged.
 */
export function releaseAncients(run: RunState, live: boolean = ancientsLive()): RunState {
  if (run.mode === 'tutorial' || run.ancientsEnabled) return run;
  if (!ancientsForNewRun(run.heroId, run.setId, live)) return run;
  return enableAncients(run);
}
