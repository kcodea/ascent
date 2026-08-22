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
  if (!choices) return null;

  // The "dense" grid (Practice — every hero) balances the roster into as few rows as read well, then sizes each
  // card as a fraction of the container so EXACTLY `cols` fit per row (the short last row auto-centers). This
  // beats flex-wrap's greedy packing, which stranded a sparse trailing row (e.g. 19 + 4) and wasted the space.
  const dense = choices.length > 6;
  const rows = choices.length > 24 ? 3 : 2;
  const cols = Math.ceil(choices.length / rows);
  const rowStyle = dense ? ({ '--hs-cols': cols } as CSSProperties) : undefined;

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
      <div className="hsbox">
        {/* The real brand lockup, not a text heading (owner ask 2026-08-22) — the same mark + wordmark the home
            screen wears, so the two screens read as one product. `.hslogo` owns its own sizing and takes none
            of the title's tuner-driven offset/float. */}
        <AscentLogo className="hslogo" headingClass="disp titleword hsword" />
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
        {/* Naming yourself now lives on the home screen (the account chip). Practice shows EVERY hero (20+), which
            overflows at the full card size — the `dense` grid shrinks the cards so they all fit without scrolling.
            Ascent only offers 3, so it keeps the big cards. */}
        <div className={`hsrow${dense ? ' dense' : ''}`} style={rowStyle}>
          {choices.map((id, i) => {
            const hero = getHero(id);
            const power = hero.power;
            const art = heroArt(hero.id);
            const tip = heroTip(hero.id);
            // PLAY-MODE card (owner rework 2026-07-16): big framed hero art with the name pill eclipsing the
            // frame's TOP edge and the HP+Armor pill its BOTTOM edge; hovering the card crossfades the HERO
            // POWER art in over the portrait with the power text fading in below. Practice keeps the old
            // compact card (the dense grid).
            if (!dense) {
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
                    {tip && (
                      <div className="hcmeta" aria-hidden={false}>
                        <span className={`hcdiff d-${tip.difficulty.toLowerCase()}`}>{tip.difficulty}</span>
                        {SHOW_HERO_TIPS && <span className="hctip">{tip.tip}</span>}
                      </div>
                    )}
                    <div className="hcpw">
                      <b>{power.name}</b> · <span dangerouslySetInnerHTML={{ __html: mdBold(power.text) }} />
                      {power.unlockWave && power.unlockWave > 1 && <span className="hclock">Unlocks turn {power.unlockWave}</span>}
                    </div>
                  </div>
                </button>
              );
            }
            return (
              <button
                key={id}
                ref={(el) => { cardRefs.current[i] = el; }}
                className="herocard"
                disabled={active}
                onClick={onPick(id, i)}
              >
                <div className="hcart">
                  {art ? <img src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}
                </div>
                <div className="hcname">{hero.name}</div>
                <div className="hchp" title="Starting Health">
                  <Icon name="heart" />
                  {hero.resolve}
                  {hero.armor > 0 && <span className="hcarmor" title="Starting Armor — extra effective HP on top of Health">+{hero.armor}</span>}
                </div>
                <div className="hcpw">
                  <b>{power.name}</b> · <span dangerouslySetInnerHTML={{ __html: mdBold(power.text) }} />
                </div>
                {power.unlockWave && power.unlockWave > 1 && (
                  <div className="hclock">Unlocks turn {power.unlockWave}</div>
                )}
                <div className="hcpick">Choose</div>
              </button>
            );
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
