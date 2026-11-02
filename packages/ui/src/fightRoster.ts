import type { CombatEvent, MinionSnapshot } from '@game/core';

/**
 * EVERY BODY THAT FIGHTS IN A COMBAT (R-DUOS-FX-01): the starting boards, every `summon`, and every `tagIn`.
 *
 * The replay's uid lookups (uid -> card, side, name) used to be built from `initial` + `summon` only. A Versus Duos
 * fight brings a whole SECOND board in on a `tagIn` event (R-DUOS-TAGTEAM-01), with fresh uids that appear in neither,
 * so every lookup missed them: the teammate's board fought with no Deathrattle pulse, no authored damage or Shout FX,
 * no Rally or Flurry wind-up, no trigger pulse and generic narration (owner report 2026-11-02: "the second player's
 * animations maybe dont play"). Every lookup reads this one list, so a body that enters the fight by any path is known.
 * Pure. `events` may be the raw or the replay-ordered log: the set of bodies is the same.
 */
export interface FightBody {
  uid: string;
  cardId: string;
  name: string;
  side: 'player' | 'enemy';
}

type BodyLike = Pick<MinionSnapshot, 'uid' | 'cardId'> & { name?: string };
interface FightLike {
  initial: { player: readonly BodyLike[]; enemy: readonly BodyLike[] };
  events: readonly CombatEvent[];
}

export function fightBodies(combat: FightLike, events: readonly CombatEvent[] = combat.events): FightBody[] {
  const out: FightBody[] = [];
  for (const u of combat.initial.player) out.push({ uid: u.uid, cardId: u.cardId, name: u.name ?? u.cardId, side: 'player' });
  for (const u of combat.initial.enemy) out.push({ uid: u.uid, cardId: u.cardId, name: u.name ?? u.cardId, side: 'enemy' });
  for (const e of events) {
    if (e.type === 'summon') out.push({ uid: e.minion.uid, cardId: e.minion.cardId, name: e.minion.name, side: e.side as 'player' | 'enemy' });
    else if (e.type === 'tagIn') for (const m of e.minions) out.push({ uid: m.uid, cardId: m.cardId, name: m.name, side: e.side as 'player' | 'enemy' });
  }
  return out;
}

/** uid -> cardId for the whole fight. */
export function fightCardIds(combat: FightLike): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of fightBodies(combat)) m.set(b.uid, b.cardId);
  return m;
}
