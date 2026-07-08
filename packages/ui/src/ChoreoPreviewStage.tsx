import { useEffect } from 'react';
import type { CombatEvent } from '@game/core';
import type { MomentKind } from './choreo/kinds';
import { runAttackExchangeCues } from './choreo/engine';
import { burstDeathAuras, breakShieldAura, reformReborn } from './choreo/channels/aura';
import { pixiFx } from './pixiFx';

/**
 * The Choreography panel's ▶ mock stage (choreographer task 10) — two small `.unit`-ish cards
 * (`data-uid="pv-atk"` / `data-uid="pv-def"`) that a dev can fire the selected moment's FX-channel cues
 * against, to SEE a lunge / impact / aura burst on demand without grinding a real fight. The FX render on
 * the app-wide `PixiFxLayer` (mounted unconditionally in Game.tsx), so the preview works on any screen the
 * layer is live on (title / recruit / combat).
 *
 * Best-effort by design: the WebGL FX + sfx channels are exercised; the CSS/GSAP float+bounce chrome the
 * real replay layers on (damage floats, poison drips, summon pops) is NOT reproduced — those kinds fall
 * through to sfx/no-op. The stage renders the cards; `fireKey` (a bump counter) drives `preview(kind)`.
 */

/** Measure a mock card by uid → its viewport-center + size, or null if not mounted. */
function rect(uid: string): { el: HTMLElement; cx: number; cy: number; w: number; h: number } | null {
  const el = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
  const r = el?.getBoundingClientRect();
  return el && r ? { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height } : null;
}

/** Fire the FX-channel cues that best represent `kind` against the two mock cards. */
function preview(kind: MomentKind): void {
  switch (kind) {
    case 'attackExchange': {
      const a = rect('pv-atk'), d = rect('pv-def');
      if (a && d) {
        runAttackExchangeCues(
          {
            start: 0, end: 1,
            primary: { type: 'attack', attacker: 'pv-atk', defender: 'pv-def', swing: 5 } as CombatEvent,
            stepGroups: [[0]], kind: 'attackExchange',
          },
          a.el, d.el, d.cx - a.cx, d.cy - a.cy,
          { combatSpeed: 1, advance: () => {} },
        );
      }
      break;
    }
    case 'shieldPop': {
      // Register a shield bubble, hold a brief beat, then break it so the shatter is visible.
      const d = rect('pv-def');
      if (d) {
        pixiFx.setShield('pv-def', d.cx, d.cy, d.w, d.h, false, 'shield');
        setTimeout(() => breakShieldAura('pv-def'), 250);
      }
      break;
    }
    case 'death':
    case 'riseDeath': {
      // Register a reborn/spirit bubble, then burst it (the death aura release).
      const d = rect('pv-def');
      if (d) {
        pixiFx.setShield('pv-def', d.cx, d.cy, d.w, d.h, false, 'reborn');
        setTimeout(() => burstDeathAuras('pv-def', d), 250);
      }
      break;
    }
    case 'reborn': {
      const d = rect('pv-def');
      if (d) reformReborn(d);
      break;
    }
    default:
      // Other kinds are sfx-only / CSS-float driven in the real replay — no representative WebGL FX to fire
      // on the mock stage. No-op (best-effort scope: floats/CSS-anims aren't reproduced here).
      break;
  }
}

/** The bordered mock stage. `fireKey` bumps to trigger `preview(kind)`; the initial mount (key 0) doesn't fire. */
export function ChoreoPreviewStage({ kind, fireKey }: { kind: MomentKind; fireKey: number }): React.ReactElement {
  // Fire only on a fireKey bump — `kind` is read fresh at fire time, but a kind change alone shouldn't replay.
  // `kind` is intentionally excluded from deps (no exhaustive-deps rule is configured in this repo).
  useEffect(() => {
    if (fireKey > 0) preview(kind);
  }, [fireKey]);

  return (
    <div className="choreo-stage" aria-hidden="true">
      <div className="choreo-stage-card" data-uid="pv-atk">atk</div>
      <div className="choreo-stage-card" data-uid="pv-def">def</div>
    </div>
  );
}
