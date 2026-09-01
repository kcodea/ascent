import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import type { CardDef } from '@game/core';

/**
 * DOC BOT LANE `recastMultiplier` — a card that RE-CASTS a spell casts it in full, multipliers included.
 *
 * ── The ruling (owner 2026-09-01) ──────────────────────────────────────────────────────────────────────────
 *
 *   *"mirrorwing's interaction should be a full re-cast of the spell, not an additional trigger OF the spell.
 *   therefore it is a full multiplier. this is the same for reflector. if a spell casts 4x, then casting it on
 *   mirrorwing would cast it 8x because it fully casts it twice."*
 *
 * The `spellCastOnThis` family had each been written as a bare `castSpell` loop — one flat extra resolution,
 * however large the multiplier at the play site was. That made every one of these cards get relatively WEAKER
 * the more multicast the player assembled, which is the opposite of what "casts again" says.
 *
 * ── Why a lane and not three fixed tests ───────────────────────────────────────────────────────────────────
 *
 * The bug is a shape, not a card: reach for `castSpell` inside a watcher and it is easy to forget that the
 * multiplier lives at the PLAY site, not inside `castSpell`. There are four sites today (three printed cards
 * and one rune) and the family is still growing — a set-3 spread minion would arrive with the same mistake
 * and no test would object. So this reads the source and asks the shape question of every member.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RECRUIT = readFileSync(join(HERE, '../recruit.ts'), 'utf8');

/** A factory/function body, comments stripped — a comment naming `spellCasts` must not vouch for a body that
 *  does not call it (the `rallyGuard` trap, 2026-08-31). */
function bodyAt(marker: string): string {
  const start = RECRUIT.indexOf(marker);
  expect(start, `${marker} is gone from recruit.ts — this lane needs re-anchoring`).toBeGreaterThan(-1);
  const open = RECRUIT.indexOf('{', start);
  let depth = 0;
  let i = open;
  for (; i < RECRUIT.length; i++) {
    if (RECRUIT[i] === '{') depth++;
    else if (RECRUIT[i] === '}' && --depth === 0) break;
  }
  return RECRUIT.slice(open, i).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Every recruit factory a card names on `spellCastOnThis` — derived from the CONTENT, so a new spread card
 *  drags its factory into this lane automatically rather than needing to be listed here. */
const SPELL_REACTORS = [
  ...new Set(
    (Object.values(CARD_INDEX) as CardDef[])
      .flatMap((d) => (d as unknown as { effects?: { on: string; do: string }[] }).effects ?? [])
      .filter((e) => e.on === 'spellCastOnThis')
      .map((e) => e.do),
  ),
];

describe('Doc Bot — every spell re-cast is a FULL cast', () => {
  it('the family is discovered from content, and is not empty', () => {
    expect(SPELL_REACTORS).toEqual(expect.arrayContaining(['onSpellCastOnThisRecast', 'onSpellCastOnThisSpreadRandom']));
  });

  it.each(SPELL_REACTORS.map((f) => [f] as const))('%s scales its casts by spellCasts', (factoryId) => {
    const body = bodyAt(`${factoryId}: (ctx, self, params, payload)`);
    // Only factories that actually re-cast are graded. One that reacts to a spell WITHOUT casting (a counter,
    // a stat grant) has no multiplier to honour, and demanding one would be noise.
    if (!/\bcastSpell\(/.test(body)) return;
    expect(
      /spellCasts\(/.test(body),
      `${factoryId} calls castSpell without spellCasts — it adds one flat resolution instead of re-casting the spell`,
    ).toBe(true);
  });

  it('Rune of Shared Reflection — the same spread wearing a rune — scales too', () => {
    // It lives in `fireOnSpellCastOnThis` rather than in a factory, so the content-derived sweep above cannot
    // see it. Left unscaled it would make one Mirrorwing resolve differently from another depending on whether
    // the spread came from the printed card or the rune.
    const body = bodyAt('export function fireOnSpellCastOnThis(');
    const spread = body.slice(body.indexOf('runeSharedReflection'));
    expect(/castSpell\(/.test(spread), 'the rune spread should still cast').toBe(true);
    expect(
      /spellCasts\(/.test(spread),
      'Rune of Shared Reflection spreads a flat cast while the printed cards spread a full one',
    ).toBe(true);
  });
});
