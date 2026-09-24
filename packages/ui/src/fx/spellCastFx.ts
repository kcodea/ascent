/**
 * A SPELL'S OWN CAST EFFECT, IN EVERY PHASE AND FROM EVERY SOURCE (owner ask 2026-09-24):
 *
 *   *"i added a growth effect for whenever growth is cast, by any means. player,rune,minion etc and any phase.
 *   recruit, combat, end of turn whatever it may be."*
 *
 * ONE binding (the spell's card-level `spellCast` row in `choreo/bindings.json`, read through `spellCastFxFor`)
 * and ONE play (`playSpellCastFx` below), reached from every place a spell resolves:
 *
 *   · the player's cast from hand / Shop — the shop cue runner's `runSpellCastFire` resolves the same row;
 *   · a rune's or a minion's cast in the Shop — `playRecordedCastFx` off the sim's per-action `castFx` records
 *     (Recruit.tsx's `castFxSeq` watcher);
 *   · an End-of-Turn cast — the `spellResolved` consequence presenter (authoritative path) and `EotStepFx.casts`
 *     (legacy path), on the cast's own beat;
 *   · a combat cast — the `spellCastFx` cue in `choreo/score.ts`, once per `sc` event stamped with `spellId`
 *     (every combat cast announces itself: `resolveCombatSpellCast`, `castNamedSpellInCombat`, the arena's
 *     `castRepeat`), on the replay clock.
 *
 * Deliberately INDEPENDENT of the cast preview (`castPreview.ts`): the preview is a per-source, owner-gated
 * card float; this is the spell's own effect and plays on every cast.
 *
 * ANCHOR: `camera` is always the viewport centre (the workbench's camera, so an authored board-wide def such as
 * `growth-effect` lands where it was authored). `source`/`target` are the caster's body when one is on screen
 * (combat), else the viewport centre too, so a def anchored on `source` still has a sane point.
 *
 * Fire-and-forget, one-shot: never blocks a beat, never loops.
 */
import type { CombatSpellCast } from '../choreo/channels/castPreview';
import { spellCastFxFor } from '../choreo/bindings';
import { sfx } from '../sfx';
import { anchorsForUnits } from './combatAnchors';
import type { FxAnchors } from './anchors';
import { canPlayDefs, playDef } from './playDef';

function viewportCentre(): { x: number; y: number } {
  return typeof window === 'undefined' ? { x: 0, y: 0 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** Play `spellId`'s own cast effect once. False when the spell has no card-level cast binding (or defs can't
 *  play yet) — the common case, and free: one map read. */
export function playSpellCastFx(spellId: string, where: { anchors?: FxAnchors | null; uid?: string | null } = {}): boolean {
  const binding = spellCastFxFor(spellId);
  if (!binding || !canPlayDefs()) return false;
  const camera = viewportCentre();
  const base: FxAnchors = where.anchors ?? { source: camera, target: camera, cursor: camera };
  const uid = where.uid ?? null;
  playDef(binding.def, { ...base, camera }, { uids: { source: uid, target: uid }, gain: binding.gain });
  if (binding.sfx !== undefined) sfx[binding.sfx]?.();
  return true;
}

/** The sim's per-action cast records (`RunState.castFx` / `EotStepFx.casts`) for one phase — each is one cast. */
export function playRecordedCastFx(
  records: readonly { spellId: string; phase?: 'recruit' | 'endOfTurn' }[] | undefined,
  phase?: 'recruit' | 'endOfTurn',
): number {
  let played = 0;
  for (const r of records ?? []) {
    if (phase !== undefined && r.phase !== undefined && r.phase !== phase) continue;
    if (playSpellCastFx(r.spellId)) played++;
  }
  return played;
}

/** A combat moment's casts (`spellCastsIn`): one play per cast, anchored on the caster when it is on screen. */
export function playCombatSpellCastFx(casts: readonly CombatSpellCast[]): number {
  let played = 0;
  for (const c of casts) {
    if (spellCastFxFor(c.spellId) === null) continue; // skip the DOM read for the (usual) unbound spell
    if (playSpellCastFx(c.spellId, { anchors: anchorsForUnits(c.source, c.source), uid: c.source })) played++;
  }
  return played;
}
