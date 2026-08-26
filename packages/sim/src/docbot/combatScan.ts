/**
 * DOC BOT — the combat presence differential (tripwire 10), shared by `combatDifferential.test.ts` and the
 * `npm run docbot` CLI.
 *
 * The question, per combat-effect card: DOES ITS EFFECT CHANGE A FIGHT? `simulate()` runs the same battle
 * twice with the same seed — once with the card, once with a STAT-CLONE control (identical uid, stats and
 * keywords, but the effect-free control def) — and diffs the full result with both ids masked. If the two
 * fights are indistinguishable, the card's combat effect never influenced this battle.
 *
 * This is the GENERIC form of the phase tripwire: Conductor-in-combat would have been caught here with zero
 * registry entries, because a re-fired Shout that does nothing leaves the logs identical.
 *
 * The scenario stages the common trigger classes in one fight: the card attacks (onAttack), can kill a weak
 * enemy (onKill), takes damage and dies (onDamaged, onDeath), friendly deaths accumulate (avenge), summons
 * happen on both sides (onSummon, summonOverflow near-full board), and start of combat fires by itself.
 * Cards needing rarer conditions land in the INERT QUEUE with a reason, not a failure — the queue may only
 * grow with an excuse, and its members are exactly the blueprint's "questionable interactions" list.
 *
 * The GOLDEN lane replays the same fight with the card golden (same doubled stats on both sides of the
 * comparison, so only the EFFECT's golden behaviour differs): golden-flat cards join their own queue.
 */
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import { VANILLA_CONTROL_ID } from './playScan';

/** Triggers whose home (or second home) is combat — the worklist filter. */
const COMBAT_TRIGGERS = new Set([
  'onDeath', 'onAttack', 'startOfCombat', 'avenge', 'onKill', 'onDamaged', 'onSummon',
  'summonOverflow', 'friendlyDemonDealtDamage', 'spellCastOnThis', 'passive', 'onGainAttack',
]);

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = [], golden = false): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords, golden } as unknown as BoardMinion);

/** One fight, staged to exercise the common trigger classes. `subject` sits mid-board. */
function fight(subject: BoardMinion): string {
  const player: BoardMinion[] = [
    bm('pup', 'p0', 2, 2), // dies early → avenge fodder, friendly-death triggers
    subject,
    bm('cryptwolf', 'p2', 3, 3),
    bm('nanobot', 'p3', 2, 4),
    bm('n2_trooper', 'p4', 3, 2),
    bm('b2_trexbaby', 'p5', 2, 2),
  ];
  const enemy: BoardMinion[] = [
    bm('pup', 'e0', 1, 1), // killable → onKill
    bm('nanobot', 'e1', 4, 5),
    bm('cryptwolf', 'e2', 5, 6),
    bm('n2_trooper', 'e3', 6, 7), // kills the subject eventually → onDamaged, onDeath
  ];
  const result = simulate(player, enemy, makeRng(0xf17e), CARD_INDEX,
    combatSide({ tier: 5, tribes: ['beast', 'demon', 'dragon', 'dwarf', 'kobold'] as never }),
    combatSide({ tier: 5 }));
  return JSON.stringify({ events: result.events, result: result.result, playerDamage: result.playerDamage });
}

/** Mask a card's identity in a serialized fight so C-vs-control compares consequences, not labels. */
function mask(serialized: string, cardId: string, name: string): string {
  return serialized
    .split(`"${cardId}"`).join('"SUBJECT"')
    .split(name).join('SUBJECT');
}

export interface CombatScanResult {
  /** Combat-effect cards whose presence, vs a stat-clone control, changed nothing about the staged fight. */
  inert: string[];
  /** Cards whose effect acted, but identically when GOLDEN — the gild multiplied nothing in combat. */
  goldenFlat: string[];
  /** Cards the scan covered and confirmed active. */
  activeCount: number;
}

export function combatScan(): CombatScanResult {
  const inert: string[] = [];
  const goldenFlat: string[] = [];
  let activeCount = 0;
  const control = CARD_INDEX[VANILLA_CONTROL_ID]!;

  for (const def of Object.values(CARD_INDEX)) {
    if (!def || def.spell || def.ruby) continue;
    if (!def.effects.some((e) => COMBAT_TRIGGERS.has(e.on))) continue;
    const subjC = fight(bm(def.id, 'pS', Math.max(1, def.attack), Math.max(1, def.health), [...def.keywords]));
    const subjV = fight(bm(control.id, 'pS', Math.max(1, def.attack), Math.max(1, def.health), [...def.keywords]));
    if (mask(subjC, def.id, def.name) === mask(subjV, control.id, control.name)) {
      inert.push(def.id);
      continue;
    }
    activeCount++;
    // Golden lane: golden C vs plain C at the SAME (doubled) stats — only the effect's golden behaviour can differ.
    const g = fight(bm(def.id, 'pS', Math.max(1, def.attack) * 2, Math.max(1, def.health) * 2, [...def.keywords], true));
    const p = fight(bm(def.id, 'pS', Math.max(1, def.attack) * 2, Math.max(1, def.health) * 2, [...def.keywords], false));
    if (g === p) goldenFlat.push(def.id);
  }
  return { inert, goldenFlat, activeCount };
}

/** The defs the scan worklist covers — exported so the test can pin the surface size. */
export function combatWorklist(): CardDef[] {
  return Object.values(CARD_INDEX).filter((c): c is CardDef =>
    !!c && !c.spell && !c.ruby && c.effects.some((e) => COMBAT_TRIGGERS.has(e.on)));
}
