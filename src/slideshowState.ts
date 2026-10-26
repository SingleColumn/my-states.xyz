import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageItem, Panel, Board, SlideshowSettings } from './types'
import {
  clearPanelDirectoryHandle,
  defaultSlideshowSettings,
  getPanelDirectoryHandle,
  getBoardAssets,
  replaceBoardAssets,
  savePanelDirectoryHandle,
  boardLimits,
} from './storage'
import { cancelAdvance, refreshLookAhead, startAdvanceTimer, type SlideshowLookAhead } from './slideshowLookAhead'
import { createImageItemsFromBundledCollection } from './imageCollections'
import { configuredImageCollectionsBaseUrl, createImageItemsFromCuratedCollection } from './curatedImageCollections'
import { type PanelWriteOptions } from './panelStore'
import {
  isFolderPickerCancelledByUser,
  releaseImageItems,
  settingsForBundledCollection,
  settingsForCuratedCollection,
  settingsForClearedImages,
  settingsForBoardAssets,
  statusForImageSource,
} from './slideshowSources'
import type { PanelsState } from './AppState'
import { createBoardAsset, createImageItemFromAsset, isSupportedImageFile, readImageFilesFromDirectory } from './imageAssets'

export interface SlideshowState {
  settingsFor(panelId: string): SlideshowSettings
  /** The picture showing now. Playback position, not configuration: it lives with the timer and is written to the panel only when playback rests. */
  currentIndexFor(panelId: string): number
  imagesFor(panelId: string): ImageItem[]
  isPlayingFor(panelId: string): boolean
  statusFor(panelId: string): string
  errorFor(panelId: string): string | null
  selectFolder(panelId: string): Promise<'selected' | 'cancelled' | 'fallback'>
  importFiles(files: FileList | File[], panelId: string): Promise<void>
  selectBundledCollection(collectionId: string, panelId: string): Promise<boolean>
  selectCuratedCollection(collectionSlug: string, title: string, panelId: string): Promise<boolean>
  resetFolder(panelId: string): Promise<void>
  restoreFolder(panelId: string): Promise<void>
  setIsPlaying(value: boolean, panelId?: string): void
  stop(panelId?: string): void
  next(panelId?: string): void
  previous(panelId?: string): void
  updateSettings(settings: Partial<SlideshowSettings>, panelId?: string): void
}

export function useSlideshowState(board: Board | null, panels: PanelsState): SlideshowState {
  const [, rerender] = useState(0)
  const touch = useCallback(() => rerender((value) => value + 1), [])
  const panelsRef = useRef(panels)
  panelsRef.current = panels
  const settingsOf = useCallback((panelId: string): SlideshowSettings => {
    const panel = panelsRef.current.get(panelId)
    return panel?.type === 'slideshow' ? panel.config : defaultSlideshowSettings
  }, [])
  const writeSettings = useCallback((panelId: string, patch: Partial<SlideshowSettings>, options?: PanelWriteOptions) => {
    panelsRef.current.updateConfig<'slideshow'>(panelId, patch, options)
  }, [])
  // The picture showing now is playback position, like whether the show is
  // running, and lives with the timer. It is written back to the panel only
  // when playback rests, so a running show never touches the store.
  const setCurrentIndex = useCallback((panelId: string, index: number, persist: boolean) => {
    getSlideshowPanelRuntimeState(panelId).currentIndex = index
    if (persist) writeSettings(panelId, { currentIndex: index }, { history: 'ignore' })
    touch()
  }, [touch, writeSettings])

  // The loading boundary is the board, once the canvas has restored it.
  const loadKey = panels.isReady ? board?.id ?? '' : ''
  // Which Images panels exist and where each takes its pictures from. A
  // panel that arrives later (undo of a delete, a copy, a command) or whose
  // source changes under it loads its pictures the same way one present at
  // the start does.
  const sourceSignature = panels.all
    .filter((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow')
    .map((panel) => `${panel.id}=${imageSourceKey(panel.config.imageSource)}`)
    .join('|')
  useEffect(() => {
    let cancelled = false
    const slideshowPanels = loadKey ? panelsRef.current.all.filter((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow') : []
    const activeIds = new Set(slideshowPanels.map((panel) => panel.id))
    for (const [panelId, state] of slideshowPanelRuntimeStates) {
      if (!activeIds.has(panelId)) {
        cancelAdvance(state)
        releaseImageItems(state.images)
        slideshowPanelRuntimeStates.delete(panelId)
      }
    }
    const toLoad = slideshowPanels.filter((panel) => getSlideshowPanelRuntimeState(panel.id).sourceKey !== imageSourceKey(panel.config.imageSource))
    for (const panel of toLoad) {
      const state = getSlideshowPanelRuntimeState(panel.id)
      cancelAdvance(state)
      state.isPlaying = false
      state.sourceKey = imageSourceKey(panel.config.imageSource)
      state.currentIndex = panel.config.currentIndex
      state.status = statusForImageSource(panel.config.imageSource, 0)
      state.error = null
      releaseImageItems(state.images)
      state.images = []
    }
    touch()

    async function loadPanel(panel: Panel<'slideshow'>) {
      const state = getSlideshowPanelRuntimeState(panel.id)
      try {
        const source = panel.config.imageSource
        if (source.type === 'none') {
          state.status = 'Choose an image collection, or use the panel menu for a local folder.'
          return
        }
        let nextImages: ImageItem[]
        if (source.type === 'bundled') {
          const loaded = await createImageItemsFromBundledCollection(source.collectionId)
          if (!loaded) {
            const message = `The image collection "${source.collectionId}" is not available in this version.`
            state.status = message
            state.error = message
            return
          }
          nextImages = loaded
        } else if (source.type === 'curated') {
          if (!configuredImageCollectionsBaseUrl) {
            const message = 'This image collection is no longer available. Choose another collection.'
            state.status = message
            state.error = message
            return
          }
          const loaded = await createImageItemsFromCuratedCollection(source.collectionSlug, configuredImageCollectionsBaseUrl)
          if (!loaded) {
            const message = 'This image collection is no longer available. Choose another collection.'
            state.status = message
            state.error = message
            return
          }
          nextImages = loaded
        } else {
          const assets = await getBoardAssets(board!.id, panel.id)
          nextImages = await Promise.all(assets.map((asset) => createImageItemFromAsset(asset)))
          nextImages.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
        }
        if (cancelled) {
          releaseImageItems(nextImages)
          return
        }
        state.images = nextImages
        state.status = statusForImageSource(source, nextImages.length)
        if (state.currentIndex >= nextImages.length && state.currentIndex !== 0) setCurrentIndex(panel.id, 0, true)
        touch()
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : 'Could not load the images for this board.'
          state.status = message
          state.error = message
          touch()
        }
      }
    }
    if (!loadKey) return () => { cancelled = true }
    for (const panel of toLoad) void loadPanel(panel)
    return () => { cancelled = true }
  }, [loadKey, sourceSignature, setCurrentIndex, touch])

  const schedulePanelAdvance = useCallback((panelId: string) => {
    const state = getSlideshowPanelRuntimeState(panelId)
    if (!state.isPlaying || state.timerId !== null) return

    const panel = panelsRef.current.get(panelId)
    if (panel?.type !== 'slideshow') {
      state.isPlaying = false
      return
    }

    // The next picture is chosen now, not when the timer fires, so it can be
    // decoded while this one is showing. A shuffle is rolled here, once.
    const shuffle = panel.config.shuffle
    startAdvanceTimer(state, panel.config.intervalMs, () => getNextImageIndex(state.currentIndex, state.images.length, shuffle), (queued) => {
      const currentPanel = panelsRef.current.get(panelId)
      if (currentPanel?.type !== 'slideshow' || !state.isPlaying) return
      if (state.images.length) {
        setCurrentIndex(panelId, queued ?? getNextImageIndex(state.currentIndex, state.images.length, currentPanel.config.shuffle), false)
      }
      schedulePanelAdvance(panelId)
    })
  }, [setCurrentIndex])

  // A queued picture chosen from a position or a shuffle setting that no
  // longer holds is replaced; the running timer keeps its deadline.
  const requeueAdvance = useCallback((panelId: string, shuffle = settingsOf(panelId).shuffle) => {
    const state = getSlideshowPanelRuntimeState(panelId)
    refreshLookAhead(state, () => getNextImageIndex(state.currentIndex, state.images.length, shuffle))
  }, [settingsOf])

  const replaceImages = useCallback(async (files: FileList | File[], folderName: string, panelId: string) => {
    if (!board) return
    const selected = Array.from(files).filter(isSupportedImageFile)
    if (selected.length > boardLimits.maxImageCount) throw new Error(`A board can contain at most ${boardLimits.maxImageCount} images.`)
    const assets = await Promise.all(selected.map((file) => createBoardAsset(file, board.id, panelId)))
    await replaceBoardAssets(board.id, assets, panelId)
    const nextImages = await Promise.all(assets.map(createImageItemFromAsset))
    nextImages.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
    const state = getSlideshowPanelRuntimeState(panelId)
    cancelAdvance(state)
    state.isPlaying = false
    releaseImageItems(state.images)
    state.images = nextImages
    state.status = nextImages.length ? `${folderName} · ${nextImages.length} images` : 'No supported images were selected.'
    state.error = null
    state.currentIndex = 0
    const nextSettings = settingsForBoardAssets(settingsOf(panelId), folderName)
    state.sourceKey = imageSourceKey(nextSettings.imageSource)
    writeSettings(panelId, nextSettings)
    touch()
  }, [board, settingsOf, touch, writeSettings])

  const loadImagesFromHandle = useCallback(async (handle: FileSystemDirectoryHandle, panelId: string) => {
    const files: File[] = []
    for await (const file of readImageFilesFromDirectory(handle)) files.push(file)
    await replaceImages(files, handle.name, panelId)
  }, [replaceImages])

  const selectFolder = useCallback(async (panelId: string) => {
    if (!board) return 'fallback' as const
    if (!window.showDirectoryPicker) {
      getSlideshowPanelRuntimeState(panelId).error = 'Folder selection is unavailable in this browser. Use the file picker instead.'
      touch()
      return 'fallback' as const
    }
    const openedAt = performance.now()
    try {
      const handle = await window.showDirectoryPicker()
      await savePanelDirectoryHandle(board.id, panelId, handle)
      await loadImagesFromHandle(handle, panelId)
      return 'selected' as const
    } catch (caught) {
      // A genuine cancel is the end of it. An abort that arrives before a
      // dialog could have appeared means this browser never showed one, and
      // the caller should offer the file input instead.
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        return isFolderPickerCancelledByUser(caught, performance.now() - openedAt) ? 'cancelled' as const : 'fallback' as const
      }
      const state = getSlideshowPanelRuntimeState(panelId)
      state.error = caught instanceof Error ? caught.message : 'Could not select the folder.'
      touch()
      return 'fallback' as const
    }
  }, [loadImagesFromHandle, board, touch])

  const selectBundledCollection = useCallback(async (collectionId: string, panelId: string) => {
    if (!board) throw new Error('Open a board before selecting images.')
    const state = getSlideshowPanelRuntimeState(panelId)
    try {
      const nextImages = await createImageItemsFromBundledCollection(collectionId)
      if (!nextImages) {
        const message = `The image collection "${collectionId}" is not available in this version.`
        state.error = message
        state.status = message
        touch()
        return false
      }
      cancelAdvance(state)
      releaseImageItems(state.images)
      state.images = nextImages
      state.isPlaying = nextImages.length > 0
      const nextSettings = settingsForBundledCollection(settingsOf(panelId), collectionId)
      state.currentIndex = nextSettings.currentIndex
      state.sourceKey = imageSourceKey(nextSettings.imageSource)
      writeSettings(panelId, nextSettings)
      state.status = statusForImageSource(nextSettings.imageSource, nextImages.length)
      state.error = null
      if (state.isPlaying) schedulePanelAdvance(panelId)
      touch()
      return true
    } catch (caught) {
      state.error = caught instanceof Error ? caught.message : 'Could not load the image collection.'
      touch()
      return false
    }
  }, [schedulePanelAdvance, board, settingsOf, touch, writeSettings])

  const selectCuratedCollection = useCallback(async (collectionSlug: string, title: string, panelId: string) => {
    if (!board) throw new Error('Open a board before selecting images.')
    const state = getSlideshowPanelRuntimeState(panelId)
    if (!configuredImageCollectionsBaseUrl) {
      state.error = 'Image collections are not available right now.'
      touch()
      return false
    }
    try {
      const nextImages = await createImageItemsFromCuratedCollection(collectionSlug, configuredImageCollectionsBaseUrl)
      if (!nextImages) {
        const message = 'This image collection is no longer available. Choose another collection.'
        state.error = message
        state.status = message
        touch()
        return false
      }
      cancelAdvance(state)
      releaseImageItems(state.images)
      state.images = nextImages
      state.isPlaying = nextImages.length > 0
      const nextSettings = settingsForCuratedCollection(settingsOf(panelId), collectionSlug, title)
      state.currentIndex = nextSettings.currentIndex
      state.sourceKey = imageSourceKey(nextSettings.imageSource)
      writeSettings(panelId, nextSettings)
      state.status = statusForImageSource(nextSettings.imageSource, nextImages.length)
      state.error = null
      if (state.isPlaying) schedulePanelAdvance(panelId)
      touch()
      return true
    } catch (caught) {
      state.error = caught instanceof Error ? caught.message : 'Could not load the image collection.'
      touch()
      return false
    }
  }, [schedulePanelAdvance, board, settingsOf, touch, writeSettings])

  const restoreFolder = useCallback(async (panelId: string) => {
    if (!board) return
    const stored = await getPanelDirectoryHandle(board.id, panelId)
    if (!stored) return
    try {
      if (!(await ensureReadPermission(stored.handle))) {
        getSlideshowPanelRuntimeState(panelId).status = `Permission is needed to reopen ${stored.name}.`
        touch()
        return
      }
      await loadImagesFromHandle(stored.handle, panelId)
    } catch (caught) {
      getSlideshowPanelRuntimeState(panelId).error = caught instanceof Error ? caught.message : 'Could not reopen the image folder.'
      touch()
    }
  }, [loadImagesFromHandle, board, touch])

  const resetFolder = useCallback(async (panelId: string) => {
    if (!board) return
    const state = getSlideshowPanelRuntimeState(panelId)
    const current = settingsOf(panelId)
    cancelAdvance(state)
    state.isPlaying = false
    state.currentIndex = 0
    if (current.imageSource.type === 'session-assets') {
      await replaceBoardAssets(board.id, [], panelId)
      await clearPanelDirectoryHandle(board.id, panelId)
    }
    releaseImageItems(state.images)
    state.images = []
    state.status = 'Choose an image collection, or use the panel menu for a local folder.'
    state.error = null
    const cleared = settingsForClearedImages(current)
    state.sourceKey = imageSourceKey(cleared.imageSource)
    writeSettings(panelId, cleared)
    touch()
  }, [board, settingsOf, touch, writeSettings])

  const stop = useCallback((panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    cancelAdvance(state)
    state.isPlaying = false
    setCurrentIndex(panelId, 0, true)
  }, [setCurrentIndex])

  const next = useCallback((panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    setCurrentIndex(panelId, getNextImageIndex(state.currentIndex, state.images.length, settingsOf(panelId).shuffle), true)
    requeueAdvance(panelId)
  }, [requeueAdvance, setCurrentIndex, settingsOf])

  const previous = useCallback((panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    setCurrentIndex(panelId, state.images.length ? (state.currentIndex - 1 + state.images.length) % state.images.length : 0, true)
    requeueAdvance(panelId)
  }, [requeueAdvance, setCurrentIndex])

  const updateSettings = useCallback((partial: Partial<SlideshowSettings>, panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    if (partial.intervalMs !== undefined) cancelAdvance(state)
    const { currentIndex, ...configuration } = partial
    if (currentIndex !== undefined) setCurrentIndex(panelId, currentIndex, true)
    if (Object.keys(configuration).length) writeSettings(panelId, configuration)
    if (partial.intervalMs !== undefined && state.isPlaying) schedulePanelAdvance(panelId)
    else if (currentIndex !== undefined || partial.shuffle !== undefined) requeueAdvance(panelId, partial.shuffle)
  }, [requeueAdvance, schedulePanelAdvance, setCurrentIndex, writeSettings])

  return {
    settingsFor: (panelId) => settingsOf(panelId),
    currentIndexFor: (panelId) => getSlideshowPanelRuntimeState(panelId).currentIndex,
    imagesFor: (panelId) => getSlideshowPanelRuntimeState(panelId).images,
    isPlayingFor: (panelId) => getSlideshowPanelRuntimeState(panelId).isPlaying,
    statusFor: (panelId) => getSlideshowPanelRuntimeState(panelId).status,
    errorFor: (panelId) => getSlideshowPanelRuntimeState(panelId).error,
    selectFolder,
    selectBundledCollection,
    selectCuratedCollection,
    importFiles: (files, panelId) => replaceImages(files, 'Imported images', panelId),
    resetFolder,
    restoreFolder,
    setIsPlaying: (value, panelId) => {
      if (!panelId) return
      const state = getSlideshowPanelRuntimeState(panelId)
      state.isPlaying = value
      if (value) schedulePanelAdvance(panelId)
      else {
        cancelAdvance(state)
        // Playback has come to rest: this is where the picture showing is kept.
        setCurrentIndex(panelId, state.currentIndex, true)
      }
      touch()
    },
    stop, next, previous, updateSettings,
  }
}

interface SlideshowPanelRuntimeState {
  images: ImageItem[]
  isPlaying: boolean
  currentIndex: number
  /** The image source the loaded pictures came from, so a changed source reloads and an unchanged one does not. */
  sourceKey: string | null
  timerId: number | null
  /** The picture the running timer will show next, being prepared now. Never persisted. */
  lookAhead: SlideshowLookAhead | null
  status: string
  error: string | null
}

const slideshowPanelRuntimeStates = new Map<string, SlideshowPanelRuntimeState>()

function imageSourceKey(source: SlideshowSettings['imageSource']) {
  if (source.type === 'bundled') return `bundled:${source.collectionId}`
  if (source.type === 'curated') return `curated:${source.collectionSlug}`
  return source.type
}

export function getSlideshowPanelRuntimeState(panelId: string): SlideshowPanelRuntimeState {
  const existing = slideshowPanelRuntimeStates.get(panelId)
  if (existing) return existing
  const created: SlideshowPanelRuntimeState = {
    images: [],
    isPlaying: false,
    currentIndex: 0,
    sourceKey: null,
    timerId: null,
    lookAhead: null,
    status: 'Choose an image collection, or use the panel menu for a local folder.',
    error: null,
  }
  slideshowPanelRuntimeStates.set(panelId, created)
  return created
}

async function ensureReadPermission(handle: FileSystemDirectoryHandle) {
  const descriptor = { mode: 'read' as const }
  if (!handle.queryPermission || !handle.requestPermission) return true
  if ((await handle.queryPermission(descriptor)) === 'granted') return true
  return (await handle.requestPermission(descriptor)) === 'granted'
}

function getNextImageIndex(currentIndex: number, length: number, shuffle: boolean) {
  if (length <= 0) return 0
  if (!shuffle || length === 1) return (currentIndex + 1) % length
  let next = Math.floor(Math.random() * length)
  if (next === currentIndex) next = (next + 1) % length
  return next
}
