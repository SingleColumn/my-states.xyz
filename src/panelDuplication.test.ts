import './test/setup'
import { describe, expect, it } from 'vitest'
import { duplicatePanel } from './panelDuplication'
import { createPanel, createMoment, getMoment, saveMoment } from './storage'

describe('panel duplication', () => {
  it('creates a fresh persistent panel for each add-panel type', () => {
    const music = createPanel('spotify', 123)
    const images = createPanel('slideshow', 123)
    const notes = createPanel('notes', 123)

    expect(new Set([music.id, images.id, notes.id]).size).toBe(3)
    expect(music.type).toBe('spotify')
    expect(images.type).toBe('slideshow')
    expect(notes.type).toBe('notes')
    expect(notes).toMatchObject({ type: 'notes', config: { activeNoteId: null } })
  })

  it('creates a new ID while copying persistent state', async () => {
    const moment = await createMoment('Duplicate panels')
    const source = moment.panels.find((panel) => panel.type === 'slideshow')!
    const duplicate = duplicatePanel(source, 123)
    if (!duplicate) throw new Error('Slideshow panel unexpectedly rejected for duplication')
    expect(duplicate.id).not.toBe(source.id)
    expect(duplicate.type).toBe(source.type)
    expect(duplicate.config).toEqual(source.config)
    expect(duplicate.config).not.toBe(source.config)

    await saveMoment({ ...moment, panels: [...moment.panels, duplicate] })
    const reloaded = await getMoment(moment.id)
    expect(reloaded?.panels.filter((panel) => panel.type === 'slideshow')).toHaveLength(2)
    expect(reloaded?.panels.find((panel) => panel.id === source.id)?.config).toEqual(source.config)
    expect(reloaded?.panels.find((panel) => panel.id === duplicate.id)?.config).toEqual(duplicate.config)
  })

  it('keeps the remaining panel intact when one is removed', async () => {
    const moment = await createMoment('Delete duplicate')
    const source = moment.panels.find((panel) => panel.type === 'notes')!
    const duplicate = duplicatePanel(source)
    if (!duplicate) throw new Error('Notes panel unexpectedly rejected for duplication')
    await saveMoment({ ...moment, panels: [...moment.panels, duplicate] })
    await saveMoment({ ...moment, panels: moment.panels.filter((panel) => panel.id !== source.id).concat(duplicate) })
    const reloaded = await getMoment(moment.id)
    expect(reloaded?.panels.some((panel) => panel.id === source.id)).toBe(false)
    expect(reloaded?.panels.find((panel) => panel.id === duplicate.id)).toEqual(duplicate)
  })
})
