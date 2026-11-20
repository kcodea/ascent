/** The Settings page's building blocks (PhSettings.tsx): a section, and one row per setting (name + note left, control
 *  right). Shared by every tab, the Keybindings tab included (PhSettingsKeybinds.tsx). */
import { useId, type ReactNode } from 'react';

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="phs-sec">
      <header className="phs-sechead"><h2>{title}</h2>{note && <p>{note}</p>}</header>
      <div className="phs-rows">{children}</div>
    </section>
  );
}

export function Row({ label, note, labelId, noteId, children }: { label: string; note?: string; labelId: string; noteId: string; children: ReactNode }) {
  return (
    <div className="phs-row">
      <div className="phs-what">
        <span className="phs-name" id={labelId}>{label}</span>
        {note && <span className="phs-note" id={noteId}>{note}</span>}
      </div>
      <div className="phs-ctl">{children}</div>
    </div>
  );
}

export function InfoRow({ label, note }: { label: string; note?: string }) {
  const id = useId();
  return <Row label={label} note={note} labelId={`${id}l`} noteId={`${id}n`}>{null}</Row>;
}
