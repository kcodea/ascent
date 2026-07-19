# Set 2 cards

New cards for set 2 go in this directory, one file per tribe (`beasts.ts`, `mechs.ts`, …), mirroring
`../set1/`. Keeping them here — rather than appending to set 1's tribe files — is what lets both sets be
authored at once without merge conflicts, and what guarantees that adding a set-2 card cannot perturb set 1's
seeds.

Wiring a new file up:

```ts
// packages/content/src/cards/set2/beasts.ts
import type { CardDef } from '@game/core';
export const SET2_BEASTS: CardDef[] = [ /* … */ ];
```

```ts
// packages/content/src/sets.ts
import { SET2_BEASTS } from './cards/set2/beasts';

set2: {
  …,
  own: [...SET2_BEASTS],
},
```

**Set 2 starts empty**, so every card it contains is one you opted in via `own`. To reuse a set-1 card, either
list it in `own` directly (import it from `../set1/…`) or add `inherits: 'set1'` + `excludes` if the overlap
turns out to be most of the set. A card that appears in both sets is ONE definition (owner ruling): balancing
it changes both.

While `own` is empty, `SET=set2 npm run pool` will refuse with a clear error, and enabling set 2 will fail
`sets.test.ts` — both deliberate, so a half-built set can't ship.

See [`docs/card-sets.md`](../../../../../docs/card-sets.md) for the full contract, and **read the determinism
section before reordering anything**.
