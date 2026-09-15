/**
 * BALANCE BOT B5 — attributed effect events from ONE accepted transition.
 *
 * `effectEventsOf(before, after, action, ctx, lineage)` reads the sim's EXISTING per-action channels on `after`
 * (the reducer clears the transient ones at the top of every `reduce`, so whatever is on `after` happened during
 * THIS action) plus a few before/after diffs. It never re-runs an effect and never estimates anything — every
 * event names a thing the engine did. Direct effects only (roadmap: "Preserve direct effect attribution
 * separately from estimated long-term value").
 *
 * ── The channels this reads (keep this list current — it is the report's provenance) ──────────────────────────
 *
 *  | Channel on `after`                    | Event(s)                | Notes                                                     |
 *  |---------------------------------------|-------------------------|-----------------------------------------------------------|
 *  | `recruitBuffFx` (BuffFxEvent[])       | `buff`                  | sourceUid/targetUid/attack/health/sourceCardId, per hit    |
 *  | `shopEaten`                           | `consume`               | Shop-minion meals: eater ← eaten, gainA/gainH             |
 *  | `fodderEaten`                         | `consume` (`detail: 'fodder'`) | same mechanic family, its own channel               |
 *  | `starformFx`                          | `starform`              | one event per `toUid`; `detail` = the pull kind           |
 *  | `equipFx` (kind `use` only)           | `equipmentUsed`         | sourceId = equipmentId; its `spellIds` seed the casts     |
 *  | `spellsThisTurn` delta (+`lastSpellCastId`) | `spellCast`       | N casts this action; first named by the played card or   |
 *  |                                       |                         | `equipFx.spellIds`, the rest by `lastSpellCastId`         |
 *  | `ownedRunes` delta                    | `runePicked`            | gold = Gold paid                                          |
 *  | `hand` diff (new uids)                | `cardGained`            | route from the ACTION: buy→shop, discover→discover,       |
 *  |                                       |                         | buyRune→rune, buyQuest→quest, heroPower→hero,             |
 *  |                                       |                         | activateEquipment→equipment, else generated               |
 *  | `board` diff (new uids)               | `cardPlayed` / `summon` | the played hand card is `cardPlayed` (route = its lineage);|
 *  |                                       |                         | any OTHER new board uid is a `summon`                     |
 *  | `triplesMade` delta + a new golden uid | `cardGained` route `triple` | lineage of the golden copy = 'triple'               |
 *  | `sell` action                         | `cardSold`              | gold = Gold received; route = the card's lineage          |
 *  | `heroPower` action                    | `heroPower`             | sourceId = heroId; gold = Gold paid; detail = commission  |
 *
 * `lineage` is a caller-owned uid → route map (the recorder keeps one per seat) so a later `play` / `sell` / cast
 * can say HOW the card came to be. The map is updated in place: a uid that appears is recorded, a uid that leaves
 * the run (sold, eaten, tripled away) is dropped. Pass a throwaway `new Map()` for a single-transition read.
 */
import { CARD_INDEX } from '@game/content';
import type { Action, BoardCard, RunState, ShopCard } from '../state';
import type { EffectEvent } from './types';

export type CardLineage = Map<string, NonNullable<EffectEvent['route']>>;

export interface TransitionContext { lobbyId: string; seatId: string; round: number }

type Route = NonNullable<EffectEvent['route']>;

/** How a card that APPEARED during this action came to be, from the action that produced it. */
function routeOfAction(action: Action): Route {
  switch (action.type) {
    case 'buy': return 'shop';
    case 'buyHenchman': return 'hero';
    case 'discover': return 'discover';
    case 'buyRune': return 'rune';
    case 'buyQuest': return 'quest';
    case 'heroPower': case 'pickPower': return 'hero';
    case 'activateEquipment': return 'equipment';
    default: return 'generated';
  }
}

const cardIdOf = (run: RunState, uid: string | undefined): string | undefined => {
  if (!uid) return undefined;
  const hit = run.board.find((c) => c.uid === uid) ?? run.hand.find((c) => c.uid === uid) ?? run.shop.find((c) => c.uid === uid)
    ?? (run.spell?.uid === uid ? run.spell : undefined);
  return hit?.cardId;
};

const isSpell = (cardId: string): boolean => !!CARD_INDEX[cardId]?.spell;

export function effectEventsOf(before: RunState, after: RunState, action: Action, ctx: TransitionContext, lineage: CardLineage): EffectEvent[] {
  const out: EffectEvent[] = [];
  const base = { lobbyId: ctx.lobbyId, seatId: ctx.seatId, round: ctx.round };
  const push = (ev: Omit<EffectEvent, 'lobbyId' | 'seatId' | 'round'>): void => { out.push({ ...base, ...ev }); };
  const goldDelta = after.embers - before.embers; // + = received, − = paid
  const routeHere = routeOfAction(action);

  const beforeHand = new Map(before.hand.map((c) => [c.uid, c]));
  const beforeBoard = new Map(before.board.map((c) => [c.uid, c]));
  const played: BoardCard | undefined = action.type === 'play' ? beforeHand.get(action.uid) : undefined;
  const playedSpell = played ? isSpell(played.cardId) : false;
  const playedRoute: Route | undefined = played ? (lineage.get(played.uid) ?? 'generated') : undefined;
  const playTarget: string | undefined = action.type === 'play' ? action.targetUid : undefined;

  // ── hero power (the action itself is the event) ─────────────────────────────────────────────────────────────
  if (action.type === 'heroPower') {
    push({
      kind: 'heroPower', sourceId: after.heroId, targetUid: action.uid, targetId: cardIdOf(before, action.uid) ?? cardIdOf(after, action.uid),
      gold: goldDelta < 0 ? -goldDelta : 0, route: 'hero',
      detail: action.commission ?? (action.slot !== undefined ? `slot${action.slot}` : undefined),
    });
  }

  // ── rune picked (`ownedRunes` delta) ────────────────────────────────────────────────────────────────────────
  const runesBefore = new Set(before.ownedRunes ?? []);
  for (const id of after.ownedRunes ?? []) {
    if (!runesBefore.has(id)) push({ kind: 'runePicked', sourceId: id, gold: goldDelta < 0 ? -goldDelta : 0, route: 'rune' });
  }

  // ── equipment used (`equipFx` kind 'use') ───────────────────────────────────────────────────────────────────
  const equipSpellIds: string[] = [];
  for (const fx of after.equipFx ?? []) {
    if (fx.kind !== 'use') continue;
    push({
      kind: 'equipmentUsed', sourceId: fx.equipmentId ?? fx.cardId, sourceUid: fx.uid, targetUid: fx.targetUid,
      targetId: cardIdOf(after, fx.targetUid) ?? cardIdOf(before, fx.targetUid),
      gold: action.type === 'activateEquipment' && goldDelta < 0 ? -goldDelta : undefined, route: 'equipment',
    });
    for (const id of fx.spellIds ?? []) equipSpellIds.push(id);
  }

  // ── sold (`sell` action) ─────────────────────────────────────────────────────────────────────────────────────
  if (action.type === 'sell') {
    const card = beforeBoard.get(action.uid) ?? beforeHand.get(action.uid);
    if (card) {
      push({ kind: 'cardSold', sourceUid: card.uid, sourceId: card.cardId, gold: goldDelta > 0 ? goldDelta : 0, route: lineage.get(card.uid) ?? 'generated' });
      lineage.delete(card.uid);
    }
  }

  // ── spell casts (`spellsThisTurn` delta; names from the played card, equipment, then `lastSpellCastId`) ─────
  const castsBefore = after.wave === before.wave ? before.spellsThisTurn : 0; // the rollover resets the tally
  const casts = Math.max(0, after.spellsThisTurn - castsBefore);
  if (casts > 0) {
    const names: string[] = [];
    if (playedSpell && played) names.push(played.cardId);
    names.push(...equipSpellIds);
    while (names.length < casts) names.push(after.lastSpellCastId ?? names[names.length - 1] ?? 'unknown');
    const castRoute: Route = playedSpell ? (playedRoute ?? 'generated') : action.type === 'activateEquipment' ? 'equipment' : action.type === 'heroPower' ? 'hero' : 'other';
    for (let i = 0; i < casts; i++) {
      const fromEquip = !playedSpell && i < equipSpellIds.length;
      push({
        kind: 'spellCast', sourceId: names[i], sourceUid: playedSpell && i === 0 ? played?.uid : undefined,
        targetUid: i === 0 && action.type === 'play' ? action.targetUid : undefined,
        targetId: i === 0 && action.type === 'play' ? cardIdOf(after, action.targetUid) ?? cardIdOf(before, action.targetUid) : undefined,
        route: fromEquip ? 'equipment' : castRoute,
        detail: i > 0 && !fromEquip ? 'repeat' : undefined,
      });
    }
    if (played && playedSpell) lineage.delete(played.uid);
  } else if (played && playedSpell && !after.hand.some((c) => c.uid === played.uid)) {
    // A spell that LEFT the hand on play but did not bump the tally (a deferred Choose One target step, a
    // Gift with its own accounting): still record the play so the funnel does not lose it.
    push({ kind: 'spellCast', sourceId: played.cardId, sourceUid: played.uid, targetUid: playTarget, route: playedRoute, detail: 'untallied' });
    lineage.delete(played.uid);
  }

  // ── buffs (`recruitBuffFx`) ─────────────────────────────────────────────────────────────────────────────────
  for (const fx of after.recruitBuffFx ?? []) {
    push({
      kind: 'buff', sourceUid: fx.sourceUid, sourceId: fx.sourceCardId || (fx.kind === 'spell' ? (playedSpell ? played?.cardId : after.lastSpellCastId) : undefined),
      targetUid: fx.targetUid, targetId: cardIdOf(after, fx.targetUid), attack: fx.attack, health: fx.health,
      route: routeHere === 'generated' ? undefined : routeHere, detail: fx.kind,
    });
  }

  // ── consumes (`shopEaten` + `fodderEaten`) ──────────────────────────────────────────────────────────────────
  for (const m of after.shopEaten ?? []) {
    push({ kind: 'consume', sourceUid: m.eaterUid, sourceId: cardIdOf(after, m.eaterUid), targetUid: m.uid, targetId: m.cardId, attack: m.gainA, health: m.gainH, detail: m.silent ? 'starformCreate' : 'shop' });
    lineage.delete(m.uid);
  }
  for (const m of after.fodderEaten ?? []) {
    push({ kind: 'consume', sourceUid: m.eaterUid, sourceId: cardIdOf(after, m.eaterUid), targetId: m.fodderId, attack: m.gainA, health: m.gainH, detail: 'fodder' });
  }

  // ── Starform pulls (`starformFx`) ───────────────────────────────────────────────────────────────────────────
  for (const fx of after.starformFx ?? []) {
    const targets = fx.toUids.length ? fx.toUids : [undefined];
    for (const to of targets) {
      push({ kind: 'starform', sourceUid: fx.fromUid, sourceId: cardIdOf(before, fx.fromUid) ?? cardIdOf(after, fx.fromUid), targetUid: to, targetId: cardIdOf(after, to), detail: fx.kind });
    }
  }

  // ── cards gained (hand diff) + triples ──────────────────────────────────────────────────────────────────────
  const tripled = after.triplesMade - before.triplesMade > 0;
  for (const c of after.hand) {
    if (beforeHand.has(c.uid)) continue;
    const isTriple = tripled && !!c.golden && !beforeBoard.has(c.uid);
    const route: Route = isTriple ? 'triple' : routeHere;
    const gold = action.type === 'buy' && route === 'shop' && goldDelta < 0 ? -goldDelta : undefined;
    push({ kind: 'cardGained', sourceUid: c.uid, sourceId: c.cardId, gold, route, detail: isTriple ? 'triple' : undefined });
    lineage.set(c.uid, route);
  }

  // ── cards played / summoned (board diff) ────────────────────────────────────────────────────────────────────
  for (const c of after.board) {
    if (beforeBoard.has(c.uid)) continue;
    if (played && !playedSpell && c.uid === played.uid) {
      push({ kind: 'cardPlayed', sourceUid: c.uid, sourceId: c.cardId, targetUid: action.type === 'play' ? action.targetUid : undefined,
        targetId: action.type === 'play' ? cardIdOf(after, action.targetUid) ?? cardIdOf(before, action.targetUid) : undefined, route: playedRoute });
      continue;
    }
    if (beforeHand.has(c.uid)) {
      // Moved hand → board by something other than a direct play (a power that plays a card for you).
      push({ kind: 'cardPlayed', sourceUid: c.uid, sourceId: c.cardId, route: lineage.get(c.uid) ?? routeHere, detail: action.type });
      continue;
    }
    const isTriple = tripled && !!c.golden;
    if (isTriple) {
      push({ kind: 'cardGained', sourceUid: c.uid, sourceId: c.cardId, route: 'triple', detail: 'triple' });
      lineage.set(c.uid, 'triple');
      continue;
    }
    push({ kind: 'summon', sourceUid: played?.uid, sourceId: played?.cardId ?? (action.type === 'heroPower' ? after.heroId : undefined), targetUid: c.uid, targetId: c.cardId,
      route: routeHere === 'generated' ? 'other' : routeHere, detail: played ? 'battlecry' : action.type });
    lineage.set(c.uid, routeHere === 'generated' ? 'other' : routeHere);
  }

  // A played minion that landed and DIED in the shop (pendingDeath) never reaches `after.board` — still a play.
  if (played && !playedSpell && !after.board.some((c) => c.uid === played.uid) && !after.hand.some((c) => c.uid === played.uid)) {
    push({ kind: 'cardPlayed', sourceUid: played.uid, sourceId: played.cardId, targetUid: playTarget, route: playedRoute, detail: 'leftPlay' });
  }

  // Lineage hygiene: forget uids that are no longer anywhere in the run (tripled away, eaten, transformed).
  const live = new Set<string>([...after.hand.map((c) => c.uid), ...after.board.map((c) => c.uid), ...after.shop.map((c: ShopCard) => c.uid)]);
  for (const uid of [...lineage.keys()]) if (!live.has(uid)) lineage.delete(uid);

  return out;
}
