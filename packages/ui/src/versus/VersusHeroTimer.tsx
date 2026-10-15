/**
 * VERSUS — Hero Select's 20 s clock (owner 2026-10-14: "use the existing hero-select screen with a 20 s timer", "the
 * normal clock"). The shop's own clock face (`ShopTimer`), fed the match's server deadline through the same
 * `turnClock` the shop uses. Mounted only on a Versus Hero Select, where no shop clock runs.
 */
import { useEffect } from 'react';
import { ShopTimer } from '../Recruit';
import { turnClock } from '../turnClock';
import { displaySeconds } from './versusClock';
import { useVersus, versusRemainingMs } from './versusStore';

export function VersusHeroTimer() {
  const deadline = useVersus((s) => (s.match?.phase === 'hero_select' ? s.match.hero_deadline : null));
  useEffect(() => {
    if (!deadline) return undefined;
    const tick = (): void => turnClock.set(displaySeconds(versusRemainingMs(deadline)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  return <div className="vshstimer"><div className="statstrip"><ShopTimer /></div></div>;
}
