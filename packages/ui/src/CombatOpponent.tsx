import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGame } from './store';
import { playerOpponent, getHero } from '@game/sim';
import { RUNE_INDEX } from '@game/content';
import { runeArt, heroPowerArt } from './art';
import { heroPortrait, opponentSkins, seatCosmetics } from './skins/skins';
import { frameIdOf, usePortraitFrame } from './portraitFrame/PortraitFrame';
import { FoePortraitDisc } from './FoePortraitDisc';
import { mdBold } from './Card';
import { Icon } from './Icon';
import { BuffsFrame } from './BuffsFrame';
import { gatherSnapshotBuffs } from './runBuffs';
import { stageHost } from './stage';
import { foePortrait } from './gauntlet/foePortrait';

/** A tier worth printing: a whole number from 1 up. Anything else (missing, NaN, 0) hides the pill. */
export const tierKnown = (tier: number | null | undefined): tier is number =>
  typeof tier === 'number' && Number.isInteger(tier) && tier >= 1;

/**
 * "Shop Tier X" under the foe's health pill (owner ask 2026-10-02). A primitive prop, memoized, no animation: it
 * re-renders only when the tier (or the Buffs arrow riding under it) changes; both props are primitives. Hidden when
 * the tier is unknown.
 */
export const OppTierPill = memo(function OppTierPill({ tier, arrow = null }: { tier: number | null | undefined; arrow?: '▴' | '▾' | null }): JSX.Element | null {
  if (!tierKnown(tier)) return null;
  return (
    <span className="combatopp-tier">
      <span className="combatopp-tier-l">Shop Tier</span> <b className="combatopp-tier-n">{tier}</b>
      {arrow && <span className="oppbuffs-arrow" aria-hidden="true">{arrow}</span>}
    </span>
  );
});

/**
 * THE COMBAT OPPONENT — the foe's hero portrait, dropped in over the Refresh button for the fight (owner ask
 * 2026-08-25).
 *
 * In a LOBBY run the foe only ever appeared as a row in the right-hand rail, and the rail slides away when
 * combat starts — so the fight had no face on the other side of it. This is that face: the same circular
 * portrait + name plate + health pill the player's own hero wears at the bottom-left, mirrored into the
 * board's top-right so the two heroes read as opponents across the board.
 *
 * It is also the LUNGE TARGET for the post-combat hero strike (`heroStrike.ts`), which is why it is a real
 * positioned element rather than a decoration painted into the rail.
 *
 * Mounted only while `.app.combat` is on; the drop-in itself is CSS (transform/opacity only — compositor-only,
 * per docs/performance.md).
 */
export const CombatOpponent = memo(function CombatOpponent(): JSX.Element | null {
  const lobby = useGame((s) => s.run.lobby);
  // Keyed on the wipe curtain's STAGED window, not the raw phase (owner ask 2026-08-28): the drop-in and the
  // fade-and-fall exit both play while the blue curtain hides the scene, so the reveal sweep always exposes
  // the portrait already seated (and the shop reveal never shows it mid-fall). See store.combatStaged.
  const staged = useGame((s) => s.combatStaged);
  const inCombat = useGame((s) => s.run.phase === 'combat');
  const preview = useGame((s) => s.duelPreview);
  const dmgDealt = useGame((s) => s.oppDmgDealt);
  const showOppSkins = useGame((s) => s.showOpponentSkins);
  // GAUNTLET: the foe is an authored stage opponent with no hero (its seat's heroId is only a stand-in), so it wears
  // its stage's TRIBE EMBLEM instead of a hero portrait and shows no hero power. A primitive (null outside the
  // Gauntlet), so the selector never re-renders on an unrelated run change.
  const gauntletNo = useGame((s) => (s.run.mode === 'gauntlet' ? (s.run.gauntletStage ?? 0) : null));

  // ENTRANCE + EXIT. The drop-in animation still plays (behind the curtain — invisible, but it keeps the dev
  // tuner's Test preview honest), while the old visible fade-and-fall exit is GONE: the curtain fully covers
  // the portrait when `staged` flips off, so it now just unmounts instantly under the blue (owner ask
  // 2026-08-28). The fought foe is cached because `staged` outlives the phase: during the exit-cover window
  // the run has already resolved and `playerOpponent` points at the NEXT round's pairing — rendering LIVE
  // there would flash the next foe's face for a beat before the curtain swallows the portrait.
  const active = !!lobby && (staged || preview);   // `preview` = the dev tuner's Test button
  const [phase, setPhase] = useState<'hidden' | 'in' | 'out'>('hidden');
  const cached = useRef<ReturnType<typeof playerOpponent> | null>(null);
  const live = active && lobby ? playerOpponent(lobby) : null;
  if ((inCombat || preview) && live?.seat) cached.current = live;
  useEffect(() => {
    setPhase(active ? 'in' : 'hidden');
  }, [active]);

  // FOE BUFFS PANEL (owner ask 2026-08-30) — the same click-the-portrait pop-out the player has, dropping
  // DOWN under the foe's health pill. Rows come off the served board's captured snapshot; bots/legacy
  // snapshots yield none, and with no rows there is no arrow, no hover prompt, and the click is a no-op —
  // exactly the player portrait's gating. Fresh state per mount, so a new fight always opens closed.
  const [buffsOpen, setBuffsOpen] = useState(false);
  const shown = inCombat || preview ? live : cached.current;
  // The foe's ring: its recorded portrait frame (through "Show opponent cosmetics"), else the portrait-frames tuner's
  // opponent ring (null = today's gold CSS border). Read before the early return.
  const frame = usePortraitFrame('opp', gauntletNo !== null ? null : frameIdOf(opponentSkins(showOppSkins, seatCosmetics(shown?.seat, shown?.board))));

  if (phase === 'hidden' || !shown?.seat) return null;
  const next = shown;
  const seat = shown.seat;
  const leaving = phase === 'out';
  // SKINS: the foe's recorded hero skin, or default art when "Show opponent skins" is off.
  const gauntlet = gauntletNo !== null;
  const gauntletFace = gauntlet ? foePortrait(gauntletNo) : undefined;
  const tribe = gauntletFace?.tribe;
  const art = gauntlet ? gauntletFace?.art : heroPortrait(seat.heroId, opponentSkins(showOppSkins, seatCosmetics(seat, next.board)));
  // The foe's health drops the moment the blow lands, not at resolve — mirroring the player's live drop. The
  // seat itself settles later (resolveCombat); `dmgDealt` carries the reduction until then. Armor absorbs first.
  const shownArmor = Math.max(0, seat.armor - dmgDealt);
  const shownResolve = Math.max(0, seat.resolve - Math.max(0, dmgDealt - seat.armor));
  // The foe's owned RUNES — from the served board's captured snapshot (bots/authored seats have none). Rendered
  // with the SAME `.questbadge.runebadge` markup the player uses, so art, hover tip and pulse animation match.
  // DEV ONLY (owner ask 2026-08-31): `window.__oppRunes = ['rune_x', …]` forces the foe's runes so the rune-slot
  // backgrounds can be tuned with real runes overlaid. Set it in the console, then hit the ⚔️ tuner's Test (or
  // start a fight) to re-render. Stripped from production.
  const forced = import.meta.env.DEV && typeof window !== 'undefined'
    ? (window as unknown as { __oppRunes?: string[] }).__oppRunes
    : undefined;
  const runes = (forced ?? next?.board.snapshot?.runes ?? []).filter((id) => RUNE_INDEX[id]);
  const buffRows = gatherSnapshotBuffs(next?.board.snapshot);
  // The tier of the board this foe is fielding (`PreparedBoard.tier`, the same number that feeds face damage).
  const oppTier = next.board.tier;
  const hasBuffs = buffRows.length > 0;
  // PORTAL to <body>: `.combatopp` must be able to paint ABOVE the player's statusbar (z40) when the foe
  // strikes. It used to live inside `.app` (a z-index:1 stacking context), which capped it under the
  // statusbar — the earlier fix raised the whole `.app`, which dragged the board layer over the player and
  // made the player portrait vanish (owner report 2026-08-25). As a root-level sibling of `.app` and
  // `.statusbar` it carries its own z-index (see styles.css) and lifts on its own. `position: fixed` keeps
  // its on-screen spot regardless of DOM parent.
  return createPortal(
    // Three nested roles, mirroring the player's housing (owner ask 2026-08-25):
    //   .combatopp       — fixed position + the ⚔️ tuner's centring scale/offset (GSAP never touches it).
    //   .combatopp-drop  — the whole group's drop-in; NAME and HEALTH live here so they stay ANCHORED.
    //   .combatopp-body  — the LUNGE target: the portrait (and its attack pill) ONLY, so the strike carries
    //                      just the face — the name and health do not fly with it, exactly as the player's
    //                      health stays put while the portrait lunges.
    <>
    <div className={`combatopp${leaving ? ' leaving' : ''}`} aria-hidden="true">
      <div className="combatopp-drop">
        <div className="combatopp-name hudpill-name">{seat.label}</div>
        <div className="combatopp-body">
          {/* The disc itself is shared with the Gauntlet's shop foe (FoePortraitDisc), so the two faces match. */}
          <FoePortraitDisc
            art={art}
            gauntlet={gauntlet}
            tribe={tribe}
            frame={frame}
            extraClass={`${hasBuffs ? ' hasbuffs' : ''}${buffsOpen ? ' buffsopen' : ''}`}
            onClick={() => { if (hasBuffs) setBuffsOpen((o) => !o); }}
            role={hasBuffs ? 'button' : undefined}
          >
            {/* Hover affordance — the same darkened prompt the player's portrait wears (owner ask 2026-08-30). */}
            {hasBuffs && (
              <span className="herohover" aria-hidden="true">
                Click hero portrait to open / close the Buffs Panel
              </span>
            )}
          </FoePortraitDisc>
        </div>
        {/* GAUNTLET: the stage opponent takes no damage and is never eliminated (R-GAUNTLET-02), so it wears no
            health pill — a number that could only ever "drop" and snap back would misreport the fight. */}
        {!gauntlet && (
          <div className="combatopp-hp hudpill-hp">
            <Icon name="heartPill" />{shownResolve}
            {/* Armor: a shield chip in the newer pill looks, the plain "+N" in Classic (healthPills.css shows one). */}
            {shownArmor > 0 && <span className="combatopp-armor hudpill-arm"><Icon name="armor" /><span className="hp-armplus">+</span>{shownArmor}</span>}
            {/* The foe's SHOP TIER (owner ask 2026-10-02) — a smaller pill hung BELOW the health pill. A child of
                the health pill, absolutely positioned, so it takes the pill's transform and strike fade and never
                shifts the column. When it shows, the Buffs arrow rides under IT instead of under the health pill
                (the two would otherwise sit on the same spot). */}
            {tierKnown(oppTier) ? (
              <OppTierPill tier={oppTier} arrow={hasBuffs ? (buffsOpen ? '▴' : '▾') : null} />
            ) : (
              /* Buffs affordance — the little arrow riding BELOW the health pill (the player's rides the
                 portrait's top; the foe's panel drops the other way). */
              hasBuffs && <span className="oppbuffs-arrow" aria-hidden="true">{buffsOpen ? '▴' : '▾'}</span>
            )}
          </div>
        )}
        {/* The foe's run-buffs pop-out — expands DOWNWARD out of the group's bottom edge when the portrait
            is clicked (see `.combatopp-drop .herobuffs` in styles.css). */}
        <BuffsFrame open={buffsOpen} rows={buffRows} drop />
      </div>
      {/* Persistent RUNE-SLOT backgrounds (owner ask 2026-08-31) — three art plates that ALWAYS show where the
          foe's runes socket. Rendered BEFORE the runes so they sit behind them, and they share the runes'
          positioning frame (⚔️ Hero Duel tuner → Rune slots) so a rune overlays its slot. */}
      <div className="combatopp-runeslots" aria-hidden="true">
        <div className="combatopp-slot slot1" />
        <div className="combatopp-slot slot2" />
        <div className="combatopp-slot slot3" />
      </div>
      {/* The foe's RUNES — a column beside the portrait (positions/scale from the ⚔️ Hero Duel tuner). Same
          badge component as the player's, so hover + the trigger bounce animate identically. `pointer-events`
          is re-enabled here alone (the rest of the group is inert) so the tooltips can be hovered. */}
      {runes.length > 0 && (
        <div className="combatopp-runes">
          {runes.map((id, i) => {
            const rune = RUNE_INDEX[id]!;
            const rart = runeArt(rune.id);
            return (
              <div className={`questbadge runebadge combatopp-rune${rune.epic ? ' runebadge-epic' : ''}`} key={`${id}#${i}`} data-source-id={id}>
                <div className="questbadge-inner">
                  {rart
                    ? <img decoding="sync" className="questbadge-art" src={rart} alt="" aria-hidden />
                    : <span className="questbadge-emblem" aria-hidden><Icon name="engrave" /></span>}
                <span className="rune-setting" aria-hidden />
                </div>
                <div className="questbadge-tip" role="tooltip">
                  <b>{rune.name}</b>
                  <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
                  <span className="questbadge-tip-state">Rune · active</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    {/* FOE HERO POWER (owner ask 2026-08-29) — the opponent's power icon pinned to the screen's top-right
        corner for the fight. Same classes as the player's .heropowerbtn so the circle treatment can never
        drift, but display-only: no cost coin, no name pill, no interactions (pointer-events: none in CSS —
        which also keeps the player-button hover glow rules from firing on it). A SIBLING of .combatopp, not
        a child: the wrapper's transform would hijack this element's fixed positioning. */}
    {!gauntlet && heroPowerArt(seat.heroId) && (
      <>
      <div className="heropowerbtn opp-power passive">
        <span className="hpb-artwrap" aria-hidden="true"><img decoding="sync" className="hpb-art" src={heroPowerArt(seat.heroId)} alt="" draggable={false} /></span>
      </div>
      {/* Hover tooltip — the same .herotip face the player's power shows (owner ask 2026-08-29), with the foe
          hero's STATIC power text (no live run numbers — we don't simulate the foe's shop state). A SIBLING
          of the icon, not a child: the icon must stay seated BELOW the portrait (z41) even while hovered, and
          a child could never out-stack the portrait from inside the icon's own stacking context. The sibling
          floats at z101 and is positioned/shown off the same --hd-power-* vars + the :hover + combinator. */}
      {(() => {
        const power = getHero(seat.heroId)?.power;
        return power ? (
          <div className="herotip opp-power-tip" role="tooltip">
            <b>{power.name}</b>{power.passive ? ' · passive' : ''}
            <span className="herotip-rule" dangerouslySetInnerHTML={{ __html: mdBold(power.text) }} />
          </div>
        ) : null;
      })()}
      </>
    )}
    </>,
    stageHost(),
  );
});
