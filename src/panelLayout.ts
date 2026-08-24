import type { PanelLayout, PanelType } from './types'

export const PANEL_TYPES = ['spotify', 'slideshow', 'notes'] as const satisfies readonly PanelType[]

export const CANONICAL_PANEL_LAYOUTS = [
  { panelType: 'spotify', x: -720, y: -300, w: 460, h: 600 },
  { panelType: 'slideshow', x: -220, y: -300, w: 460, h: 600 },
  { panelType: 'notes', x: 280, y: -300, w: 460, h: 600 },
] as const satisfies readonly PanelLayout[]

export const PANEL_MINIMUM_SIZES: Readonly<Record<PanelType, { w: number; h: number }>> = {
  spotify: { w: 320, h: 260 },
  slideshow: { w: 320, h: 260 },
  notes: { w: 320, h: 260 },
}

export function getCanonicalPanelLayout(panelType: PanelType): PanelLayout {
  const layout = CANONICAL_PANEL_LAYOUTS.find((candidate) => candidate.panelType === panelType)
  if (!layout) throw new Error(`No canonical layout exists for ${panelType}.`)
  return { ...layout }
}

export function getPanelMinimumSize(panelType: PanelType) {
  return PANEL_MINIMUM_SIZES[panelType]
}

export function mergePanelLayouts(layouts: readonly PanelLayout[]): PanelLayout[] {
  const firstByType = new Map<PanelType, PanelLayout>()
  for (const layout of layouts) {
    if (!firstByType.has(layout.panelType)) firstByType.set(layout.panelType, layout)
  }

  return CANONICAL_PANEL_LAYOUTS.map((canonical) => ({
    ...(firstByType.get(canonical.panelType) ?? canonical),
  }))
}

export function resetPanelLayoutSize(layout: PanelLayout): PanelLayout {
  const canonical = getCanonicalPanelLayout(layout.panelType)
  return {
    ...layout,
    x: layout.x + (layout.w - canonical.w) / 2,
    y: layout.y + (layout.h - canonical.h) / 2,
    w: canonical.w,
    h: canonical.h,
  }
}

export function resetAllPanelLayouts(): PanelLayout[] {
  return CANONICAL_PANEL_LAYOUTS.map((layout) => ({ ...layout }))
}

export function getCollectivePanelBounds(layouts: readonly PanelLayout[]) {
  if (!layouts.length) return null
  const minX = Math.min(...layouts.map((layout) => layout.x))
  const minY = Math.min(...layouts.map((layout) => layout.y))
  const maxX = Math.max(...layouts.map((layout) => layout.x + layout.w))
  const maxY = Math.max(...layouts.map((layout) => layout.y + layout.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
