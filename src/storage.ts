import { DBSchema, openDB } from 'idb'
import type {
  CanvasState,
  ImageMetadata,
  Note,
  SlideshowSettings,
  SpotifyPlaylistState,
  SpotifyTokens,
} from './types'

const APP_STATE_VERSION = 1

const keys = {
  schemaVersion: 'mic:schema-version',
  canvas: 'mic:canvas',
  slideshow: 'mic:slideshow',
  spotifyTokens: 'mic:spotify-tokens',
  spotifyPlaylist: 'mic:spotify-playlist',
  lastNoteId: 'mic:last-note-id',
}

export const defaultSlideshowSettings: SlideshowSettings = {
  folderName: null,
  currentIndex: 0,
  intervalMs: 5000,
  transitionMs: 450,
  shuffle: false,
  zoom: 1,
}

export const defaultSpotifyPlaylistState: SpotifyPlaylistState = {
  id: null,
  uri: null,
  name: null,
  url: null,
  lastSearch: '',
}

interface MusicImagesCanvasDb extends DBSchema {
  notes: {
    key: string
    value: Note
    indexes: {
      'by-updated': number
    }
  }
  directoryHandles: {
    key: string
    value: {
      id: string
      name: string
      handle: FileSystemDirectoryHandle
    }
  }
  imageMetadata: {
    key: string
    value: {
      id: string
      images: ImageMetadata[]
      updatedAt: number
    }
  }
}

const dbPromise = openDB<MusicImagesCanvasDb>('music-images-canvas', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('notes')) {
      const notes = db.createObjectStore('notes', { keyPath: 'id' })
      notes.createIndex('by-updated', 'updatedAt')
    }

    if (!db.objectStoreNames.contains('directoryHandles')) {
      db.createObjectStore('directoryHandles', { keyPath: 'id' })
    }

    if (!db.objectStoreNames.contains('imageMetadata')) {
      db.createObjectStore('imageMetadata', { keyPath: 'id' })
    }
  },
})

function readJson<T>(key: string, fallback: T): T {
  const raw = window.localStorage.getItem(key)
  if (!raw) return fallback

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T) {
  window.localStorage.setItem(keys.schemaVersion, String(APP_STATE_VERSION))
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function loadCanvasState(): CanvasState | null {
  return readJson<CanvasState | null>(keys.canvas, null)
}

export function saveCanvasState(state: CanvasState) {
  writeJson(keys.canvas, state)
}

export function loadSlideshowSettings() {
  return readJson(keys.slideshow, defaultSlideshowSettings)
}

export function saveSlideshowSettings(settings: SlideshowSettings) {
  writeJson(keys.slideshow, settings)
}

export function loadSpotifyTokens() {
  return readJson<SpotifyTokens | null>(keys.spotifyTokens, null)
}

export function saveSpotifyTokens(tokens: SpotifyTokens | null) {
  if (!tokens) {
    window.localStorage.removeItem(keys.spotifyTokens)
    return
  }
  writeJson(keys.spotifyTokens, tokens)
}

export function loadSpotifyPlaylistState() {
  return readJson(keys.spotifyPlaylist, defaultSpotifyPlaylistState)
}

export function saveSpotifyPlaylistState(state: SpotifyPlaylistState) {
  writeJson(keys.spotifyPlaylist, state)
}

export function loadLastNoteId() {
  return window.localStorage.getItem(keys.lastNoteId)
}

export function saveLastNoteId(noteId: string | null) {
  if (!noteId) {
    window.localStorage.removeItem(keys.lastNoteId)
    return
  }
  window.localStorage.setItem(keys.lastNoteId, noteId)
}

export async function getNotes() {
  const db = await dbPromise
  const notes = await db.getAllFromIndex('notes', 'by-updated')
  return notes.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getNote(id: string) {
  const db = await dbPromise
  return db.get('notes', id)
}

export async function saveNote(note: Note) {
  const db = await dbPromise
  await db.put('notes', note)
}

export async function deleteNote(id: string) {
  const db = await dbPromise
  await db.delete('notes', id)
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle) {
  const db = await dbPromise
  await db.put('directoryHandles', {
    id: 'slideshow',
    name: handle.name,
    handle,
  })
}

export async function getDirectoryHandle() {
  const db = await dbPromise
  return db.get('directoryHandles', 'slideshow')
}

export async function clearDirectoryHandle() {
  const db = await dbPromise
  await db.delete('directoryHandles', 'slideshow')
}

export async function saveImageMetadata(images: ImageMetadata[]) {
  const db = await dbPromise
  await db.put('imageMetadata', {
    id: 'slideshow',
    images,
    updatedAt: Date.now(),
  })
}

export async function getImageMetadata() {
  const db = await dbPromise
  const record = await db.get('imageMetadata', 'slideshow')
  return record?.images ?? []
}

export async function clearImageMetadata() {
  const db = await dbPromise
  await db.delete('imageMetadata', 'slideshow')
}
