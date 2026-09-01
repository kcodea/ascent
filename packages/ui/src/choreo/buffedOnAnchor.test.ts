import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveTables } from './bindings';

/**
 * `buffedOn` PLAYS ON THE BUFFED MINION — in BOTH phases (owner report 2026-09-01).
 *
 *   *"dragonflame's effect is happening at the cursor location when it should be happening at the target of
 *   the buff's location."*
 *
 * Two anchor conventions exist in this codebase and they look identical at the call site:
 *
 *   playDef(def, { source: cursorOrCaster, target: minion })   ← a TRAVELLING def (the Ales' volley)
 *   playDef(def, { source: minion,         target: minion })   ← a def that plays ON the minion
 *
 * A def authored against `source` — a column of flame rather than a projectile — lands at the cursor in the
 * shop and on the CASTER in combat if it gets the first pair. That is the bug above, and it is invisible to
 * the type system: both are well-formed anchor objects.
 *
 * The runners are DOM-measuring (shop) and Pixi-driven (combat), so neither can be executed here. What IS
 * checkable, and what actually broke, is the anchor pair each `buffedOn` branch writes — so this pins that,
 * on the source, for both halves. If the two ever disagree, a spell bound at both kinds plays in the right
 * place in one phase and the wrong place in the other, which reads as a bug in whichever the player sees
 * second.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');
const readReplay = (): string => readFileSync(join(HERE, '../useCombatReplay.ts'), 'utf8');

/** A brace-matched block starting at `marker`, comments stripped — a comment describing the right anchors
 *  must not vouch for code that writes the wrong ones (the `rallyGuard` trap, 2026-08-31). */
function blockAt(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, `${marker} is gone — this test needs re-anchoring`).toBeGreaterThan(-1);
  const open = src.indexOf('{', start);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(open, i).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('the buffedOn fan-out anchors on the buffed unit', () => {
  it('something actually declares it (an unused fan-out would pass vacuously)', () => {
    const cards = effectiveTables().cards;
    const users = Object.entries(cards).flatMap(([card, kinds]) =>
      Object.entries(kinds ?? {}).filter(([, b]) => b?.fanOut === 'buffedOn').map(([kind]) => `${card}:${kind}`),
    );
    expect(users, 'Dragonflame is the case this fan-out was added for').toContain('sp_dragonflame:spellCast');
    // COMBAT binds at `buffWave`, not at the cast announcement: the buffs are a moment of their own, and they
    // are both what the def plays on and where the stock tendril it replaces lives.
    expect(users).toContain('sp_dragonflame:buffWave');
  });

  it('COMBAT plays at the buffed unit, not from the caster', () => {
    const body = blockAt(read('./score.ts'), "binding.fanOut === 'buffedOn'");
    // `c.source` is the buffer. Naming it in the anchor pair is exactly the `buffed` (travelling) convention,
    // and exactly what would put Dragonflame on Flamebeat Drake instead of on the Dragon it pumped.
    expect(/anchorsForUnits\(c\.target, c\.target\)/.test(body), 'must anchor both ends on the buffed unit').toBe(true);
    expect(/anchorsForUnits\(c\.source/.test(body), 'anchoring on the caster is the travelling convention').toBe(false);
  });

  it('BOTH tendril paths drop an authored buff through the same helper', () => {
    // *"flamebeat drake and warflame both cast dragonflame in combat, but both are triggering tendrils
    // instead"* … and then, once on-attack casts moved inside the wind-up, *"they are back to casting tendrils
    // instead of dragonflame"* — owner, 2026-09-01, twice, because there are TWO tendril paths.
    //
    // A standalone buff wave goes through the score's `buffCast` cue; a cast absorbed into a swing goes through
    // `fireBuffCasts` in the replay hook, where the moment belongs to the ATTACK and the spell is only visible
    // per-buff. Both must ask `authoredBuffDefFor`, or a spell animates on one kind of beat and not the other.
    const inScore = blockAt(read('./score.ts'), "cue.ch === 'buffCast'");
    expect(inScore.includes('authoredBuffDefFor(c.spellId)'), "the score's tendril channel must filter authored buffs out").toBe(true);
    expect(readReplay().includes('authoredBuffDefFor(c.spellId)'), 'the wind-up tendril path must drop authored buffs too').toBe(true);
  });

  it('the helper gates on the fan-out, so `buffed` keeps its tendril', () => {
    // `buffed` is deliberately additive — Karwind's flame-ring rides ON TOP of its tendrils (owner ruling
    // 2026-08-11). Only `buffedOn` means "instead of".
    const body = blockAt(read('./bindings.ts'), 'export function authoredBuffDefFor(');
    expect(body.includes("fanOut === 'buffedOn'")).toBe(true);
  });

  it('the SHOP plays at the buffed unit, not at the release point', () => {
    const body = blockAt(read('./recruitCues.ts'), 'function runBuffedOnFire(');
    // `c` is the measured minion centre; `pt` is the cursor. The cursor must not reach the anchors at all —
    // that is the literal bug the owner reported.
    expect(/source: c, target: c/.test(body), 'must anchor both ends on the measured minion').toBe(true);
    expect(/\bpt\b/.test(body), 'the release point must not appear in this runner at all').toBe(false);
  });
});
