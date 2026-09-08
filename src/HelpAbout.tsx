import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { appVersion } from './appMetadata'

interface HelpAboutProps {
  isOpen: boolean
  onClose(): void
  returnFocusRef: RefObject<HTMLElement | null>
}

export const HELP_ABOUT_MAIN_SECTION = 'About'
export const HELP_ABOUT_GITHUB_URL = 'https://github.com/SingleColumn/music-images-canvas'
export const HELP_ABOUT_LICENSE_URL = '/licenses/tldraw-3.15.6.txt'
export const HELP_ABOUT_TLDRAW_URL = 'https://tldraw.dev/'

/**
 * This view intentionally mirrors docs/about.md. Keep the headings,
 * links, and user-facing instructions aligned when either source changes.
 */
export function HelpAbout({ isOpen, onClose, returnFocusRef }: HelpAboutProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    closeButtonRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true
      return
    }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    const returnTarget = returnFocusRef.current
    if (returnTarget?.isConnected) returnTarget.focus()
    else document.querySelector<HTMLElement>('[data-testid="actions-menu.button"]')?.focus()
  }, [isOpen, returnFocusRef])

  if (!isOpen) return null

  return (
    <div className="help-about-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="help-about-dialog" role="dialog" aria-modal="true" aria-labelledby="help-about-title" tabIndex={-1}>
        <header className="help-about-header">
          <h2 id="help-about-title">Help &amp; About</h2>
          <button ref={closeButtonRef} className="help-about-close" type="button" aria-label="Close Help & About" title="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="help-about-content">
          <section aria-labelledby="help-about-about">
            <h3 id="help-about-about">About</h3>
            <p>Music Images Canvas is a local-first workspace for arranging music, image references, and notes on one canvas.</p>
            <dl className="help-about-details">
              <div><dt>Version</dt><dd>{appVersion}</dd></div>
              <div><dt>Contact</dt><dd><span>[your email address]</span></dd></div>
              <div><dt>Project</dt><dd><ExternalLink href={HELP_ABOUT_GITHUB_URL}>GitHub repository</ExternalLink></dd></div>
            </dl>
            <p>The application uses third-party software. See <a href="#help-about-licenses">Third-party licences</a>.</p>
          </section>

          <section aria-labelledby="help-about-started">
            <h3 id="help-about-started">Getting started</h3>
            <p>The workspace is a tldraw canvas containing draggable and resizable panels for Music, Images, and Notes.</p>
            <ul>
              <li>Select a panel by clicking its frame.</li>
              <li>Move a panel by dragging its frame. Controls inside a panel are reserved for using that panel and do not move it.</li>
              <li>Resize a panel by dragging one of its resize handles.</li>
              <li>Pan around the canvas by using the Pan control, then dragging the canvas. You can also use the usual canvas gestures.</li>
              <li>Select <strong>Fit</strong> (the <strong>Fit all</strong> control on wider screens) to bring all panels into view.</li>
              <li>To reset one panel to its default size, select it, open the canvas view actions menu (the second <strong>…</strong> menu), and select <strong>Reset selected panel size</strong>.</li>
            </ul>
            <p>When you interact with a panel's buttons, fields, sliders, editor, or other content, the interaction stays inside the panel. Use the panel frame or resize handles when you want to manipulate the panel on the canvas.</p>
          </section>

          <section aria-labelledby="help-about-panels"><h3 id="help-about-panels">Panels</h3>
            <h4>Music</h4><p>Select <strong>Log in</strong> to connect to Spotify. After logging in, search for songs or playlists, or paste a Spotify playlist URL or URI and load it. Search results can be selected for playback. When a track is playing, use the previous, play/pause, next, seek, and volume controls. Spotify playback requires an eligible Spotify Premium account and a working Spotify Developer app configuration. Select <strong>Log out</strong> to disconnect.</p><p>The panel shows the playlist that is loaded, with its cover. To keep only the playlist, the current track, and the playback controls while you work elsewhere, select <strong>Reduce panel to focus view</strong> at the top of the panel; the panel becomes smaller and stays that way until you select <strong>Expand panel to full view</strong>.</p>
            <h4>Images</h4><p>Select <strong>Choose a local folder</strong> to load supported images from a folder. If folder access is unavailable, the browser uses its directory file picker. You can also select <strong>Load a sample collection</strong> and choose one of the bundled collections. <strong>Loaded images</strong> opens a list where you can select an image to show; <strong>Clear images</strong> removes the loaded images from the panel.</p><p>These four buttons sit on their own row below the picture, directly above the playback buttons. Use <strong>Shuffle</strong>, <strong>Previous image</strong>, <strong>Start slideshow</strong>, <strong>Pause slideshow</strong>, <strong>Next image</strong>, and <strong>Stop</strong> on the row beneath them to control the slideshow; <strong>Shuffle</strong> changes the order behavior. Adjust <strong>Speed</strong>, <strong>Fade</strong>, and <strong>Zoom</strong> with their sliders; <strong>Reset zoom</strong> returns the zoom to its default value.</p><p>To watch the slideshow on its own, select <strong>Reduce panel to focus view</strong> at the top of the panel: the panel keeps its size and shows only the picture, so the image takes the room the controls had. The image and folder buttons are part of those controls, so they are hidden too. Select <strong>Expand panel to full view</strong> to bring them all back.</p>
            <h4>Notes</h4><p>Select <strong>New note</strong> or <strong>Create new note</strong> to create a note. Use <strong>Choose a note</strong> to select an existing note and <strong>Note title</strong> to rename it. Edit the note in the Markdown editor; changes save automatically. The editor toolbar provides the available formatting, link, table, thematic-break, code-block, list, and source-view controls.</p><p>Use <strong>Save markdown file</strong> to export the active note as a <code>.md</code> file, and <strong>Delete note</strong> to remove it after confirmation. There is no standalone Markdown note-import control. Notes can be imported as part of an imported session archive.</p>
          </section>

          <section aria-labelledby="help-about-sessions"><h3 id="help-about-sessions">Sessions</h3><p>A session contains the canvas camera and panel layout, the Music playlist reference, Images settings and locally stored image copies, and Notes.</p><p>Use the session controls at the top of the canvas to select a session from <strong>Open session</strong>, create one with <strong>New session</strong>, rename it, or delete it. Deleting a session removes this app's local copies of its images and notes; original files and exported archives are unaffected.</p><p>Use <strong>Export session</strong> to download a portable <code>.mix-session.zip</code> archive. Use <strong>Import session</strong> to load one; imported sessions include their canvas layout, settings, Markdown notes, and embedded local image assets. Spotify login tokens and live playback data are not included.</p><p>Session data is currently stored in the browser's IndexedDB. IndexedDB stores sessions, canvas/layout data, slideshow state, Markdown notes, image blobs and metadata, and—when the browser permits it—a remembered folder handle. <code>localStorage</code> stores the active session ID and Spotify authentication data.</p><p>This is local browser storage: clearing the site's browser data removes local sessions, notes, images, settings, and the Spotify session. Browser storage limits also apply. A remembered folder may require permission again after a restart, and the fallback directory picker does not retain a folder handle. Export sessions or notes when you need a backup.</p></section>

          <section id="help-about-licenses" aria-labelledby="help-about-licenses-heading"><h3 id="help-about-licenses-heading">Third-party licences</h3><p>Music Images Canvas uses third-party software. <ExternalLink href={HELP_ABOUT_TLDRAW_URL}>tldraw</ExternalLink> is the canvas SDK used to provide the drawing surface, canvas interactions, and canvas UI.</p><p>This application includes tldraw version <strong>3.15.6</strong>. Read the <ExternalLink href={HELP_ABOUT_LICENSE_URL}>tldraw licence</ExternalLink>.</p></section>
        </div>
      </section>
    </div>
  )
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}<span className="help-about-external" aria-label=" (opens in a new tab)"> ↗</span></a>
}
