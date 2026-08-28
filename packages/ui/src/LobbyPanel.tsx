import { useEffect, useRef, useState } from 'react';
import {
  boardIntel, getHero, lastPlayerEncounter, lastRoundDamage, lossDamageCap, playerOpponent, seatResults,
  type LobbySeatState, type RunLobby, type SeatIntel,
} from '@game/sim';
import { QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { floatLobbyDamageOnSeat } from './lobbyDamageFx';
import { heroArt, questArt, runeArt } from './art';
import { mdBold } from './Card';
import { Icon } from './Icon';
import { useGame } from './store';

/**
 * The 8-seat table, shown in a LOBBY run.
 *
 * A lobby has no course clock and no Oath — what matters is who is still standing, how much health each of them
 * has, and who you're about to fight.
 *
 * EVERY SEAT IS THE SAME SIZE (owner ask 2026-07-31). The next opponent used to get a large card above the
 * table; it made the rail two different things stacked, and the one seat you most want to compare against the
 * others was the one you couldn't. The next foe is now marked in place — a NEXT chip and an accent ring — so
 * the table reads as one scannable column.
 *
 * SCOUTING lives on hover instead. Each enemy seat opens a card with what they are playing (dominant tribe,
 * tier, triples) and their last three fights. That is the read the big card was standing in for, and it works
 * for all seven opponents rather than just the imminent one.
 */
export function LobbyPanel({ lobby }: { lobby: RunLobby }): JSX.Element | null {
  // Hooks must run unconditionally — the early return for a missing lobby lives after them.
  const firedRound = useRef(0);
  // The hovered seat AND where it sits on screen. The anchor is measured because the card is `position: fixed`
  // — see `ScoutCard`. One measurement per hover, not per frame, so this does not violate the layout-read rule.
  const [hovered, setHovered] = useState<{ id: string; top: number; right: number } | null>(null);
  // RIGHT-CLICK INSPECT (owner ask 2026-08-03). The hover card vanishes the moment the pointer leaves the
  // seat, so its rune/quest badges are unreachable — you cannot travel to them without crossing the gap and
  // dismissing the thing you were aiming at. A PINNED copy solves exactly that: right-click to pin, and the
  // card stays until you dismiss it, so the badges can be hovered for their own tooltips. Mirrors the
  // right-click card inspect players already know (`Inspect.tsx`).
  const [pinned, setPinned] = useState<{ id: string; top: number; right: number } | null>(null);
  const openScout = (e: React.MouseEvent<HTMLDivElement>, id: string): void => {
    const b = e.currentTarget.getBoundingClientRect();
    setHovered({ id, top: b.top + b.height / 2, right: b.left });
  };
  const pinScout = (e: React.MouseEvent<HTMLDivElement>, id: string): void => {
    e.preventDefault(); // no browser context menu over the rail
    const b = e.currentTarget.getBoundingClientRect();
    setPinned((p) => (p?.id === id ? null : { id, top: b.top + b.height / 2, right: b.left })); // toggle
  };
  // Escape closes it, like every other dismissible overlay in the app.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') setPinned(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned]);

  // WHAT YOU JUST DID TO THEM. The rail prints every seat's loss as a static number, but a win is the moment
  // the mode is about and shouldn't read the same as a draw until you scan the table — so the damage you dealt
  // floats over the seat that took it, once, on the round it happened.
  //
  // Keyed on the round rather than on a render: the panel re-renders constantly during a shop phase, and the
  // rows re-sort by health the instant a round settles, so anything tied to the element's lifetime would fire
  // repeatedly or not at all. `rAF` waits for the re-sorted rows to be laid out before measuring one.
  useEffect(() => {
    if (!lobby || lobby.round === firedRound.current) return;
    firedRound.current = lobby.round;
    const last = lastPlayerEncounter(lobby);
    if (!last || last.dealt <= 0) return; // a draw or a loss has nothing to announce
    const raf = requestAnimationFrame(() => floatLobbyDamageOnSeat(last.foe.id, last.dealt));
    return () => cancelAnimationFrame(raf);
  }, [lobby?.round, lobby]);

  if (!lobby) return null;
  const next = playerOpponent(lobby);
  const foe = next?.seat ?? null;
  // The foe's board is already prepared by `playerOpponent`, so reading it here is free — and it means the
  // imminent opponent has CURRENT intel even on round 1, before any settle has recorded any.
  const foeIntel: SeatIntel | undefined = next ? boardIntel(next.board, lobby.round) : undefined;
  const dmg = lastRoundDamage(lobby);
  const living = lobby.seats.filter((s) => s.alive);
  const maxHp = lobby.rules.startingResolve + lobby.rules.startingArmor;
  // YOUR OWN row reads the RUN's health, not the seat's. The seat is only re-synced when the table settles (at
  // `resolveCombat`), while the run takes your hit the moment combat ends — so between those two the seat is
  // stale and the rail would disagree with the HUD for the whole post-combat screen (owner report 2026-08-25).
  // The run IS the player's authority and the seat is synced from it every settle, so this is the same number
  // everywhere, just never stale. Opponent seats keep reading their own seat, which is their only source.
  const myResolve = useGame((st) => st.run.resolve);
  const myArmor = useGame((st) => st.run.armor);
  const hpOf = (seat: { id: string; resolve: number; armor: number }): { resolve: number; armor: number } =>
    seat.id === 's0' ? { resolve: myResolve, armor: myArmor } : { resolve: seat.resolve, armor: seat.armor };
  // Living seats first, strongest to weakest; the fallen keep their placement order underneath.
  const rows = [...lobby.seats].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    // Rank on the LIVE numbers too (see `hpOf`), so your row doesn't sit at a stale rank through the
    // post-combat screen and then jump when the table settles.
    if (a.alive) { const A = hpOf(a), B = hpOf(b); return (B.resolve + B.armor) - (A.resolve + A.armor); }
    return (a.placement ?? 99) - (b.placement ?? 99);
  });

  return (
    <div className="lobbyrail">
      <div className="lobbyhead">
        <span className="lobbyround">Round {lobby.round}</span>
        <span className="lobbyalive">{living.length} left</span>
        {/* Max loss — the most Health a loss this round can cost (moved here from the removed top-left plaque,
            owner ask 2026-08-11). */}
        <span className="lobbymax" title="Most Health you can lose if you lose this combat">
          <Icon name="heart" />{Number.isFinite(lossDamageCap(lobby.round)) ? `−${lossDamageCap(lobby.round)}` : 'No cap'}
        </span>
      </div>

      <div className="lobbyseats">
        {rows.map((seat) => {
          const isYou = seat.id === 's0';
          const isFoe = foe?.id === seat.id;
          const live = hpOf(seat);
          const hp = live.resolve + live.armor;
          const d = dmg[seat.id];
          const intel = isFoe ? foeIntel : seat.intel;
          return (
            <div
              key={seat.id}
              data-seat={seat.id}
              className={`lobbyseat${isYou ? ' you' : ''}${isFoe ? ' foe' : ''}${seat.alive ? '' : ' dead'}`}
              // Scouting is for OPPONENTS — your own board is on screen in front of you.
              onMouseEnter={isYou ? undefined : (e) => openScout(e, seat.id)}
              onMouseLeave={isYou ? undefined : () => setHovered((h) => (h?.id === seat.id ? null : h))}
              onContextMenu={isYou ? undefined : (e) => pinScout(e, seat.id)}
            >
              <img className="lobbyface" src={heroArt(seat.heroId)} alt="" />
              {/* The opponent name owns its own full-width row (styles.css `.lobbynameline`). The next foe is
                  marked by the seat's own bright pulsing glow (the `foe` class → `.lobbyseat.foe`), not a pill. */}
              <span className="lobbynameline">
                <span className="lobbyname">{seat.label}</span>
              </span>
              {/* What last round cost this seat. The cell always renders — an omitted one would reflow the row
                  and leave the health column jittering between seats — but it stays blank at 0, because a
                  column of zeroes is noise and "no number" already reads as unscathed. */}
              <span className="lobbydmg" key={`d${lobby.round}`}>
                {seat.alive && d && d.taken > 0 ? `−${d.taken}` : ''}
              </span>
              {seat.alive ? (
                <span className="lobbyhp">
                  <Icon name="heart" />{live.resolve}
                  {live.armor > 0 && <span className="lobbyarmor"><Icon name="shield" />{live.armor}</span>}
                </span>
              ) : (
                <span className="lobbyplace">{seat.placement ? `#${seat.placement}` : 'out'}</span>
              )}
              {seat.alive && (
                <span className="lobbybar">
                  <span style={{ width: `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%` }} />
                </span>
              )}
              {hovered?.id === seat.id && pinned?.id !== seat.id && <ScoutCard lobby={lobby} seat={seat} intel={intel} at={hovered} />}
              {pinned?.id === seat.id && (
                <ScoutCard lobby={lobby} seat={seat} intel={intel} at={pinned} pinned onClose={() => setPinned(null)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TRIBE_LABEL: Record<string, string> = {
  beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs',
  demon: 'Demons', kobold: 'Kobolds', dwarf: 'Dwarves', neutral: 'Neutral',
};

/**
 * The hover read on one opponent: what they are playing, and how their last three fights went.
 *
 * Rendered ONLY while hovered rather than always-mounted-and-hidden — eight of these permanently in the tree,
 * each mapping the encounter log, is work the shop phase does not need to do every frame.
 */
function ScoutCard({ lobby, seat, intel, at, pinned, onClose }: {
  lobby: RunLobby; seat: LobbySeatState; intel?: SeatIntel; at: { top: number; right: number };
  /** Pinned (right-clicked) rather than hovered: it takes pointer events so its rune/quest badges can be
   *  hovered for their own tooltips, and it carries a close affordance. */
  pinned?: boolean; onClose?: () => void;
}): JSX.Element {
  const results = seatResults(lobby, seat.id, 3);
  const stale = intel && intel.round < lobby.round;
  return (
    // POSITION: FIXED, anchored to the measured seat. The rail is a scroll container
    // (`overflow-y: auto`), which CLIPS absolutely-positioned descendants outside its box — and this card
    // deliberately opens to the LEFT of the rail, i.e. outside it. Absolute positioning left it laid out
    // correctly and completely invisible, which is exactly what an "it opens" DOM check reports as working.
    // Fixed escapes overflow clipping; the rail has no transform/filter, so nothing re-anchors it.
    <div className={`lobbyscout${pinned ? ' pinned' : ''}`} role={pinned ? 'dialog' : 'tooltip'}
      aria-label={pinned ? `${seat.label} — scouting report` : undefined}
      style={{ top: at.top, right: `calc(100vw - ${at.right}px + 6px)` }}
      onContextMenu={pinned ? (e) => { e.preventDefault(); onClose?.(); } : undefined}>
      <div className="lobbyscout-head">
        <span className="lobbyscout-name">{seat.label}</span>
        <span className="lobbyscout-hero">{getHero(seat.heroId).power.name}</span>
        {pinned && (
          <button className="lobbyscout-x" onClick={onClose} aria-label="Close">×</button>
        )}
      </div>

      {intel ? (
        <div className="lobbyscout-stats">
          <span className="lobbyscout-stat"><b>{intel.topTribe ? TRIBE_LABEL[intel.topTribe] : 'Mixed'}</b><i>build</i></span>
          <span className="lobbyscout-stat"><b>T{intel.tier}</b><i>tier</i></span>
          <span className="lobbyscout-stat"><b>{intel.triples}</b><i>triples</i></span>
        </div>
      ) : (
        // Honest about not knowing, rather than printing zeroes that look like a read.
        <div className="lobbyscout-empty">No intel yet</div>
      )}
      {/* ACTIVE QUESTS + RUNES (owner ask 2026-08-03) — what the seat is actually RUNNING, which is the part of
          scouting that changes how you build against them. Same badge language as the opponent frame and your
          own row, so one visual vocabulary covers every place a reward is shown; each carries its own hover. */}
      {intel && ((intel.runes?.length ?? 0) > 0 || (intel.quests?.length ?? 0) > 0) && (
        <div className="oppbadges lobbyscout-badges">
          {(intel.runes ?? []).filter((id) => RUNE_INDEX[id]).map((id) => {
            const rune = RUNE_INDEX[id]!;
            const rart = runeArt(rune.id);
            return (
              <div className="questbadge runebadge" key={`r:${id}`}>
                {rart
                  ? <img className="questbadge-art" src={rart} alt="" aria-hidden />
                  : <span className="questbadge-emblem" aria-hidden><Icon name="sc" /></span>}
                <div className="questbadge-tip" role="tooltip">
                  <b>{rune.name}</b>
                  <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
                  <span className="questbadge-tip-state">Rune · active</span>
                </div>
              </div>
            );
          })}
          {(intel.quests ?? []).filter((id) => QUEST_INDEX[id]).map((id) => {
            const def = QUEST_INDEX[id]!;
            const qart = questArt(def.id);
            const c = def.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${def.tribe})`;
            return (
              <div className="questbadge" style={{ '--c': c } as React.CSSProperties} key={`q:${id}`}>
                {qart
                  ? <img className="questbadge-art" src={qart} alt="" aria-hidden />
                  : <span className="questbadge-emblem" aria-hidden><Icon name="star" /></span>}
                <div className="questbadge-tip" role="tooltip">
                  <b>{def.name}</b>
                  <span className="questbadge-tip-state">Quest · complete</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* A stale read is labelled instead of being passed off as current — the seat has not fought since. */}
      {stale && <div className="lobbyscout-stale">as of round {intel!.round}</div>}

      <div className="lobbyscout-log">
        {results.length === 0 ? (
          <div className="lobbyscout-empty">No fights yet</div>
        ) : results.map((r) => (
          <div className={`lobbyscout-row ${r.outcome}`} key={r.round}>
            <span className="lobbyscout-vs">vs {r.foeLabel}</span>
            <span className="lobbyscout-dmg">{r.taken > 0 ? `−${r.taken}` : r.dealt > 0 ? `+${r.dealt}` : '0'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
