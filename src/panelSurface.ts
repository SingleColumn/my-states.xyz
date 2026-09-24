import type { SyntheticEvent } from 'react'

/**
 * The one rule for pointer input on a panel.
 *
 *   tldraw owns every part of a panel that is not inside a declared content
 *   region. A content region owns everything inside it.
 *
 * "tldraw owns it" means a press there falls through to the canvas, where
 * tldraw hit-tests the shape's geometry and does what it does for any shape:
 * select, drag, right-click menu, marquee. "The content owns it" means the
 * press goes to the widget under the pointer and tldraw never sees it.
 *
 * A content region is declared with one attribute, `data-panel-content`, on
 * the element that bounds it. That attribute is the *only* thing a panel
 * author has to write. Both halves of the mechanism key off it:
 *
 *   - CSS: `.canvas-panel-shell [data-panel-content]` gets pointer events
 *     back (the shell itself is transparent to the pointer).
 *   - JS: the shape's capture-phase pointer-down handler marks any press that
 *     lands inside a content region as handled, so tldraw's canvas handlers
 *     ignore it. See PanelShape.tsx.
 *
 * Because both halves read the same attribute, they cannot disagree, and a
 * new widget in a new panel type needs no entry in any list.
 *
 * Keyboard input is deliberately not part of this rule: tldraw already stands
 * down while the focused element is an input or contenteditable, wherever it
 * lives. Wheel is handled separately by useNativeWheelScrollScope.
 *
 * Whether a region is content can change with panel state. The Images panel's
 * picture is content in the full view (a click on it must not move the panel)
 * and frame in focus view (the header is gone, so the picture is the only
 * thing left to drag by). Declare that by adding or omitting the attribute,
 * not by intercepting events.
 */
export const PANEL_CONTENT_ATTRIBUTE = 'data-panel-content'

/** Spread onto the element that bounds a content region. */
export const panelContentProps = { [PANEL_CONTENT_ATTRIBUTE]: '' } as const

/** Every declared content region: what a panel hands the pointer back for. */
export const panelContentSelector = `[${PANEL_CONTENT_ATTRIBUTE}]`

export function isInsidePanelContent(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(panelContentSelector) !== null
}

/**
 * Where a panel scrolls, when the wheel lands somewhere that cannot say for
 * itself.
 *
 * The usual answer is read from the pointer: whatever it is over, the
 * nearest scrolling ancestor is the thing to move. That fails for a control
 * beside the scrolling part rather than inside it -- a note's title field is
 * the case in hand -- where there is no scrolling ancestor to find and the
 * wheel fell through to the canvas, sliding the view off the panel.
 *
 * A panel names the region instead of the app guessing at one. Guessing was
 * the alternative and a bad one: the nearest scrollable thing anywhere on
 * the panel would have the Images panel's thumbnail strip moving under a
 * pointer resting on its transport row.
 */
export const PANEL_SCROLL_ATTRIBUTE = 'data-panel-scroll'

/** Spread onto the element that holds what the panel scrolls. */
export const panelScrollProps = { [PANEL_SCROLL_ATTRIBUTE]: '' } as const

export const panelScrollSelector = `[${PANEL_SCROLL_ATTRIBUTE}]`

/**
 * Whether a press or a key landed on something that takes text: a form
 * field, or any element inside a contenteditable. This is the same test
 * tldraw applies before it claims a key, so the app and the library agree on
 * where typing goes without either keeping a list of editor widgets.
 *
 * `isContentEditable` alone does not answer the question it looks like it
 * answers. An editor marks the parts it draws itself -- a picture, an
 * embed -- `contenteditable="false"` so the caret cannot be put inside
 * them, and the flag is then false on everything within. Those are still
 * the editor's, and a right-click on one belongs to the editor's own menu
 * rather than to the canvas underneath; without the second test, tldraw
 * opened its shape menu over a picture in a note.
 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  if (target.closest('[contenteditable="true"]')) return true
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

/**
 * tldraw's own convention for "another handler already dealt with this
 * pointer event": every canvas, selection and handle listener returns early
 * when the event carries `isKilled`. Setting it lets the event keep bubbling
 * (so React handlers and Radix's outside-click detection still run) while
 * keeping tldraw from starting a drag or a marquee.
 */
export function markPointerEventHandled(event: SyntheticEvent | Event) {
  ;(event as unknown as { isKilled?: boolean }).isKilled = true
  const native = 'nativeEvent' in event ? (event as SyntheticEvent).nativeEvent : null
  if (native) (native as unknown as { isKilled?: boolean }).isKilled = true
}
