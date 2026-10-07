import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * RUNE OF THE SUNPONY (owner batch 2026-10-07), the real `simulate()`. "When a Beast attacks, give all of your Beasts
 * +1 Attack and this Rune's effect" — Sunmane Herald's spreading Rally with the rune as the source, through Sunmane's
 * own arena body (`rallySpreadTribeBuff`, `fixed` + `includeSelf`). The Shop half (buying it arms the flag, the flag
 * reaches the fight) is `packages/sim/src/beastRunes1007.test.ts`.
 */
const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'beast', tier: 1, attack: 1, health: 400, keywords: [], effects: [], text: '', ...over });
const B = probe('dbg_sp_beast', {});
const K = probe('dbg_sp_kobold', { tribe: 'kobold' });
/** An inert 0-Attack wall (the stock `sandbag` gains Attack when hit, which would start killing the player's line). */
const WALL = probe('dbg_sp_wall', { tribe: 'neutral', attack: 0, health: 100000 });
const CARDS: Record<string, CardDef> = { ...CARD_INDEX };
for (const c of [B, K, WALL]) CARDS[c.id] = c;

const bm = (uid: string, cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack: CARDS[cardId]!.attack, health: CARDS[cardId]!.health, keywords: [...(CARDS[cardId]!.keywords)], ...over } as unknown as BoardMinion);
/** A 0-Attack wall: the fight is nothing but the player's swings. */
const wall = (): BoardMinion => bm('w', WALL.id);
const fight = (mine: BoardMinion[], mods: object = {}, seed = 3) =>
  simulate(mine, [wall()], makeRng(seed), CARDS, combatSide({ tier: 6, tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], questMods: mods }), combatSide({ tier: 6 }));
type Ev = CombatEvent;
const triggers = (evs: readonly Ev[]) => evs.filter((e) => e.type === 'questTrigger' && e.flag === 'runeSunpony');
const playerUids = (r: ReturnType<typeof fight>) => r.initial.player.map((m) => m.uid);
/** The player swings, in order, each with the Attack buffs (summed per target) that landed before the NEXT swing. */
function swings(r: ReturnType<typeof fight>): { attacker: string; gains: Record<string, number> }[] {
  const mine = new Set(playerUids(r));
  const out: { attacker: string; gains: Record<string, number> }[] = [];
  for (const e of r.events) {
    if (e.type === 'attack') {
      if (mine.has(e.attacker)) out.push({ attacker: e.attacker, gains: {} });
      continue;
    }
    if (e.type === 'buff' && out.length > 0 && mine.has(e.target) && e.attack > 0) {
      const g = out[out.length - 1]!.gains;
      g[e.target] = (g[e.target] ?? 0) + e.attack;
    }
  }
  return out;
}

describe('Rune of the Sunpony — combat', () => {
  it('the first Beast attack gives ALL your Beasts (the attacker too) +1 Attack, and not your other minions', () => {
    const r = fight([bm('a', B.id), bm('b', B.id), bm('k', K.id)], { runeSunpony: true });
    const [p0, p1, k] = playerUids(r);
    const first = swings(r).find((s) => s.attacker !== k)!;
    expect(first.gains[p0!], 'Beast a').toBe(1);
    expect(first.gains[p1!], 'Beast b').toBe(1);
    expect(first.gains[k!] ?? 0, 'the Kobold').toBe(0);
    expect(triggers(r.events).length).toBeGreaterThan(0);
  });

  it('"this effect": every Beast carries Sunmane\'s spreading Rally, so a carrier passes on what it banked', () => {
    // Two Beasts. Swing 1 (say a): rune +1 to a and b, both bank 1 and become carriers. Swing 2 (b): b's grafted Rally
    // passes its banked 1 to a (never itself, Sunmane's rule), then the rune pays +1 to both: a +2, b +1.
    const r = fight([bm('a', B.id), bm('b', B.id)], { runeSunpony: true });
    const s = swings(r);
    expect(s.length).toBeGreaterThanOrEqual(2);
    const [one, two] = s;
    expect(Object.values(one!.gains)).toEqual([1, 1]);
    const other = playerUids(r).find((u) => u !== two!.attacker)!;
    expect(two!.gains[two!.attacker], 'the swinging carrier: the rune only').toBe(1);
    expect(two!.gains[other], 'the other Beast: the carried Rally + the rune').toBe(2);
    // Swing 3 proves ONE graft per body: a doubled graft would pass the banked value twice.
    if (s[2]) {
      const third = s[2];
      const rest = playerUids(r).find((u) => u !== third.attacker)!;
      // the third swinger banked 1 (swing 1) + its swing-2 gain; it passes that once, and the rune adds 1.
      const banked = 1 + (two!.attacker === third.attacker ? 1 : 2);
      expect(third.gains[rest], 'carried once + the rune').toBe(banked + 1);
      expect(third.gains[third.attacker]).toBe(1);
    }
  });

  it('a non-Beast attacking does nothing; without the rune nothing happens', () => {
    const kOnly = fight([bm('k', K.id), bm('k2', K.id)], { runeSunpony: true });
    expect(triggers(kOnly.events)).toHaveLength(0);
    const off = fight([bm('a', B.id), bm('b', B.id)], {});
    expect(triggers(off.events)).toHaveLength(0);
    expect(swings(off).every((s) => Object.keys(s.gains).length === 0), 'no rune: no Attack gains').toBe(true);
  });

  it('a Gilded attacker pays the same +1 (the rune is the source, not the Beast)', () => {
    const r = fight([bm('a', B.id, { golden: true } as Partial<BoardMinion>), bm('b', B.id)], { runeSunpony: true });
    expect(Object.values(swings(r)[0]!.gains)).toEqual([1, 1]);
  });

  it('two copies pay +2 per Beast attack', () => {
    const r = fight([bm('a', B.id), bm('b', B.id)], { runeSunpony: true, flagCopies: { runeSunpony: 2 } } as object);
    expect(Object.values(swings(r)[0]!.gains)).toEqual([2, 2]);
  });

  it('beside a real Sunmane: Sunmane\'s own Rally and the rune both fire (two sources), and no body is grafted twice', () => {
    const sun = CARDS['b2_sunmane']!;
    const r = fight([bm('s', 'b2_sunmane'), bm('b', B.id)], { runeSunpony: true });
    const [sUid, bUid] = playerUids(r);
    const sunSwing = swings(r).find((x) => x.attacker === sUid)!;
    expect(sunSwing, 'Sunmane swung').toBeTruthy();
    // Sunmane never buffs itself with its own Rally, so its swing gives it the rune's +1 only. The other Beast takes
    // Sunmane's grant (3, plus whatever the rune banked on Sunmane if b swung first) and the rune's +1. A second
    // graft on Sunmane (the rune re-grafting it) would fire its Rally twice and break both numbers.
    const bSwungFirst = swings(r)[0]!.attacker === bUid;
    expect(sunSwing.gains[sUid!], 'Sunmane: the rune only').toBe(1);
    expect(sunSwing.gains[bUid!], 'the other Beast: Sunmane (+3, +1 banked if b went first) and the rune').toBe(3 + (bSwungFirst ? 1 : 0) + 1);
    expect(sun.effects.filter((e) => e.do === 'rallySpreadTribeBuff')).toHaveLength(1);
  });

  it('is deterministic', () => {
    const a = fight([bm('a', B.id), bm('b', B.id), bm('c', B.id)], { runeSunpony: true }, 9);
    const b = fight([bm('a', B.id), bm('b', B.id), bm('c', B.id)], { runeSunpony: true }, 9);
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
  });
});

/**
 * "Does it stack appropriately?" (owner question on #1974). A Sunmane + 2 plain Beasts, three player swings, three
 * scenarios: rune alone, Sunmane alone, both. The engine is checked against an independent REFERENCE MODEL of the
 * two printed rules, so a dropped bank (e.g. the one-graft dedupe swallowing a grant) shows up as a mismatch:
 *   · a spread carrier swinging grants v = (3 if it is the printed Sunmane, else 0) + its bank to every OTHER Beast;
 *   · then the rune grants +1 to EVERY Beast (attacker included).
 * Every grant adds to the receiver's Attack AND its bank, and makes it a carrier. In this setup every Attack gain is a
 * spread grant, so bank = Attack - printed Attack.
 */
describe('Rune of the Sunpony + Sunmane Herald — banks stack additively (owner question 2026-10-07)', () => {
  const board = (): BoardMinion[] => [bm('s', 'b2_sunmane'), bm('a', B.id), bm('b', B.id)];
  const SWINGS = 3;
  type Row = { swing: number; attacker: string; atk: number[]; bank: number[] };
  /** Engine: Attack per Beast after each of the first SWINGS player swings (index order = board order). */
  function engine(mods: object, withSunmane: boolean): Row[] {
    const mine = withSunmane ? board() : [bm('s', B.id), bm('a', B.id), bm('b', B.id)];
    const r = fight(mine, mods);
    const uids = playerUids(r);
    const base = r.initial.player.map((m) => m.attack);
    const atk = [...base];
    const rows: Row[] = [];
    let cur = -1;
    for (const e of r.events) {
      if (e.type === 'attack' && uids.includes(e.attacker)) {
        if (cur >= 0) rows.push({ swing: rows.length + 1, attacker: uids[cur]!, atk: [...atk], bank: atk.map((x, i) => x - base[i]!) });
        if (rows.length === SWINGS) break;
        cur = uids.indexOf(e.attacker);
      } else if (e.type === 'buff' && uids.includes(e.target)) atk[uids.indexOf(e.target)]! += e.attack;
    }
    if (rows.length < SWINGS && cur >= 0) rows.push({ swing: rows.length + 1, attacker: uids[cur]!, atk: [...atk], bank: atk.map((x, i) => x - base[i]!) });
    // name attackers by board slot for the table
    return rows.map((row) => ({ ...row, attacker: ['s', 'a', 'b'][uids.indexOf(row.attacker)]! }));
  }
  /** Reference model of the printed rules, replaying the engine's own attack order. */
  function model(order: string[], rune: boolean, withSunmane: boolean): Row[] {
    const ids = ['s', 'a', 'b'];
    const base = withSunmane ? [5, 1, 1] : [1, 1, 1];
    const bank = [0, 0, 0];
    const carrier = [withSunmane, false, false];
    const rows: Row[] = [];
    order.forEach((who, k) => {
      const i = ids.indexOf(who);
      if (carrier[i]) {
        const v = (withSunmane && i === 0 ? 3 : 0) + bank[i]!;
        if (v > 0) for (let j = 0; j < 3; j++) if (j !== i) { bank[j]! += v; carrier[j] = true; }
      }
      if (rune) for (let j = 0; j < 3; j++) { bank[j]! += 1; carrier[j] = true; }
      rows.push({ swing: k + 1, attacker: who, atk: base.map((b, j) => b + bank[j]!), bank: [...bank] });
    });
    return rows;
  }
  const table = (name: string, rows: Row[]): string =>
    rows.map((r) => `${name} swing ${r.swing} (${r.attacker} attacks): Attack s/a/b ${r.atk.join('/')}, bank ${r.bank.join('/')}`).join('\n');

  it('rune alone, Sunmane alone, and both each match the reference model swing for swing (nothing dropped)', () => {
    const runeOnly = engine({ runeSunpony: true }, false);
    const sunOnly = engine({}, true);
    const both = engine({ runeSunpony: true }, true);
    for (const [name, rows, rune, sun] of [['rune', runeOnly, true, false], ['sunmane', sunOnly, false, true], ['both', both, true, true]] as const) {
      expect(rows, `${name}: ${SWINGS} swings observed`).toHaveLength(SWINGS);
      expect(rows, `${name}:\n${table(name, rows)}`).toEqual(model(rows.map((r) => r.attacker), rune, sun));
    }
    // Same attack order in all three (left to right), so the scenarios are comparable column by column.
    expect(both.map((r) => r.attacker)).toEqual(['s', 'a', 'b']);
    // The pinned numbers (owner-facing table, see the devlog).
    expect(runeOnly.map((r) => r.bank)).toEqual([[1, 1, 1], [3, 2, 3], [7, 6, 4]]);
    expect(sunOnly.map((r) => r.bank)).toEqual([[0, 3, 3], [3, 3, 6], [9, 9, 6]]);
    expect(both.map((r) => r.bank)).toEqual([[1, 4, 4], [6, 5, 9], [16, 15, 10]]);
    // EXACTLY additive: every Beast's bank with both = its bank with the rune alone + its bank with Sunmane alone, every
    // swing. A spread grant is linear in the carrier's bank, and the one-graft dedupe only skips a second COPY of the
    // Rally; the bank (`rallySpreadAtk`) always adds, and Sunmane's printed Rally reads it too. Nothing is dropped.
    for (let k = 0; k < SWINGS; k++) {
      expect(both[k]!.bank, `swing ${k + 1}`).toEqual(runeOnly[k]!.bank.map((x, j) => x + sunOnly[k]!.bank[j]!));
    }
  });
});
