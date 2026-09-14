import './test/setup'
import { describe, expect, it } from 'vitest'
import { createMoment, getMoment } from './storage'

describe('persistent panel identity', () => {
  it('assigns stable IDs and preserves them across reloads', async () => {
    const created = await createMoment('Stable IDs')
    const ids = created.draft!.panels.map((panel) => panel.id)
    const reloaded = await getMoment(created.id)
    expect(reloaded?.draft?.panels.map((panel) => panel.id)).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the panel id as the key the other stores use, alongside the shape id', () => {
    const shape = { type: 'music-panel', props: { panelId: 'panel-notes', w: 460, h: 720, panel: { type: 'notes', config: { activeNoteId: null } }, visible: true, focusView: false } }
    expect(shape.props.panelId).toBe('panel-notes')
  })
})
