import { useState } from 'react';
import { activeRift } from '@game/sim';
import { avatarSrc } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';

/**
 * The title screen — the game's front door, shown at boot and after a run ends. Styled after the
 * homescreen mockup: a full-bleed sky-castle background, the ASCENT logo + wordmark, an ornate
 * left-aligned menu (Play / Career / Leaderboard / Settings), an editable account-name chip, and the
 * build version. A single store flag (`showTitle`) drives it, no router.
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

const IconTrash = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1 11a2 2 0 0 1-2 1.9H9a2 2 0 0 1-2-1.9L6 9zm3.5 2v8H11v-8H9.5zm3.5 0v8h1.5v-8H13z" /></svg>
);

export function Title({ onSettings }: { onSettings: () => void }) {
  const showTitle = useGame((s) => s.showTitle);
  const startAscent = useGame((s) => s.startAscent);
  const startPractice = useGame((s) => s.startPractice);
  const startRift = useGame((s) => s.startRift);
  const openLeaderboard = useGame((s) => s.openLeaderboard);
  const openRankings = useGame((s) => s.openRankings);
  const openBalance = useGame((s) => s.openBalance);
  const openCareer = useGame((s) => s.openCareer);
  const toggleBook = useGame((s) => s.toggleBook);
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  const playerAvatar = useGame((s) => s.playerAvatar);
  const openAvatarPicker = useGame((s) => s.openAvatarPicker);
  const savedRun = useGame((s) => s.savedRun);
  const continueRun = useGame((s) => s.continueRun);
  const clearRun = useGame((s) => s.clearRun);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false); // two-step guard on the destructive Clear Run
  const [modePick, setModePick] = useState(false); // PLAY opens the mode picker rather than starting straight away

  if (!showTitle) return null;

  const rift = activeRift(); // the live registry is correct HERE — this is a pre-run choice, not a pinned run
  const beginEdit = () => { setDraft(playerName); setEditing(true); };
  const commit = () => { setPlayerName(draft); setEditing(false); };

  return (
    <div className="titlescreen">
      {/* Static homescreen background — the looping menu video is disabled for now (owner request 2026-07-08);
          the full-bleed sky-castle art comes from the `.titlescreen` CSS background (homescreen.webp). */}

      {/* Account (top-right) — the avatar opens the picker; the name is click-to-rename. */}
      <div className="titleaccount">
        <button className="titleavatar" onClick={openAvatarPicker} title="Change your avatar" aria-label="Change your avatar">
          {avatarSrc(playerAvatar)
            ? <img src={avatarSrc(playerAvatar)} alt="Your avatar" draggable={false} />
            : <span className="titleavatar-ph">{(playerName.trim()[0] ?? '').toUpperCase() || '☺'}</span>}
        </button>
        {editing ? (
          <input
            className="acctinput"
            autoFocus
            maxLength={24}
            value={draft}
            placeholder="Your name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <button className="acctname" onClick={beginEdit} title="Click to set your name">
            {playerName || 'Set your name'}
          </button>
        )}
      </div>

      <div className="titlemenu">
        <div className="titlelogo">
          <Crest />
          <h1 className="disp titleword">ASCENT</h1>
        </div>

        <nav className="titlenav">
          {savedRun && (
            <div className="continuerow">
              <button className="menubtn active" onClick={() => { sfx.pulse(); continueRun(); }} title="Resume your run in progress">
                <span className="mbicon"><Crest /></span>
                <span className="mblabel">Continue</span>
                <span className="mbnote">Round {savedRun.wave}</span>
              </button>
              <button
                className={`clearrun${confirmClear ? ' armed' : ''}`}
                onClick={() => {
                  sfx.pulse();
                  if (confirmClear) { clearRun(); setConfirmClear(false); } else setConfirmClear(true);
                }}
                onBlur={() => setConfirmClear(false)}
                title={confirmClear ? 'Click again to discard your saved run' : 'Discard your saved run'}
                aria-label="Discard your saved run"
              >
                {confirmClear ? 'Clear?' : <IconTrash />}
              </button>
            </div>
          )}
          <button className={`menubtn${savedRun ? '' : ' active'}`} onClick={() => { sfx.pulse(); setModePick(true); }} title={savedRun ? 'Start a new run (replaces your saved run)' : undefined}>
            <span className="mbicon"><Crest /></span>
            <span className="mblabel">Play</span>
          </button>
          <button className="menubtn" onClick={() => { sfx.pulse(); openCareer(); }} title="Your match history + per-hero stats">
            <span className="mbicon"><IconHelm /></span>
            <span className="mblabel">Career</span>
          </button>
          <button className="menubtn" onClick={() => { sfx.pulse(); openRankings(); }} title="Top players by renown">
            <span className="mbicon"><IconTrophy /></span>
            <span className="mblabel">Leaderboard</span>
          </button>
          <button className="menubtn" onClick={() => { sfx.pulse(); openLeaderboard(); }} title="The latest victory runs + their warbands">
            <span className="mbicon"><Icon name="crown" /></span>
            <span className="mblabel">Hall of Champions</span>
          </button>
          <button className="menubtn" onClick={onSettings}>
            <span className="mbicon"><Icon name="gear" /></span>
            <span className="mblabel">Settings</span>
          </button>
        </nav>

        {/* Preserved secondary modes (not in the mockup, kept so nothing is lost). */}
        <div className="titlesecondary">
          <button onClick={() => { sfx.pulse(); toggleBook(); }} title="Compendium — browse every card">Compendium</button>
          <span className="tsdot">·</span>
          <button onClick={() => { sfx.pulse(); openBalance(); }} title="Balance Report — real player offer / pick / win rates">Balance Report</button>
        </div>
      </div>

      {/* MODE PICKER — a full-screen view in the HERO-SELECT idiom (owner request): big framed cards in a
          row, each with a name pill eclipsing the frame's top edge, a tag pill eclipsing the bottom, and the
          description fading in on hover. Ascent is the clean scored climb; Rift is the SAME climb with the
          active rift's rules (opt-in as of this screen); Practice is unscored. The Rift card is mounted only
          while a rift is actually live. */}
      {modePick && (
        <div className="modepick" role="dialog" aria-label="Choose a mode">
          <button className="hsback" onClick={() => { sfx.pulse(); setModePick(false); }}>← Back</button>
          <div className="mpbox">
            <div className="mpeyebrow">Choose your climb</div>
            <h1 className="disp mptitle">MODE</h1>
            <div className="mprow">
              <button className="modecard" onClick={() => { sfx.pulse(); startAscent(); }}>
                <div className="mcframe" data-mode="ascent">
                  <div className="mcname">Ascent</div>
                  <span className="mcemblem"><Crest /></span>
                  <div className="mctag">Scored</div>
                </div>
                <div className="mcdesc">The scored 17-round climb. Cover your Oath, then chase the summit.</div>
              </button>

              {rift && (
                <button className="modecard" onClick={() => { sfx.pulse(); startRift(); }}>
                  <div className="mcframe" data-mode="rift">
                    <div className="mcname">Rift</div>
                    <span className="mcemblem mcswirl" aria-hidden="true" />
                    <div className="mctag">{rift.name}</div>
                  </div>
                  <div className="mcdesc">{rift.blurb}</div>
                </button>
              )}

              <button className="modecard" onClick={() => { sfx.pulse(); startPractice(); }}>
                <div className="mcframe" data-mode="practice">
                  <div className="mcname">Practice</div>
                  <span className="mcemblem"><IconHelm /></span>
                  <div className="mctag">Unscored</div>
                </div>
                <div className="mcdesc">Any hero, unlimited Resolve and a longer shop. Nothing is recorded.</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The little note on the right — currently a thank-you as the rift window closes. */}
      <aside className="titlebanner" role="note">
        <div className="titlebanner-emoji" aria-hidden>✨</div>
        <div className="titlebanner-title">Thanks for testing rifts!</div>
        <div className="titlebanner-sub">We're cooking up some new and fun rifts to test out in the near future. Back to basics for now, though.</div>
        {activeRift() && <div className="titlebanner-sub">Enjoy a special rift patch to have some fun ✨</div>}
      </aside>

      <div className="titleversion">v{__APP_VERSION__}</div>
    </div>
  );
}
