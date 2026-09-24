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
 * A RUNE IS A CASTER TOO (owner ruling 2026-09-24): *"spells cast from runes and cards should use the spell
 * effects, like gilded ledger should show the animations we build for the spells when it is cast. they can stem
 * from the rune if there needs to be a source position."* A rune's cast plays the spell's own effect exactly as a
 * card's does, with `source` (and `cursor`) on the rune's node on the rune rail (`runeNodeCentre`, the anchor the
 * cast preview uses), in every phase: the Shop (`castFx` records), End of Turn (the `spellResolved` presenter /
 * `EotStepFx.casts`) and combat (an `sc` stamped `rune`, player side only: an enemy's runes are not on screen,
 * so its cast stays on the body it resolved through). Its buffs carry the spell AND the rune
 * (`BuffFxEvent.sourceRuneId`, `statsChanged.castByRune`), so `playRuneCastBuffFx` gives each one the spell's
 * per-buff row (an Ale's volley, Dragonflame's column) from the node, or, for an unbound spell, the stock
 * tendril trail from the node instead of nothing.
 *
 * ONE SOUND PER BURST (owner 2026-09-24): *"make it so if 2 fatecarvers are down, or the effect is cast twice or
 * something, that it only plays the sound effect one time. give it the same behavior as the undead aura sfx
 * timing."* A play of the same def within `spellCastSfxGapMs` (Buff tuner, default 120 ms) of the last one that
 * sounded plays its visuals with its Sound layers dropped (`muteSound`), exactly as `sfx.undeadAura` drops a
 * second aura cue inside `undeadAuraSfxGapMs`. Keyed by the DEF: the same sound twice is what collapses; two
 * different spells each ring. Every phase and every source, the player's own cast included (`recruitCues.ts`).
 *
 * Fire-and-forget, one-shot: never blocks a beat, never loops.
 */
import type { CombatSpellCast } from '../choreo/channels/castPreview';
import { spellCastFanOutFor, spellCastFxFor } from '../choreo/bindings';
import { getBuffFxConfig } from '../buffFxConfig';
import { fireBuffFx } from '../buffFxRender';
import { sfx } from '../sfx';
import { anchorsForUnits } from './combatAnchors';
import type { FxAnchors } from './anchors';
import { canPlayDefs, playDef } from './playDef';

type Point = { x: number; y: number };

function viewportCentre(): Point {
  return typeof window === 'undefined' ? { x: 0, y: 0 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** When each spell-cast def last SOUNDED. Module-scoped like `sfx.ts`'s `undeadAuraLastAt`. */
const lastSoundAt = new Map<string, number>();

/**
 * May this play of `defId` sound? False when the same def sounded less than `spellCastSfxGapMs` ago, the Undead
 * Aura rule (`sfx.undeadAura`): the dropped play does NOT move the clock, so a steady stream slower than the gap
 * still rings each time, and only a burst inside the gap collapses to one sound.
 */
export function spellCastSoundAllowed(defId: string, now: number = nowMs()): boolean {
  const last = lastSoundAt.get(defId);
  if (last !== undefined && now - last < getBuffFxConfig().spellCastSfxGapMs) return false;
  lastSoundAt.set(defId, now);
  return true;
}

/** Forget every sound time (tests, a fresh session). */
export function resetSpellCastSoundGate(): void { lastSoundAt.clear(); }

/**
 * The centre of a rune's node on the rune rail (`.questbadges .runebadge[data-source-id]`, the anchor the cast
 * preview uses), or null when it is not on screen. The rail is part of the StatusBar, so it is up in the Shop,
 * at End of Turn and in combat alike.
 */
export function runeNodeCentre(runeId: string | null | undefined): Point | null {
  if (!runeId || typeof document === 'undefined') return null;
  const el = document.querySelector(`.questbadges .runebadge[data-source-id="${runeId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // unmounted / display:none: nothing to stem from
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Play `spellId`'s own cast effect once. False when the spell has no card-level cast binding (or defs can't
 *  play yet), the common case, and free: one map read. `runeId` names the rune that cast it: its node becomes
 *  the effect's `source` / `cursor` when it is on screen. */
export function playSpellCastFx(spellId: string, where: { anchors?: FxAnchors | null; uid?: string | null; runeId?: string | null } = {}): boolean {
  const binding = spellCastFxFor(spellId);
  if (!binding || !canPlayDefs()) return false;
  const camera = viewportCentre();
  let base: FxAnchors = where.anchors ?? { source: camera, target: camera, cursor: camera };
  const node = runeNodeCentre(where.runeId);
  if (node) base = { ...base, source: node, cursor: node };
  const uid = where.uid ?? null;
  const sound = spellCastSoundAllowed(binding.def);
  playDef(binding.def, { ...base, camera }, { uids: { source: uid, target: uid }, gain: binding.gain, ...(sound ? {} : { muteSound: true }) });
  if (sound && binding.sfx !== undefined) sfx[binding.sfx]?.();
  return true;
}

/** The sim's per-action cast records (`RunState.castFx` / `EotStepFx.casts`) for one phase, each one cast. A
 *  rune's record stems its effect from the rune's node. */
export function playRecordedCastFx(
  records: readonly { spellId: string; phase?: 'recruit' | 'endOfTurn'; source?: { kind: string; id?: string } }[] | undefined,
  phase?: 'recruit' | 'endOfTurn',
): number {
  let played = 0;
  for (const r of records ?? []) {
    if (phase !== undefined && r.phase !== undefined && r.phase !== phase) continue;
    if (playSpellCastFx(r.spellId, { runeId: r.source?.kind === 'rune' ? r.source.id : null })) played++;
  }
  return played;
}

/** A combat moment's casts (`spellCastsIn`): one play per cast, anchored on the caster when it is on screen, and
 *  stemming from the rune's node when a PLAYER rune cast it (Rune of Spellhide). */
export function playCombatSpellCastFx(casts: readonly CombatSpellCast[]): number {
  let played = 0;
  for (const c of casts) {
    if (spellCastFxFor(c.spellId) === null) continue; // skip the DOM read for the (usual) unbound spell
    const runeId = c.rune && c.side !== 'enemy' ? c.rune : null;
    if (playSpellCastFx(c.spellId, { anchors: anchorsForUnits(c.source, c.source), uid: c.source, runeId })) played++;
  }
  return played;
}

/**
 * ONE BUFF A RUNE'S CAST LANDED, stemming from the rune's node. Returns true when it drew something:
 *
 *   - a spell whose row fans out per buff (`spellCastFanOutFor`) plays that row on this buff: `buffed` travels
 *     node to minion (an Ale's volley), `buffedOn` plays on the minion (Dragonflame's column);
 *   - any other spell draws the stock tendril trail from the node (it had no source before, so it drew nothing).
 *
 * A spell with a single cast effect (Growth) never reaches here: its effect replaces the trail
 * (`castFxReplacesTendril`), played once per cast by `playSpellCastFx`.
 */
export function playRuneCastBuffFx(o: { runeId: string; spellId?: string; target: Point; targetUid: string; index?: number }): boolean {
  const node = runeNodeCentre(o.runeId);
  const fan = spellCastFanOutFor(o.spellId);
  if (fan) {
    if (!canPlayDefs()) return false;
    const camera = viewportCentre();
    const from = fan.fanOut === 'buffedOn' ? o.target : (node ?? o.target);
    const sound = spellCastSoundAllowed(fan.def);
    playDef(fan.def, { source: from, target: o.target, cursor: from, camera }, {
      uids: { source: null, target: o.targetUid }, index: o.index ?? 0, gain: fan.gain, ...(sound ? {} : { muteSound: true }),
    });
    if (sound && fan.sfx !== undefined) sfx[fan.sfx]?.();
    return true;
  }
  if (!node) return false;
  fireBuffFx({ source: node, target: o.target, cardId: o.spellId ?? '', tribe: 'neutral', sourceless: false, uids: { source: null, target: o.targetUid } });
  return true;
}
