/**
 * TUTORIAL — the type contract (FTUE Phase 1).
 *
 * This is the shared vocabulary the whole tutorial system is authored against. It lives in `@game/sim`
 * because a course is DETERMINISTIC DATA that plugs into the real reducer/lobby/shop — the same reason the
 * lobby and quests live here — and because its completion predicates read `RunState`. The UI coaching layer
 * (`packages/ui/src/tutorial/*`) imports these types and renders them; NOTHING here imports the UI, so the
 * simulation ↔ presentation seam stays intact.
 *
 * Design rules that keep this honest (blueprint §4, adapted to our engine):
 *  - A course controls INPUTS only — hero, shop offers, opponent boards, seeds, gates. It never fakes an
 *    outcome: combat still runs in `simulate`, damage still flows through the lobby, the reducer is unchanged.
 *  - Every field here is PURE DATA (strings, numbers, discriminated unions). No functions, so a course is
 *    serializable, snapshot-testable, and cannot smuggle a closure into `RunState`.
 *  - Anchor ids and copy are plain strings — the UI resolves an anchor id to a real on-screen element; the
 *    engine never knows a DOM node exists.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Anchors — where a coach panel / spotlight points. Ids are stable strings the UI's anchor registry resolves
// to a live element (DOM `getBoundingClientRect`, cached per the perf rule). See `ui/tutorial/anchorRegistry`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The singleton chrome controls a course can spotlight. Each maps to one stable selector in the registry. */
export type TutorialUiAnchor =
  | 'gold' // the Gold pill (.goldpill)
  | 'shop' // the shop card row ([data-zone="tavern"] .row)
  | 'tavern-up' // the Tavern-up stone (.tvbwrap) — also carries the tier
  | 'refresh' // the refresh crystal (.rfbwrap)
  | 'freeze' // the freeze control (.frzwrap)
  | 'end-turn' // the End Turn diamond (.etbwrap)
  | 'hero-power' // the hero-power button (.statusbar .heropowerbtn)
  | 'warband' // the board row ([data-zone="warband"] .row.warband)
  | 'hand' // the hand row ([data-zone="hand"] .row.hand)
  | 'health' // the hero Health box (.statusbar .hpbox) — "Resolve" is now "Health" (display-only rename)
  | 'lobby-rail' // the 8-seat table (.lobbyrail)
  | 'lobby-self' // the player's own seat row (.lobbyseat.you)
  | 'lobby-next' // the next opponent's seat row (.lobbyseat.foe)
  | 'hud'; // the round plaque (.bar) — present for course/rift, hidden in a lobby

/** A course points a spotlight at one of these. Cards are addressed by uid + zone (the registry knows the
 *  zone selectors); the rest are singleton chrome or structural slots. */
export type TutorialAnchorRef =
  | { kind: 'ui'; id: TutorialUiAnchor }
  | { kind: 'card'; zone: 'shop' | 'hand' | 'board'; uid: string }
  | { kind: 'cardBody'; zone: 'shop' | 'hand' | 'board'; uid: string } // the rules/keyword text area of a card
  | { kind: 'boardSlot'; index: number } // an empty warband slot, 0-based left→right
  | { kind: 'lobbySeat'; seatId: string };

/** A course authors cards by a stable ALIAS (`tutorial.packstrider`) rather than a runtime uid, since uids are
 *  minted at run time. The controller resolves aliases → live uids when a step activates. This keeps the
 *  course data uid-free and therefore serializable and diffable. */
export type TutorialCardAlias = string;

/** An anchor as authored — a card ref may name an alias instead of a uid; the controller substitutes it. */
export type TutorialAnchorSpec =
  | { kind: 'ui'; id: TutorialUiAnchor }
  | { kind: 'card'; zone: 'shop' | 'hand' | 'board'; alias: TutorialCardAlias }
  | { kind: 'cardBody'; zone: 'shop' | 'hand' | 'board'; alias: TutorialCardAlias }
  | { kind: 'boardSlot'; index: number }
  | { kind: 'lobbySeat'; seatId: string };

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Predicates — when a step is satisfied. Evaluated over a TutorialContext by `tutorial/evalPredicate.ts`.
// A small serializable DSL rather than a closure, so a course stays pure data and each branch is unit-testable.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Semantic things the controller records as the player acts, so a predicate can await them. Shop/board
 *  actions are derived from reducer transitions; the `presented:*` events are read-only observations of the
 *  combat presentation layer (a Rally landed, a summon appeared) — see `ui/tutorial/presentationAdapter`. */
export type TutorialSemanticEvent =
  | { type: 'bought'; cardId: string; uid: string }
  | { type: 'sold'; cardId: string }
  | { type: 'played'; cardId: string; uid: string } // hand → board
  | { type: 'reordered' }
  | { type: 'refreshed' }
  | { type: 'froze' }
  | { type: 'castSpell'; cardId: string }
  | { type: 'heroPowerUsed'; targetUid?: string }
  | { type: 'toweredUp'; toTier: number } // tavern upgrade
  | { type: 'gilded'; cardId: string }
  | { type: 'inspected'; uid: string }
  | { type: 'endedTurn' }
  | { type: 'combatStarted' }
  | { type: 'combatEnded'; result: 'win' | 'lose' | 'draw' }
  | { type: 'returnedToShop' } // the player clicked "End combat, back to shop" (resolveCombat)
  // presented:* — the combat presentation adapter observed a semantic effect being SHOWN (never gameplay).
  | { type: 'presented'; kind: TutorialPresentedKind; srcUid?: string; srcCard?: string };

/** Combat presentation moments the tutorial can key a Predict/Confirm beat to. Mapped from real CombatEvents
 *  by the presentation adapter — NOT new gameplay. (`rally`→a rally event; `echoSummon`→a summon from a death;
 *  `shout`→an `sc` battlecry narration; `startOfCombat`→an `sc` with `cast`.) */
export type TutorialPresentedKind =
  | 'attack'
  | 'death'
  | 'summon'
  | 'echoSummon'
  | 'buff'
  | 'rally'
  | 'shout'
  | 'startOfCombat'
  | 'elimination'
  | 'combatDone';

/** What a predicate reads. `run` is the live RunState; `events` is the ordered log of semantic events observed
 *  SINCE THE STEP ACTIVATED (reset per step) unless a variant says otherwise; `sawEver` is the run-lifetime
 *  set for "has this ever happened" checks. */
export interface TutorialContext {
  run: TutorialRunView;
  events: TutorialSemanticEvent[];
  sawEver: ReadonlySet<TutorialSemanticEvent['type']>;
  /** Combat-lifecycle events (started / ended / returned-to-shop / presented) seen since the CURRENT combat
   *  began — NOT reset per step, so several consecutive combat beats can each key on the same fight's outcome
   *  (a Rally-watch step and the win-confirm step both read one `combatEnded`). Reset when a new combat starts. */
  combatEvents: readonly TutorialSemanticEvent[];
}

/** The read-only slice of RunState a predicate is allowed to see. Kept narrow so a course can't reach into
 *  engine internals, and so this type doesn't drag the whole RunState into the contract. The controller
 *  projects the real RunState into this shape each tick. */
export interface TutorialRunView {
  wave: number;
  embers: number; // Gold
  resolve: number; // Health
  maxResolve: number;
  tier: number;
  frozen: boolean;
  phase: string;
  heroReady: boolean;
  shop: ReadonlyArray<{ uid: string; cardId: string }>;
  hand: ReadonlyArray<{ uid: string; cardId: string }>;
  board: ReadonlyArray<{ uid: string; cardId: string; golden: boolean }>;
  /** Alive-seat count in the lobby, when this run carries one. */
  livingSeats?: number;
}

export type TutorialPredicate =
  | { kind: 'always' } // an observe-only step the player advances manually / a timed reveal
  | { kind: 'bought'; cardId: string }
  | { kind: 'sold'; cardId: string }
  | { kind: 'played'; cardId: string }
  | { kind: 'cardOnBoard'; cardId: string } // a copy of cardId is on the board (any uid)
  | { kind: 'boardCount'; atLeast: number }
  | { kind: 'inspectedAny' }
  | { kind: 'refreshed' }
  | { kind: 'froze' }
  | { kind: 'reordered' } // the player repositioned a minion (teaches placement)
  | { kind: 'castSpell'; cardId?: string }
  | { kind: 'heroPowerUsed' }
  | { kind: 'tierAtLeast'; tier: number }
  | { kind: 'gilded' }
  | { kind: 'endedTurn' }
  | { kind: 'combatStarted' }
  | { kind: 'combatEnded'; result?: 'win' | 'lose' | 'draw' }
  | { kind: 'returnedToShop' } // back in the shop after a fight (drives the "click here to return" step)
  | { kind: 'presented'; presented: TutorialPresentedKind }
  | { kind: 'goldSpentToZero' } // embers reached 0 (the guided economy's usual end-of-turn state)
  | { kind: 'not'; of: TutorialPredicate }
  | { kind: 'all'; of: TutorialPredicate[] }
  | { kind: 'any'; of: TutorialPredicate[] };

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Gates, focus modes, connectors — how a step constrains input and how the coach panel presents.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How strongly a step constrains input (blueprint §9.1):
 *  - observe: nothing disabled, just wait for the predicate (inspection, watching combat).
 *  - soft:   other actions work but don't advance; show a nudge (repositioning, harmless exploration).
 *  - hard:   reject the lesson-breaking action with a reason (selling a required card, spending reserved gold).
 *  The reducer is NEVER edited for this — gating lives in the UI action layer, which drops/soft-rejects a
 *  disallowed dispatch before it reaches the store. */
export type TutorialGate = 'observe' | 'soft' | 'hard';

/** The coach panel's mode (blueprint §8.1.1). `orient` identifies; `action` asks for a live control;
 *  `predict` names an upcoming source+result before it resolves; `confirm` points at the result after the
 *  presentation settles. Only `predict`/`confirm` interact with combat, and only at safe boundaries. */
export type TutorialFocusMode = 'orient' | 'action' | 'predict' | 'confirm';

/** The screen phase a step belongs to. Drives which surface the overlay expects to spotlight. */
export type TutorialPhase = 'lobby' | 'shop' | 'runeforge' | 'combat' | 'debrief' | 'postgame' | 'foundation';

/** A directional line drawn between two anchors (drag source→dest, a causal trail, an adjacency seam). */
export interface TutorialConnector {
  from: TutorialAnchorSpec;
  to: TutorialAnchorSpec;
  style: 'drag' | 'causal' | 'adjacent' | 'order';
  label?: string;
}

/** A safe boundary in combat where a Predict/Confirm hold may pause — the ONLY places the tutorial may hold,
 *  and it holds by waiting for a presentation signal, never by injecting a timeout (blueprint §8.1.4). */
export type TutorialSafeHold =
  | { at: 'beforeAttack'; alias?: TutorialCardAlias }
  | { at: 'beforeDeath'; alias?: TutorialCardAlias }
  | { at: 'beforeStartOfCombat' }
  | { at: 'afterPresented'; presented: TutorialPresentedKind };

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Steps, turns, foundation panels, courses.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One coached beat. Three copy layers stay separate (blueprint §8.3): `title`+`body` is the instruction,
 *  `why` the optional rationale, and a linked lesson (`lessonId`) supplies the stable rule text. */
export interface TutorialStep {
  id: string;
  phase: TutorialPhase;
  focusMode?: TutorialFocusMode;
  title?: string;
  /** The instruction beside the live target. ≤28 words (§8.3). */
  body: string;
  /** Optional rationale, shown as "Why" copy. ≤35 words. */
  why?: string;
  /** What to spotlight. Empty = a centered panel with no cutout (foundation-style). */
  anchors: TutorialAnchorSpec[];
  /** A line to draw (drag hint, causal trail). */
  connector?: TutorialConnector;
  /** A first-use lesson to present + mark on completion. */
  lessonId?: string;
  /** Where a Predict/Confirm step may hold in combat. */
  safeHold?: TutorialSafeHold;
  /** After completion, briefly refocus these (the result). */
  resultAnchors?: TutorialAnchorSpec[];
  /** How input is constrained. */
  gate: TutorialGate;
  /** Which action kinds advance/are-allowed under a soft/hard gate (by reducer Action `type`). Omitted =
   *  the predicate alone decides and no action is blocked. */
  allowedActionKinds?: string[];
  /** When the step is done. */
  completion: TutorialPredicate;
  /** Analytics tag (funnel event). */
  analyticsTag?: string;
}

/** A single opponent minion for an authored omen board — only Attack/Health vary; identity is always `omen`. */
export interface TutorialOmenMinion {
  attack: number;
  health: number;
}

/** One scripted shop offering for a turn (and its refreshes). `minions`/`spell` are card ids; the provider
 *  materializes real offer instances at normal cost, drawing nothing from the shared pool. */
export interface TutorialShopRoll {
  minions: string[];
  spell?: string;
}

/** One authored round. The opponent board and shop are supplied to the providers; the steps drive coaching. */
export interface TutorialTurn {
  turn: number;
  /** The lobby seat the player faces this round (for rail spotlighting). */
  opponentSeatId?: string;
  /** Fixed combat seed so the round is reproducible. */
  combatSeed?: string;
  /** The opponent's authored omen board this round. */
  omenBoard: TutorialOmenMinion[];
  /** Shop offers: index 0 is the initial roll, 1+ are successive refreshes. */
  shopRolls: TutorialShopRoll[];
  /** Force the PLAYER to strike first this round (so, e.g., a Rally minion visibly buffs before it swings).
   *  Omitted = the normal rule (more minions goes first; a tie is a seeded coin flip). */
  playerAttacksFirst?: boolean;
  /** Force the enemy's FIRST swing onto the player minion holding this card id (if alive), wherever it's
   *  placed — so a scripted death lesson (T-Rex dies → its Echo fires) always lands. Tutorial only. */
  forceEnemyFirstTargetCard?: string;
  steps: TutorialStep[];
}

/** An opening rules panel (blueprint §5.4). One idea, ≤2 short sentences, an optional anchor to focus. */
export interface TutorialFoundationPanel {
  id: string;
  title: string;
  body: string;
  why?: string;
  focus?: TutorialAnchorSpec[];
}

export type TutorialCourseKind = 'core' | 'tribe';

/** A whole course. `heroId` is forced (Aster for Learn Ascent); `contentRevision` pins the card slice a drift
 *  test guards; `guidedTurns`/`autonomyTurns` split coached rounds from supervised-independent ones. */
export interface TutorialCourse {
  id: string;
  kind: TutorialCourseKind;
  version: number;
  contentRevision: string;
  setId: string;
  tribeId?: string;
  title: string;
  summary: string;
  heroId: string;
  /** Total rounds in the authored lobby. */
  rounds: number;
  /** The 7 opponent seat names shown on the lobby rail (Rook, Vale, …). Fewer than 7 pads with defaults. */
  opponentNames: string[];
  /** The opening rules foundation (shown once, skippable, before Turn 1). */
  foundation: TutorialFoundationPanel[];
  /** An optional interactive board-order demonstration between the panels and Turn 1. */
  orderDemo?: {
    body: string;
    debrief: string;
  };
  /** The lobby intro steps (spotlight self, next opponent, phase loop) before Turn 1's shop. */
  lobbyIntro: TutorialStep[];
  turns: TutorialTurn[];
}
