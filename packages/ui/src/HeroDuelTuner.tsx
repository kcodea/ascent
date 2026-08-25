import {
  HERO_DUEL_DEFAULTS, HERO_DUEL_DESC, HERO_DUEL_RANGES,
  getHeroDuelConfig, resetHeroDuelConfig, setHeroDuelValue, type HeroDuelConfig,
} from './heroDuelConfig';
import { playHeroStrike } from './choreo/heroStrike';
import { useGame } from './store';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the HERO DUEL — the post-combat sequence (tally → attack pill → wind-up → lunge → impact).
 *
 * The two Test buttons play the real thing: they mount the foe portrait (via `duelPreview`, so it works from
 * the shop), put the pill on the striking hero, and run the SAME `playHeroStrike` the sequence runs — so what
 * you tune here is what you see in a fight.
 *
 * The lunge's own curve lives in the 🗡️ Lunge tuner and its impact FX in the workbench defs; the hero strike
 * goes through those channels deliberately, so they are tuned there rather than duplicated here.
 */
const LABELS: Record<keyof HeroDuelConfig, [string, TunerUnit | undefined]> = {
  oppScale:     ['Portrait size', '×'],
  oppX:         ['Portrait X', 'px'],
  oppY:         ['Portrait Y', 'px'],
  nameScale:    ['Name size', '×'],
  nameX:        ['Name X', 'px'],
  nameY:        ['Name Y', 'px'],
  hpScale:      ['Health size', '×'],
  hpX:          ['Health X', 'px'],
  hpY:          ['Health Y', 'px'],
  pillScale:    ['Pill size', '×'],
  pillX:        ['Pill X', 'px'],
  pillY:        ['Pill Y', 'px'],
  tallyStagger: ['Tally stagger', 'ms'],
  tallyFly:     ['Tally flight', 'ms'],
  pillHold:     ['Pill hold', 'ms'],
  strikeSpeed:  ['Swing speed', '×'],
  impactPower:  ['Impact power', '×'],
  settleMs:     ['Settle', 'ms'],
};
const GROUP: Record<keyof HeroDuelConfig, string> = {
  oppScale: 'Opponent portrait', oppX: 'Opponent portrait', oppY: 'Opponent portrait',
  nameScale: 'Foe name plate', nameX: 'Foe name plate', nameY: 'Foe name plate',
  hpScale: 'Foe health pill', hpX: 'Foe health pill', hpY: 'Foe health pill',
  pillScale: 'Attack pill', pillX: 'Attack pill', pillY: 'Attack pill',
  tallyStagger: 'Sequence', tallyFly: 'Sequence', pillHold: 'Sequence',
  strikeSpeed: 'Strike', impactPower: 'Strike', settleMs: 'Strike',
};
const ORDER: (keyof HeroDuelConfig)[] = [
  'oppScale', 'oppX', 'oppY',
  'nameScale', 'nameX', 'nameY',
  'hpScale', 'hpX', 'hpY',
  'pillScale', 'pillX', 'pillY',
  'tallyStagger', 'tallyFly', 'pillHold',
  'strikeSpeed', 'impactPower', 'settleMs',
];

const controls: TunerControl<Extract<keyof HeroDuelConfig, string>>[] = ORDER.map((key) => {
  const [label, unit] = LABELS[key];
  const [min, max, step] = HERO_DUEL_RANGES[key];
  return { key, label, unit, hint: HERO_DUEL_DESC[key], group: GROUP[key], min, max, step };
});

/** Play the real strike between the two hero portraits, mounting the foe first if we are not in a fight. */
function demo(side: 'player' | 'opp'): void {
  const st = useGame.getState();
  st.setDuelPreview(true);
  // Next frame, so the portrait has mounted and can be measured.
  requestAnimationFrame(() => {
    const cfg = getHeroDuelConfig();
    const playerEl = document.querySelector('.statusbar .hero .f');
    const oppEl = document.querySelector('.combatopp-body');
    if (!playerEl || !oppEl) { st.setDuelPreview(false); return; }
    const dmg = 7; // a representative blow — the pill and the impact both read off it
    st.setHeroAtkPill({ side, amount: dmg });
    const attacker = side === 'player' ? playerEl : oppEl;
    const defender = side === 'player' ? oppEl : playerEl;
    window.setTimeout(() => {
      const done = (): void => {
        useGame.getState().setHeroAtkPill(null);
        useGame.getState().setDuelPreview(false);
      };
      const tl = playHeroStrike({
        attacker, defender, damage: dmg * cfg.impactPower, combatSpeed: cfg.strikeSpeed,
        onImpact: () => { /* the struck portrait deliberately does not react — see styles.css */ },
      });
      // Retire on the swing's ACTUAL completion, plus the tuner's settle — a guessed timeout can fire mid-swing
      // and yank the foe portrait out from under the blow (seen while wiring this).
      if (tl) tl.eventCallback('onComplete', () => window.setTimeout(done, cfg.settleMs));
      else done();
    }, cfg.pillHold);
  });
}

export const SPEC: TunerSpec<HeroDuelConfig> = {
  id: 'heroduel',                    // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Hero Duel',
  note: 'dev · post-combat strike',
  read: getHeroDuelConfig,
  write: (key, value) => setHeroDuelValue(key, value),
  reset: resetHeroDuelConfig,
  defaults: HERO_DUEL_DEFAULTS,
  controls,
  actions: [
    { label: 'Test — your hero strikes', hint: 'Plays the full swing from your portrait at the foe.', run: () => demo('player') },
    { label: 'Test — foe strikes', hint: 'Plays the full swing from the foe at your portrait.', run: () => demo('opp') },
  ],
};

export function HeroDuelTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
