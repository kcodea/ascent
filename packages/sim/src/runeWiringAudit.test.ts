import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EPIC_RUNES, RUNES, RUNE_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';

/**
 * THE RUNE WIRING AUDIT (owner ask 2026-08-07: "audit our entire runebase and make sure they all work").
 *
 * Two real defects hid in the same blind spot today — Rune of the Chef's `combatFlag` writer was never added,
 * and its per-instance tally never reached the combat body. Both survived because every per-mechanism test
 * injects `questMods` straight into `simulate`, proving the COMBAT behaviour while bypassing the reducer that
 * has to deliver the flag in the first place.
 *
 * This audit walks EVERY rune and checks the chain its reward kind implies, through the real `reduce` path:
 *
 *   1. buying it never throws and always changes run state (no silently inert rune)
 *   2. a `combatFlag` rune actually writes `questFlags[flag]`            ← the Chef's first defect
 *   3. that flag is threaded into the combat mods object                ← structurally, the Chef's second
 *   4. every flag a rune can grant is one combat actually READS
 *
 * A new rune that forgets any link fails here rather than shipping dead.
 */

const ALL = [...RUNES, ...EPIC_RUNES];
const reducerSrc = fs.readFileSync(path.join(__dirname, 'reducer.ts'), 'utf-8');
const simulateSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'core', 'src', 'combat', 'simulate.ts'), 'utf-8');

/** Buy a rune through the real Runeforge path. */
function buy(id: string, over: Partial<RunState> = {}): RunState {
  const s: RunState = {
    ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...over,
  };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

/** Fields that always change on ANY buy — ignored when asking "did this rune do anything?". */
const BOOKKEEPING = new Set([
  'embers', 'ownedRunes', 'runeforgeOffer', 'runeforge', 'rngCursor', 'uidSeq', 'goldSpent',
  'goldSpentThisTurn', 'runeforgeRerolled', 'runeforgeSeen', 'pool', 'log',
]);

describe('every rune does SOMETHING when bought', () => {
  it.each(ALL.map((r) => [r.id, r.name] as const))('%s (%s)', (id) => {
    const before = createRun(3, 'runesmith');
    let after: RunState;
    expect(() => { after = buy(id); }, `buying ${id} threw`).not.toThrow();
    after = buy(id);
    expect(after.ownedRunes, `${id} was not recorded as owned`).toContain(id);
    // Something beyond pure bookkeeping must have moved: a flag, a meter, a granted card, a stat.
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed = [...keys].filter((k) => {
      if (BOOKKEEPING.has(k)) return false;
      const b = before as unknown as Record<string, unknown>;
      const a = after as unknown as Record<string, unknown>;
      return JSON.stringify(b[k]) !== JSON.stringify(a[k]);
    });
    expect(changed.length, `${id} changed nothing outside bookkeeping — is it wired at all?`).toBeGreaterThan(0);
  });
});

describe('combatFlag runes reach combat', () => {
  const flagRunes = ALL.filter((r) => r.reward?.kind === 'combatFlag')
    .map((r) => [r.id, (r.reward as { flag: string }).flag] as const);

  it('the audit sees a meaningful number of them (sanity)', () => {
    expect(flagRunes.length).toBeGreaterThan(20);
  });

  it.each(flagRunes)('%s writes questFlags.%s when bought', (id, flag) => {
    const s = buy(id);
    const v = (s.questFlags ?? {})[flag as keyof typeof s.questFlags];
    expect(v, `buying ${id} never wrote questFlags.${flag} — the reducer's combatFlag writer is missing a branch`)
      .toBeTruthy();
  });

  it.each(flagRunes)('%s: something actually CONSUMES %s', (_id, flag) => {
    // A flag has two legitimate homes: read inside the fight (`simulate.ts`), or read at SETTLE off the
    // combat result (`reducer.ts` — Rune of Slaying spends `playerQuestTally.slaughter` that way). Either is
    // fine. NEITHER means the rune arms and then does nothing at all, which is the failure worth catching.
    const inCombat = simulateSrc.includes(flag);
    const atSettle = new RegExp(`questFlags\\?\\.${flag}\\b`).test(reducerSrc);
    expect(inCombat || atSettle, `${flag} is granted but nothing reads it — the rune is inert`).toBe(true);
  });

  it.each(flagRunes)('%s: if combat reads %s, the reducer threads it there', (_id, flag) => {
    // The Chef's second defect exactly: written to questFlags, read by simulate, but never placed in the mods
    // object in between — so it armed, travelled nowhere, and the combat half saw `undefined`. Only asserted
    // for flags combat actually reads; a settle-time flag legitimately needs no mods entry.
    if (!simulateSrc.includes(flag)) return;
    const threaded = new RegExp(`\\b${flag}\\s*:\\s*(f\\?\\.|s\\.)`).test(reducerSrc);
    expect(threaded, `simulate.ts reads ${flag}, but the reducer never threads it into the combat mods`).toBe(true);
  });
});

describe('the rune index is coherent', () => {
  it('every offerable rune resolves in RUNE_INDEX, and ids are unique', () => {
    const seen = new Set<string>();
    for (const r of ALL) {
      expect(RUNE_INDEX[r.id], `${r.id} is offerable but missing from RUNE_INDEX`).toBeDefined();
      expect(seen.has(r.id), `duplicate rune id ${r.id}`).toBe(false);
      seen.add(r.id);
    }
  });
});
