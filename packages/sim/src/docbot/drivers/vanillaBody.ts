/**
 * FAMILY DRIVER — VANILLA BODY: a contract that states NO triggers and NO effects (61 today — plain tokens,
 * statline minions, effect-less spells and gifts). Its claim is a negative one: "I do nothing beyond my
 * body." That is checkable, and worth checking — the playDifferential control saga proved that `effects: []`
 * does not mean inert (Drakko's def-level `triggerMultiplier`, Sylus, and the ID-hardcoded trio yazzus /
 * beatboxer / attachmentconductor all looked vanilla and were not).
 *
 * Measurement: the body is played through the real reducer under the playDifferential fixture and its
 * consequences are normalized exactly as playScan does (identity placeholders, def-relative stats), then
 * compared with the vanilla CONTROL (`omen`) played the same way. Equal ⇒ the "no effects" claim holds:
 * observed `effects` = null (the contract's own value for an unstated field). Different ⇒ observed
 * `effects` = ['<unstated behaviour>'] — a visible mismatch that says the engine gives this body behaviour
 * its contract does not state. Spells diff against the cast-bookkeeping strip (a cast's cost + counters are
 * not behaviour). Gilded (minions/tokens): the golden body against a golden control — plain ×2 base stats
 * and nothing more.
 */
import { CARD_INDEX } from '@game/content';
import type { CardDef } from '@game/core';
import type { ContentContract } from '@game/rules/contracts/schema';
import type { CasePlan } from '../isolatedCases';
import { reduce } from '../../reducer';
import type { BoardCard, RunState } from '../../state';
import { VANILLA_CONTROL_ID } from '../playScan';
import { isVanillaContract } from './families';
import { instOf, shopBase, type DriverCtx } from './shared';

export const DRIVER = 'vanilla-body';

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
};

/** playScan's normalization, verbatim in spirit: run noise + per-event bookkeeping stripped, the played
 *  body's identity replaced and its stats made def-relative. */
const NOISE = new Set([
  'rngCursor', 'uidCounter', 'uidSeq', 'presentation', 'fx', 'beats', 'log', 'shoutsThisTurn', 'firstShoutUid', 'auraFxSeq', 'auraFx', 'lastShoutFires',
  'spellsCast', 'spellsThisTurn', 'lastSpellCastId', 'firstSpellThisTurnId', 'lastSpellThisTurnId', 'goldSpent', 'goldSpentThisTurn',
  'spellsCastIds', 'alesCastThisTurn', 'playedThisTurn', 'spellsOnThisTurn', 'spellCostOffTurn', 'lastEotFires', 'cardsPlayedTotal',
  // per-play telemetry that ticks for ANY body of a class (an Attachment, a Celestial) — trigger bookkeeping, not consequence
  'attachmentsThisTurn', 'karwindFlash', 'alignSpark', 'minionsPlayedThisTurn', 'minionsPlayed',
]);
function normalize(s: RunState, uid: string, def: CardDef, golden: boolean, spellSubject = false): string {
  const mult = golden ? 2 : 1;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!NOISE.has(k) && v !== undefined) o[k] = v;
  const mask = (c: BoardCard): BoardCard => (c.uid !== uid ? c : {
    ...c, cardId: 'PLAYED', tribe: 'X', attack: c.attack - mult * def.attack, health: c.health - mult * def.health,
    keywords: [...c.keywords].filter((kw) => !def.keywords.includes(kw)).sort(),
  } as unknown as BoardCard);
  // A spell leaves no body: the CONTROL's masked body is dropped from the board so a spell that did nothing
  // equals a minion that did nothing. (A vanilla MINION keeps its masked body, so a self-buff still shows.)
  o.board = s.board.filter((c) => !(spellSubject && c.uid === uid)).map(mask);
  o.hand = s.hand.map(mask);
  // A spell's cast costs Gold; a minion's play does not — the control is a minion, so the cost is bookkeeping.
  if (def.spell) o.embers = (s.embers ?? 0) + (def.cost ?? 0);
  return stable(o);
}

export function driveVanillaBody(c: ContentContract, plan: CasePlan, ctx: DriverCtx): void {
  const templates = new Set(plan.cases.filter((x) => x.driver === DRIVER).map((x) => x.template));
  const def = CARD_INDEX[c.contentId];
  const control = CARD_INDEX[VANILLA_CONTROL_ID];
  if (!def || !control || !isVanillaContract(c)) return;
  // Same-id copies out of the fixture: the playDifferential board carries a Pup + a spare Pup, so playing the
  // Pup TOKEN formed a triple — a real rule, not this body's behaviour.
  const raw = shopBase();
  const base = { ...raw, board: raw.board.filter((x) => x.cardId !== def.id), hand: raw.hand.filter((x) => x.cardId !== def.id) };

  const play = (d: CardDef, golden: boolean): RunState | null => {
    const inHand = d.spell
      ? ({ uid: 'docbotSrc', cardId: d.id, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false } as BoardCard)
      : instOf('docbotSrc', d, golden);
    const s = { ...base, hand: [...base.hand, inHand] };
    const after = reduce(s, { type: 'play', uid: 'docbotSrc', targetUid: 'fix0' });
    return after.hand.some((h) => h.uid === 'docbotSrc') ? null : after;
  };

  const measure = (golden: boolean): { same: boolean; refused: boolean } => {
    const subj = play(def, golden);
    if (!subj) return { same: false, refused: true };
    // The vanilla control is played the same way for every subject — a spell too (its bookkeeping is in
    // NOISE, its cost is added back, and the control's masked body is dropped for a spell subject).
    const ctrl = play(control, golden)!;
    const left = normalize(subj, 'docbotSrc', def, golden, !!def.spell);
    const right = normalize(ctrl, 'docbotSrc', control, golden, !!def.spell);
    return { same: left === right, refused: false };
  };

  const plain = measure(false);
  if (plain.refused) {
    ctx.executed.push({ contractId: c.contentId, template: 'plain', driver: DRIVER, evidence: 'reducer refused the play', unobserved: 'the play was refused by the reducer (a play condition the fixture cannot satisfy) — the no-behaviour claim stays unverified' });
    return;
  }
  const evidence = plain.same
    ? `reducer: playing ${c.contentId} under the playDifferential fixture equals playing the vanilla control (${VANILLA_CONTROL_ID}) with the same body — no consequence beyond the body`
    : `reducer: playing ${c.contentId} DIFFERS from playing the vanilla control (${VANILLA_CONTROL_ID}) with the same body — the engine gives this body behaviour its contract does not state`;
  if (templates.has('plain')) {
    ctx.obs(c.contentId, 'effects', plain.same ? null : ['<unstated behaviour: play differs from a vanilla control>'], evidence);
    ctx.executed.push({ contractId: c.contentId, template: 'plain', driver: DRIVER, evidence });
  }
  if (templates.has('gilded')) {
    const g = measure(true);
    const gEvidence = g.refused ? 'reducer refused the gilded play' : g.same
      ? `reducer: the gilded ${c.contentId} equals a gilded vanilla control — the gild is the base-stat ×2 and nothing more`
      : `reducer: the gilded ${c.contentId} DIFFERS from a gilded vanilla control`;
    if (!g.refused) ctx.obs(c.contentId, 'effects', g.same ? null : ['<unstated behaviour: gilded play differs from a vanilla control>'], gEvidence);
    ctx.executed.push({ contractId: c.contentId, template: 'gilded', driver: DRIVER, evidence: gEvidence, ...(g.refused ? { unobserved: 'the gilded play was refused' } : {}) });
  }
}
