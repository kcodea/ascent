/** `npm run balance:packages [-- set2 set3]` — the B4 strategy-package census: package → members (engines / payoffs),
 *  key cards, affine runes, affine heroes, economy profile, risk, and an explicit supported / thin / unsupported label. */
import { renderPackageCensus } from '@game/sim/balance/strategy/packages';
import type { SetId } from '@game/content';

const sets = (process.argv.slice(2).filter((a) => /^set\d$/.test(a)) as SetId[]);
for (const setId of sets.length ? sets : (['set2'] as SetId[])) {
  console.log(renderPackageCensus(setId));
  console.log('');
}
