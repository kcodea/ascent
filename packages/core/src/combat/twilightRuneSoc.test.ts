/**
 * Rune of Twilight × RUNE Start-of-Combat effects (owner report + ruling 2026-09-21: "Rune of Twilight just did
 * not work with Rune of the Underdog" — Twilight used to re-fire only the MINION Start-of-Combat pass; every rune
 * block fired once. Now every rune whose printed text begins "Start of Combat:" gets one extra pass per Twilight
 * fire, in the same block order as the base pass, after the whole base pass for that side).
 *
 * The base pass must stay BYTE-IDENTICAL without Twilight (the pre-change logs of several rune boards were diffed
 * against the post-change logs while building this: identical), and Twilight with only minion SoC effects must
 * emit the same log it did before — pinned inline below.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion, type CombatEvent, type QuestCombatMods } from '../index';
import { CARD_INDEX } from '@game/content';

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon'];
type Mods = Partial<QuestCombatMods>;
const sim = (p: BoardMinion[], e: BoardMinion[], seed: number, mods: Mods = {}, enemyMods: Mods = {}) =>
  simulate(p, e, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods }), combatSide({ tier: 1, questMods: enemyMods }));
type R = ReturnType<typeof sim>;

/** A vanilla body (`drummer` has no effects, no keywords) so the only SoC events on the log are the runes'. */
const v = (attack: number, health: number, cardId = 'drummer'): BoardMinion => ({ cardId, attack, health });
/** A wall that never swings and never changes: every fight below resolves its Start of Combat cleanly. */
const wall: BoardMinion[] = [v(0, 1000)];

const triggers = (r: R, flag: string, side: 'player' | 'enemy' = 'player') =>
  r.events.filter((ev) => ev.type === 'questTrigger' && ev.flag === flag && ev.side === side);
const runeBuffs = (r: R, source: string): [string, number, number][] =>
  r.events.flatMap((ev) => (ev.type === 'buff' && ev.source === source ? [[ev.target, ev.attack, ev.health] as [string, number, number]] : []));
const stepOf = (ev: CombatEvent | undefined): number | undefined => (ev as { step?: number } | undefined)?.step;
/** Everything before the first swing: on a board with no immediate-attack rune that is the whole Start of Combat. */
const beforeFirstAttack = (r: R): CombatEvent[] => {
  const first = r.events.findIndex((ev) => ev.type === 'attack');
  return first < 0 ? r.events : r.events.slice(0, first);
};
/** The attackers of every `attack` event, in order. */
const attackers = (events: CombatEvent[]): string[] => events.flatMap((ev) => (ev.type === 'attack' ? [ev.attacker] : []));

describe('Rune of Twilight repeats RUNE Start-of-Combat effects (owner ruling 2026-09-21)', () => {
  it('Underdog: the two lowest are doubled TWICE (x4) — two runeUnderdog triggers, one Twilight pulse on the extra pass', () => {
    // [1/1, 2/2, 10/10]: the doubled pair (2/2, 4/4) is still below the 10/10, so the SAME two bodies are picked again.
    const r = sim([v(1, 1), v(2, 2), v(10, 10)], wall, 1, { runeTwilight: true, runeUnderdog: true });
    const [m0, m1] = r.initial.player.map((m) => m.uid);
    expect(triggers(r, 'runeUnderdog')).toHaveLength(2);
    expect(runeBuffs(r, 'Rune of the Underdog')).toEqual([[m0, 1, 1], [m1, 2, 2], [m0, 2, 2], [m1, 4, 4]]);
    // ONE badge pulse, on the beat of the FIRST extra effect — here the second Underdog trigger (no minion SoC on this board).
    const tw = triggers(r, 'runeTwilight');
    expect(tw).toHaveLength(1);
    const second = triggers(r, 'runeUnderdog')[1]!;
    expect(r.events.indexOf(tw[0]!)).toBeLessThan(r.events.indexOf(second));
    expect(stepOf(tw[0])).toBe(stepOf(second));
  });

  it('Underdog re-PICKS on the second pass from the doubled board (board-order tie-break) — it may choose different bodies', () => {
    // [1/4, 5/8, 9/9]: pass 1 doubles m0 -> 2/8 and m1 -> 10/16; pass 2 sorts by the NEW Attack, so the two lowest
    // are now m0 (2) and m2 (9): m0 -> 4/16, m2 -> 18/18. The 5/8 body is doubled once, the 9/9 once.
    const r = sim([v(1, 4), v(5, 8), v(9, 9)], wall, 1, { runeTwilight: true, runeUnderdog: true });
    const [m0, m1, m2] = r.initial.player.map((m) => m.uid);
    expect(runeBuffs(r, 'Rune of the Underdog')).toEqual([[m0, 1, 4], [m1, 5, 8], [m0, 2, 8], [m2, 9, 9]]);
  });

  it('Twilight multiplies PASSES, rune copies multiply WITHIN a pass (two Underdog copies + Twilight)', () => {
    const r = sim([v(1, 1), v(2, 2), v(100, 100)], wall, 1, { runeTwilight: true, runeUnderdog: true, flagCopies: { runeUnderdog: 2 } });
    const [m0, m1] = r.initial.player.map((m) => m.uid);
    expect(triggers(r, 'runeUnderdog')).toHaveLength(2);
    expect(runeBuffs(r, 'Rune of the Underdog')).toEqual([
      [m0, 1, 1], [m1, 2, 2], [m0, 2, 2], [m1, 4, 4], // pass 1: two doublings -> 4/4, 8/8
      [m0, 4, 4], [m1, 8, 8], [m0, 8, 8], [m1, 16, 16], // pass 2: two more -> 16/16, 32/32
    ]);
  });

  it('two Twilight copies add two extra rune passes (three runeUnderdog triggers)', () => {
    const r = sim([v(1, 1), v(2, 2), v(100, 100)], wall, 1, { runeTwilight: true, runeUnderdog: true, flagCopies: { runeTwilight: 2 } });
    expect(triggers(r, 'runeUnderdog')).toHaveLength(3);
    expect(triggers(r, 'runeTwilight')).toHaveLength(1);
  });

  it('a served ENEMY holding Twilight + Underdog repeats its own runes too', () => {
    const r = sim(wall, [v(1, 1), v(2, 2), v(10, 10)], 1, {}, { runeTwilight: true, runeUnderdog: true });
    expect(triggers(r, 'runeUnderdog', 'enemy')).toHaveLength(2);
    expect(triggers(r, 'runeUnderdog', 'player')).toHaveLength(0);
  });

  it('the pulse lands on the MINION re-fire when the board has one (it comes before the rune pass)', () => {
    const r = sim([v(1, 4, 'kennel'), v(5, 8), v(9, 9)], wall, 1, { runeTwilight: true, runeUnderdog: true });
    const tw = triggers(r, 'runeTwilight');
    expect(tw).toHaveLength(1);
    const kennelRefire = r.events.filter((ev) => ev.type === 'tribeAura')[1]!; // Kennelmaster's second aura = the Twilight minion pass
    expect(stepOf(tw[0])).toBe(stepOf(kennelRefire));
    expect(r.events.indexOf(tw[0]!)).toBeLessThan(r.events.indexOf(triggers(r, 'runeUnderdog')[0]!));
    expect(triggers(r, 'runeUnderdog')).toHaveLength(2);
  });

  it('Forthcoming: the front minion attacks immediately on BOTH passes (one more leading swing than without Twilight)', () => {
    const board = () => [v(3, 10), v(2, 2)];
    const leading = (r: R): number => { // the front body's swings before anyone else gets one
      const a = attackers(r.events);
      const m0 = r.initial.player[0]!.uid;
      const other = a.findIndex((x) => x !== m0);
      return other < 0 ? a.length : other;
    };
    const with2 = sim(board(), wall, 1, { runeTwilight: true, runeForthcoming: true });
    const with1 = sim(board(), wall, 1, { runeForthcoming: true });
    expect(triggers(with2, 'runeForthcoming')).toHaveLength(2);
    expect(triggers(with1, 'runeForthcoming')).toHaveLength(1);
    expect(leading(with1)).toBe(2); // one immediate strike + the loop's first swing
    expect(leading(with2)).toBe(3); // two immediate strikes + the loop's first swing
    // The second trigger is immediately followed by its own strike.
    const [t1, t2] = triggers(with2, 'runeForthcoming').map((t) => with2.events.indexOf(t));
    expect(attackers(with2.events.slice(t1!, t2!))).toEqual([with2.initial.player[0]!.uid]);
    expect(attackers(with2.events.slice(t2!))[0]).toBe(with2.initial.player[0]!.uid);
    // Ward is idempotent while it holds: one shieldUp on a wall that never pops it.
    expect(with2.events.filter((ev) => ev.type === 'shieldUp')).toHaveLength(1);
  });

  it('Forthcoming: the front is re-picked from the LIVING board; a Ward the first strike spent is granted again', () => {
    // A 1/1 front swings into a 10/50: its Ward eats the retaliation, so it is still the living front on pass 2,
    // gets its Ward back (the text says "gains Ward"), and swings again.
    const r = sim([v(1, 1), v(5, 5)], [v(10, 50)], 1, { runeTwilight: true, runeForthcoming: true });
    const m0 = r.initial.player[0]!.uid;
    const [t1, t2] = triggers(r, 'runeForthcoming').map((t) => r.events.indexOf(t));
    expect(attackers(r.events.slice(t1!, t2!))).toEqual([m0]);
    expect(attackers(r.events.slice(t2!))[0]).toBe(m0);
    expect(r.events.filter((ev) => ev.type === 'shieldUp' && ev.target === m0)).toHaveLength(2);
    expect(r.events.filter((ev) => ev.type === 'shield' && ev.target === m0)).toHaveLength(2); // both Wards popped
  });

  it('First Claws (its own later site): the end Beasts strike once more per pass', () => {
    const board = () => [v(3, 10, 'trailforager'), v(1, 1), v(2, 10, 'trailforager')];
    const r = sim(board(), wall, 1, { runeTwilight: true, runeFirstClaws: true });
    const [b0, m1, b2] = r.initial.player.map((m) => m.uid);
    expect(triggers(r, 'runeFirstClaws')).toHaveLength(2);
    expect(attackers(r.events).slice(0, 5)).toEqual([b0, b2, b0, b2, b0]); // pass 1, pass 2, then the loop opens
    const base = sim(board(), wall, 1, { runeFirstClaws: true });
    expect(attackers(base.events).slice(0, 4)).toEqual([b0, b2, b0, m1]);
  });

  it('First Claws: a Beast the first pass lost is not there to pick; with no Beast left the second pass does not fire', () => {
    // Two Beasts: the 1/1 dies to the 10/50 on pass 1; pass 2 finds only the 3/30 and it strikes alone.
    const r = sim([v(1, 1, 'trailforager'), v(3, 30, 'trailforager')], [v(10, 50)], 1, { runeTwilight: true, runeFirstClaws: true });
    const [b0, b1] = r.initial.player.map((m) => m.uid);
    const [t1, t2] = triggers(r, 'runeFirstClaws').map((t) => r.events.indexOf(t));
    expect(attackers(r.events.slice(t1!, t2!))).toEqual([b0, b1]);
    expect(r.events.slice(t1!, t2!).some((ev) => ev.type === 'death' && ev.target === b0)).toBe(true);
    expect(attackers(r.events.slice(t2!)).slice(0, 1)).toEqual([b1]);
    const lone = sim([v(1, 1, 'trailforager')], [v(10, 50)], 1, { runeTwilight: true, runeFirstClaws: true });
    expect(triggers(lone, 'runeFirstClaws')).toHaveLength(1);
    expect(triggers(lone, 'runeTwilight'), 'nothing extra fired: no pulse').toHaveLength(0);
  });

  it('Crucible: the second pass destroys the NEXT three, and BOTH banks return on the wipe (append, not overwrite)', () => {
    const seven = Array.from({ length: 7 }, () => v(2, 3));
    const r = sim(seven, [{ cardId: 'omen', attack: 40, health: 4000 }], 2, { runeTwilight: true, runeCrucible: 3 });
    expect(triggers(r, 'runeCrucible').length).toBeGreaterThanOrEqual(2);
    expect(beforeFirstAttack(r).filter((ev) => ev.type === 'death' && ev.side === 'player')).toHaveLength(6);
    // The lone survivor falls to Omen and all SIX sacrificed bodies come back.
    expect(r.events.filter((ev) => ev.type === 'summon' && ev.side === 'player')).toHaveLength(6);
  });

  it('Crucible on a 3-body board: pass 1 wipes the side (they return at once), pass 2 destroys the RETURNED bodies and they return again', () => {
    // The owner's "all" ruling, stated plainly: the extra pass sacrifices whatever is left-most at that moment,
    // including the bodies the first wipe just brought back.
    const r = sim([v(2, 3), v(2, 3), v(2, 3)], [{ cardId: 'omen', attack: 40, health: 4000 }], 2, { runeTwilight: true, runeCrucible: 3 });
    expect(beforeFirstAttack(r).filter((ev) => ev.type === 'death' && ev.side === 'player')).toHaveLength(6);
    expect(beforeFirstAttack(r).filter((ev) => ev.type === 'summon' && ev.side === 'player')).toHaveLength(6);
    expect(r.events.filter((ev) => ev.type === 'summon' && ev.side === 'player')).toHaveLength(6); // the bank is spent: no third return
  });

  it('Rebirth: the second grant lands on a body that does not already carry Rebirth; none left means no second trigger', () => {
    const two = sim([v(3, 4), v(3, 4)], [v(5, 400)], 1, { runeTwilight: true, runeRebirth: true });
    const rb = two.events.filter((ev) => ev.type === 'keyword' && ev.keyword === 'RB');
    expect(rb).toHaveLength(2);
    expect(new Set(rb.map((ev) => (ev as { target: string }).target)).size).toBe(2);
    expect(triggers(two, 'runeRebirth')).toHaveLength(2);
    const one = sim([v(3, 4)], [v(5, 400)], 1, { runeTwilight: true, runeRebirth: true });
    expect(one.events.filter((ev) => ev.type === 'keyword' && ev.keyword === 'RB')).toHaveLength(1);
    expect(triggers(one, 'runeRebirth')).toHaveLength(1);
  });

  it('Rising Graves: the second pass walks on to the NEXT Undead (a body with Rise already is skipped)', () => {
    const knit = (): BoardMinion => v(3, 2, 'knit');
    const three = sim([knit(), knit(), knit()], wall, 1, { runeTwilight: true, runeRisingGraves: true });
    expect(three.events.filter((ev) => ev.type === 'keyword' && ev.keyword === 'R')).toHaveLength(3); // 2 + the one left
    expect(triggers(three, 'runeRisingGraves')).toHaveLength(2);
    const four = sim([knit(), knit(), knit(), knit()], wall, 1, { runeTwilight: true, runeRisingGraves: true });
    expect(four.events.filter((ev) => ev.type === 'keyword' && ev.keyword === 'R')).toHaveLength(4);
    const twoOnly = sim([knit(), knit()], wall, 1, { runeTwilight: true, runeRisingGraves: true });
    expect(twoOnly.events.filter((ev) => ev.type === 'keyword' && ev.keyword === 'R')).toHaveLength(2);
    expect(triggers(twoOnly, 'runeRisingGraves'), 'nothing left to grant: no second trigger').toHaveLength(1);
  });

  it("Herald: 'trigger all your Echoes' triggers them AGAIN (Mama Pup's pups arrive twice over, before any death)", () => {
    const r = sim([v(3, 400, 'pack'), v(1, 400)], wall, 2, { runeTwilight: true, runeHerald: true });
    expect(triggers(r, 'runeHerald')).toHaveLength(2);
    const pups = beforeFirstAttack(r).filter((ev) => ev.type === 'summon' && ev.minion?.cardId === 'pup');
    expect(pups).toHaveLength(4);
    expect(beforeFirstAttack(r).some((ev) => ev.type === 'death')).toBe(false);
  });

  it('Stoked Menagerie: the full house is re-checked and three MORE random bodies double at their CURRENT stats', () => {
    const body: Record<string, string> = { beast: 'trailforager', undead: 'footman', mech: 'beatboxer', dragon: 'mauron', demon: 'godfodder' };
    const r = sim(ALL_TRIBES.map((t) => v(2, 2, body[t]!)), wall, 11, { runeTwilight: true, runeStokedMenagerie: true });
    expect(triggers(r, 'runeStokedMenagerie')).toHaveLength(2);
    const buffs = runeBuffs(r, 'Rune of the Stoked Menagerie');
    expect(buffs).toHaveLength(6);
    // Each doubling reads the body as it stands: the first hit on a body is +2/+2, a second hit on the same body +4/+4.
    const seen = new Map<string, number>();
    for (const [target, atk, hp] of buffs) {
      const n = seen.get(target) ?? 0;
      expect([atk, hp]).toEqual([2 << n, 2 << n]);
      seen.set(target, n + 1);
    }
  });

  it('Warding triples the right-most Health again (x9); Tempered Time grants half-Attack Health again; Vanguard keywords stay idempotent', () => {
    const w = sim([v(2, 4)], wall, 1, { runeTwilight: true, runeWarding: true });
    const w0 = w.initial.player[0]!.uid;
    expect(runeBuffs(w, w0)).toEqual([[w0, 0, 8], [w0, 0, 24]]); // 4 -> 12 -> 36
    expect(w.events.filter((ev) => ev.type === 'shieldUp')).toHaveLength(1);
    const t = sim([v(4, 4)], wall, 1, { runeTwilight: true, runeTemperedTime: true });
    const t0 = t.initial.player[0]!.uid;
    expect(runeBuffs(t, 'Rune of Tempered Time')).toEqual([[t0, 0, 2], [t0, 0, 2]]);
    const g = sim([v(2, 2), v(2, 2), v(2, 2)], wall, 1, { runeTwilight: true, runeVanguard: true });
    expect(triggers(g, 'runeVanguard')).toHaveLength(2);
    expect(g.events.filter((ev) => ev.type === 'shieldUp')).toHaveLength(3); // one Ward each, granted once
  });

  it('runes whose text does NOT begin "Start of Combat:" fire once: Warden, Sylus, Dawnclaw', () => {
    const w = sim([v(2, 2)], wall, 1, { runeTwilight: true, runeWarden: true });
    expect(triggers(w, 'runeWarden')).toHaveLength(1);
    expect(w.events.filter((ev) => ev.type === 'summon' && ev.minion?.cardId === 'knit')).toHaveLength(1);
    const s = sim([v(2, 2, 'sylus')], wall, 1, { runeTwilight: true, runeSylus: true });
    expect(triggers(s, 'runeSylus')).toHaveLength(1);
    const d = sim([v(2, 2, 'b2_dawnclaw'), v(2, 2)], wall, 1, { runeTwilight: true, runeDawnclaw: true });
    expect(triggers(d, 'runeDawnclaw')).toHaveLength(1);
  });

  it('is deterministic: the same seed twice gives the same log', () => {
    const a = sim([v(1, 4, 'kennel'), v(5, 8), v(9, 9)], wall, 7, { runeTwilight: true, runeUnderdog: true, runeRebirth: true });
    const b = sim([v(1, 4, 'kennel'), v(5, 8), v(9, 9)], wall, 7, { runeTwilight: true, runeUnderdog: true, runeRebirth: true });
    expect(a.events).toEqual(b.events);
  });

  it('Twilight with only MINION Start-of-Combat effects is unchanged (the pre-ruling log, pinned)', () => {
    // Captured from main before the rune passes existed: Kennelmaster + Gnasher + Twilight vs a 0/30 Target Dummy,
    // seed 1. Compact form: type, the who/what fields, and the beat step.
    const r = sim([v(1, 4, 'kennel'), v(5, 8, 'gnash')], [{ cardId: 'sandbag', attack: 0, health: 30 }], 1, { runeTwilight: true });
    const compact = r.events.map((ev) => {
      const e = ev as Record<string, unknown>;
      const bits: string[] = [ev.type];
      for (const k of ['flag', 'target', 'attacker', 'defender', 'attack', 'health', 'amount', 'remainingHp', 'side'] as const) {
        if (e[k] !== undefined) bits.push(`${k}=${String(e[k])}`);
      }
      bits.push(`s${String(e.step)}`);
      return bits.join(' ');
    });
    expect(compact).toEqual([
      'sc s1',
      'tribeAura attack=1 health=0 side=player s1',
      'buff target=m0 attack=1 health=0 s1',
      'buff target=m1 attack=1 health=0 s1',
      'questTrigger flag=runeTwilight side=player s2',
      'sc s2',
      'tribeAura attack=1 health=0 side=player s2',
      'buff target=m0 attack=1 health=0 s2',
      'buff target=m1 attack=1 health=0 s2',
      'attack attacker=m0 defender=m2 s3',
      'dmg target=m2 amount=3 remainingHp=27 s3',
      'buff target=m2 attack=1 health=0 s3',
      'attack attacker=m2 defender=m0 s5',
      'dmg target=m0 amount=1 remainingHp=3 s5',
      'dmg target=m2 amount=3 remainingHp=24 s5',
      'buff target=m2 attack=1 health=0 s5',
      'attack attacker=m1 defender=m2 s7',
      'dmg target=m2 amount=7 remainingHp=17 s7',
      'buff target=m2 attack=1 health=0 s7',
      'dmg target=m1 amount=2 remainingHp=6 s7',
      'attack attacker=m2 defender=m1 s9',
      'dmg target=m1 amount=3 remainingHp=3 s9',
      'dmg target=m2 amount=7 remainingHp=10 s9',
      'buff target=m2 attack=1 health=0 s9',
      'attack attacker=m0 defender=m2 s11',
      'dmg target=m2 amount=3 remainingHp=7 s11',
      'buff target=m2 attack=1 health=0 s11',
      'dmg target=m0 amount=4 remainingHp=0 s11',
      'death target=m0 side=player s12',
      'attack attacker=m2 defender=m1 s15',
      'dmg target=m1 amount=5 remainingHp=0 s15',
      'dmg target=m2 amount=7 remainingHp=0 s15',
      'buff target=m2 attack=1 health=0 s15',
      'death target=m1 side=player s16',
      'death target=m2 side=enemy s18',
    ]);
  });
});
