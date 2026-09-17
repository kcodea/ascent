import {
  DICE_TEST_EVENT, DICEROLL_DEFAULTS, DICEROLL_RANGES, getDiceRollConfig, resetDiceRollConfig, setDiceRollValue, type DiceRollConfig,
} from './diceRollConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the DICE ROLL — the top-down 3D die the Gambler's power lands on the power button and
 * the Gamble spell lands at the cast point (`DiceRoll.tsx`). The four handoff knobs (tumble time, hop height,
 * spin count, settle bounce) plus the spell's own quicker preset. Edits apply to the NEXT roll.
 *
 * ▶ Test fires a spell-variant die at the screen centre through `Recruit`'s dev listener, cycling the face
 * 1→6 on each press, so every face can be checked without a Gamble in hand.
 */
const SPECS: Record<keyof DiceRollConfig, [string, TunerUnit | undefined, string, string]> = {
  tumbleTime:      ['Tumble time', 'ms', "The Gambler's whole roll, first lift to final settle.", 'Gambler (power)'],
  spinCount:       ['Spins', undefined, 'Full turns the die makes on its way to the face (the other axis gets one more).', 'Gambler (power)'],
  spellTumbleTime: ['Tumble time', 'ms', "The Gamble spell's roll — quicker, since a card is being held back until it lands. Floor 600.", 'Gamble (spell)'],
  spellSpinCount:  ['Spins', undefined, "The spell's full turns. Floor 1.", 'Gamble (spell)'],
  hopHeight:       ['Hop height', 'px', 'How far the die lifts toward the camera on its first hop. 0 = it rolls flat.', 'Shared'],
  settleBounce:    ['Settle bounce', undefined, 'The second hop as a fraction of the first, and how far the rotation overshoots before rocking back.', 'Shared'],
};

const ORDER: (keyof DiceRollConfig)[] = ['tumbleTime', 'spinCount', 'spellTumbleTime', 'spellSpinCount', 'hopHeight', 'settleBounce'];

const controls: TunerControl<Extract<keyof DiceRollConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = DICEROLL_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

let testFace = 0;

export const SPEC: TunerSpec<DiceRollConfig> = {
  id: 'diceroll',                   // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Dice',
  note: 'dev · next roll · drag',
  read: getDiceRollConfig,
  write: setDiceRollValue,
  reset: resetDiceRollConfig,
  defaults: DICEROLL_DEFAULTS,
  controls,
  actions: [{
    label: '▶ Test',
    hint: 'Rolls a die at the screen centre, cycling the face 1→6 each press (spell tint).',
    run: () => {
      testFace = (testFace % 6) + 1;
      window.dispatchEvent(new CustomEvent(DICE_TEST_EVENT, { detail: { face: testFace } }));
    },
  }],
};

export function DiceRollTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
