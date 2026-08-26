/**
 * DOC BOT — the play/cast/hero-power differential scan (tripwires 9 + golden), shared by
 * `playDifferential.test.ts` (gates) and the `npm run docbot` CLI (prints the queues).
 *
 * The question, per card: WHEN YOU PLAY IT, DOES ITS EFFECT DO ANYTHING? Wiring checks (tripwire 1) prove a
 * factory exists; this proves it ACTS — through the real `reduce`, under a rich fixture, against a VANILLA
 * CONTROL of identical body so the diff isolates the effect from the act of playing.
 *
 *   effectful minion C:  play C  → normalize → stateC
 *   vanilla control  V:  play V  → normalize → stateV     (same stats, same keywords, effect-free def)
 *   C's play-effect did something  ⇔  stateC ≠ stateV
 *
 * Normalization replaces the played body's identity (cardId, def-relative stats, def keywords) with
 * placeholders, so "a body arrived on the board" cancels out and only CONSEQUENCES remain. The golden
 * differential replays C golden-vs-plain the same way: golden must differ (double magnitudes / repeats).
 *
 * Spells and hero powers have no body to control against, so they diff against EXPECTED BOOKKEEPING instead:
 * the cast/power must change something beyond hand-consumption, cast counters, and cost.
 *
 * Like the rune scan: inert results are a RATCHETED QUEUE for owner triage, not auto-failures — a card can be
 * legitimately conditional in ways the fixture doesn't stage ("if you control 3 Dragons"). The queue may only
 * shrink, and a NEW card landing in it trips the pin at authoring time.
 */
import { CARD_INDEX } from '@game/content';
import type { CardDef } from '@game/core';
import { createRun } from '../state';
import { reduce } from '../reducer';
import type { RunState, BoardCard } from '../state';

/** Order-insensitive stringify (see runeSwallowScan.ts for why plain JSON.stringify is a trap here). */
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
};

/** Run noise + PER-EVENT bookkeeping. The bookkeeping half is load-bearing: the sabotage check neutered a
 *  Shout factory and the lane still saw a diff, because ANY Shout ticks `shoutsThisTurn`/`firstShoutUid`
 *  regardless of what its effect does — event bookkeeping was masking effect inertness. Same reason the
 *  fixture board is CLEAN tokens: an effectful fixture body watching the shout EVENT (Karwind-family) reacts
 *  identically for every Shout card, hiding a dead one behind the watcher's response. */
const NOISE = new Set([
  'rngCursor', 'uidCounter', 'presentation', 'fx', 'beats', 'log',
  'shoutsThisTurn', 'firstShoutUid', 'auraFxSeq', 'auraFx', 'lastShoutFires',
]);
const PLAYED = 'PLAYED_CARD';

/** Strip run noise and replace the played card's identity so C-vs-V compares consequences only. */
function normalize(s: RunState, playedUid: string, def: CardDef, golden: boolean): string {
  const mult = golden ? 2 : 1;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (NOISE.has(k) || v === undefined) continue;
    o[k] = v;
  }
  o.board = s.board.map((c) => (c.uid !== playedUid ? c : {
    ...c,
    cardId: PLAYED,
    attack: c.attack - mult * def.attack, // battlecry SELF-buffs survive as a nonzero delta
    health: c.health - mult * def.health,
    keywords: [...c.keywords].filter((kw) => !def.keywords.includes(kw)).sort(), // granted keywords survive
    tribe: 'X',
  }));
  o.playedThisTurn = (s.playedThisTurn ?? []).map((id) => (id === def.id ? PLAYED : id));
  o.hand = s.hand.map((c) => (c.uid === playedUid ? { ...c, cardId: PLAYED } : c)); // a play refused back to hand
  return stable(o);
}

/** Rich fixture: multi-tribe board with two free slots, offers in the shop, a spare spell + minion in hand,
 *  gold, mid-run wave — so tribe-/target-/shop-scoped effects have subjects. */
export function playFixture(): { state: RunState; targetUid: string } {
  // CLEAN-token fixture bodies only — an effectful fixture body is a watcher that reacts to trigger EVENTS
  // and masks a dead effect behind its own response (found by the sabotage check; see NOISE above). The cost:
  // tribe-mates for "buff your Dragons"-style effects are scarcer, which shows up as honest queue entries
  // instead of dishonest green. Tribes on the board: beast, mech, undead, neutral (the clean-token set).
  const pick = (tribe: string): string =>
    Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && (c.effects?.length ?? 0) > 0 && (c.tribe === tribe || c.tribe2 === tribe))!.id;
  const vanillaSpell = Object.values(CARD_INDEX).find((c) => c?.spell && !c.token)!.id;
  const body = (uid: string, id: string): BoardCard => {
    const d = CARD_INDEX[id]!;
    return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false } as BoardCard;
  };
  const state: RunState = {
    ...createRun(0x9137, 'aster'),
    wave: 7,
    tier: 4,
    embers: 30,
    board: ['pup', 'nanobot', 'cryptwolf', 'n2_trooper', 'b2_trexbaby'].map((id, i) => body(`fix${i}`, id)),
    hand: [body('spareMinion', 'pup'), { uid: 'spareSpell', cardId: vanillaSpell, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false } as BoardCard],
    shop: [{ uid: 'off0', cardId: pick('dragon') }, { uid: 'off1', cardId: pick('dwarf') }],
  } as RunState;
  return { state, targetUid: 'fix0' };
}

/**
 * The vanilla CONTROL body — DECLARED, then VALIDATED, after two instrument bugs in a row proved that
 * guessing is not selection:
 *
 *   1. `effects: []` does not mean inert. The first pick was DRAKKO THE DRUMMER, whose behaviour lives in the
 *      def-level `triggerMultiplier` field — every control run silently doubled Battlecries.
 *   2. Runtime calibration with ONE probe does not mean inert either: the second pick was SYLUS, the ECHO
 *      multiplier, which sails past a Shout-based calibration untouched.
 *
 * A full sweep then showed there is NO clean non-token minion at all: every effectless-looking one either
 * carries a behaviour field (`triggerMultiplier`, `chooseOne`, `splashAdjacent`, …) or is ID-hardcoded in the
 * engine (yazzus, beatboxer, attachmentconductor). The clean set is eight TOKENS; `omen` (1/1 neutral) also
 * avoids tribal-aura contamination on the fixture board. `playDifferential.test.ts` re-validates all three
 * cleanliness conditions on every run — key whitelist, empty effects/keywords, zero engine ID references —
 * so if `omen` ever gains behaviour, the test names the problem instead of the scan going quietly blind.
 */
export const VANILLA_CONTROL_ID = 'omen';

/** The def-key surface a control may have — anything else is a behaviour channel (see above). */
export const CONTROL_KEY_WHITELIST: ReadonlySet<string> = new Set(
  ['id', 'name', 'tribe', 'tier', 'attack', 'health', 'keywords', 'effects', 'text', 'goldenText', 'source', 'sets', 'tribe2', 'token'],
);

function playCard(base: RunState, def: CardDef, asId: string, golden: boolean, targetUid: string): RunState {
  const inHand: BoardCard = {
    uid: 'docbotPlay', cardId: asId, tribe: def.tribe,
    attack: (golden ? 2 : 1) * def.attack, health: (golden ? 2 : 1) * def.health,
    keywords: [...def.keywords], golden,
  } as BoardCard;
  const s = { ...base, hand: [...base.hand, inHand] };
  return reduce(s, { type: 'play', uid: 'docbotPlay', targetUid });
}

export interface PlayScanResult {
  /** Minions with a SELF-play effect (`onPlay`) whose play is indistinguishable from a vanilla body. */
  inertMinions: string[];
  /** Effectful minions whose GOLDEN play equals their plain play — the gild multiplied nothing. */
  goldenFlat: string[];
  /** Spells whose cast changed nothing beyond cast bookkeeping. */
  inertSpells: string[];
  /** Spells the fixture could not even cast (refused) — the scan must not silently skip them. */
  refusedSpells: string[];
  /** `onSummon` WATCHERS that stayed silent while a subject of EVERY tribe was played past them in the
   *  shop. Combat-only watchers land here by design (their lane is the combat differential); a shop-worded
   *  watcher here is a runtime CONFIRMATION of its phase-registry triage entry. */
  silentWatchers: string[];
}

export function playScan(): PlayScanResult {
  const inertMinions: string[] = [];
  const goldenFlat: string[] = [];
  const inertSpells: string[] = [];
  const refusedSpells: string[] = [];
  const silentWatchers: string[] = [];
  const vanilla = CARD_INDEX[VANILLA_CONTROL_ID]!;
  const { state: base, targetUid } = playFixture();

  // ── lane 1: SELF-play (`onPlay`) — play the card itself against a vanilla control ──
  for (const def of Object.values(CARD_INDEX)) {
    if (!def || def.spell || def.ruby) continue;
    if (!def.effects.some((e) => e.on === 'onPlay')) continue;
    const afterC = playCard(base, def, def.id, false, targetUid);
    const afterV = playCard(base, vanilla, vanilla.id, false, targetUid);
    const normC = normalize(afterC, 'docbotPlay', def, false);
    const normV = normalizeControl(afterV, 'docbotPlay', vanilla, def);
    if (normC === normV) inertMinions.push(def.id);
    else {
      const afterG = playCard(base, def, def.id, true, targetUid);
      if (normalize(afterG, 'docbotPlay', def, true) === normC) goldenFlat.push(def.id);
    }
  }

  // ── lane 2: WATCHERS (`onSummon`) — the card sits on the board; a subject of each tribe is played past
  //    it; a watcher that reacts to none of them in the shop is silent there ──
  const subjectOf = (tribe: string): CardDef =>
    Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && (c.tribe === tribe || c.tribe2 === tribe))!;
  for (const def of Object.values(CARD_INDEX)) {
    if (!def || def.spell || def.ruby) continue;
    if (!def.effects.some((e) => e.on === 'onSummon')) continue;
    let reacted = false;
    for (const tribe of ['beast', 'demon', 'dragon', 'dwarf', 'kobold', 'undead']) {
      const subject = subjectOf(tribe);
      const watcherBody: BoardCard = { uid: 'docbotWatch', cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false } as BoardCard;
      const controlBody: BoardCard = { ...watcherBody, cardId: vanilla.id };
      const withC = { ...base, board: [...base.board.slice(0, 4), watcherBody] };
      const withV = { ...base, board: [...base.board.slice(0, 4), controlBody] };
      const afterC = playCard(withC, subject, subject.id, false, targetUid);
      const afterV = playCard(withV, subject, subject.id, false, targetUid);
      if (normalizeWatcher(afterC, 'docbotWatch', def, subject) !== normalizeWatcher(afterV, 'docbotWatch', vanilla, subject)) { reacted = true; break; }
    }
    if (!reacted) silentWatchers.push(def.id);
  }

  // Spells: cast must change something beyond hand-consumption + cast counters + cost.
  for (const def of Object.values(CARD_INDEX)) {
    if (!def?.spell || def.ruby) continue;
    const cost = def.cost ?? 0;
    const s0 = { ...base, embers: 60 };
    const inHand: BoardCard = { uid: 'docbotPlay', cardId: def.id, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false } as BoardCard;
    const s1 = reduce({ ...s0, hand: [...s0.hand, inHand] }, { type: 'play', uid: 'docbotPlay', targetUid });
    if (s1.hand.some((c) => c.uid === 'docbotPlay')) { refusedSpells.push(def.id); continue; } // refused — SURFACED, never silently skipped (the instrument must not lie)
    const strip = (st: RunState): string => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(st)) {
        if (NOISE.has(k) || v === undefined) continue;
        if (['spellsCast', 'spellsThisTurn', 'lastSpellCastId', 'firstSpellThisTurnId', 'lastSpellThisTurnId', 'embers', 'goldSpent', 'goldSpentThisTurn', 'playedThisTurn', 'hand', 'spellsCastIds', 'alesCastThisTurn'].includes(k)) continue;
        o[k] = v;
      }
      return stable(o);
    };
    if (strip(s1) === strip(s0)) inertSpells.push(def.id);
    void cost;
  }

  return { inertMinions, goldenFlat, inertSpells, refusedSpells, silentWatchers };
}

/** Watcher-lane normalization: placeholder the WATCHER body (identity + def-relative stats, so a watcher
 *  that buffed ITSELF shows a nonzero delta) and the played subject's per-play bookkeeping. */
function normalizeWatcher(s: RunState, watcherUid: string, watcherDef: CardDef, subject: CardDef): string {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (NOISE.has(k) || v === undefined) continue;
    o[k] = v;
  }
  o.board = s.board.map((c) => (c.uid !== watcherUid ? c : {
    ...c,
    cardId: 'WATCHER',
    attack: c.attack - watcherDef.attack,
    health: c.health - watcherDef.health,
    keywords: [...c.keywords].filter((kw) => !watcherDef.keywords.includes(kw)).sort(),
    tribe: 'X',
  }));
  void subject;
  return stable(o);
}

/** Normalize the CONTROL run: the vanilla body was played, but deltas are taken against the vanilla def and
 *  its identity markers replaced with the same placeholders — so C and V collapse to the same string exactly
 *  when C's effect contributed nothing. */
function normalizeControl(s: RunState, playedUid: string, vanilla: CardDef, _subject: CardDef): string {
  return normalize(s, playedUid, vanilla, false);
}
