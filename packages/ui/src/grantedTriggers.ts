/**
 * GRANTED TRIGGERS for the portrait medallion (owner 2026-10-15, R-MEDAL-GRANTED-01: "hum with the echo whisper on it
 * should get the echo badge, same for other minions that dont have a badge that takes precedence").
 *
 * The medallion used to resolve from the PRINTED card alone, so a body that gained a trigger at runtime (a Seed's Drake
 * Pup Echo, kept for good by Hum; a Gravetwin's copied Echo; an Echo Mimic / Grave Body / rune graft; the Auctioneer's
 * Rally) kept a blank or stale gem. These helpers list the triggers an INSTANCE carries beyond its print, for every
 * surface: a Shop / hand / board / stored body (`grantedTriggersOfBoard`) and a combat / Versus snapshot body
 * (`grantedTriggersOfSnapshot`). `resolveMech` folds them in under the SAME precedence as the printed ones, so a
 * printed badge that outranks the grant keeps the gem.
 *
 * Both return a referentially STABLE array (one shared, frozen array per shape) or `undefined`,
 * so the memoized `Unit` / `Card` see no prop churn: perf-neutral.
 */
import type { EffectDef, MinionSnapshot } from '@game/core';

/** One granted trigger: just what the medallion detectors read. */
export interface GrantedTrigger { on: EffectDef['on']; do: EffectDef['do'] }

/** A Seed stack's shape (`SEED_ECHO_EFFECT` in core): an Echo. */
const SEED_ECHO: GrantedTrigger = { on: 'onDeath', do: 'deathrattleSummon' };
/** The Auctioneer × War graft: "Rally: trigger this minion's Shout". */
const RALLY_SHOUT: GrantedTrigger = { on: 'onAttack', do: 'rallyTriggerOwnShout' };

/** The per-instance fields a Shop / stored body carries grants on (BoardCard and BoardMinion both satisfy it). */
export interface GrantCarrier {
  copiedEcho?: readonly EffectDef[];
  grantedEffects?: readonly EffectDef[];
  seedEchoes?: number;
  seedEchoesTemp?: number;
  echoStripped?: boolean;
}

// Shared arrays for the common shapes, so two bodies with the same grant hand React the same reference.
const shared = new Map<string, readonly GrantedTrigger[]>();
function canonical(list: GrantedTrigger[]): readonly GrantedTrigger[] | undefined {
  if (list.length === 0) return undefined;
  const key = list.map((g) => `${g.on}:${g.do}`).join('|');
  let hit = shared.get(key);
  if (!hit) { hit = Object.freeze(list); shared.set(key, hit); }
  return hit;
}

function push(out: GrantedTrigger[], on: EffectDef['on'], d: EffectDef['do']): void {
  if (!out.some((g) => g.on === on && g.do === d)) out.push({ on, do: d });
}

/** The triggers a Shop / hand / board / stored body carries beyond its print. Live by construction: a Whisper's
 *  temporary Seed stack (`seedEchoesTemp`) is stripped by the sim at the next turn, the body object changes, and the
 *  badge drops with it. */
export function grantedTriggersOfBoard(inst: GrantCarrier): readonly GrantedTrigger[] | undefined {
  if (!inst.copiedEcho?.length && !inst.grantedEffects?.length && !inst.seedEchoes && !inst.seedEchoesTemp) return undefined;
  const out: GrantedTrigger[] = [];
  for (const e of [...(inst.copiedEcho ?? []), ...(inst.grantedEffects ?? [])]) {
    if (inst.echoStripped && e.on === 'onDeath') continue; // an Echo-stripped copy fights without any Echo
    push(out, e.on, e.do);
  }
  if (!inst.echoStripped && ((inst.seedEchoes ?? 0) + (inst.seedEchoesTemp ?? 0)) > 0) push(out, SEED_ECHO.on, SEED_ECHO.do);
  return canonical(out);
}

/** The triggers a combat / Versus snapshot body carries beyond its print (the snapshot's `grantedTriggers`, its Seed
 *  stacks and the Auctioneer's Rally). Accepts a `UnitFrame` too (it copies the same fields off the snapshot). The
 *  result is one shared array per shape, so a per-beat frame copy never churns the memoized `Unit`. */
export function grantedTriggersOfSnapshot(
  s: Pick<MinionSnapshot, 'grantedTriggers' | 'seedEchoes'> & { grantedRallyShout?: boolean },
): readonly GrantedTrigger[] | undefined {
  if (!s.grantedTriggers?.length && !s.seedEchoes && !s.grantedRallyShout) return undefined;
  const out: GrantedTrigger[] = [];
  for (const g of s.grantedTriggers ?? []) push(out, g.on, g.do);
  if (s.seedEchoes) push(out, SEED_ECHO.on, SEED_ECHO.do);
  if (s.grantedRallyShout) push(out, RALLY_SHOUT.on, RALLY_SHOUT.do);
  return canonical(out);
}
