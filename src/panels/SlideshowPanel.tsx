import { FolderOpen, Images, Pause, Play, RotateCcw, Shuffle, SkipBack, SkipForward, Sparkles, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../AppState'
import { getBundledCollections } from '../imageCollections'
import type { ImageItem } from '../types'

const minSlideshowInterval = 250
const maxSlideshowInterval = 5000
const maxSpeed = 20

export function SlideshowPanel() {
  const { slideshow } = useAppState()
  const collections = getBundledCollections()
  const firstImage = slideshow.images[0]
  const currentImage = slideshow.images[slideshow.settings.currentIndex]
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false)
  const [isSamplePickerOpen, setIsSamplePickerOpen] = useState(false)
  const speedValue = intervalToSpeed(slideshow.settings.intervalMs)
  const stageAspectRatio = firstImage?.width && firstImage.height ? `${firstImage.width} / ${firstImage.height}` : undefined

  async function chooseFolder() {
    setIsSamplePickerOpen(false)
    if (window.showDirectoryPicker) {
      const selected = await slideshow.selectFolder()
      if (selected) return
    }
    folderInputRef.current?.click()
  }

  async function chooseSample(collectionId: string) {
    setIsSamplePickerOpen(false)
    await slideshow.selectBundledCollection(collectionId)
  }

  function stopCanvasEvent(event: React.SyntheticEvent) {
    ;(event as unknown as { isKilled?: boolean }).isKilled = true
    ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
    event.stopPropagation()
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
          <button className="card-icon-button" type="button" title="Clear images" aria-label="Clear images" onPointerDown={stopCanvasEvent} onClick={() => void slideshow.resetFolder()}>
            <Trash2 size={18} />
          </button>
        </div>

        {isImagePickerOpen ? (
          <section className="slideshow-image-picker panel-interactive" id="loaded-images-picker" aria-label="Loaded images" onPointerDown={stopCanvasEvent} onClick={stopCanvasEvent}>
            <div className="slideshow-image-picker-heading"><span>Loaded images</span><span>{slideshow.images.length ? `${slideshow.images.length} total` : 'None yet'}</span></div>
            {slideshow.images.length ? (
              <div className="slideshow-image-picker-list">
                {slideshow.images.map((image, index) => (
                  <button className={`slideshow-image-thumbnail ${index === slideshow.settings.currentIndex ? 'is-current' : ''}`} type="button" key={image.id} aria-label={`Show ${image.name}`} aria-pressed={index === slideshow.settings.currentIndex} title={image.name} onClick={() => slideshow.updateSettings({ currentIndex: index })}>
                    <img src={image.url} alt="" draggable={false} />
                  </button>
                ))}
              </div>
            ) : <p className="slideshow-image-picker-empty">{slideshow.status}</p>}
          </section>
        ) : null}

        {isSamplePickerOpen ? (
          <section className="sample-collection-popover panel-interactive" id="sample-collection-picker" aria-label="Sample collections" onPointerDown={stopCanvasEvent} onClick={stopCanvasEvent}>
            <span className="sample-collection-heading">Sample collections</span>
            <div className="sample-collection-list">
              {collections.map((collection) => (
                <button type="button" key={collection.id} onClick={() => void chooseSample(collection.id)}>
                  <span>{collection.name}</span><small>Sample collection</small>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <input ref={folderInputRef} className="visually-hidden-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.svg,image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,image/svg+xml" multiple webkitdirectory="" directory="" onChange={(event) => { const files = event.target.files; if (files?.length) void slideshow.importFiles(files); event.currentTarget.value = '' }} />
      </header>

      <div className="slideshow-stage card-content" style={{ aspectRatio: stageAspectRatio }}>
        {currentImage ? (
          <CrossfadeImage
            image={currentImage}
            transitionMs={slideshow.settings.transitionMs}
            zoom={slideshow.settings.zoom}
            onPointerDown={stopCanvasEvent}
          />
        ) : (
          <div className="empty-stage">
            <Images className="empty-stage-icon" aria-hidden="true" />
            <h3>Add images</h3>
            <button className="empty-stage-folder-button" type="button" onPointerDown={stopCanvasEvent} onClick={() => void chooseFolder()}><FolderOpen size={18} /> Choose a folder</button>
            <span className="empty-stage-divider">Or try a sample collection</span>
            <div className="empty-stage-collections">
              {collections.map((collection) => <button type="button" key={collection.id} onPointerDown={stopCanvasEvent} onClick={() => void chooseSample(collection.id)}>{collection.name}</button>)}
            </div>
            {slideshow.settings.imageSource.type === 'bundled' || slideshow.error ? <p className="empty-stage-status" role="status">{slideshow.status}</p> : null}
          </div>
        )}
      </div>

      <div className="panel-body panel-interactive slideshow-controls" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent} onDragStart={(event) => event.preventDefault()}>
        <div className="transport-row">
          <button className="card-icon-button" type="button" title="Previous image" aria-label="Previous image" onClick={slideshow.previous}><SkipBack size={18} /></button>
          <button className="card-icon-button is-primary is-large" type="button" title="Start or pause" aria-label={slideshow.isPlaying ? 'Pause slideshow' : 'Start slideshow'} onClick={() => slideshow.setIsPlaying(!slideshow.isPlaying)}>{slideshow.isPlaying ? <Pause size={20} /> : <Play size={20} />}</button>
          <button className="card-icon-button" type="button" title="Next image" aria-label="Next image" onClick={slideshow.next}><SkipForward size={18} /></button>
          <button className="card-icon-button" type="button" title="Stop" aria-label="Stop slideshow" onClick={slideshow.stop}><Square size={16} /></button>
        </div>
        <div className="range-grid">
          <label><span>Speed</span><input type="range" min={1} max={maxSpeed} step={1} value={speedValue} onChange={(event) => slideshow.updateSettings({ intervalMs: speedToInterval(Number(event.target.value)) })} /></label>
          <label><span>Fade</span><input type="range" min={0} max={2000} step={50} value={slideshow.settings.transitionMs} onChange={(event) => slideshow.updateSettings({ transitionMs: Number(event.target.value) })} /></label>
        </div>
        <div className="zoom-row">
          <label><span>Zoom</span><input type="range" min={0.5} max={2.4} step={0.05} value={slideshow.settings.zoom} onChange={(event) => slideshow.updateSettings({ zoom: Number(event.target.value) })} /></label>
          <span className="zoom-readout">{Math.round(slideshow.settings.zoom * 100)}%</span>
          <button className="card-icon-button" type="button" title="Reset zoom" aria-label="Reset zoom" onClick={() => slideshow.updateSettings({ zoom: 1 })}><RotateCcw size={17} /></button>
        </div>
      </div>

      <footer className="card-footer panel-interactive" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent}>
        <span className="card-footer-meta">{currentImage?.name ?? slideshow.status}</span>
        <div className="card-footer-status">
          {slideshow.error ? <span className="error-text">{slideshow.error}</span> : <span>{slideshow.images.length ? `${slideshow.settings.currentIndex + 1} / ${slideshow.images.length}` : '0 / 0'}</span>}
          <button className={`card-icon-button card-footer-button ${slideshow.settings.shuffle ? 'is-active' : ''}`} type="button" title="Shuffle" aria-label="Shuffle images" aria-pressed={slideshow.settings.shuffle} onClick={() => slideshow.updateSettings({ shuffle: !slideshow.settings.shuffle })}><Shuffle size={14} /></button>
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
