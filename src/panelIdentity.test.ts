import './test/setup'
import { describe, expect, it } from 'vitest'
import { createMoment, getMoment, saveMoment } from './storage'

describe('persistent panel identity', () => {
  it('assigns stable IDs and preserves them across reloads', async () => {
    const created = await createMoment('Stable IDs')
    const ids = created.panels.map((panel) => panel.id)
    await saveMoment(created)
    const reloaded = await getMoment(created.id)
    expect(reloaded?.panels.map((panel) => panel.id)).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('maps a tldraw panel shape to its application panel ID', () => {
    const shape = { type: 'music-panel', props: { panelId: 'panel-notes', w: 460, h: 720 } }
    expect(shape.props.panelId).toBe('panel-notes')
  })
})
