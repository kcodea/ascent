import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';

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

/**
 * THE CONSEQUENCES CARRY IT TOO — the half that actually reaches the player.
 *
 * A cast produces two kinds of event and they land in DIFFERENT presentation moments: the announcement
 * (`sc`) and the buffs. The stock buff tendril lives on the buff wave, so identifying only the announcement
 * left the wave attributed to the CASTER — which is exactly what the owner saw:
 *
 *   *"flamebeat drake and warflame both cast dragonflame in combat, but both are triggering tendrils instead."*
 *
 * `ctx.castingSpellId` marks the whole cast window so every buff inside it says which spell caused it. Run
 * through the real simulator rather than asserted on the source, because the marker has to survive the cast
 * pipeline (repeats, spell power, the arena adapter) to be worth anything.
 */
describe('Doc Bot — a spell’s BUFFS carry the spell too, not just its announcement', () => {
  const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
    ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);

  /** Flamebeat Drake's Rally casts Dragonflame; it swings with `RL`, so its own attack is the Rally. */
  const fight = () => simulate(
    [bm('d2_flamebeat', 'F', 4, 400, ['RL']), bm('d2_ashscribe', 'D', 0, 400)],
    [{ cardId: 'sandbag', attack: 0, health: 9999 } as unknown as BoardMinion], makeRng(5), CARD_INDEX,
    combatSide({ tier: 6 }), combatSide({ tier: 1 }));

  it('Flamebeat Drake’s Rally cast announces the spell', () => {
    const casts = fight().events.filter((e) => e.type === 'sc' && e.spellId === 'sp_dragonflame');
    expect(casts.length, 'no Dragonflame cast was announced at all').toBeGreaterThan(0);
  });

  it('…and every buff that cast produced names it', () => {
    const buffs = fight().events.filter((e) => e.type === 'buff' && e.source === 'm0');
    expect(buffs.length, 'the cast granted nothing').toBeGreaterThan(0);
    for (const b of buffs) {
      expect(
        (b as { spellId?: string }).spellId,
        'this buff is attributed to the Drake, so its wave plays the Drake’s presentation, not the spell’s',
      ).toBe('sp_dragonflame');
    }
  });

  it('a buff OUTSIDE any cast is unmarked — the marker is a scope, not a default', () => {
    // Karwind pumps Dragons directly, with no spell involved. A marker that leaked would make every buff in
    // the fight claim to be a spell, and every buff wave would resolve the wrong binding.
    const r = simulate(
      [bm('karwind', 'K', 0, 400), bm('d2_ashscribe', 'D', 0, 400)],
      [{ cardId: 'sandbag', attack: 0, health: 9999 } as unknown as BoardMinion], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    for (const e of r.events) {
      if (e.type === 'buff') expect((e as { spellId?: string }).spellId, `${JSON.stringify(e)}`).toBeUndefined();
    }
  });
});
