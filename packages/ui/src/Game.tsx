import './styles.css';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Recruit } from './Recruit';
import { EndScreen } from './EndScreen';
import { HeroSelect } from './HeroSelect';
import { Title } from './Title';
import { Leaderboard } from './Leaderboard';
import { Rankings } from './Rankings';
import { Career } from './Career';
import { AvatarPicker } from './AvatarPicker';
import { FontLab } from './FontLab';
import { StatusBar } from './StatusBar';
import { Inspect } from './Inspect';
import { MinionBook } from './MinionBook';
import { EscMenu } from './EscMenu';
import { DevMenu } from './DevMenu';
import { SceneBuilder } from './SceneBuilder';
import { BalancePanel } from './BalancePanel';
import { PerfHud } from './PerfHud';
import { perfMonitor, perfEnabledByFlag } from './perfMonitor';
import { Icon } from './Icon';
import { ErrorBoundary } from './ErrorBoundary';
import { PixiFxLayer } from './PixiFxLayer';
import { pixiFx, warmDiscoverFx } from './pixiFx';
import { warmArt } from './art';
import { useGame } from './store';

/** Root of the playable game. `Recruit` owns the board and stays mounted across every
 *  phase — combat plays out *in place* (the shop closes, the enemies arrive, the
 *  warband / hero / HUD never move). The StatusBar (Embers · Hero · Resolve) and the
 *  game-over overlay layer on top. The Esc menu drives the display-resolution scaler. */
export function Game() {
  const phase = useGame((s) => s.run.phase);
  const sandbox = useGame((s) => s.run.sandbox);
  const showBook = useGame((s) => s.showBook);
  // Recruit stays mounted across phases (combat plays out in place), so its closures/refs live for the whole
  // run. Starting a NEW run (pickHero / newRun → a fresh seed+hero) must give it a clean slate — otherwise a
  // callback captured under the previous run lingers (e.g. Disco Dan's locked-hand check false-locking a
  // uid-colliding card in the next hero's run). Key it on the run identity — stable within a run (seed +
  // heroId never change mid-run), so it only remounts when the run itself changes.
  const runKey = useGame((s) => `${s.run.seed}:${s.run.heroId}`);
  const [menuOpen, setMenuOpen] = useState(false);
  const [perfOn, setPerfOn] = useState(perfEnabledByFlag);

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
    return () => { window.removeEventListener('pointermove', onMove); perfMonitor.stop(); };
  }, [perfOn]);
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
      const gh = Math.min(window.innerHeight, (window.innerWidth * 9) / 16); // matches the CSS --gh (16:9 stage)
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
      {/* Scene Builder control panel — mounts alongside the live sandbox run (its own title-launched mode). */}
      {import.meta.env.DEV && sandbox && <SceneBuilder />}
      {/* Frame-health HUD. Ships in production but stays dormant unless opted into (?perf=1 /
          localStorage / the dev menu) — a slowness report is only trustworthy against the prod build. */}
      {perfOn && <PerfHud onClose={() => setPerfOn(false)} />}
      <BalancePanel />

      {/* Topmost layers: the pre-run hero picker (self-gates on heroChoices), and above it the title
          screen (self-gates on showTitle) — the front door into Ascent / Practice / Settings. */}
      <HeroSelect />
      <Title onSettings={() => setMenuOpen(true)} />
      <Leaderboard />
      <Rankings />
      <Career />
      <AvatarPicker />
      <FontLab />
    </ErrorBoundary>
  );
}
