import { useEffect, useMemo, useRef, useState } from 'react';
import { Container } from 'pixi.js';
import { defaultsOf } from '../params';
import { createPlayer, type FxPlayer } from '../player';
import { getPrimitive, listPrimitives } from '../registry';
import { driveLayerHeads, FX_ANCHOR_IDS, type FxPoint } from '../anchors';
import { invalidateBoardAnchors } from '../boardAnchors';
import type { FxAnchorId } from '../def';
import { randomSeed } from '../rng';
import { SCENARIOS, type FxHeadContext } from '../scenarios';
import { pixiFx } from '../../pixiFx';
import {
  clearSession,
  isValidSlug,
  loadSession,
  saveArt,
  saveDef,
  saveSession,
  slugify,
  toStoredDef,
  type StoredFxDef,
} from '../defStore';
import { listDefs, refreshDefs, registerSavedDef } from '../fxDefs';
import { getImportedDataUrl } from '../shapeLibrary';
import { Inspector } from './Inspector';
import { DefLibrary } from './DefLibrary';
import { createBackdrop, type FxBackdrop } from './backdrop';
import {
  addLayer,
  createEditorLayer,
  duplicateLayer,
  effectiveMutes,
  moveLayer,
  removeLayer,
  setLayerAnchor,
  setLayerMuted,
  setLayerName,
  setLayerParam,
  setLayerPrimitive,
  setLayerSolo,
  setLayerTiming,
  structureKey,
  toDef,
  type EditorLayer,
} from './layerModel';
import {
  ART_SHAPE_REF_PREFIX,
  artSlugOf,
  canRedo,
  canUndo,
  clampDuration,
  collectCustomShapeRefs,
  editorLayersFromDef,
  initHistory,
  normalizeSession,
  pruneUnknownPrimitives,
  pushHistory,
  redo,
  replaceHistoryPresent,
  shouldCoalesce,
  toStoredLayers,
  undo,
  type DurationBounds,
  type HistoryKind,
  type HistoryMark,
  type HistoryState,
} from './sessionState';

/** Swatches for the preview backdrop control (see `createBackdrop`). `hex: null` is "None" — transparent,
 *  matching the in-game overlay. Multiply against black is always black, so Mid/Light are what actually let
 *  you SEE multiply/overlay/screen doing their thing; that's the whole point of this control. Module-scope
 *  so the array identity is stable across renders. */
const BACKDROP_SWATCHES: readonly { label: string; hex: number | null }[] = [
  { label: 'None', hex: null },
  { label: 'Board', hex: 0x211d2c },
  { label: 'Mid', hex: 0x808080 },
  { label: 'Light', hex: 0xc8c8c8 },
];

// Registers every built-in primitive (see registry.ts's `registerPrimitive`). A DYNAMIC import,
// deliberately — the primitives self-register via a top-level function CALL (a real side effect Rollup
// can't prove away), so a plain `import '../primitives'` here would force the whole set — GLSL shader
// source strings included — into the production bundle even though nothing ever renders this component
// there (DevMenu, and everything under it, is only ever mounted behind `import.meta.env.DEV` in Game.tsx).
// Gating this import the same way lets prod's dead-code elimination drop the primitives entirely,
// matching how every other dev tuner already vanishes from the shipped bundle. `build()` below polls for
// a primitive to appear before using it, since this resolves asynchronously.
if (import.meta.env.DEV) void import('../primitives');

/** Duration dial bounds (ms) — replaces the old hardcoded `DURATION_MS` constant. Default matches the old
 *  constant's rough neighbourhood; the dial lets a tuner widen/narrow the def's duration (and thus the
 *  scenario's progress denominator) live. */
const DEFAULT_DURATION_MS = 1000;
const MIN_DURATION_MS = 200;
const MAX_DURATION_MS = 4000;
const DURATION_STEP_MS = 50;

/** Loop-gap dial bounds (ms) — only meaningful while Loop is on; see `FxPlayer.setLoopGap`. */
const MAX_LOOP_GAP_MS = 2000;
const LOOP_GAP_STEP_MS = 50;

/** The duration band a restored session / loaded def is clamped into — the dial's own bounds, handed to the
 *  pure helpers in `sessionState.ts` so that module never has to know about this file's constants. */
const DURATION_BOUNDS: DurationBounds = {
  min: MIN_DURATION_MS,
  max: MAX_DURATION_MS,
  fallback: DEFAULT_DURATION_MS,
};

/** Autosave debounce. Long enough that a slider drag writes once at the end of the gesture, short enough
 *  that an HMR reload (which editing any primitive forces) never loses more than half a second of work. */
const AUTOSAVE_DEBOUNCE_MS = 500;
/** How long the transient "Saved →" confirmation stays up. */
const SAVE_NOTE_MS = 2500;
/** Poll interval for "have the primitives self-registered yet?", matching the build effect's own retry. */
const REGISTRY_POLL_MS = 50;

/**
 * The unit undo/redo works in: everything an author means by "my effect".
 *
 * Deliberately the WHOLE editor state rather than a per-field diff — an undo that restores the layers but
 * not the selection (or the duration the layers were tuned against) lands you somewhere you never were. The
 * arrays/objects inside are shared by reference with the live state, which is safe precisely because every
 * `layerModel` op is immutable: nothing ever writes through a snapshot.
 *
 * NOT persisted. The autosave writes the present composition only (see the autosave effect); reopening the
 * workbench gives you your work back, not a half-consumed undo stack from yesterday.
 */
interface EditorSnapshot {
  layers: EditorLayer[];
  selected: number;
  durationMs: number;
  seed: number;
  seedLocked: boolean;
}

/** `<input type>`s that hold TEXT, and therefore have a native per-field undo of their own. */
const TEXT_INPUT_TYPES = ['text', 'number', 'search', 'url', 'email', 'tel', 'password'];

/**
 * Does this keyboard event target a text-entry control? Ctrl+Z inside the def-name field, the seed field or
 * a layer's rename box is the BROWSER's undo for that field, and hijacking it would make typing feel broken.
 *
 * A range/checkbox/color input is deliberately NOT text entry: it has no native undo to hijack, and a
 * slider keeps focus after a drag — which is the single most likely moment to reach for Ctrl+Z.
 */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el === null || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return TEXT_INPUT_TYPES.includes(((el as HTMLInputElement).type ?? 'text').toLowerCase());
}

/**
 * Full-screen dev overlay for live-tuning FX primitives. Deliberately NOT a `.sfxmix` draggable panel —
 * the whole point of this tool is its own purpose-built transport + a generated inspector, not another
 * floating tuner. Mounted only from `DevMenu` (itself dev-gated), so this entire tree is stripped from the
 * production bundle (see the DEV-gated import above for the one subtlety that requires).
 */
export function FxWorkbench({ onClose }: { onClose: () => void }): React.ReactElement {
  // Autosaved work from the last session, read ONCE (lazy initializer) so the initial layers/selected/duration
  // below can all seed from it — no post-mount "restore" pass that would respawn the effect a second time.
  // Deliberately registry-BLIND (see `normalizeSession`): the primitives arrive via a dynamic import that has
  // not resolved on first render, so the "does this primitive still exist?" pass runs separately, below.
  const [restoredSession] = useState(() => normalizeSession(loadSession(), DURATION_BOUNDS));

  // The workbench now stages a LIST of layers (a composition), not a single primitive. `layers[selected]` is
  // the one the top primitive row / Inspector / timing controls edit; every layer is played together.
  const [layers, setLayers] = useState<EditorLayer[]>(() => {
    if (restoredSession !== null) return restoredSession.layers;
    const first = listPrimitives()[0]?.id ?? 'ribbon';
    return [createEditorLayer(first, defaultsOf(getPrimitive(first)?.params ?? {}))];
  });
  const [selected, setSelected] = useState(restoredSession?.selected ?? 0);
  // The "Add layer" picker's own selection (defaults to the first registered primitive). Independent of the
  // selected layer — it only feeds `addNewLayer`.
  const [addPrimitiveId, setAddPrimitiveId] = useState<string>(() => listPrimitives()[0]?.id ?? 'ribbon');
  const [scenarioId, setScenarioId] = useState<string>(() => SCENARIOS[0]?.id ?? '');
  // "Playing" now reflects the player's REAL state (polled each frame in the updater below), not just
  // "the user pressed play" — an auto-fire-once is playing until it completes, then goes idle on its own.
  const [uiPlaying, setUiPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [timeMs, setTimeMs] = useState(0);
  const [fps, setFps] = useState(0);
  const [copied, setCopied] = useState(false);
  const [backdropColor, setBackdropColor] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState(restoredSession?.durationMs ?? DEFAULT_DURATION_MS);

  // ── durable defs (see `defStore.ts` / `fxDefs.ts`) ──────────────────────────────────────────────────
  // The name the next Save writes under; `saving` is the double-click guard, `saveNote` the transient
  // confirmation, `saveError` the inline failure line (a bad slug, a rejected write, art that didn't travel).
  const [defName, setDefName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The committed def library. Held in state (rather than calling `listDefs()` inline) so a Save can refresh
  // it explicitly — the registry behind it is module-level and React knows nothing about it.
  const [defs, setDefs] = useState<StoredFxDef[]>(() => listDefs());
  // "Restored unsaved work" is VISIBLE and dismissible — restoring must never silently clobber what the
  // author expected to see (a blank default composition).
  const [restoredNotice, setRestoredNotice] = useState(restoredSession !== null);
  // Loop is opt-in and OFF by default (see file-level rework note above `build()`): the workbench must
  // never auto-start a continuous loop just because an effect opened. Only `toggleLoop` turns this on.
  const [loopOn, setLoopOn] = useState(false);
  const [loopGapMs, setLoopGapMs] = useState(0);

  // ── seed (see `FxPlayer.setSeed` / `fx/rng.ts`) ─────────────────────────────────────────────────────
  // UNLOCKED is the default and is exactly today's behaviour: the player is handed `null`, so every spawned
  // instance rolls its own fresh seed and the effect looks slightly different each Fire. LOCKED hands the
  // player the number below, freezing the look so you can tune everything ELSE against a fixed roll. The
  // seed shown while unlocked is a real, usable number (not a placeholder) so locking is a single click.
  const [seed, setSeed] = useState(() => restoredSession?.seed ?? randomSeed());
  const [seedLocked, setSeedLocked] = useState(restoredSession?.seedLocked ?? false);

  // ── undo / redo (see `EditorSnapshot`) ──────────────────────────────────────────────────────────────
  // Only the BUTTONS' enabled-ness lives in state; the stack itself is a ref, because undo/redo has to read
  // and write it synchronously inside an event handler (a state updater can't both compute the next stack
  // and apply its snapshot to the player without running side effects inside the updater).
  const [historyFlags, setHistoryFlags] = useState({ undo: false, redo: false });
  // Which layer's name is being edited in place, and the in-progress text. `null` = nobody's renaming.
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');

  const playerRef = useRef<FxPlayer | null>(null);
  const backdropRef = useRef<FxBackdrop | null>(null);
  // Mirrors of the latest state, read by the per-frame updater / build closures so those never go stale
  // without forcing a player rebuild on every keystroke (a rebuild happens ONLY on primitive/scenario/duration
  // change). `loopGapRef` mirrors `loopGapMs` the same way `speedRef` mirrors `speed` -- a dial that should
  // survive a rebuild without itself triggering one.
  const layersRef = useRef(layers);
  // `selected` and `durationMs` get the same mirror treatment as `layers` for ONE reason: a history snapshot
  // has to be readable the instant an edit commits — before React has re-rendered — or the state undo
  // restores is a step behind what the author actually did. Written through `applySelected`/`applyDuration`.
  const selectedRef = useRef(selected);
  const durationRef = useRef(durationMs);
  const speedRef = useRef(speed);
  const loopGapRef = useRef(loopGapMs);
  // The seed a REBUILD hands the freshly-created player. Mirrored the same way `speedRef`/`loopGapRef` are —
  // a rebuild constructs a brand-new player with no seed, and re-applying it here is what makes a locked
  // seed survive a primitive swap / duration change / def load rather than silently re-rolling.
  const seedRef = useRef(seed);
  const seedLockedRef = useRef(seedLocked);
  const cursorRef = useRef({ x: 0, y: 0 });
  const clickRef = useRef<{ x: number; y: number } | null>(null);
  // Autosave stays DISARMED until the composition is actually touched, so merely opening the workbench (or
  // React 18's StrictMode double-mounting it) never writes a session — otherwise every open would hand the
  // next one a "Restored unsaved work" banner over a pristine default. `discardRestored` disarms it again so
  // the discarded work can't immediately re-save itself.
  const autosaveArmedRef = useRef(false);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The undo stack, created lazily on the first RECORDED edit (see `record`) so its initial `present` is the
  // composition as it actually ended up — after the restored session, the unknown-primitive prune and the
  // cold-boot params recovery have all had their say. Those three are repairs, not edits: none is undoable.
  const historyRef = useRef<HistoryState<EditorSnapshot> | null>(null);
  // Provenance of the last recorded edit — the input to `shouldCoalesce`, i.e. what makes a 60-step slider
  // drag a single undo entry. Cleared by undo/redo so the next edit can't be absorbed into a restored state.
  const lastMarkRef = useRef<HistoryMark | null>(null);
  // Latest undo/redo handlers, so the keydown listener can bind ONCE instead of re-binding on every render
  // (this component re-renders several times a second for the fps / time readouts).
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  // Mirrors `renaming` so committing a rename is IDEMPOTENT: Enter commits and unmounts the input, and some
  // browsers fire a `blur` on removal — which would otherwise commit (and record) the same rename twice.
  // A ref, not the state, because both would land in the same React batch and the state wouldn't have moved.
  const renamingRef = useRef<number | null>(null);

  // Live pointer position (for cursor-driven scenarios) and last click point (for `clickPlace`) —
  // independent of build/rebuild, tracked once.
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
    };
    const onDown = (e: PointerEvent): void => {
      clickRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  // Mount the preview backdrop BEHIND the effect, once for the workbench's whole lifetime — deliberately its
  // own effect, declared ABOVE the build() effect below, so it always mounts (and thus lands at a lower child
  // index on the overlay's `layer`) before build() mounts the per-effect container. `pixiFx.mountLayer` just
  // appends, and a later append renders on top, so as long as this stays mounted for the workbench's whole
  // lifetime, every rebuild in build() (which tears down and re-mounts a fresh container per primitive/scenario
  // change) always lands above it — no z-index/sortableChildren needed, plain append order is sufficient.
  useEffect(() => {
    const backdrop = createBackdrop();
    backdropRef.current = backdrop;
    const unmountLayer = pixiFx.mountLayer(backdrop.container);
    const resize = (): void => backdrop.resize(window.innerWidth, window.innerHeight);
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      unmountLayer();
      backdrop.destroy();
      backdropRef.current = null;
    };
  }, []);

  // Push the selected color to the (persistent) backdrop whenever it changes. Split from the mount effect
  // above so picking a new color never tears down / remounts the backdrop container.
  useEffect(() => {
    backdropRef.current?.setColor(backdropColor);
  }, [backdropColor]);

  // A signature of the layers' STRUCTURE only (primitive/anchor/order), NOT their params and NOT their
  // timing. This is THE key that keeps a param or At/Life drag from respawning the effect while still
  // rebuilding on any genuinely structural change — see the build effect's dependency array below.
  const structKey = useMemo(() => structureKey(layers), [layers]);

  // (Re)build the player whenever the layer STRUCTURE, scenario, OR duration changes. Param tweaks do NOT
  // land here — they go through player.setLayerParams (see `change` below) so a slider drag never respawns
  // the effect mid-gesture; At/Life tweaks likewise go through player.setLayerTiming (see
  // `changeLayerTiming`). Loop-on/off and the loop-gap dial ALSO don't land here (see `toggleLoop` /
  // `changeLoopGap`) -- they're live `setLoop`/`setLoopGap` calls on the existing player, not a rebuild, per
  // the same "don't respawn mid-gesture" reasoning.
  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let container: Container | null = null;
    let unmountLayer: (() => void) | null = null;
    let removeUpdater: (() => void) | null = null;
    let player: FxPlayer | null = null;

    let fpsAccMs = 0;
    let fpsFrames = 0;
    let timeAccMs = 0;
    // Edge-detects `player.isPlaying()` transitions in the per-frame updater below so `uiPlaying` tracks the
    // player's REAL state without a `setState` call on every single frame.
    let lastPlaying = true;

    // ── hoisted out of the per-frame updater ────────────────────────────────────────────────────────────
    // `scenarioId` is a dependency of THIS effect, so the scenario can never change under a live updater —
    // resolving it once per build removes an `Array.prototype.find` from every single frame.
    const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
    // Reused and MUTATED in place each frame rather than reallocated: the updater runs every frame and the
    // scenarios only ever read these (none retains the object it is handed).
    const vp = { w: 0, h: 0 };
    const headCtx: FxHeadContext = { viewport: vp, cursor: { x: 0, y: 0 }, click: null, progress: 0 };
    // A scenario switch is exactly the moment the sampled board rects could be stale (and the moment the
    // author is watching for the change), so force the next read to measure for real. Cheap and idempotent.
    invalidateBoardAnchors();

    const build = (): void => {
      if (disposed) return;
      const renderer = pixiFx.renderer;
      if (!renderer) {
        // attach()/init() is async and may not have resolved yet (e.g. the workbench mounts before the
        // overlay canvas finishes initialising) — poll rather than building a player against a null
        // renderer, which `createPlayer`/the primitive's `spawn` cannot tolerate.
        retryTimer = setTimeout(build, 50);
        return;
      }
      if (layersRef.current.some((l) => !getPrimitive(l.primitive))) {
        // Every layer's primitive must be registered before we can build. The self-registration import is a
        // DEV-gated dynamic import (see the top of this file — needed so prod's dead-code elimination can
        // drop it entirely) so on a very early mount it may not have resolved yet. Poll rather than silently
        // building nothing.
        retryTimer = setTimeout(build, 50);
        return;
      }
      // Cold-boot recovery: the initial `useState` may have run before the primitives registered, leaving a
      // layer's params empty. Fill in real defaults now that every spec exists. Params-only edit → structKey
      // unchanged → this setLayers does NOT respawn the effect (same as the old setParams recovery).
      let recovered: EditorLayer[] | null = null;
      layersRef.current.forEach((l, i) => {
        if (Object.keys(l.params).length === 0) {
          const prim = getPrimitive(l.primitive);
          if (prim) {
            recovered = recovered ?? layersRef.current.slice();
            recovered[i] = { ...l, params: defaultsOf(prim.params) };
          }
        }
      });
      if (recovered) {
        layersRef.current = recovered;
        setLayers(recovered);
      }
      const layersForDef = layersRef.current;

      container = new Container();
      unmountLayer = pixiFx.mountLayer(container);

      const def = toDef(`workbench-${layersForDef[0]?.primitive ?? 'fx'}`, durationMs, layersForDef);
      // NO auto-loop: every build (open, primitive/scenario switch, duration change) always constructs a
      // non-looping player and fires it exactly once, so the effect is visible immediately and then sits
      // idle -- never a continuous loop the user didn't ask for. `loopGapMs` is a dial value that DOES
      // survive the rebuild (see `loopGapRef`); the "is looping" flag deliberately does not (see `setLoopOn`
      // below) -- Loop is opt-in per build, matching the "no auto-loop on open" rule for every rebuild.
      player = createPlayer(def, { container, renderer }, { loop: false, loopGapMs: loopGapRef.current });
      player.setSpeed(speedRef.current);
      // Re-apply the seed BEFORE the auto-fire below, so the very first pass of a rebuilt player already
      // replays the locked roll — this is what makes "swap a primitive / load a def / re-Fire" reproduce the
      // same look instead of re-rolling it. Unlocked hands over `null`: fresh roll per instance, as before.
      player.setSeed(seedLockedRef.current ? seedRef.current : null);
      // Mute is live player state, not def data, so a rebuilt player starts with nothing muted — re-apply the
      // author's muted layers here or an isolated layer would come back the moment anything rebuilt. Solo
      // folds into the same call (see `effectiveMutes`): it silences via mute, so it survives a rebuild too.
      effectiveMutes(layersForDef).forEach((muted, i) => {
        if (muted) player?.setLayerMuted(i, true);
      });
      player.fireOnce();
      playerRef.current = player;
      setUiPlaying(true);
      setTimeMs(0);
      setLoopOn(false);
      lastPlaying = true;

      removeUpdater = pixiFx.addUpdater((dtMs) => {
        const p = player;
        if (!p) return;
        p.update(dtMs);

        const nowPlaying = p.isPlaying();
        if (nowPlaying !== lastPlaying) {
          lastPlaying = nowPlaying;
          setUiPlaying(nowPlaying);
        }

        if (scenario) {
          vp.w = window.innerWidth;
          vp.h = window.innerHeight;
          const progress = (p.timeMs() % durationMs) / durationMs;
          // ONE anchor resolve per frame, shared by every layer — then each layer picks its OWN point out of
          // it by its own `anchor` (see `driveLayerHeads`). This is what makes a composition previewable as
          // the thing it is: a burst pinned to `target` while a ribbon rides the `travel` arc.
          const anchors = scenario.anchorsAt(vp, cursorRef.current);
          // A scenario may drive the head along a custom path (e.g. `bounce` ping-ponging between units,
          // `pinnedCursor` tracking the live pointer, `clickPlace` anchoring to the last click). That path
          // IS the travel point — `driveLayerHeads` substitutes it for the `travel` anchor only, so the
          // scenario's other staged anchors keep resolving normally alongside it.
          let head: FxPoint | null = null;
          if (scenario.headAt) {
            headCtx.cursor = cursorRef.current;
            headCtx.click = clickRef.current;
            headCtx.progress = progress;
            head = scenario.headAt(headCtx);
          }
          // `pixiFx.mountLayer` parents `container` straight onto the overlay stage, which sits at the
          // canvas origin with no transform, and the overlay canvas itself is a full-viewport element at
          // (0,0) — so these page/screen coordinates map directly onto the container's local space with
          // no conversion needed, matching what a primitive's `setHead` assumes.
          driveLayerHeads(p, layersRef.current, anchors, progress, head);
        }

        fpsAccMs += dtMs;
        fpsFrames += 1;
        if (fpsAccMs >= 500) {
          setFps(Math.round((fpsFrames * 1000) / fpsAccMs));
          fpsAccMs = 0;
          fpsFrames = 0;
        }

        timeAccMs += dtMs;
        if (timeAccMs >= 50) {
          setTimeMs(p.timeMs());
          timeAccMs = 0;
        }
      });
    };

    build();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      removeUpdater?.();
      player?.destroy();
      unmountLayer?.();
      container?.destroy({ children: true });
      playerRef.current = null;
    };
  }, [structKey, scenarioId, durationMs]);

  // Commit a new layers array to both the state and the ref mirror the build/updater closures read.
  // Arms the autosave: every caller (add/delete/reorder/primitive-swap/timing/load/prune) is real work.
  const commitLayers = (next: EditorLayer[]): void => {
    layersRef.current = next;
    autosaveArmedRef.current = true;
    setLayers(next);
  };

  /** Set the selected layer index in BOTH the state and its mirror (see `selectedRef`). */
  const applySelected = (i: number): void => {
    selectedRef.current = i;
    setSelected(i);
  };

  /** Set the duration in BOTH the state and its mirror. The actual rebuild is driven by `durationMs` sitting
   *  in the build effect's dependency array, exactly as before. */
  const applyDuration = (ms: number): void => {
    durationRef.current = ms;
    setDurationMs(ms);
  };

  /** Push a whole composition's params AND timing onto the live player. Needed wherever the layers are
   *  replaced wholesale in a way that can leave `structKey` unchanged (so the build effect doesn't re-run) —
   *  a params/timing-only def load, a reorder of two same-primitive layers, discarding restored work, an
   *  undo that only moved params. Without it those paths would leave the running effect on the previous
   *  layers' params/timing. */
  const pushLiveLayers = (next: EditorLayer[]): void => {
    const p = playerRef.current;
    if (!p) return;
    const mutes = effectiveMutes(next);
    next.forEach((l, i) => {
      p.setLayerParams(i, l.params);
      p.setLayerTiming(i, l.at, l.life);
      p.setLayerMuted(i, mutes[i]);
    });
  };

  /** Push only the EFFECTIVE mute of every layer (see `effectiveMutes`). Whole-composition rather than one
   *  layer because solo is a global condition — soloing layer 2 is what silences 0, 1 and 3. A live call, so
   *  isolating a layer leaves every other layer's instance (and its randomness) exactly where it was. */
  const pushLiveMutes = (next: EditorLayer[]): void => {
    const p = playerRef.current;
    if (!p) return;
    effectiveMutes(next).forEach((muted, i) => p.setLayerMuted(i, muted));
  };

  /** The editor state as it stands RIGHT NOW, read from the ref mirrors so it is correct inside an event
   *  handler, before React re-renders. */
  const snapshotNow = (): EditorSnapshot => ({
    layers: layersRef.current,
    selected: selectedRef.current,
    durationMs: durationRef.current,
    seed: seedRef.current,
    seedLocked: seedLockedRef.current,
  });

  // Returns the PREVIOUS object when nothing moved, so React bails out instead of re-rendering: this runs on
  // every step of a slider drag, and after the first step the answer is always "yes, both are available".
  const syncHistoryFlags = (): void => {
    const h = historyRef.current;
    const next = { undo: h !== null && canUndo(h), redo: h !== null && canRedo(h) };
    setHistoryFlags((prev) => (prev.undo === next.undo && prev.redo === next.redo ? prev : next));
  };

  /**
   * Make the CURRENT state undoable, then let the caller change it. Every edit handler calls this FIRST,
   * before touching anything — which is what makes the snapshot the pre-edit state without any handler
   * having to describe what it is about to do.
   *
   * `kind` + `key` are the coalescing identity (see `shouldCoalesce`): a continuous drag on one control
   * re-uses its existing entry instead of pushing a new one, so 60 `input` events are ONE undo step, while a
   * structural action — the primitive swap that resets a layer's params, above all — always gets its own.
   */
  const record = (kind: HistoryKind, key = ''): void => {
    const live = snapshotNow();
    const mark: HistoryMark = { kind, key, atMs: Date.now() };
    // `present` is refreshed from the live state first: between edits it can drift (an unrecorded repair, or
    // simply the edit recorded just before this one), and pushing a stale present would make undo restore a
    // state the author never saw.
    const h = { ...(historyRef.current ?? initHistory(live)), present: live };
    historyRef.current = shouldCoalesce(lastMarkRef.current, mark)
      ? replaceHistoryPresent(h, live) // same gesture — its pre-drag entry is already in `past`
      : pushHistory(h, live);
    lastMarkRef.current = mark;
    syncHistoryFlags();
  };

  /**
   * Apply a restored snapshot through the SAME commit path a normal edit uses — the ref mirrors first (the
   * build effect and the per-frame updater read those), then the state.
   *
   * Records NOTHING: an undo is not an edit. Whether the effect respawns is decided exactly the way every
   * other path decides it — if the structure or duration moved, the build effect rebuilds; if only params /
   * timing / mute moved, they are pushed onto the running instances so nothing re-rolls.
   */
  const applySnapshot = (snap: EditorSnapshot): void => {
    const liveOnly =
      structureKey(snap.layers) === structureKey(layersRef.current) && snap.durationMs === durationRef.current;
    commitLayers(snap.layers);
    applySelected(snap.selected);
    applyDuration(snap.durationMs);
    applySeed(snap.seed, snap.seedLocked);
    cancelRename(); // the row being renamed may not even exist in the restored composition
    if (liveOnly) pushLiveLayers(snap.layers);
  };

  const undoEdit = (): void => {
    const h = historyRef.current;
    if (h === null || !canUndo(h)) return;
    // Refresh `present` before stepping back, so REDO restores what is on screen right now (not the state as
    // of the last recorded edit) — the mirror image of what `record` does.
    const next = undo({ ...h, present: snapshotNow() });
    historyRef.current = next;
    lastMarkRef.current = null; // an undo ends any in-flight gesture: the next edit must push its own entry
    applySnapshot(next.present);
    syncHistoryFlags();
  };

  const redoEdit = (): void => {
    const h = historyRef.current;
    if (h === null || !canRedo(h)) return;
    const next = redo({ ...h, present: snapshotNow() });
    historyRef.current = next;
    lastMarkRef.current = null;
    applySnapshot(next.present);
    syncHistoryFlags();
  };

  // Keep the keydown listener's handlers current without re-binding it every render.
  useEffect(() => {
    undoRef.current = undoEdit;
    redoRef.current = redoEdit;
  });

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (⌘ on mac). Bound to `window` rather than the workbench root because the
  // overlay isn't focusable — while it is open it owns the keyboard. Text entry is exempt (see `isTextEntry`)
  // so typing a def name or a seed keeps its own native undo.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isTextEntry(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // `number[]` covers the editable palette param (a 4-tuple of colour stops); `number[][]` covers the curve
  // param (a list of [t, v] control points). Every value flows unchanged through setLayerParams'
  // `Record<string, unknown>`, then coerceParams validates it per the primitive's spec.
  const change = (key: string, value: number | boolean | string | number[] | number[][]): void => {
    // Keyed by LAYER + param so dragging `size` on one layer and then on another is two undo steps, not one.
    record('param', `${selected}:${key}`);
    autosaveArmedRef.current = true;
    setLayers((prev) => {
      const next = setLayerParam(prev, selected, key, value);
      layersRef.current = next;
      return next;
    });
    // Params-only edit: live-push to the selected layer's instance, no rebuild (structKey unchanged).
    playerRef.current?.setLayerParams(selected, { [key]: value });
  };

  // A restored session can name a primitive that no longer exists (renamed, deleted, or simply not part of
  // this branch). The build effect POLLS while any layer's primitive is unregistered — forever, if it never
  // arrives — so something has to drop it. Runs once on mount, waiting for the DEV-gated dynamic import that
  // registers the primitives to resolve (same 50ms poll as `build()`), then prunes. `pruneUnknownPrimitives`
  // returns null when nothing needs dropping, which is the overwhelmingly common case: no commit, no
  // structKey change, no rebuild.
  useEffect(() => {
    if (restoredSession === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prune = (): void => {
      if (cancelled) return;
      if (listPrimitives().length === 0) {
        timer = setTimeout(prune, REGISTRY_POLL_MS);
        return;
      }
      const kept = pruneUnknownPrimitives(layersRef.current, (id) => getPrimitive(id) !== undefined);
      if (kept === null) return;
      // Deliberately NOT recorded into the undo history: this is a repair of an unloadable session, not an
      // edit the author made, and the first Ctrl+Z should never hand back a composition that can't build.
      if (kept.length > 0) {
        commitLayers(kept);
        applySelected(Math.min(selectedRef.current, kept.length - 1));
      } else {
        // Nothing survived — degrade to a fresh default layer rather than an empty composition (the whole
        // workbench assumes at least one layer, see `removeLayer`).
        const first = listPrimitives()[0]?.id ?? 'ribbon';
        const prim = getPrimitive(first);
        commitLayers([createEditorLayer(first, prim ? defaultsOf(prim.params) : {})]);
        applySelected(0);
      }
    };
    prune();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // Mount-only: `restoredSession` is a one-shot snapshot and `commitLayers` writes through refs.
  }, []);

  // Autosave the whole composition (debounced) so a reload / HMR / panel close can't take the work with it.
  // Deliberately NOT the def file: a git-tracked write on every slider drag is exactly what Save is for.
  // And deliberately the PRESENT only — the undo stack is session-scoped and is never written, so reopening
  // the workbench restores the composition you were looking at, not a half-consumed history to step through.
  useEffect(() => {
    if (!autosaveArmedRef.current) return;
    const timer = setTimeout(
      () => saveSession({ layers, selected, durationMs, seed, seedLocked }),
      AUTOSAVE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [layers, selected, durationMs, seed, seedLocked]);

  // The transient "Saved" confirmation's timer, cleared on unmount.
  useEffect(() => () => {
    if (noteTimerRef.current !== undefined) clearTimeout(noteTimerRef.current);
  }, []);

  // Selecting a layer is NOT an edit: it changes nothing about the effect, and recording it would bury the
  // edits you actually want to reach under a pile of clicks. It still RIDES ALONG in every snapshot, so
  // undoing a delete puts the selection back where it was.
  const selectLayer = (i: number): void => applySelected(i);

  const addNewLayer = (id: string): void => {
    record('structural');
    const prim = getPrimitive(id);
    const next = addLayer(layers, createEditorLayer(id, prim ? defaultsOf(prim.params) : {}));
    commitLayers(next);
    applySelected(next.length - 1);
  };

  /** Copy a tuned layer instead of re-dialling it from defaults. The copy lands directly after the source and
   *  becomes the selection — you almost always want to start changing it immediately. Adding a layer IS a
   *  structural change, so `structureKey` moves and the effect legitimately rebuilds (unlike mute/timing). */
  const duplicateLayerAt = (i: number): void => {
    const next = duplicateLayer(layers, i);
    if (next.length === layers.length) return; // out-of-range guard in the model — nothing was inserted
    record('structural');
    commitLayers(next);
    applySelected(i + 1);
  };

  /** Mute/unmute one layer: a LIVE player call, never a rebuild, so isolating a layer leaves every other
   *  layer's instance (and its randomness) exactly where it was. */
  const toggleMute = (i: number): void => {
    record('structural');
    const next = setLayerMuted(layers, i, !(layers[i]?.muted === true));
    commitLayers(next);
    pushLiveMutes(next);
  };

  /** Solo/un-solo one layer. Same live path as mute (it IS mute, downstream — see `effectiveMuted`), so it
   *  likewise never respawns the composition; but it is pushed for EVERY layer, since turning the first solo
   *  on silences all the others and turning the last one off brings them back. */
  const toggleSolo = (i: number): void => {
    record('structural');
    const next = setLayerSolo(layers, i, !(layers[i]?.solo === true));
    commitLayers(next);
    pushLiveMutes(next);
  };

  /** Begin renaming a row in place. Seeds the box with the CURRENT name, or blank when the row is still
   *  showing its primitive id — you're naming it, not editing "burst". */
  const startRename = (i: number): void => {
    renamingRef.current = i;
    setRenaming(i);
    setRenameText(layers[i]?.name ?? '');
  };

  /** Abandon the in-place rename without touching the layer (Escape, or the composition being replaced). */
  const cancelRename = (): void => {
    renamingRef.current = null;
    setRenaming(null);
  };

  /** Commit the in-place rename. An empty box clears the name (the row goes back to its primitive id), and a
   *  rename that changes nothing records nothing. Purely a label: no live push, no rebuild. */
  const commitRename = (i: number): void => {
    if (renamingRef.current !== i) return; // already committed / cancelled — see `renamingRef`
    cancelRename();
    const trimmed = renameText.trim();
    const current = layers[i]?.name;
    if (trimmed === (current ?? '')) return;
    record('structural');
    commitLayers(setLayerName(layers, i, trimmed));
  };

  const deleteLayer = (i: number): void => {
    record('structural');
    const next = removeLayer(layers, i);
    commitLayers(next);
    applySelected(Math.min(selectedRef.current, next.length - 1));
  };

  const reorderLayer = (i: number, dir: -1 | 1): void => {
    record('structural');
    const next = moveLayer(layers, i, dir);
    commitLayers(next);
    // Swapping two layers that share a primitive+anchor leaves `structKey` unchanged (it no longer carries
    // timing), so no rebuild fires — the live instances would keep the pre-swap params/timing at their new
    // indices. Push them explicitly; harmless when the key DID change and a rebuild is coming anyway.
    pushLiveLayers(next);
    const target = i + dir;
    if (target >= 0 && target < next.length) applySelected(target); // keep selection on the moved layer
  };

  // The TOP primitive-button row edits the SELECTED layer's primitive (resetting its params to the new
  // primitive's defaults). Structural change → structKey changes → the build effect respawns the player.
  // This is the ONE irreversible-feeling action in the tool — every slider you dialled on that layer is gone
  // — so it always takes its own history entry: one Ctrl+Z brings the whole tuned layer back.
  const changeLayerPrimitive = (id: string): void => {
    if (layers[selected]?.primitive === id) return;
    record('structural');
    const prim = getPrimitive(id);
    commitLayers(setLayerPrimitive(layers, selected, id, prim ? defaultsOf(prim.params) : {}));
  };

  // Anchor edit: which staged point this layer's head follows. Unlike params/timing this one deliberately
  // DOES rebuild — `anchor` is part of `structureKey`, and re-pointing a live instance mid-flight would
  // leave a trail that lies about where it has been. A no-op pick (same anchor) is dropped so re-selecting
  // the current value in the <select> can't respawn the effect for nothing.
  const changeLayerAnchor = (anchor: FxAnchorId): void => {
    if (layers[selected]?.anchor === anchor) return;
    record('structural');
    commitLayers(setLayerAnchor(layers, selected, anchor));
  };

  // Timing edit: state (so it persists / survives the next rebuild via `layersRef`) PLUS a live push to the
  // player — never a rebuild. `at`/`life` are no longer part of `structKey`, so the build effect correctly
  // doesn't re-run: the effect keeps playing, the edited layer's window moves under it, and a ribbon's noise
  // seed isn't re-rolled mid-drag. Exactly the shape of `change` above, for timing instead of params.
  const changeLayerTiming = (at: number, life: number | null, field: 'at' | 'life' | 'full' = 'at'): void => {
    // The At/Life sliders are range inputs that fire per pixel of travel, so one gesture has to collapse to
    // one undo step — coalesced exactly like a param drag, keyed by layer AND field so nudging At and then
    // Life is two steps. The Full checkbox is a discrete toggle and always takes its own entry.
    if (field === 'full') record('structural');
    else record('timing', `${selected}:${field}`);
    commitLayers(setLayerTiming(layers, selected, at, life));
    playerRef.current?.setLayerTiming(selected, at, life);
  };

  // Pause/resume. There's no standing continuous loop to "resume" unless Loop is on -- so when Loop is off,
  // resuming just re-fires a fresh one-shot pass (consistent with Fire, and with "no auto-loop" generally);
  // when Loop is on, resuming restarts continuous playback.
  const togglePlay = (): void => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) {
      p.pause();
      setUiPlaying(false);
    } else if (loopOn) {
      p.play();
      setUiPlaying(true);
    } else {
      p.fireOnce();
      setUiPlaying(true);
      setTimeMs(0);
    }
  };

  // Loop toggle -- the ONLY thing that starts continuous looping. OFF -> ON starts a fresh continuous cycle
  // from t=0; ON -> OFF stops and resets, matching "Loop off" meaning "nothing is looping", not "paused
  // mid-loop". Live setLoop()/play()/stop() calls on the existing player -- never a rebuild (see the build
  // effect's comment).
  const toggleLoop = (): void => {
    const p = playerRef.current;
    const next = !loopOn;
    setLoopOn(next);
    if (!p) return;
    if (next) {
      p.setLoop(true);
      p.play();
      setUiPlaying(true);
    } else {
      p.setLoop(false);
      p.stop();
      setUiPlaying(false);
      setTimeMs(0);
    }
  };

  // "Fire" is a discrete one-shot preview -- restart the effect from t=0 and let it run through once,
  // regardless of whether it's currently looping, paused, or already stopped. Deliberately does NOT touch
  // playerRef's identity or rebuild anything; it only retriggers the existing player (see FxPlayer.fireOnce).
  const fire = (): void => {
    const p = playerRef.current;
    if (!p) return;
    p.fireOnce();
    setUiPlaying(true);
    setTimeMs(0);
  };

  const scrub = (ms: number): void => {
    const p = playerRef.current;
    if (!p) return;
    p.pause();
    p.scrub(ms);
    setUiPlaying(false);
    setTimeMs(ms);
  };

  const changeSpeed = (n: number): void => {
    speedRef.current = n;
    setSpeed(n);
    playerRef.current?.setSpeed(n);
  };

  // Loop-gap dial: live `setLoopGap`, no rebuild -- only meaningful once Loop is on, but it's harmless to
  // set while not looping. `loopGapRef` mirrors this into the next `build()` call the same way `speedRef`
  // mirrors `speed`, so the dial's value survives a primitive/scenario/duration rebuild.
  const changeLoopGap = (ms: number): void => {
    loopGapRef.current = ms;
    setLoopGapMs(ms);
    playerRef.current?.setLoopGap(ms);
  };

  /** Apply a seed + lock state to BOTH the mirrors a rebuild reads and the live player. The player call is
   *  the only side effect, and it deliberately doesn't respawn anything: a seed change lands on the NEXT
   *  spawn (Fire, loop wrap, rebuild), so it can never restart an effect out from under you mid-tune. */
  const applySeed = (nextSeed: number, locked: boolean): void => {
    autosaveArmedRef.current = true;
    seedRef.current = nextSeed;
    seedLockedRef.current = locked;
    setSeed(nextSeed);
    setSeedLocked(locked);
    playerRef.current?.setSeed(locked ? nextSeed : null);
  };

  // Typing a seed is as plainly "I want THIS roll" as rerolling is, so it locks too — otherwise the number
  // you just typed would sit there doing nothing until you noticed the padlock. (Judgement call; the toggle
  // still unlocks in one click.) Non-numeric input is ignored rather than coerced to 0.
  const changeSeed = (raw: string): void => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    record('seed'); // typed digit by digit — coalesced, so typing "4242" is one undo step, not four
    applySeed(Math.trunc(n), true);
  };

  const toggleSeedLock = (): void => {
    record('structural');
    applySeed(seed, !seedLocked);
  };

  // Reroll draws a fresh seed and LOCKS it: rerolling while unlocked would be a no-op (every spawn already
  // rolls its own), and "give me a different specific look" is unambiguously the intent.
  const rerollSeed = (): void => {
    record('structural'); // a discrete "give me another" — never folded into the roll before it
    applySeed(randomSeed(), true);
  };

  // Duration dial: deliberately just a `setState` -- the actual rebuild is driven by `durationMs` sitting
  // in the build effect's dependency array (see above), same as primitive/scenario changes.
  const changeDuration = (ms: number): void => {
    record('duration'); // a range input: one drag, one undo step
    autosaveArmedRef.current = true;
    applyDuration(ms);
  };

  // Copy the whole composed DEF as JSON — with multiple layers, the def is the useful artifact, not one
  // layer's params.
  const copyDef = (): void => {
    void navigator.clipboard.writeText(JSON.stringify(toDef('workbench', durationMs, layers), null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  /** Flash a transient confirmation under the Save row. */
  const flashNote = (text: string): void => {
    setSaveNote(text);
    if (noteTimerRef.current !== undefined) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => setSaveNote(null), SAVE_NOTE_MS);
  };

  /** Re-read the committed def registry (a module-level glob React knows nothing about) after a write. */
  const refreshLibrary = (): void => {
    refreshDefs();
    setDefs(listDefs());
  };

  /**
   * Save the composition as a committed def.
   *
   * The subtle half is ART PORTABILITY: a `custom:<slug>` shape param names a PNG that lives only in THIS
   * browser's localStorage, so a def carrying that id renders a fallback silhouette on anyone else's machine.
   * Each one is therefore uploaded to `defs/art/<slug>.png` first and the reference rewritten to
   * `art:<slug>` — in a COPY (`toStoredLayers`), never in the live editor state, so a save can never alter
   * what the author is looking at. An art upload that fails is reported inline and does NOT block the def:
   * the def still saves, that one layer just falls back to a built-in shape elsewhere (exactly today's
   * behaviour for an unknown shape id).
   *
   * Fully async and total: every failure lands in `saveError`, nothing throws into render, and `saving`
   * guards against a double-click writing twice.
   */
  const save = async (): Promise<void> => {
    if (saving) return;
    const id = slugify(defName);
    if (!isValidSlug(id)) {
      setSaveNote(null);
      setSaveError('Name it first — lowercase letters, digits and dashes (max 64 chars).');
      return;
    }
    setSaving(true);
    setSaveNote(null);
    setSaveError(null);
    try {
      const artRefs = new Map<string, string>();
      const artFailures: string[] = [];
      for (const ref of collectCustomShapeRefs(layers)) {
        const dataUrl = getImportedDataUrl(ref);
        if (dataUrl === null) {
          artFailures.push(`${ref} isn't in this browser's shape library`);
          continue;
        }
        const slug = artSlugOf(ref);
        const art = await saveArt(slug, dataUrl);
        if (art.ok) artRefs.set(ref, `${ART_SHAPE_REF_PREFIX}${slug}`);
        else artFailures.push(`${ref}: ${art.error}`);
      }
      // The seed travels with the def ONLY while locked — an unlocked composition means "roll fresh", and
      // writing a seed anyway would silently freeze a look the author deliberately left free.
      const stored = toStoredDef(
        id,
        durationMs,
        toStoredLayers(layers, artRefs),
        seedLocked ? seed : undefined,
      );
      const result = await saveDef(stored);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      // Hand the def we just wrote to the registry BEFORE refreshing: the eager glob behind `listDefs()`
      // cannot see a file created after this module was transformed (verified in the browser — the library
      // stayed empty until a full dev-server restart), so without this the def you just saved is missing from
      // the library you saved it into.
      registerSavedDef(stored);
      refreshLibrary();
      setDefName(id); // show the slug that actually got written
      setSaveError(
        artFailures.length > 0 ? `Saved, but art didn't travel: ${artFailures.join('; ')}` : null,
      );
      flashNote(`Saved → ${result.path}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Replace the editor state with a def — the ONE path every load goes through (library click, Duplicate,
   * Paste). All three `setState`s are batched into a single render, so `structKey` and `durationMs` both
   * settle once and the build effect respawns the player EXACTLY once (a load is a structural change, so it
   * must respawn — but only once).
   *
   * `nameForField` is what lands in the Save box: the def's own id for a plain load, `<id>-copy` for a
   * Duplicate — which is why Duplicate writes no file: it's a template until you hit Save.
   */
  const loadDef = (def: StoredFxDef, nameForField: string): void => {
    // Loading over unsaved work is exactly the "oh no" moment undo exists for, so it is one entry — Ctrl+Z
    // puts the composition you were tuning back, seed and duration included.
    record('structural');
    const fromDef = editorLayersFromDef(def.layers);
    let next = fromDef;
    if (next.length === 0) {
      const first = listPrimitives()[0]?.id ?? 'ribbon';
      const prim = getPrimitive(first);
      next = [createEditorLayer(first, prim ? defaultsOf(prim.params) : {})];
    }
    const nextDuration = clampDuration(def.duration, DURATION_BOUNDS);
    // A def that differs from the current composition ONLY in params and/or TIMING leaves structKey and
    // durationMs untouched — so the build effect (correctly) doesn't re-run and the live player would keep
    // the old params/timing. Push them the same way `change`/`changeLayerTiming` do. Detected BEFORE
    // committing, off the outgoing state.
    const liveOnly = structureKey(next) === structureKey(layers) && nextDuration === durationMs;
    // A def that carries a seed reproduces its EXACT look, so loading one adopts + locks that seed; a def
    // without one deliberately means "roll fresh", so loading it unlocks. Applied BEFORE `commitLayers` so
    // the mirrors are already right if this load triggers a rebuild.
    applySeed(def.seed ?? seed, def.seed !== undefined);
    commitLayers(next);
    applySelected(0);
    applyDuration(nextDuration);
    cancelRename();
    setDefName(nameForField);
    setSaveNote(null);
    setSaveError(null);
    setRestoredNotice(false); // the restored work has just been replaced — the banner would be a lie
    if (liveOnly) pushLiveLayers(next);
  };

  /** Throw the restored work away and start from a fresh default composition. Disarms the autosave so the
   *  reset doesn't immediately write itself straight back into storage. */
  const discardRestored = (): void => {
    // Recorded, so Discard stops being the one-way door it looks like: Ctrl+Z brings the restored work back
    // (and re-arms the autosave, so it is durable again).
    record('structural');
    clearSession();
    const first = listPrimitives()[0]?.id ?? 'ribbon';
    const prim = getPrimitive(first);
    const fresh = [createEditorLayer(first, prim ? defaultsOf(prim.params) : {})];
    commitLayers(fresh);
    // Same reasoning as `loadDef`: if the discarded work happened to share the fresh default's structure,
    // structKey is unchanged and nothing rebuilds — push the defaults onto the live player explicitly.
    pushLiveLayers(fresh);
    applySelected(0);
    applyDuration(DEFAULT_DURATION_MS);
    cancelRename();
    // A fresh default composition is an UNLOCKED one (the default feel): the restored work's frozen roll
    // goes with the work it belonged to. The number itself is kept so locking again is one click.
    applySeed(seed, false);
    setRestoredNotice(false);
    autosaveArmedRef.current = false; // AFTER commitLayers/applySeed, which arm it
  };

  // The selected layer drives the top primitive row, the Inspector, and the timing controls. Fallback to the
  // last layer guards the brief window after a delete before `selected` re-clamps.
  const selLayer = layers[selected] ?? layers[layers.length - 1];
  const activePrimitive = getPrimitive(selLayer.primitive);
  const activeScenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  // Which layers are silenced right now, mute and solo folded together — the same value pushed to the
  // player, so the list can't disagree with what you're hearing/seeing.
  const liveMutes = effectiveMutes(layers);

  return (
    <div className="fxwb">
      <div className="fxwb-top">
        <div className="fxwb-title">🎨 FX Workbench</div>
        {/* Undo/redo sits first because it is the safety net for everything to its right — above all the
            primitive row, where one mis-click resets a tuned layer to that primitive's defaults. */}
        <div className="fxwb-group fxwb-history">
          <button
            className="fxwb-btn fxwb-history-btn"
            onClick={undoEdit}
            disabled={!historyFlags.undo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            ↶
          </button>
          <button
            className="fxwb-btn fxwb-history-btn"
            onClick={redoEdit}
            disabled={!historyFlags.redo}
            title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
            aria-label="Redo"
          >
            ↷
          </button>
        </div>
        <div className="fxwb-group">
          {listPrimitives().map((prim) => (
            <button
              key={prim.id}
              className={`fxwb-btn${prim.id === selLayer.primitive ? ' on' : ''}`}
              onClick={() => changeLayerPrimitive(prim.id)}
            >
              {prim.id}
            </button>
          ))}
        </div>
        <div className="fxwb-group">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`fxwb-btn${s.id === scenarioId ? ' on' : ''}`}
              onClick={() => setScenarioId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="fxwb-group fxwb-backdrop-group">
          <span className="fxwb-backdrop-label">Backdrop</span>
          {BACKDROP_SWATCHES.map((sw) => (
            <button
              key={sw.label}
              className={`fxwb-backdrop-swatch${sw.hex === null ? ' none' : ''}${backdropColor === sw.hex ? ' on' : ''}`}
              style={sw.hex !== null ? { background: `#${sw.hex.toString(16).padStart(6, '0')}` } : undefined}
              title={sw.label}
              onClick={() => setBackdropColor(sw.hex)}
            />
          ))}
          <input
            className={`fxwb-backdrop-custom${backdropColor !== null && !BACKDROP_SWATCHES.some((sw) => sw.hex === backdropColor) ? ' on' : ''}`}
            type="color"
            title="Custom backdrop color"
            value={`#${(backdropColor ?? 0x808080).toString(16).padStart(6, '0')}`}
            onChange={(e) => setBackdropColor(parseInt(e.target.value.slice(1), 16))}
          />
        </div>
        <div className="fxwb-fps">{fps} fps</div>
        <button className="fxwb-close" onClick={onClose} title="Close FX Workbench">✕</button>
      </div>

      <div className="fxwb-side">
        {restoredNotice && (
          <div className="fxwb-def-restore">
            <span className="fxwb-def-restore-txt">Restored unsaved work.</span>
            <button
              type="button"
              className="fxwb-def-restore-discard"
              title="Throw the restored work away and start from a fresh default composition"
              onClick={discardRestored}
            >
              Discard
            </button>
            <button
              type="button"
              className="fxwb-def-restore-x"
              title="Keep it — just hide this"
              aria-label="Dismiss"
              onClick={() => setRestoredNotice(false)}
            >
              ✕
            </button>
          </div>
        )}
        <div className="fxwb-layers">
          {layers.map((l, i) => (
            <div
              key={i}
              className={
                `fxwb-layer-row${i === selected ? ' on' : ''}${l.muted === true ? ' muted' : ''}` +
                `${l.solo === true ? ' solo' : ''}` +
                // Silenced BY SOLO (rather than by its own mute) — dimmed the same way, because "why can't I
                // see this layer?" has to be answerable from the list itself.
                `${liveMutes[i] && l.muted !== true ? ' silenced' : ''}`
              }
              onClick={() => selectLayer(i)}
            >
              {renaming === i ? (
                <input
                  className="fxwb-layer-rename"
                  type="text"
                  aria-label="Layer name"
                  spellCheck={false}
                  autoFocus
                  placeholder={l.primitive}
                  value={renameText}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => commitRename(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(i);
                    else if (e.key === 'Escape') cancelRename();
                  }}
                />
              ) : (
                <span
                  className="fxwb-layer-name"
                  title={l.name === undefined ? 'Double-click to name this layer' : `${l.name} (${l.primitive}) — double-click to rename`}
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(i); }}
                >
                  {l.name ?? l.primitive}
                </span>
              )}
              {/* Anchor sits in the row meta so a composition reads at a glance — "which layer is pinned to
                  the target and which one rides the arc?" is the first question you ask of one. A NAMED layer
                  keeps its primitive id here, so naming never costs you the "what is this?" answer. */}
              <span className="fxwb-layer-meta">
                {l.name === undefined ? '' : `${l.primitive} · `}
                {l.anchor} · @{l.at}ms · {l.life === null ? 'full' : `${l.life}ms`}{l.muted === true ? ' · muted' : ''}{l.solo === true ? ' · solo' : ''}
              </span>
              <span className="fxwb-layer-btns">
                <button
                  className={`fxwb-layer-mute${l.muted === true ? ' on' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleMute(i); }}
                  title={l.muted === true ? 'Muted — click to bring this layer back' : 'Mute this layer (isolate the others)'}
                >{l.muted === true ? '◐' : '👁'}</button>
                <button
                  className={`fxwb-layer-solo${l.solo === true ? ' on' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleSolo(i); }}
                  title={l.solo === true ? 'Soloed — click to bring the other layers back' : 'Solo this layer (only soloed layers play)'}
                >{l.solo === true ? '◉' : '○'}</button>
                <button
                  onClick={(e) => { e.stopPropagation(); startRename(i); }}
                  title="Rename this layer (or double-click its name)"
                >✎</button>
                <button
                  onClick={(e) => { e.stopPropagation(); duplicateLayerAt(i); }}
                  title="Duplicate this layer (a full copy of its tuning, inserted below)"
                >⧉</button>
                <button
                  onClick={(e) => { e.stopPropagation(); reorderLayer(i, -1); }}
                  disabled={i === 0}
                  title="Move up"
                >↑</button>
                <button
                  onClick={(e) => { e.stopPropagation(); reorderLayer(i, 1); }}
                  disabled={i === layers.length - 1}
                  title="Move down"
                >↓</button>
                {layers.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteLayer(i); }}
                    title="Remove layer"
                  >✕</button>
                )}
              </span>
            </div>
          ))}
          <div className="fxwb-layer-add">
            <select value={addPrimitiveId} onChange={(e) => setAddPrimitiveId(e.target.value)}>
              {listPrimitives().map((prim) => <option key={prim.id} value={prim.id}>{prim.id}</option>)}
            </select>
            <button onClick={() => addNewLayer(addPrimitiveId)} title="Add layer">＋</button>
          </div>
        </div>

        <div className="fxwb-timing">
          {/* Which staged point this layer's head follows. Lives with At/Life because the three together are
              "when and where this layer happens" — the whole of a layer's placement in the composition. */}
          <label className="fxwb-anchorrow" htmlFor="fxwb-layer-anchor">
            <span>Anchor</span>
            <select
              id="fxwb-layer-anchor"
              value={selLayer.anchor}
              title="Which staged point this layer follows: travel = the source→target arc, target = pinned to the target, …"
              onChange={(e) => changeLayerAnchor(e.target.value as FxAnchorId)}
            >
              {FX_ANCHOR_IDS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label htmlFor="fxwb-layer-at">At</label>
          <input
            id="fxwb-layer-at"
            type="range"
            min={0}
            max={durationMs}
            step={10}
            value={selLayer.at}
            onChange={(e) => changeLayerTiming(Number(e.target.value), selLayer.life, 'at')}
          />
          <span className="fxwb-val">{selLayer.at} ms</span>
          <label className="fxwb-timing-full">
            <input
              type="checkbox"
              checked={selLayer.life === null}
              onChange={(e) =>
                changeLayerTiming(
                  selLayer.at,
                  e.target.checked ? null : Math.min(durationMs, Math.max(10, selLayer.life ?? durationMs)),
                  'full',
                )
              }
            />
            Full
          </label>
          {selLayer.life !== null && (
            <>
              <input
                type="range"
                min={10}
                max={durationMs}
                step={10}
                value={selLayer.life}
                onChange={(e) => changeLayerTiming(selLayer.at, Number(e.target.value), 'life')}
              />
              <span className="fxwb-val">{selLayer.life} ms</span>
            </>
          )}
        </div>

        {activePrimitive && <Inspector specs={activePrimitive.params} values={selLayer.params} onChange={change} />}
        <button className="fxwb-copy" onClick={copyDef}>{copied ? 'Copied!' : 'Copy def'}</button>

        {/* Durable defs: name + Save writes a committed `defs/<id>.json` (and any imported art alongside it);
            the library below loads / duplicates / pastes one back into the editor. */}
        <div className="fxwb-def">
          <div className="fxwb-def-saverow">
            <input
              className="fxwb-def-nameinput"
              type="text"
              placeholder="def-name"
              aria-label="Def name"
              spellCheck={false}
              value={defName}
              onChange={(e) => setDefName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
            <button
              type="button"
              className="fxwb-def-save"
              disabled={saving}
              title="Write this composition to packages/ui/src/fx/defs/<name>.json"
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {saveNote !== null && <div className="fxwb-def-note">{saveNote}</div>}
          {saveError !== null && <div className="fxwb-def-err">{saveError}</div>}
          <DefLibrary
            defs={defs}
            onLoad={(def) => loadDef(def, def.id)}
            onDuplicate={(def) => loadDef(def, `${def.id}-copy`)}
          />
        </div>
      </div>

      <div className="fxwb-transport">
        <button className="fxwb-play" onClick={togglePlay} title={uiPlaying ? 'Pause' : 'Play'}>
          {uiPlaying ? '⏸' : '▶'}
        </button>
        <button className="fxwb-fire" onClick={fire} title="Fire a single one-shot preview (no loop)">
          🔥 Fire
        </button>
        <input
          className="fxwb-scrub"
          type="range"
          min={0}
          max={durationMs}
          value={timeMs}
          onChange={(e) => scrub(Number(e.target.value))}
        />
        <span className="fxwb-time">{Math.round(timeMs)} / {durationMs} ms</span>

        <div className="fxwb-loopgroup" title="Loop is opt-in -- Fire above always stays a single one-shot pass regardless of this toggle">
          <button
            className={`fxwb-loop-toggle${loopOn ? ' on' : ''}`}
            onClick={toggleLoop}
            title={loopOn ? 'Loop is ON -- click to stop' : 'Loop is OFF -- click to loop continuously'}
          >
            {loopOn ? '🔁 Loop: On' : '🔁 Loop: Off'}
          </button>
          <label className="fxwb-speedlabel" htmlFor="fxwb-duration">Duration</label>
          <input
            id="fxwb-duration"
            className="fxwb-speed"
            type="range"
            min={MIN_DURATION_MS}
            max={MAX_DURATION_MS}
            step={DURATION_STEP_MS}
            value={durationMs}
            onChange={(e) => changeDuration(Number(e.target.value))}
          />
          <span className="fxwb-speedval">{durationMs} ms</span>
          <label className="fxwb-speedlabel" htmlFor="fxwb-loopgap">Loop gap</label>
          <input
            id="fxwb-loopgap"
            className="fxwb-speed"
            type="range"
            min={0}
            max={MAX_LOOP_GAP_MS}
            step={LOOP_GAP_STEP_MS}
            value={loopGapMs}
            onChange={(e) => changeLoopGap(Number(e.target.value))}
          />
          <span className="fxwb-speedval">{loopGapMs} ms</span>
        </div>

        {/* Seed: unlocked = every spawn rolls its own randomness (the historical feel); locked = the shown
            seed is used, so the LOOK is frozen while you tune everything else. A change lands on the next
            spawn -- press Fire (or Loop) to see it. */}
        <div
          className="fxwb-seedgroup"
          title="Lock the seed to freeze the randomness while you tune other params. Takes effect on the next Fire."
        >
          <button
            className={`fxwb-seed-lock${seedLocked ? ' on' : ''}`}
            onClick={toggleSeedLock}
            title={seedLocked ? 'Seed is LOCKED -- click to roll fresh every spawn' : 'Seed is UNLOCKED (fresh roll every spawn) -- click to freeze this one'}
          >
            {seedLocked ? '🔒' : '🔓'}
          </button>
          <label className="fxwb-speedlabel" htmlFor="fxwb-seed">Seed</label>
          <input
            id="fxwb-seed"
            className="fxwb-seedinput"
            type="number"
            step={1}
            value={seed}
            spellCheck={false}
            onChange={(e) => changeSeed(e.target.value)}
          />
          <button className="fxwb-seed-reroll" onClick={rerollSeed} title="Roll a new seed (and lock it)">
            🎲
          </button>
        </div>

        <label className="fxwb-speedlabel" htmlFor="fxwb-speed">Speed</label>
        <input
          id="fxwb-speed"
          className="fxwb-speed"
          type="range"
          min={0.1}
          max={3}
          step={0.1}
          value={speed}
          onChange={(e) => changeSpeed(Number(e.target.value))}
        />
        <span className="fxwb-speedval">{speed.toFixed(1)}x</span>
        <div className="fxwb-hint">{activeScenario?.hint}</div>
      </div>
    </div>
  );
}
