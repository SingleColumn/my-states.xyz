import './test/setup'
import { openDB } from 'idb'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { exportMomentArchive, importMomentArchive } from './momentArchive'
import {
  createDefaultPanels,
  createMoment,
  defaultSlideshowSettings,
  getNotes,
  getMoment,
  getMomentAssets,
  importMomentContent,
  saveMomentAssets,
  saveSpotifyTokens,
  momentLimits,
  MOMENT_SCHEMA_VERSION,
} from './storage'
import { documentFromDraft, draftFromDocument } from './panelStore'
import type { CanvasState, Moment, Panel } from './types'

// Archives carry a moment as a draft: its own document, read back out.
const draftOf = (moment: Moment | undefined) => moment && draftFromDocument(moment.document, moment.camera)
const panelsOf = (moment: Moment | undefined) => draftOf(moment)?.panels ?? []

/** A stored moment with these panels, the way an import produces one. */
function storeMoment(name: string, panels: Panel[], canvas: CanvasState | null = null, notes: Parameters<typeof importMomentContent>[0]['notes'] = []) {
  return importMomentContent({ name, panels, canvas, notes, assets: [] })
}

const slideshowIn = (panels: Panel[]) => panels.find((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow')!

async function createCompleteArchive() {
  const now = Date.now()
  const note = { id: 'note_source', title: 'Lyrics', content: '# A portable note\n\nSaved without credentials.', createdAt: now, updatedAt: now }
  const panels = createDefaultPanels().map((panel): Panel => panel.type === 'notes' ? { ...panel, config: { activeNoteId: note.id } } : panel.type === 'slideshow' ? { ...panel, config: { ...panel.config, imageSource: { type: 'session-assets' }, intervalMs: 3500, shuffle: true } } : panel.type === 'spotify' ? { ...panel, config: { playlist: { id: 'playlist_123', uri: 'spotify:playlist:playlist_123', name: 'Focus', url: 'https://open.spotify.com/playlist/playlist_123' } } } : panel)
  const moment = await storeMoment('Archive source', panels, {
    camera: { x: 120, y: -80, z: 1.25 },
    panels: [{ panelId: panels.find((panel) => panel.type === 'notes')!.id, x: 1, y: 2, w: 300, h: 400, rotation: 0.25, order: 2 }],
  }, [note])
  await saveMomentAssets(moment.id, [
    makeAsset('image_one', 'cover.png', new Uint8Array([137, 80, 78, 71])),
    makeAsset('image_two', 'scene.webp', new Uint8Array([82, 73, 70, 70])),
  ])
  return exportMomentArchive(moment.id)
}

function makeAsset(id: string, filename: string, bytes: Uint8Array) {
  return {
    id,
    filename,
    name: filename,
    mimeType: filename.endsWith('.webp') ? 'image/webp' : 'image/png',
    size: bytes.byteLength,
    lastModified: 0,
    width: 1,
    height: 1,
    blob: new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]),
  }
}

function asFile(blob: Blob) {
  return blob as File
}

async function archiveEntries(blob: Blob) {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()))
}

function manifest(entries: Record<string, Uint8Array>) {
  return JSON.parse(strFromU8(entries['manifest.json'])) as {
    formatVersion: number
    images: Array<{ path: string; mimeType: string }>
    notes: Array<{ path: string }>
    panels: Panel[]
  }
}

describe('portable moment archives', () => {
  it('exports and imports multiple slideshow panels independently', async () => {
    const panels = createDefaultPanels()
    const slideshow = slideshowIn(panels)
    const duplicate: Panel = { ...slideshow, id: 'slideshow_duplicate', config: { ...slideshow.config, currentIndex: 3, shuffle: true } }
    const source = await storeMoment('Duplicate archive panels', [...panels, duplicate])
    const imported = await importMomentArchive(asFile(await exportMomentArchive(source.id)))
    const slideshowPanels = panelsOf(await getMoment(imported.id)).filter((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow')
    expect(slideshowPanels).toHaveLength(2)
    expect(new Set(slideshowPanels.map((panel) => panel.id)).size).toBe(2)
    expect(slideshowPanels.map((panel) => panel.config.currentIndex)).toEqual(expect.arrayContaining([0, 3]))
    expect(slideshowPanels.find((panel) => panel.config.currentIndex === 3)?.config.shuffle).toBe(true)
  })

  it('exports and imports notes, embedded images, canvas state, and a playlist reference without Spotify tokens', async () => {
    saveSpotifyTokens({ accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: Date.now() + 60_000 })
    const archive = await createCompleteArchive()
    const entries = await archiveEntries(archive)
    const exportedManifest = manifest(entries)

    expect(exportedManifest.formatVersion).toBe(2)
    expect(JSON.stringify(exportedManifest)).not.toContain('access-secret')
    expect(JSON.stringify(exportedManifest)).not.toContain('refresh-secret')
    expect(Object.values(entries).map((entry) => strFromU8(entry)).join('')).not.toContain('access-secret')

    const imported = await importMomentArchive(asFile(archive))
    const [stored, notes, assets] = await Promise.all([
      getMoment(imported.id),
      getNotes(imported.id),
      getMomentAssets(imported.id),
    ])

    expect(draftOf(stored)?.canvas?.camera).toEqual({ x: 120, y: -80, z: 1.25 })
    // Rotation is preserved verbatim; order is always a derived, 0-based
    // stacking position (panelStore.test.ts asserts the same), not the raw
    // number a layout happened to carry in. The Notes panel is given the
    // only explicit order (2) among three panels, which sorts it first.
    expect(draftOf(stored)?.canvas?.panels[0]).toMatchObject({ rotation: 0.25, order: 0 })
    expect(slideshowIn(panelsOf(stored)).config).toMatchObject({ intervalMs: 3500, shuffle: true })
    expect(panelsOf(stored).find((panel): panel is Panel<'spotify'> => panel.type === 'spotify')?.config.playlist).toEqual(exportedManifest.panels.find((panel): panel is Panel<'spotify'> => panel.type === 'spotify')!.config.playlist)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ title: 'Lyrics', content: '# A portable note\n\nSaved without credentials.' })
    // The Notes panel follows its note to the note's reissued id.
    expect(panelsOf(stored).find((panel): panel is Panel<'notes'> => panel.type === 'notes')?.config.activeNoteId).toBe(notes[0].id)
    expect(assets.map((asset) => asset.filename).sort()).toEqual(['cover.png', 'scene.webp'])
    expect(await assets[0].blob.arrayBuffer()).toBeInstanceOf(ArrayBuffer)
  })

  it('round-trips a moment without notes, images, or a Spotify playlist', async () => {
    const source = await createMoment('Empty archive')
    const archive = await exportMomentArchive(source.id)
    const imported = await importMomentArchive(asFile(archive))
    const [stored, notes, assets] = await Promise.all([getMoment(imported.id), getNotes(imported.id), getMomentAssets(imported.id)])

    expect(panelsOf(stored).find((panel): panel is Panel<'spotify'> => panel.type === 'spotify')?.config.playlist).toEqual({ id: null, uri: null, name: null, url: null })
    expect(notes).toEqual([])
    expect(assets).toEqual([])
  })

  it('exports and imports a bundled collection reference without copying image blobs', async () => {
    const source = await storeMoment('Sample archive', createDefaultPanels().map((panel): Panel => panel.type === 'slideshow' ? { ...panel, config: { ...defaultSlideshowSettings, folderName: 'eightbitstrana', imageSource: { type: 'bundled', collectionId: 'eightbitstrana' } } } : panel))
    await saveMomentAssets(source.id, [makeAsset('inactive_local', 'inactive.png', new Uint8Array([1, 2, 3]))])

    const archive = await exportMomentArchive(source.id)
    const entries = await archiveEntries(archive)
    const exportedManifest = manifest(entries)
    expect(slideshowIn(exportedManifest.panels).config.imageSource).toEqual({ type: 'bundled', collectionId: 'eightbitstrana' })
    expect(exportedManifest.images).toEqual([])
    expect(Object.keys(entries).filter((path) => path.startsWith('images/'))).toEqual([])

    const imported = await importMomentArchive(asFile(archive))
    expect(slideshowIn(panelsOf(await getMoment(imported.id))).config.imageSource).toEqual({ type: 'bundled', collectionId: 'eightbitstrana' })
    expect(await getMomentAssets(imported.id)).toEqual([])
  })

  it('imports an unavailable bundled collection reference without crashing or substituting it', async () => {
    const source = await createMoment('Unavailable sample')
    const entries = await archiveEntries(await exportMomentArchive(source.id))
    const sourceManifest = manifest(entries)
    slideshowIn(sourceManifest.panels).config.imageSource = { type: 'bundled', collectionId: 'removed-sample' }
    slideshowIn(sourceManifest.panels).config.folderName = 'removed-sample'
    entries['manifest.json'] = strToU8(JSON.stringify(sourceManifest))

    const imported = await importMomentArchive(asFile(new Blob([zipSync(entries)])))
    expect(slideshowIn(panelsOf(await getMoment(imported.id))).config.imageSource).toEqual({ type: 'bundled', collectionId: 'removed-sample' })
    expect(await getMomentAssets(imported.id)).toEqual([])
  })

  it('rejects corrupt, incomplete, unsafe, unsupported, and oversized archives', async () => {
    const archive = await createCompleteArchive()
    const entries = await archiveEntries(archive)
    const sourceManifest = manifest(entries)

    await expect(importMomentArchive(asFile(new Blob([zipSync({ 'manifest.json': strToU8('{not json') })])))).rejects.toThrow('manifest.json is not valid JSON')
    await expect(importMomentArchive(asFile(new Blob([zipSync({ '../manifest.json': strToU8('{}') })])))).rejects.toThrow('unsafe file path')

    const missingImage = { ...entries }
    delete missingImage[sourceManifest.images[0].path]
    await expect(importMomentArchive(asFile(new Blob([zipSync(missingImage)])))).rejects.toThrow('missing or duplicate image file')

    const unsupportedImage = { ...entries }
    const unsupportedManifest = manifest(unsupportedImage)
    unsupportedManifest.images[0].mimeType = 'image/tiff'
    unsupportedImage['manifest.json'] = strToU8(JSON.stringify(unsupportedManifest))
    await expect(importMomentArchive(asFile(new Blob([zipSync(unsupportedImage)])))).rejects.toThrow('invalid image')

    const oversized = { size: momentLimits.maxArchiveBytes + 1, arrayBuffer: vi.fn() } as unknown as File
    await expect(importMomentArchive(oversized)).rejects.toThrow('exceeds the 260 MB limit')

    // A negative index or a sub-100ms interval would reach the canvas
    // uncorrected (AppState.tsx only resets an index the image count has
    // outgrown, never a negative one, and a tiny interval would put the
    // slideshow's own timer in a near-continuous loop).
    const outOfBoundsIndex = { ...entries }
    const outOfBoundsIndexManifest = manifest(outOfBoundsIndex)
    slideshowIn(outOfBoundsIndexManifest.panels).config.currentIndex = -1
    outOfBoundsIndex['manifest.json'] = strToU8(JSON.stringify(outOfBoundsIndexManifest))
    await expect(importMomentArchive(asFile(new Blob([zipSync(outOfBoundsIndex)])))).rejects.toThrow()

    const tooFastInterval = { ...entries }
    const tooFastIntervalManifest = manifest(tooFastInterval)
    slideshowIn(tooFastIntervalManifest.panels).config.intervalMs = 1
    tooFastInterval['manifest.json'] = strToU8(JSON.stringify(tooFastIntervalManifest))
    await expect(importMomentArchive(asFile(new Blob([zipSync(tooFastInterval)])))).rejects.toThrow()
  })

  it('sanitizes a Notes panel pointing at a note the moment no longer has, rather than exporting a backup that cannot be restored', async () => {
    // Two Notes panels can end up pointing at the same note; deleting it
    // through one panel does not clear the other's reference (a separate,
    // pre-existing bug). Simulate that state directly, at the document
    // level (the only level a moment is ever stored at), since import's own
    // remap would otherwise heal it before this code ever saw it.
    const defaultPanels = createDefaultPanels()
    const notesPanel = defaultPanels.find((panel): panel is Panel<'notes'> => panel.type === 'notes')!
    const danglingPanels: Panel[] = [
      ...defaultPanels.filter((panel) => panel.type !== 'notes'),
      { ...notesPanel, config: { activeNoteId: 'ghost-note' } },
      { ...notesPanel, id: 'notes-panel-two', config: { activeNoteId: 'ghost-note' } },
    ]
    const moment: Moment = {
      id: 'dangling-reference',
      name: 'Dangling reference',
      schemaVersion: MOMENT_SCHEMA_VERSION,
      createdAt: 1,
      updatedAt: 2,
      camera: null,
      document: documentFromDraft({ panels: danglingPanels, canvas: null }),
    }
    const db = await openDB('my-states')
    await db.put('moments', moment)
    db.close()

    const entries = await archiveEntries(await exportMomentArchive(moment.id))
    const exportedManifest = manifest(entries)
    const notesPanels = exportedManifest.panels.filter((panel): panel is Panel<'notes'> => panel.type === 'notes')
    expect(notesPanels).toHaveLength(2)
    expect(notesPanels.every((panel) => panel.config.activeNoteId === null)).toBe(true)

    const imported = await importMomentArchive(asFile(new Blob([zipSync(entries)])))
    expect(panelsOf(await getMoment(imported.id)).filter((panel) => panel.type === 'notes')).toHaveLength(2)
  })

  it('refuses a file from the earlier format with a message that says which version wrote it', async () => {
    const entries = await archiveEntries(await exportMomentArchive((await createMoment('Current format')).id))
    const older = { ...manifest(entries), formatVersion: 1 }
    entries['manifest.json'] = strToU8(JSON.stringify(older))
    await expect(importMomentArchive(asFile(new Blob([zipSync(entries)])))).rejects.toThrow('exported by an earlier version of my-states')

    const unknown = { ...manifest(entries), formatVersion: 99 }
    entries['manifest.json'] = strToU8(JSON.stringify(unknown))
    await expect(importMomentArchive(asFile(new Blob([zipSync(entries)])))).rejects.toThrow('unsupported format version')
  })
})
