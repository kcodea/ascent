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
import { CARD_INDEX } from '@game/content';
import { isStatGrantingSpell } from '@game/sim';
import type { CombatSpellCast } from '../choreo/channels/castPreview';
import { spellCastFanOutFor, spellCastFxFor, type FxBinding } from '../choreo/bindings';
import { getBuffFxConfig } from '../buffFxConfig';
import { fireBuffFx } from '../buffFxRender';
import { sfx } from '../sfx';
import { anchorsForUnits } from './combatAnchors';
import type { FxAnchors } from './anchors';
import { canPlayDefs, playDef } from './playDef';
import { afterMs, playRuneCastFlourish, runeCastRepeatGapMs, runeCastTrailLeadMs } from './runeCastFlourish';
import { getCastPreviewConfig, runeCastFlourishLook } from '../castPreviewConfig';

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

/**
 * THE GENERIC SPELL-CAST SOUND (`sfx.castSpell`), for EVERY cast, whoever cast it (owner 2026-09-24: "all spell
 * animations and sfx should be wired to play whenever a spell or minion is cast/played from any source"). It used to
 * ring only for the player's own cast from hand; a rune's cast (the flourish) and a minion's (the cast preview) were
 * silent. Gated per SPELL by the same burst gap as the spell's own effect (`spellCastSoundAllowed`, 120 ms): a rune
 * casting it twice in one moment, two Fatecarvers, or a player cast plus the repeat rune's share in the same action
 * ring once. Returns whether it rang.
 */
export function playGenericCastSound(spellId: string): boolean {
  if (!spellCastSoundAllowed(`cast:${spellId}`)) return false;
  sfx.castSpell();
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

/** The Shop selector for a MINION offer: not a spell / Ruby card, not a scouted foe's ghost row. */
const SHOP_MINION_SEL = '[data-zone="tavern"] .row .card[data-uid]:not(.spellcard):not(.rubycard):not([data-uid^="sbfoe-"])';

/**
 * WHERE A SHOP-TARGETED SPELL LANDS (owner 2026-09-24: *"picnic should get the "shop buff shout" animation"*).
 * Picnic buffs the RIGHT-most Shop minion (`spellBuffShopRightmost`, the sim's `rightmostShopMinion`: the last
 * offer that is neither a spell nor a Ruby), so its cast effect's `target` is that card, not the release point or
 * the viewport centre. Keyed on the EFFECT, so any spell that shares it lands the same way. Null for every other
 * spell, and when no Shop minion is on screen (combat): the caller keeps its own anchor.
 */
export function spellCastShopTarget(spellId: string | null | undefined): { point: Point; uid: string } | null {
  if (!spellId || typeof document === 'undefined') return null;
  const def = CARD_INDEX[spellId];
  if (!def?.effects?.some((e) => e.do === 'spellBuffShopRightmost')) return null;
  let best: { point: Point; uid: string } | null = null;
  let bestX = -Infinity;
  for (const el of document.querySelectorAll<HTMLElement>(SHOP_MINION_SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const x = r.left + r.width / 2;
    if (x >= bestX) { bestX = x; best = { point: { x, y: r.top + r.height / 2 }, uid: el.getAttribute('data-uid') ?? '' }; }
  }
  return best;
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
  // A Shop-targeted spell (Picnic) lands ON the Shop minion it buffed, whoever cast it.
  const shop = spellCastShopTarget(spellId);
  if (shop) base = { ...base, target: shop.point };
  const sound = spellCastSoundAllowed(binding.def);
  playDef(binding.def, { ...base, camera }, { uids: { source: uid, target: shop?.uid ?? uid }, gain: binding.gain, ...(sound ? {} : { muteSound: true }) });
  if (sound && binding.sfx !== undefined) sfx[binding.sfx]?.();
  return true;
}

/**
 * A PER-BUFF ROW WITH NO BUFFS TO FAN OUT OVER (owner 2026-09-24): Golden Ale gains Gold and Reinforcing Ale gets a
 * minion, so their `buffed` row (`coin-ale`, `reinforcing-ale`) has no buffed minion to travel to. The player's cast
 * plays it once at the release point (`runSpellCastFire`'s single fire); a rune's or a minion's cast now plays it
 * once AT THE SOURCE (the rune's node, the caster's body) instead of nothing. Keyed on the spell granting no stats
 * (`isStatGrantingSpell`), so a stat spell's row keeps its per-buff play and never doubles here.
 */
export function sourceOnlyCastRow(spellId: string | null | undefined): FxBinding | null {
  const fan = spellCastFanOutFor(spellId);
  if (!fan || !spellId || isStatGrantingSpell(CARD_INDEX[spellId])) return null;
  return fan;
}

/** Play a no-buff row (`sourceOnlyCastRow`) once at `at` (the viewport centre when null). False when the spell has
 *  no such row or defs cannot play. Sound through the burst gate, like every spell-cast play. */
export function playCastAtSource(spellId: string, at: Point | null, uid: string | null = null): boolean {
  const row = sourceOnlyCastRow(spellId);
  if (!row || !canPlayDefs()) return false;
  const camera = viewportCentre();
  const p = at ?? camera;
  const sound = spellCastSoundAllowed(row.def);
  playDef(row.def, { source: p, target: p, cursor: p, camera }, { uids: { source: uid, target: uid }, gain: row.gain, ...(sound ? {} : { muteSound: true }) });
  if (sound && row.sfx !== undefined) sfx[row.sfx]?.();
  return true;
}

/** The resting centre of a board minion by uid, or null (not on screen). */
function unitCentre(uid: string | null | undefined): Point | null {
  if (!uid || typeof document === 'undefined') return null;
  const el = document.querySelector(`[data-uid="${uid}"]`);
  const r = el?.getBoundingClientRect();
  return r && (r.width > 0 || r.height > 0) ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

/** A MINION'S cast, the spell's own effect: the single play (`playSpellCastFx`), or a no-buff row at its body. */
export function playMinionSpellCastFx(spellId: string, uid: string | null | undefined): boolean {
  if (playSpellCastFx(spellId)) return true;
  return playCastAtSource(spellId, unitCentre(uid), uid ?? null);
}

/**
 * ONE CAST BY A RUNE, the whole presentation (owner 2026-09-24: "the runes that repeat casts should use the rune-cast
 * visual. can we do anything to add a bit of flair to this? … nothing crazy"): the rune flourish on its node
 * (`fx/runeCastFlourish.ts`: badge pulse + glyph flash, and a mote out to where a single-play effect lands), then the
 * spell's own effect once the mote arrives, stemming from the node. Fires the flourish for EVERY rune cast, bound
 * spell or not (an unbound spell's trails leave the node on their own, a short lead after the flash). `delayMs`
 * staggers a second cast by the same rune in one moment. Returns whether a spell effect will play (the
 * `playSpellCastFx` contract); with the flourish off it plays synchronously, exactly as before.
 */
export function playRuneSpellCastFx(
  spellId: string,
  runeId: string,
  where: { anchors?: FxAnchors | null; uid?: string | null } = {},
  delayMs = 0,
): boolean {
  const single = spellCastFxFor(spellId);
  const atSource = single ? null : sourceOnlyCastRow(spellId);
  const willPlay = (single !== null || atSource !== null) && canPlayDefs();
  afterMs(delayMs, () => {
    const aim = single ? (spellCastShopTarget(spellId)?.point ?? where.anchors?.target ?? viewportCentre()) : null;
    const f = playRuneCastFlourish(runeId, aim);
    if (single) afterMs(f.mote ? f.leadMs : 0, () => { playSpellCastFx(spellId, { ...where, runeId }); });
    // A no-buff row (Golden / Reinforcing Ale) plays once ON the node, released a lead after the flash like a trail.
    else if (atSource) afterMs(runeCastTrailLeadMs(), () => { playCastAtSource(spellId, runeNodeCentre(runeId) ?? where.anchors?.source ?? null); });
  });
  return willPlay;
}

/** The gap between two casts by the SAME rune in one moment (0 while the flourish is off: they land together). */
function repeatGap(): number {
  return runeCastFlourishLook(getCastPreviewConfig()).on ? runeCastRepeatGapMs() : 0;
}

/** The sim's per-action cast records (`RunState.castFx` / `EotStepFx.casts`) for one phase, each one cast. A
 *  rune's record flourishes on the rune's node and stems its effect from there (`playRuneSpellCastFx`). */
export function playRecordedCastFx(
  records: readonly { spellId: string; phase?: 'recruit' | 'endOfTurn'; source?: { kind: string; id?: string } }[] | undefined,
  phase?: 'recruit' | 'endOfTurn',
): number {
  let played = 0;
  const perRune = new Map<string, number>();
  const gap = repeatGap();
  for (const r of records ?? []) {
    if (phase !== undefined && r.phase !== undefined && r.phase !== phase) continue;
    playGenericCastSound(r.spellId); // every rune / minion cast rings the cast sound too (burst-gated per spell)
    const runeId = r.source?.kind === 'rune' ? r.source.id : undefined;
    if (runeId) {
      const k = perRune.get(runeId) ?? 0;
      perRune.set(runeId, k + 1);
      if (playRuneSpellCastFx(r.spellId, runeId, {}, k * gap)) played++;
    } else if (r.source?.kind === 'minion' ? playMinionSpellCastFx(r.spellId, (r.source as { uid?: string }).uid) : playSpellCastFx(r.spellId)) played++;
  }
  return played;
}

/** A combat moment's casts (`spellCastsIn`): one play per cast, anchored on the caster when it is on screen, and
 *  stemming from the rune's node when a PLAYER rune cast it (Rune of Spellhide). */
export function playCombatSpellCastFx(casts: readonly CombatSpellCast[]): number {
  let played = 0;
  const perRune = new Map<string, number>();
  const gap = repeatGap();
  for (const c of casts) {
    const runeId = c.rune && c.side !== 'enemy' ? c.rune : null;
    if (runeId) {
      // A PLAYER rune's cast flourishes on its node whether or not the spell is bound (owner 2026-09-24).
      const k = perRune.get(runeId) ?? 0;
      perRune.set(runeId, k + 1);
      const bound = spellCastFxFor(c.spellId) !== null;
      if (playRuneSpellCastFx(c.spellId, runeId, bound ? { anchors: anchorsForUnits(c.source, c.source), uid: c.source } : {}, k * gap)) played++;
      continue;
    }
    if (spellCastFxFor(c.spellId) === null) {
      // A no-buff row (Golden / Reinforcing Ale) plays once on the caster; everything else unbound is skipped here.
      if (sourceOnlyCastRow(c.spellId) && playCastAtSource(c.spellId, anchorsForUnits(c.source, c.source)?.source ?? null, c.source)) played++;
      continue;
    }
    if (playSpellCastFx(c.spellId, { anchors: anchorsForUnits(c.source, c.source), uid: c.source })) played++;
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
  // The rune RELEASES the spell (owner 2026-09-24, the rune cast flourish): its trails leave a short lead after the
  // glyph flash on the node (`runeFlourishLeadMs`; 0 while the flourish is off, i.e. right away as before).
  const lead = runeCastTrailLeadMs();
  if (playCastFanOutBuffFx({ spellId: o.spellId, from: node, target: o.target, targetUid: o.targetUid, index: o.index, delayMs: lead })) return true;
  if (spellCastFanOutFor(o.spellId)) return false; // a fan-out spell whose defs cannot play yet: nothing to draw
  if (!node) return false;
  afterMs(lead, () => {
    fireBuffFx({ source: node, target: o.target, cardId: o.spellId ?? '', tribe: 'neutral', sourceless: false, uids: { source: null, target: o.targetUid } });
  });
  return true;
}

/**
 * ONE BUFF A SPELL'S PER-BUFF ROW DRAWS, whoever cast it (owner 2026-09-24: *"all spell animations and sfx should be
 * wired to play whenever a spell or minion is cast/played from any source"*). THE shared per-buff play for every
 * non-player caster: a rune (`playRuneCastBuffFx`, `from` = its node), a minion in the Shop or at End of Turn
 * (`from` = the caster's body, the Mage-Pup that poured the Ale), and a caster that has left the board (`from` null:
 * a `buffed` volley then lands on the minion itself). `buffedOn` (Dragonflame's column) plays ON the minion whatever
 * the source. The row's sound rings once per burst (`spellCastSoundAllowed`, the 120 ms gap), so Dragonflame's many
 * buffs from one cast ring once and each repeat wave rings again, as the player's own cast does. Returns false when
 * the spell has no per-buff row (the caller keeps its own path: a rune's stock trail, a minion's descend) or defs
 * cannot play yet.
 */
export function playCastFanOutBuffFx(o: { spellId?: string; from: Point | null; target: Point; targetUid: string; index?: number; delayMs?: number }): boolean {
  const fan = spellCastFanOutFor(o.spellId);
  if (!fan || !canPlayDefs()) return false;
  const camera = viewportCentre();
  const from = fan.fanOut === 'buffedOn' ? o.target : (o.from ?? o.target);
  afterMs(o.delayMs ?? 0, () => {
    const sound = spellCastSoundAllowed(fan.def);
    playDef(fan.def, { source: from, target: o.target, cursor: from, camera }, {
      uids: { source: null, target: o.targetUid }, index: o.index ?? 0, gain: fan.gain, ...(sound ? {} : { muteSound: true }),
    });
    if (sound && fan.sfx !== undefined) sfx[fan.sfx]?.();
  });
  return true;
}
