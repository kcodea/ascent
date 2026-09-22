# Thymepiece: Amplified doubles the window; the countdown sits above the slot and nudges nothing

**Date:** 2026-09-22 · **Branch:** `feat/thymepiece-amplified-readout` · **Owner asks:** "make timepiece's buff
show above the equipment instead of below, and dont let it nudge anything on the screen at all" · "an amplified
timepiece should double the duration".

## Amplified

An Amplified activation fires its effect twice. For the Thymepiece that used to mean nothing: the factory
replaced an open window with the fresher, larger one, and the second trigger computed the same 8-second window
as the first. Now the reducer, which already knows the activation is Amplified, passes that down
(`fireEquipmentTriggers(..., amplified)` → `payload.amplified`) and the factory doubles the window whenever it
is set; both triggers open the same 16-second window and the existing replace-if-later rule keeps it. At clock
40 it closes at 24. The amount is not multiplied (−1 for 16 seconds, never −2), with no clock reading the
window still runs to the end of the turn, and an extra trigger from any other source keeps the pinned 8
seconds ("a rate, not a bank", `set3Dwarves.test.ts`) — only Amplified doubles, which is what was asked. A
first cut lengthened per trigger and tripped that pin.

The rule the slot prints follows the live-value rule: `equipmentText(def, version, { amplified })` doubles a
`**N seconds**` span while the Equipment will fire twice, so the tooltip reads "for the next **16 seconds**"
with the stack armed and "8 seconds" once it is spent. Only a printed seconds span is touched.

## The readout

`.equipslot .hplabel.discountwin` was a flow child under the name pill. The slot is a `translate(-50%, -50%)`-
centred flex column, so the pill's appearance grew the column and shifted the button and the name by half its
height, then shifted them back when it expired. It is now `position: absolute`, anchored to the slot's top
edge (`bottom: calc(100% + 16u)`, centred, `pointer-events: none`), so it adds no height anywhere; the 16u gap
clears the cost coin, which protrudes 14u above the button. It overrides the name pill's tuner transform on
purpose.

Not verified live in the browser: the position was reasoned from the slot's box model; a Thymepiece needs a
Dwarf roster run to reach.

## Oracle

`R-EQUIP-01`; enforced by `packages/sim/src/thymepiece.test.ts`.
