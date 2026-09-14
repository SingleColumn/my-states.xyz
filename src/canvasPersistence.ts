import type { TLStore } from 'tldraw'

/** Store.listen waits for an animation frame. Hidden tabs may never deliver
 * one, including when commands or lookups change a document already hidden.
 * Observe completed atomic operations and snapshot after the transaction,
 * coalescing synchronous changes without depending on a frame or timer. */
export function registerHiddenCanvasPersistence(
  store: TLStore,
  shouldSave: () => boolean,
  save: () => void,
) {
  let pending = false
  let disposed = false
  const unregister = store.sideEffects.registerOperationCompleteHandler(() => {
    if (pending || !shouldSave()) return
    pending = true
    queueMicrotask(() => {
      pending = false
      if (!disposed && shouldSave()) save()
    })
  })
  return () => { disposed = true; unregister() }
}
