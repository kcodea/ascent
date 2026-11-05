# The party home is the production UI

Owner 2026-11-05: make it THE production UI. Netlify is retired; Mike bakes the desktop exe from main.

- `partyHomeOn()` is true in every production build, with no way off. DEV clients default on and can turn it off from the
  DEV menu to compare. Unit tests stay off unless they ask, so the old screens' tests still read the old screens.
- Every shell piece lost its `import.meta.env.DEV ? ... : null` gate. `partyHomeProduction.test.ts` stops one coming back.
- The flow bundle used to define `DEV: true`, so flow runs before this never exercised production paths. It is now a true
  production build. Sample party, the Practice set picker and the dev nav button stay DEV-only on purpose.
- The old menu code is still there, unreachable in production. Removing it is cleanup, not part of this change.
