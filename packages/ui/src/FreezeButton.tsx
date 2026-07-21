import { Icon } from './Icon';

/**
 * The standalone FREEZE toggle — moved out of the shop tray to the board's TOP-RIGHT, opposite the Tavern
 * Up stone, and stage-pinned like the other board buttons (position/scale from the ❄️ dev tuner,
 * `freezeConfig.ts`).
 *
 * It still wears the tray's `shopbtn freeze` styling: the freeze ART isn't in yet, so re-skinning it now
 * would mean inventing a look that gets thrown away. Only the PLACEMENT moved. When the art lands this
 * grows the layered treatment the Refresh crystal has.
 *
 * Reducer wiring is unchanged (`{type:'freeze'}` — a toggle).
 */
export function FreezeButton({
  frozen,
  disabled,
  onFreeze,
}: {
  frozen: boolean;
  disabled: boolean;
  onFreeze: () => void;
}) {
  return (
    <button
      className={`frzwrap shopbtn freeze${frozen ? ' on' : ''}`}
      disabled={disabled}
      onClick={onFreeze}
      aria-label={frozen ? 'Unfreeze the tavern' : 'Freeze the tavern'}
    >
      <span className="sb-l">Freeze</span>
      <span className="sb-ic"><Icon name="freeze" /></span>
      <span className="sbtip">{frozen ? 'Frozen — click to unfreeze' : 'Freeze the tavern'}</span>
    </button>
  );
}
