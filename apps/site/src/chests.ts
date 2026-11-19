/** Chests react to a click the way they do in the game's chest shop: a hop, and a burst that grows with the tier. */

interface TierFx {
  rings: number;
  sparks: number;
  reach: number;
  motes: number;
  /** How many colour tokens the tier has (--tier-<id>-1 .. n). */
  colours: number;
}

/** The game's own table (chest shop pick burst), tier by tier. */
export const TIER_FX: Record<string, TierFx> = {
  standard: { rings: 1, sparks: 6, reach: 50, motes: 0, colours: 2 },
  rare: { rings: 1, sparks: 10, reach: 65, motes: 0, colours: 3 },
  epic: { rings: 2, sparks: 18, reach: 90, motes: 6, colours: 3 },
  legendary: { rings: 2, sparks: 28, reach: 115, motes: 10, colours: 4 },
  ancient: { rings: 3, sparks: 42, reach: 145, motes: 16, colours: 3 },
};

const LEVEL = ['standard', 'rare', 'epic', 'legendary', 'ancient'];

export interface ChestOptions {
  reducedMotion: boolean;
  random?: () => number;
}

function node(doc: Document, cls: string, vars: Record<string, string>): HTMLElement {
  const el = doc.createElement('span');
  el.className = cls;
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.addEventListener('animationend', () => el.remove());
  return el;
}

function burst(chest: HTMLElement, tier: string, random: () => number): void {
  const fx = TIER_FX[tier];
  const host = chest.querySelector<HTMLElement>('[data-burst]');
  if (!fx || !host) return;
  const doc = chest.ownerDocument;
  const level = LEVEL.indexOf(tier);
  const colour = (): string =>
    // The Ancient chest's sparks are every colour; the rest draw from the tier's own few.
    tier === 'ancient' ? `hsl(${Math.floor(random() * 360)} 95% 75%)` : `var(--tier-${tier}-${1 + Math.floor(random() * fx.colours)})`;
  const made: HTMLElement[] = [];
  for (let i = 0; i < fx.rings; i++) {
    made.push(node(doc, 'chest-ring', { '--c': `var(--tier-${tier}-${1 + (i % fx.colours)})`, '--rs': String(2.2 + level * 0.5 + i * 0.6), 'animation-delay': `${i * 110}ms` }));
  }
  for (let i = 0; i < fx.sparks; i++) {
    const angle = (i / fx.sparks) * Math.PI * 2 + random() * 0.5;
    const dist = fx.reach * (0.6 + random() * 0.6);
    made.push(node(doc, 'chest-spark', { '--c': colour(), '--dx': `${(Math.cos(angle) * dist).toFixed(1)}px`, '--dy': `${(Math.sin(angle) * dist * 0.85).toFixed(1)}px`, 'animation-delay': `${Math.round(random() * (40 + level * 40))}ms` }));
  }
  for (let i = 0; i < fx.motes; i++) {
    made.push(node(doc, 'chest-mote', { '--c': colour(), left: `${(15 + random() * 70).toFixed(1)}%`, 'animation-delay': `${Math.round(120 + random() * 500)}ms` }));
  }
  host.append(...made);
  // If an animation never ends (a hidden tab), the nodes still go.
  setTimeout(() => made.forEach((el) => el.remove()), 2000);
}

export function initChests(doc: Document, opts: ChestOptions): void {
  const random = opts.random ?? Math.random;
  for (const chest of doc.querySelectorAll<HTMLElement>('[data-chest]')) {
    const tier = chest.getAttribute('data-chest') ?? '';
    chest.addEventListener('click', () => {
      if (opts.reducedMotion) return;
      // Restart the hop even on a quick second click.
      chest.removeAttribute('data-pop');
      void chest.offsetWidth;
      chest.setAttribute('data-pop', '');
      setTimeout(() => chest.removeAttribute('data-pop'), 1100);
      burst(chest, tier, random);
    });
  }
}
