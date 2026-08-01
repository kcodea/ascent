import type { CombatContext, EffectDef, EffectFactoryId, Keyword, Minion, Side, Tribe } from '../types';
import {ALE_IDS, extraTriggerFires } from '../types';

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

/** Set 2 — "Play `per` Rubies on your [tribe] minions" in COMBAT: every living friend of `tribe` (or all
 *  friends if `tribe` is empty) gets `per` Ruby buffs, a Ruby being base 1/1 + this side's `rubyBonus`. The gift
 *  is PERMANENT — recorded as `permaGain` for EVERY recipient (not just Engraved ones; owner: Ruby buffs are
 *  always permanent) so it carries back to the run board via `playerPermaBuffs`. Shared by every "play Rubies"
 *  combat trigger (Start-of-Combat / Avenge / Rally). */
/** Ceiling for Sunmane Herald's doubling rally (`rallySpreadTribeBuff`). The escalation is deliberately
 *  unbounded as a design, but the arithmetic is not: ~50 rally attacks in one fight would reach Infinity and
 *  turn every downstream stat into NaN. Set far past any reachable board strength so it never binds in play. */
const RALLY_SPREAD_CAP = 1_000_000_000;

function playRubyOn(ctx: CombatContext, self: Minion, target: Minion, per: number): void {
  if (per <= 0) return;
  const rb = ctx.rubyBonusFor(self.side);
  const mult = rubyMultiplierFor(ctx, self.side); // Deepdelve Paragon
  const a = (1 + rb.attack) * per * mult;
  const h = (1 + rb.health) * per * mult;
  applyRubyStats(ctx, self, target, a, h);
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

function applyRubyStats(ctx: CombatContext, self: Minion, target: Minion, a: number, h: number): void {
  ctx.buff(target, a, h, self.uid);
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
const drakkoRepeats = (ctx: CombatContext, side: Side): number =>
  1 + extraTriggerFires('battlecry', ctx.living(side), (id) => ctx.getCard(id));

/** The Battlecry `do` ids `replayCombatBattlecry` runs IN COMBAT (they affect the live fight). Every other
 *  onPlay `do` is an economy/recruit battlecry — deferred to settle and replayed through its recruit factory.
 *  Kept in sync with the explicit branches below; `settleCombat` reads it to skip the combat ones at settle. */
export const COMBAT_REPLAYABLE_BATTLECRIES: ReadonlySet<string> = new Set([
  'battlecrySummon', 'battlecryBuffTribe', 'battlecryBuffUndeadAttack', 'battlecryGrantKeyword',
  'battlecryDiscoverSpell', 'battlecryDiscoverMinion', 'battlecryBuffSpellPower',
]);

/** Re-fire a minion's Battlecry (its `onPlay` effects) in COMBAT — used by Ryme's Deathrattle. Combat-meaningful
 *  battlecries resolve here; economy ones (Fodder/Gold/shop/gain-minion) are recorded via `ctx.deferBattlecry`
 *  and replayed through their recruit factory at settle. Magnitude respects the source's own golden. */
function replayCombatBattlecry(ctx: CombatContext, m: Minion): void {
  const g = m.golden ? 2 : 1;
  const tribeOf = (t: Minion, tribe: string): boolean =>
    !tribe || tribe === 'any' || t.tribe === tribe || t.tribe2 === tribe || !!ctx.getCard(t.cardId)?.universalTribe;
  let economy = false; // saw an onPlay effect not handled in combat → defer the card to settle
  for (const eff of m.effects) {
    if (eff.on !== 'onPlay') continue;
    const p = eff.params ?? {};
    if (eff.do === 'battlecrySummon') {
      const token = ctx.getCard(str(p.tokenId));
      if (token) for (let i = 0; i < num(p.count, 1) * g; i++) ctx.summon(m.side, token, m.uid);
    } else if (eff.do === 'battlecryBuffTribe') {
      const tribe = str(p.tribe), a = num(p.attack) * g, h = num(p.health) * g;
      const includeSelf = p.includeSelf !== false;
      for (const t of ctx.living(m.side)) if ((includeSelf || t !== m) && tribeOf(t, tribe)) ctx.buff(t, a, h, m.uid);
    } else if (eff.do === 'battlecryBuffUndeadAttack') {
      // Deathswarmer's buff is an AURA ("your Undead +Attack WHEREVER they are"), so it must be PERMANENT
      // even when Ryme re-fires it in combat — not just this fight. Buff the live Undead now (visible in the
      // replay + affects this combat) AND carry the aura back via grantUndeadBuyAtk, exactly as the recruit
      // factory stacks undeadBuyAtk. (Plain tribe Shouts above stay combat-only — only auras persist.)
      const a = num(p.amount, 1) * g;
      for (const t of ctx.living(m.side)) if (tribeOf(t, 'undead')) ctx.buff(t, a, 0, m.uid);
      ctx.grantUndeadBuyAtk(a, m.side);
    } else if (eff.do === 'battlecryGrantKeyword') {
      const kws = Array.isArray(p.keywords) ? (p.keywords as Keyword[]) : [];
      const friends = ctx.living(m.side).filter((t) => t !== m); // auto-pick the highest-Attack friend (no chosen target in combat)
      if (friends.length && kws.length) {
        const target = friends.reduce((a, b) => (b.attack > a.attack ? b : a));
        for (const kw of kws) if (!target.keywords.includes(kw)) {
          target.keywords.push(kw);
          if (kw === 'DS') target.divineShield = true;
          if (kw === 'R') target.rebornAvailable = true;
          ctx.log({ type: 'keyword', target: target.uid, keyword: kw, source: m.uid }); // the pill shows in the replay
        }
      }
    } else if (eff.do === 'battlecryDiscoverSpell') {
      // A Discover Battlecry can't open the interactive 1-of-3 peek mid-combat — grant a random pool card
      // instead (resolved at settle, respecting the tavern tier). Golden Discovers twice → grant ×2.
      ctx.grantRandomSpell(g, m.side, m.uid);
    } else if (eff.do === 'battlecryDiscoverMinion') {
      ctx.grantRandomMinion(g, str(p.tribe) || undefined, m.side, m.cardId, m.uid); // …a random minion of the tribe, ≤ tavern tier
    } else if (eff.do === 'battlecryBuffSpellPower') {
      // Cinderwing Matron — permanently raise run-wide spell power; carried back via playerSpellPower (the
      // same channel Skullblade/Gnasher use), so re-firing it in combat actually grants the spell power.
      ctx.grantSpellPower(num(p.attack) * g, num(p.health) * g, m.side, m.uid);
    } else if (eff.do === 'battlecryBuffImps') {
      // Imp Overseer — the run-wide Imp buff is an AURA, so a combat re-fire (Ryme/Drakko) must grant it IN
      // combat (not defer to settle): buff the live Imps now AND carry it back via grantImpBuff, which also
      // emits the tribeAura wash. Without this branch it fell to `economy` → deferred → no combat buff/wash,
      // the owner-reported "Imp Overseer + Ryme needs Bane" gap (Bane's own effect calls grantImpBuff).
      const a = num(p.attack) * g, h = num(p.health) * g;
      for (const t of ctx.living(m.side)) if (ctx.getCard(t.cardId)?.imp) ctx.buff(t, a, h, m.uid);
      ctx.grantImpBuff(a, h, m.side);
    } else {
      economy = true; // Fodder / Gold / shop / gain-minion — no combat surface; replayed at settle
      /* …but if the deferred Battlecry hands you a NAMED card, ANNOUNCE it now. The card really is yours —
         settleCombat re-fires the economy onPlay through the recruit factory and it lands in hand — it just
         had no event during the fight, so the replay showed nothing and the arrival FX only played once
         combat was over (owner report 2026-07-27: Ryme triggering Field Mechanic's Patch Job).

         Presentation only: this logs `toHand` WITHOUT calling ctx.grantToHand, so the card is not granted
         twice — the deferral remains the single source of truth for what you actually receive (the same
         split simulate.ts uses for a quest `rewardCardId`). Count mirrors the recruit factory's
         `count * golden` so a golden Mechanic announces both Patch Jobs.

         Only `battlecryGrantSpell`, because it is the one that names its card up front. A random grant
         (battlecryGainRandomMinion, the Discover fallbacks) can't be announced without rolling the pick
         here, and rolling it would move the rng — the replay would stop matching the settle. */
      if (eff.do === 'battlecryGrantSpell' && m.side === 'player') {
        const id = str(p.spellId);
        if (id) {
          for (let i = 0; i < num(p.count, 1) * g; i++) {
            ctx.log({ type: 'toHand', cardId: id, side: m.side, source: m.uid });
          }
        }
      }
    }
  }
  // Economy battlecries can't run in pure combat (no tavern/Gold/hand on the run state). Record the card so
  // settleCombat re-fires its economy onPlay effects through the real recruit factory. Player-only (gated in
  // ctx.deferBattlecry). Recorded once per re-fire, so Drakko's doubling carries through to the settle replay.
  if (economy) ctx.deferBattlecry(m.cardId, m.golden, m.side);
  // NB: the `battlecryTriggered` notify (procs Karwind / Bane / Sporeling) is emitted by the CALLER
  // (deathrattleReplayAdjacentBattlecry) once per re-fire — not here, or every watcher would double-proc.
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
 * Combat-time factories. This is a *partial* registry: recruit-time ids
 * (battlecries, buff-on-buy) are implemented in `@game/sim` against the run
 * board, and any effect without a combat factory here is simply inert during
 * `simulate()` (see `registerEffects`).
 */
export const FACTORIES: Partial<Record<EffectFactoryId, EffectFn>> = {
  /** Deathrattle: summon `count` copies of token `tokenId` beside self. (Echo Warden adds copies
   *  in the summon path itself — see `simulate`'s summonMinion — so it isn't applied here.) */
  deathrattleSummon: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const card = ctx.getCard(str(params.tokenId));
    // golden doubles the count (Deathless Hand 1 → 2) UNLESS `fixed` is set (Imp King keeps 2; golden lifts its buff instead)
    const total = num(params.count, 1) * (params.fixed ? 1 : mul(self));
    const kw = str(params.keyword) as Keyword | ''; // optional: grant each summoned token a keyword (Broodmother → Taunt)
    const grantKws = kw ? [kw] : undefined; // passed into summon so the keyword is in the snapshot from the start
    // `goldenTokens`: a golden summoner upgrades the TOKENS to gilded (doubled stats) instead of the count
    // (Manasaber: two 0/2 cubs → two 0/4 gilded cubs). Pair with `fixed` so the count stays put.
    const golden = !!params.goldenTokens && self.golden;
    // Attack-on-summon tokens (Twilight Whelp → Whelp) DON'T spawn inline here: ctx.summon defers each one onto
    // the immediate-attack queue so its placement + strike land at the next flushImmediateAttacks — AFTER this
    // clash's whole death cascade resolves. The queue then spawns them sequentially (summon → strike → next),
    // so the board-cap "room after the first has attacked" logic still holds; no inline flush needed.
    for (let i = 0; i < total; i++) ctx.summon(self.side, card, self.uid, grantKws, golden);
  },

  /** Nanon — Deathrattle: summon `count` tokens; every one that can't fit the full board (a `summonOverflow`)
   *  instead buffs your minions of `tribe` by +atk/+hp EACH. Golden doubles the *buff* (the summon count is
   *  fixed — a full board converts more bodies into a bigger Mech-wide pump). The gift lasts the combat. */
  deathrattleSummonOverflowBuff: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const card = ctx.getCard(str(params.tokenId));
    const total = num(params.count, 6); // fixed — golden scales the overflow buff, not the summon count
    let overflowed = 0;
    for (let i = 0; i < total; i++) {
      const before = ctx.living(self.side).length;
      ctx.summon(self.side, card, self.uid); // emits `summonOverflow` when the board is already full
      if (ctx.living(self.side).length === before) overflowed++; // didn't land → it overflowed
    }
    if (overflowed === 0) return;
    const tribe = str(params.tribe) as Tribe | '';
    const a = num(params.attack, 2) * mul(self) * overflowed; // +2/+2 per overflow (golden +4/+4)
    const h = num(params.health, 2) * mul(self) * overflowed;
    for (const m of ctx.living(self.side)) {
      if (!tribe || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
    }
  },

  /** Sporebat — Deathrattle: grant N random tavern-tier spells to your hand after combat (golden 2). The
   *  tier-bounded pick happens at settle (where the tavern tier is known); combat just banks the count. */
  deathrattleGrantRandomSpell: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.grantRandomSpell(num(params.count, 1) * mul(self), self.side, self.uid);
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
  summonBuffSelfTribe: (ctx, self, params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side || minion === self) return;
    const tribes = Array.isArray(params.tribes) ? (params.tribes as Tribe[]) : [];
    if (!tribes.includes(minion.tribe) && !(minion.tribe2 && tribes.includes(minion.tribe2)) && !ctx.getCard(minion.cardId)?.universalTribe) return;
    // Rune of Mastery: the per-spell Improve contribution counts twice. (NB: this combat half's formula
    // (base + spells) predates the recruit half's base×(1+spells) — a pre-existing divergence, flagged.)
    const spells = ctx.spellsThisTurnFor(self.side) * ctx.improveRepsFor(self.side);
    const x = (num(params.attack, 1) + spells) * mul(self);
    const y = (num(params.health, 1) + spells) * mul(self);
    ctx.buff(self, x, y, self.name);
  },

  /** Deathrattle: buff all living friends of `tribe` (+atk/+hp). */
  deathrattleBuffTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    // `tribes` (plural) buffs SEVERAL tribes in one pass — Mushy's "Beasts & Dragons". Done as one
    // aura per tribe rather than two copies of this effect on the card, so a Beast/Dragon dual-type is buffed
    // ONCE rather than twice. Falls back to the single `tribe` param every other card uses.
    const many = Array.isArray(params.tribes) ? (params.tribes as Tribe[]) : null;
    if (many) {
      const a = num(params.attack) * mul(self);
      const h = num(params.health) * mul(self);
      const hit = new Set<Minion>();
      for (const t of many) {
        ctx.addTribeAura(self.side, t, a, h, self.uid);
        for (const m of ctx.living(self.side)) {
          if ((m.tribe === t || m.tribe2 === t || ctx.getCard(m.cardId)?.universalTribe) && !hit.has(m)) hit.add(m);
        }
      }
      for (const m of hit) ctx.buff(m, a, h, self.uid);
      return;
    }
    const tribe = str(params.tribe) as Tribe | 'any';
    const attack = num(params.attack) * mul(self);
    const health = num(params.health) * mul(self);
    // "For the rest of combat": register a persistent aura so friends summoned *after* this gain it too…
    ctx.addTribeAura(self.side, tribe, attack, health, self.uid);
    // …then buff the friends already on the board.
    for (const m of ctx.living(self.side)) {
      if (tribe === 'any' || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, attack, health, self.uid);
    }
  },

  /** Deathrattle (Grim): buff your `tribe` by +`per`/+`per` per Deathrattle triggered this game (the
   *  run-wide base + this combat's player Deathrattles, snapshotted now — Grim's own death is counted).
   *  Registers a rest-of-combat aura at that magnitude, then buffs the friends already on the board.
   *  Golden doubles `per`. */
  deathrattleBuffTribeByTally: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    const amount = ctx.deathrattleTally(self.side) * num(params.per, 1) * mul(self); // per-side: enemy Grim uses the OPPONENT's tally
    ctx.addTribeAura(self.side, tribe, amount, amount, self.uid);
    for (const m of ctx.living(self.side)) {
      if (tribe === 'any' || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, amount, amount, self.uid);
    }
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
    for (let i = 0; i < mul(self); i++) {
      const targets = eff.do === 'spellBuffAll' ? ctx.living(self.side) : ctx.living(self.side).filter((m) => m !== self);
      for (const t of targets) ctx.buff(t, a, h, self.uid);
      ctx.castSpell(self.side);
    }
  },

  /** Hoardbreaker Drake (Rally): on its OWN attack, "cast Growth" — the Slaughter twin (onKillCastSpell) on the
   *  attack trigger. Buffs the board by the spell's stats + combat spell power (golden doubles) and counts as a
   *  real cast. Fires once per swing (Windfury → twice). */
  rallyCastSpell: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const spell = ctx.getCard(str(params.spellId));
    const eff = spell?.effects.find((e) => e.do === 'spellBuffAll' || e.do === 'spellBuffTarget');
    if (!eff) return;
    const sp = ctx.spellPowerFor(self.side); // per-side: enemy scales with the OPPONENT's spell power
    const a = num(eff.params?.attack, 0) + sp.attack;
    const h = num(eff.params?.health, 0) + sp.health;
    if (a <= 0 && h <= 0) return;
    for (let i = 0; i < mul(self); i++) { // golden = two genuine casts (see onKillCastSpell)
      const targets = eff.do === 'spellBuffAll' ? ctx.living(self.side) : ctx.living(self.side).filter((m) => m !== self);
      for (const t of targets) ctx.buff(t, a, h, self.uid);
      ctx.castSpell(self.side);
    }
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
    ctx.buff(ctx.rng.pick(friends), pick.attack, pick.health, self.uid); // cast the stat spell on a random friend
    ctx.castSpell(self.side); // proc in-combat spell reactions (Guel, Forsaken Weaver, Spirit Pup…) + count it
    ctx.grantToHand(pick.spellId, self.side, self.uid); // add a copy of THAT spell to your hand
  },

  /** Spark Capacitor — Avenge (N): cast a random stat spell on your lowest-Health friendly Mech (its buff +
   *  combat spell power, golden-scaled). A real cast — fires in-combat spell reactions + counts. */
  avengeCastRandomStatSpell: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 4));
    if (count % x !== 0) return;
    const mechs = ctx
      .living(self.side)
      .filter((m) => m.tribe === 'mech' || m.tribe2 === 'mech' || ctx.getCard(m.cardId)?.universalTribe);
    if (mechs.length === 0) return;
    const target = mechs.reduce((a, b) => (b.health < a.health ? b : a)); // lowest Health
    const pick = randomStatSpellBuff(ctx, mul(self), self.side);
    if (!pick) return;
    ctx.buff(target, pick.attack, pick.health, self.uid);
    ctx.castSpell(self.side); // a real spell cast — proc in-combat spell reactions + count it
  },

  /** Deathrattle (Blaster): deal `amount` to every living minion on BOTH sides (friendly included).
   *  Snapshots each side's living list first so cascading deaths don't disturb the sweep. */
  deathrattleDamageAll: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const amount = num(params.amount, 3) * mul(self);
    for (const side of ['player', 'enemy'] as Side[]) {
      for (const m of [...ctx.living(side)]) ctx.damage(m, amount);
    }
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
  scDamage: (ctx, self, params) => {
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    const targets = ctx.living(foe);
    if (targets.length === 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} strikes`, cast: true });
    const amount = num(params.amount, 1) * mul(self);
    const mode = str(params.target) || 'leftmost';
    if (mode === 'all') {
      for (const t of targets) ctx.damage(t, amount);
    } else if (mode === 'random') {
      ctx.damage(ctx.rng.pick(targets), amount);
    } else {
      ctx.damage(targets[0]!, amount);
    }
  },

  /** Bloodbinder: Start of Combat — arm Bleed. Marks `targets` enemies now (golden marks DOUBLE — 1 → 2); every
   *  `every` attacks made this combat (either side), deals this minion's Attack to those same marked enemies. */
  scArmBleed: (ctx, self, params) => {
    ctx.armBleed(self, num(params.every, 4), num(params.targets, 1) * mul(self));
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
  scEngraveNeighbor: (ctx, self, params) => {
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
      ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} engraves the line` });
    }
  },

  /** Start of Combat (Taurus the Truth Bringer): Engrave EVERY friendly minion (self included) — each keeps its
   *  combat stat-gains (carried back via `playerPermaBuffs`). "Triggers first": it runs in a priority SoC pass
   *  before the others, so later Start-of-Combat buffs are engraved too. */
  scEngraveAll: (ctx, self) => {
    for (const m of ctx.boards[self.side]) {
      if (m.dead || m.health <= 0) continue;
      if (!m.keywords.includes('EG')) m.keywords.push('EG');
    }
    ctx.log({ type: 'sc', source: self.uid, text: `${self.name} engraves the truth` });
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
  combatGrantAle: (ctx, self, params, payload) => {
    const guard = str(params.guard) || 'self';
    const p = payload as { attacker?: Minion; minion?: Minion } | undefined;
    if (guard === 'attacker' && p?.attacker !== self) return;
    if ((guard === 'rally' || guard === 'self') && p?.minion !== self) return;
    if (self.dead && guard !== 'self') return;
    const ales = ctx.poolCards(self.side).filter((c) => ALE_IDS.includes(c.id));
    if (ales.length === 0) return; // a set without the Ales grants nothing rather than injecting unreachable cards
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) {
      ctx.grantToHand(ctx.rng.pick(ales).id, self.side, self.uid);
    }
  },


  /** Lieutenant Thane — Rally: hand THIS minion's current Attack to `count` other living friendlies. Reads its
   *  Attack live, so a buffed Thane spreads more; golden repeats the whole spread. */
  rallyGiveAttackToOthers: (ctx, self, params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    const amount = self.attack;
    if (amount <= 0) return;
    // RANDOM `count` friends (owner fix 2026-07-31) — it took the left-most 3, which made board order do the
    // targeting. Distinct picks per repetition, re-rolled for the golden second pass.
    for (let r = 0; r < mul(self); r++) {
      const pool = ctx.living(self.side).filter((m) => m !== self);
      for (let n = 0; n < num(params.count, 3) && pool.length > 0; n++) {
        const m = pool.splice(ctx.rng.int(pool.length), 1)[0]!;
        ctx.buff(m, amount, 0, self.uid);
      }
    }
  },

  /**
   * Exgalloper — Echo: summon an exact copy of itself WITHOUT the Echo, so it can't chain forever.
   *
   * "Exact" means its current buffed stats, not the printed card: the copy inherits what this minion had grown
   * to. Stripping `onDeath` is what makes it terminate — a copy that kept its own Echo would summon another on
   * death, and so on until the board cap.
   */
  echoSummonCopyNoEcho: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const card = ctx.getCard(self.cardId);
    if (!card) return;
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) {
      // `copyStats` is the summon API's own channel for "inherit these stats" — mutating the returned Minion
      // afterwards is too late, because the summon event has already been emitted with the printed numbers.
      // Copy the BODY it was, not the corpse: at the moment an Echo fires, `self.health` is 0, so copying it
      // literally summons something already dead. `maxHealth` is the buffed body — the honest reading of "exact".
      const hp = Math.max(1, self.maxHealth || card.health);
      const copy = ctx.summon(self.side, card, self.uid, [...self.keywords], false, false, {
        attack: self.attack, health: hp, maxHealth: hp,
      });
      if (!copy) break; // board full
      // Drop the Echo so the copy can't summon another on ITS death, and so on to the board cap.
      copy.effects = copy.effects.filter((e) => e.on !== 'onDeath');
    }
  },

  /** Geode Guardian (owner rework 2026-07-31) — Echo: summon `count` Gemheart Golems with Taunt and play
   *  `rubies` Rubies on each. The COUNT is deliberately NOT golden-doubled (a Gilded copy still summons 2 —
   *  owner's explicit call); the Rubies are, via `playRubyOn`'s per-cast stacking. */
  deathrattleSummonGolemsWithRuby: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const golem = ctx.getCard('gemheart-shard');
    if (!golem) return;
    for (let i = 0; i < num(params.count, 2); i++) {
      const summoned = ctx.summon(self.side, golem, self.uid, ['T']);
      if (!summoned) break; // board full
      playRubyOn(ctx, self, summoned, num(params.rubies, 1) * mul(self));
    }
  },

  /**
   * Anvilshade Smith — Echo: summon a token that INHERITS this minion's Attack and swings at once.
   *
   * The token's printed Attack is a floor, not the value: it takes the Smith's Attack if that's higher, so
   * buffing the Smith buffs what its death produces. `ctx.attackNow` is the same out-of-turn-order queue the
   * Whelp uses.
   */
  echoSummonInheritAttackAndCharge: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const card = ctx.getCard(str(params.token));
    if (!card) return;
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) {
      // Both the inherited Attack and the immediate swing go through `ctx.summon`'s own parameters: the token
      // must enter the fight already carrying them, and a post-summon mutation lands after the event is emitted.
      const attack = Math.max(card.attack, self.attack);
      ctx.summon(self.side, card, self.uid, undefined, false, true, {
        attack, health: card.health, maxHealth: card.health,
      });
    }
  },

  /** Deathrattle (Arcane Weaver): add a copy of a spell to your hand after combat. Golden grants two. */
  deathrattleGrantSpell: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(str(params.cardId), self.side, self.uid);
  },

  /** Deathrattle (Sporeling): give ALL living friends +atk/+hp (golden doubles). On a true death the dying
   *  body is already excluded from living(); when Battlecry-proc'd while alive (below) it buffs itself too. */
  deathrattleBuffAll: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const a = num(params.attack, 1) * mul(self);
    const h = num(params.health, 1) * mul(self);
    for (const f of ctx.living(self.side)) ctx.buff(f, a, h, self.uid);
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
  deathrattleGrantReborn: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = str(params.tribe);
    for (let i = 0; i < mul(self); i++) {
      const candidates = ctx.living(self.side).filter((m) => {
        if (m === self || m.rebornAvailable || m.keywords.includes('R')) return false;
        if (!tribe) return true;
        const def = ctx.getCard(m.cardId);
        return m.tribe === tribe || m.tribe2 === tribe || !!def.universalTribe;
      });
      if (candidates.length === 0) return;
      const target = ctx.rng.pick(candidates);
      target.keywords.push('R');
      target.rebornAvailable = true;
      ctx.log({ type: 'keyword', target: target.uid, keyword: 'R', source: self.uid });
    }
  },

  /** Avenge (X) — Arcane Weaver: after every `count` friendly deaths, add a copy of a spell to your hand
   *  after combat (golden grants two per proc). Routed through grantToHand so the replay shows the card
   *  flying to your hand as it triggers. */
  avengeGrantSpell: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 2));
    if (count % x !== 0) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(str(params.cardId), self.side, self.uid);
  },

  /** Set 2 — Mushy (Echo): queue `count` copies of the FIRST spell you cast next turn (golden 2).
   *  Payload-guarded like every Deathrattle. The copy itself is granted in the RECRUIT phase (a spell id isn't
   *  known until you cast it), so this only banks the count — carried back via `playerNextTurnSpellCopies`. */
  deathrattleQueueNextSpellCopy: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.queueNextTurnSpellCopy(num(params.count, 1) * mul(self), self.side);
  },

  /** Set 2 — Vault Curator: Avenge (X) copies the LEFT-MOST spell in your hand into your hand again (golden 2).
   *  Reads the hand snapshot taken at combat start (`ctx.leftmostHandSpellFor`), so it copies what you actually
   *  held going in; an empty or spell-less hand is a clean no-op — no random grant. */
  avengeCopyLeftmostHandSpell: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const every = Math.max(1, num(params.count, 4));
    if (count % every !== 0) return;
    const id = ctx.leftmostHandSpellFor(self.side);
    if (!id) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(id, self.side, self.uid);
  },

  /** Set 2 — Ashen Broodlord: Avenge (X) improves your SPELLS by +atk/+hp (spell power), carried back to the
   *  run. Routes through `grantSpellPower` with `self.uid`, so it emits the `+A/+H Spell Power` narration the
   *  combat replay already rides — the flourish and the hand-spell cue both fire on the proc rather than at
   *  settle. Player-side only, enforced inside `grantSpellPower`. */
  avengeBuffSpellPower: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const every = Math.max(1, num(params.count, 4));
    if (count % every !== 0) return;
    ctx.grantSpellPower(num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.side, self.uid);
  },

  /** Avenge (X) — Professor Greg: after every `count` friendly deaths, get a random tavern-tier spell (golden
   *  grants two). Like Arcane Weaver's grant but the spell is RANDOM (via ctx.grantRandomSpell, resolved at
   *  settle where the tavern tier is known) rather than a fixed id. */
  avengeGrantRandomSpell: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    if (count % x !== 0) return;
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
    if (count % x !== 0) return;
    const card = ctx.getCard(str(params.cardId));
    if (!card) return;
    ctx.summon(self.side, card, self.uid, undefined, self.golden, true);
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
  deathrattleBuffCardTypeRunWide: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const cardId = str(params.cardId) || self.cardId;
    const a = num(params.attack, 1) * mul(self);
    const h = num(params.health, 1) * mul(self);
    ctx.grantCardBuff(cardId, a, h, self.side); // carry-back: run board / hand / future copies
    // Real-time: buff every living copy of that card still on the board this combat.
    for (const m of ctx.living(self.side)) {
      if (m.cardId === cardId) ctx.buff(m, a, h, self.uid);
    }
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
  deathrattleBuffAllByImpAura: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const imp = ctx.impAura(self.side);
    // FLOORED at +1/+1 (owner 2026-07-21): with no Imp Aura built up yet it still pays a baseline rather than
    // nothing. `impAuraGrant` mirrors this exactly for the card text — keep the two in step.
    const a = Math.max(1, imp.attack) * mul(self);
    const h = Math.max(1, imp.health) * mul(self);
    for (const m of ctx.living(self.side)) ctx.buff(m, a, h, self.uid);
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
    if (count % x !== 0) return;
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
    if (count % x !== 0) return;
    ctx.grantSpellPower(num(params.attack, 1) * mul(self), num(params.health, 0) * mul(self), self.side, self.uid);
  },

  /** Deathrattle (Junkyard Titan): add a random Magnetic minion to your hand after combat. Sibling of
   *  Arcane Weaver's grant, but the card is chosen at random (via ctx.rng) from the Magnetic-keyword
   *  minion pool (tokens/spells excluded) rather than a fixed id. Each pick is independent, so a golden's
   *  two grants can differ. Emits the same `toHand` event so the replay flies it to the hand; golden → 2.
   *  (Today the pool is Cling Drone / Money Bot / Heckbinder.) */
  deathrattleGrantMagnetic: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const pool = ctx.poolCards(self.side).filter((c) => c.keywords.includes('M') && !c.token && !c.spell);
    if (pool.length === 0) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(ctx.rng.pick(pool).id, self.side, self.uid);
  },

  /** Rally — when *this* minion attacks, buff friendly minions (+atk/+hp). With no extra params it buffs
   *  every other living friend; `tribe` restricts to that tribe (dual-types count) and `count` caps how many
   *  are hit (a random pick when there are more eligible) — Supporter: 2 friendly Dragons. */
  /** Set 2 — Packstrider (Rally): on its own attack, buff ITSELF by `attack`/`health` for every friendly
   *  `tribe` minion you control (including itself). Golden doubles the per-Beast rate. Scales with the board,
   *  so it rewards going wide. */
  rallyBuffSelfPerTribe: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return;
    const tribe = str(params.tribe);
    const count = ctx.living(self.side).filter(
      (m) => !tribe || m.tribe === tribe || m.tribe2 === tribe || !!ctx.getCard(m.cardId)?.universalTribe,
    ).length;
    if (count <= 0) return;
    ctx.buff(self, num(params.attack, 1) * mul(self) * count, num(params.health, 1) * mul(self) * count, self.uid);
  },

  rallyBuff: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const attack = num(params.attack, 1) * mul(self);
    const health = num(params.health, 1) * mul(self);
    const tribe = str(params.tribe) as Tribe | '';
    let friends = ctx.living(self.side).filter((m) => m !== self && (!tribe || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe));
    const cap = num(params.count, 0); // 0 = all eligible friends
    if (cap > 0 && friends.length > cap) {
      const pickable = [...friends];
      friends = [];
      for (let i = 0; i < cap && pickable.length > 0; i++) {
        const m = ctx.rng.pick(pickable);
        pickable.splice(pickable.indexOf(m), 1);
        friends.push(m);
      }
    }
    for (const m of friends) ctx.buff(m, attack, health, self.uid);
  },

  /** Rally (Chimerus): when THIS minion attacks, give up to 2 friendly Dragons +Health equal to its own Health.
   *  A random pick when more than 2 Dragons are eligible. Golden runs the whole hand-out TWICE (re-picks each
   *  round, so with ≥4 Dragons it can spread to more of them; with exactly 2 they get it twice). */
  rallyGiveHealthToDragons: (ctx, self, _params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    const amt = self.health;
    if (amt <= 0) return;
    for (let round = 0; round < mul(self); round++) {
      const pickable = ctx.living(self.side).filter((m) => m !== self && (m.tribe === 'dragon' || m.tribe2 === 'dragon' || ctx.getCard(m.cardId)?.universalTribe));
      for (let i = 0; i < 2 && pickable.length > 0; i++) {
        const m = ctx.rng.pick(pickable);
        pickable.splice(pickable.indexOf(m), 1);
        ctx.buff(m, 0, amt, self.uid);
      }
    }
  },

  /** Rally (Perfect Core): when THIS minion attacks, add a random spell to your hand after combat (golden → 2). */
  /** Set 2 — Chorus Drake (Rally): raise the run's SHOP-SPELL power. Spell power is the channel that makes
   *  every future Shop spell bigger, and it carries back out of combat on its own — so "your Shop Spells gain
   *  +1 Health" needs no new plumbing, just the existing grant. Rubies don't read spell power, which is why
   *  the card says Shop Spells. */
  rallyGrantSpellPower: (ctx, self, params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    ctx.grantSpellPower(num(params.attack, 0) * mul(self), num(params.health, 1) * mul(self), self.side, self.uid);
  },

  /** Set 2 — Embermouth Whelp: every Shout you trigger grows THIS body (× golden). Permanent-by-nature — it's
   *  a recruit-phase buff on the card itself, so it simply persists like any other stat gain. */
  onBattlecryBuffSelf: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side: Side }).side !== self.side) return;
    ctx.buff(self, num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.uid);
  },

  rallyGrantSpell: (ctx, self, _params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    const pool = ctx.poolCards(self.side).filter((c) => c.spell && !c.token);
    if (pool.length === 0) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(ctx.rng.pick(pool).id, self.side, self.uid);
  },

  /** Grave Body (Start of Combat / on-summon): copy your LEFTMOST living friendly Echo — graft its Deathrattle
   *  (onDeath) effects onto this minion, so they fire when it dies. Skips self; no-op if no friend has an Echo. */
  copyLeftmostEcho: (ctx, self) => {
    if (self.dead || self.health <= 0) return;
    const lead = ctx.living(self.side).find((m) => m !== self && m.effects.some((e) => e.on === 'onDeath'));
    if (!lead) return;
    const echoes = lead.effects
      .filter((e) => e.on === 'onDeath')
      .map((e) => ({ ...e, ...(e.params ? { params: { ...e.params } } : {}) }));
    ctx.grantDeathrattle(self, echoes);
  },

  /** Rally (Chorus Engine): when THIS minion attacks, buff your living Magnetic ("Attachment") minions +atk/+hp
   *  (welded attachments have merged away, so this hits unwelded ones on the board). Golden doubles. */
  rallyBuffAttachments: (ctx, self, params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    // "improve your Attachments" — the enchant-verb Improve family: ×2 under Rune of Mastery.
    const reps = ctx.improveRepsFor(self.side);
    const a = num(params.attack, 2) * mul(self) * reps;
    const h = num(params.health, 2) * mul(self) * reps;
    for (const m of ctx.living(self.side)) if (m !== self && m.keywords.includes('M')) ctx.buff(m, a, h, self.uid);
    // …and the enchant is PERMANENT, "wherever they are" (owner 2026-07-29). Combat only ever reaches the
    // UNWELDED Attachments still on the field; the carry-back applies the same grant at settle to every
    // Magnetic on the board and in hand and stacks `magneticBuyAtk/Hp`, so welded, held and future
    // Attachments all inherit it — the same contract Scrap Herald's recruit half already has.
    ctx.grantMagneticBuff(a, h, self.side);
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
  scBuffAlliesPctSelf: (ctx, self, params) => {
    const pct = num(params.pct, 50) * mul(self);
    const ga = Math.floor((self.attack * pct) / 100);
    const gh = Math.floor((self.health * pct) / 100);
    if (ga <= 0 && gh <= 0) return;
    for (const m of ctx.living(self.side)) {
      if (m !== self) ctx.buff(m, ga, gh, self.uid);
    }
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
    if (count % x !== 0) return;
    playRubies(ctx, self, num(params.rubies, 1) * mul(self), str(params.tribe));
  },

  /** Set 2 — Rally (Tunnelcharger Rikk): when THIS minion attacks, get `count` Rubies (× golden). Minted into
   *  hand after combat with the run's live rubyBonus. Fires on its own attack (Flurry → per hit). */
  rallyGetRubies: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return;
    ctx.grantRubies(num(params.count, 1) * mul(self), self.side, self.uid);
  },

  /** Set 2 — Crownvein Vanguard (half 1): Rally — when THIS attacks, buff your Rubies +atk/+hp (× golden),
   *  carried back to `rubyBonus`. */
  rallyRubyStatGain: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return;
    ctx.gainRubyBonus(num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.side, self.uid);
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
  onRallyPlayRubiesTribe: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion.side !== self.side) return;
    if (!minion.keywords.includes('RL')) return; // an ally swing is not a Rally
    const tribe = str(params.tribe);
    const per = num(params.rubies, 2) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (!tribe || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) {
        playRubyOn(ctx, self, m, per);
      }
    }
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
  onRallyBuffOnePerTribe: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion.side !== self.side) return;
    if (!minion.keywords.includes('RL')) return;
    const a = num(params.attack, 3) * mul(self);
    const h = num(params.health, 3) * mul(self);
    const living = ctx.living(self.side);
    const universal = living.filter((m) => !!ctx.getCard(m.cardId)?.universalTribe);
    const real = living.filter((m) => !ctx.getCard(m.cardId)?.universalTribe);
    const tribes: Tribe[] = [];
    for (const m of real) for (const t of [m.tribe, m.tribe2]) {
      if (t && t !== 'neutral' && !tribes.includes(t as Tribe)) tribes.push(t as Tribe);
    }
    const recipients: Minion[] = [...universal];
    for (const t of tribes) {
      const pool = real.filter((m) => m.tribe === t || m.tribe2 === t);
      if (pool.length === 0) continue;
      const pick = ctx.rng.pick(pool);
      if (!recipients.includes(pick)) recipients.push(pick);
    }
    for (const r of recipients) {
      ctx.buff(r, a, h, self.uid);
      if (!r.keywords.includes('EG')) {
        r.permaGain = { attack: (r.permaGain?.attack ?? 0) + a, health: (r.permaGain?.health ?? 0) + h };
      }
    }
  },

  /** Set 2 — Avenge (X) (Veinbreaker): after every `count` friendly deaths, buff your Rubies +atk/+hp (× golden)
   *  — raises the run's Ruby strength (carried back at settle, grows held + future Rubies). */
  avengeRubyStatGain: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    if (count % x !== 0) return;
    ctx.gainRubyBonus(num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.side, self.uid);
  },

  /** Set 2 — Gemline Martyr (half 1): Avenge (X) — get `rubies` Rubies (carried back to hand). */
  avengeGetRubies: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 2));
    if (count % x !== 0) return;
    ctx.grantRubies(num(params.rubies, 1) * mul(self), self.side, self.uid);
  },

  /** Set 2 — Gemline Martyr (half 2): Avenge (X) — play `rubies` Rubies on your LEFT-MOST living minion
   *  (permanent carry-back). */
  avengePlayRubiesLeftmost: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 2));
    if (count % x !== 0) return;
    const target = ctx.living(self.side)[0]; // left-most living friend
    if (target) playRubyOn(ctx, self, target, num(params.rubies, 1) * mul(self));
  },

  /** Set 2 — Gemheart Carver (Echo): on death, summon `tokenId` with stats equal to the Rubies on THIS minion
   *  (its `Ruby` buff; golden doubles those stats). No Rubies on it → no summon. */
  deathrattleSummonRubyStats: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    // The Shard is a 1/1 PLUS the Rubies on this minion (owner 2026-07-24) — so it summons even with none,
    // where it used to bail out entirely and give you nothing.
    const shopRuby = self.buffs?.find((b) => b.source === 'Ruby'); // Rubies played in the shop
    const gemA = (shopRuby?.attack ?? 0) + (self.rubyGain?.attack ?? 0); // + Rubies played mid-combat
    const gemH = (shopRuby?.health ?? 0) + (self.rubyGain?.health ?? 0);
    const a = (1 + gemA) * mul(self);
    const h = (1 + gemH) * mul(self);
    ctx.summon(self.side, ctx.getCard(str(params.tokenId)), self.uid, undefined, false, false, { attack: a, health: h, maxHealth: h });
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
  deathrattleRubyStatGain: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.gainRubyBonus(num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.side, self.uid);
  },

  /** Set 2 — Resonance Idol, the COMBAT half: a Ruby played on this bounces the same stats to BOTH adjacent
   *  minions (golden: twice each). Mirrors the recruit factory of the same name, so the card reads the same in
   *  the shop and mid-fight — it previously existed only in recruit, which is why a combat Ruby (Geode Guardian's
   *  Echo, Frenzied Excavator, Candle Conduit) never bounced (owner report 2026-07-25).
   *
   *  Bounces via `applyRubyStats`, NOT `playRubyOn`, so the bounced Ruby does not itself count as "a Ruby played
   *  on" the neighbour — two adjacent Idols would otherwise bounce forever. Same reasoning as the recruit half. */
  rubyPlayedBounce: (ctx, self, params, payload) => {
    const { rubyAttack, rubyHealth } = payload as { rubyAttack?: number; rubyHealth?: number };
    const a = rubyAttack ?? 0;
    const h = rubyHealth ?? 0;
    if (a <= 0 && h <= 0) return;
    const reps = self.golden ? num(params.goldenReps, 2) : 1;
    for (const adj of livingNeighbours(ctx, self)) {
      for (let r = 0; r < reps; r++) applyRubyStats(ctx, self, adj, a, h);
    }
  },

  /** Set 2 — Geode Guardian (Echo): on death, play `rubies` Rubies on EACH adjacent minion (permanent carry-back). */
  deathrattlePlayRubiesAdjacent: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const per = num(params.rubies, 1) * mul(self);
    for (const adj of livingNeighbours(ctx, self)) playRubyOn(ctx, self, adj, per);
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
  rallyGrantSelfCopy: (ctx, self, _params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(self.cardId, self.side, self.uid);
  },

  /** Mechanical Jouster — Rally: when THIS minion attacks, add a random Magnetic Mech to your hand after
   *  combat (golden 2 per attack). Mirrors Junkyard Titan's grant pool, filtered to Mech magnetics; fires on
   *  this minion's own attack (Windfury → per hit). */
  rallyGrantMagnetic: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const count = num(params.count, 1) * mul(self);
    const pool = ctx.poolCards(self.side).filter((c) => c.keywords.includes('M') && (c.tribe === 'mech' || c.tribe2 === 'mech') && !c.token && !c.spell);
    if (pool.length === 0) return;
    for (let i = 0; i < count; i++) ctx.grantToHand(ctx.rng.pick(pool).id, self.side, self.uid);
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
  onFriendlyAttackBuffTribe: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion === self || minion.side !== self.side) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    if (tribe !== 'any' && minion.tribe !== tribe && minion.tribe2 !== tribe && !ctx.getCard(minion.cardId)?.universalTribe) return;
    ctx.buff(minion, num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.uid);
  },

  /** Crypt Drake — every `every` ally attacks this combat (itself included), buff every living friend
   *  +step/+step, and every `improveEvery` attacks the grant improves by +step/+step PERMANENTLY for this
   *  copy (the accrual rides `summonBonus` — seeded from the run board, carried back at settle, live-text
   *  via the 'improve' event). Per-combat attack counter on `self.attackSeen`. Golden doubles both. */
  onAllyAttackBuffAll: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion.side !== self.side) return; // any ally's attack (self included)
    self.attackSeen = (self.attackSeen ?? 0) + 1;
    const every = Math.max(1, num(params.every, 2));
    const improveEvery = Math.max(1, num(params.improveEvery, 4));
    const step = num(params.step, 2) * mul(self);
    if (self.attackSeen % every === 0) {
      const mag = step + self.summonBonus; // base + the accrued permanent improvement
      for (const m of ctx.living(self.side)) ctx.buff(m, mag, mag, self.uid);
    }
    if (self.attackSeen % improveEvery === 0) {
      const inc = step * ctx.improveRepsFor(self.side); // Rune of Mastery: the Improve step applies twice
      self.summonBonus += inc; // "Improves every 4 attacks" — permanent for this copy (carried back)
      ctx.log({ type: 'improve', target: self.uid, amount: inc }); // → live combat text climbs
    }
  },

  /** Taragosa — when any ally attacks, "cast Growth": buff every living friend +atk/+hp (golden casts it
   *  twice). Explosive on a wide board. Growth is a REAL spell, so each cast inherits the run's spell power
   *  (`ctx.spellPower`, passed in from the run loop) on top of the base — exactly like a shop-cast Growth. */
  onAllyAttackCastGrowth: (ctx, self, params, payload) => {
    // Choose One gate, for cards where this is one BRANCH (Fatecarver). Absent `option` = ungated, so Taragosa
    // is unaffected. Fatecarver shares this factory rather than carrying a near-copy: the duplicate I wrote
    // first missed BOTH the spell-power scaling and `ctx.castSpell`, which is exactly what a near-copy costs.
    if (num(params.option, -1) >= 0 && self.chosenOption !== num(params.option, -1)) return;
    const { minion } = payload as MinionPayload;
    if (self.dead || minion.side !== self.side) return; // any ally's attack
    const sp = ctx.spellPowerFor(self.side); // per-side: an enemy Taragosa scales with the OPPONENT's spell power
    const a = num(params.attack, 3) + sp.attack;
    const h = num(params.health, 4) + sp.health;
    for (let r = 0; r < mul(self); r++) {
      ctx.castSpell(self.side); // Growth is a REAL spell cast — fires Guel + counts toward his (permanent) improvement
      for (const m of ctx.living(self.side)) ctx.buff(m, a, h, self.uid);
    }
  },

  /** Archmagus Guel (combat half) — when a friendly spell is cast mid-fight (Taragosa's Growth), give
   *  `count` other random friendly minions +atk/+hp, scaling +1/+1 per 4 spells cast so far (the running
   *  per-side tally rides in the `spellCast` payload; the triggering cast is already counted, matching the
   *  recruit half). Golden doubles. The grant is a normal combat buff (temporary) — the PERMANENT
   *  improvement comes from the cast being carried back to the run's `spellsCast` (see `ctx.castSpell`). */
  spellCastBuffOthers: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const pickable = ctx.living(self.side).filter((m) => m !== self);
    // PER-INSTANCE, matching the recruit half (owner ruling 2026-07-05, + "combat casts count toward Guel's
    // count" 2026-07-12): tick THIS Guel's on-board tally (the cast counts — tick first), improve +1/+1 per 4,
    // emit a `spellProgress` event so the live countdown updates, and carry the tally back at settle so it's
    // permanent. The run-wide `spellsCast` payload count is no longer used here.
    // Rune of Mastery: each cast's Improve tick applies twice (countdown + step derive from this tally).
    self.spellProgress = (self.spellProgress ?? 0) + ctx.improveRepsFor(self.side);
    ctx.log({ type: 'spellProgress', target: self.uid, amount: self.spellProgress });
    const step = Math.floor(self.spellProgress / 4);
    const a = (num(params.attack, 1) + step) * mul(self);
    const h = (num(params.health, 1) + step) * mul(self);
    const targets = num(params.count, 2);
    for (let i = 0; i < targets && pickable.length > 0; i++) {
      const m = ctx.rng.pick(pickable);
      pickable.splice(pickable.indexOf(m), 1);
      ctx.buff(m, a, h, self.uid);
    }
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
  onSpellCastImproveSummon: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    self.summonBonus = (self.summonBonus ?? 0) + num(params.step, 1) * ctx.improveRepsFor(self.side);
    ctx.log({ type: 'improve', target: self.uid, amount: num(params.step, 1) * ctx.improveRepsFor(self.side) });
  },

  spellCastImproveSelf: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    void params;
    // Rune of Mastery: each cast's Improve tick applies twice (the SoC Dragon grant derives from this
    // progress — Spirit Pup's transform tick above is a CAST COUNT, not an Improve, and stays ×1).
    self.spellProgress = (self.spellProgress ?? 0) + ctx.improveRepsFor(self.side);
    ctx.log({ type: 'spellProgress', target: self.uid, amount: self.spellProgress });
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
  onGainAttackBuffImproving: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only when self gains Attack
    // Our own +Attack grant would re-fire onGainAttack (infinite loop; two Hunters would ping-pong). Buff OTHERS
    // only, and bail if we're already mid-grant. `finally` clears the guard so it never leaks across turns.
    if (huntGuard.has(self)) return;
    huntGuard.add(self);
    try {
      const base = num(params.attack, 1);
      const every = Math.max(1, num(params.every, 1)); // improve once per `every` fires (Hunter: every 3)
      const fires = self.summonBonus ?? 0; // ?? 0 — recruit BoardCards may not have it seeded; counts FIRES, carried back
      const m = base * (1 + Math.floor(fires / every)) * mul(self);
      if (m > 0) for (const t of ctx.living(self.side)) if (t !== self) ctx.buff(t, m, m, self.uid);
      self.summonBonus = fires + ctx.improveRepsFor(self.side); // count this fire (×2 under Mastery), carried back
    } finally {
      huntGuard.delete(self);
    }
  },

  /** Deathsayer's Rally — when *this* attacks, fire your leftmost living minion's Deathrattle *first*
   *  (before the hit lands; `onAttack` is emitted before damage). Logs a `rally` event (source =
   *  Deathsayer, target = that minion) so the UI pauses + shows whose Deathrattle goes off, then runs
   *  that minion's onDeath effects once — it stays alive (only true `deathrattle*` effects count, not
   *  friend-death watchers like Brood Matron). Any buffs/summons it produces resolve before the attack. */
  rallyProcDeathrattle: (ctx, self, _params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return;
    const isDeathrattle = (m: Minion): boolean => m.effects.some((e) => e.on === 'onDeath' && e.do.startsWith('deathrattle'));
    const target = ctx.living(self.side).find(isDeathrattle);
    if (!target) return;
    ctx.log({ type: 'rally', source: self.uid, target: target.uid });
    // The Deathrattle procs like a real death would: once + Sylus the Reaper's extra procs (+1 per
    // Sylus, +2 golden). A *golden Deathsayer* then doubles the whole thing — it's a multiplier, so it
    // stacks multiplicatively on Sylus (e.g. golden Deathsayer + 2 Sylus = (1+2)×2 = 6 procs). Echo
    // Warden's extra tokens are already folded into the summon factories.
    const reaperBonus = ctx.living(self.side).reduce((n, m) => n + (m.cardId === 'sylus' ? (m.golden ? 2 : 1) : 0), 0);
    const procs = (1 + reaperBonus) * (self.golden ? 2 : 1);
    for (let r = 0; r < procs; r++) {
      // A rattle triggered WITHOUT a death still counts toward the tally (same rule as Sporeling's
      // Battlecry proc above) — Grim and the run's deathrattlesTriggered see every proc.
      ctx.countDeathrattle?.(target.side);
      for (const effect of target.effects) {
        if (effect.on !== 'onDeath' || !effect.do.startsWith('deathrattle')) continue;
        FACTORIES[effect.do]?.(ctx, target, effect.params ?? {}, { minion: target, side: target.side });
      }
    }
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
  overflowBuffRandom: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side?: Side }).side !== self.side) return;
    const every = Math.max(1, num(params.improveEvery, 5));
    const step = Math.floor(self.summonBonus / every);
    // `overflowBonus` is the flat top-up a TRIPLE created (golden = sum of the two highest copies' grants).
    const flat = self.overflowBonus ?? 0;
    const a = num(params.attack, 2) * (1 + step) * mul(self) + flat;
    const h = num(params.health, 2) * (1 + step) * mul(self) + flat;
    const pickable = ctx.living(self.side);
    for (let i = 0; i < num(params.count, 2) && pickable.length > 0; i++) {
      const recipient = ctx.rng.pick(pickable);
      pickable.splice(pickable.indexOf(recipient), 1);
      ctx.buff(recipient, a, h, self.uid);
      // ctx.buff already accrues permaGain for an Engraved recipient; record it here for everyone else
      // (Flowing Monk's gift is permanent regardless of the recipient's keywords).
      if (!recipient.keywords.includes('EG')) {
        recipient.permaGain = { attack: (recipient.permaGain?.attack ?? 0) + a, health: (recipient.permaGain?.health ?? 0) + h };
      }
    }
    // Log the tally increment as an `improve` (amount = +1 to the accrual, matching Kennelmaster's
    // semantics) — the replay folds it into the unit's summonBonus so the card's live text climbs in-fight.
    // Rune of Mastery doubles the Improve tick.
    const overflowInc = ctx.improveRepsFor(self.side);
    self.summonBonus += overflowInc;
    ctx.log({ type: 'improve', target: self.uid, amount: overflowInc });
  },

  /** Avenge (X): after every `count` friendly deaths in combat, buff self (+atk/+hp). */
  avengeBuff: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    if (count % x !== 0) return;
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
    if (count % x !== 0) return;
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
    if (count % x !== 0) return;
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
    if (count % x !== 0) return;
    ctx.grantBonusGold(num(params.amount, 2) * mul(self), self.side);
  },

  /** Deathrattle (Bone Taxer): permanently raise your max Gold by `amount` (golden doubles). Player-side
   *  carry-back via `CombatResult.playerMaxGoldGain` → applied to maxEmbers in settleCombat. */
  deathrattleMaxGold: (ctx, self, params, payload) => {
    // Fire ONLY on THIS minion's own death. The onDeath bus emits for every death, so without this guard Bone
    // Taxer granted max Gold on EVERY friendly death (owner-reported: "far more gold per turn"). The echo-doubler
    // re-fires pass `{ minion: self }`, so this still honors Sylus/Funeral Engine.
    if ((payload as MinionPayload).minion !== self) return;
    const gain = num(params.amount, 1) * mul(self);
    ctx.grantMaxGold(gain, self.side);
    if (self.side === 'player') ctx.log({ type: 'maxGold', target: self.uid, side: self.side, amount: gain });
  },

  /** Avenge (X) — Stuntdrake: after every `count` friendly deaths, hand `targets` other living friends a
   *  copy of THIS minion's current Attack (+atk only). A golden's bigger Attack flows through automatically;
   *  the threshold + target count are unchanged. Recipients are a random pick when more than `targets` live. */
  avengeGiveAttack: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    if (count % x !== 0) return;
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

  /** Gravewarden — Start of Combat: give a friendly (optionally `tribe`) minion, other than self, Rise. Golden
   *  grants it to two. Mirrors the Deathrattle grant but fires at combat start; skips minions that already
   *  have — or have already spent — Rise. */
  scGrantReborn: (ctx, self, params) => {
    const tribe = str(params.tribe);
    for (let i = 0; i < mul(self); i++) {
      const candidates = ctx.living(self.side).filter((m) => {
        if (m === self || m.rebornAvailable || m.keywords.includes('R')) return false;
        if (!tribe) return true;
        const def = ctx.getCard(m.cardId);
        return m.tribe === tribe || m.tribe2 === tribe || !!def?.universalTribe;
      });
      if (candidates.length === 0) return;
      const target = ctx.rng.pick(candidates);
      target.keywords.push('R');
      target.rebornAvailable = true;
      ctx.log({ type: 'keyword', target: target.uid, keyword: 'R', source: self.uid });
    }
  },

  /** Selfless Sentinel — Deathrattle: give a random other friend a Divine Shield (golden: TWO friends). */
  deathrattleGrantShield: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const count = self.golden ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const pool = ctx.living(self.side).filter((m) => m !== self && !m.divineShield);
      if (pool.length === 0) return;
      grantShield(ctx, ctx.rng.pick(pool));
    }
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
  scGrantEnemyTaunt: (ctx, self, params) => {
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    const targets = ctx.living(foe);
    if (targets.length === 0) return;
    // The minion OPPOSITE this one — the enemy at the same board index (owner change 2026-07-21; it used to
    // take the enemy's rightmost). Clamped, so a shorter enemy line still resolves to its last minion.
    // Golden also taunts an ADJACENT minion: the one to the right, falling back to the left at the end.
    const own = ctx.boards[self.side].filter((m) => !m.dead && m.health > 0);
    const idx = Math.min(Math.max(own.indexOf(self), 0), targets.length - 1);
    const picks = [targets[idx]!];
    if (self.golden) {
      const neighbour = targets[idx + 1] ?? targets[idx - 1];
      if (neighbour) picks.push(neighbour);
    }
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} works the crowd` });
    for (const victim of picks) {
      if (victim.keywords.includes('T')) continue;
      victim.keywords.push('T');
      ctx.log({ type: 'keyword', target: victim.uid, keyword: 'T', source: self.uid });
    }
  },

  /** Mirrorhide Rhino — Start of Combat: summon a copy of THIS minion's current body (stats + granted
   *  keywords). Golden summons two. Combat-summoned copies don't re-fire Start of Combat, so it never chains. */
  scSummonCopy: (ctx, self) => {
    const card = ctx.getCard(self.cardId);
    for (let i = 0; i < mul(self); i++) {
      // An exact copy of this minion's CURRENT body: keywords (Flurry, Ward…), golden, and current stats —
      // passed through `copyStats` so the summon snapshot (and the replay) shows the real values from frame 1.
      ctx.summon(self.side, card, self.uid, [...self.keywords], self.golden, false, {
        attack: self.attack,
        health: self.health,
        maxHealth: self.maxHealth,
        divineShield: self.divineShield,
        rebornAvailable: self.rebornAvailable,
      });
    }
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
  scTribeBuffPerSpellImproving: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'dragon') as Tribe;
    const step = num(params.step, 1);
    const every = Math.max(1, num(params.every, 4));
    const improve = step * Math.floor((self.spellProgress ?? 0) / every);
    // Per-side: an enemy Runescale reads the OPPONENT's spells this turn. FLOORED at 1 (owner 2026-07-21) so a
    // turn with no spells still pays the base rate rather than nothing at all.
    const spells = Math.max(1, ctx.spellsThisTurnFor(self.side));
    const a = (num(params.attack, 2) + improve) * spells * mul(self);
    const h = (num(params.health, 2) + improve) * spells * mul(self);
    if (a <= 0 && h <= 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} channels the runes` });
    for (const m of ctx.living(self.side)) {
      if (m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
    }
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
  scTribeBuffImproving: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'beast') as Tribe;
    const base = num(params.attack, 2);
    const step = num(params.step, 2);
    const mag = (base + self.summonBonus) * mul(self);
    if (mag > 0) {
      ctx.log({ type: 'sc', source: self.uid, text: `${self.name} leads the pack` });
      for (const m of ctx.living(self.side)) {
        if (m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, mag, mag, self.uid);
      }
    }
    self.summonBonus += step; // permanent +step/+step improve, carried back via playerSummonBonus
  },

  // ─── New content batch factories ────────────────────────────────────────────

  /** Trickster — Deathrattle: give a random friendly minion this minion's current maxHealth.
   *  Golden picks a target twice (independently). */
  deathrattleGiveHealth: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const hp = self.maxHealth;
    if (hp <= 0) return;
    // Give `count` random other friends this minion's Health (golden doubles the number of grants).
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) {
      const targets = ctx.living(self.side).filter((m) => m !== self);
      if (targets.length === 0) break;
      ctx.buff(ctx.rng.pick(targets), 0, hp, self.uid);
    }
  },

  /** Abhorrent Horror — Start of Combat: gain +Attack/+Health equal to all Fodder consumed this turn (read from
   *  the CombatContext, per SIDE — the player's live run state or a served enemy's captured tally). Golden
   *  doubles everything. An enemy Horror now gains the ENEMY's consumed stats (0 if its board ate none). */
  scGainFodderStats: (ctx, self, _params, _payload) => {
    const fc = ctx.fodderConsumedFor(self.side);
    const atk = fc.attack * mul(self);
    const hp = fc.health * mul(self);
    if (atk > 0 || hp > 0) {
      ctx.log({ type: 'sc', source: self.uid, text: `${self.name} absorbs the consumed essence` });
      ctx.buff(self, atk, hp, self.uid);
    }
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
  deathrattleBuffAllHealth: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const hp = num(params.health, 2) * mul(self) + (self.hpGrantBonus ?? 0);
    for (const m of ctx.living(self.side)) ctx.buff(m, 0, hp, self.uid);
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
  spellCastBuffUndeadAttack: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    const a = num(params.attack, 2) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (m.tribe !== 'undead' && m.tribe2 !== 'undead' && !ctx.getCard(m.cardId)?.universalTribe) continue;
      ctx.buff(m, a, 0, self.uid);
    }
    ctx.grantUndeadBuyAtk(a, self.side);
  },

  /** Pillager — Deathrattle: add a specific card (e.g. Gold Pouch) to the player's hand after combat.
   *  Golden grants `count`×2 copies. Carried back via CombatResult.playerHandGrants. */
  deathrattleGrantCardToHand: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const cardId = str(params.cardId);
    if (!cardId) return;
    const count = num(params.count, 1) * mul(self);
    for (let i = 0; i < count; i++) ctx.grantToHand(cardId, self.side, self.uid);
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
  onAttackStripKeywords: (ctx, self, params, payload) => {
    const { minion, target } = payload as { minion: Minion; target?: Minion };
    if (minion !== self || self.dead || !target || target.dead) return;
    const kws = Array.isArray(params.keywords) ? (params.keywords as Keyword[]) : [];
    for (const kw of kws) {
      if (!target.keywords.includes(kw)) continue;
      target.keywords = target.keywords.filter((k) => k !== kw);
      if (kw === 'R') target.rebornAvailable = false; // Rise removed → it can't come back this combat
      ctx.log({ type: 'keywordLost', target: target.uid, keyword: kw, source: self.uid });
    }
  },

  /** Thundeer (Tier 7) — whenever a friendly minion of `tribe` ATTACKS, this gains +N/+N, where N starts at
   *  `attack` and IMPROVES by `step` after every proc (the accrual rides `summonBonus`, the standard
   *  per-instance improve channel, so a triple sums the two highest accruals). Thundeer carries `'EG'`
   *  (Engraved), which is what makes the gain permanent across the run — this factory only does the growth.
   *  Golden doubles both the grant and the improve step. */
  onAllyTribeAttackBuffSelf: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion.side !== self.side) return;
    const tribe = str(params.tribe);
    if (tribe && tribe !== 'any') {
      const def = ctx.getCard(minion.cardId);
      if (minion.tribe !== tribe && minion.tribe2 !== tribe && !def?.universalTribe) return;
    }
    const base = num(params.attack, 10) * mul(self);
    const step = num(params.step, base) * mul(self);
    const mag = base + (self.summonBonus ?? 0);
    ctx.buff(self, mag, mag, self.uid);
    self.summonBonus = (self.summonBonus ?? 0) + step; // Improve this
  },

  /** Anubis (Tier 7) — Deathrattle: grant Rise to EVERY other living friendly minion that doesn't already
   *  have it. `deathrattleGrantReborn` picks ONE candidate per rep; this is the board-wide version. */
  deathrattleGrantRebornAll: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = str(params.tribe);
    for (const m of ctx.living(self.side)) {
      if (m === self || m.rebornAvailable || m.keywords.includes('R')) continue;
      if (tribe) {
        const def = ctx.getCard(m.cardId);
        if (m.tribe !== tribe && m.tribe2 !== tribe && !def?.universalTribe) continue;
      }
      m.keywords = [...m.keywords, 'R'];
      m.rebornAvailable = true;
      // A `keyword` event, not just narration — that's what makes the Rise PILL appear on the unit. Every
      // other Rise grant (Mumi, the Avenge grant) emits one; this logged `sc` text only, so the grant landed
      // in sim state but was invisible on the board, and the owner reported "none of my minions got Rise"
      // (2026-07-21). The narration stays for the combat log.
      ctx.log({ type: 'keyword', target: m.uid, keyword: 'R', source: self.uid });
      ctx.log({ type: 'sc', source: self.uid, text: `${self.name} grants ${m.name} Rise` });
    }
  },

  /** Anubis (Tier 7) — Deathrattle: cast Lantern of Souls (your `tribe` get +Attack everywhere, permanently).
   *  The Deathrattle mirror of Watcher's `rallyCastTribeAttack`: same spell-power folding, same permanent
   *  grant channel, same "counts as a real spell cast". Golden casts it twice. */
  deathrattleCastTribeAttack: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = (str(params.tribe) || 'undead') as Tribe;
    const sp = ctx.spellPowerFor(self.side);
    const a = num(params.amount, 3) + sp.attack;
    const h = sp.health;
    for (let i = 0; i < mul(self); i++) {
      ctx.castSpell(self.side); // a real cast — Spirit Pup / Guel / Forsaken Weaver all see it
      ctx.addTribeAura(self.side, tribe, a, h, self.uid);
      // Narrate the cast. The buffs alone read as "some numbers moved"; the owner couldn't tell Lantern of
      // Souls had fired at all (2026-07-21). Names the spell and its live value, spell power folded in.
      ctx.log({ type: 'sc', source: self.uid, text: `${self.name} casts Lantern of Souls (+${a}/+${h} to your ${tribe})` });
      for (const m of ctx.living(self.side)) {
        if (m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
      }
      // PERMANENT, like every other Lantern cast (owner 2026-07-27: "all lantern casts should be permanent
      // stats; Watcher uses the right utility"). `addTribeAura` above only lasts the fight, so Anubis's
      // Deathrattle Lantern evaporated at settle while the Watcher's Rally cast persisted — the same spell
      // behaving differently depending on which card cast it. `grantUndeadAura` is the run-wide Lantern
      // channel that carries back.
      if (tribe === 'undead') ctx.grantUndeadAura(a, h, self.side);
    }
  },

  /** Buff every living friendly Imp (the 1/1 Imp token) +atk/+hp, AND raise the run-wide Imp buff so the
   *  gain is PERMANENT (future Imps inherit it). Shared by Imp King (Deathrattle) and Brood Matron (Avenge).
   *  Golden doubles the per-proc amount. */
  deathrattleBuffImps: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const a = num(params.attack, 2) * mul(self);
    const h = num(params.health, 3) * mul(self);
    for (const m of ctx.living(self.side)) if (ctx.getCard(m.cardId)?.imp) ctx.buff(m, a, h, self.uid);
    ctx.grantImpBuff(a, h, self.side); // permanent — carried back to RunState.impBuff
  },

  /** Amun Rab (Tier 7) — the improving Imp buff: like `deathrattleBuffImps`, but the magnitude IMPROVES by
   *  `step` after each proc (rides `summonBonus`, the standard per-instance improve channel). Golden doubles
   *  both the grant and the step. The buff is permanent — it raises the run-wide Imp buff, so Imps summoned
   *  later inherit it. */
  deathrattleBuffImpsImproving: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const base = num(params.attack, 10) * mul(self);
    const step = num(params.step, base) * mul(self);
    const mag = base + (self.summonBonus ?? 0);
    for (const m of ctx.living(self.side)) if (ctx.getCard(m.cardId)?.imp) ctx.buff(m, mag, mag, self.uid);
    ctx.grantImpBuff(mag, mag, self.side); // permanent — carried back to RunState.impBuff
    self.summonBonus = (self.summonBonus ?? 0) + step; // Improve this
  },

  /** Brood Matron — Avenge (X): every X friendly deaths, buff your Imps +atk/+hp (permanent, carried back).
   *  Golden doubles the stat gain (the summon cap stays at 3). */
  avengeBuffImps: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const every = Math.max(1, num(params.count, 3));
    if (count % every !== 0) return;
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
  deathrattleReplayAdjacentBattlecry: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const neighbors = livingNeighbours(ctx, self).filter(hasBattlecry);
    if (neighbors.length === 0) return;
    // Base Ryme now triggers BOTH neighbours (it used to pick one at random); golden triggers each TWICE.
    // Note this no longer consumes an RNG roll on the base card — a seeded-replay-visible change, so the
    // combat goldens were re-baked with it.
    const repeats = drakkoRepeats(ctx, self.side) * (self.golden ? 2 : 1); // Drakko doubles each trigger
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
    // Golden "+2/+2 twice" = the buff applied twice (mul = 2), not one doubled grant — two visible buff pulses.
    for (let i = 0; i < mul(self); i++) {
      for (const m of ctx.living(self.side)) {
        if (tribe && tribe !== 'any' && m.tribe !== tribe && m.tribe2 !== tribe && !ctx.getCard(m.cardId)?.universalTribe) continue;
        ctx.buff(m, a, h, self.uid);
      }
    }
  },

  /** Bane (combat half) — on a triggered Battlecry, buff your living Fodder + Imps +atk/+hp, and raise BOTH
   *  the run-wide Imp buff AND the run-wide Fodder enchant (permanent — carried back) so future Fodder/Imps
   *  inherit it, exactly like the recruit-phase Bane. Golden doubles. */
  onBattlecryBuffFodder: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side: Side }).side !== self.side) return;
    const a = num(params.attack, 1) * mul(self);
    const h = num(params.health, 1) * mul(self);
    for (const m of ctx.living(self.side)) {
      const def = ctx.getCard(m.cardId);
      if (def?.keywords.includes('FD') || def?.imp) ctx.buff(m, a, h, self.uid);
    }
    ctx.grantImpBuff(a, h, self.side); // Imps permanent — carried back to RunState.impBuff
    ctx.grantFodderBuff(a, h, self.side); // Fodder enchant permanent — carried back, mirrors recruit buffFodderRunWide
  },

  // ─── 2026-07-06 content batch: Beast "wherever they are" combat auras ──────────

  /** Kennelmaster — Start of Combat: give your Beasts +N/+N (N = base + its Avenge-grown `summonBonus`) as a
   *  rest-of-combat aura. The current Beasts are buffed now; any Beast summoned LATER this fight inherits it too
   *  (`addTribeAura`, applied in summonMinion). Self is a Beast, so it's included. Golden falls out of the triple
   *  combine (checkTriples folds the doubled magnitude into `summonBonus`), so — like buffOnSummon — no `mul`. */
  scBeastAura: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'beast') as Tribe | 'any';
    // The Avenge accrual (`summonBonus`) applies PER STAT: `stepAttack`/`stepHealth` scale how much of it each
    // stat picks up, defaulting to 1 (the old symmetric behavior). Kennelmaster is Attack-only (step 1 / 0),
    // so its Avenge improvements never leak into Health.
    const a = num(params.attack, 1) + self.summonBonus * num(params.stepAttack, 1);
    const h = num(params.health, 1) + self.summonBonus * num(params.stepHealth, 1);
    if (a <= 0 && h <= 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} rallies the pack` });
    ctx.addTribeAura(self.side, tribe, a, h, self.uid);
    for (const m of ctx.living(self.side)) {
      if (tribe === 'any' || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
    }
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
  rallyTribeAuraGrowing: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const tribe = (str(params.tribe) || 'beast') as Tribe | 'any';
    const step = num(params.step, 1);
    const a = (num(params.attack, 3) + self.summonBonus) * mul(self);
    const h = (num(params.health, 3) + self.summonBonus) * mul(self);
    if (a > 0 || h > 0) {
      ctx.addTribeAura(self.side, tribe, a, h, self.uid);
      for (const m of ctx.living(self.side)) {
        if (tribe === 'any' || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
      }
    }
    const rallyInc = step * ctx.improveRepsFor(self.side); // Rune of Mastery: the Improve applies twice
    self.summonBonus += rallyInc; // "improve whenever it attacks" — the next attack grants more (live text reads this)
    ctx.log({ type: 'improve', target: self.uid, amount: rallyInc }); // fold into the live combat frame so the displayed +M/+M climbs each attack
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
  rallyDamageRandomEnemy: (ctx, self, _params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    const targets = ctx.living(foe);
    if (targets.length === 0) return;
    const bonus = self.golden ? num(_params.goldenBonus, 2) : 0;
    ctx.damage(ctx.rng.pick(targets), self.attack + bonus);
  },

  /** Baby Cub — Rally: each time THIS attacks, permanently improve your Den Mother aura by +step. Bumps every
   *  friendly Den Mother's accrued `summonBonus` (its per-summon buff magnitude), which rides the summonBonus
   *  carry-back so the bigger aura persists next combat AND in the shop. Golden doubles the step. Stored
   *  pre-Den-Mother-golden like all summonBonus, so a golden Den Mother doubles the improvement in turn. No
   *  `improve` log: that event re-applies the TARGET's golden in the UI, which would mis-count an external
   *  bump on a golden Den Mother — the value stays correct via the carry-back + shop/board re-render instead. */
  rallyImproveSummonAura: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const step = num(params.amount, 5) * mul(self);
    const targetId = str(params.cardId) || 'mamabear';
    for (const m of ctx.living(self.side)) {
      if (m === self || m.cardId !== targetId) continue;
      m.summonBonus += step;
    }
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
  rallySpreadTribeBuff: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return;
    const tribe = (str(params.tribe) || 'beast') as Tribe;
    // Printed base (the real card; 0 on a grafted body) + everything this body has been granted.
    const value = num(params.attack, 0) * mul(self) + (self.rallySpreadAtk ?? 0);
    if (value <= 0) return;
    const inTribe = (m: Minion): boolean =>
      m.tribe === tribe || m.tribe2 === tribe || !!ctx.getCard(m.cardId)?.universalTribe;
    // `attack: 0` — a converted Beast has no base of its own, only what it accumulates.
    const graft: EffectDef = { on: 'onAttack', do: 'rallySpreadTribeBuff', params: { ...(params ?? {}), attack: 0 } };
    for (const m of ctx.living(self.side)) {
      if (m === self || !inTribe(m)) continue; // never the attacker — see the note above
      ctx.buff(m, value, 0, self.uid);
      // Accumulate, so this body passes on what it has been given. Clamped: the growth is exponential in a long
      // fight and would otherwise reach Infinity and poison every downstream stat as NaN. The ceiling is far
      // past any reachable board strength, so it never binds in play.
      m.rallySpreadAtk = Math.min((m.rallySpreadAtk ?? 0) + value, RALLY_SPREAD_CAP);
      const hasRally = m.effects.some((e) => e.on === 'onAttack' && e.do === 'rallySpreadTribeBuff');
      if (!hasRally) {
        if (!m.keywords.includes('RL')) m.keywords.push('RL'); // so the UI reads it as a Rally minion
        ctx.grantDeathrattle(m, [graft]); // grafts + registers any effect, not just Echoes
      }
    }
  },

  /** Set 2 — Lancel (Start of Combat): give your LEFT-MOST `count` friendly `tribe` minions Ward, and each
   *  attacks immediately (out of turn order, via the immediate-attack queue). Golden covers two instead of one.
   *  Left-most is board order, so the pick is deterministic and consumes no RNG. */
  scShieldAttackLeftmostTribe: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'beast') as Tribe;
    const want = num(params.count, 1) * mul(self);
    const friends = ctx.living(self.side).filter(
      (m) => m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe,
    ).slice(0, want);
    if (friends.length === 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: `${self.name} sounds the charge` });
    for (const m of friends) {
      grantShield(ctx, m);
      // `attackNow: false` (Lancel, owner change 2026-07-25) — Ward only, no free opening swing.
      if (params.attackNow !== false) ctx.attackNow?.(m, false); // already shielded above — don't re-grant per strike
    }
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

  /** Set 2 — Moonlit Scavenger (Avenge half): every X friendly deaths, buff your `tribe` for the rest of the
   *  fight AND carry it back to the run ("wherever they are"). Registers the rest-of-combat aura so later
   *  summons inherit it, buffs the living ones now, and grants the permanent buy-time slice. */
  avengeBuffTribeLasting: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const every = Math.max(1, num(params.count, 3));
    if (count % every !== 0) return;
    const tribe = (str(params.tribe) || 'beast') as Tribe | 'any';
    const a = num(params.attack, 2) * mul(self);
    const h = num(params.health, 0) * mul(self);
    if (a <= 0 && h <= 0) return;
    ctx.addTribeAura(self.side, tribe, a, h, self.uid);
    for (const m of ctx.living(self.side)) {
      if (tribe === 'any' || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
    }
    // NOTE: combat-scoped. "Wherever they are" is satisfied within the fight — the `addTribeAura` above means
    // minions summoned later inherit it, not just the ones standing now. A run-wide carry-back would need a new
    // ctx accessor over `beastBuyAtkGain` (a simulate.ts local today); deliberately not invented here.
  },

  /** Set 2 — Echohorn Stag (Rally): on its own attack, trigger your LEFT-MOST friendly Echo (Deathrattle) —
   *  it stays alive, exactly like Deathsayer's `rallyProcDeathrattle`. Differs only in the pick: strictly
   *  board-order left-most (deterministic, no RNG) rather than "the first that has one" including itself.
   *  Golden triggers it twice. */
  rallyProcLeftmostEcho: (ctx, self, _params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return;
    // ANY `onDeath` effect is an Echo — not just the ones whose factory id happens to start with
    // "deathrattle". The old prefix filter is why the Stag proc'd Exgalloper via Sylus's amplifier but never
    // directly: `echoSummonCopyNoEcho`, `summonImps`, the `echoSummon*` family were all invisible to it
    // (owner report 2026-07-31, via Rune of Living Treasure).
    const target = ctx.living(self.side).find(
      (m) => m !== self && m.effects.some((e) => e.on === 'onDeath'),
    );
    if (!target) return;
    for (let r = 0; r < mul(self); r++) {
      ctx.log({ type: 'rally', source: self.uid, target: target.uid });
      ctx.countDeathrattle?.(target.side);
      for (const effect of target.effects) {
        if (effect.on !== 'onDeath') continue;
        FACTORIES[effect.do]?.(ctx, target, effect.params ?? {}, { minion: target, side: target.side });
      }
    }
  },

  /** Set 2 — Imp Wrangler (Start of Combat) / Errand Fiend (Rally): summon `count` Imps. `keyword` optionally
   *  grants them one on arrival (unused here, but the Captain's Ward path below shares the token). */
  summonImps: (ctx, self, params, payload) => {
    // On a RALLY this fires per attack, and only for this minion's own swing.
    const p = payload as MinionPayload;
    if (p.minion && p.minion !== self) return;
    const imp = ctx.getCard('impscrap');
    if (!imp) return;
    // `keyword` grants the Imps one on arrival (Endless Overseer's grafted Echo makes Warded Imps); `attack` /
    // `health` buff each one as it lands (Errand Fiend's +1/+2). Both default off, so the plain summoners are
    // unchanged.
    const kws = str(params.keyword) ? ([str(params.keyword)] as Keyword[]) : undefined;
    const a = num(params.attack, 0) * mul(self);
    const h = num(params.health, 0) * mul(self);
    for (let i = 0; i < num(params.count, 1) * mul(self); i++) {
      const born = ctx.summon(self.side, imp, self.uid, kws);
      if (born && (a > 0 || h > 0)) ctx.buff(born, a, h, self.uid);
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
  deathrattleImpsOverflowGrant: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const imp = ctx.getCard('impscrap');
    if (!imp) return;
    const total = num(params.count, 4); // fixed — golden scales the per-overflow grant, not the body count
    let overflowed = 0;
    for (let i = 0; i < total; i++) {
      const before = ctx.living(self.side).length;
      ctx.summon(self.side, imp, self.uid);
      if (ctx.living(self.side).length === before) overflowed++; // didn't land → it overflowed
    }
    if (overflowed === 0) return;
    const a = num(params.attack, 2) * mul(self) * overflowed;
    const h = num(params.health, 2) * mul(self) * overflowed;
    for (const m of ctx.living(self.side)) if (m.cardId === 'impscrap') ctx.buff(m, a, h, self.uid);
    ctx.grantImpBuff(a, h, self.side);
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
    ctx.buff(minion, (num(params.attack, 2) + bonus) * mul(self), (num(params.health, 2) + bonus) * mul(self), self.uid);
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
  onImpAttackBuffImps: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion.side !== self.side || minion.cardId !== 'impscrap') return;
    self.attackSeen = (self.attackSeen ?? 0) + 1;
    const every = Math.max(1, num(params.improveEvery, 3));
    const a = (num(params.attack, 3) + (self.summonBonus ?? 0)) * mul(self);
    for (const m of ctx.living(self.side)) if (m.cardId === 'impscrap') ctx.buff(m, a, a, self.uid);
    if (self.attackSeen % every === 0) self.summonBonus = (self.summonBonus ?? 0) + num(params.improve, 1);
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
  rallyBuffShopPermanent: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return;
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
  rallyCastShopBuffSpell: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // Rally = THIS minion swung
    const sp = ctx.spellPowerFor(self.side);
    const a = num(params.attack, 2) + sp.attack;
    const h = num(params.health, 2) + sp.health;
    for (let r = 0; r < mul(self); r++) {
      ctx.castSpell(self.side); // a REAL cast — fires Guel / Groveweaver / the spellsCast carry-back
      ctx.gainTavernBuy(a, h, self.side, self.uid);
    }
  },

  /** Set 2 — Traveling Skald: whenever a FRIENDLY minion of `tribe` attacks, give IT +atk/+hp. Watches every
   *  friend's attack, not just its own — so the payload's attacker is the target, and the Skald buffs itself
   *  only when it is the one swinging (it's a Dragon). Golden doubles. */
  onTribeAttackBuffAttacker: (ctx, self, params, payload) => {
    if (self.dead) return;
    const { minion } = payload as MinionPayload;
    if (!minion || minion.dead || minion.side !== self.side) return;
    const tribe = str(params.tribe) as Tribe;
    if (!(minion.tribe === tribe || minion.tribe2 === tribe || ctx.getCard(minion.cardId)?.universalTribe)) return;
    ctx.buff(minion, num(params.attack, 2) * mul(self), num(params.health, 1) * mul(self), self.uid);
  },

  /** Set 2 — Scalechanter (combat half): a spell cast mid-fight gives the whole side +atk. Mirrors the recruit
   *  factory so the card behaves the same whichever phase the cast happens in. */
  spellCastBuffAll: (ctx, self, params) => {
    if (self.dead) return;
    const a = num(params.attack, 1) * mul(self);
    const h = num(params.health, 0) * mul(self);
    if (a === 0 && h === 0) return;
    for (const m of ctx.living(self.side)) ctx.buff(m, a, h, self.uid);
  },

  /** Karwind (owner rework 2026-07-25): whenever a Shout triggers, give your `tribe` +atk/+hp — except this
   *  minion's two NEIGHBOURS, who get the bigger `adjAttack`/`adjHealth` INSTEAD of (not on top of) the base
   *  grant. A neighbour that isn't of the tribe gets nothing: the owner chose "instead", not "any tribe".
   *
   *  Neighbours are read off `ctx.living(self.side)` by index, which is board order — deterministic, no RNG. */
  onBattlecryBuffTribeAdjacentMore: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side: Side }).side !== self.side) return;
    const tribe = str(params.tribe) as Tribe;
    const a = num(params.attack, 2) * mul(self);
    const h = num(params.health, 2) * mul(self);
    const adjA = num(params.adjAttack, 4) * mul(self);
    const adjH = num(params.adjHealth, 4) * mul(self);
    const friends = ctx.living(self.side);
    const i = friends.indexOf(self);
    const neighbours = new Set(i < 0 ? [] : [friends[i - 1], friends[i + 1]].filter(Boolean));
    // Karwind is itself a Dragon and the original buffed it, so "your Dragons" keeps including it. It is
    // never its own neighbour, so it takes the BASE grant.
    for (const m of friends) {
      if (!(m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe)) continue;
      const adj = neighbours.has(m);
      ctx.buff(m, adj ? adjA : a, adj ? adjH : h, self.uid);
    }
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
    // stacking correctly with anything else that has already touched the body.
    ctx.buff(minion, minion.attack * mul(self), minion.health * mul(self), self.uid);
  },

  /** Set 2 — Menagerie Mammoth (owner rework 2026-07-27): every Beast you summon in combat gets +N Attack, and
   *  the grant IMPROVES PERMANENTLY — each payout raises this instance's `summonBonus`, which rides home on the
   *  `playerSummonBonus` carry-back, so the bigger grant is still there next round.
   *
   *  Attack-only by design: the Beast go-wide line already has plenty of health-stacking, and an escalating
   *  Attack grant is what makes a wide board actually close a fight. */
  onSummonTribeBuffImproveSelf: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion === self || minion.side !== self.side || minion.dead) return;
    const tribe = (str(params.tribe) || 'beast') as Tribe;
    if (!(minion.tribe === tribe || minion.tribe2 === tribe || ctx.getCard(minion.cardId)?.universalTribe)) return;
    const bonus = self.summonBonus ?? 0;
    ctx.buff(minion, (num(params.attack, 3) + bonus) * mul(self), 0, self.uid);
    self.summonBonus = bonus + num(params.step, 1); // permanent — carried back keyed to this body's sourceUid
  },

  /** Set 2 — Groveweaver (combat half): a `tribe` minion summoned DURING the fight gets the same asymmetric
   *  grant the recruit half hands out, sized by this instance's accrued `summonBonus`.
   *
   *  This half was missing entirely (owner report 2026-07-25): the factory existed only in the recruit table,
   *  so Groveweaver paid for shop summons and silently did nothing for the Echo/Rise tokens that make up most
   *  of a summon board's bodies. */
  summonBuffTribeAsym: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || !minion || minion === self || minion.side !== self.side || minion.dead) return;
    const tribe = str(params.tribe);
    if (tribe && !(minion.tribe === tribe || minion.tribe2 === tribe || ctx.getCard(minion.cardId)?.universalTribe)) return;
    const bonus = self.summonBonus ?? 0;
    const a = (num(params.attack, 2) + bonus) * mul(self);
    const h = (num(params.health, 4) + bonus) * mul(self);
    if (a <= 0 && h <= 0) return;
    ctx.buff(minion, a, h, self.uid);
  },

  /** Set 2 — Lastlight (Echo): give `count` friendly minions Ward (golden doubles).
   *
   *  Prefers minions that DON'T already have a shield — handing Ward to a shielded body is a wasted grant, and
   *  on a wide board the random pick would do that often. Falls back to the full living set only if everyone is
   *  already shielded (where it's a no-op anyway). Picks are DISTINCT: `count` is a number of minions, not a
   *  number of rolls, so the same body can't soak both. */
  deathrattleGrantWardRandom: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const pool = ctx.living(self.side).filter((m) => m !== self && !m.divineShield);
    let n = num(params.count, 2) * mul(self);
    while (n > 0 && pool.length > 0) {
      const target = ctx.rng.pick(pool);
      pool.splice(pool.indexOf(target), 1); // distinct targets
      grantShield(ctx, target);
      n--;
    }
  },


  /** Set 2 — Menagerie Mammoth (Echo): summon `count` RANDOM minions of `tribe`, drawn from the run's set pool
   *  (golden doubles the count). Seeded via the combat RNG so replays stay faithful. Tokens are excluded — a
   *  random summon should give you real bodies, not another card's summon-fodder. */
  deathrattleSummonRandomTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = str(params.tribe);
    const pool = ctx.poolCards(self.side).filter(
      (c) => !c.token && !c.spell && (!tribe || c.tribe === tribe || c.tribe2 === tribe),
    );
    if (pool.length === 0) return;
    for (let i = 0; i < num(params.count, 2) * mul(self); i++) {
      ctx.summon(self.side, ctx.rng.pick(pool), self.uid);
    }
  },

  /** Solaris Fang — Avenge (X): every X friendly deaths, gain a Divine Shield (Ward) and attack immediately,
   *  out of turn order (`ctx.attackNow` → the immediate-attack queue). Golden gains the shield + a second
   *  immediate strike. */
  avengeShieldAttack: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 2));
    if (count % x !== 0) return;
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
  rallyCastTribeAttack: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // rally: this minion's own attack only
    const undead = str(params.tribe) === 'undead';
    // Lantern of Souls grants +amount Attack and folds spell power into BOTH stats (+3/+0 base, +5/+2 with
    // +2/+2 spell power) — matching a shop-cast Lantern. Per-side: an enemy Watcher uses the OPPONENT's power.
    const sp = ctx.spellPowerFor(self.side);
    const a = num(params.amount, 3) + sp.attack;
    const h = sp.health;
    for (let i = 0; i < mul(self); i++) { // golden casts it twice
      ctx.castSpell(self.side); // counts as a real spell cast (Spirit Pup, Guel, Forsaken Weaver all see it)
      if (undead && (a > 0 || h > 0)) {
        for (const m of ctx.living(self.side)) {
          if (m.tribe === 'undead' || m.tribe2 === 'undead' || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
        }
        ctx.grantUndeadAura(a, h, self.side); // permanent — carried back, stacks the run-wide Undead aura (Lantern channel)
      }
    }
  },
};
