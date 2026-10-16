import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AscentLogo } from './AscentLogo';
import { LEARN_ASCENT } from '@game/sim';
import { avatarSrc, modeArt } from './art';
import { FadeImg } from './FadeImg';
import { getTitleText, subscribeTitleText, titleContinueNote } from './titleTextConfig';
import { applyTitleVars } from './titleConfig';
import { applyTitleVeilVars } from './titleVeilConfig';
import { applyTitleAccountVars } from './titleAccountConfig';
import { Icon } from './Icon';
import { PortraitFrame, pfClass, usePortraitFrame } from './portraitFrame/PortraitFrame';
import { sfx } from './sfx';
import { useGame, tempHandle } from './store';
import { abandonWarningOf, withAbandonWarning } from './rank/ratedRun';
import { RANKED_CONFIRM_EXIT_MS, RANKED_CONFIRM_NO, RANKED_CONFIRM_TEXT, RANKED_CONFIRM_TITLE, RANKED_CONFIRM_YES } from './rank/rankedEntry';
import { MenuSidebar, SidebarHost } from './MenuSidebar';
import { warmRankedGate } from './rankedGate/RankedGate';
import { requestRankedGate } from './rankedGate/rankedGateController';
import { Crest, IconChest, IconHelm } from './menuIcons';
import { cratesVisible, useProgression } from './progression/progressionStore';
import { startReplay } from './replay/replayPlayer';
import { getCourseProgress, skipCourse } from './tutorial/tutorialProfile';
import { RankCrest } from './rank/RankBar';
import { useCurrentRank } from './rank/rankSource';
import { rankLabel } from './rank/rankFormat';
import { NewPill, useHasNewRewards } from './progression/NewRewardsPopup';
import { StageSelect } from './gauntlet/StageSelect';
import { GuestSignInButton, PortraitSignInGate } from './GuestSignIn';
import { schedulePrefetchSocial } from './socialPrefetch';
import { VersusTitle } from './versus/VersusTitle';
import { VersusRoom } from './versus/VersusRoom';
import { openVersus, resumeVersusMatch, useVersus } from './versus/versusStore';
import { versusEnabled } from './versus/versusFlag';
import { readLastMode, rememberMode, type ModeKey } from './lastMode';

/**
 * The title screen — the game's front door, shown at boot and after a run ends. Styled after the
 * homescreen mockup: a full-bleed sky-castle background, the ASCENT logo + wordmark, an ornate
 * left-aligned menu, the account corner (portrait / name / rank), and the build version. A single store
 * flag (`showTitle`) drives it, no router.
 *
 * THE MENU (owner ask 2026-09-21): Play · Social · Collection (2026-09-28, once crates are live) · Patch Notes ·
 * Scene Builder (DEV only) · Settings.
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
  const startSceneBuilder = useGame((s) => s.startSceneBuilder);
  const startStageBuilder = useGame((s) => s.startStageBuilder);
  // SOCIAL → the player's own Career page through `openCareer()` — the plain open, NOT the sidebar's `goTo`:
  // `goTo` stamps `navHopAt`, which makes the destination mount wearing `.hop` (page fade off, sidebar cut in
  // hard) — right for a sidebar hop, wrong for a title open, which should fade in whole like Play → modes
  // (review 2026-09-21). `careerOf` is already null here (`openTitle` spreads PAGES_CLOSED), so it is your
  // own page; the sidebar on that page leads to the other three.
  const openCareer = useGame((s) => s.openCareer);
  // COLLECTION (owner ask 2026-09-28: "make the collection screen separate"): its own plaque, with the sealed-crate
  // count. Shown once crates are live (always in DEV, so the screen and its tuner are reachable before the SQL).
  const openCollection = useGame((s) => s.openCollection);
  const newRewards = useHasNewRewards();
  const collectionOn = useProgression(cratesVisible) || import.meta.env.DEV;
  const sealedCrates = useProgression((s) => (s.crateList ?? []).filter((c) => c.state === 'sealed').length);
  const openBalance = useGame((s) => s.openBalance);
  const openPatchNotes = useGame((s) => s.openPatchNotes);
  const openBugReport = useGame((s) => s.openBugReport);
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  const playerAvatar = useGame((s) => s.playerAvatar);
  const versusScreen = useVersus((s) => s.screen);
  // The portrait-frames tuner's ring for your own avatar corner (null = today's copper ring).
  const avatarFrame = usePortraitFrame('self');
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
  // VERSUS: a player who left a RUNNING match (reload, crash, new tab) is taken straight back into it.
  useEffect(() => { if (versusEnabled()) void resumeVersusMatch(); }, []);
  const txt = getTitleText();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false); // two-step guard on the destructive Clear Run
  // A new player hitting Play is offered the tutorial first. Local: a transient nudge, and both of its buttons
  // retire it. (The mode picker / Learn hub views are `titleView` in the store — returning to the title lands
  // on the MAIN menu because `openTitle` / `cancelPracticeSetup` reset it; owner ask 2026-08-24.)
  const [tutorialPrompt, setTutorialPrompt] = useState(false);
  // THE RANKED CONFIRMATION (owner 2026-10-11, R-RANK-06): the Play card never opens hero select directly. It asks
  // first, because from "Yes" on, leaving the match (even from hero select) settles as an 8th.
  // It opens OVER the mode picker (owner 2026-10-12: "take place on the play menu screen ... have the background
  // blurred and darkened ... this window expands out with a little bit of a bounce"): `open` plays the entrance,
  // `closing` is the short reverse "No, go back." plays before the card unmounts.
  const [rankedConfirm, setRankedConfirm] = useState<'open' | 'closing' | null>(null);
  const rankedCloseTimer = useRef<number | null>(null);
  useEffect(() => () => { if (rankedCloseTimer.current != null) window.clearTimeout(rankedCloseTimer.current); }, []);
  // A GUEST's portrait click opens the portrait sign-in gate, not the avatar picker (owner 2026-09-29: "don't let
  // non-signed in players change the portrait either, they need to sign in for that"). Read fresh per click.
  const [portraitGate, setPortraitGate] = useState(false);
  const closePortraitGate = useCallback(() => setPortraitGate(false), []);
  // COVERED (perf 2026-10-09): a full-screen menu page (Career, Leaderboard, Hall, Recent Games, Collection) sits on
  // top of the title, which stays mounted under it so Back is instant. Once the page's 0.2 s fade-in is done the
  // title is skipped by the browser (`.titlescreen.covered`: no style, paint or animation work under an opaque page);
  // closing the page un-skips it at once.
  const pageOpen = useGame((s) => s.showCareer || s.showRankings || s.showLeaderboard || s.showRecentGames || s.showLiveGames || s.showCollection);
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!pageOpen) { setCovered(false); return undefined; }
    const t = window.setTimeout(() => setCovered(true), 300);
    return () => window.clearTimeout(t);
  }, [pageOpen]);

  // SOCIAL PREFETCH (perf 2026-10-09): while the title is up, warm the Social pages' reads on idle time so Social
  // opens on cached rows (socialPrefetch.ts; fresh answers are not re-read, so coming back here is cheap).
  useEffect(() => (showTitle && !pageOpen ? schedulePrefetchSocial() : undefined), [showTitle, pageOpen]);

  if (!showTitle) return null;

  // A player who has never finished (or skipped) the guided course is "new" — hitting Play offers the tutorial
  // once before the real game, rather than dropping them in cold.
  const learnStatus = getCourseProgress(LEARN_ASCENT.id)?.status;
  const isNewPlayer = !learnStatus || learnStatus === 'not_started';
  const openRankedConfirm = (): void => {
    if (rankedCloseTimer.current != null) { window.clearTimeout(rankedCloseTimer.current); rankedCloseTimer.current = null; }
    setRankedConfirm('open');
    warmRankedGate(); // the gate "Yes" plays: its art, cues and FX layer are ready before the answer
  };
  // "Yes, let's go." (owner 2026-10-12): the window leaves, the ranked gate slams shut over the mode picker, and
  // `startLobby` (the entry + hero select) runs BEHIND the shut doors, so they open on hero select. With no gate
  // (reduced motion, a test) `requestRankedGate` runs it at once.
  // It acts on the PRESS (pointer down), not the release (owner 2026-10-12: "is it possible to have it play any
  // sooner?"): a click only fires when the mouse button comes back up, which is where most of the wait was. The
  // button keeps `onClick` too for the keyboard; the `open` guard makes the second of the two a no-op.
  const confirmRanked = (): void => {
    if (rankedConfirm !== 'open') return;
    // The in-game End Turn sound (owner 2026-10-13: "add the 'end turn' sound effect we use in game when clicking
    // the end turn and start combat crystal ... that can be the sound that emits when clicking the 'yes continue'
    // button"): `sfx.combatStart`, the cue `faceOmen` plays when the End Turn crystal is pressed. It replaces the
    // plain menu click here. (The cinematic hit that played here on 2026-10-12 moved to the crystal's shatter.)
    sfx.combatStart();
    closeRankedConfirm();
    void requestRankedGate(startLobby);
  };
  // "No, go back." (or a press on the dimmed picker around the card): play the exit, then unmount.
  const closeRankedConfirm = (): void => {
    if (rankedConfirm !== 'open') return;
    setRankedConfirm('closing');
    rankedCloseTimer.current = window.setTimeout(() => { rankedCloseTimer.current = null; setRankedConfirm(null); }, RANKED_CONFIRM_EXIT_MS);
  };
  // Play from the mode picker: nudge a new player to the tutorial first; everyone else gets the ranked
  // confirmation, and only its "Yes" starts the lobby.
  const onPlay = () => {
    sfx.pulse();
    if (isNewPlayer) setTutorialPrompt(true);
    else openRankedConfirm();
  };
  // Saying yes with an unfinished RATED game in the save slot also gives that game up once a hero is picked (the
  // new run replaces the one slot, R-RANK-05), so the confirmation names that cost too. Null otherwise.
  const savedGameWarning = abandonWarningOf(savedRun);

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

  // The mode you last launched from the picker (read per render: the title stays mounted across runs).
  const lastMode = titleView !== 'menu' ? readLastMode() : null;
  // A secondary mode tile: the art clipped to the frame, the name pill on the top edge (the hero-card idiom),
  // the description always on show along the bottom, and the "Last played" tag when it applies.
  const modeTile = (mode: string, mp: ModeKey, name: string, desc: string, onClick: () => void, emblem: ReactNode): JSX.Element => (
    <button className="modecard mc-tile" data-mp={mp} onClick={onClick}>
      <div className="mcframe" data-mode={mode} data-mp={mp}>
        <div className="mcname hudpill-name">{name}</div>
        {modeArt(mode)
          ? <div className="mcart-clip"><FadeImg className="mcframe-art" src={modeArt(mode)} alt="" draggable={false} /></div>
          : <span className="mcemblem">{emblem}</span>}
        <div className="mcdesc">{desc}</div>
        {lastMode === mp && <span className="mclast">Last played</span>}
      </div>
    </button>
  );
  // A picker sub-view's heading: a crumb back to the picker, then the view's name (the rail's Play goes there too).
  const subHead = (name: string): JSX.Element => (
    <div className="mphead">
      <button className="mpcrumb" onClick={() => { sfx.pulse(); setTitleView('modes'); }}>Modes</button>
      <span className="mpsep" aria-hidden="true">/</span>
      <h1 className="disp mptitle">{name}</h1>
    </div>
  );

  return (
    <div className={`titlescreen${covered ? ' covered' : ''}`}>
      {/* Static homescreen background — the looping menu video is disabled for now (owner request 2026-07-08);
          the full-bleed sky-castle art comes from the `.titlescreen` CSS background (homescreen.webp). */}

      {/* ACCOUNT CORNER (owner ask 2026-09-21) — the player's portrait LARGE in the game's gold portrait ring
          (the `.portring` the Career page + rank screen wear; click opens the avatar picker), their NAME as a
          plate eclipsing the ring's bottom edge like the in-game hero-name pill (click-to-rename), and their
          current RANK in a badge beneath. Sign in / Sign out live in Settings now. Sizes + offsets are the
          👤 Title Account dev tuner's `--ta-*` vars (see titleAccountConfig.ts). No `data-tip` on `.portring`
          itself — its ::after IS the ring; the tip rides the wrapping button. */}
      <div className="titleaccount">
        {/* GUEST SIGN-IN (owner 2026-09-29): a slow-blinking "Sign in!" left of the portrait, guests only. */}
        <GuestSignInButton />
        <button
          className={`titleportrait${avatarSrc(playerAvatar) ? '' : ' noart'}`}
          onClick={() => { if (account.anonymous) { sfx.pulse(); setPortraitGate(true); } else openAvatarPicker(); }}
          // No hover tip for a guest: it pops out LEFT, right over the Sign in! button beside it; the button and the
          // click prompt already say it.
          data-tip={account.anonymous ? undefined : 'Change your avatar'}
          aria-label={account.anonymous ? 'Sign in to change your portrait' : 'Change your avatar'}
        >
          <div className={`portring${pfClass(avatarFrame)}`} style={avatarFrame?.hostStyle}>
            <div className="hero">
              <div className="f">
                {avatarSrc(playerAvatar)
                  ? <img decoding="sync" className="heroimg" src={avatarSrc(playerAvatar)} alt="" draggable={false} />
                  : <span className="titleportrait-ph">{(effectiveName.trim()[0] ?? '').toUpperCase() || '☺'}</span>}
              </div>
              <PortraitFrame frame={avatarFrame} />
            </div>
          </div>
        </button>
        <div className="titlename-seat">
          {editing ? (
            <input
              className="acctinput titlename-input hudpill-name"
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
              className="titlename hudpill-name"
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

      <PortraitSignInGate open={portraitGate} onClose={closePortraitGate} />

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
                data-tip={withAbandonWarning(confirmClear ? 'Click again to discard your saved run.' : 'Discard your saved run.', savedRun)}
                aria-label="Discard your saved run"
              >
                {confirmClear ? 'Clear?' : <IconTrash />}
              </button>
            </div>
          )}
          {savedRun ? <div className="tn-item" data-tip={withAbandonWarning('New run. Replaces your saved run.', savedRun)}>{playPlaque}</div> : playPlaque}
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
          {collectionOn && (
            <button className={`menubtn${newRewards ? ' hasnew' : ''}`} onClick={() => { sfx.pulse(); openCollection(); }} data-tip={newRewards ? 'New rewards are waiting in your Collection' : 'Open your crates and wear your titles'}>
              <span className="mbicon"><IconChest /></span>
              <span className="mblabel">Collection</span>
              {newRewards && <NewPill />}
              {sealedCrates > 0 && <span className="mbnote" aria-label={`${sealedCrates} sealed ${sealedCrates === 1 ? 'crate' : 'crates'}`}>{sealedCrates} sealed</span>}
            </button>
          )}
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
          {/* DEV-ONLY: the Stage Builder authors the Gauntlet's stage boards on top of the Scene Builder sandbox. */}
          {import.meta.env.DEV && (
            <button className="menubtn" onClick={() => { sfx.pulse(); void startStageBuilder(); }} data-tip="A dev tool. Author the Gauntlet's stages: the opponent's warband for each round, edited on the board.">
              <span className="mbicon"><Icon name="sword" /></span>
              <span className="mblabel">Stage Builder</span>
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

      {/* MODE PICKER (redesigned for UI refinement WS-2, 2026-10-16; owner: "our play mode screen seems bad").
          One fixed grid over the painted hall (MenuBackdrop): PLAY, the ranked lobby, is the large tile with the one
          gold call to action; Practice and Versus stack beside it; Gauntlet and Learn share the row below. Every
          mode stays one click away and the tiles never move (muscle memory); the mode you last launched wears a
          "Last played" tag instead (lastMode.ts). Descriptions are always shown, never hidden behind a hover.
          The mode id stays `lobby` everywhere internally; only the LABEL is "Play" (owner 2026-08-17). */}
      {/* Mounted under the Learn / Gauntlet / Versus views too (they open OVER it), so opening one never flashes
          the title through its fade-in. */}
      {titleView !== 'menu' && (
        <SidebarHost className="modepick sb-host mp-home" role="dialog" aria-label="Choose a mode">
          <MenuSidebar current="modes" />
          <div className="mpbox">
            <div className="mphead"><h1 className="disp mptitle">Choose a mode</h1></div>
            <div className="mpgrid">
              <button className="modecard mc-hero" data-mp="play" onClick={() => { rememberMode('play'); onPlay(); }}>
                <div className="mcframe" data-mode="lobby" data-mp="play">
                  {modeArt('lobby')
                    ? <div className="mcart-clip"><FadeImg className="mcframe-art" src={modeArt('lobby')} alt="" draggable={false} /></div>
                    : <span className="mcemblem"><IconHelm /></span>}
                  {/* No rank on the Play card (owner 2026-09-21): the crest + bar live on the Career page and the
                      Leaderboard; the card is just the door to the ranked lobby. */}
                  <div className="mcdesc">The ranked eight-seat lobby.</div>
                  {lastMode === 'play' && <span className="mclast">Last played</span>}
                  <span className="mcname mc-cta"><Crest /><span>Play</span></span>
                </div>
              </button>
              <div className="mpside">
                {modeTile('practice', 'practice', 'Practice', 'More time and unlimited Health.', () => { rememberMode('practice'); sfx.pulse(); startPractice(); }, <IconHelm />)}
                {versusEnabled() && modeTile('versus', 'versus', 'Versus', 'Real-time 1v1. Seven hearts each. Unranked.', () => { rememberMode('versus'); sfx.pulse(); openVersus(); }, <Crest />)}
              </div>
              <div className="mprow2">
                {modeTile('gauntlet', 'gauntlet', 'Gauntlet', 'Survive 10 rounds against a hand-built foe.', () => { rememberMode('gauntlet'); sfx.pulse(); setTitleView('gauntlet'); }, <Crest />)}
                {modeTile('learn', 'learn', 'Learn', 'The tutorial and techniques.', () => { sfx.pulse(); setTitleView('learn'); }, <IconHelm />)}
              </div>
            </div>
          </div>
        </SidebarHost>
      )}

      {/* LEARN HUB — opened from the Learn card in the mode picker. Holds the guided Tutorial today; the
          advanced-lessons slots are placeholders for lessons we add later (owner 2026-08-17). The crumb (and the
          rail's Play) lead back to the picker. */}
      {titleView === 'learn' && (
        <SidebarHost className="modepick sb-host" role="dialog" aria-label="Learn">
          <MenuSidebar current="modes" />
          <div className="mpbox">
            {subHead('Learn')}
            <div className="mprow">
              <button className="modecard" onClick={() => { rememberMode('learn'); sfx.pulse(); startTutorial(LEARN_ASCENT); }}>
                <div className="mcframe" data-mode="learn">
                  <div className="mcname hudpill-name">Tutorial</div>
                  {modeArt('learn')
                    ? <div className="mcart-clip"><FadeImg className="mcframe-art" src={modeArt('learn')} alt="" draggable={false} /></div>
                    : <span className="mcemblem"><IconHelm /></span>}
                  <div className="mcdesc">A coached first game. Every mechanic, then graduate.</div>
                </div>
              </button>

              <button className="modecard mclocked" disabled data-tip="More guided lessons are coming soon">
                <div className="mcframe" data-mode="soon">
                  <div className="mcname hudpill-name">Advanced</div>
                  <span className="mcemblem"><Icon name="clock" /></span>
                  <div className="mcdesc">Tribes, synergies, tactics. Coming soon.</div>
                </div>
              </button>
            </div>
          </div>
        </SidebarHost>
      )}

      {/* GAUNTLET STAGE SELECT — opened from the Gauntlet card in the mode picker (the Learn hub's pattern: it sits
          over the picker, and the crumb returns to it). Picking a stage opens the hero picker for that stage. */}
      {titleView === 'gauntlet' && (
        <SidebarHost className="modepick sb-host" role="dialog" aria-label="Gauntlet">
          <MenuSidebar current="modes" />
          <div className="mpbox">
            {subHead('Gauntlet')}
            <StageSelect />
          </div>
        </SidebarHost>
      )}

      {/* VERSUS — the lobby browser and the room (versus/VersusTitle.tsx), over the picker like the Gauntlet view. */}
      {titleView === 'versus' && versusScreen === 'room' && <VersusRoom />}
      {titleView === 'versus' && versusScreen !== 'room' && (
        <SidebarHost className="modepick sb-host" role="dialog" aria-label="Versus">
          <MenuSidebar current="modes" />
          <div className="mpbox">
            {subHead('Versus')}
            <VersusTitle />
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
              <button className="tutprompt-skip" onClick={() => { sfx.pulse(); skipCourse(LEARN_ASCENT.id, LEARN_ASCENT.version); setTutorialPrompt(false); openRankedConfirm(); }}>Skip and just play</button>
            </div>
          </div>
        </div>
      )}

      {/* THE RANKED CONFIRMATION (owner 2026-10-11, R-RANK-06) — the Play card's gate, in the owner's words. "Yes"
          commits the ranked entry and opens hero select (`startLobby`); "No" returns to the mode picker under it.
          It sits OVER the mode picker (owner 2026-10-12), which stays on screen behind a veil that darkens and
          blurs it while the card expands out with a small bounce. Motion is `transform` + `opacity` only: the
          veil's blur is static and only its opacity fades (styles.css, "THE RANKED CONFIRMATION"). */}
      {rankedConfirm && (
        <div className={`rankedconfirm-ov${rankedConfirm === 'closing' ? ' closing' : ''}`} role="dialog" aria-modal="true" aria-label="Ranked lobby">
          <div className="rankedconfirm-veil" onClick={closeRankedConfirm} aria-hidden="true" />
          {/* THE WINDOW wears the Compendium's chrome (owner 2026-10-12: "use the border that the compendium uses ...
              emulate the title and underline structure ... make the buttons look like the UI elements" in its top
              right): the painted 9-slice frame + its two crests, the title over the painted name divider, and the
              answers as Gem plates. Its own classes in styles.css, since compendium.css loads with the book. */}
          <div className="rankedconfirm">
            <span className="rc-crest" aria-hidden="true" />
            <span className="rc-crest rc-crest-foot" aria-hidden="true" />
            <div className="rc-title">{RANKED_CONFIRM_TITLE}</div>
            <p className="rankedconfirm-text">{RANKED_CONFIRM_TEXT}</p>
            {savedGameWarning && <p className="rankedconfirm-save">Picking a hero also gives up your saved game. {savedGameWarning}</p>}
            <div className="rankedconfirm-actions">
              <button className="rc-btn rc-btn-yes" disabled={rankedConfirm === 'closing'} onPointerDown={(e) => { if (e.button === 0) confirmRanked(); }} onClick={confirmRanked}>{RANKED_CONFIRM_YES}</button>
              <button className="rc-btn" onClick={() => { sfx.pulse(); closeRankedConfirm(); }}>{RANKED_CONFIRM_NO}</button>
            </div>
          </div>
        </div>
      )}

      {/* Version + the exact commit the bundle was built from (`*` = built on a dirty tree, so NOT that commit).
          This is how a player and `git log` agree on which build is running — read it off the exe. */}
      <div className="titleversion" aria-description={`built ${__BUILD_DATE__}`}>v{__APP_VERSION__} · {__BUILD_SHA__}{__BUILD_DIRTY__ ? '*' : ''}</div>
    </div>
  );
}
