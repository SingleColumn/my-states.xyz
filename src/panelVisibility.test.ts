import { describe, expect, it } from 'vitest'
import { getCollectivePanelBounds, getRenderablePanelLayouts, resetAllPanelLayouts, setPanelVisibility, showAllPanels } from './panelLayout'
import { exportSessionArchive, importSessionArchive } from './sessionArchive'
import { createDefaultPanels, createSession, getSession, saveSession } from './storage'
import type { CanvasState, Panel, Session } from './types'

function sessionWithCanvas(name = 'Visibility test'): Session {
  const panels = createDefaultPanels(1)
  return {
    id: `session_${name.replaceAll(' ', '_')}`,
    name,
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    panels,
    canvas: {
      camera: { x: 0, y: 0, z: 1 },
      panels: panels.map((panel, index) => ({ panelId: panel.id, x: index * 500, y: 0, w: 400, h: 300, order: index })),
    },
  }
}

describe('persistent panel visibility', () => {
  it('hides and restores one panel by ID without changing another same-type panel', () => {
    const session = sessionWithCanvas()
    const slideshow = session.panels.find((panel) => panel.type === 'slideshow')!
    const duplicate = { ...slideshow, id: 'panel_slideshow_two', config: { ...slideshow.config, currentIndex: 7 } }
    const panels = [...session.panels, duplicate]
    const hidden = setPanelVisibility(panels, slideshow.id, false)
    expect(hidden.find((panel) => panel.id === slideshow.id)?.visible).toBe(false)
    expect(hidden.find((panel) => panel.id === duplicate.id)?.visible).toBeUndefined()
    const restored = setPanelVisibility(hidden, slideshow.id, true)
    expect(restored.find((panel) => panel.id === slideshow.id)?.visible).toBe(true)
    expect(restored.find((panel) => panel.id === duplicate.id)?.config).toEqual(duplicate.config)
  })

  it('preserves hidden panel geometry and excludes it from Fit all layouts', () => {
    const session = sessionWithCanvas()
    const hiddenId = session.panels[0].id
    const panels = setPanelVisibility(session.panels, hiddenId, false)
    const layouts = getRenderablePanelLayouts(panels, session.canvas)
    expect(layouts.map((layout) => layout.panelId)).not.toContain(hiddenId)
    expect(session.canvas!.panels.find((layout) => layout.panelId === hiddenId)?.w).toBe(400)
    expect(getCollectivePanelBounds(layouts)).toEqual({ x: 500, y: 0, w: 900, h: 300 })
  })

  it('uses sensible visible defaults when visibility metadata is absent', () => {
    const session = sessionWithCanvas()
    const legacyPanels = session.panels.map(({ visible: _visible, ...panel }) => panel) as Panel[]
    expect(getRenderablePanelLayouts(legacyPanels, session.canvas)).toHaveLength(3)
  })

  it('does not recreate a persistent panel whose canvas shape was deleted', () => {
    const session = sessionWithCanvas()
    const deletedId = session.panels[1].id
    const canvasAfterShapeDeletion = {
      ...session.canvas!,
      panels: session.canvas!.panels.filter((layout) => layout.panelId !== deletedId),
    }
    expect(getRenderablePanelLayouts(session.panels, canvasAfterShapeDeletion).map((layout) => layout.panelId)).not.toContain(deletedId)
  })

  it('keeps deletion distinct from hiding', () => {
    const session = sessionWithCanvas()
    const hiddenId = session.panels[0].id
    const hidden = setPanelVisibility(session.panels, hiddenId, false)
    expect(hidden).toHaveLength(session.panels.length)
    expect(hidden.find((panel) => panel.id === hiddenId)).toBeDefined()
    expect(session.canvas!.panels.find((layout) => layout.panelId === hiddenId)).toBeDefined()
  })

  it('leaves no panel hidden after a layout reset, so nothing is left to restore', () => {
    const session = sessionWithCanvas()
    const hiddenId = session.panels[2].id
    const panels = setPanelVisibility(session.panels, hiddenId, false)
    const shown = showAllPanels(panels)
    expect(shown.filter((panel) => panel.visible === false)).toHaveLength(0)
    expect(getRenderablePanelLayouts(shown, session.canvas).map((layout) => layout.panelId)).toContain(hiddenId)
    expect(shown.find((panel) => panel.id === hiddenId)?.config).toEqual(panels.find((panel) => panel.id === hiddenId)?.config)
  })

  it('resets hidden and visible panel geometry while preserving panel state', () => {
    const session = sessionWithCanvas()
    const hiddenId = session.panels[1].id
    const panels = setPanelVisibility(session.panels, hiddenId, false)
    const changed = { ...panels[2], config: { ...panels[2].config, activeNoteId: 'note_kept' } }
    const nextPanels = panels.map((panel) => panel.id === changed.id ? changed : panel)
    const reset = resetAllPanelLayouts(nextPanels)
    expect(reset).toHaveLength(nextPanels.length)
    expect(reset.find((layout) => layout.panelId === hiddenId)).toBeDefined()
    expect(nextPanels.find((panel) => panel.id === changed.id)?.config).toEqual(changed.config)
  })
})

describe('stored panel visibility', () => {
  it('survives reload and session switching', async () => {
    const first = await createSession('Visibility first')
    const firstPanel = first.panels[1]
    await saveSession({ ...first, panels: setPanelVisibility(first.panels, firstPanel.id, false) })
    const second = await createSession('Visibility second')
    const secondPanel = second.panels[2]
    await saveSession({ ...second, panels: setPanelVisibility(second.panels, secondPanel.id, false) })

    expect((await getSession(first.id))?.panels.find((panel) => panel.id === firstPanel.id)?.visible).toBe(false)
    expect((await getSession(second.id))?.panels.find((panel) => panel.id === secondPanel.id)?.visible).toBe(false)
    expect((await getSession(first.id))?.panels.find((panel) => panel.id === secondPanel.id)).toBeUndefined()
  })

  it('survives archive export and import with the same panel state and geometry', async () => {
    const source = await createSession('Visibility archive')
    const hidden = source.panels[1]
    const canvas: CanvasState = {
      camera: { x: 12, y: -8, z: 1.4 },
      panels: source.panels.map((panel, index) => ({ panelId: panel.id, x: index * 600, y: 20, w: 510, h: 610, order: index })),
    }
    await saveSession({ ...source, panels: setPanelVisibility(source.panels, hidden.id, false), canvas })
    const imported = await importSessionArchive((await exportSessionArchive(source.id)) as File)
    const loaded = await getSession(imported.id)
    const importedHidden = loaded?.panels.find((panel) => panel.type === hidden.type)
    expect(importedHidden?.visible).toBe(false)
    expect(loaded?.canvas?.panels.find((layout) => layout.panelId === importedHidden?.id)?.w).toBe(510)
  })
})
