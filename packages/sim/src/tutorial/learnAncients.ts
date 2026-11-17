/**
 * LEARN ANCIENTS — the short Ancients tutorial (owner ask 2026-11-16), course DATA only.
 *
 * Owner brief: drop the player into a game already under way (turn 8, a board of Dragons, hero Warden), with the
 * Ancient meter at 14 of 16. Refresh twice, watch the full awakening, pick an Ancient that pays off THIS turn, use
 * it, End Turn, watch the fight, then fade to a "Good luck!" card and return to the menu. About two minutes.
 *
 * Like Learn Ascent it controls INPUTS only (the start state, the scripted Shop, the opponent board, the seed) and
 * never fakes an outcome. The meter, the awakening, the three options, the pick and the paired hero power are the
 * real Ancients system through the real reducer (`createCourseRun` turns `midGame` into an ordinary RunState).
 *
 * THE OFFER is not scripted by code: the awakening draws three Ancients from the run seed + wave, and the pinned
 * seed below is one whose turn-8 draw is War, Bonds, Time (all three have written Warden pairings). The course
 * test pins that, so a change to the draw fails loudly instead of quietly offering something the coach can't name.
 *
 * WHICH ANCIENT the coach steers to: BONDS. Its Warden pairing reads "When a minion with Ward gains stats, give
 * another minion with Ward +5 Attack". Aegis gives a Ward AND +5 Attack to every Ward minion, so one Aegis on
 * Earthbreaker next to Transcendant (both start with Ward) makes BOTH Ward Dragons gain stats, and each then hands the
 * other +5 more. It pays off the instant the power is pressed, in the Shop, with no extra Gold. War (Resilient
 * Ward) only shows in the fight; Time needs a spell bought too. A player who picks either still gets a branch
 * that shows THEIR pick working (`onlyIf`), never a dead end.
 */
import type { TutorialCourse, TutorialStep } from './types';

/** The Dragons the course places. Ids are the load-bearing part; names live in the card data. */
const A = {
  broodfire: 'd2_broodfire', // Broodfire, T2
  earthbreaker: 'd2_scalechanter', // Earthbreaker, T3: "Whenever you cast a Shop spell, give your Dragons +2/+2."
  transcendant: 'd2_transcendence', // Transcendant, T4: Ward. Adjacent Dragons are Engraved.
  humphry: 'd2_humphry', // Humphry, T3
  mirrorwing: 'd2_mirrorwing', // Mirrorwing, T2
  riverback: 'd2_riverdrake', // Riverback, T3
  // Shop offers (tier-legal at Tier 4).
  roarcollector: 'd2_roarcollector', // T4
  flutterbutter: 'd2_flutterdrake', // T4
  scalefeather: 'd2_chronicler', // T3
  emberWhelp: 'd2_embermouth', // T1
  // The spell the Time branch casts: untargeted, so the lesson is one drag.
  championsAle: 'wo_champion', // Champion's Ale, T3, 2 Gold: "Give your left-most minion +5/+5."
} as const;

/** The course id; the Learn card, the first-login prompt and the run stamp all read this one constant. */
export const LEARN_ANCIENTS_ID = 'learn-ancients';

/** The pinned run seed: its turn-8 awakening offers War, Bonds, Time (pinned by `learnAncientsCourse.test.ts`). */
export const LEARN_ANCIENTS_SEED = 20261139;

const picked = (id: string) => ({ kind: 'ancientPicked', id } as const);
const notPicked = (id: string) => ({ kind: 'not', of: picked(id) } as const);

const steps: TutorialStep[] = [
  {
    id: 'anc-intro',
    phase: 'shop',
    focusMode: 'orient',
    title: 'Ancients',
    body: 'An Ancient awakens once per game. Pick one and it pairs with your hero power for the rest of the game.',
    anchors: [{ kind: 'ui', id: 'hero-power' }, { kind: 'ui', id: 'ancient-meter' }],
    gate: 'observe',
    completion: { kind: 'always' },
  },
  {
    id: 'anc-refresh',
    phase: 'shop',
    focusMode: 'action',
    title: 'Fill the meter',
    body: 'Each Refresh adds 1 point. You are at 14 of 16. Refresh twice.',
    anchors: [{ kind: 'ui', id: 'refresh' }, { kind: 'ui', id: 'ancient-meter' }],
    gate: 'hard',
    allowedActionKinds: ['roll'],
    completion: { kind: 'ancientAwakened' },
  },
  {
    id: 'anc-pick',
    phase: 'shop',
    focusMode: 'action',
    title: 'Pick Bonds',
    body: 'Bonds pays off right now. You have two Ward Dragons. Aegis gives them stats, so each one gives the other +5 Attack.',
    why: 'Pick the Ancient your board can use this turn. You can pick another one. The next steps follow your choice.',
    anchors: [],
    noScrim: true,
    // Parked under the three Ancients; nudged down so it clears the longest offer text (Bonds, four lines).
    panelNudge: { dy: 70 },
    gate: 'hard',
    allowedActionKinds: ['pickAncient'],
    completion: { kind: 'ancientPicked' },
  },
  {
    id: 'anc-other',
    phase: 'shop',
    focusMode: 'orient',
    title: 'Good pick',
    body: 'That works too. Bonds pays off most on this board, but your Ancient still helps. Now use it.',
    anchors: [{ kind: 'ui', id: 'hero-power' }],
    gate: 'observe',
    onlyIf: notPicked('bonds'),
    completion: { kind: 'always' },
  },
  // ── BONDS (the steered pick): Aegis on Earthbreaker, both Ward Dragons trade +5 Attack ──
  {
    id: 'anc-use-bonds',
    phase: 'shop',
    focusMode: 'action',
    title: 'Use Aegis',
    body: 'Tap Aegis, then pick Earthbreaker. Both Ward Dragons gain +5 Attack, so Bonds gives each one +5 more.',
    anchors: [{ kind: 'ui', id: 'hero-power' }, { kind: 'card', zone: 'board', alias: A.earthbreaker }],
    connector: { from: { kind: 'ui', id: 'hero-power' }, to: { kind: 'card', zone: 'board', alias: A.earthbreaker }, style: 'drag' },
    gate: 'hard',
    onlyIf: picked('bonds'),
    completion: { kind: 'heroPowerUsed' },
  },
  // ── WAR: Aegis on the Dragon that already has Ward upgrades it to Resilient Ward ──
  {
    id: 'anc-use-war',
    phase: 'shop',
    focusMode: 'action',
    title: 'Use Aegis',
    body: 'Tap Aegis, then pick Transcendant. It already has Ward, so it gets Resilient Ward. It takes 2 hits to break.',
    anchors: [{ kind: 'ui', id: 'hero-power' }, { kind: 'card', zone: 'board', alias: A.transcendant }],
    connector: { from: { kind: 'ui', id: 'hero-power' }, to: { kind: 'card', zone: 'board', alias: A.transcendant }, style: 'drag' },
    gate: 'hard',
    onlyIf: picked('war'),
    completion: { kind: 'heroPowerUsed' },
  },
  // ── TIME: Aegis for a second Ward, then a spell gives every Ward minion +3 Attack ──
  {
    id: 'anc-use-time',
    phase: 'shop',
    focusMode: 'action',
    title: 'Use Aegis',
    body: 'Tap Aegis, then pick Earthbreaker. Your Ward Dragons gain +5 Attack.',
    anchors: [{ kind: 'ui', id: 'hero-power' }, { kind: 'card', zone: 'board', alias: A.earthbreaker }],
    connector: { from: { kind: 'ui', id: 'hero-power' }, to: { kind: 'card', zone: 'board', alias: A.earthbreaker }, style: 'drag' },
    gate: 'hard',
    onlyIf: picked('time'),
    completion: { kind: 'heroPowerUsed' },
  },
  {
    id: 'anc-time-spell',
    phase: 'shop',
    focusMode: 'action',
    title: 'Cast a spell',
    body: "Buy Champion's Ale, then cast it. Every spell gives your Ward minions +3 Attack.",
    anchors: [{ kind: 'card', zone: 'shop', alias: A.championsAle }],
    gate: 'hard',
    allowedActionKinds: ['buy', 'play'],
    onlyIf: picked('time'),
    completion: { kind: 'castSpell', cardId: A.championsAle },
  },
  {
    id: 'anc-result',
    phase: 'shop',
    focusMode: 'confirm',
    title: 'Your Ancient',
    body: 'Your hero power now shows its Ancient. It stays for the rest of the game.',
    anchors: [{ kind: 'ui', id: 'hero-power' }, { kind: 'ui', id: 'warband' }],
    gate: 'observe',
    completion: { kind: 'always' },
  },
  {
    id: 'anc-end',
    phase: 'shop',
    focusMode: 'action',
    title: 'Into battle',
    body: 'Press End Turn.',
    anchors: [{ kind: 'ui', id: 'end-turn' }],
    gate: 'hard',
    completion: { kind: 'endedTurn' },
  },
  {
    id: 'anc-watch',
    phase: 'combat',
    focusMode: 'predict',
    title: 'Watch your Dragons',
    body: 'Your Ward Dragons hit harder now.',
    anchors: [],
    gate: 'observe',
    completion: { kind: 'combatEnded' },
  },
  {
    id: 'anc-done',
    phase: 'combat',
    focusMode: 'confirm',
    title: 'You won!',
    body: 'Press End combat to finish.',
    anchors: [{ kind: 'ui', id: 'end-turn' }],
    panelNudge: { dy: 80 }, // below the gem's "End combat" label, never over it
    gate: 'hard',
    completion: { kind: 'returnedToShop' },
  },
];

/** The one authored opponent board (every seat fields it, the tutorial-lobby trick). Beatable by every branch. */
const OPPONENT = [
  { attack: 6, health: 9 }, { attack: 6, health: 9 }, { attack: 7, health: 8 },
  { attack: 6, health: 9 }, { attack: 7, health: 8 },
];

const WAVE = 8;

/**
 * LEARN ANCIENTS. One authored turn (turn 8). `turns[0].turn` is the wave it plays on; `createCourseRun` reads the
 * mid-game start and lines the scripted Shop up with that wave.
 */
export const LEARN_ANCIENTS: TutorialCourse = {
  id: LEARN_ANCIENTS_ID,
  kind: 'feature',
  version: 1,
  contentRevision: 'set2-2026-11-16',
  setId: 'set2',
  heroId: 'warden',
  title: 'Ancients',
  summary: 'A two minute lesson. Awaken an Ancient mid game and use it.',
  rounds: WAVE,
  opponentNames: ['Rook', 'Vale', 'Mira', 'Flint', 'Ibis', 'Nox', 'Crown'],
  foundation: [],
  lobbyIntro: [],
  midGame: {
    seed: LEARN_ANCIENTS_SEED,
    wave: WAVE,
    tier: 4,
    gold: 10,
    health: 21,
    armor: 4,
    // Earthbreaker sits beside Transcendant, the Dragon with Ward (both Bonds payoffs land side by side).
    board: [
      { cardId: A.humphry, attack: 9, health: 11 },
      { cardId: A.earthbreaker, attack: 8, health: 8, addKeywords: ['DS'] }, // Ward: two Ward Dragons from the start (owner 2026-11-16)
      { cardId: A.transcendant, attack: 8, health: 10 },
      { cardId: A.broodfire, attack: 7, health: 9 },
      { cardId: A.mirrorwing, attack: 7, health: 9 },
      { cardId: A.riverback, attack: 8, health: 7 },
    ],
    opponentsOut: 2,
    opponentHealth: [24, 19, 15, 12, 9],
    opponentHeroes: ['indy', 'keshi', 'myra', 'sable', 'cassen', 'brackus', 'midas'],
    ancientPoints: 14,
  },
  outro: { title: 'Good luck!', liveLine: 'Ancients are live.' },
  turns: [
    {
      turn: WAVE,
      omenBoard: OPPONENT,
      playerAttacksFirst: true,
      // Index 0 = the turn-start Shop, 1 and 2 = the two coached Refreshes. The second Refresh stocks the Time
      // branch's spell, so whichever Ancient the player picks, its payoff is in reach.
      shopRolls: [
        { minions: [A.roarcollector, A.scalefeather, A.emberWhelp, A.flutterbutter, A.broodfire] },
        { minions: [A.flutterbutter, A.humphry, A.emberWhelp, A.scalefeather, A.mirrorwing] },
        { minions: [A.roarcollector, A.riverback, A.emberWhelp, A.scalefeather, A.flutterbutter], spell: A.championsAle },
      ],
      steps,
    },
  ],
};
