/**
 * VERSUS ROOM OPTIONS on screen (owner 2026-10-24, R-VERSUS-OPTIONS-01): the host's panel in the room, read-only for
 * everyone else, the short summary the room heading and the room browser show, and the "options changed" notice.
 *
 * THE CENTERED WINDOW (owner 2026-10-25: "Improve the room settings layout and center it/darken the background when
 * opened", R-VERSUS-OPTIONS-02): the panel is the game's own centered dialog, the Match details scrim + panel
 * (`.mdd-scrim` / `.mdd-panel` / `.mdd-head` / `.mdd-close`, the same pieces "Previous match stats" uses), portalled to
 * the stage. It closes on the X, a press on the dark scrim, or Esc. Inside: a Mode section and a Modifier section, each
 * option a row card with its name and one plain line; the picked one is lit. Open and close are one-shot
 * transform/opacity fades (no looping paint). Player text: short plain sentences, no em dashes.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RIFTS, riftDefFor, normalizeVersusOptions, VERSUS_MODIFIERS, type VersusModifierId, type VersusMode, type VersusRoomOptions } from '@game/sim';
import { sfx } from '../sfx';
import { stageHost } from '../stage';
import '../matchDetails/matchDetails.css';

/** The mode as players read it. */
export const versusModeLabel = (mode: VersusMode): string =>
  (mode === 'group' ? '3-4 players' : mode === 'duos' ? '2v2' : mode === 'ranked_duos' ? 'Ranked Duos' : '1v1');

/** A modifier's name (its rift's). */
export const versusModifierName = (id: VersusModifierId): string => RIFTS[id]?.name ?? id;

/** One line for the room heading / browser card: "1v1", "3-4 players · Summit". */
export function versusOptionsSummary(raw: VersusRoomOptions | null | undefined): string {
  const o = normalizeVersusOptions(raw);
  return [versusModeLabel(o.mode), ...o.modifiers.map(versusModifierName)].join(' · ');
}

/** The close fade's length (ms): the window plays its one-shot out-fade, then the room unmounts it. */
export const VERSUS_OPTIONS_CLOSE_MS = 140;

const MODE_OPTIONS: { value: VersusMode; desc: string }[] = [
  { value: 'duel', desc: 'Two players. Health and Armor, like a normal game.' },
  { value: 'group', desc: 'Three or four players. Last one standing wins.' },
  { value: 'duos', desc: 'Two teams of two. Each team shares 30 Health plus both Armors.' },
];
/* RANKED DUOS is never a Versus room option (owner 2026-10-27, R-RANKED-DUOS-SPLIT-01): a party is reached only by the
   Ranked card's Duo + Play, and the server refuses to turn a Versus room into one. */
const MODIFIER_OPTIONS: { value: VersusModifierId | null; label: string; desc: string }[] = [
  { value: null, label: 'None', desc: 'The usual rules.' },
  ...VERSUS_MODIFIERS.map((id) => ({ value: id as VersusModifierId | null, label: versusModifierName(id), desc: riftDefFor(id, 'versus').blurb })),
];

/** One option: a row card with its name and one plain line. Lit when picked; read-only rooms show it disabled. */
function OptionCard({ name, desc, on, editable, onPick }: { name: string; desc: string; on: boolean; editable: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={!editable} className={`vsopt-card${on ? ' on' : ''}`}
      onClick={() => { if (!editable || on) return; sfx.tick(); onPick(); }}>
      <span className="vsopt-name">{name}</span>
      <span className="vsopt-desc">{desc}</span>
    </button>
  );
}

/**
 * The options window. `editable`: the host while the room is Open (anyone else, or a sealed / running room, sees the
 * same cards read-only). `onChange` sends the whole new object; the server validates it. `onClose` fires once the
 * close fade has played.
 */
export function VersusOptionsPanel({ options, editable, onChange, onClose }: {
  options: VersusRoomOptions | null | undefined;
  editable: boolean;
  onChange: (next: VersusRoomOptions) => void;
  onClose: () => void;
}): JSX.Element {
  const o = normalizeVersusOptions(options);
  const modifier = o.modifiers[0] ?? null;
  const [closing, setClosing] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The latest onClose without re-arming the key listener on every room render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useRef(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    sfx.tick();
    setClosing(true);
    timerRef.current = setTimeout(() => onCloseRef.current(), VERSUS_OPTIONS_CLOSE_MS);
  }).current;
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // The window owns Esc while it is open: it closes, and the Esc menu stays shut.
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [close]);
  return createPortal(
    <div className={`mdd-scrim vsopt-scrim${closing ? ' closing' : ''}`} onPointerDown={close}>
      <div className="mdd-panel vsoptions" role="dialog" aria-modal="true" aria-label="Room options" onPointerDown={(e) => e.stopPropagation()}>
        <div className="mdd-head">
          <div className="mdd-titles">
            <span className="mdd-title">Room options</span>
            <span className="mdd-sub">{editable ? 'Pick how this room plays. Versus is unranked.' : 'Versus is unranked.'}</span>
          </div>
          <button ref={closeRef} type="button" className="mdd-close pressable" aria-label="Close room options" onClick={close}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {!editable && <div className="vsopt-lock" role="note">Only the host can change these.</div>}
        <section className="vsopt-sec" aria-label="Mode">
          <h3 className="vsopt-h">Mode</h3>
          <div className="vsopt-grid" role="radiogroup" aria-label="Mode">
            {MODE_OPTIONS.map((m) => (
              <OptionCard key={m.value} name={versusModeLabel(m.value)} desc={m.desc} on={o.mode === m.value} editable={editable}
                onPick={() => onChange({ ...o, mode: m.value })} />
            ))}
          </div>
        </section>
        <section className="vsopt-sec" aria-label="Modifier">
          <h3 className="vsopt-h">Modifier</h3>
          <div className="vsopt-grid" role="radiogroup" aria-label="Modifier">
            {MODIFIER_OPTIONS.map((m) => (
              <OptionCard key={String(m.value)} name={m.label} desc={m.desc} on={modifier === m.value} editable={editable}
                onPick={() => onChange({ ...o, modifiers: m.value ? [m.value] : [] })} />
            ))}
          </div>
        </section>
      </div>
    </div>,
    stageHost(),
  );
}
