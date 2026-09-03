import { useEffect, useState } from 'react';
import { AscentLogo } from './AscentLogo';
import { activeRift, LEARN_ASCENT } from '@game/sim';
import { avatarSrc, modeArt } from './art';
import { getTitleText, subscribeTitleText, titleContinueNote } from './titleTextConfig';
import { applyTitleVars } from './titleConfig';
import { applyTitleVeilVars } from './titleVeilConfig';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame, tempHandle } from './store';
import { startReplay } from './replay/replayPlayer';
import { getCourseProgress, skipCourse } from './tutorial/tutorialProfile';

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
  const startPractice = useGame((s) => s.startPractice);
  const startLobby = useGame((s) => s.startLobby);
  const startTutorial = useGame((s) => s.startTutorial);
  const startRift = useGame((s) => s.startRift);
  const startSceneBuilder = useGame((s) => s.startSceneBuilder);
  const openLeaderboard = useGame((s) => s.openLeaderboard);
  const openRankings = useGame((s) => s.openRankings);
  const openRecentGames = useGame((s) => s.openRecentGames);
  const openBalance = useGame((s) => s.openBalance);
  const openPatchNotes = useGame((s) => s.openPatchNotes);
  const openBugReport = useGame((s) => s.openBugReport);
  const openCareer = useGame((s) => s.openCareer);
  const toggleBook = useGame((s) => s.toggleBook);
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  const playerAvatar = useGame((s) => s.playerAvatar);
  const openAvatarPicker = useGame((s) => s.openAvatarPicker);
  const account = useGame((s) => s.account);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const savedRun = useGame((s) => s.savedRun);
  const lastReplay = useGame((s) => s.lastReplay);
  const continueRun = useGame((s) => s.continueRun);
  const clearRun = useGame((s) => s.clearRun);
  const rating = useGame((s) => s.profile.rating); // shown on the Play card

  // FRONT-PAGE COPY (dev Title Text tuner). Re-render on change so edits land live behind the panel; with no
  // override this returns the shipped defaults, so production is byte-identical to the hard-coded strings.
  const [, bumpText] = useState(0);
  useEffect(() => subscribeTitleText(() => bumpText((n) => n + 1)), []);
  // Apply the persisted Title Logo tuner values (dev) / DEFAULTS (prod) to `--title-*` when the menu mounts.
  // Same for the Title Veil (`--tv-*`, the navy background vignette).
  useEffect(() => { applyTitleVars(); applyTitleVeilVars(); }, []);
  const txt = getTitleText();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false); // two-step guard on the destructive Clear Run
  const [modePick, setModePick] = useState(false); // PLAY opens the mode picker rather than starting straight away
  const [learnPick, setLearnPick] = useState(false); // LEARN opens the learning hub (Tutorial + future lessons)
  const [tutorialPrompt, setTutorialPrompt] = useState(false); // a new player hitting Play is offered the tutorial first

  // Returning to the title (Save & Quit, or a run ending) lands on the MAIN menu, not whatever sub-menu was open
  // when the run started (owner ask 2026-08-24: Save & Quit went back to the play/mode picker). These view flags
  // are local, so `openTitle` can't clear them from the store — reset them here whenever the title reappears.
  useEffect(() => {
    if (showTitle) { setModePick(false); setLearnPick(false); setTutorialPrompt(false); }
  }, [showTitle]);

  if (!showTitle) return null;

  // A player who has never finished (or skipped) the guided course is "new" — hitting Play offers the tutorial
  // once before the real game, rather than dropping them in cold.
  const learnStatus = getCourseProgress(LEARN_ASCENT.id)?.status;
  const isNewPlayer = !learnStatus || learnStatus === 'not_started';
  // Play from the mode picker: nudge a new player to the tutorial first; everyone else starts the lobby.
  const onPlay = () => {
    sfx.pulse();
    if (isNewPlayer) setTutorialPrompt(true);
    else startLobby();
  };

  const rift = activeRift(); // the live registry is correct HERE — this is a pre-run choice, not a pinned run
  // A first-time player with no name yet: show the auto-assigned temp handle (the same one on the leaderboard)
  // and NUDGE the chip so they notice it's theirs to change, rather than a bare "Set your name".
  const unnamed = !playerName;
  const effectiveName = playerName || tempHandle(account.userId);
  const beginEdit = () => { setDraft(playerName); setEditing(true); };
  const commit = () => { setPlayerName(draft); setEditing(false); };

  return (
    <div className="titlescreen">
      {/* Static homescreen background — the looping menu video is disabled for now (owner request 2026-07-08);
          the full-bleed sky-castle art comes from the `.titlescreen` CSS background (homescreen.webp). */}

      {/* Account (top-right) — the avatar opens the picker; the name is click-to-rename. */}
      <div className="titleaccount">
        <button className="titleavatar" onClick={openAvatarPicker} data-tip="Change your avatar" aria-label="Change your avatar">
          {avatarSrc(playerAvatar)
            ? <img decoding="sync" src={avatarSrc(playerAvatar)} alt="Your avatar" draggable={false} />
            : <span className="titleavatar-ph">{(effectiveName.trim()[0] ?? '').toUpperCase() || '☺'}</span>}
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
          <button
            className={`acctname${unnamed ? ' acctname-nudge' : ''}`}
            onClick={beginEdit}
            title={unnamed ? 'This is a temporary name — click to make it your own' : 'Click to change your name'}
          >
            {effectiveName}
          </button>
        )}
        {/* ACCOUNTS C2 — sign-in status / entry. Signed in = a portable account; otherwise an invite to save. */}
        <button
          className={`acctsignin${account.anonymous ? '' : ' linked'}`}
          onClick={() => { sfx.pulse(); openAccountPanel(); }}
          title={account.anonymous ? 'Save your progress — sign in with your email' : `Signed in as ${account.email ?? ''}`}
        >
          {account.anonymous ? 'Sign in' : 'Account ✓'}
        </button>
      </div>

      <div className="titlemenu">
        {/* The lockup is shared with hero select — see `AscentLogo`. `.titlelogo` keeps ALL of this screen's
            sizing, offset and float (the 🏔️ tuner's `--title-*` vars); the component itself is markup only. */}
        <AscentLogo className="titlelogo" />

        {/* The down-stroke "thock" that used to live here is now one app-wide delegated listener in Game.tsx,
            covering every menu button, hero card, mode card, chip and row rather than this column alone. Two
            listeners would have fired it twice on exactly these plaques. */}
        <nav className="titlenav">
          {savedRun && (
            <div className="continuerow">
              <button className="menubtn active" onClick={() => { sfx.pulse(); continueRun(); }} data-tip="Resume your run in progress">
                <span className="mbicon"><Crest /></span>
                <span className="mblabel">{txt.continueLabel}</span>
                <span className="mbnote">{titleContinueNote(savedRun.wave)}</span>
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
            <span className="mblabel">{txt.play}</span>
          </button>
          {/* Learn moved OFF the main menu (owner 2026-08-17): it now lives in the mode picker as its own card,
              opening a learning hub (Tutorial + future advanced lessons). A new player is also offered the
              tutorial the first time they hit Play. */}
          <button className="menubtn" onClick={() => { sfx.pulse(); openCareer(); }} data-tip="Your match history + per-hero stats">
            <span className="mbicon"><IconHelm /></span>
            <span className="mblabel">{txt.career}</span>
          </button>
          <button className="menubtn" onClick={() => { sfx.pulse(); openRankings(); }} data-tip="Top players by rating">
            <span className="mbicon"><IconTrophy /></span>
            <span className="mblabel">{txt.leaderboard}</span>
          </button>
          <button className="menubtn" onClick={() => { sfx.pulse(); openLeaderboard(); }} data-tip="The latest victory runs + their warbands">
            <span className="mbicon"><Icon name="crown" /></span>
            <span className="mblabel">{txt.champions}</span>
          </button>
          <button className="menubtn" onClick={() => { sfx.pulse(); openRecentGames(); }} data-tip="The last 20 games played across every player">
            <span className="mbicon"><Icon name="clock" /></span>
            <span className="mblabel">Recent Games</span>
          </button>
          <button className="menubtn" onClick={onSettings}>
            <span className="mbicon"><Icon name="gear" /></span>
            <span className="mblabel">{txt.settings}</span>
          </button>
        </nav>

        {/* Preserved secondary modes (not in the mockup, kept so nothing is lost). */}
        <div className="titlesecondary">
          <button onClick={() => { sfx.pulse(); toggleBook(); }} data-tip="Compendium — browse every card">Compendium</button>
          <span className="tsdot">·</span>
          <button onClick={() => { sfx.pulse(); openPatchNotes(); }} data-tip="Patch Notes — gameplay changes by date">Patch Notes</button>
          {/* BUG REPORTER from the MAIN MENU (owner ask 2026-08-27): the same reporter as in-game Ctrl+B —
              no run needed; the description is the payload. Routes through the store's one open authority. */}
          <span className="tsdot">·</span>
          <button onClick={() => { sfx.pulse(); openBugReport(); }} data-tip="Spotted a problem? Describe it here — no run needed (Ctrl+B)">Report a Problem</button>
          {/* DEV-ONLY (owner 2026-08-24): the Balance Report is a dev/telemetry view, stripped from the exe +
              itch prod builds. The dot rides inside the guard so prod never shows a dangling separator. */}
          {import.meta.env.DEV && (
            <>
              <span className="tsdot">·</span>
              <button onClick={() => { sfx.pulse(); openBalance(); }} data-tip="Balance Report — real player offer / pick / win rates">Balance Report</button>
            </>
          )}
          {/* REPLAY VIEWER (v2): watch back the last run finished this session (frames aren't persisted, so
              the offer only appears once a run has ended since launch). The full spectate entry points —
              recent matches + leaderboard Watch — are Phase C. */}
          {lastReplay && (
            <>
              <span className="tsdot">·</span>
              <button onClick={() => { sfx.pulse(); startReplay(lastReplay); }} data-tip="Watch back your last finished game">Rewatch Last Game</button>
            </>
          )}
          {import.meta.env.DEV && (
            <>
              <span className="tsdot">·</span>
              <button onClick={() => { sfx.pulse(); startSceneBuilder(); }} data-tip="Scene Builder — dev sandbox: any board, any enemy, unlimited gold">Scene Builder</button>
            </>
          )}
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
            <h1 className="disp mptitle">MODE</h1>
            {/* PLAY is the hero of the screen — a wide 21:9 banner (PlayMode2 art). The mode id stays `lobby`
                everywhere internally (store, run state, replays); only the LABEL is "Play" (owner 2026-08-17).
                A new player is offered the tutorial first (see `onPlay`). */}
            <div className="mprow">
              {rift && (
                <button className="modecard" onClick={() => { sfx.pulse(); startRift(); }}>
                  <div className="mcframe" data-mode="rift">
                    <div className="mcname">Rift</div>
                    <span className="mcemblem mcswirl" aria-hidden="true" />
                    <div className="mctag">{rift.name}</div>
                    <div className="mcdesc">{rift.blurb}</div>
                  </div>
                </button>
              )}
              <button className="modecard" data-mp="play" onClick={onPlay}>
                <div className="mcframe" data-mode="lobby" data-mp="play">
                  <div className="mcname">Play</div>
                  {modeArt('lobby')
                    ? <div className="mcart-clip"><img decoding="sync" className="mcframe-art" src={modeArt('lobby')} alt="" draggable={false} /></div>
                    : <span className="mcemblem"><IconHelm /></span>}
                  <div className="mcdesc">Rating {rating}</div>
                </div>
              </button>
            </div>

            {/* LEARN + Practice below. Learn opens the learning hub (Tutorial + future lessons); it does not
                launch a run directly. */}
            <div className="mprow">
              <button className="modecard" data-mp="learn" onClick={() => { sfx.pulse(); setLearnPick(true); }}>
                <div className="mcframe" data-mode="learn" data-mp="learn">
                  <div className="mcname">Learn</div>
                  {modeArt('learn')
                    ? <div className="mcart-clip"><img decoding="sync" className="mcframe-art" src={modeArt('learn')} alt="" draggable={false} /></div>
                    : <span className="mcemblem"><IconHelm /></span>}
                  <div className="mcdesc">Tutorial + techniques.</div>
                </div>
              </button>

              <button className="modecard" data-mp="practice" onClick={() => { sfx.pulse(); startPractice(); }}>
                <div className="mcframe" data-mode="practice" data-mp="practice">
                  <div className="mcname">Practice</div>
                  {modeArt('practice')
                    ? <div className="mcart-clip"><img decoding="sync" className="mcframe-art" src={modeArt('practice')} alt="" draggable={false} /></div>
                    : <span className="mcemblem"><IconHelm /></span>}
                  <div className="mcdesc">More time and unlimited Health.</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LEARN HUB — opened from the Learn card in the mode picker. Holds the guided Tutorial today; the
          advanced-lessons slots are placeholders for lessons we add later (owner 2026-08-17). */}
      {learnPick && (
        <div className="modepick" role="dialog" aria-label="Learn">
          <button className="hsback" onClick={() => { sfx.pulse(); setLearnPick(false); }}>← Back</button>
          <div className="mpbox">
            <h1 className="disp mptitle">LEARN</h1>
            <div className="mprow">
              <button className="modecard" onClick={() => { sfx.pulse(); startTutorial(LEARN_ASCENT); }}>
                <div className="mcframe" data-mode="learn">
                  <div className="mcname">Tutorial</div>
                  {modeArt('learn')
                    ? <div className="mcart-clip"><img decoding="sync" className="mcframe-art" src={modeArt('learn')} alt="" draggable={false} /></div>
                    : <span className="mcemblem"><IconHelm /></span>}
                  <div className="mcdesc">A coached first game — every mechanic, then graduate.</div>
                </div>
              </button>

              <button className="modecard mclocked" disabled data-tip="More guided lessons are coming soon">
                <div className="mcframe" data-mode="soon">
                  <div className="mcname">Advanced</div>
                  <span className="mcemblem"><Icon name="clock" /></span>
                  <div className="mcdesc">Tribes, synergies, tactics. Coming soon.</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TUTORIAL NUDGE — a new player who hits Play is offered the guided course first (owner 2026-08-17:
          the nudge lives here, not on an auto-popup). Either choice retires it: "Start Playing" records a
          skip so it never asks again. */}
      {tutorialPrompt && (
        <div className="modepick tutprompt-ov" role="dialog" aria-label="New here?">
          <div className="tutprompt-card">
            <div className="eyebrow">First time?</div>
            <h1 className="disp tutprompt-title">Try the Tutorial</h1>
            <p className="tutprompt-sub">A quick coached game teaches you everything — shop, build, position, and win. About five minutes.</p>
            <div className="tutprompt-actions">
              <button className="endplay pressable" onClick={() => { sfx.pulse(); setTutorialPrompt(false); startTutorial(LEARN_ASCENT); }}>Start the Tutorial</button>
              <button className="tutprompt-skip" onClick={() => { sfx.pulse(); skipCourse(LEARN_ASCENT.id, LEARN_ASCENT.version); setTutorialPrompt(false); startLobby(); }}>Skip — just play</button>
            </div>
          </div>
        </div>
      )}

      <div className="titleversion">v{__APP_VERSION__}</div>
    </div>
  );
}
