/**
 * THE ANNOUNCER'S PERSISTED SLICE — the part of the announcer that must survive Save & Continue.
 *
 * A LEAF module on purpose: no imports, so the store can hold and serialize this slice (next to the telemetry
 * and derivation slices) without a load-order cycle with `announcer.ts`, which imports the store's gate.
 *
 * `fired` is, per event, the WAVES it has spoken at (an array because three events may speak twice per game:
 * BackToShop, Triple and Knockout, see `announcer.ts`); `count` is how many lines the cap counts (every line except the
 * two end-of-game lines). `seed` pins it to one run: a slice restored against another seed is discarded.
 */

export type AnnouncerEvent =
  | 'gameStart'
  | 'backToShop'
  | 'equipment'
  | 'triple'
  | 'tierSix'
  | 'runeforge'
  | 'epicRuneforge'
  | 'enteringCombat'
  | 'enteringCombatAfterLoss'
  | 'startCombatUnder10hp'
  | 'surviveUnder10hp'
  | 'losingLowOddsFight'
  | 'winningLowOddsFight'
  | 'threeWinStreak'
  | 'minionHits100Stats'
  | 'topFour'
  | 'topTwo'
  | 'gameWon'
  | 'gameLoss'
  // The second batch (owner 2026-09-24).
  | 'knockout'
  | 'bigHit'
  | 'comebackWin'
  | 'flawlessVictory'
  | 'goldenArmy'
  | 'richTurn'
  | 'bigSpender'
  | 'shopBigBuff'
  | 'pair'
  | 'tribeFour'
  | 'randomSpellBuy'
  | 'randomCardBuy'
  | 'randomBeastBuy'
  | 'randomDwarfBuy'
  | 'round7'
  // The shop-clock warning (owner 2026-09-25).
  | 'timeRunningOut'
  // The specialty lines (owner 2026-09-25).
  | 'buyDrakko'
  | 'buySylus'
  | 'castAle'
  // The moment catalog's first batch (owner 2026-09-25): ElevenLabs lines, states the store already carries.
  | 'lateGame'
  | 'roundMilestone'
  | 'secondPlace'
  | 'brokeTurn'
  | 'fastTier'
  | 'sellSpree'
  | 'sellGilded'
  | 'spellChain'
  | 'tierUp'
  | 'allGolden'
  | 'bigTurn'
  | 'boardTotal'
  | 'fullBoard'
  | 'minionHits250'
  | 'armorUp'
  | 'finalShowdown'
  | 'underdogOdds'
  | 'heavyFavourite'
  | 'armorGone'
  | 'blowoutLoss'
  | 'oneResolve'
  | 'stalemate'
  | 'lobbyLast'
  | 'firstOut'
  | 'leaderboardTop'
  | 'playersRemain'
  | 'fiveWinStreak'
  | 'losingStreak'
  | 'streakBroken'
  | 'tribeFullBoard'
  | 'mixedBoard'
  // The moment catalog's second batch (owner 2026-09-25): in-fight moments, spoken as the replay shows them.
  | 'firstBlood'
  | 'overkill'
  | 'wardBreak'
  | 'rebirth'
  | 'riseBack'
  | 'avengeBig'
  | 'echoChain'
  | 'summonSwarm'
  | 'tauntWall'
  | 'flurry'
  | 'pummel'
  | 'lastStand'
  | 'executeKill'
  | 'executeKing'
  | 'sameCardDuel'
  | 'clutchWin'
  | 'narrowLoss'
  // The owner's own moment (2026-09-25, the tracker): Bob Blart and Chronos together.
  | 'blartChronos'
  // ── The moment catalog's third batch (owner 2026-09-25, group C): moments that needed new tallies / signals ──
  | 'goldRush'
  | 'refreshStreak'
  | 'discoverOpen'
  | 'firstFreeze'
  | 'tribeBuyLines'
  | 'runePayout'
  | 'runeReroll'
  | 'runeSkip'
  | 'runePick'
  | 'runeSlotsFull'
  | 'equipmentUsed'
  | 'heroPowerBig'
  | 'questComplete'
  | 'questOffered'
  | 'bothEffects'
  | 'chooseOnePlay'
  | 'bigBuffMoment'
  | 'fastTurn'
  | 'idle'
  | 'timeUp'
  | 'ghostFight'
  | 'mirrorMatch'
  | 'outgunned'
  | 'rematch'
  | 'streakStopper'
  | 'resumeGame'
  | 'darkRuby'
  | 'discoDanChain'
  | 'floRida'
  | 'goldilox'
  | 'gemheartGolem'
  | 'greatPot'
  | 'rippleResonance'
  | 'starformCollapse'
  | 'yazzusDouble'
  | 'seasonalRune';
  // ── end of the third batch ──

export interface AnnouncedSlice {
  seed: number;
  fired: Partial<Record<AnnouncerEvent, number[]>>;
  count: number;
  /** THE NO-REPEAT BAG (owner 2026-09-25: "we have a global rule to never repeat lines"): per event, the takes
   *  heard this game, in order. A take in here is not picked again this game (see `announcer.ts`). Absent on a
   *  save written before the bag existed = nothing heard yet. */
  heard?: Partial<Record<AnnouncerEvent, string[]>>;
}

export function emptyAnnounced(seed: number): AnnouncedSlice {
  return { seed, fired: {}, count: 0 };
}

/** A slice from a save is only adopted for the run it was written for. */
export function announcedFor(slice: AnnouncedSlice | null | undefined, seed: number): AnnouncedSlice {
  if (!slice || slice.seed !== seed || typeof slice.count !== 'number' || !slice.fired) return emptyAnnounced(seed);
  return slice;
}

/** The end-of-game lines (GameWon, SecondPlace, GameLoss) never expire and wait out the cooldown. */
export const UNCAPPED_EVENTS: readonly AnnouncerEvent[] = ['gameWon', 'gameLoss', 'secondPlace'];

/** Pure: the slice after `event` spoke at `wave`, playing `take` (when given). `reshuffle` empties the event's
 *  bag first: the events allowed to repeat a take once every take has been heard (see `announcer.ts`). */
export function withAnnounced(slice: AnnouncedSlice, event: AnnouncerEvent, wave: number, take?: string, reshuffle = false): AnnouncedSlice {
  const waves = [...(slice.fired[event] ?? []), wave];
  const next: AnnouncedSlice = {
    seed: slice.seed,
    fired: { ...slice.fired, [event]: waves },
    count: slice.count + (UNCAPPED_EVENTS.includes(event) ? 0 : 1),
  };
  if (take !== undefined || slice.heard) {
    const heard = { ...(slice.heard ?? {}) };
    if (take !== undefined) heard[event] = [...(reshuffle ? [] : heard[event] ?? []), take];
    next.heard = heard;
  }
  return next;
}

/** The takes of `event` heard this game (the no-repeat bag). */
export const heardTakes = (slice: AnnouncedSlice, event: AnnouncerEvent): readonly string[] => slice.heard?.[event] ?? [];

export const firedWaves = (slice: AnnouncedSlice, event: AnnouncerEvent): readonly number[] => slice.fired[event] ?? [];
export const hasFired = (slice: AnnouncedSlice, event: AnnouncerEvent): boolean => firedWaves(slice, event).length > 0;
