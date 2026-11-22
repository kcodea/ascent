/**
 * CHANGE NAME from your own banner (owner 2026-11-07: "we need a change name option"; R-PH-CHANGE-NAME-01).
 *
 * Your banner's menu offers Change name beside Change portrait and View Career. It opens a small window with the name
 * field and saves through the store's `setPlayerName`: the SAME path the title screen's name chip uses (24 characters,
 * trimmed, the `#tag` kept by `claimHandle`, the display name synced). No new rename rules: a guest can rename here
 * exactly as on the title chip, and an empty name falls back to the temporary handle there too.
 *
 * A name the filter blocks (a slur, R-NAME-FILTER-01) is refused here with a plain line under the field and the window
 * stays open; the server refuses it too.
 */
import { useState } from 'react';
import { NAME_BLOCKED_TEXT, isBlockedName } from '@game/sim';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { PhButton, PhDialog, PhField } from './kit';

/** The title chip's own cap (`setPlayerName` slices to it too). */
export const PLAYER_NAME_MAX = 24;

export interface CardMenuItem { label: string; run?: () => void; soon?: boolean }

/** Your own banner's menu, in order: Change name, Change portrait, View Career. */
export function selfCardMenu(a: { changeName: () => void; changePortrait: () => void; viewCareer: () => void }): CardMenuItem[] {
  return [
    { label: 'Change name', run: a.changeName },
    { label: 'Change portrait', run: a.changePortrait },
    { label: 'View Career', run: a.viewCareer },
  ];
}

/** The Change name window: Enter or Save renames you, Cancel / Esc / the backdrop leave the name alone. */
export function ChangeNameDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  const [v, setV] = useState(playerName);
  const [blocked, setBlocked] = useState(false);
  const save = (): void => {
    sfx.pulse();
    if (isBlockedName(v)) { setBlocked(true); return; }
    setPlayerName(v);
    onClose();
  };
  return (
    <PhDialog label="Change name" title="Change name" onClose={onClose}
      actions={<>
        <PhButton variant="primary" size="l" onClick={save}>Save</PhButton>
        <PhButton size="l" onClick={() => { sfx.pulse(); onClose(); }}>Cancel</PhButton>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <PhField label="Name" value={v} placeholder="Your name" maxLength={PLAYER_NAME_MAX} showCount autoFocus
          onChange={(e) => { setV(e.target.value); setBlocked(false); }} error={blocked ? NAME_BLOCKED_TEXT : undefined} hint="Other players see this name on your banner and the leaderboards." />
      </form>
    </PhDialog>
  );
}
