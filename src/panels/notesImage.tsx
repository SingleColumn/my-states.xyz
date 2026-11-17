import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Ctx } from '@milkdown/ctx'
import type { Node as ProseNode } from '@milkdown/prose/model'
import { imageSchema } from '@milkdown/preset-commonmark'
import { NodeSelection, Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose, $remark } from '@milkdown/utils'
import { useNodeViewContext } from '@prosemirror-adapter/react'

/**
 * A picture a writer can resize.
 *
 * Markdown has no width: `![alt](src)` is the whole vocabulary. So a
 * picture left at its natural size is written exactly that way, and only
 * one that has been resized becomes inline HTML:
 *
 *     <img src="..." alt="..." width="50%" />
 *
 * The width is a share of the page's column, not a number of pixels, so a
 * picture set to half the page stays half the page when the paper is
 * switched between Narrow, A4 and Wide. Notes written before this kept
 * pixel widths (`width="320"`); those are still read, and shown at that
 * size, until the picture is next resized.
 *
 * That is the same trade the underline makes, and worth the same note: a
 * note with a resized picture is no longer plain Markdown. Readers that
 * pass HTML through generally honour the width; a strict one still shows
 * the picture at its natural size. Nothing is lost, only the size.
 *
 * Three pieces again: the width on the schema, a handler that writes it out
 * as a tag, and a transform that reads the tag back in. A fourth centres a
 * picture that has a paragraph to itself.
 */
const MIN_WIDTH = 60
/** How far one press of an arrow key on a handle moves the width. */
const KEY_STEP_PERCENT = 5

/** `"50%"` for a share of the column, a number for a width in pixels from an older note, or nothing for the picture's own size. */
type PictureWidth = string | number | null

/**
 * Teaches the picture a width. Called from the editor's config, which is
 * where a preset's schema can still be changed: every plugin's slices are
 * injected before any config runs, so the preset's own factory is here to
 * be read and wrapped.
 */
export function configureImageSize(ctx: Ctx) {
  const base = ctx.get(imageSchema.key)
  ctx.set(imageSchema.key, (inner) => {
    const schema = base(inner)
    return {
      ...schema,
      attrs: { ...schema.attrs, width: { default: null } },
      parseDOM: [
        {
          tag: 'img[src]',
          getAttrs: (dom: HTMLElement) => ({
            src: dom.getAttribute('src') ?? '',
            alt: dom.getAttribute('alt') ?? '',
            title: dom.getAttribute('title') ?? '',
            width: widthOf(dom.getAttribute('width')),
          }),
        },
      ],
      toDOM: (node) => ['img', {
        src: node.attrs.src as string,
        alt: node.attrs.alt as string,
        title: (node.attrs.title as string) || null,
        width: node.attrs.width ? String(node.attrs.width) : null,
      }],
      parseMarkdown: {
        match: ({ type }) => type === 'image',
        runner: (state, node, type) => {
          state.addNode(type, {
            src: node.url as string,
            alt: node.alt as string,
            title: (node.title as string) ?? '',
            width: widthOf(node.width as string | number | undefined),
          })
        },
      },
      toMarkdown: {
        match: (node) => node.type.name === 'image',
        runner: (state, node) => {
          const width = widthOf(node.attrs.width as PictureWidth)
          if (!width) {
            state.addNode('image', undefined, undefined, {
              title: node.attrs.title || null,
              url: node.attrs.src,
              alt: node.attrs.alt,
            })
            return
          }
          // A size is the one thing the `![]()` form cannot carry.
          state.addNode('html', undefined, `<img src="${escapeAttribute(node.attrs.src as string)}" alt="${escapeAttribute(node.attrs.alt as string)}" width="${width}" />`)
        },
      },
    }
  })
}

interface MdNode { type: string; children?: MdNode[]; value?: string; [key: string]: unknown }

/**
 * Reads the tag back as a picture. remark hands `<img ... />` over as a
 * scrap of raw HTML, which the preset's html node would otherwise show as
 * the literal characters; this turns it into the image node it describes
 * before the parser looks, the way the underline's pairs are read.
 */
export const imageSizeRemark = $remark('notesImageSizeRemark', () => () => (root) => {
  const tree = root as unknown as MdNode
  visit(tree)
})

function visit(node: MdNode) {
  if (!node.children) return
  node.children = node.children.map((child) => {
    const image = imageTagOf(child)
    if (image) return image
    visit(child)
    return child
  })
}

function imageTagOf(node: MdNode): MdNode | null {
  if (node.type !== 'html' || typeof node.value !== 'string') return null
  const tag = node.value.trim()
  if (!/^<img\b[^>]*\/?>$/i.test(tag)) return null
  const src = attributeOf(tag, 'src')
  if (!src) return null
  return {
    type: 'image',
    url: src,
    alt: attributeOf(tag, 'alt') ?? '',
    title: null,
    width: widthOf(attributeOf(tag, 'width')),
  }
}

/** The value of one attribute of a tag, single or double quoted. */
function attributeOf(tag: string, name: string) {
  const match = new RegExp(`\\b${name}=("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return match ? match[2] ?? match[3] ?? '' : null
}

/**
 * A width is a share of the column from 1% to 100%, a number of pixels
 * from an older note, or nothing at all.
 */
export function widthOf(value: string | number | null | undefined): PictureWidth {
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    const percent = Math.round(Number(value.trim().slice(0, -1)))
    return Number.isFinite(percent) && percent >= 1 ? `${Math.min(percent, 100)}%` : null
  }
  const width = Math.round(Number(value))
  return Number.isFinite(width) && width >= MIN_WIDTH ? width : null
}

function percentOf(width: PictureWidth) {
  return typeof width === 'string' ? Number(width.slice(0, -1)) : null
}

/**
 * Only the characters that would end the attribute or the tag. The source
 * of these is the writer's own file name and the picture's own data, not a
 * page, but a quote in an alt text would still break the tag.
 */
function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const LONE_PICTURE_CLASS = 'notes-picture-alone'

function lonePictures(doc: ProseNode) {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true
    if (node.childCount === 1 && node.firstChild?.type.name === 'image') {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: LONE_PICTURE_CLASS }))
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * Centres a picture that has a paragraph to itself, the way writing tools
 * set a picture between paragraphs. A picture in the middle of a sentence
 * stays where the sentence put it: centring that would tear the line apart.
 *
 * A class on the paragraph rather than a rule in the stylesheet, because
 * the stylesheet cannot tell "only a picture" from "a picture and some
 * words": the words are text, which `:only-child` does not count.
 */
export const lonePictureCentring = $prose(() => new Plugin({
  key: new PluginKey('notesLonePicture'),
  state: {
    init: (_, state) => lonePictures(state.doc),
    // Worked out again only when the words change; a moved caret cannot
    // change which paragraphs hold nothing but a picture.
    apply: (tr, set) => tr.docChanged ? lonePictures(tr.doc) : set,
  },
  props: {
    decorations(state) {
      return this.getState(state)
    },
  },
}))

/**
 * What a drag needs to know about the picture as it starts, all in the
 * page's own pixels -- not as drawn on screen: the note can be zoomed (its
 * own zoom control) and so can the canvas it sits on, and either makes the
 * drawn picture smaller or larger than its width. Saving the drawn width
 * made a plain click on the handle shrink the picture whenever either was
 * below 100%. `offsetWidth` is the width before any zoom or scaling; the
 * drawn width over it is the combined zoom, which a drag's pointer
 * movement is divided by.
 */
function measure(frame: HTMLElement | null) {
  const column = frame?.closest('p') ?? frame?.parentElement
  const columnWidth = column?.clientWidth || 1
  if (!frame) return { percent: 100, columnWidth, scale: 1, centred: false }
  const width = frame.offsetWidth || MIN_WIDTH
  const drawn = frame.getBoundingClientRect().width
  return {
    // Exact, not rounded or clamped: a drag starts from where the picture
    // really is, or its edge would jump away from the pointer on the press.
    percent: (width / columnWidth) * 100,
    columnWidth,
    scale: drawn > 0 ? width / drawn : 1,
    centred: column?.classList.contains(LONE_PICTURE_CLASS) ?? false,
  }
}

/**
 * Whole percentages only -- the saved tag reads `width="48%"`, not
 * `width="47.8125%"` -- never past the column, and never so narrow it
 * cannot be taken hold of again. A picture already smaller than that (a
 * small icon at its own size) may stay as small as it was: the limit is
 * there to stop a drag losing the picture, not to inflate one.
 */
function clampPercent(percent: number, columnWidth: number, from = 100) {
  const least = Math.min(100, Math.ceil((MIN_WIDTH / columnWidth) * 100), Math.max(1, Math.floor(from)))
  return Math.max(least, Math.min(100, Math.round(percent)))
}

type Side = 'left' | 'right'

/**
 * The picture as the writer sees it: the image, and a handle on each side
 * to pull. A centred picture grows from its middle, so pulling one side
 * moves both and the handle stays under the pointer; a picture in a line of
 * text grows to the right only, so it has only the right handle.
 *
 * The width follows the pointer while the handle is held and is written to
 * the document once, when it is let go, so a drag is one thing to undo
 * rather than forty.
 */
export function NotesImageView() {
  const { node, view, getPos, setAttrs, selected } = useNodeViewContext()
  const frameRef = useRef<HTMLSpanElement>(null)
  /** Where a drag began, and how the pointer's movement turns into a share of the column. */
  const startRef = useRef<{ x: number; percent: number; perPixel: number } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const isDragging = dragging !== null
  const saved = widthOf(node.attrs.width as PictureWidth)
  const percent = dragging ?? percentOf(saved)
  const pixels = percent === null && typeof saved === 'number' ? saved : null

  // The drag is followed on the window: the pointer leaves the handle as
  // soon as it moves, and a picture narrowed past the handle would drop it.
  useEffect(() => {
    const start = startRef.current
    if (!isDragging || !start) return
    const move = (event: PointerEvent) => {
      setDragging(clampPercent(start.percent + (event.clientX - start.x) * start.perPixel, measure(frameRef.current).columnWidth, start.percent))
    }
    // A press that never moved writes nothing: it would turn plain Markdown
    // into a sized tag for no change at all.
    const end = () => {
      setDragging((current) => {
        if (current !== null && current !== Math.round(start.percent)) setAttrs({ width: `${current}%` })
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [isDragging, setAttrs])

  /**
   * A click on the picture picks the picture. Without it the caret simply
   * lands beside the picture, the node is never selected, and the handle
   * only ever appears while the pointer happens to be over it -- which is
   * what made it so hard to find.
   *
   * On the click and not the press: the editor sets its own selection from
   * the pointer as the press completes, so a selection made before that is
   * thrown away a board later.
   */
  function select() {
    const at = getPos()
    if (at === undefined) return
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)))
  }

  function startDrag(side: Side, event: ReactPointerEvent) {
    const { percent: current, columnWidth, scale, centred } = measure(frameRef.current)
    // Pulling the left handle leftwards widens; a centred picture widens on
    // both sides at once, so it grows by twice what the pointer moved.
    const direction = side === 'left' ? -1 : 1
    const sides = centred ? 2 : 1
    startRef.current = { x: event.clientX, percent: current, perPixel: (direction * sides * scale * 100) / columnWidth }
    setDragging(current)
    event.preventDefault()
    event.stopPropagation()
  }

  function nudge(side: Side, key: string) {
    const outward = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
    const inward = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
    const step = key === outward ? KEY_STEP_PERCENT : key === inward ? -KEY_STEP_PERCENT : 0
    if (!step) return false
    const { percent: current, columnWidth } = measure(frameRef.current)
    setAttrs({ width: `${clampPercent(current + step, columnWidth, current)}%` })
    return true
  }

  const handle = (side: Side) => (
    <span
      className={`notes-image-handle is-${side}`}
      role="slider"
      tabIndex={0}
      aria-label={side === 'left' ? 'Picture width, left edge' : 'Picture width'}
      aria-valuenow={percent ?? 100}
      aria-valuemin={1}
      aria-valuemax={100}
      aria-valuetext={percent === null ? 'Natural size' : `${percent}% of the page width`}
      title="Drag to resize, or use the arrow keys"
      onPointerDown={(event) => startDrag(side, event)}
      onKeyDown={(event) => {
        if (nudge(side, event.key)) event.preventDefault()
      }}
    />
  )

  return (
    <span
      ref={frameRef}
      className={`notes-image${selected ? ' is-selected' : ''}${isDragging ? ' is-resizing' : ''}${percent !== null ? ' has-share' : ''}`}
      style={percent !== null ? { width: `${percent}%` } : undefined}
    >
      <img
        onClick={select}
        src={node.attrs.src as string}
        alt={node.attrs.alt as string}
        title={(node.attrs.title as string) || undefined}
        width={pixels ?? undefined}
        draggable={false}
      />
      {handle('left')}
      {handle('right')}
    </span>
  )
}
