import { CARD_INDEX } from '@game/content';
import { getHero } from '@game/sim';
import { AVATAR_ART, type AvatarArt } from './art';
import { useGame } from './store';

/** Section headers, in display order. Minions carry tokens (they're minion-pool art). */
const KINDS: { kind: AvatarArt['kind']; label: string }[] = [
  { kind: 'hero', label: 'Heroes' },
  { kind: 'minion', label: 'Minions & Tokens' },
  { kind: 'power', label: 'Hero Powers' },
];

/** A human name for an avatar tile — card name for minions, hero name for heroes/powers. */
function nameOf(a: AvatarArt): string {
  if (a.kind === 'minion') return CARD_INDEX[a.key]?.name ?? a.key;
  const name = getHero(a.key).name;
  return a.kind === 'power' ? `${name} — Power` : name;
}

/**
 * Avatar picker overlay — choose any bundled hero / minion / token / power art as your profile avatar.
 * Openable from the Title account chip and the Career profile card (a single `avatarPickerOpen` store flag).
 * Cosmetic + local; the choice persists via `setPlayerAvatar`.
 */
export function AvatarPicker() {
  const open = useGame((s) => s.avatarPickerOpen);
  const close = useGame((s) => s.closeAvatarPicker);
  const current = useGame((s) => s.playerAvatar);
  const setAvatar = useGame((s) => s.setPlayerAvatar);
  // The picker is only reachable from the Title chip + Career profile card, so it must only ever render on
  // those surfaces — never over gameplay (a defensive gate so a lingering flag can't cover the game).
  const onTitle = useGame((s) => s.showTitle);
  const onCareer = useGame((s) => s.showCareer);
  if (!open || !(onTitle || onCareer)) return null;
  const pick = (id: string | null): void => { setAvatar(id); close(); };
  return (
    <div className="avatarpick" role="dialog" aria-label="Choose your avatar" onClick={close}>
      <div className="avatarpick-panel" onClick={(e) => e.stopPropagation()}>
        <div className="avatarpick-head">
          <span className="avatarpick-title">Choose your avatar</span>
          <button className="avatarpick-close" onClick={close} aria-label="Close">✕</button>
        </div>
        <div className="avatarpick-scroll">
          <div className="avatarpick-group">
            <div className="avatarpick-grouplabel">Default</div>
            <div className="avatarpick-grid">
              <button className={`avatarpick-opt default${!current ? ' active' : ''}`} title="Default (initial)" onClick={() => pick(null)}>
                <span className="avatarpick-default">—</span>
              </button>
            </div>
          </div>
          {KINDS.map(({ kind, label }) => {
            const rows = AVATAR_ART.filter((a) => a.kind === kind);
            if (rows.length === 0) return null;
            return (
              <div key={kind} className="avatarpick-group">
                <div className="avatarpick-grouplabel">{label}</div>
                <div className="avatarpick-grid">
                  {rows.map((a) => (
                    <button key={a.id} className={`avatarpick-opt${current === a.id ? ' active' : ''}`} title={nameOf(a)} onClick={() => pick(a.id)}>
                      <img src={a.src} alt={nameOf(a)} draggable={false} loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
