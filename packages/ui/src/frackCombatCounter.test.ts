/**
 * Frack Attack's N/3 counter ticks in COMBAT (owner report 2026-10-22: "frack attack's counter isnt working in combat,
 * please fix that").
 *
 * The sim ticks Frack's `attackSeen` on every friendly swing (`friendlyAttacksPlayRubiesSelf`), but the replay never
 * mirrored it: `computeFrame` only re-derived Crypt Drake's meter, so Frack's combat card sat on 0/3 all fight while
 * the Ruby repeats really fired. The fold now counts each friendly `attack` event for a living Frack and restarts the
 * meter on a Rise / Rebirth return, the same rule as the sim (R-KOBOLD-1022-02 / -05).
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type MinionSnapshot } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { computeFrame } from './useCombatReplay';
import { stepProgress } from './cardText';
import { deferClashBuffs } from './choreo/clashOrder';
import { deferAvengeAfterSummons } from './choreo/avengeOrder';

const bm = (uid: string, cardId: string, over: Record<string, unknown> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { uid, sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as unknown as BoardMinion;
};
const wall = (attack: number, uid = 'w'): BoardMinion => bm(uid, 'sandbag', { attack, health: 5000, keywords: [] });
const namesOf = (initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] }, events: CombatEvent[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (const m of [...initial.player, ...initial.enemy]) names.set(m.uid, m.name);
  for (const e of events) if (e.type === 'summon') names.set(e.minion.uid, e.minion.name);
  return names;
};

function replay(player: BoardMinion[], enemy: BoardMinion[], seed: number) {
  const r = simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
  const events = deferAvengeAfterSummons(deferClashBuffs(r.events));
  const frack = r.initial.player.find((m) => m.cardId === 'k3_frackattack')!.uid;
  const mine = new Set(r.initial.player.map((m) => m.uid));
  const names = namesOf(r.initial, events);
  /** The combat card's counter, exactly as Unit.tsx asks for it, after folding events [0, upto). */
  const counterAt = (upto: number): string | null => {
    const u = computeFrame(r.initial, events, upto, Math.max(0, upto - 1), names).player.find((x) => x.uid === frack);
    const p = u ? stepProgress(u.cardId, { attackSeen: u.attackSeen }) : null;
    return p ? `${p.current}/${p.total}` : null;
  };
  return { events, frack, mine, counterAt };
}

const cyc = (n: number) => (n <= 0 ? 0 : ((n - 1) % 3) + 1);

describe('Frack Attack: the combat counter follows every friendly attack', () => {
  it('ticks 1/3, 2/3, 3/3, 1/3 ... on each friendly swing (Flurry swings each count), never on an enemy swing', () => {
    const { events, frack, mine, counterAt } = replay([bm('f', 'k3_frackattack', { health: 5000 }), bm('k', 'k_blazer', { health: 5000, keywords: ['W'] })], [wall(1)], 2);
    let seen = 0, checked = 0;
    expect(counterAt(0)).toBe('0/3');
    for (let i = 0; i < events.length && checked < 12; i++) {
      const e = events[i]!;
      if (e.type !== 'attack') continue;
      if (mine.has(e.attacker)) seen++;
      expect(counterAt(i + 1), `after attack #${i} (${mine.has(e.attacker) ? 'friendly' : 'enemy'})`).toBe(`${cyc(seen)}/3`);
      checked++;
    }
    expect(seen).toBeGreaterThanOrEqual(6);
    // The counter lands on 3/3 on the swing whose Ruby repeat follows (the repeat is the next Frack self-Ruby).
    const third = events.findIndex((e, i) => e.type === 'attack' && mine.has(e.attacker)
      && events.slice(0, i + 1).filter((x) => x.type === 'attack' && mine.has(x.attacker)).length === 3);
    expect(counterAt(third + 1)).toBe('3/3');
    const repeat = events.findIndex((e, i) => i > third && e.type === 'buff' && e.ruby === true && e.source === frack && e.target === frack);
    expect(repeat).toBeGreaterThan(third);
    expect(events.slice(third + 1, repeat).some((e) => e.type === 'attack'), 'the repeat belongs to that swing').toBe(false);
  });

  it('a Rise return starts the counter over, as the sim does', () => {
    let returned = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { events, frack, mine, counterAt } = replay([bm('k', 'k_blazer', { health: 5000, keywords: ['W'] }), bm('f', 'k3_frackattack', { health: 150, keywords: ['R'] })], [wall(100)], seed);
      const back = events.findIndex((e) => e.type === 'reborn' && e.target === frack);
      if (back < 0) continue;
      returned++;
      expect(counterAt(back + 1), `seed ${seed}: fresh body`).toBe('0/3');
      const next = events.findIndex((e, i) => i > back && e.type === 'attack' && mine.has(e.attacker));
      if (next > 0 && !events.slice(back, next).some((e) => e.type === 'death' && e.target === frack)) expect(counterAt(next + 1)).toBe('1/3');
    }
    expect(returned).toBeGreaterThan(0);
  });
});
