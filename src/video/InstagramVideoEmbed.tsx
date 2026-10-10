import { useEffect, useRef, useState } from 'react'
import type { VideoCatalogItem } from '../videoCatalog'
import { processInstagramEmbeds } from './instagramEmbedScript'

const embedTimeoutMs = 12_000

export function InstagramVideoEmbed({ item }: { item: VideoCatalogItem }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let active = true
    setStatus('loading')

    const detectEmbed = () => {
      if (active && root.querySelector('iframe')) setStatus('ready')
    }
    const observer = new MutationObserver(detectEmbed)
    observer.observe(root, { childList: true, subtree: true })
    const timeoutId = window.setTimeout(() => {
      if (active && !root.querySelector('iframe')) setStatus('unavailable')
    }, embedTimeoutMs)

    void processInstagramEmbeds()
      .then(detectEmbed)
      .catch(() => { if (active) setStatus('unavailable') })

    return () => {
      active = false
      observer.disconnect()
      window.clearTimeout(timeoutId)
    }
  }, [item.id])

  return (
    <div ref={rootRef} className={`instagram-video-embed is-${status}`}>
      {status === 'unavailable' ? (
        <VideoUnavailable sourceUrl={item.sourceUrl} />
      ) : (
        <>
          <blockquote
            className="instagram-media"
            data-instgrm-permalink={item.sourceUrl}
            data-instgrm-version="14"
          >
            <a href={item.sourceUrl} target="_blank" rel="noreferrer">View {item.title} on Instagram</a>
          </blockquote>
          {status === 'loading' ? <p className="video-embed-status" role="status">Loading video from Instagram…</p> : null}
        </>
      )}
    </div>
  )
}

function VideoUnavailable({ sourceUrl }: { sourceUrl: string }) {
  return (
    <div className="video-panel-message" role="status">
      <strong>Instagram could not display this video.</strong>
      <span>The post may be unavailable, private, or restricted from embedding.</span>
      <a href={sourceUrl} target="_blank" rel="noreferrer">Open on Instagram</a>
    </div>
  )
}
