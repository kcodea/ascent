import { ALE_IDS, alignAllows, makeRng, SILENT_ONPLAY, COMBAT_REPLAYABLE_BATTLECRIES, extraTriggerFires, foldEchoExtraFires, socTwilightExtraFires, ARENA_EFFECTS, beatIdentity, type EffectArena, type PresentationCollector, type PresentationPhase, type PresentationPolicy, type Rng, type CardDef, type EffectDef, type Keyword, type TriggerFamily, type TriggerSourceRef, type Tribe } from '@game/core';
import { CARD_INDEX, EQUIPMENT_INDEX, recurringEotOwner, type EquipmentDefinition } from '@game/content';
import { equipIsNews, equipmentParams as equipmentParamsFor, grantEquipment as grantEquipmentToPlayer } from './equipment';
import { currentCollector } from './activeCollector';
import { alignmentOf } from './alignment';
import { lobbyOpponentBoard } from './lobby/runLobby';
import { poolOf } from './cardPool';
import { CONFIG, hasTier7Access, maxTierFor, SHIFTER_OPTIONS } from './config';
import { getHero, spellAmplifyBonus, hasPower, activePowers, primaryPower, powerDiscoverPool } from './heroes';
import { handCap, reservedHandSlots, mixSeed, TAG, type AuraFxTribe, type BoardCard, type BuffFxEvent, type CiaSuit, type CommissionKind, type DiscoverSpec, type EquipFx, type RunState, type ShopCard, type ShopDeathFx, gateUses, procRune, procRuneId, runeBuffMagnitude } from './state';
export { ALE_IDS };
import { returnToPool, rollShop, rollSpellShop, takeFromPool, refillShopFiltered, elevateShop } from './shop';
import { runeStacksOf } from './runeDup';

/**
 * The recruit-phase half of the effect system (handoff C.5), split across the
 * Battlegrounds buy → hand → play flow:
 *   buy  → card enters the hand; buy-triggers fire (Brightwing Broker)  → `applyOnBuy`
 *   play → card enters the board; summon-buffs fire (Kennelmaster /
 *          Bristleback Matron), then the card's own Battlecry             → `playCard`
 * Results bake straight into the board's stats, so by the time the player faces
 * the Omen each minion is a resolved stat block — combat then only deals with the
 * combat keywords (A.3).
 *
 * Same `EffectDef` data, two execution surfaces: `buffOnSummon` lives here (for
 * recruit summons) AND in `@game/core` (for combat summons like Deathrattles).
 */

interface RecruitContext {
  state: RunState;
  summon(card: CardDef, nearUid: string): BoardCard | undefined;
  /** BEAT SYSTEM (PR 3): the presentation collector for this resolution (NOOP outside a capture scope). */
  collector: PresentationCollector;
}

type RecruitFn = (
  ctx: RecruitContext,
  self: BoardCard,
  params: Record<string, unknown>,
  /** `proc` is the repeat index of this End-of-Turn trigger (0-based; Chronos drives extras) — used
   *  to vary a per-proc random selection (Combinator) so each weld picks fresh Mechs. `target` is the
   *  player-chosen friendly minion for a targeted Battlecry (Toxin Tender); absent = auto-pick. `replay`
   *  marks a Djinn-driven extra End-of-Turn (it must not advance a cadence counter — see Frontdrake). */
  payload: { minion: BoardCard; proc?: number; target?: BoardCard; replay?: boolean; rubyAttack?: number; rubyHealth?: number; spellDef?: CardDef; spellId?: string; /** `onGainCard`: WHICH card just arrived in hand — Kegheart Dwarf filters on it being a Dwarven Ale. The
  *  event used to carry only "a card arrived", which no watcher could filter. */ cardId?: string; /** CELESTIAL orbitFired: the minion whose Orbit resolved (Orrery excludes its own). */ source?: BoardCard; /** CELESTIAL: this Orbit was TRIGGERED (Astral Relay), not caused by a card arriving — so `minion` is
  *  a stand-in and any effect that consumes the arriver must stand down. */ noArriver?: boolean },
) => void;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);

/** Celestial by TRIBE (set 3 onward) or by the legacy `celestial` flag (the 2026-08-03 test units). */
const isCelestialCard = (c: BoardCard): boolean => {
  const d = CARD_INDEX[c.cardId];
  return !!d && (d.tribe === 'celestial' || d.celestial === true);
};

/** The shop-side `EffectArena` adapter (Step 1 spike). `BoardCard` satisfies `ArenaBody` structurally and
 *  passes through unwrapped. `rng()` wraps the run's cursor with per-call write-back: mulberry32's state
 *  round-trips exactly, so create→draw→store per call is the SAME stream as one long-lived instance — the
 *  legacy bodies' draw sequences are preserved bit-for-bit (the Step-1 hash probe is the proof). */
function shopArena(state: RunState, self: BoardCard): EffectArena {
  const cursorRng: Rng = {
    next: () => { const r = makeRng(state.rngCursor); const v = r.next(); state.rngCursor = r.state(); return v; },
    int: (maxExclusive) => { const r = makeRng(state.rngCursor); const v = r.int(maxExclusive); state.rngCursor = r.state(); return v; },
    pick: (xs) => xs[cursorRng.int(xs.length)] as never,
    fork: () => makeRng((cursorRng.next() * 4294967296) >>> 0),
    state: () => state.rngCursor,
  };
  return {
    phase: 'shop',
    self,
    friends: () => [...state.board], // a COPY — bodies may splice their pool without touching the board
    hasShield: (t) => t.keywords.includes('DS'),
    grantShield: (t) => { const c = t as BoardCard; c.keywords = [...c.keywords, 'DS']; },
    buff: (t, a, h) => addBuff(t as BoardCard, nameOf(self), a, h),
    buffPermanent: (t, a, h) => addBuff(t as BoardCard, nameOf(self), a, h), // a shop buff IS permanent
    rubyTallyOf: (t) => {
      const ruby = (t as BoardCard).buffs?.find((b) => b.source === 'Ruby');
      return { attack: ruby?.attack ?? 0, health: ruby?.health ?? 0 };
    },
    summonToken: (id, opts) => {
      const token = CARD_INDEX[id];
      if (!token) return undefined;
      const before = state.board.length;
      const made0 = makeContext(state).summon(token, self.uid);
      if (state.board.length === before) return undefined; // board full
      const made = made0 ?? state.board[state.board.length - 1];
      if (!made) return undefined;
      if (opts?.keyword && !made.keywords.includes(opts.keyword as Keyword)) made.keywords = [...made.keywords, opts.keyword as Keyword];
      if (opts?.keywords) for (const k of opts.keywords) { if (!made.keywords.includes(k as Keyword)) made.keywords = [...made.keywords, k as Keyword]; }
      if (opts?.golden && !made.golden) { made.golden = true; made.attack *= 2; made.health *= 2; } // gilded token: doubled base + the flag
      // Explicit stats. `rubyLabel` (Gemheart): the above-base share is a RUBY buff + watcher notify — the
      // legacy shop bookkeeping, so a Resonance Idol bounces and the breakdown attributes. Otherwise the
      // stats apply DIRECTLY (the Smith's inherited Attack is the body's value, not a buff entry).
      if (opts?.attack !== undefined && opts.health !== undefined) {
        if (opts.rubyLabel) {
          const ea = opts.attack - made.attack, eh = opts.health - made.health;
          if (ea > 0 || eh > 0) { addBuff(made, 'Ruby', ea, eh); fireOnRubyPlayed(state, made, ea, eh); }
        } else {
          made.attack = opts.attack; made.health = opts.health;
        }
      }
      return made;
    },
    playRubiesOn: (t, per) => {
      const rb = rubyStatBonus(state);
      const a = (1 + rb.attack) * per, h = (1 + rb.health) * per;
      if (a > 0 || h > 0) { addBuff(t as BoardCard, 'Ruby', a, h); fireOnRubyPlayed(state, t as BoardCard, a, h); }
    },
    hasReborn: (t) => t.keywords.includes('R'),
    grantReborn: (t) => { const c = t as BoardCard; c.keywords = [...c.keywords, 'R']; },
    grantKeywordTo: (t, kw) => { const c = t as BoardCard; c.keywords = [...c.keywords, kw as Keyword]; },
    grantSpellPower: (a, h) => {
      state.spellBonus ??= { attack: 0, health: 0 };
      state.spellBonus.attack += a;
      state.spellBonus.health += h;
    },
    targetTribe: () => CARD_INDEX[self.cardId]?.targetTribe,
    isTribe: (t, tribe) => isTribe(t as BoardCard, tribe as Tribe),
    gainRubyStats: (t, a, h) => addBuff(t as BoardCard, 'Ruby', a, h), // NO fireOnRubyPlayed - the no-rebounce guard
    neighboursOf: (t) => {
      const idx = state.board.findIndex((c) => c.uid === t.uid);
      if (idx < 0) return [];
      return [state.board[idx - 1], state.board[idx + 1]].filter((c): c is BoardCard => !!c);
    },
    grantMaxGold: (amount) => { state.maxEmbers += amount; },
    isCelestial: (t) => !!CARD_INDEX[t.cardId]?.celestial,
    isImp: (t) => !!CARD_INDEX[t.cardId]?.imp,
    isFodder: (t) => !!CARD_INDEX[t.cardId]?.keywords.includes('FD'),
    impAura: () => state.impBuff ?? { attack: 0, health: 0 },
    conductorTally: () => state.conductorBuff ?? 0,
    deathrattleTally: () => state.deathrattlesTriggered ?? 0,
    addTribeAura: () => {}, // no rest-of-combat in a shop; the legacy shop half never registered one
    grantCardTypeBuff: (cardId, a, h) => buffCardTypeRunWide(state, cardId, a, h, CARD_INDEX[cardId]?.name ?? cardId),
    grantUndeadAttackAura: (a) => buffUndeadAttackEverywhere(state, a, nameOf(self)),
    grantMagneticAura: (a, h) => {
      for (const card of [...state.board, ...state.hand]) {
        if (card.keywords.includes('M')) addBuff(card, nameOf(self), a, h);
      }
      state.magneticBuyAtk = (state.magneticBuyAtk ?? 0) + a;
      state.magneticBuyHp = (state.magneticBuyHp ?? 0) + h;
    },
    grantBeastExtra: (hunt, ritual) => {
      if (hunt) state.beastHuntExtra = (state.beastHuntExtra ?? 0) + hunt;
      if (ritual) state.beastRitualExtra = (state.beastRitualExtra ?? 0) + ritual;
    },
    tribesOf: (t) => {
      const def = CARD_INDEX[t.cardId];
      return [def?.tribe, def?.tribe2].filter((x): x is Tribe => !!x && x !== 'neutral');
    },
    isUniversalTribe: (t) => !!CARD_INDEX[t.cardId]?.universalTribe,
    improveReps: () => improveReps(state),
    matriarchReps: () => 1, // the legacy shop halves never applied Matriarch; preserved until ruled otherwise
    logSpellProgress: () => {}, // the live countdown re-derives from the instance field in the shop
    logImprove: () => {},
    spellsThisTurn: () => state.spellsThisTurn,
    grantNamedCard: (cardId, count) => {
      const def = CARD_INDEX[cardId];
      if (def) conjureToHand(state, [def], count);
    },
    grantRandomSpells: (count, exactTier) => {
      const ok = exactTier != null
        ? (c: CardDef) => c.tier === exactTier
        : (c: CardDef) => c.tier <= state.tier;
      conjureToHand(state, poolOf(state).spells.filter(ok), count);
    },
    grantRandomFromPool: (pred, count) => {
      // The FULL pool (buyable + spells): Ales are spells, Attachments are minions — the predicate decides.
      const pool = [...poolOf(state).buyable, ...poolOf(state).spells].filter(pred);
      if (pool.length === 0) return;
      conjureToHand(state, pool, count);
    },


    grantImpAura: (a, h) => buffImpsRunWide(state, a, h, nameOf(self)),
    grantFodderAura: (a, h) => buffFodderRunWide(state, a, h, nameOf(self)),
    applyBaneDemonWiden: () => {
      const dem = state.baneBuffsDemons;
      if (!dem || (dem.attack === 0 && dem.health === 0)) return;
      for (const c of [...state.board, ...state.hand]) {
        if (isTribe(c, 'demon')) addBuff(c, `${nameOf(self)} (Demons)`, dem.attack, dem.health);
      }
    },
    stripEchoes: (t) => { (t as BoardCard).echoStripped = true; },
    nameOf: (t) => CARD_INDEX[t.cardId]?.name ?? t.cardId,
    narrate: () => {}, // the shop has FX, not narration
    activeTribes: () => state.tribes,
    castTribeAttackSpell: (_tribe, _amount, spellId) => {
      // The shop casts the ACTUAL card through its full pipeline: `spellGrantTribeAttack` applies the
      // permanent aura (tribe + amount come from the spell's own params — the single source of truth), and
      // `noteSpellCast` runs every per-spell watcher. The Echo's own params are the combat half's concern.
      const def = CARD_INDEX[spellId];
      if (def) castSpell(state, def);
    },
    damageAll: (amount) => {
      // The shop has no enemy: YOUR board takes it (owner ruling 2026-08-04). A body taken to 0 dies here
      // too — removed, its own Echo firing, the same cascade combat runs.
      for (const c of [...state.board]) c.health -= amount;
      const dead = state.board.filter((c) => c.health <= 0);
      for (const d of dead) {
        const idx = state.board.indexOf(d);
        if (idx >= 0) state.board.splice(idx, 1);
      }
      for (const d of dead) fireRecruitDeathrattles(makeContext(state), d);
    },
    stampKarwindFlash: (t) => {
      const flash = (state.karwindFlash ??= []);
      if (!flash.includes(t.uid)) flash.push(t.uid);
    },
    grantRubyPower: (a, h) => {
      // The rubyStatGain core WITHOUT its golden multiplier (the body already applied it): raise the run's
      // Ruby power and keep Rubies already in hand current — the legacy shop bookkeeping, verbatim.
      const b = state.rubyBonus ?? { attack: 0, health: 0 };
      state.rubyBonus = { attack: b.attack + a, health: b.health + h };
      for (const card of state.hand) {
        if (CARD_INDEX[card.cardId]?.ruby) { card.attack += a; card.health += h; }
      }
    },

    // ── RALLY FAMILY verbs (Step 3 item 4) ──────────────────────────────────────────────────────────────
    //
    // The shop has no enemies and nobody is being hit, so the two enemy-facing Rallies fall out of their own
    // "nothing to target" guard: `enemies()` is empty and the dispatcher supplies no `params.target`. That is
    // the whole no-op mechanism — no body asks what phase it is in, and neither verb below is reachable.
    enemies: () => [],
    damage: () => {}, // unreachable: only ever applied to a body from `enemies()`, which is empty here
    stripKeyword: (t, kw) => { const c = t as BoardCard; c.keywords = c.keywords.filter((k) => k !== kw); },
    spellPower: () => ({ attack: spellAttackBonus(state), health: spellHealthBonus(state) }),
    castRepeat: (spellId, body) => {
      // The shop's cast ritual: one GENUINE cast per repetition, each counted through `noteSpellCast` so every
      // per-spell watcher (Guel, Groveweaver, the spell runes, the quest tallies) sees it — the same contract
      // `castInCombat` gives the combat half. Golden = two real casts, never one doubled cast.
      const def = spellId ? CARD_INDEX[spellId] : undefined;
      for (let i = 0; i < (self.golden ? 2 : 1); i++) {
        if (def) noteSpellCast(state, def);
        body();
      }
    },
    castNamedSpell: (spellId) => {
      const def = spellId ? CARD_INDEX[spellId] : undefined;
      if (!def?.spell) return;
      for (let i = 0; i < (self.golden ? 2 : 1); i++) castSpell(state, def); // the full shop cast pipeline
    },
    cardDef: (id) => CARD_INDEX[id],
    gainShopBuff: (a, h) => { state.tavernBuyBonus.atk += a; state.tavernBuyBonus.hp += h; },
    grantUndeadAura: (a, h) => {
      // The Lantern channel. In the shop this run-wide aura is folded into every Undead's displayed stats
      // already, so raising it IS the whole grant — a board loop on top would double-apply it.
      state.undeadAttackBonus += a;
      state.undeadHealthBonus += h;
    },
    grantRubies: (count) => { mintRubies(state, count); },
    grantRandomShoutMinion: (count) => {
      const pool = poolOf(state).buyable.filter((c) => c.tier <= state.tier && c.effects.some((e) => e.on === 'onPlay'));
      conjureToHand(state, pool, count);
    },
    hasEffect: (t, on, doId) => instanceEffects(t as BoardCard).some((e) => e.on === on && (!doId || e.do === doId)),
    replayShout: (t) => { replayBattlecry(state, t as BoardCard); },
    hasEcho: (t, strict) => instanceEffects(t as BoardCard)
      .some((e) => e.on === 'onDeath' && (!strict || e.do.startsWith('deathrattle'))),
    triggerEchoOn: (t, strict) => {
      // `fireRecruitDeathrattles` is the shop's whole Echo ritual: it applies Sylus/Uron's extra fires and the
      // `deathrattlesTriggered` tally itself, so the body only says "fire it, once per gild".
      const c = t as BoardCard;
      const override = strict
        ? instanceEffects(c).filter((e) => e.on === 'onDeath' && e.do.startsWith('deathrattle'))
        : undefined;
      if (strict && (!override || override.length === 0)) return;
      const ctx = makeContext(state);
      for (let i = 0; i < (self.golden ? 2 : 1); i++) fireRecruitDeathrattles(ctx, c, override);
    },
    graftEffect: (t, effect) => {
      const c = t as BoardCard;
      (c.grantedEffects ??= []).push(effect);
    },
    improveAttachments: (a, h) => {
      for (const card of [...state.board, ...state.hand]) {
        if (card.keywords.includes('M')) addBuff(card, nameOf(self), a, h);
      }
      state.magneticBuyAtk = (state.magneticBuyAtk ?? 0) + a;
      state.magneticBuyHp = (state.magneticBuyHp ?? 0) + h;
    },

    // ── START-OF-COMBAT FAMILY verbs (Step 3 item 4) ────────────────────────────────────────────────────
    //
    // The combat-only concepts no-op HERE, on the verb, never inside a body — the `addTribeAura` class.
    // Each no-op leaves the trigger's diff empty, so the dispatcher's `discardIfEmpty` drops the beat.
    armBleed: () => {}, // a mark on enemies that don't exist, ticked by attacks that won't happen
    grantSpellCastExtra: () => {}, // a combat-cast channel; the real Start of Combat re-arms it moments later
    fodderConsumed: () => state.fodderConsumedThisTurn ?? { attack: 0, health: 0 },
    alesLastTurn: () => state.alesCastThisTurn ?? 0,
    engraveNeighbours: () => {}, // Engrave = "keep your combat gains"; every shop gain is already permanent
    engraveBoard: () => {},
    castLeftmostHandSpellOnAdjacent: (tribe) => {
      // Quil's shop half: cast the leftmost hand Shop Spell on the adjacent `tribe` neighbours — the STAT
      // family of the combat resolver, mirrored (buffs + spell power), each repetition a REAL counted cast
      // through `noteSpellCast` so Guel / Spirit Pup / the spell runes all see it. Anything outside the stat
      // family is pure tavern work from this body's seat and fizzles WITHOUT counting, exactly as the combat
      // ruling has it. The hand card is not consumed in either phase.
      const handSpell = state.hand.find((c) => CARD_INDEX[c.cardId]?.spell);
      const def = handSpell ? CARD_INDEX[handSpell.cardId] : undefined;
      if (!def?.spell) return;
      const i = state.board.findIndex((c) => c.uid === self.uid);
      if (i < 0) return;
      const targets = [state.board[i - 1], state.board[i + 1]]
        .filter((m): m is BoardCard => !!m && isTribe(m, tribe as Tribe));
      if (targets.length === 0) return;
      const eff = def.effects.find((e) => e.on === 'cast' && (e.do === 'spellBuffTarget' || e.do === 'spellBuffAll'));
      if (!eff) return;
      const growthPlus = def.id === 'growth' ? (state.growthBonus ?? 0) : 0; // Rune of Living Growth, as combat folds it
      for (let rep = 0; rep < (self.golden ? 2 : 1); rep++) {
        noteSpellCast(state, def);
        const a = num(eff.params?.attack, 0) + growthPlus + spellAttackBonus(state);
        const h = num(eff.params?.health, 0) + growthPlus + spellHealthBonus(state);
        const recipients = eff.do === 'spellBuffAll' ? state.board : targets;
        for (const t of recipients) addBuff(t, def.name, a, h);
      }
    },
    echoEffectsOf: (t) => instanceEffects(t as BoardCard)
      .filter((e) => e.on === 'onDeath')
      .map((e) => ({ ...e, ...(e.params ? { params: { ...e.params } } : {}) })),

    rng: () => cursorRng,
  };
}

/** Every effect a BOARD INSTANCE carries: its printed def, a Gravetwin's copied Echo, and anything GRAFTED
 *  onto this body at runtime (Sunmane Herald's spreading Rally). The shop's answer to combat's per-instance
 *  `Minion.effects` list — read by the arena's `hasEffect`/`hasEcho` and by the recruit Rally dispatcher, so a
 *  grafted trigger is as real in the shop as a printed one. */
export function instanceEffects(card: BoardCard): EffectDef[] {
  const printed = CARD_INDEX[card.cardId]?.effects ?? [];
  if (!card.copiedEcho?.length && !card.grantedEffects?.length) return [...printed];
  return [...printed, ...(card.copiedEcho ?? []), ...(card.grantedEffects ?? [])];
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Tripled minions bake their recruit buffs in at doubled magnitude. */
// `c` is optional: an UNTARGETED spell cast (Safety Deposit Box) routes through the cast-effect dispatch
// with no `self` minion, so a factory it reuses (battlecryBonusGoldNextTurn) calls gold(undefined) — a
// spell is never golden, so that's ×1. (Every minion caller passes a real card, unchanged.)
const gold = (c?: BoardCard): number => (c?.golden ? 2 : 1);
/** A card's display name (the buff-source label in the inspect breakdown). */
const nameOf = (card: BoardCard): string => CARD_INDEX[card.cardId]?.name ?? card.cardId;

/**
 * Apply a recruit-phase stat buff to a card AND record its source for the inspect-panel breakdown
 * ("Spirit Fire ×2: +6/+6"). Pass `count` (default 1) for how many times the source applied. Pure
 * keyword grants (0/0) mutate nothing here and aren't listed. Base stats are never recorded.
 */
/** How many times an "Improve" step applies — 2 under Rune of Mastery, else 1. Every recruit-phase
 *  Improve-text site multiplies its improvement increment by this. */
export function improveReps(state: RunState): number {
  // +1 extra Improve step per Mastery copy held (repeat family, owner 2026-08-27) — 2 with one copy, 3 with two.
  return state.runeMastery ? 1 + runeStacksOf(state, 'rune_mastery') : 1;
}

/** Module-level mirror of `improveReps` for the ONE Improve site with no state in scope (Sergeant's
 *  hpGrant bump inside `addBuff`). Stamped from the current state at every reducer entry + projection
 *  entry — deterministic (purely state-derived), defaulting to 1 for direct/test callers. */
let IMPROVE_REPS = 1;
export function stampImproveReps(state: RunState): void {
  IMPROVE_REPS = improveReps(state);
}

/**
 * Sable (Soulbind): the bond in force for THIS dispatch, mirrored onto the stateless `addBuff` hook exactly
 * like `IMPROVE_REPS` above. Holds the live board array so the partner body can be found by uid.
 *
 * `mirroring` is the re-entrancy guard and it is load-bearing: the mirrored grant is itself an `addBuff`, so
 * without it A→B→A→B recurses forever. One hop, no echo (owner ruling 2026-08-16).
 */
let SABLE: { a: string; b: string; board: BoardCard[] } | null = null;
let SABLE_MIRRORING = false;
export function stampSableBond(state: RunState): void {
  const bond = state.sableBond;
  SABLE = bond && bond.wave === state.wave ? { a: bond.a, b: bond.b, board: state.board } : null;
  SABLE_MIRRORING = false;
}

/**
 * RUNE OF SHARED SPOILS (2026-08-20): "whenever your LEFT-MOST Dwarf gains stats, give your RIGHT-MOST Dwarf
 * the same stats." Stamped exactly like Sable's bond above, and for the same reason: `addBuff` is the ONE
 * chokepoint every recruit-phase stat gain passes through, and it has no state in scope. Wiring the rune into
 * the dozen sites that grant stats instead would guarantee missing one.
 *
 * Which body is left/right-most is resolved AT THE GAIN, not stamped, so re-ordering the board mid-action is
 * honoured. `MIRRORING` is the same one-hop guard — the mirrored grant re-enters `addBuff`.
 */
/** SHOP RISE (owner ruling 2026-08-28): uids currently being destroyed that are coming straight back. The
 *  beat collector's departure diff reads this to flag their `cardDestroyed` with `rise`, so the UI plays the
 *  death without treating the slot as freed. A module-local rather than run state on purpose: it must never
 *  serialize, and it must not exist differently depending on whether presentation capture is on — which is
 *  exactly what a RunState field cleared inside a capture-only code path would have done. */
let RISING: Set<string> | null = null;

let SPOILS: { board: BoardCard[]; mult: number } | null = null;
let SPOILS_MIRRORING = false;
export function stampSharedSpoils(state: RunState): void {
  // `mult` = copies held: a duplicate mirrors the gain once per copy (recurring family, owner 2026-08-27).
  SPOILS = state.runeSharedSpoils ? { board: state.board, mult: runeStacksOf(state, 'rune_shared_spoils') } : null;
  SPOILS_MIRRORING = false;
}

export function addBuff(card: BoardCard, source: string, attack: number, health: number, count = 1): void {
  card.attack = Math.max(0, card.attack + attack); // Attack never drops below 0
  card.health += health;
  // Sable's bond: a stat gain on one end is gained by the other, in full. Guarded against the obvious
  // infinite regress — the mirrored call re-enters here — and skipped for a 0/0 buff (a pure counter bump).
  if (SABLE && !SABLE_MIRRORING && (attack !== 0 || health !== 0)) {
    const partnerUid = card.uid === SABLE.a ? SABLE.b : card.uid === SABLE.b ? SABLE.a : undefined;
    const partner = partnerUid ? SABLE.board.find((c) => c.uid === partnerUid) : undefined;
    if (partner) {
      SABLE_MIRRORING = true;
      try { addBuff(partner, 'Soulbind', attack, health, count); } finally { SABLE_MIRRORING = false; }
    }
  }
  // Rune of Shared Spoils: the LEFT-most Dwarf's gain is copied onto the RIGHT-most Dwarf. Same one-hop shape
  // as the bond above; a single Dwarf on the board is both ends, so it must not pay itself.
  if (SPOILS && !SPOILS_MIRRORING && (attack !== 0 || health !== 0)) {
    const dwarves = SPOILS.board.filter((c) => isTribe(c, 'dwarf'));
    const head = dwarves[0];
    const tail = dwarves[dwarves.length - 1];
    if (head && tail && head.uid !== tail.uid && card.uid === head.uid) {
      SPOILS_MIRRORING = true;
      try { addBuff(tail, 'Rune of Shared Spoils', attack * SPOILS.mult, health * SPOILS.mult, count); } finally { SPOILS_MIRRORING = false; }
    }
  }
  // Sergeant: EVERY instance that grants it Attack (this buff is one such instance) permanently improves
  // its Deathrattle HP grant — in the shop here, mirrored in combat by `onGainAttackImproveHpGrant`. One
  // improvement per buff event (not scaled by the Attack amount), so two Forsaken Weavers buffing it on a
  // spell cast improve it twice. Seeds the combat instance + shows live on the card.
  if (attack > 0) {
    const eff = CARD_INDEX[card.cardId]?.effects.find((e) => e.do === 'onGainAttackImproveHpGrant');
    if (eff) card.hpGrantBonus = (card.hpGrantBonus ?? 0) + num(eff.params?.improve, 2) * gold(card) * IMPROVE_REPS; // ×2 under Rune of Mastery
  }
  if (attack === 0 && health === 0) return;
  card.buffs ??= [];
  const e = card.buffs.find((b) => b.source === source);
  if (e) { e.attack += attack; e.health += health; e.count += count; }
  else card.buffs.push({ source, attack, health, count });
}

/** Buff a TAVERN OFFER (Apples / Fortify / Fried Circuits / next-shop) — bumps its `atk`/`hp` AND records the
 *  named source in `buffs`, so the inspect + the bought minion attribute it correctly (not a generic label). */
/** Give one tavern offer `attack`/`health` worth of Veinstorm RUBIES. Minions only — a spell/Ruby offer has
 *  no stats to carry, and Fodder is excluded exactly as it was under the old tavern channel (its buffs ride
 *  the run-wide enchant instead). Shared by the cast and by the shop roll so the two can never disagree. */
export function stampVeinstormRubies(offer: ShopCard, attack: number, health: number): boolean {
  if (attack <= 0 && health <= 0) return false;
  const d = CARD_INDEX[offer.cardId];
  if (!d || d.spell || d.ruby || d.keywords.includes('FD')) return false;
  addOfferBuff(offer, 'Ruby', attack, health);
  return true; // stamped — the caller records the uid so the shop-gem span can key off Veinstorm alone
}

export function addOfferBuff(offer: ShopCard, source: string, attack: number, health: number): void {
  if (attack === 0 && health === 0) return;
  offer.atk = (offer.atk ?? 0) + attack;
  offer.hp = (offer.hp ?? 0) + health;
  offer.buffs ??= [];
  const e = offer.buffs.find((b) => b.source === source);
  if (e) { e.attack += attack; e.health += health; e.count += 1; }
  else offer.buffs.push({ source, attack, health, count: 1 });
}

/**
 * Run a recruit factory dispatch and capture any buff it applied to OTHER board minions as `BuffFxEvent`s on
 * `state.recruitBuffFx`, for the UI to replay as a tendril (living `source`) or a descend (`source` undefined /
 * kind spell|deathrattle). Diffs board `{attack,health}` by uid around `run()`, attributing each other card's
 * positive delta to `source`. Pure display metadata — the diff is ≤7 entries and never touches RNG or stats.
 */
export function captureBuffFx(
  state: RunState,
  source: BoardCard | undefined,
  kind: BuffFxEvent['kind'],
  run: () => void,
): void {
  const before = new Map(state.board.map((c) => [c.uid, { a: c.attack, h: c.health }]));
  const fxStart = state.recruitBuffFx.length; // entries pushed DURING run() are nested (deeper) captures
  run();
  // A nested capture (e.g. a summoned token's aura, or Karwind reacting) already recorded these targets with a
  // more specific source — don't also attribute their delta to THIS (outer) source. Sibling captures (sequential,
  // not nested — e.g. a Growth spell then Guel both buffing X) are NOT skipped: they legitimately produce two events.
  const innerTargets = new Set<string>();
  for (let i = fxStart; i < state.recruitBuffFx.length; i++) innerTargets.add(state.recruitBuffFx[i]!.targetUid);
  for (const c of state.board) {
    if (source && c.uid === source.uid) continue; // self-buffs use the pulse channel, not a tendril
    if (innerTargets.has(c.uid)) continue;        // a deeper capture already claimed this target
    const p = before.get(c.uid);
    if (!p) continue;                             // a newly summoned card is creation, not a buff
    const da = c.attack - p.a;
    const dh = c.health - p.h;
    if (da <= 0 && dh <= 0) continue;
    state.recruitBuffFx.push({
      sourceUid: kind === 'minion' ? source?.uid : undefined,
      targetUid: c.uid, attack: da, health: dh,
      sourceCardId: source?.cardId ?? '', sourceTribe: source?.tribe ?? 'neutral',
      kind,
    });
  }
}

/**
 * Whether a board card belongs to `tribe`, counting BOTH its tribes — a dual-type matches on either
 * (Bane is Dragon/Demon → `isTribe(bane, 'demon')` is true). `card.tribe` carries only the primary
 * tribe; the second lives on the CardDef, so this consults `CARD_INDEX`. The DRY form of the
 * `c.tribe === t || CARD_INDEX[c.cardId]?.tribe2 === t` check used across the dual-type systems.
 */
/**
 * The DEF-level twin of `isTribe` — "does this CARD DEFINITION count as `tribe`?" — for the pool filters that
 * pick from `poolOf(state).buyable` before any instance exists.
 *
 * The rule that matters: an **All-types** card (`universalTribe` — Paragon, Standard Bearer) counts as EVERY
 * tribe, exactly as `isTribe` already says for instances. The hand-rolled `c.tribe === t || c.tribe2 === t`
 * filters scattered across the pool pickers all missed that, which is why Quillen's Archive on an off-set
 * tribe (Undead / Mech) silently returned NOTHING instead of offering the two cards that genuinely count as
 * those types (owner report 2026-08-20: "i ate an undead, beast, and dwarf" → only two picks came back).
 */
export function defIsTribe(def: CardDef | undefined, tribe: Tribe): boolean {
  if (!def) return false;
  if (tribe !== 'neutral' && def.universalTribe) return true;
  return def.tribe === tribe || def.tribe2 === tribe;
}

export function isTribe(card: BoardCard, tribe: Tribe): boolean {
  if (tribe !== 'neutral' && (CARD_INDEX[card.cardId]?.universalTribe || card.allTribes)) return true; // Anomaly Reactor: "All" types
  if (card.tribe === tribe || CARD_INDEX[card.cardId]?.tribe2 === tribe) return true;
  return (card.addedTribes ?? []).includes(tribe); // Anomaly Reactor: a spell-added tribe (e.g. Mech)
}

/**
 * Heckbinder's LIVE Fodder aura: +a/+h for every Heckbinder currently on the board (golden ×2) plus any
 * welded onto a host (`fodderAuraBonus`, set by `applyWeld`). Unlike Ritualist's permanent enchant this is
 * presence-based — sell the Heckbinder (or its host) and future Fodder loses the bonus; Fodder already
 * created keeps its baked stats. Generic over `def.fodderAura` so future aura cards fold in automatically.
 */
export function fodderAuraLiveBonus(state: RunState): { attack: number; health: number } {
  const total = { attack: 0, health: 0 };
  for (const c of state.board) {
    const own = CARD_INDEX[c.cardId]?.fodderAura;
    const g = c.golden ? 2 : 1;
    if (own) { total.attack += own.attack * g; total.health += own.health * g; }
    if (c.fodderAuraBonus) { total.attack += c.fodderAuraBonus.attack; total.health += c.fodderAuraBonus.health; }
  }
  return total;
}

/**
 * The persistent per-cardId run buff (Ritualist enchants all Fodder). Applied to *every* new
 * instance of the card — bought, summoned, conjured, discovered — and read live by the tavern
 * display, so a copy from any source carries the accrued buff. Optional-chained for old saves.
 * Fodder cards additionally carry Heckbinder's LIVE aura (`fodderAuraLiveBonus`) while it's on the board.
 */
export function cardBuff(state: RunState, cardId: string): { attack: number; health: number } {
  const base = state.cardBuffs?.[cardId] ?? { attack: 0, health: 0 };
  if (!CARD_INDEX[cardId]?.keywords.includes('FD')) return base;
  const live = fodderAuraLiveBonus(state);
  if (live.attack === 0 && live.health === 0) return base;
  return { attack: base.attack + live.attack, health: base.health + live.health };
}

/**
 * The baked-on-creation Undead Attack bonus (Deathswarmer / Forsaken Weaver / Karthus — "+Attack to your
 * Undead **wherever they are**") for a freshly-created minion of `def`. Applied at EVERY creation source —
 * tavern buy, Discover, conjure (Summon Stone / Tribes Choice / Undead Army / Buddy Buddy / Cassen), and
 * Lasso steal — so the run-wide bonus follows your Undead everywhere, not only tavern purchases. 0 for
 * non-Undead; `universalTribe` counts (Chaos Attachment), matching the buy path's `isUndead`.
 */
export function undeadBuyBonus(state: RunState, def: CardDef): number {
  // Run-wide tribe ATTACK auras baked into a minion at creation: Undead (Lantern/Toxin Tender) + Beast
  // (Squirl Scout). A universal-tribe minion counts as both. Called at every creation site (buy / conjure /
  // steal / discover / offer), so a new bonus tribe added here reaches them all.
  const universal = !!def.universalTribe;
  let bonus = 0;
  if (universal || def.tribe === 'undead' || def.tribe2 === 'undead') bonus += state.undeadBuyAtk ?? 0;
  if (universal || def.tribe === 'beast' || def.tribe2 === 'beast') bonus += state.beastBuyAtk ?? 0;
  if (def.keywords.includes('M')) bonus += state.magneticBuyAtk ?? 0; // Scrap Herald (Magnetic/Attachment aura)
  return bonus;
}

/** "+N Attack to your Undead per spell cast" — bake +`amount` Attack into every current Undead (board + hand,
 *  itemized under `source`) AND stack it into `undeadBuyAtk` so future buys / reborns inherit it. Shared by
 *  Forsaken Weaver's spell-cast trigger (the minion) and Forsaken Will's quest reward, so the quest behaves
 *  exactly like the weaver. */
export function buffUndeadAttackEverywhere(state: RunState, amount: number, source: string): void {
  if (amount <= 0) return;
  for (const card of [...state.board, ...state.hand]) {
    if (isTribe(card, 'undead')) addBuff(card, source, amount, 0);
  }
  state.undeadBuyAtk = (state.undeadBuyAtk ?? 0) + amount;
}

/** Run-wide HEALTH aura baked at creation — Magnetic minions (Scrap Herald) + Beasts (Pack Mentality quest).
 *  Added to a minion's `health` at every creation site, alongside the attack aura from `undeadBuyBonus`. */
export function buyHealthAura(state: RunState, def: CardDef): number {
  let bonus = 0;
  if (def.keywords.includes('M')) bonus += state.magneticBuyHp ?? 0;
  if (def.universalTribe || def.tribe === 'beast' || def.tribe2 === 'beast') bonus += state.beastBuyHp ?? 0;
  return bonus;
}

/**
 * The stats a card gets when it's CONJURED into your hand mid-run — a combat hand-grant (Chorus Engine's
 * Attachments, Arcane Weaver's Spirit Fire, Mechanical Jouster), a Rune of the Trophy copy, and any future
 * conjure site. Base def + the run's per-card enchant + the creation-time tribe auras (Scrap Herald's
 * Attachment aura, the Undead/Beast bonds).
 *
 * **This is the single source of truth, and the UI must render its previews through it too.** It exists
 * because it drifted: the reducer settled a granted Attachment WITH `magneticBuyAtk/Hp`, while the combat
 * replay previewed the same card with only its per-card enchant — so a Chorus Engine Attachment flew to
 * hand looking base and then visibly jumped at the end of combat (owner report 2026-07-19). Any conjure
 * preview that recomputes these stats by hand will drift again; call this instead.
 */
export function conjuredStats(
  state: RunState,
  def: CardDef,
  cb: { attack: number; health: number } = cardBuff(state, def.id),
): { attack: number; health: number } {
  return {
    attack: def.attack + cb.attack + undeadBuyBonus(state, def),
    health: def.health + cb.health + buyHealthAura(state, def),
  };
}

/** Tiff's Dragon Tamer cost: 5 Gold, dropping 1 per Dragon/spell bought since the last use (floor 0 —
 *  the `tiffDiscount` bank, reset when the power fires). Shared by the reducer's charge, the StatusBar's
 *  live cost coin, and canHero's affordability gate so the three never drift. */
export function dragonTamerCostOf(state: RunState): number {
  return Math.max(0, 5 - (state.tiffDiscount ?? 0));
}

/**
 * The HERO-set price of a Shop offer, or undefined when the hero doesn't price it.
 *
 * Foreman Flint's Company Rate (Dwarves, always) sets a flat 2 Gold. Frantic Frank's Clearance is NOT here:
 * his discount belongs to the single shop his power rolled, so it is stamped onto those offers' own `cost`
 * (which already outranks this) rather than being a hero-wide rule that would apply to every later roll too. Shared by the reducer's buy charge AND the UI's cost coin, so the price a
 * player SEES is provably the price they PAY — the `sellValueOf` rule (owner report 2026-08-14: Frank's
 * discount was charged correctly but the pill still showed full price).
 */
export function heroOfferPrice(state: RunState, offer: { cardId: string }): number | undefined {
  const kind = getHero(state.heroId).power.kind;
  if (kind === 'companyRate') {
    const def = CARD_INDEX[offer.cardId];
    if (def && (def.tribe === 'dwarf' || def.tribe2 === 'dwarf')) return 2;
  }
  return undefined;
}

/** Hunch (Rounded Spellbook): 3 Gold, dropping 1 per TURN elapsed since the last use (floor 0). Using it
 *  re-bases the countdown to the current wave — so the turn after a use it is already back down to 2 (owner
 *  ruling 2026-08-14: "the cost reduction still counts"). Shared by the reducer's charge and the UI's cost
 *  coin, so the price shown is the price paid. */
export function roundedSpellbookCostOf(state: RunState): number {
  const base = state.hunchResetWave ?? 1; // runs open on wave 1
  return Math.max(0, 3 - Math.max(0, state.wave - base));
}

/**
 * Odelle (Exhibition): can these three minions be read as three DIFFERENT types?
 *
 * A dual-type card counts as EITHER of its types — whichever one avoids a clash (owner ruling 2026-08-16:
 * "a Dragon next to a Dragon/Demon should be considered 2 different tribes; the Dragon/Demon is being
 * considered a Demon"). So this is a tiny assignment problem, not a set-size check: pick one type per minion
 * and ask whether SOME choice makes all three distinct. With at most 2 options each that is 8 combinations —
 * cheap enough to brute-force, and far clearer than a hand-rolled matching.
 *
 * `neutral` is NOT a type (owner ruling 2026-08-16): a neutral minion has no tribe to be different FROM, so
 * any trio containing one fails outright — it is dropped from the options rather than treated as a fourth
 * colour. A dual-type card keeps only its non-neutral types for the same reason.
 */
export function threeDistinctTypes(cards: readonly BoardCard[]): boolean {
  if (cards.length !== 3) return false;
  const opts: string[][] = [];
  for (const c of cards) {
    const def = CARD_INDEX[c.cardId];
    // An all-tribes body (Paragon, Lab Experiment) is a WILDCARD, not a fixed pair: it counts as every tribe,
    // so it can always be the odd one out (owner 2026-08-17). There are far more than three tribes in any set,
    // so a wildcard can always take some type the other two aren't using — it never blocks an exhibition.
    if (def?.universalTribe) continue;
    const t: string[] = [];
    for (const tribe of [def?.tribe ?? c.tribe, def?.tribe2]) {
      if (tribe && tribe !== 'neutral' && !t.includes(tribe)) t.push(tribe);
    }
    if (t.length === 0) return false; // a neutral-only body can never be one of three different types
    opts.push(t);
  }
  // Only the FIXED bodies need a distinct assignment; the wildcards fill whatever is left over.
  if (opts.length <= 1) return true;
  if (opts.length === 2) return opts[0]!.some((a) => opts[1]!.some((b) => b !== a));
  for (const a of opts[0]!) {
    for (const b of opts[1]!) {
      if (b === a) continue;
      for (const c of opts[2]!) if (c !== a && c !== b) return true;
    }
  }
  return false;
}

/** Odelle (Exhibition): the +X/+X an exhibition grants right now — 1, improving by 1 for every 4 cards played
 *  this run (owner balance 2026-08-17: was 2, improving by 2). Shared by the reducer's grant and the hero panel's live text, so the printed number is the real
 *  one (the live-card-text rule applies to hero powers too). */
export function exhibitionGrantOf(state: RunState): number {
  // Reads the EXISTING run-wide `cardsPlayedTotal` rather than a private counter — "cards played" already has
  // one source of truth (every play routes through `applyCardsPlayed`), and a second tally would only be a
  // second thing to keep in sync.
  return 1 + Math.floor((state.cardsPlayedTotal ?? 0) / 4);
}

/** Aevor (Tempest): the End-of-Turn grant, +4/+4 per completed 15 kills. ZERO below the first 15 — the power
 *  is printed as "unlocks after 15 kills", so it must genuinely do nothing until then rather than round up to
 *  a free +4/+4 on turn one. Shared by the End-of-Turn engine and the panel text, so the number the player
 *  reads is the number they get. */
export const TEMPEST_KILLS_PER_STEP = 15;
export function tempestGrantOf(state: RunState): number {
  return 4 * Math.floor((state.tempestKills ?? 0) / TEMPEST_KILLS_PER_STEP);
}

/** Gorun (Blade Mastery): the Attack a friendly attack grants right now — +3, plus another +3 per completed 8
 *  attacks. Unlike Tempest this has NO unlock floor: the first swing of the run already grants +3.
 *  Combat reproduces this expression from `mods.bladeMastery.attacks` plus the attacks made so far this fight,
 *  which is what lets it step up mid-combat; this side prints the value the next swing would use. */
export const BLADE_ATTACKS_PER_STEP = 8;
export function bladeMasteryGrantOf(state: RunState): number {
  return 3 * (1 + Math.floor((state.bladeAttacks ?? 0) / BLADE_ATTACKS_PER_STEP));
}

/** Cindara (Hoard): the stats her next Whelp arrives with — the 1/1 token base plus the run's banked
 *  improvement. The base is read from the token def rather than hardcoded so a re-costed token cannot leave
 *  the panel printing a size the summon does not produce. */
export function hoardWhelpStatsOf(state: RunState): { attack: number; health: number } {
  const base = CARD_INDEX['cindarawhelp'];
  const banked = state.hoardWhelpBuff ?? { attack: 0, health: 0 };
  return { attack: (base?.attack ?? 1) + banked.attack, health: (base?.health ?? 1) + banked.health };
}

/** Ayse (Lucky Seat): the reward each suit pays. Exported so the hero panel prints the QUEUED suit's reward and
 *  nothing else — the player should see the one thing that will actually happen, not a four-line table (owner
 *  ask 2026-08-16). The reducer's payout switch and this map are the same four cases by construction. */
export const CIA_SUIT_TEXT: Record<CiaSuit, string> = {
  hearts: '**Hearts:** Discover a minion of your Tavern Tier.',
  spades: '**Spades:** Discover a Shop spell.',
  diamonds: '**Diamonds:** get a random minion from the tier **above** you.',
  clubs: '**Clubs:** gain **3 Gold**.',
  // The Ace pays one of TWO halves on a coin flip. Both are printed because the player cannot know which they
  // will get — and above Tier 5 the discount half is off the table entirely, which the text has to say or the
  // prize reads as broken on the turn it stops appearing.
  ace: '**Ace:** *(50/50)* **−4 Gold** off your next Shop upgrade *(Tier 5 and below)*, or Discover a minion from the tier **above** you.',
};

/** Warden's Aegis: the +X/+Y it grants every Warded minion, scaling with Tavern Tier (owner spec 2026-08-16).
 *  Attack is the tier, Health the tier + 1 — so it stays a defensive buff as it grows. Shared by the reducer's
 *  grant and the panel's printed rule, so the number shown is the number given. */
export function aegisGrantOf(state: RunState): { attack: number; health: number } {
  return { attack: state.tier, health: state.tier + 1 };
}

/** Which commissions may be offered right now: all three on the first use, then everything except the one
 *  taken last, so the same commission can never be picked twice running (owner spec 2026-08-16). Lives here
 *  rather than in the reducer because the panel needs it too, and reducer -> recruit is the allowed direction. */
/** The two RARE jobs. Both take 3 turns; Citadel is gated on being able to USE a free upgrade. */
const RARE: CommissionKind[] = ['citadel', 'fortress'];

/**
 * Which commissions may be offered right now.
 *
 * All three ordinary jobs on the first use, then everything except the one taken last, so the same commission
 * can never be picked twice running. On top of that a **25% chance** to swap one slot for a RARE job (owner
 * 2026-08-17): Citadel (a free Shop upgrade) is only offered at Tier 4 or lower, where the upgrade is still
 * worth something.
 *
 * DERIVED, not rolled. This function is read by BOTH the reducer (to validate the pick) and the panel (to draw
 * the options), so it must be pure: it hashes `(seed, wave, lastCommission)` rather than drawing from
 * `rngCursor`. An impure roll would let the panel show one set of options while the reducer validated against
 * another, and it would not replay.
 */
export function commissionOffer(state: Pick<RunState, 'lastCommission' | 'seed' | 'wave' | 'tier'>): CommissionKind[] {
  const all: CommissionKind[] = ['discover', 'gold', 'spell'];
  const base = state.lastCommission ? all.filter((k) => k !== state.lastCommission) : all;
  // A stable hash of the run + turn: same inputs, same offer, every time it is asked.
  const h = Math.abs(mixSeed(state.seed ?? 0, state.wave ?? 0, TAG.QUEST));
  if (h % 100 >= 25) return base;
  const pool = RARE.filter((k) => (k !== 'citadel' || (state.tier ?? 1) <= 4) && k !== state.lastCommission);
  if (pool.length === 0) return base;
  const rare = pool[h % pool.length]!;
  // Swap the rare job into a stable slot rather than appending, so the picker keeps three options.
  const out = [...base];
  out[h % out.length] = rare;
  return out;
}

/** Cassen's commissions: how long each takes to mature. The delay IS the trade — a longer wait buys a bigger
 *  payout — so it sits beside the printed text rather than in the reducer's payout switch. */
export const COMMISSION_DELAY: Record<CommissionKind, number> = { discover: 3, gold: 2, spell: 1, citadel: 3, fortress: 3 };

/** Cassen's commissions as a quest-style card: a short NAME and the reward on its own line. The older
 *  `COMMISSION_TEXT` stays for the hero-panel rule, which wants one sentence rather than a card. */
export const COMMISSION_NAME: Record<CommissionKind, string> = {
  // Named for the scale of the job, so the delay reads off the title alone: 1 turn, 2 turns, 3 turns.
  spell: 'Shed',
  gold: 'House',
  discover: 'Bridge',
  citadel: 'Castle',
  fortress: 'Zeppelin',
};
export const COMMISSION_REWARD: Record<CommissionKind, string> = {
  discover: 'Discover a minion of your Tavern Tier',
  gold: 'Gain 2 Gold',
  spell: 'Get a random Shop spell',
  citadel: 'Your Shop is upgraded once, free',
  fortress: 'A triple reward',
};

/** Cassen's commissions, as printed. The delay is the whole trade, so it leads each line. */
export const COMMISSION_TEXT: Record<CommissionKind, string> = {
  discover: 'In **3 turns**, Discover a minion of your Tavern Tier.',
  gold: 'In **2 turns**, gain **2 Gold**.',
  spell: 'In **1 turn**, get a random Shop spell.',
  citadel: 'In **3 turns**, your Shop is upgraded once.',
  fortress: 'In **3 turns**, get a **triple** reward.',
};

/** The hero power's LIVE rule text. Static for every hero except Ayse, whose printed rule is the queued suit's
 *  reward — the card-text rule ("always show the current value of what this is doing") applied to a power.
 *  `which` picks the WIELDED power (Mimic's disguise, Void's pair) — every live-value branch below keys off
 *  the resolved power's kind, so an adopted Lucky Seat prints its suit exactly as the native hero would. */
export function heroPowerText(state: RunState, which = 0): string {
  const power = activePowers(state)[which] ?? primaryPower(state);
  if (power.kind === 'luckySeat') {
    const suit = state.ciaSuit ?? 'hearts';
    return `Buy **3** Enchanted cards for a reward. ${CIA_SUIT_TEXT[suit]}`;
  }
  if (power.kind === 'grantWard') {
    const g = aegisGrantOf(state);
    return `Give a friendly minion permanent **Ward**, and give your minions with **Ward** **+${g.attack}/+${g.health}**.`;
  }
  if (power.kind === 'exhibition') {
    // Odelle: the grant IMPROVES every 4 cards played, so the printed rule has to move with it — the
    // card-text live-value rule applies to hero powers too. It read a static "+1/+1" while she was actually
    // giving +3/+3 (found 2026-08-22 wiring her counters). The countdown to the next step rides along.
    const g = exhibitionGrantOf(state);
    const toNext = 4 - ((state.cardsPlayedTotal ?? 0) % 4);
    return `Play a minion between two others of three different types: all three gain **+${g}/+${g}**. Improves in **${toNext}** card${toNext === 1 ? '' : 's'} played.`;
  }
  if (power.kind === 'tempest') {
    // The grant scales with a run tally, so the printed rule has to move with it (the card-text live-value
    // rule, which applies to hero powers too — see `exhibition`). Below the first threshold it prints as
    // LOCKED with the countdown, because a "+0/+0" would read as a broken effect rather than an unearned one.
    const kills = state.tempestKills ?? 0;
    const grant = tempestGrantOf(state);
    const toNext = TEMPEST_KILLS_PER_STEP - (kills % TEMPEST_KILLS_PER_STEP);
    if (grant === 0) return `Locked — kill **${toNext}** more enemies to unlock. Then, **End of Turn:** give your left and right-most minions **+4/+4**.`;
    return `**End of Turn:** give your left and right-most minions **+${grant}/+${grant}**. Upgrades in **${toNext}** kill${toNext === 1 ? '' : 's'}. (${kills} killed)`;
  }
  if (power.kind === 'bladeMastery') {
    const attacks = state.bladeAttacks ?? 0;
    const grant = bladeMasteryGrantOf(state);
    const toNext = BLADE_ATTACKS_PER_STEP - (attacks % BLADE_ATTACKS_PER_STEP);
    return `When your minions attack, give them **+${grant} Attack** for the fight. Improves in **${toNext}** attack${toNext === 1 ? '' : 's'}. (${attacks} made)`;
  }
  if (power.kind === 'hoard') {
    // The Whelp's size is banked run state, so the printed body has to be the one that will actually arrive.
    const w = hoardWhelpStatsOf(state);
    return `**Avenge (4):** summon a **${w.attack}/${w.health}** Whelp that attacks immediately. Improve your Whelps **+2/+2**.`;
  }
  if (power.kind === 'unitedFront') {
    // The magnitude IS the run's spell count, so the printed number has to track it (the card-text rule).
    const n = state.spellsCast;
    return `**Start of Combat:** give a friendly minion of each type **+${n}/+${n}** (1 per spell cast this game).`;
  }
  if (power.kind === 'commission') {
    // While one is running the panel prints THAT commission and when it lands; otherwise it prints the
    // options actually on offer (never the one taken last).
    const live = state.commission;
    if (live) return `Working: ${COMMISSION_TEXT[live.kind]} (due turn ${live.dueWave})`;
    return `Choose one — ${commissionOffer(state).map((k) => COMMISSION_TEXT[k]).join(' · ')}`;
  }
  return power.text;
}

/** Harlan (Buyout): 11 Gold, dropping 1 per TURN elapsed since the last use (floor 0). Using it re-bases to
 *  the current wave — "resets to 11 Gold after each use" (owner spec 2026-08-16), the discount then accruing
 *  again from that turn. Same shape and sharing rule as `roundedSpellbookCostOf`: the reducer charges it and
 *  the UI's cost coin reads it, so the price shown is the price paid. */
export function buyoutCostOf(state: RunState): number {
  const base = state.harlanResetWave ?? 1; // runs open on wave 1
  return Math.max(0, 11 - Math.max(0, state.wave - base));
}

/** Rascal (All In): 1 Gold plus 2 for every TURN elapsed since the last use. The mirror image of the two cost
 *  helpers above — a payout that CLIMBS rather than a price that falls — and re-based on use the same way, so
 *  the second of his two activations starts its accrual over. Shared by the reducer and the panel tally. */
export function allInPayoutOf(state: RunState): number {
  const base = state.rascalResetWave ?? 1; // runs open on wave 1
  return 1 + 2 * Math.max(0, state.wave - base);
}

/** The Gold a minion sells for: Hoarder a flat 2 (golden 4), everything else `CONFIG.sellValue`. Shared by
 *  the reducer's sell case and the UI's sell-amount float so the two never drift. */
export function sellValueOf(card: BoardCard, state?: Pick<RunState, 'runeBartering' | 'runeStacks'>): number {
  // Rune of the Bargain Bin: a bin-bought minion sells for its overridden value (0) — checked first so it wins.
  if (card.sellOverride !== undefined) return card.sellOverride;
  // Rune of Bartering: a Shout (Battlecry) minion sells for 2 Gold — folded HERE so every sell path AND the
  // UI's sell-value coin/float read the same number (never below a card's own higher sell value).
  // 2 Gold per Bartering copy held (owner 2026-08-27, unique-engine doubling — "Bartering +2g").
  const barter = state?.runeBartering && hasBattlecry(CARD_INDEX[card.cardId]) ? 2 * runeStacksOf(state, 'rune_bartering') : 0;
  if (card.cardId === 'hoarder') return Math.max(barter, 2 * (card.golden ? 2 : 1));
  // Trail Forager: base 3 Gold (×2 golden) + 1 per Beast played (that per-Beast bump is already golden-doubled
  // as it accrues, in `sellBonus`).
  if (card.cardId === 'trailforager') return Math.max(barter, 3 * (card.golden ? 2 : 1) + (card.sellBonus ?? 0));
  //  is a GENERAL per-instance accrual (Trail Forager above, Starpath Vendor's Dawn Orbit) — read
  // here so any card that grows its own sell value is honoured without another branch.
  return Math.max(barter, CONFIG.sellValue + (card.sellBonus ?? 0));
}

/**
 * What the PLAYER-initiated sell actually pays: `sellValueOf` plus Quick Sale's one-shot `nextSellBonus`.
 *
 * Split from `sellValueOf` rather than folded into it on purpose. Two effect paths (Consume-style
 * self-sacrifices that "count as a sell") also call `sellValueOf`, and they neither apply nor CLEAR the
 * one-shot bonus — folding it in would silently make them consume Quick Sale, which is a rules change rather
 * than the display fix this is. So the bonus lives here, in the helper the player's sell button and the UI's
 * sell float both read, keeping those two in lockstep without touching the effect paths.
 *
 * (The drift this fixes: the reducer added `nextSellBonus` inline while the UI's float called `sellValueOf`
 * alone, so selling under Quick Sale paid 3 Gold but floated "+1" in the plain gold style — owner 2026-07-24.)
 */
export function sellValueWithBonus(card: BoardCard, state: Pick<RunState, 'runeBartering' | 'nextSellBonus' | 'runeStacks'>): number {
  return sellValueOf(card, state) + (state.nextSellBonus ?? 0);
}

/**
 * Turn a board minion Golden by doubling its **BASE** stats only — accrued buffs are NOT doubled. A buffed
 * 10/10 built from a 3/4 base gilds to 6/8 + its +7/+6 buffs = 13/14, NOT 20/20. This matches a natural triple,
 * whose golden keeps "the two highest copies' stats" (= two copies of base + the buffs). The 'Gild' buff records
 * the +base so the inspect breakdown still itemizes it. Flips the golden flag (which doubles combat EFFECTS —
 * Deathrattles twice, ×N multipliers). No-op if already golden. Shared by Eyes of Aresmar + Indy's Gild.
 */
/** Cards whose payout multiplies the accrued `summonBonus` by GOLDEN at read time — `(base + bonus) × 2`.
 *  For these, gilding a body IN PLACE (Indy's hero power, Golden Touch) would retroactively double everything
 *  it had already earned: a Sovereign sitting on +100/+100 jumped to +200/+200 (owner report 2026-08-07).
 *  The ruling: earned value is EARNED — it stays at face value, and only future growth runs at the golden
 *  rate. Halving the accrual at gild time delivers exactly that through the unchanged ×2 read: the accrued
 *  payout is identical before and after, and each future +1 tick now reads as +2×step. The halved count can
 *  go fractional (3 → 1.5), which is fine — every payout and live text multiplies it straight back to an
 *  integer. Scoped to a card list because `summonBonus` is a SHARED field with two conventions: the
 *  `buffOnSummon` family (Mama Bear) reads it RAW ("no golden doubling here — a golden's bonus already
 *  encodes the combined magnitude"), and halving those would destroy real value.
 *  TRIPLES ARE NOT THIS: `checkTriples` builds a golden FROM three bodies and deliberately encodes their
 *  summed grants through the ×2 read — that math is untouched. */
const GOLD_SCALED_ACCRUAL_CARDS = new Set(['kennel', 'd2_sovereign', 'packleader', 'dm_broodwright', 'b2_groveweaver']);

/** Spells the copy-last/first effects (Recaller, Spellvault Drake) may NOT reproduce (owner ruling
 *  2026-08-07). Second Draft is the loop: cast it ON the Recaller, replay the Recaller, receive another
 *  Second Draft, repeat — a 3-Gold engine that replays a Shout and mints a spell-cast trigger every lap,
 *  forever. The cast still RECORDS normally (Steward, the Archivist's journal and the live text all still see
 *  it); only the copy grant skips it. */
export const NO_COPY_SPELLS: ReadonlySet<string> = new Set(['seconddraft']);

export function gildMinion(card: BoardCard): void {
  if (card.golden) return;
  const def = CARD_INDEX[card.cardId];
  addBuff(card, 'Gild', def?.attack ?? 0, def?.health ?? 0);
  if (GOLD_SCALED_ACCRUAL_CARDS.has(card.cardId) && (card.summonBonus ?? 0) > 0) {
    card.summonBonus = card.summonBonus! / 2;
  }
  card.golden = true;
}

/**
 * Permanently enchant the **Fodder** card type run-wide by +a/+h (Ritualist's End of Turn, Bane's
 * battlecry trigger). Bumps the persistent per-cardId run buff for every Fodder def — so future copies
 * from any source (tavern, summon, Discover, conjure) carry it — and applies it to the Fodder already on
 * the board / in the hand right now. `source` labels the buff in the inspect breakdown.
 */
/** Record one Consumed Fodder's stats — the per-turn tally (Abhorrent Horror's SoC window) AND the run-wide
 *  totals the Demon quests read (`consumeFodder` count + `consumeStats` = Σ attack+health). Called at every
 *  consume site. */
export function noteFodderConsumed(state: RunState, fa: number, fh: number, eater?: BoardCard): void {
  state.fodderConsumedThisTurn ??= { attack: 0, health: 0 };
  state.fodderConsumedThisTurn.attack += fa;
  state.fodderConsumedThisTurn.health += fh;
  state.runFodderConsumed ??= { count: 0, stats: 0 };
  state.runFodderConsumed.count += 1;
  state.runFodderConsumed.stats += fa + fh;
  // Rune of Consumption (reworked 2026-07-21): every Fodder Consumed permanently improves your run-wide Fodder
  // aura by +1 Attack OR +1 Health, chosen at RANDOM (was a flat +2/+1). One coin flip per improve, so Rune of
  // Mastery's extra rep is its own independent flip. Seeded off the run cursor — deterministic for replays.
  if (state.runeConsume) {
    procRune(state, 'runeConsume');
    const reps = improveReps(state);
    const rng = makeRng(state.rngCursor);
    for (let i = 0; i < reps; i++) {
      const toAttack = rng.int(2) === 0;
      buffFodderRunWide(state, toAttack ? state.runeConsume.attack : 0, toAttack ? 0 : state.runeConsume.health, 'Rune of Consumption');
    }
    state.rngCursor = rng.state();
  }
  // Endless Appetite's "first each turn" gate — incremented BEFORE the fan-out below, so the fanned-out
  // consumes (which re-enter here as real consumes: tallies, Rune of Consumption, Transfusion) never re-fan.
  const first = (state.consumesThisTurn = (state.consumesThisTurn ?? 0) + 1) === 1;
  advanceRuneThresholds(state, 'consume', 1); // Rune of the Empty Plate counts Shop-minion Consumes
  // Rune of Transfusion: whenever a DEMON Consumes, your leftmost minion also gains the Fodder's stats
  // (skipped when the eater IS the leftmost — its own Consume already banked them).
  if (state.runeTransfusion && eater && isTribe(eater, 'demon')) {
    const left = state.board[0];
    // The stats land once per copy held (recurring family, owner 2026-08-27).
    const tf = runeStacksOf(state, 'rune_transfusion');
    if (left && left.uid !== eater.uid) { procRuneId(state, 'rune_transfusion'); addBuff(left, 'Rune of Transfusion', fa * tf, fh * tf); }
  }
  // Rune of Endless Appetite: the FIRST Consume each turn fans out — every OTHER friendly Demon Consumes a
  // copy of the same Fodder (a full Consume each: its own Voracious multiplier, onConsume triggers, and the
  // tallies/rune hooks via the recursive note call).
  if (first && state.runeEndlessAppetite && eater) {
    procRuneId(state, 'rune_endless_appetite');
    const ctx = makeContext(state);
    // Each other Demon Consumes one copy PER RUNE COPY HELD (owner 2026-08-27, unique-engine doubling).
    for (let k = 0; k < runeStacksOf(state, 'rune_endless_appetite'); k++) {
      for (const d of state.board.filter((c) => c.uid !== eater.uid && isTribe(c, 'demon'))) {
        const mult = fodderMultiplier(d);
        addBuff(d, 'Consume', fa * mult, fh * mult);
        fire(ctx, 'onConsume', { minion: d });
        noteFodderConsumed(state, fa, fh, d);
      }
    }
  }
}

export function buffFodderRunWide(state: RunState, a: number, h: number, source: string, fx = true): void {
  state.cardBuffs ??= {};
  for (const def of Object.values(CARD_INDEX)) {
    if (!def.keywords.includes('FD')) continue;
    const cur = (state.cardBuffs[def.id] ??= { attack: 0, health: 0 });
    cur.attack += a;
    cur.health += h;
  }
  for (const c of [...state.board, ...state.hand]) {
    if (CARD_INDEX[c.cardId]?.keywords.includes('FD')) addBuff(c, source, a, h);
  }
  // Buff Gust FX — the FODDER-buff cue EXCLUSIVELY (owner 2026-07-16: not Imp auras, not the Staff of
  // Guel): callers whose identity isn't "a Fodder buff" (the Staff's side-enchant) pass `fx: false`.
  if (fx) {
    stampBuffGust(state, [...state.board, ...state.hand, ...state.shop]
      .filter((c) => CARD_INDEX[c.cardId]?.keywords.includes('FD'))
      .map((c) => c.uid));
  }
}

/** Stamp the one-shot Buff Gust FX signal. The gust is the TAVERN flourish — the UI anchors it to the
 *  shop row (pushed out by `edgeOut`), so `uids` are informational (which cards were hit), and an empty
 *  set still stamps: an Imp-aura buff with no Imp visible is still "the tavern got buffed". */
export function stampBuffGust(state: RunState, uids: string[]): void {
  state.buffGustSeq = (state.buffGustSeq ?? 0) + 1;
  state.buffGustUids = [...new Set(uids)];
}

/** The visible cards (board + tavern offers) a run-wide tribe-aura wash should bloom over. Matches each
 *  channel's real membership by TRIBE (incl. dual types): `demon` = your Demons (the Imp aura is a Demon-
 *  build payoff, and its Imp tokens are combat-summoned — almost never visible in the shop — so washing
 *  the visible Demons is what gives the aura a body to land on), `mech` = Magnetic cards (the Attachment
 *  aura rides the Magnetic keyword), `beast`/`undead` = tribe membership. Pure display metadata. */
export function auraFxTargets(state: RunState, tribe: AuraFxTribe): string[] {
  const uids: string[] = [];
  for (const c of state.board) {
    const hit = tribe === 'mech' ? c.keywords.includes('M') : isTribe(c, tribe);
    if (hit) uids.push(c.uid);
  }
  for (const o of state.shop) {
    const def = CARD_INDEX[o.cardId];
    if (!def) continue;
    const hit = tribe === 'mech' ? def.keywords.includes('M')
      : def.tribe === tribe || def.tribe2 === tribe || !!def.universalTribe;
    if (hit) uids.push(o.uid);
  }
  return uids;
}

/** Stamp the one-shot Fodder Infusion FX signal: `uid` = the SOURCE card queuing Fodder for the tavern —
 *  the UI reaches tendrils from that unit up to the shop line. */
/** Stamp the one-shot WELD FX signal: `uids` = EVERY minion that just gained an Attachment (the host, plus
 *  each Beatbot that mirrored the weld onto itself); `kind` marks a hand-PLAYED Magnetic (the card slides in
 *  first, so the ring converges as it merges) vs an AUTO weld (Banksly, Combinator, Cling Drones, Money
 *  Bots). Monotonic seq like the other FX signals — never cleared; the UI dedupes against its last-seen. */
export function stampWeldFx(state: RunState, uids: string[], kind: 'play' | 'auto'): void {
  if (uids.length === 0) return;
  const base = state.weldFxBaseSeq ?? 0;
  const first = (state.weldFxSeq ?? 0) === base; // nothing stamped yet in THIS action
  state.weldFxSeq = (state.weldFxSeq ?? 0) + 1;
  // ACCUMULATE across this action, don't overwrite. Several welds can land in ONE dispatch — a golden
  // Banksly magnetizes twice, and spending enough Gold procs it repeatedly — and the UI only reads the
  // FINAL state after the dispatch, so overwriting meant every weld but the last silently lost its ring
  // (verified: two welds in one action left `['B']` with seq 2). The FIRST stamp of an action replaces
  // instead, which is what keeps the previous action's uids from leaking in — `reduce` no longer clears
  // them, because clearing raced React's dispatch batching and dropped the ring entirely.
  state.weldFxUids = first ? [...new Set(uids)] : [...new Set([...(state.weldFxUids ?? []), ...uids])];
  state.weldFxKind = kind;
}

export function stampFodderSend(state: RunState, uid: string | undefined): void {
  if (!uid) return;
  state.fodderSendSeq = (state.fodderSendSeq ?? 0) + 1;
  state.fodderSendUid = uid;
}

/**
 * Accrue the run-wide **Imp** buff (Fodder Feeder / Ritualist / Bane). Imps are combat-summoned tokens
 * (Brood Matron / Imp King), so this bumps `state.impBuff` — which `simulate` applies to every friendly Imp
 * at combat start AND on summon, so the bonus follows them. Also buffs any Imp already on the board/hand
 * (rare — imps are normally combat-only). Stacks; `source` labels the inspect breakdown.
 */
/** Queue `count` Fodder into each of the next `shops` tavern refreshes (Soulfeeder's Shout, Pit Supplier's
 *  Avenge carry-back). Arms `fodderSchedule` — one entry per future refresh, consumed by `injectPendingTavern`. */
export function armFodderSchedule(state: RunState, count: number, shops: number): void {
  if (count <= 0 || shops <= 0) return;
  state.fodderSchedule ??= [];
  for (let i = 0; i < shops; i++) state.fodderSchedule[i] = (state.fodderSchedule[i] ?? 0) + count;
}

export function buffImpsRunWide(state: RunState, a: number, h: number, source: string): void {
  // REPLACE, never mutate in place (owner report 2026-08-19: "the (5/3) text is not updating in real-time").
  // The UI's live-text memos (Recruit's `live` / `refViewsByUid`, and the Card/Unit value comparators) key on
  // `run.impBuff` BY REFERENCE. Bumping `.attack`/`.health` on the existing object left that reference
  // identical for the whole run, so every one of those memos bailed out and the printed Imp stats — the live
  // "(X/Y)" `withImpStats` injects — froze at whatever they were on first render.
  const prev = state.impBuff ?? { attack: 0, health: 0 };
  state.impBuff = { attack: prev.attack + a, health: prev.health + h };
  for (const c of [...state.board, ...state.hand]) {
    if (CARD_INDEX[c.cardId]?.imp) addBuff(c, source, a, h);
  }
  // (No gust here — the cue is Fodder-buff exclusive, owner 2026-07-16. Ritualist still gusts via its
  // buffFodderRunWide half.)
}

/**
 * Permanently enchant a single card type run-wide by +a/+h (Grave Knit's combat-death payoff). Like
 * `buffFodderRunWide` but keyed to one `cardId` rather than the Fodder keyword: bumps the persistent
 * per-cardId run buff (so future copies from any source carry it) and applies it to that card already
 * on the board / in the hand. `source` labels the buff in the inspect breakdown. Mirrors the Cling Drone
 * enchant (`improveClingDrones`) but with an explicit source + separate atk/hp.
 */
/**
 * A minion's stats have THREE layers, and a stat-writing spell has to know which is which.
 *
 *   stored   `card.attack` / `card.health` — what the sim persists
 *   BAKED    auras already inside `stored`, applied at creation or by a run-wide buff pass
 *              · `cardBuff(cardId)`  — per-card-type enchants (Spear Warden) + the live Fodder aura
 *              · `undeadBuyAtk` / `beastBuy*` / `magneticBuy*` — creation auras (`undeadBuyBonus`/`buyHealthAura`)
 *              · `impBuff` for Imps
 *   FOLDED   auras NOT in `stored`, added only when the card is drawn: the Undead aura
 *              (`undeadAttackBonus`/`undeadHealthBonus`, Lantern of Souls). See `instView`:
 *              `shownAtk = inst.attack + undeadAtkBonus`.
 *
 * Conflating the two produced the owner-reported bug (2026-07-29): Turnabout on a Deathsayer *showing* 383/361
 * moved it by only ±24, because it swapped the STORED stats — which were tiny, since ~all of that 383 was a
 * folded aura. What a player reads on the card is `stored + folded`, so that is what a spell must operate on.
 *
 * The rule, applied by every stat-writing spell below:
 *
 *   1. read DISPLAYED   = stored + folded
 *   2. compute the spell's result on those numbers
 *   3. write stored      = result + baked      (the fold re-applies on its own at display time)
 *
 * which lands the card at `result + baked + folded` — the result with every aura back on top, exactly the
 * owner's ruling. On that Deathsayer: swap 383/361 → 361/383, then +349/+351 → 710/734, independent of how the
 * 349 splits between the baked and folded channels.
 */
export function bakedAuraOf(state: RunState, card: BoardCard): { attack: number; health: number } {
  const def = CARD_INDEX[card.cardId];
  const typed = cardBuff(state, card.cardId);
  let attack = typed.attack;
  let health = typed.health;
  if (def) {
    attack += undeadBuyBonus(state, def);
    health += buyHealthAura(state, def);
    if (def.imp) { attack += state.impBuff?.attack ?? 0; health += state.impBuff?.health ?? 0; }
  }
  return { attack, health };
}

/** The display-only fold — the run-wide Undead aura, which never touches stored stats. */
export function foldedAuraOf(state: RunState, card: BoardCard): { attack: number; health: number } {
  const def = CARD_INDEX[card.cardId];
  const undead = !!def && (def.tribe === 'undead' || def.tribe2 === 'undead' || !!def.universalTribe);
  return undead
    ? { attack: state.undeadAttackBonus ?? 0, health: state.undeadHealthBonus ?? 0 }
    : { attack: 0, health: 0 };
}

/** What the PLAYER reads on the card: stored plus the display fold. */
export function displayedStatsOf(state: RunState, card: BoardCard): { attack: number; health: number } {
  const f = foldedAuraOf(state, card);
  return { attack: card.attack + f.attack, health: card.health + f.health };
}

/**
 * Write a stat-spell's result. `resultAtk`/`resultHp` are computed from DISPLAYED stats; this lands them as the
 * minion's true stats with the baked auras re-applied, so nothing an aura granted is eaten by the write.
 */
function writeStatResult(state: RunState, card: BoardCard, source: string, resultAtk: number, resultHp: number): void {
  const baked = bakedAuraOf(state, card);
  addBuff(card, source, (resultAtk + baked.attack) - card.attack, (resultHp + baked.health) - card.health);
}

export function buffCardTypeRunWide(state: RunState, cardId: string, a: number, h: number, source: string): void {
  state.cardBuffs ??= {};
  const cur = (state.cardBuffs[cardId] ??= { attack: 0, health: 0 });
  cur.attack += a;
  cur.health += h;
  for (const c of [...state.board, ...state.hand]) {
    if (c.cardId === cardId) addBuff(c, source, a, h);
  }
}

/**
 * How many times a spell's effect resolves when cast, given the board (Yazzus): 3 if any Yazzus on the
 * board is golden, 2 if a non-golden Yazzus is present, else 1. Multiple Yazzus do NOT stack — the best
 * single one wins (mirrors Drakko / Chronos). Internal — external callers (the reducer's cast path, the
 * UI's cast-spark replay) use `spellCasts`, which also applies the aimed-spell / singleCast exemptions.
 */
function spellCastMult(state: RunState): number {
  const yazzus = state.board.filter((c) => c.cardId === 'yazzus');
  if (yazzus.some((c) => c.golden)) return 3;
  return yazzus.length > 0 ? 2 : 1;
}

/**
 * How many times a spell's effect resolves on cast. Yazzus (2, or 3 if golden) multiplies ONLY
 * *aimed* spells — those with a `target` (Spirit Fire, Shatter, Front to Back, Aresmar, Tribes
 * Choice…). Untargeted economy/utility/Discover spells (Growth, Mana Pouch, Sprout, Help Wanted…)
 * always resolve once. `singleCast` spells (Channeling the Devourer) never multiply. Read by the
 * reducer's cast path and the UI's cast-spark replay.
 */
/** Living Grimoire's live multiplier for the NEXT spell cast, or 1 if it isn't charged / has no live source.
 *  Read-only — the charge is CONSUMED separately at the cast site (`consumeGrimoireCharge`), so this stays safe
 *  for the UI's side-effect-free cast preview. Requires a Grimoire actually on board so selling it can't leave
 *  a permanent multiplier behind. No "first spell of the turn" gate: the charge is armed when the Grimoire is
 *  PLAYED, so it naturally applies to the first spell cast WHILE IT'S ON BOARD — even one played mid-turn after
 *  an earlier cast (owner 2026-07-24). */
export function grimoireMultActive(state: RunState): number {
  if (!state.grimoireMult || state.grimoireMult <= 1) return 1;
  const live = state.board.some((c) => CARD_INDEX[c.cardId]?.effects.some((e) => e.do === 'battlecryArmGrimoire'));
  return live ? state.grimoireMult : 1;
}
/** Spend the Grimoire charge (called by every real cast path — shop spells AND Rubies — so whichever comes
 *  first after arming consumes it). No-op unless a live Grimoire made it active. */
export function consumeGrimoireCharge(state: RunState): void {
  if (grimoireMultActive(state) > 1) state.grimoireMult = 0;
}

/**
 * How many times a RUBY played from hand resolves: 1, plus `rubyExtraCast` per Prismcaster on board (doubled per
 * golden Prismcaster), all multiplied by a live Living Grimoire charge (a Ruby is a spell for the Grimoire — it
 * doesn't say "Shop spell").
 *
 * Extracted from the reducer so the UI can PREVIEW the count for the ×N badge (owner ask 2026-07-24: Rubies had
 * no multicast badge at all, because the count only existed inline at the cast site). Side-effect free, like
 * `spellCasts` — the charge is spent by the real cast path, not by reading it here.
 */

export function rubyCastCount(state: RunState): number {
  let extra = state.board.reduce((n, c) => n + (CARD_INDEX[c.cardId]?.rubyExtraCast ?? 0) * (c.golden ? 2 : 1), 0);
  // Quest rewards add to the SAME channel Prismcaster feeds, so the two stack additively rather than one
  // shadowing the other. `firstEachTurn` is read-only here for the same reason `spellCasts` is: the freebie is
  // spent by the real cast path bumping `rubyCastsThisTurn`, so the UI can preview the badge without consuming it.
  extra += state.rubyExtraCasts ?? 0;
  // First-N gate: `rubyCastsThisTurn` counts Ruby PLAYS (not resolved casts — a doubled first Ruby must not
  // eat the second slot of Resonance's 2-Ruby window), reset each turn.
  if ((state.rubyCastsThisTurn ?? 0) < (state.rubyFirstCastWindow ?? 1)) extra += state.rubyFirstExtraCasts ?? 0;
  return (1 + extra) * grimoireMultActive(state);
}

export function spellCasts(state: RunState, def: CardDef): number {
  if (def.singleCast) return 1; // Channeling the Devourer never multiplies
  let mult = def.target ? spellCastMult(state) : 1; // Yazzus multiplies aimed spells; untargeted = 1
  if (state.spellDoubleAlways) mult *= 2; // Ancient Runes: every spell casts twice
  // Rune of Hoardflame / Rune of Dragon Breath: THIS spell id casts an extra time. Card-scoped (the Edward
  // Keg-hands shape below, by id rather than by Ale list) and read-only, so the UI's x N badge previews the
  // real count — which is what makes the multicast modifier show while the rune is armed.
  for (const id of state.runeSpellDouble ?? []) if (id === def.id) mult *= 2;
  // Spell Thesis: the FIRST spell each turn casts twice. READ-ONLY here (so the UI can preview the count without
  // side effects) — the reducer's cast sites consume the freebie by setting `spellFirstUsedThisTurn` after casting.
  if (state.spellFirstDoubleEachTurn && !state.spellFirstUsedThisTurn) mult *= 2;
  // Orivax (Spellweave): the first spell AFTER IT IS PLAYED casts N times — not the turn's first (owner ruling
  // 2026-07-31). Gating on `spellsThisTurn === 0` meant playing Orivax after already casting a spell gave you
  // nothing until next turn, so the card silently did less the later in a turn you played it. `spellMultMark`
  // is the spell count at the moment it installed; the multiplier applies while the count is still there.
  // Read-only, like the Grimoire check beside it, so the UI can preview without consuming.
  if (state.spellFirstMultEachTurn && state.spellFirstMultEachTurn > 1
      && state.spellsThisTurn === (state.spellMultMark ?? 0)) {
    mult *= state.spellFirstMultEachTurn;
  }
  // Living Grimoire: the first spell cast while it's on board multiplies (see `grimoireMultActive`).
  mult *= grimoireMultActive(state);
  // Edward Keg-hands: your ALES specifically cast extra times. Scoped to the Ale ids rather than to all spells,
  // and read from the board here (like Yazzus and the Grimoire) so the UI can preview the count without any
  // side effect. Golden reads "three times" → one more than base.
  if (ALE_IDS.includes(def.id)) {
    const edwards = state.board.filter((c) => c.cardId === 'dw_edward');
    if (edwards.length > 0) mult *= edwards.some((c) => c.golden) ? 3 : 2;
    // Run-wide Ale multiplier (Bottomless Cellar, Rune of the Bottomless Cask). ADDED rather than multiplied,
    // because both read "trigger an ADDITIONAL time" — the same distinction Nimbus makes below.
    mult += state.aleExtraCasts ?? 0;
    // Rune of Shared Pour: the FIRST Ale each turn casts one extra time. READ-ONLY here, like Spell Thesis
    // above — the cast site consumes the freebie by setting `sharedPourUsedThisTurn`, so previewing the count
    // in the UI can't spend it.
    // +1 extra cast per Shared Pour copy held (repeat family, owner 2026-08-27).
    if (state.runeSharedPour && !state.sharedPourUsedThisTurn) mult += runeStacksOf(state, 'rune_shared_pour');
  }
  // Nimbus is ADDED LAST, and added rather than multiplied, because it reads "casts an ADDITIONAL time"
  // (owner 2026-07-24). It also applies to untargeted spells, unlike Yazzus — the charge is a flat bonus on
  // whatever the spell would otherwise do.
  return mult + (state.nextSpellExtraCasts ?? 0);
}

/** Implosion's cast count: once by default, plus one more per Demon you control (so 1 + your Demons). Shared by
 *  the effect (spellBuffImpsPerDemon) and the UI (the ×N badge + live text), so the printed number always matches
 *  what actually resolves. */
export function implosionCasts(state: RunState): number {
  return 1 + state.board.filter((c) => isTribe(c, 'demon')).length;
}

/** Dragonflame's repeat count: the base buff plus one more per Dragon you control (1 + your Dragons). Drives the
 *  ×N badge so the card shows how many minions it will hit, based on the live board. */
export function dragonflameCasts(state: RunState): number {
  return 1 + state.board.filter((c) => isTribe(c, 'dragon')).length;
}

/**
 * Buff the SHOP by +attack/+health from a run-level source (a quest reward), through the same `tavernBuyBonus`
 * channel the Staff of Guel and Contract Butcher use — so "a quest buffs the shop" and "a card buffs the shop"
 * are one mechanic, not two that drift apart.
 *
 * Fodder is enchanted run-wide for the same reason `spellBuffShop` does it: a bought Fodder takes tavern buffs
 * through that channel rather than the buy-buff, so skipping it would silently exclude Fodder from every
 * shop-buff quest.
 */
/**
 * THE PER-TURN SHOP-WIDE ENCHANT (`tavernBuyBonusTurn`) — "minions in the shop get +A/+H **this turn**".
 *
 * The one channel with those exact semantics, and the reason it is a helper rather than two copies: it
 * ACCUMULATES across every refresh you make this turn (so a rerolled row inherits it — `offerBuyStats` reads
 * it beside the permanent `tavernBuyBonus`), and it is cleared at the turn ROLLOVER in `advanceCombat`, i.e.
 * after combat. Built for Rune of the Merchant's Chorus; Night Market Horror is the second caller.
 */
export function addTurnShopBuff(state: RunState, attack: number, health: number): void {
  if (attack === 0 && health === 0) return;
  const cur = state.tavernBuyBonusTurn ?? { atk: 0, hp: 0 };
  state.tavernBuyBonusTurn = { atk: cur.atk + attack, hp: cur.hp + health };
}

export function applyRunShopBuff(state: RunState, attack: number, health: number, source: string): void {
  if (attack <= 0 && health <= 0) return;
  state.tavernBuyBonus.atk += attack;
  state.tavernBuyBonus.hp += health;
  buffFodderRunWide(state, attack, health, source, false);
}

/** Endless Inventory: called after every shop refresh. The magnitude GROWS by `step` every `per` refreshes, so
 *  the printed value has to be read live (see `questText`) rather than the base rate. */
export function applyShopRefreshQuestBuff(state: RunState): void {
  const q = state.shopBuffOnRefresh;
  if (q) {
    applyRunShopBuff(state, q.attack + q.grown, q.health + q.grown, 'Endless Inventory');
    q.tick += 1;
    while (q.tick >= q.per) { q.tick -= q.per; q.grown += q.step; }
  }
  // Rune of the Wheel (`shopAuraGrowing`): nothing lands per refresh — the base +2/+2 is a standing aura
  // applied at purchase. Each refresh only ticks the meter, and every `per`-th IMPROVES the aura by
  // +step/+step. The rune used to share Endless Inventory's branch above and so stacked its base on every
  // refresh, ~5× its printed text (owner report 2026-08-21). The proc fires only when the improve does —
  // that is the moment the rune visibly acts.
  const w = state.shopAuraGrow;
  if (w) {
    w.tick += 1;
    while (w.tick >= w.per) {
      w.tick -= w.per;
      w.grown += w.step;
      if (state.ownedRunes?.includes('rune_wheel')) procRuneId(state, 'rune_wheel');
      applyRunShopBuff(state, w.step, w.step, 'Rune of the Wheel');
    }
  }
}

/**
 * The Endless Verse: bank `n` triggered Shouts and, once per `per` banked, RE-ARM the turn's spell doubler by
 * clearing `spellFirstUsedThisTurn`. That flag is what Spell Thesis spends when the turn's first spell casts, so
 * clearing it hands the doubler back rather than granting a separate one — the two stack naturally.
 */
export function applyShoutsForEndlessVerse(state: RunState, n: number): void {
  const q = state.endlessVerse;
  if (!q || n <= 0) return;
  q.tick += n;
  while (q.tick >= q.per) {
    q.tick -= q.per;
    state.spellFirstUsedThisTurn = false;
  }
}

/** Bane's Presence: bank `n` triggered Shouts and buff the shop once per `per` banked. */
export function applyShoutsForShopBuff(state: RunState, n: number): void {
  const q = state.shopBuffPerShouts;
  if (!q || n <= 0) return;
  q.tick += n;
  while (q.tick >= q.per) {
    q.tick -= q.per;
    applyRunShopBuff(state, q.attack, q.health, "Bane's Presence");
  }
}

/**
 * Advance every armed threshold rune watching `meter` by `amount`, paying out once per `per` banked.
 *
 * ONE dispatcher rather than a hook per rune: the runes in this group differ only in meter and payload, and
 * separate hooks would drift on the parts that must NOT differ — banking the remainder, and paying every
 * threshold a single large transaction crosses (a 12-Gold buy pays a 5-Gold rune twice).
 */
export function advanceRuneThresholds(state: RunState, meter: 'gold' | 'spellCast' | 'spellCastNonAle' | 'castRuby' | 'cardsBought' | 'cardsPlayed' | 'playDragon' | 'shout' | 'consume', amount: number): void {
  if (amount <= 0 || !state.runeThresholds?.length) return;
  for (const t of state.runeThresholds) {
    if (t.meter !== meter) continue;
    // `once` (Bubble Crown): a ONE-SHOT threshold. Stop ticking entirely once it has paid, so the meter parks
    // at its cap rather than rolling over — which is also what makes its x/N counter stop at N instead of
    // resetting to 0 and implying another payout is coming.
    if (t.once && t.spent) continue;
    t.tick += amount;
    while (t.tick >= t.per) {
      t.tick -= t.per;
      if (t.oncePerTurn && t.usedThisTurn) continue; // banked but not paid — the cap is per turn, not per run
      if (t.once) { t.spent = true; t.tick = t.per; payRuneThreshold(state, t); break; } // pay once, then park
      t.usedThisTurn = true;
      payRuneThreshold(state, t);
    }
  }
}

function payRuneThreshold(state: RunState, t: NonNullable<RunState['runeThresholds']>[number]): void {
  // The rune fired — one stamp here covers all eight threshold runes, each credited by its own `sourceId`
  // rather than by the shared `runeThreshold` reward kind (see `procRuneId`). Called only from the
  // `t.tick >= t.per` branch, so banking below the line is correctly not a fire.
  procRuneId(state, t.sourceId);
  const pool = poolOf(state);
  if (t.grantSpell) conjureToHand(state, pool.spells.filter((c) => c.tier <= state.tier && !ALE_IDS.includes(c.id)), t.grantSpell, true);
  if (t.grantAle) conjureToHand(state, pool.spells.filter((c) => ALE_IDS.includes(c.id)), t.grantAle, true);
  if (t.grantRuby) mintRubies(state, t.grantRuby);
  // Rune of the Deep Feast: a NAMED body on a meter. `overflow` because an earned reward is never dropped to
  // a full hand — the same rule every quest/rune grant follows.
  for (const id of t.grantCards ?? []) {
    const def = CARD_INDEX[id];
    if (def) grantMinionToHandOrBoard(state, def, false, true);
  }
  // Rune of the Gilded Ledger: CAST a random stat-granting Shop spell — a real cast, so spell power, the cast
  // counters and every on-cast watcher see it. Untargeted spells only: the meter trips with no player around
  // to aim, and `castSpell` with no target is exactly what an untargeted cast is.
  if (t.castStatSpell) {
    const pool = poolOf(state).spells.filter((c) => c.tier <= state.tier && !ALE_IDS.includes(c.id) && !c.token && isBoardStatSpell(c) && c.target !== 'friendly' && c.target !== 'any');
    for (let i = 0; i < t.castStatSpell && pool.length > 0; i++) {
      const rng = makeRng(state.rngCursor);
      const pick = pool[rng.int(pool.length)]!;
      state.rngCursor = rng.state();
      castSpell(state, pick, undefined);
    }
  }
  // Rune of the Gem Dividend: Gold banked into NEXT turn's opening rather than paid now — the sheet's
  // "gain 3 Gold next turn". Rides the same channel Bounty Bot's next-shop Gold uses.
  if (t.grantGoldNextTurn) state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + t.grantGoldNextTurn;
  // Rune of Gemspam: a Ruby PLAYED on every friendly minion (not minted to hand) — the same live 1/1 + the
  // run's Ruby strength a hand-cast Ruby lands, and it fires each target's on-Ruby watchers so the play is
  // real (Ruby Broker's Gold, Resonance's bounce) rather than a silent stat bump.
  if (t.rubyAll) {
    const rb = rubyStatBonus(state);
    for (const c of [...state.board]) {
      addBuff(c, 'Ruby', 1 + rb.attack, 1 + rb.health);
      fireOnRubyPlayed(state, c, 1 + rb.attack, 1 + rb.health);
    }
  }
  const b = t.buff;
  if (!b) return;
  // ESCALATION (Rune of Compounding Wages): the payout improves itself. Applied AFTER this payout so the
  // printed "give +1/+1 and improve this by +1/+1" pays 1, then 2, then 3 — not 2 on the first trip. The
  // buff object is the run's own clone (see the reducer), so growing it never writes through to the rune def.
  const grow = (): void => { if (b.step) { b.attack += b.step.attack; b.health += b.step.health; } };
  if (b.target === 'imps') { buffImpsRunWide(state, b.attack, b.health, 'Rune'); grow(); }
  // `tribe`: "your <tribe> +A/+H" wherever they are (board + hand) — the Flagship/Scales shape on a meter.
  else if (b.target === 'tribe') {
    const tribe = b.tribe;
    if (tribe) {
      captureBuffFx(state, undefined, 'spell', () => {
        for (const c of [...state.board, ...state.hand]) if (isTribe(c, tribe)) addBuff(c, 'Rune', b.attack, b.health);
      });
    }
    grow();
  }
  // `spells` (Bubble Crown): raise the run's SPELL POWER, the same channel Cinderwing Matron feeds — so every
  // stat-granting spell from here on is bigger, and `spellDisplayText` greens the printed value automatically.
  else if (b.target === 'spells') {
    state.spellBonus = { attack: (state.spellBonus?.attack ?? 0) + b.attack, health: (state.spellBonus?.health ?? 0) + b.health };
  }
  else if (b.target === 'shop') applyRunShopBuff(state, b.attack, b.health, 'Rune');
  // `shopTurn` (Merchant's Chorus): the SAME shop-wide grant, but banked in the per-turn layer so it stacks
  // across every roll this turn and is gone at the rollover. Not `applyRunShopBuff`, which is permanent.
  else if (b.target === 'shopTurn') addTurnShopBuff(state, b.attack, b.health);
  else {
    // `shopRightmost` (Rune of the Showcase) is now PERMANENT across refreshes (owner 2026-08-11): accumulate
    // into state.rightmostSlotBuff — the same running total Market Tormentor uses — and land the increment on
    // the current right-most offer. applyShopRefreshed re-lands that total on every fresh roll, so unlike the
    // old one-shot addOfferBuff it survives a refresh.
    state.rightmostSlotBuff = {
      attack: (state.rightmostSlotBuff?.attack ?? 0) + b.attack,
      health: (state.rightmostSlotBuff?.health ?? 0) + b.health,
    };
    const offer = [...state.shop].reverse().find((o) => !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby);
    if (offer) addOfferBuff(offer, 'Rune of the Showcase', b.attack, b.health);
  }
}

/**
 * Teach a bought Shop spell to a Mage-Pup and hand it over.
 *
 * Extracted from `grantMagePupTaught` (2026-07-30) so Rune of the White Wolf can teach too. The CAP is why it
 * had to move: it counts Mentors ON BOARD, so a rune — which has no body — would compute a ceiling of 0 and
 * silently never teach. The rune now contributes to that same ceiling, so holding a Mentor AND the rune raises
 * the cap rather than the two firing independently.
 */
/** Push one taught Mage-Pup into the hand (no cap logic here — each SOURCE owns its own budget). */
function pushTaughtPup(state: RunState, spellId: string): boolean {
  const spell = CARD_INDEX[spellId];
  if (!spell?.spell) return false;
  if (state.hand.length >= handCap(state)) return false; // no room — don't burn the teach on a card that can't land
  const def = CARD_INDEX['b2_magepup'];
  if (!def) return false;
  state.hand.push({
    uid: `t${state.uidSeq++}`,
    cardId: def.id,
    tribe: def.tribe,
    attack: def.attack,
    health: def.health,
    keywords: [...def.keywords],
    golden: false,
    taughtSpellId: spellId,
  });
  return true;
}

/** A specific MENTOR's teach — per-instance (owner report 2026-08-07: two Mentors + two Waking Rifts paid one
 *  Pup, because every copy shared one run-level "once per turn" counter). Each Mentor now carries its own
 *  latch (`teachTick`, reset each turn): with two Mentors on board, the first spell bought teaches BOTH. */
export function teachMagePupFrom(state: RunState, mentor: BoardCard, spellId: string): void {
  const cap = mentor.golden ? 2 : 1; // a golden Mentor teaches twice a turn, as it always did
  if ((mentor.teachTick ?? 0) >= cap) return;
  if (pushTaughtPup(state, spellId)) mentor.teachTick = (mentor.teachTick ?? 0) + 1;
}

/** Rune of the White Wolf's own teaches — the run-level counter now serves ONLY the rune (each copy is one
 *  teach a turn), never the Mentors, so the rune and the bodies no longer eat each other's budget. */
export function teachMagePup(state: RunState, spellId: string): void {
  const wolves: number = state.runeWhiteWolf === true ? 1 : (typeof state.runeWhiteWolf === 'number' ? state.runeWhiteWolf : 0);
  const used = state.moonhowlTeachesThisTurn ?? 0;
  if (used >= wolves) return;
  if (!pushTaughtPup(state, spellId)) return;
  state.moonhowlTeachesThisTurn = used + 1;
}

/**
 * Rune of the Spellstone: make a Ruby cast COUNT as a Shop-spell cast.
 *
 * Deliberately NOT `noteSpellCast`. That function also fires the Ruby+Spell umbrella and consumes the Living
 * Grimoire charge, and the Ruby cast path in the reducer already does both — routing a Ruby through it would
 * double-fire every "every 3 casts" card and mis-spend the Grimoire. This does only the parts that make a Ruby
 * read as a Shop spell: the run and per-turn tallies, the board's `spellCast` watchers, and the spellCast rune
 * meter. The quest meter rides the reducer's `spellsCast` delta, so it follows for free.
 */
export function countRubyAsShopSpell(state: RunState, rubyDef: CardDef, casts: number): void {
  if (casts <= 0) return;
  state.spellsCast += casts;
  state.spellsThisTurn += casts;
  advanceRuneThresholds(state, 'spellCast', casts);
  advanceRuneThresholds(state, 'spellCastNonAle', casts); // a Ruby is not an Ale
  const ctx = makeContext(state);
  for (let i = 0; i < casts; i++) {
    for (const card of [...state.board]) {
      const def = CARD_INDEX[card.cardId];
      if (!def) continue;
      const reps = state.runeMatriarch && card.cardId === 'b2_runebloom' ? 2 : 1; // Rune of the Matriarch
      for (const effect of def.effects) {
        if (effect.on !== 'spellCast') continue;
        const fn = RECRUIT_FACTORIES[effect.do];
        if (fn) for (let rep = 0; rep < reps; rep++) captureBuffFx(ctx.state, card, 'minion', () => fn(ctx, card, effect.params ?? {}, { minion: card, spellDef: rubyDef }));
      }
    }
  }
}

/**
 * THE GOLD-GAIN CHOKEPOINT. Every path that hands the player Gold routes through here.
 *
 * Added 2026-07-30 for Rune of Profit Sharing ("whenever you gain Gold, give your Dwarves +3/+3"), which had no
 * single site to hang off — Gold was added in a dozen places across the reducer and the recruit factories, and
 * wiring eleven of them would have shipped a rune that silently misses whichever income the twelfth provides.
 *
 * Spending has its own path (`spendGold` in the reducer); this is the credit side only.
 */
export function gainGold(state: RunState, amount: number): void {
  if (amount <= 0) return;
  state.embers += amount;
  // Rune of the Golden Splinter: the FIRST time Gold reaches the mark, a random Golden T`tier` minion — then
  // the rune is spent (cleared), so it can never pay twice.
  const gs = state.runeGoldenSplinter;
  if (gs && state.embers >= gs.at) {
    procRune(state, 'runeGoldenSplinter');
    // One Golden minion per copy held at the single trip (threshold family, owner 2026-08-27: doubled payoff,
    // still once per run).
    const splinters = runeStacksOf(state, 'rune_golden_splinter');
    state.runeGoldenSplinter = undefined;
    const pool = poolOf(state).all.filter((c) => !c.spell && !c.token && !c.ruby && c.tier === gs.tier);
    for (let k = 0; k < splinters; k++) {
      if (pool.length > 0 && state.hand.length < handCap(state)) {
        const rng = makeRng(state.rngCursor);
        const pick = pool[rng.int(pool.length)]!;
        state.rngCursor = rng.state();
        state.hand.push({ uid: `b${state.uidSeq++}`, cardId: pick.id, tribe: pick.tribe, attack: pick.attack * 2, health: pick.health * 2, keywords: [...pick.keywords], golden: true });
      }
    }
  }
  const ps = state.runeProfitSharing;
  if (ps) {
    procRuneId(state, 'rune_profit_sharing');
    // Buffs the tribe wherever it is (board + hand), like every other "+X/+X to your <tribe>" run effect.
    for (const c of [...state.board, ...state.hand]) {
      if (isTribe(c, ps.tribe)) addBuff(c, 'Rune of Profit Sharing', ps.attack, ps.health);
    }
  }
}

/** Total shop-spell cost reduction: the stored `spellCostMod` plus 1 per Lazarus on the board (golden → 2). */
export function spellCostReduction(state: RunState, def?: CardDef): number {
  let n = state.spellCostMod;
  for (const c of state.board) if (c.cardId === 'lazarus') n += c.golden ? 2 : 1;
  n += gateUses(state.cadenceSpellOff); // Rune of Cadence: the armed one-shot spell discount, −1 per copy held (spent at buy)
  n += state.spellCostOffTurn ?? 0;  // GIFT — Arcane Clearance: this turn only
  // Rune of Thrift: STAT-GRANTING spells cost 2 less. Gated on the def (callers without one see no change).
  if (state.runeThrift && isStatSpell(def)) n += 2 * runeStacksOf(state, 'rune_thrift'); // −2 per copy held (owner 2026-08-27: "Thrift −4")
  return n;
}

/** Cast factories that GIVE STATS but are not named `spellBuff*` — the handful the prefix rule can't see. */
const STAT_SPELL_EXTRAS: ReadonlySet<string> = new Set([
  'spellAverageStats', // Equalize: every friendly ends at the average — it changes stats
  'rubyStatGain',      // Facetwright's Choice: your Rubies gain +1 Attack / +1 Health
  // Deliberately NOT here, having been checked rather than assumed: `spellAttackFirst` only sets an initiative
  // flag, `spellBloodlust` marks an out-of-turn attack, and `spellGainSpellPower` raises FUTURE spells' power.
  // None of the three puts stats on anything, so none is a "spell that gives stats".
]);

/** "Gives stats" — Rune of Thrift discounts these, and Rune of the Gilded Ledger casts one, so the two can
 *  never disagree about what a stat spell IS.
 *
 *  Derived rather than hand-listed (owner report 2026-08-26: "any spell that gives stats should be
 *  discounted"). It used to name FIVE factories explicitly, which silently missed every stat spell added
 *  since — `spellBuffTargetAndNeighbours`, `spellBuffByTier`, `spellBuffPerDragonPlayed`,
 *  `spellBuffTargetPerGold`, `spellBuffRandomPerTribe`, the shop-buff family, and more. The `spellBuff`
 *  PREFIX is the naming convention the whole buff family already follows, so new members are covered the day
 *  they are authored; `STAT_SPELL_EXTRAS` carries the few stat granters that sit outside that convention. */
export function isStatSpell(def: CardDef | undefined): boolean {
  return !!def?.effects.some((e) => e.on === 'cast' && (e.do.startsWith('spellBuff') || STAT_SPELL_EXTRAS.has(e.do)));
}

/** Stat spells that put their stats on YOUR BOARD. The shop-buff family gives stats too — so Rune of Thrift
 *  rightly discounts them — but "CAST a stat spell" (Rune of the Gilded Ledger) means a payout the player can
 *  see on their minions, not a buff to offers they may never buy. Splitting the two predicates is deliberate:
 *  they were one function, and broadening the discount silently changed what the Ledger casts. */
const SHOP_TARGETED_STAT_SPELLS: ReadonlySet<string> = new Set([
  'spellBuffShop', 'spellBuffShopByRuby', 'spellBuffTavern', 'spellBuffNextShop',
]);
export function isBoardStatSpell(def: CardDef | undefined): boolean {
  return isStatSpell(def)
    && !!def?.effects.some((e) => e.on === 'cast' && !SHOP_TARGETED_STAT_SPELLS.has(e.do)
      && (e.do.startsWith('spellBuff') || STAT_SPELL_EXTRAS.has(e.do)));
}

/**
 * Total bonus max-mana-per-turn the board currently grants (Money Bot, or a Mech it magnetized
 * into). Each card contributes its def's `manaPerTurn` (×2 if golden) plus any absorbed `manaBonus`.
 * Summed fresh from the board each turn, so selling the source removes its income.
 */
export function boardManaBonus(state: RunState): number {
  return state.board.reduce((sum, c) => {
    const per = CARD_INDEX[c.cardId]?.manaPerTurn ?? 0;
    return sum + per * (c.golden ? 2 : 1) + (c.manaBonus ?? 0);
  }, 0);
}

/**
 * Pick up to `count` distinct friendly **Mech** uids for a Combinator weld — chosen at *random*, not
 * by Attack. Seeded by (run seed, wave, the Combinator's board `slot`, `proc`), so the selection is
 * unpredictable yet reproducible: each proc welds onto a fresh random set, and the UI can derive the
 * exact same uids (to electrify them) without the sim having to resolve first. Excludes `selfUid`;
 * dual-type Mechs (Heckbinder) count. Does not mutate `board`.
 */
export function magnetizeTargets(
  board: BoardCard[],
  selfUid: string,
  count: number,
  seed: number,
  wave: number,
  slot: number,
  proc: number,
): string[] {
  const eligible = board.filter((c) => c.uid !== selfUid && isTribe(c, 'mech'));
  const rng = makeRng(mixSeed(seed, wave, TAG.MAGNET, slot, proc));
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = rng.int(i + 1); // Fisher-Yates with the seeded RNG
    const tmp = eligible[i]!;
    eligible[i] = eligible[j]!;
    eligible[j] = tmp;
  }
  return eligible.slice(0, count).map((c) => c.uid);
}

/** The contribution a magnetic welds onto a host: its stats, its non-Magnetic keywords, and any mana
 *  income it carries (Money Bot). */
export interface MagnetPayload {
  source: string;
  attack: number;
  health: number;
  keywords: Keyword[];
  mana: number;
  /** Better Bot: Rally-Mech Attack this magnetic carries onto its host (already golden-baked). */
  rallyMechAtk?: number;
  /** Perfect Core: number of "Rally: get a random spell" grants this magnetic carries onto its host
   *  (already golden-baked). */
  rallySpell?: number;
  /** Heckbinder: Fodder aura this magnetic carries onto its host (already golden-baked). */
  fodderAura?: { attack: number; health: number };
  /** Spell-power aura this magnetic carries onto its host (already golden-baked; no card in the current set). */
  spellAura?: number;
}

/** Apply a magnetic's contribution to one host (×mult): stats (as a tracked buff), keywords (minus
 *  Magnetic), and mana income. */
function applyWeld(host: BoardCard, mag: MagnetPayload, mult: number): void {
  addBuff(host, mag.source, mag.attack * mult, mag.health * mult);
  for (const k of mag.keywords) {
    // The Attachment (M) keyword does NOT transfer to the host (owner ruling 2026-07-09, reversing 2026-07-08):
    // welding an attachment onto a minion must not turn that minion into a Magnetic/Attachment itself (a Herald
    // was showing up as Magnetic). The host still inherits the Scrap Herald *aura* — see `bakeAttachmentAura`,
    // now decoupled from the keyword. Every OTHER welded keyword (Ward, Reborn, Rally, …) still rides along.
    if (k === 'M') continue;
    // Assign a FRESH array rather than push in place: some copy paths shallow-spread a BoardCard and thus SHARE
    // its `keywords` array, so an in-place push would leak the welded keyword (e.g. Perfect Core's Ward) onto the
    // aliased minion — two same-cardId minions then both carry a Divine Shield in combat (owner-reported bug).
    if (!host.keywords.includes(k)) host.keywords = [...host.keywords, k];
  }
  if (mag.mana > 0) host.manaBonus = (host.manaBonus ?? 0) + mag.mana * mult;
  if (mag.rallyMechAtk) host.rallyMechAtk = (host.rallyMechAtk ?? 0) + mag.rallyMechAtk * mult;
  if (mag.rallySpell) host.rallySpellWeld = (host.rallySpellWeld ?? 0) + mag.rallySpell * mult;
  if (mag.spellAura) host.spellAuraBonus = (host.spellAuraBonus ?? 0) + mag.spellAura * mult;
  if (mag.fodderAura) {
    const cur = (host.fodderAuraBonus ??= { attack: 0, health: 0 });
    cur.attack += mag.fodderAura.attack * mult;
    cur.health += mag.fodderAura.health * mult;
  }
}

/**
 * Weld a magnetic onto `host`, then let any Beatboxer mimic it. Beatboxer copies every magnetization
 * that lands on *another* unit (a magnetization onto a Beatboxer itself is just the `host` weld below,
 * counted once); a golden Beatboxer mimics each one twice. Both magnetization paths — the player dropping
 * a Magnetic on a Mech, and Combinator's End-of-Turn weld — route through here.
 *
 * `clings` = how many Cling Drones this weld represents (0 if the magnetic isn't a Cling). Each Cling
 * magnetized — onto the host AND each copy Beatboxer mimics onto itself — stacks the Cling improvement.
 */
/** Attachment Conductor (Tier 7): "your attachments attach twice" (gilded: three times). Like Drakko, the
 *  BEST single copy counts rather than stacking, so two Conductors don't silently 4x. Returns the number of
 *  times each weld lands — 1 with no Conductor. */
function conductorWelds(state: RunState): number {
  let best = 1;
  for (const c of state.board) if (c.cardId === 'attachmentconductor') best = Math.max(best, c.golden ? 3 : 2);
  return best;
}

export function weldMagnetic(state: RunState, host: BoardCard, mag: MagnetPayload, clings = 0, kind: 'play' | 'auto' = 'auto'): void {
  const reps = conductorWelds(state); // Attachment Conductor multiplies EVERY weld, the host's and the mirrors'
  applyWeld(host, mag, reps);
  host.attachments = (host.attachments ?? 0) + reps; // Attachments welded on — drives Blueprint Cache
  bakeAttachmentAura(state, host);
  const welded = [host.uid]; // every minion this weld lands on — ALL of them animate (a Beatbot mirrors it)
  let totalClings = clings * reps; // Clings welded onto the host
  for (const bb of state.board) {
    if (bb.cardId === 'beatboxer' && bb.uid !== host.uid) {
      const mult = (bb.golden ? 2 : 1) * reps;
      applyWeld(bb, mag, mult);
      bb.attachments = (bb.attachments ?? 0) + mult; // Beatboxer mirrors the weld onto itself
      bakeAttachmentAura(state, bb);
      welded.push(bb.uid);
      totalClings += clings * mult; // Beatboxer magnetizes Cling copies onto itself — those stack too
    }
  }
  if (totalClings > 0) improveClingDrones(state, totalClings);
  stampWeldFx(state, welded, kind); // FX cue — stamped AFTER the mirror loop so Beatbots are included
}

/** A minion that RECEIVES an attachment inherits the run-wide Attachment aura (Scrap Herald's
 *  `magneticBuyAtk`/`magneticBuyHp`) ONCE, so "your Attachments have +X/+Y wherever they are" reaches welded
 *  hosts too — WITHOUT the host gaining the M keyword (owner ruling 2026-07-09; see applyWeld). Skips minions
 *  printed as Magnetic (they already got the aura at buy) and hosts already baked on an earlier weld. */
function bakeAttachmentAura(state: RunState, card: BoardCard): void {
  if (CARD_INDEX[card.cardId]?.keywords.includes('M')) return; // printed Magnetic → aura applied at buy time
  if (card.buffs?.some((b) => b.source === 'Attachment')) return; // already baked on a previous weld
  const a = state.magneticBuyAtk ?? 0;
  const h = state.magneticBuyHp ?? 0;
  if (a > 0 || h > 0) addBuff(card, 'Attachment', a, h);
}

/**
 * Cling Drones improve +1/+1 per magnetization. `times` = how many Clings were just magnetized (the
 * player drops one; Combinator welds several). It persists as a `cling` run enchantment (so future
 * Clings — bought or Combinator-welded — are bigger) AND buffs any Clings already on the board / in hand
 * right now, mirroring Ritualist's Fodder enchantment. Scales with Combinator, which welds Clings every turn.
 */
export function improveClingDrones(state: RunState, times: number): void {
  if (times <= 0) return;
  state.cardBuffs ??= {};
  const cur = (state.cardBuffs.cling ??= { attack: 0, health: 0 });
  cur.attack += times;
  cur.health += times;
  for (const c of [...state.board, ...state.hand]) {
    if (c.cardId === 'cling') addBuff(c, 'Magnetized', times, times);
  }
}

/**
 * Conjure up to `reps` random minions from `pool` into the hand (Summon Stone / Tribes Choice),
 * advancing the run's seeded RNG cursor. Each conjured copy carries any persistent run buff
 * (Ritualist), leaves the shared pool (`takeFromPool`), and respects the hand cap. No-op on an
 * empty pool. Mirrors `battlecryGainRandomMinion`'s conjure path.
 */
/**
 * Grant ONE specific minion as a guaranteed quest reward — to hand, or to the BOARD when the hand is full (Leader
 * of the Pack's golden Pack Leader was silently dropped on a full hand, so the capstone gave only its Gold). Both
 * full → keep it in hand over the cap rather than lose a promised reward (a rare turn-11 edge). `golden` gilds it.
 * Returns the created card so the caller can stamp extra keywords (Apex Hunt). Buffs mirror `conjureToHand`.
 */
export function grantMinionToHandOrBoard(state: RunState, def: CardDef, golden: boolean, overflow = false): BoardCard {
  const cb = cardBuff(state, def.id);
  const card: BoardCard = {
    uid: `b${state.uidSeq++}`,
    cardId: def.id,
    tribe: def.tribe,
    attack: def.attack + cb.attack + undeadBuyBonus(state, def),
    health: def.health + cb.health + buyHealthAura(state, def),
    keywords: [...def.keywords],
    golden: false,
  };
  if (state.hand.length < handCap(state)) state.hand.push(card);
  else if (state.board.length < CONFIG.boardMax) state.board.push(card); // hand full → onto the board
  else if (overflow) state.hand.push(card); // quest / rune REWARD cards may over-cap the hand (owner ruling — never lose an earned reward)
  else return card; // otherwise the hand is a hard 10-card cap: hand + board both full → drop, never over-capped
  if (golden) gildMinion(card);
  takeFromPool(state, def.id); // only claim a pool copy for a card we actually placed
  return card;
}

export function conjureToHand(state: RunState, pool: CardDef[], reps: number, overflow = false): void {
  if (pool.length === 0) return;
  // RUNE OF THE RUNIC HOARD: every Shop spell copied into your hand gives your Dragons +1/+1. Hooked at the
  // shared conjure chokepoint, so it pays for a Steward copy, a Recaller copy and a rune grant alike. Gated on
  // the pool being spells: `conjureToHand` also hands over minions, which the rune says nothing about.
  if (state.runeRunicHoard && pool.every((c) => c.spell)) {
    procRune(state, 'runeRunicHoard');
    // +1/+1 per copy held (recurring family, owner 2026-08-27).
    const rh = runeStacksOf(state, 'rune_runic_hoard');
    for (let i = 0; i < reps; i++) {
      for (const c of state.board) {
        const d = CARD_INDEX[c.cardId];
        if (d?.tribe === 'dragon' || d?.tribe2 === 'dragon') addBuff(c, 'Rune of the Runic Hoard', rh, rh);
      }
    }
  }
  const rng = makeRng(state.rngCursor);
  // `overflow` (quest / rune reward grants) bypasses the hand cap so an earned reward is never dropped.
  //
  // A pending DISCOVER keeps its slot: the player is being asked to choose a card, and a passive grant that
  // fills the last space in the meantime would silently destroy that choice (owner ruling 2026-08-04 — a
  // golden Spell Warden's copies must yield to a card being discovered). `reservedHandSlots` counts the open
  // prompt plus anything queued behind it, so a chain of Discovers each keeps one.
  const cap = handCap(state) - reservedHandSlots(state);
  // WHICH cards landed, in order — `onGainCard` watchers that filter on the arriving card (Kegheart Dwarf on a
  // Dwarven Ale) need the id, and a mixed pool can hand over a different card on each rep.
  const addedIds: string[] = [];
  let added = 0;
  for (let i = 0; i < reps && (overflow || state.hand.length < cap); i++) {
    const def = pool[rng.int(pool.length)]!;
    const cb = cardBuff(state, def.id);
    state.hand.push({
      uid: `b${state.uidSeq++}`,
      cardId: def.id,
      tribe: def.tribe,
      attack: def.attack + cb.attack + undeadBuyBonus(state, def),
      health: def.health + cb.health + buyHealthAura(state, def),
      keywords: [...def.keywords],
      golden: false,
    });
    takeFromPool(state, def.id);
    addedIds.push(def.id);
    added++;
  }
  state.rngCursor = rng.state();
  // Gangplank: fire once per card actually conjured into hand (Ale, Shop spell, granted minion). After the
  // cursor is settled so a watcher that re-rolls RNG can't perturb this conjure's stream. No recursion — the
  // watcher adds no card.
  // Fire for each arrival AND stamp the ledger, so `reduce`'s hand diff (which exists to catch the other ~17
  // insertion sites) doesn't fire for these same cards a second time.
  for (let a = 0; a < added; a++) {
    const arrived = state.hand[state.hand.length - added + a];
    if (arrived) (state.gainCardFiredUids ??= []).push(arrived.uid);
    fireOnGainCard(state, addedIds[a]);
  }
}

/** The Ruby token id (set 2). A Ruby minted into hand carries the run's live strength baked in. */
export const RUBY_ID = 'ruby';

/**
 * A Ruby's stat bonus over its printed 1/1 — the ONE read every Ruby source must use (owner ask 2026-08-14).
 *
 * Normally this is just the run's `rubyBonus`. With **Rune of the Spellstone** it also includes the run's SPELL
 * power, because that rune's whole promise is "Rubies you cast count as Shop spells" — and a Shop spell picks up
 * your spell buffs. Before this, the rune only made a Ruby *tick the spell-cast watchers*: it counted as a spell
 * for everything except the one thing a spell is actually worth. Folding the power in here means every
 * downstream consumer inherits it for free, exactly as the owner asked — combat-played Rubies (the combat side
 * reads this value off the snapshot), Veinstorm's shop stamp and its bank, Motherlode, Mountainbond, and the
 * printed card text.
 *
 * Attack and Health are read separately because spell power is asymmetric (`spellBonus.attack` vs `.health`).
 */
export function rubyStatBonus(state: RunState): { attack: number; health: number } {
  const rb = state.rubyBonus ?? { attack: 0, health: 0 };
  if (!state.runeSpellstone) return rb;
  return { attack: rb.attack + spellAttackBonus(state), health: rb.health + spellHealthBonus(state) };
}

/**
 * Mint `count` Rubies into the player's hand (set 2 Kobolds). Each Ruby is minted at the token's base 1/1 plus
 * the run's current `rubyBonus`. A later "Your Rubies gain +X" grows every Ruby still in HAND too (see
 * `rubyStatGain`), so all held Rubies stay equal to base + rubyBonus; only Rubies already CAST onto a minion
 * (their buff baked in) don't grow. Respects the hand cap. Deterministic (no RNG) — same card, same Ruby.
 */
export function mintRubies(
  state: RunState,
  count: number,
  rubyId: string = RUBY_ID,
  statOverride?: { attack: number; health: number },
  /** Skip the `onGetRuby` round for these Rubies. Set ONLY by a mint that is itself an `onGetRuby` reaction
   *  (Gem Sage's duplicate) — without it, "when you get a Ruby, get another" recurses without end. The
   *  `onGainCard` round still fires: a duplicate really is a card arriving in hand. */
  silent = false,
): void {
  const def = CARD_INDEX[rubyId];
  if (!def) return;
  // Rune of Gemcutting mints at a FIXED line (3/3) instead of the run's 1/1 + rubyBonus.
  // `rubyStatBonus`, not raw `rubyBonus`: Rune of the Spellstone folds spell power in (2026-08-14). Gemcutting's
  // fixed 3/3 override still wins outright — it mints "Rubies that give +3/+3", full stop.
  const bonus = statOverride ? { attack: statOverride.attack - def.attack, health: statOverride.health - def.health } : rubyStatBonus(state);
  let minted = 0;
  for (let i = 0; i < count && state.hand.length < handCap(state); i++) {
    state.hand.push({
      uid: `b${state.uidSeq++}`,
      cardId: rubyId,
      tribe: def.tribe,
      attack: def.attack + bonus.attack,
      health: def.health + bonus.health,
      keywords: [...def.keywords],
      golden: false,
    });
    minted++;
  }
  // Set 2 — Candle Conduit: "when you get a Ruby" fires once per Ruby actually minted. A reaction only PLAYS a
  // Ruby (never mints), so this can't recurse.
  if (!silent) for (let r = 0; r < minted; r++) fireOnRubyGained(state);
  // Gangplank: a minted Ruby is a card added to hand. Watchers add no card, so no recursion.
  // Same contract as `conjureToHand`: fire per minted Ruby and stamp the ledger against the reduce-level diff.
  for (let i = 0; i < minted; i++) {
    const arrived = state.hand[state.hand.length - minted + i];
    if (arrived) (state.gainCardFiredUids ??= []).push(arrived.uid);
    fireOnGainCard(state, rubyId);
  }
}

/** Set 2 — fire every board minion's `onGetRuby` effects (Candle Conduit) when a Ruby is gained, plus the
 *  run-level Motherlode reward, which is the same rule with no minion source. */
function fireOnRubyGained(state: RunState): void {
  const ml = state.motherlode;
  if (ml) {
    procRuneId(state, 'rune_motherlode');
    // A Ruby is base 1/1 plus the run's live `rubyBonus` — the same value every other Ruby source mints at, so
    // a late-run Motherlode pays full strength rather than 1/1.
    const bonus = rubyStatBonus(state);
    for (let c = 0; c < ml.count; c++) {
      const pool = ml.tribe ? state.board.filter((m) => isTribe(m, ml.tribe!)) : [...state.board];
      if (pool.length === 0) break;
      const rng = makeRng(state.rngCursor);
      const target = pool[rng.int(pool.length)]!;
      state.rngCursor = rng.state();
      addBuff(target, 'Motherlode', 1 + bonus.attack, 1 + bonus.health);
    }
  }
  for (const card of state.board) {
    const def = CARD_INDEX[card.cardId];
    if (!def?.effects.some((e) => e.on === 'onGetRuby')) continue;
    const ctx = makeContext(state);
    for (const eff of def.effects) {
      if (eff.on !== 'onGetRuby') continue;
      RECRUIT_FACTORIES[eff.do]?.(ctx, card, eff.params ?? {}, { minion: card });
    }
  }
}

/**
 * Fire a minion's Deathrattle(s) OUT OF COMBAT — Graverobber's destroy (and any future destroy/consume-a-minion
 * path). Runs each `onDeath` recruit factory once, then once more per **Sylus the Reaper** on the board (golden
 * ×2), the shop-phase mirror of combat's reaper bonus (owner ruling 2026-07-08). Combat-only rattles (no recruit
 * factory) are simply inert. Ticks the run Deathrattle tally ONCE, BEFORE firing, so tally-based rattles (Grim)
 * count this death — matching combat, where the death increments the tally before the rattle runs.
 */
function fireRecruitDeathrattles(ctx: RecruitContext, minion: BoardCard, effectsOverride?: EffectDef[]): void {
  // Ex-Galloper's copy is summoned "WITHOUT the Echo" — the no-chain guard. A BoardCard has no per-instance
  // effects list to strip, so the copy is marked and skipped here (the shop mirror of combat's effects filter).
  if (minion.echoStripped) return;
  // A Gravetwin's Echo lives in `copiedEcho` (not its def) — fold it in so triggering "this minion's Echo"
  // (Ossuary Rite / Deathsayer / Reliquary) fires the copied effect too, not nothing (owner bug 2026-07-13).
  const effects = effectsOverride ?? [...(CARD_INDEX[minion.cardId]?.effects ?? []), ...(minion.copiedEcho ?? [])];
  if (!effects.length) return;
  const hasDR = effects.some((e) => e.on === 'onDeath');
  // THE ECHO CUE (owner ask 2026-08-28): "the echo animation ... should play ANYTIME an echo is triggered".
  // Stamped HERE because this is the single chokepoint every shop Echo passes through — a destroy, Ossuary
  // Rite, Deathsayer, Rune of the Reliquary, a Gravetwin's copied Echo, a borrowed body's departure. Putting
  // it at the call sites instead is how the next one silently ships without its animation.
  if (hasDR) stampShopFx(ctx.state, { kind: 'echo', uid: minion.uid, cardId: minion.cardId });
  const fireOnce = (): void => {
    for (const eff of effects) {
      if (eff.on !== 'onDeath') continue;
      captureBuffFx(ctx.state, minion, 'deathrattle', () => RECRUIT_FACTORIES[eff.do]?.(ctx, minion, eff.params ?? {}, { minion }));
    }
  };
  if (hasDR) ctx.state.deathrattlesTriggered += 1; // base trigger, before firing (Grim counts its own death)
  fireOnce();
  // THE Echo-multiplier set, unified with combat (`playerEchoExtras`) through `foldEchoExtraFires` — owner
  // principle 2026-08-20: trigger multipliers follow the trigger to whatever phase it fires in. A shop Echo
  // now fires extra times for:
  //   - Sylus (stacking) + Uron (best copy), from card data. The dying minion is excluded — a Sylus that is
  //     itself the one dying doesn't re-fire its own Echo (already the shop rule; combat filters the dead).
  //   - Elderhorn's Beast Ritual (`beastRitualExtra`) — a BEAST Echo only, matching combat's tribe gate.
  //   - Funeral Engine's permanent `echoExtraAlways`.
  //   - Grave Contract / Last Rites / Rune of the Catacomb's first-Echo bonus, scoped to the FIRST shop Echo
  //     each TURN (the shop analogue of combat's per-fight `firstEchoDone`; the two pools are independent —
  //     combat still pays its own first Echo of every fight).
  const reaper = extraTriggerFires('deathrattle', ctx.state.board.filter((c) => c.uid !== minion.uid), (id) => CARD_INDEX[id]);
  const beastRitualExtra = isTribe(minion, 'beast') ? ctx.state.beastRitualExtra ?? 0 : 0;
  let firstEchoBonus = 0;
  if (hasDR && (ctx.state.echoFirstEachCombat ?? 0) > 0 && !ctx.state.echoFirstUsedThisTurn) {
    ctx.state.echoFirstUsedThisTurn = true;
    firstEchoBonus = ctx.state.echoFirstEachCombat ?? 0;
    procRuneId(ctx.state, 'rune_catacomb'); // pulse the badge, as combat's fireTrigger('runeCatacomb') does
  }
  const extra = hasDR
    ? foldEchoExtraFires({ reaperExtras: reaper, beastRitualExtra, echoExtraAlways: ctx.state.echoExtraAlways ?? 0, firstEchoBonus })
    : 0;
  for (let r = 0; r < extra; r++) fireOnce(); // re-fires read the same tally (value at death)
  if (hasDR) {
    ctx.state.deathrattlesTriggered += extra; // …then the extra triggers count for the quest/Grim tally
    // Record the Echo triggers (base + every extra fire) so the reducer's `deathrattle` quest tick counts this
    // out-of-combat Echo like a combat one (Grave Contract / Ossuary Rite / Author's Hand, …). Accumulates across
    // multiple fires in one action (e.g. several Gravetwins on turn-open).
    ctx.state.lastEchoFires = (ctx.state.lastEchoFires ?? 0) + 1 + extra;
  }
}

/**
 * DESTROY A MINION IN THE SHOP — the one path every shop destroy goes through, so death, Echo and Rise are
 * always the same ritual (and always land on their own beats).
 *
 * Mirrors combat's death sequence (`simulate.ts`, the `rebornAvailable` block) rather than re-inventing it:
 *
 *   1. the body LEAVES its slot first — so the Echo's summons can fill the space it vacated,
 *   2. the Echo fires (`fireRecruitDeathrattles`, with its Sylus/Uron/Elderhorn multipliers),
 *   3. on-death WATCHERS are notified (owner ruling 2026-08-26: a shop destroy is a real death),
 *   4. RISE returns the body to the RIGHT of anything the Echo summoned — at its BASE Attack (golden ×2) with
 *      **1 Health**, shedding buffs and spending the keyword. That is the owner's Rise contract verbatim
 *      ("it returns with 1 health and base attack before any auras or effects are added", ruling on
 *      `q-conv-keyword-r`, 2026-08-28) and exactly what combat does.
 *
 * Rise in the SHOP is new (owner ruling 2026-08-28). It used to be combat-only — `rebornAvailable` is armed by
 * combat's `instantiate` — so a Graverobber ate a Rise carrier outright. `opts.rise: false` opts a caller out:
 * Funeral on Loan's borrowed body is not dying, its LOAN is ending, and a Rise there would let a borrowed
 * minion stay on the board, which is the one thing that card must never do.
 */
/** Record a shop cue (a death, or an Echo triggering) for the UI to play. Per-action scratch: `reduce` clears
 *  the list and the UI reads it once, gated on `shopFxSeq`. */
/**
 * Fire an Equipment's triggers. Lives HERE, not in the reducer, because the recruit factory table is private
 * to this module — effect resolution belongs beside the effects, and the reducer keeps owning the ACTION
 * (validation, Gold, the shared allowance).
 *
 * `triggers` is a COUNT the caller snapshot before the loop. Every repeat uses the SAME target (handoff);
 * an Equipment with a random target re-rolls inside its own factory, exactly as every other repeated effect
 * in this engine already does.
 */
export function fireEquipmentTriggers(
  state: RunState,
  def: EquipmentDefinition,
  version: 'plain' | 'gilded',
  self: BoardCard,
  target: BoardCard | undefined,
  triggers: number,
): boolean {
  const fn = RECRUIT_FACTORIES[def.effectId];
  if (!fn) return false; // an unknown effect id is a content error — never a paid-for no-op
  const ctx = makeContext(state);
  const params = equipmentParamsFor(def, version);
  for (let t = 0; t < triggers; t += 1) {
    withEquipmentTriggerBeat(state, def.id, t, () => {
      fn(ctx, self, params, { minion: self, ...(target ? { target } : {}) });
    });
  }
  return true;
}

/**
 * ONE Equipment TRIGGER, on its own beat. Each repeat is a separate trigger for listeners and for the Beat
 * Lab, carrying its index — which is the causality the replay cannot store (replay v2 is state replay), so
 * it lives here on the presentation channel instead. See `docs/replay-v2-causality.md`.
 */
export function withEquipmentTriggerBeat(state: RunState, equipmentId: string, index: number, run: () => void): void {
  withRecruitTrigger(
    makeContext(state),
    {
      phase: 'recruit',
      source: { kind: 'system', id: `equipment:${equipmentId}`, label: 'Equipment', side: 'player' },
      trigger: 'equipmentTrigger',
      policy: 'ownBeat',
      policyKey: 'system:equipment:trigger',
      repeatIndex: index,
    },
    run,
  );
}

/** Record an equip / re-equip cue for the UI. Same per-action scratch contract as `stampShopFx`. */
export function stampEquipFx(state: RunState, fx: EquipFx): void {
  (state.equipFx ??= []).push(fx);
  state.equipFxSeq = (state.equipFxSeq ?? 0) + 1;
}

export function stampShopFx(state: RunState, fx: ShopDeathFx): void {
  (state.shopDeathFx ??= []).push(fx);
  state.shopFxSeq = (state.shopFxSeq ?? 0) + 1;
}

export function destroyMinionInShop(
  ctx: RecruitContext,
  target: BoardCard,
  opts?: { rise?: boolean },
): void {
  const state = ctx.state;
  const idx = state.board.indexOf(target);
  if (idx < 0) return;
  const def = CARD_INDEX[target.cardId];
  const willRise = opts?.rise !== false && target.keywords.includes('R');
  // Tell the beat collector's departure diff this body is coming back, so the death plays without the slot
  // reading as freed for good.
  // Set FRESH per destroy, never cleared in a `finally`: the beat collector's departure diff runs AFTER this
  // whole function returns (it diffs around `run()`), so clearing on the way out would hide the flag from the
  // one reader it exists for. Each destroy resets it, so nothing can go stale.
  RISING = willRise ? new Set([target.uid]) : null;
  stampShopFx(state, { kind: 'death', uid: target.uid, cardId: target.cardId, ...(willRise ? { rise: true } : {}) });
  const wasVacating = state.vacatingUid;
  try {
    // 1. The body STAYS in its slot while its Echo fires, marked VACATING — the same mechanism Funeral on
    //    Loan uses. Two things depend on it, and both were broken when this removed the body first:
    //      · POSITION. `summon(card, nearUid)` splices next to the summoner; with the summoner already gone
    //        `nearUid` resolves to -1 and the summons APPEND right-most. A Graverobber eating a minion in slot 1
    //        put its two Imps at the far end of the board instead of in its place (owner report 2026-08-28:
    //        "it should be summoned as if the minion died where it did").
    //      · CAPACITY. A vacating body must not consume a summon slot, or an Echo that summons is silently
    //        dead on a full board.
    //    Combat reaches the same result the other way round (remove, then summon into the vacated slot); what
    //    matters is that the summons end up where the body died, which is what a player sees.
    state.vacatingUid = target.uid;
    const summonedFrom = state.board.length;
    fireRecruitDeathrattles(ctx, target); // 2. its Echo, anchored on the still-present body
    fireOnFriendDeath(state, target);     // 3. watchers (a shop destroy is a real death)
    state.vacatingUid = wasVacating;
    // 4. …and NOW it leaves. Found by uid: the Echo's summons have shifted the indices around it.
    const gone = state.board.findIndex((c) => c.uid === target.uid);
    if (gone >= 0) state.board.splice(gone, 1);
    // 5. Rise returns into the space it just left — `summonedFrom - 1` discounts the body itself, which was
    //    still on the board when the baseline was taken.
    if (willRise) riseReturn(state, target, gone >= 0 ? gone : idx, Math.max(0, summonedFrom - 1));
  } finally {
    state.vacatingUid = wasVacating;
    /* RISING is reset by the next destroy — see above */
  }
}

/**
 * THE RISE RETURN — one implementation, shared by every shop path that kills a body, so a Rise can never mean
 * two different things depending on which card did the killing (owner correction 2026-08-28: "if a minion has
 * rise that is discovered, it should rise in the same way a destroyed minion with rise would").
 *
 * Combat's contract, verbatim (owner ruling on `q-conv-keyword-r`): the body returns at its **base Attack**
 * (golden ×2) with **1 Health**, "before any auras or effects are added" — so buffs and granted keywords are
 * shed and the Rise itself is spent. The board cap gates it exactly as combat's does: the Echo resolved FIRST,
 * and if its summons took the room the body simply does not come back.
 *
 * @param slot         the index the body occupied before it left
 * @param summonedFrom board length immediately after it left — anything beyond this is what the Echo summoned,
 *                     and the return goes to its RIGHT (owner ruling 2026-07-06).
 */
function riseReturn(state: RunState, target: BoardCard, slot: number, summonedFrom: number): void {
  if (state.board.length >= CONFIG.boardMax) return;
  const def = CARD_INDEX[target.cardId];
  const base = def?.attack ?? target.attack;
  const risen: BoardCard = {
    ...target,
    // A FRESH uid on purpose. The risen body is a new instance — base stats, printed keywords, no buffs —
    // and, load-bearing for presentation: the departure diff reports a death by finding a uid that is no
    // longer on the board. Reusing the uid (as combat does, where an explicit `death` event carries the
    // signal) would mean the body never leaves as far as the diff can see, so the death would animate
    // nowhere and we would be back to the snap this whole change removes.
    uid: `r${state.uidSeq++}`,
    attack: base * (target.golden ? 2 : 1),
    health: 1,
    // Printed keywords minus the spent Rise; granted ones are shed with the buffs.
    keywords: (def?.keywords ?? []).filter((k) => k !== 'R'),
    buffs: undefined,
    // A risen body is a body you now OWN — it is no longer on loan (Funeral on Loan). Without this the flag
    // would ride the clone and the next turn's expiry sweep would look at a card that is not in hand.
    borrowed: undefined,
  };
  const grew = state.board.length - summonedFrom;
  const at = Math.min(state.board.length, slot + Math.max(0, grew));
  state.board.splice(at, 0, risen);
}

/**
 * Start-of-shop trigger for Gravetwin: if it survived the last combat (its cardId is in `lastSurvivorCardIds`),
 * fire each surviving Gravetwin's copied Echo out of combat (golden → twice). Called by the reducer as the next
 * recruit turn opens. Copied summons/buffs bake into the board, Sylus-doubled + tallied like any Echo.
 */
export function fireGravetwinEchoes(state: RunState): void {
  if (!state.lastSurvivorCardIds?.includes('gravetwin')) return;
  const ctx = makeContext(state);
  for (const c of state.board) {
    if (c.cardId !== 'gravetwin' || !c.copiedEcho?.length) continue;
    for (let t = 0; t < (c.golden ? 2 : 1); t++) fireRecruitDeathrattles(ctx, c, c.copiedEcho);
  }
}

/**
 * The player board's most common tribe — counting BOTH tribes of each card (dual-types count for both).
 * Ties resolve to the first seen on the board (insertion order + strict `>`). Null for an empty / tribe-less
 * board. The `s.board` analogue of snapshot.ts's `dominantTribe` (which takes a BoardSnapshot).
 */
export function dominantBoardTribe(state: RunState): Tribe | null {
  const counts = new Map<Tribe, number>();
  for (const c of state.board) {
    const def = CARD_INDEX[c.cardId];
    if (!def) continue;
    for (const t of [def.tribe, def.tribe2]) {
      if (t && t !== 'neutral') counts.set(t, (counts.get(t) ?? 0) + 1); // neutral isn't a "type"
    }
  }
  let best: { tribe: Tribe; count: number } | null = null;
  for (const [tribe, count] of counts) {
    if (!best || count > best.count) best = { tribe, count }; // strict `>` → first seen wins ties
  }
  return best?.tribe ?? null;
}

/**
 * Wayfinder: pick a random ACTIVE tribe (this run's `tribes`) with NO presence on the player's board — a
 * tribe "you do not control". Seeded via the run RNG cursor (advances it). Returns null when you already
 * control every active tribe, in which case the caller Discovers from any tribe. Neutral is never a "tribe".
 */
/** The ACTIVE tribes with NO presence on the player's board — the full "you do not control" set (no RNG
 *  consumed). Wayfinder Discovers across ALL of these (spread), not one, so its 3 options aren't a guaranteed
 *  single tribe — unless you're missing only one. Empty when you control every active tribe. */
export function uncontrolledTribes(state: RunState): Tribe[] {
  const onBoard = new Set<Tribe>();
  for (const c of state.board) {
    const def = CARD_INDEX[c.cardId];
    if (!def) continue;
    for (const t of [def.tribe, def.tribe2]) if (t && t !== 'neutral') onBoard.add(t);
  }
  return state.tribes.filter((t) => t !== 'neutral' && !onBoard.has(t));
}

/**
 * Cassen's Collision payoff: conjure ONE random buyable minion of the board's most common tribe (active
 * tribes + the always-buyable neutral glue, copies left) into the hand. Returns whether a minion was
 * added — false on an empty / tribe-less board, no eligible card, or a full hand, so the caller keeps the
 * kills banked for next time. Reuses `conjureToHand` (seeded rng + pool draw), detecting success via the
 * hand length so the banked count only spends on an actual grant.
 */
export function grantTopTypeMinion(state: RunState): boolean {
  const tribe = dominantBoardTribe(state);
  if (!tribe) return false;
  const pool = poolOf(state).buyable.filter(
    (c) =>
      (c.tribe === tribe || c.tribe2 === tribe) &&
      (c.tribe === 'neutral' || state.tribes.includes(c.tribe)) &&
      c.tier <= state.tier && // bound by your tavern tier — no T6 grant at T2
      (state.pool[c.id] ?? 0) > 0,
  );
  if (pool.length === 0) return false;
  const before = state.hand.length;
  conjureToHand(state, pool, 1);
  return state.hand.length > before; // false if the hand was full (no minion added)
}

/** Re-entry guard for Hunter's recruit-side scaling aura: buffing another minion's Attack can re-fire
 *  `onGainAttack`, so a Hunter buffing a second Hunter must not ping-pong. Cleared after each dispatch. */
const recruitHuntGuard = new WeakSet<object>();

const RECRUIT_FACTORIES: Partial<Record<string, RecruitFn>> = {

  // ═══ OWNER RULINGS 2026-08-26 (Rulebook triage board) — the shop halves the owner ruled IN. Each mirrors
  // its combat body's semantics; see decisions.json for the ruling and the triage card it answered. ═══

  /** MALPHAS — Echo: permanent Shop buff. Fires whenever something triggers its Echo in the shop (Funeral on
   *  Loan, Ossuary Rite, Deathsayer) — "the echo should be able to fire in the shop phase" (owner). */
  deathrattleBuffShopPermanent: (ctx, self, params) => {
    applyRunShopBuff(ctx.state, num(params.attack, 2) * gold(self), num(params.health, 2) * gold(self), nameOf(self));
  },

  /** RUNESNOUT ARCHIVIST — Echo: cast every remembered spell, aimed casts at a random friendly Beast (the
   *  combat body's targeting, mirrored). Golden casts the journal twice. */
  echoCastRememberedSpells: (ctx, self) => {
    const ids = ctx.state.rememberedSpellIds ?? [];
    for (let r = 0; r < gold(self); r++) {
      for (const id of ids) {
        const def = CARD_INDEX[id];
        if (!def?.spell) continue;
        if (def.target) {
          const beasts = ctx.state.board.filter((c) => isTribe(c, 'beast'));
          if (beasts.length === 0) continue; // an aimed spell with no Beast fizzles, per the combat body
          const rng = makeRng(ctx.state.rngCursor);
          const t = beasts[rng.int(beasts.length)]!;
          ctx.state.rngCursor = rng.state();
          castSpell(ctx.state, def, t);
        } else {
          castSpell(ctx.state, def);
        }
      }
    }
  },

  /** SCAVVERS — Echo: trigger the ADJACENT minions' Rallies, through the shop Rally dispatcher. */
  deathrattleTriggerAdjacentRally: (ctx, self) => {
    const i = ctx.state.board.findIndex((c) => c.uid === self.uid);
    if (i < 0) return; // replay context without a body — nothing is adjacent
    const adj = [ctx.state.board[i - 1], ctx.state.board[i + 1]].filter((c): c is BoardCard => !!c);
    for (const t of adj) for (let r = 0; r < gold(self); r++) fireShopRally(ctx.state, t);
  },

  /** ASHEN HEIR (death half) — a friendly Imp destroyed in the shop hands its stats to a living Imp, banking
   *  them when none remains (the combat body's pay-a-living-Imp-first rule, owner ruling 2026-08-07). */
  impInheritOnDeath: (ctx, self, _params, payload) => {
    const dead = payload.minion;
    if (!dead || dead.uid === self.uid || !CARD_INDEX[dead.cardId]?.imp) return;
    const attack = Math.max(0, dead.attack);
    const health = Math.max(0, dead.health);
    if (attack <= 0 && health <= 0) return;
    const imps = ctx.state.board.filter((c) => c.uid !== self.uid && c.uid !== dead.uid && CARD_INDEX[c.cardId]?.imp);
    if (imps.length > 0) {
      const rng = makeRng(ctx.state.rngCursor);
      const t = imps[rng.int(imps.length)]!;
      ctx.state.rngCursor = rng.state();
      addBuff(t, nameOf(self), attack, health);
    } else {
      self.impBank = { attack: (self.impBank?.attack ?? 0) + attack, health: (self.impBank?.health ?? 0) + health };
    }
  },

  /** ASHEN HEIR (summon half) — the bank pays out to the next Imp entering play in the shop. */
  impInheritOnSummon: (ctx, self, _params, payload) => {
    const born = payload.minion;
    if (!born || born.uid === self.uid || !CARD_INDEX[born.cardId]?.imp) return;
    const bank = self.impBank;
    if (!bank || (bank.attack <= 0 && bank.health <= 0)) return;
    self.impBank = { attack: 0, health: 0 };
    addBuff(born, nameOf(self), bank.attack, bank.health);
  },

  /** BROOD MATRON — a friendly death in the shop breeds a token, up to the card's cap per turn (the combat
   *  cap is per fight; the shop mirror resets at the rollover). Golden doubles the Avenge buff, not the cap. */
  onFriendDeathSummon: (ctx, self, params, payload) => {
    const dead = payload.minion;
    if (!dead || dead.uid === self.uid) return;
    if ((self.bredThisTurn ?? 0) >= num(params.max, 3)) return;
    const tok = CARD_INDEX[str(params.tokenId)];
    if (!tok) return;
    ctx.summon(tok, self.uid);
    self.bredThisTurn = (self.bredThisTurn ?? 0) + 1;
  },

  /** ECHO MIMIC — copies the Echo of a friendly that died in the shop onto itself (granted, per instance). */
  onFriendDeathGainEcho: (ctx, self, _params, payload) => {
    const dead = payload.minion;
    if (!dead || dead.uid === self.uid) return;
    const echoes = instanceEffects(dead).filter((e) => e.on === 'onDeath');
    if (echoes.length === 0) return;
    for (let r = 0; r < gold(self); r++) {
      (self.grantedEffects ??= []).push(...echoes.map((e) => ({ ...e, ...(e.params ? { params: { ...e.params } } : {}) })));
    }
  },

  // ══ GREAT POT + THE GIFTS (owner design 2026-08-26) ═══════════════════════════════════════════════════

  /** GREAT POT: +A/+H to ONE friendly minion of EACH type. The same "one per tribe" spread Rune of the Shared
   *  Table uses — a dual-tribe body fills BOTH its slots (so it is never counted twice), and the first minion
   *  of a tribe claims it. Neutral bodies have no type and are skipped. Spell power folds into each grant,
   *  like every stat-granting cast (bug a17a48ab, Bug Board round 1 — the owner's intent: it SHOULD scale;
   *  it shipped flat because its name slips the `spellBuff*` tripwire prefix, now covered as an extra). */
  buffOnePerTribe: (ctx, _self, params) => {
    const a = num(params.attack, 4) + spellAttackBonus(ctx.state), h = num(params.health, 4) + spellHealthBonus(ctx.state);
    const seen = new Set<string>();
    for (const c of ctx.state.board) {
      const def = CARD_INDEX[c.cardId];
      if (!def) continue;
      const tribes = [def.tribe, def.tribe2].filter((t): t is Tribe => !!t && t !== 'neutral');
      if (tribes.length === 0 || tribes.every((t) => seen.has(t))) continue;
      for (const t of tribes) seen.add(t);
      captureBuffFx(ctx.state, undefined, 'spell', () => addBuff(c, 'Great Pot', a, h));
    }
  },

  /** DEMAND AN ENCORE: your Shouts trigger an extra time this turn (turn-scoped; see `shoutExtraTurn`). */
  giftShoutExtraTurn: (ctx, _self, params) => {
    ctx.state.shoutExtraTurn = (ctx.state.shoutExtraTurn ?? 0) + num(params.count, 1);
  },

  /** ROYAL ALLOWANCE: a Gold Pouch now, and another every Start of Turn for the rest of the run. */
  giftRoyalAllowance: (ctx) => {
    ctx.state.giftAllowance = true;
    const pouch = CARD_INDEX['emberpouch'];
    if (pouch) conjureToHand(ctx.state, [pouch], 1);
  },

  /** PREMIUM STOCK: the run-wide shop channel — every present and future offer is +A/+H for the game. */
  giftShopBuffGame: (ctx, _self, params) => {
    applyRunShopBuff(ctx.state, num(params.attack, 4), num(params.health, 4), 'Premium Stock');
  },

  /** IRONCLAD FAVOR: Taunt + double Health. The double is a BUFF of its current Health, so the printed total
   *  ends at exactly 2x and the gain is attributed like every other buff. */
  giftIroncladFavor: (ctx, _self, _params, payload) => {
    const t = (payload as { target?: BoardCard } | undefined)?.target;
    if (!t) return;
    if (!t.keywords.includes('T')) t.keywords.push('T');
    captureBuffFx(ctx.state, undefined, 'spell', () => addBuff(t, 'Ironclad Favor', 0, Math.max(0, t.health)));
  },

  /** UNBRIDLED MIGHT: +2 Attack FIRST, then double the result (so a 3-Attack body ends at 10, not 8). */
  giftUnbridledMight: (ctx, _self, params, payload) => {
    const t = (payload as { target?: BoardCard } | undefined)?.target;
    if (!t) return;
    const plus = num(params.attack, 2);
    captureBuffFx(ctx.state, undefined, 'spell', () => {
      addBuff(t, 'Unbridled Might', plus, 0);
      addBuff(t, 'Unbridled Might', Math.max(0, t.attack), 0);
    });
  },

  /** CHAMPION'S REGALIA: Ward (DS) + Critical Strike (CR) + Flurry (W). */
  giftRegalia: (_ctx, _self, _params, payload) => {
    const t = (payload as { target?: BoardCard } | undefined)?.target;
    if (!t) return;
    for (const k of ['DS', 'CR', 'W'] as const) if (!t.keywords.includes(k)) t.keywords.push(k);
  },

  /** GRAND LARCENY: take the whole shop to hand, then refresh. Owner ruling 2026-08-26 — as many as the hand
   *  can hold; the remainder are LOST (never a partial refusal, and never an overflowing hand). */
  giftGrandLarceny: (ctx) => {
    const st = ctx.state;
    for (const offer of [...st.shop]) {
      if (st.hand.length >= handCap(st)) break;
      const def = CARD_INDEX[offer.cardId];
      if (!def) continue;
      if (def.spell) {
        st.hand.push({ uid: `b${st.uidSeq++}`, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false });
      } else {
        grantMinionToHandOrBoard(st, def, !!offer.golden);
      }
    }
    st.shop = [];
    rollShop(st);
  },

  /** ARCANE CLEARANCE: Shop Spells cost 1 less this turn (the same per-turn channel the shop discounts use). */
  giftSpellDiscountTurn: (ctx, _self, params) => {
    ctx.state.spellCostOffTurn = (ctx.state.spellCostOffTurn ?? 0) + num(params.amount, 1);
  },

  /** FRIENDS AND FAMILY: shop minions cost 1 less this turn. */
  giftMinionDiscountTurn: (ctx, _self, params) => {
    ctx.state.minionCostOffTurn = (ctx.state.minionCostOffTurn ?? 0) + num(params.amount, 1);
  },

  /** FAST TRACK: knock `amount` off the tavern-up cost (floored at the config minimum). */
  giftUpgradeDiscount: (ctx, _self, params) => {
    const st = ctx.state;
    st.upgradeCost = Math.max(CONFIG.upgradeCostFloor ?? 0, st.upgradeCost - num(params.amount, 5));
  },

  /** SPECIAL DELIVERY: a random minion from the tier ABOVE yours — capped at 7 (owner clarification
   *  2026-08-26), so a tier-6 or tier-7 shop still pays out rather than fizzling. */
  giftTierAboveMinion: (ctx) => {
    const st = ctx.state;
    const tgt = Math.min(7, st.tier + 1);
    const pool = poolOf(st).all.filter((c) => !c.spell && !c.ruby && !c.token && c.tier === tgt);
    if (pool.length === 0) return;
    const rng = makeRng(st.rngCursor);
    const pick = pool[rng.int(pool.length)]!;
    st.rngCursor = rng.state();
    grantMinionToHandOrBoard(st, pick, false);
  },

  /** SECOND CALLING: a random SECOND hero power, held for the rest of the run (Void's slot 1). Owner
   *  clarification 2026-08-26: it REPLACES an existing second power rather than being skipped. */
  giftSecondCalling: (ctx) => {
    const st = ctx.state;
    const pool = powerDiscoverPool('void', [st.heroId, ...(st.voidPowerIds ?? [])]);
    if (pool.length === 0) return;
    const rng = makeRng(st.rngCursor);
    const pick = pool[rng.int(pool.length)]!;
    st.rngCursor = rng.state();
    // Slot 0 stays whatever the run already wields; slot 1 is the granted power.
    const cur = st.voidPowerIds ?? [st.heroId];
    st.voidPowerIds = [cur[0] ?? st.heroId, pick];
    st.heroReady2 = true;
    st.heroPowerSpent2 = false;
    st.heroPowerUses2 = 0;
  },

  /** PARTING GIFTS: sell the target, then hand its stats to 2 random OTHER friendly minions. The stats are
   *  read BEFORE the sale (the body is gone afterwards), and the recipients are drawn from what remains. */
  giftPartingGifts: (ctx, _self, params, payload) => {
    const st = ctx.state;
    const t = (payload as { target?: BoardCard } | undefined)?.target;
    if (!t) return;
    const atk = t.attack, hp = t.health;
    const bi = st.board.indexOf(t);
    if (bi < 0) return;
    st.board.splice(bi, 1);
    gainGold(st, sellValueWithBonus(t, st));
    fireOnMinionSold(st, t);
    const rest = st.board.filter((c) => c.uid !== t.uid);
    if (rest.length === 0) return;
    const rng = makeRng(st.rngCursor);
    const picks: BoardCard[] = [];
    const bag = [...rest];
    for (let i = 0; i < num(params.count, 2) && bag.length > 0; i++) picks.push(bag.splice(rng.int(bag.length), 1)[0]!);
    st.rngCursor = rng.state();
    for (const c of picks) captureBuffFx(st, undefined, 'spell', () => addBuff(c, 'Parting Gifts', atk, hp));
  },

  // ── RALLY FAMILY — the SHOP half (Step 3 item 4 + Step 4) ────────────────────────────────────────────
  //
  // One body each, shared with combat (`ARENA_EFFECTS`); these wrappers are dispatch only. `fireRallies`
  // (Rune of Lasting Cadence, End of Turn) hands each entry `{ minion }` = the body whose Rally is firing,
  // exactly as combat's `onAttack` payload does — so an own-attack Rally checks `minion !== self` and an
  // ally-attack watcher takes `minion` as its attacker, with the same code on both sides of the seam.
  //
  // The two ENEMY-FACING members are wired here like everything else and no-op by membership: `enemies()` is
  // empty in the shop and no `target` rides the payload, so `rallyDamageRandomEnemy` and
  // `onAttackStripKeywords` return before they touch state (they are NOT special-cased out of the dispatch —
  // that would be the "hand-select the methods" the arena exists to end).
  rallyBuff: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyBuff(shopArena(ctx.state, self), params);
  },
  rallyGiveHealthToDragons: (ctx, self, _params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyGiveHealthToDragons(shopArena(ctx.state, self));
  },
  rallyGrantSpell: (ctx, self, _params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyGrantSpell(shopArena(ctx.state, self));
  },
  rallyGrantMagnetic: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyGrantMagnetic(shopArena(ctx.state, self), params);
  },
  rallyTriggerTribeShouts: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyTriggerTribeShouts(shopArena(ctx.state, self), params);
  },
  rallyTribeAuraGrowing: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyTribeAuraGrowing(shopArena(ctx.state, self), params);
  },
  rallySummonImpBuffImps: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallySummonImpBuffImps(shopArena(ctx.state, self), params);
  },
  rallySpreadTribeBuff: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallySpreadTribeBuff(shopArena(ctx.state, self), params);
  },
  rallyRubyStatGain: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyRubyStatGain(shopArena(ctx.state, self), params);
  },
  rallyProcLeftmostEcho: (ctx, self, _params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyProcLeftmostEcho(shopArena(ctx.state, self));
  },
  rallyProcDeathrattle: (ctx, self, _params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyProcDeathrattle(shopArena(ctx.state, self));
  },
  rallyPlayRubiesSelf: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyPlayRubiesSelf(shopArena(ctx.state, self), params);
  },
  rallyPlayRubiesAll: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyPlayRubiesAll(shopArena(ctx.state, self), params);
  },
  rallyGrantSpellPower: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyGrantSpellPower(shopArena(ctx.state, self), params);
  },
  rallyGrantSelfCopy: (ctx, self, _params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyGrantSelfCopy(shopArena(ctx.state, self));
  },
  rallyGrantRandomShoutMinion: (ctx, self, _params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyGrantRandomShoutMinion(shopArena(ctx.state, self));
  },
  rallyGiveAttackToOthers: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyGiveAttackToOthers(shopArena(ctx.state, self), params);
  },
  rallyGetRubies: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyGetRubies(shopArena(ctx.state, self), params);
  },
  rallyDoubleSelf: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyDoubleSelf(shopArena(ctx.state, self), params);
  },
  rallyDamageRandomEnemy: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyDamageRandomEnemy(shopArena(ctx.state, self), params); // no enemies here — inert
  },
  rallyCastTribeAttack: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyCastTribeAttack(shopArena(ctx.state, self), params);
  },
  rallyCastSpell: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyCastSpell(shopArena(ctx.state, self), params);
  },
  rallyCastShopBuffSpell: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyCastShopBuffSpell(shopArena(ctx.state, self), params);
  },
  rallyCastNamedSpell: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyCastNamedSpell(shopArena(ctx.state, self), params);
  },
  rallyBuffShopPermanent: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyBuffShopPermanent(shopArena(ctx.state, self), params);
  },
  rallyBuffSelfPerTribe: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyBuffSelfPerTribe(shopArena(ctx.state, self), params);
  },
  rallyBuffSelf: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyBuffSelf(shopArena(ctx.state, self), params);
  },
  rallyBuffAttachments: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.rallyBuffAttachments(shopArena(ctx.state, self), params);
  },
  /** No own-attack guard — the alignment gate is this one's whole condition (the combat half has none either). */
  rallyBuffCelestials: (ctx, self, params) => {
    ARENA_EFFECTS.rallyBuffCelestials(shopArena(ctx.state, self), params);
  },
  onRallyBuffOnePerTribe: (ctx, self, params, payload) => {
    ARENA_EFFECTS.onRallyBuffOnePerTribe(shopArena(ctx.state, self), { ...params, attacker: payload.minion });
  },
  onRallyProcLeftmostEcho: (ctx, self, params, payload) => {
    ARENA_EFFECTS.onRallyProcLeftmostEcho(shopArena(ctx.state, self), { ...params, attacker: payload.minion });
  },
  onRallyPlayRubiesTribe: (ctx, self, params, payload) => {
    ARENA_EFFECTS.onRallyPlayRubiesTribe(shopArena(ctx.state, self), { ...params, attacker: payload.minion });
  },
  onAllyTribeAttackBuffSelf: (ctx, self, params, payload) => {
    ARENA_EFFECTS.onAllyTribeAttackBuffSelf(shopArena(ctx.state, self), { ...params, attacker: payload.minion });
  },
  onAllyAttackCastGrowth: (ctx, self, params, payload) => {
    ARENA_EFFECTS.onAllyAttackCastGrowth(shopArena(ctx.state, self), { ...params, attacker: payload.minion });
  },
  onAllyAttackBuffAll: (ctx, self, params, payload) => {
    ARENA_EFFECTS.onAllyAttackBuffAll(shopArena(ctx.state, self), { ...params, attacker: payload.minion });
  },
  onTribeAttackCastNamedSpell: (ctx, self, params, payload) => {
    ARENA_EFFECTS.onTribeAttackCastNamedSpell(shopArena(ctx.state, self), { ...params, attacker: payload.minion });
  },
  onTribeAttackBuffAttacker: (ctx, self, params, payload) => {
    if (payload.minion === self) return; // "another friendly" — the combat guard, mirrored
    ARENA_EFFECTS.onTribeAttackBuffAttacker(shopArena(ctx.state, self), { ...params, attacker: payload.minion });
  },
  onImpAttackBuffImps: (ctx, self, params, payload) => {
    ARENA_EFFECTS.onImpAttackBuffImps(shopArena(ctx.state, self), { ...params, attacker: payload.minion });
  },
  onFriendlyAttackBuffTribe: (ctx, self, params, payload) => {
    if (payload.minion === self) return; // excludes self — a support body, not a self-ramp
    ARENA_EFFECTS.onFriendlyAttackBuffTribe(shopArena(ctx.state, self), { ...params, attacker: payload.minion });
  },
  onAttackStripKeywords: (ctx, self, params, payload) => {
    if (payload.minion !== self) return;
    ARENA_EFFECTS.onAttackStripKeywords(shopArena(ctx.state, self), params); // no defender here — inert
  },

  // ── START-OF-COMBAT FAMILY — the SHOP half (Step 3 item 4 + Step 4) ──────────────────────────────────
  //
  // One body each, shared with combat (`ARENA_EFFECTS`); these wrappers are dispatch only, fired by
  // `fireShopStartOfCombat` under Rune of Combat Prowess. Start of Combat is a PER-BODY trigger (no
  // watchers listen for "a Start of Combat happened"), so unlike the Rally broadcast there is no payload
  // guard to keep — each wrapper fires its own card's effect and nothing else.
  //
  // The two ENEMY-FACING members (scDamage, scGrantEnemyTaunt) are wired like everything else and no-op by
  // membership (`enemies()` is empty here); the combat-only channels (scArmBleed, scGrantSpellCastExtra,
  // the Engraves) no-op on their VERB, leaving an empty diff the dispatcher discards.
  scDamage: (ctx, self, params) => {
    ARENA_EFFECTS.scDamage(shopArena(ctx.state, self), params); // no enemies here — inert, zero RNG drift
  },
  scArmBleed: (ctx, self, params) => {
    ARENA_EFFECTS.scArmBleed(shopArena(ctx.state, self), params); // combat mark — the verb no-ops here
  },
  scEngraveNeighbor: (ctx, self, params) => {
    ARENA_EFFECTS.scEngraveNeighbor(shopArena(ctx.state, self), params); // nothing to keep — shop gains are permanent
  },
  scEngraveAll: (ctx, self, params) => {
    ARENA_EFFECTS.scEngraveAll(shopArena(ctx.state, self), params);
  },
  scCastLeftmostHandSpell: (ctx, self, params) => {
    ARENA_EFFECTS.scCastLeftmostHandSpell(shopArena(ctx.state, self), params);
  },
  scBuffAlliesPctSelf: (ctx, self, params) => {
    ARENA_EFFECTS.scBuffAlliesPctSelf(shopArena(ctx.state, self), params);
  },
  scPlayRubiesSelfAndAdjacentTribe: (ctx, self, params) => {
    ARENA_EFFECTS.scPlayRubiesSelfAndAdjacentTribe(shopArena(ctx.state, self), params);
  },
  scGrantSpellCastExtra: (ctx, self, params) => {
    ARENA_EFFECTS.scGrantSpellCastExtra(shopArena(ctx.state, self), params); // combat-cast channel — inert
  },
  scGainKeyword: (ctx, self, params) => {
    ARENA_EFFECTS.scGainKeyword(shopArena(ctx.state, self), params);
  },
  /**
   * EQUIP — hand the player the Equipment this minion grants (owner handoff 2026-08-28). Fired when the body
   * is PLAYED and again for every surviving source at the Start-of-Turn rebuild, which is why the grant logic
   * lives in `grantEquipment` rather than here: both paths must apply the same duplicate / Gilded precedence.
   *
   * The factory reads the Equipment by ID from its own params, so a card names its Equipment in exactly one
   * place and the card and the registry can never disagree.
   */
  grantEquipment: (ctx, self, params) => {
    const def = EQUIPMENT_INDEX[str(params.equipmentId)];
    if (!def) return; // an unknown id is a content error the schema catches — never a silent half-grant
    grantEquipmentToPlayer(ctx.state, self, def);
  },

  /**
   * TITAN HAMMER — one Equipment TRIGGER: SET the target's stats, rather than add to them.
   *
   * Its own factory because setting is not buffing, and the difference matters in both directions: a 2/1 and a
   * 40/40 both end up 50/50, so the Hammer is a floor as much as a ceiling. Recorded as a `Titan Hammer` buff
   * entry carrying the DELTA it actually applied, so the inspect itemises where the stats came from like any
   * other source — without that, a hammered body shows 50/50 attributed to nothing.
   *
   * A negative delta is real (hammering DOWN a bigger body) and is recorded as such rather than clamped: the
   * itemisation has to add up to what the card shows.
   */
  equipmentSetStats: (ctx, self, params, payload) => {
    const target = payload.target;
    if (!target) return;
    const attack = num(params.attack, 0);
    const health = num(params.health, 0);
    const dA = attack - target.attack;
    const dH = health - target.health;
    target.attack = attack;
    target.health = health;
    if (dA !== 0 || dH !== 0) {
      (target.buffs ??= []).push({ source: nameOf(self), attack: dA, health: dH, count: 1 });
    }
  },

  /**
   * AN EQUIPMENT SPELL — one Equipment TRIGGER that CASTS a named Shop spell (owner handoff 2026-08-28).
   *
   * Routed through `castSpell`, the REAL cast path, which is the entire point of the classification: it is
   * what makes the cast count as a Shop spell, pick up Shop-spell improvements, wake "after you cast a Shop
   * spell" listeners and be duplicable by spell multipliers — for free, because none of that is reimplemented
   * here. The spell never enters the hand and is never offered in the Shop (it is cast directly), and it does
   * not count as a card PLAYED, since nothing left a hand.
   *
   * No Equipment uses this yet. It exists because the handoff asked for the classification to be built ahead
   * of the roster — and because the alternative, discovering later that Equipment effects were never in the
   * spell pipeline, is exactly the class of gap this system keeps producing.
   */
  /**
   * Shout / Choose One: cast a NAMED Shop spell `count` times (Facetbound Martyr, set 3).
   *
   * Goes through `castSpell`, the real Shop-spell pipeline, so each cast counts as a Shop spell cast and
   * wakes every cast-watcher — the same reasoning `equipmentCastSpell` documents. Golden multiplies the
   * count, and each repetition is a GENUINE cast rather than one doubled one, matching what golden means
   * everywhere else.
   *
   * Untargeted only: `castSpell` takes an optional target and this passes none, so a spell that needs one
   * would fizzle. Every caller today names an untargeted spell (Veinstorm); a targeted one would need the
   * target threaded, which is a different factory rather than a quiet extension of this.
   */
  battlecryCastNamedSpell: (ctx, self, params) => {
    const spell = CARD_INDEX[str(params.spellId)];
    if (!spell?.spell) return; // not a spell id — never a silent bespoke effect
    for (let i = 0; i < Math.max(1, num(params.count, 1)) * gold(self); i++) castSpell(ctx.state, spell, undefined);
  },

  equipmentCastSpell: (ctx, _self, params, payload) => {
    const spell = CARD_INDEX[str(params.spellId)];
    if (!spell?.spell) return; // not a spell id — never a silent bespoke effect
    // `count` casts the named spell that many times, which is how a GILDED Equipment Spell doubles: gilding
    // swaps in `gildedParams`, and "twice the spell" has to mean two GENUINE casts, not one doubled one —
    // the same rule golden follows everywhere else, so each cast counts as a Shop spell cast, receives
    // Shop-spell improvements, and wakes every cast-watcher once per cast. Absent → one cast, as before.
    for (let i = 0; i < Math.max(1, num(params.count, 1)); i++) castSpell(ctx.state, spell, payload.target);
  },

  /**
   * BLOODPOT — one Equipment TRIGGER: +attack/+health onto the chosen friendly minion.
   *
   * ONE trigger, deliberately: the repeat count lives in the activation (see `activateEquipment`), which calls
   * this once per trigger with the SAME target. Putting the repeat inside the factory would make "triggers an
   * additional time" impossible to express for any other Equipment.
   */
  equipmentBuffTarget: (ctx, self, params, payload) => {
    const target = payload.target;
    if (!target) return;
    addBuff(target, nameOf(self), num(params.attack, 0), num(params.health, 0));
  },

  scGrantReborn: (ctx, self, params) => {
    ARENA_EFFECTS.scGrantReborn(shopArena(ctx.state, self), params);
  },
  scGrantEnemyTaunt: (ctx, self, params) => {
    ARENA_EFFECTS.scGrantEnemyTaunt(shopArena(ctx.state, self), params); // no enemies here — inert
  },
  scBuffSelf: (ctx, self, params) => {
    ARENA_EFFECTS.scBuffSelf(shopArena(ctx.state, self), params);
  },
  scSummonCopy: (ctx, self, params) => {
    ARENA_EFFECTS.scSummonCopy(shopArena(ctx.state, self), params);
  },
  scTribeBuffPerSpellImproving: (ctx, self, params) => {
    ARENA_EFFECTS.scTribeBuffPerSpellImproving(shopArena(ctx.state, self), params);
  },
  scTribeBuffPerAle: (ctx, self, params) => {
    ARENA_EFFECTS.scTribeBuffPerAle(shopArena(ctx.state, self), params);
  },
  scBuffRandomTribePerAle: (ctx, self, params) => {
    ARENA_EFFECTS.scBuffRandomTribePerAle(shopArena(ctx.state, self), params);
  },
  scTribeBuffImproving: (ctx, self, params) => {
    ARENA_EFFECTS.scTribeBuffImproving(shopArena(ctx.state, self), params);
  },
  scGainFodderStats: (ctx, self, params) => {
    ARENA_EFFECTS.scGainFodderStats(shopArena(ctx.state, self), params);
  },
  scBeastAura: (ctx, self, params) => {
    ARENA_EFFECTS.scBeastAura(shopArena(ctx.state, self), params); // the later-arrivals aura half is combat-only
  },
  scTriggerLeftmostEchoes: (ctx, self, params) => {
    ARENA_EFFECTS.scTriggerLeftmostEchoes(shopArena(ctx.state, self), params); // pays the recruit Echo tallies
  },
  copyLeftmostEcho: (ctx, self, params) => {
    ARENA_EFFECTS.copyLeftmostEcho(shopArena(ctx.state, self), params); // the shop graft is permanent (family rule)
  },
  /** Set 2 — Shout/Rally: mint N Rubies into hand (base count × golden). Chipwick `Get 2 Rubies`,
   *  Tunnelcharger Rikk `Get 3` — the golden text doubles the count, so `count × gold(self)`. */
  getRubies: (ctx, self, params) => {
    // `rubyId` names WHICH Ruby to mint (Facetbound Martyr's Warding Ruby); absent mints the plain one. The
    // End-of-Turn twin `endOfTurnGetRubies` already took this param — the two mint through the same
    // `mintRubies` and there was no reason for the Shout half to be the one that could not name a Ruby.
    mintRubies(ctx.state, num(params.count, 1) * gold(self), str(params.rubyId) || RUBY_ID);
  },

  /** Set 2 — Gemgorge Fiend (Kobold/Demon): every 3 Rubies cast (the `rubyCast` cadence), Consume a random
   *  non-spell Shop minion (× golden) — remove it and gain its (buffed) stats, Demon-style. */
  rubyCastConsumeShop: (ctx, self) => {
    const state = ctx.state;
    const rng = makeRng(state.rngCursor);
    for (let n = 0; n < gold(self); n++) {
      // Eligibility must MATCH the primitive's own (minion, not spell, not Ruby) or we'd pick an index it
      // then refuses, silently wasting the trigger. The old hand-rolled body only excluded spells, so this
      // could eat a Ruby offer.
      const idxs = state.shop
        .map((o, i) => {
          const d = CARD_INDEX[o.cardId];
          return !d || d.spell || d.ruby ? -1 : i;
        })
        .filter((i) => i >= 0);
      if (idxs.length === 0) break;
      consumeShopMinion(state, self, idxs[rng.int(idxs.length)]!);
    }
    state.rngCursor = rng.state();
  },

  /** Set 2 — Resonance Idol: when a Ruby is played on THIS minion, bounce the same buff to BOTH adjacent
   *  minions (golden: bounce twice). Uses `addBuff` directly, so a bounce can't re-trigger onRubyPlayed. */
  // ARENA-MIGRATED (Step 3, Ruby family): one body in arena.ts serves both phases.
  rubyPlayedBounce: (ctx, self, params, payload) => {
    ARENA_EFFECTS.rubyPlayedBounce(shopArena(ctx.state, self), { ...params, rubyAttack: payload.rubyAttack ?? 0, rubyHealth: payload.rubyHealth ?? 0 });
  },

  /** Set 2 — Embermouth Whelp (recruit half): each Shout you trigger grows this body. Most Shouts fire in the
   *  SHOP, so without this half the card would only grow off combat re-fires — the same recruit/combat seam
   *  that has bitten Karwind and Scalechanter. */
  /** CELESTIAL ORBIT (arriver half): buff the minion that was just played next to this one. The payload's
   *  `minion` is the ARRIVER; `self` is the watcher whose Orbit fired. × golden. */
  orbitBuffArriver: (ctx, self, params, payload) => {
    const { minion } = payload as { minion?: BoardCard };
    if (!minion) return;
    addBuff(minion, nameOf(self), num(params.attack, 2) * gold(self), num(params.health, 2) * gold(self));
  },

  /** CELESTIAL ORBIT (self half): this minion grows each time something lands beside it. × golden. */
  orbitBuffSelf: (ctx, self, params) => {
    addBuff(self, nameOf(self), num(params.attack, 2) * gold(self), num(params.health, 2) * gold(self));
  },

  /** Set 2 — Lastlight (Echo, RECRUIT half): give `count` friendly minions Ward (× golden). The combat half
   *  has always existed; this one was MISSING, so a Funeral-on-Loan Lastlight destroyed in the shop fired an
   *  Echo that did nothing (owner report 2026-08-03). Mirrors the combat factory's shape: distinct picks,
   *  preferring bodies that don't already have Ward. Deterministic (run rngCursor). */
  // ── ARENA-MIGRATED (Step 1 spike): the body lives ONCE in @game/core's arena.ts. The legacy body — the
  //    shop half of the same sentence — is deleted, not deprecated.
  deathrattleGrantWardRandom: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleGrantWardRandom(shopArena(ctx.state, self), params);
  },

  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  onBattlecryBuffSelf: (ctx, self, params) => {
    ARENA_EFFECTS.onBattlecryBuffSelf(shopArena(ctx.state, self), params);
  },

  /** Set 2 — Feastmaster Vhal (End of Turn): THIS minion and each adjacent Demon consume a random Shop minion
   *  (owner rework 2026-07-27 — it used to feed only the neighbours). Each eater gains the stats itself. */
  endOfTurnSelfAndNeighboursConsume: (ctx, self, params) => {
    const board = ctx.state.board;
    const i = board.indexOf(self);
    if (i < 0) return;
    const eaters = [self, board[i - 1], board[i + 1]].filter(
      (c): c is BoardCard => !!c && (c === self || isTribe(c, 'demon')),
    );
    const each = num(params.count, 1) * gold(self);
    for (const eater of eaters) {
      for (let k = 0; k < each; k++) {
        const idxs = ctx.state.shop
          .map((o, n) => { const d = CARD_INDEX[o.cardId]; return !d || d.spell || d.ruby ? -1 : n; })
          .filter((n) => n >= 0);
        if (idxs.length === 0) return;
        const rng = makeRng(ctx.state.rngCursor);
        const pick = idxs[rng.int(idxs.length)]!;
        ctx.state.rngCursor = rng.state();
        consumeShopMinion(ctx.state, eater, pick);
      }
    }
  },


  /** Set 2 — Rouge Rogue:on each SHOP SPELL cast, give your Imps +atk/+hp EVERYWHERE (the run-wide Imp
   *  enchant, so Imps summoned later inherit it). `spellCast` is already Ruby-blind, so "Shop Spell" holds. */
  spellCastBuffImps: (ctx, self, params) => {
    const a = num(params.attack, 1) * gold(self);
    const h = num(params.health, 1) * gold(self);
    buffImpsRunWide(ctx.state, a, h, nameOf(self));
  },

  /** Set 2 — Veinbreaker's Choose One (burst half): mint `count` Rubies into hand (× golden). Same primitive
   *  the cadence minters use; a Shout-shaped wrapper so the option can sit in `chooseOne[].effects`. */
  battlecryGetRubies: (ctx, self, params) => {
    mintRubies(ctx.state, num(params.count, 1) * gold(self));
  },

  /** Set 2 — Frenzied Excavator (Shout): play `rubies` Rubies on EVERY friendly minion (× golden).
   *  A Ruby is base 1/1 plus the run's `rubyBonus`, the same value `playRubyOn` uses in combat — and it lands
   *  under the `Ruby` source so Deepdelve Paragon and a future transfer spell can still recognise it. */
  // ARENA-MIGRATED (Shout family): one body — N SEPARATE Rubies, N watcher fires, both phases.
  battlecryPlayRubiesAll: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryPlayRubiesAll(shopArena(ctx.state, self), params);
  },


  /** Set 2 — Ruby Broker: when a Ruby is played on THIS minion, gain `gold` Gold — capped `cap` times per turn
   *  (golden raises the cap by 1). `rubyRecvTick` is a per-instance counter reset each wave. */
  rubyPlayedGold: (ctx, self, params) => {
    const cap = num(params.cap, 2) + (self.golden ? 1 : 0);
    // Rune of the Brokerage lifts the per-turn cap entirely — the tick still counts (the inspect panel reads it),
    // it just stops gating.
    if (!ctx.state.runeBrokerage && (self.rubyRecvTick ?? 0) >= cap) return;
    self.rubyRecvTick = (self.rubyRecvTick ?? 0) + 1;
    gainGold(ctx.state, num(params.gold, 3));
  },

  /** Set 2 — Candle Conduit: when you get a Ruby, cast a Ruby (base 1/1 + rubyBonus) on a random friendly
   *  `tribe` minion. Golden: any friendly minion (not just the tribe), TWICE. Deterministic (run rngCursor). */
  rubyGainedCast: (ctx, self, params) => {
    const state = ctx.state;
    const bonus = rubyStatBonus(state);
    const ra = 1 + bonus.attack;
    const rh = 1 + bonus.health;
    const tribe = self.golden ? '' : str(params.tribe); // golden drops the tribe filter (any friendly minion)
    const casts = self.golden ? 2 : 1;
    for (let c = 0; c < casts; c++) {
      const pool = state.board.filter((m) => !tribe || isTribe(m, tribe as Tribe)); // All-types counts as every tribe
      if (pool.length === 0) return;
      const rng = makeRng(state.rngCursor);
      const target = pool[rng.int(pool.length)]!;
      state.rngCursor = rng.state();
      addBuff(target, 'Ruby', ra, rh);
    // A Ruby PLAYED by a card is a real Ruby play: tell the target so its own `onRubyPlayed` effects see it
    // (Ruby Broker's Gold, Resonance Idol's bounce) and its `rubiesOnThisTurn` counter moves. Three
    // card-played paths skipped this — they landed the stats and nothing else, so a board built around the
    // Ruby engine read them as no-ops (owner report 2026-08-02, via Alchemist Brisbane).
      fireOnRubyPlayed(state, target, ra, rh);
    }
  },

  /** Set 2 — Alchemist Brisbane (EoT half): at End of Turn, play `count` Rubies (base 1/1 + rubyBonus) on
   *  EVERY friendly `tribe` minion (× golden). Owner ruling 2026-08-03: it hits ALL your Kobolds — it used to
   *  pick ONE at random, which is why it read as "not working" on a wide board (a single silent +2/+2
   *  somewhere in a line of seven). No RNG at all now, so it also stops consuming the run cursor. */
  endOfTurnPlayRuby: (ctx, self, params) => {
    const state = ctx.state;
    const bonus = rubyStatBonus(state);
    const ra = 1 + bonus.attack;
    const rh = 1 + bonus.health;
    const tribe = str(params.tribe);
    const targets = state.board.filter((m) => !tribe || isTribe(m, tribe as Tribe)); // All-types counts as every tribe
    for (let c = 0; c < num(params.count, 1) * gold(self); c++) {
      for (const target of targets) {
        addBuff(target, 'Ruby', ra, rh);
    // A Ruby PLAYED by a card is a real Ruby play: tell the target so its own `onRubyPlayed` effects see it
    // (Ruby Broker's Gold, Resonance Idol's bounce) and its `rubiesOnThisTurn` counter moves. Three
    // card-played paths skipped this — they landed the stats and nothing else, so a board built around the
    // Ruby engine read them as no-ops (owner report 2026-08-02, via Alchemist Brisbane).
        fireOnRubyPlayed(state, target, ra, rh);
      }
    }
  },

  /** Set 2 — Wardstone Jeweler: at End of Turn, mint `count` Rubies of `rubyId` (× golden) into hand — used for
   *  the Warding Ruby (`rubyId: 'warding-ruby'`); defaults to a plain Ruby. */
  endOfTurnGetRubies: (ctx, self, params) => {
    mintRubies(ctx.state, num(params.count, 1) * gold(self), str(params.rubyId) || RUBY_ID);
  },

  /** Set 2 — Hoardmaster Krik: every `every` cards bought (the `cardsBought` cadence handles the counting),
   *  mint `count` Rubies into hand (× golden). */
  /**
   * SET 2 — DWARVES. "Get a Dwarven Ale": conjure a random one of the five Ales.
   *
   * The Ales are ordinary Set 2 Shop spells (`wo_*`), so this draws from the RUN'S OWN POOL rather than a
   * hardcoded id list — a set that doesn't carry the Ales simply grants nothing instead of injecting cards the
   * run can't otherwise have. Trigger-agnostic on purpose: the same factory serves Shout (`onPlay`),
   * End of Turn, and the Gold-spent threshold, because the `on:` field is what picks the moment.
   */
  /**
   * Grant a random CHOOSE ONE card to hand (Forksong Herald's Rally, Prismpick Artificer's first branch).
   *
   * Drawn from the run's own pool — minions and spells alike, anything printing a `chooseOne` — so a set
   * without Choose One cards grants nothing rather than reaching outside the set. `conjureToHand` applies
   * the hand cap and wakes every copy-watcher, exactly like any other conjure.
   */
  grantRandomChooseOne: (ctx, self, params) => {
    const pool = poolOf(ctx.state);
    const candidates = [...pool.buyable, ...pool.spells].filter((c) => (c.chooseOne?.length ?? 0) > 0);
    if (candidates.length === 0) return;
    conjureToHand(ctx.state, candidates, num(params.count, 1) * gold(self));
  },

  /**
   * Grant BOTH-branch charges (Forked Crown's start of turn, Prismpick Artificer's second branch).
   *
   * `set` refreshes to exactly `count` (Forked Crown: "the FIRST Choose One card each turn" — one per turn,
   * never banked); absent, charges ADD (Prismpick: "your NEXT Choose One card", on top of whatever is left).
   */
  grantChooseBothCharges: (ctx, self, params) => {
    const n = num(params.count, 1) * gold(self);
    ctx.state.chooseBothCharges = params.set ? n : (ctx.state.chooseBothCharges ?? 0) + n;
  },

  grantRandomAle: (ctx, self, params) => {
    const ales = poolOf(ctx.state).spells.filter((c) => ALE_IDS.includes(c.id));
    if (ales.length === 0) return;
    const count = num(params.count, 1) * gold(self);
    conjureToHand(ctx.state, ales, count);
    // ale-bubbles FX: credit the GENERATING board unit (Brunni / Tapkeeper / Doubletap Brewer) so the UI can
    // burst from it. Only a live board minion qualifies — the Reinforcing-Ale spell also routes here but casts
    // with `self` undefined (untargeted), and the `on the board` check keeps this a UNIT effect even if a
    // future targeted ale spell arrives. Pure display metadata; see `aleGranted` in `state.ts`.
    if (self?.uid && ctx.state.board.some((c) => c.uid === self.uid)) {
      ctx.state.aleGranted.push({ sourceUid: self.uid, count });
    }
  },

  /** Paymaster Pimm (Shout): Gold on the NEXT turn. `bonusEmbersNextTurn` already exists and is paid out at
   *  turn start, so this needed no new state — it rides the same channel Bounty Bot and the sell-Gold hero use. */
  battlecryGainGoldNextTurn: (ctx, self, params) => {
    ctx.state.bonusEmbersNextTurn = (ctx.state.bonusEmbersNextTurn ?? 0) + num(params.amount, 1) * gold(self);
  },

  /**
   * Mountainbond (cards played): play a Ruby on each of your minions.
   *
   * Mirrors `battlecryPlayRubiesAll` (Frenzied Excavator) rather than routing through `castSpell` — a Ruby is
   * not applied like a Shop spell. Its stats are the minted value (base 1/1 + the run's `rubyBonus`), and
   * `fireOnRubyPlayed` is what lets the target's own "when a Ruby is played on this" effects see it (Ruby Broker's
   * Gold, Resonance Idol's bounce), which a bare `addBuff` would skip.
   */
  /** Ruby Roach: whenever you play a Choose One card, cast `count` Rubies on your minions (x golden). Same
   *  `addBuff('Ruby') + fireOnRubyPlayed` shape as `cardsPlayedPlayRubies`, so every "when a Ruby is played
   *  on this" watcher (Ruby Broker's Gold, Resonance Idol's bounce) still sees them. */
  chooseOnePlayedPlayRubies: (ctx, self, params) => {
    const rb = ctx.state.rubyBonus ?? { attack: 0, health: 0 };
    const per = num(params.count, 1) * gold(self);
    const a = (1 + rb.attack) * per;
    const h = (1 + rb.health) * per;
    if (a <= 0 && h <= 0) return;
    for (const c of [...ctx.state.board]) {
      addBuff(c, 'Ruby', a, h);
      fireOnRubyPlayed(ctx.state, c, a, h);
    }
  },

  cardsPlayedPlayRubies: (ctx, self, params) => {
    const rb = ctx.state.rubyBonus ?? { attack: 0, health: 0 };
    const per = num(params.count, 1) * gold(self);
    const a = (1 + rb.attack) * per;
    const h = (1 + rb.health) * per;
    if (a <= 0 && h <= 0) return;
    for (const c of [...ctx.state.board]) {
      addBuff(c, 'Ruby', a, h);
      fireOnRubyPlayed(ctx.state, c, a, h);
    }
    // Rune of Mountain Trade: the Ruby play also hands over a random Dwarven Ale. Once per trigger (not per
    // minion buffed) — the rune reads "whenever Mountainbond plays Rubies", which is this one event however
    // wide the board is. Routed through `conjureToHand` so the hand cap and every copy-watcher behave normally.
    if (ctx.state.runeMountainTrade) {
      const ales = ALE_IDS.map((id) => CARD_INDEX[id]).filter((d): d is CardDef => !!d);
      if (ales.length > 0) conjureToHand(ctx.state, ales, 1, true);
    }
  },

  /**
   * Chef Gary Toast — when you PLAY a minion of `tribe`, buff your whole `tribe`.
   *
   * Rides `onSummon`, not `onPlay`. That was the bug (owner report 2026-07-29): `onPlay` is the Chef's OWN
   * Shout, so it fired exactly once — when the Chef itself was played — and never again, which is not what
   * "when you play a Dwarf" says at all. `onSummon` is the watcher every other "whenever you summon/play an X"
   * card uses (Broodwright, Groveweaver), and it fires for each minion entering play.
   *
   * The Chef buffs the whole tribe including itself: the owner's text is plain "give your Dwarves +3/+3", with
   * no count limit and no Ale scaling (both were mine, and both are gone).
   */
  onTribeSummonedBuffTribe: (ctx, self, params, payload) => {
    const { minion } = payload as { minion?: BoardCard };
    const tribe = str(params.tribe);
    if (!minion || minion.uid === self.uid) return;         // its own arrival doesn't trigger it
    if (tribe && !isTribe(minion, tribe as never)) return;  // only the named tribe's plays count
    const mag = num(params.attack, 3) * gold(self);
    if (mag <= 0) return;
    let handedOut = 0;
    for (const c of ctx.state.board) {
      if (!tribe || isTribe(c, tribe as never)) { addBuff(c, nameOf(self), mag, mag); handedOut += mag; }
    }
    // Rune of the Chef reads this: the COMBINED stats this instance handed out, summed across every recipient
    // (so a wide Dwarf board banks more than a narrow one). Per-INSTANCE, so two Chefs each keep their own.
    // Accrued unconditionally — the rune only decides whether it is ever SPENT, so arming it mid-run must not
    // depend on a tally that was never kept.
    //
    // SHOP-PHASE ONLY (owner ruling 2026-08-07): stats the Chef grants during COMBAT must never count toward
    // next turn's payout. That holds today for a structural reason rather than a check — this factory lives
    // only in the RECRUIT table; `onTribeSummonedBuffTribe` has no combat implementation at all, so a combat
    // summon can't reach this line. `runeChef.test.ts` guards that: if the effect is ever arena-migrated, the
    // test fails and whoever does it has to decide about the tally deliberately.
    self.chefGranted = (self.chefGranted ?? 0) + handedOut;
  },

  /** Warhorn Captain (Shout): your OTHER minions of `tribe` gain +attack. Attack-only and self-excluded, which
   *  is why it can't reuse `battlecryBuffTribeImproving` (symmetric, and includes self). */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryBuffTribeOthersAttack: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffTribeOthersAttack(shopArena(ctx.state, self), params);
  },

  /** Oathshield Orin (Shout): gain a keyword. Golden re-grants the same keyword — a keyword doesn't stack, so
   *  the gild is deliberately no stronger here (matches the owner's identical golden text). */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryGainKeyword: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryGainKeyword(shopArena(ctx.state, self), params);
  },


  /** Set 2 — Gemline Martyr (Start of Turn): get `count` copies of `spellId` (Veinstorm) AND improve your
   *  Rubies +attack/+health. Both halves reuse the established `battlecryGrantSpell` grant + `rubyStatGain`
   *  Ruby-power raise; golden (baked in each via `gold(self)`) doubles both. Fired by `applyStartOfTurn`. */
  startOfTurnGetSpellImproveRubies: (ctx, self, params) => {
    const g = gold(self);
    // Get the spell (Veinstorm) — same grant-to-hand path Storm Chaser / the old Gemline Martyr used.
    const def = CARD_INDEX[str(params.spellId)];
    if (def) {
      for (let i = 0; i < num(params.count, 1) * g && ctx.state.hand.length < handCap(ctx.state); i++) {
        ctx.state.hand.push({
          uid: `b${ctx.state.uidSeq++}`,
          cardId: def.id,
          tribe: def.tribe,
          attack: def.attack,
          health: def.health,
          keywords: [...def.keywords],
          golden: false,
        });
      }
    }
    // Improve the run's Ruby strength (+ every Ruby still in hand) — the `rubyStatGain` core.
    const a = num(params.attack, 1) * g;
    const h = num(params.health, 1) * g;
    if (a !== 0 || h !== 0) {
      const b = ctx.state.rubyBonus ?? { attack: 0, health: 0 };
      ctx.state.rubyBonus = { attack: b.attack + a, health: b.health + h };
      for (const card of ctx.state.hand) {
        if (CARD_INDEX[card.cardId]?.ruby) { card.attack += a; card.health += h; }
      }
    }
  },

  /** Coinfire Forewoman (Gold spent): your minions of `tribe` gain +attack. The `every` threshold is applied by
   *  `applyGoldSpent` itself, so this only has to do the buff. */
  goldSpentBuffTribeAttack: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const a = num(params.attack, 1) * gold(self);
    if (a <= 0) return;
    for (const c of ctx.state.board) {
      if (tribe && !isTribe(c, tribe as never)) continue;
      addBuff(c, nameOf(self), a, 0);
    }
  },

  /** Set 2 — Billings (Gold spent): give `count` RANDOM friendly minions of `tribe` +attack/+health. The
   *  `every` threshold is applied by `applyGoldSpent`; this does the buff. `count` is the number of recipients
   *  (NOT gold-doubled — golden doubles the STAT, matching "give 2 random Dwarves +10/+10"). Seeded off the
   *  shared cursor so it stays replay-faithful; buffs fewer than `count` only if you field fewer Dwarves. */
  goldSpentBuffRandomTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const a = num(params.attack, 5) * gold(self);
    const h = num(params.health, 5) * gold(self);
    if (a <= 0 && h <= 0) return;
    const pool = ctx.state.board.filter((c) => !tribe || isTribe(c, tribe as never));
    if (pool.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    const avail = [...pool];
    const n = num(params.count, 2);
    for (let k = 0; k < n && avail.length > 0; k++) {
      const idx = rng.int(avail.length);
      addBuff(avail.splice(idx, 1)[0]!, nameOf(self), a, h);
    }
    ctx.state.rngCursor = rng.state();
  },

  /** Set 2 — Gangplank (a card was added to hand): give ONE friendly minion of `tribe` +attack/+health. Left-most
   *  recipient (deterministic — arrange your line), and it may be Gangplank itself ("a friendly Dwarf" includes
   *  it). Fired by `fireOnGainCard` off the conjure/grant path; golden doubles the grant. */
  onGainCardBuffTribe: (ctx, self, params) => {
    // MOVED TO THE ARENA (2026-08-29). The body now serves both phases — a card reaching hand mid-COMBAT
    // fires it too, through `grantToHand` — so the shop and combat halves cannot drift. Behaviour here is
    // unchanged: still RANDOM among the eligible bodies (owner report 2026-08-20: Gangplank "is only
    // targeting left-most dwarf... it should be random"), still one draw off the run cursor, so replays and
    // pinned boards pick the same target as before.
    ARENA_EFFECTS.onGainCardBuffTribe(shopArena(ctx.state, self), params);
  },

  /** Set 2 — Grevlin & Co. (a minion was sold): every `count` minions you sell, this Demon consumes the
   *  right-most Shop minion (golden: the 2 right-most). The tally is per-instance (`soldProgress`, the same
   *  meter Runic Archivist uses) and carries round to round. Fired board-wide by `fireOnMinionSold`. */
  minionSoldConsumeRightmost: (ctx, self, params) => {
    const every = Math.max(1, num(params.count, 3));
    const progress = (self.soldProgress ?? 0) + 1;
    self.soldProgress = progress % every;
    if (progress < every) return;
    const eats = Math.floor(progress / every) * gold(self);
    for (let e = 0; e < eats; e++) {
      const i = rightmostShopMinion(ctx.state);
      if (i < 0) return;
      consumeShopMinion(ctx.state, self, i, 1);
    }
  },

  /** Set 2 — Enigma (this consumed a minion): give minions in the Shop +attack/+health PERMANENTLY, via the same
   *  `tavernBuyBonus` channel Contract Butcher / Staff of Guel use (a lasting buff on everything you buy from
   *  here on, Fodder included). Guarded to THIS body's consume (`payload.minion === self`), matching Ashen
   *  Broodlord's "when this consumes". Golden doubles. */
  onConsumeBuffShop: (ctx, self, params, payload) => {
    if ((payload as { minion?: BoardCard } | undefined)?.minion !== self) return;
    const a = num(params.attack, 2) * gold(self);
    const h = num(params.health, 1) * gold(self);
    if (a === 0 && h === 0) return;
    ctx.state.tavernBuyBonus.atk += a;
    ctx.state.tavernBuyBonus.hp += h;
    buffFodderRunWide(ctx.state, a, h, nameOf(self), false);
  },

  /** Baby Gastrid (Shout, targeted; ex-Quartermaster Dorrin): +Health per Gold spent THIS TURN — a tempo reward for shopping
   *  before you play it, and it reads its live value on the card via `cardText`. */
  battlecryBuffTargetPerGoldSpent: (ctx, self, params, payload) => {
    // Un-aimed re-fire (Resonance / Myra / Echoing Roar) carries no target, so this used to do nothing (owner
    // report 2026-08-25). Auto-pick a RANDOM eligible friendly Dwarf instead — mirroring Appetite Agent's
    // `battlecryTargetConsumesShop`: a friendly OTHER than self respecting the live `targetTribe`, seeded off the
    // shared rng cursor, falling back to self only when it is the only eligible Dwarf.
    let target = (payload as { target?: BoardCard } | undefined)?.target;
    if (!target) {
      const tribe = effectiveTargetTribe(ctx.state, CARD_INDEX[self.cardId]);
      const pool = ctx.state.board.filter((c) => c.uid !== self.uid && (!tribe || isTribe(c, tribe)));
      if (pool.length > 0) {
        const rng = makeRng(ctx.state.rngCursor);
        target = pool[rng.int(pool.length)]!;
        ctx.state.rngCursor = rng.state();
      }
      target = target ?? self;
    }
    const per = num(params.health, 1) * gold(self);
    const h = per * (ctx.state.goldSpentThisTurn ?? 0);
    // Rune of Full Measure: the same number is paid as Attack as well, so the grant becomes +N/+N. Derived
    // from `h` rather than recomputed, so the two halves can never drift apart.
    const a = ctx.state.runeFullMeasure ? h : 0;
    if (a > 0) procRuneId(ctx.state, 'rune_full_measure'); // the rune paid Attack; a 0 grant is not a fire
    if (h > 0 || a > 0) addBuff(target, nameOf(self), a, h);
  },

  /** Kringle (End of Turn; ex-Closing-Time Foreman): the LEFT-most and RIGHT-most minions of `tribe` each gain
   *  +attack/+health per card played this turn. The ends rather than a target, so you choose the recipients by
   *  arranging your line.
   *
   *  Owner change 2026-08-28 (was left-most only, `endOfTurnBuffLeftmostTribePerCard`). One Dwarf on board is
   *  BOTH ends, and it is buffed ONCE — the card names two bodies, not two grants, so the ends are deduped by
   *  identity before anything is added.
   *
   *  ── ITEMIZED, one grant PER CARD PLAYED (owner ask 2026-08-29) ────────────────────────────────────────
   *
   *  *"give +1/+2 and repeat for every card played this turn, so the animation triggers for every card played
   *  rapidly. this will be much more exciting than 1 single animation for the buff."*
   *
   *  The stat outcome is IDENTICAL — n × (+1/+2) is +n/+2n, the same number the live text already prints. What
   *  changes is that it now reads as n hits landing in sequence instead of one lump.
   *
   *  This is not a new pattern: it is the owner's 2026-07-17 ruling for `"+x/+y per z"` End-of-Turn effects,
   *  which `runRecurringEndOfTurn` has followed since ("10 Attachments read as ten +2/+2 hits landing
   *  sequentially, not one +20/+20 lump"). Kringle simply predates the conversion.
   *
   *  Each card played is one WAVE: both ends are buffed inside a single `captureBuffFx` so they pulse
   *  together, and the wave tag lets the UI stagger BETWEEN waves. Without the per-wave capture the diff would
   *  collapse the whole loop back into one event — `captureBuffFx` measures before/after, so the nesting is
   *  what produces separate animations, not the loop. */
  endOfTurnBuffEndsTribePerCard: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const matches = ctx.state.board.filter((c) => !tribe || isTribe(c, tribe as never));
    if (matches.length === 0) return;
    const ends = matches.length === 1 ? [matches[0]!] : [matches[0]!, matches[matches.length - 1]!];
    const played = ctx.state.playedThisTurn?.length ?? 0;
    const a = num(params.attack, 1) * gold(self);
    const h = num(params.health, 0) * gold(self); // Kringle +1/+2 (owner balance 2026-08-15)
    if (played <= 0 || (a <= 0 && h <= 0)) return;
    for (let wave = 0; wave < played; wave++) {
      const before = ctx.state.recruitBuffFx.length;
      captureBuffFx(ctx.state, self, 'minion', () => {
        for (const target of ends) addBuff(target, nameOf(self), a, h);
      });
      for (let i = before; i < ctx.state.recruitBuffFx.length; i++) ctx.state.recruitBuffFx[i]!.fxWave = wave;
    }
  },

  /** Chirurgeon: every `every` cards bought, get a random Shop spell. The buy tally lives on the CARD
   *  (`buyTick`, like every other cards-bought effect), so it carries across combat as printed. */
  cardsBoughtGrantRandomSpell: (ctx, self, params) => {
    conjureToHand(ctx.state, poolOf(ctx.state).spells.filter((c) => c.tier <= ctx.state.tier), num(params.count, 1) * gold(self));
  },

  /** Auric Runemaster (Shout, targeted): Gild a friendly minion. Reuses the spell path's gild so a Shout-gild
   *  and a spell-gild are the same operation — one place for triple/golden bookkeeping. */
  battlecryGildTarget: (ctx, _self, _params, payload) => {
    const target = (payload as { target?: BoardCard } | undefined)?.target;
    if (!target || target.golden) return;
    // Same gild the spell path uses, so triple/golden bookkeeping lives in one place.
    gildMinion(target);
  },


  /** Dwarf King, Brill (Gold spent): a random minion of `tribe` from the run's pool, capped at your tier. */
  goldSpentGrantTribeMinion: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const pool = poolOf(ctx.state).buyable.filter((c) => c.tier <= ctx.state.tier && (!tribe || c.tribe === tribe || c.tribe2 === tribe));
    if (pool.length === 0) return;
    conjureToHand(ctx.state, pool, num(params.count, 1) * gold(self));
  },

  /**
   * Mountainbond (owner rework 2026-08-14) — every `every` Gold spent (the threshold is applied by
   * `applyGoldSpent`, so this only does the payout): mint `count` Rubies to hand AND play one Ruby on each
   * friendly `tribe` minion.
   *
   * The two halves use deliberately different channels. The hand half is `mintRubies`, so the Rubies arrive at
   * the run's live strength and fire the "when you GET a Ruby" watchers (Motherlode, Candle Conduit). The board
   * half mirrors `cardsPlayedPlayRubies` — `addBuff('Ruby', …)` plus `fireOnRubyPlayed`, NOT `castSpell`, since
   * a Ruby is not applied like a Shop spell — so the target's own "when a Ruby is played on this" effects
   * (Ruby Broker's Gold, Resonance Idol's bounce) still see it. Golden doubles both halves.
   */
  goldSpentGetRubiesPlayOnTribe: (ctx, self, params) => {
    const state = ctx.state;
    const mult = gold(self);
    mintRubies(state, num(params.count, 2) * mult);
    // Read the bonus AFTER minting: a Motherlode proc off those Rubies can raise what lands on the board.
    const rb = rubyStatBonus(state);
    const per = num(params.play, 1) * mult;
    const a = (1 + rb.attack) * per;
    const h = (1 + rb.health) * per;
    if (a <= 0 && h <= 0) return;
    // `tribe: 'all'` plays on EVERY friendly minion (Mountainbond's 2026-08-18 rework — "play a Ruby on your
    // minions"); any other value filters by that tribe (the default `'kobold'` when the param is omitted).
    const tribe = str(params.tribe) || 'kobold';
    for (const c of [...state.board]) {
      if (tribe !== 'all' && !isTribe(c, tribe as never)) continue;
      addBuff(c, 'Ruby', a, h);
      fireOnRubyPlayed(state, c, a, h);
    }
  },

  cardsBoughtGetRubies: (ctx, self, params) => {
    mintRubies(ctx.state, num(params.count, 1) * gold(self));
  },

  /** Set 2 — "Your Rubies gain +X/+Y" (Deepvein Tender): raise the run's Ruby strength so every future Ruby
   *  is minted bigger, AND grow every Ruby you already HOLD in hand (they're "your Rubies" too). Rubies already
   *  CAST onto a minion are spent — their buff is baked in and doesn't grow (owner ruling 2026-07-23). */
  // ── SHOP-TRIGGERED ECHOES ────────────────────────────────────────────────────────────────────────────
  // An Echo fired in the SHOP (Funeral on Loan, Ossuary Rite, Deathsayer, Rune of the Reliquary, a Gravetwin
  // copy) resolves through RECRUIT_FACTORIES. Every `onDeath` effect below had a COMBAT factory and no recruit
  // one, so it was silently inert there — the card was destroyed and nothing happened (owner ask 2026-08-04:
  // "all echoes should be wired to work in shop if triggered in any way"). Each mirrors its combat twin's
  // SEMANTICS, not its implementation: there is no live enemy board or attack order in a shop, so the halves
  // that only make sense mid-fight (damage, destroy-the-killer, granting Rise) stay combat-only by design.

  /** Big Huggies / Scalefeather (Echo): put a named card in hand. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGrantSpell: (ctx, self, params) => {
    // Rune of Living Growth: the Echo half of Mushy's grant ticks the improver too (shop-side Echo — a
    // Consume or a sell). The COMBAT Echo's grants tick at settle instead (see the reducer), off the fight's
    // `toHand` events — so every Growth Mushy creates counts, whichever phase it was created in.
    if (ctx.state.runeLivingGrowth && self.cardId === 'd2_scalefeather' && str(params.cardId) === 'growth') {
      procRuneId(ctx.state, 'rune_living_growth');
      // +1 per copy held (recurring family, owner 2026-08-27).
      ctx.state.growthBonus = (ctx.state.growthBonus ?? 0) + gold(self) * runeStacksOf(ctx.state, 'rune_living_growth');
    }
    ARENA_EFFECTS.deathrattleGrantSpell(shopArena(ctx.state, self), params);
  },

  /** Bone Taxer (Echo): raise MAX Gold for the run. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleMaxGold: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleMaxGold(shopArena(ctx.state, self), params);
  },

  /** Equinox Duelist (Echo): buff your other Celestials. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleBuffCelestials: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleBuffCelestials(shopArena(ctx.state, self), params);
  },

  /** Chef Raag (Echo): buff your whole board by the run's Imp aura, floored at +1/+1 — the same floor the
   *  combat half applies, so the card reads the same in either phase. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleBuffAllByImpAura: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleBuffAllByImpAura(shopArena(ctx.state, self), params);
  },

  /** Errand Fiend / Legion pieces (Echo): summon Imps, optionally keyworded and buffed as they land. */
  // ARENA-MIGRATED (Step 3): one body. Drift fixed: the shop now honours the printed goldenText ("+2/+4")
  // by doubling the per-Imp buff for golden, as combat always did.
  summonImps: (ctx, self, params) => {
    ARENA_EFFECTS.summonImps(shopArena(ctx.state, self), params);
  },

  /** Ex-Galloper (Echo): summon a copy of itself WITHOUT the Echo. In the shop the copy is a plain body of the
   *  same card — the recruit board has no per-instance effect list to strip, so the Echo simply doesn't
   *  re-trigger from a summoned token the way it can't in combat either. */
  // ARENA-MIGRATED (Step 3): one body; the shop copy now INHERITS buffed stats + keywords (owner ruling
  // 2026-08-04 — it used to summon a plain base card).
  echoSummonCopyNoEcho: (ctx, self, params) => {
    ARENA_EFFECTS.echoSummonCopyNoEcho(shopArena(ctx.state, self), params);
  },

  /** Gemheart (Echo): summon a Shard carrying the Rubies that were on this body. */
  // ── ARENA-MIGRATED (Step 3, Ruby family): one body; GOLDEN = one Shard at double stats (owner ruling
  //    2026-08-04 — the two-Shards-at-base golden is retired).
  deathrattleSummonRubyStats: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleSummonRubyStats(shopArena(ctx.state, self), params);
  },

  /** Brewer (Echo): get a Dwarven Ale. `grantRandomAle` is already trigger-agnostic, so this is a straight
   *  delegation — the guard params only matter in combat, where the payload says who died. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  combatGrantAle: (ctx, self, params, payload) => {
    // The same guard the combat wrapper keeps. It matters now that the shop DISPATCHES Rallies: `fireShopRally`
    // offers the event to every board body, so a Dwarf whose Ale is a Rally must check the trigger is its own —
    // otherwise it pours a round for somebody else's rally. ('attacker' — Slaughter — has no shop dispatch.)
    const guard = str(params.guard) || 'self';
    if ((guard === 'rally' || guard === 'self') && payload?.minion !== self) return;
    ARENA_EFFECTS.combatGrantAle(shopArena(ctx.state, self), params);
  },

  /** Anvilshade Smith (Echo): summon a token that inherits this body's Attack. The combat half also makes it
   *  swing immediately — meaningless in a shop, so only the summon half applies here. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases (the charge no-ops here — there is
  // no attack queue in a shop).
  echoSummonInheritAttackAndCharge: (ctx, self, params) => {
    ARENA_EFFECTS.echoSummonInheritAttackAndCharge(shopArena(ctx.state, self), params);
  },

  /** Ryme / Dawnclaw (Echo): re-fire both neighbours' Shouts. In the shop every Shout is simply its recruit
   *  factory, so this needs no combat/economy split — `replayBattlecry` is the same path the Myra hero power
   *  and the face-Omen re-fire already use. */
  deathrattleReplayAdjacentBattlecry: (ctx, self) => {
    const board = ctx.state.board;
    const i = board.findIndex((c) => c.uid === self.uid);
    if (i < 0) return;
    const reps = gold(self) ; // golden triggers each neighbour twice
    for (const nb of [board[i - 1], board[i + 1]]) {
      if (!nb) continue;
      const def = CARD_INDEX[nb.cardId];
      if (!def || !hasBattlecry(def)) continue;
      for (let r = 0; r < reps; r++) replayBattlecry(ctx.state, nb);
    }
  },

  /** Set 2 — Faultline Scrapper / Alchemist Brisbane (Echo, RECRUIT half): raise the run's Ruby strength.
   *
   *  The COMBAT half has always existed; this one was missing, so an Echo triggered in the SHOP — Funeral on
   *  Loan, Ossuary Rite, Deathsayer, Rune of the Reliquary, a Gravetwin copy — silently did nothing (owner
   *  report 2026-08-03). Delegates to `rubyStatGain` so the two stay identical by construction rather than by
   *  someone remembering to keep them in step. The Ruby-power flourish needs no wiring: the reducer derives it
   *  from the `rubyBonus` delta, so it fires the moment this does. */
  // ── ARENA-MIGRATED (Step 3, Ruby family): one body in arena.ts serves both phases.
  deathrattleRubyStatGain: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleRubyStatGain(shopArena(ctx.state, self), params);
  },

  /** Set 2 — Geode Guardian (Echo, RECRUIT half): summon `count` Gemheart Golems with Taunt and play `rubies`
   *  Rubies on each (× golden on the RUBIES, never the count — owner was explicit that a Gilded copy still
   *  summons two). Same missing-recruit-half class as above: a borrowed Geode Guardian summoned nothing.
   *
   *  The Rubies go through `addBuff` + `fireOnRubyPlayed`, exactly like a hand-cast Ruby, so the golems' own
   *  on-Ruby watchers see them AND the reducer's Ruby-landed cue detonates on them (it measures the 'Ruby'
   *  buff-count delta, and a freshly summoned body counts from 0 — which is correct, those Rubies just landed). */
  // ── ARENA-MIGRATED (Step 3, Ruby family): one body in arena.ts serves both phases.
  deathrattleSummonGolemsWithRuby: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleSummonGolemsWithRuby(shopArena(ctx.state, self), params);
  },

  rubyStatGain: (ctx, self, params) => {
    const a = num(params.attack) * gold(self);
    const h = num(params.health) * gold(self);
    const b = ctx.state.rubyBonus ?? { attack: 0, health: 0 };
    ctx.state.rubyBonus = { attack: b.attack + a, health: b.health + h };
    // ONLY Rubies — a "Your Rubies gain +X" never touches Shop Spells, and (conversely) a spell buff never
    // touches Rubies, since a Ruby is `ruby` not `spell` (owner ruling 2026-07-23: the two are separate, and
    // each must be buffed explicitly by name).
    for (const card of ctx.state.hand) {
      if (CARD_INDEX[card.cardId]?.ruby) { card.attack += a; card.health += h; }
    }
  },

  /** Legacy single-target buy buff: the minion you bought gets +atk/+hp (not itself). Kept as a primitive —
   *  Brightwing Broker moved to `buffBoardOnBuy`, but the factory stays available to content. */
  buffOnBuy: (_ctx, self, params, { minion }) => {
    if (minion === self) return;
    addBuff(minion, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
  },

  /** Brightwing Broker: buying ANY minion buffs your whole board +atk/+hp (golden doubles). The bought
   *  minion is in hand at this point, so it is not included — this rewards a board you have already
   *  built, rather than the purchase itself (which is what `buffOnBuy` did). */
  buffBoardOnBuy: (ctx, self, params) => {
    const a = num(params.attack) * gold(self);
    const h = num(params.health) * gold(self);
    if (a === 0 && h === 0) return;
    for (const m of ctx.state.board) addBuff(m, nameOf(self), a, h);
  },

  /** Kennelmaster / Bristleback Matron: buff each summoned friend of `tribe`. The magnitude is
   *  the base buff + `self.summonBonus` (Avenge / triple-combined). No golden doubling — a
   *  golden's bonus already encodes the combined magnitude (see checkTriples). */
  buffOnSummon: (_ctx, self, params, { minion }) => {
    if (minion === self) return;
    const tribe = str(params.tribe);
    if (tribe && tribe !== 'any' && !isTribe(minion, tribe as Tribe)) return;
    const bonus = self.summonBonus ?? 0;
    addBuff(minion, nameOf(self), num(params.attack) + bonus, num(params.health) + bonus);
  },

  /** Mama Bear (recruit half) — when a beast is summoned (played / token), buff it +M/+M where M = (base +
   *  accrued `summonBonus`) × golden, then summonBonus climbs by `base`. The improve persists across combat
   *  via the summonBonus carry-back (the combat half mirrors this). A triple resets the accrual (the
   *  summonBonus-combine in checkTriples is keyed to buffOnSummon, not this factory). */
  summonBuffTribeImprove: (ctx, self, params, { minion }) => {
    if (minion === self) return;
    const tribe = str(params.tribe);
    if (tribe && !isTribe(minion, tribe as Tribe)) return;
    const base = num(params.attack, 3);
    const mag = (base + (self.summonBonus ?? 0)) * gold(self);
    addBuff(minion, nameOf(self), mag, mag);
    // Rune of the Den Mother: she also buffs HERSELF by the same amount when she buffs another Beast.
    if (ctx.state.runeDenMother) { procRuneId(ctx.state, 'rune_den_mother'); addBuff(self, 'Rune of the Den Mother', mag, mag); }
    self.summonBonus = (self.summonBonus ?? 0) + base * improveReps(ctx.state); // "improve this" — ×2 under Mastery
  },

  /** Set 2 — Mage-Pup (Shout): cast the spell this token was TAUGHT (`taughtSpellId`, stamped when Moonhowl
   *  Mentor minted it). Because this is a real `onPlay` effect, anything that re-fires Shouts (Drakko and
   *  friends) re-fires the whole cast for free — no special-casing needed on that side.
   *
   *  **Reworked 2026-07-24 (owner: "take a full and complete pass").** The first cut called `castSpell`
   *  directly, which only ever runs a spell's `effects[]`. That silently did NOTHING for a whole class of
   *  spells whose behaviour lives elsewhere in the play path — most visibly Beyond the Summit, which has
   *  `effects: []` and works entirely through `discoverOnPlay` (the reported bug). It also skipped the cast
   *  multipliers, so a taught spell ignored Nimbus / Ancient Runes / Spell Thesis / Yazzus. This now mirrors
   *  the reducer's own spell resolution:
   *   - **Discover spells** open the real Discover, via the shared `discoverSpecFor` + `queueDiscover`.
   *   - **Cast count** comes from `spellCasts` (Yazzus on aimed spells, Ancient Runes, Spell Thesis, Nimbus),
   *     with `singleCast` respected — the same call the hand path makes.
   *   - **Aimed spells** re-target a seeded-random friendly, the rule Rune of Recurrence and Runic Archivist
   *     already use, so "cast a spell without choosing a target" behaves consistently everywhere.
   *
   *  Deliberately NOT handled: a Choose One spell (Apples). Resolving one requires opening a modal and waiting
   *  for a player decision, which a Battlecry mid-resolution can't do — so a taught Choose One casts its FIRST
   *  option rather than silently doing nothing. Called out here because it's a real (small) divergence from
   *  the hand path, not an oversight.
   *
   *  Untaught (or an unknown id) is a clean no-op. */
  battlecryCastTaughtSpell: (ctx, self, _params, payload) => {
    const def = self.taughtSpellId ? CARD_INDEX[self.taughtSpellId] : undefined;
    if (!def?.spell) return;
    const st = ctx.state;
    // A golden Pup casts the whole thing twice; `spellCasts` then applies the run's own multipliers per cast,
    // exactly as playing the spell from hand would.
    for (let g = 0; g < gold(self); g++) {
      const casts = def.singleCast ? 1 : spellCasts(st, def);
      if (def.discoverOnPlay) {
        // A Discover spell's payload is the OFFER, not an `effects[]` — go through the same builder the hand
        // path uses so a taught Beyond the Summit peeks a tier up like the real card.
        const spec = discoverSpecFor(st, def);
        if (spec) for (let n = 0; n < casts; n++) queueDiscover(st, { ...spec });
      } else if (def.chooseOne?.length) {
        // See the note above: cast the first option rather than stranding the play on a modal we can't open.
        const synthetic = { ...def, effects: def.chooseOne[0]!.effects };
        for (let n = 0; n < casts; n++) castSpell(st, synthetic, pickTaughtTarget(st, def));
      } else {
        for (let n = 0; n < casts; n++) {
          // The PLAYER's pick when the Pup was played through the aim picker; otherwise a seeded-random
          // friendly (the Pup was re-fired by something that can't prompt, e.g. a Shout-repeater).
          const target = payload.target ?? pickTaughtTarget(st, def);
          if (def.target && !target) break; // aimed with nothing to aim at → fizzle, like the hand path
          castSpell(st, def, target);
        }
      }
      // Spend the same one-shot charges a hand cast spends, so a taught spell can't double-dip them.
      if (!def.singleCast) {
        st.nextSpellExtraCasts = undefined; // Nimbus charge (already folded into `casts`)
        if (st.spellFirstDoubleEachTurn) st.spellFirstUsedThisTurn = true; // Spell Thesis freebie
      }
    }
  },

  /** Set 2 — Moonhowl Mentor: a Shop Spell was bought — mint a Mage-Pup that has LEARNED it, straight into
   *  hand, so it's playable the same turn (owner 2026-07-24; it used to queue and mint at End of Turn, which
   *  put the payoff a turn away and made the card feel dead on the turn you invested in it).
   *
   *  The per-turn cap is counted PER MENTOR (1 each, 2 if golden) and shared across them via one run-level
   *  tally, so two Mentors teach twice — the tally lives on the run, not the instance, because the cap is
   *  "how many spells got taught this turn", not "how many times this body acted". Respects the hand cap. */
  grantMagePupTaught: (ctx, self, _params, payload) => {
    teachMagePupFrom(ctx.state, self, payload.spellId ?? ''); // per-instance: this Mentor's own latch
  },

  /** Set 2 — Elderhorn "Hunt": your BEAST Rallies and Slaughters trigger `extra` more times, permanently.
   *  Run-level (survives combats) and passed into the fight via `CombatSideState.beastHuntExtra`. Rallies only. Golden
   *  grants 2 instead of 1, per the owner's Gilded text ("trigger 2 additional times"). */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryGrantBeastHunt: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryGrantBeastHunt(shopArena(ctx.state, self), params);
  },

  /** Set 2 — Elderhorn "Ritual": your BEAST Echoes trigger `extra` more times, permanently. */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryGrantBeastRitual: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryGrantBeastRitual(shopArena(ctx.state, self), params);
  },

  /** Set 2 — Groveweaver (summon half): a Beast you summon gets +atk/+hp, at the CURRENT magnitude (base +
   *  this instance's accrued `summonBonus`). Asymmetric on purpose (+2/+4), unlike `summonBuffTribeImprove`'s
   *  symmetric grant, and it does NOT self-improve here — the improvement rides spell casts instead
   *  (`onSpellCastImproveSummon`), which is what the card says. Golden doubles the whole magnitude at grant
   *  time so base and step each double exactly once. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts; the arriver rides params.
  /** Beardsley (owner 2026-08-12: now both phases) — a Beast summoned in the SHOP gets a flat +atk/+hp (golden
   *  doubles). The combat twin lives in `@game/core` factories; Rune of the Zoo's summon-count scaling is a
   *  COMBAT-only rule, so the shop half stays flat. */
  onSummonTribeBuffFlat: (ctx, self, params, { minion }) => {
    if (!minion || minion === self) return;
    const tribe = str(params.tribe);
    if (tribe && !isTribe(minion, tribe as Tribe)) return;
    const g = gold(self);
    // Escalating variant (Beardsley 2026-08-18): +`improve` per stat every `every` tribe summons, tracked on a
    // per-instance counter. Absent `improve` → the plain flat grant, unchanged.
    const improve = num(params.improve, 0);
    const every = Math.max(1, num(params.every, 1));
    const step = improve > 0 ? Math.floor((self.summonBonus ?? 0) / every) : 0;
    const a = (num(params.attack, 6) + improve * step) * g;
    const h = (num(params.health, 6) + improve * step) * g;
    if (a > 0 || h > 0) addBuff(minion, nameOf(self), a, h);
    if (improve > 0) self.summonBonus = (self.summonBonus ?? 0) + 1;
  },

  summonBuffTribeAsym: (ctx, self, params, { minion }) => {
    if (minion === self) return;
    ARENA_EFFECTS.summonBuffTribeAsym(shopArena(ctx.state, self), { ...params, arriver: minion });
    // Rune of the Groveweaver: the grant ALSO lands on the granter. Recomputed with the arena body's own
    // arithmetic (base + this instance's summonBonus, x golden) so the two can't drift, and gated on the same
    // tribe check — a Groveweaver that skipped a non-Beast arriver must not pay itself either.
    if (!ctx.state.runeGroveweaver) return;
    const tribe = str(params.tribe);
    if (tribe && !isTribe(minion, tribe as Tribe)) return;
    const g = gold(self);
    const bonus = self.summonBonus ?? 0;
    const a = (num(params.attack, 2) + bonus) * g;
    const h = (num(params.health, 4) + bonus) * g;
    if (a > 0 || h > 0) addBuff(self, 'Rune of the Groveweaver', a, h);
  },

  /** Set 2 — Groveweaver (improve half): each spell you cast improves this instance's summon grant by `step`.
   *  Stored at BASE magnitude (golden is applied when the buff lands) and scaled by `improveReps` for Rune of
   *  Mastery, matching every other "improve this". */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  onSpellCastImproveSummon: (ctx, self, params) => {
    ARENA_EFFECTS.onSpellCastImproveSummon(shopArena(ctx.state, self), params);
  },

  /** Pack Leader (recruit half) — every time a Beast is summoned WHILE Pack Leader is on the board, accrue
   *  `step` into its `summonBonus`. This is a pure counter (no buff here); the Start-of-Combat half
   *  (`scTribeBuffImproving`, step 0) spends the accrual as a +summonBonus/+summonBonus Beast buff (×golden).
   *  Because it starts at 0 when acquired and only climbs on summons it witnesses, it never counts Beasts
   *  played before you owned it (owner ruling: "only tracks while on board, not retroactively"). Persists
   *  across combats via the same per-uid summonBonus carry-back Kennelmaster/Mama Bear use. */
  countTribeSummon: (ctx, self, params, { minion }) => {
    if (minion === self) return;
    const tribe = str(params.tribe);
    if (tribe && !isTribe(minion, tribe as Tribe)) return;
    self.summonBonus = (self.summonBonus ?? 0) + num(params.step, 3);
  },

  /** Imp Overseer — Battlecry: give your Imps a persistent +atk/+hp run-wide (board + hand + future copies)
   *  via the shared imp enchant (`impBuff`). Golden doubles. */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryBuffImps: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffImps(shopArena(ctx.state, self), params);
  },

  /** Dragon Battlecries: buff your (optionally other) minions of `tribe`. */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryBuffTribe: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffTribe(shopArena(ctx.state, self), params);
  },

  /** Alleycur: Battlecry summon `count` copies of a token beside self. */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecrySummon: (ctx, self, params) => {
    ARENA_EFFECTS.battlecrySummon(shopArena(ctx.state, self), params);
  },

  /** Toxin Tender / Plaguebringer: grant keyword(s) to a friendly minion. Toxin Tender is
   *  player-targeted (`payload.target` is the chosen minion); the auto-pick fallback (Plaguebringer,
   *  or a Myra/face-Omen re-fire with no explicit target) takes the highest-attack friend that still
   *  lacks a granted keyword (never wasting it). A `targetTribe` on the card restricts the auto-pick to
   *  that tribe too (Toxin Tender → friendly Undead only; dual-types count) — so a re-fire can't grant
   *  Venomous off-tribe, and it simply no-ops when no eligible friend exists. */
  // ARENA-MIGRATED (Shout family): one body; the chosen target rides params.
  battlecryGrantKeyword: (ctx, self, params, payload) => {
    ARENA_EFFECTS.battlecryGrantKeyword(shopArena(ctx.state, self), { ...params, target: payload.target });
  },

  /** Twilight Emissary: Battlecry — buff a chosen friendly minion +atk/+hp (golden doubles). The stat sibling
   *  of `battlecryGrantKeyword`, with the SAME target resolution: `payload.target` when the player picked one,
   *  otherwise an auto-pick (a Myra / face-Omen re-fire with no explicit target) of the highest-Attack friend,
   *  restricted by the card's `targetTribe` (Twilight Emissary → friendly Dragons only; dual-types count). It
   *  falls back to buffing ITSELF when no other eligible friend is on board, and no-ops if even that fails. */
  // ARENA-MIGRATED (Shout family): one body; the chosen target rides params.
  battlecryBuffTarget: (ctx, self, params, payload) => {
    ARENA_EFFECTS.battlecryBuffTarget(shopArena(ctx.state, self), { ...params, target: payload.target });
  },

  /** Buddy Buddy / Haven Drake: Battlecry — add `count` random minions to your hand (golden doubles
   *  the count). Drawn from the run's buyable pool (active tribes + neutral). A `tier` param pins the
   *  pick to exactly that tier (Buddy Buddy → 1); absent, any tier up to the CURRENT tavern tier
   *  qualifies (Haven Drake — "abides by the shop tier"). A `tribe` param filters to that tribe,
   *  dual-types included (Haven Drake → 'dragon'). Honors the hand cap. */
  battlecryGainRandomMinion: (ctx, self, params) => {
    const tier = num(params.tier, 0); // 0 = any tier ≤ the current tavern tier
    const tribe = (str(params.tribe) || undefined) as Tribe | undefined;
    const reps = num(params.count, 1) * gold(self);
    // `filter: 'shout'` narrows to minions with a real Battlecry (Muckslinger). A CLASS filter rather than a
    // tribe one — the same axis the rune rewards' `randomFilter` uses — so it composes with `tier`/`tribe`
    // instead of duplicating this pool build in a near-identical factory.
    const filter = str(params.filter);
    const pool = poolOf(ctx.state).buyable.filter(
      (c) =>
        (tier > 0 ? c.tier === tier : c.tier <= ctx.state.tier) &&
        (filter !== 'shout' || hasBattlecry(c)) &&
        (tribe
          ? c.tribe === tribe || c.tribe2 === tribe
          : c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)),
    );
    if (pool.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    for (let i = 0; i < reps && ctx.state.hand.length < handCap(ctx.state); i++) {
      const def = pool[rng.int(pool.length)]!;
      const cb = cardBuff(ctx.state, def.id);
      ctx.state.hand.push({
        uid: `b${ctx.state.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        attack: def.attack + cb.attack + undeadBuyBonus(ctx.state, def),
        health: def.health + cb.health + buyHealthAura(ctx.state, def),
        keywords: [...def.keywords],
        golden: false,
      });
      takeFromPool(ctx.state, def.id); // a conjured copy leaves the shared pool
    }
    ctx.state.rngCursor = rng.state();
  },

  /** Black Belt Brian: Battlecry — Discover a spell. Queues a spell Discover (3 random spells, drawn from
   *  the tavern spell pool); the player picks one into the hand (resolved by the reducer's `discover` case).
   *  GOLDEN: queues a SECOND spell Discover, opened when the first pick resolves. Routing through
   *  `queueDiscover` is what lets this compose with Drakko the Drummer — `playCard` fires this factory once
   *  per Battlecry repeat, so each fire stacks its Discover(s) onto the queue (Brian + Drakko → 2 spells;
   *  golden Brian + Drakko → 4). */
  battlecryDiscoverSpell: (ctx, self) => {
    queueDiscover(ctx.state, { kind: 'spell' });
    if (self.golden) queueDiscover(ctx.state, { kind: 'spell' });
  },

  /** Sea Urchin / Mysterious Joker — Battlecry: Discover a minion of `tribe` (up to your tavern tier).
   *  A `tier` param pins the Discover to EXACTLY that tier instead (Mysterious Joker → 5). Golden
   *  Discovers twice. Routes through queueDiscover so it composes with Drakko (each extra Battlecry
   *  fire stacks an offer onto the queue). */
  battlecryDiscoverMinion: (ctx, self, params) => {
    const raw = str(params.tribe) || undefined;
    // Wayfinder: `tribe: 'uncontrolled'` Discovers across EVERY active tribe not on your board (a SPREAD — the
    // 3 options aren't a guaranteed single tribe), unless you're missing only one. `tribes: []` (you control
    // them all) falls back to any tribe. A fixed `tribe` (Sea Urchin → Beasts) stays a single-tribe Discover.
    const uncontrolled = raw === 'uncontrolled';
    const tribes = uncontrolled ? uncontrolledTribes(ctx.state) : undefined;
    const tribe = uncontrolled ? undefined : (raw as Tribe | undefined);
    // `tierOffset` (Clockwork Assistant): EXACTLY the Shop's tier plus N, clamped to the run's own ceiling —
    // `hasTier7Access` / `maxTierFor`, so Tier 7 is reachable only on a Summit run. Resolved into `fixed`, so
    // it shares the exact-tier branch below rather than adding a third shape.
    const offset = num(params.tierOffset, 0);
    const ceiling = hasTier7Access(ctx.state) ? 7 : maxTierFor(ctx.state.rift);
    const fixed = offset > 0
      ? Math.min(ceiling, ctx.state.tier + offset)
      : num(params.tier, 0); // 0 = tavern-tier bound; N = exactly tier N
    // Exclude the source itself — Sea Urchin shouldn't be able to Discover another Sea Urchin.
    let spec: DiscoverSpec = fixed > 0
      ? { kind: 'minion', tier: fixed, exactTier: fixed, tribe, tribes, exclude: self.cardId }
      : { kind: 'minion', tier: ctx.state.tier, tribe, tribes, exclude: self.cardId };
    // CONTROL EVERY TRIBE → the only minion left that you don't control is an ALL-TYPE one, so that is all you
    // are offered (owner ruling 2026-07-27: "they would ONLY be able to discover a paragon"). This used to fall
    // back to "any tribe", which quietly turned the payoff for assembling one of every type into a generic
    // Discover. An all-type body genuinely IS the answer to "a tribe you don't control", so the fallback is now
    // the literal reading of the card rather than a shrug.
    if (uncontrolled && tribes && tribes.length === 0) {
      const allType = poolOf(ctx.state).buyable
        .filter((c) => c.universalTribe && c.id !== self.cardId && c.tier <= ctx.state.tier)
        .map((c) => c.id);
      // Only take the branch if the run's pool actually HAS one at this tier — otherwise the Discover would
      // open empty, which is strictly worse than the old any-tribe fallback.
      if (allType.length > 0) spec = { kind: 'pool', ids: allType };
    }
    queueDiscover(ctx.state, spec);
    if (self.golden) queueDiscover(ctx.state, spec);
  },

  /** Cinderwing Matron — Battlecry: permanently raise the run-wide SPELL POWER by +atk/+hp (Cinderwing
   *  grants +0/+1 → spells give +1 more Health from now on). Golden doubles. Folds into spellAttackBonus
   *  / spellHealthBonus, so every future stat spell + its display picks it up. */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryBuffSpellPower: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffSpellPower(shopArena(ctx.state, self), params);
  },

  /** Karwind: whenever a Battlecry resolves, buff your minions of `tribe` (+atk/+hp). Golden 2×.
   *  Records the buffed uids so the UI can flame-flash exactly those minions. */
  onBattlecryBuffTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const a = num(params.attack, 1);
    const h = num(params.health, 1);
    const flash = (ctx.state.karwindFlash ??= []);
    // `doubleChance` (Karwind 2026-08-07, owner revision): a percent roll that DOUBLES THE BUFF — +3/+3
    // becomes +6/+6 — rather than firing the grant an extra time. The distinction is not cosmetic: an extra
    // fire would proc every per-trigger watcher again, where a doubled magnitude is one trigger paying more.
    // Drawn off the run cursor so a reloaded or replayed run resolves the same crits. The uid is published for
    // the UI's floating "2x"; a non-crit CLEARS it, so the marker can never re-fire on an ordinary trigger.
    const chance = num(params.doubleChance, 0);
    let crit = false;
    if (chance > 0) {
      const rng = makeRng(ctx.state.rngCursor);
      crit = rng.int(100) < chance;
      ctx.state.rngCursor = rng.state();
    }
    ctx.state.karwindCritUid = crit ? self.uid : undefined;
    const ca = a * (crit ? 2 : 1);
    const ch = h * (crit ? 2 : 1);
    // Golden "+2/+2 twice" = the buff applied twice at base magnitude (not one doubled grant), so both pulses land.
    for (let i = 0; i < gold(self); i++) {
      for (const c of ctx.state.board) {
        if (tribe && tribe !== 'any' && !isTribe(c, tribe as Tribe)) continue;
        addBuff(c, nameOf(self), ca, ch);
        if (!flash.includes(c.uid)) flash.push(c.uid);
      }
    }
  },

  /** Hunter (recruit half) — when this gains Attack in the shop (e.g. a Fortify), give every friendly minion
   *  +Health. Health-only, so it can never re-trigger onGainAttack (no loop). Golden doubles. Dispatched by
   *  `fireOnGainAttack` when a recruit buff raises Hunter's Attack. */
  onGainAttackBuffAll: (ctx, self, params) => {
    const h = num(params.health, 2) * gold(self);
    for (const c of ctx.state.board) addBuff(c, nameOf(self), 0, h);
  },

  /** Hunter (recruit half, scaling aura) — when this gains Attack in the shop, give every OTHER friendly
   *  minion the current per-proc +N/+N, then improve this by the base +N/+N (per-instance, via `summonBonus`).
   *  Excludes self + a re-entry guard so a Hunter buffing another Hunter can't loop. Golden doubles the grant. */
  // ARENA-MIGRATED (Step 3): one body; this shop formula WON the divergence (owner ruling 2026-08-04).
  onGainAttackBuffImproving: (ctx, self, params) => {
    if (recruitHuntGuard.has(self)) return;
    recruitHuntGuard.add(self);
    try {
      ARENA_EFFECTS.onGainAttackBuffImproving(shopArena(ctx.state, self), params);
    } finally {
      recruitHuntGuard.delete(self);
    }
  },

  // --- Demons (Consume, recruit-resolved: bakes into stats before combat) ---

  /** Queue Fodder (Fred) into the *next* tavern refresh (golden adds 2). Soulfeeder fires it on
   *  Battlecry; Maw of the Pit fires it at End of Turn. */
  addTavernFodder: (ctx, self, params) => {
    const count = num(params.count, 1) * gold(self);
    const id = str(params.tokenId) || 'fred';
    (ctx.state.pendingTavern ??= []).push(...Array(count).fill(id));
    stampFodderSend(ctx.state, self?.uid); // Fodder Infusion FX: tendrils from the sender to the shop line
  },

  /** Queue Fodder across the next `shops` tavern refreshes (Soulfeeder: "add a Fodder to the next 2 shops";
   *  golden doubles the per-shop count). Arms `fodderSchedule`, consumed one refresh at a time. */
  addFodderNextShops: (ctx, self, params) => {
    armFodderSchedule(ctx.state, num(params.count, 1) * gold(self), num(params.shops, 2));
    stampFodderSend(ctx.state, self?.uid); // Fodder Infusion FX
  },

  /** The Godfodder — Battlecry: CREATE a Fodder (Fred) and feed it to the targeted friendly minion
   *  (`payload.target`); golden makes 2. Each created Fodder carries the run-wide Fodder enchant
   *  (Ritualist/Bane), grants its stats × the target's fodder multiplier (Voracious Imp ×2), fires the
   *  normal onConsume pipeline, and plays the eat animation (`fodderEaten`). Mirrors the Consume spell
   *  (`spellDemonConsumeFodder`) — it does NOT depend on Fodder being in the shop, so it always resolves. */
  battlecryTargetConsumeFodder: (ctx, self, _params, payload) => {
    const target = payload.target ?? self;
    const fodder = CARD_INDEX.fred;
    if (!fodder) return;
    const count = gold(self); // 1 normally, 2 if golden
    const cb = cardBuff(ctx.state, fodder.id); // a created Fodder carries the run-wide Fodder enchant
    const fa = fodder.attack + cb.attack;
    const fh = fodder.health + cb.health;
    const mult = fodderMultiplier(target);
    const eaten: { eaterUid: string; fodderId: string; attack: number; health: number; gainA: number; gainH: number }[] = [];
    for (let i = 0; i < count; i++) {
      addBuff(target, 'Consume', fa * mult, fh * mult);
      fire(ctx, 'onConsume', { minion: target });
      eaten.push({ eaterUid: target.uid, fodderId: fodder.id, attack: fa, health: fh, gainA: fa * mult, gainH: fh * mult });
      noteFodderConsumed(ctx.state, fa, fh, target);
    }
    if (eaten.length > 0) {
      // APPEND (not replace): Drakko re-fires this Battlecry, so each fire's Fodder must accumulate — else
      // only the last fire's ghost would animate (the Godfodder anim reads the final `fodderEaten`).
      // `applyBattlecryTarget` clears `fodderEaten` before the repeats, so this stays per-play.
      ctx.state.fodderEaten = [...(ctx.state.fodderEaten ?? []), ...eaten];
      ctx.state.fodderEatenSeq += 1;
    }
  },

  /** Abyssal Feeder — End of Turn: each board-adjacent friendly minion Consumes a created Fodder (Fred),
   *  gaining its enchanted stats × the eater's fodder multiplier and firing the normal onConsume pipeline.
   *  Golden → each neighbor Consumes 2. Mirrors The Godfodder's consume, applied to both neighbors. */
  endOfTurnAdjacentConsumeFodder: (ctx, self) => {
    adjacentConsumeFodder(ctx.state, self, gold(self)); // golden → each neighbor Consumes 2
  },

  /** Feasting Bogrot — End of Turn: Bogrot itself Consumes a Fodder (gaining its stats × its multiplier + firing
   *  the onConsume pipeline), then ALSO gives that Fodder's stats to its two board-adjacent minions. Golden → ×2. */
  endOfTurnFeastConsume: (ctx, self) => {
    feastConsume(ctx.state, self, gold(self));
  },

  /** Herald of the Apocalypse — Battlecry: EVERY friendly Demon Consumes a created Fodder (Fred) — each gains its
   *  enchanted stats × its own fodder multiplier and fires the onConsume pipeline. Golden → each Consumes 2. */
  battlecryAllDemonsConsume: (ctx, self) => {
    const fodder = CARD_INDEX.fred;
    if (!fodder) return;
    const demons = ctx.state.board.filter((c) => isTribe(c, 'demon'));
    if (demons.length === 0) return;
    const cb = cardBuff(ctx.state, fodder.id);
    const fa = fodder.attack + cb.attack;
    const fh = fodder.health + cb.health;
    const count = gold(self); // golden → each Demon Consumes 2
    const eaten: { eaterUid: string; fodderId: string; attack: number; health: number; gainA: number; gainH: number }[] = [];
    for (const target of demons) {
      const mult = fodderMultiplier(target);
      for (let i = 0; i < count; i++) {
        addBuff(target, 'Consume', fa * mult, fh * mult);
        fire(ctx, 'onConsume', { minion: target });
        eaten.push({ eaterUid: target.uid, fodderId: fodder.id, attack: fa, health: fh, gainA: fa * mult, gainH: fh * mult });
        noteFodderConsumed(ctx.state, fa, fh, target);
      }
    }
    if (eaten.length > 0) {
      ctx.state.fodderEaten = [...(ctx.state.fodderEaten ?? []), ...eaten];
      ctx.state.fodderEatenSeq += 1;
    }
  },

  /** Implosion (cast) — give your Imps +atk/+hp run-wide, casting once by default and once MORE per Demon you
   *  control (so 1 + your Demons total). Each cast folds in the run's spell power (like every stat spell).
   *  Untargeted. Display count via `implosionCasts` / live text via `implosionText`. */
  spellBuffImpsPerDemon: (ctx, _self, params) => {
    const casts = implosionCasts(ctx.state);
    const a = num(params.attack, 2) + spellAttackBonus(ctx.state);
    const h = num(params.health, 2) + spellHealthBonus(ctx.state);
    for (let i = 0; i < casts; i++) buffImpsRunWide(ctx.state, a, h, 'Implosion');
  },

  /** Pactstone Acolyte / Ravening Glutton: on any friendly consume, grow. */
  onConsumeBuffSelf: (_ctx, self, params) => {
    addBuff(self, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
  },

  /** Maw of the Pit: on any friendly consume, gain a keyword (a Divine Shield). */
  onConsumeGrantSelfKeyword: (_ctx, self, params) => {
    const kw = str(params.keyword) as Keyword;
    if (kw && !self.keywords.includes(kw)) self.keywords.push(kw);
  },

  /** Maw of the Pit: on any friendly consume, gain a Divine Shield for the *next combat only*. The DS
   *  keyword is added (so it shows + enters the snapshot); `tempShield` flags it so `resolveCombat`
   *  strips it after the fight. Consuming again re-arms it. */
  onConsumeShieldNextCombat: (_ctx, self) => {
    self.tempShield = true;
    if (!self.keywords.includes('DS')) self.keywords.push('DS');
  },

  /** Spirit Pup: each spell cast (while on board) ticks a per-instance counter; at `at` it transforms
   *  into `into`, keeping its current stats and applying the new form's *retroactive* spell buff —
   *  +retroPerSpell/+retroPerSpell for EVERY spell cast this game (the global tally), not just the
   *  ones that counted toward the transform. */
  spellCastTransform: (ctx, self, params) => {
    self.spellProgress = (self.spellProgress ?? 0) + 1;
    if (self.spellProgress < num(params.at, 10)) return;
    self.cardId = str(params.into); // swap form (new art + effects), keeping the instance's stats
    self.spellProgress = undefined;
    // Optional retroactive buff (+retroPerSpell per spell cast this game). Spirit Pup omits it → 0.
    const per = num(params.retroPerSpell, 0) * gold(self);
    addBuff(self, nameOf(self), ctx.state.spellsCast * per, ctx.state.spellsCast * per);
  },

  /** Strange Revision — cast on a friendly minion: transform it into a random OTHER minion of the SAME tier
   *  (from your active tribes + neutral), keeping its BONUS stats — the new form is its new base plus whatever
   *  the old minion had gained above its base. Keeps the buff breakdown + added keywords + golden flag. */
  spellTransformSameTier: (ctx, self) => {
    const oldDef = CARD_INDEX[self.cardId];
    if (!oldDef) return;
    const pool = poolOf(ctx.state).buyable.filter(
      (c) => c.tier === oldDef.tier && c.id !== self.cardId && (c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)),
    );
    if (pool.length === 0) return; // nothing to become → no-op (spell still consumed)
    const rng = makeRng(ctx.state.rngCursor);
    const newDef = pool[rng.int(pool.length)]!;
    ctx.state.rngCursor = rng.state();
    const bonusA = self.attack - oldDef.attack; // the stats it had gained above its old base
    const bonusH = self.health - oldDef.health;
    self.cardId = newDef.id;
    self.tribe = newDef.tribe;
    self.attack = newDef.attack + bonusA;
    self.health = newDef.health + bonusH;
  },

  /** Available primitive: +atk/+hp on each spell cast (buff self). No card uses it currently. */
  spellCastBuffSelf: (_ctx, self, params) => {
    addBuff(self, nameOf(self), num(params.attack, 1) * gold(self), num(params.health, 1) * gold(self));
  },

  /** Spirit Worgen: when a friendly minion of one of `tribes` is summoned (played or token-summoned),
   *  gain +X/+X where X = base × (1 + spells cast THIS turn) — so each spell cast this turn improves the
   *  per-summon gain by another full `base`. Golden doubles `base`. Self-targeting; ignores its own arrival. */
  // ARENA-MIGRATED (Step 3): one body; this shop formula WON the divergence (owner ruling 2026-08-04).
  summonBuffSelfTribe: (ctx, self, params, { minion }) => {
    if (minion === self) return;
    ARENA_EFFECTS.summonBuffSelfTribe(shopArena(ctx.state, self), { ...params, arriver: minion });
  },

  /** Hoard Whelp — Sell: gain `amount` Gold (golden doubles). Fired by the reducer's sell case via `fireOnSell`. */
  onSellGainGold: (ctx, self, params) => {
    gainGold(ctx.state, num(params.amount, 6) * gold(self));
  },

  /** Set 2 — Beggy (Sell): mint `count` Rubies to hand when this is sold (golden doubles). Fired by the sell
   *  case via `fireOnSell`. `mintRubies` bakes the run's live Ruby strength in, like every other Ruby gain. */
  onSellGetRubies: (ctx, self, params) => {
    mintRubies(ctx.state, num(params.count, 2) * gold(self));
  },

  /** Salvatore McKlusky (Tier 7) — selling this opens `count` back-to-back minion Discovers at `tier`
   *  (golden: the offered cards are GILDED). Only one Discover overlay can be open at a time, so the extras
   *  queue through the standard `pendingDiscovers` channel the same way multi-Discover heroes do. */
  onSellDiscover: (ctx, self, params) => {
    const tier = num(params.tier, 6);
    const count = num(params.count, 2);
    const spec = { kind: 'minion' as const, tier, exactTier: tier, golden: !!self.golden };
    for (let i = 0; i < count; i++) queueDiscover(ctx.state, spec);
  },

  /** Lab Experiment (Tier 7) — the RECRUIT half of its Echo: conjure `count` random MINIONS of `tier` to
   *  hand (minions only — unlike `endOfTurnGrantRandomTierCard`, which also draws spells). Golden doubles. */
  // ARENA-MIGRATED (Echo family): one body in arena.ts serves both phases.
  deathrattleGainRandomMinion: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleGainRandomMinion(shopArena(ctx.state, self), params);
  },
  // ARENA-BORN (Echo family): this had NO shop half at all — Funeral on Loan / Ossuary Rite / a Gravetwin
  // copy silently did nothing. The shared body works here natively.
  deathrattleGrantRebornAll: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleGrantRebornAll(shopArena(ctx.state, self), params);
  },
  // ARENA-BORN (Echo family, owner report 2026-08-04): a borrowed Legion Shepherd summoned nothing.
  deathrattleImpsOverflowGrant: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleImpsOverflowGrant(shopArena(ctx.state, self), params);
  },
  // ARENA-BORN (Echo family, owner ruling): a borrowed Blaster damages YOUR board.
  deathrattleDamageAll: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleDamageAll(shopArena(ctx.state, self), params);
  },
  /** Set 2 — Fel Spikes (Echo), SHOP half: a borrowed / shop-fired Echo damages YOUR board (there is no enemy
   *  in the shop, same ruling as Blaster) EXCEPT your minions of `exceptTribe`. Bodies taken to 0 die here too,
   *  their own Echoes firing — mirroring the shop `damageAll`. */
  deathrattleDamageAllExceptTribe: (ctx, self, params) => {
    const amount = num(params.amount, 1) * gold(self);
    if (amount <= 0) return;
    const exc = str(params.exceptTribe);
    for (const c of [...ctx.state.board]) {
      if (exc && isTribe(c, exc as never)) continue;
      c.health -= amount;
    }
    const dead = ctx.state.board.filter((c) => c.health <= 0);
    for (const d of dead) {
      const idx = ctx.state.board.indexOf(d);
      if (idx >= 0) ctx.state.board.splice(idx, 1);
      fireOnFriendDeath(ctx.state, d); // owner ruling 2026-08-26: shop deaths notify on-death watchers
    }
    for (const d of dead) fireRecruitDeathrattles(makeContext(ctx.state), d);
  },
  // ARENA-BORN (Echo family): Nanon, Legion Shepherd's class.
  deathrattleSummonOverflowBuff: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleSummonOverflowBuff(shopArena(ctx.state, self), params);
  },
  // ARENA-BORN (Echo family): the Lantern Echo really casts the spell in the shop.
  deathrattleCastTribeAttack: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleCastTribeAttack(shopArena(ctx.state, self), params);
  },

  // ── BORROWED-ECHO CLASS FIX (owner report 2026-08-14) — these Echo factories had NO shop-side body, so
  // Funeral on Loan (and Ossuary Rite / Gravetwin / Reliquary / Deathsayer) fired them into a `?.()` no-op.
  // Native recruit bodies mirroring the combat FACTORIES, so the Echo actually happens in the shop. ──

  /** Menagerie Mammoth: Echo — summon `count` random `tribe` minions from the run pool. */
  deathrattleSummonRandomTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const pool = poolOf(ctx.state).buyable.filter(
      (c) => !c.token && !c.spell && (!params.excludeSelf || c.id !== self.cardId)
        && (!tribe || c.tribe === tribe || c.tribe2 === tribe),
    );
    if (pool.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    for (let i = 0; i < num(params.count, 2) * gold(self); i++) ctx.summon(pool[rng.int(pool.length)]!, self.uid);
    ctx.state.rngCursor = rng.state();
  },

  /** Bullseye: Echo — summon `count` random `tribe` minions and SET each to `stat`/`stat` (golden doubles the
   *  statline, not the count — mirrors the combat body). */
  deathrattleSummonRandomTribeSetStats: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const pool = poolOf(ctx.state).buyable.filter((c) => !c.token && !c.spell && (!tribe || c.tribe === tribe || c.tribe2 === tribe));
    if (pool.length === 0) return;
    const s = num(params.stat, 7) * gold(self);
    const rng = makeRng(ctx.state.rngCursor);
    for (let i = 0; i < num(params.count, 1); i++) {
      const made = ctx.summon(pool[rng.int(pool.length)]!, self.uid);
      if (made) { made.attack = s; made.health = s; }
    }
    ctx.state.rngCursor = rng.state();
  },

  /** Kobebes: Echo — play `count` Rubies on EACH of your `tribe` minions (at the run's live Ruby strength). */
  deathrattlePlayRubiesTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const per = num(params.count, 3) * gold(self);
    if (per <= 0) return;
    const rb = rubyStatBonus(ctx.state);
    const a = (1 + rb.attack) * per, h = (1 + rb.health) * per;
    if (a <= 0 && h <= 0) return;
    for (const c of ctx.state.board) {
      if (tribe && !isTribe(c, tribe as Tribe)) continue;
      addBuff(c, 'Ruby', a, h);
      fireOnRubyPlayed(ctx.state, c, a, h);
    }
  },

  /** Right Hand Hank: Echo — buff the RIGHT-most Shop slot for the rest of the run (Market Tormentor's
   *  `rightmostSlotBuff` accumulator: grow the total, land the increment on the current offer). */
  deathrattleBuffRightmostSlot: (ctx, self, params) => {
    const st = ctx.state;
    const a = num(params.attack, 6) * gold(self);
    const h = num(params.health, 3) * gold(self);
    st.rightmostSlotBuff = { attack: (st.rightmostSlotBuff?.attack ?? 0) + a, health: (st.rightmostSlotBuff?.health ?? 0) + h };
    const i = rightmostShopMinion(st);
    if (i >= 0) addOfferBuff(st.shop[i]!, nameOf(self), a, h);
  },

  /** Sporebat: Echo — cast your last-cast spell again in the shop. A targeted spell aims at a friendly Beast
   *  (mirrors the combat body's beast pool); with none, it fizzles. */
  deathrattleCastLastSpell: (ctx, self) => {
    const id = ctx.state.lastSpellCastId;
    const def = id ? CARD_INDEX[id] : undefined;
    if (!def?.spell) return;
    let target: BoardCard | undefined;
    if (def.target) {
      target = ctx.state.board.find((c) => isTribe(c, 'beast') && c.uid !== self.uid);
      if (!target) return;
    }
    castSpell(ctx.state, def, target);
  },

  /** Wolvie: Echo — buff your NEXT summoned `tribe` minion +atk/+hp (owner ruling 2026-08-14: works in shop).
   *  Sets a one-shot pending buff consumed by the shop summon path; cleared at End of Turn if unused. */
  deathrattleBuffNextSummon: (ctx, self, params) => {
    ctx.state.pendingSummonBuff = {
      tribe: (str(params.tribe) || 'beast') as Tribe,
      attack: num(params.attack, 2) * gold(self),
      health: num(params.health, 4) * gold(self),
      source: nameOf(self),
    };
  },

  /** Scrap Vendor — End of Turn: bank `amount` Gold into your next shop (golden doubles). Uses the standard
   *  bonus-Gold channel so it survives the per-turn embers reset. */
  endOfTurnBonusGold: (ctx, self, params) => {
    ctx.state.bonusEmbersNextTurn = (ctx.state.bonusEmbersNextTurn ?? 0) + num(params.amount, 1) * gold(self);
  },

  /** Skybound Archivist — End of Turn: your WEAKEST Dragon gains stats = `pct`% of your STRONGEST Dragon's stats
   *  (golden doubles the pct). Weakest/strongest by Attack+Health; needs ≥2 distinct Dragons. */
  endOfTurnBuffWeakestDragon: (ctx, self, params) => {
    const dragons = ctx.state.board.filter((c) => isTribe(c, 'dragon'));
    if (dragons.length < 2) return;
    const strongest = dragons.reduce((a, b) => (b.attack + b.health > a.attack + a.health ? b : a));
    const weakest = dragons.reduce((a, b) => (b.attack + b.health < a.attack + a.health ? b : a));
    if (weakest === strongest) return;
    const pct = (num(params.pct, 20) * gold(self)) / 100;
    addBuff(weakest, nameOf(self), Math.round(strongest.attack * pct), Math.round(strongest.health * pct));
  },

  /** Archmagus Guel: after a tavern spell is cast, give `count` *other* friendly minions +atk/+hp.
   *  Targets are random (seeded by the run cursor) so the buffs spread rather than snowball one carry. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases (Guel).
  spellCastBuffOthers: (ctx, self, params) => {
    ARENA_EFFECTS.spellCastBuffOthers(shopArena(ctx.state, self), params);
  },


  /** Runescale Drake (recruit half): each tavern spell cast while THIS instance is on the board ticks its
   *  per-instance `spellProgress` by 1 (non-retroactive — a freshly bought copy starts at 0). The Start-of-
   *  Combat half reads that tally to size its Dragon buff; combat casts tick it at settle (see resolveCombat). */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  spellCastImproveSelf: (ctx, self, params) => {
    ARENA_EFFECTS.spellCastImproveSelf(shopArena(ctx.state, self), params);
  },

  /** Flowing Monk (recruit half): when a summon can't fit the full board, Engrave `count` random friendly
   *  minions +atk/+hp (recruit buffs are inherently permanent). The magnitude improves by another +atk/+hp
   *  per `improveEvery` overflows — the tally rides in `summonBonus` (the per-instance accrual shared with
   *  the combat half via the carry-back), so both halves grow the same counter. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases (Flowing Monk).
  overflowBuffRandom: (ctx, self, params) => {
    ARENA_EFFECTS.overflowBuffRandom(shopArena(ctx.state, self), params);
  },

  /** End of Turn: buff self (+atk/+hp) when the recruit turn ends. */
  endOfTurnBuff: (_ctx, self, params) => {
    addBuff(self, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
  },

  /** Spirit Worgen — End of Turn: gain +(atk)/+(hp) for each `tribes` minion you PLAYED this turn, with the
   *  per-unit amount improved by +1/+1 for each spell you cast this turn (`spellsThisTurn`). Golden doubles the
   *  whole gain. Reads the per-turn `playedThisTurn` counter (reset each turn), so it rewards a wide beast/dragon
   *  turn backed by spells. */
  endOfTurnBuffPerTribePlayed: (ctx, self, params) => {
    const tribes = (params.tribes as Tribe[] | undefined) ?? ['beast', 'dragon'];
    const played = (ctx.state.playedThisTurn ?? []).filter((id) => {
      const def = CARD_INDEX[id];
      return def ? tribes.some((t) => def.tribe === t || def.tribe2 === t) : false;
    }).length;
    if (played === 0) return;
    const g = gold(self);
    const perA = num(params.attack, 2) + ctx.state.spellsThisTurn;
    const perH = num(params.health, 2) + ctx.state.spellsThisTurn;
    addBuff(self, nameOf(self), perA * played * g, perH * played * g);
  },

  /** Set 2 — Malphas "Feast" (owner rework 2026-08-11): at End of Turn EACH of your friendly Demons Consumes ONE
   *  Shop minion. Golden makes every consume grant DOUBLE stats — the `times` arg scales the eater's stat gain,
   *  NOT the number of minions eaten (a gilded Malphas isn't twice as many bodies, it's twice the growth). */
  endOfTurnEndDemonsConsumeSides: (ctx, self, params) => {
    // Gated on the Choose One pick. `applyChooseOne` fires an option's effects ONCE, as a battlecry, so a
    // PERSISTENT option (this one, and Legion) can't live in `chooseOne[].effects` — it would fire at pick time
    // and never again. Both halves are printed effects instead, each checking the branch this body became.
    if (num(params.option, -1) >= 0 && self.chosenOption !== num(params.option, -1)) return;
    const demons = ctx.state.board.filter((c) => isTribe(c, 'demon'));
    if (demons.length === 0) return;
    const times = gold(self); // 1, or 2 (double stats gained) when golden
    for (const eater of demons) {
      const i = ctx.state.shop.findIndex((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
      if (i < 0) break; // no edible minion left in the row
      consumeShopMinion(ctx.state, eater, i, times);
    }
  },

  /** Set 2 — Hellrider: every `every` refreshes, consume the RIGHT-most Shop minion. The count is
   *  per-instance (`eotTick`, already reset-safe and carried on the card), so it means "four refreshes since
   *  this arrived" rather than four since the run began. Golden doubles the stats gained, not the frequency. */
  onShopRefreshConsume: (ctx, self, params) => {
    const every = Math.max(1, num(params.every, 4));
    const tick = (self.eotTick ?? 0) + 1;
    self.eotTick = tick;
    if (tick % every !== 0) return;
    const i = rightmostShopMinion(ctx.state);
    if (i < 0) return;
    consumeShopMinion(ctx.state, self, i, num(params.times, 1) * gold(self));
  },

  /** Set 2 — Chipper: whenever you PLAY a `tribe` minion, THIS minion Consumes a Shop minion (owner fix
   *  2026-08-01: golden was feeding a random friendly Demon; both texts now say "this Consumes"). Hooked on
   *  `onSummon` (the recruit-phase "a minion entered play" event), guarded to the tribe.
   *
   *  `params.self` existed for exactly this and was never honored — with it set the eater is the card itself;
   *  without it the old any-friendly behaviour survives for a future card that wants it (random off the run
   *  cursor). Guarded against Chipper's own arrival so playing it doesn't immediately feed itself. */
  /** Set 2 — Herzog / Vaultkeeper: whenever you play a `tribe` minion, gain +N/+N where N = base +
   *  floor(spells / per), read live off the run's lifetime count (retroactive). Golden doubles the grant.
   *
   *  "Spells" is the UMBRELLA of Shop Spells + Rubies (`spellsCast + rubyCasts`) — the documented contract on
   *  `RunState.rubyCasts`, and the same total `fireOnRubyCast` uses. Owner ruling 2026-08-15: the card reads
   *  "spells", so a Ruby counts. (Under Rune of the Spellstone a Ruby also raises `spellsCast`, so it counts
   *  through both channels — pre-existing behaviour of this umbrella, not introduced here.) */
  onTribePlayedBuffSelfPerSpell: (ctx, self, params, payload) => {
    const played = payload.minion;
    const tribe = str(params.tribe) || 'dragon';
    if (!played || played.uid === self.uid || !isTribe(played, tribe as never)) return;
    const casts = (ctx.state.spellsCast ?? 0) + (ctx.state.rubyCasts ?? 0);
    const step = Math.floor(casts / Math.max(1, num(params.per, 4)));
    const grant = num(params.base, 1) * (1 + step) * gold(self); // step scales with base (base 1 = old +1/step; base 2 = +2/step)
    addBuff(self, nameOf(self), grant, grant);
    // Rune of the Vaultkeeper: ALSO give the same grant to an adjacent minion (a seeded pick when both exist).
    if (ctx.state.runeVaultkeeper) {
      const idx = ctx.state.board.findIndex((c) => c.uid === self.uid);
      const neighbours = [ctx.state.board[idx - 1], ctx.state.board[idx + 1]]
        .filter((c): c is BoardCard => !!c && isTribe(c, 'dragon' as never)); // owner 2026-08-18: adjacent DRAGONS only
      if (neighbours.length > 0) {
        procRuneId(ctx.state, 'rune_herzog');
        const rng = makeRng(ctx.state.rngCursor);
        const target = neighbours[rng.int(neighbours.length)]!;
        ctx.state.rngCursor = rng.state();
        addBuff(target, 'Rune of the Vaultkeeper', grant, grant);
      }
    }
  },

  onTribePlayedConsumeShop: (ctx, self, params, payload) => {
    const played = payload.minion;
    const tribe = str(params.tribe) || 'demon';
    if (!played || played.uid === self.uid || !isTribe(played, tribe as never)) return;
    const edible = ctx.state.shop
      .map((_, i) => i)
      .filter((i) => { const d = CARD_INDEX[ctx.state.shop[i]!.cardId]; return !!d && !d.spell && !d.ruby; });
    if (edible.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    let eater = self;
    if (params.self !== true) {
      const eaters = ctx.state.board.filter((c) => isTribe(c, tribe as never));
      if (eaters.length === 0) return;
      eater = eaters[rng.int(eaters.length)]!;
    }
    const pick = edible[rng.int(edible.length)]!;
    ctx.state.rngCursor = rng.state();
    consumeShopMinion(ctx.state, eater, pick, num(params.times, 1) * gold(self));
  },

  /** Set 2 — Cinder Clerk (Shout): consume a random Shop minion. `times` 2 on golden = "gain double its stats"
   *  (the Gilded rider), which is the shared `consumeShopMinion` multiplier rather than a second effect. */
  battlecryConsumeShopRandom: (ctx, self, params) => {
    const edible = ctx.state.shop
      .map((_, i) => i)
      .filter((i) => { const d = CARD_INDEX[ctx.state.shop[i]!.cardId]; return !!d && !d.spell && !d.ruby; });
    if (edible.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    const pick = edible[rng.int(edible.length)]!;
    ctx.state.rngCursor = rng.state();
    consumeShopMinion(ctx.state, self, pick, num(params.times, 1) * (self.golden ? 2 : 1));
  },

  /** Set 2 — Bob Blart (2026-08-14): consume the RIGHT-most Shop minion. Golden doubles the stats gained
   *  ("and gain double its stats"), not the number eaten.
   *
   *  Rune of Blart rides HERE (it follows the card, not the factory Blart's effect used to live on). Owner
   *  rework 2026-08-19: the clause is no longer a second EAT — the meal's stats are SHARED SIDEWAYS to the
   *  eater's neighbours. Read the offer BEFORE the eat (the row shifts, and the offer is gone afterwards),
   *  and read adjacency at eat time so re-seating between meals re-aims it. */
  consumeShopRightmost: (ctx, self, params) => {
    const times = num(params.times, 1) * (self.golden ? 2 : 1);
    const i = rightmostShopMinion(ctx.state);
    if (i < 0) return;
    const meal = ctx.state.runeBlart ? offerBuyStats(ctx.state, ctx.state.shop[i]!) : null;
    consumeShopMinion(ctx.state, self, i, times);
    if (!meal) return;
    procRuneId(ctx.state, 'rune_blart');
    const idx = ctx.state.board.findIndex((c) => c.uid === self.uid);
    for (const nb of [ctx.state.board[idx - 1], ctx.state.board[idx + 1]]) {
      if (nb) addBuff(nb, 'Rune of Blart', meal.attack * times, meal.health * times);
    }
  },

  /** Set 2 — Appetite Agent (targeted Shout): the TARGET minion consumes `count` Shop minions — not this one.
   *  The eater being someone else is the whole card, so an un-aimed play (auto-pick fallback) still routes the
   *  gain to that pick rather than silently feeding the Agent. */
  battlecryTargetConsumesShop: (ctx, self, params, payload) => {
    // Un-aimed play / re-fire: pick a RANDOM eligible target, not the left-most (owner report 2026-08-14 — it
    // always fed the left-most minion). Eligible = a friendly OTHER than self, respecting the card's targetTribe
    // after runes (Demons only, unless Rune of Open Appetite drops that). Seeded off the shared rng cursor so it
    // stays deterministic/replayable. Falls back to self only when no eligible friend exists.
    let target = payload.target;
    if (!target) {
      const tribe = effectiveTargetTribe(ctx.state, CARD_INDEX[self.cardId]);
      const pool = ctx.state.board.filter((c) => c.uid !== self.uid && (!tribe || isTribe(c, tribe)));
      if (pool.length > 0) {
        const rng = makeRng(ctx.state.rngCursor);
        target = pool[rng.int(pool.length)]!;
        ctx.state.rngCursor = rng.state();
      }
    }
    target = target ?? self;
    // Rune of Open Appetite bursts only when it actually ENABLED this pick — i.e. the eater is off-type for
    // the card's declared `targetTribe`. Deliberately not stamped inside `effectiveTargetTribe`: that helper
    // is a pure query the aim UI, the can-target probe and the auto-pick pool all call, so a stamp there
    // would fire on hover and on every re-render rather than on the feed.
    const declared = CARD_INDEX[self.cardId]?.targetTribe;
    if (ctx.state.runeOpenAppetite && declared && !isTribe(target, declared)) procRuneId(ctx.state, 'rune_open_appetite');
    for (let n = 0; n < num(params.count, 1) * gold(self); n++) {
      const i = rightmostShopMinion(ctx.state);
      if (i < 0) return;
      consumeShopMinion(ctx.state, target, i, 1);
    }
  },

  /** Set 2 — Contract Butcher (Shout) / Soul Defiler (End of Turn): "give minions in the Shop +atk/+hp".
   *
   *  PERMANENT, via the same `tavernBuyBonus` channel Staff of Guel uses — NOT the per-offer channel (owner
   *  ruling 2026-07-25). The vocabulary is exact: "minions in the Shop" is a lasting buff on everything you buy
   *  from here on; only "THIS shop" or "the NEXT shop" is scoped to one roll (Apples has both of those).
   *  The first cut used `addOfferBuff`, so the buff evaporated on the next refresh — which made Display
   *  Curator's escalating version nearly worthless, since each turn's grant died before the next arrived.
   *
   *  Feeds the Fodder enchant for the same reason the Staff does: a bought Fodder gets tavern buffs through that
   *  run-wide channel rather than the buy-buff, so skipping it would silently exclude Fodder.
   *
   *  Curator's "improve this by +1/+1 each time this triggers" rides `summonBonus`, the standard per-instance
   *  accrual, so it survives combats and shows in the inspect breakdown. Golden starts doubled AND improves
   *  doubled, which is why the step is multiplied too. */
  buffShopPermanent: (ctx, self, params) => {
    const bonus = self.summonBonus ?? 0;
    let a: number; let h: number;
    if (params.alternate) {
      // Soul Defiler: pump ONE stat, alternating Attack (even triggers) / Health (odd) each round, the amount
      // growing with `summonBonus`. `attack` seeds the starting magnitude for both stats.
      const amt = (num(params.attack, 1) + bonus) * gold(self);
      const toAttack = bonus % 2 === 0;
      a = toAttack ? amt : 0;
      h = toAttack ? 0 : amt;
    } else {
      a = (num(params.attack, 1) + bonus) * gold(self);
      h = (num(params.health, 1) + bonus) * gold(self);
    }
    ctx.state.tavernBuyBonus.atk += a;
    ctx.state.tavernBuyBonus.hp += h;
    buffFodderRunWide(ctx.state, a, h, nameOf(self), false);
    const step = num(params.improve, 0);
    if (step > 0) self.summonBonus = bonus + step;
  },

  /** Set 2 — Market Tormentor (Shout, owner spec 2026-07-31): the right-most Shop SLOT gets +4/+4 for the rest
   *  of the run. Grows `rightmostSlotBuff` and lands the INCREMENT on the current row — earlier stacks already
   *  landed there, at Shout time or at the roll, so re-applying the total would double them. Every subsequent
   *  fresh roll gets the full total in `applyShopRefreshed`. The Tormentor itself is disposable: the slot
   *  remembers, not the minion. */
  buffRightmostSlotPermanent: (ctx, self, params) => {
    const st = ctx.state;
    const a = num(params.attack, 4) * gold(self);
    const h = num(params.health, 4) * gold(self);
    st.rightmostSlotBuff = {
      attack: (st.rightmostSlotBuff?.attack ?? 0) + a,
      health: (st.rightmostSlotBuff?.health ?? 0) + h,
    };
    const i = rightmostShopMinion(st);
    if (i >= 0) addOfferBuff(st.shop[i]!, nameOf(self), a, h);
    // Rune of the Display Case: your Market Tormentors ALSO enchant the LEFT-most Shop slot, permanently —
    // its own accumulator, re-landed on every fresh roll by applyShopRefreshed (mirrors the rightmost channel).
    if (st.runeDisplayCase) {
      procRuneId(st, 'rune_display_case');
      st.leftmostSlotBuff = {
        attack: (st.leftmostSlotBuff?.attack ?? 0) + a,
        health: (st.leftmostSlotBuff?.health ?? 0) + h,
      };
      const l = st.shop.findIndex((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
      if (l >= 0 && l !== i) addOfferBuff(st.shop[l]!, nameOf(self), a, h);
    }
  },

  /** Feastmaster Vhal (owner rework 2026-08-12) — every `every` Gold spent (the threshold is applied by
   *  `applyGoldSpent`, so this only does the buff), give the right-most Shop minion +atk/+hp for the rest of
   *  the run. Reuses Market Tormentor's `rightmostSlotBuff` accumulator: it grows the running total and lands
   *  the increment on the current right-most offer, and applyShopRefreshed re-lands the total on every fresh
   *  roll. Golden doubles the grant. */
  goldSpentBuffRightmostSlot: (ctx, self, params) => {
    const st = ctx.state;
    const a = num(params.attack, 8) * gold(self);
    const h = num(params.health, 8) * gold(self);
    st.rightmostSlotBuff = {
      attack: (st.rightmostSlotBuff?.attack ?? 0) + a,
      health: (st.rightmostSlotBuff?.health ?? 0) + h,
    };
    const i = rightmostShopMinion(st);
    if (i >= 0) addOfferBuff(st.shop[i]!, nameOf(self), a, h);
  },

  /** Set 2 — Bob Blart (End of Turn): gain the RIGHT-most Shop minion's stats `times` over WITHOUT eating
   *  it — the offer stays in the tavern. Deliberately not `consumeShopMinion`: no consume fires, so it doesn't
   *  feed Pactstone / Glutton / Abhorrent Horror, and the minion is still buyable. */
  endOfTurnGainRightmostShopStats: (ctx, self, params) => {
    const i = rightmostShopMinion(ctx.state);
    if (i < 0) return;
    const { attack, health } = offerBuyStats(ctx.state, ctx.state.shop[i]!);
    const times = num(params.times, 1) * gold(self);
    addBuff(self, nameOf(self), attack * times, health * times);
    // NB: Rune of Blart no longer rides this factory (owner rework 2026-08-19). Its text names Bob Blarts, and
    // this is Hellrider's copy-don't-eat path — the rune touching it was the clause outliving the 2026-08-14
    // card rework that moved Blart off here.
  },

  /** Set 2 — Hellrider (owner rework 2026-08-14): every `every` refreshes, gain the RIGHT-most Shop minion's
   *  stats WITHOUT eating it. Same per-instance `eotTick` meter `onShopRefreshConsume` uses ("four refreshes
   *  since this arrived", not since the run began) wrapped around Bob Blart's copy-don't-eat body, so the two
   *  cards stay one primitive apart. Golden doubles the stats gained, not the frequency. */
  onShopRefreshGainRightmostShopStats: (ctx, self, params) => {
    const every = Math.max(1, num(params.every, 4));
    const tick = (self.eotTick ?? 0) + 1;
    self.eotTick = tick;
    if (tick % every !== 0) return;
    const i = rightmostShopMinion(ctx.state);
    if (i < 0) return;
    const { attack, health } = offerBuyStats(ctx.state, ctx.state.shop[i]!);
    const times = num(params.times, 1) * gold(self);
    addBuff(self, nameOf(self), attack * times, health * times);
  },

  /** Set 2 — Void Curator (End of Turn): give your SPELLS and IMPS +atk/+hp. Two run-wide channels: the spell
   *  stat bonus (`spellBonus`, what every stat spell gains) and the Imp enchant (`buffImpsRunWide`, which
   *  reaches Imps "wherever they are" — board, hand and future summons). */
  endOfTurnBuffSpellsAndImps: (ctx, self, params) => {
    const a = num(params.attack, 1) * gold(self);
    const h = num(params.health, 1) * gold(self);
    const cur = ctx.state.spellBonus ?? { attack: 0, health: 0 };
    ctx.state.spellBonus = { attack: cur.attack + a, health: cur.health + h };
    // The Imp half takes its OWN magnitude when the card asks for one (Void Curator 2026-08-07: Imps +3/+1
    // while its Spells stay +1/+1). Defaulting to the spell numbers keeps every existing caller unchanged.
    const ia = num(params.impAttack, num(params.attack, 1)) * gold(self);
    const ih = num(params.impHealth, num(params.health, 1)) * gold(self);
    buffImpsRunWide(ctx.state, ia, ih, nameOf(self));
  },

  /** Set 2 — Avarice Incarnate: the FIRST Shop-minion Consume each turn pays a flat `gold` (golden doubles).
   *
   *  Was "Gold equal to its tier" (owner change 2026-07-25). That version worked, but paid 1 Gold off a Tier-1
   *  offer — negligible on a Tier-6 card, and swingy on the way up since the payout depended on whatever the
   *  shop happened to be showing. A flat 3 (6 golden) is both stronger and predictable.
   *
   *  Hooked on `onConsume`, so it counts any source — the tribe's eight consumers, a Fodder eat, Feastmaster's
   *  neighbours. `rubyRecvTick` is the per-turn counter (already reset each wave with the other per-turn state). */
  /** Set 2 — Baal (owner rework 2026-08-03): every `every` spells you cast, a friendly DEMON consumes a
   *  minion in the Shop (× golden — a gilded Baal eats two).
   *
   *  The EATER matters, which is why this doesn't just call `consumeShopMinion(state, self, …)`: the consume
   *  pays out on whoever ate it (its own on-consume effects, its stat gain, Broodlord's tally), so a random
   *  friendly Demon is picked and credited. Baal is a Demon itself, so it can be its own eater.
   *
   *  Per-instance `spellProgress` meter, the same shape every other "every N spells" card uses — so two Baals
   *  each keep their own count, and the tally survives a triple through the universal accrual rule. */
  spellCastDemonConsumesShop: (ctx, self, params) => {
    const state = ctx.state;
    const every = Math.max(1, num(params.every, 2));
    const me = state.board.find((c) => c.uid === self.uid);
    if (!me) return;
    me.spellProgress = (me.spellProgress ?? 0) + 1;
    while ((me.spellProgress ?? 0) >= every) {
      me.spellProgress = (me.spellProgress ?? 0) - every;
      const rng = makeRng(state.rngCursor);
      for (let n = 0; n < gold(self); n++) {
        // Eligibility MUST match `consumeShopMinion`'s own (minion, not spell, not Ruby) or we'd hand it an
        // index it refuses, silently wasting the trigger — the bug the Gemgorge factory above documents.
        const idxs = state.shop
          .map((o, i) => { const d = CARD_INDEX[o.cardId]; return !d || d.spell || d.ruby ? -1 : i; })
          .filter((i) => i >= 0);
        if (idxs.length === 0) break;
        // A friendly DEMON does the eating. No Demon on board → nothing happens (the text names the eater).
        const demons = state.board.filter((c) => isTribe(c, 'demon'));
        if (demons.length === 0) break;
        const eater = demons[rng.int(demons.length)]!;
        consumeShopMinion(state, eater, idxs[rng.int(idxs.length)]!);
      }
      state.rngCursor = rng.state();
    }
  },

  onConsumeGoldFlat: (ctx, self, params) => {
    if ((self.rubyRecvTick ?? 0) >= 1) return; // "the first time" each turn
    self.rubyRecvTick = (self.rubyRecvTick ?? 0) + 1;
    gainGold(ctx.state, num(params.gold, 3) * gold(self));
  },

  /** Set 2 — Avarice Incarnate (owner 2026-08-11): the FIRST time ANOTHER friendly Demon Consumes a Shop minion
   *  each turn (golden: the first 2 times), Avarice ALSO Consumes a Shop minion and grants Gold. `onConsume`
   *  fires board-wide with the eater in the payload, so `payload.minion !== self` makes this react to OTHER
   *  Demons only — and Avarice's own consume below re-fires `onConsume` with `minion === self`, which this skips
   *  (so it can't feed itself). The per-turn latch reuses `rubyRecvTick` (reset each wave), like onConsumeGoldFlat.
   *  The eaten offer the other Demon took is already spliced out, so "does too" means a FRESH Shop consume. */
  onOtherDemonConsumeEcho: (ctx, self, params, payload) => {
    const p = payload as { minion?: BoardCard; shop?: boolean } | undefined;
    if (!p?.shop || !p.minion || p.minion === self) return; // another minion's SHOP consume only
    if (!isTribe(p.minion, 'demon')) return; // ...a friendly Demon
    if ((self.rubyRecvTick ?? 0) >= gold(self)) return; // first 1 (golden: 2) each turn
    const state = ctx.state;
    // `onConsume` fires AFTER consumeShopMinion records the gain, so the last shopEaten entry (matched by
    // eaterUid) carries the exact stats the other Demon just gained. Avarice mirrors them — it does NOT eat a
    // minion of its own (owner clarification 2026-08-11).
    const last = state.shopEaten?.[state.shopEaten.length - 1];
    if (!last || last.eaterUid !== p.minion.uid || (last.gainA <= 0 && last.gainH <= 0)) return;
    self.rubyRecvTick = (self.rubyRecvTick ?? 0) + 1;
    addBuff(self, 'Avarice Incarnate', last.gainA, last.gainH); // the SAME stats the other Demon gained
    gainGold(state, num(params.gold, 3)); // flat 3 per fire — golden pays via the higher cap, not bigger Gold
  },

  /** Set 2 — Ashen Broodlord: when THIS body Consumes a minion, get a Shop spell (golden: 2).
   *
   *  `onConsume` fires board-wide with the EATER in the payload, so the `payload.minion !== self` guard is what
   *  makes this "when **this** Consumes" rather than Avarice's "the first time **you** consume". Broodlord has
   *  no consume of its own — as a Demon it eats through the shared sources (a Fodder sell's left-most Demon,
   *  Feastmaster Vhal's neighbours), which is the intended way this turns on.
   *
   *  The pool is `poolOf().spells`, which filters `!token` — and a Ruby is a token — so "Shop spell" is honoured
   *  by construction rather than by an explicit Ruby check. */
  onConsumeSelfGrantSpell: (ctx, self, params, payload) => {
    if ((payload as { minion?: BoardCard } | undefined)?.minion !== self) return;
    const spells = poolOf(ctx.state).spells.filter((c) => c.tier <= ctx.state.tier);
    conjureToHand(ctx.state, spells, num(params.count, 1) * gold(self));
  },

  /** Karwind (recruit half, owner rework 2026-07-25): a Shout trigger buffs your `tribe`, except Karwind's two
   *  board NEIGHBOURS, who get the bigger `adj` grant INSTEAD of the base one. A neighbour outside the tribe
   *  gets nothing — the owner chose "instead", not "any tribe".
   *
   *  Most of Karwind's procs happen HERE, not in combat: Shouts fire when you play minions in the shop. The
   *  combat twin of the same name covers a Shout re-fired mid-fight. */
  // ARENA-MIGRATED (Step 3): one body; golden = 2x MAGNITUDE now (owner ruling 2026-08-04 — the
  // twice-at-base pulse is retired; equal totals, one convention).
  onBattlecryBuffTribeAdjacentMore: (ctx, self, params) => {
    ARENA_EFFECTS.onBattlecryBuffTribeAdjacentMore(shopArena(ctx.state, self), params);
  },


  /** Set 2 — Scalechanter: every SHOP spell you cast gives your whole board +atk. The `spellCast` event is
   *  already shop-spell-only (Rubies don't route through `castSpell`), so the printed "Shop spell" wording
   *  needs no explicit Ruby check. Golden doubles the grant. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  spellCastBuffAll: (ctx, self, params) => {
    ARENA_EFFECTS.spellCastBuffAll(shopArena(ctx.state, self), params);
  },

  /** Set 2 — Commander Warpath (Shout): get a random Dragon that HAS a Shout.
   *
   *  "Has a Shout" is `onPlay`, which is exactly what the keyword means — so this picks up Dragons whose
   *  Shout does anything at all, and correctly excludes payoff cards like Karwind that only WATCH Shouts
   *  (`battlecryTriggered`) without having one (owner ruling 2026-07-25).
   *
   *  Drawn from `poolOf(state)` so a set-2 run can only pull set-2 Dragons, and tier-capped by the shop's
   *  current tier like every other "get a random X" — an un-capped roll could hand a Tier-6 body at Tier 3. */
  battlecryGrantShoutDragon: (ctx, self, params) => {
    const pool = poolOf(ctx.state).buyable.filter(
      (c) => !c.spell && !c.ruby && (c.tribe === 'dragon' || c.tribe2 === 'dragon')
        && c.tier <= ctx.state.tier && c.effects.some((e) => e.on === 'onPlay'),
    );
    if (pool.length === 0) return;
    conjureToHand(ctx.state, pool, num(params.count, 1) * gold(self));
  },

  /** Set 2 — Feastmaster Vhal (End of Turn): each ADJACENT minion consumes `count` random Shop minions. The
   *  neighbours eat, not Vhal — so the stats land on them. */
  endOfTurnNeighboursConsumeShop: (ctx, self, params) => {
    const i = ctx.state.board.indexOf(self);
    if (i < 0) return;
    const neighbours = [ctx.state.board[i - 1], ctx.state.board[i + 1]].filter((c): c is BoardCard => !!c);
    const each = num(params.count, 1) * gold(self);
    for (const n of neighbours) {
      for (let k = 0; k < each; k++) {
        const idx = rightmostShopMinion(ctx.state);
        if (idx < 0) return; // tavern empty — stop rather than half-feeding the rest
        consumeShopMinion(ctx.state, n, idx, 1);
      }
    }
  },

  /** Set 2 — Coppercoat Spellsword (Choose One Shout): permanently raise run-wide SPELL POWER by +atk/+hp.
   *  The two options are the same factory with different params (one all-Attack, one all-Health), which is why
   *  this takes both rather than being two factories. Golden doubles, matching the printed Gilded text. */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryGrantSpellPowerRun: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryGrantSpellPowerRun(shopArena(ctx.state, self), params);
  },

  /** Set 2 — Bellringer Voss (End of Turn): every `every` turns, conjure a PLAIN copy of the board minion to
   *  this one's LEFT into hand (golden: both neighbours). "Plain" = a fresh card from the index, so buffs,
   *  welds and golden are deliberately NOT copied — the same rule Re-Pete's Second Hand uses.
   *
   *  Cadence follows Frontdrake exactly: `eotTick` advances ONCE per turn (on proc 0), so a Chronos repeat
   *  fires an extra copy on the cadence turn without advancing the count, and a Djinn replay pays off on the
   *  turn it would naturally land. Getting this wrong is how a cadence card ends up firing every turn. */
  endOfTurnCopyNeighbour: (ctx, self, params, payload) => {
    const every = Math.max(1, num(params.every, 2));
    const replay = payload.replay === true;
    if (!replay && num(payload.proc, 0) === 0) self.eotTick = (self.eotTick ?? 0) + 1;
    const tick = self.eotTick ?? 0;
    const due = replay ? (tick + 1) % every === 0 : tick % every === 0;
    if (!due) return;
    const i = ctx.state.board.indexOf(self);
    if (i < 0) return;
    // Left neighbour always; the right one too when golden ("adjacent minions").
    const picks = [ctx.state.board[i - 1], ...(self.golden ? [ctx.state.board[i + 1]] : [])];
    const defs = picks
      .map((c) => (c ? CARD_INDEX[c.cardId] : undefined))
      .filter((d): d is CardDef => !!d && !d.spell && !d.ruby);
    if (defs.length === 0) return;
    for (const d of defs) conjureToHand(ctx.state, [d], 1);
  },

  /** Frontdrake — End of Turn: every `every` turns on the board, conjure `count` random minions of
   *  `tribe` into the hand (tier ≤ tavern tier, active tribes, copies left — "abides by tavern rules").
   *  Golden doubles the count. The per-card `eotTick` advances ONCE per turn (on proc 0), so Chronos
   *  repeats fire extra grants on the cadence turn without speeding the count up. */
  endOfTurnGrantTribe: (ctx, self, params, payload) => {
    const every = Math.max(1, num(params.every, 3));
    // A Djinn replay must NOT advance the count (the user's rule). It still pays off "on the turn it
    // would proc": the natural EOT this turn lands the cadence exactly when (tick + 1) % every === 0,
    // so a replay grants on that condition. The natural EOT counts the turn once (on proc 0) and grants
    // when the just-incremented count hits the cadence; Chronos repeats (proc > 0) ride along the same tick.
    const replay = payload.replay === true;
    if (!replay && num(payload.proc, 0) === 0) self.eotTick = (self.eotTick ?? 0) + 1; // count the turn once
    const tick = self.eotTick ?? 0;
    const due = replay ? (tick + 1) % every === 0 : tick % every === 0;
    if (!due) return;
    const tribe = str(params.tribe) as Tribe;
    const count = num(params.count, 1) * gold(self);
    const pool = poolOf(ctx.state).buyable.filter(
      (c) =>
        (c.tribe === tribe || c.tribe2 === tribe) &&
        (c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)) &&
        c.tier <= ctx.state.tier &&
        (ctx.state.pool[c.id] ?? 0) > 0,
    );
    conjureToHand(ctx.state, pool, count);
  },

  /** Combinator — End of Turn: magnetize a RANDOM Magnetic Mech (Cling Drone / Money Bot / Better Bot…)
   *  onto `targets` *random* other friendly Mechs (golden hits 2). Hosts are picked fresh each proc (seeded),
   *  so the welds spread unpredictably — not always the highest-Attack Mechs. The magnetic mech is rolled on
   *  its own seeded stream, so each turn can fork in a different bot: a Cling stacks the Cling improvement, a
   *  Money Bot welds income onto the host, a Better Bot welds (stacking) Rally. The full contribution rides
   *  in — stats, keywords (minus Magnetic), Money Bot's mana, Better Bot's `rallyMechAtk`. */
  endOfTurnMagnetizeMechs: (ctx, self, params, payload) => {
    const targets = num(params.targets, 1) * gold(self); // golden welds onto 2 Mechs instead of 1
    const slot = ctx.state.board.indexOf(self);
    const proc = num(payload.proc, 0);
    // The build's Magnetic Mechs (Cling, Money Bot, Better Bot…), sorted by id so the pick is deterministic.
    const magnetics = Object.values(CARD_INDEX)
      .filter((c) => (c.tribe === 'mech' || c.tribe2 === 'mech') && c.keywords.includes('M') && !c.token && !c.spell)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (magnetics.length === 0) return;
    // Roll the magnetic mech on a distinct stream (the trailing tag separates it from the host shuffle).
    const pick = magnetics[makeRng(mixSeed(ctx.state.seed, ctx.state.wave, TAG.MAGNET, slot, proc, 99)).int(magnetics.length)]!;
    const uids = magnetizeTargets(ctx.state.board, self.uid, targets, ctx.state.seed, ctx.state.wave, slot, proc);
    const pickBuff = cardBuff(ctx.state, pick.id); // a Cling pick carries its accrued +N/+N improvement
    const clings = pick.id === 'cling' ? 1 : 0; // a welded Cling stacks the Cling improvement (via weldMagnetic)
    for (const uid of uids) {
      const m = ctx.state.board.find((c) => c.uid === uid);
      if (!m) continue;
      weldMagnetic(ctx.state, m, {
        // Attribute the buff to the welded magnetic (e.g. "Better Bot ×2" in the inspect breakdown), not
        // to Combinator — so the player sees what's actually attached, matching a manual magnetize.
        source: pick.name,
        attack: pick.attack + pickBuff.attack,
        health: pick.health + pickBuff.health,
        keywords: [...pick.keywords],
        mana: pick.manaPerTurn ?? 0,
        rallyMechAtk: pick.rallyMechAtk,
        spellAura: pick.spellAura,
        fodderAura: pick.fodderAura,
      }, clings);
    }
  },

  /** Ritualist — End of Turn: every Fodder card type gains a *persistent* +atk/+hp for the rest
   *  of the run (so future copies from the tavern, summons, Discover etc. carry it), and the
   *  Fodder already on the board / in the hand gets it right now. Golden doubles; Ritualists stack. */
  buffFodderEverywhere: (ctx, self, params) => {
    const a = num(params.attack, 1) * gold(self);
    const h = num(params.health, 1) * gold(self);
    buffFodderRunWide(ctx.state, a, h, nameOf(self));
    buffImpsRunWide(ctx.state, a, h, nameOf(self)); // Ritualist now feeds Imps too
  },

  /** Ritualist (End of Turn) — give your Imps and Fodder +A/+H, ESCALATING by `step` each time it triggers (the
   *  accrued amount rides on `self.eotBonus`). Golden doubles the step. So it grants step, 2·step, 3·step, … */
  buffFodderImpsImproving: (ctx, self, params) => {
    const step = num(params.step, 3) * gold(self) * improveReps(ctx.state); // "this improves" — ×2 under Mastery
    self.eotBonus = (self.eotBonus ?? 0) + step;
    buffFodderRunWide(ctx.state, self.eotBonus, self.eotBonus, nameOf(self));
    buffImpsRunWide(ctx.state, self.eotBonus, self.eotBonus, nameOf(self));
  },

  /** Hoarder — Battlecry: bank extra Gold for next turn (consumed when next turn's Gold is set). Golden 2×.
   *  Also Safety Deposit Box's cast (spells are never golden, so the multiplier is inert there). */
  battlecryBonusGoldNextTurn: (ctx, self, params) => {
    ctx.state.bonusEmbersNextTurn = (ctx.state.bonusEmbersNextTurn ?? 0) + num(params.gold, 1) * gold(self);
  },

  /** Pre-emptive Assault (cast): your board attacks FIRST in the next combat, overriding the
   *  more-minions-goes-first rule (ties included). One fight only — cleared when the combat settles. */
  spellAttackFirst: (ctx) => {
    ctx.state.attackFirstNext = true;
  },

  /** Bloodlust (cast, targeted): mark the target minion so that at the start of the next combat it takes an
   *  immediate out-of-turn attack, immune to retaliation for that swing. One fight only (stripped at settle). */
  spellBloodlust: (_ctx, self) => {
    self.bloodlust = true;
    self.bloodlustRally = true; // also grant the target a one-fight Rally: give a friendly minion its Attack
  },

  /** Anomaly Reactor (cast, targeted): give the target minion an extra tribe (a Mech type) for the rest of the
   *  run — honored by every `isTribe` synergy and folded into its combat tribe2. No-op if it's already that tribe. */
  spellAddTribe: (_ctx, self, params) => {
    const t = str(params.tribe) as Tribe;
    if (!t || self.tribe === t || CARD_INDEX[self.cardId]?.tribe2 === t) return;
    if (!(self.addedTribes ?? []).includes(t)) self.addedTribes = [...(self.addedTribes ?? []), t];
  },

  /** Anomaly Reactor (cast, targeted): give the target minion ALL types for the rest of the run — it counts as
   *  every tribe (`isTribe` short-circuits on `allTribes`) and, in combat, is flagged `universalTribe` so tribe
   *  auras / Rally-of-a-type / SoC tribe buffs all see it. */
  spellAddAllTribes: (_ctx, self) => {
    self.allTribes = true;
  },

  /** Money Maker — End of Turn: every `every` turns on the board, add `count` random card(s) from the
   *  `cards` id-list to your hand (a Gold Pouch or Safety Deposit Box). Golden doubles the count. Mirrors
   *  Frontdrake's cadence (`eotTick` advances once per turn on proc 0; Chronos repeats ride the same tick).
   *  The cards are conjured freely — they don't touch the shop pool (spells never do). */
  endOfTurnGrantSpellChoice: (ctx, self, params, payload) => {
    const every = Math.max(1, num(params.every, 2));
    const replay = payload.replay === true;
    if (!replay && num(payload.proc, 0) === 0) self.eotTick = (self.eotTick ?? 0) + 1;
    const tick = self.eotTick ?? 0;
    const due = replay ? (tick + 1) % every === 0 : tick % every === 0;
    if (!due) return;
    const ids = Array.isArray(params.cards) ? (params.cards as string[]) : [];
    const pool = ids.map((id) => CARD_INDEX[id]).filter((c): c is CardDef => !!c);
    if (pool.length === 0) return;
    const count = num(params.count, 1) * gold(self);
    const rng = makeRng(ctx.state.rngCursor);
    for (let i = 0; i < count && ctx.state.hand.length < handCap(ctx.state); i++) {
      const def = pool[rng.int(pool.length)]!;
      ctx.state.hand.push({
        uid: `b${ctx.state.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        attack: def.attack,
        health: def.health,
        keywords: [...def.keywords],
        golden: false,
      });
    }
    ctx.state.rngCursor = rng.state();
  },

  /** Rallying Offensive (cast): your Rally effects trigger twice in the next combat. A one-shot run-state
   *  flag — casting again just re-arms it (does not stack). simulate() reads it and re-runs each Rally
   *  attacker's own on-attack effects one more time; cleared when the combat settles. */
  spellRallyDoubleNext: (ctx) => {
    ctx.state.rallyDoubleNext = true;
  },

  /** Nimbus — Battlecry: your NEXT Tavern spell casts twice (golden: three times). Arms a run-state charge
   *  (`nextSpellExtraCasts`) that `spellCasts` reads and the reducer spends on the next real (non-singleCast) spell
   *  cast; persists across turns until used. Doubles untargeted economy spells too, unlike Yazzus (aimed-only).
   *  Re-casting overwrites rather than deeply stacking (a rare corner). */
  battlecryDoubleNextSpell: (ctx, self) => {
    // += , not = : Drakko (and Warm Embers / Hoardwake) fire this Battlecry more than once, and each fire has
    // to bank its own extra cast. Setting a value made every repeat a no-op.
    ctx.state.nextSpellExtraCasts = (ctx.state.nextSpellExtraCasts ?? 0) + gold(self);
  },

  /** Field Mechanic — Battlecry: add `count` copies of a specific spell (Patch Job) to your hand. Golden
   *  doubles the count. Respects the hand cap. */
  battlecryGrantSpell: (ctx, self, params) => {
    const def = CARD_INDEX[str(params.spellId)];
    if (!def) return;
    const count = num(params.count, 1) * gold(self);
    // Rune of Living Growth: every Growth MUSHY creates improves the spell run-wide, one tick per Growth —
    // a golden Mushy hands over two and ticks twice.
    if (ctx.state.runeLivingGrowth && self.cardId === 'd2_scalefeather' && def.id === 'growth') {
      procRuneId(ctx.state, 'rune_living_growth');
      // +1 per copy held (recurring family, owner 2026-08-27).
      ctx.state.growthBonus = (ctx.state.growthBonus ?? 0) + count * runeStacksOf(ctx.state, 'rune_living_growth');
    }
    for (let i = 0; i < count && ctx.state.hand.length < handCap(ctx.state); i++) {
      ctx.state.hand.push({
        uid: `b${ctx.state.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        attack: def.attack,
        health: def.health,
        keywords: [...def.keywords],
        golden: false,
      });
    }
  },

  /** Battlecry: grant a specific minion (`cardId`) to hand — e.g. Attachment Mechanic gets a Money Bot. Routes
   *  through `grantMinionToHandOrBoard` so it honors run-wide buys/auras + overflows to the board when the hand is
   *  full. Golden doubles the count. */
  battlecryGrantMinion: (ctx, self, params) => {
    const def = CARD_INDEX[str(params.cardId)];
    if (!def) return;
    const count = num(params.count, 1) * gold(self);
    for (let i = 0; i < count; i++) grantMinionToHandOrBoard(ctx.state, def, false);
  },

  /** The Godfodder (Choose One, option A) — Battlecry: give your Fodder +atk/+hp run-wide (persistent, the
   *  same run-wide Fodder enchant as Ritualist / Bane). Golden doubles. */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryBuffFodder: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffFodder(shopArena(ctx.state, self), params);
  },

  /** Bane — whenever a Battlecry resolves on your board, give the Fodder card type a *persistent*
   *  +atk/+hp run-wide (same mechanism as Ritualist's End-of-Turn enchant). Golden doubles. Fires once
   *  per Battlecry *fire* (so a Drakko-doubled Battlecry procs it twice — `fireBattlecryTriggered`
   *  notifies per fire). Multiple Banes each react, so they stack additively. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  onBattlecryBuffFodder: (ctx, self, params) => {
    ARENA_EFFECTS.onBattlecryBuffFodder(shopArena(ctx.state, self), params);
  },


  /** Rope Wrangler (owner add 2026-08-04), recruit half — a shop-fired Echo (Ryme / Funeral on Loan): a
   *  random minion moves HAND → BOARD (it keeps its uid, buffs and gilding — the same card, summoned).
   *  Board full or no minion in hand → clean no-op; golden summons 2. */
  deathrattleSummonRandomHandMinion: (ctx, self) => {
    const state = ctx.state;
    for (let i = 0; i < gold(self); i++) {
      if (state.board.length >= CONFIG.boardMax) return;
      const minions = state.hand.filter((c) => { const d = CARD_INDEX[c.cardId]; return !!d && !d.spell && !d.ruby; });
      if (minions.length === 0) return;
      const rng = makeRng(state.rngCursor);
      const pick = minions[rng.int(minions.length)]!;
      state.rngCursor = rng.state();
      state.hand.splice(state.hand.indexOf(pick), 1);
      state.board.push(pick);
      fireSummonBuffs(state, pick);
    }
  },

  // ── CELESTIALS (set 3) ───────────────────────────────────────────────────────────────────────────────
  // Every Orbit half below is align-gated in the CARD DATA (`align: 'dawn' | 'dusk'`), never here — an
  // Eclipsed body then runs both halves for free, which is the whole point of the alignment rule.

  /** Orbiting Familiar: buff a RANDOM friendly minion — deliberately not the arriver (that is
   *  `orbitBuffArriver`), so the Familiar spreads value across the board instead of paying the newcomer. */
  orbitBuffRandomFriend: (ctx, self, params) => {
    const state = ctx.state;
    if (state.board.length === 0) return;
    const rng = makeRng(state.rngCursor);
    const pick = state.board[rng.int(state.board.length)]!;
    state.rngCursor = rng.state();
    addBuff(pick, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
  },

  /** Starpath Vendor (Dawn): THIS minion becomes worth more to sell, up to a cap. Per-instance (the Vendor
   *  is what you eventually cash in), so two Vendors each build their own. */
  orbitSellValue: (ctx, self, params) => {
    const me = ctx.state.board.find((c) => c.uid === self.uid);
    if (!me) return;
    const cap = num(params.cap, 3);
    me.sellBonus = Math.min(cap, (me.sellBonus ?? 0) + num(params.amount, 1) * gold(self));
  },

  /** Constellation Tender: buff your Celestials on ONE side of the sky. `params.side` names which — read
   *  live, so re-arranging the board re-aims it. Eclipsed bodies count as both sides and so are always hit. */
  orbitBuffAlignedCelestials: (ctx, self, params) => {
    const state = ctx.state;
    const side = str(params.side) === 'dusk' ? 'dusk' : 'dawn';
    for (const c of state.board) {
      if (!isCelestialCard(c)) continue;
      const al = alignmentOf(state.board, c.uid);
      if (al !== side && al !== 'eclipse') continue;
      addBuff(c, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
    }
  },

  /** Equinox Channeler: feed your WEAKEST body on one axis. Ties break left-most, so the pick is
   *  deterministic and the player can steer it by arranging. */
  orbitBuffLowest: (ctx, self, params) => {
    const state = ctx.state;
    if (state.board.length === 0) return;
    const byHealth = str(params.stat) === 'health';
    const target = state.board.reduce((lo, c) => ((byHealth ? c.health < lo.health : c.attack < lo.attack) ? c : lo), state.board[0]!);
    const amt = num(params.amount, 4) * gold(self);
    addBuff(target, nameOf(self), byHealth ? 0 : amt, byHealth ? amt : 0);
  },

  /** Star Cartographer: improve your Shop spells — the same run-wide spell-power channel every other
   *  "improve your spells" card uses, so the Buffs drawer already shows it. */
  orbitGrantSpellPower: (ctx, self, params) => {
    const b = ctx.state.spellBonus ?? { attack: 0, health: 0 };
    ctx.state.spellBonus = {
      attack: b.attack + num(params.attack) * gold(self),
      health: b.health + num(params.health) * gold(self),
    };
  },

  /** Worldseed Gardener: cast a named spell for free. Routes through the real `castSpell`, so the cast
   *  counts for every per-spell watcher and a Discover spell (Sprout) opens its prompt exactly as normal. */
  orbitCastSpell: (ctx, self, params) => {
    const def = CARD_INDEX[str(params.spellId)];
    if (!def) return;
    for (let i = 0; i < gold(self); i++) castSpell(ctx.state, def);
  },

  /** Spellwheel Savant (Dawn): a copy of the turn's FIRST Shop spell. `firstSpellThisTurnId` is the same
   *  memory Rune of Recollection reads, so "first this turn" means one thing across the game. */
  orbitCopyFirstSpell: (ctx, self, _params) => {
    const id = ctx.state.firstSpellThisTurnId;
    const def = id ? CARD_INDEX[id] : undefined;
    if (def) conjureToHand(ctx.state, [def], gold(self));
  },

  /** Astral Shopkeeper: after every N Orbits ANYWHERE on your board, fatten the right-most Shop offer.
   *  Counts on `orbitTick` like the "Orbit (N)" cadence, but driven by the board-wide watcher. */
  onOrbitBuffShopRightmost: (ctx, self, params) => {
    const state = ctx.state;
    const me = state.board.find((c) => c.uid === self.uid);
    if (!me) return;
    const every = Math.max(1, num(params.every, 3));
    me.orbitTick = (me.orbitTick ?? 0) + 1;
    if (me.orbitTick < every) return;
    me.orbitTick = 0;
    const offer = [...state.shop].reverse().find((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
    if (offer) addOfferBuff(offer, nameOf(self), num(params.attack, 3) * gold(self), num(params.health, 3) * gold(self));
  },

  /** Worldline Weaver: every Orbit anywhere pays your whole board. */
  onOrbitBuffAll: (ctx, self, params) => {
    for (const c of ctx.state.board) {
      addBuff(c, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
    }
  },

  /** Orrery: every OTHER Orbit fattens the Shop (`others: true` is enforced by the dispatcher). */
  onOrbitBuffShop: (ctx, self, params) => {
    for (const offer of ctx.state.shop) {
      const d = CARD_INDEX[offer.cardId];
      if (!d || d.spell || d.ruby) continue;
      addOfferBuff(offer, nameOf(self), num(params.attack, 1) * gold(self), num(params.health, 1) * gold(self));
    }
  },

  /** Horizon Collector: take the arriver's BONUS stats (everything it had above its printed base) — the
   *  minion keeps its own; this is a copy, not a theft. */
  orbitGainArriverBonus: (ctx, self, params, { minion, noArriver }) => {
    if (noArriver) return; // a TRIGGERED Orbit has nothing to collect from
    const base = CARD_INDEX[minion.cardId];
    if (!base) return;
    const bonusA = Math.max(0, minion.attack - base.attack);
    const bonusH = Math.max(0, minion.health - base.health);
    const me = ctx.state.board.find((c) => c.uid === self.uid);
    if (me && (bonusA > 0 || bonusH > 0)) addBuff(me, nameOf(self), bonusA * gold(self), bonusH * gold(self));
    // The aligned halves also pass one axis along to the far end of the board.
    const side = str(params.side);
    if (!side) return;
    const others = ctx.state.board.filter((c) => c.uid !== self.uid && isCelestialCard(c));
    const target = side === 'dusk' ? others[others.length - 1] : others[0];
    if (target) addBuff(target, nameOf(self), side === 'dusk' ? 0 : bonusA, side === 'dusk' ? bonusH : 0);
  },

  /** Astral Relay: fire the Orbits either side of THIS minion without anything having been played.
   *  The trigger is the card's own (a Shout on the Dawn half, End of Turn on the Dusk half); what it wakes
   *  is the neighbours' Orbit text, exactly as an arrival would — minus anything that consumes the arriver,
   *  which stands down (`noArriver`). */
  triggerAdjacentOrbits: (ctx, self) => {
    const idx = ctx.state.board.findIndex((c) => c.uid === self.uid);
    if (idx < 0) return;
    for (let i = 0; i < gold(self); i++) fireOrbitAt(ctx.state, idx, undefined);
  },

  /** Celestial Crucible: pay per STACK of Shop buffs riding on the minion that just landed. A "stack" is one
   *  buff application — `buffs[].count`, the same tally the inspect breakdown shows — so a minion carrying
   *  three separate +1/+1s is worth three, and an unbuffed body is worth nothing. That makes the Crucible a
   *  reward for playing something you have INVESTED in rather than for playing at all. */
  orbitBuffCelestialsPerBuffStack: (ctx, self, params, { minion, noArriver }) => {
    if (noArriver) return;
    const stacks = (minion.buffs ?? []).reduce((n, b) => n + b.count, 0);
    if (stacks <= 0) return;
    const a = num(params.attack, 1) * stacks * gold(self);
    const h = num(params.health, 1) * stacks * gold(self);
    for (const c of ctx.state.board) {
      if (isCelestialCard(c)) addBuff(c, nameOf(self), a, h);
    }
  },

  /** Constellation Broker + Orrery: DEVOUR the minion that just landed — it leaves the board and its bonus
   *  stats (everything above its printed base) are handed on. `mode: 'split'` shares them among your
   *  Celestials (Orrery, remainder to the left-most); otherwise the whole parcel goes to one other Celestial.
   *
   *  The destroyed body's ECHO fires (owner ruling 2026-08-06) — this is a death, not a sale, which makes the
   *  Broker a deliberate Deathrattle enabler rather than a way to quietly delete a card. It rides
   *  `fireRecruitDeathrattles`, the same path a shop death already takes. */
  orbitDevourArriver: (ctx, self, params, { minion, noArriver }) => {
    if (noArriver) return;
    const state = ctx.state;
    const base = CARD_INDEX[minion.cardId];
    const idx = state.board.findIndex((c) => c.uid === minion.uid);
    if (!base || idx < 0 || minion.uid === self.uid) return; // never devour yourself
    const bonusA = Math.max(0, minion.attack - base.attack);
    const bonusH = Math.max(0, minion.health - base.health);
    state.board.splice(idx, 1);
    fireOnFriendDeath(state, minion); // owner ruling 2026-08-26: a devoured friendly is a shop death
    const heirs = state.board.filter((c) => c.uid !== minion.uid && isCelestialCard(c));
    if (heirs.length > 0) {
      if (str(params.mode) === 'split') {
        // Even shares, remainder to the left-most — deterministic, so the player can arrange for it.
        const each = { a: Math.floor(bonusA / heirs.length), h: Math.floor(bonusH / heirs.length) };
        heirs.forEach((c, i) => addBuff(c, nameOf(self),
          each.a + (i === 0 ? bonusA % heirs.length : 0),
          each.h + (i === 0 ? bonusH % heirs.length : 0)));
      } else {
        // "another friendly Celestial" — the left-most other one, so it is arrangeable rather than random.
        const heir = heirs.find((c) => c.uid !== self.uid) ?? heirs[0]!;
        addBuff(heir, nameOf(self), bonusA, bonusH);
      }
    }
    fireRecruitDeathrattles(makeContext(state), minion);
  },

  /** Sporeling (recruit half) — every Battlecry you trigger procs this minion's OWN Deathrattle (its
   *  `deathrattleBuffAll` bakes +1/+1, golden +2/+2, into every board minion) and counts toward the run's
   *  Deathrattle tally (`deathrattlesTriggered` — feeds Grim). Fires once per Battlecry *fire*, so Drakko's
   *  repeats proc it per repeat (fireBattlecryTriggered notifies per fire), matching Bane/Karwind. */
  battlecryTriggeredOwnDeathrattle: (ctx, self) => {
    const def = CARD_INDEX[self.cardId];
    for (const eff of def?.effects ?? []) {
      if (eff.on !== 'onDeath' || eff.do !== 'deathrattleBuffAll') continue;
      const a = num(eff.params?.attack, 1) * gold(self);
      const h = num(eff.params?.health, 1) * gold(self);
      for (const m of ctx.state.board) addBuff(m, nameOf(self), a, h);
    }
    ctx.state.deathrattlesTriggered += 1;
  },

  /** Graverobber — Battlecry: destroy the targeted friendly minion, firing its Deathrattle out of combat
   *  (the recruit DR factories bake summons/buffs into the board; combat-only rattles are simply inert in the
   *  shop), then add `gold(self)` random Tavern spell(s) of the destroyed minion's tier to your hand (golden
   *  → 2). No spell exists at that tier → none is added. */
  battlecryDestroyForSpell: (ctx, self, params, payload) => {
    const target = payload.target;
    if (!target) return;
    const tier = CARD_INDEX[target.cardId]?.tier ?? 1;
    // TWO STEPS, like Funeral on Loan (owner 2026-08-28: "graverobber is still janky - can you add the same
    // polish"). The victim is MARKED as dying and stays on the board for this action; its Echo, its departure
    // and any Rise are the next one. That window is the whole point: it is where the death smoke and the Echo
    // skull have room to play, and where the Echo's LEAD can fire while the body is still there. Resolving it
    // inline gave the animations nothing to play over — the body was simply absent at commit.
    //
    // ORDERING NOTE: the spell below now arrives BEFORE the Echo rather than after it. Graverobber's spell is
    // its SHOUT's payoff and belongs to the play; the death is what moved. The one visible consequence is a
    // full hand — a spell taking the last slot can crowd out a card the Echo would have granted.
    ctx.state.pendingDeath = { uid: target.uid, kind: 'destroy' };
    const pool = poolOf(ctx.state).spells.filter((c) => c.tier === tier);
    if (pool.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    for (let i = 0; i < gold(self) && ctx.state.hand.length < handCap(ctx.state); i++) {
      const spell = pool[rng.int(pool.length)]!;
      ctx.state.hand.push({
        uid: `b${ctx.state.uidSeq++}`,
        cardId: spell.id, tribe: spell.tribe, attack: spell.attack, health: spell.health,
        keywords: [...spell.keywords], golden: false,
      });
    }
    ctx.state.rngCursor = rng.state();
  },

  /** Ossuary Rite (cast, targeted) — trigger the chosen friendly minion's Echo out of combat, WITHOUT destroying
   *  it. Its recruit Deathrattle factories bake summons/buffs into the board, doubled by Sylus + ticked into the
   *  run tally (see fireRecruitDeathrattles). `self` is the cast target. */
  spellTriggerEcho: (ctx, self) => {
    if (self) fireRecruitDeathrattles(ctx, self);
  },

  /** Gravetwin (Battlecry, targeted) — copy the targeted friendly minion's Deathrattle (its onDeath EffectDefs)
   *  onto Gravetwin. Stored per-instance; fired at the start of the next shop if Gravetwin survives combat
   *  (see fireGravetwinEchoes). No-ops if the target has no Echo. */
  battlecryCopyEcho: (_ctx, self, _params, payload) => {
    const target = payload.target;
    if (!target) return;
    const def = CARD_INDEX[target.cardId];
    const drs = (def?.effects ?? []).filter((e) => e.on === 'onDeath');
    if (drs.length === 0) return; // targeted a minion with no Echo → fizzles
    self.copiedEcho = drs.map((e) => ({ ...e, ...(e.params ? { params: { ...e.params } } : {}) }));
    self.copiedEchoName = def?.name;
  },

  /** Crypt Broker (Battlecry) — conjure a random Echo (Deathrattle) minion of ≤ current tier to hand and
   *  immediately trigger its Echo out of combat (fireRecruitDeathrattles: summons/buffs bake in, Sylus-doubled +
   *  tallied). Golden gets + triggers two. Fired by the play path's onPlay Battlecry loop. */
  getEchoAndTrigger: (ctx, self) => {
    const pool = poolOf(ctx.state).buyable.filter((c) => c.tier <= ctx.state.tier && c.effects.some((e) => e.on === 'onDeath'));
    if (pool.length === 0) return;
    for (let i = 0; i < gold(self); i++) {
      if (ctx.state.hand.length >= handCap(ctx.state)) break;
      conjureToHand(ctx.state, pool, 1); // seeded pick + hand-cap + run-buff bake
      const card = ctx.state.hand[ctx.state.hand.length - 1];
      if (card) fireRecruitDeathrattles(ctx, card); // trigger the Echo you just got
    }
  },

  // --- Deathrattles that can also resolve out of combat (e.g. when Consumed). The
  //     combat versions live in @game/core; these bake into the board's stats. Out
  //     of combat there's no RNG, so "random" picks become the highest-Attack carry. ---

  /** Deathrattle: summon `count` copies of a token. */
  // ARENA-MIGRATED (Step 3): one body, unified to the combat reading (owner confirm) — the shop gains the
  // fixed / goldenTokens params it was silently missing (golden Imp King: 2 tokens, not 4).
  deathrattleSummon: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleSummon(shopArena(ctx.state, self), params);
  },

  /** Deathrattle: give every board minion +atk/+hp (Sporeling — golden doubles). Out-of-combat resolution
   *  (a Consumed Sporeling still feeds the board). */
  // ── ARENA-MIGRATED (Step 2): one body in arena.ts serves both phases.
  deathrattleBuffAll: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleBuffAll(shopArena(ctx.state, self), params);
  },

  /** Deathrattle: buff all friends of `tribe` (+atk/+hp) — Grim / Mushy. A LIVING self is a member too:
   *  the hand-written shop half excluded `c !== self`, so a Grim proc'd without dying (Spots at End of Turn
   *  under Rune of Combat Prowess, a rally-proc'd Echo under Lasting Cadence) buffed every Beast but itself,
   *  disagreeing with combat (owner report 2026-08-20). A genuinely dying Grim is off the board before its
   *  rattle fires (every shop death path splices first), so it still never buffs a corpse. */
  // ── ARENA-MIGRATED (2026-08-20): one body in arena.ts serves both phases.
  deathrattleBuffTribe: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleBuffTribe(shopArena(ctx.state, self), params);
  },

  /** Deathrattle: buff the carry (+atk/+hp) — "random" friend out of combat. */
  deathrattleBuffRandom: (ctx, self, params) => {
    const friends = ctx.state.board.filter((c) => c !== self);
    if (friends.length === 0) return;
    const t = friends.reduce((a, b) => (b.attack > a.attack ? b : a));
    addBuff(t, nameOf(self), num(params.attack) * gold(self), num(params.health) * gold(self));
  },

  /** Deathrattle: give the carry a Divine Shield. */
  // ARENA-MIGRATED (Step 3): random in both phases + golden grants twice (standing ruling); one body.
  deathrattleGrantShield: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleGrantShield(shopArena(ctx.state, self), params);
  },

  /** Deathrattle (Mumi): give a friendly minion of `tribe` (default any) **Rise** out of combat — fired when
   *  Mumi is destroyed by Graverobber or Consumed. Mirrors the combat version: skips minions that already have
   *  Rise; the "random" pick becomes the highest-Attack carry out of combat. Granting the `R` keyword is enough —
   *  combat's `instantiate` re-arms `rebornAvailable` from it. Golden grants Rise to two friends. */
  // ARENA-MIGRATED (Step 3): random in both phases (standing owner ruling); one body.
  deathrattleGrantReborn: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleGrantReborn(shopArena(ctx.state, self), params);
  },

  // --- More Deathrattle recruit halves (owner ruling 2026-07-08: ANY Deathrattle should be able to resolve out
  //     of combat — fired by Graverobber's destroy, with Sylus doubling). Combat-only rattles (damage, destroy-
  //     killer, attack-on-summon overflow) stay inert in the shop; these bake their payoff into the run state. ---

  /** Grim (recruit half) — give your `tribe` (Beasts) +N/+N where N = the run's Deathrattle tally × `per`
   *  (golden doubles `per`), baked into the board. Out of combat there's no aura — just the current tally. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleBuffTribeByTally: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleBuffTribeByTally(shopArena(ctx.state, self), params);
  },

  /** Sergeant (recruit half) — give every board minion +Health (base × golden + its combat-accrued hpGrantBonus). */
  // ── ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleBuffAllHealth: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleBuffAllHealth(shopArena(ctx.state, self), params);
  },

  /** Trickster (recruit half) — give the carry (highest-Attack friend) this minion's Health; golden picks twice. */
  // ── ARENA-MIGRATED (Step 3): one body; RANDOM in both phases (owner ruling 2026-08-04 — the old
  //    highest-Attack carry pick predated the cursor RNG and is retired).
  deathrattleGiveHealth: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleGiveHealth(shopArena(ctx.state, self), params);
  },

  /** Burial Imp (recruit half) — add `count` copies of a specific card (a Gold Pouch) to hand; golden doubles. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGrantCardToHand: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleGrantCardToHand(shopArena(ctx.state, self), params);
  },

  /** Hoard Whelp — End of Turn: conjure a random Tier-`tier` card (a spell OR a minion) to hand; golden grants 2.
   *  Minions are drawn from your active tribes (+ neutral); spells from any Tier-`tier` spell. One combined pool,
   *  so the pick is uniform across both. */
  endOfTurnGrantRandomTierCard: (ctx, self, params) => {
    const tier = num(params.tier, 1);
    const spells = poolOf(ctx.state).spells.filter((c) => c.tier === tier);
    const minions = poolOf(ctx.state).buyable.filter(
      (c) => c.tier === tier && !c.spell && (c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)),
    );
    conjureToHand(ctx.state, [...spells, ...minions], num(params.count, 1) * gold(self));
  },

  /** (recruit half) — add `count` random Tavern spell(s) (≤ tavern tier) to hand; golden doubles. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGrantRandomSpell: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleGrantRandomSpell(shopArena(ctx.state, self), params);
  },

  /** Set 2 — Hoard Chronicler (Shout): add `count` random Tavern spells to hand (golden doubles). The Shout
   *  twin of `deathrattleGrantRandomSpell`; same pool + hand-cap handling via `conjureToHand`. */
  battlecryGrantRandomSpell: (ctx, self, params) => {
    // `tier` pins an EXACT tier (Scalefeather → a Tier-1 spell); without it, any spell up to the tavern tier.
    const exact = params.tier != null ? num(params.tier, 1) : null;
    const pool = poolOf(ctx.state).spells.filter((c) => (exact != null ? c.tier === exact : c.tier <= ctx.state.tier));
    conjureToHand(ctx.state, pool, num(params.count, 1) * gold(self));
  },

  /** Set 2 — Mushy (Echo), recruit half: Ryme (or another re-trigger) can fire this in the shop.
   *  Arms the same run charge the combat factory carries back — activating NEXT turn (`wave + 1`), never the
   *  current one, which is what "next turn" means even when it died mid-recruit. */
  deathrattleQueueNextSpellCopy: (ctx, self, params) => {
    const add = num(params.count, 1) * gold(self);
    const prev = ctx.state.nextTurnSpellCopies;
    ctx.state.nextTurnSpellCopies = {
      activateWave: prev ? Math.min(prev.activateWave, ctx.state.wave + 1) : ctx.state.wave + 1,
      count: (prev?.count ?? 0) + add,
    };
  },

  /** Set 2 — Living Grimoire (Shout): charge it. Magnitude rides golden — base doubles the turn's first
   *  spell, golden triples it (`1 + gold(self)`). */
  battlecryArmGrimoire: (ctx, self) => {
    ctx.state.grimoireMult = 1 + gold(self);
  },

  /** Set 2 — Living Grimoire's re-arm: every `every` Shouts you trigger, recharge it. Counting is skipped
   *  while it's already charged, so Shouts aren't banked toward a charge you haven't spent — "once USED,
   *  trigger 3 Shouts to reset this". */
  onBattlecryRearmGrimoire: (ctx, self, params) => {
    if (ctx.state.grimoireMult) return;
    const every = Math.max(1, num(params.every, 3));
    const tick = (self.shoutTick ?? 0) + 1;
    if (tick < every) { self.shoutTick = tick; return; }
    self.shoutTick = 0;
    ctx.state.grimoireMult = 1 + gold(self);
  },

  /** Set 2 — Voicekeeper: the FIRST `tribe` minion you sell each turn hands you a PLAIN copy of it.
   *  "First each turn" is read off `soldThisTurn`, which the reducer appends to before notifying — so the
   *  sale being reacted to is already in the list and this counts it: exactly 1 means it was the first.
   *  "Plain" = a fresh card from the index, so buffs/golden on the sold minion are deliberately NOT copied. */
  onMinionSoldCopyFirstOfTribe: (ctx, self, params, payload) => {
    const sold = (payload as { target?: BoardCard }).target;
    if (!sold) return;
    const tribe = str(params.tribe);
    const soldDef = CARD_INDEX[sold.cardId];
    // ALL-TYPES counts as every tribe (owner rule 2026-08-26). `isTribe` is the shared predicate — it covers
    // `universalTribe`, the Anomaly Reactor's `allTribes` mark AND spell-added tribes, none of which a raw
    // `tribe`/`tribe2` comparison sees. Selling an All-types minion used to leave Voicekeeper silent.
    if (!soldDef || (tribe && !isTribe(sold, tribe as Tribe))) return;
    // PER-INSTANCE, from its own placement (owner report 2026-08-07). It used to read the run-level
    // `soldThisTurn` tally, so a Voicekeeper played after you'd already sold a Dragon this turn was dead for
    // the turn — the sale it then witnessed counted as "second". This hook only fires for cards ON the board
    // (`fireOnMinionSold` walks `state.board`), so ticking its own counter is exactly "the first Dragon sold
    // since being on board" — the Spellkeeper Drake convention, where placement is the floor.
    const seen = (self.soldSeen = (self.soldSeen ?? 0) + 1);
    if (seen !== 1) return; // not the first matching sale THIS body has witnessed this turn
    conjureToHand(ctx.state, [soldDef], num(params.count, 1) * gold(self));
  },

  /** Set 2 — Moira (owner 2026-07-28): End of Turn, trigger the Shouts of both board NEIGHBOURS. Gilded fires
   *  the whole thing twice.
   *
   *  Routed through `replayBattlecry`, the shared re-trigger path (Echoing Roar, Resonance, Myra) — which is
   *  what makes a re-fired Shout count as a Shout for quests, applies Spell Drummer's repeats, and drives the
   *  Karwind flash. Rolling a bespoke loop over `onPlay` effects here would have silently skipped all three.
   *
   *  Neighbours are read BEFORE any firing: a Shout that reorders the board (a summon landing between them)
   *  must not change who this was pointing at, or the card becomes position-dependent mid-resolution. */
  endOfTurnTriggerAdjacentShouts: (ctx, self) => {
    const i = ctx.state.board.findIndex((c) => c.uid === self.uid);
    if (i < 0) return;
    const neighbours = [ctx.state.board[i - 1], ctx.state.board[i + 1]].filter((c): c is BoardCard => {
      const def = c && CARD_INDEX[c.cardId];
      return !!def && hasBattlecry(def);
    });
    for (let n = 0; n < gold(self); n++) for (const c of neighbours) replayBattlecry(ctx.state, c);
  },

  /**
   * High King Mykel (Rune) — every `every` spells you cast, trigger an ADJACENT Shout.
   *
   * Rides the `spellCast` event with a per-instance tally (`spellProgress`), which is how every other "every N
   * spells" card counts, so the meter carries round to round rather than resetting when a turn ends mid-progress.
   * Reuses the same `replayBattlecry` path as Moira's End-of-Turn version — one definition of "trigger a Shout".
   */
  spellCastTriggerAdjacentShouts: (ctx, self, params) => {
    const every = Math.max(1, num(params.every, 8));
    const me = ctx.state.board.find((c) => c.uid === self.uid);
    if (!me) return;
    me.spellProgress = (me.spellProgress ?? 0) + 1;
    while ((me.spellProgress ?? 0) >= every) {
      me.spellProgress = (me.spellProgress ?? 0) - every;
      const i = ctx.state.board.findIndex((c) => c.uid === self.uid);
      const neighbours = [ctx.state.board[i - 1], ctx.state.board[i + 1]].filter((c): c is BoardCard => {
        const def = c && CARD_INDEX[c.cardId];
        return !!def && hasBattlecry(def);
      });
      // Golden triggers BOTH neighbours (owner text: "Trigger both"). Base triggers exactly ONE — and when both
      // sides have a Shout it is RANDOM, not the left (owner ruling 2026-07-29), so the card can't be gamed by
      // arranging your line. Seeded from the run's stream, so it stays replay-faithful.
      const chosen = gold(self) > 1
        ? neighbours
        : neighbours.length > 1
          ? [neighbours[makeRng(mixSeed(ctx.state.seed, ctx.state.wave, me.spellProgress ?? 0)).int(neighbours.length)]!]
          : neighbours.slice(0, 1);
      for (const c of chosen) replayBattlecry(ctx.state, c);
    }
  },

  /** Set 2 — Runic Archivist (owner rework 2026-07-27): every `count` minions you SELL, get a Shop spell.
   *
   *  The tally lives on the card (`soldProgress`) rather than on the run, because it's per-instance and because
   *  the owner asked for it to CARRY ROUND TO ROUND — a per-turn counter would quietly reset the moment you
   *  ended a turn mid-progress, which is exactly the case where a "sell 5" meter matters. Payouts consume the
   *  threshold and keep the remainder, so selling 7 leaves you 2 into the next one. */
  minionSoldGrantSpell: (ctx, self, params) => {
    const every = Math.max(1, num(params.count, 5));
    const progress = (self.soldProgress ?? 0) + 1;
    self.soldProgress = progress % every;
    if (progress < every) return;
    const spells = poolOf(ctx.state).spells.filter((c) => c.tier <= ctx.state.tier);
    conjureToHand(ctx.state, spells, Math.floor(progress / every) * gold(self));
  },

  /** Set 2 — Mirrorwing Hatchling: the FIRST spell cast on this each turn casts again, on this.
   *  Guarded on `spellsOnThisTurn === 1` — the counter is bumped before this runs, so the re-cast below sees 2
   *  and stops. Without that guard the card recurses forever, since its own effect is another cast on itself. */
  onSpellCastOnThisRecast: (ctx, self, params, payload) => {
    if (self.spellsOnThisTurn !== 1) return;
    const spellDef = (payload as { spellDef?: CardDef }).spellDef;
    if (!spellDef) return;
    for (let i = 0; i < num(params.count, 1) * gold(self); i++) castSpell(ctx.state, spellDef, self);
  },

  /** Yirin's Reflector: the FIRST spell cast on this each turn ALSO casts on ONE random other friendly minion.
   *  Runefire's shape with a seeded random target instead of the neighbours. Same first-per-turn guard, and for
   *  the same reason — the spread re-enters `castSpell`, and only the pre-bumped counter stops the recursion.
   *  Never re-casts on ITSELF (that would double-dip the original cast), so it no-ops on a lone board. */
  onSpellCastOnThisSpreadRandom: (ctx, self, params, payload) => {
    if (((self.spellsOnThisTurn ?? 0) + (self.rubiesOnThisTurn ?? 0)) !== 1) return; // once/turn — spell OR Ruby, whichever lands first
    const spellDef = (payload as { spellDef?: CardDef }).spellDef;
    if (!spellDef) return;
    const others = ctx.state.board.filter((c) => c.uid !== self.uid);
    if (others.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    const pick = others[rng.int(others.length)]!;
    ctx.state.rngCursor = rng.state();
    for (let r = 0; r < num(params.count, 1) * gold(self); r++) castSpell(ctx.state, spellDef, pick);
  },

  /** Set 2 — Runefire: the FIRST spell cast on this each turn ALSO casts on its adjacent `tribe` neighbours.
   *  Same first-per-turn guard. Neighbours are board-adjacent (left/right), so it rewards seating it between
   *  two Dragons — and it never re-casts on ITSELF, which would double-dip the original cast. */
  onSpellCastOnThisSpreadAdjacent: (ctx, self, params, payload) => {
    // The SUM, because Runefire counts Rubies too — a Ruby then a spell on the same body pays out once.
    if ((self.spellsOnThisTurn ?? 0) + (self.rubiesOnThisTurn ?? 0) !== 1) return;
    const spellDef = (payload as { spellDef?: CardDef }).spellDef;
    if (!spellDef) return;
    const tribe = str(params.tribe);
    const i = ctx.state.board.indexOf(self);
    if (i < 0) return;
    const neighbours = [ctx.state.board[i - 1], ctx.state.board[i + 1]].filter(
      (c): c is BoardCard => !!c && (!tribe || isTribe(c, tribe as never)),
    );
    for (const n of neighbours) {
      for (let r = 0; r < num(params.count, 1) * gold(self); r++) castSpell(ctx.state, spellDef, n);
    }
  },

  /** Set 2 — Runefire, the RUBY half of "the first spell you cast on this each turn also casts on adjacent
   *  Dragons". Runefire is one of the two spell-reactive Dragons that deliberately works with Rubies too
   *  (owner 2026-07-24: only the cards that say "Shop spell" exclude them), and a Ruby doesn't route through
   *  `castSpell`, so it can't reach the `spellCastOnThis` factory — it needs its own hook.
   *
   *  "First each turn" is the SUM of Shop spells and Rubies landed on this body, so casting a spell and then a
   *  Ruby on Runefire pays out once, not twice. Spreading a Ruby means giving each adjacent `tribe` neighbour
   *  the same permanent stat buff the Ruby just gave — the Ruby's own resolution, repeated on the neighbour,
   *  including that neighbour's own `onRubyPlayed` watchers (Ruby Broker's Gold), because a spread Ruby is a
   *  Ruby landing on it. */
  /** Reflector: a RUBY played on this ALSO plays on a random other friendly (owner 2026-08-18 — the card says
   *  "Spells", and a Ruby is a spell-like cast that never routed through `castSpell`, so it needed its own hook).
   *  Shares the once-per-turn budget with the spell bounce via the combined spells+rubies count. */
  onRubyPlayedSpreadRandom: (ctx, self, params, payload) => {
    if (((self.spellsOnThisTurn ?? 0) + (self.rubiesOnThisTurn ?? 0)) !== 1) return;
    const a = num(payload.rubyAttack, 0);
    const h = num(payload.rubyHealth, 0);
    if (a <= 0 && h <= 0) return;
    const others = ctx.state.board.filter((c) => c.uid !== self.uid);
    if (others.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    const pick = others[rng.int(others.length)]!;
    ctx.state.rngCursor = rng.state();
    for (let r = 0; r < num(params.count, 1) * gold(self); r++) {
      addBuff(pick, 'Ruby', a, h);
      fireOnRubyPlayed(ctx.state, pick, a, h);
    }
  },

  onRubyPlayedSpreadAdjacent: (ctx, self, params, payload) => {
    const landed = (self.spellsOnThisTurn ?? 0) + (self.rubiesOnThisTurn ?? 0);
    if (landed !== 1) return; // only the first spell-or-Ruby on this body each turn
    const a = num(payload.rubyAttack, 0);
    const h = num(payload.rubyHealth, 0);
    if (a <= 0 && h <= 0) return;
    const tribe = str(params.tribe);
    const i = ctx.state.board.indexOf(self);
    if (i < 0) return;
    const neighbours = [ctx.state.board[i - 1], ctx.state.board[i + 1]].filter(
      (c): c is BoardCard => !!c && (!tribe || isTribe(c, tribe as never)),
    );
    for (const n of neighbours) {
      for (let r = 0; r < num(params.count, 1) * gold(self); r++) {
        addBuff(n, 'Ruby', a, h);
        fireOnRubyPlayed(ctx.state, n, a, h);
      }
    }
  },

  /** Set 2 — Orivax "Chorus": your Shouts permanently trigger `extra` more times. Stacks into the same
   *  `shoutExtraAlways` counter Hoardwake feeds, so it reads through `playedShoutRepeats` for free.
   *  NOT scaled by golden: Orivax's Gilded benefit is "gain BOTH modes" (`chooseBothWhenGolden`), a wording that
   *  replaces the doubled-numbers convention rather than stacking on it. */
  battlecryGrantShoutExtra: (ctx, self, params) => {
    ctx.state.shoutExtraAlways = (ctx.state.shoutExtraAlways ?? 0) + num(params.extra, 1);
  },

  /** Set 2 — Orivax "Spellweave": your first spell each turn casts `mult` times. Sets the run multiplier
   *  (max with any existing, so two Orivaxes don't multiply into absurdity — the higher wins). */
  battlecryGrantFirstSpellMult: (ctx, self, params) => {
    ctx.state.spellFirstMultEachTurn = Math.max(ctx.state.spellFirstMultEachTurn ?? 1, num(params.mult, 3));
    // Start the count HERE rather than at the turn boundary, so a mid-turn Orivax still multiplies the next
    // spell you cast. Reset to 0 each turn with the other per-turn tallies.
    ctx.state.spellMultMark = ctx.state.spellsThisTurn;
  },


  /** Set 2 — Runebloom Matriarch: EVERY spell you cast buffs `count` random friendly `tribe` minions on board
   *  by +atk/+hp. Golden doubles the STAT grant (the count stays), matching "trigger this twice"'s net effect
   *  of a bigger payout. Seeded pick via the shop RNG cursor so replays stay faithful. */
  /**
   * Fatecarver (Choose One, first branch) — when you cast a Shop spell, buff ONE minion of each TYPE.
   *
   * Mirrors Paragon's per-tribe spread, on the spell-cast trigger instead of Rally: walk the board's distinct
   * tribes in board order and buff the FIRST minion of each, so it is deterministic (no RNG) and the player can
   * steer who benefits by arranging the line. A universal-tribe minion counts as its own slot rather than
   * soaking every tribe's buff, matching `onRallyBuffOnePerTribe`.
   */
  // ARENA-MIGRATED (Step 3): one body in arena.ts. The Choose One gate stays with dispatch (a persistent
  // branch cannot live in chooseOne[].effects - it would fire once at pick time and never again).
  onSpellCastBuffOnePerTribe: (ctx, self, params) => {
    if (num(params.option, -1) >= 0 && self.chosenOption !== num(params.option, -1)) return;
    ARENA_EFFECTS.onSpellCastBuffOnePerTribe(shopArena(ctx.state, self), params);
  },


  /** Copycat (rune gift — owner spec 2026-08-02): an EXACT copy of the target friendly minion into hand.
   *  A spread of the live BoardCard — stats, keywords, gilding, enchants and every per-instance accrual
   *  (summonBonus, spellProgress, eotTick, …) — with only the uid re-minted. Deliberately NOT `conjuredStats`
   *  or a fresh-from-def conjure: "exactly" is the whole card. Hand-cap guarded like every conjure. */
  spellCopyTargetExact: (ctx, self, params, { minion }) => {
    // Spell factories receive the target as `minion` (see applyCastEffects) — `self` is the same object here.
    const target = minion;
    if (!target) return;
    if (ctx.state.hand.length >= handCap(ctx.state)) return; // full hand — the gift fizzles into nothing, like a full-hand conjure
    const clone = structuredClone(target);
    clone.uid = `b${ctx.state.uidSeq++}`;
    ctx.state.hand.push(clone);
  },

  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  onSpellCastBuffRandomTribe: (ctx, self, params) => {
    ARENA_EFFECTS.onSpellCastBuffRandomTribe(shopArena(ctx.state, self), params);
  },


  /** Set 2 — Scalechanter (Shout): buff your `tribe` by the CURRENT magnitude — base + everything this
   *  instance has improved by (`summonBonus`, the established per-instance improve accumulator).
   *  Golden doubles the whole magnitude at buff time rather than at storage time, so base and step both double
   *  exactly once ("starts at +2/+2 and improves by +2/+2") instead of compounding. */
  battlecryBuffTribeImproving: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const mag = (num(params.attack, 1) + (self.summonBonus ?? 0)) * gold(self);
    if (mag <= 0) return;
    for (const c of ctx.state.board) {
      if (tribe && !isTribe(c, tribe as never)) continue;
      addBuff(c, nameOf(self), mag, mag);
    }
  },

  /** Set 2 — Scalechanter's other half: every `every` Shouts you trigger, improve its magnitude by `step`.
   *  Rides `battlecryTriggered`, so it counts every FIRE (Drakko repeats included) rather than every played
   *  Shout minion — "Shouts you trigger" as printed. The step is stored at BASE magnitude (golden is applied
   *  when the buff lands) and scaled by `improveReps` for Rune of Mastery, matching every other "improve this". */
  onBattlecryImproveSelf: (ctx, self, params) => {
    const every = Math.max(1, num(params.every, 3));
    const tick = (self.shoutTick ?? 0) + 1;
    if (tick < every) { self.shoutTick = tick; return; }
    self.shoutTick = 0;
    self.summonBonus = (self.summonBonus ?? 0) + num(params.step, 1) * improveReps(ctx.state);
  },

  /** Set 2 — Ashscribe Whelp: the FIRST spell you cast each turn permanently grows this minion. Permanent
   *  (owner ruling 2026-07-24): a plain `addBuff`, so it accumulates every turn and shows in the inspect
   *  breakdown like any other growth.
   *
   *  Counts from when THIS Whelp was PLACED, not from turn start — the same correction the owner made for
   *  Living Grimoire and Spellkeeper Drake, applied here for consistency. Reading the turn-global
   *  `spellsThisTurn === 1` meant a Whelp bought and played after you'd already cast that turn was dead until
   *  next turn, which reads as the card being broken rather than as a cost of sequencing. The per-instance
   *  `boardSpellCount` is reset each turn and undefined on a fresh body, so placement is the natural floor. */
  onSpellCastFirstBuffSelf: (ctx, self, params) => {
    const n = (self.boardSpellCount ?? 0) + 1;
    self.boardSpellCount = n;
    if (n !== 1) return; // only the first since this Whelp hit the board
    addBuff(self, nameOf(self), num(params.attack, 2) * gold(self), num(params.health, 2) * gold(self));
  },

  /** Set 2 — Spellkeeper Drake: casting your SECOND spell each turn hands you a copy of the FIRST.
   *  Same `spellCast` hook, reading the count instead of the id — `firstSpellThisTurnId` is already recorded
   *  by `castSpell` before the tally, so the "first" is known by the time the second lands. */
  onSpellCastSecondCopyFirst: (ctx, self, params, payload) => {
    // Counts from when THIS Spellkeeper was placed, not from turn start (owner 2026-07-24): a Spellkeeper
    // found and played mid-turn should treat the next shop spell as "the first", the one after as "the second".
    // Per-instance `boardSpellCount`, reset each turn, undefined-on-fresh — so placement is the natural floor.
    const spellDef = (payload as { spellDef?: import('@game/core').CardDef }).spellDef;
    const n = (self.boardSpellCount ?? 0) + 1;
    self.boardSpellCount = n;
    if (n === 1) { self.boardFirstSpellId = spellDef?.id; return; } // remember the first spell since placed
    if (n !== 2) return; // only the SECOND grants
    const def = self.boardFirstSpellId ? CARD_INDEX[self.boardFirstSpellId] : undefined;
    if (!def) return;
    conjureToHand(ctx.state, [def], num(params.count, 1) * gold(self));
  },

  /** Set 2 — Runic Archivist (End of Turn): re-cast the first spell you cast this turn, free.
   *  Mirrors Rune of Recurrence's `recastFirstSpell` exactly, including its owner ruling that an AIMED spell
   *  re-targets a seeded-random friendly minion (an untargeted one just resolves) — two cards doing the same
   *  thing differently would be a rules inconsistency, not a feature. No spell cast this turn, or an aimed
   *  spell with an empty board → a clean no-op. */
  endOfTurnRecastFirstSpell: (ctx, self, params) => {
    // Reads the LAST spell cast this turn (owner change 2026-07-25, was the first). `lastSpellCastId` is
    // maintained for the Steward of Spells rune; the factory id is kept so saved runs and the schema entry
    // don't churn for a one-word behaviour change.
    const def = ctx.state.lastSpellCastId ? CARD_INDEX[ctx.state.lastSpellCastId] : undefined;
    if (!def?.spell) return;
    for (let i = 0; i < num(params.count, 1) * gold(self); i++) {
      if (!def.target) { castSpell(ctx.state, def); continue; }
      if (ctx.state.board.length === 0) return;
      const rng = makeRng(ctx.state.rngCursor);
      const target = ctx.state.board[rng.int(ctx.state.board.length)]!;
      ctx.state.rngCursor = rng.state();
      castSpell(ctx.state, def, target);
    }
  },

  /** Set 2 — Traveling Skald (Shout): get a random Tier-`tier` minion of `tribe` AND a random Tavern spell
   *  (golden: two of each). Two grants in one Shout, so it seeds both halves of the Dragon spell line at once.
   *  Each half is independent — a dry pool on one side still delivers the other. */
  battlecryGrantTribeAndSpell: (ctx, self, params) => {
    const n = num(params.count, 1) * gold(self);
    const tribe = str(params.tribe);
    const tier = num(params.tier, 1);
    const pool = poolOf(ctx.state);
    conjureToHand(ctx.state, pool.buyable.filter((c) => c.tier === tier && (c.tribe === tribe || c.tribe2 === tribe)), n);
    conjureToHand(ctx.state, pool.spells.filter((c) => c.tier <= ctx.state.tier), n);
  },

  /** Set 2 — the Dragon "spell recursion" line: add COPIES of a spell you already cast this turn to hand.
   *  `which` picks which one — 'first' (`firstSpellThisTurnId`, Spellvault Drake) or 'last'
   *  (`lastSpellCastId`, Recaller). Both ids are already tracked by `castSpell` for the Runes, so this reads
   *  them rather than adding new bookkeeping. No spell cast yet this turn → a clean no-op.
   *  The copy is a fresh card from the index, so it carries no state from the original cast. */
  battlecryCopyCastSpell: (ctx, self, params) => {
    // 'last' means last THIS TURN (the printed rule) — not the run-lifetime `lastSpellCastId` (audit 2026-07-31).
    const id = str(params.which) === 'first' ? ctx.state.firstSpellThisTurnId : ctx.state.lastSpellThisTurnId;
    const def = id ? CARD_INDEX[id] : undefined;
    if (!def || NO_COPY_SPELLS.has(def.id)) return; // Second Draft would loop the copier itself — see the set
    conjureToHand(ctx.state, [def], num(params.count, 1) * gold(self));
  },

  /** Set 2 — Spellvault Drake (End of Turn): the same copy, on the EoT beat instead of a Shout. */
  endOfTurnCopyCastSpell: (ctx, self, params) => {
    const id = str(params.which) === 'first' ? ctx.state.firstSpellThisTurnId : ctx.state.lastSpellThisTurnId;
    const def = id ? CARD_INDEX[id] : undefined;
    if (!def || NO_COPY_SPELLS.has(def.id)) return; // same exclusion as the Shout copier
    conjureToHand(ctx.state, [def], num(params.count, 1) * gold(self));
  },

  /** Set 2 — Embermouth Whelp (Shout): buff ONE other friendly minion of `tribe` (never itself). Picks the
   *  left-most eligible one so it's deterministic without consuming RNG — a Shout that spent the shop cursor
   *  would desync replays for every later draw this turn. */
  battlecryBuffOtherTribe: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const target = ctx.state.board.find((c) => c !== self && isTribe(c, tribe as never));
    if (!target) return;
    addBuff(target, nameOf(self), num(params.attack, 1) * gold(self), num(params.health, 1) * gold(self));
  },

  /** (recruit half) — add a random Magnetic minion to hand; golden adds two. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGrantMagnetic: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleGrantMagnetic(shopArena(ctx.state, self), params);
  },

  /** Grave Knit / Eternal Knight (recruit half) — permanently buff a card TYPE run-wide (board + hand + future). */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleBuffCardTypeRunWide: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleBuffCardTypeRunWide(shopArena(ctx.state, self), params);
  },

  /** (recruit half) — permanently buff your Imps run-wide (board + hand + future copies). */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleBuffImps: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleBuffImps(shopArena(ctx.state, self), params);
  },

  /** Burial Imp / Soulfeeder (recruit half) — queue `count` Fodder into your next tavern; golden doubles. */
  deathrattleAddFodder: (ctx, self, params) => {
    (ctx.state.pendingTavern ??= []).push(...Array(num(params.count, 1) * gold(self)).fill('fred'));
    stampFodderSend(ctx.state, self?.uid); // Fodder Infusion FX (skips gracefully if the dying card left the DOM)
  },

  // --- Spells ---

  /** Spirit Fire / Bulwark / Shatter — cast: buff the chosen target +atk/+hp, and either grant a
   *  keyword (`keyword`) or *toggle* one (`toggleKeyword`: add if absent, remove if present). `self`
   *  is the target. */
  /** Beefy (owner add 2026-08-15) — buff the CHOSEN minion and both its board neighbours by the same amount.
   *  Routes each grant through the same spell-power fold `spellBuffTarget` uses, so the printed value and the
   *  granted value agree on every recipient. No-op without a target (an unaimed cast fizzles, like every
   *  targeted spell). */
  /** Parting Cry — mark the chosen friendly SHOUT minion: when it dies next combat, its Shout fires. */
  spellMarkPartingCry: (ctx, self) => {
    if (!self) return;
    self.partingCry = true;
  },

  /** Closed Casket — mark the chosen minion to be DESTROYED at Start of Combat (its Echo then fires naturally). */
  spellMarkClosedCasket: (ctx, self) => {
    if (!self) return;
    self.closedCasket = true;
  },

  /** Solid Ground — the first `count` minions you summon next combat land with +`attack`/+`health`. */
  spellSolidGround: (ctx, _self, params) => {
    ctx.state.solidGroundLeft = num(params.count, 3);
    ctx.state.solidGroundStat = num(params.attack, 4);
  },

  /** Containment Rune — the first ENEMY minion summoned next combat is set to 1/1. */
  spellContainFirstEnemySummon: (ctx) => {
    ctx.state.containFirstEnemySummon = true;
  },

  /** Stolen Initiative — after the enemy's first attack next combat, your right-most minion attacks. */
  spellStolenInitiative: (ctx) => {
    ctx.state.stolenInitiative = true;
  },

  spellBuffTargetAndNeighbours: (ctx, self, params) => {
    // For a CAST effect the chosen minion arrives as `self` (see `applyCastEffects`) — a spell has no body of
    // its own. An untargeted cast never reaches here with a board minion, so a missing row is a clean no-op.
    const target = self;
    if (!target) return;
    const flat = !!params.flat;
    const a = num(params.attack) + (flat ? 0 : spellAttackBonus(ctx.state));
    const h = num(params.health) + (flat ? 0 : spellHealthBonus(ctx.state));
    if (a <= 0 && h <= 0) return;
    const i = ctx.state.board.findIndex((c) => c.uid === target.uid);
    const hit = i >= 0
      ? [ctx.state.board[i - 1], ctx.state.board[i], ctx.state.board[i + 1]].filter((c): c is BoardCard => !!c)
      : [target];
    for (const c of hit) addBuff(c, nameOf(self), a, h);
  },

  /** Gamble (owner add 2026-08-15) — roll a die (1-6) and conjure a random MINION or SPELL of that tier.
   *  The roll rides the run's shared cursor, so it is seeded/replayable like every other random pull. The tier
   *  is the die face itself — a 6 can hand you a Tier-6 card off a 2-Gold spell, which is the gamble. */
  spellGambleTierPull: (ctx, _self, _params) => {
    const rng = makeRng(ctx.state.rngCursor);
    const tier = 1 + rng.int(6);
    ctx.state.rngCursor = rng.state();
    const pool = poolOf(ctx.state);
    const picks = [...pool.buyable, ...pool.spells].filter((c) => !c.token && c.tier === tier);
    if (picks.length === 0) return;
    const before = new Set(ctx.state.hand.map((c) => c.uid));
    conjureToHand(ctx.state, picks, 1);
    // Tell presentation what to roll — and WHICH card to hold back until the die lands (the UI withholds it
    // from the hand for the tumble's duration, then reveals). Gameplay already resolved; this is display data.
    const won = ctx.state.hand.find((c) => !before.has(c.uid));
    ctx.state.gambleRoll = { tier, seq: (ctx.state.gambleRoll?.seq ?? 0) + 1 };
    if (won) ctx.state.gambleWonUid = won.uid;
  },

  spellBuffTarget: (ctx, self, params) => {
    let attack = num(params.attack);
    let health = num(params.health);
    // Stat-granting spells pick up the run's spell power (Spellbinder hero + cards: Cinderwing on
    // Health, Skullblade on Attack). The UI shows the same effective value via spellDisplayText — one
    // source of truth (spellAttackBonus / spellHealthBonus). `flat: true` opts OUT (Crest of the Climb's
    // Choose-One single-stat grants stay exactly as printed, since Choose-One option text isn't greened).
    if (!params.flat && (attack > 0 || health > 0)) {
      attack += spellAttackBonus(ctx.state);
      health += spellHealthBonus(ctx.state);
    }
    addBuff(self, str(params._source) || nameOf(self), attack, health);
    const kw = str(params.keyword);
    if (kw && !self.keywords.includes(kw as Keyword)) self.keywords.push(kw as Keyword);
    // Shatter: toggle a keyword — strip it if present, grant it otherwise.
    const toggle = str(params.toggleKeyword) as Keyword;
    if (toggle) {
      if (self.keywords.includes(toggle)) self.keywords = self.keywords.filter((k) => k !== toggle);
      else self.keywords.push(toggle);
    }
  },

  /** Patch Job — cast: give the target a BASELINE +atk/+hp, PLUS another +atk/+hp for every `gold` Gold spent
   *  this recruit turn (owner ruling 2026-07-08 — so +3/+3 at 0 Gold, +6/+6 at 7 Gold, …). Total = base ×
   *  (1 + floor(goldSpentThisTurn / gold)). Spell power scales each unit like a stat spell. */
  spellBuffTargetPerGold: (ctx, self, params) => {
    const per = Math.max(1, num(params.gold, 7));
    const ticks = Math.floor((ctx.state.goldSpentThisTurn ?? 0) / per);
    // Base and per-tick step are SEPARATE grants (`baseAttack`/`baseHealth` default to the step, which is the
    // pre-2026-07-21 symmetric behavior). Spell power folds into each chunk, so it still pays out per tick.
    const stepA = num(params.attack, 3) + spellAttackBonus(ctx.state);
    const stepH = num(params.health, 3) + spellHealthBonus(ctx.state);
    const a = num(params.baseAttack, num(params.attack, 3)) + spellAttackBonus(ctx.state) + stepA * ticks;
    const h = num(params.baseHealth, num(params.health, 3)) + spellHealthBonus(ctx.state) + stepH * ticks;
    addBuff(self, str(params._source) || 'Patch Job', a, h);
  },

  /** Front to Back — cast: linear escalation. Each cast grants +(step + accumulated escalation + spell power),
   *  then the escalation climbs by a FLAT `step` (+2/+2) — the per-cast improvement is always +2/+2. Spell
   *  power is a flat add to every grant (not part of the improvement). `self` is the chosen target. */
  spellBuffTargetEscalating: (ctx, self, params) => {
    // Attack and Health escalate INDEPENDENTLY (owner 2026-07-09): each stat's grant = its step + that stat's
    // accumulated escalation + that stat's spell power, and the escalation step itself compounds that stat's spell
    // power. So with +0/+2 spell power the improvement is +2/+4 per cast, not a symmetric +2/+2.
    const a = num(params.attack, 2) + ctx.state.frontToBackBonus + spellAttackBonus(ctx.state);
    const h = num(params.health, 2) + ctx.state.frontToBackBonusH + spellHealthBonus(ctx.state);
    addBuff(self, str(params._source) || 'Front to Back', a, h);
    // Improve on EVERY cast (owner 2026-07-23): each cast's step raises the next cast's grant (the step lands
    // twice under Rune of Mastery). So cast 1 = +2/+2, cast 2 = +4/+4, cast 3 = +6/+6, …
    const reps = improveReps(ctx.state);
    ctx.state.frontToBackBonus += (num(params.attack, 2) + spellAttackBonus(ctx.state)) * reps;
    ctx.state.frontToBackBonusH += (num(params.health, 2) + spellHealthBonus(ctx.state)) * reps;
  },

  /** Eyes of Aresmar — cast: make the targeted minion Golden (like Oner's Gild), but only if its
   *  card tier is ≤ the spell's `targetMaxTier`. Doubles the BASE stats via a tracked 'Gild' buff (accrued
   *  buffs are NOT doubled — see `gildMinion`) + flips golden. Cap read from the spell def via `_maxTier`. */
  spellGildTarget: (ctx, self, params) => {
    // NO CAP unless the spell declares one (owner bug report 2026-07-29). This defaulted to
    // `maxTierFor(state.rift)` — 6 in a normal run — so gilding a TIER 7 minion silently did nothing:
    // Goldcrafter and Eyes of Aresmar both refused them, which is exactly the "T7s can't be goldened" report.
    // The cap exists for Oner's Gild (`targetMaxTier: 4`), a deliberate restriction on a cheap spell; a spell
    // with no declared cap was always meant to have none, as its own comment says.
    const declared = params._maxTier;
    const targetTier = CARD_INDEX[self.cardId]?.tier ?? 1;
    if (self.golden) return;
    if (declared !== undefined && targetTier > num(declared, 7)) return;
    gildMinion(self);
  },

  /** Tribes Choice — cast: conjure a random buyable minion sharing the *target's* tribe, tier ≤ the
   *  tavern tier, into the hand (drawn from the run's finite pool; honours the hand cap). Neutral is no
   *  longer a "type": targeting a neutral minion yields nothing (the spell fizzles), so type-rolls never
   *  hand out neutral glue (mirrors `dominantBoardTribe`, which already ignores neutral). */
  spellGainOfTargetTribe: (ctx, self) => {
    const tribe = self.tribe;
    if (tribe === 'neutral') return; // neutral isn't a type — no type-roll result
    const pool = poolOf(ctx.state).buyable.filter(
      (c) =>
        c.tier <= ctx.state.tier &&
        (c.tribe === tribe || c.tribe2 === tribe) &&
        (ctx.state.pool[c.id] ?? 0) > 0, // only offer cards with copies left
    );
    conjureToHand(ctx.state, pool, 1);
  },

  /** Summon Stone — cast: conjure a random buyable minion of `tier` (active tribes + neutral, copies
   *  left) into the hand. */
  spellGainRandomMinion: (ctx, _self, params) => {
    const tier = num(params.tier, 1);
    const pool = poolOf(ctx.state).buyable.filter(
      (c) =>
        c.tier === tier &&
        (c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)) &&
        (ctx.state.pool[c.id] ?? 0) > 0,
    );
    conjureToHand(ctx.state, pool, 1);
  },

  /** Undead Army — cast: pick ONE random buyable minion of `tribe` (active tribes, copies left) and
   *  conjure `count` copies of it into the hand. Fizzles gracefully on no option / no hand room. */
  conjureTribeArmy: (ctx, _self, params) => {
    const tribe = str(params.tribe);
    const count = num(params.count, 2);
    const pool = poolOf(ctx.state).buyable.filter(
      (c) =>
        (c.tribe === tribe || c.tribe2 === tribe) &&
        (c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)) &&
        c.tier <= ctx.state.tier && // bound by your tavern tier
        (ctx.state.pool[c.id] ?? 0) > 0,
    );
    if (pool.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    const pick = pool[rng.int(pool.length)]!; // one card, several copies
    ctx.state.rngCursor = rng.state();
    conjureToHand(ctx.state, Array(count).fill(pick), count); // conjureToHand honours the hand cap + pool
  },

  // --- Run-level spell effects (act on the run, no minion target). These run through
  //     `applyCastEffects` with `self` undefined — they ignore it. ---

  /** Refreshing Texts — cast: bank `count` free rerolls. */
  grantFreeRolls: (ctx, _self, params) => {
    ctx.state.freeRolls += num(params.count, 1);
  },

  /** Quick Sale — cast: the NEXT minion sold this turn is worth `gold` more (added on the sell, then spent).
   *  Stacks if cast twice; expires unused at turn end. Untargeted. */
  spellNextSellBonus: (ctx, _self, params) => {
    ctx.state.nextSellBonus = (ctx.state.nextSellBonus ?? 0) + num(params.gold, 2);
  },

  /** Marked Target — cast: bank a one-fight debuff so the enemy's RIGHT-MOST minion enters the next combat
   *  with Taunt (funnels your attacks into it). Applied to the enemy board in `faceOmen`, then cleared. */
  spellMarkEnemyTaunt: (ctx) => {
    ctx.state.markEnemyRightmostTaunt = true;
  },

  /** Open the Gates (Set 2) — cast: bank `count` Imps to enter the NEXT combat on your board (as many as fit
   *  the 7-slot cap). Applied in `faceOmen` before the fight, then spent — they pick up the imp enchant like
   *  any Imp. Reuses the Set-1 `impscrap` token (owner ruling 2026-07-23). */
  spellSummonImpsNextCombat: (ctx, _self, params) => {
    ctx.state.pendingSCImps = (ctx.state.pendingSCImps ?? 0) + num(params.count, 3);
  },

  /** Decoy Sigil — cast: bank one next-combat Training Dummy (1/1, Taunt + Ward, far right), summoned by the
   *  Rune-of-the-Brood slot-filler the first time the board has room. Stacks per cast. */
  spellDecoyNextCombat: (ctx, _self, params) => {
    ctx.state.pendingDecoys = (ctx.state.pendingDecoys ?? 0) + num(params.count, 1);
  },

  /** Weaken — cast: bank a next-combat Start-of-Combat "set a random enemy's Health to 1". Stacks per cast. */
  spellWeakenNextCombat: (ctx, _self, params) => {
    ctx.state.pendingWeaken = (ctx.state.pendingWeaken ?? 0) + num(params.count, 1);
  },

  /** Ruby Excavation — cast: play `rubies` Rubies on EVERY friendly minion (each worth 1/1 + the run's
   *  rubyBonus, like any recruit-phase Ruby). Fires each target's on-Ruby watchers per Ruby. */
  spellPlayRubiesAll: (ctx, _self, params) => {
    const per = num(params.rubies, 2);
    const b = rubyStatBonus(ctx.state);
    for (const target of [...ctx.state.board]) {
      for (let r = 0; r < per; r++) {
        addBuff(target, 'Ruby', 1 + b.attack, 1 + b.health);
        fireOnRubyPlayed(ctx.state, target, 1 + b.attack, 1 + b.health);
      }
    }
  },

  /** Cupcakes — cast on a friendly DEMON: it Consumes `times` RANDOM Shop minions, one roll per bite (so the
   *  spread is real, not one minion eaten four times). The eater is the TARGET (`self` on a targeted cast), so
   *  every consume payoff fires for a genuine Demon eat. */
  spellTargetConsumesShop: (ctx, self, params) => {
    for (let n = 0; n < num(params.times, 4); n++) {
      const edible = ctx.state.shop
        .map((_, i) => i)
        .filter((i) => { const d = CARD_INDEX[ctx.state.shop[i]!.cardId]; return !!d && !d.spell && !d.ruby; });
      if (edible.length === 0) return;
      const rng = makeRng(ctx.state.rngCursor);
      const pick = edible[rng.int(edible.length)]!;
      ctx.state.rngCursor = rng.state();
      consumeShopMinion(ctx.state, self, pick, 1);
    }
  },

  /** Deep Delve Writ / Ironclad Requisition — cast: STEAL Shop offers into hand for free. `tribe` narrows the
   *  pick to that tribe's minions (the Writ's Dwarf); `perTribe` steals one RANDOM card (minions and spells
   *  alike) per friendly minion of that tribe (the Requisition). Stolen minions arrive shaped like a buy —
   *  `offerBuyStats` folds the offer's accumulated buffs in — and the hand cap forfeits any overflow. */
  spellStealShop: (ctx, _self, params) => {
    const st = ctx.state;
    const tribe = str(params.tribe);
    const perTribe = str(params.perTribe);
    const count = perTribe ? st.board.filter((c) => isTribe(c, perTribe as never)).length : num(params.count, 1);
    const rng = makeRng(st.rngCursor);
    for (let n = 0; n < count; n++) {
      if (st.hand.length >= handCap(st)) break;
      const pool = st.shop
        .map((o, idx) => ({ o, idx, def: CARD_INDEX[o.cardId] }))
        .filter(({ def }) => {
          if (!def) return false;
          if (!tribe) return true; // the Requisition takes anything the row holds, spells included
          return !def.spell && !def.ruby && (def.tribe === tribe || def.tribe2 === tribe || !!def.universalTribe);
        });
      if (pool.length === 0) break;
      const pick = pool[rng.int(pool.length)]!;
      st.shop.splice(pick.idx, 1);
      const def = pick.def!;
      if (def.spell || def.ruby) {
        st.hand.push({ uid: `b${st.uidSeq++}`, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false });
      } else {
        const stats = offerBuyStats(st, pick.o);
        st.hand.push({ uid: `b${st.uidSeq++}`, cardId: def.id, tribe: def.tribe, attack: stats.attack, health: stats.health, keywords: [...def.keywords], golden: !!pick.o.golden });
      }
    }
    st.rngCursor = rng.state();
  },

  /** Quick Study (the spell) — cast: permanently raise the run's SPELL power by +atk/+hp. */
  spellGainSpellPower: (ctx, _self, params) => {
    const st = ctx.state;
    st.spellBonus = { attack: (st.spellBonus?.attack ?? 0) + num(params.attack, 1), health: (st.spellBonus?.health ?? 0) + num(params.health, 1) };
  },

  /** Farseer's Report — cast: reveal `count` random minions from your NEXT opponent's warband, onto the
   *  OpponentFrame. Their actual stats are captured. No next opponent (procedural threat) → fizzles. Cleared at
   *  turn start (the opponent changes).
   *
   *  WHICH board is "next" depends on the MODE, and getting that wrong is what made the spell lie: a LOBBY run
   *  fights the seat the pairing gave it (`lobbyOpponentBoard`, exactly what `faceOmen` serves), NOT the
   *  course pool pick in `servedBoards[wave]`. Reading only the latter scouted a real board the run would
   *  never face (owner report 2026-08-03: "showed me the wrong minions"). Lobby first, course pin as the
   *  fallback — the same precedence `faceOmen` uses, so the scout and the fight can't disagree. */
  spellScoutNextOpponent: (ctx, _self, params) => {
    const state = ctx.state;
    const lobbyFoe = state.lobby ? lobbyOpponentBoard(state.lobby) : null;
    const minions = lobbyFoe ? lobbyFoe.minions : state.servedBoards?.[state.wave]?.minions;
    if (!minions || minions.length === 0) return;
    const rng = makeRng(state.rngCursor);
    const avail = [...minions];
    const picks: NonNullable<RunState['scoutedNextOpponent']> = [];
    for (let i = 0; i < num(params.count, 3) && avail.length > 0; i++) {
      const m = avail.splice(rng.int(avail.length), 1)[0]!;
      picks.push({ cardId: m.cardId, attack: m.attack, health: m.health, ...(m.golden ? { golden: true } : {}), ...(m.buffs?.length ? { buffs: m.buffs } : {}) });
    }
    state.rngCursor = rng.state();
    state.scoutedNextOpponent = picks;
  },

  /** Rival's Reflection — cast: Discover a PLAIN copy of a minion from your LAST opponent's warband (the board
   *  you just fought = `servedBoards[wave - 1]`). A `kind: 'pool'` Discover over that board's real minion ids
   *  (deduped, tokens/spells excluded); the pick enters hand at base stats (+ run auras), like any conjure.
   *  No prior opponent (turn 1) or an all-token board → fizzles (spell still consumed). */
  spellDiscoverFromLastOpponent: (ctx) => {
    const state = ctx.state;
    const last = state.servedBoards?.[state.wave - 1];
    if (!last) return;
    const ids = [...new Set(last.minions.map((m) => m.cardId))].filter((id) => CARD_INDEX[id] && !CARD_INDEX[id]!.spell && !CARD_INDEX[id]!.token);
    if (ids.length === 0) return;
    queueDiscover(state, { kind: 'pool', ids });
  },

  /**
   * Veinstorm (Set 2) — cast: LITERALLY play its own value in Rubies onto every tavern minion (owner
   * 2026-08-06: "veinstorm should literally apply the value of itself in rubies to the shop"). A Ruby is
   * 1/1 + the run's `rubyBonus`, so that is what each offer gains, under the `Ruby` source.
   *
   * ONE mechanism, on purpose. This shipped twice as something cleverer and both were wrong:
   *   · as `tavernBuyBonus` (the Staff of Guel channel) it was a generic tavern buff, invisible to every
   *     "the Rubies on this minion" reader — a Gemheart Carver bought out of a +10/+10 shop minted a 1/1;
   *   · as a run-level Ruby channel + a per-offer stamp it was an AURA no card could interact with (Ruby
   *     Transfer had nothing to steal), and the split had to be un-double-counted in every reader — which
   *     `offerBuyStats` did and the shop's own display did NOT, so the value rendered doubled.
   * Real Ruby buffs on real offers need no reconciliation: they ARE the offer's stats, they travel to the
   * bought minion as Rubies, Ruby Transfer can move them, and the inspect names them correctly.
   *
   * Deliberately does NOT fire `onRubyPlayed` — no Resonance Idol bounce, no Deepdelve Paragon multiplier,
   * no Spellstone cast tick. Offers have no watchers to fire, and a shop-wide grant firing one per offer
   * would make a 1-Gold spell the largest Ruby-count payoff in the game. `gainRubyStats` is the established
   * "Ruby stats, no watcher notify" precedent. The Ruby-LANDED cue does play, derived from the per-offer
   * Ruby-count delta — correctly: real Rubies are arriving, and that is what makes the spell legible.
   */
  spellBuffShopByRuby: (ctx) => {
    const rb = rubyStatBonus(ctx.state); // Spellstone folds spell power into every Ruby, this one included
    // OWNER RULING 2026-08-26 (triage board, q-spellpower-spellBuffShopByRuby REJECTED as flat): Veinstorm's
    // Rubies fold the run's spell power like every other stat-granting Shop spell.
    const a = 1 + rb.attack + spellAttackBonus(ctx.state);
    const h = 1 + rb.health + spellHealthBonus(ctx.state);
    const stamped: string[] = [];
    for (const offer of ctx.state.shop) if (stampVeinstormRubies(offer, a, h)) stamped.push(offer.uid);
    // Record which offers the CAST gemmed, so the shop-gem span plays for Veinstorm alone (a lone Ruby on an
    // offer is not in here and keeps its per-card cue). `onRefresh: false` — this is the cast, not a re-stamp.
    if (stamped.length > 0) ctx.state.veinstormStamped = { uids: stamped, onRefresh: false, attack: a, health: h };
    // BANK it so every future shop is stamped too — "permanently", and the owner's "every time i refresh the
    // shop, it should have that buff". The bank is only ever READ at mint time (see `rollShop`), never folded
    // into a stat read, which is what keeps each offer's Rubies real, stealable and counted exactly once.
    const bank = (ctx.state.veinstormRubies ??= { atk: 0, hp: 0 });
    bank.atk += a;
    bank.hp += h;
  },

  /** Hoardflame (Dragon) — cast on a minion: +`attack`/`health` base, plus +`per`/+`per` for each Dragon you
   *  PLAYED this turn (read from `playedThisTurn`). Flat (no spell power) so the printed value stays exact; the
   *  live total is folded into the card text via spellDisplayText. */
  spellBuffPerDragonPlayed: (ctx, self, params) => {
    const per = num(params.per, 1);
    const dragons = (ctx.state.playedThisTurn ?? []).filter((id) => {
      const d = CARD_INDEX[id];
      return !!d && (d.tribe === 'dragon' || d.tribe2 === 'dragon');
    }).length;
    // Owner 2026-08-18: spell power now scales the PER-DRAGON increment as well (reversing the once-only
    // 2026-07-26 ruling), and the per-Dragon rate is asymmetric (`perAttack`/`perHealth`, default `per`). The
    // base still takes spell power once, so with 0 Dragons the grant is base + spell power (e.g. 4/4 + 1/0 = 5/4).
    void per;
    const perA = num(params.perAttack, num(params.per, 1)) + spellAttackBonus(ctx.state);
    const perH = num(params.perHealth, num(params.per, 1)) + spellHealthBonus(ctx.state);
    const a = num(params.attack, 4) + spellAttackBonus(ctx.state) + perA * dragons;
    const h = num(params.health, 4) + spellHealthBonus(ctx.state) + perH * dragons;
    addBuff(self, str(params._source) || 'Hoardflame', a, h);
  },

  /** Sigil of Kinship — cast on a friendly minion: refresh the tavern's minion offers with random minions of
   *  THAT minion's type (dual-types count), up to your tavern tier. The spell slot is left as-is. */
  spellRefreshToTribe: (ctx, self) => {
    const tribe = self.tribe;
    refillShopFiltered(ctx.state, (c) => c.tier <= ctx.state.tier && (c.tribe === tribe || c.tribe2 === tribe));
  },

  /** Elevation Ritual — cast: upgrade EACH minion offer to a random minion one tier higher than itself (capped
   *  at the rift's max tier — Tier 7 only with Summit). The spell slot is left as-is. */
  spellRefreshTierUp: (ctx) => {
    elevateShop(ctx.state);
  },

  /** Layaway — cast on a TAVERN OFFER (via `castSpellOnOffer`, whose throwaway shares the offer's uid): keep
   *  that offer through rerolls (`kept`) and cut its cost by `reduce` (floored at 0). */
  spellLayaway: (ctx, self, params) => {
    const offer = ctx.state.shop.find((o) => o.uid === self.uid);
    if (!offer) return;
    offer.kept = true;
    offer.cost = Math.max(0, (offer.cost ?? CONFIG.minionCost) - num(params.reduce, 1));
  },

  /** Second Draft — cast on a friendly (non-Gilded, enforced by `targetNoGolden`) minion: return it to your
   *  hand INTACT (all buffs kept) to be replayed. The spell is consumed after, so the swap nets to fit the hand. */
  spellReturnToHand: (ctx, self) => {
    const bi = ctx.state.board.findIndex((c) => c.uid === self.uid);
    if (bi < 0) return;
    const [minion] = ctx.state.board.splice(bi, 1);
    if (minion) ctx.state.hand.push(minion);
  },

  /** Mana Font — cast: raise MAX Mana by `amount`, UNCAPPED (may push past the normal cap). Current Mana
   *  is NOT topped up — you don't gain the new Mana this turn, just a bigger pool from next turn on. */
  gainMaxMana: (ctx, _self, params) => {
    // Gold Font spell — "Gain +1 max Gold permanently." Same as Nadja's Goldspring: route through
    // `maxGoldBonus` (above the cap, the natural curve keeps climbing to 10 underneath) rather than
    // `s.maxEmbers`, or reaching 10 early makes the "permanent" gain evaporate the way it did before the
    // 2026-07-22 fix (see the `gainMaxMana` hero-power branch in the reducer).
    const amount = num(params.amount, 1);
    ctx.state.maxGoldBonus = (ctx.state.maxGoldBonus ?? 0) + amount;
  },

  /** Insurance Policy — cast: if you LOST your last combat, gain `gold` Gold (else nothing). Reads the pinned
   *  `lastCombat` result; a draw doesn't count (only 'lose'). No last combat yet (turn 1) → no payout. */
  spellGoldIfLostLast: (ctx, _self, params) => {
    if (ctx.state.lastCombat?.result === 'lose') gainGold(ctx.state, num(params.gold, 5));
  },

  /** Mend — cast: heal the hero by `amount`, capped at the run's max Resolve (no overheal). Reads
   *  `state.maxResolve` (not the hero's printed Resolve) so anything that ever changes a run's max
   *  heals to the right ceiling. Untargeted (acts on the run). */
  healHero: (ctx, _self, params) => {
    ctx.state.resolve = Math.min(ctx.state.maxResolve, ctx.state.resolve + num(params.amount, 5));
  },

  /** Mend (owner rework 2026-08-07) — SET Armor to `amount`. A floor, not a grant: at or above it, nothing
   *  happens (no shaving Armor down), and `maxArmor` rises with it so the bar renders the new value. */
  setArmor: (ctx, _self, params) => {
    const amount = num(params.amount, 5);
    if (ctx.state.armor >= amount) return;
    ctx.state.armor = amount;
    ctx.state.maxArmor = Math.max(ctx.state.maxArmor ?? 0, amount);
  },

  /** Lasso — cast: steal a random MINION offer from the tavern into the hand (free). Picks via the
   *  seeded rng, removes it from the shop, and adds it as a BoardCard (base + any offer buff bakes in,
   *  mirroring a buy). Fizzles gracefully on an empty shop or a full hand. */
  stealTavernMinion: (ctx, _self) => {
    const state = ctx.state;
    if (state.shop.length === 0 || state.hand.length >= handCap(state)) return;
    const rng = makeRng(state.rngCursor);
    const idx = rng.int(state.shop.length);
    state.rngCursor = rng.state();
    const offer = state.shop[idx]!;
    const card = CARD_INDEX[offer.cardId];
    if (!card) return;
    state.shop.splice(idx, 1); // stolen — leaves the tavern (the pooled copy travels with it to the hand)
    const cb = cardBuff(state, card.id); // a stolen Fodder carries Ritualist's run buff, like a buy
    state.hand.push({
      uid: `b${state.uidSeq++}`,
      cardId: card.id,
      tribe: card.tribe,
      // Stolen like a buy → also carries the run-wide Undead Attack bonus (undeadBuyAtk).
      attack: card.attack + cb.attack + (offer.atk ?? 0) + undeadBuyBonus(state, card),
      health: card.health + cb.health + (offer.hp ?? 0) + buyHealthAura(state, card),
      keywords: [...card.keywords, ...(offer.keywords ?? []).filter((k) => !card.keywords.includes(k))],
      golden: false,
    });
  },

  /** Staff of Guel — cast: a PERMANENT run-wide buff to every minion bought from the tavern from now
   *  on (not Discovered/conjured cards). Stacks if recast and picks up spell power on both stats. The
   *  shop UI folds it onto each offer; the buy bakes it into the minion. */
  spellBuffShop: (ctx, _self, params) => {
    const a = num(params.attack, 2) + spellAttackBonus(ctx.state);
    const h = num(params.health, 2) + spellHealthBonus(ctx.state);
    ctx.state.tavernBuyBonus.atk += a;
    ctx.state.tavernBuyBonus.hp += h;
    // Tavern buffs feed Fodder too — enchant the Fodder type run-wide (like Ritualist), so Demons
    // eating Fodder, and any Fodder you take, carry the Staff's buff. A directly-bought Fodder gets it
    // through this enchant, not the buy-buff (the buy path + shop view skip FD to avoid double-applying).
    // NO gust: the cue is Fodder-buff exclusive (owner 2026-07-16) — the Staff's enchant is a side effect.
    buffFodderRunWide(ctx.state, a, h, 'Staff of Guel', false);
  },

  /** Lantern of Souls — cast: your Undead get +`amount` Attack (plus spell power on Attack AND Health)
   *  for the rest of the run, wherever they are — shown on the board in the shop and re-derived at
   *  combat start + on summon/reborn inside `simulate`. */
  spellGrantTribeAttack: (ctx, _self, params) => {
    // Today only Undead is wired (RunState.undead*Bonus); the param keeps the data honest. The base is
    // an Attack buff; spell power folds in on top of BOTH stats (so +1/+1 spells turn +3 into +4/+1).
    if (str(params.tribe) === 'undead') {
      ctx.state.undeadAttackBonus += num(params.amount, 1) + spellAttackBonus(ctx.state);
      ctx.state.undeadHealthBonus += spellHealthBonus(ctx.state);
    }
  },

  /** Growth — cast: buff EVERY friendly minion on the board. Untargeted (runs without a picked target);
   *  scales with spell power like every stat spell (folded through spellStatBonus). */
  spellBuffAll: (ctx, _self, params) => {
    let attack = num(params.attack);
    let health = num(params.health);
    if (attack > 0 || health > 0) {
      attack += spellAttackBonus(ctx.state);
      health += spellHealthBonus(ctx.state);
      // Rune of Living Growth: the Growth spell itself has grown. Keyed by spell id (carried in `_spellId`),
      // so only Growth pays the accrual — the Front to Back shape, permanent instead of per-cast.
      if (str(params._spellId) === 'growth') {
        attack += ctx.state.growthBonus ?? 0;
        health += ctx.state.growthBonus ?? 0;
      }
    }
    const source = str(params._source) || 'Growth';
    for (const card of ctx.state.board) addBuff(card, source, attack, health);
  },

  /** Consume — cast: the chosen Demon (`self`) creates and eats `count` Fodder (Fred). Each freshly-made
   *  Fodder carries the run-wide Fodder enchant (Ritualist/Bane), feeds the Demon its stats × the Demon's
   *  fodder multiplier (Voracious Imp ×2) and fires its on-consume effects — the normal Consume pipeline +
   *  the eat animation (`fodderEaten`). No-op if the target isn't a Demon. */
  spellDemonConsumeFodder: (ctx, self, params) => {
    if (!self || !isTribe(self, 'demon')) return;
    const fodder = CARD_INDEX.fred;
    if (!fodder) return;
    const count = num(params.count, 1);
    const cb = cardBuff(ctx.state, fodder.id); // a created Fodder carries the run-wide Fodder enchant
    const fa = fodder.attack + cb.attack;
    const fh = fodder.health + cb.health;
    const mult = fodderMultiplier(self);
    const eaten: { eaterUid: string; fodderId: string; attack: number; health: number; gainA: number; gainH: number }[] = [];
    for (let i = 0; i < count; i++) {
      addBuff(self, 'Consume', fa * mult, fh * mult);
      fire(ctx, 'onConsume', { minion: self });
      eaten.push({ eaterUid: self.uid, fodderId: fodder.id, attack: fa, health: fh, gainA: fa * mult, gainH: fh * mult });
      noteFodderConsumed(ctx.state, fa, fh, self);
    }
    if (eaten.length > 0) {
      ctx.state.fodderEaten = eaten;
      ctx.state.fodderEatenSeq += 1;
    }
  },

  /** Perfect Vision — cast: SET the target's stats to a/h (absolute, not additive). Records the delta as a
   *  tracked buff so the inspect breakdown shows it and the stats land exactly at a/h. No spell-power scaling
   *  (it's a set, not a grant); a repeat cast (Yazzus) is a harmless no-op once the target is already there. */
  spellSetStats: (ctx, self, params) => {
    const a = num(params.attack, 20);
    const h = num(params.health, 20);
    // An absolute SET: the target's true stats become a/h and the auras re-apply on top (see the layer note on
    // `bakedAuraOf`). Perfect Vision on a Spear Warden showing 20/20 (3/3 own + 17/17 aura) ends at 37/37, not
    // 20/20 — overwriting the accrual made the spell a DOWNGRADE on the minions it should reward.
    writeStatResult(ctx.state, self, str(params._source) || 'Perfect Vision', a, h);
  },

  /** Common Ground — cast with TWO friendly targets (the second is `self`; the first is stashed on
   *  `pendingTarget.spellFirstUid`): set BOTH minions to the rounded average of their combined Attack and
   *  Health. Applied as delta buffs so it folds through the inspect breakdown. No spell-power scaling. */
  /**
   * Ruby Transfer (owner add 2026-08-06) — the target STEALS every Ruby buff from its adjacent minions.
   *
   * Works in BOTH rows, which is the whole point of the card (owner: "it can also target shop minions and
   * should steal ruby buffs from adjacent shop minions in that instance"). `castSpellOnOffer` casts on a
   * temp BoardCard that shares the offer's uid, so the row is identified by looking that uid up: found in
   * `shop` → steal from the SHOP neighbours; otherwise the board's. A Ruby buff is a first-class named entry
   * (`buffs[].source === 'Ruby'`) on both card kinds, so "all Ruby buffs" is exact — it moves precisely what
   * Rubies put there and never touches Growth, a tavern buff or an aura.
   *
   * Deliberately NOT routed through `fireOnRubyPlayed`: nothing is being CAST here, stats are changing hands.
   * Firing it would let a Resonance Idol bounce a Ruby that was already played, and would tick Deepdelve
   * Paragon / the Spellstone cast count a second time for one Ruby (matching `gainRubyStats`' documented
   * no-rebounce reasoning). The stolen stats stay labelled 'Ruby' on the thief, so Gemheart Carver and every
   * other reader of "the Rubies on this minion" sees them.
   */
  spellStealAdjacentRubies: (ctx, self) => {
    const state = ctx.state;
    const shopIdx = state.shop.findIndex((o) => o.uid === self.uid);
    const inShop = shopIdx >= 0;
    // Neighbours in the row the target actually sits in. A spell OFFER is not a minion, so the shop row
    // skips them — stealing "from the spell slot" is meaningless and would silently do nothing anyway.
    const donors: { rubyOf: () => { attack: number; health: number }; take: (a: number, h: number) => void }[] = [];
    if (inShop) {
      for (const i of [shopIdx - 1, shopIdx + 1]) {
        const o = state.shop[i];
        if (!o || CARD_INDEX[o.cardId]?.spell || CARD_INDEX[o.cardId]?.ruby) continue;
        donors.push({
          rubyOf: () => { const e = o.buffs?.find((b) => b.source === 'Ruby'); return { attack: e?.attack ?? 0, health: e?.health ?? 0 }; },
          take: (a, h) => addOfferBuff(o, 'Ruby', -a, -h),
        });
      }
    } else {
      const bi = state.board.findIndex((c) => c.uid === self.uid);
      if (bi < 0) return;
      for (const i of [bi - 1, bi + 1]) {
        const c = state.board[i];
        if (!c) continue;
        donors.push({
          rubyOf: () => { const e = c.buffs?.find((b) => b.source === 'Ruby'); return { attack: e?.attack ?? 0, health: e?.health ?? 0 }; },
          take: (a, h) => addBuff(c, 'Ruby', -a, -h),
        });
      }
    }
    // Play 2 REAL Rubies on the target first (owner addition 2026-08-07): through the same addBuff('Ruby') +
    // watcher path a played Ruby uses, so Resonance Idol / Candle Conduit / Ruby Broker all see them. A shop
    // target takes them as offer Rubies (offers have no watchers, matching every other shop-row Ruby).
    {
      const rb = rubyStatBonus(state);
      for (let n = 0; n < 2; n++) {
        const ra = 1 + rb.attack;
        const rh = 1 + rb.health;
        if (inShop) addOfferBuff(state.shop[shopIdx]!, 'Ruby', ra, rh);
        addBuff(self, 'Ruby', ra, rh); // `self` IS the temp card in the shop case — the fold-back carries it
        if (!inShop) fireOnRubyPlayed(state, self, ra, rh);
      }
    }
    let gotA = 0;
    let gotH = 0;
    for (const d of donors) {
      const { attack, health } = d.rubyOf();
      if (attack <= 0 && health <= 0) continue;
      d.take(attack, health); // the donor loses exactly what it had — negatives net the entry to zero
      gotA += attack;
      gotH += health;
    }
    if (gotA === 0 && gotH === 0) return;
    // Land on the target as RUBY stats, so the thief reads as a Ruby-laden minion to everything downstream.
    if (inShop) addOfferBuff(state.shop[shopIdx]!, 'Ruby', gotA, gotH);
    addBuff(self, 'Ruby', gotA, gotH); // `self` IS the temp card in the shop case — keeps the fold-back honest
  },

  spellAverageStats: (ctx, self) => {
    const first = ctx.state.board.find((c) => c.uid === ctx.state.pendingTarget?.spellFirstUid);
    if (!first || first.uid === self.uid) return;
    // The average is over DISPLAYED stats — what the player reads on the two cards — and each minion then keeps
    // its OWN auras. Worked example: a Spear Warden showing 20/20 averaged with a 1/1 gives 10/10 true, and the
    // Warden's +17/17 puts it back to 27/27 while the partner sits at 10/10.
    const da = displayedStatsOf(ctx.state, first);
    const db = displayedStatsOf(ctx.state, self);
    const avgA = Math.round((da.attack + db.attack) / 2);
    const avgH = Math.round((da.health + db.health) / 2);
    writeStatResult(ctx.state, first, 'Common Ground', avgA, avgH);
    writeStatResult(ctx.state, self, 'Common Ground', avgA, avgH);
  },

  /** Turnabout — cast: swap the target's Attack and Health. Applied as a delta buff (like `spellSetStats`) so
   *  the swap folds through the buff breakdown and back onto a tavern offer via `castSpellOnOffer`. A literal
   *  swap: a 0-Attack minion becomes 0-Health (the player's call). No spell-power scaling — it moves existing
   *  stats, it doesn't grant them. */
  spellSwapStats: (ctx, self, params) => {
    // Swap the DISPLAYED stats, then the auras re-apply. Owner's report: on a Deathsayer showing 383/361 with a
    // +349/+351 Undead aura this must give 710/734. It previously gave ±24, because it swapped the STORED stats
    // and almost all of that 383 was a display-folded aura that stored never held.
    const d = displayedStatsOf(ctx.state, self);
    writeStatResult(ctx.state, self, str(params._source) || 'Turnabout', d.health, d.attack);
  },

  /** Apples — cast: buff every minion currently in the tavern by +atk/+hp (rides on each offer's `atk`/`hp`,
   *  so a buy bakes it in). Lost on a refresh (fresh offers), kept on a freeze (same offers). Flat. */
  spellBuffTavern: (ctx, _self, params) => {
    const a = num(params.attack, 2);
    const h = num(params.health, 3);
    for (const offer of ctx.state.shop) addOfferBuff(offer, 'Apples', a, h); // the only card using this factory
  },

  /** Apples (Choose One, second option) — bank a buff for the NEXT tavern roll: it's folded onto that shop's
   *  offers in `refreshTavern`, then cleared. Flat (no spell-power scaling), like the current-shop option. */
  spellBuffNextShop: (ctx, _self, params) => {
    ctx.state.nextShopBuff ??= { attack: 0, health: 0 };
    ctx.state.nextShopBuff.attack += num(params.attack, 2);
    ctx.state.nextShopBuff.health += num(params.health, 4);
  },

  /** Fleeting Vigor — cast: bank a one-shot Start-of-Combat buff for the NEXT combat (your minions enter
   *  that fight at +atk/+hp, then it's spent — applied in `faceOmen`). Stacks if cast twice. Scales with the
   *  run's spell power (folded onto both stats), like the other stat-buff spells. */
  spellPendingSCBuff: (ctx, _self, params) => {
    ctx.state.fleetingVigor ??= { attack: 0, health: 0 };
    ctx.state.fleetingVigor.attack += num(params.attack, 2) + spellAttackBonus(ctx.state);
    ctx.state.fleetingVigor.health += num(params.health, 1) + spellHealthBonus(ctx.state);
  },

  /** Summoning Bulwark — cast: the first N minions you summon in the NEXT combat gain Taunt. Banked on the
   *  run (not on a body) because the recipients do not exist yet; `faceOmen` hands the count to the player's
   *  combat side and the turn rollover clears whatever went unspent. */
  spellTauntNextSummons: (ctx, _self, params) => {
    ctx.state.summonTauntsNextCombat = (ctx.state.summonTauntsNextCombat ?? 0) + num(params.count, 2);
  },

  /** Field Maneuvers / Last Stand / Executioner's Edge — cast on a friendly minion: bank a keyword grant for
   *  the NEXT combat only (`faceOmen` stamps it onto that minion's combat instance, then clears the bank). For
   *  Critical Strike (`CR`), `critChance` seeds the per-swing double-damage probability the combat sim rolls. */
  spellGrantKeywordNextCombat: (ctx, self, params) => {
    const keyword = str(params.keyword) as Keyword;
    if (!keyword) return;
    (ctx.state.pendingCombatKeywords ??= []).push({
      uid: self.uid,
      keyword,
      ...(typeof params.critChance === 'number' ? { critChance: params.critChance } : {}),
    });
    // Show the promise on the minion until combat spends it (owner ask 2026-07-31): the granting spell's name
    // lands gold-parenthesized in the card text (via `tempGrants` → instView) and as a 0/0 entry in the buff
    // list, and the keyword badge previews. Parentheses = temporary; cleared in `faceOmen` with the real bank.
    const label = str(params.label) || 'Next combat';
    (self.tempGrants ??= []).push({ label, keyword });
    (self.buffs ??= []).push({ source: `(${label})`, attack: 0, health: 0, count: 1 });
  },

  /** Channeling the Devourer — cast: devour the targeted friendly minion (`self`, removed from the
   *  board) and spit its stats onto a RANDOM other friend. It transfers existing stats, so it does NOT
   *  scale with spell power; the `singleCast` flag on its card keeps spell-quantity multipliers from
   *  devouring twice. Records `devourFx` so the UI can fling the stats over as a projectile. */
  /** POWER SHIFTER (T5): Discover a NEW hero power and wield it for the rest of the run, replacing the
   *  current one. Draws from MIMIC's pool — the owner's single source of "which powers are discoverable"
   *  (`powerDiscoverPool`, heroes.ts) — minus the power you already wield, since re-offering it is a dud
   *  option. `singleCast` on the card keeps spell doublers from opening two picks whose second would simply
   *  overwrite the first.
   *
   *  A no-op on an empty pool (a content change could starve it), which is the same no-soft-lock rule the
   *  quest offer follows: the spell is spent, nothing opens, the turn proceeds. */
  spellPowerShift: (ctx) => {
    const st = ctx.state;
    // The hero id whose power is being replaced — the adopted one if any, else the run's own hero.
    const wielding = st.voidPowerIds?.[0] ?? st.adoptedPowerId ?? st.mimicPowerId ?? st.heroId;
    const pool = powerDiscoverPool('mimic', [wielding]);
    if (pool.length === 0) return;
    const rng = makeRng(st.rngCursor);
    const heroIds: string[] = [];
    // THREE options (owner 2026-08-22), unlike the hero Discovers' two: this is a one-shot spell you paid
    // Gold for and it overwrites what you have, so it earns a wider choice than a per-turn disguise does.
    while (heroIds.length < SHIFTER_OPTIONS && pool.length > 0) heroIds.push(pool.splice(rng.int(pool.length), 1)[0]!);
    st.rngCursor = rng.state();
    st.powerOffer = { heroIds, slot: 'shifter' };
  },
  spellDevour: (ctx, self) => {
    const board = ctx.state.board;
    const idx = board.indexOf(self);
    if (idx < 0) return;
    const attack = self.attack;
    const health = self.health;
    board.splice(idx, 1); // devour the chosen minion
    if (board.length === 0) return; // nothing left to feed
    const rng = makeRng(ctx.state.rngCursor);
    const recipient = board[rng.int(board.length)]!;
    ctx.state.rngCursor = rng.state();
    addBuff(recipient, 'Channeling the Devourer', attack, health);
    ctx.state.devourFx = { toUid: recipient.uid, attack, health };
  },

  /** Lantern Light — give the target +Tier/+Tier (your current Tavern Tier), PLUS the run's spell power on
   *  top of both stats (so at T4 with +1/+0 spell power it gives +5/+4), like every other stat spell. */
  spellBuffByTier: (ctx, self, params) => {
    if (!self) return;
    const t = ctx.state.tier;
    addBuff(self, str(params._source) || nameOf(self), t + spellAttackBonus(ctx.state), t + spellHealthBonus(ctx.state));
  },

  /** Fodder Treatment — SELL the target (gain its base sell value as Gold) and spit its current stats onto
   *  your LEFT-MOST Demon, firing that Demon's on-consume payoffs (Pactstone / Maw / Glutton). No Demon →
   *  the stats are wasted, but the sell + Gold still happen. */
  spellSellToDemon: (ctx, self) => {
    if (!self) return;
    const state = ctx.state;
    const idx = state.board.indexOf(self);
    if (idx < 0) return;
    const sold = state.board.splice(idx, 1)[0]!; // counts as a sell
    gainGold(state, sellValueOf(sold, state)); // the Gold the player gets from the sell (bartering-aware)
    // It COUNTS AS A SELL, so Robin's Spoils banks its +1 next-turn Gold too (parity with the reducer's
    // sell case — this path used to skip it).
    if (hasPower(state, 'sellGold')) state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + 1;
    returnToPool(state, sold.cardId, sold.golden ? 3 : 1);
    const demon = state.board.find((c) => isTribe(c, 'demon')); // left-most Demon (board order)
    if (demon) {
      addBuff(demon, 'Fodder Treatment', sold.attack, sold.health);
      fire(ctx, 'onConsume', { minion: demon });
    }
  },

  /** Feed the Alpha — SELL the target (gain its base sell value as Gold) and give its current stats to your
   *  RIGHT-MOST Beast. No Beast → the stats are wasted, but the sell + Gold still happen. Beast sibling of
   *  Fodder Treatment (`spellSellToDemon`), minus the on-consume payoffs. */
  spellSellToBeast: (ctx, self) => {
    if (!self) return;
    const state = ctx.state;
    const idx = state.board.indexOf(self);
    if (idx < 0) return;
    const sold = state.board.splice(idx, 1)[0]!; // counts as a sell
    gainGold(state, sellValueOf(sold, state)); // bartering-aware (parity with the reducer's sell)
    if (hasPower(state, 'sellGold')) state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + 1;
    returnToPool(state, sold.cardId, sold.golden ? 3 : 1);
    const beast = [...state.board].reverse().find((c) => isTribe(c, 'beast')); // right-most Beast (board order)
    if (beast) addBuff(beast, 'Feed the Alpha', sold.attack, sold.health);
  },

  /** Resonance — re-trigger the target's Battlecry (the reducer guards this to Battlecry minions only).
   *  Reuses the Myra-power path, so Drakko's "Battlecries fire extra times" still amplifies it. */
  spellReplayBattlecry: (ctx, self) => {
    if (!self) return;
    replayBattlecry(ctx.state, self);
  },

  /** Chrono Staff — your End-of-Turn effects fire one additional time this turn (a per-turn flag: stacks with
   *  Chronos, not with itself). Read by `endOfTurnRepeats`; reset at the next turn start. */
  spellExtraEndOfTurn: (ctx) => {
    ctx.state.extraEotThisTurn = true;
  },

  /** Golden Touch — make a random (non-golden) tavern minion offer Golden; the buy bakes the golden in
   *  (goldens store base stats, ×2 at combat, like Indy's gild). Untargeted — the game picks the minion. */
  /** Set 2 — Champion's Ale. Give your LEFT-MOST board minion +atk/+hp. Board order, so the pick is
   *  deterministic and consumes no RNG — the player chooses by arranging their line, which is the point. */
  spellBuffLeftmost: (ctx, _self, params) => {
    const target = ctx.state.board[0];
    if (!target) return; // empty board → fizzles (the spell is still spent, like every untargeted cast)
    // Spell power folds in, same rule as `spellBuffTarget` (spell-power audit 2026-08-02).
    let attack = num(params.attack, 0);
    let health = num(params.health, 0);
    if (attack > 0 || health > 0) {
      attack += spellAttackBonus(ctx.state);
      health += spellHealthBonus(ctx.state);
    }
    addBuff(target, 'Ale', attack, health);
  },

  /** Set 2 — Defensive / Bloody Ale. Buff `count` DISTINCT random friendly minions by +atk/+hp.
   *  Distinct because "3 random friendly minions" means three bodies, not three rolls that can land twice on
   *  the same one; a board smaller than `count` simply buffs everyone. Seeded off the run cursor so a reload or
   *  replay picks identically. */
  spellBuffRandomFriendlies: (ctx, _self, params) => {
    const want = num(params.count, 3);
    const pool = [...ctx.state.board];
    if (pool.length === 0 || want <= 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    const picks: BoardCard[] = [];
    for (let i = 0; i < want && pool.length > 0; i++) picks.push(pool.splice(rng.int(pool.length), 1)[0]!);
    ctx.state.rngCursor = rng.state();
    // Spell power folds in, same rule as `spellBuffTarget` (owner report 2026-08-02: a +1/+1-power Defensive
    // Ale landed its printed +0/+4 — this factory never read the bonus at all).
    let attack = num(params.attack, 0);
    let health = num(params.health, 0);
    if (attack > 0 || health > 0) {
      attack += spellAttackBonus(ctx.state);
      health += spellHealthBonus(ctx.state);
    }
    for (const t of picks) addBuff(t, 'Ale', attack, health);
  },

  /** Set 2 — Dragonflame (shop cast): buff `base` + (# friendly `tribe`, Dragons) random friendlies by +atk/+hp,
   *  WITH replacement — more buffs than bodies simply stacks. Spell power folds in like every stat spell. */
  spellBuffRandomPerTribe: (ctx, _self, params) => {
    const board = ctx.state.board;
    if (board.length === 0) return;
    const tribe = str(params.tribe) as Tribe;
    const dragons = tribe ? board.filter((c) => isTribe(c, tribe)).length : 0;
    const reps = num(params.base, 1) + dragons;
    let attack = num(params.attack, 4);
    let health = num(params.health, 4);
    if (attack > 0 || health > 0) {
      attack += spellAttackBonus(ctx.state);
      health += spellHealthBonus(ctx.state);
    }
    const rng = makeRng(ctx.state.rngCursor);
    for (let i = 0; i < reps; i++) addBuff(board[rng.int(board.length)]!, 'Dragonflame', attack, health);
    ctx.state.rngCursor = rng.state();
  },

  /** Set 2 — Flutter (shop cast): the targeted minion (`self`) gains +Health; a Dragon also gains Flurry. */
  spellBuffHealthGrantFlurryDragon: (ctx, self, params) => {
    let attack = 0;
    let health = num(params.health, 10);
    if (health > 0) {
      attack += spellAttackBonus(ctx.state);
      health += spellHealthBonus(ctx.state);
    }
    addBuff(self, nameOf(self), attack, health);
    if (isTribe(self, 'dragon') && !self.keywords.includes('W')) self.keywords.push('W');
  },

  /** Set 2 — Reinforcing Ale. Get a minion of your most common tribe, into hand. Reuses the same
   *  `grantTopTypeMinion` the hero power path uses, so "most common type" is resolved one way everywhere
   *  (dominant tribe, capped at your tavern tier, respecting the shared pool). No-op with no dominant tribe. */
  spellGrantTopTypeMinion: (ctx) => {
    grantTopTypeMinion(ctx.state);
  },

  spellGildRandomTavern: (ctx) => {
    const offers = ctx.state.shop.filter((o) => !o.golden);
    if (offers.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    offers[rng.int(offers.length)]!.golden = true;
    ctx.state.rngCursor = rng.state();
  },

  /** Displacement — swap the target friendly minion with a random tavern minion (shared with Darah's power). */
  spellDisplace: (ctx, self) => {
    if (!self) return;
    swapWithTavern(ctx.state, self);
  },

  /** Spell Cart — refresh the tavern full of spells (replace the minion offers with random eligible spells).
   *  The next normal roll restocks minions, so it's a one-shot. Untargeted. */
  spellRefreshToSpells: (ctx) => {
    rollSpellShop(ctx.state);
  },

  /** Steward of Spells — End of Turn: add a copy of the most recent spell cast this run to your hand (golden:
   *  2 copies). No-op if no spell has been cast yet, or the hand is full. */
  spellCopyRecent: (ctx, self) => {
    const spellId = ctx.state.lastSpellCastId;
    if (!spellId || !self) return;
    const def = CARD_INDEX[spellId];
    if (!def) return;
    for (let i = 0; i < gold(self) && ctx.state.hand.length < handCap(ctx.state); i++) {
      ctx.state.hand.push({
        uid: `b${ctx.state.uidSeq++}`,
        cardId: spellId,
        tribe: def.tribe,
        attack: def.attack,
        health: def.health,
        keywords: [...def.keywords],
        golden: false,
      });
    }
  },

  /** A minion casts a named spell from an event, auto-targeting the carry (the
   *  highest-attack friend). Counts the cast but doesn't re-fire spellCast (no recursion). */
  castSpell: (ctx, self, params) => {
    const spellDef = CARD_INDEX[str(params.spellId)];
    if (!spellDef || spellDef.singleCast) return; // singleCast spells (Devourer) never multi-fire
    // A GILDED caster casts twice (owner 2026-07-21, Rope Wrangler) — each cast re-picks its target and
    // counts as a real cast, so spell-cast payoffs (Guel, Spirit Pup, Forsaken Weaver) see both.
    // Opt-in multicast (Rope Wrangler 2026-08-18): `perGold` grants +1 cast per that much Gold spent this turn,
    // and `maxCasts` is a hard cap on the total. Absent → plain gold-scaled casting, unchanged.
    const perGold = num(params.perGold, 0);
    const maxCasts = num(params.maxCasts, 0);
    let n = (perGold > 0 ? 1 + Math.floor((ctx.state.goldSpentThisTurn ?? 0) / perGold) : 1) * gold(self);
    if (maxCasts > 0) n = Math.min(maxCasts, n);
    for (let i = 0; i < n; i++) {
      const friends = ctx.state.board.filter((c) => c !== self);
      const target = friends.length ? friends.reduce((a, b) => (b.attack > a.attack ? b : a)) : self;
      applyCastEffects(ctx, spellDef, target);
      ctx.state.spellsCast += 1;
      ctx.state.spellsThisTurn += 1;
    }
  },

  /** Vineweaver Drake — End of Turn: cast `spellId` (Growth) once, plus one more cast for each prior End of
   *  Turn this minion has seen (escalating). Per-instance `eotTick` counts turns on board (like Frontdrake);
   *  a Chronos replay rides the same tick without advancing it. Golden doubles the number of casts. */
  /** Arnold — End of Turn: cast a named spell ON THIS MINION. Golden casts twice. Deliberately NOT the
   *  escalating sibling below: the count is flat, and the target is ALWAYS self (the escalating one aims at the
   *  biggest other friend), which is what makes a self-Beefy a Dwarf capstone rather than a board pump. */
  endOfTurnCastSpellOnSelf: (ctx, self, params) => {
    const spellDef = CARD_INDEX[str(params.spellId)];
    if (!spellDef || spellDef.singleCast) return;
    const times = num(params.times, 1) * gold(self);
    for (let i = 0; i < times; i++) {
      applyCastEffects(ctx, spellDef, self);
      ctx.state.spellsCast += 1;
      ctx.state.spellsThisTurn += 1;
    }
  },

  endOfTurnCastSpellEscalating: (ctx, self, params, payload) => {
    const spellDef = CARD_INDEX[str(params.spellId)];
    if (!spellDef || spellDef.singleCast) return;
    const replay = payload.replay === true;
    if (!replay && num(payload.proc, 0) === 0) self.eotTick = (self.eotTick ?? 0) + 1; // count this turn once
    const times = Math.max(1, self.eotTick ?? 1) * gold(self); // Nth End of Turn → N casts (golden doubles)
    for (let i = 0; i < times; i++) {
      const friends = ctx.state.board.filter((c) => c !== self);
      const target = friends.length ? friends.reduce((a, b) => (b.attack > a.attack ? b : a)) : self;
      applyCastEffects(ctx, spellDef, target);
      ctx.state.spellsCast += 1;
      ctx.state.spellsThisTurn += 1;
    }
  },

  /** Crypt Scribe — End of Turn: conjure `count` random spells (from the buyable spell pool) into your hand.
   *  Golden doubles the count. Advances the run RNG cursor; respects the hand cap. */
  endOfTurnGetRandomSpells: (ctx, self, params) => {
    const count = num(params.count, 2) * gold(self);
    const rng = makeRng(ctx.state.rngCursor);
    for (let i = 0; i < count && ctx.state.hand.length < handCap(ctx.state); i++) {
      const def = poolOf(ctx.state).spells[rng.int(poolOf(ctx.state).spells.length)]!;
      ctx.state.hand.push({
        uid: `b${ctx.state.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        attack: def.attack,
        health: def.health,
        keywords: [...def.keywords],
        golden: false,
      });
    }
    ctx.state.rngCursor = rng.state();
  },

  // ─── New content batch (recruit side) ──────────────────────────────────────

  /** Deathswarmer — Battlecry: give your Undead +N Attack wherever they are (board + hand), and stack the
   *  bonus into undeadBuyAtk so future undead buys carry it too. Golden doubles N. */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryBuffUndeadAttack: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffUndeadAttack(shopArena(ctx.state, self), params);
  },

  /** Squirl Scout — Battlecry: your Beasts get +amount Attack "wherever they are". Buffs every current Beast
   *  (board + hand) now and stacks the bonus into `beastBuyAtk`, so future Beasts (bought / conjured / summoned /
   *  Reborn) carry it too — the Beast sibling of Toxin Tender's Undead aura. Golden doubles N. */
  battlecryBuffBeastAttack: (ctx, self, params) => {
    const amount = num(params.amount, 2) * gold(self);
    for (const card of [...ctx.state.board, ...ctx.state.hand]) {
      if (isTribe(card, 'beast')) addBuff(card, nameOf(self), amount, 0);
    }
    ctx.state.beastBuyAtk = (ctx.state.beastBuyAtk ?? 0) + amount;
  },

  /** Squirl Scout — Battlecry: give a RANDOM friendly minion +N/+N, repeated once per Beast you own (board).
   *  N is the run-wide `squirlScoutBuff`, which each Squirl Scout played raises by `step` (×2 golden), so it
   *  snowballs across the run. Squirl Scout is on the board when this fires, so it counts itself. Grants spread
   *  (each repeat re-rolls the target). Live grant surfaces via cardText's squirlScoutText. */
  battlecryScoutSpread: (ctx, self, params) => {
    const state = ctx.state;
    const step = num(params.step, 3) * gold(self) * improveReps(state); // "improves this" — ×2 under Mastery
    state.squirlScoutBuff = (state.squirlScoutBuff ?? 0) + step; // improve first → THIS play grants the new value
    const amount = state.squirlScoutBuff;
    const beasts = state.board.filter((c) => isTribe(c, 'beast')).length; // "for every Beast you own"
    if (amount <= 0 || beasts === 0 || state.board.length === 0) return;
    const rng = makeRng(state.rngCursor);
    for (let i = 0; i < beasts; i++) {
      const target = state.board[rng.int(state.board.length)]!; // a random friendly minion (may repeat)
      addBuff(target, nameOf(self), amount, amount);
    }
    state.rngCursor = rng.state();
  },

  /** Conductor — Shout: give the two ADJACENT minions +(2×N)/+(3×N), where N is the run-wide `conductorBuff`
   *  weighted trigger count each Conductor Shout raises by 1 (×2 gilded, ×2 Mastery) — Squirl Scout's
   *  snowball, positional. Improve first → THIS play grants the new value (first play = +2/+3). Live grant
   *  surfaces via cardText's conductorText. */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases. The INCREMENT stays here because
  // it is a play-time event ("every Conductor PLAYED"); the grant itself is the shared arena body, which is
  // what makes the same Shout resolve during COMBAT re-fires instead of silently deferring to settle.
  battlecryConductorAdjacent: (ctx, self, params) => {
    const state = ctx.state;
    state.conductorBuff = (state.conductorBuff ?? 0) + gold(self) * improveReps(state);
    ARENA_EFFECTS.battlecryConductorAdjacent(shopArena(state, self), params);
  },

  /** Scrap Herald — Battlecry: your Magnetic minions ("Attachments") get +atk/+hp "wherever they are". Buffs
   *  every current Magnetic (board + hand) now and stacks into `magneticBuyAtk`/`magneticBuyHp`, so future
   *  Magnetics (bought / conjured / summoned / Reborn) carry it too — the Magnetic sibling of Squirl Scout's
   *  Beast aura, but with a Health half. Golden doubles. */
  // ARENA-MIGRATED (Shout family): one body in arena.ts serves both phases.
  battlecryBuffMagnetics: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffMagnetics(shopArena(ctx.state, self), params);
  },

  /** Koron — every `every` Gold you spend (the per-instance gold meter), permanently buff your Fodder run-wide
   *  (like Bane's enchant) AND queue `fodder` Fodder into your next tavern. Golden doubles both the stat grant
   *  and the Fodder count. Fired by `applyGoldSpent` once per threshold. (Imps are no longer affected.) */
  goldSpentBuffFodder: (ctx, self, params) => {
    const a = num(params.attack, 1) * gold(self);
    const h = num(params.health, 1) * gold(self);
    buffFodderRunWide(ctx.state, a, h, nameOf(self));
    const fodder = num(params.fodder, 0) * gold(self);
    if (fodder > 0) {
      (ctx.state.pendingTavern ??= []).push(...Array(fodder).fill('fred'));
      stampFodderSend(ctx.state, self?.uid); // Fodder Infusion FX (rides alongside the Buff Gust's enchant)
    }
  },

  /** Banksly — every `every` Gold you spend (the per-instance gold meter), weld a RANDOM Magnetic minion's
   *  stats + keywords onto Banksly himself (`count` times, golden doubles `count`). Mirrors Combinator's
   *  random-magnetic roll, but the host is always self. */
  goldSpentMagnetize: (ctx, self, params) => {
    const count = num(params.count, 1) * gold(self);
    // Sorted by id so the pick is deterministic by construction (same rule as endOfTurnMagnetizeMechs) —
    // not dependent on CARD_INDEX insertion order surviving refactors.
    const magnetics = Object.values(CARD_INDEX)
      .filter((c) => c.keywords.includes('M') && !c.token && !c.spell)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (magnetics.length === 0) return;
    const rng = makeRng(ctx.state.rngCursor);
    for (let i = 0; i < count; i++) {
      const pick = magnetics[rng.int(magnetics.length)]!;
      const pickBuff = cardBuff(ctx.state, pick.id); // a Cling pick carries its accrued improvement
      const clings = pick.id === 'cling' ? 1 : 0;
      weldMagnetic(ctx.state, self, {
        source: pick.name,
        attack: pick.attack + pickBuff.attack,
        health: pick.health + pickBuff.health,
        keywords: [...pick.keywords],
        mana: pick.manaPerTurn ?? 0,
        rallyMechAtk: pick.rallyMechAtk,
        spellAura: pick.spellAura,
        fodderAura: pick.fodderAura,
      }, clings);
    }
    ctx.state.rngCursor = rng.state();
  },

  /** Forsaken Weaver (recruit half) — when a spell is cast, give your Undead +N Attack wherever they are
   *  (board + hand), and stack the bonus into undeadBuyAtk for future undead buys. Golden doubles N. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  spellCastBuffUndeadAttack: (ctx, self, params) => {
    ARENA_EFFECTS.spellCastBuffUndeadAttack(shopArena(ctx.state, self), params);
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // RUNE-ONLY MINION BATCH (2026-08-20). Every card that reaches these is `token: true` — forge-only, so
  // none of them can appear in a shop roll. The factories themselves are ordinary primitives.
  // ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** GEM SAGE — "Whenever you get a Ruby, get an additional copy." (golden: two extra).
   *
   *  Minted through `mintRubies` with `silent: true`, which is the whole design note: the normal mint fires
   *  `onGetRuby` for every Ruby it makes, and this factory IS an `onGetRuby` handler — a plain mint would
   *  recurse forever (and two Sages would recurse twice as fast). The duplicate still fires `onGainCard`
   *  (Gangplank sees a card arrive), it just doesn't re-open the Ruby-gained round. */
  onGetRubyDuplicate: (ctx, self, params) => {
    mintRubies(ctx.state, num(params.count, 1) * gold(self), RUBY_ID, undefined, true);
  },

  /** ANCIENT WANDERER — "Has +1/+1 for every 3 Gold you have spent this run."
   *
   *  A HAS, not a gains: the body is worth the run's whole spend the moment you own it, not just the spend it
   *  witnessed. So this is not a per-threshold grant (the `goldSpent` meter shape every other Gold card uses)
   *  — it's a SYNC. `syncGoldSpentScalers` recomputes the target total from `state.goldSpent` and lands only
   *  the delta under a fixed buff source, which makes it idempotent, itemized in the inspect breakdown, and —
   *  crucially — a REAL stored buff, so combat, snapshots and saves need no new plumbing.
   *
   *  Declared `on: 'passive'`: nothing dispatches it through the bus (the sync reads the effect off the card),
   *  matching Deepdelve Paragon's contract. The body here is the sync for one card, so a re-trigger path that
   *  does fire it is harmless. */
  goldSpentScaleSelf: (ctx, self, params) => {
    syncGoldSpentScaler(ctx.state, self, params);
  },

  /** NIGHT MARKET HORROR — "After you buy a card, give minions in the shop +2/+2 THIS TURN."
   *
   *  A per-TURN shop-wide enchant, not a one-shot gift to the offers standing there (owner correction
   *  2026-08-20). Banked in `tavernBuyBonusTurn` — the ONE channel with these semantics (built for Rune of
   *  the Merchant's Chorus): it accumulates across every refresh you make this turn, so a REROLLED row
   *  inherits it, and it is cleared at the turn rollover in `advanceCombat`, i.e. after combat. The
   *  permanent sibling is `tavernBuyBonus` ("minions in the Shop", no qualifier), which this must not touch.
   *  Golden doubles. */
  buffShopOffersThisTurn: (ctx, self, params) => {
    addTurnShopBuff(ctx.state, num(params.attack, 2) * gold(self), num(params.health, 2) * gold(self));
  },

  /** TRAVELING SALESMAN — "When you SELL this, Discover a minion you control EXACTLY ONE copy of."
   *
   *  A `pool` Discover over the ids on your board that appear exactly once — a real "finish the pair" tool
   *  rather than a generic offer. Fired by `fireOnSell` AFTER the Salesman has left the board, so it can never
   *  offer itself. Ids only (not uids): two copies of the same card is what "one copy" is counting, and a
   *  Golden already IS three, so a gilded body is excluded (it can't be tripled again). Golden Discovers twice. */
  onSellDiscoverSingleton: (ctx, self) => {
    const counts = new Map<string, number>();
    for (const c of ctx.state.board) {
      const d = CARD_INDEX[c.cardId];
      if (!d || d.spell || d.ruby) continue;
      counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + (c.golden ? 3 : 1));
    }
    const ids = [...counts.entries()].filter(([, n]) => n === 1).map(([id]) => id);
    if (ids.length === 0) return;
    const spec: DiscoverSpec = { kind: 'pool', ids };
    queueDiscover(ctx.state, spec);
    if (self.golden) queueDiscover(ctx.state, spec);
  },

  /** KEGHEART DWARF — "Whenever you get a Dwarven Ale, gain +3/+3." (golden +6/+6).
   *
   *  Rides `onGainCard`, the shared conjure/grant chokepoint, and filters on the arriving card being one of
   *  the five `wo_*` Ales — so Brunni's Shout, the Tapkeeper's End of Turn, a Gold-spent Ale and Rune of Last
   *  Call all pay it, without any of them needing to know Kegheart exists. `payload.cardId` is what makes the
   *  filter possible: the event used to carry only "a card arrived". */
  onGainAleBuffSelf: (ctx, self, params, payload) => {
    // Arena-backed since 2026-08-29, for the same reason as Gangplank above: an Ale a combat effect grants
    // now pays this during the fight, through the one shared body.
    ARENA_EFFECTS.onGainAleBuffSelf(shopArena(ctx.state, self), params, payload.cardId);
  },

  /** NINEFOLD BROKER — "After you buy a minion, get a random Shop spell OF THE SAME TIER. Can trigger 9 times."
   *
   *  The charge counter is PER-RUN and PER-INSTANCE: it rides `buyTick`, the existing buy-meter field on the
   *  BoardCard, which nothing else on this card touches (`applyCardsBought` only advances it for cards that
   *  carry a `cardsBought` effect, and `stepProgress` only reads it for those too). Being a BoardCard field it
   *  saves, restores and survives combat like any other per-instance accrual — which is what "per run" needs.
   *  Golden doubles the charges, not the payout: nine is the card's identity.
   *
   *  "Of the same tier" reads the BOUGHT minion's tier, not the tavern tier — buying down still pays out at
   *  what you bought. If the pool has no spell at that tier the trigger is spent on nothing rather than
   *  silently sliding to another tier (the card promises a tier, and a run whose set has no T5 spell should
   *  show that honestly). */
  onBuyGrantSpellSameTier: (ctx, self, params, payload) => {
    const charges = num(params.charges, 9) * gold(self);
    const used = self.buyTick ?? 0;
    if (used >= charges) return;
    const tier = CARD_INDEX[payload.minion.cardId]?.tier;
    if (typeof tier !== 'number') return;
    self.buyTick = used + 1; // the charge is spent on the TRIGGER, even if the tier has no spell to give
    const pool = poolOf(ctx.state).spells.filter((c) => c.tier === tier);
    if (pool.length === 0) return;
    conjureToHand(ctx.state, pool, num(params.count, 1));
  },

  /** STONEHORN ARCHIVIST — "At the end of every SECOND turn, get a plain copy of the LEFT-MOST card in your hand."
   *
   *  Bellringer Voss's cadence, aimed at the HAND instead of the board — same `eotTick` discipline, which is
   *  the part that's easy to get wrong: the tick advances ONCE per turn (on proc 0), so a Chronos repeat pays
   *  an extra copy on the cadence turn without speeding the count up, and a Djinn replay lands on the turn it
   *  would naturally fire. "Plain" = a fresh card from the index, so buffs and golden are deliberately dropped.
   *  A Ruby in slot 0 is skipped — its whole value is the stats baked in at mint, which a plain copy wouldn't
   *  carry — and the scan falls through to the first ordinary card. Golden copies the two left-most. */
  endOfTurnCopyLeftmostHandCard: (ctx, self, params, payload) => {
    const every = Math.max(1, num(params.every, 2));
    const replay = payload.replay === true;
    if (!replay && num(payload.proc, 0) === 0) self.eotTick = (self.eotTick ?? 0) + 1;
    const tick = self.eotTick ?? 0;
    const due = replay ? (tick + 1) % every === 0 : tick % every === 0;
    if (!due) return;
    const defs = ctx.state.hand
      .map((c) => CARD_INDEX[c.cardId])
      .filter((d): d is CardDef => !!d && !d.ruby)
      .slice(0, gold(self));
    for (const d of defs) conjureToHand(ctx.state, [d], 1);
  },

  /** SKYBOUND ASCENDANT — "End of Turn: transform the minion to the LEFT into a random minion from ONE TIER
   *  HIGHER, up to Tier 7."
   *
   *  Strange Revision's transform (base swaps, gained stats ride along), stepped UP a tier and clamped to the
   *  run's own ceiling — `maxTierFor` / `hasTier7Access`, so Tier 7 is only ever reachable on a Summit run and
   *  a non-Summit board tops out at 6. A neighbour already at the ceiling re-rolls at the ceiling rather than
   *  doing nothing, which keeps the effect a reroll at the top of the curve instead of a dead line.
   *  Golden walks the two minions to the left. */
  endOfTurnTransformLeftTierUp: (ctx, self) => {
    const ceiling = hasTier7Access(ctx.state) ? 7 : maxTierFor(ctx.state.rift);
    const i = ctx.state.board.indexOf(self);
    if (i <= 0) return;
    for (let n = 0; n < gold(self); n++) {
      const target = ctx.state.board[i - 1 - n];
      if (!target) return;
      const oldDef = CARD_INDEX[target.cardId];
      if (!oldDef) return;
      const want = Math.min(ceiling, oldDef.tier + 1);
      const pool = poolOf(ctx.state).buyable.filter(
        (c) => c.tier === want && c.id !== target.cardId && (c.tribe === 'neutral' || ctx.state.tribes.includes(c.tribe)),
      );
      if (pool.length === 0) continue;
      const rng = makeRng(ctx.state.rngCursor);
      const newDef = pool[rng.int(pool.length)]!;
      ctx.state.rngCursor = rng.state();
      const bonusA = target.attack - oldDef.attack; // whatever it had gained above its old base rides along
      const bonusH = target.health - oldDef.health;
      target.cardId = newDef.id;
      target.tribe = newDef.tribe;
      target.attack = newDef.attack + bonusA;
      target.health = newDef.health + bonusH;
    }
  },

  /** ARCANE BEHEMOTH — "When you sell a Demon, this gains its stats." (owner rework 2026-08-20)
   *
   *  The WATCHER side of a sale (`minionSold`), so the reactor is a bystander rather than the card leaving —
   *  `fireOnMinionSold` hands every board minion the sold body as `payload.target`, and it fires AFTER the
   *  card has left the board, so a Behemoth selling ITSELF can't pay itself.
   *
   *  "A Demon" is `isTribe`, the one membership test in the codebase — which is what makes a second tribe and
   *  a `universalTribe` ("All types") body count, per the owner's note. The stats gained are the sold body's
   *  LIVE stats (buffs included), not its printed base: what you sell is what it eats. Golden doubles the
   *  meal, the house convention for a "gains its stats" payoff. */
  minionSoldDemonGainStats: (ctx, self, params, payload) => {
    const sold = payload.target;
    if (!sold || sold.uid === self.uid) return;
    const tribe = (typeof params.tribe === 'string' ? params.tribe : 'demon') as Tribe;
    if (!isTribe(sold, tribe)) return;
    const a = Math.max(0, sold.attack) * gold(self);
    const h = Math.max(0, sold.health) * gold(self);
    if (a === 0 && h === 0) return;
    addBuff(self, nameOf(self), a, h);
  },
};

/** DOC BOT — the recruit dispatch surface, as data. Every recruit-side trigger site looks a factory up with
 *  `RECRUIT_FACTORIES[effect.do]?.(...)`, so an id that is missing here is a SILENT NO-OP, not an error — the
 *  exact shape of the Conductor-in-combat and Funeral-on-Loan bugs (owner reports 2026-08-26). Doc Bot's
 *  `factoryPhase.test.ts` walks content against this set + the combat `FACTORIES` keys and fails on any
 *  (trigger, factory) pair that has no implementation in a phase where that trigger dispatches and no
 *  registered excuse. Export the KEYS only — the functions stay private. */
export const RECRUIT_FACTORY_IDS: ReadonlySet<string> = new Set(Object.keys(RECRUIT_FACTORIES));

/**
 * ANCIENT WANDERER's sync — see `goldSpentScaleSelf`.
 *
 * Recomputes ONE body's "+A/+H per N Gold spent this run" and lands only the difference, so calling it twice
 * is a no-op. Keyed on a fixed buff source (the card's name) so `addBuff`'s per-source accumulator IS the
 * record of what has already been granted — no extra per-instance field to persist.
 */
function syncGoldSpentScaler(state: RunState, card: BoardCard, params: Record<string, unknown>): void {
  const per = Math.max(1, num(params.per, 3));
  const steps = Math.floor(Math.max(0, state.goldSpent) / per);
  const wantA = steps * num(params.attack, 1) * gold(card);
  const wantH = steps * num(params.health, 1) * gold(card);
  const source = nameOf(card);
  const had = card.buffs?.find((b) => b.source === source);
  const dA = wantA - (had?.attack ?? 0);
  const dH = wantH - (had?.health ?? 0);
  if (dA === 0 && dH === 0) return;
  // `count` 1 the first time, 0 after: this is ONE standing enchant being resized, not a new stack each spend,
  // so the inspect breakdown reads "Ancient Wanderer +12/+12" rather than a wall of identical rows.
  addBuff(card, source, dA, dH, had ? 0 : 1);
}

/**
 * Bring every `goldSpentScaleSelf` body on the board up to the run's current spend. Called from the two
 * moments its value can change: a Gold spend (`applyGoldSpent`) and a minion ARRIVING (`fire`'s `onSummon`),
 * which is what makes the card read "for every 3 Gold you HAVE spent" rather than "since it arrived".
 */
export function syncGoldSpentScalers(state: RunState): void {
  for (const card of state.board) {
    const eff = CARD_INDEX[card.cardId]?.effects.find((e) => e.do === 'goldSpentScaleSelf');
    if (eff) syncGoldSpentScaler(state, card, eff.params ?? {});
  }
}

/**
 * ANCIENT WANDERER's live value — the number its text has to print (the hard live-text rule). Exported from
 * sim so the UI's `cardText` chain can read it without duplicating the formula. `goldSpent` is the RUN total.
 */
export function goldSpentScalerValue(cardId: string, goldSpent: number, golden = false): { bonus: number; per: number; toNext: number } | null {
  const eff = CARD_INDEX[cardId]?.effects.find((e) => e.do === 'goldSpentScaleSelf');
  if (!eff) return null;
  const per = Math.max(1, num(eff.params?.per, 3));
  const g = Math.max(0, goldSpent);
  return { bonus: Math.floor(g / per) * num(eff.params?.attack, 1) * (golden ? 2 : 1), per, toNext: per - (g % per) };
}

/**
 * Fire `goldSpent` effects (Acid, Banksly) when the player spends Gold. Each board card with a `goldSpent`
 * effect keeps a continuous per-instance meter (`goldTick`): every `amount` Gold spent accrues onto it, and
 * each time it crosses the effect's `every` threshold the factory fires once (the remainder carries to the
 * next spend). A single big spend can cross the threshold several times. Called by the reducer at every Gold
 * spend point (buy / roll / tier up / buy a spell).
 */
export function applyGoldSpent(state: RunState, amount: number): void {
  if (amount <= 0) return;
  advanceRuneThresholds(state, 'gold', amount);
  // Rune of the Brew: every SPEND (however large) pours one +4/+3 onto a seeded-random friendly Dwarf.
  if (state.runeBrew) {
    procRune(state, 'runeBrew');
    const dwarves = state.board.filter((c) => isTribe(c, 'dwarf'));
    if (dwarves.length > 0) {
      const rng = makeRng(state.rngCursor);
      const pick = dwarves[rng.int(dwarves.length)]!;
      state.rngCursor = rng.state();
      captureBuffFx(state, undefined, 'spell', () => addBuff(pick, 'Rune of the Brew', 4, 3));
    }
  }
  const ctx = makeContext(state);
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    const effect = def?.effects.find((e) => e.on === 'goldSpent');
    if (!effect) continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    const every = Math.max(1, num(effect.params?.every, 7));
    card.goldTick = (card.goldTick ?? 0) + amount;
    while (card.goldTick >= every) {
      card.goldTick -= every;
      fn(ctx, card, effect.params ?? {}, { minion: card });
    }
  }
  // Ancient Wanderer: a "HAS +A/+H per N Gold spent" body is re-synced to the new run total. Not a threshold
  // handler (it isn't a `goldSpent` effect at all) — see `syncGoldSpentScalers`.
  syncGoldSpentScalers(state);
}

/**
 * Fire `cardsBought` effects (Korok, Banksly) when the player buys a card. The buy-count sibling of
 * `applyGoldSpent`: each board card with a `cardsBought` effect keeps a continuous per-instance meter
 * (`buyTick`), and each time it crosses the effect's `every` threshold the factory fires once (the remainder
 * carries to the next buy). Called by the reducer on every `buy`.
 */
/**
 * The PLAY-count meter — `applyCardsBought`'s twin, for "after you play N cards" (Mountainbond).
 *
 * The tally is CUMULATIVE across the run (`playTick` on the card, mirroring `buyTick`), not per-turn: the card
 * reads "after you play 8 cards", and `playedThisTurn` clears every turn so it could never reach 8 on a normal
 * curve. A run total is also kept on the state for live card text.
 */
/**
 * The player played a CHOOSE ONE card (Ruby Roach).
 *
 * A sibling of `applyCardsPlayed` rather than a parameter on it: that function is handed a COUNT and nothing
 * else, deliberately — every consumer of it cares how many cards were played, not which. Ruby Roach is the
 * first effect that needs the identity, so it gets its own signal instead of widening a shared one and
 * making every existing caller pass something it does not have.
 *
 * Fired from the same place, so "played" means exactly what it means for the play-count meter: a real play,
 * after the fizzle checks, once per card.
 */
export function applyChooseOnePlayed(state: RunState, def: CardDef): void {
  if (!def.chooseOne?.length) return;
  const ctx = makeContext(state);
  for (const card of [...state.board]) {
    const cd = CARD_INDEX[card.cardId];
    if (!cd) continue;
    for (const eff of cd.effects) {
      if (eff.on !== 'chooseOnePlayed') continue;
      RECRUIT_FACTORIES[eff.do]?.(ctx, card, eff.params ?? {}, { minion: card });
    }
  }
}

export function applyCardsPlayed(state: RunState, count: number): void {
  if (count <= 0) return;
  state.cardsPlayedTotal = (state.cardsPlayedTotal ?? 0) + count;
  advanceRuneThresholds(state, 'cardsPlayed', count); // Rune of Mountain Trade: every 6 cards played, Ruby the board
  // Rune of the Glider: every card you play pumps a Dragon. Random among your Dragons (seeded off the run
  // cursor like every other random pick) and wrapped for FX so the gain descends onto the body rather than the
  // number jumping. A no-op with no Dragon out — the rune simply waits for one.
  const glider = state.runeGlider;
  if (glider) {
    for (let i = 0; i < count; i++) {
      const dragons = state.board.filter((c) => isTribe(c, 'dragon'));
      if (dragons.length === 0) break;
      const rng = makeRng(state.rngCursor);
      const pick = dragons[rng.int(dragons.length)]!;
      state.rngCursor = rng.state();
      procRuneId(state, 'rune_glider');
      captureBuffFx(state, undefined, 'spell', () => addBuff(pick, 'Rune of the Glider', glider.attack, glider.health));
    }
  }
  const ctx = makeContext(state);
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    const effect = def?.effects.find((e) => e.on === 'cardsPlayed');
    if (!effect) continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    const every = Math.max(1, num(effect.params?.every, 8));
    card.playTick = (card.playTick ?? 0) + count;
    while (card.playTick >= every) {
      card.playTick -= every;
      fn(ctx, card, effect.params ?? {}, { minion: card });
    }
  }
}

export function applyCardsBought(state: RunState, count: number): void {
  if (count <= 0) return;
  advanceRuneThresholds(state, 'cardsBought', count);
  const ctx = makeContext(state);
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    const effect = def?.effects.find((e) => e.on === 'cardsBought');
    if (!effect) continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    const every = Math.max(1, num(effect.params?.every, 4));
    card.buyTick = (card.buyTick ?? 0) + count;
    while (card.buyTick >= every) {
      card.buyTick -= every;
      fn(ctx, card, effect.params ?? {}, { minion: card });
    }
  }
}

/** Open a Discover of up to 3 distinct random spells (Black Belt Brian). Sets `state.discover`; the
 *  reducer's `discover` case resolves the pick into the hand and opens the next queued spec, if any. */
/** Spells a "Discover a spell" may NEVER offer (owner 2026-07-27). Not a balance filter — these are spells
 *  whose value depends on board state a Discover can't guarantee, so offering them is a dead pick. Keep the
 *  reason with the entry; an unexplained id here becomes folklore. */
const DISCOVER_EXCLUDED_SPELLS: ReadonlySet<string> = new Set([
  'resonance', // owner call: Black Belt Brian can no longer Discover it
]);

export function offerSpellDiscover(state: RunState): void {
  const rng = makeRng(state.rngCursor);
  const avail = poolOf(state).spells.filter((c) => c.tier <= state.tier && !DISCOVER_EXCLUDED_SPELLS.has(c.id));
  const picks: string[] = [];
  for (let i = 0; i < 3 && avail.length > 0; i++) picks.push(avail.splice(rng.int(avail.length), 1)[0]!.id);
  state.rngCursor = rng.state();
  if (picks.length > 0) state.discover = picks;
}

/** Whether a card has a Battlecry (an onPlay effect). Choose One is its OWN keyword, not a Battlecry —
 *  so it doesn't count for Drakko's quest or Help Wanted's Discover-a-Battlecry filter. */
export function hasBattlecry(c: CardDef): boolean {
  // `SILENT_ONPLAY` excludes internal setup effects that carry no printed Shout (Living Grimoire's arming) —
  // see the note on that set. Applied here so every consumer agrees: Karwind's trigger, Ryme's re-fire target,
  // Rune of Bartering's discount and the "get a Shout minion" pools.
  return c.effects.some((e) => e.on === 'onPlay' && !SILENT_ONPLAY.has(e.do));
}

/** Whether a card has a Deathrattle (an `onDeath` effect whose factory is a `deathrattle*`). Mirrors the
 *  combat-side check — friend-death watchers (Brood Matron) don't count as Deathrattles. */
export function hasDeathrattle(c: CardDef): boolean {
  return c.effects.some((e) => e.on === 'onDeath' && e.do.startsWith('deathrattle'));
}

/** Resolve a `DiscoverSpec`'s string filter id back to a card predicate (closures aren't serializable). */
function discoverFilter(id: 'battlecry' | 'deathrattle'): (c: CardDef) => boolean {
  if (id === 'battlecry') return hasBattlecry;
  if (id === 'deathrattle') return hasDeathrattle;
  return () => true;
}

/**
 * Offer a Discover (3 distinct, pool-filtered cards), weighing every eligible card EVENLY — no high-tier
 * bias, the same rule as the flattened shop + spell Discover. Modes via `opts`:
 *   • default (Sea Urchin, Help Wanted): all cards UP TO `discoverTier`, uniform.
 *   • `tier` fixed (Sprout → 1): exactly that tier, uniform.
 *   • `topTierFirst` — the ONE high-tier exception, set only by the golden/triple reward ("peek one tier
 *     up"): fill from the top tier down, walking the floor down only if the top tier can't supply 3.
 * A card `filter` (Help Wanted → Battlecry minions) and `tribe`/`exclude` (Sea Urchin → Beasts, not itself)
 * apply in every mode.
 */
export function offerDiscover(
  state: RunState,
  discoverTier: number,
  opts?: { tier?: number; filter?: (c: CardDef) => boolean; tribe?: Tribe; tribes?: Tribe[]; exclude?: string; topTierFirst?: boolean; maxTier?: number },
): void {
  const baseFilter = opts?.filter ?? (() => true);
  const tribe = opts?.tribe;
  const tribes = opts?.tribes; // Wayfinder: a SET of tribes (spread across every uncontrolled tribe), not one
  const exclude = opts?.exclude;
  // Tribe-filtered Discover (Sea Urchin → Beasts only): AND the tribe check into the card filter so both
  // the fixed-tier and tiered pool branches below pick it up (dual-types count). `tribes` (plural) admits a
  // card matching ANY of the listed tribes. `exclude` drops the source card (Sea Urchin can't Discover itself).
  const filter = (c: CardDef): boolean =>
    baseFilter(c) && c.id !== exclude &&
    (!tribe || c.tribe === tribe || c.tribe2 === tribe) &&
    (!tribes || tribes.length === 0 || tribes.some((t) => c.tribe === t || c.tribe2 === t));
  let pool: readonly CardDef[] = [];
  if (opts?.tier !== undefined) {
    // Fixed-tier Discover (Sprout): exactly that tier, no floor-walking.
    pool = poolOf(state).buyable.filter(
      (c) =>
        c.tier === opts.tier &&
        (c.tribe === 'neutral' || state.tribes.includes(c.tribe)) &&
        (state.pool[c.id] ?? 0) > 0 &&
        filter(c),
    );
  } else if (opts?.topTierFirst) {
    // Golden/triple reward only ("peek one tier up"): bias to the highest tier — fill from the top tier
    // down, walking the floor down only if the top tier can't supply 3. The single high-tier exception.
    const target = Math.min(opts?.maxTier ?? maxTierFor(state.rift), discoverTier); // Summit / maxTier: ceiling can be 7
    let floor = target;
    while (pool.length < 3 && floor >= 1) {
      pool = poolOf(state).buyable.filter(
        (c) =>
          c.tier <= target &&
          c.tier >= floor &&
          (c.tribe === 'neutral' || state.tribes.includes(c.tribe)) &&
          (state.pool[c.id] ?? 0) > 0 &&
          filter(c),
      );
      floor--;
    }
  } else {
    // Card-driven Discover up to the tavern tier (Sea Urchin, Help Wanted): EVERY eligible card at or below
    // the target tier, weighed EVENLY — no high-tier bias (same rule as the shop + spell Discover).
    const target = Math.min(opts?.maxTier ?? maxTierFor(state.rift), discoverTier); // Summit / maxTier: ceiling can be 7
    pool = poolOf(state).buyable.filter(
      (c) =>
        c.tier <= target &&
        (c.tribe === 'neutral' || state.tribes.includes(c.tribe)) &&
        (state.pool[c.id] ?? 0) > 0 && // only offer cards with copies left — Discover draws from the finite pool
        filter(c),
    );
  }
  if (pool.length === 0) return;
  const rng = makeRng(state.rngCursor);
  const avail = [...pool];
  const picks: string[] = [];
  for (let i = 0; i < 3 && avail.length > 0; i++) {
    picks.push(avail.splice(rng.int(avail.length), 1)[0]!.id);
  }
  state.rngCursor = rng.state();
  state.discover = picks;
}

/** Open one Discover described by `spec` — a spell Discover or a (tiered / fixed-tier / filtered) minion
 *  Discover. The single place a `DiscoverSpec` becomes a live `state.discover` offer. */
export function openDiscover(state: RunState, spec: DiscoverSpec): void {
  // TUTORIAL tribe lock: the course teaches one tribe, so every minion Discover it opens stays in that tribe
  // (a Triple Reward offering a random off-tribe minion taught the player nothing). Applied HERE because this
  // is where every Discover — `discoverOnPlay`, an effect, a queued one — actually becomes an offer.
  if (state.tutorialDiscoverTribe && spec.kind === 'minion' && !spec.tribe) {
    spec = { ...spec, tribe: state.tutorialDiscoverTribe };
  }
  if (spec.kind === 'spell') {
    offerSpellDiscover(state);
  } else if (spec.kind === 'pool') {
    // Discover from an explicit card-id pool (Second Path). Offer up to 3 distinct, real cards.
    // Spells are excluded because the pool Discover was built for MINIONS — except GIFTS (owner design
    // 2026-08-26), which are spells by nature and are offered as a class by Merry Christmas and Kindness.
    // Without this exemption a Gift Discover filtered itself to empty and silently never opened.
    const pool = spec.ids.filter((id) => CARD_INDEX[id] && (!CARD_INDEX[id]!.spell || CARD_INDEX[id]!.gift));
    if (pool.length === 0) return;
    const rng = makeRng(state.rngCursor);
    const avail = [...pool];
    const picks: string[] = [];
    for (let i = 0; i < 3 && avail.length > 0; i++) picks.push(avail.splice(rng.int(avail.length), 1)[0]!);
    state.rngCursor = rng.state();
    state.discover = picks;
    state.discoverLockTier = undefined;
    state.discoverGolden = undefined;
    state.discoverLockGold = undefined;
    state.discoverLockWave = undefined;
    state.discoverBorrowed = spec.borrowed; // Rival's Reflection never borrows; kept generic
  } else {
    offerDiscover(state, spec.tier, {
      tier: spec.exactTier,
      tribe: spec.tribe,
      tribes: spec.tribes,
      exclude: spec.exclude,
      filter: spec.filter ? discoverFilter(spec.filter) : undefined,
      topTierFirst: spec.topTierFirst,
      maxTier: spec.maxTier,
    });
    // Disco Dan's Setlist: carry the lock tier onto the open offer so the resolved pick becomes a
    // locked hand card (only set if the offer actually opened). Hourglass Reserve (`lockWave`) + Funeral on Loan
    // (`borrowed`) ride the same lifecycle.
    if (state.discover) { state.discoverLockTier = spec.lockTier; state.discoverGolden = spec.golden; state.discoverLockGold = spec.lockGold; state.discoverLockWave = spec.lockWave; state.discoverBorrowed = spec.borrowed; state.discoverSetStats = spec.setStats; }
    else { state.discoverLockTier = undefined; state.discoverGolden = undefined; state.discoverLockGold = undefined; state.discoverLockWave = undefined; state.discoverBorrowed = undefined; state.discoverSetStats = undefined; }
  }
}

/**
 * (BOTH) — is EVERY branch of this Choose One already enabled for this instance?
 *
 * THE SINGLE PREDICATE for that rule, and every consumer reads it (owner ruling 2026-08-28): the reducer's
 * play/resolve paths, the live-text chains, and the drag gesture. Three independent sources grant "both"
 * today and they used to be spelled out separately at each site, which is exactly how a rule forks —
 * `chooseBothWhenGolden` was honoured only at the PICK (the prompt still opened), the Unbroken Vein already
 * skipped the prompt, and Facetwright's rune did neither.
 *
 *  - `chooseBothWhenGolden` on a GOLDEN instance (Orivax, "Gilded: Gain both"),
 *  - Rune of Facetwright on `facetwright` ("they give both effects"),
 *  - Rune of the Unbroken Vein on `k_veinbreaker`.
 *
 * When it is true the prompt is SKIPPED ENTIRELY — playing the card just does both branches (and still aims
 * first if the card targets) — and the printed text swaps its "Choose One:" label for a coloured (Both)
 * followed by both option texts, so the card reads as exactly what it will do.
 */
export function chooseBothActive(
  state: Pick<RunState, 'runeFacetwright' | 'runeUnbrokenVein' | 'chooseBothCharges'>,
  card: { golden?: boolean } | undefined,
  def: Pick<CardDef, 'id' | 'chooseOne' | 'chooseBothWhenGolden'> | undefined,
): boolean {
  if (!def?.chooseOne?.length) return false;
  if (card?.golden && def.chooseBothWhenGolden) return true;
  if (state.runeFacetwright && def.id === 'facetwright') return true;
  if (state.runeUnbrokenVein && def.id === 'k_veinbreaker') return true;
  // Forked Crown / Prismpick Artificer: a charge makes the NEXT Choose One resolve both branches, whatever
  // card it is. Read-only here — the charge is spent by `spendChooseBothCharge` at the moment a play
  // actually resolves, so merely LOOKING at a card (the UI asking whether it will prompt) cannot burn one.
  if ((state.chooseBothCharges ?? 0) > 0) return true;
  return false;
}

/** Spend one BOTH charge, if the reason this card resolved both branches was a charge rather than a rune or
 *  its own gilding. Called from the play paths, never from the predicate — see the note above. */
export function spendChooseBothCharge(
  state: Pick<RunState, 'runeFacetwright' | 'runeUnbrokenVein' | 'chooseBothCharges'>,
  card: { golden?: boolean } | undefined,
  def: Pick<CardDef, 'id' | 'chooseOne' | 'chooseBothWhenGolden'> | undefined,
): void {
  if ((state.chooseBothCharges ?? 0) <= 0) return;
  // A card that would resolve both ANYWAY (golden Orivax, Facetwright/Veinbreaker under their runes) must not
  // eat a charge it never needed.
  const wouldAnyway = (card?.golden && def?.chooseBothWhenGolden)
    || (state.runeFacetwright && def?.id === 'facetwright')
    || (state.runeUnbrokenVein && def?.id === 'k_veinbreaker');
  if (wouldAnyway) return;
  state.chooseBothCharges = (state.chooseBothCharges ?? 0) - 1;
}

/** Does playing this card have to STOP and ask? True for a Choose One whose branches are not already all
 *  enabled — the gate the reducer defers the play behind, and the one the UI reads so a targeted Choose One
 *  no longer demands its target during the drag. */
export function chooseOneNeedsChoice(
  state: Pick<RunState, 'runeFacetwright' | 'runeUnbrokenVein'>,
  card: { golden?: boolean } | undefined,
  def: Pick<CardDef, 'id' | 'chooseOne' | 'chooseBothWhenGolden'> | undefined,
): boolean {
  return !!def?.chooseOne?.length && !chooseBothActive(state, card, def);
}

/**
 * Every recruit-phase modal that OWNS the screen. Each renders as its own overlay behind an INDEPENDENT
 * guard in `Recruit.tsx` (`{run.discover && …}`, `{run.questOffer && …}`, …) with no mutual exclusion, so
 * two open at once are literally drawn on top of each other — which is exactly what the owner hit on
 * 2026-07-22 (two start-of-turn Discovers stacked). Anything that raises a Discover must therefore QUEUE
 * behind an open modal rather than opening over it. This is the single source of truth for "is the screen
 * already owned"; the reducer's action gate reads it too.
 */
export function modalOpen(state: RunState): boolean {
  return !!(state.discover || state.chooseOne || state.pendingTarget || state.questOffer || state.powerOffer || state.runeforgeOffer || state.scoutedNextOpponent?.length);
}

/**
 * Open a Discover for `spec` now, or queue it if a modal is already open. The backbone for stacking
 * Discovers: a Drakko-doubled Black Belt Brian, a golden Brian, and Yazzus-multiplied Help Wanted /
 * Sprout all route every extra Discover through here. The `discover` case shifts the queue forward
 * as each pick resolves, so the offers appear one at a time in order.
 *
 * It defers to ANY open modal, not just an open Discover: a quest reward or rune reward can raise a
 * Discover while the Runeforge or a quest offer still owns the screen, and opening on top of one stacks
 * two overlays. **Every path that raises a Discover must come through here** — a direct `openDiscover`
 * overwrites `state.discover` unconditionally, which either stacks the overlay or silently eats the offer
 * it replaced.
 */
/**
 * Resolve a card's `discoverOnPlay` data into a concrete minion Discover spec against the live run. Shared by
 * the reducer's play path and by the Mage-Pup's taught-spell Shout, so a Discover spell offers the SAME thing
 * however it's cast — the Pup used to bypass this entirely and a taught Beyond the Summit did nothing at all
 * (owner report 2026-07-24). `grantedTier` freezes a triple-reward Discover at the tier it was granted.
 */
/**
 * The spell a Mage-Pup was taught, when that spell needs a TARGET — i.e. when playing this Pup should open the
 * aim picker rather than resolving immediately (owner 2026-07-24: "when a mage pup is taught a spell that
 * targets a minion, they should be able to target a minion when played").
 *
 * This is a PER-INSTANCE question, which is why it can't ride the usual `def.target === 'friendly'` check: the
 * Mage-Pup CardDef is untargeted, and whether a given Pup needs an aim depends on the spell on its instance.
 * Returns undefined for every other card, an untaught Pup, or a taught spell that needs no target.
 */
export function taughtAimSpell(card: BoardCard): CardDef | undefined {
  if (card.cardId !== 'b2_magepup' || !card.taughtSpellId) return undefined;
  const spell = CARD_INDEX[card.taughtSpellId];
  if (!spell?.spell) return undefined;
  // 'any' spells can also hit a TAVERN OFFER when cast from hand; a deferred Battlecry aim resolves against the
  // board only (`applyBattlecryTarget` takes a BoardCard), so a taught 'any' spell aims at your board. Called
  // out rather than silently narrowed — widening it means teaching the pendingTarget path about shop offers.
  return spell.target === 'friendly' || spell.target === 'any' ? spell : undefined;
}

/** The friendly a TAUGHT aimed spell lands on: a seeded-random board minion (deterministic — it advances the
 *  run's RNG cursor), or `undefined` when the board is empty so the caller can fizzle. Untargeted spells get
 *  `undefined` and cast normally. Same rule as Rune of Recurrence / Runic Archivist. */
function pickTaughtTarget(state: RunState, def: CardDef): BoardCard | undefined {
  if (!def.target || state.board.length === 0) return undefined;
  const rng = makeRng(state.rngCursor);
  const pick = state.board[rng.int(state.board.length)]!;
  state.rngCursor = rng.state();
  return pick;
}

export function discoverSpecFor(state: RunState, def: CardDef, grantedTier?: number): DiscoverSpec | undefined {
  const dop = def.discoverOnPlay;
  if (!dop) return undefined;
  if (dop.spell) return { kind: 'spell' };
  // `exactCurrentTier` (Key Findings) locks the pool to the live tavern tier; `exactTier` is a fixed tier
  // (Sprout); otherwise the offer tier is current + `tierOffset`.
  const exactTier = dop.exactCurrentTier ? state.tier : dop.exactTier;
  const baseTier = grantedTier ?? state.tier;
  const tier = exactTier ?? baseTier + (dop.tierOffset ?? 0);
  const tribe = dop.tribe === 'dominant' ? (dominantBoardTribe(state) ?? undefined) : dop.tribe;
  return {
    kind: 'minion' as const,
    tier,
    ...(exactTier !== undefined ? { exactTier } : {}),
    ...(dop.filter ? { filter: dop.filter } : {}),
    ...(tribe ? { tribe } : {}),
    ...(dop.topTierFirst ? { topTierFirst: true } : {}),
    // Beyond the Summit asks for `maxTier: 7`, but a run with no Tier-7 ACCESS may not be offered one
    // (owner 2026-07-28). Clamp here, at the single place a `discoverOnPlay` becomes a real spec, so the gate
    // can't be routed around by a future card that also reaches for tier 7.
    ...(dop.maxTier !== undefined
      ? { maxTier: dop.maxTier >= 7 && !hasTier7Access(state) ? maxTierFor(state.rift) : dop.maxTier }
      : {}),
    ...(dop.lockUntilNextTurn ? { lockWave: state.wave + 1 } : {}), // Hourglass Reserve: locked until next turn
    ...(dop.borrowed ? { borrowed: true } : {}), // Funeral on Loan: play -> trigger Echo + destroy
  };
}

export function queueDiscover(state: RunState, spec: DiscoverSpec): void {
  if (modalOpen(state)) {
    (state.discoverQueue ??= []).push(spec);
  } else {
    openDiscover(state, spec);
    // Defensive: if the offer couldn't open (empty pool), don't strand a queue behind a closed Discover.
    if (!state.discover && state.discoverQueue && state.discoverQueue.length > 0) {
      const nextSpec = state.discoverQueue.shift()!;
      queueDiscover(state, nextSpec);
    }
  }
}

/**
 * Total +X/+X bonus applied to stat-granting spells, from every active source (the Spellbinder hero
 * now; spell-buffing cards later just add here). This is the SINGLE source of truth — the reducer
 * applies it (`spellBuffTarget`) and the UI displays it (`spellDisplayText`), so a spell card always
 * shows its real value. New spell-buff effects should fold into this one function.
 */
export function spellStatBonus(state: RunState): number {
  let bonus = 0;
  if (hasPower(state, 'spellAmplify')) bonus += spellAmplifyBonus(state.spellsCast);
  // Rune of the Crown: once the run has cast `per` Shop spells, every spell gives an extra +A/+H. A flat step
  // (not per-`per`), matching the sheet's "after you cast 6". Symmetric, so it lives in the SHARED helper —
  // both spellAttackBonus and spellHealthBonus read it, exactly like the hero amplify above.
  const crown = state.runeCrown;
  if (crown && state.spellsCast >= crown.per) bonus += crown.attack;
  // Spell-power auras: +1/+1 per `def.spellAura` point on a board card (golden ×2 — no card in the current
  // set carries it), PLUS any aura welded onto a host Mech (`spellAuraBonus`, set by `applyWeld`). Generic
  // over `def.spellAura` so future aura cards fold in automatically.
  for (const c of state.board) {
    bonus += (CARD_INDEX[c.cardId]?.spellAura ?? 0) * (c.golden ? 2 : 1) + (c.spellAuraBonus ?? 0);
  }
  return bonus;
}

/**
 * The total +Attack a stat-granting spell gains: the hero's symmetric amplify (`spellStatBonus`) PLUS
 * the run-wide card-driven spell ATTACK bonus (`spellBonus.attack` — Skullblade). The single source of
 * truth for a spell's bonus Attack; the cast factories add this to the spell's Attack, and the display
 * mirrors it. Optional-chained for old saves.
 */
export function spellAttackBonus(state: RunState): number {
  return spellStatBonus(state) + (state.spellBonus?.attack ?? 0);
}

/**
 * The total +Health a stat-granting spell gains: the hero's symmetric amplify PLUS the run-wide
 * card-driven spell HEALTH bonus (`spellBonus.health` — Cinderwing Matron). Sibling of
 * `spellAttackBonus` for the Health stat.
 */
export function spellHealthBonus(state: RunState): number {
  return spellStatBonus(state) + (state.spellBonus?.health ?? 0);
}

/**
 * A spell's display text with its stat value updated to reflect spell power (and highlighted green via
 * `{{…}}`). `bonusA` is the +Attack bonus; `bonusH` the +Health bonus (defaults to `bonusA` so existing
 * symmetric callers — and the hero amplify — read `spellDisplayText(id, bonus)` unchanged). Returns the
 * base text for non-stat spells or a zero bonus. Convention: a stat spell's text shows "+A/+B" matching
 * its `spellBuffTarget` params, so it can be substituted.
 */
export function spellDisplayText(cardId: string, bonusA: number, escalation = 0, bonusH = bonusA, goldSpent = 0, escalationH = escalation, goldPouchValue = 0, extra?: { rubyBonus?: { attack: number; health: number }; playedThisTurn?: string[]; tier?: number; topTribe?: Tribe | null; growthBonus?: number; juggler?: boolean }): string {
  const def = CARD_INDEX[cardId];
  if (!def) return '';
  // A RUBY itself reads live: base 1/1 + the run's `rubyBonus`. Needed since hovering any card that mentions
  // Rubies now previews the Ruby (owner 2026-07-25) — a preview promising "+1/+1" while the real Ruby grants
  // +3/+3 would be exactly the stale-number defect the live-text rule exists to prevent.
  if (def.ruby) {
    const rb = extra?.rubyBonus ?? { attack: 0, health: 0 };
    return rb.attack > 0 || rb.health > 0 ? def.text.replace('+1/+1', `{{+${1 + rb.attack}/+${1 + rb.health}}}`) : def.text;
  }
  // Rune of Living Growth: the Growth spell's printed value must track its accrual (the live-text rule) —
  // same shape as the Ruby line above. Spell power on top is already folded in by the generic path below
  // for spells routed through bonusA; Growth's whole magnitude lives here instead, base + accrual + power.
  if (def.id === 'growth' && (extra?.growthBonus ?? 0) > 0) {
    const g = 1 + (extra!.growthBonus ?? 0);
    return def.text.replace('+1/+1', `{{+${g + bonusA}/+${g + bonusH}}}`);
  }
  // Ruby Shipment: "your most common type" resolves against the CURRENT board, so it names the type it would
  // actually hand over right now (audit 2026-07-31 — a grant whose target shifts with cards played must say
  // what it is giving). Absent a board (or an all-neutral one) the printed text stands: there is no answer yet.
  // Reinforcing Ale (set 2) and Tribe Portal (set 1) both resolve "your most common type" against the current
  // board at play time — so both name the type they would give right now. (First landed on the wrong id:
  // a stale grep pinned this to Ruby Shipment; the live DOM check caught it printing on no card at all.)
  if ((def.id === 'wo_reinforcement' || def.id === 'tribeportal') && extra?.topTribe) {
    const label = extra.topTribe.charAt(0).toUpperCase() + extra.topTribe.slice(1);
    // Asterisks fully optional: set 2 bolds the phrase, set 1's Tribe Portal doesn't.
    return def.text.replace(/(?:\*\*)?most common (?:board )?type(?:\*\*)?/, (m0) => `${m0} ({{${label}}})`);
  }
  // Veinstorm: base 1/1 + the run's rubyBonus + spell power (owner ruling 2026-08-26: it folds like every
  // other stat-granting Shop spell) — green the printed +1/+1 once any part grows.
  if (def.id === 'veinstorm') {
    const rb = extra?.rubyBonus ?? { attack: 0, health: 0 };
    const a = 1 + rb.attack + bonusA;
    const h = 1 + rb.health + bonusH;
    return a > 1 || h > 1 ? def.text.replace('+1/+1', `{{+${a}/+${h}}}`) : def.text;
  }
  // Lantern Light — the grant is +Tier/+Tier PLUS spell power, but the printed "+1/+1 for each Tavern Tier"
  // showed neither. Same defect as Hoardflame, found by the spell-power audit (owner asked whether other
  // spells shared it — this was the only other one). Shows the live TOTAL, since the whole grant is derived.
  if (def.id === 'lanternlight' && extra?.tier) {
    const a = extra.tier + bonusA;
    const h = extra.tier + bonusH;
    // Replace the WHOLE rate clause, not just the number: injecting the total while leaving "for each Tavern
    // Tier" standing would read "+5/+4 for each Tavern Tier", which promises far more than it gives.
    return def.text.replace('**+1/+1** for each **Tavern Tier**', `{{+${a}/+${h}}}`);
  }
  // Hoardflame: +4/+4 base + spell power + 1/+1 per Dragon PLAYED this turn. This branch used to return before
  // the generic spell-power handling below, so a Spellbinder's bonus never showed (owner report 2026-07-26) —
  // it printed the base rate while the cast granted something else.
  if (def.id === 'hoardflame') {
    const eff = def.effects.find((e) => e.do === 'spellBuffPerDragonPlayed');
    const p = eff?.params as { attack?: number; health?: number; perAttack?: number; perHealth?: number; per?: number } | undefined;
    const baseA = Number(p?.attack ?? 4), baseH = Number(p?.health ?? 4);
    const perAttack = Number(p?.perAttack ?? p?.per ?? 1), perHealth = Number(p?.perHealth ?? p?.per ?? 1);
    const dragons = (extra?.playedThisTurn ?? []).filter((id) => {
      const d = CARD_INDEX[id];
      return !!d && (d.tribe === 'dragon' || d.tribe2 === 'dragon');
    }).length;
    // Spell power folds into BOTH the base and the per-Dragon rate (owner 2026-08-18). Green the base total AND
    // the live per-Dragon rate so the card always states what it will grant right now.
    const perA = perAttack + bonusA, perH = perHealth + bonusH;
    const a = baseA + bonusA + perA * dragons, h = baseH + bonusH + perH * dragons;
    let t = def.text;
    if (a > baseA || h > baseH) t = t.replace(`+${baseA}/+${baseH}`, `{{+${a}/+${h}}}`);
    if (bonusA > 0 || bonusH > 0) t = t.replace(`+${perAttack}/+${perHealth}`, `{{+${perA}/+${perH}}}`);
    return t;
  }
  // Rune of Pillaging: Gold Pouch reads its LIVE payout once the rune raises it ("Gain {{2 Gold}}.") —
  // the same value the cast actually grants (see the gainEmbers override above). Handled before the
  // spell-power early-return since the pouch scales without any spell power.
  if (def.id === 'emberpouch' && goldPouchValue > 1) return def.text.replace('**1 Gold**', `{{${goldPouchValue} Gold}}`);
  // Front to Back (escalating): the printed text carries TWO "+A/+H" groups — the GRANT (slot 0) and the per-cast
  // IMPROVEMENT (slot 1). Attack and Health scale INDEPENDENTLY (owner 2026-07-09): each stat's grant = its step +
  // its accumulated escalation (`escalation` / `escalationH`) + its spell power; each stat's improvement step = its
  // printed base + its spell power. So +0/+2 spell power greens the improvement to +2/+4.
  const esc = def.effects.find((e) => e.do === 'spellBuffTargetEscalating');
  if (esc) {
    let slot = 0;
    return def.text.replace(/\+(\d+)\/\+(\d+)/g, (m, a: string, h: string) => {
      const na = Number(a);
      const nh = Number(h);
      if (slot++ === 0) {
        const va = na + escalation + bonusA;
        const vh = nh + escalationH + bonusH;
        return escalation + bonusA > 0 || escalationH + bonusH > 0 ? `{{+${va}/+${vh}}}` : m;
      }
      // The improvement step per stat = printed base + that stat's spell power.
      const ia = na + bonusA;
      const ih = nh + bonusH;
      return bonusA > 0 || bonusH > 0 ? `{{+${ia}/+${ih}}}` : m;
    });
  }
  // Patch Job: the per-step "+a/+h" greens for spell power (it grows per step); and once Gold's been spent this
  // turn, append the CURRENT total it will grant right now (steps × the per-step value) so the card shows what it
  // actually gives. Handled BEFORE the no-spell-power early-return, since the Gold total scales without any.
  const perGold = def.effects.find((e) => e.do === 'spellBuffTargetPerGold');
  if (perGold) {
    const pp = perGold.params as { attack?: number; health?: number; gold?: number; baseAttack?: number; baseHealth?: number } | undefined;
    const a = Number(pp?.attack ?? 3); // the PER-TICK step
    const h = Number(pp?.health ?? 3);
    const baseA = Number(pp?.baseAttack ?? a); // the flat base (defaults to the step = the old symmetric shape)
    const baseH = Number(pp?.baseHealth ?? h);
    const per = Number(pp?.gold ?? 7);
    // Spell power greens BOTH printed magnitudes — the base grant and the per-tick step (they differ now).
    let stepText = def.text;
    if (bonusA > 0 || bonusH > 0) {
      stepText = stepText.replace(`+${baseA}/+${baseH}`, `{{+${baseA + bonusA}/+${baseH + bonusH}}}`);
      // Replace the step LAST-first so a base==step card doesn't double-substitute the same token.
      const stepTok = `+${a}/+${h}`;
      const at = stepText.lastIndexOf(stepTok);
      if (at >= 0) stepText = stepText.slice(0, at) + `{{+${a + bonusA}/+${h + bonusH}}}` + stepText.slice(at + stepTok.length);
    }
    const ticks = Math.floor(Math.max(0, goldSpent) / per);
    if (ticks <= 0) return stepText; // no ticks yet → the printed base (greened) is the live value
    return `${stepText} {{Now +${baseA + bonusA + (a + bonusA) * ticks}/+${baseH + bonusH + (h + bonusH) * ticks}.}}`;
  }
  if (bonusA <= 0 && bonusH <= 0) return def.text;
  // Great Pot: its one-per-type "+A/+H" folds spell power on both stats (bug a17a48ab, Bug Board round 1 —
  // the factory now folds, so the printed magnitude goes live with it, per the live-text rule).
  const potBuff = def.effects.find((e) => e.do === 'buffOnePerTribe');
  if (potBuff) {
    const pa = Number((potBuff.params as { attack?: number } | undefined)?.attack ?? 4);
    const ph = Number((potBuff.params as { health?: number } | undefined)?.health ?? 4);
    return def.text.replace(`+${pa}/+${ph}`, `{{+${pa + bonusA}/+${ph + bonusH}}}`);
  }
  // Champion's / Defensive / Bloody Ale (spell-power audit 2026-08-02): their factories fold spell power, so
  // the printed magnitude goes live too. Champion's is a symmetric "+A/+H"; the other two print a single-stat
  // token ("+4 Health" / "+4 Attack") that becomes the full live "+A/+H" pair, like Lantern of Souls below.
  const aleLeft = def.effects.find((e) => e.do === 'spellBuffLeftmost');
  const aleRand = def.effects.find((e) => e.do === 'spellBuffRandomFriendlies');
  const ale = aleLeft ?? aleRand;
  if (ale) {
    const pa = Number((ale.params as { attack?: number } | undefined)?.attack ?? 0);
    const ph = Number((ale.params as { health?: number } | undefined)?.health ?? 0);
    if (pa > 0 && ph > 0) return def.text.replace(`+${pa}/+${ph}`, `{{+${pa + bonusA}/+${ph + bonusH}}}`);
    if (pa > 0) return def.text.replace(`+${pa} Attack`, `{{+${pa + bonusA}/+${bonusH}}}`);
    if (ph > 0) return def.text.replace(`+${ph} Health`, `{{+${bonusA}/+${ph + bonusH}}}`);
    return def.text;
  }
  // Dragonflame: its per-buff "+A/+B" folds spell power (the repeat count is relational, not greened).
  const dragonflame = def.effects.find((e) => e.do === 'spellBuffRandomPerTribe');
  if (dragonflame) {
    const pa = Number((dragonflame.params as { attack?: number } | undefined)?.attack ?? 4);
    const ph = Number((dragonflame.params as { health?: number } | undefined)?.health ?? 4);
    return def.text.replace(`+${pa}/+${ph}`, `{{+${pa + bonusA}/+${ph + bonusH}}}`);
  }
  // Flutter: its "+N Health" becomes the full live "+A/+H" pair once spell power is up (like the Ales above).
  const flutter = def.effects.find((e) => e.do === 'spellBuffHealthGrantFlurryDragon');
  if (flutter) {
    const ph = Number((flutter.params as { health?: number } | undefined)?.health ?? 10);
    return def.text.replace(`+${ph} Health`, `{{+${bonusA}/+${ph + bonusH}}}`);
  }
  // Beefy: its "+A/+B" lands on the target AND both neighbours, and every grant picks up spell power — so the
  // printed number must too (the live-text rule; the spell-power audit test pins it).
  const nbrBuff = def.effects.find((e) => e.do === 'spellBuffTargetAndNeighbours');
  if (nbrBuff) {
    const a = Number((nbrBuff.params as { attack?: number } | undefined)?.attack ?? 0);
    const h = Number((nbrBuff.params as { health?: number } | undefined)?.health ?? 0);
    return def.text.replace(`+${a}/+${h}`, `{{+${a + bonusA}/+${h + bonusH}}}`);
  }
  // Lantern of Souls: base "+N Attack" → "+{N+bonusA}/+{bonusH}" (spell power folds onto both stats).
  const tribeBuff = def.effects.find((e) => e.do === 'spellGrantTribeAttack');
  if (tribeBuff) {
    const amt = Number((tribeBuff.params as { amount?: number } | undefined)?.amount ?? 0);
    return def.text.replace(`+${amt} Attack`, `{{+${amt + bonusA}/+${bonusH}}}`);
  }
  // Staff of Guel: its "+A/+B" tavern-buy buff scales with spell power on both stats too.
  const shopBuff = def.effects.find((e) => e.do === 'spellBuffShop');
  if (shopBuff) {
    const a = Number((shopBuff.params as { attack?: number } | undefined)?.attack ?? 2);
    const h = Number((shopBuff.params as { health?: number } | undefined)?.health ?? 2);
    return def.text.replace(`+${a}/+${h}`, `{{+${a + bonusA}/+${h + bonusH}}}`);
  }
  // Fleeting Vigor: its banked next-combat "+A/+B" scales with spell power on both stats too.
  const scBuff = def.effects.find((e) => e.do === 'spellPendingSCBuff');
  if (scBuff) {
    const a = Number((scBuff.params as { attack?: number } | undefined)?.attack ?? 2);
    const h = Number((scBuff.params as { health?: number } | undefined)?.health ?? 1);
    return def.text.replace(`+${a}/+${h}`, `{{+${a + bonusA}/+${h + bonusH}}}`);
  }
  // Implosion: its per-Demon "+A/+B" Imp buff folds spell power onto both stats (each cast). The cast COUNT
  // (1 + your Demons) rides on the ×N badge via `implosionCasts`, so the text only greens the per-cast grant.
  const impBuff = def.effects.find((e) => e.do === 'spellBuffImpsPerDemon');
  if (impBuff) {
    const a = Number((impBuff.params as { attack?: number } | undefined)?.attack ?? 2);
    const h = Number((impBuff.params as { health?: number } | undefined)?.health ?? 2);
    return def.text.replace(`+${a}/+${h}`, `{{+${a + bonusA}/+${h + bonusH}}}`);
  }
  const eff = def.effects.find((e) => e.do === 'spellBuffTarget' || e.do === 'spellBuffAll');
  if (!eff) return def.text;
  const ba = Number((eff.params as { attack?: number } | undefined)?.attack ?? 0);
  const bh = Number((eff.params as { health?: number } | undefined)?.health ?? 0);
  if (ba <= 0 && bh <= 0) return def.text;
  return def.text.replace(`+${ba}/+${bh}`, `{{+${ba + bonusA}/+${bh + bonusH}}}`);
}

/** Apply a spell's `cast` effects to its chosen target. The spell's name is injected as `_source`
 *  so target buffs (Spirit Fire) record it for the inspect breakdown. */
export function applyCastEffects(ctx: RecruitContext, spellDef: CardDef, target?: BoardCard): void {
  for (const effect of spellDef.effects) {
    if (effect.on !== 'cast') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    // Board-wide cast effects (Growth) ignore `self`; targeted ones (Spirit Fire) always get a target.
    // `_source` labels target buffs in the inspect breakdown; `_maxTier` carries the spell's gild cap
    // (Eyes of Aresmar) down to the factory.
    const params = { ...(effect.params ?? {}), _source: spellDef.name, _spellId: spellDef.id, _maxTier: spellDef.targetMaxTier };
    if (!fn) continue;
    // CHOREOGRAPHER PR 15 — a cast is a SOURCE moment. Every `cast` effect in the game flows through here,
    // so instrumenting this one site gives the whole spell surface a beat rather than touching 66 factories.
    // The SPELL is the source, not the minion it lands on: the card is what the player played, and a buff
    // that credits its target instead reads as the minion having done something to itself.
    withRecruitTrigger(
      ctx,
      {
        phase: 'recruit',
        source: { kind: 'spell', id: spellDef.id, label: spellDef.name, side: 'player' },
        trigger: 'cast',
        ...beatIdentity(`factory:${effect.do}:cast`),
      },
      () => captureBuffFx(ctx.state, undefined, 'spell', () => fn(ctx, target as BoardCard, params, { minion: target as BoardCard })),
    );
  }
}

/** Fire a board-wide recruit trigger (`onBuy` / `onSummon`). */
function fire(
  ctx: RecruitContext,
  event: 'onBuy' | 'onSummon' | 'onConsume',
  payload: { minion: BoardCard; shop?: boolean }, // `shop`: this consume ate a SHOP minion (Broodlord's gate)
): void {
  // Snapshot: a handler may summon, which mutates the board.
  for (const card of [...ctx.state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.on !== event) continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (fn) captureBuffFx(ctx.state, card, 'minion', () => fn(ctx, card, effect.params ?? {}, payload));
    }
  }
  // Den Marker (run-wide quest aura): a Beast entering play gains the current buff, which then climbs every `per`.
  // Runs after the card auras so it stacks on top of a real Den Mother; only on summon (matches Den Mother).
  if (event === 'onSummon' && ctx.state.denMarker) applyDenMarker(ctx.state, payload.minion);
  // Ancient Wanderer: an ARRIVING body catches up to the run's whole spend ("for every 3 Gold you HAVE spent"),
  // rather than starting from zero the way a witnessed-threshold card would.
  if (event === 'onSummon') syncGoldSpentScalers(ctx.state);
}

/**
 * OWNER RULING 2026-08-26 (Rulebook triage board): friendly deaths IN THE SHOP notify the board's on-death
 * WATCHERS — Ashen Heir inherits a destroyed Imp, Brood Matron breeds, Echo Mimic copies the fallen's Echo.
 * The dying card's OWN Echo stays with `fireRecruitDeathrattles` (own-echo factories guard `minion === self`
 * and are NOT re-fired here — the dead card itself is skipped). Sells are not deaths; Consume/devour and
 * destroy effects are.
 */
export function fireOnFriendDeath(state: RunState, dead: BoardCard): void {
  const ctx = makeContext(state);
  for (const card of [...state.board]) {
    if (card.uid === dead.uid) continue;
    for (const effect of instanceEffects(card)) {
      if (effect.on !== 'onDeath') continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (fn) captureBuffFx(state, card, 'minion', () => fn(ctx, card, effect.params ?? {}, { minion: dead }));
    }
  }
}

/** Apply the run-wide Den Marker aura to a Beast entering play: +attack/+health now, then climb the magnitude by
 *  +step/+step once `per` Beasts have been buffed. No-op for non-Beasts. */
function applyDenMarker(state: RunState, minion: BoardCard): void {
  const dm = state.denMarker;
  if (!dm || !isTribe(minion, 'beast')) return;
  addBuff(minion, 'Den Marker', dm.attack, dm.health);
  dm.count += 1;
  if (dm.count % dm.per === 0) { dm.attack += dm.step; dm.health += dm.step; }
}

/**
 * Fire the on-summon buffs (Mama Bear, Kennelmaster, Spirit Worgen, …) for a minion entering play — the same
 * trigger `playCard` fires. Exposed so the magnetize path can run it on a Magnetic minion BEFORE it welds: the
 * absorbed body picks up any tribe summon-buff (Chaos Attachment counts as a Beast → Mama Bear) and then
 * carries those stats into the host. The minion need not be on the board — board handlers buff the payload.
 */
export function fireSummonBuffs(state: RunState, minion: BoardCard): void {
  fire(makeContext(state), 'onSummon', { minion });
  // RUNE OF THE CHIPPER STICKER: playing a Demon makes ANOTHER friendly Demon eat a Shop minion — Chipper's
  // own shape as a run-wide rune. "Another" is load-bearing: the eater is picked from the OTHER Demons, so the
  // minion you just played never feeds itself (that is Chipper's `self: true`, a different card).
  // RUNE OF REFRESHMENTS: playing a Demon banks a free refresh. Fired at the same play chokepoint as the
  // Chipper Sticker, and BEFORE its early return, so the two Demon-play runes are independent — holding one
  // must not silently gate the other.
  // One free refresh per copy held (recurring family, owner 2026-08-27).
  if (state.runeRefreshments && isTribe(minion, 'demon')) { procRuneId(state, 'rune_refreshments'); state.freeRolls += runeStacksOf(state, 'rune_refreshments'); }
  if (!state.runeChipperSticker || !isTribe(minion, 'demon')) return;
  // One Consume per copy held (recurring family, owner 2026-08-27) — each re-reads eaters and the shop.
  for (let k = 0; k < runeStacksOf(state, 'rune_chipper_sticker'); k++) {
    const eaters = state.board.filter((c) => c.uid !== minion.uid && isTribe(c, 'demon'));
    if (eaters.length === 0) return;
    const edible = state.shop
      .map((_, i) => i)
      .filter((i) => { const d = CARD_INDEX[state.shop[i]!.cardId]; return !!d && !d.spell && !d.ruby; });
    if (edible.length === 0) return;
    const rng = makeRng(state.rngCursor);
    const eater = eaters[rng.int(eaters.length)]!;
    const pick = edible[rng.int(edible.length)]!;
    state.rngCursor = rng.state();
    consumeShopMinion(state, eater, pick);
    procRuneId(state, 'rune_chipper_sticker');
  }
}

/** Fire a sold minion's own `onSell` effects (Hoard Whelp → get Gold). Called by the reducer's sell case after
 *  the card is removed from the board/hand; its effects act via the shared recruit context. */
export function fireOnSell(state: RunState, card: BoardCard): void {
  // RUNE OF THE BALLER: each sale pumps your whole board, ALTERNATING stat, and the magnitude climbs every
  // SECOND sale (owner rework 2026-08-19) — +1 Atk, +1 Hp, +2 Atk, +2 Hp, … so each size is paid on both axes
  // before the step rises. The tally lives on the rune (not the card) so it survives the body leaving the
  // board, which is the whole point of a sell payoff.
  const baller = state.runeBaller;
  if (baller) {
    procRuneId(state, 'rune_baller');
    baller.sales += 1;
    // The current step lands once per copy held (recurring family, owner 2026-08-27); ONE shared sales meter.
    const amount = baller.step * Math.ceil(baller.sales / 2) * runeStacksOf(state, 'rune_baller');
    const toAttack = baller.sales % 2 === 1; // odd sale -> Attack, even -> Health
    captureBuffFx(state, undefined, 'spell', () => {
      for (const c of state.board) addBuff(c, 'Rune of the Baller', toAttack ? amount : 0, toAttack ? 0 : amount);
    });
  }
  const def = CARD_INDEX[card.cardId];
  if (!def || !def.effects.some((e) => e.on === 'onSell')) return;
  const ctx = makeContext(state);
  for (const eff of def.effects) {
    if (eff.on !== 'onSell') continue;
    RECRUIT_FACTORIES[eff.do]?.(ctx, card, eff.params ?? {}, { minion: card });
  }
}

/**
 * Set 2 — tell every BOARD minion that a card was ADDED TO HAND (Gangplank). Fired from the shared conjure /
 * grant chokepoint (`conjureToHand`) and the Ruby mint (`mintRubies`) — the "grant to hand" paths — so an Ale,
 * a conjured spell, a granted minion or a minted Ruby all count. Deliberately NOT hooked into every raw
 * `hand.push` (a bought minion, a Discover pick): those are direct player actions, not the grant path the card
 * reacts to. Watcher effects add no card, so this can't recurse.
 */
export function fireOnGainCard(state: RunState, cardId?: string): void {
  // RUNE OF HEAVY PAYROLL: a DWARF arriving in hand pays your left-most minion. Rides this chokepoint — the
  // shared "a card was granted to hand" hook — rather than the buy path, because "get" is the grant verb in
  // this game (a conjured / rewarded / drip-fed Dwarf all count; a purchase is `applyOnBuy`).
  const payroll = state.runeHeavyPayroll;
  const gained = cardId ? CARD_INDEX[cardId] : undefined;
  if (payroll && gained && (gained.tribe === 'dwarf' || gained.tribe2 === 'dwarf' || gained.universalTribe) && state.board.length > 0) {
    procRuneId(state, 'rune_heavy_payroll');
    captureBuffFx(state, undefined, 'spell', () => addBuff(state.board[0]!, 'Rune of Heavy Payroll', payroll.attack, payroll.health));
  }
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def || !def.effects.some((e) => e.on === 'onGainCard')) continue;
    const ctx = makeContext(state);
    for (const eff of def.effects) {
      if (eff.on !== 'onGainCard') continue;
      RECRUIT_FACTORIES[eff.do]?.(ctx, card, eff.params ?? {}, { minion: card, cardId });
    }
  }
}

/** Set 2 — Gemgorge Fiend: fire each board minion's `rubyCast` effects once for every `every`-th cumulative Ruby
 *  cast crossed by this cast (`before` → `after` on `rubyCasts`). */
/** Fire board minions' `rubyCast` effects as a cast METER crosses each `every` step. Despite the event name
 *  (kept for the content schema), the meter is the UMBRELLA of Rubies + Shop Spells — the `spellsCast +
 *  rubyCasts` contract on `RunState.rubyCasts` — per the owner 2026-07-24. Callers pass the umbrella's
 *  before/after so both cast paths measure the same number. */
export function fireOnRubyCast(state: RunState, before: number, after: number): void {
  const casts = Math.max(0, after - before);
  if (casts <= 0) return;
  for (const card of state.board) {
    const eff = CARD_INDEX[card.cardId]?.effects.find((e) => e.on === 'rubyCast');
    if (!eff) continue;
    const every = Math.max(1, num(eff.params?.every, 3));
    // PER-INSTANCE (owner rulings 2026-08-07/08, the Voicekeeper + Mentor line): this body counts the casts
    // IT has witnessed, not the run's lifetime total. The old global-multiple test meant a Gemgorge Fiend
    // bought at 2 casts fired on the very next one — inheriting progress from before it existed — and a
    // counter drawn from a shared tally would have shown that as "2/3" on a card that had seen nothing.
    const before2 = card.rubyCastTick ?? 0;
    const nowTick = before2 + casts;
    card.rubyCastTick = nowTick;
    const fires = Math.floor(nowTick / every) - Math.floor(before2 / every);
    if (fires <= 0) continue;
    const ctx = makeContext(state);
    for (let f = 0; f < fires; f++) RECRUIT_FACTORIES[eff.do]?.(ctx, card, eff.params ?? {}, { minion: card });
  }
}

/** Set 2 — fire a board minion's `onRubyPlayed` effects when a Ruby is cast ONTO it (Ruby Broker → Gold,
 *  Resonance Idol → bounce). The played Ruby's stats ride in the payload so a bounce can re-apply the same
 *  buff. The bounce uses `addBuff` directly (not this path) so it can't cascade into an infinite loop. */
export function fireOnRubyPlayed(state: RunState, card: BoardCard, rubyAttack: number, rubyHealth: number): void {
  // Counted BEFORE the effects run, mirroring `fireOnSpellCastOnThis` — a spread/recast that lands another Ruby
  // on this body must see a count past 1 or a "first each turn" card recurses.
  card.rubiesOnThisTurn = (card.rubiesOnThisTurn ?? 0) + 1;
  // CANDLE CONDUIT (rework 2026-08-07): every Ruby played on your side bounces its stats to 1 more random
  // friendly minion per Conduit (golden 2). Stats only — addBuff('Ruby') directly, never back through this
  // function — which is the same no-rebounce guard Resonance Idol's bounce relies on.
  // RUNE OF THE CONDUIT: one extra bounce for the whole side, on top of whatever Candle Conduits are on the
  // board — so it counts as a body's worth of bouncing without being one. Same no-rebounce guard.
  let extraBounces = state.runeConduit ? runeStacksOf(state, 'rune_conduit') : 0; // +1 bounce per copy held (repeat family, owner 2026-08-27)
  for (const m of state.board) {
    if (!CARD_INDEX[m.cardId]?.effects.some((e) => e.on === 'rubyPlayedAnywhere' && e.do === 'rubyBounceExtra')) continue;
    extraBounces += m.golden ? 2 : 1;
  }
  for (let b = 0; b < extraBounces; b++) {
    const others = state.board.filter((x) => x.uid !== card.uid);
    if (others.length === 0) break;
    const rng = makeRng(state.rngCursor);
    const pick = others[rng.int(others.length)]!;
    state.rngCursor = rng.state();
    addBuff(pick, 'Ruby', rubyAttack, rubyHealth);
    if (b === 0 && state.runeConduit) procRuneId(state, 'rune_conduit');
  }
  const def = CARD_INDEX[card.cardId];
  if (!def || !def.effects.some((e) => e.on === 'onRubyPlayed')) return;
  const ctx = makeContext(state);
  for (const eff of def.effects) {
    if (eff.on !== 'onRubyPlayed') continue;
    RECRUIT_FACTORIES[eff.do]?.(ctx, card, eff.params ?? {}, { minion: card, rubyAttack, rubyHealth });
  }
}

/**
 * Set 2 — tell every BOARD minion that a minion was sold (Voicekeeper). Distinct from `fireOnSell`, which
 * fires the SOLD card's own `onSell` effects: this is the watcher side, for cards that react to OTHER minions
 * leaving. The sold card is passed as `target` so a watcher can inspect what it was.
 */
export function fireOnMinionSold(state: RunState, sold: BoardCard): void {
  // RUNE OF THE LAST WORD: the turn's first Dragon-with-a-Shout you sell fires its Shout on the way out — one
  // more use from a body you were cashing in anyway. `replayBattlecry` is the same path Myra's hero power and
  // every other Shout re-fire uses, so a targeted Shout auto-picks exactly as it does there.
  {
    const def = CARD_INDEX[sold.cardId];
    const isDragon = def?.tribe === 'dragon' || def?.tribe2 === 'dragon';
    if (state.runeLastWord && !state.lastWordUsedThisTurn && isDragon && def && hasBattlecry(def)) {
      procRune(state, 'runeLastWord');
      state.lastWordUsedThisTurn = true;
      // The Shout fires once per copy held (repeat family, owner 2026-08-27: +1 repetition per copy).
      for (let k = 0; k < runeStacksOf(state, 'rune_last_word'); k++) replayBattlecry(state, sold);
    }
  }
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    for (const eff of def.effects) {
      if (eff.on !== 'minionSold') continue;
      RECRUIT_FACTORIES[eff.do]?.(makeContext(state), card, eff.params ?? {}, { minion: card, target: sold });
    }
  }
}

/**
 * Set 2 — fire a board minion's `spellCastOnThis` effects when a TARGETED spell resolves on it (Mirrorwing
 * Hatchling re-casts it, Runefire spreads it to neighbours).
 *
 * The counter is incremented BEFORE the effects run, and that ordering is load-bearing: Mirrorwing's whole job
 * is to cast the same spell on itself again, which re-enters this function. With the bump first, the re-cast
 * sees a count of 2 and the "first spell each turn" guard stops it — without it, the card would recurse until
 * the stack blew. Anything hooking this event must key off `spellsOnThisTurn === 1` for the same reason.
 */
export function fireOnSpellCastOnThis(state: RunState, card: BoardCard, spellDef: CardDef): void {
  card.spellsOnThisTurn = (card.spellsOnThisTurn ?? 0) + 1;
  // RUNE OF SHARED REFLECTION: the first Shop spell cast on each Mirrorwing per turn ALSO casts on its
  // adjacent Dragons. Runefire's spread shape, keyed by the rune instead of a printed effect — and per
  // MIRRORWING ("on each Mirrorwing"), riding the same per-instance first-spell counter the card's own
  // recast uses. Guarded to === 1 for the same reason that counter exists: the spread re-enters `castSpell`,
  // and the bump above is what stops a neighbouring Mirrorwing chain from recursing forever.
  if (state.runeSharedReflection && card.cardId === 'd2_mirrorwing' && card.spellsOnThisTurn === 1) {
    const at = state.board.indexOf(card);
    for (const nb of [state.board[at - 1], state.board[at + 1]]) {
      if (!nb || nb === card) continue;
      const nd = CARD_INDEX[nb.cardId];
      if (nd?.tribe === 'dragon' || nd?.tribe2 === 'dragon') { procRuneId(state, 'rune_shared_reflection'); castSpell(state, spellDef, nb); }
    }
  }
  const def = CARD_INDEX[card.cardId];
  if (!def || !def.effects.some((e) => e.on === 'spellCastOnThis')) return;
  const ctx = makeContext(state);
  for (const eff of def.effects) {
    if (eff.on !== 'spellCastOnThis') continue;
    RECRUIT_FACTORIES[eff.do]?.(ctx, card, eff.params ?? {}, { minion: card, spellDef });
  }
}

export
function makeContext(state: RunState): RecruitContext {
  const ctx: RecruitContext = {
    state,
    collector: currentCollector(),
    summon: (card, nearUid) => {
      // A VACATING body (the borrowed minion of Funeral on Loan) sits on the board only so positional Echoes
      // can see it, and is removed the moment its Echo ends. It must not consume a summon slot — otherwise an
      // Echo that summons is silently dead on a 6-body board, which is exactly the reported bug. Exactly one
      // slot is freed, so the summon lands "in the place of the minion dying".
      const vacating = state.vacatingUid && state.board.some((c) => c.uid === state.vacatingUid) ? 1 : 0;
      if (state.board.length - vacating >= CONFIG.boardMax) {
        // Overflow — the summon can't fit the full board. Flowing Monk pays off on the wasted body.
        for (const c of [...state.board]) {
          const def = CARD_INDEX[c.cardId];
          if (!def) continue;
          for (const effect of def.effects) {
            if (effect.on !== 'summonOverflow') continue;
            const fn = RECRUIT_FACTORIES[effect.do];
            if (fn) captureBuffFx(ctx.state, c, 'minion', () => fn(ctx, c, effect.params ?? {}, { minion: c }));
          }
        }
        return undefined;
      }
      const buff = cardBuff(state, card.id); // a conjured Fodder carries Ritualist's run buff
      // A summoned Imp inherits the run-wide Imp aura (Imp Overseer / Brood Matron / Bane) — so an Imp summoned
      // out of combat (e.g. Crypt Broker firing an Imp-summoning Echo) carries the buff, like a board/hand Imp.
      const impA = card.imp ? (state.impBuff?.attack ?? 0) : 0;
      const impH = card.imp ? (state.impBuff?.health ?? 0) : 0;
      const minion: BoardCard = {
        uid: `b${state.uidSeq++}`,
        cardId: card.id,
        tribe: card.tribe,
        // A summoned minion inherits the run-wide tribe buy-auras too (Squirl Scout's Beast Attack on a Stray,
        // Lantern on an Undead token, Scrap Herald on a magnetized token) — same bake as bought/conjured beasts.
        attack: card.attack + buff.attack + undeadBuyBonus(state, card) + impA,
        health: card.health + buff.health + buyHealthAura(state, card) + impH,
        keywords: [...card.keywords],
        golden: false,
      };
      const near = state.board.findIndex((x) => x.uid === nearUid);
      state.board.splice(near >= 0 ? near + 1 : state.board.length, 0, minion);
      // Wolvie's borrowed Echo (`deathrattleBuffNextSummon`): the next matching-tribe minion summoned in the
      // shop takes the pending buff, then it clears. Applied before `onSummon` so watchers see the buffed body.
      const psb = state.pendingSummonBuff;
      if (psb && (!psb.tribe || isTribe(minion, psb.tribe))) {
        addBuff(minion, psb.source, psb.attack, psb.health);
        state.pendingSummonBuff = undefined;
      }
      fire(ctx, 'onSummon', { minion });
      return minion;
    },
  };
  return ctx;
}

/** "Best single copy, no stacking, golden = +2" repeat count, shared by Drakko (Battlecries) and Chronos
 *  (End-of-Turn). Returns 1 + (2 if any golden copy of `cardId`, else 1 if any copy, else 0). */
/** Fire-count for a trigger FAMILY on the current board, resolved from card data (`triggerMultiplier`)
 *  rather than a hardcoded card id — so Drakko, Chronos and Uron all flow through one place. */
function familyRepeats(state: RunState, family: TriggerFamily): number {
  return 1 + extraTriggerFires(family, state.board, (id) => CARD_INDEX[id]);
}

/** Drakko the Drummer: your Battlecries fire extra times (golden Drakko +2; best one only, no stacking).
 *  Non-consuming (unlike `playedShoutRepeats`, which also spends a Warm Embers charge) — so it's safe for the
 *  reducer's Shout quest tick to read the battlecry FIRE count (each Drakko re-fire is another Shout trigger). */
export function drummerRepeats(state: RunState): number {
  return familyRepeats(state, 'battlecry');
}

/** Fire-count for a freshly PLAYED Battlecry ("shout"): Drakko's repeats PLUS Warm Embers' one-shot double
 *  while its charges last — consuming one charge. Applies ONLY to real plays (playCard / applyBattlecryTarget),
 *  NOT Myra/Ryme re-fires or combat mirrors (which call `drummerRepeats` directly). A non-Battlecry card never
 *  consumes a charge (guarded by the onPlay check), so it's safe to call for every played minion. */
function playedShoutRepeats(state: RunState, def: CardDef): number {
  let n = drummerRepeats(state); // 1 + Drakko's extra
  const isShout = def.effects.some((e) => e.on === 'onPlay');
  if (isShout) {
    n += state.shoutExtraAlways ?? 0; // Hoardwake / The Hoard Wakes — permanent extra triggers (stacks)
    if (state.shoutExtraAlways) procRuneId(state, 'rune_choir');
    n += state.shoutExtraTurn ?? 0;   // GIFT — Demand an Encore: this turn only (cleared at end of turn)
    // Warm Embers — the FIRST Shout you play each turn triggers twice (one freebie per turn).
    if (state.shoutFirstDoubleEachRound && !state.shoutFirstUsedThisTurn) {
      state.shoutFirstUsedThisTurn = true;
      n += 1;
    }
    // Legacy Warm Embers charge (the `shoutDouble` reward), while any remain.
    if ((state.shoutDoubleCharges ?? 0) > 0) { state.shoutDoubleCharges! -= 1; n += 1; }
    // RUNE OF THE WAR DRUM: ONE Shout each turn triggers `runeWarDrum` extra times. Its own per-turn latch
    // (not Warm Embers') so the two stack, and so the charge readout can say 1 or 0 independently.
    if (state.runeWarDrum && !state.runeWarDrumUsedThisTurn) {
      state.runeWarDrumUsedThisTurn = true;
      n += state.runeWarDrum;
      procRuneId(state, 'rune_war_drum');
    }
  }
  // ACCUMULATE, don't assign: the reducer zeroes this at the start of every action, and a single action can
  // fire Shouts from more than one path (a play PLUS an Echoing Roar re-trigger). Assigning meant the last
  // writer won and the rest vanished from the tally.
  if (isShout) state.lastShoutFires = (state.lastShoutFires ?? 0) + n;
  return n;
}

/** How many times End-of-Turn effects fire this turn: 1, +1 per Chronos (best one only — golden Chronos
 *  adds 2, no stacking). Internal — external callers (the UI's End-Turn beats) use `endOfTurnRepeats`,
 *  which folds in Chrono Staff's one-shot extra. */
function chronosRepeats(state: RunState): number {
  return familyRepeats(state, 'endOfTurn');
}

/** How many times End-of-Turn effects fire this turn: Chronos's repeats PLUS Chrono Staff's one-shot extra
 *  (a per-turn flag — stacks with Chronos, not with itself). The real End of Turn and its UI preview/telegraph
 *  all read this so they agree. (Djinn's manual "proc one now" stays on plain chronosRepeats.) */
export function endOfTurnRepeats(state: RunState): number {
  return chronosRepeats(state) + (state.extraEotThisTurn ? 1 : 0) + (state.endOfTurnExtra ?? 0); // + Parliament of Flame
}

/** Notify Battlecry-triggered watchers (Karwind) that a Battlecry just resolved. Call once per
 *  Battlecry *fire* — including each Drakko repeat — so a doubled Battlecry procs Karwind twice. */
function fireBattlecryTriggered(state: RunState): void {
  const ctx = makeContext(state);
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.on !== 'battlecryTriggered') continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (fn) captureBuffFx(ctx.state, card, 'minion', () => fn(ctx, card, effect.params ?? {}, { minion: card }));
    }
  }
  // Twin Sun Oath (Dragon capstone): this Shout trigger buffs your leftmost + rightmost board minion. Fires per
  // Battlecry FIRE (so a doubled Shout buffs twice, matching how the Shout objective counts triggers). A single
  // board minion is both edges → buffed once (deduped), not twice.
  const edge = state.shoutEdgeBuff;
  if (edge && state.board.length > 0) {
    procRuneId(state, 'rune_drake_skull');
    const left = state.board[0]!;
    const right = state.board[state.board.length - 1]!;
    addBuff(left, 'Twin Sun Oath', edge.attack, edge.health);
    if (right !== left) addBuff(right, 'Twin Sun Oath', edge.attack, edge.health);
  }
}

/** Fire a single card's `onGainAttack` recruit effects (Hunter) — called by the reducer boundary for every
 *  board minion whose Attack rose during a recruit action (any source: Fortify, spells, tribe Battlecries,
 *  weld, triples). Matches combat's `onGainAttack` semantics (only the minion whose Attack rose reacts). The
 *  combat path is separate (the bus emits onGainAttack inside `simulate`'s `ctx.buff`), so this never
 *  double-fires across the two phases. */
export function fireOnGainAttack(state: RunState, card: BoardCard): void {
  const def = CARD_INDEX[card.cardId];
  // Fast path: the reducer calls this for EVERY board minion whose Attack rose, so bail before the
  // (relatively costly) makeContext unless this card actually has a dispatchable onGainAttack reactor.
  if (!def || !def.effects.some((e) => e.on === 'onGainAttack' && RECRUIT_FACTORIES[e.do])) return;
  const ctx = makeContext(state);
  for (const effect of def.effects) {
    if (effect.on !== 'onGainAttack') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) fn(ctx, card, effect.params ?? {}, { minion: card });
  }
}

/** Resolve a chosen Choose One option's effects on the played card. Choose One is its own keyword,
 *  NOT a Battlecry — it does not synergize with Drakko (no doubling) and does not notify
 *  battlecry-triggered watchers (Karwind / Bane). The chosen option's effects resolve exactly once. */
export function applyChooseOne(state: RunState, card: BoardCard, effects: CardDef['effects']): void {
  state.karwindFlash = []; // Choose One never procs Karwind; clear any stale flash from a prior play
  const ctx = makeContext(state);
  for (const effect of effects) {
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) captureBuffFx(ctx.state, card, 'minion', () => fn(ctx, card, effect.params ?? {}, { minion: card }));
  }
}

/** Resolve a *targeted* Choose One option (Runic Beetle) on the player-chosen `target`: the chosen option's
 *  effects fire with the target injected — like `applyBattlecryTarget`, but running the OPTION's effects
 *  rather than the card's own. No Drakko/Karwind (Choose One never procs them, matching `applyChooseOne`). */
export function applyChooseOneTarget(state: RunState, card: BoardCard, effects: CardDef['effects'], target: BoardCard): void {
  state.karwindFlash = [];
  const ctx = makeContext(state);
  for (const effect of effects) {
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) captureBuffFx(ctx.state, card, 'minion', () => fn(ctx, card, effect.params ?? {}, { minion: card, target }));
  }
}

/** Resolve a deferred *targeted* Battlecry (Toxin Tender) on the player-chosen friendly `target`.
 *  Fires the played card's onPlay effects with the target injected, honoring Drakko + Karwind. */
export function applyBattlecryTarget(state: RunState, card: BoardCard, target: BoardCard): void {
  state.karwindFlash = [];
  state.fodderEaten = []; // fresh for this resolution so a Drakko-repeated Godfodder accumulates each fire's Fodder
  const ctx = makeContext(state);
  const def = CARD_INDEX[card.cardId];
  if (!def) return;
  // Warm Embers doubles this played (targeted) Shout while charged; Drakko still stacks on top.
  const repeats = playedShoutRepeats(state, def);
  for (const effect of def.effects) {
    if (effect.on !== 'onPlay') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    captureBuffFx(ctx.state, card, 'minion', () => { for (let r = 0; r < repeats; r++) fn(ctx, card, effect.params ?? {}, { minion: card, target }); });
  }
  for (let r = 0; r < repeats; r++) fireBattlecryTriggered(state); // a Battlecry → procs Karwind
  if (state.karwindFlash && state.karwindFlash.length) state.karwindFlashSeq = (state.karwindFlashSeq ?? 0) + 1;
}

/**
 * Myra's hero power: re-fire a friendly minion's Battlecry (its `onPlay` effects) right now —
 * honoring Drakko repeats + Karwind, exactly as a fresh play would. Targeted Battlecries re-fire
 * with no explicit target, so their auto-pick fallback chooses (Toxin Tender → the best friend);
 * a targeted Battlecry with no eligible friend simply no-ops, and a
 * Choose One minion has no `onPlay` effects so it isn't a valid target. Returns whether a Battlecry
 * fired — the hero charge is only spent when it did.
 */
/**
 * Swap a friendly board minion with a RANDOM tavern offer (shared by the Displacement spell + Darah's
 * Displace power). The displaced minion goes to the tavern KEEPING all its state (buffs / stats / progression),
 * stashed on the offer's `held` and restored intact when re-bought or swapped back. The incoming tavern minion
 * takes the board slot WITHOUT firing its Battlecry / summon-buff (a placement, not a play): a previously-held
 * minion returns intact, a normal offer instantiates fresh (base + offer buff + golden, doubled). Returns false
 * (no-op, no charge spent) when the board minion isn't on the board or the tavern is empty.
 */
export function swapWithTavern(state: RunState, boardMinion: BoardCard): boolean {
  const bi = state.board.indexOf(boardMinion);
  if (bi < 0 || state.shop.length === 0) return false;
  if (boardMinion.golden) return false; // can't trade away a golden (triple) — no RNG consumed on the no-op
  // Only swap with a tavern MINION — spells can never be displaced onto the board. With no minion in the
  // tavern the swap can't happen (no RNG consumed on the no-op); callers keep the spell / hero charge.
  const minionIdx = state.shop.flatMap((o, i) => (CARD_INDEX[o.cardId]?.spell ? [] : [i]));
  if (minionIdx.length === 0) return false;
  const rng = makeRng(state.rngCursor);
  const si = minionIdx[rng.int(minionIdx.length)]!;
  state.rngCursor = rng.state();
  const offer = state.shop[si]!;
  const def = CARD_INDEX[offer.cardId];
  if (!def) return false;
  let incoming: BoardCard;
  if (offer.held) {
    // Deep-copy the mutable arrays so the restored minion never SHARES `keywords`/`buffs` with anything (a
    // shared array + an in-place weld/buff would leak onto the alias — the Bounty Bot Ward bug).
    incoming = { ...offer.held, uid: `b${state.uidSeq++}`, keywords: [...offer.held.keywords], buffs: offer.held.buffs ? [...offer.held.buffs] : undefined }; // a previously-displaced minion returns intact
  } else {
    incoming = {
      uid: `b${state.uidSeq++}`,
      cardId: offer.cardId,
      tribe: def.tribe,
      attack: def.attack + (offer.atk ?? 0),
      health: def.health + (offer.hp ?? 0),
      keywords: [...def.keywords, ...(offer.keywords ?? []).filter((k) => !def.keywords.includes(k))],
      golden: offer.golden ?? false,
    };
    if (incoming.golden) { incoming.attack += def.attack; incoming.health += def.health; } // golden doubles BASE only (offer buffs single)
  }
  state.board[bi] = incoming;
  // The displaced minion → the tavern, its FULL state stashed on the offer (restored on buy / swap-back).
  state.shop[si] = { uid: `s${state.uidSeq++}`, cardId: boardMinion.cardId, held: { ...boardMinion, keywords: [...boardMinion.keywords], buffs: boardMinion.buffs ? [...boardMinion.buffs] : undefined } };
  // Signal the UI to fire the circular swap-arrows FX between the two new cards (one-shot, like chaosGrantSeq).
  state.swapFxSeq = (state.swapFxSeq ?? 0) + 1;
  state.swapFxBoardUid = incoming.uid;
  state.swapFxShopUid = state.shop[si]!.uid;
  return true;
}

export function replayBattlecry(state: RunState, card: BoardCard): boolean {
  const def = CARD_INDEX[card.cardId];
  if (!def) return false;
  const onPlay = def.effects.filter((e) => e.on === 'onPlay');
  if (onPlay.length === 0) return false;
  state.karwindFlash = [];
  const ctx = makeContext(state);
  const repeats = drummerRepeats(state);
  // A REPLAYED Shout is still a Shout trigger — it must advance `shout` objectives (Echoing Roar, Tooth and
  // Tempo, The Author's Hand) exactly like a played one. Every re-trigger path routes through here — Echoing
  // Roar's End-of-Turn reward, the Resonance spell, Myra's hero power — and none of them counted, so a quest
  // whose own reward re-fires Shouts couldn't advance itself (owner report 2026-07-21). Same class as the
  // Uron rally fix in #594: the effect re-fired but the tally never saw it.
  state.lastShoutFires = (state.lastShoutFires ?? 0) + repeats;
  for (const effect of onPlay) {
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    captureBuffFx(ctx.state, card, 'minion', () => { for (let r = 0; r < repeats; r++) fn(ctx, card, effect.params ?? {}, { minion: card }); });
  }
  for (let r = 0; r < repeats; r++) fireBattlecryTriggered(state); // a Battlecry → procs Karwind
  if (state.karwindFlash && state.karwindFlash.length) state.karwindFlashSeq = (state.karwindFlashSeq ?? 0) + 1;
  return true;
}

/**
 * Replay ONE economy Battlecry that Ryme re-fired in combat, at SETTLE. The combat-meaningful battlecries
 * (summon / buff / discover / grant-keyword / spell-power — `COMBAT_REPLAYABLE_BATTLECRIES`) already resolved
 * IN the fight; this runs the REST (Soulfeeder's Fodder, Hoarder's Gold, Demonic Anomaly's shop buff, a
 * gain-a-minion) through their real recruit factory, which needs the RunState (tavern / Gold / hand) the pure
 * combat sim doesn't have. Called once per recorded re-fire — Drakko's doubling is already baked into the
 * count, so NO extra repeats here. `golden` mirrors the re-fired minion so the factory's golden doubling is
 * correct. Karwind/Bane already procced in combat (the `battlecryTriggered` event), so no re-proc here.
 */
export function replayEconomyBattlecry(state: RunState, cardId: string, golden: boolean): void {
  const def = CARD_INDEX[cardId];
  if (!def) return;
  const economy = def.effects.filter((e) => e.on === 'onPlay' && !COMBAT_REPLAYABLE_BATTLECRIES.has(e.do));
  if (economy.length === 0) return;
  const self: BoardCard = {
    uid: 'ryme-bc', cardId, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden,
  };
  const ctx = makeContext(state);
  for (const effect of economy) {
    const fn = RECRUIT_FACTORIES[effect.do];
    if (fn) fn(ctx, self, effect.params ?? {}, { minion: self });
  }
}

/**
 * Dusk's hero power: proc a friendly minion's End of Turn effect right now (an extra trigger),
 * honoring Chronos repeats — exactly like the natural end-of-turn, but for one chosen minion.
 * Returns whether anything fired (the charge is only spent when it did).
 */
export function replayEndOfTurn(state: RunState, card: BoardCard): boolean {
  const def = CARD_INDEX[card.cardId];
  if (!def) return false;
  const eot = def.effects.filter((e) => e.on === 'endOfTurn');
  if (eot.length === 0) return false;
  const ctx = makeContext(state);
  const repeats = chronosRepeats(state);
  let fires = 0;
  for (const effect of eot) {
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    for (let r = 0; r < repeats; r++) { fn(ctx, card, effect.params ?? {}, { minion: card, proc: r, replay: true }); fires++; }
  }
  // A REPLAYED End of Turn is still an End-of-Turn TRIGGER — it must advance the `endOfTurn` objective
  // (Parliament of Flame), exactly as `applyEndOfTurn` does. Accumulate (the reducer zeroes it per action), so
  // Djinn's Cadence firing every minion's EoT counts each one (audit 2026-07-21, the same class as Myra's
  // replayBattlecry → lastShoutFires and the Uron rally fix). The reducer's heroPower path then reads it.
  state.lastEotFires = (state.lastEotFires ?? 0) + fires;
  return true;
}

/**
 * Djinn's Cadence: proc the QUEST/RUNE-granted recurring End-of-Turn rewards now — the sibling of
 * `replayEndOfTurn`, which covers board minions.
 *
 * A player's End-of-Turn engine has TWO halves, and `applyEndOfTurn` fires both at the natural end of turn:
 * each board minion's `endOfTurn` effects, and `questRecurringEndOfTurn` (Echoing Roar, The Hoard Wakes,
 * Blueprint Cache, Rune of Spending/Action, …). A power that reads "trigger all friendly End of Turn effects"
 * must therefore cover both, or it silently skips half of what the player built (owner ruling 2026-07-22).
 *
 * Honors Chronos repeats and counts every proc into `lastEotFires`, exactly as the natural path and
 * `replayEndOfTurn` do, so Parliament of Flame's "Trigger N End-of-Turn effects" sees these fires too.
 * Returns whether anything fired (the charge is only spent when something did).
 */
export function replayRecurringEndOfTurn(state: RunState): boolean {
  const effects = state.questRecurringEndOfTurn ?? [];
  if (effects.length === 0) return false;
  const repeats = chronosRepeats(state);
  let fires = 0;
  for (const eff of effects) {
    for (let r = 0; r < repeats; r++) { runRecurringEndOfTurn(state, eff); fires++; }
  }
  state.lastEotFires = (state.lastEotFires ?? 0) + fires;
  return true;
}

/**
 * Set 2 — a SHOP SPELL was purchased. Fires the `spellBought` event so any watcher can react (today: Moonhowl
 * Mentor). Called from the reducer's spell-buy path — spells deliberately don't fire the normal `onBuy`
 * trigger ("a spell isn't a minion"), so this is its own event rather than a widening of that contract, which
 * would change what every existing buy-trigger sees.
 */
export function applySpellBought(state: RunState, spellId: string): void {
  // Rune of the White Wolf: the rune teaches on its own, sharing the per-turn ceiling with any Mentor on board.
  if (state.runeWhiteWolf) { procRuneId(state, 'rune_white_wolf'); teachMagePup(state, spellId); }
  // A dedicated loop rather than the generic `fire`, which is typed to a minion-only payload — this event's
  // subject is the SPELL, and the board minion is just the watcher. Mirrors `fireOnRubyGained`.
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def?.effects.some((e) => e.on === 'spellBought')) continue;
    const ctx = makeContext(state);
    for (const eff of def.effects) {
      if (eff.on !== 'spellBought') continue;
      RECRUIT_FACTORIES[eff.do]?.(ctx, card, eff.params ?? {}, { minion: card, spellId });
    }
  }
}

/**
 * Set 2 — the tavern was REFRESHED. Fires `shopRefreshed` so a watcher can count rolls (Hellrider: every 4).
 *
 * The tally deliberately lives PER-INSTANCE on the watching card, not as a run-wide counter: "every 4 refreshes"
 * should mean four since that body arrived, so a Maw bought on turn 8 doesn't immediately fire off refreshes it
 * was never present for. A dedicated loop rather than the generic `fire`, whose payload is minion-shaped.
 */
export function applyShopRefreshed(state: RunState): void {
  applyShopRefreshQuestBuff(state);
  // Market Tormentor's SLOT buff lands on the fresh row's right-most minion, BEFORE the watchers below — the
  // ordering is load-bearing (owner ruling 2026-07-25): a Hellrider that eats the right-most must eat the
  // BUFFED body. It used to be enforced with a two-pass BUFF_FIRST loop over board watchers; now that the buff
  // is run-level state rather than a board effect, applying it up here IS the ordering.
  const slot = state.rightmostSlotBuff;
  if (slot) {
    const i = rightmostShopMinion(state);
    if (i >= 0) addOfferBuff(state.shop[i]!, 'Market Tormentor', slot.attack, slot.health);
  }
  // RUNE OF THE EMBERS: every refresh DOUBLES the right-most Shop minion's Health. Applied as an offer buff
  // (`+hp` equal to the body's current Health) rather than a stat rewrite, so the shop card shows where the
  // number came from and the buy bakes it in through the same path every other slot enchant uses. It runs
  // AFTER Market Tormentor's slot buff, deliberately: the doubling should include that turn's enchant, which
  // is the same "the right-most must be the BUFFED body" ordering the Hellrider ruling established.
  if (state.runeEmbers) {
    // One doubling per copy held (owner 2026-08-27, unique-engine doubling) — each reads the freshly-buffed Health.
    for (let k = 0; k < runeStacksOf(state, 'rune_embers'); k++) {
      const i = rightmostShopMinion(state);
      if (i < 0) break;
      const cur = offerBuyStats(state, state.shop[i]!).health;
      if (cur > 0) { procRuneId(state, 'rune_embers'); addOfferBuff(state.shop[i]!, 'Rune of the Embers', 0, cur); }
    }
  }
  // Rune of the Display Case: re-land the accumulated LEFT-most-slot enchant on the left offer each roll.
  const lslot = state.leftmostSlotBuff;
  if (lslot) {
    const l = state.shop.findIndex((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
    if (l >= 0) addOfferBuff(state.shop[l]!, 'Market Tormentor', lslot.attack, lslot.health);
  }
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def?.effects.some((e) => e.on === 'shopRefreshed')) continue;
    const ctx = makeContext(state);
    for (const eff of def.effects) {
      if (eff.on !== 'shopRefreshed') continue;
      RECRUIT_FACTORIES[eff.do]?.(ctx, card, eff.params ?? {}, { minion: card });
    }
  }
}

/** Buy-triggers (Brightwing Broker) — fire when a card is purchased into the hand. */
/** RUNE OF THE SECOND LIFE — stamp Taunt + Rise onto a Scavver. Idempotent, so re-running it over the board
 *  (which the reward case does on purchase) can't duplicate a pill. Keywords are stamped onto the INSTANCE
 *  rather than the CardDef: a shared def must never be mutated, and a saved run stores the instance. */
export function applySecondLife(state: RunState, card: BoardCard): void {
  if (!state.runeSecondLife || card.cardId !== 'b2_scavenger') return;
  for (const kw of ['T', 'R'] as Keyword[]) if (!card.keywords.includes(kw)) card.keywords.push(kw);
}

/** The tribe a card's Battlecry aim is restricted to, AFTER runes. Rune of Open Appetite drops the Appetite
 *  Agent's Demon-only rule, so every enforcement point — the reducer's target check, the "is there a legal
 *  target at all?" probe, the auto-pick pool, and the aim UI — has to ask this rather than read `targetTribe`
 *  directly, or the rune would half-apply and refuse the pick it just allowed. */
export function effectiveTargetTribe(state: RunState, def: CardDef | undefined): Tribe | undefined {
  if (!def?.targetTribe) return undefined;
  if (state.runeOpenAppetite && def.id === 'dm_agent') return undefined;
  return def.targetTribe;
}

export function applyOnBuy(state: RunState, bought: BoardCard): void {
  applySecondLife(state, bought); // Rune of the Second Life: a Scavver arrives already carrying Taunt + Rise
  const ctx = makeContext(state);
  // RUNE OF THE BANQUET HALL: the turn's first SHOP-BUFFED buy hands its bonus stats to one friendly minion of
  // each type. "Bonus" means what the tavern put on it (the offer's `atk`/`hp`, which the buy path bakes into
  // the body as named buffs) — a plain 3/4 body bought at printed stats is not "Shop-buffed" and doesn't arm
  // it. The one-per-type walk is the Lapidary's: board order, first uncovered tribe wins, a dual-type body
  // covers both, so the pick is a seating decision rather than RNG. The buyer itself can be a recipient — it
  // is a friendly minion of its own type, and excluding it would make the rune worse the fewer types you hold.
  if (state.runeBanquetHall && !state.banquetUsedThisTurn) {
    const base = CARD_INDEX[bought.cardId];
    const g = bought.golden ? 2 : 1;
    // The split lands once per copy held (owner 2026-08-27, unique-engine doubling): the board gains the
    // bought body's bonus × copies, dealt out through the same one-point-at-a-time dispersal.
    const bh = runeStacksOf(state, 'rune_banquet_hall');
    const bonusA = (bought.attack - (base ? base.attack * g : bought.attack)) * bh;
    const bonusH = (bought.health - (base ? base.health * g : bought.health)) * bh;
    if (bonusA > 0 || bonusH > 0) {
      state.banquetUsedThisTurn = true;
      procRuneId(state, 'rune_banquet_hall');
      const covered = new Set<string>();
      const recipients: BoardCard[] = [];
      for (const c of [...state.board]) {
        const def = CARD_INDEX[c.cardId];
        const tribes = [def?.tribe, def?.tribe2].filter((t): t is Tribe => !!t && t !== 'neutral');
        if (tribes.length === 0 || tribes.every((t) => covered.has(t))) continue;
        for (const t of tribes) covered.add(t);
        recipients.push(c);
      }
      // DISPERSED across the recipients, not handed to each in full (owner ruling 2026-08-07, matching Rune of
      // Ruby Shrapnel). The bonus is dealt out one point at a time, round-robin from the left, so every point
      // lands somewhere and the total the board gains is exactly the bonus the bought body was carrying —
      // wide type coverage spreads it thinner rather than multiplying it. Attack and Health are dealt
      // independently, both from the left, so a +3/+3 keeps its two halves on the same minions.
      if (recipients.length > 0) {
        const share = recipients.map(() => ({ attack: 0, health: 0 }));
        for (let i = 0; i < bonusA; i++) share[i % recipients.length]!.attack += 1;
        for (let i = 0; i < bonusH; i++) share[i % recipients.length]!.health += 1;
        for (let i = 0; i < recipients.length; i++) {
          const sh = share[i]!;
          if (sh.attack > 0 || sh.health > 0) addBuff(recipients[i]!, 'Rune of the Banquet Hall', sh.attack, sh.health);
        }
      }
    }
  }
  fire(ctx, 'onBuy', { minion: bought });
}

/** A Demon's stat multiplier when it eats Fodder (Voracious Imp = 2, golden = 3). */
function fodderMultiplier(consumer: BoardCard): number {
  const base = CARD_INDEX[consumer.cardId]?.fodderMult ?? 1;
  if (base <= 1) return 1;
  return consumer.golden ? base + 1 : base;
}

/**
 * The CURRENT (buffed) stats of a tavern offer — exactly what it's worth if bought: a Displacement-stashed
 * minion (`held`) keeps its full preserved body, otherwise base + the persistent per-card run buff
 * (Ritualist / Staff via the Fodder enchant) + the Undead buy-attack + the per-offer buff (Apples / Shatter /
 * Fortify, stored on `atk`/`hp`) + Staff of Guel's tavern-buy bonus, all ×2 for a Golden Touch offer.
 * The single source of truth for every CONSUME path (Acid, the Consume / Cupcakes spells, a Demon eating
 * Fodder) so a consumed minion grants its current value, not its base. Mirrors the reducer's buy case;
 * excludes only the Lantern of Souls live aura, which the buy path also doesn't bake (it re-applies to actual
 * Undead on the board / in combat, so transferring it onto a Demon would double-dip a temporary aura).
 */
export function offerBuyStats(state: RunState, offer: ShopCard): { attack: number; health: number } {
  if (offer.held) return { attack: offer.held.attack, health: offer.held.health };
  const def = CARD_INDEX[offer.cardId];
  if (!def) return { attack: 0, health: 0 };
  const cb = cardBuff(state, def.id);
  const fodder = def.keywords.includes('FD'); // Fodder carries Staff of Guel via its run-wide enchant, not the buy-buff
  // The PERMANENT run-wide shop bonus, plus the Merchant's Chorus THIS-TURN layer. Same Fodder exclusion for
  // both, for the same reason: Fodder carries the enchant through its own run-wide channel, so adding it here
  // would pay it twice.
  const staffA = fodder ? 0 : (state.tavernBuyBonus?.atk ?? 0) + (state.tavernBuyBonusTurn?.atk ?? 0);
  const staffH = fodder ? 0 : (state.tavernBuyBonus?.hp ?? 0) + (state.tavernBuyBonusTurn?.hp ?? 0);
  // Veinstorm's run-wide RUBY grant rides the same rails as the Staff bonus (same Fodder exclusion, for the
  // same reason) — it just bakes in under the `Ruby` source at buy, so Ruby readers can see it.
  // Veinstorm's Rubies need no line here: they are REAL per-offer buffs, already inside `offer.atk/hp`.
  let attack = def.attack + cb.attack + undeadBuyBonus(state, def) + (offer.atk ?? 0) + staffA;
  let health = def.health + cb.health + (offer.hp ?? 0) + staffH + buyHealthAura(state, def);
  if (offer.golden) { attack += def.attack; health += def.health; } // Golden Touch: doubles BASE only (run/offer buffs single), like a gild
  return { attack, health };
}

/**
 * Both board-adjacent neighbours of `center` each Consume `count` created Fodder (Fred) — gaining its
 * enchanted stats × the eater's fodder multiplier and firing the normal onConsume pipeline. Shared by
 * Abyssal Feeder's End-of-Turn (`center` = the Feeder) and Herald's hero power (`center` = the targeted
 * minion). `center` itself does NOT consume — only the minions on either side.
 */
export function adjacentConsumeFodder(state: RunState, center: BoardCard, count: number): void {
  const idx = state.board.indexOf(center);
  if (idx < 0 || count <= 0) return;
  const neighbors = [state.board[idx - 1], state.board[idx + 1]].filter((m): m is BoardCard => !!m);
  const fodder = CARD_INDEX.fred;
  if (!fodder || neighbors.length === 0) return;
  const ctx = makeContext(state);
  const cb = cardBuff(state, fodder.id);
  const fa = fodder.attack + cb.attack;
  const fh = fodder.health + cb.health;
  const eaten: { eaterUid: string; fodderId: string; attack: number; health: number; gainA: number; gainH: number }[] = [];
  for (const target of neighbors) {
    const mult = fodderMultiplier(target);
    for (let i = 0; i < count; i++) {
      addBuff(target, 'Consume', fa * mult, fh * mult);
      fire(ctx, 'onConsume', { minion: target });
      eaten.push({ eaterUid: target.uid, fodderId: fodder.id, attack: fa, health: fh, gainA: fa * mult, gainH: fh * mult });
      noteFodderConsumed(state, fa, fh, target);
    }
  }
  if (eaten.length > 0) {
    state.fodderEaten = [...(state.fodderEaten ?? []), ...eaten];
    state.fodderEatenSeq += 1;
  }
}

/** Feasting Bogrot's Consume: `center` Consumes a Fodder `count` times (gains Fred's stats × its multiplier +
 *  fires onConsume), and each time ALSO grants Fred's (unmultiplied) stats to its two board neighbors. */
export function feastConsume(state: RunState, center: BoardCard, count: number): void {
  if (count <= 0) return;
  const fodder = CARD_INDEX.fred;
  if (!fodder) return;
  const idx = state.board.indexOf(center);
  if (idx < 0) return;
  const neighbors = [state.board[idx - 1], state.board[idx + 1]].filter((m): m is BoardCard => !!m);
  const ctx = makeContext(state);
  const cb = cardBuff(state, fodder.id);
  const fa = fodder.attack + cb.attack;
  const fh = fodder.health + cb.health;
  const eaten: { eaterUid: string; fodderId: string; attack: number; health: number; gainA: number; gainH: number }[] = [];
  const mult = fodderMultiplier(center);
  for (let i = 0; i < count; i++) {
    addBuff(center, 'Consume', fa * mult, fh * mult); // Bogrot eats the Fodder
    fire(ctx, 'onConsume', { minion: center });
    eaten.push({ eaterUid: center.uid, fodderId: fodder.id, attack: fa, health: fh, gainA: fa * mult, gainH: fh * mult });
    noteFodderConsumed(state, fa, fh, center);
    for (const n of neighbors) addBuff(n, 'Feasting Bogrot', fa, fh); // …and shares the Fodder's stats to each side
  }
  if (eaten.length > 0) {
    state.fodderEaten = [...(state.fodderEaten ?? []), ...eaten];
    state.fodderEatenSeq += 1;
  }
}

/**
 * Set 2 (Demons) — have `eater` CONSUME a specific shop offer: the offer leaves the tavern and the eater gains
 * its CURRENT (buffed) stats, `times` over. Fires `onConsume` and records the swirl FX, so it looks and reacts
 * exactly like a Fodder consume.
 *
 * The shared primitive behind the whole tribe: eight Demon cards consume a Shop minion, four of them with a
 * Gilded "and gain double its stats" rider — which is `times: 2`, NOT a separate effect. Set 1's
 * `consumeTavernFodder` already ate from the shop, but only cards carrying `FD` (Fodder); this eats any minion,
 * which is the new part.
 *
 * Stats come from `offerBuyStats`, the same helper the buy path uses, so a consumed offer is worth exactly what
 * it would have been worth bought — including run buffs, per-offer buffs and a golden offer's doubling. Reading
 * the raw CardDef instead would silently ignore every shop buff the player had invested in.
 *
 * Returns true if something was eaten, so a caller can tell "no legal target" from "done".
 */
export function consumeShopMinion(state: RunState, eater: BoardCard, offerIndex: number, times = 1): boolean {
  // Bottomless Banquet: the FIRST Shop minion your Demons Consume each turn, they Consume another. Guarded by a
  // per-turn latch set before the recursive call, so the extra Consume can't itself re-trigger the reward.
  // Rune of the Open Market: the FIRST Shop minion Consumed each turn buffs the Shop permanently. Shares the
  // trigger with Bottomless Banquet but not the effect, and keeps its own latch so holding both pays both.
  const om = state.runeOpenMarket;
  if (om && !om.usedThisTurn && state.shop[offerIndex]) {
    om.usedThisTurn = true;
    procRuneId(state, 'rune_open_market');
    applyRunShopBuff(state, om.attack, om.health, 'Rune of the Open Market');
  }
  if (state.consumeDoubleFirstEachTurn && !state.consumeDoubleUsedThisTurn && CARD_INDEX[state.shop[offerIndex]?.cardId ?? '']) {
    state.consumeDoubleUsedThisTurn = true;
    const other = state.shop.findIndex((o, n) => {
      const d = CARD_INDEX[o.cardId];
      return n !== offerIndex && !!d && !d.spell && !d.ruby;
    });
    if (other >= 0) consumeShopMinion(state, eater, other, times);
  }
  const offer = state.shop[offerIndex];
  if (!offer) return false;
  const def = CARD_INDEX[offer.cardId];
  if (!def || def.spell || def.ruby) return false; // spells/Rubies in the row aren't minions — never edible
  const { attack: fa, health: fh } = offerBuyStats(state, offer);
  state.shop.splice(offerIndex, 1); // eaten — leaves the tavern
  state.shopMinionsEaten = (state.shopMinionsEaten ?? 0) + 1; // Bottomless Banquet's objective meter
  const ctx = makeContext(state);
  const gainA = fa * times;
  const gainH = fh * times;
  addBuff(eater, 'Consume', gainA, gainH);
  // Record the consume BEFORE notifying: an `onConsume` watcher has to be able to see WHAT was eaten, and
  // `fodderEaten` is the only carrier of that (Avarice Incarnate pays Gold equal to the eaten minion's tier and
  // read an empty list when this was appended afterwards). APPENDED rather than replacing, so several consumes
  // in one action — Feastmaster Vhal's two neighbours, a Gilded double — all animate instead of just the last.
  // Its OWN channel, not `fodderEaten` (owner 2026-07-25): eating a tavern MINION and eating Fodder are
  // different mechanics that will get different animations. Appended, so several consumes in one action all
  // animate; cleared per action by the reducer alongside the other transient FX.
  state.shopEaten = [...(state.shopEaten ?? []), { uid: offer.uid, eaterUid: eater.uid, cardId: def.id, attack: fa, health: fh, gainA, gainH }];
  state.shopEatenSeq += 1;
  // The eaten minion is DESTROYED, not owned — so its copy goes back to the shared pool, exactly as an unbought
  // offer does on a reroll (`rollShop` returns everything it clears). Without this every consume permanently
  // shrank the run's pool, and with eight Demons eating — two of them every single turn — a long run would
  // visibly run the pool dry.
  returnToPool(state, def.id);
  fire(ctx, 'onConsume', { minion: eater, shop: true }); // `shop` distinguishes a SHOP eat from a Fodder one (Broodlord counts only these)
  // Deliberately NOT `noteFodderConsumed`: that tally is about FODDER. Feeding it here inflated Abhorrent
  // Horror's "stats from Fodder consumed" window and ticked Rune of Consumption's permanent Fodder-aura improve
  // — both paying out for eating something that isn't Fodder at all (owner report 2026-07-25, "maybe something
  // broken from the fodder connection"). `onConsume` still fires, since "a Demon consumed" is the real event.
  return true;
}

/** The RIGHT-most edible shop offer's index, or -1. "Right-most" is the tail of the row, which is what the
 *  cards say; spells/Rubies sitting in the row are skipped since they aren't minions. */
/** Set 2 — Bathing Matriarch: which stat its next grant will pump. Attack on the instance's FIRST turn, then
 *  alternating each turn. Shared by the effect and the printed text so the two can never disagree. */
export function alternateModeOf(card: { eotTick?: number }): 'attack' | 'health' {
  return ((card.eotTick ?? 0) % 2) === 0 ? 'attack' : 'health';
}

export function rightmostShopMinion(state: RunState): number {
  for (let i = state.shop.length - 1; i >= 0; i--) {
    const d = CARD_INDEX[state.shop[i]!.cardId];
    if (d && !d.spell && !d.ruby) return i;
  }
  return -1;
}

/**
 * Demons devour Fodder sitting in the tavern. Called right after a tavern refresh
 * adds Fodder: if you have any Demon on board, each Fodder is eaten by one *random*
 * Demon (2 Demons + 1 Fodder → a coin-flip who eats it). The eater gains the fodder's
 * stats × its multiplier and fires its on-consume effects (Pactstone / Maw / Glutton) —
 * the normal Consume pipeline. Eaten Fodder leaves the tavern. With no Demon on board
 * the Fodder simply stays (buyable). Per the rule, only Fodder *entering* the tavern is
 * checked — placing a Demon next to existing tavern Fodder does not trigger it.
 */
export function consumeTavernFodder(state: RunState): void {
  state.fodderEaten = [];
  const demons = state.board.filter((c) => isTribe(c, 'demon')); // dual-types (Bane = Dragon/Demon) eat too
  if (demons.length === 0) return;
  const rng = makeRng(state.rngCursor);
  const ctx = makeContext(state);
  const eaten: { eaterUid: string; fodderId: string; attack: number; health: number; gainA: number; gainH: number }[] = [];
  for (let i = state.shop.length - 1; i >= 0; i--) {
    const offer = state.shop[i]!;
    const fodder = CARD_INDEX[offer.cardId];
    if (!fodder || !fodder.keywords.includes('FD')) continue;
    const eater = demons[rng.int(demons.length)]!;
    state.shop.splice(i, 1); // eaten — leaves the tavern
    const mult = fodderMultiplier(eater);
    const { attack: fa, health: fh } = offerBuyStats(state, offer); // current buffed value (run buff + per-offer + golden)
    addBuff(eater, 'Consume', fa * mult, fh * mult);
    fire(ctx, 'onConsume', { minion: eater }); // Pactstone / Maw / Glutton pay off
    // Record the Fodder's *effective* (buffed) stats for the ghost, and the eater's actual gain (× mult)
    // so the UI can float the +X/+X on the eater (the shop-phase buff float).
    eaten.push({ eaterUid: eater.uid, fodderId: fodder.id, attack: fa, health: fh, gainA: fa * mult, gainH: fh * mult });
    // Track raw fodder stats (pre-multiplier) for Abhorrent Horror's SoC window.
    noteFodderConsumed(state, fa, fh, eater);
  }
  state.rngCursor = rng.state();
  // Record the consume for the UI to replay (show the Fodder, swirl it into the eater).
  if (eaten.length > 0) {
    state.fodderEaten = eaten;
    state.fodderEatenSeq += 1;
  }
}

/**
 * Cast a spell from the hand (handoff: spells). Resolves its `cast` effects on the
 * chosen target, tallies the cast, and notifies spell-tracking minions (`spellCast`).
 */
/**
 * Funeral on Loan: resolve a BORROWED minion's play — its SHOUT, then its ECHO — out of combat. The caller
 * (the reducer's borrowed-play branch) has already removed the card from hand and won't board it.
 *
 * Order matters and mirrors the card's own wording: it is PLAYED (Shout fires), then destroyed (Echo fires).
 * The Shout used to be skipped entirely — only the Deathrattle ran — so a Discovered minion carrying both
 * silently lost half its text (owner 2026-07-24).
 *
 * The Shout goes through `playedShoutRepeats`, the same helper a real play uses, so it behaves like one
 * rather than like a re-trigger: Drakko's repeats apply, a Warm Embers charge is SPENT, and `lastShoutFires`
 * is stamped so Shout objectives (Echoing Roar, Tooth and Tempo, The Author's Hand) advance. Using
 * `drummerRepeats` here instead — as `replayBattlecry` does — would quietly make it a free re-trigger.
 *
 * A TARGETED Battlecry fires with no explicit target, so its factory's auto-pick fallback chooses. That's the
 * same contract `replayBattlecry` already documents, and it's forced here: the normal play path defers a
 * targeted Shout to a `pendingTarget` prompt, which needs the card to still exist to resolve against — and a
 * borrowed card is gone from hand and never reaches the board.
 */
export function triggerBorrowedEcho(state: RunState, card: BoardCard): void {
  const def = CARD_INDEX[card.cardId];
  const onPlay = def?.effects.filter((e) => e.on === 'onPlay') ?? [];
  if (def && onPlay.length > 0) {
    state.karwindFlash = [];
    const ctx = makeContext(state);
    const repeats = playedShoutRepeats(state, def);
    for (const effect of onPlay) {
      const fn = RECRUIT_FACTORIES[effect.do];
      if (!fn) continue;
      captureBuffFx(ctx.state, card, 'minion', () => { for (let r = 0; r < repeats; r++) fn(ctx, card, effect.params ?? {}, { minion: card }); });
    }
    for (let r = 0; r < repeats; r++) fireBattlecryTriggered(state); // each Battlecry fire procs Karwind
    if (state.karwindFlash && state.karwindFlash.length) state.karwindFlashSeq = (state.karwindFlashSeq ?? 0) + 1;
  }
  fireRecruitDeathrattles(makeContext(state), card);
}

/**
 * FUNERAL ON LOAN — the two beats a borrowed play is made of (owner report 2026-08-28: "the card should hit
 * the board, occupy a space, and then show the death and echo animation"; it used to be one instant mutation
 * with nothing to animate).
 *
 * Deliberately NOT routed through `destroyMinionInShop`, for ONE reason: ORDER. That helper removes the body
 * FIRST (combat's order, so the Echo's summons can fill the slot), but a borrowed body must stay ON the board
 * while its Echo fires — positional Echoes need real neighbours (owner report 2026-08-04: a borrowed Dawnclaw
 * "does not trigger the adjacent shouts").
 *
 * RISE STILL APPLIES. This path originally opted out, on the reasoning that the loan ending is not a death and
 * a Rise would let a borrowed minion stay. The owner overruled that (2026-08-28): "if a minion has rise that is
 * discovered, it should rise in the same way a destroyed minion with rise would." So it shares `riseReturn`
 * with every other shop death — a discovered Rise carrier really does leave you a body, at base Attack with 1
 * Health, and that is the payoff for discovering one.
 *
 * Watchers are still not notified, exactly as before — whether a loan expiry should count as a friendly death
 * is an open design question, not something to alter while fixing presentation.
 */
/**
 * FUNERAL ON LOAN, step 1 — the borrowed minion LANDS, exactly as a played minion does, and stops there.
 *
 * Owner design 2026-08-28: "the minion should be coded to literally land as if it was played, but then the
 * immediate next action is that it is destroyed." So the landing is a real committed state — the board really
 * holds the body — and `pendingDeath` marks it as dying next. The UI draws an ordinary arrival, then
 * dispatches `resolveShopDeath`; anything that is not a UI (a bot, a test, a replay) resolves the same pending
 * death on its very next action, so the outcome never depends on who is watching.
 */
export function landBorrowed(state: RunState, card: BoardCard, at: number): void {
  withRecruitTrigger(
    makeContext(state),
    {
      phase: 'recruit',
      source: { kind: 'minion', id: card.cardId, uid: card.uid, side: 'player', label: CARD_INDEX[card.cardId]?.name },
      trigger: 'onPlay',
      policy: 'ownBeat',
      policyKey: 'system:destroy:shopArrival',
    },
    () => { state.board.splice(at, 0, card); },
  );
  state.pendingDeath = { uid: card.uid, kind: 'loan' };
}

/**
 * Step 2 — the landed body dies: its Echo, its departure, its Rise. Shared by both shop deaths.
 *
 * A `loan` body still owes its Echo (its Shout fired when it landed). A `destroy` body has already had its
 * killer's Shout resolve, and simply dies here.
 *
 * Both keep the body ON the board while the Echo fires, so its summons land where it died — the owner's
 * "summoned as if the minion died where it did".
 */
export function settlePendingDeath(state: RunState): void {
  const pending = state.pendingDeath;
  if (!pending) return;
  state.pendingDeath = undefined;
  const card = state.board.find((c) => c.uid === pending.uid);
  if (!card) return; // already gone (a save round-trip, an odd path) — nothing owed
  withRecruitTrigger(
    makeContext(state),
    {
      phase: 'recruit',
      source: { kind: 'minion', id: card.cardId, uid: card.uid, side: 'player', label: CARD_INDEX[card.cardId]?.name },
      trigger: 'onDeath',
      policy: 'ownBeat',
      policyKey: 'system:destroy:shopDeath',
    },
    () => {
      const willRise = card.keywords.includes('R');
      RISING = willRise ? new Set([card.uid]) : null;
      // The body is dying: the authored dissolve plays for it (suppressed when it is rising — it re-forms).
      stampShopFx(state, { kind: 'death', uid: card.uid, cardId: card.cardId, ...(willRise ? { rise: true } : {}) });
      const wasVacating = state.vacatingUid;
      state.vacatingUid = card.uid; // its Echo's summons land in its place, and it costs no summon slot
      const summonedFrom = state.board.length;
      try {
        if (pending.kind === 'loan') triggerBorrowedEcho(state, card);
        else fireRecruitDeathrattles(makeContext(state), card);
        // A destroy is a real death for watchers (owner ruling 2026-08-26). A loan EXPIRY still is not —
        // whether it should be is an open design question, deliberately unchanged here.
        if (pending.kind === 'destroy') fireOnFriendDeath(state, card);
      } finally {
        state.vacatingUid = wasVacating;
        const gone = state.board.findIndex((c) => c.uid === card.uid);
        if (gone >= 0) state.board.splice(gone, 1);
        // `summonedFrom - 1` discounts the body itself, still on the board when the baseline was taken.
        if (willRise && gone >= 0) riseReturn(state, card, gone, Math.max(0, summonedFrom - 1));
      }
    },
  );
}

/** Fire a BOARD minion's Echo in the shop, as Ossuary Rite / Deathsayer / Rune of the Reliquary do.
 *  Exported for tests: positional Echoes (Dawnclaw) need the minion to actually be on the board, which the
 *  borrowed-card path can never provide. */
export function fireRecruitDeathrattlesForTest(state: RunState, minion: BoardCard): void {
  fireRecruitDeathrattles(makeContext(state), minion);
}

export function castSpell(state: RunState, spellDef: CardDef, target?: BoardCard): void {
  const ctx = makeContext(state);
  // SPELLHIDE + SPELLMARKET both key off "the first STAT-GRANTING Shop spell you cast on a minion this turn",
  // so "stat-granting" is measured across the cast rather than inferred from the card: the spell qualifies
  // when the target actually ended up bigger. Snapshot each stat before, diff after.
  const preAtk = target?.attack ?? 0;
  const preHp = target?.health ?? 0;
  applyCastEffects(ctx, spellDef, target); // board-wide spells (Growth) run without a target
  if (target && state.board.includes(target)) {
    const dAtk = target.attack - preAtk;
    const dHp = target.health - preHp;
    if (dAtk > 0 || dHp > 0) {
      // RUNE OF SPELLHIDE: the turn's first stat spell landed on a BEAST is remembered and cast on that same
      // Beast AGAIN at Start of Combat. Stored as {spellId, uid} rather than as stats, so the re-cast runs the
      // real spell in combat — a spell whose value scales with run state pays its live value, not this one.
      const def = CARD_INDEX[target.cardId];
      if (state.runeSpellhide && !state.spellhideUsedThisTurn && (def?.tribe === 'beast' || def?.tribe2 === 'beast')) {
        state.spellhideUsedThisTurn = true;
        (state.spellhidePending ??= []).push({ spellId: spellDef.id, uid: target.uid });
      }
      // RUNE OF THE SPELLMARKET: the turn's first stat spell on ANY friendly minion also hands the same stats
      // to the RIGHT-MOST Shop offer. The DELTA is what moves, so a spell that scales with run state feeds the
      // Shop exactly what it just granted rather than its printed number.
      if (state.runeSpellmarket && !state.spellmarketUsedThisTurn && state.shop.length > 0) {
        procRune(state, 'runeSpellmarket');
        state.spellmarketUsedThisTurn = true;
        // The delta lands once per copy held (owner 2026-08-27, unique-engine doubling).
        const sm = runeStacksOf(state, 'rune_spellmarket');
        addOfferBuff(state.shop[state.shop.length - 1]!, 'Rune of the Spellmarket', dAtk * sm, dHp * sm);
      }
    }
  }
  // Set 2 — tell the TARGET a spell landed on it (Mirrorwing re-casts, Runefire spreads). Fired after the
  // spell's own effects so the minion reacts to a resolved cast, and only for a real board target: an
  // untargeted spell has no "this" to be cast on. The re-entrancy guard lives in `fireOnSpellCastOnThis`.
  if (target && state.board.includes(target)) fireOnSpellCastOnThis(state, target, spellDef);
  // Rune of Lorekeeping: a Shop spell cast ON a minion gives that minion an extra +4/+4 — any targeted spell,
  // not just stat ones (the sheet says "on a minion", so a targeted Gild or Runefire counts too).
  if (target && state.runeLorekeeping && state.board.includes(target) && !spellDef.ruby) {
    procRune(state, 'runeLorekeeping');
    // +4/+4 per copy held (recurring family, owner 2026-08-27).
    const lk = 4 * runeStacksOf(state, 'rune_lorekeeping');
    captureBuffFx(state, undefined, 'spell', () => addBuff(target, 'Rune of Lorekeeping', lk, lk));
  }
  // Untargeted "run" cast effects (e.g. Ember Pouch) act on the run, not a minion.
  // Embers are uncapped within a turn (like selling), so no max-embers clamp here.
  for (const effect of spellDef.effects) {
    if (effect.on === 'cast' && effect.do === 'gainEmbers') {
      // Rune of Pillaging: your Gold Pouches (the Gold Pouch spell) are worth `goldPouchValue` Gold instead of 1.
      const gain = spellDef.id === 'emberpouch' && state.goldPouchValue ? state.goldPouchValue : num(effect.params?.amount);
      gainGold(state, gain);
    }
  }
  // …then the bookkeeping every cast owes the run, shared with the Discover-spell path in the reducer.
  noteSpellCast(state, spellDef);
}


/**
 * The bookkeeping every SPELL CAST owes the run, independent of what the spell actually does: the per-turn and
 * lifetime tallies, first/last-spell memory, the Ruby+Spell umbrella meter, Grimoire's charge, the spell runes,
 * and the board's `spellCast` watchers.
 *
 * Extracted from `castSpell` (owner report 2026-07-27: "Sprout doesn't trigger Runebloom Matriarch or
 * Groveweaver"). A DISCOVER spell — Sprout, Help Wanted, Tribe Portal, Corpse Board, Beyond the Summit,
 * Rift-Sunk Codex — resolves through `discoverOnPlay` in the reducer and RETURNS before ever reaching
 * `castSpell`, so it counted as no spell at all: not for `spellsCast`, not for the quest tallies, and not for
 * any `spellCast` watcher. It looked like two broken Beast cards; it was every spell-counting card in the game
 * silently ignoring a whole class of spells.
 *
 * Call this from any path that resolves a spell WITHOUT running `effects[]`.
 */
/** Rune of Summoning's printed per-cast Imp improvement. Lives here (not in the reward data) because the
 *  reward kind carries no amount; the card text is the contract — keep the two in lockstep. */
const RUNE_SUMMONING_STEP = 2;

export function noteSpellCast(state: RunState, spellDef: CardDef): void {
  // A REWARD card (`token: true` — Goldcrafter, Implosion, Copycat, the Triple Reward…) is NOT a Shop spell
  // (owner rule 2026-08-01, extended to every cast path 2026-08-04): it resolves its own effect and nothing
  // else. No cast tallies or thresholds, no first/last-spell memory — so no copy effect (Spell Warden,
  // Steward, Recaller, Recurrence, Mushy) can ever duplicate it — no spellCast watchers, no Grimoire spend,
  // no spell runes. The ONLY way to copy one is a hand-card copy (Re-Pete's Second Hand), which ignores
  // classification entirely. It still counts as a CARD played (`playedThisTurn`, stamped by the reducer),
  // and cast MULTIPLIERS still apply to its own resolution (Nimbus doubling Implosion is pinned behaviour —
  // the charge concerns what the cast DOES, not what it counts as).
  if (spellDef.token) return;
  // A GIFT (owner design 2026-08-26) DOES pay everything below — tallies, thresholds, the Ruby+Spell umbrella,
  // the `spellCast` watchers — because a Gift counts as a spell CAST. What it never does is become COPY FOOD:
  // each copy path below (`firstSpellThisTurnId`, Mushy's charge, `lastSpellCastId`, the echo runes) skips a
  // Gift explicitly, which together with `singleCast` on every Gift def is the whole "cannot be duplicated"
  // rule. It is not a *Shop* spell, only a spell cast.
  const ctx = makeContext(state);
  // Rune of Recurrence: remember the FIRST spell cast each turn (recast at End of Turn). Recorded before the
  // tally below so the turn's opening cast — and only it — lands here; the EoT recast itself can never
  // re-record (spellsThisTurn is nonzero by then).
  // A GIFT is never recorded as the turn's first spell: Rune of Recurrence recasts that id at End of Turn,
  // which would duplicate a Gift (owner rule 2026-08-26 — a Gift is not a Shop spell and can't be copied).
  if (state.spellsThisTurn === 0 && !spellDef.gift) state.firstSpellThisTurnId = spellDef.id;
  // Set 2 — Chef Gary Toast reads "Ales triggered this turn", so the tally lives with the other per-turn counters.
  if (ALE_IDS.includes(spellDef.id)) {
    if (state.aleExtraCasts) procRuneId(state, 'rune_bottomless_cask');
    state.alesCastThisTurn = (state.alesCastThisTurn ?? 0) + 1;
    // Rune of the Shared Table: every Ale cast buffs ONE friendly minion of each type. Same "one per tribe"
    // spread Fatecarver uses, so a dual-tribe body fills both its slots rather than being counted twice.
    const st = state.runeSharedTable;
    if (st) {
      procRuneId(state, 'rune_shared_table');
      const seen = new Set<string>();
      for (const c of state.board) {
        const def = CARD_INDEX[c.cardId];
        if (!def) continue;
        const tribes = [def.tribe, def.tribe2].filter((t): t is Tribe => !!t && t !== 'neutral');
        if (tribes.length === 0 || tribes.every((t) => seen.has(t))) continue;
        for (const t of tribes) seen.add(t);
        addBuff(c, 'Rune of the Shared Table', st.attack, st.health); // accumulated per copy at the dispatcher (owner 2026-08-27)
      }
    }
  }
  // Mushy: the FIRST spell cast on/after the armed wave copies itself to hand. Fired here so it
  // catches every cast path once; the wave gate makes "next turn" exact — a charge armed in this turn's combat
  // has `activateWave = wave + 1`, so it can't pay out until the following turn.
  const sfCharge = state.nextTurnSpellCopies;
  if (!spellDef.gift && state.spellsThisTurn === 0 && sfCharge && state.wave >= sfCharge.activateWave && sfCharge.count > 0) {
    conjureToHand(state, [spellDef], sfCharge.count);
    state.nextTurnSpellCopies = undefined;
  }
  // The `rubyCast` trigger is the UMBRELLA of Rubies + Shop Spells (owner 2026-07-24), matching the
  // `spellsCast + rubyCasts` contract documented on `RunState.rubyCasts` — so Gemgorge Fiend's "every 3"
  // counts a Shop Spell exactly like a Ruby. Fired here so EVERY cast path routes through it once per cast.
  const castUmbrellaBefore = state.spellsCast + (state.rubyCasts ?? 0);
  state.spellsCast += 1;
  state.spellsThisTurn += 1;
  advanceRuneThresholds(state, 'spellCast', 1);
  // Rune of Runic Exchange pays out in Ales, so counting Ales would let it feed itself — its meter excludes them.
  if (!ALE_IDS.includes(spellDef.id)) advanceRuneThresholds(state, 'spellCastNonAle', 1);
  // Living Grimoire's charge is spent by this cast (consumed here at the real cast, not in the read-only
  // `spellCasts` the UI previews with). `casts` was already computed with the charge, so the full multiplied
  // count still resolves; clearing after keeps the NEXT spell single.
  consumeGrimoireCharge(state);
  fireOnRubyCast(state, castUmbrellaBefore, castUmbrellaBefore + 1);
  // Steward of Spells copies the most recent spell cast — so a Gift deliberately does NOT become that memory.
  if (!spellDef.gift) state.lastSpellCastId = spellDef.id;
  // RUNE OF LIVING MAGIC (1 use) / RUNE OF PERFECT RECALL (2 uses): after a Shop-spell cast, a COPY lands in
  // hand. ONE budget for both runes — holding both raises the ceiling to 3 rather than the two firing
  // independently, the same way the Mage-Pup teach cap is shared. The budget is spent BEFORE the conjure so a
  // copy that itself gets cast this turn can only draw from what is left. `NO_COPY_SPELLS` and the `token`
  // early-return above are what keep an uncopyable spell (or a reward token) out of the loop.
  const echo = state.runeSpellEcho;
  if (echo && echo.used < echo.uses && !spellDef.gift && !NO_COPY_SPELLS.has(spellDef.id)) {
    echo.used += 1;
    procRuneId(state, echo.uses >= 2 ? 'rune_perfect_recall' : 'rune_living_magic');
    conjureToHand(state, [spellDef], 1);
  }
  // RUNESNOUT ARCHIVIST's journal: the FIRST Shop spell of each turn, and only on turns an Archivist is
  // actually on the board — so the card records what it witnessed rather than inheriting a history that
  // predates it. `rememberedThisTurn` is the once-per-turn latch (cleared at `faceOmen` with the other
  // per-turn state). Rubies aren't Shop spells for this purpose, matching every other "Shop spell" rule.
  if (!state.rememberedThisTurn && !spellDef.ruby
      && state.board.some((c) => c.cardId === 'runesnout_archivist')) {
    state.rememberedThisTurn = true;
    (state.rememberedSpellIds ??= []).push(spellDef.id);
  }
  state.lastSpellThisTurnId = spellDef.id; // Recaller copies the last Shop spell cast THIS TURN
  // Rune of Summoning: each spell cast permanently improves your Imps +1/+1 (run-wide, via the Imp enchant —
  // "improve your Imps" applies twice under Rune of Mastery).
  if (state.runeSummoning) {
    procRune(state, 'runeSummoning');
    // The printed step is +2/+2 (owner fix 2026-08-28): the code paid +1/+1 while the card promised +2/+2 —
    // a text/code drift the text oracle caught. The owner's duplicate ruling settles the direction: "rune of
    // summoning = your imps get +4/+4" for a SECOND copy, which is 2x the printed step, so the TEXT was right.
    // Copies multiply it (2 copies = +4/+4) and Rune of Mastery's extra Improve step multiplies it again.
    const sr = RUNE_SUMMONING_STEP * improveReps(state) * runeStacksOf(state, 'rune_summoning');
    buffImpsRunWide(state, sr, sr, 'Rune of Summoning');
  }
  // Rune of Kindling: each spell cast gives your LEFT and RIGHT-most board minions +4/+6 (owner balance
  // 2026-08-19; was +2/+2, and before that left-most only at +3/+3). Wrapped for FX so the gain descends onto
  // the minion instead of the number jumping. On a one-minion board the two ends are the same body, so buff it
  // once (not twice).
  // RUNE OF MIGHT: every Shop spell you cast ALSO casts Might of Aeon. A real cast through `applyCastEffects`,
  // so it picks up spell power and the spell counters see it — but guarded against recursion, since the cast it
  // triggers would otherwise re-enter this same hook forever.
  if (state.runeMight && !state.runeMightCasting) {
    procRune(state, 'runeMight');
    const might = CARD_INDEX['mightofaeon'];
    if (might) {
      state.runeMightCasting = true;
      // One Might of Aeon per copy held (recurring family, owner 2026-08-27); the guard still blocks recursion.
      try { for (let k = 0; k < runeStacksOf(state, 'rune_might'); k++) applyCastEffects(makeContext(state), might, undefined); }
      finally { state.runeMightCasting = false; }
    }
  }
  if (state.runeKindling && state.board.length > 0) {
    procRune(state, 'runeKindling');
    const ends = state.board.length === 1
      ? [state.board[0]!]
      : [state.board[0]!, state.board[state.board.length - 1]!];
    const kd = runeStacksOf(state, 'rune_kindling'); // fires once per copy held (recurring family, owner 2026-08-27)
    captureBuffFx(state, undefined, 'spell', () => { for (const t of ends) addBuff(t, 'Rune of Kindling', 4 * kd, 6 * kd); });
  }
  // Rune of Enchantment: each spell cast gives your minions +2/+3, permanently (owner 2026-08-11; was +1/+1).
  // The +4/+6 half is the COMBAT cast — see `runeEnchantment` in simulate.ts; a shop cast is the printed +2/+3.
  if (state.runeEnchantment) {
    procRune(state, 'runeEnchantment');
    const en = runeStacksOf(state, 'rune_enchantment'); // fires once per copy held (recurring family, owner 2026-08-27)
    captureBuffFx(state, undefined, 'spell', () => {
      for (const c of state.board) addBuff(c, 'Rune of Enchantment', 2 * en, 3 * en);
    });
  }
  // Rune of the Flagship: each spell cast gives your Dwarves +2/+2 (board + hand), the Scales shape tribe-swapped.
  if (state.runeFlagship) {
    procRune(state, 'runeFlagship');
    const fs = runeStacksOf(state, 'rune_flagship'); // fires once per copy held (recurring family, owner 2026-08-27: "+4/+4 per Shop spell" with two)
    captureBuffFx(state, undefined, 'spell', () => {
      for (const c of [...state.board, ...state.hand]) if (isTribe(c, 'dwarf')) addBuff(c, 'Rune of the Flagship', 2 * fs, 2 * fs);
    });
  }
  // Rune of Scales: each spell cast gives your Dragons +4/+5 (board + hand) — descends onto each affected board Dragon.
  if (state.runeScales) {
    const sc = runeStacksOf(state, 'rune_scales'); // fires once per copy held (recurring family, owner 2026-08-27)
    captureBuffFx(state, undefined, 'spell', () => {
      procRuneId(state, 'rune_scales');
      for (const c of [...state.board, ...state.hand]) if (isTribe(c, 'dragon')) addBuff(c, 'Rune of Scales', 4 * sc, 5 * sc); // owner 2026-08-11 (was +2/+2)
    });
  }
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    // Rune of the Matriarch: Runebloom Matriarch's per-spell trigger fires twice.
    const reps = state.runeMatriarch && card.cardId === 'b2_runebloom' ? 2 : 1;
    for (const effect of def.effects) {
      if (effect.on !== 'spellCast') continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      // `spellDef` lets a watcher record WHICH spell was cast (Spellkeeper's "the first one"), not just that
      // one was. Fires only for SHOP SPELLS — Rubies don't route through `castSpell`, so they never count here.
      if (fn) for (let rep = 0; rep < reps; rep++) captureBuffFx(ctx.state, card, 'minion', () => fn(ctx, card, effect.params ?? {}, { minion: card, spellDef }));
    }
  }
}

/** Cast a stat/keyword spell onto a TAVERN OFFER (`target: 'any'` spells like Shatter, Front to Back).
 *  Builds a throwaway BoardCard from the offer's current state, runs the normal cast effects on it, then
 *  folds the net stat + added-keyword changes back onto the ShopCard so they bake in when bought (the way
 *  the Fortify hero power's offer buff already does). The rest of `castSpell` (tally, spell power,
 *  spellCast triggers) still runs on the run. NB: a spell that *removes* a base keyword can't subtract it
 *  from an offer (offers only carry added keywords) — a rare edge that resolves once the minion is bought. */
export function castSpellOnOffer(state: RunState, spellDef: CardDef, offer: ShopCard): void {
  const card = CARD_INDEX[offer.cardId];
  if (!card) return;
  const base = card.keywords;
  const temp: BoardCard = {
    uid: offer.uid,
    cardId: offer.cardId,
    tribe: card.tribe,
    attack: card.attack + (offer.atk ?? 0),
    health: card.health + (offer.hp ?? 0),
    keywords: [...base, ...(offer.keywords ?? []).filter((k) => !base.includes(k))],
    golden: false,
  };
  castSpell(state, spellDef, temp);
  // Fold the result back against what the card IS NOW — a transform (Strange Revision, owner 2026-08-04)
  // rewrites `temp.cardId`, so the offer becomes the new minion and the deltas re-base on ITS printed stats
  // (the factory already re-based the bonus stats onto the new form). For every ordinary spell
  // `after === card` and this is byte-identical to the old fold.
  const after = CARD_INDEX[temp.cardId] ?? card;
  offer.cardId = temp.cardId;
  offer.atk = temp.attack - after.attack;
  offer.hp = temp.health - after.health;
  offer.keywords = temp.keywords.filter((k) => !after.keywords.includes(k)); // keep only the keywords the spell added
}

/**
 * ── THE SHOP-SIDE RALLY DISPATCHER (Effect Arena, Step 4) ──────────────────────────────────────────────
 *
 * Rally is an `onAttack` trigger, which is why "trigger your Rallies" was combat-only at any price: nothing
 * in the shop ever dispatched `onAttack`. With the family migrated onto the arena (`ARENA_EFFECTS`, Step 3
 * item 4) both halves are the SAME body, so a shop dispatch is now just this — a caller.
 *
 * `canRallyInShop` is the recruit twin of combat's `canRally`: the `RL` keyword plus a real `onAttack` effect
 * (a card with the badge and nothing behind it is not "a Rally to trigger"), OR a welded Mech/spell rally
 * (Better Bot / Perfect Core), which is exactly what combat's `fireFreeRally` also pays out.
 *
 * `fireShopRally` BROADCASTS, the way a real attack does: every board body's `onAttack` effects are offered
 * the event with the rallier as `payload.minion`. That is what makes the ally-attack watchers — Paragon's
 * "whenever you trigger a Rally", Hawkus, Mineral Master, Crypt Drake — answer a shop rally the same way
 * they answer a swing, instead of the rallier's own effect firing into silence.
 */
export function canRallyInShop(card: BoardCard): boolean {
  // `combatOnly` (Sunmane Herald): an effect scoped out of the shop is not "a Rally to trigger" here at all —
  // no beat, no rally tally (owner ruling 2026-08-20; its viral graft loops under Lasting Cadence).
  return (card.keywords.includes('RL') && instanceEffects(card).some((e) => e.on === 'onAttack' && !e.combatOnly))
    || (card.rallyMechAtk ?? 0) > 0 || (card.rallySpellWeld ?? 0) > 0;
}

/** The board bodies that have a Rally to trigger, in board order. */
export function ralliersOf(state: RunState): BoardCard[] {
  return state.board.filter(canRallyInShop);
}

/** Fire ONE board minion's Rally in the shop — the recruit twin of combat's `fireFreeRally`. */
export function fireShopRally(state: RunState, card: BoardCard): void {
  if (!state.board.includes(card)) return; // an earlier rally removed it — the beat still keeps its window
  const ctx = makeContext(state);
  // PRESENTATION: each (watcher × effect) dispatch is its OWN nested trigger, carrying the watcher as source
  // and the effect's registry identity — exactly what a played Shout does (`withPlayTrigger` stamps
  // `factory:<do>:onPlay`). Without this, everything a rally did in the shop collapsed under the rune's single
  // outer `sourceTrigger` with no per-effect identity, so the compiled batch had NOTHING for the per-minion
  // authored FX / watcher pulses to bind to — Echohorn's sparkle, Hawkus's reaction and every other authored
  // def played in combat but not on the End-of-Turn rally beats (owner report 2026-08-20). With NO collector
  // capturing (`fireRallies` in tests, the legacy projection) `withRecruitTrigger` is a bare call, so
  // gameplay is byte-identical.
  const rallySource = (m: BoardCard): TriggerSourceRef =>
    ({ kind: 'minion', id: m.cardId, uid: m.uid, side: 'player', label: CARD_INDEX[m.cardId]?.name });
  if (card.keywords.includes('RL') && instanceEffects(card).some((e) => e.on === 'onAttack' && !e.combatOnly)) {
    for (const watcher of [...state.board]) {
      const align = alignmentOf(state.board, watcher.uid); // CELESTIAL: gate aligned halves exactly as EoT does
      for (const effect of instanceEffects(watcher)) {
        if (effect.on !== 'onAttack') continue;
        if (effect.combatOnly) continue; // Sunmane Herald's class: scoped out of the shop at the data level
        if (!alignAllows(effect, align)) continue;
        const fn = RECRUIT_FACTORIES[effect.do];
        if (!fn) continue;
        // `discardIfEmpty`: the broadcast offers this rally to EVERY board body, and each wrapper's own
        // guard (`payload.minion !== self` for an own-attack Rally) decides inside the scope — a guarded-out
        // no-op must not leave an empty beat that falsely pulses a bystander.
        withRecruitTrigger(
          ctx,
          { phase: 'endOfTurn', source: rallySource(watcher), trigger: 'onAttack', ...beatIdentity(`factory:${effect.do}:onAttack`) },
          () => fn(ctx, watcher, effect.params ?? {}, { minion: card }),
          { discardIfEmpty: true },
        );
      }
    }
  }
  // The welded rallies, exactly as `fireFreeRally` pays them out — one nested trigger on the rallying card.
  const mechAtk = card.rallyMechAtk ?? 0;
  const spellWeld = card.rallySpellWeld ?? 0;
  if (mechAtk > 0 || spellWeld > 0) {
    withRecruitTrigger(
      ctx,
      { phase: 'endOfTurn', source: rallySource(card), trigger: 'onAttack', ...beatIdentity('system:shopRally:weld') },
      () => {
        if (mechAtk > 0) {
          for (const m of state.board) if (m !== card && isTribe(m, 'mech')) addBuff(m, 'Better Bot', mechAtk, 0);
        }
        if (spellWeld > 0) conjureToHand(state, poolOf(state).spells.filter((c) => !c.token), spellWeld);
      },
      { discardIfEmpty: true }, // Better Bot with no other Mech on the board changes nothing — no beat
    );
  }
  // A SHOP rally is a Rally TRIGGER (owner ruling 2026-08-20) — it advances the `rally` quest objective and
  // the Author's Hand rally half exactly like a combat one. Counted HERE, at the single chokepoint every
  // shop rally passes through, for the same reason combat hooks everything at `bumpRally`: one definition of
  // "a Rally", never two drifting ones. The reducer consumes `lastRallyFires` per action (the
  // `lastShoutFires` pattern); Rune of the Herding Horn pays inline, as its combat half does.
  state.lastRallyFires = (state.lastRallyFires ?? 0) + 1;
  // One free refresh per copy held (boolean-flag family, owner 2026-08-27 — `flagCopies` is the copy channel).
  if (state.questFlags?.runeHerdingHorn) { procRuneId(state, 'rune_herding_horn'); state.freeRolls += Math.max(1, state.flagCopies?.runeHerdingHorn ?? 1); }
}

/**
 * Fire EVERY rally-capable board minion's Rally once — Rune of Lasting Cadence's payout.
 *
 * Snapshotted before firing: a Rally may summon, and a body that arrives mid-pass has not "had" a Rally to
 * trigger (the same rule the combat rune states). The two per-FIGHT counters the family carries (`attackSeen`,
 * `bredCount`) are scoped to this pass and cleared after it, so a shop rally can never inherit last turn's
 * progress — Evolving Abomination gets its 2 doublings per End of Turn, not 2 per run.
 *
 * Callers own the beats. `applyEndOfTurn` fires one `fireShopRally` PER BEAT so each rally is allotted its
 * own animation window; this whole-board helper exists for a caller that wants the batch (and for tests).
 */
export function fireRallies(state: RunState): void {
  const ralliers = ralliersOf(state);
  for (const card of ralliers) {
    if (!state.board.includes(card)) continue; // a previous rally removed it
    fireShopRally(state, card);
  }
  clearRallyPassCounters(state);
}

/** Reset the per-pass Rally counters (see `fireRallies`). Exported so the beat-per-rally path in
 *  `applyEndOfTurn`, which fires them one at a time, can clear once at the end of the whole pass. */
export function clearRallyPassCounters(state: RunState): void {
  for (const c of state.board) { delete c.attackSeen; delete c.bredCount; }
}

/**
 * ── THE SHOP-SIDE START-OF-COMBAT DISPATCHER (Effect Arena, Step 4) ────────────────────────────────────
 *
 * The Rally dispatcher's motion, applied to the second family. Start of Combat is a PER-BODY trigger — no
 * card watches "a Start of Combat happened" — so unlike `fireShopRally` this does NOT broadcast: each fire
 * is one (body × effect), offered to that body's own wrapper only.
 *
 * `socBoardEffects` is the eligibility scan: every `startOfCombat` effect a board INSTANCE carries
 * (printed + grafted, via `instanceEffects`), alignment-gated exactly as the combat pass gates it, and
 * filtered to effects a shop wrapper exists for (today that is all of them — the filter is the same
 * no-hand-selection guard `fireShopRally` gets from the registry lookup). SNAPSHOTTED before anything
 * fires: a body summoned mid-pass (Mirrorhide's copy) has not "had" a Start of Combat to fire — the same
 * rule combat states by not re-firing SC on combat summons. The family carries no per-fight counters
 * (`attackSeen`/`bredCount` are Rally's), so there is nothing to scope or clear here.
 *
 * COMBAT MULTIPLIERS FOLLOW THE TRIGGER (owner reversal 2026-08-20, superseding the ship ruling): Rune of
 * Twilight and Uron's trigger multiplier apply to the End-of-Turn replay too — a trigger multiplier follows
 * the trigger to whatever phase it fires in. The scan itself stays multiplier-free; the fire COUNT lives in
 * `runeCombatProwessBeats`, which folds `socTwilightExtraFires` (the same definition combat's Twilight pass
 * consults) and `extraTriggerFires('startOfCombat', …)` (the same card-data fold combat's `scReps` uses), so
 * each fire is its own beat and the two phases can never drift.
 */
export function socBoardEffects(state: RunState): Array<{ card: BoardCard; effect: EffectDef }> {
  const out: Array<{ card: BoardCard; effect: EffectDef }> = [];
  for (const card of state.board) {
    const align = alignmentOf(state.board, card.uid); // CELESTIAL: gate aligned halves exactly as combat's SC pass does
    for (const effect of instanceEffects(card)) {
      if (effect.on !== 'startOfCombat') continue;
      if (effect.combatOnly) continue; // the Sunmane rule, applied family-wide: combatOnly never dispatches in the shop
      if (!alignAllows(effect, align)) continue;
      if (!RECRUIT_FACTORIES[effect.do]) continue;
      out.push({ card, effect });
    }
  }
  return out;
}

/** Fire ONE board minion's ONE Start-of-Combat effect in the shop — the recruit twin of the combat SC pass. */
export function fireShopStartOfCombat(state: RunState, card: BoardCard, effect: EffectDef): void {
  if (!state.board.includes(card)) return; // removed since the snapshot — the beat still keeps its window
  const ctx = makeContext(state);
  const fn = RECRUIT_FACTORIES[effect.do];
  if (!fn) return;
  // PRESENTATION (the shop-rally lesson, 2026-08-20): the dispatch is its OWN nested trigger, sourced on the
  // acting minion and carrying the effect's `factory:<do>:startOfCombat` registry identity — what the
  // authored FX and pulses bind to. `discardIfEmpty` drops the scope when a guarded/inert body (an
  // enemy-facing strike, a combat-only channel) changes nothing, so no bystander beat falsely pulses.
  const source: TriggerSourceRef = { kind: 'minion', id: card.cardId, uid: card.uid, side: 'player', label: CARD_INDEX[card.cardId]?.name };
  withRecruitTrigger(
    ctx,
    {
      phase: 'endOfTurn',
      source,
      trigger: 'startOfCombat',
      ...beatIdentity(`factory:${effect.do}:startOfCombat`),
    },
    () => fn(ctx, card, effect.params ?? {}, { minion: card }),
    { discardIfEmpty: true },
  );
}

/**
 * Fire EVERY board Start-of-Combat effect once — Rune of Combat Prowess's payout, batched (for tests and
 * any caller that wants the whole pass; `applyEndOfTurn` fires one per BEAT instead, so each effect is
 * allotted its own animation window).
 */
export function fireStartOfCombats(state: RunState): void {
  for (const { card, effect } of socBoardEffects(state)) {
    fireShopStartOfCombat(state, card, effect);
  }
}

/**
 * ── RUNE / QUEST START-OF-COMBAT REPLAYS (Rune of Combat Prowess, owner ruling 2026-08-20) ─────────────
 *
 * "Needs to work with ALL Start of Combat effects including runes/quests etc." — the run-level SoC blocks
 * `simulate()` fires (the `rmods.…` / `smods.…` section) replay at End of Turn too, with SHOP semantics:
 * every grant is PERMANENT, membership-based effects no-op gracefully on an empty membership, random picks
 * draw the run's seeded `rngCursor`, and each replay is its own beat sourced on the OWNING rune/quest badge
 * (no minion is the actor).
 *
 * GENUINELY COMBAT-ONLY, each with its reason (deliberate no-ops — they are simply absent from this list):
 *   - `weakenTargets` (Weaken)      — enemy-facing; the shop has no enemies (membership no-op).
 *   - `runeFoodChain`               — arms a combat summon-inheritance bank; nothing consumes it in a shop.
 *   - `runeSpellhide`               — the remembered spell already really resolved in the shop when it was
 *                                     cast; the rune's whole payoff is repeating it in COMBAT. An End-of-Turn
 *                                     re-cast would re-count a cast the player never made.
 *   - `runeCrucible`                — sacrifices bodies into a last-death resummon bank; its payoff event
 *                                     (your final minion dying) cannot happen in the shop.
 *   - `emptyGraves`                 — a per-FIGHT grant to the combat-time leftmost (`emptyGravesRally` is a
 *                                     combat-instance flag); a permanent shop grant would stack on top of the
 *                                     grant combat still makes every fight.
 *   - `runeFirstClaws` / Forthcoming's attack half / Shared Circuit's break-transfer / the Reclaimer +
 *     Closed Casket marks / Blood Trail's kill-watcher — forced attacks, shield breaks, death banks: combat
 *     machinery with no shop meaning.
 *
 * COMPOUNDING WARNING (flagged for balance review — implemented per the owner's "all" ruling): the stat
 * blocks below are PERMANENT and re-fire EVERY turn while Combat Prowess is held. Warding (health ×3/turn),
 * Sylus (own health ×2/turn), Underdog + Stoked Menagerie (stat doubling), Umbral Energy + United Front
 * (per-spells-cast, a growing scalar), Five Banners, Tempered Time, Possession and Rulebreaker's Crown all
 * snowball run-scale numbers fast.
 *
 * THE single source shared by `applyEndOfTurn` (the commit), `projectEndOfTurnSteps` (the projection) and
 * `questEndOfTurnBeats` (the UI beat sequence) — the Lasting Cadence single-list rule. Chronos/Parliament
 * repeats apply (the caller multiplies); combat's SC multipliers (Twilight/Uron) do NOT — in combat they
 * multiply only the MINION SC pass, never the rune blocks, and the shop mirrors that boundary exactly.
 */
export interface SocRuneReplay {
  /** Owning content id — the badge the beat is sourced on (`procRuneId` pulses a rune's rail badge). */
  id: string;
  kind: 'rune' | 'quest' | 'hero';
  label: string;
  /** `true` when `fire` opens its OWN nested `withRecruitTrigger`s (Rune of Rallying → `fireShopRally`) —
   *  the caller must then use a PLAIN scope, or every consequence would emit twice (the Lasting Cadence
   *  double-emission rule). */
  nested?: boolean;
  fire: (state: RunState) => void;
}

export function socRuneReplaysOf(state: RunState): SocRuneReplay[] {
  const f = state.questFlags;
  const out: SocRuneReplay[] = [];
  const grantKw = (c: BoardCard, kw: Keyword): void => { if (!c.keywords.includes(kw)) c.keywords = [...c.keywords, kw]; };
  // The Five Banners / United Front selection (combat's rule, verbatim): universal-tribe bodies always
  // collect; every other body claims the FIRST type nobody has claimed yet — one banner per body.
  const bannerRecipients = (st: RunState): BoardCard[] => {
    const recipients = st.board.filter((m) => !!CARD_INDEX[m.cardId]?.universalTribe);
    const taken = new Set<string>();
    for (const m of st.board) {
      const def = CARD_INDEX[m.cardId];
      if (def?.universalTribe) continue;
      for (const t of [def?.tribe, def?.tribe2]) {
        if (!t || t === 'neutral' || taken.has(t)) continue;
        taken.add(t);
        if (!recipients.includes(m)) recipients.push(m);
        break;
      }
    }
    return recipients;
  };
  // Rulebreaker's Crown: the leftmost minion gains +Attack equal to its Attack (permanent here). COMPOUNDING.
  if (f?.doubleLeftmostAttack) out.push({ id: 'doubleLeftmostAttack', kind: 'quest', label: "Rulebreaker's Crown", fire: (st) => {
    const lead = st.board[0];
    if (lead && lead.attack > 0) addBuff(lead, "Rulebreaker's Crown", lead.attack, 0);
  } });
  // Atrius's Possession: leftmost gains the rightmost's Attack, rightmost gains the leftmost's Health —
  // simultaneous (both read the pre-buff values), needs 2+ bodies. COMPOUNDING.
  if (hasPower(state, 'possession')) out.push({ id: state.heroId, kind: 'hero', label: 'Possession', fire: (st) => {
    if (st.board.length < 2) return;
    const first = st.board[0]!, last = st.board[st.board.length - 1]!;
    const gainAtk = last.attack, gainHp = first.health;
    if (gainAtk > 0) addBuff(first, 'Possession', gainAtk, 0);
    if (gainHp > 0) addBuff(last, 'Possession', 0, gainHp);
  } });
  // Umbral Energy: every Dragon +3/+3 per spell cast this game. COMPOUNDING (per-turn, growing scalar).
  if (f?.umbralEnergy) out.push({ id: 'umbralEnergy', kind: 'quest', label: 'Umbral Energy', fire: (st) => {
    const amt = 3 * st.spellsCast;
    if (amt <= 0) return;
    for (const m of st.board) if (isTribe(m, 'dragon')) addBuff(m, 'Umbral Energy', amt, amt);
  } });
  // Contract Rewrite: the rightmost Demon gains the Warded-Imps Echo — a PERMANENT graft here (the family's
  // shop-permanence rule), idempotent so it doesn't stack a copy every turn.
  if (f?.contractRewrite) out.push({ id: 'contractRewrite', kind: 'quest', label: 'Contract Rewrite', fire: (st) => {
    const demon = [...st.board].reverse().find((m) => isTribe(m, 'demon'));
    if (!demon) return;
    const already = instanceEffects(demon).some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon' && (e.params as { tokenId?: string } | undefined)?.tokenId === 'impscrap');
    if (already) return;
    (demon.grantedEffects ??= []).push({ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'impscrap', count: 2, fixed: true, keyword: 'DS' } });
  } });
  // Rune of the Warden: if the board has room, summon a Spear Warden (a real, permanent board card).
  if (f?.runeWarden) out.push({ id: 'rune_warden', kind: 'rune', label: 'Rune of the Warden', fire: (st) => {
    const knit = CARD_INDEX['knit'];
    if (knit && st.board.length < CONFIG.boardMax) makeContext(st).summon(knit, ''); // no anchor -> appended rightmost
  } });
  // Rune of the Mirror March: if the board has room, an EXACT copy of the leftmost minion, to its right.
  if (f?.runeMirrorMarch) out.push({ id: 'rune_mirror_march', kind: 'rune', label: 'Rune of the Mirror March', fire: (st) => {
    const lead = st.board[0];
    const def = lead ? CARD_INDEX[lead.cardId] : undefined;
    if (!lead || !def || st.board.length >= CONFIG.boardMax) return;
    const copy = makeContext(st).summon(def, lead.uid);
    if (!copy) return;
    copy.attack = lead.attack; copy.health = lead.health;
    copy.golden = lead.golden; copy.keywords = [...lead.keywords];
  } });
  // Shared Circuit: up to N leftmost unshielded Mechs gain Ward (permanent; the break-transfer half is
  // combat-only — shields don't break in a shop).
  if ((state.sharedCircuitWard ?? 0) > 0) out.push({ id: 'sharedCircuit', kind: 'quest', label: 'Shared Circuit', fire: (st) => {
    let left = st.sharedCircuitWard ?? 0;
    for (const m of st.board) {
      if (left <= 0) break;
      if (m.keywords.includes('DS') || !isTribe(m, 'mech')) continue;
      grantKw(m, 'DS');
      left--;
    }
  } });
  // Rune of the Five Banners: one friendly of each type +6/+6. COMPOUNDING (per-turn permanent).
  if (f?.runeFiveBanners) out.push({ id: 'rune_five_banners', kind: 'rune', label: 'Rune of the Five Banners', fire: (st) => {
    // Once per copy held (boolean-flag family, owner 2026-08-27: "+6/+6 twice").
    const fb = Math.max(1, st.flagCopies?.runeFiveBanners ?? 1);
    for (const m of bannerRecipients(st)) addBuff(m, 'Rune of the Five Banners', 6 * fb, 6 * fb);
  } });
  // Emissary (United Front): the Five Banners selection, +N/+N where N = spells cast this game (Wishbone
  // doubles, as its combat mod does). COMPOUNDING (per-turn, growing scalar).
  if (hasPower(state, 'unitedFront')) out.push({ id: state.heroId, kind: 'hero', label: 'United Front', fire: (st) => {
    const n = st.spellsCast * (st.runeWishbone ? 1 + runeStacksOf(st, 'rune_wishbone') : 1); // wishboneReps, inlined (a reducer import would cycle)
    if (n <= 0) return;
    for (const m of bannerRecipients(st)) addBuff(m, 'United Front', n, n);
  } });
  // Rune of the Centerline: ends of DIFFERENT (primary, non-neutral) types → the middle gains Crit + Ward.
  if (f?.runeCenterline) out.push({ id: 'rune_centerline', kind: 'rune', label: 'Rune of the Centerline', fire: (st) => {
    if (st.board.length < 3) return;
    const left = st.board[0]!, right = st.board[st.board.length - 1]!;
    const mid = st.board[Math.floor(st.board.length / 2)]!;
    const typeOf = (m: BoardCard): string | undefined => (m.tribe && m.tribe !== 'neutral' ? m.tribe : undefined);
    const lt = typeOf(left), rt = typeOf(right);
    if (lt && rt && lt !== rt) { grantKw(mid, 'CR'); grantKw(mid, 'DS'); }
  } });
  // Rune of Tempered Time: +Health equal to HALF each minion's Attack (floored). COMPOUNDING.
  if (f?.runeTemperedTime) out.push({ id: 'rune_tempered_time', kind: 'rune', label: 'Rune of Tempered Time', fire: (st) => {
    for (const m of st.board) {
      const gain = Math.floor(m.attack / 2);
      if (gain > 0) addBuff(m, 'Rune of Tempered Time', 0, gain);
    }
  } });
  // Rune of the Herald: trigger EVERY Echo (bodies stay alive) — the shared shop Echo ritual pays the
  // tallies and every unified multiplier (Sylus/Uron/Elderhorn/Funeral Engine/first-Echo).
  if (f?.runeHerald) out.push({ id: 'rune_herald', kind: 'rune', label: 'Rune of the Herald', fire: (st) => {
    const ctx = makeContext(st);
    for (const m of [...st.board]) {
      if (instanceEffects(m).some((e) => e.on === 'onDeath')) fireRecruitDeathrattles(ctx, m);
    }
  } });
  // Rune of Dawnclaw: your Dawnclaws fire their adjacent-Shout Echo (they don't die) — an Echo TRIGGER,
  // through the shared ritual so it tallies exactly like combat's `asEcho` wrap.
  if (f?.runeDawnclaw) out.push({ id: 'rune_dawnclaw', kind: 'rune', label: 'Rune of Dawnclaw', fire: (st) => {
    const ctx = makeContext(st);
    for (const m of [...st.board]) {
      if (m.cardId === 'b2_dawnclaw') fireRecruitDeathrattles(ctx, m, [{ on: 'onDeath', do: 'deathrattleReplayAdjacentBattlecry', params: {} }]);
    }
  } });
  // Rune of Sylus: your Sylus double their own Health. SEVERE COMPOUNDING (exponential per turn).
  if (f?.runeSylus) out.push({ id: 'rune_sylus', kind: 'rune', label: 'Rune of Sylus', fire: (st) => {
    for (const m of st.board) if (m.cardId === 'sylus') addBuff(m, 'Rune of Sylus', 0, m.health);
  } });
  // Rune of the Underdog: double the stats of the TWO lowest-Attack minions (board-order ties). SEVERE COMPOUNDING.
  if (f?.runeUnderdog) out.push({ id: 'rune_underdog', kind: 'rune', label: 'Rune of the Underdog', fire: (st) => {
    const lowest = st.board.slice().sort((a, b) => a.attack - b.attack).slice(0, 2);
    for (const m of lowest) addBuff(m, 'Rune of the Underdog', m.attack, m.health);
  } });
  // Rune of the Stoked Menagerie: controlling every active type doubles 3 random minions (seeded, without
  // replacement). SEVERE COMPOUNDING.
  if (f?.runeStokedMenagerie) out.push({ id: 'rune_stoked_menagerie', kind: 'rune', label: 'Rune of the Stoked Menagerie', fire: (st) => {
    const onBoard = new Set<string>();
    for (const m of st.board) {
      const def = CARD_INDEX[m.cardId];
      for (const t of [def?.tribe, def?.tribe2]) if (t && t !== 'neutral') onBoard.add(t);
      if (def?.universalTribe) for (const t of st.tribes) if (t !== 'neutral') onBoard.add(t);
    }
    const wanted = st.tribes.filter((t) => t !== 'neutral');
    if (wanted.length === 0 || !wanted.every((t) => onBoard.has(t)) || st.board.length === 0) return;
    const rng = makeRng(st.rngCursor);
    const pool = st.board.slice();
    const picked: BoardCard[] = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) picked.push(...pool.splice(rng.int(pool.length), 1));
    st.rngCursor = rng.state();
    for (const m of picked) addBuff(m, 'Rune of the Stoked Menagerie', m.attack, m.health);
  } });
  // Rune of the Vanguard: your 3 leftmost gain Critical Strike + Ward (permanent, idempotent).
  if (f?.runeVanguard) out.push({ id: 'rune_vanguard', kind: 'rune', label: 'Rune of the Vanguard', fire: (st) => {
    for (const m of st.board.slice(0, 3)) { grantKw(m, 'CR'); grantKw(m, 'DS'); }
  } });
  // Rune of Warding: the rightmost gains Ward and TRIPLE Health. SEVERE COMPOUNDING (health ×3 per turn).
  if (f?.runeWarding) out.push({ id: 'rune_warding', kind: 'rune', label: 'Rune of Warding', fire: (st) => {
    const lead = st.board[st.board.length - 1];
    if (!lead) return;
    grantKw(lead, 'DS');
    addBuff(lead, 'Rune of Warding', 0, lead.health * 2);
  } });
  // Echoing Coop: trigger every minion's Echo once, without killing the body (the shared shop ritual).
  if (f?.echoingCoop) out.push({ id: 'echoingCoop', kind: 'quest', label: 'Echoing Coop', fire: (st) => {
    const ctx = makeContext(st);
    for (const m of [...st.board]) {
      if (instanceEffects(m).some((e) => e.on === 'onDeath')) fireRecruitDeathrattles(ctx, m);
    }
  } });
  // Rune of Rallying: trigger the LEFT-MOST Rally — a real shop Rally (tallies, Herding Horn, nested beats).
  if (f?.runeRallying) out.push({ id: 'rune_rallying', kind: 'rune', label: 'Rune of Rallying', nested: true, fire: (st) => {
    const first = ralliersOf(st)[0];
    if (first) fireShopRally(st, first);
  } });
  // Rune of Forthcoming: the leftmost gains Ward (permanent). Its attack half is combat-only (forced attack).
  if (f?.runeForthcoming) out.push({ id: 'rune_forthcoming', kind: 'rune', label: 'Rune of Forthcoming', fire: (st) => {
    const front = st.board[0];
    if (front) grantKw(front, 'DS');
  } });
  // Rune of Rebirth: a random eligible minion PERMANENTLY gains the exact-copy Echo (seeded pick; the
  // eligibility filter keeps it from stacking a second copy on the same body).
  if (f?.runeRebirth) out.push({ id: 'rune_rebirth', kind: 'rune', label: 'Rune of Rebirth', fire: (st) => {
    const eligible = st.board.filter((m) => !instanceEffects(m).some((e) => e.do === 'echoSummonCopyNoEcho'));
    if (eligible.length === 0) return;
    const rng = makeRng(st.rngCursor);
    const m = eligible[rng.int(eligible.length)]!;
    st.rngCursor = rng.state();
    (m.grantedEffects ??= []).push({ on: 'onDeath', do: 'echoSummonCopyNoEcho', params: {} });
  } });
  // Rune of Rising Graves: the two leftmost Undead without Rise gain it (permanent, idempotent).
  if (f?.runeRisingGraves) out.push({ id: 'rune_rising_graves', kind: 'rune', label: 'Rune of Rising Graves', fire: (st) => {
    let given = 0;
    for (const m of st.board) {
      if (given >= 2) break;
      if (m.keywords.includes('R') || !isTribe(m, 'undead')) continue;
      grantKw(m, 'R');
      given++;
    }
  } });
  return out;
}

/** End-of-Turn triggers — fire when the recruit turn ends (End Turn / timer hits 0),
 *  just before the board faces the Omen. Each minion's effect acts on itself. */
export function applyEndOfTurn(state: RunState): void {
  const collector = currentCollector();
  const beatSource = (kind: TriggerSourceRef['kind'], id: string, label: string, uid?: string): TriggerSourceRef =>
    ({ kind, id, label, uid, side: 'player' });
  /**
   * CHOREOGRAPHER PR 1: one recurring End-of-Turn effect → its full beat identity. The source is now the
   * OWNING rune/quest (id + kind from content) instead of the bare effect name tagged `rune` for everything —
   * so Echoing Roar reads as the quest it is, and the emitted `policyKey` matches the row that classified it.
   */
  const recurringBeatSpec = (effect: string): { source: TriggerSourceRef; trigger: string; policy: PresentationPolicy; policyKey?: string; family?: string } => {
    const owner = recurringEotOwner(effect);
    const label = RECURRING_EOT_LABEL[effect] ?? 'End of Turn';
    return {
      source: beatSource(owner?.kind ?? 'rune', owner?.id ?? effect, label),
      trigger: 'endOfTurn',
      ...(owner ? beatIdentity(owner.key) : { policy: 'ownBeat' as PresentationPolicy }),
    };
  };
  // Rune of the Coffers: every End of Turn raises the ceiling by 1 — before the EoT effects run, so anything
  // that reads maxEmbers this tick already sees the raise. BEAT SYSTEM (PR 5): these two economy runes changed
  // HUD numbers silently (handoff-doc gap §9.1) — now each emits an own-beat resourceChanged consequence.
  if (state.runeCoffers) {
    procRune(state, 'runeCoffers');
    // +1 max Gold per copy held (recurring family, owner 2026-08-27: "+2 max Gold at End of Turn" with two).
    const cf = runeStacksOf(state, 'rune_coffers');
    state.maxEmbers += cf;
    if (collector.enabled) collector.withTrigger(
      { phase: 'endOfTurn', source: beatSource('rune', 'rune_coffers', 'Rune of the Coffers'), trigger: 'endOfTurn', ...beatIdentity('rune:rune_coffers:endOfTurn') },
      () => collector.emit({ type: 'resourceChanged', resource: 'maxGold', amount: cf, valueAfter: state.maxEmbers }),
    );
  }
  // Rune of Shopkeep: reduce the running upgrade cost by 3 each End of Turn (the "repeat" half; the buy pass
  // applied the first −3). Floored so it can't go negative.
  if (state.runeShopkeep) {
    procRune(state, 'runeShopkeep');
    const beforeCost = state.upgradeCost;
    state.upgradeCost = Math.max(CONFIG.upgradeCostFloor, state.upgradeCost - 3);
    const delta = state.upgradeCost - beforeCost;
    if (collector.enabled && delta !== 0) collector.withTrigger(
      { phase: 'endOfTurn', source: beatSource('rune', 'rune_shopkeep', 'Rune of Shopkeep'), trigger: 'endOfTurn', ...beatIdentity('rune:rune_shopkeep:endOfTurn') },
      () => collector.emit({ type: 'resourceChanged', resource: 'upgradeCost', amount: delta, valueAfter: state.upgradeCost }),
    );
  }
  // Rune of the Lapidary + Rune of the Crucible Choir used to run RIGHT HERE, as hardcoded blocks — which
  // meant no projection beat and no FX: their effects landed silently after the phase flipped (owner report
  // 2026-08-12, the Lapidary's Rubies). Both are now VIRTUAL recurring-End-of-Turn entries (see
  // `recurringEotEffects` + their cases in `runRecurringEndOfTurn`), so they get a beat, captured FX, and
  // Chronos repeats exactly like Rune of Spending / Rune of Action. They fire AFTER the warband's own
  // End-of-Turn effects now, with the other recurring rewards.

  const ctx = makeContext(state);
  const repeats = endOfTurnRepeats(state); // Chronos + Chrono Staff + Parliament: End-of-Turn effects trigger extra times
  let fires = 0; // End-of-Turn effect TRIGGERS this turn (feeds Parliament of Flame's "Trigger N End-of-Turn effects")
  // BEAT SYSTEM (PR 5): board End-of-Turn effects emit source-attributed triggers LEFT-TO-RIGHT (the
  // resolution order, preserved), each Chronos repeat its own trigger (repeatIndex/repeatCount), stat changes
  // as consequences. `withRecruitTrigger` is a no-op wrapper when nothing is capturing.
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    const eotAlign = alignmentOf(state.board, card.uid); // CELESTIAL: gate End-of-Turn halves by alignment
    for (const effect of def.effects) {
      if (effect.on !== 'endOfTurn') continue;
      if (!alignAllows(effect, eotAlign)) continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (!fn) continue;
      // CHOREOGRAPHER PR 1: the factory key is known HERE and nowhere downstream — stamp it on the event.
      const identity = beatIdentity(`factory:${effect.do}:endOfTurn`);
      for (let r = 0; r < repeats; r++) {
        withRecruitTrigger(
          ctx,
          { phase: 'endOfTurn', source: beatSource('minion', card.cardId, def.name, card.uid), trigger: 'endOfTurn', ...identity, repeatIndex: r, repeatCount: repeats },
          () => fn(ctx, card, effect.params ?? {}, { minion: card, proc: r }),
        );
        fires++;
      }
      if (effect.align) noteAlignSpark(state, effect.align); // an aligned EoT half firing sparks its side
    }
  }
  // Quest-granted recurring End-of-Turn effects (Echoing Roar → re-fire your leftmost Shout; The Hoard Wakes →
  // conjure a random Shout minion). They're End-of-Turn effects too — repeated by Chronos/Parliament + counted.
  // `recurringEotEffects` folds in the flag-armed rune recurrences (Lapidary / Crucible Choir). BEAT SYSTEM
  // (PR 5): each gets its own labeled beat (rune/quest source), after the board effects (owner ruling #987).
  for (const eff of recurringEotEffects(state)) {
    for (let r = 0; r < repeats; r++) {
      withRecruitTrigger(
        ctx,
        { phase: 'endOfTurn', ...recurringBeatSpec(eff), repeatIndex: r, repeatCount: repeats },
        () => runRecurringEndOfTurn(state, eff),
      );
      fires++;
    }
  }
  // TURN-LIMITED recurrences (Rune of Quick Study: 2 turns). Fired the same way, then ticked down ONCE for
  // the turn — not once per Chronos repeat, or a doubled End of Turn would burn the limit twice as fast.
  const limited = state.questRecurringLimited;
  if (limited?.length) {
    for (const entry of limited) {
      for (let r = 0; r < repeats; r++) {
        withRecruitTrigger(
          ctx,
          { phase: 'endOfTurn', ...recurringBeatSpec(entry.effect), repeatIndex: r, repeatCount: repeats },
          () => runRecurringEndOfTurn(state, entry.effect),
        );
        fires++;
      }
      entry.turnsLeft -= 1;
    }
    state.questRecurringLimited = limited.filter((e) => e.turnsLeft > 0);
  }
  // RUNE OF LASTING CADENCE — "End of Turn: trigger all your Rally effects."
  //
  // ONE BEAT PER RALLY, deliberately (owner ask: "make sure there's room for the beat to play and go through
  // any and all animations"). A single batched beat would resolve five Rallies inside one animation window —
  // five summons, five Ruby cascades and five stat climbs landing in the same frame. Each rally instead emits
  // its own source-attributed trigger, so the choreographer allots it a real window and the TRIGGERING MINION
  // is the beat's source: it pulses, its FX play, and the projection reserves a step for it.
  for (const card of runeLastingCadenceBeats(state)) {
    const def = CARD_INDEX[card.cardId];
    // A PLAIN trigger scope (no consequence diff): `fireShopRally` now opens one NESTED `withRecruitTrigger`
    // per (watcher × effect) — the per-effect identities the authored FX bind to — and those nested scopes
    // emit every consequence. Diffing here as well would emit each delta TWICE (once per nesting level) and
    // the projection would double-climb. On the NOOP collector `withTrigger` is a bare call, so gameplay is
    // untouched.
    collector.withTrigger(
      {
        phase: 'endOfTurn',
        source: beatSource('minion', card.cardId, def?.name ?? card.cardId, card.uid),
        trigger: 'endOfTurn',
        ...beatIdentity('rune:rune_lasting_cadence:endOfTurn'),
      },
      () => { procRuneId(state, 'rune_lasting_cadence'); fireShopRally(state, card); },
    );
    fires++;
  }
  if (state.runeLastingCadence) clearRallyPassCounters(state);
  // RUNE OF COMBAT PROWESS — "your Start of Combat effects also trigger at End of Turn."
  //
  // The Lasting Cadence pattern, applied to the second family: ONE BEAT PER (body × effect), each an
  // own-beat trigger sourced on the ACTING minion (owner's room-for-the-beat requirement), with the real
  // per-effect identity emitted by the NESTED trigger `fireShopStartOfCombat` opens — a plain scope here
  // (no consequence diff) for exactly the double-emission reason the Lasting Cadence block documents.
  for (const { card, effect } of runeCombatProwessBeats(state)) {
    const def = CARD_INDEX[card.cardId];
    collector.withTrigger(
      {
        phase: 'endOfTurn',
        source: beatSource('minion', card.cardId, def?.name ?? card.cardId, card.uid),
        trigger: 'endOfTurn',
        ...beatIdentity('rune:rune_combat_prowess:endOfTurn'),
      },
      () => { procRuneId(state, 'rune_combat_prowess'); fireShopStartOfCombat(state, card, effect); },
    );
    fires++;
  }
  // RUNE / QUEST START-OF-COMBAT REPLAYS (owner ruling 2026-08-20: "all Start of Combat effects, including
  // runes/quests") — after the warband's own SC effects, mirroring combat's order (minion SC pass first,
  // then the rune section). One beat per (replay x Chronos repeat), sourced on the OWNING rune/quest badge —
  // no minion is the actor. A `nested` replay (Rune of Rallying -> fireShopRally) gets a PLAIN scope for the
  // double-emission reason the Lasting Cadence block documents; everything else diffs its own consequences,
  // with `discardIfEmpty` so a membership no-op (Warden on a full board) leaves no false beat.
  if (state.runeCombatProwess) {
    // × copies held (repeat family, owner 2026-08-27): a duplicate replays the rune/quest SC section once more.
    const prowessReps = repeats * runeStacksOf(state, 'rune_combat_prowess');
    for (const replay of socRuneReplaysOf(state)) {
      for (let r = 0; r < prowessReps; r++) {
        const spec = {
          phase: 'endOfTurn' as const,
          source: beatSource(replay.kind, replay.id, replay.label),
          trigger: 'endOfTurn',
          ...beatIdentity('rune:rune_combat_prowess:endOfTurn'),
          repeatIndex: r, repeatCount: prowessReps,
        };
        const go = (): void => { procRuneId(state, 'rune_combat_prowess'); replay.fire(state); };
        if (replay.nested) collector.withTrigger(spec, go);
        else withRecruitTrigger(ctx, spec, go, { discardIfEmpty: true });
        fires++;
      }
    }
  }
  // ── AEVOR — TEMPEST (owner spec 2026-08-23). End of Turn: the left- and right-most minions gain +4/+4 per
  // completed 15 kills. Recruit-side by nature (it grants PERMANENT stats between fights), so it lives in this
  // engine rather than in simulate — which also means a served rival running Aevor needs nothing extra: their
  // snapshot was taken from a board their own End of Turn had already buffed.
  //
  // A ONE-MINION BOARD IS BUFFED ONCE, not twice: with a single body the left-most and the right-most are the
  // same minion, and paying it double would make the power strongest at its most vulnerable (owner call is
  // welcome here — flagged in the PR). `Set` dedupes by identity, so a two-plus board always gets both ends.
  const tempest = tempestGrantOf(state);
  if (tempest > 0 && hasPower(state, 'tempest') && state.board.length > 0) {
    const ends = new Set([state.board[0]!, state.board[state.board.length - 1]!]);
    const fire = (): void => { for (const c of ends) addBuff(c, 'Tempest', tempest, tempest); };
    if (collector.enabled) {
      collector.withTrigger(
        { phase: 'endOfTurn', source: beatSource('hero', 'aevor', 'Tempest'), trigger: 'endOfTurn', ...beatIdentity('hero:aevor:tempest') },
        fire,
      );
    } else fire();
    fires++;
  }
  // Accumulate for the same reason as `lastShoutFires` — the reducer zeroes it per action, and an action can
  // reach applyEndOfTurn more than once (a hero power that procs an End of Turn, then the turn's own).
  state.lastEotFires = (state.lastEotFires ?? 0) + fires;
}

/**
 * The Rune of Combat Prowess beat list: one entry per START-OF-COMBAT EFFECT FIRE, board order, repeated by
 * Chronos/Parliament like every other End-of-Turn effect AND by the Start-of-Combat trigger multipliers —
 * Rune of Twilight (via `socTwilightExtraFires`, the definition combat's extra pass consults; owner reversal
 * 2026-08-20: the two runes STACK) and Uron's card-data multiplier (via the same `extraTriggerFires` fold
 * combat's `scReps` uses). Each fire is its own beat (the room-for-the-beat rule).
 *
 * THE single source shared by `applyEndOfTurn` (the commit), `projectEndOfTurnSteps` (the legacy projection)
 * and `questEndOfTurnBeats` (the UI's beat sequence) — the Lasting Cadence single-list rule, so the three
 * can never disagree about how many beats there are. Empty when the rune isn't armed. Snapshotted before
 * anything fires: a body summoned mid-pass (Mirrorhide's copy) has no Start of Combat to fire.
 */
export function runeCombatProwessBeats(state: RunState): Array<{ card: BoardCard; effect: EffectDef }> {
  if (!state.runeCombatProwess) return [];
  const repeats = endOfTurnRepeats(state);
  // Per-effect fire count = base + Uron (card data) + Twilight — multiplicative with the Chronos repeats
  // (each repeat is a full End-of-Turn replay, and within each the SC multipliers apply, mirroring combat).
  const perFire = 1
    + extraTriggerFires('startOfCombat', state.board, (id) => CARD_INDEX[id])
    + socTwilightExtraFires({ runeTwilight: state.questFlags?.runeTwilight, flagCopies: state.flagCopies });
  // × copies held: a duplicate Prowess replays the whole SC pass once more (repeat family, owner 2026-08-27).
  const prowess = runeStacksOf(state, 'rune_combat_prowess');
  const out: Array<{ card: BoardCard; effect: EffectDef }> = [];
  for (const entry of socBoardEffects(state)) for (let r = 0; r < repeats * perFire * prowess; r++) out.push(entry);
  return out;
}

/**
 * The Rune of Lasting Cadence beat list: one entry per RALLY THAT WILL FIRE, in board order, repeated by
 * Chronos/Parliament like every other End-of-Turn effect.
 *
 * THE single source shared by `applyEndOfTurn` (the commit), `projectEndOfTurnSteps` (the legacy projection)
 * and `questEndOfTurnBeats` (the UI's beat sequence) — so the three can never disagree about how many beats
 * there are, which is precisely the drift that used to make an End-of-Turn reward land after the phase flip
 * with no animation window at all. Empty when the rune isn't armed.
 */
export function runeLastingCadenceBeats(state: RunState): BoardCard[] {
  if (!state.runeLastingCadence) return [];
  // × copies held: a duplicate triggers every Rally once more per pass (recurring family, owner 2026-08-27).
  const repeats = endOfTurnRepeats(state) * runeStacksOf(state, 'rune_lasting_cadence');
  const out: BoardCard[] = [];
  // Snapshotted before anything fires: a Rally may summon, and a body that arrives mid-pass has not "had" a
  // Rally to trigger (the combat rune states the same rule).
  for (const card of ralliersOf(state)) for (let r = 0; r < repeats; r++) out.push(card);
  return out;
}

/**
 * Set 2 — fire every board minion's `startOfTurn` effects as a shop turn opens (Gemline Martyr). The symmetric
 * twin of `applyEndOfTurn`, dispatched from `advanceCombat` alongside the Start-of-Turn rune rewards. Kept
 * deliberately simple (no Chronos/beat repeats) — the one card that uses it wants a single per-turn tick, and
 * the simpler Start-of-Turn rune handlers next to it dispatch the same way.
 */
export function applyStartOfTurn(state: RunState): void {
  const ctx = makeContext(state);
  for (const card of [...state.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.on !== 'startOfTurn') continue;
      RECRUIT_FACTORIES[effect.do]?.(ctx, card, effect.params ?? {}, { minion: card });
    }
  }
}

/** Record that a quest/rune End-of-Turn reward TRIGGERED a specific unit, so the UI can draw a gold tendril
 *  from that reward's node to the unit. One entry PER PROC — a repeated End of Turn (Chronos/Parliament)
 *  stamps once per repeat, so the player sees a tendril for each fire rather than one for the group. */
function stampQuestTendril(state: RunState, effect: string, uid: string): void {
  (state.questTendrilFx ??= []).push({ effect, uid });
  state.questTendrilSeq = (state.questTendrilSeq ?? 0) + 1;
}

/** The recurring End-of-Turn effects active on this run: the quest/rune-granted list PLUS the flag-armed rune
 *  recurrences (Lapidary / Crucible Choir), which are stored as booleans for save compatibility but behave as
 *  recurring entries. THE single source for `applyEndOfTurn`, `projectEndOfTurnSteps` and `questEndOfTurnBeats`,
 *  so the commit, the projection and the UI's beat list can never disagree about what fires. */
export function recurringEotEffects(state: RunState): NonNullable<RunState['questRecurringEndOfTurn']> {
  // The two flag-armed recurrences repeat once per copy held (recurring family, owner 2026-08-27) — the
  // commit, projection and beat list all read this one builder, so all three agree on the count.
  const lapidary = state.runeLapidary ? runeStacksOf(state, 'rune_lapidary') : 0;
  const choir = state.runeCrucibleChoir ? runeStacksOf(state, 'rune_crucible_choir') : 0;
  return [
    ...(state.questRecurringEndOfTurn ?? []),
    ...Array.from({ length: lapidary }, () => 'runeLapidary' as const),
    ...Array.from({ length: choir }, () => 'runeCrucibleChoir' as const),
  ];
}

/** One quest-granted recurring End-of-Turn effect. `triggerLeftmostShout`: re-fire your leftmost Battlecry
 *  minion's Battlecry (Echoing Roar). `grantRandomShout`: conjure a random Battlecry minion (≤ tavern tier) to
 *  hand (The Hoard Wakes). `grantRandomAttachments`: conjure 2 random Magnetic minions to hand (Blueprint Cache).
 *
 *  `itemizeFx` (the UI's EoT beat projection only — the real commit passes false and emits no events): the
 *  "+x/+y per z" effects apply their buff once PER UNIT OF Z, each unit wrapped in its own nested
 *  `captureBuffFx`, so the beat replays one descend per step — 10 Attachments read as ten +2/+2 hits landing
 *  sequentially, not one +20/+20 lump (owner ruling 2026-07-17; End-of-Turn only — Start-of-Combat lumps like
 *  Umbral Energy stay one-shot). Identical stat outcome either way. */
function runRecurringEndOfTurn(state: RunState, effect: NonNullable<RunState['questRecurringEndOfTurn']>[number], itemizeFx = false): void {
  // Each `step` is one WAVE of the itemized reward — tagged so the UI can stagger BETWEEN waves while
  // firing everything inside a wave simultaneously.
  let wave = 0;
  const step = (run: () => void): void => {
    if (!itemizeFx) { run(); return; }
    const before = state.recruitBuffFx.length;
    captureBuffFx(state, undefined, 'spell', run);
    for (let i = before; i < state.recruitBuffFx.length; i++) state.recruitBuffFx[i]!.fxWave = wave;
    wave++;
  };
  if (effect === 'triggerLeftmostShout') {
    const leftmost = state.board.find((c) => { const d = CARD_INDEX[c.cardId]; return !!d && hasBattlecry(d); });
    if (leftmost) { stampQuestTendril(state, effect, leftmost.uid); replayBattlecry(state, leftmost); }
  } else if (effect === 'runeLapidary') {
    procRuneId(state, 'rune_lapidary');
    // Rune of the Lapidary (owner rework 2026-08-11): play a Ruby on a random minion for EACH card played this
    // turn — the cursor re-rolls per Ruby so they spread independently. One `step` per Ruby, so the projection
    // replays them as a sequential cascade (the owner's 2026-08-12 "End-of-Turn ruby animation" ask). Routed
    // through the real Ruby-play path, so Resonance Idol / Candle Conduit / Ruby Broker all hear it.
    const rb = rubyStatBonus(state);
    const a = 1 + rb.attack;
    const h = 1 + rb.health;
    const n = (state.playedThisTurn ?? []).length;
    for (let i = 0; i < n; i++) {
      if (state.board.length === 0) break;
      step(() => {
        const rng = makeRng(state.rngCursor);
        const target = state.board[rng.int(state.board.length)]!;
        state.rngCursor = rng.state();
        addBuff(target, 'Ruby', a, h);
        fireOnRubyPlayed(state, target, a, h);
      });
    }
  } else if (effect === 'runeCrucibleChoir') {
    // Rune of the Crucible Choir: your left-most Shout fires, then your left-most Echo — two separate picks,
    // through the same replay paths every other re-fire uses (`replayBattlecry` = Myra's path,
    // `fireRecruitDeathrattles` = the shop-side Echo path Gravetwin uses). Two steps, so the projection plays
    // the Shout and the Echo as their own waves.
    const shout = state.board.find((c) => { const d = CARD_INDEX[c.cardId]; return !!d && hasBattlecry(d); });
    if (shout) { procRuneId(state, 'rune_crucible_choir'); step(() => replayBattlecry(state, shout)); }
    const echo = state.board.find((c) => CARD_INDEX[c.cardId]?.effects.some((e) => e.on === 'onDeath'));
    if (echo) { procRuneId(state, 'rune_crucible_choir'); const choirCtx = makeContext(state); step(() => fireRecruitDeathrattles(choirCtx, echo)); }
  } else if (effect === 'grantRandomAttachments') {
    conjureToHand(state, poolOf(state).buyable.filter((c) => c.tier <= state.tier && c.keywords.includes('M')), 2);
  } else if (effect === 'buffMechsPerAttachment') {
    // Blueprint Cache: give each friendly Mech +3/+3 for every Attachment (Magnetic minion) welded onto it.
    // Per-z, ATTACHMENT-MAJOR (owner 2026-07-18): wave `i` buffs EVERY Mech that has an i-th Attachment, so
    // all the Mechs pulse together and the waves read one at a time. (Mech-major — all of one Mech's steps,
    // then the next Mech's — produced a long overlapping smear.) Totals are identical either way.
    const mechs = state.board.filter((c) => (c.attachments ?? 0) > 0 && isTribe(c, 'mech'));
    const maxAttach = mechs.reduce((m, c) => Math.max(m, c.attachments ?? 0), 0);
    for (let i = 0; i < maxAttach; i++) {
      step(() => { for (const c of mechs) if ((c.attachments ?? 0) > i) addBuff(c, 'Blueprint Cache', 3, 3); });
    }
  } else if (effect === 'runeSpending') {
    // Rune of Spending (owner re-tune 2026-07-31, from +3/+3): the leftmost minion gets +1/+2 PER Gold spent
    // this turn. One step per Gold, so the FX ticks like a payout.
    const n = state.goldSpentThisTurn ?? 0;
    const leftmost = state.board[0];
    if (leftmost && n > 0) for (let i = 0; i < n; i++) step(() => addBuff(leftmost, 'Rune of Spending', 1, 2));
  } else if (effect === 'runeAction') {
    // Rune of Action: give your THREE leftmost minions +1/+1 for every card you played this turn — one
    // step per card played, each step buffing the (up to) three leftmost.
    const n = (state.playedThisTurn ?? []).length;
    if (n > 0) {
      for (let i = 0; i < n; i++) step(() => { for (const c of state.board.slice(0, 3)) addBuff(c, 'Rune of Action', 1, 1); });
    }
  } else if (effect === 'quickStudy') {
    // Rune of Quick Study: a Gold Font (`manafont`) + 2 random Shop spells, every turn.
    procRuneId(state, 'rune_quick_study');
    const font = CARD_INDEX['manafont'];
    if (font) step(() => conjureToHand(state, [font], 1, true));
    const spells = poolOf(state).spells.filter((c) => c.tier <= state.tier && !ALE_IDS.includes(c.id));
    if (spells.length > 0) step(() => conjureToHand(state, spells, 2));
  } else if (effect === 'grantAles' || effect === 'grantAles3') {
    // Double Fisting pours 3 (grantAles3); First Round pours 2 (grantAles). Each bursts only if owned — the
    // Open Tab quest also uses grantAles but has its own badge, so stamping the rune here is a harmless no-op
    // for a run that only holds the quest.
    if (effect === 'grantAles3') procRuneId(state, 'rune_double_fisting');
    else procRuneId(state, 'rune_first_round');
    // Open Tab (Dwarf quest): pour Ales at End of Turn, for the rest of the run. Draws from the RUN'S pool like
    // every other Ale grant, so a set without them pours nothing rather than injecting unreachable cards.
    const ales = poolOf(state).spells.filter((c) => ALE_IDS.includes(c.id));
    if (ales.length > 0) step(() => conjureToHand(state, ales, effect === 'grantAles3' ? 3 : 2)); // Double Fisting pours 3
  } else if (effect === 'triggerLeftmostEcho') {
    // Rune of the Reliquary: fire your TWO left-most Echoes (Deathrattles) out of combat (owner 2026-08-19;
    // was one). Board order, so seating decides which two — deterministic, and no RNG consumed.
    const echoes = state.board.filter((c) => CARD_INDEX[c.cardId]?.effects.some((e) => e.on === 'onDeath')).slice(0, 2);
    for (const echo of echoes) { stampQuestTendril(state, effect, echo.uid); fireRecruitDeathrattles(makeContext(state), echo); }
  } else if (effect === 'demonEatsRightmostShop') {
    // Rune of Hunger: your LEFT-most Demon eats the right-most Shop minion. Reuses `rightmostShopMinion` +
    // `consumeShopMinion`, so the eater gains exactly what a card-driven Consume would give it.
    const eater = state.board.find((c) => isTribe(c, 'demon'));
    const i = rightmostShopMinion(state);
    if (eater && i >= 0) step(() => consumeShopMinion(state, eater, i));
  } else if (effect === 'grantFacetwright') {
    // Rune of Facetwright: a Facetwright's Choice every turn. Drawn from the run's pool like every other grant,
    // so a set without the card grants nothing rather than injecting something the run cannot otherwise see.
    const fw = poolOf(state).spells.find((c) => c.id === 'facetwright');
    if (fw) { procRuneId(state, 'rune_facetwright'); step(() => conjureToHand(state, [fw], 1, true)); }
  } else if (effect === 'grantRuby') {
    // MINTED, not conjured — a Ruby is base 1/1 plus the run's live `rubyBonus`, like every other Ruby source.
    step(() => mintRubies(state, 1));
  } else if (effect === 'grantRuby2') {
    // Rune of Resonance (rework 2026-08-06): 2 Rubies per turn. Its own effect id — the recurring effects
    // are string ids by design, so a count param has nowhere to ride.
    procRuneId(state, 'rune_resonance');
    step(() => mintRubies(state, 2));
  } else if (effect === 'copyFirstSpell') {
    // Runic Refrain: get a COPY of the turn's first spell — it lands in hand to cast later, where Rune of
    // Recurrence's `recastFirstSpell` casts it again immediately. Deliberately different rewards.
    const def = state.firstSpellThisTurnId ? CARD_INDEX[state.firstSpellThisTurnId] : undefined;
    if (def?.spell) { procRuneId(state, 'rune_recollection'); step(() => conjureToHand(state, [def], 1, true)); }
  } else if (effect === 'recastFirstSpell') {
    // Rune of Recurrence: cast the FIRST spell you cast this turn again, free. An AIMED spell re-targets a
    // seeded-random friendly board minion (owner call 2026-07-17); untargeted spells just resolve. Skipped
    // when no spell was cast this turn (or an aimed spell finds an empty board).
    const def = state.firstSpellThisTurnId ? CARD_INDEX[state.firstSpellThisTurnId] : undefined;
    if (def?.spell) {
      procRuneId(state, 'rune_recurrence');
      // TWICE (owner sheet 2026-07-31). An aimed spell re-rolls its target per cast, matching the single-cast
      // owner ruling that it lands on a seeded-random friendly.
      for (let rep = 0; rep < 2; rep++) {
        if (def.target) {
          if (state.board.length > 0) {
            const rng = makeRng(state.rngCursor);
            const target = state.board[rng.int(state.board.length)]!;
            state.rngCursor = rng.state();
            castSpell(state, def, target);
          }
        } else {
          castSpell(state, def);
        }
      }
    }
  } else if (effect === 'lassoing') {
    // Rune of Lassoing: End of Turn, cast Lasso (steal a random tavern minion) AND grant a random friendly
    // minion +2/+2. Untargeted Lasso resolves on the tavern; the buff picks a seeded-random board minion.
    step(() => {
      const lasso = CARD_INDEX['lasso'];
      if (lasso) castSpell(state, lasso);
      if (state.board.length > 0) {
        const rng = makeRng(state.rngCursor);
        const target = state.board[rng.int(state.board.length)]!;
        state.rngCursor = rng.state();
        addBuff(target, 'Rune of Lassoing', 2, 2);
      }
    });
  } else if (effect === 'undeadPlayedAtk') {
    // Forsaken Speed: your Undead gain +3 Attack for each card you played this turn (reads `playedThisTurn`)
    // — one step per card played, each step buffing every Undead +3.
    const n = (state.playedThisTurn ?? []).length;
    if (n > 0) {
      for (let i = 0; i < n; i++) step(() => { for (const c of state.board) if (isTribe(c, 'undead')) addBuff(c, 'Forsaken Speed', 3, 0); });
    }
  } else if (effect === 'attachClingDrones') {
    // Clinging On: weld a Cling Drone onto up to 3 of your Mechs (the leftmost three) at End of Turn.
    const cling = CARD_INDEX['cling'];
    const mechs = state.board.filter((c) => isTribe(c, 'mech')).slice(0, 3);
    if (cling) {
      const buff = cardBuff(state, cling.id);
      for (const m of mechs) {
        weldMagnetic(state, m, {
          source: cling.name,
          attack: cling.attack + buff.attack,
          health: cling.health + buff.health,
          keywords: [...cling.keywords],
          mana: cling.manaPerTurn ?? 0,
          rallyMechAtk: cling.rallyMechAtk,
          spellAura: cling.spellAura,
          fodderAura: cling.fodderAura,
        }, 1); // each weld is one Cling magnetized → fires Cling Drone's own "+1/+1 to your Clings"
      }
    }
  } else if (effect === 'weldMoneyBotsEdgeMechs') {
    // Rune of Banking: weld a Money Bot onto your left-most and right-most Mech (deduped if only one Mech).
    const money = CARD_INDEX['moneybot'];
    const mechs = state.board.filter((c) => isTribe(c, 'mech'));
    if (money && mechs.length > 0) {
      const targets = mechs.length === 1 ? [mechs[0]!] : [mechs[0]!, mechs[mechs.length - 1]!];
      const buff = cardBuff(state, money.id);
      for (const m of targets) {
        weldMagnetic(state, m, {
          source: money.name,
          attack: money.attack + buff.attack,
          health: money.health + buff.health,
          keywords: [...money.keywords],
          mana: money.manaPerTurn ?? 0,
          rallyMechAtk: money.rallyMechAtk,
          spellAura: money.spellAura,
          fodderAura: money.fodderAura,
        }, 0);
      }
    }
  } else {
    conjureToHand(state, poolOf(state).buyable.filter((c) => c.tier <= state.tier && hasBattlecry(c)), 1);
  }
}

/** The FX one End-of-Turn beat produced, for the recruit UI to replay ON that beat: `buffFx` = buff-to-others
 *  captured via `captureBuffFx` (tendrils/descends — incl. a Hunter reacting to the beat's Attack gain),
 *  `eaten` = Fodder consumed this beat (Abyssal Feeder / Feasting Bogrot → the ghost-crumble eat FX). The
 *  real commit happens inside `faceOmen` AFTER the phase flips (its stamps land where the shop can't show
 *  them), so the projection is the only place these can be surfaced. */
export interface EotStepFx {
  buffFx: BuffFxEvent[];
  eaten: NonNullable<RunState['fodderEaten']>;
  /** Host uids that gained an Attachment on this beat (Combinator, Cling Drones, Money Bots) — the UI plays
   *  the weld ring on them as the beat runs, since the real weld's stamp lands after the phase flips. */
  welds: string[];
  /** cardIds this beat added to the HAND (Money Maker, Crypt Scribe, Steward of Spells, Rune of Spending's
   *  conjures …). `faceOmen` commits every End-of-Turn grant in one dispatch after the last beat, so without
   *  this the whole batch materialised at once, after all the pulses had already fired. The UI shows each
   *  grant arriving on ITS beat instead (owner ask 2026-07-27). cardIds, not uids: the projection runs on a
   *  throwaway clone whose uids are not the ones `faceOmen` will mint. */
  handGrants: string[];
  /** SPELL POWER this beat added (Aeon Guard, Void Curator). Carried per-beat for the same reason `welds` is:
   *  the action-level `spellPowerFxSeq` bump lands after the phase has flipped to combat, so the shop-anchored
   *  flourish has nothing left to play over. Absent = no rise. */
  spellPower?: { attack: number; health: number };
  /** The IMP AURA this beat added (Void Curator). The action-level aura-wash watcher is explicitly gated on
   *  `next.phase === 'recruit'` and End of Turn flips to combat, so an End-of-Turn imp buff never washed
   *  (owner report 2026-07-28). The beat still renders the board, so the cue belongs here. */
  impAura?: { attack: number; health: number };
  /** SHOP-offer growth this beat produced (owner report 2026-08-11: a Moira beside Market Tormentor re-fires
   *  Tormentor's Shout at End of Turn, growing the right-most Shop minion — but it applied silently). Diffed by
   *  offer uid from `offerBuyStats`, which folds BOTH per-offer buffs (Tormentor) and the run-wide buy bonus
   *  (Soul Defiler / `tavernBuyBonus`), so every shop-buff source animates without per-effect wiring. */
  shopBuff?: { uid: string; attack: number; health: number }[];
  /** The RUN-WIDE part of that shop growth — `tavernBuyBonus`'s delta for this beat (Soul Defiler, Display
   *  Curator, a quest `shopBuff` reward). Present only when EVERY offer grew from the run-wide channel, which
   *  is what separates the shop-wide aura from a Moira-re-fired Market Tormentor growing one offer. Mirrors
   *  the reducer's action-level `shopBuffAllFx` so the recruit-phase and End-of-Turn paths agree. */
  shopBuffAll?: { attack: number; health: number };
  /** Board/hand uids a RUNE buffed this beat — the UI plays `rune-buff-unit` on each. Same source-label diff
   *  (`runeBuffMagnitude`) the reducer's shop path uses, so any End-of-Turn rune buff animates unwired. */
  runeBuffUnits?: string[];
  /** RUBIES this beat played onto board minions (Rune of the Lapidary — owner report 2026-08-12: they applied
   *  silently after the phase flipped). Same `{uid, count}` shape as the reducer boundary's `rubyLandedFx`, so
   *  the End-of-Turn beat can fire the SAME gem cascade the shop plays. Diffed from the 'Ruby' buff counts, so
   *  any future End-of-Turn Ruby source animates without per-effect wiring. */
  ruby?: { uid: string; count: number }[];
}

/**
 * Per-proc preview of the End-of-Turn effects, for the recruit UI to animate the stats rising one
 * proc at a time. Returns one cumulative snapshot (per-uid current stats) *after* each (card × repeat)
 * step, in the same order the UI plays its beats — so the board can show the gain land on each beat —
 * plus each beat's captured FX (`fx`, aligned 1:1 with `steps`).
 * Runs on a throwaway clone (no side effects); the final entry equals the real end-of-turn result.
 */
export function projectEndOfTurnSteps(state: RunState): {
  steps: Array<Record<string, { attack: number; health: number }>>;
  fx: EotStepFx[];
} {
  // PERF: exclude `lastCombat` (the prior fight's whole event log + snapshots) from the throwaway clone
  // and share it by reference — the same trick as the reducer. The end-of-turn factories never touch it,
  // and this preview runs from the UI on every End Turn.
  const { lastCombat, ...rest } = state;
  const clone = structuredClone(rest) as RunState;
  clone.lastCombat = lastCombat;
  stampImproveReps(clone); // Rune of Mastery: the projection's Sergeant improves match the real commit
  const ctx = makeContext(clone);
  const repeats = endOfTurnRepeats(clone);
  const steps: Array<Record<string, { attack: number; health: number }>> = [];
  const fx: EotStepFx[] = [];
  const snap = (): Record<string, { attack: number; health: number }> => {
    const m: Record<string, { attack: number; health: number }> = {};
    for (const c of [...clone.board, ...clone.hand]) m[c.uid] = { attack: c.attack, health: c.health };
    return m;
  };
  // Run one beat's effects wrapped for FX capture, then snapshot + collect what the beat produced. The
  // wrap mirrors the reducer boundary: the effect run itself is captured against `source`, then any board
  // minion whose Attack the beat raised gets its onGainAttack reactor fired (Hunter) — captured against
  // the REACTING minion so its buff-to-others tendrils out of the Hunter, exactly like a mid-shop gain.
  // The reactor fires at most ONCE per minion across the whole projection (`gainFired`), matching the
  // boundary's once-per-action contract — else a multi-beat Attack climb would overshoot the real commit.
  const gainFired = new Set<string>();
  const beat = (source: BoardCard | undefined, run: () => void): void => {
    const fxStart = clone.recruitBuffFx.length;
    const eatenStart = (clone.fodderEaten ?? []).length;
    const atkBefore = new Map(clone.board.map((c) => [c.uid, c.attack]));
    const attachBefore = new Map(clone.board.map((c) => [c.uid, c.attachments ?? 0]));
    const handBefore = new Set(clone.hand.map((c) => c.uid));
    const spBefore = { a: spellAttackBonus(clone), h: spellHealthBonus(clone) };
    const impBefore = { a: clone.impBuff?.attack ?? 0, h: clone.impBuff?.health ?? 0 };
    // Shop-offer effective buy stats before the beat (folds tavernBuyBonus + per-offer + golden), keyed by uid.
    const shopBefore = new Map(clone.shop.map((o) => [o.uid, offerBuyStats(clone, o)]));
    // The RUN-WIDE shop channel on its own, so "every offer got +A/+H" (Soul Defiler, Display Curator) can be
    // told apart from "one offer grew" (a Moira-re-fired Market Tormentor). Both land in `shopBuff` above as
    // per-uid deltas; only this one is the shop-wide aura moment.
    const tavernBefore = { a: clone.tavernBuyBonus?.atk ?? 0, h: clone.tavernBuyBonus?.hp ?? 0 };
    // Per-minion 'Ruby' buff counts before the beat — the same read the reducer's action boundary uses for
    // `rubyLandedFx`, so an End-of-Turn Ruby (the Lapidary) fires the same gem cascade the shop plays.
    const rubyCountOf = (c: { buffs?: { source: string; count: number }[] }): number =>
      c.buffs?.find((b) => b.source === 'Ruby')?.count ?? 0;
    const rubyBefore = new Map(clone.board.map((c) => [c.uid, rubyCountOf(c)]));
    // Rune-buff magnitude before the beat (board + hand), so a rune buffing a unit at End of Turn (Spending,
    // Action, Lassoing, …) fires `rune-buff-unit` on it, on the beat — the same source-label diff the shop uses.
    const runeBuffBefore = new Map([...clone.board, ...clone.hand].map((c) => [c.uid, runeBuffMagnitude(c)]));
    captureBuffFx(clone, source, 'minion', run); // sourceless (quest/rune beat) → sourceUid stays unset → the UI descends
    for (const c of clone.board) {
      const prev = atkBefore.get(c.uid);
      if (prev !== undefined && c.attack > prev && !gainFired.has(c.uid)) {
        gainFired.add(c.uid);
        captureBuffFx(clone, c, 'minion', () => fireOnGainAttack(clone, c));
      }
    }
    // Welds this beat produced — diffed by host `attachments`, so EVERY auto-weld path is caught
    // (Combinator, Cling Drones, Money Bots, and any future EoT welder) without per-effect wiring.
    const welds: string[] = [];
    for (const c of clone.board) {
      const before = attachBefore.get(c.uid);
      if (before !== undefined && (c.attachments ?? 0) > before) welds.push(c.uid);
    }
    // Cards this beat put in hand, in arrival order — matched by cardId when the real grants land.
    const handGrants = clone.hand.filter((c) => !handBefore.has(c.uid)).map((c) => c.cardId);
    // Spell-power / Imp-aura rises this beat produced. Diffed rather than wired per-effect, so any future
    // End-of-Turn card that moves either channel animates without touching this code.
    const spDelta = { attack: spellAttackBonus(clone) - spBefore.a, health: spellHealthBonus(clone) - spBefore.h };
    const impDelta = { attack: (clone.impBuff?.attack ?? 0) - impBefore.a, health: (clone.impBuff?.health ?? 0) - impBefore.h };
    // Shop offers this beat grew (Market Tormentor's re-fired Shout, Soul Defiler's buy-bonus) — one delta per uid.
    const shopBuff: { uid: string; attack: number; health: number }[] = [];
    for (const o of clone.shop) {
      const before = shopBefore.get(o.uid);
      if (!before) continue;
      const now = offerBuyStats(clone, o);
      const da = now.attack - before.attack, dh = now.health - before.health;
      if (da > 0 || dh > 0) shopBuff.push({ uid: o.uid, attack: da, health: dh });
    }
    // The run-wide shop buff this beat produced — the `tavernBuyBonus` delta, matching the reducer's
    // action-level stamp so both paths mean exactly the same thing by "the whole shop was buffed".
    const shopAllDelta = {
      attack: (clone.tavernBuyBonus?.atk ?? 0) - tavernBefore.a,
      health: (clone.tavernBuyBonus?.hp ?? 0) - tavernBefore.h,
    };
    // Rubies this beat played onto board minions (the Lapidary) — the delta, not the total, like the reducer.
    const ruby: { uid: string; count: number }[] = [];
    for (const c of clone.board) {
      const n = rubyCountOf(c) - (rubyBefore.get(c.uid) ?? 0);
      if (n > 0) ruby.push({ uid: c.uid, count: n });
    }
    // Units a RUNE buffed this beat — the rune-buff-magnitude diff, board + hand.
    const runeBuffUnits: string[] = [];
    for (const c of [...clone.board, ...clone.hand]) if (runeBuffMagnitude(c) > (runeBuffBefore.get(c.uid) ?? 0)) runeBuffUnits.push(c.uid);
    steps.push(snap());
    fx.push({
      buffFx: clone.recruitBuffFx.slice(fxStart),
      eaten: (clone.fodderEaten ?? []).slice(eatenStart),
      welds,
      handGrants,
      ...(spDelta.attack > 0 || spDelta.health > 0 ? { spellPower: spDelta } : {}),
      ...(impDelta.attack > 0 || impDelta.health > 0 ? { impAura: impDelta } : {}),
      ...(shopBuff.length ? { shopBuff } : {}),
      ...(shopAllDelta.attack > 0 || shopAllDelta.health > 0 ? { shopBuffAll: shopAllDelta } : {}),
      ...(ruby.length ? { ruby } : {}),
      ...(runeBuffUnits.length ? { runeBuffUnits } : {}),
    });
  };
  for (const card of [...clone.board]) {
    const def = CARD_INDEX[card.cardId];
    if (!def?.effects.some((e) => e.on === 'endOfTurn')) continue;
    const projAlign = alignmentOf(clone.board, card.uid); // CELESTIAL: the projection must gate exactly as applyEndOfTurn
    for (let r = 0; r < repeats; r++) {
      beat(card, () => {
        for (const effect of def.effects) {
          if (effect.on !== 'endOfTurn') continue;
          if (!alignAllows(effect, projAlign)) continue;
          const fn = RECRUIT_FACTORIES[effect.do];
          if (fn) fn(ctx, card, effect.params ?? {}, { minion: card, proc: r });
        }
      });
    }
  }
  // Quest/rune-granted recurring End-of-Turn rewards fire AFTER the warband's own effects (mirrors
  // `applyEndOfTurn`) — one projected step per (effect × repeat), in the same order the UI plays them, so
  // Rune of Spending / Rune of Action's stat gains climb on their own beats (and conjures grow the hand).
  // Sourceless (no card to anchor) → their captured buffs replay as descends onto the gaining minions.
  for (const eff of recurringEotEffects(clone)) {
    for (let r = 0; r < repeats; r++) {
      // itemizeFx: the "+x/+y per z" rewards capture one nested event PER UNIT of the scaler, so the beat
      // replays a sequential descend per step (the outer beat capture skips the itemized targets).
      beat(undefined, () => runRecurringEndOfTurn(clone, eff, true));
    }
  }
  // TURN-LIMITED recurrences (Rune of Quick Study) — the same audit class as the Lapidary (2026-08-12): they
  // resolved in applyEndOfTurn but were absent from the projection, so their grants landed silently after the
  // phase flip. One beat per (entry × repeat), mirroring applyEndOfTurn's order. (The turnsLeft tick-down is
  // commit-side bookkeeping; the clone is throwaway.)
  for (const entry of clone.questRecurringLimited ?? []) {
    for (let r = 0; r < repeats; r++) {
      beat(undefined, () => runRecurringEndOfTurn(clone, entry.effect, true));
    }
  }
  // RUNE OF LASTING CADENCE — one projected step PER RALLY, matching `applyEndOfTurn` and `questEndOfTurnBeats`
  // 1:1, so the animation actually RESERVES a window for each rally instead of the whole board resolving in a
  // single frame. Sourced on the TRIGGERING minion (not sourceless like the quest rewards), so its captured
  // buffs tendril out of the body whose Rally fired and the card pulses on its own beat.
  for (const card of runeLastingCadenceBeats(clone)) {
    beat(card, () => fireShopRally(clone, card));
  }
  if (clone.runeLastingCadence) clearRallyPassCounters(clone);
  // RUNE OF COMBAT PROWESS — one projected step PER (body × effect), matching `applyEndOfTurn` and
  // `questEndOfTurnBeats` 1:1, sourced on the acting minion (the Lasting Cadence pattern).
  for (const { card, effect } of runeCombatProwessBeats(clone)) {
    beat(card, () => fireShopStartOfCombat(clone, card, effect));
  }
  // RUNE / QUEST SoC replays under Combat Prowess — one projected step per (replay x repeat), matching
  // `applyEndOfTurn` + `questEndOfTurnBeats` 1:1. Sourceless (the badge is the actor): captured buffs replay
  // as descends onto the gaining minions, like the quest rewards above.
  if (clone.runeCombatProwess) {
    for (const replay of socRuneReplaysOf(clone)) {
      for (let r = 0; r < repeats; r++) beat(undefined, () => replay.fire(clone));
    }
  }
  return { steps, fx };
}

/** The quest/rune recurring End-of-Turn rewards active on the board, in fire order — one entry per
 *  (effect × repeat), matching `projectEndOfTurnSteps`'s trailing steps 1:1 so the recruit-screen beat
 *  sequence can animate each one (see `endTurn` in Recruit.tsx). Empty when none are granted.
 *
 *  `uid` anchors the beat on a SOURCE CARD when the reward has one. Rune of Lasting Cadence is the first that
 *  does: each of its beats is one minion's Rally, so the flourish belongs on that minion rather than descending
 *  from nowhere the way a sourceless quest reward does. */
export function questEndOfTurnBeats(state: RunState): Array<{ effect: string; label: string; uid?: string }> {
  const repeats = endOfTurnRepeats(state);
  const out: Array<{ effect: string; label: string; uid?: string }> = [];
  for (const eff of recurringEotEffects(state)) {
    for (let r = 0; r < repeats; r++) out.push({ effect: eff, label: RECURRING_EOT_LABEL[eff] ?? 'End of Turn' });
  }
  // Turn-limited recurrences march after the standing ones, mirroring applyEndOfTurn + the projection.
  for (const entry of state.questRecurringLimited ?? []) {
    for (let r = 0; r < repeats; r++) out.push({ effect: entry.effect, label: RECURRING_EOT_LABEL[entry.effect] ?? 'End of Turn' });
  }
  // Rune of Lasting Cadence: one beat per RALLY, last, exactly as `applyEndOfTurn` and the projection order
  // them — so each rally gets its own 760ms window on the legacy path too, sourced on the rallying minion.
  for (const card of runeLastingCadenceBeats(state)) {
    out.push({ effect: 'runeLastingCadence', label: 'Rune of Lasting Cadence', uid: card.uid });
  }
  // Rune of Combat Prowess: one beat per Start-of-Combat EFFECT, after the rallies, mirroring
  // `applyEndOfTurn` + the projection — sourced on the acting minion for the pulse/flourish.
  for (const { card } of runeCombatProwessBeats(state)) {
    out.push({ effect: 'runeCombatProwess', label: 'Rune of Combat Prowess', uid: card.uid });
  }
  // …then the rune/quest SoC replays, sourceless (the owning badge is named by the label), matching the
  // commit + projection order 1:1.
  if (state.runeCombatProwess) {
    for (const replay of socRuneReplaysOf(state)) {
      for (let r = 0; r < repeats; r++) out.push({ effect: 'runeCombatProwess', label: replay.label });
    }
  }
  return out;
}
const RECURRING_EOT_LABEL: Record<string, string> = {
  triggerLeftmostShout: 'Echoing Roar', grantRandomShout: 'The Hoard Wakes', grantRandomAttachments: 'Attachments',
  buffMechsPerAttachment: 'Blueprint Cache',
  runeSpending: 'Rune of Spending', runeAction: 'Rune of Action', triggerLeftmostEcho: 'Rune of the Reliquary',
  weldMoneyBotsEdgeMechs: 'Rune of Banking',
  undeadPlayedAtk: 'Forsaken Speed',
  attachClingDrones: 'Clinging On',
  runeLapidary: 'Rune of the Lapidary',
  runeCrucibleChoir: 'Rune of the Crucible Choir',
  quickStudy: 'Rune of Quick Study',
};

/**
 * Resolve a card's play-time effects, mutating the board in place. Call after the
 * card has been moved from the hand onto `state.board`. Summon-buffs fire first
 * (the played card has just entered), then its own Battlecry — whose summoned
 * tokens in turn fire their own summon-buffs.
 */
/**
 * CELESTIAL ORBIT — wake the Orbit effects of the minions immediately either side of `played`.
 *
 * Adjacency is read AFTER the play, on the settled board, so the neighbours are the ones the arriving card
 * actually landed between. Each watcher is gated by its OWN alignment (`alignAllows`), which is what makes
 * "Dawn Orbit: … / Dusk Orbit: …" one card with two behaviours — and an Eclipsed watcher run both.
 *
 * The played card rides in the payload as `minion` so an Orbit effect can buff the ARRIVER ("give the minion
 * +2/+2"); `self` is the watcher, so it can equally buff ITSELF ("this minion gains +2/+2").
 */
/**
 * CELESTIAL HUD SPARKS — note that an aligned thing just happened, so the alignment strip can flash that
 * side (owner ask 2026-08-03: "if I play a minion on Dusk or a Dusk effect triggers, the Dusk side should
 * spark"). Same UI-fx channel pattern as `karwindFlash`: the sim records WHAT happened, the HUD animates it.
 * Eclipse sparks BOTH sides (it is both). Presentation-only — rules never read it.
 */
export function noteAlignSpark(state: RunState, align: 'dawn' | 'dusk' | 'eclipse' | undefined): void {
  if (!align) return;
  const sides: ('dawn' | 'dusk')[] = align === 'eclipse' ? ['dawn', 'dusk'] : [align];
  const cur = state.alignSpark?.sides ?? [];
  state.alignSpark = { seq: (state.alignSpark?.seq ?? 0) + 1, sides: [...new Set([...cur, ...sides])] };
}

/**
 * How many times an Orbit on `watcher` fires for one arrival — the CELESTIAL trigger multiplier.
 *
 * Base 1, plus one per source that says "your Orbits trigger an additional time":
 *  - **Binary Star** — ADJACENT only, so it pays the neighbours it sits between, not the whole board.
 *  - **Astraeus, Totality** — board-wide, and only while Astraeus itself is Eclipsed.
 *
 * Read at fire time (not cached) so rearranging the board re-prices it immediately, exactly like alignment.
 */
function orbitFires(state: RunState, watcher: BoardCard): number {
  let extra = 0;
  const wi = state.board.findIndex((c) => c.uid === watcher.uid);
  state.board.forEach((c, i) => {
    const def = CARD_INDEX[c.cardId];
    if (!def || c.uid === watcher.uid) return;
    if (def.orbitExtraAdjacent && Math.abs(i - wi) === 1) extra += 1;              // Binary Star
    if (def.orbitExtraBoard && alignmentOf(state.board, c.uid) === 'eclipse') extra += 1; // Astraeus
  });
  return 1 + extra;
}

/**
 * Notify every board-wide ORBIT WATCHER that an Orbit just fired.
 *
 * Distinct from the `orbit` trigger itself: `orbit` is "a card landed NEXT TO ME", while these cards react to
 * ANY Orbit resolving anywhere on the board ("Whenever an Orbit triggers…", "After 3 of your Orbits
 * trigger…"). Keeping them apart is what lets Orrery say "whenever ANOTHER Orbit triggers" — `source` is the
 * minion whose Orbit fired, so a watcher can exclude itself.
 */
function notifyOrbitFired(state: RunState, source: BoardCard, played: BoardCard): void {
  const ctx = makeContext(state);
  for (const c of [...state.board]) {
    const def = CARD_INDEX[c.cardId];
    if (!def) continue;
    for (const effect of def.effects) {
      if (effect.on !== 'orbitFired') continue;
      if (effect.params?.others && c.uid === source.uid) continue; // "another Orbit" — never your own
      if (!alignAllows(effect, alignmentOf(state.board, c.uid))) continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (fn) captureBuffFx(state, c, 'minion', () => fn(ctx, c, effect.params ?? {}, { minion: played, source }));
    }
  }
}

/**
 * Depth guard for TRIGGERED Orbits. Astral Relay wakes its neighbours' Orbits, and one of those neighbours
 * may be another Relay — left unbounded that is an infinite mutual wake. Two levels is enough for a Relay to
 * pay a Relay while keeping the chain finite and readable.
 */
let orbitDepth = 0;
const ORBIT_MAX_DEPTH = 2;

export function fireOrbit(state: RunState, played: BoardCard): void {
  const idx = state.board.findIndex((c) => c.uid === played.uid);
  if (idx < 0) return; // the play didn't land on the board (overflow) — nothing to orbit
  fireOrbitAt(state, idx, played);
}

/**
 * Wake the Orbit effects either side of board slot `idx`.
 *
 * `arriver` is the card that just landed there — or UNDEFINED when the Orbit was TRIGGERED by a card's own
 * text (Astral Relay) rather than by a play. In that case `noArriver` rides the payload and every effect
 * that consumes the arriver stands down, while the rest (buffs, spell power, sell value, casts) fire
 * normally: "trigger this Orbit" means the Orbit's text happens, not that a phantom minion appeared.
 */
export function fireOrbitAt(state: RunState, idx: number, arriver: BoardCard | undefined): void {
  if (orbitDepth >= ORBIT_MAX_DEPTH) return;
  orbitDepth += 1;
  try {
    fireOrbitInner(state, idx, arriver);
  } finally {
    orbitDepth -= 1;
  }
}

function fireOrbitInner(state: RunState, idx: number, arriver: BoardCard | undefined): void {
  const ctx = makeContext(state);
  for (const nb of [state.board[idx - 1], state.board[idx + 1]]) {
    if (!nb) continue;
    const def = CARD_INDEX[nb.cardId];
    if (!def) continue;
    const nbAlign = alignmentOf(state.board, nb.uid);
    for (const effect of def.effects) {
      if (effect.on !== 'orbit') continue;
      if (!alignAllows(effect, nbAlign)) continue;
      const fn = RECRUIT_FACTORIES[effect.do];
      if (!fn) continue;
      // "Orbit (N)" — the cadence notation. The tick is PER INSTANCE and counts every qualifying arrival,
      // paying out on each Nth one; a card with no `every` fires on all of them, as Orbits always did.
      // Ticked once per arrival even when the multiplier below fires the payout several times, so Binary
      // Star accelerates the PAYOUT, not the countdown.
      const every = Math.max(1, num(effect.params?.every, 1));
      if (every > 1) {
        nb.orbitTick = (nb.orbitTick ?? 0) + 1;
        if (nb.orbitTick < every) continue;
        nb.orbitTick = 0;
      }
      for (let n = 0; n < orbitFires(state, nb); n++) {
        // With no arriver the payload still needs a body in `minion` (the type demands one); `noArriver` is
        // what makes it unreadable — the watcher itself stands in, and nothing consumes it.
        const payload = { minion: arriver ?? nb, ...(arriver ? {} : { noArriver: true as const }) };
        captureBuffFx(state, nb, 'minion', () => fn(ctx, nb, effect.params ?? {}, payload));
        // A GATED half sparks its own side; an ungated Orbit sparks the watcher's live side (it fired there).
        noteAlignSpark(state, effect.align ?? nbAlign);
        notifyOrbitFired(state, nb, arriver ?? nb);
      }
    }
  }
}

/**
 * BEAT SYSTEM — snapshot board+hand stats by uid, for the stat-delta diff below.
 */
type StatSnap = Map<string, { a: number; h: number; zone: 'board' | 'hand' }>;
function snapshotStats(state: RunState): StatSnap {
  const m: StatSnap = new Map();
  for (const c of state.board) m.set(c.uid, { a: c.attack, h: c.health, zone: 'board' });
  for (const c of state.hand) m.set(c.uid, { a: c.attack, h: c.health, zone: 'hand' });
  return m;
}

/**
 * BEAT SYSTEM — run a recruit effect inside a source-attributed trigger scope and emit the stat changes it
 * produced as `statsChanged` consequences, discovered by diffing board+hand around the effect (recruit buffs
 * land via many helpers; a diff captures them all without instrumenting each). Read-only w.r.t. gameplay: the
 * diff never mutates. Bails to a bare `run()` when nothing is capturing, so the common (NOOP) path pays one
 * boolean. This is the shared primitive behind the migrated Shout (PR 3) and End-of-Turn (PR 5) triggers.
 */
function withRecruitTrigger(
  ctx: RecruitContext,
  spec: { source: TriggerSourceRef; trigger: string; policy: PresentationPolicy; phase: PresentationPhase; repeatIndex?: number; repeatCount?: number; policyKey?: string; family?: string; occurrenceKey?: string },
  run: () => void,
  /** `discardIfEmpty`: drop the trigger from the batch if the effect recorded NOTHING — for broadcast
   *  dispatches (the shop rally) where the effect's own guard decides after the scope is already open. */
  opts?: { discardIfEmpty?: boolean },
): void {
  const collector = ctx.collector;
  if (!collector.enabled) { run(); return; }
  const state = ctx.state;
  const before = snapshotStats(state);
  // BEAT SYSTEM (PR 6b/6c): NON-OVERLAPPING consequence diffs beyond stats. All diffed (not wired per-effect —
  // the technique projectEndOfTurnSteps uses) so any future effect is caught, and all orthogonal to (or, for
  // rubies, carved out of) the board/hand stat diff so the proven statsChanged equivalence holds.
  const rubyCountOf = (c: { buffs?: { source: string; count: number }[] }): number => c.buffs?.find((b) => b.source === 'Ruby')?.count ?? 0;
  const rubyBefore = new Map(state.board.map((c) => [c.uid, rubyCountOf(c)]));
  const handBefore = new Set(state.hand.map((c) => c.uid));
  const boardBefore = new Set(state.board.map((c) => c.uid));
  // Slot + cardId per uid, so a body that LEAVES can name the position it left (the projection cannot
  // recover either once the body is off the board).
  const slotBefore = new Map(state.board.map((c, bi) => [c.uid, { index: bi, cardId: c.cardId }]));
  const kwBefore = new Map(state.board.map((c) => [c.uid, new Set(c.keywords)]));
  const cardIdBefore = new Map(state.board.map((c) => [c.uid, c.cardId]));
  const shopBefore = new Map(state.shop.map((o) => [o.uid, offerBuyStats(state, o)]));
  const attachBefore = new Map(state.board.map((c) => [c.uid, c.attachments ?? 0]));
  const spBefore = { a: spellAttackBonus(state), h: spellHealthBonus(state) };
  const impBefore = { a: state.impBuff?.attack ?? 0, h: state.impBuff?.health ?? 0 };
  const eatenBefore = (state.fodderEaten ?? []).length;
  const shopEatenBefore = (state.shopEaten ?? []).length;
  const rb = state.rubyBonus ?? { attack: 0, health: 0 };
  // begin/end rather than withTrigger so the handle survives for the empty-scope discard below.
  // CHOREOGRAPHER PR 1: forward the identity fields verbatim (the primitive must not drop them).
  const handle = collector.beginTrigger({ ...spec });
  try {
    (() => {
      run();
      for (const [uid, was] of before) {
        const now = state.board.find((c) => c.uid === uid) ?? state.hand.find((c) => c.uid === uid);
        if (!now) continue;
        // BEAT SYSTEM (PR 6c): rubies this trigger played on this minion are their OWN consequence (rubyPlayed),
        // not a generic stat bump — so the viewer/player can fire the gem cascade. Carve the ruby portion out of
        // the stat delta (each Ruby adds 1+rubyBonus per axis); any REMAINING delta is a real ordinary buff.
        const rubyN = rubyCountOf(now) - (rubyBefore.get(uid) ?? 0);
        // Carry the stat delta alongside the count: `rubyBonus` lives in run state, and making presentation
        // re-derive it is the exact "subtract your way to the number" trap this system exists to remove.
        if (rubyN > 0) collector.emit({
          type: 'rubyPlayed',
          target: { zone: was.zone, uid, cardId: now.cardId, side: 'player' },
          count: rubyN,
          attack: rubyN * (1 + rb.attack),
          health: rubyN * (1 + rb.health),
        });
        const da = now.attack - was.a - rubyN * (1 + rb.attack);
        const dh = now.health - was.h - rubyN * (1 + rb.health);
        if (da === 0 && dh === 0) continue;
        collector.emit({ type: 'statsChanged', target: { zone: was.zone, uid, cardId: now.cardId, side: 'player' }, attack: da, health: dh, permanent: true, channel: 'ordinary' });
      }
      // Cards this trigger put in hand (conjures / grants), in arrival order.
      for (const c of state.hand) {
        if (handBefore.has(c.uid)) continue;
        collector.emit({ type: 'cardGranted', target: { zone: 'hand', uid: c.uid, cardId: c.cardId, side: 'player' }, cardId: c.cardId });
      }
      // Minions this trigger summoned to the BOARD (Moira re-firing a summoner's Shout) — the board sibling of
      // the hand-grant loop above. Without this, an End-of-Turn summon snapped onto the board only at commit.
      // `index` = the slot the body actually occupies (the shop summons ADJACENT to the summoner), so the
      // projection renders the arrival in its true slot from the first frame instead of appending it
      // right-most and letting the commit "correct" it (owner report 2026-08-20).
      state.board.forEach((c, bi) => {
        if (boardBefore.has(c.uid)) return;
        collector.emit({ type: 'cardSummoned', target: { zone: 'board', uid: c.uid, cardId: c.cardId, side: 'player' }, cardId: c.cardId, index: bi });
      });
      // Bodies this trigger REMOVED from the board — the departure sibling of the summon loop above, and for a
      // long time the missing half of it. A Graverobber destroy, a Funeral on Loan body vacating after its Echo,
      // any future destroy: all of them emitted NOTHING, so the board simply had one fewer minion when the phase
      // committed. There was no beat to hang a death animation on, which is precisely why these read as instant
      // and janky (owner report 2026-08-28). `index` is the slot it held; `rise` marks a body that is coming
      // straight back, so the UI plays the death without treating the slot as freed.
      //
      // Fodder and eaten Shop offers are NOT caught here — they were never board minions (`fodderEaten` /
      // `shopChanged: consumed` carry those, above), so there is no double-report.
      for (const [uid, was] of slotBefore) {
        if (state.board.some((c) => c.uid === uid)) continue;
        collector.emit({
          type: 'cardDestroyed',
          target: { zone: 'board', uid, cardId: was.cardId, side: 'player' },
          index: was.index,
          ...(RISING?.has(uid) ? { rise: true } : {}),
        });
      }
      // Bodies this trigger TRANSFORMED IN PLACE — same uid, new cardId (Skybound Ascendant's End-of-Turn
      // tier-up). Without this the only trace of a transform in the batch was a stat delta with the NEW
      // cardId on it, so the card visibly changed only when the phase committed: the effect resolved
      // invisibly inside the End-of-Turn commit instead of animating on its own beat (owner report
      // 2026-08-20). The projection already speaks `cardTransformed`; nothing was emitting it.
      for (const c of state.board) {
        const wasId = cardIdBefore.get(c.uid);
        if (wasId === undefined || wasId === c.cardId) continue;
        collector.emit({ type: 'cardTransformed', target: { zone: 'board', uid: c.uid, cardId: wasId, side: 'player' }, toCardId: c.cardId });
      }
      // Keywords this trigger granted/removed on an EXISTING board minion (a re-fired keyword Shout). A minion
      // that arrived THIS trigger carries its keywords in with `cardSummoned`, so only pre-existing ones diff.
      for (const c of state.board) {
        const was = kwBefore.get(c.uid);
        if (!was) continue;
        for (const kw of c.keywords) if (!was.has(kw)) collector.emit({ type: 'keywordChanged', target: { zone: 'board', uid: c.uid, cardId: c.cardId, side: 'player' }, keyword: kw, gained: true });
        for (const kw of was) if (!c.keywords.includes(kw)) collector.emit({ type: 'keywordChanged', target: { zone: 'board', uid: c.uid, cardId: c.cardId, side: 'player' }, keyword: kw, gained: false });
      }
      // Shop offers this trigger grew (Market Tormentor's re-fired Shout, Soul Defiler's buy bonus) — one per uid.
      for (const o of state.shop) {
        const b = shopBefore.get(o.uid);
        if (!b) continue;
        const now = offerBuyStats(state, o);
        const da = now.attack - b.attack;
        const dh = now.health - b.health;
        if (da > 0 || dh > 0) collector.emit({ type: 'shopChanged', change: 'buffed', target: { zone: 'shop', uid: o.uid, cardId: o.cardId, side: 'player' }, attack: da, health: dh });
      }
      // BEAT SYSTEM (PR 6c): spell-power / imp-aura rises — two-axis auraChanged (Aeon Guard, Void Curator).
      const spA = spellAttackBonus(state) - spBefore.a, spH = spellHealthBonus(state) - spBefore.h;
      if (spA !== 0 || spH !== 0) collector.emit({ type: 'auraChanged', aura: 'spellPower', amount: spA + spH, attack: spA, health: spH });
      const impA = (state.impBuff?.attack ?? 0) - impBefore.a, impH = (state.impBuff?.health ?? 0) - impBefore.h;
      if (impA !== 0 || impH !== 0) collector.emit({ type: 'auraChanged', aura: 'impAura', amount: impA + impH, attack: impA, health: impH });
      // BEAT SYSTEM: ruby-STRENGTH rises (Deepvein Tender's "Your Rubies gain +1 Health", Facetwright, quest
      // rewards) — the run-wide `rubyBonus`, its own `auraChanged` aura. Without this a proc that only raises
      // ruby strength (no Ruby held to bump) emitted NOTHING, so re-triggered by Moira it showed no beat at all
      // (owner report 2026-08-14). Parallels the spellPower/impAura aura emits directly above.
      const rubyA = (state.rubyBonus?.attack ?? 0) - rb.attack, rubyH = (state.rubyBonus?.health ?? 0) - rb.health;
      if (rubyA !== 0 || rubyH !== 0) collector.emit({ type: 'auraChanged', aura: 'ruby', amount: rubyA + rubyH, attack: rubyA, health: rubyH });
      // BEAT SYSTEM (PR 6c): welds (Attachments this trigger bolted onto a Mech) as a counter, one per host.
      for (const c of state.board) {
        const wb = attachBefore.get(c.uid);
        const now = c.attachments ?? 0;
        if (wb !== undefined && now > wb) collector.emit({ type: 'counterChanged', counter: 'attachments', amount: now - wb, valueAfter: now });
      }
      // BEAT SYSTEM (PR 6c): Fodder this trigger consumed → cardDestroyed, one per eaten token.
      for (const e of (state.fodderEaten ?? []).slice(eatenBefore)) {
        // TWO consequences on purpose: `cardDestroyed` is the token leaving play, `fodderEaten` is the meal —
        // who ate it and what they gained. The crumble choreography needs the second; a destroy alone cannot
        // express it, which is why this visual stayed on the legacy path until now.
        collector.emit({ type: 'cardDestroyed', target: { zone: 'board', cardId: e.fodderId, side: 'player' } });
        collector.emit({
          type: 'fodderEaten', eaterUid: e.eaterUid, fodderId: e.fodderId,
          attack: e.attack, health: e.health, gainAttack: e.gainA, gainHealth: e.gainH,
          deliveryKey: 'consume.depart',
        });
      }
      // BEAT SYSTEM: Shop minions this trigger CONSUMED (Bob Blart's End of Turn, Feastmaster Vhal) — the
      // shop-side sibling of the Fodder diff above. TWO consequences, matching Fodder: `shopChanged: consumed`
      // is the offer leaving the row (so it disappears ON the beat, not at commit — owner report 2026-08-14
      // "the minions dont disappear when blart procs in real time"), and `fodderEaten` carries the meal so the
      // eat choreography flies the stats into the eater. The eaten offer is gone from `state.shop`, so it is
      // never caught by the surviving-offer `buffed` diff — `state.shopEaten` is the only record of it.
      for (const e of (state.shopEaten ?? []).slice(shopEatenBefore)) {
        collector.emit({ type: 'shopChanged', change: 'consumed', target: { zone: 'shop', uid: e.uid, cardId: e.cardId, side: 'player' } });
        collector.emit({
          type: 'fodderEaten', eaterUid: e.eaterUid, fodderId: e.cardId,
          attack: e.attack, health: e.health, gainAttack: e.gainA, gainHealth: e.gainH,
          deliveryKey: 'consume.depart',
        });
      }
    })();
  } finally {
    collector.endTrigger(handle);
    if (opts?.discardIfEmpty) collector.discardIfEmpty(handle);
  }
}

/**
 * Wrap an End-of-Turn Discover auto-grant (Moira re-firing Black Belt Brian) so the card it lands in hand emits
 * a `cardGranted` consequence on its own beat. The projection + coalesce path then materialises it in the hand
 * DURING End-of-Turn playback — like a shop conjure — instead of snapping in at the combat hand-off (owner
 * report 2026-08-14). GAMEPLAY-NEUTRAL: `run` executes exactly as before, and with no active collector
 * `withRecruitTrigger` is a bare call, so the reduce/reduceWithPresentation equivalence holds.
 */
export function withEotDiscoverGrantBeat(state: RunState, run: () => void): void {
  withRecruitTrigger(
    makeContext(state),
    {
      phase: 'endOfTurn',
      source: { kind: 'system', id: 'eotDiscover', label: 'Discover', side: 'player' },
      trigger: 'endOfTurn',
      policy: 'ownBeat',
      policyKey: 'system:eotDiscover:grant',
    },
    run,
  );
}

/** BEAT SYSTEM (PR 3) — the migrated Shout (`onPlay`) trigger, expressed via the shared primitive. */
function withPlayTrigger(ctx: RecruitContext, played: BoardCard, effect: EffectDef, run: () => void): void {
  withRecruitTrigger(
    ctx,
    {
      phase: 'recruit',
      source: { kind: 'minion', id: played.cardId, uid: played.uid, side: 'player', label: CARD_INDEX[played.cardId]?.name },
      trigger: 'onPlay',
      ...beatIdentity(`factory:${effect.do}:onPlay`),
    },
    run,
  );
}

export function playCard(state: RunState, played: BoardCard): void {
  state.karwindFlash = []; // Karwind's battlecry-triggered buff repopulates this for the flame flash
  const ctx = makeContext(state);
  // ── 2026-08-20 rune batch: the three PLAY-A-MINION runes. All fired here, the single "played from hand"
  // chokepoint, so a summoned token / a welded Magnetic / a Discover pick sitting in hand can't trip them.
  //
  // SEASONED LEDGER: the played body gains the current grant, then the grant improves every `per` plays. The
  // buff lands BEFORE the Shout fires, so a Shout that reads its own stats reads the buffed line.
  const ledger = state.runeSeasonedLedger;
  if (ledger && (ledger.attack > 0 || ledger.health > 0)) {
    procRuneId(state, 'rune_seasoned_ledger');
    addBuff(played, 'Rune of the Seasoned Ledger', ledger.attack, ledger.health);
    ledger.played += 1;
    if (ledger.per > 0 && ledger.played % ledger.per === 0) {
      const step = improveReps(state); // "Improves" — ×2 under Rune of Mastery, like every other Improve
      ledger.attack += step;
      ledger.health += step;
    }
  }
  // DRAGON'S PANTRY: a Dragon played is one tick of the `playDragon` meter. The threshold engine owns the
  // banking, so "progress carries between turns" is free.
  if (isTribe(played, 'dragon')) advanceRuneThresholds(state, 'playDragon', 1);
  // ECHOED ARRIVAL: every `per`-th ECHO minion played fires its Echo on arrival. Counted per ECHO BODY (not
  // per play), which is what "every 5th Echo minion" says; the fire itself is the shop-side Echo path
  // Gravetwin / the Reliquary use, so nothing about it is bespoke.
  const arrival = state.runeEchoedArrival;
  if (arrival && CARD_INDEX[played.cardId]?.effects.some((e) => e.on === 'onDeath')) {
    arrival.tick += 1;
    if (arrival.per > 0 && arrival.tick % arrival.per === 0) {
      procRuneId(state, 'rune_echoed_arrival');
      // Same 5-play meter, one Echo fire per copy held (threshold family, owner 2026-08-27: doubled payoff).
      for (let k = 0; k < runeStacksOf(state, 'rune_echoed_arrival'); k++) fireRecruitDeathrattles(makeContext(state), played);
    }
  }
  fire(ctx, 'onSummon', { minion: played });
  // CELESTIAL ORBIT: the card just played FROM HAND wakes its immediate neighbours' Orbit effects (owner
  // ruling 2026-08-03 — from hand only, so a summoned token or a reorder that slides someone next to you
  // does NOT trigger it). Each orbiting watcher reads its OWN alignment, so the same card pays differently
  // depending which half of the sky it sits in; an Eclipsed watcher fires both halves.
  //
  // Fired HERE, above the battlecry early-returns below, on purpose: a card with a TARGETED Shout, a Choose
  // One, or a taught aimed spell defers its own battlecry to a later action — but it has already LANDED on
  // the board, so its neighbours' Orbit must not be skipped just because its own text is still pending.
  fireOrbit(state, played);
  const def = CARD_INDEX[played.cardId];
  if (!def) return;
  // Choose One: the Battlecry is whichever option the player picks — deferred to `applyChooseOne`
  // (the reducer opens the prompt). onSummon buffs above still apply (it was summoned normally).
  if (def.chooseOne && def.chooseOne.length > 0) return;
  // Targeted Battlecry (Toxin Tender): the player picks the friendly target next — deferred to
  // `applyBattlecryTarget` (the reducer sets `pendingTarget`). onSummon already fired above.
  if (def.target === 'friendly') return;
  // A Mage-Pup taught an AIMED spell defers the same way, but the check is per-instance (its CardDef is
  // untargeted — the taught spell is what needs a target). The Pup is already on the board by the time this
  // runs and a friendly spell may target the Pup itself, so a legal target always exists; the reducer opens
  // the picker unconditionally for this case.
  if (taughtAimSpell(played)) return;
  // Drakko the Drummer makes Battlecries fire extra times; Warm Embers doubles the next few played Shouts.
  const repeats = playedShoutRepeats(state, def);
  // CELESTIAL: a Shout half gated on `align` only fires for the matching alignment (Eclipse fires both).
  // Read AFTER the card has entered the board, because entering re-centres the board and therefore decides
  // its own alignment — a Celestial's Shout reads the alignment it just landed in, not the one before.
  const myAlign = alignmentOf(state.board, played.uid);
  // The PLAY itself sparks the side it landed on — any minion (the owner's "play a minion on Dusk" case).
  // Harmless without the HUD: a board with no Celestial renders no strip, so the note goes unseen.
  noteAlignSpark(state, myAlign);
  // EQUIP (owner handoff 2026-08-28) — resolved BEFORE the Shout, on its own beat. Shout-shaped in that it
  // fires as the body enters play, but it is NOT a Shout: it re-fires at every Start-of-Turn rebuild, and its
  // payload is a grant to the PLAYER rather than an effect on the board. Kept out of the `onPlay` loop below
  // so a card can carry both, and so nothing that re-fires Shouts (Drakko, Myra, Resonance) re-grants
  // Equipment as a side effect — a grant is idempotent, but the animation and the event would not be.
  for (const effect of def.effects) {
    if (effect.on !== 'equip') continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    // Asked BEFORE the grant, because the grant is what makes it true. See `equipIsNews` for the two rulings
    // behind it: a duplicate adds nothing and is silent, but a GILDED source over a plain entry upgrades what
    // sits in the slot and is announced (owner 2026-08-29).
    const isNews = equipIsNews(state, str(effect.params?.equipmentId), !!played.golden);
    withRecruitTrigger(
      ctx,
      {
        phase: 'recruit',
        source: { kind: 'minion', id: played.cardId, uid: played.uid, side: 'player', label: def.name },
        trigger: 'equip',
        policy: 'ownBeat',
        policyKey: 'system:equipment:equip',
      },
      () => { fn(ctx, played, effect.params ?? {}, { minion: played }); },
    );
    const granted = EQUIPMENT_INDEX[str(effect.params?.equipmentId)];
    if (isNews) {
      stampEquipFx(state, {
        kind: 'equip', uid: played.uid, cardId: played.cardId,
        ...(granted ? { equipmentId: granted.id } : {}),
      });
    }
  }
  const hasBattlecry = def.effects.some((e) => e.on === 'onPlay' && !SILENT_ONPLAY.has(e.do) && alignAllows(e, myAlign));
  for (const effect of def.effects) {
    if (effect.on !== 'onPlay') continue;
    if (!alignAllows(effect, myAlign)) continue;
    const fn = RECRUIT_FACTORIES[effect.do];
    if (!fn) continue;
    if (effect.align) noteAlignSpark(state, effect.align); // an aligned Shout half firing sparks its side
    // BEAT SYSTEM (PR 3) — the first migrated recruit trigger: a Shout (`onPlay`) opens a source-attributed
    // trigger scope, and the stat changes it produces are emitted as consequences (diffed here, not by the UI).
    // Zero overhead when no collector is capturing: `withPlayTrigger` short-circuits to a bare call for NOOP.
    withPlayTrigger(ctx, played, effect, () => {
      captureBuffFx(ctx.state, played, 'minion', () => { for (let r = 0; r < repeats; r++) fn(ctx, played, effect.params ?? {}, { minion: played }); });
    });
  }
  // each Battlecry fire (incl. Drakko repeats) procs Battlecry-triggered watchers (Karwind)
  if (hasBattlecry) for (let r = 0; r < repeats; r++) fireBattlecryTriggered(state);
  if (state.karwindFlash && state.karwindFlash.length) state.karwindFlashSeq = (state.karwindFlashSeq ?? 0) + 1;
}
