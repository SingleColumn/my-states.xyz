import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const HIDDEN_KEY = 'mic:spotify-preview-notice-hidden'

/**
 * Shown once per visit to the page, not once per panel mount: a board switch
 * or Editor mode remounts the panel. An object so a test can start afresh.
 */
export const previewNoticeVisit = { shown: false }

// Browser storage can be missing or blocked (private windows, site data off).
// The safe fallback is to keep showing the card, so every access is wrapped.
export function isPreviewNoticeHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function setPreviewNoticeHidden(hidden: boolean) {
  try {
    if (hidden) window.localStorage.setItem(HIDDEN_KEY, '1')
    else window.localStorage.removeItem(HIDDEN_KEY)
  } catch {
    // Not remembered; the card simply appears again.
  }
}

/**
 * What to expect from Spotify's player, said once in a card like the welcome
 * card rather than as small print between the results and the player. It sits
 * over the whole window (a portal), because the panel is drawn inside a
 * zoomed canvas, where a fixed-position card would be zoomed with it.
 *
 * The things said here cannot be said later: once Spotify's player sends the
 * visitor to Spotify's site, this page is told nothing until they return.
 */
export function SpotifyPreviewNotice({ onClose }: { onClose(): void }) {
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const close = () => {
    setPreviewNoticeHidden(dontShowAgain)
    onClose()
  }

  return createPortal(
    <div className="welcome-frost" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section
        className="welcome-card spotify-preview-notice"
        role="dialog"
        aria-label="Before you press play"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          close()
        }}
      >
        <header className="welcome-card-header">
          <h2>Before you press play</h2>
          <button className="welcome-card-close" type="button" aria-label="Close" title="Close" onClick={close}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <ul className="welcome-card-list">
          <li>Music here plays through Spotify’s own player. <strong>Without a Spotify login you will hear 30-second previews.</strong></li>
          <li>To hear whole songs, be logged in to Spotify in this same browser. Spotify may take you to its own website to log in: <strong>when you are done, come back to this my-states tab</strong>, then press play again.</li>
          <li>In a private (incognito) window, Spotify does not recognise a login, so only previews play there.</li>
        </ul>
        <div className="welcome-card-footer">
          <label className="welcome-card-check">
            <input type="checkbox" checked={dontShowAgain} onChange={(event) => setDontShowAgain(event.target.checked)} />
            <span>Don't show this again</span>
          </label>
          <div className="welcome-card-actions">
            <button className="welcome-card-primary" type="button" autoFocus onClick={close}>Got it</button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}
