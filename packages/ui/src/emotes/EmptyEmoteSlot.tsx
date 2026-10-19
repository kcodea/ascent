/**
 * AN EMPTY EMOTE SLOT (owner 2026-10-15: "show the empty emote slots so it's obvious they have empty slots"). The same
 * well as an emote pick, drawn as the game's empty-slot frame (a faint dashed outline, like an empty Career tile), with
 * a muted "Empty" and the game's hover bubble pointing at crates. Never clickable. Used by the right-click menu and the
 * Collection's slot row, so both read the same.
 */
export const EMPTY_EMOTE_TIP = 'Empty slot. Find more emotes in chests.';

export function EmptyEmoteSlot({ position, role }: { position: number; role?: 'menuitem' }): JSX.Element {
  return (
    <span
      className="emote-pick emote-slot-empty gtip"
      data-tip={EMPTY_EMOTE_TIP}
      role={role}
      aria-disabled={role ? 'true' : undefined}
      aria-label={`Slot ${position + 1} is empty`}
    >
      <span className="emote-slot-empty-txt" aria-hidden="true">Empty</span>
    </span>
  );
}
