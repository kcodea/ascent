import { cascade, scheduleLands, type Land } from '../fx/land';
import { sfx } from '../sfx';
import { canPlayDefs, playDef } from '../fx/playDef';
import { bindingFor, type FxBinding } from './bindings';
import { RUBY_BEAT_MS, RUBY_GAP_MS } from './channels/rubyLanded';
import type { RecruitMoment } from './recruitMoments';

/**
 * The SHOP cue runner — the recruit-phase counterpart to `runMomentCues`.
 *
 * What a bespoke shop effect used to do by hand, once: diff a counter, wait a frame so the re-rendered cards
 * have been laid out, walk the recipients on a cascade, measure each card at fire time, and play a def. The
 * one thing it does differently is the important one — WHICH def plays comes from `bindings.json` via
 * `bindingFor`, not from a hardcoded id, so a shop effect is re-bindable from the workbench exactly like a
 * combat one.
 *
 * DOM-measuring and timer-owning, so it is not unit-testable in this repo (no jsdom) — the pure halves it
 * leans on are: `recruitMoments.ts` (what happened), `fx/land.ts` (when each land fires) and `bindings.ts`
 * (what plays). This file is the glue those three were factored out of, and holds no logic of its own worth
 * testing separately.
 */

/** How a caller measures a unit. Injected rather than imported so this module stays free of `Recruit.tsx`'s
 *  transform-aware `restingCenterOf`, which reads layout in a way only that component's DOM guarantees. */
export type MeasureUnit = (uid: string) => { x: number; y: number } | null;

export interface RecruitCueContext {
  /** uid → cardId for the board, so a per-CARD binding can be resolved. Without it only the kind-level
   *  binding applies — the same fallback `score.ts` makes when the replay has no card map. */
  cardIdOf: (uid: string) => string | null;
  measure: MeasureUnit;
  /** Fired once per land alongside the def, for the cue's own sound. */
  onLand?: (uid: string) => void;
}

/**
 * Schedule every land for one moment. Returns a teardown that cancels anything still pending.
 *
 * The cascade shape and timing are the Ruby sweep's (`gap` walks recipients, `beat` repeats within one),
 * reused rather than re-tuned: the shop already had exactly one authored cascade and its numbers are the
 * owner-tuned ones. When a second shop effect wants a different rhythm, that is the moment to make these
 * per-kind rather than guessing a second set now.
 */
export function runRecruitMomentCues(moment: RecruitMoment, ctx: RecruitCueContext): () => void {
  if (!canPlayDefs()) return () => {};

  // The shop being gemmed is ONE event across the row, not a per-card cascade — one spanning play, one sound.
  if (moment.kind === 'shopRubied') return runShopRubiedSpan(moment, ctx);

  // The whole shop buffed by a run-wide source — ONE camera-anchored play over the row, never a cascade.
  if (moment.kind === 'shopBuffAll') return runShopBuffAllFire(moment, ctx);

  // A tavern spell cast — ONE fire at the release point, anchored to `cursor`, keyed by the spell's card id.
  // No cascade, no DOM measure: the anchor is the point carried on the moment.
  if (moment.kind === 'spellCast') return runSpellCastFire(moment, ctx);

  // Resolved UP FRONT, so an unbound moment costs one table lookup and schedules nothing — and so the
  // binding is read once rather than separately per land, which is two chances to disagree.
  //
  // A source-attributed moment (a `minionBuffed` wave names its buffer) keys by the SOURCE card, so Karwind's
  // binding fires on every Dragon it pumped rather than each Dragon needing its own. A recipient-keyed moment
  // (rubyLanded) has no `sourceCardId` and keys by the first recipient, exactly as before.
  const first = moment.recipients[0];
  if (!first) return () => {};
  const bindingCard = moment.sourceCardId ?? ctx.cardIdOf(first.uid);
  const resolved = bindingFor(bindingCard, moment.kind);
  if (!resolved) return () => {};
  // A crit wave plays the binding's `critDef` in place of its `def` — a red ring for Karwind's doubled buff
  // REPLACES the ordinary one (owner ruling 2026-08-11). Swap `def` only; `sfx` and everything else ride along,
  // so a crit-variant is a one-field override, not a second binding to keep in sync.
  const binding: FxBinding =
    moment.crit && resolved.critDef !== undefined ? { ...resolved, def: resolved.critDef } : resolved;

  const timers: ReturnType<typeof setTimeout>[] = [];
  // ONE rAF before anything is measured: the buffed/gemmed cards re-render in this commit, and measuring
  // before the browser has laid them out reads the PREVIOUS geometry — the bug every hand-written shop
  // effect had to learn about individually.
  const raf = requestAnimationFrame(() => {
    for (const land of scheduleLands(cascade(moment.recipients), { gap: RUBY_GAP_MS, beat: RUBY_BEAT_MS })) {
      const fire = (): void => fireLand(land, binding, ctx);
      if (land.at <= 0) fire();
      else timers.push(setTimeout(fire, land.at));
    }
  });

  return () => {
    cancelAnimationFrame(raf);
    for (const t of timers) clearTimeout(t);
  };
}

/**
 * The shop-gem VOLLEY — a `shopRubied` moment (Veinstorm gemming the tavern) as ONE play spanning the row,
 * with a SINGLE gem sound, instead of a per-offer cascade.
 *
 * Reasons it is its own path rather than a cascade of one:
 *  - **One instance, not N.** A cascade schedules a burst per offer; a full shop is up to seven 220-particle
 *    bursts. One spanning def is the GPU win the owner asked for.
 *  - **Spans the actual gemmed offers.** `source`/`target` are the leftmost and rightmost gemmed offers'
 *    centres, so an authored def can either sit at the midpoint or draw ACROSS the pair (a ribbon, a squashed
 *    shockwave) and it auto-fits however many offers were gemmed.
 *  - **Kind-level binding.** The span is about the shop, not any one offer, so it resolves `(null, kind)` —
 *    a per-offer card override would be meaningless here and is deliberately not consulted.
 *
 * The sound is the caller's `onLand`, fired ONCE (the cascade fires it per land). The def is unchanged today
 * (`ruby-gem-apply`, the placeholder in `bindings.json`); the owner re-authors the spanning def and re-binds
 * `shopRubied` in the workbench, no code change.
 */
function runShopRubiedSpan(moment: RecruitMoment, ctx: RecruitCueContext): () => void {
  const binding = bindingFor(null, 'shopRubied');
  if (!binding) return () => {};
  let raf = 0;
  const play = (): void => {
    raf = requestAnimationFrame(() => {
      // Measured inside the rAF for the same reason the cascade is — the gemmed offers re-rendered this commit.
      let left: { uid: string; x: number; y: number } | null = null;
      let right: { uid: string; x: number; y: number } | null = null;
      for (const r of moment.recipients) {
        const p = ctx.measure(r.uid);
        if (!p) continue;
        if (left === null || p.x < left.x) left = { uid: r.uid, x: p.x, y: p.y };
        if (right === null || p.x > right.x) right = { uid: r.uid, x: p.x, y: p.y };
      }
      if (left === null || right === null) return; // every gemmed offer left before paint (sold, rerolled)
      // Anchors the def can use: source/target span the gemmed offers, and `camera` is the viewport centre —
      // the same definition `boardAnchors.ts` gives it and the same one the workbench tunes against, so a
      // camera-anchored shop def (a fixed full-width burst) frames exactly as it did in the tuner. Without
      // this a camera-anchored layer would resolve to ORIGIN (0,0) and fire in the screen corner.
      const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      playDef(binding.def, { source: left, target: right, camera }, { uids: { source: left.uid, target: right.uid }, index: 0 });
      if (binding.sfx !== undefined) sfx[binding.sfx]?.();
      ctx.onLand?.(left.uid); // the single gem sound for the whole volley
    });
  };
  // On a REFRESH re-stamp the offers are still sliding into a fresh row, so the span holds a beat and lands
  // WITH them — timed to the badge roll (`SHOP_RUBY_DELIVER_MS` in `Recruit.tsx`), not before. The CAST plays
  // at once: it is the spell going off, and its offers are already in place.
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (moment.onRefresh) timer = setTimeout(play, SHOP_SPAN_REFRESH_DELAY_MS);
  else play();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    cancelAnimationFrame(raf);
  };
}

/**
 * The SHOP-WIDE BUFF aura — "minions in the Shop get +A/+H" landing on the whole row (Staff of Guel,
 * Contract Butcher, Soul Defiler, a quest reward) as ONE camera-anchored play.
 *
 * Why it is its own path rather than a cascade or a span:
 *  - **The event is the SHOP, not a card.** Every offer got the same buff at the same instant, so a per-offer
 *    cascade would read as N unrelated pops. The authored def (`shop-buff-aura`) is camera-anchored on every
 *    layer for exactly this reason.
 *  - **It must not depend on measuring a card.** The run-wide channel can rise with an empty or mid-reroll
 *    shop, and the buff still happened. `runShopRubiedSpan` bails when nothing measures; this deliberately
 *    does not — `source`/`target` are best-effort extras for a future re-author, and their absence is fine.
 *  - **Kind-level binding.** Like the gem span, this is about the shop rather than any one offer, so it
 *    resolves `(null, kind)` and a per-card override is deliberately not consulted.
 *
 * Fires on the next frame for the same reason the cascade does: the offers re-rendered this commit, so the
 * measure (when there is one) has to wait for layout.
 */
function runShopBuffAllFire(moment: RecruitMoment, ctx: RecruitCueContext): () => void {
  const binding = bindingFor(null, 'shopBuffAll');
  if (!binding) return () => {};
  let raf = 0;
  raf = requestAnimationFrame(() => {
    let left: { uid: string; x: number; y: number } | null = null;
    let right: { uid: string; x: number; y: number } | null = null;
    for (const r of moment.recipients) {
      const p = ctx.measure(r.uid);
      if (!p) continue;
      if (left === null || p.x < left.x) left = { uid: r.uid, x: p.x, y: p.y };
      if (right === null || p.x > right.x) right = { uid: r.uid, x: p.x, y: p.y };
    }
    // `camera` is the viewport centre — the same definition `boardAnchors.ts` gives it and the one the
    // workbench tunes against, so the authored framing survives verbatim. The span anchors fall back to it
    // rather than to ORIGIN, which is where an unstaged anchor would otherwise put a layer (the screen corner).
    const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const source = left ?? camera;
    const target = right ?? camera;
    const uids = left !== null && right !== null ? { source: left.uid, target: right.uid } : undefined;
    playDef(binding.def, { source, target, camera }, { ...(uids ? { uids } : {}), index: 0 });
    if (binding.sfx !== undefined) sfx[binding.sfx]?.();
  });
  return () => { cancelAnimationFrame(raf); };
}

/** How long the shop-gem span waits on a REFRESH re-stamp before firing, so it lands with the sliding-in
 *  offers and syncs with the badge roll rather than flashing before the row settles. Owner-set 2026-08-11. */
const SHOP_SPAN_REFRESH_DELAY_MS = 150;

/** The stagger between one authored cast play and the next when a spell resolves several times. 200ms is the
 *  generic spark's own gap (`castSparks` in `Recruit.tsx`), kept identical so a bound spell and an unbound one
 *  read as the same beat — the count is what changes, not the rhythm. */
const SPELL_RECAST_GAP_MS = 200;

/**
 * A `spellCast` moment: with no recipients (Golden/Reinforcing) this is ONE fire at the release point, no DOM
 * measure, no cascade — a tavern spell with nowhere to travel from/to, so `source`/`target`/`cursor` are all
 * the same point. With recipients (a BUFF ale — Champion's/Defensive/Bloody) it fans out into ONE fire PER
 * buffed minion, all simultaneously, each travelling from the release point (`cursor`/`source`) to that
 * minion's measured centre (`target`). Keyed by the spell's own card id (not the kind) so each spell resolves
 * its own binding.
 */
function runSpellCastFire(moment: RecruitMoment, ctx: RecruitCueContext): () => void {
  const binding = bindingFor(moment.sourceCardId ?? null, 'spellCast');
  const pt = moment.point;
  if (!binding || !pt) return () => {};
  const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const src = moment.sourceCardId ?? null;
  // Fanning out is OPT-IN, via the binding's own `fanOut: 'buffed'` — the same field and the same word combat
  // uses for "once per unit this source buffed". It used to be implicit: any cast carrying recipients fanned.
  // That was right while the five ales were the only bound casts, and wrong the moment `spellCast` gained a
  // KIND-level default (`spell-sparks`): a fanning default would fire a 122-particle burst once per buffed
  // minion for every spell in the game, and land it ON those minions rather than where the player cast it.
  // The ales declare `fanOut` explicitly and keep their cursor→minion volley unchanged.
  const fansOut = (binding.fanOut === 'buffed' || binding.fanOut === 'buffedOn') && moment.recipients.length > 0;
  // ON the buffed minion, not travelling to it — see `buffedOn` in `bindings.ts`. Handled before the single-fire
  // branch because it is a fan-out with its OWN anchor convention, not a variant of the cursor volley below.
  if (binding.fanOut === 'buffedOn' && fansOut) return runBuffedOnFire(moment, binding, ctx, src);
  // The single fire is at the RELEASE POINT — the cursor. `target` is deliberately the cursor too, not a
  // minion, so a `target`-anchored layer lands where the spell was actually cast (owner call 2026-08-19).
  if (!fansOut) {
    // ONE PLAY PER RESOLUTION, not one per action (owner ask 2026-09-01: *"whenever dragonflame is cast, the
    // animation should play, and should play each time it is cast … it should show all of the casts of it"*).
    //
    // A multicast spell resolves N times at the play site (Yazzus, Rune of Hoardflame / Dragon Breath, Spell
    // Thesis…) but reaches presentation as ONE action, so a single play made a 4× cast look like a 1× cast.
    // The generic spark path already staggered itself this way (`castSparks` in `Recruit.tsx`); an AUTHORED
    // def had no equivalent, which meant binding a def to a spell silently cost it its repeat count.
    //
    // Only the single-fire shape. A `fanOut` def (the Ales) already models its own repetition through the
    // Edward Keg-hands echo below, and stacking a second repeat on top would double-count it.
    const repeats = Math.max(1, moment.casts ?? 1);
    const fire = (): void => {
      playDef(binding.def, { source: pt, target: pt, cursor: pt, camera }, { uids: { source: src, target: src } });
      if (binding.sfx !== undefined) sfx[binding.sfx]?.();
    };
    fire();
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < repeats; i++) timers.push(setTimeout(fire, i * SPELL_RECAST_GAP_MS));
    return () => { for (const t of timers) clearTimeout(t); };
  }
  // Targets (buff ales) → one fire per buffed minion, ALL AT ONCE, each travelling cursor→minion. The buffed
  // cards re-rendered this commit (stat change), so measure inside one rAF for post-layout geometry.
  const raf = requestAnimationFrame(() => {
    for (const r of moment.recipients) {
      const c = ctx.measure(r.uid);
      if (!c) continue; // minion left the DOM (sold/tripled) before paint — skip it cleanly
      playDef(binding.def, { source: pt, target: c, cursor: pt, camera }, { uids: { source: src, target: r.uid } });
    }
    if (binding.sfx !== undefined) sfx[binding.sfx]?.(); // one sound for the volley, not one per target
  });
  return () => cancelAnimationFrame(raf);
}

/**
 * A `buffedOn` cast: the def plays ON each minion the spell buffed, once per BUFF it landed there.
 *
 * `count` is how many times that minion was buffed by this action, which for a multicast spell IS the cast
 * count — Dragonflame at ×2 buffs twice, so the same body carries two. Playing per buff rather than per
 * recipient is what makes the owner's two asks one mechanism instead of two:
 *
 *   *"whenever dragonflame is cast, the animation should play, and should play each time it is cast"*
 *   *"…it should be happening at the target of the buff's location"*   — owner, 2026-09-01
 *
 * So there is deliberately NO `moment.casts` repeat here: the buff events already encode the resolutions, and
 * multiplying by the cast count on top would square them. The sound fires once per WAVE index (one per cast,
 * however many minions that cast hit) rather than once per play, which is the same rule the ale volley uses.
 *
 * Measured inside one rAF for the same reason the volley below is: the buffed cards re-render on this commit
 * (their stats changed), so their geometry is only trustworthy after layout.
 */
function runBuffedOnFire(
  moment: RecruitMoment,
  binding: FxBinding,
  ctx: RecruitCueContext,
  src: string | null,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const waves = Math.max(1, ...moment.recipients.map((r) => r.count));
  const raf = requestAnimationFrame(() => {
    for (let wave = 0; wave < waves; wave++) {
      const fire = (): void => {
        for (const r of moment.recipients) {
          if (r.count <= wave) continue; // this body was not buffed on this pass
          const c = ctx.measure(r.uid);
          if (!c) continue; // minion left the DOM (sold/tripled) before paint — skip it cleanly
          playDef(binding.def, { source: c, target: c, cursor: c, camera }, { uids: { source: src, target: r.uid }, index: wave });
        }
        if (binding.sfx !== undefined) sfx[binding.sfx]?.();
      };
      if (wave === 0) fire();
      else timers.push(setTimeout(fire, wave * SPELL_RECAST_GAP_MS));
    }
  });
  return () => { cancelAnimationFrame(raf); for (const t of timers) clearTimeout(t); };
}

/** One land. Measured INSIDE the timer so a stagger that outlives a re-render — a triple collapsing three
 *  bodies into one, a sold minion — misses cleanly instead of firing at a stale rect. */
function fireLand(land: Land, binding: FxBinding, ctx: RecruitCueContext): void {
  const p = ctx.measure(land.uid);
  if (!p) return;
  // Both anchors are the minion itself: a shop effect lands ON a card, with nothing to travel between.
  // `uids` names it so a `react` layer has a subject — the shop path was the one that had none.
  playDef(binding.def, { source: p, target: p }, { uids: { source: land.uid, target: land.uid }, index: land.group });
  // The binding's own sound, fired WITH the visual rather than by the caller, so the two cannot drift apart
  // and a re-bind carries its sound along. Whitelisted at parse time (see `BINDING_SFX`), so this lookup is
  // total; the `?.` guards a name whose sfx entry was removed without updating the list.
  if (binding.sfx !== undefined) sfx[binding.sfx]?.();
  ctx.onLand?.(land.uid);
}
