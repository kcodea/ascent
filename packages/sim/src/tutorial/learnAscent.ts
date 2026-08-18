/**
 * LEARN ASCENT — the first-time-player course DATA.
 *
 * Pure, serializable `TutorialCourse` data authored strictly against `./types`. It controls INPUTS only — the
 * hero (Aster), the per-round omen boards, the scripted shop offers, and the coaching steps — and never fakes an
 * outcome: combat still runs in `simulate`, damage still flows through the lobby (see `lobby/tutorialSeats.ts`).
 *
 * This is a RUNNABLE SLICE: Round 1 is fully coached (the keystone), Rounds 2–4 carry real omen boards + real
 * shop rolls plus a light lesson each, so the tutorial lobby is playable end to end. The full course grows to 12
 * rounds later. Every card id below is a real Set 2 (or carried-over) card — an unknown id renders an empty shop
 * offer, so the ids are the load-bearing part.
 *
 * Vocabulary note: the hero's life total is **Health** (the Resolve → Health rename shipped 2026-08-17). Never
 * print "Resolve" in course copy.
 */
import type { TutorialCourse, TutorialStep, TutorialTurn } from './types';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 1 — the fully-coached keystone. Buy → play → hero power → end turn → Rally predict → win confirm.
// The buy card is Packstrider (`b2_packstrider`, T1 Beast 2/2, Rally), so the round teaches Rally live in combat.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const ROUND1_BUY = 'b2_packstrider'; // T1 Beast, 2/2, keywords ['RL'] — Rally: gain +1 Attack per Beast.

const round1Steps: TutorialStep[] = [
  {
    id: 'r1-gold',
    phase: 'shop',
    focusMode: 'orient',
    title: 'Your Gold',
    body: 'This is your Gold. Spend it in the shop to recruit minions each round — it refills every turn.',
    anchors: [{ kind: 'ui', id: 'gold' }],
    gate: 'observe',
    completion: { kind: 'always' },
  },
  {
    id: 'r1-buy',
    phase: 'shop',
    focusMode: 'action',
    title: 'Buy a Minion',
    body: 'Drag Packstrider down to recruit it. Buying moves the minion into your hand.',
    anchors: [{ kind: 'card', zone: 'shop', alias: ROUND1_BUY }],
    gate: 'soft',
    lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: ROUND1_BUY },
  },
  {
    id: 'r1-play',
    phase: 'shop',
    focusMode: 'action',
    title: 'Play It',
    body: 'Now drag Packstrider from your hand onto your board so it can fight.',
    anchors: [{ kind: 'ui', id: 'warband' }],
    gate: 'soft',
    lessonId: 'play_minion',
    completion: { kind: 'played', cardId: ROUND1_BUY },
  },
  {
    id: 'r1-power',
    phase: 'shop',
    focusMode: 'action',
    title: 'Use Your Power',
    body: 'Tap Preparation, then pick Packstrider. Aster gives a friendly minion +1/+1 — free value every turn.',
    anchors: [{ kind: 'ui', id: 'hero-power' }],
    gate: 'soft',
    lessonId: 'use_hero_power',
    completion: { kind: 'heroPowerUsed' },
  },
  {
    id: 'r1-end',
    phase: 'shop',
    focusMode: 'action',
    title: 'End Your Turn',
    body: 'You are set. End the turn to send your warband into battle.',
    anchors: [{ kind: 'ui', id: 'end-turn' }],
    gate: 'soft',
    lessonId: 'end_turn',
    completion: { kind: 'endedTurn' },
  },
  {
    id: 'r1-rally',
    phase: 'combat',
    focusMode: 'predict',
    title: 'Watch the Rally',
    body: 'Packstrider is about to attack. Rally fires every time it swings, growing its Attack mid-fight.',
    why: 'Rally rewards attacking, so front-line Rally minions snowball as the fight goes on.',
    anchors: [{ kind: 'card', zone: 'board', alias: ROUND1_BUY }],
    safeHold: { at: 'beforeAttack', alias: ROUND1_BUY },
    gate: 'observe',
    lessonId: 'keyword_rally',
    // Packstrider's Rally is a SELF-BUFF ("+1 Attack per Beast"), which the simulator presents as a `buff`
    // event — the `rally` event type is reserved for a Rally that fires ANOTHER minion's effect. So accept the
    // buff (the moment the +1 shows), and fall back to the combat resolving, so this step can never hard-stall
    // if a given board produces neither presented signal.
    completion: { kind: 'any', of: [
      { kind: 'presented', presented: 'rally' },
      { kind: 'presented', presented: 'buff' },
      { kind: 'combatEnded' },
    ] },
  },
  {
    id: 'r1-win',
    phase: 'combat',
    focusMode: 'confirm',
    title: 'You Won',
    body: 'Your warband won, so your Health holds. Lose a fight and you would drop Health instead.',
    anchors: [{ kind: 'ui', id: 'health' }],
    gate: 'observe',
    completion: { kind: 'combatEnded', result: 'win' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Rounds 2–4 — lighter coaching (one or two beats each) over real boards and shop rolls.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round2Steps: TutorialStep[] = [
  {
    id: 'r2-tavern',
    phase: 'shop',
    focusMode: 'action',
    title: 'Upgrade Your Tavern',
    body: 'Raise your Tavern to Tier 2. Higher tiers unlock stronger minions in the shop.',
    anchors: [{ kind: 'ui', id: 'tavern-up' }],
    gate: 'soft',
    lessonId: 'tavern_up',
    completion: { kind: 'tierAtLeast', tier: 2 },
  },
  {
    id: 'r2-health',
    phase: 'combat',
    focusMode: 'confirm',
    title: 'Guard Your Health',
    body: 'A lost fight costs Health. Reach zero and your climb ends — so build a board that wins.',
    anchors: [{ kind: 'ui', id: 'health' }],
    gate: 'observe',
    lessonId: 'read_health_loss',
    completion: { kind: 'combatEnded' },
  },
];

const round3Steps: TutorialStep[] = [
  {
    id: 'r3-refresh',
    phase: 'shop',
    focusMode: 'action',
    title: 'Refresh the Shop',
    body: 'Nothing you like? Spend 1 Gold to refresh the shop for a fresh set of offers.',
    anchors: [{ kind: 'ui', id: 'refresh' }],
    gate: 'soft',
    lessonId: 'refresh_shop',
    completion: { kind: 'refreshed' },
  },
  {
    id: 'r3-end',
    phase: 'shop',
    focusMode: 'action',
    title: 'Send Them In',
    body: 'Lock in your board and end the turn to fight this round’s rival.',
    anchors: [{ kind: 'ui', id: 'end-turn' }],
    gate: 'soft',
    completion: { kind: 'endedTurn' },
  },
];

const round4Steps: TutorialStep[] = [
  {
    id: 'r4-freeze',
    phase: 'shop',
    focusMode: 'action',
    title: 'Freeze the Shop',
    body: 'Freeze the shop to keep these offers next turn — handy when you cannot afford them yet.',
    anchors: [{ kind: 'ui', id: 'freeze' }],
    gate: 'soft',
    lessonId: 'freeze_shop',
    completion: { kind: 'froze' },
  },
  {
    id: 'r4-end',
    phase: 'shop',
    focusMode: 'action',
    title: 'Finish the Round',
    body: 'End your turn to battle. Keep winning to protect your Health through the climb.',
    anchors: [{ kind: 'ui', id: 'end-turn' }],
    gate: 'soft',
    completion: { kind: 'endedTurn' },
  },
];

const turns: TutorialTurn[] = [
  {
    turn: 1,
    opponentSeatId: 's1',
    combatSeed: 'learn-ascent-r1',
    // A deliberately weak board so the coached first fight is a clean win.
    omenBoard: [{ attack: 1, health: 3 }],
    shopRolls: [
      // All Tier 1, so a Tier-1 shop offers them: Packstrider (the buy), plus two honest bodies.
      { minions: [ROUND1_BUY, 'k_chipwick', 'dm_wrangler'] },
    ],
    steps: round1Steps,
  },
  {
    turn: 2,
    opponentSeatId: 's2',
    combatSeed: 'learn-ascent-r2',
    omenBoard: [{ attack: 2, health: 2 }, { attack: 1, health: 3 }],
    shopRolls: [
      { minions: ['k_candleback', 'dm_clerk', 'b2_trex'] },
    ],
    steps: round2Steps,
  },
  {
    turn: 3,
    opponentSeatId: 's3',
    combatSeed: 'learn-ascent-r3',
    omenBoard: [{ attack: 3, health: 3 }, { attack: 2, health: 3 }],
    shopRolls: [
      { minions: ['dm_butcher', 'dm_errand', 'b2_wolvie'] },
    ],
    steps: round3Steps,
  },
  {
    turn: 4,
    opponentSeatId: 's4',
    combatSeed: 'learn-ascent-r4',
    omenBoard: [{ attack: 3, health: 4 }, { attack: 3, health: 3 }, { attack: 2, health: 2 }],
    shopRolls: [
      { minions: ['dw_ironlung', 'k_geode', 'dm_hank'] },
    ],
    steps: round4Steps,
  },
];

/**
 * LEARN ASCENT — the core FTUE course. Aster-only, pinned to Set 2, 4 authored rounds (a runnable slice of the
 * eventual 12). `contentRevision` pins the card slice a drift test guards.
 */
export const LEARN_ASCENT: TutorialCourse = {
  id: 'learn-ascent',
  kind: 'core',
  version: 1,
  contentRevision: 'set2-2026-08-17',
  setId: 'set2',
  heroId: 'aster',
  title: 'Learn Ascent',
  summary: 'A coached first climb — buy, build, and battle your way through four rounds.',
  rounds: 4,
  opponentNames: ['Rook', 'Vale', 'Mira', 'Flint', 'Ibis', 'Nox', 'Crown'],
  foundation: [
    {
      id: 'climb',
      title: 'The Climb',
      body: 'You face a course of rival warbands. Win fights to protect your Health and climb.',
      focus: [{ kind: 'ui', id: 'lobby-rail' }],
    },
    {
      id: 'build-battle',
      title: 'Build, Then Battle',
      body: 'Each round you shop to build a warband, then it fights on its own. Two phases, repeating.',
    },
    {
      id: 'warband',
      title: 'Build Your Warband',
      body: 'Recruit minions from the shop and place them on your board. They battle automatically.',
      focus: [{ kind: 'ui', id: 'warband' }],
    },
    {
      id: 'position',
      title: 'Position Matters',
      body: 'Minions fight left to right. Where you place them changes how combat unfolds.',
    },
  ],
  orderDemo: {
    body: 'Drag a minion to the front of your board. The left-most minion attacks first.',
    debrief: 'Order is a real choice — lead with the minion you want swinging first.',
  },
  lobbyIntro: [
    {
      id: 'lobby-rail',
      phase: 'lobby',
      focusMode: 'orient',
      title: 'The Table',
      body: 'Here are the rivals you will face, round by round. Beat them to climb the course.',
      anchors: [{ kind: 'ui', id: 'lobby-rail' }],
      gate: 'observe',
      completion: { kind: 'always' },
    },
    {
      id: 'lobby-self',
      phase: 'lobby',
      focusMode: 'orient',
      title: 'Your Seat',
      body: 'This is you. Your Health is your lifeline — keep it above zero to stay in the climb.',
      anchors: [{ kind: 'ui', id: 'lobby-self' }],
      gate: 'observe',
      completion: { kind: 'always' },
    },
    {
      id: 'lobby-next',
      phase: 'lobby',
      focusMode: 'orient',
      title: 'Next Up',
      body: 'This rival is next. First you shop to build a warband, then the two boards fight. Let us begin.',
      anchors: [{ kind: 'ui', id: 'lobby-next' }],
      gate: 'observe',
      completion: { kind: 'always' },
    },
  ],
  turns,
};

/** The course registry, keyed by course id. Grows as more courses (tribe primers, etc.) land. */
export const TUTORIAL_COURSES: Record<string, TutorialCourse> = {
  'learn-ascent': LEARN_ASCENT,
};

/** Resolve a course by id, or `null` when unknown. Pure lookup — no side effects. */
export function getTutorialCourse(id: string): TutorialCourse | null {
  return TUTORIAL_COURSES[id] ?? null;
}
