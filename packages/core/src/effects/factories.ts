import type { CardDef, CombatContext, EffectFactoryId, Keyword, Minion, Side, Tribe } from '../types';
import { ARENA_EFFECTS, type EffectArena } from './arena';
import { ALE_IDS, extraTriggerFires } from '../types';

/** Re-entrancy guard for Hunter's onGainAttack aura (its +Attack grant would re-fire onGainAttack). Keyed by the
 *  minion object + always cleared in `finally`, so it never pollutes a shared card across combats/turns. */
const huntGuard = new WeakSet<object>();

/**
 * An effect primitive. Bound to a `self` minion and invoked when its subscribed
 * `GameEvent` fires. Factories decide their own relevance from the payload
 * (is this about me? my side? the right tribe?) and mutate state only through
 * the `CombatContext`.
 *
 * Cards reference factories by id (data, not code). Adding a card is data-only
 * unless it needs a genuinely new primitive here.
 */
export type EffectFn = (
  ctx: CombatContext,
  self: Minion,
  params: Record<string, unknown>,
  payload: unknown,
) => void;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Tripled minions fire their buff/damage effects at doubled magnitude. */
const mul = (self: Minion): number => (self.golden ? 2 : 1);

/** `onGainCard` is a BUS broadcast, and the bus reaches every subscribed body on BOTH sides. "Your hand" means
 *  the owner's, so a reactor only fires for a card that reached its OWN side's hand — without this an enemy
 *  Gangplank would pay itself every time the player conjured something. */
const gainedByOwnSide = (self: Minion, payload: unknown): boolean =>
  (payload as { side?: Side } | undefined)?.side === self.side;

/** Set 2 — "Play `per` Rubies on your [tribe] minions" in COMBAT: every living friend of `tribe` (or all
 *  friends if `tribe` is empty) gets `per` Ruby buffs, a Ruby being base 1/1 + this side's `rubyBonus`. The gift
 *  is PERMANENT — recorded as `permaGain` for EVERY recipient (not just Engraved ones; owner: Ruby buffs are
 *  always permanent) so it carries back to the run board via `playerPermaBuffs`. Shared by every "play Rubies"
 *  combat trigger (Start-of-Combat / Avenge / Rally). */

/**
 * THE combat spell-cast path. Every minion that "casts a Shop Spell" mid-fight must come through here.
 *
 * Before this existed (owner report 2026-08-07) each caster hand-rolled the same three lines — decide how many
 * times to cast, call `ctx.castSpell`, apply the effect — in eight separate places. That is why "your Shop
 * Spells cast an extra time in combat" had nowhere to hook: there was no single owner of the repetition count.
 * Now there is. `body` is the spell's actual effect, run once per cast.
 *
 * The count is `golden x (1 + the side's granted extras)`. Golden has always meant TWO GENUINE CASTS rather
 * than one doubled cast — so in-combat spell reactions (Guel, Forsaken Weaver, Spirit Pup, the `spellsCast`
 * carry-back) fire per cast, exactly as a hand-played "twice" resolves. Extras stack on top the same way.
 *
 * NOT routed through here: Rune of the Spellstone counting a RUBY as a cast (see `playRubyOn`). A Ruby is not
 * a Shop Spell, so a "your Shop Spells cast again" grant must not multiply it.
 */
/**
 * TEMPORAL-WINDOW PROVENANCE (Docbot handoff §5.3) — a PURELY OBSERVATIONAL tap on every per-instance
 * Avenge window read. `avengeCountFor` is the single chokepoint every minion-level avenge factory counts
 * through, so one hook here sees every observation with full instance provenance:
 *
 *   · which source INSTANCE observed (uid + cardId + side — two same-card bodies stay distinct);
 *   · its ENTRY SEQUENCE (`baseline`: the side's death tally when this body's window opened — 0 for a
 *     start-of-fight body, stamped at placeSummon / the Rise return otherwise);
 *   · the OBSERVED EVENT SEQUENCE (`count`: the side's raw death tally at this observation);
 *   · the counter BEFORE/AFTER the window subtraction (`count` raw vs `seen` in-window).
 *
 * Trigger EMISSION is deliberately not duplicated here — it is already provable from the event log (the
 * factory's own buff/summon/improve/... events, stamped `avenge:true`), and an oracle must read emission
 * from the authoritative log rather than trusting a side channel. The observer is undefined outside tests
 * (the docbot temporal-window suite installs it), costs one null-check per observation, and can never
 * change gameplay: it receives values, returns nothing, and nothing here reads it back.
 */
export interface AvengeWindowObservation {
  /** The observing source instance. */
  sourceUid: string;
  sourceCard: string;
  side: Side;
  /** The side's death tally when this instance's observation window opened (its entry sequence). */
  baseline: number;
  /** The side's raw death tally at this observation (the observed event sequence). */
  count: number;
  /** The instance's in-window counter: `count - baseline` — what the factory actually thresholds on. */
  seen: number;
}
let avengeWindowObserver: ((o: AvengeWindowObservation) => void) | undefined;
/** Install (or clear, with no argument) the test-only temporal-window observer. Docbot suite use only. */
export function setAvengeWindowObserver(fn?: (o: AvengeWindowObservation) => void): void {
  avengeWindowObserver = fn;
}

/** A minion's OWN view of the side's Avenge tally — the run total minus its post-Rise baseline (owner ruling
 *  2026-08-08: a risen body's Avenge progress restarts at 0). Every minion-level avenge factory must count
 *  through this rather than reading the payload count raw, or a Rise carries the old progress through. */
export function avengeCountFor(self: Minion, count: number): number {
  const seen = count - (self.avengeBaseline ?? 0);
  avengeWindowObserver?.({
    sourceUid: self.uid, sourceCard: self.cardId, side: self.side,
    baseline: self.avengeBaseline ?? 0, count, seen,
  });
  return seen;
}

export function castInCombat(ctx: CombatContext, self: Minion, body: () => void): void {
  const reps = mul(self) * Math.max(1, ctx.spellCastRepsFor?.(self.side) ?? 1);
  for (let i = 0; i < reps; i++) {
    ctx.castSpell(self.side);
    body();
  }
}

/** Exported for the Rune of Gemstorm handler in simulate.ts — the ONE Ruby-play primitive. Anything that
 *  "plays a Ruby" in combat must come through here: a hand-rolled `ctx.buff` with Ruby-shaped stats misses
 *  the Deepdelve multiplier, the target's `onRubyPlayed` listeners, the Spellstone cast-count and the
 *  `rubyGain` ledger — which is exactly the bug the Gemstorm rune shipped with (owner report 2026-08-06). */
export function playRubyOn(ctx: CombatContext, self: Minion, target: Minion, per: number, permanent = false): void {
  if (per <= 0) return;
  // RUNE OF BATTLE REFRACTION: living Prismcasters repeat Rubies played during combat, exactly as they repeat
  // hand-played Rubies in the shop (`rubyExtraCast`). Folded into `per` at this single chokepoint, so every
  // combat Ruby source (Candle Conduit, Geode Guardian, Distillation) refracts identically — and since the
  // repeats ride the SAME call, there is no recursion to guard.
  per += ctx.battleRefractionRepsFor?.(self.side) ?? 0;
  const rb = ctx.rubyBonusFor(self.side);
  const mult = rubyMultiplierFor(ctx, self.side); // Deepdelve Paragon
  const a = (1 + rb.attack) * per * mult;
  const h = (1 + rb.health) * per * mult;
  // RUNE OF ENGRAVING GEMS: every Ruby applied in combat carries back to the run board. Forced at this single
  // chokepoint (like Battle Refraction above), so EVERY combat Ruby source becomes permanent together rather
  // than each caller having to opt in — a per-source opt-in is exactly how one would get missed.
  const runeEngraved = !permanent && !!ctx.rubiesPermanentFor?.(self.side);
  const engraved = permanent || runeEngraved;
  // Rune of Engraving Gems bursts on the badge when IT is why this combat Ruby became permanent (not when the
  // Ruby was already permanent for another reason). `ctx.log` of a questTrigger is the factories-side
  // equivalent of `fireTrigger` — same channel, no new context hook (see the runeFloodedVault stamp).
  if (runeEngraved) ctx.log({ type: 'questTrigger', flag: 'runeEngravingGems', side: self.side });
  applyRubyStats(ctx, self, target, a, h, engraved);
  // CANDLE CONDUIT (owner rework 2026-08-07): every Ruby played on this side bounces to 1 more minion per
  // Conduit (golden 2). The bounce is STATS ONLY (`applyRubyStats`, never the watchers below), which is the
  // same no-rebounce guard Resonance Idol's bounce uses — a bounce can never trigger another bounce.
  for (const m of ctx.living(self.side)) {
    if (m.dead) continue;
    for (const eff of m.effects) {
      if (eff.on !== 'rubyPlayedAnywhere' || eff.do !== 'rubyBounceExtra') continue;
      const bounces = m.golden ? 2 : 1;
      for (let b = 0; b < bounces; b++) {
        const others = ctx.living(self.side).filter((x) => x !== target && !x.dead);
        if (others.length === 0) break;
        applyRubyStats(ctx, self, ctx.rng.pick(others), a, h, permanent);
      }
    }
  }
  // DOUBLE TROUBLE (set 3): when a Ruby is cast on ANOTHER friendly minion, it casts that many on itself.
  //
  // PER RUBY, not per cast (owner ruling 2026-08-31: "a ruby being cast is 1 ruby, so if 2 rubies are cast,
  // that would be 2 rubies"). `per` is the count this call is applying, so it is the multiplier — a single
  // `playRubyOn` carrying 3 Rubies pays Double Trouble 3, not 1.
  //
  // "ANOTHER minion" is a real separation (owner ruling, same day): a Ruby landing on Double Trouble itself
  // never triggers it, and — because the Ruby below goes through `applyRubyStats`, which is STATS ONLY and
  // notifies nobody — a second Double Trouble cannot see this one's payout either. That is the same guard
  // Candle Conduit's bounce and Resonance Idol rely on, and without it two of these would ping forever.
  //
  // PERMANENCE IS INHERITED (owner note): `engraved` is the flag computed for the triggering Ruby, so a Ruby
  // cast off a permanent one is itself permanent — including when the Rune of Engraving Gems is what made the
  // original permanent, since that decision is already folded into `engraved`.
  for (const m of ctx.living(self.side)) {
    if (m.dead || m === target) continue; // never off a Ruby cast on ITSELF — see "another minion" above
    for (const eff of m.effects) {
      if (eff.on !== 'rubyPlayedAnywhere' || eff.do !== 'rubySelfCastPerOtherRuby') continue;
      const reps = per * num(eff.params?.count, 1) * (m.golden ? 2 : 1);
      if (reps <= 0) continue;
      // Its own Rubies are worth what any Ruby is worth right now — same strength, same Paragon multiplier —
      // so it can never be quietly weaker than the Ruby that triggered it.
      applyRubyStats(ctx, m, m, (1 + rb.attack) * reps * mult, (1 + rb.health) * reps * mult, engraved);
    }
  }
  // Rune of the Spellstone: this Ruby ALSO counts as a spell cast — fire the trigger so per-spell improvers
  // (Groveweaver, Sovereign, Guel's combat tally) advance, exactly as the recruit path counts it.
  if (ctx.spellstoneFor?.(self.side)) ctx.castSpell(self.side);
  // Tell the TARGET a Ruby landed on it, so its own `onRubyPlayed` effects fire — the combat half of the recruit
  // `fireOnRubyPlayed`. Without this, a Geode Guardian Echo playing Rubies onto a Resonance Idol did nothing
  // (owner report 2026-07-25): the Idol's bounce existed only as a RECRUIT factory, so mid-combat Rubies had no
  // one listening. Only factories with a combat implementation respond; Ruby Broker's Gold, for instance, is
  // meaningless mid-fight and simply has no combat entry.
  for (const effect of target.effects) {
    if (effect.on !== 'onRubyPlayed') continue;
    FACTORIES[effect.do]?.(ctx, target, effect.params ?? {}, { minion: target, side: target.side, rubyAttack: a, rubyHealth: h });
  }
}
/** The stat half of playing a Ruby — no `onRubyPlayed` notification, so a BOUNCE can't re-trigger the bounce.
 *  That guard is load-bearing: two adjacent Resonance Idols would otherwise ping a Ruby between each other
 *  forever. (The recruit factory gets the same property by calling `addBuff` directly.) */
/** Set 2 — Deepdelve Paragon: how much your Rubies are worth on `side` right now. 1 with no Paragon out, 2
 *  with one, 3 if it's Gilded (owner clarification 2026-07-25: "+2/+2 Rubies give +4/+4 in combat" — so the
 *  card DOUBLES, it doesn't add double).
 *
 *  Read live rather than snapshotted at Start of Combat, because a Ruby played MID-FIGHT (Geode Guardian's
 *  Echo, Candle Conduit, Frenzied Excavator) has to be multiplied too — that's the half a Start-of-Combat
 *  pass structurally cannot do, and the reason the card looked broken on a Ruby-in-combat board. */
function rubyMultiplierFor(ctx: CombatContext, side: Side): number {
  let mult = 1;
  for (const m of ctx.living(side)) {
    if (m.effects.some((e) => e.do === 'rubyStatMultiplier')) mult = Math.max(mult, m.golden ? 3 : 2);
  }
  return mult;
}

/** The nearest LIVING minion on each side of `self`.
 *
 *  A dead minion is only flagged `dead` — it stays in `ctx.boards[side]` — so indexing `arr[i ± 1]` and then
 *  discarding corpses meant a body that died earlier in the fight BLOCKED adjacency, and the live minion just
 *  past it was never reached. That's what made Ryme fire only one of two flanking Battlecries once the fight
 *  was under way, while Soren destroying it at Start of Combat (no corpses yet) fired both — owner report
 *  2026-07-26.
 *
 *  Corpses are invisible to the player, so "adjacent" has to mean adjacent among the living. `ctx.living()`
 *  already gives that ordering, which is how Karwind's neighbours were written; this makes the older
 *  index-the-raw-board sites agree with it instead of quietly meaning something else.
 */
function livingNeighbours(ctx: CombatContext, self: Minion): Minion[] {
  const alive = ctx.living(self.side);
  const raw = ctx.boards[self.side];
  const i = raw.indexOf(self);
  if (i < 0) return [];
  // `self` may itself be dead (a Deathrattle), so it won't appear in `alive` — find where it SAT by walking
  // outward from its raw index and taking the first living body on each side.
  const before: Minion[] = [];
  const after: Minion[] = [];
  for (let k = i - 1; k >= 0; k--) if (!raw[k]!.dead && raw[k]!.health > 0) { before.push(raw[k]!); break; }
  for (let k = i + 1; k < raw.length; k++) if (!raw[k]!.dead && raw[k]!.health > 0) { after.push(raw[k]!); break; }
  void alive;
  return [...before, ...after];
}

function applyRubyStats(ctx: CombatContext, self: Minion, target: Minion, a: number, h: number, permanent = false): void {
  ctx.buff(target, a, h, self.uid, true); // `true` = tag the log event as a Ruby, for the UI's Ruby-landed cue
  // Remember these as RUBIES, not just stats — Gemheart Carver's Echo scales off "the Rubies on this minion",
  // and a plain `ctx.buff` is indistinguishable from any other combat buff. Combat-local (see `rubyGain`);
  // the recruit-phase equivalent is the `Ruby` entry in `buffs`.
  target.rubyGain = { attack: (target.rubyGain?.attack ?? 0) + a, health: (target.rubyGain?.health ?? 0) + h };
  // Combat Rubies are TEMPORARY by rule (owner ruling 2026-07-31, off the Gemstorm rune): they persist only
  // on an ENGRAVED minion — whose `ctx.buff` above already accrued the gain into `permaGain` — or when a card
  // explicitly prints "permanently" (none currently does; such a card would thread a `permanent` param here).
  // This REVERSES the earlier "Ruby buffs are always permanent" ruling that used to add `permaGain` for every
  // recipient. `permaRuby` stays as the LABEL for the Engraved share, so the carry-back split (Ruby vs the
  // rest, simulate ~2405) keeps attributing correctly — it must only accrue when the gain actually persists.
  if (target.keywords.includes('EG')) {
    target.permaRuby = { attack: (target.permaRuby?.attack ?? 0) + a, health: (target.permaRuby?.health ?? 0) + h };
  } else if (permanent) {
    // A card that explicitly prints "permanently" (Kobe / Boulderdash / Blazer): accrue BOTH permaGain (so the
    // carry-back filter at settle picks it up — ctx.buff only accrues permaGain for Engraved bodies) AND
    // permaRuby (so the carry-back split labels it a Ruby rather than a generic gift). This is the `permanent`
    // hook the applyRubyStats reversal note (2026-07-31) reserved for exactly this case.
    target.permaGain = { attack: (target.permaGain?.attack ?? 0) + a, health: (target.permaGain?.health ?? 0) + h };
    target.permaRuby = { attack: (target.permaRuby?.attack ?? 0) + a, health: (target.permaRuby?.health ?? 0) + h };
  }
}
function playRubies(ctx: CombatContext, self: Minion, per: number, tribe: string): void {
  if (per <= 0) return;
  for (const m of ctx.living(self.side)) {
    if (tribe && m.tribe !== tribe && m.tribe2 !== tribe) continue;
    playRubyOn(ctx, self, m, per);
  }
}

interface MinionPayload {
  minion: Minion;
  side?: Side;
}

/** Grant a Divine Shield to a living minion (Mechs). Idempotent; logs a `shieldUp`. */
/** The combat-side `EffectArena` adapter (Step 1 spike). Bodies pass through UNWRAPPED — `Minion` satisfies
 *  `ArenaBody` structurally — and the verbs close over the `CombatContext`, so an arena effect emits the same
 *  events (`shieldUp` etc.) as the legacy body it replaced. `rng()` hands over the fight's threaded stream. */
function combatArena(ctx: CombatContext, self: Minion): EffectArena {
  return {
    phase: 'combat',
    self,
    friends: () => ctx.living(self.side),
    hasShield: (t) => (t as Minion).divineShield === true,
    grantShield: (t) => grantShield(ctx, t as Minion),
    buff: (t, a, h) => ctx.buff(t as Minion, a, h, self.uid),
    buffPermanent: (t, a, h) => {
      const m = t as Minion;
      ctx.buff(m, a, h, self.uid);
      // ctx.buff already accrues permaGain for an Engraved recipient; record it for everyone else — the
      // gift is permanent regardless of the recipient's keywords.
      if (!m.keywords.includes('EG')) {
        m.permaGain = { attack: (m.permaGain?.attack ?? 0) + a, health: (m.permaGain?.health ?? 0) + h };
      }
    },
    grantRubyPower: (a, h) => ctx.gainRubyBonus(a, h, self.side, self.uid),
    rubyTallyOf: (t) => {
      const m = t as Minion;
      const shopRuby = m.buffs?.find((b) => b.source === 'Ruby');
      return { attack: (shopRuby?.attack ?? 0) + (m.rubyGain?.attack ?? 0), health: (shopRuby?.health ?? 0) + (m.rubyGain?.health ?? 0) };
    },
    summonToken: (id, opts) => {
      const kw = opts?.keywords ? ([...opts.keywords] as Keyword[]) : opts?.keyword ? [opts.keyword as Keyword] : undefined;
      const ov = opts?.attack !== undefined && opts.health !== undefined
        ? {
          attack: opts.attack, health: opts.health, maxHealth: opts.maxHealth ?? opts.health,
          // SC FAMILY (Mirrorhide): the live flags ride the snapshot only when the caller states them —
          // every earlier caller leaves them out, so its snapshot shape is unchanged byte-for-byte.
          ...(opts.divineShield !== undefined ? { divineShield: opts.divineShield } : {}),
          ...(opts.rebornAvailable !== undefined ? { rebornAvailable: opts.rebornAvailable } : {}),
        } : undefined;
      // arg6 is the immediate-attack ("charge") queue — the Smith's token swings the moment it lands.
      return ctx.summon(self.side, ctx.getCard(id), self.uid, kw, opts?.golden ?? false, opts?.charge ?? false, ov);
    },
    grantNamedCard: (cardId, count) => { for (let i = 0; i < count; i++) ctx.grantToHand(cardId, self.side, self.uid); },
    grantRandomSpells: (count) => ctx.grantRandomSpell(count, self.side, self.uid),
    playRubiesOn: (t, per, permanent) => playRubyOn(ctx, self, t as Minion, per, permanent === true),
    gainRubyStats: (t, a, h) => applyRubyStats(ctx, self, t as Minion, a, h),
    neighboursOf: (t) => livingNeighbours(ctx, t as Minion),
    grantMaxGold: (amount) => {
      ctx.grantMaxGold(amount, self.side);
      if (self.side === 'player') ctx.log({ type: 'maxGold', target: self.uid, side: self.side, amount });
    },
    isCelestial: (t) => !!ctx.getCard(t.cardId)?.celestial,
    isImp: (t) => !!ctx.getCard(t.cardId)?.imp,
    isFodder: (t) => !!ctx.getCard(t.cardId)?.keywords.includes('FD'),
    impAura: () => ctx.impAura(self.side),
    conductorTally: () => ctx.conductorTally(self.side),
    deathrattleTally: () => ctx.deathrattleTally(self.side),
    addTribeAura: (tribe, a, h) => ctx.addTribeAura(self.side, tribe as Tribe | 'any', a, h, self.uid),
    tribesOf: (t) => {
      const m = t as Minion;
      return [m.tribe, m.tribe2].filter((x): x is Tribe => !!x && x !== 'neutral');
    },
    isUniversalTribe: (t) => (t as Minion).universalTribe === true || !!ctx.getCard(t.cardId)?.universalTribe,
    improveReps: () => ctx.improveRepsFor(self.side),
    matriarchReps: () => ctx.matriarchRepsFor(self.side),
    logSpellProgress: (amount) => ctx.log({ type: 'spellProgress', target: self.uid, amount }),
    logImprove: (amount) => ctx.log({ type: 'improve', target: self.uid, amount }),
    spellsThisTurn: () => ctx.spellsThisTurnFor(self.side),
    grantRandomFromPool: (pred, count) => {
      const pool = ctx.poolCards(self.side).filter(pred);
      if (pool.length === 0) return;
      for (let i = 0; i < count; i++) ctx.grantToHand(ctx.rng.pick(pool).id, self.side, self.uid);
    },
    grantUndeadAttackAura: (a) => {
      for (const m of ctx.living(self.side)) {
        if (m.tribe !== 'undead' && m.tribe2 !== 'undead' && !ctx.getCard(m.cardId)?.universalTribe) continue;
        ctx.buff(m, a, 0, self.uid);
      }
      ctx.grantUndeadBuyAtk(a, self.side);
    },
    grantMagneticAura: (a, h) => {
      for (const m of ctx.living(self.side)) {
        if (m.keywords.includes('M')) ctx.buff(m, a, h, self.uid);
      }
      ctx.grantMagneticBuff(a, h, self.side); // run-permanent half (settle stacks + buffs run board/hand)
    },
    grantBeastExtra: (hunt, ritual) => ctx.gainBeastExtra(hunt, ritual, self.side, self.uid),
    grantCardTypeBuff: (cardId, a, h) => {
      ctx.grantCardBuff(cardId, a, h, self.side); // carry-back: run board / hand / future copies
      for (const m of ctx.living(self.side)) if (m.cardId === cardId) ctx.buff(m, a, h, self.uid);
    },
    grantFodderAura: (a, h) => {
      for (const m of ctx.living(self.side)) if (ctx.getCard(m.cardId)?.keywords.includes('FD')) ctx.buff(m, a, h, self.uid);
      ctx.grantFodderBuff(a, h, self.side);
    },
    applyBaneDemonWiden: () => {
      const dem = ctx.baneDemonWidenFor(self.side);
      if (!dem || (dem.attack === 0 && dem.health === 0)) return;
      for (const m of ctx.living(self.side)) {
        if (m.tribe === 'demon' || m.tribe2 === 'demon' || ctx.getCard(m.cardId)?.universalTribe) {
          ctx.buff(m, dem.attack, dem.health, self.uid);
          if (!m.keywords.includes('EG')) {
            m.permaGain = { attack: (m.permaGain?.attack ?? 0) + dem.attack, health: (m.permaGain?.health ?? 0) + dem.health };
          }
        }
      }
    },
    stampKarwindFlash: () => {}, // combat FX ride the buff events
    stripEchoes: (t) => { const m = t as Minion; m.effects = m.effects.filter((e) => e.on !== 'onDeath'); },
    nameOf: (t) => (t as Minion).name,
    narrate: (text, cast) => ctx.log({ type: 'sc', source: self.uid, text, ...(cast ? { cast: true } : {}) }),
    activeTribes: () => ctx.activeTribesFor(self.side),
    castTribeAttackSpell: (tribe, amount) => {
      // One cast per repetition, so an extra-cast grant stacks the aura again rather than doubling one grant.
      castInCombat(ctx, { ...self, golden: false } as Minion, () => {
        const sp = ctx.spellPowerFor(self.side);
        const a = amount + sp.attack;
        const h = sp.health;
        ctx.addTribeAura(self.side, tribe as Tribe | 'any', a, h, self.uid);
        ctx.log({ type: 'sc', source: self.uid, text: `${self.name} casts Lantern of Souls (+${a}/+${h} to your ${tribe})` });
      });
    },
    damageAll: (amount) => {
      for (const sideKey of ['player', 'enemy'] as Side[]) {
        for (const m of [...ctx.living(sideKey)]) ctx.damage(m, amount);
      }
    },
    grantImpAura: (a, h) => {
      for (const m of ctx.living(self.side)) if (ctx.getCard(m.cardId)?.imp) ctx.buff(m, a, h, self.uid);
      ctx.grantImpBuff(a, h, self.side); // permanent — carried back to RunState.impBuff
    },
    hasReborn: (t) => (t as Minion).rebornAvailable === true || t.keywords.includes('R'),
    grantKeywordTo: (t, kw, silent) => {
      const mm = t as Minion;
      mm.keywords.push(kw as Keyword);
      if (kw === 'DS') mm.divineShield = true;
      if (kw === 'R') mm.rebornAvailable = true;
      if (!silent) ctx.log({ type: 'keyword', target: mm.uid, keyword: kw as Keyword, source: self.uid });
    },
    grantSpellPower: (a, h) => ctx.grantSpellPower(a, h, self.side, self.uid),
    targetTribe: () => ctx.getCard(self.cardId)?.targetTribe,
    grantReborn: (t) => {
      const m = t as Minion;
      m.keywords.push('R');
      m.rebornAvailable = true;
      ctx.log({ type: 'keyword', target: m.uid, keyword: 'R', source: self.uid });
    },
    isTribe: (t, tribe) => {
      const m = t as Minion;
      return m.tribe === tribe || m.tribe2 === tribe || !!ctx.getCard(m.cardId)?.universalTribe;
    },

    // ── RALLY FAMILY verbs (Step 3 item 4) ──────────────────────────────────────────────────────────────
    enemies: () => ctx.living(self.side === 'player' ? 'enemy' : 'player'),
    damage: (t, amount) => ctx.damage(t as Minion, amount),
    stripKeyword: (t, kw) => {
      const m = t as Minion;
      m.keywords = m.keywords.filter((k) => k !== kw);
      if (kw === 'R') m.rebornAvailable = false; // Rise removed → it can't come back this combat
      ctx.log({ type: 'keywordLost', target: m.uid, keyword: kw as Keyword, source: self.uid });
    },
    spellPower: () => ctx.spellPowerFor(self.side),
    castRepeat: (_spellId, body) => castInCombat(ctx, self, body),
    castNamedSpell: (spellId) => castNamedSpellInCombat(ctx, self, spellId),
    cardDef: (id) => ctx.getCard(id),
    gainShopBuff: (a, h) => ctx.gainTavernBuy(a, h, self.side, self.uid),
    grantUndeadAura: (a, h) => {
      // The Lantern channel's whole combat ritual: the living Undead feel it NOW, and the run-wide aura is
      // carried back at settle (which is what makes it permanent + visible on the shop board).
      for (const m of ctx.living(self.side)) {
        if (m.tribe === 'undead' || m.tribe2 === 'undead' || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
      }
      ctx.grantUndeadAura(a, h, self.side);
    },
    grantRubies: (count) => ctx.grantRubies(count, self.side, self.uid),
    grantRandomShoutMinion: (count) => ctx.grantRandomMinion(count, undefined, self.side, undefined, self.uid, undefined, true),
    hasEffect: (t, on, doId) => (t as Minion).effects.some((e) => e.on === on && (!doId || e.do === doId)),
    replayShout: (t) => {
      const m = t as Minion;
      // q-interact-combat-shout-multipliers (owner APPROVE 2026-08-27): a combat Shout re-fire folds the
      // Battlecry multipliers (Drakko), exactly like Ryme / Thunderous Sovereign / Chorus Drake — and like
      // the SHOP's shared `replayBattlecry`, which folds `drummerRepeats` INSIDE the shared body. Folding
      // here (the combat verb) mirrors that boundary, so every arena consumer (Embercrest, …) inherits it
      // and cannot drift flat again. One `battlecryTriggered` emit per fire, matching Ryme's convention.
      const reps = drakkoRepeats(ctx, self.side);
      for (let r = 0; r < reps; r++) {
        replayCombatBattlecry(ctx, m);
        ctx.bus.emit('battlecryTriggered', { side: self.side, minion: m });
      }
    },
    hasEcho: (t, strict) => (t as Minion).effects.some((e) => e.on === 'onDeath' && (!strict || e.do.startsWith('deathrattle'))),
    triggerEchoOn: (t, strict) => {
      const target = t as Minion;
      if (!strict) { triggerEcho(ctx, self, target); return; }
      // Deathsayer's narrower reading, preserved verbatim: ONE `rally` cue, then the Echo procs a real death
      // would produce (every Echo multiplier the side has × this minion's gild), `deathrattle*` ids only.
      ctx.log({ type: 'rally', source: self.uid, target: target.uid });
      const procs = (1 + (ctx.echoExtras?.(target) ?? 0)) * mul(self);
      for (let r = 0; r < procs; r++) {
        ctx.countDeathrattle?.(target.side);
        for (const effect of target.effects) {
          if (effect.on !== 'onDeath' || !effect.do.startsWith('deathrattle')) continue;
          FACTORIES[effect.do]?.(ctx, target, effect.params ?? {}, { minion: target, side: target.side });
        }
      }
    },
    graftEffect: (t, effect) => ctx.grantDeathrattle(t as Minion, [effect]), // grafts + registers ANY effect
    improveAttachments: (a, h) => {
      // Combat only ever reaches the UNWELDED Attachments still on the field; the carry-back applies the same
      // grant at settle to every Magnetic on board and in hand and stacks `magneticBuyAtk/Hp`, so welded, held
      // and future Attachments all inherit it.
      for (const m of ctx.living(self.side)) if (m !== self && m.keywords.includes('M')) ctx.buff(m, a, h, self.uid);
      ctx.grantMagneticBuff(a, h, self.side);
    },

    // ── START-OF-COMBAT FAMILY verbs (Step 3 item 4) ────────────────────────────────────────────────────
    armBleed: (every, targets) => ctx.armBleed(self, every, targets),
    grantSpellCastExtra: (extra) => ctx.grantSpellCastExtra?.(self.side, extra),
    fodderConsumed: () => ctx.fodderConsumedFor(self.side),
    alesLastTurn: () => ctx.alesLastTurnFor?.(self.side) ?? 0,
    engraveNeighbours: (text) => {
      // Taurus's legacy ritual, verbatim: BOARD-SLOT adjacency (the raw board, a dead immediate neighbour is
      // skipped, not walked past), the golden `gainMult` doubling, one `sc` line only if anything landed.
      const board = ctx.boards[self.side];
      const i = board.indexOf(self);
      if (i < 0) return;
      const engrave = (m: Minion | undefined): boolean => {
        if (!m || m.dead || m.health <= 0) return false;
        if (!m.keywords.includes('EG')) m.keywords.push('EG'); // mutates the per-combat clone, never a shared CardDef
        if (self.golden) m.gainMult = 2; // golden: this neighbor's combat stat-gains are doubled
        return true;
      };
      const did = [engrave(board[i - 1]), engrave(board[i + 1])];
      if (did.some(Boolean)) {
        ctx.log({ type: 'sc', source: self.uid, text: text || `${self.name} engraves the line` });
      }
    },
    engraveBoard: () => {
      for (const m of ctx.boards[self.side]) {
        if (m.dead || m.health <= 0) continue;
        if (!m.keywords.includes('EG')) m.keywords.push('EG');
      }
      ctx.log({ type: 'sc', source: self.uid, text: `${self.name} engraves the truth` });
    },
    castLeftmostHandSpellOnAdjacent: (tribe) => {
      // Quil's legacy ritual, verbatim (see the retired body's comment block for the ruling history).
      if (self.dead) return;
      const id = ctx.leftmostHandSpellFor(self.side);
      const def = id ? ctx.getCard(id) : undefined;
      if (!def?.spell) return;
      const board = ctx.living(self.side);
      const i = board.indexOf(self);
      if (i < 0) return;
      const targets = [board[i - 1], board[i + 1]].filter((m): m is Minion =>
        !!m && (m.tribe === tribe || m.tribe2 === tribe || !!ctx.getCard(m.cardId)?.universalTribe));
      if (targets.length === 0 || !combatCastable(def)) return; // pure tavern work never even counts a cast
      let announced = false;
      castInCombat(ctx, self, () => {
        // Resolved PER CAST, not hoisted: an escalating spell improves itself as it resolves.
        const did = resolveCombatSpellCast(ctx, self, def, targets);
        if (did && !announced) { ctx.log({ type: 'sc', source: self.uid, text: `${self.name} casts ${def.name}` }); announced = true; }
      });
    },
    echoEffectsOf: (t) => (t as Minion).effects
      .filter((e) => e.on === 'onDeath')
      .map((e) => ({ ...e, ...(e.params ? { params: { ...e.params } } : {}) })),

    rng: () => ctx.rng,
  };
}

function grantShield(ctx: CombatContext, m: Minion): void {
  if (m.dead || m.health <= 0 || m.divineShield) return;
  m.divineShield = true;
  if (!m.keywords.includes('DS')) m.keywords.push('DS');
  ctx.log({ type: 'shieldUp', target: m.uid });
}

/** Whether a minion has a Battlecry at all (any `onPlay` effect) — Ryme targets ANY Battlecry neighbour,
 *  including economy ones (Discover, gain-Gold…) which simply no-op in combat (nothing to do there). */
/** `onPlay` effects that are INTERNAL setup, not a printed **Shout** the player can see.
 *
 *  Living Grimoire arms its own charge on play; its text is "the first spell you cast each turn casts twice",
 *  with no Shout keyword. Because the arming rides an `onPlay`, playing it fired `battlecryTriggered` and
 *  procced Karwind (owner report 2026-07-27). A Shout payoff should only see Shouts the card actually has.
 *
 *  Grimoire is currently the only one — a sweep of every `onPlay` card found no other whose text lacks a
 *  printed Shout/Battlecry keyword. Add to this set (don't special-case at a call site) if another appears. */
export const SILENT_ONPLAY: ReadonlySet<string> = new Set(['battlecryArmGrimoire']);

const hasBattlecry = (m: Minion): boolean =>
  m.effects.some((e) => e.on === 'onPlay' && !SILENT_ONPLAY.has(e.do));

/** Drakko the Drummer's doubling for Ryme's re-fired Battlecries (combat mirror of recruit's `bestCopyRepeats`):
 *  count living Drakkos on `side`, golden → +2 else any → +1 (best single copy, NO stacking). Total = 1 + that,
 *  so one Drakko makes each trigger fire twice, a golden Drakko three times. */
export const drakkoRepeats = (ctx: CombatContext, side: Side): number =>
  1 + extraTriggerFires('battlecry', ctx.living(side), (id) => ctx.getCard(id));

/** The Battlecry `do` ids `replayCombatBattlecry` runs IN COMBAT (they affect the live fight). Every other
 *  onPlay `do` is an economy/recruit battlecry — deferred to settle and replayed through its recruit factory.
 *  Kept in sync with the explicit branches below; `settleCombat` reads it to skip the combat ones at settle. */

/** Re-fire a minion's Battlecry (its `onPlay` effects) in COMBAT — used by Ryme's Deathrattle. Combat-meaningful
 *  battlecries resolve here; economy ones (Fodder/Gold/shop/gain-minion) are recorded via `ctx.deferBattlecry`
 *  and replayed through their recruit factory at settle. Magnitude respects the source's own golden.
 *
 *  FULL AUDIT 2026-08-04 — every onPlay `do` id in content was checked against this chain. The three kinds that
 *  are still deferred ON PURPOSE, so the next reader doesn't re-audit them:
 *
 *   • **No combat surface.** Gold next turn, cards to hand, Discover-to-hand, shop consumption/buffs, run-flag
 *     grants (Beast Hunt, spell multipliers, Grimoire). A shop does not exist mid-fight; replaying at settle is
 *     the correct and only behaviour. `battlecryGrantSpell` additionally ANNOUNCES itself during the replay.
 *   • **Run-wide auras with no carry-back channel.** `battlecryBuffFodder` and `battlecryBuffMagnetics` enchant
 *     a CARD TYPE for the rest of the run (board + hand + future copies), not the bodies in front of you.
 *     Buffing the live board here would be a visible half-measure that then DOUBLE-applies at settle. Doing
 *     them properly needs a `grantMagneticBuff`-style channel alongside `grantImpBuff`/`grantUndeadBuyAtk`;
 *     until that exists, deferring is the honest behaviour.
 *   • **Reads state combat doesn't carry.** `battlecryBuffTargetPerGoldSpent` (Baby Gastrid) scales off
 *     `goldSpentThisTurn`, which is not on `CombatContext`; and `battlecryCopyEcho` (Gravetwin) needs the
 *     CHOSEN target that a re-fire has no way to reproduce. */
export function replayCombatBattlecry(ctx: CombatContext, m: Minion): void {
  // THE SWITCH IS DEAD (2026-08-04). Every combat-meaningful Shout lives in FACTORIES (arena-backed, or
  // phase-split by ruling) and resolves LIVE here; anything else is economy — no tavern, Gold or hand exists
  // in pure combat — and defers to settle, where it replays through its recruit factory.
  // SHOP→COMBAT CARRY-OVER (owner ruling 2026-08-26): a Shout triggered in combat consumes the side's carried
  // shop charges — an unspent War Drum charge on the first Shout, a Warm Embers double on each of the next N
  // (see CombatContext.shoutCarryExtras). Guarded on a real onPlay effect so a no-op call (Ryme re-firing a
  // Shout-less neighbour) never eats a charge. Each extra fire repeats the WHOLE Battlecry, economy defers
  // included — the same "n fires" the shop counter would have paid.
  const hasShout = m.effects.some((e) => e.on === 'onPlay');
  const fires = 1 + (hasShout ? ctx.shoutCarryExtras?.(m.side) ?? 0 : 0);
  for (let f = 0; f < fires; f++) {
    if (f > 0) ctx.log({ type: 'sc', source: m.uid, text: `${m.name}'s Battlecry fires again (carried Shout charge)` });
    let economy = false;
    for (const eff of m.effects) {
      if (eff.on !== 'onPlay') continue;
      const live = FACTORIES[eff.do as EffectFactoryId];
      if (live) {
        live(ctx, m, eff.params ?? {}, { minion: m, side: m.side });
        continue;
      }
      economy = true;
    }
    if (economy) ctx.deferBattlecry(m.cardId, m.golden, m.side);
  }
  // NB: the `battlecryTriggered` notify (procs Karwind / Bane / Sporeling) is emitted by the CALLER
  // (deathrattleReplayAdjacentBattlecry) once per re-fire — not here, or every watcher would double-proc.
}

/** Trigger a minion's Echo (Deathrattle) WITHOUT it dying — the shared body for Echohorn Stag / Hawkus / Spots.
 *  The Echo fires as many times as a real death would (every Echo multiplier the side has — Sylus, Uron,
 *  Funeral Engine…), then `self`'s gild DOUBLES that whole count. Logs a `rally` cue per proc (the "trigger
 *  this Deathrattle" visual). ANY `onDeath` effect counts, not just ids that start with "deathrattle". */
export function triggerEcho(ctx: CombatContext, self: Minion, target: Minion): void {
  const procs = (1 + (ctx.echoExtras?.(target) ?? 0)) * mul(self);
  const runProcs = (): void => {
    for (let r = 0; r < procs; r++) {
      ctx.log({ type: 'rally', source: self.uid, target: target.uid });
      // Route through the ECHO-TRIGGER chokepoint (`ctx.asEcho`), so the "an Echo fired" runes — Aftershocks
      // (+4/+4 to the board), Burrow (a free refresh on a Beast Echo) — see a FORCED trigger exactly like a
      // death-fired one. Owner report 2026-08-20: Aftershocks only fired on a real death, because this loop
      // called the `onDeath` factories directly. ONE wrap per proc (a body with two Echo effects is still one
      // trigger; each multiplier proc is its own). Falls back to a bare run when no chokepoint is supplied,
      // so a context without it (tests, the recruit-phase arena) behaves exactly as before.
      const fire = (): void => {
        ctx.countDeathrattle?.(target.side);
        for (const effect of target.effects) {
          if (effect.on !== 'onDeath') continue;
          FACTORIES[effect.do]?.(ctx, target, effect.params ?? {}, { minion: target, side: target.side });
        }
      };
      if (ctx.asEcho) ctx.asEcho(target.side, fire, target);
      else fire();
    }
  };
  // DEFER every death across ALL procs into one flush: a golden Echohorn triggers its Rally twice, and a
  // Fel-Spikes-style board spray must let a ≤0 victim stay on the board taking hits from every volley of both
  // procs and die ONCE after — no resolve between the two rallies (owner ruling 2026-08-21). Mirrors the
  // death-fired path's scope; a context without `withEchoDefer` (recruit arena, tests) runs the procs directly.
  if (ctx.withEchoDefer) ctx.withEchoDefer(runProcs);
  else runProcs();
}

/** Pick a random stat-granting Tavern spell (spellBuffTarget / spellBuffAll) and return its buff with combat
 *  spell power folded in and scaled by `scale` (golden). Returns null if the pool is empty or the picked spell
 *  grants nothing. Used by the combat spell-cast cards (Spell Drummer, Spark Capacitor). */
function randomStatSpellBuff(ctx: CombatContext, scale: number, side: Side): { spellId: string; attack: number; health: number } | null {
  const pool = ctx
    .allCards()
    .filter((c) => c.spell && !c.singleCast && c.effects.some((e) => e.do === 'spellBuffTarget' || e.do === 'spellBuffAll'));
  if (pool.length === 0) return null;
  const spell = ctx.rng.pick(pool);
  const eff = spell.effects.find((e) => e.do === 'spellBuffTarget' || e.do === 'spellBuffAll')!;
  const sp = ctx.spellPowerFor(side); // per-side: an enemy caster folds the OPPONENT's spell power
  const attack = (num(eff.params?.attack, 0) + sp.attack) * scale;
  const health = (num(eff.params?.health, 0) + sp.health) * scale;
  return attack > 0 || health > 0 ? { spellId: spell.id, attack, health } : null;
}

/**
 * Resolve ONE cast of a Shop Spell mid-fight (owner ruling 2026-08-07): everything that has a meaning outside
 * the tavern resolves in combat — stat buffs, spell power, Gold, free rolls, Rubies, card grants, Discovers
 * (queued for after the fight), shop buffs (banked for the next shop). Only PURE tavern work fizzles:
 * Displacement, gilding, steals, transforms, sells; refresh-shaped specials map to a banked free roll,
 * since there is no live shop to re-stock mid-fight.
 *
 * Returns true if the cast did anything. `targets` is the caster's choice for a TARGETED spell (Quil's
 * adjacency, Badgington's chosen Beast); an untargeted spell ignores it and resolves its own shape.
 * Callers run this INSIDE `castInCombat`, once per repetition — escalating spells advance per cast.
 */
export function resolveCombatSpellCast(ctx: CombatContext, self: Minion, def: CardDef, targets?: Minion[]): boolean {
  const side = self.side;
  // Rune of Shared Scripture listens here — every combat Shop-spell cast that RESOLVES reports itself, so the
  // rune sees real casts rather than attempts. Announced up front: the rune's Shout/Rally is a reaction to the
  // cast happening, and the spell's own effects land immediately after.
  ctx.onCombatSpellCast?.(side);
  const sp = ctx.spellPowerFor(side);
  const alive = (): Minion[] => ctx.living(side);
  const chosen = (): Minion[] => (targets && targets.length > 0 ? targets : alive().filter((m) => m !== self).slice(0, 1));

  // A Discover spell's payload is the OFFER, not effects[] — the modal can't open mid-fight, so the CAST is
  // carried back and settle queues the real pick.
  if (def.discoverOnPlay) { ctx.queueDiscoverCast?.(def.id, side); return true; }

  let did = false;
  // Rune of Living Growth: the Growth spell has permanently grown — the accrual rides the side state
  // (snapshot-captured, so a served board's Growth pays ITS run's value, not the player's).
  const growthPlus = def.id === 'growth' ? (ctx.growthBonusFor?.(side) ?? 0) : 0;
  for (const eff of def.effects) {
    if (eff.on !== 'cast') continue;
    const a = num(eff.params?.attack, 0) + growthPlus;
    const h = num(eff.params?.health, 0) + growthPlus;
    switch (eff.do) {
      // ── stat family ──
      case 'spellBuffTarget': {
        for (const t of chosen()) ctx.buff(t, a + sp.attack, h + sp.health, self.uid);
        did = true; break;
      }
      case 'spellBuffAll': {
        for (const t of alive()) ctx.buff(t, a + sp.attack, h + sp.health, self.uid);
        did = true; break;
      }
      // BEEFY (owner report 2026-08-19: "not getting spell power buffs"). The id was simply MISSING here, so a
      // Beefy cast in combat — Sporebat's Echo, Steward / Recaller, Ryme, any hand-spell re-fire — fizzled
      // outright rather than under-paying. Same failure mode, and the same fix, as Reinforcing Ale above.
      // Buffs the chosen target and its LIVING neighbours, mirroring the recruit factory (which finds the
      // target's board index and takes i-1 / i / i+1). `livingNeighbours` walks outward past dead bodies,
      // which is the combat-correct reading of "its neighbours" mid-fight.
      // LANTERN LIGHT — found by the same audit, same failure: "+1/+1 per Tavern Tier" had no case here, so a
      // combat re-fire did nothing. `tierFor` is per-side, so a served enemy scales on ITS tier, not the
      // player's — matching how every other snapshot-backed scaler reads in combat.
      case 'spellBuffByTier': {
        const t = ctx.tierFor(side);
        for (const m of chosen()) ctx.buff(m, t + sp.attack, t + sp.health, self.uid);
        did = true; break;
      }
      case 'spellBuffTargetAndNeighbours': {
        const seen = new Set<Minion>();
        for (const t of chosen()) {
          for (const m of [t, ...livingNeighbours(ctx, t)]) {
            if (m.dead || m.health <= 0 || seen.has(m)) continue;
            seen.add(m);
            ctx.buff(m, a + sp.attack, h + sp.health, self.uid);
          }
        }
        did = seen.size > 0; break;
      }
      // Reinforcing Ale (owner report 2026-08-08: Sporebat's Echo cast it and nothing happened — the id was
      // simply missing here, so the cast fizzled). "Your most common type" resolves against this side's
      // LIVING board, both tribes counted, ties to the left-most seen — then the grant rides the same
      // settle-time carry every combat hand-grant uses.
      case 'spellGrantTopTypeMinion': {
        const counts = new Map<string, number>();
        for (const m of alive()) {
          for (const t of [m.tribe, m.tribe2]) if (t && t !== 'neutral') counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        let top: string | undefined; let best = 0;
        for (const [t, n] of counts) if (n > best) { top = t; best = n; }
        if (top) { ctx.grantRandomMinion(1, top as never, side, undefined, self.uid); did = true; }
        break;
      }
      case 'spellBuffRandomFriendlies': {
        const pool = [...alive()];
        for (let i = 0; i < num(eff.params?.count, 2) && pool.length > 0; i++) {
          ctx.buff(pool.splice(ctx.rng.int(pool.length), 1)[0]!, a + sp.attack, h + sp.health, self.uid);
        }
        did = true; break;
      }
      case 'spellBuffLeftmost': {
        const t = alive()[0];
        if (t) { ctx.buff(t, a + sp.attack, h + sp.health, self.uid); did = true; }
        break;
      }
      // Dragonflame — buff `base` + (# friendly `tribe`) random living friendlies (with replacement, so more
      // buffs than bodies simply stacks). The per-buff value is the spell's flat +4/+4 + spell power.
      case 'spellBuffRandomPerTribe': {
        const tribe = str(eff.params?.tribe);
        const count = alive().filter((m) =>
          !tribe || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe).length;
        const reps = num(eff.params?.base, 1) + count;
        for (let i = 0; i < reps; i++) {
          const pool = alive();
          if (pool.length === 0) break;
          ctx.buff(pool[ctx.rng.int(pool.length)]!, a + sp.attack, h + sp.health, self.uid);
        }
        did = true; break;
      }
      // Flutter — the chosen minion gains +Health (+ spell power); a Dragon also gets Flurry.
      case 'spellBuffHealthGrantFlurryDragon': {
        for (const t of chosen()) {
          ctx.buff(t, sp.attack, num(eff.params?.health, 10) + sp.health, self.uid);
          const isDragon = t.tribe === 'dragon' || t.tribe2 === 'dragon' || !!ctx.getCard(t.cardId)?.universalTribe;
          if (isDragon && !t.keywords.includes('W')) t.keywords.push('W');
        }
        did = true; break;
      }
      case 'spellBuffTargetEscalating': {
        // Attack and Health escalate INDEPENDENTLY, each stat's step compounding its own spell power — the
        // same arithmetic the shop half runs. The stats are temporary; the IMPROVEMENT is permanent and
        // carries back (owner ruling 2026-08-07), and is live for the rest of this fight.
        const step = { attack: num(eff.params?.attack, 2), health: num(eff.params?.health, 2) };
        const acc = ctx.spellEscalationFor?.(side) ?? { attack: 0, health: 0 };
        for (const t of chosen()) {
          ctx.buff(t, step.attack + acc.attack + sp.attack, step.health + acc.health + sp.health, self.uid);
        }
        ctx.grantSpellEscalation?.(step.attack + sp.attack, step.health + sp.health, side);
        // Announced so the REPLAY can move the held card's printed value live (owner ask 2026-08-07) — the
        // run state itself only takes the gain at settle, exactly like every other carry-back.
        ctx.log({ type: 'sc', source: self.uid, side, text: `${def.name} improves +${step.attack + sp.attack}/+${step.health + sp.health}` });
        did = true; break;
      }
      // ── economy + power ──
      case 'spellGainSpellPower': ctx.grantSpellPower(a, h, side, self.uid); did = true; break;
      case 'gainEmbers': ctx.grantBonusGold(num(eff.params?.amount, 1), side); did = true; break;
      case 'grantFreeRolls': ctx.grantFreeRolls(num(eff.params?.count, 1), side); did = true; break;
      // A refresh-shaped special cannot re-stock a shop that does not exist mid-fight — bank a free roll, so
      // the cast still pays its refresh forward rather than silently vanishing.
      case 'spellRefreshToSpells': case 'spellRefreshToTribe': case 'spellRefreshTierUp':
        ctx.grantFreeRolls(1, side); did = true; break;
      case 'spellBuffShop': case 'spellBuffTavern': case 'spellBuffNextShop':
        ctx.gainNextShopBuff?.(num(eff.params?.attack, 2), num(eff.params?.health, 2), side); did = true; break;
      // ── cards + Rubies ──
      case 'getRubies': ctx.mintRubies(num(eff.params?.count, 1), side, self.uid); did = true; break;
      case 'rubyStatGain': {
        for (const t of chosen()) playRubyOn(ctx, self, t, 1);
        did = true; break;
      }
      case 'spellGainRandomMinion': {
        const tier = num(eff.params?.tier, 1);
        const pool = ctx.poolCards(side).filter((c) => !c.spell && !c.token && c.tier === tier);
        if (pool.length > 0) { ctx.grantToHand(ctx.rng.pick(pool).id, side, self.uid); did = true; }
        break;
      }
      default: break; // pure tavern work — fizzles, by the ruling
    }
  }
  return did;
}

/** The targeted spells `resolveCombatSpellCast` can actually execute — Badgington's random pool. Extend BOTH
 *  when a targeted family lands in the resolver. */
const COMBAT_TARGETED_SPELL_DOS = new Set(['spellBuffTarget', 'spellBuffTargetEscalating', 'rubyStatGain', 'spellBuffTargetAndNeighbours', 'spellBuffByTier']);

/** Every effect id the resolver's switch executes — the PURE half of the resolvability question, so a caller
 *  can decline to cast at all (and never count a cast) when the spell would fizzle. Kept beside the switch:
 *  a family added there without extending this set silently counts fizzling casts again. */
const COMBAT_CASTABLE_SPELL_DOS = new Set([
  'spellBuffTarget', 'spellBuffAll', 'spellBuffRandomFriendlies', 'spellBuffLeftmost', 'spellBuffTargetEscalating',
  'spellGainSpellPower', 'gainEmbers', 'grantFreeRolls', 'spellRefreshToSpells', 'spellRefreshToTribe',
  'spellRefreshTierUp', 'spellBuffShop', 'spellBuffTavern', 'spellBuffNextShop', 'getRubies', 'rubyStatGain',
  'spellGainRandomMinion', 'spellGrantTopTypeMinion', 'spellBuffRandomPerTribe', 'spellBuffHealthGrantFlurryDragon',
  'spellBuffTargetAndNeighbours', 'spellBuffByTier', // Beefy + Lantern Light (2026-08-19)
]);

/** Would `resolveCombatSpellCast` do anything with this spell? Pure — safe to gate on before castInCombat,
 *  so a pure-tavern spell never even counts as a cast. */
export function combatCastable(def: CardDef): boolean {
  if (!def.spell) return false;
  if (def.discoverOnPlay) return true;
  return def.effects.some((e) => e.on === 'cast' && COMBAT_CASTABLE_SPELL_DOS.has(e.do));
}

/** Shared "this minion casts a NAMED spell mid-combat" path (Flamebeat's Rally, Warflame's on-Dragon-attack).
 *  A real cast via `castInCombat` + `resolveCombatSpellCast` — counts, fires spell watchers, golden = two casts.
 *  A targeted spell picks a seeded random living friendly; an untargeted one resolves its own targeting. A spell
 *  with no combat implementation (or nothing to aim at) fizzles without counting. */
export function castNamedSpellInCombat(ctx: CombatContext, self: Minion, spellId: string): void {
  const def = spellId ? ctx.getCard(spellId) : undefined;
  if (!def?.spell || self.dead || !combatCastable(def)) return;
  castInCombat(ctx, self, () => {
    const friends = ctx.living(self.side);
    const targets = def.target ? (friends.length ? [ctx.rng.pick(friends)] : []) : undefined;
    if (def.target && (!targets || targets.length === 0)) return;
    if (resolveCombatSpellCast(ctx, self, def, targets)) {
      ctx.log({ type: 'sc', source: self.uid, text: `${self.name} casts ${def.name}` });
    }
  });
}

/** Scavvers ↔ Echohorn recursion guard — see `deathrattleTriggerAdjacentRally`. */
const SCAVVERS_CHAIN_MAX = 2;
let scavversChainDepth = 0;

/**
 * Combat-time factories. This is a *partial* registry: recruit-time ids
 * (battlecries, buff-on-buy) are implemented in `@game/sim` against the run
 * board, and any effect without a combat factory here is simply inert during
 * `simulate()` (see `registerEffects`).
 */
export const FACTORIES: Partial<Record<EffectFactoryId, EffectFn>> = {
  /**
   * ── "WHEN A CARD IS ADDED TO YOUR HAND", IN COMBAT (owner report 2026-08-29) ───────────────────────────
   *
   * *"gangplank doesnt trigger when cards are added to hand in combat… cards added to hand is an effect in
   * recruit + shop and should trigger effects that track them in all places."*
   *
   * These two had NO combat factory at all, which is why they were silent mid-fight: `registerEffect` skips
   * any effect whose `do` has no entry in this table, so the bus never carried `onGainCard` and no reactor
   * was ever subscribed. The shop's hand uid-diff still paid out at settle, so the stats did arrive — one
   * fight too late to matter.
   *
   * Both delegate to the SHARED arena body, the same one the recruit factories now call, so the two phases
   * run one implementation and cannot drift. `ctx.grantToHand` and `ctx.grantRubies` emit the event.
   */
  onGainCardBuffTribe: (ctx, self, params, payload) => {
    if (!gainedByOwnSide(self, payload)) return;
    ARENA_EFFECTS.onGainCardBuffTribe(combatArena(ctx, self), params);
  },
  onGainAleBuffSelf: (ctx, self, params, payload) => {
    if (!gainedByOwnSide(self, payload)) return;
    ARENA_EFFECTS.onGainAleBuffSelf(combatArena(ctx, self), params, (payload as { cardId?: string }).cardId);
  },

  /** Deathrattle: summon `count` copies of token `tokenId` beside self. (Echo Warden adds copies
   *  in the summon path itself — see `simulate`'s summonMinion — so it isn't applied here.) */
  // ARENA-MIGRATED (Step 3): one body in arena.ts (fixed / goldenTokens / keyword all live there now).
  deathrattleSummon: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleSummon(combatArena(ctx, self), params);
  },


  /** Nanon — Deathrattle: summon `count` tokens; every one that can't fit the full board (a `summonOverflow`)
   *  instead buffs your minions of `tribe` by +atk/+hp EACH. Golden doubles the *buff* (the summon count is
   *  fixed — a full board converts more bodies into a bigger Mech-wide pump). The gift lasts the combat. */
  // ARENA-MIGRATED (Echo family): one body; the shop half is ARENA-BORN (Legion Shepherd's class).
  deathrattleSummonOverflowBuff: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleSummonOverflowBuff(combatArena(ctx, self), params);
  },


  /** Sporebat — Deathrattle: grant N random tavern-tier spells to your hand after combat (golden 2). The
   *  tier-bounded pick happens at settle (where the tavern tier is known); combat just banks the count. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGrantRandomSpell: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleGrantRandomSpell(combatArena(ctx, self), params);
  },

  /** Gryphon — when it takes damage, bank a free shop reroll (carried back). Once PER HIT, capped at
   *  `max` (default 4) banks per combat (the `grantedRefresh` counter), so a Taunt soaking a whole board
   *  tops out at the cap instead of rolling unlimited refreshes. Golden grants 2 per hit. */
  onDamagedGrantRefresh: (ctx, self, params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    const cap = num(params.max, 4);
    const got = self.grantedRefresh ?? 0;
    if (got >= cap) return;
    self.grantedRefresh = got + 1;
    ctx.grantFreeRolls(num(params.count, 1) * mul(self), self.side);
  },

  // Den Mother (`summonBuffTribeImprove`) is RECRUIT-ONLY (owner ruling 2026-07-08): it improves your Beasts
  // as you PLAY them in the shop, but does NOT fire on combat summons — so there's no combat factory here (the
  // recruit half lives in recruit.ts). An effect with no combat factory is inert in combat (registerEffects).

  /** When a friendly minion of `tribe` is summoned, buff it. The per-stat magnitude is the
   *  base buff + `self.summonBonus` (Kennelmaster's Avenge / triple-combined bonus). No golden
   *  doubling here — a golden's bonus already encodes the combined magnitude (see checkTriples). */
  buffOnSummon: (ctx, self, params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side || minion === self) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    if (tribe !== 'any' && minion.tribe !== tribe && minion.tribe2 !== tribe && !ctx.getCard(minion.cardId)?.universalTribe) return;
    const bonus = self.summonBonus;
    ctx.buff(minion, num(params.attack) + bonus, num(params.health) + bonus, self.uid);
  },

  /** Spirit Worgen (combat half): when a friendly minion of one of `tribes` is summoned mid-fight,
   *  gain +X/+X where X = base + spells cast this turn (frozen at combat start). Temporary — combat is
   *  a simulation, so the gain doesn't touch the run board and the Worgen is back to its recruit stats
   *  next shop. (The recruit half of the same effect id buffs permanently when you play a Beast/Dragon.) */
  // ARENA-MIGRATED (Step 3): one body; the SHOP formula won the divergence (owner ruling 2026-08-04, and
  // the printed text agrees: base × (1 + spells)).
  summonBuffSelfTribe: (ctx, self, params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side || minion === self || !minion) return;
    ARENA_EFFECTS.summonBuffSelfTribe(combatArena(ctx, self), { ...params, arriver: minion });
  },

  /** Deathrattle: buff all living friends of `tribe` (+atk/+hp) — Grim / Mushy. Membership (a living,
   *  proc'd-not-dead body buffs ITSELF too) is the arena body's contract, shared with the shop. */
  // ── ARENA-MIGRATED (2026-08-20): one body in arena.ts serves both phases.
  deathrattleBuffTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleBuffTribe(combatArena(ctx, self), params);
  },

  /** Wolvie (owner add 2026-08-12) — Echo: queue a one-shot buff for the NEXT `tribe` minion you summon this
   *  combat (+atk/+hp, golden doubled). The summon chokepoint applies + consumes the front of the queue. */
  deathrattleBuffNextSummon: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.queueNextSummonBuff(self.side, (str(params.tribe) || 'beast') as Tribe,
      num(params.attack, 2) * mul(self), num(params.health, 4) * mul(self));
  },

  /** Deathrattle (Grim): buff your `tribe` by +`per`/+`per` per Deathrattle triggered this game (the
   *  run-wide base + this combat's player Deathrattles, snapshotted now — Grim's own death is counted).
   *  Registers a rest-of-combat aura at that magnitude, then buffs the friends already on the board.
   *  Golden doubles `per`. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases (per-side tally via the adapter).
  deathrattleBuffTribeByTally: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleBuffTribeByTally(combatArena(ctx, self), params);
  },

  /** On kill (Gnasher): buff self by +atk/+hp. Pairs with Engraved so the gain is permanent. The onKill
   *  payload carries the killer as `attacker`, so only the minion that scored the kill fires. */
  onKillBuffSelf: (ctx, self, params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    ctx.buff(self, num(params.attack) * mul(self), num(params.health) * mul(self), self.uid);
  },

  /** On kill (Gnasher): each kill permanently raises run-wide spell power +atk/+hp (golden doubles).
   *  Player carry-back via `CombatResult.playerSpellPower` → applied in settleCombat. Same attacker-guard
   *  as onKillBuffSelf (the onKill payload carries the killer as `attacker`). */
  onKillBuffSpellPower: (ctx, self, params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    ctx.grantSpellPower(num(params.attack, 1) * mul(self), num(params.health) * mul(self), self.side, self.uid);
  },

  /** Moe — Slaughter (on kill): bank `count` free rerolls for your next shop (golden doubles). Carried back
   *  via CombatResult like the other on-kill economy grants. Attacker-guarded (only Moe's own kills). */
  onKillGrantFreeRolls: (ctx, self, params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    ctx.grantFreeRolls(num(params.count, 2) * mul(self), self.side);
  },

  /** Moe — Slaughter (on kill): bank `count` free refreshes next turn AND make that many upcoming shops each
   *  guarantee a Magnetic (Attachment) offer. Golden doubles both. Attacker-guarded. */
  onKillGrantAttachmentRefreshes: (ctx, self, params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    const n = num(params.count, 2) * mul(self);
    ctx.grantFreeRolls(n, self.side);
    ctx.grantGuaranteedAttachments(n, self.side);
  },

  /** Bounty Bot — Slaughter (on kill): grant `gold` one-time Gold into your next shop (golden doubles).
   *  Carried back via `CombatResult.playerBonusGold` → next turn's starting Gold. Attacker-guarded. */
  onKillGrantGold: (ctx, self, params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    ctx.grantBonusGold(num(params.gold, 2) * mul(self), self.side);
  },

  /** Hoardbreaker Drake — Slaughter (on kill): "cast" a board-wide stat spell (Growth) — buff all living
   *  friends by the spell's +atk/+hp PLUS combat spell power. Golden doubles the grant. Attacker-guarded, so
   *  it fires once per kill this minion lands (extra kills re-cast). */
  onKillCastSpell: (ctx, self, params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    const spell = ctx.getCard(str(params.spellId));
    const eff = spell?.effects.find((e) => e.do === 'spellBuffAll' || e.do === 'spellBuffTarget');
    if (!eff) return;
    const sp = ctx.spellPowerFor(self.side); // per-side: enemy Hoardbreaker scales with the OPPONENT's spell power
    const a = num(eff.params?.attack, 0) + sp.attack;
    const h = num(eff.params?.health, 0) + sp.health;
    if (a <= 0 && h <= 0) return;
    // Golden "casts Growth twice" = TWO genuine casts (mul = 2), not one doubled cast — so it procs in-combat
    // spell reactions (Guel, transforms, spell-count payoffs) twice, matching how a hand-played "twice" resolves.
    castInCombat(ctx, self, () => {
      const targets = eff.do === 'spellBuffAll' ? ctx.living(self.side) : ctx.living(self.side).filter((m) => m !== self);
      for (const t of targets) ctx.buff(t, a, h, self.uid);
    });
  },

  /** Hoardbreaker Drake (Rally): on its OWN attack, "cast Growth" — the Slaughter twin (onKillCastSpell) on the
   *  attack trigger. Buffs the board by the spell's stats + combat spell power (golden doubles) and counts as a
   *  real cast. Fires once per swing (Windfury → twice). */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyCastSpell: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyCastSpell(combatArena(ctx, self), params);
  },

  /** Set 2 — Cinderchef (Rally): on its OWN attack, gain +atk/+hp. Golden doubles. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyBuffSelf: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyBuffSelf(combatArena(ctx, self), params);
  },

  /** Set 2 — Flamebeat Drake (Rally): on its OWN attack, cast a NAMED spell (Dragonflame) in combat. A genuine
   *  cast through `castInCombat` + `resolveCombatSpellCast`, so it counts and fires spell watchers; golden = two
   *  casts. Untargeted spells resolve their own random targeting inside the resolver. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyCastNamedSpell: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyCastNamedSpell(combatArena(ctx, self), params);
  },

  /** Set 2 — Warflame (combat): whenever a friendly minion of `tribe` attacks, cast a NAMED spell (Dragonflame).
   *  Any qualifying ally's swing fires it (Windfury → per swing); the caster's own swing counts too. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onTribeAttackCastNamedSpell: (ctx, self, params, payload) => {
    if (self.dead) return;
    const { minion } = payload as MinionPayload;
    if (!minion || minion.side !== self.side) return;
    ARENA_EFFECTS.onTribeAttackCastNamedSpell(combatArena(ctx, self), { ...params, attacker: minion });
  },

  /** Set 2 — Roarcollector (Rally): on its OWN attack, add a random SHOUT minion (one with a real `onPlay`) to
   *  your hand, tier-capped by the run pool — carried back after combat like every combat hand-grant. Golden = 2. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyGrantRandomShoutMinion: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyGrantRandomShoutMinion(combatArena(ctx, self), params);
  },

  /** Set 2 — Embercrest (Rally): on its OWN attack, re-trigger the Shouts of your other `tribe` (Dragon) minions.
   *  Routed through the SAME machinery every Shout re-trigger uses (`replayCombatBattlecry` for the effect, then
   *  the `battlecryTriggered` emit so Karwind / Bane / Embermouth watchers proc) — see
   *  `deathrattleReplayAdjacentBattlecry`. Economy-only Shouts defer to settle. Embercrest's own trigger is an
   *  attack, not an `onPlay`, so it can never recurse. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyTriggerTribeShouts: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyTriggerTribeShouts(combatArena(ctx, self), params);
  },

  /** Spell Drummer — Rally: cast a random stat spell on a random friendly minion (its buff + combat spell power,
   *  golden-scaled). It's a REAL cast — fires in-combat spell reactions (Guel, Forsaken Weaver…) — then adds a
   *  copy of THAT SPELL to your hand (carried back via `playerHandGrants`). */
  rallyCastRandomStatSpell: (ctx, self, _params, payload) => {
    if ((payload as { minion?: Minion }).minion !== self) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    const pick = randomStatSpellBuff(ctx, mul(self), self.side);
    if (!pick) return;
    // `randomStatSpellBuff` already folded the golden multiplier into `pick`, so the cast wrapper must not
    // apply it a second time — pass a non-golden self and let it own only the extra-cast repetitions.
    castInCombat(ctx, { ...self, golden: false } as Minion, () => {
      ctx.buff(ctx.rng.pick(friends), pick.attack, pick.health, self.uid); // the stat spell on a random friend
    });
    ctx.grantToHand(pick.spellId, self.side, self.uid); // add a copy of THAT spell to your hand
  },

  /** Spark Capacitor — Avenge (N): cast a random stat spell on your lowest-Health friendly Mech (its buff +
   *  combat spell power, golden-scaled). A real cast — fires in-combat spell reactions + counts. */
  avengeCastRandomStatSpell: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 4));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    const mechs = ctx
      .living(self.side)
      .filter((m) => m.tribe === 'mech' || m.tribe2 === 'mech' || ctx.getCard(m.cardId)?.universalTribe);
    if (mechs.length === 0) return;
    const target = mechs.reduce((a, b) => (b.health < a.health ? b : a)); // lowest Health
    const pick = randomStatSpellBuff(ctx, mul(self), self.side);
    if (!pick) return;
    // As above: `pick` already carries the golden scaling.
    castInCombat(ctx, { ...self, golden: false } as Minion, () => {
      ctx.buff(target, pick.attack, pick.health, self.uid);
    });
  },

  /** Deathrattle (Blaster): deal `amount` to every living minion on BOTH sides (friendly included).
   *  Snapshots each side's living list first so cascading deaths don't disturb the sweep. */
  // ── SHOUT FAMILY (arena-backed; dispatched by replayCombatBattlecry's FACTORIES-first pass) ──
  battlecrySummon: (ctx, self, params) => {
    ARENA_EFFECTS.battlecrySummon(combatArena(ctx, self), params);
  },
  battlecryBuffTribe: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffTribe(combatArena(ctx, self), params);
  },
  battlecryBuffImps: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffImps(combatArena(ctx, self), params);
  },
  battlecryBuffUndeadAttack: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffUndeadAttack(combatArena(ctx, self), params);
  },
  battlecryBuffTribeOthersAttack: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffTribeOthersAttack(combatArena(ctx, self), params);
  },
  // Unification FIXED the combat trigger count: N separate Rubies, N onRubyPlayed notifications ("play 2
  // Rubies has to mean two" — the shop half's documented design; combat used to fold per into one notify).
  battlecryPlayRubiesAll: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryPlayRubiesAll(combatArena(ctx, self), params);
  },
  battlecryBuffTarget: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffTarget(combatArena(ctx, self), params);
  },
  battlecryGrantKeyword: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryGrantKeyword(combatArena(ctx, self), params);
  },
  battlecryGainKeyword: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryGainKeyword(combatArena(ctx, self), params);
  },
  battlecryBuffSpellPower: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffSpellPower(combatArena(ctx, self), params);
  },
  battlecryGrantSpellPowerRun: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryGrantSpellPowerRun(combatArena(ctx, self), params);
  },
  // ── ECONOMY SHOUTS WITH CARRY-BACK CHANNELS (2026-08-04): these used to defer to settle; each now resolves
  // LIVE through the channel that already carries its result back to the run, so the replay shows the grant on
  // the trigger beat. Shop halves keep their own rituals (hand cap / board overflow / Candle Conduit) — the
  // carry-back reproduces them at settle.
  battlecryGrantMinion: (ctx, self, params) => {
    const id = str(params.cardId);
    if (!id) return;
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) ctx.grantToHand(id, self.side, self.uid);
  },
  battlecryGrantRandomSpell: (ctx, self, params) => {
    ctx.grantRandomSpell(num(params.count, 1) * mul(self), self.side, self.uid);
  },
  battlecryGainRandomMinion: (ctx, self, params) => {
    // `tier` > 0 pins the pick to that exact tier (Recruiter / the tier-7 finder), else ≤ the tavern tier.
    ctx.grantRandomMinion(num(params.count, 1) * mul(self), str(params.tribe) || undefined, self.side, undefined, self.uid, num(params.tier) || undefined);
  },
  battlecryGetRubies: (ctx, self, params) => {
    ctx.mintRubies(num(params.count, 1) * mul(self), self.side, self.uid);
  },
  /**
   * COMBAT twin of the recruit `grantRandomChooseOne` (Flagrunner's Rally).
   *
   * A Rally fires mid-fight, so the recruit factory alone would mean the card did nothing at the only moment
   * it can trigger — the silent-dispatch shape the `factoryPhase` lane exists to catch, and which it caught
   * here. Same recipe as `grantRandomAle`: only cards actually in this run's pool, so a set without Choose One
   * cards grants nothing rather than reaching outside the set.
   */
  grantRandomChooseOne: (ctx, self, params, payload) => {
    // THE PAYLOAD GUARD IS LOAD-BEARING (owner report 2026-08-31: "when any minion attacks or takes damage, i
    // am getting choose one cards"). `onAttack` is BROADCAST to every friendly minion's effects, so a factory
    // without this guard is an ally-attack watcher (Crypt Drake), not a Rally — Flagrunner paid out on
    // every swing on the board, its own or not. `minion !== self` is the same one-line gate every true Rally
    // in this file carries; the `rallyGuard` Doc Bot lane now enforces it rather than trusting the reading.
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    const pool = ctx.poolCards(self.side).filter((c) => (c.chooseOne?.length ?? 0) > 0);
    if (pool.length === 0) return;
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) ctx.grantToHand(ctx.rng.pick(pool).id, self.side, self.uid);
  },
  grantRandomAle: (ctx, self, params) => {
    // Same recipe as Rune of Last Call: only Ales actually in this run's pool (a set without them grants nothing).
    const ales = ctx.poolCards(self.side).filter((c) => ALE_IDS.includes(c.id));
    if (ales.length === 0) return;
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) ctx.grantToHand(ctx.rng.pick(ales).id, self.side, self.uid);
  },
  rubyStatGain: (ctx, self, params) => {
    // gainRubyBonus narrates ("+a/+h Ruby Power"), reads live for this fight's later Ruby plays, and carries
    // back — where settle also grows every Ruby still in hand, the shop half's other job.
    ctx.gainRubyBonus(num(params.attack) * mul(self), num(params.health) * mul(self), self.side, self.uid);
  },
  battlecryGainGoldNextTurn: (ctx, self, params) => {
    const n = num(params.amount, 1) * mul(self);
    ctx.grantBonusGold(n, self.side);
    if (self.side === 'player') ctx.log({ type: 'sc', source: self.uid, text: `${self.name}: +${n} Gold next turn` });
  },
  battlecryBonusGoldNextTurn: (ctx, self, params) => {
    const n = num(params.gold, 1) * mul(self);
    ctx.grantBonusGold(n, self.side);
    if (self.side === 'player') ctx.log({ type: 'sc', source: self.uid, text: `${self.name}: +${n} Gold next turn` });
  },
  battlecryBuffFodder: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffFodder(combatArena(ctx, self), params);
  },
  battlecryBuffMagnetics: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryBuffMagnetics(combatArena(ctx, self), params);
  },
  // CONDUCTOR: registering it HERE is the fix — `replayCombatBattlecry` runs a Shout live only when it finds a
  // combat factory, and treats everything else as economy to defer to settle. Conductor's grant is a board buff
  // (very much combat-meaningful), so being absent meant every in-combat re-fire did nothing (owner 2026-08-26).
  battlecryConductorAdjacent: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryConductorAdjacent(combatArena(ctx, self), params);
  },
  battlecryGrantBeastHunt: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryGrantBeastHunt(combatArena(ctx, self), params);
  },
  battlecryGrantBeastRitual: (ctx, self, params) => {
    ARENA_EFFECTS.battlecryGrantBeastRitual(combatArena(ctx, self), params);
  },
  getRubies: (ctx, self, params) => {
    ctx.mintRubies(num(params.count, 1) * mul(self), self.side, self.uid);
  },
  addFodderNextShops: (ctx, self, params) => {
    // Soulfeeder — `count` Fodder into each of the next `shops` shops, through Pit Supplier's schedule
    // channel (settle merges index-for-index into the run's fodderSchedule).
    const count = num(params.count, 1) * mul(self);
    const shops = num(params.shops, 2);
    if (count > 0 && shops > 0) ctx.scheduleFodder(Array.from({ length: shops }, () => count), self.side);
  },
  // ── PHASE-SPLIT BY RULING (Discover in combat = a random pool card, 2026-08-04): the interactive 1-of-3
  //    panel never opens mid-combat, so these combat halves grant randomly; the shop halves stay interactive.
  battlecryDiscoverSpell: (ctx, self) => {
    ctx.grantRandomSpell(mul(self), self.side, self.uid);
  },
  battlecryDiscoverMinion: (ctx, self, params) => {
    ctx.grantRandomMinion(mul(self), str(params.tribe) || undefined, self.side, self.cardId, self.uid);
  },
  // LIVE now (it used to defer + hand-announce): the named spell grants through the real combat channel.
  battlecryGrantSpell: (ctx, self, params) => {
    const id = str(params.spellId);
    if (!id) return;
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) ctx.grantToHand(id, self.side, self.uid);
  },

  // ARENA-MIGRATED (Echo family): one body; the shop half is ARENA-BORN by ruling (a borrowed Blaster
  // damages YOUR board).
  deathrattleDamageAll: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleDamageAll(combatArena(ctx, self), params);
  },

  /** Deathrattle (Jenkins & Fi): destroy the minion that dealt the killing blow (`killer` on the onDeath
   *  payload). Bypasses Divine Shield — it's a destroy, not a hit. No-op if the killer died too / is absent. */
  deathrattleDestroyKiller: (ctx, self, _params, payload) => {
    const p = payload as MinionPayload & { killer?: Minion };
    if (p.minion !== self) return;
    const killer = p.killer;
    if (killer && !killer.dead && killer.health > 0) ctx.damage(killer, killer.health + 999, false, true);
  },

  /**
   * Capability marker (Gnasher). The re-attack is control flow, resolved by the
   * simulator via the derived `Minion.reAttackOnKill` flag; this handler is a
   * no-op so the card can still declare the effect as data.
   */
  reAttackOnKill: () => {
    /* handled in simulate() */
  },

  // --- Start of Combat (Dragons). Player SC resolves first, left→right (A.3). ---

  /** Deal `amount` to the leftmost / a random / every living enemy. */
  // ARENA-MIGRATED (SC family): one body in arena.ts; enemy-facing, so the shop half no-ops by membership.
  scDamage: (ctx, self, params) => {
    ARENA_EFFECTS.scDamage(combatArena(ctx, self), params);
  },

  /** Bloodbinder: Start of Combat — arm Bleed. Marks `targets` enemies now (golden marks DOUBLE — 1 → 2); every
   *  `every` attacks made this combat (either side), deals this minion's Attack to those same marked enemies. */
  // ARENA-MIGRATED (SC family): one body; the `armBleed` verb is a documented shop no-op (nothing to bleed).
  scArmBleed: (ctx, self, params) => {
    ARENA_EFFECTS.scArmBleed(combatArena(ctx, self), params);
  },

  /** Deal damage equal to self's Attack, as 1-damage hits split across random enemies. */
  scSplitDamage: (ctx, self, params) => {
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    if (ctx.living(foe).length === 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} splits its breath`, cast: true });
    let n = self.attack;
    while (n-- > 0) {
      const targets = ctx.living(foe);
      if (targets.length === 0) break;
      ctx.damage(ctx.rng.pick(targets), 1);
    }
  },

  /** Deal `base` to every enemy, then `perTribe` more to a random enemy per other friendly `tribe`. */
  scAoePerTribe: (ctx, self, params) => {
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    if (ctx.living(foe).length === 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} rains fire`, cast: true });
    const base = num(params.base, 3) * mul(self);
    const per = num(params.perTribe, 3) * mul(self);
    const tribe = str(params.tribe) as Tribe;
    for (const t of ctx.living(foe)) ctx.damage(t, base);
    const others = ctx.living(self.side).filter((m) => m !== self && (m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe)).length;
    for (let i = 0; i < others; i++) {
      const targets = ctx.living(foe);
      if (targets.length === 0) break;
      ctx.damage(ctx.rng.pick(targets), per);
    }
  },

  /** Taurus — Start of Combat: grant Engraved (EG) to BOTH adjacent minions on self's own side, so they
   *  keep whatever stats they gain this fight. A GOLDEN Taurus additionally doubles those neighbors' combat
   *  stat-gains (`gainMult = 2`). Granting EG to the *combat* Minion (not its run board CardDef) is
   *  clone-safe: the keyword lasts only this fight, and `ctx.buff` then accrues that minion's gains into
   *  `permaGain` → carried back by `playerPermaBuffs`. Taurus itself is not engraved. No-op for an absent
   *  neighbor (Taurus leftmost/rightmost). */
  // ARENA-MIGRATED (SC family): one body; the whole engrave ritual lives on the adapter's
  // `engraveNeighbours` verb (Engrave has no shop meaning — every shop gain is already permanent).
  scEngraveNeighbor: (ctx, self, params) => {
    ARENA_EFFECTS.scEngraveNeighbor(combatArena(ctx, self), params);
  },

  /** TRANSCENDENCE (owner add 2026-08-14) — Start of Combat: Engrave the adjacent `tribe` minions (Dragons), then
   *  give ALL of your `tribe` +atk/+hp. Transcendant's Engrave half is NOT here any more (owner respec
   *  2026-08-17): it is a live adjacency aura evaluated inside `ctx.buff`, so this buff is engraved for its
   *  neighbours purely by virtue of Transcendant being alive when it lands. Golden doubles the grant. */
  scBuffTribe: (ctx, self, params) => {
    if (self.dead) return;
    const tribe = (str(params.tribe) || 'dragon') as Tribe;
    const isTribe = (m: Minion | undefined): m is Minion =>
      !!m && !m.dead && m.health > 0 && (m.tribe === tribe || m.tribe2 === tribe || !!ctx.getCard(m.cardId)?.universalTribe);
    const a = num(params.attack, 3) * mul(self);
    const h = num(params.health, 3) * mul(self);
    if (a <= 0 && h <= 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} engraves the flight (+${a}/+${h})` });
    const skipSelf = !!params.excludeSelf; // Transcendant buffs your OTHER Dragons
    for (const m of ctx.living(self.side)) if (isTribe(m) && !(skipSelf && m.uid === self.uid)) ctx.buff(m, a, h, self.uid);
  },

  /** Start of Combat (Taurus the Truth Bringer): Engrave EVERY friendly minion (self included) — each keeps its
   *  combat stat-gains (carried back via `playerPermaBuffs`). "Triggers first": it runs in a priority SoC pass
   *  before the others, so later Start-of-Combat buffs are engraved too. */
  // ARENA-MIGRATED (SC family): one body; same shop no-op rationale as scEngraveNeighbor.
  scEngraveAll: (ctx, self, params) => {
    ARENA_EFFECTS.scEngraveAll(combatArena(ctx, self), params);
  },

  // --- Undead (combat-time Deathrattle / on-death value) ---

  /** Deathrattle: buff a random living friend (both stats). */
  deathrattleBuffRandom: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    ctx.buff(ctx.rng.pick(friends), num(params.attack) * mul(self), num(params.health) * mul(self), self.uid);
  },

  /** Deathrattle (Sporeling): coin-flip Attack vs Health, then buff EVERY living friend by +amount of it. */
  deathrattleBuffAllRandomStat: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    const amt = num(params.amount, 1) * mul(self);
    const useAtk = ctx.rng.pick([true, false]);
    for (const f of friends) ctx.buff(f, useAtk ? amt : 0, useAtk ? 0 : amt, self.uid);
  },

  /**
   * SET 2 DWARVES — "get a Dwarven Ale" from a COMBAT trigger (Slaughter / Rally / Echo).
   *
   * One factory for all three, guarded by which payload shape the event hands it, because the difference between
   * them is *when* they fire, not what they do. The Ale rides `ctx.grantToHand`, the same carry-back channel
   * `rallyGrantSpell` and `deathrattleGrantSpell` already use, so it lands in hand after combat settles.
   *
   * `guard` names the check: `attacker` (Slaughter/on-kill), `rally` (this minion swung), or `self` (its own
   * death). Without the guard these fire on every ally's kill or swing, which is the classic bug in this family.
   */
  // ARENA-MIGRATED (Step 3): one body in arena.ts; the attacker/rally guards stay with dispatch.
  combatGrantAle: (ctx, self, params, payload) => {
    const guard = str(params.guard) || 'self';
    const p = payload as { attacker?: Minion; minion?: Minion } | undefined;
    if (guard === 'attacker' && p?.attacker !== self) return;
    if ((guard === 'rally' || guard === 'self') && p?.minion !== self) return;
    if (self.dead && guard !== 'self') return;
    ARENA_EFFECTS.combatGrantAle(combatArena(ctx, self), params);
  },


  /** Lieutenant Thane — Rally: hand THIS minion's current Attack to `count` other living friendlies. Reads its
   *  Attack live, so a buffed Thane spreads more; golden repeats the whole spread. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyGiveAttackToOthers: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyGiveAttackToOthers(combatArena(ctx, self), params);
  },

  /**
   * Exgalloper — Echo: summon an exact copy of itself WITHOUT the Echo, so it can't chain forever.
   *
   * "Exact" means its current buffed stats, not the printed card: the copy inherits what this minion had grown
   * to. Stripping `onDeath` is what makes it terminate — a copy that kept its own Echo would summon another on
   * death, and so on until the board cap.
   */
  // ARENA-MIGRATED (Step 3): one body; the copy inherits buffed stats + keywords in BOTH phases (ruling).
  echoSummonCopyNoEcho: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.echoSummonCopyNoEcho(combatArena(ctx, self), params);
  },


  /** Geode Guardian (owner rework 2026-07-31) — Echo: summon `count` Gemheart Golems with Taunt and play
   *  `rubies` Rubies on each. The COUNT is deliberately NOT golden-doubled (a Gilded copy still summons 2 —
   *  owner's explicit call); the Rubies are, via `playRubyOn`'s per-cast stacking. */
  // ── ARENA-MIGRATED (Step 3, Ruby family): one body in arena.ts serves both phases.
  deathrattleSummonGolemsWithRuby: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleSummonGolemsWithRuby(combatArena(ctx, self), params);
  },

  /**
   * Anvilshade Smith — Echo: summon a token that INHERITS this minion's Attack and swings at once.
   *
   * The token's printed Attack is a floor, not the value: it takes the Smith's Attack if that's higher, so
   * buffing the Smith buffs what its death produces. `ctx.attackNow` is the same out-of-turn-order queue the
   * Whelp uses.
   */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases. The combat adapter folds the
  // inherited Attack into the summon override so the event carries the real number from the first frame.
  echoSummonInheritAttackAndCharge: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.echoSummonInheritAttackAndCharge(combatArena(ctx, self), params);
  },

  /** Deathrattle (Arcane Weaver): add a copy of a spell to your hand after combat. Golden grants two. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGrantSpell: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleGrantSpell(combatArena(ctx, self), params);
  },

  /** Deathrattle (Sporeling): give ALL living friends +atk/+hp (golden doubles). On a true death the dying
   *  body is already excluded from living(); when Battlecry-proc'd while alive (below) it buffs itself too. */
  // ── ARENA-MIGRATED (Step 2): one body in arena.ts serves both phases.
  deathrattleBuffAll: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleBuffAll(combatArena(ctx, self), params);
  },

  /** Sporeling — every Battlecry fired on this side (Ryme's combat replay emits `battlecryTriggered`) procs
   *  this minion's OWN Deathrattle effects while it lives, and counts toward the Deathrattle tally (Grim).
   *  Single proc per Battlecry fire (no Sylus multiplication — he amplifies deaths, not echoes). */
  battlecryTriggeredOwnDeathrattle: (ctx, self, _params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || self.health <= 0 || side !== self.side) return;
    ctx.countDeathrattle?.(self.side);
    ctx.log({ type: 'sc', source: self.uid, text: `${self.name}'s Deathrattle triggers` });
    for (const eff of self.effects) {
      if (eff.on !== 'onDeath' || !eff.do.startsWith('deathrattle')) continue;
      FACTORIES[eff.do]?.(ctx, self, eff.params ?? {}, { minion: self, side: self.side });
    }
  },

  /** Deathrattle (Mumi): grant a random living friend of `tribe` (default any) **Rise** — it comes back
   *  once at base Attack / 1 Health when it dies. Skips minions that currently HAVE Rise (printed or
   *  granted); a body whose Rise was already spent is a legal target again (owner ruling 2026-07-03:
   *  spent effects re-arm — the same rule as a resummoned body's Deathrattle). Golden grants it to two friends.
   *  Logs a `keyword` event so the target's card gains the Rise pill in the replay the moment it's granted
   *  (the Rise itself then replays through the normal `reborn` event when it procs). */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGrantReborn: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleGrantReborn(combatArena(ctx, self), params);
  },

  /** Avenge (X) — Arcane Weaver: after every `count` friendly deaths, add a copy of a spell to your hand
   *  after combat (golden grants two per proc). Routed through grantToHand so the replay shows the card
   *  flying to your hand as it triggers. */
  avengeGrantSpell: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 2));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(str(params.cardId), self.side, self.uid);
  },

  /** Set 2 — Mushy (Echo): queue `count` copies of the FIRST spell you cast next turn (golden 2).
   *  Payload-guarded like every Deathrattle. The copy itself is granted in the RECRUIT phase (a spell id isn't
   *  known until you cast it), so this only banks the count — carried back via `playerNextTurnSpellCopies`. */
  deathrattleQueueNextSpellCopy: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.queueNextTurnSpellCopy(num(params.count, 1) * mul(self), self.side);
  },

  /**
   * QUIL — Start of Combat: cast the left-most spell in your hand on adjacent Beasts. The spell is NOT
   * consumed (owner ruling 2026-08-07), so Quil re-casts it every fight and you steer it by ordering the hand.
   *
   * It resolves through `castInCombat`, so the cast is genuine: it counts, it fires the in-combat spell
   * watchers, and a Runebloom Matriarch multiplies it like any other combat cast.
   *
   * WHICH SPELLS RESOLVE. Only spell effects with a combat implementation do anything here; a spell whose
   * whole job is tavern work (Displacement, gilding a shop minion) fizzles silently, by the owner's ruling.
   * The stat family is covered below. Everything else — Discovers, refreshes, shop buffs, card grants — is
   * NOT yet combat-capable and is the next slice; see `combatCastableSpell` for the honest list.
   */
  // ARENA-MIGRATED (SC family): one body; the whole cast ritual lives on the adapter's
  // `castLeftmostHandSpellOnAdjacent` verb (combat: the legacy castInCombat + combat resolver, verbatim;
  // shop: the resolver's stat family through `noteSpellCast` — pure tavern work fizzles uncounted there too).
  scCastLeftmostHandSpell: (ctx, self, params) => {
    ARENA_EFFECTS.scCastLeftmostHandSpell(combatArena(ctx, self), params);
  },

  /**
   * MAGE-PUP (combat half, owner report 2026-08-07) — a Shout re-trigger (Dawnclaw, Ryme, Funeral on Loan)
   * fires the Pup's taught spell mid-fight. Targeted spells pick a seeded-random living friendly, exactly as
   * the recruit path does when a repeater (not the player) fires the Shout. Routed through `castInCombat`,
   * so it is a genuine cast and a Runebloom Matriarch multiplies it.
   */
  battlecryCastTaughtSpell: (ctx, self) => {
    const def = self.taughtSpellId ? ctx.getCard(self.taughtSpellId) : undefined;
    if (!def?.spell || self.dead || !combatCastable(def)) return;
    castInCombat(ctx, self, () => {
      const friends = ctx.living(self.side);
      if (friends.length === 0) return;
      const targets = def.target ? [ctx.rng.pick(friends)] : undefined;
      if (resolveCombatSpellCast(ctx, self, def, targets)) {
        ctx.log({ type: 'sc', source: self.uid, text: `${self.name} casts ${def.name}` });
      }
    });
  },

  /**
   * SPOREBAT (owner rework 2026-08-07) — Echo: cast the run's LAST-cast Shop spell on a random friendly
   * Beast. The stored spell is run-level (`lastSpellCastFor`, snapshot-captured so a served Sporebat casts
   * its owner's). An untargeted spell simply casts (owner ruling); no spell stored is a clean no-op.
   */
  /**
   * ASHEN HEIR (Demon, T6 5/9) — "Whenever an Imp dies, your next Imp gains its stats. If that Imp dies, it
   * passes all accumulated stats onward."
   *
   * One rule produces the whole snowball: bank a dying friendly Imp's CURRENT stats, and hand the bank to the
   * next Imp that arrives. An inheriting Imp's stats already include everything it inherited, so when it dies
   * the bank simply refills with the larger number — the "passes all accumulated stats onward" clause needs no
   * separate accounting. The bank lives on the Heir (`impBank`), so two Heirs each keep one and both pay out.
   */
  impInheritOnDeath: (ctx, self, _params, payload) => {
    const dead = (payload as MinionPayload).minion;
    if (!dead || dead === self || dead.side !== self.side || self.dead) return;
    if (!ctx.getCard(dead.cardId)?.imp) return;
    // Its CURRENT stats — a 1/1 Imp that grew to 6/6 hands on 6/6. `maxHealth` rather than live Health so a
    // chipped Imp still passes on what it was, not what the last hit left it at.
    const attack = Math.max(0, dead.attack);
    const health = Math.max(0, dead.maxHealth);
    if (attack <= 0 && health <= 0) return;
    // PAY A LIVING IMP FIRST (owner ruling 2026-08-07). The stats go to another Imp that is already on the
    // board, and only bank for a future arrival when there is no Imp left to receive them. The first version
    // banked unconditionally and paid solely on the next SUMMON, which meant the ordinary case — several Imps
    // alive, one dies — did visibly nothing at all, and the card read as broken.
    const heir = ctx.living(self.side).find((m) => m !== dead && m !== self && !!ctx.getCard(m.cardId)?.imp);
    if (heir) { ctx.buff(heir, attack, health, self.name); return; }
    const bank = (self.impBank ??= { attack: 0, health: 0 });
    bank.attack += attack;
    bank.health += health;
  },

  /** ASHEN HEIR, the fallback half — when an Imp died with no Imp left to take its stats, the bank waits here
   *  and the next Imp to ARRIVE inherits it, emptying it. Deaths that happened while a living Imp was available
   *  never reach the bank at all (see `impInheritOnDeath`), so this only fires for a wiped-out Imp board. */
  /** REFLECTOR (combat half, owner ruling 2026-08-26): a Ruby played ON THIS mid-fight (Bloodbinder family)
   *  also lands on a random friendly. "(Once per turn)" reads as once per combat here — flagged on the
   *  instance, which a fresh fight resets by construction. */
  onRubyPlayedSpreadRandom: (ctx, self, params, payload) => {
    const p = payload as { rubyAttack?: number; rubyHealth?: number };
    const flagged = self as Minion & { reflectorSpread?: boolean };
    if (flagged.reflectorSpread) return;
    const a = num(p.rubyAttack, 0);
    const h = num(p.rubyHealth, 0);
    if (a <= 0 && h <= 0) return;
    const others = ctx.living(self.side).filter((m) => m !== self);
    if (others.length === 0) return;
    for (let r = 0; r < num(params.count, 1) * mul(self); r++) {
      const t = others[ctx.rng.int(others.length)]!;
      ctx.buff(t, a, h, self.name);
    }
    flagged.reflectorSpread = true;
  },

  impInheritOnSummon: (ctx, self, _params, payload) => {
    const born = (payload as MinionPayload).minion;
    if (!born || born === self || born.side !== self.side || self.dead) return;
    if (!ctx.getCard(born.cardId)?.imp) return;
    const bank = self.impBank;
    if (!bank || (bank.attack <= 0 && bank.health <= 0)) return;
    self.impBank = { attack: 0, health: 0 };
    ctx.buff(born, bank.attack, bank.health, self.name);
  },

  /**
   * RUNESNOUT ARCHIVIST (Beast, T6 6/9) — "Remember the first Shop spell you cast each turn. Echo: cast every
   * remembered spell on random friendly Beasts."
   *
   * The journal is run-level (`rememberedSpellsFor`, snapshot-captured so a served Archivist replays its own),
   * and this is `deathrattleCastLastSpell` widened from one spell to the whole list: each remembered spell is
   * cast in the order it was learned, each picking its own random friendly Beast.
   */
  echoCastRememberedSpells: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const ids = ctx.rememberedSpellsFor?.(self.side) ?? [];
    if (ids.length === 0) return;
    const beastPool = (): Minion[] => ctx.living(self.side).filter((m) =>
      m.tribe === 'beast' || m.tribe2 === 'beast' || ctx.getCard(m.cardId)?.universalTribe);
    for (const id of ids) {
      const def = ctx.getCard(id);
      if (!def?.spell || !combatCastable(def)) continue;
      // Same fizzle gate as Sporebat: an aimed spell with no living Beast left isn't a cast at all, so the
      // watchers must not see one. Checked per spell, since earlier casts in this loop can kill the pool.
      if (def.target && beastPool().length === 0) continue;
      castInCombat(ctx, self, () => {
        const beasts = beastPool();
        const targets = def.target ? (beasts.length > 0 ? [ctx.rng.pick(beasts)] : []) : undefined;
        if (def.target && (!targets || targets.length === 0)) return;
        if (resolveCombatSpellCast(ctx, self, def, targets)) {
          ctx.log({ type: 'sc', source: self.uid, text: `${self.name} casts ${def.name}` });
        }
      });
    }
  },

  /**
   * MOSSMEMORY COLOSSUS (Beast, T6 5/10) — "Echo: resummon the first 3 other Beasts that died this combat."
   * Earliest-first off the sim's death-ordered Beast graveyard; the printed bodies come back (the Rise
   * precedent), never the grown corpses. Golden brings back six.
   */
  echoResummonDeadBeasts: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const count = (typeof params.count === 'number' ? params.count : 3) * (self.golden ? 2 : 1);
    ctx.resummonDeadBeasts?.(self.side, count, self.uid);
  },

  deathrattleCastLastSpell: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const id = ctx.lastSpellCastFor?.(self.side);
    const def = id ? ctx.getCard(id) : undefined;
    if (!def?.spell || !combatCastable(def)) return;
    // An aimed spell with no living Beast to aim at fizzles BEFORE the cast counts — same reason as the
    // castability gate: a cast that resolves onto nothing is not a cast the watchers should see.
    const beastPool = (): Minion[] => ctx.living(self.side).filter((m) =>
      m.tribe === 'beast' || m.tribe2 === 'beast' || ctx.getCard(m.cardId)?.universalTribe);
    if (def.target && beastPool().length === 0) return;
    castInCombat(ctx, self, () => {
      const beasts = beastPool();
      const targets = def.target ? (beasts.length > 0 ? [ctx.rng.pick(beasts)] : []) : undefined;
      if (def.target && (!targets || targets.length === 0)) return; // the last Beast died mid-repetition
      if (resolveCombatSpellCast(ctx, self, def, targets)) {
        ctx.log({ type: 'sc', source: self.uid, text: `${self.name} casts ${def.name}` });
      }
    });
  },

  /**
   * BADGINGTON (owner rework 2026-08-07) — Rally: cast a RANDOM targeted spell on another friendly Beast,
   * then get a copy of that spell. The pool is the targeted spells the combat resolver can actually execute
   * (`COMBAT_TARGETED_SPELL_DOS`) drawn from the run's pinned set — never a spell that would fizzle. It can't
   * target itself (owner ruling). Golden = two casts (castInCombat), each granting its copy.
   */
  rallyCastRandomTargetedSpell: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const beasts = ctx.living(self.side).filter((m) => m !== self &&
      (m.tribe === 'beast' || m.tribe2 === 'beast' || ctx.getCard(m.cardId)?.universalTribe));
    if (beasts.length === 0) return;
    const pool = ctx.poolCards(self.side).filter((c) =>
      c.spell && !c.token && !!c.target && c.effects.some((e) => e.on === 'cast' && COMBAT_TARGETED_SPELL_DOS.has(e.do)));
    if (pool.length === 0) return;
    castInCombat(ctx, self, () => {
      const spell = ctx.rng.pick(pool);
      const target = ctx.rng.pick(beasts);
      if (resolveCombatSpellCast(ctx, self, spell, [target])) {
        ctx.log({ type: 'sc', source: self.uid, text: `${self.name} casts ${spell.name}` });
        ctx.grantToHand(spell.id, self.side, self.uid); // …and a copy of THAT spell
      }
    });
  },

  /**
   * SCAVVERS (owner rework 2026-08-07) — Echo: trigger an adjacent Rally. Picks a seeded-random adjacent
   * minion that HAS a Rally and fires it through the shared free-rally primitive, so the tally and quest
   * halves ride along. Golden triggers twice (both neighbours when both qualify — the second pick excludes
   * the first, so a gilded Scavvers between two Rally bodies fires each once).
   */
  deathrattleTriggerAdjacentRally: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    // DEPTH CAP (same shape as the Orbit cap): Echohorn's Rally fires the leftmost ECHO, which can be this
    // very Scavvers — whose Echo fires a RALLY, which can be that very Echohorn. Without a cap the pair
    // recurse forever (found by the bot fleet, as a stack overflow). Two rounds keeps the toy; try/finally
    // keeps the counter clean across sims.
    if (scavversChainDepth >= SCAVVERS_CHAIN_MAX) return;
    scavversChainDepth++;
    try {
    const board = ctx.living(self.side);
    const i = board.indexOf(self);
    const hasRally = (m: Minion | undefined): m is Minion =>
      !!m && !m.dead && m.keywords.includes('RL') && m.effects.some((e) => e.on === 'onAttack');
    let pool = [board[i - 1], board[i + 1]].filter(hasRally);
    for (let n = 0; n < mul(self) && pool.length > 0; n++) {
      const pick = pool.length === 1 ? pool[0]! : ctx.rng.pick(pool);
      ctx.triggerRally?.(pick);
      pool = pool.filter((m) => m !== pick);
    }
    } finally { scavversChainDepth--; }
  },

  /**
   * MENAGERIE MAMMOTH (owner rework 2026-08-07) — Avenge (N): cast a RANDOM spell from your hand, through
   * the combat resolver. Kept, not consumed, like Quil's cast; a targeted spell picks a random friendly; a
   * hand with no combat-castable spell is a clean no-op (the pick pool is pre-filtered, so it never counts
   * a fizzling cast). Golden casts twice per proc (castInCombat).
   */
  avengeCastRandomHandSpell: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const every = Math.max(1, num(params.count, 3));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % every !== 0) return;
    const pool = (ctx.handSpellsFor?.(self.side) ?? [])
      .map((id) => ctx.getCard(id))
      .filter((d): d is CardDef => !!d?.spell && combatCastable(d));
    if (pool.length === 0) return;
    castInCombat(ctx, self, () => {
      const def = ctx.rng.pick(pool);
      const friends = ctx.living(self.side);
      const targets = def.target ? (friends.length > 0 ? [ctx.rng.pick(friends)] : []) : undefined;
      if (def.target && (!targets || targets.length === 0)) return;
      if (resolveCombatSpellCast(ctx, self, def, targets)) {
        ctx.log({ type: 'sc', source: self.uid, text: `${self.name} casts ${def.name}` });
      }
    });
  },

  /** Set 2 — Vault Curator: Avenge (X) copies the LEFT-MOST spell in your hand into your hand again (golden 2).
   *  Reads the hand snapshot taken at combat start (`ctx.leftmostHandSpellFor`), so it copies what you actually
   *  held going in; an empty or spell-less hand is a clean no-op — no random grant. */
  avengeCopyLeftmostHandSpell: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const every = Math.max(1, num(params.count, 4));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % every !== 0) return;
    const id = ctx.leftmostHandSpellFor(self.side);
    if (!id) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(id, self.side, self.uid);
    // RUNE OF THE FLOODED VAULT: the same proc ALSO CASTS that left-most spell, without consuming it — combat
    // never touches the hand, so "unconsumed" is the natural behaviour; the rune's work is the free cast.
    // Sporebat's conventions: castability gate, and a targeted spell picks a seeded-random living friendly.
    if (ctx.floodedVaultFor?.(self.side)) {
      const def = ctx.getCard(id);
      if (def?.spell && combatCastable(def)) {
        // Pulse the rune's badge. Emitted through `ctx.log` rather than through a new context hook: a
        // `questTrigger` IS a `CombatEvent`, so this needs no widening of the effect context — and it lands
        // on the same channel every other rune trigger uses, so the badge treats it identically.
        ctx.log({ type: 'questTrigger', flag: 'runeFloodedVault', side: self.side });
        castInCombat(ctx, self, () => {
          const pool = ctx.living(self.side);
          const targets = def.target ? (pool.length > 0 ? [ctx.rng.pick(pool)] : []) : undefined;
          if (def.target && (!targets || targets.length === 0)) return;
          if (resolveCombatSpellCast(ctx, self, def, targets)) {
            ctx.log({ type: 'sc', source: self.uid, text: `${self.name} casts ${def.name}` });
          }
        });
      }
    }
  },

  /** Set 2 — Ashen Broodlord: Avenge (X) improves your SPELLS by +atk/+hp (spell power), carried back to the
   *  run. Routes through `grantSpellPower` with `self.uid`, so it emits the `+A/+H Spell Power` narration the
   *  combat replay already rides — the flourish and the hand-spell cue both fire on the proc rather than at
   *  settle. Player-side only, enforced inside `grantSpellPower`. */
  avengeBuffSpellPower: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const every = Math.max(1, num(params.count, 4));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % every !== 0) return;
    ctx.grantSpellPower(num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.side, self.uid);
  },

  /** Avenge (X) — Professor Greg: after every `count` friendly deaths, get a random tavern-tier spell (golden
   *  grants two). Like Arcane Weaver's grant but the spell is RANDOM (via ctx.grantRandomSpell, resolved at
   *  settle where the tavern tier is known) rather than a fixed id. */
  avengeGrantRandomSpell: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    ctx.grantRandomSpell(mul(self), self.side, self.uid); // 1 random spell per proc (golden 2)
  },

  /** Avenge (X) — Steadfast Champion: after every `count` friendly deaths, summon a `cardId` minion
   *  (Spear Warden) that ATTACKS IMMEDIATELY, out of turn order (the Whelp attack-on-summon queue —
   *  it strikes once the current attack's death cascade settles). GOLDEN summons a GOLDEN copy (count
   *  stays 1) rather than two. The summon registers the card's real effects, so a summoned Spear
   *  Warden's own Echo keeps feeding the run-wide Spear Warden enchant ("the aura") as usual. */
  avengeSummonAttack: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    const card = ctx.getCard(str(params.cardId));
    if (!card) return;
    ctx.summon(self.side, card, self.uid, undefined, self.golden, true);
  },

  /** Dunkey (owner add 2026-08-12) — Avenge (X): summon a `cardId` minion (golden summons a GILDED one). Like
   *  `avengeSummonAttack`, but the summon does NOT strike immediately — it just joins the board. */
  avengeSummon: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 4));
    const seen = avengeCountFor(self, count);
    if (seen <= 0 || seen % x !== 0) return;
    const card = ctx.getCard(str(params.cardId));
    if (!card) return;
    ctx.summon(self.side, card, self.uid, undefined, self.golden, false);
  },

  /** GROBBUS (owner add 2026-08-14) — Avenge (X): every X friendly deaths, get a random `tribe` minion (golden
   *  gets two). Routes through `ctx.grantRandomMinion`, which picks from the run's BUYABLE pool (≤ tavern tier,
   *  active tribes) at settle and animates a real `toHand` — the same channel Sea Urchin's re-fired Discover
   *  uses, so it respects the hand cap and the pinned set. Player-only by that helper's own guard. */
  avengeGrantRandomTribeMinion: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3)); // the Avenge threshold
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    ctx.grantRandomMinion(num(params.grant, 1) * mul(self), str(params.tribe) || 'demon', self.side, undefined, self.uid);
  },

  /** Endless Overseer (owner rework 2026-08-12) — Avenge (X): every X friendly deaths, summon `summon` Imp(s)
   *  with Taunt and Ward (the shared `impscrap` token; keywords stamped at summon). Golden summons 2. */
  avengeSummonImps: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 4)); // the Avenge threshold
    const seen = avengeCountFor(self, count);
    if (seen <= 0 || seen % x !== 0) return;
    const imp = ctx.getCard('impscrap');
    if (!imp) return;
    for (let i = 0; i < num(params.summon, 1) * mul(self); i++) {
      ctx.summon(self.side, imp, self.uid, ['T', 'DS'], false, false);
    }
  },

  /** Right Hand Hank (owner add 2026-08-12) — Echo: give the right-most Shop minion +atk/+hp PERMANENTLY.
   *  A combat death feeds the recruit-phase shop-slot accumulator (`RunState.rightmostSlotBuff`, the same total
   *  Market Tormentor grows) through the `grantRightmostSlotBuff` carry-back — player-side only, since the enemy
   *  has no shop. Golden doubles. */
  deathrattleBuffRightmostSlot: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.grantRightmostSlotBuff?.(num(params.attack, 6) * mul(self), num(params.health, 3) * mul(self), self.side);
  },

  /** Deathrattle (Skullblade): permanently raise the run-wide spell power by +atk/+hp (golden doubles).
   *  Carried back via `CombatResult.playerSpellPower` (player-side only — `grantSpellPower` guards it),
   *  then applied to the run's spell bonus in settleCombat. Each Skullblade death stacks another +atk/+hp. */
  deathrattleBuffSpellPower: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.grantSpellPower(num(params.attack, 1) * mul(self), num(params.health) * mul(self), self.side, self.uid);
  },

  /** Deathrattle (Eternal Knight): permanently buff a card type run-wide by +atk/+hp (golden doubles).
   *  Carried back via `CombatResult.playerCardBuffs` (player-side only), then applied run-wide in
   *  settleCombat (board / hand / future copies). Each death stacks; `cardId` defaults to self's.
   *  Also immediately buffs any surviving copies of that card on the board right now so the aura is
   *  real-time: 2× Eternal Knights alive → one dies → the survivor gains +3/+2 immediately. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleBuffCardTypeRunWide: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleBuffCardTypeRunWide(combatArena(ctx, self), params);
  },

  /** Deathrattle (Burial Imp): queue `count` Fodder (golden doubles) into your next tavern. Player-side
   *  carry-back via `CombatResult.playerFodderGrants` → pushed onto pendingTavern in settleCombat. */
  deathrattleAddFodder: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.grantTavernFodder(num(params.count, 1) * mul(self), self.side);
  },

  /** Deathrattle (Burial Imp): permanently buff your Fodder +atk/+hp (golden ×2) — the living Fodder now + the
   *  run-wide Fodder buff (carried back), like Sword and Bored's on-kill but fired on death. */
  deathrattleBuffFodder: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const a = num(params.attack, 1) * mul(self);
    const h = num(params.health, 1) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (ctx.getCard(m.cardId)?.keywords.includes('FD')) ctx.buff(m, a, h, self.uid);
    }
    ctx.grantFodderBuff(a, h, self.side);
  },

  /** Deathrattle (Chef Raag): give every living friendly minion +A/+H equal to your live Imp Aura this fight
   *  (golden doubles). Fires on death. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases (the +1/+1 floor lives there).
  deathrattleBuffAllByImpAura: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleBuffAllByImpAura(combatArena(ctx, self), params);
  },

  /** Rally (The Godfodder): on each of its own attacks, permanently buff your Fodder +atk/+hp (golden ×2) —
   *  the living Fodder now + the run-wide Fodder buff (carried back). */
  rallyBuffFodder: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const a = num(params.attack, 2) * mul(self);
    const h = num(params.health, 2) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (ctx.getCard(m.cardId)?.keywords.includes('FD')) ctx.buff(m, a, h, self.uid);
    }
    ctx.grantFodderBuff(a, h, self.side);
  },

  /** Bloodbinder — Rally (on its own attack): give your Fodder half this minion's Attack, as Attack on odd turns
   *  and Health on even turns (`bloodbinderMode`, alternated each turn on the run board). Buffs living Fodder now
   *  + the run-wide Fodder buff (carried back). Floors the half; no-op below 2 Attack. */
  rallyBuffFodderHalf: (ctx, self, _params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const half = Math.floor(self.attack / 2);
    if (half <= 0) return;
    const hp = self.bloodbinderMode === 'hp';
    const a = hp ? 0 : half;
    const h = hp ? half : 0;
    for (const m of ctx.living(self.side)) {
      if (ctx.getCard(m.cardId)?.keywords.includes('FD')) ctx.buff(m, a, h, self.uid);
    }
    ctx.grantFodderBuff(a, h, self.side);
  },

  /** Pit Supplier — Avenge (N): every N friendly deaths this combat, add `fodder` Fodder to each of your next
   *  `shops` shops (golden doubles the per-shop count). `shops:1` (default) uses the single-shop carry-back;
   *  `shops>1` schedules Fodder across that many upcoming shops. */
  avengeAddFodder: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    const perShop = num(params.fodder, 1) * mul(self);
    const shops = Math.max(1, num(params.shops, 1));
    if (shops > 1) ctx.scheduleFodder(Array(shops).fill(perShop), self.side);
    else ctx.grantTavernFodder(perShop, self.side);
  },

  /** Spell Appraiser — Avenge (N): every N friendly deaths this combat, permanently raise run-wide spell power
   *  by +atk/+hp (so stat spells give that much more — "your Tavern spells have +Attack this run"). Golden
   *  doubles. Carried back via `CombatResult.playerSpellPower`, like the other spell-power sources. */
  avengeGrantSpellPower: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 4));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    ctx.grantSpellPower(num(params.attack, 1) * mul(self), num(params.health, 0) * mul(self), self.side, self.uid);
  },

  /** Deathrattle (Junkyard Titan): add a random Magnetic minion to your hand after combat. Sibling of
   *  Arcane Weaver's grant, but the card is chosen at random (via ctx.rng) from the Magnetic-keyword
   *  minion pool (tokens/spells excluded) rather than a fixed id. Each pick is independent, so a golden's
   *  two grants can differ. Emits the same `toHand` event so the replay flies it to the hand; golden → 2.
   *  (Today the pool is Cling Drone / Money Bot / Heckbinder.) */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGrantMagnetic: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleGrantMagnetic(combatArena(ctx, self), params);
  },

  /** Rally — when *this* minion attacks, buff friendly minions (+atk/+hp). With no extra params it buffs
   *  every other living friend; `tribe` restricts to that tribe (dual-types count) and `count` caps how many
   *  are hit (a random pick when there are more eligible) — Supporter: 2 friendly Dragons. */
  /** Set 2 — Packstrider (Rally): on its own attack, buff ITSELF by `attack`/`health` for every friendly
   *  `tribe` minion you control (including itself). Golden doubles the per-Beast rate. Scales with the board,
   *  so it rewards going wide. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyBuffSelfPerTribe: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyBuffSelfPerTribe(combatArena(ctx, self), params);
  },

  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyBuff: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyBuff(combatArena(ctx, self), params);
  },

  /** Rally (Chimerus): when THIS minion attacks, give up to 2 friendly Dragons +Health equal to its own Health.
   *  A random pick when more than 2 Dragons are eligible. Golden runs the whole hand-out TWICE (re-picks each
   *  round, so with ≥4 Dragons it can spread to more of them; with exactly 2 they get it twice). */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyGiveHealthToDragons: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyGiveHealthToDragons(combatArena(ctx, self), params);
  },

  /** Rally (Perfect Core): when THIS minion attacks, add a random spell to your hand after combat (golden → 2). */
  /** Set 2 — Chorus Drake (Rally): raise the run's SHOP-SPELL power. Spell power is the channel that makes
   *  every future Shop spell bigger, and it carries back out of combat on its own — so "your Shop Spells gain
   *  +1 Health" needs no new plumbing, just the existing grant. Rubies don't read spell power, which is why
   *  the card says Shop Spells. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyGrantSpellPower: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyGrantSpellPower(combatArena(ctx, self), params);
  },

  /** Set 2 — Embermouth Whelp: every Shout you trigger grows THIS body (× golden). Permanent-by-nature — it's
   *  a recruit-phase buff on the card itself, so it simply persists like any other stat gain. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  onBattlecryBuffSelf: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side: Side }).side !== self.side) return;
    ARENA_EFFECTS.onBattlecryBuffSelf(combatArena(ctx, self), params);
  },

  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyGrantSpell: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyGrantSpell(combatArena(ctx, self), params);
  },

  /** Grave Body (Start of Combat / on-summon): copy your LEFTMOST living friendly Echo — graft its Deathrattle
   *  (onDeath) effects onto this minion, so they fire when it dies. Skips self; no-op if no friend has an Echo. */
  // ARENA-MIGRATED (SC family): one body in arena.ts; the dead guard stays with dispatch. A SHOP graft
  // rides `grantedEffects` and is permanent (the family's shop-permanence rule).
  copyLeftmostEcho: (ctx, self, params) => {
    if (self.dead || self.health <= 0) return;
    ARENA_EFFECTS.copyLeftmostEcho(combatArena(ctx, self), params);
  },

  /** Rally (Chorus Engine): when THIS minion attacks, buff your living Magnetic ("Attachment") minions +atk/+hp
   *  (welded attachments have merged away, so this hits unwelded ones on the board). Golden doubles. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyBuffAttachments: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyBuffAttachments(combatArena(ctx, self), params);
  },

  /** Slaughter (Chorus Engine): when THIS minion kills, add a random Magnetic ("Attachment") minion to your hand
   *  after combat (golden → 2). Attacker-guarded (fires on the kill even if it then dies). */
  onKillGrantMagnetic: (ctx, self, _params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    const pool = ctx.poolCards(self.side).filter((c) => c.keywords.includes('M') && !c.token && !c.spell);
    if (pool.length === 0) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(ctx.rng.pick(pool).id, self.side, self.uid);
  },

  /** Start of Combat (Run Maw): Consume your weakest OTHER friendly minion (destroy it — no Deathrattle, no
   *  Avenge, like a sacrifice), then every friendly Demon gains 25% of its Attack + Health (floored). Golden
   *  buffs at 50%. */
  scConsumeWeakestBuffDemons: (ctx, self, params) => {
    const friends = ctx.living(self.side).filter((m) => m !== self);
    if (friends.length === 0) return;
    const weakest = friends.reduce((a, b) => (b.attack + b.health < a.attack + a.health ? b : a));
    const pct = num(params.pct, 25) * mul(self);
    const ga = Math.floor((weakest.attack * pct) / 100);
    const gh = Math.floor((weakest.health * pct) / 100);
    weakest.dead = true; // consumed — destroyed without firing its Deathrattle / Avenge
    weakest.health = 0;
    ctx.log({ type: 'death', target: weakest.uid, side: self.side });
    for (const m of ctx.living(self.side)) {
      if (m.tribe === 'demon' || m.tribe2 === 'demon' || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, ga, gh, self.uid);
    }
  },

  /** Speed Demon — Start of Combat: give every OTHER friendly minion `pct`% of THIS minion's OWN stats
   *  (golden doubles the %, so 50% → 100%). Rounded down; a pure aura, nothing is consumed. */
  // ARENA-MIGRATED (SC family): one body in arena.ts serves both phases.
  scBuffAlliesPctSelf: (ctx, self, params) => {
    ARENA_EFFECTS.scBuffAlliesPctSelf(combatArena(ctx, self), params);
  },

  /** Set 2 — Start of Combat: "Play N Rubies on your [tribe] minions." Each eligible living friend gets `count`
   *  Ruby buffs; a Ruby = base 1/1 + this side's `rubyBonus`. PERMANENT via `permaGain` so the gift carries back
   *  to the run board (owner: Ruby buffs are always permanent, in shop or combat). `count` = Rubies per minion
   *  (× golden); optional `tribe` filters recipients (e.g. `'kobold'`; omit = all your minions). */
  scPlayRubies: (ctx, self, params) => {
    playRubies(ctx, self, num(params.count, 1) * mul(self), str(params.tribe));
  },

  /** Set 2 — Avenge (X): after every `count` friendly deaths in combat, play `rubies` Rubies on your [tribe]
   *  minions (Gemstorm Instigator, Gemline Martyr). `count` = the Avenge threshold; `rubies` = Rubies per minion
   *  (× golden). Permanent carry-back via `playRubies`. */
  avengePlayRubies: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 2));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    playRubies(ctx, self, num(params.rubies, 1) * mul(self), str(params.tribe));
  },

  /** Set 2 — Rally (Tunnelcharger Rikk): when THIS minion attacks, get `count` Rubies (× golden). Minted into
   *  hand after combat with the run's live rubyBonus. Fires on its own attack (Flurry → per hit). */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyGetRubies: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyGetRubies(combatArena(ctx, self), params);
  },

  /** Set 2 — Crownvein Vanguard (half 1): Rally — when THIS attacks, buff your Rubies +atk/+hp (× golden),
   *  carried back to `rubyBonus`. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyRubyStatGain: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyRubyStatGain(combatArena(ctx, self), params);
  },

  /** Set 2 — Crownvein Vanguard (half 2): Rally — when THIS attacks, play `rubies` Rubies each on the first
   *  `targets` living friends of `tribe` (permanent carry-back). Golden drops the tribe filter (any friend) and
   *  doubles the target count. */
  rallyPlayRubiesTargets: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return;
    const tribe = self.golden ? '' : str(params.tribe);
    const targets = num(params.targets, 2) * mul(self);
    const per = num(params.rubies, 1);
    const pool = ctx.living(self.side).filter((m) => !tribe || m.tribe === tribe || m.tribe2 === tribe);
    for (let i = 0; i < targets && i < pool.length; i++) playRubyOn(ctx, self, pool[i]!, per);
  },

  /** Set 2 — Mineral Master (owner 2026-07-28): when YOU trigger a Rally — any friendly Rally, not just its own
   *  swing — play `rubies` Rubies on your `tribe` minions.
   *
   *  `on: 'onAttack'` is broadcast to every friendly minion's effects, so the gate is the ATTACKER's RL keyword:
   *  without it this would pay out on every ally swing, which is an ally-attack watcher (Crypt Drake), not a
   *  Rally watcher. Same distinction the sim draws when it computes `rallyExtra`. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onRallyPlayRubiesTribe: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion.side !== self.side) return; // any ally's attack
    ARENA_EFFECTS.onRallyPlayRubiesTribe(combatArena(ctx, self), { ...params, attacker: minion });
  },

  /** Paragon (owner 2026-07-28) — the all-type minion. Whenever you trigger a Rally, give **a minion of every
   *  type** +atk/+hp, permanently.
   *
   *  The owner's two worked examples pin the shape exactly:
   *    • 2 Dragons + 1 Beast + Paragon → one Dragon, the Beast, and Paragon.
   *    • 3 Dragons + Paragon          → one Dragon and Paragon.
   *  So it is NOT "one per active tribe in the run" (that would pay Paragon repeatedly for the tribes nothing
   *  else represents) and NOT "everyone". It is: one random member of each tribe actually REPRESENTED on your
   *  board by a real tribe member, plus every all-type body — which is Paragon itself, since an all-type minion
   *  IS a minion of every type. `universalTribe` cards are excluded from the per-tribe pick so they can't
   *  crowd out the real member, then added unconditionally.
   *
   *  Permanent via `permaGain`, the Flowing Monk channel, so the gifts ride `playerPermaBuffs` home. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onRallyBuffOnePerTribe: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion.side !== self.side) return; // any ally's attack
    ARENA_EFFECTS.onRallyBuffOnePerTribe(combatArena(ctx, self), { ...params, attacker: minion });
  },

  /** Set 2 — Avenge (X) (Veinbreaker): after every `count` friendly deaths, buff your Rubies +atk/+hp (× golden)
   *  — raises the run's Ruby strength (carried back at settle, grows held + future Rubies). */
  avengeRubyStatGain: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    ctx.gainRubyBonus(num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.side, self.uid);
  },

  /** Set 2 — Gemline Martyr (half 1): Avenge (X) — get `rubies` Rubies (carried back to hand). */
  avengeGetRubies: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 2));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    ctx.grantRubies(num(params.rubies, 1) * mul(self), self.side, self.uid);
  },

  /** Set 2 — Gemline Martyr (half 2): Avenge (X) — play `rubies` Rubies on your LEFT-MOST living minion
   *  (permanent carry-back). */
  avengePlayRubiesLeftmost: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 2));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    const target = ctx.living(self.side)[0]; // left-most living friend
    if (target) playRubyOn(ctx, self, target, num(params.rubies, 1) * mul(self));
  },

  /** Set 2 — Gemheart Carver (Echo): on death, summon `tokenId` with stats equal to the Rubies on THIS minion
   *  (its `Ruby` buff; golden doubles those stats). No Rubies on it → no summon. */
  // ── ARENA-MIGRATED (Step 3, Ruby family): one body in arena.ts serves both phases.
  deathrattleSummonRubyStats: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleSummonRubyStats(combatArena(ctx, self), params);
  },

  /** Set 2 — Deepdelve Paragon. A MARKER, not a trigger: it is never dispatched.
   *
   *  The card does exactly one thing (owner spec 2026-07-25): Rubies APPLIED DURING COMBAT are worth double
   *  (triple Gilded). It does not touch Rubies already on the board, and it has no Start-of-Combat step — an
   *  earlier version topped up existing Ruby buffs, which was wrong on both counts.
   *
   *  The work happens in `playRubyOn`, which multiplies as each Ruby lands; `rubyMultiplierFor` finds the
   *  Paragon by scanning for this effect id. Declaring it here keeps the card data-driven — the alternative
   *  was hardcoding a card id inside core. */
  rubyStatMultiplier: () => {},

  /** Set 2 — Alchemist Brisbane (Echo half): on death, buff your Rubies +atk/+hp (× golden), carried back. */
  // ── ARENA-MIGRATED (Step 3, Ruby family): one body in arena.ts serves both phases.
  deathrattleRubyStatGain: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleRubyStatGain(combatArena(ctx, self), params);
  },

  /** Set 2 — Resonance Idol, the COMBAT half: a Ruby played on this bounces the same stats to BOTH adjacent
   *  minions (golden: twice each). Mirrors the recruit factory of the same name, so the card reads the same in
   *  the shop and mid-fight — it previously existed only in recruit, which is why a combat Ruby (Geode Guardian's
   *  Echo, Frenzied Excavator, Candle Conduit) never bounced (owner report 2026-07-25).
   *
   *  Bounces via `applyRubyStats`, NOT `playRubyOn`, so the bounced Ruby does not itself count as "a Ruby played
   *  on" the neighbour — two adjacent Idols would otherwise bounce forever. Same reasoning as the recruit half. */
  // ARENA-MIGRATED (Step 3, Ruby family). This unification FIXED drift: the 2026-07-27 random-N rework had
  // only ever landed in the shop half, so combat still bounced to neighbours while the shop went random.
  rubyPlayedBounce: (ctx, self, params, payload) => {
    const { rubyAttack, rubyHealth } = payload as { rubyAttack?: number; rubyHealth?: number };
    ARENA_EFFECTS.rubyPlayedBounce(combatArena(ctx, self), { ...params, rubyAttack, rubyHealth });
  },

  /** Set 2 — Geode Guardian (Echo): on death, play `rubies` Rubies on EACH adjacent minion (permanent carry-back). */
  deathrattlePlayRubiesAdjacent: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const per = num(params.rubies, 1) * mul(self);
    for (const adj of livingNeighbours(ctx, self)) playRubyOn(ctx, self, adj, per);
  },

  /** Set 2 — Kobebes (Echo): on death, play `count` Rubies on EACH friendly minion of `tribe`. Guarded
   *  against the board-wide onDeath broadcast (fires only on this body's death); golden doubles the count. */
  deathrattlePlayRubiesTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    playRubies(ctx, self, num(params.count, 3) * mul(self), str(params.tribe));
  },

  /** Set 2 — Frenzied Excavator: Start of Combat, play `rubies` Rubies on your [tribe] minions for every
   *  `every` cards bought this turn (× golden). Reads the run's per-turn buy count threaded into combat. */
  scPlayRubiesPerBuy: (ctx, self, params) => {
    const every = Math.max(1, num(params.every, 4));
    const steps = Math.floor(ctx.cardsBoughtThisTurnFor(self.side) / every);
    playRubies(ctx, self, steps * num(params.rubies, 1) * mul(self), str(params.tribe));
  },

  /** Herald of the Apocalypse — Rally: each time THIS minion attacks, add a copy of itself to your hand after
   *  combat (golden 2 per attack). Player-only (grantToHand no-ops for a served enemy); fires per hit (Flurry ×2). */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyGrantSelfCopy: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyGrantSelfCopy(combatArena(ctx, self), params);
  },

  /** Mechanical Jouster — Rally: when THIS minion attacks, add a random Magnetic Mech to your hand after
   *  combat (golden 2 per attack). Mirrors Junkyard Titan's grant pool, filtered to Mech magnetics; fires on
   *  this minion's own attack (Windfury → per hit). */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyGrantMagnetic: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyGrantMagnetic(combatArena(ctx, self), params);
  },

  /** Rally — Badgington: when THIS minion attacks, get a random tavern-tier spell (golden 2 per attack).
   *  Fires on its own attack (Flurry → per hit); the spell is picked at settle via ctx.grantRandomSpell. */
  rallyGrantRandomSpell: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    ctx.grantRandomSpell(num(params.count, 1) * mul(self), self.side, self.uid);
  },

  /** Raptor — when ANOTHER friendly minion of `tribe` attacks, buff it (+atk/+hp) before its hit lands
   *  (onAttack is broadcast pre-damage). Excludes self — a support body, not a self-ramp. Golden doubles. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onFriendlyAttackBuffTribe: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion === self || minion.side !== self.side) return;
    ARENA_EFFECTS.onFriendlyAttackBuffTribe(combatArena(ctx, self), { ...params, attacker: minion });
  },

  /** Crypt Drake — every `every` ally attacks this combat (itself included), buff every living friend
   *  +step/+step, and every `improveEvery` attacks the grant improves by +step/+step PERMANENTLY for this
   *  copy (the accrual rides `summonBonus` — seeded from the run board, carried back at settle, live-text
   *  via the 'improve' event). Per-combat attack counter on `self.attackSeen`. Golden doubles both. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onAllyAttackBuffAll: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion.side !== self.side) return; // any ally's attack (self included)
    ARENA_EFFECTS.onAllyAttackBuffAll(combatArena(ctx, self), { ...params, attacker: minion });
  },

  /** Taragosa — when any ally attacks, "cast Growth": buff every living friend +atk/+hp (golden casts it
   *  twice). Explosive on a wide board. Growth is a REAL spell, so each cast inherits the run's spell power
   *  (`ctx.spellPower`, passed in from the run loop) on top of the base — exactly like a shop-cast Growth. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onAllyAttackCastGrowth: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion.side !== self.side) return; // any ally's attack
    ARENA_EFFECTS.onAllyAttackCastGrowth(combatArena(ctx, self), { ...params, attacker: minion });
  },

  /** Runebloom Matriarch / Runekeg (combat half — owner audit 2026-08-02): a spell cast MID-FIGHT
   *  (Fatecarver's Growth, Taragosa, Ashen Broodlord's Staff) buffs `count` random living `tribe` members,
   *  exactly like the shop half. This half was missing entirely, so combat casts silently skipped her.
   *  `excludeSelf` (Runekeg): "other Dwarves". Rune of the Matriarch doubles via `matriarchRepsFor`,
   *  mirroring the recruit engine's wrapper. Golden doubles the magnitude. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  onSpellCastBuffRandomTribe: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    ARENA_EFFECTS.onSpellCastBuffRandomTribe(combatArena(ctx, self), params);
  },

  /** Fatecarver, branch A (combat half — owner audit 2026-08-02): each spell cast mid-fight buffs one living
   *  minion of each type, deterministically in board order — the same walk as the recruit half, so seating
   *  steers who benefits in combat too. Gated on the Choose One pick like the Growth branch. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts. The Choose One gate stays with dispatch.
  onSpellCastBuffOnePerTribe: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    if (num(params.option, -1) >= 0 && self.chosenOption !== num(params.option, -1)) return;
    ARENA_EFFECTS.onSpellCastBuffOnePerTribe(combatArena(ctx, self), params);
  },

  /** Archmagus Guel (combat half) — when a friendly spell is cast mid-fight (Taragosa's Growth), give
   *  `count` other random friendly minions +atk/+hp, scaling +1/+1 per 4 spells cast so far (the running
   *  per-side tally rides in the `spellCast` payload; the triggering cast is already counted, matching the
   *  recruit half). Golden doubles. The grant is a normal combat buff (temporary) — the PERMANENT
   *  improvement comes from the cast being carried back to the run's `spellsCast` (see `ctx.castSpell`). */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases (Guel).
  spellCastBuffOthers: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    ARENA_EFFECTS.spellCastBuffOthers(combatArena(ctx, self), params);
  },


  /** Spirit Pup (combat half) — a spell cast in combat counts toward its transform, exactly like the shop
   *  (owner ruling 2026-07-12: "spells cast in combat count"). Ticks THIS instance's on-board `spellProgress`
   *  and emits the live `spellProgress` event so the "N to go" countdown updates on the card. The actual form
   *  swap happens at settle (the reducer transforms the run card once the carried-back tally reaches `at`) —
   *  no mid-combat identity change, matching that the recruit half only swaps in the shop. */
  spellCastTransform: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    void params;
    self.spellProgress = (self.spellProgress ?? 0) + 1;
    ctx.log({ type: 'spellProgress', target: self.uid, amount: self.spellProgress });
  },

  /** Runescale Drake (combat half) — a spell cast in combat counts toward its on-board tally exactly like the
   *  shop (owner ruling: "spells cast in combat count"). Ticks THIS instance's `spellProgress` and emits the
   *  live event so the countdown climbs; the permanent carry-back to the run card happens at settle. The
   *  Dragon buff itself fires once at Start of Combat (frozen at the seeded tally), so this only grows future
   *  combats' grant. Identical body to `spellCastTransform`, named for its own card so intent stays clear. */
  /** Set 2 — Groveweaver / Thunderous Sovereign, COMBAT half (owner ask 2026-07-31): a spell cast IN combat
   *  (Taragosa's Growth — or a Ruby, under Rune of the Spellstone) advances the Improve PERMANENTLY. The
   *  accrual rides `summonBonus`, which `playerSummonBonus` already carries back to the run card, so the
   *  printed value climbs for good — exactly like a recruit-phase cast. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  onSpellCastImproveSummon: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    ARENA_EFFECTS.onSpellCastImproveSummon(combatArena(ctx, self), params);
  },

  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  spellCastImproveSelf: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    ARENA_EFFECTS.spellCastImproveSelf(combatArena(ctx, self), params);
  },


  /** Hunter — when THIS minion's Attack rises (onGainAttack), give every living friend +`health` Health.
   *  Health-only, so it never re-triggers onGainAttack (no loop). Golden doubles. */
  onGainAttackBuffAll: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only when self gains Attack
    const h = num(params.health, 2) * mul(self);
    for (const m of ctx.living(self.side)) ctx.buff(m, 0, h, self.uid);
  },

  /** Hunter — when THIS gains Attack, give your minions +M/+M (M = base + its accrued `summonBonus`, ×golden),
   *  then improve the accrual by `base` for good (carried across combats via the per-uid summonBonus carry-back,
   *  like Kennelmaster). A scaling board-wide aura. Live grant via cardText's hunterText. */
  // ARENA-MIGRATED (Step 3): one body; the SHOP formula won the divergence (owner ruling 2026-08-04) —
  // combat's stepped x(1 + floor(fires/every)) is retired. The re-entrancy guard stays here.
  onGainAttackBuffImproving: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only when self gains Attack
    if (huntGuard.has(self)) return;
    huntGuard.add(self);
    try {
      ARENA_EFFECTS.onGainAttackBuffImproving(combatArena(ctx, self), params);
    } finally {
      huntGuard.delete(self);
    }
  },


  /** Deathsayer's Rally — when *this* attacks, fire your leftmost living minion's Deathrattle *first*
   *  (before the hit lands; `onAttack` is emitted before damage). Logs a `rally` event (source =
   *  Deathsayer, target = that minion) so the UI pauses + shows whose Deathrattle goes off, then runs
   *  that minion's onDeath effects once — it stays alive (only true `deathrattle*` effects count, not
   *  friend-death watchers like Brood Matron). Any buffs/summons it produces resolve before the attack. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyProcDeathrattle: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyProcDeathrattle(combatArena(ctx, self), params);
  },

  /** Rot Weaver: each time another friend dies, buff a random living friend. */
  onFriendDeathBuffRandom: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion === self || minion.side !== self.side) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    ctx.buff(ctx.rng.pick(friends), num(params.attack) * mul(self), num(params.health) * mul(self), self.uid);
  },

  /** Flowing Monk: when a summon on this minion's side can't fit the full board (a `summonOverflow`),
   *  Engrave `count` random living friends +atk/+hp (golden doubles) — PERMANENT via `permaGain`, so the
   *  gifts carry back to the run board. The magnitude improves by another +atk/+hp for every `improveEvery`
   *  overflows this Monk has seen (its running tally rides in `summonBonus`, the generic per-instance
   *  accrual carried across combats — the recruit half shares it). */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases (Flowing Monk).
  overflowBuffRandom: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side?: Side }).side !== self.side) return;
    ARENA_EFFECTS.overflowBuffRandom(combatArena(ctx, self), params);
  },


  /** Avenge (X): after every `count` friendly deaths in combat, buff self (+atk/+hp). */
  avengeBuff: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    ctx.buff(self, num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.uid);
  },

  /** Avenge (X) — Kennelmaster: after every `count` friendly deaths, permanently improve this
   *  minion's summon buff by +1/+1 (its `summonBonus`, carried back to the run board afterwards).
   *  Affects every Beast it summons for the rest of the fight, and every future fight. Logs an
   *  `improve` event so the UI can pulse it. */
  avengeImproveSummon: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    const avengeInc = ctx.improveRepsFor(self.side); // Rune of Mastery: the Improve applies twice
    self.summonBonus += avengeInc;
    ctx.log({ type: 'improve', target: self.uid, amount: avengeInc });
  },

  /** Avenge (Soulsman): every X friendly deaths, permanently raise your max Gold by 1 (golden +2).
   *  Player-side carry-back via `CombatResult.playerMaxGoldGain` → applied to maxEmbers in settleCombat.
   *  Logs a `maxGold` event (player only — enemies have no economy, so it'd be a phantom proc) so the UI
   *  can pulse Soulsman + float the gain when it triggers. */
  avengeMaxGold: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 4));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    const gain = mul(self);
    ctx.grantMaxGold(gain, self.side);
    if (self.side === 'player') ctx.log({ type: 'maxGold', target: self.uid, side: self.side, amount: gain });
  },

  /** Avenge (Bone Taxer): every `count` friendly deaths, grant `amount` one-time Gold into your next shop
   *  (golden doubles). Player-side carry-back via `CombatResult.playerBonusGold`. */
  avengeBonusGold: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 4));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    ctx.grantBonusGold(num(params.amount, 2) * mul(self), self.side);
  },

  /** Deathrattle (Bone Taxer): permanently raise your max Gold by `amount` (golden doubles). Player-side
   *  carry-back via `CombatResult.playerMaxGoldGain` → applied to maxEmbers in settleCombat. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts. The own-death guard (Bone Taxer once paid on EVERY
  // friendly death) stays in the wrapper, where dispatch concerns live.
  deathrattleMaxGold: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleMaxGold(combatArena(ctx, self), params);
  },

  /** Avenge (X) — Stuntdrake: after every `count` friendly deaths, hand `targets` other living friends a
   *  copy of THIS minion's current Attack (+atk only). A golden's bigger Attack flows through automatically;
   *  the threshold + target count are unchanged. Recipients are a random pick when more than `targets` live. */
  avengeGiveAttack: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    const amount = self.attack;
    if (amount <= 0) return;
    const targets = num(params.targets, 2);
    // Golden procs twice — each proc independently picks `targets` random friends (can overlap).
    for (let t = 0; t < mul(self); t++) {
      const pickable = ctx.living(self.side).filter((m) => m !== self);
      for (let i = 0; i < targets && pickable.length > 0; i++) {
        const m = ctx.rng.pick(pickable);
        pickable.splice(pickable.indexOf(m), 1);
        ctx.buff(m, amount, 0, self.uid);
      }
    }
  },

  /** Deathrattle (Ghastweaver): fill the board with random cards from `pool`. */
  deathrattleFillTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const pool = Array.isArray(params.pool) ? (params.pool as string[]) : [];
    if (pool.length === 0) return;
    let guard = 0;
    while (ctx.living(self.side).length < 7 && guard++ < 7) {
      ctx.summon(self.side, ctx.getCard(ctx.rng.pick(pool)), self.uid);
    }
  },

  /**
   * Runebloom Matriarch — Start of Combat: your Shop Spells cast `extra` additional times for the rest of the
   * fight. Golden doubles the extra. Every combat cast routes through `castInCombat`, so this reaches all of
   * them at once (Growth, Lantern, the Rally/Slaughter casters, the random stat spells) rather than a list
   * someone has to remember to extend.
   *
   * Start of Combat, not an aura, so the grant is LOCKED IN: killing the Matriarch mid-fight does not retract
   * casts already promised, which is the same contract every other Start-of-Combat mode installs. It also
   * keeps the count a plain number rather than a per-cast board scan.
   */
  // ARENA-MIGRATED (SC family): one body (incl. the Rune of the Matriarch +1, via `matriarchReps`); the
  // grant is a combat-cast channel, so the shop verb no-ops rather than double-arming the fight to come.
  scGrantSpellCastExtra: (ctx, self, params) => {
    ARENA_EFFECTS.scGrantSpellCastExtra(combatArena(ctx, self), params);
  },

  // --- Mechs (Divine Shield walls + shield-break payoffs) ---

  /** Start of Combat: give every friendly minion of `tribe` a Divine Shield (a reusable shield-wall
   *  primitive — currently unused after Omega Bulwark's removal, kept for a future Mech wall card). */
  scGrantShieldTribe: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'mech') as Tribe;
    const friends = ctx.living(self.side).filter((m) => m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe);
    if (friends.length === 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} raises the shieldwall` });
    for (const m of friends) grantShield(ctx, m);
  },

  /** Twilight Sentinel (Celestial) — Start of Combat: THIS minion gains a keyword. The align-gated halves
   *  live in the card data, so a Dawn seat takes Flurry, a Dusk seat Ward, and an Eclipsed one takes both.
   *  Arms the live flags the way every other in-combat keyword grant does, and logs so the pill appears. */
  // ARENA-MIGRATED (SC family): one body; `grantKeywordTo` arms the live flags + logs the pill, as before.
  scGainKeyword: (ctx, self, params) => {
    ARENA_EFFECTS.scGainKeyword(combatArena(ctx, self), params);
  },

  /** Gravewarden — Start of Combat: give a friendly (optionally `tribe`) minion, other than self, Rise. Golden
   *  grants it to two. Mirrors the Deathrattle grant but fires at combat start; skips minions that already
   *  have — or have already spent — Rise. */
  // ARENA-MIGRATED (SC family): one body in arena.ts serves both phases.
  scGrantReborn: (ctx, self, params) => {
    ARENA_EFFECTS.scGrantReborn(combatArena(ctx, self), params);
  },

  /** Selfless Sentinel — Deathrattle: give a random other friend a Divine Shield (golden: TWO friends). */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGrantShield: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleGrantShield(combatArena(ctx, self), params);
  },

  /** Shield Capacitor — when a friendly Shield breaks, give another friend a Shield. */
  onShieldBreakGrantShield: (ctx, self, _params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side) return;
    const pool = ctx.living(self.side).filter((m) => m !== self && m !== minion && !m.divineShield);
    if (pool.length === 0) return;
    grantShield(ctx, ctx.rng.pick(pool));
  },

  /** Arclight Reactor — when a friendly Mech's Shield breaks, deal `amount` to a random enemy. */
  onShieldBreakDamage: (ctx, self, params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side || (minion.tribe !== 'mech' && minion.tribe2 !== 'mech' && !ctx.getCard(minion.cardId)?.universalTribe)) return;
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    const targets = ctx.living(foe);
    if (targets.length === 0) return;
    ctx.damage(ctx.rng.pick(targets), num(params.amount, 3) * mul(self));
  },

  /** Junkyard Titan — when any friendly Shield breaks, give your minions +atk/+hp. */
  onShieldBreakBuffAll: (ctx, self, params, payload) => {
    const { side } = payload as MinionPayload;
    if (self.dead || side !== self.side) return;
    const attack = num(params.attack, 1) * mul(self);
    const health = num(params.health, 1) * mul(self);
    for (const m of ctx.living(self.side)) ctx.buff(m, attack, health, self.uid);
  },

  // --- Demons (combat-resolved: Brood Matron breeds, the Sovereign destroys) ---

  /** Brood Matron — each time another friend dies, summon one Imp beside self, capped at `max` per combat
   *  (golden doubles the cap). The `bredCount` tracks how many it has bred this fight. */
  onFriendDeathSummon: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion === self || minion.side !== self.side) return;
    const cap = num(params.max, 3); // golden does NOT raise the cap — it doubles the Avenge buff instead
    if ((self.bredCount ?? 0) >= cap) return;
    ctx.summon(self.side, ctx.getCard(str(params.tokenId)), self.uid);
    self.bredCount = (self.bredCount ?? 0) + 1;
  },

  /** Abyssal Sovereign — Start of Combat: destroy the enemy with the highest Attack. */
  scDestroyHighestAttack: (ctx, self, params) => {
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    const targets = ctx.living(foe);
    if (targets.length === 0) return;
    const victim = targets.reduce((a, b) => (b.attack > a.attack ? b : a));
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} drags down the mightiest`, cast: true });
    ctx.damage(victim, victim.health, false, true); // destroy: ignores Divine Shield
  },

  /** Arena Heckler — Start of Combat: give the enemy's RIGHTMOST minion Taunt (golden: the two rightmost), so
   *  your side must chew through it first. No-op vs an empty enemy board; skips a minion that already Taunts. */
  // ARENA-MIGRATED (SC family): one body (the OPPOSITE-index pick, owner change 2026-07-21, lives there);
  // enemy-facing, so the shop half no-ops by membership before it can taunt a friendly.
  scGrantEnemyTaunt: (ctx, self, params) => {
    ARENA_EFFECTS.scGrantEnemyTaunt(combatArena(ctx, self), params);
  },

  /** Mirrorhide Rhino — Start of Combat: summon a copy of THIS minion's current body (stats + granted
   *  keywords). Golden summons two. Combat-summoned copies don't re-fire Start of Combat, so it never chains. */
  /** Celestial — Daybreak Acolyte: Start of Combat, THIS minion gains stats. Written as two align-gated
   *  halves on the card (Dawn +attack / Dusk +health); an Eclipsed body runs both. × golden. */
  // ARENA-MIGRATED (SC family): one body in arena.ts serves both phases.
  scBuffSelf: (ctx, self, params) => {
    ARENA_EFFECTS.scBuffSelf(combatArena(ctx, self), params);
  },

  /** Celestial — Equinox Duelist (Dawn Rally): buff every friendly CELESTIAL (flagged card, not a tribe).
   *  Includes self — the Duelist is a Celestial too. × golden. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyBuffCelestials: (ctx, self, params) => {
    ARENA_EFFECTS.rallyBuffCelestials(combatArena(ctx, self), params);
  },

  /** Celestial — Equinox Duelist (Dusk Echo): the Echo twin of `rallyBuffCelestials` — the dying Duelist
   *  buffs the OTHER Celestials it leaves behind. × golden. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleBuffCelestials: (ctx, self, params) => {
    ARENA_EFFECTS.deathrattleBuffCelestials(combatArena(ctx, self), params);
  },

  // ARENA-MIGRATED (SC family): one body in arena.ts (the current-body copy incl. live flags rides the
  // summonToken snapshot; a shop copy expresses Ward/Rise through its copied keywords instead).
  scSummonCopy: (ctx, self, params) => {
    ARENA_EFFECTS.scSummonCopy(combatArena(ctx, self), params);
  },

  /** Runescale Drake — Start of Combat: give your `tribe` +atk/+hp, improved by `perSpell` for each spell you
   *  cast this turn (frozen at combat start via `ctx.spellsThisTurn`). Golden doubles the whole grant. A one-time
   *  buff to the living tribe (not a persisting aura). */
  scTribeBuffPerSpell: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'dragon') as Tribe;
    const per = num(params.perSpell, 1);
    const spells = ctx.spellsThisTurnFor(self.side); // per-side: enemy Runescale uses the OPPONENT's spells this turn
    const a = (num(params.attack, 2) + per * spells) * mul(self);
    const h = (num(params.health, 2) + per * spells) * mul(self);
    if (a <= 0 && h <= 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} channels the runes` });
    for (const m of ctx.living(self.side)) {
      if (m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
    }
  },

  /** Runescale Drake — Start of Combat: give your `tribe` (Dragons) +M/+M where M = base + the spells cast
   *  while THIS instance has been on the board (`self.spellProgress`, seeded from the run card; non-retroactive,
   *  NOT this-turn-only). Golden doubles the grant. A one-time buff to the living tribe, not a persisting aura. */
  scTribeBuffPerProgress: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'dragon') as Tribe;
    const prog = self.spellProgress ?? 0;
    const a = (num(params.attack, 1) + prog) * mul(self);
    const h = (num(params.health, 1) + prog) * mul(self);
    if (a <= 0 && h <= 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} channels the runes` });
    for (const m of ctx.living(self.side)) {
      if (m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
    }
  },

  /** Runescale Drake (reworked 2026-07-21) — Start of Combat: give your `tribe` (Dragons) a PER-SPELL rate for
   *  every spell cast THIS TURN (`ctx.spellsThisTurnFor`, per-side). The per-spell rate is `attack`/`health`
   *  base, improved by `step` for every `every` spells cast while THIS instance has been on the board
   *  (`self.spellProgress`, ticked by `spellCastImproveSelf`). Grant = rate × spells-this-turn. Golden doubles
   *  the whole grant. No spells this turn → no grant (the multiplier is 0). */
  // ARENA-MIGRATED (SC family): one body in arena.ts serves both phases (spellsThisTurn is per-side there).
  scTribeBuffPerSpellImproving: (ctx, self, params) => {
    ARENA_EFFECTS.scTribeBuffPerSpellImproving(combatArena(ctx, self), params);
  },

  /** Pack Leader — Start of Combat: buff your `tribe` (Beasts) +atk/+hp, improved by `perPlayed` for each of
   *  that tribe you PLAYED this recruit turn (`ctx.beastsPlayedThisTurn`, threaded from the run). Golden
   *  doubles the whole grant. Sibling of scTribeBuffPerSpell, keyed on the play counter instead of spells. */
  scTribeBuffPerPlayed: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'beast') as Tribe;
    const per = num(params.perPlayed, 1);
    const played = ctx.beastsPlayedFor(self.side); // per-side: enemy Pack Leader uses the OPPONENT's Beasts played
    const a = (num(params.attack, 1) + per * played) * mul(self);
    const h = (num(params.health, 2) + per * played) * mul(self);
    if (a <= 0 && h <= 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} rallies the pack` });
    for (const m of ctx.living(self.side)) {
      if (m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
    }
  },

  /** Pack Leader — Start of Combat: buff your `tribe` (Beasts) by +M/+M where M = base + its permanently
   *  accrued bonus, then improve that accrual by `step` for good. The accrual rides `summonBonus` (carried
   *  back like Kennelmaster's), so the grant climbs every combat. Golden doubles the applied grant. */
  /**
   * BUCKY (owner 2026-08-07) — Start of Combat: give your `tribe` +A/+H FOR EVERY Dwarven Ale cast last shop
   * turn. Zero Ales is a clean no-op rather than a 0/0 sweep, so the log stays quiet on a turn you didn't brew.
   */
  // ARENA-MIGRATED (SC family): one body in arena.ts; the dead guard stays with dispatch.
  scTribeBuffPerAle: (ctx, self, params) => {
    if (self.dead) return;
    ARENA_EFFECTS.scTribeBuffPerAle(combatArena(ctx, self), params);
  },

  /** DRUNKEN OAF (owner add 2026-08-14) — Start of Combat: give A `tribe` minion +atk/+hp, and repeat that grant
   *  once more for every Ale cast this turn. So the reps are `1 + ales`, not `ales` — the base grant lands on a
   *  dry turn too, which is what "Give a Dwarf +2/+2. Repeat for…" prints.
   *
   *  Each rep re-rolls its target (owner ruling 2026-08-14), so a long brew sprays the line rather than spiking
   *  one body — the pick is a fresh `ctx.rng` draw per rep off the seeded combat RNG, and self is eligible.
   *  `alesLastTurnFor` is the shop phase that JUST ENDED, i.e. "this turn" from the player's chair (the same
   *  read Bucky uses; its name is historical). Golden doubles the per-rep grant, not the rep count. */
  // ARENA-MIGRATED (SC family): one body in arena.ts; the dead guard stays with dispatch.
  scBuffRandomTribePerAle: (ctx, self, params) => {
    if (self.dead) return;
    ARENA_EFFECTS.scBuffRandomTribePerAle(combatArena(ctx, self), params);
  },

  // ARENA-MIGRATED (SC family): one body; `summonBonus` is the same permanent per-instance channel in both
  // phases, so an End-of-Turn fire improves the grant exactly once, like a combat fire.
  scTribeBuffImproving: (ctx, self, params) => {
    ARENA_EFFECTS.scTribeBuffImproving(combatArena(ctx, self), params);
  },

  // ─── New content batch factories ────────────────────────────────────────────

  /** Trickster — Deathrattle: give a random friendly minion this minion's current maxHealth.
   *  Golden picks a target twice (independently). */
  // ── ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGiveHealth: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleGiveHealth(combatArena(ctx, self), params);
  },

  /** Abhorrent Horror — Start of Combat: gain +Attack/+Health equal to all Fodder consumed this turn (read from
   *  the CombatContext, per SIDE — the player's live run state or a served enemy's captured tally). Golden
   *  doubles everything. An enemy Horror now gains the ENEMY's consumed stats (0 if its board ate none). */
  // ARENA-MIGRATED (SC family): one body; `fodderConsumed` reads each phase's own tally of the same turn.
  scGainFodderStats: (ctx, self, params) => {
    ARENA_EFFECTS.scGainFodderStats(combatArena(ctx, self), params);
  },

  /** Thundering Abomination (Engraved) — when a friendly minion is summoned in combat, buff self
   *  +atk/+hp. The Engraved keyword carries the gains back to the run board after combat. */
  onSummonSelfBuff: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    ctx.buff(self, num(params.attack, 3) * mul(self), num(params.health, 3) * mul(self), self.uid);
  },

  /** Thundering Abomination — when a summon on this side OVERFLOWS (board already full), buff all
   *  living friendly minions of `tribe` by +atk/+hp. With `engrave`, the grant is PERMANENT (recorded as
   *  `permaGain` on each recipient so it carries back to the run board, like Flowing Monk's gift). */
  onSummonOverflowBuffTribe: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    const tribe = str(params.tribe) as Tribe | '';
    const a = num(params.attack, 2) * mul(self);
    const h = num(params.health, 2) * mul(self);
    const engrave = params.engrave === true;
    for (const m of ctx.living(self.side)) {
      if (tribe && m.tribe !== tribe && m.tribe2 !== tribe && !ctx.getCard(m.cardId)?.universalTribe) continue;
      ctx.buff(m, a, h, self.uid);
      // Engraved overflow: carry the gift back to the run board (ctx.buff already does this for an EG
      // recipient; record it here for everyone else, mirroring overflowBuffRandom).
      if (engrave && !m.keywords.includes('EG')) {
        m.permaGain = { attack: (m.permaGain?.attack ?? 0) + a, health: (m.permaGain?.health ?? 0) + h };
      }
    }
  },

  /** Sergeant — Deathrattle: give all living friendly minions +Health equal to `params.health` × golden,
   *  plus any `hpGrantBonus` accumulated by the Sergeant gaining Attack during this combat. */
  // ── ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleBuffAllHealth: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleBuffAllHealth(combatArena(ctx, self), params);
  },

  /** Sergeant — when THIS minion's Attack rises in combat (onGainAttack), improve the Deathrattle's
   *  HP grant by +`improve` (golden +`improve`×2). Stored in `self.hpGrantBonus`; also emits a
   *  `hpGrant` event so the UI can show the live HP grant total in the combat card text. */
  onGainAttackImproveHpGrant: (ctx, self, params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    self.hpGrantBonus = (self.hpGrantBonus ?? 0) + num(params.improve, 2) * mul(self) * ctx.improveRepsFor(self.side); // ×2 under Mastery
    ctx.log({ type: 'hpGrant', target: self.uid, amount: self.hpGrantBonus });
  },

  /** Forsaken Weaver (combat half) — when a spell is cast on this side (e.g. Taragosa's Growth), give all
   *  living friendly Undead (+ universalTribe minions) +`attack` Attack this fight AND carry the bonus back
   *  permanently (like Karthus / its own recruit half) — `grantUndeadBuyAtk` stacks it into `undeadBuyAtk`
   *  and applies it to the run-board Undead at settle, so an in-combat cast procs it permanently. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  spellCastBuffUndeadAttack: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    ARENA_EFFECTS.spellCastBuffUndeadAttack(combatArena(ctx, self), params);
  },

  /** Pillager — Deathrattle: add a specific card (e.g. Gold Pouch) to the player's hand after combat.
   *  Golden grants `count`×2 copies. Carried back via CombatResult.playerHandGrants. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleGrantCardToHand: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleGrantCardToHand(combatArena(ctx, self), params);
  },

  /** Target Dummy — each time it takes damage (once per hit, regardless of amount), gain +`attack` Attack,
   *  PERMANENTLY: the gain is recorded as `permaGain` so the wall keeps the Attack across the run (the dummy
   *  isn't Engraved, so record it directly like Flowing Monk). Golden gains double per hit. */
  onDamagedGainAttack: (ctx, self, params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    const a = num(params.attack, 1) * mul(self);
    if (a <= 0) return;
    ctx.buff(self, a, 0, self.uid);
    if (!self.keywords.includes('EG')) {
      self.permaGain = { attack: (self.permaGain?.attack ?? 0) + a, health: self.permaGain?.health ?? 0 };
    }
  },

  /** Set 2 — Faultline Scrapper: when THIS minion takes damage, give your Rubies +atk/+hp (× golden) — raises
   *  the run's Ruby strength (carried back at settle). */
  damagedGainRubyBonus: (ctx, self, params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    ctx.gainRubyBonus(num(params.attack, 1) * mul(self), num(params.health, 0) * mul(self), self.side, self.uid);
  },

  /** Set 2 — Candleback Bulwark: when THIS minion takes damage, get `count` Rubies (× golden), capped `cap`
   *  times per fight (a fresh combat Minion each fight, so `rubyRecvTick` resets between combats). */
  damagedGetRubies: (ctx, self, params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    const cap = Math.max(1, num(params.cap, 2));
    if ((self.rubyRecvTick ?? 0) >= cap) return;
    self.rubyRecvTick = (self.rubyRecvTick ?? 0) + 1;
    ctx.grantRubies(num(params.count, 1) * mul(self), self.side, self.uid);
  },

  /** Commander Impala — when this kills an enemy, give your Fodder + Imps +atk/+hp PERMANENTLY (golden ×2).
   *  Buffs the living Fodder/Imps now and raises BOTH run-wide buffs (carried back), exactly like Bane's
   *  combat half. The onKill payload carries the killer as `attacker`. */
  onKillBuffFodderImps: (ctx, self, params, payload) => {
    const { attacker } = payload as { attacker?: Minion };
    // No `self.dead` bail: a Slaughter fires even when the killer dies in the same clash (owner ruling
    // 2026-07-17) — the buff still lands on the LIVING friends it empowers.
    if (self !== attacker) return;
    const a = num(params.attack, 2) * mul(self);
    const h = num(params.health, 2) * mul(self);
    for (const m of ctx.living(self.side)) {
      const def = ctx.getCard(m.cardId);
      if (def?.keywords.includes('FD') || def?.imp) ctx.buff(m, a, h, self.uid);
    }
    ctx.grantImpBuff(a, h, self.side);
    ctx.grantFodderBuff(a, h, self.side);
  },

  /** Slaughter — Badgington: when this kills an enemy minion, get a random tavern-tier spell (golden 2 per
   *  kill). The onKill payload carries the killer as `attacker`, so only the minion that scored the kill fires;
   *  the spell is picked at settle via ctx.grantRandomSpell. Fires on the kill even if this minion then dies. */
  onKillGrantRandomSpell: (ctx, self, params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    ctx.grantRandomSpell(num(params.count, 1) * mul(self), self.side, self.uid);
  },

  /** Slaughter — Sword and Bored: when this kills an enemy minion, buff your Fodder +atk/+hp PERMANENTLY
   *  (golden ×2). Buffs the living Fodder now + raises the run-wide Fodder buff (carried back) — Fodder only,
   *  no Imps (unlike Commander Impala). Fires on the kill even if this fragile body then dies. */
  onKillBuffFodder: (ctx, self, params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    // A golden gives a flat override (`goldenAttack`/`goldenHealth`) when set — Sword and Bored's golden is +1/+1,
    // NOT the ×2 (+2/+0) a plain double would give; otherwise golden doubles the base.
    const a = self.golden && params.goldenAttack !== undefined ? num(params.goldenAttack) : num(params.attack, 1) * mul(self);
    const h = self.golden && params.goldenHealth !== undefined ? num(params.goldenHealth) : num(params.health, 1) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (ctx.getCard(m.cardId)?.keywords.includes('FD')) ctx.buff(m, a, h, self.uid);
    }
    ctx.grantFodderBuff(a, h, self.side);
  },

  /** Karthus — when this kills an enemy, give your Undead +`attack` permanently (golden ×2) AND improve
   *  the grant by +`attack` for every later Slaughter — permanent for THIS copy (the accrual rides
   *  `summonBonus`: seeded from the run board, carried back at settle, live-text via the 'improve' event).
   *  Buffs all living friendly Undead immediately, then carries back via `grantUndeadBuyAtk` so
   *  existing run-board Undead and future buys also benefit. */
  onKillBuffUndeadAttack: (ctx, self, params, payload) => {
    const { attacker } = payload as { attacker: Minion; victim: Minion };
    // No `self.dead` bail: a Slaughter fires even when the killer dies in the same clash (owner ruling
    // 2026-07-17) — the +Attack still lands on the LIVING Undead it empowers.
    if (self !== attacker) return;
    const step = num(params.attack, 3) * mul(self);
    const amount = step + self.summonBonus; // base + the accrued permanent improvement
    for (const m of ctx.living(self.side)) {
      if (m.tribe !== 'undead' && m.tribe2 !== 'undead' && !ctx.getCard(m.cardId)?.universalTribe) continue;
      ctx.buff(m, amount, 0, self.uid);
    }
    ctx.grantUndeadBuyAtk(amount, self.side);
    const slayInc = step * ctx.improveRepsFor(self.side); // Rune of Mastery: the Improve applies twice
    self.summonBonus += slayInc; // "and improve this" — the next Slaughter grants more (carried back)
    ctx.log({ type: 'improve', target: self.uid, amount: slayInc }); // → live combat text climbs
  },

  /** Tauntbreaker — on-attack: strip the listed keywords (Taunt / Rise) off the enemy it hits, so the target
   *  loses Taunt (stops forcing targeting) and Rise (won't return after it dies). Fires per swing before the
   *  damage exchange resolves, so removing Rise means a lethal hit this same swing keeps it dead. Flurry hits
   *  two enemies → each is disarmed in turn. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onAttackStripKeywords: (ctx, self, params, payload) => {
    const { minion, target } = payload as { minion: Minion; target?: Minion };
    if (minion !== self || self.dead || !target || target.dead) return;
    ARENA_EFFECTS.onAttackStripKeywords(combatArena(ctx, self), { ...params, target });
  },

  /** Thundeer (Tier 7) — whenever a friendly minion of `tribe` ATTACKS, this gains +N/+N, where N starts at
   *  `attack` and IMPROVES by `step` after every proc (the accrual rides `summonBonus`, the standard
   *  per-instance improve channel, so a triple sums the two highest accruals). Thundeer carries `'EG'`
   *  (Engraved), which is what makes the gain permanent across the run — this factory only does the growth.
   *  Golden doubles both the grant and the improve step. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onAllyTribeAttackBuffSelf: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion.side !== self.side) return; // any ally's attack
    ARENA_EFFECTS.onAllyTribeAttackBuffSelf(combatArena(ctx, self), { ...params, attacker: minion });
  },

  /** Anubis (Tier 7) — Deathrattle: grant Rise to EVERY other living friendly minion that doesn't already
   *  have it. `deathrattleGrantReborn` picks ONE candidate per rep; this is the board-wide version. */
  // ARENA-BORN (Echo family): this had NO combat half at all — a combat-fired trigger now grants via the
  // settle-time hand channel, with the replay's toHand flight.
  deathrattleGainRandomMinion: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleGainRandomMinion(combatArena(ctx, self), params);
  },

  // ARENA-MIGRATED (Echo family): one body; the shop half now EXISTS (it was combat-only).
  deathrattleGrantRebornAll: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleGrantRebornAll(combatArena(ctx, self), params);
  },


  /** Anubis (Tier 7) — Deathrattle: cast Lantern of Souls (your `tribe` get +Attack everywhere, permanently).
   *  The Deathrattle mirror of Watcher's `rallyCastTribeAttack`: same spell-power folding, same permanent
   *  grant channel, same "counts as a real spell cast". Golden casts it twice. */
  // ARENA-MIGRATED (Echo family): one body; the shop half is ARENA-BORN (it really casts the spell).
  deathrattleCastTribeAttack: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleCastTribeAttack(combatArena(ctx, self), params);
  },


  /** Buff every living friendly Imp (the 1/1 Imp token) +atk/+hp, AND raise the run-wide Imp buff so the
   *  gain is PERMANENT (future Imps inherit it). Shared by Imp King (Deathrattle) and Brood Matron (Avenge).
   *  Golden doubles the per-proc amount. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  deathrattleBuffImps: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleBuffImps(combatArena(ctx, self), params);
  },


  /** Brood Matron — Avenge (X): every X friendly deaths, buff your Imps +atk/+hp (permanent, carried back).
   *  Golden doubles the stat gain (the summon cap stays at 3). */
  avengeBuffImps: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const every = Math.max(1, num(params.count, 3));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % every !== 0) return;
    const a = num(params.attack, 3) * mul(self);
    const h = num(params.health, 2) * mul(self);
    for (const m of ctx.living(self.side)) if (ctx.getCard(m.cardId)?.imp) ctx.buff(m, a, h, self.uid);
    ctx.grantImpBuff(a, h, self.side); // permanent — carried back to RunState.impBuff
  },

  /** Ryme — Deathrattle: re-fire an adjacent minion's Battlecry in combat. Considers living neighbours that
   *  HAVE a Battlecry (random pick if both qualify); golden re-fires BOTH. Each trigger: (1) narrates via an
   *  `sc` event (so the replay shows Ryme proccing), (2) runs the Battlecry's combat-meaningful effect
   *  (economy battlecries no-op), and (3) emits `battlecryTriggered` so reactive cards (Karwind/Bane) proc —
   *  once per trigger. Drakko the Drummer doubles each trigger. Sylus / Deathsayer re-run this whole
   *  Deathrattle (they re-invoke by factory id), so their multiplication composes for free. */
  deathrattleReplayAdjacentBattlecry: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    let neighbors = livingNeighbours(ctx, self).filter(hasBattlecry);
    if (neighbors.length === 0) return;
    // Ryme (no param): triggers BOTH neighbours, golden each TWICE — consumes no RNG on the base card (a
    // seeded-replay-visible property, so its combat goldens were baked with it).
    // Dawnclaw (`one: true`, owner 2026-08-11): triggers ONE adjacent (a seeded pick), and GOLDEN widens that
    // to BOTH neighbours once each — NOT the same neighbour twice. The `one` branch does consume an RNG roll,
    // but only on Dawnclaw; Ryme's no-param path is untouched.
    const one = !!params.one;
    let repeats = drakkoRepeats(ctx, self.side); // Drakko doubles each trigger
    if (one) {
      if (!self.golden && neighbors.length > 1) neighbors = [ctx.rng.pick(neighbors)];
    } else {
      repeats *= self.golden ? 2 : 1;
    }
    for (const n of neighbors) {
      for (let r = 0; r < repeats; r++) {
        ctx.log({ type: 'sc', source: self.uid, text: `${self.name} triggers ${n.name}'s Battlecry` });
        replayCombatBattlecry(ctx, n); // the Battlecry's own combat effect (no-op for economy battlecries)
        ctx.bus.emit('battlecryTriggered', { side: self.side, minion: n }); // procs Karwind / Bane per trigger
      }
    }
  },

  /** Set 2 — Thunderous Sovereign (Start of Combat): trigger your `tribe` minions' Shouts.
   *
   *  Mirrors Ryme's trigger convention exactly, and all three parts matter: `drakkoRepeats` so Drakko doubles
   *  each trigger in combat as it does in the shop, an `sc` narration so the replay can show it, and the
   *  `battlecryTriggered` bus emit per fire so KARWIND and Bane proc — Karwind is a Dragon in this very tribe,
   *  so a missing emit would silently break the tribe's own headline combo.
   *  Economy battlecries are a no-op here by design: `replayCombatBattlecry` defers those to settle. */
  scTriggerTribeShouts: (ctx, self, params) => {
    const tribe = str(params.tribe);
    const repeats = drakkoRepeats(ctx, self.side) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (!hasBattlecry(m)) continue;
      if (tribe && !(m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe)) continue;
      for (let r = 0; r < repeats; r++) {
        ctx.log({ type: 'sc', source: self.uid, text: `${self.name} triggers ${m.name}'s Battlecry` });
        replayCombatBattlecry(ctx, m);
        ctx.bus.emit('battlecryTriggered', { side: self.side, minion: m });
      }
    }
  },

  /** Set 2 — Chorus Drake (Rally): trigger your LEFT-MOST `tribe` minion's Shout when this attacks.
   *  Left-most = board order, which is deterministic and consumes no RNG. Same trigger convention as
   *  `scTriggerTribeShouts` above.
   *
   *  The "other" exclusion was dropped with the text (owner 2026-07-25). In practice that's inert — the Drake
   *  has no Shout of its own, and the search already skips anything without one — but it matters if the Drake
   *  is ever GIVEN a Shout, and the code should say what the card says. No recursion risk either way:
   *  `replayCombatBattlecry` fires `onPlay` effects, and this is an `onAttack` one.
   *
   *  Note the search still skips Dragons with no Shout rather than stopping at the left-most Dragon and doing
   *  nothing — otherwise a Shout-less Dragon parked on the left would blank the card. */
  rallyTriggerLeftmostTribeShout: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return;
    const tribe = str(params.tribe);
    const target = ctx.living(self.side).find(
      (m) => hasBattlecry(m)
        && (!tribe || m.tribe === tribe || m.tribe2 === tribe || !!ctx.getCard(m.cardId)?.universalTribe),
    );
    if (!target) return;
    const repeats = drakkoRepeats(ctx, self.side) * mul(self);
    for (let r = 0; r < repeats; r++) {
      ctx.log({ type: 'sc', source: self.uid, text: `${self.name} triggers ${target.name}'s Battlecry` });
      replayCombatBattlecry(ctx, target);
      ctx.bus.emit('battlecryTriggered', { side: self.side, minion: target });
    }
  },

  /** Karwind (combat half) — when a Battlecry is triggered on this side (Ryme re-firing an adjacent
   *  Battlecry), buff your minions of `tribe` +atk/+hp. Golden doubles. Mirrors the recruit factory. */
  onBattlecryBuffTribe: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side: Side }).side !== self.side) return;
    const tribe = str(params.tribe);
    const a = num(params.attack, 1);
    const h = num(params.health, 1);
    // `doubleChance` (Karwind 2026-08-07, owner revision): a percent roll that DOUBLES THE BUFF — +3/+3
    // becomes +6/+6 — rather than firing the grant an extra time. Drawn off the combat RNG, so a replayed
    // fight crits on exactly the same triggers. `ctx.crit` announces it for the UI float.
    const chance = num(params.doubleChance, 0);
    const crit = chance > 0 && ctx.rng.int(100) < chance;
    if (crit) ctx.crit?.(self.uid, 2);
    const ca = a * (crit ? 2 : 1);
    const ch = h * (crit ? 2 : 1);
    // Golden "+2/+2 twice" = the buff applied twice (mul = 2), not one doubled grant — two visible buff pulses.
    for (let i = 0; i < mul(self); i++) {
      for (const m of ctx.living(self.side)) {
        if (tribe && tribe !== 'any' && m.tribe !== tribe && m.tribe2 !== tribe && !ctx.getCard(m.cardId)?.universalTribe) continue;
        ctx.buff(m, ca, ch, self.uid);
      }
    }
  },

  /** Bane (combat half) — on a triggered Battlecry, buff your living Fodder + Imps +atk/+hp, and raise BOTH
   *  the run-wide Imp buff AND the run-wide Fodder enchant (permanent — carried back) so future Fodder/Imps
   *  inherit it, exactly like the recruit-phase Bane. Golden doubles. */
  // ARENA-MIGRATED (Step 3): one body; the Bane's Existence widen now fires in combat too (owner ruling).
  onBattlecryBuffFodder: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side: Side }).side !== self.side) return;
    ARENA_EFFECTS.onBattlecryBuffFodder(combatArena(ctx, self), params);
  },

  // ─── 2026-07-06 content batch: Beast "wherever they are" combat auras ──────────

  /** Kennelmaster — Start of Combat: give your Beasts +N/+N (N = base + its Avenge-grown `summonBonus`) as a
   *  rest-of-combat aura. The current Beasts are buffed now; any Beast summoned LATER this fight inherits it too
   *  (`addTribeAura`, applied in summonMinion). Self is a Beast, so it's included. Golden falls out of the triple
   *  combine (checkTriples folds the doubled magnitude into `summonBonus`), so — like buffOnSummon — no `mul`. */
  // ARENA-MIGRATED (SC family): one body in arena.ts (per-stat Avenge accrual, golden-doubles-the-whole-grant
  // — see 2026-08-04's report there). The rest-of-combat aura half is a shop no-op by design (`addTribeAura`).
  scBeastAura: (ctx, self, params) => {
    ARENA_EFFECTS.scBeastAura(combatArena(ctx, self), params);
  },

  /** Solaris Fang — Rally: when this attacks, give your Beasts +atk/+hp as a rest-of-combat aura (current
   *  Beasts buffed now; Beasts summoned later inherit it). Attack-only for Solaris (+5/+0). Self is a Beast,
   *  so it snowballs its own Attack each swing. Golden doubles the grant. */
  rallyTribeAura: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const tribe = (str(params.tribe) || 'beast') as Tribe | 'any';
    const a = num(params.attack, 1) * mul(self);
    const h = num(params.health, 0) * mul(self);
    if (a === 0 && h === 0) return;
    ctx.addTribeAura(self.side, tribe, a, h, self.uid);
    for (const m of ctx.living(self.side)) {
      if (tribe === 'any' || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
    }
  },

  /** Trophy Stalker — Rally: like `rallyTribeAura`, but the grant GROWS by `step` each of its own attacks. The
   *  accrued growth rides in `summonBonus` (the Kennelmaster per-instance field — snapshotted + carried back, so
   *  it keeps climbing across combats). Grant = (base + summonBonus) × golden; then bump summonBonus by `step`.
   *  Beasts on board buffed now + those summoned later inherit it (`addTribeAura`). */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyTribeAuraGrowing: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyTribeAuraGrowing(combatArena(ctx, self), params);
  },

  /** Bloodbinder — Rally (on its own attack): give another friendly Demon Attack equal to THIS minion's current
   *  Attack (a golden Bloodbinder has double Attack, so it hands out double). Random pick among the other Demons. */
  rallyGiveDemonAttack: (ctx, self, _params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const pool = ctx.living(self.side).filter((m) => m !== self && (m.tribe === 'demon' || m.tribe2 === 'demon' || ctx.getCard(m.cardId)?.universalTribe));
    if (pool.length === 0) return;
    ctx.buff(ctx.rng.pick(pool), self.attack, 0, self.uid);
  },

  /** Philippe — Rally: on its OWN attack, also deal its current Attack to a RANDOM living enemy (golden: +2
   *  more) — a random-target "cleave." Pure splash via ctx.damage, so the struck enemy never retaliates:
   *  Philippe only takes damage from the minion it actually attacked. Fires per hit (Flurry → twice). */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyDamageRandomEnemy: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyDamageRandomEnemy(combatArena(ctx, self), params);
  },


  /** Set 2 — Sunmane Herald (Rally): on its own attack, give your OTHER `tribe` minions +Attack and graft this
   *  rally onto them, so every Beast it touches becomes another Herald.
   *
   *  **The escalation is EMERGENT, not a rule** (owner spec 2026-07-25). A Beast's rally grants whatever rally
   *  Attack it has ACCUMULATED (`rallySpreadAtk`) plus its own printed base — so as the buff spreads, later
   *  carriers hand out more than earlier ones purely because they were handed more. Nothing doubles anything;
   *  the doubling players see is the sum compounding.
   *
   *  It never buffs the ATTACKER, which is load-bearing rather than incidental: Sunmane therefore never
   *  accumulates and keeps granting its printed +3 forever, while the Beasts it feeds grow. Both owner examples
   *  fall out of exactly this:
   *   - Sunmane with Flurry + Lancel attacking 4× grants +3 four times, so the others gain +12 total — and the
   *     NEXT Beast to attack grants +12, not +24. (An earlier reading that doubled per attack got this wrong.)
   *   - With each Beast attacking once, the grants run 3, 3, 6, 12, 24 — the repeated 3 being the second
   *     carrier passing on the 3 it received.
   *
   *  Only the printed card carries a base (`params.attack`); the graft is written with `attack: 0` so a converted
   *  Beast passes on exactly what it was given and no more.
   *
   *  Accumulation is per-INSTANCE, which is what gives the owner's two edge rules for free: a body that dies
   *  loses its stacks (a Rise/resummon re-enters with none), and a Beast summoned mid-fight starts empty, then
   *  takes the full current grant the next time a carrier attacks and can carry the chain onward.
   *
   *  The effect is grafted only once per body (a second copy would double-fire the same attack); the ACCUMULATED
   *  total keeps climbing regardless, and that total is the carrier of the escalation. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallySpreadTribeBuff: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallySpreadTribeBuff(combatArena(ctx, self), params);
  },

  /** Set 2 — Denkeeper Oona (Start of Combat, passive-reading): register a SUMMON-ONLY `tribe` aura — minions
   *  you summon later in the fight enter with +atk/+hp. Unlike `scBeastAura` it deliberately does NOT buff the
   *  minions already on board: the card reads "Beasts you SUMMON in combat have +5/+5", i.e. it pays the token
   *  flood, not the existing line. Golden doubles the grant. */
  scSummonOnlyTribeAura: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'beast') as Tribe | 'any';
    const a = num(params.attack, 1) * mul(self);
    const h = num(params.health, 1) * mul(self);
    if (a <= 0 && h <= 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: `${self.name} watches the den` });
    ctx.addTribeAura(self.side, tribe, a, h, self.uid); // future summons only — no pass over `ctx.living`
  },

  /** Set 2 — Echohorn Stag (Rally): on its own attack, trigger your LEFT-MOST friendly Echo (Deathrattle) —
   *  it stays alive, exactly like Deathsayer's `rallyProcDeathrattle`. Differs only in the pick: strictly
   *  board-order left-most (deterministic, no RNG) rather than "the first that has one" including itself.
   *  Golden triggers it twice. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyProcLeftmostEcho: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyProcLeftmostEcho(combatArena(ctx, self), params);
  },

  /** Set 2 — Hawkus (T5 Beast): whenever a Rally is triggered — i.e. any friendly minion with the Rally keyword
   *  attacks — trigger your LEFT-MOST friendly Echo (it stays alive), reusing the Echohorn Stag machinery. The
   *  attacker having `RL` is what makes it a Rally (an ordinary swing is not), the same guard Mineral Master uses.
   *  Golden triggers the Echo twice per Rally. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onRallyProcLeftmostEcho: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion.side !== self.side) return; // any ally's attack
    ARENA_EFFECTS.onRallyProcLeftmostEcho(combatArena(ctx, self), { ...params, attacker: minion });
  },

  /** Set 2 — Spots (T6 Beast, Start of Combat): trigger your `count` (2) LEFT-MOST friendly Echoes, board order.
   *  Each stays alive. Golden doubles each trigger (via `triggerEcho`'s `mul(self)`). */
  // ARENA-MIGRATED (SC family): one body; a SHOP fire routes through the recruit Echo ritual, so it pays
  // `lastEchoFires` and the Echo quest tallies like every other shop-fired Echo (owner ruling 2026-08-20).
  scTriggerLeftmostEchoes: (ctx, self, params) => {
    if (self.dead) return;
    ARENA_EFFECTS.scTriggerLeftmostEchoes(combatArena(ctx, self), params);
  },

  /** Set 2 — Imp Wrangler (Start of Combat) / Errand Fiend (Rally): summon `count` Imps. `keyword` optionally
   *  grants them one on arrival (unused here, but the Captain's Ward path below shares the token). */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases. The own-swing Rally guard stays here.
  summonImps: (ctx, self, params, payload) => {
    const p = payload as MinionPayload;
    if (p.minion && p.minion !== self) return;
    ARENA_EFFECTS.summonImps(combatArena(ctx, self), params);
  },

  /** Errand Fiend (owner rework 2026-08-04) — Rally: summon an Imp AND enchant your Imps +1/+1 run-wide
   *  (the Imp aura channel — live board Imps buff now, the gain carries back; golden doubles both). Flurry
   *  doubles the Rally itself, so the gilded ceiling is 2 Imps + a +2/+2 enchant per attack round. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallySummonImpBuffImps: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallySummonImpBuffImps(combatArena(ctx, self), params);
  },

  /** Rope Wrangler (owner add 2026-08-04) — Echo: summon a random MINION from your hand, with the stats it
   *  held (buffs + golden intact). The card is CONSUMED — it fought, so settle removes it from the hand
   *  whether it lived or died. A spell-only or empty hand is a clean no-op; golden summons 2. */
  deathrattleSummonRandomHandMinion: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    for (let i = 0; i < mul(self); i++) {
      const pick = ctx.takeRandomHandMinion(self.side);
      if (!pick) return;
      const def = ctx.getCard(pick.cardId);
      if (!def) continue;
      ctx.summon(self.side, def, self.uid, [...pick.keywords], pick.golden, false,
        { attack: pick.attack, health: pick.health, maxHealth: pick.health });
    }
  },

  /** Set 2 — Legion Shepherd (owner rework 2026-07-27): Echo — summon `count` Imps; every one that can't fit
   *  gives your Imps +atk/+hp EVERYWHERE, permanently.
   *
   *  "Everywhere" is the load-bearing word, and it's why this can't just reuse `deathrattleSummonOverflowBuff`:
   *  that one buffs the living bodies and stops at the end of the fight. This goes through `ctx.grantImpBuff`,
   *  the Imp Aura channel — which advances the aura (so Imps summoned LATER this combat inherit it) and rides
   *  the `playerImpBuffGain` carry-back into run state (so Imps in the shop and on the board get it too, and
   *  keep it). The living Imps already on the field are buffed directly, since the aura only reaches new bodies. */
  // ARENA-MIGRATED (Echo family): one body; the shop half is ARENA-BORN. `grantImpAura` buffs every
  // imp-flagged body rather than only impscrap literals — a deliberate widening ("your Imps" means Imps).
  deathrattleImpsOverflowGrant: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleImpsOverflowGrant(combatArena(ctx, self), params);
  },

  /** Set 2 — Endless Overseer (owner rework 2026-07-27): Start of Combat, graft an Echo onto your RIGHT-most
   *  minion so its death summons `count` Imps with Ward.
   *
   *  Right-most rather than a pick, so the player chooses the recipient by placement — the natural home is
   *  whatever body you were happy to lose last. Grafted through `ctx.grantDeathrattle`, the same channel Grave
   *  Body uses, which registers the effect so it fires with the RECIPIENT as `self` (its golden state, not the
   *  Overseer's, would scale it — hence the count is baked into the grafted params here, already multiplied). */
  scGrantRightmostEcho: (ctx, self, params) => {
    const board = ctx.living(self.side);
    const target = board[board.length - 1];
    if (!target) return;
    ctx.grantDeathrattle(target, [
      { on: 'onDeath', do: 'summonImps', params: { count: num(params.count, 2) * mul(self), keyword: 'DS' } },
    ]);
  },

  /** Set 2 — Riot Caller (Rally): your `count` LEFT-most Imps attack immediately, out of turn order. Board
   *  order, so no RNG; skips itself in case Riot Caller is ever an Imp via Anomaly Reactor. */
  rallyImpsAttackNow: (ctx, self, params, payload) => {
    const p = payload as MinionPayload;
    if (self.dead || (p.minion && p.minion !== self)) return;
    const imps = ctx.boards[self.side].filter((m) => !m.dead && m.health > 0 && m !== self && m.cardId === 'impscrap');
    for (const imp of imps.slice(0, num(params.count, 1) * mul(self))) ctx.attackNow?.(imp, false);
  },


  /** Set 2 — Broodwright: whenever you summon an Imp, give it +atk/+hp. Its Avenge half improves that grant
   *  permanently via `summonBonus`, the standard per-instance accrual. */
  onSummonImpBuff: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (!minion || minion.side !== self.side || minion.cardId !== 'impscrap' || minion.dead) return;
    const bonus = self.summonBonus ?? 0;
    const a = (num(params.attack, 2) + bonus) * mul(self);
    const h = (num(params.health, 2) + bonus) * mul(self);
    ctx.buff(minion, a, h, self.uid);
    // Rune of the Broodmaster: the same grant also lands on the Broodwright. Reuses the numbers just paid out
    // rather than recomputing them, so the two can never drift — the Groveweaver rune's shape exactly.
    if (ctx.broodmasterSelfFor?.(self.side) && !self.dead) ctx.buff(self, a, h, self.uid);
  },

  /** Set 2 — Endless Overseer: your first `count` IMPS that die each combat summon an Imp (owner change
   *  2026-07-25, replacing a version that grafted an Echo onto every living Imp).
   *
   *  Hooked on `avenge` — the per-friendly-death signal — reading the VICTIM from the payload so it fires only
   *  for Imps. Its own `count` budget lives per-instance (`attackSeen`), so it resets each fight, which is what
   *  "each combat" means, and the cap is what stops the chain: a replacement Imp dying can itself pay out, but
   *  only while the budget lasts.
   *
   *  Better than the graft it replaces on two counts: it catches Imps summoned MID-combat (a graft can only
   *  reach bodies that already exist), and the budget is explicit rather than relying on "don't grant to the
   *  ones you just made" to avoid recursion. */
  onImpDeathSummonImp: (ctx, self, params, payload) => {
    const { side, victim } = payload as { side: Side; count: number; victim?: Minion };
    if (self.dead || side !== self.side) return;
    if (!victim || victim.cardId !== 'impscrap') return;
    // `imps`, NOT `count`: by convention an avenge factory's `params.count` is the every-N THRESHOLD (see
    // `avengeShieldAttack`), and this card has no threshold — it pays out on EVERY Imp death until its budget is
    // spent, which is what "your first 3 Imps that die" says. Reusing `count` here would read as "every 3rd".
    const budget = num(params.imps, 3) * mul(self);
    if ((self.attackSeen ?? 0) >= budget) return;
    self.attackSeen = (self.attackSeen ?? 0) + 1;
    const imp = ctx.getCard('impscrap');
    if (imp) ctx.summon(self.side, imp, self.uid);
  },

  /** Set 2 — Malphas "Legion": when an Imp attacks, summon a COPY of it if there's room. Copies the attacker's
   *  card, so a buffed Imp still yields a base-stat body — a copy of the card, not of the creature, matching how
   *  every other "summon a copy" in the game reads. */
  onImpAttackSummonCopy: (ctx, self, params, payload) => {
    // Gated on the Choose One pick — see the note on Malphas's Feast half. A persistent option can't live in
    // `chooseOne[].effects`, which fire once at pick time, so both halves are printed and branch-checked.
    if (num(params.option, -1) >= 0 && self.chosenOption !== num(params.option, -1)) return;
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion.side !== self.side || minion.cardId !== 'impscrap') return;
    const imp = ctx.getCard('impscrap');
    if (!imp) return;
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) ctx.summon(self.side, imp, minion.uid);
  },

  /** Set 2 — Broodwright's Avenge half: every X friendly deaths, improve this minion's own summon-grant by
   *  `step` (`summonBonus`, the standard per-instance accrual, so it carries back to the run and shows in the
   *  inspect breakdown). Pairs with `onSummonImpBuff`, which reads the same field. */
  avengeImproveSummonBuff: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    self.summonBonus = (self.summonBonus ?? 0) + num(params.step, 1) * mul(self);
    ctx.log({ type: 'improve', target: self.uid, amount: num(params.step, 1) * mul(self) }); // live combat text (owner audit 2026-08-02)
  },

  /** Set 2 — Legion Shepherd (Start of Combat): fill your warband with Imps, then give your Imps +atk/+hp for
   *  EACH one summoned. The grant scales with how much room you left, so a wide board pays little and a lone
   *  Shepherd pays a lot — the tension is the card. */
  scFillWithImpsAndBuff: (ctx, self, params) => {
    const imp = ctx.getCard('impscrap');
    if (!imp) return;
    ctx.log({ type: 'sc', source: self.uid, text: `${self.name} calls the legion` });
    let made = 0;
    // `ctx.summon` returns the body; a full board makes it a no-op, so compare the living count to detect that
    // rather than assuming success.
    for (let i = 0; i < 7; i++) {
      const before = ctx.living(self.side).length;
      ctx.summon(self.side, imp, self.uid);
      if (ctx.living(self.side).length === before) break; // no room left
      made++;
    }
    if (made === 0) return;
    const a = num(params.attack, 1) * mul(self) * made;
    const h = num(params.health, 1) * mul(self) * made;
    for (const m of ctx.living(self.side)) if (m.cardId === 'impscrap') ctx.buff(m, a, h, self.uid);
  },

  /** Set 2 — Rouge Rogue: whenever an Imp attacks, give your Imps +atk/+hp for the rest of the combat,
   *  improving by `improve` every `improveEvery` Imp attacks. The escalation rides `summonBonus` (per-instance,
   *  so it resets each fight — "this combat"), and the attack tally rides `attackSeen`. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onImpAttackBuffImps: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion.side !== self.side) return;
    ARENA_EFFECTS.onImpAttackBuffImps(combatArena(ctx, self), { ...params, attacker: minion });
  },

  /** Set 2 — Gravelight Acolyte (Echo): on death, summon `count` random minions of an exact `tier` (golden
   *  doubles). Sibling of `deathrattleSummonRandomTribe`, keyed on tier instead of tribe; tokens and spells are
   *  excluded so it can only roll a real shop minion. */
  deathrattleSummonRandomTier: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tier = num(params.tier, 1);
    const pool = ctx.poolCards(self.side).filter((c) => !c.token && !c.spell && c.tier === tier);
    if (pool.length === 0) return;
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) ctx.summon(self.side, ctx.rng.pick(pool), self.uid);
  },



  /** Set 2 — Demon Horse (Rally): permanently buff every minion in the SHOP.
   *
   *  Lives in COMBAT because a Rally is an attack trigger, but the tavern buff is run state — so it goes
   *  through `gainTavernBuy`, the same carry-back shape Ruby strength and the Undead aura use. Writing this
   *  as a recruit factory (my first attempt) would have made the card do nothing at all: a combat Rally never
   *  reaches the recruit table.
   *
   *  Permanent rather than this-shop-only, per the owner's standing rule that "give minions in the Shop" means
   *  a Staff-of-Guel-style buff that survives a reroll (ruling 2026-07-25). */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyBuffShopPermanent: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyBuffShopPermanent(combatArena(ctx, self), params);
  },

  /** Set 2 — Malphas (Echo half): when THIS minion dies, permanently buff every minion in the Shop. The Shout
   *  half is the recruit `buffShopPermanent`; this is its combat twin, carried back through `gainTavernBuy`
   *  exactly like Demon Horse's Rally — a recruit factory would never fire on a combat death. Golden doubles. */
  deathrattleBuffShopPermanent: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (minion !== self) return; // own Echo only — the bus broadcasts every death
    ctx.gainTavernBuy(num(params.attack, 2) * mul(self), num(params.health, 2) * mul(self), self.side, self.uid);
  },

  /** Ashen Broodlord (owner rework 2026-07-31) — Rally: CAST A STAFF OF GUEL. A real spell cast, so it
   *  follows the Taragosa pattern exactly: the run's spell power folds into the grant (`spellPowerFor`, so an
   *  enemy Broodlord scales with the OPPONENT's), and `ctx.castSpell` fires the cast so per-spell payoffs
   *  (Guel, Groveweaver, Runebloom) all see it. Golden casts it TWICE rather than doubling one cast — that is
   *  what "Gilded casts 2" means, and it matters: two casts fire two spellCast triggers.
   *
   *  The buff itself is the Staff's: a PERMANENT run-wide tavern-buy enchant, carried out of combat through
   *  `gainTavernBuy` (→ `playerTavernBuyGain` → `tavernBuyBonus`). `sourceUid` telegraphs it mid-fight as the
   *  "+N/+N Shop" narration. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyCastShopBuffSpell: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyCastShopBuffSpell(combatArena(ctx, self), params);
  },

  /** Set 2 — Traveling Skald: whenever ANOTHER friendly minion of `tribe` attacks, give IT +atk/+hp. The
   *  payload's attacker is the target; the Skald's OWN swing never buffs itself (owner ruling 2026-08-01 —
   *  the printed text says "another"). Golden doubles. */
  /** Set 2 — Impossible Todd / Leech / Axeman: react whenever a FRIENDLY Demon deals combat damage
   *  (attack, retaliation, or incidental; a Ward-absorbed 0-damage hit never fires the event). Gains `attack`/
   *  `health` on self, and optionally grants your Imps `impAttack`/`impHealth` run-wide (`grantImpBuff` carries
   *  back to RunState.impBuff — "this game"). The emit already guaranteed the dealer is a Demon; we just
   *  confirm it's on our side. `self` MAY be the dealer (a Demon reacting to its own damage counts). */
  onFriendlyDemonDamageBuffSelf: (ctx, self, params, payload) => {
    if (self.dead) return;
    const { minion } = payload as MinionPayload;
    if (!minion || minion.side !== self.side) return;
    const a = num(params.attack, 0) * mul(self);
    const h = num(params.health, 0) * mul(self);
    if (a || h) {
      ctx.buff(self, a, h, self.uid);
      // PERMANENT: carry the gain back to the run board like an Engraved minion (owner 2026-08-18: these gains
      // are permanent). `ctx.buff` only auto-accrues permaGain for EG/Transcendant bodies, so add it here for
      // the rest. Carry-back only reads PLAYER minions with a sourceUid, so an enemy copy is harmless.
      if (!self.keywords.includes('EG')) {
        self.permaGain = { attack: (self.permaGain?.attack ?? 0) + a, health: (self.permaGain?.health ?? 0) + h };
      }
    }
    const ia = num(params.impAttack, 0) * mul(self);
    const ih = num(params.impHealth, 0) * mul(self);
    if (ia || ih) ctx.grantImpBuff(ia, ih, self.side);
  },

  /** Set 2 — Kobe (Start of Combat): play `count` PERMANENT Rubies on this minion AND each living adjacent
   *  same-`tribe` neighbour. Threads `permanent: true` through `playRubyOn`, so the gain carries back to the
   *  run board (see `applyRubyStats`); golden doubles `count`. */
  // ARENA-MIGRATED (SC family): one body in arena.ts; the dead guard stays with dispatch.
  scPlayRubiesSelfAndAdjacentTribe: (ctx, self, params) => {
    if (self.dead) return;
    ARENA_EFFECTS.scPlayRubiesSelfAndAdjacentTribe(combatArena(ctx, self), params);
  },

  /** Set 2 — Boulderdash (Rally): each time THIS minion attacks, play `count` PERMANENT Rubies on itself.
   *  Fires on its own attack (Flurry → per hit); golden doubles `count`. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyPlayRubiesSelf: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyPlayRubiesSelf(combatArena(ctx, self), params);
  },

  /** Set 2 — Blazer (Rally): each time THIS minion attacks, play `count` PERMANENT Rubies on EVERY friendly
   *  minion. Fires on its own attack (Flurry → per hit); golden doubles `count`. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyPlayRubiesAll: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyPlayRubiesAll(combatArena(ctx, self), params);
  },

  /** Set 2 — Fel Spikes (Echo): deal `amount` to EVERY minion on BOTH sides EXCEPT friendly minions of
   *  `exceptTribe` (Demons). The exclusion is FRIENDLY-only — an ENEMY Demon is still hit — which is why this
   *  can't route through the tribe-agnostic `deathrattleDamageAll`.
   *
   *  Golden fires the whole spray `mul(self)` times as SEPARATE triggers (owner 2026-08-18: "deal 4 twice", not
   *  "deal 8 once") — so each pass shows independently and procs the demon-damage reactors on its own, exactly
   *  like an Echo multiplier (Sylus) firing the Deathrattle again. */
  deathrattleDamageAllExceptTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const amount = num(params.amount, 1);
    if (amount <= 0) return;
    const exc = str(params.exceptTribe);
    const passes = mul(self); // gilded → 2 sprays; each Echo re-trigger (Sylus / Echohorn) calls this again
    // CAPTURE the victims for THIS fire from what's still on the board — INCLUDING bodies a prior fire already
    // dropped to ≤0 (their deaths are deferred by the surrounding echo scope, so `onBoard` still lists them), so
    // the FINAL resolve sees the whole set. But a body only takes damage from a volley while it is STILL above 0:
    // once a volley drops it to ≤0 it stops getting hit (no overkill number, no further spike, no extra reactor
    // proc — owner ruling 2026-08-22: "stop getting hit the instant its hp hits 0"), yet it STAYS on the board
    // via the deferred death so it dies ONCE after the spray and a body that summons tokens on death (Void
    // Panther → two Void Cubs) creates them AFTER all the damage, where no volley can catch them.
    const victims: Minion[] = [];
    for (const sideKey of ['player', 'enemy'] as Side[]) {
      for (const m of ctx.onBoard(sideKey)) {
        if (sideKey === self.side && exc && (m.tribe === exc || m.tribe2 === exc || ctx.getCard(m.cardId)?.universalTribe)) continue;
        victims.push(m);
      }
    }
    if (victims.length === 0) return;
    for (let pass = 0; pass < passes; pass++) {
      const last = pass === passes - 1;
      // Each pass is one presentation WAVE (a volley moment). `self` as the source: Fel Spikes is a Demon, so
      // every landed hit registers as a friendly Demon dealing damage, procing the reactors — per volley.
      ctx.wave(() => {
        for (const m of victims) if (!m.dead && m.health > 0) ctx.damageDeferred(m, amount, self); // only ABOVE 0
        // Resolve every death now, on the FINAL volley — after all the damage — so the tokens/consequences land
        // once, after the spray, not between passes. (The cubs are summoned here; there is no wave after them.)
        if (last) for (const m of victims) ctx.resolveEchoDeath(m, self);
      });
    }
  },

  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  onTribeAttackBuffAttacker: (ctx, self, params, payload) => {
    if (self.dead) return;
    const { minion } = payload as MinionPayload;
    if (!minion || minion.dead || minion.side !== self.side || minion === self) return;
    ARENA_EFFECTS.onTribeAttackBuffAttacker(combatArena(ctx, self), { ...params, attacker: minion });
  },

  /** Set 2 — Scalechanter (combat half): a spell cast mid-fight gives the whole side +atk. Mirrors the recruit
   *  factory so the card behaves the same whichever phase the cast happens in. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts serves both phases.
  spellCastBuffAll: (ctx, self, params, payload) => {
    // SIDE GUARD (owner bug report 2026-08-07): every sibling spell-cast watcher checks the caster's side;
    // this one didn't, so an ENEMY Earthbreaker was buffing its board off YOUR casts.
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    ARENA_EFFECTS.spellCastBuffAll(combatArena(ctx, self), params);
  },

  /** Karwind (owner rework 2026-07-25): whenever a Shout triggers, give your `tribe` +atk/+hp — except this
   *  minion's two NEIGHBOURS, who get the bigger `adjAttack`/`adjHealth` INSTEAD of (not on top of) the base
   *  grant. A neighbour that isn't of the tribe gets nothing: the owner chose "instead", not "any tribe".
   *
   *  Neighbours are read off `ctx.living(self.side)` by index, which is board order — deterministic, no RNG. */
  // ARENA-MIGRATED (Step 3): one body; golden = 2x magnitude in BOTH phases (owner ruling 2026-08-04).
  onBattlecryBuffTribeAdjacentMore: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side: Side }).side !== self.side) return;
    ARENA_EFFECTS.onBattlecryBuffTribeAdjacentMore(combatArena(ctx, self), params);
  },

  /** Set 2 — Denkeeper Oona (owner rework 2026-07-25): a Beast you summon in combat gets +atk/+hp and THEN
   *  has its stats doubled. Order matters and is the printed order — the flat grant is included in what gets
   *  doubled, so +1/+1 on a 3/3 yields 8/8, not 7/7.
   *
   *  The flat grant grows with Oona's Avenge accrual (`summonBonus`), which is what "Improve this" means here.
   *  Doubling is applied as a buff of the minion's CURRENT stats rather than a set, so it stacks correctly with
   *  anything else that has already touched the body. */
  onSummonTribeBuffThenDouble: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion === self || minion.side !== self.side || minion.dead) return;
    const tribe = (str(params.tribe) || 'beast') as Tribe;
    if (!(minion.tribe === tribe || minion.tribe2 === tribe || ctx.getCard(minion.cardId)?.universalTribe)) return;
    const step = self.summonBonus ?? 0;
    const a = (num(params.attack, 1) + step * num(params.stepAttack, 1)) * mul(self);
    const h = (num(params.health, 1) + step * num(params.stepHealth, 1)) * mul(self);
    if (a > 0 || h > 0) ctx.buff(minion, a, h, self.uid);
    // …then MULTIPLY what it now has. One extra copy of its own stats per `mul` — so plain doubles and gilded
    // TRIPLES (owner 2026-07-27). Buffing by a multiple of the current stats rather than setting them keeps it
    // stacking correctly with anything else that has already touched the body. `attackOnly` (King Oona, owner
    // 2026-08-12) multiplies the Attack alone — the Health is left as-is.
    const mAtk = minion.attack * mul(self);
    const mHp = params.attackOnly ? 0 : minion.health * mul(self);
    if (mAtk > 0 || mHp > 0) ctx.buff(minion, mAtk, mHp, self.uid);
  },

  /** Set 2 — Menagerie Mammoth (owner rework 2026-07-27): every Beast you summon in combat gets +N Attack, and
   *  the grant IMPROVES PERMANENTLY — each payout raises this instance's `summonBonus`, which rides home on the
   *  `playerSummonBonus` carry-back, so the bigger grant is still there next round.
   *
   *  Attack-only by design: the Beast go-wide line already has plenty of health-stacking, and an escalating
   *  Attack grant is what makes a wide board actually close a fight. */
  onSummonTribeBuffImproveSelf: (ctx, self, params, payload) => {
    // Owner rebalance 2026-08-02: asymmetric now — base +attack/+health, improving by +stepAttack/+stepHealth
    // per summon (golden doubles both, so the improve reads +4/+2 gilded). `summonBonus` counts PROCS (the
    // same shape Oona's `onSummonTribeBuffThenDouble` uses), still carried back keyed to this body's sourceUid.
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion === self || minion.side !== self.side || minion.dead) return;
    const tribe = (str(params.tribe) || 'beast') as Tribe;
    if (!(minion.tribe === tribe || minion.tribe2 === tribe || ctx.getCard(minion.cardId)?.universalTribe)) return;
    const procs = self.summonBonus ?? 0;
    const a = (num(params.attack, 3) + procs * num(params.stepAttack, 3)) * mul(self);
    // Rune of the Mammoth (owner 2026-08-02): the Attack-only grant becomes 1:1 symmetric — +3/+3, +6/+6, …
    const h = ctx.mammothHealthFor(self.side)
      ? a
      : (num(params.health, 0) + procs * num(params.stepHealth, 0)) * mul(self);
    ctx.buff(minion, a, h, self.uid);
    // Rune of Mastery: an Improve improves an additional time — same rule Kennelmaster's Avenge follows.
    const inc = ctx.improveRepsFor(self.side);
    self.summonBonus = procs + inc; // permanent — carried back keyed to this body's sourceUid
    // Live combat text (owner audit 2026-08-02): without this log the replay never folded the climb and the
    // printed grant froze mid-fight. `amount` = procs (what the replay adds); `display` = the step it reads as.
    ctx.log({ type: 'improve', target: self.uid, amount: inc, display: num(params.stepAttack, 3) * mul(self) * inc });
  },

  /** Set 2 — Groveweaver (combat half): a `tribe` minion summoned DURING the fight gets the same asymmetric
   *  grant the recruit half hands out, sized by this instance's accrued `summonBonus`.
   *
   *  This half was missing entirely (owner report 2026-07-25): the factory existed only in the recruit table,
   *  so Groveweaver paid for shop summons and silently did nothing for the Echo/Rise tokens that make up most
   *  of a summon board's bodies. */
  // ARENA-MIGRATED (Step 3): one body in arena.ts; the arriver rides params.
  summonBuffTribeAsym: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion === self || minion.side !== self.side || minion.dead) return;
    ARENA_EFFECTS.summonBuffTribeAsym(combatArena(ctx, self), { ...params, arriver: minion });
    // Rune of the Groveweaver (combat half, owner 2026-08-07): the grant ALSO lands on the granter — a
    // Groveweaver grows as it buffs. Mirrors the recruit half exactly: the arena body's own arithmetic
    // (base + this instance's summonBonus, x golden), behind the same tribe gate, so a skipped arriver
    // pays nobody.
    if (!ctx.groveweaverSelfFor?.(self.side)) return;
    const tribe = str(params.tribe);
    if (tribe && minion.tribe !== tribe && minion.tribe2 !== tribe && !ctx.getCard(minion.cardId)?.universalTribe) return;
    const g = mul(self);
    const bonus = self.summonBonus ?? 0;
    const a = (num(params.attack, 2) + bonus) * g;
    const h = (num(params.health, 4) + bonus) * g;
    if (a > 0 || h > 0) ctx.buff(self, a, h, self.uid);
  },

  /** Beardsley (owner add 2026-08-12) — when you summon a `tribe` minion IN COMBAT, give it +atk/+hp flat
   *  (golden doubles). Combat-only by construction: there is no recruit twin, so a shop-phase summon never
   *  fires it (unlike Groveweaver's `summonBuffTribeAsym`, which is wired in both phases). */
  onSummonTribeBuffFlat: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion === self || minion.side !== self.side || minion.dead) return;
    const tribe = str(params.tribe);
    if (tribe && minion.tribe !== tribe && minion.tribe2 !== tribe && !ctx.getCard(minion.cardId)?.universalTribe) return;
    // Rune of the Zoo scales the grant by the running combat-summon ordinal (1× on the 1st summon, 2× on the
    // 2nd, …). Off the rune it returns 1. Stacks across Beardsleys (each fires) and composes with golden (`mul`).
    const g = mul(self) * (ctx.zooReps?.(self.side) ?? 1);
    // Escalating variant (Beardsley 2026-08-18): +`improve` per stat every `every` tribe summons this combat,
    // tracked on a per-instance counter. Absent `improve` → the plain flat grant, unchanged.
    const improve = num(params.improve, 0);
    const every = Math.max(1, num(params.every, 1));
    const step = improve > 0 ? Math.floor((self.summonBonus ?? 0) / every) : 0;
    const a = (num(params.attack, 6) + improve * step) * g;
    const h = (num(params.health, 6) + improve * step) * g;
    if (a > 0 || h > 0) ctx.buff(minion, a, h, self.uid);
    if (improve > 0) self.summonBonus = (self.summonBonus ?? 0) + 1; // count this Beast toward the next step
  },

  /** Set 2 — Lastlight (Echo): give `count` friendly minions Ward (golden doubles).
   *
   *  Prefers minions that DON'T already have a shield — handing Ward to a shielded body is a wasted grant, and
   *  on a wide board the random pick would do that often. Falls back to the full living set only if everyone is
   *  already shielded (where it's a no-op anyway). Picks are DISTINCT: `count` is a number of minions, not a
   *  number of rolls, so the same body can't soak both. */
  // ── ARENA-MIGRATED (Step 1 spike): the body lives ONCE in arena.ts; this wrapper only guards the
  //    dispatch payload and hands over the combat adapter. The legacy body is deleted, not deprecated.
  deathrattleGrantWardRandom: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ARENA_EFFECTS.deathrattleGrantWardRandom(combatArena(ctx, self), params);
  },


  /** Set 2 — Menagerie Mammoth (Echo): summon `count` RANDOM minions of `tribe`, drawn from the run's set pool
   *  (golden doubles the count). Seeded via the combat RNG so replays stay faithful. Tokens are excluded — a
   *  random summon should give you real bodies, not another card's summon-fodder. `excludeSelf` drops this
   *  card's own id from the pool ("3 random OTHER Beasts" — a Mammoth never summons more Mammoths). */
  deathrattleSummonRandomTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = str(params.tribe);
    // Owner fix 2026-08-18: cap at the summoner's current tier — a low-tier Menagerie Mammoth must not roll a
    // Tier-6 Beast.
    const maxTier = ctx.tierFor(self.side);
    const pool = ctx.poolCards(self.side).filter(
      (c) => !c.token && !c.spell && c.tier <= maxTier && (!params.excludeSelf || c.id !== self.cardId)
        && (!tribe || c.tribe === tribe || c.tribe2 === tribe),
    );
    if (pool.length === 0) return;
    for (let i = 0; i < num(params.count, 2) * mul(self); i++) {
      ctx.summon(self.side, ctx.rng.pick(pool), self.uid);
    }
  },

  /** Bullseye (owner add 2026-08-12) — Echo: summon `count` random `tribe` minion(s) from the run's set pool
   *  and SET each one's stats to `stat`/`stat`. Golden doubles the STATLINE, not the count (a gilded Bullseye
   *  summons one 14/14). Tokens/spells excluded, like `deathrattleSummonRandomTribe`. */
  deathrattleSummonRandomTribeSetStats: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = str(params.tribe);
    // Owner fix 2026-08-18: cap at the summoner's current tier (Bullseye must not roll a Tier-6 body).
    const maxTier = ctx.tierFor(self.side);
    const pool = ctx.poolCards(self.side).filter(
      (c) => !c.token && !c.spell && c.tier <= maxTier && (!tribe || c.tribe === tribe || c.tribe2 === tribe),
    );
    if (pool.length === 0) return;
    const s = num(params.stat, 7) * mul(self);
    for (let i = 0; i < num(params.count, 1); i++) {
      ctx.summon(self.side, ctx.rng.pick(pool), self.uid, undefined, false, false,
        { attack: s, health: s, maxHealth: s });
    }
  },

  /** Solaris Fang — Avenge (X): every X friendly deaths, gain a Divine Shield (Ward) and attack immediately,
   *  out of turn order (`ctx.attackNow` → the immediate-attack queue). Golden gains the shield + a second
   *  immediate strike. */
  avengeShieldAttack: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 2));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    // Gain a Ward and attack immediately. Golden strikes twice AND gains a fresh Ward before each strike (so
    // both go in shielded) — the Ward is paired with the strike in the immediate-attack queue.
    for (let i = 0; i < mul(self); i++) ctx.attackNow?.(self, true);
  },

  /** Watcher — Rally: cast Lantern of Souls (give your Undead +amount/+0 for the rest of the run — the
   *  permanent Undead aura). A REAL spell cast: `ctx.castSpell` fires the `spellCast` trigger (Spirit Pup's
   *  transform counter, Archmagus Guel, a friendly Forsaken Weaver) and carries the cast back; the grant
   *  scales with the run's spell power into BOTH stats (+3/+0 base, +5/+2 with +2/+2 spell power) like a
   *  shop-cast Lantern and rides home via `grantUndeadAura`. Golden casts it twice. Only Undead is wired
   *  (mirrors the recruit `spellGrantTribeAttack`). Fires on this minion's own attack. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyCastTribeAttack: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyCastTribeAttack(combatArena(ctx, self), params);
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────────────
  // RUNE-ONLY MINION BATCH (2026-08-20) — the combat halves. Their cards are all `token: true` (forge-only).
  // ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /** ECHO MIMIC — "Whenever another friendly minion dies, gain its Echo THIS COMBAT."
   *
   *  Grave Body's graft (`ctx.grantDeathrattle`) on a death watcher instead of a Start of Combat: the dying
   *  friend's `onDeath` effects are DEEP-copied onto the Mimic and registered, so they fire on the Mimic's own
   *  death, once, later. It subscribes to the same `onDeath` bus event a Deathrattle does and simply guards the
   *  other way round (`minion !== self`) — the shape `onFriendDeathSummon` already uses.
   *
   *  Copying can't chain: every Deathrattle factory guards `payload.minion === self`, so a grafted Echo lies
   *  dormant on the Mimic instead of re-firing on the NEXT friendly death — and a second Mimic's own effect
   *  isn't an `onDeath`-of-self, so mirroring two Mimics into each other is inert rather than recursive.
   *  A body already carrying a grafted copy of THIS card's Echoes takes another (two deaths, two Echoes) —
   *  that stacking is the card. Golden grafts each Echo twice. */
  onFriendDeathGainEcho: (ctx, self, _params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || self.health <= 0) return;
    if (!minion || minion === self || minion.side !== self.side) return;
    const echoes = minion.effects.filter((e) => e.on === 'onDeath');
    if (echoes.length === 0) return;
    for (let r = 0; r < mul(self); r++) {
      ctx.grantDeathrattle(self, echoes.map((e) => ({ ...e, ...(e.params ? { params: { ...e.params } } : {}) })));
    }
    ctx.log({ type: 'sc', source: self.uid, text: `${self.name} echoes ${minion.name}` });
  },

  /** MUSTER GENERAL — "Avenge (3): summon a 1/1 Trooper that ATTACKS IMMEDIATELY, then improve future Troopers
   *  by +1/+1 permanently."
   *
   *  `avengeSummonAttack` + `avengeImproveSummon` fused, because the two halves have to share ONE body: the
   *  improvement must land on the Trooper this trigger summons only AFTER it has been sized, and splitting them
   *  into two effects would leave their order to the effects-array — an implicit dependency that reads fine and
   *  breaks silently when someone reorders the list.
   *
   *  The accrual rides `summonBonus`, the standard per-instance channel, so it CARRIES BACK to the run board
   *  after the fight — which is what "permanently" means here — and shows in the inspect breakdown. The token
   *  strikes out of turn order through the attack-on-summon queue (`ctx.summon`'s `attackNow`), the same one
   *  Steadfast Champion's Spear Warden and the Whelps use. Golden summons a GOLDEN Trooper and improves twice. */
  avengeSummonAttackImproving: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    const seen = avengeCountFor(self, count); // a risen body counts from its rebirth
    if (seen <= 0 || seen % x !== 0) return;
    const card = ctx.getCard(str(params.cardId));
    if (!card) return;
    const token = ctx.summon(self.side, card, self.uid, undefined, self.golden, true);
    // The accrued improvement, applied to the body that just landed. `ctx.buff` (not a stat write) so the
    // gain animates and every "when a minion gains Attack" watcher sees it, like any other summon buff.
    const bonus = self.summonBonus ?? 0;
    if (token && bonus > 0) ctx.buff(token, bonus, bonus, self.uid);
    const step = num(params.step, 1) * mul(self);
    self.summonBonus = bonus + step;
    ctx.log({ type: 'improve', target: self.uid, amount: step });
  },

  /** EVOLVING ABOMINATION — "Rally: double this minion's stats. Can trigger twice per combat."
   *
   *  The cap is PER COMBAT and per instance: it rides `bredCount`, a combat-only `Minion` field (Brood Matron's
   *  per-fight breeding cap), so it resets naturally with each fresh combat body and needs no carry-back or
   *  snapshot wiring. The doubling itself is a `ctx.buff` of the CURRENT stats — so it compounds with anything
   *  that buffed the body first, and the second trigger doubles the already-doubled line (1/1 → 2/2 → 4/4).
   *  GOLDEN raises the cap rather than the multiplier: doubling twice as hard isn't a thing, so a gilded
   *  Abomination doubles FOUR times instead of two. */
  // ARENA-MIGRATED (Rally family): one body in arena.ts; the payload guard stays with dispatch.
  rallyDoubleSelf: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally: this minion's own attack only
    ARENA_EFFECTS.rallyDoubleSelf(combatArena(ctx, self), params);
  },
};

/**
 * DERIVED, no longer hand-kept (2026-08-04): a Shout resolves live in combat exactly when `FACTORIES` has an
 * entry for it — the same lookup `replayCombatBattlecry` dispatches on — so this set can never drift from the
 * dispatcher again. Consumed by settle (skip live-resolved effects when replaying a deferred card's economy
 * half) and by tests.
 */
export const COMBAT_REPLAYABLE_BATTLECRIES: ReadonlySet<string> = new Set(Object.keys(FACTORIES));
