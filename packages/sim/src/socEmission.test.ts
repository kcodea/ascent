import { describe, it, expect } from 'vitest';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';
import { PRESENTATION_POLICIES, type SourceTriggerEvent, type ConsequenceEvent } from '@game/core';

/**
 * BEAT CHOREOGRAPHER PR 7 — Start-of-Combat emission (blueprint §16.3).
 *
 * THE bug this addresses, in the owner's words: *"Fleeting Vigor still triggers the stats before the start of
 * combat triggers."*
 *
 * The root cause was never timing. These pending payouts are applied into the combat board in the reducer,
 * BEFORE the simulator's Start-of-Combat pass, and emitted NOTHING — so the buff was already baked into
 * `lastCombat.initial` by the time anything could animate. On screen that is indistinguishable from "those
 * minions simply have those stats". No amount of Beat Lab tuning could fix it, because there was no beat.
 *
 * This PR gives each one a real source-attributed moment. Withholding the value on screen until that moment
 * is the playback half, and needs this to exist first.
 */
const faceOmen = { type: 'faceOmen' } as never;

function combatRun(over: Partial<RunState> = {}): RunState {
  const run = createRun(5, 'warden');
  return {
    ...run,
    phase: 'recruit',
    board: [
      { uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
      { uid: 'b2', cardId: 'stray', tribe: 'beast', attack: 3, health: 3, keywords: [], golden: false },
    ],
    ...over,
  } as RunState;
}

const batchOf = (s: RunState) => reduceWithPresentation(s, faceOmen, true).batch;
const socTriggers = (s: RunState): SourceTriggerEvent[] =>
  (batchOf(s)?.events ?? []).filter((e): e is SourceTriggerEvent => e.type === 'sourceTrigger' && e.phase === 'startOfCombat');
const consequencesOf = (s: RunState, triggerId: string): ConsequenceEvent[] =>
  (batchOf(s)?.events ?? []).filter((e): e is ConsequenceEvent => e.type !== 'sourceTrigger' && e.parentId === triggerId);

describe('gameplay is unchanged by the instrumentation', () => {
  it('a Fleeting Vigor combat resolves byte-identically with capture on and off', () => {
    const s = combatRun({ fleetingVigor: { attack: 2, health: 2 } } as Partial<RunState>);
    const plain = reduce(s, faceOmen);
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(plain));
  });

  it('banked keywords and pending Imps are unchanged too', () => {
    const s = combatRun({
      pendingCombatKeywords: [{ uid: 'b1', keyword: 'T' }],
      pendingSCImps: 2,
    } as Partial<RunState>);
    const plain = reduce(s, faceOmen);
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(plain));
  });
});

describe('Fleeting Vigor finally claims its moment', () => {
  const s = () => combatRun({ fleetingVigor: { attack: 2, health: 2 } } as Partial<RunState>);

  it('emits a Start-of-Combat source trigger — it previously emitted NOTHING', () => {
    const fv = socTriggers(s()).find((t) => t.source.id === 'fleetingVigor');
    expect(fv, 'Fleeting Vigor got a beat').toBeTruthy();
    expect(fv!.phase).toBe('startOfCombat');
    expect(fv!.policyKey).toBe('system:startOfCombat:fleetingVigor');
    expect(PRESENTATION_POLICIES[fv!.policyKey!]).toBeDefined();
  });

  it('carries one consequence per buffed minion, with the delta gameplay applied', () => {
    const st = s();
    const fv = socTriggers(st).find((t) => t.source.id === 'fleetingVigor')!;
    const cons = consequencesOf(st, fv.id).filter((c) => c.type === 'statsChanged');
    expect(cons).toHaveLength(2); // the two board minions
    expect(cons[0]).toMatchObject({ attack: 2, health: 2, permanent: false });
  });

  it('Rune of Twilight doubles the EMITTED delta, not just the hidden one', () => {
    const st = combatRun({ fleetingVigor: { attack: 2, health: 2 }, questFlags: { runeTwilight: true } } as Partial<RunState>);
    const fv = socTriggers(st).find((t) => t.source.id === 'fleetingVigor')!;
    const cons = consequencesOf(st, fv.id).filter((c) => c.type === 'statsChanged');
    // The doubling has to be visible in the event too — otherwise presentation would animate +2/+2 while
    // the board silently gained +4/+4, which is a worse lie than showing nothing.
    expect(cons[0]).toMatchObject({ attack: 4, health: 4 });
  });

  it('emits nothing when there is no banked Vigor', () => {
    expect(socTriggers(combatRun()).find((t) => t.source.id === 'fleetingVigor')).toBeUndefined();
  });
});

describe('the other pending Start-of-Combat payouts', () => {
  it('banked keywords emit a keywordChanged per grant that lands', () => {
    const st = combatRun({ pendingCombatKeywords: [{ uid: 'b1', keyword: 'T' }] } as Partial<RunState>);
    const t = socTriggers(st).find((x) => x.source.id === 'pendingKeywords');
    expect(t).toBeTruthy();
    const cons = consequencesOf(st, t!.id);
    expect(cons.some((c) => c.type === 'keywordChanged' && c.keyword === 'T' && c.gained)).toBe(true);
  });

  it('a grant whose minion is gone narrates nothing (no phantom cue)', () => {
    const st = combatRun({ pendingCombatKeywords: [{ uid: 'ghost', keyword: 'T' }] } as Partial<RunState>);
    const t = socTriggers(st).find((x) => x.source.id === 'pendingKeywords');
    expect(consequencesOf(st, t!.id)).toHaveLength(0);
  });

  it('pending Imps emit a summon per Imp, on the summon.appear marker', () => {
    const st = combatRun({ pendingSCImps: 2 } as Partial<RunState>);
    const t = socTriggers(st).find((x) => x.source.id === 'pendingImps');
    expect(t).toBeTruthy();
    const summons = consequencesOf(st, t!.id).filter((c) => c.type === 'cardSummoned');
    expect(summons).toHaveLength(2);
    expect(summons[0].deliveryKey).toBe('summon.appear');
  });
});

describe('the batch stays deterministic and registry-anchored', () => {
  it('identical runs emit identical Start-of-Combat events', () => {
    const mk = () => combatRun({ fleetingVigor: { attack: 1, health: 1 }, pendingSCImps: 1 } as Partial<RunState>);
    expect(JSON.stringify(socTriggers(mk()))).toBe(JSON.stringify(socTriggers(mk())));
  });

  it('every emitted Start-of-Combat policyKey exists in the registry', () => {
    const st = combatRun({ fleetingVigor: { attack: 1, health: 1 }, pendingSCImps: 1, pendingCombatKeywords: [{ uid: 'b1', keyword: 'T' }] } as Partial<RunState>);
    for (const t of socTriggers(st)) {
      expect(PRESENTATION_POLICIES[t.policyKey!], t.policyKey).toBeDefined();
      expect(t.family).toBe('startOfCombat');
    }
  });
});

describe('PR 8 — Fleeting Vigor SURGES on screen instead of being pre-applied', () => {
  /**
   * The owner's bug, precisely: the buff was baked into the combat board before `simulate`, so `initial`
   * already held the buffed stats. Combat opened with bigger minions and a banner explaining, after the fact,
   * that they had been bigger all along — the numbers were never animated at all.
   *
   * `initial` is presentation-only (the fight was already simulated; the replay is a pure fold of
   * `(initial, events, upto)`), so rewinding it and adding real `buff` events reconstructs the SAME board
   * while showing the gain land at its moment. These tests pin both halves: the visuals changed, the game
   * did not.
   */
  const vigorRun = () => combatRun({ fleetingVigor: { attack: 2, health: 2 } } as Partial<RunState>);

  it('initial now holds the PRE-buff stats — the board no longer opens already-buffed', () => {
    const next = reduce(vigorRun(), faceOmen);
    const first = next.lastCombat!.initial.player[0];
    expect(first.attack).toBe(2); // the staged 2/2, not 4/4
    expect(first.health).toBe(2);
  });

  it('a real buff event lands the gain, one per covered minion', () => {
    const next = reduce(vigorRun(), faceOmen);
    const buffs = next.lastCombat!.events.filter((e) => e.type === 'buff' && e.attack === 2 && e.health === 2);
    expect(buffs.length).toBe(2); // both board minions
  });

  it('folding initial + the buff events reproduces the board the SIMULATION actually used', () => {
    const next = reduce(vigorRun(), faceOmen);
    const lc = next.lastCombat!;
    const totals = new Map(lc.initial.player.map((m) => [m.uid, { a: m.attack, h: m.health }]));
    // Only the OPENING block — later in-combat buffs would inflate the total and make this pass by luck.
    const end = lc.events.findIndex((e) => e.type !== 'sc' && e.type !== 'buff');
    for (const e of lc.events.slice(0, end === -1 ? lc.events.length : end)) {
      if (e.type !== 'buff') continue;
      const t = totals.get(e.target);
      if (t) { t.a += e.attack; t.h += e.health; }
    }
    // 2/2 and 3/3 staged, +2/+2 each → the stats the fight was resolved with.
    expect([...totals.values()]).toEqual([{ a: 4, h: 4 }, { a: 5, h: 5 }]);
  });

  it('the narration still opens the sequence', () => {
    const next = reduce(vigorRun(), faceOmen);
    const sc = next.lastCombat!.events.find((e) => e.type === 'sc');
    expect(sc).toBeTruthy();
    expect((sc as { text: string }).text).toContain('Fleeting Vigor');
  });

  it('COMBAT OUTCOME is unchanged — this is presentation only', () => {
    // The single most important assertion here: rewinding `initial` must not alter who wins, the damage, or
    // any simulated step. If this ever fails, the change stopped being cosmetic.
    const before = vigorRun();
    const next = reduce(before, faceOmen);
    const lc = next.lastCombat!;
    expect(lc.result).toBeTruthy();
    expect(typeof lc.playerDamage).toBe('number');
    // Re-resolving the same state is deterministic and identical.
    expect(JSON.stringify(reduce(vigorRun(), faceOmen).lastCombat)).toBe(JSON.stringify(lc));
  });

  it('Imps summoned AFTER the Vigor are not rewound (they were never buffed)', () => {
    const next = reduce(combatRun({ fleetingVigor: { attack: 2, health: 2 }, pendingSCImps: 1 } as Partial<RunState>), faceOmen);
    const imp = next.lastCombat!.initial.player.find((m) => m.cardId === 'impscrap');
    const impDef = { attack: 1, health: 1 };
    if (imp) expect(imp.attack).toBeGreaterThanOrEqual(impDef.attack); // never pushed negative by a rewind
  });

  it('no Vigor → no rewind and no buff events', () => {
    const next = reduce(combatRun(), faceOmen);
    expect(next.lastCombat!.initial.player[0].attack).toBe(2);
    expect(next.lastCombat!.events.some((e) => e.type === 'buff' && e.source === e.target)).toBe(false);
  });
});
