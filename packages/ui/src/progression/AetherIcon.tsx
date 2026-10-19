/**
 * THE AETHER ICON (owner art 2026-10-19: "use this as the icon for Aether", the glowing sapphire crystal). Every place
 * the currency is shown — the Collection wallet, the Chest Shop's prices and Buy, the post-game "+N Aether", the
 * Gauntlet reward — draws this picture where a "◆" glyph stood in before.
 *
 * The art is `apps/web/public/currency/aether.webp` (128x128, from the owner's 1254px master, trimmed to its glow and
 * fitted square). Public-folder art carries BASE_URL (itch serves from a CDN sub-path). Decorative: the text beside it
 * always says "Aether" or sits inside an element whose aria-label does, so the image itself is hidden from readers.
 * Sized in `em` by its class, so it scales with the text it sits in.
 */
export const AETHER_ICON_SRC = `${import.meta.env.BASE_URL}currency/aether.webp`;

export function AetherIcon({ className }: { className?: string }): JSX.Element {
  return (
    <img
      className={className ? `aether-icon ${className}` : 'aether-icon'}
      src={AETHER_ICON_SRC}
      alt=""
      aria-hidden="true"
      decoding="sync"
      draggable={false}
    />
  );
}
