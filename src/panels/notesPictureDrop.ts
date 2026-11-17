import { imageSchema, paragraphSchema } from '@milkdown/preset-commonmark'
import { dropCursor } from '@milkdown/prose/dropcursor'
import { Fragment, Slice } from '@milkdown/prose/model'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { dropPoint } from '@milkdown/prose/transform'
import { $prose } from '@milkdown/utils'
import { readPictureDragData, settleNotePicture } from './notePicture'

/**
 * A picture dragged from the Images panel and dropped on the note becomes
 * an ordinary picture at the drop point (see notePicture.ts for what the
 * note keeps). Only the app's own payload is taken; text, files and the
 * editor's own drags fall through to ProseMirror.
 */
export const notesPictureDrop = $prose((ctx) => new Plugin({
  key: new PluginKey('NOTES_PICTURE_DROP'),
  props: {
    handleDrop(view, event) {
      const picture = readPictureDragData(event.dataTransfer)
      if (!picture) return false
      event.preventDefault()
      const coords = { left: event.clientX, top: event.clientY }
      // A picture from the writer's own folder is copied first, which takes
      // a moment; the drop point is found once it is ready, from where the
      // pointer was, so typing in between cannot leave it at a stale place.
      void settleNotePicture(picture).then(
        (settled) => {
          if ((view as { isDestroyed?: boolean }).isDestroyed) return
          const target = view.posAtCoords(coords)?.pos ?? view.state.selection.from
          const image = imageSchema.type(ctx).create({ src: settled.src, alt: settled.alt, title: settled.title })
          const block = paragraphSchema.type(ctx).create(null, image)
          // The pointer usually lands inside a line of text. The picture
          // takes the nearest place between blocks rather than cutting the
          // paragraph in two.
          const at = dropPoint(view.state.doc, target, new Slice(Fragment.from(block), 0, 0)) ?? target
          view.dispatch(view.state.tr.insert(at, block).scrollIntoView())
          view.focus()
        },
        (error: unknown) => window.alert(error instanceof Error ? error.message : 'The picture could not be placed in the note.'),
      )
      return true
    },
  },
}))

/** The line that shows where a drop will land. */
export const notesDropCursor = $prose(() => dropCursor({ class: 'notes-drop-cursor', width: 2 }))
