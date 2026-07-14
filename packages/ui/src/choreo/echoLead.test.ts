import { describe, it, expect } from 'vitest';
import { simulate, makeRng, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { deferClashBuffs } from './clashOrder';
import { consequenceLead } from '../useCombatReplay';

/**
 * Regression: a Deathrattle (echo) summon must ALWAYS get its read-lead — even when the clash also produced
 * an onDamaged buff (Target Dummy et al.) that `deferClashBuffs` slides to the clash tail, landing a
 * `buffWave` moment BETWEEN the death and its summon. Before the fix, `deathConsequenceLead` only inspected
 * the immediately-preceding moment, so the intervening buff made the summon pop in instantly (~46% of fights).
 * `consequenceLead` now walks back past buff moments to the death, so the lead reliably applies.
 */
const ECHO = ['broodmother', 'burialimp', 'deathlesshand', 'impking', 'impoverseer', 'manasaber', 'nanon', 'pack', 'twilightwhelp', 'wolvesden'];
const ATTACKERS = ['sandbag', 'twilightwhelp', 'manasaber', 'pack'];

function stats(cardId: string): BoardMinion {
  const d = CARD_INDEX[cardId];
  return { cardId, attack: d?.attack ?? 2, health: d?.health ?? 2 };
}

/** Build the UI's replay inputs (events after deferClashBuffs, moments, uid→cardId) for one fight. */
function replay(p: BoardMinion[], e: BoardMinion[], seed: number) {
  const r = simulate(p, e, makeRng(seed), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, ['dragon', 'demon', 'beast']);
  const events = deferClashBuffs(r.events as CombatEvent[]);
  const moments = compileMoments(events);
  const cardIds = new Map<string, string>();
  for (const m of [...r.initial.player, ...r.initial.enemy]) cardIds.set(m.uid, m.cardId);
  for (const ev of events) if (ev.type === 'summon') cardIds.set(ev.minion.uid, ev.minion.cardId);
  return { events, moments, cardIds };
}

const isEchoSummonMoment = (m: { start: number; primary: CombatEvent }, cardIds: Map<string, string>) => {
  if (m.primary.type !== 'summon' || !m.primary.source) return false;
  const src = cardIds.get(m.primary.source) ?? '';
  return !!CARD_INDEX[src]?.effects?.some((f) => f.on === 'onDeath' && f.do === 'deathrattleSummon');
};

describe('echo summon read-lead survives an intervening clash buff', () => {
  it('the classic case: Broodmother dying beside a Target Dummy still leads its whelps', () => {
    const { events, moments, cardIds } = replay(
      [stats('broodmother'), stats('sandbag')],
      [{ ...stats('sandbag'), attack: 6, health: 6 }],
      1,
    );
    // There is a buffWave moment sitting between the echo's death and its first summon (the bug's precondition).
    const firstEchoSummon = moments.findIndex((m) => isEchoSummonMoment(m, cardIds));
    expect(firstEchoSummon).toBeGreaterThan(0);
    expect(moments[firstEchoSummon - 1]!.kind).toBe('buffWave'); // the deferred buff really is in the way
    // …and the fix gives that summon a non-zero lead anyway.
    expect(consequenceLead(moments, firstEchoSummon, events, cardIds)).toBeGreaterThan(0);
  });

  it('across many boards, every FIRST echo summon gets a non-zero lead (was ~46% lead-less)', () => {
    const leadless: string[] = [];
    let firstConsequences = 0;
    for (const echo of ECHO) for (const atk of ATTACKERS) for (let seed = 1; seed <= 8; seed++) {
      const { events, moments, cardIds } = replay(
        [stats(echo), stats(echo), stats('sandbag')],
        [{ ...stats(atk), attack: 6, health: 6 }, { ...stats(atk), attack: 6, health: 6 }],
        seed,
      );
      moments.forEach((m, mi) => {
        if (!isEchoSummonMoment(m, cardIds)) return;
        // Walk back past buff moments; only a summon whose death is the effective preceding moment is a FIRST
        // consequence (a cascade's later summons sit behind a `summon` moment → correctly no extra lead).
        let li = mi - 1;
        while (li > 0 && moments[li]!.kind === 'buffWave') li--;
        const prev = moments[li]!;
        const src = m.primary.type === 'summon' ? m.primary.source : undefined;
        const deathOfSource = [...Array(prev.end - prev.start)].some((_, k) => {
          const ev = events[prev.start + k]!;
          return ev.type === 'death' && ev.target === src;
        });
        if (!deathOfSource) return; // not a first consequence (cascade tail) — no lead expected
        firstConsequences++;
        if (consequenceLead(moments, mi, events, cardIds) === 0) leadless.push(`${echo} vs ${atk} seed=${seed} moment ${mi}`);
      });
    }
    expect(firstConsequences).toBeGreaterThan(50); // the sweep actually exercised the path
    expect(leadless).toEqual([]);
  });

  it('the TWO summons from one death (Broodmother → 2 whelps) lead only ONCE', () => {
    // One Broodmother death emits two `summon` moments sharing its source uid — only the first should lead,
    // so the pair still reads as a single burst (no 800ms gap injected between the two tokens).
    const r = simulate([stats('broodmother')], [{ ...stats('sandbag'), attack: 9, health: 9 }], makeRng(2), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, ['dragon']);
    const events = deferClashBuffs(r.events as CombatEvent[]);
    const moments = compileMoments(events);
    const cardIds = new Map<string, string>();
    for (const m of [...r.initial.player, ...r.initial.enemy]) cardIds.set(m.uid, m.cardId);
    for (const ev of events) if (ev.type === 'summon') cardIds.set(ev.minion.uid, ev.minion.cardId);

    const broodUid = r.initial.player.find((m) => m.cardId === 'broodmother')!.uid;
    const broodSummons = moments
      .map((m, mi) => ({ m, mi }))
      .filter(({ m }) => m.primary.type === 'summon' && m.primary.source === broodUid);
    expect(broodSummons.length).toBe(2); // Broodmother's two Violet Whelps
    const led = broodSummons.filter(({ mi }) => consequenceLead(moments, mi, events, cardIds) > 0);
    expect(led.length).toBe(1); // exactly one lead for the pair
  });
});
