import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';

/**
 * Rune of Shared Scripture (owner bug report 2026-10-07: "this rune is not working at all").
 * "The first Shop spell cast by your warband in combat triggers your left-most Shout and Rally."
 *
 * ROOT CAUSE: the rune listened inside `resolveCombatSpellCast`, which only SOME combat casters use (Sporebat,
 * Quil, Badgington, Dragonflame). Every `castRepeat` caster (Fatecarver / Taragosa / Hoardbreaker's Growth,
 * Watcher's Lantern of Souls, Ashen Broodlord's Staff of Guel) and the random-stat-spell casters (Spell Drummer,
 * Spark Capacitor) cast a real Shop spell through `castInCombat` without ever reaching it, so the rune never
 * heard them. It now listens on `spellResolved`, the per-cast chokepoint every combat cast reports through, and
 * counts only a genuine Shop-pool spell (R-SHOPSPELL-01: never a Ruby, Clue or token spell).
 */

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const killer = (): BoardMinion[] => [{ cardId: 'sandbag', attack: 1, health: 400 }];

type Side = Record<string, unknown>;
const run = (p: BoardMinion[], e: BoardMinion[], pSide: Side = {}, eSide: Side = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL_TRIBES, ...pSide } as never),
    combatSide({ tier: 6, tribes: ALL_TRIBES, ...eSide } as never));

const triggers = (events: CombatEvent[], side: 'player' | 'enemy') =>
  events.filter((ev) => ev.type === 'questTrigger' && (ev as { flag: string }).flag === 'runeSharedScripture'
    && (ev as { side: string }).side === side).length;
const shoutsBy = (events: CombatEvent[], uid: string) =>
  events.filter((ev) => ev.type === 'shout' && (ev as { target?: string }).target === uid).length;
const ralliesBy = (events: CombatEvent[], uid: string) =>
  events.filter((ev) => ev.type === 'sc' && (ev as { text: string }).text === 'Rally' && (ev as { source: string }).source === uid).length;

/** The owner's shape: a Growth caster that is NOT a `resolveCombatSpellCast` caller (Fatecarver, branch B). The
 *  Shout (Twilight Emissary) and the Rally (Badgington) are fat so they live through the whole fight. */
const board = (): BoardMinion[] => [
  { cardId: 'emissary', attack: 1, health: 300 },
  { cardId: 'badgington', attack: 1, health: 300 },
  { cardId: 'n2_fatecarver', attack: 1, health: 300, chosenOption: 1 } as BoardMinion,
];

describe('Rune of Shared Scripture: fires on the first combat Shop-spell cast from ANY caster', () => {
  it('a Fatecarver Growth cast (castRepeat path) fires it: exactly once a fight', () => {
    const r = run(board(), killer(), { questMods: { runeSharedScripture: true } });
    const growthCasts = r.events.filter((ev) => ev.type === 'spellcast' && (ev as { side: string }).side === 'player').length;
    expect(growthCasts, 'Fatecarver casts Growth many times this fight').toBeGreaterThan(1);
    expect(triggers(r.events, 'player'), 'the rune pulses once, on the FIRST cast only').toBe(1);
  });

  it('it fires the left-most Shout holder and the left-most Rally holder', () => {
    const p = board();
    const base = run(p, killer(), {});
    const armed = run(p, killer(), { questMods: { runeSharedScripture: true } });
    // Player uids are deterministic from board order; read them off the initial snapshot.
    const [emissary, badgington, fatecarver] = armed.initial.player.map((m) => m.uid);
    expect(shoutsBy(armed.events, emissary!) - shoutsBy(base.events, emissary!), 'Emissary (left-most Shout) Shouts once').toBe(1);
    expect(ralliesBy(armed.events, badgington!) - ralliesBy(base.events, badgington!), 'Badgington (left-most Rally) Rallies once more').toBe(1);
    expect(shoutsBy(armed.events, fatecarver!), 'Fatecarver has no Shout').toBe(0);
  });

  it('the latch resets every combat: a second fight fires it again', () => {
    const a = run(board(), killer(), { questMods: { runeSharedScripture: true } }, {}, 5);
    const b = run(board(), killer(), { questMods: { runeSharedScripture: true } }, {}, 6);
    expect(triggers(a.events, 'player')).toBe(1);
    expect(triggers(b.events, 'player')).toBe(1);
  });

  it('no spell cast: no fire', () => {
    const quiet: BoardMinion[] = [
      { cardId: 'emissary', attack: 1, health: 300 },
      { cardId: 'badgington', attack: 1, health: 300 },
    ];
    const r = run(quiet, killer(), { questMods: { runeSharedScripture: true } });
    expect(r.events.some((ev) => ev.type === 'spellcast'), 'fixture: nobody casts').toBe(false);
    expect(triggers(r.events, 'player')).toBe(0);
  });

  it('works for an ENEMY-side holder (served boards), and only on its own side\'s casts', () => {
    const r = run(killer(), board(), {}, { questMods: { runeSharedScripture: true } });
    expect(triggers(r.events, 'enemy')).toBe(1);
    expect(triggers(r.events, 'player')).toBe(0);
    // The opponent's casts never spend the player's rune.
    const mixed = run(killer(), board(), { questMods: { runeSharedScripture: true } }, {});
    expect(triggers(mixed.events, 'player'), 'the enemy cast Growth; the player cast nothing').toBe(0);
  });

  it('the Hoardbreaker Rally-cast and the Watcher Lantern cast count too', () => {
    for (const caster of ['hoardbreaker', 'watcher']) {
      const p: BoardMinion[] = [
        { cardId: 'emissary', attack: 1, health: 300 },
        { cardId: caster, attack: 1, health: 300 },
      ];
      const r = run(p, killer(), { questMods: { runeSharedScripture: true } });
      expect(triggers(r.events, 'player'), `${caster}'s cast fires the rune`).toBe(1);
    }
  });

  it('is deterministic: the same seed gives the same log', () => {
    const a = run(board(), killer(), { questMods: { runeSharedScripture: true } }, {}, 11);
    const b = run(board(), killer(), { questMods: { runeSharedScripture: true } }, {}, 11);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});
