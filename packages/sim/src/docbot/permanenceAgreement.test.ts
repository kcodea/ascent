import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import type { CardDef } from '@game/core';

/**
 * DOC BOT LANE `permanenceAgreement` — a card's PRINTED permanence and the channel it actually buffs through
 * cannot disagree.
 *
 * ── Where this comes from (owner change 2026-09-01) ────────────────────────────────────────────────────────
 *
 *   *"standard bearer's buff to Rally: give a friendly minion of each type +3/+3. (it loses permanent)"*
 *
 * Standard Bearer and Paragon share ONE factory, `onRallyBuffOnePerTribe`, which now takes a `permanent`
 * param: absent (Paragon) accrues `permaGain` so the gift rides home, `false` (Standard Bearer) is an
 * ordinary in-fight buff. That is two failure modes a type-checker cannot see:
 *
 *  · The TEXT still says "permanently" while the effect no longer is — the player is told a lie that only
 *    shows up after a fight they have already planned around.
 *  · The PARAM is written but the factory never reads it, so the card silently keeps the old behaviour. A
 *    param nobody reads is indistinguishable from a param that works, which is exactly how a balance change
 *    ships as a no-op.
 *
 * Both are checked here for EVERY card, not just the two — because the next author to reach for `permanent`
 * will be copying one of them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** Every module that can define an effect factory. A param is "read" if any of them reads it. */
const FACTORY_SOURCE = ['../../../core/src/effects/arena.ts', '../../../core/src/effects/factories.ts', '../recruit.ts']
  .map((rel) => readFileSync(join(HERE, rel), 'utf8'))
  .join('\n');

interface Eff { do: string; params?: Record<string, unknown> }
const effectsOf = (def: CardDef): Eff[] => [
  ...((def as unknown as { effects?: Eff[] }).effects ?? []),
  // Choose One branches carry their own effects, and a branch is exactly where a permanence claim could hide
  // from a scan that only walked the top level (the trap the Apples live-text bug was made of).
  ...(((def as unknown as { chooseOne?: { effects?: Eff[] }[] }).chooseOne ?? []).flatMap((b) => b.effects ?? [])),
];

const CARDS = Object.values(CARD_INDEX) as CardDef[];
/** Cards that explicitly opt OUT of permanence. */
const IMPERMANENT = CARDS.filter((d) => effectsOf(d).some((e) => e.params?.permanent === false));
const claimsPermanence = (d: CardDef): boolean =>
  /permanent/i.test(`${d.text ?? ''} ${(d as unknown as { goldenText?: string }).goldenText ?? ''}`);

describe('Doc Bot — printed permanence matches the channel the effect buffs through', () => {
  it('the lane has something to grade (an empty sweep passes vacuously)', () => {
    expect(IMPERMANENT.map((d) => d.id), 'Standard Bearer is the case this lane was built from').toContain('n2_standardbearer');
  });

  it.each(IMPERMANENT.map((d) => [d.id] as const))('%s does not print a permanence it no longer has', (id) => {
    const def = CARD_INDEX[id]!;
    expect(
      claimsPermanence(def),
      `${id} sets permanent:false but still prints "${def.text}" — the text is what the player plans around`,
    ).toBe(false);
  });

  /**
   * The other direction, and the one that catches the silent no-op: a `permanent` param the named factory
   * never reads. `params.permanent` is the only way a factory can honour it, so its absence from every
   * factory module means the card is authored as impermanent and behaving as permanent.
   */
  it.each([...new Set(IMPERMANENT.flatMap((d) => effectsOf(d).filter((e) => e.params?.permanent === false).map((e) => e.do)))]
    .map((f) => [f] as const))('the %s factory actually reads params.permanent', (factoryId) => {
    // Anchored on the factory's own body rather than the whole file, so a DIFFERENT factory reading the param
    // cannot vouch for this one.
    const start = FACTORY_SOURCE.indexOf(`${factoryId}(arena: EffectArena`);
    expect(start, `${factoryId} is not an arena factory — widen this lane if a new shape needs the param`).toBeGreaterThan(-1);
    const open = FACTORY_SOURCE.indexOf('{', start);
    let depth = 0;
    let i = open;
    for (; i < FACTORY_SOURCE.length; i++) {
      if (FACTORY_SOURCE[i] === '{') depth++;
      else if (FACTORY_SOURCE[i] === '}' && --depth === 0) break;
    }
    // Comments stripped: a comment mentioning the param would otherwise vouch for a body that dropped it —
    // the exact trap the `rallyGuard` lane was caught by on 2026-08-31.
    const body = FACTORY_SOURCE.slice(open, i).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(
      /params\.permanent/.test(body),
      `${factoryId} ignores params.permanent, so every card that sets it is silently still permanent`,
    ).toBe(true);
  });
});
