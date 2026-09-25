import type { AnnouncerEvent } from './announcerSlice';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV tuner + the ONE config accessor for THE ANNOUNCER's per-event mix (owner ask 2026-09-24): *"add an announcer
 * tuner to the dev panel that has volume for each event, and a timing adjust that allows me to offset timing of the
 * event earlier or later"*.
 *
 * Three knobs per event (every key of `ANNOUNCER_LINES` in announcer.ts; `<event>Chance`, the percent chance the
 * line speaks when its moment happens, was added 2026-09-25 and defaults to `ANNOUNCER_CHANCE` below):
 *  · `<event>Vol`: a percentage (0 to 200, 100 = as recorded) multiplied into that line's gain, on top of the Announcer channel's
 *    level. The final gain is clamped at 1 (`announcerLineGain`), so a boost can never clip past full scale.
 *  · `<event>Offset`: milliseconds added to the event's built-in delay (Face Omen 1600, back to shop 1000,
 *    Equipment 400, the end lines 1000, Game Start 4000 from the run landing, 0 for the in-shop moments). Negative
 *    fires earlier, but never before the moment is detected (the queue clamps it to "now"). The cooldown, the cap
 *    and the shelf life are untouched: the cooldown still counts from when the previous line ACTUALLY ended.
 *
 * Prod ignores localStorage and ships DEFAULTS (the castPreviewConfig pattern); "bake" = paste the panel's Copy
 * values into DEFAULTS. This module imports nothing from announcer.ts (announcer.ts reads it), so no cycle.
 */

/** Every announcer event, in the tuner's display order (the moment order of a game, roughly). Kept in step with
 *  `ANNOUNCER_LINES` by `announcerConfig.test.ts`. */
export const ANNOUNCER_TUNER_EVENTS = [
  'gameStart', 'equipment', 'triple', 'tierSix', 'runeforge', 'epicRuneforge', 'minionHits100Stats',
  'goldenArmy', 'bigSpender', 'shopBigBuff', 'pair', 'tribeFour',
  'randomCardBuy', 'randomSpellBuy', 'randomBeastBuy', 'randomDwarfBuy', 'buyDrakko', 'buySylus', 'castAle', 'timeRunningOut',
  'enteringCombat', 'enteringCombatAfterLoss', 'startCombatUnder10hp',
  'surviveUnder10hp', 'losingLowOddsFight', 'winningLowOddsFight', 'comebackWin', 'threeWinStreak',
  'flawlessVictory', 'bigHit',
  'backToShop', 'richTurn', 'round7', 'knockout', 'topFour', 'topTwo', 'gameWon', 'gameLoss',
  // The moment catalog's first batch (owner 2026-09-25), in the same rough game order.
  'tierUp', 'fastTier', 'sellSpree', 'sellGilded', 'spellChain', 'bigTurn', 'fullBoard', 'allGolden', 'boardTotal',
  'minionHits250', 'armorUp', 'tribeFullBoard', 'mixedBoard',
  'brokeTurn', 'finalShowdown', 'underdogOdds', 'heavyFavourite',
  'stalemate', 'oneResolve', 'armorGone', 'blowoutLoss', 'fiveWinStreak', 'losingStreak', 'streakBroken',
  'firstOut', 'playersRemain', 'lobbyLast', 'leaderboardTop', 'lateGame', 'roundMilestone', 'secondPlace',
  // The second batch (owner 2026-09-25): in-fight moments, then the final-frame verdicts.
  'sameCardDuel', 'firstBlood', 'overkill', 'wardBreak', 'rebirth', 'riseBack', 'avengeBig', 'echoChain', 'summonSwarm',
  'tauntWall', 'flurry', 'pummel', 'lastStand', 'executeKill', 'executeKing', 'clutchWin', 'narrowLoss',
  'blartChronos',
  // ── The moment catalog's third batch (owner 2026-09-25, group C), in the same rough game order ──
  'resumeGame', 'firstFreeze', 'refreshStreak', 'goldRush', 'tribeBuyLines', 'discoverOpen', 'discoDanChain', 'questOffered',
  'questComplete', 'chooseOnePlay', 'bothEffects', 'bigBuffMoment', 'equipmentUsed', 'heroPowerBig', 'runePick', 'runeSkip',
  'runeReroll', 'runeSlotsFull', 'seasonalRune', 'runePayout', 'darkRuby', 'rippleResonance', 'greatPot', 'yazzusDouble',
  'starformCollapse', 'floRida', 'goldilox', 'gemheartGolem', 'idle', 'timeUp', 'fastTurn',
  'ghostFight', 'mirrorMatch', 'outgunned', 'rematch', 'streakStopper',
  // ── end of the third batch ──
] as const satisfies readonly AnnouncerEvent[];

type VolKey = `${AnnouncerEvent}Vol`;
type OffsetKey = `${AnnouncerEvent}Offset`;
type ChanceKey = `${AnnouncerEvent}Chance`;
export type AnnouncerTunerKey = VolKey | OffsetKey | ChanceKey;
export type AnnouncerTunerConfig = Record<AnnouncerTunerKey, number>;

/** The panel's group title per event: its name plus the built-in delay the offset rides on. */
const EVENT_LABEL: Record<AnnouncerEvent, string> = {
  gameStart: 'Game start (4000 ms after the first shop)',
  equipment: 'Equipment (400 ms)',
  triple: 'Triple (0 ms)',
  tierSix: 'Tier six (0 ms)',
  runeforge: 'Runeforge (1000 ms on the return, else 0)',
  epicRuneforge: 'Epic Runeforge (1000 ms on the return, else 0)',
  minionHits100Stats: 'Minion hits 100 stats (0 ms, 3 s into a fight)',
  enteringCombat: 'Entering combat (1600 ms)',
  enteringCombatAfterLoss: 'Entering combat after losses (1600 ms)',
  startCombatUnder10hp: 'Start combat under 10 (1600 ms)',
  surviveUnder10hp: 'Survive under 10 (verdict, 3 s into a fight)',
  losingLowOddsFight: 'Lost a favoured fight (verdict)',
  winningLowOddsFight: 'Won an underdog fight (verdict)',
  threeWinStreak: 'Three win streak (verdict)',
  backToShop: 'Back to shop (1000 ms)',
  topFour: 'Top four (1000 ms)',
  topTwo: 'Top two (1000 ms)',
  gameWon: 'Game won (1000 ms)',
  gameLoss: 'Game lost (1000 ms)',
  knockout: 'Knockout (1000 ms after the return)',
  bigHit: 'Big hit, 15+ to a hero (verdict)',
  comebackWin: 'Comeback win after 3+ losses (verdict)',
  flawlessVictory: 'Flawless victory, no deaths (verdict)',
  goldenArmy: 'Golden army, 3 gilded on board (0 ms)',
  richTurn: 'Rich turn, 20+ Gold (1000 ms after the return)',
  bigSpender: 'Big spender, 20 spent with 10 left (0 ms)',
  shopBigBuff: 'Shop minion over 50 Attack (0 ms)',
  pair: 'First pair (0 ms)',
  tribeFour: 'Four of a tribe bought this turn (0 ms)',
  randomSpellBuy: 'Random spell buy, 10% (0 ms)',
  randomCardBuy: 'Random card buy, 10% (0 ms)',
  randomBeastBuy: 'Random Beast buy, 10% (0 ms)',
  randomDwarfBuy: 'Random Dwarf buy, 10% (0 ms)',
  round7: 'Round 7, 10% (1000 ms after the return)',
  timeRunningOut: 'Time running out, 15 s left on the Shop clock, every turn (0 ms)',
  buyDrakko: 'Bought Drakko (0 ms)',
  buySylus: 'Bought Sylus (0 ms)',
  castAle: 'Cast an Ale from hand (0 ms)',
  tierUp: 'Tier up to 2-5 (0 ms)',
  fastTier: 'Fast tier: 4 by round 5 / 6 by round 9 (0 ms)',
  sellSpree: 'Sell spree, 4 sold this turn (0 ms)',
  sellGilded: 'Sold a gilded minion (0 ms)',
  spellChain: 'Spell chain, 4 cast this turn (0 ms)',
  bigTurn: 'Big turn, 5 played this turn (0 ms)',
  fullBoard: 'First full board (0 ms)',
  allGolden: 'Every slot gilded (0 ms)',
  boardTotal: 'Board total passes 500 / 1000 (0 ms)',
  minionHits250: 'Minion hits 250 stats (0 ms, 3 s into a fight)',
  armorUp: 'Armor 20+ (0 ms, 1000 ms on the return)',
  tribeFullBoard: 'Seven of one tribe (0 ms)',
  mixedBoard: 'Seven minions, 5+ tribes (0 ms)',
  brokeTurn: 'Broke turn: 0 Gold, nothing bought, after round 5 (1600 ms)',
  finalShowdown: 'Final showdown, 2 left (1600 ms)',
  underdogOdds: 'Underdog, under 20% (1600 ms, once the odds land)',
  heavyFavourite: 'Heavy favourite, over 90% (1600 ms, once the odds land)',
  stalemate: 'First draw (verdict)',
  oneResolve: 'Survived on 1 Resolve (verdict)',
  armorGone: 'Armor hits 0 (verdict)',
  blowoutLoss: 'Blowout loss, the full damage cap (verdict)',
  fiveWinStreak: 'Five win streak (verdict)',
  losingStreak: 'Second loss in a row (verdict)',
  streakBroken: 'Win streak of 3+ broken (verdict)',
  firstOut: 'First player knocked out (1000 ms after the return)',
  playersRemain: '5 or 3 players remain (1000 ms after the return)',
  lobbyLast: 'Lowest Resolve after round 8 (1000 ms after the return)',
  leaderboardTop: 'Highest Resolve after round 8 (1000 ms after the return)',
  lateGame: 'Past round 18 (1000 ms after the return)',
  roundMilestone: 'Round 10 / 15 / 20 (1000 ms after the return)',
  secondPlace: 'Finished 2nd (1000 ms)',
  sameCardDuel: 'Same tier 6 minion on both boards (in the fight, 3 s in)',
  firstBlood: 'First blood: the first death of the fight is theirs (as shown, 3 s in)',
  overkill: 'Overkill: one hit of 50+ (as shown, 3 s in)',
  wardBreak: 'Ward absorbs a lethal hit (as shown, 3 s in)',
  rebirth: 'Rebirth: a minion returns at full stats (as shown, 3 s in)',
  riseBack: 'Rise: a minion rises (as shown, 3 s in)',
  avengeBig: 'Third Avenge of the fight (as shown, 3 s in)',
  echoChain: 'Five Echoes in one fight (as shown, 3 s in)',
  summonSwarm: 'Ten summons in one fight (as shown, 3 s in)',
  tauntWall: 'Taunts absorb 5 attacks (as shown, 3 s in)',
  flurry: 'Flurry kills twice in one swing turn (as shown, 3 s in)',
  pummel: 'Pummel pays out (as shown, 3 s in)',
  lastStand: 'Last minion kills 3 (as shown, 3 s in)',
  executeKill: 'Execute kills a 50+ Health minion (as shown, 3 s in)',
  executeKing: 'Execute kills a 100+ Health minion (as shown, 3 s in)',
  clutchWin: 'Clutch win: one minion left at 3 Health or less (replay end)',
  narrowLoss: 'Narrow loss: their one minion at 3 Health or less (replay end)',
  blartChronos: 'Bob Blart and Chronos together on the board, first time (0 ms)',
  // ── The moment catalog's third batch (owner 2026-09-25, group C) ──
  resumeGame: 'Save & Continue reopened (4000 ms after the run lands)',
  firstFreeze: 'First Freeze of the game (0 ms)',
  refreshStreak: '5th Refresh in one turn (0 ms)',
  goldRush: '10+ Gold gained from effects in one turn (0 ms)',
  tribeBuyLines: 'Kobold buy, 6% (0 ms; the one take is the Kobold line)',
  discoverOpen: 'A Discover opens, 10%; tier 6 always (0 ms)',
  discoDanChain: 'Disco Dan finishes his turn-1 Discovers (0 ms)',
  questOffered: 'A quest is offered (0 ms; 1000 ms on the return)',
  questComplete: 'A quest completes (0 ms)',
  chooseOnePlay: 'First Choose One card played (0 ms)',
  bothEffects: 'A Choose One gets both effects (0 ms)',
  bigBuffMoment: 'One effect gives a minion +20/+20 (0 ms)',
  equipmentUsed: 'First Equipment use (400 ms)',
  heroPowerBig: 'Hero power used 10 times (0 ms)',
  runePick: 'Picked a rune (0 ms)',
  runeSkip: 'Left the Runeforge without a rune (0 ms)',
  runeReroll: 'Re-rolled the Runeforge (0 ms)',
  runeSlotsFull: 'All three rune sockets filled (0 ms)',
  seasonalRune: 'Picked Happy Birthday (0 ms)',
  runePayout: 'A counter rune pays out a 3rd time (0 ms; 1000 ms on the return)',
  darkRuby: 'A Dark Ruby eats a Shop minion (0 ms)',
  rippleResonance: 'Ripple Ruby lands 4 times under Resonance (0 ms)',
  greatPot: 'Great Pot / Picnic cast on a full board (0 ms)',
  yazzusDouble: 'Yazzus doubles a targeted spell from hand (0 ms)',
  starformCollapse: 'Starform over 30 Attack collapses (0 ms)',
  floRida: 'Flo Rida\'s Beast buff, first time in the Shop (0 ms)',
  goldilox: 'Goldilox past +20/+20 in hand (0 ms)',
  gemheartGolem: '3+ Gemheart Golems on board (0 ms, 3 s into a fight)',
  idle: 'No action for 20 s of Shop clock (0 ms)',
  timeUp: 'The Shop clock hits 0 (0 ms)',
  fastTurn: 'Turn ended with 40+ s left after 3+ buys (1600 ms)',
  ghostFight: 'Facing a ghost (1600 ms)',
  mirrorMatch: 'Kobold board against a Kobold board (1600 ms)',
  outgunned: 'Foe\'s tier 2+ above yours (1600 ms)',
  rematch: 'Facing whoever hit you hardest (1600 ms)',
  streakStopper: 'Beat a foe on a 3+ win streak (verdict)',
};

/**
 * THE CHANCE TABLE (owner 2026-09-25: *"we need to have low-ish chances to proc the on-buy style ones except for
 * specialty targeted ones, like drakko/sylus etc."*): the chance, 0 to 1, that an event SPEAKS when its moment
 * happens. The ONE place to tune it; the Announcer tuner's per-event Chance dial (percent) defaults to these. 1 =
 * every time. A chance below 1 rolls the seeded `announcerRoll` (run seed + event + wave + index), so a replay
 * rolls the same way.
 */
export const ANNOUNCER_CHANCE: Record<(typeof ANNOUNCER_TUNER_EVENTS)[number], number> = Object.fromEntries(
  ANNOUNCER_TUNER_EVENTS.map((e) => [e, 1]),
) as Record<(typeof ANNOUNCER_TUNER_EVENTS)[number], number>;
// The generic buy lines: 6% per qualifying buy (was 10%, owner 2026-09-25).
ANNOUNCER_CHANCE.randomCardBuy = 0.06;
ANNOUNCER_CHANCE.randomSpellBuy = 0.06;
ANNOUNCER_CHANCE.randomBeastBuy = 0.06;
ANNOUNCER_CHANCE.randomDwarfBuy = 0.06;
// Round 7: 10% when wave 7's Shop opens (owner ruling 2026-09-24, unchanged).
ANNOUNCER_CHANCE.round7 = 0.1;
// The moment catalog's third batch (owner 2026-09-25): the catalog's own chances. A tier 6 Discover always speaks
// (see `detectDiscover` in announcer.ts, which skips this roll for it).
ANNOUNCER_CHANCE.tribeBuyLines = 0.06;
ANNOUNCER_CHANCE.discoverOpen = 0.1;

export const ANNOUNCER_VOL_RANGE: [number, number, number] = [0, 200, 5];
export const ANNOUNCER_OFFSET_RANGE: [number, number, number] = [-2000, 3000, 50];
export const ANNOUNCER_CHANCE_RANGE: [number, number, number] = [0, 100, 1];

const DEFAULTS: AnnouncerTunerConfig = Object.fromEntries(
  ANNOUNCER_TUNER_EVENTS.flatMap((e) => [[`${e}Vol`, 100], [`${e}Offset`, 0], [`${e}Chance`, Math.round(ANNOUNCER_CHANCE[e] * 100)]]),
) as AnnouncerTunerConfig;
export { DEFAULTS as ANNOUNCER_TUNER_DEFAULTS };

export const ANNOUNCER_TUNER_KEYS = Object.keys(DEFAULTS) as AnnouncerTunerKey[];
const rangeOf = (key: AnnouncerTunerKey): [number, number, number] =>
  key.endsWith('Vol') ? ANNOUNCER_VOL_RANGE : key.endsWith('Chance') ? ANNOUNCER_CHANCE_RANGE : ANNOUNCER_OFFSET_RANGE;

const KEY = 'ascent.announcertuner';

function load(): AnnouncerTunerConfig {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const out = { ...DEFAULTS };
    if (saved && typeof saved === 'object') {
      for (const k of ANNOUNCER_TUNER_KEYS) {
        const v = (saved as Record<string, unknown>)[k];
        if (typeof v === 'number' && Number.isFinite(v)) {
          const [min, max] = rangeOf(k);
          out[k] = Math.max(min, Math.min(max, v));
        }
      }
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

let cfg: AnnouncerTunerConfig = load();

export function getAnnouncerTunerConfig(): AnnouncerTunerConfig {
  return cfg;
}

export function setAnnouncerTunerValue(key: AnnouncerTunerKey, value: number | string): void {
  const n = Number(value);
  if (!Number.isFinite(n) || !(key in DEFAULTS)) return;
  const [min, max] = rangeOf(key);
  cfg = { ...cfg, [key]: Math.max(min, Math.min(max, n)) };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetAnnouncerTunerConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Re-read storage — for tests that seed localStorage before "loading". */
export function reloadAnnouncerTunerConfigForTest(): void {
  cfg = load();
}

/** The tuned gain multiplier for an event's line (1 = as recorded; the panel stores percent). */
export function announcerEventVolume(event: AnnouncerEvent, c: AnnouncerTunerConfig = cfg): number {
  return (c[`${event}Vol`] ?? 100) / 100;
}
/** The tuned timing offset for an event, ms (negative = earlier). */
export function announcerEventOffset(event: AnnouncerEvent, c: AnnouncerTunerConfig = cfg): number {
  return c[`${event}Offset`] ?? 0;
}
/** The tuned chance (0 to 1) that an event speaks when its moment happens (the panel stores percent). */
export function announcerEventChance(event: AnnouncerEvent, c: AnnouncerTunerConfig = cfg): number {
  return (c[`${event}Chance`] ?? 100) / 100;
}
/** A line's final gain: the channel level times the event's multiplier, clamped to [0, 1]. */
export function announcerLineGain(channelLevel: number, eventVolume: number): number {
  return Math.max(0, Math.min(1, channelLevel * eventVolume));
}

// ── the panel schema ────────────────────────────────────────────────────────────────────────────────────────
/** Per-row preview hook: TunerPanel draws a ▶ beside the Volume row; the panel component supplies the player. */
export function announcerTunerControls(preview?: (event: AnnouncerEvent) => void): TunerControl<AnnouncerTunerKey>[] {
  return ANNOUNCER_TUNER_EVENTS.flatMap((e): TunerControl<AnnouncerTunerKey>[] => {
    const group = EVENT_LABEL[e];
    const [vMin, vMax, vStep] = ANNOUNCER_VOL_RANGE;
    const [oMin, oMax, oStep] = ANNOUNCER_OFFSET_RANGE;
    const [cMin, cMax, cStep] = ANNOUNCER_CHANCE_RANGE;
    return [
      { key: `${e}Vol`, label: 'Volume', group, unit: '%', min: vMin, max: vMax, step: vStep, ...(preview ? { preview: () => preview(e) } : {}) },
      { key: `${e}Offset`, label: 'Timing offset', group, unit: 'ms', min: oMin, max: oMax, step: oStep },
      { key: `${e}Chance`, label: 'Chance', group, unit: '%', min: cMin, max: cMax, step: cStep },
    ];
  });
}

export const SPEC: TunerSpec<AnnouncerTunerConfig> = {
  id: 'announcer',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Announcer',
  note: 'dev · per-line volume + timing + chance',
  read: getAnnouncerTunerConfig,
  write: (key, value) => setAnnouncerTunerValue(key, value),
  reset: resetAnnouncerTunerConfig,
  defaults: DEFAULTS,
  controls: announcerTunerControls(),
};
