import type { PanelLayout, PanelType } from './types'
import { getCanonicalPanelLayout } from './panelLayout'

export interface ScreenRect { x: number; y: number; w: number; h: number }

export function getDefaultPanelSize(panelType: PanelType) {
  const { w, h } = getCanonicalPanelLayout(panelType)
  return { w, h }
}

export function restorePanelDefaultSize(layout: PanelLayout, panelType: PanelType): PanelLayout {
  const { w, h } = getDefaultPanelSize(panelType)
  return { ...layout, w, h }
}

/** Restore the same canonical position and size used by Reset panel layout. */
export function restorePanelDefaultLayout(layout: PanelLayout, panelType: PanelType): PanelLayout {
  const canonical = getCanonicalPanelLayout(panelType)
  return { ...layout, x: canonical.x, y: canonical.y, w: canonical.w, h: canonical.h }
}

/** Convert an application viewport rectangle into page coordinates outside React. */
export function getFullScreenPanelLayout(
  screenRect: ScreenRect,
  chromeBottom: number | null | undefined,
  screenToPage: (point: { x: number; y: number }) => { x: number; y: number },
  margin = 16,
): Pick<PanelLayout, 'x' | 'y' | 'w' | 'h'> {
  const left = screenRect.x + margin
  // The measured chrome height is normally supplied by AppChrome. Keep a
  // small fallback so the first click, before measurement, still clears it.
  const top = Math.max(screenRect.y + margin, (chromeBottom ?? screenRect.y + 52) + margin)
  const right = screenRect.x + screenRect.w - margin
  const bottom = screenRect.y + screenRect.h - margin
  const pageTopLeft = screenToPage({ x: left, y: top })
  const pageBottomRight = screenToPage({ x: right, y: bottom })
  return { x: pageTopLeft.x, y: pageTopLeft.y, w: pageBottomRight.x - pageTopLeft.x, h: pageBottomRight.y - pageTopLeft.y }
}
