import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  // CLICK-OUTSIDE CLOSES (owner ask 2026-08-31, replacing the corner ×). A click inside the card keeps it; a
  // click on a seat is left to the seat's own handler (it switches/toggles the pin); anything else dismisses it.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('.lobbyscout') || t.closest('.lobbyseat'))) return;
      setPinned(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
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
              // Left OR right click pins the card (and clicking a different seat switches to it) — owner ask 2026-08-31.
              onClick={isYou ? undefined : (e) => pinScout(e, seat.id)}
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
                <ScoutCard lobby={lobby} seat={seat} intel={intel} at={pinned} pinned />
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

// DEV-only scout-card layout A/B/C compare (owner is choosing a formatting direction). The chosen variant
// persists in localStorage so every hover card renders the same one; the on-card chip (dev builds only) cycles
// it. Stripped from production — `import.meta.env.DEV` gates both the read default and the chip.
const SCOUT_VARIANT_KEY = 'ascent.scoutVariant';
const SCOUT_VARIANTS = 3;
function readScoutVariant(): number {
  if (!import.meta.env.DEV) return 1;
  try { const v = Number(localStorage.getItem(SCOUT_VARIANT_KEY)); return v >= 1 && v <= SCOUT_VARIANTS ? v : 1; }
  catch { return 1; }
}
const OUTCOME_LABEL: Record<string, string> = { win: 'WON', lose: 'LOST', draw: 'DREW' };

/**
 * The hover read on one opponent: what they are playing, and how their last three fights went.
 *
 * Rendered ONLY while hovered rather than always-mounted-and-hidden — eight of these permanently in the tree,
 * each mapping the encounter log, is work the shop phase does not need to do every frame.
 */
function ScoutCard({ lobby, seat, intel, at, pinned }: {
  lobby: RunLobby; seat: LobbySeatState; intel?: SeatIntel; at: { top: number; right: number };
  /** Pinned (clicked) rather than hovered: it takes pointer events so its rune/quest badges can be hovered for
   *  their own tooltips. Dismissed by clicking outside (handled in LobbyPanel), not a corner ×. */
  pinned?: boolean;
}): JSX.Element {
  const results = seatResults(lobby, seat.id, 3);
  // KEEP IT ON-SCREEN. The card is position:fixed and opens to the LEFT of the seat; on a large / fullscreen
  // viewport a seat can push it partly off-screen (owner report 2026-08-28). We measure it once and clamp its
  // `right`/`top` into the viewport with an 8px margin, keeping the CSS `translateY(-50%)` centring (so `top` is
  // the card's CENTRE and the entrance animation is untouched). Rendered hidden until measured to avoid a flash
  // at the pre-clamp position; `useLayoutEffect` measures before paint, so there is no visible jump.
  const cardRef = useRef<HTMLDivElement>(null);
  const [clamp, setClamp] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, m = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    // Horizontal: prefer opening left (right edge 6px left of the seat), then clamp so neither edge leaves the view.
    const right = Math.max(m, Math.min(vw - at.right + 6, vw - w - m));
    // Vertical: `top` is the centre (translateY(-50%)) — keep the whole card between the top/bottom margins.
    const top = Math.max(m + h / 2, Math.min(at.top, vh - m - h / 2));
    setClamp({ top, right });
  }, [at.top, at.right, seat.id, pinned]);

  const [variant, setVariant] = useState(readScoutVariant);
  const cycleVariant = (): void => {
    const next = (variant % SCOUT_VARIANTS) + 1;
    setVariant(next);
    try { localStorage.setItem(SCOUT_VARIANT_KEY, String(next)); } catch { /* ignore */ }
  };

  // Shared reads + building blocks; each layout below arranges the SAME data differently.
  const heroName = getHero(seat.heroId).name;
  const tribe = intel?.topTribe;
  const tribeLabel = tribe ? TRIBE_LABEL[tribe] : 'Mixed';
  const tribeCount = intel?.topTribeCount;
  const tribeText = tribeCount ? `${tribeLabel} ×${tribeCount}` : tribeLabel;
  const tribeColor = tribe ? `var(--t-${tribe})` : 'var(--t-neutral)';
  const head = (
    <div className="lobbyscout-head">
      <span className="lobbyscout-name">{seat.label}</span>
      <span className="lobbyscout-hero"><b>Hero:</b> {heroName}</span>
    </div>
  );
  // COMPLETED QUESTS as badges. Runes moved to the socket strip below (owner ask 2026-08-31).
  const badges = intel && (intel.quests?.length ?? 0) > 0 ? (
    <div className="oppbadges lobbyscout-badges">
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
  ) : null;
  const noIntel = <div className="lobbyscout-empty">No intel yet</div>;
  // ROUND HISTORY — the foe's PORTRAIT rather than their name (owner ask 2026-08-31), with the outcome-tinted
  // damage on the right. Falls back to the label if the hero art is missing.
  const renderLog = (): JSX.Element => (
    <div className="lobbyscout-log">
      {results.length === 0 ? (
        <div className="lobbyscout-empty">No fights yet</div>
      ) : (
        <>
          {/* A ROUND column on the left, titled (owner ask 2026-08-31). */}
          <div className="lobbyscout-loghead">
            <span className="lobbyscout-round lobbyscout-colhead">Round</span>
          </div>
          {results.map((r) => (
            <div className={`lobbyscout-row ${r.outcome}`} key={r.round}>
              <span className="lobbyscout-round">{r.round}</span>
              <span className="lobbyscout-vs">
                {r.foeHeroId
                  ? <img className="lobbyscout-foeface" src={heroArt(r.foeHeroId)} alt={r.foeLabel} title={r.foeLabel} />
                  : <span className="lobbyscout-vslabel">vs {r.foeLabel}</span>}
              </span>
              {/* The outcome sits BETWEEN the portrait and the damage (owner ask 2026-08-31). */}
              <span className="lobbyscout-result">{OUTCOME_LABEL[r.outcome] ?? ''}</span>
              <span className="lobbyscout-dmg"><img className="lobbyscout-blast" src="/blast-dmg-icon.webp" alt="" aria-hidden />{r.taken > 0 ? `−${r.taken}` : r.dealt > 0 ? `+${r.dealt}` : '0'}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
  // RUNE SOCKETS — always three (owner ask 2026-08-31): dotted-outline circles marking where runes socket over
  // the match, filled with rune art as the seat acquires them. Filled sockets carry the same hover tip as a badge.
  const runeIds = (intel?.runes ?? []).filter((id) => RUNE_INDEX[id]);
  const runeSockets = intel ? (
    <div className="lobbyscout-runesec">
      <div className="lobbyscout-sectitle">Runes</div>
      <div className="lobbyscout-runes">
      {[0, 1, 2].map((i) => {
        const rune = runeIds[i] ? RUNE_INDEX[runeIds[i]!] : null;
        const rart = rune ? runeArt(rune.id) : null;
        return (
          <div className={`lobbyscout-socket${rune ? ' filled' : ''}`} key={i}>
            {rune && (rart
              ? <img className="lobbyscout-socketart" src={rart} alt="" aria-hidden />
              : <span className="questbadge-emblem" aria-hidden><Icon name="sc" /></span>)}
            {rune && (
              <div className="questbadge-tip" role="tooltip">
                <b>{rune.name}</b>
                <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
                <span className="questbadge-tip-state">Rune · active</span>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  ) : null;

  // ── The three candidate layouts (owner picked V1; the others stay for reference). Same data, different form. ──
  let body: JSX.Element;
  if (variant === 2) {
    // V2 — identity banner (dominant tribe front + centre) + a thin meta line, history given its own titled block.
    body = (
      <>
        {head}
        {intel ? (
          <>
            <div className="lobbyscout-identity" style={{ '--c': tribeColor } as React.CSSProperties}>
              <span className="lobbyscout-tribe">{tribeLabel}</span>
              {tribeCount ? <span className="lobbyscout-tribect">{tribeCount}</span> : null}
            </div>
            <div className="lobbyscout-meta">
              <span>Tier <b>{intel.tier}</b></span>
              <span className="lobbyscout-metadot">·</span>
              <span><b>{intel.triples}</b> triples</span>
            </div>
          </>
        ) : noIntel}
        {badges}
        <div className="lobbyscout-logtitle">Last fights</div>
        {renderLog()}
        {runeSockets}
      </>
    );
  } else if (variant === 3) {
    // V3 — compact: name + tribe tag on one line, a tight meta line, everything denser (see CSS).
    body = (
      <>
        <div className="lobbyscout-head lobbyscout-head--row">
          <span className="lobbyscout-name">{seat.label}</span>
          {intel ? <span className="lobbyscout-tag" style={{ '--c': tribeColor } as React.CSSProperties}>{tribeText}</span> : null}
        </div>
        <span className="lobbyscout-hero"><b>Hero:</b> {heroName}</span>
        {intel ? (
          <div className="lobbyscout-meta lobbyscout-meta--tight">
            <span>Tier <b>{intel.tier}</b></span>
            <span className="lobbyscout-metadot">·</span>
            <span><b>{intel.triples}</b> triples</span>
          </div>
        ) : noIntel}
        {badges}
        {renderLog()}
        {runeSockets}
      </>
    );
  } else {
    // V1 — refined current: a three-up stat strip (dominant tribe + count first), portrait history, rune sockets.
    body = (
      <>
        {head}
        {intel ? (
          <div className="lobbyscout-stats">
            {/* Shop tier + gilded units paired, then the tribe build on its own row beneath (owner ask
                2026-08-31); every stat's title sits ABOVE its value. */}
            <div className="lobbyscout-statrow">
              <span className="lobbyscout-stat"><i>shop tier</i><b>{intel.tier}</b></span>
              <span className="lobbyscout-stat"><i>gilded units</i><b>{intel.triples}</b></span>
            </div>
            <span className="lobbyscout-stat lobbyscout-stat--wide"><i>build</i><b>{tribeText}</b></span>
          </div>
        ) : noIntel}
        {badges}
        {renderLog()}
        {runeSockets}
      </>
    );
  }

  // PORTALED to <body>, then position:fixed + viewport-clamped. Rendered inside the rail, the card could be
  // swallowed by the rail's backplate/overflow on some viewports (owner report 2026-08-28) — as a direct child
  // of <body> no rail ancestor can clip or re-anchor it. The clamp (above) keeps it on-screen; z-index keeps it
  // in front.
  return createPortal(
    <div ref={cardRef} className={`lobbyscout lobbyscout--v${variant}${pinned ? ' pinned' : ''}`} role={pinned ? 'dialog' : 'tooltip'}
      aria-label={pinned ? `${seat.label} — scouting report` : undefined}
      style={clamp
        ? { top: clamp.top, right: clamp.right }
        : { top: at.top, right: `calc(100vw - ${at.right}px + 6px)`, visibility: 'hidden' }}
      // React portals bubble synthetic events through the REACT tree, so a click inside this card would reach the
      // seat's onClick and toggle the pin shut. Stop it here; the native mousedown outside-handler (on document)
      // still sees the click and keeps the card open.
      onClick={pinned ? (e) => e.stopPropagation() : undefined}
      onContextMenu={pinned ? (e) => { e.preventDefault(); e.stopPropagation(); } : undefined}>
      {/* DEV-only A/B/C layout switch — corner chip, cycles + persists the chosen variant. */}
      {import.meta.env.DEV && (
        <button className="lobbyscout-variant" onClick={(e) => { e.stopPropagation(); cycleVariant(); }}
          title="Cycle scout-card layout (dev only)">V{variant}</button>
      )}
      {body}
    </div>,
    document.body,
  );
}
