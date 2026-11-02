/**
 * THE CHEST SHOP, IN THE PARTY HOME SHELL (DEV only, behind the "Party home (prototype)" switch). Valorant's store is the
 * model: the page title and your wallet up top, the offers as one row of big cards, then the details and one gold buy.
 *
 * The SAME shop as `CrateShop.tsx`: every price, quote, rule (guests, never charged twice, Esc) and handler comes from its
 * `useCrateShop` state; this file only draws it. The chest cards, the focus rows and the odds slices are the shop's own
 * components, so every pick and toggle celebration (`chestShopFx.ts`) and every tip plays exactly as before; the shell's
 * stylesheet only re-skins the chrome around them. The chest opening (the theatre) is untouched.
 */
import { CRATE_TIERS, COSMETIC_CATEGORY_DEFS } from '@game/progression';
import { PhButton, PhPage, PhSection } from '../../partyHome/kit';
import { touchText } from '../../touchInput';
import { AetherIcon } from '../AetherIcon';
import { Amount, ChestCard, FocusRow, OddsSeg, type CrateShopState } from '../CrateShop';
import './collectionPh.css';
import './crateShopPh.css';

export function CrateShopPh({ shop: s }: { shop: CrateShopState }): JSX.Element {
  const buyLabel = s.busy ? 'Buying…'
    : !s.quote ? 'Sold out'
    : s.needMore > 0 ? `Need ${s.needMore} more Aether`
    : null;
  return (
    <section className={`cshop phs${s.still ? ' cshop-still' : ''}`} aria-label="Chest Shop">
      <PhPage
        wide
        className="phs-page"
        eyebrow="Collection"
        title="Chest Shop"
        back={{ label: 'Collection', onClick: s.back }}
        actions={(
          <>
            <span className="phs-wallet" role="group" aria-label="Aether balance">
              <AetherIcon className="phs-wallet-gem" /><b>{s.balance}</b><small>Aether</small>
            </span>
          </>
        )}
      >
        <PhSection title="Pick a chest" aside={touchText('Hover a chest for its odds', 'Tap a chest for its odds')} className="phs-pick">
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

          <PhSection title="Your chest" className="phs-checkout">
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
                variant="primary" size="l" className="phs-buy" disabled={s.disabled} aria-busy={s.busy || undefined}
                aria-label={s.ariaLabel} onClick={() => { void s.spend(); }}
              >
                {buyLabel ?? <>Open chest<span className="phs-buy-total"><AetherIcon />{s.quote!.total}</span></>}
              </PhButton>
              {s.error && <p className="phs-err" role="alert">{s.error}</p>}
            </div>
          </PhSection>
        </div>
      </PhPage>
    </section>
  );
}
