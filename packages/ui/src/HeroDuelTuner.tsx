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
  powerX:       ['Power X', 'px'],
  powerY:       ['Power Y', 'px'],
  powerScale:   ['Power size', '×'],
  powerAlpha:   ['Power opacity', '×'],
  pillScale:    ['Foe pill size', '×'],
  pillX:        ['Foe pill X', 'px'],
  pillY:        ['Foe pill Y', 'px'],
  pillPlayerScale: ['Your pill size', '×'],
  pillPlayerX:     ['Your pill X', 'px'],
  pillPlayerY:     ['Your pill Y', 'px'],
  dmgScale:        ['Damage num size', '×'],
  dmgX:            ['Damage num X', 'px'],
  dmgY:            ['Damage num Y', 'px'],
  sfxTravelDelay:  ['Travel SFX offset', 'ms'],
  sfxTravelVol:    ['Travel SFX vol', '×'],
  sfxAddDelay:     ['Pill-add SFX offset', 'ms'],
  sfxAddVol:       ['Pill-add SFX vol', '×'],
  sfxImpactDelay:  ['Impact SFX offset', 'ms'],
  sfxImpactVol:    ['Impact SFX vol', '×'],
  sfxCounterDelay: ['Counter SFX offset', 'ms'],
  sfxCounterVol:   ['Counter SFX vol', '×'],
  runeScale:       ['Rune size', '×'],
  rune1X:          ['Rune 1 X', 'px'],
  rune1Y:          ['Rune 1 Y', 'px'],
  rune2X:          ['Rune 2 X', 'px'],
  rune2Y:          ['Rune 2 Y', 'px'],
  rune3X:          ['Rune 3 X', 'px'],
  rune3Y:          ['Rune 3 Y', 'px'],
  runeX:           ['Rune row X', 'px'],
  runeY:           ['Rune row Y', 'px'],
  runeGap:         ['Rune gap', 'px'],
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
  powerX: 'Foe hero power', powerY: 'Foe hero power', powerScale: 'Foe hero power', powerAlpha: 'Foe hero power',
  pillScale: 'Foe attack pill', pillX: 'Foe attack pill', pillY: 'Foe attack pill',
  pillPlayerScale: 'Your attack pill', pillPlayerX: 'Your attack pill', pillPlayerY: 'Your attack pill',
  dmgScale: 'Damage number', dmgX: 'Damage number', dmgY: 'Damage number',
  sfxTravelDelay: 'Sound', sfxTravelVol: 'Sound', sfxAddDelay: 'Sound', sfxAddVol: 'Sound', sfxImpactDelay: 'Sound', sfxImpactVol: 'Sound', sfxCounterDelay: 'Sound', sfxCounterVol: 'Sound',
  runeScale: 'Opponent runes', runeX: 'Opponent runes', runeY: 'Opponent runes', runeGap: 'Opponent runes',
  rune1X: 'Opponent runes', rune1Y: 'Opponent runes', rune2X: 'Opponent runes', rune2Y: 'Opponent runes', rune3X: 'Opponent runes', rune3Y: 'Opponent runes',
  tallyStagger: 'Sequence', tallyFly: 'Sequence', pillHold: 'Sequence',
  strikeSpeed: 'Strike', impactPower: 'Strike', settleMs: 'Strike',
};
const ORDER: (keyof HeroDuelConfig)[] = [
  'oppScale', 'oppX', 'oppY',
  'nameScale', 'nameX', 'nameY',
  'hpScale', 'hpX', 'hpY',
  'pillScale', 'pillX', 'pillY',
  'pillPlayerScale', 'pillPlayerX', 'pillPlayerY',
  'dmgScale', 'dmgX', 'dmgY',
  'tallyStagger', 'tallyFly', 'pillHold',
  'strikeSpeed', 'impactPower', 'settleMs',
  'sfxCounterDelay', 'sfxCounterVol', 'sfxTravelDelay', 'sfxTravelVol', 'sfxAddDelay', 'sfxAddVol', 'sfxImpactDelay', 'sfxImpactVol',
  'runeScale', 'runeX', 'runeY', 'runeGap',
];
// Safety net: any config key not in ORDER is appended, so a newly-added dial can never silently fail to render.
const ORDERED: (keyof HeroDuelConfig)[] = [
  ...ORDER,
  ...(Object.keys(HERO_DUEL_DEFAULTS) as (keyof HeroDuelConfig)[]).filter((k) => !ORDER.includes(k)),
];

const controls: TunerControl<Extract<keyof HeroDuelConfig, string>>[] = ORDERED.map((key) => {
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
    const playerEl = document.querySelector('.statusbar .hero .herolunge');
    const oppEl = document.querySelector('.combatopp-body');
    if (!playerEl || !oppEl) { st.setDuelPreview(false); return; }
    const dmg = 7; // a representative blow — the pill and the impact both read off it
    st.setHeroAtkPill({ side, amount: dmg });
    const attacker = side === 'player' ? playerEl : oppEl;
    const defender = side === 'player' ? oppEl : playerEl;
    const appEl = document.body; // .app and .statusbar are siblings — body reaches both (see styles.css)
    const zClass = side === 'player' ? 'duel-attacker-player' : 'duel-attacker-opp';
    window.setTimeout(() => {
      const done = (): void => {
        appEl?.classList.remove(zClass, 'duel-striking');
        useGame.getState().setHeroAtkPill(null);
        useGame.getState().setHeroDmgTaken(null);
        useGame.getState().setDuelPreview(false);
      };
      appEl?.classList.add(zClass, 'duel-striking'); // raise the attacker + fade the pills for the swing
      const tl = playHeroStrike({
        attacker, defender, damage: dmg * cfg.impactPower, combatSpeed: cfg.strikeSpeed,
        // Pop the RED damage-taken number on the DEFENDER (the side not attacking), same as a real strike.
        onImpact: () => useGame.getState().setHeroDmgTaken({ side: side === 'player' ? 'opp' : 'player', amount: dmg, seq: Date.now() }),
      });
      // Retire on the swing's ACTUAL completion, plus the tuner's settle — a guessed timeout can fire mid-swing
      // and yank the foe portrait out from under the blow (seen while wiring this). CHAIN onto the timeline's
      // existing onComplete (playLunge's cleanup — clearProps transform/zIndex — lives there); replacing it
      // left the attacker at inline z-index 12, painted over its own name/health after settling.
      if (tl) {
        const lungeDone = tl.eventCallback('onComplete');
        tl.eventCallback('onComplete', () => { lungeDone?.(); window.setTimeout(done, cfg.settleMs); });
      } else done();
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
