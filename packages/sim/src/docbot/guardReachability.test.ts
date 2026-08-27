/**
 * DOC BOT — GUARD REACHABILITY (blind-spot class 7: "a guard exists" is not "the guard is correct").
 *
 * The #847 audit rule says an unusable spell is REFUSED, not consumed: `spellFizzles` (plus a handful of
 * older inline guards in the reducer's `case 'play'`) returns the untouched state, so the card stays in hand
 * and no Gold is spent. Doc Bot's other instruments can prove such a guard EXISTS — nothing proved it never
 * over-fires. An over-eager guard is the nastiest version of this bug: a spell that can never be cast at all
 * reads as "the game ate my click", and no determinism/golden test notices because nothing changes.
 *
 * This sweep mechanically closes the automatable half: for EVERY refusal guard, construct at least one state
 * where the spell SHOULD cast, drive the REAL reducer `play` path, and assert the cast actually happened
 * (state advanced, card consumed / effect armed). Over-LENIENT guards (a spell that casts when it should
 * refuse) stay on the owner's policy card — that half needs a ruling per spell, not a harness.
 *
 * The guarded-spell list is DERIVED, never hand-written:
 *   • the `NO_OP` table is parsed out of `spellFizzle.ts` itself, so a new table entry automatically sweeps
 *     every spell it newly covers into this test;
 *   • the reducer's legacy inline guards (`if (boardTarget && def.effects.some((e) => e.do === '…'))
 *     return state`) are parsed out of `reducer.ts` the same way, plus its two predicate guards
 *     (`targetTribe`, `targetNoGolden`), each pinned by a source-text stale check below.
 * A guarded spell with NO arming fixture FAILS with "add an arming fixture" — the factoryPhase.test.ts
 * discipline: an excuse is allowed only with a verifiable why, and the excuse count is ratcheted so the
 * backlog can only shrink.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CardDef } from '@game/core';
import { reduce } from '../reducer';
import { poolOf } from '../cardPool';
import { createRun, type BoardCard, type RunState, type ShopCard } from '../state';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 1. Derive the guard inventory from the guard code itself ─────────────────────────────────────────────

const fizzleSrc = readFileSync(join(HERE, '..', 'spellFizzle.ts'), 'utf8');
const noOpStart = fizzleSrc.indexOf('const NO_OP');
const noOpEnd = fizzleSrc.indexOf('\n};', noOpStart);
/** Effect ids the fizzle table can refuse (2-space-indented keys of the NO_OP object literal). */
const TABLE_DOS = new Set(
  [...fizzleSrc.slice(noOpStart, noOpEnd).matchAll(/^ {2}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]!),
);

const reducerSrc = readFileSync(join(HERE, '..', 'reducer.ts'), 'utf8');
/** Effect ids the reducer's legacy inline `case 'play'` guards refuse on (predate spellFizzle.ts). */
const INLINE_DOS = new Set(
  [...reducerSrc.matchAll(/if \(boardTarget && def\.effects\.some\(\(e\) => e\.do === '(\w+)'\)/g)].map((m) => m[1]!),
);

/** Would the reducer's guards evaluate this spell at all? (mirrors the `case 'play'` spell branch's scope) */
function guardsOn(def: CardDef): string[] {
  if (!def.spell || def.gift || def.discoverOnPlay) return []; // gift/discover branches return before the guards
  const dos = def.effects.map((e) => e.do);
  const via: string[] = [];
  if (dos.length > 0 && dos.every((d) => TABLE_DOS.has(d))) via.push('fizzle-table'); // spellFizzles' own rule
  for (const d of dos) if (INLINE_DOS.has(d)) via.push(`inline:${d}`);
  if (def.targetTribe) via.push('inline:targetTribe');
  if (def.targetNoGolden) via.push('inline:targetNoGolden');
  return via;
}

const GUARDED: { def: CardDef; via: string[] }[] = Object.values(CARD_INDEX)
  .filter((d): d is CardDef => !!d)
  .map((def) => ({ def, via: guardsOn(def) }))
  .filter((g) => g.via.length > 0);

// ── 2. Arming fixtures — one state per guarded spell where the cast MUST go through ──────────────────────
//
// Each fixture is derived from the guard's own condition (Mend wants damaged Armor, Ossuary Rite wants a
// friendly Echo body, …). Support minions are looked up by PREDICATE, not id, so a renamed/archived card
// can't silently rot a fixture — a predicate with no match throws loudly.

const findMinion = (why: string, pred: (d: CardDef) => boolean): CardDef => {
  const hit = Object.values(CARD_INDEX).find((d) => !!d && !d.spell && !d.token && !d.ruby && pred(d));
  if (!hit) throw new Error(`guardReachability: no minion in CARD_INDEX matches "${why}"`);
  return hit;
};
const onBoard = (def: CardDef, uid: string): BoardCard =>
  ({ uid, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [], golden: false });
const asOffer = (def: CardDef, uid: string): ShopCard => ({ uid, cardId: def.id });
const spellInHand = (id: string): BoardCard =>
  ({ uid: 'sp', cardId: id, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

/** A pinned-set, cash-rich, guard-neutral base state (armor 0 so heal/armor guards read "damaged"). */
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set1', tier: 6, embers: 30, armor: 0, hand: [], board: [], shop: [], ...over });

const anyMinion = () => findMinion('any plain minion', () => true);
const dwarf = () => findMinion('a Dwarf', (d) => d.tribe === 'dwarf' || d.tribe2 === 'dwarf');
const demon = () => findMinion('a Demon', (d) => d.tribe === 'demon' || d.tribe2 === 'demon');
const echoBody = () => findMinion('a minion with an Echo (onDeath)', (d) => d.effects.some((e) => e.on === 'onDeath'));
const shoutSummoner = () =>
  findMinion('a Shout that summons (safe Battlecry to replay)', (d) => d.effects.some((e) => e.on === 'onPlay' && e.do === 'battlecrySummon'));
/** A minimal last/next-opponent snapshot — only the fields the scout/reflection guards + effects read. */
const snapshotOf = (def: CardDef) =>
  ({ minions: [{ cardId: def.id, attack: def.attack, health: def.health }] }) as unknown as NonNullable<RunState['servedBoards']>[number];

interface Fixture {
  /** Which guard condition this state arms (documentation for the next reader). */
  arms: string;
  make: () => { s: RunState; targetUid?: string };
  /** Extra proof the cast landed (beyond "state advanced + card consumed"). */
  proof?: (next: RunState, prev: RunState) => void;
  /** The cast is armed but deliberately does NOT consume the card yet (two-step spells). */
  keepsCard?: boolean;
}

const FIXTURES: Record<string, Fixture> = {
  // ── fizzle-table: board-facing ──────────────────────────────────────────────────────────────────────
  growth: { arms: 'spellBuffAll: a minion on the board', make: () => ({ s: base({ board: [onBoard(anyMinion(), 'm1')] }) }) },
  sparkplug: { arms: 'spellBuffAll ×2 (Waking Rift): a minion on the board', make: () => ({ s: base({ board: [onBoard(anyMinion(), 'm1')] }) }) },
  wo_champion: { arms: 'spellBuffLeftmost: a minion on the board', make: () => ({ s: base({ board: [onBoard(anyMinion(), 'm1')] }) }) },
  rubyexcavation: { arms: 'spellPlayRubiesAll: a minion on the board', make: () => ({ s: base({ setId: 'set2', board: [onBoard(anyMinion(), 'm1')] }) }) },

  // ── fizzle-table: shop-facing ───────────────────────────────────────────────────────────────────────
  lasso: {
    arms: 'stealTavernMinion: a minion offer in the tavern',
    make: () => ({ s: base({ shop: [asOffer(anyMinion(), 'of1')] }) }),
    proof: (next) => expect(next.hand.some((c) => !CARD_INDEX[c.cardId]?.spell), 'Lasso stole the tavern minion into hand').toBe(true),
  },
  goldentouch: {
    arms: 'spellGildRandomTavern: a minion offer in the tavern',
    make: () => ({ s: base({ shop: [asOffer(anyMinion(), 'of1')] }) }),
    proof: (next) => expect(next.shop.some((o) => o.golden), 'an offer was gilded').toBe(true),
  },
  elevationritual: {
    arms: 'spellRefreshTierUp: a minion offer in the tavern (tier 2 leaves tier-up headroom)',
    make: () => ({ s: base({ tier: 2, shop: [asOffer(anyMinion(), 'of1')] }) }),
  },
  deepdelvewrit: {
    arms: "spellStealShop(tribe): the tavern holds a Dwarf",
    make: () => ({ s: base({ shop: [asOffer(dwarf(), 'of1')] }) }),
    proof: (next) => expect(next.hand.some((c) => CARD_INDEX[c.cardId]?.tribe === 'dwarf' || CARD_INDEX[c.cardId]?.tribe2 === 'dwarf'), 'a Dwarf was stolen to hand').toBe(true),
  },
  ironcladreq: {
    arms: "spellStealShop(perTribe): YOUR board holds a Dwarf + the tavern holds any minion",
    make: () => ({ s: base({ board: [onBoard(dwarf(), 'd1')], shop: [asOffer(anyMinion(), 'of1')] }) }),
  },

  // ── fizzle-table: conditional / stateful ────────────────────────────────────────────────────────────
  mend: { arms: 'setArmor: Armor below the floor (base() pins armor 0 < 5)', make: () => ({ s: base() }) },
  undeadarmy: {
    // NOTE (found building this): the guard only checks the PINNED POOL for Undead — the effect additionally
    // requires 'undead' among the RUN's five tribes, so an off-tribe run consumes the card for nothing (the
    // over-LENIENT side; owner's policy card, not this sweep). The fixture forces the tribe in.
    arms: "conjureTribeArmy: the run's pinned pool (set1) contains Undead (+ 'undead' among the run tribes)",
    make: () => {
      const s = base({ setId: 'set1' });
      if (!s.tribes.includes('undead')) s.tribes = [...s.tribes.slice(0, -1), 'undead'];
      // createRun stocked `pool` for ITS tribes/set — make sure at least one set1 Undead has copies left.
      const u = poolOf(s).buyable.find((d) => d.tribe === 'undead' && d.tier <= s.tier);
      if (!u) throw new Error('guardReachability: set1 pool has no Undead — update the undeadarmy fixture');
      s.pool = { ...s.pool, [u.id]: 4 };
      return { s };
    },
    proof: (next) => expect(next.hand.length, 'the army was conjured to hand').toBeGreaterThan(0),
  },
  farseersreport: {
    arms: 'spellScoutNextOpponent: a pinned next-opponent board with minions',
    make: () => ({ s: base({ servedBoards: { 1: snapshotOf(anyMinion()) } }) }),
    proof: (next) => expect(next.scoutedNextOpponent?.length ?? 0, 'the scout produced picks').toBeGreaterThan(0),
  },
  rivalsreflection: {
    arms: 'spellDiscoverFromLastOpponent: a last-opponent board holding a real (non-token) minion',
    make: () => ({ s: base({ wave: 2, servedBoards: { 1: snapshotOf(anyMinion()) } }) }),
  },

  // ── fizzle-table: target-facing ─────────────────────────────────────────────────────────────────────
  ossuaryrite: {
    arms: 'spellTriggerEcho: the target has its own Echo (onDeath)',
    make: () => ({ s: base({ board: [onBoard(echoBody(), 'e1')] }), targetUid: 'e1' }),
  },
  tribeschoice: {
    arms: "spellGainOfTargetTribe: a tribed target whose tribe has pool minions at ≤ the run's tier",
    // The guard reads the target def's PRIMARY tribe and checks the PINNED pool — so the target must be a
    // primary-tribe member of a tribe the run's set actually stocks (Beast is in every set's roster).
    make: () => ({ s: base({ tier: 6, board: [onBoard(findMinion('a primary-tribe Beast', (d) => d.tribe === 'beast'), 'b1')] }), targetUid: 'b1' }),
  },

  // ── reducer inline guards (predate the table — see spellFizzle.ts's module doc) ─────────────────────
  resonance: {
    arms: "inline spellReplayBattlecry: the target has a Battlecry (onPlay)",
    make: () => ({ s: base({ board: [onBoard(shoutSummoner(), 'b1')] }), targetUid: 'b1' }),
  },
  displacement: {
    arms: 'inline spellDisplace + targetNoGolden: a non-golden target + a tavern minion to swap with',
    make: () => ({ s: base({ board: [onBoard(anyMinion(), 'm1')], shop: [asOffer(anyMinion(), 'of1')] }), targetUid: 'm1' }),
  },
  layaway: {
    arms: 'inline spellLayaway: aimed at a SHOP offer (the guard refuses board aims)',
    make: () => ({ s: base({ shop: [asOffer(anyMinion(), 'of1')] }), targetUid: 'of1' }),
  },
  commonground: {
    arms: 'inline spellAverageStats: a second friendly minion exists for the pair',
    make: () => ({ s: base({ board: [onBoard(anyMinion(), 'm1'), onBoard(anyMinion(), 'm2')] }), targetUid: 'm1' }),
    // Common Ground ARMS on the first pick: the reducer defers to the aim picker for the second minion, so
    // the card deliberately stays in hand and no Gold moves until `battlecryTarget` completes the pair.
    keepsCard: true,
    proof: (next) => expect(next.pendingTarget?.spellFirstUid, 'the two-step aim is armed').toBe('m1'),
  },
  seconddraft: {
    arms: 'inline targetNoGolden: a non-golden target (returns it to hand)',
    make: () => ({ s: base({ board: [onBoard(anyMinion(), 'm1')] }), targetUid: 'm1' }),
    proof: (next) => expect(next.hand.some((c) => c.uid === 'm1'), 'the target was returned to hand').toBe(true),
  },
  cupcakes: {
    arms: 'inline targetTribe(demon): a friendly Demon target + tavern minions to consume',
    make: () => ({
      s: base({ board: [onBoard(demon(), 'd1')], shop: [1, 2, 3, 4].map((n) => asOffer(anyMinion(), `of${n}`)) }),
      targetUid: 'd1',
    }),
  },
};

/**
 * Spells that genuinely cannot be armed headlessly. Each entry needs a verifiable `why` plus a `stillTrue`
 * probe so a stale excuse fails the run (the factoryPhase excuse discipline). Empty today — every guarded
 * spell has an arming fixture — but the mechanism (and its ratchet below) is the contract for the next one.
 */
const EXCUSED: Record<string, { why: string; stillTrue: (def: CardDef) => boolean }> = {};

// ── 3. The sweep ─────────────────────────────────────────────────────────────────────────────────────────

describe('Doc Bot — guard reachability (every refusal guard has a state where the spell CASTS)', () => {
  it('the guard inventory parsed out of the source is sane (canaries)', () => {
    // If spellFizzle.ts is reshaped these fail LOUDLY instead of the sweep silently sweeping nothing.
    expect(TABLE_DOS.has('setArmor'), 'NO_OP parse lost setArmor (Mend)').toBe(true);
    expect(TABLE_DOS.has('spellStealShop'), 'NO_OP parse lost spellStealShop').toBe(true);
    expect(TABLE_DOS.size, 'suspiciously small NO_OP table — the source parse broke').toBeGreaterThanOrEqual(10);
    expect(INLINE_DOS.has('spellLayaway'), 'reducer inline-guard parse lost spellLayaway').toBe(true);
    expect(INLINE_DOS.size, 'reducer inline-guard parse broke').toBeGreaterThanOrEqual(4);
    // The two predicate guards are matched by hand above — pin the source text they encode so a rename here
    // fails THIS line (update guardsOn) instead of silently dropping targetTribe/targetNoGolden spells.
    expect(reducerSrc, 'targetTribe guard moved/renamed — update guardsOn()').toContain('aimTribe && !isTribe(boardTarget, aimTribe)');
    expect(reducerSrc, 'targetNoGolden guard moved/renamed — update guardsOn()').toContain('def.targetNoGolden && boardTarget.golden');
    expect(GUARDED.length, 'no guarded spells found — the derivation broke').toBeGreaterThanOrEqual(15);
  });

  it('every guarded spell casts in its arming state (no over-eager guard), or carries a live excuse', () => {
    const holes: string[] = [];
    for (const { def, via } of GUARDED) {
      const fixture = FIXTURES[def.id];
      const excuse = EXCUSED[def.id];
      if (!fixture && !excuse) {
        holes.push(`${def.id} (${def.name}; guarded via ${via.join(', ')}): add an arming fixture — a state where this spell SHOULD cast — to FIXTURES in guardReachability.test.ts`);
        continue;
      }
      if (!fixture) continue; // excused — audited below
      const { s, targetUid } = fixture.make();
      s.hand = [...s.hand, spellInHand(def.id)];
      const prev = s;
      const next = reduce(s, { type: 'play', uid: 'sp', ...(targetUid ? { targetUid } : {}) });
      // A refusal returns the UNTOUCHED state object (the spellFizzle contract) — so identity means refused.
      if (next === prev) {
        holes.push(`${def.id} (${def.name}): REFUSED in its arming state (${fixture.arms}) — the guard is over-eager, or the fixture no longer arms it`);
        continue;
      }
      if (!fixture.keepsCard && next.hand.some((c) => c.uid === 'sp')) {
        holes.push(`${def.id} (${def.name}): the state changed but the card was NOT consumed — partial cast?`);
        continue;
      }
      fixture.proof?.(next, prev);
    }
    expect(holes, `Guard-reachability hole(s):\n  ${holes.join('\n  ')}`).toEqual([]);
  });

  it('fixtures and excuses are real: each names a currently-guarded spell, and excuses stay true', () => {
    const ids = new Set(GUARDED.map((g) => g.def.id));
    const stale: string[] = [];
    for (const id of Object.keys(FIXTURES)) {
      if (!ids.has(id)) stale.push(`fixture '${id}': no longer a guarded spell — delete the entry`);
    }
    for (const [id, ex] of Object.entries(EXCUSED)) {
      if (!ids.has(id)) { stale.push(`excuse '${id}': no longer a guarded spell — delete the entry`); continue; }
      if (FIXTURES[id]) stale.push(`excuse '${id}': a fixture now EXISTS — delete the excuse (the fixture wins)`);
      else if (!ex.stillTrue(CARD_INDEX[id]!)) stale.push(`excuse '${id}': its premise no longer holds (${ex.why}) — arm it or fix the excuse`);
    }
    expect(stale, `Stale entr(ies):\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('the excused backlog can only shrink (ratchet: 0 as of 2026-08-26)', () => {
    const excused = Object.keys(EXCUSED);
    expect(excused.length, `excused: ${excused.join(', ')} — arming one? lower this ratchet. Adding one needs a genuinely un-armable cast path (Discover-modal-only etc.), not convenience.`).toBeLessThanOrEqual(0);
  });
});
