/**
 * VERSUS — Hero Select's 20 s clock (owner 2026-10-14: "use the existing hero-select screen with a 20 s timer", "the
 * normal clock"). The shop's own clock face (`ShopTimer`), fed the match's server deadline through the same
 * `turnClock` the shop uses. Mounted only on a Versus Hero Select, where no shop clock runs.
 *
 * Its sounds are the shop clock's (R-VERSUS-TIMER-FX-01): the warm-up on 10..6 and the FIVE..ONE ticks, played off
 * the server deadline by `driveVersusClock`, frozen through a pause. There is no 0:00 explosion here (that is the
 * shop locking) and no charge glyph (Hero Select covers the board it is etched on).
 */
import { useEffect } from 'react';
import { ShopTimer } from '../Recruit';
import { turnClock } from '../turnClock';
import { driveVersusClock, nextObserveMs } from './versusClockFx';
import { useVersus, versusRemainingMs } from './versusStore';

export function VersusHeroTimer() {
  const deadline = useVersus((s) => (s.match?.phase === 'hero_select' ? s.match.hero_deadline : null));
  const pausedAt = useVersus((s) => (s.match?.phase === 'hero_select' ? s.match.paused_at ?? null : null));
  const matchId = useVersus((s) => s.match?.id ?? null);
  useEffect(() => {
    if (!deadline) return undefined;
    const end = Date.parse(deadline);
    const key = `${matchId ?? ''}|hero`;
    let id = 0;
    const tick = (): void => {
      const remaining = pausedAt ? end - Date.parse(pausedAt) : (versusRemainingMs(deadline) ?? 0);
      driveVersusClock({ key, remainingMs: remaining, moving: !pausedAt, explode: false, announceWave: null });
      if (!pausedAt && remaining > 0) id = window.setTimeout(tick, nextObserveMs(remaining));
    };
    tick();
    return () => { window.clearTimeout(id); turnClock.hold(performance.now()); };
  }, [deadline, pausedAt, matchId]);
  return <div className="vshstimer"><div className="statstrip"><ShopTimer /></div></div>;
}
