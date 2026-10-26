/**
 * VERSUS — "Previous match stats" (owner 2026-10-14): the room's round-by-round overlay of the match this player last
 * finished. Built from the game's own pieces: the Match details panel (`.mdd-*`), the end screen's round pips
 * (`.endpip`, on the Gem plate), the stored-board renderer (`StoredTeam`) and Match details' own seat portrait and rune
 * row (`SeatPortrait`, `SeatRunes`). Victory / Defeat on top, then the pips (owner: no "Previous match" heading or summary
 * line, "completely unnecessary here"). A pip picks the round; each player's row shows their portrait (skin + frame),
 * Health and Armor after the fight (Match details' own pills, R-VERSUS-HEALTH-01), their board as it entered it, and their runes as of that round's lock.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MinionSnapshot } from '@game/core';
import { createPortal } from 'react-dom';
import { getHero, type RuneLiveState } from '@game/sim';
import { Icon } from '../Icon';
import { SeatPortrait, SeatRunes } from '../matchDetails/MatchScoreboard';
import { internSnapshot, opponentSkins, useSkinEpoch } from '../skins/skins';
import { useGame } from '../store';
import { StoredTeam } from '../StoredTeam';
import { sfx } from '../sfx';
import { stageHost } from '../stage';
import type { VersusMatchRecord } from './versusMatchRecord';
import { placementText } from '../rank/rankFormat';
import { blockInspect } from './VersusHud';
import { versusSnapshotView } from './versusInspectView';
import '../matchDetails/matchDetails.css';

const RESULT_WORD = { win: 'Won', lose: 'Lost', draw: 'Draw' } as const;

export function VersusMatchStats({ record, onClose }: { record: VersusMatchRecord; onClose: () => void }) {
  const [round, setRound] = useState<number | null>(record.rounds.at(-1)?.round ?? null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      // Esc closes an open card inspect first, then the overlay.
      if (useGame.getState().inspect) { useGame.getState().clearInspect(); return; }
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);
  useSkinEpoch();
  const showOpponents = useGame((st) => st.showOpponentSkins);
  const mySkins = internSnapshot(record.myCosmetics);
  const foeSkins = internSnapshot(opponentSkins(showOpponents, record.foeCosmetics));
  const shown = record.rounds.find((r) => r.round === round) ?? null;
  return createPortal(
    // The overlay owns every press under it: a right-click never inspects a card behind it (or one of its own boards).
    // Only the overlay's OWN minions inspect (a right-click on one of its boards opens the game's inspect, with the
    // buffs, above the overlay); any other right-click under it is swallowed, so nothing behind it can be inspected.
    <div className="mdd-scrim vsms-scrim" onPointerDown={() => { sfx.tick(); onClose(); }} onContextMenuCapture={inspectOnlyOwn}>
      <div className="mdd-panel" role="dialog" aria-modal="true" aria-label="Match stats" onPointerDown={(e) => e.stopPropagation()}>
        {/* VICTORY / DEFEAT in the lobby end screen's gold numeral (owner 2026-10-14: the end gate opens on this). */}
        {/* VERSUS GROUP (R-VERSUS-GROUP-07): my place in the lobby end screen's numeral ("Victory", "2ND"). */}
        {record.table && record.placement != null && (
          <div className={`endplace vsms-verdict${record.placement === 1 ? ' won' : ''}`}>
            <span className="endplace-num">{record.placement === 1 ? 'Victory' : placementText(record.placement)}</span>
          </div>
        )}
        {!record.table && record.outcome !== 'none' && (
          <div className={`endplace vsms-verdict${record.outcome === 'win' ? ' won' : ''}`}>
            <span className="endplace-num">{record.outcome === 'win' ? 'Victory' : 'Defeat'}</span>
          </div>
        )}
        <button ref={closeRef} type="button" className="mdd-close pressable vsms-close" aria-label="Close match stats" onClick={() => { sfx.tick(); onClose(); }}>
          <span aria-hidden="true">✕</span>
        </button>
        {/* THE WHOLE TABLE of a group match: every player's place, hero, Health and Armor (the match details row look). */}
        {record.table && (
          <div className="vsms-table" aria-label="Final standings">
            {record.table.map((t) => (
              <div key={t.name} className={`vsms-trow${t.me ? ' me' : ''}`}>
                <span className="vsms-tplace">{t.placement != null ? placementText(t.placement) : 'Playing'}</span>
                <span className="vsms-name">{t.name}{t.heroId && <span className="vsms-hero">{getHero(t.heroId).name}</span>}</span>
                <Pools hp={t.hp} armor={t.armor} />
              </div>
            ))}
          </div>
        )}
        {record.rounds.length === 0 ? (
          <div className="mds-empty">No rounds were fought.</div>
        ) : (
          <>
            <div className="endpips vsms-pips" aria-label="Round results">
              {record.rounds.map((r) => (
                <button key={r.round} type="button" className={`endpip ${r.result} clickable${round === r.round ? ' active' : ''}`}
                  aria-label={`Round ${r.round}: ${RESULT_WORD[r.result]}`} onClick={() => { sfx.tick(); useGame.getState().clearInspect(); setRound(r.round); }}>
                  {r.result === 'win' ? 'W' : r.result === 'lose' ? 'L' : 'D'}
                </button>
              ))}
            </div>
            {shown && (
              <section className="vsms-round">
                <div className="mds-board-caption">Round {shown.round} · {RESULT_WORD[shown.result]}</div>
                {/* A group round names the player (or Copy) fought that round. */}
                <VsSide name={shown.foeName ?? record.foeName} heroId={shown.foeHero !== undefined ? shown.foeHero : record.foeHero} skins={foeSkins} self={false} hp={shown.foeHp} armor={shown.foeArmor}
                  minions={shown.foe} snaps={shown.foeSnap} tier={shown.foeTier} runes={shown.foeRunes} runeLive={shown.foeRuneLive} label={`${shown.foeName ?? record.foeName}'s board`} />
                <VsSide name={record.myName} heroId={record.myHero} skins={mySkins} self hp={shown.myHp} armor={shown.myArmor}
                  minions={shown.mine} snaps={shown.mineSnap} tier={shown.myTier} runes={shown.myRunes} runeLive={shown.myRuneLive} label="Your board" />
              </section>
            )}
          </>
        )}
      </div>
    </div>,
    stageHost(),
  );
}

/** A player's Health and Armor, as Match details' scoreboard prints a seat's (the same spans). */
function Pools({ hp, armor }: { hp: number; armor: number }) {
  return (
    <span className="vsms-pools">
      <span className="mds-hp-v"><Icon name="heart" />{hp}</span>
      {armor > 0 && <span className="mds-hp-v armor"><Icon name="shield" />{armor}</span>}
    </span>
  );
}

/** One player's row for the picked round: portrait, name + hero, Health and Armor, then their board and runes. */
function VsSide({ name, heroId, skins, self, hp, armor, minions, snaps, tier, runes, runeLive, label }: {
  name: string; heroId: string | null; skins: ReturnType<typeof internSnapshot>; self: boolean; hp: number; armor: number;
  minions: VersusMatchRecord['rounds'][number]['mine']; snaps: readonly MinionSnapshot[] | undefined; tier: number | undefined;
  runes: readonly string[]; runeLive?: RuneLiveState; label: string;
}) {
  // The fight's snapshot views (live text, keywords, gilded, the buff breakdown) when the round carries them; an
  // older record falls back to the plain stored board (the card without a breakdown).
  const views = useMemo(() => (snaps && snaps.length === minions.length ? snaps.map((m) => versusSnapshotView(m, tier ?? 1)) : undefined), [snaps, minions.length, tier]);
  return (
    <div className="vsms-side">
      <div className="vsms-who">
        {heroId && <SeatPortrait heroId={heroId} skins={skins} self={self} />}
        <span className="vsms-name">{name}{heroId && <span className="vsms-hero">{getHero(heroId).name}</span>}</span>
        <Pools hp={hp} armor={armor} />
      </div>
      <div className="mds-team"><StoredTeam minions={minions} views={views} skins={skins} label={label} compact /></div>
      <SeatRunes runes={runes} live={runeLive} />
    </div>
  );
}

/** The overlay's right-click rule: a press on one of its own board cards goes through to the card's inspect; anything
 *  else under the overlay is swallowed (`blockInspect`). */
function inspectOnlyOwn(e: React.MouseEvent): void {
  const t = e.target;
  if (t instanceof Element && t.closest('.vsms-side .cv2-tile:not(.empty)')) return;
  blockInspect(e);
}
