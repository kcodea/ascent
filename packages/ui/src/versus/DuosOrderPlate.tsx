/**
 * VERSUS DUOS — WHO FIGHTS FIRST (owner ruling 2026-10-25: alternates by round; either teammate may flip it during the
 * shop until the team's first End Turn; R-DUOS-01). One plate (the room's `vsplate` button) under the rail: it says
 * whose board goes first this round and flips it on a click. Greyed once my team has locked, outside the shop, and for
 * a spectator. The server holds the order (`versus_duos_flip_order`); the plate shows the server's row.
 */
import { memo, useState } from 'react';
import { sfx } from '../sfx';
import { versusRemote } from './versusRemote';
import { useVersus } from './versusStore';

export const DuosOrderPlate = memo(function DuosOrderPlate(): JSX.Element | null {
  const view = useVersus((s) => {
    const g = s.match?.group;
    const d = g?.duos;
    if (!g || !d || !g.me) return null;
    const raw = g.raw;
    const first = d.first[d.team];
    const mateRow = raw.seats.find((x) => x.seat === d.mate);
    const meRow = raw.seats.find((x) => x.seat === g.me);
    const locked = !!(meRow?.locked || mateRow?.locked);
    return `${raw.id}|${first === g.me ? 'me' : mateRow?.name ?? ''}|${locked || raw.phase !== 'shop' ? 1 : 0}`;
  });
  const [busy, setBusy] = useState(false);
  if (!view) return null;
  const [matchId, who, lockedFlag] = view.split('|') as [string, string, string];
  const locked = lockedFlag === '1';
  const label = who === 'me' ? 'You fight first' : `${who} fights first`;
  return (
    <button type="button" className="vsplate duosorder" disabled={locked || busy}
      aria-label={`${label}. ${locked ? 'Your team has locked in.' : 'Click to swap.'}`}
      onClick={() => {
        sfx.tick();
        setBusy(true);
        void versusRemote.duosFlipOrder(matchId).catch(() => undefined).finally(() => setBusy(false));
      }}>
      {label}
    </button>
  );
});
