/**
 * DOC BOT LANE `combatEmitAgreement` — the trigger×phase registry must agree with the ENGINE'S EMIT SITES.
 *
 * ── The miss this encodes (owner report 2026-08-29) ────────────────────────────────────────────────────────
 *
 * *"gangplank doesnt trigger when cards are added to hand in combat."*
 *
 * `factoryPhase` exists precisely to catch a trigger with no factory in a phase that dispatches it — the
 * "silent-dispatch hole". It did not catch this one, and the reason is worth stating plainly because it is a
 * failure mode of the CHECK rather than of the code under test:
 *
 *   `factoryPhase` computes `needCombat` from `TRIGGER_PHASES`. `onGainCard` was written down as
 *   `'recruit'`, with the note "combat has no dispatch site for it". That note was false — `ctx.grantToHand`
 *   had existed all along — so `needCombat` was `false`, and the combat half of the rail switched itself off.
 *   The lane whose whole job is finding missing combat factories could not see a missing combat factory.
 *
 * One wrong word in a hand-maintained registry disabled a rail, silently, and nothing downstream could tell.
 * So this lane stops trusting the registry on that point and derives the answer from the engine: every
 * trigger COMBAT ACTUALLY EMITS must be declared `'combat'` or `'both'`, or waived in `COMBAT_EMIT_WAIVED`
 * with a reason that stays true.
 *
 * ── Why a SOURCE scan rather than a runtime probe ─────────────────────────────────────────────────────────
 *
 * A runtime probe can only observe the emits a scenario happens to reach, so "not observed" would mean "the
 * probe didn't get there" — the same evidence gap `beats:audit` warns about. `bus.emit('<name>')` is a
 * literal at every site, so reading the source answers "can combat emit this at all?" exactly, with no
 * scenario coverage to argue about.
 *
 * ── Generalisation ────────────────────────────────────────────────────────────────────────────────────────
 *
 * The class rule, not the Gangplank regression (that ships in `handGainInCombat.test.ts`): **a registry that
 * gates another check must be derivable from the thing it describes.** Any future trigger someone classifies
 * from card text instead of dispatch sites fails here the moment combat emits it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { COMBAT_EMIT_WAIVED, TRIGGER_PHASES } from './phaseRegistry';

const CORE_SRC = join(__dirname, '../../../core/src');

/** Every `.ts` file under packages/core/src. */
function coreFiles(dir = CORE_SRC, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) coreFiles(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Trigger names combat emits on the bus, read from source. */
function combatEmittedTriggers(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const f of coreFiles()) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/bus\.emit\(\s*'([A-Za-z][A-Za-z0-9_]*)'/g)) {
      const name = m[1]!;
      const where = f.slice(CORE_SRC.length + 1).split(sep).join('/');
      const list = found.get(name) ?? [];
      if (!list.includes(where)) list.push(where);
      found.set(name, list);
    }
  }
  return found;
}

describe('Doc Bot — the phase registry agrees with combat’s emit sites', () => {
  const emitted = combatEmittedTriggers();

  it('the scan finds emit sites at all (a silent zero would make every assertion below vacuous)', () => {
    expect(emitted.size, 'no `bus.emit` found under packages/core/src — the scan is broken, not the engine')
      .toBeGreaterThan(5);
    expect([...emitted.keys()], 'sanity: the trigger this lane was born from').toContain('onGainCard');
  });

  it('every trigger COMBAT EMITS is declared combat/both, or waived with a reason', () => {
    const wrong: string[] = [];
    for (const [trigger, sites] of emitted) {
      if (COMBAT_EMIT_WAIVED[trigger]) continue;
      const phase = TRIGGER_PHASES[trigger];
      if (phase === undefined) {
        wrong.push(`${trigger}: emitted by combat (${sites.join(', ')}) but absent from TRIGGER_PHASES`);
      } else if (phase === 'recruit') {
        wrong.push(`${trigger}: TRIGGER_PHASES says 'recruit', but combat emits it (${sites.join(', ')}) — this is the Gangplank shape: factoryPhase's combat half is switched off for it`);
      }
    }
    expect(wrong, `Trigger/phase disagreement(s):\n  ${wrong.join('\n  ')}\n\nFix the classification (and implement the combat factory), or add a COMBAT_EMIT_WAIVED entry stating why combat's handlers are covered under other factory ids.`)
      .toEqual([]);
  });

  it('no waiver outlives the emit site it excuses', () => {
    // A waiver is a standing claim about the engine. If combat stops emitting the trigger, the claim is no
    // longer about anything and must not sit here reading as reviewed.
    const stale = Object.keys(COMBAT_EMIT_WAIVED).filter((t) => !emitted.has(t));
    expect(stale, `COMBAT_EMIT_WAIVED entr(ies) for trigger(s) combat no longer emits: ${stale.join(', ')} — delete them.`)
      .toEqual([]);
  });

  it('every waiver carries a real reason, not a placeholder', () => {
    const thin = Object.entries(COMBAT_EMIT_WAIVED)
      .filter(([, why]) => why.trim().length < 30)
      .map(([t]) => t);
    expect(thin, `Waiver(s) with no substantive reason: ${thin.join(', ')}`).toEqual([]);
  });
});
