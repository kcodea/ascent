import type { CombatContext, EffectFactoryId, Minion, Side, Tribe } from '../types';

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

interface MinionPayload {
  minion: Minion;
  side?: Side;
}

/**
 * Combat-time factories. This is a *partial* registry: recruit-time ids
 * (battlecries, buff-on-buy) are implemented in `@game/sim` against the run
 * board, and any effect without a combat factory here is simply inert during
 * `simulate()` (see `registerEffects`).
 */
export const FACTORIES: Partial<Record<EffectFactoryId, EffectFn>> = {
  /** Deathrattle: summon `count` copies of token `tokenId` beside self. */
  deathrattleSummon: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const card = ctx.getCard(str(params.tokenId));
    const count = num(params.count, 1);
    for (let i = 0; i < count; i++) ctx.summon(self.side, card, self.uid);
  },

  /** When a friendly minion of `tribe` is summoned, buff it (+atk/+hp). */
  buffOnSummon: (ctx, self, params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side || minion === self) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    if (tribe !== 'any' && minion.tribe !== tribe) return;
    ctx.buff(minion, num(params.attack), num(params.health), self.uid);
  },

  /** Deathrattle: buff all living friends of `tribe` (+atk/+hp). */
  deathrattleBuffTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    const attack = num(params.attack);
    const health = num(params.health);
    for (const m of ctx.living(self.side)) {
      if (tribe === 'any' || m.tribe === tribe) ctx.buff(m, attack, health, self.uid);
    }
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
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} strikes` });
    const amount = num(params.amount, 1);
    const mode = str(params.target) || 'leftmost';
    if (mode === 'all') {
      for (const t of targets) ctx.damage(t, amount);
    } else if (mode === 'random') {
      ctx.damage(ctx.rng.pick(targets), amount);
    } else {
      ctx.damage(targets[0]!, amount);
    }
  },

  /** Deal damage equal to self's Attack, as 1-damage hits split across random enemies. */
  scSplitDamage: (ctx, self, params) => {
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    if (ctx.living(foe).length === 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} splits its breath` });
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
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} rains fire` });
    const base = num(params.base, 3);
    const per = num(params.perTribe, 3);
    const tribe = str(params.tribe) as Tribe;
    for (const t of ctx.living(foe)) ctx.damage(t, base);
    const others = ctx.living(self.side).filter((m) => m !== self && m.tribe === tribe).length;
    for (let i = 0; i < others; i++) {
      const targets = ctx.living(foe);
      if (targets.length === 0) break;
      ctx.damage(ctx.rng.pick(targets), per);
    }
  },

  // --- Undead (combat-time Deathrattle / on-death value) ---

  /** Deathrattle (Sporeling): buff a random living friend. */
  deathrattleBuffRandom: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    ctx.buff(ctx.rng.pick(friends), num(params.attack), num(params.health), self.uid);
  },

  /** Rot Weaver: each time another friend dies, buff a random living friend. */
  onFriendDeathBuffRandom: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion === self || minion.side !== self.side) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    ctx.buff(ctx.rng.pick(friends), num(params.attack), num(params.health), self.uid);
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
};
