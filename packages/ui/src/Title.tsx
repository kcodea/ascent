import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';

/**
 * The title screen — the game's front door, shown at boot and after a run ends. Styled after the
 * homescreen mockup: a full-bleed sky-castle background, an ornate left-aligned menu (Play / Career /
 * Leaderboard / Settings), the ASCENT wordmark + crest, a rank chip, and the build version. A single
 * store flag (`showTitle`) drives it, no router.
 *
 * PLAY starts the scored Ascent climb; CAREER is a placeholder (the career/rating system isn't built
 * yet — see docs/roadmap.md Phase A). Practice + Compendium are kept as secondary links so no mode is
 * lost while the top-level menu mirrors the mockup.
 */

const Crest = () => (
  <svg viewBox="0 0 24 24" className="crest" aria-hidden="true">
    <path d="M12 1.5l3.4 3.9 5-1-1 5 3.6 3.6-3.6 3.6 1 5-5-1L12 24l-3.4-3.8-5 1 1-5L1 12.6l3.6-3.6-1-5 5 1z" fill="#c9a24e" />
    <path d="M12 4.6l6.4 7.4L12 19.4 5.6 12z" fill="#0f1c34" />
    <path d="M12 6.6l4.7 5.4L12 17.4 7.3 12z" fill="#3f9ae0" />
    <path d="M12 6.6l4.7 5.4L12 12z" fill="#7fd0ff" opacity="0.9" />
  </svg>
);

const IconTrophy = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 3h12v2h3v3a4 4 0 0 1-4 4h-.4A6 6 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A6 6 0 0 1 7.4 12H7a4 4 0 0 1-4-4V5h3V3zm0 4H5v1a2 2 0 0 0 1 1.7V7zm12 0v2.7A2 2 0 0 0 19 8V7h-1z" /></svg>
);

const IconHelm = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a8 8 0 0 0-8 8v5a3 3 0 0 0 3 3h1v3h8v-3h1a3 3 0 0 0 3-3v-5a8 8 0 0 0-8-8zm-3 8h1.5v4H9a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-1.5v-4H15z" /></svg>
);

export function Title({ onSettings }: { onSettings: () => void }) {
  const showTitle = useGame((s) => s.showTitle);
  const startAscent = useGame((s) => s.startAscent);
  const startPractice = useGame((s) => s.startPractice);
  const openLeaderboard = useGame((s) => s.openLeaderboard);
  const toggleBook = useGame((s) => s.toggleBook);
  if (!showTitle) return null;

  return (
    <div className="titlescreen">
      {/* Rank chip (top-right) — a shell for the future rank/rating system (roadmap A2/A7); decorative for now. */}
      <div className="titlerank" title="Your Ascender rank — coming with the career system">
        <Crest />
        <div className="rankmeta">
          <span className="ranklabel">Ascender</span>
          <span className="rankbar"><i style={{ width: '46%' }} /></span>
        </div>
      </div>

      <div className="titlemenu">
        <div className="titlelogo">
          <Crest />
          <h1 className="disp titleword">ASCENT</h1>
        </div>

        <nav className="titlenav">
          <button className="menubtn active" onClick={() => { sfx.pulse(); startAscent(); }}>
            <span className="mbicon"><Crest /></span>
            <span className="mblabel">Play</span>
          </button>
          <button className="menubtn disabled" title="Career — coming soon" onClick={() => sfx.deny()}>
            <span className="mbicon"><IconHelm /></span>
            <span className="mblabel">Career</span>
          </button>
          <button className="menubtn" onClick={() => { sfx.pulse(); openLeaderboard(); }}>
            <span className="mbicon"><IconTrophy /></span>
            <span className="mblabel">Leaderboard</span>
          </button>
          <button className="menubtn" onClick={onSettings}>
            <span className="mbicon"><Icon name="gear" /></span>
            <span className="mblabel">Settings</span>
          </button>
        </nav>

        {/* Preserved secondary modes (not in the mockup, kept so nothing is lost). */}
        <div className="titlesecondary">
          <button onClick={() => { sfx.pulse(); startPractice(); }} title="Practice — any hero, unlimited Resolve">Practice</button>
          <span className="tsdot">·</span>
          <button onClick={() => { sfx.pulse(); toggleBook(); }} title="Compendium — browse every card">Compendium</button>
        </div>
      </div>

      <div className="titleversion">v{__APP_VERSION__}</div>
    </div>
  );
}
