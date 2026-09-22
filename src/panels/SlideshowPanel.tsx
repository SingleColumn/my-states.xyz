import { ChevronsDownUp, ChevronsUpDown, FolderOpen, GripVertical, Images, Pause, Play, RotateCcw, Shuffle, SkipBack, SkipForward, Sparkles, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../AppState'
import type { ImageItem, Panel } from '../types'
import { DEFAULT_SLIDESHOW_ZOOM } from '../storage'
import { SampleCollectionCard, useBundledCollections } from './SampleCollectionCard'
import { PanelHeader, usePanelCommands } from '../PanelHeader'
import { ImageAttributionOverlay } from './imageAttribution'
import { panelContentProps } from '../panelSurface'
import { embedTitleFor, PANEL_DRAG_TYPE } from './notesEmbed'

const minSlideshowInterval = 250
const maxSlideshowInterval = 12000
const focusHintDurationMs = 3500

/* Escape has to reach exactly one panel. Several panels can be in focus view at
   once, and each listens on the window, so they share a stack and only the one
   entered most recently acts. */
const focusViewStack: string[] = []

/**
 * This panel follows the content-region rule in panelSurface.ts. It carries no pointer
 * handlers of its own and no pointer-events overrides: each region the
 * user operates -- the header actions, the picture, the controls, the footer
 * -- is declared with `panelContentProps`, and nothing else is.
 */
export function SlideshowPanel({ panelId }: { panelId: string }) {
  const { slideshow, panels } = useAppState()
  const commands = usePanelCommands()
  const found = panels.get(panelId)
  const panel = found?.type === 'slideshow' ? (found as Panel<'slideshow'>) : undefined
  const panelSettings = panel?.config ?? slideshow.settingsFor(panelId)
  const currentIndex = slideshow.currentIndexFor(panelId)
  // Focus view leaves the picture alone on the panel: every control is dropped,
  // including the header, so Escape is the only way back out.
  const focusView = panel?.focusView === true
  const collections = useBundledCollections()
  const panelImages = slideshow.imagesFor(panelId)
  const panelStatus = slideshow.statusFor(panelId)
  const panelError = slideshow.errorFor(panelId)
  const firstImage = panelImages[0]
  const currentImage = panelImages[currentIndex]
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false)
  const [isSamplePickerOpen, setIsSamplePickerOpen] = useState(false)
  const stageAspectRatio = firstImage?.width && firstImage.height ? `${firstImage.width} / ${firstImage.height}` : undefined
  const attribution = currentImage?.attribution ?? null
  const [isFocusHintVisible, setIsFocusHintVisible] = useState(false)
  const focusHintTimeoutRef = useRef<number | null>(null)
  // True while the hint shown on entering focus view is up. That showing runs
  // its full course: the instant the controls vanish, the browser reports the
  // pointer leaving the panel (the picture now under it is frame, not
  // content), which would otherwise dismiss the hint before anyone reads it.
  const focusHintIsEntryRef = useRef(false)

  // The stage is content whenever it holds something to operate: the empty
  // state's buttons, or a picture a click must not drag. In focus view the
  // header that normally drags the panel is gone, so the picture becomes
  // frame and the whole panel can be moved by it.
  const stageIsContent = !(focusView && currentImage)

  function showFocusHint(onEntry: boolean) {
    if (focusHintTimeoutRef.current !== null) window.clearTimeout(focusHintTimeoutRef.current)
    focusHintIsEntryRef.current = onEntry
    setIsFocusHintVisible(true)
    focusHintTimeoutRef.current = window.setTimeout(() => {
      focusHintIsEntryRef.current = false
      setIsFocusHintVisible(false)
    }, focusHintDurationMs)
  }

  function revealFocusHint() {
    // A pointer move during the entry showing neither restarts nor demotes it.
    if (focusHintIsEntryRef.current) return
    showFocusHint(false)
  }

  function hideFocusHint() {
    if (focusHintIsEntryRef.current) return
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
    if (focusView) showFocusHint(true)
    return () => {
      if (focusHintTimeoutRef.current !== null) window.clearTimeout(focusHintTimeoutRef.current)
      focusHintIsEntryRef.current = false
      setIsFocusHintVisible(false)
    }
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

  return (
    <section
      className={focusView ? 'panel panel-slideshow-surface is-focus-view' : 'panel panel-slideshow-surface'}
      onPointerMove={focusView ? revealFocusHint : undefined}
      onPointerLeave={focusView ? hideFocusHint : undefined}
    >
      {focusView ? null : (
      <PanelHeader
        panelId={panelId}
        panelType="slideshow"
        title="Images"
        menuItems={[
          {
            id: 'loaded-images',
            label: `${isImagePickerOpen ? 'Hide' : 'Show'} loaded images`,
            icon: <Images size={17} aria-hidden="true" />,
            checked: isImagePickerOpen,
            onSelect: () => { setIsSamplePickerOpen(false); setIsImagePickerOpen((current) => !current) },
          },
          { id: 'choose-folder', label: 'Choose a local folder', icon: <FolderOpen size={17} aria-hidden="true" />, onSelect: () => void chooseFolder() },
          {
            id: 'sample-collection',
            label: 'Load a sample collection',
            icon: <Sparkles size={17} aria-hidden="true" />,
            checked: isSamplePickerOpen,
            onSelect: () => { setIsImagePickerOpen(false); setIsSamplePickerOpen((current) => !current) },
          },
          { id: 'clear', label: 'Clear images', icon: <Trash2 size={17} aria-hidden="true" />, destructive: true, onSelect: () => void slideshow.resetFolder(panelId) },
          {
            id: 'focus-view',
            label: focusView ? 'Expand panel to full view' : 'Reduce panel to focus view',
            icon: focusView ? <ChevronsUpDown size={17} aria-hidden="true" /> : <ChevronsDownUp size={17} aria-hidden="true" />,
            onSelect: () => commands.togglePanelFocusView(panelId),
          },
        ]}
      >
        {isImagePickerOpen ? (
          <section className="slideshow-image-picker" id="loaded-images-picker" aria-label="Loaded images" {...panelContentProps}>
            <div className="slideshow-image-picker-heading"><span>Loaded images</span><span>{panelImages.length ? `${panelImages.length} total` : 'None yet'}</span></div>
            {panelImages.length ? (
              <div className="slideshow-image-picker-list">
                {panelImages.map((image, index) => (
                  <button className={`slideshow-image-thumbnail ${index === currentIndex ? 'is-current' : ''}`} type="button" key={image.id} aria-label={`Show ${image.name}`} aria-pressed={index === currentIndex} title={image.name} onClick={() => slideshow.updateSettings({ currentIndex: index }, panelId)}>
                    <img src={image.url} alt="" draggable={false} />
                  </button>
                ))}
              </div>
            ) : <p className="slideshow-image-picker-empty">{panelStatus}</p>}
          </section>
        ) : null}

        {isSamplePickerOpen ? (
          <section className="sample-collection-popover" id="sample-collection-picker" aria-label="Sample collections" {...panelContentProps}>
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
      <div className="slideshow-stage card-content" style={{ aspectRatio: focusView ? undefined : stageAspectRatio }} {...(stageIsContent ? panelContentProps : {})}>
        {currentImage ? (
          <>
          <CrossfadeImage
            image={currentImage}
            transitionMs={panelSettings.transitionMs}
            zoom={panelSettings.zoom}
          />
          {attribution ? <ImageAttributionOverlay attribution={attribution} /> : null}
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
              <button className="card-icon-button is-wide empty-stage-folder-button" type="button" onClick={() => void chooseFolder()}><FolderOpen size={18} /> Choose a folder</button>
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
        <div className="panel-body slideshow-controls" {...panelContentProps} onDragStart={(event) => event.preventDefault()}>
          <div className="transport-row">
            <button className="card-icon-button" type="button" title="Previous image" aria-label="Previous image" onClick={() => slideshow.previous(panelId)}><SkipBack size={18} /></button>
            <button className="card-icon-button is-primary is-large" type="button" title="Start or pause" aria-label={slideshow.isPlayingFor(panelId) ? 'Pause slideshow' : 'Start slideshow'} onClick={() => slideshow.setIsPlaying(!slideshow.isPlayingFor(panelId), panelId)}>{slideshow.isPlayingFor(panelId) ? <Pause size={20} /> : <Play size={20} />}</button>
            <button className="card-icon-button" type="button" title="Next image" aria-label="Next image" onClick={() => slideshow.next(panelId)}><SkipForward size={18} /></button>
            <button className="card-icon-button" type="button" title="Stop" aria-label="Stop slideshow" onClick={() => slideshow.stop(panelId)}><Square size={16} /></button>
            <button className={`card-icon-button ${panelSettings.shuffle ? 'is-active' : ''}`} type="button" title="Shuffle" aria-label="Shuffle images" aria-pressed={panelSettings.shuffle} onClick={() => slideshow.updateSettings({ shuffle: !panelSettings.shuffle }, panelId)}><Shuffle size={18} /></button>
            {/* The handle a note takes this panel by. The picture itself is
                not draggable (see CrossfadeImage), and the controls box above
                cancels native drags, so the handle stops the event there. */}
            {currentImage && panel ? (
              <span
                className="card-icon-button slideshow-drag-handle"
                role="img"
                draggable
                title="Drag into a note to embed this panel"
                aria-label="Drag into a note to embed this panel"
                onDragStart={(event) => {
                  event.stopPropagation()
                  event.dataTransfer.effectAllowed = 'copy'
                  event.dataTransfer.setData(PANEL_DRAG_TYPE, JSON.stringify({ panelId, title: embedTitleFor(panel, currentImage.name) }))
                  // Plain text too, so a drop anywhere else gets the title.
                  event.dataTransfer.setData('text/plain', embedTitleFor(panel, currentImage.name))
                }}
              >
                <GripVertical size={18} />
              </span>
            ) : null}
          </div>
          <div className="range-grid">
            <label><span>Speed <output className="slideshow-control-value">{panelSettings.intervalMs} ms</output></span><input type="range" min={minSlideshowInterval} max={maxSlideshowInterval} step={250} value={panelSettings.intervalMs} onChange={(event) => slideshow.updateSettings({ intervalMs: Number(event.target.value) }, panelId)} /></label>
            <label><span>Fade <output className="slideshow-control-value">{panelSettings.transitionMs} ms</output></span><input type="range" min={0} max={4000} step={50} value={panelSettings.transitionMs} onChange={(event) => slideshow.updateSettings({ transitionMs: Number(event.target.value) }, panelId)} /></label>
          </div>
          <div className="zoom-row">
            <label><span>Zoom <output className="slideshow-control-value">{Math.round(panelSettings.zoom * 100)}%</output></span><input type="range" min={0.5} max={2.4} step={0.05} value={panelSettings.zoom} onChange={(event) => slideshow.updateSettings({ zoom: Number(event.target.value) }, panelId)} /></label>
            <span className="zoom-readout">{Math.round(panelSettings.zoom * 100)}%</span>
            <button className="card-icon-button" type="button" title="Reset zoom" aria-label="Reset zoom" onClick={() => slideshow.updateSettings({ zoom: DEFAULT_SLIDESHOW_ZOOM }, panelId)}><RotateCcw size={17} /></button>
          </div>
        </div>

        <footer className="card-footer" {...panelContentProps}>
            <span className="card-footer-meta">{currentImage?.name ?? panelStatus}</span>
          <div className="card-footer-status">
            {panelError ? <span className="error-text">{panelError}</span> : <span>{panelImages.length ? `${currentIndex + 1} / ${panelImages.length}` : '0 / 0'}</span>}
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
}: {
  image: ImageItem
  transitionMs: number
  zoom: number
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
  // The browser's own image drag would fight both the panel drag (focus view)
  // and the click that must not drag (full view); neither wants it.
  const preventNativeDrag = (event: React.DragEvent) => event.preventDefault()

  return (
    <>
      {outgoingImage ? (
        <img
          className="slideshow-image-layer slideshow-image-outgoing"
          src={outgoingImage.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          onDragStart={preventNativeDrag}
          style={imageStyle}
        />
      ) : null}
      <img
        className={`slideshow-image-layer ${outgoingImage ? 'slideshow-image-incoming' : ''}`}
        key={displayedImage.id}
        src={displayedImage.url}
        alt={displayedImage.name}
        draggable={false}
        onDragStart={preventNativeDrag}
        style={{ ...imageStyle, animationDuration: `${transitionMs}ms` }}
      />
    </>
  )
}
