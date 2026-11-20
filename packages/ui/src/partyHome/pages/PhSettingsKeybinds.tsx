/**
 * SETTINGS > KEYBINDINGS (owner 2026-11-20, R-SETTINGS-KEYBINDS-01): every rebindable key, grouped (In a game,
 * Spectating, Replays), then the keys that never change (Esc, Ctrl+B, F11).
 *
 * A row is the action's name and note on the left; on the right its key buttons (the primary, then an optional second,
 * e.g. the chat's Enter and Y) and a Reset when it differs from the default. Click a key button, then press a key:
 *   - Esc cancels (and only cancels: the Esc handlers stand down while a button waits, `keyCaptureActive`);
 *   - Delete on the SECOND button clears it;
 *   - a key another action holds is SWAPPED (that action takes the replaced key, or loses the key when there was none)
 *     and the status line under the header says so;
 *   - Ctrl, Cmd and Alt combos and the fixed keys are refused with a word why.
 * The press is caught on the window's capture phase and stopped there, so binding C never also opens the Compendium.
 *
 * Static paint; the waiting button only swaps its label and class. No `cursor` (the gauntlet rule paints buttons), no
 * native tooltips.
 */
import { useEffect, useState } from 'react';
import { sfx } from '../../sfx';
import {
  FIXED_KEYS, KEY_ACTIONS, KEY_ACTION_INDEX, KEY_GROUPS, bindableKey, clearSecondKey, isDefaultBinding, keyLabel, normKey, rebind,
  resetAllBindings, resetBinding, setKeyCapture, useKeybinds, type KeyActionId,
} from '../../keybinds/keybinds';
import { PhButton } from '../kit';
import { InfoRow, Row, Section } from './phSettingsParts';

interface Waiting { id: KeyActionId; slot: 0 | 1 }

export function KeybindsTab() {
  const binds = useKeybinds((s) => s.binds);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    if (!waiting) return undefined;
    setKeyCapture(true);
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.key === 'Escape') { setWaiting(null); setStatus('Cancelled.'); return; }
      if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return; // a modifier on its own: keep waiting
      const act = KEY_ACTION_INDEX[waiting.id];
      if (waiting.slot === 1 && e.key === 'Delete') {
        clearSecondKey(waiting.id); setWaiting(null); sfx.pulse(); setStatus(`${act.label} has no second key now.`); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) { setStatus('Combos with Ctrl, Alt or Cmd cannot be bound. Press a single key.'); return; }
      const key = normKey(e.key);
      if (!bindableKey(key)) { setStatus(`${keyLabel(key)} is a fixed key. Press another key.`); return; }
      const r = rebind(waiting.id, waiting.slot, key);
      setWaiting(null);
      sfx.pulse();
      if (!r.ok) { setStatus('That key cannot be bound.'); return; }
      if (r.swappedWith) {
        const other = KEY_ACTION_INDEX[r.swappedWith];
        const now = useKeybinds.getState().binds[r.swappedWith].map(keyLabel).join(' and ');
        setStatus(`${keyLabel(key)} was on ${other.label}. ${other.label} ${now ? `now uses ${now}` : 'has no key now'}.`);
      } else {
        setStatus(`${act.label}: ${keyLabel(key)}.`);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); setKeyCapture(false); };
  }, [waiting]);
  useEffect(() => () => setKeyCapture(false), []);

  const allDefault = KEY_ACTIONS.every((a) => isDefaultBinding(a.id, binds));
  return (
    <>
      {KEY_GROUPS.map((g, gi) => (
        <Section key={g.id} title={g.label}
          note={gi === 0 ? 'Click a key, then press the new one. Esc cancels. A key another action uses is swapped with it.' : undefined}>
          {gi === 0 && status && <p className="phs-keystatus" role="status">{status}</p>}
          {KEY_ACTIONS.filter((a) => a.group === g.id).map((a) => {
            const keys = binds[a.id];
            const second = a.defaults.length > 1 || keys.length > 1;
            const btn = (slot: 0 | 1) => {
              const on = waiting?.id === a.id && waiting.slot === slot;
              const k = keys[slot];
              return (
                <PhButton key={slot} size="s" className={`phs-key${on ? ' waiting' : ''}${k ? '' : ' empty'}`} aria-pressed={on}
                  aria-label={on ? `Press a key for ${a.label}` : `${a.label}${slot ? ' second key' : ''}: ${k ? keyLabel(k) : 'none'}. Change`}
                  // Unfocused, so a stray Enter or Space never presses it again while it waits.
                  onClick={(e) => { (e.currentTarget as HTMLButtonElement).blur(); sfx.tick(); setStatus(''); setWaiting(on ? null : { id: a.id, slot }); }}>
                  {on ? 'Press a key' : k ? keyLabel(k) : 'None'}
                </PhButton>
              );
            };
            const def = isDefaultBinding(a.id, binds);
            return (
              <Row key={a.id} label={a.label} note={a.note} labelId={`kb-${a.id}-l`} noteId={`kb-${a.id}-n`}>
                {btn(0)}
                {second && btn(1)}
                <PhButton size="s" variant="ghost" className={`phs-keyreset${def ? ' idle' : ''}`} disabled={def}
                  aria-label={`Reset ${a.label} to ${a.defaults.map(keyLabel).join(' and ')}`}
                  onClick={() => { resetBinding(a.id); sfx.pulse(); setStatus(`${a.label}: back to ${a.defaults.map(keyLabel).join(' and ')}.`); }}>
                  Reset
                </PhButton>
              </Row>
            );
          })}
        </Section>
      ))}
      <Section title="Fixed keys" note="These never change.">
        {FIXED_KEYS.map((f) => <InfoRow key={f.key} label={f.label} note={f.note} />)}
        <Row label="Reset every key" note="Puts every key above back to its default." labelId="kb-all-l" noteId="kb-all-n">
          <PhButton size="s" disabled={allDefault} onClick={() => { resetAllBindings(); setWaiting(null); sfx.pulse(); setStatus('Every key is back to its default.'); }}>
            Reset all
          </PhButton>
        </Row>
      </Section>
    </>
  );
}
