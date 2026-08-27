/**
 * DOC BOT — SEMANTIC COVERAGE KEYS (handoff §9.1, PR 8).
 *
 * A coverage KEY names one unit of reachable behaviour a QA execution exercised — an effect factory firing,
 * a trigger family emitting, a combat-mod being consumed — so the coverage-guided corpus can retain the
 * smallest scenario that reaches each one. Keys are SEMANTIC (game vocabulary), never JS line coverage.
 *
 * ZERO ENGINE CHANGE — a deliberate judgement call. The handoff suggests an observer/tap in the engine
 * (the `setAvengeWindowObserver` pattern), but the engine ALREADY stamps everything this needs onto the
 * artifacts it emits:
 *
 *   · every combat event carries `key: 'factory:<do>:<on>'` + `srcCard` (the Choreographer's effect-context
 *     stamp in `simulate()`'s `withEffect`), plus `avenge:true` inside Avenge windows and `questTrigger`
 *     events naming every combat-mod flag that fired;
 *   · every recruit-side `SourceTriggerEvent` carries `policyKey` (`factory:<do>:<on>` via `beatIdentity`),
 *     `trigger`, `family` and `parentId` (nesting), and its consequences carry `ZoneTargetRef` targets.
 *
 * So this module DERIVES keys purely from (before, action, after, presentation events, combat log) — an
 * observation that provably cannot change gameplay because it runs after the fact on data the engine
 * already emits. The existing determinism/golden/presentation-parity suites are the proof the sources
 * themselves are gameplay-inert.
 *
 * Key families (each §9.1 bullet → one prefix):
 *   factory:<do>                        effect factory executed (either phase)
 *   trigger:<on>                        trigger family emitted (the `:on` half of a factory stamp, plus
 *                                       recruit `trigger` fields)
 *   guard:align:<armed|gated>           an alignment-gated effect fired / stayed gated through a combat
 *   guard:avenge:<paid|silent>          an avenge threshold paid out / observed deaths without paying
 *   combat-mod:<flag>                   a quest/rune combat mod was consumed (`questTrigger` flags)
 *   hero-power:<family>                 an accepted `heroPower` action, keyed by activation family
 *   rune-reward:<kind>                  a rune joined `ownedRunes` (multi rewards emit each sub-kind)
 *   copy:<do> / copy-mode:gild          a copy-family factory executed / a gilding (triple) happened
 *   snapshot:<boundary>                 a snapshot boundary crossed (recruit-to-combat, settle,
 *                                       serialize-roundtrip — the driver declares the roundtrip one)
 *   target:<zone|combat>:<arity>        where an effect's consequences landed and at what cardinality
 *   chain-depth:<bucket>                deepest observed trigger nesting (recruit `parentId` chains;
 *                                       combat distinct-factories-per-step as the proxy)
 *   action:<type>                       the accepted action itself (cheap, and it keys the boundary sweep)
 *
 * Determinism: the derivation is a pure function of its inputs; the emitted set is returned SORTED so any
 * consumer that serializes it is byte-stable.
 */
import type { CombatEvent, GamePresentationEvent } from '@game/core';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import type { Action, RunState } from '../state';
import { getHero } from '../heroes';
import { POWER_FAMILY } from './heroPowerFamilies';

export interface CoverageObservation {
  before: RunState;
  after: RunState;
  /** The dispatched action, when one was dispatched (undefined = pure state assertion). */
  action?: Action;
  /** Recruit-side presentation events captured by `reduceWithPresentation(…, true)`. */
  events: readonly GamePresentationEvent[];
  /** The combat log, when the action resolved a fight (`after.lastCombat.events`). */
  combatLog?: readonly CombatEvent[];
  /** Boundaries only the DRIVER can see (e.g. 'serialize-roundtrip' when it round-tripped the state). */
  extraBoundaries?: readonly string[];
}

/** Arity bucket for target cardinality — coarse on purpose (the exact count is magnitude-lane business). */
const arity = (n: number): string => (n <= 1 ? 'one' : n <= 3 ? 'few' : 'many');

/** Chain-depth bucket. */
const depthBucket = (d: number): string => (d <= 0 ? '0' : d === 1 ? '1' : d === 2 ? '2' : '3plus');

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/** `factory:<do>:<on>` → { do, on } (either half may be missing on malformed stamps — skip those). */
function splitFactoryKey(key: string): { do: string; on: string } | null {
  if (!key.startsWith('factory:')) return null;
  const rest = key.slice('factory:'.length);
  const cut = rest.lastIndexOf(':');
  if (cut <= 0) return null;
  return { do: rest.slice(0, cut), on: rest.slice(cut + 1) };
}

/** Rune reward kinds, `multi` flattened — each sub-reward is its own reachable behaviour. */
function rewardKinds(reward: unknown): string[] {
  if (!isRecord(reward) || typeof reward.kind !== 'string') return [];
  if (reward.kind === 'multi' && Array.isArray(reward.rewards)) {
    return ['multi', ...reward.rewards.flatMap((r) => rewardKinds(r))];
  }
  return [reward.kind];
}

/** Compute the semantic coverage keys one executed step reached. Pure; returns a SORTED array. */
export function coverageKeysFor(obs: CoverageObservation): string[] {
  const keys = new Set<string>();
  const { before, after, action } = obs;
  const changed = before !== after; // reducer returns the same reference on refusal
  const combat = obs.combatLog ?? [];

  if (action && changed) keys.add(`action:${action.type}`);

  // ── Factory + trigger families, from the engine's own stamps ────────────────────────────────────────────
  const firedFactories = new Set<string>();
  for (const e of combat) {
    const k = (e as { key?: string }).key;
    const parts = k ? splitFactoryKey(k) : null;
    if (parts) {
      keys.add(`factory:${parts.do}`);
      keys.add(`trigger:${parts.on}`);
      firedFactories.add(parts.do);
      if (/copy/i.test(parts.do)) keys.add(`copy:${parts.do}`);
    }
  }
  for (const e of obs.events) {
    if (e.type !== 'sourceTrigger') continue;
    if (typeof e.trigger === 'string' && e.trigger.length > 0) keys.add(`trigger:${e.trigger}`);
    const parts = e.policyKey ? splitFactoryKey(e.policyKey) : null;
    if (parts) {
      keys.add(`factory:${parts.do}`);
      firedFactories.add(parts.do);
      if (/copy/i.test(parts.do)) keys.add(`copy:${parts.do}`);
    }
  }

  // ── Guard branches (observable gates only — honest coverage, not invented instrumentation) ─────────────
  // Alignment gate: a fielded effect declaring `align` either fired (its factory stamp appeared) or stayed
  // gated through the whole resolution. Only meaningful when something actually resolved.
  if (combat.length > 0 || obs.events.length > 0) {
    for (const c of before.board) {
      for (const eff of CARD_INDEX[c.cardId]?.effects ?? []) {
        if (!eff.align) continue;
        keys.add(firedFactories.has(eff.do) ? 'guard:align:armed' : 'guard:align:gated');
      }
    }
  }
  // Avenge threshold: paid (an avenge-stamped payoff event exists) vs silent (an avenge watcher was fielded,
  // deaths happened, nothing paid — the below-threshold branch).
  if (combat.length > 0) {
    const paid = combat.some((e) => (e as { avenge?: true }).avenge && e.type !== 'questTrigger');
    const watcher = before.board.some((c) => (CARD_INDEX[c.cardId]?.effects ?? []).some((f) => f.on === 'avenge'));
    const deaths = combat.some((e) => e.type === 'death');
    if (paid) keys.add('guard:avenge:paid');
    else if (watcher && deaths) keys.add('guard:avenge:silent');
  }

  // ── Combat-mod consumption — the engine names every consumed flag on a `questTrigger` event ────────────
  for (const e of combat) {
    if (e.type === 'questTrigger' && typeof e.flag === 'string') keys.add(`combat-mod:${e.flag}`);
  }

  // ── Hero-power activation family, on an ACCEPTED heroPower action ──────────────────────────────────────
  if (action?.type === 'heroPower' && changed) {
    const kind = getHero(after.heroId).power.kind;
    keys.add(`hero-power:${POWER_FAMILY[kind] ?? kind}`);
  }

  // ── Rune rewards — a rune newly held is its reward kind's behaviour entering the run ───────────────────
  const heldBefore = new Set(before.ownedRunes ?? []);
  for (const id of after.ownedRunes ?? []) {
    if (heldBefore.has(id)) { heldBefore.delete(id); continue; }
    for (const kind of rewardKinds(RUNE_INDEX[id]?.reward)) keys.add(`rune-reward:${kind}`);
  }

  // ── Copy mode: gilding — a body that was plain is now golden (a triple combined) ───────────────────────
  if (changed) {
    const goldenCount = (s: RunState): number => [...s.board, ...s.hand].filter((c) => c.golden).length;
    if (goldenCount(after) > goldenCount(before)) keys.add('copy-mode:gild');
  }

  // ── Snapshot boundaries ────────────────────────────────────────────────────────────────────────────────
  if (action?.type === 'faceOmen' && changed && after.lastCombat !== before.lastCombat) keys.add('snapshot:recruit-to-combat');
  if ((action?.type === 'settleCombat' || action?.type === 'resolveCombat') && changed) keys.add('snapshot:settle');
  for (const b of obs.extraBoundaries ?? []) keys.add(`snapshot:${b}`);

  // ── Target selectors: where consequences landed + at what cardinality, per source trigger ──────────────
  const perSource = new Map<string, { zones: Set<string>; n: number }>();
  for (const e of obs.events) {
    if (e.type === 'sourceTrigger') continue;
    const target = (e as { target?: { zone?: string } }).target;
    if (!target?.zone) continue;
    const parent = (e as { parentId?: string }).parentId ?? '(root)';
    const slot = perSource.get(parent) ?? { zones: new Set<string>(), n: 0 };
    slot.zones.add(target.zone);
    slot.n++;
    perSource.set(parent, slot);
  }
  for (const { zones, n } of perSource.values()) {
    for (const z of zones) keys.add(`target:${z}:${arity(n)}`);
  }
  // Combat: recipients per effect fire — same-step events sharing one factory stamp are one fire's landings.
  const perFire = new Map<string, number>();
  for (const e of combat) {
    const k = (e as { key?: string; step?: number }).key;
    const step = (e as { step?: number }).step;
    if (!k || step === undefined) continue;
    if (!('target' in e)) continue;
    const fire = `${step}|${k}`;
    perFire.set(fire, (perFire.get(fire) ?? 0) + 1);
  }
  for (const n of perFire.values()) keys.add(`target:combat:${arity(n)}`);

  // ── Chain depth ────────────────────────────────────────────────────────────────────────────────────────
  // Recruit: real nesting via `parentId` chains on source triggers.
  const triggers = new Map<string, { parentId?: string }>();
  for (const e of obs.events) if (e.type === 'sourceTrigger') triggers.set(e.id, e);
  let maxDepth = 0;
  for (const [id] of triggers) {
    let d = 0;
    let cur: { parentId?: string } | undefined = triggers.get(id);
    while (cur?.parentId && triggers.has(cur.parentId) && d < 16) { d++; cur = triggers.get(cur.parentId); }
    if (d > maxDepth) maxDepth = d;
  }
  // Combat proxy: distinct factory stamps resolving inside ONE atomic step = a same-moment trigger chain.
  const perStep = new Map<number, Set<string>>();
  for (const e of combat) {
    const k = (e as { key?: string }).key;
    const step = (e as { step?: number }).step;
    if (!k || step === undefined) continue;
    const set = perStep.get(step) ?? new Set<string>();
    set.add(k);
    perStep.set(step, set);
  }
  for (const set of perStep.values()) if (set.size - 1 > maxDepth) maxDepth = set.size - 1;
  if (obs.events.length > 0 || combat.length > 0) keys.add(`chain-depth:${depthBucket(maxDepth)}`);

  return [...keys].sort();
}
