import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CARD_INDEX } from '@game/content';
import { Unit } from '../../Unit';
import type { UnitFrame } from '../../useCombatReplay';
import type { FxStageBoard, FxStageSide, FxStageUnit } from './stageBoard';

/**
 * The FX workbench's own board — three units a side, standing in for a combat.
 *
 * See `stageBoard.ts` for WHY this exists. The rule this file exists to keep is that the markup is the
 * GAME'S markup: `.zone[data-zone="tavern"] > .row` for the far side and `.zone[data-zone="warband"] >
 * .row.warband` for yours, each holding `.unit > .card[data-uid]` via the real `Unit` component. Those are
 * the exact selectors `boardAnchors.ts` (anchors) and `reactTargets.ts` (react reach) query, so an effect
 * previewed here resolves through the same code path it will at runtime. Hand-rolling a lookalike row would
 * make the preview a second implementation of the board, free to drift from the one that ships.
 *
 * Deliberately NOT wired to a run: the stage is a display, not a sim. Nothing here can be attacked, damaged
 * or bought, and the units carry no combat state beyond what a card needs to render. Effects are what move
 * on this stage; the board underneath holds still, which is precisely what makes it a reference.
 */

/** A stage unit rendered as a combat frame. The optional half of `UnitFrame` is all mid-combat accrual
 *  (Avenge tallies, banked Imp stats, per-instance progress) that a stage unit has never accrued, so the
 *  frame is the minimum a card needs to draw: identity, stats, keywords. */
function frameOf(u: FxStageUnit): UnitFrame | null {
  const def = CARD_INDEX[u.cardId];
  if (def === undefined) return null;
  return {
    uid: u.uid,
    cardId: u.cardId,
    name: def.name,
    tribe: def.tribe,
    attack: def.attack,
    health: def.health,
    keywords: [...def.keywords],
    divineShield: def.keywords.includes('DS'),
    alive: true,
    golden: false,
    summonBonus: 0,
    // The stats it "entered the fight" with — equal to its printed stats here, which is what keeps the badges
    // neutral (neither buffed-green nor damaged-red) on a board that has never been in a fight.
    baseAttack: def.attack,
    baseHealth: def.health,
  };
}

function StageRow({ units, side }: { units: FxStageUnit[]; side: FxStageSide }) {
  const frames = useMemo(() => units.map(frameOf).filter((f): f is UnitFrame => f !== null), [units]);
  return (
    <div className="zone" data-zone={side === 'you' ? 'warband' : 'tavern'}>
      <div className={side === 'you' ? 'row warband' : 'row'}>
        {frames.map((f) => (
          <Unit key={f.uid} u={f} side={side === 'you' ? 'you' : 'foe'} />
        ))}
      </div>
    </div>
  );
}

/**
 * PORTALLED TO `document.body`, and that is a layering requirement rather than a preference.
 *
 * `.fxwb` is `position: fixed; z-index: 500`, which makes it a stacking context: nothing rendered inside it
 * can paint BELOW the FX overlay canvas (`.pixifx`, z110). A stage rendered as a workbench child would
 * therefore cover every effect it exists to show. Portalled out, it takes its own z-index between the game
 * (`.app`, z1) and the over-card canvas — which is the same sandwich the real board sits in, so an
 * `under`-slot effect lands beneath these cards and an `over`-slot effect in front of them, exactly as it
 * will in a fight.
 */
export function FxStage({ board }: { board: FxStageBoard }) {
  return createPortal(
    <div className="fxwb-stage" aria-hidden="true">
      <StageRow units={board.foe} side="foe" />
      <StageRow units={board.you} side="you" />
    </div>,
    document.body,
  );
}
