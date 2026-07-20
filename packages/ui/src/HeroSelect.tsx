import type { CSSProperties } from 'react';
import { mdBold } from './Card';
import { getHero, activeRift } from '@game/sim';
import { RiftPill } from './RiftPill';
import { heroArt, heroPowerArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';

/**
 * Pre-run hero picker. Shows whenever the store has `heroChoices` (first load + after a
 * game over). Picking one starts a fresh run as that hero. This is the first slice of the
 * eventual Title → Mode → Hero flow — a single store flag drives it, no router.
 */
export function HeroSelect() {
  const choices = useGame((s) => s.heroChoices);
  const pickHero = useGame((s) => s.pickHero);
  const openTitle = useGame((s) => s.openTitle);
  const mode = useGame((s) => s.pendingMode);
  const profile = useGame((s) => s.profile);
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

  return (
    <div className="heroselect">
      <button className="hsback" onClick={() => { sfx.pulse(); openTitle(); }}>← Back</button>
      <div className="hsbox">
        <div className="eyebrow">Choose your champion</div>
        <h1 className="disp hstitle">THE ASCENT</h1>
        {/* Run-start telegraph: your rating-derived Line — the wins this run is expected to cover. Shown for
            every SCORED mode, which is Ascent AND Rift (a rift run still takes damage, still records a
            result — every other mode check in the codebase is `!== 'practice'`, so this one matches). Only
            Practice is unscored. */}
        {mode !== 'practice' && (
          <div className="hsline" aria-label="Your Oath for this run">
            <span className="hsline-rat">Renown {profile.rating}</span>
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
          {choices.map((id) => {
            const hero = getHero(id);
            const power = hero.power;
            const art = heroArt(hero.id);
            // PLAY-MODE card (owner rework 2026-07-16): big framed hero art with the name pill eclipsing the
            // frame's TOP edge and the HP+Armor pill its BOTTOM edge; hovering the card crossfades the HERO
            // POWER art in over the portrait with the power text fading in below. Practice keeps the old
            // compact card (the dense grid).
            if (!dense) {
              const powArt = heroPowerArt(hero.id);
              return (
                <button key={id} className="herocard big" onClick={() => { sfx.pulse(); sfx.heroSelect(id); pickHero(id); }}>
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
                  <div className="hcpw">
                    <b>{power.name}</b> · <span dangerouslySetInnerHTML={{ __html: mdBold(power.text) }} />
                    {power.unlockWave && power.unlockWave > 1 && <span className="hclock">Unlocks turn {power.unlockWave}</span>}
                  </div>
                </button>
              );
            }
            return (
              <button key={id} className="herocard" onClick={() => { sfx.pulse(); sfx.heroSelect(id); pickHero(id); }}>
                <div className="hcart">
                  {art ? <img src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}
                </div>
                <div className="hcname">{hero.name}</div>
                <div className="hchp" title="Starting Resolve (HP)">
                  <Icon name="heart" />
                  {hero.resolve}
                  {hero.armor > 0 && <span className="hcarmor" title="Starting Armor — extra effective HP on top of Resolve">+{hero.armor}</span>}
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
    </div>
  );
}
