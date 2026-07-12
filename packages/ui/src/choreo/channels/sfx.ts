import type { CombatEvent } from '@game/core';
import { sfx } from '../../sfx';
import type { Moment } from '../compile';

/**
 * SFX channel (choreographer phase 3a) — fires the combat sound(s) for one moment: one sound per notable
 * event type it contains (deduped via `once`), a verbatim relocation of the former inline per-beat dispatch
 * in `useCombatReplay`. Returns `shake: true` when a real (non-Rise) death occurred so the caller triggers
 * the board shake. The melee "smack" is NOT fired here — it comes from the lunge's GSAP timeline at contact
 * (see playAttackLunge); a Rise death plays the soft spirit-release, no shake (the body returns).
 */
export function playMomentSfx(moment: Moment, events: CombatEvent[], cardIds?: Map<string, string>): { shake: boolean } {
  const done = new Set<string>();
  const once = (k: string, fn: () => void): void => { if (!done.has(k)) { done.add(k); fn(); } };
  let kill = false;
  let riseDeath = false;
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'attack') once('attack', sfx.attack);
    else if (e.type === 'sc' && e.cast) once('cast', sfx.cast);
    else if (e.type === 'death') {
      if (e.rise) riseDeath = true;
      else {
        once('death', sfx.death); kill = true;
        // The dying unit's OWN death voiceline (cards/<id>.death.mp3), layered over the general death bed.
        // Deduped per cardId so two of the same minion dying on one beat don't double the clip.
        const cid = cardIds?.get(e.target);
        if (cid) once(`cardDeath:${cid}`, () => sfx.cardDeath(cid));
      }
    }
    else if (e.type === 'reborn') once('reborn', sfx.rebornSummon);
    else if (e.type === 'shieldUp') once('shield', sfx.shield);
    else if (e.type === 'buff') once('buff', sfx.buff);
    else if (e.type === 'maxGold') once('maxgold', sfx.maxGold);
    else if (e.type === 'summon') once('summon', () => sfx.summon(e.minion.cardId));
  }
  if (riseDeath) once('rise', sfx.rebornShatter);
  return { shake: kill };
}
