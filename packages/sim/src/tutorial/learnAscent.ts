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
    title: 'Your gold',
    body: "This is your gold. It will slowly ramp up each round to a maximum of ten gold as you see here. But don't worry, there are many ways to accumulate more gold to spend!",
    anchors: [{ kind: 'ui', id: 'gold' }],
    gate: 'observe',
    completion: { kind: 'always' },
  },
  {
    id: 'r1-buy',
    phase: 'shop',
    focusMode: 'action',
    title: "Let's get started",
    body: 'Time to buy your first minion! Drag Packstrider down below the board to recruit it. Buying moves the minion into your hand.',
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
    title: 'Your hand',
    body: 'It is now in your hand. You may carry up to 10 cards in your hand at a time. Now drag the Packstrider from your hand onto your board so it can fight.',
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
    title: 'Using your hero power',
    body: 'Tap Preparation, then pick Packstrider. This gives a friendly minion +1/+1 — free, whenever it is lit. There are over 50 heroes in the game,so this hero power will be very different from hero to hero, game to game!',
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
    title: 'End your turn / Start battle',
    body: 'You are all set for now. End the turn to send your warband into battle.',
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
  combatDebriefStep('r1-debrief', 'You won!', "Your warband won! You didn't lose any health. Losing fights will cause you to take damage.", undefined, 'health', "Treat health points like another form of currency. Sometimes it's worth a round of weakness for a stronger board after."),
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
  // TIER-LEGAL ROSTER (owner report 2026-08-23: "there is a t2 minion while im t1 here"). A scripted shop is
  // served verbatim — `rollTutorialShop` never consults the pool or the tavern tier — so an over-tier id is
  // shown to the player as if their Tier-1 shop could offer it, teaching the OPPOSITE of the tier rule the
  // course is about to explain. Every id below is now legal at the round it appears on (see the shop table).
  // Pennycat replaces Sea Urchin as the Shout teacher: Urchin is Tier 4 and Round 5 is played at Tier 3.
  // Pennycat's Shout also lands ON THE BOARD (a summoned Stray) instead of up in a Discover overlay, so the
  // trigger is visible where the player is already looking — and Discover still gets its own lesson in Round 8.
  pennycat: 'alley', // T1 Beast 1/1 — "Shout: summon a 1/1 Stray next to it" (teaches Shout, untargeted)
  kennel: 'kennel', // T2 Beast — "Start of Combat: give your Beast Aura +1 Attack"
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
function heroPowerReminderStep(id: string, title: string, body: string): TutorialStep {
  return {
    id, phase: 'shop', focusMode: 'action', title,
    body,
    // Light the WARBAND too, with the arrow running power → board (owner 2026-08-21). The power is only half
    // the instruction: it is targeted, so a player who taps it still has to know the buff goes onto one of
    // their own minions. Spotlighting the button alone left the second half unsaid.
    anchors: [{ kind: 'ui', id: 'hero-power' }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'ui', id: 'hero-power' }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'soft',
    completion: { kind: 'any', of: [{ kind: 'heroPowerUsed' }, { kind: 'not', of: { kind: 'heroPowerReady' } }] },
  };
}

function endTurnStep(id: string, title: string, body: string, lessonId?: string): TutorialStep {
  return {
    id, phase: 'shop', focusMode: 'action', title, body,
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
function combatDebriefStep(id: string, title: string, body: string, lessonId?: string, alsoAnchor?: TutorialUiAnchor, why?: string): TutorialStep {
  return {
    id, phase: 'combat', focusMode: 'confirm', title, body,
    // `alsoAnchor` lights a second control alongside the return button — used by the debriefs whose copy names
    // Health, so the number being talked about is actually on screen (owner ask 2026-08-20).
    anchors: alsoAnchor ? [{ kind: 'ui', id: 'end-turn' }, { kind: 'ui', id: alsoAnchor }] : [{ kind: 'ui', id: 'end-turn' }],
    gate: 'hard',
    ...(lessonId ? { lessonId } : {}),
    ...(why ? { why } : {}),
    completion: { kind: 'returnedToShop' },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 2 — build a WIDER board (a second minion) + the first Tavern upgrade. Teaches that more bodies win.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round2Steps: TutorialStep[] = [
  {
    id: 'r2-buy',
    phase: 'shop', focusMode: 'action', title: 'Increase your warband size',
    body: 'Buy a second Packstrider. Remember, you can have up to 7 minions on you warband at a time!',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.packstrider }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.packstrider }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.packstrider },
  },
  {
    id: 'r2-play',
    phase: 'shop', focusMode: 'action', title: 'Place it / Rearrange it',
    body: "Play it onto your board beside the first, so both fight this round. Don't worry where it lands, you can always reposition it.",
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.packstrider }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.packstrider }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.packstrider },
  },
  {
    id: 'r2-tavern',
    phase: 'shop', focusMode: 'action', title: 'Upgrade the shop',
    body: 'You have the gold to raise your Shop to Tier 2. Your shop only ever offers minions AT OR BELOW its tier.',
    why: 'Upgrading the shop is expensive, but crucial to increase your warband strength over time. Higher tier minions will grant you more ways to increase the strength of your warband.',
    anchors: [{ kind: 'ui', id: 'tavern-up' }],
    gate: 'hard', lessonId: 'tavern_up',
    completion: { kind: 'tierAtLeast', tier: 2 },
  },
  heroPowerReminderStep('r2-power', "Don't forget! Use your hero power", "This hero's power is free, if you lose nothing by using it whenever you can! Not all hero powers will be free and will vary in strength."),
  endTurnStep('r2-end', 'End your turn', 'Alright, your board is stronger now. End the turn to face off against your next opponent.'),
  combatDebriefStep('r2-debrief', 'You won again!', 'While winning is great, you can also tie a round. In a tie, no one loses HP. Click the gem to return to the shop.', 'read_health_loss', 'health'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 3 — the first CARD MECHANIC beyond Rally: Echo. Buy T-Rex, watch it leave a body behind when it dies.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round3Steps: TutorialStep[] = [
  {
    id: 'r3-refresh',
    phase: 'shop', focusMode: 'action', title: 'Refreshing the shop',
    body: 'Not excited by what the shop is offering? Spend 1 Gold to refresh the shop for a new set of offers.',
    why: "This is a major decision you must make to compete with the strongest of warbands at the end of a game. Taking what you are given won't always be strong enough.",
    anchors: [{ kind: 'ui', id: 'refresh' }],
    gate: 'hard', lessonId: 'refresh_shop',
    completion: { kind: 'refreshed' },
  },
  {
    id: 'r3-buy-trex',
    phase: 'shop', focusMode: 'action', title: 'Echo cards',
    body: 'Buy T-Rex. It has Echo, a keyword that triggers when the minion dies.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.trex }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.trex }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.trex },
  },
  {
    id: 'r3-play-trex',
    phase: 'shop', focusMode: 'action', title: 'Play the T-Rex',
    body: 'Play T-Rex onto your board. When it dies in combat, its Echo leaves a new minion behind.',
    why: 'Echo minions provide a lot of bang for the buck. They provide various benefits each time they die in battle.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.trex }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.trex }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'keyword_echo',
    completion: { kind: 'played', cardId: CARD_IDS.trex },
  },
  heroPowerReminderStep('r3-power', 'Use your hero power', "Reminder that this hero's power is free! It recharges every other turn, so use it whenever it is available."),
  endTurnStep('r3-end', 'End your turn', 'End the turn. Watch for T-Rex dying to see its Echo in action.'),
  combatDebriefStep('r3-debrief', 'Did you see it?', 'The T-Rex spawned a second minion! Echo minions have many various ways to aid you in battle. Click here to return to the shop.'),
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
  // NO `noScrim` HERE (owner report 2026-08-23: "step 31 needs a spotlight over the tier up button"). It reads
  // like a dimming preference, but the controller drops the dim AND THE SPOTLIGHT together — so a hard-gated
  // "click THIS button" step marked `noScrim` names a control and then highlights nothing. It belongs on the
  // independence rounds, where the player is driving and nothing should be picked out, and on steps a modal
  // already dims behind. Round 2's hand-written tier step never had it; these four were copied from the
  // Runeforge step's shape instead, which legitimately sets it.
  gate: 'hard', lessonId: 'tavern_up',
  completion: { kind: 'tierAtLeast', tier },
});

// Round 4 — the build comes together: freeze a good offer, round out the board, then graduate.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round4Steps: TutorialStep[] = [
  {
    id: 'r4-buy',
    phase: 'shop', focusMode: 'action', title: 'Protecting the board',
    body: 'Buy Wolvie, a Beast with Taunt.',
    why: 'Taunt is a great way to keep your attacking units safe. Taunt units must be destroyed before other units can be targeted again.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.wolvie }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.wolvie }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.wolvie },
  },
  {
    id: 'r4-play',
    phase: 'shop', focusMode: 'action', title: 'Place it',
    body: "Play it onto your board. Your warband is starting to synergize! Rallies out front, Echo's following, and a Taunt keeping them all protected.",
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.wolvie }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.wolvie }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.wolvie },
  },
  {
    id: 'r4-freeze',
    phase: 'shop', focusMode: 'action', title: 'Freezing for later',
    body: 'Wait! Pennycat is still sitting in your shop. Freeze the shop keep it available to buy from next turn.',
    why: "Freezing a shop is a great way to secure minions you want when you can't afford them this turn.",
    anchors: [{ kind: 'ui', id: 'freeze' }],
    gate: 'hard', lessonId: 'freeze_shop',
    completion: { kind: 'froze' },
  },
  tierStep('r4-tavern', 3, 'Level up the shop to tier 3',
    'Now raise your Shop to Tier 3. Remember, each shop tier will offer stronger minions than the last.'),
  // Nudge this one power-reminder panel RIGHT so it clears the frozen Pennycat sitting in the shop
  // (owner 2026-08-24). Design px; tune the number here if it needs more/less.
  { ...heroPowerReminderStep('r4-power', 'Use your hero power', "Reminder that this hero's power is free! It recharges every other turn, so use it whenever it is available."), panelNudge: { dx: 220 } },
  endTurnStep('r4-end', 'End your turn', "OK, let's see how this warband does! End the turn and send your troops in."),
  combatDebriefStep('r4-debrief', "And that's the loop!", "Shop, build, position, fight, thats it! Sounds simple, right? Well, there's more to learn. Click here to return to the shop."),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 5 — SHOUT: a trigger that fires the moment you play a minion from your hand. The frozen Pennycat
// from Round 4 is the teacher, so freezing visibly "kept" something the very next round.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round5Steps: TutorialStep[] = [
  {
    id: 'r5-buy',
    phase: 'shop', focusMode: 'action', title: 'Shout minions',
    body: "Time to buy the Pennycat you froze last turn. Notice it has a keyword we haven't seen before, Shout!",
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.pennycat }],
    // The drag the step is asking for, drawn: shop offer -> your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.pennycat }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.pennycat },
  },
  {
    id: 'r5-play',
    phase: 'shop', focusMode: 'action', title: 'Understanding Shout',
    body: 'Play it and watch: its Shout fires the moment it lands, summoning a Stray beside it. Two units for the cost of one!',
    why: 'Shout triggers the moment you play a card from hand. Be mindful about what order to play cards to get the most benefit!',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.pennycat }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.pennycat }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'keyword_shout',
    completion: { kind: 'played', cardId: CARD_IDS.pennycat },
  },
  heroPowerReminderStep('r5-power', 'Use your hero power', "I'm sure you get it by now. Use the hero power on your favorite minion."),
  endTurnStep('r5-end', 'End your turn', 'Our board is even bigger than last round! End the turn and fight.'),
  combatDebriefStep('r5-debrief', 'Recapping Keywords', 'Shout fires when a minion is played, Echo fires when a minion dies, Rally fires when a minion attacks, and Taunt draws all attacks until it is destroyed. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 6 — START OF COMBAT: an effect that fires as the fight begins. Plus the RUNEFORGE (the tier step
// moved to Round 4 — a round that buys a minion AND a rune has no Gold left for an upgrade).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round6Steps: TutorialStep[] = [
  // THE RUNE STEP LEADS THE ROUND, because the forge is not something the player opens — it is queued at
  // turn start (`pendingBasicForge` → `openNextStartOfTurnModal`) and owns the screen the moment the round
  // begins. Coaching a shop buy first left the player staring at the Runeforge while the coach pointed at a
  // shop they could not reach, with the connector trailing off into empty board (owner report 2026-08-23).
  // Round 9's forge round has always led with its rune step; this one now matches.
  {
    id: 'r6-rune',
    phase: 'shop', focusMode: 'action', title: 'The Runeforge',
    body: 'The Runeforge is open. A Rune is a permanent rule for the rest of this run. Select one, but be mindful of its cost.',
    why: 'Runes can vary in strength, but their cost will rise accordingly! Try to think ahead about how you want your warband to play out later in the game when selecting Runes.',
    anchors: [{ kind: 'ui', id: 'discover' }],
    // This panel is centred (the full-screen forge overlay resolves no anchor rect), so it lands on top of the
    // rune choices. Shove it RIGHT so the runes are readable (owner 2026-08-24). Design px; tune here.
    panelNudge: { dx: 600 },
    gate: 'hard', noScrim: true, lessonId: 'rune_buy',
    completion: { kind: 'ownsRunes', atLeast: 1 },
  },
  {
    id: 'r6-buy',
    phase: 'shop', focusMode: 'action', title: 'Start of Combat',
    body: 'Buy Kennelmaster. Its Start-of-Combat effect fires once the fight begins and every Beast you own gets stronger.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.kennel }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.kennel }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.kennel },
  },
  {
    id: 'r6-play',
    phase: 'shop', focusMode: 'action', title: 'Place It',
    body: 'Play Kennelmaster onto your board. Watch your Beasts gain Attack as the fight begins.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.kennel }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.kennel }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.kennel },
  },
  heroPowerReminderStep('r6-power', 'Use Your Power', 'Preparation is free! Use it!'),
  endTurnStep('r6-end', 'End Your Turn', 'End the turn and watch your Beasts gain Attack at the Start of Combat.'),
  combatDebriefStep('r6-debrief', 'Start of Combat', 'Start-of-Combat effects fire before any attacks. These can be pivotal in turning the tides of a battle. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 7 — THE TIER RULE, DEMONSTRATED + POSITION-DEPENDENT SYNERGY. Echohorn is Tier 4 and the round opens at
// Tier 3, so the player cannot see it yet — they raise the Tavern, refresh, and WATCH the Tier-4 minion appear.
// That is the whole tier rule shown rather than asserted (owner ask 2026-08-23), and it costs the round nothing
// extra: the upgrade and the buy were both already here. Then Echohorn's Rally triggers your LEFT-MOST Echo, so
// where you place T-Rex decides whether the engine fires — the payoff of everything so far.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round7Steps: TutorialStep[] = [
  {
    id: 'r7-makeroom',
    phase: 'shop', focusMode: 'action', title: "Let's make some room",
    body: "Sell Kennelmaster to start making room. You'l' need space for what comes next.",
    why: "Think of board space as another resource. Echohorn re-fires T-Rex’s Echo, and that Baby needs somewhere to go. If there is no space, it won't summon.",
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
    phase: 'shop', focusMode: 'action', title: 'One more!',
    body: 'Sell Pennycat too. Now there is room for Echohorn and what it can summon.',
    anchors: [{ kind: 'card', zone: 'board', alias: CARD_IDS.pennycat }],
    gate: 'hard',
    completion: { kind: 'sold', cardId: CARD_IDS.pennycat },
  },
  // THE TIER RULE, SHOWN. These two steps run BEFORE the buy, because at Tier 3 the shop genuinely cannot
  // offer Echohorn — the pre-upgrade roll does not contain it. Upgrade, then refresh, and the Tier-4 card is
  // there. The upgrade also has to come first for a second reason: the tier step is hard-gated, so leaving it
  // at the end of the round would ask the player to buy a card their shop was not yet allowed to show.
  tierStep('r7-tavern', 4, 'Reach Tier 4',
    'We have enough gold to level to Tier 4! Would be wise to do so, so we can start getting more powerful units.'),
  {
    id: 'r7-refresh',
    phase: 'shop', focusMode: 'action', title: "Let's see what it unlocked",
    body: 'Your shop is still showing the offers it rolled at Tier 3. Refresh it for 1 Gold.',
    why: 'Tiering up does not change the offers already in front of yor. It changes what following rolls can contain.',
    anchors: [{ kind: 'ui', id: 'refresh' }],
    gate: 'hard', lessonId: 'refresh_shop',
    completion: { kind: 'refreshed' },
  },
  {
    id: 'r7-buy',
    phase: 'shop', focusMode: 'action', title: 'We found Echohorn!',
    body: 'There it is. Echohorn, a Tier 4 minion, offered because your shop is now Tier 4. Buy it!',
    why: "When Echohorn attacks, it's rally effect will trigger your left-most Echo without the need for it to die first! Sounds powerful.",
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.echohorn }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.echohorn }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.echohorn },
  },
  {
    id: 'r7-play',
    phase: 'shop', focusMode: 'action', title: 'Play the Echohorn',
    body: 'Play Echohorn onto your board.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.echohorn }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.echohorn }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'play_minion',
    completion: { kind: 'played', cardId: CARD_IDS.echohorn },
  },
  {
    id: 'r7-position',
    phase: 'shop', focusMode: 'action', title: 'Position for synergy',
    body: 'Drag the Echohorn all the way to the left, and then drag the T-Rex to the right of the Echohorn.',
    why: "When Echohorn attacks, it will trigger T-Rex's Echo effect, summoning another unit to the fight!",
    // Spotlight T-Rex itself and draw the move to slot 0 — the step names a specific minion and a specific
    // destination, so both should be lit.
    anchors: [{ kind: 'card', zone: 'board', alias: CARD_IDS.trex }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'board', alias: CARD_IDS.trex }, to: { kind: 'boardSlot', index: 0 }, style: 'order' },
    gate: 'hard', lessonId: 'reorder_minion',
    // STATE, not the `reordered` event: the old predicate accepted any drag, so clicking (or nudging a
    // different minion) completed a step that is specifically about T-Rex ending up left-most.
    completion: { kind: 'cardAtSlot', cardId: CARD_IDS.trex, index: 0 },
  },
  heroPowerReminderStep('r7-power', 'Use your hero power', "Let's use this again to buff up another unit!"),
  endTurnStep('r7-end', 'End your turn', "Alright, let's see the Echohorn synergy in action!"),
  combatDebriefStep('r7-debrief', 'The build is coming together', 'Rally, Echo, positioning, and more! That is the heart of the game. Click here to return to the shop.'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 8 — GILDING + DISCOVER. The two Packstriders from Rounds 1–2 finally meet a third: three copies merge
// into one GOLDEN, and playing that golden pays a Triple Reward — a Discover. One round, two core systems, both
// as the natural payoff of a board the player already built.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round8Steps: TutorialStep[] = [
  {
    id: 'r8-buy',
    phase: 'shop', focusMode: 'action', title: 'Complete a triple',
    body: 'You have two Packstriders. Buy the third to combine all three into a single GILDED version. Combining stats and increasing its effect!',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.packstrider }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.packstrider }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'gild_minion',
    completion: { kind: 'bought', cardId: CARD_IDS.packstrider },
  },
  {
    id: 'r8-play-golden',
    phase: 'shop', focusMode: 'action', title: 'Play the golden',
    body: 'The Golden Packstrider is in your hand. Play it onto your board to receive a Triple Reward',
    why: 'A Gilded minion is a triple: it saves board space and hits far harder than its plain version does.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.packstrider }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.packstrider }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'gild_minion',
    completion: { kind: 'played', cardId: CARD_IDS.packstrider },
  },
  {
    id: 'r8-discover',
    phase: 'shop', focusMode: 'action', title: 'Discover a minion',
    body: 'This is your Triple Reward. Play it to Discover 3 minions from the Shop Tier ABOVE yours. Pick one to add to your hand.',
    // WAITS FOR THE PICK, NOT THE PLAY THAT OPENS IT. Playing the Triple Reward token is what RAISES the
    // Discover overlay, so completing on `played` ticked this step off while the modal still owned the screen
    // — and the very next beat (the hero-power reminder) was then coached against a screen the player could
    // not act on, with the reducer refusing `heroPower` while a Discover is pending. Same shape as the
    // Runeforge failure the owner hit on Round 6 (full-course audit 2026-08-23).
    // The overlay's own cutout is anchored here because this beat now spans both actions: play the token, then
    // choose. `allowedActionKinds` is explicit because `discovered` teaches no verb of its own (picking is
    // always allowed) — without it the gate would block the `play` that opens the Discover.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.tripleReward }, { kind: 'ui', id: 'discover' }],
    gate: 'hard', noScrim: true, lessonId: 'keyword_discover',
    allowedActionKinds: ['play'],
    completion: { kind: 'discovered' },
  },
  heroPowerReminderStep('r8-power', 'Use your hero power', 'Preparation is free! Use it before your fight. It recharges every other turn, so use it whenever it is ready.'),
  {
    id: 'r8-end',
    phase: 'shop', focusMode: 'action', title: 'Play the minion and end turn',
    body: "Let's get that new minion into our warband to gain strength before our next fight!",
    anchors: [{ kind: 'ui', id: 'hand' }, { kind: 'ui', id: 'warband' }],
    gate: 'soft', allowedActionKinds: ['play', 'faceOmen'],
    completion: { kind: 'endedTurn' },
  },
  combatDebriefStep('r8-debrief', 'The power of Gilded units', 'Save board space, get a Triple Reward and Discover a unit from the shop tier above you. Pretty strong!'),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 9 — SPELLS. A one-shot effect bought from the shop and cast from hand. Blessing is a clean single-target
// buff, scripted into the minion row so it buys + casts through the normal drag the player already knows.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const round9Steps: TutorialStep[] = [
  {
    id: 'r9-rune',
    phase: 'shop', focusMode: 'action', title: 'The Epic Runeforge',
    body: 'Remember this from before? Now these offer even stronger bonuses. Find one that synergizes best with your build.',
    why: 'Epic Runes are strong enough to really solidify a build. Pick the one that fits the board you have.',
    anchors: [{ kind: 'ui', id: 'discover' }],
    gate: 'hard', noScrim: true, lessonId: 'rune_buy_epic',
    // TWO, not one: the round-6 rune is already owned, so "at least 1" would be satisfied before the forge
    // even opens and the step would tick past itself.
    completion: { kind: 'ownsRunes', atLeast: 2 },
  },
  {
    id: 'r9-buy',
    phase: 'shop', focusMode: 'action', title: 'Buy a spell',
    body: 'Buy Blessing. Spells are one-time effects. You buy them like a minion, then you cast them from hand so they cannot be sold.',
    anchors: [{ kind: 'card', zone: 'shop', alias: CARD_IDS.blessing }],
    // The drag the step is asking for, drawn: shop offer → your hand (owner ask 2026-08-20).
    connector: { from: { kind: 'card', zone: 'shop', alias: CARD_IDS.blessing }, to: { kind: 'ui', id: 'hand' }, style: 'drag' },
    gate: 'hard', lessonId: 'buy_spell',
    completion: { kind: 'bought', cardId: CARD_IDS.blessing },
  },
  {
    id: 'r9-cast',
    phase: 'shop', focusMode: 'action', title: 'Cast It',
    body: 'Drag Blessing from your hand onto one of your minions to give it +3/+4 twice.',
    why: 'A spell is spent when cast.',
    // Spotlight the CARD being asked for as well as the destination, with the drag drawn between
    // them — the bare `warband` anchor left the player hunting for which card to move.
    anchors: [{ kind: 'card', zone: 'hand', alias: CARD_IDS.blessing }, { kind: 'ui', id: 'warband' }],
    connector: { from: { kind: 'card', zone: 'hand', alias: CARD_IDS.blessing }, to: { kind: 'ui', id: 'warband' }, style: 'drag' },
    gate: 'hard', lessonId: 'cast_spell',
    completion: { kind: 'played', cardId: CARD_IDS.blessing },
  },
  heroPowerReminderStep('r9-power', 'Use your hero power', "Let's use this again to buff up another unit!"),
  endTurnStep('r9-end', 'End your turn', "Spells can become very powerful throughout a run! They can be strong enough to turn a fight. End turn and let's see how we do."),
  combatDebriefStep('r9-debrief', 'Spells', 'That strength from the Blessing spell really helped us win that fight! Click here to return to the shop.'),
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
    'Upgrade your Shop to Tier 5, then spend what gold we have left.'),
  freeBuildStep(
    'r10-free',
    'Your turn to drive',
    'Now you lead. Spend your Gold to strengthen the board, or you can raise your Shop tier too. End Turn when you are happy.',
    'There is no single right choice. A stronger board is the only goal.',
  ),
  combatDebriefStep('r10-debrief', 'Back to the Shop', 'End combat here and go back to the shop.'),
];

const round11Steps: TutorialStep[] = [
  tierStep('r11-tavern', 6, 'Tavern Tier 6',
    'Raise your Shop to Tier 6, the highest there is! You now have access to the most powerful minions in the game.'),
  freeBuildStep(
    'r11-free',
    'Now Build',
    'Spend the rest of your Gold how you see fit, then End Turn.'
  ),
  combatDebriefStep('r11-debrief', 'Back to the Shop', 'End combat here and go back to the shop.'),
];

const round12Steps: TutorialStep[] = [
  freeBuildStep(
    'r12-free',
    'The final round',
    "Here we go! This is the last round, the final faceoff! Use everything you've learned to strengthen your board."
  ),
  // The graduation beat: a warm confirm, then returning to the shop ends the course (the lobby's round cap is
  // reached) and the tutorial graduation screen takes over. See `EndScreen` / `TutorialGraduationScreen`.
  combatDebriefStep('r12-debrief', 'This is Ascent', 'And that is the game! While it may feel simple, there are nearly limitless decisions you can make in a single round. Every single game will always be different. Go learn and have fun!'),
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
      // `kennel` used to sit in this third slot — it is Tier 2, and it is what the owner spotted in a Tier-1 shop.
      { minions: [ROUND1_BUY, 'manasaber', 'b2_ninjapal'] },
    ],
    steps: round1Steps,
  },
  {
    turn: 2,
    opponentSeatId: 's2',
    combatSeed: 'learn-ascent-r2',
    // Beatable by two Packstriders (each Rally-buffing off the other).
    omenBoard: [{ attack: 2, health: 2 }, { attack: 1, health: 3 }],
    // Offers a second Packstrider (T1) — the round buys it, then upgrades. All Tier 1: this shop ROLLED at
    // Tier 1, and tiering up mid-round does not retroactively change offers already on the table.
    shopRolls: [
      { minions: [CARD_IDS.packstrider, 'manasaber', 'alley'] },
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
    // Tier 2. Initial roll has no T-Rex (so the round teaches Refresh); the refresh roll [1] offers T-Rex.
    shopRolls: [
      { minions: ['pack', 'manasaber', 'alley'] },
      { minions: [CARD_IDS.trex, CARD_IDS.wolvie, 'pack'] },
    ],
    steps: round3Steps,
  },
  {
    turn: 4,
    opponentSeatId: 's4',
    combatSeed: 'learn-ascent-r4',
    omenBoard: [{ attack: 3, health: 4 }, { attack: 3, health: 3 }, { attack: 2, health: 2 }],
    // Tier 2. Offers Wolvie (bought) and Pennycat — the round buys Wolvie, then FREEZES to keep Pennycat,
    // which carries into Round 5's Shout lesson so freezing visibly "kept" a minion.
    shopRolls: [
      { minions: [CARD_IDS.wolvie, CARD_IDS.pennycat, 'pack'] },
    ],
    steps: round4Steps,
  },
  {
    turn: 5,
    opponentSeatId: 's5',
    combatSeed: 'learn-ascent-r5',
    omenBoard: [{ attack: 4, health: 4 }, { attack: 3, health: 4 }, { attack: 2, health: 3 }],
    // Tier 3. Re-lists the frozen Pennycat: a tutorial's scripted shop always wins on a new turn (see
    // `rollTutorialShop`), so the freeze lesson stays coherent by re-scripting the kept card here.
    shopRolls: [
      { minions: [CARD_IDS.pennycat, 'b2_bullseye', 'manasaber'] },
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
    // Tier 3. Offers Kennelmaster (Start of Combat) alongside the Runeforge.
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
    // TWO ROLLS, AND THE DIFFERENCE IS THE LESSON. Roll 0 is the Tier-3 shop the round opens with — no
    // Echohorn, because Echohorn is Tier 4 and a Tier-3 shop cannot offer it. Roll 1 is served by the coached
    // refresh AFTER the upgrade, and leads with two Tier-4 minions so the unlock is unmistakable.
    shopRolls: [
      { minions: [CARD_IDS.wolvie, 'b2_armadiyo', 'manasaber'] },
      { minions: [CARD_IDS.echohorn, 'seaurchin', 'b2_armadiyo'] },
    ],
    steps: round7Steps,
  },
  {
    turn: 8,
    opponentSeatId: 's8',
    combatSeed: 'learn-ascent-r8',
    omenBoard: [{ attack: 5, health: 6 }, { attack: 5, health: 5 }, { attack: 4, health: 4 }, { attack: 3, health: 3 }],
    // Tier 4. Offers the THIRD Packstrider (completes the triple → Golden). Clean fillers.
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
    // Tier 4. Offers Blessing (a Tier-4 spell) in the MINION ROW — a spell offer buys/casts through the
    // normal drag. Clean fillers.
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
      title: 'The goal',
      body: 'You face 7 other opponents in a fight to the death. While 1st place is the goal, finishing top 4 will improve your rating.',
      focus: [{ kind: 'ui', id: 'lobby-rail' }],
    },
    {
      id: 'build-battle',
      title: 'Buy, Build, Battle',
      body: "Each round you shop to build out your warband to fight your opponent. Don't worry, units dying on the battlefied is not permanent. When you return to shop, your same warband will be there.",
    },
    {
      id: 'warband',
      title: 'Build your warband',
      body: 'While the concept is simple, there are countless decisions to make each game. Choose which minions stay or go, as only 7 can be in your warbad at at time.',
      focus: [{ kind: 'ui', id: 'warband' }],
    },
    {
      id: 'position',
      title: 'Position matters',
      body: 'Minions attack in order of left-to-right, but their targets are random. Where you place your units can dramatically change out a battle plays out.',
      why: 'Many units benefit from being able to attack before they die. The further left they are positioned, the more likely they are to attack before that happens!',
    },
  ],
  orderDemo: {
    body: "There are many effects that are based off of your minions' positioning. Keep this in mind as you are building out your warband!",
    debrief: '',
  },
  lobbyIntro: [
    {
      id: 'lobby-rail',
      phase: 'lobby',
      focusMode: 'orient',
      title: 'The Lobby',
      body: 'Here are the rivals you will face each round. Bring all of their health to zero to win the game! (Note: You cannot face the same hero twice back to back until a face off at the end of the game)',
      anchors: [{ kind: 'ui', id: 'lobby-rail' }],
      gate: 'observe',
      completion: { kind: 'always' },
    },
    {
      id: 'lobby-self',
      phase: 'lobby',
      focusMode: 'orient',
      title: 'Your spot',
      body: 'This is you. Properly manage your warband strength and your health to stay in the game!',
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
      title: 'Next up',
      body: 'Your opponent will be highlighed. Hover over their spot to see a bit of information that may give you an edge in the upcoming battle!',
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
