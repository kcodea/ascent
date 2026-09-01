import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * DOC BOT LANE `spellCastIdentity` — a combat spell cast says WHICH SPELL it was.
 *
 * ── Where this comes from (owner ask 2026-09-01) ───────────────────────────────────────────────────────────
 *
 *   *"i added a dragonflame effect that should play anytime dragonflame is played. that includes from hand,
 *   from cards that cast it in combat, from cards that cast it from hand, end of turn, anything."*
 *
 * A combat cast logs `{ type: 'sc', source, text: "<Caster> casts <Spell>" }`. The `source` is the CASTER's
 * uid, so before this the only identity presentation could resolve was the body that cast — which meant an
 * authored spell effect had to be bound to Flamebeat Drake AND Warflame AND every future caster, and a new
 * caster would arrive silently unanimated. The spell's name was right there in the log line, as prose, where
 * nothing could key off it.
 *
 * The fix is one optional field: `spellId` on the `sc` event, stamped by every "X casts Y" emit. `score.ts`
 * then resolves the binding by the SPELL when one is present and falls back to the caster otherwise, and
 * `useCombatReplay` plays that spell's own clip the same way.
 *
 * ── What this lane guards ──────────────────────────────────────────────────────────────────────────────────
 *
 * The failure mode is silent and additive: someone writes a NEW combat caster, copies the nearest `ctx.log`
 * line, and omits `spellId`. Nothing breaks, no test fails — the spell just does not animate when THAT card
 * casts it, which is indistinguishable from the FX not being wired at all. So the rule is checked on the
 * source: every `sc` emit whose text announces a cast must carry the id of what it cast.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = ['../../../core/src/effects/factories.ts', '../../../core/src/combat/simulate.ts']
  .map((rel) => [rel, readFileSync(join(HERE, rel), 'utf8')] as const);

/** Every `type: 'sc'` emit whose text is a "<someone> casts <something>" announcement. */
function castEmits(src: string): string[] {
  const out: string[] = [];
  // The emit is written on one line at every site today; a multi-line one would simply not be seen, which is
  // why the count assertion below exists — a rewrite that reflows these lines fails loudly rather than
  // quietly shrinking the sweep to nothing.
  for (const line of src.split('\n')) {
    if (!line.includes("type: 'sc'")) continue;
    if (!/casts \$\{/.test(line)) continue;
    out.push(line.trim());
  }
  return out;
}

describe('Doc Bot — every combat cast names the spell it cast', () => {
  const all = SOURCES.flatMap(([rel, src]) => castEmits(src).map((line) => [rel, line] as const));

  it('the sweep found the cast emits (a reflow would otherwise pass vacuously)', () => {
    // Nine at the time of writing. Asserted as a FLOOR, not an equality: adding a caster is normal and should
    // not fail the lane, while losing them all means the scan stopped seeing anything.
    expect(all.length, 'no "X casts Y" emits found — has the emit shape changed?').toBeGreaterThanOrEqual(9);
  });

  it.each(all.map(([rel, line], i) => [`${rel.split('/').pop()}#${i}`, line] as const))(
    '%s stamps spellId',
    (_where, line) => {
      expect(
        /spellId:/.test(line),
        `this cast is identified only by its caster, so a spell-keyed FX or sound cannot find it:\n  ${line}`,
      ).toBe(true);
    },
  );
});
