import { ChevronLeft, ChevronRight, Images } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent } from 'react'
import type { CollectionSummary } from '../imageCollections'

export const collectionRotationIntervalMs = 3000
// Automatic browsing can be ambient and unhurried. An explicit arrow press
// needs to answer immediately, so it gets a normal interface transition.
export const collectionCoverTransitionMs = 2500
export const collectionManualCoverTransitionMs = 250
export const collectionCaptionHandoffMs = Math.round(collectionCoverTransitionMs * 0.35)
export const collectionManualCaptionHandoffMs = Math.round(collectionManualCoverTransitionMs * 0.35)
// The first cover should change soon after entering the browser. Subsequent
// rotations use the longer reading interval above.
export const collectionInitialRotationDelayMs = 250

export function initialCollectionIndex(collectionCount: number, randomValue = Math.random()) {
  if (collectionCount <= 0) return 0
  const boundedRandom = Math.min(Math.max(randomValue, 0), 0.999999999)
  return Math.floor(boundedRandom * collectionCount)
}

export interface CollectionBrowserProps {
  collections: CollectionSummary[]
  loading: boolean
  error: string | null
  initialCollectionId?: string
  onSelectCollection(collectionId: string): void
}

/**
 * Presents a browseable set of collection summaries. It deliberately knows
 * nothing about manifests or how a selected collection becomes slideshow
 * images, so another source can provide featured summaries later.
 */
export function CollectionBrowser({
  collections,
  loading,
  error,
  initialCollectionId,
  onSelectCollection,
}: CollectionBrowserProps) {
  // Sample once for this browser instance. Async source completion and ordinary
  // rerenders reuse the same value rather than reshuffling what is featured.
  const [initialRandomValue] = useState(Math.random)
  const [currentId, setCurrentId] = useState<string | null>(() => initialId(collections, initialCollectionId, initialRandomValue))
  const [isHovered, setIsHovered] = useState(false)
  const [hasFocusWithin, setHasFocusWithin] = useState(false)
  const [outgoingCollection, setOutgoingCollection] = useState<CollectionSummary | null>(null)
  const [captionCollectionId, setCaptionCollectionId] = useState<string | null>(currentId)
  const previousCollectionIdRef = useRef<string | null>(currentId)
  const transitionDurationRef = useRef(collectionCoverTransitionMs)
  const hasScheduledInitialRotationRef = useRef(false)
  const rootRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!collections.length) {
      setCurrentId(null)
      return
    }
    setCurrentId((id) => {
      if (id && collections.some((collection) => collection.id === id)) return id
      return initialId(collections, initialCollectionId, initialRandomValue)
    })
  }, [collections, initialCollectionId, initialRandomValue])

  const currentIndex = Math.max(0, collections.findIndex((collection) => collection.id === currentId))
  const currentCollection = collections[currentIndex]
  const captionIndex = Math.max(0, collections.findIndex((collection) => collection.id === captionCollectionId))
  const captionCollection = collections[captionIndex] ?? currentCollection
  const isPaused = isHovered || hasFocusWithin

  // Prepare both layers before the browser paints the new current cover. A
  // normal effect runs after paint and briefly exposes the new cover at full
  // opacity, which looks like a hard cut regardless of the animation length.
  useLayoutEffect(() => {
    const previousId = previousCollectionIdRef.current
    previousCollectionIdRef.current = currentId
    if (!currentId) {
      setOutgoingCollection(null)
      setCaptionCollectionId(null)
      return
    }
    if (!previousId || previousId === currentId) {
      setOutgoingCollection(null)
      setCaptionCollectionId(currentId)
      return
    }
    const previousCollection = collections.find((collection) => collection.id === previousId)
    if (!previousCollection) {
      setOutgoingCollection(null)
      setCaptionCollectionId(currentId)
      return
    }

    setOutgoingCollection(previousCollection)
    const transitionDurationMs = transitionDurationRef.current
    const captionTimeoutId = window.setTimeout(
      () => setCaptionCollectionId(currentId),
      Math.round(transitionDurationMs * 0.35),
    )
    const timeoutId = window.setTimeout(() => setOutgoingCollection(null), transitionDurationMs)
    return () => {
      window.clearTimeout(captionTimeoutId)
      window.clearTimeout(timeoutId)
    }
  }, [collections, currentId])

  useEffect(() => {
    if (loading || error || isPaused || collections.length < 2 || !currentCollection) return
    const delay = hasScheduledInitialRotationRef.current
      ? collectionRotationIntervalMs
      : collectionInitialRotationDelayMs
    hasScheduledInitialRotationRef.current = true
    const timerId = window.setTimeout(() => {
      transitionDurationRef.current = collectionCoverTransitionMs
      setCurrentId(collections[(currentIndex + 1) % collections.length].id)
    }, delay)
    return () => window.clearTimeout(timerId)
  }, [collections, currentCollection, currentIndex, error, isPaused, loading])

  function move(offset: number) {
    if (!collections.length) return
    const nextIndex = (currentIndex + offset + collections.length) % collections.length
    transitionDurationRef.current = collectionManualCoverTransitionMs
    setCurrentId(collections[nextIndex].id)
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHasFocusWithin(false)
  }

  let content
  if (loading) {
    content = <p className="collection-browser-message" role="status">Loading image collections…</p>
  } else if (error) {
    content = <p className="collection-browser-message is-error" role="alert">{error}</p>
  } else if (!currentCollection) {
    content = <p className="collection-browser-message" role="status">No image collections are currently available.</p>
  } else {
    content = (
      <>
        <button
          className="collection-browser-cover"
          type="button"
          aria-label={`Choose ${currentCollection.title} collection`}
          onClick={() => onSelectCollection(currentCollection.id)}
        >
          {outgoingCollection ? (
            <CollectionCoverVisual
              key={`outgoing-${outgoingCollection.id}`}
              collection={outgoingCollection}
              className="is-outgoing"
            />
          ) : null}
          <CollectionCoverVisual
            key={`incoming-${currentCollection.id}`}
            collection={currentCollection}
            className={outgoingCollection ? 'is-incoming' : undefined}
          />
        </button>
        <div className="collection-browser-caption" aria-live="polite" aria-atomic="true">
          <h3>{captionCollection.title}</h3>
          <span>{captionIndex + 1} of {collections.length}</span>
        </div>
        <div className="collection-browser-navigation">
          <button className="card-icon-button" type="button" aria-label="Previous collection" onClick={() => move(-1)}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            className="collection-browser-select"
            type="button"
            aria-label={`Use ${currentCollection.title} collection`}
            onClick={() => onSelectCollection(currentCollection.id)}
          >
            Use this collection
          </button>
          <button className="card-icon-button" type="button" aria-label="Next collection" onClick={() => move(1)}>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </>
    )
  }

  return (
    <section
      ref={rootRef}
      className="collection-browser"
      style={{ '--collection-cover-transition-duration': `${transitionDurationRef.current}ms` } as CSSProperties}
      aria-label="Image collection browser"
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onFocusCapture={() => setHasFocusWithin(true)}
      onBlurCapture={handleBlur}
    >
      <p className="collection-browser-heading">Choose an image collection</p>
      <div className="collection-browser-stage">{content}</div>
    </section>
  )
}

function CollectionCoverVisual({ collection, className }: { collection: CollectionSummary; className?: string }) {
  return (
    <span className={`collection-browser-cover-visual${className ? ` ${className}` : ''}`} aria-hidden="true">
      {collection.coverUrl
        ? <img src={collection.coverUrl} alt="" decoding="async" draggable={false} />
        : <Images className="collection-browser-cover-fallback" aria-hidden="true" />}
    </span>
  )
}

function initialId(collections: CollectionSummary[], preferredId: string | undefined, randomValue: number) {
  if (!collections.length) return null
  if (preferredId && collections.some((collection) => collection.id === preferredId)) return preferredId
  return collections[initialCollectionIndex(collections.length, randomValue)].id
}
