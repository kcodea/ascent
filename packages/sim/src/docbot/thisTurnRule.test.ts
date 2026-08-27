/**
 * R-TURN-01 — the "THIS TURN" sweep (owner ruling 2026-08-27, q-carry-demand-encore):
 *
 *   "'This turn' terminology runs from shop through that turn's combat, and ends at the start of the next
 *    shop turn. … use this language and logic moving forward and to retroactively fix issues."
 *
 * The lane DERIVES its subject list from the printed text itself — every content def (cards + golden texts,
 * runes, quests, gifts, hero powers) whose player-visible text says "this turn" — and requires each subject
 * to carry a classification in `THIS_TURN_CLASSIFIED` (thisTurnRegistry.ts). So:
 *   · a NEW "this turn" effect cannot ship without classifying itself against the rule;
 *   · a STALE entry (text rewritten, card deleted) fails loudly instead of rotting;
 *   · a `confirmed-violation` is VISIBLE and ratcheted — the list must never grow, and emptying it is the goal.
 *
 * The behavioural halves (the carries actually reaching combat) are pinned in shoutCarryOver.test.ts and the
 * carry-over scan (carryOver.test.ts); this lane pins the CLASSIFICATION so the sweep can never go vacuous.
 */
import { describe, expect, it } from 'vitest';
import { ARCHIVED_RUNES, CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES } from '@game/content';
import { HEROES } from './../heroes';
import { THIS_TURN_CLASSIFIED } from './thisTurnRegistry';

const SAYS_THIS_TURN = /this turn/i;

/** Every content id whose PRINTED text says "this turn" — the derived subject list. */
function deriveSubjects(): string[] {
  const ids = new Set<string>();
  for (const c of Object.values(CARD_INDEX)) {
    if (SAYS_THIS_TURN.test(c.text ?? '') || SAYS_THIS_TURN.test(c.goldenText ?? '')) ids.add(c.id);
  }
  for (const r of [...RUNES, ...EPIC_RUNES, ...ARCHIVED_RUNES]) {
    if (SAYS_THIS_TURN.test(r.text ?? '')) ids.add(r.id);
  }
  for (const q of QUEST_DEFS) {
    // Quests carry their prose across several shapes; scan the whole serialized def (data only, no comments).
    if (SAYS_THIS_TURN.test(JSON.stringify(q))) ids.add(q.id);
  }
  for (const h of HEROES) {
    if (SAYS_THIS_TURN.test(h.power?.text ?? '')) ids.add(`hero:${h.id}`);
  }
  return [...ids].sort();
}

describe('R-TURN-01 — every printed "this turn" effect is classified against the rule', () => {
  const subjects = deriveSubjects();

  it('the sweep finds subjects at all (anti-vacuous: gift_encore prints "this turn")', () => {
    expect(subjects).toContain('gift_encore');
    expect(subjects.length).toBeGreaterThanOrEqual(10);
  });

  it('every "this turn" subject carries a classification (a new effect must classify itself)', () => {
    const missing = subjects.filter((id) => !THIS_TURN_CLASSIFIED[id]);
    expect(missing, `unclassified "this turn" effects — add each to THIS_TURN_CLASSIFIED (thisTurnRegistry.ts) with a kind + a verifiable why, per R-TURN-01: ${missing.join(', ')}`).toEqual([]);
  });

  it('no classification is stale (its subject still prints "this turn")', () => {
    const subjectSet = new Set(subjects);
    const stale = Object.keys(THIS_TURN_CLASSIFIED).filter((id) => !subjectSet.has(id));
    expect(stale, `entries whose subject no longer prints "this turn" — delete them (or the id changed): ${stale.join(', ')}`).toEqual([]);
  });

  it('confirmed violations are ratcheted: currently NONE (the list must never grow silently)', () => {
    const open = Object.entries(THIS_TURN_CLASSIFIED)
      .filter(([, c]) => c.kind === 'confirmed-violation')
      .map(([id]) => id)
      .sort();
    // Sweep of 2026-08-27: Demand an Encore was the only violation found, and it is FIXED
    // (kind 'violation-fixed'). A new confirmed-violation needs an owner-visible line in its PR body.
    expect(open).toEqual([]);
  });

  it('every classification cites a why a future reader can verify', () => {
    for (const [id, c] of Object.entries(THIS_TURN_CLASSIFIED)) {
      expect(c.why.length, `${id}: why too thin to verify`).toBeGreaterThan(20);
    }
  });
});
