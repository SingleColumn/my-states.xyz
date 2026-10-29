import { useState } from 'react'
import { MoreHorizontal, X } from 'lucide-react'

interface WelcomeCardProps {
  /** `dontShowAgain` is the checkbox as it stood when the card was closed. */
  onClose(dontShowAgain: boolean): void
  onOpenHelp(dontShowAgain: boolean): void
}

/**
 * A short orientation note for people who have not read the help. It sits in
 * the middle of the window, over an icy glass layer, so it is the first thing
 * seen while the panels stay visible behind it. It returns on every visit
 * until the box is ticked. It never takes focus, so it does not interrupt
 * keyboard users until they choose to reach it.
 */
export function WelcomeCard({ onClose, onOpenHelp }: WelcomeCardProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  return (
    // The glass layer keeps the panels visible but quiet behind the card.
    // A press on it closes the card for this visit, as it does for the help dialog.
    <div className="welcome-frost" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(dontShowAgain) }}>
    <section
      className="welcome-card"
      aria-label="Welcome to my-states.xyz"
      // Esc is only claimed while focus is inside the card; elsewhere it has
      // other jobs (leaving the Images focus view, for one).
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose(dontShowAgain)
      }}
    >
      <header className="welcome-card-header">
        <h2>Welcome to my-states.xyz</h2>
        <button className="welcome-card-close" type="button" aria-label="Close welcome message" title="Close" onClick={() => onClose(dontShowAgain)}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <ul className="welcome-card-list">
        <li>my-states.xyz is a private space for people who like writing and can be inspired by images and music and where you can also discover image creators.</li>
        <li>You can write in the <strong>Writing</strong> panel, browse and view image collections in the <strong>Images</strong> panel and search for playlists in the <strong>Music</strong> panel.</li>
        <li>Panels can be selected, moved and resized.</li>
        <li>Your boards are saved in this browser only. Use <strong>Export board</strong> to keep a copy.</li>
        <li>Any <span className="welcome-card-more-button" role="img" aria-label="three dots"><MoreHorizontal size={14} aria-hidden="true" /></span> button reveals more sizing, viewing and formatting options.</li>
      </ul>
      <div className="welcome-card-footer">
        <label className="welcome-card-check">
          <input type="checkbox" checked={dontShowAgain} onChange={(event) => setDontShowAgain(event.target.checked)} />
          <span>Don't show this again</span>
        </label>
        <div className="welcome-card-actions">
          <button className="welcome-card-primary" type="button" onClick={() => onClose(dontShowAgain)}>Got it</button>
          <button className="welcome-card-secondary" type="button" onClick={() => onOpenHelp(dontShowAgain)}>How it works</button>
        </div>
      </div>
    </section>
    </div>
  )
}
