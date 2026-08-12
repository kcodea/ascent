import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult, type CombatSideState } from '../index';

/**
 * The 2026-08-07 batch: the combat spell resolver grows past the stat family, and four cards ride it —
 * Mage-Pup's Shout re-trigger, Sporebat's stored-spell Echo, Badgington's random targeted cast, and Quil's
 * newly-unlocked Discover/refresh/economy casts. Plus Candle Conduit's combat-side bounce.
 */
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 40000 }];

function fight(player: BoardMinion[], sideExtra: Partial<CombatSideState> = {}, seed = 5): CombatResult {
  return simulate(player, wall, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'kobold'], ...sideExtra }), combatSide({ tier: 1 }));
}
const scNotes = (r: CombatResult): string[] =>
  r.events.flatMap((e: CombatEvent) => (e.type === 'sc' ? [e.text] : []));

describe('the resolver beyond the stat family (owner ruling: only pure tavern work fizzles)', () => {
  // Quil is the driver: its Start of Combat casts the left-most held spell, whatever family it is.
  const quil = (spell: string): CombatResult => fight(
    [{ cardId: 'stray', attack: 1, health: 400 }, { cardId: 'b2_quil', attack: 7, health: 400 },
     { cardId: 'stray', attack: 1, health: 400 }],
    { handSpellIds: [spell] });

  it('a DISCOVER spell carries the cast back for settle to queue (no modal mid-fight)', () => {
    // Beyond the Summit / any discoverOnPlay spell. Find one from the index so the test tracks content.
    const disc = Object.values(CARD_INDEX).find((c) => c.spell && c.discoverOnPlay && !c.token);
    expect(disc, 'no discover spell in the index').toBeDefined();
    const r = quil(disc!.id);
    expect(r.playerDiscoverCasts).toEqual([disc!.id]);
  });

  it('a REFRESH spell banks a free roll instead of vanishing', () => {
    expect(quil('spellcart').playerFreeRolls ?? 0).toBeGreaterThan(0);
  });

  it('a GOLD spell pays out through the bonus-Gold channel', () => {
    expect(quil('emberpouch').playerBonusGold ?? 0).toBeGreaterThan(0);
  });

  it('a SPELL-POWER spell raises the power mid-fight', () => {
    const sp = Object.values(CARD_INDEX).find((c) => c.spell && !c.token && c.effects.some((e) => e.do === 'spellGainSpellPower'));
    expect(sp, 'no spell-power spell in the index').toBeDefined();
    const r = quil(sp!.id);
    expect((r.playerSpellPower?.attack ?? 0) + (r.playerSpellPower?.health ?? 0)).toBeGreaterThan(0);
  });

  it('pure tavern work still fizzles — Displacement does nothing', () => {
    const r = quil('displacement');
    expect(r.playerSpellsCast ?? 0).toBe(0); // never counted as a cast, because nothing resolved
  });
});

describe('Mage-Pup — a combat Shout re-trigger casts the taught spell (the owner-reported gap)', () => {
  it('Dawnclaw-style replay: Ryme dies, the Pup Shout fires, the taught Growth resolves', () => {
    const r = fight([
      { cardId: 'ryme', attack: 5, health: 1 },                                   // dies → replays neighbour Shouts
      { cardId: 'b2_magepup', attack: 2, health: 200, taughtSpellId: 'growth' },  // knows Growth
      { cardId: 'stray', attack: 1, health: 200 },
    ]);
    expect(scNotes(r).some((t) => /casts Growth/.test(t)), 'the taught spell never cast').toBe(true);
    expect(r.playerSpellsCast ?? 0).toBeGreaterThan(0); // a genuine cast — watchers and the tally see it
  });

  it('a taught TARGETED spell picks a random friendly, exactly like the recruit repeater path', () => {
    const r = fight([
      { cardId: 'ryme', attack: 5, health: 1 },
      { cardId: 'b2_magepup', attack: 2, health: 200, taughtSpellId: 'fronttoback' },
      { cardId: 'stray', attack: 1, health: 200 },
    ]);
    expect(scNotes(r).some((t) => /casts Front to Back/.test(t))).toBe(true);
    // …and the escalating spell's improvement carries back, per the Front-to-Back ruling.
    expect(r.playerSpellEscalationGain).toEqual({ attack: 2, health: 2 });
  });

  it('an untaught Pup is a clean no-op', () => {
    const r = fight([
      { cardId: 'ryme', attack: 5, health: 1 },
      { cardId: 'b2_magepup', attack: 2, health: 200 },
    ]);
    expect(r.playerSpellsCast ?? 0).toBe(0);
  });
});

describe('Sporebat — Echo casts the STORED spell on a random friendly Beast', () => {
  it('a targeted stored spell aims at a Beast; with no Beast alive it fizzles', () => {
    const stored = { lastSpellCastId: 'spiritfire' };
    const withBeast = fight([
      { cardId: 'sporebat', attack: 2, health: 1 },
      { cardId: 'pack', attack: 3, health: 400 }, // a Beast to aim at
    ], stored);
    expect(withBeast.playerSpellsCast ?? 0).toBe(1);
    const noBeast = fight([
      { cardId: 'sporebat', attack: 2, health: 1 },
      { cardId: 'k_crownvein', attack: 3, health: 400 }, // a Kobold — not a legal aim
    ], stored);
    expect(noBeast.playerSpellsCast ?? 0).toBe(0);
  });
});

describe('Badgington — Rally grants a random Shop Spell to hand (owner rework 2026-08-11)', () => {
  it('on attack, a random non-token Shop spell is granted to hand — no other Beast required', () => {
    // The rework dropped the targeted-cast-on-a-Beast behaviour: Rally now simply mills a random Shop spell to
    // hand (via the shared rallyGrantSpell path), so a lone Badgington with no other Beast still pays out.
    const r = fight([{ cardId: 'badgington', attack: 30, health: 400 }]);
    const grants = r.playerHandGrants ?? [];
    expect(grants.length, 'no spell was granted').toBeGreaterThan(0);
    expect(grants.every((id) => CARD_INDEX[id]?.spell && !CARD_INDEX[id]?.token), 'a non-spell or token was granted').toBe(true);
  });

  it('golden grants twice as many per attack', () => {
    const solo = (fight([{ cardId: 'badgington', attack: 30, health: 400 }]).playerHandGrants ?? []).length;
    const gold = (fight([{ cardId: 'badgington', attack: 30, health: 400, golden: true }]).playerHandGrants ?? []).length;
    expect(solo, 'the ungilded fixture never granted').toBeGreaterThan(0);
    expect(gold).toBe(solo * 2);
  });
});

describe('Earthbreaker — the side guard (owner bug report 2026-08-07)', () => {
  it("an ENEMY Earthbreaker does not react to YOUR casts", () => {
    // Quil casts Growth on the player side; the enemy board holds an Earthbreaker. Before the guard it
    // buffed its whole side off that cast. Pin: no enemy-side buff events sourced from the Earthbreaker.
    const r = simulate(
      [{ cardId: 'stray', attack: 1, health: 400 }, { cardId: 'b2_quil', attack: 7, health: 400 },
       { cardId: 'stray', attack: 1, health: 400 }],
      [{ cardId: 'd2_scalechanter', attack: 4, health: 4000 }, { cardId: 'sandbag', attack: 0, health: 4000 }],
      makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'], handSpellIds: ['growth'] }), combatSide({ tier: 6 }));
    expect(r.playerSpellsCast ?? 0).toBeGreaterThan(0); // the cast really happened
    const enemyEB = r.initial.enemy.find((m) => m.cardId === 'd2_scalechanter')!;
    expect(r.events.some((e) => e.type === 'buff' && e.source === enemyEB.uid),
      'the enemy Earthbreaker reacted to the player cast').toBe(false);
  });

  it('its OWN side still works — a friendly Earthbreaker reacts to a friendly cast', () => {
    const r = simulate(
      [{ cardId: 'd2_scalechanter', attack: 4, health: 400 }, { cardId: 'b2_quil', attack: 7, health: 400 },
       { cardId: 'stray', attack: 1, health: 400 }],
      wall, makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast', 'dragon'], handSpellIds: ['growth'] }), combatSide({ tier: 1 }));
    const eb = r.initial.player.find((m) => m.cardId === 'd2_scalechanter')!;
    expect(r.events.some((e) => e.type === 'buff' && e.source === eb.uid), 'the friendly watcher broke').toBe(true);
  });
});
// Candle Conduit's combat-side Ruby bounce was RETIRED in the 2026-08-11 rework: it is now a recruit-phase
// `onGetRuby` reactor (cast a Ruby on a random friendly minion whenever you GET a Ruby), with no combat half at
// all. There is nothing left to pin in the combat simulator, so that block was removed — the new behaviour is
// covered in packages/sim/src/rubies.test.ts, where mintRubies / fireOnRubyGained are reachable.
