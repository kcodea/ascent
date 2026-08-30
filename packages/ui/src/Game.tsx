import './styles.css';
import './boardEdgeConfig'; // side-effect: apply the ultrawide edge-blend vars (dev: persisted tune; prod: DEFAULTS)
import { useEffect, useLayoutEffect, useState } from 'react';
import { Recruit } from './Recruit';
import { EndScreen } from './EndScreen';
import { HeroSelect } from './HeroSelect';
import { PracticeOptions } from './PracticeOptions';
import { HeroLaunchCurtain } from './hero-select/HeroLaunchCurtain';
import { Title } from './Title';
import { Leaderboard } from './Leaderboard';
import { Rankings } from './Rankings';
import { RecentGames } from './RecentGames';
import { Career } from './Career';
import { PerfScreen } from './PerfScreen';
import { AvatarPicker } from './AvatarPicker';
import { TutorialController } from './tutorial/TutorialController';
import { AccountPanel } from './AccountPanel';
import { StatusBar } from './StatusBar';
import { Inspect } from './Inspect';
import { MinionBook } from './MinionBook';
import { EscMenu } from './EscMenu';
import { DevMenu } from './DevMenu';
import { EditorOverlay } from './uiEditor/EditorOverlay';
import { ensureDefsReady } from './fx/playDef';
import { SceneBuilder } from './SceneBuilder';
import { BugScenarioPanel } from './bug-report/BugScenarioPanel';
import { BalancePanel } from './BalancePanel';
import { PatchNotes } from './PatchNotesOverlay';
import { BugReportModal } from './bug-report/BugReportModal';
import { installBugReportHotkey } from './bug-report/bugReportHotkey';
import { PerfHud } from './PerfHud';
import { uploadRun } from './perfCloud';
import { toRun } from './perfStore';
import { isRealPlayRun } from './perfCaptureScope';

/** Seconds of live recording an auto-share needs before it is worth a row. A reload is not a session. */
const MIN_AUTO_SHARE_SECONDS = 45;


/** Persist the perf choice, so closing the HUD in a dev client keeps it closed across reloads (the dev
 *  default only applies when no opinion is stored — see `enabledByFlag`). */
function setPerfFlag(on: boolean): void {
  try { localStorage.setItem('ascent.perf', on ? '1' : '0'); } catch { /* ignore */ }
}
import { perfMonitor, perfEnabledByFlag } from './perfMonitor';
import { Icon } from './Icon';
import { ErrorBoundary } from './ErrorBoundary';
import { ReplayOverlay } from './replay/ReplayOverlay';
import { ReplayDragGhost } from './replay/ReplayDragGhost';
import { RoundRail } from './replay/RoundRail';
import { PixiFxLayer } from './PixiFxLayer';
import { pixiFx, warmDiscoverFx } from './pixiFx';
import { warmArt } from './art';
import { sfx } from './sfx';
import { useGame } from './store';

/** Root of the playable game. `Recruit` owns the board and stays mounted across every
 *  phase — combat plays out *in place* (the shop closes, the enemies arrive, the
 *  warband / hero / HUD never move). The StatusBar (Embers · Hero · Resolve) and the
 *  game-over overlay layer on top. The Esc menu drives the display-resolution scaler. */
/**
 * What counts as a MENU control for the two delegated sound cues — the hover tick and the click "thock".
 *
 * Hoisted so the two cannot drift: a control that ticks on hover and then goes silent under the finger (or the
 * reverse) reads as a bug in the sound, not as a deliberate distinction. Both listeners live in `Game`, mounted
 * once, rather than as props on every button — a new menu item cannot forget a cue it never had to opt into.
 *
 * Deliberately EXCLUDED via SKIP: the in-game shop and combat HUD controls, which are gameplay actions with
 * their own dedicated sounds rather than menu navigation, plus dev panels. Minion cards (`.card` divs) are not
 * buttons, so they never match SEL in the first place.
 */
const MENU_SFX_SEL = 'button, [role="button"], .disc-slot';
const MENU_SFX_SKIP = '[data-nohoversfx], .devmenu, .desk, .heropowerbtn, .frzwrap, .tvbwrap, .rfbwrap, '
  + '.riftbtn, .etbwrap, .combatsummary, .combathud-skip, .combatspeed, .forge-reroll';

export function Game() {
  const phase = useGame((s) => s.run.phase);
  const sandbox = useGame((s) => s.run.sandbox);
  const bugScenarioLoaded = useGame((s) => s.bugScenario !== null);
  const showBook = useGame((s) => s.showBook);
  // Recruit stays mounted across phases (combat plays out in place), so its closures/refs live for the whole
  // run. Starting a NEW run (pickHero / newRun → a fresh seed+hero) must give it a clean slate — otherwise a
  // callback captured under the previous run lingers (e.g. Disco Dan's locked-hand check false-locking a
  // uid-colliding card in the next hero's run). Key it on the run identity — stable within a run (seed +
  // heroId never change mid-run), so it only remounts when the run itself changes.
  // REPLAY VIEWER: the seek epoch is folded in so a replay SEEK remounts the recruit tree — every FX hook's
  // sequence-diff ref re-inits at the target frame, so a jump across 30 frames can't fire 30 stale effects
  // (buys/welds still replay during ordinary frame stepping, which never bumps the epoch). 0 outside replays.
  const runKey = useGame((s) => `${s.run.seed}:${s.run.heroId}:${s.replaySeekEpoch}`);
  const [menuOpen, setMenuOpen] = useState(false);
  const [perfOn, setPerfOn] = useState(perfEnabledByFlag);

  // Load the FX primitives once, in EVERY build, so the authored defs actually play — for players as well as
  // in a dev session. This is the third of the three gates that used to keep defs off the shipped game (the
  // other two are the `import.meta.glob` in `fx/fxDefs.ts` and the dynamic import in `fx/playDef.ts`), and it
  // is the easy one to forget: without this call the primitives never register, so `canPlayDefs()` stays false
  // and EVERY def binding in the Score is silently inert — a whole combat with none of the authored effects and
  // no error to explain why, having shipped their bytes anyway. Do not re-add an `import.meta.env.DEV` guard
  // here. (The workbench's own `import('./primitives')` is separate and stays DEV-gated.)
  useEffect(() => {
    void ensureDefsReady();
  }, []);

  // Perf HUD: start/stop the sampler with the toggle, and feed it the game context so every logged second
  // carries what was happening (a spike is only actionable if you know the phase + wave it landed in).
  useEffect(() => {
    if (!perfOn) { perfMonitor.stop(); return; }
    perfMonitor.registerContext(() => {
      const s = useGame.getState().run;
      return { phase: s.phase, wave: s.wave };
    });
    // Input RATE. A high-polling-rate mouse delivers pointermove far above the frame rate; when a handler
    // turns each one into a state update, the render cost is invisible without this number next to it.
    const onMove = (): void => perfMonitor.count('pointermoves');
    window.addEventListener('pointermove', onMove, { passive: true });
    perfMonitor.start();

    /**
     * AUTO-SHARE (owner ask 2026-08-29: "uploads to supabase and drops it into a performance viewer in game
     * for us" — and, asked directly, "this will auto upload after games right?").
     *
     * **AT THE END OF A GAME**, which is what "analytics of games" means: one row per completed game, holding
     * that game's whole timeline. The first version uploaded when the tab was hidden, which produced a row
     * per SITTING rather than per game — close enough to sound right and wrong in a way that matters, since
     * a row spanning two games and a menu cannot be compared against anything.
     *
     * ONLY COMPLETED GAMES (owner ask 2026-08-30: *"i also dont want to see abandoned games in that tab, only
     * completed games"*). The first version also published on tab-hide, so a half-played game left a row too.
     * That was defensible as "capture what we can" and wrong as analytics: an abandoned run's timeline stops
     * mid-shop, its phase mix is whatever the player happened to be doing, and it sits in the list looking
     * exactly like a real game next to games that can legitimately be compared with each other.
     *
     * Nothing replaces it. A game that is not finished is not a data point, and the honest way to have fewer
     * bad rows is to stop writing them — not to write them and filter on read.
     *
     * Guarded on MIN_AUTO_SHARE_SECONDS so a reload or a quick tab-out does not publish a five-second
     * nothing, and on `isRealPlayRun` so only real games are captured.
     */
    let shared = false;
    const publish = (note: string): void => {
      if (shared) return;
      const st = useGame.getState();
      if (!isRealPlayRun(st.run)) return;        // see `isRealPlayRun` — auto-capture is real games only
      const buckets = perfMonitor.history();
      if (buckets.filter((b) => !b.hidden).length < MIN_AUTO_SHARE_SECONDS) return;
      shared = true;
      // SAY SO WHEN IT FAILS. This was fire-and-forget, which meant a dev client that recorded a whole game
      // and then could not publish it — signed out is the common one, since `uploadRun` needs a user id for
      // the insert-own RLS policy — looked identical to one that never recorded at all. The first time that
      // mattered, the question it produced was "why are none of Mike's games in the shared tab", and nothing
      // anywhere had a answer. A dev tool may fail quietly; it may not fail invisibly.
      void uploadRun(
        toRun(buckets, {
          id: `${Date.now()}`,
          startedAt: Date.now() - buckets.length * 1000,
          build: `${__APP_VERSION__}+${__BUILD_SHA__}`,
          mode: st.run?.mode,
          heroId: st.run?.heroId,
          note,
        }),
        st.playerName || 'dev',
      ).then((r) => {
        if (r.kind === 'ok') return;
        const why = r.kind === 'notReady'
          ? 'the perf_runs table does not exist yet — run schema.sql'
          : r.error;
        console.warn(`[perf] this game was recorded but NOT shared: ${why}`);
      });
    };
    // The end of the game. Subscribed to the store rather than driven by this component's `phase` prop so the
    // upload fires once on the TRANSITION, not on every render while the end screen is up.
    const unsub = useGame.subscribe((st, prevSt) => {
      const p = st.run?.phase;
      if (p === prevSt.run?.phase) return;
      if (p === 'gameover' || p === 'victory') publish(`game ${p === 'victory' ? 'won' : 'lost'}`);
    });

    return () => {
      window.removeEventListener('pointermove', onMove);
      unsub();
      perfMonitor.stop();
    };
  }, [perfOn]);

  // UI-hover SFX: one delegated pointerover listener for the whole app (mounted once). Plays a soft cue when
  // the pointer ENTERS a MENU / selection control — any button (title / esc-menu / leaderboard / career menus,
  // hero-select `.herocard` buttons) plus Discover options (`.disc-slot`). Deliberately silent on the in-game
  // shop/combat HUD controls (hero power, freeze, refresh, tavern-up, rift, end-turn, summary, combat skip/speed,
  // rune-forge reroll) — those are gameplay actions, not menu navigation — and on minion cards (`.card` divs),
  // dev panels, and disabled controls. Per-target enter dedupe (skips moves within the same element); no time
  // throttle, so a fast sweep ticks every element it passes.
  useEffect(() => {
    const SEL = MENU_SFX_SEL;
    const SKIP = MENU_SFX_SKIP;
    let last: Element | null = null;
    const onOver = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;                 // hover is a mouse/pen affordance only
      let el = (e.target as Element | null)?.closest?.(SEL) ?? null;
      // An offer option (Choose One / Discover) is a `.card[role="button"]` wrapped in a `.disc-slot` — BOTH
      // match SEL. The card's plate img is `pointer-events:none`, so its overhang resolves to the SLOT while the
      // frame resolves to the inner CARD; crossing between them double-ticked one option (owner report
      // 2026-08-19). Collapse any match sitting inside a slot to the slot itself, so each option ticks once.
      if (el) el = el.closest('.disc-slot') ?? el;
      if (el === last) return;                               // still within the same target (or still on nothing)
      last = el;
      if (!el || el.closest(SKIP) || (el as HTMLButtonElement).disabled) return;
      sfx.uiHover();
    };
    window.addEventListener('pointerover', onOver, { passive: true });
    return () => window.removeEventListener('pointerover', onOver);
  }, []);

  // UI-CLICK SFX: the same set of controls, on the way DOWN. Hover ticks and activation plays its own cue, but
  // the press — the tactile moment itself — was silent everywhere except the title column, which had its own
  // copy of this listener. Now that every menu button, hero card, mode card, chip and row COMPRESSES under the
  // pointer (see `.pressable` and the card commit state), the sound belongs with the compression rather than
  // after the release, and it belongs to all of them rather than one screen.
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;                 // the cue belongs to a click, not a tap
      const el = (e.target as Element | null)?.closest?.(MENU_SFX_SEL) ?? null;
      if (!el || el.closest(MENU_SFX_SKIP)) return;
      if ((el as HTMLButtonElement).disabled || el.classList.contains('disabled')) return;
      sfx.clickThock();
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);
  // Console handles: toggle the HUD from anywhere (dev menu, devtools) without threading state through the
  // tree, and reach the monitor itself for triage — `__perf.summary()` / `__perf.exportLog()` are the two
  // you actually want when someone reports a hitch and the HUD isn't already up.
  useEffect(() => {
    const w = window as unknown as { __perfHud?: (on?: boolean) => void; __perf?: typeof perfMonitor };
    w.__perfHud = (on = true) => setPerfOn(on);
    w.__perf = perfMonitor;
    return () => { delete w.__perfHud; delete w.__perf; };
  }, []);

  // Preload all card/hero art once, on idle, so the first shop renders with art already cached — kills the
  // cold-load "pop-in" (esp. the itch CDN, where each webp is a separate first-appearance round-trip).
  useEffect(() => { warmArt(); }, []);
  // …and build the Discover overlay's separate Pixi app on idle, so the first Discover doesn't pay a ~60-108ms
  // WebGL-context stall mid-shop (see `warmDiscoverFx`).
  useEffect(() => { warmDiscoverFx(); }, []);
  // The game now fills the window at a fixed 16:9 (no resolution picker → no `data-res`), draws one board
  // (`--board` = the CSS default), and applies no readability dim — so there's no res/scrim/board state to persist.

  // Uniform stage scale: --scale = the 16:9 stage height ÷ the 1440 design reference (clamped), as a UNITLESS
  // number the CSS multiplies every authored size/offset by, so the whole UI shrinks/grows as ONE unit with the
  // window. Set pre-paint + on every resize. (CSS can't turn a length into a unitless ratio, hence JS.)
  useLayoutEffect(() => {
    const apply = (): void => {
      // Cap at 1440 to match the PINNED CSS `--gh` (min(..., 1440px)): the stage never grows past the tuned
      // 2560×1440 reference, so `--scale` tops out at 1.0 in lockstep. Without this cap the CSS stage pinned but
      // JS still drove --scale above 1.0 on tall windows, so anything mixing `--bar` position (capped) with
      // `--scale` size (uncapped) — the hero panel: portrait, Health pill, rune chains — drifted off the board.
      const gh = Math.min(window.innerHeight, (window.innerWidth * 9) / 16, 1440); // matches the CSS --gh (16:9 stage, pinned)
      // No meaningful floor: a phone's landscape stage is only ~380-460px tall (true ratio ~0.27-0.32), and
      // flooring at 0.45 oversized everything 1.5× → overlapping HUD/hero/shop (owner's iPhone report). The
      // whole point of the uniform scale is that the layout stays proportional at ANY size.
      const scale = Math.max(0.2, Math.min(1.25, gh / 1440));
      document.documentElement.style.setProperty('--scale', String(scale));
      // Phone-height stages get a CARD zoom (--ch-base multiplies by this; chrome/--u stays put) so minions are
      // bigger to read + tap (owner: "everything is impossible to read"). +36% under a 600px-tall stage — paired with
      // the wider board frame (--board-mobile-zoom) so 7 minions still fit, and re-tuned rope offsets below. This is
      // ~the vertical max: two full card rows + HUD + hero must fit 430px, so a bigger boost overlaps the hero panel.
      const mobile = gh < 600;
      const boost = mobile ? 1.36 : 1;
      document.documentElement.style.setProperty('--mobile-boost', String(boost));
      // Tighten the warband/shop card gaps on a phone so the wider (7-minion) board still fits the frame after the
      // card zoom above — the bigger cards would otherwise re-overflow the floor. Desktop keeps the full gap (1).
      document.documentElement.style.setProperty('--gap-tighten', mobile ? '0.48' : '1');
      // Mobile-only chrome/layout tweaks (owner 2026-07-14) — every one is a MULTIPLIER/offset that defaults to the
      // desktop identity (1 / 0px) so desktop is provably untouched; only phone stages (gh<600) get the non-1 value.
      //  · --hud-mobile: grow the non-shop HUD chrome ~10% (folded into the global --u + the top status bar's --u,
      //    NOT the shop controls' --u — see styles.css).
      //  · --board-mobile-zoom: enlarge the board backdrop art ~30% so the frame is WIDER — the room the +36% cards
      //    need to still fit 7 across (composed with the Lab's --board-zoom so it isn't clobbered).
      //  · --wb-drop / --shop-drop: nudge the Warband DOWN and the Shop UP (reference px, ×--scale in CSS) so the
      //    shop bottom + warband top sit ~symmetric ~8px above/below the centre rope after the bigger cards made the
      //    rows taller. The rope is fixed at the .app centre; these just close the gaps evenly.
      document.documentElement.style.setProperty('--hud-mobile', mobile ? '1.1' : '1');
      document.documentElement.style.setProperty('--board-mobile-zoom', mobile ? '1.3' : '1');
      document.documentElement.style.setProperty('--wb-drop', mobile ? '112px' : '0px');
      document.documentElement.style.setProperty('--shop-drop', mobile ? '-47px' : '0px');
      //  · --inspect-zoom: enlarge the tap/hover card-reveal popup ~30% on a phone so a minion's text is readable
      //    (Card.tsx's showRefTip folds the same factor into its on-screen placement math).
      document.documentElement.style.setProperty('--inspect-zoom', mobile ? '1.3' : '1');
      // Keep the WebGL combat particles proportional to the (shrinking) cards. The FX px dials were tuned at the
      // owner's ~0.745 desktop scale, so divide that reference out → 1.0 on desktop, ~0.45 on a phone. Fold in the
      // card boost so bursts match the boosted card size, not the bare stage.
      pixiFx.setScale((scale * boost) / 0.745);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  // Esc toggles the menu — but if the menu is closed and a card is being inspected, let the
  // inspect overlay claim Esc (it closes itself) instead of opening the menu. The Minion Book
  // also claims Esc (closes itself) before the menu would open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useGame.getState();
      if (st.showBook) { st.closeBook(); return; }
      setMenuOpen((open) => {
        if (open) return false;
        if (st.inspect) return false;
        return true;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // BUG REPORTER (PR 1): the ONE application-level Ctrl+B listener (blueprint §5.3) — mounted here at the
  // root shell, not inside Recruit. All policy (excluded surfaces, the presentationTx toast, repeat-press
  // focus) lives in the store's `openBugReport`; the modal's own capture-phase handler claims Esc/Tab while
  // it is open, so the two listeners below never fire underneath it.
  useEffect(() => installBugReportHotkey(), []);

  // Tab toggles the Compendium — from the title (browse the whole set) or in a run (scoped to it). Not
  // during hero select. `preventDefault` stops the browser's focus-cycling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const st = useGame.getState();
      if (st.heroChoices) return;
      e.preventDefault();
      st.toggleBook();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ErrorBoundary>
      <Recruit key={runKey} />
      {/* WebGL effects overlay (particle impacts, flashes) — a transparent full-viewport Pixi
          canvas drawn over the board; the combat replay fires effects into it at contact points. */}
      <PixiFxLayer />
      {phase === 'gameover' && <EndScreen won={false} />}
      {phase === 'victory' && <EndScreen won={true} />}
      {/* Keyed on run identity like Recruit: the StatusBar's `prevHp` ref tracks Resolve across the run to
          float a "−X" when a wave breaks through. Without a key it persists across a new-run pick, so its ref
          holds the PREVIOUS run's HP — picking a hero with lower starting HP then floats a phantom "−X". */}
      <StatusBar key={`sb:${runKey}`} />
      {showBook && <MinionBook />}
      <Inspect />
      <button className="gearbtn" onPointerDown={() => setMenuOpen(true)} title="Settings (Esc)" aria-label="Settings">
        <Icon name="gear" />
      </button>
      {/* Build badge above the gear — version + short git SHA, so you can tell at a glance which build is live. */}
      <div className="version" title={`ASCENT v${__APP_VERSION__} · build ${__BUILD_SHA__}`}>
        v{__APP_VERSION__} <span>{__BUILD_SHA__}</span>
      </div>
      {menuOpen && <EscMenu onClose={() => setMenuOpen(false)} />}
      {/* DEV-only tuning menu — one 🛠️ button opening every live tuner (stripped from production). */}
      {import.meta.env.DEV && <DevMenu />}
      {/* DEV-only in-run UI editor overlay — direct-manipulation move/resize/restyle of live UI, toggled
          from the DevMenu's "UI Edit Mode" action (stripped from production). */}
      {import.meta.env.DEV && <EditorOverlay />}
      {/* Scene Builder control panel — mounts alongside the live sandbox run (its own title-launched mode). */}
      {import.meta.env.DEV && sandbox && <SceneBuilder />}
      {/* Bug-scenario report side panel (PR 4) — mounts with a loaded scenario. Independent of `sandbox`:
          a content-mismatch load is READ-ONLY (the run is never entered), but its evidence still shows. */}
      {import.meta.env.DEV && bugScenarioLoaded && <BugScenarioPanel />}
      {/* Frame-health HUD. Ships in production but stays dormant unless opted into (?perf=1 /
          localStorage / the dev menu) — a slowness report is only trustworthy against the prod build. */}
      {perfOn && <PerfHud onClose={() => { setPerfFlag(false); setPerfOn(false); }} />}
      {/* DEV-ONLY (owner 2026-08-24): the Balance Report reads dev/session telemetry and must not ship in the
          exe or itch repacks, which are production `build:web` bundles where `import.meta.env.DEV` is false. */}
      {import.meta.env.DEV && <BalancePanel />}
      {/* Patch Notes — opened from the title only (owner ask 2026-08-24). Mounted here beside the other
          full-screen overlays; its own `showPatchNotes` gate keeps it inert until the title opens it. */}
      <PatchNotes />
      {/* Bug reporter (Ctrl+B) — self-gates on `bugReportOpen` / `bugReportToast`. Pausing is Recruit's
          `overlayOpen` job, not this component's. */}
      <BugReportModal />

      {/* Topmost layers: the pre-run hero picker (self-gates on heroChoices), and above it the title
          screen (self-gates on showTitle) — the front door into Ascent / Practice / Settings. */}
      <HeroSelect />
      {/* Practice setup — the options screen between the Practice card and the hero picker (self-gates on
          `practiceSetupOpen`). Sits by the picker: choosing Practice opens this, Start opens the picker. */}
      <PracticeOptions />
      {/* The hero-select launch curtain: mounted in Game (NOT in HeroSelect) so it survives the unmount
          pickHero causes, and after HeroSelect so it z-orders above it (blueprint §7). */}
      <HeroLaunchCurtain />
      <Title onSettings={() => setMenuOpen(true)} />
      <Leaderboard />
      <Rankings />
      <RecentGames />
      <Career />
      {/* Perf analytics — self-gates on `showPerf`, renders nothing until opened from the dev menu. */}
      <PerfScreen />
      <AvatarPicker />
      <AccountPanel />
      {/* REPLAY VIEWER: the round rail (left) + the transport bar. Both self-gate on `replaySession`;
          the overlay mounts LAST so the transport controls float above everything (salvaged v1 order). */}
      {/* The drag ghost self-gates on `replayDragGhost` (only ever set mid-replay) and sits UNDER the
          transport chrome — a recorded hand replaying must never cover the viewer's controls. */}
      <ReplayDragGhost />
      <RoundRail />
      <ReplayOverlay />
      {/* Tutorial coaching overlay — self-gates on a `tutorial`-mode run; renders nothing otherwise. Mounted
          at the root (a sibling of `.app`) so its focus mask floats above everything without being z-trapped
          by `.app`'s stacking context. */}
      <TutorialController />
      {/* First-launch welcome RETIRED as an auto-popup (owner 2026-08-17): the tutorial nudge now fires when a
          new player first hits Play (see Title's `onPlay` + tutorial prompt), not on load. */}
    </ErrorBoundary>
  );
}
