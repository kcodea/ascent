/**
 * DOC BOT — LOOP / EXPLOSION GUARD (handoff §8.4).
 *
 * Test-level instrumentation over `reduce` dispatches. Two lanes:
 *
 * 1. **Per-action budgets** — generated-card count (uidSeq delta), recruit FX volume, and board/hand growth
 *    per accepted action. A HIGH but terminating count is a WARNING (returned for the caller to
 *    `console.warn`), never a failure; only budget exhaustion (an order of magnitude past any legitimate
 *    action today) is a failure. These are correctness/safety signals, not balance verdicts.
 *
 * 2. **Repeated-state signature** — each accepted action's result is normalized (uids, rng cursor and
 *    per-action FX scratch stripped — they advance monotonically and would make every state trivially
 *    unique) and hashed. A repeat inside one action loop means the loop returned to a materially identical
 *    state: the shape of a Gold/card-generation cycle, and a hard FAILURE with the chain trace. Rejected
 *    actions (`after === before`) are excluded — a no-op is legal, a cycle is not.
 *
 * The signature is a curated material projection (resources + card zones + tier/wave), not a full state
 * hash: fields like rngCursor MUST stay out (an infinite loop that advances the RNG is still an infinite
 * loop), and per-action scratch would never repeat. New material resources should be added here if a loop
 * through them becomes possible.
 */
import type { RunState } from '../state';

/** FNV-1a 32-bit over a string — deterministic, dependency-free, no Math.random anywhere. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Normalize a RunState down to its MATERIAL content (what a resource/card loop would reproduce). */
export function normalizedSignature(s: RunState): string {
  const card = (c: { cardId: string; attack: number; health: number; golden: boolean; keywords: string[] }) =>
    [c.cardId, c.attack, c.health, c.golden ? 1 : 0, [...c.keywords].sort().join('+')].join(',');
  const material = {
    embers: s.embers,
    tier: s.tier,
    wave: s.wave,
    phase: s.phase,
    upgradeCost: s.upgradeCost,
    freeRolls: s.freeRolls,
    frozen: s.frozen,
    spellsCast: s.spellsCast,
    rubyCasts: s.rubyCasts ?? 0,
    hand: s.hand.map(card),
    board: s.board.map(card),
    shop: s.shop.map((o) => [o.cardId, o.cost ?? -1, o.golden ? 1 : 0].join(',')),
    spell: s.spell?.cardId ?? null,
  };
  return fnv1a(JSON.stringify(material));
}

export interface GuardBudgets {
  /** uidSeq delta per action: above `warn` → warning; above `fail` → failure. */
  generatedWarn: number;
  generatedFail: number;
  /** recruitBuffFx entries per action (the per-action FX scratch — reset at every dispatch). */
  fxWarn: number;
  fxFail: number;
  /** Hand growth per action (cards that arrived in one action). */
  handGrowthWarn: number;
}

/** Defaults sized off today's loudest legitimate actions (a full-board tribe buff ≈ 7 FX; a multi-cast
 *  conjure spell ≈ a handful of uids) with an order of magnitude of headroom before warning, and another
 *  before failing. */
export const DEFAULT_BUDGETS: GuardBudgets = {
  generatedWarn: 40,
  generatedFail: 400,
  fxWarn: 150,
  fxFail: 1500,
  handGrowthWarn: 12,
};

export interface GuardReport {
  warnings: string[];
  failures: string[];
}

/**
 * Stateful guard for one action loop: feed it every (before, after, label) dispatch in order.
 * Collects budget warnings/failures and repeated-signature failures; `report()` returns both.
 */
export class ExplosionGuard {
  private seen = new Map<string, string>();
  private trace: string[] = [];
  readonly warnings: string[] = [];
  readonly failures: string[] = [];

  constructor(private budgets: GuardBudgets = DEFAULT_BUDGETS) {}

  step(before: RunState, after: RunState, label: string): void {
    if (after === before) return; // rejected no-op — legal, and materially identical by definition
    this.trace.push(label);

    // Per-action budgets.
    const gen = after.uidSeq - before.uidSeq;
    const fx = after.recruitBuffFx?.length ?? 0;
    const handGrowth = after.hand.length - before.hand.length;
    if (gen > this.budgets.generatedFail) this.failures.push(`${label}: generated ${gen} uids in one action (budget ${this.budgets.generatedFail})`);
    else if (gen > this.budgets.generatedWarn) this.warnings.push(`${label}: generated ${gen} uids in one action`);
    if (fx > this.budgets.fxFail) this.failures.push(`${label}: emitted ${fx} recruit FX in one action (budget ${this.budgets.fxFail})`);
    else if (fx > this.budgets.fxWarn) this.warnings.push(`${label}: emitted ${fx} recruit FX in one action`);
    if (handGrowth > this.budgets.handGrowthWarn) this.warnings.push(`${label}: hand grew by ${handGrowth} in one action`);

    // Repeated material signature = a cycle.
    const sig = normalizedSignature(after);
    const prior = this.seen.get(sig);
    if (prior !== undefined) {
      this.failures.push(
        `${label}: state signature ${sig} repeats one first seen after '${prior}' — a Gold/card cycle. Chain: ${this.trace.join(' → ')}`,
      );
    } else {
      this.seen.set(sig, label);
    }
  }

  report(): GuardReport {
    return { warnings: [...this.warnings], failures: [...this.failures] };
  }
}
