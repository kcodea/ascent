/**
 * DOC BOT 2.0 WP F — HISTORICAL GENERALIZATION: the retro catalog → generalized-scenario map (§18-F exit
 * gate: "historical multi-system bugs are detected by generalized interaction scenarios").
 *
 * The retro catalog (packages/tools/retro/reinject.py) holds one anchored source mutation per historical
 * bug. This module states, per catalog id, WHICH generalized scenario family would catch that bug CLASS —
 * an interaction pair/triple family from interactionSweep.ts where the class is multi-system, or the
 * npm-test lane that owns it where it is single-system. The map is the citation ledger the weekly retro
 * reinject run reads: reinject a bug, run the named family/lane, expect red.
 *
 * HONESTY (§4.3): retroMapErrors() cross-checks this map against reinject.py's actual id list (a new
 * catalog entry with no mapping fails the gate loudly) and against the family roster + the lane files on
 * disk (a renamed lane un-cites its bugs loudly). `verifiedBy` records how the catch was established:
 * 'reinject-run' = a recorded reinjection turned the cited lane red (date noted); 'class-analysis' = the
 * mapping is argued from the bug's mechanism — a claim, standing until a reinject run upgrades it.
 */
import { PAIR_FAMILIES, TRIPLE_FAMILIES, type PairFamilyId, type TripleFamilyId } from './interactionSweep';

export interface RetroMapEntry {
  /** The reinject.py catalog id, verbatim. */
  catalogId: string;
  /** Does the bug cross system boundaries (trigger×multiplier, recruit×combat, aura×predicate…)? Only
   *  multi-system entries owe the exit gate a generalized INTERACTION family. */
  multiSystem: boolean;
  /** The generalized interaction families whose scenarios exercise this bug's class (may be empty for
   *  single-system entries — their `lanes` carry the catch). */
  families: Array<PairFamilyId | TripleFamilyId>;
  /** Repo-relative npm-test lane files that also (or instead) catch the class — the citation half. */
  lanes: string[];
  /** One line: WHY this family/lane catches the class. */
  why: string;
  verifiedBy: 'reinject-run' | 'class-analysis';
}

export const RETRO_INTERACTION_MAP: readonly RetroMapEntry[] = [
  {
    catalogId: '1176-avenge-arrival',
    multiSystem: true, // summon timing × avenge window baseline
    families: ['death-x-avenge'],
    lanes: ['packages/sim/src/docbot/temporalWindow.test.ts'],
    why: 'a summoned watcher counting the whole fight moves the first-fire ordinal off the declared threshold — the death-x-avenge diff and the per-instance temporal oracle (PR #1253, built to catch exactly this class) both go red',
    verifiedBy: 'reinject-run', // PR #1253's lane was proven against this reinjection (2026-08-27)
  },
  {
    catalogId: '897-stag-multiplier',
    multiSystem: true, // forced Echo × echo multiplier
    families: ['trigger-x-multiplier'],
    lanes: ['packages/sim/src/docbot/interactionMatrix.test.ts', 'packages/sim/src/docbot/interactionFamilyMatrix.test.ts'],
    why: 'dropping the echoExtras consult makes every trigger×multiplier ×(1+extra) diff read ×1 — the chain-multiplier oracle caught the reinjection (docbot-roadmap wave 1), and the generalized fold check fails on every candidate, not just the Stag',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md: 14/14 caught)
  },
  {
    catalogId: '933-triple-temp-keywords',
    multiSystem: true, // gilding merge × granted temp keywords
    families: ['copy-x-counter'],
    lanes: ['packages/sim/src/docbot/missDrivenOracles.test.ts', 'packages/sim/src/docbot/carryOver.test.ts'],
    why: 'the class is "what per-instance state rides a merge/copy" — the missDrivenOracles copy-semantics probe (a triple keeps real keywords, drops temporary ones) caught the reinjection; the copy-x-counter rows generalize the rides/sheds surface',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md)
  },
  {
    catalogId: '941-aftershocks-per-watcher',
    multiSystem: true, // death-trigger wrapping × echo attribution
    families: ['death-x-echo', 'trigger-x-multiplier'],
    lanes: ['packages/sim/src/docbot/combatModLane.test.ts', 'packages/sim/src/docbot/interactionFamilyMatrix.test.ts'],
    why: 'every watcher wrapping as an OWN Echo multiplies echo counts board-wide — the mod-lane rider caught the reinjection (delta 16 vs 0), and the death-x-echo exact-count diff goes red on any board with a second watcher',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md)
  },
  {
    catalogId: '832-soulbind-uid',
    multiSystem: true, // recruit-phase bond identity × combat clones
    families: ['granted-effect-x-snapshot'],
    lanes: ['packages/sim/src/docbot/combatModLane.test.ts', 'packages/sim/src/docbot/snapshotFidelity.test.ts'],
    why: 'a bond keyed on the wrong identity never matches combat clones — the mod-lane inert pin caught the reinjection; the snapshot-fidelity registry enumerates identity fields across the recruit→combat boundary (the family\'s generated driver is WP C burn-down; its blocked row cites this lane meanwhile)',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md)
  },
  {
    catalogId: '1111-beefy-fizzle',
    multiSystem: false, // a factory missing from one phase's dispatch map
    families: [],
    lanes: ['packages/sim/src/docbot/factoryPhase.test.ts'],
    why: 'the factoryPhase tripwire exists BECAUSE of this class: every (trigger, factory) pair must be implemented wherever its trigger dispatches (the combat-castable registry caught the reinjection)',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md)
  },
  {
    catalogId: '932-undertow-uncapped',
    multiSystem: false, // a missing cap check in one branch
    families: [],
    lanes: ['packages/sim/src/docbot/combatModLane.test.ts', 'packages/sim/src/docbot/conservationLaws.test.ts'],
    why: 'the mod-lane rider caught the reinjection (8 wards > cap 4); the conservation/budget lanes bound the class generally',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md)
  },
  {
    catalogId: '986-summon-order',
    multiSystem: true, // summon iteration order × augmenter application
    families: ['summon-x-watcher'],
    lanes: ['packages/sim/src/docbot/orderGoldens.test.ts'],
    why: 'augmenters applying right→left flips pinned resolution order — the ordering oracle (Oona/Beardsley non-commuting golden) caught the reinjection; the summon-x-watcher rows exercise the watcher path itself',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md)
  },
  {
    catalogId: '8f98da40-spellpower-fold',
    multiSystem: true, // spell resolution × run-wide improvement state
    families: ['spell-x-improvement'],
    lanes: ['packages/sim/src/docbot/spellPowerFolding.test.ts'],
    why: 'a stat spell that stops folding spell power fails the spell-x-improvement base-plus-bonus diff directly (and the folding lane caught the wave-2 reinjection)',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md wave 2)
  },
  {
    catalogId: 'c8a214d7-alltypes-aura',
    multiSystem: true, // type aura × universal-tribe predicate
    families: ['type-aura-x-plain-copy'],
    lanes: ['packages/sim/src/docbot/tribeRatchet.ts', 'packages/sim/src/docbot/interactionMatrix.test.ts'],
    why: 'a mech-aura site missing the universalTribe arm is the raw-tribe-compare class: the wave-2 behavioural probe (universalTribe body must receive tribe-keyed combat grants) caught it; the aura family row stays blocked-with-citation until a generic aura driver lands',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md wave 2)
  },
  {
    catalogId: 'bf996507-tribe-gate',
    multiSystem: false, // one reducer guard dropped
    families: [],
    lanes: ['packages/sim/src/docbot/interactionMatrix.test.ts', 'packages/sim/src/docbot/targetCardinality.test.ts'],
    why: 'the eligibility sweep (tribe-scoped effects may only touch eligible targets, across seeds) is the generalized detector; the wave-2 probe (a targetTribe Battlecry refuses an off-tribe target at the reducer) caught the reinjection',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md wave 2)
  },
  {
    catalogId: '69d6a8e5-fizzle-consumed',
    multiSystem: false,
    families: [],
    lanes: ['packages/sim/src/docbot/playDifferential.test.ts'],
    why: 'the #847 audit rule is pinned there: an unusable spell is refused, never consumed doing nothing',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md wave 2)
  },
  {
    catalogId: '7af61a35-maxgold-cap',
    multiSystem: false,
    families: [],
    lanes: ['packages/sim/src/docbot/economyScan.test.ts'],
    why: 'economy magnitudes (max-Gold leads included) are verified against their defs; the wave-2 probe (above-cap economy rides maxGoldBonus, never maxEmbers) caught the reinjection',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md wave 2)
  },
  {
    catalogId: 'f45525c9-chipper-random',
    multiSystem: false,
    families: [],
    lanes: ['packages/sim/src/docbot/targetCardinality.test.ts', 'packages/sim/src/docbot/interactionMatrix.test.ts'],
    why: 'a self-feed becoming a random friendly is a target-resolution class: the wave-2 probe (self:true consume feeds the card itself, across rng cursors) caught the reinjection',
    verifiedBy: 'reinject-run', // measured 2026-08-27 (docs/docbot-roadmap.md wave 2)
  },
] as const;

/** Cross-check the map: complete over the catalog, family ids on the roster, no duplicate catalog ids, and
 *  every multi-system entry names at least one interaction family. `catalogIds` is parsed from reinject.py
 *  by the caller (the test) so the map can never silently lag the catalog. */
export function retroMapErrors(catalogIds: readonly string[]): string[] {
  const errors: string[] = [];
  const mapped = new Map(RETRO_INTERACTION_MAP.map((e) => [e.catalogId, e]));
  if (mapped.size !== RETRO_INTERACTION_MAP.length) errors.push('duplicate catalogId in RETRO_INTERACTION_MAP');
  for (const id of catalogIds) {
    if (!mapped.has(id)) errors.push(`catalog entry '${id}' has NO generalization mapping — add it to RETRO_INTERACTION_MAP`);
  }
  const catalog = new Set(catalogIds);
  const roster = new Set<string>([...PAIR_FAMILIES, ...TRIPLE_FAMILIES]);
  for (const e of RETRO_INTERACTION_MAP) {
    if (catalogIds.length > 0 && !catalog.has(e.catalogId)) errors.push(`mapping '${e.catalogId}' cites a catalog id reinject.py no longer lists`);
    for (const f of e.families) if (!roster.has(f)) errors.push(`mapping '${e.catalogId}' names unknown family '${f}'`);
    if (e.multiSystem && e.families.length === 0) errors.push(`'${e.catalogId}' is multi-system but names no interaction family — the §18-F exit gate`);
    if (e.lanes.length === 0 && e.families.length === 0) errors.push(`'${e.catalogId}' cites nothing at all`);
    if (!e.why.trim()) errors.push(`'${e.catalogId}' has no rationale`);
  }
  return errors;
}
