import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ImageItem } from '../types'
import { panelContentProps } from '../panelSurface'

/**
 * A full-screen look at one picture of the collection, with its credit and a
 * link back to where it came from. It keeps its own position so browsing here
 * never disturbs the slideshow behind it.
 */
export function ImageViewer({
  images,
  startIndex,
  onClose,
}: {
  images: ImageItem[]
  startIndex: number
  onClose(): void
}) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(images.length - 1, 0)))
  const image = images[index]
  const count = images.length

  function step(offset: number) {
    if (count < 2) return
    setIndex((current) => (current + offset + count) % count)
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (event.key !== 'Escape' && !offset) return
      // The canvas underneath answers these keys too (Escape clears its
      // selection, arrows nudge it), so the viewer takes them first.
      event.preventDefault()
      event.stopPropagation()
      if (offset) step(offset)
      else onClose()
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [count, onClose])

  if (!image) return null
  const attribution = image.attribution

  return createPortal(
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label="Full-screen image" onClick={onClose} {...panelContentProps}>
      <button className="image-viewer-close" type="button" aria-label="Close full-screen view" title="Close (Esc)" onClick={onClose}>
        <X size={20} aria-hidden="true" />
      </button>
      {count > 1 ? (
        <button
          className="image-viewer-step is-previous"
          type="button"
          aria-label="Previous image"
          onClick={(event) => { event.stopPropagation(); step(-1) }}
        >
          <ChevronLeft size={28} aria-hidden="true" />
        </button>
      ) : null}
      <img className="image-viewer-picture" src={image.url} alt={image.name} draggable={false} onClick={(event) => event.stopPropagation()} />
      {count > 1 ? (
        <button
          className="image-viewer-step is-next"
          type="button"
          aria-label="Next image"
          onClick={(event) => { event.stopPropagation(); step(1) }}
        >
          <ChevronRight size={28} aria-hidden="true" />
        </button>
      ) : null}
      <div className="image-viewer-caption" onClick={(event) => event.stopPropagation()}>
        <span className="image-viewer-credit">
          {attribution ? (
            <>
              <span className="image-viewer-label">Image by</span>
              {attribution.creatorUrl ? (
                <a href={attribution.creatorUrl} target="_blank" rel="noreferrer noopener">{attribution.creator}</a>
              ) : (
                <strong>{attribution.creator}</strong>
              )}
            </>
          ) : <span className="image-viewer-label">{image.name}</span>}
        </span>
        <span className="image-viewer-counter">{index + 1} of {count}</span>
        {attribution?.sourceUrl ? (
          <a className="image-viewer-source" href={attribution.sourceUrl} target="_blank" rel="noreferrer noopener">Original post ↗</a>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
