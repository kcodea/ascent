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
