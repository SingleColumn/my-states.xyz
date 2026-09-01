import type { PanelLayout, PanelType } from './types'

export const PANEL_TYPES = ['spotify', 'slideshow', 'notes'] as const satisfies readonly PanelType[]

export const CANONICAL_PANEL_LAYOUTS = [
  { panelType: 'spotify', x: -720, y: -300, w: 460, h: 720 },
  { panelType: 'slideshow', x: -220, y: -300, w: 460, h: 720 },
  { panelType: 'notes', x: 280, y: -300, w: 460, h: 720 },
] as const

export const PANEL_MINIMUM_SIZES: Readonly<Record<PanelType, { w: number; h: number }>> = {
  spotify: { w: 320, h: 260 },
  slideshow: { w: 320, h: 260 },
  notes: { w: 320, h: 260 },
}

export function getCanonicalPanelLayout(panelType: PanelType): Omit<PanelLayout, 'panelId'> & { panelType: PanelType } {
  const layout = CANONICAL_PANEL_LAYOUTS.find((candidate) => candidate.panelType === panelType)
  if (!layout) throw new Error(`No canonical layout exists for ${panelType}.`)
  return { ...layout }
}

export function getPanelMinimumSize(panelType: PanelType) {
  return PANEL_MINIMUM_SIZES[panelType]
}

export function mergePanelLayouts(layouts: readonly PanelLayout[]): PanelLayout[] {
  const firstById = new Map<string, PanelLayout>()
  for (const layout of layouts) {
    if (!firstById.has(layout.panelId)) firstById.set(layout.panelId, layout)
  }
  return [...firstById.values()].map((layout) => ({ ...layout }))
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

export function resetAllPanelLayouts(panels: readonly { id: string; type: PanelType }[]): PanelLayout[] {
  return panels.map((panel) => {
    const layout = getCanonicalPanelLayout(panel.type)
    return { panelId: panel.id, x: layout.x, y: layout.y, w: layout.w, h: layout.h }
  })
}

export function getCollectivePanelBounds(layouts: readonly PanelLayout[]) {
  if (!layouts.length) return null
  const minX = Math.min(...layouts.map((layout) => layout.x))
  const minY = Math.min(...layouts.map((layout) => layout.y))
  const maxX = Math.max(...layouts.map((layout) => layout.x + layout.w))
  const maxY = Math.max(...layouts.map((layout) => layout.y + layout.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
