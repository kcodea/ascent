/**
 * VERSUS PHASE 2 — the spectator's chrome (owner 2026-10-14: "spectators should be able to change the player they are
 * spectating within a spectator ui"; re-laid out 2026-10-16, R-SPECTATE-HUD-01: "maybe in the top left it shows me as
 * a spectator, and if there are multiple players to spectate, that can be in the bottom right instead").
 *
 * TOP LEFT: me, as a spectator (`SpectatorSelf`: my plate and emotes, the rest of the stands, Leave). BOTTOM RIGHT: the
 * switcher (`WatchedPanel`): both players as plates (Match details' seat portrait in their skin and frame, name pill,
 * Health box), the watched one lit; click a plate, or press 1 / 2, to watch that player's screen. Instant: both views
 * are cached (spectate.ts). In a fight the same plates pick whose side it is shown from.
 */
import { useEffect, useMemo, useRef } from 'react';
import { versusDuosStartingVitals, versusStartingVitals, type VersusGroupSeat, type VersusSeat } from '@game/sim';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { leaveSpectating, useSpectate, watchSeat } from './spectate';
import { clearVersusKnockout, useVersus } from './versusStore';
import { placementText } from '../rank/rankFormat';
import { SpectatorCursor } from './SpectatorCursor';
import { SpectatorSelf, WatchedPanel, type WatchSeat } from './SpectatorHud';
import '../live/live.css';
import { copyName, duosFirstAt, foeIn, groupPairingAt, isDuosRaw } from './versusGroupView';

const SEATS: readonly VersusSeat[] = ['p1', 'p2'];

export function SpectatorBar(): JSX.Element | null {
  const active = useSpectate((s) => s.active);
  const seat = useSpectate((s) => s.seat);
  const match = useVersus((s) => s.match);
  const room = useVersus((s) => s.room);
  // Health and Armor as the SCREEN shows them (the watched run's two-seat lobby: settled when the fight on screen
  // lands), so the bar never tells the result of a fight that is still playing. The match row is the fallback.
  const shown = useGame((s) => {
    const l = s.run.lobby;
    return l ? `${l.seats[0]?.resolve ?? ''}/${l.seats[0]?.armor ?? ''}|${l.seats[1]?.resolve ?? ''}/${l.seats[1]?.armor ?? ''}` : '';
  });
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) return;
      // VERSUS GROUP: 1-4 pick among the players still in, in the bar's order (R-VERSUS-GROUP-04).
      const pickable = groupOrderRef.current;
      if (pickable.length > 0 && /^[1-4]$/.test(e.key)) {
        const s = pickable[Number(e.key) - 1];
        if (s) { e.preventDefault(); sfx.tick(); watchSeat(s); }
        return;
      }
      if (e.key === '1' || e.key === '2') {
        e.preventDefault();
        sfx.tick();
        watchSeat(e.key === '1' ? 'p1' : 'p2');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
  // VERSUS GROUP (R-VERSUS-GROUP-04): THE FIGHT PICKER. Every player of the table, grouped by this round's fights (each
  // plate says who that player is fighting, a Copy included); the players still in can be picked, the ones out are
  // dimmed. Watching a player shows their screen and their fight. Default: a player still in.
  const group = match?.group ?? null;
  const groupSeats = useMemo((): WatchSeat[] => {
    if (!group) return [];
    const raw = group.raw;
    const pairing = groupPairingAt(raw, Math.max(1, raw.round));
    const order: VersusGroupSeat[] = [];
    // VERSUS DUOS: the plates go by TEAM (team 1, then team 2; the board fighting first leads its team), each saying
    // its team, never "vs" a single player (one fight is team against team; phase-3 live test, 2026-10-25).
    const duos = isDuosRaw(raw);
    if (duos) {
      const first = duosFirstAt(raw, Math.max(1, raw.round));
      for (const [lead, other] of [[first.a, first.a === 'p1' ? 'p2' : 'p1'], [first.b, first.b === 'p3' ? 'p4' : 'p3']] as const) order.push(lead, other);
    }
    for (const p of pairing) {
      for (const s of p.copy ? [p.a] : [p.a, p.b]) if (!order.includes(s)) order.push(s);
    }
    for (const s of raw.seats) if (!order.includes(s.seat)) order.push(s.seat);
    return order.map((key) => {
      const row = raw.seats.find((x) => x.seat === key)!;
      const foe = row.eliminatedRound == null ? foeIn(pairing, key) : null;
      const foeRow = foe ? raw.seats.find((x) => x.seat === foe.seat) : null;
      // The seat's stored pools (Duos: its team's), else its start (R-VERSUS-HEALTH-01, R-DUOS-HEALTH-01).
      const mateHero = raw.seats.find((x) => x.seat === ({ p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' } as const)[key])?.hero;
      const start = duos ? versusDuosStartingVitals(row.hero, mateHero, raw.options) : versusStartingVitals(row.hero, raw.options);
      return {
        key,
        name: row.name,
        heroId: row.hero,
        profile: room?.members.find((m) => m.userId === row.userId)?.profile,
        health: row.health ?? start.health,
        armor: row.armor ?? start.armor,
        on: seat === key,
        pick: () => watchSeat(key),
        vs: duos ? (row.eliminatedRound == null ? (key === 'p1' || key === 'p2' ? 'Team 1' : 'Team 2') : null) : foeRow ? `vs ${foe!.copy ? copyName(foeRow.name) : foeRow.name}` : null,
        out: row.eliminatedRound != null,
      };
    });
  }, [group, room, seat]);
  const groupOrderRef = useRef<VersusGroupSeat[]>([]);
  groupOrderRef.current = groupSeats.filter((s) => !s.out).map((s) => s.key as VersusGroupSeat);
  // Watching a player who is out (or a seat that does not exist): move to a player still in.
  useEffect(() => {
    if (!active || !group) return;
    const cur = group.raw.seats.find((x) => x.seat === seat);
    if (cur && cur.eliminatedRound == null) return;
    const next = groupOrderRef.current[0];
    if (next && next !== seat) watchSeat(next);
  }, [active, group, seat]);
  const seats = useMemo((): WatchSeat[] => {
    if (!match) return [];
    if (match.group) return [];
    const [mine, theirs] = shown.split('|');
    return SEATS.map((s) => {
      const user = s === 'p1' ? match.p1_user : match.p2_user;
      const [hs, as] = (shown ? (s === seat ? mine : theirs) ?? '' : '').split('/');
      const fromScreen = { health: hs ? Number(hs) : NaN, armor: as ? Number(as) : NaN };
      const hero = s === 'p1' ? match.p1_hero : match.p2_hero;
      const start = versusStartingVitals(hero, match.options);
      const stored = { health: (s === 'p1' ? match.p1_health : match.p2_health) ?? start.health, armor: (s === 'p1' ? match.p1_armor : match.p2_armor) ?? start.armor };
      return {
        key: s,
        name: s === 'p1' ? match.p1_name : match.p2_name,
        heroId: hero,
        profile: room?.members.find((m) => m.userId === user)?.profile,
        health: Number.isFinite(fromScreen.health) ? fromScreen.health : stored.health,
        armor: Number.isFinite(fromScreen.armor) ? fromScreen.armor : stored.armor,
        on: seat === s,
        pick: () => watchSeat(s),
      };
    });
  }, [match, room, seat, shown]);
  if (!active || !match) return null;
  return (
    <>
      <SpectatorCursor />
      <SpectatorSelf onLeave={leaveSpectating} />
      <WatchedPanel seats={group ? groupSeats : seats} />
      <KnockoutNotice matchId={match.id} />
    </>
  );
}

/**
 * KNOCKED OUT OF A GROUP MATCH (owner 2026-10-24, R-VERSUS-GROUP-06): the end screen's placement numeral on the game's
 * dark panel (LiveWatchBar's ending, reused), over the watch screen the player was just moved onto. It goes after a
 * few seconds, on its button, or when the match changes.
 */
function KnockoutNotice({ matchId }: { matchId: string }): JSX.Element | null {
  const ko = useVersus((s) => s.knockout);
  const showing = !!ko && ko.matchId === matchId;
  useEffect(() => {
    if (!showing) return undefined;
    const t = window.setTimeout(clearVersusKnockout, 6000);
    return () => window.clearTimeout(t);
  }, [showing]);
  if (!ko || !showing) return null;
  return (
    <div className="vsveil lvend" role="dialog" aria-label="You are out">
      <div className="vspanel">
        <div className="endplace"><span className="endplace-num">{ko.placement ? placementText(ko.placement) : 'Out'}</span></div>
        <div className="lvend-sub">You are out. Watch the rest of the match from the stands.</div>
        <div className="vspanel-actions">
          <button type="button" className="vsplate vsstartbtn" onClick={() => { sfx.pulse(); clearVersusKnockout(); }}>Watch</button>
        </div>
      </div>
    </div>
  );
}
