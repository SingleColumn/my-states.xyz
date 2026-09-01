import './test/setup'
import { describe, expect, it } from 'vitest'
import { duplicatePanel } from './panelDuplication'
import { createSession, getSession, saveSession } from './storage'

describe('panel duplication', () => {
  it('creates a new ID while copying persistent state', async () => {
    const session = await createSession('Duplicate panels')
    const source = session.panels.find((panel) => panel.type === 'slideshow')!
    const duplicate = duplicatePanel(source, 123)
    if (!duplicate) throw new Error('Slideshow panel unexpectedly rejected for duplication')
    expect(duplicate.id).not.toBe(source.id)
    expect(duplicate.type).toBe(source.type)
    expect(duplicate.config).toEqual(source.config)
    expect(duplicate.config).not.toBe(source.config)

    await saveSession({ ...session, panels: [...session.panels, duplicate] })
    const reloaded = await getSession(session.id)
    expect(reloaded?.panels.filter((panel) => panel.type === 'slideshow')).toHaveLength(2)
    expect(reloaded?.panels.find((panel) => panel.id === source.id)?.config).toEqual(source.config)
    expect(reloaded?.panels.find((panel) => panel.id === duplicate.id)?.config).toEqual(duplicate.config)
  })

  it('keeps the remaining panel intact when one is removed', async () => {
    const session = await createSession('Delete duplicate')
    const source = session.panels.find((panel) => panel.type === 'notes')!
    const duplicate = duplicatePanel(source)
    if (!duplicate) throw new Error('Notes panel unexpectedly rejected for duplication')
    await saveSession({ ...session, panels: [...session.panels, duplicate] })
    await saveSession({ ...session, panels: session.panels.filter((panel) => panel.id !== source.id).concat(duplicate) })
    const reloaded = await getSession(session.id)
    expect(reloaded?.panels.some((panel) => panel.id === source.id)).toBe(false)
    expect(reloaded?.panels.find((panel) => panel.id === duplicate.id)).toEqual(duplicate)
  })
})
