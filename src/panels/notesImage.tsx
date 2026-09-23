import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Ctx } from '@milkdown/ctx'
import { imageSchema } from '@milkdown/preset-commonmark'
import { $remark } from '@milkdown/utils'
import { useNodeViewContext } from '@prosemirror-adapter/react'

/**
 * A picture a writer can resize.
 *
 * Markdown has no width: `![alt](src)` is the whole vocabulary. So a
 * picture left at its natural size is written exactly that way, and only
 * one that has been resized becomes inline HTML:
 *
 *     <img src="..." alt="..." width="320" />
 *
 * That is the same trade the underline makes, and worth the same note: a
 * note with a resized picture is no longer plain Markdown, though every
 * reader that passes HTML through -- GitHub, Obsidian, most site
 * generators -- honours the width, and a strict one still shows the
 * picture at its natural size. Nothing is lost, only the size.
 *
 * Three pieces again: the width on the schema, a handler that writes it out
 * as a tag, and a transform that reads the tag back in.
 */
const MIN_WIDTH = 60

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
          const width = node.attrs.width as number | null
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

/** A width is a positive number of pixels or nothing at all. */
function widthOf(value: string | number | null | undefined) {
  const width = Math.round(Number(value))
  return Number.isFinite(width) && width >= MIN_WIDTH ? width : null
}

/**
 * Only the characters that would end the attribute or the tag. The source
 * of these is the writer's own file name and the picture's own data, not a
 * page, but a quote in an alt text would still break the tag.
 */
function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * The picture as the writer sees it: the image, and a handle on its right
 * edge to pull. The width follows the pointer while the handle is held and
 * is written to the document once, when it is let go, so a drag is one
 * thing to undo rather than forty.
 */
export function NotesImageView() {
  const { node, setAttrs, selected } = useNodeViewContext()
  const imageRef = useRef<HTMLImageElement>(null)
  const startRef = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const isDragging = dragging !== null
  const width = dragging ?? (node.attrs.width as number | null)

  // The drag is followed on the window: the pointer leaves the handle as
  // soon as it moves, and a picture narrowed past the handle would drop it.
  useEffect(() => {
    const start = startRef.current
    if (!isDragging || !start) return
    const move = (event: PointerEvent) => {
      setDragging(Math.max(MIN_WIDTH, Math.round(start.width + (event.clientX - start.x))))
    }
    // Written to the document once, when the handle is let go, so a drag is
    // one thing to undo rather than one per pixel.
    const end = () => {
      setDragging((current) => {
        if (current !== null) setAttrs({ width: current })
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

  function startDrag(event: ReactPointerEvent) {
    const measured = imageRef.current?.getBoundingClientRect().width ?? MIN_WIDTH
    startRef.current = { x: event.clientX, width: Math.round(measured) }
    setDragging(Math.round(measured))
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <span className={`notes-image${selected ? ' is-selected' : ''}${dragging !== null ? ' is-resizing' : ''}`}>
      <img
        ref={imageRef}
        src={node.attrs.src as string}
        alt={node.attrs.alt as string}
        title={(node.attrs.title as string) || undefined}
        width={width ?? undefined}
        draggable={false}
      />
      <span
        className="notes-image-handle"
        role="slider"
        tabIndex={0}
        aria-label="Picture width"
        aria-valuenow={width ?? 0}
        aria-valuemin={MIN_WIDTH}
        title="Drag to resize, or use the arrow keys"
        onPointerDown={startDrag}
        onKeyDown={(event) => {
          const step = event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0
          if (!step) return
          event.preventDefault()
          const measured = Math.round(imageRef.current?.getBoundingClientRect().width ?? MIN_WIDTH)
          setAttrs({ width: Math.max(MIN_WIDTH, measured + step) })
        }}
      />
    </span>
  )
}
