import './styles.css';
import { useEffect, useState } from 'react';
import { Recruit } from './Recruit';
import { EndScreen } from './EndScreen';
import { HeroSelect } from './HeroSelect';
import { Title } from './Title';
import { Leaderboard } from './Leaderboard';
import { Career } from './Career';
import { AvatarPicker } from './AvatarPicker';
import { FontLab } from './FontLab';
import { StatusBar } from './StatusBar';
import { Inspect } from './Inspect';
import { MinionBook } from './MinionBook';
import { EscMenu } from './EscMenu';
import { DevMenu } from './DevMenu';
import { Icon } from './Icon';
import { ErrorBoundary } from './ErrorBoundary';
import { PixiFxLayer } from './PixiFxLayer';
import { warmArt } from './art';
import { useGame } from './store';

/** Root of the playable game. `Recruit` owns the board and stays mounted across every
 *  phase — combat plays out *in place* (the shop closes, the enemies arrive, the
 *  warband / hero / HUD never move). The StatusBar (Embers · Hero · Resolve) and the
 *  game-over overlay layer on top. The Esc menu drives the display-resolution scaler. */
export function Game() {
  const phase = useGame((s) => s.run.phase);
  const showBook = useGame((s) => s.showBook);
  // Recruit stays mounted across phases (combat plays out in place), so its closures/refs live for the whole
  // run. Starting a NEW run (pickHero / newRun → a fresh seed+hero) must give it a clean slate — otherwise a
  // callback captured under the previous run lingers (e.g. Disco Dan's locked-hand check false-locking a
  // uid-colliding card in the next hero's run). Key it on the run identity — stable within a run (seed +
  // heroId never change mid-run), so it only remounts when the run itself changes.
  const runKey = useGame((s) => `${s.run.seed}:${s.run.heroId}`);
  const [menuOpen, setMenuOpen] = useState(false);
  const [res, setRes] = useState<string>(() => {
    try { return localStorage.getItem('ascent-res') || 'fit'; } catch { return 'fit'; }
  });
  // Scrim strength: a multiplier on the board's readability overlay. Default 0.15 (a light dim that lets the
  // board art stay vibrant); a slider in Settings dials it brighter/darker. Note 0 is a valid pick (no dim),
  // so distinguish "unset" from 0 rather than truthiness-checking.
  const [scrim, setScrim] = useState<number>(() => {
    try { const raw = localStorage.getItem('ascent-scrim'); const v = Number(raw); return raw !== null && Number.isFinite(v) ? v : 0.15; } catch { return 0.15; }
  });

  // Preload all card/hero art once, on idle, so the first shop renders with art already cached — kills the
  // cold-load "pop-in" (esp. the itch CDN, where each webp is a separate first-appearance round-trip).
  useEffect(() => { warmArt(); }, []);

  // Apply the resolution box (a [data-res] attribute drives the --gw/--gh letterbox) + persist it.
  useEffect(() => {
    const root = document.documentElement;
    if (res === 'fit') root.removeAttribute('data-res');
    else root.setAttribute('data-res', res);
    try { localStorage.setItem('ascent-res', res); } catch { /* ignore */ }
  }, [res]);

  // Apply the board-scrim multiplier (the --scrim var the .app board gradient reads) + persist it.
  useEffect(() => {
    document.documentElement.style.setProperty('--scrim', String(scrim));
    try { localStorage.setItem('ascent-scrim', String(scrim)); } catch { /* ignore */ }
  }, [scrim]);

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
      {menuOpen && <EscMenu res={res} onRes={setRes} scrim={scrim} onScrim={setScrim} onClose={() => setMenuOpen(false)} />}
      {/* DEV-only tuning menu — one 🛠️ button opening every live tuner (stripped from production). */}
      {import.meta.env.DEV && <DevMenu />}
      {/* Topmost layers: the pre-run hero picker (self-gates on heroChoices), and above it the title
          screen (self-gates on showTitle) — the front door into Ascent / Practice / Settings. */}
      <HeroSelect />
      <Title onSettings={() => setMenuOpen(true)} />
      <Leaderboard />
      <Career />
      <AvatarPicker />
      <FontLab />
    </ErrorBoundary>
  );
}
