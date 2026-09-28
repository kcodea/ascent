/** The two hero portraits the post-combat attack plays between: yours in the status bar, the foe's combat portrait. */
export interface PortraitGeometry {
  /** Screen-px centres of the striking and the struck hero (the centre of the ROUND PORTRAIT ART, at rest). */
  a: { x: number; y: number };
  d: { x: number; y: number };
  /** The struck portrait's radius (screen px). */
  radius: number;
  /** The striking portrait's radius (screen px). */
  attackerRadius: number;
  /** The elements the attack moves (transform only): the portrait wrappers. */
  attackerEl: HTMLElement;
  defenderEl: HTMLElement;
}

/** The element each portrait MOVES by (its transform wrapper) and the round art it is MEASURED by (first match). */
export const PORTRAIT_SELECTORS = {
  player: { move: '.statusbar .hero .herolunge', art: ['.statusbar .hero .herolunge .heroimg', '.statusbar .hero .herolunge'] },
  opp: { move: '.combatopp-body', art: ['.combatopp-body .combatopp-img', '.combatopp-body .combatopp-portrait', '.combatopp-body'] },
} as const;

/**
 * An element's rect AT REST: any CSS animation still running on it or an ancestor portrait container (the foe
 * portrait's drop-in, which is mid-flight when a tuner preview mounts it) is seeked to its end for the one
 * measure, then put back exactly where it was, all inside this call (no frame is painted in between).
 *
 * THE BUG (owner report 2026-09-28: "you can see the foe area isnt centered. can you fix that? may be wrong for blast
 * too"): the attack measured the foe's `.combatopp-body` while its `combatoppdrop` entrance was still running, so the
 * eruption and the hit number landed ~90 px above the portrait (and a little left, the drop scales in too).
 */
export function restingRect(el: Element, scope: Element | null = null): DOMRect {
  const root = scope ?? el;
  let anims: Animation[] = [];
  try {
    const within = typeof root.getAnimations === 'function' ? root.getAnimations({ subtree: true }) : [];
    const above: Animation[] = [];
    for (let p = root.parentElement; p; p = p.parentElement) if (typeof p.getAnimations === 'function') above.push(...p.getAnimations());
    anims = [...within, ...above].filter((a) => a.playState === 'running' || a.playState === 'paused');
  } catch { anims = []; }
  const saved: (number | null)[] = [];
  for (const a of anims) {
    const t = a.currentTime;
    saved.push(typeof t === 'number' ? t : null);
    try {
      const end = a.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && Number.isFinite(end)) a.currentTime = end;
    } catch { /* leave it */ }
  }
  const r = el.getBoundingClientRect();
  anims.forEach((a, i) => { const t = saved[i]; if (t !== null && t !== undefined) { try { a.currentTime = t; } catch { /* leave it */ } } });
  return r;
}

const centre = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * Measure both portraits once (the sequence start): the centre and radius of each ROUND PORTRAIT ART at rest (not the
 * wrapper, which on the player also holds the name pill, and never mid-entrance). Null when either is missing (a
 * non-lobby run has no foe).
 */
export function portraitGeometry(side: 'player' | 'opp'): PortraitGeometry | null {
  if (typeof document === 'undefined') return null;
  const one = (who: 'player' | 'opp'): { move: HTMLElement; rect: DOMRect } | null => {
    const sel = PORTRAIT_SELECTORS[who];
    const move = document.querySelector<HTMLElement>(sel.move);
    if (!move) return null;
    const scope = who === 'opp' ? (move.closest('.combatopp') ?? move) : move;
    for (const s of sel.art) {
      const art = document.querySelector<HTMLElement>(s);
      if (!art) continue;
      const rect = restingRect(art, scope);
      if (rect.width > 0 && rect.height > 0) return { move, rect };
    }
    return null;
  };
  const p = one('player'), o = one('opp');
  if (!p || !o) return null;
  const ar = side === 'player' ? p.rect : o.rect;
  const dr = side === 'player' ? o.rect : p.rect;
  return {
    a: centre(ar), d: centre(dr), radius: Math.min(dr.width, dr.height) / 2, attackerRadius: Math.min(ar.width, ar.height) / 2,
    attackerEl: side === 'player' ? p.move : o.move, defenderEl: side === 'player' ? o.move : p.move,
  };
}
