import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';

/**
 * EVERY COMBAT CAST ANNOUNCES ITSELF, FROM ITS CASTER (owner report 2026-09-23, the cast preview):
 *
 *   *"why does fate carver not show the growth preview? warflame does."*
 *
 * The combat cast preview keys on `sc` events stamped with `spellId` (the 2026-09-01 identity rule). Warflame /
 * Flamebeat cast through `castNamedSpellInCombat`, which always logged that line. Fatecarver, Taragosa,
 * Hoardbreaker (Growth), Watcher (Lantern of Souls) and Ashen Broodlord (Staff of Guel) cast through the arena's
 * `castRepeat` verb, whose combat implementation ignored the spell id and logged nothing — a genuine cast, with
 * no "X casts Y" for the preview (or the Combat Log) to see. Anubis's Echo Lantern logged a line with no id.
 *
 * Each row: the caster's first cast of the fight is an `sc` from the CASTER's uid (not the attacker that
 * triggered it) carrying the spell's card id.
 */
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra } as unknown as BoardMinion);

const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 90000 } as BoardMinion];

function fight(player: BoardMinion[], enemy: BoardMinion[] = wall): CombatEvent[] {
  return simulate(player, enemy, makeRng(7), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 })).events;
}

/** The uid the simulator gave the minion stamped `sourceUid` — the first-listed player minion is `m0`, … */
function uidOf(events: CombatEvent[], player: BoardMinion[], sourceUid: string): string {
  void events;
  return `m${player.findIndex((m) => (m as { sourceUid?: string }).sourceUid === sourceUid)}`;
}

const castsBy = (events: CombatEvent[], source: string, spellId: string) =>
  events.filter((e) => e.type === 'sc' && e.source === source && e.spellId === spellId);

describe('combat casters announce the spell they cast, from the caster', () => {
  const rows: [name: string, board: BoardMinion[], casterSource: string, spellId: string][] = [
    ['Fatecarver (branch B) — Growth on a friendly attack', [bm('sandbag', 'ATK', 3, 900), bm('n2_fatecarver', 'FC', 0, 900, { chosenOption: 1 })], 'FC', 'growth'],
    ['Taragosa — Growth when a minion attacks', [bm('sandbag', 'ATK', 3, 900), bm('taragosa', 'TG', 0, 900)], 'TG', 'growth'],
    ['Hoardbreaker Drake — Rally: Growth', [bm('hoardbreaker', 'HB', 3, 900)], 'HB', 'growth'],
    ['Watcher — Rally: Lantern of Souls', [bm('watcher', 'WA', 3, 900)], 'WA', 'lanternofsouls'],
    ['Ashen Broodlord — Rally: Staff of Guel', [bm('d2_broodlord', 'AB', 3, 900)], 'AB', 'staffofguel'],
    // Already correct before the fix (castNamedSpellInCombat) — pinned so the two paths stay in step.
    ['Warflame — Dragonflame on a friendly Dragon attack', [bm('hoardbreaker', 'HB', 3, 900), bm('d2_warflame', 'WF', 0, 900)], 'WF', 'sp_dragonflame'],
    ['Flamebeat Drake — Rally: Dragonflame', [bm('d2_flamebeat', 'FB', 3, 900), bm('d2_ashscribe', 'D', 0, 900)], 'FB', 'sp_dragonflame'],
  ];

  it.each(rows)('%s', (_name, board, casterSource, spellId) => {
    const events = fight(board);
    const caster = uidOf(events, board, casterSource);
    const casts = castsBy(events, caster, spellId);
    expect(casts.length, `no "${spellId}" cast announced by ${casterSource} (${caster})`).toBeGreaterThan(0);
    // Anchored to the CASTER: no other body claims this spell's announcement.
    const others = events.filter((e) => e.type === 'sc' && e.spellId === spellId && e.source !== caster);
    expect(others, 'a cast announced from the attacker instead of the caster').toEqual([]);
  });

  it('Fatecarver announces ONE Growth per friendly attack (golden: two)', () => {
    for (const golden of [false, true]) {
      const board = [bm('sandbag', 'ATK', 3, 900), bm('n2_fatecarver', 'FC', 0, 900, { chosenOption: 1, golden })];
      const r = simulate(board, wall, makeRng(7), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
      const attacks = r.events.filter((e) => e.type === 'attack' && (e.attacker === 'm0' || e.attacker === 'm1')).length; // Growth arms Fatecarver too
      const casts = castsBy(r.events, 'm1', 'growth').length;
      expect(casts, `golden=${golden}`).toBe(attacks * (golden ? 2 : 1));
      expect(casts).toBe(r.playerSpellsCast ?? 0); // the announcement counts exactly the genuine casts
    }
  });

  it('Anubis\x27s Echo Lantern of Souls carries the spell id', () => {
    const board = [bm('anubis', 'AN', 1, 1)];
    const events = fight(board, [bm('sandbag', 'E', 50, 90000)]);
    const lantern = events.filter((e) => e.type === 'sc' && e.source === 'm0' && /Lantern of Souls/.test(e.text));
    expect(lantern.length, 'Anubis never cast its Lantern').toBeGreaterThan(0);
    for (const e of lantern) expect((e as { spellId?: string }).spellId).toBe('lanternofsouls');
  });
});
