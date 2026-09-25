/**
 * THE ANNOUNCER (owner ask 2026-09-23): *"i added announcer sfx here … I named them for when they should
 * trigger. they shouldn't trigger more than once per game, though. and they shouldn't trigger back to back for
 * things like equipment or triples etc."* Plus: *"we'll need an announcer toggle and audio channel as well,
 * similar to music."*
 *
 * One-shot voice lines on game moments, driven from the store like the music (`syncAnnouncer(state, prev)`
 * on every store update, React-free) and spoken through a PRIORITY QUEUE, not a FIFO:
 *
 *  · ONCE PER EVENT PER RUN, tracked in the store's `announced` slice (persisted with the autosave, keyed by the
 *    run seed, reset by every new run) so a Save & Continue never replays a line. Three events may speak twice
 *    (BackToShop and Triple at least ANNOUNCER_REPEAT_GAP_WAVES waves apart, Knockout at least
 *    ANNOUNCER_KNOCKOUT_GAP_WAVES apart). Exceptions added 2026-09-25: the generic random buy lines speak up to
 *    ANNOUNCER_RANDOM_BUY_MAX times (ANNOUNCER_RANDOM_BUY_GAP_WAVES apart), and TimeRunningOut every Shop turn.
 *  · The VARIANT (which take) is a fresh RANDOM pick every time (owner 2026-09-25: "random pick every time, no
 *    seeds") from the takes NOT YET HEARD this game: THE NO-REPEAT BAG (owner 2026-09-25: "we have a global rule to
 *    never repeat lines except maybe the generic random buys sometimes?"). The bag is the slice's `heard`, persisted
 *    like `fired`, so a Save & Continue keeps it. An event whose every take has been heard goes SILENT for the rest
 *    of the game, except the REUSABLE_BAG events (the four generic random buys and TimeRunningOut), which
 *    reshuffle and start over.
 *  · THE CHANCE TABLE (`ANNOUNCER_CHANCE` in announcerConfig.ts, a Chance dial per event in the Announcer tuner):
 *    below 1, an event's moment rolls a SEEDED chance from the run seed + event + wave + index (`announcerRoll`),
 *    so a replay rolls the same way. The generic buy lines 6% per qualifying buy, Round 7 10%, everything else 1.
 *  · SPECIALTY lines (SPECIALTY_EVENTS: a named card bought, an Ale cast) speak the first time the thing happens
 *    in a game; a dropped one tries again the next time, at most as many tries as it has takes.
 *  · A GLOBAL COOLDOWN: no line within ANNOUNCER_COOLDOWN_MS of the previous one, and never while a line is
 *    playing. An event that lands inside the cooldown is DROPPED, not queued (that is what stops the Equipment →
 *    Triple → TierSix chatter on one turn). A dropped event stays unfired: it may speak later if its moment
 *    recurs (BackToShop, a later Equipment) and is still valid (TierSix cannot recur).
 *  · PRIORITY with a SHELF LIFE: when several events are pending at once the highest priority speaks and the
 *    rest are dropped; combat lines expire when the next shop opens, shop lines when combat starts; the two
 *    end-of-game lines never expire and wait out the cooldown.
 *  · TIMING: the Face Omen lines wait ANNOUNCER_FACE_OMEN_DELAY_MS after the flip, the return-to-shop lines (and a
 *    forge that opens with the return) ANNOUNCER_BACK_TO_SHOP_DELAY_MS after `resolveCombat` (owner 2026-09-23:
 *    "they play too quickly and should be offset by about 1s").
 *  · SILENCE RULES: nothing in the first ANNOUNCER_COMBAT_SILENCE_MS of a combat resolution; nothing over the
 *    music's turn-1 fade-in (GameStart waits until ANNOUNCER_GAME_START_DELAY_MS); never on the title, in a
 *    tutorial, a sandbox rig or a replay; a Skip (`stopAllAudio`) or leaving the run cancels the queue and the
 *    playing line at once (ANNOUNCER_STOP_FADE_MS).
 *  · NO per-game line cap (owner 2026-09-25: "we can remove a max number of things the announcer says, as long as we
 *    have the cooldown and stuff"). The cooldown, once-per-event rule, priority and shelf life keep it from chattering.
 *
 * AUDIO: its OWN channel — a third gain on the SFX AudioContext (like the music's), with its own volume + mute
 * (`ascent.announcervol.v2`, `ascent.announcermuted`; the slider defaults to 50, which plays gain 0.7), NOT ducked by the Game-sounds mute or slider.
 * The clips are PUBLIC files (`apps/web/public/announcer/`), fetched + decoded LAZILY on first need into a
 * cached buffer (never the eager `import.meta.glob` bank in sfx.ts). Without Web Audio an HTMLAudioElement per
 * line carries the level. Lines never overlap each other.
 */
import { CARD_INDEX } from '@game/content';
import { ALE_IDS, type Tribe } from '@game/core';
import {
  boardIntel, chooseBothActive, chooseBothStateOf, CONFIG, defIsTribe, lossDamageCap, offerBuyStats, playerOpponent, type PreparedBoard, type RunLobby,
  type RunState, type ShopCard,
} from '@game/sim';
import { runeTally } from './runeTally';
import { DEFAULT_SLIDER, sliderToGain } from './audio/volumeCurve';
import { ANNOUNCER_CHANCE, announcerEventChance, announcerEventOffset, announcerEventVolume, announcerLineGain } from './announcerConfig';
import { isMusicWanted, MUSIC_FADE_MS, MUSIC_START_DELAY_MS, type MusicStateLike } from './music';
import { COMBAT_MOMENT_EVENTS, finalMoments, newCombatScan, scanCombat, type CombatScan, type FrameAt, type UnitStats } from './announcerCombat';
import type { CombatEvent, MinionSnapshot } from '@game/core';
import {
  type AnnouncedSlice, type AnnouncerEvent, announcedFor, firedWaves, hasFired, heardTakes, UNCAPPED_EVENTS, withAnnounced,
} from './announcerSlice';

export type { AnnouncerEvent } from './announcerSlice';
export { ANNOUNCER_CHANCE } from './announcerConfig';

// ── The constants (one name each; the tests and the devlog read these) ──────────────────────────────────────
/** No line within this of the previous one ending. THE cooldown. */
export const ANNOUNCER_COOLDOWN_MS = 12_000;
/** Lines per game, GameWon / GameLoss excepted. 8 at first; the owner raised it to 15 with the second batch of
 *  lines (2026-09-24). */
/** GameStart: after the first shop lands, past the music's 3 s start + its fade-in. */
export const ANNOUNCER_GAME_START_DELAY_MS = MUSIC_START_DELAY_MS + 1000;
/** No line over the music's turn-1 fade-in: the quiet window after a wave-1 run lands. */
export const ANNOUNCER_TURN_ONE_QUIET_MS = MUSIC_START_DELAY_MS + MUSIC_FADE_MS;
/** Nothing in the first 3 s of a combat resolution (the lines detected DURING the fight: the verdict lines, the
 *  combat board stat). The Face Omen lines are the entry itself and sit inside this window on purpose. */
export const ANNOUNCER_COMBAT_SILENCE_MS = 3000;
/** The Face Omen lines (EnteringCombat / AfterLoss / StartCombatUnder10hp) wait out the combat-start stinger +
 *  wipe. 600 ms at first; the owner heard them "too quickly" and asked for about a second more (2026-09-23). */
export const ANNOUNCER_FACE_OMEN_DELAY_MS = 1600;
/** The return-to-shop lines (BackToShop, TopFour / TopTwo, a forge opening WITH the return) wait out the return
 *  wipe. They used to fire the instant `resolveCombat` landed (~30 ms); same owner ask, about a second later. */
export const ANNOUNCER_BACK_TO_SHOP_DELAY_MS = 1000;
/** GameWon / GameLoss: into the rank / post-game screen. */
export const ANNOUNCER_END_DELAY_MS = 1000;
/** Equipment: let the equipment SFX land first. */
export const ANNOUNCER_EQUIPMENT_DELAY_MS = 400;
/** A cancelled line's fade (Skip, leaving the run). */
export const ANNOUNCER_STOP_FADE_MS = 100;
/** "Under 10 hp": Resolve at or below this, Armor not counted. */
export const ANNOUNCER_LOW_RESOLVE = 10;
/** Losing a fight the odds gave the player at least this. */
export const ANNOUNCER_HIGH_ODDS = 0.65;
/** Winning a fight the odds gave the player at most this. */
export const ANNOUNCER_LOW_ODDS = 0.35;
/** A minion at or above this Attack or Health. */
export const ANNOUNCER_BIG_STAT = 100;
/** BackToShop: at most this many per game, the first no earlier than this wave. */
export const ANNOUNCER_BACK_TO_SHOP_MAX = 2;
export const ANNOUNCER_BACK_TO_SHOP_MIN_WAVE = 2;
/** Triple: at most this many per game. */
export const ANNOUNCER_TRIPLE_MAX = 2;
/** A repeatable event's second line comes at least this many waves after its first. */
export const ANNOUNCER_REPEAT_GAP_WAVES = 5;
/** Knockout: at most this many per game, the second at least this many waves after the first. */
export const ANNOUNCER_KNOCKOUT_MAX = 2;
export const ANNOUNCER_KNOCKOUT_GAP_WAVES = 1;
/** BigHit: the damage your win deals the opposing hero (round-capped, what the hero actually takes) at or above this. */
export const ANNOUNCER_BIG_HIT = 15;
/** ComebackWin: a win right after at least this many losses in a row. */
export const ANNOUNCER_COMEBACK_LOSSES = 3;
/** FlawlessVictory: a win with no friendly minion dying, from this wave on. */
export const ANNOUNCER_FLAWLESS_MIN_WAVE = 5;
/** GoldenArmy: this many gilded minions on the board at once. */
export const ANNOUNCER_GOLDEN_ARMY = 3;
/** RichTurn: a Shop turn that opens with at least this much Gold. */
export const ANNOUNCER_RICH_GOLD = 20;
/** BigSpender: at least this much Gold spent this turn while still holding at least ANNOUNCER_BIG_SPENDER_LEFT. */
export const ANNOUNCER_BIG_SPENDER_SPENT = 20;
export const ANNOUNCER_BIG_SPENDER_LEFT = 10;
/** ShopBigBuff: a Shop minion offer at MORE than this Attack. */
export const ANNOUNCER_SHOP_BIG_ATTACK = 50;
/** TribeFour: this many minions of one tribe bought in one Shop turn. */
export const ANNOUNCER_TRIBE_BUYS = 4;
/** The generic buy lines' chance per qualifying buy: 6% (owner 2026-09-25, was 10%). The live value is the tuner's
 *  `ANNOUNCER_CHANCE` table (announcerConfig.ts); this is its default, exported for the tests. */
export const ANNOUNCER_RARE_CHANCE = ANNOUNCER_CHANCE.randomCardBuy;
/** The generic random buy lines: up to this many per game, at least ANNOUNCER_RANDOM_BUY_GAP_WAVES apart (owner
 *  2026-09-25: the one exception to the no-repeat rule). */
export const ANNOUNCER_RANDOM_BUY_MAX = 3;
export const ANNOUNCER_RANDOM_BUY_GAP_WAVES = 2;
/** The generic random buy events. */
export const RANDOM_BUY_EVENTS: readonly AnnouncerEvent[] = ['randomCardBuy', 'randomSpellBuy', 'randomBeastBuy', 'randomDwarfBuy'];
/** Events that RESHUFFLE their no-repeat bag once every take has been heard (every other event goes silent). */
export const REUSABLE_BAG_EVENTS: readonly AnnouncerEvent[] = [...RANDOM_BUY_EVENTS, 'timeRunningOut'];
/** The SPECIALTY lines: a named card or rune, an Ale. First time it happens, retried when dropped (see the header). */
export const SPECIALTY_EVENTS: readonly AnnouncerEvent[] = ['buyDrakko', 'buySylus', 'castAle'];
/** The named cards the specialty buy lines listen for, by CARD ID (ids never change on a rename). `drummer` is the
 *  shop minion named Drakko (there is also a HERO named Drakko; a hero is never bought, so it cannot trigger this);
 *  `sylus` is the shop minion Sylus (Rune of Sylus grants one at the Runeforge, which is not a buy). */
export const ANNOUNCER_NAMED_BUYS: Readonly<Record<string, AnnouncerEvent>> = { drummer: 'buyDrakko', sylus: 'buySylus' };
/** Round7: the wave whose Shop may (rarely) say it. */
export const ANNOUNCER_ROUND_SEVEN = 7;
/** TimeRunningOut: the Shop clock's seconds left that trigger it, EVERY Shop turn (owner 2026-09-25: "the running
 *  out of time can play everytime theres 15 seconds left"). */
export const ANNOUNCER_TIME_WARNING_SECONDS = 15;
/** EnteringCombat is "the first Face Omen": if the first one is dropped it may still speak up to this wave. */
export const ANNOUNCER_ENTERING_COMBAT_MAX_WAVE = 3;

// ── The moment catalog's first batch (owner 2026-09-25): thresholds as the catalog words them ─────────────────
/** LateGame: the game passes this round (the Shop of the round after it opens). */
export const ANNOUNCER_LATE_GAME_ROUND = 18;
/** RoundMilestone: these rounds' Shops. */
export const ANNOUNCER_ROUND_MILESTONES: readonly number[] = [10, 15, 20];
/** BrokeTurn: ending a Shop turn with 0 Gold and nothing bought, after this round. */
export const ANNOUNCER_BROKE_AFTER_WAVE = 5;
/** FastTier: tier 4 by round 5, or tier 6 by round 9. */
export const ANNOUNCER_FAST_TIERS: readonly { tier: number; byWave: number }[] = [{ tier: 4, byWave: 5 }, { tier: 6, byWave: 9 }];
/** SellSpree: this many minions sold in one Shop turn. */
export const ANNOUNCER_SELL_SPREE = 4;
/** SpellChain: this many spells cast in one Shop turn. */
export const ANNOUNCER_SPELL_CHAIN = 4;
/** BigTurn: this many cards played in one Shop turn. */
export const ANNOUNCER_BIG_TURN = 5;
/** BoardTotal: the board's summed Attack + Health passes these (in order; each a separate moment). */
export const ANNOUNCER_BOARD_TOTALS: readonly number[] = [500, 1000];
/** A full board. */
export const ANNOUNCER_BOARD_SLOTS = 7;
/** MinionHits250: a minion at or above this Attack or Health. */
export const ANNOUNCER_HUGE_STAT = 250;
/** ArmorUp: Armor at or above this. */
export const ANNOUNCER_ARMOR_UP = 20;
/** UnderdogOdds / HeavyFavourite: entering a fight under / over these win odds. */
export const ANNOUNCER_UNDERDOG_ODDS = 0.2;
export const ANNOUNCER_FAVOURITE_ODDS = 0.9;
/** LobbyLast / LeaderboardTop: only after this round. */
export const ANNOUNCER_STANDINGS_AFTER_WAVE = 8;
/** PlayersRemain: someone else is knocked out and exactly one of these many remain. */
export const ANNOUNCER_PLAYERS_REMAIN: readonly number[] = [5, 3];
/** FiveWinStreak: this many wins in a row. */
export const ANNOUNCER_FIVE_STREAK = 5;
/** LosingStreak: this many losses in a row. */
export const ANNOUNCER_LOSING_STREAK = 2;
/** StreakBroken: a loss ending a win streak at least this long. */
export const ANNOUNCER_STREAK_BROKEN = 3;
/** MixedBoard: a full board spanning at least this many different tribes. */
export const ANNOUNCER_MIXED_TRIBES = 5;

// ── The moment catalog's third batch (owner 2026-09-25, group C): thresholds as the catalog words them ─────────
/** GoldRush: this much Gold gained from effects in one Shop turn (a sale's base value and turn income are not effects). */
export const ANNOUNCER_GOLD_RUSH = 10;
/** RefreshStreak: the Nth Refresh of one Shop turn. */
export const ANNOUNCER_REFRESH_STREAK = 5;
/** DiscoverOpen: a Discover of these tier minions always speaks (every other Discover rolls the chance table). */
export const ANNOUNCER_DISCOVER_ALWAYS_TIER = 6;
/** RunePayout: a counter rune (one with a live `x/N` tally) paying out for this many times in a game. */
export const ANNOUNCER_RUNE_PAYOUTS = 3;
/** RuneSlotsFull: the player's rune sockets (the two open ones and the chained third, QuestBadges.tsx). */
export const ANNOUNCER_RUNE_SOCKETS = 3;
/** HeroPowerBig: hero power uses in one game. */
export const ANNOUNCER_HERO_POWER_BIG = 10;
/** BigBuffMoment: one effect's buff on one minion, at least this much Attack AND Health. */
export const ANNOUNCER_BIG_BUFF = 20;
/** FastTurn: ending a turn with at least this many seconds left, after at least ANNOUNCER_FAST_TURN_BUYS buys. */
export const ANNOUNCER_FAST_TURN_SECONDS = 40;
export const ANNOUNCER_FAST_TURN_BUYS = 3;
/** Idle: this many seconds of Shop clock with no action. */
export const ANNOUNCER_IDLE_SECONDS = 20;
/** Outgunned: the foe's tier at least this far above the player's. */
export const ANNOUNCER_OUTGUNNED_TIERS = 2;
/** StreakStopper: beating a foe on a win streak at least this long. */
export const ANNOUNCER_STREAK_STOPPER = 3;
/** Goldilox: grown PAST this much Attack and Health above its printed stats, in hand. */
export const ANNOUNCER_GOLDILOX_GROWTH = 20;
/** GemheartGolem: this many Gemheart Golems on the board. */
export const ANNOUNCER_GOLEM_ARMY = 3;
/** StarformCollapse: a collapsed Starform over this much Attack. */
export const ANNOUNCER_STARFORM_ATTACK = 30;
/** RippleResonance: a Ripple Ruby's landings on one cast (Ripple doubles each cast, Resonance casts it twice). */
export const ANNOUNCER_RIPPLE_LANDINGS = 4;
/** The cards the third batch's special lines key on, by CARD ID (found by name in the tests; ids never change). */
export const ANNOUNCER_BATCH_3_CARDS = {
  floRida: 'b2_florida', goldilox: 'dw3_goldilox', golem: 'gemheart-shard', greatPot: 'greatpot', picnic: 'sp_picnic',
  starform: 'ce3_starform', yazzus: 'yazzus', darkRuby: 'dark-ruby', rippleRuby: 'ripple-ruby',
} as const;
export const ANNOUNCER_BATCH_3_RUNES = { resonance: 'rune_resonance', happyBirthday: 'rune_happy_birthday' } as const;
/** TribeBuyLines / MirrorMatch: the tribe the one approved take names ("Another Kobold for the hoard.", "Kobold
 *  against Kobold!"). The other tribes speak once they have takes of their own. */
export const ANNOUNCER_TAKE_TRIBE: Tribe = 'kobold';
/** The Announcer slider's storage key. `.v2` since the default-mix curve (owner 2026-09-24): the stored value is a
 *  SLIDER position that `sliderToGain('announcer', …)` turns into the gain, so the old `ascent.announcervol` (a raw
 *  gain) is no longer read and every player starts once on the new default, the 50 mark (= the owner's 0.7 gain). */
const ANNOUNCER_VOLUME_KEY = 'ascent.announcervol.v2';

/** The clips, per event, in variant order. Files live at `<BASE_URL>announcer/<name>.mp3`. NEW EVENTS GO AT THE
 *  END (the rare-line rolls still hash an event's index in this table). Which take plays is a fresh random pick. */
export const ANNOUNCER_LINES: Record<AnnouncerEvent, readonly string[]> = {
  // 25 takes (owner 2026-09-25: the StartGame folder, byte/audio duplicates dropped). Which take plays is picked at random each time.
  gameStart: Array.from({ length: 25 }, (_, i) => `game-start-${i + 1}`),
  backToShop: ['back-to-shop-1', 'back-to-shop-2', 'back-to-shop-3'],
  equipment: ['equipment-1', 'equipment-2'],
  triple: ['triple-1', 'triple-2'],
  tierSix: ['tier-six-1', 'tier-six-2'],
  runeforge: ['runeforge-1', 'runeforge-2'],
  epicRuneforge: ['epic-runeforge-1', 'epic-runeforge-2'],
  // 7 takes (owner 2026-09-25: five ElevenLabs takes from the Entering Combat folder joined the first two).
  enteringCombat: Array.from({ length: 7 }, (_, i) => `entering-combat-${i + 1}`),
  enteringCombatAfterLoss: ['entering-combat-after-loss'],
  startCombatUnder10hp: ['start-combat-under-10hp'],
  surviveUnder10hp: ['survive-under-10hp'],
  losingLowOddsFight: ['losing-low-odds-fight-1', 'losing-low-odds-fight-2'],
  winningLowOddsFight: ['winning-low-odds-fight-1', 'winning-low-odds-fight-2'],
  threeWinStreak: ['three-win-streak-1', 'three-win-streak-2'],
  minionHits100Stats: ['minion-hits-100-stats'],
  topFour: ['top-four-1', 'top-four-2'],
  topTwo: ['top-two-1'],
  gameWon: ['game-won'],
  gameLoss: ['game-loss-1', 'game-loss-2', 'game-loss-3'],
  // The second batch (owner 2026-09-24).
  knockout: ['knockout-1', 'knockout-2', 'knockout-3', 'knockout-4'],
  bigHit: ['big-hit'],
  comebackWin: ['comeback-win'],
  flawlessVictory: ['flawless-victory'],
  goldenArmy: ['golden-army'],
  richTurn: ['rich-turn'],
  bigSpender: ['big-spender'],
  shopBigBuff: ['shop-big-buff'],
  pair: ['pair-1', 'pair-2'],
  tribeFour: ['tribe-four'],
  randomSpellBuy: ['random-spell-buy-1', 'random-spell-buy-2'],
  // RandomCardBuy1 + the seven 'Buying Cards/Any' takes (owner 2026-09-25).
  randomCardBuy: ['random-card-buy', ...Array.from({ length: 7 }, (_, i) => `random-card-buy-${i + 2}`)],
  randomBeastBuy: ['random-beast-buy'],
  randomDwarfBuy: ['random-dwarf-buy'],
  round7: ['round-7'],
  // The shop-clock warning (owner 2026-09-25): 21 takes from the Low on time folder, in folder timestamp order.
  timeRunningOut: Array.from({ length: 21 }, (_, i) => `time-running-out-${i + 1}`),
  // The specialty lines (owner 2026-09-25): the Special folder. BuyingDrakko / BuyingDrakko2 first, then the
  // ElevenLabs takes in folder timestamp order.
  buyDrakko: Array.from({ length: 5 }, (_, i) => `buy-drakko-${i + 1}`),
  buySylus: Array.from({ length: 4 }, (_, i) => `buy-sylus-${i + 1}`),
  castAle: Array.from({ length: 6 }, (_, i) => `cast-ale-${i + 1}`),
  // The moment catalog's first batch (owner 2026-09-25): one ElevenLabs take each (the catalog's example line,
  // generated with the owner's cloned announcer voice). A moment the catalog lets recur (TierUp, RoundMilestone,
  // BoardTotal) speaks once until it gets more takes: the no-repeat bag goes silent when its takes run out.
  lateGame: ['late-game-1'],
  roundMilestone: ['round-milestone-1'],
  secondPlace: ['second-place-1'],
  brokeTurn: ['broke-turn-1'],
  fastTier: ['fast-tier-1'],
  sellSpree: ['sell-spree-1'],
  sellGilded: ['sell-gilded-1'],
  spellChain: ['spell-chain-1'],
  tierUp: ['tier-up-1'],
  allGolden: ['all-golden-1'],
  bigTurn: ['big-turn-1'],
  boardTotal: ['board-total-1'],
  fullBoard: ['full-board-1'],
  minionHits250: ['minion-hits-250-1'],
  armorUp: ['armor-up-1'],
  finalShowdown: ['final-showdown-1'],
  underdogOdds: ['underdog-odds-1'],
  heavyFavourite: ['heavy-favourite-1'],
  armorGone: ['armor-gone-1'],
  blowoutLoss: ['blowout-loss-1'],
  oneResolve: ['one-resolve-1'],
  stalemate: ['stalemate-1'],
  lobbyLast: ['lobby-last-1'],
  firstOut: ['first-out-1'],
  leaderboardTop: ['leaderboard-top-1'],
  playersRemain: ['players-remain-1'],
  fiveWinStreak: ['five-win-streak-1'],
  losingStreak: ['losing-streak-1'],
  streakBroken: ['streak-broken-1'],
  tribeFullBoard: ['tribe-full-board-1'],
  mixedBoard: ['mixed-board-1'],
  // The moment catalog's second batch (owner 2026-09-25): in-fight moments, one ElevenLabs take each.
  firstBlood: ['first-blood-1'],
  overkill: ['overkill-1'],
  wardBreak: ['ward-break-1'],
  rebirth: ['rebirth-1'],
  riseBack: ['rise-back-1'],
  avengeBig: ['avenge-big-1'],
  echoChain: ['echo-chain-1'],
  summonSwarm: ['summon-swarm-1'],
  tauntWall: ['taunt-wall-1'],
  flurry: ['flurry-1'],
  pummel: ['pummel-1'],
  lastStand: ['last-stand-1'],
  executeKill: ['execute-kill-1'],
  executeKing: ['execute-king-1'],
  sameCardDuel: ['same-card-duel-1'],
  clutchWin: ['clutch-win-1'],
  narrowLoss: ['narrow-loss-1'],
  // The owner's own moment (2026-09-25): written in the tracker, two ElevenLabs takes of the owner's line.
  blartChronos: ['blart-chronos-1', 'blart-chronos-2'],
  // ── The moment catalog's third batch (owner 2026-09-25, group C): one approved ElevenLabs take each ──
  goldRush: ['gold-rush-1'],
  refreshStreak: ['refresh-streak-1'],
  discoverOpen: ['discover-open-1'],
  firstFreeze: ['first-freeze-1'],
  tribeBuyLines: ['tribe-buy-lines-1'],
  runePayout: ['rune-payout-1'],
  runeReroll: ['rune-reroll-1'],
  runeSkip: ['rune-skip-1'],
  runePick: ['rune-pick-1'],
  runeSlotsFull: ['rune-slots-full-1'],
  equipmentUsed: ['equipment-used-1'],
  heroPowerBig: ['hero-power-big-1'],
  questComplete: ['quest-complete-1'],
  questOffered: ['quest-offered-1'],
  bothEffects: ['both-effects-1'],
  chooseOnePlay: ['choose-one-play-1'],
  bigBuffMoment: ['big-buff-moment-1'],
  fastTurn: ['fast-turn-1'],
  idle: ['idle-1'],
  timeUp: ['time-up-1'],
  ghostFight: ['ghost-fight-1'],
  mirrorMatch: ['mirror-match-1'],
  outgunned: ['outgunned-1'],
  rematch: ['rematch-1'],
  streakStopper: ['streak-stopper-1'],
  resumeGame: ['resume-game-1'],
  darkRuby: ['dark-ruby-1'],
  discoDanChain: ['disco-dan-chain-1'],
  floRida: ['flo-rida-1'],
  goldilox: ['goldilox-1'],
  gemheartGolem: ['gemheart-golem-1'],
  greatPot: ['great-pot-1'],
  rippleResonance: ['ripple-resonance-1'],
  starformCollapse: ['starform-collapse-1'],
  yazzusDouble: ['yazzus-double-1'],
  seasonalRune: ['seasonal-rune-1'],
  // ── end of the third batch ──
};

/** The moment catalog's first batch (owner 2026-09-25), in ANNOUNCER_LINES order. */
export const CATALOG_BATCH_1_EVENTS: readonly AnnouncerEvent[] = [
  'lateGame', 'roundMilestone', 'secondPlace', 'brokeTurn', 'fastTier', 'sellSpree', 'sellGilded', 'spellChain', 'tierUp',
  'allGolden', 'bigTurn', 'boardTotal', 'fullBoard', 'minionHits250', 'armorUp', 'finalShowdown', 'underdogOdds',
  'heavyFavourite', 'armorGone', 'blowoutLoss', 'oneResolve', 'stalemate', 'lobbyLast', 'firstOut', 'leaderboardTop',
  'playersRemain', 'fiveWinStreak', 'losingStreak', 'streakBroken', 'tribeFullBoard', 'mixedBoard',
];
/** The moment catalog's second batch (owner 2026-09-25): the in-fight moments (`announcerCombat.ts`) plus the two
 *  final-frame verdicts, in ANNOUNCER_LINES order. */
export const CATALOG_BATCH_2_EVENTS: readonly AnnouncerEvent[] = [
  ...COMBAT_MOMENT_EVENTS, 'clutchWin', 'narrowLoss',
];

/** The moment catalog's third batch (owner 2026-09-25, group C: moments that needed new tallies / signals), in
 *  ANNOUNCER_LINES order. */
export const CATALOG_BATCH_3_EVENTS: readonly AnnouncerEvent[] = [
  'goldRush', 'refreshStreak', 'discoverOpen', 'firstFreeze', 'tribeBuyLines', 'runePayout', 'runeReroll', 'runeSkip',
  'runePick', 'runeSlotsFull', 'equipmentUsed', 'heroPowerBig', 'questComplete', 'questOffered', 'bothEffects',
  'chooseOnePlay', 'bigBuffMoment', 'fastTurn', 'idle', 'timeUp', 'ghostFight', 'mirrorMatch', 'outgunned', 'rematch',
  'streakStopper', 'resumeGame', 'darkRuby', 'discoDanChain', 'floRida', 'goldilox', 'gemheartGolem', 'greatPot',
  'rippleResonance', 'starformCollapse', 'yazzusDouble', 'seasonalRune',
];

/** Higher speaks first when several are pending at once. */
export const ANNOUNCER_PRIORITY: Record<AnnouncerEvent, number> = {
  gameWon: 100,
  gameLoss: 100,
  topTwo: 90,
  knockout: 88,
  topFour: 85,
  surviveUnder10hp: 80,
  losingLowOddsFight: 70,
  winningLowOddsFight: 70,
  comebackWin: 66,
  threeWinStreak: 65,
  startCombatUnder10hp: 60,
  flawlessVictory: 58,
  bigHit: 57,
  enteringCombatAfterLoss: 55,
  minionHits100Stats: 50,
  goldenArmy: 48,
  shopBigBuff: 46,
  tierSix: 45,
  epicRuneforge: 40,
  runeforge: 35,
  triple: 30,
  tribeFour: 28,
  equipment: 25,
  bigSpender: 24,
  richTurn: 22,
  enteringCombat: 20,
  pair: 18,
  gameStart: 15,
  round7: 14,
  randomSpellBuy: 12,
  randomCardBuy: 12,
  randomBeastBuy: 12,
  randomDwarfBuy: 12,
  backToShop: 10,
  timeRunningOut: 5,
  buyDrakko: 36,
  buySylus: 36,
  castAle: 16,
  // The moment catalog's first batch (owner 2026-09-25). PROPOSED by Claude, each slotted beside the live moment it
  // most resembles; the owner tunes. Ties with an existing moment are deliberate (same weight, first queued wins).
  secondPlace: 100,
  playersRemain: 84,
  firstOut: 82,
  oneResolve: 78,
  finalShowdown: 75,
  fiveWinStreak: 67,
  blowoutLoss: 64,
  streakBroken: 63,
  stalemate: 62,
  allGolden: 56,
  minionHits250: 53,
  underdogOdds: 52,
  boardTotal: 49,
  fastTier: 44, // below TierSix (45): tier 6 by round 9 says "Tier six", which cannot recur
  armorGone: 41,
  leaderboardTop: 43,
  lobbyLast: 42,
  losingStreak: 40,
  tribeFullBoard: 38,
  mixedBoard: 34,
  heavyFavourite: 32,
  armorUp: 31,
  spellChain: 29,
  sellGilded: 27,
  bigTurn: 26,
  lateGame: 26,
  sellSpree: 23,
  tierUp: 19,
  fullBoard: 17,
  roundMilestone: 13,
  brokeTurn: 8,
  // The second batch (owner 2026-09-25), proposed the same way. In-fight lines sit mid-table: a verdict or a
  // standings line still outranks them when they land together.
  clutchWin: 69,
  narrowLoss: 61,
  lastStand: 59,
  executeKing: 54,
  wardBreak: 51,
  overkill: 39,
  sameCardDuel: 37,
  flurry: 33,
  executeKill: 33,
  echoChain: 31,
  avengeBig: 30,
  summonSwarm: 29,
  rebirth: 27,
  tauntWall: 25,
  pummel: 24,
  riseBack: 21,
  firstBlood: 15,
  blartChronos: 36, // a named-card specialty, like BuyDrakko / BuySylus
  // ── The moment catalog's third batch (owner 2026-09-25, group C). PROPOSED by Claude, each beside the live moment
  // it most resembles; the owner tunes. Checked against the common co-pending cases (see the devlog). ──
  questComplete: 47, // beside GoldenArmy / ShopBigBuff: a rare, big Shop payoff
  bigBuffMoment: 47,
  streakStopper: 64, // a verdict win line, beside BlowoutLoss / StreakBroken
  outgunned: 50, // beside UnderdogOdds (52): the same "you are behind" read, just under it
  runeSlotsFull: 38,
  seasonalRune: 39, // the specialty rune pick outranks the generic socket line
  darkRuby: 36, // the card specials sit with the specialty buy lines (Drakko / Sylus 36)
  discoDanChain: 36,
  floRida: 36,
  goldilox: 36,
  gemheartGolem: 36,
  rippleResonance: 36,
  starformCollapse: 36,
  yazzusDouble: 36,
  questOffered: 34, // below Runeforge (35): a forge opening with it wins
  rematch: 33, // Face Omen, beside HeavyFavourite (32)
  runePick: 33,
  bothEffects: 31, // outranks ChooseOnePlay, so a both-effects first play says the special line
  heroPowerBig: 29,
  runePayout: 27,
  equipmentUsed: 24, // below Equipment (25): gaining Equipment says its own line first
  goldRush: 23, // beside SellSpree / BigSpender
  ghostFight: 21, // Face Omen, just above EnteringCombat (20); a ghost needs a knockout, so never waves 1-3
  runeSkip: 21,
  runeReroll: 20,
  mirrorMatch: 19, // BELOW EnteringCombat (20): a turn-1 Kobold mirror must not take "the first Face Omen"
  chooseOnePlay: 18, // beside Pair
  greatPot: 16, // a cast, beside CastAle
  resumeGame: 15, // beside GameStart
  firstFreeze: 12,
  tribeBuyLines: 12, // the generic buy family (12); enqueued before RandomCardBuy, so the tribe line wins a tie
  refreshStreak: 11,
  discoverOpen: 9, // BELOW BackToShop (10): a Start-of-Turn Discover must not silence the return line
  fastTurn: 9, // Face Omen, just above BrokeTurn (8)
  idle: 7,
  timeUp: 6, // just above TimeRunningOut (5), which it replaces at 0
  // ── end of the third batch ──
};

/** When a pending line goes stale: 'shop' lines when combat starts, 'combat' lines when the next shop opens. */
export type AnnouncerShelf = 'shop' | 'combat' | 'never';

// ── The store slice the detectors read (structural, so tests hand-build states) ─────────────────────────────
export interface AnnouncerRunLike {
  seed: number;
  mode?: string | undefined;
  sandbox?: boolean | undefined;
  wave: number;
  phase: string;
  resolve: number;
  tier: number;
  history: readonly string[];
  board: readonly { attack: number; health: number; golden: boolean; cardId?: string; uid?: string; buffs?: readonly AnnouncerBuffLike[] | undefined }[];
  hand: readonly { golden: boolean; cardId?: string; uid?: string; attack?: number; health?: number; buffs?: readonly AnnouncerBuffLike[] | undefined }[];
  /** Spells cast this run (the reducer's tally): CastAle keys on it rising while an Ale leaves the hand. */
  spellsCast?: number | undefined;
  /** Gold in hand (RichTurn, BigSpender). */
  embers?: number | undefined;
  goldSpentThisTurn?: number | undefined;
  /** Bumped by every buy (the reducer's post-action tally): the buy detectors key on it. */
  cardsBoughtThisTurn?: number | undefined;
  /** The Shop row and the spell slot: the bought offer is the one that left them (a buy's card id), and the row's
   *  Attack is read for ShopBigBuff. */
  shop?: readonly { uid: string; cardId: string; atk?: number | undefined }[] | undefined;
  spell?: { uid: string; cardId: string } | null | undefined;
  equipment?: { available: readonly unknown[] } | undefined;
  runeforgeOffer?: readonly string[] | undefined;
  runeforgeEpic?: boolean | undefined;
  combatSettled: boolean;
  /** Armor (ArmorUp, ArmorGone, and the loss damage BlowoutLoss reads with Resolve). */
  armor?: number | undefined;
  /** The Shop turn's tallies (the reducer's): SellSpree / SellGilded, SpellChain, BigTurn. */
  soldThisTurn?: readonly string[] | undefined;
  spellsThisTurn?: number | undefined;
  playedThisTurn?: readonly string[] | undefined;
  lastCombat?: { result: string; enemyDamage?: number | undefined; playerDeaths?: number | undefined } | undefined;
  lobby?: {
    round?: number | undefined;
    seats: readonly {
      id?: string | undefined; alive: boolean; placement?: number | undefined; eliminatedRound?: number | undefined;
      /** LobbyLast / LeaderboardTop compare it across the standing seats. */
      resolve?: number | undefined;
    }[];
    encounters?: readonly {
      round: number; a: string; b: string; damageToA: number; damageToB: number; bye?: string | undefined;
      /** Written from A's side (StreakStopper reads the foe's streak). */
      outcome?: string | undefined; fought?: boolean | undefined;
    }[] | undefined;
  } | undefined;
  // ── The third batch's reads (owner 2026-09-25, group C) ──
  frozen?: boolean | undefined;
  /** The open Discover (DiscoverOpen), what is queued behind it and Disco Dan's lock tier (DiscoDanChain). */
  discover?: readonly string[] | undefined;
  discoverQueue?: readonly unknown[] | undefined;
  discoverLockTier?: number | undefined;
  ownedRunes?: readonly string[] | undefined;
  /** Per rune id, how many times it went off (RunePayout). */
  runeProcs?: Readonly<Record<string, number>> | undefined;
  questOffer?: readonly string[] | undefined;
  activeQuests?: readonly { questId: string; completed: boolean; completionCount?: number | undefined }[] | undefined;
  equipmentActivationsThisTurn?: number | undefined;
  /** An open Choose One prompt (BothEffects: a card that resolved without one resolved both branches). */
  chooseOne?: { uid: string } | undefined;
  /** The per-action FX payloads (reset every action; the seq bumps when one lands): BigBuffMoment, DarkRuby /
   *  RippleResonance, StarformCollapse. */
  recruitFxSeq?: number | undefined;
  recruitBuffFx?: readonly { attack: number; health: number }[] | undefined;
  rubyRiderFxSeq?: number | undefined;
  rubyRiderFx?: readonly { rider: string }[] | undefined;
  starformFxSeq?: number | undefined;
  starformFx?: readonly { kind: string; fromUid: string }[] | undefined;
}
/** A buff entry on a card (the source label is the buffing card's NAME: Flo Rida's buffs read `'Flo Rida'`). */
export interface AnnouncerBuffLike { source: string; attack: number; health: number }
/** One logged action (the store's `replayActions`): only the fields the third batch reads. */
export interface AnnouncerActionLike { type: string; uid?: string | undefined; targetUid?: string | undefined }
/** Who the player faces this fight (Ghost / Outgunned / Mirror / Rematch / StreakStopper). */
export interface AnnouncerFoe { seatId: string; ghost: boolean; tier: number; topTribe?: string | undefined }
export interface AnnouncerStateLike extends MusicStateLike {
  run: AnnouncerRunLike;
  announced: AnnouncedSlice;
  /** The rail's real pre-combat odds for `wave`, once the deferred probe has run (see `stampReplayOdds`). */
  combatOdds: { wave: number; odds: { win: number; draw: number; lose: number } } | null;
  markAnnounced: (event: AnnouncerEvent, wave: number, take?: string, reshuffle?: boolean) => void;
  /** The run's state-changing action log (appended in the same store update as the run). The third batch reads the
   *  actions an update added: a Refresh, a rune pick / skip / re-roll, a hero power, a card played. */
  replayActions?: readonly AnnouncerActionLike[] | undefined;
}

/** The pure gate: the same as the music's (lobby / practice on screen, no sandbox, no replay, no title). */
export const isAnnouncerWanted = (s: MusicStateLike): boolean => isMusicWanted(s);

// ── Injected seams (the real browser APIs by default; tests replace them) ───────────────────────────────────
export interface AnnouncerHandle {
  /** Fade out over `fadeMs` and stop. The ended callback must NOT fire after this. */
  stop(fadeMs: number): void;
}
export interface AnnouncerDeps {
  now: () => number;
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  /** Start `url` playing; `onEnded` fires once when it finishes on its own. Null = could not play. `gain` is the
   *  event's tuned multiplier (the Announcer dev tuner, 1 = as recorded), applied on top of the channel level with
   *  the final gain clamped at 1 (`announcerLineGain`). */
  play: (url: string, onEnded: () => void, gain: number) => Promise<AnnouncerHandle | null>;
  /** A uniform roll in [0, 1) for picking which take of a line plays (owner 2026-09-25: "random pick every time, no
   *  seeds"). Tests replace it to pin a take. */
  random: () => number;
  /** Who the player faces this fight, read once at the Face Omen (null = no lobby / unknown). The default asks the
   *  lobby (`playerOpponent`, the same read the combat HUD makes); tests hand one in. */
  foe: (run: AnnouncerRunLike) => AnnouncerFoe | null;
}

// ── Level (the Settings slider + mute), persisted ────────────────────────────────────────────────────────────
let volume = (() => {
  try {
    const v = parseFloat(localStorage.getItem(ANNOUNCER_VOLUME_KEY) ?? '');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_SLIDER;
  } catch {
    return DEFAULT_SLIDER;
  }
})();
let muted = (() => {
  try {
    return localStorage.getItem('ascent.announcermuted') === '1';
  } catch {
    return false;
  }
})();
/** The ONE place the Announcer slider becomes a gain (the default-mix curve: 50 plays the owner's 0.7, 100 plays 1). */
const level = (): number => (muted ? 0 : sliderToGain('announcer', volume));

export function getAnnouncerVolume(): number {
  return volume;
}
export function setAnnouncerVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  try { localStorage.setItem(ANNOUNCER_VOLUME_KEY, String(volume)); } catch { /* ignore */ }
  applyLevel();
}
export function isAnnouncerMuted(): boolean {
  return muted;
}
export function toggleAnnouncerMute(): boolean {
  muted = !muted;
  try { localStorage.setItem('ascent.announcermuted', muted ? '1' : '0'); } catch { /* ignore */ }
  applyLevel();
  return muted;
}

// ── Default playback: a decoded buffer through the announcer gain, else an element per line ────────────────
let ctxProvider: () => AudioContext | null = () => null;
/** sfx.ts hands its (lazily created) AudioContext in through here, so this module never builds a second one. */
export function setAnnouncerAudioContextProvider(provider: () => AudioContext | null): void {
  ctxProvider = provider;
}
let graph: { ctx: AudioContext; level: GainNode } | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
/** Elements on the no-context path that are currently sounding, each with its event multiplier (their `volume`
 *  follows the level). */
const liveElements = new Map<HTMLAudioElement, number>();

function ensureGraph(ctx: AudioContext): GainNode {
  if (graph && graph.ctx === ctx) return graph.level;
  const lvl = ctx.createGain();
  lvl.gain.value = level();
  lvl.connect(ctx.destination);
  graph = { ctx, level: lvl };
  return lvl;
}

function applyLevel(): void {
  if (graph) {
    const now = graph.ctx.currentTime;
    graph.level.gain.cancelScheduledValues(now);
    graph.level.gain.setTargetAtTime(level(), now, 0.01);
  }
  for (const [el, gain] of liveElements) el.volume = announcerLineGain(level(), gain);
}

function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((bytes) => ctx.decodeAudioData(bytes))
      .catch(() => null);
    buffers.set(url, p);
  }
  return p;
}

async function playDefault(url: string, onEnded: () => void, gain = 1): Promise<AnnouncerHandle | null> {
  const ctx = ctxProvider();
  if (ctx) {
    const out = ensureGraph(ctx);
    const buf = await loadBuffer(ctx, url);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    // The event's tuned multiplier rides on the line's own gain, capped so line x channel never passes 1.
    const lvl = level();
    g.gain.value = lvl > 0 ? announcerLineGain(lvl, gain) / lvl : Math.max(0, gain);
    src.connect(g);
    g.connect(out);
    let live = true;
    src.onended = () => { if (live) { live = false; try { src.disconnect(); g.disconnect(); } catch { /* ignore */ } onEnded(); } };
    src.start();
    return {
      stop(fadeMs) {
        if (!live) return;
        live = false;
        const t = ctx.currentTime;
        try {
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
          src.stop(t + fadeMs / 1000 + 0.01);
        } catch { /* already stopped */ }
      },
    };
  }
  // No Web Audio: one element per line, its own volume carrying the level.
  try {
    if (typeof Audio === 'undefined') return null;
    const el = new Audio(url);
    el.volume = announcerLineGain(level(), gain);
    let live = true;
    const done = (): void => { if (live) { live = false; liveElements.delete(el); onEnded(); } };
    el.addEventListener('ended', done);
    el.addEventListener('error', done);
    liveElements.set(el, gain);
    await el.play();
    return {
      stop(fadeMs) {
        if (!live) return;
        live = false;
        liveElements.delete(el);
        const from = el.volume;
        const started = Date.now();
        const id = window.setInterval(() => {
          const t = Math.min(1, (Date.now() - started) / Math.max(1, fadeMs));
          el.volume = from * (1 - t);
          if (t >= 1) { window.clearInterval(id); try { el.pause(); } catch { /* ignore */ } }
        }, 25);
      },
    };
  } catch {
    return null;
  }
}

const defaultDeps: AnnouncerDeps = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  play: playDefault,
  random: () => Math.random(), // presentation only: the announcer never feeds the sim, so the seeded-RNG ban doesn't apply
  foe: lobbyFoe,
};
let deps: AnnouncerDeps = defaultDeps;
/** Tests only: swap the seams. Resets the machine. */
export function __setAnnouncerDepsForTests(patch: Partial<AnnouncerDeps> | null): void {
  resetAnnouncerForTests();
  deps = patch ? { ...defaultDeps, ...patch } : defaultDeps;
}

// ── The queue ───────────────────────────────────────────────────────────────────────────────────────────────
interface PendingLine {
  event: AnnouncerEvent;
  shelf: AnnouncerShelf;
  notBefore: number;
  wave: number;
  /** Speaks inside the cooldown (never over a playing line: it waits for that to end). SurviveUnder10hp after
   *  this round's StartCombatUnder10hp (the round's only line), the two forge lines (see `detectForge`) and
   *  TimeRunningOut (see `observeTurnClock`). */
  bypassCooldown?: boolean;
  /** The chance roll's index (a buy's count this turn); 0 when absent. */
  rollIndex?: number;
  /** Skip the chance roll (a tier 6 Discover always speaks), unless the event's chance is 0 (muted). */
  certain?: boolean;
}
export type AnnouncerLogKind = 'queue' | 'play' | 'drop' | 'expire' | 'cancel' | 'end';
export interface AnnouncerLogEntry { t: number; kind: AnnouncerLogKind; event: AnnouncerEvent; file?: string; why?: string }

let active = false;
let runKey: number | null = null;
let slice: AnnouncedSlice | null = null;
let mark: ((event: AnnouncerEvent, wave: number, take?: string, reshuffle?: boolean) => void) | null = null;
let pending: PendingLine[] = [];
let playing: { event: AnnouncerEvent; token: number; handle: AnnouncerHandle | null } | null = null;
let playToken = 0;
let pumpTimer: number | null = null;
/** When the previous line ended (or was cut). The cooldown counts from here. */
let lastLineEndedAt = -Infinity;
/** The event + wave of the line that spoke last (the SurviveUnder10hp exception reads it). */
let lastLine: { event: AnnouncerEvent; wave: number } | null = null;
/** The run landed on screen at this time (the turn-1 quiet window counts from here). */
let runEnteredAt = 0;
let enteredAtWaveOne = false;
/** The current combat resolution began at this time (null outside combat). */
let combatStartedAt: number | null = null;
/** MinionHits100Stats in combat is checked per frame; report it once per fight. */
let bigStatSeenThisCombat = false;
/** MinionHits250 in combat, the same way. */
let hugeStatSeenThisCombat = false;
/** UnderdogOdds / HeavyFavourite: the wave whose pre-fight odds were already weighed (the probe lands once). */
let oddsCheckedWave = -1;
/** The in-fight fold (`announcerCombat.ts`) for the fight on screen, keyed by that fight's identity. */
let combatScan: { key: object; scan: CombatScan } | null = null;
/** A Skip mid-fight silences the rest of that fight's in-fight lines (the skipped replay jumps to the end, and
 *  the lines it passed must not all queue at once). Reset by the next Face Omen. */
let combatSilenced = false;
/** The fight whose final frame was already weighed for ClutchWin / NarrowLoss. */
let finalChecked: object | null = null;
/** TimeRunningOut: the wave whose clock already crossed ANNOUNCER_TIME_WARNING_SECONDS (once per Shop turn). */
let timeWarningWave = -1;
/** SPECIALTY lines: detections so far this game (a dropped one retries, at most its take count). In memory, like
 *  TribeFour's count: a Save & Continue restarts the tries (a spoken one stays spoken, it is in the slice). */
let specialtyTries = new Map<AnnouncerEvent, number>();
/** TribeFour: this Shop turn's minion buys per tribe (dual tribes count for both, an All-tribe minion for every
 *  tribe). In memory only, reset each wave: a Save & Continue mid-turn starts the count again. */
let tribeBuys: { wave: number; byTribe: Map<Tribe, number>; all: number } = { wave: -1, byTribe: new Map(), all: 0 };
// ── The third batch's in-memory tallies (owner 2026-09-25, group C). Like TribeFour's, a Save & Continue mid-turn
// restarts them; a spoken line stays spoken (it is in the slice). ──
/** RefreshStreak: this Shop turn's Refreshes. GoldRush: this Shop turn's Gold from effects. */
let refreshes = { wave: -1, n: 0 };
let goldGained = { wave: -1, n: 0 };
/** DiscoverOpen: Discovers seen this game (the chance roll's index). */
let discoversSeen = 0;
/** THE SHOP CLOCK as Recruit last reported it (`observeTurnClock`): FastTurn reads the seconds left at End Turn,
 *  Idle counts down from `idleFrom` (the clock at the last action), TimeUp hears it reach 0. */
let clock = { wave: -1, seconds: 0, idleFrom: 0 };
/** This fight's foe, read at the Face Omen (StreakStopper needs its streak at the verdict). */
let combatFoe: { wave: number; seatId: string; streak: number } | null = null;
/** GemheartGolem in combat is checked per frame; report it once per fight. */
let golemsSeenThisCombat = false;
const freshBatch3Tallies = (): void => {
  refreshes = { wave: -1, n: 0 };
  goldGained = { wave: -1, n: 0 };
  discoversSeen = 0;
  clock = { wave: -1, seconds: 0, idleFrom: 0 };
  combatFoe = null;
  golemsSeenThisCombat = false;
};
const log: AnnouncerLogEntry[] = [];

function note(kind: AnnouncerLogKind, event: AnnouncerEvent, extra: { file?: string; why?: string } = {}): void {
  log.push({ t: deps.now(), kind, event, ...extra });
  if (log.length > 200) log.splice(0, log.length - 200);
}

function clearPump(): void {
  if (pumpTimer !== null) {
    deps.clearTimeout(pumpTimer);
    pumpTimer = null;
  }
}
/** The queue is evaluated on its own task, never inside the store update that fed it: a burst of events from one
 *  moment (the three Face Omen lines, a verdict's Survive + LowOdds) must be weighed TOGETHER, or the first one
 *  enqueued would speak before the higher-priority one arrived. */
function schedulePump(ms: number): void {
  clearPump();
  pumpTimer = deps.setTimeout(() => { pumpTimer = null; pump(); }, Math.max(0, ms));
}

/** Which take of a line plays: a fresh uniform pick every time (owner 2026-09-25: "random pick every time, no
 *  seeds"), so the same moment can sound different on a replay or a reload. */
export function announcerPick(variants: number, roll: number = deps.random()): number {
  if (variants <= 1) return 0;
  return Math.min(variants - 1, Math.floor(roll * variants));
}

/** A deterministic roll in [0, 1) for the RARE lines, from the run seed, the event, the wave and an index (the
 *  buy's count this turn; 0 for Round 7). A replay of the same run rolls the same way. */
export function announcerRoll(seed: number, event: AnnouncerEvent, wave: number, index: number): number {
  const events = Object.keys(ANNOUNCER_LINES) as AnnouncerEvent[];
  let h = (seed ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (events.indexOf(event) + 1), 0xcc9e2d51) >>> 0;
  h = Math.imul(h ^ (wave + 1), 0x1b873593) >>> 0;
  h = Math.imul(h ^ (index + 1), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x1_0000_0000;
}

function clipUrl(file: string): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${base}announcer/${file}.mp3`;
}

const isTerminal = (e: AnnouncerEvent): boolean => UNCAPPED_EVENTS.includes(e);

/** The takes of `event` not yet heard this game (the no-repeat bag). */
function unheardTakes(s: AnnouncedSlice, event: AnnouncerEvent): readonly string[] {
  const heard = new Set(heardTakes(s, event));
  return ANNOUNCER_LINES[event].filter((t) => !heard.has(t));
}
/** Every take heard, and the event does not reshuffle: silent for the rest of the game. */
export function announcerExhausted(s: AnnouncedSlice, event: AnnouncerEvent): boolean {
  return !REUSABLE_BAG_EVENTS.includes(event) && unheardTakes(s, event).length === 0;
}
/** The chance table: does this moment speak? 1 always, 0 never, else the seeded roll. */
function chanceAllows(s: AnnouncedSlice, event: AnnouncerEvent, wave: number, index: number, certain = false): boolean {
  const c = announcerEventChance(event);
  if (c <= 0) return false;
  if (c >= 1 || certain) return true;
  return announcerRoll(s.seed, event, wave, index) < c;
}

function enqueue(line: PendingLine): void {
  if (!active) return;
  if (pending.some((p) => p.event === line.event)) return;
  if (slice && announcerExhausted(slice, line.event)) return; // the no-repeat rule: nothing left to say
  if (slice && !chanceAllows(slice, line.event, line.wave, line.rollIndex ?? 0, line.certain)) return;
  // The Announcer dev tuner's per-event TIMING OFFSET (owner 2026-09-24; 0 in prod unless baked). Added to the
  // event's built-in delay; a negative one fires earlier but never before the moment was detected (now). Only
  // `notBefore` moves: the cooldown (from the previous line's real end), the cap and the shelf life are untouched.
  line.notBefore = Math.max(deps.now(), line.notBefore + announcerEventOffset(line.event));
  // The turn-1 quiet window: nothing over the music's fade-in.
  if (enteredAtWaveOne) line.notBefore = Math.max(line.notBefore, runEnteredAt + ANNOUNCER_TURN_ONE_QUIET_MS);
  pending.push(line);
  note('queue', line.event);
  schedulePump(0);
}

function expire(shelf: AnnouncerShelf): void {
  if (!pending.length) return;
  const keep: PendingLine[] = [];
  for (const p of pending) {
    if (p.shelf === shelf) note('expire', p.event);
    else keep.push(p);
  }
  pending = keep;
}

function pump(): void {
  clearPump();
  if (!active || playing || !pending.length) return;
  const now = deps.now();
  const ready = pending.filter((p) => p.notBefore <= now);
  if (!ready.length) {
    schedulePump(Math.min(...pending.map((p) => p.notBefore)) - now);
    return;
  }
  ready.sort((a, b) => ANNOUNCER_PRIORITY[b.event] - ANNOUNCER_PRIORITY[a.event]);
  const cooldownUntil = lastLineEndedAt + ANNOUNCER_COOLDOWN_MS;
  const cooling = now < cooldownUntil;
  // Inside the cooldown only a line that BYPASSES it may speak (the highest such one); every other ready capped
  // line is DROPPED (not delayed into the wrong moment). A terminal line (GameWon / GameLoss) waits it out
  // instead: it never expires.
  const top = cooling ? ready.find((p) => p.bypassCooldown) : ready[0];
  if (!top) {
    for (const p of ready) {
      if (isTerminal(p.event)) continue;
      note('drop', p.event, { why: 'cooldown' });
    }
    pending = pending.filter((p) => !ready.includes(p) || isTerminal(p.event));
    if (pending.length) schedulePump(Math.min(cooldownUntil, ...pending.filter((p) => p.notBefore > now).map((p) => p.notBefore)) - now);
    return;
  }
  // The top line speaks; the other READY lines are dropped (outranked, or still inside the cooldown); a terminal
  // line keeps waiting. Lines whose time has not come stay pending and meet the cooldown when it does.
  for (const p of ready) {
    if (p === top || isTerminal(p.event)) continue;
    note('drop', p.event, { why: cooling && !p.bypassCooldown ? 'cooldown' : `outranked by ${top.event}` });
  }
  pending = pending.filter((p) => !ready.includes(p) || (isTerminal(p.event) && p !== top));
  speak(top);
  if (pending.length) schedulePump(Math.min(...pending.map((p) => p.notBefore)) - now);
}

function speak(line: PendingLine): void {
  const s = slice;
  if (!s || !mark) return;
  // THE NO-REPEAT BAG: a random take from those not heard this game; a reusable bag reshuffles when empty.
  const fresh = unheardTakes(s, line.event);
  const reshuffle = fresh.length === 0;
  if (reshuffle && !REUSABLE_BAG_EVENTS.includes(line.event)) { note('drop', line.event, { why: 'every take heard' }); return; }
  const bag = reshuffle ? ANNOUNCER_LINES[line.event] : fresh;
  const file = bag[announcerPick(bag.length)]!;
  const token = ++playToken;
  playing = { event: line.event, token, handle: null };
  lastLine = { event: line.event, wave: line.wave };
  note('play', line.event, { file });
  mark(line.event, line.wave, file, reshuffle);
  // Mirror the store's write locally, so a second line before the next store update already sees this take heard.
  slice = withAnnounced(s, line.event, line.wave, file, reshuffle);
  const ended = (): void => {
    if (!playing || playing.token !== token) return;
    playing = null;
    lastLineEndedAt = deps.now();
    note('end', line.event);
    pump();
  };
  let p: Promise<AnnouncerHandle | null>;
  try {
    p = deps.play(clipUrl(file), ended, announcerEventVolume(line.event));
  } catch {
    p = Promise.resolve(null);
  }
  p.then(
    (handle) => {
      if (!playing || playing.token !== token) { handle?.stop(0); return; }
      if (!handle) { ended(); return; }
      playing.handle = handle;
    },
    () => ended(),
  );
}

/** Cancel the queue and the playing line at once (a Skip, leaving the run). */
export function cancelAnnouncer(why = 'cancel'): void {
  clearPump();
  if (why === 'skip' && combatStartedAt !== null) combatSilenced = true;
  for (const p of pending) note('cancel', p.event, { why });
  pending = [];
  if (playing) {
    note('cancel', playing.event, { why });
    playing.handle?.stop(ANNOUNCER_STOP_FADE_MS);
    playing = null;
    lastLineEndedAt = deps.now();
  }
}

// ── The detectors ───────────────────────────────────────────────────────────────────────────────────────────
const countGolden = (r: AnnouncerRunLike): number => r.board.filter((c) => c.golden).length + r.hand.filter((c) => c.golden).length;
const equipmentCount = (r: AnnouncerRunLike): number => r.equipment?.available.length ?? 0;
const hasBigStat = (units: readonly { attack: number; health: number }[]): boolean =>
  units.some((u) => u.attack >= ANNOUNCER_BIG_STAT || u.health >= ANNOUNCER_BIG_STAT);
const aliveSeats = (r: AnnouncerRunLike): number => r.lobby?.seats.filter((x) => x.alive).length ?? 0;
const playerAlive = (r: AnnouncerRunLike): boolean => r.lobby?.seats[0]?.alive ?? r.resolve > 0;
/** Placement at the end: the seat's stamped placement, else how many were still standing (EndScreen's rule). */
export function finalPlacement(r: AnnouncerRunLike): number {
  const me = r.lobby?.seats[0];
  if (me?.placement) return me.placement;
  if (r.phase === 'victory') return 1;
  return r.lobby ? aliveSeats(r) : 2;
}
const tail = (h: readonly string[], n: number): readonly string[] => h.slice(Math.max(0, h.length - n));

/** A repeatable event (BackToShop, Triple, Knockout) may speak again `gap` waves after its last line, up to `max`. */
function repeatAllowed(s: AnnouncedSlice, event: AnnouncerEvent, wave: number, max: number, gap = ANNOUNCER_REPEAT_GAP_WAVES): boolean {
  const waves = firedWaves(s, event);
  if (waves.length >= max) return false;
  const last = waves[waves.length - 1];
  return last === undefined || wave - last >= gap;
}

// ── The second batch's detectors (owner 2026-09-24) ─────────────────────────────────────────────────────────
/** A minion (not a spell or a Ruby). An id the card index does not know counts as a minion (hand-built states). */
const isMinionId = (cardId: string | undefined): boolean => {
  const def = cardId ? CARD_INDEX[cardId] : undefined;
  return !def || (!def.spell && !def.ruby);
};
const boardGolden = (r: AnnouncerRunLike): number => r.board.filter((c) => c.golden).length;
/** Pair: two copies of one non-golden minion across the board and the hand. */
export function hasPair(r: AnnouncerRunLike): boolean {
  const seen = new Set<string>();
  for (const c of [...r.board, ...r.hand]) {
    if (c.golden || !c.cardId || !isMinionId(c.cardId)) continue;
    if (seen.has(c.cardId)) return true;
    seen.add(c.cardId);
  }
  return false;
}
const isBigSpender = (r: AnnouncerRunLike): boolean =>
  (r.goldSpentThisTurn ?? 0) >= ANNOUNCER_BIG_SPENDER_SPENT && (r.embers ?? 0) >= ANNOUNCER_BIG_SPENDER_LEFT;
/** A Shop offer's Attack as it would buy in (`offerBuyStats`, the sim's single source of truth for an offer). */
function offerAttack(r: AnnouncerRunLike, offer: { cardId: string; atk?: number | undefined }): number {
  try {
    return offerBuyStats(r as unknown as RunState, offer as unknown as ShopCard).attack;
  } catch {
    return (CARD_INDEX[offer.cardId]?.attack ?? 0) + (offer.atk ?? 0); // a partial (test) run: base + the offer's own buffs
  }
}
const shopHasBigAttack = (r: AnnouncerRunLike): boolean =>
  (r.shop ?? []).some((o) => isMinionId(o.cardId) && offerAttack(r, o) > ANNOUNCER_SHOP_BIG_ATTACK);
/** The card a buy took: the offer that left the Shop row or the spell slot on the update the buy count rose. */
function boughtCardId(p: AnnouncerRunLike, run: AnnouncerRunLike): string | null {
  const now = new Set<string>((run.shop ?? []).map((o) => o.uid));
  if (run.spell) now.add(run.spell.uid);
  const before = [...(p.shop ?? []), ...(p.spell ? [p.spell] : [])];
  return before.find((o) => !now.has(o.uid))?.cardId ?? null;
}
/** Knockout: the round the player just fought knocked their foe out. The lobby settles on `resolveCombat` (the
 *  return to the shop), so this reads the return update: the round's encounter with seat 0, where seat 0 dealt
 *  damage and the foe went from standing to out. A ghost (the bye's foe) was already out, so it never counts. */
function knockedOutFoe(p: AnnouncerRunLike, run: AnnouncerRunLike): boolean {
  const lobby = run.lobby;
  const round = p.lobby?.round;
  if (!lobby?.encounters || round === undefined) return false;
  for (const e of lobby.encounters) {
    if (e.round !== round || e.bye) continue;
    const foe = e.a === 's0' ? e.b : e.b === 's0' ? e.a : null;
    if (!foe) continue;
    const dealt = e.a === 's0' ? e.damageToB : e.damageToA;
    const seat = lobby.seats.find((x) => x.id === foe);
    const wasAlive = p.lobby?.seats.find((x) => x.id === foe)?.alive ?? true;
    if (dealt > 0 && seat && !seat.alive && wasAlive) return true;
  }
  return false;
}

/** The buy lines: TribeFour and the four RARE lines, on the update a buy landed. */
function detectBuy(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, now: number): void {
  const bought = run.cardsBoughtThisTurn ?? 0;
  if (bought <= (p.cardsBoughtThisTurn ?? 0)) return;
  const cardId = boughtCardId(p, run);
  const def = cardId ? CARD_INDEX[cardId] : undefined;
  const isSpell = !!def && (!!def.spell || !!def.ruby);
  if (tribeBuys.wave !== run.wave) tribeBuys = { wave: run.wave, byTribe: new Map(), all: 0 };
  if (def && !isSpell) {
    if (def.universalTribe) tribeBuys.all++;
    for (const t of [def.tribe, def.tribe2]) {
      if (t && t !== 'neutral') tribeBuys.byTribe.set(t, (tribeBuys.byTribe.get(t) ?? 0) + 1);
    }
    const best = Math.max(0, ...tribeBuys.byTribe.values()) + tribeBuys.all;
    if (best >= ANNOUNCER_TRIBE_BUYS && !hasFired(s, 'tribeFour')) {
      enqueue({ event: 'tribeFour', shelf: 'shop', notBefore: now, wave: run.wave });
    }
  }
  // The rare lines: each qualifying event rolls its own seeded chance. The specific ones enqueue first, so when two
  // pass on one buy (the same priority) the more specific line is the one that speaks.
  const candidates: AnnouncerEvent[] = [];
  if (isSpell) candidates.push('randomSpellBuy');
  if (def && !isSpell && defIsTribe(def, 'beast')) candidates.push('randomBeastBuy');
  if (def && !isSpell && defIsTribe(def, 'dwarf')) candidates.push('randomDwarfBuy');
  // TribeBuyLines (the third batch): the one take names Kobolds. Once a game (one take), same 6% roll.
  if (def && !isSpell && defIsTribe(def, ANNOUNCER_TAKE_TRIBE) && !hasFired(s, 'tribeBuyLines')) candidates.push('tribeBuyLines');
  candidates.push('randomCardBuy');
  for (const event of candidates) {
    // The one exception to once-per-game: up to ANNOUNCER_RANDOM_BUY_MAX, ANNOUNCER_RANDOM_BUY_GAP_WAVES apart.
    if (!repeatAllowed(s, event, run.wave, ANNOUNCER_RANDOM_BUY_MAX, ANNOUNCER_RANDOM_BUY_GAP_WAVES)) continue;
    enqueue({ event, shelf: 'shop', notBefore: now, wave: run.wave, rollIndex: bought }); // the chance table rolls
  }
  // The SPECIALTY buy lines: a named card bought from the Shop.
  const named = cardId ? ANNOUNCER_NAMED_BUYS[cardId] : undefined;
  if (named) trySpecialty(s, named, run.wave, now);
}

/** A SPECIALTY line's moment happened: speak unless it already has; a dropped one retries, up to its take count. */
function trySpecialty(s: AnnouncedSlice, event: AnnouncerEvent, wave: number, now: number): void {
  if (hasFired(s, event)) return;
  const tries = specialtyTries.get(event) ?? 0;
  if (tries >= ANNOUNCER_LINES[event].length) return;
  specialtyTries.set(event, tries + 1);
  enqueue({ event, shelf: 'shop', notBefore: now, wave });
}

const aleCount = (r: AnnouncerRunLike): number => r.hand.filter((c) => !!c.cardId && ALE_IDS.includes(c.cardId)).length;

/** THE FORGE OPENING: `runeforgeOffer` appeared (`runeforgeEpic` picks the Epic line). The scheduled forges (turn
 *  6 Basic / turn 9 Epic for every hero, a Runesmith's turn 5, a Guardian's turn 8, a booked Clock forge) open
 *  INSIDE the reducer step that returns the run to the shop (`resolveCombat` → `advanceCombat` → the turn-start
 *  sequence → `openNextStartOfTurnModal`), so the store's ONE update carries the phase flip AND the offer. The
 *  return branch of `syncAnnouncer` returned before this check ever ran, so those forges were never detected at
 *  all (owner report 2026-09-23: "i dont think the runeforge voicelines are playing?"). Both the return branch
 *  and the within-turn branch (a forge behind a quest offer or a Discover arrives on its own update) call this.
 *  The forge lines BYPASS the cooldown (never a playing line): the forge is a scheduled, once-per-run moment
 *  that takes the whole screen, and a Face Omen or verdict line followed by a short fight (or an early End
 *  Combat) would otherwise land the opening inside the previous line's 12 s and drop it for good. */
function detectForge(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, notBefore: number): void {
  if (p.runeforgeOffer || !run.runeforgeOffer) return;
  const event: AnnouncerEvent = run.runeforgeEpic ? 'epicRuneforge' : 'runeforge';
  if (!hasFired(s, event)) enqueue({ event, shelf: 'shop', notBefore, wave: run.wave, bypassCooldown: true });
}

// ── The moment catalog's first batch's detectors (owner 2026-09-25) ──────────────────────────────────────────
const hasHugeStat = (units: readonly { attack: number; health: number }[]): boolean =>
  units.some((u) => u.attack >= ANNOUNCER_HUGE_STAT || u.health >= ANNOUNCER_HUGE_STAT);
const boardTotal = (r: AnnouncerRunLike): number => r.board.reduce((n, c) => n + c.attack + c.health, 0);
const fullBoard = (r: AnnouncerRunLike): boolean => r.board.length >= ANNOUNCER_BOARD_SLOTS;
/** Every board slot holds a gilded minion. */
const allGolden = (r: AnnouncerRunLike): boolean => fullBoard(r) && r.board.every((c) => c.golden);
/** The tribes a board minion counts as (its own one or two; an All-tribe minion is every tribe, `'all'`). */
function tribesOf(cardId: string | undefined): readonly (Tribe | 'all')[] {
  const def = cardId ? CARD_INDEX[cardId] : undefined;
  if (!def || def.spell || def.ruby) return [];
  if (def.universalTribe) return ['all'];
  return [def.tribe, def.tribe2].filter((t): t is Tribe => !!t && t !== 'neutral');
}
/** TribeFullBoard: a full board whose every minion shares one tribe (an All-tribe minion fits any). */
export function isTribeFullBoard(r: AnnouncerRunLike): boolean {
  if (!fullBoard(r)) return false;
  const each = r.board.map((c) => tribesOf(c.cardId));
  if (each.some((t) => t.length === 0)) return false;
  const named = each.filter((t) => !t.includes('all'));
  if (!named.length) return true;
  return named[0]!.some((tribe) => named.every((t) => t.includes(tribe)));
}
/** MixedBoard: a full board spanning ANNOUNCER_MIXED_TRIBES+ different tribes (an All-tribe minion adds none). */
export function isMixedBoard(r: AnnouncerRunLike): boolean {
  if (!fullBoard(r)) return false;
  const seen = new Set<Tribe>();
  for (const c of r.board) for (const t of tribesOf(c.cardId)) if (t !== 'all') seen.add(t);
  return seen.size >= ANNOUNCER_MIXED_TRIBES;
}
const knockedOutCount = (r: AnnouncerRunLike): number => r.lobby?.seats.filter((x) => !x.alive).length ?? 0;
/** LobbyLast / LeaderboardTop: the player's Resolve against every other standing seat's (strictly lowest / highest). */
function standing(r: AnnouncerRunLike): 'last' | 'top' | null {
  const others = (r.lobby?.seats ?? []).slice(1).filter((x) => x.alive && typeof x.resolve === 'number');
  if (!others.length || !playerAlive(r)) return null;
  if (others.every((x) => r.resolve < x.resolve!)) return 'last';
  if (others.every((x) => r.resolve > x.resolve!)) return 'top';
  return null;
}
/** The run of identical results at the end of `h` (how many, and which). */
function trailingRun(h: readonly string[]): { result: string | null; length: number } {
  const last = h[h.length - 1];
  if (last === undefined) return { result: null, length: 0 };
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i] === last; i--) n++;
  return { result: last, length: n };
}

function enterRun(s: AnnouncerStateLike, prev: AnnouncerStateLike | null): void {
  cancelAnnouncer('run change');
  active = true;
  runKey = s.run.seed;
  lastLineEndedAt = -Infinity;
  lastLine = null;
  runEnteredAt = deps.now();
  enteredAtWaveOne = s.run.wave === 1 && s.run.phase === 'recruit';
  combatStartedAt = s.run.phase === 'combat' ? runEnteredAt : null;
  bigStatSeenThisCombat = false;
  hugeStatSeenThisCombat = false;
  oddsCheckedWave = -1;
  combatScan = null;
  combatSilenced = false;
  finalChecked = null;
  timeWarningWave = -1;
  specialtyTries = new Map();
  tribeBuys = { wave: -1, byTribe: new Map(), all: 0 };
  freshBatch3Tallies();
  if (enteredAtWaveOne && !hasFired(slice!, 'gameStart')) {
    enqueue({ event: 'gameStart', shelf: 'shop', notBefore: runEnteredAt + ANNOUNCER_GAME_START_DELAY_MS, wave: 1 });
  }
  // ResumeGame (the third batch): the title's Continue puts the SAME run object back on screen (`continueRun` never
  // touches `run`); every new-run path replaces it. Waits out the music's start like GameStart.
  if (prev && prev.showTitle && prev.run === s.run && !hasFired(slice!, 'resumeGame')) {
    enqueue({
      event: 'resumeGame', shelf: s.run.phase === 'combat' ? 'combat' : 'shop', notBefore: runEnteredAt + ANNOUNCER_GAME_START_DELAY_MS,
      wave: s.run.wave,
    });
  }
}

function leaveRun(): void {
  cancelAnnouncer('left the run');
  active = false;
  runKey = null;
  slice = null;
  mark = null;
  combatStartedAt = null;
}

/** Drive the announcer from a store update. Cheap: a few reads when the run object did not change. */
export function syncAnnouncer(s: AnnouncerStateLike, prev: AnnouncerStateLike | null): void {
  const want = isAnnouncerWanted(s);
  if (!want) {
    if (active) leaveRun();
    return;
  }
  const run = s.run;
  slice = announcedFor(s.announced, run.seed);
  mark = s.markAnnounced;
  if (!active || runKey !== run.seed) {
    enterRun(s, prev);
    return;
  }
  // UNDERDOG / FAVOURITE: the rail's pre-fight odds arrive on their own update (the deferred probe), before or
  // after the Face Omen flip, so this is weighed on any update once the fight is on and its odds are known.
  if (run.phase === 'combat' && !run.combatSettled && combatStartedAt !== null && oddsCheckedWave !== run.wave
    && s.combatOdds && s.combatOdds.wave === run.wave) {
    oddsCheckedWave = run.wave;
    const win = s.combatOdds.odds.win;
    const at = Math.max(deps.now(), combatStartedAt + ANNOUNCER_FACE_OMEN_DELAY_MS);
    if (win < ANNOUNCER_UNDERDOG_ODDS && !hasFired(slice, 'underdogOdds')) {
      enqueue({ event: 'underdogOdds', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    if (win > ANNOUNCER_FAVOURITE_ODDS && !hasFired(slice, 'heavyFavourite')) {
      enqueue({ event: 'heavyFavourite', shelf: 'combat', notBefore: at, wave: run.wave });
    }
  }
  const p = prev?.run;
  if (!p || p === run || p.seed !== run.seed) return;
  const now = deps.now();
  const acts = newActions(s, prev);

  // ── Phase flips ──
  if (p.phase !== 'combat' && run.phase === 'combat') {
    // FACE OMEN: the shop's lines are stale now; combat's silence window starts.
    expire('shop');
    combatStartedAt = now;
    bigStatSeenThisCombat = false;
    const at = now + ANNOUNCER_FACE_OMEN_DELAY_MS;
    if (run.resolve <= ANNOUNCER_LOW_RESOLVE && !hasFired(slice, 'startCombatUnder10hp')) {
      enqueue({ event: 'startCombatUnder10hp', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    const last2 = tail(run.history, 2);
    if (last2.length === 2 && last2.every((r) => r === 'lose') && !hasFired(slice, 'enteringCombatAfterLoss')) {
      enqueue({ event: 'enteringCombatAfterLoss', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    if (run.wave <= ANNOUNCER_ENTERING_COMBAT_MAX_WAVE && !hasFired(slice, 'enteringCombat')) {
      enqueue({ event: 'enteringCombat', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    hugeStatSeenThisCombat = false;
    combatScan = null;
    combatSilenced = false;
    finalChecked = null;
    // FinalShowdown: the last fight of the game, two players standing (the player one of them).
    if (run.lobby && playerAlive(run) && aliveSeats(run) === 2 && !hasFired(slice, 'finalShowdown')) {
      enqueue({ event: 'finalShowdown', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    // BrokeTurn: the Shop turn that just ended spent every Gold and bought nothing, past the opening rounds.
    // Both tallies must be KNOWN (absent = unknown, never assumed 0).
    if (p.wave > ANNOUNCER_BROKE_AFTER_WAVE && p.embers === 0 && p.cardsBoughtThisTurn === 0 && !hasFired(slice, 'brokeTurn')) {
      enqueue({ event: 'brokeTurn', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    detectFaceOmenBatch3(slice, p, run, at);
    return;
  }
  if (p.phase === 'combat' && run.phase === 'combat' && !p.combatSettled && run.combatSettled) {
    // THE VERDICT landed (the replay finished, or a draw settled): the outcome lines.
    const at = Math.max(now, (combatStartedAt ?? now) + ANNOUNCER_COMBAT_SILENCE_MS);
    const enteredLow = p.resolve <= ANNOUNCER_LOW_RESOLVE;
    if (enteredLow && run.resolve > 0 && !hasFired(slice, 'surviveUnder10hp')) {
      const afterOwnWarning = lastLine?.event === 'startCombatUnder10hp' && lastLine.wave === run.wave;
      enqueue({ event: 'surviveUnder10hp', shelf: 'combat', notBefore: at, wave: run.wave, bypassCooldown: afterOwnWarning });
    }
    const result = run.lastCombat?.result;
    const odds = s.combatOdds && s.combatOdds.wave === run.wave ? s.combatOdds.odds : null;
    if (odds && result === 'lose' && odds.win >= ANNOUNCER_HIGH_ODDS && !hasFired(slice, 'losingLowOddsFight')) {
      enqueue({ event: 'losingLowOddsFight', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    if (odds && result === 'win' && odds.win <= ANNOUNCER_LOW_ODDS && !hasFired(slice, 'winningLowOddsFight')) {
      enqueue({ event: 'winningLowOddsFight', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    const last3 = tail(run.history, 3);
    if (last3.length === 3 && last3.every((r) => r === 'win') && !hasFired(slice, 'threeWinStreak')) {
      enqueue({ event: 'threeWinStreak', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    if (result === 'win') {
      // ComebackWin: this win ends a run of ANNOUNCER_COMEBACK_LOSSES+ losses in a row (a draw breaks the run).
      const before = run.history.slice(0, -1);
      let losses = 0;
      for (let i = before.length - 1; i >= 0 && before[i] === 'lose'; i--) losses++;
      if (losses >= ANNOUNCER_COMEBACK_LOSSES && !hasFired(slice, 'comebackWin')) {
        enqueue({ event: 'comebackWin', shelf: 'combat', notBefore: at, wave: run.wave });
      }
      // FlawlessVictory: no friendly minion died (the sim's raw death count; absent = unknown, never assumed 0).
      if (run.wave >= ANNOUNCER_FLAWLESS_MIN_WAVE && run.lastCombat?.playerDeaths === 0 && !hasFired(slice, 'flawlessVictory')) {
        enqueue({ event: 'flawlessVictory', shelf: 'combat', notBefore: at, wave: run.wave });
      }
      // BigHit: the damage the opposing hero takes, round-capped exactly as the lobby charges it and the fight's
      // damage readout shows it (`lossDamageCap`).
      const dealt = Math.min(run.lastCombat?.enemyDamage ?? 0, lossDamageCap(run.wave));
      if (dealt >= ANNOUNCER_BIG_HIT && !hasFired(slice, 'bigHit')) {
        enqueue({ event: 'bigHit', shelf: 'combat', notBefore: at, wave: run.wave });
      }
    }
    detectVerdict(slice, p, run, result, at);
    detectVerdictBatch3(slice, p, run, result, at);
    return;
  }
  if (p.phase === 'combat' && run.phase === 'recruit') {
    // BACK TO THE SHOP: the fight's lines are stale; the rail shows the round's eliminations now. Every line of
    // this moment shares one `at`, so they are weighed TOGETHER by priority after the return wipe.
    expire('combat');
    combatStartedAt = null;
    const at = now + ANNOUNCER_BACK_TO_SHOP_DELAY_MS;
    const alive = aliveSeats(run);
    if (run.lobby && playerAlive(run)) {
      if (alive <= 2 && !hasFired(slice, 'topTwo')) enqueue({ event: 'topTwo', shelf: 'shop', notBefore: at, wave: run.wave });
      else if (alive <= 4 && !hasFired(slice, 'topFour')) enqueue({ event: 'topFour', shelf: 'shop', notBefore: at, wave: run.wave });
      // KNOCKOUT: the round the player just fought knocked their foe out. The table settles HERE (resolveCombat), not
      // at the verdict, so the line lands with the rail's elimination instead of announcing it mid-fight.
      if (knockedOutFoe(p, run) && repeatAllowed(slice, 'knockout', run.wave, ANNOUNCER_KNOCKOUT_MAX, ANNOUNCER_KNOCKOUT_GAP_WAVES)) {
        enqueue({ event: 'knockout', shelf: 'shop', notBefore: at, wave: run.wave });
      }
    }
    if ((run.embers ?? 0) >= ANNOUNCER_RICH_GOLD && !hasFired(slice, 'richTurn')) {
      enqueue({ event: 'richTurn', shelf: 'shop', notBefore: at, wave: run.wave });
    }
    if (run.wave === ANNOUNCER_ROUND_SEVEN && !hasFired(slice, 'round7')) { // the chance table rolls (10%)
      enqueue({ event: 'round7', shelf: 'shop', notBefore: at, wave: run.wave });
    }
    detectReturn(slice, p, run, at);
    detectReturnBatch3(slice, p, run, at);
    // A forge that opens WITH the return (the turn-6 / turn-9 forges, a hero's turn-5 / turn-8 one, a booked
    // Clock forge) arrives in this same update: it outranks BackToShop, which is then dropped as outranked
    // (and stays unfired, so a later return may still hear it).
    detectForge(slice, p, run, at);
    if (run.wave >= ANNOUNCER_BACK_TO_SHOP_MIN_WAVE && repeatAllowed(slice, 'backToShop', run.wave, ANNOUNCER_BACK_TO_SHOP_MAX)) {
      enqueue({ event: 'backToShop', shelf: 'shop', notBefore: at, wave: run.wave });
    }
    return;
  }
  if (p.phase !== run.phase && (run.phase === 'gameover' || run.phase === 'victory')) {
    // THE END: the lines that never expire. Exactly 2nd has its own line (SecondPlace) in place of GameLoss.
    expire('combat');
    expire('shop');
    combatStartedAt = null;
    const placement = finalPlacement(run);
    const event: AnnouncerEvent = placement === 1 ? 'gameWon' : placement === 2 ? 'secondPlace' : 'gameLoss';
    if (!hasFired(slice, 'gameWon') && !hasFired(slice, 'gameLoss') && !hasFired(slice, 'secondPlace')) {
      enqueue({ event, shelf: 'never', notBefore: now + ANNOUNCER_END_DELAY_MS, wave: run.wave });
    }
    return;
  }

  // ── Within a shop turn ──
  if (run.phase === 'recruit') {
    if (equipmentCount(run) > equipmentCount(p) && !hasFired(slice, 'equipment')) {
      enqueue({ event: 'equipment', shelf: 'shop', notBefore: now + ANNOUNCER_EQUIPMENT_DELAY_MS, wave: run.wave });
    }
    if (countGolden(run) > countGolden(p) && repeatAllowed(slice, 'triple', run.wave, ANNOUNCER_TRIPLE_MAX)) {
      enqueue({ event: 'triple', shelf: 'shop', notBefore: now, wave: run.wave });
    }
    if (p.tier < 6 && run.tier >= 6 && !hasFired(slice, 'tierSix')) {
      enqueue({ event: 'tierSix', shelf: 'shop', notBefore: now, wave: run.wave });
    }
    detectForge(slice, p, run, now);
    if (!hasBigStat(p.board) && hasBigStat(run.board) && !hasFired(slice, 'minionHits100Stats')) {
      enqueue({ event: 'minionHits100Stats', shelf: 'shop', notBefore: now, wave: run.wave });
    }
    if (p.board !== run.board && boardGolden(p) < ANNOUNCER_GOLDEN_ARMY && boardGolden(run) >= ANNOUNCER_GOLDEN_ARMY && !hasFired(slice, 'goldenArmy')) {
      enqueue({ event: 'goldenArmy', shelf: 'shop', notBefore: now, wave: run.wave });
    }
    if (!hasFired(slice, 'bigSpender') && !isBigSpender(p) && isBigSpender(run)) {
      enqueue({ event: 'bigSpender', shelf: 'shop', notBefore: now, wave: run.wave });
    }
    if (!hasFired(slice, 'shopBigBuff') && p.shop !== run.shop && !shopHasBigAttack(p) && shopHasBigAttack(run)) {
      enqueue({ event: 'shopBigBuff', shelf: 'shop', notBefore: now, wave: run.wave });
    }
    if (!hasFired(slice, 'pair') && (p.board !== run.board || p.hand !== run.hand) && !hasPair(p) && hasPair(run)) {
      enqueue({ event: 'pair', shelf: 'shop', notBefore: now, wave: run.wave });
    }
    detectBuy(slice, p, run, now);
    // CastAle: a spell was cast and an Ale left the hand (an Ale cast from hand, not one a minion or rune casts).
    if ((run.spellsCast ?? 0) > (p.spellsCast ?? 0) && aleCount(run) < aleCount(p)) trySpecialty(slice, 'castAle', run.wave, now);
    detectShopTurn(slice, p, run, now);
    detectShopBatch3(slice, p, run, now, acts, s.replayActions);
  }
}

/** The fight's verdict: the catalog's result and streak lines. `at` is the verdict lines' shared time. */
function detectVerdict(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, result: string | undefined, at: number): void {
  const w = run.wave;
  // Stalemate: the first draw of the game.
  if (result === 'draw' && !hasFired(s, 'stalemate')) enqueue({ event: 'stalemate', shelf: 'combat', notBefore: at, wave: w });
  // OneResolve: the fight leaves the player on exactly 1 Resolve.
  if (run.resolve === 1 && p.resolve !== 1 && !hasFired(s, 'oneResolve')) enqueue({ event: 'oneResolve', shelf: 'combat', notBefore: at, wave: w });
  // ArmorGone: Armor hits 0 for the first time.
  if ((p.armor ?? 0) > 0 && (run.armor ?? 0) === 0 && !hasFired(s, 'armorGone')) enqueue({ event: 'armorGone', shelf: 'combat', notBefore: at, wave: w });
  // BlowoutLoss: a loss that cost the round's full damage cap (Armor + Resolve taken; rounds past the cap never qualify).
  const cap = lossDamageCap(w);
  const taken = (p.resolve + (p.armor ?? 0)) - (run.resolve + (run.armor ?? 0));
  if (result === 'lose' && Number.isFinite(cap) && taken >= cap && !hasFired(s, 'blowoutLoss')) {
    enqueue({ event: 'blowoutLoss', shelf: 'combat', notBefore: at, wave: w });
  }
  const streak = trailingRun(run.history);
  if (streak.result === 'win' && streak.length === ANNOUNCER_FIVE_STREAK && !hasFired(s, 'fiveWinStreak')) {
    enqueue({ event: 'fiveWinStreak', shelf: 'combat', notBefore: at, wave: w });
  }
  if (result === 'lose' && streak.length === ANNOUNCER_LOSING_STREAK && !hasFired(s, 'losingStreak')) {
    enqueue({ event: 'losingStreak', shelf: 'combat', notBefore: at, wave: w });
  }
  // StreakBroken: this loss ends a win streak of ANNOUNCER_STREAK_BROKEN+.
  if (result === 'lose' && trailingRun(run.history.slice(0, -1)).result === 'win'
    && trailingRun(run.history.slice(0, -1)).length >= ANNOUNCER_STREAK_BROKEN && !hasFired(s, 'streakBroken')) {
    enqueue({ event: 'streakBroken', shelf: 'combat', notBefore: at, wave: w });
  }
}

/** Back in the Shop: the catalog's lobby and round lines. `at` is the return lines' shared time. */
function detectReturn(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, at: number): void {
  const w = run.wave;
  if (run.lobby && playerAlive(run)) {
    const outNow = knockedOutCount(run);
    // FirstOut: the lobby's first knockout (someone else: the player is still standing).
    if (knockedOutCount(p) === 0 && outNow > 0 && !hasFired(s, 'firstOut')) enqueue({ event: 'firstOut', shelf: 'shop', notBefore: at, wave: w });
    // PlayersRemain: someone else went out and 5 or 3 are left.
    if (outNow > knockedOutCount(p) && ANNOUNCER_PLAYERS_REMAIN.includes(aliveSeats(run))
      && repeatAllowed(s, 'playersRemain', w, ANNOUNCER_PLAYERS_REMAIN.length, 1)) {
      enqueue({ event: 'playersRemain', shelf: 'shop', notBefore: at, wave: w });
    }
    // LobbyLast / LeaderboardTop: the lowest / highest Resolve at the table, past the opening rounds.
    if (w > ANNOUNCER_STANDINGS_AFTER_WAVE) {
      const where = standing(run);
      if (where === 'last' && !hasFired(s, 'lobbyLast')) enqueue({ event: 'lobbyLast', shelf: 'shop', notBefore: at, wave: w });
      if (where === 'top' && !hasFired(s, 'leaderboardTop')) enqueue({ event: 'leaderboardTop', shelf: 'shop', notBefore: at, wave: w });
    }
  }
  if (w > ANNOUNCER_LATE_GAME_ROUND && !hasFired(s, 'lateGame')) enqueue({ event: 'lateGame', shelf: 'shop', notBefore: at, wave: w });
  if (ANNOUNCER_ROUND_MILESTONES.includes(w) && repeatAllowed(s, 'roundMilestone', w, ANNOUNCER_ROUND_MILESTONES.length, 1)) {
    enqueue({ event: 'roundMilestone', shelf: 'shop', notBefore: at, wave: w });
  }
  detectArmorUp(s, p, run, at);
}

function detectArmorUp(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, at: number): void {
  if ((p.armor ?? 0) < ANNOUNCER_ARMOR_UP && (run.armor ?? 0) >= ANNOUNCER_ARMOR_UP && !hasFired(s, 'armorUp')) {
    enqueue({ event: 'armorUp', shelf: 'shop', notBefore: at, wave: run.wave });
  }
}

/** BlartChronos (the owner's own moment, 2026-09-25: "When bob blart and chronos are both on the player's warband for
 *  the first time"): Bob Blart (`dm_gourmand`) and Chronos on the board together. */
export const ANNOUNCER_BLART_CHRONOS: readonly string[] = ['dm_gourmand', 'chronos'];
const hasAll = (r: AnnouncerRunLike, ids: readonly string[]): boolean => ids.every((id) => r.board.some((c) => c.cardId === id));

/** Within a Shop turn: the catalog's economy, tier and board lines. */
function detectShopTurn(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, now: number): void {
  const w = run.wave;
  const q = (event: AnnouncerEvent): void => enqueue({ event, shelf: 'shop', notBefore: now, wave: w });
  if (p.board !== run.board && !hasAll(p, ANNOUNCER_BLART_CHRONOS) && hasAll(run, ANNOUNCER_BLART_CHRONOS) && !hasFired(s, 'blartChronos')) q('blartChronos');
  // TierUp: an upgrade to tier 2-5 (TierSix has its own line). FastTier: tier 4 by round 5 / tier 6 by round 9.
  if (run.tier > p.tier) {
    if (run.tier >= 2 && run.tier <= 5 && repeatAllowed(s, 'tierUp', w, 4, 0)) q('tierUp');
    if (ANNOUNCER_FAST_TIERS.some((f) => p.tier < f.tier && run.tier >= f.tier && w <= f.byWave) && repeatAllowed(s, 'fastTier', w, ANNOUNCER_FAST_TIERS.length, 0)) q('fastTier');
  }
  const soldBefore = p.soldThisTurn?.length ?? 0;
  const soldNow = run.soldThisTurn?.length ?? 0;
  if (soldBefore < ANNOUNCER_SELL_SPREE && soldNow >= ANNOUNCER_SELL_SPREE && !hasFired(s, 'sellSpree')) q('sellSpree');
  // SellGilded: a sale on the update a gilded minion left the board / hand.
  if (soldNow > soldBefore && countGolden(run) < countGolden(p) && !hasFired(s, 'sellGilded')) q('sellGilded');
  if ((p.spellsThisTurn ?? 0) < ANNOUNCER_SPELL_CHAIN && (run.spellsThisTurn ?? 0) >= ANNOUNCER_SPELL_CHAIN && !hasFired(s, 'spellChain')) q('spellChain');
  if ((p.playedThisTurn?.length ?? 0) < ANNOUNCER_BIG_TURN && (run.playedThisTurn?.length ?? 0) >= ANNOUNCER_BIG_TURN && !hasFired(s, 'bigTurn')) q('bigTurn');
  if (p.board !== run.board) {
    if (!allGolden(p) && allGolden(run) && !hasFired(s, 'allGolden')) q('allGolden');
    if (!fullBoard(p) && fullBoard(run) && !hasFired(s, 'fullBoard')) q('fullBoard');
    if (!hasHugeStat(p.board) && hasHugeStat(run.board) && !hasFired(s, 'minionHits250')) q('minionHits250');
    const before = boardTotal(p), after = boardTotal(run);
    if (ANNOUNCER_BOARD_TOTALS.some((t) => before < t && after >= t) && repeatAllowed(s, 'boardTotal', w, ANNOUNCER_BOARD_TOTALS.length, 0)) q('boardTotal');
    if (!isTribeFullBoard(p) && isTribeFullBoard(run) && !hasFired(s, 'tribeFullBoard')) q('tribeFullBoard');
    if (!isMixedBoard(p) && isMixedBoard(run) && !hasFired(s, 'mixedBoard')) q('mixedBoard');
  }
  detectArmorUp(s, p, run, now);
}

// ── The moment catalog's third batch's detectors (owner 2026-09-25, group C) ─────────────────────────────────
// Every read here is a cheap diff of fields the update already carries (or of the actions it appended); the only
// walk of the whole action log is HeroPowerBig's count, and only on an update that used the hero power.

/** The actions this store update appended to the run's log (none when the log was replaced: a new run, a load). */
function newActions(s: AnnouncerStateLike, prev: AnnouncerStateLike | null): readonly AnnouncerActionLike[] {
  const now = s.replayActions;
  const before = prev?.replayActions;
  if (!now || !before || now === before || now.length <= before.length) return [];
  return now.slice(before.length);
}
/** The default foe read: the lobby's own pairing for this round (a ghost when the player holds the bye). */
function lobbyFoe(run: AnnouncerRunLike): AnnouncerFoe | null {
  if (!run.lobby) return null;
  try {
    const o = playerOpponent(run.lobby as unknown as RunLobby);
    if (!o) return null;
    return { seatId: o.seat.id, ghost: !!o.ghost, tier: o.board.tier, topTribe: boardIntel(o.board, run.lobby.round ?? run.wave).topTribe };
  } catch {
    return null; // a partial (hand-built) lobby
  }
}
/** The player's board's main tribe, by the same count the scout card uses for a foe's (`boardIntel`). */
function playerTopTribe(run: AnnouncerRunLike): string | undefined {
  const minions = run.board.filter((c) => !!c.cardId).map((c) => ({ cardId: c.cardId! }));
  return boardIntel({ minions } as unknown as PreparedBoard, run.wave).topTribe;
}
/** A seat's win streak going into this round: its newest FOUGHT results, counted while they are wins. */
function winStreakOf(run: AnnouncerRunLike, seatId: string): number {
  const encounters = run.lobby?.encounters ?? [];
  const round = run.lobby?.round ?? Infinity;
  let n = 0;
  for (let i = encounters.length - 1; i >= 0; i--) {
    const e = encounters[i]!;
    if (e.round >= round || e.fought === false || e.bye || (e.a !== seatId && e.b !== seatId)) continue;
    const won = e.a === seatId ? e.outcome === 'win' : e.outcome === 'lose';
    if (!won) break;
    n++;
  }
  return n;
}
/** Rematch: the seat(s) that dealt the player's single biggest hit so far (none before the player is first hit). */
function hardestHitters(run: AnnouncerRunLike): readonly string[] {
  let best = 0;
  let who: string[] = [];
  for (const e of run.lobby?.encounters ?? []) {
    if (e.bye || (e.a !== 's0' && e.b !== 's0')) continue;
    const taken = e.a === 's0' ? e.damageToA : e.damageToB;
    const foe = e.a === 's0' ? e.b : e.a;
    if (taken > best) { best = taken; who = [foe]; } else if (taken === best && taken > 0 && !who.includes(foe)) who.push(foe);
  }
  return who;
}
const golemCount = (units: readonly { cardId?: string | undefined }[]): number =>
  units.filter((u) => u.cardId === ANNOUNCER_BATCH_3_CARDS.golem).length;
/** Flo Rida's buff on the board and hand, summed (addBuff labels each gain with the buffing card's name). */
const FLO_RIDA_SOURCE = CARD_INDEX[ANNOUNCER_BATCH_3_CARDS.floRida]?.name ?? 'Flo Rida';
function floRidaBuffs(r: AnnouncerRunLike): number {
  let n = 0;
  for (const c of [...r.board, ...r.hand]) for (const b of c.buffs ?? []) if (b.source === FLO_RIDA_SOURCE) n += b.attack + b.health;
  return n;
}
/** Goldilox in hand grown PAST +20/+20 over its printed stats (gilded prints double). */
function goldiloxGrown(r: AnnouncerRunLike): boolean {
  const def = CARD_INDEX[ANNOUNCER_BATCH_3_CARDS.goldilox];
  if (!def) return false;
  return r.hand.some((c) => {
    if (c.cardId !== def.id || c.attack === undefined || c.health === undefined) return false;
    const k = c.golden ? 2 : 1;
    return c.attack - def.attack * k > ANNOUNCER_GOLDILOX_GROWTH && c.health - def.health * k > ANNOUNCER_GOLDILOX_GROWTH;
  });
}
/** RunePayout: a COUNTER rune (it has a live `x/N` tally, `runeTally`) reached its ANNOUNCER_RUNE_PAYOUTS-th payout. */
function runeHitThirdPayout(p: AnnouncerRunLike, run: AnnouncerRunLike): boolean {
  if (!run.runeProcs || run.runeProcs === p.runeProcs) return false;
  for (const [id, n] of Object.entries(run.runeProcs)) {
    if (n < ANNOUNCER_RUNE_PAYOUTS || (p.runeProcs?.[id] ?? 0) >= ANNOUNCER_RUNE_PAYOUTS) continue;
    try {
      if (runeTally(run as unknown as RunState, id) !== null) return true;
    } catch { /* a partial (test) run */ }
  }
  return false;
}
function questCompleted(p: AnnouncerRunLike, run: AnnouncerRunLike): boolean {
  return (run.activeQuests ?? []).some((q) => {
    const before = p.activeQuests?.find((x) => x.questId === q.questId);
    return (q.completed && !before?.completed) || (q.completionCount ?? 0) > (before?.completionCount ?? 0);
  });
}
/** A Discover opened (or the next queued one did): 10% (the chance table), a tier 6 minion Discover always. */
function detectDiscover(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, at: number): void {
  const d = run.discover;
  if (!d?.length || (p.discover && p.discover.join() === d.join()) || hasFired(s, 'discoverOpen')) return;
  discoversSeen++;
  const tierSix = d.every((id) => { const def = CARD_INDEX[id]; return !!def && !def.spell && !def.ruby && def.tier === ANNOUNCER_DISCOVER_ALWAYS_TIER; });
  enqueue({ event: 'discoverOpen', shelf: 'shop', notBefore: at, wave: run.wave, rollIndex: discoversSeen, certain: tierSix });
}
/** The lines a state change can carry in ANY phase (a payout at settle, a Start-of-Turn quest, …). */
function detectAnyPhaseBatch3(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, at: number, shelf: AnnouncerShelf): void {
  const q = (event: AnnouncerEvent): void => enqueue({ event, shelf, notBefore: at, wave: run.wave });
  if (!hasFired(s, 'runePayout') && runeHitThirdPayout(p, run)) q('runePayout');
  if (!hasFired(s, 'questComplete') && questCompleted(p, run)) q('questComplete');
  if (!hasFired(s, 'goldilox') && !goldiloxGrown(p) && goldiloxGrown(run)) q('goldilox');
}

/** Face Omen: the fight's pairing lines (Ghost, Outgunned, Mirror, Rematch) and FastTurn for the turn just ended. */
function detectFaceOmenBatch3(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, at: number): void {
  const q = (event: AnnouncerEvent): void => enqueue({ event, shelf: 'combat', notBefore: at, wave: run.wave });
  golemsSeenThisCombat = false;
  // FastTurn: the Shop clock still had 40+ s when End Turn landed, after 3+ buys (an unknown clock never counts).
  if ((p.cardsBoughtThisTurn ?? 0) >= ANNOUNCER_FAST_TURN_BUYS && clock.wave === p.wave && clock.seconds >= ANNOUNCER_FAST_TURN_SECONDS
    && !hasFired(s, 'fastTurn')) q('fastTurn');
  combatFoe = null;
  const foe = run.lobby ? deps.foe(run) : null;
  if (!foe) return;
  combatFoe = { wave: run.wave, seatId: foe.seatId, streak: foe.ghost ? 0 : winStreakOf(run, foe.seatId) };
  if (foe.ghost && !hasFired(s, 'ghostFight')) q('ghostFight');
  if (foe.tier - run.tier >= ANNOUNCER_OUTGUNNED_TIERS && !hasFired(s, 'outgunned')) q('outgunned');
  if (foe.topTribe === ANNOUNCER_TAKE_TRIBE && !hasFired(s, 'mirrorMatch') && playerTopTribe(run) === ANNOUNCER_TAKE_TRIBE) q('mirrorMatch');
  if (!hasFired(s, 'rematch') && hardestHitters(run).includes(foe.seatId)) q('rematch');
}

/** The verdict: StreakStopper, and the any-phase lines a settle can carry. */
function detectVerdictBatch3(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, result: string | undefined, at: number): void {
  if (result === 'win' && combatFoe?.wave === run.wave && combatFoe.streak >= ANNOUNCER_STREAK_STOPPER && !hasFired(s, 'streakStopper')) {
    enqueue({ event: 'streakStopper', shelf: 'combat', notBefore: at, wave: run.wave });
  }
  detectAnyPhaseBatch3(s, p, run, at, 'combat');
}

/** Back in the Shop: a quest offer or a Discover that opens with the turn, and the any-phase lines. */
function detectReturnBatch3(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, at: number): void {
  combatFoe = null;
  if (!p.questOffer?.length && run.questOffer?.length && !hasFired(s, 'questOffered')) {
    enqueue({ event: 'questOffered', shelf: 'shop', notBefore: at, wave: run.wave });
  }
  detectDiscover(s, p, run, at);
  detectAnyPhaseBatch3(s, p, run, at, 'shop');
}

/** Within a Shop turn: the third batch's economy, rune, card and special lines. */
function detectShopBatch3(
  s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, now: number,
  acts: readonly AnnouncerActionLike[], log: readonly AnnouncerActionLike[] | undefined,
): void {
  const w = run.wave;
  const q = (event: AnnouncerEvent, delay = 0): void => enqueue({ event, shelf: 'shop', notBefore: now + delay, wave: w });
  const once = (event: AnnouncerEvent): boolean => !hasFired(s, event);
  const did = (type: string): boolean => acts.some((a) => a.type === type);
  // Idle: any player action restarts the count (the clock's own window expiry is not the player acting).
  if (clock.wave === w && (!acts.length || acts.some((a) => a.type !== 'discountWindowExpired'))) clock.idleFrom = clock.seconds;
  // FirstFreeze: the player froze the Shop (the flag flipping on; an unfreeze is the same action).
  if (!p.frozen && run.frozen && once('firstFreeze')) q('firstFreeze');
  // RefreshStreak: the 5th Refresh this turn.
  if (refreshes.wave !== w) refreshes = { wave: w, n: 0 };
  const rolls = acts.filter((a) => a.type === 'roll').length;
  if (rolls) {
    refreshes.n += rolls;
    if (refreshes.n >= ANNOUNCER_REFRESH_STREAK && once('refreshStreak')) q('refreshStreak');
  }
  // GoldRush: Gold GAINED this turn (the Gold change plus the Gold spent on the same update), less a sale's base
  // value (selling is not an effect). Both known tallies only.
  if (goldGained.wave !== w) goldGained = { wave: w, n: 0 };
  if (p.embers !== undefined && run.embers !== undefined) {
    const sold = Math.max(0, (run.soldThisTurn?.length ?? 0) - (p.soldThisTurn?.length ?? 0));
    const gained = (run.embers - p.embers) + ((run.goldSpentThisTurn ?? 0) - (p.goldSpentThisTurn ?? 0)) - sold * CONFIG.sellValue;
    if (gained > 0) goldGained.n += gained;
    if (goldGained.n >= ANNOUNCER_GOLD_RUSH && once('goldRush')) q('goldRush');
  }
  detectDiscover(s, p, run, now);
  // DiscoDanChain: the Setlist's last locked Discover resolved on turn 1 (nothing left open or queued).
  if (w === 1 && p.discover?.length && p.discoverLockTier !== undefined && !run.discover?.length && !run.discoverQueue?.length
    && once('discoDanChain')) q('discoDanChain');
  if (!p.questOffer?.length && run.questOffer?.length && once('questOffered')) q('questOffered');
  // The Runeforge: the pick, the skip, the re-roll; three sockets full; the seasonal rune.
  if (did('buyRune') && once('runePick')) q('runePick');
  if (did('skipRuneforge') && once('runeSkip')) q('runeSkip');
  if (did('rerollRuneforge') && once('runeReroll')) q('runeReroll');
  const runesBefore = p.ownedRunes?.length ?? 0;
  const runesNow = run.ownedRunes?.length ?? 0;
  if (runesBefore < ANNOUNCER_RUNE_SOCKETS && runesNow >= ANNOUNCER_RUNE_SOCKETS && once('runeSlotsFull')) q('runeSlotsFull');
  if (runesNow > runesBefore && run.ownedRunes?.includes(ANNOUNCER_BATCH_3_RUNES.happyBirthday)
    && !p.ownedRunes?.includes(ANNOUNCER_BATCH_3_RUNES.happyBirthday) && once('seasonalRune')) q('seasonalRune');
  // EquipmentUsed: the first activation (the per-turn count rising). Lets the Equipment SFX land first.
  if ((run.equipmentActivationsThisTurn ?? 0) > (p.equipmentActivationsThisTurn ?? 0) && once('equipmentUsed')) {
    q('equipmentUsed', ANNOUNCER_EQUIPMENT_DELAY_MS);
  }
  // HeroPowerBig: the 10th hero power this game (the whole log's count, read only when one was just used).
  if (did('heroPower') && once('heroPowerBig') && (log ?? []).filter((a) => a.type === 'heroPower').length >= ANNOUNCER_HERO_POWER_BIG) {
    q('heroPowerBig');
  }
  // BigBuffMoment: one buff event of +20/+20 or more on one minion.
  if ((run.recruitFxSeq ?? 0) > (p.recruitFxSeq ?? 0) && once('bigBuffMoment')
    && (run.recruitBuffFx ?? []).some((b) => b.attack >= ANNOUNCER_BIG_BUFF && b.health >= ANNOUNCER_BIG_BUFF)) q('bigBuffMoment');
  // The special Rubies' riders (a per-action payload): Dark Ruby's devour (only stamped when it ate a Shop minion),
  // and a Ripple that landed 4+ times (each 'ripple' stamp is one cast that lands twice) under Rune of Resonance.
  if ((run.rubyRiderFxSeq ?? 0) > (p.rubyRiderFxSeq ?? 0)) {
    const riders = run.rubyRiderFx ?? [];
    if (riders.some((r) => r.rider === 'devour') && once('darkRuby')) q('darkRuby');
    if (riders.filter((r) => r.rider === 'ripple').length * 2 >= ANNOUNCER_RIPPLE_LANDINGS
      && run.ownedRunes?.includes(ANNOUNCER_BATCH_3_RUNES.resonance) && once('rippleResonance')) q('rippleResonance');
  }
  // StarformCollapse: a collapse whose Starform (a Shop offer) stood over 30 Attack.
  if ((run.starformFxSeq ?? 0) > (p.starformFxSeq ?? 0) && once('starformCollapse')) {
    const big = (run.starformFx ?? []).some((f) => {
      if (f.kind !== 'collapse') return false;
      const offer = p.shop?.find((o) => o.uid === f.fromUid);
      return !!offer && offerAttack(p, offer) > ANNOUNCER_STARFORM_ATTACK;
    });
    if (big) q('starformCollapse');
  }
  if (once('floRida') && floRidaBuffs(run) > floRidaBuffs(p)) q('floRida');
  if (once('gemheartGolem') && golemCount(p.board) < ANNOUNCER_GOLEM_ARMY && golemCount(run.board) >= ANNOUNCER_GOLEM_ARMY) q('gemheartGolem');
  // The cards that left the hand on a play: ChooseOnePlay / BothEffects, YazzusDouble, GreatPot.
  if (acts.some((a) => a.type === 'play' || a.type === 'chooseOne' || a.type === 'battlecryTarget')) {
    for (const card of p.hand) {
      if (!card.uid || !card.cardId || run.hand.some((c) => c.uid === card.uid)) continue;
      const def = CARD_INDEX[card.cardId];
      if (!def) continue;
      const play = acts.find((a) => a.uid === card.uid);
      if (def.chooseOne?.length) {
        if (once('chooseOnePlay')) q('chooseOnePlay');
        // Both branches resolved: the Choose One never asked (no prompt was open for it) because both were active.
        const asked = !!p.chooseOne;
        if (!asked && once('bothEffects') && chooseBothActive(chooseBothStateOf(p as unknown as RunState), card, def)) q('bothEffects');
      }
      if ((def.spell || def.ruby || def.giftMulticast) && def.target && !def.singleCast && play?.targetUid
        && p.board.some((c) => c.cardId === ANNOUNCER_BATCH_3_CARDS.yazzus) && once('yazzusDouble')) q('yazzusDouble');
      if ((def.id === ANNOUNCER_BATCH_3_CARDS.greatPot || def.id === ANNOUNCER_BATCH_3_CARDS.picnic) && p.board.length >= ANNOUNCER_BOARD_SLOTS
        && once('greatPot')) q('greatPot');
    }
  }
  detectAnyPhaseBatch3(s, p, run, now, 'shop');
}
// ── end of the third batch's detectors ──

/** The combat replay's PLAYER units at the current beat (Recruit hands them in per frame): MinionHits100Stats and
 *  MinionHits250 during a fight. Ghost / enemy boards are never passed. Each once per fight, only while the fight is on. */
export function observeCombatBoard(units: readonly { attack: number; health: number; cardId?: string | undefined }[], wave: number): void {
  if (!active || !slice || combatStartedAt === null) return;
  const at = Math.max(deps.now(), combatStartedAt + ANNOUNCER_COMBAT_SILENCE_MS);
  // GemheartGolem (the third batch): 3+ Golems on the player's side mid-fight (Gemheart Carver's Echo summons them).
  if (!golemsSeenThisCombat && !hasFired(slice, 'gemheartGolem') && golemCount(units) >= ANNOUNCER_GOLEM_ARMY) {
    golemsSeenThisCombat = true;
    enqueue({ event: 'gemheartGolem', shelf: 'combat', notBefore: at, wave });
  }
  if (!bigStatSeenThisCombat && !hasFired(slice, 'minionHits100Stats') && hasBigStat(units)) {
    bigStatSeenThisCombat = true;
    enqueue({ event: 'minionHits100Stats', shelf: 'combat', notBefore: at, wave });
  }
  if (!hugeStatSeenThisCombat && !hasFired(slice, 'minionHits250') && hasHugeStat(units)) {
    hugeStatSeenThisCombat = true;
    enqueue({ event: 'minionHits250', shelf: 'combat', notBefore: at, wave });
  }
}

/** What the combat replay hands in as it advances (Recruit, on every beat): the fight's identity, its opening
 *  boards, the replay's event order and cursor (`processedEnd`: everything before it is on screen), the live frame
 *  and, for WardBreak, the frame at any event index. */
export interface CombatReplayView {
  combat: object | null | undefined;
  initial: { player: readonly MinionSnapshot[]; enemy: readonly MinionSnapshot[] } | null | undefined;
  events: readonly CombatEvent[];
  end: number;
  done: boolean;
  result: string | null | undefined;
  frame: { player: readonly UnitStats[]; enemy: readonly UnitStats[] };
  frameAt?: FrameAt;
}

/** THE IN-FIGHT MOMENTS (the moment catalog's second batch, owner 2026-09-25: "At the moment"): each line queues
 *  when the replay SHOWS its moment, on the combat shelf, never inside the first ANNOUNCER_COMBAT_SILENCE_MS of the
 *  fight. The fold is cumulative through the cursor, so a re-seek back rebuilds it (the moments this fight already
 *  reached stay reached) and nothing counts twice. After a Skip the fight's remaining in-fight lines stay silent;
 *  the final-frame verdicts (ClutchWin / NarrowLoss) still speak, like the other verdict lines. */
export function observeCombatMoments(v: CombatReplayView, wave: number): void {
  if (!active || !slice || combatStartedAt === null || !v.combat || !v.initial) return;
  if (!combatScan || combatScan.key !== v.combat || v.end < combatScan.scan.cursor) {
    const reached = combatScan?.key === v.combat ? combatScan.scan.fired : null;
    combatScan = { key: v.combat, scan: newCombatScan(v.initial) };
    if (reached) for (const m of reached) combatScan.scan.fired.add(m);
  }
  const found = scanCombat(combatScan.scan, v.events, v.end, v.frameAt);
  const at = Math.max(deps.now(), combatStartedAt + ANNOUNCER_COMBAT_SILENCE_MS);
  if (!combatSilenced) {
    for (const event of found) if (!hasFired(slice, event)) enqueue({ event, shelf: 'combat', notBefore: at, wave });
  }
  if (v.done && finalChecked !== v.combat) {
    finalChecked = v.combat;
    for (const event of finalMoments(v.result, v.frame)) if (!hasFired(slice, event)) enqueue({ event, shelf: 'combat', notBefore: at, wave });
  }
}

/** THE SHOP CLOCK (owner 2026-09-25, the "Low on time" lines): Recruit's countdown hands in every tick of a REAL
 *  timer (never the tutorial's or the God-rules sandbox's effectively infinite one; the gate already keeps the
 *  announcer out of both). EVERY Shop turn whose clock ticks down to ANNOUNCER_TIME_WARNING_SECONDS (15 s; owner:
 *  "the running out of time can play everytime theres 15 seconds left"), TimeRunningOut queues: exempt from
 *  once-per-game, priority 5, shop shelf (End Turn expires it), and it BYPASSES the 12 s cooldown because it is a
 *  warning, but never talks over a playing line: it waits for that line to end, and is dropped if the clock
 *  reaches 0 first. Its no-repeat bag reshuffles once all its takes are heard. Presentation-only: the engine is
 *  untimed. */
export function observeTurnClock(seconds: number, wave: number): void {
  if (!active || !slice) return;
  // The third batch (owner 2026-09-25) remembers the clock: FastTurn reads it at End Turn, Idle counts from the
  // last action's reading (a paused clock, a Discover or an aim, never counts as idle), TimeUp hears it reach 0.
  const before = clock.wave === wave ? clock.seconds : null;
  if (clock.wave !== wave) clock = { wave, seconds, idleFrom: seconds + 1 };
  else clock.seconds = seconds;
  if (seconds <= 0) {
    // Out of time: a warning still waiting behind a playing line has nothing left to warn about.
    if (pending.some((p) => p.event === 'timeRunningOut')) {
      pending = pending.filter((p) => p.event !== 'timeRunningOut');
      note('drop', 'timeRunningOut', { why: 'time up' });
    }
    // TimeUp: the clock ran out and locked the Shop (the game has no auto-End-Turn: the player still presses it).
    if ((before === null || before > 0) && combatStartedAt === null && !hasFired(slice, 'timeUp')) {
      enqueue({ event: 'timeUp', shelf: 'shop', notBefore: deps.now(), wave });
    }
    return;
  }
  if (combatStartedAt === null && clock.idleFrom - seconds >= ANNOUNCER_IDLE_SECONDS && !hasFired(slice, 'idle')) {
    clock.idleFrom = seconds; // one try per idle stretch
    enqueue({ event: 'idle', shelf: 'shop', notBefore: deps.now(), wave });
  }
  if (seconds !== ANNOUNCER_TIME_WARNING_SECONDS || timeWarningWave === wave || combatStartedAt !== null) return;
  timeWarningWave = wave;
  enqueue({ event: 'timeRunningOut', shelf: 'shop', notBefore: deps.now(), wave, bypassCooldown: true });
}

// ── The Announcer dev tuner's ▶ (owner 2026-09-24) ──────────────────────────────────────────────────────────
let previewHandle: AnnouncerHandle | null = null;
let previewToken = 0;
const previewNext = new Map<AnnouncerEvent, number>();
/** Play one of `event`'s lines NOW at its tuned volume, outside the queue (no cooldown, no cap, nothing marked).
 *  Each press moves to the next variant; a new press cuts the previous preview. Through the Announcer channel, so
 *  the Settings slider and mute apply. Returns the file it played (for the panel and the tests). */
export function previewAnnouncerEvent(event: AnnouncerEvent): string {
  const variants = ANNOUNCER_LINES[event];
  const i = (previewNext.get(event) ?? 0) % variants.length;
  previewNext.set(event, i + 1);
  const file = variants[i]!;
  previewHandle?.stop(ANNOUNCER_STOP_FADE_MS);
  previewHandle = null;
  const token = ++previewToken;
  const done = (): void => { if (token === previewToken) previewHandle = null; };
  let p: Promise<AnnouncerHandle | null>;
  try {
    p = deps.play(clipUrl(file), done, announcerEventVolume(event));
  } catch {
    p = Promise.resolve(null);
  }
  p.then((h) => { if (token === previewToken) previewHandle = h; else h?.stop(0); }, () => {});
  return file;
}

/** Read-only view for the DEV surface (`window.__announcer`) and the tests. */
export function announcerDebug(): {
  active: boolean; playing: AnnouncerEvent | null; pending: readonly { event: AnnouncerEvent; shelf: AnnouncerShelf; notBefore: number }[];
  lastLineEndedAt: number; level: number; log: readonly AnnouncerLogEntry[]; slice: AnnouncedSlice | null;
} {
  return {
    active, playing: playing?.event ?? null, pending: pending.map((p) => ({ event: p.event, shelf: p.shelf, notBefore: p.notBefore })),
    lastLineEndedAt, level: level(), log, slice,
  };
}

/** Tests only: back to a cold module (queue cleared, timers cleared, level untouched). */
export function resetAnnouncerForTests(): void {
  clearPump();
  playing?.handle?.stop(0);
  playing = null;
  pending = [];
  active = false;
  runKey = null;
  slice = null;
  mark = null;
  lastLineEndedAt = -Infinity;
  lastLine = null;
  runEnteredAt = 0;
  enteredAtWaveOne = false;
  combatStartedAt = null;
  bigStatSeenThisCombat = false;
  hugeStatSeenThisCombat = false;
  oddsCheckedWave = -1;
  combatScan = null;
  combatSilenced = false;
  finalChecked = null;
  timeWarningWave = -1;
  specialtyTries = new Map();
  tribeBuys = { wave: -1, byTribe: new Map(), all: 0 };
  freshBatch3Tallies();
  log.length = 0;
}

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as { __announcer?: { log: readonly AnnouncerLogEntry[]; debug: typeof announcerDebug } }).__announcer = { log, debug: announcerDebug };
}
