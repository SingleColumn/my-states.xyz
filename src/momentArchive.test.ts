import './test/setup'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { exportMomentArchive, importMomentArchive } from './momentArchive'
import {
  createMoment,
  defaultSlideshowSettings,
  getNotes,
  getMoment,
  getMomentAssets,
  saveNote,
  saveMoment,
  saveMomentAssets,
  saveSpotifyTokens,
  momentLimits,
} from './storage'

async function createCompleteArchive() {
  const moment = await createMoment('Archive source')
  const now = Date.now()
  const note = {
    id: 'note_source',
    sessionId: moment.id,
    title: 'Lyrics',
    content: '# A portable note\n\nSaved without credentials.',
    createdAt: now,
    updatedAt: now,
  }
  await saveNote(note)
  await saveMomentAssets(moment.id, [
    makeAsset('image_one', 'cover.png', new Uint8Array([137, 80, 78, 71])),
    makeAsset('image_two', 'scene.webp', new Uint8Array([82, 73, 70, 70])),
  ])
  await saveMoment({
    ...moment,
    panels: moment.panels.map((panel) => panel.type === 'notes' ? { ...panel, config: { activeNoteId: note.id } } : panel.type === 'slideshow' ? { ...panel, config: { ...panel.config, imageSource: { type: 'session-assets' }, intervalMs: 3500, shuffle: true } } : panel.type === 'spotify' ? { ...panel, config: { playlist: { id: 'playlist_123', uri: 'spotify:playlist:playlist_123', name: 'Focus', url: 'https://open.spotify.com/playlist/playlist_123' } } } : panel),
    canvas: {
      camera: { x: 120, y: -80, z: 1.25 },
      panels: [{ panelId: moment.panels.find((panel) => panel.type === 'notes')!.id, x: 1, y: 2, w: 300, h: 400, rotation: 0.25, order: 2 }],
    },
  })
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
    images: Array<{ path: string; mimeType: string }>
    notes: Array<{ path: string }>
    spotify: unknown
    slideshow: typeof defaultSlideshowSettings
  }
}

describe('portable moment archives', () => {
  it('exports and imports multiple slideshow panels independently', async () => {
    const source = await createMoment('Duplicate archive panels')
    const slideshow = source.panels.find((panel) => panel.type === 'slideshow')!
    const duplicate = { ...slideshow, id: 'slideshow_duplicate', config: { ...slideshow.config, currentIndex: 3, shuffle: true } }
    await saveMoment({ ...source, panels: [...source.panels, duplicate] })
    const imported = await importMomentArchive(asFile(await exportMomentArchive(source.id)))
    const slideshowPanels = (await getMoment(imported.id))?.panels.filter((panel) => panel.type === 'slideshow') ?? []
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

    expect(JSON.stringify(exportedManifest)).not.toContain('access-secret')
    expect(JSON.stringify(exportedManifest)).not.toContain('refresh-secret')
    expect(Object.values(entries).map((entry) => strFromU8(entry)).join('')).not.toContain('access-secret')

    const imported = await importMomentArchive(asFile(archive))
    const [stored, notes, assets] = await Promise.all([
      getMoment(imported.id),
      getNotes(imported.id),
      getMomentAssets(imported.id),
    ])

    expect(stored?.canvas?.camera).toEqual({ x: 120, y: -80, z: 1.25 })
    expect(stored?.canvas?.panels[0]).toMatchObject({ rotation: 0.25, order: 2 })
    expect(stored?.panels.find((panel) => panel.type === 'slideshow')?.config).toMatchObject({ intervalMs: 3500, shuffle: true })
    expect(stored?.panels.find((panel) => panel.type === 'spotify')?.config.playlist).toEqual(exportedManifest.spotify)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ title: 'Lyrics', content: '# A portable note\n\nSaved without credentials.' })
    expect(assets.map((asset) => asset.filename).sort()).toEqual(['cover.png', 'scene.webp'])
    expect(await assets[0].blob.arrayBuffer()).toBeInstanceOf(ArrayBuffer)
  })

  it('round-trips a moment without notes, images, or a Spotify playlist', async () => {
    const source = await createMoment('Empty archive')
    const archive = await exportMomentArchive(source.id)
    const imported = await importMomentArchive(asFile(archive))
    const [stored, notes, assets] = await Promise.all([getMoment(imported.id), getNotes(imported.id), getMomentAssets(imported.id)])

    expect(stored?.panels.find((panel) => panel.type === 'spotify')?.config.playlist).toEqual({ id: null, uri: null, name: null, url: null })
    expect(notes).toEqual([])
    expect(assets).toEqual([])
  })

  it('exports and imports a bundled collection reference without copying image blobs', async () => {
    const source = await createMoment('Sample archive')
    await saveMomentAssets(source.id, [makeAsset('inactive_local', 'inactive.png', new Uint8Array([1, 2, 3]))])
    await saveMoment({
      ...source,
      panels: source.panels.map((panel) => panel.type === 'slideshow' ? { ...panel, config: { ...defaultSlideshowSettings, folderName: 'eightbitstrana', imageSource: { type: 'bundled', collectionId: 'eightbitstrana' } } } : panel),
    })

    const archive = await exportMomentArchive(source.id)
    const entries = await archiveEntries(archive)
    const exportedManifest = manifest(entries)
    expect(exportedManifest.slideshow.imageSource).toEqual({ type: 'bundled', collectionId: 'eightbitstrana' })
    expect(exportedManifest.images).toEqual([])
    expect(Object.keys(entries).filter((path) => path.startsWith('images/'))).toEqual([])

    const imported = await importMomentArchive(asFile(archive))
    expect((await getMoment(imported.id))?.panels.find((panel) => panel.type === 'slideshow')?.config.imageSource).toEqual({ type: 'bundled', collectionId: 'eightbitstrana' })
    expect(await getMomentAssets(imported.id)).toEqual([])
  })

  it('imports an unavailable bundled collection reference without crashing or substituting it', async () => {
    const source = await createMoment('Unavailable sample')
    const entries = await archiveEntries(await exportMomentArchive(source.id))
    const sourceManifest = manifest(entries)
    sourceManifest.slideshow.imageSource = { type: 'bundled', collectionId: 'removed-sample' }
    sourceManifest.slideshow.folderName = 'removed-sample'
    entries['manifest.json'] = strToU8(JSON.stringify(sourceManifest))

    const imported = await importMomentArchive(asFile(new Blob([zipSync(entries)])))
    expect((await getMoment(imported.id))?.panels.find((panel) => panel.type === 'slideshow')?.config.imageSource).toEqual({ type: 'bundled', collectionId: 'removed-sample' })
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
  })
})
