import {
  HERO_BLAST_DEFAULTS, HERO_BLAST_RANGES, HERO_BLAST_SPEEDS, blastPlan, getHeroBlastConfig, heroBlastConfigJson,
  heroBlastPreviewSpeed, resetHeroBlastConfig, setHeroBlastPreviewSpeed, setHeroBlastValue,
  type HeroBlastConfig, type HeroBlastNumKey,
} from './heroBlast/heroBlastConfig';
import { DEV_HERO_ATTACK_CHOICES, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroBlast, type HeroBlastHandle, type HeroBlastPart } from './heroBlast/heroBlast';
import { useGame } from './store';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the BLAST hero attack (owner ask 2026-09-28). The Play buttons run the REAL runner between the two
 * real hero portraits (the foe's is mounted via `duelPreview`, so it works from the shop), with the damage and the
 * number of parts chosen below, in either direction, at 1x / 0.5x / 0.25x. A preview never touches the run: the
 * impact only pops the red damage number. The "Attack style" row is the dev override for real fights (Auto = what
 * a player would see: their equipped cosmetic, else Classic). Production plays the baked defaults.
 */
type BlastTunerValues = HeroBlastConfig & { attackStyle: string };

const SPECS: Record<HeroBlastNumKey, [string, TunerUnit | undefined, string, string]> = {
  popInMs: ['Pop in', 'ms', 'Each number popping in where it comes from.', 'Combine'],
  combineStaggerMs: ['Stagger', 'ms', 'Gap between each number leaving.', 'Combine'],
  combineFlyMs: ['Flight', 'ms', 'How long a number takes to reach the total.', 'Combine'],
  combineBackPx: ['Pull back', 'px', 'How far a number pulls back before it flies (anticipation).', 'Combine'],
  combineArc: ['Arc', '×', 'How much the numbers curve on the way in.', 'Combine'],
  combineBias: ['Merge point', '×', 'Where the numbers meet: 0 = the board centre, 1 = the attacking hero.', 'Combine'],
  mergePop: ['Merge pop', '×', 'How big the total pops when the last number lands.', 'Combine'],
  mergeHoldMs: ['Merge hold', 'ms', 'The total holds this long before the hero absorbs it.', 'Combine'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Charge'],
  chargeMs: ['Charge', 'ms', 'The hero gathering light before the first shot. The view pushes in over this.', 'Charge'],
  chargeMotes: ['Charge motes', undefined, 'Motes pulled into the hero while it charges.', 'Charge'],
  boltsMin: ['Bolts (small hit)', undefined, 'Bolts fired for a 1 damage blow.', 'Bolts'],
  boltsMax: ['Bolts (big hit)', undefined, 'Bolts fired for a blow at Big damage or more.', 'Bolts'],
  boltSpeed: ['Bolt speed', 'px/s', 'How fast the bolts fly (the flight stays between 140 and 520 ms).', 'Bolts'],
  boltStaggerMs: ['Bolt stagger', 'ms', 'Gap between each bolt in the volley.', 'Bolts'],
  boltSizeMin: ['Bolt size (small)', '×', 'Bolt size for a 1 damage blow.', 'Bolts'],
  boltSizeMax: ['Bolt size (big)', '×', 'Bolt size at Big damage or more.', 'Bolts'],
  boltCurve: ['Bolt curve', '×', 'How far the trailing bolts arc to the sides (the lead bolt flies straight).', 'Bolts'],
  trailDensity: ['Trail', '×', 'How dense the bolt trails are (0 = no trail).', 'Bolts'],
  bigDamage: ['Big damage', undefined, 'The blow at which everything reads at full size.', 'Impact'],
  flashSize: ['Hit flash size', '×', 'The white-hot flash on the struck hero.', 'Impact'],
  flashAlpha: ['Hit flash', 'opacity', 'How bright the hit flash is.', 'Impact'],
  sparksMin: ['Sparks (small)', undefined, 'Sparks thrown by a 1 damage impact.', 'Impact'],
  sparksMax: ['Sparks (big)', undefined, 'Sparks thrown at Big damage or more.', 'Impact'],
  shakeMin: ['Shake (small)', 'px', 'Screen shake for a 1 damage blow.', 'Camera'],
  shakeMax: ['Shake (big)', 'px', 'Screen shake at Big damage or more.', 'Camera'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera'],
  zoomMin: ['Push in (small)', '×', 'How far the view pushes in for a 1 damage blow (0.02 = 2%).', 'Camera'],
  zoomMax: ['Push in (big)', '×', 'How far the view pushes in at Big damage or more.', 'Camera'],
  zoomPunch: ['Impact punch', '×', 'Extra push on impact, before the view settles back.', 'Camera'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera'],
  settleMs: ['Settle', 'ms', 'Hold after the last bolt lands before the sequence ends.', 'Camera'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the total just fades in and out over this.', 'Camera'],
  sfxGatherGain: ['Numbers fly', undefined, 'The tally travel whoosh as the numbers leave.', 'Sound'],
  sfxCountGain: ['Count up', undefined, 'The tally counter as the total climbs.', 'Sound'],
  sfxMergeGain: ['Merge', undefined, 'The pill-add ting on the final merge.', 'Sound'],
  sfxChargeGain: ['Charge', undefined, 'The rune implosion as the hero gathers.', 'Sound'],
  sfxFireGain: ['Fire', undefined, 'The gust as the volley leaves.', 'Sound'],
  sfxImpactGain: ['Impact', undefined, 'The tally impact on the struck hero.', 'Sound'],
  sfxSmackGain: ['Impact smack', undefined, 'A soft smack layered under the impact.', 'Sound'],
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
};

const COLORS: [keyof HeroBlastConfig, string, string][] = [
  ['colorCore', 'Core', 'The white-hot core: bolt heads, the charge, the hit flash.'],
  ['colorBolt', 'Bolt', 'The bolt halos, trails and the charge ring.'],
  ['colorImpact', 'Impact', 'The impact bloom, the outer shockwave and the embers.'],
];

type Ctl = TunerControl<Extract<keyof BlastTunerValues, string>>;

function buildControls(): Ctl[] {
  const out: Ctl[] = [{
    key: 'attackStyle', label: 'Attack style', kind: 'select', options: DEV_HERO_ATTACK_CHOICES, group: 'Style',
    optionLabels: { auto: 'Auto (equipped cosmetic)', classic: 'Classic (lunge)', blast: 'Blast' },
    hint: 'Which hero attack real fights play in this dev build, for both sides. Auto = what a player sees.', min: 0, max: 0, step: 0,
  }];
  const byGroup = new Map<string, Ctl[]>();
  for (const [key, [label, unit, hint, group]] of Object.entries(SPECS) as [HeroBlastNumKey, [string, TunerUnit | undefined, string, string]][]) {
    if (key === 'trailDensity') continue; // appended to Bolts below, after the curve
    const [min, max, step] = HERO_BLAST_RANGES[key];
    const list = byGroup.get(group) ?? [];
    list.push({ key, label, unit, hint, group, min, max, step });
    byGroup.set(group, list);
  }
  const td = HERO_BLAST_RANGES.trailDensity;
  byGroup.get('Bolts')!.push({ key: 'trailDensity', label: SPECS.trailDensity[0], unit: '×', hint: SPECS.trailDensity[2], group: 'Bolts', min: td[0], max: td[1], step: td[2] });
  for (const g of ['Preview', 'Combine', 'Charge', 'Bolts', 'Impact', 'Camera']) out.push(...(byGroup.get(g) ?? []));
  for (const [key, label, hint] of COLORS) out.push({ key, label, hint, group: 'Colours', kind: 'color', min: 0, max: 0, step: 0 });
  out.push(...(byGroup.get('Sound') ?? []));
  return out;
}

let live: HeroBlastHandle | null = null;

/** Split a blow into `n` numbers the way a fight does: the tier first, then the survivors (all at least 1). */
export function previewParts(damage: number, n: number): number[] {
  const d = Math.max(1, Math.round(damage));
  const k = Math.max(1, Math.min(8, Math.round(n), d));
  const base = Math.max(1, Math.round(d / k));
  const out = [Math.min(base, d - (k - 1))];
  let left = d - out[0]!;
  for (let i = 1; i < k; i++) { const v = i === k - 1 ? left : Math.max(1, Math.round(left / (k - i))); out.push(v); left -= v; }
  return out;
}

/** Play the real Blast between the two portraits, from the shop or a fight, without touching the run. */
function demo(side: 'player' | 'opp', opts: { damage?: number; reduced?: boolean } = {}): void {
  const st = useGame.getState();
  live?.cancel();
  st.setDuelPreview(true);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const cfg = getHeroBlastConfig();
    const playerEl = document.querySelector<HTMLElement>('.statusbar .hero .herolunge');
    const oppEl = document.querySelector<HTMLElement>('.combatopp-body');
    if (!playerEl || !oppEl) { st.setDuelPreview(false); return; }
    const centre = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const pPt = centre(playerEl.getBoundingClientRect());
    const oPt = centre(oppEl.getBoundingClientRect());
    const a = side === 'player' ? pPt : oPt, d = side === 'player' ? oPt : pPt;
    const board = document.querySelector('.app')?.getBoundingClientRect();
    const cx = board ? board.left + board.width / 2 : window.innerWidth / 2;
    const cy = board ? board.top + board.height / 2 : window.innerHeight / 2;
    const values = previewParts(opts.damage ?? cfg.previewDamage, cfg.previewParts);
    // Survivors fly from real cards when there are any on the board, else from a spread across the middle.
    const cards = [...document.querySelectorAll<HTMLElement>(side === 'player' ? "[data-zone='warband'] .card" : "[data-zone='tavern'] .card")];
    const parts: HeroBlastPart[] = values.map((value, i) => {
      if (i === 0) return { value, from: a, base: true };
      const el = cards[i - 1];
      const bw = board?.width ?? window.innerWidth;
      return { value, from: el ? centre(el.getBoundingClientRect()) : { x: cx + (i - values.length / 2) * bw * 0.1, y: cy + (side === 'player' ? 1 : -1) * 40 } };
    });
    const total = values.reduce((s, v) => s + v, 0);
    const seq = Date.now();
    live = playHeroBlast({
      parts, total, attacker: a, defender: d,
      combineAt: { x: cx + (a.x - cx) * cfg.combineBias, y: cy + (a.y - cy) * cfg.combineBias },
      speed: heroBlastPreviewSpeed(), reduced: opts.reduced, attackerEl: side === 'player' ? playerEl : oppEl,
      onImpact: () => useGame.getState().setHeroDmgTaken({ side: side === 'player' ? 'opp' : 'player', amount: total, seq }),
      onDone: () => {
        live = null;
        window.setTimeout(() => { useGame.getState().setHeroDmgTaken(null); useGame.getState().setDuelPreview(false); }, 500 / heroBlastPreviewSpeed());
      },
    });
  }));
}

export const SPEC: TunerSpec<BlastTunerValues> = {
  id: 'heroblast',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Blast',
  note: () => {
    const c = getHeroBlastConfig();
    const p = blastPlan({ values: previewParts(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1000 }, c);
    return `dev · ${heroBlastPreviewSpeed()}x · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroBlastConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroBlastValue(key as keyof HeroBlastConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroBlastValue(key as keyof HeroBlastConfig, value); },
  reset: () => { resetHeroBlastConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_BLAST_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroBlastConfigJson(),
  copyLabel: 'Copy JSON',
  actions: [
    { label: '▶ You blast', hint: 'Your hero blasts the foe for the preview damage.', run: () => demo('player') },
    { label: '▶ Foe blasts', hint: 'The foe blasts your hero for the preview damage.', run: () => demo('opp') },
    { label: '▶ Small (2)', hint: 'Your hero blasts for 2: the smallest volley.', run: () => demo('player', { damage: 2 }) },
    { label: '▶ Big (20)', hint: 'Your hero blasts for 20: the full volley, shake and push.', run: () => demo('player', { damage: 20 }) },
    { label: '▶ Reduced motion', hint: 'What a player with reduced motion on sees: a fade, no flight, bolts, shake or zoom.', run: () => demo('player', { reduced: true }) },
    ...HERO_BLAST_SPEEDS.map((s) => ({
      label: `Speed ${s}x`,
      hint: 'Slow motion for the next plays (the tuner only; never saved, never in production).',
      run: () => { setHeroBlastPreviewSpeed(s); },
    })),
  ],
};

export function HeroBlastTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
