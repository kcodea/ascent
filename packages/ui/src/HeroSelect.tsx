import { useEffect, useReducer, useRef, type CSSProperties, type MouseEvent } from 'react';
import { AscentLogo } from './AscentLogo';
import { mdBold } from './Card';
import { getHero, activeRift, heroTip, SHOW_HERO_TIPS } from '@game/sim';
import { RiftPill } from './RiftPill';
import { heroArt, heroPowerArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import {
  ceremonyReduce, CEREMONY_IDLE, ceremonyActive, ceremonyAcceptsClicks,
} from './hero-select/heroCeremonyMachine';
import { snapshotRect } from './hero-select/heroCeremonyGeometry';
import { ceremonyTiming } from './hero-select/heroCeremonyTiming';
import { HSC_REPLAY_EVENT } from './hero-select/heroCeremonyTunerConfig';
import { HeroSelectCeremony } from './hero-select/HeroSelectCeremony';

/**
 * Pre-run hero picker. Shows whenever the store has `heroChoices` (first load + after a
 * game over). Picking one starts a fresh run as that hero. This is the first slice of the
 * eventual Title → Mode → Hero flow — a single store flag drives it, no router.
 *
 * SELECTION CEREMONY (hero-select-ceremony-blueprint.md): a click no longer creates the run. It commits
 * the ceremony machine (local useReducer — heroChoices stays set the whole time, so this component stays
 * mounted); HeroSelectCeremony choreographs the presentation; the run is created only when Start Game
 * routes through the Game-owned launch curtain (`requestLaunch` → `pickHero`).
 */
export function HeroSelect() {
  const choices = useGame((s) => s.heroChoices);
  const openTitle = useGame((s) => s.openTitle);
  const mode = useGame((s) => s.pendingMode);
  const profile = useGame((s) => s.profile);
  const [ceremony, dispatch] = useReducer(ceremonyReduce, CEREMONY_IDLE);
  // The choice cards, by index — the ceremony snapshots + animates them but never owns their DOM.
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // HeroSelect renders null (but stays MOUNTED) once pickHero clears heroChoices — so the machine must be
  // reset whenever a new offer arrives, or a finished `launching` state would eat every click next run.
  useEffect(() => { dispatch({ type: 'reset' }); }, [choices]);
  // DEV tuner "Replay" (heroCeremonyTunerConfig): re-run the ceremony with the CURRENT selection so a timing
  // change can be judged without re-clicking through Title → mode. Reset unmounts the ceremony (its cleanup
  // restores the hidden original card + cancels every animation); one frame later the same selection
  // re-commits with a fresh clock. A replay before any selection is a silent no-op. Dev builds only.
  const ceremonyRef = useRef(ceremony);
  ceremonyRef.current = ceremony;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onReplay = () => {
      const c = ceremonyRef.current;
      if (!c.heroId || !c.sourceRect || c.phase === 'launching') return; // nothing to replay / run already leaving
      const { heroId, sourceRect, sourceIndex } = c;
      dispatch({ type: 'reset' });
      requestAnimationFrame(() => {
        dispatch({ type: 'select', heroId, rect: sourceRect, index: sourceIndex, now: performance.now() });
      });
    };
    window.addEventListener(HSC_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(HSC_REPLAY_EVENT, onReplay);
  }, []);
  // Rifts are OPT-IN (the mode picker): only a RIFT run adopts the active rift, so only a rift run may
  // telegraph one here. Reading the live registry unconditionally would have promised Ascent players a
  // modifier their run will not actually get.
  const rift = mode === 'rift' ? activeRift() : null;
  // TWO ROWS, MEASURED. The card's height is driven by its WIDTH (a quarter of the row, with a square
  // portrait above wrapping text), so no viewport-height guess tracks it — a `34vh` clamp showed 2.34 rows at
  // 1647px wide and only 1.64 at 1280x720. So measure one real card and size the scroll box from it.
  //
  // Measured ONCE per resize via ResizeObserver, rAF-collapsed — never per frame (the repo's measure-once
  // rule). The observer watches the ROW, which changes width with the stage, and the card height follows.
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // `.browse` is the class the grid only carries in Practice; keying off the DOM rather than a derived
    // flag keeps this hook ABOVE the `!choices` early return (see below) — a hook after a conditional
    // return changes the hook COUNT between renders, which is exactly the crash this had on first wiring
    // ("Rendered more hooks than during the previous render", owner report 2026-08-22).
    const row = rowRef.current;
    if (!row || !row.classList.contains('browse')) return;
    let raf = 0;
    const measure = (): void => {
      raf = 0;
      const card = row.querySelector<HTMLElement>('.herocard');
      if (card) row.style.setProperty('--hs-rowh', `${card.offsetHeight}px`);
    };
    const schedule = (): void => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(row);
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [choices]);

  if (!choices) return null;

  // PRACTICE (owner rework 2026-08-22): the whole roster, in the SAME big cards Play uses — 4 across, two
  // rows visible, scroll for the rest. It used to shrink every card to cram 40+ onto one screen, which made
  // Practice look like a different game from the one you were about to play.
  //
  // ALPHABETICAL by display name, not roster order: this is a browse-and-find list, and roster order is
  // authoring history (`localeCompare` so accented names sort where a reader expects, not by code point).
  // `choices` itself is left alone — sorting a copy keeps the store's order (and the ceremony's index
  // bookkeeping, which reads THIS array) consistent.
  const browse = choices.length > 6;
  const shown = browse ? [...choices].sort((a, b) => getHero(a).name.localeCompare(getHero(b).name)) : choices;

  const active = ceremonyActive(ceremony);
  // Ceremony click handler (both card variants): pulse + commit. sfx.heroSelect moved to the voice beat,
  // pickHero to the launch curtain (§2). Geometry is read HERE, once, at commit time (§8).
  const onPick = (id: string, index: number) => (e: MouseEvent<HTMLButtonElement>) => {
    if (!ceremonyAcceptsClicks(ceremony)) return; // repeats during the ceremony are ignored (§16)
    sfx.pulse();
    dispatch({
      type: 'select',
      heroId: id,
      rect: snapshotRect(e.currentTarget.getBoundingClientRect()),
      index,
      now: performance.now(),
    });
  };
  // The header/Back fade delay is timing-object data, not a stylesheet literal (§4).
  const rootStyle = active
    ? ({ '--hsc-header-delay': `${ceremonyTiming().headerExitDelayMs}ms` } as CSSProperties)
    : undefined;

  return (
    <div className={`heroselect${active ? ' hsc-active' : ''}`} style={rootStyle}>
      {/* Return to the main menu (owner ask 2026-09-01) — the same `.hsback` chrome the Title's mode-pick
          wears, top-left. Hidden once a pick's ceremony is running: the launch is committing, and yanking
          the screen out from under the machine mid-choreography is not a state it handles. */}
      {!active && (
        <button className="hsback" onPointerDown={() => { sfx.pulse(); openTitle(); }}>← Main Menu</button>
      )}
      {/* The real brand lockup, not a text heading (owner ask 2026-08-22) — the same mark + wordmark the home
          screen wears, so the two screens read as one product. Pinned to the TOP of the screen and shrunk
          (owner ask 2026-08-24): it lives OUTSIDE `.hsbox` so the picker below centres on its own —
          `.heroselect` is a two-row grid (this lockup, then the centred box). `.hslogo` owns its own sizing. */}
      <AscentLogo className="hslogo" headingClass="disp titleword hsword" />
      <div className="hsbox">
        {/* Run-start telegraph: your rating-derived Line — the wins this run is expected to cover. Shown for
            every SCORED mode, which is Ascent AND Rift (a rift run still takes damage, still records a
            result — every other mode check in the codebase is `!== 'practice'`, so this one matches). Only
            Practice is unscored. */}
        {/* A LOBBY has no Oath and no rating — it is won by outlasting seven other seats — so it telegraphs the
            table instead. Practice stays unscored and shows neither. */}
        {/* A LOBBY telegraphs nothing here any more (owner ask 2026-08-22 — the format pill is gone); the
            Rating/Oath line stays for the scored non-lobby modes. */}
        {mode !== 'lobby' && mode !== 'practice' && (
          <div className="hsline" aria-label="Your Oath for this run">
            <span className="hsline-rat">Rating {profile.rating}</span>
            <span className="hsline-line">Oath {profile.currentLine}</span>
          </div>
        )}
        {/* Active "rift" patch — a limited-time global run modifier (see CONFIG.rift). Telegraphed here so
            the player knows the rules are bent before they pick. */}
        {rift && <RiftPill rift={rift} variant="hero" />}
        {/* Prompt directly above the portraits (owner ask 2026-08-24). */}
        <div className="hsprompt">Select Your Hero</div>
        {/* Naming yourself now lives on the home screen (the account chip). Both modes use the SAME big card;
            Practice (every hero) adds `browse` — four across, two rows visible, scroll for the rest. */}
        <div ref={rowRef} className={`hsrow${browse ? ' browse' : ''}`}>
          {shown.map((id, i) => {
            const hero = getHero(id);
            const power = hero.power;
            const art = heroArt(hero.id);
            const tip = heroTip(hero.id);
            // THE hero card (owner rework 2026-07-16): big framed hero art with the name pill eclipsing the
            // frame's TOP edge and the HP+Armor pill its BOTTOM edge; hovering crossfades the HERO POWER art
            // in over the portrait with the power text fading in below. Practice uses this same card in a
            // scrolling grid (2026-08-22) — the compact variant it used to render is gone.
            {
              const powArt = heroPowerArt(hero.id);
              return (
                <button
                  key={id}
                  ref={(el) => { cardRefs.current[i] = el; }}
                  className="herocard big"
                  disabled={active}
                  onClick={onPick(id, i)}
                >
                  <div className="hcframe">
                    <div className="hcname">{hero.name}</div>
                    {art ? <img className="hcframe-art" src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}
                    {powArt && <img className="hcframe-pow" src={powArt} alt="" draggable={false} aria-hidden="true" />}
                    {/* PRACTICE-ONLY heroes (owner ask 2026-08-23): withheld from Play while they are reworked.
                        These can only ever appear in THIS picker, so the note needs no mode check of its own.
                        It rides the PORTRAIT rather than the text block below it — `.hcbelow` reserves a fixed
                        height, so an extra line there spills over the card in the next row (measured). */}
                    {hero.practiceOnly && <span className="hcpractice">Not currently enabled in Play</span>}
                    <div className="hchp">
                      <Icon name="heart" />
                      {hero.resolve}
                      {hero.armor > 0 && <span className="hcarmor">+{hero.armor}</span>}
                    </div>
                  </div>
                  {/* One box, two crossfading faces (owner ask 2026-08-20): at rest the card answers "how hard
                      is this hero, and what is the idea"; hovering answers "what does the button actually do".
                      Both faces are absolutely positioned inside `.hcbelow`, which reserves the height — so the
                      swap never reflows the row. A hero with no authored tip simply has no resting face. */}
                  <div className="hcbelow">
                    {/* PRACTICE shows no difficulty (owner ask 2026-08-22) — you are picking a hero to try,
                        not being graded. With no resting face the power text simply stays visible (see the
                        `.hsrow.browse` rule), which is the useful thing in a browse list anyway. */}
                    {tip && !browse && (
                      <div className="hcmeta" aria-hidden={false}>
                        <span className={`hcdiff d-${tip.difficulty.toLowerCase()}`}>{tip.difficulty}</span>
                        {SHOW_HERO_TIPS && <span className="hctip">{tip.tip}</span>}
                      </div>
                    )}
                    <div className="hcpw">
                      {/* Power cost callout (owner ask 2026-09-01): actives show their Gold cost, a free
                          active says Free; a PASSIVE is never cast, so a cost line would mislead — it says
                          Passive instead. */}
                      <b>{power.name}</b>{' '}
                      <span className="hccost">{power.passive ? '(Passive)' : `(Cost: ${power.cost ? power.cost : 'Free'})`}</span>
                      {' '}· <span dangerouslySetInnerHTML={{ __html: mdBold(power.text) }} />
                      {power.unlockWave && power.unlockWave > 1 && <span className="hclock">Unlocks turn {power.unlockWave}</span>}
                    </div>
                  </div>
                </button>
              );
            }
          })}
        </div>
      </div>
      {/* The ceremony overlay mounts on commit and lives until pickHero (fired by the launch curtain)
          clears heroChoices — this component then renders null and the ceremony's cleanup aborts every
          timer/animation it owns. */}
      {active && <HeroSelectCeremony state={ceremony} dispatch={dispatch} cardEls={cardRefs} />}
    </div>
  );
}
