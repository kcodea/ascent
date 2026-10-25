/**
 * VERSUS ROOM OPTIONS on screen (owner 2026-10-24, R-VERSUS-OPTIONS-01): the host's panel in the room, read-only for
 * everyone else, the short summary the room heading and the room browser show, and the "options changed" notice.
 *
 * The controls are Practice's own segmented pills (`Segmented`, PracticeOptions.tsx: `.poseg`, the global gauntlet
 * cursor), on the room's Gem plate panel. Player text: short plain sentences, no em dashes.
 */
import { RIFTS, riftDefFor, normalizeVersusOptions, VERSUS_MODIFIERS, type VersusModifierId, type VersusMode, type VersusRoomOptions } from '@game/sim';
import { Segmented } from '../PracticeOptions';

/** The mode as players read it. */
export const versusModeLabel = (mode: VersusMode): string => (mode === 'group' ? '3-4 players' : '1v1');

/** A modifier's name (its rift's). */
export const versusModifierName = (id: VersusModifierId): string => RIFTS[id]?.name ?? id;

/** One line for the room heading / browser card: "1v1", "3-4 players · Summit". */
export function versusOptionsSummary(raw: VersusRoomOptions | null | undefined): string {
  const o = normalizeVersusOptions(raw);
  return [versusModeLabel(o.mode), ...o.modifiers.map(versusModifierName)].join(' · ');
}

const MODE_OPTIONS: { value: VersusMode; label: string }[] = [
  { value: 'duel', label: '1v1' },
  { value: 'group', label: '3-4 players' },
];
const MODIFIER_OPTIONS: { value: VersusModifierId | null; label: string }[] = [
  { value: null, label: 'None' },
  ...VERSUS_MODIFIERS.map((id) => ({ value: id as VersusModifierId | null, label: versusModifierName(id) })),
];

/**
 * The options panel. `editable`: the host while the room is Open (anyone else, or a sealed / running room, sees the
 * same pills read-only). `onChange` sends the whole new object; the server validates it.
 */
export function VersusOptionsPanel({ options, editable, onChange, onClose }: {
  options: VersusRoomOptions | null | undefined;
  editable: boolean;
  onChange: (next: VersusRoomOptions) => void;
  onClose: () => void;
}): JSX.Element {
  const o = normalizeVersusOptions(options);
  const modifier = o.modifiers[0] ?? null;
  const modeHint = o.mode === 'group'
    ? 'Three or four players. Everyone meets everyone in turn. With three, one player faces a copy of another board each round. Last one standing wins.'
    : 'Two players, seven hearts each.';
  const modifierHint = modifier ? riftDefFor(modifier, 'versus').blurb : 'The usual rules.'; // Summit: Tier 7 only, no Armor
  return (
    <div className="vsoptions" role="dialog" aria-label="Room options">
      <div className="vsoptions-head">
        <span className="vsoptions-title">Room options</span>
        <button type="button" className="mdd-close pressable" aria-label="Close room options" onClick={onClose}><span aria-hidden="true">✕</span></button>
      </div>
      {!editable && <span className="vsoptions-note">Only the host can change these, between games.</span>}
      <Segmented label="Mode" hint={modeHint} value={o.mode} options={MODE_OPTIONS} disabled={!editable}
        onPick={(mode) => onChange({ ...o, mode })} />
      <Segmented label="Modifier" hint={modifierHint} value={modifier} options={MODIFIER_OPTIONS} disabled={!editable}
        onPick={(id) => onChange({ ...o, modifiers: id ? [id] : [] })} />
      <span className="vsoptions-note">Versus is unranked.</span>
    </div>
  );
}
