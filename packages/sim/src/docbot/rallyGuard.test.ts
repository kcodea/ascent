import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_CARDS, ARCHIVED_CARDS } from '@game/content';
import type { CardDef } from '@game/core';

/**
 * DOC BOT LANE `rallyGuard` — a Rally is THIS minion's own swing, and the engine must say so.
 *
 * ── The bug this exists for (owner report 2026-08-31) ──────────────────────────────────────────────────────
 *
 *   *"this is my warband. when any minion attacks or takes damage, i am getting choose one cards."*
 *
 * Flagrunner prints **Rally: get a Choose One card**, and it paid out on every swing on the board.
 *
 * ── Why the shape is a trap, not a slip ────────────────────────────────────────────────────────────────────
 *
 * `on: 'onAttack'` is BROADCAST: the simulator emits it once per swing and every friendly minion's `onAttack`
 * effects run. The trigger name therefore does NOT distinguish the two things it is used for:
 *
 *   · a **Rally** — "when THIS minion attacks" — which must return early unless the attacker is itself;
 *   · an **ally-attack watcher** — "whenever your minions attack" (Crypt Drake, Standard Bearer) — which must
 *     not.
 *
 * The only difference between them is a one-line payload guard inside the factory. Omit it on a Rally and the
 * card silently becomes the other kind: it still fires, still looks wired, and pays out several times per
 * turn instead of once. Nothing about the card data is wrong, so no data-level check can see it — which is
 * why this lane reads the FACTORY SOURCE.
 *
 * The codebase already agrees on the gate (`if (self.dead || minion !== self) return;` appears on ~100
 * factories) and the simulator draws the same distinction when it computes `rallyExtra`, gating on the RL
 * keyword. So the rule here is simply: **a card with the RL keyword firing an `onAttack` factory must reach a
 * factory that guards on identity** — or be declared below with the reason it deliberately does not.
 */

const FACTORIES = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../core/src/effects/factories.ts'),
  'utf8',
);

/**
 * factory id -> its body text, parsed once, WITH COMMENTS STRIPPED.
 *
 * The stripping is not tidiness — it is the difference between this lane working and quietly passing. The
 * guard it looks for is a short, quotable line, so a comment explaining why the guard matters contains the
 * very text being searched for. The first cut of this lane matched its own explanatory comment and passed
 * against the shipped bug with the guard deleted. Sabotage is what found that; the strip is what fixes it.
 */
function factoryBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\n {2}(\w+): \((?:[^)]*)\) => \{([\s\S]*?)\n {2}\},/g)) {
    const code = m[2]!.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    out.set(m[1]!, code);
  }
  return out;
}

/**
 * The identity guard, in the forms the codebase actually writes it. Deliberately narrow: a factory that
 * guards some OTHER way is not silently accepted, it is a declaration below — so the reason gets written
 * down and read once, rather than re-derived by whoever next trips over the trigger.
 */
const GUARD = /minion !== self|minion\?\.uid !== self\.uid|minion\.uid !== self\.uid/;

/**
 * Factories a Rally card may reach WITHOUT the identity guard, each with the reason it is correct.
 *
 * This is the whole safety valve, and it is deliberately small: an entry here is a claim that the card means
 * "whenever your minions attack" rather than "when this attacks", which is a design statement someone has to
 * make on purpose.
 */
const BROADCAST_BY_DESIGN: Record<string, string> = {
  onRallyBuffOnePerTribe:
    'Paragon / Standard Bearer print "whenever you TRIGGER a Rally" — any friendly Rally, not this body\'s '
    + 'swing. It guards on SIDE (`minion.side !== self.side`) instead, which is the correct gate for that '
    + 'wording, and passes the attacker through to the arena so the payout knows who swung',
};

/**
 * Known-unguarded factories on ARCHIVED cards. Not an excuse — a quarantine. An archived card cannot reach a
 * player (see `ARCHIVED_CARDS`), so this is a latent bug rather than a live one, and restoring the card must
 * mean fixing it first. Kept visible here precisely so restoring one cannot quietly ship the bug.
 */
const ARCHIVED_UNGUARDED: Record<string, string> = {
  rallyBuffCelestials:
    'Equinox Duelist (Dawn Rally). Takes NO payload at all, so it would buff on every ally swing — the exact '
    + 'Flagrunner shape. Its card was archived with the other 15 Celestials on 2026-08-28 and cannot be '
    + 'drawn; fix the guard before ever restoring it',
};

const rallyFactoriesOf = (def: CardDef): string[] =>
  def.effects.filter((e) => e.on === 'onAttack').map((e) => e.do)
    .concat((def.chooseOne ?? []).flatMap((b) => (b.effects ?? []).filter((e) => e.on === 'onAttack').map((e) => e.do)));

/** A RALLY card: the RL keyword is what the simulator itself gates on when it decides a swing was a Rally. */
const isRally = (def: CardDef): boolean => def.keywords.includes('RL') && rallyFactoriesOf(def).length > 0;

describe('Doc Bot — a Rally fires on its OWN swing', () => {
  const bodies = factoryBodies(FACTORIES);
  // `ALL_CARDS` still holds the archive — an archived card keeps its id so quests/runes that name it resolve
  // (see `ARCHIVED_CARDS`). LIVE means drawable, so the archive is subtracted here and quarantined below.
  const archived = new Set(ARCHIVED_CARDS.map((c) => c.id));
  const live = ALL_CARDS.filter((c) => !archived.has(c.id)).filter(isRally);

  it('parses the factory table (a floor — the sweep must not pass by matching nothing)', () => {
    // Every assertion below is vacuous if the parse breaks, and a regex over source is exactly the thing that
    // breaks silently when the file is reformatted.
    expect(bodies.size, 'factories parsed').toBeGreaterThan(150);
    expect(live.length, 'Rally cards in the live pool').toBeGreaterThan(20);
    expect([...bodies.values()].filter((b) => GUARD.test(b)).length, 'factories carrying the guard')
      .toBeGreaterThan(50);
  });

  it('every LIVE Rally guards on identity, or is declared a deliberate broadcast', () => {
    const unguarded: string[] = [];
    for (const def of live) {
      for (const f of rallyFactoriesOf(def)) {
        if (f in BROADCAST_BY_DESIGN) continue;
        const body = bodies.get(f);
        if (body === undefined) { unguarded.push(`${def.id} → ${f} (no factory body found)`); continue; }
        if (!GUARD.test(body)) unguarded.push(`${def.id} → ${f}`);
      }
    }
    expect(
      [...new Set(unguarded)],
      'these cards print Rally but fire on EVERY friendly swing — `onAttack` is broadcast, so a Rally needs '
      + '`if (self.dead || minion !== self) return;`. Add the guard, or declare the factory in '
      + 'BROADCAST_BY_DESIGN with the wording that makes it an ally-attack watcher',
    ).toEqual([]);
  });

  it('the archived quarantine is exactly what it says it is', () => {
    // Both halves matter: an entry must still be unguarded (or it is stale), and its card must still be
    // archived (or the bug is live and belongs in the test above).
    const archivedIds = new Set(ARCHIVED_CARDS.filter(isRally).flatMap(rallyFactoriesOf));
    for (const [f, why] of Object.entries(ARCHIVED_UNGUARDED)) {
      expect(bodies.has(f), `${f}: ${why} — but no such factory exists any more`).toBe(true);
      expect(GUARD.test(bodies.get(f) ?? ''), `${f} is guarded now — delete its quarantine entry`).toBe(false);
      expect(archivedIds.has(f), `${f} is no longer reached only by archived cards — fix the guard`).toBe(true);
    }
  });

  it('no declaration has outlived its cards', () => {
    const reachable = new Set(live.flatMap(rallyFactoriesOf));
    expect(Object.keys(BROADCAST_BY_DESIGN).filter((f) => !reachable.has(f)),
      'these declarations match no live Rally card — delete them so the list stays a real inventory').toEqual([]);
  });
});
