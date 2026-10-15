import './test/setup'
import { openDB } from 'idb'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { duplicateBoard, exportBoardArchive, importBoardArchive, peekBoardArchiveName } from './boardArchive'
import {
  createDefaultPanels,
  createBoard,
  defaultSlideshowSettings,
  getNotes,
  getBoard,
  getBoardAssets,
  getBoardSummaries,
  importBoardContent,
  saveBoardAssets,
  saveSpotifyTokens,
  boardLimits,
  BOARD_SCHEMA_VERSION,
  getStoredTheme,
  importStoredTheme,
  setBoardTheme,
} from './storage'
import type { ThemeDefinition } from './themes/types'
import { documentFromDraft, draftFromDocument } from './panelStore'
import type { CanvasState, Board, Panel } from './types'

// Archives carry a board as a draft: its own document, read back out.
const draftOf = (board: Board | undefined) => board && draftFromDocument(board.document, board.camera)
const panelsOf = (board: Board | undefined) => draftOf(board)?.panels ?? []

/** A stored board with these panels, the way an import produces one. */
function storeBoard(name: string, panels: Panel[], canvas: CanvasState | null = null, notes: Parameters<typeof importBoardContent>[0]['notes'] = []) {
  return importBoardContent({ name, panels, canvas, notes, assets: [] })
}

const slideshowIn = (panels: Panel[]) => panels.find((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow')!

async function createCompleteArchive() {
  const now = Date.now()
  const note = { id: 'note_source', title: 'Lyrics', content: '# A portable note\n\nSaved without credentials.', createdAt: now, updatedAt: now }
  const panels = createDefaultPanels().map((panel): Panel => panel.type === 'notes' ? { ...panel, config: { activeNoteId: note.id } } : panel.type === 'slideshow' ? { ...panel, config: { ...panel.config, imageSource: { type: 'session-assets' }, intervalMs: 3500, shuffle: true } } : panel.type === 'spotify' ? { ...panel, config: { playlist: { id: 'playlist_123', uri: 'spotify:playlist:playlist_123', name: 'Focus', url: 'https://open.spotify.com/playlist/playlist_123' } } } : panel)
  const board = await storeBoard('Archive source', panels, {
    camera: { x: 120, y: -80, z: 1.25 },
    panels: [{ panelId: panels.find((panel) => panel.type === 'notes')!.id, x: 1, y: 2, w: 300, h: 400, rotation: 0.25, order: 2 }],
  }, [note])
  await saveBoardAssets(board.id, [
    makeAsset('image_one', 'cover.png', new Uint8Array([137, 80, 78, 71])),
    makeAsset('image_two', 'scene.webp', new Uint8Array([82, 73, 70, 70])),
  ])
  return exportBoardArchive(board.id)
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
    theme?: { id: string; definition?: ThemeDefinition }
    images: Array<{ path: string; mimeType: string; panelIds?: string[]; attribution?: { creator: string; creatorUrl?: string; sourceUrl?: string } }>
    notes: Array<{ path: string }>
    panels: Panel[]
  }
}

const customTheme = (id: string, name = 'Custom'): ThemeDefinition => ({ schemaVersion: 1, id, name, version: '1.0.0', modes: { dark: { foundation: { color: { accent: '#f0f' } } } } })

describe('the theme a board archive carries', () => {
  it('carries nothing for a board that follows the global theme, and imports one as such', async () => {
    const entries = await archiveEntries(await exportBoardArchive((await createBoard('Follows global')).id))
    expect('theme' in manifest(entries)).toBe(false)
    const { board, theme } = await importBoardArchive(asFile(new Blob([zipSync(entries)])))
    expect('themeId' in (await getBoard(board.id))!).toBe(false)
    expect(theme).toBeUndefined()
  })

  it('carries a built-in theme by id alone', async () => {
    const source = await createBoard('Pinned to a built-in')
    await setBoardTheme(source.id, 'terminal')
    const entries = await archiveEntries(await exportBoardArchive(source.id))
    expect(manifest(entries).theme).toEqual({ id: 'terminal' })
    const { board } = await importBoardArchive(asFile(new Blob([zipSync(entries)])))
    expect((await getBoard(board.id))?.themeId).toBe('terminal')
  })

  it('embeds an imported theme and installs it on import, so the board looks the same elsewhere', async () => {
    await importStoredTheme(customTheme('travelling'))
    const source = await createBoard('Pinned to an import')
    await setBoardTheme(source.id, 'travelling')
    const entries = await archiveEntries(await exportBoardArchive(source.id))
    expect(manifest(entries).theme).toEqual({ id: 'travelling', definition: customTheme('travelling') })

    // Same library: the identical theme is recognised, not duplicated.
    const same = await importBoardArchive(asFile(new Blob([zipSync(entries)])))
    expect(same.theme).toEqual({ name: 'Custom', outcome: 'existing' })
    expect((await getBoard(same.board.id))?.themeId).toBe('travelling')

    // A different theme already holds the id: the embedded one is filed
    // under a new id and the board pins that, never replacing the local one.
    const withNotes = { ...manifest(entries), theme: { id: 'travelling', definition: customTheme('travelling', 'A stranger') } }
    entries['manifest.json'] = strToU8(JSON.stringify(withNotes))
    const renamed = await importBoardArchive(asFile(new Blob([zipSync(entries)])))
    expect(renamed.theme).toEqual({ name: 'A stranger', outcome: 'renamed' })
    expect((await getBoard(renamed.board.id))?.themeId).toBe('travelling-2')
    expect((await getStoredTheme('travelling'))?.definition.name).toBe('Custom')
    expect((await getStoredTheme('travelling-2'))?.definition.name).toBe('A stranger')
  })

  it('keeps the id of a pinned theme that is not installed, on export and on import', async () => {
    const source = await createBoard('Pinned to a missing theme')
    await setBoardTheme(source.id, 'somewhere-else')
    const entries = await archiveEntries(await exportBoardArchive(source.id))
    expect(manifest(entries).theme).toEqual({ id: 'somewhere-else' })
    const { board } = await importBoardArchive(asFile(new Blob([zipSync(entries)])))
    expect((await getBoard(board.id))?.themeId).toBe('somewhere-else')
  })

  it('refuses a theme reference that is malformed, invalid, or filed under a different id', async () => {
    const entries = await archiveEntries(await exportBoardArchive((await createBoard('Bad theme')).id))
    const base = manifest(entries)
    for (const theme of [
      { id: 'Not An Id' },
      { id: 'x', definition: { ...customTheme('x'), modes: {} } },
      { id: 'x', definition: customTheme('y') },
      { id: 'x', definition: { ...customTheme('x'), modes: { dark: { components: { canvas: { backdrop: 'url(https://evil)' } } } } } },
    ]) {
      entries['manifest.json'] = strToU8(JSON.stringify({ ...base, theme }))
      await expect(importBoardArchive(asFile(new Blob([zipSync(entries)]))), JSON.stringify(theme)).rejects.toThrow()
    }
  })
})

describe('portable board archives', () => {
  it('exports and imports multiple slideshow panels independently', async () => {
    const panels = createDefaultPanels()
    const slideshow = slideshowIn(panels)
    const duplicate: Panel = { ...slideshow, id: 'slideshow_duplicate', config: { ...slideshow.config, currentIndex: 3, shuffle: true } }
    const source = await storeBoard('Duplicate archive panels', [...panels, duplicate])
    const { board: imported } = await importBoardArchive(asFile(await exportBoardArchive(source.id)))
    const slideshowPanels = panelsOf(await getBoard(imported.id)).filter((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow')
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

    expect(exportedManifest.formatVersion).toBe(3)
    expect(JSON.stringify(exportedManifest)).not.toContain('access-secret')
    expect(JSON.stringify(exportedManifest)).not.toContain('refresh-secret')
    expect(Object.values(entries).map((entry) => strFromU8(entry)).join('')).not.toContain('access-secret')

    const { board: imported } = await importBoardArchive(asFile(archive))
    const [stored, notes, assets] = await Promise.all([
      getBoard(imported.id),
      getNotes(imported.id),
      getBoardAssets(imported.id),
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

  it('round-trips a board without notes, images, or a Spotify playlist', async () => {
    const source = await createBoard('Empty archive')
    const archive = await exportBoardArchive(source.id)
    const { board: imported } = await importBoardArchive(asFile(archive))
    const [stored, notes, assets] = await Promise.all([getBoard(imported.id), getNotes(imported.id), getBoardAssets(imported.id)])

    expect(panelsOf(stored).find((panel): panel is Panel<'spotify'> => panel.type === 'spotify')?.config.playlist).toEqual({ id: null, uri: null, name: null, url: null })
    expect(notes).toEqual([])
    expect(assets).toEqual([])
  })

  it('continues to import portable archives written in format version 2', async () => {
    const entries = await archiveEntries(await createCompleteArchive())
    const previous = manifest(entries)
    previous.formatVersion = 2
    entries['manifest.json'] = strToU8(JSON.stringify(previous))
    const { board } = await importBoardArchive(asFile(new Blob([zipSync(entries)])))
    expect(await getBoard(board.id)).toBeTruthy()
  })

  it('exports and imports a bundled collection reference without copying image blobs', async () => {
    const source = await storeBoard('Sample archive', createDefaultPanels().map((panel): Panel => panel.type === 'slideshow' ? { ...panel, config: { ...defaultSlideshowSettings, folderName: 'eightbitstrana', imageSource: { type: 'bundled', collectionId: 'eightbitstrana' } } } : panel))
    await saveBoardAssets(source.id, [makeAsset('inactive_local', 'inactive.png', new Uint8Array([1, 2, 3]))])

    const archive = await exportBoardArchive(source.id)
    const entries = await archiveEntries(archive)
    const exportedManifest = manifest(entries)
    expect(slideshowIn(exportedManifest.panels).config.imageSource).toEqual({ type: 'bundled', collectionId: 'eightbitstrana' })
    expect(exportedManifest.images).toEqual([])
    expect(Object.keys(entries).filter((path) => path.startsWith('images/'))).toEqual([])

    const { board: imported } = await importBoardArchive(asFile(archive))
    expect(slideshowIn(panelsOf(await getBoard(imported.id))).config.imageSource).toEqual({ type: 'bundled', collectionId: 'eightbitstrana' })
    expect(await getBoardAssets(imported.id)).toEqual([])
  })

  it('embeds curated images once, preserves attribution, and restores each panel from session assets', async () => {
    const panels = createDefaultPanels()
    const first = slideshowIn(panels)
    const second: Panel<'slideshow'> = { ...first, id: 'second_slideshow', config: { ...first.config } }
    const curatedPanels = [...panels, second].map((panel): Panel => panel.type === 'slideshow'
      ? { ...panel, config: { ...panel.config, folderName: 'Autumn', imageSource: { type: 'curated', collectionSlug: 'autumn' } } }
      : panel)
    const source = await storeBoard('Curated archive', curatedPanels)
    const baseUrl = 'https://cdn.example/export'
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('.json')) expect(init?.cache).toBe('no-store')
      if (url === `${baseUrl}/collections/index.json`) return Response.json({
        manifest_version: 1,
        generated_at: '2026-10-02T08:01:00Z',
        collections: [{ slug: 'autumn', title: 'Autumn', kind: 'creator', creator: 'rbnks', version: 3, published_at: '2026-10-02T08:00:00Z', count: 1, manifest: 'collections/autumn/latest.json' }],
      })
      if (url === `${baseUrl}/collections/autumn/latest.json`) return Response.json({
        manifest_version: 1,
        slug: 'autumn',
        title: 'Autumn',
        kind: 'creator',
        creator: 'rbnks',
        version: 3,
        published_at: '2026-10-02T08:00:00Z',
        count: 1,
        items: [{ position: 0, id: 'shared-image', file: 'images/ab/shared-image.jpg', thumb: 'thumbs/ab/shared-image.webp', width: 1200, height: 1600, source: 'rbnks', source_url: 'https://www.instagram.com/p/example/' }],
      })
      if (url === `${baseUrl}/images/ab/shared-image.jpg`) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch

    const archive = await exportBoardArchive(source.id, { fetcher, curatedBaseUrl: baseUrl })
    const entries = await archiveEntries(archive)
    const exportedManifest = manifest(entries)
    expect(exportedManifest.images).toHaveLength(1)
    expect(exportedManifest.images[0]).toMatchObject({
      panelIds: expect.arrayContaining(exportedManifest.panels.filter((panel) => panel.type === 'slideshow').map((panel) => panel.id)),
      attribution: { creator: 'rbnks', creatorUrl: 'https://www.instagram.com/rbnks/', sourceUrl: 'https://www.instagram.com/p/example/' },
    })
    expect(Object.keys(entries).filter((path) => path.startsWith('images/'))).toHaveLength(1)
    expect(exportedManifest.panels.filter((panel) => panel.type === 'slideshow').every((panel) => panel.config.imageSource.type === 'session-assets')).toBe(true)

    const { board: imported } = await importBoardArchive(asFile(archive))
    const importedPanels = panelsOf(await getBoard(imported.id)).filter((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow')
    expect(importedPanels).toHaveLength(2)
    expect(importedPanels.every((panel) => panel.config.imageSource.type === 'session-assets' && panel.config.folderName === 'Autumn')).toBe(true)
    expect(await getBoardAssets(imported.id)).toHaveLength(1)
    for (const panel of importedPanels) {
      expect(await getBoardAssets(imported.id, panel.id)).toEqual([
        expect.objectContaining({ attribution: { creator: 'rbnks', creatorUrl: 'https://www.instagram.com/rbnks/', sourceUrl: 'https://www.instagram.com/p/example/' } }),
      ])
    }
  })

  it('imports an unavailable bundled collection reference without crashing or substituting it', async () => {
    const source = await createBoard('Unavailable sample')
    const entries = await archiveEntries(await exportBoardArchive(source.id))
    const sourceManifest = manifest(entries)
    slideshowIn(sourceManifest.panels).config.imageSource = { type: 'bundled', collectionId: 'removed-sample' }
    slideshowIn(sourceManifest.panels).config.folderName = 'removed-sample'
    entries['manifest.json'] = strToU8(JSON.stringify(sourceManifest))

    const { board: imported } = await importBoardArchive(asFile(new Blob([zipSync(entries)])))
    expect(slideshowIn(panelsOf(await getBoard(imported.id))).config.imageSource).toEqual({ type: 'bundled', collectionId: 'removed-sample' })
    expect(await getBoardAssets(imported.id)).toEqual([])
  })

  it('rejects corrupt, incomplete, unsafe, unsupported, and oversized archives', async () => {
    const archive = await createCompleteArchive()
    const entries = await archiveEntries(archive)
    const sourceManifest = manifest(entries)

    await expect(importBoardArchive(asFile(new Blob([zipSync({ 'manifest.json': strToU8('{not json') })])))).rejects.toThrow('manifest.json is not valid JSON')
    await expect(importBoardArchive(asFile(new Blob([zipSync({ '../manifest.json': strToU8('{}') })])))).rejects.toThrow('unsafe file path: "../manifest.json"')

    const missingImage = { ...entries }
    delete missingImage[sourceManifest.images[0].path]
    await expect(importBoardArchive(asFile(new Blob([zipSync(missingImage)])))).rejects.toThrow('missing or duplicate image file')

    const unsupportedImage = { ...entries }
    const unsupportedManifest = manifest(unsupportedImage)
    unsupportedManifest.images[0].mimeType = 'image/tiff'
    unsupportedImage['manifest.json'] = strToU8(JSON.stringify(unsupportedManifest))
    await expect(importBoardArchive(asFile(new Blob([zipSync(unsupportedImage)])))).rejects.toThrow('invalid image')

    const oversized = { size: boardLimits.maxArchiveBytes + 1, arrayBuffer: vi.fn() } as unknown as File
    await expect(importBoardArchive(oversized)).rejects.toThrow('exceeds the 260 MB limit')

    // A negative index or a sub-100ms interval would reach the canvas
    // uncorrected (AppState.tsx only resets an index the image count has
    // outgrown, never a negative one, and a tiny interval would put the
    // slideshow's own timer in a near-continuous loop).
    const outOfBoundsIndex = { ...entries }
    const outOfBoundsIndexManifest = manifest(outOfBoundsIndex)
    slideshowIn(outOfBoundsIndexManifest.panels).config.currentIndex = -1
    outOfBoundsIndex['manifest.json'] = strToU8(JSON.stringify(outOfBoundsIndexManifest))
    await expect(importBoardArchive(asFile(new Blob([zipSync(outOfBoundsIndex)])))).rejects.toThrow()

    const tooFastInterval = { ...entries }
    const tooFastIntervalManifest = manifest(tooFastInterval)
    slideshowIn(tooFastIntervalManifest.panels).config.intervalMs = 1
    tooFastInterval['manifest.json'] = strToU8(JSON.stringify(tooFastIntervalManifest))
    await expect(importBoardArchive(asFile(new Blob([zipSync(tooFastInterval)])))).rejects.toThrow()
  })

  it('sanitizes a Notes panel pointing at a note the board no longer has, rather than exporting a backup that cannot be restored', async () => {
    // Two Notes panels can end up pointing at the same note; deleting it
    // through one panel does not clear the other's reference (a separate,
    // pre-existing bug). Simulate that state directly, at the document
    // level (the only level a board is ever stored at), since import's own
    // remap would otherwise heal it before this code ever saw it.
    const defaultPanels = createDefaultPanels()
    const notesPanel = defaultPanels.find((panel): panel is Panel<'notes'> => panel.type === 'notes')!
    const danglingPanels: Panel[] = [
      ...defaultPanels.filter((panel) => panel.type !== 'notes'),
      { ...notesPanel, config: { activeNoteId: 'ghost-note' } },
      { ...notesPanel, id: 'notes-panel-two', config: { activeNoteId: 'ghost-note' } },
    ]
    const board: Board = {
      id: 'dangling-reference',
      name: 'Dangling reference',
      schemaVersion: BOARD_SCHEMA_VERSION,
      createdAt: 1,
      updatedAt: 2,
      camera: null,
      document: documentFromDraft({ panels: danglingPanels, canvas: null }),
    }
    const db = await openDB('my-states')
    await db.put('boards', board)
    db.close()

    const entries = await archiveEntries(await exportBoardArchive(board.id))
    const exportedManifest = manifest(entries)
    const notesPanels = exportedManifest.panels.filter((panel): panel is Panel<'notes'> => panel.type === 'notes')
    expect(notesPanels).toHaveLength(2)
    expect(notesPanels.every((panel) => panel.config.activeNoteId === null)).toBe(true)

    const { board: imported } = await importBoardArchive(asFile(new Blob([zipSync(entries)])))
    expect(panelsOf(await getBoard(imported.id)).filter((panel) => panel.type === 'notes')).toHaveLength(2)
  })

  it('refuses a file from the earlier format with a message that says which version wrote it', async () => {
    const entries = await archiveEntries(await exportBoardArchive((await createBoard('Current format')).id))
    const older = { ...manifest(entries), formatVersion: 1 }
    entries['manifest.json'] = strToU8(JSON.stringify(older))
    await expect(importBoardArchive(asFile(new Blob([zipSync(entries)])))).rejects.toThrow('exported by an earlier version of my-states')

    const unknown = { ...manifest(entries), formatVersion: 99 }
    entries['manifest.json'] = strToU8(JSON.stringify(unknown))
    await expect(importBoardArchive(asFile(new Blob([zipSync(entries)])))).rejects.toThrow('unsupported format version')
  })
})

describe('directory-marker entries', () => {
  it('imports a board fine when the archive was re-zipped with an empty directory entry, the way Explorer\'s "Compress to ZIP file" writes one for a subfolder', async () => {
    const entries = await archiveEntries(await createCompleteArchive())
    entries['notes/'] = new Uint8Array(0)
    entries['images/'] = new Uint8Array(0)

    const { board: imported } = await importBoardArchive(asFile(new Blob([zipSync(entries)])))
    expect(await getNotes(imported.id)).toHaveLength(1)
    expect(await getBoardAssets(imported.id)).toHaveLength(2)
  })

  it('still rejects an entry named like a directory that unexpectedly carries content, naming its path', async () => {
    const entries = await archiveEntries(await createCompleteArchive())
    entries['notes/'] = strToU8('a real file masquerading as the notes folder')
    await expect(importBoardArchive(asFile(new Blob([zipSync(entries)])))).rejects.toThrow('"notes/"')
  })

  it('names every path in an archive that carries a file its manifest does not reference', async () => {
    const entries = await archiveEntries(await createCompleteArchive())
    entries['images/stowaway.png'] = strToU8('not referenced by the manifest')
    await expect(importBoardArchive(asFile(new Blob([zipSync(entries)])))).rejects.toThrow('"images/stowaway.png"')
  })
})

describe('duplicateBoard', () => {
  it('makes an independent copy under a new identity, keeping panels, canvas, notes, assets and the pinned theme, and leaves the source untouched', async () => {
    const now = Date.now()
    const note = { id: 'note_dup', title: 'Original note', content: 'Body text', createdAt: now, updatedAt: now }
    const sourcePanels = createDefaultPanels().map((panel): Panel => panel.type === 'notes'
      ? { ...panel, config: { activeNoteId: note.id } }
      : panel.type === 'slideshow'
        ? { ...panel, config: { ...panel.config, imageSource: { type: 'session-assets' } } }
        : panel)
    const source = await storeBoard('Original', sourcePanels, { camera: { x: 5, y: 6, z: 1 }, panels: [] }, [note])
    await setBoardTheme(source.id, 'terminal')
    await saveBoardAssets(source.id, [makeAsset('asset_dup', 'pic.png', new Uint8Array([9, 9, 9]))])

    // storeBoard is importBoardContent under the hood, so it already
    // reissued the note's id (and the panel ids) once, on the way in; read
    // back what actually landed rather than assuming 'note_dup' survived.
    const sourceNotes = await getNotes(source.id)
    const sourceNotesPanel = panelsOf(source).find((panel): panel is Panel<'notes'> => panel.type === 'notes')!

    const copy = await duplicateBoard(source.id, 'Original (copy)')

    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('Original (copy)')
    expect(copy.themeId).toBe('terminal')
    const copiedPanels = panelsOf(copy)
    expect(copiedPanels).toHaveLength(3)

    const copiedNotesPanel = copiedPanels.find((panel): panel is Panel<'notes'> => panel.type === 'notes')!
    expect(copiedNotesPanel.id).not.toBe(sourceNotesPanel.id)

    const copiedNotes = await getNotes(copy.id)
    expect(copiedNotes).toHaveLength(1)
    expect(copiedNotes[0].id).not.toBe(sourceNotes[0].id)
    expect(copiedNotes[0].content).toBe('Body text')
    expect(copiedNotesPanel.config.activeNoteId).toBe(copiedNotes[0].id)

    const copiedAssets = await getBoardAssets(copy.id)
    expect(copiedAssets).toHaveLength(1)
    expect(copiedAssets[0].id).not.toBe('asset_dup')
    expect(copiedAssets[0].filename).toBe('pic.png')

    expect(await getBoard(source.id)).toBeDefined()
    expect(await getNotes(source.id)).toEqual(sourceNotes)
  })

  it('does not go through a zip at all, so a board that could not be exported (over a size limit) can still be duplicated', async () => {
    // The note-size ceiling is an export-only, zip-file concern; duplicating
    // stays a direct database copy and is not bound by it.
    const bigNote = { id: 'note_big', title: 'Big', content: 'x'.repeat(1024), createdAt: Date.now(), updatedAt: Date.now() }
    const panels = createDefaultPanels().map((panel): Panel => panel.type === 'notes' ? { ...panel, config: { activeNoteId: bigNote.id } } : panel)
    const source = await storeBoard('Has a note', panels, null, [bigNote])
    const copy = await duplicateBoard(source.id, 'Has a note (copy)')
    expect((await getNotes(copy.id))[0].content).toBe(bigNote.content)
  })
})

describe('peekBoardArchiveName', () => {
  it('reads the name an archive would import under, without importing anything', async () => {
    // createCompleteArchive() stores its own source board to build the
    // archive from; the "no side effect" claim under test is peek's alone,
    // so the baseline is taken after that, not before.
    const blob = await createCompleteArchive()
    const before = await getBoardSummaries()
    const name = await peekBoardArchiveName(asFile(blob))
    expect(name).toBe('Archive source')
    expect(await getBoardSummaries()).toEqual(before)
  })

  it('resolves to null, rather than throwing, for a file that is not a readable archive', async () => {
    expect(await peekBoardArchiveName(asFile(new Blob(['not a zip'])))).toBeNull()
    expect(await peekBoardArchiveName(asFile(new Blob([zipSync({ 'manifest.json': strToU8('{not json') })])))).toBeNull()
    expect(await peekBoardArchiveName(asFile(new Blob([zipSync({})])))).toBeNull()
  })
})

