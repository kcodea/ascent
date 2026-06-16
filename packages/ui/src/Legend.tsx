import { Icon } from './Icon';

const ITEMS: { icon: string; label: string }[] = [
  { icon: 'taunt', label: 'Taunt' },
  { icon: 'shield', label: 'Divine Shield' },
  { icon: 'poison', label: 'Poison' },
  { icon: 'cleave', label: 'Cleave' },
  { icon: 'sc', label: 'Start of Combat' },
];

export function Legend() {
  return (
    <div className="legend">
      <span className="lt">Keywords</span>
      {ITEMS.map((it) => (
        <span className="li" key={it.label}>
          <Icon name={it.icon} />
          <b>{it.label}</b>
        </span>
      ))}
    </div>
  );
}
