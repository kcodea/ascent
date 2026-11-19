import { memo, type CSSProperties, type ReactNode } from 'react';
import { ANCIENTS, getHero, type BoardSnapshot } from '@game/sim';
import { heroPowerArt, heroThumb } from './art';
import { mdBold } from './Card';
import { heroPowerFacts } from './HeroInspectCard';
import { ArmorMedal, HealthMedal } from './menuIcons';
import { AncientSplitStatic } from './ancients/AncientMeter';
import { FoeAncientLine } from './ancients/FoeAncientLine';
import { ancientVars } from './ancients/ancientsConfig';
import './railScoutShowcase.css';

/**
 * THE RAIL'S HOVER CARD, IN THE HERO SHOWCASE'S LANGUAGE (owner 2026-11-19, R-RAIL-SCOUT-SHOWCASE-01): the top of the
 * Docked rail's scout card reads like the Compendium / Hero Select inspect card (`HeroInspectCard`, `.phi`): the hero's
 * portrait on the left bleeding into the navy panel, the player's name large and bold, Health and Armor in dark round
 * pills, a thin gold divider, the hero power's round portrait sitting on the art / panel seam (cracked open with the
 * picked Ancient, exactly as the player's own power button settles: `AncientSplitStatic`), the power's name in gold
 * with its fact pills (Passive, cost, limits: `heroPowerFacts`, the showcase's own), its text, and the Ancient's name in
 * its colour with its pairing text (`FoeAncientLine`). Under a second gold divider: `children` (the shop tier / Gilded /
 * tribe chips, the rune sockets and the last fights, unchanged from the card before).
 *
 * Static on purpose: the power text is the base text (we never simulate another player's run), and nothing here
 * animates. Every image is one the boot plan already decoded (hero portraits, power art, Ancient faces; on a phone the
 * rail's own 256 px thumbnail, the same decode the slice shows), so the card mounts without a decode hitch.
 */
export const RailScoutShowcase = memo(function RailScoutShowcase({ name, heroId, portrait, hp, ancient, children }: {
  /** The seat's label (the player's name). */
  name: string;
  heroId: string;
  /** The seat's hero portrait, in the skin the rail shows. */
  portrait: string | undefined;
  /** Health + Armor as the rail draws them; nothing for a seat that is out. */
  hp?: { alive: boolean; resolve: number; armor: number };
  /** The seat's picked Ancient, off its captured board. */
  ancient: BoardSnapshot['ancient'] | undefined;
  children?: ReactNode;
}): JSX.Element {
  const hero = getHero(heroId);
  const power = hero?.power;
  const pw = heroPowerArt(heroId);
  const anc = ancient && ANCIENTS[ancient.id] ? ancient : undefined;
  const art = heroThumb(portrait);
  return (
    <>
      <div className={`rsc-top${art ? ' has-art' : ''}`}>
        {art && <div className="rsc-art" aria-hidden="true"><img decoding="sync" src={art} alt="" draggable={false} /></div>}
        <div className="rsc-info">
          <div className="rsc-head">
            <span className="lobbyscout-name rsc-name">{name}</span>
            <span className="rsc-sub">
              {hp?.alive && (
                <span className="rsc-vitals" aria-label={`Health ${hp.resolve}, Armor ${hp.armor}`}>
                  <span className="rsc-stat is-hp"><HealthMedal /><b>{hp.resolve}</b></span>
                  <span className="rsc-stat is-armor"><ArmorMedal /><b>{hp.armor}</b></span>
                </span>
              )}
              <span className="rsc-hero">{hero?.name}</span>
            </span>
          </div>
          {power && (
            <div className={`rsc-power${pw ? ' has-art' : ''}`}>
              {pw && (
                // The in-game power disc (`.heropowerbtn`), display-only, so the Ancient crack is the live button's own.
                <span className="heropowerbtn passive rsc-disc" aria-hidden="true">
                  <span className="hpb-artwrap"><img decoding="sync" className="hpb-art" src={pw} alt="" draggable={false} /></span>
                  {anc && <AncientSplitStatic id={anc.id} />}
                </span>
              )}
              <span className="rsc-pwhead">
                <b className="rsc-pwname">{power.name}</b>
                {heroPowerFacts(power).map((t) => <span key={t} className="rsc-fact">{t}</span>)}
              </span>
              <span className="rsc-pwtext" dangerouslySetInnerHTML={{ __html: mdBold(power.text) }} />
              {/* The seat's picked ANCIENT (R-ANCIENTS-RELEASE-03): name in its colour + pairing text under the power. */}
              {anc && <span className="rsc-anc" style={ancientVars(anc.id) as CSSProperties}><FoeAncientLine ancient={anc} /></span>}
            </div>
          )}
        </div>
      </div>
      <div className="rsc-rest">{children}</div>
    </>
  );
});
