/**
 * DOC BOT — the per-instance TEMPORAL-WINDOW oracle (handoff §5, Workstream B / PR 3).
 *
 * The one measured retro miss (#1176: a mid-combat summon inherited the side's whole death tally) is a
 * WINDOW bug: an effect that must count events only while its specific source instance exists and is
 * eligible was fed a fight-global counter. This suite makes that class generically detectable:
 *
 *  · PROVENANCE — `setAvengeWindowObserver` (core, §5.3) taps `avengeCountFor`, the single chokepoint every
 *    minion-level avenge factory counts through. Each observation carries the source INSTANCE (uid+cardId),
 *    its ENTRY SEQUENCE (`baseline` — the side's death tally when its window opened), the OBSERVED EVENT
 *    SEQUENCE (`count`), and the in-window counter (`seen`). Trigger EMISSION is read from the authoritative
 *    event log (`avenge:true`-stamped events), never from the side channel.
 *  · CONTRACT — the eleven owner rulings of 2026-08-26 (§5.0), entered as approved rules
 *    `R-AVWIN-01` … `R-AVWIN-11` in packages/rules/src/registry/approved.ts. Each scenario below asserts
 *    the RULED behaviour and names its rule id.
 *  · VERIFY-BEFORE-ALARM — where the engine currently VIOLATES a ruling, the violation is NOT excused into
 *    silence and NOT "fixed" here (this PR changes no gameplay): it is pinned in `KNOWN_VIOLATIONS`, a
 *    typed shrink-only table, and the pinning test asserts the violating behaviour still REPRODUCES —
 *    so the day the engine is fixed, the pin fails loudly and the entry (plus its rule's
 *    `currentBehaviour` note) must be deleted and the assertion flipped to the ruled expectation.
 *  · SABOTAGE (§3.5) — beyond the retro catalog's `1176-avenge-arrival` reinjection (which this file is the
 *    generic catch for: it anchors on `minion.avengeBaseline = deaths[side]` in simulate.ts and zeroes it),
 *    `windowFailure` is sabotage-tested in-file: a doctored expected count must fail naming the instance,
 *    its window, the expected count, and the observed count.
 *
 * Beyond Avenge (§5.5), the same instance-window assertions cover three more headlessly-reachable window
 * families: a once-per-combat latch (The Sealed Vault's first-Avenge doubler), a "first N times" window
 * (Solid Ground's first-N-summons buff), and per-source improve counters (Kennelmaster).
 */
import { describe, expect, it } from 'vitest';
import {
  combatSide, makeRng, setAvengeWindowObserver, simulate,
  type AvengeWindowObservation, type BoardMinion, type CombatEvent, type QuestCombatMods,
} from '@game/core';
import { CARD_INDEX } from '@game/content';
import { readFileSync } from 'node:fs';
import { parseQaScenario, runQaScenario, type QaScenarioV1 } from '../qaScenario';

// ── Known violations (typed, shrink-only — the §3.4 doctrine: uncertainty and defects stay VISIBLE) ────────

interface WindowViolation {
  ruleId: string;
  title: string;
  /** What the engine does today, and where the leak lives — enough for the fixing session to start. */
  why: string;
  /** The test in this file that PINS the violating behaviour (fails the day the engine is fixed). */
  pinnedBy: string;
}

/** Confirmed rule violations, each with a deterministic reproduction below. This table may only SHRINK:
 *  fixing the engine deletes the entry, flips the pinning assertion to the ruled behaviour, and clears the
 *  rule's `currentBehaviour` violation note in packages/rules/src/registry/approved.ts. */
const KNOWN_VIOLATIONS: readonly WindowViolation[] = [
  {
    ruleId: 'R-AVWIN-02',
    title: 'The summoning death leaks INTO the summoned source\'s window',
    why: '`killOrReborn` fires the Deathrattle (placing the summon, which stamps `avengeBaseline = '
      + 'deaths[side]`) BEFORE incrementing `deaths[side]` — so the death that summoned the body is inside '
      + 'its window, and an Echo-summoned Avenge (4) source pays after only 3 further deaths.',
    pinnedBy: 'R-AVWIN-02 pin: the summoning death currently counts',
  },
  {
    ruleId: 'R-AVWIN-10',
    title: 'A source dying in a simultaneous batch observes the batch-mates resolved before it',
    why: 'Clash deaths resolve sequentially (cleave victims → target → attacker) and the avenge dispatch '
      + 'guard checks only `minion.dead` — a mortally-wounded source whose own death has not yet been '
      + 'processed observes earlier batch deaths and can fire while dying.',
    pinnedBy: 'R-AVWIN-10 pin: a dying source currently observes its batch-mates',
  },
];

// ── Harness ────────────────────────────────────────────────────────────────────────────────────────────────

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];

const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });

interface WindowRun {
  r: ReturnType<typeof simulate>;
  obs: AvengeWindowObservation[];
  /** uid of the nth initial player minion. */
  uid: (n: number) => string;
}

function run(player: BoardMinion[], enemy: BoardMinion[], mods: QuestCombatMods = {}, seed = 1, poolIds?: string[]): WindowRun {
  const obs: AvengeWindowObservation[] = [];
  setAvengeWindowObserver((o) => obs.push({ ...o }));
  try {
    const r = simulate(player, enemy, makeRng(seed), CARD_INDEX,
      combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods, ...(poolIds ? { poolIds } : {}) }),
      combatSide({ tier: 1 }));
    return { r, obs, uid: (n) => r.initial.player[n]!.uid };
  } finally {
    setAvengeWindowObserver(); // never leak the observer into another test's sim
  }
}

/** The player-side death ordinal each event happened AT (deaths counted so far, including rise deaths —
 *  matching the raw tally the window math subtracts its baseline from... EXCEPT that the tally increments
 *  AFTER the death's own cascade; for assertions we index by the death EVENT sequence, which is what a
 *  human reads off the log). Returns [event, deathsSoFar] pairs. */
function withDeathOrdinal(events: readonly CombatEvent[]): Array<{ e: CombatEvent; deaths: number }> {
  let deaths = 0;
  return events.map((e) => {
    if (e.type === 'death' && (e as { side?: string }).side === 'player') deaths += 1;
    return { e, deaths };
  });
}

/** Avenge-stamped events EMITTED BY one source instance (the trigger-emission read, from the real log). */
function avengeFiresBy(r: ReturnType<typeof simulate>, sourceUid: string): Array<{ e: CombatEvent; deaths: number }> {
  return withDeathOrdinal(r.events).filter(({ e }) => {
    const x = e as { avenge?: boolean; source?: string; target?: string; type: string };
    if (!x.avenge) return false;
    if (e.type === 'buff') return x.source === sourceUid;
    if (e.type === 'improve') return x.target === sourceUid;
    if (e.type === 'shieldUp') return x.target === sourceUid;
    return false;
  });
}

const shieldUpsOn = (r: ReturnType<typeof simulate>, uid: string): number[] =>
  withDeathOrdinal(r.events).filter(({ e }) => e.type === 'shieldUp' && (e as { target?: string }).target === uid).map((x) => x.deaths);

const improvesOn = (r: ReturnType<typeof simulate>, uid: string): number[] =>
  withDeathOrdinal(r.events).filter(({ e }) => e.type === 'improve' && (e as { target?: string }).target === uid).map((x) => x.deaths);

const buffsBy = (r: ReturnType<typeof simulate>, uid: string): Array<{ deaths: number; avenge: boolean }> =>
  withDeathOrdinal(r.events).filter(({ e }) => e.type === 'buff' && (e as { source?: string }).source === uid)
    .map((x) => ({ deaths: x.deaths, avenge: !!(x.e as { avenge?: boolean }).avenge }));

const summonsOf = (r: ReturnType<typeof simulate>, cardId: string): Array<{ uid: string; deaths: number }> =>
  withDeathOrdinal(r.events).filter(({ e }) => e.type === 'summon' && (e as { minion?: { cardId?: string } }).minion?.cardId === cardId)
    .map((x) => ({ uid: (x.e as { minion: { uid: string } }).minion.uid, deaths: x.deaths }));

// ── The window oracle (and its sabotage surface) ───────────────────────────────────────────────────────────

/** Assert one instance's in-window counter at a given raw tally. Returns null when the observation matches,
 *  or a failure REPORT naming the source instance, its observation window, the expected count, and the
 *  observed count — the §5.6 acceptance shape ("the oracle reports source instance, event window, expected
 *  count, and observed count"). */
export function windowFailure(
  obs: readonly AvengeWindowObservation[],
  expect_: { sourceUid: string; atCount: number; expectSeen: number },
): string | null {
  const hit = obs.filter((o) => o.sourceUid === expect_.sourceUid && o.count === expect_.atCount).at(-1);
  if (!hit) {
    return `temporal-window mismatch: instance ${expect_.sourceUid} made NO observation at side-death tally `
      + `${expect_.atCount} (expected in-window count ${expect_.expectSeen})`;
  }
  if (hit.seen !== expect_.expectSeen) {
    return `temporal-window mismatch: instance ${hit.sourceUid} (${hit.sourceCard}, ${hit.side}) — window `
      + `opened at side-death ${hit.baseline}; at raw tally ${hit.count} expected in-window count `
      + `${expect_.expectSeen}, observed ${hit.seen}`;
  }
  return null;
}

// ── Scenarios (§5.4 — the ten, plus the §5.5 generalizations) ──────────────────────────────────────────────

describe('temporal windows — Avenge (rules R-AVWIN-01…11)', () => {
  // §5.4.1 + §5.4.4 + ruling 6 — a source present from the opening counts every death individually, and
  // an early-dying same-card instance's window closes with it (per-source improve counters, §5.5).
  it('R-AVWIN-01/06: a start-of-fight Kennelmaster improves at deaths 4 and 8 exactly (each death counts once; six deaths past a 3-threshold would pay twice)', () => {
    // kennel(600hp) survives past death 8; the Wolves Dens' Echoes flood Crypt Wolves so the side can
    // reach 8+ deaths within the board cap (a wolf only lands when a slot is free — hence two Dens).
    const { r, obs, uid } = run(
      [bm('kennel', 1, 600), bm('wolvesden', 2, 1), bm('wolvesden', 2, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 60)],
      [bm('sandbag', 2, 4000)]);
    const kennel = uid(0);
    const improves = improvesOn(r, kennel);
    expect(improves, 'Avenge (4): improve at side-deaths 4 and 8, nowhere else').toEqual([4, 8]);
    // Provenance: its window opened at 0 and its counter equals the raw tally throughout.
    expect(windowFailure(obs, { sourceUid: kennel, atCount: 4, expectSeen: 4 })).toBeNull();
    expect(windowFailure(obs, { sourceUid: kennel, atCount: 8, expectSeen: 8 })).toBeNull();
    expect(obs.filter((o) => o.sourceUid === kennel).every((o) => o.baseline === 0), 'a start-of-fight body observes from death 0').toBe(true);
  });

  // §5.4.2 — the #1176 class, and THE generic retro catch: the catalog's `1176-avenge-arrival` reinjection
  // (avengeBaseline = 0 at placeSummon) makes the summoned Solaris inherit the pre-entry deaths and Ward
  // ~2 deaths early, failing both assertions here.
  it('R-AVWIN-01: an Avenge source summoned after two deaths opens its window at 2 — the prior deaths are not its progress', () => {
    const { r, obs } = run(
      [bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_bullseye', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 500)],
      [bm('sandbag', 2, 4000)], {}, 1, ['b2_solaris']);
    const solaris = summonsOf(r, 'b2_solaris');
    expect(solaris.length, 'the scenario must actually summon a Solaris (guard the fixture, not just the assertion)').toBe(1);
    expect(solaris[0]!.deaths, 'it must arrive AFTER deaths have accrued — that is the whole bug window').toBeGreaterThanOrEqual(3);
    // Entry sequence: two deaths were fully tallied before the death whose Echo summoned it.
    const sObs = obs.filter((o) => o.sourceUid === solaris[0]!.uid);
    expect(sObs.length, 'the summoned Solaris observed deaths').toBeGreaterThan(0);
    expect(sObs[0]!.baseline, 'window opens at the side tally on entry (2) — NOT 0 (#1176)').toBe(2);
    // Emission: with Avenge (4) it cannot possibly have Warded by side-death 5 (≤3 candidate deaths since
    // entry even counting the summoning one). Under the #1176 reinjection it Wards at death 4.
    const wards = shieldUpsOn(r, solaris[0]!.uid);
    expect(wards.filter((d) => d <= 5), 'no Ward by side-death 5 — a summoned body must not inherit the tally').toEqual([]);
  });

  // §5.4.3 — two same-card instances entering at different times show DIFFERENT correct progress.
  it('R-AVWIN-01: two Solaris instances track independent windows (baselines 0 and 2; different `seen` at the same tally)', () => {
    const { r, obs, uid } = run(
      [bm('b2_solaris', 6, 300), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_bullseye', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 400)],
      [bm('sandbag', 2, 4000)], {}, 1, ['b2_solaris']);
    const a = uid(0);
    const bSummon = summonsOf(r, 'b2_solaris').find((s) => s.uid !== a);
    expect(bSummon, 'a second Solaris must be summoned mid-fight').toBeDefined();
    const b = bSummon!.uid;
    const aObs = obs.filter((o) => o.sourceUid === a);
    const bObs = obs.filter((o) => o.sourceUid === b);
    expect(aObs.length, 'instance A observed').toBeGreaterThan(0);
    expect(bObs.length, 'instance B observed').toBeGreaterThan(0);
    expect(aObs[0]!.baseline).toBe(0);
    expect(bObs[0]!.baseline, 'the late instance opened its own window').toBe(2);
    // At every raw tally both observed, the late entrant has seen exactly 2 fewer deaths.
    for (const bo of bObs) {
      const ao = aObs.find((o) => o.count === bo.count);
      if (ao) expect(ao.seen - bo.seen, `at tally ${bo.count} the two instances' windows differ by their entry gap`).toBe(2);
    }
    // Emission: A (window from 0) Wards at side-death 4; B has not Warded by then.
    expect(shieldUpsOn(r, a)[0], 'the opening-board Solaris Wards at its 4th observed death').toBe(4);
    expect(shieldUpsOn(r, b).filter((d) => d <= 5), 'the late Solaris cannot have Warded yet').toEqual([]);
  });

  // §5.4.4 — a source dying before its threshold never fires, and its window never reopens.
  it('R-AVWIN-01/09: a Kennelmaster dying at death 1 never improves — its window closed with it (per-source counters, §5.5)', () => {
    const { r, obs, uid } = run(
      [bm('kennel', 1, 1), bm('kennel', 1, 400), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 500)],
      [bm('sandbag', 2, 4000)]);
    const fallen = uid(0);
    const survivor = uid(1);
    expect(improvesOn(r, fallen), 'the fallen instance never fires').toEqual([]);
    expect(improvesOn(r, survivor), 'the surviving instance still pays at death 4 — windows are per-source').toEqual([4]);
    // The dead instance makes no observations after its death (its handlers are dead-gated).
    const fallenDeath = withDeathOrdinal(r.events).find(({ e }) => e.type === 'death' && (e as { target?: string }).target === fallen)!.deaths;
    expect(obs.filter((o) => o.sourceUid === fallen && o.count >= fallenDeath), 'a closed window observes nothing').toEqual([]);
  });

  // §5.4.5 + rulings 9/11 — Rise: fresh window, base-Attack/1-Health return.
  it('R-AVWIN-09/11: a risen Obsidian Drake returns at base Attack and 1 Health with a FRESH window (its rise-death excluded)', () => {
    const { r, obs, uid } = run(
      [bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('stuntdrake', 3, 2, { keywords: ['T', 'R'] }), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 500)],
      [bm('sandbag', 5, 4000)]);
    const drake = uid(2);
    const events = withDeathOrdinal(r.events);
    const riseDeath = events.find(({ e }) => e.type === 'death' && (e as { target?: string; rise?: boolean }).target === drake && (e as { rise?: boolean }).rise);
    expect(riseDeath, 'the drake must actually Rise').toBeDefined();
    const reborn = events.find(({ e }) => e.type === 'reborn' && (e as { target?: string }).target === drake);
    expect(reborn, 'a reborn event follows').toBeDefined();
    // Ruling 11: base Attack (3, plain), exactly 1 Health.
    expect((reborn!.e as { attack?: number }).attack).toBe(3);
    expect((reborn!.e as { hp?: number }).hp).toBe(1);
    // Ruling 9: post-rise observations run on a fresh baseline that EXCLUDES the rise-death itself
    // (it died at side-death 2 → baseline restamps to 2, so at tally 3 it has seen exactly 1).
    const rDeaths = riseDeath!.deaths;
    const postRise = obs.filter((o) => o.sourceUid === drake && o.count > rDeaths);
    expect(postRise.length, 'the risen body observed later deaths').toBeGreaterThan(0);
    expect(postRise[0]!.baseline, 'the fresh window opens at the tally INCLUDING its own rise-death').toBe(rDeaths);
    expect(windowFailure(obs, { sourceUid: drake, atCount: rDeaths + 1, expectSeen: 1 })).toBeNull();
    // Emission: with Avenge (3) and windows of at most 2 in-window deaths on either side of the Rise, it
    // never reaches a threshold — no avenge-stamped fire from this instance the whole fight.
    expect(avengeFiresBy(r, drake), 'neither window reached the threshold').toEqual([]);
  });

  // §5.4.9 + ruling 7 — multipliers double RESOLUTION, never progress; and only where they apply.
  it('R-AVWIN-07: Rune of Fury doubles the resolutions at the threshold, not the counting toward it', () => {
    const board: BoardMinion[] = [bm('stuntdrake', 3, 400), bm('stuntdrake', 3, 400, { golden: true }), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 500)];
    const enemy = [bm('sandbag', 2, 4000)];
    const plain = run(board, enemy);
    const fury = run(board, enemy, { runeFury: true });
    const drake = plain.uid(0); // deterministic uids: same board → same m-numbers in both runs
    expect(fury.uid(0)).toBe(drake);
    const volleys = (w: WindowRun): { at3: number; before3: number } => {
      const fires = buffsBy(w.r, drake).filter((b) => b.avenge);
      return { at3: fires.filter((b) => b.deaths === 3).length, before3: fires.filter((b) => b.deaths < 3).length };
    };
    // Un-multiplied: one resolution at death 3 = 2 buff grants (targets: 2). Fury: two resolutions = 4.
    expect(volleys(plain)).toEqual({ at3: 2, before3: 0 });
    expect(volleys(fury), 'Fury re-resolves at the same threshold').toEqual({ at3: 4, before3: 0 });
    // Progress is NOT doubled: under Fury nothing fires at deaths 1–2 (each death still counts once) —
    // covered by before3 === 0 above — and up to the shared threshold the window arithmetic is IDENTICAL
    // with and without the rune. (Unique pairs: Fury re-runs the factory, so each observation repeats; and
    // past death 3 the two fights diverge — the doubled buffs change who survives — so the comparison stays
    // inside the causally-shared prefix.)
    const pairs = (w: WindowRun): string[] =>
      [...new Set(w.obs.filter((o) => o.sourceUid === drake && o.count <= 3).map((o) => `${o.count}:${o.seen}`))];
    expect(pairs(fury), 'the counter is untouched by the multiplier').toEqual(pairs(plain));
    expect(pairs(fury)).toEqual(['1:1', '2:2', '3:3']);
  });

  // §5.4.9 variant + §5.5 once-per-combat latch — The Sealed Vault doubles ONE resolution per combat: the
  // first PAYING avenge spends the latch; a same-side second source's simultaneous payout is not doubled.
  it('R-AVWIN-07 + once-per-combat latch: The Sealed Vault doubles the first paying resolution only (one source, not the other; never again)', () => {
    const board: BoardMinion[] = [bm('stuntdrake', 3, 400), bm('stuntdrake', 3, 400, { golden: true }), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 500)];
    const enemy = [bm('sandbag', 2, 4000)];
    const plain = run(board, enemy);
    const vault = run(board, enemy, { avengeFirstDouble: true });
    const first = plain.uid(0); // plain drake — registered first, fires first at the shared threshold
    const golden = plain.uid(1);
    const at3 = (w: WindowRun, uid: string): number => buffsBy(w.r, uid).filter((b) => b.avenge && b.deaths === 3).length;
    expect(at3(plain, first)).toBe(2); // 1 resolution × 2 targets
    expect(at3(plain, golden)).toBe(4); // golden = 2 volleys
    expect(at3(vault, first), 'the latch doubles the FIRST paying resolution').toBe(4);
    expect(at3(vault, golden), 'the latch is already spent — the second source resolves un-doubled').toBe(4);
  });

  // §5.4.10 — golden and plain sources together: independent counters, same window arithmetic, golden
  // magnitude only at resolution.
  it('R-AVWIN-06: golden and plain sources share the timeline but keep independent counters and magnitudes', () => {
    const { r, obs, uid } = run(
      [bm('stuntdrake', 3, 400), bm('stuntdrake', 3, 400, { golden: true }), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 500)],
      [bm('sandbag', 2, 4000)]);
    const plainDrake = uid(0);
    const goldenDrake = uid(1);
    const fires = (u: string) => buffsBy(r, u).filter((b) => b.avenge);
    expect(fires(plainDrake).map((b) => b.deaths), 'plain: one resolution (2 grants) at death 3').toEqual([3, 3]);
    expect(fires(goldenDrake).map((b) => b.deaths), 'golden: two volleys (4 grants) at the SAME death 3').toEqual([3, 3, 3, 3]);
    // Up to their shared threshold both instances observed identical windows — golden changes resolution,
    // never the counter. (Past death 3 the plain drake dies first, so its observations simply stop.)
    const seq = (u: string) => [...new Set(obs.filter((o) => o.sourceUid === u && o.count <= 3).map((o) => [o.count, o.seen].join(':')))].join(',');
    expect(seq(goldenDrake)).toBe(seq(plainDrake));
    expect(seq(plainDrake)).toBe('1:1,2:2,3:3');
  });
});

// ── The pinned violations (§3.4 — visible, reproduced, shrink-only) ────────────────────────────────────────

describe('temporal windows — KNOWN violations (pinned until the engine is fixed)', () => {
  it('the violation table is complete, cited, and shrink-only (2 as of 2026-08-27)', () => {
    expect(KNOWN_VIOLATIONS.map((v) => v.ruleId)).toEqual(['R-AVWIN-02', 'R-AVWIN-10']);
    expect(KNOWN_VIOLATIONS.length, 'this table may only SHRINK — a new window violation gets a fix or an owner ruling, not an entry').toBeLessThanOrEqual(2);
    for (const v of KNOWN_VIOLATIONS) expect(v.why.length, `${v.ruleId} pinned without a diagnosis`).toBeGreaterThan(40);
  });

  // RULED (R-AVWIN-02): the death that summons an Avenge source is OUTSIDE its window — the Solaris below
  // should first Ward at side-death 7 (deaths 4,5,6,7 post-entry). ENGINE TODAY: the summoning death (3)
  // counts, so it Wards at side-death 6. This test pins the violating behaviour so the fix is loud.
  it('R-AVWIN-02 pin: the summoning death currently counts', () => {
    const { r } = run(
      [bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_bullseye', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 500)],
      [bm('sandbag', 2, 4000)], {}, 1, ['b2_solaris']);
    const solaris = summonsOf(r, 'b2_solaris');
    expect(solaris.length).toBe(1);
    expect(solaris[0]!.deaths, 'summoned during the 3rd death\'s cascade').toBe(3);
    const wards = shieldUpsOn(r, solaris[0]!.uid);
    // VIOLATION PINNED: first Ward at side-death 6 — one early, because death 3 (its summoner) counted.
    // When R-AVWIN-02 is implemented this becomes 7 (or [] if the fight ends first): delete the
    // KNOWN_VIOLATIONS entry, flip this to the ruled expectation, and clear the rule's note.
    expect(wards[0], 'pinned: the summoning death leaks into the window (ruled: first Ward at death 7)').toBe(6);
  });

  // RULED (R-AVWIN-10): a source dying in a simultaneous batch observes NONE of that batch — the drake
  // below dies in the same cleave clash as both its neighbours and must not fire. ENGINE TODAY: the batch
  // resolves sequentially and the mortally-wounded drake observes the two neighbours resolved before it,
  // reaching its threshold and firing WHILE DYING.
  it('R-AVWIN-10 pin: a dying source currently observes its batch-mates', () => {
    const { r, obs, uid } = run(
      [bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('stuntdrake', 3, 1, { keywords: ['T'] }), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 500)],
      [bm('sandbag', 99, 4000, { keywords: ['C', 'T'] })]);
    const drake = uid(2);
    const timeline = withDeathOrdinal(r.events);
    const drakeDeath = timeline.find(({ e }) => e.type === 'death' && (e as { target?: string }).target === drake);
    expect(drakeDeath, 'the drake must die in the cleave clash').toBeDefined();
    // Same-batch proof from the log: deaths 2, 3 and the drake's own (4) belong to ONE clash — no attack
    // event separates them (the cleave's three victims resolve inside a single exchange).
    const clashDeaths = timeline.filter(({ e }) => e.type === 'death' && (e as { side?: string }).side === 'player').map((x) => x.deaths);
    expect(clashDeaths).toContain(2);
    const attacksBetween = r.events.filter((e, i) =>
      e.type === 'attack'
      && i > r.events.findIndex((x) => x.type === 'death' && (x as { target?: string }).target === uid(1))
      && i < r.events.findIndex((x) => x.type === 'death' && (x as { target?: string }).target === drake));
    expect(attacksBetween, 'deaths 2–4 share one clash (no attack between them)').toEqual([]);
    // VIOLATION PINNED: the drake fires at side-death 3 — a batch-mate's death — while itself at ≤0 Health.
    // Ruled behaviour: zero avenge-stamped fires from this instance (its window held only death 1).
    // When R-AVWIN-10 is implemented: expect([]) here, delete the KNOWN_VIOLATIONS entry, clear the note.
    const fires = avengeFiresBy(r, drake);
    expect(fires.map((f) => f.deaths), 'pinned: the dying drake observed batch-mates and fired (ruled: no fire at all)').toEqual([3]);
    // Provenance shows the leak precisely: seen 2 and 3 while its own death (4) was still unprocessed.
    expect(obs.filter((o) => o.sourceUid === drake).map((o) => o.seen)).toEqual([1, 2, 3]);
  });
});

// ── Copy semantics via the shared scenario contract (QaScenarioV1 fixtures, §4/§5.4.6–7) ──────────────────

describe('temporal windows — copy semantics (QaScenarioV1 fixtures)', () => {
  const load = (id: string): QaScenarioV1 => {
    const text = readFileSync(new URL(`./scenarios/${id}.json`, import.meta.url), 'utf8');
    const { scenario, errors } = parseQaScenario(text);
    expect(errors).toEqual([]);
    return scenario!;
  };

  // §5.4.6 / R-AVWIN-03 — an exact copy inherits accrued permanent progression. (The in-combat halves of
  // the ruling — accrued mid-combat window progress and spent once-per-combat latches, R-AVWIN-08 — have
  // NO reachable exact-copy scenario today; they are approved-but-unenforced, recorded on the rules.)
  it('R-AVWIN-03: an exact copy (Xerox) inherits the Kennelmaster\'s accrued summonBonus', () => {
    const result = runQaScenario(load('avenge-window-exact-copy'));
    expect(result.ok, result.summary).toBe(true);
  });

  // §5.4.7 / R-AVWIN-04 — a plain copy starts at zero.
  it('R-AVWIN-04: a plain copy (Bellringer Voss) carries none of the source\'s progression', () => {
    const result = runQaScenario(load('avenge-window-plain-copy'));
    expect(result.ok, result.summary).toBe(true);
  });

  // Ruling 5 / R-AVWIN-05 — gilding sums permanent card-owned progression additively (the ruled example:
  // +3/+3 and +2/+2 combine to +5/+5). Proven at the reducer's triple-combine via the existing
  // copy-semantics machinery: two progressed Kennelmasters + one fresh combine into base + 3 + 2.
  it('R-AVWIN-05: gilding sums the copies\' permanent progression additively (the ruled two-copy example)', async () => {
    const { createRun } = await import('../state');
    const { reduce } = await import('../reducer');
    const s = createRun(779, 'aster', 'ascent', 9, 'set1');
    s.embers = 10;
    s.board = [
      { uid: 'k1', cardId: 'kennel', tribe: 'beast', attack: 1, health: 3, keywords: ['SC'], golden: false, summonBonus: 3 },
      { uid: 'k2', cardId: 'kennel', tribe: 'beast', attack: 1, health: 3, keywords: ['SC'], golden: false, summonBonus: 2 },
    ];
    s.hand = [{ uid: 'k3', cardId: 'kennel', tribe: 'beast', attack: 1, health: 3, keywords: ['SC'], golden: false }];
    s.servedBoards = { ...(s.servedBoards ?? {}), [s.wave]: null };
    const after = reduce(s, { type: 'play', uid: 'k3' });
    // The combine pushes the golden copy to the HAND (with its triple-reward Discover).
    const gilded = [...after.board, ...after.hand].find((c) => c.cardId === 'kennel' && c.golden);
    expect(gilded, 'the three Kennelmasters combined into a Gilded one').toBeDefined();
    // The combine writes base(+1) + top-two accruals (3 + 2) = 6 into the golden's summonBonus channel —
    // the granted magnitude is base + summonBonus, i.e. the SUM of the copies' progressions, per the ruling.
    expect(gilded!.summonBonus, 'progression is additive across the combined copies').toBe(6);
  });
});

// ── R-RISE-01 — the Rise RETURN-STAT window: base first, Auras second (owner ruling 2026-08-28) ────────────

describe('Rise return stats — base BEFORE auras, auras re-applied after (R-RISE-01 / R-AVWIN-11)', () => {
  // OWNER RULING 2026-08-28 (decisions.json q-conv-keyword-r, verbatim): "it returns with 1 health and base
  // attack before any auras or effects are added, i.e. undead aura." Three readings are distinguishable from
  // one measurement, which is why this probe measures the SAME body under three aura settings:
  //   (a) BASE-THEN-AURA (ruled): return = printed base + the aura, Health = 1 + the aura's health;
  //   (b) auras skipped:          return = bare printed base / 1 Health even under a live aura;
  //   (c) aura baked into base:   return keeps the grown pre-death stats.
  // Footman is a 1/1 Undead with Rise printed, so the Undead Aura (side-scoped: `undeadAtk`/`undeadHp` from
  // the Lantern, plus the buy-time `undeadBuyAtk` slice that is re-added to every FROM-BASE body) applies to
  // it and nothing else on the fixture perturbs the numbers.
  const riseUnder = (aura: { undeadAtk: number; undeadHp: number; undeadBuyAtk: number }) => {
    const r = simulate(
      // Instance stats far above base: if the Rise returned the GROWN body (reading c) it would come back at 9/9.
      [bm('footman', 9, 9, { keywords: ['R'] }), bm('sandbag', 0, 400)],
      [bm('sandbag', 20, 4000)],
      makeRng(4), CARD_INDEX,
      combatSide({ tier: 6, tribes: ALL_TRIBES, ...aura }), combatSide({ tier: 1 }),
    );
    const uid = r.initial.player[0]!.uid;
    const reborn = r.events.find((e) => e.type === 'reborn' && (e as { target?: string }).target === uid);
    expect(reborn, 'the Footman must actually Rise in this fixture').toBeDefined();
    return {
      start: [r.initial.player[0]!.attack, r.initial.player[0]!.health] as [number, number],
      back: [(reborn as { attack: number }).attack, (reborn as { hp: number }).hp] as [number, number],
    };
  };

  it('R-RISE-01: with no aura the body returns at bare printed base — 1 Attack, 1 Health (not its grown 9/9)', () => {
    const { back } = riseUnder({ undeadAtk: 0, undeadHp: 0, undeadBuyAtk: 0 });
    expect(back, 'the return value is the PRINTED body, never the body the fight had grown').toEqual([1, 1]);
  });

  it('R-RISE-01: under a live Undead Aura the SAME body returns at base+aura — auras are added after, not skipped', () => {
    const aura = { undeadAtk: 3, undeadHp: 2, undeadBuyAtk: 1 };
    const { start, back } = riseUnder(aura);
    // The starting body already carries the Lantern slice (applyAuras(…, false) at fight setup) — its stats
    // are 9/9 + 3/2. The buy-time slice is NOT re-added there (it was baked at buy time).
    expect(start, 'control: the aura is genuinely live this fight').toEqual([12, 11]);
    // RULED: base 1 + aura Attack 3 + the from-base buy slice 1 = 5; Health 1 + aura Health 2 = 3.
    // Reading (b) "auras skipped" would read [1, 1]; reading (c) "aura baked into the return" would read
    // [12, 11] (or 9/9 + aura). Only base-then-aura produces this triple.
    expect(back, 'base taken first (1/1), then every applicable aura folded onto the returned body').toEqual([5, 3]);
  });

  it('R-RISE-01: a GILDED Rise doubles the BASE only — the aura is still added afterwards, undoubled', () => {
    const r = simulate(
      [bm('footman', 20, 20, { keywords: ['R'], golden: true }), bm('sandbag', 0, 400)],
      [bm('sandbag', 20, 4000)],
      makeRng(4), CARD_INDEX,
      combatSide({ tier: 6, tribes: ALL_TRIBES, undeadAtk: 3, undeadHp: 2, undeadBuyAtk: 1 }), combatSide({ tier: 1 }),
    );
    const uid = r.initial.player[0]!.uid;
    const reborn = r.events.find((e) => e.type === 'reborn' && (e as { target?: string }).target === uid);
    expect(reborn, 'the gilded Footman must Rise').toBeDefined();
    // base 1 × gild 2 = 2, + aura 3 + buy slice 1 = 6; Health 1 + aura 2 = 3 (the aura is not gilded).
    expect([(reborn as { attack: number }).attack, (reborn as { hp: number }).hp],
      'gild multiplies the printed base, the aura lands on top at face value').toEqual([6, 3]);
  });
});

// ── §5.5 — a further window family beyond Avenge: the "first N times" window ───────────────────────────────

describe('temporal windows — first-N windows (§5.5)', () => {
  it('Solid Ground buffs exactly the first 2 summons, then the window is spent', () => {
    const { r } = run(
      [bm('wolvesden', 2, 1), bm('sandbag', 0, 500)],
      [bm('sandbag', 5, 4000)], { solidGroundLeft: 2, solidGroundStat: 4 });
    const wolves = summonsOf(r, 'cryptwolf');
    expect(wolves.length, 'the Echo must summon 3 wolves').toBe(3);
    const solid = r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === 'Solid Ground') as unknown as Array<{ target: string }>;
    expect(solid.map((b) => b.target), 'first two summons buffed in arrival order; the third arrives plain').toEqual([wolves[0]!.uid, wolves[1]!.uid]);
  });
});

// ── §3.5 — sabotage: the oracle must fail for the right reason, naming the right things ────────────────────

describe('temporal windows — sabotage (the oracle fails naming instance, window, expected, observed)', () => {
  it('a doctored expected count produces a failure naming the instance, its window, and both counts', () => {
    const { obs, uid } = run(
      [bm('kennel', 1, 600), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 400)],
      [bm('sandbag', 2, 4000)]);
    const kennel = uid(0);
    // Truth: at raw tally 4 the start-of-fight kennel has seen 4. Doctor the expectation to 5:
    const failure = windowFailure(obs, { sourceUid: kennel, atCount: 4, expectSeen: 5 });
    expect(failure, 'the doctored expectation MUST fail').not.toBeNull();
    expect(failure).toContain(kennel); // the source instance
    expect(failure).toContain('kennel'); // its card
    expect(failure).toContain('window opened at side-death 0'); // the observation window
    expect(failure).toContain('expected in-window count 5'); // the doctored expectation
    expect(failure).toContain('observed 4'); // the truth
    // And the undoctored expectation passes — the alarm is specific, not permanently red.
    expect(windowFailure(obs, { sourceUid: kennel, atCount: 4, expectSeen: 4 })).toBeNull();
  });
});
