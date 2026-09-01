import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGame } from './store';
import { playerOpponent, getHero } from '@game/sim';
import { RUNE_INDEX } from '@game/content';
import { heroArt, runeArt, heroPowerArt } from './art';
import { mdBold } from './Card';
import { Icon } from './Icon';
import { BuffsFrame } from './BuffsFrame';
import { gatherSnapshotBuffs } from './runBuffs';

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
export function CombatOpponent(): JSX.Element | null {
  const lobby = useGame((s) => s.run.lobby);
  // Keyed on the wipe curtain's STAGED window, not the raw phase (owner ask 2026-08-28): the drop-in and the
  // fade-and-fall exit both play while the blue curtain hides the scene, so the reveal sweep always exposes
  // the portrait already seated (and the shop reveal never shows it mid-fall). See store.combatStaged.
  const staged = useGame((s) => s.combatStaged);
  const inCombat = useGame((s) => s.run.phase === 'combat');
  const pill = useGame((s) => s.heroAtkPill);
  const dmg = useGame((s) => s.heroDmgTaken);
  const preview = useGame((s) => s.duelPreview);
  const dmgDealt = useGame((s) => s.oppDmgDealt);

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
  if (phase === 'hidden' || !shown?.seat) return null;
  const next = shown;
  const seat = shown.seat;
  const leaving = phase === 'out';
  const art = heroArt(seat.heroId);
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
        <div className="combatopp-name">{seat.label}</div>
        <div className="combatopp-body">
          <div
            className={`combatopp-portrait${hasBuffs ? ' hasbuffs' : ''}${buffsOpen ? ' buffsopen' : ''}`}
            onClick={() => { if (hasBuffs) setBuffsOpen((o) => !o); }}
            role={hasBuffs ? 'button' : undefined}
          >
            {/* The foe's ATTACK PILL — same badge the player wears; inside the body so it rides the lunge. */}
            {pill?.side === 'opp' && <span key="hero-atk-opp" className={`hero-atk hero-atk-opp${pill.buffed ? ' buffed' : ''}${pill.leaving ? ' leaving' : ''}`}>{pill.buffed && <span className="atk-sheen" aria-hidden="true"><span className="atk-sheen-bar" /></span>}{pill.amount}</span>}
            {art ? <img className="combatopp-img" src={art} alt="" draggable={false} /> : <Icon name="anvil" />}
            {/* Hover affordance — the same darkened prompt the player's portrait wears (owner ask 2026-08-30). */}
            {hasBuffs && (
              <span className="herohover" aria-hidden="true">
                Click hero portrait to open / close the Buffs Panel
              </span>
            )}
          </div>
          {/* The RED damage-taken number — centred on the portrait, OUTSIDE the clipped circle so it can overrun. */}
          {dmg?.side === 'opp' && <span key={`dmg${dmg.seq}`} className="hero-dmgtaken">−{dmg.amount}</span>}
        </div>
        <div className="combatopp-hp">
          <Icon name="heart" />{shownResolve}
          {shownArmor > 0 && <span className="combatopp-armor">+{shownArmor}</span>}
          {/* Buffs affordance — the little arrow riding BELOW the health pill (the player's rides the
              portrait's top; the foe's panel drops the other way). */}
          {hasBuffs && <span className="oppbuffs-arrow" aria-hidden="true">{buffsOpen ? '▴' : '▾'}</span>}
        </div>
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
              <div className="questbadge runebadge combatopp-rune" key={`${id}#${i}`} data-source-id={id}>
                <div className="questbadge-inner">
                  {rart
                    ? <img className="questbadge-art" src={rart} alt="" aria-hidden />
                    : <span className="questbadge-emblem" aria-hidden><Icon name="sc" /></span>}
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
    {heroPowerArt(seat.heroId) && (
      <>
      <div className="heropowerbtn opp-power passive">
        <span className="hpb-artwrap" aria-hidden="true"><img className="hpb-art" src={heroPowerArt(seat.heroId)} alt="" draggable={false} /></span>
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
    document.body,
  );
}
