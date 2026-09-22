import { useState } from 'react'
import { Play } from 'lucide-react'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { dropCursor } from '@milkdown/prose/dropcursor'
import { Fragment, Slice } from '@milkdown/prose/model'
import { dropPoint } from '@milkdown/prose/transform'
import { $node, $prose, $remark } from '@milkdown/utils'
import { useNodeViewContext } from '@prosemirror-adapter/react'
import { useAppState } from '../AppState'
import type { Panel, PanelType } from '../types'

/**
 * A live embed of another panel inside a note.
 *
 * The document holds only what identifies the source -- the panel's stable
 * id and the title it had when placed -- never what the panel was showing.
 * The node view looks the panel up in the app's state every time it
 * renders, so the embed follows the source as it changes and says so when
 * the source is gone. Nothing runs when a note opens: the view shows a
 * poster until the reader asks, and what it then shows sits in a sandboxed
 * frame with no access to the page.
 *
 * In Markdown the embed becomes one line, a link with its own scheme:
 *
 *     [Images: teemu-jpeg](my-states://panel/panel-abc)
 *
 * Any other tool shows a link and the title, which is the predictable
 * degradation the checklist asks for; this app reads the line back into an
 * embed, so a note survives the Markdown-only moment bundle intact.
 */

/** The drag payload's MIME type: a panel offered to a note. */
export const PANEL_DRAG_TYPE = 'application/x-my-states-panel'
export const EMBED_LINK_SCHEME = 'my-states://panel/'

export interface PanelDragData {
  panelId: string
  title: string
}

export function readPanelDragData(transfer: DataTransfer | null): PanelDragData | null {
  const raw = transfer?.getData(PANEL_DRAG_TYPE)
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<PanelDragData>
    return typeof data.panelId === 'string' ? { panelId: data.panelId, title: typeof data.title === 'string' ? data.title : '' } : null
  } catch {
    return null
  }
}

export const panelEmbed = $node('panelEmbed', () => ({
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,
  marks: '',
  attrs: {
    panelId: { default: '' },
    title: { default: '' },
  },
  parseDOM: [{
    tag: 'div[data-panel-embed]',
    getAttrs: (dom) => ({ panelId: (dom as HTMLElement).dataset.panelEmbed ?? '', title: (dom as HTMLElement).dataset.title ?? '' }),
  }],
  toDOM: (node) => ['div', { 'data-panel-embed': node.attrs.panelId, 'data-title': node.attrs.title }],
  parseMarkdown: {
    match: (node) => node.type === 'panelEmbed',
    runner: (state, node, type) => {
      state.addNode(type, { panelId: node.panelId as string, title: node.title as string })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'panelEmbed',
    runner: (state, node) => {
      state.openNode('paragraph')
      state.openNode('link', undefined, { url: `${EMBED_LINK_SCHEME}${node.attrs.panelId}` })
      state.addNode('text', undefined, node.attrs.title || 'Embedded panel')
      state.closeNode()
      state.closeNode()
    },
  },
}))

interface MdNode { type: string; children?: MdNode[]; url?: string; value?: string; [key: string]: unknown }

/**
 * Turns the embed's Markdown line back into an embed before the parser
 * sees it. The parser gives each Markdown node to the first schema node
 * whose `match` accepts it, in registration order, so a paragraph or a
 * link is always claimed by the preset; the rewrite happens one step
 * earlier, on the Markdown tree itself.
 */
export const panelEmbedRemark = $remark('panelEmbedRemark', () => () => (root) => {
  const tree = root as unknown as MdNode
  const visit = (node: MdNode) => {
    if (!node.children) return
    node.children = node.children.map((child) => {
      const link = embedLinkOf(child)
      if (!link) {
        visit(child)
        return child
      }
      return { type: 'panelEmbed', panelId: link.panelId, title: link.title }
    })
  }
  visit(tree)
})

function embedLinkOf(node: MdNode): PanelDragData | null {
  if (node.type !== 'paragraph' || node.children?.length !== 1) return null
  const [link] = node.children
  if (link.type !== 'link' || typeof link.url !== 'string' || !link.url.startsWith(EMBED_LINK_SCHEME)) return null
  const title = (link.children ?? []).map((child) => (typeof child.value === 'string' ? child.value : '')).join('')
  return { panelId: link.url.slice(EMBED_LINK_SCHEME.length), title }
}

/**
 * A panel dragged from elsewhere in the app and dropped on the note
 * becomes an embed at the drop point. Only the app's own payload is taken;
 * text, files and the editor's own drags fall through to ProseMirror.
 */
export const panelEmbedDrop = $prose((ctx) => new Plugin({
  key: new PluginKey('NOTES_PANEL_EMBED_DROP'),
  props: {
    handleDrop(view, event) {
      const data = readPanelDragData(event.dataTransfer)
      if (!data) return false
      const target = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (!target) return false
      const node = panelEmbed.type(ctx).create(data)
      // The pointer usually lands inside a line of text; a block cannot go
      // there, so the embed takes the nearest place between blocks rather
      // than cutting the paragraph in two.
      const at = dropPoint(view.state.doc, target.pos, new Slice(Fragment.from(node), 0, 0))
      if (at === null) return false
      view.dispatch(view.state.tr.insert(at, node).scrollIntoView())
      view.focus()
      return true
    },
  },
}))

/** The line that shows where a drop will land. */
export const panelEmbedDropCursor = $prose(() => dropCursor({ class: 'notes-drop-cursor', width: 2 }))

/** How the drag source describes a panel; the same string the embed keeps as its title. */
export function embedTitleFor(panel: Panel, detail?: string) {
  const name = panelTitles[panel.type]
  return detail ? `${name}: ${detail}` : name
}

const panelTitles: Record<PanelType, string> = {
  spotify: 'Music',
  slideshow: 'Images',
  notes: 'Writing',
}

export function PanelEmbedView() {
  const { node, selected } = useNodeViewContext()
  const { panels, slideshow, appearance } = useAppState()
  // What the reader has asked to see. Editor state, not document state:
  // it is not persisted, so opening a note never runs anything.
  const [showing, setShowing] = useState(false)
  const { panelId, title } = node.attrs as { panelId: string; title: string }
  const panel = panels.get(panelId)
  const live = panel ? liveContentOf(panel, slideshow, appearance.effective.mode) : null

  return (
    <figure className={`notes-embed${selected ? ' is-selected' : ''}`} data-panel-embed={panelId} data-title={title}>
      {!panel ? (
        <div className="notes-embed-poster is-missing">
          <span className="notes-embed-title">{title || 'Embedded panel'}</span>
          <span className="notes-embed-note">This panel is no longer on the canvas.</span>
        </div>
      ) : !live ? (
        <div className="notes-embed-poster is-missing">
          <span className="notes-embed-title">{title || embedTitleFor(panel)}</span>
          <span className="notes-embed-note">Nothing to show for this panel yet.</span>
        </div>
      ) : showing ? (
        <iframe
          className="notes-embed-frame"
          title={live.title}
          // No same-origin, no forms, no navigation: the frame can draw and
          // run its own script and nothing else.
          sandbox="allow-scripts"
          srcDoc={live.srcDoc}
        />
      ) : (
        <button type="button" className="notes-embed-poster" onClick={() => setShowing(true)} onMouseDown={(event) => event.stopPropagation()}>
          <span className="notes-embed-title">{live.title}</span>
          <span className="notes-embed-note"><Play size={14} aria-hidden="true" /> Show</span>
        </button>
      )}
    </figure>
  )
}

interface LiveContent {
  /** What the source is showing right now, for the poster and the frame's title. */
  title: string
  srcDoc: string
}

/**
 * The source panel's current content as a self-contained document for the
 * frame. Each panel type that can be embedded adds a case here; a type
 * without one shows the "nothing to show" poster rather than an empty frame.
 */
function liveContentOf(panel: Panel, slideshow: ReturnType<typeof useAppState>['slideshow'], mode: 'light' | 'dark'): LiveContent | null {
  if (panel.type !== 'slideshow') return null
  const images = slideshow.imagesFor(panel.id)
  const image = images[slideshow.currentIndexFor(panel.id)] ?? images[0]
  if (!image) return null
  // The frame has its own origin, so a relative address must be made whole
  // here; an object URL from a local folder cannot cross that line and the
  // frame's own fallback text shows instead.
  const src = new URL(image.url, window.location.href).href
  const title = embedTitleFor(panel, image.name)
  return {
    title,
    // The frame's colour scheme must match the page's: when they differ the
    // browser paints the frame on an opaque white canvas instead of letting
    // the note show through.
    srcDoc: `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${mode}"><style>
      html,body{margin:0;height:100%;background:transparent;font:14px system-ui,sans-serif;color:#888}
      img{display:block;width:100%;height:100%;object-fit:contain}
      p{margin:0;padding:1em;text-align:center}
    </style></head><body><img src="${escapeAttribute(src)}" alt="${escapeAttribute(image.name)}" onerror="this.replaceWith(Object.assign(document.createElement('p'),{textContent:'This picture cannot be shown here.'}))"></body></html>`,
  }
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
