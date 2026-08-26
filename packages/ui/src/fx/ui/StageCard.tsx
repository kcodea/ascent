import type { StageActor, StageRole } from './stageModel';

/** Short badge text per role — printed over the card so the author can see at a glance who's wearing what,
 *  without opening the role picker. `'none'` prints nothing (an inert body on the row). */
const ROLE_LABEL: Record<StageRole, string> = {
  source: 'SRC',
  target: 'TGT',
  struck: 'HIT',
  selfBuffed: 'SELF',
  buffed: 'BUFF',
  none: '',
};

export interface StageCardProps {
  actor: StageActor;
  selected: boolean;
  onSelect: () => void;
  onPointerDownDrag: (e: React.PointerEvent) => void;
}

/**
 * The Stage Setter's lightweight mock card — DOM-faithful to what the FX system queries, DOM-empty of
 * everything else.
 *
 * `reactTargets.ts`'s `PART_SELECTOR` resolves `.badge.atk` / `.badge.hp` (each a `.plate` + `.value`
 * sibling pair) relative to a unit element found by `data-uid` under a `.row`; this renders exactly that
 * pair, character-for-character matching `Card.tsx`'s own badge markup, so a `react`/reach/stat-roll layer
 * targets a staged actor the same way it would a real combat card. It is NOT the real `<Card>` — no art, no
 * frame, no plate pipeline, no Zustand — just the bit of DOM the FX layer actually looks at, reusing the
 * real `.card`/`.badge`/`.plate`/`.value` CSS so it still looks like a card and sizes itself off the same
 * `--cw`/`--ch` vars (non-zero, no parent plumbing required). The `.row`/`[data-zone]` ancestry that
 * `rowUids`/`otherRowUids` need is the StageSetter's job (it owns the two zone rows), not this component's.
 *
 * Only `.fxwb-stagecard*` is new here: a role tag, a selected ring, and a grab handle for `StageSetter`'s
 * reorder-by-drag. The card body itself relies on the global gauntlet cursor rule (`.card` is already in
 * its selector list); only the handle needs its own grab-form cursor.
 */
export function StageCard({ actor, selected, onSelect, onPointerDownDrag }: StageCardProps): React.ReactElement {
  const roleLabel = ROLE_LABEL[actor.role];
  return (
    <div
      className={`card fxwb-stagecard${selected ? ' fxwb-stagecard-sel' : ''}`}
      data-uid={actor.uid}
      data-role={actor.role}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {roleLabel && <span className="fxwb-stagecard-role">{roleLabel}</span>}
      {/* Grab handle — StageSetter's horizontal reorder/re-zone drag. Stops the pointerdown from also
          bubbling into the card's own click-to-select, so starting a drag doesn't toggle selection. */}
      <span
        className="fxwb-stagecard-handle"
        aria-hidden="true"
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDownDrag(e);
        }}
      />
      {/* Stat badges — verbatim Card.tsx markup (docs/fx-vocabulary.md): `.badge` seats the pair, `.plate` is
          the shape, `.value` is the digit, plate + value as SIBLINGS so a react layer can animate either
          alone. Dummy stats only; this never runs combat math. */}
      <span className="badge atk">
        <span className="plate" aria-hidden="true" />
        <span className="value">{actor.atk}</span>
      </span>
      <span className="badge hp">
        <span className="plate" aria-hidden="true" />
        <span className="value">{actor.hp}</span>
      </span>
    </div>
  );
}
