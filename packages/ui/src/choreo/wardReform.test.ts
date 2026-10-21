import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { replayBeats, replayOrder } from './replayOrder';
import { holdMs, WARD_REFORM_AFTER_BUFF_MS } from './clock';
import { deferClashBuffs, isWardReformEvent } from './clashOrder';
import { computeFrame } from '../useCombatReplay';
import type { Moment } from './compile';

/**
 * WARD RE-FORM BEATS (R-DWARF-1021-03, owner 2026-10-21: "can you show the ward break and then get re-applied? i think
 * it'd be more satisfying"). Foamguard's "the first time this loses Ward each combat, gain +10/+10 and Ward" plays as
 * three beats: the Ward BREAKS on the impact, the +10/+10 lands on the next (buff) beat, then the Ward RE-FORMS on its
 * own `shieldGain` moment (`ward-gain-blast`), ~250-400 ms after the break. Same on either side and on a risen body.
 */
const bm = (uid: string, cardId: string, attack: number, health: number, keywords: string[]): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords, golden: false } as unknown as BoardMinion);
const FG = (kw: string[] = ['T', 'DS']) => [bm('fg', 'dw3_foamguard', 4, 8, kw)];
const WALL = [bm('w1', 'sandbag', 100, 5000, [])];
const KEY = 'factory:onLoseWardOnceBuffSelfRegain:onLoseDivineShield';

type Fire = { breakAt: number; buffAt: number; reformAt: number; gapMs: number };

/** Every Foamguard fire in the compiled replay: the moment its Ward breaks, the moment its +10/+10 lands, the moment
 *  its Ward re-forms, and the base-speed (1x) time from the break moment showing to the re-form showing. */
function fires(events: CombatEvent[], fg: string): { moments: Moment[]; ordered: CombatEvent[]; fires: Fire[] } {
  const moments = replayBeats(events);
  const ordered = replayOrder(events);
  const out: Fire[] = [];
  const has = (m: Moment, p: (e: CombatEvent) => boolean) => ordered.slice(m.start, m.end).some(p);
  for (let r = 0; r < moments.length; r++) {
    if (!has(moments[r]!, (e) => e.type === 'shieldUp' && e.target === fg)) continue;
    let b = r - 1;
    while (b >= 0 && !has(moments[b]!, (e) => e.type === 'buff' && e.target === fg && e.key === KEY)) b--;
    let k = b - 1;
    while (k >= 0 && !has(moments[k]!, (e) => e.type === 'shield' && e.target === fg)) k--;
    let gap = 0;
    for (let j = k + 1; j <= r; j++) gap += holdMs(moments[j]!, moments[j - 1], 1);
    out.push({ breakAt: k, buffAt: b, reformAt: r, gapMs: gap });
  }
  return { moments, ordered, fires: out };
}

describe('Foamguard: Ward break, then +10/+10, then the Ward re-forms', () => {
  for (const side of ['player', 'enemy'] as const) {
    it(`${side} side: break moment, buff moment, own shieldGain moment, in that order, ~250-400 ms apart`, () => {
      const r = side === 'player'
        ? simulate(FG(), WALL, makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }))
        : simulate(WALL, FG(), makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
      const fg = r.initial[side].find((m) => m.cardId === 'dw3_foamguard')!.uid;
      const { moments, ordered, fires: fs } = fires(r.events, fg);
      expect(fs.length).toBe(1);
      const f = fs[0]!;
      expect(f.breakAt).toBeGreaterThanOrEqual(0);
      expect(f.breakAt).toBeLessThan(f.buffAt);
      expect(f.buffAt).toBeLessThan(f.reformAt);
      // The break's own moment no longer carries the Ward coming back (the break used to be hidden by it).
      expect(ordered.slice(moments[f.breakAt]!.start, moments[f.breakAt]!.end).some((e) => e.type === 'shieldUp')).toBe(false);
      // The re-form is its own Ward-gain moment, so the existing `ward-gain-blast` binding plays on it.
      expect(moments[f.reformAt]!.kind).toBe('shieldGain');
      expect(isWardReformEvent(moments[f.reformAt]!.primary)).toBe(true);
      expect(holdMs(moments[f.reformAt]!, moments[f.reformAt - 1], 1)).toBe(WARD_REFORM_AFTER_BUFF_MS);
      expect(f.gapMs).toBeGreaterThanOrEqual(250);
      expect(f.gapMs).toBeLessThanOrEqual(400);
    });
  }

  it('a risen Foamguard plays the same three beats on its second fire', () => {
    const r = simulate(FG(['T', 'DS', 'R']), WALL, makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const fg = r.initial.player[0]!.uid;
    const { moments, fires: fs } = fires(r.events, fg);
    expect(fs.length).toBe(2);
    const rebornAt = moments.findIndex((m) => m.primary.type === 'reborn');
    expect(fs[1]!.breakAt).toBeGreaterThan(rebornAt);
    for (const f of fs) {
      expect(f.breakAt).toBeLessThan(f.buffAt);
      expect(f.buffAt).toBeLessThan(f.reformAt);
      expect(moments[f.reformAt]!.kind).toBe('shieldGain');
      expect(f.gapMs).toBeGreaterThanOrEqual(250);
      expect(f.gapMs).toBeLessThanOrEqual(400);
    }
  });

  it('presentation only: the folded end state is identical to the raw log', () => {
    const r = simulate(FG(['T', 'DS', 'R', 'RB']), WALL, makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const ordered = replayOrder(r.events);
    expect(ordered).not.toBe(r.events);
    const names = new Map<string, string>();
    const end = (es: CombatEvent[]) => computeFrame(r.initial, es, es.length, es.length, names);
    expect(end(ordered)).toEqual(end(r.events));
  });

  it('a Ward re-form stays put when the same slice hits that body again after it', () => {
    const evs = [
      { type: 'shield', target: 'a' },
      { type: 'buff', target: 'a', attack: 10, health: 10, source: 'a', key: KEY },
      { type: 'shieldUp', target: 'a', key: KEY },
      { type: 'shield', target: 'a' },
    ] as CombatEvent[];
    expect(deferClashBuffs(evs).map((e) => e.type)).toEqual(['shield', 'shieldUp', 'shield', 'buff']);
  });

  it('an untriggered Ward gain (no effect key) is not treated as a re-form', () => {
    const evs = [{ type: 'shield', target: 'a' }, { type: 'shieldUp', target: 'a' }, { type: 'dmg', target: 'b', amount: 1, remainingHp: 1 }] as CombatEvent[];
    expect(deferClashBuffs(evs)).toBe(evs);
  });
});
