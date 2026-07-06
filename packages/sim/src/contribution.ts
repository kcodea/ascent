import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';

/**
 * Combat-contribution tracking. Walks a combat's event log (+ initial rosters) to attribute PLAYER-side
 * attack damage by cardId and count the player's mechanic triggers — accumulated across the run so the
 * post-run summary + career can name the **MVP minion** and the **most-triggered mechanic**.
 *
 * Pure: everything is derivable from `CombatResult` (events + `initial`), no simulate change needed. Combat is
 * SIMULTANEOUS — one `attack A→B` emits a `dmg` to B (dealt by A) AND a `dmg` to A (B's retaliation), so a
 * blow is credited to whichever of the pair ISN'T the one taking it. Start-of-Combat `cast` damage is credited
 * to the caster. Only enemy-directed damage counts (a player card is never credited for damage it soaks).
 */
export type RunDamage = Record<string, { name: string; damage: number }>; // keyed by cardId
export type RunProcs = Record<string, number>; // keyed by mechanic label

/** Attribute one combat's player-side damage (by cardId) + mechanic procs. */
export function tallyCombat(result: CombatResult): { damage: RunDamage; procs: RunProcs } {
  const owner = new Map<string, { side: string; cardId: string; name: string }>();
  for (const m of result.initial.player) owner.set(m.uid, { side: 'player', cardId: m.cardId, name: m.name });
  for (const m of result.initial.enemy) owner.set(m.uid, { side: 'enemy', cardId: m.cardId, name: m.name });
  for (const e of result.events) if (e.type === 'summon') owner.set(e.minion.uid, { side: e.side, cardId: e.minion.cardId, name: e.minion.name });

  const damage: RunDamage = {};
  const procs: RunProcs = {};
  const bump = (cat: string): void => { procs[cat] = (procs[cat] ?? 0) + 1; };
  const isPlayer = (uid: string | undefined): boolean => uid !== undefined && owner.get(uid)?.side === 'player';

  const credit = (dealer: string | undefined, target: string, amount: number): void => {
    const o = dealer ? owner.get(dealer) : undefined;
    if (o?.side !== 'player' || owner.get(target)?.side !== 'enemy' || amount <= 0) return;
    const d = damage[o.cardId] ?? { name: o.name, damage: 0 };
    d.damage += amount;
    damage[o.cardId] = d;
  };

  // The current damage context: an attack pair (`atkr`↔`defr`, a mutual exchange) or a Start-of-Combat cast
  // (`castSrc`). A `dmg` on the attacker is dealt by the defender and vice versa; cast damage is the caster's.
  let atkr: string | null = null;
  let defr: string | null = null;
  let castSrc: string | null = null;
  for (const e of result.events) {
    switch (e.type) {
      case 'attack': atkr = e.attacker; defr = e.defender; castSrc = null; break;
      case 'sc': if (isPlayer(e.source)) bump('Start of Combat'); castSrc = e.cast ? e.source : null; atkr = defr = null; break;
      case 'dmg': {
        const dealer = castSrc ?? (atkr != null ? (e.target === atkr ? defr : atkr) : null);
        credit(dealer ?? undefined, e.target, e.amount);
        break;
      }
      case 'rally': if (isPlayer(e.source)) bump('Rally'); break;
      case 'summon': if (e.side === 'player') bump('Summon'); break;
      case 'reborn': if (isPlayer(e.target)) bump('Rise'); break;
      case 'shieldUp': if (isPlayer(e.target)) bump('Ward'); break;
      case 'death': {
        if (e.rise) break; // a Rise's death isn't a kill — the body returns (its Echo is credited on its real death)
        const o = owner.get(e.target);
        if (o?.side === 'player' && CARD_INDEX[o.cardId]?.effects.some((x) => x.on === 'onDeath')) bump('Echo');
        break;
      }
      default: break;
    }
  }
  return { damage, procs };
}

/** Merge one combat's tally into the run-wide accumulators (mutates them). */
export function accumulateContribution(
  runDamage: RunDamage,
  runProcs: RunProcs,
  one: { damage: RunDamage; procs: RunProcs },
): void {
  for (const [cardId, d] of Object.entries(one.damage)) {
    const e = runDamage[cardId] ?? { name: d.name, damage: 0 };
    e.damage += d.damage;
    runDamage[cardId] = e;
  }
  for (const [cat, n] of Object.entries(one.procs)) runProcs[cat] = (runProcs[cat] ?? 0) + n;
}

/** The run's MVP — the card that dealt the most attack damage (null if nothing dealt damage). */
export function runMvp(runDamage: RunDamage | undefined): { name: string; damage: number } | null {
  let best: { name: string; damage: number } | null = null;
  for (const d of Object.values(runDamage ?? {})) if (!best || d.damage > best.damage) best = { name: d.name, damage: d.damage };
  return best && best.damage > 0 ? best : null;
}

/** The run's most-triggered combat mechanic (null if none fired). */
export function topMechanic(runProcs: RunProcs | undefined): { name: string; count: number } | null {
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of Object.entries(runProcs ?? {})) if (!best || count > best.count) best = { name, count };
  return best && best.count > 0 ? best : null;
}
