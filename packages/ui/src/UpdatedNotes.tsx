import { PatchNotesBody } from './PatchNotesBody';
import { PATCH_NOTES } from './patchNotes';
import { notesSince } from './updateNotes';

/** The panel's list: the shared patch-notes body over only what shipped since `since`. Its own chunk (it pulls the
 *  changelog text), loaded lazily by `UpdatedPanel`. */
export default function UpdatedNotes({ since }: { since: string | null }) {
  return <PatchNotesBody notes={notesSince(PATCH_NOTES, since)} />;
}
