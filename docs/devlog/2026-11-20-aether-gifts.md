# 2026-11-20 — Aether gifts with a login pop-up

**Ask (owner):** after hand-gifting Arivas 1,000 Aether through `aether_apply` in the SQL Editor: "this will likely be
something we do for others going forward. i would like upon them logging in, to recieve a prompt. it should say,
you've been gifted XXX Aether from the Ascent team for: and then you will prompt me to explain what it is for, then
fill it in for me" (R-PROG-GIFT-02).

**Shipped:**
- `supabase/migrations/2026-11-22-aether-gifts.sql`: the `aether_gifts` table (owner-read), the admin-only
  `aether_gift(name, tag, amount, reason)` (finds exactly one signed-in account, pays through `aether_apply` with
  source `gift:<id>`, moves the progression revision) and the player's `ack_aether_gift(id)`.
- `AetherGiftNotice.tsx`: one pop-up per unseen gift on the menus, in the "Introducing Aether" window; it waits
  while the cosmetic gift notice (R-PROG-GIFT-01) is open.
- `.claude/skills/ascent-gift-aether`: Claude asks what the gift is for, writes the reason, and hands the owner one
  SQL line to run.

**Owner choices:** one pop-up per gift (not combined); Arivas's earlier gift gets no pop-up.

**Apply order:** run the migration in the Supabase SQL Editor before using `aether_gift`. Older clients ignore the
table (the Aether still lands, there is just no pop-up).
