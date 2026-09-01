import './test/setup'
import { describe, expect, it } from 'vitest'
import { duplicatePanel } from './panelDuplication'
import { addAllowedPanels } from './AppState'
import { createSession, getSession, importSessionContent, saveSession } from './storage'

type PanelRuntimeState = Record<string, unknown>
type PanelRuntimeAccessor = {
  forPanel(panelId: string): PanelRuntimeState
  update(panelId: string, patch: PanelRuntimeState): void
}
type RuntimeContract = {
  notes: PanelRuntimeAccessor
  slideshow: PanelRuntimeAccessor
  restorePanel(panelId: string): unknown
}

async function runtimeContract() {
  const appState = await import('./AppState')
  return (appState as unknown as { panelRuntime?: RuntimeContract }).panelRuntime
}

function twoPanelsOfType<T extends 'slideshow' | 'notes'>(session: Awaited<ReturnType<typeof createSession>>, type: T) {
  const source = session.panels.find((panel) => panel.type === type)
  if (!source) throw new Error(`Missing ${type} panel`)
  const duplicate = duplicatePanel(source)
  if (!duplicate) throw new Error(`Could not duplicate ${type} panel`)
  return { source, duplicate, session: { ...session, panels: [...session.panels, duplicate] } }
}

describe('runtime panel independence acceptance contract', () => {
  it('Notes panels must have panelId-keyed editor state and persistence', async () => {
    const setup = twoPanelsOfType(await createSession('Notes runtime acceptance'), 'notes')
    expect(setup.duplicate.id).not.toBe(setup.source.id)
    expect(setup.duplicate.config).toEqual(setup.source.config)
    await saveSession(setup.session)
    const reloaded = await getSession(setup.session.id)
    expect(reloaded?.panels.map((panel) => panel.id)).toEqual(expect.arrayContaining([setup.source.id, setup.duplicate.id]))

    const runtime = await runtimeContract()
    expect(runtime?.notes?.forPanel, 'Notes editor state must be addressable by panelId').toEqual(expect.any(Function))
    expect(runtime?.notes?.update, 'Notes edits must target panelId').toEqual(expect.any(Function))
    expect(runtime?.restorePanel, 'Notes state must restore by panelId').toEqual(expect.any(Function))
    const sourceState = runtime?.notes?.forPanel(setup.source.id)
    const duplicateState = runtime?.notes?.forPanel(setup.duplicate.id)
    expect(sourceState).not.toBe(duplicateState)
    runtime?.notes?.update(setup.source.id, { content: 'panel A note' })
    expect(runtime?.notes?.forPanel(setup.duplicate.id)).not.toMatchObject({ content: 'panel A note' })
  })

  it('slideshow panels must have panelId-keyed images, settings, and playback state', async () => {
    const setup = twoPanelsOfType(await createSession('Slideshow runtime acceptance'), 'slideshow')
    expect(setup.duplicate.id).not.toBe(setup.source.id)
    expect(setup.duplicate.config).toEqual(setup.source.config)
    await saveSession(setup.session)
    const reloaded = await getSession(setup.session.id)
    expect(reloaded?.panels.filter((panel) => panel.type === 'slideshow')).toHaveLength(2)

    const runtime = await runtimeContract()
    expect(runtime?.slideshow?.forPanel, 'Slideshow runtime state must be addressable by panelId').toEqual(expect.any(Function))
    expect(runtime?.slideshow?.update, 'Slideshow changes must target panelId').toEqual(expect.any(Function))
    expect(runtime?.restorePanel, 'Slideshow state must restore by panelId').toEqual(expect.any(Function))
    const sourceState = runtime?.slideshow?.forPanel(setup.source.id)
    const duplicateState = runtime?.slideshow?.forPanel(setup.duplicate.id)
    expect(sourceState).not.toBe(duplicateState)
    runtime?.slideshow?.update(setup.source.id, {
      imageSource: { type: 'bundled', collectionId: 'panel-a' },
      currentIndex: 4,
      isPlaying: true,
      intervalMs: 1200,
      shuffle: true,
      zoom: 1.5,
    })
    expect(runtime?.slideshow?.forPanel(setup.duplicate.id)).not.toMatchObject({ currentIndex: 4, isPlaying: true })
  })

  it('Spotify is a per-session singleton and cannot be duplicated', async () => {
    const session = await createSession('Spotify singleton acceptance')
    const source = session.panels.find((panel) => panel.type === 'spotify')!
    expect(duplicatePanel(source)).toBeNull()

    const attempted = { ...session, panels: [...session.panels, { ...source, id: 'spotify-second' }] }
    await saveSession(attempted)
    const reloaded = await getSession(session.id)
    expect(reloaded?.panels.filter((panel) => panel.type === 'spotify')).toHaveLength(1)
    expect(reloaded?.panels.find((panel) => panel.type === 'spotify')?.id).toBe(source.id)

    const additions = addAllowedPanels(session.panels, [source, { ...source, id: 'spotify-third' }])
    expect(additions.filter((panel) => panel.type === 'spotify')).toHaveLength(1)
    expect(additions.find((panel) => panel.type === 'spotify')?.id).toBe(source.id)

    const imported = await importSessionContent({
      name: 'Multiple Spotify import',
      panels: attempted.panels,
      canvas: attempted.canvas,
      slideshow: attempted.panels.find((panel) => panel.type === 'slideshow')!.config,
      spotify: source.config.playlist,
      activeNoteSourceId: null,
      notes: [],
      assets: [],
    })
    expect(imported.panels.filter((panel) => panel.type === 'spotify')).toHaveLength(1)
  })

  it('initialization must restore every panel by ID, not select the first panel of a type', async () => {
    const setup = twoPanelsOfType(await createSession('Initialization runtime acceptance'), 'notes')
    const runtime = await runtimeContract()
    expect(runtime?.restorePanel, 'Initialization must restore each persistent panel by panelId').toEqual(expect.any(Function))
    runtime?.restorePanel(setup.source.id)
    runtime?.restorePanel(setup.duplicate.id)
  })

  it('duplicated panels must expose independent runtime access by panelId', async () => {
    const setup = twoPanelsOfType(await createSession('Duplication runtime acceptance'), 'slideshow')
    expect(setup.source.id).not.toBe(setup.duplicate.id)
    expect(setup.duplicate.config).toEqual(setup.source.config)

    const runtime = await runtimeContract()
    expect(runtime?.slideshow?.forPanel, 'Duplicated panels must have independent runtime access by panelId').toEqual(expect.any(Function))
    const sourceState = runtime?.slideshow?.forPanel(setup.source.id)
    const duplicateState = runtime?.slideshow?.forPanel(setup.duplicate.id)
    expect(duplicateState).not.toBe(sourceState)
  })
})
