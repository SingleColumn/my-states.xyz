import { FolderOpen, Images, Pause, Play, RotateCcw, Shuffle, SkipBack, SkipForward, Sparkles, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../AppState'
import { getBundledCollections } from '../imageCollections'
import type { ImageItem, Panel } from '../types'
import { DEFAULT_SLIDESHOW_ZOOM } from '../storage'
import { SampleCollectionCard, useSampleCollectionPreviews } from './SampleCollectionCard'

const minSlideshowInterval = 250
const maxSlideshowInterval = 5000
const maxSpeed = 20

export function SlideshowPanel({ panelId }: { panelId: string }) {
  const { slideshow, sessions } = useAppState()
  const panelSettings = (sessions.activeSession?.panels.find(panel => panel.id === panelId) as Extract<Panel, { type: 'slideshow' }> | undefined)?.config ?? slideshow.settingsFor(panelId)
  const collections = getBundledCollections()
  const collectionPreviews = useSampleCollectionPreviews()
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
    <section className="panel panel-slideshow-surface">
      <header className="card-header">
        <div><h2 className="card-title">Images</h2></div>
        <div className="card-header-actions">
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
        </div>

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
                  name={collection.name}
                  preview={collectionPreviews[collection.id]}
                  variant="row"
                  onSelect={() => void chooseSample(collection.id)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <input ref={folderInputRef} className="visually-hidden-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.svg,image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,image/svg+xml" multiple webkitdirectory="" directory="" onChange={(event) => { const files = event.target.files; if (files?.length) void slideshow.importFiles(files, panelId); event.currentTarget.value = '' }} />
      </header>

      <div className="slideshow-stage card-content" style={{ aspectRatio: stageAspectRatio }}>
        {currentImage ? (
          <CrossfadeImage
            image={currentImage}
            transitionMs={panelSettings.transitionMs}
            zoom={panelSettings.zoom}
            onPointerDown={stopCanvasEvent}
          />
        ) : (
          <div className="empty-stage">
            <h3>Add images</h3>
            <button className="card-icon-button is-primary is-wide empty-stage-folder-button" type="button" onPointerDown={stopCanvasEvent} onClick={() => void chooseFolder()}><FolderOpen size={18} /> Choose a folder</button>
            <span className="empty-stage-divider">Or try a collection from these creators</span>
            <div className="empty-stage-collections">
              {collections.map((collection) => (
                <SampleCollectionCard
                  key={collection.id}
                  name={collection.name}
                  preview={collectionPreviews[collection.id]}
                  variant="tile"
                  onSelect={() => void chooseSample(collection.id)}
                  onPointerDown={stopCanvasEvent}
                />
              ))}
            </div>
            {panelSettings.imageSource.type === 'bundled' || panelError ? <p className="empty-stage-status" role="status">{panelStatus}</p> : null}
          </div>
        )}
      </div>

      <div className="panel-body panel-interactive slideshow-controls" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent} onDragStart={(event) => event.preventDefault()}>
        <div className="transport-row">
          <button className="card-icon-button" type="button" title="Previous image" aria-label="Previous image" onClick={() => slideshow.previous(panelId)}><SkipBack size={18} /></button>
          <button className="card-icon-button is-primary is-large" type="button" title="Start or pause" aria-label={slideshow.isPlayingFor(panelId) ? 'Pause slideshow' : 'Start slideshow'} onClick={() => slideshow.setIsPlaying(!slideshow.isPlayingFor(panelId), panelId)}>{slideshow.isPlayingFor(panelId) ? <Pause size={20} /> : <Play size={20} />}</button>
          <button className="card-icon-button" type="button" title="Next image" aria-label="Next image" onClick={() => slideshow.next(panelId)}><SkipForward size={18} /></button>
          <button className="card-icon-button" type="button" title="Stop" aria-label="Stop slideshow" onClick={() => slideshow.stop(panelId)}><Square size={16} /></button>
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
          <button className={`card-icon-button card-footer-button ${panelSettings.shuffle ? 'is-active' : ''}`} type="button" title="Shuffle" aria-label="Shuffle images" aria-pressed={panelSettings.shuffle} onClick={() => slideshow.updateSettings({ shuffle: !panelSettings.shuffle }, panelId)}><Shuffle size={14} /></button>
        </div>
      </footer>
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
  onPointerDown(event: React.SyntheticEvent): void
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
          onDragStart={(event) => { event.preventDefault(); onPointerDown(event) }}
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
        onDragStart={(event) => { event.preventDefault(); onPointerDown(event) }}
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
