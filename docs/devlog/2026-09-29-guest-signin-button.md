# 2026-09-29: Guest "Sign in!" button + the portrait lock

Owner ask (2026-09-29): "add a "sign in!" button that slow flashes/blinks in the top right to the left of the player
icon/name. don't let non-signed in players change the portrait either, they need to sign in for that."
Context: friends-and-family testing; the goal is getting guests to make accounts for account progression. Sibling of
the crate sign-in gate (PR #1855). Oracle R-PROG-GUEST-01.

## What changed

- **"Sign in!" button.** A guest (`account.anonymous`) sees a gold/amber "Sign in!" pill seated just left of the
  portrait ring in the title's account corner, vertically centred on it. Click = `openAccountPanel()` (the existing
  panel, which upgrades the guest in place). It unmounts the moment the store's account flips non-anonymous (the
  identity `onChange` subscription), no reload. Hidden when there is nothing to sign into: no backend
  (`remoteEnabled()` false) or no session (`userId` null), the same "available" rule as the crate gate.
- **The blink.** A real `.guestsignin-glow` span with a STATIC amber ring + halo `box-shadow`; only its `opacity`
  animates (`guestsigninblink`, 0.1 to 1, 2.4 s ease-in-out, infinite). No looping paint property. Reduced motion: no
  animation, the glow sits at 0.6. The button has no `cursor` of its own (the global button rule paints the gauntlet)
  and no `title=`. It is NOT `.pressable`, because that primitive sets `overflow: hidden` (would clip the glow) and owns
  `transform`; the position lives on a `.guestsignin-seat` wrapper so the button's transform stays free for hover.
- **Portrait lock.** The title account corner is the only place the player's portrait (the "avatar", stored as
  `playerAvatar` in localStorage) can be changed: the `.titleportrait` button opened `AvatarPicker`. For a guest it
  now opens `PortraitSignInGate` ("Sign in to change your portrait", Not now / Create account; Esc and click-outside
  close; closes itself when the guest signs in). No backend: "Accounts are unavailable" with OK. `AvatarPicker` also
  refuses to render for a guest, so any other path that sets `avatarPickerOpen` cannot bypass the gate. Signed-in
  players are unchanged. Client-side only, per the owner ("dont need to go crazy with the security protocol").

## Where the identity shows

Only the title screen's account corner carries the portrait + name + rank chip. Career shows hero portraits (not the
player's avatar) and the Collection only shows the name in text, so neither got the button. The `AvatarPicker`
docblock still mentions a "Career profile card" entry point; no such caller exists on main.

## Notes

- The portrait gate reuses the New rewards pop-up shell (`nrw-*`) with its own `pfgate-*` classes, so it does not
  depend on the crate gate's `crgate-*` CSS landing first.
- The chosen portrait is still device-local; the gate copy says it is saved with the account, which is the direction
  of travel, not yet a server column.
- Tests: `packages/ui/src/GuestSignIn.test.tsx` (renders the real `Title` + `AvatarPicker` under jsdom with
  `remoteEnabled` mocked; plus CSS tripwires that the blink keyframes touch only `opacity`, run 2 to 2.5 s, still under
  reduced motion, and that no `.guestsignin` rule sets a cursor).
