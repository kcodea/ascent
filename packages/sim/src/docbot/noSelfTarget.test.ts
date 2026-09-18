import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_CARDS, CARD_INDEX, EQUIPMENT, poolFor } from '@game/content';
import { ARENA_EFFECTS, makeRng, type CardDef, type EffectArena } from '@game/core';
import { createRun, reduce, type Action, type BoardCard, type RunState } from '../index';
import { rebuildEquipment } from '../equipment';

/**
 * DOC BOT LANE `noSelfTarget` — R-TARGET-03: **NO CARD TARGETS ITSELF** (owner ruling 2026-09-18, global).
 *
 * The ruling arrived on Cage Breaker and EMS ("their targeted effects must not be able to target themselves")
 * and was made the rule for every card: wherever a card's effect CHOOSES a friendly minion — an aimed Shout, an
 * aimed Equipment, a random-friendly picker, a minion-cast targeted spell — the source is never in the pool.
 * Positional / identity reads ("adjacent", "left-most", "on this", "your minions", Paragon's "a minion of every
 * type" — which it is) are not choices and keep their membership.
 *
 * Three phase-native helpers carry the rule so it cannot be re-implemented per card: `others` (arena.ts),
 * `otherFriends` (factories.ts) and `othersOnBoard` (recruit.ts). This lane keeps them honest three ways:
 *
 *  1. BEHAVIOUR — every arena picker is DRIVEN against a fake arena where the source is the only body, then
 *     with others present, and the recording proves no target-taking verb ever received the source.
 *  2. BEHAVIOUR — every aimed Shout in the pool and every aimed Equipment is driven through the real reducer:
 *     a self-aim is refused, and a source alone on the board is never prompted to aim at itself.
 *  3. TRIPWIRE — a static scan of the three files: any effect body that draws from the run's RNG AND pools the
 *     friendly board must route through the helper (or an explicit `!== self` filter), or be named below with
 *     the reason it is not a choice. A new random-friendly picker written without the helper fails here.
 */

// ── 1. Arena pickers ──────────────────────────────────────────────────────────────────────────────────────

/** Arena bodies that CHOOSE a friendly body at random (or auto-pick one for an un-aimed Shout). Each is driven. */
const ARENA_PICKERS: Record<string, Record<string, unknown>> = {
  deathrattleGrantWardRandom: { count: 2 },
  deathrattleGiveHealth: { count: 2 },
  deathrattleGrantReborn: {},
  deathrattleGrantShield: {},
  rubyPlayedBounce: { rubyAttack: 1, rubyHealth: 1, random: 2 },
  onSpellCastBuffRandomTribe: { count: 3, attack: 3, health: 3 },
  spellCastBuffOthers: { count: 2, attack: 1, health: 1 },
  deathrattleBuffRandomTribe: { attack: 2, health: 2 },
  deathrattleGiveMaxStatsRandomTribe: {},
  overflowBuffRandom: { count: 2, attack: 2, health: 2 },
  rallyBuff: { count: 1, attack: 1, health: 1 },
  rallyGiveHealthToDragons: { tribe: 'dragon' },
  rallyGiveAttackToOthers: { count: 3 },
  scGrantReborn: {},
  scBuffRandomTribePerAle: { attack: 2, health: 2 },
  onGainCardBuffTribe: { attack: 1, health: 2 },
  battlecryBuffTarget: { attack: 2, health: 2 },
  battlecryGrantKeyword: { keywords: ['DS'] },
};

/** Arena bodies whose pool is an IDENTITY or POSITIONAL membership, not a choice — named with the reason. */
const ARENA_NOT_A_CHOICE: Record<string, string> = {
  onRallyBuffOnePerTribe: 'Paragon IS "a minion of every type" — the owner\'s worked example (2 Dragons + a Beast + Paragon → one Dragon, the Beast, Paragon) has it collecting its own payout; the random draw is per-TRIBE among the real-tribe bodies',
  scDamage: 'the pool is `enemies()` — there is no friendly to exclude',
  rallyDamageRandomEnemy: 'enemies only',
};

interface Recorded { verb: string; uid: string }
function fakeArena(selfUid: string, friendUids: string[], params: { tribe?: string } = {}): { arena: EffectArena; hits: Recorded[] } {
  const hits: Recorded[] = [];
  const mk = (uid: string, attack = 3) => ({ uid, cardId: 'x', attack, health: 4, maxHealth: 4, keywords: [] as string[], golden: false, tribe: params.tribe ?? 'dwarf' });
  const self = { ...mk(selfUid), cardId: 'src', keywords: ['RL'] };
  const friends = () => [self, ...friendUids.map((u) => mk(u))];
  const rng = makeRng(7);
  const TARGET_VERBS = new Set(['buff', 'buffPermanent', 'grantShield', 'grantReborn', 'playRubiesOn', 'gainRubyStats', 'grantKeywordTo', 'buffHand', 'damage', 'stripKeyword', 'triggerEchoOn', 'replayShout', 'graftEffect', 'stampKarwindFlash']);
  const base: Record<string, unknown> = {
    phase: 'combat', self,
    friends, enemies: () => [],
    handMinions: () => [],
    hasShield: () => false, hasReborn: () => false,
    isTribe: (t: { tribe?: string }, tribe: string) => (t.tribe ?? 'dwarf') === tribe,
    tribesOf: (t: { tribe?: string }) => [t.tribe ?? 'dwarf'],
    isUniversalTribe: () => false, isCelestial: () => false, isImp: () => false, isFodder: () => false,
    rubyTallyOf: () => ({ attack: 0, health: 0 }), impAura: () => ({ attack: 0, health: 0 }),
    deathrattleTally: () => 0, conductorTally: () => 0, improveReps: () => 1, matriarchReps: () => 1,
    spellsThisTurn: () => 0, spellPower: () => ({ attack: 0, health: 0 }), alesLastTurn: () => 1,
    fodderConsumed: () => ({ attack: 0, health: 0 }), activeTribes: () => ['dwarf'], targetTribe: () => undefined,
    cardDef: () => undefined, nameOf: (t: { uid: string }) => t.uid, hasEffect: () => false, hasEcho: () => false,
    echoEffectsOf: () => [], neighboursOf: () => [], summonToken: () => undefined,
    rng: () => rng,
  };
  const arena = new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (TARGET_VERBS.has(prop)) return (t: { uid: string }) => { hits.push({ verb: prop, uid: t.uid }); };
      return () => undefined; // every other verb (narrate, logImprove, grantRubyPower, …) is a harmless no-op here
    },
  }) as unknown as EffectArena;
  return { arena, hits };
}

describe('R-TARGET-03 — arena pickers never choose the source', () => {
  for (const [id, params] of Object.entries(ARENA_PICKERS)) {
    it(`${id}: alone → nothing lands on the source; with others → every hit is on someone else`, () => {
      const body = (ARENA_EFFECTS as unknown as Record<string, (a: EffectArena, p: Record<string, unknown>) => void>)[id];
      expect(body, `${id} is an arena body`).toBeTypeOf('function');
      const tribe = (params.tribe as string | undefined) ?? 'dwarf';
      const alone = fakeArena('SELF', [], { tribe });
      body!(alone.arena, { ...params, tribe });
      expect(alone.hits.filter((h) => h.uid === 'SELF'), 'alone: the source is not its own recipient').toEqual([]);
      const crowd = fakeArena('SELF', ['a', 'b', 'c'], { tribe });
      body!(crowd.arena, { ...params, tribe });
      expect(crowd.hits.length, 'with others present the effect does land').toBeGreaterThan(0);
      expect(crowd.hits.filter((h) => h.uid === 'SELF'), 'never on the source').toEqual([]);
    });
  }
});

// ── 2. Aimed Shouts + aimed Equipment through the real reducer ────────────────────────────────────────────

const body = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: ['undead', 'dwarf', 'kobold', 'beast', 'dragon', 'demon'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);

/** A friendly body of the tribe the card's aim demands (or any body). */
function partnerFor(def: CardDef): string {
  const tribe = def.targetTribe;
  const pick = ALL_CARDS.find((c) => !c.spell && !c.token && !c.ruby && c.id !== def.id && !c.chooseOne?.length && !c.target
    && c.effects.length === 0 && (!tribe || c.tribe === tribe || c.tribe2 === tribe));
  return pick?.id ?? 'sandbag';
}

describe('R-TARGET-03 — every aimed Shout refuses its own body', () => {
  const aimed = ALL_CARDS.filter((c) => !c.spell && !c.ruby && !c.token && c.target === 'friendly');
  it('finds the aimed Shouts (a sanity floor)', () => {
    expect(aimed.map((c) => c.id)).toEqual(expect.arrayContaining(['u3_cagebreaker', 'graverobber', 'dw_runemaster']));
  });
  for (const def of aimed) {
    it(`${def.id} (${def.name}): a self-aim is refused; alone on the board it is never prompted to aim`, () => {
      // With a partner: the aim opens (a Choose One opens its pick first) and a self-target is refused outright.
      let s = run({ hand: [body('me', def.id)], board: [body('p', partnerFor(def))] });
      s = act(s, { type: 'play', uid: 'me', toIndex: 0 });
      if (def.chooseOne?.length) s = act(s, { type: 'chooseOne', index: 0 });
      if (s.pendingTarget?.uid === 'me') {
        expect(act(s, { type: 'battlecryTarget', targetUid: 'me' }), 'refused: the reducer returns the same state').toBe(s);
      }
      // Alone: no legal recipient → no aim prompt whose only answer would be itself.
      let alone = run({ hand: [body('me', def.id)], board: [] });
      alone = act(alone, { type: 'play', uid: 'me', toIndex: 0 });
      if (def.chooseOne?.length && alone.chooseOne) alone = act(alone, { type: 'chooseOne', index: 0 });
      expect(alone.pendingTarget?.uid === 'me', 'no self-only aim prompt').toBe(false);
    });
  }
});

describe('R-TARGET-03 — every aimed Equipment refuses its granting body', () => {
  const friendly = EQUIPMENT.filter((e) => e.targetMode === 'friendly');
  it('finds the aimed Equipment (a sanity floor)', () => {
    expect(friendly.map((e) => e.id)).toEqual(expect.arrayContaining(['bloodpot', 'deathfibrillator']));
  });
  for (const eq of friendly) {
    const granter = ALL_CARDS.find((c) => c.effects.some((e) => e.on === 'equip' && e.params?.equipmentId === eq.id));
    if (!granter) continue; // a rune-only / starform Equipment has no minion granter to exclude
    it(`${eq.id} (${eq.name}, from ${granter.name}): aiming at the granter is refused, at another body it lands`, () => {
      const s = run({ board: [body('src', granter.id), body('t', 'knit')] });
      rebuildEquipment(s);
      const before = s;
      expect(act(s, { type: 'activateEquipment', targetUid: 'src' }), 'refused').toBe(before);
      expect(act(s, { type: 'activateEquipment', targetUid: 't' }), 'another body is fine').not.toBe(before);
    });
  }
});

// ── 3. The static tripwire ────────────────────────────────────────────────────────────────────────────────

const read = (p: string): string => readFileSync(resolve(__dirname, p), 'utf8');

/** Split a factory map's source into { name → body } by its `  name: (ctx` / `  name(arena` headers. */
function bodiesOf(src: string, header: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  const idx: { name: string; at: number }[] = [];
  for (const m of src.matchAll(header)) idx.push({ name: m[1]!, at: m.index! });
  for (let i = 0; i < idx.length; i++) out.set(idx[i]!.name, src.slice(idx[i]!.at, idx[i + 1]?.at ?? src.length));
  return out;
}

/** Bodies that draw RNG over a FRIENDLY pool but are not choices — named, with the reason. */
const RECRUIT_NOT_A_CHOICE: Record<string, string> = {
  onTribePlayedConsumeShop: 'the random pick is the EATER (which Demon consumes) and the shop offer; a spell-less watcher with `params.self` eats itself by design ("this consumes")',
  battlecryScoutSpread: 'routes through othersOnBoard — listed only because the Beast COUNT scan reads state.board (it counts itself, it never grants itself)',
  goldSpentMagnetize: 'the pool is the Magnetic CARD INDEX, not the board',
  spellDevour: 'a SPELL: the devoured pair is positional (`indexOf(self)` is the spell target, not a minion source)',
  spellBuffRandomFriendlies: 'a SPELL cast by the player — no minion source to exclude',
  spellCastDemonConsumesShop: 'the random pick is which Demon EATS and which shop offer — the eater may be this body by design ("a friendly Demon consumes", itself included as a Demon)',
  onSpellCastOnThisSpreadRandom: 'filters `c.uid !== self.uid` inline',
  onRubyPlayedSpreadRandom: 'filters `c.uid !== self.uid` inline',
  deathrattleSummonRandomHandMinion: 'the pool is the HAND, and the source is a board body',
  impInheritOnDeath: 'filters `c.uid !== self.uid && c.uid !== dead.uid` inline (declared in anotherMinionExcludesSelf)',
  deathrattleBuffRandom: 'filters `c !== self` inline',
  onTribeSummonedBuffRandomOthers: 'filters `c.uid !== self.uid` inline (declared in anotherMinionExcludesSelf)',
};
const COMBAT_NOT_A_CHOICE: Record<string, string> = {
  rallyCastRandomTargetedSpell: 'filters `m !== self` inline (Badgington: "it can\'t target itself", owner ruling)',
  onShieldBreakGrantShield: 'filters `m !== self` inline',
  rallyGiveDemonAttack: 'filters `m !== self` inline',
  rallyGiveAttackToOthers: 'arena-backed (driven above)',
  deathrattleSummonRandomTier: 'the pool is the CARD pool (summons fresh bodies)',
  deathrattleFillTribe: 'the pool is a card-id list (summons fresh bodies)',
  scSplitDamage: 'enemies only',
  onShieldBreakDamage: 'enemies only',
  deathrattleBuffAllRandomStat: 'the coin flip picks a STAT; the grant is board-wide ("every living friend"), not a choice',
};

const SELF_GUARD = /othersOnBoard\(|otherFriends\(|others\(arena|uid !== self\.uid|!== self\b|!== arena\.self\.uid|uid !== dead\.uid/;

describe('R-TARGET-03 — tripwire: a random-friendly pool without the helper is a defect', () => {
  it('recruit.ts: every factory that draws RNG over the board goes through othersOnBoard (or is named as not a choice)', () => {
    const src = read('../recruit.ts');
    const start = src.indexOf('const RECRUIT_FACTORIES');
    const end = src.indexOf('export const RECRUIT_FACTORY_IDS');
    const bodies = bodiesOf(src.slice(start, end), /^  (\w+): \(ctx/gm);
    const offenders: string[] = [];
    for (const [name, b] of bodies) {
      const draws = /rng\.int\(|rng\.pick\(/.test(b);
      const pools = /state\.board\.filter\(|state\.board\[rng|\.\.\.state\.board\]|state\.board\b[^.]*\.length\)/.test(b) || /ctx\.state\.board\.filter\(/.test(b);
      if (!draws || !pools) continue;
      if (SELF_GUARD.test(b)) continue;
      if (name in RECRUIT_NOT_A_CHOICE) continue;
      offenders.push(name);
    }
    expect(offenders, 'route the pick through `othersOnBoard(ctx.state, self, …)` or name the body in RECRUIT_NOT_A_CHOICE with why it is not a choice').toEqual([]);
  });

  it('factories.ts: every combat factory that draws RNG over the living board goes through otherFriends (or is named)', () => {
    const src = read('../../../core/src/effects/factories.ts');
    const start = src.indexOf('export const FACTORIES');
    const bodies = bodiesOf(src.slice(start), /^  (\w+): \(ctx/gm);
    const offenders: string[] = [];
    for (const [name, b] of bodies) {
      const draws = /ctx\.rng\.(int|pick)\(/.test(b);
      const pools = /ctx\.living\(self\.side\)/.test(b);
      if (!draws || !pools) continue;
      if (SELF_GUARD.test(b)) continue;
      if (name in COMBAT_NOT_A_CHOICE) continue;
      offenders.push(name);
    }
    expect(offenders, 'route the pick through `otherFriends(ctx, self, …)` or name the body in COMBAT_NOT_A_CHOICE').toEqual([]);
  });

  it('arena.ts: every body that draws RNG over friends() is a driven picker or named as not a choice', () => {
    const src = read('../../../core/src/effects/arena.ts');
    const start = src.indexOf('export const ARENA_EFFECTS');
    const bodies = bodiesOf(src.slice(start), /^  (\w+)\(arena: EffectArena/gm);
    const offenders: string[] = [];
    for (const [name, b] of bodies) {
      const draws = /rng\(\)|rng\.int\(|rng\.pick\(/.test(b);
      const pools = /friends\(\)|others\(arena/.test(b);
      if (!draws || !pools) continue;
      if (name in ARENA_PICKERS || name in ARENA_NOT_A_CHOICE) continue;
      offenders.push(name);
    }
    expect(offenders, 'add the body to ARENA_PICKERS (it is then driven) or ARENA_NOT_A_CHOICE with the reason').toEqual([]);
  });

  it('no declaration has outlived its body', () => {
    const arena = read('../../../core/src/effects/arena.ts');
    const recruit = read('../recruit.ts');
    const combat = read('../../../core/src/effects/factories.ts');
    const stale: string[] = [];
    for (const n of [...Object.keys(ARENA_PICKERS), ...Object.keys(ARENA_NOT_A_CHOICE)]) if (!arena.includes(`  ${n}(arena: EffectArena`)) stale.push(`arena:${n}`);
    for (const n of Object.keys(RECRUIT_NOT_A_CHOICE)) if (!recruit.includes(`  ${n}: (ctx`)) stale.push(`recruit:${n}`);
    for (const n of Object.keys(COMBAT_NOT_A_CHOICE)) if (!combat.includes(`  ${n}: (ctx`)) stale.push(`combat:${n}`);
    expect(stale, 'delete declarations whose body is gone').toEqual([]);
  });
});
