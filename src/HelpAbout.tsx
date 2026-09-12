import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { appVersion } from './appMetadata'

interface HelpAboutProps {
  isOpen: boolean
  onClose(): void
  returnFocusRef: RefObject<HTMLElement | null>
}

export const HELP_ABOUT_MAIN_SECTION = 'About'
export const HELP_ABOUT_GITHUB_URL = 'https://github.com/SingleColumn/my-states.xyz'
export const HELP_ABOUT_LICENSE_URL = '/licenses/tldraw-3.15.6.txt'
export const HELP_ABOUT_TLDRAW_URL = 'https://tldraw.dev/'
export const HELP_ABOUT_CONTACT_EMAIL = 'robert.tomas.johnston@gmail.com'

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
            <p>my-states is a private space for people who like writing and are inspired by images and music. I mostly use it to write, but sometimes I just look at images while listening to music.</p>
            <p>The motivation for this project started with this thought: there are many creators who use AI as a tool for expression and use Instagram to publish their work; but Instagram is not the right place to enjoy and experience these images. We've become predisposed to swipe. If something catches our attention we might linger a little longer, but it will just be a short time.</p>
            <p>This led me to the question: in what context or medium would it be more natural to spend more time looking at an image that someone has created?</p>
            <p>Images evoke thoughts, feelings and memories, and I like to write these down. Images also evoke sounds and viceversa.</p>
            <p>my-states is an infinite canvas with three panels: one for music (currently Spotify playlists), one for images and one with a text editor. The panels can be selected and resized, moved, hidden, deleted or duplicated, except for the music panel. Panels have various buttons at the top, to change their size and how they look. For example, after I've selected a playlist, I make the music panel small and enlarge the text editor panel to focus on writing; and after I've selected a sample collection of images, I select the focus view option, which makes the image occupy the whole panel.</p>
            <p>my-states comes with various sample collections with the work of image creators that I find inspiring. Each image has a link to the original Instagram post made by the creator.</p>
            <p>my-states is private because it is not necessary to register and log in and it doesn't save any information in the server where it is hosted. It only stores information on your browser.</p>
            <p>Music, images and ideas make up a state, which occurs in a moment in time. In my-states, a moment is a combination of music playlist, images and text document that you can name, export and import again some other time.</p>
            <p>Your moments are stored in your browser, but if you change your browser or close your browser session, the information is lost; but you can export your moments to a hard drive and import them again later.</p>
            <p>I want my-states to be an expressive tool, that doesn't get in the way of writing down the thoughts that come to mind. I also want it to be a place to contemplate the creations of others and find inspiration.</p>
            <dl className="help-about-details">
              <div><dt>Version</dt><dd>{appVersion}</dd></div>
              <div><dt>Contact</dt><dd><a href={`mailto:${HELP_ABOUT_CONTACT_EMAIL}`}>{HELP_ABOUT_CONTACT_EMAIL}</a></dd></div>
              <div><dt>Project</dt><dd><ExternalLink href={HELP_ABOUT_GITHUB_URL}>GitHub repository</ExternalLink></dd></div>
            </dl>
            <p>The application uses third-party software. See <a href="#help-about-licenses">Third-party licences</a>.</p>
          </section>

          <section aria-labelledby="help-about-started">
            <h3 id="help-about-started">Getting started</h3>
            <p>The workspace is an infinite canvas with panels for Music, Images, and Notes. A panel has a frame and its content. The frame is for arranging the panel on the canvas; the content is for using it.</p>
            <ul>
              <li>Select a panel by clicking its frame, for example its title.</li>
              <li>Move a panel by dragging its frame. Buttons, fields, sliders, pictures and the text editor are part of the content and do not move the panel.</li>
              <li>Resize a panel by dragging one of the handles on its selection outline.</li>
              <li>Pan around the canvas with the usual canvas gestures, or select <strong>Pan canvas</strong> and drag anywhere. Select it again to leave pan mode.</li>
              <li>Select <strong>Fit all</strong> (shown as <strong>Fit</strong> on narrower screens) to bring every panel into view.</li>
              <li>Undo and redo are in the toolbar at the top right. Deleting a panel by mistake is undoable.</li>
            </ul>

            <h4>Buttons on every panel</h4>
            <p>The right-hand end of each panel's header carries the same three buttons:</p>
            <ul>
              <li><strong>Hide panel</strong> takes the panel off the canvas without deleting anything. Bring it back from the <strong>Hidden panels</strong> list in the panel view menu (the <strong>…</strong> button next to <strong>Fit all</strong>).</li>
              <li><strong>Expand panel to full screen</strong> grows the panel to fill the window; the same button then reads <strong>Restore previous panel size</strong>.</li>
              <li><strong>Restore panel to default size</strong> returns the panel to the size it started with.</li>
            </ul>

            <h4>Adding, duplicating and deleting panels</h4>
            <ul>
              <li><strong>Add panel</strong> at the top of the canvas adds another Images or Notes panel. There is only ever one Music panel.</li>
              <li>Right-click a panel's frame for a menu with <strong>Hide panel</strong>, arrange and reorder options, <strong>Duplicate</strong> and <strong>Delete</strong>. Ctrl+D duplicates the selected panel and Delete or Backspace removes it. The Music panel cannot be duplicated.</li>
              <li>The panel view menu (<strong>…</strong>) also offers <strong>Fit selected panel</strong>, <strong>Reset selected panel size</strong>, <strong>Reset panel layout</strong>, which puts every panel back where it started and unhides any hidden ones, and <strong>Hide selected panel</strong>.</li>
            </ul>
          </section>

          <section aria-labelledby="help-about-panels">
            <h3 id="help-about-panels">Panels</h3>

            <h4>Music</h4>
            <p>Select <strong>Log in</strong> to connect to Spotify. After logging in, search for songs or playlists, or paste a Spotify playlist URL or URI and load it. Select a search result to play it. When a track is playing, use the previous, play/pause, next, seek, and volume controls. <strong>Reset fields</strong> clears the search and URL fields. Spotify playback requires an eligible Spotify Premium account. Select <strong>Log out</strong> to disconnect.</p>
            <p>The panel shows the playlist that is loaded, with its cover. To keep only the playlist, the current track, and the playback controls while you work elsewhere, select <strong>Reduce panel to focus view</strong> in the panel header; the panel becomes smaller and stays that way until you select <strong>Expand panel to full view</strong> in the same place.</p>

            <h4>Images</h4>
            <p>An empty Images panel offers two ways in: <strong>Choose a folder</strong> to load supported images from a folder on your computer, or one of the sample collection tiles. Where the browser cannot open a folder directly, the file picker is used instead.</p>
            <p>The panel header has the same choices and two more: <strong>Choose a local folder</strong>, <strong>Load a sample collection</strong>, <strong>Show loaded images</strong>, which opens a list of thumbnails you can pick from, and <strong>Clear images</strong>, which removes the loaded images from the panel.</p>
            <p>Below the picture, use <strong>Previous image</strong>, <strong>Start slideshow</strong> (which becomes <strong>Pause slideshow</strong>), <strong>Next image</strong>, <strong>Stop slideshow</strong> and <strong>Shuffle images</strong> to control the slideshow. Adjust <strong>Speed</strong>, <strong>Fade</strong>, and <strong>Zoom</strong> with their sliders; <strong>Reset zoom</strong> returns the zoom to its default value.</p>
            <p>Every picture in a sample collection carries a credit. Move the pointer over the picture to see who made it and to follow a link to the original post.</p>
            <p>To look at the pictures on their own, select <strong>Reduce panel to focus view</strong> in the header. The panel keeps its size and shows only the picture, with every control hidden, including the header. Press <strong>Esc</strong> to bring the controls back; the panel reminds you of this whenever the pointer is over it. While in focus view, drag the picture itself to move the panel.</p>

            <h4>Notes</h4>
            <p>Select <strong>New note</strong> in the header, or <strong>Create new note</strong> in the <strong>Choose a note</strong> list, to start a note. <strong>Choose a note</strong> switches between your notes and <strong>Note title</strong> renames the current one. Write in the editor; changes save automatically. Type <code>#</code> at the start of a line for a heading or <code>-</code> for a list item.</p>
            <p>The formatting tools are folded away to keep the page quiet. Select <strong>Aa</strong> (<strong>Show formatting tools</strong>) in the header to reveal a toolbar with headings, bold, italic, underline, code, lists, links, tables, dividers, code blocks, a choice of editor text size, and a switch to the Markdown source. Select <strong>Aa</strong> again to hide it; the choice is remembered.</p>
            <p><strong>Expand panel to full screen</strong> turns the Notes panel into a writing page: the form controls step aside, the title sits above the text, and the footer counts words instead of characters. <strong>Restore previous panel size</strong> brings the panel view back.</p>
            <p>Use <strong>Save markdown file</strong> to download the current note as a <code>.md</code> file, and <strong>Delete note</strong> to remove it after confirmation. Notes cannot be imported one at a time; they travel with a moment when it is exported and imported.</p>
          </section>

          <section aria-labelledby="help-about-moments">
            <h3 id="help-about-moments">Moments</h3>
            <p>A moment is everything on the canvas at once: the camera and panel layout, the Music playlist reference, the Images settings together with local copies of any images you loaded, and your Notes.</p>
            <p>The controls at the top left of the canvas manage moments. Pick one from <strong>Open moment</strong>, create one with <strong>New moment</strong>, and use <strong>Rename moment</strong> or <strong>Delete moment</strong> on the current one; the <strong>…</strong> button beside them repeats these actions. Deleting a moment removes this app's local copies of its images and notes after confirmation; original files and exported archives are unaffected.</p>
            <p>Use <strong>Export moment</strong> to download a portable <code>.mix-session.zip</code> archive, and <strong>Import moment</strong> to load one. An imported moment brings its canvas layout, settings, Markdown notes, and embedded local images. Spotify login tokens and live playback data are never included.</p>
            <p>Moments live in your browser's storage, not on a server. The browser keeps the moments themselves, their notes and images, and, where it allows it, a remembered image folder. Your Spotify login and a few editor preferences are kept separately in the same browser. Clearing the site's browser data removes all of it, browser storage limits apply, and a remembered folder may ask for permission again after a restart. Export a moment when you need a backup.</p>
          </section>

          <section id="help-about-licenses" aria-labelledby="help-about-licenses-heading">
            <h3 id="help-about-licenses-heading">Third-party licences</h3>
            <p>my-states uses third-party software. <ExternalLink href={HELP_ABOUT_TLDRAW_URL}>tldraw</ExternalLink> is the canvas SDK used to provide the drawing surface, canvas interactions, and canvas UI.</p>
            <p>This application includes tldraw version <strong>3.15.6</strong>. Read the <ExternalLink href={HELP_ABOUT_LICENSE_URL}>tldraw licence</ExternalLink>.</p>
          </section>
        </div>
      </section>
    </div>
  )
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}<span className="help-about-external" aria-label=" (opens in a new tab)"> ↗</span></a>
}
