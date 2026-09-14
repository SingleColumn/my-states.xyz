import type { Note } from './types'

/** Acknowledgement is tied to the exact draft written, not just its note id.
 * A failed save or typing during a save must leave the current draft dirty. */
export async function persistNoteSnapshot(
  state: { activeNote: Note | null; dirty: boolean },
  snapshot: Note,
  write: (note: Note) => Promise<unknown>,
) {
  await write(snapshot)
  if (state.activeNote === snapshot) state.dirty = false
}
