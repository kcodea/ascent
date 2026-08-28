/**
 * DOC BOT — HERO-POWER STAGERS BY ACTIVATION FAMILY (handoff §6, PR 4).
 *
 * The heroScan lane proves ACTIVE powers act through the real `heroPower` action; everything it reads silent
 * used to sit in a generically-excused "passive/scheduled" queue. This lane DRAINS that queue: each silent
 * power gets a stager that drives the REAL engine — `createRun`, `reduce`, real buys/sells/rolls/upgrades,
 * real wave advances, the real `faceOmen` combat — to that power's activation point and asserts the payoff.
 * No parallel implementation of power behaviour exists here (§3.1): everything below is reducer actions plus
 * assertions on the resulting state.
 *
 * The worklist DERIVES from the live HEROES registry: a hero whose power the scan reads silent MUST have a
 * verdict in `SILENT_QUEUE_VERDICTS`, and every `HeroPowerKind` MUST be classified in `POWER_FAMILY`
 * (compile-enforced; the runtime sweep below re-checks with a "classify me" message so the failure names the
 * hero, matching the factoryPhase ratchet discipline).
 *
 * SABOTAGE (§3.5): the Drakko stager's threshold is neutered in-memory at the bottom of this file and the
 * lane's oracle is shown to fail for the intended reason — a counter that silently loses progress no longer
 * pays the quest, and the stager sees it.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { HEROES, getHero, gildCopiesNeeded, playableHeroes, practiceHeroes, powerDiscoverPool } from '../heroes';
import { createRun, serialize, deserialize, type BoardCard, type RunState } from '../state';
import { reduce } from '../reducer';
import { commissionOffer, COMMISSION_DELAY, hasBattlecry } from '../recruit';
import { heroScan } from './heroScan';
import { ARCHIVED_POWER_KINDS, FALL_THROUGH_PASSIVE_COVERAGE, POWER_FAMILY, SILENT_QUEUE_VERDICTS } from './heroPowerFamilies';

type Act = Parameters<typeof reduce>[1];

/** A board/hand card instance for `cardId`, base statline. */
const m = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};

/** A recruit-phase run wielding `heroId`'s power (the heroId-override pattern the hero suites use — it dodges
 *  the run-start modals of heroes whose OWN stager exercises them). The rolled spell slot is cleared: its uid
 *  comes from the same `s${n}` sequence a crafted shop uses, and a collision silently redirects a `buy`. */
const at = (heroId: string, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7), phase: 'recruit', heroId, spell: undefined, ...over }) as RunState;

/** An empty settled combat — the established fixture for advancing a wave through the REAL resolveCombat. */
const win = () => ({
  events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
  initial: { player: [], enemy: [] },
});

/** Advance one wave through the real reducer (combat → next shop). */
const nextTurn = (s: RunState): RunState =>
  reduce({ ...s, phase: 'combat', lastCombat: win() as never, combatSettled: false } as RunState, { type: 'resolveCombat' } as Act);

// ── The derived worklist ─────────────────────────────────────────────────────────────────────────────────

describe('the worklist derives from the live registry', () => {
  const rows = heroScan();

  it('every live hero power kind is classified into an activation family — classify me', () => {
    for (const h of HEROES) {
      expect(POWER_FAMILY[h.power.kind],
        `${h.id} wields '${h.power.kind}' with NO activation family — classify me: add the kind to POWER_FAMILY `
        + `in heroPowerFamilies.ts (and, if the heroScan fixture reads it silent, a verdict + stager here).`).toBeTruthy();
      expect(POWER_FAMILY[h.power.kind],
        `${h.id} wields '${h.power.kind}' which is classified 'retired' — a LIVE hero cannot wield a retired kind; reclassify it.`)
        .not.toBe('retired');
    }
  });

  it('every heroScan-silent power carries a verdict: a stager below, or a typed needs-stager reason', () => {
    const silent = rows.filter((r) => !r.active);
    for (const r of silent) {
      const v = SILENT_QUEUE_VERDICTS[r.heroId];
      expect(v, `${r.heroId} [${r.kind}] is silent under the heroScan fixture with NO verdict — classify me: `
        + `add it to SILENT_QUEUE_VERDICTS with a stager in this file, or an explicit needs-stager reason.`).toBeTruthy();
      expect(v!.kind, `${r.heroId}'s verdict is for '${v!.kind}' but the hero now wields '${r.kind}' — re-verify it.`).toBe(r.kind);
    }
    // …and the other direction: a verdict for a hero the scan no longer reads silent is stale.
    const silentIds = new Set(silent.map((r) => r.heroId));
    for (const heroId of Object.keys(SILENT_QUEUE_VERDICTS)) {
      expect(silentIds.has(heroId),
        `${heroId} has a silent-queue verdict but heroScan now reads it ACTIVE — remove the stale entry.`).toBe(true);
    }
  });

  it('the needs-stager queue is pinned TWO-SIDED at 0 — every silent power is staged', () => {
    const needs = Object.entries(SILENT_QUEUE_VERDICTS).filter(([, v]) => v.verdict === 'needs-stager');
    const PIN = 0;
    expect(needs.length, `needs-stager grew (pin ${PIN}): ${needs.map(([id]) => id).join(', ')} — build the stager instead of excusing it.`)
      .toBeLessThanOrEqual(PIN);
    expect(needs.length, `only ${needs.length} needs-stager now (pin ${PIN}) — you staged some; lower the pin.`)
      .toBeGreaterThanOrEqual(PIN);
  });

  it('fall-through passives cite real coverage files (see the FALL_THROUGH note in heroPowerFamilies.ts)', () => {
    for (const [kind, file] of Object.entries(FALL_THROUGH_PASSIVE_COVERAGE)) {
      expect(existsSync(resolve(__dirname, '../../../..', file!)),
        `'${kind}' cites ${file} which does not exist — point at the suite that actually covers it.`).toBe(true);
    }
  });
});

// ── start-of-run ─────────────────────────────────────────────────────────────────────────────────────────

describe('start-of-run stagers', () => {
  it('Yirin (startingReflector): the run opens holding a Reflector', () => {
    expect(createRun(7, 'rohan').hand.some((c) => c.cardId === 'n2_reflector')).toBe(true);
  });

  it('Brackus (summitLock): a Tier-7 Discover at run start, the pick locked until 70 Gold spent', () => {
    const s0 = createRun(7, 'brackus');
    expect(s0.discover, 'the Summit Discover is open').toBeTruthy();
    for (const id of s0.discover!) expect(CARD_INDEX[id]!.tier, `${id} is Tier 7`).toBe(7);
    expect(s0.discoverLockGold).toBe(70);
    const s1 = reduce(s0, { type: 'discover', index: 0 } as Act);
    const pick = s1.hand[s1.hand.length - 1]!;
    expect(pick.lockedUntilGoldSpent, 'the pick carries the lock').toBe(70);
    // The lock GUARD, on a fizzle-proof body carrying the same stamp (a targeted-Shout pick would fizzle an
    // empty board and mask the verdict): refused before 70 Gold spent, played once the run has spent it.
    const held: RunState = { ...s1, embers: 20, board: [], hand: [m('h1', 'pup', { lockedUntilGoldSpent: 70 } as never)] };
    expect(reduce(held, { type: 'play', uid: 'h1', toIndex: 0 } as Act)).toBe(held);
    const spent: RunState = { ...held, goldSpent: 70 };
    expect(reduce(spent, { type: 'play', uid: 'h1', toIndex: 0 } as Act).board.some((c) => c.cardId === 'pup')).toBe(true);
  });

  it('Disco Dan (discoLock): three sequential Discovers T6→T4→T2, each pick tier-locked', () => {
    let s = createRun(7, 'discodan');
    const picks: BoardCard[] = [];
    for (const tier of [6, 4, 2]) {
      expect(s.discover, `the Tier-${tier} Discover is open`).toBeTruthy();
      for (const id of s.discover!) expect(CARD_INDEX[id]!.tier, `${id} is Tier ${tier}`).toBe(tier);
      expect(s.discoverLockTier).toBe(tier);
      s = reduce(s, { type: 'discover', index: 0 } as Act);
      picks.push(s.hand[s.hand.length - 1]!);
    }
    expect(s.discover, 'the setlist is exactly three').toBeFalsy();
    expect(picks.map((c) => c.lockedUntilTier)).toEqual([6, 4, 2]);
    // Turn 1 is a PURE Setlist — every shop action is blocked outright (owner design), even an unlocked play.
    const turn1: RunState = { ...s, embers: 20, board: [], tier: 6, hand: [m('h1', 'pup')] };
    expect(reduce(turn1, { type: 'play', uid: 'h1', toIndex: 0 } as Act), 'turn 1 refuses every play').toBe(turn1);
    // The tier lock GUARD from turn 2 on, on a fizzle-proof body carrying the same stamp (an arbitrary Tier-6
    // pick may be a targeted Shout that fizzles an empty board): unplayable at tier 1, playable at tier 6.
    const held: RunState = { ...s, wave: 2, embers: 20, board: [], tier: 1, hand: [m('h1', 'pup', { lockedUntilTier: 6 } as never)] };
    expect(reduce(held, { type: 'play', uid: 'h1', toIndex: 0 } as Act)).toBe(held);
    const reached: RunState = { ...held, tier: 6 };
    expect(reduce(reached, { type: 'play', uid: 'h1', toIndex: 0 } as Act).board.some((c) => c.cardId === 'pup')).toBe(true);
  });

  // ARCHIVED 2026-08-28 (owner). Fi and Coran used to be staged here by driving their turn-1 offer to a pick
  // and a first step of progress. The quest system is archived, so the stager's JOB changed rather than
  // vanishing: it now proves the archive holds. That is the honest replacement — the silent-queue verdict
  // still says 'stager', and a stager still runs.
  for (const hero of ['fi', 'coran']) {
    it(`${hero} (heroQuest): ARCHIVED — the run opens on no quest offer, and the hero reaches no picker`, () => {
      const s0 = createRun(7, hero);
      expect(s0.questOffer, `${hero} minted a quest offer at run creation — the archive gate leaked`).toBeFalsy();
      expect(s0.activeQuests ?? [], `${hero} opened holding a quest`).toEqual([]);
      // The def stays resolvable (old saves + replays), but it is out of Play, out of Practice, and out of
      // every hero-power Discover pool.
      const def = HEROES.find((h) => h.id === hero);
      expect(def, `${hero}'s def must stay in HEROES so saves and replays resolve it`).toBeTruthy();
      expect(def!.wip, `${hero} must be wip — that is what removes it from every picker`).toBe(true);
      expect(playableHeroes().map((h) => h.id)).not.toContain(hero);
      expect(practiceHeroes().map((h) => h.id)).not.toContain(hero);
      expect(powerDiscoverPool('mimic')).not.toContain(hero);
      expect(powerDiscoverPool('void')).not.toContain(hero);
    });
  }

  it('every ARCHIVED power kind is wielded only by wip heroes — an archived power cannot reach a picker', () => {
    for (const h of HEROES) {
      if (!ARCHIVED_POWER_KINDS.has(h.power.kind)) continue;
      expect(h.wip, `${h.id} wields the ARCHIVED kind '${h.power.kind}' but is not wip — it can still be picked.`)
        .toBe(true);
    }
  });
});

// ── every-n-turns ────────────────────────────────────────────────────────────────────────────────────────

describe('every-n-turns stagers', () => {
  it('Chaos: opens with a Chaos Attachment, and the start of turn 5 grants another', () => {
    let s: RunState = { ...createRun(7, 'chaos'), phase: 'recruit' };
    const count = (x: RunState) => x.hand.filter((c) => c.cardId === 'symbioticattachment').length;
    expect(count(s), 'the opening token').toBe(1);
    for (let w = s.wave; w < 4; w++) s = nextTurn(s); // waves 2–4: nothing
    expect(count(s), 'no grant before turn 5').toBe(1);
    s = nextTurn(s); // turn 5
    expect([s.wave, count(s)], 'turn 5 pays the second token').toEqual([5, 2]);
  });
});

// ── count-threshold ──────────────────────────────────────────────────────────────────────────────────────

/** DISTINCT Shout minions — distinct so no buy completes a triple (a Gild's Discover would modal-block the
 *  next buy and turn the stager into a triple test). Derived from content, like the heroScan fixture. */
const shoutIds = Object.values(CARD_INDEX)
  .filter((c) => c && !c.spell && !c.token && !c.ruby && hasBattlecry(c))
  .map((c) => c.id);

/** Drive Drakko through `n` REAL Shout-minion buys; returns the resulting state. */
const drakkoAfterBuys = (n: number, doctor?: (s: RunState) => RunState): RunState => {
  let s = at('drakko', {
    embers: 40, hand: [], board: [],
    shop: shoutIds.slice(0, 5).map((cardId, i) => ({ uid: `q${i}`, cardId })),
  });
  for (let i = 0; i < n; i++) {
    if (doctor && i === n - 1) s = doctor(s); // sabotage hook: tamper just before the threshold buy
    s = reduce(s, { type: 'buy', uid: `q${i}` } as Act);
  }
  return s;
};

describe('count-threshold stagers', () => {
  it('Drakko (quest): the 5th Shout buy — not the 4th — grants Drakko the Drummer, once', () => {
    expect(drakkoAfterBuys(4).hand.some((c) => c.cardId === 'drummer'), 'not at 4').toBe(false);
    const s5 = drakkoAfterBuys(5);
    expect(s5.hand.filter((c) => c.cardId === 'drummer').length, 'exactly one at 5').toBe(1);
    expect(s5.heroPowerSpent, 'the quest is spent — it cannot pay twice').toBe(true);
  });

  it('Drakko: progress survives a save/restore mid-quest (serialize/deserialize round-trip)', () => {
    const s3 = drakkoAfterBuys(3);
    expect(s3.drakkoBuys).toBe(3);
    let s = deserialize(serialize(s3));
    expect(s.drakkoBuys, 'the counter rode the save').toBe(3);
    s = { ...s, embers: 40, shop: [{ uid: 'r0', cardId: shoutIds[5]! }, { uid: 'r1', cardId: shoutIds[6]! }] };
    s = reduce(s, { type: 'buy', uid: 'r0' } as Act);
    s = reduce(s, { type: 'buy', uid: 'r1' } as Act);
    expect(s.hand.some((c) => c.cardId === 'drummer'), 'buys 4+5 after the restore complete it').toBe(true);
  });

  it('Chronos (questChronos): the 4th End-of-Turn-minion buy grants Chronos', () => {
    // Four DISTINCT End-of-Turn minions, so no buy completes a triple mid-quest.
    const eotIds = Object.values(CARD_INDEX)
      .filter((c) => c && !c.spell && !c.token && !c.ruby && c.effects.some((e) => e.on === 'endOfTurn'))
      .map((c) => c.id);
    let s = at('chronoshero', {
      embers: 40, hand: [], board: [],
      shop: eotIds.slice(0, 4).map((cardId, i) => ({ uid: `q${i}`, cardId })),
    });
    for (let i = 0; i < 3; i++) s = reduce(s, { type: 'buy', uid: `q${i}` } as Act);
    expect(s.hand.some((c) => c.cardId === 'chronos'), 'not at 3').toBe(false);
    s = reduce(s, { type: 'buy', uid: 'q3' } as Act);
    expect(s.hand.some((c) => c.cardId === 'chronos'), 'the 4th pays').toBe(true);
    expect(s.heroPowerSpent).toBe(true);
  });

  it('Robin (sellGold): each sale banks 1 Gold that arrives with the next turn', () => {
    let s = at('robin', { board: [m('b0', 'pup'), m('b1', 'stray')], embers: 0 });
    s = reduce(s, { type: 'sell', uid: 'b0' } as Act);
    s = reduce(s, { type: 'sell', uid: 'b1' } as Act);
    expect(s.bonusEmbersNextTurn, 'two sales banked').toBe(2);
    // Differential against the same state with the bank zeroed: next turn opens exactly 2 Gold richer.
    const withBank = nextTurn(s);
    const without = nextTurn({ ...s, bonusEmbersNextTurn: 0 });
    expect(withBank.embers - without.embers).toBe(2);
    expect(withBank.bonusEmbersNextTurn ?? 0, 'the bank is spent, not recurring').toBe(0);
  });

  it('Pete (contraband): every 3rd refresh promotes the right-most offer a tier above the shop', () => {
    let s = at('pete', { embers: 30, tier: 2, refreshCount: 0 });
    s = reduce(s, { type: 'roll' } as Act);
    s = reduce(s, { type: 'roll' } as Act);
    expect(s.shop.some((o) => o.contraband), 'nothing on refreshes 1–2').toBe(false);
    s = reduce(s, { type: 'roll' } as Act);
    expect(s.refreshCount).toBe(3);
    const promoted = s.shop.find((o) => o.contraband);
    expect(promoted, 'the 3rd refresh promotes an offer').toBeTruthy();
    expect(CARD_INDEX[promoted!.cardId]!.tier, 'from the tier above the shop').toBe(3);
  });

  it('Pete: refresh progress carries across the turn boundary', () => {
    let s = at('pete', { embers: 30, tier: 2, refreshCount: 2 });
    s = nextTurn(s);
    s = reduce({ ...s, embers: 30 }, { type: 'roll' } as Act);
    expect(s.shop.some((o) => o.contraband), 'roll 3 still pays after a wave advance').toBe(true);
  });

  it('Ayse (luckySeat): shops seat Enchanted cards, and the 3rd Enchanted buy pays the queued suit', () => {
    // The passive half: an opening shop comes up Enchanted within a reasonable seed sweep — and only for Ayse.
    let sawEnchant = false;
    for (let seed = 1; seed <= 300 && !sawEnchant; seed++) {
      const s = createRun(seed, 'cia');
      if (s.shop.some((o) => o.enchanted) || s.spell?.enchanted) sawEnchant = true;
    }
    expect(sawEnchant, 'an Enchanted opening shop within 300 seeds').toBe(true);
    expect(createRun(1, 'indy').shop.some((o) => o.enchanted)).toBe(false);
    // The threshold half: 2 banked + an Enchanted buy = the payout (Clubs: 3 Gold) and a reset + new suit.
    const s = at('cia', {
      embers: 10, tier: 3, hand: [], board: [], ciaEnchantedBought: 2, ciaSuit: 'clubs',
      shop: [{ uid: 'sx', cardId: 'stray', enchanted: true }],
    });
    const after = reduce(s, { type: 'buy', uid: 'sx' } as Act);
    expect(after.ciaEnchantedBought, 'the counter reset on payout').toBe(0);
    expect(after.embers, 'bought for 3, paid 3 — the Clubs prize landed').toBe(10);
    expect(after.ciaSuit, 'a new suit is queued and never repeats').not.toBe('clubs');
  });
});

// ── shop-action-trigger ──────────────────────────────────────────────────────────────────────────────────

describe('shop-action-trigger stagers', () => {
  it('Emerald Warden (vanguard): a tier-up hands over a minion of the tier just reached', () => {
    const s = at('emeraldwarden', { embers: 20, tier: 1, upgradeCost: 5, hand: [] });
    const after = reduce(s, { type: 'upgrade' } as Act);
    expect(after.tier).toBe(2);
    expect(after.hand).toHaveLength(1);
    expect(CARD_INDEX[after.hand[0]!.cardId]!.tier, 'from the NEW tier').toBe(2);
  });

  it('Odelle (exhibition): a minion played between two others of three distinct types buffs all three', () => {
    const s = at('odelle', {
      embers: 20, cardsPlayedTotal: 0,
      board: [m('l', 'alley'), m('r', 'impoverseer')], // Beast … Demon
      hand: [m('mid', 'karwind')], // a Dragon lands between them
    });
    const after = reduce(s, { type: 'play', uid: 'mid', toIndex: 1 } as Act);
    for (const uid of ['l', 'mid', 'r']) {
      expect(after.board.find((c) => c.uid === uid)!.buffs?.some((b) => b.source === 'Exhibition'), `${uid} exhibited`).toBe(true);
    }
  });
});

// ── passive-pricing ──────────────────────────────────────────────────────────────────────────────────────

describe('passive-pricing stagers', () => {
  const buyCost = (heroId: string, cardId: string): number => {
    const s = at(heroId, { embers: 10, hand: [], shop: [{ uid: 'sx', cardId }] });
    return 10 - reduce(s, { type: 'buy', uid: 'sx' } as Act).embers;
  };

  it('Tradesman (cheapMinions): shop minions cost 2 Gold, and the tavern-up costs 2 more', () => {
    expect(buyCost('hermithank', 'pup')).toBe(2);
    expect(buyCost('warden', 'pup'), 'the control hero pays full price').toBeGreaterThan(2);
    const up = at('hermithank', { embers: 20, tier: 1, upgradeCost: 5 });
    expect(20 - reduce(up, { type: 'upgrade' } as Act).embers, 'the +2 surcharge').toBe(7);
  });

  it('Foreman Flint (companyRate): Dwarves cost 2 Gold — non-Dwarves do not', () => {
    const dwarf = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tribe === 'dwarf')!;
    expect(buyCost('flint', dwarf.id)).toBe(2);
    expect(buyCost('flint', 'pup'), 'a Beast pays full price').toBeGreaterThan(2);
  });
});

// ── turn-number ──────────────────────────────────────────────────────────────────────────────────────────

describe('turn-number stagers', () => {
  it('Runesmith (runeforge): the forge opens on the turn-5 advance — not before', () => {
    let s: RunState = { ...createRun(3, 'runesmith'), phase: 'recruit' };
    for (let w = s.wave; w < 4; w++) s = nextTurn(s);
    expect(s.runeforgeOffer, 'no forge before turn 5').toBeFalsy();
    s = nextTurn(s);
    expect(s.wave).toBe(5);
    expect(s.runeforgeOffer?.length, 'the forge is open with a real offer').toBeGreaterThanOrEqual(3);
    for (const id of s.runeforgeOffer!) expect(RUNE_INDEX[id], `${id} is a real rune`).toBeTruthy();
  });

  it('Runesmith: buying the offered rune applies it, spends the Gold once, and consumes the power', () => {
    let s: RunState = { ...createRun(3, 'runesmith'), phase: 'recruit' };
    for (let w = s.wave; w < 5; w++) s = nextTurn(s);
    s = { ...s, embers: 20 };
    const runeId = s.runeforgeOffer![0]!;
    const cost = Math.max(0, RUNE_INDEX[runeId]!.cost - (s.runeforgeDiscounts?.[0] ?? 0));
    const after = reduce(s, { type: 'buyRune', index: 0 } as Act);
    expect(after.ownedRunes).toContain(runeId);
    expect(after.embers, 'the rune cost is paid exactly once').toBe(20 - cost);
    expect(after.heroPowerSpent, 'the once-per-game forge is consumed').toBe(true);
    expect(after.runeforgeOffer, 'the forge closed').toBeFalsy();
  });

  it('Guardian (epicRuneforge): scheduled at run start for turn 8, and the EPIC forge opens on that advance', () => {
    // Jump to the eve of the schedule rather than advancing through waves 5–6, whose universal quest offer /
    // basic forge would hold the modal slot and defer the epic open past the wave under test.
    const s0: RunState = { ...createRun(3, 'runeguard'), phase: 'recruit' };
    expect(s0.epicForgeWave, 'the schedule is written at createRun').toBe(8);
    let s: RunState = { ...s0, wave: 7 };
    expect(s.runeforgeEpic ?? false, 'no epic forge before turn 8').toBe(false);
    s = nextTurn(s);
    expect(s.wave).toBe(8);
    expect(s.runeforgeOffer, 'the epic forge is open').toBeTruthy();
    expect(s.runeforgeEpic, 'and it is the EPIC forge').toBe(true);
    expect(s.epicForgeWave, 'the schedule is consumed').toBeUndefined();
  });
});

// ── combat-trigger ───────────────────────────────────────────────────────────────────────────────────────

describe('combat-trigger stagers', () => {
  it('Emissary (unitedFront): Start of Combat pays +N/+N where N is the spells cast this game', () => {
    const s = at('vale', {
      wave: 6, spellsCast: 3, spellsThisTurn: 0,
      board: [m('b0', 'alley'), m('b1', 'impoverseer')],
    });
    const after = reduce(s, { type: 'faceOmen' } as Act);
    const banner = after.lastCombat!.events.filter((e) => e.type === 'buff' && (e as { attack?: number }).attack === 3 && (e as { health?: number }).health === 3);
    expect(banner.length, 'the +3/+3 banner landed in the combat log').toBeGreaterThan(0);
  });

  it('Flash (firstOrLast): the pick arms through the real action, the claim lands from the real fight, then the mark is spent', () => {
    const s = at('flash', {
      wave: 3, embers: 10, hand: [],
      board: Array.from({ length: 7 }, (_, i) => m(`b${i}`, 'pup', { attack: 40, health: 400 })),
    });
    const armed = reduce(s, { type: 'heroPower', flashPick: 'first' } as Act);
    expect(armed.flashPick).toBe('first');
    expect(armed.embers, 'the 1-Gold cost is paid once').toBe(9);
    expect(armed.heroReady).toBe(false);
    let fought = reduce(armed, { type: 'faceOmen' } as Act);
    fought = reduce(fought, { type: 'settleCombat' } as Act);
    const enemyIds = new Set(fought.lastCombat!.initial.enemy.map((e) => e.cardId));
    expect(fought.hand.length, 'the first kill was claimed to hand').toBeGreaterThan(0);
    expect(fought.hand.some((c) => enemyIds.has(c.cardId)), 'a copy of an enemy that fought is in hand').toBe(true);
    expect(reduce(fought, { type: 'resolveCombat' } as Act).flashPick, 'the mark is spent with the fight').toBeUndefined();
  });
});

// ── modal-choice ─────────────────────────────────────────────────────────────────────────────────────────

describe('modal-choice stagers', () => {
  it('Cassen (commission): the picked job is accepted, matures on schedule, and pays out', () => {
    const s = at('cassen', { wave: 3, embers: 5, hand: [], tier: 2 });
    const offered = commissionOffer(s);
    expect(offered.length, 'three jobs on offer').toBeGreaterThan(0);
    const pick = offered.includes('gold' as never) ? 'gold' : offered[0]!;
    let run = reduce(s, { type: 'heroPower', commission: pick } as Act);
    expect(run.commission?.kind).toBe(pick);
    const due = 3 + COMMISSION_DELAY[pick as keyof typeof COMMISSION_DELAY];
    expect(run.commission?.dueWave).toBe(due);
    // A pick outside the offer is refused (the choice is validated against commissionOffer).
    expect(reduce(s, { type: 'heroPower', commission: 'not-a-job' } as unknown as Act)).toBe(s);
    const before = { embers: 0, tier: 0, hand: 0, modal: false };
    while (run.wave < due) {
      before.embers = run.embers; before.tier = run.tier; before.hand = run.hand.length;
      before.modal = !!(run.discover || run.discoverQueue?.length);
      run = nextTurn(run);
    }
    expect(run.commission, 'the job is done').toBeUndefined();
    const paid = run.embers > before.embers || run.tier > before.tier || run.hand.length > before.hand
      || !!(run.discover || run.discoverQueue?.length);
    expect(paid, `the '${pick}' payout is non-empty`).toBe(true);
  });
});

// ── active-conditional ───────────────────────────────────────────────────────────────────────────────────

describe('active-conditional stagers', () => {
  it('Gildmaster (gildcrafter): with exactly 2 copies held, the power completes the Gild — and refuses without a pair', () => {
    const s = at('gildmaster', { embers: 10, hand: [], board: [m('p1', 'pup'), m('p2', 'pup')] });
    const after = reduce(s, { type: 'heroPower' } as Act);
    expect([...after.board, ...after.hand].some((c) => c.cardId === 'pup' && c.golden), 'the trio merged Gilded').toBe(true);
    expect(after.embers, 'the 3-Gold cost is paid exactly once').toBe(7);
    expect(after.heroPowerUses, 'one of the 3-per-game charges is spent').toBe(1);
    // No pair → a full no-op: no charge, no Gold.
    const single = at('gildmaster', { embers: 10, hand: [], board: [m('p1', 'pup')] });
    expect(reduce(single, { type: 'heroPower' } as Act)).toBe(single);
  });

  it('Underdweller (soulkeeper): Discovers among what died last combat; refuses (charge intact) when unaffordable', () => {
    const fallen = {
      ...win(),
      initial: { player: [m('p1', 'stray'), m('p2', 'alley')].map((c) => ({ ...c, name: c.cardId })), enemy: [] },
      events: [{ type: 'death', target: 'p1', side: 'player' }, { type: 'death', target: 'p2', side: 'player' }],
    };
    const s = at('underdweller', { embers: 10, hand: [], lastCombat: fallen as never });
    const after = reduce(s, { type: 'heroPower' } as Act);
    expect(new Set(after.discover), 'exactly the dead').toEqual(new Set(['stray', 'alley']));
    expect(after.embers, 'the 2-Gold cost paid once').toBe(8);
    const broke = at('underdweller', { embers: 1, hand: [], lastCombat: fallen as never });
    expect(reduce(broke, { type: 'heroPower' } as Act), 'unaffordable → refused outright').toBe(broke);
  });

  it("Membrance (memory): restocks the Shop with plain copies of the last opponent's board", () => {
    const foe = { ...win(), initial: { player: [], enemy: [m('e1', 'pup'), m('e2', 'alley', { attack: 9, health: 9, golden: true })] } };
    const s = at('membrance', { embers: 10, lastCombat: foe as never, shop: [{ uid: 'old', cardId: 'stray' }] });
    const after = reduce(s, { type: 'heroPower' } as Act);
    expect(after.shop.map((o) => o.cardId)).toEqual(['pup', 'alley']);
    expect(after.shop.some((o) => o.golden), 'PLAIN copies — the shell, not the statted body').toBe(false);
    expect(after.embers, 'the 1-Gold cost paid once').toBe(9);
    // No fight yet → refused, no charge.
    const fresh = at('membrance', { embers: 10, lastCombat: undefined });
    expect(reduce(fresh, { type: 'heroPower' } as Act)).toBe(fresh);
  });
});

// ── adopted-secondary ────────────────────────────────────────────────────────────────────────────────────

describe('adopted-secondary stagers', () => {
  it('Mimic: the run opens on a 2-option power Discover, and a fresh one is minted every turn', () => {
    const s0 = createRun(7, 'mimic');
    expect(s0.powerOffer?.slot).toBe('mimic');
    expect(s0.powerOffer?.heroIds).toHaveLength(2);
    let s = reduce(s0, { type: 'pickPower', index: 0 } as Act);
    expect(s.adoptedPowerId, 'the pick is adopted').toBe(s0.powerOffer!.heroIds[0]);
    expect(s.heroReady, 'a fresh disguise arrives charged').toBe(true);
    s = nextTurn(s);
    expect(s.powerOffer?.slot, 'the next turn re-offers').toBe('mimic');
  });

  it('an adopted ACTIVE power routes through the same implementation (heroPower on the disguise acts)', () => {
    const s0: RunState = { ...createRun(7, 'mimic'), phase: 'recruit', powerOffer: { heroIds: ['nadja'], slot: 'mimic' }, embers: 10 } as RunState;
    let s = reduce(s0, { type: 'pickPower', index: 0 } as Act);
    s = reduce(s, { type: 'heroPower' } as Act);
    expect(s.maxGoldBonus, "Nadja's Goldspring fired through the disguise").toBe(1);
    expect(s.embers, 'and charged her 3 Gold').toBe(7);
  });

  it('an adopted PASSIVE power routes through the same rule sites (Midas: Gild at 2)', () => {
    const s0: RunState = { ...createRun(7, 'mimic'), phase: 'recruit', powerOffer: { heroIds: ['midas'], slot: 'mimic' } } as RunState;
    const s = reduce(s0, { type: 'pickPower', index: 0 } as Act);
    expect(gildCopiesNeeded(s), 'the wielded power is the rule, not the portrait').toBe(2);
    expect(gildCopiesNeeded(createRun(7, 'mimic')), 'undisguised Mimic Gilds at 3').toBe(3);
  });
});

// ── SABOTAGE (§3.5) ──────────────────────────────────────────────────────────────────────────────────────

describe('sabotage: the lane alarms when a threshold silently breaks', () => {
  it("neutering Drakko's counter in-memory makes the 5-buy stager's oracle fail for the intended reason", () => {
    // Bug shape: a refactor drops accrued progress (the counter resets on some unrelated path). Reintroduced
    // here by zeroing `drakkoBuys` just before the threshold buy — the 5th buy is now the 1st.
    const sabotaged = drakkoAfterBuys(5, (s) => ({ ...s, drakkoBuys: 0 }));
    expect(sabotaged.hand.some((c) => c.cardId === 'drummer'),
      'the doctored run must NOT pay — which is exactly the assertion the real stager would trip on').toBe(false);
    expect(sabotaged.heroPowerSpent ?? false, 'nor mark the quest complete').toBe(false);
    // …and the undoctored run still pays, so the alarm is the sabotage, not the fixture.
    expect(drakkoAfterBuys(5).hand.some((c) => c.cardId === 'drummer')).toBe(true);
  });
});
