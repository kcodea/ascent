import { PatchNotesBody, notesForTab } from './PatchNotesBody';
import { PATCH_CATEGORY_ORDER, PATCH_NOTES } from './patchNotes';
import { notesSince } from './updateNotes';

/** The panel's list: the shared patch-notes body over only what shipped since `since`. Opens on the first tab that has
 *  entries (an update with only Systems changes must not open on an empty Game tab). Its own chunk (it pulls the
 *  changelog text), loaded lazily by `UpdatedPanel`. */
export default function UpdatedNotes({ since }: { since: string | null }) {
  const notes = notesSince(PATCH_NOTES, since);
  const initialTab = PATCH_CATEGORY_ORDER.find((t) => notesForTab(t, notes).length > 0);
  return <PatchNotesBody notes={notes} initialTab={initialTab} />;
}
