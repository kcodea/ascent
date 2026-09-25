/**
 * THE ANNOUNCER'S IN-FIGHT MOMENTS (the moment catalog's second batch, owner 2026-09-25: *"At the moment"* — a
 * fight line plays when its moment is SHOWN in the replay, not after the fight).
 *
 * A PURE scanner over the replay's event log, folded forward through the replay cursor (`processedEnd`, the index
 * the live frame folds through). `announcer.ts` owns the queue and the once-per-game rule; this module only says
 * which moments the newly shown events complete. It is fed a cumulative cursor, never per-event callbacks, so a
 * re-seek back rebuilds the fold from 0 (`announcer.ts` does that) and nothing counts twice.
 *
 * Every moment here is the PLAYER's: "your" minion, "their" first death. Sides come from `death` / `summon` /
 * `pummelTrigger` where the event carries one, else from the player-uid set (the opening board plus every
 * player-side summon), the same way the replay's trigger pulse tells sides apart.
 */
import { CARD_INDEX } from '@game/content';
import type { CombatEvent, Keyword, MinionSnapshot } from '@game/core';
import type { AnnouncerEvent } from './announcerSlice';

/** The catalog's thresholds, as it words them. */
export const COMBAT_MOMENT_THRESHOLDS = {
  /** Overkill: one hit of at least this much. */
  overkill: 50,
  /** ExecuteKill / ExecuteKing: an Execute kills something with at least this much Health. */
  executeKill: 50,
  executeKing: 100,
  /** AvengeBig: the Nth Avenge fire of a fight. */
  avenge: 3,
  /** EchoChain: this many Echoes (Deathrattles) in one fight. */
  echo: 5,
  /** SummonSwarm: this many minions summoned for the player in one fight. */
  summon: 10,
  /** TauntWall: this many attacks absorbed by the player's Taunt minions. */
  taunt: 5,
  /** LastStand: kills by the player's last minion standing. */
  lastStand: 3,
  /** ClutchWin / NarrowLoss: the lone survivor's Health at or below this. */
  clutchHp: 3,
  /** SameCardDuel: a shared minion of this tier. */
  duelTier: 6,
} as const;

/** The in-fight moments (a subset of the announcer's events). */
export const COMBAT_MOMENT_EVENTS = [
  'firstBlood', 'overkill', 'wardBreak', 'rebirth', 'riseBack', 'avengeBig', 'echoChain', 'summonSwarm',
  'tauntWall', 'flurry', 'pummel', 'lastStand', 'executeKill', 'executeKing', 'sameCardDuel',
] as const satisfies readonly AnnouncerEvent[];
/** The card-specific fight specials (the catalog's Special bucket), keyed on the stamped `srcCard` of the effect
 *  that fired — the sim tags every event an effect emits with its card id (`simulate.ts` effectCtx). */
export const COMBAT_SPECIAL_EVENTS = ['grimPayout', 'hanGover', 'kurseGolem', 'wolvieRise'] as const satisfies readonly AnnouncerEvent[];
export const COMBAT_SPECIAL_CARDS = { grim: 'grim', hanGover: 'dw3_hangover', kurse: 'k3_kurse', wolvie: 'b2_wolvie' } as const;
/** GrimPayout: Grim's Echo pays out with at least this many Echoes counted. */
export const GRIM_PAYOUT_ECHOES = 6;
export type CombatMoment = (typeof COMBAT_MOMENT_EVENTS)[number] | (typeof COMBAT_SPECIAL_EVENTS)[number];

/** A unit's stats at some point of the replay (the live frame's shape, narrowed). */
export interface UnitStats { uid: string; attack: number; health: number }
/** The frame at an event index — the UI's `computeFrame` — for the one moment that needs stats (WardBreak). */
export type FrameAt = (index: number) => { player: readonly UnitStats[]; enemy: readonly UnitStats[] };

interface AttackRecord { attacker: string; defender: string; killed: boolean }

/** The fold's state. Plain data; `newCombatScan` builds it from the fight's opening boards. */
export interface CombatScan {
  cursor: number;
  player: Set<string>;
  keywords: Map<string, Set<Keyword>>;
  alivePlayer: Set<string>;
  firstDeathSeen: boolean;
  avengeSteps: Set<string>;
  echoSteps: Set<string>;
  summons: number;
  tauntHits: number;
  lastDmg: Map<string, { amount: number; remainingHp: number }>;
  attacks: AttackRecord[];
  lastStand: { uid: string; kills: number } | null;
  fired: Set<CombatMoment>;
  /** SameCardDuel, decided from the opening boards; handed out on the first scan. */
  duel: boolean;
  /** Gilded bodies (GrimPayout reads a gilded Grim's doubled step). */
  golden: Set<string>;
  /** WolvieRise: the Beasts a Wolvie Echo gave Rise to this fight. */
  wolvieRise: Set<string>;
}

export function newCombatScan(initial: { player: readonly MinionSnapshot[]; enemy: readonly MinionSnapshot[] }): CombatScan {
  const keywords = new Map<string, Set<Keyword>>();
  for (const u of [...initial.player, ...initial.enemy]) keywords.set(u.uid, new Set(u.keywords));
  const enemyCards = new Set(initial.enemy.map((u) => u.cardId));
  const duel = initial.player.some((u) => enemyCards.has(u.cardId) && CARD_INDEX[u.cardId]?.tier === COMBAT_MOMENT_THRESHOLDS.duelTier);
  return {
    cursor: 0,
    player: new Set(initial.player.map((u) => u.uid)),
    keywords,
    alivePlayer: new Set(initial.player.map((u) => u.uid)),
    firstDeathSeen: false,
    avengeSteps: new Set(),
    echoSteps: new Set(),
    summons: 0,
    tauntHits: 0,
    lastDmg: new Map(),
    attacks: [],
    lastStand: null,
    fired: new Set(),
    duel,
    golden: new Set([...initial.player, ...initial.enemy].filter((u) => u.golden).map((u) => u.uid)),
    wolvieRise: new Set(),
  };
}

/** The uid an event is "from": its source when it names one, else its target. */
function actorOf(e: CombatEvent): string | undefined {
  const r = e as { source?: string; target?: string };
  return r.source ?? r.target;
}
/** A resolution's identity for counting fires: its step, else its index (synthetic logs carry no step). */
const stepKey = (e: CombatEvent, i: number): string => (e.step !== undefined ? `s${e.step}` : `i${i}`);

/**
 * Fold `events[scan.cursor, to)` into `scan` and return the moments those events complete, in the order they
 * complete. Each moment is returned at most once per scan (per fight).
 */
/** Grim's per-Echo Attack step, read off the card so a balance pass never desyncs it (3 today). */
function grimStep(): number {
  const eff = CARD_INDEX[COMBAT_SPECIAL_CARDS.grim]?.effects?.find((x) => x.do === 'deathrattleBuffTribeByTally');
  const a = (eff?.params as { attack?: unknown } | undefined)?.attack;
  return typeof a === 'number' ? a : 0;
}
const C = COMBAT_SPECIAL_CARDS;

export function scanCombat(scan: CombatScan, events: readonly CombatEvent[], to: number, frameAt?: FrameAt): CombatMoment[] {
  const out: CombatMoment[] = [];
  const hit = (m: CombatMoment): void => { if (!scan.fired.has(m)) { scan.fired.add(m); out.push(m); } };
  if (scan.duel) hit('sameCardDuel');
  const T = COMBAT_MOMENT_THRESHOLDS;
  const mine = (uid: string | undefined): boolean => !!uid && scan.player.has(uid);
  const end = Math.min(to, events.length);
  for (let i = scan.cursor; i < end; i++) {
    const e = events[i]!;
    if (e.avenge && mine(actorOf(e))) {
      scan.avengeSteps.add(stepKey(e, i));
      if (scan.avengeSteps.size >= T.avenge) hit('avengeBig');
    }
    if (e.key?.endsWith(':onDeath') && mine(actorOf(e))) {
      scan.echoSteps.add(stepKey(e, i));
      if (scan.echoSteps.size >= T.echo) hit('echoChain');
    }
    // THE FIGHT SPECIALS (the player's own cards; `srcCard` = the card whose effect emitted the event).
    const src = e.srcCard;
    if (src === C.grim && (e.type === 'buff' || e.type === 'tribeAura') && e.key?.endsWith(':onDeath')) {
      // Grim's Echo: +attack x (Echoes counted), doubled when gilded; its source body tells side and gild.
      const body = e.type === 'buff' ? e.source : undefined;
      const per = grimStep() * (body && scan.golden.has(body) ? 2 : 1);
      const mineSide = e.type === 'buff' ? mine(body) : e.side === 'player';
      if (mineSide && per > 0 && (e.attack ?? 0) / per >= GRIM_PAYOUT_ECHOES) hit('grimPayout');
    }
    if (src === C.hanGover && e.type === 'pummelTrigger' && e.side === 'player') hit('hanGover');
    if (src === C.kurse && e.type === 'summon' && e.side === 'player') hit('kurseGolem');
    if (src === C.wolvie && e.type === 'keyword' && e.keyword === 'R' && mine(e.target)) scan.wolvieRise.add(e.target);
    if (e.type === 'reborn' && !e.rebirth && scan.wolvieRise.has(e.target)) hit('wolvieRise');
    switch (e.type) {
      case 'summon': {
        scan.keywords.set(e.minion.uid, new Set(e.minion.keywords));
        if (e.minion.golden) scan.golden.add(e.minion.uid);
        if (e.side === 'player') {
          scan.player.add(e.minion.uid);
          scan.alivePlayer.add(e.minion.uid);
          scan.summons++;
          if (scan.summons >= T.summon) hit('summonSwarm');
        }
        break;
      }
      case 'keyword': scan.keywords.get(e.target)?.add(e.keyword); break;
      case 'keywordLost': scan.keywords.get(e.target)?.delete(e.keyword); break;
      case 'attack': {
        scan.attacks.push({ attacker: e.attacker, defender: e.defender, killed: false });
        if (scan.attacks.length > 2) scan.attacks.shift();
        if (mine(e.defender) && scan.keywords.get(e.defender)?.has('T')) {
          scan.tauntHits++;
          if (scan.tauntHits >= T.taunt) hit('tauntWall');
        }
        break;
      }
      case 'dmg': {
        scan.lastDmg.set(e.target, { amount: e.amount, remainingHp: e.remainingHp });
        if (e.amount >= T.overkill && mine(e.source) && !mine(e.target)) hit('overkill');
        break;
      }
      case 'poison': {
        // An Execute on an ENEMY (the player's Execute): the Health it had before the hit that procced it.
        const d = scan.lastDmg.get(e.target);
        if (!mine(e.target) && d && d.remainingHp > 0) {
          const before = d.remainingHp + d.amount;
          if (before >= T.executeKing) hit('executeKing');
          if (before >= T.executeKill) hit('executeKill');
        }
        break;
      }
      case 'shield': {
        // WardBreak: a friendly Ward absorbed a hit that would have killed (the foe it just traded with hits for at
        // least its Health). Stats come from the frame at this event; without a frame source, no verdict.
        if (!mine(e.target) || !frameAt) break;
        const last = scan.attacks[scan.attacks.length - 1];
        const foe = last && (last.attacker === e.target ? last.defender : last.defender === e.target ? last.attacker : null);
        if (!foe) break;
        const f = frameAt(i);
        const me = f.player.find((u) => u.uid === e.target);
        const them = f.enemy.find((u) => u.uid === foe);
        if (me && them && them.attack >= me.health) hit('wardBreak');
        break;
      }
      case 'reborn': {
        if (mine(e.target)) {
          scan.alivePlayer.add(e.target);
          hit(e.rebirth ? 'rebirth' : 'riseBack');
        }
        break;
      }
      case 'pummelTrigger': if (e.side === 'player') hit('pummel'); break;
      case 'death': {
        if (!scan.firstDeathSeen) {
          scan.firstDeathSeen = true;
          if (e.side === 'enemy') hit('firstBlood');
        }
        // Who landed it: the player's unit in the latest attack pairing that involved this body.
        const last = scan.attacks[scan.attacks.length - 1];
        if (last && last.defender === e.target) last.killed = true;
        if (e.side === 'player') {
          scan.alivePlayer.delete(e.target);
        } else if (last && (last.defender === e.target || last.attacker === e.target)) {
          const killer = last.defender === e.target ? last.attacker : last.defender;
          if (scan.lastStand && killer === scan.lastStand.uid) {
            scan.lastStand.kills++;
            if (scan.lastStand.kills >= T.lastStand) hit('lastStand');
          }
          // Flurry: the same Flurry minion's two latest swings, back to back, each killed its target.
          const [a, b] = scan.attacks;
          if (a && b && a.attacker === b.attacker && a.killed && b.killed && mine(b.attacker) && scan.keywords.get(b.attacker)?.has('W')) {
            hit('flurry');
          }
        }
        break;
      }
    }
    // LastStand's anchor: the moment the player is down to one minion, that minion's kills start counting.
    if (scan.alivePlayer.size === 1) {
      const [only] = scan.alivePlayer;
      if (!scan.lastStand || scan.lastStand.uid !== only) scan.lastStand = { uid: only!, kills: 0 };
    } else if (scan.alivePlayer.size > 1) {
      scan.lastStand = null;
    }
  }
  scan.cursor = Math.max(scan.cursor, end);
  return out;
}

/** The final frame's verdict moments: a win with one minion left at 3 Health or less (ClutchWin), a loss to one
 *  enemy minion at 3 Health or less (NarrowLoss). Units at 0 Health (a death still on screen) do not count. */
export function finalMoments(
  result: string | null | undefined,
  frame: { player: readonly UnitStats[]; enemy: readonly UnitStats[] },
): ('clutchWin' | 'narrowLoss')[] {
  const standing = (units: readonly UnitStats[]) => units.filter((u) => u.health > 0);
  const lone = (units: readonly UnitStats[]) => {
    const s = standing(units);
    return s.length === 1 && s[0]!.health <= COMBAT_MOMENT_THRESHOLDS.clutchHp;
  };
  if (result === 'win' && lone(frame.player)) return ['clutchWin'];
  if (result === 'lose' && lone(frame.enemy)) return ['narrowLoss'];
  return [];
}
