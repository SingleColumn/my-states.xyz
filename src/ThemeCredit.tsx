import { useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'
import { isWebAddress } from './themes/validate'

/**
 * Credit for the published theme (VS Code, Obsidian, Typora...) that the
 * current theme is inspired by. Nothing is drawn when the theme has none.
 *
 * While a panel is full screen its footer (the word count) fills the bottom
 * left of the window, where the credit normally sits. The credit then moves to
 * the right of the footer, on the same line as the count, just left of the
 * note total.
 */
export function ThemeCredit({ url, fullScreen = false }: { url?: string; fullScreen?: boolean }) {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const visible = Boolean(url && isWebAddress(url))

  useEffect(() => {
    const link = linkRef.current
    if (!link || !fullScreen) return
    // Measured rather than calculated: the footer's height and padding come
    // from the theme and from the panel's own scale, so no fixed offset would
    // keep the two lines level. Polled each frame because the panel is
    // resized and rescaled by the board, not by anything this component sees.
    let frame = 0
    let last = ''
    const place = () => {
      const footer = document.querySelector('.canvas-panel-shell.is-full-screen .card-footer')
      if (footer) {
        const line = (footer.querySelector('.card-footer-meta') ?? footer).getBoundingClientRect()
        const status = footer.querySelector('.card-footer-status')?.getBoundingClientRect()
        const rightEdge = (status ?? footer.getBoundingClientRect()).left
        const top = line.top + line.height / 2 - link.offsetHeight / 2
        const right = window.innerWidth - rightEdge + (status ? 16 : 0)
        const key = `${top}|${right}`
        if (key !== last) {
          last = key
          link.style.top = `${top}px`
          link.style.right = `${right}px`
          link.style.bottom = 'auto'
          link.style.left = 'auto'
        }
      }
      frame = requestAnimationFrame(place)
    }
    place()
    return () => {
      cancelAnimationFrame(frame)
      link.style.top = link.style.right = link.style.bottom = link.style.left = ''
    }
  }, [fullScreen, visible])

  // Checked again here because a stored theme is data and the value becomes a link
  if (!url || !isWebAddress(url)) return null
  let host = url
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep the raw text */ }
  return (
    <a ref={linkRef} className="theme-credit" href={url} target="_blank" rel="noopener noreferrer" title={`Original theme that inspired this look (${host})`}>
      <ExternalLink aria-hidden="true" size={10} />
      <span>Theme credit</span>
    </a>
  )
}
