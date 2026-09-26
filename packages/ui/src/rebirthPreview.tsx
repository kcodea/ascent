import { createRoot, type Root } from 'react-dom/client';
import { CARD_INDEX } from '@game/content';
import { Card, type CardView } from './Card';
import { reformRebirth } from './choreo/channels/aura';

/**
 * DEV preview rig for the 🔥 Rebirth tuner: a sample Rebirth card floated beside the tuner panel (the idle crown
 * can be judged without a Rebirth minion in play), and a replay of the full trigger (the flame burst + the
 * `rebirthing` re-form) on it. Mounted with its own React root in a fixed host; toggled off by the same button.
 * Layout is read once per click, never per frame.
 */
const SAMPLE_ID = 'dw_exgalloper';
let host: HTMLDivElement | null = null;
let root: Root | null = null;

function sampleView(): CardView {
  const d = CARD_INDEX[SAMPLE_ID];
  return {
    name: d?.name ?? 'Exgalloper', cardId: SAMPLE_ID, tribe: d?.tribe ?? 'beast',
    attack: d?.attack ?? 6, health: d?.health ?? 6, keywords: ['RB'], text: d?.text ?? '**Rebirth.**', tier: d?.tier ?? 5,
  };
}

export function isRebirthPreviewShown(): boolean { return host !== null; }

/** Show (or hide) the sample Rebirth card to the LEFT of the tuner panel. */
export function toggleRebirthPreview(panelEl: HTMLElement | null): void {
  if (host) { root?.unmount(); host.remove(); host = null; root = null; return; }
  const r = panelEl?.getBoundingClientRect();
  host = document.createElement('div');
  host.className = 'rbpreview';
  const left = r ? Math.max(12, r.left - 300) : window.innerWidth / 2 - 130;
  const top = r ? Math.max(90, r.top + 110) : window.innerHeight / 2 - 160;
  host.style.cssText = `position:fixed;left:${left}px;top:${top}px;z-index:900;pointer-events:none;`;
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<div className="unit rbpreview-unit"><Card card={sampleView()} uid="rbpreview" /></div>);
}

/** Play the full rebirth trigger: on the preview card when shown, else the first Rebirth card on screen, else the
 *  screen centre (burst only). */
export function playRebirthPreview(): void {
  const unit = host?.querySelector<HTMLElement>('.unit') ?? null;
  const el = unit?.querySelector('.card') ?? document.querySelector('.card.rebirthcard');
  const r = el?.getBoundingClientRect();
  const rect = r && r.width > 0
    ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }
    : { cx: window.innerWidth / 2, cy: window.innerHeight / 2, w: 180, h: 240 };
  if (unit) {
    // Restart the one-shot re-form: drop the classes, force one style flush, re-add.
    unit.classList.remove('reborn', 'rebirthing');
    void unit.offsetWidth;
    unit.classList.add('reborn', 'rebirthing');
    window.setTimeout(() => unit.classList.remove('reborn', 'rebirthing'), 1200);
  }
  reformRebirth(rect, null, unit ?? (el instanceof HTMLElement ? el : null));
}

/** The burst alone over the screen centre; `count` > 1 plays a row of them at once (the mass-rebirth check). */
export function playRebirthBurstCentre(count = 1): void {
  const cw = 170, gap = 18, y = window.innerHeight / 2;
  const x0 = window.innerWidth / 2 - ((count - 1) * (cw + gap)) / 2;
  for (let i = 0; i < count; i++) reformRebirth({ cx: x0 + i * (cw + gap), cy: y, w: cw, h: cw / 0.752 }, null);
}
