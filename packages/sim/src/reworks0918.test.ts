import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, EQUIPMENT_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn } from './recruit';
import { cardTypeTallyText } from '../../ui/src/cardText';

/**
 * OWNER HANDOFF 2026-09-18 — eleven Kobold / Neutral / Undead / Celestial reworks. Each card's sentence is the
 * owner's, verbatim (with the keyword bolding), and each block below pins the MECHANIC the sentence promises:
 *
 *  1. Dual Rubetta's: improve your Rubies +1/+1, then a Ruby on your left-most AND right-most Kobold.
 *  2. Korn: Rally → a PERMANENT Ruby on itself (carries back).
 *  3. Kobe: Taunt; WHEN THIS TAKES DAMAGE, 1 permanent Ruby (3 until the 2026-09-20 nerf)es on this + adjacent Kobolds (carry back).
 *  4. Boulderdash: Flurry + Rally: 3 permanent Rubies on this (two swings, two Rallies).
 *  5. Livewire: a Shop spell → a Ruby on this + 2 RANDOM OTHER Kobolds.
 *  6. Paragon: +5/+5 (pinned by finalTranche / ownerBatchSep01 — the magnitude moved there).
 *  7. Deathsayer: Rally → your left-most Echo AND your left-most Shout.
 *  8. Neptus: Rally → a copy of the turn's first Shop spell — EVERY attack (no once-per-combat latch).
 *  9. Arena Heckler 6/5: Start of Combat → the opposite minion gains Taunt and Heckler attacks it immediately.
 * 10. Spear Warden 4/2: HAS +4/+2 per Spear Warden that died this game — a death count, not an Echo.
 * 11. Cage Breaker / EMS: never themselves (the global rule lives in `noSelfTarget.test.ts`).
 */

const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack, health, sourceUid: uid, keywords: [...d.keywords], ...extra } as BoardMinion;
};
const foe = (cardId: string, attack: number, health: number): BoardMinion => ({ cardId, attack, health, keywords: [] } as unknown as BoardMinion);
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: ['kobold', 'undead', 'dwarf'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const rubiesOn = (c: BoardCard): number => (c.buffs ?? []).filter((b) => b.source === 'Ruby').reduce((n, b) => n + (b.count ?? 1), 0);
const fight = (mine: BoardMinion[], foes: BoardMinion[], side: Record<string, unknown> = {}, seed = 3) =>
  simulate(mine, foes, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id), ...side } as never), combatSide({ tier: 1 }));
const uidOf = (r: { initial: { player: { uid: string; cardId: string }[] } }, cardId: string) => r.initial.player.find((m) => m.cardId === cardId)!.uid;
const permaRubies = (r: { playerPermaBuffs?: { sourceUid: string; ruby?: boolean; attack: number; health: number }[] }, uid: string) =>
  (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === uid && p.ruby);
/** Total Ruby ATTACK landed on `target` by `source` — one `buff` event carries a whole "N Rubies" play, so the count of
 *  Rubies is the summed attack at base strength (1/1 each). */
const rubyAttackOn = (r: { events: readonly CombatEvent[] }, target: string, source: string): number =>
  r.events.filter((e) => e.type === 'buff' && (e as { ruby?: boolean }).ruby && (e as { target: string }).target === target && (e as { source: string }).source === source)
    .reduce((n, e) => n + (e as { attack: number }).attack, 0);

// ── 1. Dual Rubetta's ─────────────────────────────────────────────────────────────────────────────────────
describe("Dual Rubetta's — improve your Rubies by +1/+1 and cast a Ruby on your left-most and right-most Kobold", () => {
  it('the printed sentence is the owner’s, on the Equipment and on Kaura', () => {
    expect(EQUIPMENT_INDEX['dueling_rubettas']!.text).toBe('Improve your **Rubies** by **+1/+1** and cast a **Ruby** on your left-most and right-most **Kobold**.');
    expect(CARD_INDEX['k3_kaura']!.text).toContain('+1/+1');
    expect(EQUIPMENT_INDEX['dueling_rubettas']!.params).toEqual({ attack: 1, health: 1, rubies: 1 });
    expect(EQUIPMENT_INDEX['dueling_rubettas']!.gildedParams).toEqual({ attack: 2, health: 2, rubies: 2 });
  });

  it('+1/+1 Ruby strength first, then one Ruby at each END Kobold — minted at the new strength', () => {
    let s = run({ hand: [body('ka', 'k3_kaura')], board: [body('l', 'k3_korn'), body('x', 'sandbag'), body('r', 'k_beggy')] });
    s = act(s, { type: 'play', uid: 'ka', toIndex: 1 });
    // Kaura sits between; the Kobold ends are Korn (left-most) and Beggy (right-most).
    s = act(s, { type: 'activateEquipment' });
    expect(s.rubyBonus, 'improved by +1/+1 (was +1/+2)').toEqual({ attack: 1, health: 1 });
    const l = at(s, 'l'); const r = at(s, 'r');
    const rubyL = (l.buffs ?? []).find((b) => b.source === 'Ruby')!;
    const rubyR = (r.buffs ?? []).find((b) => b.source === 'Ruby')!;
    expect([rubyL.attack, rubyL.health], 'a Ruby at the new strength (1/1 + 1/1)').toEqual([2, 2]);
    expect([rubyR.attack, rubyR.health]).toEqual([2, 2]);
    expect((at(s, 'x').buffs ?? []).some((b) => b.source === 'Ruby'), 'the non-Kobold between them gets nothing').toBe(false);
    expect((at(s, 'ka').buffs ?? []).some((b) => b.source === 'Ruby'), 'Kaura is not an end here').toBe(false);
  });
});

// ── 2. Korn — Rally: Cast a permanent Ruby on this ────────────────────────────────────────────────────────
describe('Korn — Rally: Cast a permanent Ruby on this', () => {
  it('the Rally Ruby is PERMANENT: it carries back off the combat as a Ruby perma-buff', () => {
    expect(CARD_INDEX['k3_korn']!.text).toBe('**Rally:** Cast a **permanent Ruby** on this.');
    const r = fight([bm('k3_korn', 'K', 2, 60)], [foe('sandbag', 0, 300)]);
    const perma = permaRubies(r, 'K');
    expect(perma.length, 'a permanent Ruby carry-back recorded').toBeGreaterThan(0);
    expect(perma[0]!.attack, 'one Ruby per attack, real stats').toBeGreaterThan(0);
  });

  it('…and the reducer lands it on the run-board body at settle', () => {
    const r = fight([bm('k3_korn', 'K', 2, 60)], [foe('sandbag', 0, 300)]);
    let s: RunState = { ...createRun(5), phase: 'combat', combatSettled: false, board: [body('K', 'k3_korn')], hand: [], shop: [], lastCombat: r } as unknown as RunState;
    const before = s.board[0]!.attack + s.board[0]!.health;
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'K').attack + at(s, 'K').health).toBeGreaterThan(before);
  });
});

// ── 3. Kobe — Taunt. When this takes damage, play 1 permanent Rubies on this and adjacent Kobolds ─────────
describe('Kobe — Taunt. When this takes damage, play 1 permanent Rubies on this and adjacent Kobolds', () => {
  it('has Taunt and no Start of Combat any more', () => {
    const d = CARD_INDEX['k_kobe']!;
    expect(d.keywords).toContain('T');
    expect(d.effects.map((e) => e.on)).toEqual(['onDamaged']);
    expect(d.text).toBe('**Taunt.** When this takes damage, play a **permanent Ruby** on this and adjacent **Kobolds**.'); // 3 → 1 (owner nerf 2026-09-20)
  });

  it('every landed hit plays 1 Ruby on Kobe and its adjacent Kobold — not the non-Kobold on the other side (3 → 1, owner nerf 2026-09-20)', () => {
    // A 1-Attack foe that swings into the Taunt each turn; Kobe's own retaliation never kills it.
    const r = fight([bm('k3_korn', 'L', 0, 60), bm('k_kobe', 'K', 0, 60), bm('venom', 'V', 0, 60)], [foe('omen', 1, 400)]);
    const kobe = uidOf(r, 'k_kobe');
    const hits = r.events.filter((e) => e.type === 'dmg' && (e as { target: string }).target === kobe).length;
    expect(hits, 'Kobe took hits').toBeGreaterThan(0);
    expect(rubyAttackOn(r, kobe, kobe), '1 Ruby (1 Attack at base strength) on itself per hit').toBe(hits * 1);
    expect(rubyAttackOn(r, uidOf(r, 'k3_korn'), kobe), '1 on the adjacent Kobold per hit').toBe(hits * 1);
    const onVenom = r.events.some((e) => e.type === 'buff' && (e as { target: string }).target === uidOf(r, 'venom') && (e as { source: string }).source === kobe);
    expect(onVenom, 'the adjacent non-Kobold gets none').toBe(false);
  });

  it('the Rubies are PERMANENT — they carry back for Kobe AND its Kobold neighbour', () => {
    const r = fight([bm('k3_korn', 'L', 0, 60), bm('k_kobe', 'K', 0, 60)], [foe('omen', 1, 400)]);
    expect(permaRubies(r, 'K').length, 'Kobe').toBeGreaterThan(0);
    expect(permaRubies(r, 'L').length, 'the neighbour').toBeGreaterThan(0);
  });

  it('a Ward-absorbed hit (0 damage landed) plays nothing', () => {
    const r = fight([bm('k_kobe', 'K', 5, 60, { keywords: ['T', 'DS'] })], [foe('omen', 1, 1)]);
    // Whoever swings first, the single exchange pops the Ward (0 landed) and kills the 1-Health foe: no hit lands.
    expect(r.events.some((e) => e.type === 'shield')).toBe(true);
    expect(r.events.some((e) => e.type === 'buff' && (e as { ruby?: boolean }).ruby)).toBe(false);
  });
});

// ── 4. Boulderdash — Flurry. Rally: Cast 3 permanent Rubies on this ──────────────────────────────────────
describe('Boulderdash — Flurry. Rally: Cast 3 permanent Rubies on this', () => {
  it('swings twice per turn, and each swing Rallies', () => {
    const d = CARD_INDEX['k_boulderdash']!;
    expect(d.keywords).toEqual(['W', 'RL']);
    expect(d.text).toBe('**Flurry.** **Rally:** Cast **3 permanent Rubies** on this.');
    const r = fight([bm('k_boulderdash', 'B', 6, 60)], [foe('sandbag', 0, 300)]);
    const me = uidOf(r, 'k_boulderdash');
    const swings = r.events.filter((e) => e.type === 'attack' && (e as { attacker: string }).attacker === me);
    expect(swings.some((e) => (e as { swing: number }).swing === 1), 'a second swing (Flurry)').toBe(true);
    expect(rubyAttackOn(r, me, me), '3 Rubies per swing').toBe(swings.length * 3);
    expect(permaRubies(r, 'B').length, 'permanent').toBeGreaterThan(0);
  });
});

// ── 5. Livewire — Whenever you cast a Shop spell, cast a Ruby on this and 2 other random Kobolds ─────────
describe('Livewire — Whenever you cast a Shop spell, cast a Ruby on this and 2 other random Kobolds', () => {
  const spell = (uid: string, cardId: string) => ({ uid, cardId, attack: 0, health: 0, keywords: [] as never[], golden: false }) as unknown as BoardCard;

  it('a Shop spell → one Ruby on Livewire and one on each of 2 random OTHER Kobolds; non-Kobolds never', () => {
    expect(CARD_INDEX['k3_runespark']!.text).toBe('Whenever you cast a **Shop spell**, cast a **Ruby** on this and 2 other random **Kobolds**.');
    let s = run({ hand: [spell('sp', 'veinstorm')], board: [body('a', 'k3_korn'), body('b', 'k_beggy'), body('lw', 'k3_runespark'), body('c', 'k_kobe'), body('v', 'venom')] });
    s = act(s, { type: 'play', uid: 'sp' });
    expect(s.hand.some((c) => c.uid === 'sp'), 'the spell was cast').toBe(false);
    expect(rubiesOn(at(s, 'lw')), 'one on itself').toBe(1);
    const others = ['a', 'b', 'c'].map((u) => rubiesOn(at(s, u)));
    expect(others.reduce((n, x) => n + x, 0), 'two Rubies spread over the OTHER Kobolds').toBe(2);
    expect(Math.max(...others), 'distinct picks — never two on one').toBe(1);
    expect(rubiesOn(at(s, 'v')), 'not a Kobold').toBe(0);
  });

  it('is RANDOM, not adjacent: across seeds the picks vary and the far Kobold is reachable', () => {
    const hit = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      let s = run({ hand: [spell('sp', 'veinstorm')], board: [body('lw', 'k3_runespark'), body('a', 'k3_korn'), body('b', 'k_beggy'), body('c', 'k_kobe')], rngCursor: seed * 7919 });
      s = act(s, { type: 'play', uid: 'sp' });
      for (const u of ['a', 'b', 'c']) if (rubiesOn(at(s, u)) > 0) hit.add(u);
    }
    expect(hit.has('c'), 'the Kobold two slots away — unreachable under the old adjacency rule — gets picked').toBe(true);
    expect(hit.size).toBe(3);
  });

  it('fewer than 2 other Kobolds → each of them gets one; alone → only itself', () => {
    let s = run({ hand: [spell('sp', 'veinstorm')], board: [body('lw', 'k3_runespark'), body('a', 'k3_korn')] });
    s = act(s, { type: 'play', uid: 'sp' });
    expect([rubiesOn(at(s, 'lw')), rubiesOn(at(s, 'a'))]).toEqual([1, 1]);
    let t = run({ hand: [spell('sp', 'veinstorm')], board: [body('lw', 'k3_runespark')] });
    t = act(t, { type: 'play', uid: 'sp' });
    expect(rubiesOn(at(t, 'lw'))).toBe(1);
  });

  it('a Ruby is not a Shop spell — playing a Ruby on a neighbour never re-triggers it', () => {
    let s = run({ hand: [{ ...body('rb', 'ruby'), attack: 1, health: 1 }], board: [body('lw', 'k3_runespark'), body('a', 'k3_korn')] });
    s = act(s, { type: 'play', uid: 'rb', targetUid: 'a' });
    expect(rubiesOn(at(s, 'lw')), 'no Ruby on Livewire from a Ruby cast').toBe(0);
  });
});

// ── 6. Paragon ────────────────────────────────────────────────────────────────────────────────────────────
describe('Paragon — Whenever you trigger a Rally, give a minion of every type +5/+5 permanently', () => {
  it('prints +5/+5 and the factory pays +5/+5', () => {
    expect(CARD_INDEX['n2_paragon']!.text).toBe('Whenever you trigger a **Rally**, give a minion of **every type** **+5/+5** permanently.');
    expect(CARD_INDEX['n2_paragon']!.effects[0]!.params).toEqual({ attack: 5, health: 5 });
  });
});

// ── 7. Deathsayer — Rally: Trigger your left-most Echo and Shout ─────────────────────────────────────────
describe('Deathsayer — Rally: Trigger your left-most Echo and Shout', () => {
  it('one Rally fires the left-most Echo (a Footman summons) AND the left-most Shout (Orin gains Ward), both bodies alive', () => {
    expect(CARD_INDEX['deathsayer']!.text).toBe('**Rally:** Trigger your left-most **Echo** and **Shout**.');
    const r = fight([bm('deathsayer', 'D', 3, 60), bm('dw_orin', 'O', 2, 60), bm('deathlesshand', 'F', 1, 60)], [foe('sandbag', 0, 300)]);
    const firstSwing = r.events.findIndex((e) => e.type === 'attack');
    const ds = uidOf(r, 'deathsayer');
    // The Echo: a Footman summoned off Footman Captain, sourced on the Captain, before the hit lands.
    const summon = r.events.findIndex((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'footman');
    expect(summon, 'the left-most Echo fired').toBeGreaterThan(firstSwing);
    // The Shout: a counted `shout` event from Deathsayer at Orin, and Orin gains Ward.
    const shout = r.events.find((e) => e.type === 'shout' && (e as { source: string }).source === ds);
    expect(shout, 'the left-most Shout re-fired').toBeTruthy();
    expect((shout as { target: string }).target).toBe(uidOf(r, 'dw_orin'));
    expect(r.events.some((e) => (e.type === 'shieldUp' || (e.type === 'keyword' && (e as { keyword: string }).keyword === 'DS')) && (e as { target: string }).target === uidOf(r, 'dw_orin')), 'Orin gained Ward from it').toBe(true);
    const firstDmg = r.events.findIndex((e) => e.type === 'dmg');
    expect(summon, 'both resolve BEFORE the hit lands').toBeLessThan(firstDmg);
  });

  it('with no Shout on the board only the Echo fires; with no Echo only the Shout — never an error', () => {
    const a = fight([bm('deathsayer', 'D', 3, 60), bm('deathlesshand', 'F', 1, 60)], [foe('sandbag', 0, 300)]);
    expect(a.events.some((e) => e.type === 'shout')).toBe(false);
    expect(a.events.some((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'footman')).toBe(true);
    const b = fight([bm('deathsayer', 'D', 3, 60), bm('dw_orin', 'O', 2, 60)], [foe('sandbag', 0, 300)]);
    expect(b.events.some((e) => e.type === 'shout')).toBe(true);
    expect(b.events.some((e) => e.type === 'rally')).toBe(false);
  });

  it('gilded: the Shout re-fires twice per Rally', () => {
    const r = fight([bm('deathsayer', 'D', 6, 60, { golden: true }), bm('dw_orin', 'O', 2, 60)], [foe('sandbag', 0, 1)]);
    // One swing kills the 1-Health bag: exactly one Rally → two Shout re-fires.
    expect(r.events.filter((e) => e.type === 'shout').length).toBe(2);
  });
});

// ── 8. Neptus — Rally: get a copy of the first Shop spell you cast this turn ─────────────────────────────
describe('Neptus — Rally: get a copy of the first Shop spell you cast this turn (every attack)', () => {
  const toHand = (events: readonly CombatEvent[]) => events.filter((e) => e.type === 'toHand').map((e) => (e as { cardId: string }).cardId);
  it('pays on EVERY attack — the once-per-combat latch is gone from the sentence and the engine', () => {
    expect(CARD_INDEX['ce3_conductor']!.text).toBe('**Rally:** get a copy of the first **Shop spell** you cast this turn.');
    const r = fight([bm('ce3_conductor', 'C', 4, 90)], [foe('sandbag', 0, 300)], { firstSpellThisTurnId: 'starcrash' });
    const attacks = r.events.filter((e) => e.type === 'attack' && (e as { attacker: string }).attacker === uidOf(r, 'ce3_conductor')).length;
    expect(attacks).toBeGreaterThan(1);
    expect(toHand(r.events), 'one Star Crash per attack').toEqual(Array(attacks).fill('starcrash'));
  });
  it('nothing cast this turn → nothing to copy; gilded → two copies per attack', () => {
    expect(toHand(fight([bm('ce3_conductor', 'C', 4, 90)], [foe('sandbag', 0, 300)]).events)).toEqual([]);
    const g = fight([bm('ce3_conductor', 'C', 8, 90, { golden: true })], [foe('sandbag', 0, 1)], { firstSpellThisTurnId: 'starcrash' });
    expect(toHand(g.events)).toEqual(['starcrash', 'starcrash']);
  });
});

// ── 9. Arena Heckler 6/5 — Start of Combat: Give the minion opposite this Taunt and attack it immediately ──
describe('Arena Heckler — Start of Combat: Give the minion opposite this Taunt and attack it immediately', () => {
  it('is a 6/5 that Taunts the OPPOSITE enemy and strikes it before the rotation starts', () => {
    const d = CARD_INDEX['arenaheckler']!;
    expect([d.attack, d.health]).toEqual([6, 5]);
    expect(d.text).toBe('**Start of Combat:** Give the minion **opposite** this **Taunt** and attack it immediately.');
    // Heckler in slot 1 → the enemy's slot 1 (E1) is opposite.
    const r = fight([bm('sandbag', 'A', 0, 100), bm('arenaheckler', 'H', 6, 5)], [foe('omen', 1, 100), foe('omen', 1, 100), foe('omen', 1, 100)]);
    const h = uidOf(r, 'arenaheckler');
    const e1 = r.initial.enemy[1]!.uid;
    const taunt = r.events.findIndex((e) => e.type === 'keyword' && (e as { target: string; keyword: string }).target === e1 && (e as { keyword: string }).keyword === 'T');
    expect(taunt, 'the opposite enemy gained Taunt').toBeGreaterThanOrEqual(0);
    const first = r.events.findIndex((e) => e.type === 'attack');
    const strike = r.events[first] as { attacker: string; defender: string };
    expect(strike.attacker, 'the FIRST attack of the fight is the Heckler’s').toBe(h);
    expect(strike.defender, '…at the very body it Taunted').toBe(e1);
    expect(first, 'right after the Taunt grant').toBeGreaterThan(taunt);
    expect(r.events.some((e) => e.type === 'dmg' && (e as { target: string; amount: number }).target === e1 && (e as { amount: number }).amount === 6), 'a real 6-damage hit').toBe(true);
  });

  it('gilded: the neighbour is Taunted too, and the strike still goes at the opposite one', () => {
    const r = fight([bm('arenaheckler', 'H', 12, 10, { golden: true })], [foe('omen', 1, 100), foe('omen', 1, 100)]);
    const e0 = r.initial.enemy[0]!.uid; const e1 = r.initial.enemy[1]!.uid;
    const taunted = r.events.filter((e) => e.type === 'keyword' && (e as { keyword: string }).keyword === 'T').map((e) => (e as { target: string }).target);
    expect(taunted.sort()).toEqual([e0, e1].sort());
    const strike = r.events.find((e) => e.type === 'attack') as { defender: string };
    expect(strike.defender).toBe(e0);
  });

  it('it still takes its ordinary turn afterwards — the immediate strike is a bonus, not a replacement', () => {
    const r = fight([bm('arenaheckler', 'H', 6, 50)], [foe('sandbag', 0, 300)]);
    const h = uidOf(r, 'arenaheckler');
    expect(r.events.filter((e) => e.type === 'attack' && (e as { attacker: string }).attacker === h).length).toBeGreaterThan(1);
  });

  it('the shop never sees it (no enemies to Taunt or strike) — an End-of-Turn replay is inert', () => {
    const s = run({ board: [body('h', 'arenaheckler'), body('x', 'sandbag')], questFlags: { runeCombatProwess: true } as never });
    const before = JSON.stringify([at(s, 'h'), at(s, 'x')]);
    applyEndOfTurn(s);
    expect(JSON.stringify([at(s, 'h'), at(s, 'x')])).toBe(before);
  });
});

// ── 10. Spear Warden 4/2 — Has +4/+2 for every Spear Warden that died this game ──────────────────────────
describe('Spear Warden — Has +4/+2 for every Spear Warden that died this game', () => {
  it('is a 4/2 with the owner’s sentence and no Echo (a death count, never a Deathrattle)', () => {
    const d = CARD_INDEX['knit']!;
    expect([d.attack, d.health]).toEqual([4, 2]);
    expect(d.text).toBe('Has **+4/+2** for every **Spear Warden** that died this game.');
    expect(d.effects.some((e) => e.on === 'onDeath'), 'not an Echo').toBe(false);
  });

  const settle = (r: ReturnType<typeof simulate>, board: BoardCard[], hand: BoardCard[] = []): RunState =>
    reduce({ ...createRun(5), phase: 'combat', combatSettled: false, board, hand, shop: [], lastCombat: r } as unknown as RunState, { type: 'resolveCombat' });

  it('ONE death in combat → +4/+2 on every Spear Warden you own next shop (board, hand, and a fresh copy)', () => {
    const r = fight([bm('knit', 'w1', 4, 2), bm('knit', 'w2', 4, 60)], [foe('omen', 5, 4)]);
    expect(r.playerCardBuffs).toEqual([{ cardId: 'knit', attack: 4, health: 2 }]);
    const s = settle(r, [body('w2', 'knit')], [body('h', 'knit')]);
    expect(s.cardBuffs.knit).toEqual({ attack: 4, health: 2 });
    expect([at(s, 'w2').attack, at(s, 'w2').health], 'the survivor on the board').toEqual([8, 4]);
    const h = s.hand.find((c) => c.uid === 'h')!;
    expect([h.attack, h.health], 'the copy in hand').toEqual([8, 4]);
  });

  it('TWO deaths → +8/+4; a COPY that dies counts (each copy is a Spear Warden)', () => {
    const r = fight([bm('knit', 'w1', 4, 2), bm('knit', 'w2', 4, 2), bm('sandbag', 's', 0, 200)], [foe('omen', 5, 40)]);
    expect(r.playerCardBuffs).toEqual([{ cardId: 'knit', attack: 8, health: 4 }]);
    const s = settle(r, [body('s', 'sandbag')], [body('h', 'knit')]);
    expect([s.hand[0]!.attack, s.hand[0]!.health]).toEqual([12, 6]);
  });

  it('the count is CUMULATIVE across combats: a second fight’s death stacks onto the first’s', () => {
    const r1 = fight([bm('knit', 'w1', 4, 2), bm('sandbag', 's', 0, 200)], [foe('omen', 5, 40)]);
    let s = settle(r1, [body('s', 'sandbag')], [body('h', 'knit')]);
    expect(s.cardBuffs.knit).toEqual({ attack: 4, health: 2 });
    const r2 = fight([bm('knit', 'w3', 8, 4, { buffs: [{ source: 'Spear Warden', attack: 4, health: 2, count: 1 }] }), bm('sandbag', 's', 0, 200)], [foe('omen', 9, 40)]);
    s = reduce({ ...s, phase: 'combat', combatSettled: false, lastCombat: r2 } as unknown as RunState, { type: 'resolveCombat' });
    expect(s.cardBuffs.knit).toEqual({ attack: 8, health: 4 });
    expect([s.hand[0]!.attack, s.hand[0]!.health], 'the hand copy wears both deaths').toEqual([12, 6]);
  });

  it('a Deathsayer / Echohorn proc is NOT a death — nothing accrues', () => {
    // A 0-Attack foe that never grows (`omen` has no on-damaged reaction), so the Warden cannot die.
    const r = fight([bm('deathsayer', 'D', 3, 60), bm('knit', 'w', 4, 60)], [foe('omen', 0, 30)]);
    expect(r.events.some((e) => e.type === 'death' && (e as { side: string }).side === 'player'), 'fixture: no player death').toBe(false);
    expect(r.playerCardBuffs).toBeUndefined();
  });

  it('a gilded Warden dying is ONE death (+4/+2, not doubled); an ENEMY Warden’s death pays you nothing', () => {
    const g = fight([bm('knit', 'w', 8, 4, { golden: true })], [foe('omen', 9, 40)]);
    expect(g.playerCardBuffs).toEqual([{ cardId: 'knit', attack: 4, health: 2 }]);
    const e = fight([bm('sandbag', 's', 5, 100)], [foe('knit', 4, 2)]);
    expect(e.playerCardBuffs).toBeUndefined();
  });

  it('the living copies feel it DURING the fight, and a Rune-of-the-Warden token dying counts too', () => {
    const r = fight([bm('knit', 'w1', 4, 2), bm('knit', 'w2', 4, 60)], [foe('omen', 5, 4)]);
    const w2 = r.initial.player[1]!.uid;
    expect(r.events.some((e) => e.type === 'buff' && (e as { target: string; attack: number; health: number }).target === w2
      && (e as { attack: number }).attack === 4 && (e as { health: number }).health === 2), 'the survivor grew mid-fight').toBe(true);
    const t = fight([bm('sandbag', 's', 0, 200)], [foe('omen', 5, 40)], { questMods: { runeWarden: true } });
    expect(r.events.some((e) => e.type === 'summon'), 'fixture: nothing summoned on the base fight').toBe(false);
    expect(t.events.some((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'knit'), 'the rune summoned a Warden').toBe(true);
    expect(t.playerCardBuffs, 'the token died → it counts').toEqual([{ cardId: 'knit', attack: 4, health: 2 }]);
  });

  it('a SHOP destroy is a death too (Cage Breaker / Deathfibrillator)', () => {
    let s = run({ hand: [body('cb', 'u3_cagebreaker')], board: [body('w', 'knit'), body('w2', 'knit')] });
    s = act(s, { type: 'play', uid: 'cb', toIndex: 0 });
    s = act(s, { type: 'battlecryTarget', targetUid: 'w' });
    s = act(s, { type: 'discover', index: 0 }); // the Discover resolves first, then the death settles
    s = act(s, { type: 'resolveShopDeath' });
    expect(s.cardBuffs.knit).toEqual({ attack: 4, health: 2 });
    expect([at(s, 'w2').attack, at(s, 'w2').health], 'the other copy grew at once').toEqual([8, 4]);
  });

  it('prints the CURRENT total in place (the helper the shared shop/combat chain calls — see instView.test.ts)', () => {
    expect(cardTypeTallyText('knit', undefined), 'no deaths yet — the printed sentence stands').toBeNull();
    const two = cardTypeTallyText('knit', { attack: 8, health: 4 })!;
    expect(two).toContain('Has **{{+8/+4}}**');
    expect(two).toContain('{{2}} so far');
  });
});

// ── 11. Cage Breaker / EMS — never themselves ─────────────────────────────────────────────────────────────
describe('Cage Breaker and EMS never target themselves (owner 2026-09-18)', () => {
  it('Cage Breaker: a self-aim is refused; alone on the board it plays as a plain body with no aim step', () => {
    let s = run({ hand: [body('cb', 'u3_cagebreaker')], board: [body('w', 'knit')] });
    s = act(s, { type: 'play', uid: 'cb', toIndex: 0 });
    expect(s.pendingTarget?.uid).toBe('cb');
    const refused = act(s, { type: 'battlecryTarget', targetUid: 'cb' });
    expect(refused, 'refused outright').toBe(s);
    let alone = run({ hand: [body('cb', 'u3_cagebreaker')], board: [] });
    alone = act(alone, { type: 'play', uid: 'cb', toIndex: 0 });
    expect(alone.pendingTarget, 'nothing legal to aim at → no prompt').toBeUndefined();
    expect(alone.board.some((c) => c.uid === 'cb'), 'it still landed').toBe(true);
  });

  it('EMS: the Deathfibrillator cannot be aimed at EMS itself', () => {
    let s = run({ hand: [body('ems', 'u3_ems')], board: [body('w', 'knit')] });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    const before = s;
    const self = act(s, { type: 'activateEquipment', targetUid: 'ems' });
    expect(self, 'refused: no Gold, no charge, no death').toBe(before);
    const ok = act(s, { type: 'activateEquipment', targetUid: 'w' });
    expect(ok.pendingDeath?.uid, 'another Undead is a fine target').toBe('w');
  });
});
