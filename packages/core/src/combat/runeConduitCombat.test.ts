import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * RUNE OF THE CONDUIT in COMBAT (owner 2026-10-16: "rune of the conduit should work in combat, and for a case of
 * boulderdash, those rubies that bounce should be permanent. show the bounce animation in combat when it happens.").
 *
 *   · "Your Rubies all bounce an additional time." A Ruby cast in combat hops once more per copy, to a random OTHER
 *     living friendly minion, on EITHER side (R-SYMMETRY-01). The Shop half is `fireOnRubyPlayed`.
 *   · The hop inherits the landing's permanence: Boulderdash's "permanent Rubies" bounce PERMANENTLY, so the hop
 *     target's gain is reported in `permaBuffs` and carries back to its Shop card by uid. A plain combat Ruby's hop
 *     stays combat-only.
 *   · Every hop is a `buff` event stamped `ruby` + `bounce` provenance: the combat score's `bounceFx` channel plays
 *     the SAME `ruby-bounce` def the Shop plays off `bounceFx`. The rune's badge bursts off a `questTrigger`.
 */
const PLAIN_RALLY: CardDef = {
  id: 'cdt_plain', name: 'Plain Ruby Rally', tribe: 'kobold', tier: 1, attack: 2, health: 300, keywords: ['RL'],
  effects: [{ on: 'onAttack', do: 'rallyPlayRubiesSelf', params: { count: 1 } }],
  text: '**Rally:** Cast a **Ruby** on this.',
};
const CARDS: Record<string, CardDef> = { ...CARD_INDEX, [PLAIN_RALLY.id]: PLAIN_RALLY };

const bm = (uid: string, cardId: string, attack: number, health: number, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...(CARDS[cardId]!.keywords)], ...over } as unknown as BoardMinion);
const foe = (uid: string, attack: number, health: number): BoardMinion => bm(uid, 'sandbag', attack, health);
const side = (mods: object) => combatSide({ tier: 6, tribes: ['kobold', 'dwarf', 'beast', 'dragon', 'demon'], questMods: mods });
const fight = (mine: BoardMinion[], theirs: BoardMinion[], mine$: object = {}, theirs$: object = {}, seed = 7) =>
  simulate(mine, theirs, makeRng(seed), CARDS, side(mine$), side(theirs$));

type Buff = Extract<CombatEvent, { type: 'buff' }>;
const rubyBuffs = (evs: readonly CombatEvent[]): Buff[] => evs.filter((e): e is Buff => e.type === 'buff' && !!e.ruby);
const triggers = (evs: readonly CombatEvent[], flag: string, s: 'player' | 'enemy') =>
  evs.filter((e) => e.type === 'questTrigger' && e.flag === flag && e.side === s);
const attacksBy = (evs: readonly CombatEvent[], uid: string) => evs.filter((e) => e.type === 'attack' && e.attacker === uid);
const beforeFirstDeath = (evs: readonly CombatEvent[]): readonly CombatEvent[] => {
  const i = evs.findIndex((e) => e.type === 'death');
  return i < 0 ? evs : evs.slice(0, i);
};
/** Boulderdash (Flurry, Rally: cast 3 permanent Rubies on this) + two durable bystanders to bounce to. */
const dashBoard = () => [bm('d', 'k_boulderdash', 6, 400), bm('a', 'sandbag', 0, 400), bm('b', 'sandbag', 0, 400)];

describe('Rune of the Conduit — combat', () => {
  it('a combat Ruby cast bounces once more to ANOTHER friendly minion, stamped as a ruby bounce, and bursts the badge', () => {
    const r = fight(dashBoard(), [foe('f', 1, 2000)], { runeConduit: 1 });
    const d = r.initial.player[0]!.uid;
    const early = beforeFirstDeath(r.events);
    const swings = attacksBy(early, d).length;
    expect(swings).toBeGreaterThan(0);
    const landings = rubyBuffs(early).filter((e) => !e.bounce);
    const hops = rubyBuffs(early).filter((e) => e.bounce);
    expect(landings.length).toBe(swings);
    expect(hops.length, 'one hop per Ruby cast').toBe(swings);
    for (const h of hops) {
      expect(h.target).not.toBe(d);
      expect(h.bounce).toEqual({ from: d, kind: 'ruby' }); // the combat `bounceFx` channel plays `ruby-bounce` off this
      const land = landings[0]!;
      expect([h.attack, h.health], 'the hop carries the whole cast').toEqual([land.attack, land.health]);
    }
    expect(triggers(early, 'runeConduit', 'player').length, 'one badge burst per bouncing cast').toBe(swings);
  });

  it('works for the ENEMY side identically (R-SYMMETRY-01)', () => {
    const r = fight([foe('f', 1, 2000)], dashBoard(), {}, { runeConduit: 1 });
    const d = r.initial.enemy[0]!.uid;
    const early = beforeFirstDeath(r.events);
    const swings = attacksBy(early, d).length;
    expect(swings).toBeGreaterThan(0);
    const hops = rubyBuffs(early).filter((e) => e.bounce);
    expect(hops.length).toBe(swings);
    for (const h of hops) expect(h.bounce!.from).toBe(d);
    expect(triggers(early, 'runeConduit', 'enemy').length).toBe(swings);
    expect(triggers(early, 'runeConduit', 'player')).toHaveLength(0);
  });

  it('no rune, no hop; two copies hop twice; a lone minion has nowhere to hop', () => {
    const none = fight(dashBoard(), [foe('f', 1, 2000)]);
    expect(rubyBuffs(none.events).filter((e) => e.bounce)).toHaveLength(0);
    const two = fight(dashBoard(), [foe('f', 1, 2000)], { runeConduit: 2 });
    const early = beforeFirstDeath(two.events);
    expect(rubyBuffs(early).filter((e) => e.bounce).length).toBe(2 * attacksBy(early, two.initial.player[0]!.uid).length);
    const alone = fight([bm('d', 'k_boulderdash', 6, 400)], [foe('f', 1, 2000)], { runeConduit: 1 });
    expect(rubyBuffs(alone.events).filter((e) => e.bounce)).toHaveLength(0);
  });

  it("Boulderdash's bounced Rubies are PERMANENT: the hop targets carry the gain back as a Ruby", () => {
    const r = fight(dashBoard(), [foe('f', 1, 2000)], { runeConduit: 1 });
    const d = r.initial.player[0]!.uid;
    const hops = rubyBuffs(r.events).filter((e) => e.bounce && e.bounce.from === d);
    expect(hops.length).toBeGreaterThan(0);
    // Sum the hop gain per board card (combat uid → its run sourceUid by board index).
    const byUid = new Map(r.initial.player.map((m, i) => [m.uid, ['d', 'a', 'b'][i]!]));
    const expected = new Map<string, { attack: number; health: number }>();
    for (const h of hops) {
      const src = byUid.get(h.target)!;
      const cur = expected.get(src) ?? { attack: 0, health: 0 };
      expected.set(src, { attack: cur.attack + h.attack, health: cur.health + h.health });
    }
    for (const [src, gain] of expected) {
      const carried = (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === src && p.ruby);
      expect(carried.reduce((n, p) => n + p.attack, 0), `${src} keeps its bounced Rubies`).toBe(gain.attack);
      expect(carried.reduce((n, p) => n + p.health, 0)).toBe(gain.health);
    }
  });

  it('a NON-permanent combat Ruby bounces too, but its hop stays combat-only (no carry-back)', () => {
    const board = () => [bm('p', 'cdt_plain', 2, 400), bm('a', 'sandbag', 0, 400), bm('b', 'sandbag', 0, 400)];
    const r = fight(board(), [foe('f', 1, 2000)], { runeConduit: 1 });
    expect(rubyBuffs(r.events).filter((e) => e.bounce).length).toBeGreaterThan(0);
    // (Target Dummy's own "+1 Attack permanently when damaged" is a separate, non-Ruby carry-back.)
    expect((r.playerPermaBuffs ?? []).filter((p) => p.ruby), 'no Ruby carries back').toHaveLength(0);
  });

  it('is deterministic', () => {
    const once = () => JSON.stringify(fight(dashBoard(), [foe('f', 1, 2000)], { runeConduit: 1 }, { runeConduit: 1 }));
    expect(once()).toBe(once());
  });
});
