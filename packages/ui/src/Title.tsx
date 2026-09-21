import { useEffect, useState } from 'react';
import { AscentLogo } from './AscentLogo';
import { activeRift, LEARN_ASCENT } from '@game/sim';
import { avatarSrc, modeArt } from './art';
import { getTitleText, subscribeTitleText, titleContinueNote } from './titleTextConfig';
import { applyTitleVars } from './titleConfig';
import { applyTitleVeilVars } from './titleVeilConfig';
import { applyTitleAccountVars } from './titleAccountConfig';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame, tempHandle } from './store';
import { MenuSidebar, SidebarHost } from './MenuSidebar';
import { Crest, IconHelm } from './menuIcons';
import { startReplay } from './replay/replayPlayer';
import { getCourseProgress, skipCourse } from './tutorial/tutorialProfile';
import { RankCrest } from './rank/RankBar';
import { useCurrentRank } from './rank/rankSource';
import { rankLabel } from './rank/rankFormat';

/**
 * The title screen — the game's front door, shown at boot and after a run ends. Styled after the
 * homescreen mockup: a full-bleed sky-castle background, the ASCENT logo + wordmark, an ornate
 * left-aligned menu, the account corner (portrait / name / rank), and the build version. A single store
 * flag (`showTitle`) drives it, no router.
 *
 * THE MENU (owner ask 2026-09-21): Play · Social · Patch Notes · Scene Builder (DEV only) · Settings.
 * SOCIAL consolidates the four ladder pages — it opens the player's own Career page (`openCareer()`, the
 * un-stamped open, so the page fades in whole rather than as a sidebar hop), whose menu sidebar
 * (`MenuSidebar.tsx`) still lists Career · Leaderboard · Hall of Champions · Recent Games, so every page
 * stays one hop away without a plaque each on the title. The secondary row under the
 * plaques keeps only Report a Problem, Balance Report (DEV) and Rewatch Last Game (when a replay exists);
 * the Compendium left the title entirely (still the Tab key, `toggleBook`).
 */

// The Crest / helm / trophy glyphs live in `menuIcons.tsx`, shared with the ladder pages' menu sidebar.

const IconTrash = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1 11a2 2 0 0 1-2 1.9H9a2 2 0 0 1-2-1.9L6 9zm3.5 2v8H11v-8H9.5zm3.5 0v8h1.5v-8H13z" /></svg>
);

export function Title({ onSettings }: { onSettings: () => void }) {
  const showTitle = useGame((s) => s.showTitle);
  // Which view the title shows (main menu / mode picker / Learn hub) — store-held so the menu sidebar on any
  // ladder page can open the picker, and so `openTitle` lands on the main menu.
  const titleView = useGame((s) => s.titleView);
  const setTitleView = useGame((s) => s.setTitleView);
  const startPractice = useGame((s) => s.startPractice);
  const startLobby = useGame((s) => s.startLobby);
  const startTutorial = useGame((s) => s.startTutorial);
  const startRift = useGame((s) => s.startRift);
  const startSceneBuilder = useGame((s) => s.startSceneBuilder);
  // SOCIAL → the player's own Career page through `openCareer()` — the plain open, NOT the sidebar's `goTo`:
  // `goTo` stamps `navHopAt`, which makes the destination mount wearing `.hop` (page fade off, sidebar cut in
  // hard) — right for a sidebar hop, wrong for a title open, which should fade in whole like Play → modes
  // (review 2026-09-21). `careerOf` is already null here (`openTitle` spreads PAGES_CLOSED), so it is your
  // own page; the sidebar on that page leads to the other three.
  const openCareer = useGame((s) => s.openCareer);
  const openBalance = useGame((s) => s.openBalance);
  const openPatchNotes = useGame((s) => s.openPatchNotes);
  const openBugReport = useGame((s) => s.openBugReport);
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  const playerAvatar = useGame((s) => s.playerAvatar);
  const openAvatarPicker = useGame((s) => s.openAvatarPicker);
  const account = useGame((s) => s.account);
  const savedRun = useGame((s) => s.savedRun);
  const lastReplay = useGame((s) => s.lastReplay);
  const continueRun = useGame((s) => s.continueRun);
  const clearRun = useGame((s) => s.clearRun);
  // The account corner's rank badge (owner 2026-09-21) — the crest + division under the name plate.
  const rank = useCurrentRank();

  // FRONT-PAGE COPY (dev Title Text tuner). Re-render on change so edits land live behind the panel; with no
  // override this returns the shipped defaults, so production is byte-identical to the hard-coded strings.
  const [, bumpText] = useState(0);
  useEffect(() => subscribeTitleText(() => bumpText((n) => n + 1)), []);
  // Apply the persisted Title Logo tuner values (dev) / DEFAULTS (prod) to `--title-*` when the menu mounts.
  // Same for the Title Veil (`--tv-*`, the navy background vignette) and the account corner (`--ta-*`).
  useEffect(() => { applyTitleVars(); applyTitleVeilVars(); applyTitleAccountVars(); }, []);
  const txt = getTitleText();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false); // two-step guard on the destructive Clear Run
  // A new player hitting Play is offered the tutorial first. Local: a transient nudge, and both of its buttons
  // retire it. (The mode picker / Learn hub views are `titleView` in the store — returning to the title lands
  // on the MAIN menu because `openTitle` / `cancelPracticeSetup` reset it; owner ask 2026-08-24.)
  const [tutorialPrompt, setTutorialPrompt] = useState(false);

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

  // The Play plaque. With a run saved it carries the same warning the sidebar's Play does, as a `data-tip`
  // bubble on a WRAPPER (`.tn-item`, positioned like the sidebar's `.msb-item`): the plaque's own ::after is
  // its sheen, so a tip on the plaque itself is inert by the tooltip rule. No native `title=` on the title.
  const playPlaque = (
    <button className={`menubtn${savedRun ? '' : ' active'}`} onClick={() => { sfx.pulse(); setTitleView('modes'); }}>
      <span className="mbicon"><Crest /></span>
      <span className="mblabel">{txt.play}</span>
    </button>
  );

  return (
    <div className="titlescreen">
      {/* Static homescreen background — the looping menu video is disabled for now (owner request 2026-07-08);
          the full-bleed sky-castle art comes from the `.titlescreen` CSS background (homescreen.webp). */}

      {/* ACCOUNT CORNER (owner ask 2026-09-21) — the player's portrait LARGE in the game's gold portrait ring
          (the `.portring` the Career page + rank screen wear; click opens the avatar picker), their NAME as a
          plate eclipsing the ring's bottom edge like the in-game hero-name pill (click-to-rename), and their
          current RANK in a badge beneath. Sign in / Sign out live in Settings now. Sizes + offsets are the
          👤 Title Account dev tuner's `--ta-*` vars (see titleAccountConfig.ts). No `data-tip` on `.portring`
          itself — its ::after IS the ring; the tip rides the wrapping button. */}
      <div className="titleaccount">
        <button
          className={`titleportrait${avatarSrc(playerAvatar) ? '' : ' noart'}`}
          onClick={openAvatarPicker}
          data-tip="Change your avatar"
          aria-label="Change your avatar"
        >
          <div className="portring">
            <div className="hero">
              <div className="f">
                {avatarSrc(playerAvatar)
                  ? <img decoding="sync" className="heroimg" src={avatarSrc(playerAvatar)} alt="" draggable={false} />
                  : <span className="titleportrait-ph">{(effectiveName.trim()[0] ?? '').toUpperCase() || '☺'}</span>}
              </div>
            </div>
          </div>
        </button>
        <div className="titlename-seat">
          {editing ? (
            <input
              className="acctinput titlename-input"
              autoFocus
              maxLength={24}
              value={draft}
              placeholder="Your name"
              aria-label="Your name"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            />
          ) : (
            <button
              className="titlename"
              onClick={beginEdit}
              data-tip={unnamed ? 'This is a temporary name. Click to make it your own.' : 'Click to change your name'}
            >
              {/* First-time nudge: a real element (not a pseudo — the tooltip owns this button's ::before/::after)
                  with a STATIC ring shadow whose OPACITY pulses (compositor-only). */}
              {unnamed && <span className="titlename-nudge" aria-hidden="true" />}
              <span className="titlename-txt">{effectiveName}</span>
            </button>
          )}
        </div>
        {rank && (
          <div className="titlerank" aria-label={`Rank ${rankLabel(rank)}`}>
            <RankCrest divisionIndex={rank.divisionIndex} size="mini" hideDivision />
            <span className="titlerank-label">{rankLabel(rank)}</span>
          </div>
        )}
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
                data-tip={confirmClear ? 'Click again to discard your saved run.' : 'Discard your saved run.'}
                aria-label="Discard your saved run"
              >
                {confirmClear ? 'Clear?' : <IconTrash />}
              </button>
            </div>
          )}
          {savedRun ? <div className="tn-item" data-tip="New run. Replaces your saved run.">{playPlaque}</div> : playPlaque}
          {/* Learn moved OFF the main menu (owner 2026-08-17): it now lives in the mode picker as its own card,
              opening a learning hub (Tutorial + future advanced lessons). A new player is also offered the
              tutorial the first time they hit Play. */}
          {/* SOCIAL (owner ask 2026-09-21) — Career, Leaderboard, Hall of Champions and Recent Games folded into
              one plaque. It opens your Career page; that page's sidebar carries the other three. The helm is the
              Career glyph the sidebar still wears, so the destination reads the same on both. */}
          <button className="menubtn" onClick={() => { sfx.pulse(); openCareer(); }} data-tip="Your Career, the Leaderboard, the Hall of Champions and Recent Games">
            <span className="mbicon"><IconHelm /></span>
            <span className="mblabel">Social</span>
          </button>
          <button className="menubtn" onClick={() => { sfx.pulse(); openPatchNotes(); }} data-tip="Gameplay changes by date">
            <span className="mbicon"><Icon name="clock" /></span>
            <span className="mblabel">Patch Notes</span>
          </button>
          {/* DEV-ONLY: the Scene Builder is a dev sandbox stripped from the player build (the prod menu is Play ·
              Social · Patch Notes · Settings). */}
          {import.meta.env.DEV && (
            <button className="menubtn" onClick={() => { sfx.pulse(); startSceneBuilder(); }} data-tip="A dev sandbox. A lobby game against bots where you cannot be eliminated, with any board, any enemy, god or normal rules.">
              <span className="mbicon"><Icon name="anvil" /></span>
              <span className="mblabel">Scene Builder</span>
            </button>
          )}
          <button className="menubtn" onClick={onSettings}>
            <span className="mbicon"><Icon name="gear" /></span>
            <span className="mblabel">{txt.settings}</span>
          </button>
        </nav>

        {/* Secondary links under the plaques: the reporter, the DEV balance report and the last replay. The
            Compendium link left here on 2026-09-21 (owner: "not important" on the title); it is still Tab. */}
        <div className="titlesecondary">
          {/* BUG REPORTER from the MAIN MENU (owner ask 2026-08-27): the same reporter as in-game Ctrl+B —
              no run needed; the description is the payload. Routes through the store's one open authority. */}
          <button onClick={() => { sfx.pulse(); openBugReport(); }} data-tip="Spotted a problem? Describe it here, no run needed (Ctrl+B).">Report a Problem</button>
          {/* DEV-ONLY (owner 2026-08-24): the Balance Report is a dev/telemetry view, stripped from the exe +
              itch prod builds. The dot rides inside the guard so prod never shows a dangling separator. */}
          {import.meta.env.DEV && (
            <>
              <span className="tsdot">·</span>
              <button onClick={() => { sfx.pulse(); openBalance(); }} data-tip="Balance Report. Real player offer, pick and win rates.">Balance Report</button>
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
        </div>
      </div>

      {/* MODE PICKER — a full-screen view in the HERO-SELECT idiom (owner request): big framed cards in a
          row, each with a name pill eclipsing the frame's top edge, a tag pill eclipsing the bottom, and the
          description fading in on hover. Ascent is the clean scored climb; Rift is the SAME climb with the
          active rift's rules (opt-in as of this screen); Practice is unscored. The Rift card is mounted only
          while a rift is actually live. */}
      {titleView !== 'menu' && (
        <SidebarHost className="modepick sb-host" role="dialog" aria-label="Choose a mode">
          {/* The menu sidebar carries Back (→ the main menu) + the main menu itself (owner ask 2026-09-21). */}
          <MenuSidebar current="modes" onBack={() => { sfx.pulse(); setTitleView('menu'); }} />
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
                  {/* No rank on the Play card (owner 2026-09-21): the crest + bar live on the Career page and the
                      Leaderboard; the card is just the door to the ranked lobby. */}
                  <div className="mcdesc">The ranked eight-seat lobby.</div>
                </div>
              </button>
            </div>

            {/* LEARN + Practice below. Learn opens the learning hub (Tutorial + future lessons); it does not
                launch a run directly. */}
            <div className="mprow">
              <button className="modecard" data-mp="learn" onClick={() => { sfx.pulse(); setTitleView('learn'); }}>
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
        </SidebarHost>
      )}

      {/* LEARN HUB — opened from the Learn card in the mode picker. Holds the guided Tutorial today; the
          advanced-lessons slots are placeholders for lessons we add later (owner 2026-08-17). */}
      {titleView === 'learn' && (
        <SidebarHost className="modepick sb-host" role="dialog" aria-label="Learn">
          <MenuSidebar current="modes" onBack={() => { sfx.pulse(); setTitleView('modes'); }} />
          <div className="mpbox">
            <h1 className="disp mptitle">LEARN</h1>
            <div className="mprow">
              <button className="modecard" onClick={() => { sfx.pulse(); startTutorial(LEARN_ASCENT); }}>
                <div className="mcframe" data-mode="learn">
                  <div className="mcname">Tutorial</div>
                  {modeArt('learn')
                    ? <div className="mcart-clip"><img decoding="sync" className="mcframe-art" src={modeArt('learn')} alt="" draggable={false} /></div>
                    : <span className="mcemblem"><IconHelm /></span>}
                  <div className="mcdesc">A coached first game. Every mechanic, then graduate.</div>
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
        </SidebarHost>
      )}

      {/* TUTORIAL NUDGE — a new player who hits Play is offered the guided course first (owner 2026-08-17:
          the nudge lives here, not on an auto-popup). Either choice retires it: "Start Playing" records a
          skip so it never asks again. */}
      {tutorialPrompt && (
        <div className="modepick tutprompt-ov" role="dialog" aria-label="New here?">
          <div className="tutprompt-card">
            <div className="eyebrow">First time?</div>
            <h1 className="disp tutprompt-title">Try the Tutorial</h1>
            <p className="tutprompt-sub">A quick coached game teaches you everything: shop, build, position, and win. About five minutes.</p>
            <div className="tutprompt-actions">
              <button className="endplay pressable" onClick={() => { sfx.pulse(); setTutorialPrompt(false); startTutorial(LEARN_ASCENT); }}>Start the Tutorial</button>
              <button className="tutprompt-skip" onClick={() => { sfx.pulse(); skipCourse(LEARN_ASCENT.id, LEARN_ASCENT.version); setTutorialPrompt(false); startLobby(); }}>Skip and just play</button>
            </div>
          </div>
        </div>
      )}

      {/* Version + the exact commit the bundle was built from (`*` = built on a dirty tree, so NOT that commit).
          This is how a player and `git log` agree on which build is running — read it off the exe. */}
      <div className="titleversion" title={`built ${__BUILD_DATE__}`}>v{__APP_VERSION__} · {__BUILD_SHA__}{__BUILD_DIRTY__ ? '*' : ''}</div>
    </div>
  );
}
