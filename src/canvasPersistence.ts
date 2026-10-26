import type { RecordsDiff, TLRecord, TLStore } from 'tldraw'

/** What a board keeps: every document record (shapes, pages, bindings,
 * assets, the document itself) plus the camera. The camera is session-scoped
 * in tldraw, but a board reopens where it was left, so its moves count.
 * Hover, cursor, selection and the read-only flag live on the other session
 * records (`instance`, `instance_page_state`, `pointer`) and are not part of
 * a board; a change to only those must not write the board again. */
export function isBoardRecordType(store: TLStore, typeName: TLRecord['typeName']): boolean {
  return typeName === 'camera' || store.scopedTypes.document.has(typeName)
}

/** What the store has told the saver since the page loaded. Diagnostic only:
 * the Developer panel report shows it so "hover and selection do not write
 * the board" can be seen to hold, not just trusted. */
export const saveActivity = { storeUpdates: 0, boardUpdates: 0, writes: 0 }

export function diffChangesBoard(store: TLStore, diff: RecordsDiff<TLRecord>): boolean {
  const touches = (records: Record<string, TLRecord>) =>
    Object.values(records).some((record) => isBoardRecordType(store, record.typeName))
  return touches(diff.added)
    || touches(diff.removed)
    || Object.values(diff.updated).some(([, next]) => isBoardRecordType(store, next.typeName))
}

/** Store.listen waits for an animation frame. Hidden tabs may never deliver
 * one, including when commands or lookups change a document already hidden.
 * Observe completed atomic operations and snapshot after the transaction,
 * coalescing synchronous changes without depending on a frame or timer.
 * The operation-complete handler carries no diff, so the record types the
 * board keeps mark the operation as one worth saving as they change. */
export function registerHiddenCanvasPersistence(
  store: TLStore,
  shouldSave: () => boolean,
  save: () => void,
) {
  let changed = false
  let pending = false
  let disposed = false
  const markChanged = () => { changed = true }
  const unregisterChanges = (Object.keys(store.schema.types) as TLRecord['typeName'][])
    .filter((typeName) => isBoardRecordType(store, typeName))
    .flatMap((typeName) => [
      store.sideEffects.registerAfterCreateHandler(typeName, markChanged),
      store.sideEffects.registerAfterChangeHandler(typeName, markChanged),
      store.sideEffects.registerAfterDeleteHandler(typeName, markChanged),
    ])
  const unregister = store.sideEffects.registerOperationCompleteHandler(() => {
    const touchedBoard = changed
    changed = false
    if (!touchedBoard || pending || !shouldSave()) return
    pending = true
    queueMicrotask(() => {
      pending = false
      if (!disposed && shouldSave()) save()
    })
  })
  return () => {
    disposed = true
    unregister()
    unregisterChanges.forEach((unregisterChange) => unregisterChange())
  }
}
