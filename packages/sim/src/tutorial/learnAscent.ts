/**
 * LEARN ASCENT — the first-time-player course DATA.
 *
 * Pure, serializable `TutorialCourse` data authored strictly against `./types`. It controls INPUTS only — the
 * hero (Aster), the per-round omen boards, the scripted shop offers, and the coaching steps — and never fakes an
 * outcome: combat still runs in `simulate`, damage still flows through the lobby (see `lobby/tutorialSeats.ts`).
 *
 * The full 12-round course: R1 is the fully-coached keystone; R2–7 teach the fundamentals one card mechanic at a
 * time (wider board + tavern-up, Echo, Freeze, Shout, Start of Combat, position-dependent synergy + board space);
 * R8–9 add the two build-defining systems (gilding/triples + the Triple Reward Discover, then spells); and R10–12
 * hand the wheel to the player (supervised independence) before graduating into the real game. Every card id
 * below is a real Set 2 (or carried-over) card — an unknown id renders an empty shop offer, so the ids are the
 * load-bearing part.
 *
 * Vocabulary note: the hero's life total is **Health** (the Resolve → Health rename shipped 2026-08-17). Never
 * print "Resolve" in course copy.
 */
import type { TutorialCourse, TutorialStep, TutorialTurn, TutorialUiAnchor } from './types';

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
    body: 'This is your Gold. Spend it all each round — it refills every turn, and unspent Gold does NOT carry over.',
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
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: ROUND1_BUY }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
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
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: ROUND1_BUY }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: ROUND1_BUY }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'soft',
    lessonId: 'play_minion',
    completion: { kind: 'played', cardId: ROUND1_BUY },
  },
  {
    id: 'r1-power',
    phase: 'shop',
    focusMode: 'action',
    title: 'Use Your Power',
    body: 'Tap Preparation, then pick Packstrider. Aster gives a friendly minion +1/+1 — free, whenever it is lit.',
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
  combatDebriefStep('r1-debrief', 'You Won', 'Your warband won, so your Health held — a lost fight would have dropped it instead. Click here to return to the shop.', undefined, 'health'),
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
  // ALL-BEAST ROSTER (owner ask 2026-08-21): every minion the course hands the player is a Beast, so the
  // synergies it teaches are visible on their own board instead of scattered across tribes. The two Demons
  // that used to carry the Shout and Start-of-Combat lessons were swapped for Beasts that teach the same
  // keyword — and both teach it BETTER here, because their payoff lands on the beasts already in play.
  urchin: 'seaurchin', // T4 Beast — "Shout: Discover a Beast" (teaches Shout AND a tribe-locked Discover)
  kennel: 'kennel', // T2 Beast — "Start of Combat: give your Beasts +1 Attack wherever they are"
  echohorn: 'b2_echohorn', // T3 Beast — "Rally: trigger your left-most Echo" (position-dependent synergy)
  blessing: 'sp_blessing', // T4 spell, cost 2, target any — "Give a minion +3/+4 twice" (teaches buy + cast a spell)
  tripleReward: 'discoverspell', // the "Triple Reward" token a golden minion grants on play — a Discover (teaches Discover)
} as const;

/** "End your turn to send your board into battle." Gated to End Turn only. */
/**
 * A HERO-POWER REMINDER placed before each End Turn (owner ask 2026-08-20: "add hero power steps before every
 * combat... they should be in the habit of hero powering every turn").
 *
 * The completion is deliberately "used it OR it is not available". Aster's Preparation **recharges every other
 * turn**, so a bare `heroPowerUsed` reminder would sit unsatisfiable on a recharge turn and soft-lock the
 * course. Written this way the step clears itself instantly whenever the power is down, and only actually asks
 * on the turns the player really could press it. Soft-gated, matching `r1-power`, so it nudges without walling.
 */
function heroPowerReminderStep(id: string): TutorialStep {
  return {
    id, phase: 'shop', focusMode: 'action', title: 'Use Your Power',
    body: 'Preparation is free — spend it before you fight. It recharges every other turn, so use it whenever it is lit.',
    // Light the WARBAND too, with the arrow running power → board (owner 2026-08-21). The power is only half
    // the instruction: it is targeted, so a player who taps it still has to know the buff goes onto one of
    // their own minions. Spotlighting the button alone left the second half unsaid.
    anchors: [{ kind: 'ui', id: 'hero-power' }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'ui', id: 'hero-power' }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'soft',
    completion: { kind: 'any', of: [{ kind: 'heroPowerUsed' }, { kind: 'not', of: { kind: 'heroPowerReady' } }] },
  };
}

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
function combatDebriefStep(id: string, title: string, body: string, lessonId?: string, alsoAnchor?: TutorialUiAnchor): TutorialStep {
  return {
    id, phase: 'combat', focusMode: 'confirm', title, body,
    // `alsoAnchor` lights a second control alongside the return button — used by the debriefs whose copy names
    // Health, so the number being talked about is actually on screen (owner ask 2026-08-20).
    anchors: alsoAnchor ? [{ kind: 'ui', id: 'end-turn' }, { kind: 'ui', id: alsoAnchor }] : [{ kind: 'ui', id: 'end-turn' }],
    gate: 'hard',
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
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.packstrider }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.packstrider },
  },
  {
    id: 'r2-play',
    phase: 'shop', focusMode: 'action', title: 'Place It',
    body: 'Play it onto your board beside the first, so both fight this round.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.packstrider }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.packstrider }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.packstrider },
  },
  {
    id: 'r2-tavern',
    phase: 'shop', focusMode: 'action', title: 'Upgrade Your Shop',
    body: 'Now raise your Shop to Tier 2. Higher tiers unlock stronger minions.',
    anchors: [{ kind: 'ui', id: 'tavern-up' }],
    gate: 'hard', lessonId: 'tavern_up',
    completion: { kind: 'tierAtLeast', tier: 2 },
  },
  heroPowerReminderStep('r2-power'),
  endTurnStep('r2-end', 'Your board is bigger now. End the turn and watch the two boards fight.'),
  combatDebriefStep('r2-debrief', 'Guard Your Health', 'Win and your Health holds; lose and it drops. Reach zero and you are out — so keep building winning boards. Click here to return to the shop.', 'read_health_loss', 'health'),
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
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.trex }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.trex },
  },
  {
    id: 'r3-play-trex',
    phase: 'shop', focusMode: 'action', title: 'Play T-Rex',
    body: 'Play T-Rex onto your board. When it dies in combat, its Echo leaves a new minion behind.',
    why: 'Echo minions trade up: they die, then keep fighting through what they leave behind.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.trex }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.trex }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'keyword_echo',
    completion: { kind: 'played', cardId: CARD_IDS.trex },
  },
  heroPowerReminderStep('r3-power'),
  endTurnStep('r3-end', 'End the turn. Watch for T-Rex dying — and what its Echo leaves behind.'),
  combatDebriefStep('r3-debrief', 'Echo Fired', 'When an Echo minion falls, it leaves value behind — so the fight keeps going for you. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * THE TIER LADDER (owner ask 2026-08-22: the course should reach Tier 6 by the end).
 *
 * Placed at rounds 2 / 4 / 7 / 10 / 11 — never on a round that already spends heavily. The tutorial pays a
 * flat 10 Gold a round and an unspent upgrade gets 1 cheaper each wave, so the binding constraint is not
 * Gold-per-round, it is what ELSE the round forces you to buy. Rounds 6 and 9 are the Runeforge rounds
 * (buy + rune ≈ 6–7 Gold), so a tier step there would not fit; 10–12 are free-build, so the last two sit
 * comfortably. Costs at these waves: 4, 5, 5, 8, 9 — each inside the round's remaining budget.
 */
const tierStep = (id: string, tier: number, title: string, body: string, why?: string): TutorialStep => ({
  id, phase: 'shop', focusMode: 'action', title, body, ...(why ? { why } : {}),
  anchors: [{ kind: 'ui', id: 'tavern-up' }],
  gate: 'hard', noScrim: true, lessonId: 'tavern_up',
  completion: { kind: 'tierAtLeast', tier },
});

// Round 4 — the build comes together: freeze a good offer, round out the board, then graduate.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round4Steps: TutorialStep[] = [
  {
    id: 'r4-buy',
    phase: 'shop', focusMode: 'action', title: 'Round Out the Board',
    body: 'Buy Wolvie — a Taunt Beast. A board of minions that support each other beats a pile of loose bodies.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.wolvie }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.wolvie }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.wolvie },
  },
  {
    id: 'r4-play',
    phase: 'shop', focusMode: 'action', title: 'Place It',
    body: 'Play it onto your board. That is your warband — Rally out front, Echo behind, a full team.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.wolvie }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.wolvie }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
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
  tierStep('r4-tavern', 3, 'Reach Tier 3',
    'Now raise your Shop to Tier 3. Each tier puts stronger minions in the shop for the rest of the game.',
    'Upgrading costs you strength this turn to buy better options every turn after — the central trade of the game.'),
  heroPowerReminderStep('r4-power'),
  endTurnStep('r4-end', 'Your build is together. End the turn and send your warband in.'),
  combatDebriefStep('r4-debrief', 'The Full Loop', 'Shop, build, position, fight — that is the whole game. You have the basics; now let us learn some more mechanics. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 5 — SHOUT: a trigger that fires the moment you play a minion from your hand.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round5Steps: TutorialStep[] = [
  {
    id: 'r5-buy',
    phase: 'shop', focusMode: 'action', title: 'A Shout Minion',
    body: 'Sea Urchin is on offer. Buy it — it has a Shout, an effect that fires the instant you play it.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.urchin }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.urchin }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.urchin },
  },
  {
    id: 'r5-play',
    phase: 'shop', focusMode: 'action', title: 'Hear the Shout',
    body: 'Play it and watch: its Shout fires the moment it lands, offering you a choice of Beasts.',
    why: 'Shout triggers on play from hand — so the order you play minions can matter.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.urchin }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.urchin }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'keyword_shout',
    completion: { kind: 'played', cardId: CARD_IDS.urchin },
  },
  {
    // The PAYOFF beat (owner ask 2026-08-20: "step 32 should lead into a tip showing that the shop minions
    // gained stats"). The Shout's effect lands somewhere the player is not looking — up in the shop row — so
    // without this the lesson is a claim they never see evidence for. A real step rather than `resultAnchors`,
    // which is declared on TutorialStep but not implemented by the controller.
    id: 'r5-shopbuff',
    phase: 'shop', focusMode: 'action', title: 'Discover a Beast',
    body: 'Pick one of the three Beasts. Discover lets you choose the piece you want instead of gambling.',
    why: 'The card you pick goes to your hand — play it now, or hold it for a turn you have room.',
    // The overlay is a modal and owns the screen, so it needs no cutout of its own (a full-viewport anchor
    // punches a hole through everything); the coach just names the choice.
    anchors: [],
    // The Discover overlay dims the board itself — a second scrim on top just darkened the choice.
    noScrim: true,
    gate: 'observe', lessonId: 'keyword_discover',
    // Waits for the PICK, not for the play that opened it — otherwise the course walks on while the modal is
    // still up and every later spotlight points at chrome the player cannot reach.
    completion: { kind: 'discovered' },
  },
  {
    // PLAY WHAT YOU PICKED (owner 2026-08-21). The Discover put a Beast in hand; leaving it there taught the
    // player that a discovered card just… sits somewhere. Completion is a BOARD COUNT, not `played: cardId`,
    // because the card they chose is theirs — the course cannot know its id.
    id: 'r5-playfound',
    phase: 'shop', focusMode: 'action', title: 'Play Your Pick',
    body: 'Now play the Beast you chose onto your board — a discovered card goes to your hand, not the board.',
    anchors: [{ kind: 'ui', id: 'hand' }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'ui', id: 'hand' }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'boardCount', atLeast: 6 },
  },
  heroPowerReminderStep('r5-power'),
  endTurnStep('r5-end', 'A bigger board again. End the turn and fight.'),
  combatDebriefStep('r5-debrief', 'Shout Recap', 'Shout fires when a minion is played — value before combat even starts. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 6 — START OF COMBAT: an effect that fires as the fight begins. Plus the RUNEFORGE (the tier step
// moved to Round 4 — a round that buys a minion AND a rune has no Gold left for an upgrade).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round6Steps: TutorialStep[] = [
  {
    id: 'r6-buy',
    phase: 'shop', focusMode: 'action', title: 'Start of Combat',
    body: 'Buy Kennelmaster. Its Start-of-Combat effect fires as the fight begins — and every Beast you own gets stronger.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.kennel }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.kennel }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.kennel },
  },
  {
    id: 'r6-play',
    phase: 'shop', focusMode: 'action', title: 'Place It',
    body: 'Play Kennelmaster onto your board. Watch your whole warband gain Attack as the fight begins.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.kennel }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.kennel }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.kennel },
  },
  {
    id: 'r6-rune',
    phase: 'shop', focusMode: 'action', title: 'The Runeforge',
    body: 'The Runeforge is open. A Rune is a permanent rule for the rest of your game — not a minion, not a card. Buy one.',
    why: 'Runes change how your whole run works. You get very few, so each one is a real decision.',
    anchors: [{ kind: 'ui', id: 'discover' }],
    gate: 'hard', noScrim: true, lessonId: 'rune_buy',
    completion: { kind: 'ownsRunes', atLeast: 1 },
  },
  heroPowerReminderStep('r6-power'),
  endTurnStep('r6-end', 'End the turn — and watch your Beasts gain Attack at the Start of Combat.'),
  combatDebriefStep('r6-debrief', 'Start of Combat', 'Start-of-Combat effects fire before any attacks — free value the moment the fight begins. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 7 — POSITION-DEPENDENT SYNERGY: the build comes together. Echohorn's Rally triggers your LEFT-MOST Echo,
// so where you place T-Rex decides whether the engine fires. This is the payoff of everything so far.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round7Steps: TutorialStep[] = [
  {
    id: 'r7-makeroom',
    phase: 'shop', focusMode: 'action', title: 'Make Room to Summon',
    body: 'Your board is full. Sell Kennelmaster to start making room — you need space for what comes next.',
    why: 'Board space is a resource — Echohorn re-fires T-Rex’s Echo, and that Baby needs somewhere to go.',
    // FIRST in the round, not after the buy: with the round-5 Discover the board arrives FULL at 7, so a
    // "play Echohorn" step would simply be refused. Two slots are needed — one for Echohorn, one for the Baby
    // its Rally re-fires — and both sells NAME their card rather than asking for a free "sell two". A
    // free-choice sell let a player give up T-Rex, which the very next step (and round 8) depends on; the
    // named pair also keeps both Packstriders, which round 8 needs for the triple.
    anchors: [{ kind: 'card', zone: 'board', alias: CARD_IDS.kennel }],
    gate: 'hard', lessonId: 'replace_on_full_board',
    completion: { kind: 'sold', cardId: CARD_IDS.kennel },
  },
  {
    id: 'r7-makeroom2',
    phase: 'shop', focusMode: 'action', title: 'One More Slot',
    body: 'Sell Sea Urchin too — its Shout already paid off. Now there is room for Echohorn and what it summons.',
    anchors: [{ kind: 'card', zone: 'board', alias: CARD_IDS.urchin }],
    gate: 'hard',
    completion: { kind: 'sold', cardId: CARD_IDS.urchin },
  },
  {
    id: 'r7-buy',
    phase: 'shop', focusMode: 'action', title: 'The Keystone',
    body: 'Buy Echohorn. When it attacks, its Rally re-fires your LEFT-MOST Echo minion.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.echohorn }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.echohorn }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.echohorn },
  },
  {
    id: 'r7-play',
    phase: 'shop', focusMode: 'action', title: 'Play Echohorn',
    body: 'Play Echohorn onto your board. That fills all seven slots — your board is now full.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.echohorn }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.echohorn }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.echohorn },
  },
  {
    id: 'r7-position',
    phase: 'shop', focusMode: 'action', title: 'Position for Synergy',
    body: 'Drag T-Rex to the LEFT-most slot. Echohorn re-fires your left-most Echo — so put your Echo minion there.',
    why: 'Position decides which effects fire. Line up your pieces and the board becomes an engine.',
    // Spotlight T-Rex itself and draw the move to slot 0 — the step names a specific minion and a specific
    // destination, so both should be lit.
    anchors: [{ kind: 'card', zone: 'board', alias: CARD_IDS.trex }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'board', alias: CARD_IDS.trex }, to: { kind: 'boardSlot', index: 0 }, style: 'order' },
    gate: 'hard', lessonId: 'reorder_minion',
    // STATE, not the `reordered` event: the old predicate accepted any drag, so clicking (or nudging a
    // different minion) completed a step that is specifically about T-Rex ending up left-most.
    completion: { kind: 'cardAtSlot', cardId: CARD_IDS.trex, index: 0 },
  },
  tierStep('r7-tavern', 4, 'Reach Tier 4',
    'Raise your Shop to Tier 4 before you finish. The table is getting stronger — your shop has to keep up.',
    'Tiering up is how you keep pace with seven other players who are all doing the same thing.'),
  heroPowerReminderStep('r7-power'),
  endTurnStep('r7-end', 'Your engine is set, with a slot free to summon into. End the turn and watch it fire.'),
  combatDebriefStep('r7-debrief', 'The Build Comes Together', 'Rally, Echo, positioning, board space — placed to work together, your board runs itself. That is the heart of the game. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 8 — GILDING + DISCOVER. The two Packstriders from Rounds 1–2 finally meet a third: three copies merge
// into one GOLDEN, and playing that golden pays a Triple Reward — a Discover. One round, two core systems, both
// as the natural payoff of a board the player already built.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round8Steps: TutorialStep[] = [
  {
    id: 'r8-buy',
    phase: 'shop', focusMode: 'action', title: 'Complete a Triple',
    body: 'You have two Packstriders. Buy a THIRD — three copies of a minion merge into one GOLDEN, with double stats and a stronger effect.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.packstrider }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.packstrider }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'gild_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.packstrider },
  },
  {
    id: 'r8-play-golden',
    phase: 'shop', focusMode: 'action', title: 'Play the Golden',
    body: 'The Golden Packstrider is in your hand. Play it onto your board — and it pays a Triple Reward straight back to your hand.',
    why: 'A Gold minion is a triple: it saves board space and hits far harder than three loose copies would.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.packstrider }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.packstrider }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'gild_minion',
    completion: { kind: 'played', cardId: CARD_IDS.packstrider },
  },
  {
    id: 'r8-discover',
    phase: 'shop', focusMode: 'action', title: 'Discover a Minion',
    body: 'That is your Triple Reward. Play it to Discover — pick ONE of three minions to add to your hand.',
    why: 'Discover lets you choose, not gamble — take the piece that fits your board.',
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.tripleReward }],
    gate: 'hard', lessonId: 'keyword_discover',
    completion: { kind: 'played', cardId: CARD_IDS.tripleReward },
  },
  heroPowerReminderStep('r8-power'),
  {
    id: 'r8-end',
    phase: 'shop', focusMode: 'action', title: 'Play It, Then End',
    body: 'Play the minion you discovered onto your board, then End Turn.',
    // The Discover overlay is still open on this beat — the old `warband`-only cutout lit a strip of empty
    // board while the thing the player must act on sat outside the spotlight (owner report 2026-08-20).
    anchors: [{ kind: 'ui', id: 'discover' }, { kind: 'ui', id: 'hand' }, { kind: 'ui', id: 'warband' }],
    gate: 'soft', allowedActionKinds: ['play', 'faceOmen'],
    completion: { kind: 'endedTurn' },
  },
  combatDebriefStep('r8-debrief', 'Golden & Chosen', 'A triple and a Discover — the two ways a board goes from good to great. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 9 — SPELLS. A one-shot effect bought from the shop and cast from hand. Blessing is a clean single-target
// buff, scripted into the minion row so it buys + casts through the normal drag the player already knows.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round9Steps: TutorialStep[] = [
  {
    id: 'r9-rune',
    phase: 'shop', focusMode: 'action', title: 'The Epic Runeforge',
    body: 'The Epic Runeforge. Same idea as before, bigger rules — and this is your last one, so read all three.',
    why: 'Epic Runes are strong enough to define a build. Pick the one that fits the board you have.',
    anchors: [{ kind: 'ui', id: 'discover' }],
    gate: 'hard', noScrim: true, lessonId: 'rune_buy_epic',
    // TWO, not one: the round-6 rune is already owned, so "at least 1" would be satisfied before the forge
    // even opens and the step would tick past itself.
    completion: { kind: 'ownsRunes', atLeast: 2 },
  },
  {
    id: 'r9-buy',
    phase: 'shop', focusMode: 'action', title: 'Buy a Spell',
    body: 'Buy Blessing. Spells are one-time effects — you buy them like a minion, but they go to your hand to cast.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.blessing }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.blessing }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_spell',
    completion: { kind: 'bought', cardId: CARD_IDS.blessing },
  },
  {
    id: 'r9-cast',
    phase: 'shop', focusMode: 'action', title: 'Cast It',
    body: 'Drag Blessing from your hand onto one of your minions to give it +3/+4 twice. Pick your strongest to make it stronger.',
    why: 'A spell is spent when cast — time it for the minion that turns the fight.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.blessing }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.blessing }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'cast_spell',
    completion: { kind: 'played', cardId: CARD_IDS.blessing },
  },
  heroPowerReminderStep('r9-power'),
  endTurnStep('r9-end', 'A spell can swing a fight. End the turn and see.'),
  combatDebriefStep('r9-debrief', 'Spells', 'Bought like a minion, cast from hand for a burst of value — spells are the flex in any build. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Shared builder for the INDEPENDENCE rounds (R10–12): the coach stops locking single actions and lets the
// player run the whole shop phase themselves — buy / sell / play / refresh / freeze / upgrade / hero-power are
// ALL allowed, and the step simply advances when they End Turn. (Omitting `allowedActionKinds` would derive a
// single verb from the `endedTurn` completion and lock everything else — the opposite of what we want here.)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const FREE_VERBS = ['buy', 'sell', 'play', 'roll', 'freeze', 'upgrade', 'heroPower', 'faceOmen'];

/** One self-directed shop phase: a gentle orienting panel, every verb unlocked, advances on End Turn. */
function freeBuildStep(id: string, title: string, body: string, why?: string): TutorialStep {
  return {
    id, phase: 'shop', focusMode: 'orient', title, body,
    ...(why ? { why } : {}),
    anchors: [{ kind: 'ui', id: 'shop' }],
    gate: 'soft',
    noScrim: true,
    dismissible: true, // the panel can be closed with "Got it" so it's out of the way while you build
    allowedActionKinds: FREE_VERBS,
    completion: { kind: 'endedTurn' },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Rounds 10–12 — SUPERVISED INDEPENDENCE → GRADUATION. The training wheels come off: the player drives the
// shop, the coach only frames the goal and reads the result. R12 ends the course and graduates to the real game.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round10Steps: TutorialStep[] = [
  tierStep('r10-tavern', 5, 'Reach Tier 5',
    'Push your Shop to Tier 5. Do it first, while your Gold is full — then spend what is left on the board.',
    'Late rounds reward the shop you built earlier. Tier first, board second, is the usual order.'),
  freeBuildStep(
    'r10-free',
    'Your Turn to Drive',
    'Now you lead. Spend your Gold to strengthen the board — you can raise your Shop tier too. End Turn when you are happy.',
    'There is no single right buy — a stronger board is the only goal.',
  ),
  combatDebriefStep('r10-debrief', 'Back to the Shop', 'End combat here and go back to the shop.'),
];

const round11Steps: TutorialStep[] = [
  tierStep('r11-tavern', 6, 'The Top Tier',
    'One more: raise your Shop to Tier 6, the highest there is. Everything the game has to offer is now in your shop.',
    'Reaching the top tier is the goal of every climb — from here it is all about what you build with it.'),
  freeBuildStep(
    'r11-free',
    'Now Build',
    'Tier 6 is open — the best minions in the game are in your shop. Spend the rest of your Gold, then End Turn.',
  ),
  combatDebriefStep('r11-debrief', 'Back to the Shop', 'End combat here and go back to the shop.'),
];

const round12Steps: TutorialStep[] = [
  freeBuildStep(
    'r12-free',
    'The Last Round',
    'Last round of your first game. Build the strongest board you can and send it in — everything you have learned, one final time.',
  ),
  // The graduation beat: a warm confirm, then returning to the shop ends the course (the lobby's round cap is
  // reached) and the tutorial graduation screen takes over. See `EndScreen` / `TutorialGraduationScreen`.
  combatDebriefStep('r12-debrief', 'You Are Ready', 'That is the whole game: shop, build, position, fight — round after round. You have got it. Click here to finish the tutorial.'),
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
      { minions: [ROUND1_BUY, 'manasaber', 'kennel'] },
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
      { minions: [CARD_IDS.packstrider, 'manasaber', 'b2_armadiyo'] },
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
    // 4 Attack, not 3: Preparation is AVAILABLE on turn 3, and a player who spends it on T-Rex makes it 3/4
    // — a 3-Attack swing would leave it alive and the debrief would narrate an Echo that never fired.
    omenBoard: [{ attack: 4, health: 8 }, { attack: 3, health: 5 }],
    forceEnemyFirstTargetCard: CARD_IDS.trex,
    // Initial roll has no T-Rex (so the round teaches Refresh); the refresh roll [1] offers T-Rex.
    shopRolls: [
      { minions: ['seaurchin', 'manasaber', 'b2_dawnclaw'] },
      { minions: [CARD_IDS.trex, CARD_IDS.wolvie, 'b2_armadiyo'] },
    ],
    steps: round3Steps,
  },
  {
    turn: 4,
    opponentSeatId: 's4',
    combatSeed: 'learn-ascent-r4',
    omenBoard: [{ attack: 3, health: 4 }, { attack: 3, health: 3 }, { attack: 2, health: 2 }],
    // Offers Wolvie (bought) and Sea Urchin — the round buys Wolvie, then FREEZES to keep Sea Urchin, which
    // carries into Round 5's Shout lesson so freezing visibly "kept" a minion.
    shopRolls: [
      { minions: [CARD_IDS.wolvie, CARD_IDS.urchin, 'b2_armadiyo'] },
    ],
    steps: round4Steps,
  },
  {
    turn: 5,
    opponentSeatId: 's5',
    combatSeed: 'learn-ascent-r5',
    omenBoard: [{ attack: 4, health: 4 }, { attack: 3, health: 4 }, { attack: 2, health: 3 }],
    // Offers Sea Urchin (the Shout minion).
    shopRolls: [
      { minions: [CARD_IDS.urchin, 'b2_bullseye', 'manasaber'] },
    ],
    steps: round5Steps,
  },
  {
    turn: 6,
    opponentSeatId: 's6',
    combatSeed: 'learn-ascent-r6',
    omenBoard: [{ attack: 4, health: 5 }, { attack: 4, health: 4 }, { attack: 3, health: 3 }],
    // THE BASIC RUNEFORGE (owner ask 2026-08-22). Three runes a first-timer can read in one breath, all
    // set-agnostic and all meaningful to the all-Beast board the course has built: bigger summoned bodies,
    // flat Gold, and a free Rally trigger — the keyword Round 1 opened with.
    runeOffer: { runes: ['rune_packcraft', 'rune_small_fortune', 'rune_rallying'] },
    // Offers Kennelmaster (Start of Combat) — the round also upgrades the Tavern to Tier 3.
    shopRolls: [
      { minions: [CARD_IDS.kennel, 'b2_bullseye', 'manasaber'] },
    ],
    steps: round6Steps,
  },
  {
    turn: 7,
    opponentSeatId: 's7',
    combatSeed: 'learn-ascent-r7',
    omenBoard: [{ attack: 5, health: 5 }, { attack: 4, health: 4 }, { attack: 3, health: 4 }, { attack: 2, health: 2 }],
    // Offers Echohorn (Tier 3) — the round is at Tier 3 after Round 4's upgrade, and upgrades to Tier 4 here.
    shopRolls: [
      { minions: [CARD_IDS.echohorn, CARD_IDS.wolvie, 'b2_armadiyo'] },
    ],
    steps: round7Steps,
  },
  {
    turn: 8,
    opponentSeatId: 's8',
    combatSeed: 'learn-ascent-r8',
    omenBoard: [{ attack: 5, health: 6 }, { attack: 5, health: 5 }, { attack: 4, health: 4 }, { attack: 3, health: 3 }],
    // Offers the THIRD Packstrider (completes the triple → Golden). Clean fillers, no Ruby/Consume clutter.
    shopRolls: [
      { minions: [CARD_IDS.packstrider, 'b2_armadiyo', 'b2_bullseye'] },
    ],
    steps: round8Steps,
  },
  {
    turn: 9,
    opponentSeatId: 's9',
    combatSeed: 'learn-ascent-r9',
    omenBoard: [{ attack: 6, health: 6 }, { attack: 5, health: 6 }, { attack: 4, health: 5 }, { attack: 4, health: 4 }],
    // THE EPIC RUNEFORGE (owner ask 2026-08-22) — the same lesson one size up, on the round the real game
    // opens it. Three Epics that each pay off THIS board and each name a keyword the course already taught:
    // doubled Rallies (Round 1), doubled Shouts (Round 5), and doubled Echoes (Round 3).
    runeOffer: { runes: ['rune_adventuring', 'rune_choir', 'rune_reliquary'], epic: true },
    // Offers Blessing in the MINION ROW (a spell offer buys/casts through the normal drag). Clean fillers.
    shopRolls: [
      { minions: [CARD_IDS.blessing, 'b2_armadiyo', 'manasaber'] },
    ],
    steps: round9Steps,
  },
  {
    turn: 10,
    opponentSeatId: 's10',
    combatSeed: 'learn-ascent-r10',
    omenBoard: [{ attack: 6, health: 7 }, { attack: 6, health: 6 }, { attack: 5, health: 5 }, { attack: 4, health: 5 }],
    // INDEPENDENCE: a spread of clean minions + a refresh, so the player has real choices to make on their own.
    shopRolls: [
      { minions: ['b2_wolvie', 'seaurchin', 'b2_armadiyo'] },
      { minions: ['b2_trex', 'b2_packstrider', 'b2_armadiyo'] },
      { minions: ['seaurchin', 'b2_echohorn', 'b2_wolvie'] },
      { minions: ['b2_packstrider', 'b2_trex', 'seaurchin'] },
    ],
    steps: round10Steps,
  },
  {
    turn: 11,
    opponentSeatId: 's11',
    combatSeed: 'learn-ascent-r11',
    omenBoard: [{ attack: 7, health: 7 }, { attack: 6, health: 7 }, { attack: 6, health: 6 }, { attack: 5, health: 5 }, { attack: 4, health: 4 }],
    shopRolls: [
      { minions: ['kennel', 'b2_wolvie', 'b2_armadiyo'] },
      { minions: ['seaurchin', 'b2_echohorn', 'b2_trex'] },
      { minions: ['b2_packstrider', 'b2_armadiyo', 'b2_wolvie'] },
      { minions: ['b2_echohorn', 'seaurchin', 'b2_trex'] },
    ],
    steps: round11Steps,
  },
  {
    turn: 12,
    opponentSeatId: 's12',
    combatSeed: 'learn-ascent-r12',
    omenBoard: [{ attack: 8, health: 8 }, { attack: 7, health: 7 }, { attack: 7, health: 7 }, { attack: 6, health: 6 }, { attack: 5, health: 5 }],
    shopRolls: [
      { minions: ['b2_trex', 'seaurchin', 'b2_wolvie'] },
      { minions: ['kennel', 'b2_echohorn', 'b2_packstrider'] },
      { minions: ['b2_wolvie', 'b2_armadiyo', 'b2_trex'] },
      { minions: ['seaurchin', 'b2_packstrider', 'b2_echohorn'] },
    ],
    steps: round12Steps,
  },
];

/**
 * LEARN ASCENT — the core FTUE course. Aster-only, pinned to Set 2, 12 authored rounds (fundamentals → systems →
 * supervised independence → graduation). `contentRevision` labels the card slice the course was authored against.
 */
export const LEARN_ASCENT: TutorialCourse = {
  id: 'learn-ascent',
  kind: 'core',
  version: 1,
  contentRevision: 'set2-2026-08-17',
  setId: 'set2',
  heroId: 'aster',
  title: 'Learn Ascent',
  summary: 'A coached first game — shop, build, position, and win; bring a synergy engine together; triple, Discover, cast a spell; then graduate.',
  rounds: 12,
  // The table THINS toward a duel (owner ask 2026-08-21). Authored seats all field the same board each round,
  // so their mutual fights draw and nobody was ever knocked out — the rail stayed 8-wide and round 12 felt
  // like any other round. These are the opponents still standing after each round; the lobby retires the
  // weakest through the normal elimination path, so placements, the rail and the knockout treatment all read
  // as they do in a real game. Entering round 12 there is exactly ONE opponent left: a final duel.
  seatsRemaining: [7, 7, 6, 6, 5, 5, 4, 3, 3, 2, 1, 1],
  // Every minion Discover this course opens offers BEASTS only — the roster is all Beasts, so a Triple
  // Reward that handed over a random off-tribe minion undid the synergy lesson in one pick.
  discoverTribe: 'beast',
  opponentNames: ['Rook', 'Vale', 'Mira', 'Flint', 'Ibis', 'Nox', 'Crown', 'Bex', 'Halo', 'Dune', 'Wren', 'Sol'],
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
      // Spotlight the Health box under the portrait as well as the seat: the copy names Health, so the number
      // it refers to has to be one of the things lit up (owner ask 2026-08-20).
      anchors: [{ kind: 'ui', id: 'lobby-self' }, { kind: 'ui', id: 'health' }],
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
