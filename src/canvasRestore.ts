import { T, createTLStore, type Editor, type TLStore } from 'tldraw'
import type { Moment } from './types'

/** Preflight in a detached store, never in editor.run. Loading untrusted
 * snapshots there validates/migrates with the exact installed schema without
 * crashing or changing the mounted editor on a validation failure. */
export function prepareCanvasRestore(store: TLStore, moment: Moment) {
  const camera = moment.camera
  if (camera) {
    T.number.validate(camera.x)
    T.number.validate(camera.y)
    T.positiveNumber.validate(camera.z)
  }
  createTLStore({ schema: store.schema, snapshot: moment.document })
}

/** Input remains paused by the operation gate. tldraw's readonly mode also
 * refuses application create/delete calls, so lift it only for this
 * synchronous restore and reinstate it before yielding to browser events. */
export function withRestoreWriteAccess(editor: Pick<Editor, 'getIsReadonly' | 'updateInstanceState'>, restore: () => void) {
  const wasReadonly = editor.getIsReadonly()
  try {
    if (wasReadonly) editor.updateInstanceState({ isReadonly: false })
    restore()
  } finally {
    if (wasReadonly) editor.updateInstanceState({ isReadonly: true })
  }
}
