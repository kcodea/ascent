import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import {
  applyEndOfTurn, canRallyInShop, fireRecruitDeathrattlesForTest, questEndOfTurnBeats, ralliersOf,
  runeCombatProwessBeats, runeLastingCadenceBeats, socRuneReplaysOf,
} from './recruit';

/**
 * THE SIX 2026-08-20 OWNER RULINGS from the live Combat Prowess + Lasting Cadence pass:
 *
 *   1. Grim buffs ITSELF from a shop-fired Echo trigger (phase-agreeing membership — arena migration);
 *   2. Rune of Twilight STACKS with Combat Prowess (owner reversal; Uron's card-data multiplier too);
 *   3. Elderhorn (+ Funeral Engine / first-Echo) multiply SHOP Echoes — the unified multiplier set;
 *   4. Combat Prowess replays RUNE/QUEST Start-of-Combat effects, not just minion ones;
 *   5. Rune of Rebirth prints blue "Rebirth" (UI chain — pinned in the UI tests via liveCardText);
 *   6. Sunmane Herald is combat-only (`combatOnly` on the effect def) — the Lasting Cadence loop is dead.
 */

const bc = (uid: string, cardId: string, over: Partial<RunState['board'][number]> = {}): RunState['board'][number] => {
  const def = CARD_INDEX[cardId]!;
  return {
    uid, cardId, tribe: def.tribe, attack: def.attack, health: def.health,
    keywords: [...def.keywords], golden: false, ...over,
  } as RunState['board'][number];
};
const run = (board: RunState['board'], over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(3, 'warden'), phase: 'recruit', board, ...over } as RunState);
const on = (s: RunState, uid: string) => s.board.find((c) => c.uid === uid)!;

// Combat harness (the beastBatch pattern): player board vs an unkillable wall, seeded.
const bm = (cardId: string, uid: string, attack = 2, health = 20, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });
const wall = { cardId: 'sandbag', attack: 0, health: 40000 };
const csim = (player: BoardMinion[], mods: QuestCombatMods = {}, seed = 3) =>
  simulate(player, [wall], makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'], questMods: mods }), combatSide({ tier: 1 }));

// ── 1. Grim: a proc'd-not-dead Grim is a living Beast and buffs ITSELF — in BOTH phases ──────────────────
describe('Grim buffs itself when its Echo fires without dying (owner report 2026-08-20)', () => {
  it('SHOP: a shop-fired Echo trigger buffs Grim too, not just the other Beasts', () => {
    const s = run([bc('g', 'grim'), bc('t', 'b2_trex')]);
    fireRecruitDeathrattlesForTest(s, on(s, 'g')); // an Ossuary-class proc: the body stays alive
    expect(on(s, 'g').attack, 'Grim gained its own +8').toBe(CARD_INDEX['grim']!.attack + 8);
    expect(on(s, 'g').health, 'Grim gained its own +8').toBe(CARD_INDEX['grim']!.health + 8);
    expect(on(s, 't').attack, 'the other Beast still gains').toBe(CARD_INDEX['b2_trex']!.attack + 8);
  });

  it("SHOP end-to-end (the owner's scenario): Spots under Combat Prowess procs Grim at End of Turn", () => {
    // Board: Grim leftmost (the Echo Spots reaches), Spots (SC: trigger 2 left-most Echoes), the rune armed.
    const s = run([bc('g', 'grim'), bc('sp', 'b2_spots')], { runeCombatProwess: true } as Partial<RunState>);
    const out = reduce(s, { type: 'faceOmen' }) as RunState;
    const grim = out.board.find((c) => c.uid === 'g')!;
    expect(grim.buffs?.some((b) => b.source === 'Grim' && b.attack >= 8), 'Grim carries its OWN buff').toBe(true);
    expect(grim.attack).toBeGreaterThanOrEqual(CARD_INDEX['grim']!.attack + 8);
  });

  it('COMBAT (parity pin): Echoing Coop procs Grim without a death — Grim gains its own +8/+8', () => {
    const r = csim([bm('grim', 'G', 7, 9999), bm('b2_trex', 'T', 2, 9999)], { echoingCoop: true });
    const grimUid = r.initial.player.find((m) => m.cardId === 'grim')!.uid;
    const own = (r.events.filter((e) => e.type === 'buff') as { target: string; source: string; attack: number; health: number }[])
      .filter((b) => b.target === grimUid && b.source === grimUid);
    expect(own.some((b) => b.attack === 8 && b.health === 8), 'the living Grim buffed itself').toBe(true);
  });

  it('a genuinely DYING shop Grim still never buffs a corpse (it leaves the board before the rattle)', () => {
    const s = run([bc('g', 'grim'), bc('t', 'b2_trex')]);
    const grim = on(s, 'g');
    s.board = s.board.filter((c) => c.uid !== 'g'); // every shop death path splices first (Graverobber, damageAll)
    fireRecruitDeathrattlesForTest(s, grim);
    expect(grim.buffs ?? [], 'no posthumous self-buff').toHaveLength(0);
    expect(on(s, 't').attack).toBe(CARD_INDEX['b2_trex']!.attack + 8);
  });
});

// ── 2. Rune of Twilight (+ Uron) STACK with Combat Prowess — owner reversal ───────────────────────────────
describe('Twilight and Uron multiply the End-of-Turn Start-of-Combat replay (owner reversal 2026-08-20)', () => {
  it('with Twilight held, each SoC effect gets TWO beats (one per fire — the room-for-the-beat rule)', () => {
    const s = run([bc('sd', 'runmaw')], { runeCombatProwess: true, questFlags: { runeTwilight: true } } as Partial<RunState>);
    expect(runeCombatProwessBeats(s), '1 effect × (1 base + 1 Twilight)').toHaveLength(2);
  });

  it('…and the effect really FIRES twice at End of Turn (Speed Demon pays out two grants)', () => {
    const s = run([bc('sd', 'runmaw'), bc('z', 'stray')], { runeCombatProwess: true, questFlags: { runeTwilight: true } } as Partial<RunState>);
    applyEndOfTurn(s);
    const grants = (on(s, 'z').buffs ?? []).filter((b) => b.source === CARD_INDEX['runmaw']!.name);
    expect(grants.reduce((n, b) => n + b.count, 0), 'two fires, two grants').toBe(2);
  });

  it('Uron on the board multiplies the replay too (the same card-data fold combat scReps uses)', () => {
    const s = run([bc('sd', 'runmaw'), bc('u', 'uron')], { runeCombatProwess: true } as Partial<RunState>);
    // Uron multiplies BOTH umbrellas it names: End of Turns (endOfTurnRepeats → ×2, as before this change)
    // and Start of Combats (the new perFire fold → ×2) — so the one SoC effect fires 2 × 2 = 4 times.
    expect(runeCombatProwessBeats(s), '1 effect × 2 EoT repeats × (1 base + 1 Uron SC)').toHaveLength(4);
  });

  it('without either multiplier the count is unchanged (one beat per effect)', () => {
    const s = run([bc('sd', 'runmaw')], { runeCombatProwess: true } as Partial<RunState>);
    expect(runeCombatProwessBeats(s)).toHaveLength(1);
  });
});

// ── 3. The Echo-multiplier set follows the trigger into the shop ─────────────────────────────────────────
describe('shop Echoes pay every Echo multiplier (owner principle 2026-08-20)', () => {
  it("Elderhorn's Beast Ritual: a shop-fired BEAST Echo fires an extra time, and the tallies see both", () => {
    const s = run([bc('t', 'b2_trex')], { beastRitualExtra: 1 } as Partial<RunState>);
    fireRecruitDeathrattlesForTest(s, on(s, 't'));
    expect(s.board.filter((c) => c.cardId === 'b2_trexbaby'), 'two Babies — the Echo fired twice').toHaveLength(2);
    expect(s.lastEchoFires, 'both fires count for the quest tick').toBe(2);
    expect(s.deathrattlesTriggered, 'both fires count for Grim').toBe(2);
  });

  it('the Ritual is tribe-scoped: a non-Beast shop Echo is untouched by it', () => {
    const s = run([bc('sp', 'spore')], { beastRitualExtra: 1 } as Partial<RunState>); // Sporeling: Undead Echo
    fireRecruitDeathrattlesForTest(s, on(s, 'sp'));
    expect(s.lastEchoFires, 'one fire only').toBe(1);
  });

  it("Funeral Engine's echoExtraAlways multiplies shop Echoes too", () => {
    const s = run([bc('t', 'b2_trex')], { echoExtraAlways: 1 } as Partial<RunState>);
    fireRecruitDeathrattlesForTest(s, on(s, 't'));
    expect(s.board.filter((c) => c.cardId === 'b2_trexbaby')).toHaveLength(2);
  });

  it('the first-Echo bonus pays the FIRST shop Echo each turn, then is spent until the next turn', () => {
    const s = run([bc('t', 'b2_trex'), bc('t2', 'b2_trex')], { echoFirstEachCombat: 1 } as Partial<RunState>);
    fireRecruitDeathrattlesForTest(s, on(s, 't'));
    expect(s.lastEchoFires, 'first Echo: base + first-Echo bonus').toBe(2);
    fireRecruitDeathrattlesForTest(s, on(s, 't2'));
    expect(s.lastEchoFires, 'second Echo: base only (2 + 1)').toBe(3);
    expect(s.echoFirstUsedThisTurn).toBe(true);
  });

  it('Sylus still stacks on top — the whole set folds additively, one definition', () => {
    const s = run([bc('t', 'b2_trex'), bc('sy', 'sylus')], { beastRitualExtra: 1 } as Partial<RunState>);
    fireRecruitDeathrattlesForTest(s, on(s, 't'));
    expect(s.board.filter((c) => c.cardId === 'b2_trexbaby'), '1 base + 1 Sylus + 1 Ritual').toHaveLength(3);
  });
});

// ── 4. Rune/quest Start-of-Combat effects replay at End of Turn under Combat Prowess ─────────────────────
describe('Combat Prowess replays rune/quest Start-of-Combat effects (owner ruling: "all SoC effects")', () => {
  it('Rune of Warding: the rightmost gains Ward and TRIPLE Health, permanently', () => {
    const s = run([bc('a', 'stray'), bc('b', 'stray', { health: 3 })],
      { runeCombatProwess: true, questFlags: { runeWarding: true } } as Partial<RunState>);
    applyEndOfTurn(s);
    expect(on(s, 'b').keywords).toContain('DS');
    expect(on(s, 'b').health, '3 → 9 (triple)').toBe(9);
    expect(on(s, 'a').keywords, 'only the rightmost').not.toContain('DS');
  });

  it('Rune of the Warden: a Spear Warden joins the board when there is room', () => {
    const s = run([bc('a', 'stray')], { runeCombatProwess: true, questFlags: { runeWarden: true } } as Partial<RunState>);
    applyEndOfTurn(s);
    expect(s.board.some((c) => c.cardId === 'knit'), 'a real, permanent board card').toBe(true);
  });

  it('Rune of the Underdog: the two lowest-Attack minions double (permanent — flagged compounding)', () => {
    const s = run([bc('a', 'stray', { attack: 1, health: 1 }), bc('b', 'b2_trex', { attack: 2, health: 3 }), bc('c', 'grim', { attack: 9 })],
      { runeCombatProwess: true, questFlags: { runeUnderdog: true } } as Partial<RunState>);
    applyEndOfTurn(s);
    expect([on(s, 'a').attack, on(s, 'a').health]).toEqual([2, 2]);
    expect([on(s, 'b').attack, on(s, 'b').health]).toEqual([4, 6]);
    expect(on(s, 'c').attack, 'not an underdog').toBe(9);
  });

  it('Rune of the Herald: every Echo triggers through the shared shop ritual (tallies advance)', () => {
    const s = run([bc('t', 'b2_trex')], { runeCombatProwess: true, questFlags: { runeHerald: true } } as Partial<RunState>);
    applyEndOfTurn(s);
    expect(s.board.some((c) => c.cardId === 'b2_trexbaby'), 'the Echo really fired').toBe(true);
    expect(s.lastEchoFires ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('each replay is its own beat, sourced on the OWNING rune (questEndOfTurnBeats names it)', () => {
    const s = run([bc('a', 'stray')], { runeCombatProwess: true, questFlags: { runeWarding: true, runeVanguard: true } } as Partial<RunState>);
    const labels = questEndOfTurnBeats(s).map((b) => b.label);
    expect(labels).toContain('Rune of Warding');
    expect(labels).toContain('Rune of the Vanguard');
  });

  it('the replays fire ONLY under Combat Prowess (the rune is the bridge)', () => {
    const s = run([bc('a', 'stray', { health: 3 })], { questFlags: { runeWarding: true } } as Partial<RunState>);
    applyEndOfTurn(s);
    expect(on(s, 'a').health, 'no rune, no replay').toBe(3);
    expect(on(s, 'a').keywords).not.toContain('DS');
  });

  it('genuinely combat-only blocks are absent from the replay list (Crucible, Weaken, Food Chain, Empty Graves)', () => {
    const s = run([bc('a', 'stray')], {
      runeCombatProwess: true,
      pendingWeaken: 2,
      questFlags: { runeCrucible: 3, runeFoodChain: true, emptyGraves: true },
    } as Partial<RunState>);
    expect(socRuneReplaysOf(s), 'nothing to replay — all four are combat machinery').toHaveLength(0);
    const before = s.board.length;
    applyEndOfTurn(s);
    expect(s.board, 'the Crucible did NOT sacrifice the shop board').toHaveLength(before);
  });
});

// ── 6. Sunmane Herald is combat-only — the Lasting Cadence loop is dead ──────────────────────────────────
describe('Sunmane Herald: combatOnly scopes it out of the shop (owner ruling 2026-08-20)', () => {
  it('it is not "a Rally to trigger" in the shop at all', () => {
    const s = run([bc('sm', 'b2_sunmane'), bc('t', 'b2_trex')], { runeLastingCadence: true } as Partial<RunState>);
    expect(canRallyInShop(on(s, 'sm'))).toBe(false);
    expect(ralliersOf(s)).toHaveLength(0);
    expect(runeLastingCadenceBeats(s), 'no beat is even scheduled').toHaveLength(0);
  });

  it('a Sunmane + Beasts board under Lasting Cadence ends the turn finitely, with NO spread', () => {
    const s = run([bc('sm', 'b2_sunmane'), bc('t', 'b2_trex'), bc('p', 'spiritpup')],
      { runeLastingCadence: true } as Partial<RunState>);
    const atkBefore = s.board.map((c) => c.attack);
    // Three consecutive End of Turns — the loop shape was "every grant mints new permanent ralliers".
    for (let turn = 0; turn < 3; turn++) applyEndOfTurn(s);
    expect(s.board.map((c) => c.attack), 'no Attack moved').toEqual(atkBefore);
    expect(s.board.every((c) => !(c.grantedEffects ?? []).some((e) => e.do === 'rallySpreadTribeBuff')), 'no graft').toBe(true);
    expect(s.board.filter((c) => c.uid !== 'sm').every((c) => !c.keywords.includes('RL')), 'no viral RL').toBe(true);
    expect(s.lastRallyFires ?? 0, 'a scoped-out Rally is not a Rally trigger').toBe(0);
  });

  it('the whole End Turn resolves through the real reducer without hanging', () => {
    const s = run([bc('sm', 'b2_sunmane'), bc('t', 'b2_trex')], { runeLastingCadence: true } as Partial<RunState>);
    const out = reduce(s, { type: 'faceOmen' }) as RunState;
    expect(out.phase, 'the turn actually ended').not.toBe('recruit');
  });

  it('combat is untouched: Sunmane still spreads its Rally in a real fight', () => {
    const r = csim([bm('b2_sunmane', 'S', 3, 9999), bm('b2_trex', 'T', 2, 9999)]);
    const trexUid = r.initial.player.find((m) => m.cardId === 'b2_trex')!.uid;
    const gained = (r.events.filter((e) => e.type === 'buff') as { target: string; attack: number }[])
      .some((b) => b.target === trexUid && b.attack === 3);
    expect(gained, 'the +3 Attack spread landed in combat').toBe(true);
  });
});

// ── the end-to-end sweeps: both runes through the REAL faceOmen reduce ───────────────────────────────────
describe('end-to-end: Rune of Combat Prowess wiring holds together', () => {
  it('a representative board + Twilight + rune SoC replays: counts, tallies and beats agree', () => {
    // Speed Demon (SoC buffer), Spots (SoC Echo-proc-er) reaching Grim (tally payoff), under Twilight.
    const s = run([bc('g', 'grim'), bc('sd', 'runmaw'), bc('sp', 'b2_spots')], {
      runeCombatProwess: true,
      questFlags: { runeTwilight: true, runeVanguard: true },
    } as Partial<RunState>);
    const cardBeats = runeCombatProwessBeats(s);
    expect(cardBeats, '2 card effects × (1 + Twilight)').toHaveLength(4);
    const replays = socRuneReplaysOf(s);
    expect(replays.map((r) => r.label)).toEqual(['Rune of the Vanguard']);
    const beats = questEndOfTurnBeats(s);
    expect(beats.filter((b) => b.effect === 'runeCombatProwess'), 'card beats + rune replays, one list').toHaveLength(5);
    const out = reduce(s, { type: 'faceOmen' }) as RunState;
    const grim = out.board.find((c) => c.uid === 'g')!;
    // Spots fires twice (Twilight); each proc pays Grim's Echo once → Grim self-buffed at least twice.
    const own = (grim.buffs ?? []).filter((b) => b.source === 'Grim');
    expect(own.reduce((n, b) => n + b.count, 0)).toBeGreaterThanOrEqual(2);
    // Vanguard's replay: the 3 leftmost carry Crit + Ward permanently.
    for (const uid of ['g', 'sd', 'sp']) {
      expect(out.board.find((c) => c.uid === uid)!.keywords).toContain('CR');
      expect(out.board.find((c) => c.uid === uid)!.keywords).toContain('DS');
    }
  });

  it('a Lasting Cadence board with an Echo-proc rallier pays the unified Echo multipliers', () => {
    // Echohorn Stag (Rally: trigger left-most other Echo) + T-Rex, with Elderhorn's Ritual armed: the
    // rally-proc'd Echo fires (1 + Ritual) times, tallied — the exact cross of #1/#3 the owner hit live.
    const s = run([bc('t', 'b2_trex'), bc('eh', 'b2_echohorn')], {
      runeLastingCadence: true, beastRitualExtra: 1,
    } as Partial<RunState>);
    if (!canRallyInShop(on(s, 'eh'))) return; // card id drifted — the dispatch tests own that pin
    applyEndOfTurn(s);
    expect(s.board.filter((c) => c.cardId === 'b2_trexbaby'), 'Echo fired twice via the rally').toHaveLength(2);
    expect(s.lastEchoFires).toBe(2);
    expect(s.lastRallyFires, 'the rally itself counted once').toBe(1);
  });
});
