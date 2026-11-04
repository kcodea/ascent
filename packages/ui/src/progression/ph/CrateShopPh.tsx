/**
 * THE CHEST SHOP, IN THE PARTY HOME SHELL (DEV only, behind the "Party home (prototype)" switch). Valorant's store is the
 * model: the page title and your wallet up top, the offers as one row of big cards, then the details and one gold buy.
 *
 * The SAME shop as `CrateShop.tsx`: every price, quote, rule (guests, never charged twice, Esc) and handler comes from its
 * `useCrateShop` state; this file only draws it. The chest cards, the focus rows and the odds slices are the shop's own
 * components, so every pick and toggle celebration (`chestShopFx.ts`) and every tip plays exactly as before; the shell's
 * stylesheet only re-skins the chrome around them. The chest opening (the theatre) is untouched.
 */
import { useEffect, useRef, useState } from 'react';
import { CRATE_TIERS, COSMETIC_CATEGORY_DEFS } from '@game/progression';
import { setCratesView, usePhShell } from '../../partyHome/shell/shellStore';
import { sfx } from '../../sfx';
import { probeProgression } from '../progressionStore';
import { PhButton, PhEmpty, PhPage, PhSection } from '../../partyHome/kit';
import { AetherIcon } from '../AetherIcon';
import { Amount, ChestCard, FocusRow, OddsSeg, type CrateShopState } from '../CrateShop';
import { LockGlyph } from '../CollectionScreen';
import './collectionPh.css';
import './crateShopPh.css';

/** The nav's Crates tab is lit while a Crates view is up, however it was reached. A nav press that leaves Crates for the
 *  Collection stays on this same page, so the view steps back by itself. */
function useCratesLit(leave: () => void): void {
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    setCratesView(true);
    const off = usePhShell.subscribe((st, prev) => { if (prev.crates && !st.crates) leaveRef.current(); });
    return () => { off(); setCratesView(false); };
  }, []);
}

/** Crates asked for while the shop cannot be reached (offline, or the server has it off): say so plainly, with a Retry. */
export function CratesOfflinePh({ onBack }: { onBack: () => void }): JSX.Element {
  useCratesLit(onBack);
  const [checking, setChecking] = useState(false);
  const retry = (): void => { sfx.pulse(); setChecking(true); void probeProgression().finally(() => setChecking(false)); };
  return (
    <section className="cshop phs cshop-still" aria-label="Crates">
      <PhPage wide className="phs-page" eyebrow="Collection" title="Crates" back={{ label: 'Collection', onClick: () => { sfx.pulse(); onBack(); } }}>
        <PhSection className="phs-offline">
          <PhEmpty
            title="Crates are unavailable right now" sub="Check your connection and try again."
            action={<PhButton variant="plate" size="m" disabled={checking} onClick={retry}>{checking ? 'Checking' : 'Retry'}</PhButton>}
          />
        </PhSection>
      </PhPage>
    </section>
  );
}

export function CrateShopPh({ shop: s }: { shop: CrateShopState }): JSX.Element {
  useCratesLit(s.back);
  // A GUEST's button stays live (owner ruling 2026-10-19: it opens the sign-in prompt), but it reads as what it does:
  // the outlined plate, a padlock and "Sign in to open", never the gold buy.
  const guestBuy = s.guest && !s.busy && !!s.quote;
  const buyLabel = s.busy ? 'Buying…'
    : !s.quote ? 'Sold out'
    : s.needMore > 0 ? `Need ${s.needMore} more Aether`
    : null;
  return (
    <section className={`cshop phs${s.still ? ' cshop-still' : ''}`} aria-label="Crates">
      <PhPage
        wide
        className="phs-page"
        eyebrow="Collection"
        title="Crates"
        back={{ label: 'Collection', onClick: s.back }}
      >
        <PhSection title="Pick a chest" className="phs-pick" unclipped>
          <div className="cshop-chests" role="group" aria-label="Chest">
            {CRATE_TIERS.map((t) => <ChestCard key={t} tier={t} price={s.economy.cratePrice[t]} on={s.tier === t} reduced={s.still} locked={s.busy} onPick={s.pickTier} />)}
          </div>
        </PhSection>

        <div className="phs-lower">
          <PhSection title="Focus" aside="The more categories you select, the cheaper the fee." className="phs-focus">
            <div className="cshop-cats" role="group" aria-label="Focus">
              <div className="cshop-cat cshop-cat-head" aria-hidden="true"><span>Category</span><span>Left to find</span></div>
              {s.cats.map((c) => (
                <FocusRow key={c} cat={c} left={s.left.get(c) ?? 0} on={s.ticked.has(c) && s.available.has(c)} soldOut={!s.available.has(c)} reduced={s.still} locked={s.busy} onToggle={s.toggle} />
              ))}
            </div>
          </PhSection>

          <PhSection title="Your chest" className="phs-checkout" unclipped>
            <div className="cshop-receipt">
              <div className="cshop-line"><span className="cshop-what">{s.tierLabel} Chest</span><span className="cshop-dots" /><Amount value={s.price} /></div>
              {s.receipt && (
                <>
                  <div className="cshop-line cshop-fee"><span className="cshop-what">Focusing</span></div>
                  <div className="cshop-subs">
                    {s.receipt.rows.map((r, i) => (
                      <div key={r.category} className="cshop-sub">
                        <span className="cshop-what">{COSMETIC_CATEGORY_DEFS[r.category].label}</span><span className="cshop-dots" /><Amount value={r.amount} cost={i === 0} />
                      </div>
                    ))}
                  </div>
                  {s.receipt.noFocus && <div className="cshop-allnote">Everything ticked: no focus, so any category can drop, Announcers too.</div>}
                </>
              )}
              <div className="cshop-line cshop-total"><span className="cshop-what">Total</span><span className="cshop-dots" /><Amount value={s.quote?.total ?? s.price} /></div>
            </div>
            <div className="cshop-odds">
              <h4>Odds</h4>
              <div className="cshop-bars" role="group" aria-label="Odds">
                {s.slices.map((sl) => <OddsSeg key={sl.rarity} slice={sl} />)}
              </div>
            </div>
            <div className="phs-buywrap">
              <PhButton
                variant={guestBuy ? 'plate' : 'primary'} size="l" className={`phs-buy${guestBuy ? ' guest' : ''}`} disabled={s.disabled} aria-busy={s.busy || undefined}
                aria-label={s.ariaLabel} onClick={() => { void s.spend(); }}
              >
                {guestBuy ? <><LockGlyph />Sign in to open<span className="phs-buy-total"><AetherIcon />{s.quote!.total}</span></>
                  : buyLabel ?? <>Open chest<span className="phs-buy-total"><AetherIcon />{s.quote!.total}</span></>}
              </PhButton>
              {guestBuy && <p className="phs-note">Chests are bought with an account. It is free.</p>}
              {s.error && <p className="phs-err" role="alert">{s.error}</p>}
            </div>
          </PhSection>
        </div>
      </PhPage>
    </section>
  );
}
