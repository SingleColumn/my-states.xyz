import type { Panel, PanelLayout, PanelType } from './types'
import { getPanelDefinition } from './panelRegistry'

export { PANEL_TYPES } from './panelRegistry'

export function getCanonicalPanelLayout(panelType: PanelType): Omit<PanelLayout, 'panelId'> & { panelType: PanelType } {
  return { panelType, ...getPanelDefinition(panelType).defaultLayout }
}

export function getPanelMinimumSize(panelType: PanelType) {
  return getPanelDefinition(panelType).minimumSize
}

/** Null when this kind of panel keeps its size in focus view. */
export function getPanelFocusViewSize(panelType: PanelType) {
  return getPanelDefinition(panelType).focusViewSize
}

export function isPanelInFocusView(panel: Pick<Panel, 'focusView'>) {
  return panel.focusView === true
}

export function isPanelVisible(panel: Pick<Panel, 'visible'>) {
  return panel.visible !== false
}

export function resetPanelLayoutSize(layout: PanelLayout, panelType: PanelType): PanelLayout {
  const canonical = getCanonicalPanelLayout(panelType)
  return {
    ...layout,
    x: layout.x + (layout.w - canonical.w) / 2,
    y: layout.y + (layout.h - canonical.h) / 2,
    w: canonical.w,
    h: canonical.h,
  }
}

export function getCollectivePanelBounds(layouts: readonly PanelLayout[]) {
  if (!layouts.length) return null
  const minX = Math.min(...layouts.map((layout) => layout.x))
  const minY = Math.min(...layouts.map((layout) => layout.y))
  const maxX = Math.max(...layouts.map((layout) => layout.x + layout.w))
  const maxY = Math.max(...layouts.map((layout) => layout.y + layout.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
