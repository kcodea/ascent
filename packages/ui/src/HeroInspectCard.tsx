import type { MouseEventHandler, Ref } from 'react';
import { HEROES, type AncientId } from '@game/sim';
import { mdBold } from './Card';
import { heroPowerArt, heroThumb } from './art';
import { Icon } from './Icon';
import { HeroAncients } from './HeroAncients';

export type InspectHero = (typeof HEROES)[number];

/** The short facts under a power's name: how it is used, what it costs, and any limit. Read from the power's own fields. */
export function heroPowerFacts(p: InspectHero['power']): string[] {
  const out: string[] = [p.passive ? 'Passive' : 'Active'];
  if (p.cost && p.cost > 0) out.push(`${p.cost} Gold`);
  if (p.oncePerGame) out.push('Once per game');
  else if (p.maxUses && p.maxUses > 0) out.push(`${p.maxUses} uses per game`);
  if (p.usesPerTurn && p.usesPerTurn > 1) out.push(`${p.usesPerTurn} uses per turn`);
  if (p.unlockWave && p.unlockWave > 1) out.push(`Unlocks turn ${p.unlockWave}`);
  return out;
}

export interface HeroInspectCardProps {
  hero: InspectHero;
  /** The splash art (the Compendium passes heroArt(id); the pick screen the equipped skin). */
  art: string | null | undefined;
  /** The Ancient on show, owned by the caller so it survives a hero change. */
  ancient: AncientId;
  onAncient: (a: AncientId) => void;
  /** Extra fact chips after the power's own (the pick screen's difficulty). */
  extraFacts?: readonly string[];
  /** Right side of the footer line, after "Up / Down: Ancients" (the Compendium's "2 / 42"). */
  counter?: string;
  /** The `.phi-art` box, for the ceremony's source rect. */
  artRef?: Ref<HTMLDivElement>;
  className?: string;
  onClick?: MouseEventHandler<HTMLElement>;
}

/** A hero's large inspect card: the whole portrait on the left; name, starting Health and Armor, the power and the Ancients row
 *  on the right. Shared by the Compendium's large view and the Hero Select screen so the two cannot drift. */
export function HeroInspectCard({ hero: h, art, ancient, onAncient, extraFacts, counter, artRef, className, onClick }: HeroInspectCardProps) {
  const pw = heroPowerArt(h.id);
  const facts = [...heroPowerFacts(h.power), ...(extraFacts ?? [])];
  return (
    <article className={className ? `phi ${className}` : 'phi'} onClick={onClick}>
      {art && <img className="phi-wash" decoding="sync" src={heroThumb(art)} alt="" aria-hidden="true" draggable={false} />}
      <div className="phi-art" ref={artRef}>
        {art && <img decoding="sync" src={art} alt="" draggable={false} />}
      </div>
      <div className="phi-info">
        <div className="phi-head">
          {h.duosOnly && <span className="phi-duos" aria-label="Duos only">Duos</span>}
          <h2 className="phi-name">{h.name}</h2>
          <div className="phi-vitals">
            <span className="phi-stat is-hp" aria-label={`${h.resolve} starting Health`}><Icon name="heart" /><b>{h.resolve}</b><i>Health</i></span>
            {h.armor > 0 && <span className="phi-stat is-armor" aria-label={`${h.armor} starting Armor`}><Icon name="shield" /><b>{h.armor}</b><i>Armor</i></span>}
          </div>
        </div>
        <div className={`phi-power${pw ? ' has-art' : ''}`}>
          {pw && <img className="phi-pwart" decoding="sync" src={pw} alt="" draggable={false} />}
          <div className="phi-pwhead">
            <div className="phi-pwwho">
              <span className="phi-pwname">{h.power.name}</span>
              <span className="phi-facts">{facts.map((t) => <span key={t} className="phi-fact">{t}</span>)}</span>
            </div>
          </div>
          <p className="phi-pwtext" dangerouslySetInnerHTML={{ __html: mdBold(h.power.text) }} />
        </div>
        <div className="phi-anc">
          <HeroAncients heroId={h.id} picked={ancient} onPick={onAncient} big />
        </div>
        <span className="phi-count" aria-hidden="true"><span className="phi-anckeys">Up / Down: Ancients</span>{counter !== undefined && <span>{counter}</span>}</span>
      </div>
    </article>
  );
}
