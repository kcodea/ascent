import type { MomentKind } from './kinds';
import type { RecruitMomentKind } from './recruitMoments';

/**
 * A binding key that belongs to the HUD rather than to the board — an event on a chrome element (a rune
 * badge, and whatever joins it) that no board-anchored moment can reach.
 *
 * `runeTriggered` exists BECAUSE `questTrigger` cannot do this job. That combat kind is bound in
 * `bindings.json` and has never played a particle: its events name a `flag`/`questId` and a side, never a
 * unit, so the score's `anchorsForUnits(null, null)` returns null and the def is skipped (see the note above
 * `questTrigger` in `score.ts`). The score anchors to board units by design; a rune lives in the status bar.
 * So the anchor comes from the badge's own DOM instead — see `runeTriggerFx.ts`.
 *
 * Kept as its own union for the same reason `RecruitMomentKind` is: these kinds have no combat cue list and
 * never should, and no emitter in `recruitMoments.ts` either — folding them into either union would break
 * that module's "every declared kind has a source" invariant with a kind it can never emit.
 */
export type HudBindingKind = 'runeTriggered' | 'epicRuneTriggered';

/** The HUD kinds at runtime. Exists so `bindings.test.ts` can validate a binding key against them the way it
 *  already does against `SCORE_DEFAULTS` and `RECRUIT_MOMENT_KINDS` — without it a HUD key reads as naming
 *  nothing real, and the "no binding for a kind that does not exist" guard would have to be weakened. */
export const HUD_BINDING_KINDS: readonly HudBindingKind[] = ['runeTriggered', 'epicRuneTriggered'];

/**
 * Every key a binding can hang off — a COMBAT moment kind, a SHOP one, or a HUD one.
 *
 * One table across both phases is the point: "which def plays when X happens" should be one question with
 * one answer, and the shop half used to have no way to ask it at all (see `recruitMoments.ts`). Kept as a
 * union rather than by widening `MomentKind` itself, because `MomentKind` carries a second obligation —
 * `SCORE_DEFAULTS` is a `Record<MomentKind, Cue[]>`, so every combat kind MUST declare a combat cue list.
 * A shop kind has no combat cues and never should, and widening would have forced a meaningless row per
 * kind and made the exhaustive-score test lie.
 */
export type BindingKind = MomentKind | RecruitMomentKind | HudBindingKind;
import rawBindings from './bindings.json';

/**
 * WHICH authored FX def plays at a moment — the single answer to that question, for the cue runner, the FX
 * library browser, and the workbench's commit path.
 *
 * It used to be two answers: a `def` literal on an `fxDef` cue in `score.ts` (keyed by moment kind) and the
 * frozen `CARD_FX` table in `cardFx.ts` (keyed by card, then kind). Two shapes, two resolution orders, no
 * override layer on either — so retargeting a card's effect meant editing TypeScript, and the two could
 * disagree about what would play.
 *
 * WHAT plays lives here; WHEN it plays stays on the cue in `score.ts` (`at`/`offset`/`scaled`/`enabled`).
 * That split is deliberate: it keeps this file small enough to review as a diff and keeps timing next to the
 * scheduling code that consumes it.
 *
 * `bindings.json` is a STATIC import, which is what makes the obvious failure mode impossible: a missing or
 * syntactically invalid file is a build error, not a runtime silent-nothing. The only failure left is
 * "parseable but structurally wrong", which `parseTable` handles loudly and per-entry below.
 */

export interface FxBinding {
  /** The def id to play — a file stem under `packages/ui/src/fx/defs/`. */
  def: string;
  /**
   * Which anchor pairs the def plays at. Merges what used to be two separate unions (`Cue.fanOut` and
   * `CardFxBinding.fanOut`) that asked the same question.
   *
   * - `primary` (default): once, at the moment's own source→target pair.
   * - `damaged`: once per distinct unit damaged in the same resolution step. A cast's own event frequently
   *   carries NO target (Bloodbinder emits one targetless `sc`, then a `dmg` per marked enemy), so a
   *   travelling effect bound to it would have nowhere to go and would collapse onto the source.
   * - `struck`: like `damaged`, but also fires at a unit whose WARD absorbed the hit (a `shield` pop). The
   *   projectile connects and the Ward shatters even though no damage landed — Fel Spikes' spike volley
   *   (owner ruling 2026-08-20).
   * - `selfBuffed`: once per unit that buffed ITSELF in this moment. A self-buff has no pair to travel
   *   between and a moment can carry several at once.
   * - `buffed`: once per unit this moment's source buffed SOMEONE ELSE (the cross-buff targets — Karwind
   *   pumping every Dragon). The mirror of `selfBuffed`: `groupBuffCasts` already collects exactly these
   *   source→target pairs for the tendril channel, so this rides the same grouping and plays on each target.
   * - `buffedOn`: like `buffed`, but the def plays ON each buffed minion rather than TRAVELLING to it — both
   *   anchors are that minion's own centre, the convention `minionBuffed` already uses (see `fireLand`).
   *
   *   The distinction is the def's shape, not the effect's. An Ale is a travelling volley authored against
   *   `source` = the cursor, so `buffed`'s cursor→minion pair is what it wants. Dragonflame is a column of
   *   flame authored against `source` = the thing it engulfs, so the same pair puts it at the cursor — which
   *   is exactly what the owner reported on 2026-09-01: *"dragonflame's effect is happening at the cursor
   *   location when it should be happening at the target of the buff's location."* Two anchor conventions
   *   already existed in this codebase; this names the second one instead of leaving it reachable only from
   *   the `minionBuffed` path.
   */
  fanOut?: 'primary' | 'damaged' | 'struck' | 'selfBuffed' | 'buffed' | 'buffedOn';
  /**
   * A sound to fire alongside the def, named from {@link BINDING_SFX}.
   *
   * Here rather than in the cue runner because "which sound" is the same KIND of question as "which def" —
   * both are per-card authoring decisions, and the runner is deliberately ignorant of both. The alternative
   * was a card-id check inside `Recruit.tsx`, which is precisely the bespoke-shop-effect shape the recruit
   * cue system exists to delete.
   *
   * A WHITELIST, not a free string: an unknown name is dropped with a loud dev error rather than resolving to
   * nothing at play time, because a sound that silently never fires is indistinguishable from a sound the
   * author cannot hear over the rest of the mix.
   */
  sfx?: BindingSfx;
  /**
   * A def to play INSTEAD of `def` when the moment is a CRIT (a doubled buff — currently Karwind's 20% roll,
   * signalled by `RecruitMoment.crit`). Absent → the crit plays the ordinary `def` like any other buff.
   *
   * A def id like `def`, not a whitelist: it is validated the same way — `bindings.test.ts` asserts every
   * bound def id (this one included) resolves in the registry. Only `minionBuffed` currently produces a crit
   * moment, but the field is general: any moment that sets `crit` and any binding that names a `critDef` get
   * the substitution.
   */
  critDef?: string;
  /**
   * PROJECTILE DELIVERY (Fel Spikes' Echo). When true, this `damage`-moment effect is NOT played on the damage
   * beat: instead the projectile LAUNCHES a beat earlier — the instant the source unit dies, alongside its Echo
   * skull, from the still-visible body — and the damage beat is HELD (a travel lead) so the numbers, health
   * drops and kills all land when the spike connects, not before it. The fan-out still runs on the damage beat
   * to CLAIM its victims (suppressing the stock hit-burst the spike replaces); only the play is relocated. The
   * launch, the lead, and the suppression all key off this one flag (see `useCombatReplay` death handling +
   * beat clock, and the `fxDef` fan-out). Requires `fanOut: 'struck'`/`'damaged'`. */
  launchOnDeath?: boolean;
}

const FAN_OUTS: readonly string[] = ['primary', 'damaged', 'struck', 'selfBuffed', 'buffed', 'buffedOn'];

/**
 * The sounds a binding may name. Deliberately a short list rather than every key of the `sfx` module: most of
 * those are wired to a specific game beat and would read as a bug if a shop effect started firing them. Add
 * one here when an authored effect actually wants it.
 */
export const BINDING_SFX = ['maxGold', 'buff', 'triple', 'triggerPulse', 'dragonflame'] as const;
export type BindingSfx = (typeof BINDING_SFX)[number];

/**
 * A reserved def id for LIVE PREVIEWS. A binding to it applies in memory — that is what makes the authoring
 * draft visible on the real card — but it is stripped on the way to `localStorage` and on the way to
 * `bindings.json`, so it can never outlive the session that made it and can never be committed.
 *
 * Without that, the authoring loop writes a binding to a def that exists only in memory: a dangling
 * reference in a git-tracked file, which resolves to nothing and looks exactly like the tool being broken.
 * Reachable on the ordinary happy path, because writing bindings.json triggers a full reload and a React
 * cleanup does not run on unload. It was also reachable at commit time: `bindingsJson()` serialises the
 * WHOLE patch, and a global-scope commit writes the kind row without touching the card row the draft sits
 * on — so the draft went to disk beside it, shadowing the binding just committed for the card being tuned.
 *
 * Enforced HERE rather than in the workbench on purpose: a UI that tidies up before writing is correct only
 * for as long as every future caller remembers to, and neither of those two routes is one a reviewer would
 * think to check.
 *
 * NB: the workbench's draft stops being live the moment a commit succeeds — `commit` overwrites that patch
 * entry with the real def id and the bind effect's deps don't change, so it never re-binds the draft. In
 * practice the full reload follows immediately, but the coupling is real and undocumented elsewhere.
 */
export const DRAFT_DEF_ID = 'fx-draft';

/** Keys that must never be used as a table key: assigning to `__proto__` on a plain object invokes the
 *  inherited setter and rewrites the table's prototype, so a malformed entry would silently corrupt the table
 *  instead of being dropped like every other one. `constructor`/`prototype` are refused alongside it because
 *  the same class of confusion is not worth reasoning about per-call-site. */
const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** DEV-only: this module ships (bindings.json is a static import, and since the un-gate the defs it names ship
 *  too), so a malformed entry that slipped past CI would log to every player's console on load — and a player
 *  can do nothing about a bad binding. A dropped entry costs one missing effect, never a broken combat, so
 *  failing quietly for players and loudly for the author is the right split. `bindings.test.ts` is the real
 *  guard: it asserts every bound def id resolves in the registry. */
function devError(msg: string): void {
  if (import.meta.env.DEV) console.error(msg);
}

/**
 * kind → binding, and card → kind → binding. Both sparse. The "what plays" view: every leaf is a real
 * binding, because a row that plays nothing is expressed by ABSENCE here.
 */
export interface BindingTable {
  kinds: Partial<Record<BindingKind, FxBinding>>;
  cards: Record<string, Partial<Record<BindingKind, FxBinding>>>;
}

/**
 * The same shape as `BindingTable`, but a leaf may be `null` — a TOMBSTONE, meaning "resolution stops here
 * and nothing plays", as distinct from an absent key meaning "no opinion, keep looking".
 *
 * This is the shape of the two RESOLUTION LAYERS (the committed file and the session patch), and it is not
 * the same question as "what plays": `BindingTable` is the answer, `LayerTable` is the input. Keeping them
 * as separate types is what lets every consumer of `effectiveTables()` stay free of a null check for a case
 * that view can never produce.
 */
export interface LayerTable {
  kinds: Partial<Record<BindingKind, FxBinding | null>>;
  cards: Record<string, Partial<Record<BindingKind, FxBinding | null>>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** One binding, or null with `devError` naming `where`. Never throws: this is fed untrusted JSON. */
function coerceBinding(v: unknown, where: string): FxBinding | null {
  if (!isRecord(v)) {
    devError(`[fx] bindings.json: ${where} is not an object — dropped.`);
    return null;
  }
  if (typeof v.def !== 'string' || v.def === '') {
    devError(`[fx] bindings.json: ${where}.def must be a non-empty string — dropped.`);
    return null;
  }
  if (v.fanOut !== undefined && (typeof v.fanOut !== 'string' || !FAN_OUTS.includes(v.fanOut))) {
    devError(`[fx] bindings.json: ${where}.fanOut must be one of ${FAN_OUTS.join(', ')} — dropped.`);
    return null;
  }
  if (v.sfx !== undefined && (typeof v.sfx !== 'string' || !(BINDING_SFX as readonly string[]).includes(v.sfx))) {
    devError(`[fx] bindings.json: ${where}.sfx must be one of ${BINDING_SFX.join(', ')} — dropped.`);
    return null;
  }
  // `critDef` is a def id like `def`: existence is the registry test's job, so here only the shape is checked.
  if (v.critDef !== undefined && (typeof v.critDef !== 'string' || v.critDef === '')) {
    devError(`[fx] bindings.json: ${where}.critDef must be a non-empty string — dropped.`);
    return null;
  }
  if (v.launchOnDeath !== undefined && typeof v.launchOnDeath !== 'boolean') {
    devError(`[fx] bindings.json: ${where}.launchOnDeath must be a boolean — dropped.`);
    return null;
  }
  const out: FxBinding = { def: v.def };
  if (v.fanOut !== undefined) out.fanOut = v.fanOut as FxBinding['fanOut'];
  if (v.sfx !== undefined) out.sfx = v.sfx as BindingSfx;
  if (v.critDef !== undefined) out.critDef = v.critDef;
  if (v.launchOnDeath === true) out.launchOnDeath = true;
  return out;
}

/**
 * Validate a raw table. LOUD PER ENTRY rather than all-or-nothing: a bad entry is dropped with the exact key
 * named, and every other entry still loads. Losing one binding should not cost the other thirteen — and a
 * binding that silently fails to load is indistinguishable from one nobody wired, which is the single most
 * expensive ambiguity in this subsystem.
 *
 * Exported for the tests, which are the only place a malformed table can be constructed on purpose.
 */
export function parseTable(raw: unknown): LayerTable {
  const out: LayerTable = { kinds: {}, cards: {} };
  if (!isRecord(raw)) {
    devError('[fx] bindings.json is not an object — no authored FX will be bound.');
    return out;
  }
  if (isRecord(raw.kinds)) {
    for (const [kind, v] of Object.entries(raw.kinds)) {
      if (UNSAFE_KEYS.includes(kind)) {
        devError(`[fx] bindings.json: kinds.${kind} is an unsafe key — dropped.`);
        continue;
      }
      // An explicit `null` is a COMMITTED TOMBSTONE — "this row plays nothing, stop resolving" — and is the
      // only way the file can express a deliberate silence rather than an omission. Preserved rather than
      // dropped, or the workbench's "play nothing" unbind would write a file that re-read as "no opinion"
      // and the silence would last exactly until the next reload.
      if (v === null) {
        out.kinds[kind as BindingKind] = null;
        continue;
      }
      const b = coerceBinding(v, `kinds.${kind}`);
      if (b) out.kinds[kind as BindingKind] = b;
    }
  } else {
    devError('[fx] bindings.json: `kinds` is missing or not an object.');
  }
  if (isRecord(raw.cards)) {
    for (const [cardId, byKind] of Object.entries(raw.cards)) {
      if (UNSAFE_KEYS.includes(cardId)) {
        devError(`[fx] bindings.json: cards.${cardId} is an unsafe key — dropped.`);
        continue;
      }
      if (!isRecord(byKind)) {
        devError(`[fx] bindings.json: cards.${cardId} is not an object — dropped.`);
        continue;
      }
      const table: Partial<Record<BindingKind, FxBinding | null>> = {};
      for (const [kind, v] of Object.entries(byKind)) {
        if (UNSAFE_KEYS.includes(kind)) {
          devError(`[fx] bindings.json: cards.${cardId}.${kind} is an unsafe key — dropped.`);
          continue;
        }
        if (v === null) {
          table[kind as BindingKind] = null;
          continue;
        }
        const b = coerceBinding(v, `cards.${cardId}.${kind}`);
        if (b) table[kind as BindingKind] = b;
      }
      if (Object.keys(table).length > 0) out.cards[cardId] = table;
    }
  } else {
    devError('[fx] bindings.json: `cards` is missing or not an object.');
  }
  return out;
}

/** The committed baseline, validated once at module load. */
const COMMITTED: LayerTable = parseTable(rawBindings);

/**
 * Session overrides, layered over the file.
 *
 * Deliberately the same two-tier shape defs already have (session autosave vs. Save), so there is ONE mental
 * model for both: a change is live the instant you make it and survives a reload, and a separate explicit
 * commit writes the git-tracked file.
 *
 * `null` is a TOMBSTONE, not an absence. Against a file baseline an absent key means "inherit", so without an
 * explicit null there would be no way to express "this card plays nothing here" as a live change.
 */
type PatchTable = LayerTable;

const PATCH_KEY = 'ascent.fxBindings';

/**
 * Validate a raw patch blob the same way `parseTable` validates the file, plus preserving tombstones (an
 * explicit `null` survives as `null`; anything else that isn't a valid `FxBinding` is dropped as if absent,
 * never promoted to a tombstone). Reuses `UNSAFE_KEYS` for the same reason `parseTable` needs it: the blob
 * comes from `Object.entries` over `JSON.parse` output, which is the same untrusted-key surface — a
 * hand-edited `__proto__` key in localStorage must be dropped here exactly like it is for the file.
 */
function parsePatchTable(raw: unknown): PatchTable {
  const out: PatchTable = { kinds: {}, cards: {} };
  if (!isRecord(raw)) return out;
  if (isRecord(raw.kinds)) {
    for (const [kind, v] of Object.entries(raw.kinds)) {
      if (UNSAFE_KEYS.includes(kind)) continue;
      if (v === null) {
        out.kinds[kind as BindingKind] = null;
        continue;
      }
      const b = coerceBinding(v, `session patch: kinds.${kind}`);
      if (b) out.kinds[kind as BindingKind] = b;
    }
  }
  if (isRecord(raw.cards)) {
    for (const [cardId, byKind] of Object.entries(raw.cards)) {
      if (UNSAFE_KEYS.includes(cardId) || !isRecord(byKind)) continue;
      const table: Partial<Record<BindingKind, FxBinding | null>> = {};
      for (const [kind, v] of Object.entries(byKind)) {
        if (UNSAFE_KEYS.includes(kind)) continue;
        if (v === null) {
          table[kind as BindingKind] = null;
          continue;
        }
        const b = coerceBinding(v, `session patch: cards.${cardId}.${kind}`);
        if (b) table[kind as BindingKind] = b;
      }
      if (Object.keys(table).length > 0) out.cards[cardId] = table;
    }
  }
  return out;
}

/** The in-memory patch is the source of truth (this works with no localStorage at all); storage is
 *  persistence only, read once at module load. A corrupt blob degrades to no overrides. */
let patch: PatchTable = (() => {
  try {
    return parsePatchTable(JSON.parse(localStorage.getItem(PATCH_KEY) ?? '{}'));
  } catch {
    return { kinds: {}, cards: {} };
  }
})();

/**
 * The patch as it is allowed to PERSIST: every `DRAFT_DEF_ID` entry removed, and a card left with nothing
 * pruned entirely (the same tidy-up `clearBinding` does, for the same reason — an accumulating pile of empty
 * card objects). The in-memory `patch` is untouched: the preview has to keep working.
 */
function persistablePatch(): PatchTable {
  const out: PatchTable = { kinds: {}, cards: {} };
  for (const [kind, b] of Object.entries(patch.kinds)) {
    if (b?.def !== DRAFT_DEF_ID) out.kinds[kind as BindingKind] = b;
  }
  for (const [cardId, byKind] of Object.entries(patch.cards)) {
    const table: Partial<Record<BindingKind, FxBinding | null>> = {};
    for (const [kind, b] of Object.entries(byKind)) {
      if (b?.def !== DRAFT_DEF_ID) table[kind as BindingKind] = b;
    }
    if (Object.keys(table).length > 0) out.cards[cardId] = table;
  }
  return out;
}

function savePatch(): void {
  try {
    // A DRAFT never reaches storage — see `DRAFT_DEF_ID`. A React cleanup does not run on unload, and the
    // commit path RELOADS the page, so anything persisted here would come back next session pointing at a
    // def that no longer exists and silence that card at that moment forever.
    localStorage.setItem(PATCH_KEY, JSON.stringify(persistablePatch()));
  } catch {
    /* ignore — the in-memory patch still works */
  }
}

/**
 * Bind (or, with `null`, explicitly unbind) a def.
 *
 * Takes the SAME `(cardId, kind)` key `bindingFor` reads, so the write and the read cannot disagree about
 * what a scope is: `cardId === null` addresses the kind layer, a string addresses that card's layer.
 */
export function setBinding(cardId: string | null, kind: BindingKind, binding: FxBinding | null): void {
  if (cardId === null) patch = { ...patch, kinds: { ...patch.kinds, [kind]: binding } };
  else patch = { ...patch, cards: { ...patch.cards, [cardId]: { ...patch.cards[cardId], [kind]: binding } } };
  savePatch();
}

/**
 * Drop a session override so the committed file applies again.
 *
 * NOT the same as `setBinding(cardId, kind, null)`. That writes a TOMBSTONE — an explicit "this plays
 * nothing here" that stops resolution falling through to the file. This removes the entry entirely, which
 * is what tearing down a preview needs: the author's draft should leave no trace, and the card should go
 * back to whatever it played before, not go silent.
 */
export function clearBinding(cardId: string | null, kind: BindingKind): void {
  if (cardId === null) {
    const kinds = { ...patch.kinds };
    delete kinds[kind];
    patch = { ...patch, kinds };
  } else {
    const byKind = { ...patch.cards[cardId] };
    delete byKind[kind];
    const cards = { ...patch.cards };
    // Drop the card entirely once it has no overrides left, so the persisted patch doesn't accumulate
    // empty objects across a long session.
    if (Object.keys(byKind).length > 0) cards[cardId] = byKind;
    else delete cards[cardId];
    patch = { ...patch, cards };
  }
  savePatch();
}

/** Drop every session override, back to the committed file. */
export function resetBindings(): void {
  patch = { kinds: {}, cards: {} };
  try {
    localStorage.removeItem(PATCH_KEY);
  } catch {
    /* ignore */
  }
}

/** A copy deep enough that NOTHING returned from `effectiveTables()` shares a mutable object with the
 *  module's own tables — every leaf `FxBinding` is spread too, not just the outer kind/card maps, so a caller
 *  that edits a returned binding's `def` in place (an editor UI does exactly this) cannot corrupt `COMMITTED`. */
function cloneTable(t: LayerTable): LayerTable {
  const kinds: LayerTable['kinds'] = {};
  for (const [kind, b] of Object.entries(t.kinds)) {
    if (b !== undefined) kinds[kind as BindingKind] = b === null ? null : { ...b };
  }
  const cards: LayerTable['cards'] = {};
  for (const [id, byKind] of Object.entries(t.cards)) {
    const table: Partial<Record<BindingKind, FxBinding | null>> = {};
    for (const [kind, b] of Object.entries(byKind)) {
      if (b !== undefined) table[kind as BindingKind] = b === null ? null : { ...b };
    }
    cards[id] = table;
  }
  return { kinds, cards };
}

/**
 * The binding for a card at a kind, or null.
 *
 * Card layer first — the kind is the right key for "a Ward was gained", but every spell cast shares `scCast`,
 * so a card with its own look needs the narrower key. A `cardId` of null (no unit on screen, or the moment's
 * source is unknown) skips straight to the kind layer.
 */
/**
 * The authored def that REPLACES the stock buff tendril for a buff this spell caused, if there is one.
 *
 * One question, one answer, two very different callers: the combat score (a standalone `buffWave` moment) and
 * the attack wind-up (`fireBuffCasts`, where a cast absorbed into a swing is only identifiable per-buff). They
 * used to decide it separately, which is exactly how Dragonflame ended up playing its def in one path and the
 * stock tendril in the other depending on whether the cast happened on a swing.
 *
 * Keyed at `buffWave` because that is where a spell declares its combat cast def, and gated on `buffedOn`
 * because that fan-out is the one that MEANS "instead of": `buffed` is deliberately additive (Karwind's
 * flame-ring rides on top of its tendrils, owner ruling 2026-08-11) and must keep its tendril.
 */
/**
 * A grant attributed to a NAME rather than a body, and the authored effect that tells it.
 *
 * `ctx.buff`'s source is usually the buffer's uid, but a hero power or a rune has no body on the board and
 * passes a LABEL instead — `'Blade Mastery'`, `'Rune of the Wild Hunt'`, and about twenty more. Those render
 * through the SOURCELESS path (a descend, since there is nowhere to travel from), and this is the opt-in that
 * replaces that generic rain with the effect the owner authored for it.
 *
 * A plain map rather than a row in `bindings.json`, because the key is not a card and not a moment kind: it is
 * the string the SIMULATOR chose as the grant's source, and inventing a card id for it would make the binding
 * table lie about what it is keyed by. `heroId` names the hero-power clip that plays with it, on the same
 * `heroes/<id>.power.mp3` convention every other hero power uses.
 *
 * Keys must match the simulator's literal EXACTLY — `simulate.ts`'s `'Blade Mastery'` is the contract, and
 * `docbot/onAttackStatTiming.test.ts` sweeps those literals so a rename cannot silently unbind this.
 */
const LABEL_BUFF_FX: Record<string, { def: string; heroId?: string }> = {
  // GORUN — Blade Mastery, +3 Attack to the minion whose swing earned it (owner 2026-09-01).
  'Blade Mastery': { def: 'gorun-hp', heroId: 'gorun' },
};

/** The authored effect for a label-sourced grant, or null to keep the generic descend. */
export function labelBuffFxFor(source: string): { def: string; heroId?: string } | null {
  return LABEL_BUFF_FX[source] ?? null;
}

export function authoredBuffDefFor(spellId: string | undefined): string | null {
  if (spellId === undefined) return null;
  const b = bindingFor(spellId, 'buffWave');
  return b?.fanOut === 'buffedOn' ? b.def : null;
}

export function bindingFor(cardId: string | null, kind: BindingKind): FxBinding | null {
  if (cardId !== null) {
    // `undefined` means "no opinion, keep looking"; an explicit `null` is a tombstone that STOPS here —
    // falling through to the kind layer would make "play nothing" impossible to express.
    const overridden = patch.cards[cardId]?.[kind];
    if (overridden !== undefined) return overridden;
    const fromFile = COMMITTED.cards[cardId]?.[kind];
    if (fromFile !== undefined) return fromFile;
  }
  const overriddenKind = patch.kinds[kind];
  if (overriddenKind !== undefined) return overriddenKind;
  return COMMITTED.kinds[kind] ?? null;
}

/**
 * What would play at `(cardId, kind)` if the live preview draft weren't in the way.
 *
 * The same resolution order as `bindingFor`, with a `DRAFT_DEF_ID` entry treated as "no opinion" so lookup
 * falls through to whatever is underneath it.
 *
 * The workbench's fanOut prefill asks exactly this question — "what is already working here" — and
 * `bindingFor` stops being able to answer it the moment the draft is bound, because the draft IS the card's
 * binding by then and carries whatever fanOut the prefill itself last produced. Reading that back would make
 * the value self-perpetuating: switching scope card → global → card would return the global-derived value
 * instead of restoring the card's own.
 */
export function bindingBeneathDraft(cardId: string | null, kind: BindingKind): FxBinding | null {
  const notDraft = (b: FxBinding | null | undefined): boolean => b === undefined || b?.def !== DRAFT_DEF_ID;
  if (cardId !== null) {
    // A tombstone (`null`) still STOPS here, exactly as in `bindingFor` — only the draft is see-through.
    const overridden = patch.cards[cardId]?.[kind];
    if (overridden !== undefined && notDraft(overridden)) return overridden;
    const fromFile = COMMITTED.cards[cardId]?.[kind];
    if (fromFile !== undefined) return fromFile;
  }
  const overriddenKind = patch.kinds[kind];
  if (overriddenKind !== undefined && notDraft(overriddenKind)) return overriddenKind;
  return COMMITTED.kinds[kind] ?? null;
}

/**
 * `COMMITTED` with an arbitrary patch layered over it, tombstones KEPT.
 *
 * Parameterised by the patch on purpose: WHICH overlay gets merged is the whole difference between the live
 * view and the committable one, and doing that as a choice of overlay is the only correct place to make it.
 * Filtering after a merge cannot work — an overlay entry OVERWRITES the row beneath it, so removing the
 * merged result deletes the committed value rather than falling back to it.
 *
 * Tombstones survive the merge because the two consumers want opposite things from them: `bindingsJson`
 * must WRITE them (a committed "plays nothing" is a row, not an omission) and `effectiveTables` must DROP
 * them. Dropping after this merge is safe in a way that dropping a draft after it is not: the overlay
 * tombstone has already overwritten whatever the file said, so there is nothing underneath left to lose.
 */
function mergedTable(overlay: PatchTable): LayerTable {
  const out = cloneTable(COMMITTED);
  for (const [kind, b] of Object.entries(overlay.kinds)) {
    if (b !== undefined) out.kinds[kind as BindingKind] = b;
  }
  for (const [cardId, byKind] of Object.entries(overlay.cards)) {
    const table = { ...out.cards[cardId] };
    for (const [kind, b] of Object.entries(byKind)) {
      if (b !== undefined) table[kind as BindingKind] = b;
    }
    if (Object.keys(table).length > 0) out.cards[cardId] = table;
    else delete out.cards[cardId];
  }
  return out;
}

/** A layer table as the "what plays" view: every tombstone dropped, and any card left with nothing pruned. */
function withoutTombstones(t: LayerTable): BindingTable {
  const kinds: BindingTable['kinds'] = {};
  for (const [kind, b] of Object.entries(t.kinds)) if (b) kinds[kind as BindingKind] = b;
  const cards: BindingTable['cards'] = {};
  for (const [cardId, byKind] of Object.entries(t.cards)) {
    const table: Partial<Record<BindingKind, FxBinding>> = {};
    for (const [kind, b] of Object.entries(byKind)) if (b) table[kind as BindingKind] = b;
    if (Object.keys(table).length > 0) cards[cardId] = table;
  }
  return { kinds, cards };
}

/**
 * The whole effective table: the file with the session patch applied and tombstones REMOVED. This is what
 * the library browser enumerates and what `commitPlan` computes its blast radius against — in both cases
 * "unbound" is expressed by absence, so tombstones (which only exist to stop resolution falling through)
 * have done their job by here.
 *
 * Deliberately the LIVE view, drafts included: both callers are showing the author what is playing right
 * now. `bindingsJson` is the one that must not see drafts, and it says so by merging a different overlay.
 */
export function effectiveTables(): BindingTable {
  return withoutTombstones(mergedTable(patch));
}

/**
 * The merged file + patch as the exact text to write to `bindings.json`.
 *
 * Keys are sorted so a commit produces a minimal, readable diff rather than reordering the whole file
 * whenever an object's insertion order happens to change.
 *
 * Merges `persistablePatch()` — the session overlay with every `DRAFT_DEF_ID` entry REMOVED — rather than
 * the live one, so a draft is never in the overlay in the first place. This is the second of the two routes
 * a draft could reach disk, and the one the commit button walks: a global-scope commit writes the kind row
 * and leaves the card row the draft sits on alone, so a live-view serialisation would put a binding to a
 * memory-only def in the file, shadowing the kind binding just committed for that very card.
 *
 * Stripping the draft AFTER the merge instead is a data-loss bug, not a stylistic difference: the draft
 * overwrote the committed row, so removing the merged entry deletes the committed value underneath and the
 * empty-card prune then deletes the card outright. Tuning Bloodbinder and committing "Everywhere" wrote a
 * file with Bloodbinder's own `ruby-lance` binding silently gone — reported success, no `fx-draft` in the
 * file, and only visible sessions later. Overlay choice, never post-filtering.
 */
export function bindingsJson(): string {
  return serialise(mergedTable(persistablePatch()));
}

/** A layer table as `bindings.json` text: sorted keys, tombstones written as an explicit `null`. */
function serialise(t: LayerTable): string {
  const kinds: Record<string, FxBinding | null> = {};
  for (const kind of Object.keys(t.kinds).sort()) kinds[kind] = t.kinds[kind as BindingKind] ?? null;
  const cards: Record<string, Record<string, FxBinding | null>> = {};
  for (const cardId of Object.keys(t.cards).sort()) {
    const byKind = t.cards[cardId] ?? {};
    const inner: Record<string, FxBinding | null> = {};
    for (const kind of Object.keys(byKind).sort()) inner[kind] = byKind[kind as BindingKind] ?? null;
    cards[cardId] = inner;
  }
  return `${JSON.stringify({ version: 1, kinds, cards }, null, 2)}\n`;
}

// ─── unbinding ────────────────────────────────────────────────────────────────────────────────────────
//
// Removing a binding is TWO operations with opposite intents, and the difference is only visible on a card
// row. `clear` deletes the row, so resolution falls through to the kind default; `tombstone` writes an
// explicit `null`, so resolution STOPS and the card plays nothing. On a kind row there is no layer beneath,
// so the two produce the same silence — which is why the panel offers one button there and two here.
//
// The pair `bindingAt` + `bindingWithout` is what lets the panel state the outcome BEFORE the click instead
// of describing it in general terms. `bindingBeneathDraft` cannot answer either question: it resolves
// through the layers, so it cannot say whether the row you are looking at exists at all (its answer may
// have come from the kind beneath), and it cannot say what would be left if that row went away.

/** How a binding is being removed. See the block comment above. */
export type UnbindOp = 'clear' | 'tombstone';

/** An entry AT one layer: `binding: null` is a tombstone, and `source` says which layer it came from. */
export interface BindingEntry {
  binding: FxBinding | null;
  source: 'session' | 'file';
}

/**
 * The entry at EXACTLY this layer — no fall-through — or `undefined` when this row is empty.
 *
 * `cardId === null` addresses the kind layer, a string that card's layer: the same key `setBinding` and
 * `bindingFor` take, so "which row am I about to delete" cannot disagree with "which row did I write".
 *
 * The live draft is see-through, for the same reason it is in `bindingBeneathDraft`: while rail mode is
 * previewing, the draft IS the row, and an unbind panel that offered to remove it would be offering to
 * delete the preview rather than the author's real binding.
 */
export function bindingAt(cardId: string | null, kind: BindingKind): BindingEntry | undefined {
  const fromPatch = cardId === null ? patch.kinds[kind] : patch.cards[cardId]?.[kind];
  if (fromPatch !== undefined && fromPatch?.def !== DRAFT_DEF_ID) return { binding: fromPatch, source: 'session' };
  const fromFile = cardId === null ? COMMITTED.kinds[kind] : COMMITTED.cards[cardId]?.[kind];
  return fromFile === undefined ? undefined : { binding: fromFile, source: 'file' };
}

/**
 * What would play at `(cardId, kind)` if the row AT that layer were removed — the consequence of a `clear`,
 * computed rather than assumed.
 *
 * For a card row that means resolving the kind layer alone (a card tombstone underneath is irrelevant: it
 * is the row being removed). For a kind row it is always null — there is no layer beneath the kind, which
 * is exactly why `clear` and `tombstone` collapse there.
 */
export function bindingWithout(cardId: string | null, kind: BindingKind): FxBinding | null {
  if (cardId === null) return null;
  const overriddenKind = patch.kinds[kind];
  if (overriddenKind !== undefined && overriddenKind?.def !== DRAFT_DEF_ID) return overriddenKind;
  return COMMITTED.kinds[kind] ?? null;
}

/**
 * `bindings.json` as it would read after unbinding `(cardId, kind)` — WITHOUT touching the live tables.
 *
 * Computing the text instead of mutating-then-serialising is what makes the write safe against the reload
 * it triggers. The mutate-first alternative has a real failure: a `clear` has to be expressed in the patch
 * as a tombstone (only a tombstone deletes the merged row), and if the reload lands inside the `await` that
 * tombstone is still in `localStorage` afterwards — so the file says "fall through to the default" while
 * the session says "play nothing", and the card is silent for reasons nothing on screen explains. Here the
 * live tables are only updated once the write has come back ok.
 */
export function unbindJson(cardId: string | null, kind: BindingKind, op: UnbindOp): string {
  const t = mergedTable(persistablePatch());
  if (cardId === null) {
    if (op === 'tombstone') t.kinds[kind] = null;
    else delete t.kinds[kind];
  } else {
    const byKind = { ...t.cards[cardId] };
    if (op === 'tombstone') byKind[kind] = null;
    else delete byKind[kind];
    // A card with nothing left is dropped rather than written as an empty object — same tidy-up the merge
    // does, so an unbind cannot leave `"bloodbinder": {}` behind in the committed file.
    if (Object.keys(byKind).length > 0) t.cards[cardId] = byKind;
    else delete t.cards[cardId];
  }
  return serialise(t);
}
