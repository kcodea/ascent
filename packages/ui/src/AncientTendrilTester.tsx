import { useState } from 'react';
import { ANCIENTS, ANCIENT_IDS, type AncientId } from '@game/sim';
import { fireBuffFx } from './buffFxRender';
import { ancientTendrilDef, ancientTendrilDefId } from './fx/ancientTendrils';
import { canPlayDefs, ensureDefsReady } from './fx/playDef';
import { refreshDefs } from './fx/fxDefs';
import { useGame } from './store';

/**
 * DEV-only: fire each ANCIENT's own tendril (R-FX-ANCIENT-TENDRIL-02) on the cards on screen, through the REAL
 * `fireBuffFx({ ancient })` path, so a def saved in the workbench can be judged in the Shop without staging the Ancient,
 * the hero and a pairing that grants stats. Two origins, the same two the game uses:
 *  · From hero power: the hero-power button to every board minion (most pairings).
 *  · From a minion: the left-most board minion to every other one (Frank / Warden / Midas × Bonds).
 * An Ancient with no saved def plays the generic gold trail here too, exactly as in the game.
 */
const center = (el: Element | null): { x: number; y: number } | null => {
  const r = el?.getBoundingClientRect();
  return r && (r.width > 0 || r.height > 0) ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
};

const powerButton = (): Element | null =>
  document.querySelector('.statusbar .heropanel:not(.heropanel2):not(.equipslot) .heropowerbtn')
  ?? document.querySelector('.statusbar .heropowerbtn');

const boardUnits = (): { uid: string; at: { x: number; y: number } }[] =>
  (useGame.getState().run?.board ?? []).flatMap((c) => {
    const at = center(document.querySelector(`[data-zone="warband"] [data-uid="${c.uid}"]`));
    return at ? [{ uid: c.uid, at }] : [];
  });

function fire(ancient: AncientId, from: 'hero' | 'minion'): string | null {
  if (!canPlayDefs()) { void ensureDefsReady(); return 'FX are still loading, try again in a second.'; }
  const units = boardUnits();
  if (units.length === 0) return 'Put a minion on the board first.';
  if (from === 'hero') {
    const source = center(powerButton());
    if (!source) return 'No hero power button on screen.';
    for (const u of units) fireBuffFx({ source, target: u.at, cardId: '', tribe: 'neutral', sourceless: false, uids: { source: null, target: u.uid }, ancient });
    return null;
  }
  if (units.length < 2) return 'From a minion needs two minions on the board.';
  const [src, ...rest] = units;
  for (const u of rest) fireBuffFx({ source: src!.at, target: u.at, cardId: '', tribe: 'neutral', sourceless: false, uids: { source: src!.uid, target: u.uid }, ancient });
  return null;
}

export function AncientTendrilTester(): JSX.Element {
  const [note, setNote] = useState<string | null>(null);
  const [, bump] = useState(0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, fontSize: 13 }}>
      <div style={{ opacity: 0.8 }}>
        Save a workbench effect as <b>ancient-tendril-&lt;name&gt;</b> and it plays here and in the game. Unsaved ones play
        the generic gold trail.
      </div>
      {ANCIENT_IDS.map((id) => {
        const saved = !!ancientTendrilDef(id);
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: ANCIENTS[id].color, flex: 'none' }} />
            <span style={{ flex: 1 }}>
              {ANCIENTS[id].name}
              <span style={{ opacity: 0.6, marginLeft: 6 }}>{saved ? ancientTendrilDefId(id) : 'generic (not saved yet)'}</span>
            </span>
            <button type="button" className="btn" onClick={() => setNote(fire(id, 'hero'))}>From hero power</button>
            <button type="button" className="btn" onClick={() => setNote(fire(id, 'minion'))}>From a minion</button>
          </div>
        );
      })}
      <button type="button" className="btn" onClick={() => { refreshDefs(); bump((n) => n + 1); setNote(null); }}>
        Re-check saved effects
      </button>
      {note && <div style={{ color: '#ffb35c' }}>{note}</div>}
    </div>
  );
}
