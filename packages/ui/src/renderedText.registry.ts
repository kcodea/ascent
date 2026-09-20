/**
 * RENDERED-TEXT RECONCILIATION — the excuse registry (same discipline as `packages/sim/src/docbot/
 * phaseRegistry.ts`): the harness in `renderedText.test.tsx` derives every card the live-text system
 * considers scaling FROM `cardText.ts`'s own dispatch, arms each one with a rich exemplar state, and
 * mounts the real `Card` to prove the DOM shows the helper's computed string. A subject the exemplar
 * bags cannot arm is not silently skipped — it must carry an entry HERE, with a reason a future reader
 * can verify. The needs-triage backlog is ratcheted in the test: it can only shrink.
 */
export interface RenderExcuse {
  /**
   * Why this subject is not swept by the rendered reconciliation:
   *  'per-instance-token' — the live text needs a per-instance field the generic bags must not set
   *                         globally (it would rewrite EVERY card's text, e.g. `taughtSpellId`,
   *                         `chosenOption`). Covered by a dedicated exemplar or excused with a cite.
   *  'accurate-at-any-value' — the card's printed text is already exact under every bag (the helper is
   *                         an annotation that the bags legitimately never fire).
   *  'needs-triage'       — the sweep found it, nobody has ruled yet. Tolerated, ratcheted, reported.
   */
  kind: 'per-instance-token' | 'accurate-at-any-value' | 'needs-triage';
  /** One line a future reader can verify. */
  why: string;
}

/** Card ids the arming sweep may skip, each with a verifiable reason. Keep this SHORT — an entry here is
 *  a card whose rendered text the harness does NOT reconcile. */
export const RENDER_EXCUSED: Readonly<Record<string, RenderExcuse>> = {
  // King Oona doubles a summon's stats — the rule carries no printed magnitude that could go stale, and the
  // live surface is the Avenge meter on the card plate, not the rules text. Same exemption, same reason, as
  // liveTextAudit.test.ts's EXEMPT entry for b2_oona.
  b2_oona: { kind: 'accurate-at-any-value', why: 'text prints no magnitude (stat doubling); the Avenge meter is the live surface (liveTextAudit exemption)' },
  // Bloodbinder's Bleed: the printed rule ("every 4 attacks, deal this minion's Attack") stays true at every
  // tally — the live surfaces are the bleed step counter (stepProgress reads bleedAttacks) and the Attack
  // badge the clause references by name (the sanctioned corner-badge form of the live-text rule).
  bloodbinder: { kind: 'accurate-at-any-value', why: 'magnitude = "this minion’s Attack" (corner badge); progress = the bleedAttacks step counter, not the text' },
  // Living Grimoire: charged/spent state and the 3-Shout recharge live in the step counter (shoutTick /
  // grimoireCharged, surfaced via stepProgress — including the deliberate 0/3 visible-at-zero exception);
  // the rules text itself has no scaling number.
  d2_grimoire: { kind: 'accurate-at-any-value', why: 'no scaling number in the text; recharge progress is the shoutTick step counter (stepProgress)' },
  // Han Gover (2026-09-18): "When this deals 40 damage, get an Ale" — the printed threshold never scales; the
  // running damage tally is the N/40 step counter (stepProgress reads `damageDealt`, the Avenge-style tracker
  // per the owner's 2026-09-11 "trackers, not fractions in the text" ruling), on the board AND in combat.
  dw3_hangover: { kind: 'accurate-at-any-value', why: 'no scaling number in the text; the damage meter is the damageDealt step counter (stepProgress)' },
  // Goldvein (2026-09-19): the same damage meter with a Gold-next-turn body — "When this deals 6 damage, gain 3 Gold
  // next turn"; the printed threshold never scales, the tally is the N/6 step counter.
  k3_goldvein: { kind: 'accurate-at-any-value', why: 'no scaling number in the text; the damage meter is the damageDealt step counter (stepProgress)' },
};
