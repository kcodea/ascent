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
    // Spotlight BOTH the power button and Packstrider (the target), with a connector between them, so the
    // "tap here, then pick that" flow reads at a glance.
    anchors: [{ kind: 'ui', id: 'hero-power' }, { kind: 'card', zone: 'board', alias: ROUND1_BUY }],
    connector: { from: { kind: 'ui', id: 'hero-power' }, to: { kind: 'card', zone: 'board', alias: ROUND1_BUY }, style: 'drag' },
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
    // A "watch this" step: it stays up through the whole fight (the player sees Packstrider's Attack climb as it
    // swings) and advances when combat resolves. It does NOT key on the mid-combat buff, so the post-combat
    // debrief never shows while the fight is still animating.
    completion: { kind: 'combatEnded' },
  },
  combatDebriefStep('r1-debrief', 'You Won', 'Your warband won, so your Health held — a lost fight would have dropped it instead. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Shared step builders — every round follows the same shape: shop actions → End Turn → watch combat → return
// to shop. Keeping the transitions explicit (and gated to exactly one action) is what stops the coach and the
// game phase from ever drifting apart.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const CARD_IDS = {
  packstrider: 'b2_packstrider', // T1 Beast 2/2, Rally
  trex: 'b2_trex', // T2 Beast, Echo (Deathrattle summon)
  wolvie: 'b2_wolvie', // T2 Beast
  candleback: 'k_candleback', // T1 Kobold, Taunt
  butcher: 'dm_butcher', // T2 Demon — "Shout: give minions in the Shop +1/+1" (teaches Shout, visible on play)
  wrangler: 'dm_wrangler', // T1 Demon — "Start of Combat: summon an Imp" (teaches Start of Combat)
  echohorn: 'b2_echohorn', // T3 Beast — "Rally: trigger your left-most Echo" (position-dependent synergy)
} as const;

/** "End your turn to send your board into battle." Gated to End Turn only. */
function endTurnStep(id: string, body: string, lessonId?: string): TutorialStep {
  return {
    id, phase: 'shop', focusMode: 'action', title: 'End Your Turn', body,
    anchors: [{ kind: 'ui', id: 'end-turn' }], gate: 'hard',
    ...(lessonId ? { lessonId } : {}),
    completion: { kind: 'endedTurn' },
  };
}

/**
 * The single POST-COMBAT beat: it confirms the outcome / teaches the combat lesson AND spotlights the (now
 * "End combat") button so the player knows to click it to return to the shop. One step, so the confirm never
 * auto-flashes past — it waits for the real click (`returnedToShop`). Every round ends on one of these.
 */
function combatDebriefStep(id: string, title: string, body: string, lessonId?: string): TutorialStep {
  return {
    id, phase: 'combat', focusMode: 'confirm', title, body,
    anchors: [{ kind: 'ui', id: 'end-turn' }], gate: 'hard',
    ...(lessonId ? { lessonId } : {}),
    completion: { kind: 'returnedToShop' },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 2 — build a WIDER board (a second minion) + the first Tavern upgrade. Teaches that more bodies win.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round2Steps: TutorialStep[] = [
  {
    id: 'r2-buy',
    phase: 'shop', focusMode: 'action', title: 'Add a Body',
    body: 'Buy a second Packstrider. A wider board means more attacks — one minion rarely wins a fight.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.packstrider }],
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.packstrider },
  },
  {
    id: 'r2-play',
    phase: 'shop', focusMode: 'action', title: 'Place It',
    body: 'Play it onto your board beside the first, so both fight this round.',
    anchors: [{ kind: 'ui', id: 'warband' }],
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.packstrider },
  },
  {
    id: 'r2-tavern',
    phase: 'shop', focusMode: 'action', title: 'Upgrade Your Tavern',
    body: 'Now raise your Tavern to Tier 2. Higher tiers unlock stronger minions in the shop.',
    anchors: [{ kind: 'ui', id: 'tavern-up' }],
    gate: 'hard', lessonId: 'tavern_up',
    completion: { kind: 'tierAtLeast', tier: 2 },
  },
  endTurnStep('r2-end', 'Your board is bigger now. End the turn and watch the two boards fight.'),
  combatDebriefStep('r2-debrief', 'Guard Your Health', 'Win and your Health holds; lose and it drops. Reach zero and you are out — so keep building winning boards. Click here to return to the shop.', 'read_health_loss'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 3 — the first CARD MECHANIC beyond Rally: Echo. Buy T-Rex, watch it leave a body behind when it dies.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round3Steps: TutorialStep[] = [
  {
    id: 'r3-refresh',
    phase: 'shop', focusMode: 'action', title: 'Refresh the Shop',
    body: 'Not seeing what you want? Spend 1 Gold to refresh the shop for a new set of offers.',
    anchors: [{ kind: 'ui', id: 'refresh' }],
    gate: 'hard', lessonId: 'refresh_shop',
    completion: { kind: 'refreshed' },
  },
  {
    id: 'r3-buy-trex',
    phase: 'shop', focusMode: 'action', title: 'Buy T-Rex',
    body: 'Buy T-Rex. It has Echo — a keyword that triggers when the minion dies.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.trex }],
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.trex },
  },
  {
    id: 'r3-play-trex',
    phase: 'shop', focusMode: 'action', title: 'Play T-Rex',
    body: 'Play T-Rex onto your board. When it dies in combat, its Echo leaves a new minion behind.',
    why: 'Echo minions trade up: they die, then keep fighting through what they leave behind.',
    anchors: [{ kind: 'ui', id: 'warband' }],
    gate: 'hard', lessonId: 'keyword_echo',
    completion: { kind: 'played', cardId: CARD_IDS.trex },
  },
  endTurnStep('r3-end', 'End the turn. Watch for T-Rex dying — and what its Echo leaves behind.'),
  combatDebriefStep('r3-debrief', 'Echo Fired', 'When an Echo minion falls, it leaves value behind — so the fight keeps going for you. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 4 — the build comes together: freeze a good offer, round out the board, then graduate.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round4Steps: TutorialStep[] = [
  {
    id: 'r4-buy',
    phase: 'shop', focusMode: 'action', title: 'Round Out the Board',
    body: 'Buy Wolvie — a Taunt Beast. A board of minions that support each other beats a pile of loose bodies.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.wolvie }],
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.wolvie },
  },
  {
    id: 'r4-play',
    phase: 'shop', focusMode: 'action', title: 'Place It',
    body: 'Play it onto your board. That is your warband — Rally out front, Echo behind, a full team.',
    anchors: [{ kind: 'ui', id: 'warband' }],
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.wolvie },
  },
  {
    id: 'r4-freeze',
    phase: 'shop', focusMode: 'action', title: 'Freeze for Later',
    body: 'See the other minion still in your shop? Freeze the shop to keep it for next turn instead of losing it.',
    why: 'Freeze saves offers you want but cannot use yet — plan a turn ahead.',
    anchors: [{ kind: 'ui', id: 'freeze' }],
    gate: 'hard', lessonId: 'freeze_shop',
    completion: { kind: 'froze' },
  },
  endTurnStep('r4-end', 'Your build is together. End the turn and send your warband in.'),
  combatDebriefStep('r4-debrief', 'The Full Loop', 'Shop, build, position, fight — that is the whole game. You have the basics; now let us add some synergy. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 5 — SHOUT: a trigger that fires the moment you play a minion from your hand.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round5Steps: TutorialStep[] = [
  {
    id: 'r5-buy',
    phase: 'shop', focusMode: 'action', title: 'A Shout Minion',
    body: 'There is the minion you froze. Buy Contract Butcher — it has a Shout, an effect that fires the instant you play it.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.butcher }],
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.butcher },
  },
  {
    id: 'r5-play',
    phase: 'shop', focusMode: 'action', title: 'Hear the Shout',
    body: 'Play it and watch: its Shout fires now, buffing the minions in your shop for later.',
    why: 'Shout triggers on play from hand — so the order you play minions can matter.',
    anchors: [{ kind: 'ui', id: 'warband' }],
    gate: 'hard', lessonId: 'keyword_shout',
    completion: { kind: 'played', cardId: CARD_IDS.butcher },
  },
  endTurnStep('r5-end', 'A bigger board again. End the turn and fight.'),
  combatDebriefStep('r5-debrief', 'Shout Recap', 'Shout fires when a minion is played — value before combat even starts. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 6 — START OF COMBAT: an effect that fires as the fight begins. Plus a Tavern upgrade to Tier 3.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round6Steps: TutorialStep[] = [
  {
    id: 'r6-buy',
    phase: 'shop', focusMode: 'action', title: 'Start of Combat',
    body: 'Buy Imp Wrangler. Its Start-of-Combat effect fires as the fight begins — summoning a free Imp to fight for you.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.wrangler }],
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.wrangler },
  },
  {
    id: 'r6-play',
    phase: 'shop', focusMode: 'action', title: 'Place It',
    body: 'Play Imp Wrangler onto your board. Watch for its Imp appearing right as combat starts.',
    anchors: [{ kind: 'ui', id: 'warband' }],
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.wrangler },
  },
  {
    id: 'r6-tavern',
    phase: 'shop', focusMode: 'action', title: 'Reach Tier 3',
    body: 'Upgrade your Tavern to Tier 3 — it unlocks the piece that ties your board together.',
    anchors: [{ kind: 'ui', id: 'tavern-up' }],
    gate: 'hard', lessonId: 'tavern_up',
    completion: { kind: 'tierAtLeast', tier: 3 },
  },
  endTurnStep('r6-end', 'End the turn — and watch the Imp appear at the Start of Combat.'),
  combatDebriefStep('r6-debrief', 'Start of Combat', 'Start-of-Combat effects fire before any attacks — free value the moment the fight begins. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 7 — POSITION-DEPENDENT SYNERGY: the build comes together. Echohorn's Rally triggers your LEFT-MOST Echo,
// so where you place T-Rex decides whether the engine fires. This is the payoff of everything so far.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round7Steps: TutorialStep[] = [
  {
    id: 'r7-buy',
    phase: 'shop', focusMode: 'action', title: 'The Keystone',
    body: 'Buy Echohorn. When it attacks, its Rally re-fires your LEFT-MOST Echo minion — a free extra body mid-fight.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.echohorn }],
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.echohorn },
  },
  {
    id: 'r7-play',
    phase: 'shop', focusMode: 'action', title: 'Play Echohorn',
    body: 'Play Echohorn onto your board. That fills all seven slots — your board is now full.',
    anchors: [{ kind: 'ui', id: 'warband' }],
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.echohorn },
  },
  {
    id: 'r7-makeroom',
    phase: 'shop', focusMode: 'action', title: 'Make Room to Summon',
    body: 'A full board of 7 has no open slot — so summons have nowhere to land. Echohorn re-fires T-Rex’s Echo to summon a Baby, but with 7 minions it fizzles. Sell Imp Wrangler to open a slot.',
    why: 'Board space is a resource: leave room when your plan relies on summoning new minions.',
    anchors: [{ kind: 'card', zone: 'board', alias: CARD_IDS.wrangler }],
    gate: 'hard', lessonId: 'replace_on_full_board',
    completion: { kind: 'sold', cardId: CARD_IDS.wrangler },
  },
  {
    id: 'r7-position',
    phase: 'shop', focusMode: 'action', title: 'Position for Synergy',
    body: 'Drag T-Rex to the LEFT-most slot. Echohorn re-fires your left-most Echo — so put your Echo minion there.',
    why: 'Position decides which effects fire. Line up your pieces and the board becomes an engine.',
    anchors: [{ kind: 'ui', id: 'warband' }],
    gate: 'hard', lessonId: 'reorder_minion',
    completion: { kind: 'reordered' },
  },
  endTurnStep('r7-end', 'Your engine is set, with a slot free to summon into. End the turn and watch it fire.'),
  combatDebriefStep('r7-debrief', 'The Build Comes Together', 'Rally, Echo, positioning, board space — placed to work together, your board runs itself. That is the heart of the game. Click here to return to the shop.'),
];

const turns: TutorialTurn[] = [
  {
    turn: 1,
    opponentSeatId: 's1',
    combatSeed: 'learn-ascent-r1',
    // A deliberately weak board so the coached first fight is a clean win.
    omenBoard: [{ attack: 1, health: 3 }],
    // Force the PLAYER to swing first so the Packstrider's Rally visibly fires (it buffs on its own attack)
    // before the round is over — the whole point of Round 1's lesson.
    playerAttacksFirst: true,
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
    // Beatable by two Packstriders (each Rally-buffing off the other).
    omenBoard: [{ attack: 2, health: 2 }, { attack: 1, health: 3 }],
    // Offers a second Packstrider (T1) — the round buys it, then upgrades. Clean fillers (no Ruby/Consume clutter).
    shopRolls: [
      { minions: [CARD_IDS.packstrider, 'dm_errand', 'dm_hank'] },
    ],
    steps: round2Steps,
  },
  {
    turn: 3,
    opponentSeatId: 's3',
    combatSeed: 'learn-ascent-r3',
    // Both enemies hit for 3 (enough to one-shot the 3/3 T-Rex) and are tanky enough to survive the player's
    // opening swing, so whichever one makes the enemy's first attack does the job. `forceEnemyFirstTargetCard`
    // then steers that swing onto the T-Rex wherever the player placed it — the Echo lesson always lands.
    omenBoard: [{ attack: 3, health: 8 }, { attack: 3, health: 5 }],
    forceEnemyFirstTargetCard: CARD_IDS.trex,
    // Initial roll has no T-Rex (so the round teaches Refresh); the refresh roll [1] offers T-Rex.
    shopRolls: [
      { minions: ['dm_butcher', 'dm_errand', 'k_geode'] },
      { minions: [CARD_IDS.trex, CARD_IDS.wolvie, 'dm_hank'] },
    ],
    steps: round3Steps,
  },
  {
    turn: 4,
    opponentSeatId: 's4',
    combatSeed: 'learn-ascent-r4',
    omenBoard: [{ attack: 3, health: 4 }, { attack: 3, health: 3 }, { attack: 2, health: 2 }],
    // Offers Wolvie (bought) and Contract Butcher — the round buys Wolvie, then FREEZES to keep Butcher, which
    // carries into Round 5's Shout lesson so freezing visibly "kept" a minion.
    shopRolls: [
      { minions: [CARD_IDS.wolvie, CARD_IDS.butcher, 'dm_hank'] },
    ],
    steps: round4Steps,
  },
  {
    turn: 5,
    opponentSeatId: 's5',
    combatSeed: 'learn-ascent-r5',
    omenBoard: [{ attack: 4, health: 4 }, { attack: 3, health: 4 }, { attack: 2, health: 3 }],
    // Offers Contract Butcher (the Shout minion).
    shopRolls: [
      { minions: [CARD_IDS.butcher, 'dm_clerk', 'k_chipwick'] },
    ],
    steps: round5Steps,
  },
  {
    turn: 6,
    opponentSeatId: 's6',
    combatSeed: 'learn-ascent-r6',
    omenBoard: [{ attack: 4, health: 5 }, { attack: 4, health: 4 }, { attack: 3, health: 3 }],
    // Offers Imp Wrangler (Start of Combat) — the round also upgrades the Tavern to Tier 3.
    shopRolls: [
      { minions: [CARD_IDS.wrangler, 'dm_clerk', 'k_chipwick'] },
    ],
    steps: round6Steps,
  },
  {
    turn: 7,
    opponentSeatId: 's7',
    combatSeed: 'learn-ascent-r7',
    omenBoard: [{ attack: 5, health: 5 }, { attack: 4, health: 4 }, { attack: 3, health: 4 }, { attack: 2, health: 2 }],
    // Offers Echohorn (Tier 3) — the round is at Tier 3 after Round 6's upgrade.
    shopRolls: [
      { minions: [CARD_IDS.echohorn, CARD_IDS.wolvie, 'dm_hank'] },
    ],
    steps: round7Steps,
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
  summary: 'A coached first game — learn to shop, build, position, and win, then bring a synergy engine together.',
  rounds: 7,
  opponentNames: ['Rook', 'Vale', 'Mira', 'Flint', 'Ibis', 'Nox', 'Crown'],
  foundation: [
    {
      id: 'climb',
      title: 'The Goal',
      body: 'You face a run of rival warbands. Win fights to protect your Health and outlast them.',
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
      body: 'Here are the rivals you will face, round by round. Beat them to win the game.',
      anchors: [{ kind: 'ui', id: 'lobby-rail' }],
      gate: 'observe',
      completion: { kind: 'always' },
    },
    {
      id: 'lobby-self',
      phase: 'lobby',
      focusMode: 'orient',
      title: 'Your Seat',
      body: 'This is you. Your Health is your lifeline — keep it above zero to stay in the game.',
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
