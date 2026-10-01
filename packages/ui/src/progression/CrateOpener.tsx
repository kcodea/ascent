import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { COSMETIC_CATEGORY_DEFS, RARITY_LABELS, cosmeticOf, crateLabel, type OpenCrateResult } from '@game/progression';
import { playTailedClip, sfx, type SfxHandle } from '../sfx';
import { stageHost } from '../stage';
import { skinArtOf } from '../skins/skinArt';
import { openCrate, type CrateOpenOutcome } from './progressionStore';
import {
  CRATE_CUE_CATEGORY, chestTuningOf, crateBeats, crateCue, crateFxSpeed, getCrateFxConfig, presetFor,
  type CrateCue, type CrateFxConfig, type CratePreset,
} from './crateFx/crateFxConfig';
import { createCrateFx, type CrateFx } from './crateFx/crateFxPixi';
import './crateFx/crateTheatre.css';

/**
 * THE CRATE THEATRE (2026-09-28, owner ask: "build a AAA animation for crate opening, with pixi and everything"):
 * a full-stage overlay where one crate at a time is opened, on the player's click, never forced. Used by the
 * Collection screen (Open, Open all) and the post-game "Crate earned" row. The server picks the reward at open
 * time; this only presents it.
 *
 * THE FLOW (see `crateFxConfig.ts` for every number):
 *   sealed -> ANTICIPATION (at once on the click, while the request is in flight; holds while the server is slow,
 *   "Still opening" after a while) -> the answer + the anticipation's minimum -> CHARGE -> BURST -> REVEAL ->
 *   SETTLED (Open next / Done). A failed answer winds down to "Could not open the crate. Try again."; an empty
 *   pool says so and leaves the crate sealed.
 *
 * SKIP: a click on the theatre (not on a button) or a key jumps straight to the settled reveal. Pressed before the
 * answer, it lands on the reveal the moment the answer arrives. REDUCED MOTION: no Pixi, no shake, no timeline:
 * the reward fades in. The Pixi layer is `crateFx/` (its own Application, destroyed with the theatre); if it
 * cannot start, the DOM crate stands in and the flow is unchanged.
 *
 * MOTION: DOM animation is transform/opacity only; the one looping piece (the settled aura's breathing) is the
 * opacity of a pseudo-element with a static shadow (the kwglow pattern). The screen shake is a one-shot WAAPI
 * transform. Buttons take the global gauntlet cursor (no cursor rules). Rendered into `stageHost()`.
 */

/** The painted gem the nameplate wears (recoloured per rarity in CSS, a static filter). */
const GEM_ART = `${import.meta.env.BASE_URL}frames/end_button_gem.webp`;

/** `earnedLevel` null + `source` = a non-level crate (a Gauntlet crate, 2026-09-29); `crateLabel` names both. */
export interface CrateQueueItem { crateId: string; earnedLevel: number | null; source?: string }

type Phase = 'sealed' | 'anticipation' | 'charge' | 'burst' | 'reveal' | 'settled' | 'exhausted' | 'error';

/** Phases a click or key skips out of. */
const SKIPPABLE: readonly Phase[] = ['anticipation', 'charge', 'burst', 'reveal'];

/** The anticipation's dials from the config. */
function anticipation(c: CrateFxConfig): { antMs: number; antShake: number; antGlow: number; pulseMs: number } {
  return { antMs: c.anticipationMs, antShake: c.anticipationShake, antGlow: c.anticipationGlow, pulseMs: c.pulseStartMs };
}

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** The reward's player-facing name; a newer server's item on an older client still reads sensibly. */
export function rewardLabel(rewardId: string | null): { name: string; kind: string; rarity: string | null; rarityLabel: string | null } {
  const def = cosmeticOf(rewardId);
  if (!def) return { name: 'New reward', kind: 'Update the game to see it', rarity: null, rarityLabel: null };
  // Skins name themselves as skins ("New hero skin"), not "New hero" (the Collection tab is called Heroes).
  const kind = def.category === 'title' ? 'New title'
    : def.category === 'hero_skin' ? 'New hero skin'
    : def.category === 'minion_skin' ? 'New minion skin'
    : `New ${COSMETIC_CATEGORY_DEFS[def.category].label.replace(/s$/, '').toLowerCase()}`;
  return { name: def.name, kind, rarity: def.rarity, rarityLabel: RARITY_LABELS[def.rarity] };
}

export interface CrateOpenerProps {
  /** Sealed crates to open, in order. Items opened here are skipped as the list updates. */
  queue: readonly CrateQueueItem[];
  /** Start opening the first crate at once (the caller's own Open button was the click). */
  autoOpen?: boolean;
  /** Open all: after each reward settles, the next crate starts by itself. */
  openAll?: boolean;
  reducedMotion?: boolean;
  /** Test hook: the minimum anticipation (ms), overriding the tuner's. */
  minShakeMs?: number;
  /** Called as an opening starts (before the request): the caller can freeze its queue. */
  onStart?: () => void;
  onOpened?: (r: OpenCrateResult) => void;
  /** Done / Escape. Without it the theatre has no Done button. */
  onClose?: () => void;
  /** Where the opening asks for its reward. Default: the server. The tuner passes a local fake. */
  open?: (crateId: string) => Promise<CrateOpenOutcome>;
}

export function CrateOpener({ queue, autoOpen = false, openAll = false, reducedMotion, minShakeMs, onStart, onOpened, onClose, open }: CrateOpenerProps): JSX.Element | null {
  const reduced = reducedMotion ?? prefersReducedMotion();
  const openFn = open ?? openCrate;
  const [active, setActive] = useState<CrateQueueItem | null>(null);
  const [phase, setPhase] = useState<Phase>('sealed');
  const [result, setResult] = useState<OpenCrateResult | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const [found, setFound] = useState<string[]>([]);
  const [slow, setSlow] = useState(false);
  const [skipped, setSkipped] = useState(false);
  /** The Pixi layer: starting, live, or failed (the DOM crate stands in only when it FAILED, never while starting). */
  const [fxState, setFxState] = useState<'pending' | 'live' | 'failed'>('pending');
  const [preset, setPreset] = useState<CratePreset | null>(null);
  const live = useRef(true);
  const gen = useRef(0);
  const timers = useRef<number[]>([]);
  const hum = useRef<SfxHandle | null>(null);
  const cues = useRef<SfxHandle[]>([]);
  const fx = useRef<CrateFx | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  /** The opening in progress: its answer, whether a skip is waiting for it, when it began. */
  const flow = useRef<{ outcome: CrateOpenOutcome | null; skip: boolean; began: number; preset: CratePreset | null; phase: Phase }>(
    { outcome: null, skip: false, began: 0, preset: null, phase: 'sealed' },
  );
  const doneRef = useRef(done);
  doneRef.current = done;
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // Set on every mount (StrictMode mounts twice; a cleanup-only effect would leave it false for good).
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const go = (p: Phase): void => { flow.current.phase = p; setPhase(p); };
  const clearTimers = (): void => { for (const t of timers.current) window.clearTimeout(t); timers.current = []; };
  const at = (ms: number, fn: () => void): void => {
    if (ms <= 0) { fn(); return; }
    timers.current.push(window.setTimeout(fn, ms));
  };
  /** The current rarity's pitch (1 until the answer is in). Every cue plays at it, times its own `rate`. */
  const pitch = useRef(1);
  const cue = (name: CrateCue, o: { rate?: number; gain?: number } = {}): void => {
    const s = crateCue(getCrateFxConfig(), name);
    const rate = Math.max(0.5, Math.min(2, pitch.current * (o.rate ?? 1) * (crateFxSpeed() < 1 ? 1 : 1)));
    const h = playTailedClip(s.clip, CRATE_CUE_CATEGORY[name], { gain: s.gain * (o.gain ?? 1), startMs: s.startMs, lenMs: s.lenMs, tail: s.tail, rate });
    if (!h) return;
    if (name === 'hum') hum.current = h; else cues.current.push(h);
    if (cues.current.length > 12) cues.current.shift();
  };
  /** The heartbeat tick, on the Pixi pulse (rising in pitch with the pulse's intensity). */
  const lastTick = useRef(0);
  const tick = (k: number): void => {
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    if (now - lastTick.current < 70) return;
    lastTick.current = now;
    cue('pulse', { rate: 0.85 + 0.45 * k, gain: 0.5 + 0.5 * k });
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const stopHum = (): void => { hum.current?.stop(); hum.current = null; };
  const stopAll = (): void => { stopHum(); for (const h of cues.current) h.stop(); cues.current = []; };

  // ── the Pixi layer: one per theatre, destroyed with it ──
  useEffect(() => {
    const host = hostRef.current;
    if (reduced || !host) return;
    const c = getCrateFxConfig();
    const ctl = createCrateFx();
    fx.current = ctl;
    ctl.setArt(c.crateArt);
    ctl.tune(chestTuningOf(c));
    ctl.onPulse((k) => tickRef.current(k));
    ctl.resize(host.clientWidth, host.clientHeight, c.crateScale);
    // A remount mid-opening (React StrictMode mounts every effect twice in dev) gets a fresh controller: bring it
    // to where the opening already is, so the request that is already in flight lands on a live crate.
    const f = flow.current;
    if (f.phase === 'anticipation') ctl.anticipate(anticipation(c));
    else if (f.preset && f.phase !== 'sealed' && f.phase !== 'error' && f.phase !== 'exhausted') ctl.skipToSettled(f.preset);
    let alive = true;
    void ctl.mount(host).then((ok) => { if (alive && live.current) setFxState(ok ? 'live' : 'failed'); });
    // Event-driven geometry: the host only changes size when the window does.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      ctl.resize(host.clientWidth, host.clientHeight, getCrateFxConfig().crateScale);
    });
    ro?.observe(host);
    return () => { alive = false; ro?.disconnect(); ctl.destroy(); if (fx.current === ctl) fx.current = null; };
  }, [reduced]);

  // Unmount: nothing may fire into a dead theatre. (The in-flight request checks `live`, which a StrictMode
  // remount sets back to true, so the dev double mount does not strand an opening.)
  useEffect(() => () => { clearTimers(); stopAll(); }, []);

  const pendingOf = (activeId: string | null, doneSet: ReadonlySet<string>): CrateQueueItem[] =>
    queueRef.current.filter((c) => !doneSet.has(c.crateId) && c.crateId !== activeId);


  const settleAndMaybeNext = (g: number, speedK: number): void => {
    if (!openAll) return;
    const next = pendingOf(null, doneRef.current)[0];
    if (!next) return;
    at(getCrateFxConfig().autoNextMs * speedK, () => { if (g === gen.current && live.current) start(next); });
  };

  /** A few coin clinks at random pitches, spread over the shower. */
  const coinClinks = (): void => {
    const g = gen.current;
    const k = 1 / crateFxSpeed();
    for (let i = 0; i < 4; i++) at((60 + i * 110 + Math.random() * 60) * k, () => { if (g === gen.current) cue('coin', { rate: 0.95 + Math.random() * 0.4, gain: 1 - i * 0.18 }); });
  };

  /** Jump to the settled reveal (a skip, or a skip that was waiting for the answer). */
  const skipNow = (g: number, p: CratePreset, speedK: number): void => {
    // The reveal sparkle has already played if the skip came during the reveal itself.
    const sparkled = flow.current.phase === 'reveal';
    clearTimers();
    stopHum();
    fx.current?.skipToSettled(p);
    setSkipped(true);
    go('settled');
    if (!reduced && !sparkled) cue('reveal');
    settleAndMaybeNext(g, speedK);
  };

  /** The answer is in and the anticipation's minimum is over: branch to the rarity's sequence (or the failure). */
  const branch = (g: number, out: CrateOpenOutcome, item: CrateQueueItem): void => {
    if (g !== gen.current || !live.current) return;
    const c = getCrateFxConfig();
    const speedK = 1 / crateFxSpeed();
    setSlow(false);
    if (out.status !== 'ok' || out.result.status === 'pool_exhausted') {
      if (out.status === 'ok') setResult(out.result);
      stopHum();
      fx.current?.windDown(c.windDownMs);
      at(reduced ? 0 : c.windDownMs * speedK, () => { if (g === gen.current && live.current) go(out.status === 'ok' ? 'exhausted' : 'error'); });
      return;
    }
    const r = out.result;
    const reward = rewardLabel(r.rewardId);
    const p = presetFor(reward.rarity, c);
    flow.current.preset = p;
    setPreset(p);
    setResult(r);
    setDone((d) => new Set(d).add(item.crateId));
    doneRef.current = new Set(doneRef.current).add(item.crateId);
    setFound((f) => [...f, r.rewardId ?? '']);
    onOpened?.(r);
    if (reduced) {
      setSkipped(false);
      go('settled');
      sfx.discover();
      settleAndMaybeNext(g, speedK);
      return;
    }
    if (flow.current.skip) { skipNow(g, p, speedK); return; }
    const b = crateBeats(p, c, { speed: crateFxSpeed() });
    const big = p.rarity === 'epic' || p.rarity === 'legendary';
    pitch.current = p.pitch;
    go('charge');
    fx.current?.charge(p);
    cue('charge');
    // The hum cuts at the hitch: a beat of near-silence before the hit.
    at(b.hitchAt, () => { if (g === gen.current) stopHum(); });
    at(b.burstAt, () => {
      if (g !== gen.current) return;
      go('burst');
      fx.current?.burst(p);
      stopHum();
      cue('burst');
      if (big) cue('crack', { rate: 1.05 });
      if (!p.doubleBurst && p.coins > 0) coinClinks();
    });
    if (b.burst2At >= 0) {
      at(b.burst2At, () => {
        if (g !== gen.current) return;
        cue('burst', { rate: 1.12, gain: 0.7 });
        if (p.coins > 0) coinClinks();
      });
    }
    at(b.revealAt, () => {
      if (g !== gen.current) return;
      go('reveal');
      fx.current?.reveal(p);
      cue('whoosh');
    });
    at(b.gemAt, () => { if (g === gen.current) cue('reveal'); });
    at(b.ribbonAt, () => {
      if (g !== gen.current) return;
      cue('stamp');
      if (p.sting) cue('sting');
    });
    at(b.settleAt, () => {
      if (g !== gen.current) return;
      go('settled');
      fx.current?.settle(c.settleMs);
      settleAndMaybeNext(g, speedK);
    });
  };

  const start = (item: CrateQueueItem): void => {
    const g = ++gen.current;
    clearTimers();
    stopAll();
    const c = getCrateFxConfig();
    const speedK = 1 / crateFxSpeed();
    onStart?.();
    setActive(item);
    setResult(null);
    setPreset(null);
    setSkipped(false);
    setSlow(false);
    pitch.current = 1;
    flow.current = { outcome: null, skip: false, began: Date.now(), preset: null, phase: 'anticipation' };
    go('anticipation');
    const ctl = fx.current;
    if (ctl) {
      ctl.setSpeed(crateFxSpeed());
      ctl.setArt(c.crateArt);
      ctl.tune(chestTuningOf(c));
      ctl.reset();
      ctl.anticipate(anticipation(c));
    }
    if (!reduced) cue('hum');
    at(c.slowNoteMs * speedK, () => { if (g === gen.current && flow.current.outcome === null) setSlow(true); });
    const hold = reduced ? 0 : (minShakeMs ?? c.anticipationMs) * speedK;
    void openFn(item.crateId)
      .catch((e: unknown): CrateOpenOutcome => ({ status: 'error', reason: String((e as Error)?.message ?? e) }))
      .then((out) => {
        if (g !== gen.current || !live.current) return;
        flow.current.outcome = out;
        const wait = flow.current.skip ? 0 : Math.max(0, hold - (Date.now() - flow.current.began));
        at(wait, () => branch(g, out, item));
      });
  };

  const skip = useCallback((): void => {
    const f = flow.current;
    if (!SKIPPABLE.includes(f.phase)) return;
    if (!f.outcome) { f.skip = true; return; }
    if (f.outcome.status !== 'ok' || f.outcome.result.status === 'pool_exhausted') return;
    // Answered: either still in the anticipation's minimum (branch pending) or mid-sequence.
    if (!f.preset) { f.skip = true; clearTimers(); const item = active; if (item) branch(gen.current, f.outcome, item); return; }
    skipNow(gen.current, f.preset, 1 / crateFxSpeed());
  }, [active]); // the beats it calls are read from this render on purpose

  // Keys: Escape closes; any other key skips while the sequence is running.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (onClose) { e.stopPropagation(); e.preventDefault(); onClose(); }
        return;
      }
      if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      if (!SKIPPABLE.includes(flow.current.phase)) return;
      e.preventDefault();
      e.stopPropagation();
      skip();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, skip]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoStarted.current || !queue[0]) return;
    autoStarted.current = true;
    start(queue[0]);
  }, [autoOpen]); // once, on mount: `start` and `queue` are read at that moment on purpose

  const pending = pendingOf(active?.crateId ?? null, done);
  const shown = active ?? pending[0] ?? null;
  if (!shown) return null;
  const reward = result && result.rewardId ? rewardLabel(result.rewardId) : null;
  const revealed = (phase === 'reveal' || phase === 'settled') && !!reward;
  // A skin shows its art beside the plate (owner 2026-09-29); a title needs no preview, the plate IS the title.
  const rewardDef = result?.rewardId ? cosmeticOf(result.rewardId) : undefined;
  const skinKind = rewardDef?.category === 'hero_skin' ? 'hero' : rewardDef?.category === 'minion_skin' ? 'minion' : null;
  const skinUrl = skinKind ? skinArtOf(rewardDef) : undefined;
  const next = phase === 'settled' ? pending[0] ?? null : null;
  const c = getCrateFxConfig();
  const k = 1 / crateFxSpeed();
  const ms = (v: number): string => `${Math.round(v * k)}ms`;
  const vars = {
    '--cr-color': preset?.colorCss ?? '#ffd88a',
    '--cr-rise': ms(c.riseMs),
    '--cr-gem-delay': ms(c.gemDelayMs),
    '--cr-stamp': ms(c.stampMs),
    '--cr-stamp-delay': ms(c.stampDelayMs),
    '--cr-ribbon-delay': ms(c.ribbonDelayMs),
    '--cr-shine-delay': ms(c.shineDelayMs),
    '--cr-shine': ms(c.shineMs),
    '--cr-rays': String(preset ? Math.min(1, preset.rays) : 0),
    '--cr-blur': `${c.backdropBlur}px`,
    '--cr-fade': `${Math.round(c.reducedFadeMs)}ms`,
  } as CSSProperties;
  const domCrate = reduced || fxState === 'failed';
  const summary = openAll && phase === 'settled' && !next && found.length > 1;

  const onPointerDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return;
    skip();
  };

  const theatre = (
    <div
      className={`crate crth ph-${phase}${reduced ? ' reduced' : ''}${skipped ? ' skipped' : ''}${domCrate ? ' domcrate' : ''}${preset ? ` r-${preset.rarity}` : ''}`}
      style={vars}
      role="dialog"
      aria-modal="true"
      aria-label="Opening a crate"
      onPointerDown={onPointerDown}
    >
      <div className="crth-scrim" aria-hidden />
      <div className="crth-box">
        {/* The Pixi canvas covers the whole theatre, so the flash, rings and rays never clip at a box edge. */}
        <div className="crth-fx" ref={hostRef} aria-hidden />
        <div className="crate-name">{crateLabel(shown)}</div>
        <div className="crate-stage crth-stage">
          {domCrate && (
            <div className={`crate-box${phase === 'anticipation' || phase === 'charge' ? ' shaking' : ''}${revealed ? ' open' : ''}${reward?.rarity ? ` r-${reward.rarity}` : ''}`} aria-hidden>
              <span className="crate-glow" />
              <span className="crate-lid" />
              <span className="crate-body"><span className="crate-lock" /></span>
              {revealed && !reduced && <span className="crate-burst" />}
            </div>
          )}
          {/* The slow god-ray backdrop behind the plate: DOM, turning on transform only, so the Pixi ticker can
              stop once the scene settles while the rays keep turning. */}
          {revealed && !reduced && <div className="crth-rays" aria-hidden />}
          {revealed && reward && (
            <div className={`crate-reward crth-plate${reward.rarity ? ` r-${reward.rarity}` : ''}`} role="status">
              <span className="crth-plate-gem" aria-hidden><img src={GEM_ART} alt="" draggable={false} decoding="sync" /></span>
              <span className="crate-reward-kind">{reward.kind}</span>
              <span className="crate-reward-name">{reward.name}</span>
              {reward.rarityLabel && <span className="crate-reward-rarity crth-ribbon"><span>{reward.rarityLabel}</span></span>}
              <span className="crth-plate-shine" aria-hidden />
              {skinUrl && (
                <span className={`crth-skin ${skinKind}`} aria-hidden>
                  <img src={skinUrl} alt="" draggable={false} decoding="sync" />
                </span>
              )}
            </div>
          )}
        </div>
        <div className="crth-foot">
          {phase === 'sealed' && (
            <button type="button" className="crate-btn pressable" onClick={() => { sfx.pulse(); start(shown); }}>Open</button>
          )}
          {phase === 'anticipation' && <div className="crate-note" role="status">{slow ? 'Still opening' : 'Opening'}</div>}
          {(phase === 'charge' || phase === 'burst' || phase === 'reveal') && <div className="crth-skip">Click to skip</div>}
          {phase === 'exhausted' && (
            <div className="crate-note" role="status">You own every reward for now. This crate stays sealed until new rewards arrive.</div>
          )}
          {phase === 'error' && (
            <>
              <div className="crate-note" role="status">Could not open the crate. Try again.</div>
              <button type="button" className="crate-btn pressable" onClick={() => { sfx.pulse(); start(shown); }}>Try again</button>
            </>
          )}
          {summary && (
            <div className="crth-summary" role="status">
              <span className="crth-summary-head">You found</span>
              <ul>
                {found.map((id, i) => {
                  const l = rewardLabel(id || null);
                  return <li key={`${id}:${i}`} className={l.rarity ? `r-${l.rarity}` : undefined}>{l.name}</li>;
                })}
              </ul>
            </div>
          )}
          {phase === 'settled' && openAll && next && <div className="crth-skip">Next crate coming</div>}
          <div className="crth-btns">
            {next && !openAll && (
              <button type="button" className="crate-btn pressable" onClick={() => { sfx.pulse(); start(next); }}>
                {pending.length > 1 ? `Open next (${pending.length} left)` : 'Open next'}
              </button>
            )}
            {onClose && phase !== 'anticipation' && phase !== 'charge' && phase !== 'burst' && phase !== 'reveal' && (
              <button type="button" className="crate-btn crate-btn-quiet pressable" onClick={() => { sfx.pulse(); onClose(); }}>Done</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(theatre, stageHost());
}
