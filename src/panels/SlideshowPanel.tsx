import { ChevronsDownUp, ChevronsUpDown, FolderOpen, Images, Pause, Play, RotateCcw, Shuffle, SkipBack, SkipForward, Sparkles, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../AppState'
import type { ImageItem, Panel } from '../types'
import { DEFAULT_SLIDESHOW_ZOOM } from '../storage'
import { SampleCollectionCard, useBundledCollections } from './SampleCollectionCard'
import { PanelHeader, stopPanelHeaderEvent, usePanelCommands } from '../PanelHeader'
import { ImageAttributionOverlay } from './imageAttribution'

const minSlideshowInterval = 250
const maxSlideshowInterval = 5000
const maxSpeed = 20
const focusHintDurationMs = 3500

/* Escape has to reach exactly one panel. Several panels can be in focus view at
   once, and each listens on the window, so they share a stack and only the one
   entered most recently acts. */
const focusViewStack: string[] = []

export function SlideshowPanel({ panelId }: { panelId: string }) {
  const { slideshow, sessions } = useAppState()
  const commands = usePanelCommands()
  const panel = sessions.activeSession?.panels.find(candidate => candidate.id === panelId) as Extract<Panel, { type: 'slideshow' }> | undefined
  const panelSettings = panel?.config ?? slideshow.settingsFor(panelId)
  // Focus view leaves the picture alone on the panel: every control is dropped,
  // including the header, so Escape is the only way back out.
  const focusView = panel?.focusView === true
  const collections = useBundledCollections()
  const panelImages = slideshow.imagesFor(panelId)
  const panelStatus = slideshow.statusFor(panelId)
  const panelError = slideshow.errorFor(panelId)
  const firstImage = panelImages[0]
  const currentImage = panelImages[panelSettings.currentIndex]
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false)
  const [isSamplePickerOpen, setIsSamplePickerOpen] = useState(false)
  const speedValue = intervalToSpeed(panelSettings.intervalMs)
  const stageAspectRatio = firstImage?.width && firstImage.height ? `${firstImage.width} / ${firstImage.height}` : undefined
  const attribution = currentImage?.attribution ?? null
  const [isFocusHintVisible, setIsFocusHintVisible] = useState(false)
  const focusHintTimeoutRef = useRef<number | null>(null)

  function revealFocusHint() {
    if (focusHintTimeoutRef.current !== null) window.clearTimeout(focusHintTimeoutRef.current)
    setIsFocusHintVisible(true)
    focusHintTimeoutRef.current = window.setTimeout(() => setIsFocusHintVisible(false), focusHintDurationMs)
  }

  function hideFocusHint() {
    if (focusHintTimeoutRef.current !== null) window.clearTimeout(focusHintTimeoutRef.current)
    setIsFocusHintVisible(false)
  }

  useEffect(() => {
    if (!focusView) return
    focusViewStack.push(panelId)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (focusViewStack[focusViewStack.length - 1] !== panelId) return
      // A dialog or a menu owns Escape for as long as it is open.
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      // Capture phase, and the canvas must not also see this: tldraw answers
      // Escape by clearing the selection, which swallowed the key whenever the
      // panel being focused was the selected shape.
      event.preventDefault()
      event.stopPropagation()
      commands.togglePanelFocusView(panelId)
    }

    const options = { capture: true } as const
    window.addEventListener('keydown', handleKeyDown, options)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, options)
      const index = focusViewStack.lastIndexOf(panelId)
      if (index >= 0) focusViewStack.splice(index, 1)
    }
  }, [focusView, panelId, commands])

  // The hint names the only way out, so it shows on entry and whenever the
  // pointer is over a panel that has no visible controls.
  useEffect(() => {
    if (focusView) revealFocusHint()
    else hideFocusHint()
    return () => { if (focusHintTimeoutRef.current !== null) window.clearTimeout(focusHintTimeoutRef.current) }
  }, [focusView])

  async function chooseFolder() {
    setIsSamplePickerOpen(false)
    if (window.showDirectoryPicker) {
      const selected = await slideshow.selectFolder(panelId)
      if (selected) return
    }
    folderInputRef.current?.click()
  }

  async function chooseSample(collectionId: string) {
    setIsSamplePickerOpen(false)
    await slideshow.selectBundledCollection(collectionId, panelId)
  }

  function stopCanvasEvent(event: React.SyntheticEvent) {
    if ('button' in event && event.button === 2) return
    ;(event as unknown as { isKilled?: boolean }).isKilled = true
    ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
  }

  return (
    <section
      className={focusView ? 'panel panel-slideshow-surface is-focus-view' : 'panel panel-slideshow-surface'}
      onPointerMove={focusView ? revealFocusHint : undefined}
      onPointerLeave={focusView ? hideFocusHint : undefined}
    >
      {focusView ? null : (
      <PanelHeader panelId={panelId} panelType="slideshow" title="Images">
          <button
            className={`card-icon-button ${isImagePickerOpen ? 'is-active' : ''}`}
            type="button"
            title={`${isImagePickerOpen ? 'Hide' : 'Show'} loaded images`}
            aria-label={`${isImagePickerOpen ? 'Hide' : 'Show'} loaded images`}
            aria-controls="loaded-images-picker"
            aria-expanded={isImagePickerOpen}
            onPointerDown={stopCanvasEvent}
            onClick={() => { setIsSamplePickerOpen(false); setIsImagePickerOpen((current) => !current) }}
          ><Images size={18} /></button>
          <button className="card-icon-button" type="button" title="Choose a local folder" aria-label="Choose a local folder" onPointerDown={stopCanvasEvent} onClick={() => void chooseFolder()}>
            <FolderOpen size={18} />
          </button>
          <button
            className={`card-icon-button ${isSamplePickerOpen ? 'is-active' : ''}`}
            type="button"
            title="Load a sample collection"
            aria-label="Load a sample collection"
            aria-controls="sample-collection-picker"
            aria-expanded={isSamplePickerOpen}
            onPointerDown={stopCanvasEvent}
            onClick={() => { setIsImagePickerOpen(false); setIsSamplePickerOpen((current) => !current) }}
          ><Sparkles size={18} /></button>
          <button className="card-icon-button" type="button" title="Clear images" aria-label="Clear images" onPointerDown={stopCanvasEvent} onClick={() => void slideshow.resetFolder(panelId)}>
            <Trash2 size={18} />
          </button>
          <button
            className="card-icon-button"
            type="button"
            title={focusView ? 'Expand panel to full view' : 'Reduce panel to focus view'}
            aria-label={focusView ? 'Expand panel to full view' : 'Reduce panel to focus view'}
            aria-pressed={focusView}
            onPointerDown={stopPanelHeaderEvent}
            onMouseDown={stopPanelHeaderEvent}
            onClick={(event) => { stopPanelHeaderEvent(event); commands.togglePanelFocusView(panelId) }}
          >{focusView ? <ChevronsUpDown size={18} /> : <ChevronsDownUp size={18} />}</button>
        {isImagePickerOpen ? (
          <section className="slideshow-image-picker panel-interactive" id="loaded-images-picker" aria-label="Loaded images" onPointerDown={stopCanvasEvent} onClick={stopCanvasEvent}>
            <div className="slideshow-image-picker-heading"><span>Loaded images</span><span>{panelImages.length ? `${panelImages.length} total` : 'None yet'}</span></div>
            {panelImages.length ? (
              <div className="slideshow-image-picker-list">
                {panelImages.map((image, index) => (
                  <button className={`slideshow-image-thumbnail ${index === panelSettings.currentIndex ? 'is-current' : ''}`} type="button" key={image.id} aria-label={`Show ${image.name}`} aria-pressed={index === panelSettings.currentIndex} title={image.name} onClick={() => slideshow.updateSettings({ currentIndex: index }, panelId)}>
                    <img src={image.url} alt="" draggable={false} />
                  </button>
                ))}
              </div>
            ) : <p className="slideshow-image-picker-empty">{panelStatus}</p>}
          </section>
        ) : null}

        {isSamplePickerOpen ? (
          <section className="sample-collection-popover panel-interactive" id="sample-collection-picker" aria-label="Sample collections" onPointerDown={stopCanvasEvent} onClick={stopCanvasEvent}>
            <span className="sample-collection-heading">Sample collections</span>
            <div className="sample-collection-list">
              {collections.map((collection) => (
                <SampleCollectionCard
                  key={collection.id}
                  collection={collection}
                  variant="row"
                  onSelect={() => void chooseSample(collection.id)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <input ref={folderInputRef} className="visually-hidden-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.svg,image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,image/svg+xml" multiple webkitdirectory="" directory="" onChange={(event) => { const files = event.target.files; if (files?.length) void slideshow.importFiles(files, panelId); event.currentTarget.value = '' }} />
      </PanelHeader>
      )}

      {/* Focus view drops the aspect-ratio box so the stage fills the panel and the
          picture, which is contained inside it, gets every pixel the panel allows. */}
      <div className="slideshow-stage card-content" style={{ aspectRatio: focusView ? undefined : stageAspectRatio }}>
        {currentImage ? (
          <>
          {/* In focus view the picture covers the whole panel and the header that
              normally drags it is gone, so the image has to let the press reach the
              canvas. Everywhere else it still swallows the press, which keeps a
              click on the picture from moving the panel. */}
          <CrossfadeImage
            image={currentImage}
            transitionMs={panelSettings.transitionMs}
            zoom={panelSettings.zoom}
            onPointerDown={focusView ? undefined : stopCanvasEvent}
          />
          {attribution ? <ImageAttributionOverlay attribution={attribution} onPointerDown={stopCanvasEvent} /> : null}
          {focusView ? (
            <p className={isFocusHintVisible ? 'focus-view-hint is-visible' : 'focus-view-hint'} role="status">
              Press <kbd>Esc</kbd> to show the controls
            </p>
          ) : null}
          </>
        ) : (
          <div className="empty-stage">
            {/* Two ways in, weighted the same: peer headings over peer controls,
                so neither the folder nor the samples read as the afterthought. */}
            <div className="empty-stage-option">
              <h3>Select images from a folder</h3>
              <button className="card-icon-button is-wide empty-stage-folder-button" type="button" onPointerDown={stopCanvasEvent} onClick={() => void chooseFolder()}><FolderOpen size={18} /> Choose a folder</button>
            </div>
            <div className="empty-stage-option">
              <h3>Or try a sample collection</h3>
              <div className="empty-stage-collections">
                {collections.map((collection) => (
                  <SampleCollectionCard
                    key={collection.id}
                    collection={collection}
                    variant="tile"
                    onSelect={() => void chooseSample(collection.id)}
                    onPointerDown={stopCanvasEvent}
                  />
                ))}
              </div>
            </div>
            {panelSettings.imageSource.type === 'bundled' || panelError ? <p className="empty-stage-status" role="status">{panelStatus}</p> : null}
          </div>
        )}
      </div>

      {focusView ? null : (
        <>
        <div className="panel-body panel-interactive slideshow-controls" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent} onDragStart={(event) => event.preventDefault()}>
          <div className="transport-row">
            <button className="card-icon-button" type="button" title="Previous image" aria-label="Previous image" onClick={() => slideshow.previous(panelId)}><SkipBack size={18} /></button>
            <button className="card-icon-button is-primary is-large" type="button" title="Start or pause" aria-label={slideshow.isPlayingFor(panelId) ? 'Pause slideshow' : 'Start slideshow'} onClick={() => slideshow.setIsPlaying(!slideshow.isPlayingFor(panelId), panelId)}>{slideshow.isPlayingFor(panelId) ? <Pause size={20} /> : <Play size={20} />}</button>
            <button className="card-icon-button" type="button" title="Next image" aria-label="Next image" onClick={() => slideshow.next(panelId)}><SkipForward size={18} /></button>
            <button className="card-icon-button" type="button" title="Stop" aria-label="Stop slideshow" onClick={() => slideshow.stop(panelId)}><Square size={16} /></button>
            <button className={`card-icon-button ${panelSettings.shuffle ? 'is-active' : ''}`} type="button" title="Shuffle" aria-label="Shuffle images" aria-pressed={panelSettings.shuffle} onClick={() => slideshow.updateSettings({ shuffle: !panelSettings.shuffle }, panelId)}><Shuffle size={18} /></button>
          </div>
          <div className="range-grid">
            <label><span>Speed <output className="slideshow-control-value">{panelSettings.intervalMs} ms</output></span><input type="range" min={1} max={maxSpeed} step={1} value={speedValue} onChange={(event) => slideshow.updateSettings({ intervalMs: speedToInterval(Number(event.target.value)) }, panelId)} /></label>
            <label><span>Fade <output className="slideshow-control-value">{panelSettings.transitionMs} ms</output></span><input type="range" min={0} max={2000} step={50} value={panelSettings.transitionMs} onChange={(event) => slideshow.updateSettings({ transitionMs: Number(event.target.value) }, panelId)} /></label>
          </div>
          <div className="zoom-row">
            <label><span>Zoom <output className="slideshow-control-value">{Math.round(panelSettings.zoom * 100)}%</output></span><input type="range" min={0.5} max={2.4} step={0.05} value={panelSettings.zoom} onChange={(event) => slideshow.updateSettings({ zoom: Number(event.target.value) }, panelId)} /></label>
            <span className="zoom-readout">{Math.round(panelSettings.zoom * 100)}%</span>
            <button className="card-icon-button" type="button" title="Reset zoom" aria-label="Reset zoom" onClick={() => slideshow.updateSettings({ zoom: DEFAULT_SLIDESHOW_ZOOM }, panelId)}><RotateCcw size={17} /></button>
          </div>
        </div>

        <footer className="card-footer panel-interactive" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent}>
            <span className="card-footer-meta">{currentImage?.name ?? panelStatus}</span>
          <div className="card-footer-status">
            {panelError ? <span className="error-text">{panelError}</span> : <span>{panelImages.length ? `${panelSettings.currentIndex + 1} / ${panelImages.length}` : '0 / 0'}</span>}
          </div>
        </footer>
        </>
      )}
    </section>
  )
}


function CrossfadeImage({
  image,
  transitionMs,
  zoom,
  onPointerDown,
}: {
  image: ImageItem
  transitionMs: number
  zoom: number
  onPointerDown?(event: React.SyntheticEvent): void
}) {
  const [displayedImage, setDisplayedImage] = useState(image)
  const [outgoingImage, setOutgoingImage] = useState<ImageItem | null>(null)
  const displayedImageRef = useRef(image)

  useEffect(() => {
    if (image.id === displayedImageRef.current.id) return

    const previousImage = displayedImageRef.current
    displayedImageRef.current = image
    setOutgoingImage(transitionMs > 0 ? previousImage : null)
    setDisplayedImage(image)

    if (transitionMs <= 0) return
    const timeoutId = window.setTimeout(() => setOutgoingImage(null), transitionMs)
    return () => window.clearTimeout(timeoutId)
  }, [image])

  const imageStyle = { transform: `scale(${zoom})` }

  return (
    <>
      {outgoingImage ? (
        <img
          className="slideshow-image-layer slideshow-image-outgoing"
          src={outgoingImage.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          onDragStart={(event) => { event.preventDefault(); onPointerDown?.(event) }}
          onPointerDown={onPointerDown}
          style={imageStyle}
        />
      ) : null}
      <img
        className={`slideshow-image-layer ${outgoingImage ? 'slideshow-image-incoming' : ''}`}
        key={displayedImage.id}
        src={displayedImage.url}
        alt={displayedImage.name}
        draggable={false}
        onDragStart={(event) => { event.preventDefault(); onPointerDown?.(event) }}
        onPointerDown={onPointerDown}
        style={{ ...imageStyle, animationDuration: `${transitionMs}ms` }}
      />
    </>
  )
}

function speedToInterval(speed: number) {
  const normalized = (Math.max(1, Math.min(maxSpeed, speed)) - 1) / (maxSpeed - 1)
  return Math.round(maxSlideshowInterval - normalized * (maxSlideshowInterval - minSlideshowInterval))
}

function intervalToSpeed(intervalMs: number) {
  const clamped = Math.max(minSlideshowInterval, Math.min(maxSlideshowInterval, intervalMs))
  const normalized = (maxSlideshowInterval - clamped) / (maxSlideshowInterval - minSlideshowInterval)
  return Math.round(normalized * (maxSpeed - 1) + 1)
}
