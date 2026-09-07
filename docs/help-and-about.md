# Help & About

## About

Music Images Canvas is a local-first workspace for arranging music, image references, and notes on one canvas.

- Version: 0.1.0
- Contact: `[your email address]`
- GitHub: [SingleColumn/music-images-canvas](https://github.com/SingleColumn/music-images-canvas)

The application uses third-party software. See [Third-party licences](#third-party-licences).

## Getting started

The workspace is a tldraw canvas containing draggable and resizable panels for Music, Images, and Notes.

- Select a panel by clicking its frame.
- Move a panel by dragging its frame. Controls inside a panel are reserved for using that panel and do not move it.
- Resize a panel by dragging one of its resize handles.
- Pan around the canvas by using the Pan control, then dragging the canvas. You can also use the usual canvas gestures.
- Select **Fit** (the **Fit all** control on wider screens) to bring all panels into view.
- To reset one panel to its default size, select it, open the canvas view actions menu (the second **…** menu), and select **Reset selected panel size**.

When you interact with a panel's buttons, fields, sliders, editor, or other content, the interaction stays inside the panel. Use the panel frame or resize handles when you want to manipulate the panel on the canvas.

## Panels

### Music

Select **Log in** to connect to Spotify. After logging in, search for songs or playlists, or paste a Spotify playlist URL or URI and load it. Search results can be selected for playback. When a track is playing, use the previous, play/pause, next, seek, and volume controls. Spotify playback requires an eligible Spotify Premium account and a working Spotify Developer app configuration. Select **Log out** to disconnect.

The panel shows the playlist that is loaded, with its cover. To keep only the playlist, the current track, and the playback controls while you work elsewhere, select **Reduce panel to focus view** at the top of the panel; the panel becomes smaller and stays that way until you select **Expand panel to full view**.

### Images

Select **Choose a local folder** to load supported images from a folder. If folder access is unavailable, the browser uses its directory file picker. You can also select **Load a sample collection** and choose one of the bundled collections. **Loaded images** opens a list where you can select an image to show; **Clear images** removes the loaded images from the panel.

These four buttons sit on their own row below the picture, directly above the playback buttons. Use **Shuffle**, **Previous image**, **Start slideshow**, **Pause slideshow**, **Next image**, and **Stop** on the row beneath them to control the slideshow; **Shuffle** changes the order behavior. Adjust **Speed**, **Fade**, and **Zoom** with their sliders; **Reset zoom** returns the zoom to its default value.

To watch the slideshow on its own, select **Reduce panel to focus view** at the top of the panel: the panel keeps its size and shows only the picture, so the image takes the room the controls had. The image and folder buttons are part of those controls, so they are hidden too. Select **Expand panel to full view** to bring them all back.

### Notes

Select **New note** or **Create new note** to create a note. Use **Choose a note** to select an existing note and **Note title** to rename it. Edit the note in the Markdown editor; changes save automatically. The editor toolbar provides the available formatting, link, table, thematic-break, code-block, list, and source-view controls.

Use **Save markdown file** to export the active note as a `.md` file, and **Delete note** to remove it after confirmation. There is no standalone Markdown note-import control. Notes can be imported as part of an imported session archive.

## Sessions

A session contains the canvas camera and panel layout, the Music playlist reference, Images settings and locally stored image copies, and Notes.

Use the session controls at the top of the canvas to select a session from **Open session**, create one with **New session**, rename it, or delete it. Deleting a session removes this app's local copies of its images and notes; original files and exported archives are unaffected.

Use **Export session** to download a portable `.mix-session.zip` archive. Use **Import session** to load one; imported sessions include their canvas layout, settings, Markdown notes, and embedded local image assets. Spotify login tokens and live playback data are not included.

Session data is currently stored in the browser's IndexedDB. IndexedDB stores sessions, canvas/layout data, slideshow state, Markdown notes, image blobs and metadata, and—when the browser permits it—a remembered folder handle. `localStorage` stores the active session ID and Spotify authentication data.

This is local browser storage: clearing the site's browser data removes local sessions, notes, images, settings, and the Spotify session. Browser storage limits also apply. A remembered folder may require permission again after a restart, and the fallback directory picker does not retain a folder handle. Export sessions or notes when you need a backup.

## Third-party licences

Music Images Canvas uses third-party software. [tldraw](https://tldraw.dev/) is the canvas SDK used to provide the drawing surface, canvas interactions, and canvas UI.

This application includes tldraw version **3.15.6**. Read the [tldraw licence](/licenses/tldraw-3.15.6.txt).
