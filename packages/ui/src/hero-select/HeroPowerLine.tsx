import { mdBold } from '../Card';

/** A hero's power line on its card and on the ceremony's clone (the name, the cost callout, the text, the unlock turn). */
export function HeroPowerLine({ power }: { power: { name: string; text: string; cost?: number; passive?: boolean; unlockWave?: number } }) {
  return (
    <>
      {/* Power cost callout (owner ask 2026-09-01): actives show their Gold cost, a free active says Free; a PASSIVE is
          never cast, so a cost line would mislead: it says Passive instead. */}
      <b>{power.name}</b>{' '}
      <span className="hccost">{power.passive ? '(Passive)' : `(Cost: ${power.cost ? power.cost : 'Free'})`}</span>
      {' '}· <span dangerouslySetInnerHTML={{ __html: mdBold(power.text) }} />
      {power.unlockWave && power.unlockWave > 1 && <span className="hclock">Unlocks turn {power.unlockWave}</span>}
    </>
  );
}
