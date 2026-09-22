/**
 * A SUMMONED Avenge minion's live counter starts at 0/N (owner report 2026-09-21, bug 8e0b4757).
 *
 * The sim already counts a mid-combat summon's Avenge from its own arrival: `placeSummon` stamps
 * `avengeBaseline = deaths[side]` (rule R-AVWIN-01 "Late entry starts at zero", the 2026-08-24 fix). The combat
 * READOUT did not mirror it: `computeFrame` stamped its per-uid Avenge floor only on a Rise (`reborn`) and never
 * on a `summon`, so a Dunkey that Bullseye's Echo summoned after two friendly deaths landed reading 2/4 while
 * the sim's own window for it read 0/4. The printed number is a live value by contract (CLAUDE.md), so the
 * readout must subtract the same baseline the sim does.
 *
 * Two guards: the captured fight from the report (the sim's real `initial` + event log, folded exactly as the
 * arena does), and a minimal hand-built log that walks the counter through a full window after arrival.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type MinionSnapshot } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { computeFrame } from './useCombatReplay';
import { stepProgress } from './cardText';
import { deferClashBuffs } from './choreo/clashOrder';
import { deferAvengeAfterSummons } from './choreo/avengeOrder';

const namesOf = (initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] }, events: CombatEvent[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (const m of [...initial.player, ...initial.enemy]) names.set(m.uid, m.name);
  for (const e of events) if (e.type === 'summon') names.set(e.minion.uid, e.minion.name);
  return names;
};

/** The unit's live Avenge counter as the card prints it ("current/total"), read off a folded frame. */
const readout = (frame: ReturnType<typeof computeFrame>, uid: string): string | null => {
  const u = frame.player.find((x) => x.uid === uid);
  if (!u) return null;
  const p = stepProgress(u.cardId, { avengeSeen: u.avengeSeen });
  return p ? `${p.current}/${p.total}` : null;
};

describe('bug 8e0b4757: the captured fight — Dunkey summoned by Bullseye after two friendly deaths', () => {
  const cap = JSON.parse(readFileSync(new URL('./avengeSummonReadout.capsule.json', import.meta.url), 'utf8')) as {
    initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] }; events: CombatEvent[];
  };
  // The arena folds the replay's normalized copy of the log; both reorders are presentation-only and neither
  // moves a summon ahead of the death that caused it, so the fold sees death -> summon exactly as the sim did.
  const events = deferAvengeAfterSummons(deferClashBuffs(cap.events));
  const names = namesOf(cap.initial, events);
  const summonAt = events.findIndex((e) => e.type === 'summon' && e.minion.cardId === 'b2_dunkey');
  const dunkey = (events[summonAt] as Extract<CombatEvent, { type: 'summon' }>).minion.uid;
  const friendlyDeathsBefore = events.slice(0, summonAt).filter((e) => e.type === 'death' && e.side === 'player').length;

  it('the capture is the bug window: Dunkey arrives after friendly deaths have already accrued', () => {
    expect(summonAt).toBeGreaterThan(0);
    expect(friendlyDeathsBefore).toBe(2);
  });

  it('Dunkey reads 0/4 on the beat it lands (not the side tally it never witnessed)', () => {
    const frame = computeFrame(cap.initial, events, summonAt + 1, summonAt, names);
    expect(readout(frame, dunkey)).toBe('0/4');
  });

  it('its counter ticks from its OWN arrival: 1/4 after the next friendly death', () => {
    const nextDeath = events.findIndex((e, i) => i > summonAt && e.type === 'death' && e.side === 'player');
    expect(nextDeath).toBeGreaterThan(summonAt);
    const frame = computeFrame(cap.initial, events, nextDeath + 1, nextDeath, names);
    expect(readout(frame, dunkey)).toBe('1/4');
  });

  it('a start-of-fight Avenge body (Kennelmaster) still counts the whole fight', () => {
    const nextDeath = events.findIndex((e, i) => i > summonAt && e.type === 'death' && e.side === 'player');
    const frame = computeFrame(cap.initial, events, nextDeath + 1, nextDeath, names);
    expect(readout(frame, 'm4')).toBe('3/4');
  });
});

describe('a summoned Avenge minion counts from its own arrival (hand-built log)', () => {
  const snap = (uid: string, cardId: string, name: string): MinionSnapshot =>
    ({ uid, cardId, name, tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false, summonBonus: 0 }) as MinionSnapshot;
  const initial = {
    player: [snap('p0', 'b2_bullseye', 'Bullseye'), snap('p1', 'kennel', 'Kennelmaster'), snap('p2', 'sandbag', 'Sandbag'),
      snap('p3', 'sandbag', 'Sandbag'), snap('p4', 'sandbag', 'Sandbag'), snap('p5', 'sandbag', 'Sandbag'), snap('p6', 'sandbag', 'Sandbag')],
    enemy: [snap('e0', 'sandbag', 'Sandbag')],
  };
  const death = (target: string, step: number): CombatEvent => ({ type: 'death', side: 'player', target, step } as CombatEvent);
  const events = [
    death('p2', 1),
    death('p0', 2), // Bullseye dies as the 2nd friendly death and its Echo summons Dunkey
    { type: 'summon', side: 'player', index: 0, source: 'p0', step: 3,
      minion: { uid: 'd1', cardId: 'b2_dunkey', name: 'Dunkey', tribe: 'beast', attack: 7, health: 7, keywords: [], golden: false, summonBonus: 0 } },
    death('p3', 4), death('p4', 5), death('p5', 6), death('p6', 7),
  ] as CombatEvent[];
  const names = namesOf(initial, events);
  const at = (i: number) => computeFrame(initial, events, i + 1, i, names);

  it('reads 0/4 when summoned after 2 friendly deaths, and pays only after 4 MORE', () => {
    expect(readout(at(2), 'd1')).toBe('0/4');
    expect(readout(at(3), 'd1')).toBe('1/4');
    expect(readout(at(4), 'd1')).toBe('2/4');
    expect(readout(at(5), 'd1')).toBe('3/4');
    expect(readout(at(6), 'd1')).toBe('4/4'); // its 4th death, the side's 6th
  });

  it('does not disturb a start-of-fight Avenge body, which counts every friendly death', () => {
    expect(readout(at(2), 'p1')).toBe('2/4');
    expect(readout(at(4), 'p1')).toBe('4/4');
    expect(readout(at(6), 'p1')).toBe('2/4'); // 6 deaths: the counter wrapped after its payout at 4
  });
});

/**
 * The RECLAIMED shape (Soren): the sim brings the copy back through `flushResummons`, which now stamps the same
 * baseline as `placeSummon`, so the printed counter and the fired effect agree on this path too. Same scenario as
 * the sim guard in packages/core/src/combat/avengeSummonBaseline.test.ts, folded through the arena's frame: the
 * copy reads 0/4 on return, ticks once per later friendly death, and prints 4/4 on the very beat its Avenge pays.
 */
describe('a Reclaimed (Soren) Avenge minion reads 0/4 on its return and pays on the beat it prints 4/4', () => {
  const fodder: BoardMinion = { cardId: 'b2_elderhorn', attack: 1, health: 1 };
  const player: BoardMinion[] = [{ cardId: 'kennel', attack: 1, health: 20, resummon: true }, fodder, fodder, fodder, fodder, fodder];
  const enemy: BoardMinion[] = [{ cardId: 'b2_elderhorn', attack: 1, health: 400 }];
  const r = simulate(player, enemy, makeRng(1), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'] }), combatSide({ tier: 1 }));
  const events = deferAvengeAfterSummons(deferClashBuffs(r.events));
  const names = namesOf(r.initial, events);
  const returnAt = events.findIndex((e) => e.type === 'summon' && e.minion.cardId === 'kennel');
  const copy = (events[returnAt] as Extract<CombatEvent, { type: 'summon' }>).minion.uid;
  const deathsAfter = events.map((e, i) => i).filter((i) => i > returnAt && events[i]!.type === 'death' && (events[i] as { side?: string }).side === 'player');
  const improveAt = events.findIndex((e) => e.type === 'improve' && e.avenge && e.target === copy);
  const at = (i: number) => computeFrame(r.initial, events, i + 1, i, names);

  it('the scenario reclaims the copy after its own destruction and reaches its payout', () => {
    expect(returnAt).toBeGreaterThan(0);
    expect(events.slice(0, returnAt).filter((e) => e.type === 'death' && e.side === 'player')).toHaveLength(1);
    expect(improveAt).toBeGreaterThan(returnAt);
  });

  it('reads 0/4 on the beat it returns', () => {
    expect(readout(at(returnAt), copy)).toBe('0/4');
  });

  it('ticks once per friendly death after its return: 1/4, 2/4, 3/4', () => {
    expect(readout(at(deathsAfter[0]!), copy)).toBe('1/4');
    expect(readout(at(deathsAfter[1]!), copy)).toBe('2/4');
    expect(readout(at(deathsAfter[2]!), copy)).toBe('3/4');
  });

  it('prints 4/4 on the beat its Avenge fires (the readout and the sim agree on the window)', () => {
    expect(deathsAfter[3]).toBeLessThan(improveAt);
    expect(readout(at(deathsAfter[3]!), copy)).toBe('4/4');
    expect(readout(at(improveAt), copy)).toBe('4/4');
  });
});
